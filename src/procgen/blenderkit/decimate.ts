/**
 * Vertex-cluster decimation for ported Blender geometry.
 *
 * A hard-surface Blender build is authored for a hero close-up: the Optimus
 * port lands at ~890 k triangles for a 1.73 m figure, which is right at 2 m
 * and absurd at 40 m, where the whole figure covers about thirty pixels. This
 * is the far end of the LOD chain.
 *
 * Clustering (quantise to a grid, average each cell, drop the triangles that
 * collapse) rather than edge collapse: it is O(n), it needs no manifold
 * topology — a CSG'd, beveled, welded-by-distance mesh is emphatically not
 * manifold — and at the pixel sizes this runs for, its one weakness (softened
 * hard edges) is indistinguishable from the correct filtered result.
 *
 * Clusters are keyed by material as well as position, so two slots that touch
 * can never merge into one blended vertex and no draw range is lost.
 */
import type { GeometryGroup, GeometryPayload } from './toGeometry'

export function clusterDecimate(src: GeometryPayload, cell: number): GeometryPayload {
  const inv = 1 / cell
  const sums: number[] = []
  const counts: number[] = []
  const cellIndex = new Map<string, number>()

  // Which material each source vertex is drawn with. A vertex shared by two
  // slots gets one cluster per slot — the alternative is a seam that pulls
  // one material's boundary across the other's.
  const slotOf = new Int32Array(src.position.length / 3).fill(-1)
  for (const group of src.groups) {
    for (let i = group.start; i < group.start + group.count; i++) {
      slotOf[src.index[i]] = group.materialIndex
    }
  }

  const clusterOf = (vi: number): number => {
    const x = src.position[vi * 3]
    const y = src.position[vi * 3 + 1]
    const z = src.position[vi * 3 + 2]
    const key = `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)},${slotOf[vi]}`
    let ci = cellIndex.get(key)
    if (ci === undefined) {
      ci = counts.length
      cellIndex.set(key, ci)
      sums.push(0, 0, 0)
      counts.push(0)
    }
    sums[ci * 3] += x
    sums[ci * 3 + 1] += y
    sums[ci * 3 + 2] += z
    counts[ci]++
    return ci
  }

  const vertexCluster = new Int32Array(src.position.length / 3).fill(-1)
  const clusterFor = (vi: number): number => {
    if (vertexCluster[vi] < 0) vertexCluster[vi] = clusterOf(vi)
    return vertexCluster[vi]
  }

  const groups: GeometryGroup[] = []
  const index: number[] = []
  for (const group of src.groups) {
    const start = index.length
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      const a = clusterFor(src.index[i])
      const b = clusterFor(src.index[i + 1])
      const c = clusterFor(src.index[i + 2])
      // A triangle whose corners land in fewer than three cells has no area
      // left — this is where the reduction actually happens.
      if (a === b || b === c || a === c) continue
      index.push(a, b, c)
    }
    if (index.length > start) {
      groups.push({ start, count: index.length - start, materialIndex: group.materialIndex })
    }
  }

  const vertexCount = counts.length
  const position = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const n = counts[i] || 1
    position[i * 3] = sums[i * 3] / n
    position[i * 3 + 1] = sums[i * 3 + 1] / n
    position[i * 3 + 2] = sums[i * 3 + 2] / n
  }

  // Area-weighted vertex normals. The source's split normals are meaningless
  // once corners have merged, and an un-normalised accumulation is what makes
  // a decimated silhouette shade like a soft solid instead of faceted noise.
  const normal = new Float32Array(vertexCount * 3)
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i] * 3
    const b = index[i + 1] * 3
    const c = index[i + 2] * 3
    const ux = position[b] - position[a]
    const uy = position[b + 1] - position[a + 1]
    const uz = position[b + 2] - position[a + 2]
    const vx = position[c] - position[a]
    const vy = position[c + 1] - position[a + 1]
    const vz = position[c + 2] - position[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const o of [a, b, c]) {
      normal[o] += nx
      normal[o + 1] += ny
      normal[o + 2] += nz
    }
  }
  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3
    const len = Math.hypot(normal[o], normal[o + 1], normal[o + 2])
    if (len > 1e-12) {
      normal[o] /= len
      normal[o + 1] /= len
      normal[o + 2] /= len
    } else {
      normal[o + 1] = 1
    }
  }

  return { position, normal, index: new Uint32Array(index), groups, mats: src.mats.slice() }
}
