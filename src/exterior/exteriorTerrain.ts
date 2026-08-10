import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { RenderPipelineSystem } from '../render/pipeline'
import { applyMarsAerialPerspective } from './marsAerialPerspective'
import { MESA_SITES, exteriorHeight } from './terrainHeight'

/**
 * Everything beyond the glass (plan §5): view-only terrain rings to ~11 km,
 * hero mesa meshes west, boulder scatter, two drifting dust devils, and the
 * screen-space Mars aerial medium wired into the pipeline. No colliders —
 * the dome wall is the physical boundary.
 */
export class ExteriorSystem implements GameSystem {
  readonly id = 'exterior'
  private readonly group = new Group()
  private readonly simTime = uniform(0)
  private readonly devils: Mesh[] = []
  private readonly devilSeeds: { baseX: number; baseZ: number; span: number; speed: number }[] = []
  private readonly pipeline: RenderPipelineSystem

  constructor(pipeline: RenderPipelineSystem) {
    this.pipeline = pipeline
  }

  init(ctx: GameContext): void {
    const { scene, camera, quality } = ctx

    // ---- Aerial medium: one continuous dust atmosphere, screen-space.
    const projectionInverse = uniform(camera.projectionMatrixInverse)
    this.pipeline.hdrTransform = (hdrColor, extras) => {
      const input = hdrColor as Node<'vec4'>
      const { color, amount } = applyMarsAerialPerspective(
        input.rgb,
        extras.viewZNode as Node<'float'>,
        extras.sceneDepthNode as Node<'float'>,
        projectionInverse as unknown as Node<'mat4'>,
      )
      // ?pass=haze: raw fog amount (red = negative, green = 0..1 scale).
      this.pipeline.debugNodes.haze = vec4(
        (amount as unknown as ReturnType<typeof float>).negate().max(0).mul(4),
        (amount as unknown as ReturnType<typeof float>).max(0),
        0,
        1,
      )
      return vec4(color, input.a)
    }

    // ---- Shared regolith material.
    const regolith = createRegolithMaterial()

    // ---- Terrain rings (finer near the glass, coarser to the horizon).
    const rings: Array<[number, number, number, number]> = [
      [252, 1300, 256, 96],
      [1300, 4600, 256, 72],
      [4600, 11200, 224, 56],
    ]
    for (const [inner, outer, angular, radial] of rings) {
      const mesh = new Mesh(buildRingGeometry(inner, outer, angular, radial), regolith)
      mesh.receiveShadow = false
      mesh.castShadow = false
      this.group.add(mesh)
    }

    // ---- Hero mesas (silhouettes matter; ring sampling is too coarse there).
    const mesaMaterial = createMesaMaterial()
    for (const site of MESA_SITES) {
      const mesa = new Mesh(buildMesaGeometry(site), mesaMaterial)
      mesa.position.set(site.x, 0, site.z)
      this.group.add(mesa)
    }

    // ---- Boulder scatter: three sculpted variants, instanced.
    const rng = ctx.rng.fork('exterior/boulders')
    const boulderCount = Math.round(2400 * quality.params.scatterDensity)
    const variants = [0, 1, 2].map((v) => deformedRock(1 + v))
    const rockMaterial = createRockMaterial()
    const perVariant = Math.ceil(boulderCount / variants.length)
    const matrix = new Matrix4()
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const axis = new Vector3()
    for (const variantGeometry of variants) {
      const instanced = new InstancedMesh(variantGeometry, rockMaterial, perVariant)
      for (let i = 0; i < perVariant; i++) {
        // Denser near the dome, thinning outward; keep the south tram
        // corridor clear (the connector tube runs due south, S9).
        let x: number
        let z: number
        for (;;) {
          const t = rng.float()
          const r = 300 + 1350 * t * t
          const angle = rng.float() * Math.PI * 2
          x = Math.cos(angle) * r
          z = Math.sin(angle) * r
          if (!(Math.abs(x) < 40 && z > 240 && z < 1000)) break
        }
        const s = 0.38 + rng.float() * rng.float() * 2.5
        position.set(x, exteriorHeight(x, z) - s * 0.32, z)
        axis.set(rng.float() - 0.5, rng.float() - 0.5, rng.float() - 0.5).normalize()
        rotation.setFromAxisAngle(axis, rng.float() * Math.PI * 2)
        scale.set(s * (0.8 + rng.float() * 0.5), s * (0.65 + rng.float() * 0.5), s)
        matrix.compose(position, rotation, scale)
        instanced.setMatrixAt(i, matrix)
      }
      instanced.instanceMatrix.needsUpdate = true
      this.group.add(instanced)
    }

    // ---- Dust devils: the plain's only weather, far west, drifting.
    const devilGeometry = new CylinderGeometry(34, 11, 880, 24, 32, true)
    const devilSites = [
      { baseX: -5600, baseZ: -400, span: 2600, speed: 4.2 },
      { baseX: -7200, baseZ: -2100, span: 3400, speed: 3.1 },
    ]
    for (let i = 0; i < devilSites.length; i++) {
      const material = new MeshBasicNodeMaterial()
      material.transparent = true
      material.depthWrite = false
      material.side = DoubleSide
      material.colorNode = vec3(0.5, 0.345, 0.215).mul(1.15)
      const swirl = mx_noise_float(
        vec2(
          uv().x.mul(3).add(float(i * 3.7)).add(this.simTime.mul(0.03)),
          uv().y.mul(5.5).sub(this.simTime.mul(0.11)),
        ),
      )
      // Dense skirt, wispy crown — and contrasty noise so it reads as
      // whirling dust instead of a translucent tower.
      const column = smoothstep(0.0, 0.09, uv().y).mul(
        smoothstep(1.0, 0.22, uv().y).pow(1.7),
      )
      const swirl01 = swirl.mul(0.5).add(0.5)
      material.opacityNode = swirl01.pow(1.9).mul(column).mul(0.3)
      const devil = new Mesh(devilGeometry, material)
      this.devils.push(devil)
      this.devilSeeds.push(devilSites[i])
      this.group.add(devil)
    }

    scene.add(this.group)
  }

  update(ctx: GameContext): void {
    this.simTime.value = ctx.time.sim
    for (let i = 0; i < this.devils.length; i++) {
      const devil = this.devils[i]
      const seed = this.devilSeeds[i]
      const travel = (ctx.time.sim * seed.speed + i * 900) % seed.span
      const x = seed.baseX + travel
      const z = seed.baseZ + Math.sin(travel * 0.002 + i) * 260
      devil.position.set(x, exteriorHeight(x, z) + 430, z)
      devil.rotation.y = ctx.time.sim * (0.5 + i * 0.2)
    }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

/** Polar ring grid sampled from the exterior height function. */
function buildRingGeometry(
  inner: number,
  outer: number,
  angularSegments: number,
  radialSegments: number,
): BufferGeometry {
  const vertexCount = (angularSegments + 1) * (radialSegments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  let vertex = 0
  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
    // Slight outward bias keeps detail near the dome where scrutiny is high.
    const t = radialIndex / radialSegments
    const r = inner + (outer - inner) * t * t * (3 - 2 * t)
    for (let angularIndex = 0; angularIndex <= angularSegments; angularIndex++) {
      const angle = (angularIndex / angularSegments) * Math.PI * 2
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const y = exteriorHeight(x, z)
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = y
      positions[vertex * 3 + 2] = z
      const eps = Math.max(2, r * 0.004)
      const dx = exteriorHeight(x + eps, z) - exteriorHeight(x - eps, z)
      const dz = exteriorHeight(x, z + eps) - exteriorHeight(x, z - eps)
      const normal = new Vector3(-dx / (2 * eps), 1, -dz / (2 * eps)).normalize()
      normals[vertex * 3] = normal.x
      normals[vertex * 3 + 1] = normal.y
      normals[vertex * 3 + 2] = normal.z
      uvs[vertex * 2] = x
      uvs[vertex * 2 + 1] = z
      vertex++
    }
  }
  const indices: number[] = []
  const stride = angularSegments + 1
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
    for (let angularIndex = 0; angularIndex < angularSegments; angularIndex++) {
      const a = radialIndex * stride + angularIndex
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/** Flat-cap mesa with an irregular plan, cliff band, and talus skirt. */
function buildMesaGeometry(site: { footprint: number; capHeight: number; x: number; z: number }): BufferGeometry {
  const angularSegments = 96
  const radialSegments = 42
  const vertexCount = (angularSegments + 1) * (radialSegments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const centerHeight = exteriorHeight(site.x, site.z)
  let vertex = 0
  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
    const t = radialIndex / radialSegments
    for (let angularIndex = 0; angularIndex <= angularSegments; angularIndex++) {
      const angle = (angularIndex / angularSegments) * Math.PI * 2
      // Irregular plan silhouette per angle (stable across the two seam rows).
      const seamSafe = angularIndex % angularSegments
      const wobble =
        1 +
        0.24 * Math.sin(seamSafe * 0.41 + site.x * 0.01) +
        0.12 * Math.sin(seamSafe * 1.13 + site.z * 0.013) +
        0.055 * Math.sin(seamSafe * 2.71 + site.x * 0.02)
      // Cliff-band rows get extra radial jitter: rugged rock, not pudding.
      const cliffJitter =
        t > 0.44 && t < 0.62 ? 0.035 * Math.sin(seamSafe * 3.7 + t * 41) : 0
      const radius = site.footprint * 2.2 * t * (wobble + cliffJitter)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      // Profile: plateau → hard rim lip → steep cliff → long talus.
      let profile: number
      if (t < 0.44) {
        profile = 1 + 0.02 * Math.sin(seamSafe * 0.9)
      } else if (t < 0.58) {
        const cliffT = (t - 0.44) / 0.14
        profile = 1 - Math.pow(cliffT, 1.35) * 0.82
      } else {
        const talusT = (t - 0.58) / 0.42
        profile = 0.18 * (1 - smoothCpu(talusT))
      }
      const worldX = site.x + x
      const worldZ = site.z + z
      const edgeBlend = smoothCpu(Math.min(1, Math.max(0, (t - 0.75) / 0.25)))
      const y =
        (1 - edgeBlend) * (centerHeight + profile * site.capHeight) +
        edgeBlend * exteriorHeight(worldX, worldZ)
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = y
      positions[vertex * 3 + 2] = z
      uvs[vertex * 2] = worldX
      uvs[vertex * 2 + 1] = worldZ
      vertex++
    }
  }
  const indices: number[] = []
  const stride = angularSegments + 1
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
    for (let angularIndex = 0; angularIndex < angularSegments; angularIndex++) {
      const a = radialIndex * stride + angularIndex
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function smoothCpu(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Icosahedron pushed around by lattice hashes — reads as fractured basalt. */
function deformedRock(seed: number): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 2)
  const positionAttribute = geometry.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < positionAttribute.count; i++) {
    v.fromBufferAttribute(positionAttribute, i)
    const n =
      Math.sin(v.x * 3.1 + seed * 11.7) * 0.16 +
      Math.sin(v.y * 4.7 + seed * 5.3) * 0.13 +
      Math.sin(v.z * 3.9 + seed * 7.9) * 0.14
    v.multiplyScalar(1 + n)
    positionAttribute.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

function createRegolithMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const worldXZ = vec2(positionWorld.x, positionWorld.z)
  const macro = mx_noise_float(worldXZ.mul(1 / 210)).mul(0.5).add(0.5)
  const patches = mx_noise_float(worldXZ.mul(1 / 46).add(31.7)).mul(0.5).add(0.5)
  const fine = mx_noise_float(worldXZ.mul(1 / 6.5).add(77.7)).mul(0.5).add(0.5)
  const base = vec3(0.315, 0.196, 0.124)
  const dustLight = vec3(0.45, 0.293, 0.178)
  const basaltDark = vec3(0.165, 0.118, 0.088)
  let color = mix(base, dustLight, macro.mul(0.55).add(patches.mul(0.25)))
  // Slopes shed dust and expose darker rock.
  const slope = float(1).sub(normalWorld.y.clamp(0, 1))
  color = mix(color, basaltDark, smoothstep(0.12, 0.42, slope).mul(0.7))
  color = mix(color, color.mul(0.88), fine.mul(0.5))
  material.colorNode = color
  material.roughnessNode = float(0.94).sub(fine.mul(0.06))
  material.metalness = 0
  return material
}

function createMesaMaterial(): MeshStandardNodeMaterial {
  const material = createRegolithMaterial()
  // Horizontal strata bands on steep faces only.
  const strata = mx_noise_float(vec2(positionWorld.y.mul(1 / 7.5), positionWorld.x.mul(0.002)))
    .mul(0.5)
    .add(0.5)
  const steep = smoothstep(0.55, 0.85, float(1).sub(normalWorld.y.clamp(0, 1)))
  const bandTint = mix(vec3(1), vec3(0.82, 0.72, 0.62), strata)
  material.colorNode = (material.colorNode as Node<'vec3'>).mul(mix(vec3(1), bandTint, steep))
  return material
}

function createRockMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const dustTop = smoothstep(0.35, 0.85, normalWorld.y)
  const grain = mx_noise_float(positionWorld.xz.mul(0.8)).mul(0.5).add(0.5)
  material.colorNode = mix(
    vec3(0.14, 0.104, 0.082),
    vec3(0.38, 0.25, 0.157),
    dustTop.mul(0.75).add(grain.mul(0.1)),
  )
  material.roughnessNode = float(0.92)
  return material
}
