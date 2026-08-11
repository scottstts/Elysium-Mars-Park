/**
 * Headless gate for the Portal Station rebuild: builds the station into a bare
 * PartWriter, audits it, and measures flushness / headroom / egress / screen
 * openings against the analytic ground datums.
 *
 *   node --experimental-strip-types scratchpad/station-check.mjs
 */
import { registerHooks } from 'node:module'
import { MeshBasicMaterial, Raycaster, Vector3 } from 'three'

registerHooks({
  resolve(s, c, n) {
    if (s.startsWith('.') && !/\.\w+$/.test(s)) {
      try {
        return n(s + '.ts', c)
      } catch {
        /* fall */
      }
    }
    return n(s, c)
  },
})
globalThis.document = { createElement: () => ({ getContext: () => null }) }

const { PartWriter } = await import('../src/archkit/writer.ts')
const { auditGeometry } = await import('../src/archkit/audit.ts')
const track = await import('../src/tram/track.ts')
const A = await import('../src/world/stationArchitecture.ts')
const { slabTop } = await import('../src/world/paving.ts')
const pp = await import('../src/world/pavingPlan.ts')
const { LOOP, PORTAL_STATION } = await import('../src/world/parkPlan.ts')

const f = (n) => (n >= 0 ? ' ' : '') + n.toFixed(3)
const spec = {
  centreAngle: Math.PI / 2,
  arcLength: A.DECK_ARC,
  rEdge: LOOP.radius - track.PLATFORM_EDGE_OFFSET,
  depth: A.DECK_DEPTH,
  deckY: track.carFloorY(PORTAL_STATION.x, PORTAL_STATION.z) - 0.02,
  baseY: slabTop(PORTAL_STATION.x, PORTAL_STATION.z),
}
const P = (u, v, y = 0) => track.platformPoint(spec, u, v, y)
const D = (u) => track.platformDeckY(spec, u)

const writer = new PartWriter()
A.emitDeckSlab(writer, spec)
track.emitPlatformEdge(writer, spec)
A.glazedCanopy(writer, spec)
A.buildWindbreak(writer, spec)
const grand = A.planGrandFlight(spec)
A.buildFlight(writer, grand)
A.flightApron(writer, grand, 1.6)
const ends = [A.planEndFlight(spec, -1), A.planEndFlight(spec, 1)]
for (const plan of ends) {
  A.buildFlight(writer, plan)
  A.flightApron(writer, plan, 2.2)
}
const ramp = A.planRamp(spec)
A.buildRamp(writer, spec, ramp)
for (const u of [-8.4, 3.4]) track.litterBin(writer, P(u, 5.6, D(u)))
for (const u of [-5, 5]) track.leaningRail(writer, spec, u, 1.5)

const materials = new Proxy({}, { get: () => new MeshBasicMaterial() })
const root = writer.build(materials)
const meshes = []
root.traverse((o) => {
  if (o.isMesh && !o.isSprite) meshes.push(o)
})
root.updateMatrixWorld(true)
console.log(`built ${meshes.length} slot meshes, ${writer.triangleCount?.() ?? '?'} tris`)

const rc = new Raycaster()
rc.firstHitOnly = false
const hits = (origin, dir, far) => {
  rc.set(origin, dir.clone().normalize())
  rc.far = far
  rc.near = 0
  return rc.intersectObjects(meshes, false)
}
const surfaceAt = (x, z) => {
  const h = hits(new Vector3(x, 60, z), new Vector3(0, -1, 0), 120)
  return h.length ? 60 - h[0].distance : null
}

let fails = 0
const check = (ok, label, detail) => {
  if (!ok) fails++
  console.log(`${ok ? '  ok ' : 'FAIL'} ${label}  ${detail}`)
}

// ---------------------------------------------------------------- audit ----
const report = auditGeometry(root)
console.log(
  `\naudit: zfight=${report.zfight?.length ?? '?'} clash=${report.clash?.length ?? '?'} degenerate=${report.degenerate ?? '?'}`,
)
if (report.zfight?.length) {
  for (const z of report.zfight.slice(0, 8)) console.log('   ', JSON.stringify(z))
}

// ------------------------------------------------------------- flushness ---
console.log('\n=== A. flush heads (threshold top vs deck) ===')
for (const [name, plan, uHead] of [
  ['grand', grand, 0],
  ['end -1', ends[0], -(A.DECK_ARC / 2 + 0.06)],
  ['end +1', ends[1], A.DECK_ARC / 2 + 0.06],
]) {
  for (const s of [-0.45, 0, 0.45]) {
    const p = plan.foot
      .clone()
      .addScaledVector(plan.climb, plan.steps * plan.run + 0.02)
      .addScaledVector(plan.across, s * plan.width)
    const top = plan.foot.y + plan.steps * plan.rise + 0.015
    const deck = D(uHead + s * (name === 'grand' ? -plan.width : 0))
    check(
      Math.abs(top - deck) <= 0.02,
      `${name} head s=${s}`,
      `threshold=${f(top)} deck=${f(deck)} d=${f(top - deck)}  @(${f(p.x)},${f(p.z)})`,
    )
  }
}

console.log('\n=== A. flush feet (bottom tread vs surface at the foot) ===')
for (const [name, plan] of [
  ['grand', grand],
  ['end -1', ends[0]],
  ['end +1', ends[1]],
]) {
  for (const s of [-0.42, 0, 0.42]) {
    const p = plan.foot.clone().addScaledVector(plan.across, s * plan.width)
    const q = p.clone().addScaledVector(plan.climb, -0.12)
    const built = surfaceAt(q.x, q.z)
    const ground = A.groundY(q.x, q.z)
    const surface = built !== null ? Math.max(built, ground) : ground
    check(
      Math.abs(plan.foot.y - surface) <= 0.02,
      `${name} foot s=${s}`,
      `tread=${f(plan.foot.y)} surface=${f(surface)} (apron=${built === null ? '-' : f(built)} ground=${f(ground)}) d=${f(plan.foot.y - surface)}`,
    )
  }
}
{
  const s0 = ramp.foot.clone().addScaledVector(ramp.dir, -0.1)
  for (const s of [-1, 0, 1]) {
    const q = s0.clone().addScaledVector(ramp.across, s * A.RAMP.half * 0.85)
    const built = surfaceAt(q.x, q.z)
    const ground = A.groundY(q.x, q.z)
    const surface = built !== null ? Math.max(built, ground) : ground
    check(
      Math.abs(ramp.foot.y - surface) <= 0.03,
      `ramp foot s=${s}`,
      `deck=${f(ramp.foot.y)} surface=${f(surface)} d=${f(ramp.foot.y - surface)}`,
    )
  }
  check(ramp.grade <= 0.125, 'ramp grade', `${f(ramp.grade)} = 1:${(1 / ramp.grade).toFixed(2)} over ${f(ramp.length)} m`)
  check(
    Math.abs(ramp.head.y - D((A.RAMP_OPENING.u0 + A.RAMP_OPENING.u1) / 2)) < 1e-6,
    'ramp head flush',
    `head=${f(ramp.head.y)} deck=${f(D((A.RAMP_OPENING.u0 + A.RAMP_OPENING.u1) / 2))}`,
  )
}

// ------------------------------------------------------------- headroom ----
console.log('\n=== B. headroom (≥2.30 above the walk line) ===')
const headroomAt = (p, walk, label) => {
  const origin = new Vector3(p.x, walk + 0.12, p.z)
  const h = hits(origin, new Vector3(0, 1, 0), 2.3 - 0.12)
  const clear = h.length ? 0.12 + h[0].distance : 2.3
  if (clear < 2.3) check(false, `headroom ${label}`, `${f(clear)} at (${f(p.x)},${f(p.z)}) hit=${h[0].object.name}`)
  return clear
}
let worst = { clear: 99, label: '' }
const sampleRoute = (label, from, to, count, walkFn) => {
  let lo = 99
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const p = from.clone().lerp(to, t)
    const c = headroomAt(p, walkFn(t), `${label} t=${t.toFixed(2)}`)
    if (c < lo) lo = c
  }
  if (lo < worst.clear) worst = { clear: lo, label }
  console.log(`  ${label}: min ${f(lo)}`)
}
// deck walk line, front / mid / back, along the arc
for (const v of [1.1, 2.4, 4.9]) {
  let lo = 99
  for (let i = 0; i <= 44; i++) {
    const u = -9 + (18 * i) / 44
    const c = headroomAt(P(u, v), D(u), `deck v=${v} u=${u.toFixed(1)}`)
    if (c < lo) lo = c
  }
  console.log(`  deck v=${v}: min ${f(lo)}`)
  if (lo < worst.clear) worst = { clear: lo, label: `deck v=${v}` }
}
for (const [name, plan] of [
  ['grand', grand],
  ['end -1', ends[0]],
  ['end +1', ends[1]],
]) {
  const n = Math.ceil((plan.steps * plan.run + 3) / 0.4)
  sampleRoute(
    `${name} flight`,
    plan.foot.clone().addScaledVector(plan.climb, -1.5),
    plan.foot.clone().addScaledVector(plan.climb, plan.steps * plan.run + 1.5),
    n,
    (t) => {
      // TREAD level, not the pitch line: a ray started on the pitch line is
      // below the next nosing and reports the stair itself as low headroom.
      const along = -1.5 + t * (plan.steps * plan.run + 3)
      if (along <= -0.04) return plan.foot.y
      const step = Math.min(plan.steps, Math.max(1, Math.ceil((along + 0.04) / plan.run)))
      return plan.foot.y + step * plan.rise
    },
  )
}
sampleRoute(
  'ramp run',
  ramp.head.clone(),
  ramp.foot.clone().addScaledVector(ramp.dir, 1.5),
  Math.ceil((ramp.length + 1.5) / 0.4),
  (t) => {
    const along = t * (ramp.length + 1.5)
    return ramp.head.y - Math.min(along, ramp.length) * ramp.grade
  },
)
{
  const uc = (A.RAMP_OPENING.u0 + A.RAMP_OPENING.u1) / 2
  sampleRoute('ramp landing', P(uc, A.DECK_DEPTH - 1.5), P(uc, A.RAMP.landingV), 8, () => D(uc))
}
console.log(`  WORST headroom: ${f(worst.clear)} (${worst.label})`)

// ----------------------------------------------- screen openings + egress --
console.log('\n=== C. screen openings clear ===')
// The ramp's opening is measured between the KERB inner faces — the kerbs are
// part of the step-free route, not an obstruction in it.
// The ramp's own kerbs (0.98 from its centreline) and handrails (0.91) are
// REQUIRED parts of the step-free route, so the span that must be clear of
// screen is the one between its handrails.
const rampInset = A.RAMP.half - 0.91 + 0.05
const openings = [
  ['grand', A.GRAND_OPENING, 0.09],
  ['ramp', A.RAMP_OPENING, rampInset],
]
for (const [name, o, inset] of openings) {
  let blocked = 0
  // Inset past the jamb POST (0.13 wide, centred on the nominal jamb), so the
  // span measured is the CLEAR opening between faces.
  for (let i = 0; i <= 20; i++) {
    const u = o.u0 + inset + ((o.u1 - o.u0 - 2 * inset) * i) / 20
    for (let k = 0; k <= 8; k++) {
      const y = D(u) + 0.1 + (2.1 * k) / 8
      const a = P(u, 4.6, y)
      const b = P(u, 8.0, y)
      const dir = new Vector3().subVectors(b, a)
      const h = hits(a, dir, dir.length())
      if (h.length) {
        blocked++
        if (blocked < 4) console.log(`      hit ${h[0].object.name} u=${u.toFixed(2)} y=+${(y - D(u)).toFixed(2)}`)
      }
    }
  }
  check(blocked === 0, `${name} opening (${(o.u1 - o.u0 - 2 * inset).toFixed(2)} m clear)`, `${blocked} blocked samples`)
}

console.log('\n=== D. egress 1.5 m past every foot / head ===')
const egress = (label, origin, dir, across, halfWidth, walkY) => {
  let blocked = 0
  for (const s of [-0.9, -0.45, 0, 0.45, 0.9]) {
    const base = origin.clone().addScaledVector(across, s * halfWidth)
    for (const lift of [0.3, 0.9, 1.5, 2.1]) {
      const a = base.clone().setY(walkY + lift)
      const h = hits(a, dir, 1.5)
      if (h.length) {
        blocked++
        if (blocked < 4) console.log(`      hit ${h[0].object.name} @${h[0].distance.toFixed(2)} m s=${s} lift=${lift}`)
      }
    }
  }
  // planters, which are not part of this build
  let planter = 0
  for (const s of [-1, 0, 1]) {
    for (let i = 1; i <= 6; i++) {
      const p = origin
        .clone()
        .addScaledVector(across, s * halfWidth)
        .addScaledVector(dir, (1.5 * i) / 6)
      if (pp.insidePlanter(p.x, p.z, 0)) planter++
    }
  }
  check(blocked === 0 && planter === 0, `egress ${label}`, `${blocked} structure hits, ${planter} planter samples`)
}
for (const [name, plan] of [
  ['grand', grand],
  ['end -1', ends[0]],
  ['end +1', ends[1]],
]) {
  const down = plan.climb.clone().negate()
  egress(`${name} foot`, plan.foot.clone().addScaledVector(down, 0.05), down, plan.across, plan.width / 2, plan.foot.y)
  const head = plan.foot
    .clone()
    .addScaledVector(plan.climb, plan.steps * plan.run + 0.15)
    .setY(plan.foot.y + plan.steps * plan.rise)
  egress(`${name} head`, head, plan.climb, plan.across, plan.width / 2, head.y)
}
egress('ramp foot', ramp.foot.clone().addScaledVector(ramp.dir, 0.05), ramp.dir, ramp.across, A.RAMP.half, ramp.foot.y)
{
  const uc = (A.RAMP_OPENING.u0 + A.RAMP_OPENING.u1) / 2
  const out = track.platformOutward(spec, uc)
  egress('ramp head', P(uc, A.DECK_DEPTH - 0.1, D(uc)), out, track.platformTangent(spec, uc), A.RAMP.half, D(uc))
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`)
