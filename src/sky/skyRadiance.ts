import { Fn, dot, float, max, mix, normalize, pow, smoothstep, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { sunColorUniform, sunDirectionUniform } from './sun'

/**
 * Shared HDR Mars sky radiance — sampled by the sky dome, the environment
 * bake, the AO indirect reconstruction and (via `dustHazeTint`) the exterior
 * aerial medium, so none of them can disagree.
 *
 * The model is dust-Mie dominated: the column is warm salmon → butterscotch,
 * the horizon is BRIGHTER than the zenith (long dust path), and the sky
 * brightens broadly toward the sun rather than in a tight Earth-like halo.
 * The physically real cool circumsolar lobe (~1.5 µm dust forward-scatters
 * blue preferentially) is kept but confined to a few degrees around the disc:
 * a wide blue halo desaturates the entire sunward sky into gray-tan, which is
 * precisely the "flat wash" the overhaul exists to kill. Values are linear
 * HDR; the disc sits far above 1.0 and drives bloom.
 *
 * PALETTE CONTRACT (linear, pre-tonemap) — these numbers were solved BACKWARD
 * from ref_images/mars_park.png through the shipped output chain (exposure
 * +0.15 EV → Neutral tone map → sRGB → the Mars LUT), not eyeballed:
 *   horizon  (0.620, 0.335, 0.245) → #e7a584   (ref samples ≈ #e0ab8e)
 *   mid      (0.385, 0.196, 0.155) → #bb7a64   (ref ≈ #c9917c)
 *   zenith   (0.175, 0.096, 0.098) → #76494c   dusty rose, slightly cool
 * R:G:B ≈ 1 : 0.54 : 0.40 and barely moves up the column: the hue holds, the
 * VALUE falls. A hue-shifting gradient reads as an Earth sunset, not Mars.
 * The zenith is the one place blue creeps back above green — that is what
 * makes it "dusty rose" instead of "dark butterscotch".
 *
 * If you change these, re-derive them the same way; the grade and the sky
 * are one system and tuning either alone puts the palette back in the ditch.
 */

/** Mars's sun subtends ~0.35° (smaller, farther sun); radius 0.175°. */
const SUN_COS_RADIUS = Math.cos((0.175 * Math.PI) / 180)

const SKY_HORIZON = /*@__PURE__*/ vec3(0.62, 0.335, 0.262)
const SKY_MID = /*@__PURE__*/ vec3(0.385, 0.196, 0.166)
const SKY_ZENITH = /*@__PURE__*/ vec3(0.175, 0.096, 0.106)
/** Below the true horizon: dust lit from above, reading into the terrain. */
const SKY_GROUND = /*@__PURE__*/ vec3(0.38, 0.205, 0.148)

/**
 * Shared dust tint for horizon inscattering (exterior aerial perspective
 * multiplies this by 0.6). Chosen so the resulting inscatter sits just BELOW
 * the horizon-sky radiance — haze that outshines the sky bleaches the world
 * instead of veiling it — and keeps the sky's chroma ratio so distant massifs
 * fade toward salmon, never toward gray-tan.
 */
export const dustHazeTint = /*@__PURE__*/ vec3(0.665, 0.318, 0.222)

/** Direction-independent part of the sky column, for cheap consumers. */
const skyColumn = /*@__PURE__*/ Fn(([up]: [Node<'float'>]) => {
  // Two stacked mixes rather than one power curve: the near-horizon falloff
  // is fast (dust path shortens quickly) while the upper column is almost
  // linear. One pow() there produces the tell-tale "vignetted dome" look.
  const lower = mix(SKY_HORIZON, SKY_MID, smoothstep(0.0, 0.34, up))
  return mix(lower, SKY_ZENITH, smoothstep(0.22, 1.0, up))
})

export const marsSkyRadiance = /*@__PURE__*/ Fn(
  ([direction, discStrength]: [Node<'vec3'>, Node<'float'>]) => {
    const dir = normalize(direction).toVar()
    const up = max(dir.y, 0.0)

    const gradient = skyColumn(up)
    const sky = mix(SKY_GROUND, gradient, smoothstep(-0.09, 0.02, dir.y)).toVar()

    const sunAmount = max(dot(dir, sunDirectionUniform), 0.0).toVar()

    // Broad warm forward-dust lobe: the whole sunward quadrant lifts. Two
    // exponents so it has a wide base AND a bright core without a hard edge.
    sky.addAssign(vec3(0.30, 0.152, 0.086).mul(pow(sunAmount, 1.35)).mul(0.42))
    sky.addAssign(vec3(0.46, 0.246, 0.136).mul(pow(sunAmount, 7.0)).mul(0.75))

    // The signature reversal, kept honest but tight: a cool core within a few
    // degrees of the disc, gone by ~10°, so it never grays the wider sky.
    const blueCore = vec3(0.20, 0.27, 0.40)
      .mul(pow(sunAmount, 260.0))
      .mul(0.55)
      .add(vec3(0.42, 0.56, 0.86).mul(pow(sunAmount, 900.0)).mul(1.1))
    sky.addAssign(blueCore)

    // The disc: correct 0.35° angular size, limb-darkened (Neckel–Labs
    // I(µ) ≈ 0.30 + 0.93µ − 0.23µ²), edge feathered in stable x² space.
    const x2 = float(1).sub(sunAmount).div(1 - SUN_COS_RADIUS).toVar()
    const inDisc = smoothstep(1.0, 0.94, x2)
    const mu = float(1).sub(x2).max(0.0).sqrt()
    const limb = float(0.3).add(mu.mul(0.93)).sub(mu.mul(mu).mul(0.23))
    const disc = inDisc.mul(limb).mul(discStrength).mul(1800.0)

    // Tight aureole seating the disc in the dust. Kept just under the bloom
    // threshold at its outer skirt so the glare grows from the disc, not
    // from a ring floating a degree away from it.
    const aureole = pow(sunAmount, 4000.0).mul(22.0).add(pow(sunAmount, 700.0).mul(0.62))

    const discColor = vec3(1.0, 0.93, 0.84)
    return sky.add(discColor.mul(sunColorUniform).mul(aureole.add(disc)))
  },
)

/**
 * Hemispheric diffuse irradiance estimate for a world-space normal — the same
 * palette the PMREM bake sees, collapsed to a two-lobe approximation.
 *
 * This is NOT a second lighting model: it is the reconstruction the AO
 * composite needs to know how much of a shaded pixel is ambient (which AO may
 * darken) versus direct sun (which it may not). It deliberately overestimates
 * slightly; the composite clamps with `min(estimate, sceneColor)`, so an
 * overestimate degrades to "full AO in shadow, none in sun", which is the
 * behaviour we want anyway.
 */
export const marsAmbientIrradiance = /*@__PURE__*/ Fn(
  ([worldNormal]: [Node<'vec3'>]) => {
    const upness = worldNormal.y.mul(0.5).add(0.5)
    // Sky lobe = cosine-weighted mean of the column; ground lobe = regolith
    // bounce, redder and much dimmer. π folds into the constants.
    // Units: RADIANCE PER UNIT ALBEDO — i.e. what a Lambertian surface of
    // albedo 1 would return, so the composite is `albedo · this · envIntensity`
    // with no stray 1/π. The sky lobe is the cosine-weighted mean of the
    // column above (≈ the horizon/mid average), the ground lobe is the
    // regolith bounce: redder, and roughly a third as bright.
    const skyLobe = vec3(0.42, 0.203, 0.155)
    const groundLobe = vec3(0.14, 0.075, 0.052)
    const ambient = mix(groundLobe, skyLobe, smoothstep(0.0, 1.0, upness))
    // A little extra toward the sun: the dust lobe is a real bright region.
    const sunward = max(dot(worldNormal, sunDirectionUniform), 0.0)
    return ambient.add(vec3(0.1, 0.05, 0.03).mul(sunward.mul(sunward)))
  },
)
