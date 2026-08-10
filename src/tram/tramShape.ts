import type { Vec2, Vec3 } from './tramMesh'

/**
 * THE LOOP — car body: one queryable analytic surface, sampled by everything
 * else (experience-craft §5.2.1). Nothing on this vehicle is placed by eye:
 * every pane, door leaf, moulding, decal and rail is `hullPoint(z, s, inset)`
 * with a signed inset — positive sinks into the skin (no gap, no coincident
 * face), negative stands proud (no coplanar pair).
 *
 * Local frame: origin on the CABIN FLOOR at the car's centre, +Z forward,
 * +X left (the platform side at all three stops). `tramSystem` places the
 * group at guideway point + 0.62 m, so y = 0 here is the floor datum and the
 * beam top is y = −0.62.
 *
 *   D — the design contract, metres
 *   overall 8.00 long · 2.60 wide · 3.03 above the beam top
 *   floor 0.00 · sill 0.98 · door head 1.94 · cant 1.99 · ceiling 2.18
 *   crown 2.428 · skirt −0.40 · bogie tunnel roof −0.055
 */

export const CAR_LENGTH = 8
export const CAR_WIDTH = 2.6
export const HALF_LENGTH = CAR_LENGTH / 2

/** Beam top in car-local Y (tramSystem lifts the group 0.62 above it). */
export const BEAM_TOP_Y = -0.62
/** Guideway running surface: beam top + the 50 mm wear strip (track.ts). */
export const RUNNING_Y = -0.57
/** Guideway beam half width — the guide wheels grip these flanks. */
export const BEAM_HALF_W = 0.675

// ---------------------------------------------------------- section tables
//
// Every table is the +X half, ordered so that "right of travel" is OUTWARD
// (tramMesh's one convention). The full 52-point closed loop is assembled by
// mirroring, so left and right can never drift apart.

/** Belly → beltline, with the bogie tunnel (the straight middle of the car). */
const LOWER_OUTER_TUNNEL: Vec2[] = [
  [0.0, -0.055],
  [0.4, -0.055],
  [0.62, -0.058],
  [0.7, -0.09],
  [0.782, -0.194],
  [0.846, -0.32],
  [0.878, -0.402],
  [1.03, -0.418],
  [1.128, -0.374],
  [1.208, -0.268],
  [1.262, 0.0], // 10 — door sill / floor line
  [1.288, 0.23],
  [1.3, 0.52], // 12 — maximum width
  [1.298, 0.8],
  [1.292, 0.98], // 14 — beltline
]

/** Same section with the tunnel faired out — the nose and tail cones. */
const LOWER_OUTER_SOLID: Vec2[] = [
  [0.0, -0.3],
  [0.4, -0.315],
  [0.62, -0.336],
  [0.7, -0.347],
  [0.782, -0.361],
  [0.846, -0.373],
  [0.878, -0.38],
  [1.03, -0.418],
  [1.128, -0.374],
  [1.208, -0.268],
  [1.262, 0.0],
  [1.288, 0.23],
  [1.3, 0.52],
  [1.298, 0.8],
  [1.292, 0.98],
]

/** Inner lining: FLAT cabin floor out to the sidewall, then up the wall. */
const LOWER_INNER_CABIN: Vec2[] = [
  [0.0, 0.0],
  [0.36, 0.0],
  [0.56, 0.0],
  [0.7, 0.0],
  [0.83, 0.0],
  [0.95, 0.0],
  [1.06, 0.0],
  [1.13, 0.0],
  [1.175, 0.0],
  [1.196, 0.0],
  [1.207, 0.0], // 10 — floor edge
  [1.233, 0.23],
  [1.245, 0.52],
  [1.243, 0.8],
  [1.237, 0.98],
]

/** Inner lining in the cones: a constant-thickness shell, no cabin floor. */
const LOWER_INNER_SOLID: Vec2[] = [
  [0.0, -0.245],
  [0.398, -0.26],
  [0.616, -0.281],
  [0.695, -0.292],
  [0.775, -0.306],
  [0.836, -0.319],
  [0.866, -0.326],
  [1.022, -0.363],
  [1.078, -0.335],
  [1.15, -0.245],
  [1.207, 0.0],
  [1.233, 0.23],
  [1.245, 0.52],
  [1.243, 0.8],
  [1.237, 0.98],
]

/** Beltline → door head; the glazing band leans in with the tumblehome. */
const WINDOW_OUTER: Vec2[] = [
  [1.284, 1.25],
  [1.264, 1.545],
  [1.24, 1.775],
  [1.214, 1.94], // 18 — door head
]
const WINDOW_INNER: Vec2[] = [
  [1.229, 1.25],
  [1.209, 1.545],
  [1.185, 1.775],
  [1.159, 1.94],
]

const CANT_OUTER: Vec2 = [1.198, 1.99]
const CANT_INNER: Vec2 = [1.143, 1.99]

/** Cant → crown. The lining is a FLATTER arc: the wall thickens to 0.25 m
 *  over the centreline, which is the HVAC plenum, so no separate ceiling
 *  panel is needed and there is no hidden double surface to z-fight. */
const ROOF_OUTER: Vec2[] = [
  [1.168, 2.098],
  [1.108, 2.196],
  [1.01, 2.286],
  [0.865, 2.352],
  [0.64, 2.398],
  [0.34, 2.421],
]
const ROOF_INNER: Vec2[] = [
  [1.118, 2.052],
  [1.045, 2.098],
  [0.94, 2.132],
  [0.79, 2.152],
  [0.575, 2.166],
  [0.295, 2.174],
]
const CROWN_OUTER: Vec2 = [0.0, 2.428]
const CROWN_INNER: Vec2 = [0.0, 2.178]

/** Semantic indices into the 52-point closed section loop. */
export const IDX = {
  BELLY: 0,
  CHINE_R: 9,
  SILL_R: 10,
  BELT_R: 14,
  DOOR_HEAD_R: 18,
  CANT_R: 19,
  CROWN: 26,
  CANT_L: 33,
  DOOR_HEAD_L: 34,
  BELT_L: 38,
  SILL_L: 42,
  COUNT: 52,
} as const

function assembleLoop(
  lower: Vec2[],
  window: Vec2[],
  cant: Vec2,
  roof: Vec2[],
  crown: Vec2,
): Vec2[] {
  const half: Vec2[] = [...lower, ...window, cant, ...roof]
  const out: Vec2[] = [...half.map((p) => [p[0], p[1]] as Vec2), [crown[0], crown[1]]]
  for (let i = half.length - 1; i >= 1; i--) out.push([-half[i][0], half[i][1]])
  return out
}

// The tables the loop is built from, pre-assembled once.
const LOOP_OUTER_TUNNEL = assembleLoop(LOWER_OUTER_TUNNEL, WINDOW_OUTER, CANT_OUTER, ROOF_OUTER, CROWN_OUTER)
const LOOP_OUTER_SOLID = assembleLoop(LOWER_OUTER_SOLID, WINDOW_OUTER, CANT_OUTER, ROOF_OUTER, CROWN_OUTER)
const LOOP_INNER_CABIN = assembleLoop(LOWER_INNER_CABIN, WINDOW_INNER, CANT_INNER, ROOF_INNER, CROWN_INNER)
const LOOP_INNER_SOLID = assembleLoop(LOWER_INNER_SOLID, WINDOW_INNER, CANT_INNER, ROOF_INNER, CROWN_INNER)

// ------------------------------------------------------------ door bay recess
//
// The whole door bay (leaves + both pockets) is a 52 mm scallop in the
// bodyside, so the external sliding leaves finish 6 mm inside the surrounding
// skin — a reveal, never flush (geometry-craft §3).

export const DOOR_HALF = 0.88
export const DOOR_RECESS = 0.052
const BAY_FLAT = 1.86
const BAY_RAMP = 1.98

/** Per-section-index share of the recess: 0 below the chine, full over the
 *  door, faired back out into the roof so the cant does not step. */
const RECESS_BY_INDEX: number[] = (() => {
  const table = new Array<number>(IDX.COUNT).fill(0)
  table[IDX.CHINE_R] = 0.5
  for (let j = IDX.SILL_R; j <= IDX.DOOR_HEAD_R; j++) table[j] = 1
  table[IDX.CANT_R] = 0.75
  table[IDX.CANT_R + 1] = 0.35
  return table
})()

function recessAt(z: number): number {
  const a = Math.abs(z)
  if (a <= BAY_FLAT) return DOOR_RECESS
  if (a >= BAY_RAMP) return 0
  const t = (BAY_RAMP - a) / (BAY_RAMP - BAY_FLAT)
  return DOOR_RECESS * t * t * (3 - 2 * t)
}

const TUNNEL_FADE_START = 2.95
const TUNNEL_FADE_END = 3.78

function tunnelBlend(z: number): number {
  const a = Math.abs(z)
  if (a <= TUNNEL_FADE_START) return 1
  if (a >= TUNNEL_FADE_END) return 0
  const t = 1 - (a - TUNNEL_FADE_START) / (TUNNEL_FADE_END - TUNNEL_FADE_START)
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------- taper
//
// Nose and tail: lateral pinch, a vertical squeeze about the waist, and a
// height-proportional rearward rake. The chin leads, the crown trails by
// 0.80 m — a raked cab mask, not a chopped box.

const NOSE_START = 2.85
const NOSE_LEN = HALF_LENGTH - NOSE_START
const RAKE = 0.8
const PIVOT_Y = 0.95

export interface Taper {
  u: number
  sx: number
  sy: number
  rake: number
  sgn: number
}

export function taperAt(z: number): Taper {
  const a = Math.abs(z)
  const u = Math.max(0, Math.min(1, (a - NOSE_START) / NOSE_LEN))
  return {
    u,
    sx: 1 - 0.3 * Math.pow(u, 1.7),
    sy: 1 - 0.17 * Math.pow(u, 1.8),
    rake: RAKE * Math.pow(u, 1.25),
    sgn: z < 0 ? -1 : 1,
  }
}

/** Lift a section-plane point into the tapered body surface. */
export function taperApply(p: Vec2, z: number, taper = taperAt(z)): Vec3 {
  const heightShare = Math.max(0, Math.min(1, (p[1] - 0.55) / 1.88))
  return [
    p[0] * taper.sx,
    PIVOT_Y + (p[1] - PIVOT_Y) * taper.sy,
    z - taper.sgn * taper.rake * heightShare,
  ]
}

// ------------------------------------------------------------ section query

export interface SectionPair {
  outer: Vec2[]
  inner: Vec2[]
}

const sectionCache = new Map<string, SectionPair>()

/** The section loop at `z`, with the tunnel fade and door-bay recess baked
 *  in. Cached: every part in the build asks for the same handful of z's. */
export function sectionAt(z: number, withRecess = true): SectionPair {
  const key = `${z.toFixed(5)}|${withRecess ? 1 : 0}`
  const hit = sectionCache.get(key)
  if (hit) return hit
  const blend = tunnelBlend(z)
  const recess = withRecess ? recessAt(z) : 0
  const outer: Vec2[] = []
  const inner: Vec2[] = []
  for (let j = 0; j < IDX.COUNT; j++) {
    const ox = LOOP_OUTER_TUNNEL[j][0] * blend + LOOP_OUTER_SOLID[j][0] * (1 - blend)
    const oy = LOOP_OUTER_TUNNEL[j][1] * blend + LOOP_OUTER_SOLID[j][1] * (1 - blend)
    const ix = LOOP_INNER_CABIN[j][0] * blend + LOOP_INNER_SOLID[j][0] * (1 - blend)
    const iy = LOOP_INNER_CABIN[j][1] * blend + LOOP_INNER_SOLID[j][1] * (1 - blend)
    const cut = recess * RECESS_BY_INDEX[j]
    outer.push([ox - cut, oy])
    inner.push([ix - cut, iy])
  }
  const pair = { outer, inner }
  sectionCache.set(key, pair)
  return pair
}

/** Outward normal of the section polyline at continuous index `s`. */
function sectionNormal(loop: Vec2[], s: number): Vec2 {
  const n = loop.length
  const i = Math.floor(s)
  const a = loop[((i % n) + n) % n]
  const b = loop[((i + 1) % n + n) % n]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy) || 1
  return [dy / l, -dx / l]
}

function lerpLoop(loop: Vec2[], s: number): Vec2 {
  const n = loop.length
  const i = Math.floor(s)
  const t = s - i
  const a = loop[((i % n) + n) % n]
  const b = loop[((i + 1) % n + n) % n]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/**
 * THE query. `s` is a continuous section index; `inset` is metres INTO the
 * body (negative stands proud). Panes, door leaves, mouldings and decals all
 * come from here, which is why nothing on this car floats or z-fights.
 */
export function hullPoint(z: number, s: number, inset = 0, withRecess = true): Vec3 {
  const loop = sectionAt(z, withRecess).outer
  const p = lerpLoop(loop, s)
  const n = sectionNormal(loop, s)
  return taperApply([p[0] - n[0] * inset, p[1] - n[1] * inset], z)
}

/** Post-taper outward normal, by central differences of the surface. */
export function hullNormal(z: number, s: number, withRecess = true): Vec3 {
  const dz = 0.02
  const ds = 0.06
  const a = hullPoint(z - dz, s, 0, withRecess)
  const b = hullPoint(z + dz, s, 0, withRecess)
  const c = hullPoint(z, s - ds, 0, withRecess)
  const d = hullPoint(z, s + ds, 0, withRecess)
  const t: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const u: Vec3 = [d[0] - c[0], d[1] - c[1], d[2] - c[2]]
  const nx = u[1] * t[2] - u[2] * t[1]
  const ny = u[2] * t[0] - u[0] * t[2]
  const nz = u[0] * t[1] - u[1] * t[0]
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

/** Inner-lining counterpart of `hullPoint` (cabin surfaces). */
export function liningPoint(z: number, s: number, inset = 0, withRecess = true): Vec3 {
  const loop = sectionAt(z, withRecess).inner
  const p = lerpLoop(loop, s)
  const n = sectionNormal(loop, s)
  return taperApply([p[0] - n[0] * inset, p[1] - n[1] * inset], z)
}

/** Continuous section index for a cabin height on the +X sidewall. */
export function sillParamForY(y: number): number {
  const loop = LOOP_OUTER_TUNNEL
  for (let j = IDX.SILL_R; j < IDX.CANT_R; j++) {
    if (y >= loop[j][1] && y <= loop[j + 1][1]) {
      return j + (y - loop[j][1]) / (loop[j + 1][1] - loop[j][1])
    }
  }
  return y < loop[IDX.SILL_R][1] ? IDX.SILL_R : IDX.CANT_R
}

/** Interior half width of the cabin at a height, for placing furniture. */
export function cabinHalfWidth(y: number, z = 0): number {
  const loop = sectionAt(z).inner
  for (let j = IDX.SILL_R; j < IDX.CANT_R; j++) {
    if (y >= loop[j][1] && y <= loop[j + 1][1]) {
      const t = (y - loop[j][1]) / (loop[j + 1][1] - loop[j][1])
      return loop[j][0] + (loop[j + 1][0] - loop[j][0]) * t
    }
  }
  return loop[IDX.SILL_R][0]
}

/** Interior ceiling height on the centreline / at a given x. */
export function ceilingY(x: number): number {
  const half = [...ROOF_INNER].reverse()
  const pts: Vec2[] = [CROWN_INNER, ...half, CANT_INNER]
  const ax = Math.abs(x)
  for (let i = 0; i < pts.length - 1; i++) {
    if (ax >= pts[i][0] && ax <= pts[i + 1][0]) {
      const t = (ax - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    }
  }
  return CANT_INNER[1]
}

// -------------------------------------------------------------- z stations
//
// Every aperture edge, recess ramp and pocket boundary is an exact station,
// so no hole is ever cut across a quad.

export const STATIONS: number[] = (() => {
  const half = [
    0.0, 0.3, 0.55, 0.86, 0.88, 0.94, 0.98, 1.14, 1.32, 1.56, 1.86, 1.92, 1.98, 2.14, 2.38, 2.62,
    2.86, 2.95, 3.1, 3.24, 3.4, 3.54, 3.68, 3.8, 3.9, 4.0,
  ]
  const out: number[] = []
  for (let i = half.length - 1; i >= 1; i--) out.push(-half[i])
  out.push(...half)
  return out
})()

// ------------------------------------------------------------- apertures

export interface Aperture {
  z0: number
  z1: number
  /** Inclusive cell range in section-index space. */
  j0: number
  j1: number
  kind: 'window' | 'door'
}

/**
 * +X carries the doors, so it gets long end panes and two solid pockets;
 * −X gets a five-pane band whose middle pane matches the door width.
 *
 * The end panes run to |z| = 3.40, INTO the cone, as raked quarter-lights.
 * That is not styling: the arrival seat is at z = 2.42 facing forward, and
 * stopping the glazing at the cone start put a 1.1 m blind wall across the
 * one view the whole opening sequence is built around.
 */
const QUARTER = 3.74

export const APERTURES: Aperture[] = [
  { z0: -DOOR_HALF, z1: DOOR_HALF, j0: IDX.SILL_R, j1: IDX.DOOR_HEAD_R - 1, kind: 'door' },
  { z0: -QUARTER, z1: -1.98, j0: IDX.BELT_R, j1: IDX.CANT_R - 1, kind: 'window' },
  { z0: 1.98, z1: QUARTER, j0: IDX.BELT_R, j1: IDX.CANT_R - 1, kind: 'window' },
  { z0: -QUARTER, z1: -1.98, j0: IDX.CANT_L, j1: IDX.BELT_L - 1, kind: 'window' },
  { z0: -1.86, z1: -0.94, j0: IDX.CANT_L, j1: IDX.BELT_L - 1, kind: 'window' },
  { z0: -0.86, z1: 0.86, j0: IDX.CANT_L, j1: IDX.BELT_L - 1, kind: 'window' },
  { z0: 0.94, z1: 1.86, j0: IDX.CANT_L, j1: IDX.BELT_L - 1, kind: 'window' },
  { z0: 1.98, z1: QUARTER, j0: IDX.CANT_L, j1: IDX.BELT_L - 1, kind: 'window' },
]

/** Cabin furniture datums, all traceable back to the section tables. */
export const CABIN = {
  floorY: 0.006,
  seatY: 0.456,
  benchHalfWidth: 0.47,
  benchCentreX: 0.72,
  benchZ: 2.42,
  doorPoleX: 0.3,
  doorPoleZ: 1.16,
  consoleZ: 3.34,
} as const
