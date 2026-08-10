import { BufferAttribute, BufferGeometry, Group, Mesh, Vector2, Vector3 } from 'three'
import type { Material } from 'three'

/**
 * The ground/paving mesh writer.
 *
 * `archkit/PartWriter` derives its UVs from a planar projection, which is
 * exactly wrong for surfaces whose material needs AUTHORED surface parameters
 * (panel coordinates, distance to the paved edge, height up a swept section).
 * This writer keeps the same slot-merged discipline — one geometry per
 * material, no per-part meshes — but every corner carries explicit
 * `uv` (vec2) and `pav` (vec3) values, and normals may be given per corner
 * (smooth ground) or derived per face (crisp cast edges).
 *
 * Degenerate faces are dropped outright: a zero-area face normalises to NaN
 * and one NaN normal poisons AO and bloom frame-wide (notes.md S12).
 */

export interface GroundVertex {
  p: Vector3
  /** Explicit normal; omitted → the face normal (flat shading). */
  n?: Vector3
  uv?: Vector2
  pav?: Vector3
}

interface Slot {
  positions: number[]
  normals: number[]
  uvs: number[]
  pavs: number[]
  indices: number[]
}

const ZERO2 = new Vector2()
const ZERO3 = new Vector3()

export class GroundWriter {
  private readonly slots = new Map<string, Slot>()

  private slot(name: string): Slot {
    let slot = this.slots.get(name)
    if (!slot) {
      slot = { positions: [], normals: [], uvs: [], pavs: [], indices: [] }
      this.slots.set(name, slot)
    }
    return slot
  }

  /** Convex polygon (3..n corners), wound counter-clockwise about its normal. */
  face(slotName: string, corners: GroundVertex[]): void {
    if (corners.length < 3) return
    const a = corners[0].p
    const b = corners[1].p
    const c = corners[corners.length - 1].p
    const normal = new Vector3()
      .subVectors(b, a)
      .cross(new Vector3().subVectors(c, a))
    if (normal.lengthSq() < 1e-13) return
    normal.normalize()

    const slot = this.slot(slotName)
    const base = slot.positions.length / 3
    for (const corner of corners) {
      const n = corner.n ?? normal
      const uvValue = corner.uv ?? ZERO2
      const pavValue = corner.pav ?? ZERO3
      slot.positions.push(corner.p.x, corner.p.y, corner.p.z)
      slot.normals.push(n.x, n.y, n.z)
      slot.uvs.push(uvValue.x, uvValue.y)
      slot.pavs.push(pavValue.x, pavValue.y, pavValue.z)
    }
    for (let i = 1; i < corners.length - 1; i++) {
      slot.indices.push(base, base + i, base + i + 1)
    }
  }

  triangleCount(): number {
    let total = 0
    for (const slot of this.slots.values()) total += slot.indices.length / 3
    return total
  }

  build(materials: Record<string, Material>, options?: { castShadow?: boolean }): Group {
    const group = new Group()
    for (const [name, slot] of this.slots) {
      if (slot.indices.length === 0) continue
      const material = materials[name]
      if (!material) throw new Error(`GroundWriter: no material bound for slot "${name}"`)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(slot.positions), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(slot.normals), 3))
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(slot.uvs), 2))
      geometry.setAttribute('pav', new BufferAttribute(new Float32Array(slot.pavs), 3))
      geometry.setIndex(slot.indices)
      const mesh = new Mesh(geometry, material)
      mesh.castShadow = options?.castShadow ?? true
      mesh.receiveShadow = true
      mesh.name = `ground:${name}`
      group.add(mesh)
    }
    return group
  }
}

/** One station of a swept run: a point on the run line plus its outward normal. */
export interface SweepStation {
  x: number
  z: number
  /** Unit outward direction in XZ — positive profile lateral points this way. */
  outX: number
  outZ: number
  /** Datum the profile heights are measured from (the slab top, normally). */
  baseY: number
  /** Distance travelled along the run — becomes uv.x (per-unit tone, wear). */
  run: number
}

/**
 * Sweep a closed section along a run of stations. Profile points are
 * `[lateral, height]` in metres: lateral along the station's outward
 * direction, height above its datum. The section is treated as a closed loop
 * (last point joins the first), which is how a precast curb, a planter wall
 * or a light housing is actually shaped — one continuous surface, no stacked
 * boxes, edge treatment carried IN the profile (geometry-craft §2.5).
 *
 * uv = (run, height) so materials can key dust washes to section height and
 * per-casting tone to run distance.
 */
export function sweepSection(
  writer: GroundWriter,
  slotName: string,
  stations: SweepStation[],
  profile: Array<[number, number]>,
  options?: { closedRun?: boolean; capStart?: boolean; capEnd?: boolean; slotCaps?: string },
): void {
  if (stations.length < 2 || profile.length < 3) return
  const closedRun = options?.closedRun ?? false
  const count = profile.length
  const point = (station: SweepStation, index: number): Vector3 => {
    const [lateral, height] = profile[index]
    return new Vector3(
      station.x + station.outX * lateral,
      station.baseY + height,
      station.z + station.outZ * lateral,
    )
  }

  // WINDING CONTRACT (get this wrong and every swept run renders inside-out —
  // notes.md S14, the inverted tube barrels). Profiles are wound
  // counter-clockwise in the (lateral, height) plane, and stations must run in
  // the direction `travel = (-outX, 0, outZ) rotated`, i.e.
  //     travel = (-out.z, 0, out.x)
  // so that section face `i → i+1` emitted as [a_i, a_j, b_j, b_i] carries the
  // outward normal `profileDir × travel`.
  const last = closedRun ? stations.length : stations.length - 1
  for (let s = 0; s < last; s++) {
    const a = stations[s]
    const b = stations[(s + 1) % stations.length]
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count
      writer.face(slotName, [
        { p: point(a, i), uv: new Vector2(a.run, profile[i][1]) },
        { p: point(a, j), uv: new Vector2(a.run, profile[j][1]) },
        { p: point(b, j), uv: new Vector2(b.run, profile[j][1]) },
        { p: point(b, i), uv: new Vector2(b.run, profile[i][1]) },
      ])
    }
  }

  if (closedRun) return
  const capSlot = options?.slotCaps ?? slotName
  // Under that contract an ASCENDING corner list faces forward along travel:
  // the start cap therefore descends and the end cap ascends.
  if (options?.capStart ?? true) {
    const station = stations[0]
    const corners: GroundVertex[] = []
    for (let i = count - 1; i >= 0; i--) {
      corners.push({ p: point(station, i), uv: new Vector2(station.run, profile[i][1]) })
    }
    writer.face(capSlot, corners)
  }
  if (options?.capEnd ?? true) {
    const station = stations[stations.length - 1]
    const corners: GroundVertex[] = []
    for (let i = 0; i < count; i++) {
      corners.push({ p: point(station, i), uv: new Vector2(station.run, profile[i][1]) })
    }
    writer.face(capSlot, corners)
  }
}
