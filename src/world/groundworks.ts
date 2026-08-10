import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector2,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  attribute,
  float,
  floor,
  fract,
  hash,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from './interiorHeight'
import { GARDENS, PATHS } from './parkPlan'
import type { PathSpec } from './parkPlan'

/**
 * The park floor (plan §7): polar floor mesh with baked wear/garden vertex
 * masks, hero regolith material carrying the lattice shadow net, sintered
 * paver path ribbons with steel curbs, and interior boulders. Colliders for
 * all of it live in physicsWorld (S5/S6).
 */
export class GroundworksSystem implements GameSystem {
  readonly id = 'groundworks'
  private readonly group = new Group()

  init(ctx: GameContext): void {
    const floor = new Mesh(buildFloorGeometry(), createInteriorRegolithMaterial())
    floor.receiveShadow = true
    this.group.add(floor)

    const paverMaterial = createPaverMaterial()
    const trackMaterial = createTrackMaterial()
    const curbSpecs: CurbSpec[] = []
    for (const path of PATHS) {
      const ribbon = buildPathRibbon(path, curbSpecs)
      const mesh = new Mesh(ribbon, path.surface === 'paver' ? paverMaterial : trackMaterial)
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
    this.group.add(buildCurbs(curbSpecs))

    ctx.scene.add(this.group)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

/** Polar floor grid, r ≤ 250, with wear + garden masks baked per vertex. */
function buildFloorGeometry(): BufferGeometry {
  const angularSegments = 440
  const radialSegments = 150
  const vertexCount = (angularSegments + 1) * (radialSegments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const wear = new Float32Array(vertexCount)
  const garden = new Float32Array(vertexCount)
  const normal = new Vector3()
  const probe = new Vector2()
  let vertex = 0
  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
    const t = radialIndex / radialSegments
    const r = 250 * Math.sqrt(t) // denser toward the rim? sqrt densifies center
    for (let angularIndex = 0; angularIndex <= angularSegments; angularIndex++) {
      const angle = (angularIndex / angularSegments) * Math.PI * 2
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const y = interiorHeight(x, z)
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = y
      positions[vertex * 3 + 2] = z
      const eps = 0.8
      const dx = interiorHeight(x + eps, z) - interiorHeight(x - eps, z)
      const dz = interiorHeight(x, z + eps) - interiorHeight(x, z - eps)
      normal.set(-dx / (2 * eps), 1, -dz / (2 * eps)).normalize()
      normals[vertex * 3] = normal.x
      normals[vertex * 3 + 1] = normal.y
      normals[vertex * 3 + 2] = normal.z

      probe.set(x, z)
      wear[vertex] = pathWear(probe)
      garden[vertex] = gardenMask(probe)
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
  geometry.setAttribute('wear', new BufferAttribute(wear, 1))
  geometry.setAttribute('garden', new BufferAttribute(garden, 1))
  geometry.setIndex(indices)
  return geometry
}

/** Compacted-desire-line strength: how close this point is to any path. */
function pathWear(point: Vector2): number {
  let strongest = 0
  for (const path of PATHS) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const d = segmentDistance(point, path.points[i], path.points[i + 1])
      const reach = path.width * 0.5 + 5.5
      if (d < reach) {
        strongest = Math.max(strongest, 1 - d / reach)
      }
    }
  }
  return Math.min(1, strongest * 1.15)
}

function gardenMask(point: Vector2): number {
  let strongest = 0
  for (const zone of GARDENS) {
    const d = Math.hypot(point.x - zone.x, point.y - zone.z)
    if (d < zone.radius) {
      strongest = Math.max(strongest, smoothCpu(1 - d / zone.radius))
    }
  }
  return strongest
}

function smoothCpu(t: number): number {
  return t * t * (3 - 2 * t)
}

function segmentDistance(p: Vector2, a: Vector2, b: Vector2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared))
  const cx = a.x + abx * t
  const cy = a.y + aby * t
  return Math.hypot(p.x - cx, p.y - cy)
}

/**
 * Interior regolith — the hero ground material. Wear compacts and darkens
 * along desire lines; garden zones get raked concentric ridges (bump via
 * noise derivative); everything receives the lattice net.
 */
function createInteriorRegolithMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const worldXZ = vec2(positionWorld.x, positionWorld.z)
  const wearAmount = attribute('wear', 'float') as unknown as Node<'float'>
  const gardenAmount = attribute('garden', 'float') as unknown as Node<'float'>

  const macro = mx_noise_float(worldXZ.mul(1 / 74)).mul(0.5).add(0.5)
  const mid = mx_noise_float(worldXZ.mul(1 / 13.5).add(11.3)).mul(0.5).add(0.5)
  const fine = mx_noise_float(worldXZ.mul(1 / 1.7).add(47.1)).mul(0.5).add(0.5)
  const grit = mx_noise_float(worldXZ.mul(2.9).add(83.7)).mul(0.5).add(0.5)

  const loose = vec3(0.335, 0.213, 0.135)
  const lighter = vec3(0.415, 0.272, 0.168)
  const compacted = vec3(0.246, 0.158, 0.104)

  let color = mix(loose, lighter, macro.mul(0.5).add(mid.mul(0.3)))
  color = mix(color, color.mul(0.9), fine.mul(0.55))
  color = mix(color, compacted, smoothstep(0.25, 0.95, wearAmount))

  // Raked ridges: concentric rings around each garden's center — a Martian
  // dry garden. Pattern lives in both albedo (dust shading) and bump.
  const gardenRings = (): Node<'float'> => {
    let pattern = float(0) as unknown as Node<'float'>
    for (const zone of GARDENS) {
      const d = worldXZ.sub(vec2(zone.x, zone.z)).length()
      // 1.9 m pitch: fine 0.85 m furrows vanish under grading + haze from
      // eye height — the rake must read as ground ART, not micro-texture.
      const ring = d.mul(Math.PI * 2 * (1 / 1.9))
      const wave = ring.sin().mul(0.5).add(0.5)
      pattern = pattern.max(wave as unknown as Node<'float'>)
    }
    return pattern
  }
  const rake = gardenRings()
  // NOTE: reversed-edge smoothstep is a WGSL hazard (see notes.md, lattice
  // lesson) — invert a forward smoothstep instead.
  const rakeInfluence = gardenAmount.mul(
    float(1).sub(smoothstep(0.35, 0.9, wearAmount)),
  )
  color = mix(color, color.mul(mix(0.78, 1.16, rake)), rakeInfluence.mul(0.85))

  material.colorNode = color
  material.roughnessNode = float(0.97)
    .sub(smoothstep(0.3, 1, wearAmount).mul(0.13))
    .sub(grit.mul(0.03))
    // Rake furrows read in raking light: crests slightly compacted/sheeny.
    .sub(rake.mul(rakeInfluence).mul(0.06))
  return material
}

interface CurbSpec {
  position: Vector3
  quaternion: Quaternion
  length: number
}

/** Catmull-Rom ribbon hugging the terrain with (s, t) UVs for the pavers. */
function buildPathRibbon(path: PathSpec, curbsOut: CurbSpec[]): BufferGeometry {
  const points3 = path.points.map((p) => new Vector3(p.x, 0, p.y))
  const closed = path.points[0].distanceTo(path.points[path.points.length - 1]) < 0.01
  if (closed) points3.pop()
  const curve = new CatmullRomCurve3(points3, closed, 'centripetal', 0.5)
  const length = curve.getLength()
  const segments = Math.max(8, Math.round(length / 1.6))
  const halfWidth = path.width / 2

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const tangent = new Vector3()
  const side = new Vector3()
  const up = new Vector3(0, 1, 0)
  let distance = 0
  let previous: Vector3 | null = null
  const curbEvery = 2.2
  let curbAccumulator = 0

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const center = curve.getPointAt(t)
    curve.getTangentAt(t, tangent)
    side.crossVectors(up, tangent).normalize()
    if (previous) distance += center.distanceTo(previous)
    previous = center.clone()

    for (const s of [-1, 1]) {
      const x = center.x + side.x * halfWidth * s
      const z = center.z + side.z * halfWidth * s
      const y = interiorHeight(x, z) + 0.055
      positions.push(x, y, z)
      normals.push(0, 1, 0)
      uvs.push(distance, s * halfWidth)
    }

    // Curbs march along both edges (skip the compacted 'track' surface).
    curbAccumulator += previous && i > 0 ? center.distanceTo(curve.getPointAt((i - 1) / segments)) : 0
    if (path.surface === 'paver' && curbAccumulator >= curbEvery) {
      curbAccumulator = 0
      for (const s of [-1, 1]) {
        const cx = center.x + side.x * (halfWidth + 0.12) * s
        const cz = center.z + side.z * (halfWidth + 0.12) * s
        const position = new Vector3(cx, interiorHeight(cx, cz) + 0.1, cz)
        const quaternion = new Quaternion().setFromUnitVectors(
          new Vector3(0, 0, 1),
          tangent.clone().setY(0).normalize(),
        )
        curbsOut.push({ position, quaternion, length: curbEvery + 0.05 })
      }
    }
  }

  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c, b, d, c)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  return geometry
}

/** Sintered-regolith pavers: staggered bricks in path-local (s, t) space. */
function createPaverMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const s = uv().x
  const t = uv().y

  const BRICK_LENGTH = 0.92
  const BRICK_WIDTH = 0.46
  const row = floor(t.div(BRICK_WIDTH))
  const stagger = fract(row.mul(0.5)).mul(BRICK_LENGTH)
  const along = s.add(stagger)
  const brickU = fract(along.div(BRICK_LENGTH))
  const brickV = fract(t.div(BRICK_WIDTH))
  const brickId = vec2(floor(along.div(BRICK_LENGTH)), row)

  const mortarU = smoothstep(0.0, 0.045, brickU).mul(smoothstep(1.0, 0.955, brickU))
  const mortarV = smoothstep(0.0, 0.09, brickV).mul(smoothstep(1.0, 0.91, brickV))
  const brickMask = mortarU.mul(mortarV)

  const tone = hash(brickId.x.add(brickId.y.mul(113)))
  const fired = mix(vec3(0.42, 0.253, 0.15), vec3(0.5, 0.322, 0.205), tone)
  const kiln = mx_noise_float(vec2(brickU, brickV).mul(3.5).add(tone.mul(19)))
    .mul(0.5)
    .add(0.5)
  const brickColor = fired.mul(kiln.mul(0.25).add(0.85))
  const mortar = vec3(0.27, 0.185, 0.125)

  material.colorNode = mix(mortar, brickColor, brickMask)
  material.roughnessNode = mix(float(0.95), float(0.78).add(tone.mul(0.1)), brickMask)

  // Bevel shading at brick edges (cheap AO groove).
  const edgeShade = brickMask.mul(0.16).add(0.84)
  material.colorNode = (material.colorNode as Node<'vec3'>).mul(edgeShade)
  return material
}

/** Compacted-fines service track: smooth, plain, slightly darker. */
function createTrackMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const worldXZ = vec2(positionWorld.x, positionWorld.z)
  const fine = mx_noise_float(worldXZ.mul(1 / 2.2).add(9.1)).mul(0.5).add(0.5)
  material.colorNode = mix(vec3(0.252, 0.163, 0.106), vec3(0.29, 0.19, 0.125), fine)
  material.roughnessNode = float(0.9)
  return material
}

/** Steel curbs, instanced along paver edges. */
function buildCurbs(specs: CurbSpec[]): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.36, 0.34, 0.32)
  material.roughnessNode = float(0.55)
  material.metalness = 0.2
  const mesh = new InstancedMesh(geometry, material, specs.length)
  const matrix = new Matrix4()
  const scale = new Vector3()
  for (let i = 0; i < specs.length; i++) {
    scale.set(0.16, 0.2, specs[i].length)
    matrix.compose(specs[i].position, specs[i].quaternion, scale)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.receiveShadow = true
  mesh.castShadow = false
  return mesh
}
