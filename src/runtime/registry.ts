import type { GameContext } from './context'
import type { GameSystem } from './system'

export type SystemUpdatePhase = 'fixed' | 'update' | 'late'
export type SystemTimingHandler = (
  systemId: string,
  phase: SystemUpdatePhase,
  durationMs: number,
) => void

export class SystemRegistry {
  private readonly systems: GameSystem[] = []

  /** Debug profiler hook. Unset in normal gameplay, so the hot path stays direct. */
  onSystemTiming?: SystemTimingHandler

  add<T extends GameSystem>(system: T): T {
    this.systems.push(system)
    return system
  }

  async init(
    ctx: GameContext,
    onProgress?: (label: string, index: number, total: number) => void,
    onTiming?: (label: string, durationMs: number) => void,
  ): Promise<void> {
    const total = this.systems.length
    for (let i = 0; i < total; i++) {
      const system = this.systems[i]
      onProgress?.(system.id, i, total)
      const start = performance.now()
      await system.init?.(ctx)
      onTiming?.(system.id, performance.now() - start)
    }
    onProgress?.('ready', total, total)
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const timing = this.onSystemTiming
    if (!timing) {
      for (const system of this.systems) system.fixedUpdate?.(ctx, dt)
      return
    }
    for (const system of this.systems) {
      if (!system.fixedUpdate) continue
      const start = performance.now()
      system.fixedUpdate(ctx, dt)
      timing(system.id, 'fixed', performance.now() - start)
    }
  }

  update(ctx: GameContext, dt: number, alpha: number): void {
    const timing = this.onSystemTiming
    if (!timing) {
      for (const system of this.systems) system.update?.(ctx, dt, alpha)
      return
    }
    for (const system of this.systems) {
      if (!system.update) continue
      const start = performance.now()
      system.update(ctx, dt, alpha)
      timing(system.id, 'update', performance.now() - start)
    }
  }

  lateUpdate(ctx: GameContext, dt: number, alpha: number): void {
    const timing = this.onSystemTiming
    if (!timing) {
      for (const system of this.systems) system.lateUpdate?.(ctx, dt, alpha)
      return
    }
    for (const system of this.systems) {
      if (!system.lateUpdate) continue
      const start = performance.now()
      system.lateUpdate(ctx, dt, alpha)
      timing(system.id, 'late', performance.now() - start)
    }
  }

  dispose(ctx: GameContext): void {
    for (let i = this.systems.length - 1; i >= 0; i--) {
      this.systems[i].dispose?.(ctx)
    }
    this.systems.length = 0
  }
}
