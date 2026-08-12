import { InstancedMesh, Matrix4, NormalBlending, PlaneGeometry, Sphere, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  Fn,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  max,
  min,
  mix,
  mrt,
  normalize,
  positionGeometry,
  pow,
  screenSize,
  sin,
  smoothstep,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { latticeSunVisibility } from '../dome/latticeField'
import { markParticle } from '../render/layers'
import { marsAmbientIrradiance } from '../sky/skyRadiance'
import { ENVIRONMENT_INTENSITY, SUN_LIGHT_INTENSITY, sunColorUniform, sunDirectionUniform } from '../sky/sun'
import { MARS_G, WATER_Y } from './fountainPlan'
import { fountainTime } from './waterField'

/**
 * BALLISTIC WATER — every disconnected parcel in the fountain, from one model.
 *
 * ## Why this replaces the alpha-carved ribbons
 *
 * The first pass drew streams as swept sheets with strands cut out of them by
 * an alpha function. That is a picture of water, not water: the "strands" are
 * a texture on a fixed surface, so they cannot separate, cannot be overtaken
 * by the parcel behind them, and cannot be seen edge-on — which is exactly why
 * they read as plastic ribbons. It was also ruinous to fill rate, because
 * every ribbon rasterises its full height whatever its alpha says.
 *
 * What is here instead is the physical object: a jet or a weir sheds a
 * COHERENT length, then Rayleigh–Plateau instability atomises it into
 * droplets, and after that every droplet is an independent projectile. So
 * every droplet here IS an independent projectile:
 *
 *     p(t) = p₀ + v₀·t + ½·g·t²          g = −3.721 m/s² (Mars)
 *     v(t) = v₀ + g·t
 *
 * solved in closed form per instance, per frame, on the GPU. Nothing is
 * animated by scrolling anything.
 *
 * ## Three physical behaviours that do the visual work
 *
 * 1. **Motion stretch is exposure, not a style.** A droplet crossing the
 *    sensor during an exposure paints a streak of length `d + |v|·τ`. At the
 *    2–5 m/s these parcels travel that is 6–17 cm against a 4 mm droplet, so
 *    a fountain photographs as bright *streaks*. Billboards are therefore
 *    aligned to the SCREEN-PROJECTED velocity and stretched by it — which is
 *    also why the streams read as fast even in a still frame.
 * 2. **Atomisation is progressive.** Diameter runs from the ligament scale at
 *    breakup down to fine spray at the end of flight, and the transverse
 *    scatter velocity only starts at the breakup point. A stream therefore
 *    narrows, frays and finally disperses along its length, for the reason it
 *    does in reality.
 * 3. **Sub-pixel droplets keep their energy.** Below ~1.6 px the billboard is
 *    clamped up to that size and its opacity is scaled by the AREA RATIO, so
 *    distant spray fades into a coherent haze instead of aliasing into
 *    crawling white confetti. This is the same conservation rule the water
 *    surface's micro-band fades obey.
 *
 * ## Pipeline contract
 *
 * Transparent and `markParticle`d: a billboard rasterises as its full
 * RECTANGLE in any shadow or auxiliary pass, and `mrt({ normal: vec4(0) })`
 * keeps a transparent fragment from claiming authority over the normal +
 * AO-receiver buffer. Both lessons are already paid for in this park.
 */

const TAU = Math.PI * 2
/** Shutter time the motion stretch is drawn for, seconds. */
const EXPOSURE = 1 / 34
/** Minimum rendered droplet size, in pixels of the vertical screen axis. */
const MIN_PIXELS = 1.6

/**
 * How many metres a pixel spans at a view-space position — measured by
 * projecting the point and the point one metre above it and differencing in
 * NDC. Exact for any projection, and it needs no access to matrix elements.
 */
const metresPerPixel = /*@__PURE__*/ Fn(([viewPos]: [Node<'vec4'>]) => {
  const here = cameraProjectionMatrix.mul(viewPos)
  const above = cameraProjectionMatrix.mul(
    vec4(viewPos.x, viewPos.y.add(1.0), viewPos.z, viewPos.w),
  )
  const ndcPerMetre = above.y.div(above.w).sub(here.y.div(here.w)).abs()
  return float(2).div(max(ndcPerMetre.mul(screenSize.y), 1e-4))
})

export interface DropletEmitter {
  name: string
  /** Launch ring radius (metres from the fountain axis) and local height. */
  ringRadius: number
  launchY: number
  /**
   * Launch sites around the ring. A jet set uses its orifice count; a weir is
   * continuous, so this is the number of LIGAMENTS its sheet necks into.
   */
  sites: number
  ringPhase: number
  /** Launch velocity, radial (may be negative = inward) and vertical, m/s. */
  vRadial: number
  vVertical: number
  /** Metres of unbroken stream before atomisation begins. */
  coherentLength: number
  /** Total flight time to the receiving surface, seconds. */
  flightTime: number
  /** Droplets per launch site. */
  perSite: number
  /** Droplet diameter at breakup and at the end of flight, metres. */
  dBreakup: number
  dFinal: number
  /** Transverse velocity acquired at breakup, m/s. */
  scatter: number
  /** Opacity scale of an intact droplet. */
  density: number
  /** Extra vertical launch spread (jet orifices are never perfect), m/s. */
  jitter: number
}

/**
 * One emitter as a single instanced draw. `center` is the fountain axis at the
 * court's paved top, in world coordinates.
 */
export function dropletMesh(center: Vector3, spec: DropletEmitter): InstancedMesh {
  const material = new MeshBasicNodeMaterial()
  const anchor = uniform(center)
  const count = spec.sites * spec.perSite
  const speed0 = Math.hypot(spec.vRadial, spec.vVertical)
  const tBreak = Math.min(spec.coherentLength / Math.max(speed0, 0.2), spec.flightTime * 0.85)

  /**
   * The parcel, solved in the VERTEX stage: `vec4(position, diameter)` plus a
   * second varying for velocity. `instanceIndex` is a vertex-stage builtin in
   * WGSL, so nothing downstream may recompute from it.
   */
  /**
   * The per-parcel constants, gathered once so state, velocity and age all
   * read the SAME numbers. Six hashes, and every one of them exists to break a
   * uniformity that the first pass had:
   *
   *   r1  release phase inside the parcel's own slot — parcels are not a
   *       metronome, they are a Poisson-ish dribble
   *   r2  the launch's vertical scatter (no two orifices are matched)
   *   r3  the radial scatter and the droplet's own size draw
   *   r4  the transverse spin direction after breakup
   *   r5  intermittency: a fraction of parcels simply are not there, because
   *       a real ligament thins and re-forms
   *   r6  the ligament's snaking phase
   */
  const seeds = () => ({
    site: floor(float(instanceIndex).div(spec.perSite)),
    rank: float(instanceIndex).sub(floor(float(instanceIndex).div(spec.perSite)).mul(spec.perSite)),
    r1: hash(instanceIndex),
    r2: hash(instanceIndex.add(7919)),
    r3: hash(instanceIndex.add(104729)),
    r4: hash(instanceIndex.add(15485863)),
    r5: hash(instanceIndex.add(32452843)),
    r6: hash(instanceIndex.add(49979687)),
  })

  /** Age in seconds. Slot-jittered, so spacing along a strand is irregular. */
  const ageOf = (s: ReturnType<typeof seeds>) =>
    fract(
      s.rank
        .add(s.r1.mul(0.92).add(0.04))
        .div(spec.perSite)
        .add(fountainTime.div(spec.flightTime)),
    ).mul(spec.flightTime)

  /**
   * Per-strand flow, 0.45…1. A weir does not shed evenly along its lip and a
   * ring of orifices is never balanced: the sheet runs heavy here and thin
   * there, and the pattern drifts. This one term is most of what separates
   * "a fountain" from "a particle emitter".
   */
  const flowOf = (s: ReturnType<typeof seeds>) =>
    sin(
      s.site.mul(2.37).add(fountainTime.mul(0.31)).add(s.site.mul(s.site).mul(0.11)),
    )
      .mul(0.27)
      .add(sin(s.site.mul(5.11).sub(fountainTime.mul(0.19))).mul(0.16))
      .add(0.72)

  const state = Fn(() => {
    const s = seeds()
    const t = ageOf(s).toVar()
    const theta = s.site.add(s.r2.mul(0.5).add(0.25)).div(spec.sites).mul(TAU).add(spec.ringPhase).toVar()
    const cs = cos(theta)
    const sn = sin(theta)
    const vv = float(spec.vVertical).add(s.r2.sub(0.5).mul(spec.jitter)).toVar()
    const vr = float(spec.vRadial).mul(s.r3.mul(0.1).add(0.95)).toVar()

    const radius = float(spec.ringRadius).add(vr.mul(t))
    const height = vv.mul(t).sub(t.mul(t).mul(MARS_G * 0.5))

    // Ligament snaking: a coherent thread does not fall straight, it wanders
    // on a slow transverse instability that grows as the thread thins. This
    // is what stops a curtain reading as a comb of parallel dashes.
    const snakePhase = s.site.mul(3.7).add(s.r6.mul(TAU)).add(t.mul(4.1))
    const snake = sin(snakePhase).mul(t.div(spec.flightTime).mul(0.055).add(0.004))

    // Transverse scatter, from the breakup point onward only.
    const free = max(t.sub(tBreak), 0).toVar()
    const spin = s.r4.mul(TAU)
    const lateral = free.mul(spec.scatter).mul(s.r3.mul(1.6).add(0.25)).toVar()
    const acrossX = sn.negate()
    const acrossZ = cs
    const offX = cos(spin).mul(lateral).mul(acrossX).add(snake.mul(acrossX))
    const offZ = cos(spin).mul(lateral).mul(acrossZ).add(snake.mul(acrossZ))
    const offY = sin(spin).mul(lateral).mul(0.7)

    // Atomisation: ligament scale at breakup, fine spray by the end. The size
    // draw is squared so small droplets dominate — a real spray's size
    // distribution has a long thin tail, not a uniform spread.
    const shatter = free.div(Math.max(spec.flightTime - tBreak, 1e-3)).clamp(0, 1)
    const draw = s.r3.mul(s.r1).mul(1.7).add(0.35)
    const size = mix(float(spec.dBreakup), float(spec.dFinal), shatter)
      .mul(draw)
      .mul(flowOf(s).mul(0.4).add(0.7))
    return vec4(
      anchor.x.add(cs.mul(radius)).add(offX),
      anchor.y.add(spec.launchY).add(height).add(offY),
      anchor.z.add(sn.mul(radius)).add(offZ),
      size,
    )
  })()

  const velocity = Fn(() => {
    const s = seeds()
    const t = ageOf(s)
    const theta = s.site.add(s.r2.mul(0.5).add(0.25)).div(spec.sites).mul(TAU).add(spec.ringPhase)
    const vv = float(spec.vVertical).add(s.r2.sub(0.5).mul(spec.jitter)).sub(t.mul(MARS_G))
    const vr = float(spec.vRadial).mul(s.r3.mul(0.1).add(0.95))
    return vec3(cos(theta).mul(vr), vv, sin(theta).mul(vr))
  })()

  const age = Fn(() => ageOf(seeds()))()
  /**
   * Intermittency: a parcel its strand's flow was too thin to shed. Kept
   * GENTLE — the first tuning could take a whole strand to zero, which reads
   * as sixteen jets of which four are switched off rather than as a stream
   * that breathes.
   */
  const present = Fn(() => {
    const s = seeds()
    return smoothstep(0.14, 0.44, flowOf(s).mul(s.r5.mul(0.45).add(0.72))).mul(0.72).add(0.28)
  })()

  /**
   * The streak's world width and length, and the opacity gain that pays back
   * the sub-pixel clamp. Evaluated once here and consumed by both the vertex
   * stage (which needs the sizes) and the fragment stage (which needs the
   * gain), so the clamp and its compensation can never disagree.
   */
  const streak = Fn(() => {
    const minWorld = metresPerPixel(cameraViewMatrix.mul(vec4(state.xyz, 1.0))).mul(MIN_PIXELS)
    const trueLength = state.w.add(velocity.length().mul(EXPOSURE))
    const width = max(state.w, minWorld)
    const length = max(trueLength, minWorld)
    return vec3(width, length, min(state.w.mul(trueLength).div(width.mul(length)), 1.0))
  })()

  const parcel = varying(state)
  const parcelAge = varying(age)
  const parcelGain = varying(streak.z.mul(present))

  material.vertexNode = Fn(() => {
    const viewPos = cameraViewMatrix.mul(vec4(state.xyz, 1.0)).toVar()
    const viewVel = cameraViewMatrix.mul(vec4(velocity, 0.0)).xyz.toVar()
    const size = streak.toVar()

    // Align the quad's long axis with the velocity AS PROJECTED — a droplet's
    // streak lies along its screen-space path, which is not its world path.
    // The epsilon keeps a parcel at its apex (zero screen velocity) from
    // normalising a zero vector into NaN.
    const along = normalize(vec2(viewVel.x.add(1e-5), viewVel.y)).toVar()
    const across = vec2(along.y.negate(), along.x)
    const offset = along
      .mul(positionGeometry.x.mul(size.y.mul(0.5)))
      .add(across.mul(positionGeometry.y.mul(size.x.mul(0.5))))
    return cameraProjectionMatrix.mul(
      vec4(viewPos.x.add(offset.x), viewPos.y.add(offset.y), viewPos.z, viewPos.w),
    )
  })()

  material.colorNode = Fn(() => {
    const world = parcel.xyz
    const view = normalize(world.sub(cameraPosition)).toVar()
    const sunVisible = latticeSunVisibility(world)
    // A droplet is a millimetre-scale lens. Essentially everything that leaves
    // it toward the eye is either forward-scattered sunlight (a broad, very
    // strong lobe — this is why backlit spray is the brightest thing in any
    // fountain photograph) or the sky it reflects off its curved skin.
    const toSun = max(dot(view, sunDirectionUniform), 0)
    const forward = pow(toSun, 3.4).mul(2.1).add(pow(toSun, 1.1).mul(0.32)).add(0.2)
    const lit = sunColorUniform
      .mul(SUN_LIGHT_INTENSITY / Math.PI)
      .mul(forward)
      .mul(sunVisible)
      .add(marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY * 2.1))
    return vec3(0.95, 0.96, 0.98).mul(lit)
  })()

  material.opacityNode = Fn(() => {
    // A gaussian core along the streak: sharp across, soft along, because a
    // motion streak is a droplet convolved with its own path.
    const q = vec2(uv().x.sub(0.5).mul(2), uv().y.sub(0.5).mul(2))
    const core = float(1)
      .sub(smoothstep(0.25, 1.0, q.y.abs()))
      .mul(float(1).sub(smoothstep(0.55, 1.0, q.x.abs())))
    // Fade in as the parcel leaves the coherent core it was hidden inside.
    const emerge = smoothstep(tBreak * 0.55, tBreak * 1.05 + 0.02, parcelAge)
    // …and out at the receiving surface, where it becomes splash, not droplet.
    const land = float(1).sub(smoothstep(spec.flightTime * 0.93, spec.flightTime, parcelAge))
    return core.mul(emerge).mul(land).mul(parcelGain).mul(spec.density)
  })()

  material.transparent = true
  material.depthWrite = false
  material.blending = NormalBlending
  material.mrtNode = mrt({ normal: vec4(0) })

  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), material, count)
  const identity = new Matrix4()
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, identity)
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = `fountain-droplets:${spec.name}`
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.renderOrder = 15
  mesh.boundingSphere = new Sphere(center.clone(), 16)
  markParticle(mesh)
  return mesh
}

/**
 * A SPLASH emitter: the crown of droplets thrown back up where a stream lands.
 * Same projectile model, launched from the water rather than from a nozzle,
 * and killed at the surface it falls back into.
 */
export interface SplashEmitter {
  name: string
  radius: number
  /** Discrete impact points, or 0 for a continuous landing ring. */
  points: number
  /** Bearing of the first impact point. */
  ringPhase: number
  /** Vertical and horizontal launch speed ranges, m/s. */
  up: [number, number]
  out: [number, number]
  size: [number, number]
  count: number
  density: number
  /** 0 = a droplet, 1 = a mist puff that entrains and barely falls. */
  softness: number
  /** Local launch height. */
  y: number
  life: number
}

export function splashMesh(center: Vector3, spec: SplashEmitter): InstancedMesh {
  const material = new MeshBasicNodeMaterial()
  const anchor = uniform(center)

  const state = Fn(() => {
    const r1 = hash(instanceIndex)
    const r2 = hash(instanceIndex.add(7919))
    const r3 = hash(instanceIndex.add(104729))
    const r4 = hash(instanceIndex.add(15485863))
    const life = fract(fountainTime.div(spec.life).add(r4)).toVar()
    const t = life.mul(spec.life).toVar()

    const ringAngle =
      spec.points > 0
        ? floor(r1.mul(spec.points)).add(0.5).div(spec.points).mul(TAU).add(spec.ringPhase)
        : r1.mul(TAU)
    const bearing = r2.mul(TAU)
    const vOut = mix(float(spec.out[0]), float(spec.out[1]), r3)
    const vUp = mix(float(spec.up[0]), float(spec.up[1]), fract(r1.add(r3.mul(0.618))))
    const drift = vOut.mul(t)
    // Mist is drag-dominated and barely falls; a droplet is ballistic. One
    // softness parameter interpolates between the two accelerations.
    const y = anchor.y
      .add(spec.y)
      .add(vUp.mul(t))
      .sub(t.mul(t).mul(MARS_G * 0.5 * (1 - spec.softness * 0.75)))
    const grow = mix(float(1), life.mul(0.9).add(0.5), spec.softness)
    const size = mix(float(spec.size[0]), float(spec.size[1]), r1).mul(grow)
    return vec4(
      anchor.x.add(cos(ringAngle).mul(spec.radius)).add(cos(bearing).mul(drift)),
      y,
      anchor.z.add(sin(ringAngle).mul(spec.radius)).add(sin(bearing).mul(drift)),
      size,
    )
  })()

  const parcel = varying(state)
  const parcelLife = varying(fract(fountainTime.div(spec.life).add(hash(instanceIndex.add(15485863)))))

  material.vertexNode = Fn(() => {
    const viewCenter = cameraViewMatrix.mul(vec4(state.xyz, 1.0)).toVar()
    const half = max(state.w, metresPerPixel(viewCenter).mul(MIN_PIXELS)).mul(0.5)
    const offset = vec4(positionGeometry.x.mul(half), positionGeometry.y.mul(half), 0.0, 0.0)
    return cameraProjectionMatrix.mul(viewCenter.add(offset))
  })()

  material.colorNode = Fn(() => {
    const world = parcel.xyz
    const view = normalize(world.sub(cameraPosition))
    const toSun = max(dot(view, sunDirectionUniform), 0)
    const forward = pow(toSun, 3.2).mul(1.6).add(0.3)
    const lit = sunColorUniform
      .mul(SUN_LIGHT_INTENSITY / Math.PI)
      .mul(forward)
      .mul(latticeSunVisibility(world))
      .add(marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY * 1.9))
    return vec3(0.94, 0.95, 0.97).mul(lit)
  })()

  material.opacityNode = Fn(() => {
    const radial = vec2(uv().x.sub(0.5), uv().y.sub(0.5)).length().mul(2)
    const shape = smoothstep(1.0, mix(float(0.6), float(0.0), spec.softness), radial)
    const fade = smoothstep(0.0, 0.1, parcelLife).mul(float(1).sub(smoothstep(0.5, 1.0, parcelLife)))
    // Droplets die at the surface they fall back into, not in mid-air.
    const submerged = smoothstep(
      anchor.y.add(WATER_Y - 0.05),
      anchor.y.add(WATER_Y + 0.05),
      parcel.y,
    )
    return shape.mul(fade).mul(submerged).mul(spec.density)
  })()

  material.transparent = true
  material.depthWrite = false
  material.blending = NormalBlending
  material.mrtNode = mrt({ normal: vec4(0) })

  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), material, spec.count)
  const identity = new Matrix4()
  for (let i = 0; i < spec.count; i++) mesh.setMatrixAt(i, identity)
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = `fountain-splash:${spec.name}`
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.renderOrder = 16
  mesh.boundingSphere = new Sphere(center.clone(), 16)
  markParticle(mesh)
  return mesh
}
