/**
 * habUnit.ts — the Residential Arc's prefab dwelling, as ONE parametric build.
 *
 * Ten homes waiting for their city. Every unit in the row is the same factory
 * product, so the geometry is authored once and each site only transforms a
 * cached triangle soup (`kitBench.ts` pattern); the *variation* lives in the
 * dressing (`residential.ts`) and in which windows are lit.
 *
 * ## The one idea that makes this not-LEGO
 *
 * The shell is **one queryable analytic surface** — a closed section swept
 * along the frontage — and every aperture, reveal, window surround, panel seam
 * and end roll is GENERATED FROM that surface rather than positioned next to
 * it (`experience-craft.md` §5.2, `geometry-craft.md` §2.4):
 *
 *   pt(i, j, off) = ring[i][j] + normal[i][j] * off
 *
 *   off > 0   proud applied part (pressed window surround)  -> never coplanar
 *   off = 0   the skin itself
 *   off < 0   reveal / jamb / inner lining                  -> never a gap
 *
 * Skin, holes, reveals, surrounds and lining all come out of ONE welded vertex
 * pool, so the shell is a single closed solid: no pair of parts can z-fight,
 * no jamb can gap, and there is no boolean anywhere. The transverse panel
 * joints are **grooves in the section offset** (`insetAt`), not strips laid on
 * the skin — a strip tangent to its host is exactly the coplanar defect the
 * audit exists to find. The belt rail at the waist is four knots in the
 * profile for the same reason.
 *
 * ## Slot discipline (the audit's clash pass compares mesh PAIRS)
 *
 * `PartWriter` merges one mesh per material slot for the whole park, so two
 * parts in DIFFERENT slots may never interpenetrate — every cross-slot joint
 * here is a butt or carries a reveal. Where a fitting genuinely has to bury
 * itself in the shell (hatch upstand, vent flange, lamp hood, HVAC cradle) it
 * is authored in the `habShell` slot so the bury welds instead of clashing,
 * which is also what those parts are: mouldings of the shell itself.
 *
 * ## Authoring frame (Z-up, per `archkit/meshdata.ts`)
 *
 *   +X  along the arc tangent — the frontage, x in [-L/2, +L/2]
 *   +Y  radially INWARD, toward the park centre — the porch side
 *   +Z  up, z = 0 on the site's `interiorHeight` datum
 *
 * ## The vertical datum stack (metres above the site datum)
 *
 *   0.055  jack pad top          (>= 30 mm proud; the pad beds 10 mm into its
 *                                 OWN sampled ground, not this datum)
 *   0.190  jack screw top
 *   0.250  outrigger underside
 *   0.400  skid top == shell floor-pan underside (a butt, not an overlap)
 *   0.500  interior floor == porch deck top      (HAB_FLOOR_Z)
 *   1.360  belt rail / waist — the widest point of the barrel
 *   2.570  door head            (2.07 m clear)
 *   3.600  crown
 */
import { Vector3 } from 'three'
import type { PartWriter } from '../../archkit/writer'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  TAU,
  aperturedPrism,
  bevel,
  bez,
  cleanMesh,
  densify,
  loft,
  prism,
  prismXZ,
  prismYZ,
  polyOffset,
  revolve,
  rotX,
  roundedRect,
  smoothShade,
  toTriangles,
  translate,
  tubeAlong,
  type SlotParts,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'

// ------------------------------------------------------------------ datums

/** Interior floor and porch deck top. */
export const HAB_FLOOR_Z = 0.5
/** Shell panel thickness — the depth of every window reveal and door jamb. */
const WALL = 0.095
/** Deepest safe inward offset of the section (see `shellGrid`). */
const LINING_MAX = 0.165
/** Quarter-round roll on the two end bulkheads. */
const ROLL_R = 0.13
/** Recessed transverse panel joint: 10 mm deep, 34 mm flat, 13 mm ramps. */
const SEAM_DEPTH = 0.01
const SEAM_FLAT = 0.017
const SEAM_LIP = 0.03
/** Window surround: a 90 mm band pressed 24 mm proud of the skin. */
const FRAME_BAND = 0.09
const FRAME_PROUD = 0.024
/** Longest skin cell along the frontage before the barrel starts to facet. */
const U_STEP = 0.235
/** Step rise (code 165 mm); three of them make the deck. */
const RISE = HAB_FLOOR_Z / 3

// -------------------------------------------------------------- section

const PAN_Y = 2.14
const PAN_Z = 0.38
const FILLET_R = 0.26
const FILLET_CZ = 0.64
const WAIST_Y = 2.746
const RAIL_Y = 2.806
const SIDE_TOP_Y = 2.62
const SIDE_TOP_Z = 2.74
const SHOULDER_Y = 1.92
const SHOULDER_Z = 3.44
const CROWN_Z = 3.6
/** Fillet station the door threshold lands on — solved so it IS the floor. */
const DOOR_SILL_PHI = Math.acos((FILLET_CZ - HAB_FLOOR_Z) / FILLET_R)

export interface HabSection {
  /** the closed (y, z) outline, CCW, y > 0 is the porch side */
  pts: Vec2[]
  /**
   * The same outline with the belt rail flattened back onto the base curve.
   * The INNER LINING is offset from this, never from `pts`: a 60 mm proud
   * rail offset inward by a 95 mm wall folds through itself, and the audit
   * duly reported 3 m² of same-facing coplanar overlap running the length of
   * the hab. Same vertex count, so every reveal still bridges the right pair.
   */
  flat: Vec2[]
  /** outward unit normal per vertex, in the (y, z) plane */
  nrm: Vec2[]
  /** named vertex indices on the +y half */
  mark: Record<string, number>
  n: number
  /** mirror a +y half index onto the -y (guideway) side */
  back(h: number): number
}

/**
 * The half-section, drawn as a real elevation: flat floor pan, bottom fillet,
 * tumblehome flare out to the belt rail at the waist, a side that leans back
 * as it rises, a shoulder, a crowned roof. Every aperture edge in the whole
 * unit lands on one of these knots, which is why no hole ever needs a boolean.
 */
function halfSection(): { pts: Vec2[]; mark: Record<string, number> } {
  const pts: Vec2[] = []
  const mark: Record<string, number> = {}
  const at = (name: string): void => {
    mark[name] = pts.length - 1
  }

  for (let i = 0; i <= 3; i++) pts.push([(PAN_Y * i) / 3, PAN_Z])
  for (const phi of [0.42, DOOR_SILL_PHI, 1.26, Math.PI / 2]) {
    pts.push([PAN_Y + FILLET_R * Math.sin(phi), FILLET_CZ - FILLET_R * Math.cos(phi)])
    if (phi === DOOR_SILL_PHI) at('doorSill')
  }
  for (const p of bez([2.4, 0.64], [2.6, 0.79], [WAIST_Y, 1.03], [WAIST_Y, 1.28], 4, true)) pts.push(p)
  // the belt rail: an integral moulded rub rail with a chamfer either side
  mark.railStart = pts.length
  pts.push([2.792, 1.3])
  pts.push([RAIL_Y, 1.328])
  at('waist')
  pts.push([RAIL_Y, 1.392])
  pts.push([2.792, 1.42])
  mark.railEnd = pts.length - 1
  for (const z of [1.44, 1.58, 1.67, 1.84, 2.02, 2.19, 2.36, 2.45, 2.57, 2.67, SIDE_TOP_Z]) {
    const t = (z - 1.44) / (SIDE_TOP_Z - 1.44)
    pts.push([WAIST_Y - (WAIST_Y - SIDE_TOP_Y) * Math.pow(t, 1.7), z])
    if (z === 1.58) at('frameLo')
    if (z === 1.67) at('winLo')
    if (z === 2.36) at('winHi')
    if (z === 2.45) at('frameHi')
    if (z === 2.57) at('doorHead')
  }
  for (const p of bez([SIDE_TOP_Y, SIDE_TOP_Z], [2.62, 3.14], [2.42, SHOULDER_Z], [SHOULDER_Y, SHOULDER_Z], 4, true)) {
    pts.push(p)
  }
  for (const p of bez([SHOULDER_Y, SHOULDER_Z], [1.42, 3.575], [0.72, CROWN_Z], [0, CROWN_Z], 4, true)) pts.push(p)
  // The last knot before the pole is the crown's flat run. Every roof fitting
  // beds to THIS knot's z, because guessing a height on a curved surface is
  // how a vent ends up floating 8 mm off its own flange.
  mark.crownRail = pts.length - 2
  return { pts, mark }
}

/** Mirror the half outline into a closed CCW loop and solve vertex normals. */
export function habSection(widthScale: number): HabSection {
  const half = halfSection()
  const pts: Vec2[] = half.pts.map(([y, z]) => [y * widthScale, z] as Vec2)
  // the lining outline: the rail knots pulled back onto the base curve
  const flatHalf: Vec2[] = half.pts.map(([y, z], i) =>
    i >= half.mark.railStart && i <= half.mark.railEnd ? ([WAIST_Y * widthScale, z] as Vec2) : ([y * widthScale, z] as Vec2),
  )
  const flat: Vec2[] = [...flatHalf]
  const top = pts.length - 1
  for (let h = top - 1; h >= 1; h--) {
    pts.push([-pts[h][0], pts[h][1]])
    flat.push([-flatHalf[h][0], flatHalf[h][1]])
  }
  const n = pts.length
  const nrm: Vec2[] = []
  for (let j = 0; j < n; j++) {
    let nx = 0
    let ny = 0
    // a CCW loop's outward edge normal is (dz, -dy); average both incidences
    for (const [p, q] of [
      [pts[(j - 1 + n) % n], pts[j]],
      [pts[j], pts[(j + 1) % n]],
    ] as const) {
      const dy = q[0] - p[0]
      const dz = q[1] - p[1]
      const l = Math.hypot(dy, dz) || 1
      nx += dz / l
      ny += -dy / l
    }
    const l = Math.hypot(nx, ny) || 1
    nrm.push([nx / l, ny / l])
  }
  return { pts, flat, nrm, mark: half.mark, n, back: (h: number) => n - h }
}

// -------------------------------------------------------------------- spec

interface HabAperture {
  x0: number
  x1: number
  j0: number
  j1: number
  /** windows get the pressed surround; the door gets the airlock collar */
  frame: boolean
}

export interface PorchSpec {
  /** deck half-width along the frontage */
  halfWidth: number
  /** deck front face, local y */
  front: number
  /** clear opening in the front railing where the steps land */
  stepHalfWidth: number
}

export interface HabUnitSpec {
  /** frontage along the arc tangent */
  length: number
  /** radial scale on the section (1 = the 5.5 m dwelling barrel) */
  widthScale: number
  /** transverse panel joints, local x */
  seams: number[]
  windows: Array<{ x0: number; x1: number }>
  /** an opening on the back (guideway) side — the utility room */
  backWindow?: { x0: number; x1: number }
  door: { x0: number; x1: number }
  /** local x of the hab number plate — must clear every surround band */
  plateX: number
  porch: PorchSpec
  /** the Common Hab is entered, so it also gets an interior floor */
  interiorFloor?: boolean
  /**
   * Dwellings ship a fixed pressure leaf in the collar. The Common Hab leaves
   * the mouth EMPTY so `habInterior.ts` can hang the animated sliding panel
   * there — two door leaves in one opening is the classic way to end up with
   * a second door growing out of the first.
   */
  openDoor?: boolean
}

/**
 * A window the caller fills. The opening is on a LEANING wall, so a flat
 * rectangle would poke through the skin at one end; the pane is therefore
 * handed back as a surface query — `at(u, v, off)` walks the same section the
 * shell was swept from, so glazing, curtains and mullions can never break out
 * of their own reveal.
 */
export interface HabPane {
  /** +1 = porch side, -1 = guideway side */
  side: number
  /** clear opening, metres (for laying out mullions and curtain leaves) */
  width: number
  height: number
  /** u across the opening, v up it, off along the outward normal (0 = skin) */
  at(u: number, v: number, off: number): Vec3
}

/** Everything the caller needs and must never guess. */
export interface HabUnitContract {
  parts: SlotParts
  panes: HabPane[]
  /** local (x, y) of the jack-foot pads (6) */
  jacks: Vec2[]
  /** local (x, y) of the four porch-deck piers */
  piers: Vec2[]
  /** local (x, y) anchors on the deck */
  chairAt: Vec2
  touchAt: Vec2
  /** deck geometry the dressing and the colliders both need */
  deckHalfWidth: number
  deckBack: number
  deckFront: number
  stepHalfWidth: number
  /** local (x, y, z) of the number plate face centre, and its (ny, nz) normal */
  plateAt: Vec3
  plateNormal: Vec2
  /** the collar mouth, so a hung door lands in the opening it belongs to */
  doorMouth: { center: Vec3; width: number; height: number }
  /** local half-extents of the shell for the collider */
  shellHalf: Vec3
}

// -------------------------------------------------------- the shell surface

interface ShellGrid {
  us: number[]
  /** outer skin outline per station */
  rings: Vec2[][]
  /** inner lining outline per station (offset from `sec.flat`, see HabSection) */
  lining: Vec2[][]
  sec: HabSection
}

/**
 * The two end rolls and the recessed panel joints, kept SEPARATE: only the
 * roll is deep enough to fold the belt rail through itself, so only the roll
 * fades the rail out (`shellGrid`). A shared scalar would make every seam
 * groove swallow the rail too.
 */
function insetAt(x: number, length: number, seams: number[]): { roll: number; seam: number } {
  let roll = 0
  for (const d of [x, length - x]) {
    if (d < ROLL_R) roll = Math.max(roll, ROLL_R * (1 - Math.sin(Math.acos(1 - d / ROLL_R))))
  }
  let seam = 0
  for (const s of seams) {
    const a = Math.abs(x - s)
    if (a > SEAM_LIP) continue
    seam = Math.max(seam, a <= SEAM_FLAT ? SEAM_DEPTH : (SEAM_DEPTH * (SEAM_LIP - a)) / (SEAM_LIP - SEAM_FLAT))
  }
  return { roll, seam }
}

/**
 * Station list: the union of every feature edge (end roll, seam lips, aperture
 * and surround bounds), then subdivided so no skin cell exceeds `U_STEP`.
 * Same rule as `meshdata.wallRun` — build the coordinate list FROM the
 * features and every hole lands exactly on a station.
 */
function shellGrid(length: number, seams: number[], widthScale: number, apertures: HabAperture[]): ShellGrid {
  const raw = new Set<number>()
  const add = (x: number): void => {
    raw.add(Math.round(Math.min(length, Math.max(0, x)) * 1e5) / 1e5)
  }
  add(0)
  add(length)
  for (const a of [0, 0.36, 0.72, 1.08, Math.PI / 2]) {
    const d = ROLL_R * (1 - Math.cos(a))
    add(d)
    add(length - d)
  }
  for (const s of seams) for (const o of [-SEAM_LIP, -SEAM_FLAT, SEAM_FLAT, SEAM_LIP]) add(s + o)
  for (const ap of apertures) {
    add(ap.x0)
    add(ap.x1)
    if (ap.frame) {
      add(ap.x0 - FRAME_BAND)
      add(ap.x1 + FRAME_BAND)
    }
  }
  const feature = [...raw].sort((a, b) => a - b)
  const us: number[] = []
  for (let k = 0; k < feature.length - 1; k++) {
    us.push(feature[k])
    const span = feature[k + 1] - feature[k]
    const steps = Math.ceil(span / U_STEP)
    for (let s = 1; s < steps; s++) us.push(feature[k] + (span * s) / steps)
  }
  us.push(feature[feature.length - 1])

  const sec = habSection(widthScale)
  const rings: Vec2[][] = []
  const lining: Vec2[][] = []
  for (const x of us) {
    const { roll, seam } = insetAt(x, length, seams)
    const inset = Math.max(roll, seam)
    // The belt rail DIES INTO the end roll. It has to: a 60 mm proud rail
    // offset inward by more than its own 20 mm chamfer folds through itself,
    // and an n-gon end cap built on a self-intersecting outline ear-clips
    // into overlapping coplanar triangles (0.84 m2 of them, per the audit).
    const fade = Math.min(1, roll / 0.018)
    const base =
      fade > 0
        ? sec.pts.map(
            (p, j) => [p[0] + (sec.flat[j][0] - p[0]) * fade, p[1] + (sec.flat[j][1] - p[1]) * fade] as Vec2,
          )
        : sec.pts
    rings.push(inset > 1e-6 ? polyOffset(base, -inset) : base.map((p) => [...p] as Vec2))
    // The lining's total inset is CLAMPED: the bottom fillet is a 260 mm arc
    // sampled at 22.5 deg, and offsetting it inward past ~175 mm collapses the
    // arc and crosses its own mitres (measured; it showed up as 0.1 m2 of
    // same-facing overlap on the end bulkhead). The clamp only bites inside
    // the end rolls, where it just makes the rolled tip's wall thinner.
    lining.push(polyOffset(sec.flat, -Math.min(inset + WALL, LINING_MAX)))
  }
  return { us, rings, lining, sec }
}

function station(us: number[], x: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < us.length; i++) {
    const d = Math.abs(us[i] - x)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The shell: outer skin, inner lining, aperture reveals, pressed window
 * surrounds and both end bulkheads, welded into ONE closed solid from a single
 * vertex pool. `off` is the entire joinery grammar (see the file header).
 */
function buildShell(apertures: HabAperture[], grid: ShellGrid): MeshData {
  const { us, rings, lining, sec } = grid
  const nu = us.length
  const nv = sec.n
  const verts: Vec3[] = []
  const faces: number[][] = []
  const pool = new Map<string, number>()
  /** `off = -WALL` is the lining outline; anything else offsets the skin. */
  const v = (i: number, j: number, off: number): number => {
    const jj = ((j % nv) + nv) % nv
    const key = `${i}_${jj}_${Math.round(off * 1e4)}`
    const hit = pool.get(key)
    if (hit !== undefined) return hit
    const idx = verts.length
    if (off === -WALL) {
      const q = lining[i][jj]
      verts.push([us[i], q[0], q[1]])
    } else {
      const p = rings[i][jj]
      const n = sec.nrm[jj]
      verts.push([us[i], p[0] + n[0] * off, p[1] + n[1] * off])
    }
    pool.set(key, idx)
    return idx
  }

  const boxes = apertures.map((ap) => ({
    i0: station(us, ap.x0),
    i1: station(us, ap.x1),
    j0: ap.j0,
    j1: ap.j1,
    fi0: station(us, ap.frame ? ap.x0 - FRAME_BAND : ap.x0),
    fi1: station(us, ap.frame ? ap.x1 + FRAME_BAND : ap.x1),
    fj0: ap.frame ? ap.j0 - 1 : ap.j0,
    fj1: ap.frame ? ap.j1 + 1 : ap.j1,
    frame: ap.frame,
  }))
  const covered = (i: number, j: number): boolean =>
    boxes.some((b) => i >= b.fi0 && i < b.fi1 && j >= b.fj0 && j < b.fj1)

  // skin + lining. For a CCW section swept along +X the quad
  // [(i,j) (i,j+1) (i+1,j+1) (i+1,j)] faces OUTWARD; the lining is its reverse.
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv; j++) {
      if (covered(i, j)) continue
      faces.push([v(i, j, 0), v(i, j + 1, 0), v(i + 1, j + 1, 0), v(i + 1, j, 0)])
      faces.push([v(i, j, -WALL), v(i + 1, j, -WALL), v(i + 1, j + 1, -WALL), v(i, j + 1, -WALL)])
    }
  }

  // pressed window surrounds: the ring of cells around each opening, lifted
  // proud, with a return wall down to the skin on the band's outer boundary
  for (const b of boxes) {
    if (!b.frame) continue
    for (let i = b.fi0; i < b.fi1; i++) {
      for (let j = b.fj0; j < b.fj1; j++) {
        if (i >= b.i0 && i < b.i1 && j >= b.j0 && j < b.j1) continue
        faces.push([
          v(i, j, FRAME_PROUD),
          v(i, j + 1, FRAME_PROUD),
          v(i + 1, j + 1, FRAME_PROUD),
          v(i + 1, j, FRAME_PROUD),
        ])
      }
    }
    for (let i = b.fi0; i < b.fi1; i++) {
      faces.push([v(i, b.fj0, 0), v(i, b.fj0, FRAME_PROUD), v(i + 1, b.fj0, FRAME_PROUD), v(i + 1, b.fj0, 0)])
      faces.push([v(i, b.fj1, FRAME_PROUD), v(i, b.fj1, 0), v(i + 1, b.fj1, 0), v(i + 1, b.fj1, FRAME_PROUD)])
    }
    for (let j = b.fj0; j < b.fj1; j++) {
      faces.push([v(b.fi0, j, FRAME_PROUD), v(b.fi0, j, 0), v(b.fi0, j + 1, 0), v(b.fi0, j + 1, FRAME_PROUD)])
      faces.push([v(b.fi1, j, 0), v(b.fi1, j, FRAME_PROUD), v(b.fi1, j + 1, FRAME_PROUD), v(b.fi1, j + 1, 0)])
    }
  }

  // reveals: from the surround face (or the raw skin, at the door) straight
  // through the panel to the lining. This is the jamb, and it is real.
  for (const b of boxes) {
    const outer = b.frame ? FRAME_PROUD : 0
    for (let i = b.i0; i < b.i1; i++) {
      faces.push([v(i, b.j0, outer), v(i, b.j0, -WALL), v(i + 1, b.j0, -WALL), v(i + 1, b.j0, outer)])
      faces.push([v(i, b.j1, -WALL), v(i, b.j1, outer), v(i + 1, b.j1, outer), v(i + 1, b.j1, -WALL)])
    }
    for (let j = b.j0; j < b.j1; j++) {
      faces.push([v(b.i0, j, -WALL), v(b.i0, j, outer), v(b.i0, j + 1, outer), v(b.i0, j + 1, -WALL)])
      faces.push([v(b.i1, j, outer), v(b.i1, j, -WALL), v(b.i1, j + 1, -WALL), v(b.i1, j + 1, outer)])
    }
  }

  // end bulkheads
  for (const [i, sign] of [
    [0, -1],
    [nu - 1, 1],
  ] as const) {
    faces.push(Array.from({ length: nv }, (_, j) => v(i, sign < 0 ? nv - 1 - j : j, 0)))
    faces.push(Array.from({ length: nv }, (_, j) => v(i, sign < 0 ? j : nv - 1 - j, -WALL)))
  }

  const md = MeshData.from(verts, faces)
  cleanMesh(md)
  // 45 deg: the barrel and the fillets read round while the belt rail, the
  // seam grooves, the surrounds and the bulkheads all keep hard creases.
  return smoothShade(md, SMOOTH.shell)
}

/** A point on the shell surface, for anything that must land ON the hab. */
function surfacePoint(grid: ShellGrid, x: number, j: number, off: number): Vec3 {
  const i = station(grid.us, x)
  const jj = ((j % grid.sec.n) + grid.sec.n) % grid.sec.n
  const p = grid.rings[i][jj]
  const n = grid.sec.nrm[jj]
  return [x, p[0] + n[0] * off, p[1] + n[1] * off]
}

// ---------------------------------------------------------------- helpers

/** A closed lathed ring (torus-like section) about +Z — always a solid. */
function lathedRing(profile: Vec2[], segments = 22, smooth = SMOOTH.turned): MeshData {
  const rings: Vec3[][] = []
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * TAU
    rings.push(profile.map(([r, z]) => [r * Math.cos(a), r * Math.sin(a), z] as Vec3))
  }
  return smoothShade(loft(rings, { closeU: true, closeV: true }), smooth)
}

/** Aim a part built about +Z at a section normal, then land it. */
function aim(md: MeshData, n: Vec2, at: Vec3): MeshData {
  rotX(md, Math.atan2(-n[0], n[1]))
  return translate(md, at)
}

/** A turned fastener dome — the detail that says "made". */
function fastener(r = 0.0085): MeshData {
  return revolve(
    [
      [0, 0],
      [r, r * 0.22],
      [r * 0.9, r * 0.62],
      [0, r * 0.72],
    ],
    10,
    { smooth: SMOOTH.tight },
  )
}

function push(parts: Record<string, MeshData[]>, slot: string, ...md: MeshData[]): void {
  const list = parts[slot] ?? (parts[slot] = [])
  for (const m of md) list.push(m)
}

// ----------------------------------------------------------- door collar

/**
 * The airlock collar. Its root ring IS the door aperture's boundary on the
 * curved shell, so there is no seam to mis-fit; it flares over five rings onto
 * a flat vertical mouth, which is what turns a leaning opening in a barrel
 * into a square pressure-door frame (`experience-craft.md` §5.2.3 — solve the
 * termination analytically, then flare onto the host).
 */
function doorCollar(grid: ShellGrid, ap: HabAperture, mouthY: number): { collar: MeshData; mouth: Vec2[] } {
  const i0 = station(grid.us, ap.x0)
  const i1 = station(grid.us, ap.x1)
  const nv = grid.sec.n
  const at = (i: number, j: number): Vec3 => {
    const p = grid.rings[i][j % nv]
    return [grid.us[i], p[0], p[1]]
  }
  const root: Vec3[] = []
  const flat: Vec2[] = []
  const step = (i: number, j: number): void => {
    root.push(at(i, j))
    flat.push([grid.us[i], grid.sec.pts[j % nv][1]])
  }
  for (let i = i0; i < i1; i++) step(i, ap.j0)
  for (let j = ap.j0; j < ap.j1; j++) step(i1, j)
  for (let i = i1; i > i0; i--) step(i, ap.j1)
  for (let j = ap.j1; j > ap.j0; j--) step(i0, j)

  const ease = (t: number): number => t * t * (3 - 2 * t)
  const rings: Vec3[][] = [0, 0.22, 0.5, 0.78, 1].map((t) => {
    const f = ease(t)
    return root.map((p, k) => {
      const m: Vec3 = [flat[k][0], mouthY, flat[k][1]]
      return [p[0] + (m[0] - p[0]) * f, p[1] + (m[1] - p[1]) * f, p[2] + (m[2] - p[2]) * f] as Vec3
    })
  })
  // a bolted rim round the mouth: 55 mm out, then a 50 mm return
  const rim = polyOffset(flat, 0.055)
  rings.push(rim.map(([x, z]) => [x, mouthY, z] as Vec3))
  rings.push(rim.map(([x, z]) => [x, mouthY - 0.05, z] as Vec3))
  return { collar: smoothShade(loft(rings, { closeV: true }), SMOOTH.shell), mouth: flat }
}

// ------------------------------------------------------------ roof services

/**
 * HVAC pack on a moulded cradle, two mushroom vents, a conduit run over the
 * back shoulder, a comms whip and a roof hatch. Anything that has to bury
 * itself in the crown is authored in `habShell` (see the slot note in the
 * header): those parts ARE mouldings of the shell.
 */
function roofServices(grid: ShellGrid, length: number, widthScale: number): Record<string, MeshData[]> {
  const out: Record<string, MeshData[]> = {}
  const sec = grid.sec
  const crownZ = sec.pts[sec.mark.crownRail][1]
  const half = length / 2
  const packX = -half * 0.44

  // cradle rails: bedded in the crown at an exact profile knot, so the run is
  // dead level along x and nothing floats
  const caseW = 1.24
  const caseD = 0.82
  const caseH = 0.4
  const baseZ = crownZ + 0.075
  // Everything bedded into the crown stops INSIDE the 95 mm wall cavity: at
  // the lining plane a downward-facing part face is coplanar with the ceiling
  // and z-fights it (the audit caught exactly that on the hatch upstand).
  const bedZ = crownZ - 0.055
  for (const sy of [-1, 1]) {
    const rail = prismXZ(
      [
        [packX - caseW / 2 + 0.06, bedZ],
        [packX + caseW / 2 - 0.06, bedZ],
        [packX + caseW / 2 - 0.06, baseZ - 0.002],
        [packX - caseW / 2 + 0.06, baseZ - 0.002],
      ],
      sy * (caseD / 2 - 0.16) - 0.05,
      sy * (caseD / 2 - 0.16) + 0.05,
    )
    push(out, 'habShell', rail)
  }
  const body = prism(roundedRect(caseW, caseD, 0.08, 4), baseZ, baseZ + caseH)
  bevel(body, BEVEL.frame, 2)
  translate(body, [packX, 0, 0])
  push(out, 'steel', smoothShade(body, SMOOTH.shell))
  // louvre bank on the porch face: blades stand 3 mm off the case in cheeks
  for (const sx of [-1, 1]) {
    const cheek = prismXZ(
      [
        [packX + sx * 0.47, baseZ + 0.06],
        [packX + sx * 0.5, baseZ + 0.06],
        [packX + sx * 0.5, baseZ + 0.35],
        [packX + sx * 0.47, baseZ + 0.35],
      ],
      caseD / 2 + 0.002,
      caseD / 2 + 0.034,
    )
    push(out, 'aluminum', cheek)
  }
  for (let k = 0; k < 5; k++) {
    const z = baseZ + 0.085 + k * 0.055
    const blade = prismXZ(
      [
        [packX - 0.47, z],
        [packX + 0.47, z],
        [packX + 0.47, z + 0.024],
        [packX - 0.47, z + 0.024],
      ],
      caseD / 2 + 0.003,
      caseD / 2 + 0.03,
    )
    push(out, 'aluminum', blade)
  }
  // fan guard on the guideway face — ring and spokes share the `dark` slot
  // because they genuinely interpenetrate; two slots would be a clash pair
  const guardN: Vec2 = [-1, 0]
  const guardAt: Vec3 = [packX, -(caseD / 2) - 0.002, baseZ + caseH * 0.55]
  push(
    out,
    'dark',
    aim(
      lathedRing([
        [0.15, 0],
        [0.195, 0.004],
        [0.195, 0.03],
        [0.15, 0.034],
      ]),
      guardN,
      guardAt,
    ),
  )
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI
    const spoke = prism(
      [
        [-0.16, -0.011],
        [0.16, -0.011],
        [0.16, 0.011],
        [-0.16, 0.011],
      ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as Vec2),
      0.006,
      0.026,
    )
    push(out, 'dark', aim(spoke, guardN, guardAt))
  }

  // mushroom vents: a moulded flange (shell) under a spun cowl
  for (const vx of [half * 0.12, half * 0.62]) {
    const flange = revolve(
      [
        [0, bedZ],
        [0.13, bedZ],
        [0.13, crownZ + 0.026],
        [0.1, crownZ + 0.04],
        [0, crownZ + 0.04],
      ],
      16,
      { smooth: SMOOTH.turned },
    )
    translate(flange, [vx, 0.2 * widthScale, 0])
    push(out, 'habShell', flange)
    const cowl = revolve(
      [
        [0, 0],
        [0.082, 0],
        [0.082, 0.1],
        [0.148, 0.132],
        [0.15, 0.162],
        [0.088, 0.178],
        [0, 0.184],
      ],
      16,
      { smooth: SMOOTH.turned },
    )
    translate(cowl, [vx, 0.2 * widthScale, crownZ + 0.043])
    push(out, 'aluminum', cowl)
  }

  // Conduit: off the pack, along the crown, over the back shoulder, into a
  // surface-mounted junction box. Every station past the crown is a SURFACE
  // QUERY with a proud offset, and EVERY KNOT of the shoulder is a station —
  // a chord between two widely spaced surface points sags THROUGH a convex
  // shoulder, which is how the first pass got 136 crossings with the skin.
  // Pipe, clips and box all share the `dark` slot because they genuinely
  // interpenetrate; splitting them across slots would be a clash pair.
  const overShoulder = (x: number, j: number, off: number): Vec3 => {
    const p = surfacePoint(grid, x + half, j, off)
    return [p[0] - half, p[1], p[2]]
  }
  const jTop = sec.back(sec.mark.crownRail)
  const jEnd = sec.back(sec.mark.frameHi)
  const runX = (t: number): number => half * (0.16 + 0.22 * t)
  const spine: Vec3[] = [
    [packX + caseW / 2 + 0.004, -0.26 * widthScale, baseZ + 0.05],
    [-half * 0.08, -0.3 * widthScale, crownZ + 0.055],
  ]
  for (let j = jTop; j <= jEnd; j++) spine.push(overShoulder(runX((j - jTop) / (jEnd - jTop)), j, 0.056))
  push(out, 'dark', smoothShade(tubeAlong(spine, roundedRect(0.05, 0.042, 0.013, 3), { cap: true }), SMOOTH.turned))

  const boxJ = jEnd
  const boxN = sec.nrm[boxJ]
  const boxSeat = overShoulder(runX(1), boxJ, 0.014)
  const junction = prism(roundedRect(0.3, 0.26, 0.04, 2), 0, 0.14)
  bevel(junction, BEVEL.carcass, 2)
  push(out, 'dark', aim(junction, boxN, boxSeat))
  for (const t of [0.32, 0.68]) {
    const a = spine[0]
    const b = spine[1]
    const clip = prism(roundedRect(0.1, 0.085, 0.016, 2), crownZ + 0.002, crownZ + 0.046)
    translate(clip, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0])
    push(out, 'dark', clip)
  }

  // comms whip on a turned insulator, over a moulded base
  const whipX = half * 0.66
  const boss = revolve(
    [
      [0, bedZ],
      [0.1, bedZ],
      [0.1, crownZ + 0.022],
      [0.075, crownZ + 0.034],
      [0, crownZ + 0.034],
    ],
    14,
    { smooth: SMOOTH.turned },
  )
  translate(boss, [whipX, -0.16 * widthScale, 0])
  push(out, 'habShell', boss)
  const insulator = revolve(
    [
      [0, 0],
      [0.062, 0],
      [0.062, 0.042],
      [0.044, 0.052],
      [0.044, 0.1],
      [0, 0.104],
    ],
    14,
    { smooth: SMOOTH.turned },
  )
  translate(insulator, [whipX, -0.16 * widthScale, crownZ + 0.036])
  push(out, 'dark', insulator)
  const whip = revolve(
    [
      [0, 0],
      [0.015, 0.018],
      [0.011, 1.1],
      [0.005, 1.95],
      [0, 2.0],
    ],
    8,
    { smooth: SMOOTH.turned },
  )
  translate(whip, [whipX, -0.16 * widthScale, crownZ + 0.143])
  push(out, 'aluminum', whip)

  // roof hatch: a moulded upstand with a domed lid on two lugs
  const hatchX = -half * 0.06
  const hatchY = 0.42 * widthScale
  const upstand = prism(roundedRect(0.78, 0.66, 0.1, 4), bedZ, crownZ + 0.07)
  bevel(upstand, BEVEL.carcass, 2)
  translate(upstand, [hatchX, hatchY, 0])
  push(out, 'habShell', upstand)
  const lidPoly = roundedRect(0.7, 0.58, 0.09, 4)
  const lid = loft(
    [
      [-0.012, 0],
      [0, 0.016],
      [-0.006, 0.05],
      [-0.055, 0.072],
    ].map(([off, dz]) =>
      polyOffset(lidPoly, off).map(([x, y]) => [x + hatchX, y + hatchY, crownZ + 0.072 + dz] as Vec3),
    ),
    { closeV: true, capStart: true, capEnd: true },
  )
  push(out, 'aluminum', smoothShade(lid, SMOOTH.shell))
  const grab = tubeAlong(
    [
      [hatchX - 0.15, hatchY, crownZ + 0.19],
      [hatchX - 0.11, hatchY, crownZ + 0.208],
      [hatchX + 0.11, hatchY, crownZ + 0.208],
      [hatchX + 0.15, hatchY, crownZ + 0.19],
    ],
    roundedRect(0.026, 0.024, 0.008, 2),
    { cap: true },
  )
  push(out, 'dark', smoothShade(grab, SMOOTH.turned))
  return out
}

// ------------------------------------------------------------- foundation

/** Skids and outriggers. Jack feet are placed per-site (they need the ground). */
function foundation(length: number, widthScale: number): { parts: Record<string, MeshData[]>; jacks: Vec2[] } {
  const parts: Record<string, MeshData[]> = {}
  const halfX = length / 2 - 0.16
  const skidY = 1.6 * widthScale
  const outY = 2.2 * widthScale

  for (const sy of [-1, 1]) {
    const y = sy * skidY
    // fabricated I-section, drawn as a real section
    const sec: Vec2[] = [
      [y - 0.088, 0.2],
      [y + 0.088, 0.2],
      [y + 0.088, 0.23],
      [y + 0.022, 0.246],
      [y + 0.022, 0.314],
      [y + 0.088, 0.33],
      [y + 0.088, 0.378],
      [y - 0.088, 0.378],
      [y - 0.088, 0.33],
      [y - 0.022, 0.314],
      [y - 0.022, 0.246],
      [y - 0.088, 0.23],
    ]
    push(parts, 'steel', smoothShade(prismYZ(sec, -halfX, halfX), SMOOTH.moulded))
  }
  const jackX = [-halfX + 0.4, 0, halfX - 0.4]
  for (const x of jackX) {
    push(
      parts,
      'steel',
      smoothShade(
        prismXZ(
          [
            [x - 0.068, 0.23],
            [x + 0.068, 0.23],
            [x + 0.068, 0.35],
            [x - 0.068, 0.35],
          ],
          -outY - 0.1,
          outY + 0.1,
        ),
        SMOOTH.moulded,
      ),
    )
  }
  // cross braces are WELDED to the skid webs, so they share the skid's slot —
  // in a different slot the same weld reads to the audit as a solid clash
  for (const x of [-halfX * 0.52, halfX * 0.52]) {
    push(
      parts,
      'steel',
      prismXZ(
        [
          [x - 0.048, 0.252],
          [x + 0.048, 0.252],
          [x + 0.048, 0.328],
          [x - 0.048, 0.328],
        ],
        -skidY,
        skidY,
      ),
    )
  }
  const jacks: Vec2[] = []
  for (const x of jackX) for (const sy of [-1, 1]) jacks.push([x, sy * outY])
  return { parts, jacks }
}

// ------------------------------------------------------------------ porch

/**
 * Deck, perimeter rim beam, real boards, tapered posts, tension-rod railing.
 * The boards are BOARDS — crowned face, relieved underside, 8 mm authored gaps
 * — because a porch deck will not survive being one slab (`geometry-craft.md`
 * §5, "surfaces are geometry too"). Piers and the step block need the local
 * ground and are written per-site.
 */
function porch(
  spec: HabUnitSpec,
  faceY: number,
  bulgeY: number,
  doorBay: { x0: number; x1: number; clear: number },
): { parts: Record<string, MeshData[]>; piers: Vec2[]; railBack: number } {
  const parts: Record<string, MeshData[]> = {}
  const p = spec.porch
  const y0 = faceY + 0.015 // expansion gap against the shell
  const y1 = p.front
  const dz = HAB_FLOOR_Z
  const hw = p.halfWidth
  const cy = (y0 + y1) / 2
  // The deck runs UNDER the barrel's overhang, but the railing cannot: the
  // shell bulges out to `bulgeY` at the waist, and a post at the deck's back
  // edge stands inside it. The rail therefore starts clear of the bulge.
  const railBack = bulgeY + 0.09

  // rim beam as a real through-cut frame: the boards live INSIDE the opening,
  // so no board is ever buried in the beam.
  const outer = roundedRect(hw * 2, y1 - y0, 0.17, 3).map(([x, y]) => [x, y + cy] as Vec2)
  const innerPoly = polyOffset(outer, -0.13)
  push(parts, 'steel', aperturedPrism(outer, innerPoly, dz - 0.19, dz - 0.004, 0.012, 2))

  const bx = hw - 0.135
  const by0 = y0 + 0.135
  const by1 = y1 - 0.135
  for (const jy of [by0 + 0.16, cy, by1 - 0.16]) {
    push(
      parts,
      'dark',
      prismXZ(
        [
          [-bx + 0.02, dz - 0.15],
          [bx - 0.02, dz - 0.15],
          [bx - 0.02, dz - 0.0385],
          [-bx + 0.02, dz - 0.0385],
        ],
        jy - 0.045,
        jy + 0.045,
      ),
    )
  }
  const pitch = 0.208
  const count = Math.max(4, Math.floor((bx * 2 - 0.004) / pitch))
  const span = count * pitch - 0.008
  for (let k = 0; k < count; k++) {
    const cx = -span / 2 + pitch * (k + 0.5)
    const h = 0.1
    const sec: Vec2[] = [
      [cx - h, dz - 0.0105],
      [cx - h + 0.005, dz - 0.004],
      [cx - 0.05, dz - 0.001],
      [cx, dz],
      [cx + 0.05, dz - 0.001],
      [cx + h - 0.005, dz - 0.004],
      [cx + h, dz - 0.0105],
      [cx + h - 0.006, dz - 0.034],
      [cx + 0.05, dz - 0.0365],
      [cx - 0.05, dz - 0.0365],
      [cx - h + 0.006, dz - 0.034],
    ]
    // boards in the door bay stop clear of the airlock collar, which flares
    // down onto the deck plane — the threshold plate fills that strip
    const inBay = cx + h > doorBay.x0 - 0.02 && cx - h < doorBay.x1 + 0.02
    push(parts, 'deck', smoothShade(prismXZ(sec, inBay ? doorBay.clear : by0 + 0.002, by1 - 0.002), 30))
  }

  // posts: tapered, on recessed base plates; the top rail lands ON them
  const postTop = dz + 1.048
  const px = hw - 0.145
  const stepX = p.stepHalfWidth + 0.1
  const rows: Array<[number, number]> = [
    [-px, railBack],
    [-px, y1 - 0.16],
    [px, railBack],
    [px, y1 - 0.16],
    [-stepX, y1 - 0.16],
    [stepX, y1 - 0.16],
  ]
  for (const [x, y] of rows) {
    const plate = prism(roundedRect(0.15, 0.15, 0.02, 2), dz + 0.002, dz + 0.022)
    bevel(plate, BEVEL.hardware, 2)
    translate(plate, [x, y, 0])
    push(parts, 'steel', plate)
    const base = roundedRect(0.09, 0.09, 0.02, 2)
    const rings: Array<[number, number]> = [
      [0, 0],
      [0.12, -0.005],
      [0.86, -0.014],
      [1, -0.018],
    ]
    push(
      parts,
      'orange',
      smoothShade(
        loft(
          rings.map(([t, off]) =>
            polyOffset(base, off).map(
              ([bxp, byp]) => [bxp + x, byp + y, dz + 0.024 + t * (postTop - dz - 0.024)] as Vec3,
            ),
          ),
          { closeV: true, capStart: true, capEnd: true },
        ),
        SMOOTH.moulded,
      ),
    )
  }
  // ONE mitred run per side (side + front return). Two runs meeting at a
  // corner put two capped tube ends inside each other — the audit reported
  // that as an 8.9 cm2 same-facing pair on the first pass.
  const runs: Vec2[][] = [
    [
      [-px, railBack],
      [-px, y1 - 0.16],
      [-stepX, y1 - 0.16],
    ],
    [
      [px, railBack],
      [px, y1 - 0.16],
      [stepX, y1 - 0.16],
    ],
  ]
  for (const run of runs) {
    const path = densify(
      run.map(([x, y]) => [x, y, postTop + 0.02] as Vec3),
      0.06,
    )
    push(
      parts,
      'orangeTop',
      smoothShade(
        tubeAlong(
          path,
          [
            [-0.03, -0.018],
            [0.03, -0.018],
            [0.034, 0.006],
            [0.026, 0.026],
            [0, 0.032],
            [-0.026, 0.026],
            [-0.034, 0.006],
          ],
          { up: [0, 0, 1], cap: true, miter: true },
        ),
        SMOOTH.turned,
      ),
    )
    for (let k = 0; k < 5; k++) {
      const z = dz + 0.19 + k * 0.19
      push(
        parts,
        'orange',
        smoothShade(
          tubeAlong(
            densify(
              run.map(([x, y]) => [x, y, z] as Vec3),
              0.04,
            ),
            roundedRect(0.013, 0.013, 0.005, 2),
            { up: [0, 0, 1], cap: true, miter: true },
          ),
          SMOOTH.turned,
        ),
      )
    }
  }
  const piers: Vec2[] = [
    [-hw + 0.34, y0 + 0.3],
    [hw - 0.34, y0 + 0.3],
    [-hw + 0.34, y1 - 0.3],
    [hw - 0.34, y1 - 0.3],
  ]
  return { parts, piers, railBack }
}

// -------------------------------------------------------------- the build

/**
 * Build one hab unit in its local frame. Every dimension traces to the datum
 * stack in the file header; nothing is guessed by the caller.
 */
export function buildHabUnit(spec: HabUnitSpec): HabUnitContract {
  const sec0 = habSection(spec.widthScale)
  const m = sec0.mark
  const half = spec.length / 2
  const shift = (x: number): number => x + half

  const apertures: HabAperture[] = spec.windows.map((w) => ({
    x0: shift(w.x0),
    x1: shift(w.x1),
    j0: m.winLo,
    j1: m.winHi,
    frame: true,
  }))
  if (spec.backWindow) {
    apertures.push({
      x0: shift(spec.backWindow.x0),
      x1: shift(spec.backWindow.x1),
      j0: sec0.back(m.winHi),
      j1: sec0.back(m.winLo),
      frame: true,
    })
  }
  const door: HabAperture = {
    x0: shift(spec.door.x0),
    x1: shift(spec.door.x1),
    j0: m.doorSill,
    j1: m.doorHead,
    frame: false,
  }
  apertures.push(door)

  const seams = spec.seams.map(shift)
  const grid = shellGrid(spec.length, seams, spec.widthScale, apertures)
  const parts: Record<string, MeshData[]> = {}
  push(parts, 'habShell', translate(buildShell(apertures, grid), [-half, 0, 0]))

  // ---- door: collar, leaf, vision port, lever, kick band, threshold
  const mouthY = RAIL_Y * spec.widthScale + 0.115
  const { collar, mouth } = doorCollar(grid, door, mouthY)
  push(parts, 'habShell', translate(collar, [-half, 0, 0]))

  const doorCx = (spec.door.x0 + spec.door.x1) / 2
  const sillZ = sec0.pts[m.doorSill][1]
  const headZ = sec0.pts[m.doorHead][1]
  const leafW = spec.door.x1 - spec.door.x0 - 0.07
  const leafH = headZ - sillZ - 0.07
  const leafY = mouthY - 0.068
  const leafPoly = roundedRect(leafW, leafH, 0.075, 3).map(([x, z]) => [x + doorCx, z + (sillZ + headZ) / 2] as Vec2)
  /** the collar mouth is a flat vertical plane: its normal is straight +y */
  const frontN: Vec2 = [1, 0]
  const portZ = sillZ + leafH * 0.72
  if (!spec.openDoor) {
  push(
    parts,
    'aluminum',
    smoothShade(
      loft(
        [
          [-0.05, -0.004],
          [-0.012, 0],
          [0, 0.03],
          [-0.012, 0.06],
          [-0.05, 0.064],
        ].map(([off, dy]) => polyOffset(leafPoly, off).map(([x, z]) => [x, leafY + dy, z] as Vec3)),
        { closeV: true, capStart: true, capEnd: true },
      ),
      SMOOTH.shell,
    ),
  )
  // glazed vision port with a retaining ring OVER it — every cross-slot joint
  // in the door carries a 2 mm reveal rather than butting exactly, because an
  // exact butt between two merged slot meshes reads as a clash
  push(
    parts,
    'darkGlass',
    aim(
      revolve(
        [
          [0, 0],
          [0.15, 0],
          [0.15, 0.01],
          [0, 0.01],
        ],
        22,
        { smooth: SMOOTH.turned },
      ),
      frontN,
      [doorCx, leafY + 0.066, portZ],
    ),
  )
  push(
    parts,
    'dark',
    aim(
      lathedRing([
        [0.108, 0],
        [0.158, 0.004],
        [0.162, 0.03],
        [0.148, 0.044],
        [0.108, 0.046],
      ]),
      frontN,
      [doorCx, leafY + 0.078, portZ],
    ),
  )
  const leverZ = sillZ + leafH * 0.42
  for (const sz of [-1, 1]) {
    push(
      parts,
      'dark',
      aim(
        revolve(
          [
            [0, 0],
            [0.021, 0],
            [0.021, 0.036],
            [0.014, 0.044],
            [0, 0.046],
          ],
          12,
          { smooth: SMOOTH.turned },
        ),
        frontN,
        [doorCx + leafW / 2 - 0.15, leafY + 0.066, leverZ + sz * 0.11],
      ),
    )
  }
  push(
    parts,
    'aluminum',
    smoothShade(
      tubeAlong(
        [
          [doorCx + leafW / 2 - 0.15, leafY + 0.108, leverZ - 0.135],
          [doorCx + leafW / 2 - 0.15, leafY + 0.108, leverZ + 0.135],
        ],
        roundedRect(0.034, 0.026, 0.01, 3),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  push(
    parts,
    'orange',
    loft(
      [
        [-0.004, 0],
        [0, 0.008],
        [-0.004, 0.016],
      ].map(([off, dy]) =>
        polyOffset(
          roundedRect(leafW - 0.11, 0.2, 0.02, 2).map(([x, z]) => [x + doorCx, z + sillZ + 0.17] as Vec2),
          off,
        ).map(([x, z]) => [x, leafY + 0.066 + dy, z] as Vec3),
      ),
      { closeV: true, capStart: true, capEnd: true },
    ),
  )
  }
  // threshold plate: it lies on the DECK in front of the collar mouth, not
  // inside it — the collar's flare already owns the sill plane
  push(
    parts,
    'steelEdge',
    smoothShade(
      prismXZ(
        [
          [doorCx - leafW / 2 - 0.09, HAB_FLOOR_Z + 0.002],
          [doorCx + leafW / 2 + 0.09, HAB_FLOOR_Z + 0.002],
          [doorCx + leafW / 2 + 0.09, HAB_FLOOR_Z + 0.012],
          [doorCx + leafW / 2 + 0.072, HAB_FLOOR_Z + 0.022],
          [doorCx - leafW / 2 - 0.072, HAB_FLOOR_Z + 0.022],
          [doorCx - leafW / 2 - 0.09, HAB_FLOOR_Z + 0.012],
        ],
        mouthY + 0.014,
        mouthY + 0.24,
      ),
      SMOOTH.moulded,
    ),
  )
  for (let k = 0; k < mouth.length; k += 3) {
    const [rx, rz] = polyOffset(mouth, 0.03)[k]
    push(parts, 'aluminum', aim(fastener(0.0075), frontN, [rx - half, mouthY + 0.0015, rz]))
  }

  // ---- porch light: a lens recessed in a moulded hood, beside the door
  const lampJ = m.frameHi
  const lampN = sec0.nrm[lampJ]
  const lampP = surfacePoint(grid, shift(spec.door.x1) + 0.36, lampJ, -0.02)
  const lampBase: Vec3 = [lampP[0] - half, lampP[1], lampP[2]]
  push(
    parts,
    'habShell',
    aim(
      revolve(
        [
          [0, 0],
          [0.128, 0],
          [0.128, 0.072],
          [0.09, 0.104],
          [0.088, 0.078],
          [0, 0.076],
        ],
        16,
        { smooth: SMOOTH.turned },
      ),
      lampN,
      lampBase,
    ),
  )
  push(
    parts,
    'utilityLight',
    aim(
      revolve(
        [
          [0, 0],
          [0.06, 0],
          [0.057, 0.02],
          [0, 0.024],
        ],
        16,
        { smooth: SMOOTH.turned },
      ),
      lampN,
      // sits in the hood's mouth, 2 mm proud of its face (0.076) and well
      // inside its rim (0.104): a recessed lens with a real bezel
      [lampBase[0], lampBase[1] + lampN[0] * 0.078, lampBase[2] + lampN[1] * 0.078],
    ),
  )

  // ---- belt-rail rivets along the frontage (porch side only)
  const railJ = m.waist
  const railN = sec0.nrm[railJ]
  for (let x = -half + 0.44; x <= half - 0.44; x += 0.315) {
    const p = surfacePoint(grid, shift(x), railJ, 0.003)
    push(parts, 'aluminum', aim(fastener(), railN, [p[0] - half, p[1], p[2]]))
  }

  // ---- roof + foundation
  for (const [slot, list] of Object.entries(roofServices(grid, spec.length, spec.widthScale))) {
    push(parts, slot, ...list)
  }
  const base = foundation(spec.length, spec.widthScale)
  for (const [slot, list] of Object.entries(base.parts)) push(parts, slot, ...list)

  // ---- interior floor (the Common Hab is entered)
  if (spec.interiorFloor) {
    // Where the LINING crosses the slab's own z range, on the porch side.
    // The barrel tucks IN below the waist, so the slab's BOTTOM corner is the
    // binding one — measuring at floor level alone buried the slab edge in
    // the wall (254 crossings). Taking a min over knots is also wrong: it
    // picks the centre-line knot and gives a 1 m room.
    // measured against the lining AT A SEAM (the deepest it ever goes), so a
    // panel joint can never clip the slab's edge
    const inner = polyOffset(sec0.flat, -(WALL + SEAM_DEPTH))
    const halfAt = (z: number): number => {
      let best = 1
      for (let j = 0; j < inner.length; j++) {
        const a = inner[j]
        const b = inner[(j + 1) % inner.length]
        if (a[0] <= 0 || b[0] <= 0) continue
        if ((a[1] - z) * (b[1] - z) > 0) continue
        const t = (z - a[1]) / (b[1] - a[1] || 1)
        best = Math.max(best, a[0] + (b[0] - a[0]) * t)
      }
      return best
    }
    // The slab is a floor COVERING, not a structural floor: the lining pan
    // already is the floor. It sits 5 mm over the pan's highest point (inside
    // a seam groove, which pushes the lining 10 mm in) and stops 300 mm short
    // of the wall, because the lining's tumblehome turns in fast enough that
    // chasing it with an edge tolerance clips the slab at every panel joint.
    const slabBase = PAN_Z + WALL + SEAM_DEPTH + 0.005
    const floorHalf = halfAt(slabBase) - 0.05
    push(
      parts,
      'deck',
      prismXZ(
        [
          [-half + ROLL_R + WALL + 0.01, slabBase],
          [half - ROLL_R - WALL - 0.01, slabBase],
          [half - ROLL_R - WALL - 0.01, HAB_FLOOR_Z],
          [-half + ROLL_R + WALL + 0.01, HAB_FLOOR_Z],
        ],
        -floorHalf,
        floorHalf,
      ),
    )
  }

  // ---- porch
  const shellFaceY = sec0.pts[m.doorSill][0]
  const deckBuild = porch(spec, shellFaceY, RAIL_Y * spec.widthScale, {
    x0: spec.door.x0 - 0.08,
    x1: spec.door.x1 + 0.08,
    clear: mouthY + 0.012,
  })
  for (const [slot, list] of Object.entries(deckBuild.parts)) push(parts, slot, ...list)

  // ---- number plate: a stood-off bezel carrying an edge-lit acrylic face.
  // The numerals themselves are one atlas mesh laid by the caller, 4 mm proud
  // of the lit face, so a glowing border shows all round it.
  const plateJ = m.frameLo
  const plateN = sec0.nrm[plateJ]
  const plateRoot = surfacePoint(grid, shift(spec.plateX), plateJ, -0.02)
  const plateSeat: Vec3 = [plateRoot[0] - half, plateRoot[1], plateRoot[2]]
  for (const sx of [-1, 1]) {
    const rib = prism(roundedRect(0.05, 0.13, 0.014, 2), 0, 0.046)
    translate(rib, [sx * 0.17, 0, 0])
    push(parts, 'habShell', aim(rib, plateN, [...plateSeat] as Vec3))
  }
  const bezelPlate = prism(roundedRect(0.52, 0.2, 0.024, 3), 0.048, 0.07)
  bevel(bezelPlate, BEVEL.panel, 2)
  push(parts, 'dark', aim(bezelPlate, plateN, [...plateSeat] as Vec3))
  push(
    parts,
    'signageGlow',
    aim(prism(roundedRect(0.47, 0.15, 0.018, 3), 0.072, 0.078), plateN, [...plateSeat] as Vec3),
  )
  const plateAt: Vec3 = [
    plateSeat[0],
    plateSeat[1] + plateN[0] * 0.082,
    plateSeat[2] + plateN[1] * 0.082,
  ]

  // ---- panes: the arc's signature at dusk. Handed back as a query on the
  // same section the shell was swept from, so the caller only decides LIT.
  const panes: HabPane[] = apertures
    .filter((ap) => ap.frame)
    .map((ap) => {
      const x0 = ap.x0 - half
      const x1 = ap.x1 - half
      // cumulative arc length across the opening, for an even v parameter
      const run: number[] = [0]
      for (let j = ap.j0; j < ap.j1; j++) {
        const a = sec0.pts[j]
        const b = sec0.pts[j + 1]
        run.push(run[run.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
      }
      const total = run[run.length - 1]
      const side = Math.sign(sec0.pts[ap.j0][0]) || 1
      return {
        side,
        width: x1 - x0,
        height: total,
        at(u: number, vRaw: number, off: number): Vec3 {
          // v runs bottom-to-top of the opening on the porch side; mirror it on
          // the back so both windows read "up" the same way
          const v = side > 0 ? vRaw : 1 - vRaw
          const target = v * total
          let k = 0
          while (k < run.length - 2 && run[k + 1] < target) k++
          const t = (target - run[k]) / (run[k + 1] - run[k] || 1)
          const a = sec0.pts[ap.j0 + k]
          const b = sec0.pts[ap.j0 + k + 1]
          const na = sec0.nrm[ap.j0 + k]
          const nb = sec0.nrm[ap.j0 + k + 1]
          const ny = na[0] + (nb[0] - na[0]) * t
          const nz = na[1] + (nb[1] - na[1]) * t
          const l = Math.hypot(ny, nz) || 1
          return [
            x0 + (x1 - x0) * u,
            a[0] + (b[0] - a[0]) * t + (ny / l) * off,
            a[1] + (b[1] - a[1]) * t + (nz / l) * off,
          ]
        },
      }
    })

  const cleaned: SlotParts = {}
  for (const [slot, list] of Object.entries(parts)) cleaned[slot] = list.map((md) => cleanMesh(md))

  let maxY = 0
  for (const [y] of sec0.pts) maxY = Math.max(maxY, Math.abs(y))
  return {
    parts: cleaned,
    panes,
    jacks: base.jacks,
    piers: deckBuild.piers,
    chairAt: [spec.door.x0 - 0.92, spec.porch.front - 0.82],
    touchAt: [spec.door.x1 + 1.0, spec.porch.front - 0.72],
    deckHalfWidth: spec.porch.halfWidth,
    deckBack: shellFaceY + 0.015,
    deckFront: spec.porch.front,
    stepHalfWidth: spec.porch.stepHalfWidth,
    plateAt,
    plateNormal: plateN,
    doorMouth: {
      center: [doorCx, mouthY, (sillZ + headZ) / 2],
      width: spec.door.x1 - spec.door.x0,
      height: headZ - sillZ,
    },
    shellHalf: [half, CROWN_Z / 2, maxY],
  }
}

// ------------------------------------------------ per-site ground contact

/**
 * A jack foot: bedded pad, threaded screw, clevis into the outrigger. Built
 * per site against the LOCAL ground so the row reads as levelled equipment
 * rather than ten copies floating at one height (the screws really do differ).
 */
export function buildJackFoot(groundDrop: number): SlotParts {
  const padTop = -groundDrop + 0.055
  const cast = prism(roundedRect(0.3, 0.3, 0.06, 3), padTop - 0.067, padTop)
  bevel(cast, BEVEL.carcass, 2)
  const screw = revolve(
    [
      [0, padTop + 0.002],
      [0.058, padTop + 0.002],
      [0.058, padTop + 0.024],
      [0.034, padTop + 0.03],
      [0.034, 0.176],
      [0.052, 0.182],
      [0, 0.188],
    ],
    14,
    { smooth: SMOOTH.turned },
  )
  const clevis = prism(roundedRect(0.125, 0.115, 0.02, 2), 0.19, 0.268)
  bevel(clevis, BEVEL.hardware, 2)
  return { cast: [cleanMesh(cast)], dark: [cleanMesh(screw)], steel: [cleanMesh(clevis)] }
}

/** A cast pier under a porch-deck corner. */
export function buildPier(groundDrop: number, topZ: number): SlotParts {
  const pier = prism(roundedRect(0.26, 0.26, 0.03, 3), -groundDrop - 0.05, topZ)
  bevel(pier, BEVEL.carcass, 2)
  return { cast: [cleanMesh(pier)] }
}

/**
 * The precast step block: one moulded solid with two chamfered nosings, cast
 * to the local grade so no tread ever floats and no riser is ever buried.
 */
export function buildStepBlock(groundDrop: number, front: number, halfWidth: number): SlotParts {
  const y0 = front + 0.01
  const profile: Vec2[] = [
    [y0, -groundDrop - 0.06],
    [y0 + 0.68, -groundDrop - 0.06],
    [y0 + 0.68, RISE - 0.011],
    [y0 + 0.669, RISE],
    [y0 + 0.331, RISE],
    [y0 + 0.32, RISE + 0.011],
    [y0 + 0.32, 2 * RISE - 0.011],
    [y0 + 0.309, 2 * RISE],
    [y0, 2 * RISE],
  ]
  const block = prismYZ(profile, -halfWidth, halfWidth)
  return { cast: [cleanMesh(smoothShade(block, SMOOTH.cast))] }
}

// -------------------------------------------------------------- placement

export interface Soup {
  slot: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
}

/** Freeze a part list into transformable triangle soups (kitBench pattern). */
export function toSoups(parts: SlotParts): Soup[] {
  const soups: Soup[] = []
  for (const [slot, value] of Object.entries(parts)) {
    if (!value) continue
    const list = Array.isArray(value) ? value : [value]
    for (const md of list) {
      if (!md) continue
      const t = toTriangles(md)
      if (t.positions.length === 0) continue
      soups.push({
        slot,
        positions: Float32Array.from(t.positions),
        normals: Float32Array.from(t.normals),
        uvs: Float32Array.from(t.uvs),
      })
    }
  }
  return soups
}

/** Place frozen soups: yaw about +Y with +Z forward, then translate. */
export function writeSoups(writer: PartWriter, soups: Soup[], center: Vector3, yaw: number): void {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  for (const s of soups) {
    const p = new Float32Array(s.positions.length)
    const n = new Float32Array(s.normals.length)
    for (let i = 0; i < s.positions.length; i += 3) {
      const x = s.positions[i]
      const y = s.positions[i + 1]
      const z = s.positions[i + 2]
      p[i] = center.x + x * cos + z * sin
      p[i + 1] = center.y + y
      p[i + 2] = center.z - x * sin + z * cos
      const nx = s.normals[i]
      const nz = s.normals[i + 2]
      n[i] = nx * cos + nz * sin
      n[i + 1] = s.normals[i + 1]
      n[i + 2] = -nx * sin + nz * cos
    }
    writer.raw(s.slot, p, n, s.uvs)
  }
}

/**
 * Local (x, y, z) in the Z-up authoring frame -> world. Authored +Y (the porch
 * direction) becomes world local +Z, which the site yaw then rotates onto the
 * inward radial — the same convention `kit.offset()` uses.
 */
export function habLocalToWorld(center: Vector3, yaw: number, x: number, y: number, z: number): Vector3 {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return new Vector3(center.x + x * cos + y * sin, center.y + z, center.z - x * sin + y * cos)
}
