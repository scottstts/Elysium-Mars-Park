import {
  cameraWorldMatrix,
  exp,
  float,
  getViewPosition,
  mix,
  oneMinus,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { marsSkyRadiance } from '../sky/skyRadiance'

/**
 * One continuous dust medium for the whole world, applied screen-space in the
 * pipeline's hdrTransform. The same function does double duty by design:
 * interior sightlines (≤500 m) pick up a just-perceptible depth cue while
 * exterior distances (up to ~13 km) accumulate the full ochre haze — the
 * park's air and the planet's air are the same air, only thinner glass apart.
 *
 * The model is the real one, not a fog lerp:
 *
 *     L = L_surface · T  +  L_sky(direction) · (1 − T),    T = exp(−σ·d)
 *
 * Two things follow from writing it that way, and both are load-bearing:
 *
 * 1. **σ is a vec3.** Mars dust scrubs blue out of the transmitted beam far
 *    faster than red — that is the same physics that makes the sky
 *    butterscotch. With a scalar σ every channel is veiled equally and
 *    distance turns the massifs GRAY; with a spectral σ distance REDDENS
 *    them, which is what the reference image shows.
 * 2. **The source function is the sky itself**, sampled along the view ray,
 *    not a constant tint. A fully extinguished ridge then lands exactly on
 *    the sky behind it, so the far horizon dissolves with no seam and no
 *    possibility of the haze outshining the sky it is supposed to be.
 */
const FOG_START_METERS = 55

/**
 * Base extinction, ~1/5.2 km e-folding on the green channel. Longer than the
 * first pass (1/3.6 km), which veiled the main 2–4 km ridges so heavily their
 * form was gone by the time they reached the glass. Exposed as a uniform:
 * `window.__elysium.fogExtinction` tunes it live.
 */
export const FOG_EXTINCTION_PER_METER = /*@__PURE__*/ uniform(1 / 5200)

/**
 * Per-channel multiplier on the base. Red penetrates ~1.6× farther than blue,
 * so a 3 km massif keeps its warm channels while its blue is replaced by sky.
 */
const EXTINCTION_SPECTRUM = /*@__PURE__*/ vec3(0.78, 1.0, 1.28)

/** The horizon never resolves completely: keep a sliver of surface signal. */
const MIN_TRANSMITTANCE = 0.05

/** Guard against the circumsolar aureole blowing out a ridge on the sun line. */
const MAX_INSCATTER = 3.0

/**
 * Sky/glass write no depth. r185 WebGPU is REVERSED-Z: the cleared
 * background reads ~0 (and classic far reads ~1 — guard both).
 */
const BACKGROUND_NEAR_EPSILON = 1e-7
const BACKGROUND_DEPTH = 0.999999

export interface MarsAerialPerspective {
  color: Node<'vec3'>
  /** Mean veil fraction, for the ?pass=haze diagnostic. */
  amount: Node<'float'>
}

export function applyMarsAerialPerspective(
  scene: Node<'vec3'>,
  viewZ: Node<'float'>,
  sceneDepth: Node<'float'>,
  projectionInverse: Node<'mat4'>,
): MarsAerialPerspective {
  const distanceThroughHaze = viewZ.negate().sub(FOG_START_METERS).max(0)
  const opticalDepth = distanceThroughHaze
    .mul(FOG_EXTINCTION_PER_METER)
    .mul(EXTINCTION_SPECTRUM)
  const transmittance = exp(opticalDepth.negate()).max(MIN_TRANSMITTANCE)

  // Background pixels already ARE the sky; they must pass through untouched,
  // or the medium gets applied to itself.
  const surfaceMask = float(1)
    .sub(step(BACKGROUND_DEPTH, sceneDepth))
    .mul(step(BACKGROUND_NEAR_EPSILON, sceneDepth))
  const throughput = mix(vec3(1), transmittance, surfaceMask)

  // Reconstruct the world-space view ray: the medium's source function is the
  // sky radiance in the direction we are looking, which carries the sunward
  // forward-scatter lobe for free (dust reading as dust, not as gray fog).
  const viewPosition = getViewPosition(uv(), sceneDepth.min(0.9999), projectionInverse)
  const worldDirection = cameraWorldMatrix.mul(vec4(viewPosition.normalize(), 0)).xyz.normalize()
  const inscatter = marsSkyRadiance(worldDirection, float(0)).min(MAX_INSCATTER)

  const veil = oneMinus(throughput)
  const color = scene.mul(throughput).add(inscatter.mul(veil))
  const amount = veil.x.add(veil.y).add(veil.z).div(3)
  return { color, amount }
}
