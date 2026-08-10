/**
 * archkit self-test — no test runner, no dependencies.
 *
 *     node --experimental-strip-types tools/archkit-selftest.mjs
 *
 * Constructs every primitive in `src/archkit/meshdata.ts` and asserts the
 * properties the craft rules actually depend on: closed shells stay closed,
 * emitted normals are finite and unit-length, windings point outward, lathe
 * poles weld to a single vertex, and the audit gate finds a planted z-fight
 * while ignoring a planted butt joint.
 *
 * NOTE on `tools/geometry-audit.mjs`: there is none, deliberately. The audit
 * has to run against the BUILT scene, and the scene only exists after the
 * WebGPU renderer and the physics WASM have booted — a headless node port
 * would have to re-implement half the game to produce anything to audit. The
 * gate therefore lives in the page (`window.__elysium.audit()`); this file
 * only proves the algorithm itself is sound.
 */
import { registerHooks } from 'node:module'
import { Group, Mesh, MeshBasicMaterial, BufferGeometry, BufferAttribute } from 'three'

// `src/` imports are extensionless (vite resolves them); node needs the .ts
// put back. Registered before the dynamic imports below, which is why those
// are dynamic — static imports would be hoisted past this.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* fall through to the normal resolution */
      }
    }
    return next(specifier, context)
  },
})

const m = await import('../src/archkit/meshdata.ts')
const { auditGeometry } = await import('../src/archkit/audit.ts')
const { buildParkBench } = await import('../src/archkit/kitBench.ts')

let failures = 0
let checks = 0

function check(name, ok, detail = '') {
  checks++
  if (!ok) {
    failures++
    console.error(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`)
  }
}

/** Every edge used exactly twice: the property a solid must have. */
function isClosed(md) {
  const count = new Map()
  for (const f of md.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      if (a === b) continue
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  let open = 0
  let multi = 0
  for (const c of count.values()) {
    if (c === 1) open++
    else if (c > 2) multi++
  }
  return { closed: open === 0 && multi === 0, open, multi }
}

function emit(md) {
  const soup = m.toTriangles(md.clone())
  const tris = soup.positions.length / 9
  let badPos = 0
  let badNrm = 0
  for (let i = 0; i < soup.positions.length; i++) if (!Number.isFinite(soup.positions[i])) badPos++
  for (let i = 0; i < soup.normals.length; i += 3) {
    const l = Math.hypot(soup.normals[i], soup.normals[i + 1], soup.normals[i + 2])
    if (!Number.isFinite(l) || Math.abs(l - 1) > 1e-5) badNrm++
  }
  return { tris, badPos, badNrm, soup }
}

function solid(name, md, expectTris = null) {
  const e = emit(md)
  const c = isClosed(md)
  check(`${name}: emits triangles`, e.tris > 0, `${e.tris}`)
  check(`${name}: finite positions`, e.badPos === 0, `${e.badPos} bad`)
  check(`${name}: unit normals`, e.badNrm === 0, `${e.badNrm} bad`)
  check(`${name}: closed shell`, c.closed, `open=${c.open} multi=${c.multi}`)
  if (expectTris !== null) check(`${name}: ${expectTris} triangles`, e.tris === expectTris, `got ${e.tris}`)
  return e
}

function surface(name, md) {
  const e = emit(md)
  check(`${name}: emits triangles`, e.tris > 0, `${e.tris}`)
  check(`${name}: finite positions`, e.badPos === 0, `${e.badPos} bad`)
  check(`${name}: unit normals`, e.badNrm === 0, `${e.badNrm} bad`)
  return e
}

console.log('archkit self-test')

// ---------------------------------------------------------------- primitives
const unitSquare = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
solid('box', m.box(0, 0, 0, 1, 1, 1), 12)
solid('prism', m.prism(unitSquare, 0, 1), 12)
solid('prismXZ', m.prismXZ(unitSquare, 0, 1), 12)
solid('prismYZ', m.prismYZ(unitSquare, 0, 1), 12)
solid('roundedBoxMesh', m.roundedBoxMesh([0, 0, 0, 1, 0.6, 0.4], 0.05, 2))
solid('beveledPrismMesh', m.beveledPrismMesh(m.roundedRect(0.4, 0.3, 0.04, 3), 0, 0.06, 0.008, 2))
solid('plate', m.plate(0, 0, 0.4, 0.3, 0, 0.02))
solid('panelWithHoles', m.panelWithHoles(1, 1, 0.1, [[0.25, 0.25, 0.75, 0.75]]))
solid('wallRun', m.wallRun([0, 0], [4, 0], 0.2, 0, 2.6, [[1, 2, 0, 2.1]]))
solid('hollowPrism', m.hollowPrism(m.roundedRect(0.6, 0.4, 0.05, 3), 0, 0.2, m.roundedRect(0.5, 0.3, 0.04, 3), 0.05))
solid('annularPrism', m.annularPrism(m.circle(0.3, 24), m.circle(0.2, 24), 0, 0.04, 0.006, 2))
solid('aperturedPrism', m.aperturedPrism(m.roundedRect(1, 0.6, 0.05, 3), m.roundedRect(0.4, 0.3, 0.04, 3), 0, 0.04, 0.006, 2))
solid('tubeAlong (capped)', m.tubeAlong([[0, 0, 0], [1, 0, 0], [1, 1, 0]], m.roundedRect(0.05, 0.03, 0.008, 2)))
solid('tubeAlong (mitred)', m.tubeAlong(m.densify([[0, 0, 0], [1, 0, 0], [1, 1, 0]], 0.06), m.circle(0.03, 8), { miter: true }))
solid('sweepRectFrame', m.sweepRectFrame(1, 0.8, m.roundedRect(0.04, 0.03, 0.006, 2)))
solid('sweepPlanarLoop', m.sweepPlanarLoop(m.circle(1, 16), m.roundedRect(0.06, 0.05, 0.01, 2)))
solid('runMolding (closed)', m.runMolding(m.circle(1, 12), m.roundedRect(0.05, 0.04, 0.008, 2), true, true))
solid('revolve (sphere)', m.revolve([[0, 0], [0.3, 0.15], [0.4, 0.4], [0.3, 0.65], [0, 0.8]], 16))
surface('loft (open)', m.loft([
  [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1]],
]))
surface('solidify', m.solidify(m.loft([
  [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
  [[0, 1, 0.1], [1, 1, 0.2], [2, 1, 0.1]],
]), 0.02))
surface('subsurf', m.subsurf(m.box(0, 0, 0, 1, 1, 1), 1))

// -------------------------------------------------------------- pole welding
{
  const md = m.revolve([[0, 0], [0.3, 0.4], [0, 0.8]], 24, { capStart: false, capEnd: false })
  const onAxis = md.verts.filter((v) => Math.hypot(v[0], v[1]) < 1e-9).length
  check('revolve: poles weld to ONE vertex each', onAxis === 2, `${onAxis} on-axis verts (24 segments)`)
  const e = emit(md)
  check('revolve: no NaN at the poles', e.badNrm === 0, `${e.badNrm} bad normals`)
}

// ------------------------------------------------------- degenerate dropping
{
  const ring = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
  const md = m.loft([ring, ring.map((p) => [p[0], p[1], 1]), ring.map((p) => [p[0], p[1], 1])], { closeV: true })
  m.cleanMesh(md)
  let zero = 0
  for (const f of md.faces) if (m.faceNormal(md.verts, f).every((c) => Math.abs(c) < 1e-12)) zero++
  check('cleanMesh: no zero-area faces after a collapsed ring', zero === 0, `${zero}`)
}

// --------------------------------------------------------------- orientation
{
  // A Z-up box emitted Y-up must still face outward, and its authored +Z
  // (up) must land on world +Y.
  const md = m.box(-0.5, -0.25, 0, 0.5, 0.25, 2)
  const { soup } = emit(md)
  let inward = 0
  let top = 0
  for (let t = 0; t < soup.positions.length / 9; t++) {
    const b = t * 9
    const cx = (soup.positions[b] + soup.positions[b + 3] + soup.positions[b + 6]) / 3
    const cy = (soup.positions[b + 1] + soup.positions[b + 4] + soup.positions[b + 7]) / 3
    const cz = (soup.positions[b + 2] + soup.positions[b + 5] + soup.positions[b + 8]) / 3
    const n = [soup.normals[b], soup.normals[b + 1], soup.normals[b + 2]]
    if (n[0] * cx + n[1] * (cy - 0.125) + n[2] * cz < 0) inward++
    if (cy > 1.9 && n[1] > 0.9) top++
  }
  check('emit: every face winds outward', inward === 0, `${inward} inward`)
  check('emit: authored +Z becomes world +Y', top >= 2, `${top} up-facing tris at y=2`)
}

// ---------------------------------------------------------------- the bench
{
  const built = buildParkBench()
  let parts = 0
  let tris = 0
  let bad = 0
  for (const list of Object.values(built.parts)) {
    for (const md of list) {
      parts++
      const e = emit(md)
      tris += e.tris
      bad += e.badPos + e.badNrm
    }
  }
  check('bench: two material slots', Object.keys(built.parts).length === 2)
  check('bench: 30+ parts', parts >= 30, `${parts} parts`)
  check('bench: inside the 3-10k furniture band', tris >= 2500 && tris <= 10000, `${tris} tris`)
  check('bench: no NaN', bad === 0, `${bad}`)
  check('bench: seat 430-460 mm', built.seat[2] > 0.43 && built.seat[2] < 0.46, `${built.seat[2]}`)
  console.log(`  bench: ${parts} parts, ${tris} triangles, seat ${(built.seat[2] * 1000).toFixed(0)} mm`)

  // The bench must pass its own gate. Every part is emitted as its OWN mesh
  // here so the audit can see part-vs-part joins — in game they merge into two
  // slot meshes and the same triangles are still compared.
  const root = new Group()
  let n = 0
  for (const [slot, list] of Object.entries(built.parts)) {
    for (const md of list) {
      const soup = m.toTriangles(md.clone())
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(soup.positions), 3))
      g.setAttribute('normal', new BufferAttribute(new Float32Array(soup.normals), 3))
      const mesh = new Mesh(g, new MeshBasicMaterial())
      mesh.name = `${slot}_${String(n++).padStart(2, '0')}`
      root.add(mesh)
    }
  }
  const report = auditGeometry(root, { bounds: null })
  check('bench: zero z-fight', report.zfight.length === 0, JSON.stringify(report.zfight.slice(0, 3)))
  check('bench: zero degenerate/NaN', report.defects.length === 0, JSON.stringify(report.defects.slice(0, 3)))
  check('bench: zero solid clash', report.clash.length === 0, JSON.stringify(report.clash.slice(0, 3)))
  console.log(`  bench audit: ${report.backToBack} butt joints (expected), ${report.ms} ms`)
}

// -------------------------------------------------------------- the audit
{
  const quad = (y, flip) => {
    const p = flip
      ? [0, y, 0, 0, y, 1, 1, y, 1, 0, y, 0, 1, y, 1, 1, y, 0]
      : [0, y, 0, 1, y, 1, 0, y, 1, 0, y, 0, 1, y, 0, 1, y, 1]
    const n = []
    for (let i = 0; i < 6; i++) n.push(0, flip ? -1 : 1, 0)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n), 3))
    return new Mesh(g, new MeshBasicMaterial())
  }
  const root = new Group()
  const a = quad(1, false)
  a.name = 'A'
  const b = quad(1.0005, false) // 0.5 mm apart, same facing -> z-fight
  b.name = 'B'
  const c = quad(1, true) // coincident but opposed -> butt joint
  c.name = 'C'
  root.add(a, b, c)
  const report = auditGeometry(root, { clash: false })
  check('audit: finds the planted z-fight', report.zfight.length === 1, JSON.stringify(report.zfight))
  check('audit: measures ~1 m² of it', report.zfightTotalCm2 > 9000, `${report.zfightTotalCm2} cm²`)
  check('audit: butt joints are back-to-back, not z-fight', report.backToBack >= 2, `${report.backToBack}`)

  const far = quad(1.01, false) // 10 mm apart -> nothing
  far.name = 'D'
  const clean = new Group()
  clean.add(quad(1, false), far)
  check('audit: 10 mm apart is clean', auditGeometry(clean, { clash: false }).zfight.length === 0)

  // and the clash pass is not vacuous: two solids run 60 mm into each other
  const solidMesh = (md, name) => {
    const soup = m.toTriangles(md)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(soup.positions), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(soup.normals), 3))
    const mesh = new Mesh(g, new MeshBasicMaterial())
    mesh.name = name
    return mesh
  }
  const clashed = new Group()
  clashed.add(solidMesh(m.box(0, 0, 0, 1, 1, 1), 'P'), solidMesh(m.box(0.94, 0.3, 0.3, 1.6, 0.7, 0.7), 'Q'))
  const cr = auditGeometry(clashed, { bounds: null })
  check('audit: finds a 60 mm interpenetration', cr.clash.length === 1, JSON.stringify(cr.clash))
  const touching = new Group()
  touching.add(solidMesh(m.box(0, 0, 0, 1, 1, 1), 'P'), solidMesh(m.box(1, 0.3, 0.3, 1.6, 0.7, 0.7), 'Q'))
  check('audit: a butted pair is not a clash', auditGeometry(touching, { bounds: null }).clash.length === 0)
}

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
