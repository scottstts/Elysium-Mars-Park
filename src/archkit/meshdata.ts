/**
 * archkit/meshdata — the polygon authoring layer (ported from `friends`).
 *
 * This is the module that decides whether an object reads as a manufactured
 * part or as glued primitives. Three things make it work, and all three are
 * ports of `friends/src/lib/{mesh,mlib,molding}.ts` + `scenes/perk/geo.ts`:
 *
 *  1. **Author polygons, triangulate once.** `MeshData` holds quads and n-gons
 *     in world space. Triangulation happens exactly once, in `toTriangles()`.
 *  2. **Per-corner normals averaged inside a smooth angle.** A face corner
 *     averages only the adjacent faces whose normal is within the part's
 *     `smoothShade(angle)` of its own. Creases come out exact and free;
 *     `computeVertexNormals()` cannot do this and produces smeared edges.
 *  3. **Profiles, not primitives.** Silhouettes are 2-D point lists that get
 *     swept (`prism` / `loft` / `revolve` / `tubeAlong` / `runMolding`), so
 *     edge treatment lives in the profile instead of being retro-fitted.
 *
 * ## Axis convention — author Z-up, emit Y-up
 *
 * Every friends profile convention is Z-up: `prism` extrudes along Z,
 * `revolve` profiles are `(r, z)`, `tubeAlong`'s default up is `[0,0,1]`,
 * plan polygons are `(x, y)`. Those conventions are preserved **exactly** so
 * profile code ports 1:1 and `dev_docs/craft/geometry-craft.md` can be read
 * literally. The conversion to Mars Park's Y-up world happens once, at emit:
 *
 *     (x, y, z)  ->  (x, z, y)
 *
 * which is a mirror (det = -1), so every face winding is reversed to keep
 * normals outward. `toTriangles()` does this inline from `md.frame`; call
 * `toYUp(md)` yourself only when you need to keep transforming in world axes
 * after the conversion (it is idempotent and flips `frame`).
 *
 * Plan coordinates therefore map 1:1 onto world XZ, which is what
 * `world/parkPlan.ts` already uses.
 *
 * ## Emit
 *
 * Output is **non-indexed, position + normal (+ uv)**. No tangents: all relief
 * in this project is derivative bump, and binding a tangent-space normal map
 * would owe this geometry tangents. Roughly 2x the vertices of an indexed
 * weld, which is the correct trade for static merged geometry — it removes all
 * split-normal bookkeeping.
 *
 * Two sinks, freely mixed inside one assembly:
 *   - `writeInto(writer, slot, md)` pushes the shaded triangle soup into an
 *     existing `PartWriter` slot, so a builder can use `writer.box(...)` for
 *     trivial parts and `MeshData` for the parts that carry the object.
 *   - `buildGroup({slot: md}, materials)` returns a `Group` shaped exactly
 *     like `PartWriter.build()` for standalone assemblies.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, ShapeUtils, Vector2 } from 'three'
import type { Material } from 'three'
import type { PartWriter } from './writer'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export type Shading = { mode: 'flat' } | { mode: 'smooth'; angle: number }

export const TAU = Math.PI * 2

// --------------------------------------------------------------- craft constants

/**
 * Bevel radii by part class, measured across the 164 `bevel()` calls in the
 * reference build (`geometry-craft.md` §2.5). **There is no zero.** Segments
 * are 2 almost everywhere, 3 on a prominent corner.
 */
export const BEVEL = {
  /** hinges, hardware, casings, door leaves */
  hardware: 0.002,
  /** shelves, slats, panel edges, drawer fronts */
  panel: 0.004,
  /** plinths, carcasses, cornices, cast stone */
  carcass: 0.007,
  /** frames, aprons, machine bodies, tops */
  frame: 0.013,
  /** upholstered arms and backs */
  soft: 0.045,
} as const

/**
 * Smooth angles actually used in the reference build (217 calls). The angle is
 * the crease threshold — one wrong number turns a bullnose into a facet.
 */
export const SMOOTH = {
  /** lathes, tubes, turned parts (the default) */
  turned: 40,
  /** moulded slabs, slats, extruded sections */
  moulded: 34,
  /** upholstery and shells */
  shell: 45,
  /** cast iron, cast mineral */
  cast: 38,
  /** buttons, tight rolls */
  tight: 50,
  /** table and counter tops */
  top: 32,
} as const

/**
 * Joinery floors (`geometry-craft.md` §3). An applied part stands at least
 * `PROUD_MIN` proud of its host, or sits in a reveal between `REVEAL_MIN` and
 * `REVEAL_MAX`. Flush is forbidden. These sit deliberately *below* the audit's
 * 1.5 mm coplanar distance so intent and defect stay mechanically separable.
 */
export const PROUD_MIN = 0.0008
export const REVEAL_MIN = 0.0015
export const REVEAL_MAX = 0.006
/** Anything that should read as a gap at 2 m and cast a line. */
export const GAP_MIN = 0.004

// ------------------------------------------------------------------- MeshData

interface BoxProvenance {
  kind: 'box'
  bounds: [number, number, number, number, number, number]
}
interface PrismProvenance {
  kind: 'prism'
  poly: Vec2[]
  z0: number
  z1: number
}
type Provenance = BoxProvenance | PrismProvenance | null

export class MeshData {
  /** polygon vertices in world space (see the axis note in the file header) */
  verts: Vec3[] = []
  /** polygons — quads and n-gons, NOT triangles */
  faces: number[][] = []
  /** per-face-corner uvs, parallel to `faces` (or null for a face without) */
  uvs: (Vec2[] | null)[] | null = null
  /** per-vertex colour attribute (baked surface parameters / masks) */
  colors: Vec3[] | null = null
  colorName = ''
  shading: Shading = { mode: 'flat' }
  /** per-face material slot index, resolved against a slot-name list at emit */
  faceMat: number[] | null = null
  /** which authoring frame the vertices are in; emit converts 'z-up' -> Y-up */
  frame: 'z-up' | 'y-up' = 'z-up'
  /** lets `bevel()` regenerate the part rounded instead of chamfering it */
  provenance: Provenance = null

  static from(verts: Vec3[], faces: number[][]): MeshData {
    const m = new MeshData()
    m.verts = verts
    m.faces = faces
    return m
  }

  clone(): MeshData {
    const m = new MeshData()
    m.verts = this.verts.map((v) => [...v] as Vec3)
    m.faces = this.faces.map((f) => [...f])
    m.uvs = this.uvs ? this.uvs.map((u) => (u ? u.map((p) => [...p] as Vec2) : null)) : null
    m.colors = this.colors ? this.colors.map((c) => [...c] as Vec3) : null
    m.colorName = this.colorName
    m.shading = { ...this.shading }
    m.faceMat = this.faceMat ? [...this.faceMat] : null
    m.frame = this.frame
    m.provenance = null
    return m
  }
}

// ------------------------------------------------------------------- helpers

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}
function norm(a: Vec3): Vec3 {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Newell face normal (unnormalised — length is 2x the polygon area). */
export function faceNormal(verts: Vec3[], face: number[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < face.length; i++) {
    const a = verts[face[i]]
    const b = verts[face[(i + 1) % face.length]]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  return [nx, ny, nz]
}

/** Triangulate one polygon into index triples (indices into `face`). */
function triangulateFace(verts: Vec3[], face: number[]): [number, number, number][] {
  const n = face.length
  if (n === 3) return [[0, 1, 2]]
  if (n === 4) {
    // split along the shorter diagonal, like Blender's beauty default
    const d02 = len(sub(verts[face[0]], verts[face[2]]))
    const d13 = len(sub(verts[face[1]], verts[face[3]]))
    return d02 <= d13
      ? [
          [0, 1, 2],
          [0, 2, 3],
        ]
      : [
          [1, 2, 3],
          [1, 3, 0],
        ]
  }
  // n-gon: project on the dominant plane of the Newell normal and ear-clip
  const nrm = norm(faceNormal(verts, face))
  let u: Vec3 = Math.abs(nrm[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
  const w = norm(cross(nrm, u))
  u = norm(cross(w, nrm))
  const pts2 = face.map((vi) => {
    const p = verts[vi]
    return new Vector2(dot(p, u), dot(p, w))
  })
  const tris = ShapeUtils.triangulateShape(pts2, [])
  if (tris.length === 0) {
    const out: [number, number, number][] = []
    for (let i = 1; i < n - 1; i++) out.push([0, i, i + 1])
    return out
  }
  return tris as [number, number, number][]
}

// ---------------------------------------------------------------- transforms
// Helpers move VERTICES, not objects: there is no transform hierarchy, so
// merging is free and materials can read world position directly.

export function translate(m: MeshData, d: Vec3): MeshData {
  for (const v of m.verts) {
    v[0] += d[0]
    v[1] += d[1]
    v[2] += d[2]
  }
  m.provenance = null
  return m
}

export function rotateZ(m: MeshData, ang: number, pivot: Vec2 = [0, 0]): MeshData {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  for (const v of m.verts) {
    const x = v[0] - pivot[0]
    const y = v[1] - pivot[1]
    v[0] = pivot[0] + x * c - y * s
    v[1] = pivot[1] + x * s + y * c
  }
  m.provenance = null
  return m
}

export function rotX(m: MeshData, ang: number, pivot: Vec3 = [0, 0, 0]): MeshData {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  for (const v of m.verts) {
    const y = v[1] - pivot[1]
    const z = v[2] - pivot[2]
    v[1] = pivot[1] + y * c - z * s
    v[2] = pivot[2] + y * s + z * c
  }
  m.provenance = null
  return m
}

export function rotY(m: MeshData, ang: number, pivot: Vec3 = [0, 0, 0]): MeshData {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  for (const v of m.verts) {
    const x = v[0] - pivot[0]
    const z = v[2] - pivot[2]
    v[0] = pivot[0] + x * c + z * s
    v[2] = pivot[2] - x * s + z * c
  }
  m.provenance = null
  return m
}

export function scaleMesh(m: MeshData, s: number | Vec3, pivot: Vec3 = [0, 0, 0]): MeshData {
  const sv: Vec3 = typeof s === 'number' ? [s, s, s] : s
  for (const v of m.verts) {
    v[0] = pivot[0] + (v[0] - pivot[0]) * sv[0]
    v[1] = pivot[1] + (v[1] - pivot[1]) * sv[1]
    v[2] = pivot[2] + (v[2] - pivot[2]) * sv[2]
  }
  m.provenance = null
  return m
}

/** 4x4 row-major applied to positions. Negative determinant needs `recalcNormals`. */
export function transform4(m: MeshData, M: number[][]): MeshData {
  for (const v of m.verts) {
    const x = v[0]
    const y = v[1]
    const z = v[2]
    v[0] = M[0][0] * x + M[0][1] * y + M[0][2] * z + M[0][3]
    v[1] = M[1][0] * x + M[1][1] * y + M[1][2] * z + M[1][3]
    v[2] = M[2][0] * x + M[2][1] * y + M[2][2] * z + M[2][3]
  }
  m.provenance = null
  return m
}

/**
 * Place a **Y-up** part in the world the way `kit.ts` places writer boxes:
 * yaw about +Y with `+Z` forward, then translate. Determinant +1, so no
 * winding repair is needed. Use after `toYUp()`.
 */
export function placeYaw(m: MeshData, center: Vec3, yaw: number): MeshData {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const v of m.verts) {
    const x = v[0]
    const z = v[2]
    v[0] = center[0] + x * c + z * s
    v[1] = center[1] + v[1]
    v[2] = center[2] - x * s + z * c
  }
  m.provenance = null
  return m
}

export function join(parts: (MeshData | null | undefined)[]): MeshData {
  const list = parts.filter((p): p is MeshData => !!p)
  const out = new MeshData()
  if (list.length === 0) return out
  const anyUv = list.some((p) => p.uvs)
  const anyCol = list.some((p) => p.colors)
  const anyMat = list.some((p) => p.faceMat)
  if (anyUv) out.uvs = []
  if (anyCol) out.colors = []
  if (anyMat) out.faceMat = []
  out.frame = list[0].frame
  let shading: Shading = { mode: 'flat' }
  for (const p of list) {
    if (p.frame !== out.frame) throw new Error('join: parts must share an authoring frame')
    const base = out.verts.length
    for (const v of p.verts) out.verts.push([...v] as Vec3)
    for (let fi = 0; fi < p.faces.length; fi++) {
      out.faces.push(p.faces[fi].map((i) => i + base))
      if (anyUv) out.uvs!.push(p.uvs ? (p.uvs[fi] ?? null) : null)
      if (anyMat) out.faceMat!.push(p.faceMat ? p.faceMat[fi] : 0)
    }
    if (anyCol) {
      const cols = p.colors ?? p.verts.map(() => [1, 1, 1] as Vec3)
      for (const c of cols) out.colors!.push([...c] as Vec3)
      if (p.colorName) out.colorName = p.colorName
    }
    if (p.shading.mode === 'smooth') shading = p.shading
  }
  out.shading = shading
  return out
}

// ------------------------------------------------------------ normal repair

/**
 * Make winding consistent per connected component by edge traversal, then
 * orient each: **closed** components by signed volume, **open** ones by a
 * majority keep-score. Call after any mirror and any negative-determinant
 * `transform4`, and after hand-authoring a polygon set.
 */
export function recalcNormals(m: MeshData, flip = false): MeshData {
  const edgeMap = new Map<string, { face: number; fwd: boolean }[]>()
  const key = (a: number, b: number): string => (a < b ? a + '_' + b : b + '_' + a)
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      if (a === b) continue
      const k = key(a, b)
      let list = edgeMap.get(k)
      if (!list) {
        list = []
        edgeMap.set(k, list)
      }
      list.push({ face: fi, fwd: a < b })
    }
  })
  const flipped = new Array<boolean>(m.faces.length).fill(false)
  const visited = new Array<boolean>(m.faces.length).fill(false)
  const comps: number[][] = []
  for (let start = 0; start < m.faces.length; start++) {
    if (visited[start]) continue
    const comp: number[] = []
    const stack = [start]
    visited[start] = true
    while (stack.length) {
      const fi = stack.pop()!
      comp.push(fi)
      const f = m.faces[fi]
      for (let i = 0; i < f.length; i++) {
        const a = f[i]
        const b = f[(i + 1) % f.length]
        if (a === b) continue
        const pair = edgeMap.get(key(a, b))!
        if (pair.length !== 2) continue
        for (const o of pair) {
          if (o.face === fi || visited[o.face]) continue
          const self = pair.find((p) => p.face === fi)!
          // consistent orientation: the two faces must traverse the shared
          // edge in opposite directions, after any flips already applied
          const selfFwd = self.fwd !== flipped[fi]
          const otherFwd = o.fwd !== flipped[o.face]
          if (selfFwd === otherFwd) flipped[o.face] = !flipped[o.face]
          visited[o.face] = true
          stack.push(o.face)
        }
      }
    }
    comps.push(comp)
  }
  for (const comp of comps) {
    let closed = true
    for (const fi of comp) {
      const f = m.faces[fi]
      for (let i = 0; i < f.length; i++) {
        const a = f[i]
        const b = f[(i + 1) % f.length]
        if (a === b) continue
        if (edgeMap.get(key(a, b))!.length !== 2) {
          closed = false
          break
        }
      }
      if (!closed) break
    }
    let volume = 0
    let keepScore = 0
    for (const fi of comp) {
      const f = flipped[fi] ? [...m.faces[fi]].reverse() : m.faces[fi]
      const tris = triangulateFace(m.verts, f)
      for (const [i, j, k] of tris) {
        volume += dot(m.verts[f[i]], cross(m.verts[f[j]], m.verts[f[k]]))
      }
      keepScore += flipped[fi] ? -1 : 1
    }
    const flipComp = closed ? volume < 0 : keepScore < 0
    for (const fi of comp) {
      let doFlip = flipped[fi]
      if (flipComp) doFlip = !doFlip
      if (flip) doFlip = !doFlip
      if (doFlip) {
        m.faces[fi].reverse()
        if (m.uvs && m.uvs[fi]) m.uvs[fi]!.reverse()
      }
    }
  }
  return m
}

// ---------------------------------------------------------------- modifiers

/** Solidify with offset 0 plus a rim on the boundary edges. */
export function solidify(m: MeshData, thickness: number): MeshData {
  const half = thickness / 2
  const vnormals: Vec3[] = m.verts.map(() => [0, 0, 0])
  m.faces.forEach((f) => {
    const n = faceNormal(m.verts, f)
    for (const vi of f) {
      vnormals[vi][0] += n[0]
      vnormals[vi][1] += n[1]
      vnormals[vi][2] += n[2]
    }
  })
  const nrm = vnormals.map((v) => norm(v))
  const nv = m.verts.length
  const outer: Vec3[] = m.verts.map((v, i) => [
    v[0] + nrm[i][0] * half,
    v[1] + nrm[i][1] * half,
    v[2] + nrm[i][2] * half,
  ])
  const inner: Vec3[] = m.verts.map((v, i) => [
    v[0] - nrm[i][0] * half,
    v[1] - nrm[i][1] * half,
    v[2] - nrm[i][2] * half,
  ])
  const counts = new Map<string, [number, number, number]>()
  const key = (a: number, b: number): string => (a < b ? a + '_' + b : b + '_' + a)
  m.faces.forEach((f) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const k = key(a, b)
      const e = counts.get(k)
      if (e) e[2]++
      else counts.set(k, [a, b, 1])
    }
  })
  const faces: number[][] = []
  for (const f of m.faces) faces.push([...f])
  for (const f of m.faces) faces.push([...f].reverse().map((i) => i + nv))
  for (const [a, b, c] of counts.values()) {
    if (c === 1) faces.push([b, a, a + nv, b + nv])
  }
  m.verts = outer.concat(inner)
  m.faces = faces
  m.uvs = null
  m.faceMat = null
  m.provenance = null
  recalcNormals(m)
  return m
}

/** Catmull-Clark with the boundary rule (what a plump cushion needs). */
export function subsurf(m: MeshData, levels = 1): MeshData {
  for (let l = 0; l < levels; l++) ccOnce(m)
  m.provenance = null
  return m
}

function ccOnce(m: MeshData): void {
  const nv = m.verts.length
  const facePts: Vec3[] = []
  for (const f of m.faces) {
    const p: Vec3 = [0, 0, 0]
    for (const vi of f) {
      p[0] += m.verts[vi][0]
      p[1] += m.verts[vi][1]
      p[2] += m.verts[vi][2]
    }
    facePts.push([p[0] / f.length, p[1] / f.length, p[2] / f.length])
  }
  interface EdgeRec {
    a: number
    b: number
    faces: number[]
    idx: number
  }
  const edges = new Map<string, EdgeRec>()
  const key = (a: number, b: number): string => (a < b ? a + '_' + b : b + '_' + a)
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const k = key(a, b)
      let e = edges.get(k)
      if (!e) {
        e = { a, b, faces: [], idx: -1 }
        edges.set(k, e)
      }
      e.faces.push(fi)
    }
  })
  const edgePts: Vec3[] = []
  let ei = 0
  for (const e of edges.values()) {
    e.idx = ei++
    const va = m.verts[e.a]
    const vb = m.verts[e.b]
    if (e.faces.length === 2) {
      const fa = facePts[e.faces[0]]
      const fb = facePts[e.faces[1]]
      edgePts.push([
        (va[0] + vb[0] + fa[0] + fb[0]) / 4,
        (va[1] + vb[1] + fa[1] + fb[1]) / 4,
        (va[2] + vb[2] + fa[2] + fb[2]) / 4,
      ])
    } else {
      edgePts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])
    }
  }
  const vFaces: number[][] = Array.from({ length: nv }, () => [])
  m.faces.forEach((f, fi) => {
    for (const vi of f) vFaces[vi].push(fi)
  })
  const vEdges: EdgeRec[][] = Array.from({ length: nv }, () => [])
  for (const e of edges.values()) {
    vEdges[e.a].push(e)
    vEdges[e.b].push(e)
  }
  const newVerts: Vec3[] = m.verts.map((v, vi) => {
    const boundary = vEdges[vi].filter((e) => e.faces.length === 1)
    if (boundary.length > 0) {
      let sx = v[0] * 6
      let sy = v[1] * 6
      let sz = v[2] * 6
      let cnt = 6
      for (const e of boundary) {
        const o = e.a === vi ? m.verts[e.b] : m.verts[e.a]
        sx += o[0]
        sy += o[1]
        sz += o[2]
        cnt += 1
      }
      return [sx / cnt, sy / cnt, sz / cnt] as Vec3
    }
    const nf = vFaces[vi].length
    if (nf === 0) return [...v] as Vec3
    const F: Vec3 = [0, 0, 0]
    for (const fi of vFaces[vi]) {
      F[0] += facePts[fi][0]
      F[1] += facePts[fi][1]
      F[2] += facePts[fi][2]
    }
    F[0] /= nf
    F[1] /= nf
    F[2] /= nf
    const R: Vec3 = [0, 0, 0]
    const ne = vEdges[vi].length
    for (const e of vEdges[vi]) {
      R[0] += (m.verts[e.a][0] + m.verts[e.b][0]) / 2
      R[1] += (m.verts[e.a][1] + m.verts[e.b][1]) / 2
      R[2] += (m.verts[e.a][2] + m.verts[e.b][2]) / 2
    }
    R[0] /= ne
    R[1] /= ne
    R[2] /= ne
    const n = ne
    return [
      (F[0] + 2 * R[0] + (n - 3) * v[0]) / n,
      (F[1] + 2 * R[1] + (n - 3) * v[1]) / n,
      (F[2] + 2 * R[2] + (n - 3) * v[2]) / n,
    ] as Vec3
  })
  const verts: Vec3[] = [...newVerts, ...facePts, ...edgePts]
  const faceBase = nv
  const edgeBase = nv + facePts.length
  const faces: number[][] = []
  m.faces.forEach((f, fi) => {
    const n = f.length
    for (let i = 0; i < n; i++) {
      const v0 = f[i]
      const ePrev = edges.get(key(f[(i - 1 + n) % n], v0))!
      const eNext = edges.get(key(v0, f[(i + 1) % n]))!
      faces.push([v0, edgeBase + eNext.idx, faceBase + fi, edgeBase + ePrev.idx])
    }
  })
  m.verts = verts
  m.faces = faces
  m.uvs = null
  m.colors = null
  m.faceMat = null
}

// -------------------------------------------------------------- 2-D profiles

/** CCW rounded rectangle centred on the origin. The workhorse profile. */
export function roundedRect(w: number, h: number, r: number, seg = 6): Vec2[] {
  const rr = Math.min(r, Math.min(w, h) * 0.5 - 1e-6)
  const hw = w * 0.5 - rr
  const hh = h * 0.5 - rr
  const pts: Vec2[] = []
  const corners: [number, number, number][] = [
    [hw, hh, 0],
    [-hw, hh, Math.PI * 0.5],
    [-hw, -hh, Math.PI],
    [hw, -hh, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + Math.PI * 0.5 * (k / seg)
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
    }
  }
  return pts
}

/** CCW rectangle with 45-degree corner chamfers (machined plate, cover). */
export function chamferRect(w: number, h: number, c: number): Vec2[] {
  const cc = Math.min(c, Math.min(w, h) * 0.5 - 1e-6)
  const hw = w * 0.5
  const hh = h * 0.5
  return [
    [hw, hh - cc],
    [hw - cc, hh],
    [-hw + cc, hh],
    [-hw, hh - cc],
    [-hw, -hh + cc],
    [-hw + cc, -hh],
    [hw - cc, -hh],
    [hw, -hh + cc],
  ]
}

export function circle(r: number, seg = 32, cx = 0, cy = 0, phase = 0): Vec2[] {
  return Array.from(
    { length: seg },
    (_, i) => [cx + r * Math.cos(phase + (TAU * i) / seg), cy + r * Math.sin(phase + (TAU * i) / seg)] as Vec2,
  )
}

export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 8, skipFirst = false): Vec2[] {
  const out: Vec2[] = []
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

export function bez(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n = 8, skipFirst = false): Vec2[] {
  const out: Vec2[] = []
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    out.push([
      mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
      mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
    ])
  }
  return out
}

export function polyArea(poly: Vec2[]): number {
  let s = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % n]
    s += x0 * y1 - x1 * y0
  }
  return s * 0.5
}

/** Normalise a plan outline to counter-clockwise so offsets go outward. */
export function ccw(poly: Vec2[]): Vec2[] {
  return polyArea(poly) > 0 ? [...poly] : [...poly].reverse()
}

/**
 * Offset a CCW polygon **outward** by d with true edge-normal mitres. Every
 * reveal, bullnose, fielded panel and chamfered plan-form is this applied at
 * several z levels and lofted. The mitre scale is clamped so a sharp corner
 * cannot throw a spike.
 */
export function polyOffset(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]
    const b = poly[i]
    const c = poly[(i + 1) % n]
    let e0x = b[0] - a[0]
    let e0y = b[1] - a[1]
    let e1x = c[0] - b[0]
    let e1y = c[1] - b[1]
    const l0 = Math.hypot(e0x, e0y) || 1
    const l1 = Math.hypot(e1x, e1y) || 1
    e0x /= l0
    e0y /= l0
    e1x /= l1
    e1y /= l1
    const n0: Vec2 = [e0y, -e0x]
    const n1: Vec2 = [e1y, -e1x]
    let mx = n0[0] + n1[0]
    let my = n0[1] + n1[1]
    const ml = Math.hypot(mx, my)
    if (ml < 1e-9) {
      mx = n0[0]
      my = n0[1]
    } else {
      mx /= ml
      my /= ml
    }
    const scale = 1 / Math.max(0.25, mx * n0[0] + my * n0[1])
    out.push([b[0] + mx * d * scale, b[1] + my * d * scale])
  }
  return out
}

/** Inward-positive twin of `polyOffset` (the one the bevels use). */
export function insetPoly(poly: Vec2[], d: number): Vec2[] {
  return polyOffset(poly, -d)
}

/**
 * Offset an open or closed polyline to its RIGHT-hand side by d, mitring at
 * true segment intersections (the moulding/wall-datum offset).
 */
export function offsetPolyline(pts: Vec2[], d: number, closed = false): Vec2[] {
  const isect = (a0: Vec2, u0: Vec2, b0: Vec2, u1: Vec2): Vec2 => {
    const den = u0[0] * -u1[1] - u0[1] * -u1[0]
    if (Math.abs(den) < 1e-9) return b0
    const wx = b0[0] - a0[0]
    const wy = b0[1] - a0[1]
    const tt = (wx * -u1[1] - wy * -u1[0]) / den
    return [a0[0] + u0[0] * tt, a0[1] + u0[1] * tt]
  }
  const P = pts
  const n = P.length
  const segs: [Vec2, Vec2, Vec2][] = []
  const m = closed ? n : n - 1
  for (let i = 0; i < m; i++) {
    const a = P[i]
    const b = P[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    const u: Vec2 = [dx / l, dy / l]
    const nn: Vec2 = [u[1], -u[0]] // right of travel
    segs.push([
      [a[0] + nn[0] * d, a[1] + nn[1] * d],
      [b[0] + nn[0] * d, b[1] + nn[1] * d],
      u,
    ])
  }
  const out: Vec2[] = []
  if (closed) {
    for (let i = 0; i < n; i++) {
      const sp = segs[(i - 1 + m) % m]
      const sc = segs[i % m]
      out.push(isect(sp[0], sp[2], sc[0], sc[2]))
    }
  } else {
    out.push(segs[0][0])
    for (let i = 0; i < segs.length - 1; i++) out.push(isect(segs[i][0], segs[i][2], segs[i + 1][0], segs[i + 1][2]))
    out.push(segs[segs.length - 1][1])
  }
  return out
}

/**
 * Insert a point d before and d after every interior corner so a swept
 * profile's mitre stays **confined to the corner** instead of twisting the
 * whole run. Run this on any path before `tubeAlong` with a wide profile.
 */
export function densify(pts: Vec3[], d = 0.05): Vec3[] {
  const out: Vec3[] = [[...pts[0]] as Vec3]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const din: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const dout: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
    const li = len(din)
    const lo = len(dout)
    if (li > 2.5 * d) out.push([b[0] - (din[0] / li) * d, b[1] - (din[1] / li) * d, b[2] - (din[2] / li) * d])
    out.push([...b] as Vec3)
    if (lo > 2.5 * d) out.push([b[0] + (dout[0] / lo) * d, b[1] + (dout[1] / lo) * d, b[2] + (dout[2] / lo) * d])
  }
  out.push([...pts[pts.length - 1]] as Vec3)
  return out
}

// ------------------------------------------------------------------- solids

export function meshObj(verts: Vec3[], faces: number[][]): MeshData {
  return MeshData.from(
    verts.map((v) => [...v] as Vec3),
    faces.map((f) => [...f]),
  )
}

/** Axis-aligned box, 8 verts / 6 quads, marked so `bevel()` can round it. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MeshData {
  const v: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
  const f = [
    [3, 2, 1, 0],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]
  const m = MeshData.from(v, f)
  markBox(m, [x0, y0, z0, x1, y1, z1])
  return m
}

/** Extrude a closed 2-D polygon (CCW, in XY) between two z levels. */
export function prism(poly: Vec2[], z0: number, z1: number, flip = false): MeshData {
  const n = poly.length
  const verts: Vec3[] = []
  for (const p of poly) verts.push([p[0], p[1], z0])
  for (const p of poly) verts.push([p[0], p[1], z1])
  const faces: number[][] = [
    Array.from({ length: n }, (_, i) => n - 1 - i),
    Array.from({ length: n }, (_, i) => n + i),
  ]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    faces.push([i, j, j + n, i + n])
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m, flip)
  markPrism(m, poly, z0, z1)
  return m
}

/** Extrude a closed 2-D polygon given in (x, z) along Y — a section part. */
export function prismXZ(poly: Vec2[], y0: number, y1: number): MeshData {
  const n = poly.length
  const verts: Vec3[] = []
  for (const p of poly) verts.push([p[0], y0, p[1]])
  for (const p of poly) verts.push([p[0], y1, p[1]])
  const faces: number[][] = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, i) => 2 * n - 1 - i),
  ]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    faces.push([i, j, j + n, i + n])
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  return m
}

/** Extrude a closed 2-D polygon given in (y, z) along X — a section part. */
export function prismYZ(poly: Vec2[], x0: number, x1: number): MeshData {
  const n = poly.length
  const verts: Vec3[] = []
  for (const p of poly) verts.push([x0, p[0], p[1]])
  for (const p of poly) verts.push([x1, p[0], p[1]])
  const faces: number[][] = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, i) => 2 * n - 1 - i),
  ]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    faces.push([i, j, j + n, i + n])
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  return m
}

export type Hole = [number, number, number, number]

/**
 * Flat panel in the XZ plane (y = 0..thickness) with rectangular openings,
 * built as a **welded vertex grid** — the boolean replacement. Coordinate
 * lists come from the union of all hole edges; only solid cells are emitted,
 * and a reveal quad is emitted exactly where a neighbouring cell is missing,
 * so the jambs are real geometry with no cracks and no coincident faces.
 */
export function panelWithHoles(w: number, h: number, thickness: number, holes: Hole[] = []): MeshData {
  const xsSet = new Set<number>([0, w])
  const zsSet = new Set<number>([0, h])
  for (const hh of holes) {
    xsSet.add(hh[0])
    xsSet.add(hh[2])
    zsSet.add(hh[1])
    zsSet.add(hh[3])
  }
  const xs = [...xsSet].sort((a, b) => a - b)
  const zs = [...zsSet].sort((a, b) => a - b)
  const nx = xs.length - 1
  const nz = zs.length - 1
  const solid = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false
    const cx0 = xs[i]
    const cx1 = xs[i + 1]
    const cz0 = zs[j]
    const cz1 = zs[j + 1]
    for (const [a, b, c, d] of holes) {
      if (a - 1e-6 <= cx0 && cx1 <= c + 1e-6 && b - 1e-6 <= cz0 && cz1 <= d + 1e-6) return false
    }
    return true
  }
  const idx = new Map<string, number>()
  const verts: Vec3[] = []
  const vid = (i: number, j: number, side: number): number => {
    const k = `${i}_${j}_${side}`
    let r = idx.get(k)
    if (r === undefined) {
      r = verts.length
      verts.push([xs[i], side ? thickness : 0, zs[j]])
      idx.set(k, r)
    }
    return r
  }
  const faces: number[][] = []
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!solid(i, j)) continue
      const a = vid(i, j, 0)
      const b = vid(i + 1, j, 0)
      const c = vid(i + 1, j + 1, 0)
      const d = vid(i, j + 1, 0)
      faces.push([a, b, c, d])
      const a2 = vid(i, j, 1)
      const b2 = vid(i + 1, j, 1)
      const c2 = vid(i + 1, j + 1, 1)
      const d2 = vid(i, j + 1, 1)
      faces.push([d2, c2, b2, a2])
      if (!solid(i, j - 1)) faces.push([b, a, a2, b2])
      if (!solid(i, j + 1)) faces.push([d, c, c2, d2])
      if (!solid(i - 1, j)) faces.push([a, d, d2, a2])
      if (!solid(i + 1, j)) faces.push([c, b, b2, c2])
    }
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  return m
}

/**
 * A straight wall/plate between two plan points as ONE welded solid.
 * `t` is measured **from** the p0->p1 line towards `side` (+1 = left of
 * travel) so the inner face lands exactly on its layout line and nothing has
 * to be nudged afterwards. `holes` are (u0, u1, z0, z1) along the run.
 */
export function wallRun(
  p0: Vec2,
  p1: Vec2,
  t: number,
  z0: number,
  z1: number,
  holes: Hole[] = [],
  side = 1,
  cap0 = true,
  cap1 = true,
): MeshData {
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  const nx = -uy * t * side
  const ny = ux * t * side

  const q = (v: number): number => Math.round(v * 1e5) / 1e5
  const snapped = holes.map((hh) => hh.map(q) as Hole)
  const us = [...new Set([q(0), q(length), ...snapped.flatMap((hh) => [hh[0], hh[1]])])].sort((a, b) => a - b)
  const zs = [...new Set([q(z0), q(z1), ...snapped.flatMap((hh) => [hh[2], hh[3]])])].sort((a, b) => a - b)
  const nu = us.length - 1
  const nz = zs.length - 1

  const solid = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nu || j >= nz) return false
    const u0 = us[i]
    const u1 = us[i + 1]
    const c0 = zs[j]
    const c1 = zs[j + 1]
    for (const [a, b, e, f] of snapped) {
      if (a - 1e-6 <= u0 && u1 <= b + 1e-6 && e - 1e-6 <= c0 && c1 <= f + 1e-6) return false
    }
    return true
  }

  const verts: Vec3[] = []
  const idx = new Map<string, number>()
  const vid = (i: number, j: number, s: number): number => {
    const k = `${i}_${j}_${s}`
    let r = idx.get(k)
    if (r === undefined) {
      r = verts.length
      verts.push([p0[0] + ux * us[i] + (s ? nx : 0), p0[1] + uy * us[i] + (s ? ny : 0), zs[j]])
      idx.set(k, r)
    }
    return r
  }

  const faces: number[][] = []
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nz; j++) {
      if (!solid(i, j)) continue
      const a = vid(i, j, 0)
      const b = vid(i + 1, j, 0)
      const c = vid(i + 1, j + 1, 0)
      const e = vid(i, j + 1, 0)
      faces.push([a, b, c, e])
      const a2 = vid(i, j, 1)
      const b2 = vid(i + 1, j, 1)
      const c2 = vid(i + 1, j + 1, 1)
      const e2 = vid(i, j + 1, 1)
      faces.push([e2, c2, b2, a2])
      if (!solid(i, j - 1)) faces.push([b, a, a2, b2])
      if (!solid(i, j + 1)) faces.push([e, c, c2, e2])
      if (!solid(i - 1, j) && (i > 0 || cap0)) faces.push([a, e, e2, a2])
      if (!solid(i + 1, j) && (i < nu - 1 || cap1)) faces.push([c, b, b2, c2])
    }
  }
  const md = MeshData.from(verts, faces)
  recalcNormals(md)
  return md
}

// -------------------------------------------------------------------- sweeps

export interface LoftOpts {
  closeU?: boolean
  closeV?: boolean
  weldPoles?: boolean
  capStart?: boolean
  capEnd?: boolean
}

/**
 * The engine every sweep funnels into. Three guarantees make it safe:
 *  - `weldPoles` collapses on-axis ring ends into ONE vertex, not n coincident
 *    ones (the lathe pole-fan defect);
 *  - degenerate quads are dropped by de-duplicating the four corner indices;
 *  - cap logic distinguishes revolve-style (u sweeps) from stacked-ring style
 *    (v wraps), so a cap is a real n-gon on the right loop.
 */
export function loft(rings: Vec3[][], opts: LoftOpts = {}): MeshData {
  const { closeU = false, closeV = false, weldPoles = false, capStart = false, capEnd = false } = opts
  const nu = rings.length
  const nv = rings[0].length
  const verts: Vec3[] = []
  const grid: number[][] = []
  let poleA = -1
  let poleB = -1
  for (let i = 0; i < nu; i++) {
    const row: number[] = []
    for (let j = 0; j < nv; j++) {
      const p = rings[i][j]
      if (weldPoles && j === 0 && Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9) {
        if (poleA < 0) {
          poleA = verts.length
          verts.push([...p] as Vec3)
        }
        row.push(poleA)
        continue
      }
      if (weldPoles && j === nv - 1 && Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9) {
        if (poleB < 0) {
          poleB = verts.length
          verts.push([...p] as Vec3)
        }
        row.push(poleB)
        continue
      }
      row.push(verts.length)
      verts.push([...p] as Vec3)
    }
    grid.push(row)
  }
  const faces: number[][] = []
  const ulim = closeU ? nu : nu - 1
  const vlim = closeV ? nv : nv - 1
  for (let i = 0; i < ulim; i++) {
    const i2 = (i + 1) % nu
    for (let j = 0; j < vlim; j++) {
      const j2 = (j + 1) % nv
      const q = [grid[i][j], grid[i2][j], grid[i2][j2], grid[i][j2]]
      const uq: number[] = []
      for (const k of q) if (!uq.includes(k)) uq.push(k)
      if (uq.length >= 3) faces.push(uq)
    }
  }
  if (closeU && !closeV) {
    // revolve-style: u sweeps around, v is the profile -> cap the profile ends
    if (capStart && grid[0][0] !== grid[1][0]) faces.push(Array.from({ length: nu }, (_, k) => grid[nu - 1 - k][0]))
    if (capEnd && grid[0][nv - 1] !== grid[1][nv - 1]) faces.push(Array.from({ length: nu }, (_, k) => grid[k][nv - 1]))
  } else if (closeV && !closeU) {
    // stacked-ring style: v wraps around, u steps through levels
    if (capStart) faces.push(Array.from({ length: nv }, (_, j) => grid[0][nv - 1 - j]))
    if (capEnd) faces.push(Array.from({ length: nv }, (_, j) => grid[nu - 1][j]))
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  return m
}

export interface RevolveOpts {
  arc?: number
  capStart?: boolean
  capEnd?: boolean
  close?: boolean
  /** post-rotate the result so the axis is X or Y instead of Z */
  axis?: 'x' | 'y' | 'z'
  smooth?: number
}

/** Sweep a `(r, z)` profile around the Z axis. Poles weld, ends can cap. */
export function revolve(profile: Vec2[], segments = 32, opts: RevolveOpts = {}): MeshData {
  const { arc = TAU, capStart = true, capEnd = true, axis = 'z', smooth = SMOOTH.turned } = opts
  const close = opts.close ?? Math.abs(arc - TAU) < 1e-6
  const nseg = close ? segments : segments + 1
  const rings: Vec3[][] = []
  for (let s = 0; s < nseg; s++) {
    const a = arc * (s / segments)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    rings.push(profile.map(([r, z]) => [r * ca, r * sa, z] as Vec3))
  }
  const m = loft(rings, { closeU: close, weldPoles: true, capStart, capEnd })
  if (axis === 'x') rotY(m, Math.PI / 2)
  else if (axis === 'y') rotX(m, -Math.PI / 2)
  smoothShade(m, smooth)
  return m
}

export interface TubeOpts {
  closePath?: boolean
  up?: Vec3
  cap?: boolean
  /**
   * Scale the profile's across-axis by 1/cos at interior corners so the
   * section keeps a constant apparent width through a bend.
   */
  miter?: boolean
  /** per-station roll about the path tangent, radians (number or per-point) */
  roll?: number | number[]
  /** per-station profile scale `[across, along-normal]` (sweepVar) */
  scale?: Vec2[]
}

/**
 * Sweep a closed 2-D profile `(across, along-normal)` along a 3-D path.
 * Run `densify()` on the path first when the profile is wide, so the mitre
 * stays confined to each corner.
 */
export function tubeAlong(path: Vec3[], profile: Vec2[], opts: TubeOpts = {}): MeshData {
  const { closePath = false, up = [0, 0, 1] as Vec3, cap = true, miter = false, roll, scale } = opts
  const P = path
  const n = P.length
  // Tangents first (central differences), then ROTATION-MINIMISING frames by
  // double reflection. The old per-station `cross(t, up)` frame flipped or
  // spun wherever the tangent swung past the up axis — on any path that curls
  // (handrail returns, stair rails meeting landings) adjacent rings rotated
  // against each other and the loft sheared into a pinched twist (owner
  // defect: kinked rail elbows, ribbon-twisted stair rails). `up` now seeds
  // only the FIRST frame; every later frame is the previous one transported
  // along the path with zero twist, and a closed path distributes the wrap
  // mismatch so the seam ring still matches.
  const tangents: Vec3[] = []
  for (let i = 0; i < n; i++) {
    let t: Vec3
    if (i === 0) {
      t = closePath
        ? [P[1][0] - P[n - 1][0], P[1][1] - P[n - 1][1], P[1][2] - P[n - 1][2]]
        : [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]]
    } else if (i === n - 1) {
      t = closePath
        ? [P[0][0] - P[n - 2][0], P[0][1] - P[n - 2][1], P[0][2] - P[n - 2][2]]
        : [P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1], P[n - 1][2] - P[n - 2][2]]
    } else {
      t = [P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1], P[i + 1][2] - P[i - 1][2]]
    }
    const tl = len(t) || 1
    tangents.push([t[0] / tl, t[1] / tl, t[2] / tl])
  }
  const sides: Vec3[] = []
  {
    let u: Vec3 = [...up] as Vec3
    if (Math.abs(dot(tangents[0], u)) > 0.999) u = [1, 0, 0]
    sides.push(norm(cross(tangents[0], u)))
  }
  const reflect = (v: Vec3, mirror: Vec3): Vec3 => {
    const c = dot(mirror, mirror)
    if (c < 1e-12) return v
    const k = (2 / c) * dot(mirror, v)
    return [v[0] - mirror[0] * k, v[1] - mirror[1] * k, v[2] - mirror[2] * k]
  }
  for (let i = 1; i < n; i++) {
    const v1: Vec3 = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]]
    const sL = reflect(sides[i - 1], v1)
    const tL = reflect(tangents[i - 1], v1)
    const v2: Vec3 = [tangents[i][0] - tL[0], tangents[i][1] - tL[1], tangents[i][2] - tL[2]]
    sides.push(norm(reflect(sL, v2)))
  }
  // Closed path: transport once more across the wrap; the angle between the
  // transported frame and the start frame is the accumulated twist, unwound
  // linearly so ring 0 and ring n meet exactly.
  const twist: number[] = new Array(n).fill(0)
  if (closePath && n > 2) {
    const v1: Vec3 = [P[0][0] - P[n - 1][0], P[0][1] - P[n - 1][1], P[0][2] - P[n - 1][2]]
    const sL = reflect(sides[n - 1], v1)
    const tL = reflect(tangents[n - 1], v1)
    const v2: Vec3 = [tangents[0][0] - tL[0], tangents[0][1] - tL[1], tangents[0][2] - tL[2]]
    const sWrap = norm(reflect(sL, v2))
    // Angle from sides[0] to the wrapped-around frame, about the start tangent.
    const uRef = norm(cross(sides[0], tangents[0]))
    const angle = Math.atan2(dot(sWrap, uRef), dot(sWrap, sides[0]))
    for (let i = 0; i < n; i++) twist[i] = -angle * (i / n)
  }
  const rings: Vec3[][] = []
  for (let i = 0; i < n; i++) {
    const t = tangents[i]
    let s = sides[i]
    let u2 = norm(cross(s, t))
    const rl =
      (typeof roll === 'number' ? roll : roll ? roll[Math.min(i, roll.length - 1)] : 0) + twist[i]
    if (rl) {
      const c = Math.cos(rl)
      const sn = Math.sin(rl)
      const s2: Vec3 = [s[0] * c + u2[0] * sn, s[1] * c + u2[1] * sn, s[2] * c + u2[2] * sn]
      u2 = [u2[0] * c - s[0] * sn, u2[1] * c - s[1] * sn, u2[2] * c - s[2] * sn]
      s = s2
    }
    let ka = 1
    let kb = 1
    if (scale) {
      const sc = scale[Math.min(i, scale.length - 1)]
      ka = sc[0]
      kb = sc[1]
    }
    if (miter && (closePath || (i > 0 && i < n - 1))) {
      const p = P[(i - 1 + n) % n]
      const e: Vec3 = [P[i][0] - p[0], P[i][1] - p[1], P[i][2] - p[2]]
      const el = len(e)
      if (el > 1e-9) ka /= Math.max(0.4, (e[0] * t[0] + e[1] * t[1] + e[2] * t[2]) / el)
    }
    rings.push(
      profile.map(
        ([a, b]) =>
          [
            P[i][0] + s[0] * a * ka + u2[0] * b * kb,
            P[i][1] + s[1] * a * ka + u2[1] * b * kb,
            P[i][2] + s[2] * a * ka + u2[2] * b * kb,
          ] as Vec3,
      ),
    )
  }
  return loft(rings, {
    closeU: closePath,
    closeV: true,
    capStart: cap && !closePath,
    capEnd: cap && !closePath,
  })
}

/**
 * Mitred rectangular frame (picture frame / panel moulding / casing).
 * `profile` is `(a, b)`: a = outward offset in the frame plane, b = offset
 * along the frame normal. The frame lies in XZ centred on the origin, +Y normal.
 */
export function sweepRectFrame(w: number, h: number, profile: Vec2[]): MeshData {
  const hw = w * 0.5
  const hh = h * 0.5
  const corners: Vec2[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
  const dirs: Vec2[] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const rings: Vec3[][] = []
  for (let k = 0; k < 4; k++) {
    const [cx, cz] = corners[k]
    const [sx, sz] = dirs[k]
    rings.push(profile.map(([a, b]) => [cx + sx * a, b, cz + sz * a] as Vec3))
  }
  return loft(rings, { closeU: true, closeV: true })
}

/** Sweep a profile around a closed loop lying in the XY plane (plan sweep). */
export function sweepPlanarLoop(path: Vec2[], profile: Vec2[], close = true): MeshData {
  const n = path.length
  const rings: Vec3[][] = []
  for (let i = 0; i < n; i++) {
    const a = path[(i - 1 + n) % n]
    const b = path[(i + 1) % n]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = ty // outward for CCW in XY
    const ny = -tx
    rings.push(profile.map(([aa, bb]) => [path[i][0] + nx * aa, path[i][1] + ny * aa, bb] as Vec3))
  }
  return loft(rings, { closeU: close, closeV: true })
}

/**
 * Sweep a closed profile `[(z, depth), ...]` along a plan path, mitring every
 * profile level on its own offset line. Interior is on the RIGHT of travel.
 */
export function runMolding(path: Vec2[], profile: Vec2[], cap = true, closed = false): MeshData {
  const offs = new Map<number, Vec2[]>()
  for (const [, d] of profile) {
    if (!offs.has(d)) offs.set(d, offsetPolyline(path, d, closed))
  }
  const rings: Vec3[][] = []
  for (let i = 0; i < path.length; i++) {
    rings.push(
      profile.map(([z, d]) => {
        const p = offs.get(d)![i]
        return [p[0], p[1], z] as Vec3
      }),
    )
  }
  return loft(rings, {
    closeU: closed,
    closeV: true,
    capStart: cap && !closed,
    capEnd: cap && !closed,
  })
}

// ------------------------------------------------------------ edge treatment

/**
 * A **true fillet**, not a 45-degree cut: per-axis knots spaced by
 * `tan(pi/4 * k/s)` concentrate the grid on the arc, points are clamped and
 * projected onto the rounded box, and shared edge points weld by an exact
 * quantised key. Ships smooth at 40 degrees.
 */
export function roundedBoxMesh(
  bounds: [number, number, number, number, number, number],
  radius: number,
  segments: number,
): MeshData {
  const [x0, y0, z0, x1, y1, z1] = bounds
  const h: Vec3 = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]
  const c: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
  const r = Math.min(radius, Math.min(h[0], h[1], h[2]) * 0.999)
  const s = Math.max(1, segments)
  const knots = (hh: number): number[] => {
    const inner = hh - r
    const out: number[] = []
    for (let k = s; k >= 0; k--) out.push(-(inner + r * Math.tan((Math.PI / 4) * (k / s))))
    for (let k = 0; k <= s; k++) out.push(inner + r * Math.tan((Math.PI / 4) * (k / s)))
    return out
  }
  const ax = [knots(h[0]), knots(h[1]), knots(h[2])]
  const inner: Vec3 = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0), Math.max(h[2] - r, 0)]
  const project = (p: Vec3): Vec3 => {
    const q: Vec3 = [
      Math.min(Math.max(p[0], -inner[0]), inner[0]),
      Math.min(Math.max(p[1], -inner[1]), inner[1]),
      Math.min(Math.max(p[2], -inner[2]), inner[2]),
    ]
    const d = sub(p, q)
    const l = len(d)
    if (l < 1e-12) return p
    return [q[0] + (d[0] / l) * r, q[1] + (d[1] / l) * r, q[2] + (d[2] / l) * r]
  }
  const vmap = new Map<string, number>()
  const verts: Vec3[] = []
  const faces: number[][] = []
  const vid = (p: Vec3): number => {
    const k = p.map((x) => Math.round(x * 1e7)).join('_')
    let idx = vmap.get(k)
    if (idx === undefined) {
      idx = verts.length
      verts.push([p[0] + c[0], p[1] + c[1], p[2] + c[2]])
      vmap.set(k, idx)
    }
    return idx
  }
  const AXES: [number, number, number][] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ]
  for (const [a, u, v] of AXES) {
    for (const sign of [-1, 1]) {
      const gu = ax[u]
      const gv = ax[v]
      for (let i = 0; i < gu.length - 1; i++) {
        for (let j = 0; j < gv.length - 1; j++) {
          const mk = (uu: number, vv: number): number => {
            const p: Vec3 = [0, 0, 0]
            p[a] = sign * h[a]
            p[u] = uu
            p[v] = vv
            return vid(project(p))
          }
          const q = [mk(gu[i], gv[j]), mk(gu[i + 1], gv[j]), mk(gu[i + 1], gv[j + 1]), mk(gu[i], gv[j + 1])]
          if (sign < 0) q.reverse()
          const uq = q.filter((x, k) => q.indexOf(x) === k)
          if (uq.length >= 3) faces.push(uq)
        }
      }
    }
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  m.shading = { mode: 'smooth', angle: SMOOTH.turned }
  return m
}

/** Prism with genuinely rounded top and bottom rims (glass tops, coping, pads). */
export function beveledPrismMesh(poly: Vec2[], z0: number, z1: number, r: number, segments: number): MeshData {
  const s = Math.max(1, segments)
  const rr = Math.min(r, (z1 - z0) / 2 - 1e-5)
  const rings: Vec3[][] = []
  const ringAt = (inset: number, z: number): Vec3[] => insetPoly(poly, inset).map((p) => [p[0], p[1], z] as Vec3)
  for (let k = 0; k <= s; k++) {
    const a = (Math.PI / 2) * (k / s)
    rings.push(ringAt(rr * (1 - Math.sin(a)), z0 + rr * (1 - Math.cos(a))))
  }
  for (let k = 0; k <= s; k++) {
    const a = (Math.PI / 2) * (k / s)
    rings.push(ringAt(rr * (1 - Math.cos(a)), z1 - rr * (1 - Math.sin(a))))
  }
  const n = poly.length
  const verts: Vec3[] = []
  const faces: number[][] = []
  for (const ring of rings) for (const p of ring) verts.push(p)
  const nr = rings.length
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n
      faces.push([i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j])
    }
  }
  faces.push(Array.from({ length: n }, (_, j) => n - 1 - j))
  faces.push(Array.from({ length: n }, (_, j) => (nr - 1) * n + j))
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  m.shading = { mode: 'smooth', angle: SMOOTH.turned }
  return m
}

/**
 * Regenerate a box or z-prism with a real radius. Anything else already
 * carries its edge treatment in its profile and is returned untouched.
 * **The default is never zero** — see `BEVEL`.
 */
export function bevel(m: MeshData, amount: number = BEVEL.panel, segments = 2): MeshData {
  if (m.provenance?.kind === 'box') {
    const nm = roundedBoxMesh(m.provenance.bounds, amount, segments)
    m.verts = nm.verts
    m.faces = nm.faces
    m.shading = nm.shading
    m.provenance = null
  } else if (m.provenance?.kind === 'prism' && amount >= 0.0005) {
    const p = m.provenance
    const nm = beveledPrismMesh(p.poly, p.z0, p.z1, amount, segments)
    m.verts = nm.verts
    m.faces = nm.faces
    m.shading = nm.shading
    m.provenance = null
  }
  return m
}

export function markBox(m: MeshData, bounds: [number, number, number, number, number, number]): MeshData {
  m.provenance = { kind: 'box', bounds }
  return m
}
export function markPrism(m: MeshData, poly: Vec2[], z0: number, z1: number): MeshData {
  m.provenance = { kind: 'prism', poly: poly.map((p) => [...p] as Vec2), z0, z1 }
  return m
}

/** Box with a true fillet in one call — the primitive to reach for. */
export function roundedBox(
  bounds: [number, number, number, number, number, number],
  radius: number = BEVEL.panel,
  segments = 2,
): MeshData {
  return roundedBoxMesh(bounds, radius, segments)
}

/** Filleted plate centred on `(cx, cy)`, thickness along z from z0. */
export function plate(
  cx: number,
  cy: number,
  w: number,
  d: number,
  z0: number,
  t: number,
  radius: number = BEVEL.panel,
  segments = 2,
): MeshData {
  return roundedBoxMesh([cx - w / 2, cy - d / 2, z0, cx + w / 2, cy + d / 2, z0 + t], radius, segments)
}

// -------------------------------------------------------- boolean-free apertures

/**
 * Sunk cavity with a rolled rim as ONE closed shell — the same silhouette a
 * boolean would produce, built directly. Both outlines must have matching
 * vertex counts AND matching semantic corners, which is free if both come
 * from the same `roundedRect` / `polyOffset` call.
 */
export function hollowPrism(
  outerPoly: Vec2[],
  z0: number,
  z1: number,
  innerPoly: Vec2[],
  cavityZ: number,
  rimBevel = 0.012,
): MeshData {
  const n = outerPoly.length
  if (innerPoly.length !== n) throw new Error('hollowPrism: outline vertex counts must match')
  const verts: Vec3[] = []
  const rings: Vec3[][] = []
  const push = (poly: Vec2[], z: number): number => rings.push(poly.map((p) => [p[0], p[1], z] as Vec3))
  push(outerPoly, z0)
  push(outerPoly, z1 - rimBevel)
  push(insetPoly(outerPoly, rimBevel), z1)
  push(insetPoly(innerPoly, -rimBevel), z1)
  push(innerPoly, z1 - rimBevel)
  push(innerPoly, cavityZ + rimBevel)
  push(insetPoly(innerPoly, rimBevel), cavityZ)
  const nr = rings.length
  for (const ring of rings) for (const p of ring) verts.push(p)
  const faces: number[][] = []
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n
      faces.push([i * n + j, i * n + j2, (i + 1) * n + j2, (i + 1) * n + j])
    }
  }
  faces.push(Array.from({ length: n }, (_, j) => n - 1 - j))
  faces.push(Array.from({ length: n }, (_, j) => (nr - 1) * n + j))
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  smoothShade(m, SMOOTH.turned)
  return m
}

/** Through-cut ring, inner AND outer edges rounded, no false cavity floor. */
export function annularPrism(
  outerPoly: Vec2[],
  innerPoly: Vec2[],
  z0: number,
  z1: number,
  bevelRadius = 0,
  bevelSegments = 1,
): MeshData {
  const n = outerPoly.length
  if (innerPoly.length !== n) throw new Error('annularPrism: outline vertex counts must match')
  const radius = Math.max(0, Math.min(bevelRadius, (z1 - z0) / 2 - 1e-5))
  const segments = Math.max(1, bevelSegments)
  const levels: { inset: number; z: number }[] = []
  if (radius > 0) {
    for (let k = 0; k <= segments; k++) {
      const a = (Math.PI / 2) * (k / segments)
      levels.push({ inset: radius * (1 - Math.sin(a)), z: z0 + radius * (1 - Math.cos(a)) })
    }
    for (let k = 0; k <= segments; k++) {
      const a = (Math.PI / 2) * (k / segments)
      levels.push({ inset: radius * (1 - Math.cos(a)), z: z1 - radius * (1 - Math.sin(a)) })
    }
  } else {
    levels.push({ inset: 0, z: z0 }, { inset: 0, z: z1 })
  }
  const verts: Vec3[] = []
  for (const level of levels) {
    for (const [x, y] of insetPoly(outerPoly, level.inset)) verts.push([x, y, level.z])
    for (const [x, y] of insetPoly(innerPoly, -level.inset)) verts.push([x, y, level.z])
  }
  const faces: number[][] = []
  const stride = n * 2
  for (let level = 0; level < levels.length - 1; level++) {
    const a = level * stride
    const b = (level + 1) * stride
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n
      faces.push([a + j, a + j2, b + j2, b + j])
      faces.push([a + n + j2, a + n + j, b + n + j, b + n + j2])
    }
  }
  const bottom = 0
  const top = (levels.length - 1) * stride
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n
    faces.push([bottom + j2, bottom + j, bottom + n + j, bottom + n + j2])
    faces.push([top + j, top + j2, top + n + j2, top + n + j])
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  smoothShade(m, SMOOTH.turned)
  return m
}

/** Through-cut prism: outer edges may round, the aperture stays sharp. */
export function aperturedPrism(
  outerPoly: Vec2[],
  innerPoly: Vec2[],
  z0: number,
  z1: number,
  outerBevel = 0,
  bevelSegments = 1,
): MeshData {
  const n = outerPoly.length
  if (innerPoly.length !== n) throw new Error('aperturedPrism: outline vertex counts must match')
  const radius = Math.max(0, Math.min(outerBevel, (z1 - z0) / 2 - 1e-5))
  const segments = Math.max(1, bevelSegments)
  const outerLevels: { inset: number; z: number }[] = []
  if (radius > 0) {
    for (let k = 0; k <= segments; k++) {
      const a = (Math.PI / 2) * (k / segments)
      outerLevels.push({ inset: radius * (1 - Math.sin(a)), z: z0 + radius * (1 - Math.cos(a)) })
    }
    for (let k = 0; k <= segments; k++) {
      const a = (Math.PI / 2) * (k / segments)
      outerLevels.push({ inset: radius * (1 - Math.cos(a)), z: z1 - radius * (1 - Math.sin(a)) })
    }
  } else {
    outerLevels.push({ inset: 0, z: z0 }, { inset: 0, z: z1 })
  }
  const verts: Vec3[] = []
  for (const level of outerLevels) {
    for (const [x, y] of insetPoly(outerPoly, level.inset)) verts.push([x, y, level.z])
  }
  const innerBottom = verts.length
  for (const [x, y] of innerPoly) verts.push([x, y, z0])
  const innerTop = verts.length
  for (const [x, y] of innerPoly) verts.push([x, y, z1])
  const faces: number[][] = []
  for (let level = 0; level < outerLevels.length - 1; level++) {
    const a = level * n
    const b = (level + 1) * n
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n
      faces.push([a + j, a + j2, b + j2, b + j])
    }
  }
  const outerBottom = 0
  const outerTop = (outerLevels.length - 1) * n
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n
    faces.push([innerBottom + j2, innerBottom + j, innerTop + j, innerTop + j2])
    faces.push([outerBottom + j2, outerBottom + j, innerBottom + j, innerBottom + j2])
    faces.push([outerTop + j, outerTop + j2, innerTop + j2, innerTop + j])
  }
  const m = MeshData.from(verts, faces)
  recalcNormals(m)
  if (radius > 0) smoothShade(m, SMOOTH.turned)
  return m
}

// ------------------------------------------------------------ shading / clean

/** State the crease threshold explicitly — see `SMOOTH` for the distribution. */
export function smoothShade(m: MeshData, angle: number = SMOOTH.top): MeshData {
  m.shading = { mode: 'smooth', angle }
  return m
}

export function flatShade(m: MeshData): MeshData {
  m.shading = { mode: 'flat' }
  return m
}

/**
 * Weld coincident vertices (0.02 mm) and dissolve zero-area faces.
 * Lofts and joins leave both behind wherever a ring collapses — the fold at
 * the top of a bag, a ridge a wrap closes on — and shading breaks along the
 * whole edge loop when a normal is asked for there. Run it on every part
 * before emit rather than hunting them one at a time.
 */
export function cleanMesh(m: MeshData, dist = 2e-5): MeshData {
  const remap = new Array<number>(m.verts.length)
  const seen = new Map<string, number>()
  const verts: Vec3[] = []
  const colors: Vec3[] | null = m.colors ? [] : null
  for (let i = 0; i < m.verts.length; i++) {
    const v = m.verts[i]
    const key = `${Math.round(v[0] / dist)},${Math.round(v[1] / dist)},${Math.round(v[2] / dist)}`
    let idx = seen.get(key)
    if (idx === undefined) {
      idx = verts.length
      seen.set(key, idx)
      verts.push(v)
      if (colors && m.colors) colors.push(m.colors[i])
    }
    remap[i] = idx
  }
  const faces: number[][] = []
  const uvs: (Vec2[] | null)[] | null = m.uvs ? [] : null
  const faceMat: number[] | null = m.faceMat ? [] : null
  m.faces.forEach((face, fi) => {
    const ff: number[] = []
    const fuv: Vec2[] = []
    face.forEach((vi, c) => {
      const mi = remap[vi]
      if (!ff.includes(mi)) {
        ff.push(mi)
        const src = m.uvs?.[fi]
        if (src) fuv.push(src[c])
      }
    })
    if (ff.length < 3) return
    if (len(faceNormal(verts, ff)) < 1e-12) return
    faces.push(ff)
    if (uvs) uvs.push(m.uvs?.[fi] ? fuv : null)
    if (faceMat && m.faceMat) faceMat.push(m.faceMat[fi])
  })
  m.verts = verts
  m.faces = faces
  m.uvs = uvs
  m.colors = colors
  m.faceMat = faceMat
  m.provenance = null
  return m
}

// ------------------------------------------------------------------- emit

/**
 * Author Z-up (the profile convention); emit Y-up (the Mars Park world).
 * `(x,y,z) -> (x,z,y)` is a mirror, so every face winding is reversed to keep
 * normals outward. Idempotent — `toTriangles()` skips parts already flipped.
 */
export function toYUp(m: MeshData): MeshData {
  if (m.frame === 'y-up') return m
  for (const v of m.verts) {
    const y = v[1]
    v[1] = v[2]
    v[2] = y
  }
  for (let i = 0; i < m.faces.length; i++) {
    m.faces[i].reverse()
    if (m.uvs?.[i]) m.uvs[i]!.reverse()
  }
  m.frame = 'y-up'
  m.provenance = null
  return m
}

export interface TriangleSoup {
  positions: number[]
  normals: number[]
  uvs: number[]
  colors: number[] | null
  /** parallel to triangles: the face's material slot index (or null) */
  triMat: number[] | null
}

/**
 * Triangulate once, with **angle-threshold smooth normals**. This is the one
 * load-bearing routine in the module: a corner's normal averages only the
 * adjacent faces inside the smooth angle, which is what makes creases exact
 * and free. Output is Y-up regardless of the authoring frame.
 */
export function toTriangles(m: MeshData, uvScale = 1): TriangleSoup {
  const fNormals: Vec3[] = m.faces.map((f) => norm(faceNormal(m.verts, f)))
  const smooth = m.shading.mode === 'smooth'
  const cosLimit = smooth ? Math.cos(((m.shading as { angle: number }).angle * Math.PI) / 180) : 2
  const vFaces: number[][] = Array.from({ length: m.verts.length }, () => [])
  if (smooth) {
    m.faces.forEach((f, fi) => {
      for (const vi of f) vFaces[vi].push(fi)
    })
  }
  // A corner's normal averages ONLY the adjacent faces inside the smooth
  // angle. computeVertexNormals() cannot do this and smears every crease.
  const cornerNormal = (vi: number, fi: number): Vec3 => {
    if (!smooth) return fNormals[fi]
    const fn = fNormals[fi]
    let nx = 0
    let ny = 0
    let nz = 0
    for (const ofi of vFaces[vi]) {
      const on = fNormals[ofi]
      if (dot(fn, on) >= cosLimit - 1e-9) {
        nx += on[0]
        ny += on[1]
        nz += on[2]
      }
    }
    const l = Math.hypot(nx, ny, nz)
    if (l < 1e-9) return fn
    return [nx / l, ny / l, nz / l]
  }

  const flip = m.frame === 'z-up'
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const cols: number[] | null = m.colors ? [] : null
  const triMat: number[] | null = m.faceMat ? [] : null
  const hasUv = !!m.uvs

  m.faces.forEach((f, fi) => {
    const tris = triangulateFace(m.verts, f)
    const uvFace = hasUv ? m.uvs![fi] : null
    const fn = fNormals[fi]
    // planar UV basis from the dominant axis of the emitted (Y-up) normal
    const wn: Vec3 = flip ? [fn[0], fn[2], fn[1]] : fn
    const ax = Math.abs(wn[0])
    const ay = Math.abs(wn[1])
    const az = Math.abs(wn[2])
    const dominant = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2
    for (const t of tris) {
      const order = flip ? [t[2], t[1], t[0]] : t
      for (const ci of order) {
        const vi = f[ci]
        const p = m.verts[vi]
        const n = cornerNormal(vi, fi)
        const px = p[0]
        const py = flip ? p[2] : p[1]
        const pz = flip ? p[1] : p[2]
        positions.push(px, py, pz)
        normals.push(n[0], flip ? n[2] : n[1], flip ? n[1] : n[2])
        if (uvFace) uvs.push(uvFace[ci][0], uvFace[ci][1])
        else if (dominant === 1) uvs.push(px * uvScale, pz * uvScale)
        else if (dominant === 0) uvs.push(pz * uvScale, py * uvScale)
        else uvs.push(px * uvScale, py * uvScale)
        if (cols && m.colors) {
          const c = m.colors[vi]
          cols.push(c[0], c[1], c[2])
        }
      }
      if (triMat && m.faceMat) triMat.push(m.faceMat[fi])
    }
  })
  return { positions, normals, uvs, colors: cols, triMat }
}

/** Non-indexed BufferGeometry, position + normal + uv, in world Y-up. */
export function toGeometry(m: MeshData, uvScale = 1): BufferGeometry {
  const soup = toTriangles(m, uvScale)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(soup.positions), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(soup.normals), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(soup.uvs), 2))
  if (soup.colors) {
    g.setAttribute(m.colorName || 'color', new BufferAttribute(new Float32Array(soup.colors), 3))
  }
  return g
}

/** A part list keyed by material slot — the unit builders return. */
export type SlotParts = Record<string, MeshData | MeshData[] | null | undefined>

function slotList(parts: SlotParts): [string, MeshData[]][] {
  const out: [string, MeshData[]][] = []
  for (const [slot, value] of Object.entries(parts)) {
    if (!value) continue
    const list = Array.isArray(value) ? value.filter((m): m is MeshData => !!m) : [value]
    if (list.length) out.push([slot, list])
  }
  return out
}

export interface WriteOpts {
  uvScale?: number
  /** run cleanMesh on every part before emit (default true) */
  clean?: boolean
}

/**
 * Push a part into an existing `PartWriter` slot as pre-shaded triangles, so a
 * builder can mix `writer.box(...)` and `MeshData` inside one assembly and
 * still land in the same merged draw. Smooth-by-angle normals survive: the
 * writer stores them verbatim instead of recomputing per face.
 */
export function writeInto(writer: PartWriter, slot: string, part: MeshData, opts: WriteOpts = {}): void {
  const m = opts.clean === false ? part : cleanMesh(part)
  const soup = toTriangles(m, opts.uvScale ?? 1)
  if (soup.positions.length === 0) return
  writer.raw(slot, soup.positions, soup.normals, soup.uvs)
}

/** `writeInto` for a whole slot map (what a builder normally returns). */
export function writeAll(writer: PartWriter, parts: SlotParts, opts: WriteOpts = {}): void {
  for (const [slot, list] of slotList(parts)) {
    for (const part of list) writeInto(writer, slot, part, opts)
  }
}

export interface BuildOpts extends WriteOpts {
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string
}

/**
 * Standalone emit: one merged mesh per slot, shaped exactly like
 * `PartWriter.build()` so either sink can be swapped in without touching the
 * caller.
 */
export function buildGroup(parts: SlotParts, materials: Record<string, Material>, opts: BuildOpts = {}): Group {
  const group = new Group()
  if (opts.name) group.name = opts.name
  for (const [slot, list] of slotList(parts)) {
    const material = materials[slot]
    if (!material) throw new Error(`meshdata: no material bound for slot "${slot}"`)
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    for (const part of list) {
      const m = opts.clean === false ? part : cleanMesh(part)
      const soup = toTriangles(m, opts.uvScale ?? 1)
      for (const v of soup.positions) positions.push(v)
      for (const v of soup.normals) normals.push(v)
      for (const v of soup.uvs) uvs.push(v)
    }
    if (positions.length === 0) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = opts.castShadow ?? true
    mesh.receiveShadow = opts.receiveShadow ?? true
    mesh.name = `part:${slot}`
    group.add(mesh)
  }
  return group
}
