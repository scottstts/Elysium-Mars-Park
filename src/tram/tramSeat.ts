import {
  loft,
  polyOffset,
  prism,
  revolveY,
  roundedRect,
  setSlot,
  translate,
  tubeAlong,
  unifyOrient,
  zipCaps,
} from './tramMesh'
import type { MeshData, Vec2, Vec3 } from './tramMesh'

/**
 * THE LOOP — the passenger seat.
 *
 * This is the most closely inspected object in the game: the player starts the
 * game SITTING in one, with an armrest at arm's length and the seat in front of
 * them filling a third of the frame. It is therefore built to the hero tier of
 * `dev_docs/craft/geometry-craft.md` §5 — a manufactured product, not a shape.
 *
 * The method, and why it removes the "blocky slab" read:
 *
 *  1. ONE analytic contact surface. `contactAt(x, s)` is the surface a body
 *     touches — a recline/lumbar/pan-angle polyline in (z, y) that is then
 *     SCULPTED ACROSS the bench by `dish(x)`: a raised cosine that hollows a
 *     bucket behind each of the two places and leaves a proud bolster at the
 *     divider and at both outboard ends. Every other part of the seat is
 *     generated FROM that surface, so nothing can float off it and the shell
 *     has genuine compound curvature (it is not an extrusion).
 *  2. The shell is a moulded bucket with real POCKETS. Its front face is the
 *     contact surface pushed back by `recessAt`, which is the 12 mm bezel
 *     everywhere and the full pad depth inside each pad's footprint. The pads
 *     therefore sit IN a moulded recess with a reveal all round — the single
 *     detail that separates a seat from a cushion pasted on a board.
 *  3. Pads are separate solids with a real piped welt: a swept cord following
 *     the pad's own boundary, plus a centre flute. Piping is geometry here,
 *     never a texture.
 *  4. Every end is ROLLED, never capped flat: the crest, the pan's waterfall
 *     nose and both lateral ends run through half-round arcs, and the two
 *     section ends are closed by `zipCaps` (an n-gon fan across a banana
 *     section folds through itself — notes.md S15).
 *
 * Local frame: bench centred on x = 0, floor at y = 0, facing +Z, so the two
 * places are at x = ±SEAT_DX. The caller yaws and translates it.
 */

// ------------------------------------------------------------------ metrics
//
// Human-contact dimensions, all to transit-seat standards (geometry-craft
// §10.2 "scale & ergonomics"). Nothing below is a styling number.

/** Seat centres, ± from the bench centre. 470 mm per place. */
const SEAT_DX = 0.235
/** Half the bench's overall width — matches `CABIN.benchHalfWidth`. */
export const BENCH_HALF = 0.47
/** Backrest rake from vertical. */
const RECLINE = (12 * Math.PI) / 180
/** Crest of the backrest: 590 mm above the seat surface. */
const BACK_TOP_Y = 1.045
/** Where the back plane meets the bight, in (z, y). NOTE the contact curve is
 *  the BOLSTER line: `dish` then carves the bucket DOWN from it, so the pan is
 *  authored ~21 mm above the 454 mm seating reference point. */
const BACK_BASE: Vec2 = [-0.205, 0.536]

/** The moulded bezel: the shell's front face stands this far behind contact
 *  everywhere the pads do not reach. */
const RIM = 0.012
const PAD_BACK = 0.055
const PAD_PAN = 0.062
/** Backshell offset at mid-span; the two ends roll in from here. */
const SHELL_DEEP = 0.078
/** Bucket depth at a seat centre, and the proud bolster between/outboard. */
const DISH = 0.030
const BOLSTER = 0.013
/**
 * Pocket and pad footprints. A pad's rolled edge bulges outward by `PAD_ROLL`,
 * so the pad has to finish `PAD_MARGIN` (> PAD_ROLL) inside the pocket's FLAT
 * floor or the roll punches straight through the shell's bezel — the one real
 * defect this seat's first build produced.
 */
const POCKET_HALF = 0.204
const FEATHER = 0.036
const PAD_MARGIN = 0.026
/** Cap on a pad's end-roll bulge — see `sectionLoop`. */
const PAD_ROLL = 0.021
const PAD_HALF = POCKET_HALF - FEATHER - 0.008

/** Armrest top: 209 mm above the seat surface. */
const ARM_TOP = 0.665
/** Armrest centres, ± from the bench centre. The outer face lands 3 mm inside
 *  the shell's end plane: two flush faces at x = ±BENCH_HALF are a coplanar
 *  same-facing pair, i.e. a z-fight, even inside one material slot. */
const ARM_X = BENCH_HALF - 0.031

// --------------------------------------------------------------- primitives

function raisedCos(t: number): number {
  const c = Math.max(-1, Math.min(1, t))
  return 0.5 * (1 + Math.cos(Math.PI * c))
}

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/** 1 across [a + f, b − f], falling to 0 at a and b. */
function window1(x: number, a: number, b: number, f: number): number {
  return smooth01((x - a) / f) * (1 - smooth01((x - (b - f)) / f))
}

// ----------------------------------------------------------- contact curve

/**
 * The backrest plane, with the two mouldings a seat back actually has: a
 * lumbar prominence 185 mm above the seat and a shoulder relief at the crest.
 */
function backZ(y: number): number {
  return (
    BACK_BASE[0] -
    (y - BACK_BASE[1]) * Math.tan(RECLINE) +
    0.026 * raisedCos((y - 0.68) / 0.185) -
    0.011 * raisedCos((y - 1.0) / 0.115)
  )
}

/**
 * Seat pan: 4.5 deg down to the rear, cresting at the waterfall nose. The third
 * column is the lateral sculpt weight — the pan takes only ~70 % of the dish
 * (a 21 mm hollow, which is what a transit pan actually has) while the
 * backrest's wings take the full 30 mm.
 */
const PAN_LINE: Array<[number, number, number]> = [
  [-0.135, 0.4585, 0.72],
  [-0.088, 0.4632, 0.72],
  [-0.04, 0.4675, 0.71],
  [0.008, 0.4708, 0.7],
  [0.056, 0.474, 0.68],
  [0.104, 0.4772, 0.64],
  [0.146, 0.4795, 0.56],
  [0.18, 0.4807, 0.46],
  [0.208, 0.4795, 0.34],
  [0.229, 0.476, 0.22],
  [0.246, 0.47, 0.13],
]

const BACK_STEPS = 9
const BIGHT_STEPS = 4

interface Profile {
  /** (z, y) contact points, crest first, pan nose last. */
  p: Vec2[]
  /** Lateral sculpt weight — how much this station responds to `dish`. */
  w: number[]
  /** Occupant-facing unit normal in (z, y). */
  n: Vec2[]
  /** Unit tangent in (z, y), crest → nose. */
  t: Vec2[]
  /** Cumulative arc length. */
  s: number[]
  total: number
  /** Arc length at the back/bight and bight/pan junctions. */
  sBackEnd: number
  sPanStart: number
}

function buildProfile(): Profile {
  const p: Vec2[] = []
  const w: number[] = []

  // 1. Backrest, crest down to the bight.
  for (let i = 0; i <= BACK_STEPS; i++) {
    const y = BACK_TOP_Y + ((BACK_BASE[1] - BACK_TOP_Y) * i) / BACK_STEPS
    p.push([backZ(y), y])
    w.push(0.26 + 0.74 * (1 - smooth01((y - 0.6) / 0.44)))
  }
  const sBackEndIndex = p.length - 1

  // 2. Bight: a quadratic Bezier whose control point is the INTERSECTION of
  //    the back's and the pan's tangents, so both joints are tangent-continuous
  //    and the fillet cannot kink.
  const a0 = p[sBackEndIndex]
  const da: Vec2 = [Math.sin(RECLINE), -Math.cos(RECLINE)] // down the back
  const b0: Vec2 = [PAN_LINE[0][0], PAN_LINE[0][1]]
  const db: Vec2 = [PAN_LINE[0][0] - PAN_LINE[1][0], PAN_LINE[0][1] - PAN_LINE[1][1]]
  const dbLen = Math.hypot(db[0], db[1])
  db[0] /= dbLen
  db[1] /= dbLen
  const det = da[0] * -db[1] - da[1] * -db[0]
  const k = ((b0[0] - a0[0]) * -db[1] - (b0[1] - a0[1]) * -db[0]) / det
  const ctrl: Vec2 = [a0[0] + da[0] * k, a0[1] + da[1] * k]
  const wBack = w[w.length - 1]
  const wPan = PAN_LINE[0][2]
  for (let i = 1; i <= BIGHT_STEPS; i++) {
    const t = i / (BIGHT_STEPS + 1)
    const u = 1 - t
    p.push([
      u * u * a0[0] + 2 * u * t * ctrl[0] + t * t * b0[0],
      u * u * a0[1] + 2 * u * t * ctrl[1] + t * t * b0[1],
    ])
    w.push(wBack + (wPan - wBack) * smooth01(t))
  }

  // 3. Pan.
  const panIndex = p.length
  for (const [z, y, ww] of PAN_LINE) {
    p.push([z, y])
    w.push(ww)
  }

  // Frames and arc length.
  const n: Vec2[] = []
  const t: Vec2[] = []
  const s: number[] = [0]
  for (let i = 1; i < p.length; i++) {
    s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]))
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)]
    const b = p[Math.min(p.length - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const tz = (b[0] - a[0]) / l
    const ty = (b[1] - a[1]) / l
    t.push([tz, ty])
    n.push([-ty, tz]) // left of travel = toward the occupant
  }
  return {
    p,
    w,
    n,
    t,
    s,
    total: s[s.length - 1],
    sBackEnd: s[sBackEndIndex],
    sPanStart: s[panIndex],
  }
}

const PROFILE = buildProfile()

/** The POCKET footprints, in arc length along the contact curve. The pan pocket
 *  reaches back INTO the bight (that is seating surface, not shell) and the
 *  ~40 mm of bare shell left between the two is the gap a real seat has. */
const S_BACK0 = 0.042
const S_BACK1 = PROFILE.sBackEnd - 0.01
const S_PAN0 = PROFILE.sPanStart - 0.075
const S_PAN1 = PROFILE.total - 0.03

interface Sample {
  z: number
  y: number
  w: number
  n: Vec2
  t: Vec2
}

/** Linear sample of the contact curve at an arbitrary arc length. */
function sampleAt(s: number): Sample {
  const arr = PROFILE.s
  let i = 0
  while (i < arr.length - 2 && arr[i + 1] < s) i++
  const span = arr[i + 1] - arr[i] || 1
  const f = Math.max(0, Math.min(1, (s - arr[i]) / span))
  const lerp = (a: number, b: number): number => a + (b - a) * f
  const nz = lerp(PROFILE.n[i][0], PROFILE.n[i + 1][0])
  const ny = lerp(PROFILE.n[i][1], PROFILE.n[i + 1][1])
  const nl = Math.hypot(nz, ny) || 1
  const tz = lerp(PROFILE.t[i][0], PROFILE.t[i + 1][0])
  const ty = lerp(PROFILE.t[i][1], PROFILE.t[i + 1][1])
  const tl = Math.hypot(tz, ty) || 1
  return {
    z: lerp(PROFILE.p[i][0], PROFILE.p[i + 1][0]),
    y: lerp(PROFILE.p[i][1], PROFILE.p[i + 1][1]),
    w: lerp(PROFILE.w[i], PROFILE.w[i + 1]),
    n: [nz / nl, ny / nl],
    t: [tz / tl, ty / tl],
  }
}

// --------------------------------------------------------- lateral sculpt

/** Nearest seat centre, and the normalised distance to it. */
function seatCentre(x: number): number {
  return x >= 0 ? SEAT_DX : -SEAT_DX
}

/** 1 at a seat centre, 0 at the divider and at both outboard ends. */
function bucket(x: number): number {
  return raisedCos((x - seatCentre(x)) / SEAT_DX)
}

/** Metres the contact surface is pushed BACK at `x`. Negative = proud. */
function dish(x: number): number {
  const b = bucket(x)
  return DISH * b - BOLSTER * (1 - b)
}

/** Contact surface point, sculpted, as (z, y). */
function contactAt(x: number, sample: Sample): Vec2 {
  const d = dish(x) * sample.w
  return [sample.z - d * sample.n[0], sample.y - d * sample.n[1]]
}

/** How deep the shell's front face is behind contact at (x, s): the bezel
 *  everywhere, the pad depth inside a pad footprint, ramped between. */
function recessAt(x: number, s: number): number {
  const lateral = window1(Math.abs(x - seatCentre(x)), -POCKET_HALF, POCKET_HALF, FEATHER)
  const back = window1(s, S_BACK0, S_BACK1, FEATHER)
  const pan = window1(s, S_PAN0, S_PAN1, FEATHER)
  return RIM + lateral * ((PAD_BACK - RIM) * back + (PAD_PAN - RIM) * pan)
}

/** Backshell offset: rolled in at the crest and the nose, and deeper behind
 *  each place so the shell reads as a moulded twin bucket from BEHIND too. */
function shellDepthAt(x: number, s: number): number {
  const depth =
    SHELL_DEEP -
    0.038 * raisedCos(s / 0.1) -
    0.033 * raisedCos((PROFILE.total - s) / 0.09) +
    0.012 * bucket(x)
  return Math.max(recessAt(x, s) + 0.01, depth)
}

// ------------------------------------------------------------ section loop

/**
 * Close a front/back chain pair into the loop `zipCaps` expects: index 0 and
 * index count/2 are the two rolled extremities, and the walk is CCW in (z, y)
 * so `polyOffset(loop, −inset)` shrinks it for the end stations.
 */
function sectionLoop(
  front: Vec2[],
  back: Vec2[],
  eHead: Vec2,
  eTail: Vec2,
  maxRoll = Infinity,
): Vec2[] {
  const n = front.length
  // `maxRoll` makes the end an ELLIPSE instead of a half-round: an upholstered
  // edge folds tight at the seam, and — decisively — a half-round roll bulges
  // half the pad's thickness past the pad's own footprint, straight through
  // the shell's pocket ramp.
  const roll = (f: Vec2, b: Vec2, e: Vec2, ang: number): Vec2 => {
    const mz = (f[0] + b[0]) / 2
    const my = (f[1] + b[1]) / 2
    const ux = f[0] - mz
    const uy = f[1] - my
    const r = Math.min(Math.hypot(ux, uy), maxRoll)
    const c = Math.cos(ang)
    const sn = Math.sin(ang)
    return [mz + ux * c + e[0] * r * sn, my + uy * c + e[1] * r * sn]
  }
  const q = Math.PI / 4
  const loop: Vec2[] = [roll(front[0], back[0], eHead, 2 * q)]
  loop.push(roll(front[0], back[0], eHead, 3 * q))
  for (let i = 0; i < n; i++) loop.push(back[i])
  loop.push(roll(front[n - 1], back[n - 1], eTail, 3 * q))
  loop.push(roll(front[n - 1], back[n - 1], eTail, 2 * q))
  loop.push(roll(front[n - 1], back[n - 1], eTail, q))
  for (let i = n - 1; i >= 0; i--) loop.push(front[i])
  loop.push(roll(front[0], back[0], eHead, q))
  return loop
}

/** Lift a (z, y) loop to a ring at station `x`. */
function ringAt(loop: Vec2[], x: number): Vec3[] {
  return loop.map(([z, y]) => [x, y, z] as Vec3)
}

/** Loft over x stations, roll the two ends in, and zip the caps. */
function sweepAcross(
  loopAt: (x: number) => Vec2[],
  stations: Array<[number, number]>,
  smooth: number,
): MeshData {
  const rings = stations.map(([x, inset]) => {
    const loop = loopAt(x)
    return ringAt(inset > 0 ? polyOffset(loop, -inset) : loop, x)
  })
  const m = loft(rings, { closeSection: true, smooth })
  zipCaps(m, rings[0].length, rings.length)
  return unifyOrient(m)
}

// ------------------------------------------------------------------ shell

const SHELL_ROLL = 0.019

/**
 * The shell's x stations. Uniform sampling for the dish, PLUS explicit stations
 * on both edges of every pocket ramp: a 36 mm ramp sampled at 60 mm intervals
 * aliases into a soft smear, and — worse — the linear chord across it sits well
 * above the true pocket floor, which is exactly where a pad's underside ends up
 * outside the shell.
 */
function shellStations(): Array<[number, number]> {
  const roll = SHELL_ROLL
  const inner = BENCH_HALF - roll * 1.4
  const key = new Set<number>()
  const push = (v: number): void => {
    if (v > -inner + 1e-4 && v < inner - 1e-4) key.add(Math.round(v * 1e5) / 1e5)
  }
  for (let i = 1; i < 14; i++) push(-inner + (2 * inner * i) / 14)
  for (const c of [-SEAT_DX, SEAT_DX]) {
    for (const d of [-POCKET_HALF, -(POCKET_HALF - FEATHER), POCKET_HALF - FEATHER, POCKET_HALF]) {
      push(c + d)
    }
  }
  return [
    [-BENCH_HALF, roll],
    [-BENCH_HALF + roll * 0.28, roll * 0.42],
    [-BENCH_HALF + roll * 0.72, roll * 0.08],
    [-inner, 0],
    ...[...key].sort((a, b) => a - b).map((x) => [x, 0] as [number, number]),
    [inner, 0],
    [BENCH_HALF - roll * 0.72, roll * 0.08],
    [BENCH_HALF - roll * 0.28, roll * 0.42],
    [BENCH_HALF, roll],
  ]
}

function shellChains(x: number): { front: Vec2[]; back: Vec2[] } {
  const front: Vec2[] = []
  const back: Vec2[] = []
  for (let i = 0; i < PROFILE.p.length; i++) {
    const sample: Sample = {
      z: PROFILE.p[i][0],
      y: PROFILE.p[i][1],
      w: PROFILE.w[i],
      n: PROFILE.n[i],
      t: PROFILE.t[i],
    }
    const c = contactAt(x, sample)
    const rec = recessAt(x, PROFILE.s[i])
    const dep = shellDepthAt(x, PROFILE.s[i])
    front.push([c[0] - sample.n[0] * rec, c[1] - sample.n[1] * rec])
    back.push([c[0] - sample.n[0] * dep, c[1] - sample.n[1] * dep])
  }
  return { front, back }
}

/**
 * The shell's front face as the RENDERER sees it — bilinear over the shell's
 * own station/profile grid, not the analytic surface. Pads set their underside
 * from this, so a pad can never emerge through the shell however the pocket is
 * retuned. (Comparing two different discretisations of one analytic surface is
 * how the first build put 117 triangle crossings into the back cushion.)
 */
let shellGrid: { xs: number[]; front: Vec2[][] } | null = null

function shellFrontAt(x: number, s: number): Vec2 {
  if (!shellGrid) {
    const stations = shellStations()
    shellGrid = {
      xs: stations.map(([sx]) => sx),
      front: stations.map(([sx]) => shellChains(sx).front),
    }
  }
  const xs = shellGrid.xs
  let a = 0
  while (a < xs.length - 2 && xs[a + 1] < x) a++
  const fx = Math.max(0, Math.min(1, (x - xs[a]) / (xs[a + 1] - xs[a] || 1)))
  const S = PROFILE.s
  let b = 0
  while (b < S.length - 2 && S[b + 1] < s) b++
  const fs = Math.max(0, Math.min(1, (s - S[b]) / (S[b + 1] - S[b] || 1)))
  const at = (i: number, j: number): Vec2 => (shellGrid as { front: Vec2[][] }).front[i][j]
  const mix = (p: Vec2, q: Vec2, f: number): Vec2 => [
    p[0] + (q[0] - p[0]) * f,
    p[1] + (q[1] - p[1]) * f,
  ]
  return mix(mix(at(a, b), at(a, b + 1), fs), mix(at(a + 1, b), at(a + 1, b + 1), fs), fx)
}

function buildShell(): MeshData {
  const loopAt = (x: number): Vec2[] => {
    const { front, back } = shellChains(x)
    const head = PROFILE.t[0]
    const tail = PROFILE.t[PROFILE.p.length - 1]
    return sectionLoop(front, back, [-head[0], -head[1]], tail)
  }
  const m = sweepAcross(loopAt, shellStations(), 44)
  return setSlot(m, 'seatShell')
}

// ------------------------------------------------------------------- pads

type PadKind = 'back' | 'pan'

interface PadSpec {
  s0: number
  s1: number
  depth: number
  /** Flute half-width and depth: the one sewn seam across the pad's face. */
  flute: number
}

function padSpec(kind: PadKind): PadSpec {
  const inset = FEATHER + PAD_MARGIN
  return kind === 'back'
    ? { s0: S_BACK0 + inset, s1: S_BACK1 - inset, depth: PAD_BACK, flute: 0.02 }
    : { s0: S_PAN0 + inset, s1: S_PAN1 - inset, depth: PAD_PAN, flute: 0.02 }
}

/** Moquette crown: a plump bulge over the pad's field, cut by the centre
 *  flute. Both are real displacement — a seam painted on a flat pad reads as
 *  a flat pad (notes.md, "ground art needs GEOMETRY", one scale down). */
function crownAt(x: number, s: number, spec: PadSpec, c: number): number {
  const mid = (spec.s0 + spec.s1) / 2
  const halfS = (spec.s1 - spec.s0) / 2
  const bulge = raisedCos((x - c) / PAD_HALF) * raisedCos((s - mid) / halfS)
  // Domed, and 3 mm BELOW the contact line at the perimeter: a pad whose face
  // is flat right up to its roll folds at ~70 deg and reads as a slab however
  // good the piping is. Falling away to the seam makes the roll tangential.
  return 0.012 * bulge - 0.003 - 0.005 * raisedCos((x - c) / spec.flute)
}

function padSamples(spec: PadSpec): Sample[] {
  const count = Math.max(7, Math.round((spec.s1 - spec.s0) / 0.044))
  const out: Sample[] = []
  for (let i = 0; i <= count; i++) out.push(sampleAt(spec.s0 + ((spec.s1 - spec.s0) * i) / count))
  return out
}

/** Stations clustered on the centre flute — a 20 mm groove needs points
 *  inside it or it averages away (notes.md: relief finer than the sampling is
 *  not relief). */
function padStations(c: number): number[] {
  return [-0.148, -0.098, -0.048, -0.021, -0.01, 0, 0.01, 0.021, 0.048, 0.098, 0.148].map(
    (d) => c + d,
  )
}

function padBody(c: number, kind: PadKind): MeshData {
  const spec = padSpec(kind)
  const samples = padSamples(spec)
  const sList = samples.map(
    (_, i) => spec.s0 + ((spec.s1 - spec.s0) * i) / (samples.length - 1),
  )
  const loopAt = (x: number): Vec2[] => {
    const top: Vec2[] = []
    const bottom: Vec2[] = []
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      const p = contactAt(x, sample)
      const up = crownAt(x, sList[i], spec, c)
      const floor = shellFrontAt(x, sList[i])
      top.push([p[0] + sample.n[0] * up, p[1] + sample.n[1] * up])
      bottom.push([floor[0] + sample.n[0] * 0.003, floor[1] + sample.n[1] * 0.003])
    }
    const head = samples[0].t
    const tail = samples[samples.length - 1].t
    return sectionLoop(top, bottom, [-head[0], -head[1]], tail, PAD_ROLL)
  }
  // Lateral end stations, hand-placed so the seam flute keeps its resolution.
  const inner = padStations(c)
  const roll = 0.016
  const stations: Array<[number, number]> = [
    [c - PAD_HALF, roll],
    [c - PAD_HALF + 0.005, roll * 0.42],
    [c - PAD_HALF + 0.012, roll * 0.08],
    ...inner.map((x) => [x, 0] as [number, number]),
    [c + PAD_HALF - 0.012, roll * 0.08],
    [c + PAD_HALF - 0.005, roll * 0.42],
    [c + PAD_HALF, roll],
  ]
  const rings = stations.map(([x, inset]) => {
    const loop = loopAt(x)
    return ringAt(inset > 0 ? polyOffset(loop, -inset) : loop, x)
  })
  const m = loft(rings, { closeSection: true, smooth: 52 })
  zipCaps(m, rings[0].length, rings.length)
  return setSlot(unifyOrient(m), 'seatCushion')
}

/**
 * The piped welt: a real cord swept around the pad's own boundary, nested in
 * the corner between the pad's face and its rolled edge. This is what makes a
 * moquette pad read as sewn rather than moulded.
 */
function padCord(c: number, kind: PadKind): MeshData {
  const spec = padSpec(kind)
  const halfS = (spec.s1 - spec.s0) / 2 - 0.012
  const midS = (spec.s0 + spec.s1) / 2
  const halfX = PAD_HALF - 0.012
  const rCorner = Math.min(0.03, halfS * 0.7, halfX * 0.7)
  // Rounded rect in (x, s) parameter space, walked once.
  const path: Vec2[] = []
  const outward: Vec2[] = []
  const seg = 3
  const corners: Array<[number, number, number]> = [
    [halfX - rCorner, halfS - rCorner, 0],
    [-(halfX - rCorner), halfS - rCorner, Math.PI / 2],
    [-(halfX - rCorner), -(halfS - rCorner), Math.PI],
    [halfX - rCorner, -(halfS - rCorner), Math.PI * 1.5],
  ]
  for (const [cx, cs, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((i / seg) * Math.PI) / 2
      path.push([cx + Math.cos(a) * rCorner, cs + Math.sin(a) * rCorner])
      outward.push([Math.cos(a), Math.sin(a)])
    }
  }
  const rings: Vec3[][] = []
  const radius = 0.0055
  const tube = 6
  for (let i = 0; i < path.length; i++) {
    const x = c + path[i][0]
    const s = midS + path[i][1]
    const sample = sampleAt(s)
    const p = contactAt(x, sample)
    // Surface frame: `along` is the in-surface outward direction, `n` the
    // occupant-facing normal. Building the ring from these instead of by
    // parallel transport removes any chance of a twist at the closing seam.
    const ax = outward[i][0]
    const as = outward[i][1]
    const centre: Vec3 = [
      x + ax * 0.004,
      p[1] + as * sample.t[1] * 0.004 - sample.n[1] * 0.004,
      p[0] + as * sample.t[0] * 0.004 - sample.n[0] * 0.004,
    ]
    const ring: Vec3[] = []
    for (let k = 0; k < tube; k++) {
      const a = (k / tube) * Math.PI * 2
      const co = Math.cos(a) * radius
      const si = Math.sin(a) * radius
      ring.push([
        centre[0] + ax * co,
        centre[1] + (as * sample.t[1] * co + sample.n[1] * si),
        centre[2] + (as * sample.t[0] * co + sample.n[0] * si),
      ])
    }
    rings.push(ring)
  }
  const m = loft(rings, { closeSection: true, closeStations: true, smooth: 50 })
  return setSlot(unifyOrient(m), 'seatCushion')
}

// --------------------------------------------------------------- armrests

/**
 * Cantilever armrest, moulded in one piece with the shell's side (it starts
 * INSIDE the shell, in the same material slot, so the two weld rather than
 * clash). Section rolls down and narrows to a rounded nose.
 */
function buildArm(sx: number): MeshData {
  const zRear = -0.245
  const zNose = 0.176
  const steps = 13
  const rings: Vec3[][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const z = zRear + (zNose - zRear) * t
    // Taper: full section over the hand, rolled at the nose, blended at the root.
    const nose = smooth01((t - 0.84) / 0.16)
    const shrink = 1 - 0.62 * nose * nose
    const w = 0.056 * shrink
    const h = (0.062 - 0.012 * smooth01((t - 0.2) / 0.7)) * (1 - 0.5 * nose * nose)
    const drop = 0.008 * smooth01((t - 0.55) / 0.45) + 0.012 * nose * nose
    const top = ARM_TOP - drop
    const r = Math.min(0.021, w / 2 - 0.001, h / 2 - 0.001)
    rings.push(
      roundedRect(w, h, r, 3).map(
        ([a, b]) => [sx * ARM_X + a, top - h / 2 + b, z] as Vec3,
      ),
    )
  }
  const m = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth: 42 })
  return setSlot(unifyOrient(m), 'seatShell')
}

// -------------------------------------------------------------- grab rail

/**
 * Grab rail across the crest, on two posts. The posts stop 2.5 mm short of the
 * shell — an applied part sits in a reveal, never flush (geometry-craft §3),
 * and 2.5 mm reads as the shadow line under a bolted foot.
 */
function buildGrabRail(): MeshData[] {
  const parts: MeshData[] = []
  const crestOf = (x: number): Vec2 => {
    const sample: Sample = {
      z: PROFILE.p[0][0],
      y: PROFILE.p[0][1],
      w: PROFILE.w[0],
      n: PROFILE.n[0],
      t: PROFILE.t[0],
    }
    const c = contactAt(x, sample)
    const dep = shellDepthAt(x, 0)
    // Apex of the crest roll: midway through the shell's thickness, pushed out
    // along the profile's own tangent (which points down the back).
    const rec = recessAt(x, 0)
    const mz = c[0] - sample.n[0] * (rec + dep) * 0.5
    const my = c[1] - sample.n[1] * (rec + dep) * 0.5
    const r = (dep - rec) * 0.5
    return [mz - sample.t[0] * r, my - sample.t[1] * r]
  }
  const railY = crestOf(0)[1] + 0.052
  const railZ = crestOf(0)[0] - 0.004
  for (const sx of [-1, 1]) {
    const x = sx * 0.29
    const foot = crestOf(x)
    const post = tubeAlong(
      [
        [x, foot[1] + 0.0025, foot[0]],
        [x, railY, railZ],
      ],
      roundedRect(0.03, 0.03, 0.014, 3),
      { smooth: 40, capStart: true, capEnd: true },
    )
    parts.push(setSlot(post, 'orangeRail'))
  }
  const rail = tubeAlong(
    [
      [-0.352, railY - 0.026, railZ],
      [-0.318, railY, railZ],
      [0.318, railY, railZ],
      [0.352, railY - 0.026, railZ],
    ],
    roundedRect(0.034, 0.034, 0.016, 4),
    { smooth: 40, capStart: true, capEnd: true },
  )
  parts.push(setSlot(rail, 'orangeRail'))
  return parts
}

// ------------------------------------------------------- mounts and rails

/** Where the shell's underside sits at the pan, at station `x`. */
function underPan(x: number, s: number): Vec2 {
  const sample = sampleAt(s)
  const c = contactAt(x, sample)
  const dep = shellDepthAt(x, s)
  return [c[0] - sample.n[0] * dep, c[1] - sample.n[1] * dep]
}

/**
 * Cantilever frame: two cast legs off a bolted floor track, a transverse
 * spreader, and a saddle whose top face sits 3 mm under the shell — the
 * reveal that keeps an alloy part out of a polymer part without a gap that
 * reads at seated distance.
 */
/** Floor datum of the bench: the cabin floor covering's top face. Everything
 *  bolted down starts 3 mm above it — flush is forbidden, and an exact butt
 *  between two material slots is what makes the audit's clash test ambiguous
 *  (notes.md, W2 amenities). */
const FLOOR_TOP = 0.006
const RAIL_BASE = FLOOR_TOP + 0.003
const RAIL_TOP = RAIL_BASE + 0.038
const RAIL_SLOT = RAIL_TOP - 0.01

function buildMounts(): MeshData[] {
  const parts: MeshData[] = []
  const sMount = PROFILE.sPanStart + 0.09
  const saddleZ0 = -0.13
  const saddleZ1 = 0.07
  for (const sx of [-1, 1]) {
    const x = sx * 0.3

    // Floor track: an extruded seat rail with a T-slot, rolled at both ends.
    const section: Vec2[] = [
      [x - 0.036, RAIL_BASE],
      [x + 0.036, RAIL_BASE],
      [x + 0.036, RAIL_TOP - 0.008],
      [x + 0.03, RAIL_TOP],
      [x + 0.013, RAIL_TOP],
      [x + 0.013, RAIL_SLOT],
      [x - 0.013, RAIL_SLOT],
      [x - 0.013, RAIL_TOP],
      [x - 0.03, RAIL_TOP],
      [x - 0.036, RAIL_TOP - 0.008],
    ]
    const railZ: Array<[number, number]> = [
      [-0.29, 0.006],
      [-0.284, 0],
      [0.229, 0],
      [0.235, 0.006],
    ]
    const rail = loft(
      railZ.map(([z, inset]) =>
        (inset > 0 ? polyOffset(section, -inset) : section).map(([a, b]) => [a, b, z] as Vec3),
      ),
      { closeSection: true, capStart: true, capEnd: true, smooth: 26 },
    )
    parts.push(setSlot(unifyOrient(rail), 'alloy'))

    // Countersunk track bolts, seated in the rail's slot.
    for (const z of [-0.235, -0.075, 0.085, 0.185]) {
      const bolt = revolveY(
        [
          [0, 0],
          [0.0115, 0],
          [0.0115, 0.0045],
          [0.0075, 0.0075],
          [0, 0.008],
        ],
        10,
        { smooth: 44 },
      )
      unifyOrient(bolt)
      translate(bolt, [x, RAIL_SLOT - 0.0015, z])
      parts.push(setSlot(bolt, 'alloy'))
    }

    // Saddle plate: the bolted interface, 3 mm clear of the shell everywhere
    // along its own footprint (the underside is curved, so the clearance is
    // taken against the LOWEST point under the plate, not one sample).
    let under = Infinity
    for (let i = 0; i <= 6; i++) {
      const s = sMount - 0.09 + (i / 6) * 0.2
      under = Math.min(under, underPan(x, s)[1], underPan(x + 0.05, s)[1], underPan(x - 0.05, s)[1])
    }
    const saddleTop = under - 0.003

    // Cast leg: rises off the track, sweeps back under the pan. Tapered by
    // lofting per-station sections rather than sweeping one constant profile.
    const path: Vec3[] = [
      [x, RAIL_TOP - 0.004, 0.07],
      [x, 0.12, 0.062],
      [x, 0.21, 0.03],
      [x, 0.29, -0.014],
      [x, saddleTop - 0.006, -0.05],
    ]
    const rings: Vec3[][] = []
    for (let i = 0; i < path.length; i++) {
      const t = i / (path.length - 1)
      const w = 0.072 - 0.026 * t
      const d = 0.05 + 0.03 * t
      rings.push(
        roundedRect(w, d, Math.min(0.019, w / 2 - 0.001), 3).map(
          ([a, b]) => [path[i][0] + a, path[i][1], path[i][2] + b] as Vec3,
        ),
      )
    }
    const leg = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth: 40 })
    parts.push(setSlot(unifyOrient(leg), 'alloy'))

    // `prism` on the Y axis takes its polygon as (z, x) — getting that pair
    // backwards silently moves a part a third of a metre (notes.md W2 works).
    const saddle = prism(
      roundedRect(saddleZ1 - saddleZ0, 0.104, 0.022, 3).map(
        ([a, b]) => [a + (saddleZ0 + saddleZ1) / 2, b + x] as Vec2,
      ),
      'y',
      saddleTop - 0.02,
      saddleTop,
      30,
    )
    parts.push(setSlot(saddle, 'alloy'))
  }

  // Transverse spreader between the two legs.
  const spread = tubeAlong(
    [
      [-0.3, 0.215, 0.026],
      [0.3, 0.215, 0.026],
    ],
    roundedRect(0.048, 0.042, 0.02, 3),
    { smooth: 40, capStart: true, capEnd: true },
  )
  parts.push(setSlot(spread, 'alloy'))
  return parts
}

// ------------------------------------------------------------------ bench

/**
 * One two-place bench, returned as INDEPENDENT parts. They are never `join`ed
 * before emit: a join collapses every part onto one smooth angle and lets
 * `cleanMesh` weld vertices across butt joints between parts that were never
 * one shell (notes.md, archkit polygon layer).
 */
export function buildBench(): MeshData[] {
  const parts: MeshData[] = [buildShell()]
  for (const c of [-SEAT_DX, SEAT_DX]) {
    for (const kind of ['back', 'pan'] as const) {
      parts.push(padBody(c, kind))
      parts.push(padCord(c, kind))
    }
  }
  parts.push(buildArm(-1), buildArm(1))
  parts.push(...buildGrabRail())
  parts.push(...buildMounts())
  return parts
}

/**
 * The seating reference point, MEASURED off the finished cushion rather than
 * declared: `tramSystem` puts the eye 0.74 above this, so a contract that
 * drifted from the geometry would float the player above the pad.
 * The flute is excluded — a body bridges a 20 mm groove.
 */
export function seatSurfaceY(): number {
  const spec = padSpec('pan')
  const s = spec.s0 + (spec.s1 - spec.s0) * 0.42
  const sample = sampleAt(s)
  const p = contactAt(SEAT_DX, sample)
  const mid = (spec.s0 + spec.s1) / 2
  const bulge = raisedCos((s - mid) / ((spec.s1 - spec.s0) / 2))
  return p[1] + sample.n[1] * 0.0038 * bulge
}

export { SEAT_DX }
