import type { GameContext } from './context'
import type { GameSystem } from './system'

export class SystemRegistry {
  private readonly systems: GameSystem[] = []

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
    for (const system of this.systems) system.fixedUpdate?.(ctx, dt)
  }

  update(ctx: GameContext, dt: number, alpha: number): void {
    for (const system of this.systems) system.update?.(ctx, dt, alpha)
  }

  lateUpdate(ctx: GameContext, dt: number, alpha: number): void {
    for (const system of this.systems) system.lateUpdate?.(ctx, dt, alpha)
  }

  dispose(ctx: GameContext): void {
    for (let i = this.systems.length - 1; i >= 0; i--) {
      this.systems[i].dispose?.(ctx)
    }
    this.systems.length = 0
  }
}
