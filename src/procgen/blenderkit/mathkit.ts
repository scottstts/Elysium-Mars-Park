/**
 * Blender-port maths primitives (see procgen/blenderkit/README in dev_docs).
 * Verbatim port of the reference build's section 1; every number and every
 * branch is the one the Blender/bpy source evaluates.
 */

/** `[x, y]` pair used for 2-D outlines and cross-sections. */
export type Vec2 = [number, number]
/** `[x, y, z]` triple — the mesh container's vertex format. */
export type Vec3 = [number, number, number]

/**
 * A module slot a ported part fills in before first use (`coreCurves()`,
 * `headCurves()`, …). Blender builds declare their fitted curves at module
 * scope and populate them from a `*Curves()` entry point, so the declaration
 * has nothing to infer from; this keeps that order without leaking `null`
 * through every call site the way the source's `= None` does.
 */
export function lateInit<T>(): T {
  return null as unknown as T
}

/* ==========================================================================
   1. maths -- ports of optlib.Curve1D, numpy.polyfit and mathutils.Vector
   ========================================================================== */

export const TAU = Math.PI * 2;
export const R = (d: number): number => (d * Math.PI) / 180;

/* python's % (result takes the sign of the divisor) */
export const pmod = (a: number, b: number): number => ((a % b) + b) % b;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(a: number, b: number, x: number): number {
  if (b === a) return 0.0;
  const t = Math.max(0.0, Math.min(1.0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ---- minimal mathutils.Vector stand-in ---------------------------------- */
export class V3 {
  x: number
  y: number
  z: number
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static of(a: Vec3 | number[]): V3 { return new V3(a[0], a[1], a[2]); }
  clone(): V3 { return new V3(this.x, this.y, this.z); }
  add(o: V3): V3 { return new V3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o: V3): V3 { return new V3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(s: number): V3 { return new V3(this.x * s, this.y * s, this.z * s); }
  dot(o: V3): number { return this.x * o.x + this.y * o.y + this.z * o.z; }
  cross(o: V3): V3 {
    return new V3(this.y * o.z - this.z * o.y,
                  this.z * o.x - this.x * o.z,
                  this.x * o.y - this.y * o.x);
  }
  get length(): number { return Math.hypot(this.x, this.y, this.z); }
  normalized(): V3 {
    const l = this.length;
    return l > 0 ? new V3(this.x / l, this.y / l, this.z / l) : new V3(0, 0, 0);
  }
  /* mathutils normalises in place and leaves a zero vector alone */
  normalize(): V3 {
    const l = this.length;
    if (l > 0) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }
  toArray(): Vec3 { return [this.x, this.y, this.z]; }
}
export const vec = (x: number, y: number, z: number): V3 => new V3(x, y, z);
