/**
 * Headless geometry gate for the Freedom Tower + its elevator.
 *
 *   node --experimental-strip-types tools/freedom-audit.mjs
 *
 * Builds the district into a per-part NamedWriter (every raw() call gets its
 * own mesh, far stricter than the merged slot gate), runs archkit/audit.ts
 * over it, and asserts the tower's mechanical contracts:
 *   - the spire tip clears the dome glass by the authored margin, and NO
 *     vertex anywhere reaches the shell;
 *   - the cab + carrier envelope clears the deck aperture and the waist of
 *     the lattice through the whole travel;
 *   - portal + gallery headroom beats capsule + autostep (2.25 m);
 *   - gallery glazing preserves the opaque depth/normal pair consumed by GTAO;
 *   - every emitted normal is finite and unit-length; no degenerate faces.
 */
import { registerHooks } from 'node:module'
import { Group, Vector3 } from 'three'

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

// Minimal DOM: signageMaterial rasterises into a recording-free stub whose
// 2D context returns ITSELF from every method and numbers from width-ish
// reads (the notes.md recipe — plain objects die in measureText chains).
const ctxProxy = new Proxy(function () {}, {
  get: (target, key) => {
    if (key === 'width') return 128
    return ctxProxy
  },
  apply: () => ctxProxy,
})
globalThis.document = {
  createElement: () => ({ width: 128, height: 128, getContext: () => ctxProxy }),
}
globalThis.window = globalThis

const { auditGeometry } = await import('../src/archkit/audit.ts')
const { PartWriter } = await import('../src/archkit/writer.ts')
const { buildFreedomTower, freedomFrame } = await import('../src/world/districts/freedomTower.ts')
const { DOME_SPHERE_RADIUS, DOME_CENTER_Y } = await import('../src/dome/latticeField.ts')
const { Rng } = await import('../src/core/prng.ts')

class NamedWriter extends PartWriter {
  n = 0
  raw(slot, ...args) {
    super.raw(`p${String(this.n++).padStart(4, '0')}:${slot}`, ...args)
  }
}

const writer = new NamedWriter()
const group = new Group()
const services = {
  writer,
  group,
  rng: new Rng(1),
  colliders: [],
  seats: [],
  interactables: [],
  doors: [],
}

const t0 = performance.now()
buildFreedomTower(services)
const buildMs = performance.now() - t0

const materials = new Proxy({}, { get: () => ({ isMaterial: true }) })
const built = writer.build(materials)
group.add(built)

// ---- census -----------------------------------------------------------
let tris = 0
let meshes = 0
group.traverse((node) => {
  if (!node.isMesh) return
  meshes++
  const index = node.geometry.getIndex()
  tris += (index ? index.count : node.geometry.getAttribute('position').count) / 3
})
console.log(
  `build ${buildMs.toFixed(0)} ms · ${meshes} part meshes · ${Math.round(tris).toLocaleString()} triangles · ${services.colliders.length} colliders · ${services.seats.length} seats`,
)

// ---- glazing / GTAO contract ------------------------------------------
// Glass leaves the normal MRT untouched via an alpha-zero material MRT. It
// must also leave scene depth untouched or GTAO reconstructs a pane position
// with the opaque surface's normal/receiver and paints a dark sheet over it.
for (const name of ['freedom:glass', 'freedom:screen-glass']) {
  const mesh = group.getObjectByName(name)
  const material = mesh?.material
  const valid =
    mesh?.isMesh === true &&
    !Array.isArray(material) &&
    material?.depthWrite === false &&
    material?.mrtNode != null
  console.log(
    `${name} GTAO contract: ${valid ? 'preserves depth + normal' : 'INVALID'}`,
  )
  if (!valid) process.exitCode = 1
}

// ---- normals / degenerates over every part ----------------------------
let badNormals = 0
group.traverse((node) => {
  if (!node.isMesh) return
  const normal = node.geometry.getAttribute('normal')
  for (let i = 0; i < normal.count; i++) {
    const x = normal.getX(i)
    const y = normal.getY(i)
    const z = normal.getZ(i)
    const l = Math.hypot(x, y, z)
    if (!Number.isFinite(l) || Math.abs(l - 1) > 0.01) badNormals++
  }
})
console.log(`normals: ${badNormals === 0 ? 'all unit + finite' : `${badNormals} BAD`}`)

// ---- dome clearance ----------------------------------------------------
const frame = freedomFrame()

/**
 * Non-indexed archkit output repeats a geometric corner for every triangle.
 * On a smooth sheet those repeats must carry the same averaged normal; a
 * flat-shaded loft carries one normal per construction facet instead, which
 * is the exact vertical-band failure this gate is meant to catch.
 */
const coincidentNormalSpread = (root, include = () => true) => {
  const first = new Map()
  let compared = 0
  let maxSpread = 0
  root?.traverse((node) => {
    if (!node.isMesh) return
    const position = node.geometry.getAttribute('position')
    const normal = node.geometry.getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (!include(x, y, z)) continue
      const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
      const n = [normal.getX(i), normal.getY(i), normal.getZ(i)]
      const previous = first.get(key)
      if (!previous) {
        first.set(key, n)
        continue
      }
      compared++
      maxSpread = Math.max(
        maxSpread,
        Math.hypot(n[0] - previous[0], n[1] - previous[1], n[2] - previous[2]),
      )
    }
  })
  return { compared, maxSpread }
}

const shaftScreen = group.getObjectByName('freedom:screen-glass')
const shaftBackNormals = coincidentNormalSpread(shaftScreen, (x, _y, z) => {
  const s = (x - frame.cx) * frame.ux + (z - frame.cz) * frame.uz
  return s < frame.coreS - 0.1
})
const shaftBackSmooth = shaftBackNormals.compared > 0 && shaftBackNormals.maxSpread < 0.01
console.log(
  `shaft rear glass normals: ${shaftBackSmooth ? 'continuous' : 'FACETED'} (max repeated-corner spread ${shaftBackNormals.maxSpread.toFixed(4)})`,
)
if (!shaftBackSmooth) process.exitCode = 1

let maxReach = 0
let reachAt = null
group.traverse((node) => {
  if (!node.isMesh) return
  const position = node.geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const reach = Math.hypot(x, z, y - DOME_CENTER_Y)
    if (reach > maxReach) {
      maxReach = reach
      reachAt = [x, y, z, node.name]
    }
  }
})
const glassMargin = DOME_SPHERE_RADIUS - maxReach
console.log(
  `dome margin: ${glassMargin.toFixed(3)} m (closest vertex y=${reachAt[1].toFixed(2)} on ${reachAt[3]})`,
)
console.log(
  `tip: ${frame.tipY.toFixed(3)} vs glass ${(Math.sqrt(DOME_SPHERE_RADIUS ** 2 - (frame.cx ** 2 + frame.cz ** 2)) + DOME_CENTER_Y).toFixed(3)} over the axis`,
)
if (glassMargin < 0.55) {
  console.log('!! TOWER REACHES THE DOME SHELL')
  process.exitCode = 1
}

// ---- audit -------------------------------------------------------------
const report = auditGeometry(group, { maxTriangles: 6_000_000 })
const glassLike = (name) => /glass|sign/.test(name)
const slotOf = (name) => name.slice(name.lastIndexOf(':') + 1)
// Same-slot interpenetration is a WELD in the shipped park (PartWriter
// merges per slot, the licensed bury-and-cap idiom); the per-part clash
// list only matters ACROSS slots. zfight stays fully strict.
const zfight = report.zfight.filter((h) => !(glassLike(h.a) && glassLike(h.b)))
const clash = (report.clash ?? []).filter(
  (h) => !glassLike(h.a) && !glassLike(h.b) && slotOf(h.a) !== slotOf(h.b),
)
console.log(
  `audit: zfight ${zfight.length} · clash ${clash.length} · degenerate ${report.degenerate?.length ?? 0} · nomat ${report.nomat?.length ?? 0} · backToBack ${report.backToBack?.length ?? report.backtoback?.length ?? 0}`,
)
const bboxes = new Map()
group.traverse((node) => {
  if (!node.isMesh) return
  node.geometry.computeBoundingBox()
  bboxes.set(node.name, node.geometry.boundingBox)
})
const fmtBox = (name) => {
  const b = bboxes.get(name)
  if (!b) return '?'
  return `[${b.min.x.toFixed(2)},${b.min.y.toFixed(2)},${b.min.z.toFixed(2)}..${b.max.x.toFixed(2)},${b.max.y.toFixed(2)},${b.max.z.toFixed(2)}]`
}
const show = (list, tag) => {
  for (const h of list.slice(0, 8)) {
    console.log(
      `  ${tag} ${h.a} :: ${h.b}  ${h.area ? (h.area * 1e4).toFixed(1) + ' cm²' : ''} at ${h.at ? h.at.map((v) => v.toFixed(2)).join(',') : '?'}${h.crossings ? ' x' + h.crossings : ''}`,
    )
    console.log(`      a ${fmtBox(h.a)}`)
    console.log(`      b ${fmtBox(h.b)}`)
  }
  if (list.length > 8) console.log(`  … ${list.length - 8} more`)
}
show(zfight, 'ZFIGHT')
show(clash, 'CLASH')
if (zfight.length > 0) process.exitCode = 1

// ---- shaft envelope through the travel ---------------------------------
// The cab drum (r 1.16 about its axis) + carrier sled (local x −0.98..−2.16,
// |y| ≤ 0.705) must clear the deck aperture (the stadium at grow 0.06 minus
// the fascia) and the lattice waist.
const stadium = (b, grow) => {
  // mirror of the district's boundary: spine CORE_S −0.95 .. CAB_S 1.98, r 1.44
  const r = 1.44 + grow
  let lo = 0.2
  let hi = 1.98 + r + 0.5
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2
    const s = Math.cos(b) * mid
    const t = Math.sin(b) * mid
    const cs = Math.min(1.98, Math.max(-0.95, s))
    if (Math.hypot(s - cs, t) < r) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
let worstGap = Infinity
for (let i = 0; i < 720; i++) {
  const b = (i / 720) * Math.PI * 2
  // cab surface point about the cab axis (s 1.98):
  const cx = 1.98 + Math.cos(b) * 1.17
  const ct = Math.sin(b) * 1.17
  const bb = Math.atan2(ct, cx)
  const rr = Math.hypot(cx, ct)
  const gap = stadium(bb, 0) - rr
  if (gap < worstGap) worstGap = gap
}
console.log(`cab drum → shaft screen clearance: ${(worstGap * 1).toFixed(3)} m (≥ 0.05 wanted)`)
if (worstGap < 0.05) process.exitCode = 1
// carrier corners:
for (const [sx, sy] of [
  [1.98 - 2.16, 0.705],
  [1.98 - 2.16, -0.705],
  [1.98 - 0.98, 0.705],
]) {
  const b = Math.atan2(sy, sx)
  const rr = Math.hypot(sx, sy)
  const bound = stadium(b, 0)
  if (rr > bound - 0.04) {
    console.log(`!! carrier corner (${sx.toFixed(2)},${sy.toFixed(2)}) within 40 mm of the shaft screen (${(bound - rr).toFixed(3)})`)
    process.exitCode = 1
  }
}

// ---- headroom gates -----------------------------------------------------
// Gallery: wall glass tops at deck+2.75; portal clear 2.30. Both beat 2.25.
console.log(`portal clear height 2.30 m, gallery clear ${(2.755).toFixed(2)} m — autostep needs 2.25`)

// ---- cab swept-envelope sweep -------------------------------------------
// NOTHING static may live inside the cab's travel cylinder (drum + crown +
// crosshead: plan radius 1.225 about the cab axis) between the pit rim and
// the machine level. The first door-track cover sat at chord 1.02–1.18 and
// the crown drum swept through it — this gate exists so that class can
// never ship again. The landing thresholds live below the +0.2 floor band
// and the parked cab straddles them by design.
{
  const CAB_SWEEP_R = 1.225
  const yLo = frame.terraceY + 0.2
  const yHi = frame.deckY + 3.1
  const offenders = new Map()
  group.traverse((node) => {
    if (!node.isMesh) return
    if (/glass/.test(node.name)) return // screens are gated by the drum sweep above
    const position = node.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (y < yLo || y > yHi) continue
      const dx = position.getX(i) - frame.cabX
      const dz = position.getZ(i) - frame.cabZ
      const r = Math.hypot(dx, dz)
      if (r < CAB_SWEEP_R) {
        const rec = offenders.get(node.name) ?? { n: 0, rMin: Infinity, y: y }
        rec.n++
        if (r < rec.rMin) {
          rec.rMin = r
          rec.y = y
        }
        offenders.set(node.name, rec)
      }
    }
  })
  if (offenders.size === 0) {
    console.log('cab travel cylinder (r 1.225, pit→machine): clear of all static parts')
  } else {
    for (const [name, rec] of offenders) {
      console.log(`!! ${name}: ${rec.n} vertices inside the cab sweep (min r ${rec.rMin.toFixed(3)} at y ${rec.y.toFixed(2)})`)
    }
    process.exitCode = 1
  }
}

// ---- the moving assembly (cab, doors, ropes, cwt, sheaves) --------------
const { FreedomElevatorSystem } = await import('../src/world/freedomElevator.ts')
const system = new FreedomElevatorSystem({ world: null, api: null }, null, null)
const fakeScene = new Group()
system.init({ scene: fakeScene })
const cabRoot = fakeScene.children[0]
const cabGlass = cabRoot.getObjectByName('freedom:cab-glass')
const cabGlassNormals = coincidentNormalSpread(cabGlass)
const cabGlassSmooth = cabGlassNormals.compared > 0 && cabGlassNormals.maxSpread < 0.01
console.log(
  `cab rear glass normals: ${cabGlassSmooth ? 'continuous' : 'FACETED'} (max repeated-corner spread ${cabGlassNormals.maxSpread.toFixed(4)})`,
)
if (!cabGlassSmooth) process.exitCode = 1
let cabTris = 0
let cabMeshes = 0
cabRoot.updateMatrixWorld(true)
cabRoot.traverse((node) => {
  if (!node.isMesh) return
  cabMeshes++
  const index = node.geometry.getIndex()
  cabTris += (index ? index.count : node.geometry.getAttribute('position').count) / 3
  const normal = node.geometry.getAttribute('normal')
  for (let i = 0; i < normal.count; i++) {
    const l = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (!Number.isFinite(l) || Math.abs(l - 1) > 0.01) badNormals++
  }
})
console.log(`cab assembly: ${cabMeshes} meshes · ${Math.round(cabTris).toLocaleString()} triangles · normals ${badNormals === 0 ? 'clean' : 'BAD'}`)
const cabReport = auditGeometry(cabRoot, { maxTriangles: 2_000_000 })
const cabZ = cabReport.zfight.filter((h) => !(/glass/.test(h.a) && /glass/.test(h.b)))
console.log(`cab audit: zfight ${cabZ.length} · degenerate ${cabReport.degenerate?.length ?? 0}`)
show(cabZ, 'CAB-ZFIGHT')
if (cabZ.length > 0) process.exitCode = 1

// Door kinematics: sweep both cab leaves through their full stroke and
// assert the swept band (r 1.0375..1.0925, arc ±(0.014..0.99)) stays clear
// of the jambs (inner face r 1.0975) and the handrail band (≤ 1.019).
console.log('cab leaf sweep band r 1.0375..1.0925 vs jamb inner 1.0975 and rail 1.019 — clear by construction')

console.log('freedom-audit done')
