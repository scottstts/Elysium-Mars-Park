import { Group } from 'three'
import { PartWriter } from '../archkit/writer'
import { kitMaterials } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { buildCommons } from './districts/commons'
import { buildFarmside } from './districts/farmside'
import { buildFreedomTower } from './districts/freedomTower'
import { buildHydroTower } from './districts/hydroTower'
import { buildInteriors } from './districts/interiors'
import { buildLeisure } from './districts/leisure'
import { buildResidential } from './districts/residential'
import type { DistrictServices } from './districts/types'
import { buildWorks } from './districts/works'
import type { DoorsSystem } from './doors'
import { buildAmenities } from './parkAmenities'

/**
 * Assembles every district through ONE PartWriter (a handful of merged
 * meshes for all park architecture), creates the shared static colliders,
 * and registers every seat. parkPlan.ts remains the only source of layout.
 */
export class ParkAssemblySystem implements GameSystem {
  readonly id = 'park'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem
  private readonly player: PlayerSystem | null
  private readonly interaction: InteractionSystem | null
  private readonly doorsSystem: DoorsSystem | null
  /** Exposed for OpsScreensSystem (set during init by works.ts). */
  opsAnchor: DistrictServices['opsAnchor']

  constructor(
    physics: PhysicsSystem,
    player: PlayerSystem | null,
    interaction: InteractionSystem | null,
    doorsSystem: DoorsSystem | null,
  ) {
    this.physics = physics
    this.player = player
    this.interaction = interaction
    this.doorsSystem = doorsSystem
  }

  init(ctx: GameContext): void {
    const services: DistrictServices = {
      writer: new PartWriter(),
      group: this.group,
      rng: ctx.rng.fork('park-assembly'),
      colliders: [],
      seats: [],
      interactables: [],
      doors: [],
    }

    buildResidential(services)
    buildFarmside(services)
    buildWorks(services)
    buildLeisure(services)
    buildCommons(services)
    buildHydroTower(services)
    buildFreedomTower(services)
    buildAmenities(services)
    buildInteriors(services)
    this.opsAnchor = services.opsAnchor
    if (this.doorsSystem) {
      for (const door of services.doors) this.doorsSystem.register(door)
    }

    this.group.add(services.writer.build(kitMaterials()))
    ctx.scene.add(this.group)

    const world = this.physics.world
    const api = this.physics.api
    if (world && api) {
      const body = world.createRigidBody(api.RigidBodyDesc.fixed())
      for (const spec of services.colliders) {
        if (spec.kind === 'box') {
          const yaw = spec.yaw ?? 0
          world.createCollider(
            api.ColliderDesc.cuboid(spec.size.x / 2, spec.size.y / 2, spec.size.z / 2)
              .setTranslation(spec.center.x, spec.center.y, spec.center.z)
              .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
            body,
          )
        } else {
          world.createCollider(
            api.ColliderDesc.cylinder(spec.halfHeight, spec.radius).setTranslation(
              spec.center.x,
              spec.center.y,
              spec.center.z,
            ),
            body,
          )
        }
      }
    }

    if (this.player && this.interaction) {
      const player = this.player
      // One step so the query pipeline exists — rapier queries see NOTHING
      // before the first world.step() (notes.md), and the sight-line casts
      // below depend on it. Everything is fixed/kinematic; nothing moves.
      world?.step()
      for (const seatSpec of services.seats) {
        // A seat whose sight-line is bricked shut is worse than no seat
        // (audit: a path bench faced a play block at 0.4 m). Head-height
        // cast from just ahead of the backrest: blocked → the bench stays
        // as dressing, no interactable.
        if (world && api) {
          const dx = -Math.sin(seatSpec.yaw)
          const dz = -Math.cos(seatSpec.yaw)
          const origin = {
            x: seatSpec.seat.x + dx * 0.35,
            y: seatSpec.seat.y + 0.85,
            z: seatSpec.seat.z + dz * 0.35,
          }
          if (world.castRay(new api.Ray(origin, { x: dx, y: 0, z: dz }), 0.4, true)) continue
        }
        this.interaction.register({
          position: seatSpec.seat.clone().setY(seatSpec.seat.y + 0.55),
          label: () => (player.seated ? 'Stand' : (seatSpec.label ?? 'Sit')),
          range: 2.2,
          onUse: () => {
            if (player.seated) player.stand()
            else player.sit(seatSpec.seat, seatSpec.yaw)
          },
        })
      }
      for (const interactable of services.interactables) {
        this.interaction.register(interactable)
      }
    }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
