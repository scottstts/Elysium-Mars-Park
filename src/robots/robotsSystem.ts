import { AdditiveBlending, Group, Sprite, Vector3 } from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import { float, mix, mrt, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { panewalkerPhi } from '../dome/latticeField'
import { markDynamic } from '../render/layers'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { PlayerSystem } from '../player/playerSystem'
import { interiorHeight } from '../world/interiorHeight'
import { GARDENS, WORKS } from '../world/parkPlan'
import { buildGroundskeeper, buildMule, buildSweeper } from './chassis'
import type { RobotRig } from './chassis'
import { buildPanewalker } from './panewalker'

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
      groundPoint(-8, 56),
      groundPoint(-2, 38),
      groundPoint(3, 20),
      groundPoint(9, 4),
      groundPoint(1, -12),
      groundPoint(-9, 20),
    ]
    const sweeperWaypoints = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2
      return groundPoint(Math.cos(angle) * 112, Math.sin(angle) * 112)
    })
    const muleWaypoints = [
      groundPoint(86, 6),
      groundPoint(56, 10),
      groundPoint(32, -22),
      groundPoint(38, -84),
      groundPoint(54, -62),
      groundPoint(72, -38),
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

    // ---- Panewalker: the dome-riding washing gantry (robots/panewalker.ts).
    const walker = buildPanewalker()
    walker.rotation.y = -(panewalkerPhi.value as number)
    ctx.scene.add(walker)
    this.panewalker = walker

    // ---- Reclaimer vapor: two soft plumes on sprite stacks.
    const reclaimerX = WORKS.machineHall.x + 6
    const reclaimerZ = WORKS.machineHall.z + WORKS.machineHall.depth / 2 + 7
    const stackTop = interiorHeight(reclaimerX, reclaimerZ) + 7.4
    for (const s of [-1, 1]) {
      for (let puff = 0; puff < 7; puff++) {
        const material = new SpriteNodeMaterial()
        material.transparent = true
        material.depthWrite = false
        material.blending = AdditiveBlending
        // Sprite in an MRT scene pass: material blending applies to the
        // `output` attachment only, so without this override the quad would
        // stamp the normal buffer across its whole rectangle (the
        // greenhouse-mist artifact). Under the pass-level alpha-authority
        // blend (render/pipeline.ts), vec4(0) means "write nothing" — the
        // G-buffer behind a plume stays exactly as if the plume were absent.
        material.mrtNode = mrt({ normal: vec4(0) })
        const seed = puff / 7
        const life = this.vaporLife.add(seed).fract()
        // Warm at the lip, cooling to dust as it entrains regolith fines.
        material.colorNode = mix(vec3(0.58, 0.55, 0.51), vec3(0.21, 0.19, 0.18), life.pow(0.7))
        // Radial falloff — a bare sprite is a hard translucent square.
        const radial = smoothstep(0.5, 0.1, uv().sub(vec2(0.5)).length())
        material.opacityNode = float(0.2)
          .mul(float(1).sub(life).pow(1.4))
          .mul(life.mul(5).min(1))
          .mul(radial)
        const sprite = new Sprite(material)
        sprite.position.set(reclaimerX + s, stackTop, reclaimerZ)
        sprite.userData.seed = seed
        sprite.userData.baseY = stackTop
        sprite.userData.baseX = reclaimerX + s
        sprite.userData.drift = Math.sin(seed * 12.9 + s) * 1.15
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
      // Wheels roll with contact speed, off each rig's OWN rolling radius —
      // the fleet no longer shares one assumed 0.18 m wheel.
      for (const w of rig.wheels) w.rotation.x += (robot.speed * dt) / rig.wheelRadius
      // Brush discs spin about their own axes (the carriage they hang from is
      // `tool`, which the working branch above still bobs).
      for (const spinner of rig.spinners) spinner.rotation.z += dt * 9
    }

    // Panewalker: glacial traverse; the shadow + swath uniforms ride along.
    const phi = ((panewalkerPhi.value as number) + dt * 0.0031) % (Math.PI * 2)
    panewalkerPhi.value = phi
    if (this.panewalker) this.panewalker.rotation.y = -phi

    this.vaporLife.value = (ctx.time.sim * 0.14) % 1
    for (const sprite of this.vapor) {
      const life = ((this.vaporLife.value as number) + sprite.userData.seed) % 1
      sprite.position.y = sprite.userData.baseY + life * 4.6
      // Plumes lean as they rise instead of stacking in a vertical column.
      sprite.position.x = sprite.userData.baseX + sprite.userData.drift * life * life
      sprite.scale.setScalar(0.55 + life * 3.1)
    }
  }
}

function groundPoint(x: number, z: number): Vector3 {
  return new Vector3(x, interiorHeight(x, z), z)
}

function dampAngle(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * Math.min(1, amount)
}
