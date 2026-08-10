import { CanvasTexture, Mesh, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { vec3 } from 'three/tsl'
import type { RobotsSystem } from '../robots/robotsSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { TramSystem } from '../tram/tramSystem'
import type { ParkAssemblySystem } from './parkAssembly'

/**
 * The Ops room's dashboards live-mirror ACTUAL game state (design canon:
 * the displays never lie). Three canvas-texture screens above the desk:
 * the Loop's real position, Dome One environment (park clock), and the
 * groundskeeping roster (bound to real robots in S11).
 */
export class OpsScreensSystem implements GameSystem {
  readonly id = 'opsScreens'

  private screens: Array<{
    canvas: HTMLCanvasElement
    texture: CanvasTexture
    draw: (ctx: GameContext) => void
  }> = []
  private accumulator = 1

  private readonly assembly: ParkAssemblySystem
  private readonly tram: TramSystem
  private readonly robots: RobotsSystem | null

  constructor(assembly: ParkAssemblySystem, tram: TramSystem, robots: RobotsSystem | null) {
    this.assembly = assembly
    this.tram = tram
    this.robots = robots
  }

  init(ctx: GameContext): void {
    const anchor = this.assembly.opsAnchor
    if (!anchor) return
    const yaw = anchor.yaw
    const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))

    const definitions: Array<{ title: string; draw: (g: CanvasRenderingContext2D, ctx: GameContext) => void }> = [
      {
        title: 'THE LOOP',
        draw: (g, gameCtx) => {
          void gameCtx
          const tram = this.tram as unknown as {
            phase: string
            loopS: number
            arrivalS: number
            speed: number
            track: { loopLength: number } | null
          }
          g.font = '600 26px "Helvetica Neue"'
          g.fillStyle = '#8fd0a8'
          const phase = tram.phase.toUpperCase()
          g.fillText(`SERVICE ${phase}`, 24, 88)
          g.fillText(`SPEED ${tram.speed.toFixed(1)} M/S`, 24, 126)
          // Loop diagram with the live tram dot.
          const cx = 384
          const cy = 140
          const r = 74
          g.strokeStyle = '#4a5a50'
          g.lineWidth = 6
          g.beginPath()
          g.arc(cx, cy, r, 0, Math.PI * 2)
          g.stroke()
          if (tram.track) {
            const t = (tram.loopS / tram.track.loopLength) * Math.PI * 2
            const angle = Math.PI / 2 - t
            g.fillStyle = '#ffb36b'
            g.beginPath()
            g.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 9, 0, Math.PI * 2)
            g.fill()
          }
          for (const [sx, sy] of [
            [cx, cy + r],
            [cx + r, cy + 4],
            [cx - r, cy - 6],
          ]) {
            g.fillStyle = '#cfd8c8'
            g.beginPath()
            g.arc(sx as number, sy as number, 4, 0, Math.PI * 2)
            g.fill()
          }
        },
      },
      {
        title: 'DOME ONE · ENV',
        draw: (g, gameCtx) => {
          g.font = '600 26px "Helvetica Neue"'
          g.fillStyle = '#8fd0a8'
          g.fillText('PRESSURE 71.2 KPA', 24, 88)
          g.fillText('O₂ 23.1 % · CO₂ 0.38 %', 24, 126)
          g.fillText('AIR 21.4 °C · RH 34 %', 24, 164)
          const sols = 214
          const clock = gameCtx.time.sim
          const mm = Math.floor(clock / 60) % 60
          const ss = Math.floor(clock % 60)
          g.fillStyle = '#cfd8c8'
          g.fillText(
            `SOL ${sols} · SHIFT ${String(14 + Math.floor(clock / 3600)).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
            24,
            214,
          )
          g.fillStyle = '#5f6f65'
          g.fillText('ALL SYSTEMS NOMINAL', 24, 252)
        },
      },
      {
        title: 'GROUNDSKEEPING',
        draw: (g) => {
          g.font = '600 24px "Helvetica Neue"'
          const roster = this.robotRoster()
          let y = 88
          for (const line of roster) {
            g.fillStyle = line.includes('·') ? '#8fd0a8' : '#cfd8c8'
            g.fillText(line, 24, y)
            y += 36
          }
        },
      },
    ]

    for (let i = 0; i < definitions.length; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 288
      const texture = new CanvasTexture(canvas)
      texture.colorSpace = SRGBColorSpace
      const material = new MeshStandardNodeMaterial()
      material.map = texture
      material.emissiveMap = texture
      material.emissiveIntensity = 1.1
      material.emissiveNode = null
      material.emissive.set(0xffffff)
      material.roughness = 0.3
      material.colorNode = vec3(0.08, 0.09, 0.085)
      const screen = new Mesh(new PlaneGeometry(1.15, 0.66), material)
      screen.position
        .copy(anchor.position)
        .add(new Vector3(0, 1.86, 0))
        .addScaledVector(along, (i - 1) * 1.3)
        .addScaledVector(across, -1.52)
      screen.rotation.y = yaw + Math.PI
      ctx.scene.add(screen)

      const definition = definitions[i]
      this.screens.push({
        canvas,
        texture,
        draw: (gameCtx) => {
          const g = canvas.getContext('2d')
          if (!g) return
          g.fillStyle = '#101614'
          g.fillRect(0, 0, canvas.width, canvas.height)
          g.strokeStyle = '#31413a'
          g.lineWidth = 3
          g.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
          g.fillStyle = '#cfd8c8'
          g.font = '700 30px "Helvetica Neue"'
          g.fillText(definition.title, 24, 46)
          definition.draw(g, gameCtx)
          texture.needsUpdate = true
        },
      })
    }
  }

  /** Live from the fleet — the screens never lie. */
  robotRoster(): string[] {
    return this.robots?.roster() ?? ['FLEET OFFLINE']
  }

  update(ctx: GameContext, dt: number): void {
    this.accumulator += dt
    if (this.accumulator < 0.7) return
    this.accumulator = 0
    for (const screen of this.screens) screen.draw(ctx)
  }
}
