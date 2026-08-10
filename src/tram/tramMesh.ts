import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three'
import type { Material } from 'three'

/**
 * Polygon authoring kit for the hero tram (geometry-craft.md §1–2, local to
 * `src/tram/` because `archkit/` is owned by another agent this wave).
 *
 * The rules it enforces, so the vehicle cannot be built sloppily:
 *  - author POLYGONS (quads / n-gons), triangulate once at emit;
 *  - normals are DECIDED: per-corner, averaging only adjacent faces inside a
 *    per-part smooth angle, so creases are exact and free (no
 *    `computeVertexNormals()` mush, no split-normal bookkeeping);
 *  - one merged geometry per material slot, routed PER FACE, so a single
 *    closed shell can be white outside and warm inside without a second
 *    surface and without any coplanar pair;
 *  - `unifyOrient()` makes a hand-authored closed shell consistently
 *    outward-facing by edge traversal + signed volume, which removes the
 *    entire class of inside-out-barrel bugs (notes.md S14).
 *
 * Everything is authored in the vehicle's own Y-up frame (+Z forward, +X
 * left) — deliberately NOT the friends Z-up convention, because a mirror at
 * emit would flip every winding on a part whose local axes are already the
 * vehicle's.
 */

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export interface MeshData {
  verts: Vec3[]
  /** Polygons, wound counter-clockwise seen from the outside. */
  faces: number[][]
  /** Per-face material slot; null = the caller's default slot. */
  faceSlot: (string | null)[]
  /** Per-face-corner UVs; null = derive planar UVs from the dominant axis. */
  faceUV: (Vec2[] | null)[]
  /** Crease threshold in degrees. 0 = flat shaded. */
  smooth: number
}

export function emptyMesh(smooth = 0): MeshData {
  return { verts: [], faces: [], faceSlot: [], faceUV: [], smooth }
}

export function mesh(verts: Vec3[], faces: number[][], smooth = 0): MeshData {
  return {
    verts: verts.map((v) => [v[0], v[1], v[2]] as Vec3),
    faces: faces.map((f) => f.slice()),
    faceSlot: faces.map(() => null),
    faceUV: faces.map(() => null),
    smooth,
  }
}

// ---------------------------------------------------------------- vector ops

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2])
  return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l]
}
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

// ------------------------------------------------------------- mesh assembly

export function join(parts: MeshData[], smooth?: number): MeshData {
  const out = emptyMesh(smooth ?? parts[0]?.smooth ?? 0)
  for (const part of parts) {
    const base = out.verts.length
    for (const v of part.verts) out.verts.push([v[0], v[1], v[2]])
    for (let i = 0; i < part.faces.length; i++) {
      out.faces.push(part.faces[i].map((k) => k + base))
      out.faceSlot.push(part.faceSlot[i])
      out.faceUV.push(part.faceUV[i])
    }
  }
  return out
}

export function setSlot(m: MeshData, slot: string): MeshData {
  for (let i = 0; i < m.faceSlot.length; i++) m.faceSlot[i] = slot
  return m
}

export function smoothShade(m: MeshData, angle: number): MeshData {
  m.smooth = angle
  return m
}

export function transform(m: MeshData, fn: (v: Vec3) => Vec3): MeshData {
  for (let i = 0; i < m.verts.length; i++) m.verts[i] = fn(m.verts[i])
  return m
}

export function translate(m: MeshData, d: Vec3): MeshData {
  return transform(m, (v) => [v[0] + d[0], v[1] + d[1], v[2] + d[2]])
}

export function rotateY(m: MeshData, a: number, pivot: Vec3 = [0, 0, 0]): MeshData {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return transform(m, (v) => {
    const x = v[0] - pivot[0]
    const z = v[2] - pivot[2]
    return [pivot[0] + x * c + z * s, v[1], pivot[2] - x * s + z * c]
  })
}

export function rotateX(m: MeshData, a: number, pivot: Vec3 = [0, 0, 0]): MeshData {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return transform(m, (v) => {
    const y = v[1] - pivot[1]
    const z = v[2] - pivot[2]
    return [v[0], pivot[1] + y * c - z * s, pivot[2] + y * s + z * c]
  })
}

export function rotateZ(m: MeshData, a: number, pivot: Vec3 = [0, 0, 0]): MeshData {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return transform(m, (v) => {
    const x = v[0] - pivot[0]
    const y = v[1] - pivot[1]
    return [pivot[0] + x * c - y * s, pivot[1] + x * s + y * c, v[2]]
  })
}

/** Mirror across x = 0, reversing every winding so normals stay outward. */
export function mirrorX(m: MeshData): MeshData {
  transform(m, (v) => [-v[0], v[1], v[2]])
  for (const f of m.faces) f.reverse()
  for (const uvs of m.faceUV) if (uvs) uvs.reverse()
  return m
}

export function flipFaces(m: MeshData): MeshData {
  for (const f of m.faces) f.reverse()
  for (const uvs of m.faceUV) if (uvs) uvs.reverse()
  return m
}

/**
 * Weld near-coincident vertices and drop degenerate faces. Every loft fold
 * and every collapsed ring leaves both behind, and shading breaks along the
 * whole edge loop wherever a normal is asked for at one (geometry-craft §2.6).
 */
export function cleanMesh(m: MeshData, dist = 2e-5): MeshData {
  const map = new Map<string, number>()
  const remap: number[] = new Array(m.verts.length)
  const verts: Vec3[] = []
  const q = 1 / dist
  for (let i = 0; i < m.verts.length; i++) {
    const v = m.verts[i]
    const key = `${Math.round(v[0] * q)},${Math.round(v[1] * q)},${Math.round(v[2] * q)}`
    const hit = map.get(key)
    if (hit === undefined) {
      map.set(key, verts.length)
      remap[i] = verts.length
      verts.push(v)
    } else {
      remap[i] = hit
    }
  }
  const faces: number[][] = []
  const faceSlot: (string | null)[] = []
  const faceUV: (Vec2[] | null)[] = []
  for (let f = 0; f < m.faces.length; f++) {
    const raw = m.faces[f].map((i) => remap[i])
    // Collapse consecutive duplicates (including the wrap-around pair).
    const poly: number[] = []
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== raw[(i + 1) % raw.length]) poly.push(raw[i])
    }
    if (poly.length < 3) continue
    if (polyArea(verts, poly) < 1e-11) continue
    faces.push(poly)
    faceSlot.push(m.faceSlot[f])
    faceUV.push(poly.length === m.faces[f].length ? m.faceUV[f] : null)
  }
  m.verts = verts
  m.faces = faces
  m.faceSlot = faceSlot
  m.faceUV = faceUV
  return m
}

function polyArea(verts: Vec3[], poly: number[]): number {
  let n: Vec3 = [0, 0, 0]
  for (let i = 0; i < poly.length; i++) {
    const a = verts[poly[i]]
    const b = verts[poly[(i + 1) % poly.length]]
    n = [
      n[0] + (a[1] - b[1]) * (a[2] + b[2]),
      n[1] + (a[2] - b[2]) * (a[0] + b[0]),
      n[2] + (a[0] - b[0]) * (a[1] + b[1]),
    ]
  }
  return Math.hypot(n[0], n[1], n[2]) * 0.5
}

/**
 * Make a closed hand-authored shell consistently wound and outward-facing:
 * flood-fill orientation across shared edges, then flip the whole component
 * if its signed volume is negative. This is why the tram's shells cannot ship
 * inside-out the way `PartWriter.tube` did for seven stages (notes.md S14).
 */
export function unifyOrient(m: MeshData): MeshData {
  const faceCount = m.faces.length
  if (faceCount === 0) return m
  const edgeMap = new Map<string, number[]>()
  const key = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (let f = 0; f < faceCount; f++) {
    const poly = m.faces[f]
    for (let i = 0; i < poly.length; i++) {
      const k = key(poly[i], poly[(i + 1) % poly.length])
      const list = edgeMap.get(k)
      if (list) list.push(f)
      else edgeMap.set(k, [f])
    }
  }
  const seen = new Uint8Array(faceCount)
  const components: number[][] = []
  for (let start = 0; start < faceCount; start++) {
    if (seen[start]) continue
    const stack = [start]
    const component: number[] = []
    seen[start] = 1
    while (stack.length) {
      const f = stack.pop() as number
      component.push(f)
      const poly = m.faces[f]
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        for (const other of edgeMap.get(key(a, b)) ?? []) {
          if (other === f || seen[other]) continue
          // Neighbour must traverse the shared edge in the OPPOSITE direction.
          const op = m.faces[other]
          let sameDir = false
          for (let j = 0; j < op.length; j++) {
            if (op[j] === a && op[(j + 1) % op.length] === b) sameDir = true
          }
          if (sameDir) {
            op.reverse()
            const uvs = m.faceUV[other]
            if (uvs) uvs.reverse()
          }
          seen[other] = 1
          stack.push(other)
        }
      }
    }
    components.push(component)
  }
  for (const component of components) {
    let volume = 0
    for (const f of component) {
      const poly = m.faces[f]
      const a = m.verts[poly[0]]
      for (let i = 1; i < poly.length - 1; i++) {
        const b = m.verts[poly[i]]
        const c = m.verts[poly[i + 1]]
        volume += dot(a, cross(b, c)) / 6
      }
    }
    if (volume < 0) {
      for (const f of component) {
        m.faces[f].reverse()
        const uvs = m.faceUV[f]
        if (uvs) uvs.reverse()
      }
    }
  }
  return m
}

// --------------------------------------------------------------- 2-D profiles

export function circle(r: number, segments: number, phase = 0): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const a = phase + (i / segments) * Math.PI * 2
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

export function roundedRect(w: number, h: number, r: number, seg = 3): Vec2[] {
  const rr = Math.min(r, w / 2, h / 2)
  const hw = w / 2 - rr
  const hh = h / 2 - rr
  const out: Vec2[] = []
  const corners: Array<[number, number, number]> = [
    [hw, hh, 0],
    [-hw, hh, Math.PI / 2],
    [-hw, -hh, Math.PI],
    [hw, -hh, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2)
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
    }
  }
  return out
}

export function arcPts(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segments: number,
): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments)
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/**
 * Offset an OPEN polyline by `d` to the right of travel, with a true segment
 * mitre clamped so sharp corners cannot spike (geometry-craft §2.3).
 */
export function offsetPolyline2D(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length
  const out: Vec2[] = []
  const rightOf = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [dy / l, -dx / l]
  }
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? rightOf(pts[i - 1], pts[i]) : null
    const next = i < n - 1 ? rightOf(pts[i], pts[i + 1]) : null
    let nx: number
    let ny: number
    let scale = 1
    if (prev && next) {
      nx = prev[0] + next[0]
      ny = prev[1] + next[1]
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      const cosHalf = Math.max(0.22, nx * prev[0] + ny * prev[1])
      scale = 1 / cosHalf
    } else {
      const one = (prev ?? next) as Vec2
      nx = one[0]
      ny = one[1]
    }
    out.push([pts[i][0] + nx * d * scale, pts[i][1] + ny * d * scale])
  }
  return out
}

/** Same, for a CLOSED counter-clockwise polygon; positive `d` grows it. */
export function polyOffset(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length
  const out: Vec2[] = []
  const outwardOf = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [dy / l, -dx / l]
  }
  for (let i = 0; i < n; i++) {
    const prev = outwardOf(poly[(i - 1 + n) % n], poly[i])
    const next = outwardOf(poly[i], poly[(i + 1) % n])
    let nx = prev[0] + next[0]
    let ny = prev[1] + next[1]
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    const cosHalf = Math.max(0.25, nx * prev[0] + ny * prev[1])
    out.push([poly[i][0] + nx * d / cosHalf, poly[i][1] + ny * d / cosHalf])
  }
  return out
}

// ------------------------------------------------------------------- sweeps

export interface LoftOptions {
  /** Wrap the last section point back to the first (closed cross-section). */
  closeSection?: boolean
  capStart?: boolean
  capEnd?: boolean
  smooth?: number
  /** Reverse every winding (use for inner/lining surfaces). */
  flip?: boolean
}

/**
 * The engine. `rings` are equal-length station rings. A section ordered so
 * that "right of travel" is the outward side, swept along +Z, produces
 * outward normals — the one convention the whole vehicle is built on.
 */
export function loft(rings: Vec3[][], options: LoftOptions = {}): MeshData {
  const m = emptyMesh(options.smooth ?? 0)
  const n = rings[0].length
  const stationCount = rings.length
  for (const ring of rings) for (const p of ring) m.verts.push([p[0], p[1], p[2]])
  const at = (i: number, j: number): number => i * n + j
  const last = options.closeSection ? n : n - 1
  for (let i = 0; i < stationCount - 1; i++) {
    for (let j = 0; j < last; j++) {
      const j2 = (j + 1) % n
      pushFace(m, [at(i, j), at(i, j2), at(i + 1, j2), at(i + 1, j)])
    }
  }
  if (options.capStart) pushFace(m, reversedRange(0, n))
  if (options.capEnd) pushFace(m, range((stationCount - 1) * n, n))
  if (options.flip) flipFaces(m)
  return m
}

function range(base: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(base + i)
  return out
}

function reversedRange(base: number, n: number): number[] {
  const out: number[] = []
  for (let i = n - 1; i >= 0; i--) out.push(base + i)
  return out
}

function pushFace(m: MeshData, poly: number[], slot: string | null = null, uv: Vec2[] | null = null): void {
  m.faces.push(poly)
  m.faceSlot.push(slot)
  m.faceUV.push(uv)
}

/** Quad strip bridging two equal-length loops (rims, jambs, reveals). */
export function bridge(a: Vec3[], b: Vec3[], options: { close?: boolean; smooth?: number } = {}): MeshData {
  const m = emptyMesh(options.smooth ?? 0)
  for (const p of a) m.verts.push([p[0], p[1], p[2]])
  for (const p of b) m.verts.push([p[0], p[1], p[2]])
  const n = a.length
  const limit = options.close ? n : n - 1
  for (let i = 0; i < limit; i++) {
    const j = (i + 1) % n
    pushFace(m, [i, j, n + j, n + i])
  }
  return m
}

/**
 * Lathe a (radius, y) profile about the Y axis. A profile point with radius
 * below `poleEps` welds to ONE pole vertex instead of a fan of coincident
 * ones (geometry-craft §10.2), so lamp domes and tyre hubs shade cleanly.
 */
export function revolveY(
  profile: Vec2[],
  segments: number,
  options: { smooth?: number; arc?: number; phase?: number } = {},
): MeshData {
  const m = emptyMesh(options.smooth ?? 40)
  const arc = options.arc ?? Math.PI * 2
  const closed = Math.abs(arc - Math.PI * 2) < 1e-6
  const count = closed ? segments : segments + 1
  const phase = options.phase ?? 0
  const poleEps = 1e-4
  const rowIndex: number[][] = []
  for (const p of profile) {
    if (p[0] < poleEps) {
      const idx = m.verts.length
      m.verts.push([0, p[1], 0])
      rowIndex.push([idx])
    } else {
      const row: number[] = []
      for (let s = 0; s < count; s++) {
        const a = phase + (s / segments) * arc
        row.push(m.verts.length)
        m.verts.push([Math.cos(a) * p[0], p[1], Math.sin(a) * p[0]])
      }
      rowIndex.push(row)
    }
  }
  const spans = closed ? segments : segments
  for (let i = 0; i < profile.length - 1; i++) {
    const lo = rowIndex[i]
    const hi = rowIndex[i + 1]
    for (let s = 0; s < spans; s++) {
      const s2 = (s + 1) % count
      if (lo.length === 1 && hi.length === 1) continue
      if (lo.length === 1) pushFace(m, [lo[0], hi[s2], hi[s]])
      else if (hi.length === 1) pushFace(m, [lo[s], lo[s2], hi[0]])
      else pushFace(m, [lo[s], lo[s2], hi[s2], hi[s]])
    }
  }
  return m
}

/**
 * Sweep a closed 2-D profile (across, up) along a polyline using
 * parallel-transported frames. `S x U = T` keeps the profile's CCW order
 * outward-facing, matching `loft`'s convention.
 */
export function tubeAlong(
  path: Vec3[],
  profile: Vec2[],
  options: { smooth?: number; capStart?: boolean; capEnd?: boolean; up?: Vec3 } = {},
): MeshData {
  const rings: Vec3[][] = []
  let side: Vec3 | null = null
  const refUp = options.up ?? [0, 1, 0]
  for (let i = 0; i < path.length; i++) {
    const tangent = norm(
      i === 0
        ? sub(path[1], path[0])
        : i === path.length - 1
          ? sub(path[i], path[i - 1])
          : sub(path[i + 1], path[i - 1]),
    )
    if (!side) {
      const seed = Math.abs(dot(tangent, refUp)) > 0.94 ? ([1, 0, 0] as Vec3) : refUp
      side = norm(cross(seed, tangent))
    } else {
      // Parallel transport: project the previous side onto the new normal plane.
      const projected = sub(side, mul(tangent, dot(side, tangent)))
      side = Math.hypot(projected[0], projected[1], projected[2]) < 1e-6 ? side : norm(projected)
    }
    const up = cross(tangent, side)
    rings.push(profile.map(([a, b]) => add(path[i], add(mul(side as Vec3, a), mul(up, b)))))
  }
  return loft(rings, {
    closeSection: true,
    capStart: options.capStart,
    capEnd: options.capEnd,
    smooth: options.smooth ?? 34,
  })
}

/** Extrude a CCW 2-D polygon along an axis; the classic section part. */
export function prism(
  poly: Vec2[],
  axis: 'x' | 'y' | 'z',
  a: number,
  b: number,
  smooth = 0,
): MeshData {
  const place = (p: Vec2, t: number): Vec3 =>
    axis === 'z' ? [p[0], p[1], t] : axis === 'y' ? [p[1], t, p[0]] : [t, p[0], p[1]]
  const rings = [poly.map((p) => place(p, a)), poly.map((p) => place(p, b))]
  const m = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth })
  return unifyOrient(m)
}

/**
 * Fill a closed 3-D loop with concentric rings collapsing to a centre, bulged
 * along `bulge`. Used for windshields and moulded fascia panels — never a
 * bare fan across a curved surface (the crest-roll trap, geometry-craft §10.2).
 */
export function fanRings(
  loop: Vec3[],
  centre: Vec3,
  rings: number,
  bulge: Vec3,
  smooth = 30,
): MeshData {
  const m = emptyMesh(smooth)
  const n = loop.length
  const rows: number[][] = []
  for (let r = 0; r < rings; r++) {
    const t = r / rings
    const b = 1 - (1 - t) * (1 - t)
    const row: number[] = []
    for (let i = 0; i < n; i++) {
      const p = lerp3(loop[i], centre, t)
      row.push(m.verts.length)
      m.verts.push(add(p, mul(bulge, b)))
    }
    rows.push(row)
  }
  const poleIndex = m.verts.length
  m.verts.push(add(centre, bulge))
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      pushFace(m, [rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]])
    }
  }
  const lastRow = rows[rings - 1]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    pushFace(m, [lastRow[i], lastRow[j], poleIndex])
  }
  return m
}

// ------------------------------------------------------------------- grid

export interface GridSurface {
  /** Corner points, `[stationIndex][sectionIndex]`. */
  outer: Vec3[][]
  inner: Vec3[][]
}

/**
 * Welded-grid shell with real apertures — the boolean replacement
 * (geometry-craft §2.4). Emits the outer skin, the inner lining, and a reveal
 * quad exactly where a solid cell borders a missing one, so every hole has
 * jambs of real thickness and nothing is coplanar or cracked.
 */
export function apertureShell(
  surface: GridSurface,
  options: {
    solid: (station: number, section: number) => boolean
    closeSection?: boolean
    outerSlot: (station: number, section: number) => string
    innerSlot: (station: number, section: number) => string
    revealSlot: (station: number, section: number) => string
    smooth?: number
  },
): MeshData {
  const { outer, inner } = surface
  const stations = outer.length
  const n = outer[0].length
  const m = emptyMesh(options.smooth ?? 32)
  for (const ring of outer) for (const p of ring) m.verts.push([p[0], p[1], p[2]])
  const innerBase = m.verts.length
  for (const ring of inner) for (const p of ring) m.verts.push([p[0], p[1], p[2]])
  const O = (i: number, j: number): number => i * n + j
  const I = (i: number, j: number): number => innerBase + i * n + j
  const wrap = options.closeSection ?? false
  const lastSection = wrap ? n : n - 1
  const solid = (i: number, j: number): boolean => {
    if (i < 0 || i >= stations - 1) return false
    if (!wrap && (j < 0 || j >= n - 1)) return false
    const jj = wrap ? (j + n) % n : j
    return options.solid(i, jj)
  }

  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < lastSection; j++) {
      if (!solid(i, j)) continue
      const j2 = (j + 1) % n
      pushFace(m, [O(i, j), O(i, j2), O(i + 1, j2), O(i + 1, j)], options.outerSlot(i, j))
      pushFace(m, [I(i, j), I(i + 1, j), I(i + 1, j2), I(i, j2)], options.innerSlot(i, j))
      // Reveals: a wall of real thickness wherever the neighbour cell is gone.
      const reveal = options.revealSlot(i, j)
      if (!solid(i, j - 1)) pushFace(m, [O(i, j), O(i + 1, j), I(i + 1, j), I(i, j)], reveal)
      if (!solid(i, j + 1)) pushFace(m, [O(i + 1, j2), O(i, j2), I(i, j2), I(i + 1, j2)], reveal)
      if (!solid(i - 1, j)) pushFace(m, [O(i, j2), O(i, j), I(i, j), I(i, j2)], reveal)
      if (!solid(i + 1, j)) pushFace(m, [O(i + 1, j), O(i + 1, j2), I(i + 1, j2), I(i + 1, j)], reveal)
    }
  }
  return m
}

// ------------------------------------------------------------------- output

interface SlotBuffer {
  positions: number[]
  normals: number[]
  uvs: number[]
}

/** One merged geometry per material slot, faces routed individually. */
export class SlotMesh {
  private readonly slots = new Map<string, SlotBuffer>()
  triangles = 0
  parts = 0

  private buffer(name: string): SlotBuffer {
    let slot = this.slots.get(name)
    if (!slot) {
      slot = { positions: [], normals: [], uvs: [] }
      this.slots.set(name, slot)
    }
    return slot
  }

  /** Weld, compute crease-exact corner normals, triangulate, and bucket. */
  add(m: MeshData, defaultSlot: string): void {
    this.parts++
    cleanMesh(m)
    const faceCount = m.faces.length
    if (faceCount === 0) return
    const faceN: Vec3[] = new Array(faceCount)
    for (let f = 0; f < faceCount; f++) faceN[f] = faceNormal(m, f)
    const vertFaces: number[][] = m.verts.map(() => [])
    for (let f = 0; f < faceCount; f++) for (const v of m.faces[f]) vertFaces[v].push(f)
    const cosLimit = m.smooth > 0 ? Math.cos((m.smooth * Math.PI) / 180) : 2
    const cornerNormal = (vi: number, fi: number): Vec3 => {
      if (m.smooth <= 0) return faceN[fi]
      let x = 0
      let y = 0
      let z = 0
      for (const o of vertFaces[vi]) {
        if (dot(faceN[fi], faceN[o]) >= cosLimit - 1e-9) {
          x += faceN[o][0]
          y += faceN[o][1]
          z += faceN[o][2]
        }
      }
      const l = Math.hypot(x, y, z)
      return l < 1e-9 ? faceN[fi] : [x / l, y / l, z / l]
    }
    for (let f = 0; f < faceCount; f++) {
      const poly = m.faces[f]
      const slot = this.buffer(m.faceSlot[f] ?? defaultSlot)
      const uvs = m.faceUV[f] ?? planarUV(m, poly, faceN[f])
      for (let i = 1; i < poly.length - 1; i++) {
        for (const k of [0, i, i + 1]) {
          const vi = poly[k]
          const p = m.verts[vi]
          const nrm = cornerNormal(vi, f)
          slot.positions.push(p[0], p[1], p[2])
          slot.normals.push(nrm[0], nrm[1], nrm[2])
          slot.uvs.push(uvs[k][0], uvs[k][1])
        }
        this.triangles++
      }
    }
  }

  build(materials: Record<string, Material>): Group {
    const group = new Group()
    for (const [name, slot] of this.slots) {
      if (slot.positions.length === 0) continue
      const material = materials[name]
      if (!material) throw new Error(`SlotMesh: no material bound for slot "${name}"`)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(slot.positions), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(slot.normals), 3))
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(slot.uvs), 2))
      const mesh3 = new Mesh(geometry, material)
      mesh3.castShadow = true
      mesh3.receiveShadow = true
      mesh3.name = `tram:${name}`
      group.add(mesh3)
    }
    return group
  }
}

function faceNormal(m: MeshData, f: number): Vec3 {
  const poly = m.faces[f]
  let n: Vec3 = [0, 0, 0]
  for (let i = 0; i < poly.length; i++) {
    const a = m.verts[poly[i]]
    const b = m.verts[poly[(i + 1) % poly.length]]
    n = [
      n[0] + (a[1] - b[1]) * (a[2] + b[2]),
      n[1] + (a[2] - b[2]) * (a[0] + b[0]),
      n[2] + (a[0] - b[0]) * (a[1] + b[1]),
    ]
  }
  return norm(n)
}

/** Planar UVs from the dominant axis. Materials are procedural; this is a
 *  fallback so anything that samples `uv` still gets a sane world scale. */
function planarUV(m: MeshData, poly: number[], n: Vec3): Vec2[] {
  const ax = Math.abs(n[0])
  const ay = Math.abs(n[1])
  const az = Math.abs(n[2])
  return poly.map((vi) => {
    const p = m.verts[vi]
    if (ax >= ay && ax >= az) return [p[2], p[1]] as Vec2
    if (ay >= az) return [p[0], p[2]] as Vec2
    return [p[0], p[1]] as Vec2
  })
}
