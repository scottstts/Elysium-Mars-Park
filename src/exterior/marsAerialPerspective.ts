import {
  cameraWorldMatrix,
  dot,
  exp,
  float,
  getViewPosition,
  max,
  mix,
  pow,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { dustHazeTint } from '../sky/skyRadiance'
import { sunDirectionUniform } from '../sky/sun'

/**
 * One continuous dust medium for the whole world, applied screen-space in the
 * pipeline's hdrTransform. The same function does double duty by design:
 * interior sightlines (≤500 m) pick up a just-perceptible depth cue while
 * exterior distances (up to ~11 km) accumulate the full ochre haze — the
 * park's air and the planet's air are the same air, only thinner glass apart.
 */
const FOG_START_METERS = 55
/** e-folding distance ~3.6 km: mesas at 5 km float, the horizon melts. */
export const FOG_EXTINCTION_PER_METER = uniform(1 / 3600)
/** Keep a sliver of surface signal at infinity. */
const MAX_FOG_AMOUNT = 0.93
/**
 * Sky/glass write no depth. r185 WebGPU is REVERSED-Z: the cleared
 * background reads ~0 (and classic far reads ~1 — guard both).
 */
const BACKGROUND_NEAR_EPSILON = 1e-7
const BACKGROUND_DEPTH = 0.999999

export interface MarsAerialPerspective {
  color: Node<'vec3'>
  amount: Node<'float'>
}

export function applyMarsAerialPerspective(
  scene: Node<'vec3'>,
  viewZ: Node<'float'>,
  sceneDepth: Node<'float'>,
  projectionInverse: Node<'mat4'>,
): MarsAerialPerspective {
  const distanceThroughHaze = viewZ.negate().sub(FOG_START_METERS).max(0)
  const transmittance = exp(distanceThroughHaze.mul(FOG_EXTINCTION_PER_METER.negate()))
  const surfaceMask = float(1)
    .sub(step(BACKGROUND_DEPTH, sceneDepth))
    .mul(step(BACKGROUND_NEAR_EPSILON, sceneDepth))
  const amount = float(1).sub(transmittance).min(MAX_FOG_AMOUNT).mul(surfaceMask)

  // Reconstruct the world-space view ray so haze glows toward the sun —
  // the forward-scatter lobe that makes dust read as dust, not gray fog.
  const viewPosition = getViewPosition(uv(), sceneDepth.min(0.9999), projectionInverse)
  const worldDirection = cameraWorldMatrix.mul(vec4(viewPosition.normalize(), 0)).xyz.normalize()
  const sunAmount = max(dot(worldDirection, sunDirectionUniform), 0)
  const sunGlow = pow(sunAmount, 6.0).mul(0.4).add(pow(sunAmount, 2.0).mul(0.14))

  // Inscatter must sit AT the horizon-sky radiance, never above it — haze
  // that outshines the sky bleaches the world instead of veiling it.
  const inscatter = dustHazeTint.mul(0.6).add(vec3(0.3, 0.185, 0.09).mul(sunGlow))
  return { color: mix(scene, inscatter, amount.clamp(0, 1)), amount }
}
