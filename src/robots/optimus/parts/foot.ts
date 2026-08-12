/**
 * p_foot.py — moulded charcoal boot: upper, sole lip, ankle socket.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { setmat, xform } from '../../../procgen/blenderkit/meshdata'
import { finish } from '../../../procgen/blenderkit/bevel'
import { collClear, loft } from '../optimusKit'
import { LEGX } from './leg'
import type { Station } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   12. p_foot.py -- moulded charcoal boot: upper, sole lip, ankle socket.
   ========================================================================== */

/* (y, half-width, top z) -- y negative = toward the toe */
export const FOOT = [
  [0.0665, 0.0270, 0.0330], [0.0600, 0.0348, 0.0500], [0.0470, 0.0410, 0.0660],
  [0.0290, 0.0452, 0.0762], [0.0080, 0.0466, 0.0812], [-0.0180, 0.0478, 0.0824],
  [-0.0450, 0.0482, 0.0786], [-0.0720, 0.0478, 0.0706], [-0.0980, 0.0466, 0.0602],
  [-0.1230, 0.0458, 0.0512], [-0.1440, 0.0442, 0.0430], [-0.1600, 0.0412, 0.0374],
  [-0.1710, 0.0364, 0.0338], [-0.1782, 0.0296, 0.0310],
];

export function buildFoot(sx = 1) {
  let st: Station[] = FOOT.map(([y, w, h]) => ({ t: -y, ax: w, by: h * 0.72, by2: h * 0.30,
                                      e: 2.15, e_dn: 3.8, oy: h * 0.28 }));
  const ob = loft(st, { n: 60, rings: 120, name: `foot${sx}`, cname: 'FOOT',
                        cap0: true, cap1: true, tip0: 0.0130, tip1: 0.0088,
                        mode: 'spline', even: 0.66 });
  xform(ob, { rot: [90, 0, 0] });
  xform(ob, { loc: [sx * LEGX, 0.0, 0.0] });
  finish(ob, { bevel: 0.0018, bseg: 3, bangle: 30 });
  setmat(ob, 'M_FOOT');

  st = FOOT.map(([y, w]) => ({ t: -y, ax: w + 0.0014, by: 0.0050, by2: 0.0050,
                               e: 3.6, e_dn: 3.2, oy: 0.0050 }));
  const lip = loft(st, { n: 60, rings: 120, name: `sole${sx}`, cname: 'FOOT',
                         cap0: true, cap1: true, tip0: 0.0060, tip1: 0.0042,
                         mode: 'spline', even: 0.66 });
  xform(lip, { rot: [90, 0, 0] });
  xform(lip, { loc: [sx * LEGX, 0.0, 0.0] });
  finish(lip, { bevel: 0.0012, bseg: 3, bangle: 30 });
  setmat(lip, 'M_DARKMECH');

  st = [{ t: 0.0930, ax: 0.0262, by: 0.0316, by2: 0.0286, e: 2.6, oy: 0.0060 },
        { t: 0.0860, ax: 0.0258, by: 0.0308, by2: 0.0278, e: 2.6, oy: 0.0060 },
        { t: 0.0750, ax: 0.0246, by: 0.0292, by2: 0.0264, e: 2.6, oy: 0.0060 },
        { t: 0.0650, ax: 0.0224, by: 0.0266, by2: 0.0240, e: 2.6, oy: 0.0060 }];
  for (const s of st) s.ox = sx * LEGX;
  const sock = loft(st, { n: 44, rings: 20, name: `socket${sx}`, cname: 'FOOT',
                          cap0: false, cap1: true, tip1: 0.0050, mode: 'spline' });
  finish(sock, { bevel: 0.0008, bseg: 2, bangle: 34 });
  setmat(sock, 'M_DARKGREY');
}

export function buildFeet() {
  collClear('FOOT');
  buildFoot(1);
  buildFoot(-1);
}
