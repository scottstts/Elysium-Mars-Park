import { AdditiveBlending, InstancedMesh, Matrix4, PlaneGeometry, Sphere, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn, cameraProjectionMatrix, cameraViewMatrix, color, float, instanceIndex, mix, mrt,
  modelWorldMatrix, mx_noise_float, positionGeometry, smoothstep, time, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { markParticle } from '../render/layers'

/**
 * THE ENGINE PLUME — 33 Raptors into 600 pascals.
 *
 * NOT A MESH. The first build was three nested lathes and it read as exactly
 * what it was: a solid cone bolted to the tail. A plume has no surface — it is
 * gas being thrown, and what makes it look like gas is that its edge is made of
 * separate parcels moving at different speeds and dying at different distances,
 * never a silhouette. So this is a stream of additive billboards flowing down
 * the axis, and every axial feature is a function of how far down a parcel has
 * got rather than of where a vertex sits.
 *
 * That also disposes of the reason the mesh existed. A cone survives being
 * viewed along its own axis where an axis-aligned ribbon degenerates to a line
 * — and from 215 m, most of an ascent is spent looking straight up the axis.
 * Camera-facing parcels have no preferred direction at all, so the problem
 * never arises.
 *
 * WHY IT LOOKS LIKE THIS. A methalox plume is not orange; the orange in a
 * launch photograph is recirculated pad debris and afterburning. Clean CH4/O2
 * combustion is a blue-violet Mach-shocked core, and on Mars the nozzle is
 * grossly UNDER-EXPANDED — a Raptor's exit pressure is thousands of times
 * ambient — so the flow does not stay in a column, it blooms into an enormous
 * bell the moment it leaves the bell, and blooms further as the vehicle climbs.
 * Short white throat, diamond-shocked violet barrel, huge soft flare, orange
 * only on the cool entrained skirt where it physically belongs.
 *
 * THE DIAMONDS ARE STATIONARY AND THE GAS IS NOT. Shock cells stand still in
 * space while the flow passes through them, so the banding is a function of
 * axial distance, not of parcel age — parcels brighten as they cross a node and
 * dim between. Driving it off age instead would make the whole plume strobe.
 *
 * HDR PLACEMENT. `world/lightFixtures.ts` owns the ladder: bloom threshold 1.0,
 * brightest authored fixture 5.0, sun disc 1800. A rocket exhaust belongs
 * between the two, not near the lamps. The pipeline's exposure is authored and
 * fixed, so nothing else in the frame is crushed when it lights.
 */

/**
 * Enough parcels that the stream reads as continuous rather than as beads, few
 * enough that the additive overdraw stays bounded — the plume covers a few
 * hundred pixels at 215 m and every parcel is a transparent quad over it.
 */
const COUNT = 360
/** Plume length at full throttle, in cluster-exit radii. */
const LENGTH_RATIO = 7.5
/** Parcel flow rate, in plume-lengths per second. Fast: this is exhaust. */
const FLOW_RATE = 1.35

export interface StarshipPlume {
  mesh: InstancedMesh
  /**
   * @param throttle 0…1 chamber output.
   * @param engines how many of the 33 bells are lit — sets the root width.
   * @param expansion 0 at the pad, 1 in near vacuum; how far the flare blooms.
   * @param fade multiplies everything, for the dissolve at the top of the climb.
   */
  update(throttle: number, engines: number, expansion: number, fade: number): void
  dispose(): void
}

export function createStarshipPlume(clusterRadius: number): StarshipPlume {
  const throttleU = uniform(0)
  const fadeU = uniform(0)
  const spreadU = uniform(1)
  const flareU = uniform(1)
  const lengthU = uniform(clusterRadius * LENGTH_RATIO)
  const radiusU = uniform(clusterRadius)

  const material = new MeshBasicNodeMaterial()

  /** Three decorrelated per-parcel constants from the instance index alone. */
  const seed = Fn(() => {
    const i = float(instanceIndex)
    return vec3(
      i.mul(0.6180339887).fract(),
      i.mul(0.7548776662).fract(),
      i.mul(0.9101090193).fract(),
    )
  })

  /**
   * Where this parcel is in the plume's own frame, and how big. The vehicle's
   * nose is +Z, so the exhaust leaves along −Z.
   *
   * `s` is normalised axial distance, and it is BOTH the parcel's progress and
   * the plume's own coordinate — which is what lets the shock banding stand
   * still while the parcels stream through it.
   */
  const parcel = Fn(() => {
    const rnd = seed().toVar()
    // Parcels are staggered by phase and run at slightly different speeds, so
    // the stream never pulses. Faster near the axis, as a real jet is.
    const rate = float(FLOW_RATE).mul(rnd.y.mul(0.45).add(0.8))
    const s = rnd.x.add(time.mul(rate)).fract().toVar()

    const azimuth = rnd.z.mul(Math.PI * 2).toVar()
    // Under-expanded bloom: a slight waist at the throat, then a wide flare.
    // The radial jitter is per-parcel so the edge is ragged, never a profile.
    const envelope = float(0.82).add(float(1.55).mul(s.pow(0.62)).mul(flareU))
    const jitter = rnd.y.mul(0.55).add(0.55)
    const churn = mx_noise_float(vec3(rnd.xy.mul(19.7), s.mul(2.2).sub(time.mul(0.8))))
    const r = radiusU.mul(spreadU).mul(envelope).mul(jitter).mul(churn.mul(0.32).add(1))

    // Start just inside the bells so the parcel's birth fade is hidden in the
    // engine bay rather than showing as a dark gap under the vehicle.
    const axial = s.mul(lengthU).sub(radiusU.mul(0.22))
    const pos = vec3(azimuth.cos().mul(r), azimuth.sin().mul(r), axial.negate())

    // Parcels grow as they mix outward — the single strongest cue that this is
    // gas expanding rather than a shape being drawn.
    const size = radiusU.mul(spreadU).mul(float(0.42).add(s.mul(1.35).mul(flareU)))
    return vec4(pos, size).toVar()
  })

  /** Axial coordinate on its own, for the fragment stage. */
  const axialS = Fn(() => {
    const rnd = seed()
    const rate = float(FLOW_RATE).mul(rnd.y.mul(0.45).add(0.8))
    return rnd.x.add(time.mul(rate)).fract()
  })

  material.vertexNode = Fn(() => {
    const p = parcel()
    const view = cameraViewMatrix.mul(modelWorldMatrix).mul(vec4(p.xyz, 1))
    const offset = positionGeometry.xy.mul(p.w)
    return cameraProjectionMatrix.mul(
      vec4(view.x.add(offset.x), view.y.add(offset.y), view.z, view.w),
    )
  })()

  material.colorNode = Fn(() => {
    const s = axialS().toVar()
    const rnd = seed()

    // Throat white-blue → barrel violet → entrained orange, cooling downstream.
    const hot = mix(color(0.80, 0.90, 1.00), color(0.52, 0.34, 1.00), smoothstep(0.02, 0.30, s))
    const tint = mix(hot, color(1.00, 0.42, 0.13), smoothstep(0.34, 0.85, s))

    // Mach diamonds: standing shock cells, so keyed to DISTANCE. Their contrast
    // dies out as the flow mixes, which is why only the first fifth shows them.
    const diamonds = s.mul(11.5).sin().abs().pow(2.2).mul(s.mul(-9.0).exp()).mul(1.9)
    // Chamber roughness — per parcel, so the plume boils instead of pulsing.
    const flicker = mx_noise_float(vec3(rnd.xy.mul(7.3), time.mul(9.0))).mul(0.22).add(0.9)
    const decay = float(1).sub(s).pow(1.4)

    return tint.mul(decay.add(diamonds)).mul(flicker).mul(80).mul(throttleU).mul(fadeU)
  })()

  material.opacityNode = Fn(() => {
    const s = axialS()
    // Soft gaussian-ish parcel: no edge anywhere on it, which is the whole
    // point — a quad with a hard rim reads as a quad however bright it is.
    const radius = uv().sub(vec2(0.5)).length().mul(2)
    const soft = float(1).sub(smoothstep(0.0, 1.0, radius)).pow(1.8)
    // Born inside the bells, gone by the tail. Thins as it expands, so the far
    // plume is translucent even where parcels still overlap heavily.
    const born = smoothstep(0.0, 0.05, s)
    const gone = float(1).sub(smoothstep(0.45, 1.0, s))
    const thin = mix(float(1), float(0.30), s)
    return soft.mul(born).mul(gone).mul(thin).mul(throttleU).mul(fadeU).mul(0.55)
  })()

  material.transparent = true
  material.depthWrite = false
  material.blending = AdditiveBlending
  // Keep the exhaust out of the GTAO normal buffer — it is light, not surface.
  material.mrtNode = mrt({ normal: vec4(0) })

  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, COUNT)
  const identity = new Matrix4()
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, identity)
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = 'starship:plume'
  mesh.castShadow = false
  mesh.receiveShadow = false
  // Everything is placed in the vertex stage, so the CPU cannot know where the
  // parcels are; a sphere big enough to hold the fully bloomed plume stands in.
  mesh.frustumCulled = false
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, -clusterRadius * LENGTH_RATIO * 0.5), clusterRadius * LENGTH_RATIO * 2)
  mesh.renderOrder = 18
  mesh.visible = false
  markParticle(mesh)

  return {
    mesh,
    update(throttle: number, engines: number, expansion: number, fade: number): void {
      throttleU.value = throttle
      fadeU.value = fade
      const lit = throttle > 0.001 && fade > 0.001
      mesh.visible = lit
      if (!lit) return

      // Fewer bells is a narrower root, and the plume shortens with throttle.
      // 33 → 13 → 3 is why the exhaust visibly steps down twice on the way in.
      spreadU.value = Math.sqrt(Math.max(engines, 1) / 33)
      flareU.value = 1 + expansion * 1.9
      lengthU.value = clusterRadius * LENGTH_RATIO * (0.45 + 0.55 * throttle) * (1 + expansion * 1.25)
    },
    dispose(): void {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
