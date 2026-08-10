import { BufferAttribute, BufferGeometry, Group, Mesh, Vector2, Vector3 } from 'three'
import type { Material } from 'three'

/**
 * Compact hard-surface mesh writer (craft rules from CLAUDE.md):
 * - every part is written into a material slot; one merged geometry per slot
 *   (no per-part meshes, no assembly overlaps);
 * - boxes carry 45° edge chamfers — the difference between "CG box" and
 *   machined hardware; chamfer faces can route to a separate slot so worn
 *   edge paint reads on real edges only;
 * - all faces are authored with explicit normals; no coplanar stacking.
 */
export class PartWriter {
  private readonly slots = new Map<
    string,
    { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
  >()

  private slot(name: string) {
    let slot = this.slots.get(name)
    if (!slot) {
      slot = { positions: [], normals: [], uvs: [], indices: [] }
      this.slots.set(name, slot)
    }
    return slot
  }

  /** Raw quad (a,b,c,d counter-clockwise seen from the normal side). */
  quad(
    slotName: string,
    a: Vector3,
    b: Vector3,
    c: Vector3,
    d: Vector3,
    uvScale = 1,
  ): void {
    const slot = this.slot(slotName)
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a))
    // Degenerate faces are dropped outright — a zero-area face normalizes
    // to NaN and one NaN normal poisons AO + bloom frame-wide.
    if (normal.lengthSq() < 1e-14) return
    normal.normalize()
    const base = slot.positions.length / 3
    // Planar UVs from the dominant axis, world-scaled.
    const tangent = new Vector3().subVectors(b, a).normalize()
    const bitangent = new Vector3().crossVectors(normal, tangent)
    for (const p of [a, b, c, d]) {
      slot.positions.push(p.x, p.y, p.z)
      slot.normals.push(normal.x, normal.y, normal.z)
      slot.uvs.push(p.dot(tangent) * uvScale, p.dot(bitangent) * uvScale)
    }
    slot.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  tri(slotName: string, a: Vector3, b: Vector3, c: Vector3): void {
    const slot = this.slot(slotName)
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
    if (normal.lengthSq() < 1e-14) return
    normal.normalize()
    const base = slot.positions.length / 3
    for (const p of [a, b, c]) {
      slot.positions.push(p.x, p.y, p.z)
      slot.normals.push(normal.x, normal.y, normal.z)
      slot.uvs.push(0, 0)
    }
    slot.indices.push(base, base + 1, base + 2)
  }

  /**
   * Chamfered axis-aligned box (then transformed): 6 inset faces + 12 edge
   * chamfer quads + 8 corner triangles. `chamferSlot` routes the chamfer
   * band to a second material (worn edge paint).
   */
  box(options: {
    center: Vector3
    size: Vector3
    slot: string
    chamfer?: number
    chamferSlot?: string
    rotationY?: number
    uvScale?: number
  }): void {
    const { center, size, slot } = options
    const c = Math.min(
      options.chamfer ?? Math.min(0.012, Math.min(size.x, size.y, size.z) * 0.12),
      Math.min(size.x, size.y, size.z) * 0.33,
    )
    const chamferSlot = options.chamferSlot ?? slot
    const uvScale = options.uvScale ?? 1
    const hx = size.x / 2
    const hy = size.y / 2
    const hz = size.z / 2
    const rotation = options.rotationY ?? 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const point = (x: number, y: number, z: number): Vector3 =>
      new Vector3(center.x + x * cos + z * sin, center.y + y, center.z - x * sin + z * cos)

    // Face centers inset by chamfer on the two orthogonal axes.
    const P = (sx: number, sy: number, sz: number, main: 'x' | 'y' | 'z'): Vector3 => {
      const inset = (v: number, h: number, isMain: boolean): number =>
        isMain ? v * h : v * (h - c)
      return point(
        inset(sx, hx, main === 'x'),
        inset(sy, hy, main === 'y'),
        inset(sz, hz, main === 'z'),
      )
    }

    // 6 main faces.
    this.quad(slot, P(1, -1, -1, 'x'), P(1, 1, -1, 'x'), P(1, 1, 1, 'x'), P(1, -1, 1, 'x'), uvScale)
    this.quad(slot, P(-1, -1, 1, 'x'), P(-1, 1, 1, 'x'), P(-1, 1, -1, 'x'), P(-1, -1, -1, 'x'), uvScale)
    this.quad(slot, P(-1, 1, 1, 'y'), P(1, 1, 1, 'y'), P(1, 1, -1, 'y'), P(-1, 1, -1, 'y'), uvScale)
    this.quad(slot, P(-1, -1, -1, 'y'), P(1, -1, -1, 'y'), P(1, -1, 1, 'y'), P(-1, -1, 1, 'y'), uvScale)
    this.quad(slot, P(-1, -1, 1, 'z'), P(1, -1, 1, 'z'), P(1, 1, 1, 'z'), P(-1, 1, 1, 'z'), uvScale)
    this.quad(slot, P(1, -1, -1, 'z'), P(-1, -1, -1, 'z'), P(-1, 1, -1, 'z'), P(1, 1, -1, 'z'), uvScale)

    if (c <= 0.0001) return

    // 12 edge chamfers.
    const edges: Array<[Vector3, Vector3, Vector3, Vector3]> = []
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // Edges along X at (±y, ±z)
        const a = P(-1, sy, sz, 'y')
        const b = P(1, sy, sz, 'y')
        const b2 = P(1, sy, sz, 'z')
        const a2 = P(-1, sy, sz, 'z')
        edges.push(sy * sz > 0 ? [a, b, b2, a2] : [a2, b2, b, a])
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a = P(sx, -1, sz, 'x')
        const b = P(sx, 1, sz, 'x')
        const b2 = P(sx, 1, sz, 'z')
        const a2 = P(sx, -1, sz, 'z')
        edges.push(sx * sz > 0 ? [a2, b2, b, a] : [a, b, b2, a2])
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const a = P(sx, sy, -1, 'x')
        const b = P(sx, sy, 1, 'x')
        const b2 = P(sx, sy, 1, 'y')
        const a2 = P(sx, sy, -1, 'y')
        edges.push(sx * sy > 0 ? [a, b, b2, a2] : [a2, b2, b, a])
      }
    }
    for (const [a, b, cc, d] of edges) this.quad(chamferSlot, a, b, cc, d, uvScale)

    // 8 corner triangles.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = P(sx, sy, sz, 'x')
          const py = P(sx, sy, sz, 'y')
          const pz = P(sx, sy, sz, 'z')
          const flip = sx * sy * sz > 0
          if (flip) this.tri(chamferSlot, px, py, pz)
          else this.tri(chamferSlot, px, pz, py)
        }
      }
    }
  }

  /** Horizontal disc (triangle fan), facing up or down. */
  disc(center: Vector3, radius: number, slot: string, options?: { down?: boolean; segments?: number; uvScale?: number }): void {
    const slotData = this.slot(slot)
    const segments = options?.segments ?? 40
    const down = options?.down ?? false
    const uvScale = options?.uvScale ?? 1
    const base = slotData.positions.length / 3
    slotData.positions.push(center.x, center.y, center.z)
    slotData.normals.push(0, down ? -1 : 1, 0)
    slotData.uvs.push(center.x * uvScale, center.z * uvScale)
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2
      const x = center.x + Math.cos(angle) * radius
      const z = center.z + Math.sin(angle) * radius
      slotData.positions.push(x, center.y, z)
      slotData.normals.push(0, down ? -1 : 1, 0)
      slotData.uvs.push(x * uvScale, z * uvScale)
    }
    for (let s = 0; s < segments; s++) {
      if (down) slotData.indices.push(base, base + 1 + s, base + 2 + s)
      else slotData.indices.push(base, base + 2 + s, base + 1 + s)
    }
  }

  /**
   * Arbitrary-orientation slab: 4 top corners (counter-clockwise seen from
   * above) extruded downward along the face normal. Roofs, ramps, gussets.
   */
  slab(corners: [Vector3, Vector3, Vector3, Vector3], thickness: number, slot: string, uvScale = 1): void {
    const [a, b, c, d] = corners
    const normal = new Vector3()
      .subVectors(b, a)
      .cross(new Vector3().subVectors(d, a))
      .normalize()
    const offset = normal.clone().multiplyScalar(-thickness)
    const a2 = a.clone().add(offset)
    const b2 = b.clone().add(offset)
    const c2 = c.clone().add(offset)
    const d2 = d.clone().add(offset)
    this.quad(slot, a, b, c, d, uvScale)
    this.quad(slot, d2, c2, b2, a2, uvScale)
    this.quad(slot, a2, b2, b, a, uvScale)
    this.quad(slot, b2, c2, c, b, uvScale)
    this.quad(slot, c2, d2, d, c, uvScale)
    this.quad(slot, d2, a2, a, d, uvScale)
  }

  /** Closed tube along a polyline (pipes, posts, conduits). */
  tube(options: {
    path: Vector3[]
    radius: number
    slot: string
    radialSegments?: number
    capStart?: boolean
    capEnd?: boolean
    uvScale?: number
  }): void {
    const { path, radius, slot } = options
    const radialSegments = options.radialSegments ?? 10
    const slotData = this.slot(slot)
    const uvScale = options.uvScale ?? 1
    const rings: Vector3[][] = []
    const ringNormals: Vector3[][] = []
    const up = new Vector3(0, 1, 0)
    let distance = 0
    for (let i = 0; i < path.length; i++) {
      const tangent =
        i === 0
          ? new Vector3().subVectors(path[1], path[0])
          : i === path.length - 1
            ? new Vector3().subVectors(path[i], path[i - 1])
            : new Vector3().subVectors(path[i + 1], path[i - 1])
      tangent.normalize()
      const side = Math.abs(tangent.dot(up)) > 0.93
        ? new Vector3(1, 0, 0).cross(tangent).normalize()
        : new Vector3().crossVectors(up, tangent).normalize()
      const upLocal = new Vector3().crossVectors(tangent, side)
      const ring: Vector3[] = []
      const ringN: Vector3[] = []
      for (let s = 0; s < radialSegments; s++) {
        const angle = (s / radialSegments) * Math.PI * 2
        const normal = side
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(upLocal, Math.sin(angle))
        ring.push(path[i].clone().addScaledVector(normal, radius))
        ringN.push(normal)
      }
      rings.push(ring)
      ringNormals.push(ringN)
      if (i > 0) distance += path[i].distanceTo(path[i - 1])
    }
    let runningDistance = 0
    for (let i = 0; i < path.length - 1; i++) {
      const segmentLength = path[i + 1].distanceTo(path[i])
      for (let s = 0; s < radialSegments; s++) {
        const s2 = (s + 1) % radialSegments
        const base = slotData.positions.length / 3
        // Winding order matters: (s → s2 → next·s2 → next·s) faces OUTWARD.
        // The reverse order shipped inside-out barrels — culled fronts that
        // read near-black on any fat tube seen from outside (the hab pods).
        const vertices = [
          [rings[i][s], ringNormals[i][s], runningDistance, s / radialSegments],
          [rings[i][s2], ringNormals[i][s2], runningDistance, (s + 1) / radialSegments],
          [rings[i + 1][s2], ringNormals[i + 1][s2], runningDistance + segmentLength, (s + 1) / radialSegments],
          [rings[i + 1][s], ringNormals[i + 1][s], runningDistance + segmentLength, s / radialSegments],
        ] as const
        for (const [p, n, u, v] of vertices) {
          slotData.positions.push(p.x, p.y, p.z)
          slotData.normals.push(n.x, n.y, n.z)
          slotData.uvs.push(u * uvScale, v)
        }
        slotData.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
      runningDistance += segmentLength
    }
    void distance
    const capRing = (index: number, flip: boolean): void => {
      const ring = rings[index]
      const center = path[index]
      const normal = new Vector3()
        .subVectors(path[Math.min(index + 1, path.length - 1)], path[Math.max(index - 1, 0)])
        .normalize()
      if (flip) normal.negate()
      const base = slotData.positions.length / 3
      slotData.positions.push(center.x, center.y, center.z)
      slotData.normals.push(normal.x, normal.y, normal.z)
      slotData.uvs.push(0, 0)
      for (const p of ring) {
        slotData.positions.push(p.x, p.y, p.z)
        slotData.normals.push(normal.x, normal.y, normal.z)
        slotData.uvs.push(0, 0)
      }
      for (let s = 0; s < ring.length; s++) {
        const s2 = (s + 1) % ring.length
        if (flip) slotData.indices.push(base, base + 1 + s2, base + 1 + s)
        else slotData.indices.push(base, base + 1 + s, base + 1 + s2)
      }
    }
    if (options.capStart) capRing(0, true)
    if (options.capEnd) capRing(path.length - 1, false)
  }

  /** Lathe a 2D profile (x = radius, y = height) around Y at `center`. */
  lathe(options: {
    center: Vector3
    profile: Vector2[]
    slot: string
    segments?: number
    uvScale?: number
  }): void {
    const { center, profile, slot } = options
    const segments = options.segments ?? 32
    const slotData = this.slot(slot)
    // Per-ring normals from profile tangents.
    const profileNormals: Vector2[] = profile.map((_, i) => {
      const previous = profile[Math.max(0, i - 1)]
      const next = profile[Math.min(profile.length - 1, i + 1)]
      const tangent = new Vector2().subVectors(next, previous).normalize()
      return new Vector2(tangent.y, -tangent.x)
    })
    for (let i = 0; i < profile.length - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const a0 = (s / segments) * Math.PI * 2
        const a1 = ((s + 1) / segments) * Math.PI * 2
        const ring = (p: Vector2, n: Vector2, angle: number): [Vector3, Vector3] => [
          new Vector3(
            center.x + Math.cos(angle) * p.x,
            center.y + p.y,
            center.z + Math.sin(angle) * p.x,
          ),
          new Vector3(Math.cos(angle) * n.x, n.y, Math.sin(angle) * n.x).normalize(),
        ]
        const [pa, na] = ring(profile[i], profileNormals[i], a0)
        const [pb, nb] = ring(profile[i + 1], profileNormals[i + 1], a0)
        const [pc, nc] = ring(profile[i + 1], profileNormals[i + 1], a1)
        const [pd, nd] = ring(profile[i], profileNormals[i], a1)
        const base = slotData.positions.length / 3
        const push = (p: Vector3, n: Vector3, u: number, v: number): void => {
          slotData.positions.push(p.x, p.y, p.z)
          slotData.normals.push(n.x, n.y, n.z)
          slotData.uvs.push(u, v)
        }
        push(pa, na, s / segments, i / profile.length)
        push(pb, nb, s / segments, (i + 1) / profile.length)
        push(pc, nc, (s + 1) / segments, (i + 1) / profile.length)
        push(pd, nd, (s + 1) / segments, i / profile.length)
        slotData.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
  }

  /** Emit one mesh per used slot, merged and shadow-flagged. */
  build(materials: Record<string, Material>, options?: { castShadow?: boolean }): Group {
    const group = new Group()
    for (const [name, slot] of this.slots) {
      if (slot.indices.length === 0) continue
      const material = materials[name]
      if (!material) throw new Error(`PartWriter: no material bound for slot "${name}"`)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(slot.positions), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(slot.normals), 3))
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(slot.uvs), 2))
      geometry.setIndex(slot.indices)
      const mesh = new Mesh(geometry, material)
      mesh.castShadow = options?.castShadow ?? true
      mesh.receiveShadow = true
      mesh.name = `part:${name}`
      group.add(mesh)
    }
    return group
  }
}
