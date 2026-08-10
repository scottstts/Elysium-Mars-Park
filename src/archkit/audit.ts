/**
 * archkit/audit — the mechanical quality gate.
 *
 * Ported from `friends/build_scripts/Central_Perk/audit.py`, which states the
 * reason it exists:
 *
 * > Coplanar faces from two different objects are the one defect that always
 * > survives a screenshot check: they look fine from most angles, then flicker
 * > from one. So the build asserts they do not exist rather than trusting the
 * > eye.
 *
 * The Blender original ran over objects before export. Mars Park has no
 * offline scene — geometry is generated at boot — so this runs **in the page**
 * over the built `Object3D` graph. Usage (dev builds only):
 *
 *     await window.__elysium.audit()            // whole scene
 *     await window.__elysium.audit({ clash: false, top: 40 })
 *
 * Two implementation lessons are recorded in the original and must not be
 * re-learned:
 *
 *  1. Bucket triangles into **all sixteen** neighbouring cells of the 4-D
 *     plane grid. A quantised plane key without neighbour expansion silently
 *     misses pairs whose normals straddle a cell boundary.
 *  2. Measure **true clipped triangle overlap area**, not bbox overlap, which
 *     reports L-shaped slabs that merely touch along an edge.
 *
 * Two adaptations to this codebase:
 *
 *  - `PartWriter` merges a whole assembly into one mesh per material slot, so
 *    "different object" is not a usable filter here. Triangle pairs are
 *    compared **regardless of which mesh they came from**; two triangles of
 *    one flat face share an edge and clip to zero area, so a well-built merged
 *    mesh reports nothing. A same-mesh hit is a real defect (two parts stacked
 *    inside one slot).
 *  - Triangles smaller than the overlap tolerance are dropped up front. A
 *    clipped overlap can never exceed the smaller triangle's own area, so this
 *    is exact, and it removes the chamfer bands and lattice tubes that make up
 *    most of the scene's triangle count.
 */
import type { Material, Mesh, Object3D } from 'three'

/** normal-dot tolerance, ~0.13 degrees */
const ANG = 0.0025
/** 1.5 mm — tighter than any deliberate offset in the build (see PROUD_MIN) */
const DIST = 0.0015
/** 2 cm² of genuinely shared surface before it is a defect */
const OVERLAP_A = 2e-4
/** plane-grid cells: normal axes / distance axis */
const CELL_N = 0.02
const CELL_D = 0.02
/** how far two solids must run into one another to count */
const CLASH_DEPTH = 0.03

export interface AuditBounds {
  /** horizontal radius about `centerX/centerZ` (default: the dome + approach) */
  radius: number
  minY: number
  maxY: number
  centerX?: number
  centerZ?: number
}

export interface AuditOptions {
  /** drop triangles below this area; never raise above OVERLAP_A without reason */
  minArea?: number
  /** hard cap on triangles compared, after filtering (deterministic order) */
  maxTriangles?: number
  /** world region to audit; exterior terrain and sky live outside it */
  bounds?: AuditBounds | null
  /** include InstancedMesh scatter (rocks, grass) — off: organics interpenetrate by design */
  includeInstanced?: boolean
  /** run the solid-clash pass (mesh-pair triangle intersection) */
  clash?: boolean
  /** name-prefix pairs that are BUILT to occupy the same space */
  clashAllow?: [string, string][]
  /** how many rows each table shows */
  top?: number
  /** skip a mesh outright (userData.auditSkip is always honoured) */
  skip?: (mesh: Mesh, name: string) => boolean
}

export interface CoplanarHit {
  a: string
  b: string
  /** total clipped overlap, cm² */
  areaCm2: number
  /** representative world position */
  at: [number, number, number]
  pairs: number
}

export interface MeshDefect {
  name: string
  triangles: number
  /** zero-area triangles */
  degenerate: number
  /** non-finite positions */
  nonFinite: number
  /** NaN / zero-length normals */
  badNormals: number
}

export interface ClashHit {
  a: string
  b: string
  crossings: number
}

export interface AuditReport {
  ms: number
  meshes: number
  triangles: number
  /** triangles that survived the area + bounds filters and were compared */
  compared: number
  truncated: boolean
  zfight: CoplanarHit[]
  zfightTotalCm2: number
  backToBack: number
  defects: MeshDefect[]
  noMaterial: string[]
  clash: ClashHit[]
}

// ------------------------------------------------------------------ helpers

function qualifiedName(o: Object3D): string {
  const parts: string[] = []
  let cur: Object3D | null = o
  while (cur) {
    if (cur.name) parts.unshift(cur.name)
    cur = cur.parent
  }
  if (parts.length === 0) return `${o.type}#${o.id}`
  return parts.slice(-3).join('/')
}

/** The dome (r 130) plus the arrival approach; exterior terrain sits outside. */
const DEFAULT_BOUNDS: AuditBounds = { radius: 260, minY: -25, maxY: 130 }

interface Tris {
  /** 9 floats per triangle */
  pos: Float64Array
  /** 3 floats per triangle: unit normal */
  nrm: Float64Array
  /** plane distance along the normal */
  dist: Float64Array
  area: Float64Array
  /** 6 floats per triangle: min xyz, max xyz */
  box: Float64Array
  mesh: Int32Array
  count: number
}

function collect(
  root: Object3D,
  opts: AuditOptions,
): { tris: Tris; names: string[]; meshBox: Float64Array; defects: MeshDefect[]; noMaterial: string[]; total: number } {
  const minArea = opts.minArea ?? OVERLAP_A
  const bounds = opts.bounds === undefined ? DEFAULT_BOUNDS : opts.bounds
  const cx = bounds?.centerX ?? 0
  const cz = bounds?.centerZ ?? 0
  const r2 = bounds ? bounds.radius * bounds.radius : 0

  const names: string[] = []
  const defects: MeshDefect[] = []
  const noMaterial: string[] = []
  const pos: number[] = []
  const nrm: number[] = []
  const dist: number[] = []
  const area: number[] = []
  const box: number[] = []
  const mesh: number[] = []
  const meshBoxes: number[] = []
  let total = 0

  root.updateMatrixWorld(true)
  root.traverse((node) => {
    // Duck-typed, not `instanceof`: a page can end up with two copies of three
    // (a pre-bundled dep and a raw module), and `instanceof Mesh` then silently
    // matches nothing — an audit that reports a perfect scene because it looked
    // at zero meshes.
    const flags = node as unknown as { isMesh?: boolean; isInstancedMesh?: boolean }
    if (flags.isMesh !== true) return
    const o = node as Mesh
    if (!o.visible) return
    if (o.userData?.auditSkip) return
    const name = qualifiedName(o)
    if (opts.skip?.(o, name)) return
    if (flags.isInstancedMesh === true && !opts.includeInstanced) return
    const geometry = o.geometry
    const position = geometry.getAttribute('position')
    if (!position) return
    const index = geometry.getIndex()
    const triCount = (index ? index.count : position.count) / 3
    if (triCount < 1) return

    const material = o.material as Material | Material[] | null
    const hasMaterial = Array.isArray(material) ? material.length > 0 && material.some(Boolean) : !!material
    if (!hasMaterial) noMaterial.push(name)

    const meshIndex = names.length
    names.push(name)
    const m = o.matrixWorld.elements
    const normalAttr = geometry.getAttribute('normal')
    let degenerate = 0
    let nonFinite = 0
    let badNormals = 0
    let bx0 = Infinity
    let by0 = Infinity
    let bz0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    let bz1 = -Infinity

    const wx = new Float64Array(3)
    const wy = new Float64Array(3)
    const wz = new Float64Array(3)
    for (let t = 0; t < triCount; t++) {
      let ok = true
      for (let c = 0; c < 3; c++) {
        const vi = index ? index.getX(t * 3 + c) : t * 3 + c
        const lx = position.getX(vi)
        const ly = position.getY(vi)
        const lz = position.getZ(vi)
        if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) ok = false
        wx[c] = m[0] * lx + m[4] * ly + m[8] * lz + m[12]
        wy[c] = m[1] * lx + m[5] * ly + m[9] * lz + m[13]
        wz[c] = m[2] * lx + m[6] * ly + m[10] * lz + m[14]
        if (normalAttr) {
          const nxv = normalAttr.getX(vi)
          const nyv = normalAttr.getY(vi)
          const nzv = normalAttr.getZ(vi)
          const l = nxv * nxv + nyv * nyv + nzv * nzv
          if (!Number.isFinite(l) || l < 1e-10) badNormals++
        }
      }
      total++
      if (!ok) {
        nonFinite++
        continue
      }
      const ux = wx[1] - wx[0]
      const uy = wy[1] - wy[0]
      const uz = wz[1] - wz[0]
      const vx = wx[2] - wx[0]
      const vy = wy[2] - wy[0]
      const vz = wz[2] - wz[0]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz)
      const a = l * 0.5
      if (a < 1e-9) {
        degenerate++
        continue
      }
      const minx = Math.min(wx[0], wx[1], wx[2])
      const miny = Math.min(wy[0], wy[1], wy[2])
      const minz = Math.min(wz[0], wz[1], wz[2])
      const maxx = Math.max(wx[0], wx[1], wx[2])
      const maxy = Math.max(wy[0], wy[1], wy[2])
      const maxz = Math.max(wz[0], wz[1], wz[2])
      if (minx < bx0) bx0 = minx
      if (miny < by0) by0 = miny
      if (minz < bz0) bz0 = minz
      if (maxx > bx1) bx1 = maxx
      if (maxy > by1) by1 = maxy
      if (maxz > bz1) bz1 = maxz
      if (a < minArea) continue
      if (bounds) {
        const mx = (wx[0] + wx[1] + wx[2]) / 3 - cx
        const my = (wy[0] + wy[1] + wy[2]) / 3
        const mz = (wz[0] + wz[1] + wz[2]) / 3 - cz
        if (mx * mx + mz * mz > r2 || my < bounds.minY || my > bounds.maxY) continue
      }
      nx /= l
      ny /= l
      nz /= l
      pos.push(wx[0], wy[0], wz[0], wx[1], wy[1], wz[1], wx[2], wy[2], wz[2])
      nrm.push(nx, ny, nz)
      dist.push(nx * wx[0] + ny * wy[0] + nz * wz[0])
      area.push(a)
      box.push(minx, miny, minz, maxx, maxy, maxz)
      mesh.push(meshIndex)
    }
    meshBoxes.push(bx0, by0, bz0, bx1, by1, bz1)
    if (degenerate || nonFinite || badNormals) {
      defects.push({ name, triangles: triCount, degenerate, nonFinite, badNormals })
    }
  })

  return {
    tris: {
      pos: Float64Array.from(pos),
      nrm: Float64Array.from(nrm),
      dist: Float64Array.from(dist),
      area: Float64Array.from(area),
      box: Float64Array.from(box),
      mesh: Int32Array.from(mesh),
      count: area.length,
    },
    names,
    meshBox: Float64Array.from(meshBoxes),
    defects,
    noMaterial,
    total,
  }
}

/** Area of convex polygon P clipped by convex triangle Q, both 2-D. */
function clipArea(P: number[], Q: number[]): number {
  let out = P
  // orient Q counter-clockwise so the half-plane test has a fixed sign
  let s = 0
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    s += Q[i * 2] * Q[j * 2 + 1] - Q[j * 2] * Q[i * 2 + 1]
  }
  const q = s < 0 ? [Q[4], Q[5], Q[2], Q[3], Q[0], Q[1]] : Q
  for (let i = 0; i < 3; i++) {
    const ax = q[i * 2]
    const ay = q[i * 2 + 1]
    const bx = q[((i + 1) % 3) * 2]
    const by = q[((i + 1) % 3) * 2 + 1]
    const ex = bx - ax
    const ey = by - ay
    const inp = out
    if (inp.length < 6) return 0
    out = []
    let px = inp[inp.length - 2]
    let py = inp[inp.length - 1]
    let dprev = ex * (py - ay) - ey * (px - ax)
    for (let k = 0; k < inp.length; k += 2) {
      const cxp = inp[k]
      const cyp = inp[k + 1]
      const dcur = ex * (cyp - ay) - ey * (cxp - ax)
      if (dcur >= 0) {
        if (dprev < 0) {
          const t = dprev / (dprev - dcur)
          out.push(px + (cxp - px) * t, py + (cyp - py) * t)
        }
        out.push(cxp, cyp)
      } else if (dprev >= 0) {
        const t = dprev / (dprev - dcur)
        out.push(px + (cxp - px) * t, py + (cyp - py) * t)
      }
      px = cxp
      py = cyp
      dprev = dcur
    }
  }
  if (out.length < 6) return 0
  let a = 0
  for (let i = 0; i < out.length; i += 2) {
    const j = (i + 2) % out.length
    a += out[i] * out[j + 1] - out[j] * out[i + 1]
  }
  return Math.abs(a) * 0.5
}

// ------------------------------------------------------------------- passes

interface CoplanarResult {
  hits: CoplanarHit[]
  totalCm2: number
  backToBack: number
}

function coplanarPass(tris: Tris, names: string[], top: number): CoplanarResult {
  const n = tris.count
  const { nrm, dist, box, pos, mesh } = tris

  // 4-D plane grid. A triangle registers in all sixteen neighbouring cells so
  // no pair within tolerance can be missed, whatever boundary it straddles.
  const grid = new Map<number, number[]>()
  const eps = 1e-9
  for (let i = 0; i < n; i++) {
    let cx = nrm[i * 3]
    let cy = nrm[i * 3 + 1]
    let cz = nrm[i * 3 + 2]
    let cd = dist[i]
    if (cz < -eps || (Math.abs(cz) <= eps && (cy < -eps || (Math.abs(cy) <= eps && cx < 0)))) {
      cx = -cx
      cy = -cy
      cz = -cz
      cd = -cd
    }
    const f0 = Math.floor(cx / CELL_N)
    const f1 = Math.floor(cy / CELL_N)
    const f2 = Math.floor(cz / CELL_N)
    const f3 = Math.floor(cd / CELL_D)
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        for (let c = 0; c < 2; c++) {
          for (let e = 0; e < 2; e++) {
            const key = ((f0 + a + 64) * 129 + (f1 + b + 64)) * 129 * 65536 + (f2 + c + 64) * 65536 + (f3 + e + 32768)
            const list = grid.get(key)
            if (list) list.push(i)
            else grid.set(key, [i])
          }
        }
      }
    }
  }

  const seen = new Set<number>()
  const hits = new Map<string, CoplanarHit>()
  let totalCm2 = 0
  let backToBack = 0
  const A: number[] = [0, 0, 0, 0, 0, 0]
  const B: number[] = [0, 0, 0, 0, 0, 0]

  const test = (i: number, j: number): void => {
    // Cheap rejects first: world AABB, then the two plane tests. The AABB
    // must be inflated by DIST — two coplanar faces 0.5 mm apart have boxes
    // that do NOT overlap, and a bare box test silently drops exactly the
    // pairs this gate exists to find.
    if (
      box[i * 6 + 3] + DIST < box[j * 6] ||
      box[j * 6 + 3] + DIST < box[i * 6] ||
      box[i * 6 + 4] + DIST < box[j * 6 + 1] ||
      box[j * 6 + 4] + DIST < box[i * 6 + 1] ||
      box[i * 6 + 5] + DIST < box[j * 6 + 2] ||
      box[j * 6 + 5] + DIST < box[i * 6 + 2]
    ) {
      return
    }
    const nix = nrm[i * 3]
    const niy = nrm[i * 3 + 1]
    const niz = nrm[i * 3 + 2]
    const d = nix * nrm[j * 3] + niy * nrm[j * 3 + 1] + niz * nrm[j * 3 + 2]
    if (Math.abs(d) < 1 - ANG) return
    if (Math.abs(nix * pos[j * 9] + niy * pos[j * 9 + 1] + niz * pos[j * 9 + 2] - dist[i]) > DIST) return
    const pair = i < j ? i * 67108864 + j : j * 67108864 + i
    if (seen.has(pair)) return
    seen.add(pair)
    // in-plane basis from i's normal (both triangles share it to tolerance)
    let ux: number
    let uy: number
    let uz: number
    if (Math.abs(niz) < 0.9) {
      ux = niy * 1 - niz * 0
      uy = niz * 0 - nix * 1
      uz = 0
    } else {
      ux = 0
      uy = niz
      uz = -niy
    }
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul
    uy /= ul
    uz /= ul
    const vx = niy * uz - niz * uy
    const vy = niz * ux - nix * uz
    const vz = nix * uy - niy * ux
    for (let c = 0; c < 3; c++) {
      const ix = pos[i * 9 + c * 3]
      const iy = pos[i * 9 + c * 3 + 1]
      const iz = pos[i * 9 + c * 3 + 2]
      A[c * 2] = ix * ux + iy * uy + iz * uz
      A[c * 2 + 1] = ix * vx + iy * vy + iz * vz
      const jx = pos[j * 9 + c * 3]
      const jy = pos[j * 9 + c * 3 + 1]
      const jz = pos[j * 9 + c * 3 + 2]
      B[c * 2] = jx * ux + jy * uy + jz * uz
      B[c * 2 + 1] = jx * vx + jy * vy + jz * vz
    }
    const ov = clipArea(A, B)
    if (ov < OVERLAP_A) return
    if (d < 0) {
      // coplanar but opposed: an underside on a floor, a lining's back in its
      // reveal. Both belong to closed solids, so a nearer face is always hit
      // first. Informational.
      backToBack++
      return
    }
    const na = names[mesh[i]]
    const nb = names[mesh[j]]
    const key = na < nb ? na + ' :: ' + nb : nb + ' :: ' + na
    totalCm2 += ov * 1e4
    const cur = hits.get(key)
    if (cur) {
      cur.areaCm2 += ov * 1e4
      cur.pairs++
    } else {
      hits.set(key, {
        a: na,
        b: nb,
        areaCm2: ov * 1e4,
        at: [
          Math.round(((pos[i * 9] + pos[i * 9 + 3] + pos[i * 9 + 6]) / 3) * 100) / 100,
          Math.round(((pos[i * 9 + 1] + pos[i * 9 + 4] + pos[i * 9 + 7]) / 3) * 100) / 100,
          Math.round(((pos[i * 9 + 2] + pos[i * 9 + 5] + pos[i * 9 + 8]) / 3) * 100) / 100,
        ],
        pairs: 1,
      })
    }
  }

  // Sweep-and-prune on x inside each plane bucket: a coplanar bucket can hold
  // a whole paved plaza, and the naive n² over it is the difference between
  // seconds and minutes.
  const order: number[] = []
  for (const items of grid.values()) {
    if (items.length < 2) continue
    order.length = 0
    for (const it of items) order.push(it)
    order.sort((a, b) => box[a * 6] - box[b * 6])
    for (let a = 0; a < order.length; a++) {
      const i = order[a]
      const maxx = box[i * 6 + 3] + DIST
      for (let b = a + 1; b < order.length; b++) {
        const j = order[b]
        if (box[j * 6] > maxx) break
        test(i, j)
      }
    }
  }

  const out = [...hits.values()].sort((x, y) => y.areaCm2 - x.areaCm2)
  for (const h of out) h.areaCm2 = Math.round(h.areaCm2 * 10) / 10
  return { hits: out.slice(0, top), totalCm2: Math.round(totalCm2 * 10) / 10, backToBack }
}

/** Möller-Trumbore, restricted to a segment. */
function segmentHitsTri(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  p: Float64Array,
  t: number,
): boolean {
  const b = t * 9
  const e1x = p[b + 3] - p[b]
  const e1y = p[b + 4] - p[b + 1]
  const e1z = p[b + 5] - p[b + 2]
  const e2x = p[b + 6] - p[b]
  const e2y = p[b + 7] - p[b + 1]
  const e2z = p[b + 8] - p[b + 2]
  const hx = dy * e2z - dz * e2y
  const hy = dz * e2x - dx * e2z
  const hz = dx * e2y - dy * e2x
  const a = e1x * hx + e1y * hy + e1z * hz
  if (a > -1e-12 && a < 1e-12) return false
  const f = 1 / a
  const sx = ox - p[b]
  const sy = oy - p[b + 1]
  const sz = oz - p[b + 2]
  const u = f * (sx * hx + sy * hy + sz * hz)
  if (u < 0 || u > 1) return false
  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const v = f * (dx * qx + dy * qy + dz * qz)
  if (v < 0 || u + v > 1) return false
  const tt = f * (e2x * qx + e2y * qy + e2z * qz)
  return tt > 1e-9 && tt < 1 - 1e-9
}

function edgesCross(p: Float64Array, a: number, b: number): boolean {
  const base = a * 9
  for (let e = 0; e < 3; e++) {
    const o = base + e * 3
    const q = base + ((e + 1) % 3) * 3
    if (segmentHitsTri(p[o], p[o + 1], p[o + 2], p[q] - p[o], p[q + 1] - p[o + 1], p[q + 2] - p[o + 2], p, b)) {
      return true
    }
  }
  return false
}

/** Real triangle-triangle crossing: either solid's edge pierces the other. */
function trisCross(tris: Tris, i: number, j: number): boolean {
  return edgesCross(tris.pos, i, j) || edgesCross(tris.pos, j, i)
}

function clashPass(tris: Tris, names: string[], meshBox: Float64Array, opts: AuditOptions): ClashHit[] {
  const allow = opts.clashAllow ?? []
  const allowed = (a: string, b: string): boolean => {
    for (const [p, q] of allow) {
      if ((a.startsWith(p) && b.startsWith(q)) || (a.startsWith(q) && b.startsWith(p))) return true
    }
    return false
  }
  // triangles grouped by mesh
  const byMesh = new Map<number, number[]>()
  for (let i = 0; i < tris.count; i++) {
    const m = tris.mesh[i]
    const list = byMesh.get(m)
    if (list) list.push(i)
    else byMesh.set(m, [i])
  }
  const ids = [...byMesh.keys()].sort((a, b) => a - b)
  const out: ClashHit[] = []
  for (let x = 0; x < ids.length; x++) {
    const a = ids[x]
    const ab = a * 6
    for (let y = x + 1; y < ids.length; y++) {
      const b = ids[y]
      const bb = b * 6
      const lo0 = Math.max(meshBox[ab], meshBox[bb])
      const lo1 = Math.max(meshBox[ab + 1], meshBox[bb + 1])
      const lo2 = Math.max(meshBox[ab + 2], meshBox[bb + 2])
      const hi0 = Math.min(meshBox[ab + 3], meshBox[bb + 3])
      const hi1 = Math.min(meshBox[ab + 4], meshBox[bb + 4])
      const hi2 = Math.min(meshBox[ab + 5], meshBox[bb + 5])
      if (hi0 <= lo0 || hi1 <= lo1 || hi2 <= lo2) continue
      if (allowed(names[a], names[b])) continue
      // A cup standing on a table shares a millimetre of its own base with the
      // top. What matters is how DEEP the two solids run into one another, and
      // the bar has to scale: 30 mm OR a third of the thinner solid's own
      // least dimension, whichever is smaller, so thin parts are not blind.
      const ta = Math.min(meshBox[ab + 3] - meshBox[ab], meshBox[ab + 4] - meshBox[ab + 1], meshBox[ab + 5] - meshBox[ab + 2])
      const tb = Math.min(meshBox[bb + 3] - meshBox[bb], meshBox[bb + 4] - meshBox[bb + 1], meshBox[bb + 5] - meshBox[bb + 2])
      const lim = Math.min(CLASH_DEPTH, Math.max(0.004, 0.34 * Math.min(ta, tb)))
      if (Math.min(hi0 - lo0, hi1 - lo1, hi2 - lo2) < lim) continue

      // spatial hash of A's triangles clipped to the shared box, then B's
      // triangles probed against it
      const cell = 0.4
      const hash = new Map<number, number[]>()
      const inShared = (i: number): boolean =>
        tris.box[i * 6 + 3] >= lo0 &&
        tris.box[i * 6] <= hi0 &&
        tris.box[i * 6 + 4] >= lo1 &&
        tris.box[i * 6 + 1] <= hi1 &&
        tris.box[i * 6 + 5] >= lo2 &&
        tris.box[i * 6 + 2] <= hi2
      const key = (ix: number, iy: number, iz: number): number => (ix * 4093 + iy) * 4093 + iz
      let inserted = 0
      for (const i of byMesh.get(a)!) {
        if (!inShared(i)) continue
        const x0 = Math.floor(Math.max(tris.box[i * 6], lo0) / cell)
        const y0 = Math.floor(Math.max(tris.box[i * 6 + 1], lo1) / cell)
        const z0 = Math.floor(Math.max(tris.box[i * 6 + 2], lo2) / cell)
        const x1 = Math.floor(Math.min(tris.box[i * 6 + 3], hi0) / cell)
        const y1 = Math.floor(Math.min(tris.box[i * 6 + 4], hi1) / cell)
        const z1 = Math.floor(Math.min(tris.box[i * 6 + 5], hi2) / cell)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 256) continue
        for (let ix = x0; ix <= x1; ix++) {
          for (let iy = y0; iy <= y1; iy++) {
            for (let iz = z0; iz <= z1; iz++) {
              const k = key(ix, iy, iz)
              const l = hash.get(k)
              if (l) l.push(i)
              else hash.set(k, [i])
              inserted++
            }
          }
        }
      }
      if (inserted === 0) continue
      let crossings = 0
      const probed = new Set<number>()
      outer: for (const j of byMesh.get(b)!) {
        if (!inShared(j)) continue
        const x0 = Math.floor(Math.max(tris.box[j * 6], lo0) / cell)
        const y0 = Math.floor(Math.max(tris.box[j * 6 + 1], lo1) / cell)
        const z0 = Math.floor(Math.max(tris.box[j * 6 + 2], lo2) / cell)
        const x1 = Math.floor(Math.min(tris.box[j * 6 + 3], hi0) / cell)
        const y1 = Math.floor(Math.min(tris.box[j * 6 + 4], hi1) / cell)
        const z1 = Math.floor(Math.min(tris.box[j * 6 + 5], hi2) / cell)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 256) continue
        probed.clear()
        for (let ix = x0; ix <= x1; ix++) {
          for (let iy = y0; iy <= y1; iy++) {
            for (let iz = z0; iz <= z1; iz++) {
              const l = hash.get(key(ix, iy, iz))
              if (!l) continue
              for (const i of l) {
                if (probed.has(i)) continue
                probed.add(i)
                if (trisCross(tris, i, j)) {
                  crossings++
                  if (crossings > 512) break outer
                }
              }
            }
          }
        }
      }
      // one or two crossings is a graze; hundreds is one solid buried in another
      if (crossings > 2) out.push({ a: names[a], b: names[b], crossings })
    }
  }
  return out.sort((p, q) => q.crossings - p.crossings)
}

// -------------------------------------------------------------------- entry

/**
 * Run the gate over a built scene graph. The build is not finished until
 * `zfight` is empty: coplanar same-facing pairs ARE z-fighting.
 */
export function auditGeometry(root: Object3D, opts: AuditOptions = {}): AuditReport {
  const t0 = performance.now()
  const top = opts.top ?? 25
  const collected = collect(root, opts)
  const tris = collected.tris
  let truncated = false
  const cap = opts.maxTriangles ?? 600000
  if (tris.count > cap) {
    truncated = true
    tris.count = cap
  }
  const co = coplanarPass(tris, collected.names, top)
  const clash = opts.clash === false ? [] : clashPass(tris, collected.names, collected.meshBox, opts)
  return {
    ms: Math.round(performance.now() - t0),
    meshes: collected.names.length,
    triangles: collected.total,
    compared: tris.count,
    truncated,
    zfight: co.hits,
    zfightTotalCm2: co.totalCm2,
    backToBack: co.backToBack,
    defects: collected.defects.sort((a, b) => b.degenerate + b.badNormals - (a.degenerate + a.badNormals)).slice(0, top),
    noMaterial: collected.noMaterial,
    clash: clash.slice(0, top),
  }
}

/** Console summary: the three tables a rebuild agent actually acts on. */
export function logAuditReport(report: AuditReport): AuditReport {
  const head =
    `ARCHKIT AUDIT  ${report.meshes} meshes / ${report.triangles} tris ` +
    `(${report.compared} compared${report.truncated ? ', TRUNCATED' : ''})  ${report.ms} ms`
  console.log(head)
  console.log(
    `  zfight ${report.zfight.length} pairs / ${report.zfightTotalCm2} cm²   ` +
      `back-to-back ${report.backToBack} (harmless)   ` +
      `defects ${report.defects.length}   nomat ${report.noMaterial.length}   clash ${report.clash.length}`,
  )
  if (report.zfight.length) console.table(report.zfight)
  if (report.defects.length) console.table(report.defects)
  if (report.clash.length) console.table(report.clash)
  if (report.noMaterial.length) console.log('  no material:', report.noMaterial)
  return report
}
