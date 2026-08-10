import {
  AdditiveBlending,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Sprite,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial, SpriteNodeMaterial } from 'three/webgpu'
import { float, mix, positionLocal, sin, smoothstep, time, uniform, uv, vec2, vec3 } from 'three/tsl'
import { PartWriter } from '../archkit/writer'
import { kitMaterials } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from '../world/interiorHeight'
import { FARMSIDE, FIRST_TREE, GARDENS, PATHS } from '../world/parkPlan'
import { buildFirstTree } from './firstTree'
import { cropTexture, sedgeTexture } from './leafTextures'

/**
 * The entire green budget (design canon — sparse, precious): the First
 * Tree with its groundcover collar, eight steel-edged sedge beds, the
 * greenhouse crop trays, and the misting cycle. Nothing green anywhere else.
 */
export class VegetationSystem implements GameSystem {
  readonly id = 'vegetation'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem
  private mist: Sprite[] = []
  private readonly mistLife = uniform(0)

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    const rng = ctx.rng.fork('vegetation')
    const writer = new PartWriter()

    // ---- The First Tree.
    const treeBase = new Vector3(FIRST_TREE.x, 0.55 + 0.5, FIRST_TREE.z)
    const tree = buildFirstTree(treeBase, rng.fork('first-tree'))
    this.group.add(tree.group)
    const world = this.physics.world
    const api = this.physics.api
    if (world && api) {
      const body = world.createRigidBody(api.RigidBodyDesc.fixed())
      world.createCollider(
        api.ColliderDesc.cylinder(tree.collider.halfHeight, tree.collider.radius).setTranslation(
          tree.collider.center.x,
          tree.collider.center.y,
          tree.collider.center.z,
        ),
        body,
      )
    }

    // ---- Sedge tufts: the collar under the tree + the bounded beds.
    const sedgeMaterial = new MeshStandardNodeMaterial()
    sedgeMaterial.map = sedgeTexture()
    sedgeMaterial.alphaTest = 0.32
    sedgeMaterial.side = DoubleSide
    sedgeMaterial.roughness = 0.85
    sedgeMaterial.positionNode = positionLocal.add(
      vec3(
        sin(time.mul(0.7).add(positionLocal.x.mul(5))).mul(positionLocal.y).mul(0.05),
        0,
        sin(time.mul(0.9).add(positionLocal.z.mul(4))).mul(positionLocal.y).mul(0.04),
      ),
    )
    const tuftGeometry = new PlaneGeometry(0.55, 0.55)
    tuftGeometry.translate(0, 0.275, 0)

    const tuftTransforms: Matrix4[] = []
    const placeTuft = (x: number, z: number, y: number, scaleFactor = 1): void => {
      const matrix = new Matrix4()
      const quaternion = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        rng.range(0, Math.PI),
      )
      const scale = new Vector3().setScalar(rng.range(0.6, 1.25) * scaleFactor)
      matrix.compose(new Vector3(x, y, z), quaternion, scale)
      tuftTransforms.push(matrix)
      // Cross-plane for volume.
      const cross = new Matrix4()
      const crossQuaternion = quaternion
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))
      cross.compose(new Vector3(x, y, z), crossQuaternion, scale)
      tuftTransforms.push(cross)
    }

    // Collar under the tree (annulus, denser inward).
    for (let i = 0; i < 120; i++) {
      const angle = rng.range(0, Math.PI * 2)
      const radius = 1.4 + Math.sqrt(rng.float()) * (FIRST_TREE.soilRingRadius - 1.9)
      placeTuft(
        FIRST_TREE.x + Math.cos(angle) * radius,
        FIRST_TREE.z + Math.sin(angle) * radius,
        1.06,
        0.85,
      )
    }

    // Steel-edged beds: four flanking the Meridian, two at the plaza edge,
    // two in the gardens.
    const beds: Array<[number, number, number, number]> = [
      [-8, 130, 4.2, 2.2],
      [9, 96, 3.6, 2.0],
      [-10, 58, 4.0, 2.2],
      [8, 34, 3.2, 1.8],
      [12, -12, 3.4, 2.0],
      [-13, 8, 3.0, 1.8],
      [GARDENS[0].x + 18, GARDENS[0].z + 10, 4.4, 2.4],
      [GARDENS[0].x - 12, GARDENS[0].z - 20, 3.6, 2.0],
    ]
    for (const [bx, bz, bw, bd] of beds) {
      const ground = interiorHeight(bx, bz)
      const yaw = rng.range(0, Math.PI)
      writer.box({
        center: new Vector3(bx, ground + 0.16, bz),
        size: new Vector3(bw + 0.24, 0.32, bd + 0.24),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.02,
      })
      writer.box({
        center: new Vector3(bx, ground + 0.3, bz),
        size: new Vector3(bw, 0.08, bd),
        rotationY: yaw,
        slot: 'soil',
      })
      const count = Math.round(bw * bd * rng.range(1.4, 2.0))
      for (let i = 0; i < count; i++) {
        const lx = rng.range(-bw / 2 + 0.25, bw / 2 - 0.25)
        const lz = rng.range(-bd / 2 + 0.25, bd / 2 - 0.25)
        const cos = Math.cos(yaw)
        const sinYaw = Math.sin(yaw)
        placeTuft(bx + lx * cos + lz * sinYaw, bz - lx * sinYaw + lz * cos, ground + 0.34)
      }
    }

    // ---- Raked furrow ridges: the Regolith Gardens' ground art as REAL
    // geometry (postcard 9). Shader-only rings die under grading + haze;
    // low ridge tubes cast/catch actual raking light. Rings yield to paths
    // and beds — the rake never crosses a walked or planted surface.
    const clearOfPaths = (x: number, z: number): boolean => {
      for (const path of PATHS) {
        for (let i = 0; i < path.points.length - 1; i++) {
          const a = path.points[i]
          const b = path.points[i + 1]
          const abx = b.x - a.x
          const aby = b.y - a.y
          const l2 = abx * abx + aby * aby
          if (l2 === 0) continue
          const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * aby) / l2))
          const dx = x - (a.x + abx * t)
          const dz = z - (a.y + aby * t)
          if (dx * dx + dz * dz < (path.width / 2 + 1.2) ** 2) return false
        }
      }
      for (const [bx, bz, bw, bd] of beds) {
        if (Math.hypot(x - bx, z - bz) < Math.max(bw, bd) / 2 + 1.6) return false
      }
      return true
    }
    for (const zone of GARDENS) {
      for (let ringRadius = 3.2; ringRadius < zone.radius * 0.82; ringRadius += 1.9) {
        const segments = Math.max(48, Math.round(ringRadius * 5))
        let run: Vector3[] = []
        const flush = (): void => {
          if (run.length >= 4) {
            writer.tube({ path: run, radius: 0.055, slot: 'soil', radialSegments: 6, uvScale: 0.4 })
          }
          run = []
        }
        for (let s = 0; s <= segments; s++) {
          const angle = (s / segments) * Math.PI * 2
          const x = zone.x + Math.cos(angle) * ringRadius
          const z = zone.z + Math.sin(angle) * ringRadius
          if (!clearOfPaths(x, z)) {
            flush()
            continue
          }
          run.push(new Vector3(x, interiorHeight(x, z) + 0.03, z))
        }
        flush()
      }
    }

    const tufts = new InstancedMesh(tuftGeometry, sedgeMaterial, tuftTransforms.length)
    tuftTransforms.forEach((matrix, index) => tufts.setMatrixAt(index, matrix))
    tufts.instanceMatrix.needsUpdate = true
    tufts.castShadow = true
    this.group.add(tufts)

    // ---- Greenhouse crops: clumps filling every tray tier.
    const cropMaterial = new MeshStandardNodeMaterial()
    cropMaterial.map = cropTexture()
    cropMaterial.alphaTest = 0.35
    cropMaterial.side = DoubleSide
    cropMaterial.roughness = 0.7
    cropMaterial.positionNode = positionLocal.add(
      vec3(sin(time.mul(1.1).add(positionLocal.x.mul(7))).mul(positionLocal.y).mul(0.02), 0, 0),
    )
    const cropGeometry = new PlaneGeometry(0.4, 0.34)
    cropGeometry.translate(0, 0.17, 0)
    const cropTransforms: Matrix4[] = []
    for (const house of FARMSIDE.glasshouses) {
      const yaw = house.rotation
      const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      const ground = interiorHeight(house.x, house.z)
      for (const rackOffset of [-house.width / 4 + 0.4, 0, house.width / 4 - 0.4]) {
        const rackAcross = rackOffset === 0 ? 0 : rackOffset < 0 ? -house.width * 0.1375 : house.width * 0.1375
        void rackAcross
        for (const tierY of [0.55, 1.15, 1.75]) {
          const rows = Math.floor((house.length - 5) / 0.55)
          for (let i = 0; i < rows; i++) {
            const alongOffset = -house.length / 2 + 2.5 + i * 0.55
            for (const lateral of [-0.28, 0.14]) {
              const position = new Vector3(house.x, 0, house.z)
                .addScaledVector(along, alongOffset + (((i * 7919) % 13) / 13 - 0.5) * 0.2)
                .addScaledVector(across, rackOffset * 2 + lateral)
                .setY(ground + tierY + 0.04)
              const matrix = new Matrix4()
              const quaternion = new Quaternion().setFromAxisAngle(
                new Vector3(0, 1, 0),
                ((i * 2654435761) % 628) / 100,
              )
              const scale = new Vector3().setScalar(0.7 + (((i * 104729) % 17) / 17) * 0.7)
              matrix.compose(position, quaternion, scale)
              cropTransforms.push(matrix)
            }
          }
        }
      }
    }
    const crops = new InstancedMesh(cropGeometry, cropMaterial, cropTransforms.length)
    cropTransforms.forEach((matrix, index) => crops.setMatrixAt(index, matrix))
    crops.instanceMatrix.needsUpdate = true
    this.group.add(crops)

    // ---- Misting sprites in the enterable middle house.
    const midHouse = FARMSIDE.glasshouses[1]
    const midYaw = midHouse.rotation
    const midAlong = new Vector3(Math.sin(midYaw), 0, Math.cos(midYaw))
    const midGround = interiorHeight(midHouse.x, midHouse.z)
    // Nozzle lines run above BOTH crop tiers (misting the plants, not the
    // aisle); puffs must read against the darker trays, not bright glazing.
    const midAcross = new Vector3(midAlong.z, 0, -midAlong.x)
    for (let i = 0; i < 20; i++) {
      const material = new SpriteNodeMaterial()
      material.transparent = true
      material.depthWrite = false
      material.blending = AdditiveBlending
      const seed = (i * 0.37) % 1
      const life = this.mistLife.add(seed).fract()
      material.colorNode = mix(vec3(0.62, 0.68, 0.66), vec3(0.36, 0.4, 0.39), life)
      // Radial falloff — without it each sprite is a hard translucent square.
      const radial = smoothstep(0.5, 0.12, uv().sub(vec2(0.5)).length())
      material.opacityNode = float(0.3)
        .mul(float(1).sub(life))
        .mul(life.mul(5).min(1))
        .mul(radial)
      const sprite = new Sprite(material)
      const alongOffset = -midHouse.length / 2 + 5 + ((i >> 1) % 10) * (midHouse.length - 10) * 0.111
      const side = i % 2 === 0 ? 4.4 : -4.4
      sprite.position
        .set(midHouse.x, midGround + 1.6, midHouse.z)
        .addScaledVector(midAlong, alongOffset)
        .addScaledVector(midAcross, side)
      sprite.userData.seed = seed
      sprite.userData.baseY = midGround + 1.3
      sprite.scale.setScalar(2.1)
      this.group.add(sprite)
      this.mist.push(sprite)
    }

    this.group.add(writer.build(kitMaterials(), { castShadow: false }))
    ctx.scene.add(this.group)
  }

  fixedUpdate(ctx: GameContext, _dt: number): void {
    // The misting cycle: a burst every 90 s of park time, 10 s long.
    const cycle = ctx.time.sim % 90
    const active = cycle < 10
    this.mistLife.value = (ctx.time.sim * 0.22) % 1
    for (const sprite of this.mist) {
      const life = ((this.mistLife.value as number) + sprite.userData.seed) % 1
      sprite.visible = active
      if (active) {
        sprite.position.y = sprite.userData.baseY + life * 1.9
        sprite.scale.setScalar(1.1 + life * 2.4)
      }
    }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
