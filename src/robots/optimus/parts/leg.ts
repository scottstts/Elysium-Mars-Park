/**
 * p_leg.py — thigh (dark core + white shell), knee cap, shin, ankle actuator.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { lateInit, vec } from '../../../procgen/blenderkit/mathkit'
import { Curve1D } from '../../../procgen/blenderkit/curves'
import { setmat, xform } from '../../../procgen/blenderkit/meshdata'
import { finish } from '../../../procgen/blenderkit/bevel'
import { copysignPow, polyOutline, rrectOutline } from '../../../procgen/blenderkit/profiles'
import { collClear, extrudeOutline, loft, loftSpine, pillow, tube } from '../optimusKit'
import type { V3, Vec2, Vec3 } from '../../../procgen/blenderkit/mathkit'
import type { Mesh } from '../../../procgen/blenderkit/meshdata'
import type { Station, Surface } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   11. p_leg.py -- thigh (dark core + white shell), knee cap, shin, ankle
       actuators and push-rods.
   ========================================================================== */

export const LEGX = 0.1170;

/* (z, half-width, back Y, front depth, e_back, e_front, x-offset, y-centre) */
export const LEG = [
  [0.8780, 0.0512, 0.1400, 0.0250, 3.1, 3.2, -0.0060, 0.0000],
  [0.8700, 0.0560, 0.1440, 0.0330, 3.1, 3.2, -0.0050, 0.0000],
  [0.8500, 0.0596, 0.1490, 0.0480, 3.1, 3.2, -0.0030, 0.0000],
  [0.8200, 0.0620, 0.1490, 0.0600, 3.1, 3.2, -0.0010, 0.0000],
  [0.7900, 0.0628, 0.1400, 0.0678, 3.1, 3.2, 0.0000, 0.0000],
  [0.7600, 0.0630, 0.1300, 0.0728, 3.0, 3.2, 0.0005, 0.0000],
  [0.7300, 0.0632, 0.1245, 0.0768, 3.0, 3.2, 0.0010, 0.0000],
  [0.7000, 0.0632, 0.1180, 0.0796, 3.0, 3.2, 0.0010, 0.0000],
  [0.6700, 0.0602, 0.1060, 0.0802, 3.0, 3.2, 0.0010, 0.0000],
  [0.6400, 0.0578, 0.0920, 0.0790, 3.0, 3.2, 0.0010, 0.0000],
  [0.6100, 0.0552, 0.0830, 0.0818, 3.0, 3.2, 0.0005, 0.0000],
  [0.5800, 0.0540, 0.0712, 0.0866, 3.0, 3.2, 0.0000, 0.0000],
  [0.5500, 0.0538, 0.0600, 0.0898, 3.0, 3.2, -0.0005, 0.0000],
  [0.5250, 0.0538, 0.0520, 0.0918, 3.0, 3.2, -0.0010, 0.0000],
  [0.5050, 0.0532, 0.0478, 0.0932, 3.0, 3.2, -0.0015, 0.0000],
];
export const LZ = LEG.map(r => r[0]);
export let L_AX = lateInit<Curve1D>(), L_BY = lateInit<Curve1D>(), L_BY2 = lateInit<Curve1D>(),
    L_OX = lateInit<Curve1D>();

export function legCurves() {
  L_AX = new Curve1D(LZ, LEG.map(r => r[1]), 'spline');
  L_BY = new Curve1D(LZ, LEG.map(r => r[2]), 'spline');
  L_BY2 = new Curve1D(LZ, LEG.map(r => r[3]), 'spline');
  L_OX = new Curve1D(LZ, LEG.map(r => r[6]), 'spline');
}

export const _lst = (z: number, sx: number, shrink = 0.0): Station => ({
  t: z, ax: L_AX.at(z) - shrink, by: L_BY.at(z) - shrink,
  by2: L_BY2.at(z) - shrink, e: 3.0, e_dn: 3.2, ox: sx * (LEGX + L_OX.at(z))
});

export function buildThighCore(sx = 1) {
  const st = LEG.map(r => _lst(r[0], sx, 0.0032));
  const ob = loft(st, { n: 72, rings: 120, name: `thigh_core${sx}`, cname: 'LEG',
                        cap0: false, cap1: false, mode: 'spline', even: 0.66 });
  finish(ob, { bevel: 0.0009, bseg: 2, bangle: 36 });
  setmat(ob, 'M_BLACK');
  return ob;
}

/* u = 0 -> outboard (+X for sx=+1); u=+1 -> back(+Y); u=-1 -> front(-Y) */
export function legSurf(sx = 1, offset = 0.0, uscale = 0.062, shrink = 0.0): Surface {
  const du = 4e-4, dv = 4e-4;
  const raw = (a: number, v: number): V3 => {
    const u = a / uscale;
    const th = u * Math.PI / 2.0;
    const ax = Math.max(1e-6, L_AX.at(v) - shrink);
    const s = Math.sin(th);
    const by = (s >= 0 ? L_BY.at(v) : L_BY2.at(v)) - shrink;
    const e = s >= 0 ? 3.0 : 3.2;
    const p = 2.0 / e;
    const c = Math.cos(th);
    const x = ax * copysignPow(c, p, c);
    const y = by * copysignPow(s, p, s);
    return vec(sx * (LEGX + L_OX.at(v) + x), y, v);
  };
  return (a: number, v: number): [V3, V3] => {
    const pu = raw(a + du, v).sub(raw(a - du, v));
    const pv = raw(a, v + dv).sub(raw(a, v - dv));
    let n = sx > 0 ? pu.cross(pv) : pv.cross(pu);
    if (n.length < 1e-12) n = vec(sx, 0, 0);
    n = n.normalized();
    return [raw(a, v).add(n.mul(offset)), n];
  };
}

/* outline of the white thigh shell in (u, z): (z, u_front, u_back) */
export const THIGH_SHELL = [
  [0.8735, -0.11, 0.05], [0.8690, -0.30, 0.16], [0.8600, -0.58, 0.38],
  [0.8470, -0.90, 0.62], [0.8280, -1.18, 0.72], [0.8020, -1.36, 0.82],
  [0.7700, -1.50, 0.90], [0.7300, -1.58, 0.96], [0.6900, -1.61, 0.99],
  [0.6500, -1.61, 0.99], [0.6100, -1.58, 0.96], [0.5850, -1.53, 0.90],
  [0.5650, -1.45, 0.81], [0.5520, -1.33, 0.68], [0.5440, -1.14, 0.48],
  [0.5395, -0.88, 0.27], [0.5375, -0.56, 0.00],
];

export function buildThighShell(sx = 1) {
  const zs = THIGH_SHELL.map(t => t[0]);
  const cf = new Curve1D(zs, THIGH_SHELL.map(t => t[1]), 'spline');
  const cb = new Curve1D(zs, THIGH_SHELL.map(t => t[2]), 'spline');
  const us = 0.062;
  const z1 = THIGH_SHELL[0][0], z0 = THIGH_SHELL[THIGH_SHELL.length - 1][0];
  const pts: Vec2[] = [];
  const N = 66;
  for (let i = 0; i <= N; i++) { const v = z1 - (z1 - z0) * (i / N); pts.push([cb.at(v) * us, v]); }
  for (let i = 0; i <= N; i++) { const v = z0 + (z1 - z0) * (i / N); pts.push([cf.at(v) * us, v]); }
  const outline = polyOutline(pts, 200, 1);
  const surf = legSurf(sx, 0.0016, us);
  const ob = pillow(outline, surf, {
    t_front: 0.0032, t_back: 0.0180, layers: 16, name: `thigh_shell${sx}`,
    cname: 'LEG', rim: 0.20, centre: [-0.18 * us, 0.7000]
  });
  finish(ob, { bevel: 0.0010, bseg: 2, bangle: 30 });
  setmat(ob, 'M_SHELL_LEG');
  return ob;
}

export const SHIN = [
  [0.5250, 0.0542, 0.0420, 0.0880, 3.0, 3.0, 0.0000],
  [0.5050, 0.0545, 0.0405, 0.0905, 3.0, 3.0, 0.0000],
  [0.4850, 0.0530, 0.0470, 0.0910, 3.0, 3.0, 0.0000],
  [0.4600, 0.0508, 0.0400, 0.0900, 3.0, 3.0, 0.0000],
  [0.4300, 0.0358, 0.0262, 0.0850, 3.0, 3.0, 0.0000],
  [0.4000, 0.0340, 0.0250, 0.0790, 3.0, 3.0, 0.0000],
  [0.3600, 0.0338, 0.0300, 0.0700, 3.0, 3.0, 0.0000],
  [0.3200, 0.0348, 0.0348, 0.0620, 3.0, 3.0, 0.0000],
  [0.2800, 0.0322, 0.0400, 0.0560, 3.0, 3.0, 0.0000],
  [0.2400, 0.0296, 0.0450, 0.0500, 3.0, 3.0, 0.0000],
  [0.2000, 0.0272, 0.0480, 0.0430, 3.0, 3.0, 0.0000],
  [0.1700, 0.0256, 0.0470, 0.0360, 3.0, 3.0, 0.0000],
  [0.1400, 0.0242, 0.0420, 0.0300, 3.0, 3.0, 0.0000],
  [0.1150, 0.0234, 0.0340, 0.0250, 3.0, 3.0, 0.0000],
  [0.0980, 0.0230, 0.0270, 0.0220, 3.0, 3.0, 0.0000],
];
export const SZ = SHIN.map(r => r[0]);
export let S_AX = lateInit<Curve1D>(), S_BY = lateInit<Curve1D>(), S_BY2 = lateInit<Curve1D>();

export function shinCurves() {
  S_AX = new Curve1D(SZ, SHIN.map(r => r[1]), 'spline');
  S_BY = new Curve1D(SZ, SHIN.map(r => r[2]), 'spline');
  S_BY2 = new Curve1D(SZ, SHIN.map(r => r[3]), 'spline');
}

export function buildShin(sx = 1) {
  const st = SHIN.map(r => ({ t: r[0], ax: r[1], by: r[2], by2: r[3],
                              e: 3.0, e_dn: 3.1, ox: sx * LEGX }));
  const ob = loft(st, { n: 64, rings: 130, name: `shin${sx}`, cname: 'LEG',
                        cap0: false, cap1: false, mode: 'spline', even: 0.66 });
  finish(ob, { bevel: 0.0009, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL_LEG');
  return ob;
}

export function buildKneeCap(sx = 1) {
  const rows = [[0.5320, 0.0090, 0.0140], [0.5250, 0.0200, 0.0250],
                [0.5150, 0.0296, 0.0330], [0.5000, 0.0356, 0.0378],
                [0.4820, 0.0372, 0.0392], [0.4640, 0.0356, 0.0378],
                [0.4480, 0.0316, 0.0344], [0.4350, 0.0256, 0.0292],
                [0.4270, 0.0170, 0.0215], [0.4230, 0.0080, 0.0120]];
  const st = rows.map(([z, w, h]) => ({
    t: z, ax: w, by: 0.0130, by2: h * 0.30 + 0.0140, e: 2.6, e_dn: 2.6,
    ox: sx * LEGX, oy: -(S_BY2 ? S_BY2.at(z) : 0.088) + 0.0140
  }));
  const ob = loft(st, { n: 48, rings: 54, name: `kneecap${sx}`, cname: 'LEG',
                        cap0: true, cap1: true, tip0: 0.0035, tip1: 0.0030, mode: 'spline' });
  finish(ob, { bevel: 0.0010, bseg: 2, bangle: 32 });
  setmat(ob, 'M_SHELL_LEG');
  return ob;
}

export function buildKneeGap(sx = 1) {
  const st = [{ t: 0.5480, ax: 0.0530, by: 0.0420, by2: 0.0850, e: 3.0, ox: sx * LEGX },
              { t: 0.5350, ax: 0.0525, by: 0.0420, by2: 0.0870, e: 3.0, ox: sx * LEGX },
              { t: 0.5200, ax: 0.0510, by: 0.0415, by2: 0.0885, e: 3.0, ox: sx * LEGX },
              { t: 0.5050, ax: 0.0495, by: 0.0408, by2: 0.0890, e: 3.0, ox: sx * LEGX }];
  const ob = loft(st, { n: 56, rings: 24, name: `kneejoint${sx}`, cname: 'LEG',
                        cap0: false, cap1: false, mode: 'spline' });
  finish(ob, { bevel: 0.0008, bseg: 2, bangle: 36 });
  setmat(ob, 'M_BLACK');
  return ob;
}

export function buildAnkleActuator(sx = 1, side = 1) {
  const objs: Mesh[] = [];
  const zk = [0.4460, 0.3900, 0.3730, 0.2280, 0.2000, 0.1740, 0.0960];
  const xk = [0.0430, 0.0402, 0.0400, 0.0400, 0.0356, 0.0290, 0.0150];
  const XO = new Curve1D(zk, xk, 'spline');
  const YO = (z: number): number => 0.5 * (S_BY.at(z) - S_BY2.at(z)) - 0.0050;
  const ox = (z: number): number => sx * (LEGX + side * XO.at(z));

  let sp: Vec3[] = [[ox(0.4460), YO(0.4460), 0.4460], [ox(0.4220), YO(0.4220), 0.4220],
            [ox(0.3980), YO(0.3980), 0.3980], [ox(0.3800), YO(0.3800), 0.3800]];
  let rod = tube(sp, [0.0044, 0.0042, 0.0041, 0.0042],
                 { n: 16, name: `ankrodU${sx}_${side}`, cname: 'LEG' });
  finish(rod, { bevel: 0.0004, bseg: 2, bangle: 36 });
  setmat(rod, 'M_ALU');
  objs.push(rod);

  const cl = extrudeOutline(rrectOutline(0.0130, 0.0175, 0.0038, 44),
                            0.0, 0.0088, { name: `ankclv${sx}_${side}`, cname: 'LEG' });
  xform(cl, { rot: [0, 90, 0] });
  xform(cl, { loc: [ox(0.4480) - side * sx * 0.0044, YO(0.4480), 0.4480] });
  finish(cl, { bevel: 0.0008, bseg: 2, bangle: 32 });
  setmat(cl, 'M_DARKMECH');
  objs.push(cl);

  const zs = [0.3730, 0.3480, 0.3000, 0.2520, 0.2270];
  const spine = zs.map((z): Vec3 => [ox(z), YO(z), z]);
  let st: Station[] = [{ t: 0.00, ax: 0.0080, by: 0.0196, e: 3.2 },
            { t: 0.10, ax: 0.0102, by: 0.0250, e: 3.2 },
            { t: 0.44, ax: 0.0102, by: 0.0252, e: 3.2 },
            { t: 0.82, ax: 0.0098, by: 0.0240, e: 3.2 },
            { t: 1.00, ax: 0.0078, by: 0.0192, e: 3.2 }];
  const ob = loftSpine(spine, st, { n: 40, name: `ankact${sx}_${side}`, cname: 'LEG',
                                    up: vec(1, 0, 0), cap0: true, cap1: true,
                                    tip0: 0.0060, tip1: 0.0050, rings: 56 });
  finish(ob, { bevel: 0.0009, bseg: 2, bangle: 32 });
  setmat(ob, 'M_DARKMECH');
  objs.push(ob);

  const zc = [0.3790, 0.3700, 0.3610];
  st = [{ t: 0.0, ax: 0.0078, by: 0.0196, e: 3.0 },
        { t: 0.5, ax: 0.0112, by: 0.0264, e: 3.0 },
        { t: 1.0, ax: 0.0104, by: 0.0252, e: 3.0 }];
  const cap = loftSpine(zc.map(z => [ox(z), YO(z), z]), st,
                        { n: 36, name: `ankcap${sx}_${side}`, cname: 'LEG',
                          up: vec(1, 0, 0), cap0: true, cap1: false,
                          tip0: 0.0040, rings: 14 });
  finish(cap, { bevel: 0.0006, bseg: 2, bangle: 34 });
  setmat(cap, 'M_DARKMECH');
  objs.push(cap);

  sp = [[ox(0.2290), YO(0.2290), 0.2290], [ox(0.2060), YO(0.2060), 0.2060],
        [ox(0.1840), YO(0.1840), 0.1840], [ox(0.1680), YO(0.1680), 0.1680]];
  rod = tube(sp, [0.0038, 0.0037, 0.0036, 0.0036],
             { n: 16, name: `ankrodL${sx}_${side}`, cname: 'LEG' });
  finish(rod, { bevel: 0.0004, bseg: 2, bangle: 36 });
  setmat(rod, 'M_ALU');
  objs.push(rod);

  sp = [[ox(0.1700), YO(0.1700), 0.1700], [ox(0.1420), YO(0.1420), 0.1420],
        [ox(0.1160), YO(0.1160), 0.1160], [ox(0.0960), YO(0.0960), 0.0960]];
  const lk = tube(sp, [0.0040, 0.0038, 0.0038, 0.0042],
                  { n: 16, name: `anklink${sx}_${side}`, cname: 'LEG' });
  finish(lk, { bevel: 0.0004, bseg: 2, bangle: 36 });
  setmat(lk, 'M_DARKMECH');
  objs.push(lk);
  return objs;
}

export function buildAnkle(sx = 1) {
  const objs = [];
  let st: Station[] = [{ t: 0.1080, ax: 0.0238, by: 0.0300, by2: 0.0250, e: 3.0, ox: sx * LEGX },
            { t: 0.0950, ax: 0.0250, by: 0.0320, by2: 0.0268, e: 3.0, ox: sx * LEGX },
            { t: 0.0840, ax: 0.0252, by: 0.0322, by2: 0.0270, e: 3.0, ox: sx * LEGX },
            { t: 0.0740, ax: 0.0238, by: 0.0300, by2: 0.0252, e: 3.0, ox: sx * LEGX }];
  const ob = loft(st, { n: 44, rings: 20, name: `ankle${sx}`, cname: 'LEG',
                        cap0: false, cap1: true, tip1: 0.0060, mode: 'spline' });
  finish(ob, { bevel: 0.0008, bseg: 2, bangle: 34 });
  setmat(ob, 'M_DARKMECH');
  objs.push(ob);
  st = [{ t: -0.034, ax: 0.0080, by: 0.0080, e: 2.1 },
        { t: 0.034, ax: 0.0080, by: 0.0080, e: 2.1 }];
  const pin = loft(st, { n: 24, rings: 6, name: `anklepin${sx}`, cname: 'LEG',
                         cap0: true, cap1: true, tip0: 0.0018, tip1: 0.0018, axis: 'x' });
  xform(pin, { loc: [sx * LEGX, 0.0030, 0.0870] });
  finish(pin, { bevel: 0.0004, bseg: 2, bangle: 40 });
  setmat(pin, 'M_ALU');
  objs.push(pin);
  return objs;
}

export function buildLeg(sx = 1) {
  legCurves();
  shinCurves();
  buildThighCore(sx);
  buildThighShell(sx);
  buildKneeGap(sx);
  buildShin(sx);
  buildKneeCap(sx);
  buildAnkleActuator(sx, 1);
  buildAnkleActuator(sx, -1);
  buildAnkle(sx);
}

export function buildLegs() {
  collClear('LEG');
  buildLeg(1);
  buildLeg(-1);
}

