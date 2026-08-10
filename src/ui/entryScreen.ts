/**
 * Entry screen: a colonist boarding pass over black. Doubles as the WebGPU
 * gate and the load-progress surface (styled as a systems checklist). The
 * BOARD button appears only when warmup completes — entry is instant.
 */

const CSS = `
#entry {
  position: fixed; inset: 0; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 10%, #16100c 0%, #070506 62%);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  transition: opacity 1.1s ease; opacity: 1;
  color: #efe9dc;
}
#entry.hidden { opacity: 0; pointer-events: none; }
#entry .pass {
  width: min(400px, 86vw);
  background: linear-gradient(168deg, #f4efe4 0%, #eee7d7 74%, #e7dfcd 100%);
  color: #17151a;
  border-radius: 6px;
  padding: 26px 28px 20px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.65), 0 2px 0 rgba(255,255,255,0.06) inset;
  position: relative;
}
#entry .pass::before {
  content: ""; position: absolute; left: 0; right: 0; top: 92px; height: 0;
  border-top: 2px dashed rgba(23,21,26,0.22);
}
#entry .marque { display: flex; justify-content: space-between; align-items: baseline; }
#entry h1 {
  margin: 0; font-size: 21px; letter-spacing: 0.34em; font-weight: 700;
  text-transform: uppercase;
}
#entry .dome { font-size: 10px; letter-spacing: 0.3em; color: #b3491f; font-weight: 700; }
#entry .sub {
  margin: 4px 0 26px; font-size: 10px; letter-spacing: 0.24em;
  text-transform: uppercase; color: rgba(23,21,26,0.55);
}
#entry .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 18px 0 16px; }
#entry .f label {
  display: block; font-size: 8.5px; letter-spacing: 0.22em; text-transform: uppercase;
  color: rgba(23,21,26,0.45); margin-bottom: 2px;
}
#entry .f div { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }
#entry .check {
  min-height: 44px; margin-top: 14px; padding-top: 12px;
  border-top: 1px solid rgba(23,21,26,0.14);
}
#entry .check .line {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(23,21,26,0.62);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#entry .bar {
  height: 3px; background: rgba(23,21,26,0.12); border-radius: 2px; margin-top: 9px; overflow: hidden;
}
#entry .bar i {
  display: block; height: 100%; width: 0%;
  background: #c94f1d; border-radius: 2px;
  transition: width 0.35s ease;
}
#entry button {
  appearance: none; width: 100%; margin-top: 16px; padding: 13px 0 12px;
  background: #17151a; color: #f4efe4; border: 0; border-radius: 4px;
  font-size: 13px; letter-spacing: 0.42em; text-transform: uppercase; font-weight: 700;
  cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 0.5s ease, transform 0.15s ease;
}
#entry button.ready { opacity: 1; pointer-events: auto; }
#entry button:hover { transform: translateY(-1px); background: #c94f1d; }
#entry .err { color: #b3491f; font-size: 12px; line-height: 1.6; margin-top: 14px; }
#entry .foot {
  margin-top: 16px; font-size: 8.5px; letter-spacing: 0.22em; text-transform: uppercase;
  color: rgba(23,21,26,0.4); display: flex; justify-content: space-between;
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
    <div class="pass">
      <div class="marque"><h1>Elysium</h1><span class="dome">Dome One</span></div>
      <div class="sub">The Commons · Elysium Planitia · Mars</div>
      <div class="fields">
        <div class="f"><label>Passenger</label><div>Colonist 081</div></div>
        <div class="f"><label>Gate</label><div>S · Portal Station</div></div>
        <div class="f"><label>Service</label><div>The Loop · Tram 01</div></div>
        <div class="f"><label>Local time</label><div>Afternoon, held</div></div>
      </div>
      <div class="check"><div class="line">pre-boarding checks</div>
        <div class="bar"><i></i></div>
      </div>
      <button>Board</button>
      <div class="foot"><span>ISRU glass · printed on Mars</span><span>No. 000081</span></div>
    </div>`
  parent.appendChild(root)

  const line = root.querySelector('.line') as HTMLElement
  const bar = root.querySelector('.bar i') as HTMLElement
  const button = root.querySelector('button') as HTMLButtonElement
  const check = root.querySelector('.check') as HTMLElement

  return {
    setProgress(label: string, fraction: number): void {
      line.textContent = CHECK_LABELS[label] ?? `${label} · loading`
      bar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`
    },
    showError(title: string, body: string): void {
      check.innerHTML = `<div class="line">${title}</div><div class="err">${body}</div>`
    },
    showEnter(): Promise<void> {
      bar.style.width = '100%'
      line.textContent = CHECK_LABELS.ready
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
