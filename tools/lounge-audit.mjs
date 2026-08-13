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
const leisure = await import('../src/world/districts/leisure.ts')
const lounge = await import('../src/world/districts/loungeInterior.ts')

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

console.log(failures === 0 ? '\nlounge audit PASS' : `\nlounge audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
