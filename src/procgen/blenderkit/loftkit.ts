/**
 * The collection-bound half of `optlib`'s section 5: the generators that
 * CREATE meshes (loft, spine loft, pillow panel, prism, tube, join). They are
 * bound to one `CollectionApi` by `createLoftKit` so a ported build's call
 * sites stay identical to the Blender/bpy source — `loft(st, { cname: 'LEG' })`
 * rather than threading a collection object through every call.
 */
import { R, V3, lerp, vec } from './mathkit'
import type { Vec2, Vec3 } from './mathkit'
import { Curve1D } from './curves'
import { mat4Rotation } from './transform'
import { join } from './meshdata'
import type { Mesh } from './meshdata'
import { STATION_KEYS, normStation, pillowBulge, profile } from './profiles'
import type { FullStation, Station, Surface } from './profiles'
import type { CollectionApi } from './collections'

export interface LoftOpts<K extends string> {
  n?: number
  name?: string
  cname?: K
  cap0?: boolean
  cap1?: boolean
  mode?: 'pchip' | 'spline'
  even?: number
  axis?: 'x' | 'y' | 'z'
  phase?: number
  tip0?: number | null
  tip1?: number | null
  ring_t?: number[] | null
  rings?: number | null
}

export interface LoftSpineOpts<K extends string> {
  n?: number
  name?: string
  cname?: K
  up?: V3
  cap0?: boolean
  cap1?: boolean
  mode?: 'pchip' | 'spline'
  even?: number
  tip0?: number | null
  tip1?: number | null
  rings?: number | null
}

export interface PillowOpts<K extends string> {
  t_front?: number
  t_back?: number
  layers?: number
  name?: string
  cname?: K
  rim?: number
  centre?: Vec2 | null
  disp?: ((u: number, v: number) => number) | null
  layer_s?: number[] | null
}

export interface ExtrudeOpts<K extends string> {
  name?: string
  cname?: K
  taper1?: number
  taper0?: number
  cx?: number
  cy?: number
}

export interface TubeOpts<K extends string> {
  n?: number
  name?: string
  cname?: K
  cap?: boolean
  up?: V3
}

export interface LoftKit<K extends string> {
  loft(stations: Station[], opts?: LoftOpts<K>): Mesh
  loftSpine(spinePts: Array<V3 | Vec3>, stations: Station[], opts?: LoftSpineOpts<K>): Mesh
  pillow(outline: Vec2[], surf: Surface, opts?: PillowOpts<K>): Mesh
  extrudeOutline(outline: Vec2[], z0: number, z1: number, opts?: ExtrudeOpts<K>): Mesh
  tube(spine: Array<V3 | Vec3>, radii: number | number[], opts?: TubeOpts<K>): Mesh
  joinMeshes(meshes: Mesh[], name: string, cname: K): Mesh
}

export function createLoftKit<K extends string>(api: CollectionApi<K>): LoftKit<K> {
  const { meshObj, collRemove } = api

function loft(stations: Station[], opts: LoftOpts<K> = {}): Mesh {
  const { n = 64, name = 'loft', cname = 'OPTIMUS' as K, cap0 = true, cap1 = true,
          mode = 'pchip', even = 0.72, axis = 'z', phase = 0.0,
          tip0 = null, tip1 = null, ring_t = null } = opts;
  let rings = opts.rings ?? null;

  let st = stations.map(normStation);
  st = st.map((s, i): [FullStation, number] => [s, i]).sort((a, b) => (a[0].t - b[0].t) || (a[1] - b[1])).map(p => p[0]);
  const ts = st.map(s => s.t);

  const curves: Record<string, Curve1D> = {};
  for (const k of STATION_KEYS) curves[k] = new Curve1D(ts, st.map(s => s[k]), mode);

  if (rings === null) rings = Math.max(24, st.length * 6);

  const t0 = ts[0], t1 = ts[ts.length - 1];
  let ringTs: number[];
  if (ring_t !== null) {
    const set = new Set(ring_t.map(t => Math.min(t1, Math.max(t0, t))));
    ringTs = [...set].sort((a, b) => a - b);
  } else {
    ringTs = [];
    for (let i = 0; i < rings; i++) ringTs.push(t0 + (t1 - t0) * (i / (rings - 1)));
  }

  const ringAt = (t: number, floorV: number, scaleMul = 1.0): Vec3[] => {
    const sc = curves.scale.at(t) * scaleMul;
    const pr = profile(n,
      Math.max(floorV, curves.ax.at(t) * sc),
      Math.max(floorV, curves.by.at(t) * sc),
      Math.max(floorV, curves.ax2.at(t) * sc),
      Math.max(floorV, curves.by2.at(t) * sc),
      Math.max(2.02, curves.e.at(t)),
      Math.max(2.02, curves.e_dn.at(t)),
      even, 512, phase);
    const ox = curves.ox.at(t), oy = curves.oy.at(t), rot = curves.rot.at(t);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const ring: Vec3[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = pr[i][0], y = pr[i][1];
      ring[i] = [x * cr - y * sr + ox, x * sr + y * cr + oy, t];
    }
    return ring;
  };

  const ringsets = ringTs.map(t => ringAt(t, 1e-5));

  /* rounded caps: shrinking rings then a pole */
  function capRings(baseT: number, direction: number, depth: number): Vec3[][] {
    const out: Vec3[][] = [];
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const rs = Math.pow(Math.cos(f * Math.PI / 2), 0.85);
      const dz = Math.sin(f * Math.PI / 2) * depth * direction;
      const ring = ringAt(baseT, 1e-6, rs);
      for (const p of ring) p[2] = baseT + dz;
      out.push(ring);
    }
    return out;
  }

  let pre: Vec3[][] = [], post: Vec3[][] = [];
  if (cap0) {
    const d = tip0 !== null ? tip0 : (curves.ax.at(t0) + curves.by.at(t0)) * 0.5;
    pre = capRings(t0, -1.0, d).reverse();
  }
  if (cap1) {
    const d = tip1 !== null ? tip1 : (curves.ax.at(t1) + curves.by.at(t1)) * 0.5;
    post = capRings(t1, +1.0, d);
  }

  const allrings = pre.concat(ringsets, post);
  const verts: Vec3[] = [];
  for (const r of allrings) for (const p of r) verts.push(p);

  const faces: number[][] = [];
  const nr = allrings.length;
  for (let i = 0; i < nr - 1; i++) {
    const a = i * n, b = (i + 1) * n;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      faces.push([a + j, a + j2, b + j2, b + j]);
    }
  }
  if (!cap0) { const t: number[] = []; for (let i = n - 1; i >= 0; i--) t.push(i); faces.push(t); }
  if (!cap1) { const base = (nr - 1) * n, t: number[] = []; for (let i = 0; i < n; i++) t.push(base + i); faces.push(t); }

  const ob = meshObj(name, verts, faces, cname);
  if (axis !== 'z') ob.transform(axis === 'x' ? mat4Rotation(R(90), 'Y') : mat4Rotation(R(-90), 'X'));
  return ob;
}

function loftSpine(spinePts: Array<V3 | Vec3>, stations: Station[], opts: LoftSpineOpts<K> = {}): Mesh {
  const { n = 48, name = 'loft', cname = 'OPTIMUS' as K, up = vec(0, 0, 1),
          cap0 = true, cap1 = true, mode = 'pchip', even = 0.72,
          tip0 = null, tip1 = null } = opts;
  let rings = opts.rings ?? null;

  const P = spinePts.map((p) => (p instanceof V3 ? p.clone() : V3.of(p)));
  if (rings === null) rings = Math.max(24, P.length);
  const tsIn = P.map((_, i) => i / (P.length - 1));
  const cx = new Curve1D(tsIn, P.map(p => p.x), 'spline');
  const cy = new Curve1D(tsIn, P.map(p => p.y), 'spline');
  const cz = new Curve1D(tsIn, P.map(p => p.z), 'spline');
  const S: V3[] = [];
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1);
    S.push(vec(cx.at(u), cy.at(u), cz.at(u)));
  }

  const T: V3[] = [];
  for (let i = 0; i < rings; i++) {
    let t: V3;
    if (i === 0) t = S[1].sub(S[0]);
    else if (i === rings - 1) t = S[rings - 1].sub(S[rings - 2]);
    else t = S[i + 1].sub(S[i - 1]);
    T.push(t.normalized());
  }

  let ref = up.normalized();
  if (Math.abs(ref.dot(T[0])) > 0.98) ref = vec(1, 0, 0);
  const N = [ref.sub(T[0].mul(ref.dot(T[0]))).normalized()];
  for (let i = 1; i < rings; i++) {
    let v = N[N.length - 1].sub(T[i].mul(N[N.length - 1].dot(T[i])));
    if (v.length < 1e-9) v = vec(1, 0, 0).sub(T[i].mul(T[i].x));
    N.push(v.normalized());
  }
  const B: V3[] = [];
  for (let i = 0; i < rings; i++) B.push(T[i].cross(N[i]).normalized());

  let st = stations.map(normStation);
  st = st.map((s, i): [FullStation, number] => [s, i]).sort((a, b) => (a[0].t - b[0].t) || (a[1] - b[1])).map(p => p[0]);
  const ts = st.map(s => s.t);
  const curves: Record<string, Curve1D> = {};
  for (const k of STATION_KEYS) curves[k] = new Curve1D(ts, st.map(s => s[k]), mode);

  let allrings: V3[][] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const sc = curves.scale.at(t);
    const pr = profile(n,
      Math.max(1e-6, curves.ax.at(t) * sc),
      Math.max(1e-6, curves.by.at(t) * sc),
      Math.max(1e-6, curves.ax2.at(t) * sc),
      Math.max(1e-6, curves.by2.at(t) * sc),
      Math.max(2.02, curves.e.at(t)),
      Math.max(2.02, curves.e_dn.at(t)), even);
    const ox = curves.ox.at(t), oy = curves.oy.at(t), rot = curves.rot.at(t);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const ring: V3[] = [];
    for (const [x, y] of pr) {
      const xr = x * cr - y * sr, yr = x * sr + y * cr;
      ring.push(S[i].add(N[i].mul(xr + ox)).add(B[i].mul(yr + oy)));
    }
    allrings.push(ring);
  }

  function cap(idx: number, direction: number, depth: number): V3[][] {
    const out: V3[][] = [];
    const steps = 5;
    const base = allrings[idx];
    let c = vec(0, 0, 0);
    for (const v of base) c = c.add(v);
    c = c.mul(1.0 / base.length);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const rs = Math.pow(Math.cos(f * Math.PI / 2), 0.85);
      const dz = Math.sin(f * Math.PI / 2) * depth;
      out.push(base.map(v => c.add(v.sub(c).mul(rs)).add(T[idx].mul(dz * direction))));
    }
    return out;
  }

  let pre: V3[][] = [], post: V3[][] = [];
  if (cap0) {
    const d = tip0 !== null ? tip0 : (curves.ax.at(0) + curves.by.at(0)) * 0.5;
    pre = cap(0, -1.0, d).reverse();
  }
  if (cap1) {
    const d = tip1 !== null ? tip1 : (curves.ax.at(1) + curves.by.at(1)) * 0.5;
    post = cap(rings - 1, +1.0, d);
  }
  allrings = pre.concat(allrings, post);

  const verts: Vec3[] = [];
  for (const r of allrings) for (const v of r) verts.push(v.toArray());
  const faces: number[][] = [];
  const nr = allrings.length;
  for (let i = 0; i < nr - 1; i++) {
    const a = i * n, b = (i + 1) * n;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      faces.push([a + j, a + j2, b + j2, b + j]);
    }
  }
  if (!cap0) { const t: number[] = []; for (let i = n - 1; i >= 0; i--) t.push(i); faces.push(t); }
  if (!cap1) { const base = (nr - 1) * n, t: number[] = []; for (let i = 0; i < n; i++) t.push(base + i); faces.push(t); }
  return meshObj(name, verts, faces, cname);
}

function pillow(outline: Vec2[], surf: Surface, opts: PillowOpts<K> = {}): Mesh {
  const { t_front = 0.008, t_back = 0.004, layers = 9, name = 'panel',
          cname = 'OPTIMUS' as K, rim = 0.55, centre = null, disp = null,
          layer_s = null } = opts;
  const n = outline.length;
  let cu, cv;
  if (centre === null) {
    cu = outline.reduce((s, p) => s + p[0], 0) / n;
    cv = outline.reduce((s, p) => s + p[1], 0) / n;
  } else { cu = centre[0]; cv = centre[1]; }

  const shrink = (s: number): Vec2[] => outline.map((p): Vec2 => [lerp(p[0], cu, s), lerp(p[1], cv, s)]);
  const bulge = (s: number): number => pillowBulge(s, rim);

  let ss: number[];
  if (layer_s !== null) {
    /* explicit ring parameters, so a caller can crowd layers across a
       surface feature instead of raising the density of the whole panel */
    ss = [...new Set([0.0, ...layer_s.map(s => Math.min(1.0, Math.max(0.0, s)))])]
      .sort((a, b) => a - b);
    if (ss[ss.length - 1] < 1.0) ss.push(1.0);
  } else {
    ss = [];
    for (let i = 0; i < layers; i++) ss.push(Math.pow(i / (layers - 1), 0.85));
  }

  const ringsF: V3[][] = [], ringsB: V3[][] = [];
  for (let i = 0; i < ss.length - 1; i++) {
    const s = ss[i];
    const rf: V3[] = [], rb: V3[] = [];
    for (const [u, v] of shrink(s)) {
      const [p, nrm] = surf(u, v);
      const b = bulge(s);
      const d = disp === null ? 0.0 : disp(u, v) * b;
      rf.push(p.add(nrm.mul(t_front * b + d)));
      rb.push(p.sub(nrm.mul(t_back * b)));
    }
    ringsF.push(rf); ringsB.push(rb);
  }

  /* The pole must carry the same displacement as the ring beside it.  Left
     out, it sat t_front below a ring that had been pushed out by disp, and the
     fan pinched into a spike -- the "hole" in the middle of the panel. */
  const [pc, pn] = surf(cu, cv);
  const dpole = disp === null ? 0.0 : disp(cu, cv);
  const poleF = pc.add(pn.mul(t_front + dpole));
  const poleB = pc.sub(pn.mul(t_back));

  const verts: Vec3[] = [], faces: number[][] = [];
  for (const r of ringsF) for (const v of r) verts.push(v.toArray());
  const idxPoleF = verts.length; verts.push(poleF.toArray());
  const offB = verts.length;
  for (const r of ringsB) for (const v of r) verts.push(v.toArray());
  const idxPoleB = verts.length; verts.push(poleB.toArray());

  const L = ringsF.length;
  for (let i = 0; i < L - 1; i++) {
    const a = i * n, b = (i + 1) * n;
    for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([a + j, b + j, b + j2, a + j2]); }
  }
  let a = (L - 1) * n;
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([a + j, idxPoleF, a + j2]); }
  for (let i = 0; i < L - 1; i++) {
    const aa = offB + i * n, bb = offB + (i + 1) * n;
    for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([aa + j, aa + j2, bb + j2, bb + j]); }
  }
  a = offB + (L - 1) * n;
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([a + j2, idxPoleB, a + j]); }
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([j, j2, offB + j2, offB + j]); }

  return meshObj(name, verts, faces, cname);
}

/* simple prism from a closed 2-D outline (caps as n-gons) */
function extrudeOutline(outline: Vec2[], z0: number, z1: number, opts: ExtrudeOpts<K> = {}): Mesh {
  const { name = 'ext', cname = 'OPTIMUS' as K, taper1 = 1.0, taper0 = 1.0, cx = 0.0, cy = 0.0 } = opts;
  const n = outline.length;
  const verts: Vec3[] = [];
  for (const [u, v] of outline) verts.push([(u - cx) * taper0 + cx, (v - cy) * taper0 + cy, z0]);
  for (const [u, v] of outline) verts.push([(u - cx) * taper1 + cx, (v - cy) * taper1 + cy, z1]);
  const faces: number[][] = [];
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([j, j2, n + j2, n + j]); }
  const b: number[] = []; for (let i = n - 1; i >= 0; i--) b.push(i); faces.push(b);
  const t: number[] = []; for (let i = n; i < 2 * n; i++) t.push(i); faces.push(t);
  return meshObj(name, verts, faces, cname);
}

/* round tube along a spine; radii = scalar or per-point list */
function tube(spine: Array<V3 | Vec3>, radii: number | number[], opts: TubeOpts<K> = {}): Mesh {
  const { n = 24, name = 'tube', cname = 'OPTIMUS' as K, cap = true, up = vec(0, 0, 1) } = opts;
  const rs = (typeof radii === 'number') ? new Array(spine.length).fill(radii) : radii;
  const st = spine.map((_, i) => ({ t: i / (spine.length - 1), ax: rs[i] }));
  return loftSpine(spine, st, {
    n, name, cname, up, cap0: cap, cap1: cap,
    tip0: rs[0] * 0.6, tip1: rs[rs.length - 1] * 0.6,
    rings: Math.max(spine.length * 4, 16)
  });
}

/* optlib.join, keeping the collection in step */
function joinMeshes(meshes: Mesh[], name: string, cname: K): Mesh {
  for (let i = 1; i < meshes.length; i++) collRemove(cname, meshes[i]);
  return join(meshes, name);
}

  return { loft, loftSpine, pillow, extrudeOutline, tube, joinMeshes }
}
