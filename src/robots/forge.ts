import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three'
import type { Material } from 'three'

/**
 * Robot geometry forge — the *friends* authoring model (geometry-craft §1-2)
 * scaled to machine-sized parts: polygons first, triangles last.
 *
 * A `Solid` is a polygon soup (quads and n-gons) in the robot's LOCAL frame
 * (+X right, +Y up, +Z forward, origin at ground contact). Curves come from
 * profiles that get swept — `prism`, `revolveY`, `tube`, `loft` — never from
 * scaled cubes. Every part carries its own crease angle, and normals are
 * averaged per face-corner only inside that angle, so a bullnose stays round
 * and a machined flat stays flat with no split-normal bookkeeping.
 *
 * Parts are welded and emitted INDIVIDUALLY into per-material slots: two parts
 * that merely touch never smooth into each other, while a shell joined with
 * `join()` before `add()` welds into one continuous surface.
 *
 * Winding convention (one rule, used everywhere): rings advance along the
 * travel axis and their points run counter-clockwise about that axis by the
 * right-hand rule. Every sweep below already obeys it; profiles handed to
 * `prism` are CCW in their own plane, and closed `revolveY` loops are CCW in
 * the (radius, height) plane.
 */

export type V2 = [number, number]
export type V3 = [number, number, number]

export interface Solid {
  verts: V3[]
  faces: number[][]
  /** Crease threshold in degrees; 0 emits flat-shaded faces. */
  smooth: number
}

const TAU = Math.PI * 2

// ---------------------------------------------------------------- vector ops

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

// ------------------------------------------------------------------ profiles

/** CCW rounded rectangle centered on the origin (true arc corners). */
export function roundedRect(width: number, height: number, radius: number, seg = 3): V2[] {
  const r = Math.min(radius, Math.min(width, height) / 2 - 1e-6)
  const hx = width / 2 - r
  const hy = height / 2 - r
  const points: V2[] = []
  const corners: Array<[number, number, number]> = [
    [hx, hy, 0],
    [-hx, hy, Math.PI / 2],
    [-hx, -hy, Math.PI],
    [hx, -hy, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2)
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  return points
}

/** CCW circle in the profile plane. */
export function circleProfile(radius: number, seg: number, phase = 0): V2[] {
  return Array.from({ length: seg }, (_, s): V2 => {
    const a = phase + (s / seg) * TAU
    return [Math.cos(a) * radius, Math.sin(a) * radius]
  })
}

/** Arc of points (open) — silhouettes and paths. */
export function arcPts(
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  seg: number,
): V2[] {
  return Array.from({ length: seg + 1 }, (_, k): V2 => {
    const a = a0 + ((a1 - a0) * k) / seg
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]
  })
}

/** Signed area — positive when the loop runs counter-clockwise. */
export function signedArea(poly: V2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** Hand-authored silhouettes get their winding fixed once, at the source. */
export function ensureCCW(poly: V2[]): V2[] {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly
}

/**
 * Mitred polygon offset (+ outward for a CCW loop). The 1/cos mitre scale is
 * clamped so sharp corners cannot throw spikes; offsetting a rounded corner by
 * its own radius collapses it to a point, which is exactly how a filleted end
 * cap is built.
 */
export function polyOffset(poly: V2[], d: number): V2[] {
  const n = poly.length
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n]
    const next = poly[(i + 1) % n]
    const e0: V2 = [p[0] - prev[0], p[1] - prev[1]]
    const e1: V2 = [next[0] - p[0], next[1] - p[1]]
    const l0 = Math.hypot(e0[0], e0[1]) || 1
    const l1 = Math.hypot(e1[0], e1[1]) || 1
    // Outward normal of a CCW edge is the edge direction turned -90 degrees.
    const n0: V2 = [e0[1] / l0, -e0[0] / l0]
    const n1: V2 = [e1[1] / l1, -e1[0] / l1]
    const bx = n0[0] + n1[0]
    const by = n0[1] + n1[1]
    const bl = Math.hypot(bx, by)
    if (bl < 1e-9) return [p[0], p[1]] as V2
    const bis: V2 = [bx / bl, by / bl]
    const scale = 1 / Math.max(0.25, bis[0] * n1[0] + bis[1] * n1[1])
    return [p[0] + bis[0] * d * scale, p[1] + bis[1] * d * scale] as V2
  })
}

// -------------------------------------------------------------------- sweeps

export interface LoftOptions {
  /** Rings are closed loops (u wraps). Default true. */
  closed?: boolean
  capStart?: boolean
  capEnd?: boolean
  smooth?: number
}

/** The engine: stacked rings of equal length become a quad-only shell. */
export function loft(rings: V3[][], options: LoftOptions = {}): Solid {
  const closed = options.closed ?? true
  const n = rings[0].length
  const verts: V3[] = []
  for (const ring of rings) for (const p of ring) verts.push([p[0], p[1], p[2]])
  const faces: number[][] = []
  const index = (i: number, s: number): number => i * n + (s % n)
  const spans = closed ? n : n - 1
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < spans; s++) {
      faces.push([index(i, s), index(i, s + 1), index(i + 1, s + 1), index(i + 1, s)])
    }
  }
  if (options.capStart) faces.push(Array.from({ length: n }, (_, s) => index(0, n - 1 - s)))
  if (options.capEnd) faces.push(Array.from({ length: n }, (_, s) => index(rings.length - 1, s)))
  return { verts, faces, smooth: options.smooth ?? 0 }
}

export interface PrismOptions {
  /** End fillet radius — the "inset end stations" that roll a raw extrusion. */
  roll?: number
  rollSeg?: number
  smooth?: number
  capStart?: boolean
  capEnd?: boolean
  center?: V3
}

/**
 * Extrude a CCW profile along an axis with rolled ends. `axis` names the
 * travel direction; the profile's (u, v) ride the right-handed pair
 * (x: y,z · y: z,x · z: x,y) so winding needs no thought at the call site.
 */
export function prism(
  profile: V2[],
  axis: 'x' | 'y' | 'z',
  a0: number,
  a1: number,
  options: PrismOptions = {},
): Solid {
  const roll = options.roll ?? 0
  const rollSeg = options.rollSeg ?? 2
  const c = options.center ?? [0, 0, 0]
  const place = (u: number, v: number, a: number): V3 =>
    axis === 'z'
      ? [c[0] + u, c[1] + v, c[2] + a]
      : axis === 'x'
        ? [c[0] + a, c[1] + u, c[2] + v]
        : [c[0] + v, c[1] + a, c[2] + u]

  const stations: Array<[number, number]> = [] // [inset, along]
  if (roll > 1e-6) {
    const span = Math.abs(a1 - a0)
    const r = Math.min(roll, span / 2 - 1e-5)
    for (let k = 0; k <= rollSeg; k++) {
      const a = (k / rollSeg) * (Math.PI / 2)
      stations.push([r * (1 - Math.sin(a)), a0 + r * (1 - Math.cos(a))])
    }
    for (let k = rollSeg; k >= 0; k--) {
      const a = (k / rollSeg) * (Math.PI / 2)
      stations.push([r * (1 - Math.sin(a)), a1 - r * (1 - Math.cos(a))])
    }
  } else {
    stations.push([0, a0], [0, a1])
  }

  const rings = stations.map(([inset, along]) => {
    const poly = inset > 1e-7 ? polyOffset(profile, -inset) : profile
    return poly.map(([u, v]) => place(u, v, along))
  })
  return loft(rings, {
    closed: true,
    capStart: options.capStart ?? true,
    capEnd: options.capEnd ?? true,
    smooth: options.smooth ?? 34,
  })
}

/** True filleted box — a rounded rectangle extruded with rolled ends. */
export function filletBox(
  center: V3,
  size: V3,
  radius: number,
  options: { seg?: number; smooth?: number; axis?: 'x' | 'y' | 'z' } = {},
): Solid {
  const axis = options.axis ?? 'z'
  const seg = options.seg ?? 2
  const [sx, sy, sz] = size
  const [w, h, len] =
    axis === 'z' ? [sx, sy, sz] : axis === 'x' ? [sy, sz, sx] : [sz, sx, sy]
  const r = Math.min(radius, Math.min(w, h, len) / 2 - 1e-5)
  return prism(roundedRect(w, h, r, seg), axis, -len / 2, len / 2, {
    roll: r,
    rollSeg: seg,
    center,
    smooth: options.smooth ?? 32,
  })
}

export interface RevolveOptions {
  segments?: number
  center?: V3
  smooth?: number
  capStart?: boolean
  capEnd?: boolean
}

/**
 * Revolve a (radius, height) profile about +Y. Open profiles run bottom→top;
 * closed loops run CCW in the (r, y) plane. A profile point at radius 0 welds
 * to a single pole vertex instead of a fan of coincident ones.
 */
export function revolveY(profile: V2[], options: RevolveOptions = {}): Solid {
  const segments = options.segments ?? 24
  const c = options.center ?? [0, 0, 0]
  const rings = profile.map(([r, y]) =>
    Array.from({ length: segments }, (_, s): V3 => {
      const a = -(s / segments) * TAU
      return [c[0] + Math.cos(a) * r, c[1] + y, c[2] + Math.sin(a) * r]
    }),
  )
  return loft(rings, {
    closed: true,
    capStart: (options.capStart ?? false) && profile[0][0] > 1e-6,
    capEnd: (options.capEnd ?? false) && profile[profile.length - 1][0] > 1e-6,
    smooth: options.smooth ?? 40,
  })
}

export interface TubeOptions {
  smooth?: number
  capStart?: boolean
  capEnd?: boolean
  /** Reference vector for the first frame (default +Y, or +X if parallel). */
  up?: V3
}

/**
 * Sweep a CCW profile along a path with parallel-transport frames — the frame
 * rotates by the minimum turn between consecutive tangents, so a curved run
 * carries no accumulated twist.
 */
export function tube(path: V3[], profile: V2[], options: TubeOptions = {}): Solid {
  const tangents: V3[] = path.map((_, i) =>
    norm(
      i === 0
        ? sub(path[1], path[0])
        : i === path.length - 1
          ? sub(path[i], path[i - 1])
          : sub(path[i + 1], path[i - 1]),
    ),
  )
  const reference = options.up ?? [0, 1, 0]
  const seed = Math.abs(dot3(reference, tangents[0])) > 0.94 ? ([1, 0, 0] as V3) : reference
  let side = norm(cross(seed, tangents[0]))
  const rings: V3[][] = []
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      // Rodrigues rotation of the previous frame onto the new tangent.
      const axis = cross(tangents[i - 1], tangents[i])
      const sin = Math.hypot(axis[0], axis[1], axis[2])
      if (sin > 1e-7) {
        const k = norm(axis)
        const cos = Math.max(-1, Math.min(1, dot3(tangents[i - 1], tangents[i])))
        const kc = cross(k, side)
        const kd = dot3(k, side) * (1 - cos)
        side = norm([
          side[0] * cos + kc[0] * sin + k[0] * kd,
          side[1] * cos + kc[1] * sin + k[1] * kd,
          side[2] * cos + kc[2] * sin + k[2] * kd,
        ])
      }
    }
    const up = cross(tangents[i], side)
    const p = path[i]
    rings.push(
      profile.map(([u, v]): V3 => [
        p[0] + side[0] * u + up[0] * v,
        p[1] + side[1] * u + up[1] * v,
        p[2] + side[2] * u + up[2] * v,
      ]),
    )
  }
  return loft(rings, {
    closed: true,
    capStart: options.capStart ?? true,
    capEnd: options.capEnd ?? true,
    smooth: options.smooth ?? 40,
  })
}

/** Round pipe convenience. */
export function pipe(
  path: V3[],
  radius: number,
  options: TubeOptions & { seg?: number } = {},
): Solid {
  return tube(path, circleProfile(radius, options.seg ?? 10), options)
}

// ------------------------------------------------------------- transforms

export function translate(s: Solid, t: V3): Solid {
  for (const v of s.verts) {
    v[0] += t[0]
    v[1] += t[1]
    v[2] += t[2]
  }
  return s
}

function rotate(s: Solid, axis: 0 | 1 | 2, angle: number, pivot: V3 = [0, 0, 0]): Solid {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1]
  for (const v of s.verts) {
    const a = v[i] - pivot[i]
    const b = v[j] - pivot[j]
    v[i] = pivot[i] + a * cos - b * sin
    v[j] = pivot[j] + a * sin + b * cos
  }
  return s
}

export const rotateX = (s: Solid, a: number, pivot?: V3): Solid => rotate(s, 0, a, pivot)
export const rotateY = (s: Solid, a: number, pivot?: V3): Solid => rotate(s, 1, a, pivot)
export const rotateZ = (s: Solid, a: number, pivot?: V3): Solid => rotate(s, 2, a, pivot)

/** Mirror across X — winding is reversed with the vertices, never after. */
export function mirrorX(s: Solid): Solid {
  for (const v of s.verts) v[0] = -v[0]
  for (const f of s.faces) f.reverse()
  return s
}

export function clone(s: Solid): Solid {
  return {
    verts: s.verts.map((v): V3 => [v[0], v[1], v[2]]),
    faces: s.faces.map((f) => f.slice()),
    smooth: s.smooth,
  }
}

/** Concatenate parts into ONE shell — they weld and smooth together on emit. */
export function join(parts: Solid[], smooth?: number): Solid {
  const verts: V3[] = []
  const faces: number[][] = []
  for (const part of parts) {
    const base = verts.length
    for (const v of part.verts) verts.push([v[0], v[1], v[2]])
    for (const f of part.faces) faces.push(f.map((i) => i + base))
  }
  return { verts, faces, smooth: smooth ?? parts[0]?.smooth ?? 0 }
}

// ------------------------------------------------------------------- emitter

/** Weld at 0.02 mm and drop faces that lost their area (loft poles, collapses). */
function weld(s: Solid): Solid {
  const map = new Map<string, number>()
  const verts: V3[] = []
  const remap = s.verts.map((v) => {
    const key = `${Math.round(v[0] * 5e4)},${Math.round(v[1] * 5e4)},${Math.round(v[2] * 5e4)}`
    let index = map.get(key)
    if (index === undefined) {
      index = verts.length
      map.set(key, index)
      verts.push([v[0], v[1], v[2]])
    }
    return index
  })
  const faces: number[][] = []
  for (const f of s.faces) {
    const out: number[] = []
    for (const i of f) {
      const w = remap[i]
      if (out.length === 0 || out[out.length - 1] !== w) out.push(w)
    }
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop()
    if (out.length >= 3) faces.push(out)
  }
  return { verts, faces, smooth: s.smooth }
}

function faceNormal(verts: V3[], face: number[]): V3 | null {
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
  const l = Math.hypot(nx, ny, nz)
  if (l < 1e-12) return null
  return [nx / l, ny / l, nz / l]
}

/**
 * Ear-clip an n-gon on its own plane. A fan from vertex 0 is only valid for a
 * convex cap; the moulded-shell sections here are U-bands (open underneath),
 * and a fan across one of those emits inverted, overlapping triangles.
 */
function earClip(verts: V3[], face: number[], normal: V3): Array<[number, number, number]> {
  const ax = Math.abs(normal[0])
  const ay = Math.abs(normal[1])
  const az = Math.abs(normal[2])
  const drop = ax > ay && ax > az ? 0 : ay > az ? 1 : 2
  const sign = normal[drop] >= 0 ? 1 : -1
  const flat = (i: number): V2 => {
    const p = verts[i]
    // Drop the dominant axis; the remaining pair keeps the winding when the
    // normal points along +axis, and is swapped when it points along -axis.
    const pair: V2 = drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[2], p[0]] : [p[0], p[1]]
    return sign > 0 ? pair : [pair[1], pair[0]]
  }
  const loop = face.slice()
  const out: Array<[number, number, number]> = []
  const cross2 = (o: V2, a: V2, b: V2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  let guard = loop.length * loop.length + 8
  while (loop.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < loop.length; i++) {
      const ia = loop[(i - 1 + loop.length) % loop.length]
      const ib = loop[i]
      const ic = loop[(i + 1) % loop.length]
      const a = flat(ia)
      const b = flat(ib)
      const c = flat(ic)
      if (cross2(a, b, c) <= 1e-12) continue // reflex or degenerate
      let clean = true
      for (const other of loop) {
        if (other === ia || other === ib || other === ic) continue
        const p = flat(other)
        if (
          cross2(a, b, p) >= -1e-12 &&
          cross2(b, c, p) >= -1e-12 &&
          cross2(c, a, p) >= -1e-12
        ) {
          clean = false
          break
        }
      }
      if (!clean) continue
      out.push([ia, ib, ic])
      loop.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  for (let i = 1; i < loop.length - 1; i++) out.push([loop[0], loop[i], loop[i + 1]])
  return out
}

interface SlotBuffer {
  positions: number[]
  normals: number[]
}

/** Per-material accumulation for one machine; one merged mesh per slot. */
export class Forge {
  private readonly slots = new Map<string, SlotBuffer>()
  private triangles = 0

  add(slotName: string, part: Solid): this {
    const s = weld(part)
    const normals: Array<V3 | null> = s.faces.map((f) => faceNormal(s.verts, f))
    const adjacency: number[][] = s.verts.map(() => [])
    s.faces.forEach((f, fi) => {
      if (!normals[fi]) return
      for (const i of f) adjacency[i].push(fi)
    })
    const cosLimit = s.smooth > 0 ? Math.cos((s.smooth * Math.PI) / 180) : 2
    const cornerNormal = (vi: number, fi: number): V3 => {
      const face = normals[fi] as V3
      if (s.smooth <= 0) return face
      let x = 0
      let y = 0
      let z = 0
      for (const other of adjacency[vi]) {
        const n = normals[other] as V3
        if (dot3(face, n) >= cosLimit - 1e-9) {
          x += n[0]
          y += n[1]
          z += n[2]
        }
      }
      const l = Math.hypot(x, y, z)
      return l < 1e-9 ? face : [x / l, y / l, z / l]
    }

    let buffer = this.slots.get(slotName)
    if (!buffer) {
      buffer = { positions: [], normals: [] }
      this.slots.set(slotName, buffer)
    }
    const emit = (fi: number, a: number, b: number, c: number): void => {
      for (const vi of [a, b, c]) {
        const p = s.verts[vi]
        const n = cornerNormal(vi, fi)
        buffer!.positions.push(p[0], p[1], p[2])
        buffer!.normals.push(n[0], n[1], n[2])
      }
      this.triangles++
    }
    s.faces.forEach((f, fi) => {
      if (!normals[fi]) return
      if (f.length === 3) {
        emit(fi, f[0], f[1], f[2])
      } else if (f.length === 4) {
        // Split on the shorter diagonal so a warped quad stays convex.
        const d02 = dist(s.verts[f[0]], s.verts[f[2]])
        const d13 = dist(s.verts[f[1]], s.verts[f[3]])
        if (d02 <= d13) {
          emit(fi, f[0], f[1], f[2])
          emit(fi, f[0], f[2], f[3])
        } else {
          emit(fi, f[1], f[2], f[3])
          emit(fi, f[1], f[3], f[0])
        }
      } else {
        for (const [a, b, c] of earClip(s.verts, f, normals[fi] as V3)) emit(fi, a, b, c)
      }
    })
    return this
  }

  /** Convenience: several parts into the same slot. */
  addAll(slotName: string, parts: Solid[]): this {
    for (const part of parts) this.add(slotName, part)
    return this
  }

  get triangleCount(): number {
    return this.triangles
  }

  build(materials: Record<string, Material>, options?: { castShadow?: boolean }): Group {
    const group = new Group()
    for (const [name, buffer] of this.slots) {
      if (buffer.positions.length === 0) continue
      const material = materials[name]
      if (!material) throw new Error(`Forge: no material bound for slot "${name}"`)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffer.positions), 3))
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffer.normals), 3))
      const mesh = new Mesh(geometry, material)
      mesh.castShadow = options?.castShadow ?? true
      mesh.receiveShadow = true
      mesh.name = `robot:${name}`
      group.add(mesh)
    }
    group.userData.triangles = this.triangles
    return group
  }
}

function dist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
