/**
 * Blender's OWN noise in TSL: lookup3 hash, quintic fade, the same gradient
 * table, x0.9820 signed scaling and the same fBm octave accumulation, so
 * `scale` / `detail` / `roughness` behave exactly as they do in a .blend.
 * `ShaderNodeTexNoise` -> `bnoise`, `ShaderNodeMapRange` -> `roughVar`,
 * `ShaderNodeBump` -> `noiseBump`.
 *
 * The one deviation from Blender is that the integer lattice is offset by
 * +8192 before hashing, because WGSL leaves a negative i32 -> u32 conversion
 * indeterminate; that translates the noise field but changes nothing about
 * its statistics.
 */
import {
  Fn, bumpMap, clamp, dFdx, dFdy, float, floor, length, max, mix, positionLocal,
  select, smoothstep as tslSmoothstep, uint,
} from 'three/tsl'
import type { MeshPhysicalNodeMaterial, Node } from 'three/webgpu'

export const LATTICE_OFF = 8192.0;

export const rotl32 = (x: Node<'uint'>, k: number): Node<'uint'> => x.shiftLeft(uint(k)).bitOr(x.shiftRight(uint(32 - k)));

/* Jenkins lookup3 final() -- Blender BLI_hash_int_3d */
export const bhash3 = /*#__PURE__*/ Fn(([kx, ky, kz]: [Node<'uint'>, Node<'uint'>, Node<'uint'>]) => {
  const seed = uint(3735928584);            /* 0xdeadbeef + (3 << 2) + 13 */
  const a = seed.toVar(), b = seed.toVar(), c = seed.toVar();
  c.addAssign(kz); b.addAssign(ky); a.addAssign(kx);
  c.assign(c.bitXor(b)); c.subAssign(rotl32(b, 14));
  a.assign(a.bitXor(c)); a.subAssign(rotl32(c, 11));
  b.assign(b.bitXor(a)); b.subAssign(rotl32(a, 25));
  c.assign(c.bitXor(b)); c.subAssign(rotl32(b, 16));
  a.assign(a.bitXor(c)); a.subAssign(rotl32(c, 4));
  b.assign(b.bitXor(a)); b.subAssign(rotl32(a, 14));
  c.assign(c.bitXor(b)); c.subAssign(rotl32(b, 24));
  return c;
}).setLayout({
  name: 'bhash3', type: 'uint',
  inputs: [{ name: 'kx', type: 'uint' }, { name: 'ky', type: 'uint' }, { name: 'kz', type: 'uint' }]
});

/* Blender noise_grad */
export const bgrad = /*#__PURE__*/ Fn(([h32, x, y, z]: [Node<'uint'>, Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const h = h32.bitAnd(uint(15)).toVar();
  const u = select(h.lessThan(uint(8)), x, y);
  const vt = select(h.equal(uint(12)).or(h.equal(uint(14))), x, z);
  const v = select(h.lessThan(uint(4)), y, vt);
  const su = select(h.bitAnd(uint(1)).notEqual(uint(0)), u.negate(), u);
  const sv = select(h.bitAnd(uint(2)).notEqual(uint(0)), v.negate(), v);
  return su.add(sv);
}).setLayout({
  name: 'bgrad', type: 'float',
  inputs: [{ name: 'h32', type: 'uint' }, { name: 'x', type: 'float' },
           { name: 'y', type: 'float' }, { name: 'z', type: 'float' }]
});

export const bfade = (t: Node<'float'>): Node<'float'> => t.mul(t).mul(t).mul(t.mul(t.mul(6.0).sub(15.0)).add(10.0));

/* Blender perlin_signed: [-1, 1] */
export const bperlin = /*#__PURE__*/ Fn(([p]: [Node<'vec3'>]) => {
  const X = floor(p.x).toVar(), Y = floor(p.y).toVar(), Z = floor(p.z).toVar();
  const fx = p.x.sub(X).toVar(), fy = p.y.sub(Y).toVar(), fz = p.z.sub(Z).toVar();
  const xi = uint(X.add(LATTICE_OFF)).toVar();
  const yi = uint(Y.add(LATTICE_OFF)).toVar();
  const zi = uint(Z.add(LATTICE_OFF)).toVar();
  const x1 = xi.add(uint(1)), y1 = yi.add(uint(1)), z1 = zi.add(uint(1));
  const u = bfade(fx), v = bfade(fy), w = bfade(fz);
  const fx1 = fx.sub(1.0), fy1 = fy.sub(1.0), fz1 = fz.sub(1.0);

  const g000 = bgrad(bhash3(xi, yi, zi), fx, fy, fz);
  const g100 = bgrad(bhash3(x1, yi, zi), fx1, fy, fz);
  const g010 = bgrad(bhash3(xi, y1, zi), fx, fy1, fz);
  const g110 = bgrad(bhash3(x1, y1, zi), fx1, fy1, fz);
  const g001 = bgrad(bhash3(xi, yi, z1), fx, fy, fz1);
  const g101 = bgrad(bhash3(x1, yi, z1), fx1, fy, fz1);
  const g011 = bgrad(bhash3(xi, y1, z1), fx, fy1, fz1);
  const g111 = bgrad(bhash3(x1, y1, z1), fx1, fy1, fz1);

  const x00 = mix(g000, g100, u), x10 = mix(g010, g110, u);
  const x01 = mix(g001, g101, u), x11 = mix(g011, g111, u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w).mul(0.9820);
}).setLayout({
  name: 'bperlin', type: 'float', inputs: [{ name: 'p', type: 'vec3' }]
});

/* ShaderNodeTexNoise (fBM, normalize on) -> [0, 1].  `detail` is a literal in
   every material here, so the octave loop is unrolled on the JS side.

   Each octave is faded out once its period drops below about two pixels.
   Blender resolves these frequencies by averaging 48 TAA samples per pixel;
   a single-sample real-time pass cannot, and an unfiltered detail-8 noise at
   scale 900 aliases into large drifting blotches under the bump node's
   screen-space derivatives.  Dropping the octaves that are past Nyquist
   converges on the same filtered surface Blender's supersampling produces. */
export const pixelFootprint = (p: Node<'vec3'>): Node<'float'> => max(length(dFdx(p)), length(dFdy(p)));

export function bnoise(p: Node<'vec3'>, scale: number, detail: number, roughness = 0.5, lacunarity = 2.0): Node<'float'> {
  const q = p.mul(scale);
  const fw = pixelFootprint(p).toVar();
  let fscale = 1.0, amp = 1.0, maxamp = 0.0;
  let sum: Node<'float'> | null = null;
  const n = Math.floor(detail);
  for (let i = 0; i <= n; i++) {
    const band = tslSmoothstep(0.25, 0.5, fw.mul(scale * fscale)).oneMinus();
    const t = bperlin(q.mul(fscale)).mul(amp).mul(band);
    sum = sum === null ? t : sum.add(t);
    maxamp += amp;
    amp *= roughness;
    fscale *= lacunarity;
  }
  return sum!.mul(0.5 / maxamp).add(0.5);
}

/* setup.rough_var -- MapRange(noise, 0.25..0.75 -> base-amt..base+amt) */
export function roughVar(base: number, amt: number, scale: number, detail = 3.0): Node<'float'> {
  const nz = bnoise(positionLocal, scale, detail, 0.5);
  const t = nz.sub(0.25).div(0.5);
  const lo = base - amt, hi = base + amt;
  return clamp(float(lo).add(t.mul(hi - lo)), Math.min(lo, hi), Math.max(lo, hi));
}

/* setup.noise_bump -- Bump(Strength, Distance=0.0006) over object-space noise */
export function noiseBump(scale: number, detail: number, strength: number, roughness = 0.55): MeshPhysicalNodeMaterial['normalNode'] {
  const h = bnoise(positionLocal, scale, detail, roughness);
  return bumpMap(h, float(strength * 0.0006));
}
