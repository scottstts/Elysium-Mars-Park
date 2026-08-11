import { Group, Mesh, PlaneGeometry, Quaternion, Vector2, Vector3 } from 'three'
import type { Material } from 'three'
import { bench } from '../archkit/kit'
import { SMOOTH, cleanMesh, loft, smoothShade, writeInto } from '../archkit/meshdata'
import type { Vec3 as MVec3 } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'
import { cabinGlass, kitMaterials, signageMaterial } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import {
  buildTrackData,
  carFloorY,
  emitPlatformEdge,
  emitPlatformSlab,
  guidewayColliders,
  leaningRail,
  litterBin,
  platformDeckY,
  platformOutward,
  platformPoint,
  platformTangent,
  stationSign,
  stationSteps,
  PLATFORM_EDGE_OFFSET,
} from '../tram/track'
import type { ArcPlatform } from '../tram/track'
import { interiorHeight } from './interiorHeight'
import { slabTop } from './paving'
import { LOOP, PORTAL_STATION } from './parkPlan'

/**
 * PORTAL STATION — the terminus the player arrives at, and the one piece of
 * architecture they stand on before they stand on anything else.
 *
 * DATUM STACK, all derived, nothing hardcoded:
 *   channel floor   slabTop(0,97) − 0.06   (the paving agent's guideway channel)
 *   cabin floor     channel floor + 0.62   (`track.carFloorY`)
 *   platform deck   cabin floor − 0.02     the 20 mm step down a real platform has
 *   terrace         slabTop(0,97)          the poured forecourt, 0.54 below the deck
 *   station foot    slabTop(0,87)          the 0.45 m apron on the Meridian walk
 *
 * The deck is an ARC concentric with the Loop: a straight 20 m platform edge
 * held 1.4 m off a 97 m radius reaches r = 96.2 at its ends, which is inside
 * the 2.60 m car. Everything here — canopy, screens, signage, benches, stairs
 * — is placed in the platform's (arc offset u, inward v) frame so it cannot
 * drift off the curve.
 *
 * Access, in the order a passenger meets it: step off the car onto the deck;
 * a grand flight descends off the back edge to the station-foot apron and the
 * Meridian walk (0.80 m of drop → 5 risers at 160 mm — the going is 300, and
 * the riser count is DERIVED against the code rise rather than assumed, since
 * every datum here comes out of the terrain); shorter flights at both ends
 * drop to the terrace; a 1:14 ramp behind the west end does it without steps.
 *
 * The deck is not level. `groundGrade` moves under the boulevard, the guideway
 * follows it, and the deck follows the guideway — 0.17 m over 18 m here, and
 * 0.48 m at Overlook. Every element is therefore placed at `platformDeckY(u)`,
 * never at one stored number.
 */

/** Deck depth. `PORTAL_STATION.depth` (13 m) is the TERRACE footprint — the
 *  paving agent pours that as `station-terrace`; a 13 m deck centred on the
 *  alignment would straddle the track. */
const DECK_DEPTH = 6.6
/** 18 m of deck: the boulevard planters resume ±0.115 rad off the station
 *  bearing (`pavingPlan` arcRun), and the end flights must land inside that. */
const DECK_ARC = 18
const CANOPY_ARC = 17.2
const CANOPY_HEIGHT = 3.4
/** Canopy plan: rafters run from `V_FRONT` to `V_BACK`, columns at `V_COLUMN`. */
const V_FRONT = 0.9
const V_BACK = 6.0
const V_COLUMN = 3.6
const CANOPY_BAYS = 4
/** Roof falls toward the track so the gutter is over the trackbed, not the seats. */
const ROOF_FALL = 0.05
/**
 * Access-ramp anchor (arc u). The back band has only ±11.2 m of clear arc
 * (boulevard planters resume beyond) and the grand flight owns the middle
 * 5 m — the old 13 m 1:14 run from u −7.6 ran STRAIGHT OVER the flight and
 * entombed the signposted Meridian route (traversal-audit find). At 0.38 g
 * a 1:8 grade is gentler than Earth's 1:14, so the ramp fits east of the
 * flight: u 2.7 → ~10, clear of both flight and planters.
 */
const RAMP_U0 = 2.7

export class PortalStationSystem implements GameSystem {
  readonly id = 'archkit'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem
  private readonly player: PlayerSystem | null
  private readonly interaction: InteractionSystem | null

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
    const writer = new PartWriter()
    const deckY = carFloorY(PORTAL_STATION.x, PORTAL_STATION.z) - 0.02
    const spec: ArcPlatform = {
      centreAngle: Math.PI / 2,
      arcLength: DECK_ARC,
      rEdge: LOOP.radius - PLATFORM_EDGE_OFFSET,
      depth: DECK_DEPTH,
      deckY,
      baseY: slabTop(PORTAL_STATION.x, PORTAL_STATION.z),
    }
    const half = DECK_ARC / 2

    emitPlatformSlab(writer, spec)
    emitPlatformEdge(writer, spec)
    glazedCanopy(writer, spec)
    windbreak(writer, spec)

    // ---- seating under the canopy, facing the arriving car.
    const benchSeats: Array<{ seat: Vector3; yaw: number }> = []
    for (const u of [-6.6, -2.2, 2.2, 6.6]) {
      const outward = platformOutward(spec, u)
      benchSeats.push(
        bench(
          writer,
          platformPoint(spec, u, 5.15, platformDeckY(spec, u) - 0.008),
          Math.atan2(-outward.x, -outward.z),
        ),
      )
    }
    for (const u of [-8.2, 8.2]) {
      litterBin(writer, platformPoint(spec, u, 5.4, platformDeckY(spec, u)))
    }
    for (const u of [-5.0, 5.0]) leaningRail(writer, spec, u, 1.5)

    // ---- signage + departure board.
    stationSign(writer, this.group, spec, 0, V_FRONT + 0.25, 'PORTAL STATION', {
      width: 5.2,
      height: 0.82,
      lines: ['PORTAL STATION', 'GATE S · ELYSIUM COMMONS'],
      y: platformDeckY(spec, 0) + 2.62,
      hang: CANOPY_HEIGHT - 2.62 - 0.34,
    })
    departureBoard(writer, this.group, spec, -7.4)

    // ---- stairs. The grand flight descends off the back edge to the
    // station-foot apron; end flights drop to the terrace.
    const backR = spec.rEdge - DECK_DEPTH
    // Riser counts are DERIVED against the code rise (165 grand / 155 end):
    // the deck datum comes from the guideway and the aprons from the pour, so
    // neither drop is ever a round number. 0.80 m here → 5 × 160 mm.
    const grandSteps = Math.max(3, Math.min(8, Math.round((deckY - slabTop(0, backR - 2)) / 0.165)))
    const footZ = backR - 0.08 - grandSteps * 0.3
    const footY = slabTop(0, footZ)
    stationSteps(writer, {
      foot: new Vector3(0, footY, footZ),
      climb: new Vector3(0, 0, 1),
      across: new Vector3(1, 0, 0),
      steps: grandSteps,
      rise: (deckY - footY) / grandSteps,
      run: 0.3,
      width: 5.0,
    })
    const endRise: number[] = []
    const endSteps: number[] = []
    for (const sign of [-1, 1]) {
      const u = sign * (half + 0.08)
      const tangent = platformTangent(spec, u)
      const head = platformDeckY(spec, u)
      const probe = platformPoint(spec, u, DECK_DEPTH / 2, 0).addScaledVector(tangent, sign * 1.0)
      const steps = Math.max(2, Math.min(5, Math.round((head - slabTop(probe.x, probe.z)) / 0.145)))
      const foot = platformPoint(spec, u, DECK_DEPTH / 2, 0).addScaledVector(
        tangent,
        sign * steps * 0.32,
      )
      const y = slabTop(foot.x, foot.z)
      endRise.push((head - y) / steps)
      endSteps.push(steps)
      stationSteps(writer, {
        foot: foot.setY(y),
        climb: tangent.clone().multiplyScalar(-sign),
        across: platformOutward(spec, u),
        steps,
        rise: (head - y) / steps,
        run: 0.32,
        width: 3.2,
      })
    }
    // ---- 1:8 ramp behind the east half (see RAMP_U0 for why not 1:14 west).
    const rampFootY = slabTop(0, backR - 1)
    const rampRun = Math.min(8.2, (platformDeckY(spec, RAMP_U0) - rampFootY) * 8)
    accessRamp(writer, spec, RAMP_U0, rampRun, rampFootY)

    const materials: Record<string, Material> = {
      ...(kitMaterials() as unknown as Record<string, Material>),
      stationGlass: cabinGlass(),
    }
    this.group.add(writer.build(materials))
    ctx.scene.add(this.group)

    this.buildColliders(spec, {
      footZ,
      footY,
      grandSteps,
      endRise,
      endSteps,
      rampRun,
      rampFootY,
    })

    if (this.player && this.interaction) {
      const player = this.player
      for (const seat of benchSeats) {
        this.interaction.register({
          position: seat.seat.clone().add(new Vector3(0, 0.55, 0)),
          label: () => (player.seated ? 'Stand' : 'Sit'),
          range: 2.2,
          onUse: () => {
            if (player.seated) player.stand()
            else player.sit(seat.seat, seat.yaw)
          },
        })
      }
    }
  }

  /**
   * Colliders. The deck is three boxes along the arc (one cuboid over a 20 m
   * arc stands 0.5 m proud of the slab at its ends), the flights are pitched
   * ramps, and the elevated arrival girder gets the boxes `track.ts` derives
   * from its own alignment — `buildGuideway` has no physics handle, so the
   * owner of a world asks for them here.
   */
  private buildColliders(
    spec: ArcPlatform,
    access: {
      footZ: number
      footY: number
      grandSteps: number
      endRise: number[]
      endSteps: number[]
      rampRun: number
      rampFootY: number
    },
  ): void {
    const { footZ, footY, grandSteps, endRise, endSteps, rampRun, rampFootY } = access
    const world = this.physics.world
    const api = this.physics.api
    if (!world || !api) return
    const body = world.createRigidBody(api.RigidBodyDesc.fixed())
    const half = DECK_ARC / 2
    const deckY = spec.deckY
    const box = (
      centre: Vector3,
      halfExtents: Vector3,
      pitch: number,
      yaw: number,
    ): void => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
      world.createCollider(
        api.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
          .setTranslation(centre.x, centre.y, centre.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        body,
      )
    }
    for (let i = 0; i < 3; i++) {
      const u = -half + (DECK_ARC * (i + 0.5)) / 3
      // `box`'s yaw sends local +Z to the given direction. These three boxes'
      // centres march along the ARC, so the arc half-chunk is local +Z and the
      // depth is local +X — the frame is the tangent. Built on `outward` the
      // deck came out 90 deg round (6 m deep, 13.2 m long instead of 6.6 x 18)
      // and left a fall-through hole at each of the two seams.
      const along = platformTangent(spec, u)
      const top = platformDeckY(spec, u)
      const bottom = spec.baseY - 0.9
      const centre = platformPoint(spec, u, DECK_DEPTH / 2, (top + bottom) / 2)
      box(
        centre,
        new Vector3(DECK_DEPTH / 2, (top - bottom) / 2, DECK_ARC / 6),
        0,
        Math.atan2(along.x, along.z),
      )
    }
    // Grand flight: one pitched slab.
    const grandRun = grandSteps * 0.3
    const grandRise = deckY - footY
    box(
      new Vector3(0, (deckY + footY) / 2 + 0.08, footZ + grandRun / 2),
      new Vector3(2.5, 0.1, Math.hypot(grandRun, grandRise) / 2),
      -Math.atan2(grandRise, grandRun),
      0,
    )
    // End flights.
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1
      const steps = endSteps[i]
      const u = sign * (half + 0.08 + (steps * 0.32) / 2)
      // The flight runs off the END of the deck, i.e. along the tangent, and
      // is 3.2 m wide across it — same frame as the access ramp below, and the
      // only frame whose local +X (outward) is a legal pitch axis for it.
      const along = platformTangent(spec, u)
      const drop = steps * endRise[i]
      const centre = platformPoint(spec, u, DECK_DEPTH / 2, platformDeckY(spec, u) - drop / 2)
      box(
        centre,
        new Vector3(1.6, 0.1, (steps * 0.32) / 2 + 0.12),
        -sign * Math.atan2(drop, steps * 0.32),
        Math.atan2(along.x, along.z),
      )
    }
    // Access ramp.
    const rampHead = platformDeckY(spec, RAMP_U0)
    const rampMid = platformPoint(
      spec,
      RAMP_U0 + rampRun / 2,
      DECK_DEPTH + 0.95,
      (rampHead + rampFootY) / 2 + 0.09,
    )
    const rampTangent = platformTangent(spec, RAMP_U0 + rampRun / 2)
    box(
      rampMid,
      new Vector3(0.95, 0.1, rampRun / 2),
      Math.atan2(rampHead - rampFootY, rampRun),
      Math.atan2(rampTangent.x, rampTangent.z),
    )
    // Canopy columns and windbreak posts.
    for (let i = 0; i <= CANOPY_BAYS; i++) {
      const u = -CANOPY_ARC / 2 + (i * CANOPY_ARC) / CANOPY_BAYS
      const p = platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) + CANOPY_HEIGHT / 2)
      world.createCollider(
        api.ColliderDesc.cylinder(CANOPY_HEIGHT / 2, 0.15).setTranslation(p.x, p.y, p.z),
        body,
      )
    }
    for (let i = 0; i < 5; i++) {
      const u = -7.2 + i * 3.6
      const p = platformPoint(spec, u, V_BACK + 0.25, platformDeckY(spec, u) + 1.1)
      // The panels sit 3.6 m apart along the arc and must MEET: 3.6 m of
      // local +Z on the tangent, 0.16 m of local +X across it. On `outward`
      // each one became a 3.6 m fin pointing into the platform with a 3.4 m
      // gap beside it — five phantom walls across the concourse, and the
      // windbreak itself walk-through.
      const along = platformTangent(spec, u)
      box(p, new Vector3(0.08, 1.1, 1.8), 0, Math.atan2(along.x, along.z))
    }
    // The arrival viaduct — the only guideway a walker can collide with.
    for (const collider of guidewayColliders(buildTrackData())) {
      box(collider.center, collider.half, 0, collider.yaw)
    }
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

// ------------------------------------------------------------------ canopy --

/** Roof soffit datum. Per-u, because the deck itself carries the guideway's
 *  longitudinal fall — a level canopy would open a wedge at one end. */
function roofY(spec: ArcPlatform, u: number, v: number): number {
  return platformDeckY(spec, u) + CANOPY_HEIGHT + (v - V_FRONT) * ROOF_FALL
}

/**
 * The glazed windbreak canopy: five tapered columns, tapered rafters, four
 * purlins, a real mullion/transom grid, and glass captured under pressure
 * caps. Twelve panes; the frame is authored, not implied by a texture.
 */
function glazedCanopy(writer: PartWriter, spec: ArcPlatform): void {
  const uAt = (i: number): number => -CANOPY_ARC / 2 + (i * CANOPY_ARC) / CANOPY_BAYS
  const purlinV = [V_FRONT + 0.16, V_FRONT + 1.86, V_FRONT + 3.4, V_BACK - 0.16]

  // The rafter soffit over the column is `roofY(V_COLUMN) − 0.4`; the column
  // stops 15 mm inside it, and its foot is buried deeper than the base casting
  // so no two faces in the stack ever share a plane.
  const columnH = CANOPY_HEIGHT + (V_COLUMN - V_FRONT) * ROOF_FALL - 0.4 + 0.085
  const columnProfile: Vector2[] = [
    new Vector2(0.185, 0),
    new Vector2(0.185, 0.11),
    new Vector2(0.128, 0.19),
    new Vector2(0.104, columnH - 0.62),
    new Vector2(0.15, columnH - 0.18),
    new Vector2(0.15, columnH),
    new Vector2(0, columnH),
  ]

  for (let i = 0; i <= CANOPY_BAYS; i++) {
    const u = uAt(i)
    const tangent = platformTangent(spec, u)
    const yaw = Math.atan2(tangent.x, tangent.z)
    writer.lathe({
      center: platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) - 0.07),
      profile: columnProfile,
      slot: 'steel',
      segments: 20,
      capStart: true,
      smoothAngle: SMOOTH.turned,
    })
    writer.box({
      center: platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) + 0.03),
      size: new Vector3(0.52, 0.14, 0.52),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.014,
    })
    // Rafter: deepest over the column, tapering to both tips.
    const silhouette: Array<[number, number]> = [
      [V_FRONT, roofY(spec, u, V_FRONT) - 0.02],
      [V_BACK, roofY(spec, u, V_BACK) - 0.02],
      [V_BACK, roofY(spec, u, V_BACK) - 0.15],
      [V_COLUMN, roofY(spec, u, V_COLUMN) - 0.4],
      [V_FRONT, roofY(spec, u, V_FRONT) - 0.15],
    ]
    const ring = (offset: number): MVec3[] =>
      silhouette.map(([v, y]) => {
        const p = platformPoint(spec, u + offset, v, y)
        return [p.x, p.y, p.z] as MVec3
      })
    const md = loft([ring(-0.06), ring(0.06)], { closeV: true, capStart: true, capEnd: true })
    md.frame = 'y-up'
    smoothShade(md, SMOOTH.moulded)
    cleanMesh(md)
    writeInto(writer, 'steel', md, { uvScale: 0.7 })
  }

  // Purlins: slabs on the roof plane, not boxes. The plane rises 0.26 m from
  // eave to back, so a level box would be buried at one end and hanging at the
  // other. Each stops at the rafter faces.
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const u0 = uAt(bay) + 0.06
    const u1 = uAt(bay + 1) - 0.06
    for (const v of purlinV) {
      const top = (u: number): number => roofY(spec, u, v) - 0.026
      writer.slab(
        [
          platformPoint(spec, u0, v - 0.045, top(u0)),
          platformPoint(spec, u1, v - 0.045, top(u1)),
          platformPoint(spec, u1, v + 0.045, top(u1)),
          platformPoint(spec, u0, v + 0.045, top(u0)),
        ],
        0.2,
        'steel',
        0.6,
      )
    }
  }

  // Glazing: pane, then the pressure caps that hold it. The pane tucks 30 mm
  // under each cap, so the joint is captured rather than butted.
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    for (let row = 0; row < purlinV.length - 1; row++) {
      const u0 = uAt(bay) + 0.075
      const u1 = uAt(bay + 1) - 0.075
      const vA = purlinV[row] + 0.055
      const vB = purlinV[row + 1] - 0.055
      writer.slab(
        [
          platformPoint(spec, u0, vA, roofY(spec, u0, vA) - 0.02),
          platformPoint(spec, u1, vA, roofY(spec, u1, vA) - 0.02),
          platformPoint(spec, u1, vB, roofY(spec, u1, vB) - 0.02),
          platformPoint(spec, u0, vB, roofY(spec, u0, vB) - 0.02),
        ],
        0.014,
        'stationGlass',
      )
    }
  }
  // Pressure caps, also slabs: rafter lines run the full depth, purlin lines
  // stop 5 mm short of them so the two families never cross.
  for (let i = 0; i <= CANOPY_BAYS; i++) {
    const u = uAt(i)
    writer.slab(
      [
        platformPoint(spec, u - 0.055, V_FRONT, roofY(spec, u, V_FRONT) + 0.028),
        platformPoint(spec, u + 0.055, V_FRONT, roofY(spec, u, V_FRONT) + 0.028),
        platformPoint(spec, u + 0.055, V_BACK, roofY(spec, u, V_BACK) + 0.028),
        platformPoint(spec, u - 0.055, V_BACK, roofY(spec, u, V_BACK) + 0.028),
      ],
      0.06,
      'aluminum',
      0.6,
    )
  }
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const u0 = uAt(bay) + 0.065
    const u1 = uAt(bay + 1) - 0.065
    for (const v of purlinV) {
      const top = (u: number): number => roofY(spec, u, v) + 0.028
      writer.slab(
        [
          platformPoint(spec, u0, v - 0.055, top(u0)),
          platformPoint(spec, u1, v - 0.055, top(u1)),
          platformPoint(spec, u1, v + 0.055, top(u1)),
          platformPoint(spec, u0, v + 0.055, top(u0)),
        ],
        0.06,
        'aluminum',
        0.6,
      )
    }
  }

  // Gutter: ONE swept member along the arc. Per-bay boxes cannot follow a
  // falling deck, and their abutting ends are a coplanar pair waiting to happen.
  const gutterPath: Vector3[] = []
  for (let i = 0; i <= 12; i++) {
    const u = -CANOPY_ARC / 2 - 0.24 + ((CANOPY_ARC + 0.48) * i) / 12
    gutterPath.push(platformPoint(spec, u, V_FRONT - 0.1, roofY(spec, u, V_FRONT) - 0.12))
  }
  writer.tube({
    path: gutterPath,
    radius: 0.1,
    slot: 'dark',
    profile: [
      new Vector2(-0.095, -0.1),
      new Vector2(0.095, -0.1),
      new Vector2(0.095, 0.06),
      new Vector2(0.06, 0.1),
      new Vector2(-0.06, 0.1),
      new Vector2(-0.095, 0.06),
    ],
    smoothAngle: 34,
  })
  for (let bay = 0; bay < CANOPY_BAYS; bay++) {
    const uMid = (uAt(bay) + uAt(bay + 1)) / 2
    const span = uAt(bay + 1) - uAt(bay)
    const tangent = platformTangent(spec, uMid)
    const yaw = Math.atan2(tangent.x, tangent.z)
    for (const offset of [-0.25, 0.25]) {
      const u = uMid + offset * span
      const v = (purlinV[1] + purlinV[2]) / 2
      writer.box({
        center: platformPoint(spec, u, v, roofY(spec, u, v) - 0.29),
        size: new Vector3(0.24, 0.1, 0.24),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.014,
      })
      writer.box({
        center: platformPoint(spec, u, v, roofY(spec, u, v) - 0.35),
        size: new Vector3(0.11, 0.022, 0.11),
        rotationY: yaw,
        slot: 'utilityLight',
      })
    }
  }
}

/**
 * The windbreak screen along the back of the deck: posts, a capping rail, a
 * kick rail and glass in real frames. Left open at the west end, where the
 * access ramp lands.
 */
function windbreak(writer: PartWriter, spec: ArcPlatform): void {
  const v = V_BACK + 0.25
  const height = 2.1
  const posts = 5
  const pitch = 3.6
  for (let i = 0; i < posts; i++) {
    const u = -((posts - 1) / 2) * pitch + i * pitch
    const deckY = platformDeckY(spec, u)
    const p = platformPoint(spec, u, v, deckY)
    const tangent = platformTangent(spec, u)
    const yaw = Math.atan2(tangent.x, tangent.z)
    writer.box({
      center: p.clone().setY(deckY + height / 2 - 0.015),
      size: new Vector3(0.13, height + 0.07, 0.09),
      rotationY: yaw,
      slot: 'steel',
      chamfer: 0.01,
    })
    writer.box({
      center: p.clone().setY(deckY + 0.02),
      size: new Vector3(0.3, 0.08, 0.24),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.01,
    })
    if (i === posts - 1) continue
    const uMid = u + pitch / 2
    const deckMid = platformDeckY(spec, uMid)
    const tangentMid = platformTangent(spec, uMid)
    const yawMid = Math.atan2(tangentMid.x, tangentMid.z)
    // Glass, captured between the rails with a 20 mm bite top and bottom.
    writer.box({
      center: platformPoint(spec, uMid, v, deckMid + (0.24 + height - 0.09) / 2),
      size: new Vector3(0.014, height - 0.35, pitch - 0.34),
      rotationY: yawMid,
      slot: 'stationGlass',
    })
  }
  // Head and kick rails: ONE swept section each, through the posts. Per-bay
  // boxes on a falling deck butt at every post, which is a coplanar pair the
  // moment two neighbours disagree about the deck height by a millimetre.
  const span = (posts - 1) * pitch
  for (const [lift, halfHeight] of [
    [height - 0.06, 0.06],
    [0.22, 0.05],
  ] as const) {
    const path: Vector3[] = []
    for (let i = 0; i <= 16; i++) {
      const u = -span / 2 - 0.12 + ((span + 0.24) * i) / 16
      path.push(platformPoint(spec, u, v, platformDeckY(spec, u) + lift))
    }
    writer.tube({
      path,
      radius: halfHeight,
      slot: 'steel',
      profile: [
        new Vector2(-0.045, -halfHeight),
        new Vector2(0.045, -halfHeight),
        new Vector2(0.045, halfHeight),
        new Vector2(-0.045, halfHeight),
      ],
      smoothAngle: 34,
    })
  }
}

/** 1:14 access ramp behind the deck, with kerbs and a handrail both sides. */
function accessRamp(
  writer: PartWriter,
  spec: ArcPlatform,
  u0: number,
  rampRun: number,
  footY: number,
): void {
  const vNear = spec.depth + 0.04
  const vFar = spec.depth + 1.94
  const segments = 5
  const headY = platformDeckY(spec, u0)
  const yAt = (t: number): number => headY + 0.006 - (headY - footY - 0.02) * t
  // A RETAINED solid, not a floating deck: the ground behind the platform
  // falls away toward the station-foot apron, so each segment runs down to
  // 0.3 m below its own grade and reads as an embankment wall.
  for (let i = 0; i < segments; i++) {
    const ua = u0 + (rampRun * i) / segments
    const ub = u0 + (rampRun * (i + 1)) / segments
    const corners: [Vector3, Vector3, Vector3, Vector3] = [
      platformPoint(spec, ua, vNear, yAt(i / segments)),
      platformPoint(spec, ub, vNear, yAt((i + 1) / segments)),
      platformPoint(spec, ub, vFar, yAt((i + 1) / segments)),
      platformPoint(spec, ua, vFar, yAt(i / segments)),
    ]
    let ground = Infinity
    for (const corner of corners) ground = Math.min(ground, interiorHeight(corner.x, corner.z))
    const top = Math.min(yAt(i / segments), yAt((i + 1) / segments))
    writer.slab(corners, Math.max(0.24, top - ground + 0.3), 'cast', 0.5)
  }
  for (const v of [vNear + 0.06, vFar - 0.06]) {
    const kerb: Vector3[] = []
    const rail: Vector3[] = []
    for (let i = 0; i <= segments * 2; i++) {
      const t = i / (segments * 2)
      kerb.push(platformPoint(spec, u0 + rampRun * t, v, yAt(t) + 0.03))
      rail.push(platformPoint(spec, u0 + rampRun * t, v, yAt(t) + 0.95))
    }
    writer.tube({
      path: kerb,
      radius: 0.055,
      slot: 'dark',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
    writer.tube({
      path: rail,
      radius: 0.026,
      slot: 'orangeTop',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    for (let i = 0; i <= 3; i++) {
      const t = i / 3
      const foot = platformPoint(spec, u0 + rampRun * t, v, yAt(t) + 0.02)
      writer.tube({
        path: [foot.clone(), foot.clone().setY(foot.y + 0.93)],
        radius: 0.021,
        slot: 'dark',
        radialSegments: 8,
        capStart: true,
        capEnd: true,
      })
    }
  }
}

/**
 * Departure board: a real cabinet on twin posts with a proud bezel, a
 * recessed emissive backlight and the canvas plate 6 mm off the frame face.
 */
function departureBoard(
  writer: PartWriter,
  group: Group,
  spec: ArcPlatform,
  u: number,
): void {
  const v = V_BACK - 0.35
  const deck = platformDeckY(spec, u)
  const y = deck + 1.72
  const outward = platformOutward(spec, u)
  const tangent = platformTangent(spec, u)
  const yaw = Math.atan2(outward.x, outward.z)
  const width = 2.3
  const height = 1.28
  const anchor = platformPoint(spec, u, v, y)
  writer.box({
    center: anchor,
    size: new Vector3(0.16, height + 0.16, width + 0.16),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.016,
  })
  writer.box({
    center: anchor.clone().addScaledVector(outward, -0.062),
    size: new Vector3(0.024, height, width),
    rotationY: yaw,
    slot: 'signageGlow',
  })
  for (const sign of [-1, 1]) {
    const post = anchor.clone().addScaledVector(tangent, sign * (width / 2 + 0.02))
    writer.tube({
      path: [
        post.clone().setY(deck - 0.03),
        post.clone().setY(y + height / 2 + 0.06),
      ],
      radius: 0.042,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
    writer.box({
      center: post.clone().setY(deck + 0.03),
      size: new Vector3(0.24, 0.1, 0.24),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.01,
    })
  }
  const plate = new Mesh(
    new PlaneGeometry(width - 0.1, height - 0.1),
    signageMaterial(
      [
        'DEPARTURES · THE LOOP',
        'FARMSIDE      2 MIN',
        'OVERLOOK W    9 MIN',
        'PORTAL        22 MIN',
      ],
      {
        background: '#171614',
        accent: '#c94f1d',
        widthPx: 768,
        aspect: (width - 0.1) / (height - 0.1),
      },
    ),
  )
  plate.position.copy(anchor.clone().addScaledVector(outward, 0.086))
  plate.rotation.y = yaw
  plate.castShadow = false
  group.add(plate)
}
