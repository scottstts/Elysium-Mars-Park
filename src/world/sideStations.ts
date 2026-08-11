import { Group, Quaternion, Vector3 } from 'three'
import { railPost, railRun } from '../archkit/kit'
import { PartWriter } from '../archkit/writer'
import type { PhysicsSystem } from '../physics/physicsWorld'
import {
  PLATFORM_EDGE_OFFSET,
  carFloorY,
  emitPlatformCanopy,
  emitPlatformEdge,
  emitPlatformSlab,
  leaningRail,
  litterBin,
  platformDeckY,
  platformOutward,
  platformPoint,
  platformTangent,
  stationSign,
} from '../tram/track'
import type { ArcPlatform } from '../tram/track'
import type { FlightPlan } from './stationArchitecture'
import { buildFlight, flightApron, groundApron, planFlight } from './stationArchitecture'
import { interiorHeight } from './interiorHeight'
import { LOOP } from './parkPlan'
import { slabTop } from './paving'

/**
 * SIDE STATIONS — Overlook West and Farmside, rebuilt on the portal wave's
 * principles (P-wave 5) after the terminus rebuild exposed the old kit's
 * diseases. The rules this module lives by:
 *
 *  - every ground datum is sampled WHERE THE STRUCTURE IS, never at a proxy
 *    point (the old `emitPlatformRamp` probed its foot on a different pour
 *    and shipped a stair-to-nowhere at the portal);
 *  - flights come from `planFlight` (flush at both ends by construction) and
 *    land on `flightApron`/`groundApron` pours that CROSS the ground;
 *  - the step-free route is DERIVED: grade fixed at 1:10 (0.38 g), run
 *    solved against the ground at its own discharge point;
 *  - every handrail is the canonical `railRun`/`railPost`;
 *  - colliders are built from the same plans as the visuals.
 */

const ARC = 18
const DEPTH = 5.2
/** Back band of the deck (sign, bins, leaning rails). */
const BACK = DEPTH - 0.22
/** stationSteps stands its head plate 9 mm proud — planFlight heads solve
 *  against deck − plate so the threshold lands flush (stationArchitecture's
 *  THRESHOLD_SET idiom). */
const THRESHOLD = 0.009

/** The step-free route: fixed grade, derived run.
 *
 *  PERPENDICULAR to the platform's back edge, run pointing AWAY from the
 *  track (owner directive after two failed parallel versions): from the
 *  deck you look DOWN ITS LENGTH — it reads as a way out, not a mass —
 *  and from the track side it shows only its short end. Top dead flush
 *  with the deck plane at a 2 cm movement joint; nothing but handrail
 *  above deck level; foot dead flush with the ground walk it serves. */
interface RampPlan {
  /** Arc position of the ramp axis. */
  u: number
  /** Back-band offset of the head edge (deck depth + the joint). */
  vHead: number
  run: number
  headY: number
  footY: number
}

const RAMP = { grade: 10, width: 2.6, joint: 0.02, railHeight: 0.95 }

export function buildSideStations(writer: PartWriter, group: Group, physics: PhysicsSystem): void {
  for (const station of LOOP.stations) {
    if (station.id === 'portal') continue
    const point = new Vector3(
      Math.cos(station.angle) * LOOP.radius,
      0,
      Math.sin(station.angle) * LOOP.radius,
    )
    const spec: ArcPlatform = {
      centreAngle: station.angle,
      arcLength: ARC,
      rEdge: LOOP.radius - PLATFORM_EDGE_OFFSET,
      depth: DEPTH,
      deckY: carFloorY(point.x, point.z) - 0.02,
      baseY: slabTop(point.x, point.z),
    }
    buildOne(writer, group, physics, spec, {
      title: station.id === 'overlook' ? 'OVERLOOK WEST' : 'FARMSIDE',
      // The ramp axis aims at the walk the station actually serves: the
      // farm-lane's end leg at Farmside (u = +2), the meridian-west walk
      // at Overlook (u = −4). Both probed paved at the 1:10 foot.
      rampU: station.id === 'overlook' ? -4 : 2,
    })
  }
}

function buildOne(
  writer: PartWriter,
  group: Group,
  physics: PhysicsSystem,
  spec: ArcPlatform,
  options: { title: string; rampU: number },
): void {
  const half = ARC / 2

  emitPlatformSlab(writer, spec)
  emitPlatformEdge(writer, spec)
  emitPlatformCanopy(writer, spec, {
    arcLength: ARC - 5.2,
    reach: 4.6,
    columnV: DEPTH * 0.55,
  })
  for (const u of [-half + 3.6, half - 3.6]) leaningRail(writer, spec, u, BACK - 0.55)
  litterBin(writer, platformPoint(spec, half - 1.8, BACK - 0.6, platformDeckY(spec, half - 1.8)))
  // Mid-bay, clear of the canopy columns (u −6.4 / 0 / +6.4) — the portal
  // wave's board-behind-a-column lesson.
  stationSign(writer, group, spec, -3.2, BACK, options.title)

  // ---- end flights, flush both ends, each with its poured landing.
  const flights: FlightPlan[] = []
  for (const sign of [-1, 1]) {
    const u = sign * (half + 0.06)
    const plan = planFlight({
      head: platformPoint(spec, u, DEPTH / 2, 0),
      headY: platformDeckY(spec, u) - THRESHOLD,
      descend: platformTangent(spec, u).multiplyScalar(sign),
      across: platformOutward(spec, u),
      width: 3.0,
      run: 0.32,
      targetRise: 0.155,
      minSteps: 2,
      maxSteps: 6,
    })
    buildFlight(writer, plan)
    flightApron(writer, plan, 1.2)
    flights.push(plan)
  }

  // ---- the ramp.
  const ramp = planSideRamp(spec, options.rampU)
  buildSideRamp(writer, spec, ramp)

  buildColliders(physics, spec, flights, ramp)
}

// ---------------------------------------------------------------- ramp ----

/**
 * Head ON the back edge at u = +2 (biased toward the district the station
 * serves — at Farmside the run lands its foot on the farm-lane's own
 * centreline), top EXACTLY the deck plane, one straight run at 1:10 away
 * from the track, its length solved so the foot lands ON the ground
 * measured at the foot itself — across the full width, the portal ramp's
 * root-cause fix.
 */
function planSideRamp(spec: ArcPlatform, u: number): RampPlan {
  const vHead = DEPTH + RAMP.joint
  const headY = platformDeckY(spec, u)
  let run = 5
  let footY = headY - 0.5
  for (let pass = 0; pass < 6; pass++) {
    const vFoot = vHead + run
    let ground = -Infinity
    for (const du of [-RAMP.width / 2 + 0.2, 0, RAMP.width / 2 - 0.2]) {
      const p = platformPoint(spec, u + du, vFoot, 0)
      ground = Math.max(ground, interiorHeight(p.x, p.z))
    }
    footY = ground + 0.012
    const next = Math.min(12, Math.max(3.2, RAMP.grade * (headY - footY)))
    if (Math.abs(next - run) < 0.02) {
      run = next
      break
    }
    run = next
  }
  return { u, vHead, run, headY, footY }
}

function buildSideRamp(writer: PartWriter, spec: ArcPlatform, plan: RampPlan): void {
  const { u, vHead, run, headY, footY } = plan
  const halfW = RAMP.width / 2
  const yAt = (t: number): number => headY + (footY - headY) * t
  const vAt = (t: number): number => vHead + run * t
  // ONE monolithic retained prism: planar top from the flush head threshold
  // to the flush foot, continuous flanks to a buried bottom. CORNER ORDER IS
  // LOAD-BEARING: `PartWriter.slab` extrudes along the corner winding's
  // NEGATIVE face normal, and the (across, then down-run) order used here
  // before — inherited from the original segmented version — has a DOWNWARD
  // normal in the platform frame, so every slab extruded UPWARD: a box
  // standing 0.95 m proud of the intended surface. That phantom box (and
  // its stepped per-segment ancestors) IS what read as the "giant stairs /
  // giant block" (owner, four times). Down-run first, then across, puts the
  // normal up and the body below the walking plane where it belongs.
  writer.slab(
    [
      platformPoint(spec, u - halfW, vHead, headY),
      platformPoint(spec, u - halfW, vHead + run, footY),
      platformPoint(spec, u + halfW, vHead + run, footY),
      platformPoint(spec, u + halfW, vHead, headY),
    ],
    0.95,
    'cast',
    0.5,
  )
  // Kerbs: one swept member per flank, ends diving into the pours (the tram
  // rails' feather at kerb scale — never a capped disc on the open slab).
  for (const s of [-1, 1] as const) {
    const at = (t: number, lift: number): Vector3 =>
      platformPoint(spec, u + s * (halfW - 0.07), vAt(t), yAt(t) + lift)
    writer.tube({
      path: [at(0.004, -0.07), at(0.03, 0.028), at(0.97, 0.028), at(0.996, -0.07)],
      radius: 0.052,
      slot: 'dark',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
  }
  // Handrails: full-length on BOTH flanks — with a perpendicular run the
  // two ends ARE the thresholds (head flush with the deck, foot flush with
  // the walk), so closing the flanks is the correct topology and both
  // openings exist by construction.
  for (const s of [-1, 1] as const) {
    const axis: Vector3[] = []
    const steps = Math.max(3, Math.ceil(run / 1.4))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      axis.push(
        platformPoint(spec, u + s * (halfW - 0.07), vAt(t), yAt(t) + RAMP.railHeight),
      )
    }
    railRun(writer, axis, { radius: 0.026, cornerRadius: 0.14 })
    const posts = Math.max(3, Math.round(run / 1.6))
    for (let i = 0; i <= posts; i++) {
      const t = i / posts
      const p = platformPoint(spec, u + s * (halfW - 0.07), vAt(t), yAt(t))
      railPost(writer, p, yAt(t) + RAMP.railHeight, {
        radius: 0.021,
        slot: 'dark',
        railRadius: 0.026,
        buried: true,
      })
    }
  }
  // Discharge apron: poured at the foot, crossing the local ground, facing
  // on down the run (away from the track).
  groundApron(writer, {
    left: platformPoint(spec, u - halfW, vHead + run, footY),
    right: platformPoint(spec, u + halfW, vHead + run, footY),
    outward: platformOutward(spec, u).multiplyScalar(-1),
    depth: 1.3,
    inset: 0.3,
    overhang: 0.1,
  })
}

// ----------------------------------------------------------- colliders ----

function rotation(pitch: number, yaw: number): { x: number; y: number; z: number; w: number } {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

function buildColliders(
  physics: PhysicsSystem,
  spec: ArcPlatform,
  flights: FlightPlan[],
  ramp: RampPlan,
): void {
  const world = physics.world
  const api = physics.api
  if (!world || !api) return
  const body = world.createRigidBody(api.RigidBodyDesc.fixed())
  const half = ARC / 2
  const box = (centre: Vector3, halfExtents: Vector3, pitch: number, yaw: number): void => {
    world.createCollider(
      api.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rotation(pitch, yaw)),
      body,
    )
  }
  // Deck: six thin PITCHED top slabs (Overlook falls 0.48 m over the arc —
  // three level boxes tracked the portal's deck to ±74 mm, the station-agent
  // finding), over three full-height body blockers set 0.18 below the treads.
  for (let i = 0; i < 6; i++) {
    const u = -half + (ARC * (i + 0.5)) / 6
    const along = platformTangent(spec, u)
    const slope = (platformDeckY(spec, u + 0.5) - platformDeckY(spec, u - 0.5)) / 1.0
    const centre = platformPoint(spec, u, DEPTH / 2, platformDeckY(spec, u) - 0.1)
    // Local +Z runs along the tangent (increasing u); the deck rises along it
    // at `slope`, which is a NEGATIVE pitch about local +X.
    box(centre, new Vector3(DEPTH / 2, 0.1, ARC / 12 + 0.01), -Math.atan(slope), Math.atan2(along.x, along.z))
  }
  for (let i = 0; i < 3; i++) {
    const u = -half + (ARC * (i + 0.5)) / 3
    const along = platformTangent(spec, u)
    const top = platformDeckY(spec, u) - 0.18
    const bottom = spec.baseY - 0.9
    const centre = platformPoint(spec, u, DEPTH / 2, (top + bottom) / 2)
    box(centre, new Vector3(DEPTH / 2, (top - bottom) / 2, ARC / 6), 0, Math.atan2(along.x, along.z))
  }
  // Flights: one pitched slab each, from the plan the visuals used.
  for (const plan of flights) {
    const runLength = plan.steps * plan.run
    const drop = plan.steps * plan.rise
    const mid = plan.foot
      .clone()
      .addScaledVector(plan.climb, runLength / 2)
      .setY(plan.foot.y + drop / 2 + 0.06)
    // Local +Z = climb; the surface RISES along it, which is a negative
    // pitch about local +X (portalStation's grand-flight convention).
    box(
      mid,
      new Vector3(plan.width / 2, 0.1, Math.hypot(runLength, drop) / 2 + 0.1),
      -Math.atan2(drop, runLength),
      Math.atan2(plan.climb.x, plan.climb.z),
    )
  }
  // Ramp: one pitched slab down the run — local +Z along the descent
  // (perpendicular to the platform, away from the track), which FALLS
  // along +Z, so a positive pitch about local +X.
  const down = platformOutward(spec, ramp.u).multiplyScalar(-1)
  box(
    platformPoint(
      spec,
      ramp.u,
      ramp.vHead + ramp.run / 2,
      (ramp.headY + ramp.footY) / 2 + 0.08,
    ),
    new Vector3(
      RAMP.width / 2,
      0.1,
      Math.hypot(ramp.run, ramp.headY - ramp.footY) / 2 + 0.1,
    ),
    Math.atan2(ramp.headY - ramp.footY, ramp.run),
    Math.atan2(down.x, down.z),
  )
  // Canopy columns (u −6.4 / 0 / +6.4 for the 12.8 m canopy).
  for (const u of [-6.4, 0, 6.4]) {
    const p = platformPoint(spec, u, DEPTH * 0.55, platformDeckY(spec, u) + 1.55)
    world.createCollider(api.ColliderDesc.cylinder(1.55, 0.14).setTranslation(p.x, p.y, p.z), body)
  }
}
