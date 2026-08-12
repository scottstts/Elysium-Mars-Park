import { BufferAttribute, BufferGeometry, DoubleSide, InstancedMesh, Mesh, NormalBlending, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn,
  cameraPosition,
  dot,
  float,
  max,
  mix,
  mrt,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { latticeSunVisibility } from '../dome/latticeField'
import { marsAmbientIrradiance, marsSkyRadiance } from '../sky/skyRadiance'
import { ENVIRONMENT_INTENSITY, SUN_LIGHT_INTENSITY, sunColorUniform, sunDirectionUniform } from '../sky/sun'
import {
  CROWN,
  FINIAL_Y,
  JETS_INWARD,
  JETS_OUTWARD,
  LOWER_TAZZA,
  MAIN_CURTAIN_LAND_R,
  MAIN_CURTAIN_STRANDS,
  MARS_G,
  UPPER_CURTAIN_LAND_R,
  UPPER_CURTAIN_STRANDS,
  NOZZLE_MOUTH_REACH,
  NOZZLE_SHOULDER_DROP,
  UPPER_TAZZA,
  WATER_Y,
  tazzaDripRadius,
  tazzaDripY,
} from './fountainPlan'
import { dropletMesh, splashMesh } from './waterDroplets'
import type { DropletEmitter, SplashEmitter } from './waterDroplets'

/**
 * THE WATERWORKS — the plumbing that decides where every parcel of water goes.
 *
 * This module owns two things and delegates the third:
 *
 *  1. **The flight solves.** Given a launch point, a target and a rise, it
 *     returns the launch velocity and flight time at MARS gravity — WITH the
 *     aerodynamic drag of the dome's air (see below). Every nozzle in
 *     `fountainStone.ts`, every impact the basin sim is forced with, and
 *     every droplet in `waterDroplets.ts` is aimed by these same numbers, so
 *     hardware, water and ripples cannot disagree about where a jet lands.
 *  2. **The coherent cores.** A jet leaves an orifice as an unbroken glassy
 *     column and a weir sheds an unbroken sheet; those short lengths are real
 *     connected surfaces and are drawn as such. Everything past the breakup
 *     point is discrete parcels.
 *  3. Those parcels are `waterDroplets.ts`'s job.
 *
 * The split is not a rendering convenience — it is where the physics changes.
 * Before breakup the water has a surface with a normal, so it reflects and
 * refracts like a body — and its mass-to-surface ratio is so high that drag
 * is negligible: the CORES fly ballistic arcs. After breakup every parcel is
 * a millimetre sphere whose drag is anything but negligible, which is why the
 * droplet model carries it and the core model does not. One stream, two
 * regimes, split at the same point the rendering splits.
 *
 * ## The atmosphere, and what drag does here
 *
 * Dome One holds a breathable ~70 kPa habitat mix (ρ ≈ 0.85 kg/m³) — this is
 * a PARK, not the 600 Pa outside. For a droplet of diameter d the momentum
 * response time is τ = (4/3)·(ρw/ρa·Cd)·d/v — about 2 s for a 2.5 mm drop at
 * these speeds, 0.4 s for a fine. Three visible consequences, all real:
 * arcs lose ~30 % of their ballistic reach (the launch solve compensates, so
 * the DESIGNED landing rings still hold for the mean parcel); fine spray
 * decelerates toward a ~1 m/s terminal fall and hangs while heavy drops carry
 * on (sprays sort themselves by size along the arc); and impact speeds — and
 * with them the splash crowns — come down to what the drag actually delivers.
 *
 * ## Mars
 *
 * Every flight time here is roughly 1.6× its Earth equivalent, and the arcs
 * are correspondingly long and flat. A jet rising 0.9 m hangs 1.4 s. That
 * one constant is most of why this reads as another planet.
 */

const TAU = Math.PI * 2

/** Habitat air density (70 kPa mix) over water density, folded with Cd. */
const K_DRAG = (4 / 3) * (1000 / 0.85) / 0.55

/** Momentum response time of a droplet of diameter d at flight speed v. */
export function dragTau(diameter: number, speed: number): number {
  return (K_DRAG * diameter) / Math.max(speed, 0.3)
}

export interface DragArc {
  /** Launch speeds, m/s. */
  vy: number
  vh: number
  /** Time to the receiving surface, s. */
  time: number
  /** Speed at impact, m/s — what the splash crown gets to spend. */
  impactSpeed: number
}

/**
 * Launch velocity and flight time for an arc that must RISE `rise` above the
 * launch point, then land `drop` below it, `span` metres away — through air,
 * with linear drag of response time `tau`. Closed forms:
 *
 *   y(t) = (vy + v_t)·τ·(1 − e^(−t/τ)) − v_t·t,  v_t = g·τ
 *   x(t) = vh·τ·(1 − e^(−t/τ))
 *   apex: t_a = τ·ln(1 + vy/v_t)  ⇒  rise = τ·vy − v_t·τ·ln(1 + vy/v_t)
 *
 * `vy` from the apex identity (Newton, analytic derivative τ·vy/(v_t+vy)),
 * `time` from y(T) = −drop (Newton off the ballistic seed), `vh` exact from
 * the horizontal run. As τ → ∞ every line degenerates to the ballistic case.
 */
export function dragArc(rise: number, drop: number, span: number, tau: number): DragArc {
  const vt = MARS_G * tau
  let vy = Math.sqrt(2 * MARS_G * Math.max(rise, 1e-4))
  if (rise > 1e-4) {
    for (let i = 0; i < 24; i++) {
      const f = tau * vy - vt * tau * Math.log(1 + vy / vt) - rise
      const df = (tau * vy) / (vt + vy)
      vy -= f / df
      if (Math.abs(f) < 1e-6) break
    }
  } else {
    vy = 0
  }
  let time = (vy + Math.sqrt(vy * vy + 2 * MARS_G * Math.max(drop, 1e-3))) / MARS_G
  for (let i = 0; i < 24; i++) {
    const decay = Math.exp(-time / tau)
    const f = (vy + vt) * tau * (1 - decay) - vt * time + drop
    const df = Math.min((vy + vt) * decay - vt, -0.05)
    time -= f / df
    if (Math.abs(f) < 1e-6) break
  }
  const run = tau * (1 - Math.exp(-time / tau))
  const vh = span / Math.max(run, 1e-4)
  const vyEnd = (vy + vt) * Math.exp(-time / tau) - vt
  const vhEnd = vh * Math.exp(-time / tau)
  return { vy, vh, time, impactSpeed: Math.hypot(vyEnd, vhEnd) }
}

/** Mean PHYSICAL droplet diameters, per stream family (m). The billboard
 * sizes in the emitter specs are display widths, deliberately larger — a
 * 2.5 mm droplet at ten metres is invisible; its STREAK is not. Drag reads
 * the physics, rendering reads the display. */
const DROP_D = { curtain: 0.003, jet: 0.0026, bell: 0.0016, column: 0.0014, upper: 0.0022 }

export interface JetSolution extends DragArc {
  /** Cant of the head — the launch angle AND the hardware's tilt, one number. */
  cant: number
  /** THE ORIFICE: plan radius and local height of the mouth ring's opening. */
  mouthRadius: number
  mouthY: number
  /** Horizontal run from the mouth to the landing ring, metres. */
  span: number
  /** Drag response time of the mean parcel at the solved launch speed. */
  tau: number
}

/**
 * The complete jet solve — ONE call that both the hardware and the water read.
 *
 * A nozzle's opening is not its setting-out point: the head pivots
 * `NOZZLE_SHOULDER_DROP` below `nozzleY` and its mouth stands
 * `NOZZLE_MOUTH_REACH` out along the cant, so the orifice sits ~3 cm higher
 * and ~8 cm inboard of the plan point. The arc must therefore be solved FROM
 * THE MOUTH — and the mouth's position depends on the cant, which depends on
 * the arc. Three fixed-point passes close that loop (converged to well under a
 * millimetre by the second), and the single `cant` this returns is what
 * `emitNozzle` tilts the bronze with, so the stream can only ever leave the
 * hole it is drawn leaving. Launching from the plan point instead put every
 * thread a hand's width off its own nozzle.
 */
export function jetSolve(set: {
  nozzleR: number
  nozzleY: number
  apexRise: number
  landR: number
}): JetSolution {
  const inward = set.landR < set.nozzleR
  const sign = inward ? -1 : 1
  let arc = dragArc(
    set.apexRise,
    set.nozzleY - WATER_Y,
    Math.abs(set.landR - set.nozzleR),
    dragTau(DROP_D.jet, 3.5),
  )
  let cant = Math.atan2(arc.vy, arc.vh)
  let mouthRadius = set.nozzleR
  let mouthY = set.nozzleY
  let span = Math.abs(set.landR - set.nozzleR)
  let tau = dragTau(DROP_D.jet, Math.hypot(arc.vy, arc.vh))
  for (let i = 0; i < 3; i++) {
    mouthRadius = set.nozzleR + Math.cos(cant) * NOZZLE_MOUTH_REACH * sign
    mouthY = set.nozzleY - NOZZLE_SHOULDER_DROP + Math.sin(cant) * NOZZLE_MOUTH_REACH
    span = Math.abs(set.landR - mouthRadius)
    tau = dragTau(DROP_D.jet, Math.hypot(arc.vy, arc.vh))
    arc = dragArc(set.apexRise, mouthY - WATER_Y, span, tau)
    cant = Math.atan2(arc.vy, arc.vh)
  }
  return { ...arc, cant, mouthRadius, mouthY, span, tau }
}

/**
 * THE COHERENT-WATER MATERIAL — for the short unbroken length only.
 *
 * A glassy column of water is almost pure Fresnel: nearly transparent looking
 * straight through it, a bright mirror at the silhouette, plus the forward
 * scatter that makes backlit water glow. There is no diffuse term because
 * water has no diffuse term. Opacity therefore rises toward the silhouette
 * rather than being uniform — which is the single cue that separates "a tube
 * of water" from "a painted tube".
 *
 * `thinning` is mass conservation on a falling sheet: flux = thickness × v is
 * constant, so as gravity runs v up the sheet thins as 1/v. Along the run
 * v² = v₀²·(1 + thinning·f²) with f the parametric distance, so opacity gets
 * a 1/√(1 + thinning·f²) factor — the reason a weir nappe is translucent at
 * the lip and glassy-thin 30 cm down.
 */
function coherentWaterMaterial(options: { thinning?: number } = {}): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const thinning = options.thinning ?? 0

  // A plain expression builder, not a nested `Fn`: a zero-argument shader
  // function called from two different material slots is a shader-call node
  // three cannot type, and it fails at build with "invalid parameter".
  const surfaceFresnel = () => {
    const view = normalize(cameraPosition.sub(positionWorld))
    const ndotv = max(dot(normalize(normalWorld), view), 0.02)
    return float(0.02).add(float(0.98).mul(pow(float(1).sub(ndotv), 4.0)))
  }

  material.colorNode = Fn(() => {
    const world = positionWorld
    const view = normalize(cameraPosition.sub(world)).toVar()
    const normal = normalize(normalWorld).toVar()
    const bounce = reflect(view.negate(), normal)
    const sky = marsSkyRadiance(bounce, float(0)).min(vec3(4.0)).mul(0.94)
    const sunVisible = latticeSunVisibility(world).toVar()
    const toSun = max(dot(view.negate(), sunDirectionUniform.negate()), 0)
    const forward = pow(toSun, 4.0).mul(1.5).add(pow(toSun, 1.2).mul(0.28))
    const scatter = sunColorUniform.mul(SUN_LIGHT_INTENSITY / Math.PI).mul(forward).mul(sunVisible)
    const ambient = marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY * 1.2)
    const glint = sunColorUniform
      .mul(pow(max(dot(bounce, sunDirectionUniform), 0), 120.0).mul(3.4))
      .mul(sunVisible)
    return mix(ambient.add(scatter), sky, surfaceFresnel()).add(glint)
  })()

  material.opacityNode = Fn(() => {
    // The core is nearly clear; the rim is where the ray's path through water
    // is longest and the reflection strongest. Even the rim stays moderate —
    // a 28 mm glass column is never a solid rod, and an opacity that lets the
    // silhouette go opaque renders every jet as dark cast bronze against a
    // bright pool.
    const rim = surfaceFresnel()
    // Mass conservation: the sheet thins as it accelerates (see above)…
    const f = uv().y
    const thin =
      thinning > 0 ? float(1).div(pow(float(1).add(f.mul(f).mul(thinning)), 0.5)) : float(1)
    // …and fades out along the run: by the end of a coherent length the sheet
    // has already begun necking, and the droplets take over from there.
    const along = float(1).sub(smoothstep(0.55, 1.0, f))
    return rim.mul(0.5).add(0.09).mul(along).mul(thin)
  })()

  material.transparent = true
  material.depthWrite = false
  material.blending = NormalBlending
  material.side = DoubleSide
  material.mrtNode = mrt({ normal: vec4(0) })
  return material
}

interface Attributes {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

function emptyAttributes(): Attributes {
  return { positions: [], normals: [], uvs: [], indices: [] }
}

function toGeometry(a: Attributes): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(a.positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(a.normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(a.uvs), 2))
  geometry.setIndex(a.indices)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The unbroken sheet a weir sheds: a short surface of revolution following the
 * true trajectory. The core is BALLISTIC — coherent water's mass-to-surface
 * ratio makes its drag negligible over half a metre (the parcels inherit the
 * air's argument only after breakup).
 */
function coherentSheet(
  center: Vector3,
  options: { lipRadius: number; lipY: number; vRadial: number; length: number },
): BufferGeometry {
  const a = emptyAttributes()
  const stations = 8
  const segments = 128
  // Time to fall the coherent length, from the vertical drop alone.
  const tEnd = Math.sqrt((2 * options.length) / MARS_G)
  for (let i = 0; i <= stations; i++) {
    const f = i / stations
    // Start just inside the moulding's undercut so the sheet emerges from the
    // stone rather than beginning in mid-air below it.
    const t = (-0.06 + f * 1.06) * tEnd
    const r = options.lipRadius + options.vRadial * t
    const y = options.lipY - 0.5 * MARS_G * t * t
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * TAU
      a.positions.push(center.x + Math.cos(theta) * r, y, center.z + Math.sin(theta) * r)
      a.normals.push(Math.cos(theta), 0, Math.sin(theta))
      a.uvs.push(s / segments, f)
    }
  }
  const stride = segments + 1
  for (let i = 0; i < stations; i++) {
    for (let s = 0; s < segments; s++) {
      const p = i * stride + s
      a.indices.push(p, p + stride, p + 1, p + 1, p + stride, p + stride + 1)
    }
  }
  return toGeometry(a)
}

/** The unbroken column a jet orifice sheds, swept along its own arc. */
function coherentJet(
  a: Attributes,
  origin: Vector3,
  direction: Vector3,
  options: { vy: number; vh: number; length: number; radius: number },
): void {
  const stations = 7
  const sides = 8
  const speed = Math.hypot(options.vh, options.vy)
  const tEnd = options.length / Math.max(speed, 0.2)
  const base = a.positions.length / 3
  for (let i = 0; i <= stations; i++) {
    const f = i / stations
    const t = f * tEnd
    const along = options.vh * t
    const y = origin.y + options.vy * t - 0.5 * MARS_G * t * t
    const vyNow = options.vy - MARS_G * t
    // Mass conservation: a faster section is a thinner one.
    const radius = options.radius * Math.sqrt(speed / Math.max(Math.hypot(options.vh, vyNow), 0.3))
    const tangent = new Vector3(direction.x * options.vh, vyNow, direction.z * options.vh).normalize()
    const side = new Vector3(-direction.z, 0, direction.x)
    const upLocal = new Vector3().crossVectors(tangent, side)
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * TAU
      const nx = side.x * Math.cos(ang) + upLocal.x * Math.sin(ang)
      const ny = side.y * Math.cos(ang) + upLocal.y * Math.sin(ang)
      const nz = side.z * Math.cos(ang) + upLocal.z * Math.sin(ang)
      a.positions.push(
        origin.x + direction.x * along + nx * radius,
        y + ny * radius,
        origin.z + direction.z * along + nz * radius,
      )
      a.normals.push(nx, ny, nz)
      a.uvs.push(s / sides, f)
    }
  }
  const stride = sides + 1
  for (let i = 0; i < stations; i++) {
    for (let s = 0; s < sides; s++) {
      const p = base + i * stride + s
      a.indices.push(p, p + stride, p + 1, p + 1, p + stride, p + stride + 1)
    }
  }
}

/**
 * A source of impacts on the BASIN's water, for the sim's forcing sampler.
 * Everything the sampler needs to reproduce where parcels are landing right
 * now — including the launch-time aim wander — without reading the GPU back.
 */
export interface ImpactSource {
  kind: 'ring' | 'points'
  /** Launch sites (points) or a continuous ring. */
  count: number
  phase: number
  /** Mean landing radius (drag-corrected) and the arc's horizontal span. */
  radius: number
  span: number
  inward: boolean
  /** Mean impact EVENTS per fixed step (fractional → stochastic). */
  perStep: number
  /** Crater rim radius and depth handed to the sim per event (m). */
  dropRadius: number
  dropDepth: number
  /** Aim-wander scale (matches the droplet shader's) and mean flight time. */
  wander: number
  flightTime: number
  /** Random radial scatter of individual landings (m). */
  spread: number
}

export interface StreamMeshes {
  meshes: Array<Mesh | InstancedMesh>
  /** Where water lands, for the record. */
  impacts: Array<{ x: number; z: number; y: number }>
  /** Basin impact sources for the heightfield sim's forcing. */
  sources: ImpactSource[]
}

/**
 * Build the whole waterworks. `center` is the fountain axis at the court's
 * paved top, in world coordinates.
 */
export function buildFountainStreams(center: Vector3): StreamMeshes {
  const meshes: Array<Mesh | InstancedMesh> = []
  const impacts: StreamMeshes['impacts'] = []
  const sources: ImpactSource[] = []
  const emitters: DropletEmitter[] = []
  const splashes: SplashEmitter[] = []

  const finish = (mesh: Mesh, order: number): void => {
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = order
    mesh.frustumCulled = false
    meshes.push(mesh)
  }

  const lowerDishY = LOWER_TAZZA.dishCenterY + (LOWER_TAZZA.dishRimY - LOWER_TAZZA.dishCenterY) * 0.78
  const upperDishY = UPPER_TAZZA.dishCenterY + (UPPER_TAZZA.dishRimY - UPPER_TAZZA.dishCenterY) * 0.78

  // ── THE MAIN CURTAIN: the lower tazza's drip arris down to the basin. ─────
  {
    const lipRadius = tazzaDripRadius(LOWER_TAZZA)
    const lipY = tazzaDripY(LOWER_TAZZA)
    const drop = lipY - WATER_Y
    const tau = dragTau(DROP_D.curtain, 3.2)
    // The outward drift is a real launch velocity, solved (through the air)
    // so the MEAN ligament lands exactly on the ring the sim is forced at.
    const arc = dragArc(0, drop, MAIN_CURTAIN_LAND_R - lipRadius, tau)
    const coherent = 0.42
    finish(
      new Mesh(
        coherentSheet(center, {
          lipRadius,
          lipY: center.y + lipY,
          vRadial: arc.vh,
          length: coherent,
        }),
        // v₀ off the lip is nearly pure horizontal drift; half a metre down
        // the fall speed dominates it — the nappe visibly thins.
        coherentWaterMaterial({ thinning: (2 * MARS_G * coherent) / (arc.vh * arc.vh + 0.25) }),
      ),
      14,
    )
    emitters.push({
      name: 'curtain-main',
      ringRadius: lipRadius,
      launchY: lipY,
      sites: MAIN_CURTAIN_STRANDS,
      ringPhase: 0,
      vRadial: arc.vh,
      vVertical: 0,
      coherentLength: coherent,
      flightTime: arc.time,
      // 26 parcels over 4.6 m of fall: at 4–5 m/s their motion streaks are
      // 12–15 cm, so a strand reads as a continuous line of water that
      // visibly beads apart toward the bottom.
      perSite: 26,
      dBreakup: 0.028,
      dFinal: 0.011,
      scatter: 0.055,
      density: 0.9,
      jitter: 0.1,
      angularSpread: 0.9,
      tauMean: tau,
      wander: 0.15,
      landY: WATER_Y,
    })
    splashes.push({
      name: 'curtain-splash',
      radius: MAIN_CURTAIN_LAND_R,
      points: 0,
      ringPhase: 0,
      up: [arc.impactSpeed * 0.16, arc.impactSpeed * 0.45],
      out: [0.12, 0.66],
      size: [0.014, 0.04],
      count: 280,
      density: 0.8,
      softness: 0.18,
      y: WATER_Y + 0.01,
      life: 1.3,
    })
    impacts.push({ x: center.x, z: center.z, y: center.y + WATER_Y })
    sources.push({
      kind: 'ring',
      count: MAIN_CURTAIN_STRANDS,
      phase: 0,
      radius: MAIN_CURTAIN_LAND_R,
      span: MAIN_CURTAIN_LAND_R - lipRadius,
      inward: false,
      perStep: 6,
      dropRadius: 0.11,
      dropDepth: 0.0054,
      wander: 0.15,
      flightTime: arc.time,
      spread: 0.13,
    })
  }

  // ── THE UPPER CURTAIN: the small tazza into the big one. ─────────────────
  {
    const lipRadius = tazzaDripRadius(UPPER_TAZZA)
    const lipY = tazzaDripY(UPPER_TAZZA)
    const drop = lipY - lowerDishY
    const tau = dragTau(DROP_D.upper, 1.8)
    const arc = dragArc(0, drop, UPPER_CURTAIN_LAND_R - lipRadius, tau)
    const coherent = 0.3
    finish(
      new Mesh(
        coherentSheet(center, { lipRadius, lipY: center.y + lipY, vRadial: arc.vh, length: coherent }),
        coherentWaterMaterial({ thinning: (2 * MARS_G * coherent) / (arc.vh * arc.vh + 0.25) }),
      ),
      14,
    )
    emitters.push({
      name: 'curtain-upper',
      ringRadius: lipRadius,
      launchY: lipY,
      sites: UPPER_CURTAIN_STRANDS,
      ringPhase: 0.05,
      vRadial: arc.vh,
      vVertical: 0,
      coherentLength: coherent,
      flightTime: arc.time,
      perSite: 16,
      dBreakup: 0.022,
      dFinal: 0.01,
      scatter: 0.05,
      density: 0.88,
      jitter: 0.08,
      angularSpread: 0.9,
      tauMean: tau,
      wander: 0.12,
      landY: lowerDishY,
    })
  }

  // ── THE ARCING JET SETS. ─────────────────────────────────────────────────
  for (const set of [JETS_INWARD, JETS_OUTWARD]) {
    const inward = set === JETS_INWARD
    // The solve owns the mouth AND the cant (see `jetSolve`), so the water
    // starts exactly at the opening the bronze is drawn around.
    const arc = jetSolve(set)
    const tau = arc.tau
    const vh = arc.vh * (inward ? -1 : 1)
    const core = emptyAttributes()
    for (let i = 0; i < set.count; i++) {
      const theta = (i / set.count) * TAU + set.phase
      const outward = new Vector3(Math.cos(theta), 0, Math.sin(theta))
      const launch = inward ? outward.clone().negate() : outward
      // The core starts 30 mm INSIDE the mouth ring so the column emerges
      // from the bronze instead of beginning on its lip with a visible seam.
      const bury = 0.03
      coherentJet(
        core,
        new Vector3(
          center.x + outward.x * arc.mouthRadius - launch.x * Math.cos(arc.cant) * bury,
          center.y + arc.mouthY - Math.sin(arc.cant) * bury,
          center.z + outward.z * arc.mouthRadius - launch.z * Math.cos(arc.cant) * bury,
        ),
        launch,
        { vy: arc.vy, vh: arc.vh, length: 0.55 + bury, radius: 0.028 },
      )
      impacts.push({
        x: center.x + Math.cos(theta) * set.landR,
        z: center.z + Math.sin(theta) * set.landR,
        y: center.y + WATER_Y,
      })
    }
    const mesh = new Mesh(toGeometry(core), coherentWaterMaterial())
    mesh.name = inward ? 'fountain-jetcore-inward' : 'fountain-jetcore-outward'
    finish(mesh, 14)

    emitters.push({
      name: inward ? 'jets-inward' : 'jets-outward',
      ringRadius: arc.mouthRadius,
      launchY: arc.mouthY,
      sites: set.count,
      ringPhase: set.phase,
      vRadial: vh,
      vVertical: arc.vy,
      coherentLength: 0.55,
      flightTime: arc.time,
      // 46 parcels over a 1.4 s flight: at 2-3 m/s their motion streaks are
      // 8-12 cm and the spacing is 6-9 cm, so an arc reads as a continuous
      // thread near the nozzle and visibly beads apart toward its landing.
      perSite: 46,
      dBreakup: 0.034,
      dFinal: 0.014,
      scatter: 0.075,
      density: 0.95,
      jitter: 0.12,
      angularSpread: 0.05,
      tauMean: tau,
      wander: 1,
      landY: WATER_Y,
    })
    splashes.push({
      name: inward ? 'splash-inward' : 'splash-outward',
      radius: set.landR,
      points: set.count,
      ringPhase: set.phase + (inward ? Math.PI : 0),
      up: [arc.impactSpeed * 0.3, arc.impactSpeed * 0.72],
      out: [0.2, 0.95],
      size: [0.013, 0.042],
      count: inward ? 190 : 110,
      density: 0.86,
      softness: 0.16,
      y: WATER_Y + 0.01,
      life: 1.4,
    })
    sources.push({
      kind: 'points',
      count: set.count,
      phase: set.phase,
      radius: set.landR,
      span: arc.span,
      inward,
      perStep: inward ? 5 : 2.6,
      dropRadius: 0.082,
      dropDepth: 0.0066,
      wander: 1,
      flightTime: arc.time,
      spread: 0.08,
    })
  }

  // ── THE CROWN: one vertical column and a bell of eight canted jets. ──────
  {
    const bellTau = dragTau(DROP_D.bell, 3.4)
    const bell = dragArc(CROWN.bellRise, FINIAL_Y - lowerDishY, CROWN.bellLandR, bellTau)
    const core = emptyAttributes()
    for (let i = 0; i < CROWN.bellCount; i++) {
      const theta = (i / CROWN.bellCount) * TAU + 0.2
      coherentJet(
        core,
        new Vector3(center.x, center.y + FINIAL_Y, center.z),
        new Vector3(Math.cos(theta), 0, Math.sin(theta)),
        { vy: bell.vy, vh: bell.vh, length: 0.42, radius: 0.02 },
      )
    }
    // The vertical column. Fine crown spray fights the most drag in the whole
    // piece — reaching a 2.55 m apex through the air takes a launch speed a
    // vacuum solve would put at 4.4 m/s and the real one puts near 5.7. It is
    // deliberately SHORT-LIVED as coherent water: a real crown jet gives up
    // well before its ideal apex and becomes a bell of spray.
    const columnTau = dragTau(DROP_D.column, 4.5)
    const column = dragArc(CROWN.riseY, FINIAL_Y - upperDishY, 0.001, columnTau)
    coherentJet(
      core,
      new Vector3(center.x, center.y + FINIAL_Y, center.z),
      new Vector3(1, 0, 0),
      { vy: column.vy, vh: 0.001, length: 0.75, radius: 0.026 },
    )
    const mesh = new Mesh(toGeometry(core), coherentWaterMaterial())
    mesh.name = 'fountain-crown-core'
    finish(mesh, 14)

    emitters.push({
      name: 'crown-bell',
      ringRadius: 0.03,
      launchY: FINIAL_Y,
      sites: CROWN.bellCount,
      ringPhase: 0.2,
      vRadial: bell.vh,
      vVertical: bell.vy,
      coherentLength: 0.42,
      flightTime: bell.time,
      perSite: 42,
      dBreakup: 0.021,
      dFinal: 0.008,
      scatter: 0.09,
      density: 0.86,
      jitter: 0.1,
      angularSpread: 0.08,
      tauMean: bellTau,
      wander: 1.3,
      landY: lowerDishY,
    })
    // The column's own water, thrown up and falling back around the finial.
    emitters.push({
      name: 'crown-column',
      ringRadius: 0.02,
      launchY: FINIAL_Y,
      sites: 9,
      ringPhase: 0,
      vRadial: 0.11,
      vVertical: column.vy,
      coherentLength: 0.75,
      flightTime: column.time,
      perSite: 26,
      dBreakup: 0.018,
      dFinal: 0.007,
      scatter: 0.16,
      density: 0.7,
      jitter: 0.35,
      angularSpread: 0.9,
      tauMean: columnTau,
      wander: 1.4,
      landY: upperDishY,
    })
  }

  // ── The hanging veil over the basin. ─────────────────────────────────────
  splashes.push({
    // The finest spray is drag-dominated in the habitat's air: its terminal
    // fall is under a metre a second, so a slow haze genuinely hangs over the
    // basin — the veil every big fountain wears just above its water.
    name: 'basin-veil',
    radius: (MAIN_CURTAIN_LAND_R + JETS_INWARD.landR) * 0.5,
    points: 0,
    ringPhase: 0,
    up: [0.12, 0.5],
    out: [0.05, 0.35],
    size: [0.3, 0.9],
    count: 64,
    density: 0.09,
    softness: 1,
    y: WATER_Y + 0.12,
    life: 5.4,
  })

  for (const spec of emitters) meshes.push(dropletMesh(center, spec))
  for (const spec of splashes) meshes.push(splashMesh(center, spec))
  return { meshes, impacts, sources }
}
