import { Vector3 } from 'three'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { PlayerSystem } from './playerSystem'

export interface Interactable {
  /** World anchor the caption points at (live-updatable by the owner). */
  position: Vector3
  label: string | (() => string)
  /** Max use distance (m). */
  range?: number
  onUse(ctx: GameContext): void
}

const CAPTION_CSS = `
#prompt {
  position: fixed; left: 50%; bottom: 12vh; transform: translateX(-50%);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 12px; letter-spacing: 0.34em; text-transform: uppercase;
  color: rgba(244, 239, 228, 0.92);
  text-shadow: 0 1px 10px rgba(10, 6, 4, 0.7);
  opacity: 0; transition: opacity 0.22s ease; pointer-events: none;
  z-index: 30; white-space: nowrap;
}
#prompt .key {
  display: inline-block; border: 1px solid rgba(244,239,228,0.5);
  border-radius: 3px; padding: 1px 6px 2px; margin-right: 10px;
  font-size: 10px; letter-spacing: 0.12em;
}
#prompt.visible { opacity: 1; }
`

/**
 * The single contextual caption (design canon: minimal UI). Interactables
 * register here; a view-cone raycast from the eye picks at most one, and
 * KeyE uses it. No other in-play UI exists.
 */
export class InteractionSystem implements GameSystem {
  readonly id = 'interaction'

  private readonly interactables: Interactable[] = []
  private readonly forward = new Vector3()
  private readonly toTarget = new Vector3()
  private prompt: HTMLElement | null = null
  private active: Interactable | null = null
  private readonly player: PlayerSystem

  constructor(player: PlayerSystem) {
    this.player = player
  }

  init(_ctx: GameContext): void {
    const style = document.createElement('style')
    style.textContent = CAPTION_CSS
    document.head.appendChild(style)
    const prompt = document.createElement('div')
    prompt.id = 'prompt'
    document.body.appendChild(prompt)
    this.prompt = prompt
  }

  register(interactable: Interactable): () => void {
    this.interactables.push(interactable)
    return () => {
      const index = this.interactables.indexOf(interactable)
      if (index >= 0) this.interactables.splice(index, 1)
    }
  }

  update(ctx: GameContext): void {
    if (ctx.time.paused || this.interactables.length === 0) {
      this.setActive(null)
      return
    }

    ctx.camera.getWorldDirection(this.forward)

    let best: Interactable | null = null
    let bestScore = Number.POSITIVE_INFINITY
    const eye = this.player.eye
    for (const interactable of this.interactables) {
      const label =
        typeof interactable.label === 'function' ? interactable.label() : interactable.label
      if (label === '') continue
      const range = interactable.range ?? 2.8
      const distance = interactable.position.distanceTo(eye)
      if (distance > range) continue
      // Require the target roughly in the view cone (relaxed up close).
      const alignment = this.toTarget
        .copy(interactable.position)
        .sub(eye)
        .normalize()
        .dot(this.forward)
      if (alignment < (distance < 1.1 ? 0.15 : 0.72)) continue
      const score = distance * (1.6 - alignment)
      if (score < bestScore) {
        bestScore = score
        best = interactable
      }
    }
    this.setActive(best)

    const input = (
      this.player as unknown as { input: { useQueued: boolean } | null }
    ).input
    if (input?.useQueued) {
      input.useQueued = false
      this.active?.onUse(ctx)
    }
  }

  private setActive(interactable: Interactable | null): void {
    if (this.active === interactable && interactable === null) return
    this.active = interactable
    const prompt = this.prompt
    if (!prompt) return
    if (interactable) {
      const label =
        typeof interactable.label === 'function' ? interactable.label() : interactable.label
      prompt.innerHTML = `<span class="key">E</span>${label}`
      prompt.classList.add('visible')
    } else {
      prompt.classList.remove('visible')
    }
  }

  dispose(): void {
    this.prompt?.remove()
    this.prompt = null
  }
}
