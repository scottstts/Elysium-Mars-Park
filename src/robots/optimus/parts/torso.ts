/**
 * p_torso.py — black torso core (pelvis -> chest -> trapezius -> neck), white
 * chest plate, back plate, moulded back piece, shoulder straps, TESLA wordmark.
 *
 * Verbatim port of the reference Blender/bpy build. Blender's world axes are
 * kept (Z up, the figure faces -Y, origin on the floor between the ankles) so
 * every coordinate here is the number the Python source uses.
 */
import { lateInit, smoothstep, vec } from '../../../procgen/blenderkit/mathkit'
import { Curve1D } from '../../../procgen/blenderkit/curves'
import { quatToMat4, toTrackQuatZY } from '../../../procgen/blenderkit/transform'
import { recalcFaceNormals, setmat, shade, weld } from '../../../procgen/blenderkit/meshdata'
import { addBevel, finish } from '../../../procgen/blenderkit/bevel'
import { polyOutline } from '../../../procgen/blenderkit/profiles'
import { collClear, joinMeshes, loft, meshObj, pillow } from '../optimusKit'
import type { V3, Vec2, Vec3 } from '../../../procgen/blenderkit/mathkit'
import type { Mesh } from '../../../procgen/blenderkit/meshdata'
import type { Surface } from '../../../procgen/blenderkit/profiles'

/* ==========================================================================
   6. p_torso.py -- black torso core (pelvis -> chest -> trapezius -> neck),
      white chest plate, back plate, moulded back piece, shoulder straps,
      TESLA wordmark.
   ========================================================================== */

/* (z, half-width, back Y, front depth, e_back, e_front) */
export const CORE = [
  [0.9520, 0.0620, 0.0730, 0.0290, 2.6, 2.8],
  [0.9640, 0.0648, 0.0768, 0.0316, 2.6, 2.8],
  [0.9760, 0.0670, 0.0800, 0.0336, 2.6, 2.8],
  [0.9880, 0.0688, 0.0828, 0.0350, 2.6, 2.8],
  [1.0000, 0.0706, 0.0870, 0.0374, 2.6, 2.8],
  [1.0090, 0.0776, 0.0960, 0.0420, 2.7, 2.9],
  [1.0135, 0.0930, 0.1090, 0.0500, 2.8, 2.9],
  [1.0180, 0.1098, 0.1212, 0.0598, 2.9, 2.9],
  [1.0330, 0.1160, 0.1246, 0.0640, 2.8, 3.0],
  [1.0480, 0.1210, 0.1276, 0.0656, 2.8, 3.0],
  [1.0640, 0.1252, 0.1306, 0.0648, 2.9, 2.85],
  [1.0800, 0.1288, 0.1338, 0.0638, 3.0, 2.82],
  [1.0960, 0.1312, 0.1372, 0.0628, 3.1, 2.80],
  [1.1150, 0.1330, 0.1408, 0.0622, 3.3, 2.74],
  [1.1400, 0.1345, 0.1450, 0.0622, 3.5, 2.66],
  [1.1700, 0.1362, 0.1500, 0.0630, 3.6, 2.58],
  [1.2000, 0.1390, 0.1552, 0.0642, 3.7, 2.52],
  [1.2300, 0.1428, 0.1614, 0.0662, 3.8, 2.48],
  [1.2600, 0.1472, 0.1672, 0.0682, 3.8, 2.46],
  [1.2900, 0.1516, 0.1722, 0.0694, 3.8, 2.45],
  [1.3200, 0.1552, 0.1762, 0.0698, 3.8, 2.45],
  [1.3500, 0.1580, 0.1776, 0.0640, 3.7, 2.47],
  [1.3750, 0.1596, 0.1758, 0.0570, 3.6, 2.52],
  [1.3950, 0.1618, 0.1718, 0.0500, 3.5, 2.60],
  [1.4100, 0.1672, 0.1672, 0.0420, 3.5, 2.72],
  [1.4210, 0.1762, 0.1610, 0.0384, 3.7, 2.86],
  [1.4310, 0.1842, 0.1540, 0.0348, 3.3, 2.90],
  [1.4400, 0.1876, 0.1452, 0.0316, 3.3, 2.95],
  [1.4480, 0.1830, 0.1360, 0.0300, 3.3, 2.92],
  [1.4560, 0.1690, 0.1276, 0.0292, 3.2, 2.86],
  [1.4640, 0.1432, 0.1190, 0.0286, 3.4, 2.85],
  [1.4720, 0.0982, 0.1120, 0.0284, 3.0, 3.0],
  [1.4800, 0.0776, 0.1056, 0.0284, 2.7, 2.8],
  [1.4900, 0.0580, 0.1075, 0.0316, 2.5, 2.7],
  [1.5000, 0.0466, 0.0975, 0.0296, 2.4, 2.6],
  [1.5120, 0.0424, 0.0820, 0.0296, 2.4, 2.6],
  [1.5280, 0.0410, 0.0780, 0.0326, 2.4, 2.6],
  [1.5450, 0.0412, 0.0772, 0.0366, 2.4, 2.6],
  [1.5620, 0.0420, 0.0768, 0.0396, 2.4, 2.6],
];

export const _ZS = CORE.map(c => c[0]);
export let C_AX = lateInit<Curve1D>(), C_BY = lateInit<Curve1D>(), C_BY2 = lateInit<Curve1D>(),
    C_EB = lateInit<Curve1D>(), C_EF = lateInit<Curve1D>();

export function coreCurves() {
  C_AX = new Curve1D(_ZS, CORE.map(c => c[1]), 'spline');
  C_BY = new Curve1D(_ZS, CORE.map(c => c[2]), 'spline');
  C_BY2 = new Curve1D(_ZS, CORE.map(c => c[3]), 'spline');
  C_EB = new Curve1D(_ZS, CORE.map(c => c[4]), 'spline');
  C_EF = new Curve1D(_ZS, CORE.map(c => c[5]), 'spline');
}

/* A panel edge that reaches the body's own silhouette lands where this
   section has infinite slope, and anything past it used to collapse to y=0 --
   which is what tore the back panel apart along the flank.  Clamping the
   normalised radius keeps the surface, and its normal, finite everywhere. */
export const _TMAX = 0.960;

/* Y of the core's front surface at (x, z); negative = toward the viewer */
export function coreFrontY(x: number, z: number): number {
  const ax = Math.max(1e-6, C_AX.at(z));
  const by2 = C_BY2.at(z);
  const e = Math.max(2.02, C_EF.at(z));
  const t = Math.min(_TMAX, Math.abs(x) / ax);
  return -by2 * Math.pow(Math.max(0.0, 1.0 - Math.pow(t, e)), 1.0 / e);
}
export function coreBackY(x: number, z: number): number {
  const ax = Math.max(1e-6, C_AX.at(z));
  const by = C_BY.at(z);
  const e = Math.max(2.02, C_EB.at(z));
  const t = Math.min(_TMAX, Math.abs(x) / ax);
  return by * Math.pow(Math.max(0.0, 1.0 - Math.pow(t, e)), 1.0 / e);
}

export function coreBackSurf(offset = 0.0): Surface {
  const d = 3e-4;
  const nrm = (u: number, v: number): V3 => {
    let fx = (coreBackY(u + d, v) - coreBackY(u - d, v)) / (2 * d);
    let fz = (coreBackY(u, v + d) - coreBackY(u, v - d)) / (2 * d);
    fx = Math.max(-3.2, Math.min(3.2, fx));
    fz = Math.max(-3.2, Math.min(3.2, fz));
    return vec(-fx, 1.0, -fz).normalize();
  };
  return (u: number, v: number): [V3, V3] => {
    const p = vec(u, coreBackY(u, v), v);
    const n = nrm(u, v);
    return [p.add(n.mul(offset)), n];
  };
}

export function coreFrontSurf(offset = 0.0): Surface {
  const d = 3e-4;
  const nrm = (u: number, v: number): V3 => {
    let fx = (coreFrontY(u + d, v) - coreFrontY(u - d, v)) / (2 * d);
    let fz = (coreFrontY(u, v + d) - coreFrontY(u, v - d)) / (2 * d);
    fx = Math.max(-3.2, Math.min(3.2, fx));
    fz = Math.max(-3.2, Math.min(3.2, fz));
    return vec(fx, -1.0, fz).normalize();
  };
  return (u: number, v: number): [V3, V3] => {
    const n = nrm(u, v);
    return [vec(u, coreFrontY(u, v), v).add(n.mul(offset)), n];
  };
}

export const BACK_EDGE = [
  [1.4460, 0.0980], [1.4400, 0.1190], [1.4320, 0.1330], [1.4200, 0.1430],
  [1.4020, 0.1492], [1.3800, 0.1524], [1.3600, 0.1540], [1.3450, 0.1546],
  [1.3200, 0.1512], [1.2900, 0.1476], [1.2600, 0.1432], [1.2300, 0.1388],
  [1.2000, 0.1350], [1.1800, 0.1334], [1.1680, 0.1308], [1.1620, 0.1240],
];
export const BACK_Z0 = 1.1620, BACK_Z1 = 1.4460;

export const BACKPIECE = [
  [0.0000, 1.3630], [0.0230, 1.3624], [0.0330, 1.3596], [0.0378, 1.3520],
  [0.0424, 1.3318], [0.0474, 1.2993], [0.0532, 1.2633], [0.0618, 1.2272],
  [0.0719, 1.2019], [0.0835, 1.1876], [0.1022, 1.1731], [0.1195, 1.1587],
  [0.1268, 1.1470], [0.1292, 1.1320], [0.1288, 1.0500], [0.1268, 1.0300],
  [0.1180, 1.0225], [0.0880, 1.0200], [0.0400, 1.0192], [0.0000, 1.0190],
];
export const BOX_Z1 = 1.1560, BOX_Z0 = 1.0300;

export const backEdgeCurve = () => new Curve1D(BACK_EDGE.map(p => p[0]), BACK_EDGE.map(p => p[1]), 'spline');

export function backPlateSurf(extra = 0.0): Surface {
  const base = coreBackSurf(0.0);
  const xe = backEdgeCurve();
  return (u: number, v: number): [V3, V3] => {
    const [p, n] = base(u, v);
    const r = Math.min(1.0, Math.abs(u) / Math.max(1e-5, xe.at(v)));
    const lift = 0.0060 * (0.34 + 0.66 * (1.0 - Math.pow(r, 2.6)));
    return [p.add(n.mul(lift + extra)), n];
  };
}

export function buildBackPanel() {
  const xe = backEdgeCurve();
  const surf = backPlateSurf();
  const z1 = BACK_Z1, z0 = BACK_Z0;
  const pts: Vec2[] = [];
  const N = 58;
  for (let i = 0; i <= N; i++) { const v = z1 - (z1 - z0) * (i / N); pts.push([xe.at(v), v]); }
  const b = xe.at(z0);
  for (let i = 1; i < 13; i++) {
    const f = i / 13.0;
    pts.push([b * Math.cos(Math.PI * f), z0 - 0.0020 * Math.sin(Math.PI * f)]);
  }
  for (let i = 0; i <= N; i++) { const v = z0 + (z1 - z0) * (i / N); pts.push([-xe.at(v), v]); }
  const t = xe.at(z1);
  for (let i = 1; i < 11; i++) {
    const f = i / 11.0;
    pts.push([-t * Math.cos(Math.PI * f), z1 + 0.0014 * Math.sin(Math.PI * f)]);
  }
  const outline = polyOutline(pts, 200, 1);
  const ob = pillow(outline, surf, {
    t_front: 0.0038, t_back: 0.0220, layers: 16,
    name: 'back_plate', cname: 'TORSO', rim: 0.16, centre: [0.0, 1.300]
  });
  finish(ob, { bevel: 0.0008, bseg: 2, bangle: 32 });
  setmat(ob, 'M_SHELL');
  return ob;
}

/* service recess in the housing face: half-width, half-height, corner radius,
   centre z, depth, chamfer width.  The rectangle is modelled into the panel's
   own displacement rather than cut with a boolean -- the cutter was a flat
   prism meeting a curved, swelling face, so the rim depth varied and the
   corners came out ragged. */
export const RECESS = [0.0775, 0.0375, 0.0140, 1.0940, 0.0086, 0.0155];

/* signed depth of the framed recess: 0 on the frame, -depth on the floor,
   chamfered between */
export function recessD(u: number, v: number): number {
  const [hw, hh, r, cz, dep, ch] = RECESS;
  const dx = Math.max(0.0, Math.abs(u) - (hw - r));
  const dz = Math.max(0.0, Math.abs(v - cz) - (hh - r));
  const d = Math.hypot(dx, dz) - r;
  return -dep * smoothstep(0.0, -ch, d);
}

export const housing = (v: number): number => smoothstep(BOX_Z1 + 0.0180, BOX_Z1 - 0.0140, v)
                   * (1.0 - smoothstep(BOX_Z0 + 0.0120, BOX_Z0 - 0.0110, v));

export function backpieceDisp(u: number, v: number): number {
  const box = housing(v);
  const shoulder = smoothstep(1.3630, 1.3250, v);
  let d = 0.0034 * shoulder + 0.0112 * box;
  /* reference width kept above the panel's own half-width so this never
     reaches the clamp -- min() here would crease the flank */
  d -= 0.0030 * box * Math.min(1.0, Math.pow(Math.abs(u) / 0.1560, 3.0));
  d += box * recessD(u, v);
  return d;
}

/* --- the back piece as a grid shell ---------------------------------------
   It was built with pillow(), whose rings are scaled copies of the outline
   collapsing onto a pole.  For a tall shield flaring into a wide housing that
   is the wrong topology: the rings pile up unevenly, they carry the outline's
   own corners across the middle of the panel, and a rectangular recess cut
   into them stair-steps along every ring.  A (z, x) grid over the body's back
   surface has none of those problems -- uniform cells, and the recess edges
   land square on the grid. */

export const BP_Z0 = 1.0215, BP_Z1 = 1.3610;
export let _BPW = lateInit<Curve1D>();

export function bpCurves() {
  const side = [[1.3596, 0.0330], [1.3520, 0.0378], [1.3318, 0.0424],
                [1.2993, 0.0474], [1.2633, 0.0532], [1.2272, 0.0618],
                [1.2019, 0.0719], [1.1876, 0.0835], [1.1731, 0.1022],
                [1.1587, 0.1195], [1.1470, 0.1268], [1.1320, 0.1292],
                [1.0500, 0.1288], [1.0300, 0.1268], [1.0225, 0.1180]];
  _BPW = new Curve1D(side.map(p => p[0]), side.map(p => p[1]), 'spline');
}

/* C1 smooth minimum -- a hard min() puts a crease along the curve where the
   two arguments swap over, and on this panel that crease was visible running
   down the flank */
export function smin(a: number, b: number, k = 0.008): number {
  const h = Math.max(0.0, Math.min(1.0, 0.5 + 0.5 * (b - a) / k));
  return b * (1.0 - h) + a * h - k * h * (1.0 - h);
}

/* half-width of the back piece at z, never wider than the torso itself */
export function bpWidth(z: number): number {
  let w = _BPW.at(Math.max(BP_Z0, Math.min(BP_Z1, z)));
  const r = 0.0110;
  const k = smoothstep(BP_Z1, BP_Z1 - r, z) * smoothstep(BP_Z0, BP_Z0 + r, z);
  w *= 0.72 + 0.28 * k;
  return Math.max(0.004, smin(w, C_AX.at(z) - 0.0055, 0.010));
}

/* 0 on the panel's rim, 1 once clear of it -- the edge tucks onto the body */
export function bpRoll(a: number, z: number): number {
  const w = bpWidth(z);
  const d = smin(smin(z - BP_Z0, BP_Z1 - z, 0.005), w * (1.0 - Math.abs(a)), 0.005);
  return smoothstep(0.0, 0.0140, d);
}

export const BP_SEAT = 0.0011, BP_LIFT = 0.0062, BP_SKIN = 0.0028, BP_BACK = 0.0135;

export const bpBase = () => coreBackSurf(0.0);

/* outer face of the back piece.  a in [-1,1] across the panel. */
export function backPieceSurf(a: number, z: number, extra = 0.0): [V3, V3] {
  const x = a * bpWidth(z);
  const [p, n] = bpBase()(x, z);
  const b = bpRoll(a, z);
  const off = BP_SEAT + (BP_LIFT + BP_SKIN) * b + backpieceDisp(x, z) * b;
  return [p.add(n.mul(off + extra)), n];
}

export function buildBackPiece() {
  bpCurves();
  const objs: Mesh[] = [];
  const base = bpBase();
  const NZ = 236, NX = 168;
  const zs: number[] = [], ax: number[] = [];
  for (let i = 0; i <= NZ; i++) zs.push(BP_Z0 + (BP_Z1 - BP_Z0) * (i / NZ));
  for (let j = 0; j <= NX; j++) ax.push(-1.0 + 2.0 * (j / NX));
  const N = NX + 1;
  const vf: Vec3[] = [], vb: Vec3[] = [];
  for (const z of zs) {
    const w = bpWidth(z);
    for (const a of ax) {
      const x = a * w;
      const [p, n] = base(x, z);
      const b = bpRoll(a, z);
      const d = backpieceDisp(x, z);
      vf.push(p.add(n.mul(BP_SEAT + (BP_LIFT + BP_SKIN) * b + d * b)).toArray());
      vb.push(p.add(n.mul(BP_SEAT - BP_BACK * b)).toArray());
    }
  }

  /* The two sheets meet exactly on the rim (the roll-off is 0 there).  They
     SHARE those vertices by index rather than being welded together after the
     fact -- relying on a weld left stray non-manifold edges up at the narrow
     top of the panel, where neighbouring columns sit a fraction of a
     millimetre apart. */
  const verts = vf.slice();
  const mapb = new Array(vb.length).fill(0);
  for (let i = 0; i <= NZ; i++) {
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      if (i === 0 || i === NZ || j === 0 || j === NX) mapb[k] = k;
      else { mapb[k] = verts.length; verts.push(vb[k]); }
    }
  }
  const faces: number[][] = [];
  for (let i = 0; i < NZ; i++) {
    for (let j = 0; j < NX; j++) {
      const a0 = i * N + j, b0 = (i + 1) * N + j;
      faces.push([a0, a0 + 1, b0 + 1, b0]);
      faces.push([mapb[a0], mapb[b0], mapb[b0 + 1], mapb[a0 + 1]]);
    }
  }
  const ob = meshObj('back_piece', verts, faces, 'TORSO');
  /* deliberately NOT welded: the rim is already shared by index, and at the
     corners the two sheets close to within float32 precision, so even a
     zero-distance merge collapsed those quads and holed the shell.
     The grid is wound with the outer sheet facing -Y; Blender's shading
     flips a back-facing normal for the viewer, three.js culls it instead, so
     the winding (not the geometry) is made outward-facing here. */
  recalcFaceNormals(ob);
  shade(ob, true, 34);
  addBevel(ob, 0.0007, 2, 34);
  setmat(ob, 'M_DARKMECH');
  markRecessFloor(ob);
  objs.push(ob);

  const psurf = (x: number, z: number): [V3, V3] => backPieceSurf(x / Math.max(1e-6, bpWidth(z)), z);

  const fast: Mesh[] = [];
  const seats = [[0.0930, 1.1310], [0.0930, 1.0570],                 /* recess frame */
                 [0.0330, 1.3430], [0.0424, 1.2960], [0.0500, 1.2560],
                 [0.0630, 1.2060], [0.0900, 1.1730], [0.1160, 1.1180],
                 [0.1150, 1.0430]];                                  /* shield flanks */
  seats.forEach(([x, z], k) => {
    for (const s of [-1, 1]) {
      const [p, n] = psurf(s * x, z);
      const st = [{ t: 0.0, ax: 0.0025, by: 0.0025, e: 2.2 },
                  { t: 0.0020, ax: 0.0020, by: 0.0020, e: 2.2 }];
      const bo = loft(st, { n: 14, rings: 4, name: `bpf${k}${s > 0 ? 'p' : 'm'}`,
                            cname: 'TORSO', cap0: false, cap1: true, tip1: 0.0008 });
      const m = quatToMat4(toTrackQuatZY(n));
      const tr = p.sub(n.mul(0.0006));            /* seated into the surface */
      m[3] = tr.x; m[7] = tr.y; m[11] = tr.z;
      bo.transform(m);
      fast.push(bo);
    }
  });
  for (const bo of fast) {
    finish(bo, { bevel: 0.0003, bseg: 1, bangle: 40 });
    setmat(bo, 'M_ALU');
  }
  return objs.concat(fast);
}

/* the floor of the recess reads as a lighter inset panel -- done with a
   material slot rather than a separate plate, so the back stays one piece */
export function markRecessFloor(ob: Mesh): Mesh {
  const [hw, hh, r, cz, , ch] = RECESS;
  const idx = ob.mats.length;
  ob.mats.push('M_DARKGREY');
  for (let fi = 0; fi < ob.f.length; fi++) {
    const c = ob.faceCentre(fi);
    if (c[1] < 0.10 || Math.abs(c[2] - cz) > hh || Math.abs(c[0]) > hw) continue;
    const dx = Math.max(0.0, Math.abs(c[0]) - (hw - r));
    const dz = Math.max(0.0, Math.abs(c[2] - cz) - (hh - r));
    if (Math.hypot(dx, dz) - r < -ch * 0.92) ob.fm[fi] = idx;
  }
  return ob;
}

export function buildTorsoCore() {
  coreCurves();
  const st = CORE.map(c => ({ t: c[0], ax: c[1], by: c[2], by2: c[3], e: c[4], e_dn: c[5] }));
  const ob = loft(st, { n: 96, rings: 220, name: 'torso_core', cname: 'TORSO',
                        cap0: true, cap1: false, tip0: 0.0135, mode: 'spline', even: 0.62 });
  finish(ob, { bevel: 0.0010, bseg: 2, bangle: 40 });
  setmat(ob, 'M_BLACK');
  return ob;
}

export const CHEST_EDGE = [
  [1.4415, 0.0975], [1.4370, 0.1120], [1.4310, 0.1240], [1.4230, 0.1292],
  [1.4120, 0.1318], [1.3980, 0.1344], [1.3800, 0.1378], [1.3600, 0.1424],
  [1.3400, 0.1490], [1.3150, 0.1514], [1.2900, 0.1478], [1.2650, 0.1436],
  [1.2400, 0.1404], [1.2150, 0.1374], [1.1900, 0.1348], [1.1650, 0.1326],
  [1.1400, 0.1306], [1.1180, 0.1288], [1.1060, 0.1262], [1.1005, 0.1222],
  [1.0975, 0.1156],
];
export const CHEST_Z0 = 1.0975, CHEST_Z1 = 1.4415, PLATE_LIFT = 0.0068;

export const chestEdgeCurve = () => new Curve1D(CHEST_EDGE.map(p => p[0]), CHEST_EDGE.map(p => p[1]), 'spline');

export function plateDisp(u: number, v: number): number {
  let d = 0.0;
  for (const s of [-1.0, 1.0])
    d += 0.0058 * Math.exp(-Math.pow((u - s * 0.0730) / 0.0620, 2)
                           - Math.pow((v - 1.3320) / 0.0760, 2));
  d -= 0.0026 * Math.exp(-Math.pow(u / 0.0330, 2) - Math.pow((v - 1.3480) / 0.0700, 2));
  d += 0.0014 * Math.exp(-Math.pow(u / 0.0300, 2)) * smoothstep(1.330, 1.180, v);
  d -= 0.0026 * smoothstep(1.235, 1.120, v);
  d -= 0.0014 * smoothstep(1.360, 1.430, v);
  return d;
}

export function plateSurf(extra = 0.0): Surface {
  const base = coreFrontSurf(0.0);
  const xe = chestEdgeCurve();
  return (u: number, v: number): [V3, V3] => {
    const [p, n] = base(u, v);
    const r = Math.min(1.0, Math.abs(u) / Math.max(1e-5, xe.at(v)));
    const lift = PLATE_LIFT * (0.34 + 0.66 * (1.0 - Math.pow(r, 2.6)));
    const d = Math.max(0.0024, lift + plateDisp(u, v));
    return [p.add(n.mul(d + extra)), n];
  };
}

export function buildChestPlate() {
  const xe = chestEdgeCurve();
  const surf = plateSurf();
  const z0 = CHEST_Z0, z1 = CHEST_Z1;
  const pts: Vec2[] = [];
  const N = 66;
  for (let i = 0; i <= N; i++) { const v = z1 - (z1 - z0) * (i / N); pts.push([xe.at(v), v]); }
  const b = xe.at(z0);
  for (let i = 1; i < 15; i++) {
    const f = i / 15.0;
    pts.push([b * Math.cos(Math.PI * f), z0 - 0.0022 * Math.pow(Math.sin(Math.PI * f), 0.7)]);
  }
  for (let i = 0; i <= N; i++) { const v = z0 + (z1 - z0) * (i / N); pts.push([-xe.at(v), v]); }
  const t = xe.at(z1);
  for (let i = 1; i < 13; i++) {
    const f = i / 13.0;
    pts.push([-t * Math.cos(Math.PI * f), z1 + 0.0016 * Math.pow(Math.sin(Math.PI * f), 0.7)]);
  }
  const outline = polyOutline(pts, 240, 1);
  const ob = pillow(outline, surf, {
    t_front: 0.0040, t_back: 0.0250, layers: 20, name: 'chest_plate',
    cname: 'TORSO', rim: 0.145, centre: [0.0, 1.278]
  });
  finish(ob, { bevel: 0.0008, bseg: 2, bangle: 32 });
  setmat(ob, 'M_SHELL');
  return ob;
}

export function buildStrap(side = 1) {
  const xe = chestEdgeCurve();
  const z1 = 1.4510, z0 = 1.3380;
  const d = 3e-4;
  const st = [];
  const NR = 52;
  for (let i = 0; i <= NR; i++) {
    const z = z1 - (z1 - z0) * (i / NR);
    const t = (z - z0) / (z1 - z0);
    let w = 0.0180 * Math.pow(t, 0.38);
    w *= 1.0 - 0.52 * smoothstep(0.88, 1.0, t);
    const thick = 0.0052 * (0.32 + 0.68 * Math.pow(t, 0.32));
    const xin = xe.at(z) + 0.0016;
    const xout = Math.min(C_AX.at(z) - 0.0024, xin + 2 * w);
    const xc = 0.5 * (xin + xout);
    w = Math.max(0.0008, 0.5 * (xout - xin));
    const fx = (coreFrontY(xc + d, z) - coreFrontY(xc - d, z)) / (2 * d);
    const L = Math.hypot(1.0, fx);
    const nx = fx / L, ny = -1.0 / L;
    const yc = coreFrontY(xc, z);
    const lift = 0.0034;
    st.push({ t: z, ax: w * L, by: thick,
              ox: side * (xc + nx * lift), oy: yc + ny * lift,
              rot: side * Math.atan(fx), e: 2.6 });
  }
  const ob = loft(st, { n: 30, rings: 110, name: `strap_${side > 0 ? 'L' : 'R'}`,
                        cname: 'TORSO', cap0: true, cap1: true,
                        tip0: 0.0028, tip1: 0.0045, mode: 'spline', even: 0.75 });
  finish(ob, { bevel: 0.0005, bseg: 2, bangle: 34 });
  setmat(ob, 'M_BLACK');
  return ob;
}

/* ---- TESLA wordmark ----------------------------------------------------- */

export function letterQuads(ch: string, w: number, h: number, b: number): Vec2[][] {
  const cx = w * 0.5;
  if (ch === 'T') return [
    [[0, h], [w, h], [w, h - b], [0, h - b]],
    [[cx - b / 2, h - b], [cx + b / 2, h - b], [cx + b / 2, 0], [cx - b / 2, 0]]];
  if (ch === 'E') return [
    [[0, h], [w, h], [w, h - b], [0, h - b]],
    [[0, h / 2 + b / 2], [w * 0.86, h / 2 + b / 2], [w * 0.86, h / 2 - b / 2], [0, h / 2 - b / 2]],
    [[0, b], [w, b], [w, 0], [0, 0]]];
  if (ch === 'S') return [
    [[0, h], [w, h], [w, h - b], [0, h - b]],
    [[0, h - b], [b, h - b], [b, h / 2 + b / 2], [0, h / 2 + b / 2]],
    [[0, h / 2 + b / 2], [w, h / 2 + b / 2], [w, h / 2 - b / 2], [0, h / 2 - b / 2]],
    [[w - b, h / 2 - b / 2], [w, h / 2 - b / 2], [w, b], [w - b, b]],
    [[0, b], [w, b], [w, 0], [0, 0]]];
  if (ch === 'L') return [
    [[0, h], [b, h], [b, 0], [0, 0]],
    [[b, b], [w, b], [w, 0], [b, 0]]];
  if (ch === 'A') {
    const f = w * 0.30;
    return [
      [[0, 0], [b, 0], [cx - f / 2 + b, h], [cx - f / 2, h]],
      [[w - b, 0], [w, 0], [cx + f / 2, h], [cx + f / 2 - b, h]],
      [[cx - f / 2, h], [cx + f / 2, h], [cx + f / 2 - b * 0.55, h - b], [cx - f / 2 + b * 0.55, h - b]]];
  }
  return [];
}

export function buildWordmark(z = 1.3555, height = 0.0150, track = 0.0180, depth = 0.0011) {
  const surf = plateSurf(0.0040);
  const text = 'TESLA';
  const lw: Record<string, number> = { T: 0.0132, E: 0.0113, S: 0.0115, L: 0.0104, A: 0.0136 };
  const b = 0.00235;
  const total = [...text].reduce((s, c) => s + lw[c], 0) + track * (text.length - 1);
  let x0 = -total / 2.0;
  const parts: Mesh[] = [];
  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    const w = lw[ch];
    const polys = letterQuads(ch, w, height, b);
    for (let pi = 0; pi < polys.length; pi++) {
      const poly = polys[pi];
      const n = poly.length;
      const verts: Vec3[] = [];
      for (const lift of [0.0, depth]) {
        for (const [px, pz] of poly) {
          const ux = x0 + px;
          const uz = z + pz - height / 2.0;
          const [p, nn] = surf(ux, uz);
          verts.push(p.add(nn.mul(lift + 0.0003)).toArray());
        }
      }
      const faces = [];
      for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; faces.push([j, j2, n + j2, n + j]); }
      const top = []; for (let i = n; i < 2 * n; i++) top.push(i); faces.push(top);
      const bot = []; for (let i = n - 1; i >= 0; i--) bot.push(i); faces.push(bot);
      parts.push(meshObj(`wm_${ci}_${pi}`, verts, faces, 'TORSO'));
    }
    x0 += w + track;
  }
  const ob = joinMeshes(parts, 'wordmark', 'TORSO');
  weld(ob, 1e-5);
  shade(ob, false);
  setmat(ob, 'M_LOGO');
  return ob;
}

export function buildTorso() {
  collClear('TORSO');
  coreCurves();
  buildTorsoCore();
  buildChestPlate();
  buildBackPanel();
  buildBackPiece();
  buildStrap(1);
  buildStrap(-1);
  buildWordmark();
}

