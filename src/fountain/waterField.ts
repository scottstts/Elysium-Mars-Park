import { Fn, atan, cos, exp, float, max, sin, uniform, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  BASIN_INNER_R,
  JETS_INWARD,
  JETS_OUTWARD,
  MAIN_CURTAIN_LAND_R,
  MARS_G,
  WATER_Y,
  basinFloorY,
} from './fountainPlan'

/**
 * THE RIPPLE FIELD — one analytic surface, three derivatives, four consumers.
 *
 * The basin's water is not "a normal map that scrolls". It is a small sum of
 * authored wave trains whose sources are the places water ACTUALLY lands: the
 * curtain's landing ring, the two jet-impact rings, plus a slow basin seiche
 * and a capillary chop. Every consumer reads the same terms:
 *
 *   h      → vertex displacement of the surface mesh
 *   ∇h     → the shading normal AND the refraction of the view ray
 *   ∇²h    → differential-area caustics on the basin floor
 *   h      → the CPU mirror, for the spray system's impact heights
 *
 * That sharing is the mechanism, not a convenience: a caustic web computed
 * from a different field than the normals it is supposed to be focused by is
 * exactly the "decorative projection detached from simulated height normals"
 * failure the water-optics skill names.
 *
 * ## Term algebra
 *
 * Every term is `A·sin(φ)` with `φ = k·f(p) − ωt`, `f` either a distance from
 * a source ring (`f = |p−c| − r₀`, radiating) or a direction dot (`f = d·p`,
 * a plane chop). Then, exactly:
 *
 *   ∇h = A·k·cos(φ)·∇f
 *   H  = −A·k²·sin(φ)·∇f∇fᵀ + A·k·cos(φ)·H(f)
 *
 * with `∇f = u` (unit radial) and `H(f) = (I − uuᵀ)/r` for a radial term, and
 * `∇f = d`, `H(f) = 0` for a chop. The amplitude envelope is treated as
 * locally constant inside `H`: its own curvature is ~1/L² with L ≈ 2 m, three
 * orders under `k²` at these wavelengths, so it cannot move a caustic.
 *
 * ## Dispersion
 *
 * ω = sqrt(g·k + σk³/ρ) at MARS gravity (3.721 m/s²) with water's surface
 * tension. This is worth getting right rather than hard-coding speeds: at
 * 0.15 m wavelength the capillary branch already dominates, and on the
 * gravity branch a 0.6 m ring travels 40 % slower than it would on Earth.
 * The rings genuinely spread at a Martian pace, and it reads.
 */

/** σ/ρ for water, m³/s². */
const CAPILLARY = 7.28e-5

function dispersion(wavelength: number): number {
  const k = (Math.PI * 2) / wavelength
  return Math.sqrt(MARS_G * k + CAPILLARY * k * k * k)
}

/** Park-clock seconds, driven by `FountainSystem.fixedUpdate`. */
export const fountainTime = /*@__PURE__*/ uniform(0)

/** A radiating train: rings leaving a source circle centred on the axis. */
interface RingTrain {
  /** Source radius, metres from the axis. */
  r0: number
  amplitude: number
  wavelength: number
  /** +1 travels outward, −1 inward. */
  direction: 1 | -1
  /** e-folding distance of the amplitude away from the source, metres. */
  reach: number
  /** Angular beat: how many discrete impact points the ring is made of. */
  lobes: number
  /** Depth of the angular beat, 0…1. */
  lobeDepth: number
  phase: number
}

/**
 * The landing rings, in order of energy. Amplitudes are SMALL on purpose: a
 * basin 0.35 m deep cannot carry 5 cm of chop, and the reference image's
 * water is a fine, busy, low-amplitude surface whose whole character comes
 * from curvature rather than from height.
 */
const RINGS: RingTrain[] = [
  // The main curtain — a continuous 4.2 m fall onto a 17.5 m circumference.
  // By far the strongest source, and the only train that reaches the wall.
  { r0: MAIN_CURTAIN_LAND_R, amplitude: 0.0125, wavelength: 0.62, direction: 1, reach: 3.6, lobes: 36, lobeDepth: 0.3, phase: 0 },
  // Set A impacts: 16 discrete points, hence a strong angular beat.
  { r0: JETS_INWARD.landR, amplitude: 0.0072, wavelength: 0.4, direction: 1, reach: 2.4, lobes: JETS_INWARD.count, lobeDepth: 0.62, phase: 1.7 },
  { r0: JETS_INWARD.landR, amplitude: 0.0052, wavelength: 0.34, direction: -1, reach: 1.5, lobes: JETS_INWARD.count, lobeDepth: 0.62, phase: 4.1 },
  // Set B impacts: fewer, further out, and a shorter fall behind them.
  { r0: JETS_OUTWARD.landR, amplitude: 0.0048, wavelength: 0.31, direction: 1, reach: 1.8, lobes: JETS_OUTWARD.count, lobeDepth: 0.7, phase: 2.9 },
  { r0: JETS_OUTWARD.landR, amplitude: 0.0038, wavelength: 0.27, direction: -1, reach: 1.4, lobes: JETS_OUTWARD.count, lobeDepth: 0.7, phase: 5.6 },
]

/**
 * Capillary chop: three crossed plane trains under 15 cm, which exist to
 * carry the fine glitter and the caustic filaments. These are the bands that
 * MUST be derivative-attenuated on the surface — unfiltered they are the
 * "micro-waves alias into sparkling noise" failure condition.
 */
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
const CHOP: Array<{ dir: [number, number]; amplitude: number; wavelength: number }> = [
  { dir: [0.9135, 0.4068], amplitude: 0.0022, wavelength: 0.187 },
  { dir: [-0.3746, 0.9272], amplitude: 0.0017, wavelength: 0.1319 },
  { dir: [0.6845, -0.729], amplitude: 0.0014, wavelength: 0.0941 },
  { dir: [-0.9563, -0.2924], amplitude: 0.0011, wavelength: 0.0673 },
  { dir: [0.2079, 0.9781], amplitude: 0.0009, wavelength: 0.0479 },
  { dir: [-0.6428, 0.766], amplitude: 0.0007, wavelength: 0.0341 },
  { dir: [0.8387, -0.5446], amplitude: 0.0005, wavelength: 0.0243 },
]

/** The trains the caustic Jacobian is actually built from — see `waterHessian`. */
const CAUSTIC_RINGS = /*@__PURE__*/ RINGS.filter((ring) => ring.direction > 0)
/** …and the chop bands, whose short wavelengths carry the fine filaments. */
const CAUSTIC_CHOP = /*@__PURE__*/ CHOP.slice(0, 5)

/**
 * The seiche: the basin's own slowest sloshing mode, a two-lobe standing wave
 * on a 9.3 s period. It is what stops the surface reading as a perfectly
 * radial machine — the whole pool leans, very slightly, one way and back.
 */
const SEICHE = { amplitude: 0.0042, period: 9.3, lobes: 2 }

/**
 * Surface height and gradient at a world-XZ point: `vec3(h, ∂h/∂x, ∂h/∂z)`.
 *
 * `footprint` is metres of surface crossed by one output pixel; `microScale`
 * gates the capillary bands wholesale (0 in the vertex stage, which has no
 * derivatives and only wants the macro shape anyway).
 */
export const waterField = /*@__PURE__*/ Fn(
  ([planeXZ, center, footprint, microScale]: [
    Node<'vec2'>,
    Node<'vec2'>,
    Node<'float'>,
    Node<'float'>,
  ]) => {
    const d = planeXZ.sub(center).toVar()
    const r = max(d.length(), 1e-3).toVar()
    const u = d.div(r).toVar()
    const theta = atan(d.y, d.x).toVar()
    const t = fountainTime

    const h = float(0).toVar()
    const gx = float(0).toVar()
    const gz = float(0).toVar()

    for (const ring of RINGS) {
      const k = (Math.PI * 2) / ring.wavelength
      const omega = dispersion(ring.wavelength) * ring.direction
      const s = r.sub(ring.r0)
      // Envelope: exponential decay away from the source ring, times the
      // 1/√r spreading loss every circular wave pays. Clamped near the axis
      // so the island's shoreline does not blow up.
      const env = exp(s.abs().div(ring.reach).negate()).div(max(r, 0.6).sqrt().mul(0.62))
      // The angular beat is what turns "a ring" into "sixteen splashes".
      const beat = float(1).sub(
        float(ring.lobeDepth).mul(float(0.5).sub(cos(theta.mul(ring.lobes).add(ring.phase)).mul(0.5))),
      )
      const amplitude = env.mul(beat).mul(ring.amplitude)
      const phi = s.mul(k * ring.direction).sub(t.mul(omega)).add(ring.phase)
      h.addAssign(amplitude.mul(sin(phi)))
      const dr = amplitude.mul(cos(phi)).mul(k * ring.direction)
      gx.addAssign(dr.mul(u.x))
      gz.addAssign(dr.mul(u.y))
    }

    // Seiche — a slow standing lean. Its gradient is tangential and tiny, but
    // it is included so the normal never disagrees with the displacement.
    {
      const omega = (Math.PI * 2) / SEICHE.period
      const swell = sin(t.mul(omega))
      const reach = r.div(BASIN_INNER_R).min(1)
      h.addAssign(float(SEICHE.amplitude).mul(reach).mul(cos(theta.mul(SEICHE.lobes))).mul(swell))
      const tangential = float(-SEICHE.lobes * SEICHE.amplitude)
        .mul(sin(theta.mul(SEICHE.lobes)))
        .mul(swell)
        .mul(reach)
        .div(r)
      gx.addAssign(tangential.mul(u.y.negate()))
      gz.addAssign(tangential.mul(u.x))
    }

    for (const band of CHOP) {
      const k = (Math.PI * 2) / band.wavelength
      const omega = dispersion(band.wavelength)
      // The competence limit: a band under ~2 px can only alias. Dissolve it
      // between λ/6 and λ/2 of pixel footprint. A ratio, so it self-adapts to
      // resolution, FOV and distance instead of being pinned to one window.
      const aa = float(1).sub(footprint.mul(k).smoothstep(0.0, 3.0)).mul(microScale)
      const amplitude = aa.mul(band.amplitude)
      const [dirX, dirZ] = band.dir
      const phi = planeXZ.x.mul(dirX * k).add(planeXZ.y.mul(dirZ * k)).sub(t.mul(omega))
      h.addAssign(amplitude.mul(sin(phi)))
      const dp = amplitude.mul(cos(phi)).mul(k)
      gx.addAssign(dp.mul(dirX))
      gz.addAssign(dp.mul(dirZ))
    }

    return vec3(h, gx, gz)
  },
)

/**
 * The Hessian trio `(∂²h/∂x², ∂²h/∂z², ∂²h/∂x∂z)`, for the caustic Jacobian.
 *
 * Evaluated at the SUN-RAY ENTRY point, which is never the shading point, so
 * this is not a duplicate of `waterField`'s work — it is the same field
 * sampled somewhere else. Both read the constants above, so they cannot
 * drift apart.
 */
export const waterHessian = /*@__PURE__*/ Fn(
  ([planeXZ, center]: [Node<'vec2'>, Node<'vec2'>]) => {
    const d = planeXZ.sub(center).toVar()
    const r = max(d.length(), 1e-3).toVar()
    const u = d.div(r).toVar()
    const theta = atan(d.y, d.x).toVar()
    const t = fountainTime
    const hxx = float(0).toVar()
    const hzz = float(0).toVar()
    const hxz = float(0).toVar()

    // Only the DOMINANT trains. Curvature scales as A·k², and the reflected
    // trains carry a quarter of their source's amplitude at a longer
    // wavelength — under 6 % of the caustic's Jacobian between them. This
    // function runs per water pixel; the two it skips cost more than they
    // move the web.
    for (const ring of CAUSTIC_RINGS) {
      const k = (Math.PI * 2) / ring.wavelength
      const omega = dispersion(ring.wavelength) * ring.direction
      const s = r.sub(ring.r0)
      const env = exp(s.abs().div(ring.reach).negate()).div(max(r, 0.6).sqrt().mul(0.62))
      const beat = float(1).sub(
        float(ring.lobeDepth).mul(float(0.5).sub(cos(theta.mul(ring.lobes).add(ring.phase)).mul(0.5))),
      )
      const amplitude = env.mul(beat).mul(ring.amplitude)
      const phi = s.mul(k * ring.direction).sub(t.mul(omega)).add(ring.phase)
      const radial = amplitude.mul(sin(phi)).mul(-(k * k))
      const spread = amplitude.mul(cos(phi)).mul(k * ring.direction).div(r)
      hxx.addAssign(radial.mul(u.x).mul(u.x).add(spread.mul(float(1).sub(u.x.mul(u.x)))))
      hzz.addAssign(radial.mul(u.y).mul(u.y).add(spread.mul(float(1).sub(u.y.mul(u.y)))))
      hxz.addAssign(radial.mul(u.x).mul(u.y).sub(spread.mul(u.x.mul(u.y))))
    }
    // The chop bands carry most of the SHORT-scale curvature, and therefore
    // most of the caustic web's fine filaments. They stay at full strength
    // here: the footprint that would alias the SURFACE band is not the one
    // that governs a pattern projected 0.35 m below it.
    for (const band of CAUSTIC_CHOP) {
      const k = (Math.PI * 2) / band.wavelength
      const omega = dispersion(band.wavelength)
      const [dirX, dirZ] = band.dir
      const phi = planeXZ.x.mul(dirX * k).add(planeXZ.y.mul(dirZ * k)).sub(t.mul(omega))
      const second = float(band.amplitude).mul(sin(phi)).mul(-(k * k))
      hxx.addAssign(second.mul(dirX * dirX))
      hzz.addAssign(second.mul(dirZ * dirZ))
      hxz.addAssign(second.mul(dirX * dirZ))
    }
    return vec3(hxx, hzz, hxz)
  },
)

/**
 * Caustic concentration on the basin floor under a surface point.
 *
 * The refracted sun ray maps surface → floor as `P(S) = S + β·∇h(S)` with
 * β = depth·(1 − 1/n)/sin(elevation); the light concentration is therefore
 * `1/|det(I + β·H)|`. That IS the differential-area definition, evaluated
 * analytically instead of by rasterising a refracted grid into a target —
 * possible only because this field has a closed-form Hessian.
 */
export const causticGain = /*@__PURE__*/ Fn(
  ([planeXZ, center, beta]: [Node<'vec2'>, Node<'vec2'>, Node<'float'>]) => {
    const H = waterHessian(planeXZ, center)
    const a = float(1).add(beta.mul(H.x))
    const b = float(1).add(beta.mul(H.y))
    const det = a.mul(b).sub(beta.mul(beta).mul(H.z).mul(H.z))
    // A caustic is a 1/|det| singularity; the clamp stands in for the finite
    // 0.35° width of the solar disc, which no real caustic focuses past. Mars'
    // disc is HALF Earth's, so the web here is genuinely sharper than a
    // terrestrial pool's — 0.3 rather than the 0.5 an Earth fountain would
    // support — and that is a real difference, not a knob.
    return float(1).div(max(det.abs(), 0.3)).min(3.4)
  },
)

// ─────────────────────────────────────────────────────────────── CPU mirror

/**
 * The same field on the CPU, macro terms only — the spray system seats impact
 * rings and droplet bounces ON the live surface rather than on a nominal
 * plane. Micro chop is omitted deliberately: a 2 mm band cannot move a
 * splash, and evaluating it per particle per frame would cost more than the
 * entire spray budget.
 */
export function waterHeightCpu(x: number, z: number, t: number, cx: number, cz: number): number {
  const dx = x - cx
  const dz = z - cz
  const r = Math.max(Math.hypot(dx, dz), 1e-3)
  const theta = Math.atan2(dz, dx)
  let h = 0
  for (const ring of RINGS) {
    const k = (Math.PI * 2) / ring.wavelength
    const omega = dispersion(ring.wavelength) * ring.direction
    const s = r - ring.r0
    const env = Math.exp(-Math.abs(s) / ring.reach) / (Math.sqrt(Math.max(r, 0.6)) * 0.62)
    const beat = 1 - ring.lobeDepth * (0.5 - 0.5 * Math.cos(theta * ring.lobes + ring.phase))
    h += env * beat * ring.amplitude * Math.sin(s * k * ring.direction - t * omega + ring.phase)
  }
  const seicheOmega = (Math.PI * 2) / SEICHE.period
  h +=
    SEICHE.amplitude *
    Math.min(1, r / BASIN_INNER_R) *
    Math.cos(theta * SEICHE.lobes) *
    Math.sin(t * seicheOmega)
  return h
}

/** Absolute water surface height (local fountain Y) at a plan point. */
export function waterSurfaceCpu(x: number, z: number, t: number, cx: number, cz: number): number {
  return WATER_Y + waterHeightCpu(x, z, t, cx, cz)
}

/** Still-water depth at a plan radius — the absorption path's basis. */
export function waterDepth(radius: number): number {
  return WATER_Y - basinFloorY(radius)
}
