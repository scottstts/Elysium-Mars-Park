import RAPIER from '@dimforge/rapier3d-compat'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { DOME_BASE_RADIUS } from '../dome/latticeField'
import { interiorHeight } from '../world/interiorHeight'

/** True Mars gravity — non-negotiable (design canon). */
export const MARS_GRAVITY = 3.71

/**
 * Rapier world at fixed 60 Hz (stepped by the game loop), plus the immutable
 * base colliders: the park floor heightfield and the dome wall ring. Systems
 * that add colliders receive this via constructor wiring in main.ts.
 */
export class PhysicsSystem implements GameSystem {
  readonly id = 'physics'
  world: RAPIER.World | null = null
  /** The rapier namespace, valid after init (consumers build descriptors). */
  api: typeof RAPIER | null = null

  async init(_ctx: GameContext): Promise<void> {
    await RAPIER.init()
    this.api = RAPIER
    const world = new RAPIER.World({ x: 0, y: -MARS_GRAVITY, z: 0 })
    this.world = world

    // Floor: heightfield over the dome footprint. Rapier's heightfield is
    // indexed COLUMN-major relative to (x, z): entry (i, j) sits at
    // x = (j/ncols − ½)·scale.x, z = (i/nrows − ½)·scale.z with index
    // j·(nrows+1)+i — verified empirically (S6: transposed fill put the
    // farm-lane height under the portal spawn).
    // 320: collision follows the paved lift + fine relief within ~1 cm.
    const n = 320
    const heights = new Float32Array((n + 1) * (n + 1))
    const extent = DOME_BASE_RADIUS * 2
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = (ix / n - 0.5) * extent
        const z = (iz / n - 0.5) * extent
        heights[ix * (n + 1) + iz] = interiorHeight(x, z)
      }
    }
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, heights, {
        x: extent,
        y: 1,
        z: extent,
      }),
      floorBody,
    )

    // Dome wall: a ring of boxes just inside the glass. Physical containment,
    // no invisible walls anywhere else (plan §1).
    const wallSegments = 56
    const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    for (let i = 0; i < wallSegments; i++) {
      const angle = ((i + 0.5) / wallSegments) * Math.PI * 2
      const radius = DOME_BASE_RADIUS - 1.1
      const chord = (2 * Math.PI * radius) / wallSegments
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const collider = RAPIER.ColliderDesc.cuboid(chord / 2 + 0.4, 30, 0.6)
        .setTranslation(x, 30 - 2, z)
        .setRotation(quaternionFromYaw(-angle + Math.PI / 2))
      world.createCollider(collider, wallBody)
    }
  }

  fixedUpdate(): void {
    this.world?.step()
  }

  dispose(): void {
    this.world?.free()
    this.world = null
  }
}

function quaternionFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }
}
