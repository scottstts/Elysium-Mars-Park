import { Group, Vector3 } from 'three'
import { PartWriter } from '../archkit/writer'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { FIRST_TREE } from '../world/parkPlan'
import { buildFirstTree } from './firstTree'
import { plantFountainBays } from '../fountain/fountainPlanting'
import { buildRegolithGardens } from './gardens'
import { GreenhouseCrops, MistSystem, plantGreenhouses } from './greenhouse'
import {
  buildTreeRing,
  plantPlanters,
  plantTreeCollar,
  PlantingPalette,
} from './planting'
import type { VegetationCollider } from './planting'

/**
 * THE GREEN BUDGET, and where it is allowed to be spent.
 *
 * The masterplan's reconciliation, restated because it is the one thing that
 * must not drift: green is LUSH inside raised planters and glass buildings,
 * and open ground stays mineral Mars. That is not a compromise between the
 * design doc's "sparse and Mars-feeling" and the reference image's overflowing
 * beds — it is the mechanism that makes both true at once. The plaza and the
 * boulevard read green because 42 walled beds overflow; walk ten metres off
 * the paving and you are on raked regolith with rock and a rationed bed.
 *
 * Ownership:
 *   `firstTree.ts`  the 12 m ginkgo — branches, canopy, bark
 *   `planting.ts`   the shared species palette, the 42 planters, the tree pit
 *   `gardens.ts`    the open-regolith rock groups
 *   `../fountain/fountainPlanting.ts` THE FOUNTAIN's four coping planters
 *   `greenhouse.ts` crop trays and the misting cycle
 *   `species.ts`    plant geometry primitives and the instancing sink
 *   `foliageMaterial.ts` every foliage/bark/rock material in the park
 *
 * Draw-call shape: seven ornamental species + three crop species + one canopy
 * + one wood mesh + one merged hard-geometry group. Density is affordable
 * precisely because nothing here is a per-plant object.
 */
export class VegetationSystem implements GameSystem {
  readonly id = 'vegetation'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem
  private mist: MistSystem | null = null

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    const rng = ctx.rng.fork('vegetation')
    const writer = new PartWriter()
    const colliders: VegetationCollider[] = []
    const palette = new PlantingPalette()
    this.group.name = 'vegetation'

    // ── The First Tree, in its pit. The pit is built first because it owns
    // the soil datum the tree's root flare is seated into.
    const soilTop = buildTreeRing(
      writer,
      colliders,
      FIRST_TREE.x,
      FIRST_TREE.z,
      FIRST_TREE.soilRingRadius,
    )
    const tree = buildFirstTree(
      // Seated 6 cm INTO the soil: a trunk that rests on a surface shows a
      // hairline at the contact, a trunk that is planted in it does not.
      new Vector3(FIRST_TREE.x, soilTop - 0.06, FIRST_TREE.z),
      rng.fork('first-tree'),
    )
    this.group.add(tree.group)
    colliders.push({
      kind: 'cylinder',
      center: tree.collider.center,
      radius: tree.collider.radius,
      halfHeight: tree.collider.halfHeight,
    })
    plantTreeCollar(
      palette,
      rng.fork('tree-collar'),
      FIRST_TREE.x,
      FIRST_TREE.z,
      FIRST_TREE.soilRingRadius,
    )

    // ── The 42 arc planters.
    const planterStats = plantPlanters(palette, writer, rng.fork('planters'))

    // ── The rock groups on the open regolith zones.
    const gardenStats = buildRegolithGardens(
      palette,
      writer,
      this.group,
      colliders,
      rng.fork('gardens'),
    )

    // ── The Fountain's four coping planters. They plant into the SHARED
    // palette, not a second one: the park's foliage is a single instancing
    // sink, and a private palette for four beds would double every foliage
    // draw call and every foliage material in the world.
    const fountainPlants = plantFountainBays(palette, rng.fork('fountain-planters'))

    // ── Farmside + hydroponics.
    const crops = new GreenhouseCrops()
    const cropStats = plantGreenhouses(crops, rng.fork('crops'))
    this.mist = new MistSystem()
    for (const sprite of this.mist.objects()) this.group.add(sprite)

    for (const mesh of palette.meshes()) this.group.add(mesh)
    for (const mesh of crops.meshes()) this.group.add(mesh)

    // Hard geometry (pit wall, bed edging, drip lines, rock, stakes, soil)
    // merges into one draw per material slot.
    const hard = writer.build(palette.materials, { castShadow: true })
    hard.name = 'vegetation-hardscape'
    this.group.add(hard)

    this.installColliders(colliders)
    ctx.scene.add(this.group)

    if (ctx.flags.debug) {
      let hardTriangles = 0
      hard.traverse((node) => {
        const geometry = (node as { geometry?: { index?: { count: number } | null } }).geometry
        if (geometry?.index) hardTriangles += geometry.index.count / 3
      })
      console.info('[vegetation]', {
        tree: tree.stats,
        crown: { radius: Number(tree.crown.radius.toFixed(2)) },
        planters: planterStats,
        gardens: gardenStats,
        fountainPlants,
        crops: { ...cropStats, ...crops.counts() },
        hardTriangles,
      })
    }
  }

  private installColliders(colliders: VegetationCollider[]): void {
    const world = this.physics.world
    const api = this.physics.api
    if (!world || !api) return
    const body = world.createRigidBody(api.RigidBodyDesc.fixed())
    for (const spec of colliders) {
      if (spec.kind === 'cylinder') {
        world.createCollider(
          api.ColliderDesc.cylinder(spec.halfHeight, spec.radius).setTranslation(
            spec.center.x,
            spec.center.y,
            spec.center.z,
          ),
          body,
        )
      } else {
        const half = spec.yaw / 2
        world.createCollider(
          api.ColliderDesc.cuboid(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2)
            .setTranslation(spec.center.x, spec.center.y, spec.center.z)
            .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
          body,
        )
      }
    }
  }

  fixedUpdate(ctx: GameContext, _dt: number): void {
    this.mist?.update(ctx.time.sim)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
