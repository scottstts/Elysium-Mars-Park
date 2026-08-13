import { Group, Matrix4, Object3D, Vector3 } from 'three'
import {
  circle,
  prism,
  revolveY,
  rotateX,
  roundedRect,
  setSlot,
  SlotMesh,
  translate,
  tubeAlong,
  unifyOrient,
  type MeshData,
  type Vec2,
  type Vec3,
} from './tramMesh'
import type { TramMaterials } from './tramMaterials'

/**
 * THE COUPLING — the articulated draw gear between the Loop's two cars.
 *
 * The two units used to run 0.7 m apart with nothing at all between them,
 * which is the one detail that stops a two-car set reading as a TRAIN (owner
 * report).
 *
 * MECHANISM — a bar coupler on TWO spherical joints. The bar is pinned in the
 * FRONT car's tail head under a ribbed rubber boot, and carries a ball at its
 * far end that is captured in a spherical seat cast into a housing plugged
 * into the REAR car's nose head; the seat closes over the ball past its
 * equator, so the joint cannot pull out. Two jumper hoses arch over the bar
 * between bosses on the two heads.
 *
 * WHY TWO JOINTS. A single-ball bar has to be rigid with one car, and its ball
 * then only lands in the seat when the two cars sit symmetrically about the
 * joint. That is exactly true on a constant-radius arc (both half-offsets are
 * the same arc length from the mid-point, so the chord offsets cancel) and only
 * approximately true through the spur's transition curves and the portal
 * handoff. With a joint at each end the bar simply spans whatever the two cars
 * present, at any yaw, pitch and roll.
 *
 * CRAFT NOTES. The socket is ONE lathed casting — barrel, mouth lip and
 * spherical seat in a single closed profile — so the ball sits in a real
 * cavity instead of being buried in a solid block, and there is no cross-slot
 * interpenetration anywhere in the assembly. Everything that meets a part of
 * the CAR (bar root, boot root, hose bosses) keeps a 4 mm reveal: those parts
 * live in a group that re-aims every step, so a flush butt would grind.
 *
 * PLACEMENT CONTRACT. `socket` is a rigid child of the REAR car — add it once
 * and forget it. `group` holds the bar and is re-aimed every fixed step by
 * `update(front, rear)` from the two cars' world matrices, which must already
 * be current (`tramSystem.placeCars` calls `updateMatrixWorld` per car).
 */

/** Where each end's coupler head finishes — `tramBody.buildEnd`'s pocket. */
export const COUPLER_HEAD_Z = 4.16
/** Ball centre, measured back from the REAR car's head tip. */
const BALL_INSET = 0.16

const BALL_R = 0.085
/** Seat radius: the ball plus 3 mm of grease clearance. */
const SEAT_R = BALL_R + 0.003
const BAR_R = 0.056
/** Reveal between anything in the aimed group and the car it stands on. */
const REVEAL = 0.004
/** Where the fixed root stub hands over to the stretching run. */
const ROOT_END = 0.055
/** How far the stretching run stops short of the socket's mouth. */
const SHAFT_GAP = 0.105
/** Neck behind the ball; it laps the shaft's end so no gap can open. */
const HEAD_NECK = 0.14
const HOSE_X = 0.105
const HOSE_R = 0.019

/** Ball centre in the REAR car's local frame — the bar's aim target. */
export const SOCKET_SEAT_Z = COUPLER_HEAD_Z + BALL_INSET

export interface TramCoupling {
  /** The draw bar, re-aimed every step. Add to the moving group. */
  group: Group
  /** Socket housing; add as a child of the REAR car, once. */
  socket: Group
  update(front: Object3D, rear: Object3D): void
}

/** Lathe a (radius, along) profile about the coupler axis (+Z). */
function latheZ(profile: Vec2[], segments: number, smooth: number): MeshData {
  return unifyOrient(rotateX(revolveY(profile, segments, { smooth }), Math.PI / 2))
}

/** Root flange bolted into the front car's head, and the shaft's first stub. */
function barRoot(): MeshData {
  return latheZ(
    [
      [0, REVEAL],
      [0.072, REVEAL],
      [0.072, REVEAL + 0.022],
      [BAR_R + 0.006, REVEAL + 0.04],
      [BAR_R, ROOT_END],
      [0, ROOT_END],
    ],
    22,
    34,
  )
}

/**
 * The stretching run — shaft and boot — authored over `z in [0, 1]` and scaled
 * to whatever the two cars present. The Loop's placement model holds each car
 * at a fixed ARC offset, so the straight-line distance between their coupler
 * faces breathes 0.226…0.347 m as the alignment's curvature changes: real draw
 * gear absorbs exactly that, and a bellows stretching over its stroke is what
 * one looks like. Only this group scales, so no flange or ball is ever
 * distorted — the ball sits on the seat point by construction.
 */
function barShaft(): MeshData {
  return latheZ(
    [
      [0, 0],
      [BAR_R, 0],
      [BAR_R, 1],
      [0, 1],
    ],
    22,
    34,
  )
}

function boot(): MeshData {
  const ribs = 5
  const outer: Vec2[] = [[0.07, 0], [0.078, 0.03]]
  for (let i = 0; i < ribs; i++) {
    outer.push([0.104, 0.03 + (0.94 * (i + 0.5)) / ribs], [0.076, 0.03 + (0.94 * (i + 1)) / ribs])
  }
  outer.push([0.07, 1])
  return latheZ([...outer, [0.064, 1], [0.064, 0], [0.07, 0]], 20, 30)
}

/** Ball head and its neck; the neck laps the shaft's end by 35 mm. */
function barHead(): MeshData {
  const profile: Vec2[] = [
    [0, -HEAD_NECK],
    [BAR_R, -HEAD_NECK],
    [BAR_R, -BALL_R * 0.86],
    [BALL_R * 0.74, -BALL_R * 0.66],
  ]
  // Ball: equator forward to the pole, so the head is a true sphere cap.
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 0.5
    profile.push([Math.cos(a) * BALL_R, Math.sin(a) * BALL_R])
  }
  return latheZ(profile, 22, 34)
}

/**
 * Two jumper hoses arching between the coupler heads, authored over
 * `z in [0, 1]` (head tip to head tip) so the same scale trick carries them.
 * The rise is in Y and therefore never scales — the arch keeps its shape.
 */
function hoses(slots: SlotMesh): void {
  for (const sx of [-1, 1]) {
    const path: Vec3[] = []
    const steps = 16
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      path.push([sx * HOSE_X, 0.124 + Math.sin(t * Math.PI) * 0.15, t])
    }
    slots.add(
      setSlot(tubeAlong(path, circle(HOSE_R, 8), { smooth: 40, capStart: true, capEnd: true }), 'rubber'),
      'rubber',
    )
    // Gland cuffs where each hose meets its head — rubber, so the stretch is
    // in character.
    for (const [z0, z1] of [
      [0, 0.09],
      [0.91, 1],
    ]) {
      const cuff = prism(
        roundedRect(0.058, 0.058, 0.02, 2).map(([x, y]) => [x + sx * HOSE_X, y + 0.124] as Vec2),
        'z',
        z0,
        z1,
        30,
      )
      slots.add(setSlot(cuff, 'rubber'), 'rubber')
    }
  }
}

/**
 * Socket housing on the rear car's nose, in that car's local frame: ONE closed
 * lathe profile carrying the barrel, the mouth lip and the spherical seat.
 * Plugged 30 mm into the head pocket, so the joint to the car is a bury inside
 * one material slot rather than a coplanar butt.
 */
function socketHousing(): SlotMesh {
  const slots = new SlotMesh()
  const back = COUPLER_HEAD_Z - 0.03
  const face = SOCKET_SEAT_Z + 0.08
  // Seat mouth angle from +Z: 48 deg closes over the ball well past its
  // equator (mouth radius 0.065 against an 0.085 ball) while still clearing
  // the 0.056 bar by 9 mm at full articulation.
  const MOUTH = (48 * Math.PI) / 180
  const profile: Vec2[] = [
    [0, back],
    [0.104, back],
    [0.104, face - 0.012],
    [0.092, face],
    [Math.sin(MOUTH) * SEAT_R, face],
  ]
  for (let i = 0; i <= 12; i++) {
    const a = MOUTH + ((Math.PI - MOUTH) * i) / 12
    profile.push([Math.sin(a) * SEAT_R, SOCKET_SEAT_Z + Math.cos(a) * SEAT_R])
  }
  profile.push([0, back])
  slots.add(setSlot(latheZ(profile, 24, 30), 'dark'), 'dark')
  // Four boss pads on the face, so the casting reads as bolted, not grown.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pad = latheZ(
        [
          [0, 0],
          [0.014, 0],
          [0.014, 0.014],
          [0.009, 0.018],
          [0, 0.018],
        ],
        10,
        24,
      )
      translate(pad, [sx * 0.07, sy * 0.07, face - 0.004])
      slots.add(setSlot(pad, 'dark'), 'dark')
    }
  }
  return slots
}

const FRONT_TIP = /*@__PURE__*/ new Vector3(0, 0, -COUPLER_HEAD_Z)
const REAR_SEAT = /*@__PURE__*/ new Vector3(0, 0, SOCKET_SEAT_Z)
const REAR_TIP = /*@__PURE__*/ new Vector3(0, 0, COUPLER_HEAD_Z)

export function buildTramCoupling(materials: TramMaterials): TramCoupling {
  const group = new Group()
  group.name = 'tram-coupling'

  // TWO aimed runs from the same origin (the front car's head tip), because
  // they have different targets: the bar ends on the socket's SEAT, the hoses
  // on the rear car's head TIP, and those two points are 0.16 m apart along
  // the rear car's own axis — which is up to 4 deg off the bar's. Aiming the
  // hoses with the bar left their far ends 139 mm short on the Loop.
  const bar = new Group()
  bar.name = 'tram-coupling-bar'
  group.add(bar)

  const rootSlots = new SlotMesh()
  rootSlots.add(setSlot(barRoot(), 'alloy'), 'alloy')
  bar.add(rootSlots.build(materials))

  const runSlots = new SlotMesh()
  runSlots.add(setSlot(barShaft(), 'alloy'), 'alloy')
  runSlots.add(setSlot(boot(), 'rubber'), 'rubber')
  const run = new Group()
  run.position.z = ROOT_END
  run.add(runSlots.build(materials))
  bar.add(run)

  const headSlots = new SlotMesh()
  headSlots.add(setSlot(barHead(), 'alloy'), 'alloy')
  const head = new Group()
  head.add(headSlots.build(materials))
  bar.add(head)

  const hoseSlots = new SlotMesh()
  hoses(hoseSlots)
  const jumpers = new Group()
  jumpers.name = 'tram-coupling-jumpers'
  const hoseRun = new Group()
  hoseRun.position.z = REVEAL
  hoseRun.add(hoseSlots.build(materials))
  jumpers.add(hoseRun)
  group.add(jumpers)

  const socket = new Group()
  socket.name = 'tram-coupling-socket'
  socket.add(socketHousing().build(materials))

  const from = new Vector3()
  const to = new Vector3()
  const tip = new Vector3()
  const forward = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  const upA = new Vector3()
  const upB = new Vector3()
  const basis = new Matrix4()

  /** Point `target`'s +Z from `origin` at `at`, rolled about `upRef`. */
  const aim = (target: Group, origin: Vector3, at: Vector3, upRef: Vector3): number => {
    forward.subVectors(at, origin)
    const length = forward.length()
    if (length < 1e-4) return 0
    forward.divideScalar(length)
    right.crossVectors(upRef, forward)
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    up.crossVectors(forward, right)
    basis.makeBasis(right, up, forward)
    target.position.copy(origin)
    target.quaternion.setFromRotationMatrix(basis)
    return length
  }

  return {
    group,
    socket,
    update(front, rear) {
      from.copy(FRONT_TIP).applyMatrix4(front.matrixWorld)
      to.copy(REAR_SEAT).applyMatrix4(rear.matrixWorld)
      tip.copy(REAR_TIP).applyMatrix4(rear.matrixWorld)
      // Roll reference: the mean of the two cars' local up, so the coupling
      // banks with the pair instead of taking an arbitrary roll from a
      // look-at (the hoses would otherwise swap sides through a grade change).
      upA.set(0, 1, 0).applyQuaternion(front.quaternion)
      upB.set(0, 1, 0).applyQuaternion(rear.quaternion)
      upA.add(upB).normalize()

      const length = aim(bar, from, to, upA)
      if (length < 1e-4) return
      // Telescope: the ball is ALWAYS exactly on the socket's seat, and the
      // shaft and boot take up the difference.
      head.position.z = length
      run.scale.z = Math.max(0.02, length - ROOT_END - SHAFT_GAP)

      const reach = aim(jumpers, from, tip, upA)
      hoseRun.scale.z = Math.max(0.05, reach - 2 * REVEAL)
      group.updateMatrixWorld(true)
    },
  }
}
