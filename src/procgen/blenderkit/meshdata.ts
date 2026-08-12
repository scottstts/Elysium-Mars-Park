/**
 * The n-gon mesh container plus the Blender operations `optlib` relies on.
 * Faces stay as n-gons until the very end so polygon normals and the bevel
 * see exactly the topology Blender saw.
 */
import { R } from './mathkit'
import type { Vec3 } from './mathkit'
import { mat4Apply, mat4FromEulerXYZ, mat4Mul, mat4Scale, mat4Translation } from './transform'
import type { Mat4 } from './transform'

/* ==========================================================================
   2. mesh container + the Blender operations optlib relies on
        weld()   -> bmesh.ops.remove_doubles + recalc_face_normals
        shade()  -> polygon use_smooth + edge sharp marking
        xform()  -> Mesh.transform()
      Faces stay as n-gons until the very end so polygon normals and the
      bevel see exactly the topology Blender saw.
   ========================================================================== */

export const FG_ORIG = 0;      /* face came from the generator                       */
export const FG_BEVEL = 1;     /* face produced by the bevel modifier (hard normals) */

export class Mesh {
  name: string
  v: Vec3[]
  f: number[][]
  fm: number[]
  fg: number[]
  mats: string[]
  smooth: boolean
  sharpDeg: number | null
  bevel: { width: number; segments: number; angle: number } | null
  /** Owning collection key, stamped by `meshObj` (see collections.ts). */
  coll: string | null

  constructor(name: string, verts: Vec3[] = [], faces: number[][] = []) {
    this.name = name;
    this.v = verts.map((p): Vec3 => [p[0], p[1], p[2]]);
    this.f = faces.map(t => Array.from(t));
    this.fm = this.f.map(() => 0);       /* material slot per face            */
    this.fg = this.f.map(() => FG_ORIG); /* face group                        */
    this.mats = [];                      /* material names, indexed by fm     */
    this.smooth = true;                  /* polygon use_smooth                */
    this.sharpDeg = null;                /* shade(..., sharp_angle)           */
    this.bevel = null;                   /* pending BEVEL modifier            */
    this.coll = null;
  }

  clone(name?: string): Mesh {
    const m = new Mesh(name || this.name, this.v, this.f);
    m.fm = this.fm.slice(); m.fg = this.fg.slice(); m.mats = this.mats.slice();
    m.smooth = this.smooth; m.sharpDeg = this.sharpDeg;
    m.bevel = this.bevel ? { ...this.bevel } : null;
    return m;
  }

  transform(m4: Mat4): Mesh { this.v = this.v.map(p => mat4Apply(m4, p)); return this; }

  flipNormals(): Mesh { this.f = this.f.map(t => t.slice().reverse()); return this; }

  /* polygon normal, Blender/Newell */
  faceNormal(fi: number): Vec3 {
    const t = this.f[fi], n = t.length;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const a = this.v[t[i]], b = this.v[t[(i + 1) % n]];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    return l > 0 ? [nx / l, ny / l, nz / l] : [0, 0, 1];
  }

  faceCentre(fi: number): Vec3 {
    const t = this.f[fi];
    let x = 0, y = 0, z = 0;
    for (const i of t) { x += this.v[i][0]; y += this.v[i][1]; z += this.v[i][2]; }
    return [x / t.length, y / t.length, z / t.length];
  }

  get faceCount(): number { return this.f.length; }
}

/* ---- bmesh.ops.remove_doubles ------------------------------------------ */
/* Blender merges each duplicate into the first vertex it finds within
   `dist`, keeping that vertex's coordinates; then faces that end up with
   fewer than three distinct corners are deleted.  This is what collapses the
   1e-6 "pole" rings of loft() into a single point and what removes the
   zero-width seam ring of pillow(). */
export const cellHash = (gx: number, gy: number, gz: number): number => (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(gz, 83492791)) | 0;

export function weldVerts(mesh: Mesh, dist = 2e-5): Mesh {
  const n = mesh.v.length;
  const cell = Math.max(dist, 1e-9) * 2.0;
  const grid = new Map<number, number[]>();
  const map = new Int32Array(n).fill(-1);
  const newV: Vec3[] = [];
  const d2 = dist * dist;
  for (let i = 0; i < n; i++) {
    const p = mesh.v[i];
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
    let found = -1;
    for (let a = -1; a <= 1 && found < 0; a++)
      for (let b = -1; b <= 1 && found < 0; b++)
        for (let c = -1; c <= 1 && found < 0; c++) {
          const bucket = grid.get(cellHash(gx + a, gy + b, gz + c));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const q = newV[bucket[bi]];
            const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
            if (dx * dx + dy * dy + dz * dz <= d2) { found = bucket[bi]; break; }
          }
        }
    if (found >= 0) { map[i] = found; continue; }
    const idx = newV.length;
    newV.push([p[0], p[1], p[2]]);
    map[i] = idx;
    const k = cellHash(gx, gy, gz);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(idx);
  }

  const nf: number[][] = [], nfm: number[] = [], nfg: number[] = [];
  const seen = new Set<string>();
  for (let fi = 0; fi < mesh.f.length; fi++) {
    const src = mesh.f[fi];
    const out: number[] = [];
    for (const vi of src) {
      const m = map[vi];
      if (out.length === 0 || out[out.length - 1] !== m) out.push(m);
    }
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    if (out.length < 3) continue;
    /* drop exact duplicate faces (same corner set) the way bmesh does */
    const sig = out.slice().sort((a, b) => a - b).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    nf.push(out); nfm.push(mesh.fm[fi]); nfg.push(mesh.fg[fi]);
  }
  mesh.v = newV; mesh.f = nf; mesh.fm = nfm; mesh.fg = nfg;
  return mesh;
}

/* ---- bmesh.ops.recalc_face_normals ------------------------------------- */
/* make each connected shell consistently wound, then flip whole shells whose
   enclosed signed volume is negative (i.e. point them outward) */
export function recalcFaceNormals(mesh: Mesh): Mesh {
  const F = mesh.f;
  const nf = F.length;
  if (!nf) return mesh;

  /* edge -> list of (face, dir) */
  const EK = mesh.v.length + 1;
  const ekey = (a: number, b: number): number => (a < b ? a * EK + b : b * EK + a);
  const edges = new Map<number, Array<[number, number]>>();
  for (let fi = 0; fi < nf; fi++) {
    const t = F[fi], n = t.length;
    for (let i = 0; i < n; i++) {
      const a = t[i], b = t[(i + 1) % n];
      const k = ekey(a, b);
      let e = edges.get(k);
      if (!e) { e = []; edges.set(k, e); }
      e.push([fi, a < b ? 1 : -1]);
    }
  }

  const flip = new Uint8Array(nf);
  const comp = new Int32Array(nf).fill(-1);
  let nComp = 0;
  const adj: Array<Array<[number, boolean]>> = new Array(nf); for (let i = 0; i < nf; i++) adj[i] = [];
  for (const e of edges.values()) {
    if (e.length !== 2) continue;
    adj[e[0][0]].push([e[1][0], e[0][1] === e[1][1]]);   /* true -> needs flip */
    adj[e[1][0]].push([e[0][0], e[0][1] === e[1][1]]);
  }
  for (let s = 0; s < nf; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = nComp; flip[s] = 0;
    const members = [s];
    while (stack.length) {
      const fi = stack.pop()!;
      for (const [fj, needFlip] of adj[fi]) {
        if (comp[fj] >= 0) continue;
        comp[fj] = nComp;
        flip[fj] = needFlip ? (flip[fi] ^ 1) : flip[fi];
        members.push(fj);
        stack.push(fj);
      }
    }
    /* signed volume of this shell with the tentative winding */
    let vol = 0;
    for (const fi of members) {
      const t = F[fi];
      const ord = flip[fi] ? t.slice().reverse() : t;
      const p0 = mesh.v[ord[0]];
      for (let i = 1; i < ord.length - 1; i++) {
        const p1 = mesh.v[ord[i]], p2 = mesh.v[ord[i + 1]];
        vol += (p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
              - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
              + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])) / 6.0;
      }
    }
    if (vol < 0) for (const fi of members) flip[fi] ^= 1;
    nComp++;
  }
  for (let fi = 0; fi < nf; fi++) if (flip[fi]) F[fi] = F[fi].slice().reverse();
  return mesh;
}

/* optlib.weld */
export function weld(mesh: Mesh, dist = 2e-5): Mesh {
  weldVerts(mesh, dist);
  recalcFaceNormals(mesh);
  return mesh;
}

/* optlib.shade */
export function shade(mesh: Mesh, smooth = true, sharpAngle: number | null = null): Mesh {
  mesh.smooth = smooth;
  mesh.sharpDeg = sharpAngle;
  return mesh;
}

/* optlib.setmat */
export function setmat(mesh: Mesh, name: string, slot = 0): Mesh {
  while (mesh.mats.length <= slot) mesh.mats.push(name);
  mesh.mats[slot] = name;
  return mesh;
}

/* optlib.xform -- bakes T * R * S into the mesh data */
export function xform(mesh: Mesh, { loc = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }: { loc?: number[]; rot?: number[]; scale?: number[] } = {}): Mesh {
  const m = mat4Mul(mat4Mul(mat4Translation(loc),
                            mat4FromEulerXYZ(rot.map(R))),
                    mat4Scale(scale));
  return mesh.transform(m);
}

/* optlib.mirror_dup */
export function mirrorDup(mesh: Mesh, name?: string, axis: 'x' | 'y' | 'z' = 'x'): Mesh {
  const s = { x: [-1, 1, 1], y: [1, -1, 1], z: [1, 1, -1] }[axis];
  const m = mesh.clone(name || (mesh.name + '_R'));
  m.transform(mat4Scale(s));
  m.flipNormals();
  return m;
}

/* optlib.join -- merge meshes into the first (all transforms already baked) */
export function join(meshes: Mesh[], name: string | null = null): Mesh {
  const base = meshes[0];
  for (let k = 1; k < meshes.length; k++) {
    const o = meshes[k];
    const off = base.v.length;
    for (const p of o.v) base.v.push(p.slice() as Vec3);
    for (let i = 0; i < o.f.length; i++) {
      base.f.push(o.f[i].map(x => x + off));
      base.fm.push(o.fm[i]);
      base.fg.push(o.fg[i]);
    }
  }
  if (name) base.name = name;
  return base;
}

/* ==========================================================================
   split normals -- Blender's angle-weighted vertex normals with fans bounded
   by sharp edges.  Faces produced by the bevel are their own flat island, the
   way "Harden Normals" keeps a beveled edge reading as a crisp corner.
   ========================================================================== */
export function computeCornerNormals(mesh: Mesh): { fn: Vec3[]; corners: Vec3[][] } {
  const F = mesh.f, V = mesh.v, nf = F.length;
  const fn: Vec3[] = new Array(nf);
  for (let i = 0; i < nf; i++) fn[i] = mesh.faceNormal(i);

  const corners: Vec3[][] = [];                       /* per face, per corner normal */
  for (let i = 0; i < nf; i++) corners.push(new Array(F[i].length));

  if (!mesh.smooth) {                       /* shade flat */
    for (let i = 0; i < nf; i++) for (let k = 0; k < F[i].length; k++) corners[i][k] = fn[i];
    return { fn, corners };
  }

  /* bevel faces keep their own geometric normal */
  for (let i = 0; i < nf; i++)
    if (mesh.fg[i] === FG_BEVEL)
      for (let k = 0; k < F[i].length; k++) corners[i][k] = fn[i];

  /* sharp-edge marking (optlib.shade with a sharp_angle) */
  const EK = V.length + 1;
  const ekey = (a: number, b: number): number => (a < b ? a * EK + b : b * EK + a);
  let sharpSet: Set<number> | null = null;
  if (mesh.sharpDeg !== null) {
    sharpSet = new Set();
    const lim = Math.cos(R(mesh.sharpDeg));
    const em = new Map<number, number[]>();
    for (let fi = 0; fi < nf; fi++) {
      const t = F[fi], n = t.length;
      for (let i = 0; i < n; i++) {
        const k = ekey(t[i], t[(i + 1) % n]);
        let e = em.get(k); if (!e) { e = []; em.set(k, e); }
        e.push(fi);
      }
    }
    for (const [k, fs] of em) {
      if (fs.length !== 2) continue;
      const d = fn[fs[0]][0] * fn[fs[1]][0] + fn[fs[0]][1] * fn[fs[1]][1] + fn[fs[0]][2] * fn[fs[1]][2];
      if (d < lim) sharpSet.add(k);
    }
  }

  /* gather the original-face corners at each vertex */
  const atVert = new Map<number, Array<[number, number]>>();
  for (let fi = 0; fi < nf; fi++) {
    if (mesh.fg[fi] !== FG_ORIG) continue;
    const t = F[fi];
    for (let k = 0; k < t.length; k++) {
      let l = atVert.get(t[k]); if (!l) { l = []; atVert.set(t[k], l); }
      l.push([fi, k]);
    }
  }

  const cornerAngle = (fi: number, k: number): number => {
    const t = F[fi], n = t.length;
    const p = V[t[k]], a = V[t[(k + n - 1) % n]], b = V[t[(k + 1) % n]];
    const u = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
    const w = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
    const lu = Math.hypot(u[0], u[1], u[2]), lw = Math.hypot(w[0], w[1], w[2]);
    if (lu < 1e-12 || lw < 1e-12) return 0;
    const c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (lu * lw);
    return Math.acos(Math.max(-1, Math.min(1, c)));
  };

  for (const [vi, list] of atVert) {
    let groups: Array<Array<[number, number]>>;
    if (!sharpSet) {
      groups = [list];                                 /* one smooth fan */
    } else {
      /* union corners that share a non-sharp edge at this vertex */
      const parent = list.map((_, i) => i);
      const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const uni = (a: number, b: number): void => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
      /* edge at this vertex -> corners of the two faces sharing it */
      const byEdge = new Map<number, number[]>();
      for (let i = 0; i < list.length; i++) {
        const [fi, k] = list[i];
        const t = F[fi], n = t.length;
        for (const other of [t[(k + 1) % n], t[(k + n - 1) % n]]) {
          const kk = ekey(vi, other);
          let e = byEdge.get(kk); if (!e) { e = []; byEdge.set(kk, e); }
          e.push(i);
        }
      }
      for (const [ek, cs] of byEdge) {
        if (sharpSet.has(ek) || cs.length < 2) continue;
        for (let i = 1; i < cs.length; i++) uni(cs[0], cs[i]);
      }
      const buckets = new Map<number, Array<[number, number]>>();
      for (let i = 0; i < list.length; i++) {
        const rt = find(i);
        let g = buckets.get(rt); if (!g) { g = []; buckets.set(rt, g); }
        g.push(list[i]);
      }
      groups = [...buckets.values()];
    }
    for (const g of groups) {
      let nx = 0, ny = 0, nz = 0;
      for (const [fi, k] of g) {
        const w = cornerAngle(fi, k);
        nx += fn[fi][0] * w; ny += fn[fi][1] * w; nz += fn[fi][2] * w;
      }
      const l = Math.hypot(nx, ny, nz);
      const nrm: Vec3 = l > 1e-12 ? [nx / l, ny / l, nz / l] : fn[g[0][0]];
      for (const [fi, k] of g) corners[fi][k] = nrm;
    }
  }
  /* any corner the loop above missed (isolated face) falls back to flat */
  for (let i = 0; i < nf; i++)
    for (let k = 0; k < F[i].length; k++)
      if (!corners[i][k]) corners[i][k] = fn[i];
  return { fn, corners };
}
