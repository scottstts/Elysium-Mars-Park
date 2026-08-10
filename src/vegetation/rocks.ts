import type { MeshData, Vec3 } from '../archkit/meshdata'
import { cleanMesh, loft, placeYaw, smoothShade, toYUp } from '../archkit/meshdata'

/**
 * Lofted rock forms with real bedding. A boulder in the Regolith Gardens is
 * SCULPTURE — it stands where a sculpture would stand and is read from two
 * metres — so it cannot be a scaled icosphere or a noise blob.
 *
 * Three laws build the form, and each does one job:
 *
 *   1. `shape(v)` — the silhouette: broad at the ground, rounding to a small
 *      weathered crown. A flat top facet is real; a pole is not.
 *   2. `lump(θ, v)` — massing, from INTEGER θ harmonics only. A non-integer
 *      harmonic does not close around the rock and leaves a seam ridge, which
 *      is exactly the defect that makes procedural rocks look procedural.
 *   3. `strata(θ, v)` — dipping sedimentary beds. Each bed steps proud with a
 *      sharp lower edge and a soft top, and the bed planes TILT (`dip` about
 *      `strike`), so the rock records a direction. Horizontal bands read as a
 *      lathe; dipping ones read as geology.
 *
 * Authored Z-up (archkit convention); `rockMesh` returns Y-up and placed.
 */

export interface RockOptions {
  /** Mean horizontal radius at the ground line, metres. */
  radius: number
  /** Total height including the buried part. */
  height: number
  seed: number
  /** Long axis stretch; 1 is equant, 1.8 is a slab. */
  elongation?: number
  /** Fraction of the height that sits below the ground plane. */
  bury?: number
  levels?: number
  segments?: number
  bands?: number
  bedAmount?: number
  /** Bed dip, as a fraction of one band per unit radius. */
  dip?: number
  lumpiness?: number
}

function lump(theta: number, v: number, seed: number): number {
  return (
    (Math.sin(2 * theta + seed * 1.3 + v * 1.1) * 0.5 +
      Math.sin(3 * theta - seed * 2.1 + v * 0.7) * 0.32 +
      Math.sin(5 * theta + seed * 0.7 - v * 1.6) * 0.2 +
      Math.sin(8 * theta + seed * 3.3 + v * 2.2) * 0.13 +
      Math.sin(13 * theta - seed * 1.9 + v * 3.4) * 0.08 +
      Math.sin(19 * theta + seed * 4.7 - v * 2.8) * 0.05) /
    1.28
  )
}

/**
 * The bed profile across one band, in [0,1] → a radial multiplier offset.
 *
 * This is a RISER-AND-TREAD, not a smooth wave, and that is the whole point.
 * The first pass used `pow(f, 0.45)`, which spreads a 6 cm radius change over
 * a 40 cm band — an 8° slope. `smoothShade` then averaged it away and every
 * boulder rendered as a soap bar. A bed has to change the surface angle by
 * MORE than the smooth threshold or it does not exist.
 */
function bedProfile(f: number): number {
  const riser = 0.16
  return f < riser ? f / riser - 0.55 : 0.45 - (f - riser) / (1 - riser) * 0.12
}

/**
 * Build one rock. Returns a Y-up `MeshData` centred on the ground plane at
 * the origin — the caller places it with `placeRock`.
 */
export function rockMesh(options: RockOptions): MeshData {
  const {
    radius,
    height,
    seed,
    elongation = 1.25,
    bury = 0.22,
    levels = 14,
    segments = 30,
    bands = 5,
    bedAmount = 0.13,
    dip = 0.42,
    lumpiness = 0.3,
  } = options

  const strike = seed * 1.7
  const rings: Vec3[][] = []
  for (let level = 0; level <= levels; level++) {
    const v = level / levels
    const z = (v - bury) * height
    const shape = Math.max(0.1, Math.pow(1 - Math.pow(v, 1.8), 0.42))
    const ring: Vec3[] = []
    for (let s = 0; s < segments; s++) {
      const theta = (Math.PI * 2 * s) / segments
      let r = radius * shape * (1 + lumpiness * lump(theta, v, seed))
      // Bedding: beds dip, so the band coordinate leans with θ.
      const bed = v * bands + dip * Math.cos(theta - strike)
      const f = bed - Math.floor(bed)
      // Weathering softens the beds toward the crown.
      const weather = 1 - Math.pow(v, 1.6) * 0.55
      r *= 1 + bedAmount * weather * bedProfile(f)
      ring.push([
        Math.cos(theta) * r * elongation,
        (Math.sin(theta) * r) / elongation,
        z,
      ])
    }
    rings.push(ring)
  }

  // Stacked-ring loft: v wraps (the angular loop), u steps up the levels.
  const mesh = loft(rings, { closeV: true, capStart: true, capEnd: true })
  // 20°: the bed risers crease hard, the tread between them stays smooth.
  // Anything above ~30 here smooths the beds back out.
  smoothShade(mesh, 20)
  cleanMesh(mesh)
  return toYUp(mesh)
}

/** Place a rock at a world point with a yaw. */
export function placeRock(mesh: MeshData, x: number, y: number, z: number, yaw: number): MeshData {
  return placeYaw(mesh, [x, y, z], yaw)
}
