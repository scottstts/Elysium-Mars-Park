/**
 * Headless signage gate.
 *
 *   node --experimental-strip-types tools/signage-audit.mjs
 *
 * Builds the whole park (districts + amenities + interiors) into one writer,
 * then for EVERY mesh carrying a canvas-rasterised text map reports:
 *
 *   - the canvas pixel aspect vs the mesh's own world width/height (the
 *     `signageMaterial` squash class: they must be equal),
 *   - what is behind the plate (backward raycast) and what is under it
 *     (downward raycast) — the floating-sign class,
 *   - the plate's facing, so an edge-on or upside-down plate shows up.
 *
 * Interpretation is left to the reader; this only measures.
 */
import { registerHooks } from 'node:module'
import { DoubleSide, Group, MeshBasicMaterial, Raycaster, Vector3 } from 'three'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* fall through */
      }
    }
    return next(specifier, context)
  },
})

// --- Advance widths per 1000 em, MEASURED off the shipping stack
// ("Helvetica Neue", Helvetica, Arial) with `measureText` at 1000 px — not an
// Adobe Helvetica AFM, which is a different face (Neue's bold M is 907, base
// Helvetica's is 833) and would be 8 % out on every line.
//
// The number that matters most here is U+200A HAIR SPACE, the separator
// `signageMaterial` letterspaces with: 15/1000 at weight 700 and 63/1000 at
// 500. That is essentially ZERO tracking, which is why any width budget
// written as "chars x 1.18 em" is nearly twice the ink actually drawn.
//
// `measureText` MUST be real for a second reason: `parkAmenities`'s `fitFont`
// shrinks until the string fits, so a stub that answers a constant makes every
// amenity legend report its START size and the overflow class goes invisible.
const W_BOLD = { ' ': 278, '!': 278, '"': 463, '#': 556, $: 556, '%': 1000, '&': 685, "'": 278,
  '(': 296, ')': 296, '*': 407, '+': 600, ',': 278, '-': 407, '.': 278, '/': 371,
  ':': 278, ';': 278, '<': 600, '=': 600, '>': 600, '?': 556, '@': 800,
  A: 685, B: 704, C: 741, D: 741, E: 648, F: 593, G: 759, H: 741, I: 295, J: 556,
  K: 722, L: 593, M: 907, N: 741, O: 778, P: 667, Q: 778, R: 722, S: 649, T: 611,
  U: 741, V: 630, W: 944, X: 667, Y: 667, Z: 648, '[': 333, '\\': 371, ']': 333, _: 500,
  a: 574, b: 611, c: 574, d: 611, e: 574, f: 333, g: 611, h: 593, i: 258, j: 278,
  k: 574, l: 258, m: 906, n: 593, o: 611, p: 611, q: 611, r: 389, s: 537, t: 352,
  u: 593, v: 520, w: 814, x: 537, y: 519, z: 519,
  '·': 278, '–': 500, '—': 1000, '°': 400, ' ': 15 }
const W_MED = { ...W_BOLD,
  '!': 278, '"': 444, '&': 648, '(': 278, ')': 278, '*': 370, '-': 389, '/': 352,
  A: 667, B: 704, E: 630, F: 593, G: 759, J: 537, K: 685, L: 574, M: 889, O: 760,
  Q: 760, S: 648, T: 593, V: 611, X: 648, Y: 648, Z: 630,
  a: 556, c: 556, e: 556, f: 315, g: 593, h: 574, i: 241, j: 241, k: 537, l: 241,
  m: 870, n: 574, o: 593, r: 352, s: 519, t: 333, u: 574, v: 519, w: 778, x: 537,
  y: 519, ' ': 63 }
for (const d of '0123456789') {
  W_BOLD[d] = 556
  W_MED[d] = 556
}
function textWidth(text, size, bold) {
  const table = bold ? W_BOLD : W_MED
  let em = 0
  for (const ch of text) em += table[ch] ?? 600
  return (em / 1000) * size
}

// --- recording 2D context. One per canvas, so every text surface in the park
// reports the type it actually rasterised: per-line font size, the transformed
// ink box of every `fillText`, and every `fillRect`/`strokeRect` that could sit
// on top of it. Unknown methods still return the context itself so
// `createLinearGradient().addColorStop()` chains for the non-text canvases.
function makeCtx(canvas) {
  const state = { font: '10px sans', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    textAlign: 'start', globalAlpha: 1, tx: 0, ty: 0, sx: 1, sy: 1 }
  const stack = []
  const rec = { texts: [], rects: [], strokes: [], canvas, seq: 0 }
  const parse = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(state.font)
    const w = /^\s*(\d{3})/.exec(state.font)
    return { size: m ? Number(m[1]) : 10, bold: w ? Number(w[1]) >= 600 : false }
  }
  const api = {
    save: () => { stack.push({ ...state }) },
    restore: () => { Object.assign(state, stack.pop() ?? state) },
    translate: (x, y) => { state.tx += x * state.sx; state.ty += y * state.sy },
    scale: (x, y) => { state.sx *= x; state.sy *= y },
    rotate: () => {},
    measureText: (text) => {
      const { size, bold } = parse()
      return { width: textWidth(text, size, bold) * state.sx, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
    },
    fillText: (text, x, y) => {
      const { size, bold } = parse()
      const w = textWidth(text, size, bold) * state.sx
      const cx = state.tx + x * state.sx
      const cy = state.ty + y * state.sy
      // textAlign start/left anchors the run at x; center splits it.
      const x0 = state.textAlign === 'center' ? cx - w / 2 : state.textAlign === 'right' ? cx - w : cx
      // textBaseline is 'middle' everywhere in this project; caps then run
      // roughly +-0.36 em about the anchor.
      rec.texts.push({ seq: rec.seq++, text, size: size * state.sy, x0, x1: x0 + w,
        y0: cy - 0.36 * size * state.sy, y1: cy + 0.36 * size * state.sy, fill: state.fillStyle })
    },
    fillRect: (x, y, w, h) => {
      rec.rects.push({ seq: rec.seq++, x0: state.tx + x * state.sx, y0: state.ty + y * state.sy,
        x1: state.tx + (x + w) * state.sx, y1: state.ty + (y + h) * state.sy,
        fill: state.fillStyle, alpha: state.globalAlpha })
    },
    strokeRect: (x, y, w, h) => {
      rec.strokes.push({ seq: rec.seq++, x0: state.tx + x * state.sx, y0: state.ty + y * state.sy,
        x1: state.tx + (x + w) * state.sx, y1: state.ty + (y + h) * state.sy,
        lineWidth: state.lineWidth, stroke: state.strokeStyle, alpha: state.globalAlpha })
    },
  }
  const ctx = new Proxy(api, {
    get: (t, prop) => {
      if (prop in t) return t[prop]
      if (prop === 'canvas') return canvas
      if (prop in state) return state[prop]
      if (prop === 'width') return 10
      return () => ctx
    },
    set: (t, prop, value) => {
      state[prop] = value
      return true
    },
  })
  canvas.__rec = rec
  return ctx
}

globalThis.document = {
  createElement: () => {
    const canvas = { width: 0, height: 0 }
    canvas.getContext = () => (canvas.__ctx ??= makeCtx(canvas))
    return canvas
  },
}
globalThis.window = globalThis
globalThis.devicePixelRatio = 1

const { PartWriter } = await import('../src/archkit/writer.ts')
const { Rng } = await import('../src/core/prng.ts')

const writer = new PartWriter()
const group = new Group()
group.name = 'special'
const services = {
  writer,
  group,
  rng: new Rng(1337),
  colliders: [],
  seats: [],
  interactables: [],
  doors: [],
}

const districts = {
  residential: '../src/world/districts/residential.ts',
  farmside: '../src/world/districts/farmside.ts',
  works: '../src/world/districts/works.ts',
  leisure: '../src/world/districts/leisure.ts',
  commons: '../src/world/districts/commons.ts',
  hydroTower: '../src/world/districts/hydroTower.ts',
  amenities: '../src/world/parkAmenities.ts',
  interiors: '../src/world/districts/interiors.ts',
}
const entry = {
  residential: 'buildResidential',
  farmside: 'buildFarmside',
  works: 'buildWorks',
  leisure: 'buildLeisure',
  commons: 'buildCommons',
  hydroTower: 'buildHydroTower',
  amenities: 'buildAmenities',
  interiors: 'buildInteriors',
}

// The station signage lives on two owners that are NOT `build*(services)`
// district functions, so the first version of this gate silently skipped both:
// the portal is a GameSystem class, and the two side platforms are emitted by
// `track.ts`. Neither has physics here — both collider paths early-return on a
// null world, which is exactly what we want.
const nullPhysics = { world: null, api: null }
const extras = [
  ['portalStation', async () => {
    const { PortalStationSystem } = await import('../src/world/portalStation.ts')
    const system = new PortalStationSystem(nullPhysics, null, null)
    system.init({ scene: { add: (o) => group.add(o), remove: () => {} } })
  }],
  ['tramStations', async () => {
    const { buildSideStations } = await import('../src/world/sideStations.ts')
    buildSideStations(writer, group, nullPhysics)
  }],
]

// Tag every mesh added to services.group with the district that added it.
const ownerOf = new Map()
for (const [name, path] of Object.entries(districts)) {
  const before = group.children.length
  try {
    const mod = await import(path)
    const fn = mod[entry[name]] ?? mod[Object.keys(mod).find((k) => k.startsWith('build'))]
    const t0 = Date.now()
    fn(services)
    for (let i = before; i < group.children.length; i++) ownerOf.set(group.children[i], name)
    console.log(`built ${name.padEnd(14)} ${String(Date.now() - t0).padStart(5)} ms  +${group.children.length - before} special meshes`)
  } catch (e) {
    console.log(`built ${name.padEnd(14)} FAILED: ${e.message}`)
  }
}
for (const [name, run] of extras) {
  const before = group.children.length
  try {
    await run()
    for (let i = before; i < group.children.length; i++) ownerOf.set(group.children[i], name)
    console.log(`built ${name.padEnd(14)}        +${group.children.length - before} special meshes`)
  } catch (e) {
    console.log(`built ${name.padEnd(14)} FAILED: ${e.message}`)
  }
}

// Architecture: the merged writer meshes are the things a sign can mount to.
const materials = new Proxy({}, { get: () => new MeshBasicMaterial({ side: DoubleSide }) })
const arch = writer.build(materials)
arch.name = 'arch'
arch.updateMatrixWorld(true)
group.updateMatrixWorld(true)

const archMeshes = []
arch.traverse((o) => {
  if (o.isMesh && o.geometry?.attributes?.position) archMeshes.push(o)
})
console.log(`\narchitecture: ${archMeshes.length} merged meshes`)

// --- collect every text surface on the special group.
const signs = []
group.traverse((o) => {
  if (!o.isMesh) return
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  for (const m of mats) {
    // `parkAmenities` binds its atlas through a TSL `colorNode = texture(tex)`,
    // NOT `material.map` — so every legend in the park (171 sign faces, 66
    // atlas tiles) was invisible to this gate until the second branch existed.
    const tex = m?.map ?? m?.colorNode?.value ?? m?.emissiveNode?.value
    const img = tex?.image
    if (!img || !img.width || !img.height) continue
    let owner = o
    while (owner && !ownerOf.has(owner)) owner = owner.parent
    // An atlas mesh carries many tiles on one canvas with per-quad UVs, so the
    // whole-mesh aspect check is meaningless for it — only the layout is.
    signs.push({ mesh: o, tex, owner: ownerOf.get(owner) ?? '?', atlas: !m.map })
    break
  }
})

const ray = new Raycaster()
ray.far = 3
const wp = new Vector3()
const n = new Vector3()
const up = new Vector3(0, 1, 0)

function planeSize(mesh) {
  const p = mesh.geometry?.parameters
  if (p && p.width !== undefined && p.height !== undefined) {
    return [p.width * mesh.scale.x, p.height * mesh.scale.y]
  }
  mesh.geometry.computeBoundingBox()
  const b = mesh.geometry.boundingBox
  return [(b.max.x - b.min.x) * mesh.scale.x, (b.max.y - b.min.y) * mesh.scale.y]
}

function hitsFrom(origin, dir, skipUnder) {
  ray.set(origin, dir)
  const out = ray.intersectObjects(archMeshes, false)
  return out.filter((h) => h.distance > skipUnder).slice(0, 3)
}

console.log(
  `\n${'owner'.padEnd(14)} ${'name'.padEnd(26)} ${'plane w x h'.padEnd(15)} ${'planeAR'.padEnd(8)} ${'canvas'.padEnd(12)} ${'canvAR'.padEnd(8)} verdict`,
)
const rows = []
for (const s of signs) {
  const [w, h] = planeSize(s.mesh)
  const planeAR = w / h
  const canvAR = s.tex.image.width / s.tex.image.height
  const err = Math.abs(planeAR - canvAR) / Math.max(planeAR, canvAR)
  const verdict = s.atlas ? 'atlas' : err < 0.03 ? 'ok' : `SQUASH ${(planeAR / canvAR).toFixed(2)}x`
  rows.push({ s, w, h, planeAR, canvAR, verdict })
  console.log(
    `${s.owner.padEnd(14)} ${(s.mesh.name || '(unnamed)').slice(0, 26).padEnd(26)} ` +
      `${(w.toFixed(3) + ' x ' + h.toFixed(3)).padEnd(15)} ${planeAR.toFixed(3).padEnd(8)} ` +
      `${(s.tex.image.width + 'x' + s.tex.image.height).padEnd(12)} ${canvAR.toFixed(3).padEnd(8)} ${verdict}`,
  )
}

// --- mounting probe.
console.log(`\n--- mounting (backward ray from plate, downward ray from bottom edge) ---`)
const q = new (await import('three')).Quaternion()
for (const r of rows) {
  const s = r.s
  s.mesh.getWorldPosition(wp)
  s.mesh.getWorldQuaternion(q)
  n.set(0, 0, 1).applyQuaternion(q).normalize()
  const tilt = Math.acos(Math.max(-1, Math.min(1, n.dot(up)))) * (180 / Math.PI)
  const back = hitsFrom(wp.clone().addScaledVector(n, 0.001), n.clone().negate(), 0.0)
  const bottom = wp.clone().addScaledVector(up, -r.h / 2 + 0.01)
  const down = hitsFrom(bottom, up.clone().negate(), 0.0)
  const fmt = (hs) => (hs.length ? hs.map((x) => x.distance.toFixed(3)).join(', ') : 'NOTHING')
  // The four boss/stud positions: where a fixing actually has to land.
  const sideV = new Vector3(n.z, 0, -n.x).normalize()
  const corners = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const o = wp
        .clone()
        .addScaledVector(sideV, sx * (r.w * 0.5 - 0.12))
        .addScaledVector(up, sy * (r.h * 0.5 - 0.1))
        .addScaledVector(n, 0.001)
      const hs = hitsFrom(o, n.clone().negate(), 0.105)
      corners.push(hs.length ? hs[0].distance.toFixed(3) : '--')
    }
  }
  console.log(`${' '.repeat(12)} corners(host behind, skipping own bosses): [${corners.join(' ')}]`)
  // Leg probe: straight down from the plate's bottom edge, on the leg plane
  // (21 mm behind the face). A post shows up as a hit at ~0.
  const legs = []
  for (const off of [-(r.w / 2 - 0.17), -0.45, 0.45, r.w / 2 - 0.17]) {
    const o = wp
      .clone()
      .addScaledVector(sideV, off)
      // 84 mm behind the FACE is 21 mm behind `at` — the leg plane. Start
      // 60 mm under the plate so the backing plate itself is not the hit.
      .addScaledVector(up, -r.h / 2 - 0.06)
      .addScaledVector(n, -0.084)
    const hs = hitsFrom(o, up.clone().negate(), 0)
    legs.push(hs.length ? hs[0].distance.toFixed(2) : '--')
  }
  console.log(`${' '.repeat(12)} legs below at [+-(w/2-.17), +-.45]: [${legs.join(' ')}]`)
  console.log(
    `${s.owner.padEnd(12)} ${(s.mesh.name || '(unnamed)').slice(0, 24).padEnd(24)} ` +
      `pos ${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)}  ` +
      `normalTiltFromUp ${tilt.toFixed(0)}deg  behind[${fmt(back)}]  below[${fmt(down)}]`,
  )
}
// --- occlusion. A sign can be perfectly built, mounted and typeset and still
// be unreadable because something stands in front of it. Cast from a reader's
// eye 3 m out on the plate's own normal back to the plate: anything the ray
// meets on the way is between the reader and the sign. (The station name
// boards were centred on a canopy column this way — u 0 is a bay boundary.)
console.log(`\n--- occlusion (3 m back along the plate normal) ---`)
for (const r of rows) {
  const s = r.s
  s.mesh.getWorldPosition(wp)
  s.mesh.getWorldQuaternion(q)
  n.set(0, 0, 1).applyQuaternion(q).normalize()
  const eye = wp.clone().addScaledVector(n, 3)
  ray.set(eye, n.clone().negate())
  ray.far = 3
  const blockers = ray
    .intersectObjects(archMeshes, false)
    // Past 2.75 m from the eye is the sign's own bezel, standoff and host.
    .filter((h) => h.distance < 2.75)
  if (blockers.length === 0) continue
  console.log(
    `${s.owner.padEnd(13)} ${(s.mesh.name || '(unnamed)').slice(0, 22).padEnd(22)} ` +
      // The world POINT matters as much as the distance: the slot meshes are
      // park-wide merges, so "part:steel" names nothing on its own — you need
      // the hit's coordinates to find which member it belongs to.
      `BLOCKED by ${blockers
        .slice(0, 3)
        .map(
          (h) =>
            `${h.object.name || '?'}@${h.distance.toFixed(2)}m` +
            `(${h.point.x.toFixed(1)},${h.point.y.toFixed(1)},${h.point.z.toFixed(1)})`,
        )
        .join(', ')} ` +
      `(plate ${r.w.toFixed(2)} x ${r.h.toFixed(2)} at ${wp.x.toFixed(1)},${wp.y.toFixed(1)},${wp.z.toFixed(1)})`,
  )
}

// --- type layout. The squash class is about the CANVAS; this is about what
// was drawn ON it: ragged per-line sizes, ink that runs into the border, and
// any decoration painted after the text that lands on top of it.
console.log(`\n--- type layout (per canvas, from the recorded 2D calls) ---`)
const seen = new Set()
for (const r of rows) {
  const canvas = r.s.tex.image
  const rec = canvas?.__rec
  if (!rec || seen.has(canvas)) continue
  seen.add(canvas)
  if (rec.texts.length === 0) continue
  const flags = []
  const sizes = rec.texts.map((t) => t.size)
  const ragged = Math.max(...sizes) / Math.min(...sizes)
  if (ragged > 1.05) flags.push(`RAGGED ${ragged.toFixed(2)}x`)
  const notes = []
  for (const t of rec.texts) {
    const hit = []
    // A rect painted AFTER the text that only PARTLY covers it is decoration
    // on top of type; one that fully contains it is the plate ground.
    for (const q of rec.rects) {
      if (q.seq < t.seq) continue
      const overlap = q.x0 < t.x1 && q.x1 > t.x0 && q.y0 < t.y1 && q.y1 > t.y0
      const contains = q.x0 <= t.x0 && q.x1 >= t.x0 && q.y0 <= t.y0 && q.y1 >= t.y1
      if (overlap && !contains) hit.push(`rect@${q.y0.toFixed(0)}..${q.y1.toFixed(0)}`)
    }
    for (const q of rec.strokes) {
      const lw = q.lineWidth / 2
      const inner = { x0: q.x0 + lw, y0: q.y0 + lw, x1: q.x1 - lw, y1: q.y1 - lw }
      const outer = { x0: q.x0 - lw, y0: q.y0 - lw, x1: q.x1 - -lw, y1: q.y1 + lw }
      const insideOuter = t.x0 >= outer.x0 && t.x1 <= outer.x1 && t.y0 >= outer.y0 && t.y1 <= outer.y1
      const insideInner = t.x0 >= inner.x0 && t.x1 <= inner.x1 && t.y0 >= inner.y0 && t.y1 <= inner.y1
      if (insideOuter && !insideInner) hit.push('BORDER')
      const slack = Math.min(t.x0 - inner.x0, inner.x1 - t.x1, t.y0 - inner.y0, inner.y1 - t.y1)
      if (insideInner && slack < 6) hit.push(`tight ${slack.toFixed(1)}px`)
    }
    if (t.x0 < 0 || t.x1 > canvas.width) hit.push(`OFF-CANVAS x ${t.x0.toFixed(0)}..${t.x1.toFixed(0)} of ${canvas.width}`)
    // A tile's own ground is the last rect drawn BEFORE the text that contains
    // it. On an atlas that is the tile; on a single-sign canvas it is the
    // plate. Ink that leaves it has left the sign — on an atlas it has landed
    // on the NEIGHBOURING sign, which no canvas-edge test can see.
    let tile = null
    for (const q of rec.rects) {
      if (q.seq > t.seq) break
      const cx = (t.x0 + t.x1) / 2
      const cy = (t.y0 + t.y1) / 2
      if (q.x0 <= cx && q.x1 >= cx && q.y0 <= cy && q.y1 >= cy) tile = q
    }
    if (tile) {
      const out = Math.max(tile.x0 - t.x0, t.x1 - tile.x1, tile.y0 - t.y0, t.y1 - tile.y1)
      if (out > 0.5) hit.push(`OUT OF TILE by ${out.toFixed(0)}px`)
    }
    if (hit.length) notes.push(`      "${t.text.slice(0, 34)}" ${t.size.toFixed(1)}px -> ${hit.join(' ')}`)
  }
  if (notes.length) flags.push('COLLIDE')
  const head =
    `${r.s.owner.padEnd(13)} ${(r.s.mesh.name || '(unnamed)').slice(0, 22).padEnd(22)} ` +
    `${(canvas.width + 'x' + canvas.height).padEnd(10)} ${String(rec.texts.length).padStart(3)} lines  ` +
    `sizes ${sizes.map((v) => v.toFixed(0)).join('/')}`
  console.log(`${head}  ${flags.join(' ') || 'ok'}`)
  for (const n of notes) console.log(n)
}

console.log(`\n${rows.length} text surfaces on the special group.`)
