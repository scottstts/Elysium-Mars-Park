import {
  Fn,
  cameraPosition,
  cameraWorldMatrix,
  clamp,
  exp,
  float,
  fract,
  getViewPosition,
  Loop,
  max,
  min,
  sin,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { RenderPipelineSystem } from '../render/pipeline'
import { sunColorUniform, sunDirectionUniform } from '../sky/sun'
import { DOME_BASE_RADIUS, latticeSunVisibility } from './latticeField'

/**
 * Interior dust haze + crepuscular shafts (plan §6): a faint scattering slab
 * from the floor to ~42 m, sampled along the view ray, lit by the SAME
 * analytic lattice function that shadows the ground — the shafts and the
 * shadow net agree by construction. Composited in the pipeline's hdrTransform
 * chain after the aerial medium.
 */

const SLAB_TOP = 42
/**
 * The aerial medium already carries the unoccluded base inscatter, so the
 * shaft march only accumulates the DIFFERENCE the lattice makes: negative
 * where members block the sun (dark crepuscular carving) plus a whisper of
 * positive sparkle. Net-zero in open sun — the wash defect class is
 * structurally impossible.
 */
const CARVE_DENSITY = 0.0011
const GLOW_DENSITY = 0.00006

export const shaftStrength = /*@__PURE__*/ uniform(1)

export function attachInteriorShafts(
  pipeline: RenderPipelineSystem,
  projectionInverse: Node<'mat4'>,
  steps: number,
): void {
  const previous = pipeline.hdrTransform

  const shaftsFor = (
    viewZNode: Node<'float'>,
    sceneDepthNode: Node<'float'>,
  ): Node<'vec3'> =>
    Fn(() => {
      const viewPosition = getViewPosition(
        uv(),
        (sceneDepthNode as unknown as ReturnType<typeof float>).clamp(1e-7, 0.9999),
        projectionInverse,
      )
      const worldDirection = cameraWorldMatrix
        .mul(vec4(viewPosition.normalize(), 0))
        .xyz.normalize()
        .toVar()
      const surfaceDistance = (viewZNode as unknown as ReturnType<typeof float>)
        .negate()
        .toVar()

      // March segment: camera → min(surface, slab exit, hard cap).
      const maxRange = float(DOME_BASE_RADIUS * 2.2)
      const range = min(surfaceDistance, maxRange).toVar()
      const stepLength = range.div(steps).toVar()
      const jitter = fract(
        sin(uv().dot(vec2(12.9898, 78.233))).mul(43758.5453),
      ).toVar()

      // Dust forward-scatter phase: the carved shadows and the sparkle both
      // ride it — strongest looking sunward, gentle elsewhere.
      const sunLobe = max(worldDirection.dot(sunDirectionUniform), 0)
      const phase = sunLobe.pow(3).mul(1.4).add(0.3)

      const carve = float(0).toVar()
      const glow = float(0).toVar()
      const position = cameraPosition
        .add(worldDirection.mul(stepLength.mul(jitter.add(0.5))))
        .toVar()

      Loop(steps, () => {
        // Slab + inside-the-dome bounds, softly.
        const aboveGround = clamp(position.y.mul(2).add(1), 0, 1)
        const heightFalloff = exp(position.y.max(0).div(-18))
          .mul(clamp(float(SLAB_TOP).sub(position.y).mul(0.2), 0, 1))
          .mul(aboveGround)
        const radial = position.xz.length()
        const insideDome = clamp(float(DOME_BASE_RADIUS + 30).sub(radial).mul(0.02), 0, 1)
        const light = latticeSunVisibility(position)
        const weight = heightFalloff.mul(insideDome).mul(stepLength)
        carve.addAssign(light.sub(1).mul(weight).mul(CARVE_DENSITY))
        glow.addAssign(light.mul(weight).mul(GLOW_DENSITY))
        position.addAssign(worldDirection.mul(stepLength))
      })

      // Carve removes the haze the lattice blocked; glow adds the sparkle.
      const hazeColor = (sunColorUniform as unknown as Node<'vec3'>).mul(
        vec3(1.0, 0.86, 0.68),
      ) as unknown as ReturnType<typeof vec3>
      return hazeColor.mul(carve.add(glow).mul(phase).mul(shaftStrength))
    })() as unknown as Node<'vec3'>

  pipeline.hdrTransform = (hdrColor, extras) => {
    const base = previous(hdrColor, extras) as Node<'vec4'>
    const shafts = shaftsFor(
      extras.viewZNode as Node<'float'>,
      extras.sceneDepthNode as Node<'float'>,
    )
    pipeline.debugNodes.shafts = vec4(shafts.mul(6), 1)
    // ?pass=shadows: the analytic net evaluated at the RECONSTRUCTED surface
    // position (positionWorld would be the fullscreen quad's own geometry).
    const depth = (extras.sceneDepthNode as unknown as ReturnType<typeof float>).clamp(
      1e-7,
      0.9999,
    )
    const viewPosition = getViewPosition(uv(), depth, projectionInverse)
    const surfaceWorld = cameraWorldMatrix.mul(vec4(viewPosition, 1)).xyz
    pipeline.debugNodes.shadows = latticeSunVisibility(surfaceWorld)
    return vec4(base.rgb.add(shafts), base.a)
  }
}
