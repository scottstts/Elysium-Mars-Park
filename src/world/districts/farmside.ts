import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  float,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  normalWorld,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  BEVEL,
  SMOOTH,
  annularPrism,
  bevel,
  box,
  buildGroup,
  chamferRect,
  circle,
  panelWithHoles,
  placeYaw,
  polyArea,
  prism,
  prismXZ,
  prismYZ,
  recalcNormals,
  revolve,
  rotX,
  roundedRect,
  runMolding,
  smoothShade,
  toYUp,
  translate,
  tubeAlong,
  writeInto,
  type Hole,
  type MeshData,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { PartWriter } from '../../archkit/writer'
import { kitMaterials, signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { FARMSIDE } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * FARMSIDE — three vaulted glasshouse ranges, the reclaim tank that serves
 * them, and the working depot the tram passes on the outer band.
 *
 * ## Authoring frame
 *
 * Everything is authored in a **house-local Z-up frame** (archkit convention,
 * `dev_docs/craft/geometry-craft.md` §2):
 *
 *     +X = across the span (9 m, -4.5 .. +4.5)
 *     +Y = along the range (34 m, -17 .. +17; -Y is the lane end / the door)
 *     +Z = up from the FLOOR datum (z = 0 is the interior slab top)
 *
 * `place()` runs `toYUp()` + `placeYaw()` once at emit, so local +Y lands on
 * the house's `along` direction and local +X on its `across`. Plan polygons
 * are therefore literally the plan, and section profiles are (across, up).
 *
 * ## The section is an analytic surface, not a stack of parts
 *
 * `sectionPoint(u)` walks the cross-section by arc length — straight glazed
 * haunch, circular vault, straight haunch — and `sectionOffset(u, a)` offsets
 * it along the outward normal. **Every member, pane, gutter, rail and vent is
 * generated from that one function with a signed offset** (the hull-sample
 * method, `experience-craft.md` §5.2): positive `a` stands proud, negative `a`
 * sits inside. Nothing is positioned "next to" anything, so coplanar faces,
 * floats and gaps cannot be authored by accident.
 *
 * ## Frame hierarchy — the rule that removes clashes without booleans
 *
 *   ribs land on cast shoes  ->  bars bed into the base track  ->  transoms
 *   stop 1 mm short of the bar base flanges  ->  panes stop short of both.
 *
 * Ribs and bars both run ALONG the section, so they never cross; transoms run
 * along the range between them. Vent openings TRIM the bars (the run is split)
 * instead of being pasted over them.
 *
 * ## Datums
 *
 *   groundMax  = max interiorHeight over the footprint
 *   FLOOR      = groundMax + 0.055   the slab top; never coplanar with the
 *                                    regolith or the paved apron beneath
 *   FOUND_TOP  = FLOOR + 0.14        concrete upstand top
 *   TRACK_TOP  = FLOOR + 0.19        aluminium base track top
 *   SILL_Z     = FLOOR + 0.20        the glazing datum's origin
 *
 * The apron under the ranges is poured by `world/paving.ts`; nothing here
 * slabs over it.
 */

// ─────────────────────────────────────────────────────────────── layout (m)

const HOUSE_LENGTH = FARMSIDE.glasshouses[0].length
const HOUSE_WIDTH = FARMSIDE.glasshouses[0].width
const HALF_SPAN = HOUSE_WIDTH / 2
const HALF_LENGTH = HOUSE_LENGTH / 2

/** Slab top above the highest ground the footprint meets (ground rule: >30 mm). */
const FLOOR_PROUD = 0.055
const FOUND_TOP = 0.14
const TRACK_TOP = 0.19
const SILL_Z = 0.2
/** Foundation top width: -0.25 inboard to +0.19 outboard of the glazing datum. */
const FOUND_IN = 0.25
const FOUND_OUT = 0.19
/** Eaves kink — where the haunch meets the vault and the gutter hangs. */
const EAVES_Z = 1.1
const CROWN_Z = 5.05

const RISE = CROWN_Z - EAVES_Z
const ARC_R = (HALF_SPAN * HALF_SPAN + RISE * RISE) / (2 * RISE)
const ARC_C = CROWN_Z - ARC_R
const SPRING_PHI = Math.atan2(EAVES_Z - ARC_C, HALF_SPAN)
const ARC_LEN = ARC_R * (Math.PI - 2 * SPRING_PHI)
const HAUNCH_LEN = EAVES_Z - SILL_Z
const SECTION_LEN = 2 * HAUNCH_LEN + ARC_LEN

/** 12 structural bays; every bay carries 3 intermediate glazing bars. */
const RIB_BAYS = 12
const BARS_PER_BAY = 4
const BAR_STATIONS = RIB_BAYS * BARS_PER_BAY
const BAR_PITCH = HOUSE_LENGTH / BAR_STATIONS
/** 11 pane rows up the vault, 4 path stations each (max sagitta 3 mm). */
const ARC_ROWS = 11
const ARC_STEPS = ARC_ROWS * 4
/** Panes stop this far short of the sill. */
const PANE_MARGIN = 0.035
/** Ribs land on their shoes here; bars bed 38 mm into the base track. */
const RIB_FOOT_U = 0.02
const BAR_BED_U = -0.038

/** Rack plan: three shelving runs with two 1.7 m aisles between them. */
export const RACK_ACROSS = [-3.1, 0, 3.1] as const
export const RACK_DEPTH = 1.4
export const RACK_LENGTH = 29.6
export const RACK_TIERS = 4
export const RACK_TIER_0 = 0.46
export const RACK_TIER_PITCH = 0.52
export const AISLE_ACROSS = [-1.55, 1.55] as const

/**
 * Gable module: eight 1.125 m bays. The doorway occupies exactly one bay, and
 * that bay's two mullions ARE its jambs at their own (heavier) section — so
 * the clear opening is the distance between two real reveal faces, not a
 * number invented next to a grid line. Both gables of all three ranges carry
 * the same assembly: these are walk-through ranges.
 */
const GABLE_MULLIONS = Array.from({ length: 9 }, (_, i) => -HALF_SPAN + i * (HOUSE_WIDTH / 8))
const DOOR_BAY = 5
/** Trimmer-post half section (the jambs) and ordinary mullion half section. */
const JAMB_HALF = 0.055
const MULLION_HALF = 0.032
export const DOOR_ACROSS = (GABLE_MULLIONS[DOOR_BAY] + GABLE_MULLIONS[DOOR_BAY + 1]) / 2
/** Clear opening between the two jamb reveal faces — 1.015 m. */
export const DOOR_CLEAR_WIDTH = HOUSE_WIDTH / 8 - 2 * JAMB_HALF
export const DOOR_HEAD_Z = 2.3
export const DOOR_LEFT = DOOR_ACROSS - DOOR_CLEAR_WIDTH / 2
export const DOOR_RIGHT = DOOR_ACROSS + DOOR_CLEAR_WIDTH / 2
/** The leaf slides toward +across on both gables; travel clears the reveal. */
export const DOOR_SLIDE = DOOR_CLEAR_WIDTH + 0.175
/** Interior clear half-width (inside the foundation upstand). */
export const INTERIOR_HALF_SPAN = HALF_SPAN - FOUND_IN
export const HOUSE_HALF_LENGTH = HALF_LENGTH

// ───────────────────────────────────────────────────── the section surface

interface SectionSample {
  a: number
  z: number
  na: number
  nz: number
}

/** Walk the cross-section by arc length from the -X sill to the +X sill. */
function sectionPoint(u: number): SectionSample {
  if (u <= HAUNCH_LEN) return { a: -HALF_SPAN, z: SILL_Z + u, na: -1, nz: 0 }
  if (u <= HAUNCH_LEN + ARC_LEN) {
    const phi = Math.PI - SPRING_PHI - (u - HAUNCH_LEN) / ARC_R
    return { a: ARC_R * Math.cos(phi), z: ARC_C + ARC_R * Math.sin(phi), na: Math.cos(phi), nz: Math.sin(phi) }
  }
  return { a: HALF_SPAN, z: EAVES_Z - (u - HAUNCH_LEN - ARC_LEN), na: 1, nz: 0 }
}

/** The section offset along its outward normal — the whole grammar. */
function sectionOffset(u: number, a: number): Vec2 {
  const s = sectionPoint(u)
  return [s.a + s.na * a, s.z + s.nz * a]
}

const SECTION_STATIONS: number[] = (() => {
  const out = [0, HAUNCH_LEN * 0.5, HAUNCH_LEN]
  for (let i = 1; i <= ARC_STEPS; i++) out.push(HAUNCH_LEN + (i / ARC_STEPS) * ARC_LEN)
  out.push(HAUNCH_LEN + ARC_LEN + HAUNCH_LEN * 0.5, SECTION_LEN)
  return out
})()

/** Pane row boundaries: one haunch row, 11 arc rows, one haunch row. */
const ROW_U: number[] = (() => {
  const out = [PANE_MARGIN, HAUNCH_LEN]
  for (let i = 1; i <= ARC_ROWS; i++) out.push(HAUNCH_LEN + (i / ARC_ROWS) * ARC_LEN)
  out.push(SECTION_LEN - PANE_MARGIN)
  return out
})()

function sectionPath(u0: number, u1: number, along: number, inset = 0): Vec3[] {
  const out: Vec3[] = []
  const push = (u: number): void => {
    const [a, z] = sectionOffset(u, inset)
    out.push([a, along, z])
  }
  push(u0)
  for (const u of SECTION_STATIONS) if (u > u0 + 1e-4 && u < u1 - 1e-4) push(u)
  push(u1)
  return out
}

// ────────────────────────────────────────────────────── extrusion profiles

/**
 * Closed outline of a stack of centred rectangles — how every extruded
 * aluminium section here is drawn. `bands` are `[halfWidth, aLow, aHigh]` in
 * increasing `a`. Profile coordinates are `(a = outward from the glazing
 * datum, b = along the range)`, which is exactly `tubeAlong`'s frame once the
 * section path is swept with `up = +Y`.
 */
function steppedSection(bands: Array<[number, number, number]>): Vec2[] {
  const pts: Vec2[] = []
  for (const [half, lo, hi] of bands) pts.push([lo, half], [hi, half])
  for (let i = bands.length - 1; i >= 0; i--) {
    const [half, lo, hi] = bands[i]
    pts.push([hi, -half], [lo, -half])
  }
  const out: Vec2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p)
  }
  return out
}

/** Intermediate glazing bar: base flange, neck, cap. 48 mm face. */
const BAR_PROFILE = steppedSection([
  [0.026, -0.023, -0.01],
  [0.009, -0.01, 0.006],
  [0.024, 0.006, 0.019],
])
/** Primary arch rib: the same glazing head on a 190 mm deep I-section. */
const RIB_PROFILE = steppedSection([
  [0.058, -0.192, -0.176],
  [0.017, -0.176, -0.026],
  [0.038, -0.026, -0.01],
  [0.014, -0.01, 0.006],
  [0.032, 0.006, 0.022],
])
const BAR_NECK_HALF = 0.009
const RIB_NECK_HALF = 0.014
/** Glass sits 5 mm inside the datum: 24 mm below the cap crowns. */
const PANE_A = -0.005
const PANE_GAP = 0.0015
const TRANSOM_HALF_U = 0.016
/**
 * How far a vault member running ALONG the range must stop short of the end,
 * so it clears the gable arch — a 105 mm deep member centred 99.5 mm inboard
 * of the end rib, plus a 6 mm reveal.
 */
const GABLE_STOP = 0.158

/**
 * Manufactured block: a chamfered plan profile extruded in Z.
 *
 * Edge treatment lives in the PROFILE (geometry-craft §0.3), which is both
 * the correct craft answer and 20 triangles instead of the 432 a full
 * three-axis fillet grid costs. `bevel()` stays for the parts a guest can put
 * their face against; everything that repeats hundreds of times uses this.
 */
export function blockZ(
  a0: number,
  l0: number,
  z0: number,
  a1: number,
  l1: number,
  z1: number,
  c = 0.004,
): MeshData {
  const w = Math.abs(a1 - a0)
  const d = Math.abs(l1 - l0)
  const cc = Math.min(c, Math.min(w, d) * 0.32)
  const poly = chamferRect(w, d, cc).map(([x, y]) => [x + (a0 + a1) / 2, y + (l0 + l1) / 2] as Vec2)
  return prism(poly, Math.min(z0, z1), Math.max(z0, z1))
}

/** A closed lathe section (first point repeated) — no false internal caps. */
function lathe(profile: Vec2[], segments = 16): MeshData {
  const closed = [...profile, profile[0]]
  return revolve(closed, segments, { capStart: false, capEnd: false })
}

// ───────────────────────────────────────────────────────── house framing

export interface HouseFrame {
  index: number
  x: number
  z: number
  yaw: number
  /** interior slab top (world Y) */
  floorY: number
  groundMin: number
  groundMax: number
  length: number
  width: number
  /** local (across, up, along) -> world position */
  point(a: number, up: number, along: number): Vector3
}

function makeFrame(index: number): HouseFrame {
  const house = FARMSIDE.glasshouses[index]
  const yaw = house.rotation
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  let groundMin = Infinity
  let groundMax = -Infinity
  // Sample the footprint plus the foundation's working margin, so the level
  // datum is honest about the fall the far corners actually sit on.
  for (let i = 0; i <= 34; i++) {
    for (let j = 0; j <= 10; j++) {
      const along = -HALF_LENGTH - 0.4 + (i / 34) * (HOUSE_LENGTH + 0.8)
      const across = -HALF_SPAN - 0.4 + (j / 10) * (HOUSE_WIDTH + 0.8)
      const y = interiorHeight(house.x + across * cos + along * sin, house.z - across * sin + along * cos)
      if (y < groundMin) groundMin = y
      if (y > groundMax) groundMax = y
    }
  }
  const floorY = groundMax + FLOOR_PROUD
  return {
    index,
    x: house.x,
    z: house.z,
    yaw,
    floorY,
    groundMin,
    groundMax,
    length: HOUSE_LENGTH,
    width: HOUSE_WIDTH,
    point: (a, up, along) =>
      new Vector3(house.x + a * cos + along * sin, floorY + up, house.z - a * sin + along * cos),
  }
}

let frameCache: HouseFrame[] | null = null

/** The three ranges' placement frames (memoised; pure). */
export function houseFrames(): HouseFrame[] {
  if (!frameCache) frameCache = FARMSIDE.glasshouses.map((_, i) => makeFrame(i))
  return frameCache
}

/** Author local Z-up, emit into the shared writer at the house's place. */
export function place(writer: PartWriter, slot: string, part: MeshData, frame: HouseFrame): void {
  toYUp(part)
  placeYaw(part, [frame.x, frame.floorY, frame.z], frame.yaw)
  writeInto(writer, slot, part)
}

// ─────────────────────────────────────────────────────── the crop contract

/**
 * The exact tray surfaces the vegetation system fills. One entry per rack
 * run; `position` is the world centre of the **lowest** tray's planting
 * surface, and tier *k* sits at `position[1] + k * CROP_TRAY_TIER_PITCH`.
 * `yaw` is the run direction, `length`/`width` the plantable extent.
 *
 * The two sealed ranges carry the same racks as the walkable one — nobody
 * walks there, so they are planted solid.
 */
export interface CropTray {
  position: [number, number, number]
  yaw: number
  length: number
  width: number
  tiers: number
}

export const CROP_TRAY_TIER_PITCH = RACK_TIER_PITCH

export const CROP_TRAYS: CropTray[] = houseFrames().flatMap((frame) =>
  RACK_ACROSS.map((across) => {
    const p = frame.point(across, RACK_TIER_0 + 0.014, 0)
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      yaw: frame.yaw,
      length: RACK_LENGTH - 0.32,
      width: RACK_DEPTH - 0.18,
      tiers: RACK_TIERS,
    }
  }),
)

/** Flattened convenience view: every individual tray surface, world space. */
export const CROP_TRAY_SURFACES: Array<{
  position: [number, number, number]
  yaw: number
  length: number
  width: number
  tier: number
}> = CROP_TRAYS.flatMap((tray) =>
  Array.from({ length: tray.tiers }, (_, tier) => ({
    position: [tray.position[0], tray.position[1] + tier * CROP_TRAY_TIER_PITCH, tray.position[2]] as [
      number,
      number,
      number,
    ],
    yaw: tray.yaw,
    length: tray.length,
    width: tray.width,
    tier,
  })),
)

/**
 * Misting nozzle mouths in the walkable range, world space — where the
 * vegetation system's mist puffs are born (two manifolds, over the racks).
 */
export const MIST_NOZZLES: Array<[number, number, number]> = (() => {
  const frame = houseFrames()[1]
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < 10; i++) {
    const along = -13.5 + i * 3
    for (const side of [-1, 1]) {
      const p = frame.point(side * 2.55, 2.98, along)
      out.push([p.x, p.y, p.z])
    }
  }
  return out
})()

// ─────────────────────────────────────────────────────────────── materials

const noise = (scale: number, offset: number) =>
  mx_noise_float(vec2(positionWorld.x, positionWorld.z).mul(scale).add(offset)).mul(0.5).add(0.5)

/**
 * Glasshouse glazing. Two named causes drive every channel: **`dust`**, Mars
 * fines settling on up-facing panes (keyed on the world normal, not on
 * height — horizontal weathers, vertical stays clear), and **`film`**, the
 * condensation bloom on the inside of a humid house.
 *
 * Alpha is deliberately low on the haunches (0.14) and high at the crown
 * (~0.46): from the boulevard you look through the near-vertical glazing
 * straight at the racks and their grow bars, while the roof reads as a dusty
 * sheet catching the low sun.
 *
 * A LIT material with a normal-driven constant alpha — never an authored
 * Fresnel stacked on the material's own (see `dev_docs/notes.md`, W1-dome).
 */
function paneGlass(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  const dust = smoothstep(0.15, 0.92, normalWorld.y.abs()).mul(noise(0.7, 12.4).mul(0.5).add(0.6))
  const film = noise(2.3, 41.9)
  material.colorNode = mix(vec3(0.78, 0.86, 0.8), vec3(0.72, 0.63, 0.51), dust).mul(film.mul(0.12).add(0.94))
  material.opacityNode = float(0.14).add(dust.mul(0.32)).add(film.mul(0.05))
  material.roughnessNode = float(0.06).add(dust.mul(0.38))
  material.metalness = 0
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  return material
}

let planeCache: BufferGeometry | null = null
/** Unit quad in XY facing +Z — the only geometry a canvas sign face needs. */
function signQuad(): BufferGeometry {
  if (!planeCache) {
    const g = new BufferGeometry()
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    )
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    planeCache = g
  }
  return planeCache
}

// ─────────────────────────────────────────────────────── pane accumulation

class PaneSheet {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly indices: number[] = []

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a))
    if (n.lengthSq() < 1e-12) return
    n.normalize()
    const base = this.positions.length / 3
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /**
   * A pane cut to an arbitrary CONVEX outline — what a clipped gable cell is.
   * The polygon's own winding decides the normal, and a convex outline fans
   * from vertex 0 without ever emitting an inverted or overlapping triangle.
   */
  polygon(points: Vector3[]): void {
    if (points.length < 3) return
    const n = new Vector3()
    const e1 = new Vector3()
    const e2 = new Vector3()
    for (let i = 1; i + 1 < points.length && n.lengthSq() < 1e-14; i++) {
      e1.subVectors(points[i], points[0])
      e2.subVectors(points[i + 1], points[0])
      n.crossVectors(e1, e2)
    }
    if (n.lengthSq() < 1e-14) return
    n.normalize()
    const base = this.positions.length / 3
    for (const p of points) {
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
    }
    for (let i = 1; i + 1 < points.length; i++) this.indices.push(base, base + i, base + i + 1)
  }

  /** A pane on the vault surface; the corner order lands the normal outward. */
  vaultPane(frame: HouseFrame, u0: number, u1: number, l0: number, l1: number): void {
    const [a0, z0] = sectionOffset(u0, PANE_A)
    const [a1, z1] = sectionOffset(u1, PANE_A)
    this.quad(
      frame.point(a0, z0, l1),
      frame.point(a0, z0, l0),
      frame.point(a1, z1, l0),
      frame.point(a1, z1, l1),
    )
  }

  build(material: MeshStandardNodeMaterial, name: string): Mesh | null {
    if (this.indices.length === 0) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    geometry.setIndex(this.indices)
    const mesh = new Mesh(geometry, material)
    mesh.name = name
    // Glazing never enters the sun's shadow map: a transparent pane written
    // into it darkens the very house it is meant to let light into.
    mesh.castShadow = false
    mesh.receiveShadow = false
    // After the dome shell (renderOrder 9-11): the panes are always nearer to
    // an interior camera, so they must blend last.
    mesh.renderOrder = 12
    mesh.userData.auditSkip = true
    return mesh
  }
}

// ────────────────────────────────────────────────────────── vent openings

interface VentSpec {
  bay: number
  row: number
}

/** Six ridge vents per range, alternating sides of the crown. All open. */
const VENTS: VentSpec[] = [
  { bay: 1, row: 5 },
  { bay: 3, row: 7 },
  { bay: 5, row: 5 },
  { bay: 7, row: 7 },
  { bay: 9, row: 5 },
  { bay: 10, row: 7 },
]

const ventAt = (bay: number, row: number): boolean => VENTS.some((v) => v.bay === bay && v.row === row)

// ────────────────────────────────────────────── foundation, floor, track

function foundationProfile(bury: number): Vec2[] {
  // (z, d) with d positive OUTWARD — the loop path runs CCW, so "right of
  // travel" is the outside face. A splayed footing, a drip, a chamfered top,
  // and a plain inner face the slab butts against.
  return [
    [-bury, FOUND_OUT + 0.01],
    [0.03, FOUND_OUT + 0.01],
    [0.07, FOUND_OUT + 0.048],
    [FOUND_TOP - 0.055, FOUND_OUT + 0.048],
    [FOUND_TOP - 0.03, FOUND_OUT + 0.032],
    [FOUND_TOP - 0.022, FOUND_OUT + 0.015],
    [FOUND_TOP, FOUND_OUT],
    [FOUND_TOP, -FOUND_IN + 0.026],
    [FOUND_TOP - 0.026, -FOUND_IN],
    [0, -FOUND_IN],
    [-bury, -FOUND_IN],
  ]
}

/** The upstand is broken over exactly the clear opening, at BOTH gables. */
const UPSTAND_GAP_L = DOOR_LEFT - 0.006
const UPSTAND_GAP_R = DOOR_RIGHT + 0.006

function buildFoundation(writer: PartWriter, frame: HouseFrame): void {
  const bury = frame.floorY - frame.groundMin + 0.3
  const profile = foundationProfile(bury)
  const hw = HALF_SPAN
  const hl = HALF_LENGTH
  // Two openings (one per gable) split the perimeter into exactly TWO
  // continuous castings, each mitring round two corners and stopping at a
  // jamb — the run is split at every opening, never cut. (A girt running
  // across a doorway is the clearest "this was drawn, not framed" tell.)
  // Both walk CCW, so `runMolding`'s right-of-travel stays the outside face.
  const runs: Vec2[][] = [
    [
      [UPSTAND_GAP_R, -hl],
      [hw, -hl],
      [hw, hl],
      [UPSTAND_GAP_R, hl],
    ],
    [
      [UPSTAND_GAP_L, hl],
      [-hw, hl],
      [-hw, -hl],
      [UPSTAND_GAP_L, -hl],
    ],
  ]
  for (const path of runs) {
    const md = runMolding(path, profile, true, false)
    smoothShade(md, SMOOTH.cast)
    place(writer, 'cast', md, frame)
  }
}

function buildFloorSlab(writer: PartWriter, frame: HouseFrame): void {
  // Slab poured either side of the centre drainage channel — split runs, not
  // one prism with a trough punched through it. Its top is the FLOOR datum;
  // the skirt reaches below the lowest ground so nothing shows underneath.
  const inner = INTERIOR_HALF_SPAN
  const l0 = -HALF_LENGTH + FOUND_IN
  const l1 = HALF_LENGTH - FOUND_IN
  const base = frame.groundMin - frame.floorY - 0.15
  for (const [a0, a1] of [
    [-inner, -0.19],
    [0.19, inner],
  ] as const) {
    const md = prism(
      [
        [a0, l0],
        [a1, l0],
        [a1, l1],
        [a0, l1],
      ],
      base,
      0,
    )
    smoothShade(md, SMOOTH.cast)
    place(writer, 'cast', md, frame)
  }
  // Slab ends beyond the channel run, so the floor is continuous.
  for (const [b0, b1] of [
    [-HALF_LENGTH + FOUND_IN, -HALF_LENGTH + 0.6],
    [HALF_LENGTH - 0.6, HALF_LENGTH - FOUND_IN],
  ] as const) {
    const md = prism(
      [
        [-0.19, b0],
        [0.19, b0],
        [0.19, b1],
        [-0.19, b1],
      ],
      base,
      0,
    )
    smoothShade(md, SMOOTH.cast)
    place(writer, 'cast', md, frame)
  }
  // The channel casting: a real U-trough with a grating rebate.
  const trough = prismXZ(
    [
      [-0.19, base],
      [0.19, base],
      [0.19, -0.012],
      [0.15, -0.012],
      [0.15, -0.082],
      [-0.15, -0.082],
      [-0.15, -0.012],
      [-0.19, -0.012],
    ],
    -HALF_LENGTH + 0.6,
    HALF_LENGTH - 0.6,
  )
  smoothShade(trough, SMOOTH.cast)
  place(writer, 'cast', trough, frame)
  // Grating: slotted cover plates sitting in the rebate, 4 mm proud, in
  // 1.2 m modules with 6 mm joints. The slots are a welded vertex grid.
  const runLen = HOUSE_LENGTH - 1.24
  const covers = Math.round(runLen / 1.2)
  for (let m = 0; m < covers; m++) {
    const l0 = -HALF_LENGTH + 0.62 + m * (runLen / covers) + 0.003
    const len = runLen / covers - 0.006
    const holes: Hole[] = []
    const slots = Math.floor((len - 0.056) / 0.09)
    for (let k = 0; k < slots; k++) {
      const s0 = (len - slots * 0.09) / 2 + k * 0.09 + 0.02
      holes.push([0.04, s0, 0.33, s0 + 0.05])
    }
    // panelWithHoles authors (width X, thickness Y, height Z): stand it down.
    const cover = panelWithHoles(0.37, len, 0.016, holes)
    rotX(cover, -Math.PI / 2)
    translate(cover, [-0.185, l0, 0.004])
    smoothShade(cover, SMOOTH.moulded)
    place(writer, 'aluminum', cover, frame)
  }
}

function buildBaseTrack(writer: PartWriter, frame: HouseFrame): void {
  // Extruded base track in 12 runs between the rib shoes: the glazing bars
  // bed 38 mm into it, so the frame/concrete joint is buried and capped.
  const section: Vec2[] = [
    [-0.05, FOUND_TOP],
    [0.05, FOUND_TOP],
    [0.05, TRACK_TOP],
    [0.032, TRACK_TOP],
    [0.032, FOUND_TOP + 0.016],
    [-0.032, FOUND_TOP + 0.016],
    [-0.032, TRACK_TOP],
    [-0.05, TRACK_TOP],
  ]
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < RIB_BAYS; bay++) {
      const l0 = -HALF_LENGTH + bay * (HOUSE_LENGTH / RIB_BAYS) + (bay === 0 ? 0.26 : 0.13)
      const l1 =
        -HALF_LENGTH + (bay + 1) * (HOUSE_LENGTH / RIB_BAYS) - (bay === RIB_BAYS - 1 ? 0.26 : 0.13)
      const md = prismXZ(
        section.map(([a, z]) => [side * HALF_SPAN + a, z] as Vec2),
        l0,
        l1,
      )
      smoothShade(md, SMOOTH.moulded)
      place(writer, 'aluminum', md, frame)
    }
  }
}

// ─────────────────────────────────────────────── ribs, bars and transoms

function sectionMember(
  writer: PartWriter,
  frame: HouseFrame,
  slot: string,
  u0: number,
  u1: number,
  along: number,
  profile: Vec2[],
): void {
  if (u1 - u0 < 0.03) return
  const md = tubeAlong(sectionPath(u0, u1, along), profile, { up: [0, 1, 0], cap: true })
  smoothShade(md, SMOOTH.moulded)
  place(writer, slot, md, frame)
}

let shoeBoltProto: MeshData | null = null

/**
 * Cast shoe + two bolt heads where each rib lands on the foundation. The two
 * END ribs get a shoe no deeper than the rib itself, so it stops 4 mm clear
 * of the gable's own base channel instead of running through it.
 */
function buildRibShoes(writer: PartWriter, frame: HouseFrame, along: number, halfL = 0.1): void {
  for (const side of [-1, 1]) {
    const a0 = side < 0 ? -HALF_SPAN - 0.1 : HALF_SPAN - 0.24
    const a1 = side < 0 ? -HALF_SPAN + 0.24 : HALF_SPAN + 0.1
    const shoe = prismYZ(
      [
        [along - halfL, FOUND_TOP],
        [along + halfL, FOUND_TOP],
        [along + halfL, FOUND_TOP + 0.052],
        [along + halfL * 0.7, FOUND_TOP + 0.08],
        [along - halfL * 0.7, FOUND_TOP + 0.08],
        [along - halfL, FOUND_TOP + 0.052],
      ],
      Math.min(a0, a1),
      Math.max(a0, a1),
    )
    smoothShade(shoe, SMOOTH.cast)
    place(writer, 'dark', shoe, frame)
    for (const d of [-halfL * 0.62, halfL * 0.62]) {
      if (!shoeBoltProto) {
        shoeBoltProto = revolve(
          [
            [0, 0],
            [0.012, 0],
            [0.012, 0.009],
            [0.009, 0.014],
            [0, 0.014],
          ],
          8,
        )
      }
      const bolt = shoeBoltProto.clone()
      // Outboard of the rib's own footprint, so a head never sits under it.
      translate(bolt, [side * (HALF_SPAN + 0.06), along + d, FOUND_TOP + 0.08])
      place(writer, 'dark', bolt, frame)
    }
  }
}

function buildVaultFrame(writer: PartWriter, frame: HouseFrame): void {
  for (let s = 0; s <= BAR_STATIONS; s++) {
    const along = -HALF_LENGTH + s * BAR_PITCH
    if (s % BARS_PER_BAY === 0) {
      sectionMember(writer, frame, 'steel', RIB_FOOT_U, SECTION_LEN - RIB_FOOT_U, along, RIB_PROFILE)
      buildRibShoes(writer, frame, along, s === 0 || s === BAR_STATIONS ? 0.058 : 0.1)
      continue
    }
    // Intermediate bars are trimmed around any vent opening they cross.
    const bay = Math.floor(s / BARS_PER_BAY)
    const cuts = VENTS.filter((v) => v.bay === bay)
      .map((v) => [ROW_U[v.row] - 0.03, ROW_U[v.row + 1] + 0.03] as [number, number])
      .sort((p, q) => p[0] - q[0])
    let cursor = BAR_BED_U
    for (const [c0, c1] of cuts) {
      sectionMember(writer, frame, 'aluminum', cursor, c0, along, BAR_PROFILE)
      cursor = c1
    }
    sectionMember(writer, frame, 'aluminum', cursor, SECTION_LEN - BAR_BED_U, along, BAR_PROFILE)
  }
}

function buildTransoms(writer: PartWriter, frame: HouseFrame): void {
  // Flat bars under every pane joint, running along the range BETWEEN the
  // glazing bars: 1 mm clear of their base flanges, 4 mm below the glass.
  const profile: Vec2[] = [
    [-TRANSOM_HALF_U, -0.028],
    [TRANSOM_HALF_U, -0.028],
    [TRANSOM_HALF_U, -0.009],
    [-TRANSOM_HALF_U, -0.009],
  ]
  for (let row = 1; row < ROW_U.length - 1; row++) {
    const u = ROW_U[row]
    const s = sectionPoint(u)
    for (let bar = 0; bar < BAR_STATIONS; bar++) {
      const bay = Math.floor(bar / BARS_PER_BAY)
      if (ventAt(bay, row) || ventAt(bay, row - 1)) continue
      const l0 = -HALF_LENGTH + bar * BAR_PITCH
      const l1 = l0 + BAR_PITCH
      // The first and last runs must also clear the GABLE ARCH, whose 105 mm
      // depth reaches 47 mm inboard of the end rib's centre line.
      const leftHalf = bar === 0 ? GABLE_STOP : bar % BARS_PER_BAY === 0 ? 0.039 : 0.027
      const rightHalf =
        bar === BAR_STATIONS - 1 ? GABLE_STOP : (bar + 1) % BARS_PER_BAY === 0 ? 0.039 : 0.027
      const md = tubeAlong(
        [
          [s.a, l0 + leftHalf, s.z],
          [s.a, l1 - rightHalf, s.z],
        ],
        profile,
        { up: [s.na, 0, s.nz], cap: true },
      )
      smoothShade(md, SMOOTH.moulded)
      place(writer, 'aluminum', md, frame)
    }
  }
}

function buildVaultGlazing(sheet: PaneSheet, frame: HouseFrame): void {
  const last = ROW_U.length - 2
  for (let row = 0; row <= last; row++) {
    const u0 = ROW_U[row] + (row === 0 ? 0 : TRANSOM_HALF_U + 0.004)
    const u1 = ROW_U[row + 1] - (row === last ? 0 : TRANSOM_HALF_U + 0.004)
    for (let bar = 0; bar < BAR_STATIONS; bar++) {
      const bay = Math.floor(bar / BARS_PER_BAY)
      if (ventAt(bay, row)) continue
      const l0 = -HALF_LENGTH + bar * BAR_PITCH
      const l1 = l0 + BAR_PITCH
      const leftNeck = bar % BARS_PER_BAY === 0 ? RIB_NECK_HALF : BAR_NECK_HALF
      const rightNeck = (bar + 1) % BARS_PER_BAY === 0 ? RIB_NECK_HALF : BAR_NECK_HALF
      sheet.vaultPane(frame, u0, u1, l0 + leftNeck + PANE_GAP, l1 - rightNeck - PANE_GAP)
    }
  }
}

// ───────────────────────────────────────────────────────────── ridge beam

const CROWN_U = HAUNCH_LEN + ARC_LEN / 2
const RIDGE_TOP = sectionOffset(CROWN_U, -0.196)[1]

function buildRidge(writer: PartWriter, frame: HouseFrame): void {
  const z = RIDGE_TOP
  const md = prismXZ(
    [
      [-0.075, z - 0.28],
      [0.075, z - 0.28],
      [0.075, z - 0.256],
      [0.022, z - 0.256],
      [0.022, z - 0.024],
      [0.075, z - 0.024],
      [0.075, z],
      [-0.075, z],
      [-0.075, z - 0.024],
      [-0.022, z - 0.024],
      [-0.022, z - 0.256],
      [-0.075, z - 0.256],
    ],
    -HALF_LENGTH + 0.18,
    HALF_LENGTH - 0.18,
  )
  smoothShade(md, SMOOTH.moulded)
  place(writer, 'steel', md, frame)

  // Vent drive shaft under the ridge, its hangers, and a gearbox at the lane
  // end with a status lamp — the vents are actually driven by something.
  const shaft = tubeAlong(
    [
      [0, -HALF_LENGTH + 0.4, z - 0.42],
      [0, HALF_LENGTH - 0.4, z - 0.42],
    ],
    circle(0.019, 10),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(shaft, SMOOTH.turned)
  place(writer, 'dark', shaft, frame)
  for (let i = 0; i <= RIB_BAYS; i++) {
    const along = -HALF_LENGTH + (i / RIB_BAYS) * HOUSE_LENGTH
    place(writer, 'aluminum', blockZ(-0.028, along - 0.014, z - 0.44, 0.028, along + 0.014, z - 0.28, 0.003), frame)
  }
  const gearbox = box(-0.09, -HALF_LENGTH + 0.16, z - 0.56, 0.09, -HALF_LENGTH + 0.48, z - 0.3)
  bevel(gearbox, BEVEL.frame, 2)
  place(writer, 'dark', gearbox, frame)
  const indicator = box(-0.028, -HALF_LENGTH + 0.2, z - 0.4, 0.028, -HALF_LENGTH + 0.26, z - 0.36)
  place(writer, 'utilityLight', indicator, frame)
}

// ─────────────────────────────────────────────────────── vents + actuators

function buildVents(writer: PartWriter, frame: HouseFrame): void {
  for (const vent of VENTS) {
    const u0 = ROW_U[vent.row]
    const u1 = ROW_U[vent.row + 1]
    const l0 = -HALF_LENGTH + vent.bay * BARS_PER_BAY * BAR_PITCH
    const l1 = l0 + BARS_PER_BAY * BAR_PITCH
    const mid = (l0 + l1) / 2
    const beyondCrown = u0 > CROWN_U

    // Kerbs across the bay at both boundaries — the opening has real edges.
    for (const [u, sign] of [
      [u0, -1],
      [u1, 1],
    ] as const) {
      const s = sectionPoint(u + sign * 0.03)
      const kerb = tubeAlong(
        [
          [s.a, l0 + 0.06, s.z],
          [s.a, l1 - 0.06, s.z],
        ],
        [
          [-0.03, -0.05],
          [0.03, -0.05],
          [0.03, 0.008],
          [-0.03, 0.008],
        ],
        { up: [s.na, 0, s.nz], cap: true },
      )
      smoothShade(kerb, SMOOTH.moulded)
      place(writer, 'aluminum', kerb, frame)
    }

    // The sash: a flat mitred frame hinged on the crown-side kerb, standing
    // open 24 degrees. Every vent is open — it is a warm afternoon.
    const hingeU = beyondCrown ? u0 : u1
    const freeU = beyondCrown ? u1 : u0
    const hinge = sectionOffset(hingeU, 0.03)
    const free = sectionOffset(freeU, 0.03)
    const span = Math.hypot(free[0] - hinge[0], free[1] - hinge[1])
    const chord = span - 0.06
    const dirA = (free[0] - hinge[0]) / span
    const dirZ = (free[1] - hinge[1]) / span
    // Rotate the chord away from the surface: pick the sense whose result
    // leans along the outward normal at the hinge.
    const n = sectionPoint(hingeU)
    const ca = Math.cos(0.42)
    const sa = Math.sin(0.42)
    const candA = dirA * ca - dirZ * sa
    const candZ = dirA * sa + dirZ * ca
    const lift = candA * n.na + candZ * n.nz
    const outA = lift > 0 ? candA : dirA * ca + dirZ * sa
    const outZ = lift > 0 ? candZ : -dirA * sa + dirZ * ca
    const w = l1 - l0 - 0.14
    const rails: Array<[number, number, number, number]> = [
      [0.057, chord - 0.057, -w / 2, -w / 2 + 0.055],
      [0.057, chord - 0.057, w / 2 - 0.055, w / 2],
      [0, 0.055, -w / 2, w / 2],
      [chord - 0.055, chord, -w / 2, w / 2],
    ]
    const sash = rails.map(([t0, t1, b0, b1]) => blockZ(t0, b0, -0.026, t1, b1, 0.012, 0.004))
    const glassPane = box(0.052, -w / 2 + 0.052, -0.012, chord - 0.052, w / 2 - 0.052, -0.004)
    // Map (t along the sash, b along the range, n off the sash) into local
    // space. The basis is orthonormal with det +1, so no winding repair.
    for (const part of [...sash, glassPane]) {
      for (const v of part.verts) {
        const t = v[0]
        const b = v[1]
        const off = v[2]
        v[0] = hinge[0] + outA * t - outZ * off
        v[1] = mid + b
        v[2] = hinge[1] + outZ * t + outA * off
      }
      part.provenance = null
    }
    for (const part of sash) {
      smoothShade(part, SMOOTH.moulded)
      place(writer, 'aluminum', part, frame)
    }
    place(writer, 'darkGlass', glassPane, frame)

    // Hinge knuckles on the kerb, and the actuator crank down to the shaft.
    for (const b of [-w / 2 + 0.14, w / 2 - 0.14]) {
      const knuckle = revolve(
        [
          [0, -0.032],
          [0.019, -0.032],
          [0.019, 0.032],
          [0, 0.032],
        ],
        10,
        { axis: 'y' },
      )
      translate(knuckle, [hinge[0], mid + b, hinge[1]])
      place(writer, 'dark', knuckle, frame)
    }
    const armFoot: Vec3 = [0, mid, RIDGE_TOP - 0.42]
    const armHead: Vec3 = [hinge[0] + outA * chord * 0.55, mid, hinge[1] + outZ * chord * 0.55]
    const arm = tubeAlong([armFoot, armHead], roundedRect(0.03, 0.014, 0.005, 2), { up: [0, 1, 0], cap: true })
    smoothShade(arm, SMOOTH.moulded)
    place(writer, 'dark', arm, frame)
    const crank = revolve(
      [
        [0, -0.026],
        [0.034, -0.026],
        [0.034, 0.026],
        [0, 0.026],
      ],
      10,
      { axis: 'y' },
    )
    translate(crank, armFoot)
    place(writer, 'dark', crank, frame)
  }
}

// ─────────────────────────────────────────────────── gutters + rainwater

const GUTTER_TOP = EAVES_Z + 0.02

function buildGutters(writer: PartWriter, frame: HouseFrame): void {
  // Closed U-section: outer bead, a floor, and an inner wall standing 26 mm
  // clear of the proud cap bars so the glass drips INTO the gutter.
  const section: Vec2[] = [
    [0.045, GUTTER_TOP],
    [0.045, GUTTER_TOP - 0.03],
    [0.036, GUTTER_TOP - 0.036],
    [0.036, GUTTER_TOP - 0.2],
    [0.28, GUTTER_TOP - 0.235],
    [0.28, GUTTER_TOP],
    [0.245, GUTTER_TOP],
    [0.245, GUTTER_TOP - 0.2],
    [0.075, GUTTER_TOP - 0.196],
    [0.075, GUTTER_TOP - 0.03],
    [0.09, GUTTER_TOP - 0.022],
    [0.09, GUTTER_TOP],
  ]
  for (const side of [-1, 1]) {
    const md = prismXZ(
      section.map(([a, z]) => [side * (HALF_SPAN + a), z] as Vec2),
      -HALF_LENGTH - 0.16,
      HALF_LENGTH + 0.16,
    )
    smoothShade(md, SMOOTH.moulded)
    place(writer, 'aluminum', md, frame)

    for (let i = 0; i <= RIB_BAYS; i++) {
      const along = -HALF_LENGTH + (i / RIB_BAYS) * HOUSE_LENGTH
      const bracket = prismYZ(
        [
          [along - 0.024, GUTTER_TOP - 0.28],
          [along + 0.024, GUTTER_TOP - 0.28],
          [along + 0.024, GUTTER_TOP - 0.09],
          [along - 0.024, GUTTER_TOP - 0.09],
        ],
        Math.min(side * (HALF_SPAN + 0.026), side * (HALF_SPAN + 0.3)),
        Math.max(side * (HALF_SPAN + 0.026), side * (HALF_SPAN + 0.3)),
      )
      place(writer, 'dark', bracket, frame)
    }

    for (const along of [-HALF_LENGTH + 1.6, 0, HALF_LENGTH - 1.6]) {
      const x = side * (HALF_SPAN + 0.075)
      const outer = side * (HALF_SPAN + 0.16)
      const pipe = tubeAlong(
        [
          [outer, along, GUTTER_TOP - 0.235],
          [outer, along, GUTTER_TOP - 0.4],
          [x, along, GUTTER_TOP - 0.62],
          [x, along, 0.26],
          [side * (HALF_SPAN + 0.13), along, 0.11],
        ],
        circle(0.038, 12),
        { up: [0, 1, 0], cap: true },
      )
      smoothShade(pipe, SMOOTH.turned)
      place(writer, 'aluminum', pipe, frame)
      for (const z of [0.9, 0.58]) {
        const clip = annularPrism(circle(0.055, 12), circle(0.0395, 12), -0.018, 0.018, 0.004, 1)
        translate(clip, [x, along, z])
        place(writer, 'dark', clip, frame)
      }
    }

    // Collector header along the foot of the haunch, on saddle blocks.
    const header = tubeAlong(
      [
        [side * (HALF_SPAN + 0.145), -HALF_LENGTH - 0.3, 0.11],
        [side * (HALF_SPAN + 0.145), HALF_LENGTH + 0.3, 0.11],
      ],
      circle(0.052, 12),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(header, SMOOTH.turned)
    place(writer, 'aluminum', header, frame)
    for (let i = 0; i <= 6; i++) {
      const along = -HALF_LENGTH + (i / 6) * HOUSE_LENGTH
      const saddleA = side * (HALF_SPAN + 0.145)
      const saddle = blockZ(saddleA - 0.06, along - 0.05, FOUND_TOP - 0.02, saddleA + 0.06, along + 0.05, 0.06, 0.006)
      place(writer, 'cast', saddle, frame)
    }
  }
}

// ───────────────────────────────────────────────────── external shade rails

function buildShadeRails(writer: PartWriter, frame: HouseFrame): void {
  for (const u of [ROW_U[3], ROW_U[9]]) {
    const [a, z] = sectionOffset(u, 0.098)
    const rail = tubeAlong(
      [
        [a, -HALF_LENGTH - 0.1, z],
        [a, HALF_LENGTH + 0.1, z],
      ],
      circle(0.017, 10),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(rail, SMOOTH.turned)
    place(writer, 'dark', rail, frame)
    const [ba, bz] = sectionOffset(u, 0.024)
    for (let i = 0; i <= RIB_BAYS; i++) {
      const along = -HALF_LENGTH + (i / RIB_BAYS) * HOUSE_LENGTH
      const stalk = tubeAlong(
        [
          [ba, along, bz],
          [a, along, z],
        ],
        roundedRect(0.024, 0.014, 0.004, 2),
        { up: [0, 1, 0], cap: true },
      )
      smoothShade(stalk, SMOOTH.moulded)
      place(writer, 'aluminum', stalk, frame)
    }
  }
  // The screen itself, furled on its roller just above each eaves.
  for (const side of [-1, 1]) {
    const u = side < 0 ? ROW_U[1] + 0.26 : ROW_U[ROW_U.length - 2] - 0.26
    const [a, z] = sectionOffset(u, 0.205)
    const roll = tubeAlong(
      [
        [a, -HALF_LENGTH + 0.32, z],
        [a, HALF_LENGTH - 0.32, z],
      ],
      circle(0.11, 14),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(roll, SMOOTH.turned)
    place(writer, 'fabricSand', roll, frame)
    for (const along of [-HALF_LENGTH + 0.32, HALF_LENGTH - 0.32]) {
      const bearing = revolve(
        [
          [0, -0.03],
          [0.062, -0.03],
          [0.062, 0.03],
          [0.026, 0.03],
          [0.026, 0.1],
          [0, 0.1],
        ],
        12,
        { axis: 'y' },
      )
      // Both bearings face inboard; mirroring the polygons would need a
      // winding repair for no visual gain (geometry-craft §2.6).
      if (along > 0) for (const v of bearing.verts) v[1] = -v[1] - 0.0
      translate(bearing, [a, along, z])
      if (along > 0) recalcNormals(bearing)
      place(writer, 'dark', bearing, frame)
    }
  }
}

// ────────────────────────────────────────────────────────────── gable ends

/**
 * A gable is not a wall with a picture of a door on it. It is the vault's own
 * section closed by a frame whose grid is CUT by the opening: the bay's two
 * mullions become the jambs, the door-head transom becomes the header, and
 * every member and pane that would have crossed the clear opening is simply
 * never emitted. Nothing is pasted over anything, and no boolean is used.
 *
 * The one number the whole gable is generated from is `ARCH_SOFFIT_A` — the
 * perimeter arch's inner face, expressed as an offset on the vault section.
 * Members stop 4 mm short of it, panes tuck 4 mm under its rebate, and the
 * glazing bead follows the identical curve, so the three families cannot
 * disagree about where the edge of the opening is.
 */

/** Outer face of the gable frame: 4 mm inboard of the end rib's foot. */
const GABLE_FACE = 0.062
const GABLE_DEPTH = 0.075
/** Mid-plane of the gable frame band, as an unsigned `along` offset. */
const GABLE_MID = HALF_LENGTH - GABLE_FACE - GABLE_DEPTH / 2
/** The gable glazing plane, 7.5 mm outboard of that mid-plane. */
const GABLE_PANE_Y = HALF_LENGTH - GABLE_FACE - 0.03
/**
 * The arch is a 110 mm deep member swept on the section's -0.055 offset, so
 * its soffit — the true edge of the opening — lands exactly here.
 */
const ARCH_SOFFIT_A = -0.11
/** How far the perimeter glazing bead reaches into the opening. */
const BEAD_DEPTH = 0.042
/**
 * Mullions and transoms die into the BEAD, not into the arch — 6 mm short of
 * its inner face. Stopping them at the arch instead ran their end caps into
 * the bead's own curved face, and at the crown the centre mullion's cap
 * landed 2 mm under it, same-facing.
 */
const MEMBER_CLEAR_A = ARCH_SOFFIT_A - BEAD_DEPTH - 0.006
/** Panes run the whole way and tuck 4 mm under the arch's rebate. */
const PANE_TUCK_A = ARCH_SOFFIT_A + 0.004
/** Panes tuck 3 mm under every mullion and transom too — a real rebate. */
const PANE_LAP = 0.003

/** Gable base track: a U-channel the pane feet and the mullions bed into. */
const GABLE_TRACK_TOP = 0.23
const GABLE_TRACK_FLOOR = 0.156
const GABLE_PANE_FOOT = 0.2

/**
 * Transom levels. Row 0 is the base track (not a member), and the door head
 * IS a row — so the header belongs to the grid instead of being one more bar
 * laid across it. Everything above the top row is one clipped crown cap.
 */
const GABLE_ROWS = [GABLE_PANE_FOOT, 1.16, DOOR_HEAD_Z, 3.24, 4.06, 4.7]
const HEAD_ROW = 2
const gableRowHalf = (row: number): number => (row === HEAD_ROW ? 0.06 : 0.03)
/** The louvred vent fills exactly one bay/row cell of the gable grid. */
const VENT_BAY = 4
const VENT_ROW = 3

const mullionHalf = (i: number): number =>
  i === 0 || i === GABLE_MULLIONS.length - 1
    ? 0
    : i === DOOR_BAY || i === DOOR_BAY + 1
      ? JAMB_HALF
      : MULLION_HALF

/** Where a vertical member at `across` meets the arch soffit at offset `off`. */
function gableSoffit(across: number, off: number): number {
  const r = ARC_R + off
  const x = Math.min(Math.abs(across), HALF_SPAN + off)
  return ARC_C + Math.sqrt(Math.max(0, r * r - x * x))
}

/** Half the clear width at height `z`, at offset `off`. */
function gableHalfWidth(z: number, off: number): number {
  const r = ARC_R + off
  const dz = z - ARC_C
  return Math.min(HALF_SPAN + off, Math.sqrt(Math.max(0, r * r - dz * dz)))
}

/** Arc stations for the clear outline — 0.3 mm max sagitta at 4.4 m radius. */
const GABLE_ARC_SEGS = 128
/** The bead is 44 mm wide, so its own chord dip may be an order coarser. */
const GABLE_BEAD_SEGS = 72

/**
 * The clear opening as a CONVEX closed outline in (across, up): the vault
 * section offset inboard by `off` and floored at `base`. Convex by
 * construction — bottom edge, two haunch edges, one circular arc — which is
 * exactly what lets `clipConvex` be a single Sutherland-Hodgman pass.
 * Wound CCW, so a clipped cell's own winding lands the normal on +along.
 */
function gableOutline(off: number, base: number): Vec2[] {
  const a = HALF_SPAN + off
  const r = ARC_R + off
  const pts: Vec2[] = [
    [-a, base],
    [a, base],
  ]
  for (let i = 0; i <= GABLE_ARC_SEGS; i++) {
    const phi = SPRING_PHI + (i / GABLE_ARC_SEGS) * (Math.PI - 2 * SPRING_PHI)
    pts.push([r * Math.cos(phi), ARC_C + r * Math.sin(phi)])
  }
  return pts
}

/**
 * Sutherland-Hodgman against a CONVEX CCW window — the whole answer to "the
 * triangular glass does not fit the curved frame". Every grid cell is CLIPPED
 * to the arch instead of being drawn as a rectangle and hoped for, so a pane
 * corner can never poke past the rib and a part-cell can never be dropped for
 * failing a "both corners are under the arch" test.
 */
function clipConvex(subject: Vec2[], window: Vec2[]): Vec2[] {
  let out = subject
  for (let w = 0; w < window.length && out.length > 0; w++) {
    const [ax, az] = window[w]
    const [bx, bz] = window[(w + 1) % window.length]
    const ex = bx - ax
    const ez = bz - az
    const side = (p: Vec2): number => ex * (p[1] - az) - ez * (p[0] - ax)
    const next: Vec2[] = []
    for (let i = 0; i < out.length; i++) {
      const p = out[i]
      const q = out[(i + 1) % out.length]
      const sp = side(p)
      const sq = side(q)
      if (sp >= 0) next.push(p)
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq)
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
    out = next
  }
  // Weld the near-duplicates a clip against 128 arc edges inevitably leaves,
  // or the fan emits zero-area triangles (geometry-craft section 2.6).
  const clean: Vec2[] = []
  for (const p of out) {
    const last = clean[clean.length - 1]
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 5e-4) continue
    clean.push(p)
  }
  while (
    clean.length > 1 &&
    Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 5e-4
  ) {
    clean.pop()
  }
  return clean
}

/**
 * One straight gable member: a chamfered flat section swept between two
 * points in the gable plane. The edge treatment lives in the PROFILE, which
 * is both the right craft answer and 20 triangles instead of the 432 a
 * three-axis fillet grid costs (geometry-craft section 0.3).
 */
function gableMember(
  writer: PartWriter,
  frame: HouseFrame,
  slot: string,
  a0: number,
  z0: number,
  a1: number,
  z1: number,
  half: number,
  end: number,
  depth = GABLE_DEPTH,
): void {
  const length = Math.hypot(a1 - a0, z1 - z0)
  if (length < 0.05) return
  const y = end * GABLE_MID
  const md = tubeAlong(
    [
      [a0, y, z0],
      [a1, y, z1],
    ],
    chamferRect(half * 2, depth, Math.min(0.006, half * 0.6)),
    { up: [0, 1, 0], cap: true },
  )
  smoothShade(md, SMOOTH.moulded)
  place(writer, slot, md, frame)
}

/** Arch, base track, mullions/jambs and transoms/header — the welded grid. */
function buildGableFrame(writer: PartWriter, frame: HouseFrame, end: number): void {
  // Perimeter arch, generated from the same section as the vault, so the
  // corner between the gable and the shell closes with no sliver.
  const archPath: Vec3[] = SECTION_STATIONS.map((u) => {
    const [a, z] = sectionOffset(u, -0.055)
    return [a, end * GABLE_MID, z] as Vec3
  })
  const arch = tubeAlong(archPath, roundedRect(0.11, GABLE_DEPTH + 0.03, 0.008, 2), {
    up: [0, 1, 0],
    cap: true,
  })
  smoothShade(arch, SMOOTH.moulded)
  place(writer, 'steel', arch, frame)

  // Base track: a real U-channel bedded on the concrete upstand, SPLIT at the
  // door jambs. The pane feet stand 44 mm down inside it.
  // The channel is 2 mm WIDER than the mullions it receives on each face, so
  // a bedded mullion is buried inside it rather than sharing its side planes.
  const yc = end * GABLE_MID
  const trackSection: Vec2[] = [
    [yc - 0.0395, FOUND_TOP],
    [yc + 0.0395, FOUND_TOP],
    [yc + 0.0395, GABLE_TRACK_TOP],
    [yc + 0.0215, GABLE_TRACK_TOP],
    [yc + 0.0215, GABLE_TRACK_FLOOR],
    [yc - 0.0215, GABLE_TRACK_FLOOR],
    [yc - 0.0215, GABLE_TRACK_TOP],
    [yc - 0.0395, GABLE_TRACK_TOP],
  ]
  const trackEnd = HALF_SPAN + MEMBER_CLEAR_A
  for (const [a0, a1] of [
    [-trackEnd, GABLE_MULLIONS[DOOR_BAY] - JAMB_HALF - 0.004],
    [GABLE_MULLIONS[DOOR_BAY + 1] + JAMB_HALF + 0.004, trackEnd],
  ] as const) {
    const md = prismYZ(trackSection, a0, a1)
    smoothShade(md, SMOOTH.moulded)
    place(writer, 'aluminum', md, frame)
  }

  // Mullions run continuous from the track to the arch soffit; the door bay's
  // two are the jambs, at a heavier section standing 6 mm proud of the band.
  for (let i = 1; i < GABLE_MULLIONS.length - 1; i++) {
    const a = GABLE_MULLIONS[i]
    const isJamb = i === DOOR_BAY || i === DOOR_BAY + 1
    const half = mullionHalf(i)
    gableMember(
      writer,
      frame,
      isJamb ? 'steel' : 'aluminum',
      a,
      isJamb ? FOUND_TOP : GABLE_TRACK_FLOOR + 0.006,
      a,
      gableSoffit(Math.abs(a) + half, MEMBER_CLEAR_A),
      half,
      end,
      isJamb ? GABLE_DEPTH + 0.012 : GABLE_DEPTH,
    )
  }

  // Transoms butt BETWEEN the mullions (verticals continuous, horizontals
  // split — the gridshell rule), and each run also stops where the arch cuts
  // it. Nothing crosses the doorway below the header: that bar at ~1.2 m is
  // the obstruction the owner photographed.
  for (let r = 1; r < GABLE_ROWS.length; r++) {
    const z = GABLE_ROWS[r]
    const half = gableRowHalf(r)
    const limit = gableHalfWidth(z + half + 0.004, MEMBER_CLEAR_A)
    for (let i = 0; i < GABLE_MULLIONS.length - 1; i++) {
      if (i === DOOR_BAY && z < DOOR_HEAD_Z - 1e-6) continue
      const isHeader = i === DOOR_BAY && r === HEAD_ROW
      const a0 = Math.max(GABLE_MULLIONS[i] + mullionHalf(i) + 0.004, -limit)
      const a1 = Math.min(GABLE_MULLIONS[i + 1] - mullionHalf(i + 1) - 0.004, limit)
      if (a1 - a0 < 0.06) continue
      gableMember(
        writer,
        frame,
        r === HEAD_ROW ? 'steel' : 'aluminum',
        a0,
        z,
        a1,
        z,
        half,
        end,
        isHeader ? GABLE_DEPTH + 0.012 : GABLE_DEPTH,
      )
    }
  }
}

/** Every gable pane, clipped to the arch. Zero pokes, zero holes, zero laps. */
function buildGableGlazing(sheet: PaneSheet, frame: HouseFrame, end: number): void {
  const clip = gableOutline(PANE_TUCK_A, GABLE_PANE_FOOT)
  const paneY = end * GABLE_PANE_Y
  for (let i = 0; i < GABLE_MULLIONS.length - 1; i++) {
    const a0 = GABLE_MULLIONS[i] + mullionHalf(i) - PANE_LAP
    const a1 = GABLE_MULLIONS[i + 1] - mullionHalf(i + 1) + PANE_LAP
    for (let r = 0; r < GABLE_ROWS.length; r++) {
      if (i === DOOR_BAY && GABLE_ROWS[r] < DOOR_HEAD_Z - 1e-6) continue
      if (i === VENT_BAY && r === VENT_ROW) continue
      const z0 = r === 0 ? GABLE_PANE_FOOT : GABLE_ROWS[r] + gableRowHalf(r) - PANE_LAP
      const z1 =
        r + 1 < GABLE_ROWS.length ? GABLE_ROWS[r + 1] - gableRowHalf(r + 1) + PANE_LAP : CROWN_Z + 0.3
      const poly = clipConvex(
        [
          [a0, z0],
          [a1, z0],
          [a1, z1],
          [a0, z1],
        ],
        clip,
      )
      if (poly.length < 3 || Math.abs(polyArea(poly)) < 0.0025) continue
      const pts = poly.map(([a, z]) => frame.point(a, z, paneY))
      // CCW in (across, up) winds the normal onto +along, so the -along gable
      // takes the reversed order and both faces end up pointing outward.
      sheet.polygon(end > 0 ? pts : pts.reverse())
    }
  }
}

/**
 * The glazing bead that covers the pane-to-arch junction, both faces. It
 * follows the SAME curve the panes are clipped to, so the two cannot
 * disagree; the pane's own edge is buried 4 mm inside the arch's rebate
 * behind it, and a 2 mm reveal keeps the bead off the arch soffit plane.
 */
function buildGableBead(writer: PartWriter, frame: HouseFrame, end: number): void {
  const a = HALF_SPAN + ARCH_SOFFIT_A
  const r = ARC_R + ARCH_SOFFIT_A
  const y = end * GABLE_PANE_Y
  const path: Vec3[] = [[a, y, SILL_Z]]
  for (let i = 0; i <= GABLE_BEAD_SEGS; i++) {
    const phi = SPRING_PHI + (i / GABLE_BEAD_SEGS) * (Math.PI - 2 * SPRING_PHI)
    path.push([r * Math.cos(phi), y, ARC_C + r * Math.sin(phi)])
  }
  path.push([-a, y, SILL_Z])
  // Walking the outline this way puts `tubeAlong`'s across-axis on the INWARD
  // in-plane normal, so the profile reads (into the opening, along the range).
  for (const s of [1, -1]) {
    const profile: Vec2[] = [
      [0.002, s * 0.005],
      [0.002 + BEAD_DEPTH, s * 0.005],
      [0.002 + BEAD_DEPTH, s * 0.018],
      [0.002 + BEAD_DEPTH - 0.007, s * 0.023],
      [0.008, s * 0.023],
      [0.002, s * 0.018],
    ]
    const md = tubeAlong(path, profile, { up: [0, 1, 0], cap: true })
    smoothShade(md, SMOOTH.moulded)
    place(writer, 'aluminum', md, frame)
  }
}

/**
 * Louvred gable vent. It FILLS one grid cell (bay VENT_BAY, row VENT_ROW)
 * whose pane is skipped, so it is an aperture in the frame rather than a
 * patch laid over it. Every gable of every range carries one.
 */
function buildGableVent(writer: PartWriter, frame: HouseFrame, end: number): void {
  const a0 = GABLE_MULLIONS[VENT_BAY] + MULLION_HALF + 0.006
  const a1 = GABLE_MULLIONS[VENT_BAY + 1] - MULLION_HALF - 0.006
  const z0 = GABLE_ROWS[VENT_ROW] + gableRowHalf(VENT_ROW) + 0.006
  const z1 = GABLE_ROWS[VENT_ROW + 1] - gableRowHalf(VENT_ROW + 1) - 0.006
  const yIn = end * (GABLE_MID - GABLE_DEPTH / 2)
  const yOut = end * (GABLE_MID + GABLE_DEPTH / 2)
  const yLo = Math.min(yIn, yOut)
  const yHi = Math.max(yIn, yOut)
  for (const b of [
    [a0, z0, a0 + 0.05, z1],
    [a1 - 0.05, z0, a1, z1],
    [a0 + 0.05, z0, a1 - 0.05, z0 + 0.05],
    [a0 + 0.05, z1 - 0.05, a1 - 0.05, z1],
  ] as const) {
    place(writer, 'aluminum', blockZ(b[0], yLo, b[1], b[2], yHi, b[3], 0.004), frame)
  }
  const blades = 6
  for (let i = 0; i < blades; i++) {
    const z = z0 + 0.06 + (i / blades) * (z1 - z0 - 0.1)
    const blade = prismXZ(
      [
        [a0 + 0.052, z],
        [a1 - 0.052, z],
        [a1 - 0.052, z + 0.026],
        [a0 + 0.052, z + 0.026],
      ],
      yLo + 0.014,
      yHi - 0.014,
    )
    rotX(blade, end * -0.42, [0, (yIn + yOut) / 2, z + 0.013])
    place(writer, 'dark', blade, frame)
  }
}

// ──────────────────────────────────────────────────────────── the entrance

/**
 * The leaf hangs INBOARD of the gable, 30 mm clear of the foundation
 * upstand's inner face — which is what lets it park over a full bay without
 * its bottom rail driving through 140 mm of concrete.
 */
const LEAF_Y = HALF_LENGTH - FOUND_IN - 0.03
const LEAF_WIDTH = DOOR_CLEAR_WIDTH + 0.09
const LEAF_HEIGHT = DOOR_HEAD_Z - 0.05
const LEAF_THICK = 0.052
const LEAF_FOOT = 0.02
const LEAF_STILE = 0.09
const DOOR_TRACK_Z = DOOR_HEAD_Z + 0.16

/**
 * A glazed sliding leaf, built the way a leaf is built: two continuous
 * stiles, rails butting between them, a single light bedded in beads on both
 * faces, and its own hardware. Authored Z-up in leaf space (x across the
 * leaf, y through its thickness with +y OUTBOARD, z up from its centre).
 */
function buildDoorLeaf(): Group {
  const halfW = LEAF_WIDTH / 2
  const halfH = LEAF_HEIGHT / 2
  const halfT = LEAF_THICK / 2
  const alu: MeshData[] = []
  const dark: MeshData[] = []
  const orange: MeshData[] = []

  for (const s of [-1, 1]) {
    const cx = s * (halfW - LEAF_STILE / 2)
    alu.push(
      prism(
        chamferRect(LEAF_STILE, LEAF_THICK, 0.005).map(([x, y]) => [x + cx, y] as Vec2),
        -halfH,
        halfH,
      ),
    )
  }
  const railHalf = halfW - LEAF_STILE - 0.004
  const rail = (z0: number, z1: number): MeshData =>
    prismXZ(
      chamferRect(railHalf * 2, z1 - z0, 0.005).map(([x, z]) => [x, z + (z0 + z1) / 2] as Vec2),
      -halfT,
      halfT,
    )
  alu.push(rail(halfH - 0.115, halfH))
  alu.push(rail(-halfH, -halfH + 0.2))

  // The light, bedded 5 mm either side of the leaf's mid-plane so the beads
  // have a real rebate to sit in rather than lying on the glass.
  const glassZ0 = -halfH + 0.2
  const glassZ1 = halfH - 0.115
  const glassHalfX = railHalf
  const glass = prismXZ(
    [
      [-glassHalfX, glassZ0],
      [glassHalfX, glassZ0],
      [glassHalfX, glassZ1],
      [-glassHalfX, glassZ1],
    ],
    -0.005,
    0.005,
  )
  for (const f of [-1, 1]) {
    for (const s of [-1, 1]) {
      alu.push(
        prism(
          chamferRect(0.018, 0.017, 0.003).map(
            ([x, y]) => [x + s * (glassHalfX - 0.009), y + f * 0.0165] as Vec2,
          ),
          glassZ0 + 0.002,
          glassZ1 - 0.002,
        ),
      )
    }
    for (const z of [glassZ0 + 0.009, glassZ1 - 0.009]) {
      alu.push(
        prismXZ(
          chamferRect(glassHalfX * 2 - 0.042, 0.018, 0.003).map(([x, zz]) => [x, zz + z] as Vec2),
          f * 0.008,
          f * 0.025,
        ),
      )
    }
  }

  // Hanger straps up to the rollers, a pull, a bottom guide shoe.
  for (const s of [-1, 1]) {
    const cx = s * (halfW - 0.19)
    alu.push(
      prism(
        chamferRect(0.05, 0.018, 0.003).map(([x, y]) => [x + cx, y] as Vec2),
        halfH - 0.07,
        halfH + 0.16,
      ),
    )
    dark.push(
      prism(
        chamferRect(0.07, 0.04, 0.004).map(([x, y]) => [x + cx, y] as Vec2),
        halfH + 0.16,
        halfH + 0.22,
      ),
    )
  }
  const pullX = -halfW + 0.19
  for (const f of [-1, 1]) {
    dark.push(
      tubeAlong(
        [
          [pullX, f * halfT, -0.17],
          [pullX, f * (halfT + 0.075), -0.15],
          [pullX, f * (halfT + 0.075), 0.15],
          [pullX, f * halfT, 0.17],
        ],
        circle(0.014, 10),
        { up: [0, 0, 1], cap: true },
      ),
    )
  }
  dark.push(
    prism(
      chamferRect(0.08, 0.03, 0.004).map(([x, y]) => [x, y] as Vec2),
      -halfH - 0.014,
      -halfH + 0.002,
    ),
  )
  // Hazard band low on the leaf, 3 mm proud of the kick rail (never flush).
  for (const f of [-1, 1]) {
    orange.push(
      prismXZ(
        chamferRect(railHalf * 2 - 0.06, 0.12, 0.004).map(([x, z]) => [x, z - halfH + 0.1] as Vec2),
        f * (halfT - 0.001),
        f * (halfT + 0.005),
      ),
    )
  }

  for (const part of [...alu, ...dark, ...orange]) smoothShade(part, SMOOTH.moulded)
  const materials = kitMaterials()
  const leaf = new Group()
  leaf.add(buildGroup({ aluminum: alu, dark, orange }, materials, { name: 'glasshouse:leaf' }))
  // Glazing never enters the sun's shadow map (a transparent pane written
  // into it darkens the very room it is meant to light).
  leaf.add(
    buildGroup({ cabinGlass: glass }, materials, {
      name: 'glasshouse:leafGlass',
      castShadow: false,
      receiveShadow: false,
    }),
  )
  return leaf
}

/**
 * Everything an entrance is: a threshold that steps down to the ground in
 * risers the character controller never has to climb, a head track the leaf
 * really hangs from, a floor guide, a lamp — and the DoorSpec that gives the
 * DoorsSystem its E prompt and its gating collider.
 */
function buildGableDoor(services: DistrictServices, frame: HouseFrame, end: number): void {
  const { writer } = services
  const sillOut = end * (HALF_LENGTH + 0.26)
  // 30 mm UNDER the slab edge: ending it on the upstand's own inner plane put
  // two same-facing cast faces in that plane over the 20 mm they share.
  const sillIn = end * (HALF_LENGTH - FOUND_IN - 0.03)
  const base = frame.groundMin - frame.floorY - 0.32

  // Cast threshold filling the break in the upstand, with a rebate the
  // aluminium weather plate sits in 6 mm proud of the slab — not the 35 mm
  // up-then-down kerb that was there before.
  const sill = prismYZ(
    [
      [sillOut, base],
      [sillIn, base],
      [sillIn, -0.006],
      [sillOut, -0.006],
    ],
    UPSTAND_GAP_L - 0.02,
    UPSTAND_GAP_R + 0.02,
  )
  smoothShade(sill, SMOOTH.cast)
  place(writer, 'cast', sill, frame)
  const plate = prismYZ(
    [
      [end * (HALF_LENGTH + 0.25), -0.006],
      [end * (HALF_LENGTH - FOUND_IN + 0.012), -0.006],
      [end * (HALF_LENGTH - FOUND_IN + 0.012), 0.001],
      [end * (HALF_LENGTH - FOUND_IN + 0.018), 0.006],
      [end * (HALF_LENGTH + 0.244), 0.006],
      [end * (HALF_LENGTH + 0.25), 0.001],
    ],
    DOOR_LEFT + 0.004,
    DOOR_RIGHT - 0.004,
  )
  smoothShade(plate, SMOOTH.moulded)
  place(writer, 'aluminum', plate, frame)

  // Approach steps. The doorway is up to 194 mm above the apron across the
  // three ranges, so the drop is divided into risers of at most 58 mm and
  // each tread carries its own collider.
  const mouth = frame.point(DOOR_ACROSS, 0, end * (HALF_LENGTH + 0.9))
  const drop = frame.floorY + 0.006 - interiorHeight(mouth.x, mouth.z)
  const risers = Math.max(1, Math.ceil(drop / 0.058))
  const rise = drop / risers
  const tread = 0.34
  for (let k = 1; k < risers; k++) {
    const top = 0.006 - k * rise
    // Each tread is also 30 mm wider than the one above it — a flight that
    // splays. Repeating one half-width put every tread's SIDE face in the
    // same plane, which is the other half of the same coplanar family.
    const stepHalf = DOOR_CLEAR_WIDTH / 2 + 0.19 + (k - 1) * 0.03
    // Each tread bites 20 mm into the one above it. Nesting them all back to
    // ONE inner plane instead put five same-facing faces in the same plane —
    // 9 m² of coplanar cast across the six doorways.
    const lIn = end * (HALF_LENGTH + 0.23 + (k - 1) * tread)
    const lOut = end * (HALF_LENGTH + 0.25 + k * tread)
    // Each tread also digs 10 mm deeper than the one above it: sharing one
    // base plane is the third face of the same coplanar family.
    const foot = base - k * 0.01
    const step = prismYZ(
      [
        [lIn, foot],
        [lOut, foot],
        [lOut, top - 0.014],
        [lOut - end * 0.014, top],
        [lIn, top],
      ],
      DOOR_ACROSS - stepHalf,
      DOOR_ACROSS + stepHalf,
    )
    smoothShade(step, SMOOTH.cast)
    place(writer, 'cast', step, frame)
    services.colliders.push({
      kind: 'box',
      center: frame.point(DOOR_ACROSS, top - 0.3, end * (HALF_LENGTH + 0.25 + (k - 0.5) * tread)),
      size: new Vector3(stepHalf * 2, 0.6, tread),
      yaw: frame.yaw,
    })
  }

  // Head track, end stops and the two brackets that carry it off the gable.
  const trackA0 = DOOR_ACROSS - LEAF_WIDTH / 2 - 0.2
  const trackA1 = DOOR_ACROSS + DOOR_SLIDE + LEAF_WIDTH / 2 + 0.2
  const trackY = end * LEAF_Y
  const track = prismYZ(
    [
      [trackY - 0.05, DOOR_TRACK_Z - 0.09],
      [trackY + 0.05, DOOR_TRACK_Z - 0.09],
      [trackY + 0.05, DOOR_TRACK_Z],
      [trackY + 0.022, DOOR_TRACK_Z],
      [trackY + 0.022, DOOR_TRACK_Z - 0.052],
      [trackY - 0.022, DOOR_TRACK_Z - 0.052],
      [trackY - 0.022, DOOR_TRACK_Z],
      [trackY - 0.05, DOOR_TRACK_Z],
    ],
    trackA0,
    trackA1,
  )
  smoothShade(track, SMOOTH.moulded)
  place(writer, 'aluminum', track, frame)
  for (const a of [trackA0 + 0.04, trackA1 - 0.04]) {
    place(
      writer,
      'dark',
      blockZ(
        a - 0.03,
        trackY - 0.056,
        DOOR_TRACK_Z - 0.1,
        a + 0.03,
        trackY + 0.056,
        DOOR_TRACK_Z + 0.012,
        0.004,
      ),
      frame,
    )
  }
  for (const a of [DOOR_ACROSS - 0.42, DOOR_ACROSS + DOOR_SLIDE + 0.42]) {
    const inner = end * (GABLE_MID - GABLE_DEPTH / 2 - 0.004)
    place(
      writer,
      'dark',
      blockZ(
        a - 0.032,
        Math.min(trackY, inner),
        DOOR_TRACK_Z - 0.026,
        a + 0.032,
        Math.max(trackY, inner),
        DOOR_TRACK_Z + 0.028,
        0.004,
      ),
      frame,
    )
  }
  // Floor guide the leaf's shoe runs in, on the slab beside the opening.
  place(
    writer,
    'dark',
    blockZ(
      DOOR_RIGHT + 0.08,
      trackY - 0.05,
      0,
      DOOR_RIGHT + 0.16,
      trackY + 0.05,
      0.036,
      0.005,
    ),
    frame,
  )
  // Utility lamp over the threshold, on the inside face of the header.
  const lampY = end * (GABLE_MID - GABLE_DEPTH / 2)
  place(
    writer,
    'aluminum',
    blockZ(
      DOOR_ACROSS - 0.11,
      lampY - end * 0.13,
      DOOR_HEAD_Z + 0.16,
      DOOR_ACROSS + 0.11,
      lampY,
      DOOR_HEAD_Z + 0.28,
      0.006,
    ),
    frame,
  )
  // The lens hangs 4 mm below the hood: touching its underside would put two
  // faces of two SLOTS in one plane, which is the defect, not the joint.
  place(
    writer,
    'utilityLight',
    blockZ(
      DOOR_ACROSS - 0.08,
      lampY - end * 0.115,
      DOOR_HEAD_Z + 0.142,
      DOOR_ACROSS + 0.08,
      lampY - end * 0.035,
      DOOR_HEAD_Z + 0.156,
      0.003,
    ),
    frame,
  )

  // The leaf itself. Local +z is the leaf's outboard normal, so the -along
  // gable's panel is turned through pi; the slide is +across at both ends.
  const panel = buildDoorLeaf()
  panel.rotation.y = frame.yaw + (end > 0 ? 0 : Math.PI)
  services.group.add(panel)
  const centre = frame.point(DOOR_ACROSS, LEAF_FOOT + LEAF_HEIGHT / 2, end * LEAF_Y)
  services.doors.push({
    panel,
    closedPosition: centre.clone(),
    openOffset: new Vector3(Math.cos(frame.yaw), 0, -Math.sin(frame.yaw)).multiplyScalar(DOOR_SLIDE),
    anchor: frame.point(DOOR_ACROSS, 1.05, end * (HALF_LENGTH - 0.1)),
    label: 'Enter the greenhouse',
    collider: {
      center: frame.point(DOOR_ACROSS, DOOR_HEAD_Z / 2, end * HALF_LENGTH),
      size: new Vector3(DOOR_CLEAR_WIDTH + 0.08, DOOR_HEAD_Z, 0.36),
      yaw: frame.yaw,
    },
  })
}

/** One gable, complete: frame, glazing, bead, vent and entrance. */
function buildGable(
  services: DistrictServices,
  sheet: PaneSheet,
  frame: HouseFrame,
  end: number,
): void {
  buildGableFrame(services.writer, frame, end)
  buildGableGlazing(sheet, frame, end)
  buildGableBead(services.writer, frame, end)
  buildGableVent(services.writer, frame, end)
  buildGableDoor(services, frame, end)
}

// ───────────────────────────────────────────────────── signage + lighting

const HOUSE_LABELS = ['RANGE A · LEAF', 'RANGE B · HALL', 'RANGE C · ROOT']

const SIGN_W = 1.92
const SIGN_H = 0.34

/** Both gables are entrances now, so both carry the range's name. */
function buildHouseSign(services: DistrictServices, frame: HouseFrame, end: number): void {
  const { writer } = services
  // The brackets butt the gable's OUTER face with a 4 mm reveal. Reaching
  // through to its inner face put them 1 mm off the head transom's own plane.
  const backY = end * (HALF_LENGTH - GABLE_FACE + 0.004)
  const plateY = end * (HALF_LENGTH + 0.075)
  const cz = 2.66
  // Two brackets off the gable head transom carry the plate clear of it.
  for (const a of [-0.86, 0.86]) {
    const bracket = box(
      a - 0.045,
      Math.min(plateY, backY),
      cz - 0.32,
      a + 0.045,
      Math.max(plateY, backY),
      cz + 0.04,
    )
    bevel(bracket, BEVEL.panel, 2)
    place(writer, 'dark', bracket, frame)
  }
  // `box()` does not sort its bounds and `bevel()` re-generates from them, so
  // a mirrored plate authored y0 > y1 comes back inside-out and self-overlapping.
  const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]
  const [py0, py1] = span(plateY, plateY + end * 0.075)
  const plate = box(-1.06, py0, cz - 0.25, 1.06, py1, cz + 0.25)
  bevel(plate, BEVEL.panel, 2)
  place(writer, 'steel', plate, frame)
  const [ly0, ly1] = span(plateY + end * 0.073, plateY + end * 0.089)
  const lens = box(-0.99, ly0, cz - 0.19, 0.99, ly1, cz + 0.19)
  place(writer, 'signageGlow', lens, frame)

  const face = new Mesh(
    signQuad(),
    signageMaterial([HOUSE_LABELS[frame.index]], {
      background: '#1a1d19',
      ink: '#e8f2df',
      widthPx: 512,
      aspect: SIGN_W / SIGN_H,
    }),
  )
  face.scale.set(SIGN_W, SIGN_H, 1)
  face.position.copy(frame.point(0, cz, plateY + end * 0.093))
  face.rotation.y = frame.yaw + (end > 0 ? 0 : Math.PI)
  face.castShadow = false
  face.receiveShadow = false
  services.group.add(face)
}

/** Warm room light behind the glazing — the reason the ranges read inhabited. */
function buildRoomLights(writer: PartWriter, frame: HouseFrame): void {
  const z = RIDGE_TOP
  for (let i = 0; i < 7; i++) {
    const along = -HALF_LENGTH + 2.4 + i * ((HOUSE_LENGTH - 4.8) / 6)
    const housing = box(-0.13, along - 0.44, z - 0.64, 0.13, along + 0.44, z - 0.52)
    bevel(housing, BEVEL.panel, 2)
    place(writer, 'aluminum', housing, frame)
    const diffuser = box(-0.105, along - 0.41, z - 0.658, 0.105, along + 0.41, z - 0.636)
    place(writer, 'interiorGlow', diffuser, frame)
    for (const b of [-0.34, 0.34]) {
      const rod = tubeAlong(
        [
          [0, along + b, z - 0.52],
          [0, along + b, z - 0.28],
        ],
        circle(0.008, 6),
        { up: [0, 1, 0], cap: true },
      )
      place(writer, 'dark', rod, frame)
    }
  }
}

// ───────────────────────────────────────────────────────────── colliders

/**
 * All three ranges are walk-through, so all three get the same collider set:
 * two side walls, four gable-wall segments leaving a gap at each entrance,
 * the floor slab and the racks. There is no "solid box" range any more.
 *
 * Collider yaw θ maps box local X → (cosθ, −sinθ), which is exactly
 * `frame.point`'s ACROSS axis at θ = frame.yaw — so `size.x` is the across
 * extent and `size.z` the along extent. The gable segments were sized for
 * the OLD (wrong) +π/2 yaw and had those two swapped, which is why the far
 * gable used to be a 0.4 × 9 m slab sticking out of the end of the house.
 */
function buildHouseColliders(services: DistrictServices, frame: HouseFrame): void {
  const wallH = CROWN_Z + 0.3
  const cross = frame.yaw
  for (const s of [-1, 1]) {
    services.colliders.push({
      kind: 'box',
      center: frame.point(s * (HALF_SPAN + 0.05), wallH / 2, 0),
      size: new Vector3(0.5, wallH, HOUSE_LENGTH),
      yaw: cross,
    })
  }
  for (const end of [-1, 1]) {
    for (const [c0, c1] of [
      [-HALF_SPAN - 0.3, DOOR_LEFT],
      [DOOR_RIGHT, HALF_SPAN + 0.3],
    ] as const) {
      services.colliders.push({
        kind: 'box',
        center: frame.point((c0 + c1) / 2, wallH / 2, end * HALF_LENGTH),
        size: new Vector3(c1 - c0, wallH, 0.4),
        yaw: cross,
      })
    }
  }
  // The floor. Its top IS the slab datum, so the only step a guest takes is
  // the threshold's, which `buildGableDoor` breaks into ≤58 mm risers.
  services.colliders.push({
    kind: 'box',
    center: frame.point(0, -0.3, 0),
    size: new Vector3(INTERIOR_HALF_SPAN * 2, 0.6, HOUSE_LENGTH - 0.4),
    yaw: cross,
  })
  for (const across of RACK_ACROSS) {
    services.colliders.push({
      kind: 'box',
      center: frame.point(across, 1.16, 0),
      size: new Vector3(RACK_DEPTH, 2.32, RACK_LENGTH),
      yaw: cross,
    })
  }
}

// ────────────────────────────────────────────────────────── reclaim tank

const TANK_X = 81
const TANK_Z = 11.5

/** Water reclaim tank on the farm lane, fed by the ranges' downpipes. */
function buildReclaimTank(services: DistrictServices): void {
  const { writer } = services
  const base = interiorHeight(TANK_X, TANK_Z)
  const emit = (slot: string, md: MeshData): void => {
    toYUp(md)
    translate(md, [TANK_X, base, TANK_Z])
    writeInto(writer, slot, md)
  }

  // Plinth: 60 mm proud of the ground it meets, chamfered.
  const plinth = prism(circle(2.05, 28), -0.55, 0.16)
  bevel(plinth, BEVEL.carcass, 2)
  smoothShade(plinth, SMOOTH.cast)
  emit('cast', plinth)

  // Shell: a corrugated cylinder with a dished crown — a real lathed profile.
  const shellProfile: Vec2[] = [[1.6, 0.16]]
  for (let i = 0; i <= 26; i++) shellProfile.push([1.6 + (i % 2 === 0 ? 0 : 0.03), 0.26 + (i / 26) * 3.86])
  shellProfile.push([1.58, 4.28], [1.34, 4.5], [0.72, 4.64], [0.3, 4.7], [0, 4.72])
  emit('steel', revolve(shellProfile, 34, { capStart: true, capEnd: false }))

  // Bolted manway on the crown.
  emit(
    'aluminum',
    revolve(
      [
        [0, 4.72],
        [0.32, 4.72],
        [0.32, 4.8],
        [0.25, 4.84],
        [0, 4.84],
      ],
      18,
    ),
  )
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2
    const bolt = revolve(
      [
        [0, 0],
        [0.017, 0],
        [0.017, 0.014],
        [0, 0.014],
      ],
      8,
    )
    translate(bolt, [Math.cos(ang) * 0.285, Math.sin(ang) * 0.285, 4.8])
    emit('dark', bolt)
  }

  // Sight glass in two clamps, with a float marker showing the level.
  const gauge = tubeAlong(
    [
      [1.66, 0, 0.4],
      [1.66, 0, 4.0],
    ],
    circle(0.026, 10),
    { up: [0, 1, 0], cap: true },
  )
  smoothShade(gauge, SMOOTH.turned)
  emit('darkGlass', gauge)
  for (const z of [0.4, 2.2, 4.0]) {
    const clampRing = annularPrism(circle(0.062, 12), circle(0.027, 12), z - 0.022, z + 0.022, 0.005, 1)
    translate(clampRing, [1.66, 0, 0])
    emit('dark', clampRing)
  }
  const marker = revolve(
    [
      [0, -0.022],
      [0.031, -0.022],
      [0.031, 0.022],
      [0, 0.022],
    ],
    10,
  )
  translate(marker, [1.66, 0, 2.94])
  emit('orange', marker)

  // Inlet from the ranges (down the west face), outlet with a handwheel.
  const inlet = tubeAlong(
    [
      [-1.62, 0, 3.6],
      [-2.6, 0, 3.6],
      [-2.6, -5.3, 3.6],
      [-2.6, -5.3, 0.6],
    ],
    circle(0.075, 12),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(inlet, SMOOTH.turned)
  emit('aluminum', inlet)
  const outlet = tubeAlong(
    [
      [1.58, 0, 0.55],
      [2.6, 0, 0.55],
      [2.6, 0, 0.2],
    ],
    circle(0.06, 12),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(outlet, SMOOTH.turned)
  emit('aluminum', outlet)
  const valve = revolve(
    [
      [0, -0.09],
      [0.11, -0.09],
      [0.13, -0.04],
      [0.13, 0.04],
      [0.11, 0.09],
      [0, 0.09],
    ],
    14,
    { axis: 'x' },
  )
  translate(valve, [2.16, 0, 0.55])
  emit('dark', valve)
  const handwheel = revolve(
    [
      [0, 0],
      [0.03, 0],
      [0.03, 0.032],
      [0.14, 0.04],
      [0.16, 0.03],
      [0.16, 0.014],
      [0.14, 0.01],
      [0.03, 0.014],
      [0, 0.014],
    ],
    16,
  )
  translate(handwheel, [2.16, 0, 0.7])
  emit('orange', handwheel)

  // Cage ladder up the lane face.
  for (const side of [-0.24, 0.24]) {
    const stringer = tubeAlong(
      [
        [side, -1.66, 0.22],
        [side, -1.66, 4.4],
      ],
      roundedRect(0.03, 0.05, 0.006, 2),
      { up: [0, 1, 0], cap: true },
    )
    smoothShade(stringer, SMOOTH.moulded)
    emit('aluminum', stringer)
  }
  for (let i = 0; i < 14; i++) {
    emit(
      'aluminum',
      tubeAlong(
        [
          [-0.24, -1.66, 0.38 + i * 0.29],
          [0.24, -1.66, 0.38 + i * 0.29],
        ],
        circle(0.014, 8),
        { up: [0, 0, 1], cap: true },
      ),
    )
  }
  for (let i = 0; i < 6; i++) {
    const z = 2.4 + i * 0.36
    const hoop: Vec3[] = []
    for (let k = 0; k <= 14; k++) {
      const ang = -Math.PI * 0.45 + (k / 14) * Math.PI * 1.5
      hoop.push([Math.cos(ang) * 0.4, -1.86 + Math.sin(ang) * 0.4, z])
    }
    emit('aluminum', tubeAlong(hoop, circle(0.012, 6), { up: [0, 0, 1], cap: true }))
  }

  // Stencilled identity plate.
  const plate = box(-0.56, -1.78, 2.3, 0.56, -1.66, 2.64)
  bevel(plate, BEVEL.panel, 2)
  emit('steel', plate)
  const face = new Mesh(
    signQuad(),
    signageMaterial(['RECLAIM 04 · 38 m3'], {
      background: '#1c211c',
      ink: '#dfe8d6',
      widthPx: 512,
      aspect: 1.02 / 0.28,
    }),
  )
  face.scale.set(1.02, 0.28, 1)
  face.position.set(TANK_X, base + 2.47, TANK_Z - 1.785)
  face.rotation.y = Math.PI
  face.castShadow = false
  face.receiveShadow = false
  services.group.add(face)

  services.colliders.push({
    kind: 'cylinder',
    center: new Vector3(TANK_X, base + 2.4, TANK_Z),
    halfHeight: 2.4,
    radius: 1.74,
  })
}

/**
 * Rainwater runs: one visible feed from the walkable range's north collector
 * to the tank, and a catchpit at every other gable where the run goes under.
 */
function buildFarmPipework(services: DistrictServices): void {
  const { writer } = services
  const frames = houseFrames()
  const tankBase = interiorHeight(TANK_X, TANK_Z)

  const feedFrame = frames[1]
  const start = feedFrame.point(-(HALF_SPAN + 0.145), 0.11, HALF_LENGTH + 0.3)
  const junction = new Vector3(TANK_X - 2.6, tankBase + 0.6, TANK_Z - 5.3)
  const run: Vec3[] = [
    [start.x, start.y, start.z],
    [start.x, start.y, junction.z],
    [junction.x + 0.4, start.y, junction.z],
    [junction.x, junction.y, junction.z],
  ]
  const pipe = tubeAlong(run, circle(0.055, 10), { up: [0, 1, 0], cap: true })
  pipe.frame = 'y-up'
  smoothShade(pipe, SMOOTH.turned)
  writeInto(writer, 'aluminum', pipe)
  for (let i = 1; i < 6; i++) {
    const t = i / 6
    const x = start.x + (junction.x + 0.4 - start.x) * t
    const g = interiorHeight(x, junction.z)
    const saddle = box(x - 0.07, g - 0.1, junction.z - 0.07, x + 0.07, start.y - 0.055, junction.z + 0.07)
    saddle.frame = 'y-up'
    bevel(saddle, BEVEL.panel, 2)
    writeInto(writer, 'cast', saddle)
  }

  // Catchpits where the other ranges' headers turn down into the ground.
  for (const frame of frames) {
    if (frame.index === 1) continue
    for (const side of [-1, 1]) {
      const p = frame.point(side * (HALF_SPAN + 0.145), 0.11, HALF_LENGTH + 0.3)
      const g = interiorHeight(p.x, p.z)
      const drop = tubeAlong(
        [
          [p.x, p.y, p.z],
          [p.x, g - 0.2, p.z],
        ],
        circle(0.055, 10),
        { up: [0, 0, 1], cap: true },
      )
      drop.frame = 'y-up'
      smoothShade(drop, SMOOTH.turned)
      writeInto(writer, 'aluminum', drop)
      const pit = box(p.x - 0.32, g - 0.3, p.z - 0.32, p.x + 0.32, g + 0.05, p.z + 0.32)
      pit.frame = 'y-up'
      bevel(pit, BEVEL.carcass, 2)
      writeInto(writer, 'cast', pit)
      const lid = box(p.x - 0.24, g + 0.05, p.z - 0.24, p.x + 0.24, g + 0.075, p.z + 0.24)
      lid.frame = 'y-up'
      bevel(lid, BEVEL.hardware, 2)
      writeInto(writer, 'dark', lid)
    }
  }
}

// ────────────────────────────────────────────────────────────── farm depot

type Emit = (slot: string, md: MeshData, cx: number, cy: number, cz: number, rot?: number) => void

/**
 * The working edge the tram passes: a loading dock in the outer band at
 * bearing ~0 — clear of the guideway swept volume (r 94.5-99.5) and inboard
 * of the rim promenade paving (r >= 110.2). Every item stands on its own
 * ground sample, so nothing floats on the 0.39 m fall across the yard.
 */
function buildDepot(services: DistrictServices): void {
  const { writer, rng } = services
  const emitAt: Emit = (slot, md, cx, cy, cz, rot = 0) => {
    toYUp(md)
    placeYaw(md, [cx, cy, cz], rot)
    writeInto(writer, slot, md)
  }

  // ── loading dock platform ───────────────────────────────────────────
  const dockX = 106.2
  const dockZ = 3.0
  const dockHalfX = 2.6
  const dockHalfZ = 6.0
  let dockMax = -Infinity
  let dockMin = Infinity
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 20; j++) {
      const y = interiorHeight(
        dockX - dockHalfX + (i / 12) * dockHalfX * 2,
        dockZ - dockHalfZ + (j / 20) * dockHalfZ * 2,
      )
      dockMax = Math.max(dockMax, y)
      dockMin = Math.min(dockMin, y)
    }
  }
  const dockTop = dockMax + 1.05
  const body = prism(roundedRect(dockHalfX * 2, dockHalfZ * 2, 0.12, 3), dockMin - dockTop - 0.4, -0.09)
  smoothShade(body, SMOOTH.cast)
  emitAt('cast', body, dockX, dockTop, dockZ)
  const deck = prism(roundedRect(dockHalfX * 2 - 0.05, dockHalfZ * 2 - 0.05, 0.1, 3), -0.09, 0)
  bevel(deck, BEVEL.carcass, 2)
  emitAt('deck', deck, dockX, dockTop, dockZ)
  // Hazard kerb along the working face, and dock bumpers below it.
  const kerb = blockZ(-dockHalfX + 0.025, -dockHalfZ + 0.2, 0, -dockHalfX + 0.13, dockHalfZ - 0.2, 0.04, 0.006)
  emitAt('orange', kerb, dockX, dockTop, dockZ)
  for (let i = 0; i < 5; i++) {
    const bumper = blockZ(-0.12, -0.22, -0.62, 0.001, 0.22, -0.2, 0.01)
    emitAt('dark', bumper, dockX - dockHalfX, dockTop, dockZ - 4.4 + i * 2.2)
  }
  // Five-riser stair off the south end, each tread on its own datum.
  for (let i = 0; i < 5; i++) {
    const step = blockZ(-0.75, -0.32, 0, 0.75, 0, dockTop - dockMax - (i + 1) * 0.175, 0.008)
    emitAt('cast', step, dockX - 1.3, dockMax, dockZ + dockHalfZ + 0.02 + i * 0.32)
  }

  // ── canopy ───────────────────────────────────────────────────────────
  const colX = [dockX - 1.9, dockX + 1.9]
  const colZ = [dockZ - 4.6, dockZ + 4.6]
  const canopyY = dockTop + 3.5
  for (const cx of colX) {
    for (const cz of colZ) {
      const g = interiorHeight(cx, cz)
      const col = prism(roundedRect(0.2, 0.2, 0.026, 3), 0.026, canopyY - g)
      bevel(col, BEVEL.frame, 2)
      emitAt('steel', col, cx, g, cz)
      const plateMd = prism(roundedRect(0.36, 0.36, 0.02, 2), 0, 0.026)
      emitAt('dark', plateMd, cx, g, cz)
      services.colliders.push({
        kind: 'box',
        center: new Vector3(cx, g + 1.6, cz),
        size: new Vector3(0.26, 3.2, 0.26),
      })
    }
  }
  for (const cx of colX) {
    const beam = prismXZ(
      [
        [-0.16, -0.06],
        [0.16, -0.06],
        [0.16, -0.02],
        [0.045, -0.02],
        [0.045, 0.2],
        [0.16, 0.2],
        [0.16, 0.24],
        [-0.16, 0.24],
        [-0.16, 0.2],
        [-0.045, 0.2],
        [-0.045, -0.02],
        [-0.16, -0.02],
      ],
      colZ[0] - 0.6,
      colZ[1] + 0.6,
    )
    smoothShade(beam, SMOOTH.moulded)
    emitAt('steel', beam, cx, canopyY, 0)
  }
  // Corrugated deck: a real folded section, not a flat plate.
  const fold: Vec2[] = []
  const foldN = 30
  for (let i = 0; i <= foldN; i++) {
    const t = i / foldN
    fold.push([-3.1 + t * 6.2, 0.29 + 0.05 * Math.sin(t * Math.PI * 14)])
  }
  for (let i = foldN; i >= 0; i--) {
    const t = i / foldN
    fold.push([-3.1 + t * 6.2, 0.271 + 0.05 * Math.sin(t * Math.PI * 14)])
  }
  const roofMd = prismXZ(fold, colZ[0] - 0.7, colZ[1] + 0.7)
  smoothShade(roofMd, SMOOTH.moulded)
  emitAt('steel', roofMd, dockX, canopyY, 0)
  const canopyGutter = prismXZ(
    [
      [3.1, 0.2],
      [3.3, 0.2],
      [3.3, 0.33],
      [3.26, 0.33],
      [3.26, 0.238],
      [3.14, 0.238],
      [3.14, 0.33],
      [3.1, 0.33],
    ],
    colZ[0] - 0.7,
    colZ[1] + 0.7,
  )
  emitAt('aluminum', canopyGutter, dockX, canopyY, 0)
  for (let i = 0; i < 3; i++) {
    const cz = dockZ - 3.6 + i * 3.6
    emitAt('aluminum', blockZ(-0.17, -0.17, -0.12, 0.17, 0.17, 0, 0.012), dockX, canopyY + 0.26, cz)
    const lens = box(-0.12, -0.12, -0.145, 0.12, 0.12, -0.118)
    emitAt('utilityLight', lens, dockX, canopyY + 0.26, cz)
  }

  // ── pallet stacks ────────────────────────────────────────────────────
  for (const [px, pz, rot, count] of [
    [104.4, 8.4, 0.32, 6],
    [106.0, 11.0, -0.18, 5],
    [107.9, 8.9, 0.62, 4],
    [108.6, 6.6, 0.06, 6],
  ] as const) {
    const g = interiorHeight(px, pz)
    for (let k = 0; k < count; k++) {
      const z0 = k * 0.146
      for (const by of [-0.4, 0, 0.4]) {
        emitAt('fabricSand', blockZ(-0.6, by - 0.05, z0 + 0.022, 0.6, by + 0.05, z0 + 0.124, 0.005), px, g, pz, rot)
      }
      for (let b = 0; b < 5; b++) {
        const y = -0.5 + b * 0.25
        emitAt('fabricSand', blockZ(-0.6, y - 0.05, z0 + 0.124, 0.6, y + 0.05, z0 + 0.146, 0.004), px, g, pz, rot)
      }
      for (const by of [-0.44, 0, 0.44]) {
        emitAt('fabricSand', blockZ(-0.6, by - 0.05, z0, 0.6, by + 0.05, z0 + 0.022, 0.004), px, g, pz, rot)
      }
    }
    services.colliders.push({
      kind: 'box',
      center: new Vector3(px, g + (count * 0.146) / 2, pz),
      size: new Vector3(1.24, count * 0.146, 1.04),
      yaw: rot,
    })
  }

  // ── harvest crates ───────────────────────────────────────────────────
  const crate = (cx: number, cz: number, rot: number, baseY: number): void => {
    const w = 0.3
    const d = 0.2
    const h = 0.32
    const in2 = 0.022
    for (const b of [
      [-w, -d + in2, 0, -w + in2, d - in2, h],
      [w - in2, -d + in2, 0, w, d - in2, h],
      [-w, -d, 0, w, -d + in2, h],
      [-w, d - in2, 0, w, d, h],
      [-w + in2, -d + in2, 0, w - in2, d - in2, in2],
    ] as const) {
      emitAt('playBlue', blockZ(b[0], b[1], b[2], b[3], b[4], b[5], 0.003), cx, baseY, cz, rot)
    }
    for (const sy of [-1, 1]) {
      emitAt(
        'dark',
        blockZ(-w - 0.01, sy * (d - 0.004), h, w + 0.01, sy * (d + 0.01), h + 0.024, 0.004),
        cx, baseY, cz, rot,
      )
    }
    for (const sx of [-1, 1]) {
      emitAt(
        'dark',
        blockZ(sx * (w - 0.004), -d + 0.004, h, sx * (w + 0.01), d - 0.004, h + 0.024, 0.004),
        cx, baseY, cz, rot,
      )
      emitAt(
        'dark',
        blockZ(sx * w, -0.075, h - 0.13, sx * (w + 0.018), 0.075, h - 0.07, 0.003),
        cx, baseY, cz, rot,
      )
    }
  }
  for (let i = 0; i < 7; i++) crate(dockX + 0.5, dockZ - 4.5 + i * 1.5, rng.range(-0.12, 0.12), dockTop)
  for (let i = 0; i < 5; i++) crate(dockX + 1.5, dockZ - 3.6 + i * 1.5, rng.range(-0.1, 0.1), dockTop)
  for (let i = 0; i < 3; i++) crate(104.9, -1.4, rng.range(-0.2, 0.2), interiorHeight(104.9, -1.4) + i * 0.37)
  for (let i = 0; i < 3; i++) crate(105.6, -2.1, rng.range(-0.2, 0.2), interiorHeight(105.6, -2.1) + i * 0.37)

  buildFlatbed(services, emitAt, 104.9, -7.4, 0.06)
  buildPalletTruck(emitAt, 108.4, 10.6, -0.5)

  // ── yard fittings ────────────────────────────────────────────────────
  const rackG = interiorHeight(108.9, 1.2)
  const rackBack = blockZ(-0.78, -0.06, 0, 0.78, 0.06, 1.15, 0.006)
  emitAt('steel', rackBack, 108.9, rackG, 1.2, 0.4)
  for (let i = 0; i < 4; i++) {
    const bottle = revolve(
      [
        [0, 0],
        [0.13, 0.02],
        [0.14, 0.08],
        [0.14, 0.86],
        [0.1, 0.98],
        [0.04, 1.02],
        [0.04, 1.1],
        [0, 1.1],
      ],
      14,
    )
    translate(bottle, [-0.54 + i * 0.36, -0.2, 0])
    emitAt(i % 2 === 0 ? 'orange' : 'aluminum', bottle, 108.9, rackG, 1.2, 0.4)
  }

  const skipG = interiorHeight(107.6, -3.4)
  const skipShell = prism(
    [
      [-1.5, -0.85],
      [1.5, -0.85],
      [1.5, 0.85],
      [-1.5, 0.85],
    ],
    0.18,
    1.05,
  )
  bevel(skipShell, BEVEL.frame, 2)
  emitAt('orange', skipShell, 107.6, skipG, -3.4, 0.22)
  for (const s of [-1, 1]) {
    emitAt('dark', blockZ(-1.5, s * 0.6 - 0.07, 0, 1.5, s * 0.6 + 0.07, 0.18, 0.006), 107.6, skipG, -3.4, 0.22)
  }
  services.colliders.push({
    kind: 'box',
    center: new Vector3(107.6, skipG + 0.62, -3.4),
    size: new Vector3(3.1, 1.24, 1.8),
    yaw: 0.22,
  })

  for (let i = 0; i < 4; i++) {
    const bx = 103.9
    const bz = dockZ - 5.2 + i * 3.4
    const g = interiorHeight(bx, bz)
    const bollard = revolve(
      [
        [0, 0],
        [0.13, 0],
        [0.13, 0.9],
        [0.1, 0.96],
        [0, 0.96],
      ],
      14,
    )
    emitAt('orange', bollard, bx, g, bz)
    const band = annularPrism(circle(0.139, 14), circle(0.131, 14), 0.6, 0.74)
    emitAt('steel', band, bx, g, bz)
  }

  const mastG = interiorHeight(108.8, -6.2)
  const mast = revolve(
    [
      [0.11, 0],
      [0.11, 0.3],
      [0.075, 0.36],
      [0.075, 5.2],
      [0, 5.24],
    ],
    14,
  )
  emitAt('steel', mast, 108.8, mastG, -6.2)
  for (const s of [-1, 1]) {
    const head = box(-0.22, s * 0.22 - 0.14, 4.88, 0.22, s * 0.22 + 0.14, 5.1)
    bevel(head, BEVEL.panel, 2)
    rotX(head, s * -0.4, [0, s * 0.22, 4.99])
    emitAt('aluminum', head, 108.8, mastG, -6.2)
    const lens = box(-0.18, s * 0.22 - 0.1, 4.856, 0.18, s * 0.22 + 0.1, 4.878)
    rotX(lens, s * -0.4, [0, s * 0.22, 4.99])
    emitAt('utilityLight', lens, 108.8, mastG, -6.2)
  }
  services.colliders.push({
    kind: 'cylinder',
    center: new Vector3(108.8, mastG + 1.4, -6.2),
    halfHeight: 1.4,
    radius: 0.16,
  })

  // Stacked out on the yard, NOT against the dock stair — the stack used to
  // stand through its bottom two treads, and its lowest tray's underside sat
  // exactly on the ground datum.
  const trayG = interiorHeight(102.7, 9.6)
  for (let i = 0; i < 9; i++) {
    emitAt(
      'dark',
      blockZ(-0.28, -0.2, i * 0.062 - 0.012, 0.28, 0.2, i * 0.062 + 0.05, 0.006),
      102.7,
      trayG,
      9.6,
      0.18,
    )
  }

  services.colliders.push({
    kind: 'box',
    center: new Vector3(dockX, dockTop - 0.55, dockZ),
    size: new Vector3(dockHalfX * 2, 1.1, dockHalfZ * 2),
  })
}

function buildFlatbed(services: DistrictServices, emitAt: Emit, cx: number, cz: number, rot: number): void {
  const g = interiorHeight(cx, cz)
  const deckZ = 0.94
  for (const s of [-1, 1]) {
    const rail = prismYZ(
      [
        [-3.4, deckZ - 0.28],
        [3.4, deckZ - 0.28],
        [3.4, deckZ - 0.24],
        [-3.28, deckZ - 0.24],
        [-3.28, deckZ - 0.06],
        [3.4, deckZ - 0.06],
        [3.4, deckZ - 0.02],
        [-3.4, deckZ - 0.02],
      ],
      s * 0.42 - 0.035,
      s * 0.42 + 0.035,
    )
    smoothShade(rail, SMOOTH.moulded)
    emitAt('dark', rail, cx, g, cz, rot)
  }
  for (let i = 0; i < 6; i++) {
    const cross = blockZ(-1.06, -3.2 + i * 1.28 - 0.05, deckZ - 0.24, 1.06, -3.2 + i * 1.28 + 0.05, deckZ - 0.06, 0.005)
    emitAt('dark', cross, cx, g, cz, rot)
  }
  for (let i = 0; i < 11; i++) {
    const a = -1.05 + i * 0.196
    emitAt('fabricSand', blockZ(a, -3.42, deckZ - 0.02, a + 0.188, 3.42, deckZ + 0.028, 0.005), cx, g, cz, rot)
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -2.7 + i * 1.8
      emitAt('steel', blockZ(s * 1.06 - 0.045, y - 0.045, deckZ + 0.028, s * 1.06 + 0.045, y + 0.045, deckZ + 0.62, 0.005), cx, g, cz, rot)
    }
    emitAt('steel', blockZ(s * 1.06 - 0.045, -2.75, deckZ + 0.62, s * 1.06 + 0.045, 2.75, deckZ + 0.685, 0.004), cx, g, cz, rot)
  }
  for (const ay of [-1.1, 0.35]) {
    const axle = tubeAlong(
      [
        [-1.02, ay, 0.44],
        [1.02, ay, 0.44],
      ],
      circle(0.055, 12),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(axle, SMOOTH.turned)
    emitAt('dark', axle, cx, g, cz, rot)
    for (const s of [-1, 1]) {
      const tyre = lathe(
        [
          [0.24, -0.14],
          [0.4, -0.13],
          [0.44, -0.08],
          [0.44, 0.08],
          [0.4, 0.13],
          [0.24, 0.14],
          [0.24, 0.1],
          [0.3, 0.06],
          [0.3, -0.06],
          [0.24, -0.1],
        ],
        20,
      )
      rotX(tyre, -Math.PI / 2)
      translate(tyre, [s * 0.95, ay, 0.44])
      emitAt('dark', tyre, cx, g, cz, rot)
      const hub = revolve(
        [
          [0, -0.03],
          [0.16, -0.03],
          [0.24, 0.02],
          [0.24, 0.06],
          [0, 0.06],
        ],
        16,
        { axis: 'x' },
      )
      translate(hub, [s * 1.05, ay, 0.44])
      emitAt('aluminum', hub, cx, g, cz, rot)
    }
    for (const s of [-1, 1]) {
      const guard = prismXZ(
        [
          [s * 0.48, 0.86],
          [s * 1.12, 0.86],
          [s * 1.12, 0.9],
          [s * 0.48, 0.9],
        ],
        ay - 0.55,
        ay + 0.55,
      )
      emitAt('steel', guard, cx, g, cz, rot)
    }
  }
  const drawbar = tubeAlong(
    [
      [0, -3.4, deckZ - 0.16],
      [0, -4.5, 0.52],
    ],
    roundedRect(0.12, 0.12, 0.02, 2),
    { up: [0, 1, 0], cap: true },
  )
  smoothShade(drawbar, SMOOTH.moulded)
  emitAt('dark', drawbar, cx, g, cz, rot)
  const eye = annularPrism(circle(0.11, 14), circle(0.05, 14), -0.03, 0.03, 0.008, 1)
  translate(eye, [0, -4.56, 0.52])
  emitAt('dark', eye, cx, g, cz, rot)
  for (const s of [-1, 1]) {
    emitAt('aluminum', blockZ(s * 0.7 - 0.05, -3.05, 0.03, s * 0.7 + 0.05, -2.95, deckZ - 0.26, 0.005), cx, g, cz, rot)
    const foot = prism(roundedRect(0.2, 0.2, 0.02, 2), 0, 0.03)
    translate(foot, [s * 0.7, -3.0, 0])
    emitAt('dark', foot, cx, g, cz, rot)
  }
  const tarp = tubeAlong(
    [
      [-0.8, -3.2, deckZ + 0.2],
      [0.8, -3.2, deckZ + 0.2],
    ],
    circle(0.17, 12),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(tarp, SMOOTH.turned)
  emitAt('fabricRust', tarp, cx, g, cz, rot)

  services.colliders.push({
    kind: 'box',
    center: new Vector3(cx, g + 0.7, cz),
    size: new Vector3(2.3, 1.4, 7.0),
    yaw: rot,
  })
}

function buildPalletTruck(emitAt: Emit, cx: number, cz: number, rot: number): void {
  const g = interiorHeight(cx, cz)
  for (const s of [-1, 1]) {
    const fork = prismYZ(
      [
        [-0.6, 0.055],
        [0.62, 0.055],
        [0.62, 0.09],
        [-0.6, 0.09],
      ],
      s * 0.19 - 0.04,
      s * 0.19 + 0.04,
    )
    emitAt('orange', fork, cx, g, cz, rot)
    const roller = revolve(
      [
        [0, -0.02],
        [0.05, -0.02],
        [0.05, 0.02],
        [0, 0.02],
      ],
      10,
      { axis: 'x' },
    )
    translate(roller, [s * 0.19, -0.56, 0.05])
    emitAt('dark', roller, cx, g, cz, rot)
    const wheel = revolve(
      [
        [0, -0.035],
        [0.09, -0.035],
        [0.09, 0.035],
        [0, 0.035],
      ],
      12,
      { axis: 'x' },
    )
    translate(wheel, [s * 0.13, 0.74, 0.09])
    emitAt('dark', wheel, cx, g, cz, rot)
  }
  const bodyMd = box(-0.16, 0.62, 0.03, 0.16, 0.86, 0.34)
  bevel(bodyMd, BEVEL.frame, 2)
  emitAt('orange', bodyMd, cx, g, cz, rot)
  const handle = tubeAlong(
    [
      [0, 0.78, 0.3],
      [0, 1.02, 0.98],
      [0, 1.0, 1.12],
    ],
    circle(0.022, 8),
    { up: [0, 1, 0], cap: true },
  )
  smoothShade(handle, SMOOTH.turned)
  emitAt('dark', handle, cx, g, cz, rot)
  const grip = tubeAlong(
    [
      [-0.16, 1.0, 1.12],
      [0.16, 1.0, 1.12],
    ],
    circle(0.026, 10),
    { up: [0, 0, 1], cap: true },
  )
  emitAt('dark', grip, cx, g, cz, rot)
}

// ─────────────────────────────────────────────────────────────── assembly

export function buildFarmside(services: DistrictServices): void {
  const { writer } = services
  const sheet = new PaneSheet()

  for (const frame of houseFrames()) {
    buildFoundation(writer, frame)
    buildFloorSlab(writer, frame)
    buildBaseTrack(writer, frame)
    buildVaultFrame(writer, frame)
    buildTransoms(writer, frame)
    buildVaultGlazing(sheet, frame)
    buildRidge(writer, frame)
    buildVents(writer, frame)
    buildGutters(writer, frame)
    buildShadeRails(writer, frame)
    // Every range is walk-through: an identical entrance at BOTH gables.
    for (const end of [-1, 1]) {
      buildGable(services, sheet, frame, end)
      buildHouseSign(services, frame, end)
    }
    buildRoomLights(writer, frame)
    buildHouseColliders(services, frame)
  }

  buildFarmPipework(services)
  buildReclaimTank(services)
  buildDepot(services)

  const glass = sheet.build(paneGlass(), 'farmside:glazing')
  if (glass) services.group.add(glass)
}

