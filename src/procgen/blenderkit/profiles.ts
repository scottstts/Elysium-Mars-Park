/**
 * `optlib` cross-section profiles, pillow-panel parameterisation and closed
 * outline resampling — the pure (collection-free) half of section 5.
 */
import { TAU, lerp, pmod } from './mathkit'
import type { V3, Vec2 } from './mathkit'

/** One loft station; every field is a curve sample keyed by `t`. */
export interface Station {
  t: number
  ax?: number
  ax2?: number | null
  by?: number | null
  by2?: number | null
  e?: number
  e_dn?: number | null
  ox?: number
  oy?: number
  rot?: number
  scale?: number
}
/** A station with every optional resolved (what `normStation` returns). */
export type FullStation = Required<{ [K in keyof Station]: number }>
/** Parametric surface: `(u, v) -> [point, normal]`. */
export type Surface = (u: number, v: number) => [V3, V3]

/* ---- cross-section profiles -------------------------------------------- */

export const copysignPow = (base: number, p: number, s: number): number => {
  const v = Math.pow(Math.abs(base), p);
  return s < 0 ? -v : v;
};

/* super-ellipse point with independent quadrant extents */
export function sePoint(theta: number, ax: number, ax2: number, by: number, by2: number, eUp: number, eDn: number): Vec2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  const w = 0.5 + 0.5 * s;
  let e = eDn + (eUp - eDn) * w;
  e = Math.max(2.02, e);
  const p = 2.0 / e;
  const a = c >= 0.0 ? ax : ax2;
  const b = s >= 0.0 ? by : by2;
  return [a * copysignPow(c, p, c), b * copysignPow(s, p, s)];
}

/* closed 2-D section, `n` points CCW starting near +X */
export function profile(n: number, ax: number, by?: number | null, ax2?: number | null, by2?: number | null, e?: number | null, e_dn?: number | null, even = 0.72, dense = 512, phase = 0.0): Vec2[] {
  if (by === undefined || by === null) by = ax;
  if (ax2 === undefined || ax2 === null) ax2 = ax;
  if (by2 === undefined || by2 === null) by2 = by;
  if (e === undefined || e === null) e = 2.0;
  if (e_dn === undefined || e_dn === null) e_dn = e;

  const pts: Vec2[] = new Array(dense);
  for (let i = 0; i < dense; i++) pts[i] = sePoint(TAU * i / dense, ax, ax2, by, by2, e, e_dn);
  const cum = new Float64Array(dense + 1);
  for (let i = 0; i < dense; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % dense];
    cum[i + 1] = cum[i] + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  }
  const total = cum[dense];
  const out: Vec2[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const u = pmod(k / n + phase, 1.0);
    const target = u * total;
    let lo = 0, hi = dense;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const f = cum[hi] === cum[lo] ? 0.0 : (target - cum[lo]) / (cum[hi] - cum[lo]);
    const thArc = TAU * (lo + f) / dense;
    const thUni = TAU * u;
    const d = pmod(thArc - thUni + Math.PI, TAU) - Math.PI;
    out[k] = sePoint(thUni + d * even, ax, ax2, by, by2, e, e_dn);
  }
  return out;
}

/* ---- lofting ------------------------------------------------------------ */

export const STATION_KEYS: Array<keyof FullStation> = ['ax', 'ax2', 'by', 'by2', 'e', 'e_dn', 'ox', 'oy', 'rot', 'scale'];

export function normStation(s: Station): FullStation {
  const d = { ax: 0.05, ax2: null, by: null, by2: null, e: 2.0, e_dn: null,
              ox: 0.0, oy: 0.0, rot: 0.0, scale: 1.0, ...s };
  if (d.ax2 === null || d.ax2 === undefined) d.ax2 = d.ax;
  if (d.by === null || d.by === undefined) d.by = d.ax;
  if (d.by2 === null || d.by2 === undefined) d.by2 = d.by;
  if (d.e_dn === null || d.e_dn === undefined) d.e_dn = d.e;
  return d as unknown as FullStation;
}

/* ---- shell / panel construction ---------------------------------------- */

/* 0 at the rim, 1 at the centre, with a soft rolled edge */
export function pillowBulge(s: number, rim: number): number {
  if (s >= rim) return 1.0;
  return Math.pow(Math.sin(Math.min(1.0, s / Math.max(1e-6, rim)) * Math.PI / 2), 0.85);
}

/* f(u,v) -> the pillow's ring parameter s (0 at the rim, 1 at the pole) */
export function pillowS(outline: Vec2[], centre: Vec2 | null = null): (u: number, v: number) => number {
  const n = outline.length;
  let cu, cv;
  if (centre === null) {
    cu = outline.reduce((s, p) => s + p[0], 0) / n;
    cv = outline.reduce((s, p) => s + p[1], 0) / n;
  } else { cu = centre[0]; cv = centre[1]; }

  return (u: number, v: number): number => {
    const dx = u - cu, dy = v - cv;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-18) return 1.0;
    let best: number | null = null;
    for (let i = 0; i < n; i++) {
      const ax = outline[i][0] - cu, ay = outline[i][1] - cv;
      const bx = outline[(i + 1) % n][0] - cu, by = outline[(i + 1) % n][1] - cv;
      const ex = bx - ax, ey = by - ay;
      const den = ex * dy - ey * dx;
      if (Math.abs(den) < 1e-15) continue;
      const t = (dx * ay - dy * ax) / den;
      if (t < -1e-9 || t > 1.0 + 1e-9) continue;
      const k = ((ax + t * ex) * dx + (ay + t * ey) * dy) / r2;
      if (k > 1e-9 && (best === null || k < best)) best = k;
    }
    if (best === null || best <= 1.0) return 0.0;
    return Math.max(0.0, Math.min(1.0, 1.0 - 1.0 / best));
  };
}

/* f(u,v) -> (point, normal) on the OUTER face of the pillow that pillow()
   would build from the same arguments */
export function pillowEval(outline: Vec2[], surf: Surface, { t_front = 0.008, rim = 0.55, centre = null, disp = null }: { t_front?: number; rim?: number; centre?: Vec2 | null; disp?: ((u: number, v: number) => number) | null } = {}): Surface {
  const sOf = pillowS(outline, centre);
  return (u: number, v: number): [V3, V3] => {
    const [p, nrm] = surf(u, v);
    const b = pillowBulge(sOf(u, v), rim);
    const d = disp === null ? 0.0 : disp(u, v) * b;
    return [p.add(nrm.mul(t_front * b + d)), nrm];
  };
}

export function resampleClosed(pts: Vec2[], n: number, phase = 0.0): Vec2[] {
  const m = pts.length;
  const cum = [0.0];
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    cum.push(cum[cum.length - 1] + Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  const total = cum[m];
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const target = pmod(k / n + phase, 1.0) * total;
    let lo = 0, hi = m;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid; }
    const f = cum[hi] === cum[lo] ? 0.0 : (target - cum[lo]) / (cum[hi] - cum[lo]);
    const a = pts[lo % m], b = pts[hi % m];
    out.push([lerp(a[0], b[0], f), lerp(a[1], b[1], f)]);
  }
  return out;
}

/* rounded rectangle outline, resampled evenly, CCW */
export function rrectOutline(w: number, h: number, r: number | number[], n = 96, cx = 0.0, cy = 0.0, seg = 20): Vec2[] {
  const hw = w * 0.5, hh = h * 0.5;
  let rr = (typeof r === 'number') ? [r, r, r, r] : r.slice();
  rr = rr.map(ri => Math.max(1e-5, Math.min(ri, hw - 1e-5, hh - 1e-5)));
  const cs: Vec2[] = [[hw - rr[0], hh - rr[0]], [-hw + rr[1], hh - rr[1]],
              [-hw + rr[2], -hh + rr[2]], [hw - rr[3], -hh + rr[3]]];
  const pts: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const [px, py] = cs[i];
    const a0 = i * Math.PI / 2;
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      pts.push([px + rr[i] * Math.cos(a), py + rr[i] * Math.sin(a)]);
    }
  }
  return resampleClosed(pts, n).map((p): Vec2 => [p[0] + cx, p[1] + cy]);
}

/* resample an arbitrary closed polygon, optional corner smoothing passes */
export function polyOutline(pts: Vec2[], n = 96, smooth = 0): Vec2[] {
  let p = pts.map((q): Vec2 => [q[0], q[1]]);
  for (let s = 0; s < smooth; s++) {
    const q: Vec2[] = [];
    const m = p.length;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % m];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      q.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = q;
  }
  return resampleClosed(p, n);
}
