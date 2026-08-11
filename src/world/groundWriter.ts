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

/**
 * Ear-clip a planar polygon on its OWN plane, returning index triples into
 * `corners`. The vertex ORDER is preserved (the ears are chosen with the
 * outline's own signed-area sign), so emitted triangles keep exactly the facing
 * the caller's winding asked for — this is a triangulation fix, never a
 * flip. Falls back to a fan if the outline is too degenerate to clip.
 */
function earClip(corners: GroundVertex[], normal: Vector3): Array<[number, number, number]> {
  const count = corners.length
  // An in-plane basis. The first candidate degenerates when the normal is
  // parallel to Z, so fall back to X there.
  let ux = normal.y
  let uy = -normal.x
  let uz = 0
  if (ux * ux + uy * uy < 1e-12) {
    ux = 1
    uy = 0
    uz = 0
  }
  const ul = Math.hypot(ux, uy, uz)
  ux /= ul
  uy /= ul
  uz /= ul
  const vx = normal.y * uz - normal.z * uy
  const vy = normal.z * ux - normal.x * uz
  const vz = normal.x * uy - normal.y * ux
  const px: number[] = []
  const py: number[] = []
  for (const corner of corners) {
    const p = corner.p
    px.push(p.x * ux + p.y * uy + p.z * uz)
    py.push(p.x * vx + p.y * vy + p.z * vz)
  }
  let area2 = 0
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    area2 += px[i] * py[j] - px[j] * py[i]
  }
  const sign = area2 >= 0 ? 1 : -1
  const cross = (i: number, j: number, k: number): number =>
    (px[j] - px[i]) * (py[k] - py[i]) - (py[j] - py[i]) * (px[k] - px[i])

  const ring: number[] = []
  for (let i = 0; i < count; i++) ring.push(i)
  const out: Array<[number, number, number]> = []
  let guard = count * count + 8
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false
    for (let k = 0; k < ring.length; k++) {
      const i0 = ring[(k + ring.length - 1) % ring.length]
      const i1 = ring[k]
      const i2 = ring[(k + 1) % ring.length]
      // Convex corner for this outline's orientation?
      if (cross(i0, i1, i2) * sign <= 0) continue
      let contains = false
      for (const m of ring) {
        if (m === i0 || m === i1 || m === i2) continue
        if (
          cross(i0, i1, m) * sign >= 0 &&
          cross(i1, i2, m) * sign >= 0 &&
          cross(i2, i0, m) * sign >= 0
        ) {
          contains = true
          break
        }
      }
      if (contains) continue
      out.push([i0, i1, i2])
      ring.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (ring.length === 3) {
    out.push([ring[0], ring[1], ring[2]])
    return out
  }
  out.length = 0
  for (let i = 1; i < count - 1; i++) out.push([0, i, i + 1])
  return out
}

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

  /** Planar polygon (3..n corners), wound counter-clockwise about its normal.
   *  Concave outlines are ear-clipped; see the note at the bottom of the body. */
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
    // Quads and triangles keep the fan: it is correct for them, and a slab cell
    // is non-planar over the grade, so its diagonal is load-bearing and must
    // not move. Anything with MORE corners here is a sweep cap, and every sweep
    // cap in this file is a channel section (a U) — a fan across a U emits
    // triangles that fold outside the outline and overlap each other, which is
    // how the embedded floor-light housings shipped 2 258 cm² of self-z-fight.
    // Same trap that made `tram/tramMesh.ts` ear-clip; do not reintroduce a fan.
    if (corners.length <= 4) {
      for (let i = 1; i < corners.length - 1; i++) {
        slot.indices.push(base, base + i, base + i + 1)
      }
      return
    }
    for (const [i, j, k] of earClip(corners, normal)) {
      slot.indices.push(base + i, base + j, base + k)
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
