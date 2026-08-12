/**
 * p_head.py — head shell: glossy face plate + matte rear hood, cyan edge LED.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { lateInit, smoothstep, vec } from '../../../procgen/blenderkit/mathkit'
import { polyfit, polyval } from '../../../procgen/blenderkit/curves'
import { Curve1D } from '../../../procgen/blenderkit/curves'
import { setmat } from '../../../procgen/blenderkit/meshdata'
import { finish } from '../../../procgen/blenderkit/bevel'
import { copysignPow } from '../../../procgen/blenderkit/profiles'
import { collClear, loft, loftSpine } from '../optimusKit'
import type { V3, Vec3 } from '../../../procgen/blenderkit/mathkit'
import type { Mesh } from '../../../procgen/blenderkit/meshdata'
import type { Station, Surface } from '../../../procgen/blenderkit/profiles'
/** Anything with a scalar `at(x)`: an `HPoly` fit or a plain `polyfit`. */
type Fitted = { at(x: number): number }

/* ==========================================================================
   7. p_head.py -- head shell: glossy face plate + matte rear hood,
      cyan edge LED.
   ========================================================================== */

/* (z, half-width, back Y, front depth, e_back, e_front) */
export const HEAD = [
  [1.4880, 0.0560, 0.0920, 0.0300, 2.70, 2.90],
  [1.4950, 0.0546, 0.0930, 0.0470, 2.64, 2.84],
  [1.5020, 0.0530, 0.0942, 0.0628, 2.58, 2.76],
  [1.5090, 0.0520, 0.0946, 0.0748, 2.52, 2.68],
  [1.5160, 0.0516, 0.0902, 0.0842, 2.47, 2.60],
  [1.5230, 0.0522, 0.0866, 0.0884, 2.43, 2.54],
  [1.5300, 0.0536, 0.0842, 0.0908, 2.40, 2.49],
  [1.5395, 0.0580, 0.0830, 0.0942, 2.37, 2.45],
  [1.5475, 0.0614, 0.0834, 0.0968, 2.36, 2.43],
  [1.5555, 0.0638, 0.0846, 0.0990, 2.35, 2.42],
  [1.5635, 0.0658, 0.0868, 0.1008, 2.34, 2.41],
  [1.5715, 0.0680, 0.0886, 0.1024, 2.34, 2.40],
  [1.5795, 0.0702, 0.0908, 0.1038, 2.33, 2.39],
  [1.5875, 0.0722, 0.0930, 0.1050, 2.33, 2.38],
  [1.5955, 0.0738, 0.0964, 0.1056, 2.33, 2.38],
  [1.6030, 0.0750, 0.1002, 0.1058, 2.33, 2.38],
  [1.6110, 0.0766, 0.1030, 0.1058, 2.33, 2.38],
  [1.6190, 0.0776, 0.1048, 0.1053, 2.34, 2.39],
  [1.6270, 0.0784, 0.1064, 0.1042, 2.35, 2.40],
  [1.6350, 0.0792, 0.1071, 0.1020, 2.36, 2.41],
  [1.6430, 0.0796, 0.1071, 0.1004, 2.37, 2.42],
  [1.6510, 0.0796, 0.1068, 0.0982, 2.38, 2.44],
  [1.6590, 0.0792, 0.1060, 0.0964, 2.40, 2.46],
  [1.6665, 0.0783, 0.1042, 0.0932, 2.42, 2.48],
  [1.6745, 0.0772, 0.1016, 0.0896, 2.44, 2.50],
  [1.6825, 0.0748, 0.0974, 0.0850, 2.46, 2.52],
  [1.6905, 0.0702, 0.0920, 0.0798, 2.48, 2.55],
  [1.6985, 0.0643, 0.0870, 0.0720, 2.51, 2.58],
  [1.7065, 0.0572, 0.0798, 0.0645, 2.54, 2.62],
  [1.7145, 0.0480, 0.0692, 0.0512, 2.58, 2.67],
  [1.7215, 0.0374, 0.0578, 0.0384, 2.63, 2.73],
  [1.7265, 0.0250, 0.0450, 0.0250, 2.70, 2.82],
  [1.7295, 0.0110, 0.0290, 0.0110, 2.80, 2.95],
];

export const _HZ = HEAD.map(h => h[0]);
export let H_AX = lateInit<Fitted>(), H_BY = lateInit<Fitted>(), H_BY2 = lateInit<Fitted>(),
    H_EB = lateInit<Fitted>(), H_EF = lateInit<Fitted>();

/* least-squares polynomial in normalised z, evaluated as sqrt(P(z)) */
export class HPoly {
  a: number
  b: number
  c: number[]
  constructor(xs: number[], ys: number[], deg = 9, w: number[] | null = null) {
    this.a = xs[0]; this.b = xs[xs.length - 1];
    const t = xs.map(x => this._t(x));
    const d = ys.map(y => y * y);
    this.c = polyfit(t, d, deg, w);
  }
  _t(x: number): number { return (2.0 * (x - this.a) / (this.b - this.a)) - 1.0; }
  at(x: number): number {
    const v = polyval(this.c, this._t(x));
    return v > 0.0 ? Math.sqrt(v) : 0.0;
  }
}

export function fairPoly(xs: number[], ys: number[], deg = 9): HPoly {
  const w = new Array(xs.length).fill(1.0);
  for (let i = 0; i < 3; i++) w[i] = 3.0;                       /* hold the jaw roll-under */
  for (let i = xs.length - 6; i < xs.length; i++) w[i] = 3.0;   /* and the crown           */
  return new HPoly(xs, ys, deg, w);
}
export function fairLin(xs: number[], ys: number[], deg = 5): Fitted {
  const p = polyfit(xs, ys, deg, null);
  return { at: (x: number): number => polyval(p, x) };
}

export function headCurves() {
  H_AX = fairPoly(_HZ, HEAD.map(h => h[1]));
  H_BY = fairPoly(_HZ, HEAD.map(h => h[2]));
  H_BY2 = fairPoly(_HZ, HEAD.map(h => h[3]));
  H_EB = fairLin(_HZ, HEAD.map(h => h[4]));
  H_EF = fairLin(_HZ, HEAD.map(h => h[5]));
}

export const CROWN_Z0 = 1.6960, CROWN_Z1 = 1.7160;

export function headOy(z: number): number {
  const k = smoothstep(CROWN_Z0, CROWN_Z1, z);
  return k * 0.5 * (H_BY.at(z) - H_BY2.at(z));
}
export function headSection(z: number): [number, number, number, number] {
  const oy = headOy(z);
  return [H_AX.at(z), H_BY.at(z) - oy, H_BY2.at(z) + oy, oy];
}

/* u in [-2,2] : 0 = front meridian, +/-1 = widest point, +/-2 = back */
export function headPt(u: number, z: number): V3 {
  const th = -Math.PI / 2 + u * Math.PI / 2;
  const [axv, byv, by2v, oy] = headSection(z);
  const ax = Math.max(1e-6, axv);
  const e = Math.max(2.02, Math.sin(th) < 0 ? H_EF.at(z) : H_EB.at(z));
  const p = 2.0 / e;
  const c = Math.cos(th), s = Math.sin(th);
  const x = ax * copysignPow(c, p, c);
  const b = s >= 0 ? byv : by2v;
  const y = oy + b * copysignPow(s, p, s);
  return vec(x, y, z);
}

export function headSurf(offset = 0.0, uscale = 0.085): Surface {
  const du = 4e-4, dv = 4e-4;
  const raw = (a: number, v: number): V3 => headPt(a / uscale, v);
  return (a: number, v: number): [V3, V3] => {
    const pu = raw(a + du, v).sub(raw(a - du, v));
    const pv = raw(a, v + dv).sub(raw(a, v - dv));
    let n = pu.cross(pv);
    if (n.length < 1e-12) n = vec(0, -1, 0);
    n = n.normalized();
    return [raw(a, v).add(n.mul(offset)), n];
  };
}

/* exact inverse of headPt for a point lying on the shell */
export function uOfPoint(p: Vec3): number {
  const z = p[2];
  const [axv, byv, by2v, oy] = headSection(z);
  const ax = Math.max(1e-6, axv);
  const dy = p[1] - oy;
  const back = dy >= 0.0;
  const b = Math.max(1e-6, back ? byv : by2v);
  const e = Math.max(2.02, back ? H_EB.at(z) : H_EF.at(z));
  const cx = Math.pow(Math.min(1.0, Math.abs(p[0]) / ax), e / 2.0);
  const cy = Math.pow(Math.min(1.0, Math.abs(dy) / b), e / 2.0);
  const th = Math.atan2((back ? 1.0 : -1.0) * cy, cx);
  return 2.0 * th / Math.PI + 1.0;
}

export const SEAM_UZ = [
  [0.000, 1.5090], [0.100, 1.5098], [0.200, 1.5120], [0.300, 1.5158],
  [0.400, 1.5208], [0.500, 1.5264], [0.600, 1.5324], [0.700, 1.5390],
  [0.750, 1.5427], [0.800, 1.5480], [0.830, 1.5536], [0.860, 1.5620],
  [0.880, 1.5714], [0.900, 1.5806], [0.920, 1.5920], [0.940, 1.6046],
  [0.955, 1.6162], [0.970, 1.6318], [0.985, 1.6486], [1.000, 1.6630],
  [1.020, 1.6702], [1.045, 1.6762], [1.075, 1.6822], [1.115, 1.6880],
  [1.170, 1.6944], [1.240, 1.7013], [1.330, 1.7072], [1.450, 1.7124],
  [1.600, 1.7166], [1.760, 1.7196], [1.900, 1.7212], [2.000, 1.7218],
];
export const SEAM_UMAX = 2.000;
export const seamCurve = () => new Curve1D(SEAM_UZ.map(p => p[0]), SEAM_UZ.map(p => p[1]), 'pchip');

export const Z_APEX = 1.7320;
export const CROWN_START = 1.7180;

export function buildHeadShell(): Mesh {
  headCurves();
  const z0 = HEAD[0][0];
  const st: Station[] = [];
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const z = z0 + (CROWN_START - z0) * (i / N);
    const [ax, by, by2, oy] = headSection(z);
    st.push({ t: z, ax, by, by2, oy, e: H_EB.at(z), e_dn: H_EF.at(z) });
  }
  const [axc, byc, by2c, oyc] = headSection(CROWN_START);
  const halfc = 0.5 * (byc + by2c);
  const h = Z_APEX - CROWN_START;
  const eb = H_EB.at(CROWN_START), ef = H_EF.at(CROWN_START);
  const M = 26;
  for (let j = 1; j <= M; j++) {
    const s = 1.0 - j / M;
    const z = CROWN_START + h * (1.0 - s * s);
    st.push({ t: z, ax: Math.max(2e-5, axc * s), by: Math.max(2e-5, halfc * s),
              by2: Math.max(2e-5, halfc * s), oy: oyc, e: eb, e_dn: ef });
  }
  const NB = 250;
  const ringT: number[] = [];
  for (let i = 0; i <= NB; i++) ringT.push(z0 + (CROWN_START - z0) * (i / NB));
  for (let j = 1; j <= M * 2; j++) {
    const s = 1.0 - j / (M * 2.0);
    ringT.push(CROWN_START + h * (1.0 - s * s));
  }
  const ob = loft(st, { n: 112, ring_t: ringT, name: 'head_shell', cname: 'HEAD',
                        cap0: true, cap1: true, tip0: 0.0060, tip1: 0.00012,
                        mode: 'spline', even: 0.58 });
  finish(ob, { bevel: 0.0007, bseg: 2, bangle: 44 });
  setmat(ob, 'M_HELMET');
  return ob;
}

/* paint the glossy face plate onto the shell -- everything ABOVE the seam */
export function assignVisorFaces(ob: Mesh): Mesh {
  const cz = seamCurve();
  const idx = ob.mats.length;
  ob.mats.push('M_VISOR');
  for (let fi = 0; fi < ob.f.length; fi++) {
    const c = ob.faceCentre(fi);
    const u = Math.min(SEAM_UMAX, Math.max(0.0, uOfPoint(c)));
    if (c[2] > cz.at(u)) ob.fm[fi] = idx;
  }
  return ob;
}

export function buildVisorLed() {
  const cz = seamCurve();
  const surf = headSurf(0.0007);
  const uscale = 0.085;
  const N = 420;
  const UM = SEAM_UMAX - 0.004;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = -UM + 2.0 * UM * (i / N);
    const z = cz.at(Math.abs(u));
    pts.push(surf(u * uscale, z)[0]);
  }
  const st = [];
  for (let i = 0; i <= N; i++) st.push({ t: i / N, ax: 0.00145, by: 0.00105, e: 2.6 });
  const ob = loftSpine(pts, st, { n: 14, name: 'visor_led', cname: 'HEAD',
                                  up: vec(0, 0, 1), cap0: true, cap1: true,
                                  tip0: 0.0006, tip1: 0.0006, rings: N + 1 });
  finish(ob, { bevel: 0 });
  setmat(ob, 'M_LED');
  return ob;
}

export function buildHead() {
  collClear('HEAD');
  headCurves();
  const sh = buildHeadShell();
  assignVisorFaces(sh);
  buildVisorLed();
}

