import { AMPHITHEATER, BOULEVARD, PADS } from './parkPlan'
import { PAVE, pavedSignedDistance } from './pavingPlan'

/**
 * The park floor's two datums.
 *
 *   `groundGrade(x,z)`  — the REGOLITH surface: graded civic ground (long
 *                         swales, flatter toward the centre) with real
 *                         high-frequency relief on open ground only.
 *   `interiorHeight(x,z)` — the WALKABLE surface: grade plus the paved lift.
 *                         Physics, prop placement, the guideway datum and
 *                         every foundation read this one, so anything that
 *                         stands on paving stands on the paving, not under it.
 *
 * Pure and deterministic; no allocation. Paving is dead flat over the grade,
 * pads flatten entirely, and the amphitheater bowl is authored, not dug.
 */

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function valueNoise(x: number, z: number, wavelength: number): number {
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = smooth(fx - ix)
  const tz = smooth(fz - iz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return (a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * tz) * 2 - 1
}

/**
 * Fine regolith relief — the difference between "desert plane" and ground.
 * Amplitude is deliberately small (±9 cm) and the wavelengths are ≥3.5 m so
 * the floor mesh (≈0.8 m stations) resolves them instead of aliasing, and so
 * light rakes across the surface without props looking marooned.
 */
function reliefDetail(x: number, z: number): number {
  return (
    valueNoise(x + 71, z - 133, 4.4) * 0.055 +
    valueNoise(x - 517, z + 88, 11.5) * 0.036 +
    valueNoise(x + 331, z + 977, 21) * 0.03
  )
}

/** The regolith surface: what the floor mesh draws and paving sits on. */
export function groundGrade(x: number, z: number): number {
  const r = Math.hypot(x, z)

  // Long swales, ±0.75 m at most. The amplitude profile keeps the civic core
  // near-flat and lets the open ground out toward the rim breathe — and it
  // COLLAPSES around every authored pad, because a pad's 5–8 m skirt cannot
  // climb a metre of swale without turning into a 25% ramp under the paving.
  let padProximity = 0
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    const reach = pad.skirt * 4
    if (d < pad.radius + reach) {
      padProximity = Math.max(
        padProximity,
        smooth(clamp01(1 - Math.max(0, d - pad.radius) / reach)),
      )
    }
  }
  const openness = smooth(clamp01((r - 22) / 64))
  const swaleAmplitude = (0.28 + 0.47 * openness) * (1 - 0.72 * padProximity)
  let height =
    (valueNoise(x + 913, z - 407, 88) * 0.74 + valueNoise(x - 220, z + 551, 33) * 0.3) *
    swaleAmplitude

  // A gentle crown so the floor drains outward. Kept LOW: the original 0.9 m
  // crown sat the plaza pad in a bowl and swallowed every curb around it.
  height += 0.34 * (1 - smooth(Math.min(1, r / 118)))

  // Structural guard: an authored dish may never intrude into the tram
  // boulevard — a street cannot ride a 2.6 m bowl. parkPlan now seats the
  // amphitheater well inside r=91, so this clamp is inert; it stays because
  // it makes the invariant impossible to break by moving a constant.
  const bowlClearance = smooth(clamp01((BOULEVARD.innerRadius - 2 - r) / 8))
  const bowlDistance = Math.hypot(x - AMPHITHEATER.x, z - AMPHITHEATER.z)
  const bowlOuter = AMPHITHEATER.bowlRadius + 24
  let flatness = 0
  if (bowlDistance < bowlOuter && bowlClearance > 0) {
    const t = Math.max(0, 1 - bowlDistance / bowlOuter)
    const dish = 0.9 - AMPHITHEATER.depth * smooth(t)
    const authority = smooth(Math.min(1, t * 2)) * bowlClearance
    height = height * (1 - authority) + dish * authority
    flatness = Math.max(flatness, authority)
  }

  // Authored pads flatten everything inside their radius. The skirt is eased
  // over 1.8× its authored width: parkPlan's 5–8 m skirts against 0.5–1.4 m
  // steps are 20%+ ramps at their steepest, which is fine for dirt and wrong
  // for a paved promenade. The flat area itself is untouched.
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    const skirt = pad.skirt * 1.8
    if (d < pad.radius + skirt) {
      const blend = d < pad.radius ? 1 : smooth(1 - (d - pad.radius) / skirt)
      height = height * (1 - blend) + pad.y * blend
      flatness = Math.max(flatness, blend)
    }
  }

  // Relief lives on OPEN ground only: never under paving (the slab would
  // poke through), never on a pad (pads are poured flat by definition).
  const sd = pavedSignedDistance(x, z)
  const clearOfPaving = smooth(clamp01((sd - 0.5) / 2.2))
  const open = (1 - flatness) * clearOfPaving
  if (open > 0) height += reliefDetail(x, z) * open

  return height
}

/** The walkable surface: regolith grade + the paved slab lift. */
export function interiorHeight(x: number, z: number): number {
  const sd = pavedSignedDistance(x, z)
  if (sd >= PAVE.edgeFade) return groundGrade(x, z)
  const coverage = sd <= 0 ? 1 : 1 - smooth(sd / PAVE.edgeFade)
  return groundGrade(x, z) + PAVE.rise * coverage
}
