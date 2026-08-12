/**
 * Boolean DIFFERENCE (`optlib.boolean`, solver="EXACT") as a BSP solid
 * subtraction. Only the target faces whose bounds overlap the cutter take
 * part — every cutter in a build like this is a small extruded rounded
 * rectangle, so the rest of the shell passes straight through.
 */
import { FG_ORIG, weldVerts } from './meshdata'
import type { Mesh } from './meshdata'
import type { Vec3 } from './mathkit'

/** One convex fragment in the BSP: a polygon, its plane, its material slot. */
export interface CPoly {
  verts: Vec3[]
  plane: CPlane
  mat: number
}

/* ==========================================================================
   3. boolean DIFFERENCE  (optlib.boolean, solver="EXACT")
      BSP solid subtraction.  Only the target faces whose bounds overlap the
      cutter take part -- every cutter in this build is a small extruded
      rounded-rectangle, so the rest of the shell passes straight through.
   ========================================================================== */

export const CSG_EPS = 1e-9;

export class CPlane {
  n: Vec3
  w: number
  constructor(normal: Vec3, w: number) { this.n = normal; this.w = w; }
  static fromPoints(a: Vec3, b: Vec3, c: Vec3): CPlane | null {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-18) return null;
    nx /= l; ny /= l; nz /= l;
    return new CPlane([nx, ny, nz], nx * a[0] + ny * a[1] + nz * a[2]);
  }
  flip(): void { this.n = [-this.n[0], -this.n[1], -this.n[2]]; this.w = -this.w; }
  /* split `poly` into the four buckets (csg.js) */
  splitPolygon(poly: CPoly, cf: CPoly[], cb: CPoly[], f: CPoly[], b: CPoly[]): void {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let type = 0;
    const types: number[] = [];
    for (let i = 0; i < poly.verts.length; i++) {
      const v = poly.verts[i];
      const t = this.n[0] * v[0] + this.n[1] * v[1] + this.n[2] * v[2] - this.w;
      const ty = t < -CSG_EPS ? BACK : (t > CSG_EPS ? FRONT : COPLANAR);
      type |= ty;
      types.push(ty);
    }
    switch (type) {
      case COPLANAR: {
        const d = this.n[0] * poly.plane.n[0] + this.n[1] * poly.plane.n[1] + this.n[2] * poly.plane.n[2];
        (d > 0 ? cf : cb).push(poly);
        break;
      }
      case FRONT: f.push(poly); break;
      case BACK: b.push(poly); break;
      case SPANNING: {
        const fv: Vec3[] = [], bv: Vec3[] = [];
        const n = poly.verts.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ti = types[i], tj = types[j];
          const vi = poly.verts[i], vj = poly.verts[j];
          if (ti !== BACK) fv.push(vi);
          if (ti !== FRONT) bv.push(vi);
          if ((ti | tj) === SPANNING) {
            const di = this.n[0] * vi[0] + this.n[1] * vi[1] + this.n[2] * vi[2] - this.w;
            const dj = this.n[0] * vj[0] + this.n[1] * vj[1] + this.n[2] * vj[2] - this.w;
            const t = di / (di - dj);
            const p: Vec3 = [vi[0] + (vj[0] - vi[0]) * t,
                       vi[1] + (vj[1] - vi[1]) * t,
                       vi[2] + (vj[2] - vi[2]) * t];
            fv.push(p); bv.push(p);
          }
        }
        if (fv.length >= 3) f.push({ verts: fv, plane: poly.plane, mat: poly.mat });
        if (bv.length >= 3) b.push({ verts: bv, plane: poly.plane, mat: poly.mat });
        break;
      }
    }
  }
}

export function cpolyFlip(p: CPoly): CPoly {
  const pl = new CPlane(p.plane.n.slice() as Vec3, p.plane.w);
  pl.flip();
  return { verts: p.verts.slice().reverse(), plane: pl, mat: p.mat };
}

export class CNode {
  plane: CPlane | null
  front: CNode | null
  back: CNode | null
  polygons: CPoly[]
  constructor(polys: CPoly[] | null) {
    this.plane = null; this.front = null; this.back = null; this.polygons = [];
    if (polys && polys.length) this.build(polys);
  }
  invert(): void {
    this.polygons = this.polygons.map(cpolyFlip);
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const t = this.front; this.front = this.back; this.back = t;
  }
  clipPolygons(polys: CPoly[]): CPoly[] {
    if (!this.plane) return polys.slice();
    let f: CPoly[] = [], b: CPoly[] = [];
    for (const p of polys) this.plane.splitPolygon(p, f, b, f, b);
    if (this.front) f = this.front.clipPolygons(f);
    b = this.back ? this.back.clipPolygons(b) : [];
    return f.concat(b);
  }
  clipTo(node: CNode): void {
    this.polygons = node.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(node);
    if (this.back) this.back.clipTo(node);
  }
  allPolygons(): CPoly[] {
    let r = this.polygons.slice();
    if (this.front) r = r.concat(this.front.allPolygons());
    if (this.back) r = r.concat(this.back.allPolygons());
    return r;
  }
  /* pick a splitting plane that balances instead of always taking polys[0]:
     the shells here are curved, and a first-polygon split degenerates into a
     linear tree that turns the build quadratic. */
  pickPlane(polys: CPoly[]): number {
    const tries = Math.min(polys.length, 12);
    let best: number | null = null, bestScore = Infinity;
    const step = Math.max(1, Math.floor(polys.length / tries));
    for (let s = 0; s < polys.length; s += step) {
      const pl = polys[s].plane;
      let f = 0, b = 0, sp = 0;
      const stride = Math.max(1, Math.floor(polys.length / 60));
      let cnt = 0;
      for (let i = 0; i < polys.length; i += stride) {
        cnt++;
        let hasF = false, hasB = false;
        for (const v of polys[i].verts) {
          const t = pl.n[0] * v[0] + pl.n[1] * v[1] + pl.n[2] * v[2] - pl.w;
          if (t > CSG_EPS) hasF = true; else if (t < -CSG_EPS) hasB = true;
        }
        if (hasF && hasB) sp++; else if (hasF) f++; else b++;
      }
      const score = sp * 3 + Math.abs(f - b);
      if (score < bestScore) { bestScore = score; best = s; }
      void cnt;
    }
    return best === null ? 0 : best;
  }
  build(polys: CPoly[]): void {
    if (!polys.length) return;
    if (!this.plane) {
      const pi = this.pickPlane(polys);
      this.plane = new CPlane(polys[pi].plane.n.slice() as Vec3, polys[pi].plane.w);
    }
    const f: CPoly[] = [], b: CPoly[] = [];
    for (const p of polys) this.plane!.splitPolygon(p, this.polygons, this.polygons, f, b);
    if (f.length) { if (!this.front) this.front = new CNode(null); this.front.build(f); }
    if (b.length) { if (!this.back) this.back = new CNode(null); this.back.build(b); }
  }
}

export function meshToPolys(mesh: Mesh, indices: number[] | null = null): CPoly[] {
  const out: CPoly[] = [];
  const list = indices || mesh.f.map((_, i) => i);
  for (const fi of list) {
    const t = mesh.f[fi];
    const p0 = mesh.v[t[0]];
    for (let i = 1; i < t.length - 1; i++) {
      const a = p0, b = mesh.v[t[i]], c = mesh.v[t[i + 1]];
      const pl = CPlane.fromPoints(a, b, c);
      if (!pl) continue;
      out.push({ verts: [a.slice() as Vec3, b.slice() as Vec3, c.slice() as Vec3], plane: pl, mat: mesh.fm[fi] });
    }
  }
  return out;
}

export function meshBounds(mesh: Mesh, indices: number[] | null = null): [Vec3, Vec3] {
  const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  const list = indices || mesh.f.map((_, i) => i);
  for (const fi of list)
    for (const vi of mesh.f[fi])
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], mesh.v[vi][k]);
        mx[k] = Math.max(mx[k], mesh.v[vi][k]);
      }
  return [mn, mx];
}

/* optlib.boolean(a, b, "DIFFERENCE") -- a := a - b, in place */
export function booleanDifference(A: Mesh, B: Mesh): Mesh {
  const [bmn, bmx] = meshBounds(B);
  const pad = 1e-4;
  const near: number[] = [], far: number[] = [];
  for (let fi = 0; fi < A.f.length; fi++) {
    let hit = true;
    const t = A.f[fi];
    const fmn: Vec3 = [Infinity, Infinity, Infinity], fmx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const vi of t) for (let k = 0; k < 3; k++) {
      fmn[k] = Math.min(fmn[k], A.v[vi][k]);
      fmx[k] = Math.max(fmx[k], A.v[vi][k]);
    }
    for (let k = 0; k < 3; k++)
      if (fmx[k] < bmn[k] - pad || fmn[k] > bmx[k] + pad) { hit = false; break; }
    (hit ? near : far).push(fi);
  }

  const a = new CNode(meshToPolys(A, near));
  const b = new CNode(meshToPolys(B));
  a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
  a.build(b.allPolygons()); a.invert();
  const result = a.allPolygons();

  /* rebuild the mesh: untouched faces + the CSG fragments */
  const nv: Vec3[] = [], nf: number[][] = [], nfm: number[] = [], nfg: number[] = [];
  const remap = new Map<string, number>();
  const push = (p: Vec3): number => {
    const k = `${Math.round(p[0] * 1e9)},${Math.round(p[1] * 1e9)},${Math.round(p[2] * 1e9)}`;
    let i = remap.get(k);
    if (i === undefined) { i = nv.length; nv.push(p.slice() as Vec3); remap.set(k, i); }
    return i;
  };
  for (const fi of far) {
    nf.push(A.f[fi].map(vi => push(A.v[vi])));
    nfm.push(A.fm[fi]); nfg.push(A.fg[fi]);
  }
  for (const p of result) {
    if (p.verts.length < 3) continue;
    const idx = p.verts.map(push);
    const uniq: number[] = [];
    for (const i of idx) if (!uniq.length || uniq[uniq.length - 1] !== i) uniq.push(i);
    while (uniq.length > 1 && uniq[0] === uniq[uniq.length - 1]) uniq.pop();
    if (uniq.length < 3) continue;
    nf.push(uniq); nfm.push(p.mat | 0); nfg.push(FG_ORIG);
  }
  A.v = nv; A.f = nf; A.fm = nfm; A.fg = nfg;

  /* stitch the fragments back into a connected shell and drop slivers */
  weldVerts(A, 1e-7);
  const keep: number[][] = [], keepM: number[] = [], keepG: number[] = [];
  for (let fi = 0; fi < A.f.length; fi++) {
    const t = A.f[fi];
    let area = 0;
    const p0 = A.v[t[0]];
    for (let i = 1; i < t.length - 1; i++) {
      const p1 = A.v[t[i]], p2 = A.v[t[i + 1]];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    if (area < 1e-13) continue;
    keep.push(t); keepM.push(A.fm[fi]); keepG.push(A.fg[fi]);
  }
  A.f = keep; A.fm = keepM; A.fg = keepG;
  /* the BSP already emits outward-facing polygons and the untouched faces
     kept their original winding, so orientation must NOT be re-derived here:
     a CSG result has T-junctions, and a volume test over the fragments they
     disconnect would flip patches at random. */
  return A;
}
