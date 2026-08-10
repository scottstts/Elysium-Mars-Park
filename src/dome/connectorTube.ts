import { Group, Vector3 } from 'three'
import type { Material } from 'three'
import { PartWriter } from '../archkit/writer'
import { exteriorHeight } from '../exterior/terrainHeight'
import { buildTrackData } from '../tram/track'
import type { DomeSlot } from './domeMaterials'
import { PORTAL_AXIS_Y } from './domeGeometry'
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
 * Surface of revolution about the Z axis for a closed (r, z) profile — the
 * Z-axis twin of a lathe, which the portal bulkhead needs and three's lathe
 * cannot give.
 */
function revolveZ(
  writer: PartWriter,
  slot: DomeSlot,
  centerX: number,
  centerY: number,
  profile: Array<[number, number]>,
  segments: number,
): void {
  const rings: Vector3[][] = []
  for (let s = 0; s <= segments; s++) {
    const angle = (s / segments) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    rings.push(
      profile.map(([r, z]) => new Vector3(centerX + cos * r, centerY + sin * r, z)),
    )
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < profile.length - 1; i++) {
      writer.quad(slot, rings[s][i], rings[s][i + 1], rings[s + 1][i + 1], rings[s + 1][i])
    }
  }
}

function buildPortalCollar(writer: PartWriter): void {
  // One closed section: outer drum → outboard face → bore → petal slot →
  // inboard face → back to the drum.
  revolveZ(
    writer,
    'node',
    0,
    PORTAL_AXIS_Y,
    [
      [COLLAR_OUTER, COLLAR_INBOARD_Z + 0.14],
      [COLLAR_OUTER, COLLAR_OUTBOARD_Z - 0.14],
      [COLLAR_OUTER - 0.15, COLLAR_OUTBOARD_Z],
      [COLLAR_BORE + 0.15, COLLAR_OUTBOARD_Z],
      [COLLAR_BORE, COLLAR_OUTBOARD_Z - 0.14],
      [COLLAR_BORE, SLOT_BACK_Z],
      [SLOT_OUTER, SLOT_BACK_Z],
      [SLOT_OUTER, SLOT_FRONT_Z],
      [COLLAR_BORE, SLOT_FRONT_Z],
      [COLLAR_BORE, COLLAR_INBOARD_Z + 0.14],
      [COLLAR_BORE + 0.15, COLLAR_INBOARD_Z],
      [COLLAR_OUTER - 0.15, COLLAR_INBOARD_Z],
      [COLLAR_OUTER, COLLAR_INBOARD_Z + 0.14],
    ],
    72,
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
    72,
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
 * bulkhead. The aperture is an oblique cut through the sphere (its z runs
 * from 121 m at the crown of the hole to 131 m at its invert), so this is a
 * genuinely warped cone, not a cylinder — built as one lofted band with real
 * thickness normal to its own surface, capped at both rims.
 */
function buildPortalSkirt(writer: PartWriter): void {
  const segments = 72
  const bore = 6.15
  const wall = 0.11
  const inner: Vector3[][] = [[], []]
  const outer: Vector3[][] = [[], []]
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const cx = Math.cos(angle)
    const cy = Math.sin(angle)
    const x = cx * bore
    const y = PORTAL_AXIS_Y + cy * bore
    const dy = y - DOME_CENTER_Y
    const az = Math.sqrt(
      Math.max(1, DOME_SPHERE_RADIUS * DOME_SPHERE_RADIUS - x * x - dy * dy),
    )
    const bz = Math.min(COLLAR_INBOARD_Z, az - 0.4)
    const dr = COLLAR_OUTER - bore
    const dz = bz - az
    const length = Math.hypot(dr, dz)
    // Surface normal in the (radial, z) plane of this meridian.
    const nr = (dz / length) * wall
    const nz = (-dr / length) * wall
    const a = new Vector3(x, y, az)
    const b = new Vector3(cx * COLLAR_OUTER, PORTAL_AXIS_Y + cy * COLLAR_OUTER, bz)
    inner[0].push(a)
    inner[1].push(b)
    outer[0].push(new Vector3(a.x + cx * nr, a.y + cy * nr, a.z + nz))
    outer[1].push(new Vector3(b.x + cx * nr, b.y + cy * nr, b.z + nz))
  }
  for (let i = 0; i < segments; i++) {
    writer.quad('duct', outer[0][i], outer[0][i + 1], outer[1][i + 1], outer[1][i])
    writer.quad('duct', inner[1][i], inner[1][i + 1], inner[0][i + 1], inner[0][i])
    writer.quad('duct', inner[0][i], inner[0][i + 1], outer[0][i + 1], outer[0][i])
    writer.quad('node', outer[1][i], outer[1][i + 1], inner[1][i + 1], inner[1][i])
  }
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

  for (let i = 0; i < rings.length - 1; i++) {
    const slot: DomeSlot = isRibBand(zs[i]) && isRibBand(zs[i + 1]) ? 'node' : 'duct'
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments
      writer.quad(slot, rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s])
    }
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
