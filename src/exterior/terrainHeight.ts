/**
 * Exterior Elysium Planitia height function — pure, deterministic, cheap.
 * Sampled by the terrain ring meshes and by prop placement; the interior
 * park floor (S5) is a separate authored surface, so this function only
 * matters outside the dome pad (r > ~300 m).
 *
 * Coordinates: +X east, +Z south, dome center at origin.
 */

/** Stable 2D lattice hash (no RNG state — same input, same output, always). */
function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Value noise over a given wavelength. */
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

function fbm(x: number, z: number, wavelength: number, octaves: number): number {
  let amplitude = 1
  let frequencyScale = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequencyScale + i * 137.7, z * frequencyScale - i * 91.3, wavelength) * amplitude
    norm += amplitude
    amplitude *= 0.52
    frequencyScale *= 2.03
  }
  return sum / norm
}

/** Crater: center 600 E, 3300 S; rim radius 2.6 km. */
const CRATER_X = 600
const CRATER_Z = 3300
const CRATER_RADIUS = 2600
const CRATER_RIM_WIDTH = 720
const CRATER_RIM_HEIGHT = 88

/** Mesa base mounds (hero cliff meshes sit on top of these talus rises). */
export const MESA_SITES: ReadonlyArray<{
  x: number
  z: number
  footprint: number
  capHeight: number
}> = [
  { x: -5200, z: -900, footprint: 820, capHeight: 340 },
  { x: -6100, z: 600, footprint: 640, capHeight: 265 },
  { x: -4300, z: 1500, footprint: 460, capHeight: 195 },
  { x: -6800, z: -2400, footprint: 980, capHeight: 430 },
]

export function exteriorHeight(x: number, z: number): number {
  const r = Math.hypot(x, z)

  // Broad plain undulation + micro relief.
  let height = fbm(x, z, 950, 4) * 7.5 + fbm(x + 4000, z - 2500, 92, 2) * 0.85

  // Crater rim to the south: a noisy ring with a shallow interior dish.
  const craterDistance = Math.hypot(x - CRATER_X, z - CRATER_Z)
  const rimWobble = fbm(x * 0.6, z * 0.6, 1400, 2) * 260
  const rimOffset = Math.abs(craterDistance - (CRATER_RADIUS + rimWobble))
  const rimShape = Math.max(0, 1 - rimOffset / CRATER_RIM_WIDTH)
  height += smooth(rimShape) * CRATER_RIM_HEIGHT * (0.75 + 0.5 * fbm(x, z, 500, 2))
  if (craterDistance < CRATER_RADIUS - CRATER_RIM_WIDTH * 0.4) {
    const dish = smooth(Math.min(1, (CRATER_RADIUS - craterDistance) / CRATER_RADIUS))
    height -= dish * 14
  }

  // Talus mounds under the west mesa cluster.
  for (const mesa of MESA_SITES) {
    const mesaDistance = Math.hypot(x - mesa.x, z - mesa.z)
    const mound = Math.max(0, 1 - mesaDistance / (mesa.footprint * 2.6))
    height += smooth(mound) * mesa.capHeight * 0.16
  }

  // The colonists graded the dome pad dead flat out to the apron.
  const padBlend = smooth(Math.min(1, Math.max(0, (r - 280) / 260)))
  return height * padBlend
}
