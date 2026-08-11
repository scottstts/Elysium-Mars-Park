import { Vector2, Vector3 } from 'three'
import { railPost, railRun } from '../archkit/kit'
import { SMOOTH, loft, recalcNormals, smoothShade, writeInto } from '../archkit/meshdata'
import type { Vec3 as MVec3 } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'
import {
  platformDeckY,
  platformGroundY,
  platformOutward,
  platformPoint,
  platformTangent,
  stationSteps,
} from '../tram/track'
import type { ArcPlatform } from '../tram/track'
import { interiorHeight } from './interiorHeight'

/**
 * PORTAL STATION — circulation and enclosure.
 *
 * The platform is an arc, so everything is placed in its (u, v) frame:
 * `u` is ARC OFFSET (positive u walks toward −x; the world compass is not
 * useful here and the old "east"/"west" comments were simply wrong), `v` is
 * INWARD from the fascia. `platformDeckY(u)` is the deck datum and it FALLS
 * with the guideway — nothing here may be level in world Y.
 *
 * THE CIRCULATION GRAPH, and why each leg lands where it does:
 *
 *   deck ↔ Meridian walk   the grand flight, straight down the station axis
 *                          off the back edge onto the 6 m paved walk.
 *   deck ↔ terrace         a flight off each end onto the station terrace.
 *   deck ↔ Meridian walk   the ramp: a level head landing at the back-west
 *                          corner, then ONE splayed run that converges onto
 *                          the walk ~9.5 m south. It cannot run parallel to
 *                          the back edge (only 6.5 m of clear arc beside the
 *                          grand flight, and ~0.95 m to lose = 1:6.8), and it
 *                          cannot run radially beside the flight (the walk is
 *                          6 m wide and KERBED — CURB.reveal is 135 mm — so a
 *                          route that lands outside it lands against a kerb).
 *                          Converging is the only line that keeps 1:10 AND
 *                          puts every wheel on poured, kerb-free ground.
 *
 * FLUSHNESS IDIOM, used by every leg: a cast never *butts* the ground, it
 * CROSSES it. Flights carry `stationSteps`' own −0.34 lead-in under the
 * paving; the ramp and every landing get `groundApron`, whose outer edge is
 * driven 55 mm BELOW the local surface so the contact is a line, not a
 * coplanar pair (notes: "two meshes snapped to THE SAME datum are coplanar by
 * construction").
 */

/** 18 m of deck: the boulevard planters resume off the station bearing and
 *  the end flights + their aprons must fit inside that gap. */
export const DECK_ARC = 18
export const DECK_DEPTH = 6.6
export const CANOPY_ARC = 17.2
/** 3.6 m, not 3.4: the name board has to clear 2.30 m over the front walk
 *  line AND still hang from the rafters (§B headroom). */
export const CANOPY_HEIGHT = 3.6
export const CANOPY_BAYS = 4
export const V_FRONT = 0.9
export const V_CANOPY_BACK = 6.0
export const V_COLUMN = 3.6
/** Roof falls toward the track so the gutter is over the trackbed. */
export const ROOF_FALL = 0.05
/** The screen line, 0.35 m in front of the deck's back edge. */
export const SCREEN_V = 6.25
export const SCREEN_H = 2.1
/** Movement joint between two independent pours — `PAVE.joint`'s width. */
export const JOINT = 0.028

/** Clear opening in the screen for the grand flight (5.0 m flight + margin). */
export const GRAND_OPENING = { u0: -2.75, u1: 2.75 }
/** Clear opening for the ramp head — the landing's full width. */
export const RAMP_OPENING = { u0: 6.62, u1: 9.0 }

export const GRAND_WIDTH = 5.0
export const END_WIDTH = 2.4
/** End flights sit in v [1.5, 3.9]: clear of the guideway channel lip
 *  (r 95.4 → v 0.2) and clear of the terrace's own kerb line (v ≈ 4.5). */
export const END_V_CENTRE = 2.7

export const RAMP = {
  /** Level head landing: arc span = the screen opening, depth from the deck's
   *  back edge (less a movement joint) to `landingV`. */
  landingV: 8.6,
  /** Where the run discharges onto the Meridian walk (world x, z). */
  foot: new Vector2(-1.3, 79.2),
  /** Half the cast width — matches the landing's arc half-width. */
  half: 1.17,
  kerb: 0.17,
  kerbLift: 0.13,
  railHeight: 0.95,
} as const

/** The walkable surface at a point: paved top where paved, regolith where not. */
export function groundY(x: number, z: number): number {
  return interiorHeight(x, z)
}

// ---------------------------------------------------------------- slab ----

// The corrected grid-cap slab (polar-grid caps, welded-then-oriented shell —
// see the doc comment on `track.emitPlatformSlab`) was ported back into
// track.ts so Overlook and Farmside share the fix; re-exported here under the
// name the portal builder uses.
export { emitPlatformSlab as emitDeckSlab } from '../tram/track'

// ------------------------------------------------------------- flights ----

export interface FlightPlan {
  foot: Vector3
  climb: Vector3
  across: Vector3
  steps: number
  rise: number
  run: number
  width: number
  /** Top of the cast at the head — the threshold plate stands 15 mm on it. */
  headY: number
}

/**
 * A flight that is flush at BOTH ends.
 *
 * `stationSteps` puts its cast top at `foot.y + steps·rise` and stands a
 * 20 mm threshold plate 15 mm proud of it, so the head is solved for
 * `deckY − 0.015` and the plate lands exactly on the deck. The foot is solved
 * against the ground SAMPLED WHERE THE FOOT IS — across the full width, not
 * at a proxy point (that was defect 2's root cause) — and the riser count is
 * derived from the drop, because neither datum is ever a round number.
 */
export function planFlight(opts: {
  head: Vector3
  headY: number
  descend: Vector3
  across: Vector3
  width: number
  run: number
  targetRise: number
  minSteps: number
  maxSteps: number
}): FlightPlan {
  const { head, headY, descend, across, width, run, targetRise } = opts
  let steps = Math.max(opts.minSteps, Math.round(0.8 / targetRise))
  let footY = headY
  let foot = head.clone()
  for (let pass = 0; pass < 6; pass++) {
    foot = head.clone().addScaledVector(descend, steps * run + 0.04)
    footY = -Infinity
    for (const s of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const p = foot.clone().addScaledVector(across, s * width)
      footY = Math.max(footY, groundY(p.x, p.z))
    }
    const next = Math.max(
      opts.minSteps,
      Math.min(opts.maxSteps, Math.round((headY - footY) / targetRise)),
    )
    if (next === steps) break
    steps = next
  }
  // The bottom tread sits 12 mm over the HIGHEST ground under the flight, so
  // the apron only ever falls away from it and its inner edge is never within
  // the audit's 1.5 mm coplanar band of the paving it lands on.
  foot.setY(footY + 0.012)
  return {
    foot,
    climb: descend.clone().negate(),
    across,
    steps,
    rise: (headY - foot.y) / steps,
    run,
    width,
    headY,
  }
}

export function buildFlight(writer: PartWriter, plan: FlightPlan): void {
  stationSteps(writer, {
    foot: plan.foot.clone(),
    climb: plan.climb,
    across: plan.across,
    steps: plan.steps,
    rise: plan.rise,
    run: plan.run,
    width: plan.width,
  })
}

// -------------------------------------------------------------- aprons ----

/**
 * The poured transition at the foot of a flight or ramp.
 *
 * Its inner edge sits at the structure's own level (and starts 0.25 m INSIDE
 * the structure, so the joint is a bury inside one slot, never a butt); its
 * outer edge is driven `BURY` below the local surface. The top therefore
 * CROSSES the ground along a line — zero coplanar area — and the crossing is
 * where the walk actually resumes. It is also what absorbs a landing's
 * cross-fall: the station terrace falls 41 mm/m across the end flights, which
 * no level tread can follow.
 */
const APRON_BURY = 0.055

export function groundApron(
  writer: PartWriter,
  opts: {
    /** Structure edge, left and right, at the structure's own level. */
    left: Vector3
    right: Vector3
    /** Horizontal unit, pointing away from the structure. */
    outward: Vector3
    depth: number
    /** How far back INTO the structure the pour starts (buried). */
    inset?: number
    /** Widen past the structure so the two side faces are never coplanar. */
    overhang?: number
    slot?: string
  },
): void {
  const inset = opts.inset ?? 0.25
  const overhang = opts.overhang ?? 0.12
  const slot = opts.slot ?? 'cast'
  const across = new Vector3().subVectors(opts.right, opts.left)
  const width = across.length()
  if (width < 1e-4) return
  across.multiplyScalar(1 / width)
  const nu = 8
  const nv = 5
  const rings: MVec3[][] = []
  for (let i = 0; i <= nu; i++) {
    const t = i / nu
    const along = -inset + (opts.depth + inset) * t
    const top: MVec3[] = []
    const bottom: MVec3[] = []
    for (let j = 0; j <= nv; j++) {
      const w = j / nv
      const base = opts.left
        .clone()
        .lerp(opts.right, w)
        .addScaledVector(across, (w - 0.5) * 2 * overhang)
      const p = base.clone().addScaledVector(opts.outward, along)
      const surface = groundY(p.x, p.z)
      // Smoothstep, so the pour leaves the bottom nosing with ZERO slope (a
      // linear or ^0.6 blend put a 24 % ramp in the first 120 mm — measurable
      // as a 23 mm drop right where a foot lands) and still crosses the paving
      // plane at ~3°, far outside the audit's 0.13° coplanar window.
      const t2 = Math.min(1, Math.max(0, along) / Math.max(1e-4, opts.depth))
      const blend = t2 * t2 * (3 - 2 * t2)
      const y = base.y * (1 - blend) + (surface - APRON_BURY) * blend
      top.push([p.x, y, p.z])
      bottom.push([p.x, Math.min(y, surface) - 0.34, p.z])
    }
    rings.push([...top, ...bottom.reverse()])
  }
  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  md.frame = 'y-up'
  recalcNormals(md)
  smoothShade(md, SMOOTH.cast)
  writeInto(writer, slot, md, { uvScale: 0.6 })
}

/**
 * Threshold set-down. `stationSteps` stands its head plate 15 mm proud of the
 * cast, so a cast head at deckY − 0.015 puts the plate's top EXACTLY on the
 * deck plane — 0.10 m² of same-facing coplanar per flight, invisible only
 * while the deck itself was faceted. 9 mm leaves the plate 6 mm proud: a real
 * alloy nosing, the same idiom as every tread, and well inside the 20 mm
 * flush tolerance.
 */
const THRESHOLD_SET = 0.009

/** The ceremonial flight: straight down the station axis onto the Meridian. */
export function planGrandFlight(spec: ArcPlatform): FlightPlan {
  return planFlight({
    head: platformPoint(spec, 0, DECK_DEPTH, 0),
    headY: platformDeckY(spec, 0) - THRESHOLD_SET,
    descend: platformOutward(spec, 0).negate(),
    across: platformTangent(spec, 0),
    width: GRAND_WIDTH,
    run: 0.3,
    targetRise: 0.16,
    minSteps: 3,
    maxSteps: 8,
  })
}

/** An end flight: off the deck end along the tangent, onto the terrace. */
export function planEndFlight(spec: ArcPlatform, sign: number): FlightPlan {
  const u = sign * (DECK_ARC / 2 + 0.06)
  return planFlight({
    head: platformPoint(spec, u, END_V_CENTRE, 0),
    headY: platformDeckY(spec, u) - THRESHOLD_SET,
    descend: platformTangent(spec, u).multiplyScalar(sign),
    across: platformOutward(spec, u),
    width: END_WIDTH,
    run: 0.32,
    targetRise: 0.15,
    minSteps: 2,
    maxSteps: 6,
  })
}

/** Apron sized off a finished flight plan. */
export function flightApron(writer: PartWriter, plan: FlightPlan, depth: number): void {
  const left = plan.foot.clone().addScaledVector(plan.across, -plan.width / 2)
  const right = plan.foot.clone().addScaledVector(plan.across, plan.width / 2)
  groundApron(writer, {
    left,
    right,
    outward: plan.climb.clone().negate(),
    depth,
  })
}

/** Yaw that sends a box's local +Z along `dir`. */
export function yawOf(dir: Vector3): number {
  return Math.atan2(dir.x, dir.z)
}

/** A closed rectangular section in the (across, up) plane of a sweep frame. */
export function sectionRing(
  centre: Vector3,
  across: Vector3,
  half: number,
  top: number,
  bottom: number,
  chamfer: number,
): MVec3[] {
  const p = (a: number, y: number): MVec3 => {
    const q = centre.clone().addScaledVector(across, a).setY(y)
    return [q.x, q.y, q.z]
  }
  return [
    p(-half + chamfer, top),
    p(half - chamfer, top),
    p(half, top - chamfer),
    p(half, bottom),
    p(-half, bottom),
    p(-half, top - chamfer),
  ]
}

// ---------------------------------------------------------------- ramp ----

export interface RampPlan {
  /** Level head landing, in the platform frame. */
  landing: { u0: number; u1: number; vNear: number; vFar: number }
  /** Run centreline: head (downhill edge of the landing) → foot. */
  head: Vector3
  foot: Vector3
  /** Unit horizontal, head → foot. */
  dir: Vector3
  /** Unit horizontal, across the run. */
  across: Vector3
  length: number
  grade: number
}

/**
 * The step-free route, solved rather than typed.
 *
 * The head level is the deck datum at the landing's centre; the foot level is
 * the ground SAMPLED ACROSS THE RUN'S FULL WIDTH at the discharge point (its
 * maximum, so the ramp never lands below grade and the apron only ever falls
 * away from it). The grade drops out of the geometry — assert it, never
 * assume it.
 */
export function planRamp(spec: ArcPlatform): RampPlan {
  const u0 = RAMP_OPENING.u0
  const u1 = RAMP_OPENING.u1
  const uc = (u0 + u1) / 2
  const vFar = RAMP.landingV
  const head = platformPoint(spec, uc, vFar, platformDeckY(spec, uc))
  const foot = new Vector3(RAMP.foot.x, 0, RAMP.foot.y)
  const dir = new Vector3(foot.x - head.x, 0, foot.z - head.z)
  const length = dir.length()
  dir.multiplyScalar(1 / length)
  // `across` must point the SAME way as increasing u, because the landing's
  // two edges are named by u and the run's by ±across. Left as the bare
  // perpendicular it came out reversed, and both kerbs AND both handrails
  // swapped sides at the landing/run junction — an X across the ramp head.
  const across = new Vector3(-dir.z, 0, dir.x)
  if (across.dot(platformTangent(spec, uc)) < 0) across.negate()
  let footY = -Infinity
  for (const s of [-1, -0.5, 0, 0.5, 1]) {
    const p = foot.clone().addScaledVector(across, s * RAMP.half)
    footY = Math.max(footY, groundY(p.x, p.z))
  }
  foot.setY(footY)
  return {
    landing: { u0, u1, vNear: DECK_DEPTH + JOINT, vFar },
    head,
    foot,
    dir,
    across,
    length,
    grade: (head.y - footY) / length,
  }
}

/**
 * The ramp as built: a retained solid (every section runs to 0.34 m under its
 * own local grade — it can never hover), integral kerbs, an apron at the foot
 * and a handrail each side whose posts stop under the rail soffit with the
 * project's 4 mm shadow gap.
 */
export function buildRamp(writer: PartWriter, spec: ArcPlatform, plan: RampPlan): void {
  const { landing, head, foot, dir, across, length } = plan
  const half = RAMP.half

  // ---- head landing. It abuts the deck's back fascia across a 28 mm movement
  // joint (whose floor is the landing's own shoulder 220 mm in, so the slot is
  // never open over a 1 m drop), and it SPLAYS: its uphill edge lies on the
  // deck's arc, its downhill edge IS the run's first section. Built as a plain
  // arc-aligned pad it left a triangular notch on each side, because the run
  // leaves at 33° to the radial — visible from the terrace as a hole under the
  // ramp.
  const nu = 6
  const nj = 6
  const landingRings: MVec3[][] = []
  for (let i = 0; i <= nu; i++) {
    const t = i / nu
    const v = landing.vNear + (landing.vFar - landing.vNear) * t
    const top: MVec3[] = []
    const bottom: MVec3[] = []
    for (let j = 0; j <= nj; j++) {
      const s = (j / nj) * 2 - 1
      const u = (landing.u0 + landing.u1) / 2 + (s * (landing.u1 - landing.u0)) / 2
      const arcY = platformDeckY(spec, u)
      const arc = platformPoint(spec, u, v, arcY)
      const run = head.clone().addScaledVector(across, s * half)
      const p = arc.clone().lerp(run, t)
      const y = arcY * (1 - t) + head.y * t
      // The shoulder: below the joint the pour runs on under the deck slab.
      const q = i === 0 ? platformPoint(spec, u, landing.vNear - 0.22, y) : p
      top.push([p.x, y, p.z])
      // Footing 0.20 m under the platform slab's own (`platformGroundY − 0.42`)
      // BY CONSTRUCTION. Sampled independently the two soffits agreed to a few
      // millimetres over a patch behind the deck — a coplanar pair, not a joint.
      bottom.push([q.x, platformGroundY(spec, u) - 0.62, q.z])
    }
    landingRings.push([...top, ...bottom.reverse()])
  }
  const landingMd = loft(landingRings, { closeV: true, capStart: true, capEnd: true })
  landingMd.frame = 'y-up'
  recalcNormals(landingMd)
  smoothShade(landingMd, SMOOTH.cast)
  writeInto(writer, 'cast', landingMd, { uvScale: 0.5 })

  // ---- the run. Sections march the centreline; each one is bedded under its
  // OWN grade, so an embankment wall appears wherever the ground falls away.
  const segments = Math.max(10, Math.round(length / 0.7))
  const runRings: MVec3[][] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const centre = head.clone().lerp(foot, t)
    const y = head.y + (foot.y - head.y) * t
    let low = Infinity
    for (const s of [-1, 0, 1]) {
      const p = centre.clone().addScaledVector(across, s * half)
      low = Math.min(low, groundY(p.x, p.z))
    }
    runRings.push(sectionRing(centre, across, half, y, Math.min(low, y) - 0.34, 0.05))
  }
  const runMd = loft(runRings, { closeV: true, capStart: true, capEnd: true })
  runMd.frame = 'y-up'
  recalcNormals(runMd)
  smoothShade(runMd, SMOOTH.cast)
  writeInto(writer, 'cast', runMd, { uvScale: 0.5 })

  // ---- kerbs: one swept upstand each side, running the landing AND the run
  // as a single member so the two pours never show a butt on the wheel line.
  // KERB_REVEAL sets the upstand 20 mm inside the slab's arris — flush, its
  // outer face was 0.86 m² of same-facing coplanar with the ramp's own side.
  const KERB_REVEAL = 0.02
  const kerbOffset = half - KERB_REVEAL - RAMP.kerb / 2
  const railOffset = half - RAMP.kerb - 0.09
  /** The landing's warp, shared by the pad, the kerbs and the rails, so no
   *  applied member can miss the run's first section. */
  const landingAt = (s: number, t: number, lift: number): Vector3 => {
    const u = (landing.u0 + landing.u1) / 2 + (s * (landing.u1 - landing.u0)) / 2
    const arcY = platformDeckY(spec, u)
    const v = landing.vNear + (landing.vFar - landing.vNear) * t
    const arc = platformPoint(spec, u, v, arcY)
    const run = head.clone().addScaledVector(across, s * half)
    return arc.lerp(run, t).setY(arcY * (1 - t) + head.y * t + lift)
  }
  for (const side of [-1, 1]) {
    const path: Vector3[] = []
    // Both ends of the run are BEDDED (the first and last stations drop below
    // the pour): a kerb that stops on a flat cap leaves a 130 mm block across
    // the threshold, which is a trip on the one route that may not have one.
    for (let i = 0; i <= 4; i++) {
      const lift = i === 0 ? -0.075 : RAMP.kerbLift / 2
      path.push(landingAt((side * kerbOffset) / half, i / 4, lift))
    }
    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      const centre = head.clone().lerp(foot, t)
      const y = head.y + (foot.y - head.y) * t
      const lift = i === segments ? -0.075 : RAMP.kerbLift / 2
      path.push(centre.addScaledVector(across, side * kerbOffset).setY(y + lift))
    }
    writer.tube({
      path,
      radius: RAMP.kerb / 2,
      slot: 'cast',
      profile: [
        new Vector2(-RAMP.kerb / 2, -0.22),
        new Vector2(RAMP.kerb / 2, -0.22),
        new Vector2(RAMP.kerb / 2, RAMP.kerbLift / 2 - 0.018),
        new Vector2(RAMP.kerb / 2 - 0.018, RAMP.kerbLift / 2),
        new Vector2(-RAMP.kerb / 2 + 0.018, RAMP.kerbLift / 2),
        new Vector2(-RAMP.kerb / 2, RAMP.kerbLift / 2 - 0.018),
      ],
      smoothAngle: SMOOTH.moulded,
    })
  }

  // ---- handrails. The run returns down 90 mm inside each end rather than
  // stopping on a capped disc in mid air, and the stanchions die 4 mm under
  // the rail's soffit (the shadow gap the guardrail shoe uses).
  const railLine = (side: number): Vector3[] => {
    const pts: Vector3[] = []
    for (let i = 0; i <= 2; i++) pts.push(landingAt((side * railOffset) / half, i / 2, 0))
    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      const centre = head.clone().lerp(foot, t)
      const y = head.y + (foot.y - head.y) * t
      pts.push(centre.addScaledVector(across, side * railOffset).setY(y))
    }
    return pts
  }
  for (const side of [-1, 1]) {
    const line = railLine(side)
    const lift = RAMP.railHeight
    // The canonical rail run: the axis is the walking line lifted to rail
    // height; `railRun` fillets the landing/slope knuckle and supplies both
    // returns, twist-free.
    railRun(
      writer,
      line.map((p) => p.clone().setY(p.y + lift)),
      { radius: 0.026, cornerRadius: 0.14 },
    )
    const posts = Math.max(5, Math.round((length + 2.2) / 1.6))
    for (let i = 0; i <= posts; i++) {
      const s = (i / posts) * (line.length - 1.001)
      const k = Math.floor(s)
      const p = line[k].clone().lerp(line[k + 1], s - k)
      railPost(writer, p, p.y + lift, {
        radius: 0.021,
        slot: 'dark',
        railRadius: 0.026,
        buried: true,
      })
    }
  }

  // ---- foot apron: takes the run's cross-fall onto the walk.
  groundApron(writer, {
    left: foot.clone().addScaledVector(across, -half),
    right: foot.clone().addScaledVector(across, half),
    outward: dir,
    depth: 1.3,
    inset: 0.3,
    overhang: 0.1,
  })
}

// -------------------------------------------------------------- canopy ----

/** Roof soffit datum. Per-u, because the deck carries the guideway's fall —
 *  a level canopy would open a wedge at one end. */
export function roofY(spec: ArcPlatform, u: number, v: number): number {
  return platformDeckY(spec, u) + CANOPY_HEIGHT + (v - V_FRONT) * ROOF_FALL
}

/** Underside of the rafter at (u, v) — the headroom ceiling under the canopy. */
export function rafterSoffit(spec: ArcPlatform, u: number, v: number): number {
  const t = Math.min(1, Math.abs(v - V_COLUMN) / (V_COLUMN - V_FRONT))
  return roofY(spec, u, v) - (0.4 - 0.25 * t)
}

/**
 * The glazed canopy: five tapered columns, tapered rafters, four purlins, a
 * real mullion/transom grid and glass captured under pressure caps.
 */
export function glazedCanopy(writer: PartWriter, spec: ArcPlatform): void {
  const uAt = (i: number): number => -CANOPY_ARC / 2 + (i * CANOPY_ARC) / CANOPY_BAYS
  const purlinV = [V_FRONT + 0.16, V_FRONT + 1.86, V_FRONT + 3.4, V_CANOPY_BACK - 0.16]

  // The rafter soffit over the column is `roofY(V_COLUMN) − 0.4`; the column
  // stops 15 mm inside it, and its foot is buried deeper than the base casting
  // so no two faces in the stack ever share a plane.
  const columnH = CANOPY_HEIGHT + (V_COLUMN - V_FRONT) * ROOF_FALL - 0.4 + 0.085
  const columnProfile: Vector2[] = [
    new Vector2(0.185, 0),
    new Vector2(0.185, 0.11),
    new Vector2(0.128, 0.19),
    new Vector2(0.104, columnH - 0.62),
    new Vector2(0.15, columnH - 0.18),
    new Vector2(0.15, columnH),
    new Vector2(0, columnH),
  ]

  for (let i = 0; i <= CANOPY_BAYS; i++) {
    const u = uAt(i)
    const yaw = yawOf(platformTangent(spec, u))
    writer.lathe({
      center: platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) - 0.07),
      profile: columnProfile,
      slot: 'steel',
      segments: 20,
      capStart: true,
      smoothAngle: SMOOTH.turned,
    })
    writer.box({
      center: platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) + 0.03),
      size: new Vector3(0.52, 0.14, 0.52),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.014,
    })
    // Rafter: deepest over the column, tapering to both tips.
    const silhouette: Array<[number, number]> = [
      [V_FRONT, roofY(spec, u, V_FRONT) - 0.02],
      [V_CANOPY_BACK, roofY(spec, u, V_CANOPY_BACK) - 0.02],
      [V_CANOPY_BACK, roofY(spec, u, V_CANOPY_BACK) - 0.15],
      [V_COLUMN, roofY(spec, u, V_COLUMN) - 0.4],
      [V_FRONT, roofY(spec, u, V_FRONT) - 0.15],
    ]
    const ring = (offset: number): MVec3[] =>
      silhouette.map(([v, y]) => {
        const p = platformPoint(spec, u + offset, v, y)
        return [p.x, p.y, p.z] as MVec3
      })
    const md = loft([ring(-0.06), ring(0.06)], { closeV: true, capStart: true, capEnd: true })
    md.frame = 'y-up'
    smoothShade(md, SMOOTH.moulded)
    writeInto(writer, 'steel', md, { uvScale: 0.7 })
  }

  // Purlins: slabs on the roof plane, not boxes. Each stops at the rafter faces.
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const u0 = uAt(bay) + 0.06
    const u1 = uAt(bay + 1) - 0.06
    for (const v of purlinV) {
      const top = (u: number): number => roofY(spec, u, v) - 0.026
      writer.slab(
        [
          platformPoint(spec, u0, v - 0.045, top(u0)),
          platformPoint(spec, u1, v - 0.045, top(u1)),
          platformPoint(spec, u1, v + 0.045, top(u1)),
          platformPoint(spec, u0, v + 0.045, top(u0)),
        ],
        0.2,
        'steel',
        0.6,
      )
    }
  }

  // Glazing: pane, then the pressure caps that hold it.
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    for (let row = 0; row < purlinV.length - 1; row++) {
      const u0 = uAt(bay) + 0.075
      const u1 = uAt(bay + 1) - 0.075
      const vA = purlinV[row] + 0.055
      const vB = purlinV[row + 1] - 0.055
      writer.slab(
        [
          platformPoint(spec, u0, vA, roofY(spec, u0, vA) - 0.02),
          platformPoint(spec, u1, vA, roofY(spec, u1, vA) - 0.02),
          platformPoint(spec, u1, vB, roofY(spec, u1, vB) - 0.02),
          platformPoint(spec, u0, vB, roofY(spec, u0, vB) - 0.02),
        ],
        0.014,
        'stationGlass',
      )
    }
  }
  // Pressure caps: rafter lines run the full depth, purlin lines stop short.
  for (let i = 0; i <= CANOPY_BAYS; i++) {
    const u = uAt(i)
    writer.slab(
      [
        platformPoint(spec, u - 0.055, V_FRONT, roofY(spec, u, V_FRONT) + 0.028),
        platformPoint(spec, u + 0.055, V_FRONT, roofY(spec, u, V_FRONT) + 0.028),
        platformPoint(spec, u + 0.055, V_CANOPY_BACK, roofY(spec, u, V_CANOPY_BACK) + 0.028),
        platformPoint(spec, u - 0.055, V_CANOPY_BACK, roofY(spec, u, V_CANOPY_BACK) + 0.028),
      ],
      0.06,
      'aluminum',
      0.6,
    )
  }
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const u0 = uAt(bay) + 0.065
    const u1 = uAt(bay + 1) - 0.065
    for (const v of purlinV) {
      const top = (u: number): number => roofY(spec, u, v) + 0.028
      writer.slab(
        [
          platformPoint(spec, u0, v - 0.055, top(u0)),
          platformPoint(spec, u1, v - 0.055, top(u1)),
          platformPoint(spec, u1, v + 0.055, top(u1)),
          platformPoint(spec, u0, v + 0.055, top(u0)),
        ],
        0.06,
        'aluminum',
        0.6,
      )
    }
  }

  // Gutter: ONE swept member along the arc.
  const gutterPath: Vector3[] = []
  for (let i = 0; i <= 12; i++) {
    const u = -CANOPY_ARC / 2 - 0.24 + ((CANOPY_ARC + 0.48) * i) / 12
    gutterPath.push(platformPoint(spec, u, V_FRONT - 0.1, roofY(spec, u, V_FRONT) - 0.12))
  }
  writer.tube({
    path: gutterPath,
    radius: 0.1,
    slot: 'dark',
    profile: [
      new Vector2(-0.095, -0.1),
      new Vector2(0.095, -0.1),
      new Vector2(0.095, 0.06),
      new Vector2(0.06, 0.1),
      new Vector2(-0.06, 0.1),
      new Vector2(-0.095, 0.06),
    ],
    smoothAngle: 34,
  })
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const uMid = (uAt(bay) + uAt(bay + 1)) / 2
    const span = uAt(bay + 1) - uAt(bay)
    const yaw = yawOf(platformTangent(spec, uMid))
    for (const offset of [-0.25, 0.25]) {
      const u = uMid + offset * span
      const v = (purlinV[1] + purlinV[2]) / 2
      writer.box({
        center: platformPoint(spec, u, v, roofY(spec, u, v) - 0.29),
        size: new Vector3(0.24, 0.1, 0.24),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.014,
      })
      writer.box({
        center: platformPoint(spec, u, v, roofY(spec, u, v) - 0.35),
        size: new Vector3(0.11, 0.022, 0.11),
        rotationY: yaw,
        slot: 'utilityLight',
      })
    }
  }
}

// ----------------------------------------------------------- windbreak ----

/** Arc spans of screen. Every gap between them is a route through the line. */
export function screenRuns(): Array<{ u0: number; u1: number }> {
  const half = DECK_ARC / 2
  return [
    { u0: -half, u1: GRAND_OPENING.u0 },
    { u0: GRAND_OPENING.u1, u1: RAMP_OPENING.u0 },
  ]
}

/** Depth of the glazed return that closes each end of a screen run. */
const RETURN_V = 0.75

/**
 * The screen along the back of the deck.
 *
 * It is a SCREEN, not a wall: it stops at every route and turns a glazed
 * return onto a real end post, so no pane and no rail ever dies in mid air
 * (the old build ran unbroken glass and an unbroken head rail straight across
 * the grand flight's head — a 5 m stair into a sealed window).
 */
export function buildWindbreak(writer: PartWriter, spec: ArcPlatform): void {
  const v = SCREEN_V
  const height = SCREEN_H
  const post = (u: number, vv: number, alongTangent: boolean): void => {
    const y = platformDeckY(spec, u)
    const p = platformPoint(spec, u, vv, y)
    const dir = alongTangent ? platformTangent(spec, u) : platformOutward(spec, u)
    const yaw = yawOf(dir)
    writer.box({
      center: p.clone().setY(y + height / 2 - 0.015),
      size: new Vector3(0.13, height + 0.07, 0.09),
      rotationY: yaw,
      slot: 'steel',
      chamfer: 0.01,
    })
    writer.box({
      center: p.clone().setY(y + 0.02),
      size: new Vector3(0.3, 0.08, 0.24),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.01,
    })
  }

  for (const run of screenRuns()) {
    const span = run.u1 - run.u0
    const bays = Math.max(1, Math.round(span / 3.2))
    for (let i = 0; i <= bays; i++) post(run.u0 + (span * i) / bays, v, true)
    // Glass, captured between the rails with a 20 mm bite top and bottom.
    for (let i = 0; i < bays; i++) {
      const uMid = run.u0 + (span * (i + 0.5)) / bays
      const y = platformDeckY(spec, uMid)
      writer.box({
        center: platformPoint(spec, uMid, v, y + (0.24 + height - 0.09) / 2),
        size: new Vector3(0.014, height - 0.35, span / bays - 0.34),
        rotationY: yawOf(platformTangent(spec, uMid)),
        slot: 'stationGlass',
      })
    }
    // Returns: a short glazed wing at each end, onto its own end post.
    for (const u of [run.u0, run.u1]) {
      post(u, v - RETURN_V, false)
      const vMid = v - RETURN_V / 2
      const y = platformDeckY(spec, u)
      writer.box({
        center: platformPoint(spec, u, vMid, y + (0.24 + height - 0.09) / 2),
        size: new Vector3(0.014, height - 0.35, RETURN_V - 0.26),
        rotationY: yawOf(platformOutward(spec, u)),
        slot: 'stationGlass',
      })
    }
    // Head and kick rails: ONE swept member per run, up the return, along the
    // arc and down the other return, with a radiused corner at each turn.
    for (const [lift, halfHeight] of [
      [height - 0.06, 0.06],
      [0.22, 0.05],
    ] as const) {
      const at3 = (u: number, vv: number): Vector3 =>
        platformPoint(spec, u, vv, platformDeckY(spec, u) + lift)
      const path: Vector3[] = []
      const R = 0.26
      path.push(at3(run.u0, v - RETURN_V - 0.09))
      path.push(at3(run.u0, v - R))
      path.push(at3(run.u0 + R * 0.29, v - R * 0.29))
      path.push(at3(run.u0 + R, v))
      const inner0 = run.u0 + R
      const inner1 = run.u1 - R
      for (let i = 1; i <= 14; i++) path.push(at3(inner0 + ((inner1 - inner0) * i) / 14, v))
      path.push(at3(run.u1 - R * 0.29, v - R * 0.29))
      path.push(at3(run.u1, v - R))
      path.push(at3(run.u1, v - RETURN_V - 0.09))
      writer.tube({
        path,
        radius: halfHeight,
        slot: 'steel',
        profile: [
          new Vector2(-0.045, -halfHeight),
          new Vector2(0.045, -halfHeight),
          new Vector2(0.045, halfHeight),
          new Vector2(-0.045, halfHeight),
        ],
        miter: true,
        smoothAngle: 34,
      })
    }
  }
}
