import { Group, Quaternion, Vector3 } from 'three'
import { PartWriter } from '../archkit/writer'
import { kitMaterials } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { markDynamic } from '../render/layers'
import { interiorHeight } from '../world/interiorHeight'
import { LOOP } from '../world/parkPlan'
import { buildPortalGate } from './portalGate'
import type { PortalGate } from './portalGate'
import { buildGuideway, buildStations, buildTrackData, buildTube, carFloorY } from './track'
import type { TrackData } from './track'
import { buildTramCar, CAR_LENGTH, CAR_WIDTH } from './vehicle'
import type { TramCar } from './vehicle'
import type RAPIER from '@dimforge/rapier3d-compat'

/**
 * The Loop (plan §11): arrival spur through the tube, then the closed
 * circuit forever. Kinematic arc-length motion with a comfort speed
 * profile; the tram IS the arrival cinematic — the player begins seated
 * inside the front car, in the dark, rolling toward the portal.
 */

const CRUISE = 8
/**
 * The arrival is a ten-second shot (owner spec): ~330 m of spur at an express
 * 45 m/s, with one continuous 9 m/s² brake whose sqrt-profile the speed
 * follower tracks. Braking distance is v²/2a ≈ 112 m, so the brake engages
 * still inside the tube and the car is visibly shedding speed as it threads
 * the gate, sweeping the hook at walking-pace into the platform stop:
 * 220 m / 45 + 45 / 9 ≈ 9.9 s.
 */
const ARRIVAL_CRUISE = 45
const ARRIVAL_BRAKE = 9
const ACCEL = 1.05
const DWELL_SECONDS = 22
const CAR_GAP = 0.7
/** Gate opens when the arrival has this much left to run: at 45 m/s the six
 *  blades (1.6 s travel) are fully housed ~2.5 s before the car passes. */
const GATE_OPEN_REMAINING = 190

type Phase = 'waiting' | 'arrival' | 'dwell' | 'run'

export class TramSystem implements GameSystem {
  readonly id = 'tram'

  private track: TrackData | null = null
  private readonly cars: TramCar[] = []
  private readonly staticGroup = new Group()
  private readonly movingGroup = new Group()

  private phase: Phase = 'waiting'
  private arrivalS = 0
  private loopS = 0
  private speed = 0
  private dwellRemaining = 0
  private nextStationIndex = 0
  private doorOpen = 0
  private riding = false
  /**
   * While true, car placement runs in one continuous arc-length domain that
   * crosses from the arrival spur onto the loop at the portal handoff. The
   * old code swapped curves at the dock instant: the front car had already
   * pinned (degenerate atan2(0,0) heading), then teleported ~3.9 m onto the
   * loop — the reported "camera cut when the tram stops". Cleared once the
   * train fully clears the seam; every later lap samples the loop directly.
   */
  private spurActive = true
  private readonly carBodies: RAPIER.RigidBody[] = []

  private readonly physics: PhysicsSystem
  private readonly player: PlayerSystem | null
  private readonly interaction: InteractionSystem | null
  private readonly boardPosition = new Vector3()
  private gate: PortalGate | null = null
  private irisOpen = 0

  constructor(
    physics: PhysicsSystem,
    player: PlayerSystem | null,
    interaction: InteractionSystem | null,
  ) {
    this.physics = physics
    this.player = player
    this.interaction = interaction
  }

  init(ctx: GameContext): void {
    const track = buildTrackData()
    this.track = track

    const writer = new PartWriter()
    buildGuideway(writer, track)
    buildTube(writer, track)
    buildStations(writer, this.staticGroup, this.physics)
    this.staticGroup.add(writer.build(kitMaterials()))
    ctx.scene.add(this.staticGroup)

    // Portal pressure gate: the powered closure in the bulkhead collar,
    // built and animated by its own module (tram/portalGate.ts).
    const gate = buildPortalGate(kitMaterials())
    this.staticGroup.add(gate.group)
    this.gate = gate

    for (let i = 0; i < 2; i++) {
      const car = buildTramCar()
      this.movingGroup.add(car.group)
      this.cars.push(car)
    }
    markDynamic(this.movingGroup)
    ctx.scene.add(this.movingGroup)

    // Cabin colliders: one box per car, teleported along with the car every
    // fixed step. Boarding is strictly the E interaction (the seat rig) —
    // walking through an open door must be impossible, or the tram departs
    // around a stowaway standing in the aisle (owner report). A moving car
    // additionally shoves standing players clear (nudgeOutOfBox): the
    // kinematic character controller never resolves collisions on its own.
    const world = this.physics.world
    const api = this.physics.api
    if (world && api) {
      for (let i = 0; i < this.cars.length; i++) {
        const body = world.createRigidBody(api.RigidBodyDesc.fixed())
        world.createCollider(
          api.ColliderDesc.cuboid(CAR_WIDTH / 2 + 0.05, 1.5, CAR_LENGTH / 2 + 0.05),
          body,
        )
        this.carBodies.push(body)
      }
    }

    if (this.player) {
      // The player begins the day already seated in the front car (canon):
      // no boarding blend at boot — the day BEGINS in the seat. Start half a
      // train-length in: at arrivalS 0 the REAR car's arc offset clamps to
      // the spur start and the two cars boot overlapped by ~4 m (geometry
      // auditor finding) until the train has rolled clear.
      this.phase = 'arrival'
      this.arrivalS = (CAR_LENGTH + CAR_GAP) / 2 + 0.4
      this.speed = ARRIVAL_CRUISE
      this.riding = true
      // Place the cars FIRST: seatPose reads the car's world matrix, and
      // before the first placement the car sits at the origin facing +Z —
      // the seat yaw comes out π wrong and pins at the look-cone edge.
      this.placeCars()
      this.player.enterVehicleImmediate(() => this.seatPose())
    } else {
      // Validation views: the tram circulates the loop.
      this.phase = 'run'
      this.spurActive = false
      this.loopS = track.stationS.get('farmside') ?? 0
      this.speed = CRUISE
      this.nextStationIndex = this.stationOrder().indexOf('overlook')
    }

    if (this.interaction && this.player) {
      this.interaction.register({
        position: this.boardPosition,
        // Content-aware: the caption exists only when boarding is actually
        // possible — a docked tram with open doors.
        label: () =>
          !this.riding && this.phase === 'dwell' && this.doorOpen > 0.3 ? 'Board' : '',
        range: 3.2,
        onUse: () => {
          if (!this.riding && this.phase === 'dwell' && this.doorOpen > 0.3) this.board()
        },
      })
    }
  }

  private stationOrder(): string[] {
    // Travel order with decreasing angle parametrization.
    return ['portal', 'farmside', 'overlook']
  }

  private seatPlayer(): void {
    const player = this.player
    if (!player) return
    this.riding = true
    player.enterVehicle(() => this.seatPose())
  }

  private seatPose(): { eye: Vector3; yaw: number } {
    const car = this.cars[0]
    // Front-left AISLE seat when the new cabin provides it: the window
    // seat's A-pillar bisects the dead-ahead arrival view (vehicle report).
    const seat = car.seats[2] ?? car.seats[0]
    const world = seat.position.clone().applyMatrix4(car.group.matrixWorld)
    world.y += 0.74
    const quaternion = car.group.getWorldQuaternion(new Quaternion())
    const forward = new Vector3(0, 0, 1).applyQuaternion(quaternion)
    // Player yaw 0 looks along −Z, so looking WITH travel T needs
    // atan2(−T.x, −T.z); seat.yaw π flips for the rear-facing pair.
    return { eye: world, yaw: Math.atan2(-forward.x, -forward.z) + seat.yaw }
  }

  private board(): void {
    this.seatPlayer()
  }

  private alight(): void {
    const player = this.player
    const track = this.track
    if (!player || !track) return
    this.riding = false
    // Stand on the platform side (left of travel = +X local, right-handed).
    const car = this.cars[0]
    const left = new Vector3(1, 0, 0).applyQuaternion(
      car.group.getWorldQuaternion(new Quaternion()),
    )
    const door = car.group.position.clone().addScaledVector(left, 2.4)
    door.y = interiorHeight(door.x, door.z) + 0.02
    // Every platform decks at the cabin floor less the 20 mm step.
    if (Math.abs(Math.hypot(door.x, door.z) - LOOP.radius) < 8) {
      door.y = carFloorY(door.x, door.z) - 0.02
    }
    player.standAt(door)
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const track = this.track
    if (!track) return
    if (this.phase === 'waiting') return

    if (this.phase === 'arrival') {
      // Speed: express through the tube, one continuous sqrt-profile brake
      // through the gate and the hook into the stop — no cuts. The follower's
      // decel slew runs 1.45× the profile so it can catch the curve at onset.
      const remaining = track.arrivalLength - this.arrivalS
      const target = Math.min(
        ARRIVAL_CRUISE,
        Math.sqrt(2 * ARRIVAL_BRAKE * Math.max(0.01, remaining)) + 0.15,
      )
      this.speed += Math.max(
        -ARRIVAL_BRAKE * 1.45 * dt,
        Math.min(ARRIVAL_BRAKE * dt, target - this.speed),
      )
      this.arrivalS += this.speed * dt
      if (this.arrivalS >= track.arrivalLength - 0.02) {
        this.phase = 'dwell'
        this.loopS = track.handoffS
        this.dwellRemaining = DWELL_SECONDS + 8
        this.speed = 0
        this.nextStationIndex = 1 // farmside next
        ctx.events.emit('tram/docked', { station: 'portal' })
      }
    } else if (this.phase === 'dwell') {
      this.dwellRemaining -= dt
      if (this.dwellRemaining > 1.4) {
        this.doorOpen = Math.min(1, this.doorOpen + dt / 0.9)
      } else {
        this.doorOpen = Math.max(0, this.doorOpen - dt / 0.8)
        if (this.dwellRemaining <= 0 && this.doorOpen <= 0) this.phase = 'run'
      }
    } else {
      // Run: brake toward the next station stop.
      const order = this.stationOrder()
      const stationId = order[this.nextStationIndex % order.length]
      const stopS = track.stationS.get(stationId) ?? 0
      let distance = stopS - this.loopS
      while (distance < 0) distance += track.loopLength
      const target = Math.min(CRUISE, Math.sqrt(2 * ACCEL * Math.max(0.01, distance)) + 0.12)
      this.speed += Math.max(-ACCEL * dt * 1.7, Math.min(ACCEL * dt, target - this.speed))
      // Capture the stop when THIS frame's travel would cross it. An absolute
      // window is unreachable here: the +0.12 creep floor keeps speed ≥ 0.12,
      // so one 60 Hz step advances ≥ 3.3 mm — wider than any sub-centimetre
      // gate — and the tram orbited forever without ever docking
      // (experience-audit finding). Snap magnitude ≤ one frame of creep.
      const step = this.speed * dt
      if (distance <= step + 0.005) {
        this.loopS = stopS
        this.speed = 0
        this.phase = 'dwell'
        this.dwellRemaining = DWELL_SECONDS
        this.nextStationIndex++
        ctx.events.emit('tram/docked', { station: stationId })
      } else {
        this.loopS = (this.loopS + step) % track.loopLength
      }
    }

    this.placeCars()

    // Gate: blades open ahead of the approaching tram, reseal once it has
    // docked — a pressure closure stands closed, not parked open.
    const track2 = this.track
    if (track2) {
      let target = 0
      if (this.phase === 'arrival') {
        target = track2.arrivalLength - this.arrivalS < GATE_OPEN_REMAINING ? 1 : 0
      } else if (this.phase === 'dwell' && this.dwellRemaining > DWELL_SECONDS + 2) {
        target = 1 // just docked: hold while the car clears the throat
      }
      this.irisOpen += Math.max(-dt / 2.2, Math.min(dt / 1.6, target - this.irisOpen))
      const eased = this.irisOpen * this.irisOpen * (3 - 2 * this.irisOpen)
      this.gate?.setOpen(eased)
    }

    // Riding controls: E alights at an open door; otherwise the press is
    // swallowed so it can't leak to a platform interactable through the
    // window. Exiting is only ever possible at a stop (owner spec).
    const player = this.player
    if (this.riding && player) {
      const input = (player as unknown as { input: { useQueued: boolean } | null }).input
      if (input?.useQueued) {
        input.useQueued = false
        if (this.phase === 'dwell' && this.doorOpen > 0.5) this.alight()
      }
    }

    this.syncCarColliders()
  }

  update(): void {
    // Seated hint (bypasses the view-cone pick): tell the rider how to leave
    // the moment the doors are open, and nothing otherwise.
    if (!this.interaction || !this.player) return
    this.interaction.setOverride(
      this.riding && this.phase === 'dwell' && this.doorOpen > 0.5 ? 'Exit' : null,
    )
  }

  /** Keep each car's cabin collider glued to the car; shove bystanders. */
  private syncCarColliders(): void {
    const player = this.player
    for (let i = 0; i < this.carBodies.length && i < this.cars.length; i++) {
      const car = this.cars[i].group
      const yaw = car.rotation.y
      const cy = car.position.y + 1.5
      this.carBodies[i].setTranslation(
        { x: car.position.x, y: cy, z: car.position.z },
        false,
      )
      this.carBodies[i].setRotation(
        { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
        false,
      )
      if (player && !this.riding && this.speed > 0.02) {
        player.nudgeOutOfBox(
          new Vector3(car.position.x, cy, car.position.z),
          yaw,
          CAR_WIDTH / 2 + 0.05,
          1.5,
          CAR_LENGTH / 2 + 0.05,
        )
      }
    }
  }

  /**
   * Sample the train path at arc length `s` in the boot-continuous domain:
   * the arrival spur for s ≤ arrivalLength, continuing seamlessly onto the
   * loop past it (the spur's endpoint IS the portal stop). Once `spurActive`
   * clears, `s` is a plain loop arc length. Every consumer of a car pose
   * goes through here — the dock instant must never re-place a car.
   */
  private carPoint(s: number): Vector3 {
    const track = this.track
    if (!track) return new Vector3()
    if (!this.spurActive) {
      return track.loop.getPointAt(mod(s, track.loopLength) / track.loopLength)
    }
    if (s <= track.arrivalLength) {
      return track.arrival.getPointAt(clamp(s, 0, track.arrivalLength) / track.arrivalLength)
    }
    return track.loop.getPointAt(
      mod(track.handoffS + (s - track.arrivalLength), track.loopLength) / track.loopLength,
    )
  }

  private placeCars(): void {
    const track = this.track
    if (!track) return
    const spacing = CAR_LENGTH + CAR_GAP
    // One scalar for the whole train. After the portal dock the domain keeps
    // extending onto the loop (arrivalLength + distance-past-handoff) until
    // the rear car clears the seam; then both domains agree exactly and the
    // spur mapping switches off with zero displacement.
    let trainS: number
    if (!this.spurActive) {
      trainS = this.loopS
    } else if (this.phase === 'arrival') {
      trainS = this.arrivalS
    } else {
      let past = this.loopS - track.handoffS
      if (past < -track.loopLength / 2) past += track.loopLength
      trainS = track.arrivalLength + past
      if (past > spacing + 4) {
        this.spurActive = false
        trainS = this.loopS
      }
    }
    for (let i = 0; i < this.cars.length; i++) {
      const offset = (i === 0 ? 0.5 : -0.5) * spacing
      const point = this.carPoint(trainS + offset)
      const ahead = this.carPoint(trainS + offset + 1.5)
      const car = this.cars[i].group
      car.position.copy(point).add(new Vector3(0, 0.62, 0))
      car.rotation.set(0, Math.atan2(ahead.x - point.x, ahead.z - point.z), 0)
      const pitch = Math.atan2(ahead.y - point.y, Math.hypot(ahead.x - point.x, ahead.z - point.z))
      car.rotateX(-pitch)
      car.updateMatrixWorld()

      // Doors: platform side is the left; animate the slide.
      const open = this.doorOpen * 0.78
      this.cars[i].doorsLeft.children.forEach((panelMesh, index) => {
        panelMesh.position.z = (index === 0 ? -1 : 1) * open
      })
    }

    // Keep the boarding caption anchored at the front car's left door.
    const car = this.cars[0]
    const left = new Vector3(1.6, 1.2, 0).applyMatrix4(car.group.matrixWorld)
    this.boardPosition.copy(left)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.staticGroup)
    ctx.scene.remove(this.movingGroup)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function mod(v: number, m: number): number {
  return ((v % m) + m) % m
}
