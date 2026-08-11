import type { AudioEngineSystem } from '../audio/engine'
import type { PlayerSystem } from '../player/playerSystem'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'

/**
 * The ESC pause. Browsers deliver ESC-in-pointer-lock as a lock EXIT, not a
 * keydown, so the real trigger is pointerlockchange→unlocked: the sim clock
 * stops (`ctx.time.paused` — the loop renders one last frame and then halts
 * rendering entirely), the audio context suspends, and a quiet glass card
 * takes the screen. Resume re-requests the lock; the game only unpauses once
 * the lock is actually held again, so a rejected request (the browser's
 * ~1.25 s relock cooldown) simply leaves the menu up for another click.
 */

const CSS = `
#pause {
  position: fixed; inset: 0; z-index: 36;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 100% at 50% 0%, rgba(24, 13, 8, 0.42), rgba(6, 4, 3, 0.62));
  backdrop-filter: blur(14px) saturate(0.8);
  -webkit-backdrop-filter: blur(14px) saturate(0.8);
  opacity: 0; pointer-events: none; transition: opacity 0.24s ease;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #efe9dc;
}
#pause.visible { opacity: 1; pointer-events: auto; }
#pause .card {
  width: min(320px, 84vw);
  background: rgba(16, 11, 8, 0.58);
  border: 1px solid rgba(244, 239, 228, 0.13);
  border-radius: 16px;
  padding: 26px 26px 22px;
  box-shadow: 0 40px 110px rgba(0, 0, 0, 0.55);
  transform: translateY(6px); transition: transform 0.24s ease;
}
#pause.visible .card { transform: translateY(0); }
#pause h1 {
  margin: 0; font-size: 13px; font-weight: 700;
  letter-spacing: 0.42em; text-transform: uppercase;
  color: rgba(246, 242, 233, 0.95);
}
#pause .where {
  margin: 6px 0 0; font-size: 9.5px; letter-spacing: 0.3em;
  text-transform: uppercase; color: rgba(246, 242, 233, 0.42);
}
#pause .keys {
  display: grid; grid-template-columns: auto 1fr; gap: 9px 14px;
  align-items: center; margin: 22px 0 4px;
}
#pause .k {
  justify-self: start; display: inline-flex; gap: 4px;
}
#pause .k span {
  display: grid; place-items: center; min-width: 21px; height: 21px;
  padding: 0 5px; border-radius: 5px;
  background: rgba(244, 239, 228, 0.14);
  border: 1px solid rgba(244, 239, 228, 0.2);
  font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
  color: rgba(246, 242, 233, 0.92);
}
#pause .keys em {
  font-style: normal; font-size: 10px; letter-spacing: 0.22em;
  text-transform: uppercase; color: rgba(246, 242, 233, 0.55);
}
#pause button {
  appearance: none; width: 100%; margin-top: 20px; padding: 12px 0 11px;
  background: rgba(244, 239, 228, 0.92); color: #17130f;
  border: 0; border-radius: 10px; cursor: pointer;
  font-size: 12px; font-weight: 700; letter-spacing: 0.34em; text-transform: uppercase;
  transition: background 0.15s ease, transform 0.12s ease;
}
#pause button:hover { background: #c94f1d; color: #f4efe4; transform: translateY(-1px); }
`

export class PauseSystem implements GameSystem {
  readonly id = 'pause'

  private root: HTMLElement | null = null
  private armed = false
  private paused = false
  private ctx: GameContext | null = null

  private readonly player: PlayerSystem
  private readonly audio: AudioEngineSystem | null

  constructor(player: PlayerSystem, audio: AudioEngineSystem | null) {
    this.player = player
    this.audio = audio
  }

  init(ctx: GameContext): void {
    this.ctx = ctx
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'pause'
    const card = document.createElement('div')
    card.className = 'card'

    const title = document.createElement('h1')
    title.textContent = 'Paused'
    const where = document.createElement('p')
    where.className = 'where'
    where.textContent = 'Elysium · Dome One'
    card.append(title, where)

    const keys = document.createElement('div')
    keys.className = 'keys'
    const row = (caps: string[], what: string): void => {
      const k = document.createElement('div')
      k.className = 'k'
      for (const cap of caps) {
        const chip = document.createElement('span')
        chip.textContent = cap
        k.appendChild(chip)
      }
      const em = document.createElement('em')
      em.textContent = what
      keys.append(k, em)
    }
    row(['W', 'A', 'S', 'D'], 'Move')
    row(['E'], 'Interact')
    row(['Space'], 'Jump')
    row(['Shift'], 'Run')
    card.appendChild(keys)

    const resume = document.createElement('button')
    resume.textContent = 'Resume'
    card.appendChild(resume)

    root.appendChild(card)
    document.body.appendChild(root)
    this.root = root

    const tryResume = (): void => {
      // Unpause happens on the lock-acquired event, not here: a rejected
      // request (relock cooldown) must leave the menu up.
      this.player.requestPointerLock()
    }
    resume.addEventListener('click', tryResume)
    root.addEventListener('click', (event) => {
      if (event.target === root) tryResume()
    })
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.paused) tryResume()
    })

    document.addEventListener('pointerlockchange', () => {
      const locked = this.player.pointerLocked
      if (locked) {
        this.armed = true
        if (this.paused) this.setPaused(false)
      } else if (this.armed && !this.paused) {
        this.setPaused(true)
      }
    })
  }

  private setPaused(paused: boolean): void {
    const ctx = this.ctx
    if (!ctx || this.paused === paused) return
    this.paused = paused
    ctx.time.paused = paused
    this.audio?.setPaused(paused)
    this.root?.classList.toggle('visible', paused)
  }

  dispose(): void {
    this.root?.remove()
    this.root = null
  }
}
