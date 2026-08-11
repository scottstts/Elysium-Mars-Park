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
  position: fixed; left: 50%; bottom: 9vh;
  transform: translate(-50%, 8px);
  display: inline-flex; align-items: center; gap: 11px;
  padding: 8px 16px 8px 9px;
  background: rgba(14, 10, 8, 0.52);
  border: 1px solid rgba(244, 239, 228, 0.14);
  border-radius: 12px;
  backdrop-filter: blur(12px) saturate(0.9);
  -webkit-backdrop-filter: blur(12px) saturate(0.9);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(246, 242, 233, 0.94);
  opacity: 0; transition: opacity 0.16s ease, transform 0.16s ease;
  pointer-events: none; z-index: 30; white-space: nowrap;
}
#prompt .key {
  display: grid; place-items: center;
  min-width: 22px; height: 22px; padding: 0 5px;
  border-radius: 6px;
  background: rgba(244, 239, 228, 0.92); color: #17130f;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}
#prompt.visible { opacity: 1; transform: translate(-50%, 0); }
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

  /**
   * Sticky caption that bypasses the view-cone pick (seated-in-vehicle
   * hints: "Exit" while the tram dwells). The owner of the override also
   * owns the KeyE press — normal interactables are muted while it's up.
   */
  setOverride(label: string | null): void {
    if (this.override === label) return
    this.override = label
    if (label !== null) this.showCaption(label)
    else if (this.active) this.showCaption(labelOf(this.active))
    else this.prompt?.classList.remove('visible')
  }

  private override: string | null = null

  update(ctx: GameContext): void {
    if (this.override !== null) {
      this.setActive(null)
      if (ctx.time.paused) this.prompt?.classList.remove('visible')
      else this.prompt?.classList.add('visible')
      return
    }
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
    if (interactable) this.showCaption(labelOf(interactable))
    else this.prompt?.classList.remove('visible')
  }

  private showCaption(label: string): void {
    const prompt = this.prompt
    if (!prompt) return
    prompt.textContent = ''
    const key = document.createElement('span')
    key.className = 'key'
    key.textContent = 'E'
    prompt.append(key, label)
    prompt.classList.add('visible')
  }

  dispose(): void {
    this.prompt?.remove()
    this.prompt = null
  }
}

function labelOf(interactable: Interactable): string {
  return typeof interactable.label === 'function' ? interactable.label() : interactable.label
}
