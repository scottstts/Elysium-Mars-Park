import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, PlaneGeometry, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { positionLocal, sin, time, uv, vec3 } from 'three/tsl'
import { bench } from '../../archkit/kit'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  annularPrism,
  aperturedPrism,
  bevel,
  ccw,
  circle,
  cleanMesh,
  loft,
  polyOffset,
  prism,
  prismXZ,
  revolve,
  rotX,
  rotateZ,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  writeInto,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import { heroGlass, signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { PAVE, pavedSignedDistance } from '../pavingPlan'
import { AMPHITHEATER, FIRST_TREE, OVERLOOK_LOUNGE, PADS, PLAYGROUND } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * THE LEISURE HEART — the assembly bowl, the Overlook Lounge drum, the First
 * Tree's soil ring and the playground.
 *
 * Authoring model (`dev_docs/systems/archkit.md`): every silhouette here is a
 * **profile swept along a plan path**, never a stack of boxes. Everything is
 * authored in the archkit's Z-up frame, where the plan is `(worldX, worldZ)`
 * and `z` is height, so a swept section reads `(outward, up)` and
 * `toTriangles()` converts to the Y-up world once, at emit.
 *
 * Three layout facts this file is built around, and must keep:
 *
 *  - The seating arc is centred on the **stage axis** — the bearing from the
 *    bowl centre to the stage pad, reversed — which is also (within 3 deg) the
 *    frozen sun's bearing. The audience gets the stage, the west glass and the
 *    low sun in one look. Centring on +X, the previous fix for a worse bug,
 *    left the stage 23 deg off the seating axis.
 *  - The rows RIDE the authored dish in `interiorHeight`. Deck heights are
 *    solved from it at build time and never hardcoded.
 *  - `amphitheater-spur` paving runs from the plaza right down into the
 *    orchestra. That ribbon IS the bowl's vomitory ramp: terraces are trimmed
 *    off it with `pavedSignedDistance`, so the corridor stays open at grade and
 *    nothing of ours is ever laid on a slab that is not ours.
 */
export function buildLeisure(services: DistrictServices): void {
  buildAmphitheater(services)
  buildOverlook(services)
  buildPlayground(services)
  buildFirstTreePlaza(services)
}

// --------------------------------------------------------------- toolkit ----

const TAU = Math.PI * 2

/** A part queued against its material slot — slots are decided per part. */
type Part = [string, MeshData]

function emit(services: DistrictServices, parts: Part[]): void {
  for (const [slot, part] of parts) writeInto(services.writer, slot, cleanMesh(part))
}

/** Plan path station in the Z-up authoring frame: `[worldX, worldZ, height]`. */
function arcPath(
  cx: number,
  cz: number,
  radius: number,
  a0: number,
  a1: number,
  height: number,
  maxStep = 0.6,
): Vec3[] {
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) * radius) / maxStep))
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, height])
  }
  return out
}

interface SweepOpts {
  smooth?: number
  /** close the loop (path must NOT repeat its first point) */
  closed?: boolean
  /** roll the end stations in by this fraction, so a free end reads moulded */
  endInset?: number
}

/**
 * Sweep a closed section along a plan path. The section is `(outward, up)`:
 * for a path running counter-clockwise in plan, `cross(tangent, up)` points
 * radially OUT, which is the convention every section in this file uses.
 */
function sweep(section: Vec2[], path: Vec3[], opts: SweepOpts = {}): MeshData {
  let scale: Vec2[] | undefined
  const inset = opts.endInset ?? 0
  if (inset > 0 && !opts.closed && path.length >= 4) {
    scale = path.map((_, i) => {
      const edge = Math.min(i, path.length - 1 - i)
      const k = edge === 0 ? 1 - inset : edge === 1 ? 1 - inset * 0.28 : 1
      return [k, k] as Vec2
    })
  }
  return smoothShade(
    tubeAlong(path, section, {
      up: [0, 0, 1],
      cap: !opts.closed,
      closePath: opts.closed,
      scale,
    }),
    opts.smooth ?? SMOOTH.cast,
  )
}

/** A polygon in the (radial, height) plane, extruded tangentially at `bearing`. */
function radialWall(
  section: Vec2[],
  cx: number,
  cz: number,
  bearing: number,
  halfThickness: number,
  smooth = SMOOTH.cast,
): MeshData {
  const md = prismXZ(section, -halfThickness, halfThickness)
  rotateZ(md, bearing)
  translate(md, [cx, cz, 0])
  return smoothShade(md, smooth)
}

/**
 * `rotateZ` angle that lays a plan polygon's local +X ACROSS a face whose
 * outward direction is `(fx, fz)`; the face itself is then the polygon's
 * local −Y side, at `centre + front · halfDepth`.
 */
function crossYaw(fx: number, fz: number): number {
  return Math.atan2(fx, -fz)
}

/** `Mesh.rotation.y` that turns a PlaneGeometry (+Z normal) to face `(fx, fz)`. */
function plateYaw(fx: number, fz: number): number {
  return Math.atan2(fx, fz)
}

/** Player yaw that LOOKS along `(dx, dz)` — yaw 0 looks −Z (notes S9). */
function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/**
 * A collider box aligned to a plan direction. Every collider in this file goes
 * through here: `PartWriter`/`rotateZ` place geometry with local +X along
 * `(cos t, sin t)`, while a yawed collider's local +X lands on
 * `(cos yaw, −sin yaw)` — so the yaw is the NEGATED authoring angle, and
 * getting that backwards silently rotates a wall 2·t degrees.
 */
function alignedBox(
  services: DistrictServices,
  center: Vector3,
  size: Vector3,
  authoringAngle: number,
): void {
  services.colliders.push({ kind: 'box', center, size, yaw: -authoringAngle })
}

/** Cast-in lens: a recessed emitter with a real bezel, never an applied decal. */
function lensBar(
  services: DistrictServices,
  center: Vec3,
  size: Vec3,
  authoringAngle: number,
  slot = 'floorLens',
): void {
  const md = bevel(
    prism(roundedRect(size[0], size[1], Math.min(0.012, size[1] * 0.4, size[0] * 0.4), 2), 0, size[2]),
    BEVEL.hardware,
    1,
  )
  rotateZ(md, authoringAngle)
  translate(md, center)
  writeInto(services.writer, slot, cleanMesh(smoothShade(md, SMOOTH.tight)))
}

/** Ellipse plan outline, counter-clockwise (so `polyOffset` grows outward). */
function ellipsePoly(cx: number, cz: number, ax: number, az: number, count: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const t = (TAU * i) / count
    out.push([cx + Math.cos(t) * ax, cz + Math.sin(t) * az])
  }
  return out
}

/**
 * The same outline pulled in by `inset` along its TRUE normal. A scaled-down
 * ellipse is NOT a parallel curve — at 45 deg the two differ by 12 cm on this
 * drum, which is exactly enough for a slab to grow through the beam it is
 * supposed to butt.
 */
function ellipseInset(
  cx: number,
  cz: number,
  ax: number,
  az: number,
  inset: number,
  count: number,
): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const t = (TAU * i) / count
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const nl = Math.hypot(az * ct, ax * st) || 1
    out.push([cx + ct * ax - ((az * ct) / nl) * inset, cz + st * az - ((ax * st) / nl) * inset])
  }
  return out
}

export interface Station {
  x: number
  z: number
  /** outward unit normal, in plan */
  nx: number
  nz: number
}

/**
 * Stations spaced by equal ARC LENGTH around an ellipse. Equal parameter steps
 * bunch mullions at the ends of a 2:1 drum; a real curtain wall's bays are
 * equal, and the bunching is the first thing that gives a fake one away.
 */
function ellipseStations(cx: number, cz: number, ax: number, az: number, count: number): Station[] {
  const samples = 1024
  const lengths: number[] = [0]
  let total = 0
  let px = cx + ax
  let pz = cz
  for (let i = 1; i <= samples; i++) {
    const t = (TAU * i) / samples
    const x = cx + Math.cos(t) * ax
    const z = cz + Math.sin(t) * az
    total += Math.hypot(x - px, z - pz)
    lengths.push(total)
    px = x
    pz = z
  }
  const out: Station[] = []
  let cursor = 0
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count
    while (cursor < samples - 1 && lengths[cursor + 1] < target) cursor++
    const span = lengths[cursor + 1] - lengths[cursor] || 1
    const t = (TAU * (cursor + (target - lengths[cursor]) / span)) / samples
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const nl = Math.hypot(az * ct, ax * st) || 1
    out.push({ x: cx + ct * ax, z: cz + st * az, nx: (az * ct) / nl, nz: (ax * st) / nl })
  }
  return out
}

/** Merged quad soup — the sink for glazing and cloth, which are ONE mesh each. */
class QuadSoup {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a))
    if (n.lengthSq() < 1e-12) return
    n.normalize()
    const corners: Array<[Vector3, number, number]> = [
      [a, 0, 0],
      [b, 1, 0],
      [c, 1, 1],
      [a, 0, 0],
      [c, 1, 1],
      [d, 0, 1],
    ]
    for (const [p, u, v] of corners) {
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
      this.uvs.push(u, v)
    }
  }

  get empty(): boolean {
    return this.positions.length === 0
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2))
    return g
  }
}

// ---------------------------------------------------------- amphitheater ----

const BOWL = { x: AMPHITHEATER.x, z: AMPHITHEATER.z }
const STAGE_PAD = PADS.find((pad) => pad.id === 'amphitheater')
const STAGE = {
  x: STAGE_PAD?.x ?? -64,
  z: STAGE_PAD?.z ?? 39,
  y: STAGE_PAD?.y ?? -1.8,
  radius: STAGE_PAD?.radius ?? 8,
}

/** The seating arc's axis: dead opposite the stage, seen from the bowl centre. */
const ARC_CENTER = Math.atan2(STAGE.z - BOWL.z, STAGE.x - BOWL.x) + Math.PI
const ARC_SPAN = (Math.PI * 5) / 6
const ROWS = 6
/** parkPlan's contract: row centrelines at 11 + row·2.6 from the bowl centre. */
const ROW_DEPTH = 2.6
const ROW_HALF = ROW_DEPTH / 2
const ROW_RISE = 0.3
/** Stepped aisles as fractions along the arc; the fourth is the paved ramp. */
const AISLE_FRACTIONS = [0.2, 0.6, 0.8]
/** Half-angle of a stepped aisle — a radial wedge, ~2.6 m wide at mid-height. */
const AISLE_HALF = 0.0775
/** Terraces stop this far clear of the vomitory paving's edge. */
const RAMP_CLEAR = 1.0

const rowRadius = (row: number): number => 11 + row * ROW_DEPTH

/** Lowest walkable ground on the seat arc at `radius` — the authored dish. */
function bowlGround(radius: number): number {
  let lowest = Infinity
  for (const bearing of [ARC_CENTER - ARC_SPAN / 2, ARC_CENTER, ARC_CENTER + ARC_SPAN / 2]) {
    lowest = Math.min(
      lowest,
      interiorHeight(BOWL.x + Math.cos(bearing) * radius, BOWL.z + Math.sin(bearing) * radius),
    )
  }
  return lowest
}

/**
 * Terrace deck heights: a constant 0.30 m rise per row, anchored so that
 * (a) row A stands a real riser above the orchestra and (b) EVERY deck clears
 * the paved vomitory at its own outer edge — otherwise the ramp surfaces
 * through the middle of a terrace, which no amount of modelling can hide.
 */
function deckHeights(): number[] {
  let base = bowlGround(rowRadius(0) - ROW_HALF) + 0.4
  for (let row = 0; row < ROWS; row++) {
    base = Math.max(base, bowlGround(rowRadius(row) + ROW_HALF) + PAVE.rise + 0.22 - row * ROW_RISE)
  }
  return Array.from({ length: ROWS }, (_, row) => base + row * ROW_RISE)
}

/** Angular runs of one row that are neither a stepped aisle nor the ramp. */
function rowRuns(radius: number, aisles: number[]): Array<[number, number]> {
  const blocked = (angle: number): boolean => {
    for (const center of aisles) if (Math.abs(angle - center) < AISLE_HALF) return true
    return (
      pavedSignedDistance(BOWL.x + Math.cos(angle) * radius, BOWL.z + Math.sin(angle) * radius) <
      RAMP_CLEAR
    )
  }
  const bisect = (free: number, wall: number): number => {
    let lo = free
    let hi = wall
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2
      if (blocked(mid)) hi = mid
      else lo = mid
    }
    return lo
  }
  const a0 = ARC_CENTER - ARC_SPAN / 2
  const a1 = ARC_CENTER + ARC_SPAN / 2
  const steps = Math.max(12, Math.ceil(((a1 - a0) * radius) / 0.3))
  const runs: Array<[number, number]> = []
  let open: number | null = null
  let previous = a0
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + ((a1 - a0) * i) / steps
    const isBlocked = blocked(angle)
    if (!isBlocked && open === null) open = i === 0 ? angle : bisect(angle, previous)
    else if (isBlocked && open !== null) {
      runs.push([open, bisect(previous, angle)])
      open = null
    }
    previous = angle
  }
  if (open !== null) runs.push([open, a1])
  // A 30 mm movement joint at every run end. Two cast solids that meet on an
  // exactly shared plane trade numerical crossings all along it, and a real
  // poured bowl has this joint anyway.
  const joint = 0.03 / radius
  return runs
    .filter(([s, e]) => (e - s) * radius > 2.2)
    .map(([s, e]) => [s + joint, e - joint] as [number, number])
}

/**
 * A terrace's radial section, `(outward from the row centreline, up from its
 * deck)`. The riser carries a 22 mm nosing arris at the top and is set back
 * 34 mm at its foot, so a shadow line runs the whole arc where it lands on the
 * terrace below. The top row grows a crown parapet instead of an outer face.
 */
function terraceSection(row: number, deck: number): Vec2[] {
  const floor = bowlGround(rowRadius(row)) - 0.32 - deck
  const fall = -0.013 // the deck falls inward, for drainage
  const points: Vec2[] = [
    [-ROW_HALF, fall],
    [-ROW_HALF - 0.022, fall - 0.022],
    [-ROW_HALF - 0.022, -0.25],
    [-ROW_HALF + 0.012, -0.284],
    [-ROW_HALF + 0.012, floor],
  ]
  if (row < ROWS - 1) {
    points.push([ROW_HALF, floor], [ROW_HALF, 0])
    return points
  }
  // Crown: a 0.52 m parapet with a leanable 0.39 m coping and a real drip.
  points.push(
    [ROW_HALF + 0.06, floor],
    [ROW_HALF + 0.06, 0.415],
    [ROW_HALF + 0.095, 0.452],
    [ROW_HALF + 0.095, 0.492],
    [ROW_HALF + 0.052, 0.532],
    [ROW_HALF - 0.305, 0.52],
    [ROW_HALF - 0.34, 0.478],
    [ROW_HALF - 0.34, 0],
  )
  return points
}

/**
 * The cast seat bench: a plinth, a seat slab that oversails it (the undercut
 * shadow gap), and a leaning back with a rolled top. `(outward, up from deck)`,
 * about the bench's own reference radius.
 */
function benchSection(offset: number): Vec2[] {
  // The terrace deck falls 13 mm inward over its 2.6 m; the bench's underside
  // is cut to the same plane so it BUTTS the deck instead of resting on one
  // corner (a gap) or being bedded into it (an interpenetration).
  const deckAt = (u: number): number => -(0.013 * (ROW_HALF - u)) / ROW_DEPTH
  const front = deckAt(offset - 0.41)
  const back = deckAt(offset + 0.41)
  return [
    [-0.41, front],
    [-0.41, 0.055],
    [-0.372, 0.093],
    [-0.372, 0.33],
    [-0.398, 0.372],
    [-0.418, 0.402],
    [-0.404, 0.436],
    [-0.36, 0.45],
    [0.12, 0.446],
    [0.152, 0.472],
    [0.196, 0.56],
    [0.238, 0.79],
    [0.276, 0.815],
    [0.318, 0.788],
    [0.29, 0.56],
    [0.276, 0.42],
    [0.41, 0.372],
    [0.41, back],
  ]
}

/** Where a row's bench sits: hard against the riser above, 38 mm clear of it. */
function benchOffset(row: number): number {
  return row < ROWS - 1 ? ROW_HALF - 0.06 - 0.41 : ROW_HALF - 0.4 - 0.41
}

/**
 * A stepped aisle's radial staircase, as ONE continuous casting. Treads carry a
 * 34 mm nosing over an 18 mm undercut; the run ends four risers OUTSIDE the
 * crown so the walk in from the spur arrives at grade, not at a 0.8 m drop.
 */
function aisleSection(decks: number[], pathRadius: number): { section: Vec2[]; steps: Vec2[] } {
  const top: Vec2[] = []
  const steps: Vec2[] = []
  // Each tread carries a 60 x 14 mm rebate 55 mm past its nosing: the step
  // lights sit IN the casting. A bar laid on the tread is a trip strip, and
  // the audit reads it as a lamp lying on a floor.
  const nose = (radius: number, from: number, to: number): void => {
    top.push([radius - 0.018 - pathRadius, from])
    top.push([radius - 0.018 - pathRadius, to - 0.03])
    top.push([radius - 0.034 - pathRadius, to - 0.008])
    top.push([radius - 0.034 - pathRadius, to])
    top.push([radius + 0.055 - pathRadius, to])
    top.push([radius + 0.055 - pathRadius, to - 0.014])
    top.push([radius + 0.115 - pathRadius, to - 0.014])
    top.push([radius + 0.115 - pathRadius, to])
    steps.push([radius, to])
  }
  const bottomRadius = rowRadius(0) - ROW_HALF - 1.02
  const drop = (decks[0] - bowlGround(bottomRadius) - 0.05) / 3
  top.push([bottomRadius - pathRadius, decks[0] - drop * 3])
  for (let k = 2; k >= 0; k--) {
    nose(rowRadius(0) - ROW_HALF - k * 0.34, decks[0] - drop * (k + 1), decks[0] - drop * k)
  }
  for (let row = 1; row < ROWS; row++) {
    const boundary = rowRadius(row) - ROW_HALF
    nose(boundary, decks[row - 1], decks[row - 1] + ROW_RISE / 2)
    nose(boundary + 0.34, decks[row - 1] + ROW_RISE / 2, decks[row])
  }
  const crown = rowRadius(ROWS - 1) + ROW_HALF
  top.push([crown - pathRadius, decks[ROWS - 1]])
  const outside = bowlGround(crown + 3.1)
  const fall = (decks[ROWS - 1] - outside - 0.05) / 4
  for (let k = 0; k < 4; k++) {
    const radius = crown + 0.62 + k * 0.62
    const y = decks[ROWS - 1] - fall * k
    top.push([radius - 0.034 - pathRadius, y])
    top.push([radius - 0.034 - pathRadius, y - fall + 0.008])
    top.push([radius - 0.018 - pathRadius, y - fall + 0.03])
    top.push([radius - 0.018 - pathRadius, y - fall])
  }
  const endRadius = crown + 3.1
  top.push([endRadius - pathRadius, decks[ROWS - 1] - fall * 4])
  const section = [...top]
  section.push([endRadius - pathRadius, bowlGround(endRadius) - 0.34])
  section.push([bottomRadius - pathRadius, bowlGround(bottomRadius) - 0.34])
  return { section, steps }
}

function buildAmphitheater(services: DistrictServices): void {
  const decks = deckHeights()
  const aisles = AISLE_FRACTIONS.map((f) => ARC_CENTER + (f - 0.5) * ARC_SPAN)
  const parts: Part[] = []

  for (let row = 0; row < ROWS; row++) {
    const radius = rowRadius(row)
    const deck = decks[row]
    const section = terraceSection(row, deck)
    const seatSection = benchSection(benchOffset(row))
    const benchRadius = radius + benchOffset(row)

    for (const [a0, a1] of rowRuns(radius, aisles)) {
      parts.push(['cast', sweep(section, arcPath(BOWL.x, BOWL.z, radius, a0, a1, deck))])

      // End kerb at every AISLE-side run boundary: a 0.14 m upstand closing the
      // terrace and edging the stair. It sits INSIDE its own run and rests on
      // the deck's fall line, so it neither invades the aisle casting nor
      // leaves a gap. The arc's outer ends are closed by the cheek walls
      // instead — a kerb there would be buried inside one.
      const arcStart = ARC_CENTER - ARC_SPAN / 2
      const arcEnd = ARC_CENTER + ARC_SPAN / 2
      for (const [angle, sign] of [
        [a0, -1],
        [a1, 1],
      ] as const) {
        if (Math.abs(angle - arcStart) < 0.01 || Math.abs(angle - arcEnd) < 0.01) continue
        const deckAt = (u: number): number => deck - (0.013 * (ROW_HALF - u)) / ROW_DEPTH
        const kerb: Vec2[] = [
          [radius - ROW_HALF + 0.02, deckAt(-ROW_HALF + 0.02)],
          [radius + ROW_HALF - 0.02, deckAt(ROW_HALF - 0.02)],
          [radius + ROW_HALF - 0.02, deck + 0.1],
          [radius + ROW_HALF - 0.08, deck + 0.14],
          [radius - ROW_HALF + 0.08, deck + 0.14],
          [radius - ROW_HALF + 0.02, deck + 0.1],
        ]
        const wall = radialWall(kerb, BOWL.x, BOWL.z, angle, 0.075)
        translate(wall, [Math.sin(angle) * 0.075 * sign, -Math.cos(angle) * 0.075 * sign, 0])
        parts.push(['cast', wall])
      }

      // The bench stops 0.24 m short of each kerb: a real reveal at both ends.
      const inset = 0.24 / benchRadius
      if (a1 - a0 > inset * 2.6) {
        parts.push([
          'cast',
          sweep(
            seatSection,
            arcPath(BOWL.x, BOWL.z, benchRadius, a0 + inset, a1 - inset, deck, 0.55),
            { endInset: 0.02 },
          ),
        ])
      }

      // Colliders: the terrace mass, then the bench standing on it.
      const chunks = Math.max(1, Math.round(((a1 - a0) * radius) / 5))
      for (let c = 0; c < chunks; c++) {
        const m0 = a0 + ((a1 - a0) * c) / chunks
        const m1 = a0 + ((a1 - a0) * (c + 1)) / chunks
        const mid = (m0 + m1) / 2
        const chord = 2 * radius * Math.sin((m1 - m0) / 2) + 0.06
        alignedBox(
          services,
          new Vector3(BOWL.x + Math.cos(mid) * radius, deck - 0.5, BOWL.z + Math.sin(mid) * radius),
          new Vector3(ROW_DEPTH, 1, chord),
          mid,
        )
        alignedBox(
          services,
          new Vector3(
            BOWL.x + Math.cos(mid) * benchRadius,
            deck + 0.42,
            BOWL.z + Math.sin(mid) * benchRadius,
          ),
          new Vector3(0.82, 0.84, chord),
          mid,
        )
      }

      // A handful of registered seats, on the two rows with the best throw.
      if (row === 1 || row === 3) {
        for (const t of [0.32, 0.68]) {
          const angle = a0 + (a1 - a0) * t
          services.seats.push({
            seat: new Vector3(
              BOWL.x + Math.cos(angle) * (benchRadius - 0.16),
              deck + 0.45,
              BOWL.z + Math.sin(angle) * (benchRadius - 0.16),
            ),
            yaw: faceYaw(-Math.cos(angle), -Math.sin(angle)),
            label: 'Take a seat',
          })
        }
      }
    }
  }

  // ---- stepped aisles: one continuous casting each, with recessed step lights.
  const pathRadius = 17
  const { section: stairSection, steps } = aisleSection(decks, pathRadius)
  for (const center of aisles) {
    parts.push([
      'cast',
      sweep(
        stairSection,
        arcPath(BOWL.x, BOWL.z, pathRadius, center - AISLE_HALF, center + AISLE_HALF, 0, 0.5),
      ),
    ])
    for (let s = 0; s < steps.length; s++) {
      const [radius, y] = steps[s]
      const halfWidth = radius * AISLE_HALF
      if (s % 2 === 0) {
        for (const side of [-1, 1]) {
          // Bedded in the tread's rebate, 2 mm below the walking surface.
          const lensRadius = radius + 0.085
          const angle = center + (side * (halfWidth - 0.24)) / lensRadius
          lensBar(
            services,
            [
              BOWL.x + Math.cos(angle) * lensRadius,
              BOWL.z + Math.sin(angle) * lensRadius,
              y - 0.012,
            ],
            [0.05, 0.3, 0.009],
            angle,
          )
        }
      }
      alignedBox(
        services,
        new Vector3(
          BOWL.x + Math.cos(center) * radius,
          y - 0.35,
          BOWL.z + Math.sin(center) * radius,
        ),
        new Vector3(0.62, 0.7, 2 * halfWidth),
        center,
      )
    }
  }

  // ---- end cheeks: a raking wall closing each end of the arc.
  for (const [angle, sign] of [
    [ARC_CENTER - ARC_SPAN / 2, -1],
    [ARC_CENTER + ARC_SPAN / 2, 1],
  ] as const) {
    const inner = rowRadius(0) - ROW_HALF
    const outer = rowRadius(ROWS - 1) + ROW_HALF + 0.095
    const silhouette: Vec2[] = []
    for (let row = 0; row < ROWS; row++) {
      // No repeated station: the next row's inner edge IS this row's outer
      // edge, and a duplicate point emits a zero-area quad down the wall.
      silhouette.push([rowRadius(row) - ROW_HALF, decks[row] + 0.5])
      silhouette.push([rowRadius(row) + ROW_HALF, decks[row] + 0.5])
    }
    silhouette.push([outer, decks[ROWS - 1] + 0.52])
    silhouette.push([outer, bowlGround(outer) - 0.45])
    silhouette.push([inner, bowlGround(inner) - 0.45])
    const cheek = radialWall(silhouette, BOWL.x, BOWL.z, angle, 0.19)
    translate(cheek, [-Math.sin(angle) * 0.19 * sign, Math.cos(angle) * 0.19 * sign, 0])
    parts.push(['cast', cheek])

    // Capacity stencil on the cheek's outer face.
    const stencilRadius = 20.5
    const fx = -Math.sin(angle) * sign
    const fz = Math.cos(angle) * sign
    const plate = new Mesh(
      new PlaneGeometry(2.1, 0.42),
      signageMaterial(['ROWS A–F · 620'], { background: '#2c2823', widthPx: 640, aspect: 2.1 / 0.42 }),
    )
    // 0.383: the cheek is a ±0.19 radial wall shifted 0.19 off the bearing, so
    // its outer face is at 0.38 and this is the file's 3 mm plate standoff. At
    // 0.4 the stencil floated 20 mm off the concrete it is painted on.
    plate.position.set(
      BOWL.x + Math.cos(angle) * stencilRadius + fx * 0.383,
      decks[3] + 0.16,
      BOWL.z + Math.sin(angle) * stencilRadius + fz * 0.383,
    )
    plate.rotation.y = plateYaw(fx, fz)
    services.group.add(plate)
  }

  emit(services, parts)
  buildStage(services)
}

/**
 * The stage: a cast platform on visible substructure, a low acoustic shell, and
 * an open equipment alcove. The shell is capped at 2.05 m above the deck ON
 * PURPOSE — from row A's eye the glass and the mountains have to clear it.
 */
function buildStage(services: DistrictServices): void {
  const parts: Part[] = []
  const facing = Math.atan2(BOWL.z - STAGE.z, BOWL.x - STAGE.x)
  const cos = Math.cos(facing)
  const sin = Math.sin(facing)
  /** Stage-local (forward toward the audience, lateral) → world plan. */
  const local = (forward: number, lateral: number): Vec2 => [
    STAGE.x + cos * forward - sin * lateral,
    STAGE.z + sin * forward + cos * lateral,
  ]
  const deckTop = STAGE.y + 1.05
  const halfWidth = 6.5
  const front = 3.2
  const back = -4.6

  // 0.85 m corners: the perimeter beam is set back 0.38 and its section runs
  // 0.14 inward, so the corner radius has to stay above that or the swept
  // inner edge folds through itself (a self-coplanar casting).
  const deckPoly = ccw(
    roundedRect(front - back, halfWidth * 2, 0.85, 4).map(([f, l]) =>
      local(f + (front + back) / 2, l),
    ),
  )

  // Deck slab: a five-level offset loft — a true bullnose nose, not a chamfer.
  parts.push([
    'cast',
    smoothShade(
      loft(
        (
          [
            [-0.03, 0],
            [0.012, 0.05],
            [0.02, 0.11],
            [0.012, 0.17],
            [-0.03, 0.22],
          ] as Array<[number, number]>
        ).map(([offset, dz]) =>
          polyOffset(deckPoly, offset).map(([x, z]) => [x, z, deckTop - 0.22 + dz] as Vec3),
        ),
        { closeV: true, capStart: true, capEnd: true },
      ),
      SMOOTH.top,
    ),
  ])

  // Substructure: a set-back perimeter beam plus piers that stand proud of it,
  // so the 0.36 m shadow under the deck is real depth, not a painted line.
  // The beam runs the full 0.83 m from the pad to the deck's underside — a
  // short one leaves the slab floating on the piers.
  const beamHeight = deckTop - 0.22 - STAGE.y
  const beamPoly = polyOffset(deckPoly, -0.38)
  parts.push([
    'cast',
    sweep(
      [
        [-0.02, -0.3],
        [0.02, 0.06],
        [0.02, beamHeight - 0.06],
        [-0.02, beamHeight],
        [-0.14, beamHeight],
        [-0.14, -0.3],
      ],
      beamPoly.map(([x, z]) => [x, z, STAGE.y] as Vec3),
      { closed: true },
    ),
  ])
  // Piers butt the beam's outer face and stop 60 mm short of the deck's nose:
  // proud enough to catch the light, set back enough to keep the shadow line.
  for (let p = 0; p < 8; p++) {
    const lateral = -halfWidth + 0.9 + (p * (2 * halfWidth - 1.8)) / 7
    const [px, pz] = local(front - 0.21, lateral)
    const pier = bevel(
      prism(roundedRect(0.3, 0.34, 0.05, 2), STAGE.y - 0.1, deckTop - 0.22),
      BEVEL.carcass,
      2,
    )
    rotateZ(pier, facing)
    translate(pier, [px, pz, 0])
    parts.push(['cast', pier])
  }

  // Front edge glow: lens bars standing 6 mm off the beam's face, inside the
  // deck's oversail, so the light is a reflected line under the nose and never
  // a visible strip. Flush against the beam would be a coplanar pair.
  // Kept inside the deck's straight front run: past ±5.65 the beam turns into
  // its corner arc and a straight 1.1 m bar cuts the corner off.
  // front − 0.324, not − 0.45: the beam's own outer face is at
  // `front − 0.38 + 0.02` = front − 0.36 (see `beamPoly` below), so a 60 mm bar
  // centred 0.45 in was 60 mm INSIDE the beam, invisible and cross-slot.
  for (let s = 0; s < 9; s++) {
    const lateral = -4.6 + (s * 9.2) / 8
    const [lx, lz] = local(front - 0.324, lateral)
    lensBar(services, [lx, lz, deckTop - 0.44], [0.06, 1.0, 0.06], facing)
  }

  // Acoustic shell: an arc wall behind the stage, with vertical diffuser ribs.
  const shellRadius = 7.4
  const shellCenter = local(1.4, 0)
  const shellBase = STAGE.y - 0.35
  const shellTop = deckTop + 2.05
  const shellA0 = facing + Math.PI - 0.75
  const shellA1 = facing + Math.PI + 0.75
  parts.push([
    'cast',
    sweep(
      (
        [
          [-0.21, shellBase],
          [0.21, shellBase],
          [0.21, shellTop - 0.1],
          [0.17, shellTop - 0.06],
          [0.17, shellTop],
          [-0.17, shellTop],
          [-0.17, shellTop - 0.06],
          [-0.21, shellTop - 0.1],
        ] as Vec2[]
      ).map(([a, b]) => [a, b - deckTop] as Vec2),
      arcPath(shellCenter[0], shellCenter[1], shellRadius, shellA0, shellA1, deckTop, 0.5),
      { endInset: 0.03 },
    ),
  ])
  const ribCount = 22
  for (let r = 0; r < ribCount; r++) {
    const angle = shellA0 + 0.06 + ((shellA1 - shellA0 - 0.12) * r) / (ribCount - 1)
    const depth = 0.1 + 0.09 * (0.5 + 0.5 * Math.sin(r * 2.3))
    const rib = bevel(
      prism(
        roundedRect(depth, 0.11, 0.02, 2),
        deckTop + 0.02,
        shellTop - 0.24 - 0.1 * ((r % 3) / 2),
      ),
      BEVEL.panel,
      2,
    )
    rotateZ(rib, angle)
    translate(rib, [
      shellCenter[0] + Math.cos(angle) * (shellRadius - 0.21 - depth / 2),
      shellCenter[1] + Math.sin(angle) * (shellRadius - 0.21 - depth / 2),
      0,
    ])
    parts.push(['cast', rib])
  }

  // Equipment alcove: three walls as ONE U-shaped prism (no boolean, no
  // overlapping wall runs), a roof slab, a dark rear panel and a work lamp.
  const alcoveCenter = local(-6.4, -6.9)
  const alcoveYaw = facing
  const alcoveGround = interiorHeight(alcoveCenter[0], alcoveCenter[1])
  const uPoly: Vec2[] = [
    [1.3, -1.3],
    [-1.3, -1.3],
    [-1.3, 1.3],
    [1.3, 1.3],
    [1.3, 1.06],
    [-1.06, 1.06],
    [-1.06, -1.06],
    [1.3, -1.06],
  ]
  const alcoveWalls = bevel(prism(ccw(uPoly), alcoveGround - 0.3, alcoveGround + 2.3), BEVEL.carcass, 2)
  rotateZ(alcoveWalls, alcoveYaw)
  translate(alcoveWalls, [alcoveCenter[0], alcoveCenter[1], 0])
  parts.push(['cast', alcoveWalls])
  const alcoveRoof = bevel(
    prism(roundedRect(2.76, 2.76, 0.08, 2), alcoveGround + 2.3, alcoveGround + 2.46),
    BEVEL.carcass,
    2,
  )
  rotateZ(alcoveRoof, alcoveYaw)
  translate(alcoveRoof, [alcoveCenter[0], alcoveCenter[1], 0])
  parts.push(['cast', alcoveRoof])
  const rack = bevel(
    prism(roundedRect(0.1, 2.0, 0.02, 2), alcoveGround + 0.1, alcoveGround + 2.1),
    BEVEL.hardware,
    1,
  )
  rotateZ(rack, alcoveYaw)
  // 1.01, not 1.0: the U's back wall has its inner face at local x = −1.06, so
  // a 0.1 deep panel centred on −1.0 hung 10 mm clear of the only surface that
  // could carry it. It now butts that face.
  translate(rack, [
    alcoveCenter[0] - Math.cos(alcoveYaw) * 1.01,
    alcoveCenter[1] - Math.sin(alcoveYaw) * 1.01,
    0,
  ])
  parts.push(['darkGlass', rack])
  // The lamp is surface-mounted: its 50 mm body ends ON the roof's 2.3 soffit.
  // At 2.22 it hung 30 mm below the slab it is fixed to.
  lensBar(
    services,
    [
      alcoveCenter[0] + Math.cos(alcoveYaw) * 0.4,
      alcoveCenter[1] + Math.sin(alcoveYaw) * 0.4,
      alcoveGround + 2.25,
    ],
    [0.09, 1.4, 0.05],
    alcoveYaw,
    'utilityLight',
  )
  alignedBox(
    services,
    new Vector3(alcoveCenter[0], alcoveGround + 1.2, alcoveCenter[1]),
    new Vector3(2.7, 2.6, 2.7),
    alcoveYaw,
  )

  // Steps up both flanks: cast slabs that butt, never overlap.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const poly = ccw([
        local(front - 0.4, side * (halfWidth + 2.35 - k * 0.3)),
        local(front - 0.4, side * (halfWidth + 0.06)),
        local(back + 1.1, side * (halfWidth + 0.06)),
        local(back + 1.1, side * (halfWidth + 2.35 - k * 0.3)),
      ])
      // The bottom step is FOUNDED 0.3 m into the pad, not laid on it: the pad
      // is dead flat at exactly STAGE.y, and a slab whose underside shares
      // that plane z-fights the regolith mesh over its whole footprint.
      parts.push([
        'cast',
        bevel(
          prism(poly, k === 0 ? STAGE.y - 0.3 : STAGE.y + k * 0.15, STAGE.y + (k + 1) * 0.15),
          BEVEL.carcass,
          2,
        ),
      ])
    }
    // The flight must COLLIDE as steps: the old single 1 m box was an
    // unclimbable wall and the stage was unreachable on foot
    // (traversal-audit find). Seven riser boxes — 0.15 each, trivially
    // inside the 0.42 autostep — climb with the visual slabs.
    for (let k = 0; k < 7; k++) {
      const lat = side * (halfWidth + 2.35 - k * 0.3 - 0.15)
      const [kx, kz] = local((front - 0.4 + back + 1.1) / 2, lat)
      const top = STAGE.y + (k + 1) * 0.15
      alignedBox(
        services,
        new Vector3(kx, (top + STAGE.y - 0.1) / 2, kz),
        new Vector3(6.3, top - (STAGE.y - 0.1), 0.3),
        facing,
      )
    }
  }

  // Height 1.1, centred 0.55 under deckTop → collider TOP lands exactly on
  // the deck plane. The old 1.6 overshot by 0.25 and the player floated a
  // hand's width above the boards.
  alignedBox(
    services,
    new Vector3(STAGE.x, deckTop - 0.55, STAGE.z),
    new Vector3(7.9, 1.1, 13),
    facing,
  )
  alignedBox(
    services,
    new Vector3(shellCenter[0], deckTop + 1, shellCenter[1]),
    new Vector3(0.5, 2.4, 12),
    facing,
  )

  emit(services, parts)

  // Arrival totem at the head of the vomitory ramp.
  const totemAngle = ARC_CENTER - 0.3
  const totemRadius = rowRadius(ROWS - 1) + ROW_HALF + 4.8
  const tx = BOWL.x + Math.cos(totemAngle) * totemRadius
  const tz = BOWL.z + Math.sin(totemAngle) * totemRadius
  const ty = interiorHeight(tx, tz)
  const fx = -Math.cos(totemAngle)
  const fz = -Math.sin(totemAngle)
  const post = bevel(prism(roundedRect(1.9, 0.24, 0.05, 2), ty - 0.4, ty + 2.35), BEVEL.carcass, 2)
  rotateZ(post, crossYaw(fx, fz))
  translate(post, [tx, tz, 0])
  writeInto(services.writer, 'cast', cleanMesh(post))
  const totem = new Mesh(
    new PlaneGeometry(1.62, 0.62),
    signageMaterial(['ELYSIUM ASSEMBLY BOWL', 'ROWS A–F · 620'], {
      background: '#25231f',
      accent: '#c94f1d',
      widthPx: 768,
      aspect: 1.62 / 0.62,
    }),
  )
  // 0.123: the post is a 0.24 deep blade, so its face is at 0.12 and this is
  // the 3 mm standoff. At 0.142 the plate hung 22 mm off it.
  totem.position.set(tx + fx * 0.123, ty + 1.68, tz + fz * 0.123)
  totem.rotation.y = plateYaw(fx, fz)
  services.group.add(totem)
  // Crown wash, standing ON the post's 2.35 head. The post is 0.24 deep and
  // this bar is 0.10, so at ty + 2.28 it was inside the post on every axis —
  // an emissive strip that could not be seen from anywhere.
  lensBar(services, [tx, tz, ty + 2.35], [1.5, 0.1, 0.05], crossYaw(fx, fz), 'signageGlow')
  alignedBox(
    services,
    new Vector3(tx, ty + 1.1, tz),
    new Vector3(1.95, 2.3, 0.3),
    crossYaw(fx, fz),
  )
}

// -------------------------------------------------------- overlook lounge ----

/**
 * The Overlook Lounge's shared geometric contract. The shell (here) and the fit
 * out (`loungeInterior.ts`) both derive from it, so a level or a bay boundary
 * can never drift between the two files.
 *
 * The plan is an ELLIPSE that fills parkPlan's 20 × 11 footprint: continuously
 * curving, so it reads as a drum from every bearing, with the long west flank
 * giving design.md's "long window, chairs aimed at nothing but Mars".
 */
export interface LoungeShell {
  x: number
  z: number
  ax: number
  az: number
  bays: number
  doorBay: number
  stations: Station[]
  /** the paved apron the drum stands on */
  apron: number
  /** interior finished floor */
  floor: number
  /** top of the cast base band = the glazing sill */
  baseTop: number
  mezzBottom: number
  mezzTop: number
  head: number
  roofTop: number
  /** roof-terrace stair opening, in drum-local (u = +x, v = +z) metres */
  roofOpening: { u0: number; u1: number; v0: number; v1: number }
}

let loungeCache: LoungeShell | null = null

export function loungeShell(): LoungeShell {
  if (!loungeCache) {
    const x = OVERLOOK_LOUNGE.x
    const z = OVERLOOK_LOUNGE.z
    const ax = 5.35
    const az = 9.55
    const bays = 32
    const apron = interiorHeight(x, z)
    loungeCache = {
      x,
      z,
      ax,
      az,
      bays,
      doorBay: 0,
      stations: ellipseStations(x, z, ax, az, bays),
      apron,
      floor: apron + 0.045,
      baseTop: apron + 0.525,
      mezzBottom: apron + 3.425,
      mezzTop: apron + 3.865,
      head: apron + 6.745,
      roofTop: apron + 7.185,
      // Wide enough for the flight AND its handrails: the rail runs 1.02 m
      // above the treads, so it breaks the roof plane 0.85 m before they do.
      roofOpening: { u0: 0.3, u1: 3.0, v0: -6.4, v1: -4.6 },
    }
  }
  return loungeCache
}

function buildOverlook(services: DistrictServices): void {
  const shell = loungeShell()
  const parts: Part[] = []
  const glass = new QuadSoup()
  const stations = shell.stations
  const fine = ellipseStations(shell.x, shell.z, shell.ax, shell.az, shell.bays * 3)

  // ---- base band: the cast drum the glazing oversails by 0.12 m. The run is
  // SPLIT at the door bay rather than punched (geometry-craft §3).
  const baseHeight = shell.baseTop - shell.apron
  const baseSection: Vec2[] = [
    [-0.46, 0],
    [-0.155, 0],
    [-0.155, 0.09],
    [-0.12, 0.125],
    [-0.12, 0.3],
    [-0.26, 0.325],
    [-0.26, 0.42],
    [-0.12, 0.45],
    [-0.12, baseHeight - 0.04],
    [-0.16, baseHeight],
    [-0.46, baseHeight],
  ]
  const bandPath: Vec3[] = []
  for (let i = 3; i <= fine.length; i++) {
    const s = fine[i % fine.length]
    bandPath.push([s.x, s.z, shell.apron])
  }
  parts.push(['cast', sweep(baseSection, bandPath, { endInset: 0.01 })])

  // Recessed light slot in the base's reveal — a wall-wash, not a painted line.
  // Stepped per FINE station, not per bay: a bay's chord midpoint sits up to
  // 90 mm inside the ellipse at the drum's ends, which would drive the lens
  // straight through the back of its own groove.
  for (let i = 3; i < fine.length; i++) {
    const s = fine[i]
    const n = fine[(i + 1) % fine.length]
    const width = Math.hypot(n.x - s.x, n.z - s.z)
    const mx = (s.x + n.x) / 2
    const mz = (s.z + n.z) / 2
    const nx = (s.nx + n.nx) / 2
    const nz = (s.nz + n.nz) / 2
    const nl = Math.hypot(nx, nz) || 1
    // `lensBar`'s first extent runs ACROSS the face it is set into, the second
    // is its depth: with `crossYaw`, local +X is the tangential direction.
    // 0.2335 inward: the groove's BACK is the section's −0.26 station and the
    // bar is 45 mm deep, so this seats it on that face with the file's 4 mm
    // reveal. At 0.19 it hung in the middle of the slot — 47.5 mm off the back
    // and 47.5 mm behind the mouth, touching neither.
    lensBar(
      services,
      [mx - (nx / nl) * 0.2335, mz - (nz / nl) * 0.2335, shell.apron + 0.345],
      [width - 0.06, 0.045, 0.06],
      crossYaw(nx / nl, nz / nl),
    )
  }

  // ---- curtain wall. Mullions run continuously between the ring beams;
  // transoms stop short of them with a 7 mm reveal (the dome's rule: ribs
  // continuous, rings stop at collars, and nothing is ever coplanar).
  const mullion: Vec2[] = [
    [-0.14, -0.045],
    [-0.14, 0.045],
    [0.055, 0.045],
    [0.055, 0.028],
    [0.11, 0.028],
    [0.11, -0.028],
    [0.055, -0.028],
    [0.055, -0.045],
  ]
  for (let b = 0; b < shell.bays; b++) {
    const s = stations[b]
    for (const [y0, y1] of [
      [shell.baseTop, shell.mezzBottom],
      [shell.mezzTop, shell.head],
    ]) {
      const post = prism(mullion, y0, y1)
      rotateZ(post, Math.atan2(s.nz, s.nx))
      translate(post, [s.x, s.z, 0])
      parts.push(['aluminum', smoothShade(post, SMOOTH.moulded)])
    }

    if (b === shell.doorBay) continue
    const n = stations[(b + 1) % shell.bays]
    const width = Math.hypot(n.x - s.x, n.z - s.z)
    const ux = (n.x - s.x) / width
    const uz = (n.z - s.z) / width
    const mx = (s.x + n.x) / 2
    const mz = (s.z + n.z) / 2
    const nx = (s.nx + n.nx) / 2
    const nz = (s.nz + n.nz) / 2
    // `prismXZ` extrudes along local +Y, so the transom's LENGTH is its +Y
    // axis and its depth is +X — the mullion's convention, i.e. the plain
    // bearing of the bay normal, NOT `crossYaw` (which lays +X across the
    // face and is right for `lensBar`/`prism` plan sections). With crossYaw
    // here every transom in the drum ran RADIALLY, poking 1.4 m into the room
    // from a point in mid-air: the owner's "floating blocks attached to
    // nothing", horizontal in the lower band and raking in the upper one
    // purely because the upper band sits 3.6 m above the eye.
    const bayYaw = Math.atan2(nz, nx)
    for (const level of [shell.apron + 1.94, shell.apron + 5.3]) {
      const bar = prismXZ(
        [
          [-0.055, level - 0.048],
          [0.075, level - 0.048],
          [0.075, level + 0.048],
          [-0.055, level + 0.048],
        ],
        -width / 2 + 0.052,
        width / 2 - 0.052,
      )
      rotateZ(bar, bayYaw)
      translate(bar, [mx, mz, 0])
      parts.push(['aluminum', smoothShade(bar, SMOOTH.moulded)])
    }

    // Panes: four rows per bay, set 8 mm behind the mullion face, double-sided
    // so the lit interior reads from outside AND the plain reads from inside.
    for (const [y0, y1] of [
      [shell.baseTop + 0.05, shell.apron + 1.89],
      [shell.apron + 1.99, shell.mezzBottom - 0.05],
      [shell.mezzTop + 0.05, shell.apron + 5.25],
      [shell.apron + 5.35, shell.head - 0.05],
    ]) {
      const a = new Vector3(s.x + ux * 0.05 - nx * 0.008, y0, s.z + uz * 0.05 - nz * 0.008)
      const bb = new Vector3(n.x - ux * 0.05 - nx * 0.008, y0, n.z - uz * 0.05 - nz * 0.008)
      glass.quad(a, bb, new Vector3(bb.x, y1, bb.z), new Vector3(a.x, y1, a.z))
    }
  }

  // ---- ring beam at the mezzanine and the roof fascia: projecting bands with
  // a drip, the two horizontals that stop the drum reading as a tube.
  for (const [y0, y1, out] of [
    [shell.mezzBottom, shell.mezzTop, 0.17],
    [shell.head, shell.roofTop, 0.21],
  ] as const) {
    parts.push([
      'cast',
      sweep(
        [
          [-0.5, 0],
          [out - 0.05, 0],
          [out, 0.05],
          [out, y1 - y0 - 0.05],
          [out - 0.05, y1 - y0],
          [-0.5, y1 - y0],
        ],
        ellipsePoly(shell.x, shell.z, shell.ax, shell.az, 96).map(([x, z]) => [x, z, y0] as Vec3),
        { closed: true },
      ),
    ])
  }

  // ---- roof slab with the stair opening cut as a welded aperture. Its edge
  // is a true normal offset, 30 mm inside the roof band's inner face.
  const roofOuter = ellipseInset(shell.x, shell.z, shell.ax, shell.az, 0.53, 64)
  const opening = shell.roofOpening
  const openPoly = roundedRect(
    opening.u1 - opening.u0,
    opening.v1 - opening.v0,
    0.12,
    15,
  ).map(
    ([u, v]) =>
      [
        shell.x + u + (opening.u0 + opening.u1) / 2,
        shell.z + v + (opening.v0 + opening.v1) / 2,
      ] as Vec2,
  )
  parts.push([
    'cast',
    aperturedPrism(roofOuter, openPoly, shell.head, shell.roofTop, 0.03, 2),
  ])

  // ---- roof terrace: a cast parapet upstand plus a real curved guardrail.
  parts.push([
    'cast',
    sweep(
      [
        [-0.26, 0],
        [0.02, 0],
        [0.02, 0.34],
        [-0.02, 0.38],
        [-0.26, 0.38],
      ],
      ellipsePoly(shell.x, shell.z, shell.ax - 0.02, shell.az - 0.02, 96).map(
        ([x, z]) => [x, z, shell.roofTop] as Vec3,
      ),
      { closed: true },
    ),
  ])
  // Stood 80 mm inboard of the parapet's inner face, not on it.
  //
  // The RAIL's sampling is set by the curve, not by the post pitch. This drum
  // is a 2:1 ellipse, so its tightest radius is `ax^2 / az` = 2.71 m at the two
  // ends: a chord the length of one bay (45.5 m of perimeter / 30 = 1.52 m)
  // sags 106 mm inside its own curve there, and the run reads as a ring of
  // straights cutting both corners. RAIL_STEPS is a multiple of RAIL_POSTS so
  // every post still lands exactly on a rail station; at 150 the chord is
  // 0.30 m and the sag 4 mm.
  const RAIL_POSTS = 30
  const RAIL_STEPS = 150
  const railStations = ellipseStations(shell.x, shell.z, shell.ax - 0.36, shell.az - 0.36, RAIL_POSTS)
  const railPath = ellipseStations(shell.x, shell.z, shell.ax - 0.36, shell.az - 0.36, RAIL_STEPS)
  for (const [height, profile, slot] of [
    [1.06, roundedRect(0.055, 0.045, 0.014, 3), 'orangeTop'],
    [0.62, roundedRect(0.038, 0.03, 0.01, 2), 'orange'],
  ] as const) {
    parts.push([
      slot,
      smoothShade(
        tubeAlong(
          railPath.map((s) => [s.x, s.z, shell.roofTop + height] as Vec3),
          profile,
          { up: [0, 0, 1], closePath: true, cap: false },
        ),
        SMOOTH.moulded,
      ),
    ])
  }
  for (const s of railStations) {
    // Stops exactly under the top rail's soffit: 1.04 puts the post 2.5 mm
    // through it, and the rail is a different material slot.
    const post = prism(
      roundedRect(0.05, 0.05, 0.012, 2),
      shell.roofTop + 0.3,
      shell.roofTop + 1.0375,
    )
    translate(post, [s.x, s.z, 0])
    parts.push(['orange', smoothShade(post, SMOOTH.moulded)])
  }

  // ---- door surround: cast jambs and a head filling the missing bay.
  const doorStart = stations[shell.doorBay]
  const doorEnd = stations[(shell.doorBay + 1) % shell.bays]
  const doorMidX = (doorStart.x + doorEnd.x) / 2
  const doorMidZ = (doorStart.z + doorEnd.z) / 2
  const doorNx = doorStart.nx + doorEnd.nx
  const doorNz = doorStart.nz + doorEnd.nz
  const doorNl = Math.hypot(doorNx, doorNz) || 1
  const doorFx = doorNx / doorNl
  const doorFz = doorNz / doorNl
  const doorYaw = crossYaw(doorFx, doorFz)
  const doorWidth = Math.hypot(doorEnd.x - doorStart.x, doorEnd.z - doorStart.z)
  const doorUx = (doorEnd.x - doorStart.x) / doorWidth
  const doorUz = (doorEnd.z - doorStart.z) / doorWidth
  // Jambs sit 0.13 INTO the bay so their outer faces close the base band's cut
  // ends, and they occupy the band's own 0.30 m depth — not the mullion's.
  for (const side of [-1, 1]) {
    const jamb = bevel(
      prism(roundedRect(0.26, 0.3, 0.03, 2), shell.apron, shell.apron + 2.42),
      BEVEL.carcass,
      2,
    )
    rotateZ(jamb, doorYaw)
    translate(jamb, [
      doorMidX + doorUx * side * (doorWidth / 2 - 0.17) - doorFx * 0.31,
      doorMidZ + doorUz * side * (doorWidth / 2 - 0.17) - doorFz * 0.31,
      0,
    ])
    parts.push(['cast', jamb])
  }
  // Lintel bearing ON the jambs: a coplanar-opposed seat, and the glazing above
  // it carries on across the bay so the drum is never broken by a blank panel.
  const head = bevel(
    prism(roundedRect(doorWidth, 0.3, 0.03, 2), shell.apron + 2.42, shell.apron + 2.9),
    BEVEL.carcass,
    2,
  )
  rotateZ(head, doorYaw)
  translate(head, [doorMidX - doorFx * 0.31, doorMidZ - doorFz * 0.31, 0])
  parts.push(['cast', head])
  for (const [y0, y1] of [
    [shell.apron + 3.0, shell.mezzBottom - 0.05],
    [shell.mezzTop + 0.05, shell.apron + 5.25],
    [shell.apron + 5.35, shell.head - 0.05],
  ]) {
    const a = new Vector3(doorStart.x + doorUx * 0.05, y0, doorStart.z + doorUz * 0.05)
    const b = new Vector3(doorEnd.x - doorUx * 0.05, y0, doorEnd.z - doorUz * 0.05)
    glass.quad(a, b, new Vector3(b.x, y1, b.z), new Vector3(a.x, y1, a.z))
  }

  const sign = new Mesh(
    new PlaneGeometry(2.3, 0.48),
    signageMaterial(['OVERLOOK LOUNGE'], { background: '#25231f', accent: '#c94f1d', widthPx: 640, aspect: 2.3 / 0.48 }),
  )
  sign.position.set(doorMidX + doorFx * 0.2, shell.apron + 2.82, doorMidZ + doorFz * 0.2)
  sign.rotation.y = plateYaw(doorFx, doorFz)
  services.group.add(sign)
  // Two brackets back to the lintel. The plate projects 0.2 m OUTSIDE the
  // glazing line while the head casting stops at -0.16, so it hung 0.36 m off
  // the building on nothing at all.
  for (const s of [-1, 1]) {
    // 0.357 long on 0.0185: the head casting's outer face is at −0.16 and the
    // plate's own plane is at +0.20, so a 0.37 stay on 0.025 ran 10 mm THROUGH
    // the printed face. This butts the casting and dies 3 mm behind the plate.
    const stay = bevel(
      prism(roundedRect(0.05, 0.357, 0.012, 1), shell.apron + 2.795, shell.apron + 2.845),
      BEVEL.carcass,
      1,
    )
    rotateZ(stay, doorYaw)
    translate(stay, [
      doorMidX + doorUx * s * 0.6 + doorFx * 0.0185,
      doorMidZ + doorUz * s * 0.6 + doorFz * 0.0185,
      0,
    ])
    parts.push(['steelEdge', stay])
  }
  // Entrance wash, recessed under the head casting (soffit apron + 2.42, depth
  // −0.46…−0.16). At +0.19/3.10 the bar stood 0.2 m above the casting and 0.35
  // m out from the glazing line — 158 mm from the nearest solid in any
  // direction, an emissive bar hanging in the air over the door.
  lensBar(
    services,
    [doorMidX - doorFx * 0.31, doorMidZ - doorFz * 0.31, shell.apron + 2.37],
    [doorWidth - 0.24, 0.08, 0.05],
    doorYaw,
    'signageGlow',
  )

  // ---- planters standing on the apron off each end of the drum (the
  // reference image's move: green confined to white concrete, never spilling).
  for (const side of [-1, 1]) {
    const bx = shell.x + 0.3
    const bz = shell.z + side * (shell.az + 1.7)
    const outer = roundedRect(3.6, 1.5, 0.35, 4).map(([x, z]) => [bx + x, bz + z] as Vec2)
    parts.push([
      'cast',
      sweep(
        [
          [-0.2, 0],
          [0.02, 0],
          [0.02, 0.44],
          [0.055, 0.48],
          [0.055, 0.52],
          [-0.2, 0.52],
        ],
        outer.map(([x, z]) => [x, z, shell.apron] as Vec3),
        { closed: true },
      ),
    ])
    // Soil set 12 mm inside the wall's inner face (the swept section's −0.2
    // station) and bedded ON the apron. The chord-normal sweep and
    // `polyOffset`'s true mitre differ by ~7 mm at the corners of this
    // roundedRect, so 12 mm is a reveal that cannot close; the old pair
    // (−0.26, apron + 0.06) was a 60 mm gap all round AND a 60 mm undercut,
    // i.e. a block of earth floating inside a planter.
    parts.push([
      'soil',
      bevel(prism(polyOffset(outer, -0.212), shell.apron + 0.002, shell.apron + 0.4), BEVEL.panel, 1),
    ])
    services.colliders.push({
      kind: 'box',
      center: new Vector3(bx, shell.apron + 0.28, bz),
      size: new Vector3(3.7, 0.58, 1.6),
    })
  }

  // ---- glazing: one mesh for the whole drum, both faces, no shadow cast.
  if (!glass.empty) {
    const pane = new Mesh(glass.geometry(), heroGlass())
    pane.name = 'overlook:glazing'
    pane.material.side = DoubleSide
    pane.castShadow = false
    pane.receiveShadow = false
    services.group.add(pane)
  }

  emit(services, parts)

  // ---- shell colliders: the drum wall, open only at the door bay.
  for (let b = 0; b < shell.bays; b++) {
    if (b === shell.doorBay) continue
    const s = stations[b]
    const n = stations[(b + 1) % shell.bays]
    const width = Math.hypot(n.x - s.x, n.z - s.z)
    alignedBox(
      services,
      new Vector3((s.x + n.x) / 2, shell.apron + 2.2, (s.z + n.z) / 2),
      new Vector3(width + 0.08, 4.4, 0.4),
      crossYaw((n.z - s.z) / width, -(n.x - s.x) / width),
    )
  }

  // ---- rim benches flanking the drum, aimed at the plain.
  for (const side of [-1, 1]) {
    const spot = new Vector3(shell.x - shell.ax - 3.2, 0, shell.z + side * 6.4)
    spot.setY(interiorHeight(spot.x, spot.z))
    const seat = bench(services.writer, spot, -Math.PI / 2)
    services.seats.push({ ...seat, label: 'Watch the planet' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.3),
      size: new Vector3(1.9, 0.6, 0.6),
      yaw: -Math.PI / 2,
    })
  }
}

// ------------------------------------------------------------- playground ----

function buildPlayground(services: DistrictServices): void {
  const ground = interiorHeight(PLAYGROUND.x, PLAYGROUND.z)
  const center = new Vector3(PLAYGROUND.x, ground, PLAYGROUND.z)
  const pad = ground + 0.055
  const radius = PLAYGROUND.radius - 0.9
  const parts: Part[] = []

  // Poured safety surface: a real slab 55 mm proud, inside a cast kerb ring.
  parts.push([
    'playSoft',
    smoothShade(
      bevel(prism(circle(radius - 0.16, 72, center.x, center.z), ground - 0.12, pad), 0.02, 2),
      SMOOTH.moulded,
    ),
  ])
  parts.push([
    'cast',
    sweep(
      [
        [-0.14, ground - 0.24],
        [0.14, ground - 0.24],
        [0.14, pad + 0.06],
        [0.1, pad + 0.11],
        [-0.1, pad + 0.11],
        [-0.14, pad + 0.06],
      ],
      arcPath(center.x, center.z, radius, 0, TAU, 0, 0.6).slice(0, -1),
      { closed: true },
    ),
  ])

  // ---- climbing dome: a tube lattice on lathed hub balls. Members stop short
  // of every node and the ball swallows the ends — bury-and-cap, so no two
  // tubes ever interpenetrate, and the whole frame is ONE material slot.
  // The base ring stands 0.30 m off the surface on stub legs, the way a real
  // climber is set: laid ON the pad it is a half-buried tube in every audit.
  const domeCenter = new Vector3(center.x - 4.2, pad + 0.3, center.z + 2.2)
  const domeRadius = 2.35
  const meridians = 8
  const ringCount = 4
  const hub = 0.075
  const node = (m: number, r: number): Vec3 => {
    const phi = (r / ringCount) * (Math.PI / 2)
    const theta = (m / meridians) * TAU
    return [
      domeCenter.x + Math.cos(theta) * Math.cos(phi) * domeRadius,
      domeCenter.z + Math.sin(theta) * Math.cos(phi) * domeRadius,
      domeCenter.y + Math.sin(phi) * domeRadius,
    ]
  }
  const member = (a: Vec3, b: Vec3, r: number): MeshData => {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const l = Math.hypot(d[0], d[1], d[2]) || 1
    // Stopped just inside the hub ball: far enough back that two members
    // meeting at 90 deg clear each other, near enough that the ball swallows
    // the cut. Half that and the foot tube runs through the ring tube.
    const k = (hub * 0.83) / l
    return smoothShade(
      tubeAlong(
        [
          [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k],
          [b[0] - d[0] * k, b[1] - d[1] * k, b[2] - d[2] * k],
        ],
        circle(r, 9),
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.turned,
    )
  }
  // Everything in this playground STANDS ON the poured surface on a cast shoe.
  // Legs driven through it would be honest engineering and a cross-material
  // interpenetration in every audit from here on.
  const shoeTop = pad + 0.11
  for (let m = 0; m < meridians; m++) {
    const foot = node(m, 0)
    // The leg runs from inside its hub ball down INTO the shoe, and is built
    // directly rather than through `member()`: that trims `hub · 0.83` off
    // BOTH ends, and over the 0.15 m from node to shoe the two trims left a
    // 25 mm stub hanging 102 mm above the pad, eight times round the ring.
    parts.push([
      'playBlue',
      smoothShade(
        tubeAlong(
          [
            [foot[0], foot[1], foot[2] - hub * 0.83],
            [foot[0], foot[1], shoeTop - 0.03],
          ],
          circle(0.036, 9),
          { up: [1, 0, 0], cap: true },
        ),
        SMOOTH.turned,
      ),
    ])
    parts.push(['playBlue', member(foot, node((m + 1) % meridians, 0), 0.028)])
    // The shoe takes the FRAME's slot, not the cast one: a slanted tube's end
    // cap dips below its own axis, so leg and shoe always share a little
    // volume — which is only a defect when they are different materials.
    const shoe = bevel(prism(roundedRect(0.21, 0.21, 0.03, 2), pad, shoeTop), BEVEL.hardware, 2)
    translate(shoe, [foot[0], foot[1], 0])
    parts.push(['playBlue', shoe])
    for (let r = 0; r < ringCount; r++) {
      parts.push(['playBlue', member(node(m, r), node(m, r + 1), 0.031)])
      if (r > 0) parts.push(['playBlue', member(node(m, r), node((m + 1) % meridians, r), 0.028)])
    }
  }
  for (let m = 0; m < meridians; m++) {
    for (let r = 0; r <= ringCount; r++) {
      if (r === ringCount && m > 0) continue
      const ball = revolve(
        [
          [0, -hub],
          [hub * 0.72, -hub * 0.72],
          [hub, 0],
          [hub * 0.72, hub * 0.72],
          [0, hub],
        ],
        12,
        { capStart: false, capEnd: false, smooth: SMOOTH.turned },
      )
      translate(ball, node(m, r))
      parts.push(['playBlue', ball])
    }
  }
  services.colliders.push({
    kind: 'cylinder',
    center: domeCenter.clone().setY(pad + (0.3 + domeRadius) / 2),
    halfHeight: (0.3 + domeRadius) / 2,
    radius: domeRadius,
  })

  // ---- slide: a deck on splayed legs, grab rails, and a lofted chute whose
  // section is a real closed U-channel with wall thickness.
  const slide = new Vector3(center.x + 1.5, pad + 1.55, center.z - 4.3)
  parts.push([
    'playRed',
    bevel(
      prism(
        roundedRect(1.5, 1.5, 0.16, 3).map(([x, z]) => [slide.x + x, slide.z + z] as Vec2),
        slide.y - 0.11,
        slide.y,
      ),
      BEVEL.panel,
      2,
    ),
  ])
  for (const [sx, sz] of [
    [-0.58, -0.58],
    [0.58, -0.58],
    [0.58, 0.58],
    [-0.58, 0.58],
  ]) {
    parts.push([
      'playRed',
      smoothShade(
        tubeAlong(
          [
            [slide.x + sx, slide.z + sz, slide.y - 0.1],
            [slide.x + sx * 1.28, slide.z + sz * 1.28, pad + 0.09],
          ],
          circle(0.042, 10),
          { up: [0, 0, 1], cap: true },
        ),
        SMOOTH.turned,
      ),
    ])
    const shoe = bevel(prism(roundedRect(0.24, 0.24, 0.03, 2), pad, pad + 0.09), BEVEL.hardware, 2)
    translate(shoe, [slide.x + sx * 1.28, slide.z + sz * 1.28, 0])
    parts.push(['playRed', shoe])
  }
  // Grab rails: ONE run each, from a foot buried in the deck, over the entry,
  // and down onto the chute's outer flange. Both ends used to be a capped tube
  // floating in air — the rail began 0.9 m above the deck it is meant to be
  // held from and stopped 0.6 m above the chute. Every knot below is on the
  // deck, on the entry arc, or on the chute, so the run terminates INTO the
  // two things it belongs to and the arc's own tangent is unchanged.
  //
  // Landing point: the chute is swept with its own frame, so the outer wall's
  // top face at a station is `axis + across*0.295 + up*0.13`, where `up` is
  // perpendicular to the chute's slope — hence the z lead of the last knot.
  for (const side of [-1, 1]) {
    const x = slide.x + side * 0.42
    const railPath: Vec3[] = [
      // Foot: 50 mm into the 110 mm deck slab, well inboard of its front edge.
      [x, slide.z + 0.26, slide.y - 0.05],
    ]
    // Knee onto the grab line: a real 0.16 m bend, four 22.5 deg breaks, not a
    // mitred corner. The entry arc leaves t=0 horizontal, so the whole run
    // through the knee is tangent-continuous.
    for (let k = 0; k <= 4; k++) {
      const a = Math.PI - (k / 4) * (Math.PI / 2)
      railPath.push([x, slide.z + 0.42 + Math.cos(a) * 0.16, slide.y + 0.74 + Math.sin(a) * 0.16])
    }
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      railPath.push([x, slide.z + 0.74 + t * 1.5, slide.y + 0.9 - t * t * 0.62])
    }
    railPath.push(
      [x, slide.z + 2.32, slide.y + 0.2],
      [slide.x + side * 0.295, slide.z + 2.5, slide.y - 0.29],
    )
    parts.push([
      'playRed',
      smoothShade(tubeAlong(railPath, circle(0.026, 8), { up: [0, 0, 1], cap: true }), SMOOTH.turned),
    ])
  }
  const chutePath: Vec3[] = []
  for (let k = 0; k <= 12; k++) {
    const t = k / 12
    chutePath.push([slide.x, slide.z + 0.74 + t * 3.1, slide.y - 0.02 - (1 - Math.cos(t * 1.42)) * 1.28])
  }
  parts.push([
    'playRed',
    smoothShade(
      tubeAlong(
        chutePath,
        [
          [-0.32, 0.13],
          [-0.32, 0.05],
          [-0.28, 0],
          [-0.2, -0.035],
          [0.2, -0.035],
          [0.28, 0],
          [0.32, 0.05],
          [0.32, 0.13],
          [0.27, 0.13],
          [0.27, 0.03],
          [0.2, 0.005],
          [-0.2, 0.005],
          [-0.27, 0.03],
          [-0.27, 0.13],
        ],
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.shell,
    ),
  ])
  services.colliders.push({
    kind: 'box',
    center: new Vector3(slide.x, pad + 0.78, slide.z + 1.4),
    size: new Vector3(1.6, 1.6, 5.2),
  })

  // ---- low-g swing frame: A-frames on cast shoes, top rail, two seats.
  const swing = new Vector3(center.x + 3.6, pad, center.z + 3.4)
  const barY = swing.y + 2.75
  for (const s of [-2.1, 2.1]) {
    for (const leg of [-1, 1]) {
      const footX = swing.x + s + leg * 0.18
      const footZ = swing.z + leg * 1.05
      parts.push([
        'playBlue',
        smoothShade(
          tubeAlong(
            [
              [swing.x + s, swing.z, barY - 0.06],
              [footX, footZ, swing.y + 0.13],
            ],
            circle(0.055, 10),
            { up: [0, 0, 1], cap: true },
          ),
          SMOOTH.turned,
        ),
      ])
      const shoe = bevel(
        prism(roundedRect(0.3, 0.3, 0.04, 2), swing.y, swing.y + 0.13),
        BEVEL.hardware,
        2,
      )
      translate(shoe, [footX, footZ, 0])
      parts.push(['playBlue', shoe])
    }
  }
  parts.push([
    'playBlue',
    smoothShade(
      tubeAlong(
        [
          [swing.x - 2.24, swing.z, barY],
          [swing.x + 2.24, swing.z, barY],
        ],
        circle(0.062, 12),
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.turned,
    ),
  ])
  for (const s of [-0.95, 0.95]) {
    for (const chain of [-0.24, 0.24]) {
      parts.push([
        'playBlue',
        smoothShade(
          tubeAlong(
            [
              [swing.x + s + chain, swing.z, barY - 0.05],
              [swing.x + s + chain, swing.z, swing.y + 0.66],
            ],
            circle(0.012, 6),
            { up: [0, 0, 1], cap: true },
          ),
          SMOOTH.turned,
        ),
      ])
    }
    const seat = bevel(
      prism(roundedRect(0.56, 0.2, 0.05, 3), swing.y + 0.6, swing.y + 0.66),
      BEVEL.panel,
      2,
    )
    translate(seat, [swing.x + s, swing.z, 0])
    parts.push(['fabricSand', seat])
  }
  services.colliders.push({
    kind: 'box',
    center: new Vector3(swing.x, swing.y + 1.4, swing.z),
    size: new Vector3(4.8, 2.8, 2.4),
  })

  // ---- spring riders: a real coil on a cast plate under a moulded body.
  for (const [rx, rz, yaw] of [
    [-1.9, -3.4, 0.6],
    [-3.4, -1.4, -1.1],
  ]) {
    const base = new Vector3(center.x + rx, pad, center.z + rz)
    const plate = bevel(
      prism(roundedRect(0.44, 0.44, 0.08, 3), base.y, base.y + 0.09),
      BEVEL.hardware,
      2,
    )
    translate(plate, [base.x, base.z, 0])
    parts.push(['playRed', plate])
    const coil: Vec3[] = []
    for (let k = 0; k <= 40; k++) {
      const t = k / 40
      coil.push([
        base.x + Math.cos(t * TAU * 4) * 0.13,
        base.z + Math.sin(t * TAU * 4) * 0.13,
        base.y + 0.1 + t * 0.34,
      ])
    }
    parts.push([
      'playRed',
      smoothShade(tubeAlong(coil, circle(0.022, 7), { up: [0, 0, 1], cap: true }), SMOOTH.turned),
    ])
    const body = bevel(
      prism(roundedRect(1.02, 0.34, 0.16, 4), base.y + 0.44, base.y + 0.58),
      BEVEL.frame,
      2,
    )
    rotateZ(body, yaw)
    translate(body, [base.x, base.z, 0])
    parts.push(['playRed', body])
    const backRest = bevel(
      prism(roundedRect(0.34, 0.3, 0.13, 4), base.y + 0.58, base.y + 0.92),
      BEVEL.frame,
      2,
    )
    rotateZ(backRest, yaw)
    translate(backRest, [base.x - Math.cos(yaw) * 0.3, base.z - Math.sin(yaw) * 0.3, 0])
    parts.push(['playRed', backRest])
    for (const side of [-1, 1]) {
      // Inside the body's plan and seated on its top face: on the edge, half
      // the grip's root hangs in air and half is inside the moulding.
      const gx = base.x - Math.cos(yaw) * 0.12 + Math.sin(yaw) * side * 0.115
      const gz = base.z - Math.sin(yaw) * 0.12 - Math.cos(yaw) * side * 0.115
      parts.push([
        'playRed',
        smoothShade(
          tubeAlong(
            [
              [gx, gz, base.y + 0.55],
              [gx, gz, base.y + 0.79],
            ],
            circle(0.02, 8),
            { up: [0, 0, 1], cap: true },
          ),
          SMOOTH.turned,
        ),
      ])
    }
    alignedBox(
      services,
      new Vector3(base.x, base.y + 0.5, base.z),
      new Vector3(1.1, 1, 0.6),
      yaw,
    )
  }

  // ---- the Ares VII plaque on a cast plinth, OUTSIDE the poured surface so
  // the two pours meet on the regolith rather than through one another.
  const plinth = new Vector3(center.x + 5.9, ground, center.z - 6.5)
  const pl = Math.hypot(center.x - plinth.x, center.z - plinth.z) || 1
  const pfx = (center.x - plinth.x) / pl
  const pfz = (center.z - plinth.z) / pl
  const stone = bevel(
    prism(roundedRect(1.1, 0.34, 0.05, 3), plinth.y - 0.35, plinth.y + 0.92),
    BEVEL.carcass,
    2,
  )
  rotateZ(stone, crossYaw(pfx, pfz))
  translate(stone, [plinth.x, plinth.z, 0])
  parts.push(['cast', stone])
  const plaque = new Mesh(
    new PlaneGeometry(0.86, 0.34),
    signageMaterial(['DONATED BY THE CREW OF ARES VII'], { background: '#2b2723', widthPx: 512, aspect: 0.86 / 0.34 }),
  )
  // 0.173: the stone is 0.34 deep, so its face is at 0.17 — the 3 mm standoff
  // again. At 0.192 this plaque stood 22 mm off the plinth it is set into.
  plaque.position.set(plinth.x + pfx * 0.173, plinth.y + 0.68, plinth.z + pfz * 0.173)
  plaque.rotation.y = plateYaw(pfx, pfz)
  services.group.add(plaque)
  alignedBox(
    services,
    new Vector3(plinth.x, plinth.y + 0.5, plinth.z),
    new Vector3(1.2, 1, 0.4),
    crossYaw(pfx, pfz),
  )

  // ---- bench pair (the kit bench — never rebuilt here).
  for (const [bx, bz] of [
    [-1.2, 5.6],
    [2.9, 5.0],
  ]) {
    const spot = new Vector3(center.x + bx, pad, center.z + bz)
    const yaw = Math.atan2(center.x - spot.x, center.z - spot.z) + Math.PI
    const seat = bench(services.writer, spot, yaw)
    services.seats.push({ ...seat, label: 'Sit' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.3),
      size: new Vector3(1.9, 0.6, 0.6),
      yaw,
    })
  }

  emit(services, parts)
}

// ------------------------------------------------------------- first tree ----

/**
 * The soil ring's section, `(outward from the ring radius, up from the plaza)`,
 * as a function of `bench01`. At 0 it is a plain coping; at 1 it has grown a
 * seat ledge and a back. The ring is ONE loft with a **per-longitude profile**,
 * so the bench is part of the casting instead of an object butted against it
 * (the dome plinth's trick, applied to a much smaller pour).
 */
function soilRingSection(bench01: number): Vec2[] {
  const seat = bench01
  const outer = 0.175 + 0.42 * seat
  const back = 0.235 * seat
  return [
    [-0.175, -0.35],
    [outer, -0.35],
    [outer, 0.06],
    [outer - 0.055, 0.1],
    [outer - 0.055, 0.02 + 0.42 * seat],
    [outer - 0.055 - 0.44 * seat, 0.05 + 0.4 * seat],
    [0.175 + back, 0.06 + 0.4 * seat],
    [0.175 + back, 0.545 + 0.33 * seat],
    [0.14 + back, 0.585 + 0.33 * seat],
    [-0.14, 0.575],
    [-0.175, 0.535],
    [-0.175, 0.06],
  ]
}

function buildFirstTreePlaza(services: DistrictServices): void {
  const plaza = interiorHeight(FIRST_TREE.x, FIRST_TREE.z)
  const center = new Vector3(FIRST_TREE.x, plaza, FIRST_TREE.z)
  const ring = FIRST_TREE.soilRingRadius
  const parts: Part[] = []

  // ---- the ring wall. The bench half is NORTH (−Z); the transition is a
  // smoothstep over ~20 deg, which is what makes it read as one pour.
  const steps = 144
  const rings: Vec3[][] = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * TAU
    const north = Math.max(0, -Math.sin(angle))
    const t = Math.min(1, Math.max(0, (north - 0.12) / 0.34))
    const section = soilRingSection(t * t * (3 - 2 * t))
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    rings.push(
      section.map(
        ([a, b]) => [center.x + cos * (ring + a), center.z + sin * (ring + a), plaza + b] as Vec3,
      ),
    )
  }
  parts.push(['cast', smoothShade(loft(rings, { closeU: true, closeV: true }), SMOOTH.cast)])

  // Drainage: cast grate blocks on the paving, clear of the ring's widest
  // section (the bench half oversails 0.60 m, the plain half 0.18 m).
  for (let g = 0; g < 16; g++) {
    // Phase chosen so no grate lands under the founding plaque's desk.
    const angle = (g / 16) * TAU + 0.39
    const grate = bevel(
      prism(roundedRect(0.16, 0.42, 0.02, 2), plaza - 0.06, plaza + 0.038),
      BEVEL.hardware,
      1,
    )
    rotateZ(grate, angle)
    translate(grate, [
      center.x + Math.cos(angle) * (ring + 0.78),
      center.z + Math.sin(angle) * (ring + 0.78),
      0,
    ])
    parts.push(['dark', grate])
  }

  // ---- soil: a crowned lens whose rim butts the wall's inner face exactly.
  // vegetationSystem plants the tree at plaza + 0.5, so the crown puts the
  // trunk a few centimetres INTO the soil — contact is a sink, not a rest.
  // 6 mm short of the wall's inner face: both are inscribed polygons of the
  // same circle at different counts, so a nominally flush fit has the coarser
  // one's vertices poking through the finer one's chords.
  const soilFace = ring - 0.181
  const soil = revolve(
    [
      [0, 0.5],
      [soilFace * 0.45, 0.487],
      [soilFace * 0.78, 0.462],
      [soilFace, 0.425],
      [soilFace, 0.06],
      [0, 0.06],
    ],
    96,
    { capStart: false, capEnd: false, smooth: SMOOTH.moulded },
  )
  translate(soil, [center.x, center.z, plaza])
  parts.push(['soil', soil])
  services.colliders.push({
    kind: 'cylinder',
    center: center.clone().setY(plaza + 0.32),
    halfHeight: 0.34,
    radius: ring + 0.36,
  })

  // Seats on the integrated bench ring, facing out across the plaza.
  for (let s = 0; s < 5; s++) {
    const angle = -Math.PI / 2 + (s - 2) * 0.42
    const seatRadius = ring + 0.34
    services.seats.push({
      seat: new Vector3(
        center.x + Math.cos(angle) * seatRadius,
        plaza + 0.45,
        center.z + Math.sin(angle) * seatRadius,
      ),
      yaw: faceYaw(Math.cos(angle), Math.sin(angle)),
      label: 'Sit with the tree',
    })
  }

  // ---- ring benches facing the tree (kit bench; the +π yaw fix stands).
  const benchRadius = ring + 3.4
  for (let s = 0; s < 8; s++) {
    if (s % 2 === 0) continue // gaps for the paths
    const angle = (s / 8) * TAU
    const spot = new Vector3(
      center.x + Math.cos(angle) * benchRadius,
      0,
      center.z + Math.sin(angle) * benchRadius,
    )
    spot.setY(interiorHeight(spot.x, spot.z))
    // Local +Z is the BACKREST: the seat (−Z) faces the tree.
    const yaw = Math.atan2(center.x - spot.x, center.z - spot.z) + Math.PI
    const seat = bench(services.writer, spot, yaw)
    services.seats.push({ ...seat, label: 'Sit with the tree' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.3),
      size: new Vector3(1.9, 0.6, 0.6),
      yaw,
    })
  }

  // ---- founding plaque — a cast dedication lectern, designed in the round.
  //
  // It used to be one rounded-rect prism with the plaque laid flat on its top,
  // and from the north half of the plaza — which only ever sees its BACK — it
  // read as a blank slab. It is a real profiled casting now: a set-back toe
  // course, a cyma-moulded base, a battered die carrying a sunk fielded panel
  // on all four faces, a corniced cap with a drip groove under its oversail,
  // and a canted desk. The north approach gets its own inscription, bedded in
  // the back panel behind a cast bezel on four fixing bosses.
  //
  // Authored in a LOCAL frame — origin on the plan centre at grade, +X across
  // the face, +Y toward the BACK, +Z up — and moved onto the plaza once, at
  // the end. EVERY solid is slot 'cast': the desk, both bezels and the eight
  // bosses deliberately bury themselves in their host, and a same-slot bury
  // welds where a cross-slot one is a clash.
  const plaqueAngle = 0.62
  const px = center.x + Math.cos(plaqueAngle) * (ring + 1.05)
  const pz = center.z + Math.sin(plaqueAngle) * (ring + 1.05)
  const pfx = -Math.cos(plaqueAngle)
  const pfz = -Math.sin(plaqueAngle)
  const plinthYaw = crossYaw(pfx, pfz)
  // Its own grade, sampled where it stands: this is 6.5 m off the point the
  // ring is levelled from, and `interiorHeight` is not flat across a pad.
  const grade = interiorHeight(px, pz)
  /** Local (across, back, up) -> world: `rotateZ(plinthYaw)` sends local +X to
   *  (−pfz, pfx) and local +Y to (−pfx, −pfz). Seats the two applied plates. */
  const localPoint = (lx: number, ly: number, lz: number): Vector3 =>
    new Vector3(px - lx * pfz - ly * pfx, grade + lz, pz + lx * pfx - ly * pfz)
  const settle = (md: MeshData): MeshData =>
    translate(rotateZ(md, plinthYaw), [px, pz, grade])

  // The plan is AUTHORED, never offset: `polyOffset` on a rounded corner by
  // anything near its radius collapses the arc, and every level has to carry
  // the same vertex count so one loft can hold a battered face and a sunk
  // field at once. `o` pushes the four faces out from nominal (corner centres
  // stay put, so the radius follows); `panel` swaps the face's 2 mm hollow for
  // the 22 mm sunk field. Neither depth is ever zero — four collinear points
  // on a capped ring ear-clip into zero-area triangles.
  const PW = 1.24
  const PD = 0.56
  const PR = 0.085
  const PANEL_D = 0.022
  const HX = PW / 2 - PR
  const HY = PD / 2 - PR
  const plan = (o: number, panel: boolean): Vec2[] => {
    const r = PR + o
    const fx = PW / 2 + o
    const fy = PD / 2 + o
    const sh = panel ? 0 : 0.001
    const d = panel ? PANEL_D : 0.002
    const out: Vec2[] = []
    const arc = (cx: number, cy: number, a0: number): void => {
      for (let k = 0; k <= 6; k++) {
        const a = a0 + (Math.PI / 2) * (k / 6)
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
    }
    // Six stations per run: arc end, shoulder, field, field, shoulder, arc end.
    // The 18 mm shoulder-to-field return is deliberate — a 30 mm one splays at
    // 36 deg, which smooths straight into the face at SMOOTH.cast and turns the
    // panel into a dish. 18 mm returns at 51 deg and creases.
    arc(HX, HY, 0)
    out.push([0.47, fy - sh], [0.452, fy - d], [-0.452, fy - d], [-0.47, fy - sh])
    arc(-HX, HY, Math.PI / 2)
    out.push([-fx + sh, 0.165], [-fx + d, 0.147], [-fx + d, -0.147], [-fx + sh, -0.165])
    arc(-HX, -HY, Math.PI)
    out.push([-0.47, -fy + sh], [-0.452, -fy + d], [0.452, -fy + d], [0.47, -fy + sh])
    arc(HX, -HY, Math.PI * 1.5)
    out.push([fx - sh, -0.165], [fx - d, -0.147], [fx - d, 0.147], [fx - sh, 0.165])
    return out
  }

  // The die is battered 18 mm over its 554 mm, so the panel floor — a constant
  // depth in from its own face — leans with it, and the plate that beds on it
  // has to lean by the same angle rather than stand plumb in a wedge of air.
  const DIE0 = 0.168
  const DIE1 = 0.722
  const dieO = (z: number): number => -0.004 - (0.018 * (z - DIE0)) / (DIE1 - DIE0)
  const batter = Math.atan2(0.018, DIE1 - DIE0)
  const shaftLevels: Array<[number, number, boolean]> = [
    [-0.3, -0.055, false], // buried shank; capStart closes the pour's foot
    [-0.06, -0.055, false],
    [-0.03, -0.026, false], // toe splay, still 30 mm under the paving
    [0.04, -0.026, false], //  toe course set back 26 mm -> shadow line at grade
    [0.052, -0.008, false], // base cyma springs
    [0.064, 0.008, false],
    [0.08, 0.018, false], //   base crown, 18 mm proud of the die's foot
    [0.128, 0.018, false], //  base course upright
    [0.144, 0.012, false], //  base weathering
    [DIE0, dieO(DIE0), false], //  the die springs
    [0.184, dieO(0.184), false], // plain die skirt below the panel
    [0.206, dieO(0.206), true], //  panel sill: 22 mm of stop for 24 mm of sink
    [0.684, dieO(0.684), true], //  panel head
    [0.706, dieO(0.706), false], // stop back out to the face
    [DIE1, dieO(DIE1), false], //   die top
    [0.7255, -0.002, false], // cornice soffit runs out over the die
    [0.7315, -0.002, false], // drip groove: inner wall, 6 mm
    [0.7315, 0.006, false], //  drip groove: roof, 8 mm
    [0.7255, 0.006, false], //  drip groove: outer wall
    [0.7285, 0.026, false], // soffit out to the corona's arris
    [0.748, 0.03, false], //   corona swells 4 mm
    [0.766, 0.026, false], //  ... and returns
    [0.78, 0.012, false], //   top bed; capEnd closes it
  ]
  parts.push([
    'cast',
    settle(
      smoothShade(
        loft(
          shaftLevels.map(([z, o, panel]) =>
            plan(o, panel).map(([x, y]) => [x, y, z] as Vec3),
          ),
          { closeV: true, capStart: true, capEnd: true },
        ),
        SMOOTH.cast,
      ),
    ),
  ])

  // The canted desk. Its bottom ring sits 24 mm INSIDE the cornice and its
  // splayed foot climbs out 12 mm above the top bed, so the two never share a
  // plane; the top two rings ride one tilted plane, which keeps `capEnd` a
  // real planar n-gon.
  const CANT = (20 * Math.PI) / 180
  const tanCant = Math.tan(CANT)
  const DESK_O = -0.02
  // Front lip 838 mm, back edge 1.027 m: a reading angle, not a table.
  const deskZ0 = 0.838 + (PD / 2 + DESK_O) * tanCant
  const deskTop = (y: number): number => deskZ0 + y * tanCant
  parts.push([
    'cast',
    settle(
      smoothShade(
        loft(
          [
            plan(-0.044, false).map(([x, y]) => [x, y, 0.756] as Vec3),
            plan(DESK_O, false).map(([x, y]) => [x, y, 0.792] as Vec3),
            plan(DESK_O, false).map(([x, y]) => [x, y, deskTop(y)] as Vec3),
            plan(-0.032, false).map(([x, y]) => [x, y, deskTop(y) + 0.011] as Vec3),
          ],
          { closeV: true, capStart: true, capEnd: true },
        ),
        SMOOTH.cast,
      ),
    ),
  ])

  // Applied-plate hardware. A bezel beds 4 mm into its host and stands proud,
  // so the plate lands in a real sinking instead of on a face; the bosses bed
  // into the bezel and their heads stay inside the panel mouth.
  const bezel = (w: number, h: number, frame: number, z1: number): MeshData =>
    smoothShade(
      annularPrism(
        roundedRect(w, h, 0.02, 3),
        roundedRect(w - 2 * frame, h - 2 * frame, 0.014, 3),
        -0.004,
        z1,
        0.003,
        2,
      ),
      SMOOTH.cast,
    )
  const fixingBoss = (): MeshData =>
    revolve(
      [
        [0, 0.001],
        [0.0115, 0.001],
        [0.0115, 0.011],
        [0.0092, 0.0152],
        [0.005, 0.0178],
        [0, 0.0184],
      ],
      12,
      { smooth: SMOOTH.tight },
    )

  // Back inscription: the field floor at mid-panel, and the rotation that
  // stands a part authored in the (across, up, out) face frame onto it —
  // `rotX(batter − π/2)` sends face +Z to the battered outward normal.
  const backZ = 0.5
  const backY = PD / 2 + dieO(backZ) - PANEL_D
  const ontoBack = (md: MeshData): MeshData =>
    translate(rotX(md, batter - Math.PI / 2), [0, backY, backZ])
  parts.push(['cast', settle(ontoBack(bezel(0.8, 0.28, 0.035, 0.013)))])
  for (const bx of [-1, 1]) {
    for (const by of [-1, 1]) {
      parts.push([
        'cast',
        // Head tops out 2.6 mm inside the panel mouth, never proud of the die.
        settle(ontoBack(translate(fixingBoss(), [bx * 0.3825, by * 0.1225, 0.001]))),
      ])
    }
  }
  const backPlate = new Mesh(
    new PlaneGeometry(0.71, 0.2),
    signageMaterial(['GINKGO BILOBA', 'PLANTED SOL 1'], {
      background: '#26231f',
      widthPx: 512,
      aspect: 0.71 / 0.2,
    }),
  )
  // 3 mm proud of the field floor along ITS normal, and leaning with the die.
  backPlate.position.copy(
    localPoint(0, backY + 0.003 * Math.cos(batter), backZ + 0.003 * Math.sin(batter)),
  )
  backPlate.rotation.order = 'YXZ'
  backPlate.rotation.set(-batter, plateYaw(-pfx, -pfz), 0)
  services.group.add(backPlate)

  // The founding plaque, on the canted top. `rotX(CANT)` maps the same face
  // frame onto the tilted plane; the plate's own YXZ euler reduces to this
  // file's flat-plate convention at CANT = 0.
  const deskSurface = deskTop(0) + 0.011
  const ontoDesk = (md: MeshData): MeshData => translate(rotX(md, CANT), [0, 0, deskSurface])
  parts.push(['cast', settle(ontoDesk(bezel(1.06, 0.46, 0.03, 0.012)))])
  for (const bx of [-1, 1]) {
    for (const by of [-1, 1]) {
      parts.push([
        'cast',
        settle(ontoDesk(translate(fixingBoss(), [bx * 0.515, by * 0.215, 0.003]))),
      ])
    }
  }
  const plaque = new Mesh(
    new PlaneGeometry(0.96, 0.36),
    signageMaterial(['THE FIRST TREE', 'GINKGO BILOBA · PLANTED SOL 1', 'FOR THE CITY TO COME'], {
      background: '#2b2723',
      widthPx: 768,
      aspect: 0.96 / 0.36,
    }),
  )
  plaque.position.copy(
    localPoint(0, -0.003 * Math.sin(CANT), deskSurface + 0.003 * Math.cos(CANT)),
  )
  plaque.rotation.order = 'YXZ'
  plaque.rotation.set(CANT - Math.PI / 2, plateYaw(pfx, pfz), 0)
  services.group.add(plaque)
  // Footprint is the cornice's oversail (1.30 x 0.62), height the desk's back
  // edge at 1.038 m.
  alignedBox(
    services,
    new Vector3(px, grade + 0.52, pz),
    new Vector3(1.34, 1.1, 0.66),
    plinthYaw,
  )

  // ---- the name stone.
  const stoneAngle = Math.PI / 2 + 0.34
  const sx = center.x + Math.cos(stoneAngle) * 11.5
  const sz = center.z + Math.sin(stoneAngle) * 11.5
  const sfx = -Math.cos(stoneAngle)
  const sfz = -Math.sin(stoneAngle)
  const stoneYaw = crossYaw(sfx, sfz)
  const monolith = smoothShade(
    loft(
      (
        [
          [-0.06, 0],
          [0.02, 0.09],
          [0.02, 1.42],
          [-0.06, 1.52],
        ] as Array<[number, number]>
      ).map(([o, dz]) =>
        // Corner radius 0.12 against a 0.06 inset: offsetting a rounded corner
        // by its own radius collapses its arc to a stack of coincident points.
        polyOffset(roundedRect(2.6, 0.52, 0.12, 3), o).map(([x, z]) => [x, z, dz] as Vec3),
      ),
      { closeV: true, capStart: true, capEnd: true },
    ),
    SMOOTH.cast,
  )
  rotateZ(monolith, stoneYaw)
  translate(monolith, [sx, sz, plaza - 0.32])
  parts.push(['cast', monolith])
  // Recessed field for the lettering — the plate sits IN it, never on the face.
  const field = bevel(
    prism(roundedRect(2.05, 0.06, 0.02, 2), plaza + 0.42, plaza + 0.92),
    BEVEL.hardware,
    1,
  )
  rotateZ(field, stoneYaw)
  // 0.314, not 0.245. The monolith's face is its `+0.02` loft station, i.e.
  // 0.28 off the stone's centre line over the whole 0.09…1.42 straight band —
  // so a 60 mm field centred on 0.245 (0.215…0.275) was entirely INSIDE the
  // casting: a recess that could not be seen, in a second material. It is an
  // applied panel now, standing on the 4 mm reveal this file uses everywhere.
  translate(field, [sx + sfx * 0.314, sz + sfz * 0.314, 0])
  parts.push(['dark', field])
  const name = new Mesh(
    new PlaneGeometry(2.0, 0.44),
    signageMaterial(['ELYSIUM COMMONS · EST. SOL 190'], { background: '#26231f', widthPx: 900, aspect: 2.0 / 0.44 }),
  )
  // 3 mm off the field's own face (0.344), the standoff every plate in this
  // file uses; at 0.288 the plate would now be inside the panel it names.
  name.position.set(sx + sfx * 0.347, plaza + 0.67, sz + sfz * 0.347)
  name.rotation.y = plateYaw(sfx, sfz)
  services.group.add(name)
  alignedBox(services, new Vector3(sx, plaza + 0.6, sz), new Vector3(2.7, 1.6, 0.6), stoneYaw)

  // ---- drinking fountain. Pedestal and basin are ONE casting with a rolled
  // rim — a separate lathed bowl dropped on top only ever half-buries itself.
  const fAngle = -0.42
  const fx = center.x + Math.cos(fAngle) * (ring + 2.2)
  const fz = center.z + Math.sin(fAngle) * (ring + 2.2)
  const pedestal = revolve(
    [
      [0.19, -0.22],
      [0.19, 0.05],
      [0.155, 0.09],
      [0.145, 0.72],
      [0.175, 0.78],
      [0.2, 0.86],
      [0.2, 0.905],
      [0.186, 0.918],
      [0.16, 0.906],
      [0.1, 0.884],
      [0, 0.878],
    ],
    32,
    { capStart: true, capEnd: false, smooth: SMOOTH.turned },
  )
  translate(pedestal, [fx, fz, plaza])
  parts.push(['cast', pedestal])
  parts.push([
    'aluminum',
    smoothShade(
      tubeAlong(
        [
          [fx, fz + 0.1, plaza + 0.9],
          [fx, fz + 0.05, plaza + 0.965],
          [fx, fz - 0.012, plaza + 0.958],
        ],
        circle(0.012, 8),
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.turned,
    ),
  ])
  services.colliders.push({
    kind: 'cylinder',
    center: new Vector3(fx, plaza + 0.46, fz),
    halfHeight: 0.46,
    radius: 0.26,
  })

  // ---- three flag masts in a row: the plaza's only motion at height.
  const clusterAngle = -1.15
  const clusterRadius = 13
  const cloth = new QuadSoup()
  for (let m = 0; m < 3; m++) {
    const along = (m - 1) * 3.6
    const mx = center.x + Math.cos(clusterAngle) * clusterRadius - Math.sin(clusterAngle) * along
    const mz = center.z + Math.sin(clusterAngle) * clusterRadius + Math.cos(clusterAngle) * along
    const my = interiorHeight(mx, mz)
    const shoe = revolve(
      [
        [0, -0.16],
        [0.28, -0.16],
        [0.28, 0.08],
        [0.2, 0.16],
        [0.115, 0.22],
        [0, 0.22],
      ],
      20,
      { capStart: false, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(shoe, [mx, mz, my])
    parts.push(['cast', shoe])
    // The mast stands ON the shoe's top face rather than being buried in it:
    // bury-and-cap is the right joint, but not across two material slots.
    const mast = revolve(
      [
        [0.085, 0.22],
        [0.075, 3.4],
        [0.055, 7.4],
        [0.05, 8.5],
        [0.038, 8.62],
        [0, 8.66],
      ],
      16,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(mast, [mx, mz, my])
    parts.push(['aluminum', mast])
    const armDir = clusterAngle + Math.PI / 2
    parts.push([
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [mx, mz, my + 8.08],
            [mx + Math.cos(armDir) * 1.35, mz + Math.sin(armDir) * 1.35, my + 8.14],
          ],
          circle(0.028, 8),
          { up: [0, 0, 1], cap: true },
        ),
        SMOOTH.turned,
      ),
    ])
    const cols = 6
    const rowsB = 4
    const point = (u: number, v: number): Vector3 =>
      new Vector3(
        mx + Math.cos(armDir) * (0.12 + u * 1.18),
        my + 8.04 - v * 3.4,
        mz + Math.sin(armDir) * (0.12 + u * 1.18),
      )
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rowsB; r++) {
        cloth.quad(
          point(c / cols, r / rowsB),
          point((c + 1) / cols, r / rowsB),
          point((c + 1) / cols, (r + 1) / rowsB),
          point(c / cols, (r + 1) / rowsB),
        )
      }
    }
    services.colliders.push({
      kind: 'cylinder',
      center: new Vector3(mx, my + 1.6, mz),
      halfHeight: 1.6,
      radius: 0.12,
    })
  }
  if (!cloth.empty) {
    const material = new MeshStandardNodeMaterial()
    material.colorNode = vec3(0.5, 0.23, 0.13)
    material.roughness = 0.92
    material.metalness = 0
    material.side = DoubleSide
    // There is no wind in a dome: this is HVAC drift, felt not seen (canon).
    const drift = sin(time.mul(0.55).add(positionLocal.x.mul(1.7)).add(positionLocal.y.mul(0.8)))
      .mul(0.62)
      .add(sin(time.mul(0.93).add(positionLocal.y.mul(1.9))).mul(0.38))
    const weight = uv().x.mul(uv().x).mul(0.085)
    material.positionNode = positionLocal.add(
      vec3(drift.mul(weight).mul(0.42), drift.mul(weight).mul(0.16), drift.mul(weight)),
    ) as unknown as typeof material.positionNode
    const banners = new Mesh(cloth.geometry(), material)
    banners.name = 'plaza:banners'
    banners.castShadow = false
    banners.receiveShadow = true
    services.group.add(banners)
  }

  emit(services, parts)
}
