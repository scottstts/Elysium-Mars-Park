import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector3 } from 'three'
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
  chamferRect,
  circle,
  loft,
  panelWithHoles,
  placeYaw,
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
import { signageMaterial } from '../../materials/library'
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

/** Gable module: eight 1.125 m bays, the doorway occupying exactly one. */
const GABLE_MULLIONS = Array.from({ length: 9 }, (_, i) => -HALF_SPAN + i * (HOUSE_WIDTH / 8))
const DOOR_BAY = 5
export const DOOR_ACROSS = (GABLE_MULLIONS[DOOR_BAY] + GABLE_MULLIONS[DOOR_BAY + 1]) / 2
export const DOOR_CLEAR_WIDTH = HOUSE_WIDTH / 8 - 0.04
export const DOOR_HEAD_Z = 2.3
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

function buildFoundation(writer: PartWriter, frame: HouseFrame, doorway: boolean): void {
  const bury = frame.floorY - frame.groundMin + 0.3
  const profile = foundationProfile(bury)
  const hw = HALF_SPAN
  const hl = HALF_LENGTH
  if (!doorway) {
    const md = runMolding(
      [
        [-hw, -hl],
        [hw, -hl],
        [hw, hl],
        [-hw, hl],
      ],
      profile,
      false,
      true,
    )
    smoothShade(md, SMOOTH.cast)
    place(writer, 'cast', md, frame)
    return
  }
  // ONE continuous casting that starts at one door jamb, mitres round all
  // four corners and stops at the other — the run is split, never cut.
  const jambL = DOOR_ACROSS - DOOR_CLEAR_WIDTH / 2 - 0.02
  const jambR = DOOR_ACROSS + DOOR_CLEAR_WIDTH / 2 + 0.02
  const md = runMolding(
    [
      [jambR, -hl],
      [hw, -hl],
      [hw, hl],
      [-hw, hl],
      [-hw, -hl],
      [jambL, -hl],
    ],
    profile,
    true,
    false,
  )
  smoothShade(md, SMOOTH.cast)
  place(writer, 'cast', md, frame)
  // Threshold: a shallow cast sill across the opening, 35 mm proud.
  const sill = prism(
    roundedRect(DOOR_CLEAR_WIDTH + 0.3, 0.5, 0.024, 2).map(([a, l]) => [a + DOOR_ACROSS, l - hl] as Vec2),
    -0.2,
    0.035,
  )
  bevel(sill, BEVEL.carcass, 2)
  place(writer, 'cast', sill, frame)
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

/** Cast shoe + two bolt heads where each rib lands on the foundation. */
function buildRibShoes(writer: PartWriter, frame: HouseFrame, along: number): void {
  for (const side of [-1, 1]) {
    const a0 = side < 0 ? -HALF_SPAN - 0.1 : HALF_SPAN - 0.24
    const a1 = side < 0 ? -HALF_SPAN + 0.24 : HALF_SPAN + 0.1
    const shoe = prismYZ(
      [
        [along - 0.1, FOUND_TOP],
        [along + 0.1, FOUND_TOP],
        [along + 0.1, FOUND_TOP + 0.052],
        [along + 0.07, FOUND_TOP + 0.08],
        [along - 0.07, FOUND_TOP + 0.08],
        [along - 0.1, FOUND_TOP + 0.052],
      ],
      Math.min(a0, a1),
      Math.max(a0, a1),
    )
    smoothShade(shoe, SMOOTH.cast)
    place(writer, 'dark', shoe, frame)
    for (const d of [-0.062, 0.062]) {
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
      buildRibShoes(writer, frame, along)
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
      const leftHalf = bar % BARS_PER_BAY === 0 ? 0.039 : 0.027
      const rightHalf = (bar + 1) % BARS_PER_BAY === 0 ? 0.039 : 0.027
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

/** Outer face of the gable frame: 4 mm inboard of the end rib's foot. */
const GABLE_FACE = 0.062
const GABLE_DEPTH = 0.075
const GABLE_ROWS = [0, EAVES_Z, DOOR_HEAD_Z, 3.3, 4.2, 4.8]
/** The louvred vent fills exactly one bay/row cell of the gable grid. */
const VENT_BAY = 4
const VENT_ROW = 3

/** Where a vertical gable member meets the perimeter arch soffit. */
function gableSoffit(across: number): number {
  const inner = ARC_R - 0.115
  const x = Math.min(Math.abs(across), inner)
  return ARC_C + Math.sqrt(Math.max(0, inner * inner - x * x))
}

/** One straight gable member, drawn between two points in the gable plane. */
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
): void {
  const length = Math.hypot(a1 - a0, z1 - z0)
  if (length < 0.05) return
  const y0 = end * (HALF_LENGTH - GABLE_FACE)
  const y1 = end * (HALF_LENGTH - GABLE_FACE - GABLE_DEPTH)
  const ua = (a1 - a0) / length
  const uz = (z1 - z0) / length
  const ring = (a: number, z: number, y: number): Vec3[] => [
    [a - uz * half, y, z + ua * half],
    [a + uz * half, y, z - ua * half],
  ]
  const md = loft(
    [
      [...ring(a0, z0, y0), ...ring(a0, z0, y1).reverse()],
      [...ring(a1, z1, y0), ...ring(a1, z1, y1).reverse()],
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(md, SMOOTH.moulded)
  place(writer, slot, md, frame)
}

function buildGable(
  writer: PartWriter,
  sheet: PaneSheet,
  frame: HouseFrame,
  end: number,
  doorway: boolean,
): void {
  const paneY = end * (HALF_LENGTH - GABLE_FACE - 0.03)
  const doorL = DOOR_ACROSS - DOOR_CLEAR_WIDTH / 2
  const doorR = DOOR_ACROSS + DOOR_CLEAR_WIDTH / 2

  // Perimeter arch member, generated from the same section as the vault, so
  // the corner between the gable and the shell closes with no sliver.
  const archPath: Vec3[] = SECTION_STATIONS.map((u) => {
    const [a, z] = sectionOffset(u, -0.055)
    return [a, end * (HALF_LENGTH - GABLE_FACE - GABLE_DEPTH / 2), z] as Vec3
  })
  const arch = tubeAlong(archPath, roundedRect(0.11, GABLE_DEPTH + 0.03, 0.008, 2), { up: [0, 1, 0], cap: true })
  smoothShade(arch, SMOOTH.moulded)
  place(writer, 'steel', arch, frame)
  // Cill member closing the foot of the gable between the two haunches.
  gableMember(writer, frame, 'aluminum', -HALF_SPAN + 0.34, FOUND_TOP + 0.03, HALF_SPAN - 0.34, FOUND_TOP + 0.03, 0.03, end)

  // Mullions from the cill to the arch; the door jambs are heavier.
  for (let i = 1; i < GABLE_MULLIONS.length - 1; i++) {
    const a = GABLE_MULLIONS[i]
    const isJamb = doorway && (i === DOOR_BAY || i === DOOR_BAY + 1)
    gableMember(
      writer,
      frame,
      isJamb ? 'steel' : 'aluminum',
      a,
      FOUND_TOP + 0.06,
      a,
      gableSoffit(a),
      isJamb ? 0.05 : 0.032,
      end,
    )
  }
  // Transoms: SEGMENTED between the mullions (mullions are continuous, the
  // family that crosses them is split — the gridshell rule), each run also
  // stopping where the arch soffit cuts it.
  for (const z of GABLE_ROWS) {
    if (z < 0.02) continue
    const inner = ARC_R - 0.115
    const reach = Math.sqrt(Math.max(0, inner * inner - (z - ARC_C) * (z - ARC_C)))
    const limit = (z <= EAVES_Z ? HALF_SPAN : Math.min(HALF_SPAN, reach)) - 0.055
    if (limit < 0.12) continue
    const isHead = doorway && z === DOOR_HEAD_Z
    for (let i = 0; i < GABLE_MULLIONS.length - 1; i++) {
      const jambBay = isHead && i === DOOR_BAY
      const mullHalf = (k: number) =>
        doorway && (k === DOOR_BAY || k === DOOR_BAY + 1) ? 0.05 : k === 0 || k === GABLE_MULLIONS.length - 1 ? 0 : 0.032
      let a0 = GABLE_MULLIONS[i] + mullHalf(i) + 0.004
      let a1 = GABLE_MULLIONS[i + 1] - mullHalf(i + 1) - 0.004
      a0 = Math.max(a0, -limit)
      a1 = Math.min(a1, limit)
      if (a1 - a0 < 0.06) continue
      gableMember(writer, frame, jambBay ? 'steel' : 'aluminum', a0, z, a1, z, jambBay ? 0.06 : 0.03, end)
    }
  }

  // Panes: one per (bay, row) cell, clipped under the arch and skipped inside
  // the door opening — the welded-grid aperture idea, no boolean anywhere.
  for (let i = 0; i < GABLE_MULLIONS.length - 1; i++) {
    const a0 = GABLE_MULLIONS[i]
    const a1 = GABLE_MULLIONS[i + 1]
    const topL = gableSoffit(a0) - 0.03
    const topR = gableSoffit(a1) - 0.03
    for (let r = 0; r < GABLE_ROWS.length - 1; r++) {
      const z0 = (r === 0 ? FOUND_TOP + 0.07 : GABLE_ROWS[r] + 0.04)
      const z1 = GABLE_ROWS[r + 1] - 0.04
      if (z1 <= z0 + 0.03) continue
      if (doorway && a0 > doorL - 0.01 && a1 < doorR + 0.01 && GABLE_ROWS[r + 1] < DOOR_HEAD_Z + 0.01) continue
      if (!doorway && i === VENT_BAY && r === VENT_ROW) continue
      const zl = Math.min(z1, topL)
      const zr = Math.min(z1, topR)
      if (zl <= z0 + 0.05 && zr <= z0 + 0.05) continue
      const m = 0.04
      const bl = frame.point(a0 + m, z0, paneY)
      const br = frame.point(a1 - m, z0, paneY)
      const cr = frame.point(a1 - m, Math.max(z0 + 0.05, zr), paneY)
      const cl = frame.point(a0 + m, Math.max(z0 + 0.05, zl), paneY)
      if (end > 0) sheet.quad(cl, cr, br, bl)
      else sheet.quad(bl, br, cr, cl)
    }
  }

  // Louvred gable vent — it FILLS one grid cell (bay VENT_BAY, row VENT_ROW)
  // whose pane is skipped, so it is an aperture in the frame, not a patch
  // laid over it.
  if (!doorway) {
    const a0 = GABLE_MULLIONS[VENT_BAY] + 0.038
    const a1 = GABLE_MULLIONS[VENT_BAY + 1] - 0.038
    const z0 = GABLE_ROWS[VENT_ROW] + 0.036
    const z1 = GABLE_ROWS[VENT_ROW + 1] - 0.036
    const yIn = end * (HALF_LENGTH - GABLE_FACE - GABLE_DEPTH)
    const yOut = end * (HALF_LENGTH - GABLE_FACE)
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
}

// ───────────────────────────────────────────────────── signage + lighting

const HOUSE_LABELS = ['RANGE A · LEAF', 'RANGE B · HALL', 'RANGE C · ROOT']

function buildHouseSign(services: DistrictServices, frame: HouseFrame): void {
  const { writer } = services
  const backY = -(HALF_LENGTH - GABLE_FACE - GABLE_DEPTH) + 0.001
  const plateY = -(HALF_LENGTH + 0.075)
  const cz = 2.66
  // Two brackets off the gable head transom carry the plate clear of it.
  for (const a of [-0.86, 0.86]) {
    const bracket = box(a - 0.045, plateY, cz - 0.32, a + 0.045, backY, cz + 0.04)
    bevel(bracket, BEVEL.panel, 2)
    place(writer, 'dark', bracket, frame)
  }
  const plate = box(-1.06, plateY - 0.075, cz - 0.25, 1.06, plateY, cz + 0.25)
  bevel(plate, BEVEL.panel, 2)
  place(writer, 'steel', plate, frame)
  const lens = box(-0.99, plateY - 0.089, cz - 0.19, 0.99, plateY - 0.073, cz + 0.19)
  place(writer, 'signageGlow', lens, frame)

  const face = new Mesh(
    signQuad(),
    signageMaterial([HOUSE_LABELS[frame.index]], {
      background: '#1a1d19',
      ink: '#e8f2df',
      widthPx: 512,
    }),
  )
  face.scale.set(1.92, 0.34, 1)
  face.position.copy(frame.point(0, cz, plateY - 0.093))
  face.rotation.y = frame.yaw + Math.PI
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

function buildHouseColliders(services: DistrictServices, frame: HouseFrame): void {
  const wallH = CROWN_Z + 0.3
  const cross = frame.yaw + Math.PI / 2
  if (frame.index !== 1) {
    services.colliders.push({
      kind: 'box',
      center: frame.point(0, wallH / 2, 0),
      size: new Vector3(HOUSE_WIDTH + 0.6, wallH, HOUSE_LENGTH + 0.6),
      yaw: cross,
    })
    return
  }
  for (const s of [-1, 1]) {
    services.colliders.push({
      kind: 'box',
      center: frame.point(s * (HALF_SPAN + 0.05), wallH / 2, 0),
      size: new Vector3(0.5, wallH, HOUSE_LENGTH),
      yaw: cross,
    })
  }
  services.colliders.push({
    kind: 'box',
    center: frame.point(0, wallH / 2, HALF_LENGTH),
    size: new Vector3(0.4, wallH, HOUSE_WIDTH),
    yaw: cross,
  })
  const jambL = DOOR_ACROSS - DOOR_CLEAR_WIDTH / 2
  const jambR = DOOR_ACROSS + DOOR_CLEAR_WIDTH / 2
  for (const [c0, c1] of [
    [-HALF_SPAN, jambL],
    [jambR, HALF_SPAN],
  ] as const) {
    services.colliders.push({
      kind: 'box',
      center: frame.point((c0 + c1) / 2, wallH / 2, -HALF_LENGTH),
      size: new Vector3(0.4, wallH, c1 - c0),
      yaw: cross,
    })
  }
  // The floor: a 55 mm step at the threshold, well under the character
  // controller's 0.42 m autostep.
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
    signageMaterial(['RECLAIM 04 · 38 m3'], { background: '#1c211c', ink: '#dfe8d6', widthPx: 512 }),
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

  const trayG = interiorHeight(103.9, 9.6)
  for (let i = 0; i < 9; i++) {
    emitAt('dark', blockZ(-0.28, -0.2, i * 0.062, 0.28, 0.2, i * 0.062 + 0.05, 0.006), 103.9, trayG, 9.6, 0.18)
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
    const walkable = frame.index === 1
    buildFoundation(writer, frame, walkable)
    buildFloorSlab(writer, frame)
    buildBaseTrack(writer, frame)
    buildVaultFrame(writer, frame)
    buildTransoms(writer, frame)
    buildVaultGlazing(sheet, frame)
    buildRidge(writer, frame)
    buildVents(writer, frame)
    buildGutters(writer, frame)
    buildShadeRails(writer, frame)
    buildGable(writer, sheet, frame, -1, walkable)
    buildGable(writer, sheet, frame, 1, false)
    buildRoomLights(writer, frame)
    buildHouseSign(services, frame)
    buildHouseColliders(services, frame)
  }

  buildFarmPipework(services)
  buildReclaimTank(services)
  buildDepot(services)

  const glass = sheet.build(paneGlass(), 'farmside:glazing')
  if (glass) services.group.add(glass)
}

