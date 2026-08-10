import { Group, Mesh, PlaneGeometry, Vector3 } from 'three'
import { cleanMesh, loft, roundedRect, smoothShade, toYUp, writeInto } from '../archkit/meshdata'
import type { Vec2, Vec3 } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import { signageMaterial } from '../materials/library'
import { interiorHeight } from '../world/interiorHeight'
import { GARDENS, PATHS } from '../world/parkPlan'
import { pavedSignedDistance } from '../world/pavingPlan'
import { plantBed, PlantingPalette } from './planting'
import type { VegetationCollider } from './planting'
import { placeRock, rockMesh } from './rocks'

/**
 * THE REGOLITH GARDENS — the deliberate counterweight to the planters.
 *
 * Inside a planter wall the park is lush. Out here on open regolith it is
 * MINERAL: raked ground, rock set as sculpture, and a few rationed clumps of
 * sedge inside steel frames. The contrast is the design; densifying these
 * would flatten the whole idea of green being precious.
 *
 * Three systems, in the order the eye reads them:
 *
 *   1. **Raked furrows as real geometry.** Established the hard way
 *      (notes.md S14): rake rings authored as ±13 % albedo are invisible
 *      after grading and haze. These are swept ridges that catch the low sun.
 *      They break around paths, beds and rock — a rake never crosses a walked
 *      or planted surface, and it flows AROUND stone.
 *   2. **Eddy rings.** Tight concentric rings around each rock group, the
 *      karesansui move that turns a scattered boulder into a composed one.
 *   3. **Rock groups.** Odd-numbered clusters (a hero plus one or two
 *      companions), lofted with dipping sedimentary beds — see `rocks.ts`.
 */

/** Rake pitch, metres. A machine-raked furrow field, not a zen garden. */
const RAKE_PITCH = 1.25
const RAKE_RADIUS = 0.05

interface RockGroup {
  x: number
  z: number
  /** Keep-out for the rake, metres. */
  radius: number
}

interface BedFootprint {
  x: number
  z: number
  halfX: number
  halfZ: number
  yaw: number
  reach: number
}

export interface GardenStats {
  zones: number
  boulders: number
  beds: number
  furrowRuns: number
}

function clearOfPaths(x: number, z: number, margin: number): boolean {
  for (const path of PATHS) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i]
      const b = path.points[i + 1]
      const abx = b.x - a.x
      const abz = b.y - a.y
      const l2 = abx * abx + abz * abz
      if (l2 === 0) continue
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / l2))
      const dx = x - (a.x + abx * t)
      const dz = z - (a.y + abz * t)
      if (dx * dx + dz * dz < (path.width / 2 + margin) ** 2) return false
    }
  }
  return true
}

/**
 * A steel-edged bed: 6 mm plate standing 90 mm proud, rooted 180 mm into the
 * regolith. Built as ONE closed swept shell around a rounded-rect path, so
 * the corners are arcs rather than mitres and there is no joint to open.
 */
function emitBedEdging(
  writer: PartWriter,
  bed: BedFootprint,
  soilY: number,
): void {
  const outline = roundedRect(bed.halfX * 2, bed.halfZ * 2, 0.3, 4)
  const thickness = 0.006
  const reveal = 0.09
  const root = 0.18
  const cos = Math.cos(bed.yaw)
  const sin = Math.sin(bed.yaw)

  const points = outline.map(([lx, lz]) => ({
    x: bed.x + lx * cos + lz * sin,
    z: bed.z - lx * sin + lz * cos,
  }))
  const count = points.length
  const rings: Vec3[][] = []
  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count]
    const next = points[(i + 1) % count]
    // Right-of-travel normal from the averaged tangent — no mitre spikes on a
    // rounded outline, and the section keeps its width through the arcs.
    let nx = next.z - previous.z
    let nz = -(next.x - previous.x)
    const length = Math.hypot(nx, nz) || 1
    nx /= length
    nz /= length
    const base = soilY - 0.02
    // Closed section: a thin plate with a rolled top edge (a raw 6 mm steel
    // arris at shin height is a real-world hazard AND a shading break).
    const section: Vec2[] = [
      [-thickness / 2, -root],
      [thickness / 2, -root],
      [thickness / 2, reveal - 0.004],
      [thickness / 2 - 0.002, reveal],
      [-thickness / 2 + 0.002, reveal],
      [-thickness / 2, reveal - 0.004],
    ]
    rings.push(
      section.map(([offset, height]) => {
        const x = points[i].x + nx * offset
        const z = points[i].z + nz * offset
        return [x, z, base + height] as Vec3
      }),
    )
  }
  const edging = loft(rings, { closeU: true, closeV: true })
  smoothShade(edging, 36)
  cleanMesh(edging)
  toYUp(edging)
  writeInto(writer, 'steel', edging)

  // Bed soil: a slightly domed prepared surface, 60 mm below the edging top.
  const steps = 6
  const point = (u: number, v: number): Vector3 => {
    const lx = (u - 0.5) * bed.halfX * 2 * 0.985
    const lz = (v - 0.5) * bed.halfZ * 2 * 0.985
    const dome = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.03
    return new Vector3(bed.x + lx * cos + lz * sin, soilY + dome, bed.z - lx * sin + lz * cos)
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      writer.quad(
        'soil',
        point(i / steps, j / steps),
        point((i + 1) / steps, j / steps),
        point((i + 1) / steps, (j + 1) / steps),
        point(i / steps, (j + 1) / steps),
        0.4,
      )
    }
  }
}

/**
 * A low info stake: a 40 mm post with an angled plate at reading height for
 * someone standing over the bed. The park has no HUD, so what the place calls
 * itself has to be diegetic.
 */
function emitInfoStake(
  writer: PartWriter,
  group: Group,
  x: number,
  z: number,
  groundY: number,
  yaw: number,
  lines: string[],
): void {
  const height = 0.52
  writer.box({
    center: new Vector3(x, groundY + height / 2 - 0.06, z),
    size: new Vector3(0.045, height + 0.12, 0.045),
    slot: 'steel',
    chamfer: 0.004,
    rotationY: yaw,
  })
  // Plate body, tilted back toward the reader.
  const tilt = -0.62
  const plateCenter = new Vector3(x, groundY + height, z)
  const plate = new Mesh(new PlaneGeometry(0.3, 0.19), signageMaterial(lines, { widthPx: 512 }))
  plate.position.copy(plateCenter)
  plate.rotation.set(tilt, yaw, 0, 'YXZ')
  plate.name = 'garden-stake-face'
  group.add(plate)
  // The plate's carrier sits BEHIND the face with a 1 mm reveal, so the two
  // are never coplanar (the sign-on-a-box defect).
  const backing = plateCenter
    .clone()
    .add(
      new Vector3(0, 0, -0.004)
        .applyAxisAngle(new Vector3(1, 0, 0), tilt)
        .applyAxisAngle(new Vector3(0, 1, 0), yaw),
    )
  writer.box({
    center: backing,
    size: new Vector3(0.32, 0.21, 0.008),
    slot: 'steel',
    chamfer: 0.003,
    rotationY: yaw,
  })
}

export function buildRegolithGardens(
  palette: PlantingPalette,
  writer: PartWriter,
  group: Group,
  colliders: VegetationCollider[],
  rng: Rng,
): GardenStats {
  let boulders = 0
  let beds = 0
  let furrowRuns = 0

  GARDENS.forEach((zone, zoneIndex) => {
    const rocks: RockGroup[] = []
    const footprints: BedFootprint[] = []

    // ── Rock groups: two or three clusters per zone, odd-numbered members.
    const groupCount = zone.radius > 20 ? 3 : 2
    for (let g = 0; g < groupCount; g++) {
      let cx = 0
      let cz = 0
      let placed = false
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const distance = Math.sqrt(rng.range(0.06, 0.68)) * zone.radius
        cx = zone.x + Math.cos(angle) * distance
        cz = zone.z + Math.sin(angle) * distance
        if (!clearOfPaths(cx, cz, 4.2)) continue
        if (pavedSignedDistance(cx, cz) < 3.5) continue
        if (rocks.some((r) => Math.hypot(r.x - cx, r.z - cz) < 11)) continue
        placed = true
      }
      if (!placed) continue

      const members = rng.pick([2, 3, 3])
      for (let m = 0; m < members; m++) {
        // The hero first, companions leaning around it.
        const hero = m === 0
        const spread = hero ? 0 : rng.range(1.1, 2.6)
        const bearing = rng.range(0, Math.PI * 2)
        const x = cx + Math.cos(bearing) * spread
        const z = cz + Math.sin(bearing) * spread
        const radius = hero ? rng.range(0.85, 1.35) : rng.range(0.38, 0.72)
        const height = radius * rng.range(1.35, 2.1)
        const y = interiorHeight(x, z)
        const mesh = rockMesh({
          radius,
          height,
          seed: rng.float() * 10,
          elongation: rng.range(1.05, 1.7),
          bury: 0.26,
          levels: hero ? 22 : 14,
          segments: hero ? 40 : 26,
          bands: rng.int(4, 6),
          bedAmount: rng.range(0.11, 0.16),
          dip: rng.range(0.25, 0.6),
          lumpiness: rng.range(0.24, 0.34),
        })
        placeRock(mesh, x, y, z, rng.range(0, Math.PI * 2))
        writeInto(writer, 'stone', mesh)
        boulders++
        rocks.push({ x, z, radius: radius * 1.5 + 0.6 })
        if (hero || radius > 0.55) {
          colliders.push({
            kind: 'cylinder',
            center: new Vector3(x, y + height * 0.3, z),
            radius: radius * 0.88,
            halfHeight: height * 0.42,
          })
        }
      }

      // Eddy rings: the ripples that compose the group.
      const outer = Math.max(...rocks.slice(-members).map((r) => r.radius))
      for (let ring = 0; ring < 3; ring++) {
        const ringRadius = outer + 0.55 + ring * 0.55
        furrowRuns += emitRing(writer, cx, cz, ringRadius, rocks, footprints, 0.038)
      }
    }

    // ── Beds: rationed planting inside steel frames.
    const bedCount = zone.radius > 20 ? 3 : 2
    let stakePlaced = false
    for (let b = 0; b < bedCount; b++) {
      let bed: BedFootprint | null = null
      for (let attempt = 0; attempt < 60 && !bed; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        const distance = Math.sqrt(rng.range(0.1, 0.72)) * zone.radius
        const x = zone.x + Math.cos(angle) * distance
        const z = zone.z + Math.sin(angle) * distance
        const halfX = rng.range(1.6, 2.6)
        const halfZ = rng.range(0.9, 1.5)
        const reach = Math.hypot(halfX, halfZ)
        if (!clearOfPaths(x, z, reach + 2.2)) continue
        if (pavedSignedDistance(x, z) < reach + 2) continue
        if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + reach + 2)) continue
        if (footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.reach + reach + 2)) continue
        bed = { x, z, halfX, halfZ, yaw: rng.range(0, Math.PI), reach }
      }
      if (!bed) continue
      footprints.push(bed)

      // The prepared surface is flat: sample the footprint and sit above its
      // high corner so the edging's root stays buried all the way round.
      let highest = -Infinity
      for (const sx of [-1, 0, 1]) {
        for (const sz of [-1, 0, 1]) {
          const px = bed.x + sx * bed.halfX * Math.cos(bed.yaw) + sz * bed.halfZ * Math.sin(bed.yaw)
          const pz = bed.z - sx * bed.halfX * Math.sin(bed.yaw) + sz * bed.halfZ * Math.cos(bed.yaw)
          highest = Math.max(highest, interiorHeight(px, pz))
        }
      }
      const soilY = highest + 0.03
      emitBedEdging(writer, bed, soilY)
      plantBed(palette, rng, {
        x: bed.x,
        z: bed.z,
        halfX: bed.halfX - 0.18,
        halfZ: bed.halfZ - 0.18,
        yaw: bed.yaw,
        y: soilY,
        // Mars-sparse: roughly a fifth of a planter's density.
        density: rng.range(1.4, 2.1),
      })
      beds++

      // One stake per zone — on the first bed that ACTUALLY places, not on
      // loop index 0, which may have been rejected by the keep-outs.
      if (!stakePlaced) {
        stakePlaced = true
        const stakeX = bed.x + (bed.halfX + 0.42) * Math.cos(bed.yaw)
        const stakeZ = bed.z - (bed.halfX + 0.42) * Math.sin(bed.yaw)
        emitInfoStake(
          writer,
          group,
          stakeX,
          stakeZ,
          interiorHeight(stakeX, stakeZ),
          bed.yaw + Math.PI / 2,
          zoneIndex === 0
            ? ['REGOLITH GARDEN', 'BED 1 - CAREX SP.', 'SOIL TRIAL 04']
            : ['SOUTH GARDEN', 'BED 1 - CAREX SP.', 'SOIL TRIAL 11'],
        )
      }
    }

    // ── The rake. Concentric rings on the zone, breaking for everything.
    const outerLimit = zone.radius * 0.86
    for (let ringRadius = 2.6; ringRadius < outerLimit; ringRadius += RAKE_PITCH) {
      furrowRuns += emitRing(writer, zone.x, zone.z, ringRadius, rocks, footprints, RAKE_RADIUS)
    }
  })

  return { zones: GARDENS.length, boulders, beds, furrowRuns }
}

/**
 * One raked ring, broken into runs wherever it would cross a path, a bed, a
 * rock or paving. Returns the number of runs emitted.
 */
function emitRing(
  writer: PartWriter,
  cx: number,
  cz: number,
  ringRadius: number,
  rocks: RockGroup[],
  beds: BedFootprint[],
  radius: number,
): number {
  // ~0.8 m per station: coarse enough to be cheap, fine enough that the ring
  // reads as a curve AND that the break-around test resolves a boulder.
  const segments = Math.max(64, Math.round(ringRadius * 8))
  let run: Vector3[] = []
  let emitted = 0
  const flush = (): void => {
    if (run.length >= 4) {
      writer.tube({ path: run, radius, slot: 'soil', radialSegments: 5, uvScale: 0.4 })
      emitted++
    }
    run = []
  }
  for (let s = 0; s <= segments; s++) {
    const angle = (s / segments) * Math.PI * 2
    const x = cx + Math.cos(angle) * ringRadius
    const z = cz + Math.sin(angle) * ringRadius
    const blocked =
      !clearOfPaths(x, z, 1.4) ||
      pavedSignedDistance(x, z) < 1.2 ||
      rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius) ||
      beds.some((b) => Math.hypot(b.x - x, b.z - z) < b.reach + 0.9)
    if (blocked) {
      flush()
      continue
    }
    // Sunk so the ridge stands ~8 cm proud of the regolith it is raked from.
    run.push(new Vector3(x, interiorHeight(x, z) + radius * 0.55, z))
  }
  flush()
  return emitted
}
