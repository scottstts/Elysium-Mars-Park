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
 *  2. `latticePaneSeams` — the same families at gasket width PLUS the pane
 *     grid inside each bay, drawn by the glass shell. The members themselves
 *     are real geometry (domeGeometry), so painting them on the glass a
 *     second time would double every line with up to a metre of parallax;
 *     what the glass owns is the silicone joint, which really does lie in the
 *     glass plane — and the pane grid, which has no member at all.
 *  3. `latticeSunVisibility` — (1) projected along the sun ray for any world
 *     point, with physically growing penumbra from the 0.35° Mars sun.
 *
 * Because domeGeometry builds from the same constants, the built ribs, the
 * shadow net on the floor and the seams on the glass can never disagree.
 *
 * THE GRID IS ONE GRAMMAR, EVERYWHERE THE SAME (this replaced a tiered
 * gridshell whose glazing bars doubled at ring 8 and again at ring 16 — one
 * structural bay showed 1 intermediate bar near the crown and 3 near the
 * foot, which read as an inconsistent spider net rather than as structure):
 *
 *   24 radial ribs, foundation → oculus compression ring, at every 15° of
 *   longitude, with NO subdivision anywhere on the shell.
 *   13 ring parallels 11.54 m of arc apart. Ring 1 IS the oculus compression
 *   ring; rings 2…12 are the built ring beams; ring 13 is the springing,
 *   where the plinth and the glazing boot take over from a beam.
 *   NO glazing bars — no 3-D member subdivides a bay. The glazing inside a
 *   bay is a grid of panes whose joints the GLASS draws as hairlines
 *   (latticePaneSeams), 4 columns × 2 rows per bay everywhere on the shell.
 *
 * Bays run 3.0 m × 11.5 m at the oculus to 34.0 m × 11.5 m at the springing —
 * deliberately large, because the members that remain are heavy enough to
 * read as structure from 130 m away (0.36 m wide at the crown, 0.84 m at the
 * springing, on a 0.62 → 1.55 m deep flanged section).
 */

export const DOME_BASE_RADIUS = 130
export const DOME_CROWN_HEIGHT = 64
export const DOME_SPHERE_RADIUS =
  (DOME_BASE_RADIUS ** 2 + DOME_CROWN_HEIGHT ** 2) / (2 * DOME_CROWN_HEIGHT) // 164.031
export const DOME_CENTER_Y = DOME_CROWN_HEIGHT - DOME_SPHERE_RADIUS // −100.031
export const DOME_THETA_BASE = Math.acos(-DOME_CENTER_Y / DOME_SPHERE_RADIUS) // 0.9147

/** Radial ribs: continuous members from the foundation to the oculus ring. */
export const DOME_RIBS = 24
/** Ring parallels; θ = k·DOME_RING_STEP for k = 1…DOME_RINGS. */
export const DOME_RINGS = 13
export const DOME_RING_STEP = DOME_THETA_BASE / DOME_RINGS // 0.07037 rad = 11.54 m
/** The compression ring's parallel, and its radius/height in world units. */
export const DOME_OCULUS_RING = 1
/** Built ring beams run between these two indices (inclusive). */
export const DOME_RING_FIRST = DOME_OCULUS_RING + 1 // 2
export const DOME_RING_LAST = DOME_RINGS - 1 // 12 — ring 13 is the springing
export const DOME_OCULUS_THETA = DOME_OCULUS_RING * DOME_RING_STEP
export const DOME_OCULUS_RADIUS = DOME_SPHERE_RADIUS * Math.sin(DOME_OCULUS_THETA) // 11.54
export const DOME_OCULUS_Y = DOME_CENTER_Y + DOME_SPHERE_RADIUS * Math.cos(DOME_OCULUS_THETA)
/** Radial glazing spokes inside the oculus, between hub cap and ring. */
export const DOME_HUB_SPOKES = 12
export const DOME_HUB_RADIUS = 2.4

/**
 * Member sections, [crown, foot] — everything tapers with θ. Half-widths are
 * measured ACROSS the member on the shell surface; depths are measured
 * radially outward from the inset face (the whole gridshell is an
 * exoskeleton, outboard of the glass, which is what lets the Panewalker ride
 * its ring beams and what puts internal pressure onto the frame).
 */
export const DOME_RIB_HALF_WIDTH = [0.18, 0.42] as const
export const DOME_RIB_DEPTH = [0.62, 1.55] as const
export const DOME_RING_HALF_WIDTH = [0.15, 0.3] as const
export const DOME_RING_DEPTH = [0.5, 1.15] as const
export const DOME_OCULUS_HALF_WIDTH = 0.8
export const DOME_OCULUS_DEPTH = 1.85
export const DOME_HUB_BAR_HALF_WIDTH = 0.16
export const DOME_HUB_BAR_DEPTH = 0.42
/**
 * GLAZING SUBDIVISION — the glass's own joints, and the ONLY thing in this
 * file that is not a member. A structural bay is far too big to be one cast
 * pane (34 × 11.5 m at the springing), so each bay is glazed as a grid of
 * panes whose joints are drawn as hairlines by the glass shell and are never,
 * ever built as 3-D bars.
 *
 * The counts are PER BAY and CONSTANT over the whole dome — that is the whole
 * point. The defect this shell was rebuilt to kill was a subdivision count
 * that CHANGED with height (bars doubling at ring 8 and again at ring 16), so
 * the eye met three different grammars walking down one rib. A constant count
 * simply converges toward the crown, which reads as perspective rather than
 * as a rule change.
 */
export const DOME_PANE_COLUMNS = 4 // 3 vertical seams inside every bay
export const DOME_PANE_ROWS = 2 // 1 horizontal mid-seam in every ring band
/** Meridian / parallel seam-line counts over the whole shell (derived). */
export const DOME_PANE_MERIDIANS = DOME_RIBS * DOME_PANE_COLUMNS // 96
export const DOME_PANE_PARALLELS = DOME_RINGS * DOME_PANE_ROWS // 26

/** Inner face of every member, radially proud of the glass. */
export const DOME_MEMBER_INSET = 0.06
/** Cast node collar's radial overhang past the rib's outer face. */
export const DOME_COLLAR_PROUD = 0.2
/** Crane rail: section radius, and its clearance over the node collars. */
export const DOME_RAIL_RADIUS = 0.08
export const DOME_RAIL_CLEARANCE = 0.04
/** Structural-silicone joint between panes: the glass's OWN line family. */
const SEAM_HALF_WIDTH = 0.016

/** Linear taper helper shared by geometry and the analytic field. */
export function domeTaper(range: readonly [number, number], theta: number): number {
  const t = Math.min(1, Math.max(0, theta / DOME_THETA_BASE))
  return range[0] + (range[1] - range[0]) * t
}

/**
 * Radial lift of the Panewalker's crane-rail CENTRELINE at θ.
 *
 * The rail cannot simply lie on the ring beam: it runs in φ, so it crosses
 * every rib and every cast node collar, and both of those are deeper than the
 * ring. Laying it on the ring buries 24 m of rail inside the ribs. It is
 * therefore carried on chairs at each node, clear above the deepest member it
 * crosses — which is exactly how a crane rail is built anyway.
 *
 * The gantry MUST derive its chord stand-off from this rather than hardcode
 * one, or it floats off its own rails the next time the shell is retuned.
 */
export function domeCraneRailLift(theta: number): number {
  return (
    DOME_MEMBER_INSET +
    domeTaper(DOME_RIB_DEPTH, theta) +
    DOME_COLLAR_PROUD +
    DOME_RAIL_CLEARANCE +
    DOME_RAIL_RADIUS
  )
}

/** Sun angular radius (0.175°) as tan — penumbra grows by this per meter. */
const PENUMBRA_PER_METER = 0.00305 * 2

/** Debug dial (live-tweakable): scales the physical penumbra growth. */
export const penumbraScale = /*@__PURE__*/ uniform(1)

const TWO_PI = Math.PI * 2

/** Ring index of the compression ring's inner face (where the oculus starts). */
const OCULUS_INNER_INDEX =
  (DOME_OCULUS_THETA - DOME_OCULUS_HALF_WIDTH / DOME_SPHERE_RADIUS) / DOME_RING_STEP
/** …and of its outer face, where the shell glazing (and its seams) begins. */
const OCULUS_OUTER_INDEX =
  (DOME_OCULUS_THETA + DOME_OCULUS_HALF_WIDTH / DOME_SPHERE_RADIUS) / DOME_RING_STEP

interface FamilyWidths {
  rib: readonly [number, number]
  ring: readonly [number, number]
  oculus: number
  hub: number
  hubCap: number
  /** Glazing joints inside a bay; null = this consumer does not draw them. */
  pane: number | null
}

const MEMBER_WIDTHS: FamilyWidths = {
  rib: DOME_RIB_HALF_WIDTH,
  ring: DOME_RING_HALF_WIDTH,
  oculus: DOME_OCULUS_HALF_WIDTH,
  hub: DOME_HUB_BAR_HALF_WIDTH,
  hubCap: DOME_HUB_RADIUS,
  // The structural net owns the shadow; a 32 mm silicone joint would add
  // ~0.9 % of PATTERNLESS coverage that the 0.35° penumbra smears into
  // exactly the uniform grey wash this field was rewritten to avoid — and it
  // would pay for it in the interior shaft march, which evaluates this per
  // step. Flip to SEAM_HALF_WIDTH if seam shadows are ever wanted.
  pane: null,
}

const SEAM_WIDTHS: FamilyWidths = {
  rib: [SEAM_HALF_WIDTH, SEAM_HALF_WIDTH],
  ring: [SEAM_HALF_WIDTH, SEAM_HALF_WIDTH],
  oculus: SEAM_HALF_WIDTH,
  hub: SEAM_HALF_WIDTH,
  // The hub cap is opaque plate, not glass: it has no silicone joint of its
  // own and the cap geometry covers this disc anyway.
  hubCap: SEAM_HALF_WIDTH,
  pane: SEAM_HALF_WIDTH,
}

/**
 * Coverage of one line family set at a point on the shell.
 *
 * `softMeters` is the softening radius: the penumbra for shadows, the pixel
 * footprint for direct view. Lines use the exact 1-D overlap integral of a
 * member of half-width hw with a box kernel of half-width `soft` — crisp when
 * soft ≪ hw, fading to hw/soft when the penumbra dwarfs the member, which is
 * precisely how a 0.35° sun softens an 0.84 m rib seen from 140 m below into
 * a broad band with a solid core.
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

  /**
   * Distance to the nearest line of a periodic family. The `+0.5` before
   * `fract` is load-bearing: without it the family's lines land on HALF
   * indices (φ = (i+½)·2π/N, θ = (k+½)·step), i.e. exactly mid-bay, and the
   * whole shadow net — and every silicone seam on the glass — sits half a bay
   * out of register with the built members. Geometry builds ribs at
   * φ = i·2π/N and rings at θ = k·step, so the field must too.
   */
  const meridianDistance = (count: number): Node<'float'> =>
    abs(phi.mul(count / TWO_PI).add(0.5).fract().sub(0.5))
      .mul(TWO_PI / count)
      .mul(metersPerPhi)
  const ringDistance = (count: number): Node<'float'> =>
    abs(theta.mul(count / DOME_THETA_BASE).add(0.5).fract().sub(0.5))
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
    smoothstep(ringIndex * DOME_RING_STEP - 0.004, ringIndex * DOME_RING_STEP + 0.004, theta)

  const ribs = line(meridianDistance(DOME_RIBS), mix(widths.rib[0], widths.rib[1], t))
  // Ring beams exist only between DOME_RING_FIRST and DOME_RING_LAST: the
  // oculus ring owns ring 1 (it is far deeper) and the springing has a plinth
  // instead of a beam, so the field must not draw lines there either.
  const rings = line(ringDistance(DOME_RINGS), mix(widths.ring[0], widths.ring[1], t))
    .mul(outboardOf(DOME_RING_FIRST - 0.5))
    .mul(float(1).sub(outboardOf(DOME_RING_LAST + 0.5)))

  // The compression ring is its own (much deeper) member, and the hub spokes
  // plus the hub cap live INSIDE it — masked off outboard so they never
  // double the ribs.
  const oculusRing = line(
    abs(theta.sub(DOME_OCULUS_THETA)).mul(DOME_SPHERE_RADIUS),
    widths.oculus,
  )
  // Masked at the compression ring's INNER FACE — the spokes really do run
  // all the way to it, and a mask a fraction of a ring early leaves an
  // unlit-looking annulus in the shadow that no member explains.
  const insideOculus = float(1).sub(outboardOf(OCULUS_INNER_INDEX))
  const hubSpokes = line(meridianDistance(DOME_HUB_SPOKES), widths.hub).mul(insideOculus)
  // The hub cap is a solid plate, so it is a disc of coverage, not a line.
  const hubCap = line(theta.mul(DOME_SPHERE_RADIUS), widths.hubCap).mul(insideOculus)

  const structure = max(max(ribs, rings), max(oculusRing, max(hubSpokes, hubCap)))
  if (widths.pane === null) return structure

  /**
   * Glazing joints. Both counts are exact multiples of the member counts
   * (96 = 24 ribs × 4, 26 = 13 rings × 2), so every 4th meridian seam and
   * every 2nd parallel seam lands ON a member's own joint instead of beside
   * it — the `max()` below can never draw a doubled line, and the pane grid
   * can never drift out of the structural bay it belongs to.
   */
  const paneMeridians = line(meridianDistance(DOME_PANE_MERIDIANS), widths.pane)
  const paneParallels = line(ringDistance(DOME_PANE_PARALLELS), widths.pane)
  // Shell glazing only: the oculus is glazed by the hub spokes, not by this
  // grid, so the seams start at the compression ring's outer face.
  const panes = max(paneMeridians, paneParallels).mul(outboardOf(OCULUS_OUTER_INDEX))

  return max(structure, panes)
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
 * Snapped to ring beams 4 and 8 of the 13-ring grid: the gantry rides crane
 * rails laid on those two ring beams, so the machine and the structure agree
 * by construction (domeGeometry lays the rails, robotsSystem builds the
 * gantry). Their rail lift comes from `domeCraneRailLift`.
 */
export const PANEWALKER_RAIL_RINGS = [4, 8] as const
export const PANEWALKER_THETA_MIN = PANEWALKER_RAIL_RINGS[0] * DOME_RING_STEP // 0.2815
export const PANEWALKER_THETA_MAX = PANEWALKER_RAIL_RINGS[1] * DOME_RING_STEP // 0.5630
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
