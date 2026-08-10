import { Group, Mesh, PlaneGeometry, Vector3 } from 'three'
import { bench, canopy, guardrail, lampPost, signTotem, stairFlight } from '../archkit/kit'
import { PartWriter } from '../archkit/writer'
import { kitMaterials, signageMaterial } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { InteractionSystem } from '../player/interaction'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from './interiorHeight'
import { PORTAL_STATION } from './parkPlan'

/**
 * Portal Station — the archkit hero test (S7) and the arrival platform (S9).
 * The platform sits INSIDE the loop; the tram passes its south edge. The
 * whole assembly is a handful of merged slot meshes from one PartWriter.
 */
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
    const cx = PORTAL_STATION.x
    const cz = PORTAL_STATION.z
    const deckY = PORTAL_STATION.y
    const width = PORTAL_STATION.width // x extent
    const depth = PORTAL_STATION.depth // z extent

    // ---- Platform slab: deck surface + skirt down into the grade.
    writer.box({
      center: new Vector3(cx, deckY - 0.35, cz),
      size: new Vector3(width, 0.7, depth),
      slot: 'deck',
      chamferSlot: 'steelEdge',
      chamfer: 0.03,
      uvScale: 0.5,
    })
    // Skirt band (visually closes the slab to the sloping regolith).
    writer.box({
      center: new Vector3(cx, deckY - 0.86, cz),
      size: new Vector3(width - 0.4, 0.4, depth - 0.4),
      slot: 'dark',
      chamfer: 0.02,
    })

    // ---- Tactile warning strip along the tram edge (south, z+).
    writer.box({
      center: new Vector3(cx, deckY + 0.012, cz + depth / 2 - 0.45),
      size: new Vector3(width - 2.4, 0.024, 0.7),
      slot: 'orange',
      chamfer: 0.008,
      uvScale: 2,
    })

    // ---- Canopy over the waiting area.
    canopy(writer, new Vector3(cx, deckY, cz - 1), 26, 9, 3.5)

    // ---- Guardrails: everywhere except the tram edge and the north stair.
    const railY = deckY
    const west = cx - width / 2 + 0.12
    const east = cx + width / 2 - 0.12
    const north = cz - depth / 2 + 0.12
    const south = cz + depth / 2 - 0.12
    const stairHalfWidth = 2.6
    guardrail(writer, [new Vector3(west, railY, south - 0.9), new Vector3(west, railY, north)])
    guardrail(writer, [new Vector3(east, railY, north), new Vector3(east, railY, south - 0.9)])
    guardrail(writer, [
      new Vector3(west, railY, north),
      new Vector3(cx - stairHalfWidth, railY, north),
    ])
    guardrail(writer, [
      new Vector3(cx + stairHalfWidth, railY, north),
      new Vector3(east, railY, north),
    ])

    // ---- North stairs down to the apron pad (deterministic 4-step drop).
    const footY = 0.72
    const rise = (deckY - footY) / 4
    const steps = 4
    const flightOrigin = new Vector3(cx, footY, cz - depth / 2 - steps * 0.29)
    stairFlight(writer, {
      origin: flightOrigin,
      yaw: Math.PI, // climbing southward up to the deck
      steps,
      rise,
      width: stairHalfWidth * 2 - 0.3,
    })

    // ---- Benches under the canopy (registered as seats).
    const benchSeats: Array<{ seat: Vector3; yaw: number }> = []
    for (const bx of [-8, 0, 8]) {
      benchSeats.push(bench(writer, new Vector3(cx + bx, deckY, cz - 3.4), Math.PI))
    }

    // ---- Lamps at the corners.
    for (const [lx, lz] of [
      [west + 1.2, north + 1.4],
      [east - 1.2, north + 1.4],
      [west + 1.2, south - 1.6],
      [east - 1.2, south - 1.6],
    ]) {
      lampPost(writer, new Vector3(lx as number, deckY, lz as number))
    }

    // ---- Sign totem where the stairs meet the path (face toward arrivals).
    const totem = signTotem(
      writer,
      new Vector3(cx + 4.6, interiorHeight(cx + 4.6, cz - depth / 2 - 5), cz - depth / 2 - 5),
      -0.06,
      { width: 2.3, height: 0.72, centerY: 1.7 },
    )

    const materials = kitMaterials()
    const built = writer.build(materials)
    this.group.add(built)

    // Sign face plate (6 mm proud of the totem body — no coplanar contact).
    const face = new Mesh(
      new PlaneGeometry(totem.width, totem.height),
      signageMaterial(['ELYSIUM COMMONS', 'PORTAL STATION · GATE S'], {
        accent: '#c94f1d',
      }),
    )
    face.position.copy(totem.faceCenter)
    face.rotation.y = totem.yaw
    face.castShadow = false
    this.group.add(face)

    // Hanging boards under the canopy fascia.
    const hanging = new Mesh(
      new PlaneGeometry(4.2, 0.62),
      signageMaterial(['THE LOOP · TRAM 01', 'MIND THE PLATFORM EDGE'], {
        background: '#24221f',
        accent: '#c94f1d',
        widthPx: 768,
      }),
    )
    hanging.position.set(cx, deckY + 2.6, cz + 2.9)
    hanging.rotation.y = Math.PI
    this.group.add(hanging)

    ctx.scene.add(this.group)

    // ---- Colliders.
    const world = this.physics.world
    const api = this.physics.api
    if (world && api) {
      const staticBody = world.createRigidBody(api.RigidBodyDesc.fixed())
      world.createCollider(
        api.ColliderDesc.cuboid(width / 2, 0.35, depth / 2).setTranslation(cx, deckY - 0.35, cz),
        staticBody,
      )
      // Stair ramp: one rotated cuboid approximating the flight.
      const stairLength = steps * 0.29
      const stairRise = steps * rise
      const rampAngle = Math.atan2(stairRise, stairLength)
      const rampLength = Math.hypot(stairLength, stairRise)
      world.createCollider(
        api.ColliderDesc.cuboid(stairHalfWidth - 0.15, 0.06, rampLength / 2)
          .setTranslation(
            cx,
            footY + stairRise / 2 - 0.03,
            cz - depth / 2 - stairLength / 2,
          )
          .setRotation(quaternionFromPitch(-rampAngle)),
        staticBody,
      )
      // Canopy columns.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          world.createCollider(
            api.ColliderDesc.cylinder(1.75, 0.1).setTranslation(
              cx + 12.4 * sx,
              deckY + 1.75,
              cz - 1 + 4 * sz,
            ),
            staticBody,
          )
        }
      }
      // Guardrail lines as thin walls (west, east, north segments).
      const rails: Array<[number, number, number, number]> = [
        [west, north, west, south - 0.9],
        [east, north, east, south - 0.9],
        [west, north, cx - stairHalfWidth, north],
        [cx + stairHalfWidth, north, east, north],
      ]
      for (const [x1, z1, x2, z2] of rails) {
        const midX = (x1 + x2) / 2
        const midZ = (z1 + z2) / 2
        const length = Math.hypot(x2 - x1, z2 - z1)
        const yaw = Math.atan2(x2 - x1, z2 - z1)
        world.createCollider(
          api.ColliderDesc.cuboid(0.05, 0.6, length / 2)
            .setTranslation(midX, deckY + 0.6, midZ)
            .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
          staticBody,
        )
      }
    }

    // ---- Seats.
    if (this.player && this.interaction) {
      const player = this.player
      for (const seat of benchSeats) {
        this.interaction.register({
          position: seat.seat.clone().add(new Vector3(0, 0.5, 0)),
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

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

function quaternionFromPitch(pitch: number): { x: number; y: number; z: number; w: number } {
  return { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) }
}
