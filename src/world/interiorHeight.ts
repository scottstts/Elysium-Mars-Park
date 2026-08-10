import { AMPHITHEATER, PADS } from './parkPlan'

/**
 * The park floor: gently sculpted regolith relief (±2.5 m) flattened dead
 * level at every authored pad, with the amphitheater bowl dug in. Pure and
 * deterministic — physics heightfield, floor mesh, path ribbons, and prop
 * placement all sample this one function.
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

export function interiorHeight(x: number, z: number): number {
  // Base relief: long swales with a hint of finer texture.
  let height =
    valueNoise(x + 913, z - 407, 130) * 1.9 +
    valueNoise(x - 220, z + 551, 47) * 0.55 +
    valueNoise(x + 77, z + 1000, 11) * 0.14

  // The floor eases down toward the rim so the promenade sits low and the
  // center reads as a gentle crown under the tree.
  const r = Math.hypot(x, z)
  height += 1.3 * (1 - smooth(Math.min(1, r / 240)))

  // Amphitheater bowl: an AUTHORED dish, not a dig — inside the bowl the
  // base noise is blended out entirely, or the ±1.9 m relief drowns the
  // 3.4 m rake and the seat rows land on accidental terrain.
  const bowlDistance = Math.hypot(x - AMPHITHEATER.x, z - AMPHITHEATER.z)
  const bowlOuter = AMPHITHEATER.bowlRadius + 24
  if (bowlDistance < bowlOuter) {
    const t = Math.max(0, 1 - bowlDistance / bowlOuter)
    const dish = 0.9 - AMPHITHEATER.depth * smooth(t)
    const authority = smooth(Math.min(1, t * 2))
    height = height * (1 - authority) + dish * authority
  }

  // Authored pads flatten everything inside their radius, easing over skirts.
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    if (d < pad.radius + pad.skirt) {
      const blend = d < pad.radius ? 1 : smooth(1 - (d - pad.radius) / pad.skirt)
      height = height * (1 - blend) + pad.y * blend
    }
  }

  return height
}
