/**
 * Platform gate: Elysium Commons is a DESKTOP CHROMIUM application — WebGPU,
 * pointer lock, a keyboard. Anything else gets SHEET 00, a notice plate in
 * the drawing-set language of the entry screen (paper, ink, one rust stamp),
 * and the game's module graph is never imported (see boot.ts).
 *
 * Unlike SHEET 03 this page must live on phones, so it is a single-column
 * plate that composes from 320 px portrait to a desktop monitor: same
 * palette, same plate furniture (trim rule, ruled title, mono survey table,
 * stamp), none of the drawing density.
 *
 * Detection: the ENGINE row is `navigator.userAgentData` — the API itself
 * only exists in Chromium and its `brands` list names Chromium explicitly.
 * The DEVICE row prefers UA-CH (`mobile` separates handsets, `platform`
 * filters Android tablets, which report mobile: false) but falls back to
 * the UA string on engines without it, so a desktop Safari or Firefox is
 * still told the truth: engine FAIL, device PASS.
 * CAVEAT: userAgentData needs a secure context; localhost qualifies, a
 * plain-http LAN address does not and will gate out a real desktop Chrome —
 * serve https if you ever dev off-machine.
 */

export interface PlatformVerdict {
  eligible: boolean
  chromium: boolean
  desktop: boolean
  webgpu: boolean
}

interface UADataLike {
  brands?: ReadonlyArray<{ brand: string }>
  mobile?: boolean
  platform?: string
}

const DESKTOP_PLATFORMS = ['Windows', 'macOS', 'Linux', 'Chrome OS', 'Chromium OS']

/** Pure and injectable so the verdict is probeable headlessly. */
export function detectPlatform(nav: Navigator = navigator): PlatformVerdict {
  const uaData = (nav as Navigator & { userAgentData?: UADataLike }).userAgentData
  const chromium = uaData?.brands?.some((entry) => entry.brand === 'Chromium') === true
  // The DEVICE row must be truthful on its own: userAgentData is a
  // Chromium-only API, and deriving desktop-ness from it alone made desktop
  // Safari read "DEVICE — DESKTOP · FAIL" (owner report) — the survey blamed
  // the visitor's machine when only the engine was wrong. Without UA-CH,
  // fall back to the UA string. Eligibility is unaffected either way:
  // `chromium` is only ever true when uaData exists, so the fallback can
  // never admit anyone — it only keeps the diagnosis honest.
  const desktop = uaData
    ? uaData.mobile === false && DESKTOP_PLATFORMS.includes(uaData.platform ?? '')
    : desktopByUserAgent(nav)
  const webgpu = 'gpu' in nav
  return { eligible: chromium && desktop, chromium, desktop, webgpu }
}

/**
 * Desktop-ness for engines without UA-CH (Safari, Firefox). Two tells:
 * any handheld token in the UA string, and the iPadOS masquerade — Safari
 * on iPadOS reports a plain Macintosh UA but `maxTouchPoints > 1`, which no
 * real Mac does.
 */
function desktopByUserAgent(nav: Navigator): boolean {
  const ua = nav.userAgent ?? ''
  if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)) return false
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false
  return /Macintosh|Windows NT|X11|Linux|CrOS/.test(ua)
}

const CSS = `
#gate {
  --paper: #e8dfcd;
  --ink: #2a231b;
  --ink-2: rgba(42, 35, 27, 0.62);
  --ink-3: rgba(42, 35, 27, 0.34);
  --ink-4: rgba(42, 35, 27, 0.16);
  --rust: #a53c15;
  --sans: "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  padding: clamp(18px, 5vmin, 56px);
  background-color: var(--paper);
  background-image:
    linear-gradient(153deg, rgba(255, 250, 238, 0.62), rgba(255, 250, 238, 0) 44%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.86' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23g)' opacity='0.05'/%3E%3C/svg%3E");
  background-size: auto, 200px 200px;
  color: var(--ink);
  font-family: var(--sans);
  font-variant-numeric: tabular-nums lining-nums;
  overflow: auto;
}
#gate .sheet {
  /* margin: auto, not flex centering alone — a sheet taller than a short
     landscape phone stays scrollable from its top instead of clipping. */
  position: relative; width: min(100%, 620px); margin: auto;
  border: 1px solid var(--ink);
  padding: clamp(18px, 4.5vmin, 40px) clamp(16px, 4.5vmin, 44px) clamp(20px, 5vmin, 44px);
  box-shadow: 0 0 0 clamp(5px, 1.2vmin, 10px) var(--paper), 0 0 0 calc(clamp(5px, 1.2vmin, 10px) + 1px) var(--ink-3);
}
#gate .kicker {
  font-size: clamp(9px, 2.6vmin, 11px); letter-spacing: 0.32em;
  text-transform: uppercase; color: var(--ink-2);
}
#gate h1 {
  margin: 0.55em 0 0; font-size: clamp(19px, 6vmin, 30px); font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink);
}
#gate .rule { height: 3px; margin-top: 0.55em; border-top: 2.4px solid var(--ink); border-bottom: 1px solid var(--ink-3); }
#gate .note {
  margin: 1.3em 0 0; font-size: clamp(11px, 3.3vmin, 13.5px); line-height: 1.75;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-2);
}
#gate .note b { color: var(--ink); font-weight: 700; }
#gate .survey { margin-top: 1.5em; border-top: 1px solid var(--ink); }
#gate .survey .cap {
  padding: 0.6em 0 0.45em; font-size: clamp(8.5px, 2.4vmin, 10px);
  letter-spacing: 0.28em; text-transform: uppercase; color: var(--ink);
  border-bottom: 1px solid var(--ink-3);
}
#gate .srow {
  display: grid; grid-template-columns: 1fr auto; gap: 1em; align-items: baseline;
  padding: 0.62em 0 0.5em; border-bottom: 1px solid var(--ink-4);
  font-family: var(--mono); font-size: clamp(10px, 3vmin, 12.5px);
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-2);
}
#gate .srow b { font-weight: 400; color: var(--ink); }
#gate .srow.bad, #gate .srow.bad b { color: var(--rust); }
#gate .stampwrap { display: grid; place-items: center; margin-top: clamp(20px, 5.5vmin, 34px); }
/* The stamp is an SVG die: its rings and lines live in one coordinate space
   and scale as ONE unit with the sheet, so no wording, font fallback or
   viewport can push it past the plate (the HTML version overflowed the
   moment the die text grew — nowrap type keyed to the viewport cannot
   respect a width-capped container). 97% swallows the 3° rotation's reach. */
#gate .stamp {
  display: block; width: min(97%, 520px); height: auto;
  color: var(--rust); transform: rotate(-3deg);
  animation: gate-stamp 540ms cubic-bezier(0.16, 1.3, 0.3, 1) 260ms both;
}
#gate .stamp .st-s { font: 23px var(--sans); fill: currentColor; }
#gate .stamp .st-b { font: 700 64px var(--sans); fill: currentColor; }
#gate .how {
  margin: clamp(16px, 4.5vmin, 26px) auto 0; max-width: 40ch; text-align: center;
  font-family: var(--mono); font-size: clamp(9px, 2.7vmin, 12px);
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink);
  line-height: 1.9; text-wrap: balance;
}
#gate .foot {
  margin-top: clamp(16px, 4.5vmin, 28px); padding-top: 0.7em;
  border-top: 1px solid var(--ink-3);
  display: flex; justify-content: space-between; gap: 1em; flex-wrap: wrap;
  font-size: clamp(7.5px, 2.2vmin, 9.5px); letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--ink-3);
}
@keyframes gate-stamp {
  from { opacity: 0; transform: rotate(-3deg) scale(1.5); }
  to { opacity: 1; transform: rotate(-3deg) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  #gate .stamp { animation: none; }
}
`

/**
 * The stamp as a self-fitting SVG die. Ring geometry and line lengths are
 * derived from the wording, every line is pinned with `textLength` (spacing
 * adjust — the tracking IS the fit, exactly how a real die is cut), and the
 * whole thing scales as one drawing with the sheet. Change the wording
 * freely; it cannot overflow and it renders identically on every font stack.
 */
function stampSvg(top: string, main: string, bottom: string): string {
  // Die metrics in stamp units, sized off the main line at 64-unit caps:
  // ~50/char forces ≈0.2em tracking on condensed capitals; the small lines
  // run ≈0.44em tracked at 23-unit caps, capped at the main line's run.
  const mainLength = Math.max(300, Math.round(main.length * 50))
  const smallLength = (s: string): number => Math.min(Math.round(s.length * 23.5), mainLength)
  const w = mainLength + 170
  const h = 240
  const cx = w / 2
  const line = (text: string, y: number, cls: string, length: number): string =>
    `<text x="${cx}" y="${y}" class="${cls}" text-anchor="middle" ` +
    `textLength="${length}" lengthAdjust="spacing">${text.toUpperCase()}</text>`
  return (
    `<svg class="stamp" viewBox="0 0 ${w} ${h}" role="img" aria-label="${main}">` +
    `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="currentColor" stroke-width="7"/>` +
    `<rect x="23" y="23" width="${w - 46}" height="${h - 46}" fill="none" stroke="currentColor" stroke-width="4"/>` +
    line(top, 74, 'st-s', smallLength(top)) +
    line(main, 150, 'st-b', mainLength) +
    line(bottom, 205, 'st-s', smallLength(bottom)) +
    `</svg>`
  )
}

export function createPlatformGate(parent: HTMLElement, verdict: PlatformVerdict): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const mark = (pass: boolean, passText: string, failText: string): string =>
    `<b>${pass ? passText : failText}</b>`
  const rowClass = (pass: boolean): string => (pass ? 'srow' : 'srow bad')

  const root = document.createElement('div')
  root.id = 'gate'
  root.innerHTML =
    `<div class="sheet">` +
    `<div class="kicker">Elysium Commons · Dome One</div>` +
    `<h1>Notice to visitors</h1>` +
    `<div class="rule"></div>` +
    `<p class="note">The park runs as a <b>desktop Chromium</b> application — ` +
    `WebGPU, pointer lock, a keyboard and a mouse. There is no mobile service ` +
    `and no other engine. The park is not going anywhere; return on desktop ` +
    `Chrome, Edge or any Chromium browser.</p>` +
    `<div class="survey">` +
    `<div class="cap">Admission survey · this device</div>` +
    `<div class="${rowClass(verdict.chromium)}"><span>Engine — Chromium</span>${mark(verdict.chromium, 'Pass', 'Fail')}</div>` +
    `<div class="${rowClass(verdict.desktop)}"><span>Device — Desktop</span>${mark(verdict.desktop, 'Pass', 'Fail')}</div>` +
    `<div class="${rowClass(verdict.webgpu)}"><span>Renderer — WebGPU</span>${mark(verdict.webgpu, 'Present', 'Absent')}</div>` +
    `</div>` +
    `<div class="stampwrap">` +
    stampSvg('Admission held', 'Chromium Desktop only', 'Gate S · The Loop') +
    `</div>` +
    `<div class="how">Open on desktop Chrome, Edge or Chromium with WebGPU · gate S is always open</div>` +
    `<div class="foot"><span>Elysium Planitia, Mars · − 2 540 m</span><span>Sheet 00 · Sol 214</span></div>` +
    `</div>`
  parent.appendChild(root)
}
