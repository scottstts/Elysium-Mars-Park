import { InstancedMesh, Matrix4, PlaneGeometry, Sphere, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn, cameraProjectionMatrix, cameraPosition, cameraViewMatrix, float, instanceIndex, max, mix, mrt,
  modelWorldMatrix, mx_noise_float, normalize, positionGeometry, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import { markParticle } from '../render/layers'
import { ENVIRONMENT_INTENSITY, SUN_LIGHT_INTENSITY, sunColorUniform, sunDirectionUniform } from '../sky/sun'
import { marsAmbientIrradiance } from '../sky/skyRadiance'

/**
 * WHAT THE EXHAUST DOES TO THE PAD.
 *
 * 33 Raptors into a mount with a 4.86 m throat, over graded Martian regolith.
 * Two things happen and both are visible from the park:
 *
 *  1. A radial SHEET. The flow hits the deck, turns, and leaves sideways under
 *     the mount at close to its exit speed. In 600 Pa there is almost nothing
 *     to slow it, so the sheet outruns anything on Earth — it crosses the
 *     68 m slab in a couple of seconds — and then simply keeps going, thinning.
 *  2. A COLUMN that lifts off the ring once the sheet stalls, and hangs. Mars
 *     dust is microns; with a tenth of the gravity and no rain, what goes up
 *     stays up for minutes. So the plume ends, and the cloud does not.
 *
 * The whole thing is ONE draw of instanced quads with no CPU-side particle
 * state: every instance derives its own position from `instanceIndex`, a hash,
 * and two uniforms (blast strength and the seconds since it started). That
 * matters here because the pad is 215 m away and usually off screen — a
 * per-frame CPU loop over a thousand particles would be paid whether or not
 * anybody was looking.
 *
 * `markParticle` is not optional: a camera-facing quad rasterises as its full
 * RECTANGLE in any depth or shadow pass, and a thousand of them under a
 * shadow-casting sun would paint a moving grey slab across the valley (the
 * project's own documented defect class, from the greenhouse spray).
 */

const COUNT = 900
/** Seconds of life for a sheet particle, and for a column particle. */
const SHEET_LIFE = 7.5
const COLUMN_LIFE = 26
/** Fraction of the instances that are sheet rather than column. */
const SHEET_SHARE = 0.55

export interface StarshipPadBlast {
  mesh: InstancedMesh
  /**
   * @param strength 0…1 how hard the pad is being hit right now.
   * @param elapsed seconds since the current blast started; particles age off it.
   */
  update(strength: number, elapsed: number): void
  dispose(): void
}

/**
 * @param center world position on the concrete raft under the mount's throat —
 *   NOT the deck. The vehicle stands 19 m up on the launch table and the flow
 *   falls through the table's 4.86 m hole before it turns, so the sheet leaves
 *   at raft level and the cloud is seen boiling out from UNDER the table.
 * @param skirtRadius how far out the flow is already spread when it emerges,
 *   i.e. roughly the mount's leg circle. Emitting from a point would put the
 *   cloud's origin inside the launch table instead of around it.
 */
export function createStarshipPadBlast(center: Vector3, skirtRadius: number): StarshipPadBlast {
  const strengthU = uniform(0)
  const elapsedU = uniform(0)
  const skirtU = uniform(skirtRadius)

  const material = new MeshBasicNodeMaterial()

  /** Per-instance constants, all derived rather than stored. */
  const seed = Fn(() => {
    const i = float(instanceIndex)
    const a = i.mul(0.6180339887).fract()
    const b = i.mul(0.7548776662).fract()
    const c = i.mul(0.9101090193).fract()
    return vec3(a, b, c)
  })

  /**
   * Position and size of this instance, in the blast's own frame. Kept as one
   * function because the vertex stage needs the position and the fragment
   * stage needs the age, and deriving both twice is cheaper than an attribute.
   */
  const parcel = Fn(() => {
    const s = seed().toVar()
    const isSheet = s.x.lessThan(float(SHEET_SHARE)).select(float(1), float(0)).toVar()
    const life = mix(float(COLUMN_LIFE), float(SHEET_LIFE), isSheet).toVar()

    // Stagger births across the first part of the life so the cloud builds
    // rather than appearing whole, and recycle on a per-instance period.
    const birth = s.y.mul(life).mul(0.55)
    const age = elapsedU.sub(birth).toVar()

    const azimuth = s.z.mul(Math.PI * 2).toVar()
    const dir = vec3(azimuth.cos(), 0, azimuth.sin()).toVar()

    // SHEET: launched radially, decelerating as it entrains still air, and
    // lofting slowly as it goes. COLUMN: slower out, much faster up, and it
    // keeps rising for its whole life because nothing brings it back down.
    const outSpeed = mix(float(9), float(52), isSheet).mul(s.y.mul(0.55).add(0.6))
    const upSpeed = mix(float(7.5), float(1.6), isSheet).mul(s.x.mul(0.8).add(0.5))
    // Radial travel with drag: r = v·τ·(1 − e^(−t/τ)) — the sheet's headlong
    // rush that then stalls, rather than a straight ramp that never stops.
    const tau = mix(float(4.5), float(2.2), isSheet)
    const radial = outSpeed.mul(tau).mul(float(1).sub(age.div(tau).negate().exp()))
    const rise = upSpeed.mul(age).mul(age.mul(0.06).add(1).reciprocal())

    const drift = mx_noise_float(vec3(s.xy.mul(11.3), age.mul(0.12))).mul(age.mul(0.6))
    // Start spread around the table's leg circle, not at a point under it.
    const start = skirtU.mul(s.y.mul(0.45).add(0.55))
    const pos = dir.mul(start.add(radial).add(drift))
    // Every particle starts on the raft and only ever rises from it.
    const y = rise.add(isSheet.oneMinus().mul(1.5))

    const grow = age.mul(mix(float(1.5), float(3.4), isSheet)).add(3.5)
    return vec4(pos.x, y, pos.z, grow).toVar()
  })

  const ageOf = Fn(() => {
    const s = seed()
    const isSheet = s.x.lessThan(float(SHEET_SHARE)).select(float(1), float(0))
    const life = mix(float(COLUMN_LIFE), float(SHEET_LIFE), isSheet)
    const birth = s.y.mul(life).mul(0.55)
    return vec2(elapsedU.sub(birth), life)
  })

  material.vertexNode = Fn(() => {
    const p = parcel()
    const world = modelWorldMatrix.mul(vec4(p.xyz, 1))
    const view = cameraViewMatrix.mul(world)
    // Screen-aligned: dust has no orientation and the camera never gets close
    // enough for a spherical billboard's rotation to read.
    // PlaneGeometry(1, 1) spans ±0.5, so this makes the quad `p.w` across.
    const offset = positionGeometry.xy.mul(p.w)
    return cameraProjectionMatrix.mul(vec4(view.x.add(offset.x), view.y.add(offset.y), view.z, view.w))
  })()

  material.colorNode = Fn(() => {
    const p = parcel()
    const worldPos = modelWorldMatrix.mul(vec4(p.xyz, 1)).xyz
    const toEye = normalize(worldPos.sub(cameraPosition))
    // Regolith dust is strongly forward-scattering, which is why a backlit
    // launch cloud is the brightest thing in the frame and a front-lit one is
    // a flat brown smudge. The stack is 49° off the sightline and backlit.
    const forward = max(toEye.dot(sunDirectionUniform), 0)
    const phase = forward.pow(2.6).mul(1.35).add(0.45)
    const lit = sunColorUniform.mul(SUN_LIGHT_INTENSITY / Math.PI).mul(phase)
      .add(marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY * 1.6))
    // Fresh ejecta is darker than the weathered surface it came from.
    const age = ageOf()
    const settled = smoothstep(0, age.y.mul(0.5), age.x)
    return mix(vec3(0.30, 0.20, 0.14), vec3(0.55, 0.40, 0.29), settled).mul(lit)
  })()

  material.opacityNode = Fn(() => {
    const age = ageOf().toVar()
    const t = age.x.div(age.y)
    // A soft round puff, and a lifetime that fades in fast and out slowly.
    const radius = uv().sub(vec2(0.5)).length().mul(2)
    const puff = float(1).sub(smoothstep(0.25, 1.0, radius))
    const born = smoothstep(0, 0.06, t)
    const gone = float(1).sub(smoothstep(0.45, 1.0, t))
    const alive = t.greaterThanEqual(0).select(float(1), float(0))
    return puff.mul(born).mul(gone).mul(alive).mul(strengthU).mul(0.26)
  })()

  material.transparent = true
  material.depthWrite = false
  material.mrtNode = mrt({ normal: vec4(0) })

  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, COUNT)
  const identity = new Matrix4()
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, identity)
  mesh.instanceMatrix.needsUpdate = true
  mesh.name = 'starship:pad-blast'
  mesh.position.copy(center)
  mesh.castShadow = false
  mesh.receiveShadow = false
  // Everything is placed in the vertex stage, so the CPU has no idea where the
  // cloud is; a bounding sphere big enough to hold it stands in for culling.
  mesh.frustumCulled = false
  mesh.boundingSphere = new Sphere(new Vector3(), 400)
  mesh.renderOrder = 14
  mesh.visible = false
  markParticle(mesh)

  return {
    mesh,
    update(strength: number, elapsed: number): void {
      strengthU.value = strength
      elapsedU.value = elapsed
      mesh.visible = strength > 0.002
    },
    dispose(): void {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
