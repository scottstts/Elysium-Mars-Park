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

/** The step-free route: fixed grade, derived run. */
interface RampPlan {
  u0: number
  run: number
  headY: number
  footY: number
  vNear: number
  vFar: number
}

const RAMP = { grade: 10, vNear: DEPTH + 0.028, vFar: DEPTH + 1.94, railHeight: 0.95 }

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
    })
  }
}

function buildOne(
  writer: PartWriter,
  group: Group,
  physics: PhysicsSystem,
  spec: ArcPlatform,
  options: { title: string },
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
  const ramp = planSideRamp(spec)
  buildSideRamp(writer, spec, ramp)

  buildColliders(physics, spec, flights, ramp)
}

// ---------------------------------------------------------------- ramp ----

/**
 * Head at the west end of the back band, open onto the deck (side platforms
 * carry no windbreak, so nothing can seal it); one straight run along the
 * arc at 1:10, its length solved so the foot lands ON the ground measured at
 * the foot itself — across the full width, the portal ramp's root-cause fix.
 */
function planSideRamp(spec: ArcPlatform): RampPlan {
  const half = ARC / 2
  const u0 = -half + 1.35
  const headY = platformDeckY(spec, u0) - 0.006
  const vMid = (RAMP.vNear + RAMP.vFar) / 2
  let run = 5
  let footY = headY
  for (let pass = 0; pass < 5; pass++) {
    const footU = u0 + run
    let ground = -Infinity
    for (const v of [RAMP.vNear + 0.2, vMid, RAMP.vFar - 0.2]) {
      const p = platformPoint(spec, footU, v, 0)
      ground = Math.max(ground, interiorHeight(p.x, p.z))
    }
    footY = ground + 0.012
    const next = Math.min(half * 2 - 2.0, Math.max(3.2, RAMP.grade * (headY - footY)))
    if (Math.abs(next - run) < 0.02) {
      run = next
      break
    }
    run = next
  }
  return { u0, run, headY, footY, vNear: RAMP.vNear, vFar: RAMP.vFar }
}

function buildSideRamp(writer: PartWriter, spec: ArcPlatform, plan: RampPlan): void {
  const { u0, run, headY, footY, vNear, vFar } = plan
  const yAt = (t: number): number => headY + (footY - headY) * t
  // Retained solid: segment slabs bedded below their OWN local grade (the
  // ground under each segment, not a proxy), so the run is an embankment
  // wall wherever the grade falls away.
  const segments = Math.max(4, Math.ceil(run / 1.15))
  for (let i = 0; i < segments; i++) {
    const ua = u0 + (run * i) / segments
    const ub = u0 + (run * (i + 1)) / segments
    const ya = yAt(i / segments)
    const yb = yAt((i + 1) / segments)
    const corners: [Vector3, Vector3, Vector3, Vector3] = [
      platformPoint(spec, ua, vNear, ya),
      platformPoint(spec, ub, vNear, yb),
      platformPoint(spec, ub, vFar, yb),
      platformPoint(spec, ua, vFar, ya),
    ]
    let ground = Infinity
    for (const corner of corners) ground = Math.min(ground, interiorHeight(corner.x, corner.z))
    writer.slab(corners, Math.max(0.22, Math.min(ya, yb) - ground + 0.32), 'cast', 0.5)
  }
  // Kerbs: one swept member per side, ends diving into the pours (the tram
  // rails' feather at kerb scale — never a capped disc on the open slab).
  for (const v of [vNear + 0.07, vFar - 0.07]) {
    const at = (t: number, lift: number): Vector3 =>
      platformPoint(spec, u0 + run * t, v, yAt(t) + lift)
    writer.tube({
      path: [at(0.004, -0.07), at(0.03, 0.028), at(0.97, 0.028), at(0.996, -0.07)],
      radius: 0.052,
      slot: 'dark',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
  }
  // Handrails: the canonical run + stanchions.
  for (const v of [vNear + 0.07, vFar - 0.07]) {
    const axis: Vector3[] = []
    const steps = Math.max(3, Math.ceil(run / 1.4))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      axis.push(platformPoint(spec, u0 + run * t, v, yAt(t) + RAMP.railHeight))
    }
    railRun(writer, axis, { radius: 0.026, cornerRadius: 0.14 })
    const posts = Math.max(3, Math.round(run / 1.6))
    for (let i = 0; i <= posts; i++) {
      const t = i / posts
      const p = platformPoint(spec, u0 + run * t, v, yAt(t))
      railPost(writer, p, yAt(t) + RAMP.railHeight, {
        radius: 0.021,
        slot: 'dark',
        railRadius: 0.026,
        buried: true,
      })
    }
  }
  // Discharge apron: poured at the foot, crossing the local ground.
  const footU = u0 + run
  groundApron(writer, {
    left: platformPoint(spec, footU, vFar, footY),
    right: platformPoint(spec, footU, vNear, footY),
    outward: platformTangent(spec, footU),
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
  // Ramp: one pitched slab down the run.
  const rampMidU = ramp.u0 + ramp.run / 2
  const along = platformTangent(spec, rampMidU)
  const vMid = (ramp.vNear + ramp.vFar) / 2
  box(
    platformPoint(spec, rampMidU, vMid, (ramp.headY + ramp.footY) / 2 + 0.08),
    new Vector3((ramp.vFar - ramp.vNear) / 2, 0.1, Math.hypot(ramp.run, ramp.headY - ramp.footY) / 2 + 0.1),
    Math.atan2(ramp.headY - ramp.footY, ramp.run),
    Math.atan2(along.x, along.z),
  )
  // Canopy columns (u −6.4 / 0 / +6.4 for the 12.8 m canopy).
  for (const u of [-6.4, 0, 6.4]) {
    const p = platformPoint(spec, u, DEPTH * 0.55, platformDeckY(spec, u) + 1.55)
    world.createCollider(api.ColliderDesc.cylinder(1.55, 0.14).setTranslation(p.x, p.y, p.z), body)
  }
}
