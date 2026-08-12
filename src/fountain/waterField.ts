import { Fn, atan, cos, float, max, sin, uniform, vec3, vec4 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { BASIN_INNER_R, MARS_G } from './fountainPlan'

/**
 * THE ANALYTIC RESIDUE of the water field.
 *
 * The basin's meso-scale motion — impact rings, their interference, their
 * reflections off the coping and the island — is a real heightfield SIMULATION
 * now (`waterSim.ts`), forced by the same parcels the droplet system flies.
 * What stays analytic here is exactly what a 28 mm simulation texel cannot
 * carry and a closed form can:
 *
 *   CHOP    seven capillary bands under 19 cm — the glitter and the fine
 *           caustic filaments. Sub-texel content; simulating it would only
 *           alias against the grid.
 *   SEICHE  the basin's slowest standing mode. Nothing in the sim FORCES a
 *           2-lobe 9.3 s slosh (the impacts are all radial), and a mode with a
 *           14 m wavelength loses nothing by being written in closed form.
 *
 * Everything else that used to live here — the five authored ring trains and
 * their Hessian — is deleted, not moved: the sim computes the real thing.
 *
 * ## Term algebra (unchanged)
 *
 * Every band is `A·sin(φ)`, `φ = k·(d·p) − ωt`, so exactly:
 *
 *   ∇h = A·k·cos(φ)·d          H = −A·k²·sin(φ)·ddᵀ
 *
 * with ω = sqrt(g·k + σk³/ρ) at MARS gravity — at these wavelengths the
 * capillary branch dominates and the ripples genuinely crawl.
 */

/** σ/ρ for water, m³/s². */
const CAPILLARY = 7.28e-5

export function dispersion(wavelength: number): number {
  const k = (Math.PI * 2) / wavelength
  return Math.sqrt(MARS_G * k + CAPILLARY * k * k * k)
}

/** Park-clock seconds, driven by `FountainSystem.fixedUpdate`. */
export const fountainTime = /*@__PURE__*/ uniform(0)

/**
 * Capillary chop: SEVEN crossed plane trains under 20 cm.
 *
 * The count and the choice of numbers are the point. Three bands at tidy
 * wavelengths interfere into a periodic lattice, and because the caustic
 * Jacobian amplifies exactly that curvature, the basin floor came out woven
 * with a visible wire-mesh grid — a perfectly regular pattern is the one
 * thing water never has. Seven bands at MUTUALLY INCOMMENSURATE wavelengths
 * (ratios near √2, φ and √5, never a simple fraction) and irrational bearings
 * push the interference beat out past the basin's own diameter, so the
 * surface never repeats anywhere you can see it.
 *
 * Amplitudes fall as roughly λ^(3/4) — the equilibrium slope spectrum of
 * capillary–gravity ripples — rather than being picked, so the fine bands
 * carry the glitter and the coarse ones carry the shape.
 */
export const CHOP: ReadonlyArray<{ dir: [number, number]; amplitude: number; wavelength: number }> = [
  { dir: [0.9135, 0.4068], amplitude: 0.0022, wavelength: 0.187 },
  { dir: [-0.3746, 0.9272], amplitude: 0.0017, wavelength: 0.1319 },
  { dir: [0.6845, -0.729], amplitude: 0.0014, wavelength: 0.0941 },
  { dir: [-0.9563, -0.2924], amplitude: 0.0011, wavelength: 0.0673 },
  { dir: [0.2079, 0.9781], amplitude: 0.0009, wavelength: 0.0479 },
  { dir: [-0.6428, 0.766], amplitude: 0.0007, wavelength: 0.0341 },
  { dir: [0.8387, -0.5446], amplitude: 0.0005, wavelength: 0.0243 },
]

/** The bands whose curvature the caustic web is built from (see `waterSim`). */
export const CAUSTIC_CHOP = /*@__PURE__*/ CHOP.slice(0, 5)

/**
 * The seiche: the basin's own slowest sloshing mode, a two-lobe standing wave
 * on a 9.3 s period. It is what stops the surface reading as a perfectly
 * radial machine — the whole pool leans, very slightly, one way and back.
 */
const SEICHE = { amplitude: 0.0042, period: 9.3, lobes: 2 }

/** Seiche height + gradient at a plan offset from the axis: `vec3(h, gx, gz)`. */
export const seicheField = /*@__PURE__*/ Fn(([planeXZ]: [Node<'vec2'>]) => {
  const r = max(planeXZ.length(), 1e-3).toVar()
  const u = planeXZ.div(r).toVar()
  const theta = atan(planeXZ.y, planeXZ.x)
  const omega = (Math.PI * 2) / SEICHE.period
  const swell = sin(fountainTime.mul(omega)).toVar()
  const reach = r.div(BASIN_INNER_R).min(1)
  const h = float(SEICHE.amplitude).mul(reach).mul(cos(theta.mul(SEICHE.lobes))).mul(swell)
  // The gradient is tangential and tiny, but it is included so the normal
  // never disagrees with the displacement.
  const tangential = float(-SEICHE.lobes * SEICHE.amplitude)
    .mul(sin(theta.mul(SEICHE.lobes)))
    .mul(swell)
    .mul(reach)
    .div(r)
  return vec3(h, tangential.mul(u.y.negate()), tangential.mul(u.x))
})

/**
 * The capillary detail a PIXEL can still resolve, plus the slope variance of
 * what it cannot: `vec4(h, ∂h/∂x, ∂h/∂z, σ²)`.
 *
 * `footprint` is metres of surface crossed by one output pixel. Each band is
 * dissolved as its wavelength falls under the footprint — the competence rule
 * that stops micro-waves aliasing into sparkling noise — but the WAVES ARE
 * STILL THERE: what leaves the geometry re-enters the shading as σ², the
 * slope variance handed to the specular lobe as roughness (Toksvig/LEAN
 * filtering). Energy moves between representations; it does not vanish, which
 * is why the water stops glittering at distance by becoming a coherent sheen
 * rather than by going matte.
 */
export const analyticDetail = /*@__PURE__*/ Fn(
  ([planeXZ, footprint]: [Node<'vec2'>, Node<'float'>]) => {
    const t = fountainTime
    const h = float(0).toVar()
    const gx = float(0).toVar()
    const gz = float(0).toVar()
    const sigma2 = float(0).toVar()

    for (const band of CHOP) {
      const k = (Math.PI * 2) / band.wavelength
      const omega = dispersion(band.wavelength)
      // A band under ~2 px can only alias: dissolve it between λ/6 and λ/2 of
      // pixel footprint. A ratio, so it self-adapts to resolution, FOV and
      // distance instead of being pinned to one window.
      const aa = float(1).sub(footprint.mul(k).smoothstep(0.0, 3.0)).toVar()
      const amplitude = aa.mul(band.amplitude)
      const [dirX, dirZ] = band.dir
      const phi = planeXZ.x.mul(dirX * k).add(planeXZ.y.mul(dirZ * k)).sub(t.mul(omega))
      h.addAssign(amplitude.mul(sin(phi)))
      const dp = amplitude.mul(cos(phi)).mul(k)
      gx.addAssign(dp.mul(dirX))
      gz.addAssign(dp.mul(dirZ))
      // Mean slope variance of a sine of slope amplitude A·k is (A·k)²/2; the
      // faded share of it (energy is amplitude-SQUARED) becomes roughness.
      const full = 0.5 * band.amplitude * band.amplitude * k * k
      sigma2.addAssign(float(1).sub(aa.mul(aa)).mul(full))
    }

    return vec4(h, gx, gz, sigma2)
  },
)
