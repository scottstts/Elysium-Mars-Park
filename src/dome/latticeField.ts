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
  mix,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl'
import type { Node } from 'three/webgpu'
import { sunDirectionUniform } from '../sky/sun'

/**
 * Dome One's gridshell as MATH. ONE definition of the member families lives
 * here and is consumed three ways:
 *
 *  1. `latticeCoverage` — the members' silhouette, used for the analytic sun
 *     shadow net (multiplied into the sun inside CachedShadowClipmapNode) and
 *     the interior shaft march.
 *  2. `latticePaneSeams` — the SAME families at gasket width, drawn by the
 *     glass shell. The members themselves are real geometry (domeGeometry),
 *     so painting them on the glass a second time would double every line
 *     with up to a metre of parallax; what the glass owns is the structural
 *     silicone joint, which really does lie in the glass plane.
 *  3. `latticeSunVisibility` — (1) projected along the sun ray for any world
 *     point, with physically growing penumbra from the 0.35° Mars sun.
 *
 * Because domeGeometry builds from the same constants, the built ribs, the
 * shadow net on the floor and the seams on the glass can never disagree.
 *
 * GRID (all of it derived, nothing hardcoded downstream):
 *   48 radial ribs, foundation → oculus compression ring.
 *   36 ring-beam parallels (4.17 m of arc apart) — ring 36 is the springing
 *   ring at the foot, ring 2 is the oculus compression ring.
 *   Glazing bars halve the bay twice as the dome widens: 48 lines above ring
 *   8, 96 above ring 8, 192 above ring 16 — so every pane stays 2.1–4.3 m
 *   wide by 4.17 m tall, and a bar always drops out AT a ring beam.
 */

export const DOME_BASE_RADIUS = 130
export const DOME_CROWN_HEIGHT = 64
export const DOME_SPHERE_RADIUS =
  (DOME_BASE_RADIUS ** 2 + DOME_CROWN_HEIGHT ** 2) / (2 * DOME_CROWN_HEIGHT) // 164.031
export const DOME_CENTER_Y = DOME_CROWN_HEIGHT - DOME_SPHERE_RADIUS // −100.031
export const DOME_THETA_BASE = Math.acos(-DOME_CENTER_Y / DOME_SPHERE_RADIUS) // 0.9147

/** Radial ribs: continuous members from the foundation to the oculus ring. */
export const DOME_RIBS = 48
/** Ring-beam parallels; θ = k·DOME_RING_STEP for k = 1…DOME_RINGS. */
export const DOME_RINGS = 36
export const DOME_RING_STEP = DOME_THETA_BASE / DOME_RINGS // 0.02541 rad = 4.168 m
/** The compression ring's parallel, and its radius/height in world units. */
export const DOME_OCULUS_RING = 2
export const DOME_OCULUS_THETA = DOME_OCULUS_RING * DOME_RING_STEP
export const DOME_OCULUS_RADIUS = DOME_SPHERE_RADIUS * Math.sin(DOME_OCULUS_THETA) // 8.33
export const DOME_OCULUS_Y = DOME_CENTER_Y + DOME_SPHERE_RADIUS * Math.cos(DOME_OCULUS_THETA)
/** Radial glazing spokes inside the oculus, between hub cap and ring. */
export const DOME_HUB_SPOKES = 12
export const DOME_HUB_RADIUS = 1.35

/**
 * Glazing-bar tiers: [ring index where the family starts, line count].
 * Each count is a multiple of DOME_RIBS, so a finer family always contains
 * the coarser one — the bars line up through every drop.
 */
export const DOME_BAR_TIERS: ReadonlyArray<readonly [number, number]> = [
  [8, DOME_RIBS * 2], // 96 lines from ring 8 outward (pane 2.17 → 4.25 m)
  [16, DOME_RIBS * 4], // 192 lines from ring 16 outward (pane 2.13 → 4.25 m)
]

/** Member sections, [crown, foot] — everything tapers with θ. */
export const DOME_RIB_HALF_WIDTH = [0.085, 0.16] as const
export const DOME_RIB_DEPTH = [0.34, 0.95] as const
export const DOME_RING_HALF_WIDTH = [0.075, 0.115] as const
export const DOME_RING_DEPTH = [0.28, 0.55] as const
export const DOME_BAR_HALF_WIDTH = 0.055
export const DOME_BAR_DEPTH = 0.2
export const DOME_OCULUS_HALF_WIDTH = 0.55
export const DOME_OCULUS_DEPTH = 1.15
export const DOME_HUB_BAR_HALF_WIDTH = 0.07
/** Inner face of every member, radially proud of the glass. */
export const DOME_MEMBER_INSET = 0.06
/** Structural-silicone joint between panes: the glass's OWN line family. */
const SEAM_HALF_WIDTH = 0.016

/** Linear taper helper shared by geometry and the analytic field. */
export function domeTaper(range: readonly [number, number], theta: number): number {
  const t = Math.min(1, Math.max(0, theta / DOME_THETA_BASE))
  return range[0] + (range[1] - range[0]) * t
}

/** Sun angular radius (0.175°) as tan — penumbra grows by this per meter. */
const PENUMBRA_PER_METER = 0.00305 * 2

/** Debug dial (live-tweakable): scales the physical penumbra growth. */
export const penumbraScale = /*@__PURE__*/ uniform(1)

const TWO_PI = Math.PI * 2

interface FamilyWidths {
  rib: readonly [number, number]
  ring: readonly [number, number]
  bar: number
  oculus: number
  hub: number
}

const MEMBER_WIDTHS: FamilyWidths = {
  rib: DOME_RIB_HALF_WIDTH,
  ring: DOME_RING_HALF_WIDTH,
  bar: DOME_BAR_HALF_WIDTH,
  oculus: DOME_OCULUS_HALF_WIDTH,
  hub: DOME_HUB_BAR_HALF_WIDTH,
}

const SEAM_WIDTHS: FamilyWidths = {
  rib: [SEAM_HALF_WIDTH, SEAM_HALF_WIDTH],
  ring: [SEAM_HALF_WIDTH, SEAM_HALF_WIDTH],
  bar: SEAM_HALF_WIDTH,
  oculus: SEAM_HALF_WIDTH,
  hub: SEAM_HALF_WIDTH,
}

/**
 * Coverage of one line family set at a point on the shell.
 *
 * `softMeters` is the softening radius: the penumbra for shadows, the pixel
 * footprint for direct view. Lines use the exact 1-D overlap integral of a
 * member of half-width hw with a box kernel of half-width `soft` — crisp when
 * soft ≪ hw, fading to hw/soft when the penumbra dwarfs the member, which is
 * precisely how a 0.35° sun washes out a 110 mm glazing bar seen from 140 m
 * below while leaving the 320 mm ribs legible.
 */
const latticeField = (
  local: Node<'vec3'>,
  softMeters: Node<'float'>,
  widths: FamilyWidths,
): Node<'float'> => {
  const theta = acos(clamp(local.y, -1, 1))
  const phi = atan(local.z, local.x)
  const metersPerPhi = float(DOME_SPHERE_RADIUS).mul(max(theta.sin(), 1e-3))
  const soft = max(softMeters, 0.02)
  const t = clamp(theta.div(DOME_THETA_BASE), 0, 1)

  const meridianDistance = (count: number): Node<'float'> =>
    abs(phi.mul(count / TWO_PI).fract().sub(0.5))
      .mul(TWO_PI / count)
      .mul(metersPerPhi)
  const ringDistance = (count: number): Node<'float'> =>
    abs(theta.mul(count / DOME_THETA_BASE).fract().sub(0.5))
      .mul(DOME_THETA_BASE / count)
      .mul(DOME_SPHERE_RADIUS)

  const line = (distance: Node<'float'>, halfWidth: Node<'float'> | number): Node<'float'> => {
    const hw = typeof halfWidth === 'number' ? float(halfWidth) : halfWidth
    const overlap = min(distance.add(soft), hw).sub(max(distance.sub(soft), hw.negate()))
    return clamp(overlap.div(soft.mul(2)), 0, 1)
  }

  /**
   * 1 outboard of a ring index, 0 inboard. NEVER a reversed-edge smoothstep:
   * WGSL leaves smoothstep(hi, lo, x) implementation-defined, so an inward
   * mask is always written as 1 − smoothstep(lo, hi, x).
   */
  const outboardOf = (ringIndex: number): Node<'float'> =>
    smoothstep(ringIndex * DOME_RING_STEP - 0.006, ringIndex * DOME_RING_STEP + 0.006, theta)

  const ribs = line(meridianDistance(DOME_RIBS), mix(widths.rib[0], widths.rib[1], t))
  const rings = line(ringDistance(DOME_RINGS), mix(widths.ring[0], widths.ring[1], t)).mul(
    outboardOf(DOME_OCULUS_RING + 0.6),
  )

  let bars = ribs
  for (const [startRing, count] of DOME_BAR_TIERS) {
    bars = max(bars, line(meridianDistance(count), widths.bar).mul(outboardOf(startRing)))
  }

  // The compression ring is its own (much deeper) member, and the hub spokes
  // live INSIDE it — masked off outboard so they never double the bars.
  const oculusRing = line(
    abs(theta.sub(DOME_OCULUS_THETA)).mul(DOME_SPHERE_RADIUS),
    widths.oculus,
  )
  const hubSpokes = line(meridianDistance(DOME_HUB_SPOKES), widths.hub).mul(
    float(1).sub(outboardOf(DOME_OCULUS_RING - 0.5)),
  )

  return max(max(bars, rings), max(oculusRing, hubSpokes))
}

/** Structural members' silhouette — shadow net + volumetric shafts. */
export const latticeCoverage = /*@__PURE__*/ Fn(
  ([local, softMeters]: [Node<'vec3'>, Node<'float'>]) =>
    latticeField(local, softMeters, MEMBER_WIDTHS),
)

/** The same grid at silicone-joint width — the glass shell's own lines. */
export const latticePaneSeams = /*@__PURE__*/ Fn(
  ([local, softMeters]: [Node<'vec3'>, Node<'float'>]) =>
    latticeField(local, softMeters, SEAM_WIDTHS),
)

/**
 * Panewalker's current rail longitude — drives the cleaned dust swath.
 * Starts ON the sun line (math bearing atan2(z,x) = 160° = 2.793 rad,
 * matching sunDirection (-0.837, 0.454, 0.305)): a new session opens with
 * the gantry silhouetted in the glare, its band shadow near the plaza,
 * then it walks on and the band sweeps across the gardens.
 */
export const panewalkerPhi = /*@__PURE__*/ uniform(2.793)

/**
 * The walker's θ span on the shell (shared by geometry + shadow + swath).
 * Snapped to ring beams 12 and 24: the gantry rides crane rails laid on
 * those two ring beams, so the machine and the structure agree by
 * construction (domeGeometry lays the rails, robotsSystem builds the gantry).
 */
export const PANEWALKER_RAIL_RINGS = [12, 24] as const
export const PANEWALKER_THETA_MIN = PANEWALKER_RAIL_RINGS[0] * DOME_RING_STEP // 0.3049
export const PANEWALKER_THETA_MAX = PANEWALKER_RAIL_RINGS[1] * DOME_RING_STEP // 0.6098
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
    float(1).sub(smoothstep(PANEWALKER_THETA_MAX - 0.03, PANEWALKER_THETA_MAX + 0.03, theta)),
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
