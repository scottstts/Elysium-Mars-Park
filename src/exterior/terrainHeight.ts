import { sunDirection } from '../sky/sun'
import { interiorHeight } from '../world/interiorHeight'

/**
 * Exterior Elysium terrain — pure, deterministic, cheap.
 *
 * The park does NOT sit on an open plain: it sits on the flat floor of a
 * walled valley, ringed by rocky Mars mountains (ref_images/mars_park.png).
 * The field is built as three radial bands so the silhouette layers and
 * reads with parallax from the rim promenade:
 *
 *   0.5–2.0 km    foothills, choppy 100–250 m ridges
 *   1.0–4.4 km    the main wall, 300–900 m massifs
 *   3.2 km+       far highlands closing the horizon (mostly haze)
 *
 * Two things are carved back out of that wall on purpose:
 *   - the SOUTH PASS, a widening corridor along +Z that the arrival tube and
 *     the spaceport road run through (the tube must never pierce rock);
 *   - the SUN WINDOW, a shallow saddle on the WSW bearing so the frozen 27°
 *     sun always clears the ridgeline from the park floor.
 *
 * PERFORMANCE CONTRACT: this runs ~420 k times on the CPU at boot (one
 * evaluation per terrain vertex) plus every prop placement, so every term is
 * written for speed — integer lattice hashes, hard early-outs whenever a band
 * contributes nothing, no allocation, no Math.hypot — and the detail is
 * radius-gated so the field is band-limited to what the ring LOD can actually
 * tessellate. Keep it that way.
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

/** smoothstep over 0..1 with clamping (the CPU twin of TSL smoothstep). */
function smoothClamp(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** Value noise over a given wavelength, −1..1. */
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
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return (top + (bottom - top) * tz) * 2 - 1
}

/** Eight unit gradients — the ridge field needs gradient noise, not value
 * noise: value noise's zero set is a broad smooth band, so `1-|n|` ridges
 * come out as rounded wax blobs. Gradient noise is linear through zero, so
 * the same operation creases into a real ridgeline. */
const GRAD_X = new Float64Array([1, 0.70711, 0, -0.70711, -1, -0.70711, 0, 0.70711])
const GRAD_Z = new Float64Array([0, 0.70711, 1, 0.70711, 0, -0.70711, -1, -0.70711])

function hashInt(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return h ^ (h >>> 16)
}

/** Perlin-style 2D gradient noise over a given wavelength, ≈ −1..1. */
function gradientNoise(x: number, z: number, wavelength: number): number {
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = fx - ix
  const tz = fz - iz
  const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
  const v = tz * tz * tz * (tz * (tz * 6 - 15) + 10)
  const h00 = hashInt(ix, iz) & 7
  const h10 = hashInt(ix + 1, iz) & 7
  const h01 = hashInt(ix, iz + 1) & 7
  const h11 = hashInt(ix + 1, iz + 1) & 7
  const tx1 = tx - 1
  const tz1 = tz - 1
  const n00 = GRAD_X[h00] * tx + GRAD_Z[h00] * tz
  const n10 = GRAD_X[h10] * tx1 + GRAD_Z[h10] * tz
  const n01 = GRAD_X[h01] * tx + GRAD_Z[h01] * tz1
  const n11 = GRAD_X[h11] * tx1 + GRAD_Z[h11] * tz1
  const a = n00 + (n10 - n00) * u
  const b = n01 + (n11 - n01) * u
  return (a + (b - a) * v) * 1.41
}

const RIDGE_ROT_COS = Math.cos(0.7137)
const RIDGE_ROT_SIN = Math.sin(0.7137)

/**
 * Ridged multifractal (abs-noise crests + per-octave weight feedback): fine
 * detail only survives on ground the coarse octaves already lifted, so the
 * feet of a massif stay smooth talus while the crests fracture. Each octave is
 * rotated to kill the value-noise lattice's axis alignment.
 *
 * `detail` (0..1) fades the last octaves out with distance so the field never
 * carries relief finer than the ring LOD can tessellate.
 */
function ridged(
  x: number,
  z: number,
  wavelength: number,
  octaves: number,
  detail: number,
): number {
  let amplitude = 1
  let sum = 0
  let norm = 0
  let weight = 1
  let px = x
  let pz = z
  let scale = 1
  for (let i = 0; i < octaves; i++) {
    const n = gradientNoise(px * scale, pz * scale, wavelength)
    let signal = 1 - (n < 0 ? -n : n) * 1.62
    if (signal < 0) signal = 0
    signal *= signal * weight
    // Partial feedback: full feedback starves the slopes of detail and the
    // range melts into smooth lobes. Detail is boosted on the crests, not
    // erased everywhere else.
    weight = 0.34 + signal * 1.7
    if (weight > 1) weight = 1
    sum += i < 3 ? signal * amplitude : signal * amplitude * detail
    norm += amplitude
    amplitude *= 0.56
    scale *= 2.11
    const rx = px * RIDGE_ROT_COS - pz * RIDGE_ROT_SIN + 137.7
    pz = px * RIDGE_ROT_SIN + pz * RIDGE_ROT_COS - 91.3
    px = rx
  }
  return sum / norm
}

/** Terrain rings start exactly where the graded park floor mesh ends. */
export const TERRAIN_INNER_RADIUS = 132
/** Inside this the exterior field IS the park floor (seamless butt join). */
const INTERIOR_BLEND_START = TERRAIN_INNER_RADIUS + 2
const INTERIOR_BLEND_END = 244
/** The colonists graded the dome apron: no natural relief inside this. */
const PAD_FLAT_RADIUS = 150
const PAD_BLEND_SPAN = 280

/** Mars mean radius — the far floor drops away below the true horizon. */
const PLANET_CURVATURE = 1 / (2 * 3389500)

/** Prevailing wind (dune crests run across it). */
const DUNE_COS = Math.cos(0.62)
const DUNE_SIN = Math.sin(0.62)

/**
 * The south pass: the arrival tube runs to z=420 at beam y≈6 and the
 * spaceport road continues beyond. The corridor is graded flat close in and
 * opens into a widening natural pass through the ridge wall.
 */
export const SOUTH_PASS = {
  /** Graded strip half-width at the dome, growing with distance. */
  gradedHalfWidth: 34,
  gradedEndZ: 640,
  /** Natural pass through the mountain wall. */
  passHalfWidth: 118,
  passFlare: 0.12,
}

/** Mountain-band amplitudes (metres of crest above the valley floor). */
const FOOTHILL_AMPLITUDE = 260
/** The continuous valley rim — the guaranteed wall the crests ride on. */
const RIM_AMPLITUDE = 300
const MAIN_AMPLITUDE = 520
const FAR_AMPLITUDE = 340

/** Sun bearing on the ground plane — the ridgeline must never bury the sun. */
const SUN_BEARING_LENGTH = Math.hypot(sunDirection.x, sunDirection.z)
const SUN_BEARING_X = sunDirection.x / SUN_BEARING_LENGTH
const SUN_BEARING_Z = sunDirection.z / SUN_BEARING_LENGTH

/**
 * Flat-topped buttes standing off the west wall — the valley's landmarks and
 * the only place the layered strata read as a clean horizontal stack. Folded
 * into the height field (no separate hero meshes: an overlapping cliff mesh
 * dropped on top of the ring surface is exactly the double-surface sloppiness
 * the project bans).
 */
export const MESA_SITES: ReadonlyArray<{
  x: number
  z: number
  footprint: number
  capHeight: number
}> = [
  { x: -2260, z: -640, footprint: 300, capHeight: 215 },
  { x: -2820, z: 690, footprint: 235, capHeight: 168 },
  { x: -3260, z: -1580, footprint: 385, capHeight: 275 },
  { x: -1760, z: 1180, footprint: 205, capHeight: 132 },
]

/** Flat mirror of MESA_SITES (x, z, footprint, cap) + one shared bounding box. */
const BUTTE_DATA = new Float64Array(MESA_SITES.length * 4)
let BUTTE_MIN_X = Infinity
let BUTTE_MAX_X = -Infinity
let BUTTE_MIN_Z = Infinity
let BUTTE_MAX_Z = -Infinity
for (let i = 0; i < MESA_SITES.length; i++) {
  const site = MESA_SITES[i]
  BUTTE_DATA[i * 4] = site.x
  BUTTE_DATA[i * 4 + 1] = site.z
  BUTTE_DATA[i * 4 + 2] = site.footprint
  BUTTE_DATA[i * 4 + 3] = site.capHeight
  const reach = site.footprint * 2.4
  if (site.x - reach < BUTTE_MIN_X) BUTTE_MIN_X = site.x - reach
  if (site.x + reach > BUTTE_MAX_X) BUTTE_MAX_X = site.x + reach
  if (site.z - reach < BUTTE_MIN_Z) BUTTE_MIN_Z = site.z - reach
  if (site.z + reach > BUTTE_MAX_Z) BUTTE_MAX_Z = site.z + reach
}

/**
 * 1 in open mountain country, 0 down the middle of the south pass. The pass
 * widens with distance so it reads as a valley mouth rather than a trench, and
 * it only exists south of the dome.
 */
function corridorOpenness(x: number, z: number, r: number): number {
  if (z <= 0) return 1
  const half = SOUTH_PASS.passHalfWidth + (z > 260 ? (z - 260) * SOUTH_PASS.passFlare : 0)
  const across = (x < 0 ? -x : x) / half
  if (across >= 1.9) return 1
  const zGate = smoothClamp((r - 240) / 520)
  return 1 - (1 - smoothClamp((across - 0.55) / 1.35)) * zGate * 0.94
}

/**
 * How mountainous the ground is at (x,z), 0..1 — the same envelope the height
 * field uses, exported so scatter systems can drop talus at the mountain feet
 * and keep boulder fields out of the crests and off the pass road.
 */
export function mountainMask(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z)
  if (r < 480) return 0
  const foot = smoothClamp((r - 500) / 540) * (1 - smoothClamp((r - 1400) / 760))
  const main = smoothClamp((r - 1000) / 1400)
  return Math.min(1, (foot * 0.34 + main * 0.66) * corridorOpenness(x, z, r))
}

/** Additive flat-topped butte: plateau → cliff band → long talus skirt. */
function buttes(x: number, z: number): number {
  if (x < BUTTE_MIN_X || x > BUTTE_MAX_X || z < BUTTE_MIN_Z || z > BUTTE_MAX_Z) return 0
  let height = 0
  for (let i = 0; i < BUTTE_DATA.length; i += 4) {
    const footprint = BUTTE_DATA[i + 2]
    const reach = footprint * 2.4
    const dx = x - BUTTE_DATA[i]
    if (dx < -reach || dx > reach) continue
    const dz = z - BUTTE_DATA[i + 1]
    if (dz < -reach || dz > reach) continue
    const d2 = dx * dx + dz * dz
    if (d2 > reach * reach) continue
    // Irregular plan: perturb the effective radius, not the profile.
    const wobble = valueNoise(dx + i * 91.7, dz - i * 57.3, footprint * 0.62)
    const rr = Math.sqrt(d2) + wobble * footprint * 0.26
    const cap = 1 - smoothClamp((rr - footprint * 0.6) / (footprint * 0.26))
    const talus = 1 - smoothClamp((rr - footprint * 0.86) / (footprint * 1.5))
    height += (cap * 0.8 + talus * 0.22) * BUTTE_DATA[i + 3]
  }
  return height
}

export function exteriorHeight(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z)

  // Detail budgets: the ring LOD coarsens with radius, so the FIELD coarsens
  // with radius too. Relief finer than the local tessellation only aliases.
  const fineDetail = r < 2400 ? 1 : 1 - smoothClamp((r - 2400) / 1600)
  const midDetail = r < 4200 ? 1 : 1 - smoothClamp((r - 4200) / 3400)

  // ---- Valley floor: long swells, transverse dunes, micro relief.
  let height =
    valueNoise(x + 4100, z - 2600, 2350) * 5.2 + valueNoise(x - 640, z + 1180, 690) * 2.3
  if (fineDetail > 0.02) {
    const along = x * DUNE_COS + z * DUNE_SIN
    const drift = valueNoise(x * 0.5 + 220, z * 0.5 - 90, 470) * 27
    const field = 0.5 + 0.5 * valueNoise(x - 700, z + 1500, 880)
    height +=
      (Math.sin((along + drift) * 0.0849) * 1.3 * field * field +
        valueNoise(x + 77, z + 1000, 47) * 0.55) *
      fineDetail
  }

  // ---- The valley wall.
  if (r > 480) {
    const openness = corridorOpenness(x, z, r)
    // The WSW sun must clear the skyline from the park floor: the wall dips
    // into a saddle on that bearing, and only that bearing.
    const sunAlign = (x * SUN_BEARING_X + z * SUN_BEARING_Z) / r
    const sunWindow = 1 - 0.2 * smoothClamp((sunAlign - 0.76) / 0.23)
    const scale = openness * sunWindow

    // Massif noise breaks the ring into named ranges: some crowd the valley,
    // some stand back. Without it the wall reads as an extruded doughnut.
    const massifNoise = valueNoise(x + 3300, z - 1900, 3450)
    const massif = 0.82 + 0.44 * (massifNoise * 0.5 + 0.5)

    const footBand = smoothClamp((r - 500) / 540) * (1 - smoothClamp((r - 1400) / 760))
    if (footBand > 0.002) {
      const hills = ridged(x + 611, z - 233, 760, 5, midDetail)
      height += footBand * FOOTHILL_AMPLITUDE * scale * (hills * 0.8 + hills * hills * 0.55)
    }

    // The valley RIM. A ridged field alone leaves whole bearings open (the
    // east horizon came out empty), and this park is walled in: the rim is a
    // continuous band of rock that the ridged massifs then ride on top of.
    // Only the south pass and the sun window cut into it.
    const rimBand = smoothClamp((r - 1250) / 900) * (1 - smoothClamp((r - 2700) / 2900))
    if (rimBand > 0.001) height += rimBand * RIM_AMPLITUDE * scale * massif

    const mainBand = smoothClamp((r - 1200) / 1500)
    if (mainBand > 0.001) {
      // Far highlands ignore the pass: the road cuts the near wall, but the
      // ranges behind it still close the horizon.
      const relief =
        mainBand * MAIN_AMPLITUDE * scale +
        smoothClamp((r - 3200) / 3200) * FAR_AMPLITUDE * sunWindow
      // TWO ridged fields screen-blended: a single one leaves whole bearings
      // in a radial valley (the east horizon came out empty), and the park
      // must be walled in every direction. Different wavelengths means their
      // valleys almost never line up along the same sightline.
      // Domain warp at massif scale: without it the ridge network sits on a
      // regular lattice and reads as tiling. Warped, the ranges curve and
      // interlock the way real orogeny does.
      const warpX = x + gradientNoise(x + 1200, z - 800, 4600) * 700
      const warpZ = z + gradientNoise(x - 3100, z + 2400, 4600) * 700
      const wallA = ridged(warpX - 1907, warpZ + 2311, 2450, 6, midDetail)
      const wallB = ridged(warpX + 4120, warpZ - 3305, 1380, 5, midDetail)
      const wall = wallA + wallB - wallA * wallB
      const body = massifNoise * 0.5 + 0.5
      // Ridged crests over a broad massif body, plus a bajada of shed debris
      // fanning out from the feet.
      height += relief * massif * (wall * 0.86 + body * wall * 0.3 + body * body * 0.12 + 0.05)
    }

    if (r < 4400) height += buttes(x, z) * scale
  }

  // The planet falls away: the open floor sinks under the true horizon at
  // ~3.4 km, so only the mountains stand above the skyline.
  height -= r * r * PLANET_CURVATURE

  // ---- Graded ground: the dome apron, then the spaceport corridor.
  height *= smoothClamp((r - PAD_FLAT_RADIUS) / PAD_BLEND_SPAN)
  if (z > 60 && r < 1500) {
    const half = SOUTH_PASS.gradedHalfWidth + (z > 300 ? (z - 300) * 0.05 : 0)
    const across = 1 - smoothClamp(((x < 0 ? -x : x) - half) / (half * 1.6))
    const along =
      smoothClamp((z - 60) / 90) * (1 - smoothClamp((z - SOUTH_PASS.gradedEndZ) / 420))
    height *= 1 - across * along * 0.94
  }

  // Seamless butt join to the park floor mesh: inside the blend the exterior
  // field IS interiorHeight, so the two surfaces meet with no step and never
  // overlap into a double surface.
  if (r < INTERIOR_BLEND_END) {
    const w = 1 - smoothClamp((r - INTERIOR_BLEND_START) / (INTERIOR_BLEND_END - INTERIOR_BLEND_START))
    return interiorHeight(x, z) * w + height * (1 - w)
  }
  return height
}
