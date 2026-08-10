import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { DoorSpec } from './districts/types'

interface DoorState {
  spec: DoorSpec
  open01: number
  target: number
  collider: RAPIER.Collider | null
}

/** Animates every registered sliding door and gates its collider. */
export class DoorsSystem implements GameSystem {
  readonly id = 'doors'
  private readonly states: DoorState[] = []
  private readonly physics: PhysicsSystem
  private readonly interaction: InteractionSystem | null

  constructor(physics: PhysicsSystem, interaction: InteractionSystem | null) {
    this.physics = physics
    this.interaction = interaction
  }

  register(spec: DoorSpec): void {
    const world = this.physics.world
    const api = this.physics.api
    let collider: RAPIER.Collider | null = null
    if (world && api) {
      const yaw = spec.collider.yaw ?? 0
      const body = world.createRigidBody(api.RigidBodyDesc.fixed())
      collider = world.createCollider(
        api.ColliderDesc.cuboid(
          spec.collider.size.x / 2,
          spec.collider.size.y / 2,
          spec.collider.size.z / 2,
        )
          .setTranslation(spec.collider.center.x, spec.collider.center.y, spec.collider.center.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
        body,
      )
    }
    const state: DoorState = { spec, open01: 0, target: 0, collider }
    this.states.push(state)
    spec.panel.position.copy(spec.closedPosition)

    this.interaction?.register({
      position: spec.anchor,
      label: () => (state.target > 0.5 ? 'Close' : spec.label),
      range: 2.6,
      onUse: () => {
        state.target = state.target > 0.5 ? 0 : 1
      },
    })
  }

  update(_ctx: GameContext, dt: number): void {
    for (const state of this.states) {
      const previous = state.open01
      state.open01 += Math.max(-dt / 0.8, Math.min(dt / 0.8, state.target - state.open01))
      if (state.open01 !== previous) {
        const eased = state.open01 * state.open01 * (3 - 2 * state.open01)
        state.spec.panel.position
          .copy(state.spec.closedPosition)
          .addScaledVector(state.spec.openOffset, eased)
        if (state.collider) {
          const shouldBlock = state.open01 < 0.4
          if (state.collider.isEnabled() !== shouldBlock) {
            state.collider.setEnabled(shouldBlock)
          }
        }
      }
    }
  }
}
