/**
 * p_arm.py — shoulder cap, upper arm, elbow housing + ribbed pad, open-frame
 * forearm with exposed actuator, wrist block.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { lateInit, smoothstep, vec } from '../../../procgen/blenderkit/mathkit'
import { Curve1D } from '../../../procgen/blenderkit/curves'
import { setmat } from '../../../procgen/blenderkit/meshdata'
import { finish } from '../../../procgen/blenderkit/bevel'
import { copysignPow, polyOutline } from '../../../procgen/blenderkit/profiles'
import { collClear, loft, pillow } from '../optimusKit'
import type { V3, Vec2 } from '../../../procgen/blenderkit/mathkit'
import type { Station, Surface } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   8. p_arm.py -- shoulder cap, upper arm, elbow housing + ribbed pad,
      open-frame forearm with exposed actuator, wrist block.
   ========================================================================== */

export const ARM_C = [
  [1.4400, 0.1755, 0.0470], [1.4000, 0.1900, 0.0510], [1.3600, 0.2055, 0.0555],
  [1.3200, 0.2140, 0.0600], [1.2700, 0.2195, 0.0655], [1.2200, 0.2240, 0.0705],
  [1.1700, 0.2278, 0.0748], [1.1300, 0.2302, 0.0770], [1.0800, 0.2332, 0.0742],
  [1.0300, 0.2372, 0.0662], [0.9800, 0.2420, 0.0546], [0.9300, 0.2470, 0.0404],
  [0.8900, 0.2496, 0.0288], [0.8500, 0.2466, 0.0140],
];
export let AX_C = lateInit<Curve1D>(), AY_C = lateInit<Curve1D>();

export function armCurves() {
  const zs = ARM_C.map(a => a[0]);
  AX_C = new Curve1D(zs, ARM_C.map(a => a[1]), 'spline');
  AY_C = new Curve1D(zs, ARM_C.map(a => a[2]), 'spline');
}

export const _st = (z: number, ax: number, by: number, by2: number | null = null, e = 2.6,
                    e_dn: number | null = null, sx = 1): Station => ({
  t: z, ax, by, by2: (by2 === null ? by : by2),
  e, e_dn: (e_dn === null ? e : e_dn),
  ox: sx * AX_C.at(z), oy: AY_C.at(z)
});

export function buildShoulderCap(sx = 1) {
  const rows = [
    [1.4425, 0.0098, 0.0195, 0.0150], [1.4380, 0.0180, 0.0320, 0.0245],
    [1.4310, 0.0310, 0.0470, 0.0370], [1.4220, 0.0432, 0.0600, 0.0482],
    [1.4110, 0.0510, 0.0668, 0.0552], [1.3980, 0.0572, 0.0712, 0.0604],
    [1.3800, 0.0590, 0.0726, 0.0626], [1.3600, 0.0588, 0.0718, 0.0624],
    [1.3400, 0.0568, 0.0692, 0.0606], [1.3200, 0.0548, 0.0656, 0.0576],
    [1.3020, 0.0524, 0.0616, 0.0544], [1.2870, 0.0500, 0.0578, 0.0512],
    [1.2760, 0.0478, 0.0546, 0.0486],
  ];
  const st = rows.map(([z, ax, by, by2]) => {
    const t = smoothstep(1.2760, 1.3600, z);
    return { t: z, ax, by, by2, e: 2.55, e_dn: 2.75,
             ox: sx * (AX_C.at(z) + 0.0026 * t), oy: AY_C.at(z) };
  });
  const ob = loft(st, { n: 64, rings: 96, name: `shoulder_cap${sx}`, cname: 'ARM',
                        cap0: false, cap1: true, tip1: 0.0090, mode: 'spline', even: 0.66 });
  finish(ob, { bevel: 0.0011, bseg: 3, bangle: 34 });
  setmat(ob, 'M_SHELL');
  return ob;
}

export function buildUpperarm(sx = 1) {
  const rows = [
    [1.4180, 0.0480, 0.0620, 0.0505], [1.4000, 0.0518, 0.0662, 0.0556],
    [1.3700, 0.0538, 0.0682, 0.0588], [1.3400, 0.0532, 0.0664, 0.0578],
    [1.3100, 0.0516, 0.0630, 0.0552], [1.2800, 0.0500, 0.0596, 0.0524],
    [1.2500, 0.0486, 0.0566, 0.0500], [1.2200, 0.0472, 0.0540, 0.0478],
    [1.1990, 0.0464, 0.0524, 0.0464], [1.1930, 0.0458, 0.0516, 0.0456],
  ];
  const st = rows.map(([z, ax, by, by2]) => _st(z, ax, by, by2, 2.55, 2.75, sx));
  const ob = loft(st, { n: 64, rings: 92, name: `upperarm${sx}`, cname: 'ARM',
                        cap0: false, cap1: false, mode: 'spline', even: 0.66 });
  finish(ob, { bevel: 0.0010, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
  return ob;
}

export function buildArmRing(sx = 1, z = 1.1930, h = 0.0042, out = 0.0012) {
  const rows = [[z + h, 0.0455, 0.0512, 0.0452], [z, 0.0452, 0.0508, 0.0449],
                [z - h, 0.0455, 0.0512, 0.0452]];
  const st = rows.map(([zz, ax, by, by2]) => _st(zz, ax - out, by - out, by2 - out, 2.55, 2.75, sx));
  const ob = loft(st, { n: 64, rings: 14, name: `armring${sx}`, cname: 'ARM',
                        cap0: false, cap1: false, mode: 'pchip', even: 0.66 });
  finish(ob, { bevel: 0.0004, bseg: 1, bangle: 40 });
  setmat(ob, 'M_DARKGREY');
  return ob;
}

export const ELBOW_ROWS = [
  [1.1900, 0.0455, 0.0512, 0.0452], [1.1700, 0.0452, 0.0508, 0.0446],
  [1.1400, 0.0446, 0.0500, 0.0434], [1.1100, 0.0438, 0.0486, 0.0418],
  [1.0800, 0.0426, 0.0466, 0.0400], [1.0500, 0.0410, 0.0442, 0.0378],
  [1.0250, 0.0392, 0.0418, 0.0356], [1.0050, 0.0374, 0.0396, 0.0336],
  [0.9930, 0.0360, 0.0380, 0.0322],
];
export const EZ = ELBOW_ROWS.map(r => r[0]);
export let E_AX = lateInit<Curve1D>(), E_BY = lateInit<Curve1D>(), E_BY2 = lateInit<Curve1D>();

export function elbowCurves() {
  E_AX = new Curve1D(EZ, ELBOW_ROWS.map(r => r[1]), 'spline');
  E_BY = new Curve1D(EZ, ELBOW_ROWS.map(r => r[2]), 'spline');
  E_BY2 = new Curve1D(EZ, ELBOW_ROWS.map(r => r[3]), 'spline');
}

export function buildElbowHousing(sx = 1) {
  const st = ELBOW_ROWS.map(([z, ax, by, by2]) => _st(z, ax, by, by2, 2.5, 2.7, sx));
  const ob = loft(st, { n: 64, rings: 92, name: `elbow${sx}`, cname: 'ARM',
                        cap0: false, cap1: false, mode: 'spline', even: 0.66 });
  finish(ob, { bevel: 0.0009, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
  return ob;
}

/* (a,v) on the elbow housing.  u=0 -> outboard (+X side), u=+/-1 -> +/-Y */
export function elbowSurf(sx = 1, offset = 0.0, uscale = 0.048): Surface {
  const du = 4e-4, dv = 4e-4;
  const raw = (a: number, v: number): V3 => {
    const u = a / uscale;
    const th = u * Math.PI / 2.0;
    const ax = Math.max(1e-6, E_AX.at(v));
    const s = Math.sin(th);
    const by = s >= 0 ? E_BY.at(v) : E_BY2.at(v);
    const e = s >= 0 ? 2.5 : 2.7;
    const p = 2.0 / e;
    const c = Math.cos(th);
    const x = ax * copysignPow(c, p, c);
    const y = by * copysignPow(s, p, s);
    return vec(sx * (AX_C.at(v) + x), AY_C.at(v) + y, v);
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

/* (z, half-extent in u) 1.0 = 90 deg of the section */
export const PAD = [
  [1.1745, 0.00], [1.1715, 0.230], [1.1670, 0.400], [1.1595, 0.545],
  [1.1480, 0.650], [1.1320, 0.722], [1.1100, 0.768], [1.0850, 0.784],
  [1.0580, 0.778], [1.0340, 0.744], [1.0170, 0.676], [1.0065, 0.568],
  [1.0000, 0.412], [0.9975, 0.212], [0.9968, 0.00],
];

export function buildElbowPad(sx = 1) {
  const zs = PAD.map(p => p[0]);
  const cu = new Curve1D(zs, PAD.map(p => p[1]), 'spline');
  const uscale = 0.048;
  const ctr = -1.00;
  const pts: Vec2[] = [];
  const N = 60;
  const z1 = PAD[0][0], z0 = PAD[PAD.length - 1][0];
  for (let i = 0; i <= N; i++) { const v = z1 - (z1 - z0) * (i / N); pts.push([(ctr + cu.at(v)) * uscale, v]); }
  for (let i = 0; i <= N; i++) { const v = z0 + (z1 - z0) * (i / N); pts.push([(ctr - cu.at(v)) * uscale, v]); }
  const outline = polyOutline(pts, 150, 1);

  const disp = (_u: number, v: number): number => {
    const f = Math.cos(2 * Math.PI * (v - 1.0870) / 0.0208);
    const env = smoothstep(0.9990, 1.0140, v) * smoothstep(1.1760, 1.1580, v);
    return 0.00135 * f * env;
  };

  const surf = elbowSurf(sx, 0.0011, uscale);
  const ob = pillow(outline, surf, {
    t_front: 0.0030, t_back: 0.0120, layers: 42, name: `elbowpad${sx}`,
    cname: 'ARM', rim: 0.24, centre: [ctr * uscale, 1.0860], disp
  });
  finish(ob, { bevel: 0.0005, bseg: 2, bangle: 44 });
  setmat(ob, 'M_RUBBER');
  return ob;
}

export function buildArmSeam(sx = 1, z = 1.3060, depth = 0.0016) {
  const rows = [[z + 0.0030, 0.0524, 0.0620, 0.0548],
                [z, 0.0512, 0.0606, 0.0536],
                [z - 0.0030, 0.0524, 0.0620, 0.0548]];
  const st = rows.map(([zz, ax, by, by2]) => ({
    t: zz, ax: ax - depth, by: by - depth, by2: by2 - depth,
    e: 2.55, e_dn: 2.75, ox: sx * (AX_C.at(zz) + 0.0010), oy: AY_C.at(zz)
  }));
  const ob = loft(st, { n: 56, rings: 12, name: `armseam${sx}`, cname: 'ARM',
                        cap0: false, cap1: false, mode: 'pchip', even: 0.66 });
  finish(ob, { bevel: 0.0004, bseg: 1, bangle: 44 });
  setmat(ob, 'M_DARKGREY');
  return ob;
}

export const FA_ROWS = [
  [0.9960, 0.0362, 0.0382, 0.0324], [0.9800, 0.0356, 0.0372, 0.0314],
  [0.9600, 0.0348, 0.0358, 0.0300], [0.9400, 0.0340, 0.0342, 0.0286],
  [0.9200, 0.0332, 0.0326, 0.0272], [0.9000, 0.0324, 0.0310, 0.0258],
  [0.8850, 0.0318, 0.0298, 0.0248],
];

export function buildForearmFrame(sx = 1) {
  const zs = FA_ROWS.map(r => r[0]);
  const fax = new Curve1D(zs, FA_ROWS.map(r => r[1]), 'spline');
  const fby = new Curve1D(zs, FA_ROWS.map(r => r[2]), 'spline');
  const fby2 = new Curve1D(zs, FA_ROWS.map(r => r[3]), 'spline');
  for (const [rail, sgn] of [['out', 1], ['in', -1]] as Array<[string, number]>) {
    const st = [];
    for (const z of [0.9975, 0.9880, 0.9700, 0.9500, 0.9300, 0.9100, 0.8940, 0.8860]) {
      const a = fax.at(z);
      st.push({ t: z, ax: 0.0090, by: (fby.at(z) + fby2.at(z)) * 0.50,
                by2: (fby.at(z) + fby2.at(z)) * 0.50, e: 2.7, e_dn: 2.7,
                ox: sx * (AX_C.at(z) + sgn * (a - 0.0086)),
                oy: AY_C.at(z) + (fby.at(z) - fby2.at(z)) * 0.5 });
    }
    const ob = loft(st, { n: 40, rings: 54, name: `fa_rail_${rail}${sx}`, cname: 'ARM',
                          cap0: true, cap1: true, tip0: 0.006, tip1: 0.006,
                          mode: 'spline', even: 0.7 });
    finish(ob, { bevel: 0.0008, bseg: 2, bangle: 34 });
    setmat(ob, 'M_SHELL');
  }
  const st = [];
  for (const z of [0.9975, 0.9850, 0.9650, 0.9450, 0.9250, 0.9060, 0.8930, 0.8865]) {
    const a = fax.at(z);
    st.push({ t: z, ax: a - 0.0022, by: 0.0058, by2: 0.0058, e: 4.0,
              ox: sx * AX_C.at(z), oy: AY_C.at(z) + fby.at(z) - 0.0050 });
  }
  const ob = loft(st, { n: 44, rings: 48, name: `fa_web${sx}`, cname: 'ARM',
                        cap0: true, cap1: true, tip0: 0.004, tip1: 0.004, mode: 'spline' });
  finish(ob, { bevel: 0.0007, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
}

export function buildForearmActuator(sx = 1) {
  const st = [];
  for (const [z, r] of [[0.9930, 0.0138], [0.9880, 0.0176], [0.9750, 0.0192],
                        [0.9450, 0.0195], [0.9150, 0.0192], [0.9000, 0.0180],
                        [0.8940, 0.0150]]) {
    st.push({ t: z, ax: r, by: r * 1.02, e: 2.3,
              ox: sx * (AX_C.at(z) + 0.0016), oy: AY_C.at(z) + 0.0038 });
  }
  const ob = loft(st, { n: 44, rings: 44, name: `fa_act${sx}`, cname: 'ARM',
                        cap0: true, cap1: true, tip0: 0.004, tip1: 0.004, mode: 'spline' });
  finish(ob, { bevel: 0.0007, bseg: 2, bangle: 36 });
  setmat(ob, 'M_DARKMECH');
  return ob;
}

export function buildWrist(sx = 1) {
  const st = [];
  for (const [z, ax, by, by2] of [[0.8900, 0.0300, 0.0288, 0.0244],
                                  [0.8850, 0.0292, 0.0281, 0.0238],
                                  [0.8820, 0.0284, 0.0274, 0.0232],
                                  [0.8790, 0.0268, 0.0260, 0.0222]]) {
    st.push(_st(z, ax, by, by2, 3.0, 3.2, sx));
  }
  const ob = loft(st, { n: 48, rings: 30, name: `wrist${sx}`, cname: 'ARM',
                        cap0: false, cap1: true, tip1: 0.0062, mode: 'spline' });
  finish(ob, { bevel: 0.0008, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
  return ob;
}

export function buildArm(sx = 1) {
  armCurves();
  elbowCurves();
  buildShoulderCap(sx);
  buildUpperarm(sx);
  buildArmSeam(sx);
  buildArmRing(sx);
  buildElbowHousing(sx);
  buildElbowPad(sx);
  buildForearmFrame(sx);
  buildForearmActuator(sx);
  buildWrist(sx);
}

export function buildArms() {
  collClear('ARM');
  buildArm(1);
  buildArm(-1);
}

