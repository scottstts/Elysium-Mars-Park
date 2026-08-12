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
  UPPER_TAZZA,
  WATER_Y,
} from './fountainPlan'
import { dropletMesh, splashMesh } from './waterDroplets'
import type { DropletEmitter, SplashEmitter } from './waterDroplets'

/**
 * THE WATERWORKS — the plumbing that decides where every parcel of water goes.
 *
 * This module owns two things and delegates the third:
 *
 *  1. **The ballistic solves.** Given a launch point, a target and a rise, it
 *     returns the launch velocity and flight time at MARS gravity. Every
 *     nozzle in `fountainStone.ts`, every wave train in `waterField.ts` and
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
 * refracts like a body. After breakup it is a cloud of independent lenses.
 * Drawing the whole stream one way or the other is what makes a fountain look
 * either like a plastic ribbon or like a smoke machine.
 *
 * ## Mars
 *
 * Every flight time here is roughly 1.6× its Earth equivalent, and the arcs
 * are correspondingly long and flat. A jet rising 1.55 m hangs 1.84 s. That
 * one constant is most of why this reads as another planet.
 */

const TAU = Math.PI * 2

/** Launch speed and flight time for a ballistic arc with a given rise/drop. */
export function ballistic(rise: number, drop: number): { vy: number; time: number } {
  const vy = Math.sqrt(2 * MARS_G * Math.max(rise, 1e-4))
  const time = (vy + Math.sqrt(vy * vy + 2 * MARS_G * Math.max(drop, 0))) / MARS_G
  return { vy, time }
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
 */
function coherentWaterMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()

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
    // is longest and the reflection strongest.
    const rim = surfaceFresnel()
    // Fade out along the run: by the end of a coherent length the sheet has
    // already begun necking, and the droplets take over from there.
    const along = float(1).sub(smoothstep(0.55, 1.0, uv().y))
    return rim.mul(0.85).add(0.12).mul(along)
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
 * true trajectory, thinning as it accelerates (mass flow is conserved, so a
 * sheet moving twice as fast is half as thick — the reason a curtain is
 * translucent at the lip and glassy 20 cm down).
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

export interface StreamMeshes {
  meshes: Array<Mesh | InstancedMesh>
  /** Where water lands, for the record (the ripple field reads the plan). */
  impacts: Array<{ x: number; z: number; y: number }>
}

/**
 * Build the whole waterworks. `center` is the fountain axis at the court's
 * paved top, in world coordinates.
 */
export function buildFountainStreams(center: Vector3): StreamMeshes {
  const meshes: Array<Mesh | InstancedMesh> = []
  const impacts: StreamMeshes['impacts'] = []
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

  // ── THE MAIN CURTAIN: the lower tazza's drip arris down to the basin. ─────
  {
    const lipRadius = LOWER_TAZZA.rimR + 0.012
    const lipY = LOWER_TAZZA.rimTopY - 0.018
    const drop = lipY - WATER_Y
    const flightTime = Math.sqrt((2 * drop) / MARS_G)
    // The outward drift is a real launch velocity, solved so the sheet lands
    // exactly on the ring the ripple field seeds its strongest train from.
    const vRadial = (MAIN_CURTAIN_LAND_R - lipRadius) / flightTime
    const coherent = 0.42
    finish(
      new Mesh(
        coherentSheet(center, {
          lipRadius,
          lipY: center.y + lipY,
          vRadial,
          length: coherent,
        }),
        coherentWaterMaterial(),
      ),
      14,
    )
    emitters.push({
      name: 'curtain-main',
      ringRadius: lipRadius,
      launchY: lipY,
      sites: MAIN_CURTAIN_STRANDS,
      ringPhase: 0,
      vRadial,
      vVertical: 0,
      coherentLength: coherent,
      flightTime,
      // 26 parcels over 4.6 m of fall: at 4–5 m/s their motion streaks are
      // 12–15 cm, so a strand reads as a continuous line of water that
      // visibly beads apart toward the bottom.
      perSite: 26,
      dBreakup: 0.028,
      dFinal: 0.011,
      scatter: 0.055,
      density: 0.9,
      jitter: 0.1,
    })
    splashes.push({
      name: 'curtain-splash',
      radius: MAIN_CURTAIN_LAND_R,
      points: 0,
      ringPhase: 0,
      up: [0.75, 2.1],
      out: [0.12, 0.66],
      size: [0.014, 0.04],
      count: 280,
      density: 0.8,
      softness: 0.18,
      y: WATER_Y + 0.01,
      life: 1.3,
    })
    impacts.push({ x: center.x, z: center.z, y: center.y + WATER_Y })
  }

  // ── THE UPPER CURTAIN: the small tazza into the big one. ─────────────────
  {
    const lipRadius = UPPER_TAZZA.rimR + 0.012
    const lipY = UPPER_TAZZA.rimTopY - 0.018
    const drop = lipY - lowerDishY
    const flightTime = Math.sqrt((2 * drop) / MARS_G)
    const vRadial = (UPPER_CURTAIN_LAND_R - lipRadius) / flightTime
    const coherent = 0.3
    finish(
      new Mesh(
        coherentSheet(center, { lipRadius, lipY: center.y + lipY, vRadial, length: coherent }),
        coherentWaterMaterial(),
      ),
      14,
    )
    emitters.push({
      name: 'curtain-upper',
      ringRadius: lipRadius,
      launchY: lipY,
      sites: UPPER_CURTAIN_STRANDS,
      ringPhase: 0.05,
      vRadial,
      vVertical: 0,
      coherentLength: coherent,
      flightTime,
      perSite: 16,
      dBreakup: 0.022,
      dFinal: 0.01,
      scatter: 0.05,
      density: 0.88,
      jitter: 0.08,
    })
  }

  // ── THE ARCING JET SETS. ─────────────────────────────────────────────────
  for (const set of [JETS_INWARD, JETS_OUTWARD]) {
    const inward = set === JETS_INWARD
    const drop = set.nozzleY - WATER_Y
    const { vy, time } = ballistic(set.apexRise, drop)
    const span = Math.abs(set.landR - set.nozzleR)
    const vh = (span / time) * (inward ? -1 : 1)
    const core = emptyAttributes()
    for (let i = 0; i < set.count; i++) {
      const theta = (i / set.count) * TAU + set.phase
      const outward = new Vector3(Math.cos(theta), 0, Math.sin(theta))
      coherentJet(
        core,
        new Vector3(
          center.x + outward.x * set.nozzleR,
          center.y + set.nozzleY,
          center.z + outward.z * set.nozzleR,
        ),
        inward ? outward.clone().negate() : outward,
        { vy, vh: Math.abs(vh), length: 0.55, radius: 0.028 },
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
      ringRadius: set.nozzleR,
      launchY: set.nozzleY,
      sites: set.count,
      ringPhase: set.phase,
      vRadial: vh,
      vVertical: vy,
      coherentLength: 0.55,
      flightTime: time,
      // 46 parcels over a 1.4 s flight: at 2-3 m/s their motion streaks are
      // 8-12 cm and the spacing is 6-9 cm, so an arc reads as a continuous
      // thread near the nozzle and visibly beads apart toward its landing.
      perSite: 46,
      dBreakup: 0.034,
      dFinal: 0.014,
      scatter: 0.075,
      density: 0.95,
      jitter: 0.12,
    })
    splashes.push({
      name: inward ? 'splash-inward' : 'splash-outward',
      radius: set.landR,
      points: set.count,
      ringPhase: set.phase + (inward ? Math.PI : 0),
      up: [0.9, 2.35],
      out: [0.2, 0.95],
      size: [0.013, 0.042],
      count: inward ? 190 : 110,
      density: 0.86,
      softness: 0.16,
      y: WATER_Y + 0.01,
      life: 1.4,
    })
  }

  // ── THE CROWN: one vertical column and a bell of eight canted jets. ──────
  {
    const bell = ballistic(CROWN.bellRise, FINIAL_Y - lowerDishY)
    const bellVh = CROWN.bellLandR / bell.time
    const core = emptyAttributes()
    for (let i = 0; i < CROWN.bellCount; i++) {
      const theta = (i / CROWN.bellCount) * TAU + 0.2
      coherentJet(
        core,
        new Vector3(center.x, center.y + FINIAL_Y, center.z),
        new Vector3(Math.cos(theta), 0, Math.sin(theta)),
        { vy: bell.vy, vh: bellVh, length: 0.42, radius: 0.02 },
      )
    }
    // The vertical column: no horizontal run, so it is authored directly as a
    // taper. It is deliberately SHORT-LIVED as coherent water — a real crown
    // jet gives up well before its ideal apex and becomes a bell of spray.
    const rise = CROWN.riseY
    const vy = Math.sqrt(2 * MARS_G * rise)
    const columnTime = vy / MARS_G
    coherentJet(
      core,
      new Vector3(center.x, center.y + FINIAL_Y, center.z),
      new Vector3(1, 0, 0),
      { vy, vh: 0.001, length: 0.75, radius: 0.026 },
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
      vRadial: bellVh,
      vVertical: bell.vy,
      coherentLength: 0.42,
      flightTime: bell.time,
      perSite: 42,
      dBreakup: 0.021,
      dFinal: 0.008,
      scatter: 0.09,
      density: 0.86,
      jitter: 0.1,
    })
    // The column's own water, thrown up and falling back around the finial.
    emitters.push({
      name: 'crown-column',
      ringRadius: 0.02,
      launchY: FINIAL_Y,
      sites: 9,
      ringPhase: 0,
      vRadial: 0.11,
      vVertical: vy,
      coherentLength: 0.75,
      flightTime: columnTime * 2.15,
      perSite: 26,
      dBreakup: 0.018,
      dFinal: 0.007,
      scatter: 0.16,
      density: 0.7,
      jitter: 0.35,
    })
  }

  // ── The hanging veil over the basin. ─────────────────────────────────────
  splashes.push({
    // In 600 Pa of CO₂ a fine droplet's terminal velocity is high but the air
    // it entrains barely damps, so the veil this fountain throws is thin, tall
    // and slow rather than a low fog bank.
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
  return { meshes, impacts }
}
