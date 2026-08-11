/**
 * Entry screen: the WebGPU gate and load-progress surface, styled as the view
 * every colonist gets before boarding — the dark plain, one lit horizon, and
 * Dome One as a hairline of glass standing on it. Typography-led and quiet:
 * one wordmark, one status line, one action. The colonist/gate/sol facts the
 * old boarding-pass card spelled out in eight labelled fields live in two
 * whisper-quiet corner lines instead (owner: "the ticket idea is sound, but
 * just looks bad as a UI").
 */

const CSS = `
#entry {
  position: fixed; inset: 0; z-index: 40;
  display: flex; flex-direction: column; align-items: center;
  background:
    radial-gradient(90% 46% at 50% 84%, rgba(196, 110, 48, 0.16) 0%, rgba(196, 110, 48, 0) 62%),
    radial-gradient(140% 110% at 50% 0%, #0b0708 0%, #060404 58%, #050303 100%);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #efe9dc;
  transition: opacity 1.1s ease; opacity: 1;
  overflow: hidden;
}
#entry.hidden { opacity: 0; pointer-events: none; }

/* --- the place: one horizon, one dome ----------------------------------- */
#entry .horizon {
  position: absolute; left: 0; right: 0; bottom: 19%; height: 1px;
  background: linear-gradient(90deg,
    rgba(214, 160, 110, 0) 4%, rgba(214, 160, 110, 0.34) 30%,
    rgba(230, 178, 122, 0.5) 50%,
    rgba(214, 160, 110, 0.34) 70%, rgba(214, 160, 110, 0) 96%);
}
#entry .dome {
  position: absolute; left: 50%; bottom: calc(19% + 1px);
  width: min(36rem, 66vw); height: calc(min(36rem, 66vw) * 0.31);
  transform: translateX(-50%);
  border: 1px solid rgba(226, 182, 132, 0.30);
  border-bottom: none;
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  background: radial-gradient(62% 100% at 50% 100%, rgba(238, 168, 92, 0.10) 0%, rgba(238, 168, 92, 0) 72%);
  animation: entry-rise 2.2s ease-out both;
}
#entry .dome::after {
  /* The oculus beacon at the crown — the one point of light on the plain. */
  content: ""; position: absolute; left: 50%; top: -2px;
  width: 3px; height: 3px; border-radius: 50%;
  transform: translateX(-50%);
  background: rgba(244, 214, 170, 0.9);
  box-shadow: 0 0 10px 2px rgba(238, 168, 92, 0.55);
}

/* --- the lockup ---------------------------------------------------------- */
#entry .lockup {
  margin-top: 26vh;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
}
#entry .kicker {
  font-size: 0.65rem; letter-spacing: 0.52em; text-indent: 0.52em;
  text-transform: uppercase; color: rgba(239, 233, 220, 0.44);
  animation: entry-fade 1.4s ease-out both;
}
#entry h1 {
  margin: 1.05rem 0 0; font-size: clamp(3.2rem, 9.5vw, 6.4rem);
  font-weight: 200; line-height: 1;
  letter-spacing: 0.30em; text-indent: 0.30em;
  animation: entry-settle 1.9s cubic-bezier(0.22, 1, 0.36, 1) both;
}
#entry .sub {
  margin-top: 1.15rem;
  font-size: 0.68rem; letter-spacing: 0.46em; text-indent: 0.46em;
  text-transform: uppercase; color: rgba(239, 233, 220, 0.6);
  animation: entry-fade 1.4s ease-out 0.25s both;
}
#entry .sub em { font-style: normal; color: #d8703a; }

/* --- the one action ------------------------------------------------------ */
#entry .action {
  margin-top: 7vh; height: 5.4rem; width: min(24rem, 80vw);
  display: grid; place-items: start center;
}
#entry .action > * { grid-area: 1 / 1; }
#entry .progress {
  width: 100%; display: flex; flex-direction: column; align-items: center;
  transition: opacity 0.45s ease;
}
#entry .progress.done { opacity: 0; pointer-events: none; }
#entry .line {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.62rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: rgba(239, 233, 220, 0.5);
  white-space: nowrap; overflow: hidden; max-width: 100%; text-overflow: ellipsis;
}
#entry .bar {
  width: 15rem; height: 2px; margin-top: 0.85rem;
  background: rgba(239, 233, 220, 0.13); border-radius: 1px; overflow: hidden;
}
#entry .bar i {
  display: block; height: 100%; width: 0%;
  background: #d8703a; border-radius: 1px;
  transition: width 0.35s ease;
}
#entry button {
  appearance: none; cursor: pointer;
  padding: 0.95rem 3.6rem 0.9rem 3.85rem;
  background: transparent; color: #efe9dc;
  border: 1px solid rgba(239, 233, 220, 0.3); border-radius: 2px;
  font-size: 0.72rem; font-weight: 600;
  letter-spacing: 0.5em; text-indent: 0.5em; text-transform: uppercase;
  opacity: 0; pointer-events: none; transform: translateY(6px);
  transition: opacity 0.6s ease, transform 0.6s ease,
    background 0.22s ease, border-color 0.22s ease, color 0.22s ease;
}
#entry button.ready { opacity: 1; pointer-events: auto; transform: none; }
#entry button:hover, #entry button:focus-visible {
  background: #d8703a; border-color: #d8703a; color: #140b06; outline: none;
}
#entry .err {
  width: 100%; text-align: center;
  font-size: 0.78rem; line-height: 1.7; color: rgba(239, 233, 220, 0.78);
}
#entry .err b {
  display: block; margin-bottom: 0.4rem;
  font-size: 0.66rem; letter-spacing: 0.3em; text-indent: 0.3em;
  text-transform: uppercase; color: #d8703a;
}

/* --- corner facts (the whole manifest, two whispers) --------------------- */
#entry .fact {
  position: absolute; bottom: 1.35rem;
  font-size: 0.58rem; letter-spacing: 0.3em;
  text-transform: uppercase; color: rgba(239, 233, 220, 0.36);
}
#entry .fact.l { left: 1.6rem; }
#entry .fact.r { right: 1.6rem; letter-spacing: 0.3em; }

@keyframes entry-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes entry-rise {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%); }
}
@keyframes entry-settle {
  from { opacity: 0; letter-spacing: 0.42em; text-indent: 0.42em; }
  to { opacity: 1; letter-spacing: 0.30em; text-indent: 0.30em; }
}
@media (prefers-reduced-motion: reduce) {
  #entry .dome, #entry .kicker, #entry h1, #entry .sub { animation: none; }
}
`

export interface EntryScreen {
  setProgress(label: string, fraction: number): void
  showError(title: string, body: string): void
  /** Resolves when the visitor clicks BOARD. */
  showEnter(): Promise<void>
  hide(): void
}

const CHECK_LABELS: Record<string, string> = {
  'render-pipeline': 'render pipeline · linking',
  sky: 'sky · baking the afternoon',
  exterior: 'elysium planitia · surveying',
  dome: 'dome one · certifying panes',
  groundworks: 'groundworks · grading regolith',
  player: 'suit check · not required today',
  archkit: 'fabrication · printing parts',
  park: 'the commons · final walkthrough',
  tram: 'the loop · tram to gate s',
  interiors: 'interiors · lights on',
  robots: 'groundskeepers · waking',
  vegetation: 'the first tree · misting',
  audio: 'air handlers · listening',
  prewarm: 'shaders · warming',
  ready: 'all systems nominal',
}

export function createEntryScreen(parent: HTMLElement): EntryScreen {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'entry'
  root.innerHTML = `
    <div class="horizon"></div>
    <div class="dome"></div>
    <div class="lockup">
      <div class="kicker">Elysium Planitia · Mars</div>
      <h1>ELYSIUM</h1>
      <div class="sub">The Commons · <em>Dome One</em></div>
    </div>
    <div class="action">
      <div class="progress">
        <div class="line">pre-boarding checks</div>
        <div class="bar"><i></i></div>
      </div>
      <button>Board</button>
    </div>
    <div class="fact l">Colonist 081 · Gate S · The Loop</div>
    <div class="fact r">Sol 214 · Afternoon, held</div>`
  parent.appendChild(root)

  const progress = root.querySelector('.progress') as HTMLElement
  const line = root.querySelector('.line') as HTMLElement
  const bar = root.querySelector('.bar i') as HTMLElement
  const button = root.querySelector('button') as HTMLButtonElement

  return {
    setProgress(label: string, fraction: number): void {
      line.textContent = CHECK_LABELS[label] ?? `${label} · loading`
      bar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`
    },
    showError(title: string, body: string): void {
      const err = document.createElement('div')
      err.className = 'err'
      const heading = document.createElement('b')
      heading.textContent = title
      err.appendChild(heading)
      err.appendChild(document.createTextNode(body))
      progress.replaceWith(err)
    },
    showEnter(): Promise<void> {
      bar.style.width = '100%'
      line.textContent = CHECK_LABELS.ready
      window.setTimeout(() => progress.classList.add('done'), 450)
      button.classList.add('ready')
      return new Promise((resolve) => {
        button.addEventListener('click', () => resolve(), { once: true })
      })
    },
    hide(): void {
      root.classList.add('hidden')
      window.setTimeout(() => root.remove(), 1300)
    },
  }
}
