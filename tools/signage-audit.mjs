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

// --- minimal DOM. The canvas records the w/h the sign builders assign, which
// is the whole point: that is the aspect the texture actually carries.
// Every method returns the context itself, so `createLinearGradient()
// .addColorStop()` chains; `width`-ish reads return a number so
// `measureText(s).width` is usable.
const stubCtx = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === 'width' || prop === 'actualBoundingBoxLeft' || prop === 'actualBoundingBoxRight')
        return 10
      if (prop === 'canvas') return { width: 0, height: 0 }
      return () => stubCtx
    },
    set: () => true,
  },
)
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => stubCtx,
  }),
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
  portalStation: '../src/world/portalStation.ts',
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
  portalStation: 'buildPortalStation',
}

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
    const img = m?.map?.image
    if (!img || !img.width || !img.height) continue
    let owner = o
    while (owner && !ownerOf.has(owner)) owner = owner.parent
    signs.push({ mesh: o, tex: m.map, owner: ownerOf.get(owner) ?? '?' })
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
  const verdict = err < 0.03 ? 'ok' : `SQUASH ${(planeAR / canvAR).toFixed(2)}x`
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
console.log(`\n${rows.length} text surfaces on the special group.`)
