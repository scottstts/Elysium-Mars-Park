/**
 * Headless plausibility gate for the Overlook Lounge (shell + fit-out).
 *
 *   node --experimental-strip-types tools/lounge-audit.mjs
 *
 * Records every `PartWriter` call the drum makes into its own throwaway writer
 * so each part keeps its own bounding box, then asks two questions the geometry
 * audit cannot:
 *
 *  - **Is anything FLOATING?** A part whose inflated box touches no other part
 *    and no ground plane is, by construction, attached to nothing. This is what
 *    caught the curtain-wall transoms running radially instead of tangentially.
 *  - **Is the entrance clear?** Sweeps a walking capsule from the door along
 *    its inward normal and reports the first part it meets.
 */
import { registerHooks } from 'node:module'
import { Box3, Group, Vector3 } from 'three'

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

const stubCtx = new Proxy({}, { get: () => () => ({ width: 10 }) })
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
}
globalThis.window = globalThis

const { PartWriter } = await import('../src/archkit/writer.ts')
const { Rng } = await import('../src/core/prng.ts')
const { AMPHITHEATER_STAGE_SCALE } = await import('../src/world/districts/amphitheaterStage.ts')
const leisure = await import('../src/world/districts/leisure.ts')
const lounge = await import('../src/world/districts/loungeInterior.ts')
const { AMPHITHEATER, PADS } = await import('../src/world/parkPlan.ts')

const shell = leisure.loungeShell()
const MATERIALS = new Proxy({}, { get: () => ({ isMaterial: true }) })

const records = []
function trackingWriter() {
  const base = new PartWriter()
  return new Proxy(base, {
    get(target, prop) {
      const value = target[prop]
      if (typeof value !== 'function' || prop === 'build') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args) => {
        const probe = new PartWriter()
        probe[prop](...args)
        const slot = typeof args[0] === 'string' ? args[0] : (args[0]?.slot ?? '?')
        const box = new Box3()
        for (const child of probe.build(MATERIALS).children) {
          child.geometry.computeBoundingBox()
          box.union(child.geometry.boundingBox)
        }
        if (!box.isEmpty()) records.push({ i: records.length, op: String(prop), slot, box })
        return target[prop](...args)
      }
    },
  })
}

const services = {
  writer: trackingWriter(),
  group: new Group(),
  rng: new Rng(1234),
  colliders: [],
  seats: [],
  interactables: [],
  doors: [],
}
leisure.buildLeisure(services)
lounge.buildLoungeInterior(services)

// Only the drum: everything whose box centre is inside the lounge footprint.
const centre = new Vector3()
const size = new Vector3()
const drum = records.filter((r) => {
  r.box.getCenter(centre)
  const dx = (centre.x - shell.x) / (shell.ax + 3.5)
  const dz = (centre.z - shell.z) / (shell.az + 3.5)
  return dx * dx + dz * dz <= 1 && centre.y > shell.apron - 1 && centre.y < shell.roofTop + 6
})

let failures = 0

// ---- 1. curtain-wall transoms run TANGENTIALLY -----------------------------
{
  const bad = []
  for (let b = 0; b < shell.bays; b++) {
    if (b === shell.doorBay) continue
    const s = shell.stations[b]
    const n = shell.stations[(b + 1) % shell.bays]
    const mx = (s.x + n.x) / 2
    const mz = (s.z + n.z) / 2
    const width = Math.hypot(n.x - s.x, n.z - s.z)
    const tx = (n.x - s.x) / width
    const tz = (n.z - s.z) / width
    for (const level of [shell.apron + 1.94, shell.apron + 5.3]) {
      const hit = drum.find((r) => {
        r.box.getCenter(centre)
        return (
          Math.hypot(centre.x - mx, centre.z - mz) < 0.35 && Math.abs(centre.y - level) < 0.06
        )
      })
      if (!hit) {
        bad.push(`bay ${b} @ ${level.toFixed(2)}: no transom found`)
        continue
      }
      hit.box.getSize(size)
      // A tangential bar's plan box matches |t| × its length; a radial one has
      // the two swapped.
      const wantX = Math.abs(tx) * (width - 0.104)
      const wantZ = Math.abs(tz) * (width - 0.104)
      if (Math.abs(size.x - wantX) > 0.3 || Math.abs(size.z - wantZ) > 0.3) {
        bad.push(
          `bay ${b} @ ${level.toFixed(2)}: plan ${size.x.toFixed(2)}×${size.z.toFixed(2)}, ` +
            `tangential would be ${wantX.toFixed(2)}×${wantZ.toFixed(2)}`,
        )
      }
    }
  }
  console.log(`transoms         ${bad.length === 0 ? 'OK' : `FAIL (${bad.length})`}`)
  for (const line of bad.slice(0, 6)) console.log('   ', line)
  failures += bad.length
}

// ---- 2. nothing floats -----------------------------------------------------
{
  const GRACE = 0.04
  const boxes = drum.map((r) => r.box.clone().expandByScalar(GRACE / 2))
  const floating = []
  for (let i = 0; i < drum.length; i++) {
    drum[i].box.getCenter(centre)
    drum[i].box.getSize(size)
    // Anything reaching the apron, a floor or the roof is grounded by definition.
    const low = drum[i].box.min.y
    const grounded = [shell.apron, shell.floor, shell.mezzTop, shell.roofTop].some(
      (level) => low < level + 0.05,
    )
    if (grounded) continue
    let touches = false
    for (let j = 0; j < drum.length && !touches; j++) {
      if (i === j) continue
      if (boxes[i].intersectsBox(boxes[j])) touches = true
    }
    if (!touches) {
      floating.push(
        `#${drum[i].i} ${drum[i].op} ${drum[i].slot} at (${(centre.x - shell.x).toFixed(2)}, ` +
          `${(centre.y - shell.apron).toFixed(2)}, ${(centre.z - shell.z).toFixed(2)}) ` +
          `size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`,
      )
    }
  }
  console.log(
    `floating parts   ${floating.length === 0 ? `OK (${drum.length} parts, ` +
      `${boxes.length} boxes tested)` : `FAIL (${floating.length})`}`,
  )
  for (const line of floating.slice(0, 20)) console.log('   ', line)
  failures += floating.length
}

// ---- 3. the entrance is walkable -------------------------------------------
{
  const door = services.doors[0]
  const start = shell.stations[shell.doorBay]
  const end = shell.stations[(shell.doorBay + 1) % shell.bays]
  const nx = start.nx + end.nx
  const nz = start.nz + end.nz
  const nl = Math.hypot(nx, nz)
  const inward = [-nx / nl, -nz / nl]
  const RADIUS = 0.41 // player capsule + controller offset
  const obstacles = drum.filter((r) => {
    if (r.box.min.y > shell.floor + 1.95 || r.box.max.y < shell.floor + 0.1) return false
    r.box.getSize(size)
    // Drum-wide rings (base band, ring beams, floor topping) have a plan box
    // the size of the whole ellipse; an AABB says nothing about them.
    return !(size.x > 6 && size.z > 6)
  })
  const hitAt = (px, pz) =>
    obstacles.find(
      (r) =>
        Math.hypot(
          Math.max(r.box.min.x - px, 0, px - r.box.max.x),
          Math.max(r.box.min.z - pz, 0, pz - r.box.max.z),
        ) < RADIUS,
    )
  const walk = (ox, oz, dx, dz, limit) => {
    for (let d = 0.2; d <= limit; d += 0.05) {
      const hit = hitAt(ox + dx * d, oz + dz * d)
      if (hit) return { d, hit }
    }
    return { d: limit, hit: null }
  }
  // Straight in from the threshold, then the lateral run at 1.1 m in — a
  // compact drum is entered and turned into, so the contract is a clear
  // threshold plus a corridor, not an infinite straight.
  const THRESHOLD = 1.2
  const CORRIDOR = 0.9
  const ahead = walk(door.closedPosition.x, door.closedPosition.z, inward[0], inward[1], 2.4)
  const pivotX = door.closedPosition.x + inward[0] * 1.1
  const pivotZ = door.closedPosition.z + inward[1] * 1.1
  const left = walk(pivotX, pivotZ, -inward[1], inward[0], 3)
  const right = walk(pivotX, pivotZ, inward[1], -inward[0], 3)
  const problems = []
  if (ahead.d < THRESHOLD) {
    ahead.hit.box.getCenter(centre)
    problems.push(
      `threshold blocked at ${ahead.d.toFixed(2)} m by #${ahead.hit.i} ${ahead.hit.slot} ` +
        `(${(centre.x - shell.x).toFixed(2)}, ${(centre.z - shell.z).toFixed(2)})`,
    )
  }
  if (Math.max(left.d, right.d) < CORRIDOR) {
    problems.push(
      `no corridor off the threshold: left ${left.d.toFixed(2)} m, right ${right.d.toFixed(2)} m`,
    )
  }
  console.log(
    `entrance         ${problems.length === 0 ? `OK (${ahead.d.toFixed(2)} m ahead, ` +
      `${left.d.toFixed(2)}/${right.d.toFixed(2)} m corridor)` : 'FAIL'}`,
  )
  for (const line of problems) console.log('   ', line)
  failures += problems.length
}

// ---- 4. all three storeys are actually reachable ---------------------------
//
// The drum is a three-level building and the owner can now visit all of it, so
// the stairs are a CONTRACT, not decoration. Everything below is checked
// against the collider set the physics world is built from, not the geometry:
// the geometry was always right, the colliders were a solid box over the whole
// flight (owner report: "player cannot go up the stairs inside").
{
  const CAPSULE_R = 0.35
  const CAPSULE_TOP = 1.8
  const AUTOSTEP = 0.42
  const boxes = services.colliders
    .filter((c) => c.kind === 'box')
    .map((c) => ({
      c: c.center,
      h: { x: c.size.x / 2, y: c.size.y / 2, z: c.size.z / 2 },
      yaw: c.yaw ?? 0,
    }))

  /**
   * Highest collider top under (x, z) within the capsule's radius. The ground
   * floor itself is the park's heightfield, not a collider spec, so it enters
   * as a plane at the finished floor level.
   */
  const support = (x, z, below) => {
    let best = shell.floor <= below + 0.02 ? shell.floor : -Infinity
    for (const b of boxes) {
      const dx = x - b.c.x
      const dz = z - b.c.z
      const cos = Math.cos(b.yaw)
      const sin = Math.sin(b.yaw)
      // ColliderSpec.yaw rotates the box by +yaw about Y, so undo it.
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      if (Math.abs(lx) > b.h.x + CAPSULE_R || Math.abs(lz) > b.h.z + CAPSULE_R) continue
      const top = b.c.y + b.h.y
      if (top <= below + 0.02 && top > best) best = top
    }
    return best
  }

  /** Is the capsule standing at (x, z, floor) clear of every collider? */
  const blocked = (x, z, floor) => {
    for (const b of boxes) {
      const dx = x - b.c.x
      const dz = z - b.c.z
      const cos = Math.cos(b.yaw)
      const sin = Math.sin(b.yaw)
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      if (Math.abs(lx) > b.h.x + CAPSULE_R * 0.7 || Math.abs(lz) > b.h.z + CAPSULE_R * 0.7) continue
      const top = b.c.y + b.h.y
      const bottom = b.c.y - b.h.y
      // A collider whose top is within one autostep of the feet is a STEP, not
      // a wall — that is exactly what the controller does with it.
      if (top < floor + AUTOSTEP) continue
      if (bottom < floor + CAPSULE_TOP && top > floor + 0.02) return b
    }
    return null
  }

  const problems = []
  const climb = (label, from, to, samples) => {
    let floor = from.y
    let lastGap = 0
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const x = from.x + (to.x - from.x) * t
      const z = from.z + (to.z - from.z) * t
      const top = support(x, z, floor + AUTOSTEP)
      if (top === -Infinity) {
        problems.push(`${label}: no floor at ${(t * 100).toFixed(0)}% of the run`)
        return null
      }
      lastGap = Math.max(lastGap, top - floor)
      if (top - floor > AUTOSTEP) {
        problems.push(
          `${label}: ${(top - floor).toFixed(3)} m step at ${(t * 100).toFixed(0)}% ` +
            `(autostep is ${AUTOSTEP})`,
        )
        return null
      }
      floor = top
      const hit = blocked(x, z, floor)
      if (hit) {
        problems.push(
          `${label}: blocked at ${(t * 100).toFixed(0)}% (floor ${(floor - shell.apron).toFixed(2)}) ` +
            `by a box at (${(hit.c.x - shell.x).toFixed(2)}, ${(hit.c.y - shell.apron).toFixed(2)}, ` +
            `${(hit.c.z - shell.z).toFixed(2)}) size ` +
            `${(hit.h.x * 2).toFixed(2)}×${(hit.h.y * 2).toFixed(2)}×${(hit.h.z * 2).toFixed(2)}`,
        )
        return null
      }
    }
    return { floor, rise: lastGap }
  }

  const ux = (u) => shell.x + u
  const vz = (v) => shell.z + v
  const opening = shell.roofOpening
  const flightA = climb(
    'flight 1 (floor → mezzanine)',
    new Vector3(ux(2.6), shell.floor, vz(4.2)),
    new Vector3(ux(2.6), shell.mezzTop, vz(-2.9)),
    70,
  )
  const flightB = climb(
    'flight 2 (mezzanine → roof)',
    new Vector3(ux((opening.u0 + opening.u1) / 2), shell.mezzTop, vz(opening.v1 - 19 * 0.29 - 0.5)),
    new Vector3(ux((opening.u0 + opening.u1) / 2), shell.roofTop, vz(opening.v1 + 1.4)),
    80,
  )
  if (flightA && Math.abs(flightA.floor - shell.mezzTop) > 0.02) {
    problems.push(`flight 1 lands at ${(flightA.floor - shell.apron).toFixed(3)}, not the mezzanine`)
  }
  if (flightB && Math.abs(flightB.floor - shell.roofTop) > 0.02) {
    problems.push(`flight 2 lands at ${(flightB.floor - shell.apron).toFixed(3)}, not the roof`)
  }

  // Headroom over both flights, against the geometry (colliders have no soffit).
  for (const [label, u0, v0, u1, v1, y0, y1, steps] of [
    ['flight 2', (opening.u0 + opening.u1) / 2, opening.v1 - 19 * 0.29, (opening.u0 + opening.u1) / 2, opening.v1, shell.mezzTop, shell.roofTop, 19],
  ]) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = ux(u0 + (u1 - u0) * t)
      const z = vz(v0 + (v1 - v0) * t)
      const head = y0 + (y1 - y0) * t + CAPSULE_TOP
      // The roof slab is the only soffit over these flights.
      const inWell =
        x - shell.x > opening.u0 && x - shell.x < opening.u1 &&
        z - shell.z > opening.v0 && z - shell.z < opening.v1
      if (!inWell && head > shell.head) {
        problems.push(
          `${label}: head at ${(head - shell.apron).toFixed(2)} m is inside the roof slab ` +
            `(soffit ${(shell.head - shell.apron).toFixed(2)}) at ${(t * 100).toFixed(0)}% of the run`,
        )
        break
      }
    }
  }

  // Both upper storeys must be enclosed: a floor you can reach needs a wall.
  for (const [label, level] of [
    ['mezzanine', shell.mezzTop],
    ['roof terrace', shell.roofTop],
  ]) {
    for (let b = 0; b < shell.bays; b++) {
      const s = shell.stations[b]
      const guard = boxes.some(
        (box) =>
          Math.hypot(box.c.x - s.x, box.c.z - s.z) < 1.6 &&
          box.c.y + box.h.y > level + 0.9 &&
          box.c.y - box.h.y < level + 0.3,
      )
      if (!guard) {
        problems.push(`${label}: no guard at bay ${b}`)
        break
      }
    }
  }

  console.log(
    `storeys          ${problems.length === 0 ? `OK (${boxes.length} colliders; ` +
      `flight 1 rise ${flightA ? flightA.rise.toFixed(3) : '?'}, ` +
      `flight 2 rise ${flightB ? flightB.rise.toFixed(3) : '?'})` : `FAIL (${problems.length})`}`,
  )
  for (const line of problems.slice(0, 8)) console.log('   ', line)
  failures += problems.length
}

// ---- 5. Bowl shell collision follows the rear arc -------------------------
//
// The acoustic shell used to own one broad box at the arc ORIGIN. That box
// crossed the usable stage behind the lectern, while the visible shell stood
// several metres aft on the circumference. Regress both sides of the contract:
// the former stripe is traversable and the rear shell itself still blocks.
{
  const stage = PADS.find((pad) => pad.id === 'amphitheater')
  const sx = stage?.x ?? -64
  const sz = stage?.z ?? 39
  const sy = stage?.y ?? -1.8
  const facing = Math.atan2(AMPHITHEATER.z - sz, AMPHITHEATER.x - sx)
  const cos = Math.cos(facing)
  const sin = Math.sin(facing)
  const local = (forward, lateral) => ({
    x: sx + cos * forward - sin * lateral,
    z: sz + sin * forward + cos * lateral,
  })
  const deckTop = sy + 1.05
  const boxes = services.colliders.filter((collider) => collider.kind === 'box')
  const overlapsStandingCapsule = (collider, point, radius = 0.35) => {
    const top = collider.center.y + collider.size.y / 2
    const bottom = collider.center.y - collider.size.y / 2
    if (top <= deckTop + 0.42 || bottom >= deckTop + 1.8) return false
    const dx = point.x - collider.center.x
    const dz = point.z - collider.center.z
    const yaw = collider.yaw ?? 0
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw)
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw)
    return Math.abs(lx) <= collider.size.x / 2 + radius && Math.abs(lz) <= collider.size.z / 2 + radius
  }

  const oldStripeForward = 1.4 * AMPHITHEATER_STAGE_SCALE
  const blockedSamples = []
  for (let lateral = -8; lateral <= 8; lateral += 0.25) {
    const point = local(oldStripeForward, lateral)
    if (boxes.some((collider) => overlapsStandingCapsule(collider, point))) {
      blockedSamples.push(lateral)
    }
  }

  const shellRadius = 7.4 * AMPHITHEATER_STAGE_SCALE
  const rearShellPoint = local(oldStripeForward - shellRadius, 0)
  const rearShellBlocks = boxes.some((collider) => overlapsStandingCapsule(collider, rearShellPoint, 0.05))
  const problems = []
  if (blockedSamples.length > 0) {
    problems.push(
      `former front stripe still blocks ${blockedSamples.length}/65 samples ` +
        `(${Math.min(...blockedSamples).toFixed(2)}…${Math.max(...blockedSamples).toFixed(2)} m lateral)`,
    )
  }
  if (!rearShellBlocks) problems.push('rear acoustic shell has no collision at its centre arc')

  console.log(
    `bowl shell        ${problems.length === 0 ? 'OK (front clear, rear arc blocked)' : `FAIL (${problems.length})`}`,
  )
  for (const line of problems) console.log('   ', line)
  failures += problems.length
}

console.log(failures === 0 ? '\nlounge audit PASS' : `\nlounge audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
