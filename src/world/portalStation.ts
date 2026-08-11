import {
  CanvasTexture,
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { Material } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { bench } from '../archkit/kit'
import { PartWriter } from '../archkit/writer'
import { cabinGlass, kitMaterials, tracked } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import {
  buildTrackData,
  carFloorY,
  emitPlatformEdge,
  guidewayColliders,
  leaningRail,
  litterBin,
  platformDeckY,
  platformOutward,
  platformPoint,
  platformTangent,
  stationSign,
  PLATFORM_EDGE_OFFSET,
} from '../tram/track'
import type { ArcPlatform } from '../tram/track'
import { slabTop } from './paving'
import { LOOP, PORTAL_STATION } from './parkPlan'
import {
  CANOPY_ARC,
  CANOPY_BAYS,
  CANOPY_HEIGHT,
  DECK_ARC,
  DECK_DEPTH,
  RAMP,
  RAMP_OPENING,
  SCREEN_H,
  SCREEN_V,
  V_CANOPY_BACK,
  V_COLUMN,
  V_FRONT,
  buildFlight,
  buildRamp,
  buildWindbreak,
  emitDeckSlab,
  flightApron,
  glazedCanopy,
  planEndFlight,
  planGrandFlight,
  planRamp,
  rafterSoffit,
  screenRuns,
  yawOf,
} from './stationArchitecture'
import type { FlightPlan, RampPlan } from './stationArchitecture'

/**
 * PORTAL STATION — the terminus the player arrives at, and the one piece of
 * architecture they stand on before they stand on anything else.
 *
 * DATUM STACK, all derived, nothing hardcoded:
 *   channel floor   slabTop(0,97) − recess    (the paving agent's channel)
 *   cabin floor     channel floor + 0.62      (`track.carFloorY`)
 *   platform deck   cabin floor − 0.02        the 20 mm step a platform has
 *   terrace         slabTop                   the poured forecourt
 *   Meridian walk   slabTop                   the 6 m kerbed spine south
 *
 * Circulation, enclosure and the reasons behind their geometry live in
 * `stationArchitecture.ts`; this file is the SYSTEM — it assembles, dresses
 * and collides them.
 *
 * The deck is not level: `groundGrade` moves under the boulevard, the guideway
 * follows it, and the deck follows the guideway. Every element is placed at
 * `platformDeckY(u)`, never at one stored number.
 */

/** Bearing where the station name board hangs, and how big it may be: the
 *  soffit has to clear 2.30 m over the front walk line AND tuck under the
 *  rafters (which is why `CANOPY_HEIGHT` went to 3.6). */
const SIGN = { v: V_FRONT + 0.35, width: 4.6, height: 0.72, lift: 2.76 }

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

    emitDeckSlab(writer, spec)
    emitPlatformEdge(writer, spec)
    glazedCanopy(writer, spec)
    buildWindbreak(writer, spec)

    // ---- circulation. Every leg is PLANNED first (so its numbers can be
    // asserted) and only then built.
    const grand = planGrandFlight(spec)
    buildFlight(writer, grand)
    flightApron(writer, grand, 1.6)

    const ends: FlightPlan[] = []
    for (const sign of [-1, 1]) {
      const plan = planEndFlight(spec, sign)
      ends.push(plan)
      buildFlight(writer, plan)
      flightApron(writer, plan, 2.2)
    }

    const ramp = planRamp(spec)
    buildRamp(writer, spec, ramp)

    // ---- dressing, all of it clear of the routes above.
    const benchSeats: Array<{ seat: Vector3; yaw: number }> = []
    for (const u of [-6.4, -4.0, 4.7]) {
      const outward = platformOutward(spec, u)
      benchSeats.push(
        bench(
          writer,
          platformPoint(spec, u, 5.15, platformDeckY(spec, u) - 0.008),
          Math.atan2(-outward.x, -outward.z),
        ),
      )
    }
    // Bins hard against the screen (r 0.285 → they reach v 5.57–6.14), so the
    // back walk line at v ≈ 4.9 stays clear along the whole deck.
    for (const u of [-8.4, 3.4]) {
      litterBin(writer, platformPoint(spec, u, 5.85, platformDeckY(spec, u)))
    }
    for (const u of [-5.0, 5.0]) leaningRail(writer, spec, u, 1.5)

    // ---- signage. The board hangs from the rafters; its soffit is solved
    // against the 2.30 m headroom rule, not eyeballed.
    const signY = platformDeckY(spec, 0) + SIGN.lift
    const hang = rafterSoffit(spec, 0, SIGN.v) - 0.02 - (signY + SIGN.height / 2 + 0.07)
    stationSign(writer, this.group, spec, 0, SIGN.v, 'PORTAL STATION', {
      width: SIGN.width,
      height: SIGN.height,
      lines: ['PORTAL STATION', 'GATE S · ELYSIUM COMMONS'],
      y: signY,
      hang: Math.max(0.12, hang),
    })
    departureBoard(writer, this.group, spec, -7.6)

    const materials: Record<string, Material> = {
      ...(kitMaterials() as unknown as Record<string, Material>),
      stationGlass: cabinGlass(),
    }
    this.group.add(writer.build(materials))
    ctx.scene.add(this.group)

    this.buildColliders(spec, grand, ends, ramp)

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
   * Colliders. They MIRROR the visual build: deck, three flights and their
   * aprons, the ramp's landing and run, the screen RUNS (with the openings —
   * the old five-box wall sealed both egresses), canopy columns, and the
   * arrival girder's own boxes from `track.ts`.
   *
   * Frame note that cost a rebuild once: `box`'s yaw sends LOCAL +Z to the
   * given direction, so anything marching along the arc has the TANGENT as
   * local +Z and its depth as local +X.
   */
  private buildColliders(
    spec: ArcPlatform,
    grand: FlightPlan,
    ends: FlightPlan[],
    ramp: RampPlan,
  ): void {
    const world = this.physics.world
    const api = this.physics.api
    if (!world || !api) return
    const body = world.createRigidBody(api.RigidBodyDesc.fixed())
    const half = DECK_ARC / 2
    const box = (centre: Vector3, halfExtents: Vector3, pitch: number, yaw: number): void => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
      world.createCollider(
        api.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
          .setTranslation(centre.x, centre.y, centre.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        body,
      )
    }
    /**
     * A collider whose TOP FACE is exactly the segment `a → b`, `halfAcross`
     * wide, extended `back` metres beyond `a` so it laps its neighbour.
     *
     * The old form took a centre plus a half-height and a hand-tuned lift, and
     * measured (rapier ray, in-engine) 171 mm ABOVE the deck at the grand
     * flight's head — a step the player had to climb where the drawing says
     * flush. Naming the surface removes the whole class.
     */
    const surface = (a: Vector3, b: Vector3, halfAcross: number, back = 0.12): void => {
      const along = new Vector3(b.x - a.x, 0, b.z - a.z)
      const run = along.length()
      if (run < 1e-4) return
      along.multiplyScalar(1 / run)
      const rise = b.y - a.y
      const start = a.clone().addScaledVector(along, -back).setY(a.y - back * (rise / run))
      const mid = start.clone().lerp(b, 0.5)
      const thick = 0.3
      box(
        mid.setY(mid.y - thick / 2),
        new Vector3(halfAcross, thick / 2, Math.hypot(run + back, rise * (1 + back / run)) / 2),
        -Math.atan2(rise, run),
        yawOf(along),
      )
    }

    // The deck: SIX pitched slabs, not three level ones. The deck falls 0.171 m
    // over 9 m and level boxes tracked it to ±74 mm; pitched sixths hold it to
    // ~5 mm (the residual is the arc's own curvature).
    const DECK_BOXES = 6
    for (let i = 0; i < DECK_BOXES; i++) {
      const u0 = -half + (DECK_ARC * i) / DECK_BOXES
      const u1 = -half + (DECK_ARC * (i + 1)) / DECK_BOXES
      const uc = (u0 + u1) / 2
      const y0 = platformDeckY(spec, u0)
      const y1 = platformDeckY(spec, u1)
      const bottom = spec.baseY - 0.9
      const thick = (y0 + y1) / 2 - bottom
      const centre = platformPoint(spec, uc, DECK_DEPTH / 2, (y0 + y1) / 2 - thick / 2)
      box(
        centre,
        new Vector3(DECK_DEPTH / 2, thick / 2, DECK_ARC / DECK_BOXES / 2 + 0.06),
        -Math.atan2(y1 - y0, DECK_ARC / DECK_BOXES),
        yawOf(platformTangent(spec, uc)),
      )
    }

    // Flights: the ramp surface runs bottom tread → deck, so both ends land
    // exactly on the landing they meet.
    for (const plan of [grand, ...ends]) {
      const head = plan.foot
        .clone()
        .addScaledVector(plan.climb, plan.steps * plan.run)
        .setY(plan.foot.y + plan.steps * plan.rise + 0.015)
      surface(plan.foot, head, plan.width / 2, 0.14)
    }
    for (const [plan, depth] of [
      [grand, 1.6],
      [ends[0], 2.2],
      [ends[1], 2.2],
    ] as Array<[FlightPlan, number]>) {
      const outward = plan.climb.clone().negate()
      const far = plan.foot.clone().addScaledVector(outward, depth * 0.75)
      surface(plan.foot, far.setY(this.groundAt(far)), plan.width / 2 + 0.12, 0.05)
    }

    // Ramp: the head landing is SPLAYED, so it takes two boxes — one square to
    // the deck's arc, one square to the run — and they overlap in the middle.
    {
      const uc = (RAMP_OPENING.u0 + RAMP_OPENING.u1) / 2
      const arc = RAMP_OPENING.u1 - RAMP_OPENING.u0
      const top = platformDeckY(spec, uc)
      const centre = platformPoint(spec, uc, DECK_DEPTH + 0.6, top - 0.4)
      box(centre, new Vector3(0.7, 0.4, arc / 2), 0, yawOf(platformTangent(spec, uc)))
      const b = ramp.head.clone()
      const a = b.clone().addScaledVector(ramp.dir, -1.5)
      surface(a, b, RAMP.half, 0.1)
    }
    {
      surface(ramp.head, ramp.foot, RAMP.half, 0.05)
      const far = ramp.foot.clone().addScaledVector(ramp.dir, 1.0)
      surface(ramp.foot, far.setY(this.groundAt(far)), RAMP.half + 0.1, 0.05)
    }

    // The screen: one collider chain per RUN, plus its two returns. Nothing
    // spans an opening — that was defect 1.
    for (const run of screenRuns()) {
      const span = run.u1 - run.u0
      const pieces = Math.max(1, Math.round(span / 3.2))
      for (let i = 0; i < pieces; i++) {
        const u = run.u0 + (span * (i + 0.5)) / pieces
        const p = platformPoint(spec, u, SCREEN_V, platformDeckY(spec, u) + SCREEN_H / 2)
        box(
          p,
          new Vector3(0.08, SCREEN_H / 2, span / pieces / 2),
          0,
          yawOf(platformTangent(spec, u)),
        )
      }
      for (const u of [run.u0, run.u1]) {
        const vMid = SCREEN_V - 0.375
        const p = platformPoint(spec, u, vMid, platformDeckY(spec, u) + SCREEN_H / 2)
        box(p, new Vector3(0.08, SCREEN_H / 2, 0.375), 0, yawOf(platformOutward(spec, u)))
      }
    }

    for (let i = 0; i <= CANOPY_BAYS; i++) {
      const u = -CANOPY_ARC / 2 + (i * CANOPY_ARC) / CANOPY_BAYS
      const p = platformPoint(spec, u, V_COLUMN, platformDeckY(spec, u) + CANOPY_HEIGHT / 2)
      world.createCollider(
        api.ColliderDesc.cylinder(CANOPY_HEIGHT / 2, 0.15).setTranslation(p.x, p.y, p.z),
        body,
      )
    }

    for (const collider of guidewayColliders(buildTrackData())) {
      box(collider.center, collider.half, 0, collider.yaw)
    }
  }

  private groundAt(p: Vector3): number {
    return slabTop(p.x, p.z)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
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
  const v = V_CANOPY_BACK - 0.45
  const deck = platformDeckY(spec, u)
  const y = deck + 1.72
  const outward = platformOutward(spec, u)
  const tangent = platformTangent(spec, u)
  const yaw = Math.atan2(outward.x, outward.z)
  const width = 2.3
  const height = 1.28
  const anchor = platformPoint(spec, u, v, y)
  // Local +Z is `outward` under `placeYaw`, so local X is the board's WIDTH
  // and local Z its depth. Swapped, the cabinet was 0.16 m wide and 2.46 m
  // deep — a fin out of the middle of the board.
  writer.box({
    center: anchor,
    size: new Vector3(width + 0.16, height + 0.16, 0.16),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.016,
  })
  // Backlit reveal: bedded 35 mm INTO the bezel, 15 mm proud of its face.
  writer.box({
    center: anchor.clone().addScaledVector(outward, 0.07),
    size: new Vector3(width, height, 0.05),
    rotationY: yaw,
    slot: 'signageGlow',
  })
  for (const sign of [-1, 1]) {
    const post = anchor.clone().addScaledVector(tangent, sign * (width / 2 + 0.02))
    writer.tube({
      path: [post.clone().setY(deck - 0.03), post.clone().setY(y + height / 2 + 0.06)],
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
    departureFace(width - 0.1, height - 0.1),
  )
  // 25 mm clear of the lit reveal's face (0.095) — never on it.
  plate.position.copy(anchor.clone().addScaledVector(outward, 0.12))
  plate.rotation.y = yaw
  plate.castShadow = false
  group.add(plate)
}

/** Destination and the minutes to it — one row of the board. */
const DEPARTURES: Array<[string, string]> = [
  ['FARMSIDE', '2 MIN'],
  ['OVERLOOK WEST', '9 MIN'],
  ['PORTAL', '22 MIN'],
]

/**
 * The board draws its OWN canvas rather than going through `signageMaterial`.
 *
 * A departure board is a TABLE: destinations flush left, times flush right, on
 * a shared baseline grid. `signageMaterial` centres every line, so the only
 * way to fake columns through it was to pad each row with runs of spaces —
 * counted for a monospace font. Owning the layout also lets the header sit on
 * its own accent rule instead of being a fourth body line.
 *
 * Every measurement below is a fraction of the canvas, so the board reads the
 * same whatever `widthPx` or plate aspect it is given.
 */
function departureFace(plateW: number, plateH: number): MeshStandardNodeMaterial {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = Math.round((canvas.width * plateH) / plateW)
  const g = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  if (g) {
    const ink = '#efe9dc'
    g.fillStyle = '#171614'
    g.fillRect(0, 0, w, h)
    const short = Math.min(w, h)
    const frameInset = Math.max(4, Math.round(short * 0.049))
    const frameLine = Math.max(2, Math.round(short * 0.021))
    const pad = frameInset + frameLine + Math.max(4, Math.round(short * 0.035))
    g.globalAlpha = 0.25
    g.strokeStyle = ink
    g.lineWidth = frameLine
    g.strokeRect(frameInset, frameInset, w - 2 * frameInset, h - 2 * frameInset)
    g.globalAlpha = 1
    g.textBaseline = 'middle'

    // Header on its own rule. `fit` shrinks to the box rather than trusting a
    // character count — the tracking is a hair-space pair, which measures at
    // 0.015 em, so counted budgets are ~1.8x the ink actually drawn.
    const fit = (text: string, maxWidth: number, start: number, weight: number): number => {
      let size = start
      for (; size > 8; size -= 1) {
        g.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
        if (g.measureText(text).width <= maxWidth) break
      }
      return size
    }
    const headerY = pad + h * 0.1
    g.textAlign = 'left'
    g.fillStyle = ink
    g.font = `700 ${fit(tracked('DEPARTURES'), w * 0.44, h * 0.13, 700)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillText(tracked('DEPARTURES'), pad, headerY)
    g.textAlign = 'right'
    g.fillStyle = '#c9b9a2'
    g.font = `500 ${fit(tracked('THE LOOP'), w * 0.34, h * 0.095, 500)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillText(tracked('THE LOOP'), w - pad, headerY)
    g.fillStyle = '#c94f1d'
    const ruleY = Math.round(headerY + h * 0.085)
    g.fillRect(pad, ruleY, w - 2 * pad, Math.max(3, Math.round(h * 0.018)))

    // Body rows on a shared grid: ONE size for both columns of every row.
    const first = ruleY + h * 0.16
    const pitch = (h - pad - first) / Math.max(1, DEPARTURES.length - 0.35)
    const timeW = w * 0.26
    let size = h * 0.115
    for (const [name, time] of DEPARTURES) {
      size = Math.min(size, fit(tracked(name), w - 2 * pad - timeW - w * 0.03, size, 700))
      size = Math.min(size, fit(time, timeW, size, 500))
    }
    DEPARTURES.forEach(([name, time], index) => {
      const y = first + pitch * index
      g.textAlign = 'left'
      g.fillStyle = ink
      g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillText(tracked(name), pad, y)
      g.textAlign = 'right'
      g.fillStyle = '#d8c8a6'
      g.font = `500 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillText(time, w - pad, y)
    })
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  const material = new MeshStandardNodeMaterial()
  material.map = texture
  material.roughness = 0.6
  material.metalness = 0.05
  return material
}
