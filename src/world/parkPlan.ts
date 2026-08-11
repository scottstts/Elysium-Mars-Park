import { Vector2 } from 'three'

/**
 * THE single source of truth for Elysium Commons' layout (plan §3).
 * Every system reads positions, paths, and pads from here — nothing
 * hardcodes world placement elsewhere. +X east, +Z south, meters.
 *
 * 2026-08-10 OVERHAUL: dome shrunk 500 m → 260 m and the layout re-laid
 * plaza-centric for reference-image density (ref_images/mars_park.png).
 * The park is now a paved civic floor — central plaza around the First
 * Tree, a transit boulevard carrying the street-running Loop, planter-lined
 * spokes — with buildings fronting the paving and raw regolith kept to
 * feature gardens and the rim band. Green lives dense in raised planters
 * (per the reference), never as lawn.
 *
 * Bearings recap (design.md): Portal Station S, Overlook + Amphitheater W
 * (facing the frozen WSW sun), Residential Arc NW, Farmside E, The Works NE,
 * First Tree at origin, Regolith Gardens between center and the SW rim.
 */

export interface PathSpec {
  id: string
  /** Polyline control points (Catmull-Rom through these). */
  points: Vector2[]
  width: number
  /** Sintered pavers ('paver') or compacted fines ('track'). */
  surface: 'paver' | 'track'
}

export interface PadSpec {
  id: string
  x: number
  z: number
  /** Flat elevation of the pad surface. */
  y: number
  radius: number
  /** Blend skirt width from pad edge back to natural terrain. */
  skirt: number
}

export interface GardenZone {
  id: string
  x: number
  z: number
  radius: number
}

/** Global envelope: usable floor inside the dome foot (glass lands at 130). */
export const PARK = {
  floorRadius: 122,
  /** Rim promenade centerline radius (the walk along the glass). */
  rimWalkRadius: 112,
}

export const FIRST_TREE = { x: 0, z: 0, plazaRadius: 26, soilRingRadius: 5.5 }

/**
 * The transit boulevard: a paved ring band carrying the Loop guideway
 * (street-running, rails inset in the paving like the reference image).
 */
export const BOULEVARD = { innerRadius: 91, outerRadius: 103 }

/** Platform sits INSIDE the loop track (track passes its south edge z≈97). */
export const PORTAL_STATION = { x: 0, z: 97, y: 0.9, width: 30, depth: 13 }

/** Where the connector tube crosses the dome wall on the south axis. */
export const PORTAL_WALL_Z = 128.4

export const OVERLOOK_LOUNGE = { x: -114, z: -6, y: 0.8, width: 20, depth: 11 }

/** Bowl outer edge (center r + bowlRadius) must stay inside BOULEVARD.innerRadius. */
export const AMPHITHEATER = { x: -52, z: 34, bowlRadius: 24, depth: 2.6 }

/**
 * The Commons pavilion: sealed two-story glass drum anchoring the plaza's
 * north edge (the reference image's centerpiece building). Lit interior
 * visible through the glazing; entrances closed until the city arrives.
 */
export const COMMONS = { x: -2, z: -54, radius: 11, y: 0.55 }

/**
 * Hydroponics tower: sealed three-story glass cylinder of planted shelves
 * (the reference image's "62" building), glowing green on the farm lane.
 */
export const HYDRO_TOWER = { x: 52, z: 18, radius: 7, floors: 3, y: 0.55 }

/** White water tower over The Works — the skyline landmark. */
export const WATER_TOWER = { x: 66, z: -34, height: 17 }

/**
 * FREEDOM TOWER — the park's landmark: a hyperboloid steel lattice spire on
 * the open ground between the plaza and the south-east boulevard, carrying a
 * glass gallery deck just beneath the dome shell. `doorAngle` is the plan
 * bearing of the elevator door axis (points from the tower axis toward the
 * approach walk — the boarding lobby, the gallery lobby and the glass cab
 * all sit on this line). Everything else about the tower — deck height, spire
 * tip, cab travel — is DERIVED in `districts/freedomTower.ts` from this
 * anchor plus the dome-shell constants, so the tower always fits the glass.
 */
export const FREEDOM_TOWER = { x: 33, z: 57, terraceRadius: 12.76, doorAngle: Math.PI + 0.21 }

export const RESIDENTIAL = {
  arcRadius: 88,
  /** Angles (rad, from +X axis, CCW toward −Z i.e. north) for 10 habs. */
  angles: Array.from({ length: 10 }, (_, i) => Math.PI + 0.18 + i * 0.115),
  commonHabIndex: 6,
}

/** Between the Commons and the arc's south end — clear of habs 4/5 and the
 * gardens zone (the old (−62,−54) spot sat inside two hab footprints). */
export const PLAYGROUND = { x: -22, z: -70, radius: 9 }

/** Glasshouse east ends stop at x=87 — clear of the boulevard (r≥91). */
export const FARMSIDE = {
  glasshouses: [
    { x: 70, z: -22, length: 34, width: 9, rotation: Math.PI / 2 },
    { x: 70, z: 0, length: 34, width: 9, rotation: Math.PI / 2 },
    { x: 70, z: 22, length: 34, width: 9, rotation: Math.PI / 2 },
  ],
}

/**
 * Works cluster pulled INSIDE the boulevard (structure extents must clear
 * r≈94.5, the guideway swept volume) — except the radiator field, which
 * lives in the outer band between boulevard (103) and rim walk (112).
 */
export const WORKS = {
  machineHall: { x: 48, z: -58, width: 26, depth: 15, rotation: 0.35 },
  tankFarm: { x: 70, z: -40, radius: 11 },
  maintenanceYard: { x: 28, z: -70, radius: 13 },
  radiators: { x: 104, z: -34, rows: 4 },
}

/** The Loop: closed street-running circuit in the boulevard, three stations. */
export const LOOP = {
  radius: 97,
  stations: [
    { id: 'portal', angle: Math.PI / 2 },
    { id: 'overlook', angle: Math.PI + 0.07 },
    { id: 'farmside', angle: 0.05 },
  ],
}

/**
 * The arrival spur's plan alignment (world XZ), tube portal → loop merge.
 * `tram/track.ts` owns the vertical profile over these stations;
 * `pavingPlan.ts` cuts the boulevard's recessed spur corridor from the same
 * spine. One list, so the corridor and the trackbed can never disagree.
 */
export const ARRIVAL_SPINE: ReadonlyArray<readonly [number, number]> = [
  [0, 420],
  [0, 340],
  [0, 268],
  [0, 210],
  [0, 168],
  [0, 152],
  [0, 138],
  [0, 128],
  [-0.6, 122.5],
  [-2.1, 117],
  [-3.4, 113.6],
  [-4.6, 109.5],
  [-5.05, 104],
  [-3.6, 99.4],
  [-1.5, 97.3],
  [0, 97],
]

export const GARDENS: GardenZone[] = [
  { id: 'gardens-main', x: -38, z: -40, radius: 28 },
  { id: 'gardens-south', x: -12, z: 60, radius: 16 },
]

const v = (x: number, z: number): Vector2 => new Vector2(x, z)

export const PATHS: PathSpec[] = [
  {
    id: 'meridian-south',
    points: [v(0, 90), v(-1, 72), v(2, 50), v(0, 28)],
    width: 6.0,
    surface: 'paver',
  },
  {
    id: 'meridian-west',
    points: [v(-26, -2), v(-52, -5), v(-78, -3), v(-96, -2), v(-107, -4)],
    width: 5.0,
    surface: 'paver',
  },
  {
    id: 'rim-promenade',
    points: Array.from({ length: 25 }, (_, i) => {
      const angle = (i / 24) * Math.PI * 2
      return v(Math.cos(angle) * PARK.rimWalkRadius, Math.sin(angle) * PARK.rimWalkRadius)
    }),
    width: 3.6,
    surface: 'paver',
  },
  {
    id: 'residential-lane',
    points: [v(-30, -14), v(-52, -30), v(-68, -44), v(-79, -56), v(-84, -44), v(-88, -30)],
    width: 3.4,
    surface: 'paver',
  },
  {
    id: 'farm-lane',
    // Ends AT the Farmside station's step-free ramp: the ribbon runout
    // (pavingPlan) runs the last leg on to the ramp's discharge apron, so the
    // accessible route reads station → lane → the RANGE halls. Without it the
    // ramp dumped onto raw regolith in the service yard — the owner's
    // "leads nowhere" structure.
    points: [v(26, 6), v(40, 12), v(52, 18), v(66, 14), v(80, 8)],
    width: 4.5,
    surface: 'paver',
  },
  {
    id: 'works-lane',
    // Continues to the maintenance yard: the yard's three charge bays had no
    // circulation reaching them at all (plausibility-audit finding). Ends at
    // the yard pour's north-east apron.
    points: [v(18, -19), v(28, -36), v(36, -48), v(42, -54), v(38, -61), v(31.5, -66.5)],
    width: 3.4,
    surface: 'track',
  },
  {
    id: 'amphitheater-spur',
    points: [v(-22, 12), v(-34, 22), v(-44, 28)],
    width: 3.8,
    surface: 'paver',
  },
  {
    id: 'tower-walk',
    // Meridian Walk → Freedom Tower. The last point sits INSIDE the tower's
    // 'freedom-terrace' paving region so the two pours share one watertight
    // clipped seam (the ribbon is trimmed against the higher-priority disc —
    // ending short would leave a crescent of bare regolith at the doorstep).
    points: [v(2, 50), v(12, 52), v(22.6, 54.8)],
    width: 3.6,
    surface: 'paver',
  },
  {
    id: 'gardens-loop',
    points: [
      v(-22, -26),
      v(-38, -22),
      v(-54, -32),
      v(-58, -46),
      v(-46, -58),
      v(-30, -54),
      v(-22, -40),
      v(-22, -26),
    ],
    width: 2.4,
    surface: 'track',
  },
]

export const PADS: PadSpec[] = [
  { id: 'first-tree-plaza', x: 0, z: 0, y: 0.55, radius: FIRST_TREE.plazaRadius, skirt: 8 },
  { id: 'portal-station', x: 0, z: 97, y: 0.9, radius: 16, skirt: 8 },
  // Poured apron where the station stairs land — a deterministic 4-step drop.
  { id: 'station-foot', x: 0, z: 86, y: 0.45, radius: 6, skirt: 5 },
  { id: 'overlook', x: -114, z: -6, y: 0.8, radius: 13, skirt: 6 },
  // Stage/orchestra flat ONLY — the seat rows must ride the authored dish
  // in interiorHeight, or the bowl has no rake at all.
  { id: 'amphitheater', x: -64, z: 39, y: -1.8, radius: 8, skirt: 6 },
  { id: 'commons', x: -2, z: -54, y: 0.55, radius: 14, skirt: 7 },
  { id: 'hydro-tower', x: 52, z: 18, y: 0.55, radius: 10, skirt: 5 },
  { id: 'farmside', x: 70, z: 0, y: 0.6, radius: 26, skirt: 10 },
  // Freedom Tower site: flat ground under the terrace + lattice footing.
  { id: 'freedom-tower', x: FREEDOM_TOWER.x, z: FREEDOM_TOWER.z, y: 0.55, radius: 13, skirt: 7 },
  { id: 'works', x: 50, z: -56, y: 0.5, radius: 34, skirt: 12 },
  { id: 'yard', x: 28, z: -70, y: 0.4, radius: 15, skirt: 8 },
  { id: 'playground', x: -22, z: -70, y: 0.4, radius: 10, skirt: 6 },
]

/** Hab pad positions derived from the arc (porches face the park center). */
export function habSites(): Array<{ x: number; z: number; angle: number; common: boolean }> {
  return RESIDENTIAL.angles.map((angle, index) => ({
    x: Math.cos(angle) * RESIDENTIAL.arcRadius,
    z: Math.sin(angle) * RESIDENTIAL.arcRadius,
    angle,
    common: index === RESIDENTIAL.commonHabIndex,
  }))
}
