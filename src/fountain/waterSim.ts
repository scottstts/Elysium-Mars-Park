import { HalfFloatType, LinearFilter, Vector4 } from 'three'
import { StorageTexture } from 'three/webgpu'
import type { ComputeNode, Node, WebGPURenderer } from 'three/webgpu'
import {
  Fn,
  If,
  exp,
  float,
  instanceIndex,
  int,
  ivec2,
  max,
  min,
  sin,
  texture,
  textureLoad,
  textureStore,
  uint,
  uniformArray,
  vec2,
  vec4,
} from 'three/tsl'
import { SUN_ELEVATION_DEG } from '../sky/sun'
import {
  BASIN_FLOOR_CENTER_Y,
  BASIN_FLOOR_RIM_Y,
  BASIN_INNER_R,
  MARS_G,
  PLINTH_STEPS,
  WATER_Y,
} from './fountainPlan'
import { CAUSTIC_CHOP, dispersion, fountainTime } from './waterField'

/**
 * THE BASIN SIMULATION — the water's meso-scale motion, computed, not authored.
 *
 * A bounded heightfield fluid simulation over the basin annulus: the damped
 * wave equation on a 512² grid, forced by IMPACT EVENTS sampled from the same
 * ballistic parcels the droplet system flies, reflecting off the same two
 * walls the ray-traced volume intersects. The rings you see radiate from
 * where water actually landed this second, interfere where they cross, and
 * come back off the coping — none of which a sum of steady authored trains
 * (the previous implementation) can do, because a steady train has no memory.
 *
 * ## What is physical here, and what is approximated
 *
 * - The propagation speed is the DEEP-WATER phase speed of the dominant ring
 *   wavelength at MARS gravity: c = √(g·λ/2π) ≈ 0.5 m/s for λ ≈ 0.42 m
 *   (kh ≈ 6 in a 0.3 m basin — comfortably deep-water, so √(g·h) shallow
 *   speed would be wrong here). The discrete wave equation is non-dispersive
 *   — every wavelength travels at c — which is THE approximation of this
 *   scheme; the capillary bands, whose dispersion actually matters visually,
 *   stay analytic in `waterField.ts` where their exact ω(k) is free.
 * - An impact deposits a VOLUME-NEUTRAL crater: w(q) = (1 − 2q²)·e^(−2q²),
 *   whose radial integral is exactly zero — a cavity with a raised rim, which
 *   is what a droplet strike is. Neutrality is not cosmetic: the wave update
 *   cannot damp a DC offset (a uniform field has zero Laplacian), so a biased
 *   deposit would ratchet the pool level forever.
 * - Boundaries are Neumann (solid neighbours mirror the centre height), so
 *   waves reflect off the coping and the island with an antinode at the wall
 *   — the slosh a real basin shows against its rim.
 * - Foam is a scalar carried in the same texture: injected by impacts,
 *   diffusing into neighbours, decaying on a 3 s life. It ends up exactly
 *   where the plumbing delivers water, including everywhere the jets' aim
 *   wander drags their landing rings.
 *
 * ## The derive pass, and why caustics are computed HERE
 *
 * A second kernel turns the raw field into what the surface shader actually
 * consumes: the gradient (for normals and refraction) and the differential-
 * area caustic gain 1/|det(I + βH)| with H the field's Hessian — the sim's
 * by finite differences PLUS the analytic capillary bands', evaluated in
 * closed form at the same instant, so the fine filaments ride the simulated
 * web. Moving this off the water fragment (which runs at output resolution
 * over 150 m² of pool) onto 0.26 M texels is a net WIN, and the texture's
 * bilinear filter is itself the anti-aliasing the caustic web needs.
 *
 * ## Clocking
 *
 * The sim advances one kernel dispatch per FIXED park step (the same clock
 * `fountainTime` follows), so it freezes with the pause card and stays in
 * lockstep with the analytic bands and the droplets. CFL: c·dt/dx ≈ 0.29,
 * comfortably inside the scheme's stability bound of 1.
 */

const RES = 512
const BITS = 9
/** World metres the square texture spans; centred on the fountain axis. */
export const SIM_SIZE = 14.6
const DX = SIM_SIZE / RES
/** The park's fixed simulation step (loop.ts runs systems at 60 Hz). */
const DT = 1 / 60

/** Deep-water phase speed of the dominant λ ≈ 0.42 m ring at Mars gravity. */
const WAVE_C = Math.sqrt((MARS_G * 0.42) / (Math.PI * 2))
const KAPPA = (WAVE_C * DT) / DX < 1 ? ((WAVE_C * DT) / DX) ** 2 : 0.9
/** Bulk energy decay, e-folding ~9 s — young rings cross the basin, old die. */
const DAMP = Math.exp(-DT / 9)
/** DC relaxation: volume errors bleed out over 2 min; real waves barely feel it. */
const SETTLE = 1 - DT / 120

const FOAM_TAU = 3.2
const FOAM_DIFFUSE = 1 - Math.exp(-DT * 1.6)
const FOAM_BLEED = DT * 0.012

const MAX_DROPS = 20

/** The two walls the fluid lives between (the ray-traced volume's own radii). */
const ISLAND_R = PLINTH_STEPS[0].radius
const RIM_R = BASIN_INNER_R

/** Refracted-sun constant for the caustic β (see waterSurface for the optics). */
const ETA = 1 / 1.333
const SUN_COS_T = Math.cos(Math.asin(Math.sin(((90 - SUN_ELEVATION_DEG) * Math.PI) / 180) * ETA))
const BETA_K = (1 - ETA) / SUN_COS_T

export class FountainWaterSim {
  /** (h, v, foam, –) — repointed to the freshly written map after each step. */
  readonly stateNode: ReturnType<typeof texture>
  /** (∂h/∂x, ∂h/∂z, caustic gain, foam) — written by the derive pass. */
  readonly derivNode: ReturnType<typeof texture>

  private readonly maps: [StorageTexture, StorageTexture]
  private readonly derived: StorageTexture
  /** (x, z, radius, amplitude) per drop, plan-local metres; amp 0 = empty slot. */
  private readonly drops = uniformArray(
    Array.from({ length: MAX_DROPS }, () => new Vector4(0, 0, 1, 0)),
  )
  private readonly steps: [ComputeNode, ComputeNode]
  private readonly derives: [ComputeNode, ComputeNode]
  private readonly clears: [ComputeNode, ComputeNode]
  private pendingCount = 0
  private current = 0
  private initialized = false

  constructor() {
    const make = () => {
      const map = new StorageTexture(RES, RES)
      map.type = HalfFloatType
      map.minFilter = LinearFilter
      map.magFilter = LinearFilter
      map.generateMipmaps = false
      return map
    }
    this.maps = [make(), make()]
    this.derived = make()
    this.steps = [
      this.buildStep(this.maps[0], this.maps[1]),
      this.buildStep(this.maps[1], this.maps[0]),
    ]
    this.derives = [this.buildDerive(this.maps[0]), this.buildDerive(this.maps[1])]
    this.clears = [this.buildClear(this.maps[0]), this.buildClear(this.maps[1])]
    this.stateNode = texture(this.maps[0])
    this.derivNode = texture(this.derived)
  }

  /**
   * Queue an impact for the next step: a volume-neutral crater of the given
   * rim radius (m) and depth (m, positive = strikes downward) at plan-local
   * (x, z). At most MAX_DROPS are honoured per step — the sampler in
   * `fountainSystem` budgets to exactly that.
   */
  pushDrop(x: number, z: number, radius: number, depth: number): boolean {
    if (this.pendingCount >= MAX_DROPS) return false
    ;(this.drops.array[this.pendingCount] as Vector4).set(x, z, radius, -depth)
    this.pendingCount++
    return true
  }

  /**
   * Advance the field by `stepCount` fixed steps and refresh the derived
   * texture. Queued drops apply on the FIRST step of the batch (they are
   * per-fixed-step events; a multi-step catch-up frame smears nothing).
   */
  update(renderer: WebGPURenderer, stepCount: number): void {
    this.ensureInitialized(renderer)
    if (stepCount <= 0) {
      this.pendingCount = 0
      return
    }
    for (let s = 0; s < stepCount; s++) {
      if (s > 0) this.clearDropSlots()
      renderer.compute(this.steps[this.current])
      this.current = 1 - this.current
      this.stateNode.value = this.maps[this.current]
    }
    this.clearDropSlots()
    renderer.compute(this.derives[this.current])
  }

  private clearDropSlots(): void {
    for (let i = 0; i < this.pendingCount; i++) {
      ;(this.drops.array[i] as Vector4).set(0, 0, 1, 0)
    }
    this.pendingCount = 0
  }

  private ensureInitialized(renderer: WebGPURenderer): void {
    if (this.initialized) return
    this.initialized = true
    renderer.compute(this.clears[0])
    renderer.compute(this.clears[1])
  }

  private buildClear(target: StorageTexture): ComputeNode {
    return Fn(() => {
      const x = int(instanceIndex.bitAnd(uint(RES - 1)))
      const y = int(instanceIndex.shiftRight(uint(BITS)))
      textureStore(target, ivec2(x, y), vec4(0))
    })().compute(RES * RES)
  }

  /** Texel centre → plan-local metres (fountain axis at the texture centre). */
  private texelPlane(x: Node<'int'>, y: Node<'int'>) {
    return vec2(
      float(x).add(0.5).mul(DX).sub(SIM_SIZE / 2),
      float(y).add(0.5).mul(DX).sub(SIM_SIZE / 2),
    )
  }

  private buildStep(read: StorageTexture, write: StorageTexture): ComputeNode {
    const drops = this.drops
    return Fn(() => {
      const mask = uint(RES - 1)
      const x = int(instanceIndex.bitAnd(mask))
      const y = int(instanceIndex.shiftRight(uint(BITS)))
      const cell = ivec2(x, y)
      const p = this.texelPlane(x, y).toVar()
      const r = p.length().toVar()

      const c = textureLoad(texture(read), cell).toVar()

      // Neighbour heights with Neumann substitution: a solid neighbour
      // mirrors the centre, which zeroes the gradient into the wall and
      // reflects the wave — the antinode a real rim shows. Border texels
      // clamp, but the fluid annulus never reaches the border anyway.
      const neighbour = (ox: number, oz: number) => {
        const nx = int(uint(x.add(RES + ox)).bitAnd(mask))
        const ny = int(uint(y.add(RES + oz)).bitAnd(mask))
        const sample = textureLoad(texture(read), ivec2(nx, ny))
        const nr = vec2(p.x.add(ox * DX), p.y.add(oz * DX)).length()
        const fluid = nr.greaterThan(ISLAND_R).and(nr.lessThan(RIM_R))
        return { h: fluid.select(sample.r, c.r), foam: fluid.select(sample.b, c.b) }
      }
      const e = neighbour(1, 0)
      const w = neighbour(-1, 0)
      const n = neighbour(0, 1)
      const s = neighbour(0, -1)

      const h = float(0).toVar()
      const v = float(0).toVar()
      const foam = float(0).toVar()

      If(r.greaterThan(ISLAND_R).and(r.lessThan(RIM_R)), () => {
        // ── the wave equation, discrete form: v += κ·∇²h; h += v — plus a
        // small explicit VISCOSITY (h += ν·∇²h). The discrete Laplacian
        // barely damps its own Nyquist mode, so without this the field grows
        // a texel-scale checkerboard sizzle that the specular lobe then
        // faithfully turns into glitter noise. ν this size erases nothing a
        // wave four texels long would miss.
        const lap = e.h.add(w.h).add(n.h).add(s.h).mul(0.25).sub(c.r)
        v.assign(c.g.add(lap.mul(KAPPA)).mul(DAMP))
        h.assign(c.r.mul(SETTLE).add(v).add(lap.mul(0.045)))

        // ── impacts: every queued drop, volume-neutral. Slot amp 0 is inert.
        for (let k = 0; k < MAX_DROPS; k++) {
          const drop = drops.element(int(k)) as unknown as Node<'vec4'>
          const q2 = p.sub(vec2(drop.x, drop.y)).lengthSq().div(drop.z.mul(drop.z))
          const hat = float(1).sub(q2.mul(2)).mul(exp(q2.mul(-2)))
          h.addAssign(hat.mul(drop.w))
          // Foam rides the strike, wider and always positive; max() so
          // overlapping same-step impacts refresh rather than bloom.
          const puff = exp(q2.mul(-1.3)).mul(drop.w.abs().mul(52))
          foam.assign(max(foam, puff))
        }
        // Safety clamp: forcing spikes may not outrun the CFL bound.
        h.assign(h.clamp(-0.06, 0.06))

        // ── foam: diffuse into neighbours, decay, bleed to true zero.
        const around = e.foam.add(w.foam).add(n.foam).add(s.foam).mul(0.25)
        const aged = c.b
          .add(around.sub(c.b).mul(FOAM_DIFFUSE))
          .mul(Math.exp(-DT / FOAM_TAU))
          .sub(FOAM_BLEED)
        foam.assign(max(foam, aged).clamp(0, 1))
      }).Else(() => {
        // Solid texels carry a one-ring dilation of the fluid field so the
        // surface mesh's bilinear taps stay continuous where it overlaps the
        // walls (the mesh runs 60 mm into both, so the shoreline is stone
        // crossing water, not a texture border).
        h.assign(e.h.add(w.h).add(n.h).add(s.h).mul(0.25))
        foam.assign(e.foam.add(w.foam).add(n.foam).add(s.foam).mul(0.25))
      })

      textureStore(write, cell, vec4(h, v, foam, 0))
    })().compute(RES * RES)
  }

  /**
   * Gradient + caustic gain + foam, one texture the surface shader can read
   * with two taps. The Hessian is the sim's finite differences PLUS the
   * analytic capillary bands' closed form, so the caustic web carries both
   * the simulated rings and the fine filaments.
   */
  private buildDerive(read: StorageTexture): ComputeNode {
    return Fn(() => {
      const mask = uint(RES - 1)
      const x = int(instanceIndex.bitAnd(mask))
      const y = int(instanceIndex.shiftRight(uint(BITS)))
      const p = this.texelPlane(x, y).toVar()

      const at = (ox: number, oz: number) => {
        const nx = int(uint(x.add(RES + ox)).bitAnd(mask))
        const ny = int(uint(y.add(RES + oz)).bitAnd(mask))
        return textureLoad(texture(read), ivec2(nx, ny))
      }
      const c = at(0, 0).toVar()
      const e = at(1, 0).r.toVar()
      const w = at(-1, 0).r.toVar()
      const n = at(0, 1).r.toVar()
      const s = at(0, -1).r.toVar()

      const gx = e.sub(w).mul(1 / (2 * DX)).toVar()
      const gz = n.sub(s).mul(1 / (2 * DX)).toVar()

      // ── the Hessian: sim by finite differences…
      const hxx = e.add(w).sub(c.r.mul(2)).mul(1 / (DX * DX)).toVar()
      const hzz = n.add(s).sub(c.r.mul(2)).mul(1 / (DX * DX)).toVar()
      const hxz = at(1, 1)
        .r.sub(at(-1, 1).r)
        .sub(at(1, -1).r)
        .add(at(-1, -1).r)
        .mul(1 / (4 * DX * DX))
        .toVar()

      // …plus the analytic capillary bands, in closed form at the same park
      // time. Their curvature (∝ A·k²) is what draws the fine filaments; the
      // texture's bilinear filter is the anti-aliasing.
      for (const band of CAUSTIC_CHOP) {
        const k = (Math.PI * 2) / band.wavelength
        const omega = dispersion(band.wavelength)
        const [dirX, dirZ] = band.dir
        const phi = p.x.mul(dirX * k).add(p.y.mul(dirZ * k)).sub(fountainTime.mul(omega))
        const second = sin(phi).mul(-(band.amplitude * k * k))
        hxx.addAssign(second.mul(dirX * dirX))
        hzz.addAssign(second.mul(dirZ * dirZ))
        hxz.addAssign(second.mul(dirX * dirZ))
      }

      // β = depth·(1 − 1/n)/cos θ_t with the TRUE local depth: the floor
      // dishes, and the web genuinely tightens over the deeper inner half.
      const r = p.length()
      const t = r.sub(ISLAND_R).div(RIM_R - ISLAND_R).clamp(0, 1)
      const eased = t.mul(t).mul(float(3).sub(t.mul(2)))
      const depth = float(WATER_Y - BASIN_FLOOR_CENTER_Y).sub(
        eased.mul(BASIN_FLOOR_RIM_Y - BASIN_FLOOR_CENTER_Y),
      )
      const beta = depth.mul(BETA_K)

      // Differential-area concentration, 1/|det(I + βH)|. The clamp stands in
      // for the finite width of the solar disc — HALF Earth's on Mars, so the
      // web focuses to 3.4× where a terrestrial pool would blur out at ~2.
      const a = float(1).add(beta.mul(hxx))
      const b = float(1).add(beta.mul(hzz))
      const det = a.mul(b).sub(beta.mul(beta).mul(hxz).mul(hxz))
      const gain = min(float(1).div(max(det.abs(), 0.3)), 3.4)

      // Gradient + gain + foam in one texel: the fragment pays ONE tap for
      // shading and one more (elsewhere) for the caustic entry point.
      textureStore(this.derived, ivec2(x, y), vec4(gx, gz, gain, c.b))
    })().compute(RES * RES)
  }

  dispose(): void {
    this.maps[0].dispose()
    this.maps[1].dispose()
    this.derived.dispose()
  }
}
