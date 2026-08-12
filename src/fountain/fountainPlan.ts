import { FOUNTAIN } from '../world/parkPlan'

/**
 * THE FOUNTAIN — one source of truth for every dimension.
 *
 * All Y values in this file are LOCAL: metres above the court's paved top
 * (`interiorHeight(FOUNTAIN.x, FOUNTAIN.z)`), which the system resolves once
 * at build time and adds. Nothing anywhere else may re-derive a fountain
 * datum; the water surface, the stonework, the streams and the spray all read
 * these numbers, and the whole point is that they cannot disagree — a jet
 * whose apex is authored against a different water line is the classic
 * "water floating above the pool" defect.
 *
 * Plan geometry: the basin's INNER face is a true circle (the water is round,
 * and the water shader's analytic ray-trace depends on that). The scalloped
 * outline of the reference is carried entirely by the OUTER face, which
 * breathes with a 12-lobe scallop and swells into four deep planter bays.
 */

export const FOUNTAIN_CENTER = { x: FOUNTAIN.x, z: FOUNTAIN.z }

/**
 * Mars surface gravity. Every ballistic arc, fall time and wave dispersion in
 * this feature is solved with it rather than with 9.81 — and it shows: jets
 * hang almost three times as long as an Earth fountain's, which is the single
 * most alien thing about watching this piece run.
 */
export const MARS_G = 3.721

/** Paved court radius (the region added to pavingPlan). */
export const COURT_RADIUS = FOUNTAIN.courtRadius

// ── the stylobate: two monumental steps up off the court ────────────────────

export const STYLOBATE_STEPS = [
  { radius: 9.3, top: 0.155 },
  { radius: 8.62, top: 0.31 },
] as const

/** Top of the top step — the datum the basin wall and floor are set out from. */
export const PODIUM_Y = STYLOBATE_STEPS[STYLOBATE_STEPS.length - 1].top

// ── the basin ───────────────────────────────────────────────────────────────

/** Inner face of the coping wall: the water's outer boundary. */
export const BASIN_INNER_R = 6.98
/** Radial thickness of the wall on the plain (sitting) sections. */
export const WALL_THICKNESS = 0.62
/** Coping top — a 0.525 m seat off the podium, the height people sit at. */
export const COPING_TOP_Y = PODIUM_Y + 0.525
/** Still-water level. 0.19 m of freeboard under the coping — a real reveal. */
export const WATER_Y = 0.645
/**
 * Basin floor. It dishes DOWN toward the island (see `basinFloorY`), and both
 * ends sit clear above `PODIUM_Y`: the floor slab is a course laid ON the
 * podium, so its underside buries inside the top step instead of meeting that
 * step's face. A floor that crossed the podium plane would z-fight along a
 * ring — the classic two-datum defect.
 */
export const BASIN_FLOOR_RIM_Y = PODIUM_Y + 0.065
export const BASIN_FLOOR_CENTER_Y = PODIUM_Y + 0.035

/** Outer-face scallop: 12 shallow lobes, ±85 mm — the reference's wavy plan. */
export const SCALLOP_LOBES = 12
export const SCALLOP_AMPLITUDE = 0.085

/** Four planter bays where the outer face swells out to hold soil. */
export const PLANTER_BAYS = 4
/** Extra radial thickness at a bay centre. */
export const BAY_SWELL = 0.66
/** Half-angle of a bay's full swell, radians (the ramp adds `BAY_RAMP`). */
export const BAY_HALF_ANGLE = 0.2
export const BAY_RAMP = 0.115
/** Soil surface and pocket floor, relative to the coping top. */
export const BAY_SOIL_DROP = 0.16
export const BAY_POCKET_DROP = 0.44

/**
 * The LED cove: a recess in the outer face carrying a continuous warm strip.
 * `y` is below the coping top; the lens sits `LENS_SETBACK` behind the face,
 * so the light is a grazing wash on the stone rather than a glowing decal.
 */
export const COVE_Y = 0.135
export const COVE_HEIGHT = 0.058
export const COVE_DEPTH = 0.045
export const LENS_SETBACK = 0.018

// ── the island: three steps, a moulded pedestal, the figure group ───────────

export const PLINTH_STEPS = [
  { radius: 2.42, top: 0.79 },
  { radius: 2.08, top: 1.03 },
  { radius: 1.74, top: 1.27 },
] as const

export const PEDESTAL_TOP_Y = 1.95
export const PEDESTAL_BASE_R = 1.36

/**
 * The sculpture ring on the pedestal cap: four DUST DEVILS turned to stone,
 * carrying the lower tazza (see `fountainVortices.ts`). Radius is where they
 * stand; their height is DERIVED — each column runs from the cap to the
 * tazza's underside, so re-authoring the bowl moves the sculpture with it.
 */
export const SCULPTURE_RADIUS = 0.86
export const SCULPTURE_COUNT = 4

/** The central column the figures stand around, carrying the tazza's load. */
export const COLUMN_RADIUS = 0.34

// ── the two tazze ───────────────────────────────────────────────────────────

export interface TazzaSpec {
  /** Underside height where the bowl meets its supporting shaft. */
  coreY: number
  /** Outer rim — the drip edge a curtain leaves from. */
  rimR: number
  rimTopY: number
  /** Lip of the dish inside the moulded rim. */
  dishRimR: number
  dishRimY: number
  dishCenterY: number
  dishCenterR: number
  /** Flute count and depth on the underside. */
  gadroons: number
  gadroonDepth: number
}

/**
 * Depth ratio matters more than any other number on a tazza. The first pass
 * gave the lower bowl 0.78 m of depth over a 2.68 m radius (0.29) and it read
 * as a DRUM — a table on a post. A classical tazza runs 0.40–0.45; at 1.20 m
 * over 2.68 m this one is 0.45, and the underside dome now has enough fall for
 * its gadroons to show instead of presenting a flat soffit.
 */
export const LOWER_TAZZA: TazzaSpec = {
  /** Underside where it meets the column. */
  coreY: 4.1,
  /** Outer rim: the drip edge the main curtain leaves from. */
  rimR: 2.68,
  rimTopY: 5.3,
  /** Lip of the dish inside the moulded rim. */
  dishRimR: 2.56,
  dishRimY: 5.24,
  /** Centre of the dish (the pool the upper curtain lands in). */
  dishCenterY: 4.86,
  dishCenterR: 0.3,
  /**
   * Gadroons: FEWER and DEEPER than the first pass. 36 shallow flutes on a
   * 5.4 m bowl are under a pixel at any honest viewing distance, so all they
   * did was soften the silhouette into mush.
   */
  gadroons: 28,
  gadroonDepth: 0.085,
}

export const UPPER_TAZZA: TazzaSpec = {
  coreY: 6.06,
  rimR: 1.06,
  rimTopY: 6.72,
  dishRimR: 0.97,
  dishRimY: 6.67,
  dishCenterY: 6.42,
  dishCenterR: 0.17,
  gadroons: 18,
  gadroonDepth: 0.048,
}

/** Crown nozzle: the top of the whole composition before the water. */
export const FINIAL_Y = 6.9

/** Height of a tazza's rim moulding — the band between dome and lip. */
export const TAZZA_RIM_BAND = 0.14

/**
 * The DRIP ARRIS: the outermost, lowest convex edge of the rim moulding — the
 * line the curtain actually sheds from. Water arrives over the lip from the
 * dish, runs down the ovolo's outer face, and leaves at the first edge where
 * the face turns back inward; everything below that edge is UNDERCUT so the
 * falling sheet clears the stone. Both the stone's moulding and the water's
 * launch read these two numbers — a sheet authored off any other line either
 * slices the moulding or floats off it.
 */
export function tazzaDripRadius(spec: TazzaSpec): number {
  return spec.rimR + 0.044
}
export function tazzaDripY(spec: TazzaSpec): number {
  return spec.rimTopY - TAZZA_RIM_BAND * 0.35
}

/**
 * The underside dome of a tazza at a plan radius — a cosine dome, steep at the
 * core and flattening under the rim. THE geometry and THE figures' reach both
 * read this, so a raised arm can never end in air or inside the bowl by more
 * than the 30 mm it is authored to bury.
 */
export function tazzaUndersideY(spec: TazzaSpec, radius: number): number {
  const t = Math.min(1, Math.max(0, (radius - spec.dishCenterR) / (spec.rimR - spec.dishCenterR)))
  // A blend of the two quarter-cosines. Pure `1 − cos` is flat at the core and
  // steep at the rim — a mushroom stalk, and the source of the first pass's
  // drum. Pure `sin` is steep at the core, which throws the rim beyond the
  // sculpture ring's reach. 55/45 gives a dome that genuinely falls away from
  // the rim and still lands over the vortex columns at SCULPTURE_RADIUS.
  const shape = 0.55 * Math.sin(t * Math.PI * 0.5) + 0.45 * (1 - Math.cos(t * Math.PI * 0.5))
  return spec.coreY + (spec.rimTopY - TAZZA_RIM_BAND - spec.coreY) * shape
}

// ── the waterworks ──────────────────────────────────────────────────────────

/**
 * The main curtain leaves the lower tazza's drip edge and lands here. The
 * outward drift is the overhang of the rim moulding plus the sheet's own
 * momentum; it must clear PLINTH_STEPS[0] or the curtain would break on stone.
 */
export const MAIN_CURTAIN_LAND_R = 2.78
/** The upper curtain falls into the lower dish. */
export const UPPER_CURTAIN_LAND_R = 1.12

/**
 * Strand counts.
 *
 * These are set from the STRAND WIDTH, not picked: a rim sheds ligaments a
 * couple of centimetres across, so the lane pitch has to be small enough that
 * a strand is a fraction of its lane rather than a plank. The lower rim's
 * 17.3 m circumference over 88 lanes is a 197 mm pitch, and the shader's
 * 0.14 half-width makes that a 27 mm strand. The first pass used 36 lanes at
 * a 0.2 half-width — a 96 mm strand — and the curtain rendered as a drum of
 * white bars that hid the entire figure group.
 */
export const MAIN_CURTAIN_STRANDS = 88
export const UPPER_CURTAIN_STRANDS = 40

/**
 * Arcing jets. Set A springs from the basin floor near the wall and arches
 * inward; set B springs from a ring just outside the curtain and arches
 * outward. They cross at different heights — the woven pattern of the
 * reference. Landing radii are DERIVED from the ballistic solve in
 * `waterStreams.ts`, but declared here because the ripple field's sources
 * must agree with where water actually lands.
 */
/**
 * Launch angle is `atan(4·rise / span)`. The first pass used a 1.55 m rise
 * over a 2.05 m span — 72°, a nearly vertical spout that reads as a garden
 * sprinkler. The reference's arcs are the long, low, generous ones a civic
 * fountain uses, so these are tuned to ~52°: a longer span and a lower rise.
 */
export const JETS_INWARD = {
  count: 16,
  nozzleR: 6.3,
  nozzleY: WATER_Y + 0.055,
  apexRise: 0.9,
  landR: 3.5,
  phase: 0,
} as const

export const JETS_OUTWARD = {
  count: 8,
  nozzleR: 3.15,
  nozzleY: WATER_Y + 0.075,
  apexRise: 0.78,
  landR: 5.55,
  phase: Math.PI / 8,
} as const

/** Crown plume: one vertical jet plus a bell of eight canted jets. */
export const CROWN = {
  riseY: 2.55,
  bellCount: 8,
  bellTilt: 0.34,
  bellRise: 1.45,
  bellLandR: 1.9,
} as const

/**
 * NOZZLE HEAD GEOMETRY — where the orifice actually is.
 *
 * `nozzleY` above is the plan's SETTING-OUT height, not the opening: the head
 * pivots at `nozzleY − NOZZLE_SHOULDER_DROP` and its mouth ring stands
 * `NOZZLE_MOUTH_REACH` further along the cant axis. So the real opening is
 * several centimetres up-and-over from the plan point, and water launched
 * from the plan point sprouts beside its own hardware — which is exactly the
 * defect this constant pair exists to prevent. `jetSolve` in `waterStreams`
 * derives the mouth from these, and `emitNozzle` builds the head from them.
 */
export const NOZZLE_SHOULDER_DROP = 0.055
export const NOZZLE_MOUTH_REACH = 0.121

/**
 * Submerged uplights. Set just OUTSIDE the curtain's landing ring, aimed back
 * in and up: they graze the outer face of the falling sheet, which is the only
 * placement that makes a curtain glow rather than silhouette.
 */
export const UPLIGHTS = { count: 12, radius: 3.16 } as const

// ── derived helpers shared by stone, water and streams ──────────────────────

/** Basin floor height at a plan radius — a shallow dish toward the middle. */
export function basinFloorY(radius: number): number {
  const t = Math.min(1, Math.max(0, (radius - PLINTH_STEPS[0].radius) / (BASIN_INNER_R - PLINTH_STEPS[0].radius)))
  const eased = t * t * (3 - 2 * t)
  return BASIN_FLOOR_CENTER_Y + (BASIN_FLOOR_RIM_Y - BASIN_FLOOR_CENTER_Y) * eased
}

/** Outer-face radial thickness of the coping wall at a plan bearing. */
export function wallThickness(theta: number): number {
  let t = WALL_THICKNESS + SCALLOP_AMPLITUDE * Math.cos(SCALLOP_LOBES * theta)
  t += BAY_SWELL * bayWeight(theta)
  return t
}

export interface PlanterBay {
  /** Bearing of the bay centre, radians. */
  theta: number
  /** Half the bay's usable arc, radians. */
  halfArc: number
  rInner: number
  rOuter: number
  /** Soil surface, in LOCAL fountain height. */
  soilY: number
}

/**
 * The four planter bays, derived from the same weight function the coping's
 * geometry is swept with. Pure plan: the stonework builds soil into these and
 * the vegetation system plants into them, from ONE description, so a bay can
 * never be planted where the wall did not open a pocket.
 */
export function planterBays(): PlanterBay[] {
  const bays: PlanterBay[] = []
  for (let b = 0; b < PLANTER_BAYS; b++) {
    const theta = (b / PLANTER_BAYS) * (Math.PI * 2)
    let halfArc = 0
    for (let a = 0; a < 0.45; a += 0.004) if (bayWeight(theta + a) > 0.15) halfArc = a
    bays.push({
      theta,
      halfArc: halfArc * 0.86,
      rInner: BASIN_INNER_R + 0.45,
      rOuter: BASIN_INNER_R + wallThickness(theta) - 0.35,
      soilY: COPING_TOP_Y - BAY_SOIL_DROP,
    })
  }
  return bays
}

/** 0 outside a planter bay, 1 at its centre, smooth across the ramp. */
export function bayWeight(theta: number): number {
  const step = (Math.PI * 2) / PLANTER_BAYS
  // Bearing to the nearest bay centre (bays sit on the scallop's crests).
  const wrapped = theta - Math.round(theta / step) * step
  const d = Math.abs(wrapped)
  if (d <= BAY_HALF_ANGLE) return 1
  if (d >= BAY_HALF_ANGLE + BAY_RAMP) return 0
  const u = 1 - (d - BAY_HALF_ANGLE) / BAY_RAMP
  return u * u * (3 - 2 * u)
}
