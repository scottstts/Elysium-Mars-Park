import { AdditiveBlending, Group, Sprite, Vector3 } from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import { float, mix, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import { PartWriter } from '../archkit/writer'
import {
  DOME_SPHERE_RADIUS,
  DOME_CENTER_Y,
  PANEWALKER_THETA_MAX,
  PANEWALKER_THETA_MIN,
  panewalkerPhi,
} from '../dome/latticeField'
import { kitMaterials } from '../materials/library'
import { markDynamic } from '../render/layers'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { PlayerSystem } from '../player/playerSystem'
import { interiorHeight } from '../world/interiorHeight'
import { GARDENS, WORKS } from '../world/parkPlan'
import { buildGroundskeeper, buildMule, buildSweeper } from './chassis'
import type { RobotRig } from './chassis'

/**
 * The only moving life (design canon): two groundskeepers, a sweeper, the
 * cargo mule — each a character through work alone — plus the Panewalker
 * high on the glass and the reclaimer's vapor. Kinematic waypoint routines
 * with working pauses; wheels roll with real contact speed.
 */

interface GroundRobot {
  id: string
  rig: RobotRig
  waypoints: Vector3[]
  index: number
  speed: number
  pauseSeconds: [number, number]
  pauseRemaining: number
  state: 'moving' | 'working'
  toolPhase: number
}

export class RobotsSystem implements GameSystem {
  readonly id = 'robots'

  private readonly robots: GroundRobot[] = []
  private panewalker: Group | null = null
  private readonly player: PlayerSystem | null
  private vapor: Sprite[] = []
  private readonly vaporLife = uniform(0)

  constructor(player: PlayerSystem | null) {
    this.player = player
  }

  init(ctx: GameContext): void {
    const rng = ctx.rng.fork('robots')

    // ---- Ground fleet.
    const gardens = GARDENS[0]
    const gk1Waypoints = Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * Math.PI * 2
      const radius = gardens.radius * (0.45 + 0.3 * ((i % 3) / 2))
      return groundPoint(gardens.x + Math.cos(angle) * radius, gardens.z + Math.sin(angle) * radius)
    })
    const gk2Waypoints = [
      groundPoint(-16, 96),
      groundPoint(-4, 60),
      groundPoint(4, 30),
      groundPoint(14, 6),
      groundPoint(2, -18),
      groundPoint(-16, 32),
    ]
    const sweeperWaypoints = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2
      return groundPoint(Math.cos(angle) * 233, Math.sin(angle) * 233)
    })
    const muleWaypoints = [
      groundPoint(150, 8),
      groundPoint(96, 12),
      groundPoint(56, -40),
      groundPoint(66, -152),
      groundPoint(96, -120),
      groundPoint(130, -60),
    ]

    const fleet: Array<[string, RobotRig, Vector3[], number, [number, number]]> = [
      ['GK-01', buildGroundskeeper('GK-01', false), gk1Waypoints, 0.55, [6, 13]],
      ['GK-02', buildGroundskeeper('GK-02', true), gk2Waypoints, 0.55, [5, 11]],
      ['SWEEP-1', buildSweeper(), sweeperWaypoints, 0.95, [2, 4]],
      ['MULE-1', buildMule(), muleWaypoints, 1.45, [8, 18]],
    ]
    for (const [id, rig, waypoints, speed, pauseSeconds] of fleet) {
      const start = waypoints[0]
      rig.group.position.copy(start)
      markDynamic(rig.group)
      ctx.scene.add(rig.group)
      this.robots.push({
        id,
        rig,
        waypoints,
        index: 1,
        speed,
        pauseSeconds,
        pauseRemaining: rng.range(0, 4),
        state: 'working',
        toolPhase: rng.range(0, 6),
      })
    }

    // ---- Panewalker: an exterior gantry truss spanning its θ band.
    const writer = new PartWriter()
    const spans = 12
    for (let i = 0; i < spans; i++) {
      const theta0 = PANEWALKER_THETA_MIN + ((PANEWALKER_THETA_MAX - PANEWALKER_THETA_MIN) * i) / spans
      const theta1 = PANEWALKER_THETA_MIN + ((PANEWALKER_THETA_MAX - PANEWALKER_THETA_MIN) * (i + 1)) / spans
      const p0 = shellPoint(theta0, 0.55)
      const p1 = shellPoint(theta1, 0.55)
      writer.tube({ path: [p0, p1], radius: 0.24, slot: 'steel', radialSegments: 10 })
      writer.tube({
        path: [shellPoint(theta0, 1.35), shellPoint(theta1, 1.35)],
        radius: 0.18,
        slot: 'steel',
        radialSegments: 8,
      })
      writer.tube({ path: [shellPoint(theta0, 0.55), shellPoint(theta0, 1.35)], radius: 0.1, slot: 'orange', radialSegments: 8 })
      // Diagonal brace.
      writer.tube({ path: [shellPoint(theta0, 1.35), shellPoint(theta1, 0.55)], radius: 0.07, slot: 'steel', radialSegments: 6 })
    }
    // Brush carriages against the glass — chunky service pods so the rig
    // reads as a silhouette from the park floor 150 m below.
    for (const carriageTheta of [0.36, 0.46, 0.56]) {
      writer.box({
        center: shellPoint(carriageTheta, 0.45),
        size: new Vector3(2.3, 0.9, 1.3),
        slot: 'aluminum',
        chamfer: 0.06,
      })
      writer.box({
        center: shellPoint(carriageTheta, 0.14),
        size: new Vector3(2.5, 0.24, 0.7),
        slot: 'fabricRust',
        chamfer: 0.05,
      })
    }
    const walker = new Group()
    walker.add(writer.build(kitMaterials(), { castShadow: false }))
    ctx.scene.add(walker)
    this.panewalker = walker

    // ---- Reclaimer vapor: two soft plumes on sprite stacks.
    const reclaimerX = WORKS.machineHall.x + 6
    const reclaimerZ = WORKS.machineHall.z + WORKS.machineHall.depth / 2 + 7
    const stackTop = interiorHeight(reclaimerX, reclaimerZ) + 7.4
    for (const s of [-1, 1]) {
      for (let puff = 0; puff < 6; puff++) {
        const material = new SpriteNodeMaterial()
        material.transparent = true
        material.depthWrite = false
        material.blending = AdditiveBlending
        const seed = puff / 6
        const life = this.vaporLife.add(seed).fract()
        material.colorNode = mix(vec3(0.5, 0.47, 0.44), vec3(0.2, 0.19, 0.18), life)
        // Radial falloff — a bare sprite is a hard translucent square.
        const radial = smoothstep(0.5, 0.14, uv().sub(vec2(0.5)).length())
        material.opacityNode = float(0.22)
          .mul(float(1).sub(life))
          .mul(life.mul(4).min(1))
          .mul(radial)
        const sprite = new Sprite(material)
        sprite.position.set(reclaimerX + s, stackTop, reclaimerZ)
        sprite.userData.seed = seed
        sprite.userData.baseY = stackTop
        sprite.scale.setScalar(1.3)
        ctx.scene.add(sprite)
        this.vapor.push(sprite)
      }
    }
  }

  /** Live roster for the Ops dashboards — the screens never lie. */
  roster(): string[] {
    const lines = this.robots.map((robot) => {
      const task = robot.state === 'working' ? 'WORKING' : 'EN ROUTE'
      return `${robot.id} · ${task}`
    })
    lines.push(`PANEWALKER · φ ${(panewalkerPhi.value as number).toFixed(2)} RAD`)
    return lines
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (ctx.time.paused) return

    for (const robot of this.robots) {
      const rig = robot.rig
      if (robot.state === 'working') {
        robot.pauseRemaining -= dt
        robot.toolPhase += dt
        if (rig.tool) {
          // Rake/brush bob while working.
          rig.tool.rotation.x = Math.sin(robot.toolPhase * 2.2) * 0.14
        }
        if (robot.pauseRemaining <= 0) robot.state = 'moving'
        continue
      }
      const target = robot.waypoints[robot.index]
      const position = rig.group.position
      const toTarget = new Vector3().subVectors(target, position)
      toTarget.y = 0
      const distance = toTarget.length()
      // Yield politely to the walking player.
      const player = this.player
      if (player && !player.seated) {
        const toPlayer = new Vector3().subVectors(player.eye, position)
        toPlayer.y = 0
        if (toPlayer.length() < 1.7) {
          continue
        }
      }
      if (distance < 0.35) {
        robot.index = (robot.index + 1) % robot.waypoints.length
        robot.state = 'working'
        robot.pauseRemaining =
          robot.pauseSeconds[0] +
          ((robot.toolPhase * 997) % 1) * (robot.pauseSeconds[1] - robot.pauseSeconds[0])
        continue
      }
      toTarget.normalize()
      const step = Math.min(distance, robot.speed * dt)
      position.addScaledVector(toTarget, step)
      position.y = interiorHeight(position.x, position.z)
      const targetYaw = Math.atan2(toTarget.x, toTarget.z)
      rig.group.rotation.y = dampAngle(rig.group.rotation.y, targetYaw, 4 * dt)
      // Wheels roll with contact speed.
      for (const w of rig.wheels) w.rotation.x += (robot.speed * dt) / 0.18
      if (rig.tool && robot.id === 'SWEEP-1') rig.tool.rotation.z += dt * 9
    }

    // Panewalker: glacial traverse; the shadow + swath uniforms ride along.
    const phi = ((panewalkerPhi.value as number) + dt * 0.0031) % (Math.PI * 2)
    panewalkerPhi.value = phi
    if (this.panewalker) this.panewalker.rotation.y = -phi

    this.vaporLife.value = (ctx.time.sim * 0.14) % 1
    for (const sprite of this.vapor) {
      const life = ((this.vaporLife.value as number) + sprite.userData.seed) % 1
      sprite.position.y = sprite.userData.baseY + life * 4.2
      sprite.scale.setScalar(0.7 + life * 2.6)
    }
  }
}

function groundPoint(x: number, z: number): Vector3 {
  return new Vector3(x, interiorHeight(x, z), z)
}

/** Point on the dome shell at longitude 0, lifted radially outward. */
function shellPoint(theta: number, lift: number): Vector3 {
  const r = DOME_SPHERE_RADIUS + lift
  return new Vector3(Math.sin(theta) * r, DOME_CENTER_Y + Math.cos(theta) * r, 0)
}

function dampAngle(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * Math.min(1, amount)
}
