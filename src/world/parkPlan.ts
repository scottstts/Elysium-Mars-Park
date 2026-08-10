import { Vector2 } from 'three'

/**
 * THE single source of truth for Elysium Commons' layout (plan §3).
 * Every system reads positions, paths, and pads from here — nothing
 * hardcodes world placement elsewhere. +X east, +Z south, meters.
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

export const FIRST_TREE = { x: 0, z: 0, plazaRadius: 17, soilRingRadius: 7.2 }

/** Platform sits INSIDE the loop track (track passes its south edge z≈205). */
export const PORTAL_STATION = { x: 0, z: 194, y: 1.35, width: 40, depth: 20 }

export const OVERLOOK_LOUNGE = { x: -206, z: -14, y: 0.9, width: 26, depth: 12 }

export const AMPHITHEATER = { x: -86, z: 58, bowlRadius: 46, depth: 3.4 }

export const RESIDENTIAL = {
  arcRadius: 178,
  /** Angles (rad, from +X axis, CCW toward −Z i.e. north) for 10 habs. */
  angles: Array.from({ length: 10 }, (_, i) => Math.PI + 0.16 + i * 0.115),
  commonHabIndex: 6,
}

export const PLAYGROUND = { x: -128, z: -98, radius: 14 }

export const FARMSIDE = {
  glasshouses: [
    { x: 168, z: -26, length: 58, width: 12, rotation: Math.PI / 2 },
    { x: 168, z: 8, length: 58, width: 12, rotation: Math.PI / 2 },
    { x: 168, z: 42, length: 58, width: 12, rotation: Math.PI / 2 },
  ],
}

export const WORKS = {
  machineHall: { x: 96, z: -128, width: 34, depth: 20, rotation: 0.35 },
  tankFarm: { x: 148, z: -102, radius: 22 },
  maintenanceYard: { x: 66, z: -158, radius: 18 },
  radiators: { x: 178, z: -66, rows: 4 },
}

/** The Loop: closed tram circuit, three stations. */
export const LOOP = {
  radius: 206,
  stations: [
    { id: 'portal', angle: Math.PI / 2 },
    { id: 'overlook', angle: Math.PI + 0.07 },
    { id: 'farmside', angle: 0.05 },
  ],
}

export const GARDENS: GardenZone[] = [
  { id: 'gardens-main', x: -52, z: -64, radius: 46 },
  { id: 'gardens-south', x: -18, z: 96, radius: 26 },
]

const v = (x: number, z: number): Vector2 => new Vector2(x, z)

export const PATHS: PathSpec[] = [
  {
    id: 'meridian-south',
    points: [v(0, 181), v(-2, 158), v(4, 118), v(-3, 62), v(0, 20)],
    width: 5.2,
    surface: 'paver',
  },
  {
    id: 'meridian-west',
    points: [v(-14, -6), v(-62, -14), v(-118, -16), v(-168, -14), v(-198, -13)],
    width: 4.4,
    surface: 'paver',
  },
  {
    id: 'rim-promenade',
    points: Array.from({ length: 25 }, (_, i) => {
      const angle = (i / 24) * Math.PI * 2
      return v(Math.cos(angle) * 236, Math.sin(angle) * 236)
    }),
    width: 4.0,
    surface: 'paver',
  },
  {
    id: 'residential-lane',
    points: [v(-30, -22), v(-78, -52), v(-118, -76), v(-148, -96), v(-166, -74), v(-172, -40)],
    width: 3.2,
    surface: 'paver',
  },
  {
    id: 'farm-lane',
    points: [v(16, 8), v(64, 14), v(108, 10), v(138, 4)],
    width: 3.6,
    surface: 'paver',
  },
  {
    id: 'works-lane',
    points: [v(24, -18), v(58, -52), v(76, -92), v(88, -116)],
    width: 3.2,
    surface: 'track',
  },
  {
    id: 'amphitheater-spur',
    points: [v(-36, 10), v(-58, 28), v(-74, 44)],
    width: 3.4,
    surface: 'paver',
  },
  {
    id: 'gardens-loop',
    points: [
      v(-24, -34),
      v(-48, -28),
      v(-78, -44),
      v(-84, -72),
      v(-64, -94),
      v(-36, -90),
      v(-22, -66),
      v(-24, -34),
    ],
    width: 2.6,
    surface: 'track',
  },
]

export const PADS: PadSpec[] = [
  { id: 'first-tree-plaza', x: 0, z: 0, y: 0.55, radius: FIRST_TREE.plazaRadius, skirt: 9 },
  { id: 'portal-station', x: 0, z: 194, y: 1.35, radius: 25, skirt: 12 },
  // Poured apron where the station stairs land — a deterministic 4-step drop.
  { id: 'station-foot', x: 0, z: 176.5, y: 0.72, radius: 7, skirt: 6 },
  { id: 'overlook', x: -206, z: -14, y: 0.9, radius: 17, skirt: 8 },
  // Stage/orchestra flat ONLY — the seat rows (radius 16-39) must ride the
  // authored dish in interiorHeight, or the bowl has no rake at all.
  { id: 'amphitheater', x: -86, z: 58, y: -2.4, radius: 12, skirt: 8 },
  { id: 'farmside', x: 168, z: 8, y: 0.7, radius: 44, skirt: 14 },
  { id: 'works', x: 108, z: -124, y: 0.6, radius: 46, skirt: 16 },
  { id: 'yard', x: 66, z: -158, y: 0.5, radius: 20, skirt: 10 },
  { id: 'playground', x: -128, z: -98, y: 0.4, radius: 15, skirt: 8 },
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
