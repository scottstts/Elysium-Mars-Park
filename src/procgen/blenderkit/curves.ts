/**
 * Interpolation and least-squares fitting: ports of `optlib._pchip_slopes`,
 * `_spline_slopes`, `Curve1D` and `numpy.polyfit` / `polyval`.
 */

/* ---- interpolation (optlib._pchip_slopes / _spline_slopes / Curve1D) ---- */

export function pchipSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  if (n === 2) {
    const d = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return [d, d];
  }
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n).fill(0.0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0.0) m[i] = 0.0;
    else {
      const w1 = 2.0 * h[i] + h[i - 1];
      const w2 = h[i] + 2.0 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  const endslope = (h0: number, h1: number, d0: number, d1: number): number => {
    let m0 = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (m0 * d0 <= 0) m0 = 0.0;
    else if (d0 * d1 <= 0 && Math.abs(m0) > Math.abs(3 * d0)) m0 = 3 * d0;
    return m0;
  };
  const L = h.length, D = d.length;
  m[0] = endslope(h[0], h[1], d[0], d[1]);
  m[n - 1] = endslope(h[L - 1], h[L - 2], d[D - 1], d[D - 2]);
  return m;
}

/* natural cubic spline -> C2 continuous first derivatives */
export function splineSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  if (n < 3) return pchipSlopes(xs, ys);
  const h = [];
  for (let i = 0; i < n - 1; i++) h.push(xs[i + 1] - xs[i]);
  const a = new Array(n).fill(0.0), b = new Array(n).fill(0.0);
  const c = new Array(n).fill(0.0), r = new Array(n).fill(0.0);
  b[0] = 2.0 / h[0]; c[0] = 1.0 / h[0];
  r[0] = 3.0 * (ys[1] - ys[0]) / (h[0] * h[0]);
  for (let i = 1; i < n - 1; i++) {
    a[i] = 1.0 / h[i - 1];
    b[i] = 2.0 * (1.0 / h[i - 1] + 1.0 / h[i]);
    c[i] = 1.0 / h[i];
    r[i] = 3.0 * ((ys[i] - ys[i - 1]) / (h[i - 1] ** 2)
                + (ys[i + 1] - ys[i]) / (h[i] ** 2));
  }
  const hl = h[h.length - 1];
  a[n - 1] = 1.0 / hl; b[n - 1] = 2.0 / hl;
  r[n - 1] = 3.0 * (ys[n - 1] - ys[n - 2]) / (hl * hl);
  for (let i = 1; i < n; i++) {                     /* thomas */
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    r[i] -= w * r[i - 1];
  }
  const m = new Array(n).fill(0.0);
  m[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) m[i] = (r[i] - c[i] * m[i + 1]) / b[i];
  return m;
}

/* piecewise cubic hermite through (x, y) samples */
export class Curve1D {
  xs: number[]
  ys: number[]
  m: number[]
  constructor(xs: number[], ys: number[], mode: 'pchip' | 'spline' = 'pchip') {
    /* python sorted(zip(xs, ys)) -- lexicographic on (x, y) */
    const pair = xs.map((x, i) => [x, ys[i]]).sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
    this.xs = pair.map(p => p[0]);
    this.ys = pair.map(p => p[1]);
    this.m = this.xs.length === 1 ? [0.0]
      : (mode === 'spline' ? splineSlopes(this.xs, this.ys)
                           : pchipSlopes(this.xs, this.ys));
  }
  at(x: number): number {
    const { xs, ys, m } = this;
    const n = xs.length;
    if (n === 1) return ys[0];
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi];
  }
}
/* callable shorthand so ported code reads like the python */
export const curveFn = (c: Curve1D) => ((x: number): number => c.at(x));

/* ---- numpy.polyfit / polyval (needed by p_head._Poly) ------------------- */

/* Householder QR least squares: min ||A x - b|| */
export function lstsqQR(A: number[][], b: number[], rows: number, cols: number): number[] {
  /* work on copies */
  const M = A.map(r => r.slice());
  const y = b.slice();
  for (let k = 0; k < cols; k++) {
    let nrm = 0;
    for (let i = k; i < rows; i++) nrm += M[i][k] * M[i][k];
    nrm = Math.sqrt(nrm);
    if (nrm === 0) continue;
    if (M[k][k] > 0) nrm = -nrm;
    const v = new Array(rows).fill(0);
    for (let i = k; i < rows; i++) v[i] = M[i][k];
    v[k] -= nrm;
    let vv = 0;
    for (let i = k; i < rows; i++) vv += v[i] * v[i];
    if (vv < 1e-300) continue;
    for (let j = k; j < cols; j++) {
      let s = 0;
      for (let i = k; i < rows; i++) s += v[i] * M[i][j];
      s = 2 * s / vv;
      for (let i = k; i < rows; i++) M[i][j] -= s * v[i];
    }
    let s = 0;
    for (let i = k; i < rows; i++) s += v[i] * y[i];
    s = 2 * s / vv;
    for (let i = k; i < rows; i++) y[i] -= s * v[i];
  }
  const x = new Array(cols).fill(0);
  for (let i = cols - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < cols; j++) s -= M[i][j] * x[j];
    x[i] = Math.abs(M[i][i]) < 1e-300 ? 0 : s / M[i][i];
  }
  return x;
}

/* np.polyfit(xs, ys, deg, w=w) -- coefficients highest power first */
export function polyfit(xs: number[], ys: number[], deg: number, w: number[] | null = null): number[] {
  const n = xs.length, order = deg + 1;
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(order);
    let v = 1.0;
    for (let j = order - 1; j >= 0; j--) { row[j] = v; v *= xs[i]; }
    A.push(row);
  }
  const b = ys.slice();
  if (w) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < order; j++) A[i][j] *= w[i];
      b[i] *= w[i];
    }
  }
  /* numpy scales the columns before lstsq for conditioning */
  const scale = new Array(order).fill(0);
  for (let j = 0; j < order; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += A[i][j] * A[i][j];
    scale[j] = Math.sqrt(s) || 1.0;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < order; j++) A[i][j] /= scale[j];
  const c = lstsqQR(A, b, n, order);
  for (let j = 0; j < order; j++) c[j] /= scale[j];
  return c;
}

export function polyval(c: number[], x: number): number {
  let v = 0.0;
  for (let i = 0; i < c.length; i++) v = v * x + c[i];
  return v;
}
