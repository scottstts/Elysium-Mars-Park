import { Group, Mesh, Quaternion, Vector3 } from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, mix, mx_noise_float, positionLocal, vec3 } from 'three/tsl'
import type { Material } from 'three'
import {
  MeshData,
  SMOOTH,
  type Vec2,
  type Vec3 as MVec3,
  buildGroup,
  circle,
  cleanMesh,
  join,
  loft,
  revolve,
  roundedBox,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
} from '../archkit/meshdata'
import { applySpecularAA, cabinGlass } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import { markDynamic } from '../render/layers'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { freedomFrame, type FreedomFrame } from './districts/freedomTower'

/**
 * THE FREEDOM TOWER LIFT — the panoramic glass cab that rides the tower's
 * service mast from the boarding lobby to the gallery, and everything else
 * that moves with it: both landing door pairs, the cab doors, the ropes,
 * the counterweight and the two sheaves.
 *
 * All datums come from `freedomFrame()` — this file owns MOTION only.
 *
 * Ride contract (owner spec):
 *  - the cab parks at the BOTTOM by default;
 *  - a landing's doors open automatically while the cab is parked there and
 *    the player stands in the boarding vicinity, and close when they leave;
 *  - E boards (the seat rig blends the camera in), the doors close behind
 *    the rider, the cab travels, and the doors reopen on arrival (the rider
 *    standing in the cab IS inside the arrival vicinity);
 *  - E again steps out onto the landing;
 *  - if the player reaches a landing while the cab is parked at the other
 *    one, the cab is dispatched to them (doors shut while it travels), so
 *    the tower can never strand anyone.
 *
 * Materials are OBJECT-SPACE (`positionLocal`): the cab travels ~38 m and a
 * world-space procedural field would visibly slide across it (notes.md,
 * robots rule). `cabinGlass` is position-independent and safe to share.
 *
 * The rider's kinematic body stays parked at the boarding landing for the
 * whole ride (the tram pattern — the camera follows the pose closure, and
 * `alight()` re-places the body at the destination), so no moving-platform
 * physics exists anywhere.
 */

const DOOR_LEAF_ARC = 0.47 // rad each leaf covers when closed
const DOOR_GAP_ARC = 0.028 // centre meeting gap
const DOOR_OPEN_ARC = 0.5 // rad each leaf swings when open
const DOOR_TIME = 0.95 // s full stroke
const BOARD_SETTLE = 1.3 // s from E press until the doors start closing
const VICINITY = 2.75 // m from the portal anchor that holds doors open
const CRUISE = 3.3 // m/s
const ACCEL = 1.1 // m/s²
const LANDINGS = ['bottom', 'top'] as const

const CAB_GLASS_R = 1.145
const CAB_WALL_TOP = 2.42
const CAB_CROWN_TOP = 2.72

type Phase = 'parkedBottom' | 'parkedTop' | 'up' | 'down'

interface SheaveRig {
  spin: Mesh
  radius: number
}

export class FreedomElevatorSystem implements GameSystem {
  readonly id = 'freedomElevator'

  private readonly physics: PhysicsSystem
  private readonly player: PlayerSystem | null
  private readonly interaction: InteractionSystem | null

  private frame!: FreedomFrame
  private readonly root = new Group()
  private cab!: Group
  private cabDoorLeaves: Group[] = []
  private landingLeaves: { bottom: Group[]; top: Group[] } = { bottom: [], top: [] }
  private ropes!: Group
  private cwtRope!: Group
  private counterweight!: Group
  private sheaves: SheaveRig[] = []

  private phase: Phase = 'parkedBottom'
  private cabFloorY = 0
  private speed = 0
  private riding = false
  /** True between E-board and wheels-turning: the doors are driving shut
   *  for DEPARTURE. Cleared on arrival — without this flag an arrival is
   *  indistinguishable from a fresh boarding and the cab bounces straight
   *  back (found live: the first ride sailed to the top and left again). */
  private departing = false
  private boardWait = 0
  /** Door state per landing (0 closed .. 1 open); cab doors mirror the
   *  landing the cab is parked at. */
  private doorOpen = { bottom: 0, top: 0 }

  private cabBody: RAPIER.RigidBody | null = null
  private doorColliders: { bottom: RAPIER.Collider | null; top: RAPIER.Collider | null } = {
    bottom: null,
    top: null,
  }
  private overrideActive = false

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
    this.frame = freedomFrame()
    const f = this.frame
    this.cabFloorY = f.cabFloorBottomY
    const yaw = Math.atan2(-f.uz, f.ux) // local +X → the door direction

    const materials = cabMaterials()

    // ---- the cab -------------------------------------------------------
    this.cab = buildCab(materials)
    this.cab.position.set(f.cabX, this.cabFloorY, f.cabZ)
    this.cab.rotation.y = yaw
    this.root.add(this.cab)
    for (const sign of [1, -1]) {
      // r 1.065: the open leaf slides BEHIND the cab jambs (inner face
      // 1.0975) with a 5 mm running clearance — never through them.
      const leaf = buildDoorLeaf(materials, CAB_GLASS_R - 0.08, 0.055, 2.3, sign)
      leaf.rotation.y = 0
      this.cab.add(leaf)
      this.cabDoorLeaves.push(leaf)
    }

    // ---- landing doors -------------------------------------------------
    for (const landing of LANDINGS) {
      const floorY = landing === 'bottom' ? f.terraceY : f.deckY
      for (const sign of [1, -1]) {
        const leaf = buildDoorLeaf(materials, 1.3, 0.055, 2.34, sign)
        leaf.position.set(f.cabX, floorY + 0.012, f.cabZ)
        leaf.rotation.y = yaw
        this.root.add(leaf)
        this.landingLeaves[landing].push(leaf)
      }
    }

    // ---- ropes, counterweight, sheaves --------------------------------
    this.ropes = buildRopes(materials)
    this.ropes.position.set(f.cabX, 0, f.cabZ) // y set per frame
    this.ropes.rotation.y = yaw
    this.root.add(this.ropes)
    this.cwtRope = buildCwtRope(materials)
    const cwt = this.cwtPlan()
    this.cwtRope.position.set(cwt.x, 0, cwt.z)
    this.root.add(this.cwtRope)

    this.counterweight = buildCounterweight(materials)
    this.counterweight.position.set(cwt.x, 0, cwt.z)
    this.counterweight.rotation.y = yaw
    this.root.add(this.counterweight)

    // Sheave spin axis = the horizontal ACROSS the door axis (the rope
    // plane contains the door axis). Orient each rig's local +Z onto it.
    const tAxis = new Vector3(-f.uz, 0, f.ux)
    for (const [s, radius, drop] of [
      [1.67, 0.31, 4.32],
      [-1.54, 0.2, 4.18],
    ]) {
      const rig = buildSheave(materials, radius)
      rig.group.position.set(f.cx + f.ux * s, f.deckY + drop, f.cz + f.uz * s)
      rig.group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tAxis)
      this.root.add(rig.group)
      this.sheaves.push({ spin: rig.wheel, radius })
    }

    markDynamic(this.root)
    ctx.scene.add(this.root)

    // ---- physics -------------------------------------------------------
    const world = this.physics.world
    const api = this.physics.api
    if (world && api) {
      const body = world.createRigidBody(api.RigidBodyDesc.fixed())
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      const rot = { x: q.x, y: q.y, z: q.z, w: q.w }
      // Floor + ceiling + three wall chords (the door side stays open; the
      // landing door colliders gate the portal whenever it must be shut).
      // Colliders are described in CAB-LOCAL offsets — rapier keeps them
      // relative to the body, which the system re-poses every step.
      const local = (
        hx: number,
        hy: number,
        hz: number,
        ox: number,
        oy: number,
        oz: number,
      ): void => {
        world.createCollider(
          api.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ox, oy, oz),
          body,
        )
      }
      local(1.06, 0.08, 1.06, 0, -0.08, 0) // floor pan
      local(1.06, 0.05, 1.06, 0, CAB_WALL_TOP + 0.14, 0) // crown
      // Wall chords: back (toward the mast) and both flanks.
      local(0.06, 1.25, 0.78, -1.05, 1.25, 0) // back — local +X is the door
      local(0.72, 1.25, 0.06, -0.28, 1.25, 0.98)
      local(0.72, 1.25, 0.06, -0.28, 1.25, -0.98)
      body.setRotation(rot, false)
      this.cabBody = body

      for (const landing of LANDINGS) {
        const floorY = landing === 'bottom' ? f.terraceY : f.deckY
        const doorBody = world.createRigidBody(api.RigidBodyDesc.fixed())
        const portal = new Vector3(
          f.cx + f.ux * (f.cabS + f.shaftR),
          floorY + 1.22,
          f.cz + f.uz * (f.cabS + f.shaftR),
        )
        this.doorColliders[landing] = world.createCollider(
          api.ColliderDesc.cuboid(0.66, 1.22, 0.09)
            .setTranslation(portal.x, portal.y, portal.z)
            .setRotation({
              x: 0,
              y: Math.sin((f.doorAngle + Math.PI / 2) / 2),
              z: 0,
              w: Math.cos((f.doorAngle + Math.PI / 2) / 2),
            }),
          doorBody,
        )
      }
    }
    this.syncPositions()

    // ---- interaction ---------------------------------------------------
    if (this.interaction && this.player) {
      const player = this.player
      for (const landing of LANDINGS) {
        const anchor = landing === 'bottom' ? f.doorAnchorBottom : f.doorAnchorTop
        this.interaction.register({
          position: anchor,
          label: () => {
            if (this.riding || player.seated) return ''
            if (!this.cabParkedAt(landing) || this.doorOpen[landing] < 0.5) return ''
            return landing === 'bottom' ? 'Ride to the gallery' : 'Descend to the terrace'
          },
          range: 3.0,
          onUse: () => {
            if (this.riding || player.seated) return
            if (!this.cabParkedAt(landing) || this.doorOpen[landing] < 0.5) return
            this.board()
          },
        })
      }
    }
  }

  // ------------------------------------------------------------ ride logic

  private cabParkedAt(landing: 'bottom' | 'top'): boolean {
    return landing === 'bottom' ? this.phase === 'parkedBottom' : this.phase === 'parkedTop'
  }

  private board(): void {
    const player = this.player
    if (!player) return
    this.riding = true
    this.departing = true
    this.boardWait = BOARD_SETTLE
    const f = this.frame
    const eye = new Vector3()
    const yaw = Math.atan2(-f.ux, -f.uz) // face the door (the view side)
    const pose = { eye, yaw }
    player.enterVehicle(() => {
      eye.set(
        f.cabX - f.ux * 0.3,
        this.cabFloorY + 1.7,
        f.cabZ - f.uz * 0.3,
      )
      return pose
    })
  }

  private alight(): void {
    const player = this.player
    if (!player) return
    this.riding = false
    const f = this.frame
    const stand = this.phase === 'parkedTop' ? f.standTop : f.standBottom
    player.standAt(stand.clone())
  }

  /** Eye proximity to a landing's portal — the auto-door rule. */
  private nearLanding(landing: 'bottom' | 'top'): boolean {
    const player = this.player
    if (!player) return false
    const f = this.frame
    const anchor = landing === 'bottom' ? f.doorAnchorBottom : f.doorAnchorTop
    const eye = player.eye
    const dx = eye.x - anchor.x
    const dz = eye.z - anchor.z
    if (Math.hypot(dx, dz) > VICINITY) return false
    return Math.abs(eye.y - anchor.y) < 2.1
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.time.paused) return
    const f = this.frame

    // Swallow E while riding: alight only at an open door (the tram rule —
    // the press must never leak through the glass to a deck interactable).
    if (this.riding && this.player) {
      const input = (this.player as unknown as { input: { useQueued: boolean } | null }).input
      if (input?.useQueued) {
        input.useQueued = false
        const here = this.phase === 'parkedTop' ? 'top' : 'bottom'
        if (
          (this.phase === 'parkedTop' || this.phase === 'parkedBottom') &&
          this.doorOpen[here] > 0.5
        ) {
          this.alight()
        }
      }
    }

    // Departure sequencing while a boarded rider settles in. `departing`
    // gates this: an ARRIVED cab is also riding+parked, and must sit still
    // with its doors open until the rider steps out or boards again.
    if (
      this.riding &&
      this.departing &&
      (this.phase === 'parkedBottom' || this.phase === 'parkedTop')
    ) {
      if (this.boardWait > 0) {
        this.boardWait -= dt
      } else {
        const here = this.phase === 'parkedBottom' ? 'bottom' : 'top'
        if (this.doorOpen[here] <= 0) {
          this.phase = this.phase === 'parkedBottom' ? 'up' : 'down'
          this.speed = 0
        }
      }
    }

    // Auto-dispatch: the cab comes to a waiting player (doors shut first).
    if (!this.riding) {
      if (this.phase === 'parkedTop' && this.nearLanding('bottom') && this.doorOpen.top <= 0) {
        this.phase = 'down'
        this.speed = 0
      } else if (
        this.phase === 'parkedBottom' &&
        this.nearLanding('top') &&
        this.doorOpen.bottom <= 0
      ) {
        this.phase = 'up'
        this.speed = 0
      }
    }

    // Travel: trapezoid profile with the crossing-capture stop gate (an
    // absolute window is unreachable — notes.md, the tram lesson).
    if (this.phase === 'up' || this.phase === 'down') {
      const target = this.phase === 'up' ? f.cabFloorTopY : f.cabFloorBottomY
      const remaining = Math.abs(target - this.cabFloorY)
      const desired = Math.min(CRUISE, Math.sqrt(2 * ACCEL * Math.max(0.005, remaining)) + 0.09)
      this.speed += Math.max(-ACCEL * 1.6 * dt, Math.min(ACCEL * dt, desired - this.speed))
      const step = this.speed * dt
      if (remaining <= step + 0.003) {
        this.cabFloorY = target
        this.speed = 0
        this.phase = this.phase === 'up' ? 'parkedTop' : 'parkedBottom'
        this.departing = false
      } else {
        this.cabFloorY += this.phase === 'up' ? step : -step
        for (const sheave of this.sheaves) {
          sheave.spin.rotation.z += (step / sheave.radius) * (this.phase === 'up' ? 1 : -1)
        }
      }
    }

    // Doors: a landing's pair opens while the cab is parked there AND
    // someone stands in the vicinity (the rider inside counts — that is
    // what reopens them on arrival); they drive shut once a boarded rider
    // has settled, and stay shut whenever the cab is elsewhere.
    for (const landing of LANDINGS) {
      const parkedHere = this.cabParkedAt(landing)
      let want = 0
      if (parkedHere && this.nearLanding(landing)) want = 1
      if (this.riding && this.departing && parkedHere && this.boardWait <= 0) want = 0
      const previous = this.doorOpen[landing]
      const next = Math.max(0, Math.min(1, previous + (want > 0.5 ? dt : -dt) / DOOR_TIME))
      this.doorOpen[landing] = next
      const collider = this.doorColliders[landing]
      if (collider) {
        const shouldBlock = next < 0.4
        if (collider.isEnabled() !== shouldBlock) collider.setEnabled(shouldBlock)
      }
    }

    this.syncPositions()
  }

  update(): void {
    if (!this.interaction || !this.player) return
    // Seated hint, tram pattern. Only touch the shared override while this
    // system owns the ride (and once on release), so the tram's own caption
    // is never clobbered.
    if (this.riding) {
      const here = this.phase === 'parkedTop' || this.phase === 'parkedBottom'
      const open =
        this.phase === 'parkedTop'
          ? this.doorOpen.top
          : this.phase === 'parkedBottom'
            ? this.doorOpen.bottom
            : 0
      this.interaction.setOverride(here && open > 0.5 ? 'Step out' : null)
      this.overrideActive = true
    } else if (this.overrideActive) {
      this.interaction.setOverride(null)
      this.overrideActive = false
    }
  }

  /** Pose every moving piece from the single cabFloorY scalar. */
  private syncPositions(): void {
    const f = this.frame
    this.cab.position.y = this.cabFloorY

    // Cab + parked-landing doors share one opening scalar. Opening moves a
    // leaf AWAY from the door centre line: for a group yawed so local +X is
    // the door axis, rotation.y = −δ advances a leaf's plan arc by +δ, so
    // the sign-positive leaf takes the negative rotation.
    const hereOpen =
      this.phase === 'parkedTop'
        ? this.doorOpen.top
        : this.phase === 'parkedBottom'
          ? this.doorOpen.bottom
          : 0
    const cabSwing = smoothstep01(hereOpen) * DOOR_OPEN_ARC
    this.cabDoorLeaves[0].rotation.y = -cabSwing
    this.cabDoorLeaves[1].rotation.y = cabSwing
    const yaw = Math.atan2(-f.uz, f.ux)
    for (const landing of LANDINGS) {
      const swing = smoothstep01(this.doorOpen[landing]) * DOOR_OPEN_ARC
      this.landingLeaves[landing][0].rotation.y = yaw - swing
      this.landingLeaves[landing][1].rotation.y = yaw + swing
    }

    // Hoist ropes: stretch from the crosshead hitch to the main sheave's
    // underside (unit-length geometry, scale.y is the span).
    const crosshead = this.cabFloorY + CAB_CROWN_TOP + 0.24
    const sheaveBottom = f.deckY + 4.32 - 0.31
    this.ropes.position.y = crosshead
    this.ropes.scale.y = Math.max(0.05, sheaveBottom - crosshead)

    // Counterweight mirrors the cab: parked cab at the bottom puts the
    // weight at its high stop under the machine deck; riding up sends it
    // down its rails into the pit zone.
    const cwtLowBase = f.terraceY - 0.1
    const cwtBase = cwtLowBase + (f.cabFloorTopY - this.cabFloorY)
    this.counterweight.position.y = cwtBase
    const deflectorBottom = f.deckY + 4.18 - 0.2
    this.cwtRope.position.y = cwtBase + 1.94
    this.cwtRope.scale.y = Math.max(0.05, deflectorBottom - (cwtBase + 1.94))

    // Physics body follows the cab.
    if (this.cabBody) {
      this.cabBody.setTranslation({ x: f.cabX, y: this.cabFloorY, z: f.cabZ }, false)
    }
  }

  private cwtPlan(): { x: number; z: number } {
    const f = this.frame
    return { x: f.cx + f.ux * -1.74, z: f.cz + f.uz * -1.74 }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.root)
  }
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------- cab builders

interface CabMaterials extends Record<string, Material> {
  alu: MeshStandardNodeMaterial
  dark: MeshStandardNodeMaterial
  floor: MeshStandardNodeMaterial
  glass: MeshStandardNodeMaterial
  glow: MeshStandardNodeMaterial
  rope: MeshStandardNodeMaterial
}

let sharedCabMaterials: CabMaterials | null = null

/** Object-space material set — safe on geometry that travels. */
function cabMaterials(): CabMaterials {
  if (sharedCabMaterials) return sharedCabMaterials
  const alu = new MeshStandardNodeMaterial()
  const brushed = mx_noise_float(positionLocal.mul(vec3(3, 90, 3))).mul(0.5).add(0.5)
  alu.colorNode = mix(vec3(0.62, 0.63, 0.645), vec3(0.55, 0.56, 0.575), brushed)
  alu.roughnessNode = mix(float(0.32), float(0.44), brushed)
  alu.metalness = 0.85
  applySpecularAA(alu)

  const dark = new MeshStandardNodeMaterial()
  const grain = mx_noise_float(positionLocal.mul(14)).mul(0.5).add(0.5)
  dark.colorNode = mix(vec3(0.13, 0.13, 0.135), vec3(0.1, 0.1, 0.105), grain)
  dark.roughness = 0.55
  dark.metalness = 0.6
  applySpecularAA(dark)

  const floor = new MeshStandardNodeMaterial()
  // Machined anti-slip disc pattern, local-space.
  const ring = mx_noise_float(positionLocal.xz.mul(26)).mul(0.5).add(0.5)
  floor.colorNode = mix(vec3(0.21, 0.205, 0.2), vec3(0.165, 0.162, 0.158), ring)
  floor.roughness = 0.8
  floor.metalness = 0.25
  applySpecularAA(floor)

  const glow = new MeshStandardNodeMaterial()
  glow.colorNode = vec3(0.9, 0.84, 0.75)
  glow.emissiveNode = vec3(1.0, 0.8, 0.585).mul(2.0)
  glow.roughness = 0.6
  glow.metalness = 0

  const rope = new MeshStandardNodeMaterial()
  rope.colorNode = vec3(0.16, 0.16, 0.165)
  rope.roughness = 0.45
  rope.metalness = 0.8

  sharedCabMaterials = { alu, dark, floor, glass: cabinGlass(), glow, rope }
  return sharedCabMaterials
}

/**
 * The cab: floor pan on skid rails, kick drum, curved glass wall with six
 * vertical ribs, jamb posts framing the door arc, crown drum with a cove
 * ceiling, crosshead with the rope hitch, and the carrier sled that grips
 * the mast rails. Authored Z-up about the cab axis, door toward +X.
 */
function buildCab(materials: CabMaterials): Group {
  const alu: MeshData[] = []
  const dark: MeshData[] = []
  const floorParts: MeshData[] = []
  const glass: MeshData[] = []
  const glow: MeshData[] = []

  const doorHalf = DOOR_LEAF_ARC + DOOR_GAP_ARC / 2 + 0.045

  // Floor pan: plated disc with a rolled edge, under-frame ring and skids.
  floorParts.push(
    revolve(
      [
        [0, 0],
        [1.1, 0],
        [1.13, -0.018],
        [1.13, -0.1],
        [1.02, -0.13],
        [0, -0.13],
      ],
      48,
      { smooth: SMOOTH.moulded },
    ),
  )
  for (const side of [1, -1]) {
    const skid = roundedBox([-0.72, side * 0.62 - 0.05, -0.21, 0.72, side * 0.62 + 0.05, -0.12], 0.012, 2)
    dark.push(skid)
  }

  // Kick drum: the solid band the glass stands on.
  alu.push(
    ringBand(
      [
        [1.115, 0.0],
        [1.16, 0.0],
        [1.16, 0.1],
        [1.145, 0.12],
        [1.115, 0.12],
      ],
      48,
    ),
  )

  // Curved glass wall: one ribbon spanning everything but the door arc.
  const glassArc = (r: number, z0: number, z1: number): MeshData => {
    const rings: MVec3[][] = []
    const steps = 40
    for (let i = 0; i <= steps; i++) {
      const a = doorHalf + ((Math.PI * 2 - 2 * doorHalf) * i) / steps
      rings.push([
        [Math.cos(a) * r, Math.sin(a) * r, z0],
        [Math.cos(a) * r, Math.sin(a) * r, z1],
      ])
    }
    const pane = loft(rings, { closeV: false })
    // A curved sheet needs curved radial normals. Leaving the loft flat-shaded
    // turns each of its 40 construction facets into a vertical brightness
    // filter, so even opaque objects behind the glass appear banded.
    smoothShade(pane, SMOOTH.turned)
    return pane
  }
  glass.push(glassArc(CAB_GLASS_R, 0.1, CAB_WALL_TOP + 0.02))

  // Six vertical glazing ribs around the wall (never inside the door arc).
  for (let i = 0; i < 6; i++) {
    const a = doorHalf + 0.35 + ((Math.PI * 2 - 2 * (doorHalf + 0.35)) * i) / 5
    const rib = tubeAlong(
      [
        [Math.cos(a) * CAB_GLASS_R, Math.sin(a) * CAB_GLASS_R, 0.11],
        [Math.cos(a) * CAB_GLASS_R, Math.sin(a) * CAB_GLASS_R, CAB_WALL_TOP + 0.01],
      ],
      roundedRect(0.03, 0.052, 0.006, 1),
      { cap: true },
    )
    rotateAboutOwnAxis(rib, a)
    smoothShade(rib, SMOOTH.moulded)
    alu.push(rib)
  }

  // Door jambs + header on the cab opening.
  for (const sign of [1, -1]) {
    const a = sign * doorHalf
    const jamb = tubeAlong(
      [
        [Math.cos(a) * (CAB_GLASS_R - 0.005), Math.sin(a) * (CAB_GLASS_R - 0.005), 0.02],
        [Math.cos(a) * (CAB_GLASS_R - 0.005), Math.sin(a) * (CAB_GLASS_R - 0.005), CAB_WALL_TOP + 0.02],
      ],
      roundedRect(0.055, 0.085, 0.008, 1),
      { cap: true },
    )
    rotateAboutOwnAxis(jamb, a)
    smoothShade(jamb, SMOOTH.moulded)
    alu.push(jamb)
  }

  // Crown drum + ceiling with a recessed glow ring.
  alu.push(
    ringBand(
      [
        [1.1, CAB_WALL_TOP],
        [1.16, CAB_WALL_TOP],
        [1.16, CAB_WALL_TOP + 0.22],
        [1.13, CAB_CROWN_TOP],
        [1.06, CAB_CROWN_TOP],
        [1.06, CAB_WALL_TOP + 0.05],
        [1.1, CAB_WALL_TOP + 0.05],
      ],
      48,
    ),
  )
  const ceiling = revolve(
    [
      [0, CAB_WALL_TOP + 0.06],
      [0.98, CAB_WALL_TOP + 0.06],
      [1.06, CAB_WALL_TOP + 0.1],
      [1.06, CAB_WALL_TOP + 0.16],
      [0, CAB_WALL_TOP + 0.16],
    ],
    48,
    { smooth: SMOOTH.moulded },
  )
  alu.push(ceiling)
  const glowRing = ringBand(
    [
      [0.62, CAB_WALL_TOP + 0.052],
      [0.86, CAB_WALL_TOP + 0.052],
      [0.86, CAB_WALL_TOP + 0.058],
      [0.62, CAB_WALL_TOP + 0.058],
    ],
    40,
  )
  glow.push(glowRing)

  // Interior handrail along the glass. Starts OUTSIDE the door leaves' full
  // open sweep (leaves reach arc ~0.99 rad): rail and stems must never sit
  // inside the sliding band.
  const railFrom = doorHalf + 0.52
  const railPath: MVec3[] = []
  const railSteps = 30
  for (let i = 0; i <= railSteps; i++) {
    const a = railFrom + ((Math.PI * 2 - 2 * railFrom) * i) / railSteps
    railPath.push([Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.98])
  }
  const rail = tubeAlong(railPath, circle(0.019, 10), { cap: true })
  smoothShade(rail, SMOOTH.turned)
  dark.push(rail)
  for (let i = 0; i <= 4; i++) {
    const a = railFrom + ((Math.PI * 2 - 2 * railFrom) * i) / 4
    // Standoff stem: root tucks 3 mm through the glass surface (the
    // licensed glazing lap — it reads as bolted to the pane).
    const stem = tubeAlong(
      [
        [Math.cos(a) * 1.148, Math.sin(a) * 1.148, 0.93],
        [Math.cos(a) * 1.01, Math.sin(a) * 1.01, 0.972],
      ],
      circle(0.012, 8),
      { cap: true },
    )
    smoothShade(stem, SMOOTH.turned)
    dark.push(stem)
  }

  // Crosshead: two channels + hitch plate + rope anchor bosses.
  for (const side of [1, -1]) {
    const beam = roundedBox(
      [-0.7, side * 0.22 - 0.045, CAB_CROWN_TOP, 0.7, side * 0.22 + 0.045, CAB_CROWN_TOP + 0.16],
      0.012,
      2,
    )
    dark.push(beam)
  }
  dark.push(
    roundedBox([-0.24, -0.3, CAB_CROWN_TOP + 0.14, 0.24, 0.3, CAB_CROWN_TOP + 0.2], 0.012, 2),
  )
  for (const [bx, by] of [
    [0, 0],
    [0.09, 0.05],
    [-0.09, -0.05],
  ] as Vec2[]) {
    const boss = revolve(
      [
        [0, 0],
        [0.03, 0],
        [0.03, 0.05],
        [0.02, 0.062],
        [0, 0.062],
      ],
      12,
      { smooth: SMOOTH.tight },
    )
    translate(boss, [bx, by, CAB_CROWN_TOP + 0.19])
    dark.push(boss)
  }

  // Carrier sled: two arms reaching back to the mast rails, a vertical yoke
  // and roller boxes that grip the rail blades.
  for (const z of [0.06, 2.5]) {
    for (const side of [1, -1]) {
      const arm = tubeAlong(
        [
          [-0.98, side * 0.5, z],
          [-2.02, side * 0.62, z],
        ],
        roundedRect(0.11, 0.05, 0.01, 1),
        { cap: true },
      )
      smoothShade(arm, SMOOTH.moulded)
      dark.push(arm)
    }
  }
  for (const side of [1, -1]) {
    const yoke = roundedBox([-2.11, side * 0.62 - 0.06, 0.0, -1.99, side * 0.62 + 0.06, 2.56], 0.014, 2)
    dark.push(yoke)
    for (const z of [0.1, 2.42]) {
      const roller = roundedBox(
        [-2.16, side * 0.62 - 0.085, z - 0.09, -2.06, side * 0.62 + 0.085, z + 0.09],
        0.012,
        2,
      )
      dark.push(roller)
    }
  }

  const group = buildGroup(
    {
      alu: cleanMesh(join(alu)),
      dark: cleanMesh(join(dark)),
      floor: cleanMesh(join(floorParts)),
      glow: cleanMesh(join(glow)),
    },
    materials,
    { name: 'freedom:cab' },
  )
  // Glass separately: no shadow casting, late render order.
  const glassMesh = buildGroup({ glass: cleanMesh(join(glass)) }, materials, {
    castShadow: false,
    receiveShadow: false,
    name: 'freedom:cab-glass',
  })
  for (const child of glassMesh.children) child.renderOrder = 13
  group.add(glassMesh)
  return group
}

/** Solid ring band from an (r, z) closed section about the cab axis. */
function ringBand(sectionRZ: Vec2[], segments: number): MeshData {
  let rSum = 0
  let zSum = 0
  for (const [r, z] of sectionRZ) {
    rSum += r
    zSum += z
  }
  const r0 = rSum / sectionRZ.length
  const z0 = zSum / sectionRZ.length
  const path: MVec3[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    path.push([Math.cos(a) * r0, Math.sin(a) * r0, z0])
  }
  const md = tubeAlong(
    path,
    sectionRZ.map(([r, z]) => [r - r0, z - z0] as Vec2),
    { closePath: true, cap: false },
  )
  smoothShade(md, SMOOTH.moulded)
  return md
}

/** Aim a vertical sweep's profile nose outward at plan angle a. */
function rotateAboutOwnAxis(md: MeshData, a: number): MeshData {
  const px = Math.cos(a) * CAB_GLASS_R
  const py = Math.sin(a) * CAB_GLASS_R
  // Vertical tubeAlong puts profile depth on +x; spin it to radial.
  return rotateZLocal(md, a, px, py)
}

function rotateZLocal(md: MeshData, ang: number, px: number, py: number): MeshData {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  for (const v of md.verts) {
    const x = v[0] - px
    const y = v[1] - py
    v[0] = px + x * c - y * s
    v[1] = py + x * s + y * c
  }
  md.provenance = null
  return md
}

/**
 * One curved sliding door leaf: glass panel in a full aluminum edge frame,
 * swept on its arc about the group origin (the cab axis), so leaf motion is
 * pure Y-rotation. `sign` +1 covers the arc above the door centre line.
 */
function buildDoorLeaf(
  materials: CabMaterials,
  radius: number,
  depth: number,
  height: number,
  sign: number,
): Group {
  const a0 = sign * (DOOR_GAP_ARC / 2)
  const a1 = sign * (DOOR_GAP_ARC / 2 + DOOR_LEAF_ARC)
  const lo = Math.min(a0, a1)
  const hi = Math.max(a0, a1)
  const alu: MeshData[] = []
  const glass: MeshData[] = []

  // Edge frame: stiles on both arc ends, head + sill rails swept on the arc.
  const railSection: Vec2[] = [
    [-depth / 2, 0],
    [depth / 2, 0],
    [depth / 2, 0.085],
    [-depth / 2, 0.085],
  ]
  for (const z of [0.015, height - 0.1]) {
    const path: MVec3[] = []
    for (let i = 0; i <= 12; i++) {
      const a = lo + ((hi - lo) * i) / 12
      path.push([Math.cos(a) * radius, Math.sin(a) * radius, z])
    }
    const rail = tubeAlong(path, railSection, { cap: true })
    smoothShade(rail, SMOOTH.moulded)
    alu.push(rail)
  }
  for (const a of [lo + 0.012, hi - 0.012]) {
    const stile = tubeAlong(
      [
        [Math.cos(a) * radius, Math.sin(a) * radius, 0.1],
        [Math.cos(a) * radius, Math.sin(a) * radius, height - 0.085],
      ],
      roundedRect(0.048, depth, 0.008, 1),
      { cap: true },
    )
    rotateZLocal(stile, a, Math.cos(a) * radius, Math.sin(a) * radius)
    smoothShade(stile, SMOOTH.moulded)
    alu.push(stile)
  }
  // Glass: curved ribbon between the rails, tucked into all four members.
  const rings: MVec3[][] = []
  for (let i = 0; i <= 14; i++) {
    const a = lo + 0.02 + ((hi - lo - 0.04) * i) / 14
    rings.push([
      [Math.cos(a) * radius, Math.sin(a) * radius, 0.07],
      [Math.cos(a) * radius, Math.sin(a) * radius, height - 0.06],
    ])
  }
  const pane = loft(rings, { closeV: false })
  smoothShade(pane, SMOOTH.turned)
  glass.push(pane)

  const group = buildGroup({ alu: cleanMesh(join(alu)) }, materials, {
    name: 'freedom:door-leaf',
  })
  const glassMesh = buildGroup({ glass: cleanMesh(join(glass)) }, materials, {
    castShadow: false,
    receiveShadow: false,
  })
  for (const child of glassMesh.children) child.renderOrder = 13
  group.add(glassMesh)
  return group
}

/** Three hoist ropes + the counterweight rope, authored unit-length so the
 *  system can stretch them with scale.y. */
function buildRopes(materials: CabMaterials): Group {
  const ropes: MeshData[] = []
  for (const [ox, oy] of [
    [0, 0],
    [0.09, 0.05],
    [-0.09, -0.05],
  ] as Vec2[]) {
    const strand = tubeAlong(
      [
        [ox, oy, 0],
        [ox, oy, 1],
      ],
      circle(0.009, 7),
      { cap: false },
    )
    smoothShade(strand, SMOOTH.turned)
    ropes.push(strand)
  }
  return buildGroup({ rope: cleanMesh(join(ropes)) }, materials, {
    castShadow: false,
    name: 'freedom:ropes',
  })
}

/** The single counterweight rope (unit length, own world-space group). */
function buildCwtRope(materials: CabMaterials): Group {
  return buildGroup(
    {
      rope: tubeAlong(
        [
          [0, 0, 0],
          [0, 0, 1],
        ],
        circle(0.009, 7),
        { cap: false },
      ),
    },
    materials,
    { castShadow: false, name: 'freedom:cwt-rope' },
  )
}

/** The counterweight: frame, stacked filler plates, guide shoes. */
function buildCounterweight(materials: CabMaterials): Group {
  const dark: MeshData[] = []
  const frame = ringBandRect(0.62, 0.2, 1.92, 0.05)
  dark.push(frame)
  for (let i = 0; i < 7; i++) {
    const plate = roundedBox([-0.27, -0.075, 0.1 + i * 0.24, 0.27, 0.075, 0.1 + i * 0.24 + 0.2], 0.01, 2)
    dark.push(plate)
  }
  for (const z of [0.04, 1.86]) {
    for (const side of [1, -1]) {
      const shoe = roundedBox(
        [side * 0.31 - 0.03, -0.055, z - 0.05, side * 0.31 + 0.06, 0.055, z + 0.05],
        0.008,
        2,
      )
      dark.push(shoe)
    }
  }
  return buildGroup({ dark: cleanMesh(join(dark)) }, materials, { name: 'freedom:cwt' })
}

/** Rectangular frame of four welded bars (a picture frame standing in XZ). */
function ringBandRect(w: number, d: number, h: number, t: number): MeshData {
  const bars: MeshData[] = []
  bars.push(roundedBox([-w / 2, -d / 2, 0, w / 2, d / 2, t], 0.01, 2))
  bars.push(roundedBox([-w / 2, -d / 2, h - t, w / 2, d / 2, h], 0.01, 2))
  bars.push(roundedBox([-w / 2, -d / 2, t - 0.005, -w / 2 + t, d / 2, h - t + 0.005], 0.01, 2))
  bars.push(roundedBox([w / 2 - t, -d / 2, t - 0.005, w / 2, d / 2, h - t + 0.005], 0.01, 2))
  return cleanMesh(join(bars))
}

/** A sheave wheel in a static-yoke group; the wheel child spins. */
function buildSheave(
  materials: CabMaterials,
  radius: number,
): { group: Group; wheel: Mesh } {
  const wheelMd = revolve(
    [
      [0, -0.05],
      [radius - 0.03, -0.05],
      [radius, -0.028],
      [radius - 0.012, 0],
      [radius, 0.028],
      [radius - 0.03, 0.05],
      [0, 0.05],
    ],
    36,
    { smooth: SMOOTH.turned },
  )
  // Spokes read through the rim at speed.
  const spokes: MeshData[] = [wheelMd]
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const spoke = tubeAlong(
      [
        [Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0],
        [Math.cos(a) * (radius - 0.035), Math.sin(a) * (radius - 0.035), 0],
      ],
      circle(0.016, 8),
      { cap: true },
    )
    smoothShade(spoke, SMOOTH.turned)
    spokes.push(spoke)
  }
  const group = buildGroup({ dark: cleanMesh(join(spokes)) }, materials, {
    name: 'freedom:sheave',
  })
  const wheel = group.children[0] as Mesh
  return { group, wheel }
}
