/**
 * Proves the launch retraction clears, and that the parked pose does not.
 *
 *   node --experimental-strip-types tools/starship-clearance-audit.mjs
 *
 * The launch animation moves three members: both catch arms open about their
 * own vertical hinges, and the QD arm folds down about its root. Every number
 * behind those angles is measured here, because the failure they exist to
 * prevent — a flap or a grid fin passing through a truss — lasts about a third
 * of a second twice a cycle and would be very easy to ship.
 *
 * THE SWEEP TEST IS EXACT, and it has to be set up carefully to stay that way.
 *
 * The vehicle leaves VERTICALLY: the gravity turn does not begin until 220 m,
 * and the highest tower member is 105 m above the engine plane. It also does
 * not roll, so its flaps, chines and grid fins stay at fixed azimuths. The
 * volume it sweeps is therefore its own plan silhouette extruded upward — NOT
 * a disc of its maximum radius, which would be a 10.75 m cylinder where the
 * real footprint is a 4.5 m hull with four flaps and four fins sticking out of
 * it, and would condemn members that nothing ever passes near.
 *
 * So: rasterise the vehicle's triangles into a plan grid holding the LOWEST
 * geometry over each cell. A member point at (x, y, z) is then fouled exactly
 * when some vehicle geometry sits over its cell at or below its height — one
 * comparison, no radius assumption, no azimuth bookkeeping.
 *
 * Arm-versus-tower is a genuine 3-D question, so that one is voxelised.
 */
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { buildStarshipPayload, VEHICLE_PARTS, TOWER_ARM_P, TOWER_ARM_N, TOWER_QD_ARM } =
  await import(join(ROOT, 'src/starship/starshipBuild.ts'))

/** Must match `src/starship/starshipRig.ts`. */
const ARM_OPEN_DEG = 25
const QD_FOLD_DEG = 55
/** Must match `ARM_OPEN_ALTITUDE` in `src/starship/starshipFlight.ts`. */
const ARM_OPEN_ALTITUDE = 36
/**
 * The walk starts here, not at 0. In the parked pose the catch pads are SEATED
 * on the ship's forward flap undersides — that is the demo's own mated
 * geometry, ~0.2 m³ of it, and it is contact by design. The vehicle is off the
 * pads by the first half metre of ascent; everything after that is the
 * schedule's problem and is what this walks.
 */
const SCHEDULE_START_M = 0.5

/** Plan grid pitch, and the safety margin every moved member must clear by. */
const PLAN_CELL = 0.15
const REQUIRED_MARGIN = 0.5

const payload = buildStarshipPayload()
const rig = payload.rig
const byName = new Map(payload.parts.map((p) => [p.name, p]))

/** Part vertices in the assembly (Blender) frame: local pos + rotZ + offset. */
function worldVertices(part) {
  const out = []
  const c = Math.cos(part.rotZ), s = Math.sin(part.rotZ)
  for (let i = 0; i < part.position.length; i += 3) {
    const x = part.position[i], y = part.position[i + 1], z = part.position[i + 2]
    out.push([part.pos[0] + x * c - y * s, part.pos[1] + x * s + y * c, part.pos[2] + z])
  }
  return out
}

/** Rotate about a vertical axis through `pivot` — the catch-arm hinge. */
function rotateZ(points, pivot, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return points.map(([x, y, z]) => {
    const dx = x - pivot[0], dy = y - pivot[1]
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c, z]
  })
}

/** Rotate about the horizontal +Y axis through `pivot` — the QD arm fold.
 *  Matches three's `rotation.y`, which is what `starshipRig.ts` drives. */
function rotateY(points, pivot, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return points.map(([x, y, z]) => {
    const dx = x - pivot[0], dz = z - pivot[2]
    return [pivot[0] + dx * c + dz * s, y, pivot[2] - dx * s + dz * c]
  })
}

/** Walk a triangle soup at a spacing fine enough not to step over a cell. */
function sampleTriangles(points, spacing, visit) {
  for (let i = 0; i + 2 < points.length; i += 3) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]]
    const edge = Math.max(
      Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
      Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]),
    )
    const n = Math.max(1, Math.ceil((edge / spacing) * 1.6))
    for (let u = 0; u <= n; u++) {
      for (let v = 0; u + v <= n; v++) {
        const w = n - u - v
        visit(
          (a[0] * u + b[0] * v + c[0] * w) / n,
          (a[1] * u + b[1] * v + c[1] * w) / n,
          (a[2] * u + b[2] * v + c[2] * w) / n,
        )
      }
    }
  }
}

/* ---- the swept plan silhouette ------------------------------------------ */

/** cell key → lowest vehicle geometry over that cell. */
const floorOverCell = new Map()
const planKey = (x, y) => `${Math.floor(x / PLAN_CELL)},${Math.floor(y / PLAN_CELL)}`
let vehicleTriangles = 0

for (const [name, part] of byName) {
  if (!VEHICLE_PARTS.has(name)) continue
  vehicleTriangles += part.triangles
  sampleTriangles(worldVertices(part), PLAN_CELL, (x, y, z) => {
    const key = planKey(x, y)
    const prev = floorOverCell.get(key)
    if (prev === undefined || z < prev) floorOverCell.set(key, z)
  })
}

/**
 * How far a member is from being swept. Positive is clearance measured as the
 * height below the nearest vehicle geometry standing over it; negative means
 * something on the vehicle rises straight through it.
 */
function sweepClearance(points) {
  let worst = Infinity
  let at = null
  sampleTriangles(points, PLAN_CELL, (x, y, z) => {
    const floor = floorOverCell.get(planKey(x, y))
    if (floor === undefined) return
    const gap = floor - z
    if (gap < worst) { worst = gap; at = [x, y, z] }
  })
  return { gap: worst === Infinity ? Infinity : worst, at }
}

/* ---- member against tower ------------------------------------------------ */

const VOXEL = 0.2
function voxelise(points) {
  const cells = new Set()
  sampleTriangles(points, VOXEL, (x, y, z) => {
    cells.add(`${Math.floor(x / VOXEL)},${Math.floor(y / VOXEL)},${Math.floor(z / VOXEL)}`)
  })
  return cells
}
const overlap = (a, b) => {
  let n = 0
  for (const key of a) if (b.has(key)) n++
  return n
}
const volume = (cells) => cells * VOXEL ** 3

let failures = 0
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++ }
const ok = (label, detail) => console.log(`  ok    ${label.padEnd(50)} ${detail}`)

console.log(`vertical sweep — ${vehicleTriangles.toLocaleString()} vehicle triangles`
  + ` rasterised into ${floorOverCell.size.toLocaleString()} plan cells of ${PLAN_CELL} m`)

const members = [
  ['catch arm +Y', worldVertices(byName.get(TOWER_ARM_P)),
    (pts, deg) => rotateZ(pts, rig.armPivotP, deg), ARM_OPEN_DEG],
  ['catch arm −Y', worldVertices(byName.get(TOWER_ARM_N)),
    (pts, deg) => rotateZ(pts, rig.armPivotN, -deg), ARM_OPEN_DEG],
  ['QD arm', worldVertices(byName.get(TOWER_QD_ARM)),
    (pts, deg) => rotateY(pts, rig.qdPivot, deg), QD_FOLD_DEG],
]

for (const [label, points, move, deg] of members) {
  const parked = sweepClearance(points)
  const moved = sweepClearance(move(points, deg))
  if (parked.gap >= 0) {
    console.log(`  note  ${label} parked is already clear by ${parked.gap.toFixed(2)} m`)
  } else {
    console.log(`  note  ${label} PARKED is swept — vehicle passes ${(-parked.gap).toFixed(2)} m `
      + `through it at (${parked.at.map((v) => v.toFixed(1)).join(', ')})`)
  }
  if (moved.gap < REQUIRED_MARGIN) {
    fail(`${label} at ${deg}° clears by only ${moved.gap.toFixed(2)} m `
      + `at (${moved.at?.map((v) => v.toFixed(1)).join(', ')}) — want ${REQUIRED_MARGIN} m`)
  } else {
    ok(`${label} retracted ${deg}° clears the swept silhouette`,
      moved.gap === Infinity ? 'nothing above it at all' : `${moved.gap.toFixed(2)} m`)
  }
}

/* ---- 2. the opening SCHEDULE -------------------------------------------- */

/**
 * The arms are not opened before launch — they spread as the vehicle climbs out
 * through them, and close back around it on the way in. So "do they clear?" is
 * not a question about two poses, it is a question about a one-parameter family
 * of them: at every ascent height h the arm sits at `smoothstep(0, H, h)` of
 * its travel and the vehicle sits h metres up. Walk it.
 *
 * The sweep test above cannot answer this — it asks whether anything EVER
 * passes over a member, which for a member that moves out of the way is the
 * wrong question. This is a straight solid-vs-solid test at each height, so
 * both bodies get voxelised.
 */
const smoothstep01 = (x) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

console.log('\nopening schedule — arm angle is a function of ascent height alone')

/** Vehicle occupancy at rest; raising it by h is a shift of the z index. */
const vehicleCells = new Set()
for (const [name, part] of byName) {
  if (!VEHICLE_PARTS.has(name)) continue
  sampleTriangles(worldVertices(part), VOXEL, (x, y, z) => {
    vehicleCells.add(`${Math.floor(x / VOXEL)},${Math.floor(y / VOXEL)},${Math.floor(z / VOXEL)}`)
  })
}

/** Cells of `points`, as [ix, iy, iz] triples so z can be offset cheaply. */
function voxelTriples(points) {
  const seen = new Set()
  const out = []
  sampleTriangles(points, VOXEL, (x, y, z) => {
    const ix = Math.floor(x / VOXEL), iy = Math.floor(y / VOXEL), iz = Math.floor(z / VOXEL)
    const key = `${ix},${iy},${iz}`
    if (seen.has(key)) return
    seen.add(key)
    out.push([ix, iy, iz])
  })
  return out
}

/**
 * Ascent heights at which the arm, opened by `openFraction(h)`, is inside the
 * raised vehicle.
 *
 * Voxelising the arm is by far the expensive step, so it is cached on the angle
 * quantised to a quarter degree — the walk and the margin search between them
 * ask for thousands of poses drawn from a few dozen distinct angles, and
 * without the cache this runs for minutes instead of a second.
 */
function contactHeights(points, pivot, sign, openFraction) {
  const cache = new Map()
  const posedCells = (deg) => {
    const key = Math.round(deg * 4)
    let cells = cache.get(key)
    if (!cells) {
      cells = voxelTriples(rotateZ(points, pivot, (key / 4) * sign))
      cache.set(key, cells)
    }
    return cells
  }

  const hits = []
  for (let h = SCHEDULE_START_M; h <= 120; h += 0.5) {
    const shift = Math.round(h / VOXEL)
    for (const [ix, iy, iz] of posedCells(ARM_OPEN_DEG * openFraction(h))) {
      if (vehicleCells.has(`${ix},${iy},${iz - shift}`)) { hits.push(h); break }
    }
  }
  return hits
}

for (const [label, points, pivot, sign] of [
  ['catch arm +Y', worldVertices(byName.get(TOWER_ARM_P)), rig.armPivotP, 1],
  ['catch arm −Y', worldVertices(byName.get(TOWER_ARM_N)), rig.armPivotN, -1],
]) {
  // What the mechanism is FOR: the window an arm that never moved would be
  // ploughed through. This is the deadline the schedule has to beat.
  const parked = contactHeights(points, pivot, sign, () => 0)
  if (!parked.length) {
    fail(`${label} never fouls even fully parked — the opening schedule is unnecessary`)
    continue
  }
  console.log(`  note  ${label} fully parked is ploughed over ascent `
    + `${parked[0]}–${parked[parked.length - 1]} m (grid fins and chines going by)`)

  const scheduled = contactHeights(points, pivot, sign,
    (h) => smoothstep01(h / ARM_OPEN_ALTITUDE))
  if (scheduled.length) {
    fail(`${label} still touches at ${scheduled.length} scheduled heights `
      + `(${scheduled[0]}–${scheduled[scheduled.length - 1]} m) — open sooner than `
      + `${ARM_OPEN_ALTITUDE} m, or further than ${ARM_OPEN_DEG}°`)
    continue
  }

  // How much slack the schedule has: raise the opening altitude until it fouls.
  let ceiling = ARM_OPEN_ALTITUDE
  for (let slower = ARM_OPEN_ALTITUDE + 2; slower <= 90; slower += 2) {
    if (contactHeights(points, pivot, sign, (h) => smoothstep01(h / slower)).length) break
    ceiling = slower
  }
  ok(`${label} clears at every scheduled height`,
    `opens by ${ARM_OPEN_ALTITUDE} m; fouls only past ${ceiling + 2} m `
    + `(${(((ceiling + 2) / ARM_OPEN_ALTITUDE - 1) * 100).toFixed(0)}% margin)`)
}

console.log(`\nretracted members against the tower (voxel occupancy, ${VOXEL} m)`)
const towerCells = voxelise(worldVertices(byName.get('Tower_Struct')))
/**
 * The catch-arm hinges are INSIDE the carriage by the demo's own construction,
 * so the arms start with tower contact and the only question is how much the
 * retraction adds. Budgeted rather than forbidden, and reported either way.
 */
const ADDED_CONTACT_BUDGET_M3 = 0.8

for (const [label, points, move, deg] of members) {
  const before = overlap(voxelise(points), towerCells)
  const after = overlap(voxelise(move(points, deg)), towerCells)
  const added = volume(after - before)
  if (added > ADDED_CONTACT_BUDGET_M3) {
    fail(`${label} at ${deg}° buries ${added.toFixed(2)} m³ more of itself in the tower `
      + `(${volume(before).toFixed(2)} → ${volume(after).toFixed(2)} m³)`)
  } else {
    ok(`${label} retracted adds ≤ ${ADDED_CONTACT_BUDGET_M3} m³ of tower contact`,
      `${volume(before).toFixed(2)} → ${volume(after).toFixed(2)} m³ (+${added.toFixed(2)})`)
  }
}

if (failures) {
  console.error(`\nCLEARANCE AUDIT FAILED — ${failures} problem(s)`)
  process.exit(1)
}
console.log('\nCLEARANCE OK — the retraction clears, and the parked pose is why it has to')
