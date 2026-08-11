import { Vector3 } from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { MARS_GRAVITY, PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from '../world/interiorHeight'
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
   *
   * The exit path keeps the pose alive in `exitPose` while the eye blends
   * back to the standing point (SeaPark VehicleSeatRig pattern): the body is
   * parked at the exit the moment the exit starts, so control hand-back is
   * seamless, and the camera never cuts. Asymmetric blends: in 1.2 s, out
   * 0.9 s, smoothstep-eased.
   */
  private seatedPose: (() => { eye: Vector3; yaw: number }) | null = null
  private exitPose: (() => { eye: Vector3; yaw: number }) | null = null
  private seatBlend = 0
  /** Last frame's pose yaw, for carrying the head with a turning vehicle. */
  private seatYawCarry: number | null = null
  private readonly walkEye = new Vector3()

  /** Locomotion gate for camera rigs; look stays live regardless. */
  controlEnabled = true

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    const world = this.physics.world
    if (!world) throw new Error('PlayerSystem requires the physics world')
    const RAPIER_API = this.physics.api
    if (!RAPIER_API) throw new Error('PlayerSystem requires the rapier api')

    // Station-foot apron: z=91 is inside the rebuilt platform slab.
    const spawnX = PORTAL_STATION.x
    const spawnZ = 87
    const spawnY =
      interiorHeight(spawnX, spawnZ) + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.25
    const body = world.createRigidBody(
      RAPIER_API.RigidBodyDesc.kinematicPositionBased().setTranslation(spawnX, spawnY, spawnZ),
    )
    const collider = world.createCollider(
      RAPIER_API.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      body,
    )
    const controller = world.createCharacterController(0.06)
    // Autostep min-width 0.05: stair-nosing lips and floor-light bezels are
    // narrower than the old 0.28 m landing requirement, so they read as walls
    // and forced a jump. Height stays 0.42 — real platforms still need one.
    controller.enableAutostep(0.42, 0.05, true)
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
    // No yaw/pitch snap: the seated cone tightens with the blend instead.
    this.exitPose = null
    this.seatedPose = () => ({ eye, yaw })
    this.velocity.set(0, 0, 0)
  }

  /** Ride a moving vehicle: the pose closure is re-read every frame. */
  enterVehicle(pose: () => { eye: Vector3; yaw: number }): void {
    this.exitPose = null
    this.seatedPose = pose
    this.velocity.set(0, 0, 0)
  }

  /** Seat instantly (boot-time arrival: the day BEGINS in the cabin). */
  enterVehicleImmediate(pose: () => { eye: Vector3; yaw: number }): void {
    this.enterVehicle(pose)
    const now = pose()
    this.yaw = now.yaw
    this.pitch = 0
    this.seatBlend = 1
  }

  /** Leave any seat toward an explicit stand point (vehicle door, etc.). */
  standAt(standPoint: Vector3): void {
    const body = this.body
    if (!body) return
    const target = standPoint
      .clone()
      .setY(standPoint.y + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.05)
    // Park the body at the exit NOW; the eye blends after it (never a cut).
    body.setTranslation({ x: target.x, y: target.y, z: target.z }, false)
    this.previousPosition.copy(target)
    this.currentPosition.copy(target)
    this.velocity.set(0, 0, 0)
    this.exitPose = this.seatedPose
    this.seatedPose = null
  }

  stand(): void {
    const pose = this.seatedPose
    const body = this.body
    if (!pose || !body) return
    const now = pose()
    const current = body.translation()
    // TRUE look-forward is (−sin, −cos); the old (+sin, +cos) stepped
    // BACKWARD through the seat back — 56 of 114 seats exited inside a
    // collider (experience audit). And plain forward is no safer everywhere
    // (bench fronts, amphitheater drops), so probe forward → behind → sides
    // at two reaches and take the first spot with capsule clearance AND
    // footing within a step of the seated height.
    const sin = Math.sin(now.yaw)
    const cos = Math.cos(now.yaw)
    const directions: Array<[number, number]> = [
      [-sin, -cos],
      [sin, cos],
      [-cos, sin],
      [cos, -sin],
    ]
    const world = this.physics.world
    const api = this.physics.api
    let chosen: Vector3 | null = null
    if (world && api) {
      const capsule = new api.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS)
      const feetY = current.y - CAPSULE_HALF_HEIGHT - CAPSULE_RADIUS
      outer: for (const reach of [0.55, 0.85]) {
        for (const [dx, dz] of directions) {
          const x = now.eye.x + dx * reach
          const z = now.eye.z + dz * reach
          let blocked = false
          world.intersectionsWithShape(
            { x, y: current.y, z },
            { x: 0, y: 0, z: 0, w: 1 },
            capsule,
            (collider) => {
              if (collider === this.collider) return true
              blocked = true
              return false
            },
          )
          if (blocked) continue
          const ray = new api.Ray({ x, y: current.y + 0.4, z }, { x: 0, y: -1, z: 0 })
          const hit = world.castRay(ray, 3, true, undefined, undefined, this.collider ?? undefined)
          if (!hit) continue
          const groundY = current.y + 0.4 - hit.timeOfImpact
          if (Math.abs(groundY - feetY) > 0.45) continue
          chosen = new Vector3(x, groundY, z)
          break outer
        }
      }
    }
    if (chosen) {
      this.standAt(chosen)
      return
    }
    // Fallback: seat-forward at the frozen standing height.
    const standPoint = new Vector3(now.eye.x - sin * 0.55, current.y, now.eye.z - cos * 0.55)
    standPoint.y -= CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.05 // standAt re-adds
    this.standAt(standPoint)
  }

  /** Re-request pointer lock (pause-menu resume path). */
  requestPointerLock(): void {
    this.input?.requestLock()
  }

  get pointerLocked(): boolean {
    return this.input?.pointerLocked ?? false
  }

  /**
   * Shove the standing player out of a moving vehicle's footprint (yaw-only
   * OBB). The kinematic controller only resolves collisions when the PLAYER
   * moves, so a tram sweeping through a bystander must push them itself.
   */
  nudgeOutOfBox(center: Vector3, yaw: number, halfX: number, halfY: number, halfZ: number): void {
    const body = this.body
    if (!body || this.seatedPose || this.exitPose) return
    const t = body.translation()
    const dx = t.x - center.x
    const dz = t.z - center.z
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    // World → box-local (inverse yaw): local +Z is the vehicle's forward.
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const margin = CAPSULE_RADIUS + 0.06
    if (Math.abs(lx) >= halfX + margin || Math.abs(lz) >= halfZ + margin) return
    if (t.y < center.y - halfY || t.y > center.y + halfY + 1.2) return
    const targetLx = (lx >= 0 ? 1 : -1) * (halfX + margin)
    const nx = center.x + targetLx * cos + lz * sin
    const nz = center.z - targetLx * sin + lz * cos
    body.setTranslation({ x: nx, y: t.y, z: nz }, false)
    this.previousPosition.set(nx, t.y, nz)
    this.currentPosition.set(nx, t.y, nz)
  }

  /** Camera-rig hand-back helpers (SeaPark player surface). */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw
    this.pitch = Math.max(-Math.PI * 0.488, Math.min(Math.PI * 0.488, pitch))
  }

  placeAt(x: number, y: number, z: number): void {
    this.standAt(new Vector3(x, y, z))
    this.exitPose = null
    this.seatBlend = 0
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
    // Asymmetric authored blends (in 1.2 s / out 0.9 s, SeaPark rig).
    this.seatBlend = Math.max(
      0,
      Math.min(1, this.seatBlend + (this.seatedPose ? dt / 1.2 : -dt / 0.9)),
    )
    if (this.seatBlend <= 0) this.exitPose = null
    if (this.seatedPose || this.exitPose || !this.controlEnabled) {
      // Locomotion frozen through the whole seat/exit blend; look stays live.
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

  update(ctx: GameContext, dt: number, alpha: number): void {
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
    // Blend against the live pose while seated, or the RETAINED pose while
    // exiting — the branch that used to be dead (the pose was nulled and the
    // body teleported in the same call: the documented hard-cut bug).
    const pose = this.seatedPose ?? this.exitPose
    if (this.seatBlend > 0 && pose) {
      const now = pose()
      // Carry the head WITH a turning vehicle: add the pose yaw's
      // frame-to-frame delta before any clamping, or the view stays
      // world-locked while the cabin rotates underneath until the cone edge
      // drags it — the rider ended the arrival staring 77° off the
      // direction of travel (experience-audit finding).
      if (this.seatYawCarry !== null) {
        this.yaw += normalizeAngle(now.yaw - this.seatYawCarry)
      }
      this.seatYawCarry = now.yaw
      const blend = this.seatBlend * this.seatBlend * (3 - 2 * this.seatBlend)
      eye.lerpVectors(position, now.eye, blend)
      // Seated look keeps a comfortable cone around the seat's facing; the
      // cone TIGHTENS with the blend so entering never snaps the view.
      let delta = normalizeAngle(this.yaw - now.yaw)
      if (this.seatedPose && this.seatBlend < 1) {
        // Boarding recentre: ease toward the seat facing and level the
        // pitch while the entry blend runs — a rider who boarded looking
        // backward settles in, instead of arriving pinned at the cone edge.
        delta *= Math.max(0, 1 - 2.2 * dt)
        this.pitch *= Math.max(0, 1 - 1.6 * dt)
      }
      const yawLimit = Math.PI * (1 - blend) + 1.35 * blend
      this.yaw = now.yaw + Math.max(-yawLimit, Math.min(yawLimit, delta))
      const pitchLo = -Math.PI * 0.488 * (1 - blend) - 0.7 * blend
      const pitchHi = Math.PI * 0.488 * (1 - blend) + 0.65 * blend
      this.pitch = Math.max(pitchLo, Math.min(pitchHi, this.pitch))
    } else {
      eye.copy(position)
      this.seatYawCarry = null
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
