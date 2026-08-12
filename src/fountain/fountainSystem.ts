import { Group, Vector3 } from 'three'
import { PartWriter } from '../archkit/writer'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from '../world/interiorHeight'
import { FOUNTAIN } from '../world/parkPlan'
import { fountainMaterials } from './fountainMaterials'
import {
  BASIN_INNER_R,
  BAY_HALF_ANGLE,
  BAY_RAMP,
  BAY_SWELL,
  COPING_TOP_Y,
  LOWER_TAZZA,
  MAIN_CURTAIN_LAND_R,
  PLANTER_BAYS,
  PODIUM_Y,
  STYLOBATE_STEPS,
  UPPER_TAZZA,
  WALL_THICKNESS,
  WATER_Y,
} from './fountainPlan'
import { buildFountainFigures } from './fountainFigures'
import { buildFountainStone } from './fountainStone'
import { fountainTime } from './waterField'
import { buildFountainStreams } from './waterStreams'
import { fountainWaterMesh, tazzaWaterMesh } from './waterSurface'

/**
 * THE FOUNTAIN — assembly and clock.
 *
 * The system itself is deliberately thin: it resolves the ONE datum every
 * other module is authored against (the court's paved top under the axis),
 * builds the five layers, installs the colliders, and drives a single time
 * uniform. Everything with an opinion lives in its own module.
 *
 * Layers, in the order they are added:
 *   `fountainStone`    stylobate, coping, basin floor, island, tazze, bronze
 *   `fountainFigures`  the four caryatids
 *   `waterSurface`     the basin's ray-traced volume + the two dish surfaces
 *   `waterStreams`     the ballistic solves and the short COHERENT cores
 *   `waterDroplets`    every disconnected parcel, as a real projectile
 *
 * ## The clock
 *
 * `fountainTime` follows `ctx.time.sim`, the accumulated fixed-step park
 * clock, NOT TSL's global `time`. Two consequences that both matter: the water
 * freezes with the pause card instead of running behind it, and two sessions
 * with the same seed show the same wave at the same tick — which is what makes
 * a fixed validation camera a usable regression surface for this feature.
 */
export class FountainSystem implements GameSystem {
  readonly id = 'fountain'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    this.group.name = 'fountain'
    // THE datum. Every height in `fountainPlan` is local to this point, and
    // nothing else in the feature calls `interiorHeight` — the fountain court
    // is a flat pad, so one sample is the whole ground truth.
    const center = new Vector3(FOUNTAIN.x, interiorHeight(FOUNTAIN.x, FOUNTAIN.z), FOUNTAIN.z)

    const writer = new PartWriter()
    buildFountainStone(writer, center)
    buildFountainFigures(writer, center)
    const materials = fountainMaterials({
      waterWorldY: center.y + WATER_Y,
      landRadius: MAIN_CURTAIN_LAND_R,
      center: { x: center.x, z: center.z },
    })
    const stone = writer.build(materials, { castShadow: true })
    stone.name = 'fountain-stone'
    this.group.add(stone)

    // Water. The basin's surface is opaque (it computes its own volume), so it
    // sits in the normal depth-sorted pass; everything else here is
    // transparent and renders after it by renderOrder.
    this.group.add(fountainWaterMesh({ center }))
    this.group.add(tazzaWaterMesh(center, LOWER_TAZZA))
    this.group.add(tazzaWaterMesh(center, UPPER_TAZZA))

    const streams = buildFountainStreams(center)
    for (const mesh of streams.meshes) this.group.add(mesh)

    this.installColliders(center)
    ctx.scene.add(this.group)

    if (ctx.flags.debug) {
      let triangles = 0
      this.group.traverse((node) => {
        const geometry = (node as { geometry?: { index?: { count: number } | null } }).geometry
        if (geometry?.index) triangles += geometry.index.count / 3
      })
      console.info('[fountain]', {
        courtY: Number(center.y.toFixed(3)),
        waterY: Number((center.y + WATER_Y).toFixed(3)),
        crownY: Number((center.y + UPPER_TAZZA.rimTopY).toFixed(2)),
        impacts: streams.impacts.length,
        triangles: Math.round(triangles),
      })
    }
  }

  /**
   * Colliders: three concentric cylinders (the two steps and the coping wall)
   * plus one box per planter bay.
   *
   * The steps are walkable — the character controller autosteps 0.42 m, so a
   * 155 mm riser is climbed, not blocked — and the coping cylinder stops the
   * player at the water. The bays swell past the wall's cylinder, so they get
   * their own boxes; without them a guest walks bodily through a planter,
   * which is the exact defect class the park's prop-overlap audit exists for.
   */
  private installColliders(center: Vector3): void {
    const world = this.physics.world
    const api = this.physics.api
    if (!world || !api) return
    const body = world.createRigidBody(api.RigidBodyDesc.fixed())

    const cylinder = (radius: number, top: number): void => {
      const bottom = -0.6
      const halfHeight = (top - bottom) / 2
      world.createCollider(
        api.ColliderDesc.cylinder(halfHeight, radius).setTranslation(
          center.x,
          center.y + bottom + halfHeight,
          center.z,
        ),
        body,
      )
    }
    for (const step of STYLOBATE_STEPS) cylinder(step.radius, step.top)
    cylinder(BASIN_INNER_R + WALL_THICKNESS, COPING_TOP_Y)

    for (let b = 0; b < PLANTER_BAYS; b++) {
      const theta = (b / PLANTER_BAYS) * Math.PI * 2
      const rMid = BASIN_INNER_R + WALL_THICKNESS + BAY_SWELL * 0.5
      const halfArc = BAY_HALF_ANGLE + BAY_RAMP * 0.6
      const halfDepth = BAY_SWELL * 0.5 + 0.06
      const halfWidth = Math.sin(halfArc) * (rMid + halfDepth)
      const top = center.y + COPING_TOP_Y
      const bottom = center.y + PODIUM_Y - 0.2
      const half = (top - bottom) / 2
      world.createCollider(
        api.ColliderDesc.cuboid(halfDepth, half, halfWidth)
          // The box's local X is radial, so the yaw that aligns it with the
          // bay is the bearing negated (the park's Y-up yaw convention runs
          // clockwise seen from above — see kit.ts).
          .setTranslation(
            center.x + Math.cos(theta) * rMid,
            bottom + half,
            center.z + Math.sin(theta) * rMid,
          )
          .setRotation({ x: 0, y: Math.sin(-theta / 2), z: 0, w: Math.cos(-theta / 2) }),
        body,
      )
    }
  }

  fixedUpdate(ctx: GameContext, _dt: number): void {
    fountainTime.value = ctx.time.sim
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
