/**
 * p_hip.py — exposed pelvis / hip actuator assembly.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { setmat, shade, xform } from '../../../procgen/blenderkit/meshdata'
import { addBevel, boolean, finish } from '../../../procgen/blenderkit/bevel'
import { rrectOutline } from '../../../procgen/blenderkit/profiles'
import { collClear, collRemove, extrudeOutline, loft } from '../optimusKit'
import type { CollName } from '../optimusKit'
import type { Station } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   10. p_hip.py -- exposed pelvis / hip actuator assembly.
   ========================================================================== */

export const HIPX = 0.1120;
export const HIPY = 0.0300;
export const POD_Z = 0.8990;
export const POD_Y = 0.0470;

export function boltRing(cx: number, cy: number, cz: number, r: number, n: number,
                         br = 0.0028, h = 0.0024, cname: CollName = 'HIP',
                  mat = 'M_DARKMECH', tag = 'b', phase = 0.0) {
  const objs = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * (i / n) + phase;
    const st = [{ t: 0.0, ax: br, by: br, e: 2.2 },
                { t: h, ax: br * 0.84, by: br * 0.84, e: 2.2 }];
    const ob = loft(st, { n: 12, rings: 4, name: `${tag}${i}`, cname,
                          cap0: false, cap1: true, tip1: br * 0.4 });
    xform(ob, { loc: [cx + r * Math.cos(a), cy + r * Math.sin(a), cz] });
    finish(ob, { bevel: 0.0003, bseg: 1, bangle: 40 });
    setmat(ob, mat);
    objs.push(ob);
  }
  return objs;
}

export function buildHipCentre() {
  const objs = [];
  let st: Station[] = [{ t: 1.0060, ax: 0.0400, by: 0.0470, by2: 0.0300, e: 2.6, oy: HIPY },
            { t: 0.9950, ax: 0.0452, by: 0.0520, by2: 0.0330, e: 2.8, oy: HIPY },
            { t: 0.9820, ax: 0.0478, by: 0.0552, by2: 0.0348, e: 3.0, oy: HIPY },
            { t: 0.9650, ax: 0.0482, by: 0.0558, by2: 0.0352, e: 3.1, oy: HIPY },
            { t: 0.9480, ax: 0.0470, by: 0.0542, by2: 0.0342, e: 3.0, oy: HIPY },
            { t: 0.9360, ax: 0.0432, by: 0.0500, by2: 0.0316, e: 2.9, oy: HIPY }];
  const ob = loft(st, { n: 56, rings: 40, name: 'hip_centre', cname: 'HIP',
                        cap0: true, cap1: true, tip0: 0.0090, tip1: 0.0075, mode: 'spline' });
  finish(ob, { bevel: 0.0012, bseg: 2, bangle: 32 });
  setmat(ob, 'M_DARKMECH');
  objs.push(ob);
  for (const [z, r] of [[0.9985, 0.0462], [0.9900, 0.0478], [0.9810, 0.0482]]) {
    st = [{ t: z - 0.0026, ax: r, by: r * 1.16, by2: r * 0.72, e: 3.0, oy: HIPY },
          { t: z, ax: r + 0.0026, by: (r + 0.0026) * 1.16, by2: (r + 0.0026) * 0.72, e: 3.0, oy: HIPY },
          { t: z + 0.0026, ax: r, by: r * 1.16, by2: r * 0.72, e: 3.0, oy: HIPY }];
    const rg = loft(st, { n: 56, rings: 10, name: `hipring${Math.trunc(z * 1e4)}`,
                          cname: 'HIP', cap0: false, cap1: false, mode: 'pchip' });
    finish(rg, { bevel: 0.0004, bseg: 1, bangle: 40 });
    setmat(rg, 'M_DARKMECH');
    objs.push(rg);
  }
  const fp = extrudeOutline(rrectOutline(0.0420, 0.0300, 0.0058, 60),
                            -0.0075, -0.0018, { name: 'hip_plate', cname: 'HIP' });
  xform(fp, { rot: [90, 0, 0] });
  xform(fp, { loc: [0.0, -0.0026, 0.9740] });
  finish(fp, { bevel: 0.0009, bseg: 2, bangle: 34 });
  setmat(fp, 'M_DARKMECH');
  objs.push(fp);
  objs.push(...boltRing(0.0, -0.0060, 0.9740 + 0.0088, 0.0, 1, 0.0040, 0.0022,
                        'HIP', 'M_DARKMECH', 'hipctrbolt'));
  return objs;
}

export function buildHipDrum(sx = 1) {
  const objs = [];
  const cx = sx * HIPX;
  const rows = [[-0.0560, 0.0300, 0.0330], [-0.0470, 0.0400, 0.0442],
                [-0.0330, 0.0466, 0.0530], [-0.0140, 0.0492, 0.0578],
                [0.0060, 0.0496, 0.0592], [0.0250, 0.0486, 0.0576],
                [0.0400, 0.0450, 0.0524], [0.0510, 0.0378, 0.0430],
                [0.0560, 0.0300, 0.0330]];
  let st: Station[] = rows.map(([dx, hz, dy]) => ({
    t: cx + sx * dx, ax: hz, by: dy, by2: dy * 0.86, e: 3.3, e_dn: 3.5, oy: POD_Y
  }));
  const ob = loft(st, { n: 64, rings: 56, name: `hipdrum${sx}`, cname: 'HIP',
                        cap0: true, cap1: true, tip0: 0.0075, tip1: 0.0075,
                        mode: 'spline', axis: 'x' });
  xform(ob, { loc: [0.0, 0.0, POD_Z] });
  finish(ob, { bevel: 0.0016, bseg: 3, bangle: 30 });
  setmat(ob, 'M_DARKMECH');

  const ol = rrectOutline(0.0430, 0.0490, 0.0090, 60);
  const cut = extrudeOutline(ol, -0.0090, 0.0110, { name: `poddcut${sx}`, cname: 'HIP', taper0: 0.78 });
  xform(cut, { rot: [90, 0, 0] });
  xform(cut, { loc: [cx, POD_Y + 0.0600, POD_Z] });
  boolean(ob, cut);
  collRemove('HIP', cut);
  shade(ob, true, 32);
  addBevel(ob, 0.0010, 2, 30);
  objs.push(ob);

  st = [{ t: cx + sx * 0.0500, ax: 0.0250, by: 0.0250, e: 2.05, oy: POD_Y },
        { t: cx + sx * 0.0620, ax: 0.0250, by: 0.0250, e: 2.05, oy: POD_Y },
        { t: cx + sx * 0.0655, ax: 0.0212, by: 0.0212, e: 2.05, oy: POD_Y }];
  const bs = loft(st, { n: 48, rings: 14, name: `hipboss${sx}`, cname: 'HIP',
                        cap0: false, cap1: true, tip1: 0.0045, mode: 'pchip', axis: 'x' });
  xform(bs, { loc: [0.0, 0.0, POD_Z] });
  finish(bs, { bevel: 0.0008, bseg: 2, bangle: 34 });
  setmat(bs, 'M_ALU');
  objs.push(bs);

  for (let i = 0; i < 8; i++) {
    const a = 2 * Math.PI * i / 8 + 0.2;
    const stb = [{ t: 0.0, ax: 0.0030, by: 0.0030, e: 2.2 },
                 { t: 0.0024, ax: 0.0024, by: 0.0024, e: 2.2 }];
    const bo = loft(stb, { n: 12, rings: 4, name: `hipbb${sx}${i}`, cname: 'HIP',
                           cap0: false, cap1: true, tip1: 0.0010, axis: 'x' });
    if (sx < 0) xform(bo, { rot: [0, 0, 180] });
    xform(bo, { loc: [cx + sx * 0.0618,
                      POD_Y + 0.0198 * Math.sin(a),
                      POD_Z + 0.0198 * Math.cos(a)] });
    finish(bo, { bevel: 0.0003, bseg: 1, bangle: 40 });
    setmat(bo, 'M_DARKGREY');
    objs.push(bo);
  }
  return objs;
}

export function buildHipBackbox() {
  const objs = [];
  const rows = [[0.9850, 0.0400, 0.0790], [0.9720, 0.0452, 0.1000],
                [0.9560, 0.0505, 0.1230], [0.9380, 0.0546, 0.1410],
                [0.9160, 0.0570, 0.1510], [0.8940, 0.0574, 0.1540],
                [0.8720, 0.0552, 0.1490], [0.8560, 0.0498, 0.1370],
                [0.8460, 0.0410, 0.1170]];
  const st = rows.map(([z, hw, by]) => ({ t: z, ax: hw, by, by2: 0.0250, e: 3.9, e_dn: 3.2 }));
  const ob = loft(st, { n: 56, rings: 64, name: 'hip_sacrum', cname: 'HIP',
                        cap0: true, cap1: true, tip0: 0.0080, tip1: 0.0080, mode: 'spline' });
  finish(ob, { bevel: 0.0018, bseg: 3, bangle: 30 });
  setmat(ob, 'M_DARKMECH');
  objs.push(ob);

  const ol = rrectOutline(0.0330, 0.0760, 0.0100, 64);
  const cut = extrudeOutline(ol, -0.0080, 0.0100, { name: 'sacrum_cut', cname: 'HIP', taper0: 0.78 });
  xform(cut, { rot: [90, 0, 0] });
  xform(cut, { loc: [0.0, 0.1580, 0.9080] });
  boolean(ob, cut);
  collRemove('HIP', cut);
  shade(ob, true, 32);
  addBevel(ob, 0.0010, 2, 30);
  return objs;
}

export function buildHips() {
  collClear('HIP');
  buildHipCentre();
  buildHipBackbox();
  for (const sx of [1, -1]) buildHipDrum(sx);
}

