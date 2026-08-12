import { DoubleSide, Mesh, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, mrt, normalView, vec3, vec4 } from 'three/tsl'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  type Vec2,
  type Vec3,
  box,
  chamferRect,
  circle,
  cleanMesh,
  join,
  loft,
  prism,
  revolve,
  rotateZ,
  roundedBox,
  roundedRect,
  smoothShade,
  toGeometry,
  toYUp,
  translate,
  tubeAlong,
  writeInto,
} from '../../archkit/meshdata'
import { bench } from '../../archkit/kit'
import {
  DOME_CENTER_Y,
  DOME_SPHERE_RADIUS,
} from '../../dome/latticeField'
import { signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { lightFixtures } from '../lightFixtures'
import { FREEDOM_TOWER, PADS } from '../parkPlan'
import { curtainGlassMaterial } from './commons'
import type { DistrictServices } from './types'

/**
 * FREEDOM TOWER — the landmark of Elysium Commons.
 *
 * A hyperboloid steel lattice (two ruled families of sixteen straight tubes,
 * Shukhov's geometry: every "curve" is straight members) rises off a stepped
 * cast stylobate to carry a sixteen-bay glass gallery just beneath the dome
 * shell, roofed by a faceted glass tent that closes into an octagonal spire.
 * A panoramic glass cab rides the central service mast from the boarding
 * lobby to the gallery; `world/freedomElevator.ts` owns everything that
 * moves (cab, doors, ropes, counterweight) and reads its datums from
 * `freedomFrame()` below so the two files can never disagree.
 *
 * Authoring frame: Z-up, plan (x, y) = metres east/south of the tower axis,
 * z = height above the PAD datum. `emit()` translates by [CX, CZ, PADY] and
 * converts to world Y-up. The paved ground plane inside the terrace disc
 * belongs to the PAVING system ('freedom-terrace' region, the
 * station-terrace pattern): every casting here stands on that slab with
 * line-contact skirts, never with a coplanar face.
 *
 * Height chain (the reason nothing here hardcodes a height): the spire tip
 * is DERIVED from the dome-shell sphere so the tower always ends
 * TIP_CLEARANCE below the glass at this exact plan radius, and every other
 * level hangs off that number.
 *
 * Assembly rules used throughout (geometry-craft.md §3, notes.md):
 *  - metal-on-metal joints bury inside ONE slot (welds);
 *  - metal never touches cast: base plates float 3 mm inside cast rebates
 *    whose lips hide the gap (the cup/socket idiom);
 *  - glass tucks into its channels/members (the licensed glazing lap);
 *  - every reveal ≥ 3 mm, every deliberate gap ≥ 4 mm, flush is forbidden.
 */

// ------------------------------------------------------------------ frame

const CX = FREEDOM_TOWER.x
const CZ = FREEDOM_TOWER.z
const PADY = PADS.find((pad) => pad.id === 'freedom-tower')?.y ?? 0.55
const R_SITE = Math.hypot(CX, CZ)
/** Inner dome-glass height over the tower axis (world Y). */
const GLASS_Y = Math.sqrt(DOME_SPHERE_RADIUS ** 2 - R_SITE ** 2) + DOME_CENTER_Y
const TIP_CLEARANCE = 0.9

/** Local z datums (0 = pad regolith datum = PADY in world Y). */
const Z_SLAB = 0.075 // paving slab top (PAVE.rise)
const Z_TERR = 0.436 // terrace walking surface
const Z_PIT = 0.28 // elevator pit floor inside the shaft curb
const Z_TIP = GLASS_Y - TIP_CLEARANCE - PADY // spire tip
const Z_DECK = Z_TIP - 10.55 // gallery walking surface
const CROWN = (dz: number): number => Z_DECK + dz

/** Crown stack, as offsets over the deck. */
const WALL_HEAD = 2.78 // head ring beam centre band 2.78..3.00
const EAVE_TOP = 3.05 // roof springing
const ROOF_RINGS: Array<[number, number]> = [
  // [plan radius, z over deck] — the faceted tent line, eave → apex.
  [5.45, EAVE_TOP],
  [3.9, 4.3],
  [2.3, 5.45],
  [0.78, 6.25],
]
const Z_SPIRE_BASE = CROWN(5.9)

/** Lattice. */
const LEGS = 16 // per family; two families = 32 tubes
const R_LEG_BASE = 7.8
const R_LEG_TOP = 4.42
const TWIST = 1.55 // rad of plan rotation base→top per family (opposed)
const Z_LEG_BASE = 1.2
const Z_LEG_TOP = Z_DECK - 0.8
const LEG_R0 = 0.2 // tube radius at the base
const LEG_R1 = 0.15 // tube radius at the head
/** Tangential stagger so the two sockets on one pedestal never cross. */
const LEG_SPLIT = 0.026

/** Ring stiffeners: chosen BETWEEN the leg-crossing bands (see notes). */
const RING_Z = [5.2, 13.6, 18.8, 22.8, 26.2, 29.3, 32.5, 35.7]
const RING_R = 0.085

/** Elevator geometry shared with the system. */
const DOOR_A = FREEDOM_TOWER.doorAngle
const UX = Math.cos(DOOR_A)
const UZ = Math.sin(DOOR_A)
const CAB_S = 1.98 // cab axis offset from the tower axis, along the door axis
const CAB_R = 1.16 // cab glass outer radius
const CORE_S = -0.95 // mast centre offset (opposite side)
const CORE_HALF = 0.73 // mast chord half-spacing
const SHAFT_R = 1.44 // shaft screen glass line about the spine
const PORTAL_HALF_ARC = 0.44 // portal clear half-angle about the door axis
const SCREEN_TOP = 2.95 // screen glass head over each landing floor
const CAB_FLOOR_LIFT = 0.026 // cab floor top over the landing walking surface

/** Deck plan. */
const R_DECK = 5.45
const R_RING_GIRDER = 4.42
const DECK_PLATE = 0.16

export interface FreedomFrame {
  cx: number
  cz: number
  padY: number
  /** World Y datums. */
  terraceY: number
  deckY: number
  tipY: number
  /** Door axis: unit plan vector from the tower axis toward the approach. */
  ux: number
  uz: number
  doorAngle: number
  /** Cab axis (world XZ) and drum radius. */
  cabX: number
  cabZ: number
  cabR: number
  /** Parked cab-floor heights (world Y) at the two landings. */
  cabFloorBottomY: number
  cabFloorTopY: number
  /** Portal centres (world), at handle height, for captions + door zones. */
  doorAnchorBottom: Vector3
  doorAnchorTop: Vector3
  /** Alight stand points (world, at floor level). */
  standBottom: Vector3
  standTop: Vector3
  screenTop: number
  portalHalfArc: number
  shaftR: number
  coreS: number
  coreHalf: number
  cabS: number
}

/** Every datum the elevator needs, derived once — no second source of truth. */
export function freedomFrame(): FreedomFrame {
  const cabX = CX + UX * CAB_S
  const cabZ = CZ + UZ * CAB_S
  const portalS = CAB_S + SHAFT_R
  const doorBottom = new Vector3(
    CX + UX * portalS,
    PADY + Z_TERR + 1.1,
    CZ + UZ * portalS,
  )
  const doorTop = new Vector3(CX + UX * portalS, PADY + Z_DECK + 1.1, CZ + UZ * portalS)
  return {
    cx: CX,
    cz: CZ,
    padY: PADY,
    terraceY: PADY + Z_TERR,
    deckY: PADY + Z_DECK,
    tipY: PADY + Z_TIP,
    ux: UX,
    uz: UZ,
    doorAngle: DOOR_A,
    cabX,
    cabZ,
    cabR: CAB_R,
    cabFloorBottomY: PADY + Z_TERR + CAB_FLOOR_LIFT,
    cabFloorTopY: PADY + Z_DECK + CAB_FLOOR_LIFT,
    doorAnchorBottom: doorBottom,
    doorAnchorTop: doorTop,
    standBottom: new Vector3(CX + UX * (portalS + 1.3), PADY + Z_TERR, CZ + UZ * (portalS + 1.3)),
    standTop: new Vector3(CX + UX * (portalS + 1.35), PADY + Z_DECK, CZ + UZ * (portalS + 1.35)),
    screenTop: SCREEN_TOP,
    portalHalfArc: PORTAL_HALF_ARC,
    shaftR: SHAFT_R,
    coreS: CORE_S,
    coreHalf: CORE_HALF,
    cabS: CAB_S,
  }
}

// ------------------------------------------------------------- local helpers

/** Door-axis plan frame: p(s, t) = s·u + t·v in local plan (x, y). */
function pw(s: number, t: number): Vec2 {
  return [s * UX - t * UZ, s * UZ + t * UX]
}

/** Leg centreline: family f (+1/−1), index i, parameter k ∈ [0,1]. */
function legPoint(f: number, i: number, k: number): Vec3 {
  const a0 = DOOR_A + Math.PI / LEGS + (i / LEGS) * Math.PI * 2 - f * LEG_SPLIT
  const a1 = a0 + f * TWIST
  const x0 = Math.cos(a0) * R_LEG_BASE
  const y0 = Math.sin(a0) * R_LEG_BASE
  const x1 = Math.cos(a1) * R_LEG_TOP
  const y1 = Math.sin(a1) * R_LEG_TOP
  return [
    x0 + (x1 - x0) * k,
    y0 + (y1 - y0) * k,
    Z_LEG_BASE + (Z_LEG_TOP - Z_LEG_BASE) * k,
  ]
}

function legRadius(k: number): number {
  return LEG_R0 + (LEG_R1 - LEG_R0) * k
}

/** Hyperboloid surface radius at parameter k (all legs share it). */
function latticeRadius(k: number): number {
  const p = legPoint(1, 0, k)
  return Math.hypot(p[0], p[1])
}

/** The shaft "stadium": boundary distance from the tower axis at plan angle b
 *  (measured from the door axis). Star-shaped about the axis, so a radial ray
 *  hits it exactly once — the deck aperture, both screens and the curbs are
 *  all generated from this one outline. */
function stadiumRadius(b: number, grow = 0): number {
  const r = SHAFT_R + grow
  const dir: Vec2 = [Math.cos(b), Math.sin(b)]
  // Ray from origin against the stadium about the spine s ∈ [CORE_S, CAB_S].
  // Solve max u with |p(u) - clamp_spine(p(u))| = r, by bisection (the
  // outline is star-shaped, monotone along the ray).
  let lo = 0.2
  let hi = CAB_S + r + 0.5
  for (let iter = 0; iter < 28; iter++) {
    const mid = (lo + hi) / 2
    const s = dir[0] * mid
    const t = dir[1] * mid
    const cs = Math.min(CAB_S, Math.max(CORE_S, s))
    const d = Math.hypot(s - cs, t)
    if (d < r) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Stadium outline in LOCAL PLAN points (CCW), portal gap optional. */
function stadiumOutline(grow: number, segments: number): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const b = (i / segments) * Math.PI * 2
    const r = stadiumRadius(b, grow)
    pts.push(pw(Math.cos(b) * r, Math.sin(b) * r))
  }
  return pts
}

// ---------------------------------------------------------------- materials

let glassMaterial: ReturnType<typeof curtainGlassMaterial> | null = null
let screenGlassMaterial: MeshStandardNodeMaterial | null = null

/** Shaft-screen safety glass: cheap alpha (the cab must read through it). */
function shaftGlass(): MeshStandardNodeMaterial {
  if (screenGlassMaterial) return screenGlassMaterial
  const material = new MeshStandardNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.colorNode = vec3(0.52, 0.56, 0.57)
  material.opacityNode = float(0.14)
  material.roughness = 0.06
  material.metalness = 0
  // AO receiver mask 0 — all glazing writes it (see `curtainGlassMaterial`).
  // A transparent material is worse than an opaque one here: without the
  // override it stamps its own normal + receiver 1 over the screen's WHOLE
  // rasterized quad (opacity gates colour only), so the shaft screens both
  // took AO themselves and erased the G-buffer of the cab behind them.
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  screenGlassMaterial = material
  return material
}


/** A printed face quad with REAL 0..1 UVs. A bare `MeshData.from` quad has
 *  none, so `toTriangles` falls back to planar WORLD-coordinate UVs — far
 *  outside [0,1], which a clamped CanvasTexture renders as one edge-pixel
 *  smear (the blade shipped as a blank dark plate). Corner order is
 *  bottom-left, bottom-right, top-right, top-left. */
function printedQuad(corners: [Vec3, Vec3, Vec3, Vec3], mirrorU = false): MeshData {
  const md = MeshData.from(corners, [[0, 1, 2, 3]])
  // The read direction is fixed by the VERTEX-TO-UV pairing alone (winding
  // only decides the lit side, which DoubleSide already covers): mirrorU
  // hands the left-hand vertices u = 1, for faces whose authored +x ends up
  // pointing screen-LEFT from the reading position.
  md.uvs = [
    mirrorU
      ? [
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
  ]
  return md
}

/** Sign-face material: zero-thickness applied quads render both sides (a
 *  single-sided face's winding is a coin toss — notes.md, commons signs). */
function signFace(
  lines: string[],
  options?: Parameters<typeof signageMaterial>[1],
): ReturnType<typeof signageMaterial> {
  const material = signageMaterial(lines, options)
  material.side = DoubleSide
  return material
}

// ----------------------------------------------------------------- builders

interface Build {
  parts: Record<string, MeshData[]>
  glass: MeshData[]
  screenGlass: MeshData[]
}

function slotPush(build: Build, slot: string, md: MeshData): void {
  ;(build.parts[slot] ??= []).push(md)
}

/**
 * The stylobate: one continuous three-step revolve around the terrace, the
 * sector-jointed terrace field, the shaft curb with its glazing rebate and
 * the elevator pit. Bottom edges bury 20 mm below the paved slab top so
 * ground contact is always a line crossing, never a shared face.
 */
function buildStylobate(build: Build): void {
  // Step ring: one CLOSED section swept around the full circle (tubeAlong's
  // profile is a closed polygon by construction, so the winding is decided
  // by signed volume, never by an open-band coin toss). Risers lean back,
  // every nosing carries a chamfered arris and an undercut drip throat.
  const steps: Array<[number, number]> = [
    [11.72, 0.192],
    [11.3, 0.314],
    [10.88, Z_TERR],
  ]
  const section: Vec2[] = [[11.78, Z_SLAB - 0.02]]
  let prev = Z_SLAB
  for (const [nose, top] of steps) {
    section.push([nose + 0.012, prev + 0.004])
    section.push([nose, top - 0.03]) // battered riser
    section.push([nose + 0.014, top - 0.024]) // drip throat
    section.push([nose + 0.014, top - 0.016]) // nose underside
    section.push([nose - 0.004, top]) // arris
    section.push([nose - 0.34, top]) // tread
    prev = top
  }
  // The top tread IS the terrace edge band (inner face at r 10.54); the
  // section then drops into the enclosed void and closes back underground.
  section.push([10.54, 0.34])
  section.push([10.66, 0.055])
  section.push([11.2, 0.03])
  slotPush(build, 'cast', ringSolid(section, 176, SMOOTH.cast))

  // Terrace field: 16 sector slabs with 8 mm movement joints, floating 5 mm
  // above the paved slab (colliders carry the walker; the enclosed underside
  // is invisible). Joints land BETWEEN pedestals (pedestals sit on bay
  // centres), so no pedestal straddles a joint.
  const JOINT = 0.008
  const rIn = 2.6
  // 8 mm movement joint to the step ring's inner face at r 10.54.
  const rOut = 10.532
  for (let i = 0; i < 16; i++) {
    const a0 = DOOR_A + Math.PI / LEGS + ((i - 0.5) / 16) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / 16
    const g0 = a0 + JOINT / rOut
    const g1 = a1 - JOINT / rOut
    const arc: Vec2[] = []
    const n = 14
    for (let k = 0; k <= n; k++) {
      const a = g0 + ((g1 - g0) * k) / n
      arc.push([Math.cos(a) * rOut, Math.sin(a) * rOut])
    }
    for (let k = 0; k <= n; k++) {
      const a = g1 - ((g1 - g0) * k) / n
      arc.push([Math.cos(a) * rIn, Math.sin(a) * rIn])
    }
    const slab = prism(arc, 0.08, Z_TERR)
    smoothShade(slab, SMOOTH.cast)
    slotPush(build, 'cast', slab)
  }

  // Shaft medallion: the casting between the field sectors and the pit — a
  // CLOSED loft following the stadium outline, carrying the screen curb with
  // its glazing rebate. Across the portal arc the curb DIPS flush (the
  // plinth's portalDip idiom) so the doorway needs no hop and the threshold
  // plate floats over a flat band.
  const SEG2 = 160
  const rings: Vec3[][] = []
  for (let i = 0; i < SEG2; i++) {
    const b = (i / SEG2) * Math.PI * 2
    const [px, py] = pw(Math.cos(b), Math.sin(b))
    const rMed = 2.592
    // Portal band: measured about the cab centre, eased over 0.1 rad.
    const s = Math.cos(b) * stadiumRadius(b, 0) - CAB_S
    const t = Math.sin(b) * stadiumRadius(b, 0)
    const portalArc = Math.abs(Math.atan2(t, Math.max(0.001, s)))
    const dip =
      s > 0 ? 1 - smooth01(Math.min(1, Math.max(0, (portalArc - PORTAL_HALF_ARC - 0.02) / 0.1))) : 0
    const curbTop = Z_TERR + 0.04 - 0.036 * dip
    const rebateZ = Z_TERR + 0.016 - 0.012 * dip
    const rGlass = stadiumRadius(b, 0)
    const at = (grow: number, z: number): Vec3 => [
      px * (rGlass + grow),
      py * (rGlass + grow),
      z,
    ]
    rings.push([
      [px * rMed, py * rMed, 0.08],
      [px * rMed, py * rMed, Z_TERR],
      at(0.115, Z_TERR),
      at(0.115, curbTop), // outer lip
      at(0.0405, curbTop),
      at(0.0405, rebateZ), // glazing groove straddles the glass line
      at(-0.045, rebateZ),
      at(-0.045, curbTop - 0.008), // inner lip, its own plane
      at(-0.058, curbTop - 0.008),
      at(-0.058, Z_PIT), // pit wall
      at(-0.058, Z_PIT - 0.12),
      [px * rMed, py * rMed, 0.02],
    ])
  }
  const medallion = loft(rings, { closeU: true, closeV: true })
  smoothShade(medallion, SMOOTH.cast)
  slotPush(build, 'cast', medallion)

  // Pit floor: a plate on the stadium plan with a 12 mm perimeter shadow
  // groove to the medallion's inner wall (grow −0.058), its body welded
  // into the medallion's underground closure so nothing floats.
  const pitOutline = stadiumOutline(-0.07, 128)
  const pit = prism(pitOutline, Z_PIT - 0.15, Z_PIT - 0.004)
  smoothShade(pit, SMOOTH.cast)
  slotPush(build, 'cast', pit)
}

/** Interpolation ease shared by the curb dips. */
function smooth01(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * A closed section revolved about the tower axis as a torus-like solid —
 * tubeAlong on a circle path, so the profile reads (radial, vertical)
 * offsets about the path and the result is a CLOSED component whose
 * orientation is decided by signed volume.
 */
function ringSolid(sectionRZ: Vec2[], segments: number, smooth: number): MeshData {
  let rSum = 0
  let zSum = 0
  for (const [r, z] of sectionRZ) {
    rSum += r
    zSum += z
  }
  const r0 = rSum / sectionRZ.length
  const z0 = zSum / sectionRZ.length
  const path: Vec3[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    path.push([Math.cos(a) * r0, Math.sin(a) * r0, z0])
  }
  const md = tubeAlong(
    path,
    sectionRZ.map(([r, z]) => [r - r0, z - z0] as Vec2),
    { closePath: true, cap: false },
  )
  smoothShade(md, smooth)
  return md
}

/**
 * Sixteen cast pedestals, each carrying the paired lattice shoes (one leg of
 * each family springs from every pedestal). Cast never touches steel: the
 * shoe flange floats 3 mm inside a rebate whose lip hides the joint.
 */
function buildPedestals(build: Build): void {
  const FLANGE_TOP = Z_TERR + 0.541
  for (let i = 0; i < LEGS; i++) {
    const mid = DOOR_A + Math.PI / LEGS + (i / LEGS) * Math.PI * 2
    const cx = Math.cos(mid) * R_LEG_BASE
    const cy = Math.sin(mid) * R_LEG_BASE
    // Battered octagonal block, long axis tangential, bedded 6 mm into the
    // terrace field (same slot — the bury welds).
    const base = chamferRect(1.42, 0.96, 0.16)
    const top = chamferRect(1.24, 0.82, 0.14)
    const ring = (poly: Vec2[], z: number): Vec3[] => poly.map(([x, y]) => [x, y, z] as Vec3)
    const block = loft(
      [
        ring(base, Z_TERR - 0.006),
        ring(base, Z_TERR + 0.09),
        ring(
          top.map(([x, y]) => [x * 1.02, y * 1.02] as Vec2),
          Z_TERR + 0.4,
        ),
        ring(top, Z_TERR + 0.505),
      ],
      { closeV: true, capStart: true, capEnd: true },
    )
    smoothShade(block, SMOOTH.cast)
    // Raised curb ring on top: its bore hides the shoe flange's edge and the
    // 3 mm float under it (the cup idiom — cast never touches steel). Built
    // as ONE closed section swept round a rounded-rect midline — a capped
    // stacked-ring loft here would ship end-cap DISCS coplanar with the
    // block top (the notes.md solid-disc trap; the first pass did exactly
    // that and audited as 25 z-fight pairs).
    const curbPath3: Vec3[] = roundedRect(1.06, 0.68, 0.085, 4).map(
      ([x, y]) => [x, y, 0] as Vec3,
    )
    const curbSection: Vec2[] = [
      [-0.055, Z_TERR + 0.493], // bore face foot (buried 12 mm into the block)
      [0.055, Z_TERR + 0.493], // outer face foot
      [0.055, Z_TERR + 0.568],
      [0.028, Z_TERR + 0.592], // chamfered crown
      [-0.028, Z_TERR + 0.592],
      [-0.055, Z_TERR + 0.532], // bore splay
    ]
    const curb = tubeAlong(
      curbPath3,
      curbSection.map(([a, z]) => [a, z] as Vec2),
      { closePath: true, cap: false },
    )
    smoothShade(curb, SMOOTH.cast)
    for (const md of [block, curb]) {
      rotateZ(md, mid + Math.PI / 2, [0, 0])
      translate(md, [cx, cy, 0])
      slotPush(build, 'cast', md)
    }

    // Steel shoe weldment: flange plate floating 3 mm inside the curb bore,
    // two raked socket tubes swallowing the leg roots, a radial shear fin,
    // and four dome-head anchor bolts. One 'steel' part — every contact
    // inside it is a weld.
    const shoe: MeshData[] = []
    const flange = roundedBox([-0.46, -0.265, Z_TERR + 0.535, 0.46, 0.265, FLANGE_TOP], 0.02, 2)
    rotateZ(flange, mid + Math.PI / 2, [0, 0])
    translate(flange, [cx, cy, 0])
    shoe.push(flange)
    for (const f of [1, -1]) {
      const dirU = legDirection(f, i)
      const root = legPoint(f, i, 0) // z = Z_LEG_BASE
      const drop = (Z_LEG_BASE - (FLANGE_TOP - 0.006)) / dirU[2]
      const start: Vec3 = [root[0] - dirU[0] * drop, root[1] - dirU[1] * drop, FLANGE_TOP - 0.006]
      const reach = 0.78
      const socket = tubeAlong(
        [start, [start[0] + dirU[0] * reach, start[1] + dirU[1] * reach, start[2] + dirU[2] * reach]],
        circle(LEG_R0 + 0.042, 20),
        { cap: true },
      )
      smoothShade(socket, SMOOTH.turned)
      shoe.push(socket)
      // Collar bead at the socket mouth — the machined seat the leg enters.
      const mouth = tubeAlong(
        [
          [
            start[0] + dirU[0] * (reach - 0.05),
            start[1] + dirU[1] * (reach - 0.05),
            start[2] + dirU[2] * (reach - 0.05),
          ],
          [
            start[0] + dirU[0] * (reach + 0.028),
            start[1] + dirU[1] * (reach + 0.028),
            start[2] + dirU[2] * (reach + 0.028),
          ],
        ],
        circle(LEG_R0 + 0.058, 20),
        { cap: true },
      )
      smoothShade(mouth, SMOOTH.turned)
      shoe.push(mouth)
    }
    const boltAt: Vec2[] = [
      [0.39, 0.21],
      [-0.39, 0.21],
      [0.39, -0.21],
      [-0.39, -0.21],
    ]
    for (const [bx, by] of boltAt) {
      const bolt = revolve(
        [
          [0, 0],
          [0.03, 0],
          [0.03, 0.016],
          [0.017, 0.03],
          [0, 0.034],
        ],
        14,
        { smooth: SMOOTH.tight },
      )
      const p = pwRot(mid + Math.PI / 2, bx, by)
      translate(bolt, [cx + p[0], cy + p[1], FLANGE_TOP - 0.0015])
      shoe.push(bolt)
    }
    slotPush(build, 'steel', cleanMesh(join(shoe)))
  }
}

/** Rotate a local (a, b) offset by yaw angle into plan coordinates. */
function pwRot(yaw: number, a: number, b: number): Vec2 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [a * c - b * s, a * s + b * c]
}

/**
 * The hyperboloid lattice itself: 32 straight tapered tubes, eight ring
 * stiffeners buried through them, a bolted clamp cleat at every true
 * leg-leg crossing and a saddle plate wherever a ring passes a leg. All one
 * slot ('steel'), so every genuine intersection is a weld and every plate
 * bites its host instead of grazing it.
 */
function buildLattice(build: Build): void {
  const legs: MeshData[] = []
  for (const f of [1, -1]) {
    for (let i = 0; i < LEGS; i++) {
      const p0 = legPoint(f, i, 0.012)
      const p1 = legPoint(f, i, 1)
      const md = tubeAlong([p0, p1], circle(LEG_R0, 22), {
        cap: true,
        scale: [
          [1, 1],
          [LEG_R1 / LEG_R0, LEG_R1 / LEG_R0],
        ],
      })
      smoothShade(md, SMOOTH.turned)
      legs.push(md)
    }
  }
  slotPush(build, 'steel', cleanMesh(join(legs)))

  // Ring stiffeners.
  const rings: MeshData[] = []
  for (const z of RING_Z) {
    const k = (z - Z_LEG_BASE) / (Z_LEG_TOP - Z_LEG_BASE)
    const r = latticeRadius(k)
    const path: Vec3[] = []
    const seg = 112
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2
      path.push([Math.cos(a) * r, Math.sin(a) * r, z])
    }
    rings.push(tubeAlong(path, circle(RING_R, 12), { closePath: true, cap: false }))
  }
  for (const md of rings) smoothShade(md, SMOOTH.turned)
  slotPush(build, 'steel', cleanMesh(join(rings)))

  // Leg-leg crossings: solve every A×B pair as a segment-segment closest
  // approach; a true crossing gets the clamp cleat (outer + inner plate,
  // four dome bolts). ~112 of them — the rivet-line of the whole tower.
  const cleats: MeshData[] = []
  for (let i = 0; i < LEGS; i++) {
    for (let j = 0; j < LEGS; j++) {
      const hit = crossing(i, j)
      if (!hit) continue
      const [px, py, pz, k] = hit
      const theta = Math.atan2(py, px)
      const rl = legRadius(k)
      const bis = crossingBisector(i, j)
      cleats.push(cleatAt([px, py, pz], theta, bis, rl, 0.42, 0.3, true))
    }
  }
  slotPush(build, 'steel', cleanMesh(join(cleats)))

  // Ring saddles: one outer plate + two bolts where each ring passes a leg.
  const saddles: MeshData[] = []
  for (const z of RING_Z) {
    const k = (z - Z_LEG_BASE) / (Z_LEG_TOP - Z_LEG_BASE)
    for (const f of [1, -1]) {
      for (let i = 0; i < LEGS; i++) {
        const p = legPoint(f, i, k)
        const theta = Math.atan2(p[1], p[0])
        const d = legDirection(f, i)
        saddles.push(cleatAt(p, theta, d, legRadius(k), 0.28, 0.2, false))
      }
    }
  }
  slotPush(build, 'steel', cleanMesh(join(saddles)))

  // Head fittings: every leg dies into a socket + flange under the deck's
  // ring girder (flange buries 6 mm up into the girder — same slot).
  const heads: MeshData[] = []
  for (const f of [1, -1]) {
    for (let i = 0; i < LEGS; i++) {
      const tip = legPoint(f, i, 1)
      const back = legPoint(f, i, 0.972)
      const dir = norm3([tip[0] - back[0], tip[1] - back[1], tip[2] - back[2]])
      const socket = tubeAlong(
        [
          [tip[0] - dir[0] * 0.52, tip[1] - dir[1] * 0.52, tip[2] - dir[2] * 0.52],
          [tip[0] + dir[0] * 0.1, tip[1] + dir[1] * 0.1, tip[2] + dir[2] * 0.1],
        ],
        circle(LEG_R1 + 0.04, 18),
        { cap: true },
      )
      smoothShade(socket, SMOOTH.turned)
      heads.push(socket)
      const theta = Math.atan2(tip[1], tip[0])
      const plate = roundedBox([-0.17, -0.13, 0, 0.17, 0.13, 0.03], BEVEL.hardware, 2)
      rotateZ(plate, theta, [0, 0])
      translate(plate, [tip[0], tip[1], Z_LEG_TOP + 0.09])
      heads.push(plate)
    }
  }
  slotPush(build, 'steel', cleanMesh(join(heads)))
}

function legDirection(f: number, i: number): Vec3 {
  const a = legPoint(f, i, 0)
  const b = legPoint(f, i, 1)
  return norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Closest-approach crossing of A-leg i and B-leg j, or null. */
function crossing(i: number, j: number): [number, number, number, number] | null {
  const a0 = legPoint(1, i, 0)
  const a1 = legPoint(1, i, 1)
  const b0 = legPoint(-1, j, 0)
  const b1 = legPoint(-1, j, 1)
  const u: Vec3 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]]
  const v: Vec3 = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]]
  const w: Vec3 = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]]
  const aa = dot3(u, u)
  const bb = dot3(u, v)
  const cc = dot3(v, v)
  const dd = dot3(u, w)
  const ee = dot3(v, w)
  const den = aa * cc - bb * bb
  if (Math.abs(den) < 1e-9) return null
  const s = (bb * ee - cc * dd) / den
  const t = (aa * ee - bb * dd) / den
  if (s < 0.05 || s > 0.95 || t < 0.05 || t > 0.95) return null
  const pa: Vec3 = [a0[0] + u[0] * s, a0[1] + u[1] * s, a0[2] + u[2] * s]
  const pb: Vec3 = [b0[0] + v[0] * t, b0[1] + v[1] * t, b0[2] + v[2] * t]
  const gap = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
  if (gap > legRadius(s) * 0.9) return null
  return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2, (s + t) / 2]
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function crossingBisector(i: number, j: number): Vec3 {
  const da = legDirection(1, i)
  const db = legDirection(-1, j)
  return norm3([da[0] + db[0], da[1] + db[1], da[2] + db[2]])
}

/**
 * A bolted clamp cleat at a lattice joint: plate(s) whose inner face bites
 * the tube crowns, long axis along `axis`, face normal radial-horizontal at
 * plan angle `theta`. `both` adds the inner plate (leg-leg clamps are
 * two-sided; ring saddles are outer-only).
 */
function cleatAt(
  p: Vec3,
  theta: number,
  axis: Vec3,
  tubeR: number,
  length: number,
  width: number,
  both: boolean,
): MeshData {
  const parts: MeshData[] = []
  const n: Vec3 = [Math.cos(theta), Math.sin(theta), 0]
  const sides = both ? [1, -1] : [1]
  for (const side of sides) {
    const plate = roundedBox(
      [-width / 2, -length / 2, 0, width / 2, length / 2, 0.024],
      0.012,
      2,
    )
    // Orient: plate local +Z → n·side, local +Y → axis projected ⊥ n.
    const az = norm3([
      axis[0] - n[0] * dot3(axis, n),
      axis[1] - n[1] * dot3(axis, n),
      axis[2] - n[2] * dot3(axis, n),
    ])
    const ax = cross3(az, [n[0] * side, n[1] * side, n[2] * side])
    orient(plate, ax, az, [n[0] * side, n[1] * side, n[2] * side])
    translate(plate, [
      p[0] + n[0] * side * (tubeR - 0.016),
      p[1] + n[1] * side * (tubeR - 0.016),
      p[2],
    ])
    parts.push(plate)
    if (side === 1) {
      for (const [bx, by] of [
        [width * 0.3, length * 0.33],
        [-width * 0.3, length * 0.33],
        [width * 0.3, -length * 0.33],
        [-width * 0.3, -length * 0.33],
      ] as Vec2[]) {
        const bolt = revolve(
          [
            [0, 0],
            [0.021, 0],
            [0.021, 0.012],
            [0.012, 0.023],
            [0, 0.026],
          ],
          12,
          { smooth: SMOOTH.tight },
        )
        orient(bolt, ax, az, n)
        translate(bolt, [
          p[0] + n[0] * (tubeR + 0.006) + ax[0] * bx + az[0] * by,
          p[1] + n[1] * (tubeR + 0.006) + ax[1] * bx + az[1] * by,
          p[2] + ax[2] * bx + az[2] * by,
        ])
        parts.push(bolt)
      }
    }
  }
  return cleanMesh(join(parts))
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Map a part authored in local (x → ax, y → ay, z → az) onto world axes. */
function orient(m: MeshData, ax: Vec3, ay: Vec3, az: Vec3): MeshData {
  for (const v of m.verts) {
    const [x, y, z] = v
    v[0] = ax[0] * x + ay[0] * y + az[0] * z
    v[1] = ax[1] * x + ay[1] * y + az[1] * z
    v[2] = ax[2] * x + ay[2] * y + az[2] * z
  }
  m.provenance = null
  return m
}

/**
 * The service mast: four chord tubes on a 1.46 m square, K-braced faces,
 * the elevator guide rails and counterweight rails on clamp collars, the
 * caged ladder with two rest platforms, and the machine platform + crown
 * post that carry the sheaves and the spire.
 */
function buildCore(build: Build): void {
  const chordXY: Vec2[] = [
    pw(CORE_S - CORE_HALF, -CORE_HALF),
    pw(CORE_S - CORE_HALF, CORE_HALF),
    pw(CORE_S + CORE_HALF, CORE_HALF),
    pw(CORE_S + CORE_HALF, -CORE_HALF),
  ]
  const Z0 = 0.58
  const Z1 = CROWN(3.78)
  const steel: MeshData[] = []
  const dark: MeshData[] = []

  // Cast plinth blocks in the pit carry the chords (steel floats in rebates).
  for (const [x, y] of chordXY) {
    const plinth = revolve(
      [
        [0, 0],
        [0.21, 0],
        [0.21, 0.2],
        [0.17, 0.23],
        [0.128, 0.23],
        [0.128, 0.209],
        [0.126, 0.209],
        [0, 0.209],
      ],
      24,
      { smooth: SMOOTH.cast },
    )
    translate(plinth, [x, y, Z_PIT - 0.004])
    slotPush(build, 'cast', plinth)
    const shoe = revolve(
      [
        [0, 0],
        [0.122, 0],
        [0.122, 0.024],
        [0.1, 0.05],
        [0.1, 0.12],
        [0, 0.12],
      ],
      20,
      { smooth: SMOOTH.turned },
    )
    translate(shoe, [x, y, Z_PIT + 0.208])
    steel.push(shoe)
    steel.push(
      smoothShade(
        tubeAlong(
          [
            [x, y, Z_PIT + 0.3],
            [x, y, Z1],
          ],
          circle(0.082, 16),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }

  // K-bracing: two rods per face panel rising to the panel-line midpoint,
  // plus a horizontal rung at every panel line. Rod ends bury in the chords
  // (same slot — welds), the honest look of a fabricated mast.
  const panels = 12
  for (let face = 0; face < 4; face++) {
    const a = chordXY[face]
    const b = chordXY[(face + 1) % 4]
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    for (let p = 0; p < panels; p++) {
      const z0 = Z0 + 0.42 + ((Z1 - Z0 - 0.84) * p) / panels
      const z1 = Z0 + 0.42 + ((Z1 - Z0 - 0.84) * (p + 1)) / panels
      for (const foot of [a, b]) {
        const rod = tubeAlong(
          [
            [foot[0], foot[1], z0],
            [mx, my, z1],
          ],
          circle(0.03, 10),
          { cap: true },
        )
        steel.push(smoothShade(rod, SMOOTH.turned))
      }
      const rung = tubeAlong(
        [
          [a[0], a[1], z1],
          [b[0], b[1], z1],
        ],
        circle(0.034, 10),
        { cap: true },
      )
      steel.push(smoothShade(rung, SMOOTH.turned))
    }
  }

  // Elevator guide rails: machined T-rails facing the cab, on clamp-collar
  // brackets every ~2.2 m (collar wraps the chord with clear air — dark
  // never touches steel).
  const railS = CORE_S + CORE_HALF + 0.09
  const railTop = CROWN(3.4)
  for (const side of [1, -1]) {
    const [rx, ry] = pw(railS, side * 0.62)
    const blade = prism(
      roundedRect(0.05, 0.062, 0.008, 2),
      0.44,
      railTop,
    )
    // Author: rounded rect in XY, extrude z — reorient plan to door frame.
    rotateZ(blade, DOOR_A, [0, 0])
    translate(blade, [rx, ry, 0])
    smoothShade(blade, SMOOTH.moulded)
    dark.push(blade)
    const [cxc, cyc] = pw(CORE_S + CORE_HALF, side * CORE_HALF)
    for (let z = 1.0; z < railTop - 0.4; z += 2.2) {
      const collar = revolve(
        [
          [0.092, -0.05],
          [0.118, -0.05],
          [0.118, 0.05],
          [0.092, 0.05],
        ],
        16,
        { smooth: SMOOTH.turned, capStart: false, capEnd: false },
      )
      translate(collar, [cxc, cyc, z])
      dark.push(collar)
      const arm = tubeAlong(
        [
          [cxc, cyc, z],
          [rx, ry, z],
        ],
        roundedRect(0.05, 0.026, 0.006, 1),
        { cap: true },
      )
      smoothShade(arm, SMOOTH.moulded)
      dark.push(arm)
    }
  }

  // Counterweight rails: smaller pair on the far face.
  const cwtS = CORE_S - CORE_HALF - 0.09
  for (const side of [1, -1]) {
    const [rx, ry] = pw(cwtS, side * 0.3)
    const blade = prism(roundedRect(0.04, 0.05, 0.007, 2), 0.44, railTop)
    rotateZ(blade, DOOR_A, [0, 0])
    translate(blade, [rx, ry, 0])
    smoothShade(blade, SMOOTH.moulded)
    dark.push(blade)
    const [cxc, cyc] = pw(CORE_S - CORE_HALF, side * CORE_HALF)
    for (let z = 1.6; z < railTop - 0.4; z += 2.2) {
      const arm = tubeAlong(
        [
          [cxc, cyc, z],
          [rx, ry, z],
        ],
        roundedRect(0.044, 0.022, 0.005, 1),
        { cap: true },
      )
      smoothShade(arm, SMOOTH.moulded)
      dark.push(arm)
      const collar = revolve(
        [
          [0.092, -0.045],
          [0.115, -0.045],
          [0.115, 0.045],
          [0.092, 0.045],
        ],
        16,
        { smooth: SMOOTH.turned, capStart: false, capEnd: false },
      )
      translate(collar, [cxc, cyc, z])
      dark.push(collar)
    }
  }

  // Caged maintenance ladder on the north flank, with two rest gratings.
  const ladderT = 0.56
  const [ls0x, ls0y] = pw(CORE_S - 0.28, ladderT)
  const [ls1x, ls1y] = pw(CORE_S + 0.28, ladderT)
  for (const [sx, sy] of [
    [ls0x, ls0y],
    [ls1x, ls1y],
  ]) {
    dark.push(
      smoothShade(
        tubeAlong(
          [
            [sx, sy, 0.62],
            [sx, sy, CROWN(3.72)],
          ],
          circle(0.021, 8),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (let z = 0.9; z < CROWN(3.65); z += 0.29) {
    dark.push(
      smoothShade(
        tubeAlong(
          [
            [ls0x, ls0y, z],
            [ls1x, ls1y, z],
          ],
          circle(0.013, 8),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (const z of [13.2, 25.8]) {
    const grate = roundedBox([-0.6, -0.02, 0, 0.6, 0.44, 0.045], BEVEL.panel, 2)
    rotateZ(grate, DOOR_A - Math.PI / 2, [0, 0])
    const [gx, gy] = pw(CORE_S, ladderT - 0.24)
    translate(grate, [gx, gy, z])
    dark.push(grate)
  }

  // Machine platform: frame beams burying into the chord tops, deck plate,
  // machine housing, brake drum and the static crossover rope. The two
  // sheave WHEELS are dynamic (they spin) and live in the elevator system.
  const beamZ0 = CROWN(3.7)
  for (const t of [-CORE_HALF, CORE_HALF, -0.16, 0.16]) {
    const [b0x, b0y] = pw(CORE_S - 1.05, t)
    const [b1x, b1y] = pw(CAB_S + 0.44, t)
    const beam = tubeAlong(
      [
        [b0x, b0y, beamZ0 + 0.12],
        [b1x, b1y, beamZ0 + 0.12],
      ],
      roundedRect(0.24, 0.16, 0.012, 2),
      { cap: true },
    )
    smoothShade(beam, SMOOTH.moulded)
    steel.push(beam)
  }
  const deckPlan: Vec2[] = [
    pw(CORE_S - 1.08, -0.78),
    pw(CAB_S + 0.47, -0.78),
    pw(CAB_S + 0.47, 0.78),
    pw(CORE_S - 1.08, 0.78),
  ]
  const mdeck = prism(deckPlan, beamZ0 + 0.204, beamZ0 + 0.238)
  smoothShade(mdeck, SMOOTH.moulded)
  steel.push(mdeck)
  // Housing: chamfered drive casing over the machine deck, with a shouldered
  // crown, five cooling ribs and the brake drum boss on the shaft end.
  const houseRing = (poly: Vec2[], z: number): Vec3[] =>
    poly.map(([x, y]) => {
      const p = pwRot(DOOR_A, x + 0.55, y)
      return [p[0], p[1], z] as Vec3
    })
  const house = loft(
    [
      houseRing(chamferRect(1.06, 0.92, 0.1), beamZ0 + 0.232),
      houseRing(chamferRect(1.06, 0.92, 0.1), beamZ0 + 0.82),
      houseRing(chamferRect(0.86, 0.74, 0.09), beamZ0 + 0.98),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(house, SMOOTH.moulded)
  steel.push(house)
  for (let i = 0; i < 5; i++) {
    const rib = roundedBox([-0.02, -0.34, 0, 0.02, 0.34, 0.46], BEVEL.hardware, 1)
    rotateZ(rib, DOOR_A, [0, 0])
    const [rx2, ry2] = pw(0.25 + i * 0.15, 0)
    translate(rib, [rx2, ry2, beamZ0 + 0.31])
    steel.push(rib)
  }
  // Brake drum boss facing the sheave bay (the dynamic sheave itself lives
  // in the elevator system and spins on this axis).
  const drum = revolve(
    [
      [0, 0],
      [0.15, 0],
      [0.17, 0.03],
      [0.17, 0.12],
      [0.06, 0.15],
      [0, 0.15],
    ],
    24,
    { axis: 'x', smooth: SMOOTH.turned },
  )
  rotateZ(drum, DOOR_A + Math.PI / 2, [0, 0])
  const [dx2, dy2] = pw(1.35, 0)
  translate(drum, [dx2, dy2, beamZ0 + 0.62])
  steel.push(drum)

  slotPush(build, 'steel', cleanMesh(join(steel)))
  for (const md of dark) slotPush(build, 'dark', md)

  // Crown post: the spire's bearing, an octagonal taper off the platform.
  const crownPost = loft(
    [
      circle(0.3, 8, 0, 0, Math.PI / 8).map(([x, y]) => [x, y, beamZ0 + 0.24] as Vec3),
      circle(0.26, 8, 0, 0, Math.PI / 8).map(([x, y]) => [x, y, CROWN(5.2)] as Vec3),
      circle(0.22, 8, 0, 0, Math.PI / 8).map(([x, y]) => [x, y, Z_SPIRE_BASE + 0.06] as Vec3),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(crownPost, SMOOTH.moulded)
  slotPush(build, 'steel', crownPost)
}

/**
 * The gallery deck: ring girder on the leg heads, sixteen tapered radial
 * girders, the stadium-holed floor plate, fascia with splice plates and
 * bolts, the aperture curb with its screen rebate, and the recessed floor
 * lights. Everything structural is 'steel' and buries where it bears.
 */
function buildDeck(build: Build): void {
  const steel: MeshData[] = []
  // Ring girder: closed box section swept on the r 4.42 circle.
  const seg = 128
  const path: Vec3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    path.push([Math.cos(a) * R_RING_GIRDER, Math.sin(a) * R_RING_GIRDER, Z_DECK - 0.475])
  }
  const girder = tubeAlong(path, roundedRect(0.34, 0.62, 0.02, 2), {
    closePath: true,
    cap: false,
  })
  smoothShade(girder, SMOOTH.moulded)
  steel.push(girder)

  // Sixteen radial floor girders: tapered box blades from the ring girder
  // out to the fascia and inward to the aperture ring, tops buried 10 mm
  // into the plate (same slot). Each blade is a 2-station loft whose ring is
  // the blade's own closed rectangle, so the solid is watertight.
  for (let i = 0; i < 16; i++) {
    const a = DOOR_A + Math.PI / LEGS + (i / 16) * Math.PI * 2
    const dir: Vec2 = [Math.cos(a), Math.sin(a)]
    const side: Vec2 = [-Math.sin(a), Math.cos(a)]
    const web = (r0: number, r1: number, d0: number, d1: number): MeshData => {
      const rect = (r: number, depth: number): Vec3[] => {
        const top = Z_DECK - 0.15
        const w = 0.04
        return [
          [dir[0] * r + side[0] * w, dir[1] * r + side[1] * w, top],
          [dir[0] * r - side[0] * w, dir[1] * r - side[1] * w, top],
          [dir[0] * r - side[0] * w, dir[1] * r - side[1] * w, top - depth],
          [dir[0] * r + side[0] * w, dir[1] * r + side[1] * w, top - depth],
        ]
      }
      const blade = loft([rect(r0, d0), rect(r1, d1)], {
        closeV: true,
        capStart: true,
        capEnd: true,
      })
      smoothShade(blade, SMOOTH.moulded)
      return blade
    }
    const rIn = Math.min(stadiumRadius(a - DOOR_A, 0.06) + 0.06, 3.9)
    steel.push(web(R_RING_GIRDER + 0.19, R_DECK - 0.06, 0.36, 0.2))
    steel.push(web(rIn, R_RING_GIRDER - 0.19, 0.2, 0.36))
  }

  // Floor plate: outer circle → stadium aperture, one closed solid (top,
  // bottom, aperture fascia, edge face). Star-shaped about the axis, so a
  // per-angle radial loft is watertight by construction.
  const segF = 160
  const plateRings: Vec3[][] = []
  for (let i = 0; i < segF; i++) {
    const b = (i / segF) * Math.PI * 2
    const a = b + DOOR_A
    const dir: Vec2 = [Math.cos(a), Math.sin(a)]
    const rIn = stadiumRadius(b, 0.06)
    plateRings.push([
      [dir[0] * rIn, dir[1] * rIn, Z_DECK - DECK_PLATE],
      [dir[0] * rIn, dir[1] * rIn, Z_DECK],
      [dir[0] * R_DECK, dir[1] * R_DECK, Z_DECK],
      [dir[0] * R_DECK, dir[1] * R_DECK, Z_DECK - DECK_PLATE],
    ])
  }
  const plate = loft(plateRings, { closeU: true, closeV: true })
  smoothShade(plate, SMOOTH.moulded)
  steel.push(plate)

  // Fascia ring: a deeper edge band proud of the plate edge, with a drip
  // kerf, splice plates and bolt rows — the detail line seen from below.
  const fasciaPath: Vec3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    fasciaPath.push([Math.cos(a) * (R_DECK + 0.008), Math.sin(a) * (R_DECK + 0.008), Z_DECK - 0.148])
  }
  const fascia = tubeAlong(
    fasciaPath,
    [
      [-0.012, -0.15],
      [0.022, -0.15],
      [0.022, -0.045],
      [0.014, -0.038], // drip kerf
      [0.022, -0.031],
      [0.022, 0.11],
      [-0.012, 0.11],
    ],
    { closePath: true, cap: false },
  )
  smoothShade(fascia, SMOOTH.moulded)
  steel.push(fascia)
  for (let i = 0; i < 16; i++) {
    const a = DOOR_A + ((i + 0.5) / 16) * Math.PI * 2
    const plate2 = roundedBox([-0.11, -0.006, -0.17, 0.11, 0.018, 0.17], BEVEL.hardware, 2)
    rotateZ(plate2, a - Math.PI / 2, [0, 0])
    translate(plate2, [Math.cos(a) * (R_DECK + 0.028), Math.sin(a) * (R_DECK + 0.028), Z_DECK - 0.185])
    steel.push(plate2)
    for (const [dx, dz] of [
      [-0.11, -0.055],
      [0, -0.055],
      [0.11, -0.055],
      [-0.11, 0.055],
      [0, 0.055],
      [0.11, 0.055],
    ] as Vec2[]) {
      const bolt = revolve(
        [
          [0, 0],
          [0.016, 0],
          [0.016, 0.009],
          [0.009, 0.018],
          [0, 0.02],
        ],
        10,
        { smooth: SMOOTH.tight },
      )
      // Bolt axis is radial: author +Z, orient to the outward normal.
      orient(bolt, [Math.sin(a), -Math.cos(a), 0], [0, 0, 1], [Math.cos(a), Math.sin(a), 0])
      translate(bolt, [
        Math.cos(a) * (R_DECK + 0.044) + Math.sin(a) * dx,
        Math.sin(a) * (R_DECK + 0.044) - Math.cos(a) * dx,
        Z_DECK - 0.185 + dz,
      ])
      steel.push(bolt)
    }
  }

  // Aperture curb: steel upstand around the shaft with the same glazing
  // rebate the ground curb carries (the screens drop in and float), dipped
  // flush across the portal arc, closed back into the plate underside.
  const segC = 160
  const curbRings: Vec3[][] = []
  for (let i = 0; i < segC; i++) {
    const b = (i / segC) * Math.PI * 2
    const a = b + DOOR_A
    const dir: Vec2 = [Math.cos(a), Math.sin(a)]
    const rGlass = stadiumRadius(b, 0)
    const s = Math.cos(b) * rGlass - CAB_S
    const t = Math.sin(b) * rGlass
    const portalArc = Math.abs(Math.atan2(t, Math.max(0.001, s)))
    const dip =
      s > 0 ? 1 - smooth01(Math.min(1, Math.max(0, (portalArc - PORTAL_HALF_ARC - 0.02) / 0.1))) : 0
    const curbTop = Z_DECK + 0.04 - 0.036 * dip
    const rebateZ = Z_DECK + 0.016 - 0.012 * dip
    const at = (grow: number, z: number): Vec3 => [
      dir[0] * (rGlass + grow),
      dir[1] * (rGlass + grow),
      z,
    ]
    curbRings.push([
      at(0.115, Z_DECK + 0.002),
      at(0.115, curbTop), // outer lip
      at(0.0405, curbTop),
      at(0.0405, rebateZ), // glazing groove straddles the glass line
      at(-0.045, rebateZ),
      at(-0.045, curbTop - 0.008), // inner lip, its own plane
      at(-0.058, curbTop - 0.008),
      at(-0.058, Z_DECK - 0.05), // shaft fascia return
      at(0.115, Z_DECK - 0.05),
    ])
  }
  const curb = loft(curbRings, { closeU: true, closeV: true })
  smoothShade(curb, SMOOTH.moulded)
  steel.push(curb)

  slotPush(build, 'steel', cleanMesh(join(steel)))

  // Recessed floor lights: bezel ring + lens, 16 around near the glass line.
  for (let i = 0; i < 16; i++) {
    const a = DOOR_A + ((i + 0.5) / 16) * Math.PI * 2
    const x = Math.cos(a) * 4.98
    const y = Math.sin(a) * 4.98
    const bezel = revolve(
      [
        [0.03, 0],
        [0.052, 0],
        [0.052, 0.008],
        [0.044, 0.012],
        [0.032, 0.012],
        [0.032, 0.004],
        [0.03, 0.004],
      ],
      20,
      { smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    translate(bezel, [x, y, Z_DECK - 0.002])
    slotPush(build, 'steel', bezel)
    const lens = revolve(
      [
        [0, 0],
        [0.028, 0],
        [0.028, 0.006],
        [0, 0.006],
      ],
      16,
      { smooth: SMOOTH.turned },
    )
    translate(lens, [x, y, Z_DECK + 0.001])
    slotPush(build, 'floorLens', lens)
  }
}

/**
 * The gallery wall: sixteen faceted bays, stick-built. Hierarchy: aluminum
 * mullions are CONTINUOUS (each standing in a steel shoe cup on the deck,
 * top dying 4 mm under the head ring's soffit); sill curbs, glazing
 * channels and panes are SEGMENTED per bay, channels burying into the
 * mullions (same slot = weld) and the alu channel floating 3 mm inside its
 * steel curb pocket (the cup idiom). The head ring, eave gutter, cove light
 * and the leaning rail close the composition.
 */
function buildWall(build: Build): void {
  const alu: MeshData[] = []
  const steel: MeshData[] = []
  const seg = 128
  const RM = R_DECK - 0.075 // mullion axis radius
  const RP = R_DECK - 0.06 // pane corner radius
  const bayA = (i: number): number => DOOR_A + Math.PI / LEGS + (i / 16) * Math.PI * 2

  // Head ring beam + eave gutter (steel, continuous circles).
  const headPath: Vec3[] = []
  const eavePath: Vec3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    headPath.push([Math.cos(a) * (R_DECK - 0.03), Math.sin(a) * (R_DECK - 0.03), CROWN(WALL_HEAD) + 0.1])
    // Eave gutter BEARS on the head ring: its underside buries 10 mm into
    // the ring's top face (same slot — a weld, never a floating hoop).
    eavePath.push([Math.cos(a) * (R_DECK + 0.02), Math.sin(a) * (R_DECK + 0.02), CROWN(2.997)])
  }
  const headRing = tubeAlong(headPath, roundedRect(0.22, 0.2, 0.014, 2), {
    closePath: true,
    cap: false,
  })
  smoothShade(headRing, SMOOTH.moulded)
  steel.push(headRing)
  const eave = tubeAlong(
    eavePath,
    [
      [-0.14, -0.03],
      [0.2, -0.03],
      [0.2, 0.045],
      [0.155, 0.045],
      [0.148, 0.02], // gutter throat
      [0.1, 0.02],
      [0.1, 0.075],
      [-0.14, 0.075],
    ],
    { closePath: true, cap: false },
  )
  smoothShade(eave, SMOOTH.moulded)
  steel.push(eave)

  // Cove light ring hidden behind an aluminum trim lip (commons pattern:
  // the source is recessed behind its own trim).
  const covePath: Vec3[] = []
  const trimPath: Vec3[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    covePath.push([Math.cos(a) * 5.17, Math.sin(a) * 5.17, CROWN(2.62)])
    trimPath.push([Math.cos(a) * 5.12, Math.sin(a) * 5.12, CROWN(2.55)])
  }
  const cove = tubeAlong(covePath, roundedRect(0.016, 0.05, 0.004, 1), {
    closePath: true,
    cap: false,
  })
  slotPush(build, 'interiorGlow', cove)
  const trim = tubeAlong(
    trimPath,
    [
      [-0.012, 0],
      [0.05, 0],
      [0.05, 0.014],
      [0.002, 0.014],
      [0.002, 0.1],
      [-0.012, 0.1],
    ],
    { closePath: true, cap: false },
  )
  smoothShade(trim, SMOOTH.moulded)
  alu.push(trim)

  // Per-bay chord frame: sill curb (steel), sill + head channels (alu),
  // pane (glass); mullion shoes at the joints.
  for (let i = 0; i < 16; i++) {
    const a0 = bayA(i)
    const a1 = bayA(i + 1)
    const p0: Vec2 = [Math.cos(a0) * RP, Math.sin(a0) * RP]
    const p1: Vec2 = [Math.cos(a1) * RP, Math.sin(a1) * RP]
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const dir: Vec2 = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len]
    const at = (u: number, out: number, z: number): Vec3 => {
      // u metres along the chord from p0, `out` metres toward the outside
      // (the chord's outward normal for a CCW circle is (dir.y, −dir.x)).
      return [p0[0] + dir[0] * u + dir[1] * out, p0[1] + dir[1] * u - dir[0] * out, z]
    }

    // Steel sill curb: pocketed section swept the full chord (ends weld
    // into the mullion shoes it passes through).
    // Base at −0.014: the mullion shoes bury deeper (−0.022), so the two
    // families' undersides never share a plane (the stack rule applies to
    // undersides too — notes.md, plaza-elevation finding).
    const curbSection: Vec2[] = [
      [-0.055, -0.014],
      [0.045, -0.014],
      [0.045, 0.058],
      [0.039, 0.058],
      [0.039, 0.038],
      [-0.039, 0.038],
      [-0.039, 0.058],
      [-0.055, 0.058],
    ]
    // The curb stops 10 mm short of each mullion shoe — a movement joint,
    // and it keeps the steel clear of the aluminum base plates.
    const curb = tubeAlong(
      [at(0.075, 0, Z_DECK), at(len - 0.075, 0, Z_DECK)],
      curbSection,
      { cap: true },
    )
    smoothShade(curb, SMOOTH.moulded)
    steel.push(curb)

    // Alu channels: sill U (opening up) and head U (opening down), ends
    // burying 10 mm into the mullion bodies.
    const u0 = 0.0155 // mullion half 0.0375 − 10 mm bury + RP/RM chord offset slack
    const sill = tubeAlong(
      [at(u0, 0, Z_DECK + 0.041), at(len - u0, 0, Z_DECK + 0.041)],
      [
        [-0.036, 0],
        [0.036, 0],
        [0.036, 0.075],
        [0.024, 0.075],
        [0.024, 0.018],
        [-0.024, 0.018],
        [-0.024, 0.075],
        [-0.036, 0.075],
      ],
      { cap: true },
    )
    smoothShade(sill, SMOOTH.moulded)
    alu.push(sill)
    const head = tubeAlong(
      [at(u0, 0, CROWN(2.755)), at(len - u0, 0, CROWN(2.755))],
      [
        [-0.036, 0],
        [-0.036, -0.075],
        [-0.024, -0.075],
        [-0.024, -0.018],
        [0.024, -0.018],
        [0.024, -0.075],
        [0.036, -0.075],
        [0.036, 0],
      ],
      { cap: true },
    )
    smoothShade(head, SMOOTH.moulded)
    alu.push(head)

    // The pane: one flat facet, tucked into channels and mullions.
    // Edges tuck 22 mm into the mullions; bottom rides 3 mm over the sill
    // groove floor; top stops 5 mm short of the head groove ceiling.
    const pane = MeshData.from(
      [
        at(0.012, 0, Z_DECK + 0.062),
        at(len - 0.012, 0, Z_DECK + 0.062),
        at(len - 0.012, 0, CROWN(2.732)),
        at(0.012, 0, CROWN(2.732)),
      ],
      [[0, 1, 2, 3]],
    )
    build.glass.push(pane)
  }

  // Mullions + shoes + leaning-rail posts at the 16 bay joints.
  for (let i = 0; i < 16; i++) {
    const a = bayA(i)
    const mx = Math.cos(a) * RM
    const my = Math.sin(a) * RM
    // Corner stack, every plane its own (undersides too): steel shoe block
    // buried into the deck plate (−0.022 … +0.034) → 3 mm shadow →
    // aluminum base plate (+0.037 … +0.049) → mullion rising out of it.
    // The bay glazing channels bury into the PLATE and the mullion (all
    // aluminum, welds); the steel below never touches them.
    const shoeBox = roundedBox([-0.065, -0.065, Z_DECK - 0.022, 0.065, 0.065, Z_DECK + 0.034], 0.012, 2)
    rotateZ(shoeBox, a, [0, 0])
    translate(shoeBox, [mx, my, 0])
    steel.push(shoeBox)
    const basePlate = roundedBox([-0.06, -0.06, Z_DECK + 0.037, 0.06, 0.06, Z_DECK + 0.049], 0.008, 2)
    rotateZ(basePlate, a, [0, 0])
    translate(basePlate, [mx, my, 0])
    alu.push(basePlate)

    // Aluminum mullion: box-with-nose section, rooted in its base plate.
    const mull = tubeAlong(
      [
        [0, 0, Z_DECK + 0.045],
        [0, 0, CROWN(2.776)],
      ],
      [
        [-0.0375, -0.065],
        [0.0375, -0.065],
        [0.0375, 0.052],
        [0.02, 0.065],
        [-0.02, 0.065],
        [-0.0375, 0.052],
      ],
      { cap: true },
    )
    // Vertical sweep: profile across → +y, depth → +x; aim depth outward.
    rotateZ(mull, a, [0, 0])
    translate(mull, [mx, my, 0])
    smoothShade(mull, SMOOTH.moulded)
    alu.push(mull)

    // Leaning-rail post with its saddle stub.
    const px = Math.cos(a) * 5.06
    const py = Math.sin(a) * 5.06
    const post = tubeAlong(
      [
        [px, py, Z_DECK],
        [px, py, Z_DECK + 0.94],
        [Math.cos(a) * 5.02, Math.sin(a) * 5.02, Z_DECK + 1.005],
      ],
      circle(0.024, 12),
      { cap: true },
    )
    smoothShade(post, SMOOTH.turned)
    steel.push(post)
  }
  // Rail segments bay-by-bay, 5 mm clear of each post surface (the shadow
  // gap is the joint — rails never thread their posts).
  for (let i = 0; i < 16; i++) {
    const a0 = bayA(i) + 0.0135
    const a1 = bayA(i + 1) - 0.0135
    const path: Vec3[] = []
    for (let k = 0; k <= 10; k++) {
      const a = a0 + ((a1 - a0) * k) / 10
      path.push([Math.cos(a) * 5.02, Math.sin(a) * 5.02, Z_DECK + 1.03])
    }
    const rail = tubeAlong(path, circle(0.026, 12), { cap: true })
    smoothShade(rail, SMOOTH.turned)
    slotPush(build, 'orangeTop', rail)
  }

  for (const md of alu) slotPush(build, 'aluminum', md)
  for (const md of steel) slotPush(build, 'steel', md)
}

/**
 * The glass tent roof: sixteen blade rafters on the faceted ROOF_RINGS
 * line, two purlin rings, the apex compression ring, flat trapezoid panes
 * (planar by symmetry), and the eave brackets that bolt each rafter foot.
 */
function buildRoof(build: Build): void {
  const steel: MeshData[] = []
  for (let i = 0; i < 16; i++) {
    const a = DOOR_A + Math.PI / LEGS + (i / 16) * Math.PI * 2
    const dir: Vec2 = [Math.cos(a), Math.sin(a)]
    const path: Vec3[] = ROOF_RINGS.map(([r, dz]) => [dir[0] * r, dir[1] * r, CROWN(dz)] as Vec3)
    // Extend the foot into the eave ring and the head into the apex ring.
    path[0] = [dir[0] * (R_DECK + 0.05), dir[1] * (R_DECK + 0.05), CROWN(EAVE_TOP) + 0.005]
    path[path.length - 1] = [dir[0] * 0.72, dir[1] * 0.72, CROWN(6.28)]
    const rafter = tubeAlong(densifyPath(path, 0.12), roundedRect(0.055, 0.16, 0.01, 2), {
      cap: true,
      up: [dir[0], dir[1], 0.9] as Vec3,
    })
    smoothShade(rafter, SMOOTH.moulded)
    steel.push(rafter)

    // Eave bracket + two bolts at the rafter foot.
    const bracket = roundedBox([-0.05, -0.03, -0.15, 0.05, 0.03, 0.06], BEVEL.hardware, 2)
    rotateZ(bracket, a + Math.PI / 2, [0, 0])
    translate(bracket, [dir[0] * (R_DECK - 0.065), dir[1] * (R_DECK - 0.065), CROWN(EAVE_TOP) + 0.02])
    steel.push(bracket)
  }
  // Purlins between the facet rows.
  for (const [r, dz] of [ROOF_RINGS[1], ROOF_RINGS[2]]) {
    const path: Vec3[] = []
    for (let s = 0; s < 96; s++) {
      const a = (s / 96) * Math.PI * 2
      path.push([Math.cos(a) * r, Math.sin(a) * r, CROWN(dz) - 0.02])
    }
    const purlin = tubeAlong(path, circle(0.038, 10), { closePath: true, cap: false })
    smoothShade(purlin, SMOOTH.turned)
    steel.push(purlin)
  }
  // Apex compression ring: a turned ring with a chamfered shoulder.
  const apex = revolve(
    [
      [0.62, -0.13],
      [0.9, -0.13],
      [0.94, -0.09],
      [0.94, 0.05],
      [0.86, 0.13],
      [0.66, 0.13],
      [0.62, 0.09],
    ],
    64,
    { capStart: false, capEnd: false, smooth: SMOOTH.moulded },
  )
  translate(apex, [0, 0, CROWN(6.25)])
  steel.push(apex)

  // Roof panes: 16 bays × 3 rows of flat trapezoids, corners pulled off the
  // rafter axes and tucked toward the purlins.
  for (let i = 0; i < 16; i++) {
    const aA = DOOR_A + Math.PI / LEGS + (i / 16) * Math.PI * 2
    const aB = aA + (Math.PI * 2) / 16
    for (let row = 0; row < 3; row++) {
      const [r0, z0] = ROOF_RINGS[row]
      const [r1, z1] = ROOF_RINGS[row + 1]
      const inset = (r: number): number => 0.055 / Math.max(0.35, r) // ~pane gap as angle
      const g0 = inset(r0)
      const g1 = inset(r1)
      const pane = MeshData.from(
        [
          [Math.cos(aA + g0) * (r0 - 0.03), Math.sin(aA + g0) * (r0 - 0.03), CROWN(z0) + 0.028],
          [Math.cos(aB - g0) * (r0 - 0.03), Math.sin(aB - g0) * (r0 - 0.03), CROWN(z0) + 0.028],
          [Math.cos(aB - g1) * (r1 + 0.03), Math.sin(aB - g1) * (r1 + 0.03), CROWN(z1) - 0.012],
          [Math.cos(aA + g1) * (r1 + 0.03), Math.sin(aA + g1) * (r1 + 0.03), CROWN(z1) - 0.012],
        ],
        [[3, 2, 1, 0]],
      )
      build.glass.push(pane)
    }
  }
  for (const md of steel) slotPush(build, 'steel', md)
}

function densifyPath(path: Vec3[], d: number): Vec3[] {
  const out: Vec3[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]
    const b = path[i]
    const c = path[i + 1]
    const lin = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const lout = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2])
    if (lin > 2.5 * d) {
      out.push([
        b[0] - ((b[0] - a[0]) / lin) * d,
        b[1] - ((b[1] - a[1]) / lin) * d,
        b[2] - ((b[2] - a[2]) / lin) * d,
      ])
    }
    out.push(b)
    if (lout > 2.5 * d) {
      out.push([
        b[0] + ((c[0] - b[0]) / lout) * d,
        b[1] + ((c[1] - b[1]) / lout) * d,
        b[2] + ((c[2] - b[2]) / lout) * d,
      ])
    }
  }
  out.push(path[path.length - 1])
  return out
}

/**
 * The spire: an octagonal needle standing on the crown post, threading the
 * apex ring with an annular reveal, carrying a storm collar over that
 * reveal, two turned bead collars, the glass lantern and the tip.
 */
function buildSpire(build: Build): void {
  const oct = (r: number): Vec2[] => circle(r, 8, 0, 0, Math.PI / 8)
  const levels: Array<[number, number]> = [
    [0.55, 0],
    [0.52, 0.12],
    [0.46, 0.35],
    [0.42, 0.35],
    [0.38, 0.9],
    [0.3, 1.4],
    [0.222, 2.15],
    [0.155, 2.85],
    [0.112, 3.34],
  ]
  const spire = loft(
    levels.map(([r, dz]) => oct(r).map(([x, y]) => [x, y, Z_SPIRE_BASE + dz] as Vec3)),
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(spire, SMOOTH.moulded)
  slotPush(build, 'steel', spire)

  // Storm collar over the apex-ring reveal.
  const collar = revolve(
    [
      [0.2, 0.66],
      [0.72, 0.52],
      [0.72, 0.565],
      [0.24, 0.7],
      [0.2, 0.7],
    ],
    32,
    { capStart: false, capEnd: false, smooth: SMOOTH.moulded },
  )
  translate(collar, [0, 0, Z_SPIRE_BASE])
  slotPush(build, 'steel', collar)

  // Bead collars.
  for (const [r, dz] of [
    [0.315, 1.32],
    [0.235, 2.08],
  ]) {
    const bead = revolve(
      [
        [r, -0.03],
        [r + 0.028, 0],
        [r, 0.03],
      ],
      24,
      { capStart: false, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(bead, [0, 0, Z_SPIRE_BASE + dz])
    slotPush(build, 'steel', bead)
  }

  // Lantern: eight posts, glass, glowing core, cap cone and needle tip.
  const lz = Z_SPIRE_BASE + 3.34
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2
    const post = tubeAlong(
      [
        [Math.cos(a) * 0.104, Math.sin(a) * 0.104, lz],
        [Math.cos(a) * 0.085, Math.sin(a) * 0.085, lz + 0.42],
      ],
      roundedRect(0.02, 0.024, 0.004, 1),
      { cap: true },
    )
    smoothShade(post, SMOOTH.moulded)
    slotPush(build, 'steel', post)
  }
  const core = revolve(
    [
      [0, 0],
      [0.048, 0],
      [0.052, 0.04],
      [0.052, 0.27],
      [0.048, 0.31],
      [0, 0.31],
    ],
    20,
    { smooth: SMOOTH.turned },
  )
  translate(core, [0, 0, lz + 0.05])
  slotPush(build, 'utilityLight', core)
  const lanternGlass = loft(
    [
      circle(0.1, 8, 0, 0, Math.PI / 8).map(([x, y]) => [x, y, lz + 0.03] as Vec3),
      circle(0.082, 8, 0, 0, Math.PI / 8).map(([x, y]) => [x, y, lz + 0.4] as Vec3),
    ],
    { closeV: true },
  )
  build.screenGlass.push(lanternGlass)
  const cap = loft(
    [
      oct(0.108).map(([x, y]) => [x, y, lz + 0.42] as Vec3),
      oct(0.075).map(([x, y]) => [x, y, lz + 0.5] as Vec3),
      oct(0.045).map(([x, y]) => [x, y, lz + 0.56] as Vec3),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(cap, SMOOTH.moulded)
  slotPush(build, 'steel', cap)
  const needle = revolve(
    [
      [0, 0],
      [0.036, 0],
      [0.022, 0.36],
      [0.012, 0.62],
      [0.011, Z_TIP - (lz + 0.56) - 0.028],
      [0, Z_TIP - (lz + 0.56)],
    ],
    16,
    { smooth: SMOOTH.turned },
  )
  translate(needle, [0, 0, lz + 0.56])
  slotPush(build, 'dark', needle)
}

/**
 * A shaft screen at one landing: aluminum base + head channels floating in
 * the curb rebate, glass panes segmented along the stadium, portal frame
 * with jambs, head beam, threshold plate and the ceiling-mounted door track
 * cover. Shared by both landings (floorZ = walking surface).
 */
function buildScreen(build: Build, floorZ: number, ground: boolean): void {
  const alu: MeshData[] = []
  const rebateZ = floorZ + 0.019 // channel bottom floats 3 mm over rebate floor
  const glassR = SHAFT_R
  const headZ = floorZ + SCREEN_TOP
  // Walk the stadium boundary as angle stations; portal spans ±PORTAL_HALF_ARC
  // about the door axis measured AT THE CAB CENTRE (the portal arc is a true
  // arc of the cab-end cap, so door leaves, frame and screen stay concentric).
  // Walk STARTS inside the portal gap (b = 0 is the door axis), so the two
  // ends of the walk can never meet mid-run and stamp coincident caps.
  const stations = 176
  const runs: Vec2[][] = []
  let current: Vec2[] = []
  for (let i = 0; i <= stations; i++) {
    const b = (i / stations) * Math.PI * 2
    const r = stadiumRadius(b, 0)
    const p = pw(Math.cos(b) * r, Math.sin(b) * r)
    // Portal test: local (s, t) about the cab centre.
    const s = Math.cos(b) * r - CAB_S
    const t = Math.sin(b) * r
    const inPortal = Math.abs(Math.atan2(t, s)) < PORTAL_HALF_ARC && s > 0
    if (inPortal) {
      if (current.length > 1) runs.push(current)
      current = []
    } else {
      current.push(p)
    }
  }
  if (current.length > 1) runs.push(current)

  for (const run of runs) {
    // Base + head channel along the run.
    for (const [z0, z1] of [
      [rebateZ, rebateZ + 0.078],
      [headZ - 0.028, headZ + 0.05],
    ]) {
      const path: Vec3[] = run.map(([x, y]) => [x, y, (z0 + z1) / 2] as Vec3)
      const ch = tubeAlong(path, roundedRect(0.075, z1 - z0, 0.006, 1), { cap: true })
      smoothShade(ch, SMOOTH.moulded)
      alu.push(ch)
    }
    // Glass: one ribbon per run (vertical), tucked into both channels.
    const rings: Vec3[][] = run.map(([x, y]) => [
      [x, y, rebateZ + 0.055],
      [x, y, headZ - 0.008],
    ])
    const pane = loft(rings, { closeV: false })
    build.screenGlass.push(pane)
  }

  // Portal frame: two jamb posts + head beam + threshold, aligned on the
  // cab-centred portal arc.
  const jambs: Vec2[] = []
  for (const sign of [1, -1]) {
    const ang = sign * PORTAL_HALF_ARC
    const s = CAB_S + Math.cos(ang) * glassR
    const t = Math.sin(ang) * glassR
    jambs.push(pw(s, t))
  }
  for (const [jx, jy] of jambs) {
    // Post base floats 3 mm over the dipped curb band (its own shadow line
    // hides the joint), head runs past the screen head channel.
    const post = tubeAlong(
      [
        [jx, jy, floorZ + 0.007],
        [jx, jy, headZ + 0.05],
      ],
      roundedRect(0.095, 0.15, 0.012, 2),
      { cap: true },
    )
    rotateZ(post, DOOR_A, [jx, jy])
    smoothShade(post, SMOOTH.moulded)
    alu.push(post)
  }
  // Head beam between the jambs (straight chord over the opening).
  const hb = tubeAlong(
    [
      [jambs[0][0], jambs[0][1], floorZ + 2.36],
      [jambs[1][0], jambs[1][1], floorZ + 2.36],
    ],
    roundedRect(0.09, 0.3, 0.012, 2),
    { cap: true },
  )
  smoothShade(hb, SMOOTH.moulded)
  alu.push(hb)
  // Transom glass over the head beam up to the screen head.
  const transom = MeshData.from(
    [
      [jambs[0][0], jambs[0][1], floorZ + 2.53],
      [jambs[1][0], jambs[1][1], floorZ + 2.53],
      [jambs[1][0], jambs[1][1], headZ - 0.008],
      [jambs[0][0], jambs[0][1], headZ - 0.008],
    ],
    [[0, 1, 2, 3]],
  )
  build.screenGlass.push(transom)

  // Threshold: fluted plate bridging curb → cab sill, with ramp bevels.
  // Threshold: fluted plate bridging curb → cab sill. Held 20 mm clear of
  // both jamb posts and its base 3 mm above their base plane (stagger the
  // undersides — never share a plane).
  const [t0x, t0y] = pw(CAB_S + glassR - 0.16, 0)
  const across = pwRot(DOOR_A + Math.PI / 2, 1, 0)
  const thPlan: Vec2[] = [
    [t0x - across[0] * 0.545, t0y - across[1] * 0.545],
    [t0x + across[0] * 0.545, t0y + across[1] * 0.545],
    [t0x + across[0] * 0.545 + UX * 0.42, t0y + across[1] * 0.545 + UZ * 0.42],
    [t0x - across[0] * 0.545 + UX * 0.42, t0y - across[1] * 0.545 + UZ * 0.42],
  ]
  const threshold = prism(thPlan, floorZ + 0.01, floorZ + CAB_FLOOR_LIFT)
  smoothShade(threshold, SMOOTH.moulded)
  alu.push(threshold)

  // NO separate door-track cover: the head beam IS the track housing (its
  // 0.3 m depth already reads as one). A cover inboard of the beam sits in
  // the CAB'S SWEPT ENVELOPE — the crown drum passed straight through the
  // first one during the ride (owner report from inside the cab); the
  // freedom-audit's envelope sweep now gates that whole class.

  // Call pylon beside the portal (right of the door, approach side).
  const [px, py] = pw(CAB_S + glassR + 0.52, ground ? 1.06 : -1.06)
  const pylon = loft(
    [
      chamferRect(0.3, 0.22, 0.04).map(([x, y]) => {
        const q = pwRot(DOOR_A, x, y)
        return [px + q[0], py + q[1], floorZ + 0.002] as Vec3
      }),
      chamferRect(0.27, 0.2, 0.038).map(([x, y]) => {
        const q = pwRot(DOOR_A, x, y)
        return [px + q[0], py + q[1], floorZ + 1.02] as Vec3
      }),
      chamferRect(0.22, 0.17, 0.034).map(([x, y]) => {
        const q = pwRot(DOOR_A, x, y)
        return [px + q[0], py + q[1], floorZ + 1.08] as Vec3
      }),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(pylon, SMOOTH.moulded)
  slotPush(build, 'steel', pylon)
  const lens = roundedBox([-0.026, -0.008, 0, 0.026, 0.008, 0.052], 0.004, 1)
  rotateZ(lens, DOOR_A, [0, 0])
  const lensOff = pwRot(DOOR_A, 0.06, 0.101)
  translate(lens, [px + lensOff[0], py + lensOff[1], floorZ + 0.88])
  slotPush(build, 'runningLight', lens)

  for (const md of alu) slotPush(build, 'aluminum', md)
}

/**
 * Lobby dressing: the entrance canopy over the ground portal, the blade
 * name sign, the glow strip under the canopy edge and the dedication stone
 * out by the approach steps.
 */
function buildLobbyDressing(build: Build, group: import('three').Group): void {
  const alu: MeshData[] = []
  // Canopy: a tapered blade plate on two raker rods off the screen head.
  const cW = 1.36
  const c0 = CAB_S + SHAFT_R - 0.05
  const c1 = c0 + 1.65
  const zC = Z_TERR + SCREEN_TOP + 0.08
  const across = pwRot(DOOR_A + Math.PI / 2, 1, 0)
  const plan: Vec2[] = [
    [c0 * UX - cW * across[0], c0 * UZ - cW * across[1]],
    [c0 * UX + cW * across[0], c0 * UZ + cW * across[1]],
    [c1 * UX + (cW - 0.24) * across[0], c1 * UZ + (cW - 0.24) * across[1]],
    [c1 * UX - (cW - 0.24) * across[0], c1 * UZ - (cW - 0.24) * across[1]],
  ]
  // The blade tapers 55 mm at the root to 27 mm at the nose: soffit is
  // level, the top surface falls toward the nose.
  const soffit = plan.map(([x, y]) => [x, y, zC] as Vec3)
  const topFace = plan.map(([x, y], k) => [x, y, zC + (k >= 2 ? 0.027 : 0.055)] as Vec3)
  const canopy = loft([soffit, topFace], { closeV: true, capStart: true, capEnd: true })
  smoothShade(canopy, SMOOTH.moulded)
  alu.push(canopy)
  for (const side of [1, -1]) {
    // Stay rod dies INTO the canopy body (12 mm bury at its toe — a rod
    // hovering over the blade was visible from the gallery above).
    const rod = tubeAlong(
      [
        [(c0 + 0.12) * UX + side * (cW - 0.3) * across[0], (c0 + 0.12) * UZ + side * (cW - 0.3) * across[1], zC + 0.5],
        [(c1 - 0.3) * UX + side * (cW - 0.34) * across[0], (c1 - 0.3) * UZ + side * (cW - 0.34) * across[1], zC + 0.015],
      ],
      circle(0.02, 10),
      { cap: true },
    )
    smoothShade(rod, SMOOTH.turned)
    alu.push(rod)
  }
  // Entrance glow: a slim strip under the canopy nose.
  const glow = box(-0.5, -0.014, zC - 0.012, 0.5, 0.014, zC - 0.002)
  rotateZ(glow, DOOR_A + Math.PI / 2, [0, 0])
  const gOff = pw(c1 - 0.32, 0)
  translate(glow, [gOff[0], gOff[1], 0])
  slotPush(build, 'signageGlow', glow)

  // Name blade over the portal: dark plate + printed face mesh.
  const bladeS = CAB_S + SHAFT_R + 0.09
  const blade = roundedBox([-1.18, -0.02, 0, 1.18, 0.02, 0.36], BEVEL.panel, 2)
  rotateZ(blade, DOOR_A + Math.PI / 2, [0, 0])
  const bOff = pw(bladeS, 0)
  translate(blade, [bOff[0], bOff[1], Z_TERR + 2.52])
  slotPush(build, 'dark', blade)
  const face = new Mesh(
    toGeometry(
      toYUp(
        translate(
          rotateZ(
            printedQuad(
              [
                [-1.12, -0.0235, 0.03],
                [1.12, -0.0235, 0.03],
                [1.12, -0.0235, 0.33],
                [-1.12, -0.0235, 0.33],
              ],
              true,
            ),
            DOOR_A + Math.PI / 2,
            [0, 0],
          ),
          [bOff[0] + CX, bOff[1] + CZ, Z_TERR + 2.52 + PADY],
        ),
      ),
    ),
    signFace(['FREEDOM TOWER'], {
      aspect: 2.24 / 0.3,
      background: '#211f1d',
      ink: '#e8e2d4',
      accent: '#b8542e',
    }),
  )
  face.name = 'freedom:sign-name'
  group.add(face)

  // Gallery lintel plate at the deck portal.
  const lintel = roundedBox([-0.62, -0.016, 0, 0.62, 0.016, 0.22], BEVEL.panel, 2)
  rotateZ(lintel, DOOR_A + Math.PI / 2, [0, 0])
  translate(lintel, [bOff[0], bOff[1], Z_DECK + 2.5])
  slotPush(build, 'dark', lintel)
  const lintelFace = new Mesh(
    toGeometry(
      toYUp(
        translate(
          rotateZ(
            printedQuad(
              [
                [-0.56, -0.0195, 0.028],
                [0.56, -0.0195, 0.028],
                [0.56, -0.0195, 0.192],
                [-0.56, -0.0195, 0.192],
              ],
              true,
            ),
            DOOR_A + Math.PI / 2,
            [0, 0],
          ),
          [bOff[0] + CX, bOff[1] + CZ, Z_DECK + 2.5 + PADY],
        ),
      ),
    ),
    signFace(['THE GALLERY', 'ELEV 38.7 M · CAP 12'], { aspect: 1.12 / 0.164 }),
  )
  lintelFace.name = 'freedom:sign-gallery'
  group.add(lintelFace)

  // Dedication stone: a battered lectern by the approach steps. The top is
  // ONE canted plane (a rectangle tilted about the across-axis is planar,
  // so the cap ear-clips clean) and the reading desk sits ON it — the first
  // pass grew a crown that overhung a floating desk (owner-visible clunk).
  const dOff = pw(11.9, 2.7)
  const lectern = (x: number, y: number): Vec3 => {
    // Local (x = across, y = toward the approach) in the door frame.
    const q = pwRot(DOOR_A + Math.PI / 2, x, y)
    return [dOff[0] + q[0], dOff[1] + q[1], 0]
  }
  const at3 = (x: number, y: number, z: number): Vec3 => {
    const p = lectern(x, y)
    return [p[0], p[1], z]
  }
  // Canted top plane. In this frame +y points TOWARD the tower, so the
  // approach side is −y: low edge 0.82 there, high edge 1.0 at the back —
  // a 19° reading rake toward the arriving visitor.
  const topZ = (y: number): number => 0.91 + (y / 0.26) * 0.09
  const stoneRings: Vec3[][] = [
    chamferRect(1.04, 0.6, 0.09).map(([x, y]) => at3(x, y, Z_SLAB - 0.015)),
    chamferRect(1.04, 0.6, 0.09).map(([x, y]) => at3(x, y, 0.24)),
    chamferRect(0.9, 0.52, 0.08).map(([x, y]) => at3(x, y, 0.58)),
    chamferRect(0.8, 0.52, 0.07).map(([x, y]) => at3(x * 0.975, y, topZ(y))),
  ]
  const stone = loft(stoneRings, { closeV: true, capStart: true, capEnd: true })
  smoothShade(stone, SMOOTH.cast)
  slotPush(build, 'cast', stone)

  // Desk plate floats 3 mm over the canted cap (cast never meets dark), the
  // printed face 3 mm over the desk. Both share the cap's own rake.
  const rake = Math.atan2(0.09, 0.26)
  const deskOn = (md: MeshData, lift: number): MeshData => {
    // Author flat in (x, y) about the origin: rake about the across-axis,
    // rotate the plan into the door frame, stand on the cap's centre.
    const c = Math.cos(rake)
    const s = Math.sin(rake)
    for (const v of md.verts) {
      const y = v[1]
      const z = v[2]
      v[1] = y * c - z * s
      v[2] = y * s + z * c
    }
    md.provenance = null
    rotateZ(md, DOOR_A + Math.PI / 2, [0, 0])
    const centre = lectern(0, 0)
    // The cap plane passes through z 0.91 at the centre; the raked part's
    // base plane is parallel to it, so one centre lift sets the float.
    return translate(md, [centre[0], centre[1], 0.91 + lift])
  }
  const desk = deskOn(roundedBox([-0.37, -0.26, 0, 0.37, 0.26, 0.024], BEVEL.hardware, 2), 0.003)
  slotPush(build, 'dark', desk)
  // The reader stands on the −y (approach) side, whose screen-right is the
  // NEGATIVE of this frame's +x — mirror the type or it reads reversed.
  const plaque = deskOn(
    printedQuad(
      [
        [-0.33, -0.22, 0.027],
        [0.33, -0.22, 0.027],
        [0.33, 0.22, 0.027],
        [-0.33, 0.22, 0.027],
      ],
      true,
    ),
    0.003,
  )
  const plaqueMesh = new Mesh(
    toGeometry(toYUp(translate(plaque, [CX, CZ, PADY]))),
    signFace(
      ['FREEDOM TOWER', 'RAISED BY THE CITIZENS OF ELYSIUM', 'FREE GROUND · OPEN SKY · 2052'],
      { aspect: 0.66 / 0.44, background: '#26221f', ink: '#ded7c8', accent: '#b8542e' },
    ),
  )
  plaqueMesh.name = 'freedom:sign-plaque'
  group.add(plaqueMesh)

  for (const md of alu) slotPush(build, 'aluminum', md)
}

/** Terrace step lights: lens plates proud on the middle riser, 16 bays. */
function buildStepLights(build: Build): void {
  for (let i = 0; i < 16; i++) {
    const a = DOOR_A + ((i + 0.5) / 16) * Math.PI * 2
    // Skip the two bays the approach walk lands through.
    const rel = Math.atan2(Math.sin(a - DOOR_A), Math.cos(a - DOOR_A))
    if (Math.abs(rel) < 0.28) continue
    // Riser 2's battered face sits at r ≈ 11.304 at this height; the bezel
    // plate stands 4 mm proud of it everywhere, the lens floats 2 mm proud
    // of the bezel (applied layers, never a shared plane).
    const bezel = roundedBox([-0.075, -0.007, -0.032, 0.075, 0.007, 0.032], 0.004, 1)
    rotateZ(bezel, a + Math.PI / 2, [0, 0])
    translate(bezel, [Math.cos(a) * 11.316, Math.sin(a) * 11.316, 0.253])
    slotPush(build, 'aluminum', bezel)
    const lens = box(-0.061, -0.0025, -0.024, 0.061, 0.0025, 0.024)
    rotateZ(lens, a + Math.PI / 2, [0, 0])
    translate(lens, [Math.cos(a) * 11.3275, Math.sin(a) * 11.3275, 0.253])
    slotPush(build, 'floorLens', lens)
  }
}

/** Orientation lecterns on the gallery: four canted range-finder plaques. */
function buildOrientation(build: Build, group: import('three').Group): void {
  const plates: Array<[number, string[]]> = [
    // [world plan bearing the plate faces, legend]
    [Math.atan2(-1, 0.35), ['ELYSIUM MONS', 'SHIELD VOLCANO · 742 KM']],
    [Math.atan2(0.2, 1), ['OLYMPUS MONS', 'HIGHEST SUMMIT · 5 910 KM']],
    [Math.atan2(1, -0.5), ['CERBERUS FOSSAE', 'YOUNG FISSURES · 260 KM']],
    [Math.atan2(-0.3, -1), ['GALE CRATER', 'CURIOSITY SITE · 990 KM']],
  ]
  for (const [bearing, lines] of plates) {
    const px = Math.cos(bearing) * 4.62
    const py = Math.sin(bearing) * 4.62
    const stand = loft(
      [
        chamferRect(0.4, 0.16, 0.03).map(([x, y]) => {
          const q = pwRot(bearing + Math.PI / 2, x, y)
          return [px + q[0], py + q[1], Z_DECK + 0.002] as Vec3
        }),
        chamferRect(0.34, 0.13, 0.026).map(([x, y]) => {
          const q = pwRot(bearing + Math.PI / 2, x, y)
          return [px + q[0] + Math.cos(bearing) * 0.05, py + q[1] + Math.sin(bearing) * 0.05, Z_DECK + 0.78] as Vec3
        }),
      ],
      { closeV: true, capStart: true, capEnd: true },
    )
    smoothShade(stand, SMOOTH.moulded)
    slotPush(build, 'steel', stand)
    const desk = roundedBox([-0.26, -0.17, 0, 0.26, 0.17, 0.024], BEVEL.hardware, 2)
    cantDesk(desk, bearing, 28)
    translate(desk, [px + Math.cos(bearing) * 0.04, py + Math.sin(bearing) * 0.04, Z_DECK + 0.8])
    slotPush(build, 'dark', desk)
    const face = printedQuad([
      [-0.23, -0.14, 0.028],
      [0.23, -0.14, 0.028],
      [0.23, 0.14, 0.028],
      [-0.23, 0.14, 0.028],
    ])
    cantDesk(face, bearing, 28)
    translate(face, [px + Math.cos(bearing) * 0.04, py + Math.sin(bearing) * 0.04, Z_DECK + 0.8])
    const mesh = new Mesh(
      toGeometry(toYUp(translate(face, [CX, CZ, PADY]))),
      signFace(lines, { aspect: 0.46 / 0.28, background: '#221f1d', ink: '#ddd6c7' }),
    )
    mesh.name = 'freedom:sign-orient'
    group.add(mesh)
  }
}

function cantDesk(md: MeshData, bearing: number, deg: number): MeshData {
  const ang = (deg * Math.PI) / 180
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const bx = Math.cos(bearing)
  const by = Math.sin(bearing)
  for (const v of md.verts) {
    const along = v[0] * 0 + v[1] * 1 // desk authored with +Y toward the view
    const across = v[0]
    const na = along * c - v[2] * s
    const nz = along * s + v[2] * c
    v[0] = across * -by + na * bx
    v[1] = across * bx + na * by
    v[2] = nz
  }
  md.provenance = null
  return md
}

// ----------------------------------------------------------------- assembly

export function buildFreedomTower(services: DistrictServices): void {
  const { writer, group, colliders, seats } = services
  const build: Build = { parts: {}, glass: [], screenGlass: [] }

  buildStylobate(build)
  buildPedestals(build)
  buildLattice(build)
  buildCore(build)
  buildDeck(build)
  buildWall(build)
  buildRoof(build)
  buildSpire(build)
  buildScreen(build, Z_TERR, true)
  buildScreen(build, Z_DECK, false)
  buildLobbyDressing(build, group)
  buildStepLights(build)
  buildOrientation(build, group)

  // Emit everything through the shared writer (world-space translate here).
  for (const [slot, list] of Object.entries(build.parts)) {
    for (const md of list) {
      writeInto(writer, slot, translate(md, [CX, CZ, PADY]))
    }
  }

  // Glass: two merged meshes with their own materials, never in the writer.
  if (!glassMaterial) glassMaterial = curtainGlassMaterial()
  const emitGlass = (list: MeshData[], material: import('three').Material, name: string): void => {
    if (list.length === 0) return
    const joined = cleanMesh(join(list))
    translate(joined, [CX, CZ, PADY])
    const mesh = new Mesh(toGeometry(toYUp(joined)), material)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 12
    group.add(mesh)
  }
  emitGlass(build.glass, glassMaterial, 'freedom:glass')
  emitGlass(build.screenGlass, shaftGlass(), 'freedom:screen-glass')

  buildColliders(colliders)
  buildBenches(writer, colliders, seats)

  // The artificial layer: one real light for the gallery at dusk (falls
  // back to emissive-only when the budget is spent), plus the audit pools.
  const fixtures = lightFixtures()
  fixtures.registerGlowPool({
    id: 'freedom-gallery',
    slot: 'interiorGlow',
    count: 128,
    position: [CX, PADY + Z_DECK + 2.9, CZ],
  })
  fixtures.registerGlowPool({
    id: 'freedom-steps',
    slot: 'floorLens',
    count: 30,
    position: [CX, PADY + 0.3, CZ],
  })
  fixtures.registerRealLight({
    id: 'freedom-gallery',
    position: [CX, PADY + Z_DECK + 2.86, CZ],
    color: 0xffd2a2,
    intensity: 15,
    range: 13,
    cone: { angle: 1.12, penumbra: 0.7, target: [CX, PADY + Z_DECK, CZ] },
  })
}

function buildBenches(
  writer: DistrictServices['writer'],
  colliders: DistrictServices['colliders'],
  seats: DistrictServices['seats'],
): void {
  // Two on the gallery (facing out through the glass), two on the terrace.
  const spots: Array<[number, number, number, number, string]> = [
    [Math.cos(DOOR_A + 2.2) * 4.35, Math.sin(DOOR_A + 2.2) * 4.35, Z_DECK, DOOR_A + 2.2, 'Take in the view'],
    [Math.cos(DOOR_A - 2.4) * 4.35, Math.sin(DOOR_A - 2.4) * 4.35, Z_DECK, DOOR_A - 2.4, 'Take in the view'],
    [Math.cos(DOOR_A + 0.85) * 9.1, Math.sin(DOOR_A + 0.85) * 9.1, Z_TERR, DOOR_A + 0.85, 'Sit'],
    [Math.cos(DOOR_A - 0.85) * 9.1, Math.sin(DOOR_A - 0.85) * 9.1, Z_TERR, DOOR_A - 0.85, 'Sit'],
  ]
  for (const [x, y, z, bearing, label] of spots) {
    // Face outward: bench local +Z (front) looks along the bearing.
    const yaw = Math.atan2(Math.cos(bearing), Math.sin(bearing)) + Math.PI
    const center = new Vector3(CX + x, PADY + z, CZ + y)
    const result = bench(writer, center, yaw)
    seats.push({ seat: result.seat, yaw: result.yaw, label })
    colliders.push({
      kind: 'box',
      center: center.clone().setY(PADY + z + 0.24),
      size: new Vector3(1.9, 0.48, 0.62),
      yaw,
    })
  }
}

function buildColliders(colliders: DistrictServices['colliders']): void {
  const world = (x: number, y: number, z: number): Vector3 => new Vector3(CX + x, PADY + z, CZ + y)

  // Stylobate: three step discs + the terrace disc. Solid cylinders are safe
  // here — the pit volume they cross is sealed behind the screens and the
  // cab floor rides above them.
  const stepTable: Array<[number, number]> = [
    [11.74, 0.192],
    [11.32, 0.314],
    [10.9, Z_TERR],
  ]
  for (const [r, top] of stepTable) {
    colliders.push({
      kind: 'cylinder',
      center: world(0, 0, top - 0.5),
      halfHeight: 0.5,
      radius: r,
    })
  }

  // Pedestals.
  for (let i = 0; i < LEGS; i++) {
    const mid = DOOR_A + Math.PI / LEGS + (i / LEGS) * Math.PI * 2
    colliders.push({
      kind: 'box',
      center: world(Math.cos(mid) * R_LEG_BASE, Math.sin(mid) * R_LEG_BASE, Z_TERR + 0.29),
      size: new Vector3(1.44, 0.58, 0.98),
      yaw: Math.atan2(-Math.cos(mid), -Math.sin(mid)),
    })
  }
  // Leg roots: two stacked boxes following the lean, up to head height.
  for (const f of [1, -1]) {
    for (let i = 0; i < LEGS; i++) {
      for (const [k0, k1] of [
        [0.0, 0.036],
        [0.036, 0.072],
      ]) {
        const a = legPoint(f, i, (k0 + k1) / 2)
        const h = (legPoint(f, i, k1)[2] - legPoint(f, i, k0)[2]) / 2
        colliders.push({
          kind: 'box',
          center: world(a[0], a[1], a[2]),
          size: new Vector3(0.52, h * 2, 0.52),
        })
      }
    }
  }

  // Shaft screens (both landings): boxes along the stadium runs + portal
  // jambs. The landing-door gap itself is gated by the elevator system.
  for (const floorZ of [Z_TERR, Z_DECK]) {
    const segs = 18
    for (let i = 0; i < segs; i++) {
      const b0 = (i / segs) * Math.PI * 2 - Math.PI
      const b1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI
      const bm = (b0 + b1) / 2
      const rm = stadiumRadius(bm, 0)
      const s = Math.cos(bm) * rm - CAB_S
      const t = Math.sin(bm) * rm
      if (Math.abs(Math.atan2(t, s)) < PORTAL_HALF_ARC + 0.12 && s > 0) continue
      const p0 = pw(Math.cos(b0) * stadiumRadius(b0, 0), Math.sin(b0) * stadiumRadius(b0, 0))
      const p1 = pw(Math.cos(b1) * stadiumRadius(b1, 0), Math.sin(b1) * stadiumRadius(b1, 0))
      const mx = (p0[0] + p1[0]) / 2
      const my = (p0[1] + p1[1]) / 2
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 0.14
      const yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1])
      colliders.push({
        kind: 'box',
        center: world(mx, my, floorZ + SCREEN_TOP / 2),
        size: new Vector3(0.09, SCREEN_TOP, len),
        yaw,
      })
    }
    // Portal jambs.
    for (const sign of [1, -1]) {
      const ang = sign * PORTAL_HALF_ARC
      const s = CAB_S + Math.cos(ang) * SHAFT_R
      const t = Math.sin(ang) * SHAFT_R
      const [jx, jy] = pw(s, t)
      colliders.push({
        kind: 'box',
        center: world(jx, jy, floorZ + 1.25),
        size: new Vector3(0.16, 2.5, 0.2),
        yaw: DOOR_A,
      })
    }
    // Portal threshold walk-over plate.
    const [tx, ty] = pw(CAB_S + SHAFT_R + 0.05, 0)
    colliders.push({
      kind: 'box',
      center: world(tx, ty, floorZ + CAB_FLOOR_LIFT - 0.05),
      size: new Vector3(1.24, 0.1, 0.6),
      yaw: DOOR_A,
    })
  }

  // Gallery floor ring: sector boxes with honest inner edges at the shaft.
  const sectors = 14
  for (let i = 0; i < sectors; i++) {
    const b0 = (i / sectors) * Math.PI * 2
    const b1 = ((i + 1) / sectors) * Math.PI * 2
    let rIn = 0
    for (let k = 0; k <= 6; k++) {
      rIn = Math.max(rIn, stadiumRadius(b0 + ((b1 - b0) * k) / 6, 0.05))
    }
    rIn = Math.min(rIn + 0.05, R_DECK - 0.6)
    const bm = (b0 + b1) / 2 + DOOR_A
    const rOut = R_DECK - 0.05
    const rMid = (rIn + rOut) / 2
    const half = (rOut - rIn) / 2
    const width = 2 * rOut * Math.sin((b1 - b0) / 2) + 0.12
    colliders.push({
      kind: 'box',
      // size.x runs TANGENTIAL (the collider yaw convention: local +X on
      // the tangent at plan angle φ is atan2(−cos φ, −sin φ)).
      center: world(Math.cos(bm) * rMid, Math.sin(bm) * rMid, Z_DECK - 0.11),
      size: new Vector3(width, 0.22, half * 2),
      yaw: Math.atan2(-Math.cos(bm), -Math.sin(bm)),
    })
  }
  // Gallery glass wall: chord boxes bay by bay, full coverage.
  for (let i = 0; i < 16; i++) {
    const a0 = DOOR_A + Math.PI / LEGS + (i / 16) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / 16
    const am = (a0 + a1) / 2
    const chord = 2 * (R_DECK - 0.06) * Math.sin(Math.PI / 16) + 0.3
    const rm = (R_DECK - 0.06) * Math.cos(Math.PI / 16)
    colliders.push({
      kind: 'box',
      center: world(Math.cos(am) * rm, Math.sin(am) * rm, Z_DECK + 1.5),
      size: new Vector3(chord, 3.0, 0.08),
      yaw: Math.atan2(-Math.cos(am), -Math.sin(am)),
    })
  }

  // Lobby dressing: canopy posts none (rod-hung); call pylons + plaque.
  for (const [floorZ, side] of [
    [Z_TERR, 1],
    [Z_DECK, -1],
  ]) {
    const [px, py] = pw(CAB_S + SHAFT_R + 0.52, side * 1.06)
    colliders.push({
      kind: 'box',
      center: world(px, py, floorZ + 0.55),
      size: new Vector3(0.32, 1.1, 0.24),
      yaw: DOOR_A,
    })
  }
  const [dx, dy] = pw(11.9, 2.7)
  colliders.push({
    kind: 'box',
    center: world(dx, dy, 0.5),
    size: new Vector3(1.06, 1.0, 0.6),
    yaw: DOOR_A,
  })
}

/** Ground reference for external callers (approach checks, probes). */
export function freedomGroundY(x: number, z: number): number {
  return interiorHeight(x, z)
}
