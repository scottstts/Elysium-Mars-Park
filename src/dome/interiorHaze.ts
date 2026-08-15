import {
  Fn,
  clamp,
  exp,
  float,
  fract,
  Loop,
  max,
  min,
  mix,
  sin,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { HdrTransformContext, RenderPipelineSystem } from '../render/pipeline'
import { sunColorUniform, sunDirectionUniform } from '../sky/sun'
import { DOME_BASE_RADIUS, latticeSunVisibility } from './latticeField'

/**
 * INTERIOR DUST MEDIUM + CREPUSCULAR SHAFTS (plan §6, rebuilt in the overhaul).
 *
 * One march, one medium, two outputs. Marching the view ray through a faint
 * warm slab under the crown, the loop accumulates
 *
 *   density — how much medium is on this ray (optical depth), and
 *   lit     — how much of that medium the sun actually reaches, using the
 *             SAME analytic lattice function that shadows the ground.
 *
 * Their ratio is the shaft: haze under an open pane is bright, haze under a
 * member is dim, and the two agree with the floor pattern by construction.
 *
 * WHY THIS SHAPE (the previous version accumulated a signed carve + glow and
 * relied on the exterior aerial medium to supply the base inscatter): a
 * signed difference cannot be bounded. This one is bounded by construction —
 * the result is `mix(scene, inscatter, amount)` with `amount` hard-capped at
 * MAX_INTERIOR_HAZE, so no view can ever paint the dome into a tan wall. That
 * failure mode was the single largest contributor to the "flat tan wash" the
 * overhaul exists to remove.
 *
 * GLASS CLARITY IS A HARD REQUIREMENT. The slab is height-limited and dies
 * well below the crown, so a ray heading up and out through the glazing
 * leaves the medium after ~50 m and collects under 2 % — the sky, the
 * mountains and the gridshell stay clean. Only long horizontal interior
 * sightlines (the 100–260 m ones that need a depth cue) approach the cap.
 */

/** Medium ceiling (m). Below the 64 m crown: the air up there is clean. */
const SLAB_TOP = 48
/** e-folding height of the dust column inside the dome. */
const HEIGHT_SCALE = 24
/** Extinction per metre of unit-density medium. Tuned against MAX below. */
const MEDIA_EXTINCTION = 0.00072
/**
 * Hard ceiling on the veil, at the longest interior sightline (~260 m).
 * 18 % is a depth cue; 35 % is a tan wall. Do not raise this without looking
 * at ?view=rim and ?view=firsttree side by side with the reference image.
 */
const MAX_INTERIOR_HAZE = 0.18

/** Ambient (shadowed) dust colour: dusty rose, deliberately below the sky. */
const HAZE_AMBIENT = /*@__PURE__*/ vec3(0.26, 0.148, 0.115)
/** Sunlit dust tint, multiplied by the sun colour and the phase lobe. */
const HAZE_SUNLIT = /*@__PURE__*/ vec3(1.0, 0.8, 0.58)
/**
 * How hard sunlit dust outshines shadowed dust. This IS the shaft contrast;
 * everything else about the shafts is geometry.
 */
const HAZE_SUN_GAIN = 0.3

/** Debug dials (live-tweakable through the ?debug handle). */
export const shaftStrength = /*@__PURE__*/ uniform(1)
export const interiorHazeStrength = /*@__PURE__*/ uniform(1)

export function attachInteriorShafts(
  pipeline: RenderPipelineSystem,
  steps: number,
): void {
  // Interior air is between the camera and the glazing, so it must remain
  // after the transparent composite. Exterior aerial perspective owns the
  // pre-glass transform separately in `pipeline.hdrTransform`.
  const previous = pipeline.postTransparencyHdrTransform

  /** Marches the medium once; returns the veil colour and its weight. */
  const mediumFor = (extras: HdrTransformContext): Node<'vec4'> =>
    Fn(() => {
      const worldDirection = extras.worldDirectionNode.toVar()
      const surfaceDistance = extras.viewZNode
        .negate()
        .toVar()

      // March segment: camera → min(surface, hard cap just over one dome).
      const maxRange = float(DOME_BASE_RADIUS * 2.2)
      const range = min(surfaceDistance, maxRange).toVar()
      const stepLength = range.div(steps).toVar()
      // Per-pixel jitter breaks the march into noise instead of banding; the
      // shafts are low-frequency so the noise is invisible after tone map.
      const jitter = fract(
        sin(uv().dot(vec2(12.9898, 78.233))).mul(43758.5453),
      ).toVar()

      const density = float(0).toVar()
      const lit = float(0).toVar()
      const position = extras.cameraWorldPositionNode
        .add(worldDirection.mul(stepLength.mul(jitter.add(0.5))))
        .toVar()

      Loop(steps, () => {
        // Exponential column, cut off at the slab ceiling, dying under the
        // floor so a camera below grade cannot integrate a solid block.
        const aboveGround = clamp(position.y.mul(2).add(1), 0, 1)
        const heightFactor = exp(position.y.max(0).div(-HEIGHT_SCALE))
          .mul(clamp(float(SLAB_TOP).sub(position.y).mul(0.18), 0, 1))
          .mul(aboveGround)
        const radial = position.xz.length()
        // Fades out over ~22 m past the glass foot: the medium is the dome's
        // air, and it must not follow the eye out onto the plain.
        const insideDome = clamp(float(DOME_BASE_RADIUS + 22).sub(radial).mul(0.045), 0, 1)
        const weight = heightFactor.mul(insideDome).mul(stepLength)
        density.addAssign(weight)
        lit.addAssign(latticeSunVisibility(position).mul(weight))
        position.addAssign(worldDirection.mul(stepLength))
      })

      // Fraction of the medium on this ray that the sun actually reaches.
      const litFraction = lit.div(max(density, 1e-4)).clamp(0, 1)
      const amount = float(1)
        .sub(exp(density.mul(-MEDIA_EXTINCTION)))
        .mul(interiorHazeStrength)
        .clamp(0, MAX_INTERIOR_HAZE)

      // Dust forward-scatter: looking sunward, lit dust is far brighter.
      const sunLobe = max(worldDirection.dot(sunDirectionUniform), 0)
      const phase = sunLobe.pow(3.5).mul(1.35).add(0.32)
      const sunlit = (sunColorUniform as unknown as Node<'vec3'>)
        .mul(HAZE_SUNLIT)
        .mul(phase)
        .mul(HAZE_SUN_GAIN)
        .mul(shaftStrength) as unknown as ReturnType<typeof vec3>
      const inscatter = HAZE_AMBIENT.add(sunlit.mul(litFraction))
      return vec4(inscatter, amount)
    })() as unknown as Node<'vec4'>

  pipeline.postTransparencyHdrTransform = (hdrColor, extras) => {
    const base = previous(hdrColor, extras) as Node<'vec4'>
    const medium = mediumFor(extras)
    const inscatter = medium.xyz
    const amount = medium.w

    // ?pass=shafts: the shaft signal alone, gained up so the pattern reads.
    pipeline.debugNodes.shafts = vec4(inscatter.mul(amount).mul(8), 1)
    // ?pass=shadows: the analytic net evaluated at the RECONSTRUCTED surface
    // position (positionWorld would be the fullscreen quad's own geometry).
    pipeline.debugNodes.shadows = latticeSunVisibility(extras.surfaceWorldNode)

    return vec4(mix(base.rgb, inscatter, amount), base.a)
  }
}
