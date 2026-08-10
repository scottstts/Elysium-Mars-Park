import { Fn, dot, float, max, mix, normalize, pow, smoothstep, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { sunColorUniform, sunDirectionUniform } from './sun'

/**
 * Shared HDR Mars sky radiance — sampled by the sky dome, the environment
 * bake, and (faintly) exterior inscattering, so they can never disagree.
 *
 * The model is dust-Mie dominated, which is why every Earth intuition is
 * reversed: the sky is butterscotch (dust absorbs/forward-scatters blue out
 * of the ambient column), the horizon is BRIGHTER than the zenith (long dust
 * path), and the immediate circumsolar region glows COOL BLUE (~1.5 µm dust
 * forward-scatters blue preferentially). Values are linear HDR; the sun disc
 * sits far above 1.0 and drives bloom.
 */

/** Mars's sun subtends ~0.35° (smaller, farther sun); radius 0.175°. */
const SUN_COS_RADIUS = Math.cos((0.175 * Math.PI) / 180)

/** Shared dust tint for horizon inscattering (S3 aerial perspective). */
export const dustHazeTint = /*@__PURE__*/ vec3(0.56, 0.37, 0.225)

export const marsSkyRadiance = /*@__PURE__*/ Fn(
  ([direction, discStrength]: [Node<'vec3'>, Node<'float'>]) => {
    const dir = normalize(direction).toVar()
    const up = max(dir.y, 0.0)

    // Butterscotch column: bright dusty horizon → dark tea-brown zenith.
    const zenith = vec3(0.052, 0.036, 0.024)
    const horizon = vec3(0.34, 0.208, 0.115)
    const groundGlow = vec3(0.24, 0.152, 0.092)

    const gradient = mix(horizon, zenith, pow(up, 0.5))
    const sky = mix(groundGlow, gradient, smoothstep(-0.08, 0.025, dir.y)).toVar()

    const sunAmount = max(dot(dir, sunDirectionUniform), 0.0).toVar()

    // Broad warm forward-dust lobe: the whole sunward sky brightens gently.
    sky.addAssign(vec3(0.30, 0.175, 0.085).mul(pow(sunAmount, 4.0)).mul(0.55))

    // The signature reversal — a cool blue circumsolar glow, tight around
    // the disc, melting outward into the warm dust. It must survive bloom:
    // the cool band peaks where the warm lobes have already fallen off.
    const blueHalo = vec3(0.26, 0.36, 0.55)
      .mul(pow(sunAmount, 60.0))
      .mul(0.8)
      .add(vec3(0.5, 0.66, 1.0).mul(pow(sunAmount, 420.0)).mul(2.0))
    sky.addAssign(blueHalo)

    // The disc: correct 0.35° angular size, limb-darkened (Neckel–Labs
    // I(µ) ≈ 0.30 + 0.93µ − 0.23µ²), edge feathered in stable x² space.
    const x2 = float(1).sub(sunAmount).div(1 - SUN_COS_RADIUS).toVar()
    const inDisc = smoothstep(1.0, 0.94, x2)
    const mu = float(1).sub(x2).max(0.0).sqrt()
    const limb = float(0.3).add(mu.mul(0.93)).sub(mu.mul(mu).mul(0.23))
    const disc = inDisc.mul(limb).mul(discStrength).mul(1800.0)

    // Tight aureole seating the disc in the dust.
    const aureole = pow(sunAmount, 4000.0).mul(24.0).add(pow(sunAmount, 900.0).mul(0.85))

    const discColor = vec3(1.0, 0.94, 0.86)
    return sky.add(discColor.mul(sunColorUniform).mul(aureole.add(disc)))
  },
)
