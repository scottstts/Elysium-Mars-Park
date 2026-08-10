import { BufferAttribute, BufferGeometry, Group, Mesh, Vector2, Vector3 } from 'three'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { createRegolithMaterial } from './groundMaterials'
import { buildGroundScatter } from './groundScatter'
import { groundGrade } from './interiorHeight'
import { GARDENS, PATHS } from './parkPlan'
import { buildPaving } from './paving'
import { pavedSignedDistance } from './pavingPlan'

/**
 * The park floor. Two surfaces, one datum stack:
 *
 *  - REGOLITH: a polar mesh over the whole footprint carrying the graded
 *    relief, with per-vertex masks for desire-line compaction, the raked
 *    garden zones, and distance to the nearest paving (the dust berm that
 *    banks against every curb). Material: `createRegolithMaterial`.
 *  - PAVING: the modelled civic floor — plaza, boulevard, spokes, aprons,
 *    curbs, planters, floor lights, tram channel. Built by `paving.ts`.
 *
 * Colliders: the regolith and the paved lift are both in the physics
 * heightfield (they are `interiorHeight`); only the planter walls need real
 * boxes, which is why this system now takes the physics world.
 */
export class GroundworksSystem implements GameSystem {
  readonly id = 'groundworks'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem | null

  constructor(physics: PhysicsSystem | null = null) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    const floor = new Mesh(buildFloorGeometry(), createRegolithMaterial())
    floor.name = 'ground:regolith'
    floor.receiveShadow = true
    floor.castShadow = false
    this.group.add(floor)

    const paving = buildPaving()
    this.group.add(paving.group)

    const scatter = buildGroundScatter(ctx.rng.fork('ground-scatter'))
    for (const mesh of scatter.meshes) this.group.add(mesh)

    ctx.scene.add(this.group)

    const world = this.physics?.world
    const api = this.physics?.api
    if (world && api && paving.colliders.length > 0) {
      const body = world.createRigidBody(api.RigidBodyDesc.fixed())
      for (const spec of paving.colliders) {
        world.createCollider(
          api.ColliderDesc.cuboid(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2)
            .setTranslation(spec.center.x, spec.center.y, spec.center.z)
            .setRotation({ x: 0, y: Math.sin(spec.yaw / 2), z: 0, w: Math.cos(spec.yaw / 2) }),
          body,
        )
      }
    }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

/** Polar regolith grid, r ≤ 132, with the shading masks baked per vertex. */
function buildFloorGeometry(): BufferGeometry {
  const angularSegments = 640
  const radialSegments = 152
  const outerRadius = 132
  const vertexCount = (angularSegments + 1) * (radialSegments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const wear = new Float32Array(vertexCount)
  const garden = new Float32Array(vertexCount)
  const paved = new Float32Array(vertexCount)
  const normal = new Vector3()
  const probe = new Vector2()
  // Forward differences at 0.6 m: fine enough for the 4.4 m relief band,
  // coarse enough not to alias the per-vertex clast noise into the normal
  // (the material owns everything below a metre).
  const eps = 0.6
  let vertex = 0
  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex++) {
    // The innermost ring sits at r > 0. A polar grid that starts at the pole
    // collapses its first quad row into `angularSegments` zero-area triangles
    // (the geometry audit's `degenerate` check catches exactly this); the
    // 0.43 m hole it leaves is under the First Tree's soil ring and the plaza
    // slab, so nothing can ever see it.
    const r = (outerRadius * (radialIndex + 0.5)) / (radialSegments + 0.5)
    for (let angularIndex = 0; angularIndex <= angularSegments; angularIndex++) {
      const angle = (angularIndex / angularSegments) * Math.PI * 2
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const y = groundGrade(x, z)
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = y
      positions[vertex * 3 + 2] = z
      const dx = groundGrade(x + eps, z) - y
      const dz = groundGrade(x, z + eps) - y
      normal.set(-dx / eps, 1, -dz / eps).normalize()
      normals[vertex * 3] = normal.x
      normals[vertex * 3 + 1] = normal.y
      normals[vertex * 3 + 2] = normal.z

      probe.set(x, z)
      wear[vertex] = pathWear(probe)
      garden[vertex] = gardenMask(probe)
      paved[vertex] = Math.min(6, Math.max(0, pavedSignedDistance(x, z)))
      vertex++
    }
  }
  const indices = new Uint32Array(angularSegments * radialSegments * 6)
  const stride = angularSegments + 1
  let cursor = 0
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex++) {
    for (let angularIndex = 0; angularIndex < angularSegments; angularIndex++) {
      const a = radialIndex * stride + angularIndex
      const b = a + 1
      const c = a + stride
      const d = c + 1
      // Winding faces UP for this loop's angular direction — the (a,c,b)
      // order faced down and the whole floor was back-face culled; what
      // looked like pale ground was the sky dome's below-horizon glow seen
      // through the culled mesh (the exterior agent hit and documented the
      // identical bug in its polar grid).
      indices[cursor++] = a
      indices[cursor++] = b
      indices[cursor++] = c
      indices[cursor++] = b
      indices[cursor++] = d
      indices[cursor++] = c
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('wear', new BufferAttribute(wear, 1))
  geometry.setAttribute('garden', new BufferAttribute(garden, 1))
  geometry.setAttribute('paved', new BufferAttribute(paved, 1))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/**
 * Desire-line compaction. Paved spokes only bruise their fringe; the 'track'
 * service routes are NOT a separate slab any more — compacted fines are a
 * regolith wear state, which is what they physically are.
 */
function pathWear(point: Vector2): number {
  let strongest = 0
  for (const path of PATHS) {
    const paved = path.surface === 'paver'
    const reach = path.width * 0.5 + (paved ? 4.2 : 1.6)
    const weight = paved ? 0.5 : 1
    for (let i = 0; i < path.points.length - 1; i++) {
      const d = segmentDistance(point, path.points[i], path.points[i + 1])
      if (d < reach) strongest = Math.max(strongest, (1 - d / reach) * weight)
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
