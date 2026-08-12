/**
 * p_hand.py — five-finger hand: white structural frame, black back plate,
 * segmented fingers and an opposed thumb.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { R, vec } from '../../../procgen/blenderkit/mathkit'
import { Curve1D } from '../../../procgen/blenderkit/curves'
import { mirrorDup, setmat, xform } from '../../../procgen/blenderkit/meshdata'
import { finish } from '../../../procgen/blenderkit/bevel'
import { copysignPow, polyOutline, rrectOutline } from '../../../procgen/blenderkit/profiles'
import { COLL, collClear, extrudeOutline, loft, loftSpine, pillow } from '../optimusKit'
import type { CollName } from '../optimusKit'
import { AX_C, AY_C, armCurves } from './arm'
import type { V3, Vec2 } from '../../../procgen/blenderkit/mathkit'
import type { Mesh } from '../../../procgen/blenderkit/meshdata'
import type { Station } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   9. p_hand.py -- five-finger hand: white structural frame, black back plate,
      white phalanges with dark joint bands.
   ========================================================================== */

export const HAND_YAW = 58.0;
export const WRIST = [0.2474, 0.0161, 0.8600];

/* the forearm leans forward ~17 deg by the wrist; derived from ARM_C itself */
export function wristTilt() {
  const z0 = 0.9500, z1 = 0.8600;
  if (!AX_C) armCurves();
  const dy = AY_C.at(z1) - AY_C.at(z0);
  const dz = z1 - z0;
  return Math.atan2(dy, -dz) * 180 / Math.PI;
}

export function place(ob: Mesh, sx: number): Mesh {
  xform(ob, { rot: [0, 0, sx * HAND_YAW] });
  xform(ob, { rot: [wristTilt(), 0, 0] });
  xform(ob, { loc: [sx * WRIST[0], WRIST[1], WRIST[2]] });
  return ob;
}

export function buildWristCuff(sx = 1, cname: CollName = 'HAND'): Mesh[] {
  const out: Mesh[] = [];
  let st: Station[] = [{ t: -0.0010, ax: 0.0296, by: 0.0220, e: 3.2 },
            { t: -0.0075, ax: 0.0300, by: 0.0224, e: 3.2 },
            { t: -0.0155, ax: 0.0296, by: 0.0218, e: 3.2 },
            { t: -0.0205, ax: 0.0286, by: 0.0208, e: 3.2 }];
  const ob = loft(st, { n: 48, rings: 20, name: `wrist_cuff${sx}`, cname,
                        cap0: true, cap1: false, tip0: 0.0050, mode: 'spline' });
  finish(ob, { bevel: 0.0006, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
  out.push(ob);

  st = [{ t: 0.0175, ax: 0.0132, by: 0.0146, e: 2.8 },
        { t: 0.0120, ax: 0.0150, by: 0.0165, e: 2.8 },
        { t: 0.0040, ax: 0.0154, by: 0.0168, e: 2.8 },
        { t: -0.0020, ax: 0.0146, by: 0.0160, e: 2.8 }];
  const cv = loft(st, { n: 36, rings: 18, name: `wrist_clevis${sx}`, cname,
                        cap0: true, cap1: false, tip0: 0.0040, mode: 'spline' });
  finish(cv, { bevel: 0.0007, bseg: 2, bangle: 32 });
  setmat(cv, 'M_DARKMECH');
  out.push(cv);

  st = [{ t: -0.0250, ax: 0.0070, by: 0.0070, e: 2.1 },
        { t: 0.0250, ax: 0.0070, by: 0.0070, e: 2.1 }];
  const pin = loft(st, { n: 28, rings: 8, name: `wristpin${sx}`, cname,
                         cap0: true, cap1: true, tip0: 0.0018, tip1: 0.0018, axis: 'x' });
  xform(pin, { loc: [0.0, 0.0, 0.0090] });
  finish(pin, { bevel: 0.0004, bseg: 2, bangle: 40 });
  setmat(pin, 'M_ALU');
  out.push(pin);

  const bx = extrudeOutline(rrectOutline(0.0090, 0.0086, 0.0022, 44),
                            -0.0245, -0.0210, { name: `cuff_boss${sx}`, cname });
  xform(bx, { rot: [90, 0, 0] });
  xform(bx, { loc: [0.0, 0.0, -0.0112] });
  finish(bx, { bevel: 0.0006, bseg: 2, bangle: 34 });
  setmat(bx, 'M_SHELL');
  out.push(bx);
  return out.map(o => place(o, sx));
}

export function buildPalm(sx = 1, cname: CollName = 'HAND'): Mesh {
  const rows = [
    [-0.0210, 0.0300, 0.0196, 0.0186], [-0.0300, 0.0336, 0.0206, 0.0196],
    [-0.0420, 0.0356, 0.0208, 0.0198], [-0.0560, 0.0368, 0.0202, 0.0192],
    [-0.0700, 0.0372, 0.0192, 0.0180], [-0.0810, 0.0368, 0.0180, 0.0168],
    [-0.0880, 0.0358, 0.0168, 0.0156],
  ];
  const st = rows.map(([z, ax, by, by2]) => ({ t: z, ax, by, by2, e: 3.0, e_dn: 3.2 }));
  const ob = loft(st, { n: 56, rings: 54, name: `palm${sx}`, cname,
                        cap0: false, cap1: true, tip1: 0.0075, mode: 'spline', even: 0.7 });
  finish(ob, { bevel: 0.0009, bseg: 2, bangle: 34 });
  setmat(ob, 'M_SHELL');
  return place(ob, sx);
}

export function buildHandBack(sx = 1, cname: CollName = 'HAND'): Mesh {
  const zs = [-0.0210, -0.0300, -0.0420, -0.0560, -0.0700, -0.0810, -0.0880];
  const axs = [0.0292, 0.0316, 0.0334, 0.0340, 0.0338, 0.0332, 0.0322];
  const bys = [0.0186, 0.0196, 0.0198, 0.0192, 0.0180, 0.0168, 0.0156];
  const cax = new Curve1D(zs, axs, 'spline');
  const cby = new Curve1D(zs, bys, 'spline');
  const uscale = 0.030;

  const raw = (a: number, v: number): V3 => {
    const u = a / uscale;
    const th = -Math.PI / 2 + u * Math.PI / 2;
    const ax = Math.max(1e-6, cax.at(v));
    const by = cby.at(v);
    const p = 2.0 / 3.2;
    const c = Math.cos(th), s = Math.sin(th);
    return vec(ax * copysignPow(c, p, c), by * copysignPow(s, p, s), v);
  };
  const surf = (a: number, v: number): [V3, V3] => {
    const pu = raw(a + 3e-4, v).sub(raw(a - 3e-4, v));
    const pv = raw(a, v + 3e-4).sub(raw(a, v - 3e-4));
    let n = pu.cross(pv);
    if (n.length < 1e-12) n = vec(0, -1, 0);
    n = n.normalized();
    return [raw(a, v).add(n.mul(0.0009)), n];
  };

  const ol = [[-0.0225, 0.62], [-0.0270, 0.80], [-0.0340, 0.90], [-0.0450, 0.95],
              [-0.0580, 0.95], [-0.0700, 0.92], [-0.0800, 0.86], [-0.0862, 0.74],
              [-0.0892, 0.52], [-0.0902, 0.00]];
  const cu = new Curve1D(ol.map(o => o[0]), ol.map(o => o[1]), 'spline');
  const pts: Vec2[] = [];
  const N = 42;
  const z1 = -0.0225, z0 = -0.0902;
  for (let i = 0; i <= N; i++) { const v = z1 + (z0 - z1) * (i / N); pts.push([cu.at(v) * uscale, v]); }
  for (let i = 0; i <= N; i++) { const v = z0 + (z1 - z0) * (i / N); pts.push([-cu.at(v) * uscale, v]); }
  const outline = polyOutline(pts, 124, 1);
  const ob = pillow(outline, surf, {
    t_front: 0.0022, t_back: 0.0090, layers: 11, name: `handback${sx}`,
    cname, rim: 0.30, centre: [0.0, -0.0540]
  });
  finish(ob, { bevel: 0.0006, bseg: 2, bangle: 30 });
  setmat(ob, 'M_BLACK');
  return place(ob, sx);
}

/* (x, y, z_knuckle, length, radius, splay, curl) */
export const FINGERS = [
  [-0.0330, -0.0010, -0.0830, 0.1020, 0.0086, 13.0, 5.0],
  [-0.0110, -0.0014, -0.0890, 0.1120, 0.0088, 4.0, 6.0],
  [0.0110, -0.0014, -0.0872, 0.1045, 0.0085, -4.5, 6.5],
  [0.0330, -0.0010, -0.0798, 0.0880, 0.0078, -14.0, 7.0],
];

export function buildFinger(sx: number, idx: number, cname: CollName = 'HAND'): Mesh[] {
  const [x, y, z, L, r, splay, curl] = FINGERS[idx];
  const segs = [[0.44, 1.00, 0.94], [0.33, 0.94, 0.88], [0.23, 0.88, 0.74]];
  const objs = [];
  let pos = vec(0, 0, 0);
  let ang = 0.0;
  const stack = [pos.clone()];
  for (const [f] of segs) {
    ang += R(curl);
    pos = pos.add(vec(0, Math.sin(ang), -Math.cos(ang)).mul(L * f));
    stack.push(pos.clone());
  }

  for (let si = 0; si < segs.length; si++) {
    const [, r0, r1] = segs[si];
    const a = stack[si], b = stack[si + 1];
    const n = b.sub(a).normalized();
    const rr0 = r * r0, rr1 = r * r1;
    const sp = [a.add(n.mul(0.0006)), a.mul(0.75).add(b.mul(0.25)),
                a.mul(0.4).add(b.mul(0.6)), b.sub(n.mul(0.0010))];
    const st = [{ t: 0.0, ax: rr0 * 0.94, by: rr0 * 0.78, e: 3.4 },
                { t: 0.34, ax: rr0, by: rr0 * 0.82, e: 3.4 },
                { t: 0.72, ax: (rr0 + rr1) * 0.5, by: (rr0 + rr1) * 0.41, e: 3.4 },
                { t: 1.0, ax: rr1 * 0.96, by: rr1 * 0.80, e: 3.4 }];
    const ob = loftSpine(sp, st, { n: 26, name: `fseg${idx}_${si}_${sx}`, cname,
                                   up: vec(1, 0, 0), cap0: true, cap1: true,
                                   tip0: rr0 * 0.55, tip1: rr1 * (si === 2 ? 0.90 : 0.55),
                                   rings: 18 });
    finish(ob, { bevel: 0.0005, bseg: 2, bangle: 34 });
    setmat(ob, si < 2 ? 'M_SHELL' : 'M_BLACK');
    objs.push(ob);
    if (si < 2) {
      const c = b;
      const nn = stack[si + 2].sub(a).normalized();
      const jb = loftSpine([c.sub(nn.mul(0.0050)), c.add(nn.mul(0.0050))],
                           [{ t: 0.0, ax: rr1 * 0.90, by: rr1 * 0.78, e: 3.0 },
                            { t: 1.0, ax: rr1 * 0.90, by: rr1 * 0.78, e: 3.0 }],
                           { n: 24, name: `fjnt${idx}_${si}_${sx}`, cname,
                             up: vec(1, 0, 0), cap0: true, cap1: true,
                             tip0: 0.0012, tip1: 0.0012, rings: 8 });
      finish(jb, { bevel: 0.0004, bseg: 1, bangle: 40 });
      setmat(jb, 'M_DARKGREY');
      objs.push(jb);
    }
  }

  for (const ob of objs) {
    xform(ob, { rot: [0, splay, 0] });
    xform(ob, { loc: [x, y, z] });
    place(ob, sx);
  }
  return objs;
}

export function buildThumb(sx = 1, cname: CollName = 'HAND'): Mesh[] {
  const objs = [];
  const L = 0.0700, r = 0.0094;
  const segs = [[0.52, 1.00, 0.92], [0.48, 0.92, 0.76]];
  let pos = vec(0, 0, 0);
  let ang = 0.0;
  const stack = [pos.clone()];
  for (const [f] of segs) {
    ang += R(20.0);
    pos = pos.add(vec(0, Math.sin(ang), -Math.cos(ang)).mul(L * f));
    stack.push(pos.clone());
  }
  for (let si = 0; si < segs.length; si++) {
    const [, r0, r1] = segs[si];
    const a = stack[si], b = stack[si + 1];
    const rr0 = r * r0, rr1 = r * r1;
    const st = [{ t: 0.0, ax: rr0 * 0.92, by: rr0 * 0.82, e: 3.0 },
                { t: 0.5, ax: (rr0 + rr1) * 0.5, by: (rr0 + rr1) * 0.45, e: 3.0 },
                { t: 1.0, ax: rr1 * 0.95, by: rr1 * 0.84, e: 3.0 }];
    const ob = loftSpine([a, a.mul(0.5).add(b.mul(0.5)), b], st,
                         { n: 26, name: `thumb${si}_${sx}`, cname,
                           up: vec(1, 0, 0), cap0: true, cap1: true,
                           tip0: rr0 * 0.55, tip1: rr1 * (si ? 0.95 : 0.55), rings: 16 });
    finish(ob, { bevel: 0.0005, bseg: 2, bangle: 34 });
    setmat(ob, si === 0 ? 'M_SHELL' : 'M_BLACK');
    objs.push(ob);
  }
  for (const ob of objs) {
    xform(ob, { rot: [0, 34, 0] });
    xform(ob, { rot: [-26, 0, 0] });
    xform(ob, { loc: [-0.0372, 0.0086, -0.0410] });
    place(ob, sx);
  }
  return objs;
}

export function buildHand(sx = 1) {
  buildWristCuff(sx);
  buildPalm(sx);
  buildHandBack(sx);
  for (let i = 0; i < 4; i++) buildFinger(sx, i);
  buildThumb(sx);
}

export function buildHands() {
  collClear('HAND');
  buildHand(1);
  /* left hand = true mirror of the right so the thumb sits correctly */
  for (const ob of COLL.HAND.slice()) {
    const m = mirrorDup(ob, ob.name + '_M', 'x');
    m.coll = 'HAND';
    COLL.HAND.push(m);
  }
}

