/**
 * Blender `mathutils` transform helpers: 4x4 matrices (row-major, applied as
 * `p' = M p`), `quat_to_mat3`, `mul_qt_qtqt` and `Vector.to_track_quat`.
 */
import type { V3, Vec3 } from './mathkit'

/** Row-major 4x4, 16 entries. */
export type Mat4 = number[]
/** `[w, x, y, z]` — Blender's quaternion order. */
export type Quat = [number, number, number, number]

/* ---- Blender mathutils.Vector.to_track_quat + Euler.to_matrix ----------- */

/* 4x4, row-major, applied as p' = M p */
export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      o[i * 4 + j] = s;
    }
  return o;
}
export function mat4Apply(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [m[0] * x + m[1] * y + m[2] * z + m[3],
          m[4] * x + m[5] * y + m[6] * z + m[7],
          m[8] * x + m[9] * y + m[10] * z + m[11]];
}
export function mat4Translation(t: Vec3 | number[]): Mat4 {
  const m = mat4Identity();
  m[3] = t[0]; m[7] = t[1]; m[11] = t[2];
  return m;
}
export function mat4Scale(s: Vec3 | number[]): Mat4 {
  const m = mat4Identity();
  m[0] = s[0]; m[5] = s[1]; m[10] = s[2];
  return m;
}
/* Blender eul_to_mat3 for order XYZ  ->  M = Rz * Ry * Rx */
export function mat4FromEulerXYZ(e: Vec3 | number[]): Mat4 {
  const ci = Math.cos(e[0]), cj = Math.cos(e[1]), ch = Math.cos(e[2]);
  const si = Math.sin(e[0]), sj = Math.sin(e[1]), sh = Math.sin(e[2]);
  const cc = ci * ch, cs = ci * sh, sc = si * ch, ss = si * sh;
  return [cj * ch, sj * sc - cs, sj * cc + ss, 0,
          cj * sh, sj * ss + cc, sj * cs - sc, 0,
          -sj,     cj * si,      cj * ci,      0,
          0,       0,            0,            1];
}
/* Matrix.Rotation(angle, 4, axis) */
export function mat4Rotation(angle: number, axis: 'X' | 'Y' | 'Z'): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 'X') return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === 'Y') return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
export function quatToMat4(q: Quat): Mat4 {
  const [w, x, y, z] = q;
  const q0 = Math.SQRT2 * w, q1 = Math.SQRT2 * x;
  const q2 = Math.SQRT2 * y, q3 = Math.SQRT2 * z;
  const qda = q0 * q1, qdb = q0 * q2, qdc = q0 * q3;
  const qaa = q1 * q1, qab = q1 * q2, qac = q1 * q3;
  const qbb = q2 * q2, qbc = q2 * q3, qcc = q3 * q3;
  /* Blender quat_to_mat3 writes m[0], m[1], m[2] as the three COLUMNS */
  const c0 = [1.0 - qbb - qcc, qdc + qab, qac - qdb];
  const c1 = [qab - qdc, 1.0 - qaa - qcc, qda + qbc];
  const c2 = [qac + qdb, qbc - qda, 1.0 - qaa - qbb];
  return [c0[0], c1[0], c2[0], 0,
          c0[1], c1[1], c2[1], 0,
          c0[2], c1[2], c2[2], 0,
          0, 0, 0, 1];
}
export function quatMul(q1: Quat, q2: Quat): Quat {                    /* Blender mul_qt_qtqt */
  const t0 = q1[0] * q2[0] - q1[1] * q2[1] - q1[2] * q2[2] - q1[3] * q2[3];
  const t1 = q1[0] * q2[1] + q1[1] * q2[0] + q1[2] * q2[3] - q1[3] * q2[2];
  const t2 = q1[0] * q2[2] + q1[2] * q2[0] + q1[3] * q2[1] - q1[1] * q2[3];
  const t3 = q1[0] * q2[3] + q1[3] * q2[0] + q1[1] * q2[2] - q1[2] * q2[1];
  return [t0, t1, t2, t3];
}
/* Vector.to_track_quat('Z', 'Y') -- Blender vec_to_quat(axis=2, upflag=1) */
export function toTrackQuatZY(v: V3): Quat {
  const eps = 1e-4;
  let q: Quat = [1, 0, 0, 0];
  const len = v.length;
  if (len === 0) return q;
  const tvec = [v.x, v.y, v.z];                     /* axis 'Z' is index 5 > 2 */
  const nor = [-tvec[1], tvec[0], 0.0];
  if (Math.abs(tvec[0]) + Math.abs(tvec[1]) < eps) nor[0] = 1.0;
  const co = tvec[2] / len;
  const nl = Math.hypot(nor[0], nor[1], nor[2]);
  if (nl > 0) { nor[0] /= nl; nor[1] /= nl; nor[2] /= nl; }
  const ang = Math.acos(Math.max(-1, Math.min(1, co)));
  const si = Math.sin(ang / 2);
  q = [Math.cos(ang / 2), nor[0] * si, nor[1] * si, nor[2] * si];
  /* axis (2) != upflag (1) -> roll correction */
  const m = quatToMat4(q);
  const fp = [m[2], m[6], m[10]];                   /* third column of the 3x3 */
  const angle = -0.5 * Math.atan2(-fp[0], -fp[1]);
  const co2 = Math.cos(angle), si2 = Math.sin(angle) / len;
  const q2: Quat = [co2, tvec[0] * si2, tvec[1] * si2, tvec[2] * si2];
  return quatMul(q2, q);
}
