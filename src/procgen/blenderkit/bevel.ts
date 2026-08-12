/**
 * The BEVEL modifier (`optlib.add_bevel`: limit=ANGLE, clamp_overlap,
 * harden_normals, profile 0.62) plus `optlib.finish` / `apply_mods` /
 * `boolean`. Bevel faces are emitted as their own flat-shaded island
 * (FG_BEVEL) so a beveled edge keeps a crisp highlight.
 */
import { R } from './mathkit'
import type { Vec3 } from './mathkit'
import { FG_BEVEL, shade, weld, weldVerts } from './meshdata'
import type { Mesh } from './meshdata'
import { booleanDifference } from './csg'

/* ==========================================================================
   4. BEVEL modifier  (optlib.add_bevel: limit=ANGLE, clamp_overlap,
      harden_normals, profile 0.62)

      Every mesh in this build is shaded fully smooth (optlib.finish always
      passes sharp=None), so on the lofted shells the angle limit rejects
      every edge and this is a no-op.  Where it bites is the genuinely hard
      geometry: the extruded rounded-rectangle plates, the n-gon end caps and
      the rims of the boolean recesses.  There "Harden Normals" is what keeps
      those edges reading as crisp corners with a thin highlight instead of
      smearing into a rounded blob, so the new faces are emitted as their own
      flat-shaded island (FG_BEVEL).
   ========================================================================== */

export function applyBevel(mesh: Mesh, width: number, segments: number, angleDeg: number, profile = 0.62): Mesh {
  if (!width || width <= 0) return mesh;
  const V = mesh.v, F = mesh.f, nf = F.length;
  if (!nf) return mesh;

  const fn: Vec3[] = new Array(nf);
  for (let i = 0; i < nf; i++) fn[i] = mesh.faceNormal(i);

  const EK = V.length + 1;
  const ekey = (a: number, b: number): number => (a < b ? a * EK + b : b * EK + a);

  /* edge -> the faces on it */
  const em = new Map<number, { a: number; b: number; faces: number[] }>();
  for (let fi = 0; fi < nf; fi++) {
    const t = F[fi], n = t.length;
    for (let i = 0; i < n; i++) {
      const k = ekey(t[i], t[(i + 1) % n]);
      let e = em.get(k);
      if (!e) { e = { a: Math.min(t[i], t[(i + 1) % n]), b: Math.max(t[i], t[(i + 1) % n]), faces: [] }; em.set(k, e); }
      e.faces.push(fi);
    }
  }

  /* which edges the angle limit selects */
  const lim = Math.cos(R(angleDeg));
  const bev = new Set<number>();
  for (const [k, e] of em) {
    if (e.faces.length !== 2) continue;
    const n0 = fn[e.faces[0]], n1 = fn[e.faces[1]];
    const d = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (d < lim) bev.add(k);
  }
  if (bev.size === 0) return mesh;

  /* corners at each vertex, and the count of beveled edges there */
  const atVert = new Map<number, Array<[number, number]>>();
  for (let fi = 0; fi < nf; fi++) {
    const t = F[fi];
    for (let k = 0; k < t.length; k++) {
      let l = atVert.get(t[k]); if (!l) { l = []; atVert.set(t[k], l); }
      l.push([fi, k]);
    }
  }
  const bevAtVert = new Map<number, number[]>();
  for (const [k, e] of em) {
    if (!bev.has(k)) continue;
    for (const v of [e.a, e.b]) {
      let l = bevAtVert.get(v); if (!l) { l = []; bevAtVert.set(v, l); }
      l.push(k);
    }
  }

  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

  /* offset of one corner inside its own face */
  function cornerPos(fi: number, k: number): Vec3 {
    const t = F[fi], n = t.length;
    const vi = t[k], pv = t[(k + n - 1) % n], nx = t[(k + 1) % n];
    const p = V[vi];
    const ep = sub(V[pv], p), en = sub(V[nx], p);
    const lp = len3(ep), ln = len3(en);
    if (lp < 1e-12 || ln < 1e-12) return p.slice() as Vec3;
    const dP = [ep[0] / lp, ep[1] / lp, ep[2] / lp];
    const dN = [en[0] / ln, en[1] / ln, en[2] / ln];
    const bp = bev.has(ekey(vi, pv)), bn = bev.has(ekey(vi, nx));
    if (!bp && !bn) return p.slice() as Vec3;
    const cx = dP[1] * dN[2] - dP[2] * dN[1];
    const cy = dP[2] * dN[0] - dP[0] * dN[2];
    const cz = dP[0] * dN[1] - dP[1] * dN[0];
    const sinT = Math.hypot(cx, cy, cz);
    if (sinT < 1e-6) return p.slice() as Vec3;
    let a = 0, b = 0;
    if (bp && bn) { a = width / sinT; b = width / sinT; }
    else if (bn) { a = width / sinT; }
    else { b = width / sinT; }
    a = Math.min(a, 0.45 * lp);                 /* clamp_overlap */
    b = Math.min(b, 0.45 * ln);
    return [p[0] + dP[0] * a + dN[0] * b,
            p[1] + dP[1] * a + dN[1] * b,
            p[2] + dP[2] * a + dN[2] * b];
  }

  /* sectors: faces around a vertex joined through NON-beveled edges */
  const sectorOf = new Map<string, number>();      /* `${fi}:${k}` -> sector id (per vertex)  */
  const sectorPos = new Map<string, Vec3>();     /* `${vi}:${sid}` -> position              */
  const sectorList = new Map<number, number[]>();    /* vi -> [sid...]                          */

  for (const [vi, list] of atVert) {
    const nb = bevAtVert.get(vi);
    if (!nb || nb.length < 2) {                 /* untouched, or a bevel end */
      for (const [fi, k] of list) sectorOf.set(fi + ':' + k, 0);
      sectorPos.set(vi + ':0', V[vi].slice() as Vec3);
      sectorList.set(vi, [0]);
      continue;
    }
    const parent = list.map((_, i) => i);
    const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const uni = (a: number, b: number): void => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
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
    for (const [ek2, cs] of byEdge) {
      if (bev.has(ek2)) continue;
      for (let i = 1; i < cs.length; i++) uni(cs[0], cs[i]);
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < list.length; i++) {
      const rt = find(i);
      let g = groups.get(rt); if (!g) { g = []; groups.set(rt, g); }
      g.push(i);
    }
    let sid = 0;
    const ids: number[] = [];
    for (const g of groups.values()) {
      let px = 0, py = 0, pz = 0;
      for (const i of g) {
        const c = cornerPos(list[i][0], list[i][1]);
        px += c[0]; py += c[1]; pz += c[2];
      }
      const pos: Vec3 = [px / g.length, py / g.length, pz / g.length];
      for (const i of g) sectorOf.set(list[i][0] + ':' + list[i][1], sid);
      sectorPos.set(vi + ':' + sid, pos);
      ids.push(sid);
      sid++;
    }
    sectorList.set(vi, ids);
  }

  /* ---- emit ------------------------------------------------------------ */
  const nv: Vec3[] = [];
  const push = (p: Vec3): number => { nv.push([p[0], p[1], p[2]]); return nv.length - 1; };
  const svIdx = new Map<string, number>();
  const sectorVert = (vi: number, sid: number): number => {
    const k = vi + ':' + sid;
    let i = svIdx.get(k);
    if (i === undefined) { i = push(sectorPos.get(k)!); svIdx.set(k, i); }
    return i;
  };

  /* superellipse profile: x^r + y^r = 1, r = 2 is a circular bevel */
  const pr = Math.min(24, Math.max(0.2, 2.0 * profile / (1.0 - profile)));
  const pexp = 2.0 / pr;
  const arcCache = new Map<string, number[]>();
  function arcAt(vi: number, sA: number, sB: number): number[] {
    const flip = sA > sB;
    const lo = flip ? sB : sA, hi = flip ? sA : sB;
    const key = vi + ':' + lo + ':' + hi;
    let arc = arcCache.get(key);
    if (!arc) {
      const P = V[vi];
      const a = sectorPos.get(vi + ':' + lo)!, b = sectorPos.get(vi + ':' + hi)!;
      const va = sub(a, P), vb = sub(b, P);
      arc = [];
      for (let i = 0; i <= segments; i++) {
        if (i === 0) { arc.push(sectorVert(vi, lo)); continue; }
        if (i === segments) { arc.push(sectorVert(vi, hi)); continue; }
        const t = i / segments;
        const u = Math.pow(Math.cos(t * Math.PI / 2), pexp);
        const w = Math.pow(Math.sin(t * Math.PI / 2), pexp);
        arc.push(push([P[0] + va[0] * u + vb[0] * w,
                       P[1] + va[1] * u + vb[1] * w,
                       P[2] + va[2] * u + vb[2] * w]));
      }
      arcCache.set(key, arc);
    }
    return flip ? arc.slice().reverse() : arc;
  }

  const nfaces: number[][] = [], nfm: number[] = [], nfg: number[] = [];

  /* original faces, pulled in to their sector corners */
  for (let fi = 0; fi < nf; fi++) {
    const t = F[fi];
    const out: number[] = [];
    for (let k = 0; k < t.length; k++) {
      const sid = sectorOf.get(fi + ':' + k) ?? 0;
      const idx = sectorVert(t[k], sid);
      if (!out.length || out[out.length - 1] !== idx) out.push(idx);
    }
    while (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    if (out.length < 3) continue;
    nfaces.push(out); nfm.push(mesh.fm[fi]); nfg.push(mesh.fg[fi]);
  }

  /* the strip along every beveled edge.  The winding is derived from the way
     f0 traverses the edge, so the strip is consistent with the shell it
     replaces and no global normal recalculation is needed. */
  const cornerIdx = (fi: number, vi: number): number => {
    const t = F[fi];
    for (let i = 0; i < t.length; i++) if (t[i] === vi) return i;
    return -1;
  };
  for (const [k, e] of em) {
    if (!bev.has(k)) continue;
    const [f0, f1] = e.faces;
    const t0 = F[f0];
    const k0 = cornerIdx(f0, e.a);
    /* v0 -> v1 is the direction f0 walks this edge */
    const forward = k0 >= 0 && t0[(k0 + 1) % t0.length] === e.b;
    const v0 = forward ? e.a : e.b, v1 = forward ? e.b : e.a;
    const sec = (fi: number, vi: number): number => sectorOf.get(fi + ':' + cornerIdx(fi, vi)) ?? 0;
    const s0f = sec(f0, v0), s0b = sec(f1, v0);
    const s1f = sec(f0, v1), s1b = sec(f1, v1);
    if (s0f === s0b && s1f === s1b) continue;       /* nothing opened up */
    const arc0 = arcAt(v0, s0f, s0b);
    const arc1 = arcAt(v1, s1f, s1b);
    for (let i = 0; i < segments; i++) {
      const q = [arc1[i], arc0[i], arc0[i + 1], arc1[i + 1]];
      const u: number[] = [];
      for (const x of q) if (!u.length || u[u.length - 1] !== x) u.push(x);
      while (u.length > 1 && u[0] === u[u.length - 1]) u.pop();
      if (u.length < 3) continue;
      nfaces.push(u); nfm.push(mesh.fm[f0]); nfg.push(FG_BEVEL);
    }
  }

  /* patch where three or more beveled edges meet */
  for (const [vi, elist] of bevAtVert) {
    if (elist.length < 3) continue;
    const arcs: number[][] = [];
    for (const k of elist) {
      const e = em.get(k)!;
      if (e.faces.length !== 2) continue;
      const corner = (fi: number): number => { const t = F[fi]; for (let i = 0; i < t.length; i++) if (t[i] === vi) return i; return -1; };
      const s0 = sectorOf.get(e.faces[0] + ':' + corner(e.faces[0])) ?? 0;
      const s1 = sectorOf.get(e.faces[1] + ':' + corner(e.faces[1])) ?? 0;
      if (s0 === s1) continue;
      arcs.push(arcAt(vi, s0, s1));
    }
    if (arcs.length < 3) continue;
    /* chain the arcs into a closed boundary loop */
    const loop: number[] = [];
    const used = new Array(arcs.length).fill(false);
    const cur = arcs[0].slice(); used[0] = true;
    loop.push(...cur);
    let guard = 0;
    while (guard++ < arcs.length * 2) {
      const tail = loop[loop.length - 1];
      let nextI = -1, rev = false;
      for (let i = 0; i < arcs.length; i++) {
        if (used[i]) continue;
        if (arcs[i][0] === tail) { nextI = i; rev = false; break; }
        if (arcs[i][arcs[i].length - 1] === tail) { nextI = i; rev = true; break; }
      }
      if (nextI < 0) break;
      used[nextI] = true;
      const seg = rev ? arcs[nextI].slice().reverse() : arcs[nextI];
      for (let i = 1; i < seg.length; i++) loop.push(seg[i]);
    }
    if (loop.length > 2 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (loop.length < 3) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const i of loop) { cx += nv[i][0]; cy += nv[i][1]; cz += nv[i][2]; }
    const c = push([cx / loop.length, cy / loop.length, cz / loop.length]);
    /* orient the patch against the average of the original faces here */
    let ax = 0, ay = 0, az = 0;
    for (const [fi] of (atVert.get(vi) || [])) { ax += fn[fi][0]; ay += fn[fi][1]; az += fn[fi][2]; }
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = nv[loop[i]], q = nv[loop[(i + 1) % loop.length]];
      area += (p[1] - q[1]) * (p[2] + q[2]) * ax
            + (p[2] - q[2]) * (p[0] + q[0]) * ay
            + (p[0] - q[0]) * (p[1] + q[1]) * az;
    }
    const ord = area >= 0 ? loop : loop.slice().reverse();
    for (let i = 0; i < ord.length; i++) {
      const j = (i + 1) % ord.length;
      if (ord[i] === ord[j]) continue;
      nfaces.push([c, ord[i], ord[j]]);
      nfm.push(mesh.fm[em.get(elist[0])!.faces[0]]);
      nfg.push(FG_BEVEL);
    }
  }

  mesh.v = nv; mesh.f = nfaces; mesh.fm = nfm; mesh.fg = nfg;
  weldVerts(mesh, 1e-9);
  return mesh;
}

/* optlib.finish -- weld, shade, then queue the bevel modifier */
export function finish(mesh: Mesh, { bevel = 0.0012, bseg = 2, bangle = 32.0, sharp = null,
                        weld_d = 2e-5, smooth = true }: { bevel?: number; bseg?: number; bangle?: number; sharp?: number | null; weld_d?: number; smooth?: boolean } = {}): Mesh {
  weld(mesh, weld_d);
  shade(mesh, smooth, sharp);
  mesh.bevel = bevel ? { width: bevel, segments: bseg, angle: bangle } : null;
  return mesh;
}
/* optlib.add_bevel called directly (after a boolean) */
export function addBevel(mesh: Mesh, width: number, segments: number, angle: number): Mesh {
  mesh.bevel = { width, segments, angle };
  return mesh;
}
/* optlib.apply_mods -- evaluate the pending modifier stack into the mesh */
export function applyMods(mesh: Mesh): Mesh {
  if (mesh.bevel) {
    applyBevel(mesh, mesh.bevel.width, mesh.bevel.segments, mesh.bevel.angle);
    mesh.bevel = null;
  }
  return mesh;
}
/* optlib.boolean */
export function boolean(a: Mesh, b: Mesh): Mesh {
  applyMods(a);
  booleanDifference(a, b);
  return a;
}
