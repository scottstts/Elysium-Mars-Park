import {
  Fn,
  abs,
  acos,
  atan,
  clamp,
  dot,
  float,
  max,
  min,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { sunDirectionUniform } from '../sky/sun'

/**
 * Dome One's lattice as MATH (plan §6): one analytic pattern function shared
 * by the glass shell (frame lines), every lit material's received shadow
 * (the ground net — no shadow map could hold 10 cm members over 500 m), and
 * the volumetric shafts. One function → the three can never disagree, and
 * the net gets physically correct penumbra growth from the 0.35° sun.
 */

export const DOME_BASE_RADIUS = 250
export const DOME_CROWN_HEIGHT = 120
export const DOME_SPHERE_RADIUS =
  (DOME_BASE_RADIUS ** 2 + DOME_CROWN_HEIGHT ** 2) / (2 * DOME_CROWN_HEIGHT) // 320.417
export const DOME_CENTER_Y = DOME_CROWN_HEIGHT - DOME_SPHERE_RADIUS // −200.417
export const DOME_THETA_BASE = Math.acos(-DOME_CENTER_Y / DOME_SPHERE_RADIUS) // 0.8952

/** Structural + fine-net family counts (see domeGeometry for the built set). */
export const PRIMARY_MERIDIANS = 24
export const SECONDARY_MERIDIANS = 96
export const STRUCTURAL_RINGS = 10
const FINE_MERIDIANS = 192
const FINE_RINGS = 56

const PRIMARY_HALF_WIDTH = 0.17
const SECONDARY_HALF_WIDTH = 0.08
const RING_HALF_WIDTH = 0.09
const FINE_HALF_WIDTH = 0.032

/** Sun angular radius (0.175°) as tan — penumbra grows by this per meter. */
const PENUMBRA_PER_METER = 0.00305 * 2

/** Debug dial (live-tweakable): scales the physical penumbra growth. */
export const penumbraScale = /*@__PURE__*/ uniform(1)

const TWO_PI = Math.PI * 2

/**
 * Coverage of lattice members at a point on the shell, given the unit vector
 * from the sphere center and a softening radius in meters (penumbra for
 * shadows, pixel footprint for direct view).
 */
export const latticeCoverage = /*@__PURE__*/ Fn(
  ([local, softMeters]: [Node<'vec3'>, Node<'float'>]) => {
    const theta = acos(clamp(local.y, -1, 1))
    const phi = atan(local.z, local.x)
    const metersPerPhi = float(DOME_SPHERE_RADIUS).mul(max(theta.sin(), 1e-3))
    const metersPerTheta = float(DOME_SPHERE_RADIUS)
    const soft = max(softMeters, 0.02)

    // Distance (meters) to the nearest line of a repeating angular family.
    const meridianDistance = (count: number): Node<'float'> =>
      abs(phi.mul(count / TWO_PI).fract().sub(0.5))
        .mul(TWO_PI / count)
        .mul(metersPerPhi)
    const ringDistance = (count: number): Node<'float'> =>
      abs(theta.mul(count / DOME_THETA_BASE).fract().sub(0.5))
        .mul(DOME_THETA_BASE / count)
        .mul(metersPerTheta)

    // Energy-conserving line coverage: the exact 1-D overlap of a member of
    // half-width hw with a box penumbra of half-width `soft` at distance d.
    // Crisp when soft ≪ hw (rim, glass pixels), fading to hw/soft when the
    // penumbra dwarfs the member (fine net seen from 140 m below) — which is
    // precisely how a 0.35° sun really washes out thin-member shadows.
    const line = (distance: Node<'float'>, halfWidth: number): Node<'float'> => {
      const overlap = min(distance.add(soft), float(halfWidth)).sub(
        max(distance.sub(soft), float(-halfWidth)),
      )
      return clamp(overlap.div(soft.mul(2)), 0, 1)
    }

    // Secondary/fine meridians taper away near the crown where they crowd.
    const crownFade = smoothstep(0.05, 0.17, theta)

    const primary = line(meridianDistance(PRIMARY_MERIDIANS), PRIMARY_HALF_WIDTH)
    const secondary = line(meridianDistance(SECONDARY_MERIDIANS), SECONDARY_HALF_WIDTH).mul(
      crownFade,
    )
    const structuralRing = line(ringDistance(STRUCTURAL_RINGS), RING_HALF_WIDTH)
    const fineMeridian = line(meridianDistance(FINE_MERIDIANS), FINE_HALF_WIDTH)
      .mul(crownFade)
      .mul(0.9)
    const fineRing = line(ringDistance(FINE_RINGS), FINE_HALF_WIDTH).mul(0.9)

    // One diagonal family triangulates the fine quads (approximate metric).
    const u = phi.mul(FINE_MERIDIANS / TWO_PI)
    const v = theta.mul(FINE_RINGS / DOME_THETA_BASE)
    const cellMeters = min(metersPerPhi.mul(TWO_PI / FINE_MERIDIANS), float(4.6)).mul(0.62)
    const diagonalDistance = abs(u.add(v).fract().sub(0.5)).mul(cellMeters)
    const diagonal = line(diagonalDistance, FINE_HALF_WIDTH * 0.85).mul(crownFade).mul(0.82)

    return max(
      max(max(primary, secondary), max(structuralRing, fineRing)),
      max(fineMeridian, diagonal),
    )
  },
)

/**
 * Panewalker's current rail longitude — drives the cleaned dust swath.
 * Starts ON the sun line (math bearing atan2(z,x) = 160° = 2.793 rad,
 * matching sunDirection (-0.837, 0.454, 0.305)): a new session opens with
 * the gantry silhouetted in the glare, its band shadow near the plaza,
 * then it walks on and the band sweeps across the gardens.
 */
export const panewalkerPhi = /*@__PURE__*/ uniform(2.793)

/** The walker's θ span on the shell (shared by geometry + shadow + swath). */
export const PANEWALKER_THETA_MIN = 0.3
export const PANEWALKER_THETA_MAX = 0.62
/** Gantry footprint in longitude at its mid-θ (≈3.6 m wide truss). */
const PANEWALKER_HALF_WIDTH_METERS = 1.8
/** Truss openness: how much sun its lattice of members still passes. */
const PANEWALKER_OPACITY = 0.62

/**
 * The Panewalker's traveling shadow — evaluated on the SAME sphere
 * projection as the lattice net, so the gantry's soft cloud sweeps the park
 * in perfect agreement with the glass it cleans. Multiplied inside
 * latticeSunVisibility below.
 */
const panewalkerOcclusion = (
  phi: Node<'float'>,
  theta: Node<'float'>,
  soft: Node<'float'>,
  metersPerPhi: Node<'float'>,
): Node<'float'> => {
  const phiDelta = abs(
    phi.sub(panewalkerPhi).add(Math.PI).mod(Math.PI * 2).sub(Math.PI),
  ).mul(metersPerPhi)
  const overlap = min(phiDelta.add(soft), float(PANEWALKER_HALF_WIDTH_METERS)).sub(
    max(phiDelta.sub(soft), float(-PANEWALKER_HALF_WIDTH_METERS)),
  )
  const band = clamp(overlap.div(soft.mul(2)), 0, 1)
  const inTheta = smoothstep(PANEWALKER_THETA_MIN - 0.03, PANEWALKER_THETA_MIN + 0.03, theta).mul(
    smoothstep(PANEWALKER_THETA_MAX + 0.03, PANEWALKER_THETA_MAX - 0.03, theta),
  )
  return band.mul(inTheta).mul(PANEWALKER_OPACITY)
}

/**
 * Sun visibility through the lattice for ANY world position (inside the dome,
 * on it, or outside in the dome's cast shadow). 1 = fully sunlit.
 */
export const latticeSunVisibility = /*@__PURE__*/ Fn(([worldPos]: [Node<'vec3'>]) => {
  const center = vec3(0, DOME_CENTER_Y, 0)
  const toCenter = worldPos.sub(center)
  const b = dot(toCenter, sunDirectionUniform)
  const c = dot(toCenter, toCenter).sub(DOME_SPHERE_RADIUS * DOME_SPHERE_RADIUS)
  const discriminant = b.mul(b).sub(c)
  // Far root: the exit point of the sun ray through the sphere shell.
  const t = sqrt(max(discriminant, 0)).sub(b)
  const hit = worldPos.add(sunDirectionUniform.mul(t))
  const local = hit.sub(center).div(DOME_SPHERE_RADIUS)
  // Valid only when the ray actually crosses the built cap (above ground).
  const hitsCap = smoothstep(0.0, 0.004, hit.y.add(0.5)).mul(
    smoothstep(0.0, 0.0001, discriminant),
  )
  const applies = hitsCap.mul(smoothstep(-0.5, 0.5, t))
  const soft = t.mul(PENUMBRA_PER_METER).mul(penumbraScale).add(0.03)
  const coverage = latticeCoverage(local, soft)
  // The Panewalker's soft traveling cloud rides the same projection.
  const theta = acos(clamp(local.y, -1, 1))
  const phi = atan(local.z, local.x)
  const metersPerPhi = float(DOME_SPHERE_RADIUS).mul(max(theta.sin(), 1e-3))
  const walker = panewalkerOcclusion(phi, theta, soft, metersPerPhi)
  const combined = max(coverage, walker)
  return float(1).sub(combined.mul(applies).mul(0.97))
})


/** GPU-print of the projection intermediates for ?pass=shadows debugging. */
export const latticeProjectionDebug = /*@__PURE__*/ Fn(([worldPos]: [Node<'vec3'>]) => {
  const center = vec3(0, DOME_CENTER_Y, 0)
  const toCenter = worldPos.sub(center)
  const b = dot(toCenter, sunDirectionUniform)
  const c = dot(toCenter, toCenter).sub(DOME_SPHERE_RADIUS * DOME_SPHERE_RADIUS)
  const discriminant = b.mul(b).sub(c)
  const t = sqrt(max(discriminant, 0)).sub(b)
  const hit = worldPos.add(sunDirectionUniform.mul(t))
  const local = hit.sub(center).div(DOME_SPHERE_RADIUS)
  const theta = acos(clamp(local.y, -1, 1))
  const coverage = latticeCoverage(local, float(0.05))
  return vec3(t.div(400), theta.div(DOME_THETA_BASE), coverage)
})

/**
 * NOTE: there is deliberately NO per-material shadow hook here. r185 caches
 * the first-built receiver's `receivedShadowNode` on the light node for ALL
 * materials (AnalyticLightNode.setupShadow), so per-material wraps are a
 * trap. The lattice net multiplies into the sun's shadow INSIDE
 * CachedShadowClipmapNode.setup — one place, every receiver.
 */
