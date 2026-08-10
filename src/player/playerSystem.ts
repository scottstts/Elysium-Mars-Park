import { Vector3 } from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { MARS_GRAVITY, PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { PORTAL_STATION } from '../world/parkPlan'
import { PlayerInput } from './input'

/** Locomotion tuning (plan §10): a low-G lope, composed, never floaty-silly. */
const WALK_SPEED = 1.6
const SPRINT_SPEED = 4.2
const EYE_HEIGHT = 0.8 // above capsule center; capsule center sits at 0.9
const CAPSULE_HALF_HEIGHT = 0.55
const CAPSULE_RADIUS = 0.35
const JUMP_SPEED = 3.0
const ACCEL_GROUND = 14
const ACCEL_AIR = 2.2
const LOOK_SENSITIVITY = 0.0023

export class PlayerSystem implements GameSystem {
  readonly id = 'player'

  /** Current interpolated eye position (for interaction raycasts). */
  readonly eye = new Vector3()

  private readonly physics: PhysicsSystem
  private input: PlayerInput | null = null
  private body: RAPIER.RigidBody | null = null
  private controller: RAPIER.KinematicCharacterController | null = null
  private collider: RAPIER.Collider | null = null

  private yaw = 0 // spawn facing north (−Z, toward the First Tree)
  private pitch = 0
  private readonly velocity = new Vector3()
  private grounded = false
  private readonly previousPosition = new Vector3()
  private readonly currentPosition = new Vector3()
  private bobPhase = 0
  private bobEnergy = 0

  /**
   * Seated state: a pose closure (static for benches, live for the tram),
   * with authored smooth camera in/out — no cuts (design canon).
   */
  private seatedPose: (() => { eye: Vector3; yaw: number }) | null = null
  private seatBlend = 0
  private readonly walkEye = new Vector3()

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    const world = this.physics.world
    if (!world) throw new Error('PlayerSystem requires the physics world')
    const RAPIER_API = this.physics.api
    if (!RAPIER_API) throw new Error('PlayerSystem requires the rapier api')

    const spawnX = PORTAL_STATION.x
    const spawnZ = PORTAL_STATION.z - 6
    const spawnY = PORTAL_STATION.y + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.25
    const body = world.createRigidBody(
      RAPIER_API.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY, spawnZ),
    )
    const collider = world.createCollider(
      RAPIER_API.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      body,
    )
    const controller = world.createCharacterController(0.06)
    controller.enableAutostep(0.42, 0.28, true)
    controller.enableSnapToGround(0.35)
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
    controller.setMinSlopeSlideAngle((58 * Math.PI) / 180)
    controller.setApplyImpulsesToDynamicBodies(false)

    this.body = body
    this.collider = collider
    this.controller = controller
    this.currentPosition.set(spawnX, spawnY, spawnZ)
    this.previousPosition.copy(this.currentPosition)

    this.input = new PlayerInput(ctx.renderer.domElement)
    // Click to (re)capture the pointer once the entry screen is gone.
    ctx.renderer.domElement.addEventListener('click', () => this.input?.requestLock())
    ctx.events.on('park/entered', () => this.input?.requestLock())
  }

  get seated(): boolean {
    return this.seatedPose !== null
  }

  /** `seatSurface` is the actual seat surface point; eye sits 0.74 above. */
  sit(seatSurface: Vector3, yaw: number): void {
    if (this.seatedPose) return
    const eye = seatSurface.clone().add(new Vector3(0, 0.74, 0))
    this.seatedPose = () => ({ eye, yaw })
    this.yaw = yaw
    this.pitch = Math.min(this.pitch, 0.15)
    this.velocity.set(0, 0, 0)
  }

  /** Ride a moving vehicle: the pose closure is re-read every frame. */
  enterVehicle(pose: () => { eye: Vector3; yaw: number }): void {
    this.seatedPose = pose
    const now = pose()
    this.yaw = now.yaw
    this.pitch = Math.min(this.pitch, 0.12)
    this.velocity.set(0, 0, 0)
  }

  /** Leave any seat toward an explicit stand point (vehicle door, etc.). */
  standAt(standPoint: Vector3): void {
    const body = this.body
    if (!body) return
    const target = standPoint
      .clone()
      .setY(standPoint.y + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.05)
    body.setTranslation({ x: target.x, y: target.y, z: target.z }, false)
    this.previousPosition.copy(target)
    this.currentPosition.copy(target)
    this.seatedPose = null
  }

  stand(): void {
    const pose = this.seatedPose
    const body = this.body
    if (!pose || !body) return
    // Step out in front of the seat at the body's frozen standing height,
    // then the camera blends back from the seat pose — never a cut.
    const now = pose()
    const forward = new Vector3(Math.sin(now.yaw), 0, Math.cos(now.yaw))
    const current = body.translation()
    const standPoint = new Vector3(now.eye.x, current.y, now.eye.z).addScaledVector(forward, 0.55)
    body.setTranslation({ x: standPoint.x, y: standPoint.y, z: standPoint.z }, false)
    this.previousPosition.copy(standPoint)
    this.currentPosition.copy(standPoint)
    this.seatedPose = null
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const input = this.input
    const body = this.body
    const collider = this.collider
    const controller = this.controller
    const world = this.physics.world
    if (!input || !body || !collider || !controller || !world) return
    if (ctx.time.paused) return

    // Seated: the body holds still; only the seat blend advances.
    this.seatBlend = Math.max(
      0,
      Math.min(1, this.seatBlend + (this.seatedPose ? dt : -dt) / 0.55),
    )
    if (this.seatedPose) {
      input.jumpQueued = false
      return
    }

    // Desired planar velocity in yaw space.
    const targetSpeed = input.sprint ? SPRINT_SPEED : WALK_SPEED
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    const desiredX = (input.strafe * cos - input.forward * sin) * targetSpeed
    const desiredZ = (-input.forward * cos - input.strafe * sin) * targetSpeed
    const accel = this.grounded ? ACCEL_GROUND : ACCEL_AIR
    this.velocity.x += (desiredX - this.velocity.x) * Math.min(1, accel * dt)
    this.velocity.z += (desiredZ - this.velocity.z) * Math.min(1, accel * dt)

    // True Mars gravity — the one toy you carry everywhere (design canon).
    this.velocity.y -= MARS_GRAVITY * dt
    if (this.grounded && input.jumpQueued) {
      this.velocity.y = JUMP_SPEED
      this.grounded = false
    }
    input.jumpQueued = false

    controller.computeColliderMovement(collider, {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    })
    const movement = controller.computedMovement()
    const translation = body.translation()
    const next = {
      x: translation.x + movement.x,
      y: translation.y + movement.y,
      z: translation.z + movement.z,
    }
    body.setTranslation(next, false)

    this.grounded = controller.computedGrounded()
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -0.4

    this.previousPosition.copy(this.currentPosition)
    this.currentPosition.set(next.x, next.y, next.z)

    // Lope energy follows real horizontal speed.
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z)
    const targetEnergy = this.grounded ? Math.min(1, planarSpeed / SPRINT_SPEED) : 0
    this.bobEnergy += (targetEnergy - this.bobEnergy) * Math.min(1, 6 * dt)
    // Long Mars strides: bob frequency scales with speed, ~1.5 Hz at sprint.
    this.bobPhase += dt * (0.9 + planarSpeed * 0.42) * Math.PI
  }

  update(ctx: GameContext, _dt: number, alpha: number): void {
    const input = this.input
    if (!input) return

    const look = input.drainLook()
    this.yaw -= look.yaw * LOOK_SENSITIVITY
    this.pitch = Math.max(
      -Math.PI * 0.488,
      Math.min(Math.PI * 0.488, this.pitch - look.pitch * LOOK_SENSITIVITY),
    )

    const position = this.walkEye
    position.lerpVectors(this.previousPosition, this.currentPosition, Math.min(1, alpha))
    position.y += EYE_HEIGHT

    // The lope: subtle vertical figure-eight, felt more than seen.
    const bobAmount = this.bobEnergy * 0.045
    position.y += Math.sin(this.bobPhase * 2) * bobAmount
    const lateral = Math.sin(this.bobPhase) * bobAmount * 0.55
    position.x += Math.cos(this.yaw) * lateral
    position.z += -Math.sin(this.yaw) * lateral

    const eye = this.eye
    const pose = this.seatedPose
    if (this.seatBlend > 0 && pose) {
      const now = pose()
      const blend = this.seatBlend * this.seatBlend * (3 - 2 * this.seatBlend)
      eye.lerpVectors(position, now.eye, blend)
      // Seated look keeps a comfortable cone around the seat's facing.
      const delta = normalizeAngle(this.yaw - now.yaw)
      this.yaw = now.yaw + Math.max(-1.35, Math.min(1.35, delta))
      this.pitch = Math.max(-0.7, Math.min(0.65, this.pitch))
    } else {
      eye.copy(position)
    }

    ctx.camera.position.copy(eye)
    ctx.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  dispose(): void {
    this.input?.dispose()
    this.input = null
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
