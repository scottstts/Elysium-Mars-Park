import { Vector3 } from 'three'
import { SMOOTH, cleanMesh, loft, smoothShade } from '../archkit/meshdata'
import type { MeshData, Vec2, Vec3 } from '../archkit/meshdata'
import { writeInto } from '../archkit/meshdata'
import type { PartWriter } from '../archkit/writer'
import {
  LOWER_TAZZA,
  PEDESTAL_TOP_Y,
  SCULPTURE_COUNT,
  SCULPTURE_RADIUS,
  tazzaUndersideY,
} from './fountainPlan'

/**
 * THE VORTEX RING — four dust devils turned to stone, carrying the bowl.
 *
 * The park's whole vista is ringed by the dead planet, and on a good afternoon
 * you can watch a real dust devil walk the valley floor through the glass. The
 * fountain monumentalises exactly that: the one place the colony spends its
 * water in public is held up by Mars' own dry weather, petrified — wind
 * carrying water. No human figures; a colony of eighty that carves gods
 * hasn't earned them yet, but everyone here has watched a devil cross the
 * plain and understood the planet a little better.
 *
 * ## Why this is the right shape for PROCEDURAL sculpture
 *
 * A draped human figure lives or dies on a thousand anatomical judgements a
 * parametric loft cannot make — the previous caryatids proved it. A vortex is
 * the opposite kind of object: its whole identity IS a mathematical form —
 * a lobed column under a helical twist with an axial meander — and a loft
 * renders that form EXACTLY, at any resolution, with no judgement calls to
 * miss. The craft moves from imitating anatomy (where procedure is weakest)
 * to composing curvature (where it is strongest).
 *
 * ## Anatomy of one column
 *
 *   skirt   the wide turbulent foot every devil drags across the ground,
 *           here merging into the pedestal cap it stands on
 *   funnel  the tightening waist — the vortex proper — five braided lobes
 *           spiralling upward, twist ACCELERATING with height (real vortices
 *           tighten as they stretch), counter-spiralled by fine striations
 *           at the scale dust streamlines actually draw on a funnel wall
 *   mouth   the flare where it meets the tazza's underside; the last rings
 *           MORPH onto the dome's own surface (each vertex seats from
 *           `tazzaUndersideY` at its own radius, buried 30 mm), so the
 *           column welds into the bowl whatever the bowl's future shape
 *
 * The four share one rotation sense — a cyclonic family, not mirrored
 * bookends — and differ in twist rate, phase and meander, so they read as
 * four individuals of one species. All heights are DERIVED from the pedestal
 * cap and the tazza underside; nothing here can float or clip when the bowl
 * is re-authored.
 *
 * The baked `uv.x` cavity channel (the `sculpture` material reads it as
 * crevice occlusion) comes from the lobe valleys — the analytic groove depth,
 * exact and free, the same trick the caryatids pioneered.
 */

const TAU = Math.PI * 2
const SEGMENTS = 96
const RINGS = 88

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const smooth01 = (x: number): number => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
const gauss = (x: number, sigma: number): number => Math.exp(-((x / sigma) ** 2))

interface VortexVariant {
  /** Lobe pattern phase at the base, radians. */
  phase: number
  /** Total twist in turns (all positive: one cyclonic family). */
  turns: number
  /** Meander phase and amplitude scale. */
  wobblePhase: number
  wobble: number
}

/** Per-face-corner cavity uvs from a per-vertex array (ring-major order). */
function bakeCavity(md: MeshData, cavity: number[]): void {
  md.uvs = md.faces.map((face) => face.map((vi) => [cavity[vi] ?? 0, 0] as Vec2))
}

/** The column's smooth body radius at height fraction `u`, before lobes. */
function bodyRadius(u: number): number {
  const skirt = 0.205 * gauss(u, 0.14)
  const swell = 0.032 * Math.sin(Math.PI * Math.pow(smooth01((u - 0.06) / 0.94), 0.9))
  // The mouth flare is MODEST — the weld band above seats it into the dome,
  // and a wide flare flattening onto that surface smears sideways into a
  // melted skirt (shipped once; it read as cheese, not wind).
  const flare = 0.05 * gauss(1 - u, 0.07)
  return 0.128 + skirt + swell + flare
}

/**
 * One vortex: a single closed loft, base buried in the pedestal cap, mouth
 * welded into the tazza underside. Authored directly in world Y-up.
 */
function buildVortex(
  writer: PartWriter,
  center: Vector3,
  bearing: number,
  variant: VortexVariant,
): void {
  const standX = center.x + Math.cos(bearing) * SCULPTURE_RADIUS
  const standZ = center.z + Math.sin(bearing) * SCULPTURE_RADIUS
  const baseY = center.y + PEDESTAL_TOP_Y
  // The mouth's centre seats on the dome; individual vertices re-seat below.
  const topY = center.y + tazzaUndersideY(LOWER_TAZZA, SCULPTURE_RADIUS) + 0.03
  const height = topY - baseY

  const cavity: number[] = []
  const rings: Vec3[][] = []
  for (let i = 0; i <= RINGS; i++) {
    // Ring stations bunch toward the two ends, where the skirt and the mouth
    // carry the fastest profile changes.
    const t = i / RINGS
    const u = t * t * (3 - 2 * t) * 0.2 + t * 0.8

    const body = bodyRadius(u)
    // Twist accelerates with height — a stretching vortex spins up. The lobe
    // depth fades more gently: the braid must stay legible all the way to the
    // mouth or the top third reads as a plain turned baluster.
    const twist = variant.phase + variant.turns * TAU * Math.pow(u, 1.12)
    const lobeDepth = body * 0.17 * (1 - 0.32 * u)
    const striaDepth = body * 0.026 * (1 - 0.5 * u)

    // Frozen meander: pinned at both ends (it stands on its foot and holds
    // the bowl), leaning through a gentle helical S between them.
    const meander = variant.wobble * 0.052 * Math.sin(Math.PI * u) * (0.35 + 0.65 * u)
    const meanderAng = variant.wobblePhase + u * 2.6
    const cx = standX + Math.cos(meanderAng) * meander
    const cz = standZ + Math.sin(meanderAng) * meander

    // The mouth weld: the last few rings morph from their own plane onto the
    // tazza underside + 30 mm, per VERTEX, so the flare hugs the dome. A
    // SHORT band — welding early is what smeared the first pass sideways.
    const weld = smooth01((u - 0.955) / 0.045)
    const ringY = baseY - 0.05 + (height + 0.05) * u

    const ring: Vec3[] = []
    for (let s = 0; s < SEGMENTS; s++) {
      const theta = (s / SEGMENTS) * TAU
      // Five braided lobes: rounded crests, narrowed grooves (a raw cosine is
      // machine fluting — same lesson the drapery paid for).
      const raw = 0.5 + 0.5 * Math.cos(5 * theta + twist)
      const shaped = Math.pow(raw, 1.35) * 2 - 1
      // Counter-spiralling striations — the streamlines dust actually draws.
      const striae = Math.cos(16 * theta - twist * 2.2) * striaDepth
      const radius = body + shaped * lobeDepth + striae
      cavity.push(clamp01(0.5 - shaped * 0.5) * 0.85 * (1 - 0.3 * u))
      const px = cx + Math.cos(theta) * radius
      const pz = cz + Math.sin(theta) * radius
      const rFromAxis = Math.hypot(px - center.x, pz - center.z)
      const domeY = center.y + tazzaUndersideY(LOWER_TAZZA, rFromAxis) + 0.03
      ring.push([px, ringY * (1 - weld) + domeY * weld, pz] as Vec3)
    }
    rings.push(ring)
  }

  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  md.frame = 'y-up'
  bakeCavity(md, cavity)
  smoothShade(md, SMOOTH.shell)
  cleanMesh(md)
  writeInto(writer, 'sculpture', md, { uvScale: 1.3 })
}

/**
 * Build the sculpture ring. `center` is the fountain axis at the court's
 * paved top, in world coordinates.
 */
export function buildFountainVortices(writer: PartWriter, center: Vector3): void {
  for (let i = 0; i < SCULPTURE_COUNT; i++) {
    const bearing = (i / SCULPTURE_COUNT) * TAU + Math.PI / 4
    buildVortex(writer, center, bearing, {
      phase: i * 1.83,
      // One rotation sense, four tempers: the twist rates differ enough to
      // read as individuals and not enough to break the family.
      turns: 2.15 + 0.18 * ((i * 2.39) % 1),
      wobblePhase: i * 2.41 + 0.6,
      wobble: 0.75 + 0.3 * ((i * 3.77) % 1),
    })
  }
}
