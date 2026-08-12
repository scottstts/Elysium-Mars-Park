import { Vector3 } from 'three'
import { SMOOTH, cleanMesh, loft, smoothShade, toYUp, tubeAlong, writeInto } from '../archkit/meshdata'
import type { Vec2, Vec3 } from '../archkit/meshdata'
import type { PartWriter } from '../archkit/writer'
import {
  FIGURE_COUNT,
  FIGURE_HEIGHT,
  FIGURE_RADIUS,
  FIGURE_REACH_Y,
  PEDESTAL_TOP_Y,
} from './fountainPlan'

/**
 * THE FIGURE GROUP — four draped caryatids carrying the lower tazza.
 *
 * ## Why this is a loft and not a sculpt
 *
 * A classical draped figure is, geometrically, a STACK OF SECTIONS with a
 * spine: ankles, calves, knees, hips, waist, ribs, bust, shoulders, neck,
 * skull. Author those sections honestly — real half-widths and half-depths off
 * a 1.77 m female canon — and the silhouette is correct before a single fold
 * is added. Everything below the hip is a floor-length chiton, so there are no
 * legs to model at all: the garment IS the geometry, which is exactly why
 * caryatids have been carved this way for 2500 years.
 *
 * ## The three things that make it read as carved rather than as a lathe
 *
 * 1. **Folds that meander.** The drapery is a two-harmonic angular ripple
 *    (k=9 and k=14) whose PHASE ADVANCES WITH HEIGHT, so folds spiral gently
 *    instead of running as vertical stripes — the giveaway of procedural cloth.
 *    A slow vertical break term stops any single fold running the full height.
 * 2. **Contrapposto.** The section centres trace an S: hips displaced toward
 *    the engaged leg, shoulders counter-displaced, head recentred over the
 *    weight-bearing foot. A figure whose sections stack on one axis reads as a
 *    bollard no matter how good the sections are.
 * 3. **An apoptygma.** The peplos' shoulder overfold is a separate closed
 *    shell falling from the shoulders to below the waist with its own folds
 *    and an undulating hem. It gives the torso the one hard garment EDGE the
 *    body loft cannot have, and it is what stops the upper body reading nude.
 *
 * The arms are swept separately and START INSIDE the torso: two closed solids
 * sharing an interior is invisible and correct, where two shells butted at a
 * shoulder seam would either gap or z-fight. Their fingertips end 20 mm inside
 * the tazza's underside for the same reason.
 *
 * Heads carry a brow, a nose wedge and a chin — no more. At the 4 m minimum
 * approach distance (the coping keeps you out) weathered marble faces read as
 * masses and a light plane; modelling features finer than the ring pitch just
 * produces noise on the silhouette.
 */

const TAU = Math.PI * 2

/**
 * Angular resolution of a figure's sections. 96 is not arbitrary: the drapery
 * runs a k=14 harmonic, so 96 gives just under 7 samples per fold — the floor
 * at which a fold's crease still resolves as a crease rather than a facet.
 */
const RING_SEGMENTS = 96

/**
 * The canon. `u` is height as a fraction of the figure; `w`/`d` are half-width
 * (side to side) and half-depth (front to back) in metres, for a 1.77 m
 * figure. Chin lands at u = 0.867, which is the classical 7.5-heads canon.
 */
const CANON: Array<{ u: number; w: number; d: number }> = [
  { u: -0.012, w: 0.305, d: 0.305 }, // hem, buried in the pedestal cap
  { u: 0.0, w: 0.3, d: 0.3 },
  { u: 0.05, w: 0.26, d: 0.26 },
  { u: 0.18, w: 0.235, d: 0.235 },
  { u: 0.32, w: 0.208, d: 0.212 },
  { u: 0.45, w: 0.2, d: 0.205 },
  { u: 0.545, w: 0.19, d: 0.165 }, // hips: wider than deep
  { u: 0.585, w: 0.152, d: 0.126 },
  { u: 0.6, w: 0.134, d: 0.109 }, // the belt itself — cinched
  { u: 0.618, w: 0.142, d: 0.117 },
  { u: 0.68, w: 0.158, d: 0.135 }, // ribs
  { u: 0.715, w: 0.164, d: 0.171 }, // bust: the one station deeper than wide
  { u: 0.745, w: 0.158, d: 0.15 },
  { u: 0.775, w: 0.163, d: 0.126 },
  { u: 0.815, w: 0.19, d: 0.108 }, // shoulders
  { u: 0.838, w: 0.135, d: 0.098 }, // trapezius
  { u: 0.858, w: 0.062, d: 0.062 }, // neck
  { u: 0.872, w: 0.058, d: 0.06 },
  { u: 0.888, w: 0.07, d: 0.078 }, // jaw
  { u: 0.912, w: 0.081, d: 0.093 },
  { u: 0.935, w: 0.086, d: 0.098 }, // cheekbones
  { u: 0.958, w: 0.086, d: 0.098 }, // brow
  { u: 0.978, w: 0.078, d: 0.092 }, // skull
  { u: 0.993, w: 0.046, d: 0.055 },
  { u: 1.004, w: 0.013, d: 0.015 }, // crown
]

/** The belt. Cloth is GATHERED here, so the folds pinch to nothing and burst. */
const BELT_U = 0.6
const BELT_HALF = 0.028

/**
 * Drapery fold depth as a fraction of the section radius, by height.
 *
 * Two things this is NOT: constant, and smooth through the waist. A chiton is
 * caught at the belt, so the fold amplitude collapses to nearly zero there and
 * blooms immediately above and below it — that pinch is the single most
 * recognisable thing about how a belted garment hangs, and a monotone taper
 * from hem to shoulder reads as a fluted column instead of as cloth.
 */
function foldAmount(u: number): number {
  if (u >= 0.845) return 0
  const stops: Array<[number, number]> = [
    [0.0, 0.185],
    [0.22, 0.168],
    [0.42, 0.125],
    [0.53, 0.09],
    [BELT_U, 0.028],
    [0.66, 0.078],
    [0.73, 0.055],
    [0.8, 0.026],
    [0.845, 0],
  ]
  let base = 0
  for (let i = 0; i < stops.length - 1; i++) {
    const [ua, va] = stops[i]
    const [ub, vb] = stops[i + 1]
    if (u <= ub) {
      const t = (u - ua) / (ub - ua)
      base = va + (vb - va) * t * t * (3 - 2 * t)
      break
    }
  }
  // The belt's own hard pinch, narrower than the stop spacing can express.
  const pinch = Math.exp(-(((u - BELT_U) / BELT_HALF) ** 2))
  return base * (1 - 0.72 * pinch)
}

/**
 * The fold's CROSS-SECTION shape, from a raw cosine in [−1, 1].
 *
 * Hanging cloth is not a sinusoid. It gathers into round tubular ridges
 * separated by narrow creases, because the fabric has bending stiffness and
 * cannot hold a sharp convex edge but will happily hold a sharp concave one.
 * Broadening the positive lobe and sharpening the negative one is the whole
 * difference between "fluting" and "drapery".
 */
function foldProfile(c: number): number {
  return c >= 0 ? Math.pow(c, 0.62) : -Math.pow(-c, 1.55) * 1.45
}

/** Smooth interpolation of the canon at an arbitrary `u`. */
function canonAt(u: number): { w: number; d: number } {
  if (u <= CANON[0].u) return { w: CANON[0].w, d: CANON[0].d }
  for (let i = 0; i < CANON.length - 1; i++) {
    const a = CANON[i]
    const b = CANON[i + 1]
    if (u <= b.u) {
      const t = (u - a.u) / (b.u - a.u)
      const e = t * t * (3 - 2 * t)
      return { w: a.w + (b.w - a.w) * e, d: a.d + (b.d - a.d) * e }
    }
  }
  const last = CANON[CANON.length - 1]
  return { w: last.w, d: last.d }
}

/**
 * The contrapposto spine: lateral (`s`) and forward (`f`) offset of the
 * section centre, metres, at height `u`. The figure's weight is on its left,
 * so the hips shift left, the shoulders right, the head back over the hip.
 */
function spine(u: number): { s: number; f: number } {
  const hip = Math.exp(-(((u - 0.56) / 0.22) ** 2))
  const shoulder = Math.exp(-(((u - 0.82) / 0.17) ** 2))
  const head = Math.exp(-(((u - 0.94) / 0.1) ** 2))
  return {
    s: hip * 0.034 - shoulder * 0.026 + head * 0.01,
    // A slight lean back through the chest — the figures are LOOKING UP at
    // the bowl they hold, and a vertical torso under raised arms reads stiff.
    f: -Math.max(0, u - 0.5) * 0.055 - head * 0.012,
  }
}

/**
 * Head modelling: brow, eye sockets, nose, lips, chin, cheekbone, jaw.
 *
 * Everything here is a Gaussian band in height times an angular window in
 * bearing, added to or cut out of the section radius. Cutting matters as much
 * as adding: an eye socket is a HOLLOW, and the shadow it casts under a low
 * sun is what makes a face read as a face at ten metres — far more than a nose
 * does. The features are deliberately soft and shallow. This is weathered
 * marble at heroic scale, not a portrait bust, and relief finer than the 96
 * sections can resolve only produces noise on the silhouette.
 */
function faceRelief(u: number, phi: number): number {
  if (u < 0.855 || u > 0.995) return 0
  const front = Math.cos(phi)
  if (front <= -0.1) return 0
  const side = Math.abs(Math.sin(phi))
  let relief = 0

  // Brow ridge: a broad low shelf across the front, heavier at the temples.
  relief += Math.exp(-(((u - 0.956) / 0.012) ** 2)) * Math.max(0, front - 0.35) * 0.016
  // Eye sockets: a pair of hollows either side of the nose bridge, cut IN.
  // Two lobes at ±0.55 rad, which is where eyes sit on a head this wide.
  for (const lobe of [-0.55, 0.55]) {
    const bearing = Math.exp(-(((phi - lobe) / 0.3) ** 2))
    relief -= Math.exp(-(((u - 0.941) / 0.011) ** 2)) * bearing * 0.017
  }
  // Nose: a narrow wedge off the brow, tallest at the tip.
  const noseBand = Math.exp(-(((u - 0.925) / 0.02) ** 2))
  const noseWedge = Math.max(0, front - 0.86) / 0.14
  relief += noseBand * noseWedge * noseWedge * 0.03
  // Cheekbones: the mass that catches the light either side of the nose.
  relief += Math.exp(-(((u - 0.933) / 0.014) ** 2)) * Math.max(0, side - 0.45) * 0.012
  // Mouth: a shallow horizontal crease with the lip mass just above it.
  relief -= Math.exp(-(((u - 0.9) / 0.006) ** 2)) * Math.max(0, front - 0.72) * 0.009
  relief += Math.exp(-(((u - 0.907) / 0.007) ** 2)) * Math.max(0, front - 0.7) * 0.007
  // Chin, and the jaw line running back from it.
  relief += Math.exp(-(((u - 0.883) / 0.012) ** 2)) * Math.max(0, front - 0.55) * 0.015
  relief -= Math.exp(-(((u - 0.878) / 0.009) ** 2)) * Math.max(0, side - 0.6) * 0.008
  return relief
}

/**
 * Hair: a mass over the skull weighted to the BACK, plus a low bun. Modelled
 * as added radius rather than as separate geometry — carved marble hair is
 * part of the same block, and a separate shell would need a seam it does not
 * have in stone either.
 */
function hairMass(u: number, phi: number): number {
  if (u < 0.855) return 0
  const back = Math.max(0, -Math.cos(phi))
  const crown = Math.exp(-(((u - 0.955) / 0.055) ** 2))
  const bun = Math.exp(-(((u - 0.912) / 0.028) ** 2)) * Math.pow(back, 2.2)
  // A thin cap all the way round, thickening hard toward the back, plus the
  // low bun a caryatid needs to carry the load path off her skull.
  let hair = crown * (0.009 + 0.038 * Math.pow(back, 1.4)) + bun * 0.034
  // Waves: six strands swept back from a centre part. Carved hair is a set of
  // ridges, and without them the head is an egg in a swimming cap. The part
  // itself is the `1 − exp` — a real groove down the middle of the front.
  const swept = Math.exp(-(((u - 0.945) / 0.05) ** 2))
  hair += swept * 0.006 * Math.cos(phi * 6 + 0.4) * (0.6 + 0.4 * back)
  hair -= swept * 0.007 * Math.exp(-((phi / 0.16) ** 2))
  return hair
}

/**
 * The himation: a swag of cloth thrown over one shoulder and across the body.
 *
 * A band of added radius along a DIAGONAL on the torso, with its own folds and
 * a defined edge. This is the piece that turns a smooth torso into a clothed
 * one — it gives the chest a second silhouette and a hard shadow line, which
 * is what the eye reads as "drapery" long before it reads any individual fold.
 */
function himationBand(u: number, phi: number, mirror: number): number {
  if (u < 0.56 || u > 0.86) return 0
  // The band's centre line runs from the right shoulder to the left hip.
  const center = 0.83 - Math.abs(phi * mirror - 0.35) * 0.09 - (phi * mirror) * 0.115
  const across = (u - center) / 0.085
  if (Math.abs(across) > 1.6) return 0
  const body = Math.exp(-(across * across))
  // Its own folds, running ALONG the band rather than around the body.
  const folds = 0.35 + 0.65 * Math.abs(Math.cos(phi * 5 + u * 9))
  return body * (0.019 + 0.011 * folds)
}

interface FigureVariant {
  /** Fold phase offset, so four figures are not four copies. */
  foldPhase: number
  /** Head turn, radians. */
  headTurn: number
  /** Mirror the contrapposto (weight on the other leg). */
  mirror: boolean
}

/** One figure's body: the single closed loft from hem to crown. */
function figureBody(
  origin: Vector3,
  side: Vector3,
  forward: Vector3,
  variant: FigureVariant,
): ReturnType<typeof loft> {
  const stations: number[] = []
  for (const entry of CANON) stations.push(entry.u)
  // Subdivide between canon stations so the folds have somewhere to live and
  // the head has enough rings to carry a brow.
  // Subdivide between canon stations. The head and the belt get the most: a
  // brow is a 12 mm band, and a belt pinch that only two rings sample reads as
  // a dent rather than as a gathered waist.
  const fine: number[] = []
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]
    const b = stations[i + 1]
    const steps = b > 0.85 ? 7 : b > 0.55 && a < 0.7 ? 6 : 4
    for (let k = 0; k < steps; k++) fine.push(a + ((b - a) * k) / steps)
  }
  fine.push(stations[stations.length - 1])

  const mirror = variant.mirror ? -1 : 1
  const rings: Vec3[][] = fine.map((u) => {
    const { w, d } = canonAt(u)
    const offset = spine(u)
    const fold = foldAmount(u)
    // The head turns as a whole: its rings rotate about the body axis.
    const turn = variant.headTurn * Math.max(0, Math.min(1, (u - 0.845) / 0.05))
    // Some folds are deep and some are shallow. A low-frequency envelope over
    // the fold amplitude is what stops a garment reading as machined fluting;
    // real cloth has three or four DOMINANT folds and a dozen minor ones.
    const ring: Vec3[] = []
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const phi = (s / RING_SEGMENTS) * TAU - turn
      const envelope = 0.55 + 0.45 * Math.cos(3 * phi + 1.9 * u + variant.foldPhase * 0.7)
      // Two harmonics whose phase advances with height: folds spiral, and no
      // single fold runs the whole garment. `foldProfile` then reshapes the
      // raw cosine into round ridges with creased valleys.
      const ripple =
        0.62 * foldProfile(Math.cos(9 * phi + 2.4 * u + variant.foldPhase)) +
        0.38 * foldProfile(Math.cos(14 * phi - 1.7 * u + variant.foldPhase * 1.7))
      const brk = 0.76 + 0.24 * Math.cos(u * 11.4 + phi * 2 + variant.foldPhase)
      const scale = 1 + fold * ripple * brk * envelope
      const extra =
        hairMass(u, phi) + faceRelief(u, phi) + himationBand(u, phi, mirror)
      const localS = Math.cos(phi) * (w * scale + extra) + offset.s * mirror
      const localF = Math.sin(phi) * (d * scale + extra) + offset.f
      ring.push([
        origin.x + side.x * localS + forward.x * localF,
        origin.z + side.z * localS + forward.z * localF,
        origin.y + PEDESTAL_TOP_Y + u * FIGURE_HEIGHT,
      ] as Vec3)
    }
    return ring
  })

  // Closed by its two flat end discs (the hem is buried in the pedestal cap,
  // the crown ring is 26 mm across), so `recalcNormals` orients it by signed
  // volume and the winding cannot come out inside-out.
  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  smoothShade(md, SMOOTH.shell)
  cleanMesh(md)
  toYUp(md)
  return md
}

/**
 * The apoptygma — the peplos' shoulder overfold.
 *
 * A CLOSED shell: the outer face falls from inside the shoulders to the hem,
 * the inner face returns, and the last ring is a verbatim copy of the first,
 * so `cleanMesh` welds the seam and `recalcNormals` gets a watertight
 * component to orient by volume. The strip between the two hem rings is the
 * garment's real 13 mm edge — the one hard cloth boundary on the figure, and
 * the thing that stops the upper body reading as nude.
 */
function figureOverfold(
  origin: Vector3,
  side: Vector3,
  forward: Vector3,
  variant: FigureVariant,
): ReturnType<typeof loft> {
  // The top sits ABOVE the shoulder line and INSIDE the body (negative gap),
  // so the garment's top edge is buried in the torso solid rather than
  // floating as a collar.
  const top = 0.826
  const bottom = 0.555
  const mirror = variant.mirror ? -1 : 1
  const shellRing = (u: number, out: boolean, hemPhase: number): Vec3[] => {
    const { w, d } = canonAt(u)
    const offset = spine(u)
    const buried = Math.max(0, (u - 0.79) / 0.036)
    const gap = (out ? 0.021 : 0.008) - buried * 0.045
    const ring: Vec3[] = []
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const phi = (s / RING_SEGMENTS) * TAU
      const ripple =
        0.6 * Math.cos(7 * phi + 3.1 * u + variant.foldPhase) +
        0.4 * Math.cos(12 * phi - 2.2 * u + variant.foldPhase)
      const fold = 0.05 * Math.min(1, (top - u) / 0.16 + 0.2) * (1 - buried)
      const localS = Math.cos(phi) * (w + gap + fold * ripple) + offset.s * mirror
      const localF = Math.sin(phi) * (d + gap + fold * ripple) + offset.f
      // The garment edge dips where a fold hangs — a straight hem on a folded
      // cloth is the single most artificial thing a draped figure can have.
      const hem = hemPhase * 0.026 * Math.cos(7 * phi + variant.foldPhase)
      ring.push([
        origin.x + side.x * localS + forward.x * localF,
        origin.z + side.z * localS + forward.z * localF,
        origin.y + PEDESTAL_TOP_Y + (u - hem) * FIGURE_HEIGHT,
      ] as Vec3)
    }
    return ring
  }

  const rings: Vec3[][] = []
  const steps = 9
  for (let i = 0; i <= steps; i++) rings.push(shellRing(top + (bottom - top) * (i / steps), true, i / steps))
  for (let i = steps; i >= 0; i--) rings.push(shellRing(top + (bottom - top) * (i / steps), false, i / steps))
  rings.push(rings[0].map((v) => [...v] as Vec3))

  const md = loft(rings, { closeV: true })
  smoothShade(md, SMOOTH.shell)
  cleanMesh(md)
  toYUp(md)
  return md
}

/**
 * One raised arm, swept with a per-station scale so the deltoid, the elbow and
 * the wrist are real diameters rather than a constant tube.
 *
 * The shoulder station is PINNED to the body's shoulder height and everything
 * above it is stretched to land the fingertips 30 mm inside the tazza. So the
 * arm cannot end in air, and it cannot punch through the bowl either, however
 * the bowl or the figure's height is later re-authored.
 */
function figureArm(
  writer: PartWriter,
  origin: Vector3,
  side: Vector3,
  forward: Vector3,
  handSign: number,
  variant: FigureVariant,
): void {
  // (lateral, forward, raw height above the feet, section radius). The first
  // station starts INSIDE the torso, so the two solids share an interior
  // instead of meeting on a shoulder seam that could gap or z-fight.
  const stations: Array<[number, number, number, number]> = [
    [0.1, -0.012, 1.44, 0.062],
    [0.176, 0.0, 1.471, 0.058],
    [0.215, 0.012, 1.559, 0.046],
    [0.228, 0.026, 1.67, 0.04],
    [0.224, 0.032, 1.781, 0.039],
    [0.198, 0.03, 1.9, 0.041],
    [0.168, 0.024, 2.009, 0.033],
    [0.142, 0.018, 2.091, 0.027],
    [0.128, 0.014, 2.151, 0.042],
    [0.118, 0.012, 2.215, 0.03],
  ]
  const shoulderRaw = stations[0][2]
  const tipRaw = stations[stations.length - 1][2]
  const tipTarget = FIGURE_REACH_Y - PEDESTAL_TOP_Y + 0.03
  const stretch = (tipTarget - shoulderRaw) / (tipRaw - shoulderRaw)

  const path: Vec3[] = []
  const scale: Vec2[] = []
  for (const [lateral, fwd, raw, radius] of stations) {
    const above = shoulderRaw + (raw - shoulderRaw) * stretch
    const s = lateral * handSign * (variant.mirror ? -1 : 1)
    const f = fwd + spine(Math.min(1, above / FIGURE_HEIGHT)).f
    path.push([
      origin.x + side.x * s + forward.x * f,
      origin.y + PEDESTAL_TOP_Y + above,
      origin.z + side.z * s + forward.z * f,
    ] as Vec3)
    // Hands flatten a little; the sweep frame is rotation-minimising so the
    // flattening plane is arbitrary, which is fine for a mass this small and
    // this occluded, and wrong-looking only if it were pushed hard.
    scale.push([radius, raw > 2.1 ? radius * 0.72 : radius] as Vec2)
  }

  const circle: Vec2[] = []
  const sides = 12
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU
    circle.push([Math.cos(a), Math.sin(a)] as Vec2)
  }
  const md = tubeAlong(path, circle, { up: [0, 0, 1], cap: true, scale })
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.shell)
  cleanMesh(md)
  writeInto(writer, 'stone', md, { uvScale: 1.4 })
}

/**
 * Build the four figures around the axis. `center` is the fountain axis at the
 * court's paved top, in world coordinates.
 */
export function buildFountainFigures(writer: PartWriter, center: Vector3): void {
  for (let i = 0; i < FIGURE_COUNT; i++) {
    const bearing = (i / FIGURE_COUNT) * TAU + Math.PI / 4
    const forward = new Vector3(Math.cos(bearing), 0, Math.sin(bearing))
    const side = new Vector3(-Math.sin(bearing), 0, Math.cos(bearing))
    const origin = new Vector3(
      center.x + forward.x * FIGURE_RADIUS,
      center.y,
      center.z + forward.z * FIGURE_RADIUS,
    )
    const variant: FigureVariant = {
      foldPhase: i * 1.83,
      // Alternating head turns: the group reads as four people rather than
      // four instances, and it breaks the perfect four-fold symmetry that
      // makes any radial arrangement look like a CAD pattern.
      headTurn: (i % 2 === 0 ? 1 : -1) * (0.12 + 0.05 * (i % 3)),
      mirror: i % 2 === 1,
    }
    writeInto(writer, 'stone', figureBody(origin, side, forward, variant), { uvScale: 1.3 })
    writeInto(writer, 'stone', figureOverfold(origin, side, forward, variant), { uvScale: 1.3 })
    figureArm(writer, origin, side, forward, 1, variant)
    figureArm(writer, origin, side, forward, -1, variant)
  }
}
