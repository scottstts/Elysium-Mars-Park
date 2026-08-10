import { Group, Vector2, Vector3 } from 'three'
import type { Material } from 'three'
import { PartWriter } from '../archkit/writer'
import type { DomeSlot } from './domeMaterials'
import {
  DOME_BAR_DEPTH,
  DOME_BAR_HALF_WIDTH,
  DOME_BAR_TIERS,
  DOME_CENTER_Y,
  DOME_HUB_BAR_HALF_WIDTH,
  DOME_HUB_RADIUS,
  DOME_HUB_SPOKES,
  DOME_MEMBER_INSET,
  DOME_OCULUS_DEPTH,
  DOME_OCULUS_HALF_WIDTH,
  DOME_OCULUS_RING,
  DOME_OCULUS_THETA,
  DOME_RIBS,
  DOME_RIB_DEPTH,
  DOME_RIB_HALF_WIDTH,
  DOME_RINGS,
  DOME_RING_DEPTH,
  DOME_RING_HALF_WIDTH,
  DOME_RING_STEP,
  DOME_SPHERE_RADIUS,
  DOME_THETA_BASE,
  PANEWALKER_RAIL_RINGS,
  domeTaper,
} from './latticeField'

/**
 * The BUILT gridshell of Dome One — every line the analytic field in
 * latticeField.ts describes is real geometry here, at the same θ/φ:
 *
 *   ribs      48 continuous lofted box sections, foundation → oculus,
 *             tapering 0.32×0.95 m at the springing to 0.17×0.34 m at the
 *             crown (always deeper than wide — they work in bending).
 *   rings     33 parallels of segmented ring beams, one segment per rib bay,
 *             shallower than the ribs and flush with them on the inner face
 *             so the soffit reads as ONE surface.
 *   bars      glazing mullions subdividing each bay into 2.1–4.3 m panes,
 *             dropping out in halves at ring 16 and ring 8 as the bay narrows.
 *   nodes     a cast collar wraps the rib at every rib×ring crossing and the
 *             ring segments butt into it with a 15 mm reveal — no member ever
 *             clips through another, and no two faces share a plane.
 *   oculus    compression ring + hub spokes + hub cap + maintenance handrail.
 *   footing   cast-stone plinth ring, per-rib base shoes with anchor studs,
 *             and the glazing boot that seals the shell foot.
 *   rails     crane rails on ring beams 12 and 24 for the Panewalker.
 *
 * Members cast NO shadow maps: the analytic net owns all dome shadowing, so
 * the two systems can never double-darken.
 *
 * MEMBER HIERARCHY (the rule that keeps the assembly clean): ribs are
 * continuous, rings stop at rib collars, bars stop at rings. Radially every
 * member's inner face sits DOME_MEMBER_INSET proud of the glass; only the
 * depth differs, so nothing intersects and nothing is coplanar.
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
const COLLAR_SIDE_PROUD = 0.13
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
  capStart?: boolean
  capEnd?: boolean
  closed?: boolean
}

/**
 * Sweep a chamfered rectangular section along a station list.
 *
 * The section is authored once as an 8-point profile in the (lateral, radial)
 * plane of each station — chamfers ARE profile points, not a post-process, so
 * a bend never opens a corner. The four chamfer bands route to `edgeSlot`
 * (worn edge paint on real arrises). Frames are (s, u, t) with s = u × t,
 * which makes the profile counter-clockwise seen along the sweep, so every
 * emitted quad faces outward without a winding special case.
 */
function sweepSection(writer: PartWriter, stations: Station[], options: SweepOptions): void {
  const count = stations.length
  if (count < 2) return
  const inset = options.inset ?? DOME_MEMBER_INSET
  const slot = options.slot
  const edgeSlot = options.edgeSlot ?? options.slot
  const closed = options.closed ?? false
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

    const h = station.half
    const d = station.depth
    const c = Math.min(options.chamfer ?? 0.03, h * 0.45, d * 0.4)
    const profile: Array<[number, number]> = [
      [-h + c, 0],
      [h - c, 0],
      [h, c],
      [h, d - c],
      [h - c, d],
      [-h + c, d],
      [-h, d - c],
      [-h, c],
    ]
    rings.push(
      profile.map(([x, y]) =>
        station.p.clone().addScaledVector(s, x).addScaledVector(u, inset + y),
      ),
    )
  }

  const segments = closed ? count : count - 1
  for (let i = 0; i < segments; i++) {
    const a = rings[i]
    const b = rings[(i + 1) % count]
    for (let e = 0; e < 8; e++) {
      const e2 = (e + 1) % 8
      // Profile edges 1/3/5/7 are the chamfer bands.
      writer.quad(e % 2 === 1 ? edgeSlot : slot, a[e], a[e2], b[e2], b[e])
    }
  }

  if (!closed && options.capStart) capSection(writer, slot, rings[0], true)
  if (!closed && options.capEnd) capSection(writer, slot, rings[count - 1], false)
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
 * the three ring beams that cross it end ON the portal frame instead of
 * flying through the tram tube.
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

/** Close a swept section with a fan; `flip` for the start (−tangent) face. */
function capSection(writer: PartWriter, slot: DomeSlot, ring: Vector3[], flip: boolean): void {
  const center = new Vector3()
  for (const p of ring) center.add(p)
  center.multiplyScalar(1 / ring.length)
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    if (flip) writer.tri(slot, center, ring[j], ring[i])
    else writer.tri(slot, center, ring[i], ring[j])
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
    for (let j = DOME_RINGS; j > DOME_OCULUS_RING; j--) {
      stations.push(ribStation(j * DOME_RING_STEP, phi))
    }
    stations.push(ribStation(RIB_TOP_THETA, phi))
    emitMember(writer, stations, {
      slot: 'shell',
      edgeSlot: 'shellEdge',
      chamfer: 0.035,
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

function buildRingBeams(writer: PartWriter): void {
  const finestTier = DOME_BAR_TIERS[DOME_BAR_TIERS.length - 1][0]
  for (let j = DOME_OCULUS_RING + 1; j < DOME_RINGS; j++) {
    const theta = j * DOME_RING_STEP
    const half = domeTaper(DOME_RING_HALF_WIDTH, theta)
    const depth = domeTaper(DOME_RING_DEPTH, theta)
    const gap = ringBayGap(theta)
    // Sub-stations keep the arc honest: 4.25 m chords sag 17 mm on a 130 m
    // ring, which is below a pixel from anywhere in the park.
    const subdivisions = j >= finestTier ? 4 : 2
    for (let i = 0; i < DOME_RIBS; i++) {
      const phi0 = (i / DOME_RIBS) * TWO_PI + gap
      const phi1 = ((i + 1) / DOME_RIBS) * TWO_PI - gap
      const stations: Station[] = []
      for (let k = 0; k <= subdivisions; k++) {
        stations.push({
          p: shellPoint(theta, phi0 + (phi1 - phi0) * (k / subdivisions)),
          half,
          depth,
        })
      }
      emitMember(writer, stations, {
        slot: 'shell',
        edgeSlot: 'shellEdge',
        chamfer: 0.028,
        capStart: true,
        capEnd: true,
      })
    }
  }
}

/**
 * Glazing bars. Every tier count is a multiple of DOME_RIBS and of the tier
 * below it, so a bar line always lands on the previous family's line and a
 * "drop" is simply half the bars stopping at a ring beam.
 */
function buildGlazingBars(writer: PartWriter): void {
  const tiers = DOME_BAR_TIERS
  for (let tier = 0; tier < tiers.length; tier++) {
    const [startRing, count] = tiers[tier]
    const coarser = tier === 0 ? DOME_RIBS : tiers[tier - 1][1]
    const stride = count / coarser
    for (let line = 0; line < count; line++) {
      if (line % stride === 0) continue // already carried by a coarser family
      const phi = (line / count) * TWO_PI
      for (let j = startRing; j < DOME_RINGS; j++) {
        const thetaA = j * DOME_RING_STEP
        const thetaB = (j + 1) * DOME_RING_STEP
        const clearA = (domeTaper(DOME_RING_HALF_WIDTH, thetaA) + JOINT_REVEAL) / DOME_SPHERE_RADIUS
        // The outermost interval dies in the plinth; there is no ring 36 beam.
        const clearB =
          j + 1 >= DOME_RINGS
            ? -0.9 / DOME_SPHERE_RADIUS
            : (domeTaper(DOME_RING_HALF_WIDTH, thetaB) + JOINT_REVEAL) / DOME_SPHERE_RADIUS
        const stations: Station[] = [
          { p: shellPoint(thetaA + clearA, phi), half: DOME_BAR_HALF_WIDTH, depth: DOME_BAR_DEPTH },
          { p: shellPoint(thetaB - clearB, phi), half: DOME_BAR_HALF_WIDTH, depth: DOME_BAR_DEPTH },
        ]
        emitMember(writer, stations, {
          slot: 'shell',
          edgeSlot: 'shellEdge',
          chamfer: 0.016,
          capStart: true,
          capEnd: true,
        })
      }
    }
  }
}

/**
 * The cast node collar: a short section swept ALONG the rib that encloses the
 * rib's whole cross-section (proud on all four faces, so no face is shared)
 * and gives the two ring segments something to butt into.
 */
function buildNodeCollars(writer: PartWriter): void {
  for (let j = DOME_OCULUS_RING + 1; j < DOME_RINGS; j++) {
    const theta = j * DOME_RING_STEP
    const halfLength = (domeTaper(DOME_RING_HALF_WIDTH, theta) + 0.16) / DOME_SPHERE_RADIUS
    const half = domeTaper(DOME_RIB_HALF_WIDTH, theta) + COLLAR_SIDE_PROUD
    const depth = domeTaper(DOME_RIB_DEPTH, theta) + 0.17
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
          chamfer: 0.045,
          capStart: true,
          capEnd: true,
        },
      )
    }
  }
}

function buildOculus(writer: PartWriter): void {
  // Compression ring: one continuous fabricated ring, the deepest member.
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
    inset: 0.02,
    chamfer: 0.06,
    closed: true,
  })

  // Hub spokes: the oculus glazing's own radial mullions.
  const spokeOuter = DOME_OCULUS_THETA - (DOME_OCULUS_HALF_WIDTH + JOINT_REVEAL) / DOME_SPHERE_RADIUS
  const spokeInner = Math.asin((DOME_HUB_RADIUS + 0.02) / DOME_SPHERE_RADIUS)
  for (let i = 0; i < DOME_HUB_SPOKES; i++) {
    const phi = (i / DOME_HUB_SPOKES) * TWO_PI
    sweepSection(
      writer,
      [
        { p: shellPoint(spokeInner, phi), half: DOME_HUB_BAR_HALF_WIDTH, depth: 0.22 },
        { p: shellPoint(spokeOuter, phi), half: DOME_HUB_BAR_HALF_WIDTH, depth: 0.22 },
      ],
      { slot: 'shell', edgeSlot: 'shellEdge', chamfer: 0.02, capStart: true, capEnd: true },
    )
  }

  // Hub cap: the small pressure plate the spokes land on (disc + lathed rim).
  const poleY = DOME_CENTER_Y + DOME_SPHERE_RADIUS
  writer.disc(new Vector3(0, poleY + 0.34, 0), DOME_HUB_RADIUS - 0.05, 'shell', { segments: 48 })
  writer.lathe({
    center: new Vector3(0, poleY, 0),
    profile: [
      new Vector2(DOME_HUB_RADIUS - 0.05, 0.34),
      new Vector2(DOME_HUB_RADIUS, 0.26),
      new Vector2(DOME_HUB_RADIUS, -0.04),
      new Vector2(DOME_HUB_RADIUS - 0.08, -0.12),
    ],
    slot: 'shell',
    segments: 48,
  })
  writer.disc(new Vector3(0, poleY - 0.12, 0), DOME_HUB_RADIUS - 0.08, 'shell', {
    segments: 48,
    down: true,
  })

  // Maintenance handrail: the crown platform's edge protection, mounted on
  // every second rib so its posts have something to bolt to.
  const railTheta = DOME_OCULUS_THETA + 1.6 / DOME_SPHERE_RADIUS
  for (let i = 0; i < DOME_RIBS; i += 2) {
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
    for (let i = 0; i <= 72; i++) path.push(shellPoint(railTheta, (i / 72) * TWO_PI, lift))
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
    const half = domeTaper(DOME_RIB_HALF_WIDTH, DOME_THETA_BASE) + 0.22
    const depth = domeTaper(DOME_RIB_DEPTH, DOME_THETA_BASE) + 0.26
    emitMember(
      writer,
      [
        { p: shellPoint(shoeBottom, phi), half, depth },
        { p: shellPoint(shoeTop, phi), half: half - 0.05, depth: depth - 0.06 },
      ],
      { slot: 'node', inset: 0.015, chamfer: 0.05, capStart: true, capEnd: true },
    )
    const studTheta = thetaAtHeight(1.9)
    if (boreDistance(shellPoint(studTheta, phi)) < PORTAL_CLEAR + 1) continue
    for (const side of [-1, 1]) {
      for (const along of [-0.32, 0.32]) {
        const base = shellPoint(studTheta + along / DOME_SPHERE_RADIUS, phi)
        const u = base.clone().sub(CENTER).normalize()
        const tangent = shellPoint(studTheta + 0.002, phi).sub(base).normalize()
        const s = new Vector3().crossVectors(u, tangent).normalize()
        const seat = base
          .clone()
          .addScaledVector(s, side * (half - 0.12))
          .addScaledVector(u, 0.015 + depth - 0.1)
        writer.tube({
          path: [seat, seat.clone().addScaledVector(u, 0.14)],
          radius: 0.045,
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
 * around the tube bore, picking up the cut rib and the three cut ring beams.
 * Its inner edge lands exactly on the glass aperture, so it dresses the cut
 * pane edge as well as carrying the load.
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
    stations.push({ p: new Vector3(x, y, z), half: PORTAL_FRAME_HALF, depth: 0.9 })
  }
  sweepSection(writer, stations, {
    slot: 'node',
    edgeSlot: 'shellEdge',
    inset: 0.02,
    chamfer: 0.05,
    closed: true,
  })
}

/** Crane rails the Panewalker rides, laid on ring beams 12 and 24. */
function buildCraneRails(writer: PartWriter): void {
  for (const ring of PANEWALKER_RAIL_RINGS) {
    const theta = ring * DOME_RING_STEP
    const lift = DOME_MEMBER_INSET + domeTaper(DOME_RING_DEPTH, theta) + 0.095
    const path: Vector3[] = []
    for (let i = 0; i <= 192; i++) path.push(shellPoint(theta, (i / 192) * TWO_PI, lift))
    writer.tube({ path, radius: 0.08, slot: 'rail', radialSegments: 10 })
  }
}

export function buildDomeStructure(materials: Record<DomeSlot, Material>): Group {
  const writer = new PartWriter()
  buildRibs(writer)
  buildRingBeams(writer)
  buildGlazingBars(writer)
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
