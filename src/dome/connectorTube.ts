import { Group, Vector3 } from 'three'
import type { Material } from 'three'
import { PartWriter } from '../archkit/writer'
import { exteriorHeight } from '../exterior/terrainHeight'
import { buildTrackData } from '../tram/track'
import type { DomeSlot } from './domeMaterials'
import { PORTAL_AXIS_Y, PORTAL_BORE } from './domeGeometry'
import { DOME_CENTER_Y, DOME_SPHERE_RADIUS } from './latticeField'

/**
 * The arrival portal and the connector tube's EXTERIOR skin.
 *
 * The tram system owns what is inside the tube (the lining, the guideway, the
 * iris petals); this file owns the pressure envelope you see from outside and
 * the bulkhead assembly the iris runs in.
 *
 * Portal assembly at z = 128.4 (parkPlan.PORTAL_WALL_Z), on the tube axis
 * (0, 4.6) that the tram's iris petals are already built around:
 *
 *   inboard plate  z 127.10 → 128.10, bore 5.90 → 9.70
 *   petal slot     z 128.10 → 128.70   (petals are 0.22 thick, ±0.19 clear)
 *   outboard plate z 128.70 → 129.84
 *   outer drum     one continuous casting closing the housing at r 9.70
 *
 * All of it is ONE closed profile revolved about Z, so the housing has no
 * seams and no coincident faces; the bolt ring and hazard band are applied
 * parts set 40 mm into the face they sit on.
 */

const PORTAL_Z = 128.4
const COLLAR_BORE = 5.9
const COLLAR_OUTER = 9.7
const COLLAR_INBOARD_Z = 127.1
const COLLAR_OUTBOARD_Z = 129.84
const SLOT_FRONT_Z = 128.1
const SLOT_BACK_Z = 128.7
const SLOT_OUTER = 9.2

const TUBE_END_Z = 430
const TUBE_START_Z = COLLAR_OUTBOARD_Z + 0.06
/** Portal snout: flared where it meets the bulkhead, slim out in the valley. */
const TUBE_RADIUS_PORTAL = 7.2
const TUBE_RADIUS_RUN = 6.05
/** Structural rings at 12 m, matching the tram lining's interior rings. */
const TUBE_RIB_SPACING = 12
const TUBE_RIB_FIRST_Z = 142

function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Triangle soup carrying its OWN per-vertex normals into `PartWriter.raw`.
 *
 * `writer.quad` computes one flat normal per quad, which is right for a
 * machined plate and wrong for every barrel in this file: a 9.7 m drum on 72
 * segments facets into 0.85 m plates, and a warped skirt quad facets along its
 * own diagonal. Everything curved here is emitted through this instead.
 */
class SmoothSoup {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []

  tri(
    points: [Vector3, Vector3, Vector3],
    normals: [Vector3, Vector3, Vector3],
    uvs: [[number, number], [number, number], [number, number]],
  ): void {
    for (let i = 0; i < 3; i++) {
      this.positions.push(points[i].x, points[i].y, points[i].z)
      this.normals.push(normals[i].x, normals[i].y, normals[i].z)
      this.uvs.push(uvs[i][0], uvs[i][1])
    }
  }

  emit(writer: PartWriter, slot: DomeSlot): void {
    if (this.positions.length > 0) writer.raw(slot, this.positions, this.normals, this.uvs)
  }
}

/**
 * Surface of revolution about the Z axis for an (r, z) profile — the Z-axis
 * twin of a lathe, which the portal bulkhead needs and three's lathe cannot
 * give.
 *
 * CONVENTION: the profile runs **clockwise** in the (r, z) plane (r right, z
 * up), so the solid's outward normal is the LEFT normal of the travel
 * direction, `(−dz, dr)`. Authoring one counter-clockwise ships the whole
 * casting inside-out — which is exactly what the collar did until this pass
 * (the bulkhead drum was a culled backface and the flange faced away from the
 * park). Winding and normal are derived from that one rule below, so the two
 * can no longer disagree.
 *
 * Normals are ANALYTIC, not per-quad: smooth around the circumference (a 9.7 m
 * drum on 72 segments has 0.85 m facets, and flat-shading them is what made
 * the portal read as a faceted cone), sharp across every profile crease
 * because each segment emits its own vertices.
 */
function revolveZ(
  writer: PartWriter,
  slot: DomeSlot,
  centerX: number,
  centerY: number,
  profile: Array<[number, number]>,
  segments: number,
): void {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const push = (angle: number, r: number, z: number, nr: number, nz: number, u: number, v: number): void => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    positions.push(centerX + cos * r, centerY + sin * r, z)
    normals.push(cos * nr, sin * nr, nz)
    uvs.push(u, v)
  }
  let run = 0
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, z0] = profile[i]
    const [r1, z1] = profile[i + 1]
    const dr = r1 - r0
    const dz = z1 - z0
    const length = Math.hypot(dr, dz)
    if (length < 1e-9) continue
    // Left normal of the travel direction — outward for a clockwise profile.
    const nr = -dz / length
    const nz = dr / length
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2
      const a1 = ((s + 1) / segments) * Math.PI * 2
      const u0 = (s / segments) * Math.PI * 2 * ((r0 + r1) / 2)
      const u1 = ((s + 1) / segments) * Math.PI * 2 * ((r0 + r1) / 2)
      // Two triangles, wound so the face is CCW seen from the normal side.
      push(a0, r0, z0, nr, nz, u0, run)
      push(a0, r1, z1, nr, nz, u0, run + length)
      push(a1, r1, z1, nr, nz, u1, run + length)
      push(a0, r0, z0, nr, nz, u0, run)
      push(a1, r1, z1, nr, nz, u1, run + length)
      push(a1, r0, z0, nr, nz, u1, run)
    }
    run += length
  }
  writer.raw(slot, positions, normals, uvs)
}

function buildPortalCollar(writer: PartWriter): void {
  // One closed section, CLOCKWISE in (r, z) per `revolveZ`: inboard face →
  // bore → petal slot → outboard face → outer drum → back to the inboard face.
  revolveZ(
    writer,
    'node',
    0,
    PORTAL_AXIS_Y,
    [
      [COLLAR_OUTER, COLLAR_INBOARD_Z + 0.14],
      [COLLAR_OUTER - 0.15, COLLAR_INBOARD_Z],
      [COLLAR_BORE + 0.15, COLLAR_INBOARD_Z],
      [COLLAR_BORE, COLLAR_INBOARD_Z + 0.14],
      [COLLAR_BORE, SLOT_FRONT_Z],
      [SLOT_OUTER, SLOT_FRONT_Z],
      [SLOT_OUTER, SLOT_BACK_Z],
      [COLLAR_BORE, SLOT_BACK_Z],
      [COLLAR_BORE, COLLAR_OUTBOARD_Z - 0.14],
      [COLLAR_BORE + 0.15, COLLAR_OUTBOARD_Z],
      [COLLAR_OUTER - 0.15, COLLAR_OUTBOARD_Z],
      [COLLAR_OUTER, COLLAR_OUTBOARD_Z - 0.14],
      [COLLAR_OUTER, COLLAR_INBOARD_Z + 0.14],
    ],
    96,
  )

  // Bolt ring on the outboard flange: 32 studs, seated 40 mm into the face.
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    const x = Math.cos(angle) * 8.95
    const y = PORTAL_AXIS_Y + Math.sin(angle) * 8.95
    writer.tube({
      path: [
        new Vector3(x, y, COLLAR_OUTBOARD_Z - 0.04),
        new Vector3(x, y, COLLAR_OUTBOARD_Z + 0.11),
      ],
      radius: 0.085,
      slot: 'hardware',
      radialSegments: 8,
      capEnd: true,
    })
  }

  // Hazard band round the bore mouth, proud of the flange.
  revolveZ(
    writer,
    'hazard',
    0,
    PORTAL_AXIS_Y,
    [
      [COLLAR_BORE + 0.22, COLLAR_OUTBOARD_Z - 0.04],
      [COLLAR_BORE + 0.22, COLLAR_OUTBOARD_Z + 0.07],
      [COLLAR_BORE + 0.95, COLLAR_OUTBOARD_Z + 0.07],
      [COLLAR_BORE + 0.95, COLLAR_OUTBOARD_Z - 0.04],
    ],
    96,
  )

  // Iris drive housings: four boxes riding the drum, one per petal pair.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    const x = Math.cos(angle) * (COLLAR_OUTER - 0.12)
    const y = PORTAL_AXIS_Y + Math.sin(angle) * (COLLAR_OUTER - 0.12)
    writer.box({
      center: new Vector3(x, y, PORTAL_Z),
      size: new Vector3(0.9, 0.9, 1.5),
      slot: 'hardware',
      chamfer: 0.05,
      rotationY: -angle,
    })
  }
}

/**
 * Portal skirt: the pressure envelope between the glass aperture and the
 * bulkhead. The aperture is an oblique cut through the sphere (its z runs from
 * 121 m at the crown of the hole to 131 m at its invert) while the bulkhead
 * flange is a PLANAR ring at z = 127.10, so this is a genuinely warped flare.
 *
 * Two rules make it read as one moulded piece rather than the faceted hood it
 * used to be:
 *
 *  - **The outer rim is the flange, unconditionally.** It used to be
 *    `min(collarFace, apertureZ − 0.4)`, which over the whole upper half of
 *    the ring put the rim 0.4 m INBOARD of the glass instead of 6 m outboard
 *    on the bulkhead — a cowl leaning back into the park, folded along the
 *    latitude where the two branches of that `min` swap over. That fold is
 *    what showed as hard triangular faces, and it drove the rim through the
 *    glass shell and the portal ring frame as well.
 *  - **The meridian is a Hermite flare, and normals are per-vertex.** `e(t) =
 *    1 − (1 − t)²` leaves the aperture immediately (0.44 m of clearance off
 *    the glass at the springing, where a symmetric ease left only 50 mm) and
 *    lands tangent to the flange, so the skirt fillets into the casting
 *    instead of butting it at an angle.
 */
const SKIRT_RINGS = 12
const SKIRT_SEGMENTS = 72
const SKIRT_WALL = 0.07
/**
 * The rim ring is BURIED in the collar: 100 mm inside the drum and 0.80 m
 * outboard of the flange face, between it and the petal slot at 128.10.
 *
 * That one move is what removed the two seams the owner reported. A rim landing
 * ON the flange (r 9.70, z 127.10) has to approach that plane tangentially, and
 * every meridian's last half metre then lies within the sheet's own 55 mm wall
 * of the flange face — a near-coplanar ring all the way round. Worse, at the
 * two meridians where the glass aperture crosses z = 127.10 (10.5 deg below the
 * axis, left and right) the WHOLE meridian lies in that plane, which is the
 * pair of lens-shaped patches on the hood. A rim inside the casting is reached
 * by a meridian that PIERCES the flange face at 34…56 deg, so the sheet meets
 * it transversally and the rest of it is hidden inside solid metal.
 */
const SKIRT_RIM_R = 9.52
const SKIRT_RIM_Z = 127.9
/** How far in front of the flange face the hood's two ends must still stand. */
const SKIRT_CLEAR = 0.9

/** Sphere z of the glass aperture on this meridian. */
function apertureZ(cos: number, sin: number): number {
  const x = cos * PORTAL_BORE
  const dy = PORTAL_AXIS_Y + sin * PORTAL_BORE - DOME_CENTER_Y
  return Math.sqrt(Math.max(1, DOME_SPHERE_RADIUS * DOME_SPHERE_RADIUS - x * x - dy * dy))
}

/**
 * The flare's mid-surface: `t` 0 at the glass aperture, 1 at the buried rim.
 *
 * The meridian is a cubic Hermite with end slopes 3.0 and 1.5 — steep off the
 * glass so the hood clears it at once (a symmetric ease left 50 mm at the
 * springing), flatter through the middle, and still moving when it reaches the
 * casting so it cuts the flange face instead of grazing it.
 */
function skirtPoint(cos: number, sin: number, t: number): Vector3 {
  const r = PORTAL_BORE + (SKIRT_RIM_R - PORTAL_BORE) * t
  const az = apertureZ(cos, sin)
  const h = t * (2 + t * (-2 + t))
  return new Vector3(cos * r, PORTAL_AXIS_Y + sin * r, az + (SKIRT_RIM_Z - az) * h)
}

/** Meridian angle at which the aperture is `SKIRT_CLEAR` in front of the flange. */
function skirtBandEnd(): number {
  const target = COLLAR_INBOARD_Z - SKIRT_CLEAR
  let lo = -Math.PI / 2
  let hi = Math.PI / 2
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (apertureZ(Math.cos(mid), Math.sin(mid)) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function buildPortalSkirt(writer: PartWriter): void {
  // The hood is an ARC, not a ring: below `skirtBandEnd` the glass aperture is
  // level with, or outboard of, the bulkhead face, so there is nothing for a
  // transition piece to span — the glass runs straight into the casting and the
  // tube shell covers the rest. The old full ring buried its whole lower half
  // inside the collar, which is where the two bad seams lived.
  const a0 = skirtBandEnd()
  const a1 = Math.PI - a0

  const grid: Vector3[][] = []
  for (let i = 0; i <= SKIRT_RINGS; i++) {
    const t = i / SKIRT_RINGS
    const ring: Vector3[] = []
    for (let s = 0; s <= SKIRT_SEGMENTS; s++) {
      const angle = a0 + ((a1 - a0) * s) / SKIRT_SEGMENTS
      ring.push(skirtPoint(Math.cos(angle), Math.sin(angle), t))
    }
    grid.push(ring)
  }

  // Per-vertex normals by central differences over that grid — smooth in both
  // directions, which is the whole point of subdividing the meridian. The arc
  // is open now, so both ends take a one-sided difference.
  const last = SKIRT_SEGMENTS
  const normals: Vector3[][] = grid.map((ring, i) =>
    ring.map((p, s) => {
      const along = new Vector3().subVectors(
        grid[Math.min(SKIRT_RINGS, i + 1)][s],
        grid[Math.max(0, i - 1)][s],
      )
      const across = new Vector3().subVectors(ring[Math.min(last, s + 1)], ring[Math.max(0, s - 1)])
      void p
      // `across × along` faces the park — the side seen through the bore.
      return new Vector3().crossVectors(across, along).normalize()
    }),
  )

  const park: Vector3[][] = grid.map((ring, i) =>
    ring.map((p, s) => p.clone().addScaledVector(normals[i][s], SKIRT_WALL / 2)),
  )
  const valley: Vector3[][] = grid.map((ring, i) =>
    ring.map((p, s) => p.clone().addScaledVector(normals[i][s], -SKIRT_WALL / 2)),
  )

  const sheet = new SmoothSoup()
  const arc = (s: number): number => (s / SKIRT_SEGMENTS) * (a1 - a0) * COLLAR_OUTER
  const span = (i: number): number => (i / SKIRT_RINGS) * (SKIRT_RIM_R - PORTAL_BORE)
  const flip = (n: Vector3): Vector3 => n.clone().negate()
  for (let i = 0; i < SKIRT_RINGS; i++) {
    for (let s = 0; s < SKIRT_SEGMENTS; s++) {
      const s2 = s + 1
      // Wound so the face is CCW seen from `normals`, which points at the park.
      sheet.tri(
        [park[i][s], park[i + 1][s2], park[i + 1][s]],
        [normals[i][s], normals[i + 1][s2], normals[i + 1][s]],
        [[arc(s), span(i)], [arc(s + 1), span(i + 1)], [arc(s), span(i + 1)]],
      )
      sheet.tri(
        [park[i][s], park[i][s2], park[i + 1][s2]],
        [normals[i][s], normals[i][s2], normals[i + 1][s2]],
        [[arc(s), span(i)], [arc(s + 1), span(i)], [arc(s + 1), span(i + 1)]],
      )
      sheet.tri(
        [valley[i][s], valley[i + 1][s], valley[i + 1][s2]],
        [flip(normals[i][s]), flip(normals[i + 1][s]), flip(normals[i + 1][s2])],
        [[arc(s), span(i)], [arc(s), span(i + 1)], [arc(s + 1), span(i + 1)]],
      )
      sheet.tri(
        [valley[i][s], valley[i + 1][s2], valley[i][s2]],
        [flip(normals[i][s]), flip(normals[i + 1][s2]), flip(normals[i][s2])],
        [[arc(s), span(i)], [arc(s + 1), span(i + 1)], [arc(s + 1), span(i)]],
      )
    }
  }
  sheet.emit(writer, 'duct')

  // Rim band: the 110 mm sheet edge at the aperture, with its own edge normal
  // so the arris creases instead of smearing. The OUTER edge needs none — it
  // finishes inside the collar casting, where nothing can see it.
  const rim = (ringIndex: number, neighbour: number, slot: DomeSlot): void => {
    const band = new SmoothSoup()
    const edgeNormal = (s: number): Vector3 =>
      new Vector3().subVectors(grid[ringIndex][s], grid[neighbour][s]).normalize()
    // (park[s], park[s2], valley[s2], valley[s]) is CCW seen from the meridian's
    // FORWARD direction, so the aperture rim — whose edge normal points back
    // down the meridian — takes the reversed order.
    const forward = ringIndex > neighbour
    for (let s = 0; s < SKIRT_SEGMENTS; s++) {
      const s2 = s + 1
      const na = edgeNormal(s)
      const nb = edgeNormal(s2)
      const loop: Array<[Vector3, Vector3, [number, number]]> = [
        [park[ringIndex][s], na, [arc(s), 0]],
        [park[ringIndex][s2], nb, [arc(s + 1), 0]],
        [valley[ringIndex][s2], nb, [arc(s + 1), SKIRT_WALL]],
        [valley[ringIndex][s], na, [arc(s), SKIRT_WALL]],
      ]
      if (!forward) loop.reverse()
      for (const [a, b, c] of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        band.tri(
          [loop[a][0], loop[b][0], loop[c][0]],
          [loop[a][1], loop[b][1], loop[c][1]],
          [loop[a][2], loop[b][2], loop[c][2]],
        )
      }
    }
    band.emit(writer, slot)
  }
  rim(0, 1, 'duct')

  // Cheek plates closing the hood's two cut ends. Only the first ~0.7 m of each
  // edge is in open air — past that the meridian has already dived through the
  // flange face — but a sheet that simply stops reads as torn metal.
  const cheek = (s: number, neighbour: number): void => {
    const plate = new SmoothSoup()
    const edgeNormal = (i: number): Vector3 =>
      new Vector3().subVectors(grid[i][s], grid[i][neighbour]).normalize()
    const forward = s > neighbour
    for (let i = 0; i < SKIRT_RINGS; i++) {
      const na = edgeNormal(i)
      const nb = edgeNormal(i + 1)
      const loop: Array<[Vector3, Vector3, [number, number]]> = [
        [park[i][s], na, [span(i), 0]],
        [park[i + 1][s], nb, [span(i + 1), 0]],
        [valley[i + 1][s], nb, [span(i + 1), SKIRT_WALL]],
        [valley[i][s], na, [span(i), SKIRT_WALL]],
      ]
      if (!forward) loop.reverse()
      for (const [a, b, c] of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        plate.tri(
          [loop[a][0], loop[b][0], loop[c][0]],
          [loop[a][1], loop[b][1], loop[c][1]],
          [loop[a][2], loop[b][2], loop[c][2]],
        )
      }
    }
    plate.emit(writer, 'duct')
  }
  cheek(0, 1)
  cheek(SKIRT_SEGMENTS, SKIRT_SEGMENTS - 1)
}

/** Tube axis: concentric with the iris at the portal, on the spur beyond. */
function tubeAxis(z: number, curve: (z: number) => Vector3): Vector3 {
  const blend = 1 - smoothStep(132, 168, z)
  const spur = curve(z)
  return new Vector3(spur.x * (1 - blend), spur.y * (1 - blend) + PORTAL_AXIS_Y * blend, z)
}

function tubeRadius(z: number): number {
  return (
    TUBE_RADIUS_PORTAL +
    (TUBE_RADIUS_RUN - TUBE_RADIUS_PORTAL) * smoothStep(TUBE_START_Z, 175, z)
  )
}

function buildTubeShell(writer: PartWriter, curve: (z: number) => Vector3): void {
  // Station list: a 2 m base pitch plus four stations per structural rib so
  // each rib is a raised band on ONE continuous skin, not an applied ring.
  const zs: number[] = []
  for (let z = TUBE_START_Z; z <= TUBE_END_Z; z += 2) zs.push(z)
  const ribs: number[] = []
  for (let z = TUBE_RIB_FIRST_Z; z <= TUBE_END_Z - 4; z += TUBE_RIB_SPACING) ribs.push(z)
  for (const z of ribs) zs.push(z - 0.34, z - 0.26, z + 0.26, z + 0.34)
  zs.push(TUBE_END_Z)
  zs.sort((a, b) => a - b)

  const isRibBand = (z: number): boolean =>
    ribs.some((ribZ) => Math.abs(z - ribZ) <= 0.27)

  const segments = 44
  const rings: Vector3[][] = []
  for (const z of zs) {
    const axis = tubeAxis(z, curve)
    const radius = tubeRadius(z) + (isRibBand(z) ? 0.26 : 0)
    const ring: Vector3[] = []
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2
      ring.push(
        new Vector3(
          axis.x + Math.cos(angle) * radius,
          axis.y + Math.sin(angle) * radius,
          z,
        ),
      )
    }
    rings.push(ring)
  }

  // Smooth AROUND the barrel, sharp ALONG it: the radial component comes from
  // the segment's own angle (so 44 facets stop reading as 44 flats) while the
  // axial component comes from the band's own slope, which keeps every rib
  // shoulder a crease instead of a rolled-over blur.
  for (let i = 0; i < rings.length - 1; i++) {
    const slot: DomeSlot = isRibBand(zs[i]) && isRibBand(zs[i + 1]) ? 'node' : 'duct'
    const soup = new SmoothSoup()
    const axis0 = tubeAxis(zs[i], curve)
    const axis1 = tubeAxis(zs[i + 1], curve)
    const dr =
      Math.hypot(rings[i + 1][0].x - axis1.x, rings[i + 1][0].y - axis1.y) -
      Math.hypot(rings[i][0].x - axis0.x, rings[i][0].y - axis0.y)
    const dz = zs[i + 1] - zs[i]
    const length = Math.hypot(dr, dz) || 1
    // Right normal of the (dr, dz) generator: outward for a barrel run +z.
    const nr = dz / length
    const nz = -dr / length
    const normalAt = (ring: number, s: number): Vector3 => {
      const axis = ring === 0 ? axis0 : axis1
      const p = rings[i + ring][s]
      const ux = p.x - axis.x
      const uy = p.y - axis.y
      const ul = Math.hypot(ux, uy) || 1
      return new Vector3((ux / ul) * nr, (uy / ul) * nr, nz)
    }
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments
      const u0 = (s / segments) * Math.PI * 2 * TUBE_RADIUS_RUN
      const u1 = ((s + 1) / segments) * Math.PI * 2 * TUBE_RADIUS_RUN
      soup.tri(
        [rings[i][s], rings[i][s2], rings[i + 1][s2]],
        [normalAt(0, s), normalAt(0, s2), normalAt(1, s2)],
        [[u0, zs[i]], [u1, zs[i]], [u1, zs[i + 1]]],
      )
      soup.tri(
        [rings[i][s], rings[i + 1][s2], rings[i + 1][s]],
        [normalAt(0, s), normalAt(1, s2), normalAt(1, s)],
        [[u0, zs[i]], [u1, zs[i + 1]], [u0, zs[i + 1]]],
      )
    }
    soup.emit(writer, slot)
  }

  // Far end: a closed bulkhead, so the duct never reads as an open pipe.
  const last = rings[rings.length - 1]
  const axis = tubeAxis(TUBE_END_Z, curve)
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments
    writer.tri(
      'node',
      new Vector3(axis.x, axis.y, TUBE_END_Z),
      last[s2],
      last[s],
    )
  }
}

/** Trestle bents carrying the duct across the valley floor. */
function buildTubeSupports(writer: PartWriter, curve: (z: number) => Vector3): void {
  for (let z = 156; z <= TUBE_END_Z - 20; z += 24) {
    const axis = tubeAxis(z, curve)
    const radius = tubeRadius(z)
    const ground = Math.min(exteriorHeight(axis.x, z), axis.y - radius - 1.2)
    if (!Number.isFinite(ground)) continue
    for (const side of [-1, 1]) {
      const top = new Vector3(
        axis.x + side * radius * 0.62,
        axis.y - radius * 0.78,
        z,
      )
      const foot = new Vector3(axis.x + side * (radius + 2.4), ground - 0.6, z)
      writer.tube({
        path: [top, foot],
        radius: 0.28,
        slot: 'node',
        radialSegments: 10,
        capStart: true,
        capEnd: true,
      })
      writer.box({
        center: new Vector3(foot.x, ground + 0.2, z),
        size: new Vector3(2.2, 1.6, 2.2),
        slot: 'stone',
        chamfer: 0.06,
      })
    }
    // Cross-tie between the two legs, under the duct.
    writer.tube({
      path: [
        new Vector3(axis.x - (radius + 1.6), axis.y - radius - 1.5, z),
        new Vector3(axis.x + (radius + 1.6), axis.y - radius - 1.5, z),
      ],
      radius: 0.16,
      slot: 'node',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
}

/**
 * The complete arrival assembly. Casts shadows (unlike the dome shell, which
 * the analytic lattice field owns) so the duct lays a real bar across the
 * valley floor.
 */
export function buildConnectorTube(materials: Record<DomeSlot, Material>): Group {
  const track = buildTrackData()
  const samples: Array<[number, Vector3]> = []
  for (let i = 0; i <= 240; i++) {
    const point = track.arrival.getPoint(i / 240)
    samples.push([point.z, new Vector3(point.x, point.y + 1.6, point.z)])
  }
  samples.sort((a, b) => a[0] - b[0])
  const curveAt = (z: number): Vector3 => {
    if (z <= samples[0][0]) return samples[0][1]
    for (let i = 1; i < samples.length; i++) {
      if (samples[i][0] >= z) {
        const [z0, p0] = samples[i - 1]
        const [z1, p1] = samples[i]
        const t = z1 - z0 < 1e-6 ? 0 : (z - z0) / (z1 - z0)
        return p0.clone().lerp(p1, t)
      }
    }
    return samples[samples.length - 1][1]
  }

  const writer = new PartWriter()
  buildPortalCollar(writer)
  buildPortalSkirt(writer)
  buildTubeShell(writer, curveAt)
  buildTubeSupports(writer, curveAt)

  const group = new Group()
  group.name = 'dome:connector-tube'
  group.add(writer.build(materials, { castShadow: true }))
  return group
}

/** Datums and generators `tools/portal-audit.mjs` gates. Not used at runtime. */
export const __portalProbe = {
  COLLAR_BORE,
  COLLAR_OUTER,
  COLLAR_INBOARD_Z,
  COLLAR_OUTBOARD_Z,
  SKIRT_RIM_R,
  SKIRT_RIM_Z,
  SKIRT_WALL,
  apertureZ,
  skirtPoint,
  skirtBandEnd,
}
