import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'

interface StatsLike {
  dom: HTMLElement
  init(renderer: unknown): Promise<void> | void
  update(): void
}

/**
 * ?debug overlay: stats-gl panels + a live dataset snapshot on the canvas
 * element (`canvas.dataset.performance`) that automation can read without
 * screen-scraping. Loaded dynamically so the shipped path never pays for it.
 */
export class DebugOverlaySystem implements GameSystem {
  readonly id = 'debugOverlay'
  private stats: StatsLike | null = null

  async init(ctx: GameContext): Promise<void> {
    const { default: Stats } = (await import('stats-gl')) as unknown as {
      default: new (options?: object) => StatsLike
    }
    const stats = new Stats({ trackGPU: false, horizontal: true })
    document.body.appendChild(stats.dom)
    await stats.init(ctx.renderer)
    this.stats = stats
  }

  update(ctx: GameContext): void {
    this.stats?.update()
    if (ctx.time.frame % 60 !== 0) return
    const info = ctx.renderer.info
    const canvas = ctx.renderer.domElement
    canvas.dataset.performance = JSON.stringify({
      frame: ctx.time.frame,
      medianFrameMs: Number(ctx.quality.medianFrameMs().toFixed(2)),
      tier: ctx.quality.tier,
      renderScale: ctx.quality.renderScale,
      drawCalls: info.render.drawCalls,
      triangles: info.render.triangles,
    })
  }

  dispose(): void {
    this.stats?.dom.remove()
    this.stats = null
  }
}
