/**
 * Headless layout gate for the farm quarter.
 *
 *   node --experimental-strip-types tools/farm-layout-audit.mjs
 *
 * The hydroponics tower and the three glasshouse ranges are authored by two
 * different files from two different anchors in `parkPlan`, so nothing in
 * either of them can notice when their footprints start to share ground. At
 * (52, 18) they did: the tower's 7.24 m plinth ate 6.7 m of the +22 range and
 * its external spiral stair stood entirely inside that house.
 *
 * This builds both districts for real and compares every PART's bounding box,
 * then checks the tower's assembly against the farm lane's walking corridor.
 */
import { registerHooks } from 'node:module'
import { Box3, Vector3 } from 'three'

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

const { Group } = await import('three')
const { PartWriter } = await import('../src/archkit/writer.ts')
const { Rng } = await import('../src/core/prng.ts')
const plan = await import('../src/world/parkPlan.ts')
const farmside = await import('../src/world/districts/farmside.ts')
const hydro = await import('../src/world/districts/hydroTower.ts')

const MATERIALS = new Proxy({}, { get: () => ({ isMaterial: true }) })

/**
 * Build a district, recording one bounding box per writer call plus a
 * decimated plan-space point cloud. Boxes localise an overlap; the CLOUD is
 * what the lane check needs, because a round plinth's axis-aligned box has
 * corners 41 % further out than any of its geometry.
 */
function collect(build) {
  const boxes = []
  const cloud = []
  const base = new PartWriter()
  const writer = new Proxy(base, {
    get(target, prop) {
      const value = target[prop]
      if (typeof value !== 'function' || prop === 'build') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args) => {
        const probe = new PartWriter()
        probe[prop](...args)
        const box = new Box3()
        for (const child of probe.build(MATERIALS).children) {
          child.geometry.computeBoundingBox()
          box.union(child.geometry.boundingBox)
          const position = child.geometry.getAttribute('position')
          for (let i = 0; i < position.count; i += 3) {
            cloud.push(position.getX(i), position.getZ(i))
          }
        }
        if (!box.isEmpty()) boxes.push(box)
        return target[prop](...args)
      }
    },
  })
  const services = {
    writer,
    group: new Group(),
    rng: new Rng(4242),
    colliders: [],
    seats: [],
    interactables: [],
    doors: [],
  }
  build(services)
  return { boxes, cloud }
}

const house = collect(farmside.buildFarmside)
const tower = collect(hydro.buildHydroTower)
const houseBoxes = house.boxes
const towerBoxes = tower.boxes

// Only the glasshouse ranges themselves matter for this check: their footprints
// are the three FARMSIDE rectangles, so filter the district down to parts
// standing inside one.
const ranges = plan.FARMSIDE.glasshouses.map((house) => ({
  x0: house.x - house.length / 2,
  x1: house.x + house.length / 2,
  z0: house.z - house.width / 2,
  z1: house.z + house.width / 2,
}))
const centre = new Vector3()
const inRange = houseBoxes.filter((box) => {
  box.getCenter(centre)
  return ranges.some((r) => centre.x > r.x0 && centre.x < r.x1 && centre.z > r.z0 && centre.z < r.z1)
})

let worst = null
let hits = 0
for (const a of towerBoxes) {
  for (const b of inRange) {
    if (!a.intersectsBox(b)) continue
    hits++
    const overlap = Math.min(
      Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
      Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
    )
    if (!worst || overlap > worst.overlap) {
      a.getCenter(centre)
      worst = { overlap, at: centre.clone() }
    }
  }
}

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${label.padEnd(30)} ${ok ? 'OK  ' : 'FAIL'} ${detail ?? ''}`)
  if (!ok) failures++
}

console.log(
  `tower at (${plan.HYDRO_TOWER.x}, ${plan.HYDRO_TOWER.z}) · ${towerBoxes.length} parts ` +
    `vs ${inRange.length} glasshouse parts`,
)
check(
  'tower clears the ranges',
  hits === 0,
  hits === 0
    ? 'no part boxes intersect'
    : `${hits} intersecting parts, worst ${worst.overlap.toFixed(2)} m at ` +
      `(${worst.at.x.toFixed(1)}, ${worst.at.z.toFixed(1)})`,
)

// Plan-distance from the tower assembly to the nearest range and to the lane.
const lane = plan.PATHS.find((p) => p.id === 'farm-lane')
const segDistance = (px, pz) => {
  let best = Infinity
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1]
    const b = lane.points[i]
    const vx = b.x - a.x
    const vz = b.y - a.y
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.y) * vz) / (vx * vx + vz * vz)))
    best = Math.min(best, Math.hypot(px - (a.x + t * vx), pz - (a.y + t * vz)))
  }
  return best
}
let nearestRange = Infinity
let nearestLane = Infinity
for (let i = 0; i < tower.cloud.length; i += 2) {
  const px = tower.cloud[i]
  const pz = tower.cloud[i + 1]
  for (const r of ranges) {
    nearestRange = Math.min(
      nearestRange,
      Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.z0 - pz, 0, pz - r.z1)),
    )
  }
  nearestLane = Math.min(nearestLane, segDistance(px, pz))
}
check('range clearance', nearestRange > 1.0, `${nearestRange.toFixed(2)} m to the nearest range`)
check(
  'lane corridor clear',
  nearestLane > lane.width / 2,
  `${nearestLane.toFixed(2)} m to the lane centreline (half width ${(lane.width / 2).toFixed(2)})`,
)

console.log(failures === 0 ? '\nfarm layout PASS' : `\nfarm layout FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
