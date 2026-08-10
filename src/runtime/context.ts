import type { PerspectiveCamera, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { DebugFlags } from '../core/debug'
import type { EventBus } from '../core/events'
import type { GameEvents } from '../core/gameEvents'
import type { Rng } from '../core/prng'
import type { QualityState } from '../core/quality'

export interface TimeState {
  /** Wall-clock seconds since boot (render clock). */
  elapsed: number
  /** Accumulated fixed-step simulation seconds — the park clock. */
  sim: number
  /** Rendered frame counter. */
  frame: number
  /** True while the pause card or entry screen owns input. */
  paused: boolean
}

/**
 * Shared context handed to every system. Systems that need each other are
 * wired explicitly in main.ts, never looked up here.
 */
export interface GameContext {
  readonly renderer: WebGPURenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly events: EventBus<GameEvents>
  readonly rng: Rng
  readonly flags: DebugFlags
  readonly quality: QualityState
  readonly time: TimeState
}
