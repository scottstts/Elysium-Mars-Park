import { Group, ShapeUtils, Vector2, Vector3 } from 'three'
import type { Material } from 'three'
import { PartWriter } from '../archkit/writer'
import type { DomeSlot } from './domeMaterials'
import {
  DOME_CENTER_Y,
  DOME_COLLAR_PROUD,
  DOME_HUB_BAR_DEPTH,
  DOME_HUB_BAR_HALF_WIDTH,
  DOME_HUB_RADIUS,
  DOME_HUB_SPOKES,
  DOME_MEMBER_INSET,
  DOME_OCULUS_DEPTH,
  DOME_OCULUS_HALF_WIDTH,
  DOME_OCULUS_RING,
  DOME_OCULUS_THETA,
  DOME_RAIL_RADIUS,
  DOME_RIBS,
  DOME_RIB_DEPTH,
  DOME_RIB_HALF_WIDTH,
  DOME_RINGS,
  DOME_RING_DEPTH,
  DOME_RING_FIRST,
  DOME_RING_HALF_WIDTH,
  DOME_RING_LAST,
  DOME_RING_STEP,
  DOME_SPHERE_RADIUS,
  DOME_THETA_BASE,
  PANEWALKER_RAIL_RINGS,
  domeCraneRailLift,
  domeTaper,
} from './latticeField'

/**
 * The BUILT gridshell of Dome One — every structural line described by
 * `latticeCoverage` in latticeField.ts is real geometry here, at the same θ/φ:
 *
 *   ribs      24 continuous lofted FLANGED sections, foundation → oculus,
 *             tapering 0.84 × 1.55 m at the springing to 0.36 × 0.62 m at the
 *             crown (always deeper than wide — they work in bending).
 *   rings     11 parallels of segmented ring beams (rings 2…12), one segment
 *             per rib bay, shallower than the ribs, HAUNCHED at both ends so
 *             the connection into the rib node reads as a moment joint.
 *   nodes     a cast collar wraps the rib at every rib×ring crossing and
 *             swallows the haunched ring ends with a 15 mm reveal — no member
 *             ever clips through another, and no two faces share a plane.
 *   oculus    compression ring + hub spokes + hub cap + maintenance handrail.
 *   footing   cast-stone plinth ring, per-rib base shoes with anchor studs,
 *             and the glazing boot that seals the shell foot.
 *   rails     crane rails on ring beams 4 and 8 for the Panewalker.
 *
 * There are NO glazing bars. The previous shell subdivided each bay with
 * mullion families that DOUBLED at ring 8 and again at ring 16, so one
 * structural bay carried 1 intermediate bar near the crown and 3 near the
 * foot: the grid changed grammar three times down the same rib, which is what
 * made the dome read as a spider net. The glass now draws no grid or seam
 * pattern at all; every visible subdivision is real structural geometry.
 *
 * Members cast NO shadow maps: the analytic net owns all dome shadowing, so
 * the two systems can never double-darken.
 *
 * MEMBER HIERARCHY (the rule that keeps the assembly clean): ribs are
 * continuous, rings stop at rib collars. Radially every member's inner face
 * sits DOME_MEMBER_INSET proud of the glass; only the depth differs, so
 * nothing intersects and nothing is coplanar.
 */

const TWO_PI = Math.PI * 2
const CENTER = /*@__PURE__*/ new Vector3(0, DOME_CENTER_Y, 0)

/**
 * The connector-tube penetration. The shell is a TRIMMED OPENING here: a
 * reinforcing ring frame carries the cut rib and ring beams, exactly as a
 * real gridshell resolves a hole. Axis and bore agree with glassShell's
 * portalCut and with the tram's iris at z = 128.4.
 */
export const PORTAL_AXIS_Y = 4.6
export const PORTAL_BORE = 6.15
const PORTAL_FRAME_CENTER = 6.57
const PORTAL_FRAME_HALF = 0.42
/** Members stop this far from the tube axis, leaving a reveal at the frame. */
const PORTAL_CLEAR = PORTAL_FRAME_CENTER + PORTAL_FRAME_HALF + 0.03

/** Distance from the tube axis, valid only on the south face of the shell. */
function boreDistance(p: Vector3): number {
  if (p.z < 60) return Number.POSITIVE_INFINITY
  return Math.hypot(p.x, p.y - PORTAL_AXIS_Y)
}

/** Cast collar's tangential overhang past the rib face. */
const COLLAR_SIDE_PROUD = 0.16
/** Shadow-gap reveal at every butt joint (never flush — never coplanar). */
const JOINT_REVEAL = 0.015
/** Plinth ring: the shell springs out of this. */
const PLINTH_INNER_RADIUS = 128.9
const PLINTH_OUTER_RADIUS = 131.7
const PLINTH_TOP_Y = 1.15
const PLINTH_BOTTOM_Y = -2.4
/** Where the ribs stop at the crown: clear of the compression ring's face. */
const RIB_TOP_THETA =
  DOME_OCULUS_THETA + (DOME_OCULUS_HALF_WIDTH + JOINT_REVEAL) / DOME_SPHERE_RADIUS
/** Ribs run on down into the plinth so the springing is never a floating cut. */
const RIB_FOOT_THETA = DOME_THETA_BASE + 2.2 / DOME_SPHERE_RADIUS
/** Sub-stations per ring bay along a rib: 3.85 m chords sag 11 mm on R=164. */
const RIB_SUBDIVISIONS = 3
/** Longest chord a ring bay may take (15 mm of sag — under a pixel at 15 m). */
const RING_SEGMENT_ARC = 4.5
/** Ring haunch: extra half-width at the node face, and the arc it eases over. */
const RING_HAUNCH_GAIN = 0.5
const RING_HAUNCH_ARC = 2.4

export function shellPoint(theta: number, phi: number, lift = 0): Vector3 {
  const r = DOME_SPHERE_RADIUS + lift
  return new Vector3(
    Math.sin(theta) * Math.cos(phi) * r,
    DOME_CENTER_Y + Math.cos(theta) * r,
    Math.sin(theta) * Math.sin(phi) * r,
  )
}

/** θ of a given height on the shell (used to land parts on world datums). */
function thetaAtHeight(y: number): number {
  return Math.acos(Math.min(1, Math.max(-1, (y - DOME_CENTER_Y) / DOME_SPHERE_RADIUS)))
}

/**
 * A section profile in the (lateral, radial) plane of a station: lateral 0 is
 * the member's centreline, radial 0 its inner face (the one you see from the
 * park, through the glass). Points run counter-clockwise, and — the one
 * convention the sweep depends on — every ODD-indexed edge is an arris band
 * that routes to the wear slot. Both profiles below have an even point count
 * with chamfers strictly on the odd edges.
 */
type ProfilePoint = readonly [number, number]
type SectionFn = (half: number, depth: number, chamfer: number) => ProfilePoint[]

/** Chamfered rectangle — collars, shoes, spokes, the portal frame. */
const boxSection: SectionFn = (h, d, chamfer) => {
  const c = Math.min(chamfer, h * 0.45, d * 0.4)
  return [
    [-h + c, 0],
    [h - c, 0],
    [h, c],
    [h, d - c],
    [h - c, d],
    [-h + c, d],
    [-h, d - c],
    [-h, c],
  ]
}

/**
 * The real thing: a flanged girder. A wide inner flange (what the park sees),
 * a narrow web, a slightly narrower outer flange, filleted at both web
 * junctions and chamfered at every arris. This is what makes a rib read as
 * structure rather than as a stick — the inner flange catches the sky, the
 * web goes dark, and the flange returns are a hard bright line along the
 * whole member.
 */
const flangedSection: SectionFn = (h, d, chamfer) => {
  const ti = d * 0.26 // inner flange thickness
  const to = d * 0.22 // outer flange thickness
  const web = Math.min(Math.max(h * 0.36, 0.06), h * 0.5)
  const ho = Math.min(Math.max(h * 0.78, web + 0.06), h - 0.02)
  const f = Math.min(0.07, (ho - web) * 0.35, ti * 0.35, to * 0.35)
  const c = Math.min(chamfer, ti * 0.4, to * 0.4, (ho - web - f) * 0.8)
  return [
    [-h + c, 0],
    [h - c, 0],
    [h, c],
    [h, ti - c],
    [h - c, ti],
    [web + f, ti],
    [web, ti + f],
    [web, d - to - f],
    [web + f, d - to],
    [ho - c, d - to],
    [ho, d - to + c],
    [ho, d - c],
    [ho - c, d],
    [-ho + c, d],
    [-ho, d - c],
    [-ho, d - to + c],
    [-ho + c, d - to],
    [-web - f, d - to],
    [-web, d - to - f],
    [-web, ti + f],
    [-web - f, ti],
    [-h + c, ti],
    [-h, ti - c],
    [-h, c],
  ]
}

interface Station {
  /** Point ON the shell surface; the section is offset radially from here. */
  p: Vector3
  /** Half-width across the member (tangential to the sweep). */
  half: number
  /** Section depth measured radially outward from the inset face. */
  depth: number
}

interface SweepOptions {
  slot: DomeSlot
  edgeSlot?: DomeSlot
  inset?: number
  chamfer?: number
  section?: SectionFn
  capStart?: boolean
  capEnd?: boolean
  closed?: boolean
}

/**
 * Sweep a section along a station list.
 *
 * The section is authored once per station as a point list in the (lateral,
 * radial) plane — chamfers and fillets ARE profile points, not a
 * post-process, so a bend never opens a corner. Frames are (s, u, t) with
 * s = u × t, which makes the profile counter-clockwise seen along the sweep,
 * so every emitted quad faces outward without a winding special case.
 */
function sweepSection(writer: PartWriter, stations: Station[], options: SweepOptions): void {
  const count = stations.length
  if (count < 2) return
  const inset = options.inset ?? DOME_MEMBER_INSET
  const slot = options.slot
  const edgeSlot = options.edgeSlot ?? options.slot
  const closed = options.closed ?? false
  const section = options.section ?? boxSection
  const chamfer = options.chamfer ?? 0.03
  const profiles: ProfilePoint[][] = []
  const rings: Vector3[][] = []
  const u = new Vector3()
  const s = new Vector3()
  const tangent = new Vector3()

  for (let i = 0; i < count; i++) {
    const station = stations[i]
    const previous = closed ? stations[(i - 1 + count) % count].p : stations[Math.max(0, i - 1)].p
    const next = closed ? stations[(i + 1) % count].p : stations[Math.min(count - 1, i + 1)].p
    tangent.subVectors(next, previous).normalize()
    u.subVectors(station.p, CENTER).normalize()
    s.crossVectors(u, tangent).normalize()

    const profile = section(station.half, station.depth, chamfer)
    profiles.push(profile)
    rings.push(
      profile.map(([x, y]) =>
        station.p.clone().addScaledVector(s, x).addScaledVector(u, inset + y),
      ),
    )
  }

  const points = profiles[0].length
  const segments = closed ? count : count - 1
  for (let i = 0; i < segments; i++) {
    const a = rings[i]
    const b = rings[(i + 1) % count]
    for (let e = 0; e < points; e++) {
      const e2 = (e + 1) % points
      // Odd profile edges are the chamfer/fillet bands.
      writer.quad(e % 2 === 1 ? edgeSlot : slot, a[e], a[e2], b[e2], b[e])
    }
  }

  if (!closed && options.capStart) capSection(writer, slot, profiles[0], rings[0], true)
  if (!closed && options.capEnd) {
    capSection(writer, slot, profiles[count - 1], rings[count - 1], false)
  }
}

/**
 * Close a swept section. Ear-clipped from the 2-D profile rather than fanned
 * from a centroid: a flanged section is NOT star-shaped about its centroid,
 * and a centroid fan lays triangles straight across both web notches.
 */
function capSection(
  writer: PartWriter,
  slot: DomeSlot,
  profile: ProfilePoint[],
  ring: Vector3[],
  flip: boolean,
): void {
  const contour = profile.map(([x, y]) => new Vector2(x, y))
  for (const face of ShapeUtils.triangulateShape(contour, [])) {
    const [a, b, c] = face
    if (flip) writer.tri(slot, ring[a], ring[c], ring[b])
    else writer.tri(slot, ring[a], ring[b], ring[c])
  }
}

/** Station on the shell between two stations, re-projected onto the sphere. */
function lerpStation(a: Station, b: Station, t: number): Station {
  const p = a.p.clone().lerp(b.p, t).sub(CENTER).normalize().multiplyScalar(DOME_SPHERE_RADIUS)
  return {
    p: p.add(CENTER),
    half: a.half + (b.half - a.half) * t,
    depth: a.depth + (b.depth - a.depth) * t,
  }
}

/**
 * Emit a member, cut around the portal opening. A member that grazes the
 * aperture is split into runs and each run's boundary is walked out to the
 * frame's reveal line by bisection — so the rib on the portal meridian and
 * the ring beam that crosses it end ON the portal frame instead of flying
 * through the tram tube.
 */
function emitMember(writer: PartWriter, stations: Station[], options: SweepOptions): void {
  const outside = stations.map((s) => boreDistance(s.p) >= PORTAL_CLEAR)
  if (outside.every(Boolean)) {
    sweepSection(writer, stations, options)
    return
  }
  if (options.closed || outside.every((v) => !v)) return

  const walkToFrame = (inner: Station, outer: Station): Station => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      if (boreDistance(lerpStation(inner, outer, mid).p) >= PORTAL_CLEAR) hi = mid
      else lo = mid
    }
    return lerpStation(inner, outer, hi)
  }

  let index = 0
  while (index < stations.length) {
    if (!outside[index]) {
      index++
      continue
    }
    let end = index
    while (end + 1 < stations.length && outside[end + 1]) end++
    const run: Station[] = stations.slice(index, end + 1)
    if (index > 0) run.unshift(walkToFrame(stations[index - 1], stations[index]))
    if (end + 1 < stations.length) run.push(walkToFrame(stations[end + 1], stations[end]))
    if (run.length >= 2) {
      sweepSection(writer, run, { ...options, capStart: true, capEnd: true })
    }
    index = end + 1
  }
}

function ribStation(theta: number, phi: number): Station {
  return {
    p: shellPoint(theta, phi),
    half: domeTaper(DOME_RIB_HALF_WIDTH, theta),
    depth: domeTaper(DOME_RIB_DEPTH, theta),
  }
}

function buildRibs(writer: PartWriter): void {
  for (let i = 0; i < DOME_RIBS; i++) {
    const phi = (i / DOME_RIBS) * TWO_PI
    const stations: Station[] = [ribStation(RIB_FOOT_THETA, phi)]
    // One station every third of a ring bay: the bays are 11.5 m of arc now,
    // and a full-bay chord would stand 10 cm off the sphere.
    for (let k = DOME_RINGS * RIB_SUBDIVISIONS; k > DOME_OCULUS_RING * RIB_SUBDIVISIONS; k--) {
      stations.push(ribStation((k / RIB_SUBDIVISIONS) * DOME_RING_STEP, phi))
    }
    stations.push(ribStation(RIB_TOP_THETA, phi))
    emitMember(writer, stations, {
      slot: 'shell',
      edgeSlot: 'shellEdge',
      section: flangedSection,
      chamfer: 0.05,
      capStart: true,
      capEnd: true,
    })
  }
}

/** Angular half-gap a ring segment keeps clear of the rib collar at θ. */
function ringBayGap(theta: number): number {
  const radius = Math.max(1e-3, DOME_SPHERE_RADIUS * Math.sin(theta))
  return (domeTaper(DOME_RIB_HALF_WIDTH, theta) + COLLAR_SIDE_PROUD + JOINT_REVEAL) / radius
}

/**
 * Ring beams, one segment per rib bay, haunched into the node at both ends.
 *
 * The haunch is IN PLANE only (half-width, never depth): the crane rails are
 * laid on the ring's outer face at a lift derived from the nominal depth, and
 * a deepening haunch would push the beam straight through its own rail.
 */
function buildRingBeams(writer: PartWriter): void {
  for (let j = DOME_RING_FIRST; j <= DOME_RING_LAST; j++) {
    const theta = j * DOME_RING_STEP
    const ringRadius = DOME_SPHERE_RADIUS * Math.sin(theta)
    const half = domeTaper(DOME_RING_HALF_WIDTH, theta)
    const depth = domeTaper(DOME_RING_DEPTH, theta)
    const gap = ringBayGap(theta)
    const bayArc = (TWO_PI / DOME_RIBS - 2 * gap) * ringRadius
    // Three stations inside each haunch, then even sub-stations across the
    // clear span — so the flare is a shaped haunch, not a one-segment step.
    const haunch = Math.min(0.34, Math.min(RING_HAUNCH_ARC, bayArc * 0.3) / bayArc)
    const spans = Math.max(2, Math.ceil(((1 - 2 * haunch) * bayArc) / RING_SEGMENT_ARC))
    const fractions: number[] = [0, haunch * 0.35, haunch]
    for (let k = 1; k < spans; k++) fractions.push(haunch + ((1 - 2 * haunch) * k) / spans)
    fractions.push(1 - haunch, 1 - haunch * 0.35, 1)

    for (let i = 0; i < DOME_RIBS; i++) {
      const phi0 = (i / DOME_RIBS) * TWO_PI + gap
      const phi1 = ((i + 1) / DOME_RIBS) * TWO_PI - gap
      const stations: Station[] = fractions.map((t) => {
        const toNode = Math.min(t, 1 - t) / haunch
        const flare = Math.max(0, 1 - toNode)
        return {
          p: shellPoint(theta, phi0 + (phi1 - phi0) * t),
          half: half * (1 + RING_HAUNCH_GAIN * flare * flare),
          depth,
        }
      })
      emitMember(writer, stations, {
        slot: 'shell',
        edgeSlot: 'shellEdge',
        section: flangedSection,
        chamfer: 0.04,
        capStart: true,
        capEnd: true,
      })
    }
  }
}

/**
 * The cast node collar: a short section swept ALONG the rib that encloses the
 * rib's whole cross-section (proud on all four faces, so no face is shared)
 * and gives the two haunched ring ends something to butt into.
 */
function buildNodeCollars(writer: PartWriter): void {
  for (let j = DOME_RING_FIRST; j <= DOME_RING_LAST; j++) {
    const theta = j * DOME_RING_STEP
    // Long enough in θ to swallow the haunched ring end plus a 0.26 m margin.
    const halfLength =
      (domeTaper(DOME_RING_HALF_WIDTH, theta) * (1 + RING_HAUNCH_GAIN) + 0.26) /
      DOME_SPHERE_RADIUS
    const half = domeTaper(DOME_RIB_HALF_WIDTH, theta) + COLLAR_SIDE_PROUD
    const depth = domeTaper(DOME_RIB_DEPTH, theta) + DOME_COLLAR_PROUD
    for (let i = 0; i < DOME_RIBS; i++) {
      const phi = (i / DOME_RIBS) * TWO_PI
      emitMember(
        writer,
        [
          { p: shellPoint(theta - halfLength, phi), half, depth },
          { p: shellPoint(theta + halfLength, phi), half, depth },
        ],
        {
          slot: 'node',
          inset: DOME_MEMBER_INSET - 0.05,
          chamfer: 0.055,
          capStart: true,
          capEnd: true,
        },
      )
    }
  }
}

function buildOculus(writer: PartWriter): void {
  // Compression ring: one continuous fabricated ring, the deepest member and
  // the structural climax — every rib dies into it.
  const ringStations: Station[] = []
  const ringSegments = 96
  for (let i = 0; i < ringSegments; i++) {
    ringStations.push({
      p: shellPoint(DOME_OCULUS_THETA, (i / ringSegments) * TWO_PI),
      half: DOME_OCULUS_HALF_WIDTH,
      depth: DOME_OCULUS_DEPTH,
    })
  }
  sweepSection(writer, ringStations, {
    slot: 'shell',
    edgeSlot: 'shellEdge',
    section: flangedSection,
    inset: 0.02,
    chamfer: 0.07,
    closed: true,
  })

  // Hub spokes: the oculus glazing's own radial mullions.
  const spokeOuter = DOME_OCULUS_THETA - (DOME_OCULUS_HALF_WIDTH + JOINT_REVEAL) / DOME_SPHERE_RADIUS
  const spokeInner = Math.asin((DOME_HUB_RADIUS + 0.02) / DOME_SPHERE_RADIUS)
  for (let i = 0; i < DOME_HUB_SPOKES; i++) {
    const phi = (i / DOME_HUB_SPOKES) * TWO_PI
    const stations: Station[] = []
    for (let k = 0; k <= 3; k++) {
      stations.push({
        p: shellPoint(spokeInner + ((spokeOuter - spokeInner) * k) / 3, phi),
        half: DOME_HUB_BAR_HALF_WIDTH,
        depth: DOME_HUB_BAR_DEPTH,
      })
    }
    sweepSection(writer, stations, {
      slot: 'shell',
      edgeSlot: 'shellEdge',
      chamfer: 0.025,
      capStart: true,
      capEnd: true,
    })
  }

  // Hub cap: the pressure plate the spokes land on (disc + lathed rim).
  const poleY = DOME_CENTER_Y + DOME_SPHERE_RADIUS
  writer.disc(new Vector3(0, poleY + 0.46, 0), DOME_HUB_RADIUS - 0.07, 'shell', { segments: 64 })
  writer.lathe({
    center: new Vector3(0, poleY, 0),
    profile: [
      new Vector2(DOME_HUB_RADIUS - 0.07, 0.46),
      new Vector2(DOME_HUB_RADIUS, 0.34),
      new Vector2(DOME_HUB_RADIUS, -0.05),
      new Vector2(DOME_HUB_RADIUS - 0.11, -0.16),
    ],
    slot: 'shell',
    segments: 64,
  })
  writer.disc(new Vector3(0, poleY - 0.16, 0), DOME_HUB_RADIUS - 0.11, 'shell', {
    segments: 64,
    down: true,
  })

  // Maintenance handrail: the crown platform's edge protection, mounted on
  // every rib so its posts have something to bolt to.
  const railTheta = DOME_OCULUS_THETA + (DOME_OCULUS_HALF_WIDTH + 1.1) / DOME_SPHERE_RADIUS
  for (let i = 0; i < DOME_RIBS; i++) {
    const phi = (i / DOME_RIBS) * TWO_PI
    writer.tube({
      path: [shellPoint(railTheta, phi, 0.34), shellPoint(railTheta, phi, 1.56)],
      radius: 0.042,
      slot: 'hardware',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
  for (const lift of [1.5, 0.98]) {
    const path: Vector3[] = []
    for (let i = 0; i <= 96; i++) path.push(shellPoint(railTheta, (i / 96) * TWO_PI, lift))
    writer.tube({ path, radius: 0.05, slot: 'hardware', radialSegments: 8 })
  }
}

/**
 * Surface of revolution about Y whose PROFILE may vary with longitude. The
 * plinth needs this: a plain ring would wall straight across the connector
 * tube's bore, so the footing dips below the tube instead — one continuous
 * casting, no arc caps, no hole to patch.
 */
function revolveVarying(
  writer: PartWriter,
  slot: DomeSlot,
  segments: number,
  profileAt: (phi: number) => Vector2[],
): void {
  const rings: Vector3[][] = []
  for (let s = 0; s <= segments; s++) {
    const phi = (s / segments) * TWO_PI
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    rings.push(profileAt(phi).map((p) => new Vector3(cos * p.x, p.y, sin * p.x)))
  }
  const points = rings[0].length
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < points - 1; i++) {
      writer.quad(slot, rings[s][i], rings[s][i + 1], rings[s + 1][i + 1], rings[s + 1][i])
    }
  }
}

/** 1 across the portal bore, 0 elsewhere — how far the footing has to dip. */
function portalDip(phi: number): number {
  const delta = Math.abs(
    ((((phi - Math.PI / 2 + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI,
  )
  const halfAngle = Math.asin(Math.min(1, (PORTAL_CLEAR + 0.6) / PLINTH_INNER_RADIUS))
  const t = Math.min(1, Math.max(0, (delta - halfAngle) / 0.04))
  return 1 - t * t * (3 - 2 * t)
}

function buildFooting(writer: PartWriter): void {
  // Cast-stone plinth ring: a real section with a recessed reveal band and a
  // chamfered top arris, deep enough to stay grounded through ±0.8 m of rim
  // regolith relief, dipping clear under the connector tube.
  revolveVarying(writer, 'stone', 384, (phi) => {
    const top = PLINTH_TOP_Y - 2.7 * portalDip(phi)
    return [
      new Vector2(PLINTH_OUTER_RADIUS, PLINTH_BOTTOM_Y),
      new Vector2(PLINTH_OUTER_RADIUS, top - 0.73),
      new Vector2(PLINTH_OUTER_RADIUS - 0.12, top - 0.61),
      new Vector2(PLINTH_OUTER_RADIUS - 0.12, top - 0.35),
      new Vector2(PLINTH_OUTER_RADIUS, top - 0.23),
      new Vector2(PLINTH_OUTER_RADIUS, top - 0.12),
      new Vector2(PLINTH_OUTER_RADIUS - 0.12, top),
      new Vector2(PLINTH_INNER_RADIUS + 0.12, top),
      new Vector2(PLINTH_INNER_RADIUS, top - 0.12),
      new Vector2(PLINTH_INNER_RADIUS, PLINTH_BOTTOM_Y),
      new Vector2(PLINTH_OUTER_RADIUS, PLINTH_BOTTOM_Y),
    ]
  })

  // Glazing boot: the gasketed upstand that seals the shell foot to the
  // plinth. Set 20 mm into the plinth top so no two faces are ever flush.
  revolveVarying(writer, 'hardware', 384, (phi) => {
    const top = PLINTH_TOP_Y - 3.3 * portalDip(phi)
    return [
      new Vector2(130.28, top - 0.02),
      new Vector2(130.28, top + 0.37),
      new Vector2(130.16, top + 0.47),
      new Vector2(129.84, top + 0.47),
      new Vector2(129.72, top + 0.37),
      new Vector2(129.72, top - 0.02),
    ]
  })

  // Per-rib base shoe: the cast anchor the rib springs from, wrapping it
  // clear of every face, with four anchor studs on its outer flange.
  const shoeBottom = thetaAtHeight(-0.66)
  const shoeTop = thetaAtHeight(2.6)
  for (let i = 0; i < DOME_RIBS; i++) {
    const phi = (i / DOME_RIBS) * TWO_PI
    const half = domeTaper(DOME_RIB_HALF_WIDTH, DOME_THETA_BASE) + 0.24
    const depth = domeTaper(DOME_RIB_DEPTH, DOME_THETA_BASE) + 0.26
    emitMember(
      writer,
      [
        { p: shellPoint(shoeBottom, phi), half, depth },
        { p: shellPoint(shoeTop, phi), half: half - 0.06, depth: depth - 0.09 },
      ],
      { slot: 'node', inset: 0.015, chamfer: 0.06, capStart: true, capEnd: true },
    )
    const studTheta = thetaAtHeight(1.9)
    if (boreDistance(shellPoint(studTheta, phi)) < PORTAL_CLEAR + 1) continue
    for (const side of [-1, 1]) {
      for (const along of [-0.42, 0.42]) {
        const base = shellPoint(studTheta + along / DOME_SPHERE_RADIUS, phi)
        const u = base.clone().sub(CENTER).normalize()
        const tangent = shellPoint(studTheta + 0.002, phi).sub(base).normalize()
        const s = new Vector3().crossVectors(u, tangent).normalize()
        const seat = base
          .clone()
          .addScaledVector(s, side * (half - 0.14))
          .addScaledVector(u, 0.015 + depth - 0.12)
        writer.tube({
          path: [seat, seat.clone().addScaledVector(u, 0.16)],
          radius: 0.05,
          slot: 'hardware',
          radialSegments: 8,
          capEnd: true,
        })
      }
    }
  }
}

/**
 * The trimmed opening's reinforcing ring: a deep frame following the shell
 * around the tube bore, picking up the cut rib and the cut ring beam. Its
 * inner edge lands exactly on the glass aperture, so it dresses the cut pane
 * edge as well as carrying the load.
 */
function buildPortalFrame(writer: PartWriter): void {
  const stations: Station[] = []
  const segments = 80
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * TWO_PI
    const x = Math.cos(angle) * PORTAL_FRAME_CENTER
    const y = PORTAL_AXIS_Y + Math.sin(angle) * PORTAL_FRAME_CENTER
    const dy = y - DOME_CENTER_Y
    const z = Math.sqrt(Math.max(1, DOME_SPHERE_RADIUS ** 2 - x * x - dy * dy))
    stations.push({ p: new Vector3(x, y, z), half: PORTAL_FRAME_HALF, depth: 1.15 })
  }
  sweepSection(writer, stations, {
    slot: 'node',
    edgeSlot: 'shellEdge',
    inset: 0.02,
    chamfer: 0.05,
    closed: true,
  })
}

/**
 * Crane rails the Panewalker rides, on ring beams 4 and 8.
 *
 * The rail runs in φ, so it crosses every rib and every node collar — both
 * deeper than the ring beam it follows. It therefore flies ABOVE the node
 * line (domeCraneRailLift) on a sole plate at each node and on stools every
 * ~3.5 m between them, rather than being buried in 24 ribs.
 */
function buildCraneRails(writer: PartWriter): void {
  for (const ring of PANEWALKER_RAIL_RINGS) {
    const theta = ring * DOME_RING_STEP
    const ringRadius = DOME_SPHERE_RADIUS * Math.sin(theta)
    const lift = domeCraneRailLift(theta)
    const railSoffit = lift - DOME_RAIL_RADIUS
    const path: Vector3[] = []
    for (let i = 0; i <= 256; i++) path.push(shellPoint(theta, (i / 256) * TWO_PI, lift))
    writer.tube({ path, radius: DOME_RAIL_RADIUS, slot: 'rail', radialSegments: 10 })

    // Sole plate on each node collar: sunk 30 mm into the casting so no two
    // faces are ever flush, lapped 20 mm into the rail.
    const collarTop =
      DOME_MEMBER_INSET - 0.05 + domeTaper(DOME_RIB_DEPTH, theta) + DOME_COLLAR_PROUD
    const plateHalfPhi = 0.34 / ringRadius
    // Stools between the nodes, standing on the ring beam's outer face.
    const ringTop = DOME_MEMBER_INSET + domeTaper(DOME_RING_DEPTH, theta)
    const gap = ringBayGap(theta)
    const bayArc = (TWO_PI / DOME_RIBS - 2 * gap) * ringRadius
    const stools = Math.max(1, Math.round(bayArc / 3.5) - 1)
    const stoolHalfPhi = 0.12 / ringRadius

    for (let i = 0; i < DOME_RIBS; i++) {
      const phi = (i / DOME_RIBS) * TWO_PI
      emitMember(
        writer,
        [
          { p: shellPoint(theta, phi - plateHalfPhi), half: 0.26, depth: railSoffit - collarTop + 0.05 },
          { p: shellPoint(theta, phi + plateHalfPhi), half: 0.26, depth: railSoffit - collarTop + 0.05 },
        ],
        {
          slot: 'node',
          inset: collarTop - 0.03,
          chamfer: 0.02,
          capStart: true,
          capEnd: true,
        },
      )
      for (let k = 1; k <= stools; k++) {
        const t = k / (stools + 1)
        const stoolPhi = phi + gap + (TWO_PI / DOME_RIBS - 2 * gap) * t
        emitMember(
          writer,
          [
            {
              p: shellPoint(theta, stoolPhi - stoolHalfPhi),
              half: 0.1,
              depth: railSoffit - ringTop + 0.05,
            },
            {
              p: shellPoint(theta, stoolPhi + stoolHalfPhi),
              half: 0.1,
              depth: railSoffit - ringTop + 0.05,
            },
          ],
          {
            slot: 'hardware',
            inset: ringTop - 0.03,
            chamfer: 0.018,
            capStart: true,
            capEnd: true,
          },
        )
      }
    }
  }
}

export function buildDomeStructure(materials: Record<DomeSlot, Material>): Group {
  const writer = new PartWriter()
  buildRibs(writer)
  buildRingBeams(writer)
  buildNodeCollars(writer)
  buildOculus(writer)
  buildPortalFrame(writer)
  buildFooting(writer)
  buildCraneRails(writer)

  const group = new Group()
  group.name = 'dome:gridshell'
  // The analytic lattice field owns every dome shadow; a shadow map of the
  // same members would double-darken the whole park.
  group.add(writer.build(materials, { castShadow: false }))
  return group
}
