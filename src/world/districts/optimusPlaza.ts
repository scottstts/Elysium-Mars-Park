import { Vector2, Vector3 } from 'three'
import { interiorHeight } from '../interiorHeight'
import { OPTIMUS_COURT } from '../parkPlan'
import { buildOptimusSign } from './optimusSign'
import type { PartWriter } from '../../archkit/writer'
import type { DistrictServices } from './types'

/**
 * THE OPTIMUS PLINTH — a round cast-mineral platform on the court disc, with
 * four straight flights on the cardinal bearings and eight humanoids standing
 * on top. The figures themselves are NOT built here: they are an instanced
 * asset owned by `robots/optimusExhibit.ts`; this module owns the ground the
 * exhibit stands on, and publishes the deck datum and the eight stances so
 * the two can never disagree about where the deck top is.
 *
 * CRAFT NOTES (why the shape is what it is)
 *
 * 1. The plinth is ONE lathe, not an assembly. Deck field, edge chamfer,
 *    fascia, shadow reveal, toe and the buried skirt are all points on a
 *    single revolved profile, so there is no seam anywhere on the object and
 *    no pair of faces that could ever go coplanar. A stack of cylinders would
 *    have put a horizontal joint at every datum change.
 *
 * 2. Each flight is ONE extruded prism, not a stack of tread boxes. Stacked
 *    boxes share their side faces exactly — four coplanar walls per flight,
 *    which is the classic flicker. Sweeping the staircase profile across the
 *    flight width gives a watertight solid whose only planar surfaces are the
 *    treads you actually walk on.
 *
 * 3. The flights stop one riser BELOW the deck: the last 0.15 m rise is the
 *    plinth's own fascia. That is what keeps rule 1 and rule 2 from meeting —
 *    a flight that carried its top tread to deck level would put a tread face
 *    in the same plane as the deck disc over the whole overlap. Each prism's
 *    inner end is instead buried 0.4 m inside the drum, where the lathe's
 *    closed shell hides it.
 */

/** Plinth geometry, all LOCAL to the court's paved top. */
export const PLINTH = {
  /** Slab radius (the deck's outer edge). */
  radius: 6.0,
  /** Deck top above the court paving. */
  height: 0.6,
  riser: 0.15,
  tread: 0.36,
  flightWidth: 2.4,
  /** Chamfer on the deck's outer edge. */
  nosing: 0.022,
  /** Skirt depth below the court paving (buried, hides the pour seam). */
  skirt: 0.3,
  /**
   * The deck is a real slab of dark marble, not a painted-on finish: 75 mm
   * of stone whose edge band you can read from the court, oversailing the
   * cast drum by 22 mm so the joint throws a shadow line instead of being a
   * colour change on a flush face. The oversail lands 75 mm above the top
   * tread, which is a stair nosing's overhang and behaves like one.
   */
  slab: 0.075,
  slabOversail: 0.022,
} as const

/** Radius of the cast drum below the slab. */
const DRUM_RADIUS = PLINTH.radius - PLINTH.slabOversail

/** The four cardinal bearings a flight climbs, as yaw about +Y. */
const FLIGHT_BEARINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const

/** Treads per flight. The fourth rise is the plinth's own fascia (see §3). */
const FLIGHT_STEPS = 3

/** How far a flight's inner end runs past the drum radius, into the shell. */
const FLIGHT_BURY = 0.4

/** How far a flight's ground line sits BELOW the court paving. A flight that
 *  closed at exactly the slab top would put its downward face in the paving's
 *  plane — the one coplanar pair this shape can produce. Buried inside the
 *  slab's 0.36 m skirt, it is simply never drawn. */
const FLIGHT_SINK = 0.06

/**
 * The formation: two ranks of four, all facing +X — head-on to the east
 * flight, which is where `optimus-spur` lands. 2.4 m along the rank and 3.0 m
 * between ranks leaves ~1.8 m of clear floor between neighbouring shoulders,
 * so the deck is walk-through rather than a crowd.
 */
const RANK_PITCH = 2.4
const RANK_GAP = 3.0

export interface OptimusStance {
  /** World position of the figure's SOLE (the model's origin). */
  position: Vector3
  /** Yaw about +Y. */
  yaw: number
}

/** Court centre in world XZ, and the deck top's world Y. */
export function plinthAnchor(): { centre: Vector2; courtY: number; deckY: number } {
  const centre = new Vector2(OPTIMUS_COURT.x, OPTIMUS_COURT.z)
  // The court is a paved disc, so interiorHeight already carries PAVE.rise.
  const courtY = interiorHeight(centre.x, centre.y)
  return { centre, courtY, deckY: courtY + PLINTH.height }
}

/**
 * Where the eight stand, in world space. Read by the exhibit system to write
 * its instance matrices — the plinth is the single source of truth for the
 * deck datum, so the figures can never float or sink.
 */
export function optimusStances(): OptimusStance[] {
  const { centre, deckY } = plinthAnchor()
  const stances: OptimusStance[] = []
  for (const rank of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const z = (i - 1.5) * RANK_PITCH
      stances.push({
        position: new Vector3(centre.x + (rank * RANK_GAP) / 2, deckY, centre.y + z),
        yaw: Math.PI / 2,
      })
    }
  }
  return stances
}

export function buildOptimusPlaza(services: DistrictServices): void {
  const { writer, colliders } = services
  const { centre, courtY } = plinthAnchor()
  const origin = new Vector3(centre.x, courtY, centre.y)

  buildPlinth(writer, origin)
  for (const yaw of FLIGHT_BEARINGS) buildFlight(writer, origin, yaw)
  buildOptimusSign(writer, colliders)

  // Physics: the drum as a cylinder, each flight as a stepped stack of thin
  // boxes. The player walks up a flight the way they walk up the station
  // stairs — one box per tread, sized to the tread it sits under.
  colliders.push({
    kind: 'cylinder',
    center: new Vector3(origin.x, courtY + PLINTH.height / 2, origin.z),
    halfHeight: PLINTH.height / 2,
    radius: PLINTH.radius,
  })
  // The figures are solid to the player: a guest who can walk through a
  // 1.7 m machine standing at arm's length stops believing it is there.
  // A 0.30 m cylinder is the shoulder-to-shoulder footprint, not the
  // silhouette — reaching past an outstretched hand is fine, walking through
  // the torso is not.
  for (const stance of optimusStances()) {
    colliders.push({
      kind: 'cylinder',
      center: new Vector3(stance.position.x, stance.position.y + 0.87, stance.position.z),
      halfHeight: 0.87,
      radius: 0.3,
    })
  }

  for (const yaw of FLIGHT_BEARINGS) {
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    for (let step = 0; step < FLIGHT_STEPS; step++) {
      // Tread `step` runs from its nosing back to the drum. The boxes nest
      // (each is a slab from the drum out to its own nosing) so the stack has
      // no gap a descending player could drop through, and 0.5 m of thickness
      // is deep enough that no frame time tunnels it.
      const nosing = PLINTH.radius + (FLIGHT_STEPS - step) * PLINTH.tread
      const depth = nosing - PLINTH.radius
      const top = courtY + (step + 1) * PLINTH.riser
      const centreDistance = PLINTH.radius + depth / 2
      colliders.push({
        kind: 'box',
        center: new Vector3(
          origin.x + forward.x * centreDistance,
          top - 0.25,
          origin.z + forward.z * centreDistance,
        ),
        size: new Vector3(PLINTH.flightWidth, 0.5, depth),
        yaw,
      })
    }
  }
}

/**
 * The plinth: TWO revolved profiles, each a CLOSED solid in its own right.
 *
 * BOTH ENDS OF EVERY LATHE PROFILE MUST LAND ON THE AXIS. `revolve` orients a
 * closed shell for you whichever way the profile is authored, but an OPEN
 * profile takes its orientation from the profile's direction — and
 * `axis → outward` comes out inside-out, which culls the surface and leaves
 * you looking through the object. Splitting one closed lathe into two open
 * ones to give the deck its own material is exactly how that happens; it cost
 * a shipped frame where the marble deck simply was not there.
 *
 * So the two solids OVERLAP instead of sharing a rim: the drum's top disc is
 * buried 20 mm inside the slab, where the slab's own shell hides it. Same
 * rule as the sign frame — where two members meet, one contains the other's
 * boundary completely.
 *
 * Concentric rings across the deck field keep the top from being a fan of
 * 6 m triangles — per-vertex terms in the image pipeline band badly across
 * spans that long.
 */
function buildPlinth(writer: PartWriter, origin: Vector3): void {
  const R = PLINTH.radius
  const H = PLINTH.height
  const slabUnder = H - PLINTH.slab

  // ---- the marble slab: top field, chamfered edge, edge band, soffit,
  // closing on the axis.
  const slabProfile: Vector2[] = []
  const rings = 7
  for (let i = 0; i <= rings; i++) slabProfile.push(new Vector2((i / rings) * (R - 0.09), H))
  slabProfile.push(new Vector2(R - PLINTH.nosing, H))
  slabProfile.push(new Vector2(R, H - PLINTH.nosing))
  // The band you actually read the thickness off, then an arris so the
  // bottom edge is not a knife edge, then the soffit home to the axis.
  slabProfile.push(new Vector2(R, slabUnder + 0.012))
  slabProfile.push(new Vector2(R - 0.012, slabUnder))
  slabProfile.push(new Vector2(0, slabUnder))

  writer.lathe({
    center: origin,
    profile: slabProfile,
    slot: 'darkStone',
    segments: 128,
    uvScale: 0.5,
    smoothAngle: 22,
  })

  // ---- the cast drum. Its top disc sits INSIDE the slab, so the pair reads
  // as one object with no coincident faces anywhere.
  const drumTop = slabUnder + 0.02
  const drumProfile: Vector2[] = [
    new Vector2(0, drumTop),
    new Vector2(DRUM_RADIUS, drumTop),
    new Vector2(DRUM_RADIUS, 0.16),
    // Base reveal — a 30 mm groove low on the fascia, articulating the drum's
    // foot the way the slab articulates its head. The flights bury the four
    // arcs where they land, which is exactly what a real reveal does.
    new Vector2(DRUM_RADIUS - 0.03, 0.13),
    new Vector2(DRUM_RADIUS - 0.03, 0.1),
    new Vector2(DRUM_RADIUS, 0.07),
    // Toe, then straight down into the pour.
    new Vector2(DRUM_RADIUS + 0.045, 0.022),
    new Vector2(DRUM_RADIUS + 0.045, 0),
    new Vector2(DRUM_RADIUS + 0.045, -PLINTH.skirt),
    new Vector2(0, -PLINTH.skirt),
  ]

  writer.lathe({
    center: origin,
    profile: drumProfile,
    slot: 'cast',
    segments: 128,
    uvScale: 0.5,
    smoothAngle: 22,
  })
}

/**
 * One flight as an extruded staircase prism.
 *
 * Profile is authored in (radial distance from the plinth axis, height above
 * the court) and swept across `flightWidth`. The inner end runs 0.4 m past
 * the drum radius so the lathe's shell covers it; the outer end drops to the
 * court and returns along the ground, closing the solid.
 */
function buildFlight(writer: PartWriter, origin: Vector3, yaw: number): void {
  const R = PLINTH.radius
  const steps = FLIGHT_STEPS
  const halfWidth = PLINTH.flightWidth / 2
  const bury = R - FLIGHT_BURY
  const outer = R + steps * PLINTH.tread
  const toe = PLINTH.nosing

  // Staircase outline in (radius, height), walked CLOCKWISE from the buried
  // inner end: out along the top tread, down each riser, round the toe, then
  // back along the buried ground line.
  const outline: Vector2[] = [new Vector2(bury, steps * PLINTH.riser)]
  for (let step = steps; step >= 1; step--) {
    const nosing = R + (steps - step + 1) * PLINTH.tread
    outline.push(new Vector2(nosing, step * PLINTH.riser))
    // The bottom riser meets the court with a toe chamfer rather than a knife
    // edge — the same detail the plinth's own toe carries.
    outline.push(new Vector2(nosing, step === 1 ? toe : (step - 1) * PLINTH.riser))
  }
  outline.push(new Vector2(outer - toe, 0))
  outline.push(new Vector2(outer - toe, -FLIGHT_SINK))
  outline.push(new Vector2(bury, -FLIGHT_SINK))

  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // Local (radial, up, across) → world.
  const at = (radial: number, up: number, across: number): Vector3 =>
    new Vector3(
      origin.x + radial * sin + across * cos,
      origin.y + up,
      origin.z + radial * cos - across * sin,
    )

  // Swept boundary: one quad per profile edge, wound so the normal faces out.
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i]
    const b = outline[i + 1]
    writer.quad(
      'cast',
      at(a.x, a.y, -halfWidth),
      at(b.x, b.y, -halfWidth),
      at(b.x, b.y, halfWidth),
      at(a.x, a.y, halfWidth),
      0.5,
    )
  }

  // Cheeks. The outline is monotone in radius, so each side wall decomposes
  // into one trapezoid per tread run — a tessellated plane, never a pair of
  // overlapping faces. `[r0, r1, top, bottom0, bottom1]`; only the toe band
  // has a sloped bottom.
  const bands: Array<[number, number, number, number, number]> = []
  for (let j = 0; j < steps; j++) {
    const r0 = j === 0 ? bury : R + j * PLINTH.tread
    const r1 = R + (j + 1) * PLINTH.tread
    const top = (steps - j) * PLINTH.riser
    if (j === steps - 1) {
      bands.push([r0, r1 - toe, top, -FLIGHT_SINK, -FLIGHT_SINK])
      bands.push([r1 - toe, r1, top, -FLIGHT_SINK, toe])
    } else {
      bands.push([r0, r1, top, -FLIGHT_SINK, -FLIGHT_SINK])
    }
  }

  for (const side of [-1, 1]) {
    const across = side * halfWidth
    for (const [r0, r1, top, b0, b1] of bands) {
      if (r1 - r0 <= 1e-4) continue
      // On the +across face the outward normal is +side, which is the
      // bottom→top→top→bottom order; the −across face is its mirror.
      const corners: [Vector3, Vector3, Vector3, Vector3] =
        side > 0
          ? [at(r0, b0, across), at(r0, top, across), at(r1, top, across), at(r1, b1, across)]
          : [at(r0, b0, across), at(r1, b1, across), at(r1, top, across), at(r0, top, across)]
      writer.quad('cast', corners[0], corners[1], corners[2], corners[3], 0.5)
    }
  }
}
