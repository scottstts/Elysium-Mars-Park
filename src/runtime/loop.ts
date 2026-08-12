import type { GameContext } from './context'
import type { SystemRegistry } from './registry'

const FIXED_DT = 1 / 60
const MAX_SUBSTEPS = 5

export interface FrameTiming {
  cpuMs: number
  frameIntervalMs: number
  nowMs: number
}

/**
 * Fixed-timestep simulation (60 Hz) with variable-rate rendering.
 * Rendering is delegated: the render pipeline system owns `renderFrame`
 * so the loop never grows scene knowledge.
 */
export class GameLoop {
  /** Assigned by the render pipeline; called once per frame after updates. */
  renderFrame: () => void = () => {}
  /** Frame-time consumer (dynamic resolution, stats). */
  onFrameEnd?: (timing: FrameTiming) => void

  private last: number | undefined
  private accumulator = 0
  private renderedWhilePaused = false
  private readonly ctx: GameContext
  private readonly registry: SystemRegistry
  private readonly frameTiming: FrameTiming = { cpuMs: 0, frameIntervalMs: 0, nowMs: 0 }

  constructor(ctx: GameContext, registry: SystemRegistry) {
    this.ctx = ctx
    this.registry = registry
  }

  start(): void {
    this.ctx.renderer.setAnimationLoop((timeMs: number) => this.tick(timeMs))
  }

  /**
   * Drive one frame from a synthetic clock. Agent/automation probing uses
   * this while the host throttles requestAnimationFrame (hidden panes);
   * the running rAF loop keeps working independently.
   */
  manualStep(dtMs = 1000 / 60): void {
    const baseMs = this.last === undefined ? 0 : this.last * 1000
    this.tick(baseMs + dtMs)
  }

  stop(): void {
    this.ctx.renderer.setAnimationLoop(null)
  }

  private tick(timeMs: number): void {
    const frameStart = performance.now()
    const t = timeMs / 1000
    const rawDt = this.last === undefined ? FIXED_DT : t - this.last
    this.last = t
    // Tab-away clamp: never simulate a giant catch-up.
    const dt = Math.min(rawDt, 0.25)

    const time = this.ctx.time
    if (time.paused) {
      this.accumulator = 0
      if (!this.renderedWhilePaused) {
        this.renderFrame()
        time.frame++
        this.renderedWhilePaused = true
        this.finishFrame(frameStart, rawDt, timeMs)
      }
      return
    }
    this.renderedWhilePaused = false

    if (this.ctx.flags.freeze) {
      // Frozen validation frame: park clock halts, systems still lay out.
      this.registry.update(this.ctx, 0, 0)
      this.registry.lateUpdate(this.ctx, 0, 0)
      this.renderFrame()
      time.frame++
      this.finishFrame(frameStart, rawDt, timeMs)
      return
    }

    time.elapsed += dt
    this.accumulator += dt

    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.registry.fixedUpdate(this.ctx, FIXED_DT)
      time.sim += FIXED_DT
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0

    const alpha = this.accumulator / FIXED_DT
    this.registry.update(this.ctx, dt, alpha)
    this.registry.lateUpdate(this.ctx, dt, alpha)
    this.renderFrame()
    time.frame++
    this.finishFrame(frameStart, rawDt, timeMs)
  }

  private finishFrame(frameStart: number, rawDt: number, nowMs: number): void {
    const timing = this.frameTiming
    timing.cpuMs = performance.now() - frameStart
    timing.frameIntervalMs = Math.max(1, rawDt * 1000)
    timing.nowMs = nowMs
    this.onFrameEnd?.(timing)
  }
}
