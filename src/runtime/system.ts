import type { GameContext } from './context'

/**
 * Every feature is a system module registered explicitly in main.ts.
 * `init` may be async (generation, physics wasm, bakes); updates are sync.
 */
export interface GameSystem {
  readonly id: string
  init?(ctx: GameContext): void | Promise<void>
  /** Fixed 60 Hz simulation step. */
  fixedUpdate?(ctx: GameContext, dt: number): void
  /** Per-render-frame update; alpha is the fixed-step interpolation fraction. */
  update?(ctx: GameContext, dt: number, alpha: number): void
  /** Runs after all updates, immediately before the frame renders. */
  lateUpdate?(ctx: GameContext, dt: number, alpha: number): void
  dispose?(ctx: GameContext): void
}
