/**
 * Entry screen: the WebGPU gate and load-progress surface, drawn as SHEET 03
 * of the drawing set for Dome One — an A0 plate, ink on plotter paper, the park
 * as it existed before anybody built it. Nothing here is set dressing: the
 * section is struck from the live constants (DOME_BASE_RADIUS 130, crown 64,
 * sphere R 164.031, the 13 ring parallels, LOOP.radius 97, the 12 m ginkgo at
 * the origin), so the plate and the world are the same object drawn twice.
 *
 * The load IS the artwork. Every system that reports in inks the layer it
 * builds — `sky` throws the sun and the oculus shaft, `dome` strikes the shell,
 * `tram` lays the Loop and Gate S, `vegetation` plants Tree 1 — so the sheet
 * plots itself while the shaders compile and is finished at the moment the park
 * is. Progress reads as a plot register down the right margin: no bar, no
 * wordmark, no hero. Layer inking is pure CSS opacity on <g> groups, so the
 * main thread stays free for compilation.
 *
 * HIERARCHY (owner note, REV H): the sheet must never compete with the one
 * action. Two states, two orders. While PLOTTING, the section is the figure,
 * the live plot register + percentage are the single secondary focus, and
 * every accompaniment box (pen table, key plan, Detail A, parts, notes) is
 * demoted to tier-3 ink (`.t3`, 55%) — texture, not content. When READY, the
 * whole plate washes back (root class `done`) and the stamp leaves its
 * register cell to land full-size over the receded drawing: ADMIT ONE /
 * BOARD, rotated, with an explicit CLICK TO BOARD line under it. Until then
 * the same button is the ruled percentage box in the margin. Boot contract
 * for main.ts and headless probes: root `id="entry"`, exactly one <button>,
 * which gains class `ready`.
 *
 * The soul of the sheet is REV G. Tree 1 grew a metre past the planting
 * envelope it was drawn inside; the revision cloud is around the canopy and the
 * revision note says the drawing was amended to suit. The park won that one.
 */

const CSS = `
#entry {
  --paper: #e8dfcd;
  --ink: #2a231b;
  --ink-2: rgba(42, 35, 27, 0.62);
  --ink-3: rgba(42, 35, 27, 0.34);
  --ink-4: rgba(42, 35, 27, 0.16);
  --rust: #a53c15;
  --sans: "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --trim: clamp(7px, 0.85vmin, 17px);
  --gut: clamp(11px, 1.3vmin, 23px);
  position: fixed; inset: 0; z-index: 40;
  background-color: var(--paper);
  background-image:
    linear-gradient(153deg, rgba(255, 250, 238, 0.62), rgba(255, 250, 238, 0) 44%),
    linear-gradient(2deg, rgba(112, 82, 48, 0.11), rgba(112, 82, 48, 0) 26%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.86' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23g)' opacity='0.05'/%3E%3C/svg%3E");
  background-size: auto, auto, 200px 200px;
  color: var(--ink);
  font-family: var(--sans);
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  opacity: 1; transition: opacity 1.05s ease;
  overflow: hidden;
}
#entry.hidden { opacity: 0; pointer-events: none; }

/* --- plate furniture: trim, zone marks, frame ---------------------------- */
#entry .trim { position: absolute; inset: var(--trim); border: 1px solid var(--ink-3); }
#entry .zone {
  position: absolute; display: flex; overflow: hidden;
  font-family: var(--mono); font-size: clamp(5.5px, 0.66vmin, 8.5px);
  letter-spacing: 0.06em; color: var(--ink-3);
}
#entry .zone.t { top: 0; left: var(--gut); right: var(--gut); height: var(--gut); }
#entry .zone.b { bottom: 0; left: var(--gut); right: var(--gut); height: var(--gut); }
#entry .zone.l { left: 0; top: var(--gut); bottom: var(--gut); width: var(--gut); flex-direction: column; }
#entry .zone.r { right: 0; top: var(--gut); bottom: var(--gut); width: var(--gut); flex-direction: column; }
#entry .zone span { flex: 1 1 0; display: grid; place-items: center; }
#entry .zone.t span + span, #entry .zone.b span + span { border-left: 1px solid var(--ink-4); }
#entry .zone.l span + span, #entry .zone.r span + span { border-top: 1px solid var(--ink-4); }

#entry .plate {
  position: absolute; inset: calc(var(--trim) + var(--gut));
  border: 1px solid var(--ink);
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(198px, 19.5vw, 420px);
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas: "field margin" "foot title";
}

/* --- the drawing field --------------------------------------------------- */
#entry .field {
  grid-area: field; position: relative; min-width: 0; min-height: 0;
  padding: clamp(5px, 0.7vmin, 13px);
}
#entry svg {
  display: block; width: 100%; height: 100%;
  fill: none; stroke: none; stroke-linejoin: round;
}
#entry svg text { stroke: none; }
#entry .s0 { stroke: var(--ink-3); stroke-width: 0.9; }
#entry .s1 { stroke: var(--ink-2); stroke-width: 1.1; }
#entry .s2 { stroke: var(--ink); stroke-width: 1.6; }
#entry .s3 { stroke: var(--ink); stroke-width: 2.6; }
#entry .sr { stroke: var(--rust); stroke-width: 1.5; }
#entry .sp { stroke: var(--paper); stroke-width: 3.6; }
#entry .dash { stroke-dasharray: 7 4; }
#entry .chain { stroke-dasharray: 15 3.5 2 3.5; }
#entry .f1 { fill: rgba(42, 35, 27, 0.09); }
#entry .f2 { fill: var(--ink); }
#entry .fp { fill: var(--paper); }
#entry .fe { fill: url(#hatch-earth); }
#entry .fh { fill: url(#hatch-cut); }
#entry .tx { fill: var(--ink-2); font-family: var(--sans); font-size: 12px; letter-spacing: 0.09em; }
#entry .tb { fill: var(--ink); font-family: var(--sans); font-size: 12px; letter-spacing: 0.09em; }
#entry .ts { fill: var(--ink-2); font-family: var(--sans); font-size: 9.5px; letter-spacing: 0.09em; }
#entry .tn { fill: var(--ink-2); font-family: var(--mono); font-size: 10px; letter-spacing: 0.01em; }
#entry .tt { fill: var(--ink); font-family: var(--sans); font-size: 15.5px; letter-spacing: 0.16em; }
#entry .tr { fill: var(--rust); font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.09em; }
#entry .ly { opacity: 0; transition: opacity 620ms ease; }
#entry .ly.on { opacity: 1; }
/* Tier-3 ink: the accompaniment boxes (pen table, key plan, Detail A, parts,
   notes). Demoted so the section + register read first; still rich as
   texture. Multiplies with the .ly plot-in, so a t3 box inks straight to
   its demoted weight. */
#entry .t3 { opacity: 0.55; }
#entry.void .field svg { opacity: 0.14; }

/* --- the halt note (WebGPU refusal) -------------------------------------- */
#entry .note {
  position: absolute; left: 6%; right: 6%; top: 50%; transform: translateY(-50%);
  display: none; padding: clamp(14px, 2vmin, 26px) clamp(16px, 2.4vmin, 32px);
  background: var(--paper); border: 1.6px solid var(--rust);
  box-shadow: 0 0 0 4px var(--paper);
}
#entry.void .note { display: block; }
#entry .note-tag {
  font-size: clamp(8px, 0.95vmin, 11px); letter-spacing: 0.4em;
  text-transform: uppercase; color: var(--rust);
}
#entry .note-head {
  margin: 0.5em 0 0.45em; font-size: clamp(15px, 1.9vmin, 24px);
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink);
}
#entry .note-body {
  max-width: 62ch; font-family: var(--mono); font-size: clamp(11px, 1.15vmin, 14px);
  line-height: 1.65; letter-spacing: 0.01em; color: var(--ink);
}

/* --- right margin: plot register, revisions ------------------------------ */
#entry .margin {
  grid-area: margin; border-left: 1px solid var(--ink);
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
#entry .cap {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 0.62em 0.85em 0.5em;
  font-size: clamp(8px, 0.92vmin, 11px); letter-spacing: 0.24em;
  text-transform: uppercase; color: var(--ink);
  border-bottom: 1px solid var(--ink-3);
}
#entry .cap b { font-family: var(--mono); font-weight: 400; letter-spacing: 0.04em; color: var(--ink-2); }
#entry .reg { padding: 0.15em 0.85em 0.3em; }
#entry .row {
  display: grid; grid-template-columns: 4.6em 1fr 0.62em; gap: 0.55em;
  align-items: center; min-height: clamp(14px, 1.85vh, 27px);
  border-bottom: 1px solid var(--ink-4);
  font-size: clamp(7.6px, 0.88vmin, 10.5px); letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ink-4);
  transition: color 380ms ease;
}
#entry .row .code { font-family: var(--mono); letter-spacing: 0.02em; }
#entry .row .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#entry .row .box {
  width: 0.62em; height: 0.62em; border: 1px solid currentColor;
  transition: background 380ms ease;
}
#entry .row.done { color: var(--ink-2); }
#entry .row.done .box { background: var(--ink-2); }
#entry .row.now { color: var(--rust); }
#entry .row.now .box { background: linear-gradient(90deg, var(--rust) 50%, transparent 50%); }
#entry .revs { padding: 0.9em 0.85em 0.2em; }
#entry .rev {
  display: grid; grid-template-columns: 1.1em 3.9em 1fr; gap: 0.5em;
  padding: 0.42em 0; border-top: 1px solid var(--ink-4);
  font-size: clamp(7.2px, 0.82vmin, 10px); letter-spacing: 0.08em;
  text-transform: uppercase; line-height: 1.35; color: var(--ink-2);
}
#entry .rev i { font-style: normal; font-family: var(--mono); color: var(--rust); }
#entry .rev b { font-weight: 400; font-family: var(--mono); letter-spacing: 0; }
#entry .rev.last { color: var(--ink); }
#entry .fill { flex: 1 1 auto; min-height: 0.6em; }

/* --- the stamp: the one action ------------------------------------------- */
#entry .stampcell { padding: 0.6em 0.85em 1.1em; }
#entry button {
  appearance: none; -webkit-appearance: none; display: block;
  position: relative; width: 100%; height: clamp(62px, 8.4vh, 108px);
  margin: 0; padding: 0; border: 0; background: none; font: inherit;
  color: inherit; cursor: default;
}
#entry button > span {
  position: absolute; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
}
#entry .pending {
  inset: 0; gap: 0.15em; border: 1px dashed var(--ink-3); color: var(--ink-3);
}
#entry .pending em {
  font-style: normal; font-size: clamp(7px, 0.8vmin, 9.5px);
  letter-spacing: 0.3em; text-indent: 0.3em; text-transform: uppercase;
}
#entry .pending .p-now {
  color: var(--ink); max-width: 94%; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis;
}
#entry .p-num {
  display: flex; align-items: baseline; gap: 0.1em; color: var(--ink);
  font-family: var(--mono); line-height: 1;
}
#entry .p-num b { font-size: clamp(19px, 2.6vh, 34px); font-weight: 400; }
#entry .p-num i { font-style: normal; font-size: clamp(9px, 1.2vh, 14px); }
#entry.void .p-num { display: none; }
#entry.void .pending { border-color: var(--rust); border-style: solid; }
#entry.void .pending em { color: var(--rust); }
/* Ready: hierarchy inverts in one move. The button leaves the register cell
   (fixed against the #entry overlay, which is the viewport) and lands as a
   full-size stamp over the washed plate — the primary element, then paper. */
#entry button.ready {
  cursor: pointer;
  position: fixed; left: 50%; top: 53%;
  width: min(max(44vw, 52vmin), 86vw, 900px);
  height: auto; aspect-ratio: 3.15 / 1; max-height: 34vh;
  transform: translate(-50%, -50%);
}
#entry .issued {
  inset: 0; gap: 0.3em; transform: rotate(-3deg);
  border: 2.5px solid var(--rust); color: var(--rust);
  background-color: rgba(232, 223, 205, 0.62);
  box-shadow: inset 0 0 0 4.5px var(--paper), inset 0 0 0 6.5px var(--rust);
  transition: transform 160ms ease;
}
#entry .issued em {
  font-style: normal; font-size: clamp(10px, 1.7vmin, 21px);
  letter-spacing: 0.42em; text-indent: 0.42em; text-transform: uppercase;
}
#entry .issued b {
  font-size: clamp(30px, 6.6vmin, 84px); font-weight: 700; line-height: 1.06;
  letter-spacing: 0.24em; text-indent: 0.24em; text-transform: uppercase;
}
/* The one line allowed to break costume: an explicit affordance. */
#entry .hint {
  position: absolute; left: 50%; top: calc(100% + 1em);
  transform: translateX(-50%);
  display: none; white-space: nowrap; font-style: normal;
  font-family: var(--mono); font-size: clamp(9px, 1.15vmin, 13px);
  letter-spacing: 0.34em; text-indent: 0.34em; text-transform: uppercase;
  color: var(--ink-2);
}
#entry button.ready .hint { display: block; animation: entry-hint 420ms ease 980ms both; }
#entry button:not(.ready) .issued { display: none; }
#entry button.ready .pending { display: none; }
#entry button.ready .issued { animation: entry-stamp 540ms cubic-bezier(0.16, 1.3, 0.3, 1) 260ms both; }
#entry button.ready:hover .issued, #entry button.ready:focus-visible .issued {
  background-image: linear-gradient(rgba(165, 60, 21, 0.08), rgba(165, 60, 21, 0.08));
  transform: rotate(-3deg) scale(1.02);
}
#entry button.ready:active .issued { transform: rotate(-3deg) scale(0.985); }
#entry button:focus-visible { outline: none; }
#entry button.ready:focus-visible .issued { outline: 1.5px dashed var(--rust); outline-offset: 7px; }
/* The finished sheet steps back so the stamp owns the frame. */
#entry .field svg, #entry .cap, #entry .reg, #entry .revs,
#entry .title, #entry .foot, #entry .trim { transition: opacity 760ms ease; }
#entry.done .field svg { opacity: 0.4; }
#entry.done .cap, #entry.done .reg, #entry.done .revs { opacity: 0.42; }
#entry.done .title, #entry.done .foot, #entry.done .trim { opacity: 0.5; }

/* --- title block and sheet caption --------------------------------------- */
#entry .title { grid-area: title; border-left: 1px solid var(--ink); border-top: 1px solid var(--ink); }
#entry .proj { padding: 0.75em 0.85em 0.6em; }
#entry .proj b {
  display: block; font-size: clamp(11px, 1.28vmin, 17px); font-weight: 700;
  letter-spacing: 0.15em; text-transform: uppercase; color: var(--ink);
}
#entry .proj span {
  display: block; margin-top: 0.35em;
  font-size: clamp(7px, 0.8vmin, 9.5px); letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--ink-2);
}
#entry .cells { display: grid; grid-template-columns: repeat(3, 1fr); }
#entry .cells div {
  padding: 0.42em 0.6em 0.45em;
  border-top: 1px solid var(--ink-3); border-left: 1px solid var(--ink-3);
}
#entry .cells div:nth-child(3n + 1) { border-left: 0; }
#entry .cells em {
  display: block; font-style: normal; font-size: clamp(6px, 0.68vmin, 8px);
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3);
}
#entry .cells b {
  display: block; margin-top: 0.25em; font-family: var(--mono); font-weight: 400;
  font-size: clamp(8px, 0.92vmin, 11.5px); letter-spacing: 0.02em; color: var(--ink);
}
#entry .status {
  display: flex; gap: 0.8em; align-items: baseline;
  padding: 0.45em 0.85em 0.6em; border-top: 1px solid var(--ink-3);
  font-size: clamp(7px, 0.82vmin, 10px); letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--ink);
}
#entry .status em { font-style: normal; color: var(--ink-3); letter-spacing: 0.2em; }
#entry .foot {
  grid-area: foot; border-top: 1px solid var(--ink);
  display: flex; align-items: baseline; gap: 1.6em; flex-wrap: wrap;
  padding: 0.75em 1em 0.8em;
}
#entry .foot h1 {
  margin: 0; font-size: clamp(10px, 1.2vmin, 16px); font-weight: 700;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink);
}
#entry .foot .sub, #entry .foot .adm {
  font-size: clamp(7px, 0.82vmin, 10px); letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--ink-2);
}
#entry .foot .adm { margin-left: auto; text-align: right; color: var(--ink-3); }

@media (max-width: 1000px) {
  #entry .revs, #entry .foot .adm { display: none; }
}
@media (max-height: 620px) {
  #entry .revs { display: none; }
}
@keyframes entry-stamp {
  from { opacity: 0; transform: rotate(-3deg) scale(1.6); }
  to { opacity: 1; transform: rotate(-3deg) scale(1); }
}
@keyframes entry-hint {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  #entry .ly, #entry .row, #entry .issued, #entry .field svg, #entry .cap,
  #entry .reg, #entry .revs, #entry .title, #entry .foot, #entry .trim { transition: none; }
  #entry button.ready .issued, #entry button.ready .hint { animation: none; }
}
`

export interface EntryScreen {
  setProgress(label: string, fraction: number): void
  showError(title: string, body: string): void
  /** Resolves when the visitor stamps the sheet. */
  showEnter(): Promise<void>
  hide(): void
}

/* ------------------------------------------------------------------ layers */

/**
 * The plot register, in the order the systems actually report. Codes are
 * discipline-prefixed the way a CAD layer list is: the sheet has to look filed.
 */
const LAYERS: ReadonlyArray<{ key: string; code: string; name: string }> = [
  { key: 'render-pipeline', code: 'X-PEN', name: 'Plotter pens · calibration' },
  { key: 'sky', code: 'E-SKY', name: 'Sky · butterscotch, held' },
  { key: 'exterior', code: 'C-SITE', name: 'Elysium Planitia · ground' },
  { key: 'dome', code: 'A-SHEL', name: 'Dome One · shell, 13 rings' },
  { key: 'groundworks', code: 'C-DECK', name: 'Park deck · levels, plinth' },
  { key: 'player', code: 'G-FIG', name: 'Scale figure · 1.70 m eye' },
  { key: 'archkit', code: 'A-KIT', name: 'Standard parts · printed' },
  { key: 'interiors', code: 'A-INT', name: 'Interiors · rooms, notes' },
  { key: 'park', code: 'G-KEY', name: 'Key plan · districts' },
  { key: 'tram', code: 'T-LOOP', name: 'The Loop · track, Gate S' },
  { key: 'robots', code: 'M-GKR', name: 'Groundskeepers · GK series' },
  { key: 'vegetation', code: 'L-PLNT', name: 'Planting · Tree 1' },
  { key: 'audio', code: 'M-AIR', name: 'Air handlers · runs, plant' },
  { key: 'prewarm', code: 'X-INK', name: 'Inking · dimensions' },
]

/** System ids that build no layer of their own but keep the plot moving. */
const LABEL_ALIAS: Record<string, string> = {
  physics: 'groundworks',
  interaction: 'player',
  doors: 'interiors',
  opsScreens: 'interiors',
}

/** The line under the plot percentage while the sheet is unfinished. */
const CHECK_LABELS: Record<string, string> = {
  'render-pipeline': 'Calibrating pens',
  sky: 'Plotting the sky',
  exterior: 'Contouring the plain',
  dome: 'Striking the shell',
  groundworks: 'Setting out levels',
  player: 'Adding the figure',
  archkit: 'Listing the parts',
  interiors: 'Fitting out interiors',
  park: 'Drawing the key plan',
  tram: 'Laying the Loop',
  robots: 'Logging groundskeepers',
  vegetation: 'Planting Tree 1',
  audio: 'Routing air handlers',
  prewarm: 'Pens down · inking',
  ready: 'Last layer · inking',
}

/* -------------------------------------------------- the world, at 1:500 --- */

/** Live constants, quoted from the systems that build them. */
const W = {
  domeBase: 130,
  domeCrown: 64,
  domeSphere: 164.031,
  domeCenterY: -100.031,
  thetaBase: 0.91495,
  ringStep: 0.070381,
  rings: 13,
  oculusR: 11.535,
  oculusY: 63.594,
  hubR: 2.4,
  ribDepth: [0.62, 1.55] as const,
  ringDepth: [0.5, 1.15] as const,
  ringHalf: [0.15, 0.3] as const,
  plinth: { inner: 128.9, outer: 131.7, top: 1.15, bottom: -2.4 },
  portal: { axisY: 4.6, bore: 6.15, tubeR: 5.6, wallZ: 128.4 },
  floorR: 122,
  rimWalk: 112,
  boulevard: [91, 103] as const,
  loopR: 97,
  platformEdge: 95.6,
  deckDepth: 6.6,
  canopyH: 3.6,
  treeH: 12,
  treeCanopy: 4.6,
  soilRing: 5.5,
  commons: { z: -54, r: 11.3, roof: 9.95, parapet: 10.55, lantern: 13.46, soffit: 4.4, l2: 5.05 },
  car: { halfWidth: 1.3, floor: 0.62, doorHead: 1.94, cant: 1.99, crown: 2.428, skirt: -0.4, seat: 0.456 },
  eye: 1.7,
} as const

const PLATE = { w: 1180, h: 812 }
/** Plot units per metre at 1:500. Every other scale on the plate derives. */
const SCALE_500 = 3.78
const SEC = { cx: 592, ground: 312 }

/** The section abscissa is world +z (south), drawn LEFT: we are looking west. */
const sz = (m: number): number => SEC.cx - m * SCALE_500
const sy = (m: number): number => SEC.ground - m * SCALE_500

const BOX = {
  keyPlan: { x: 0, y: 410, w: 404, h: 396 },
  detail: { x: 424, y: 410, w: 366, h: 218 },
  pens: { x: 424, y: 646, w: 366, h: 160 },
  parts: { x: 810, y: 410, w: 370, h: 146 },
  notes: { x: 810, y: 574, w: 370, h: 232 },
}

/** DETAIL A, at 1:50 — ten times the section, where a body is worth drawing. */
const DET = { k: 37.8, cx: 556, gy: 588 }
const dx = (m: number): number => DET.cx + m * DET.k
const dy = (m: number): number => DET.gy - m * DET.k

/* ----------------------------------------------------------- svg plumbing */

type Pt = readonly [number, number]

const u = (v: number): string => String(Math.round(v * 100) / 100)

const ln = (x1: number, y1: number, x2: number, y2: number, cls: string): string =>
  `<line x1="${u(x1)}" y1="${u(y1)}" x2="${u(x2)}" y2="${u(y2)}" class="${cls}"/>`

const rc = (x: number, y: number, w: number, h: number, cls: string): string =>
  `<rect x="${u(x)}" y="${u(y)}" width="${u(Math.abs(w))}" height="${u(Math.abs(h))}" class="${cls}"/>`

const ci = (cx: number, cy: number, r: number, cls: string): string =>
  `<circle cx="${u(cx)}" cy="${u(cy)}" r="${u(r)}" class="${cls}"/>`

const pa = (d: string, cls: string): string => `<path d="${d}" class="${cls}"/>`

const pl = (pts: readonly Pt[], cls: string, close = false): string =>
  pa(`M ${pts.map((p) => `${u(p[0])} ${u(p[1])}`).join(' L ')}${close ? ' Z' : ''}`, cls)

function tx(x: number, y: number, s: string, cls: string, anchor = 'start', rot = 0, len = 0): string {
  const t = rot === 0 ? '' : ` transform="rotate(${rot} ${u(x)} ${u(y)})"`
  const l = len === 0 ? '' : ` textLength="${u(len)}" lengthAdjust="spacing"`
  return `<text x="${u(x)}" y="${u(y)}" class="${cls}" text-anchor="${anchor}"${t}${l}>${s}</text>`
}

/** A boxed sub-drawing: hairline frame with its title ruled underneath. */
function frame(b: { x: number; y: number; w: number; h: number }, title: string): string {
  return (
    rc(b.x, b.y, b.w, b.h, 's0') +
    tx(b.x + 12, b.y + 17, title, 'tb') +
    ln(b.x + 12, b.y + 22.5, b.x + b.w - 12, b.y + 22.5, 's2')
  )
}

/** The oblique stroke: an architectural dimension terminator, not an arrow. */
const tick = (x: number, y: number): string => ln(x - 3.4, y + 3.4, x + 3.4, y - 3.4, 's1')

function dimH(x1: number, x2: number, yDim: number, yFeat: number, label: string): string {
  const dir = Math.sign(yDim - yFeat) || 1
  return (
    ln(x1, yFeat + dir * 2.5, x1, yDim + dir * 5, 's0') +
    ln(x2, yFeat + dir * 2.5, x2, yDim + dir * 5, 's0') +
    ln(x1, yDim, x2, yDim, 's1') +
    tick(x1, yDim) +
    tick(x2, yDim) +
    tx((x1 + x2) / 2, yDim - 4.5, label, 'tn', 'middle')
  )
}

function dimV(y1: number, y2: number, xDim: number, xFeat: number, label: string): string {
  const dir = Math.sign(xDim - xFeat) || 1
  return (
    ln(xFeat + dir * 2.5, y1, xDim + dir * 5, y1, 's0') +
    ln(xFeat + dir * 2.5, y2, xDim + dir * 5, y2, 's0') +
    ln(xDim, y1, xDim, y2, 's1') +
    tick(xDim, y1) +
    tick(xDim, y2) +
    tx(xDim - 4.5, (y1 + y2) / 2, label, 'tn', 'middle', -90)
  )
}

/** Section level datum: a half-filled triangle sitting on its own level line. */
function level(x: number, y: number, label: string, dir: 1 | -1): string {
  return (
    ln(x, y, x + dir * 52, y, 's1') +
    pl([[x, y], [x - 4.4, y - 7.6], [x + 4.4, y - 7.6]], 's2', true) +
    pl([[x, y], [x - 4.4, y - 7.6], [x, y - 7.6]], 'f2', true) +
    tx(x + dir * 8, y - 4, label, 'tn', dir > 0 ? 'start' : 'end')
  )
}

function leader(tip: Pt, knee: Pt, land: number, label: string, cls = 'tx', stroke = 's1'): string {
  const end = knee[0] + land
  return (
    pl([tip, knee, [end, knee[1]]], stroke) +
    ci(tip[0], tip[1], 1.7, 'f2') +
    tx(end + (land > 0 ? 4 : -4), knee[1] - 3.6, label, cls, land > 0 ? 'start' : 'end')
  )
}

/** The zigzag that says the drawing stops here, not the thing it draws. */
function breakV(x: number, y1: number, y2: number): string {
  const m = (y1 + y2) / 2
  return pl(
    [[x, y1], [x, m - 9], [x - 6.5, m - 3.5], [x + 6.5, m + 3.5], [x, m + 9], [x, y2]],
    's1',
  )
}

/** Outward-bulging arcs between points: drafted canopies and revision clouds. */
function scallop(pts: readonly Pt[], bulge = 0.58): string {
  let d = `M ${u(pts[0][0])} ${u(pts[0][1])}`
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i % pts.length]
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * bulge
    d += ` A ${u(r)} ${u(r)} 0 0 1 ${u(b[0])} ${u(b[1])}`
  }
  return `${d} Z`
}

const wobble = (i: number, seed: number): number => {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.545
  return s - Math.floor(s)
}

function cloudRing(cx: number, cy: number, rx: number, ry: number, n: number, seed: number): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = 0.9 + wobble(i, seed) * 0.2
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
  }
  return pts
}

/* --------------------------------------------------- shell trigonometry --- */

const shellZ = (t: number, extra = 0): number => (W.domeSphere + extra) * Math.sin(t)
const shellY = (t: number, extra = 0): number => W.domeCenterY + (W.domeSphere + extra) * Math.cos(t)
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const ribDepth = (t: number): number => lerp(W.ribDepth[0], W.ribDepth[1], t / W.thetaBase)

/* ------------------------------------------------------ the sheet itself --- */

/** Plate furniture that exists before anything is plotted: frames and datums. */
function sheetBase(): string {
  const out: string[] = []
  out.push(
    `<defs>` +
      `<pattern id="hatch-earth" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      ln(0, 0, 0, 10, 's0') +
      `</pattern>` +
      `<pattern id="hatch-cut" width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      ln(0, 0, 0, 4.6, 's0') +
      `</pattern>` +
      `</defs>`,
  )
  // Setting out: the dome axis and the datum, struck before any object line.
  out.push(ln(SEC.cx, 40, SEC.cx, 336, 's0 chain'))
  out.push(ln(60, SEC.ground, 1120, SEC.ground, 's0 chain'))
  out.push(tx(1030, SEC.ground - 10, '± 0.000 PARK DECK DATUM', 'ts', 'end'))
  // Sheet titles: the section, then every boxed sub-drawing.
  out.push(tx(24, 392, 'SECTION A–A', 'tt'))
  out.push(ln(24, 398, 232, 398, 's3'))
  out.push(ln(24, 401.5, 232, 401.5, 's0'))
  out.push(tx(244, 392, 'ON THE ARRIVAL AXIS, LOOKING WEST · 1:500', 'ts'))
  out.push(
    t3(
      frame(BOX.keyPlan, 'KEY PLAN · 1:2000') +
        frame(BOX.detail, 'DETAIL A · PLATFORM EDGE AT GATE S · 1:50') +
        frame(BOX.pens, 'PEN TABLE') +
        frame(BOX.parts, 'STANDARD PARTS · SCALES AS NOTED') +
        frame(BOX.notes, 'GENERAL NOTES'),
    ),
  )
  return out.join('')
}

/* --------------------------------------------------------------- layers --- */

const layer = (key: string, body: string): string => `<g class="ly" data-layer="${key}">${body}</g>`

/** Tier-3 ink: accompaniment that must read as texture, never as content. */
const t3 = (body: string): string => `<g class="t3">${body}</g>`

/** X-PEN — the plotter's own pen table. The render pipeline, as a legend. */
function penTable(): string {
  const b = BOX.pens
  const rows: ReadonlyArray<readonly [string, string, string, string]> = [
    ['1', '0.13', 'CONSTRUCTION, SETTING OUT', 's0'],
    ['2', '0.25', 'DIMENSION, ANNOTATION', 's1'],
    ['3', '0.35', 'HIDDEN, ENVELOPE', 's1 dash'],
    ['4', '0.50', 'OBJECT, BEYOND THE CUT', 's2'],
    ['5', '0.70', 'CUT PROFILE', 's3'],
    ['R', '0.35', 'REVISION', 'sr'],
  ]
  const out: string[] = []
  rows.forEach((row, i) => {
    const y = b.y + 46 + i * 18
    out.push(tx(b.x + 12, y + 3.4, row[0], 'tn'))
    out.push(tx(b.x + 34, y + 3.4, row[1], 'tn'))
    out.push(ln(b.x + 74, y, b.x + 128, y, row[3]))
    out.push(tx(b.x + 138, y + 3.4, row[2], 'ts'))
  })
  out.push(tx(b.x + 12, b.y + b.h - 8, 'PLOTTED ON ISRU BOND · 841 × 1189', 'ts'))
  return layer('render-pipeline', t3(out.join('')))
}

/** E-SKY — the held sun, and the shaft it throws through the oculus. */
function skyLayer(): string {
  const out: string[] = []
  const cx = 150
  const cy = 54
  out.push(ci(cx, cy, 11, 's2'))
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    out.push(ln(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 's1'))
  }
  // A sun angle, struck off a horizon line the way a shadow study is.
  out.push(ln(116, 88, 212, 88, 's0'))
  out.push(pa(`M 190 88 A 40 40 0 0 0 ${u(cx + 30.3)} ${u(cy + 18.6)}`, 's1'))
  out.push(tx(196, 80, '27°', 'tn'))
  out.push(tx(116, 108, 'SUN · ALT 27° AZ 250° WSW', 'tx'))
  out.push(tx(116, 121, 'SOL 214, SHIFT 14 — HELD', 'ts'))
  out.push(tx(1166, 30, 'SKY: BUTTERSCOTCH · AERIAL PERSPECTIVE FROM 55 m', 'ts', 'end'))

  // The oculus shaft, at its projected angle in this section plane.
  const run = W.oculusY / Math.tan((56.1 * Math.PI) / 180)
  const p1: Pt = [sz(W.oculusR), sy(W.oculusY)]
  const p2: Pt = [sz(-W.oculusR), sy(W.oculusY)]
  const p3: Pt = [sz(-W.oculusR - run), sy(0)]
  const p4: Pt = [sz(W.oculusR - run), sy(0)]
  out.push(pl([p1, p4, p3, p2], 'f1', true))
  out.push(pl([p1, p4], 's0'))
  out.push(pl([p2, p3], 's0'))
  out.push(leader([sz(-26), sy(36)], [sz(-58), sy(46)], 64, 'OCULUS SHAFT · PROJECTED 56°'))
  return layer('sky', out.join(''))
}

/** C-SITE — Elysium Planitia: the ground the plinth is cut into. */
function siteLayer(): string {
  const out: string[] = []
  const g = sy(-1)
  const left = sz(W.plinth.outer)
  const right = sz(-W.plinth.outer)
  out.push(ln(30, g, left, g, 's3'))
  out.push(ln(right, g, 1162, g, 's3'))
  out.push(rc(30, g, left - 30, 24, 'fe'))
  out.push(rc(right, g, 1162 - right, 24, 'fe'))
  for (let i = 0; i < 4; i++) {
    out.push(ln(42 + i * 15, g + 30, 48 + i * 15, g + 30, 's0'))
    out.push(ln(1096 + i * 15, g + 30, 1102 + i * 15, g + 30, 's0'))
  }
  out.push(breakV(30, g - 34, g + 24))
  out.push(breakV(1162, g - 34, g + 24))
  out.push(tx(36, 248, 'GROUND FALLS TO THE SOUTH PASS · SEE SHEET 07', 'ts'))
  out.push(tx(1130, 276, 'SITE ELEVATION − 2 540 m (MOLA)', 'ts', 'end'))
  // The arrival tube, running off-sheet to the south pass.
  const t0 = sy(W.portal.axisY + W.portal.tubeR)
  const t1 = sy(W.portal.axisY - W.portal.tubeR)
  out.push(ln(44, t0, sz(W.portal.wallZ), t0, 's2'))
  out.push(ln(44, t1, sz(W.portal.wallZ), t1, 's2'))
  out.push(ln(44, sy(W.portal.axisY), sz(W.portal.wallZ + 3), sy(W.portal.axisY), 's0 chain'))
  out.push(breakV(52, t0 - 4, t1 + 4))
  out.push(leader([70, t1 - 2], [70, sy(-7)], 90, 'TUBE Ø 11.2 → SOUTH PASS, 421 m'))
  return layer('exterior', out.join(''))
}

/** A-SHEL — the gridshell: one glass line, one rib, thirteen ring beams. */
function domeLayer(): string {
  const out: string[] = []
  const tOc = W.ringStep
  const rGlass = W.domeSphere * SCALE_500
  const arc = (from: number, to: number): string =>
    `M ${u(sz(shellZ(from)))} ${u(sy(shellY(from)))} A ${u(rGlass)} ${u(rGlass)} 0 0 1 ` +
    `${u(sz(shellZ(to)))} ${u(sy(shellY(to)))}`

  out.push(tx(24, 20, 'SHELL: 24 RIBS AT 15° · 13 RING PARALLELS · 4 × 2 PANES PER BAY', 'ts'))
  for (const side of [1, -1] as const) {
    // Structural envelope: the rib, cut lengthwise, deepening toward the foot.
    const outer: Pt[] = []
    const inner: Pt[] = []
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const t = lerp(tOc, W.thetaBase, i / steps)
      const d = ribDepth(t)
      outer.push([sz(side * shellZ(t, d)), sy(shellY(t, d))])
      inner.push([sz(side * shellZ(t)), sy(shellY(t))])
    }
    const band = [...outer, ...inner.slice().reverse()]
    out.push(pl(band, 'fh', true))
    out.push(pl(band, 's2', true))
    out.push(pa(side > 0 ? arc(W.thetaBase, tOc) : arc(-tOc, -W.thetaBase), 's2'))

    // Ring beams, cut square on the outer face at their true parallels.
    for (let k = 2; k <= W.rings; k++) {
      const t = k * W.ringStep
      if (t > W.thetaBase + 1e-6) continue
      const f = t / W.thetaBase
      const dep = lerp(W.ringDepth[0], W.ringDepth[1], f)
      const half = lerp(W.ringHalf[0], W.ringHalf[1], f)
      const d0 = ribDepth(t)
      const bx = sz(side * shellZ(t, d0 + dep / 2))
      const by = sy(shellY(t, d0 + dep / 2))
      const ang = (-side * t * 180) / Math.PI
      out.push(
        `<g transform="translate(${u(bx)} ${u(by)}) rotate(${u(ang)})">` +
          rc(-half * SCALE_500, (-dep / 2) * SCALE_500, half * 2 * SCALE_500, dep * SCALE_500, 'f2') +
          `</g>`,
      )
    }
    // The springing lands in a poché'd plinth, buried 2.4 m.
    const px = sz(side * W.plinth.outer)
    const pw = (W.plinth.outer - W.plinth.inner) * SCALE_500
    const x0 = side > 0 ? px : px - pw
    out.push(rc(x0, sy(W.plinth.top), pw, (W.plinth.top - W.plinth.bottom) * SCALE_500, 'fh'))
    out.push(rc(x0, sy(W.plinth.top), pw, (W.plinth.top - W.plinth.bottom) * SCALE_500, 's3'))
  }

  // Oculus: ring beam cut both sides, hub and spokes across the opening.
  const oy = sy(W.oculusY)
  out.push(rc(sz(W.oculusR) - 3, oy - 7, 6, 7, 'f2'))
  out.push(rc(sz(-W.oculusR) - 3, oy - 7, 6, 7, 'f2'))
  out.push(ln(sz(W.oculusR), oy - 3.5, sz(-W.oculusR), sy(W.domeCrown) - 3.5, 's1'))
  out.push(ln(sz(-W.oculusR), oy - 3.5, sz(W.oculusR), sy(W.domeCrown) - 3.5, 's1'))
  out.push(rc(sz(W.hubR), sy(W.domeCrown) - 5, W.hubR * 2 * SCALE_500, 5, 'f2'))
  out.push(leader([sz(-8), oy - 6], [700, 40], 70, 'OCULUS Ø 23.07'))
  out.push(leader([sz(78.6), sy(43.9)], [330, 98], 40, 'GLASS R 164.031 · CENTRE OFF SHEET'))
  // The tube's aperture through the shell, on the portal axis.
  out.push(ci(sz(W.portal.wallZ), sy(W.portal.axisY), W.portal.bore * SCALE_500, 's1 dash'))
  return layer('dome', out.join(''))
}

/** C-DECK — the park deck, its rim, and the levels that govern everything. */
function deckLayer(): string {
  const out: string[] = []
  const g = sy(0)
  out.push(ln(sz(W.plinth.inner), g, sz(-W.plinth.inner), g, 's3'))
  out.push(rc(sz(W.plinth.inner), g, W.plinth.inner * 2 * SCALE_500, 15, 'fe'))
  for (const side of [1, -1] as const) {
    out.push(ln(sz(side * W.rimWalk), g, sz(side * W.rimWalk), g - 5, 's1'))
    out.push(ln(sz(side * W.boulevard[0]), g, sz(side * W.boulevard[0]), g - 4, 's0'))
    out.push(ln(sz(side * W.boulevard[1]), g, sz(side * W.boulevard[1]), g - 4, 's0'))
  }
  out.push(leader([sz(112), g - 5], [sz(105), sy(11)], 76, 'RIM WALK r 112'))
  out.push(leader([sz(-130), sy(0.6)], [sz(-118), sy(17)], -70, 'PLINTH + 1.150 / FOOTING − 2.400'))
  return layer('groundworks', out.join(''))
}

/** An entourage silhouette, 1.80 m tall, drawn from the feet up. */
function figureSilhouette(x: number, footY: number, k: number): string {
  const h = (m: number): number => footY - m * k
  return (
    ci(x, h(1.71), 0.105 * k, 'f2') +
    pa(
      `M ${u(x - 0.2 * k)} ${u(h(0))} L ${u(x - 0.2 * k)} ${u(h(1.02))} L ${u(x - 0.24 * k)} ${u(h(1.5))} ` +
        `L ${u(x - 0.1 * k)} ${u(h(1.57))} L ${u(x + 0.1 * k)} ${u(h(1.57))} L ${u(x + 0.24 * k)} ${u(h(1.5))} ` +
        `L ${u(x + 0.2 * k)} ${u(h(1.02))} L ${u(x + 0.2 * k)} ${u(h(0))} L ${u(x + 0.07 * k)} ${u(h(0))} ` +
        `L ${u(x + 0.07 * k)} ${u(h(1.0))} L ${u(x - 0.07 * k)} ${u(h(1.0))} L ${u(x - 0.07 * k)} ${u(h(0))} Z`,
      'f2',
    )
  )
}

/** G-FIG — the visitor, at 1:50, the only scale where a body is worth ink. */
function figureLayer(): string {
  const b = BOX.detail
  const fx = dx(2.72)
  const base = dy(W.car.floor)
  const out: string[] = []
  out.push(figureSilhouette(fx, base, DET.k))
  out.push(dimV(dy(W.car.floor + W.eye), base, fx + 40, fx + 13, '1700'))
  out.push(tx(b.x + b.w - 14, 452, 'VISITOR · NO EVA · NO SUIT CHECK', 'ts', 'end'))
  return layer('player', t3(out.join('')))
}

/** A-KIT — three parts of the kit the park is assembled from. */
function partsLayer(): string {
  const b = BOX.parts
  const out: string[] = []
  const base = b.y + 106

  // Station canopy bay, 1:100.
  let k = SCALE_500 * 5
  let cx = b.x + 62
  out.push(rc(cx - 0.16 * k, base - W.canopyH * k, 0.32 * k, W.canopyH * k, 'f2'))
  out.push(ln(cx - 2.6 * k, base - W.canopyH * k, cx + 2.6 * k, base - W.canopyH * k - 0.26 * k, 's2'))
  out.push(ln(cx - 2.6 * k, base - (W.canopyH - 0.34) * k, cx + 2.6 * k, base - (W.canopyH - 0.6) * k, 's1'))
  out.push(ln(cx - 2.6 * k, base, cx + 2.6 * k, base, 's3'))
  out.push(tx(cx, base + 16, 'A-KIT/02 CANOPY BAY', 'ts', 'middle'))
  out.push(tx(cx, base + 28, '3.60 CLEAR · 1:100', 'tn', 'middle'))

  // Hab unit barrel, 1:200.
  k = SCALE_500 * 2.5
  cx = b.x + 190
  const hw = 3.44 * k
  out.push(
    pa(
      `M ${u(cx - hw)} ${u(base)} L ${u(cx - hw)} ${u(base - 1.36 * k)} ` +
        `Q ${u(cx - hw)} ${u(base - 3.6 * k)} ${u(cx)} ${u(base - 3.6 * k)} ` +
        `Q ${u(cx + hw)} ${u(base - 3.6 * k)} ${u(cx + hw)} ${u(base - 1.36 * k)} ` +
        `L ${u(cx + hw)} ${u(base)} Z`,
      's2',
    ),
  )
  out.push(ln(cx - hw, base - 0.5 * k, cx + hw, base - 0.5 * k, 's1'))
  out.push(ln(cx - hw - 7, base, cx + hw + 7, base, 's3'))
  out.push(tx(cx, base + 16, 'A-KIT/07 HAB UNIT', 'ts', 'middle'))
  out.push(tx(cx, base + 28, '6.88 × 3.60 · 1:200', 'tn', 'middle'))

  // Planter kerb, 1:20.
  k = SCALE_500 * 25
  cx = b.x + 306
  const wall = 0.2 * k
  out.push(rc(cx - wall / 2, base - 0.52 * k, wall, 0.52 * k, 'fh'))
  out.push(rc(cx - wall / 2, base - 0.52 * k, wall, 0.52 * k, 's3'))
  out.push(rc(cx - wall / 2 - 0.035 * k, base - 0.52 * k, wall + 0.07 * k, 0.075 * k, 'f2'))
  out.push(ln(cx + wall / 2, base - 0.38 * k, cx + wall / 2 + 24, base - 0.38 * k, 's1'))
  out.push(tx(cx + wall / 2 + 28, base - 0.4 * k, 'SOIL', 'ts'))
  out.push(ln(cx - 40, base, cx + 40, base, 's3'))
  out.push(tx(cx, base + 16, 'A-KIT/11 PLANTER KERB', 'ts', 'middle'))
  out.push(tx(cx, base + 28, 'RIM 0.520 · 1:20', 'tn', 'middle'))
  return layer('archkit', t3(out.join('')))
}

/** A-INT — the Commons drum, cut by the section at z − 54, and the notes. */
function interiorsLayer(): string {
  const c = W.commons
  const out: string[] = []
  const x0 = sz(c.z + c.r)
  const x1 = sz(c.z - c.r)
  out.push(rc(x0, sy(c.roof), x1 - x0, c.roof * SCALE_500, 's2'))
  out.push(ln(x0, sy(c.soffit), x1, sy(c.soffit), 's1'))
  out.push(ln(x0, sy(c.l2), x1, sy(c.l2), 's1'))
  out.push(ln(x0 - 11, sy(c.roof), x1 + 11, sy(c.roof), 's2'))
  out.push(rc(x0 - 11, sy(c.parapet), x1 - x0 + 22, (c.parapet - c.roof) * SCALE_500, 's2'))
  out.push(rc(sz(c.z + 4.45), sy(c.lantern), 8.9 * SCALE_500, (c.lantern - c.parapet) * SCALE_500, 's2'))
  out.push(tx(sz(c.z), sy(2.1), 'ASSEMBLY', 'ts', 'middle'))
  out.push(tx(sz(c.z), sy(6.6), 'GALLEY · CLINIC', 'ts', 'middle'))
  out.push(leader([sz(c.z - 8), sy(c.lantern)], [sz(c.z - 26), sy(21)], 84, 'THE COMMONS · DRUM Ø 22.6'))

  // The general notes: the part of a drawing where somebody speaks. Set as
  // real two-line notes with a hanging indent — a 66-character line squeezed
  // into this column by textLength would crush the tracking. Tier-3: the
  // drum above is part of the section (secondary), the notes are furniture.
  const b = BOX.notes
  const notes: ReadonlyArray<readonly string[]> = [
    ['ALL LEVELS TO PARK DECK DATUM ± 0.000.', 'THE SPRINGING IS THE DATUM.'],
    ['DECK CROWNS + 0.34 AT CENTRE, FALLING TO', 'ZERO AT r 118. TOO SMALL TO PLOT.'],
    ['NO EVA. THE SHELL IS SEALED AND STAYS', 'SEALED. 71.2 kPa, 21.4 °C, RH 34 %.'],
    ['MAINTAINED BY THE GK SERIES. NO STANDING', 'CREW. IN PARK TODAY 214 OF 10 000.'],
    ['THE ONLY SOUND IS AIR, MACHINERY AND THE', 'TRAM. NOTHING IS PLAYED.'],
    ['OBJECTS BEYOND THE CUT OMITTED FOR', 'CLARITY.'],
  ]
  const noteInk: string[] = []
  let ny = b.y + 42
  notes.forEach((note, i) => {
    noteInk.push(tx(b.x + 12, ny, String(i + 1), 'tn'))
    for (const line of note) {
      noteInk.push(tx(b.x + 32, ny, line, 'tx'))
      ny += 14
    }
    ny += 6
  })
  return layer('interiors', out.join('') + t3(noteInk.join('')))
}

/** G-KEY — the whole park at 1:2000, and where this section is cut. */
function keyPlanLayer(): string {
  const b = BOX.keyPlan
  const k = SCALE_500 / 4
  const cx = b.x + 202
  const cy = b.y + 214
  const px = (x: number): number => cx + x * k
  const py = (z: number): number => cy + z * k
  const out: string[] = []

  out.push(ci(cx, cy, W.plinth.outer * k, 's2'))
  out.push(ci(cx, cy, W.floorR * k, 's0'))
  out.push(ci(cx, cy, W.rimWalk * k, 's0 chain'))
  out.push(ci(cx, cy, W.boulevard[0] * k, 's0'))
  out.push(ci(cx, cy, W.boulevard[1] * k, 's0'))
  out.push(ci(cx, cy, W.loopR * k, 's2 chain'))
  out.push(ci(cx, cy, W.oculusR * k, 's0 dash'))

  // The three stops on the Loop: portal south, farmside east, overlook west.
  const stops: ReadonlyArray<readonly [number, string, string, number, number]> = [
    [Math.PI / 2, 'GATE S', 'middle', 0, 16],
    [0.05, 'FARMSIDE', 'start', 9, 3.4],
    [Math.PI + 0.07, 'OVERLOOK', 'end', -9, -8],
  ]
  for (const [a, name, anchor, ox, oy] of stops) {
    const x = px(Math.cos(a) * W.loopR)
    const y = py(Math.sin(a) * W.loopR)
    out.push(rc(x - 4, y - 4, 8, 8, 'f2'))
    out.push(tx(x + ox, y + oy, name, 'ts', anchor))
  }
  // Districts, as the plan knows them.
  out.push(ci(px(-2), py(-54), 11.3 * k, 's2'))
  out.push(tx(px(-2), py(-54) - 16, 'THE COMMONS', 'ts', 'middle'))
  out.push(ci(px(52), py(18), 7 * k, 's2'))
  out.push(ci(px(-52), py(34), 24 * k, 's0 dash'))
  out.push(tx(px(-52), py(34) + 4, 'BOWL', 'ts', 'middle'))
  // The open-regolith zone (dashed) with THE FOUNTAIN's paved court inside it.
  out.push(ci(px(-38), py(-40), 28 * k, 's0 dash'))
  out.push(ci(px(-38), py(-40), 12.6 * k, 's2'))
  out.push(ci(px(-38), py(-40), 7.6 * k, 'f2'))
  out.push(tx(px(-38), py(-40) - 20, 'THE FOUNTAIN', 'ts', 'middle'))
  for (let i = 0; i < 3; i++) {
    const z = -22 + i * 22
    out.push(rc(px(53), py(z - 4.5), 34 * k, 9 * k, 's2'))
  }
  out.push(tx(px(70), py(40), 'FARMSIDE A–C', 'ts', 'middle'))
  out.push(
    `<g transform="rotate(20 ${u(px(48))} ${u(py(-58))})">` +
      rc(px(48) - 13 * k, py(-58) - 7.5 * k, 26 * k, 15 * k, 's2') +
      `</g>`,
  )
  out.push(tx(px(48) + 20, py(-58) - 8, 'THE WORKS', 'ts'))
  for (let i = 0; i < 10; i++) {
    const a = Math.PI + 0.18 + i * 0.115
    out.push(rc(px(Math.cos(a) * 88) - 3, py(Math.sin(a) * 88) - 3, 6, 6, 's1'))
  }
  out.push(tx(px(-67) - 6, py(-57), 'HABS 01–10', 'ts', 'end'))
  out.push(rc(px(-114) - 5, py(-6) - 9, 10, 18, 's2'))
  // Tree 1 at the origin, marked the way a survey marks a monument.
  out.push(ln(cx - 9, cy, cx + 9, cy, 'sr'))
  out.push(ln(cx, cy - 9, cx, cy + 9, 'sr'))
  out.push(ci(cx, cy, W.soilRing * k, 'sr'))
  out.push(tx(cx + 12, cy - 6, 'TREE 1', 'tr'))
  // The arrival tube, and the section line this plate is cut on.
  out.push(ln(px(-6), py(W.portal.wallZ - 4), px(-6), b.y + b.h - 30, 's2'))
  out.push(ln(px(6), py(W.portal.wallZ - 4), px(6), b.y + b.h - 30, 's2'))
  out.push(ln(cx, b.y + 34, cx, b.y + b.h - 30, 's1 chain'))
  for (const y of [b.y + 34, b.y + b.h - 30]) {
    out.push(ln(cx, y, cx - 25, y, 's1'))
    out.push(pl([[cx - 25, y], [cx - 17, y - 4], [cx - 17, y + 4]], 'f2', true))
    out.push(ci(cx - 34, y, 9, 's2'))
    out.push(tx(cx - 34, y + 3.6, 'A', 'tb', 'middle'))
  }
  // North is − z, and the plate is drawn with north up.
  const nx = b.x + b.w - 40
  const ny = b.y + 56
  out.push(pl([[nx, ny - 22], [nx + 6, ny + 10], [nx, ny + 3], [nx - 6, ny + 10]], 'f2', true))
  out.push(tx(nx, ny + 24, 'N', 'tb', 'middle'))
  out.push(tx(b.x + 12, b.y + b.h - 8, 'PARK Ø 260 · FLOOR r 122 · LOOP r 97 · 3 STOPS', 'ts'))
  return layer('park', t3(out.join('')))
}

/** T-LOOP — the track, the gate, the car, and the way in. */
function tramLayer(): string {
  const out: string[] = []
  const g = sy(0)
  for (const side of [1, -1] as const) {
    const x = sz(side * W.loopR)
    out.push(ln(x, g + 12, x, g - 22, 's0 chain'))
    out.push(rc(x - 1.35 * SCALE_500, g - 1, 2.7 * SCALE_500, 3, 'f2'))
  }
  out.push(tx(sz(-W.loopR), g + 22, 'CL LOOP', 'ts', 'middle'))
  // Gate S: the terminus deck, its canopy, and a car standing at it.
  const edge = sz(W.platformEdge)
  const back = sz(W.platformEdge - W.deckDepth)
  out.push(rc(edge, sy(0.9), back - edge, 0.9 * SCALE_500, 'fh'))
  out.push(rc(edge, sy(0.9), back - edge, 0.9 * SCALE_500, 's2'))
  out.push(ln(back, sy(W.canopyH), edge - 4, sy(W.canopyH + 0.26), 's2'))
  out.push(ln(back - 8, sy(W.canopyH), back - 8, sy(0.9), 's2'))
  out.push(rc(sz(W.loopR + 1.3), sy(W.car.floor + W.car.crown), 2.6 * SCALE_500, (W.car.crown + 0.4) * SCALE_500, 's2'))
  out.push(leader([edge - 6, sy(2.2)], [sz(84), sy(34)], 96, 'GATE S · PORTAL STATION'))
  out.push(tx(sz(84) + 100, sy(34) + 10, 'HEADWAY 4 MIN · 2 CARS · 8 m/s', 'ts'))
  out.push(tx(sz(W.portal.wallZ) + 6, sy(11.5), 'IRIS', 'ts'))
  return layer('tram', out.join('')) + detailTram()
}

/** DETAIL A — the boarding moment: car, gap, platform, at 1:50. */
function detailTram(): string {
  const b = BOX.detail
  const c = W.car
  const f = c.floor
  const hw = c.halfWidth
  const out: string[] = []
  out.push(ln(DET.cx, 448, DET.cx, 604, 's0 chain'))
  out.push(rc(dx(-0.675), DET.gy, 1.35 * DET.k, 9, 'fh'))
  out.push(rc(dx(-0.675), DET.gy, 1.35 * DET.k, 9, 's2'))
  // The car, cut transversely at the door.
  out.push(
    pa(
      `M ${u(dx(-1.12))} ${u(dy(f + c.skirt))} L ${u(dx(-hw))} ${u(dy(f))} L ${u(dx(-hw))} ${u(dy(f + c.cant))} ` +
        `Q ${u(dx(-hw))} ${u(dy(f + c.crown))} ${u(dx(0))} ${u(dy(f + c.crown))} ` +
        `Q ${u(dx(hw))} ${u(dy(f + c.crown))} ${u(dx(hw))} ${u(dy(f + c.cant))} ` +
        `L ${u(dx(hw))} ${u(dy(f))} L ${u(dx(1.12))} ${u(dy(f + c.skirt))} Z`,
      's3',
    ),
  )
  out.push(ln(dx(-hw), dy(f), dx(hw), dy(f), 's2'))
  out.push(ln(dx(hw), dy(f) - 2, dx(hw), dy(f + c.doorHead) + 2, 'sp'))
  out.push(ln(dx(hw) - 4, dy(f + c.doorHead), dx(hw) + 4, dy(f + c.doorHead), 's2'))
  out.push(rc(dx(0.25), dy(f + c.seat), 0.94 * DET.k, 0.12 * DET.k, 's1'))
  out.push(rc(dx(-1.19), dy(f + c.seat), 0.94 * DET.k, 0.12 * DET.k, 's1'))
  // Platform, tactile strip, and the 100 mm that is the whole gap.
  out.push(rc(dx(1.4), dy(f), b.x + b.w - 14 - dx(1.4), 0.62 * DET.k, 'fh'))
  out.push(ln(dx(1.4), dy(f), b.x + b.w - 14, dy(f), 's3'))
  out.push(ln(dx(1.4), dy(f), dx(1.4), DET.gy, 's3'))
  out.push(rc(dx(1.6), dy(f) - 2, 0.4 * DET.k, 2, 'f2'))
  out.push(tx(dx(1.82), dy(f) + 15, 'TACTILE', 'ts', 'middle'))
  out.push(dimH(dx(-hw), dx(hw), 458, dy(f + c.crown), '2600'))
  out.push(dimH(DET.cx, dx(1.4), 612, dy(f), '1400'))
  out.push(leader([dx(1.35), dy(f + 0.4)], [dx(3.2), 520], 30, '100 CLEAR', 'tn'))
  out.push(dimV(dy(f + c.doorHead), dy(f), dx(-2.1), dx(-hw), '1940'))
  out.push(tx(b.x + b.w - 14, 618, 'LEVEL BOARDING · DOOR CLEAR 1760', 'ts', 'end'))
  return layer('tram', t3(out.join('')))
}

/** M-GKR — the machines that keep it: one on the shell, one on the platform. */
function robotsLayer(): string {
  const out: string[] = []
  // Panewalker, straddling the crane rails on ring beams 4 and 8.
  const front: Pt[] = []
  const back: Pt[] = []
  for (let i = 0; i <= 16; i++) {
    const t = lerp(4 * W.ringStep, 8 * W.ringStep, i / 16)
    const d = ribDepth(t) + 0.4
    front.push([sz(-shellZ(t, d)), sy(shellY(t, d))])
    back.push([sz(-shellZ(t, d + 1.35)), sy(shellY(t, d + 1.35))])
  }
  out.push(pl([...front, ...back.slice().reverse()], 's2', true))
  for (let i = 0; i <= 16; i += 2) out.push(pl([front[i], back[i]], 's0'))
  for (const k of [4, 8]) {
    const t = k * W.ringStep
    out.push(ci(sz(-shellZ(t, ribDepth(t) + 0.2)), sy(shellY(t, ribDepth(t) + 0.2)), 2.4, 's1'))
  }
  out.push(leader([back[8][0], back[8][1]], [900, 70], 36, 'PANEWALKER · ONE LAP 34 MIN'))
  out.push(tx(1166, 83, 'GK-01 · GK-02 · SWEEP-1 · MULE-1 — NO STANDING CREW', 'ts', 'end'))
  // GK-01 waiting on the platform, at detail scale.
  const k2 = DET.k
  const rx = dx(4.5)
  const ry = dy(W.car.floor)
  out.push(rc(rx - 0.21 * k2, ry - 0.404 * k2, 0.42 * k2, 0.29 * k2, 's2'))
  out.push(ci(rx - 0.123 * k2, ry - 0.152 * k2, 0.152 * k2, 's2'))
  out.push(ci(rx + 0.123 * k2, ry - 0.152 * k2, 0.152 * k2, 's2'))
  out.push(ln(rx, ry - 0.404 * k2, rx, ry - 0.6 * k2, 's2'))
  out.push(ci(rx, ry - 0.6 * k2, 2.4, 'f2'))
  out.push(tx(rx, ry + 15, 'GK-01', 'ts', 'middle'))
  return layer('robots', out.join(''))
}

/** L-PLNT — Tree 1, the envelope it was drawn inside, and REV G. */
function plantingLayer(): string {
  const out: string[] = []
  const g = sy(0)
  const trunkTop = W.treeH - W.treeCanopy * 1.15
  out.push(rc(sz(W.soilRing), sy(0.52), W.soilRing * 2 * SCALE_500, 0.52 * SCALE_500, 'fh'))
  out.push(rc(sz(W.soilRing), sy(0.52), W.soilRing * 2 * SCALE_500, 0.52 * SCALE_500, 's2'))
  out.push(
    pa(
      `M ${u(sz(0.42))} ${u(sy(0.38))} L ${u(sz(0.19))} ${u(sy(trunkTop))} ` +
        `L ${u(sz(-0.19))} ${u(sy(trunkTop))} L ${u(sz(-0.42))} ${u(sy(0.38))} Z`,
      's2',
    ),
  )
  const cy = sy(W.treeH - W.treeCanopy * 0.92)
  const rx = W.treeCanopy * SCALE_500
  out.push(pa(scallop(cloudRing(SEC.cx, cy, rx, rx * 0.96, 15, 3)), 's2'))
  // The envelope the tree was drawn inside — and the metre it took anyway.
  const env = sy(11)
  out.push(pl([[sz(6.4), g], [sz(6.4), env], [sz(-6.4), env], [sz(-6.4), g]], 's1 dash'))
  out.push(tx(sz(6.4) - 8, env + 13, 'PLANTING ENVELOPE 12.8 × 11.0', 'ts', 'end'))
  out.push(pa(scallop(cloudRing(SEC.cx, cy - 4, rx + 12, rx + 8, 17, 9)), 'sr'))
  out.push(pl([[sz(-13), sy(21)], [sz(-16.5), sy(24.4)], [sz(-9.5), sy(24.4)]], 'sr', true))
  out.push(tx(sz(-13), sy(22.1), 'G', 'tr', 'middle'))
  out.push(
    leader([sz(-4.5), sy(12)], [sz(-22), sy(30)], 104, 'TREE 1 · GINKGO BILOBA · PLANTED SOL 1', 'tb', 'sr'),
  )
  out.push(tx(sz(-22) + 108, sy(30) + 10, '12.0 m — 1.0 m ABOVE ENVELOPE. SEE REV G.', 'tr'))
  // Low planting either side of the plaza, drawn the way a plan drafts shrubs.
  for (const z of [22, 34, 46, 66, -20, -30, -74]) {
    const x = sz(z)
    out.push(pa(scallop(cloudRing(x, sy(2.2), 8, 6, 8, z)), 's1'))
    out.push(ln(x, g, x, sy(1.1), 's1'))
  }
  out.push(dimH(sz(W.soilRing), sz(-W.soilRing), sy(-6), g, 'Ø 11.0 SOIL RING'))
  return layer('vegetation', out.join(''))
}

/** M-AIR — the air handlers, which are most of what you will hear. */
function airLayer(): string {
  const out: string[] = []
  for (const side of [1, -1] as const) {
    const x = sz(side * 120)
    out.push(ci(x, sy(3.2), 0.6 * SCALE_500, 's2'))
    out.push(ci(x, sy(3.2), 0.6 * SCALE_500 - 2.2, 's0'))
    for (let i = 0; i < 3; i++) {
      const ax = x - side * (14 + i * 13)
      out.push(ln(ax, sy(3.2), ax - side * 9, sy(3.2), 's1'))
      out.push(
        pl(
          [[ax - side * 9, sy(3.2)], [ax - side * 5.4, sy(3.2) - 2.6], [ax - side * 5.4, sy(3.2) + 2.6]],
          'f2',
          true,
        ),
      )
    }
  }
  out.push(leader([sz(120), sy(3.8)], [sz(108), sy(20)], 70, 'AIR HANDLERS · CONTINUOUS · 21.4 °C'))
  return layer('audio', out.join(''))
}

/** X-INK — a drafter dimensions last. The sheet closes with its numbers. */
function inkLayer(): string {
  const out: string[] = []
  const g = sy(0)
  out.push(dimH(sz(W.domeBase), sz(-W.domeBase), 348, g, '260 000 SPAN AT SPRINGING'))
  out.push(dimH(sz(W.plinth.outer), sz(-W.plinth.outer), 366, g, 'Ø 263 400 OVER PLINTH'))
  out.push(dimH(sz(W.oculusR), sz(-W.oculusR), 51, sy(W.oculusY), 'Ø 23 070'))
  out.push(dimV(sy(W.domeCrown), g, 1146, sz(-W.domeBase), '64 000 CROWN'))
  out.push(level(sz(-30), sy(W.domeCrown), '+ 64.000 CROWN', 1))
  // Scale bar: fifty metres of drawing, checked against the plot.
  const bx = 872
  const by = 372
  for (let i = 0; i < 5; i++) {
    const x0 = bx + i * 10 * SCALE_500
    out.push(rc(x0, by - 5, 10 * SCALE_500, 5, i % 2 === 0 ? 'f2' : 's1'))
    out.push(tx(x0, by + 11, String(i * 10), 'tn', 'middle'))
  }
  out.push(ln(bx, by, bx + 50 * SCALE_500, by, 's2'))
  out.push(tx(bx + 50 * SCALE_500, by + 11, '50 m', 'tn', 'middle'))
  out.push(tx(bx, by - 11, 'SCALE 1:500', 'ts'))
  return layer('prewarm', out.join(''))
}

function drawing(): string {
  return (
    `<svg viewBox="0 0 ${PLATE.w} ${PLATE.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    sheetBase() +
    penTable() +
    skyLayer() +
    siteLayer() +
    domeLayer() +
    deckLayer() +
    figureLayer() +
    partsLayer() +
    interiorsLayer() +
    keyPlanLayer() +
    tramLayer() +
    robotsLayer() +
    plantingLayer() +
    airLayer() +
    inkLayer() +
    `</svg>`
  )
}

/* ------------------------------------------------------------ the markup --- */

const zoneStrip = (cls: string, marks: readonly string[]): string =>
  `<div class="zone ${cls}">${marks.map((m) => `<span>${m}</span>`).join('')}</div>`

function markup(): string {
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  const rows = ['1', '2', '3', '4']
  const register = LAYERS.map(
    (l) =>
      `<div class="row" data-row="${l.key}">` +
      `<span class="code">${l.code}</span><span class="name">${l.name}</span><span class="box"></span></div>`,
  ).join('')
  return (
    `<div class="trim">` +
    zoneStrip('t', cols) +
    zoneStrip('b', cols) +
    zoneStrip('l', rows) +
    zoneStrip('r', rows) +
    `</div>` +
    `<div class="plate">` +
    `<div class="field">${drawing()}` +
    `<div class="note" role="alert"><div class="note-tag">Note</div>` +
    `<div class="note-head"></div><div class="note-body"></div></div>` +
    `</div>` +
    `<div class="margin">` +
    `<div class="cap">Plot register<b><span class="count">00</span> / ${LAYERS.length}</b></div>` +
    `<div class="reg">${register}</div>` +
    `<div class="revs">` +
    `<div class="rev"><i>E</i><b>SOL 061</b><span>Range B replanted after frost loss</span></div>` +
    `<div class="rev"><i>F</i><b>SOL 190</b><span>Loop headway 6 → 4 min. Park opened.</span></div>` +
    `<div class="rev last"><i>G</i><b>SOL 214</b><span>Tree 1 at 12.0 m — 1.0 m above planting envelope. Drawing amended to suit.</span></div>` +
    `</div>` +
    `<div class="fill"></div>` +
    `<div class="stampcell">` +
    `<button type="button" disabled>` +
    `<span class="pending"><em class="p-top">Plotting</em>` +
    `<span class="p-num"><b class="pct">0</b><i>%</i></span>` +
    `<em class="p-now">Calibrating pens</em></span>` +
    `<span class="issued"><em>Admit one</em><b>Board</b><em>Gate S · The Loop</em></span>` +
    `<i class="hint">Click to board</i>` +
    `</button>` +
    `</div>` +
    `</div>` +
    `<div class="foot">` +
    `<h1>Dome One — General Arrangement</h1>` +
    `<div class="sub">Section A–A · Key plan · Detail A · Sheet 03 of 12</div>` +
    `<div class="adm">Admission is by stamp. Gate S is always open.</div>` +
    `</div>` +
    `<div class="title">` +
    `<div class="proj"><b>Elysium Commons</b><span>Elysium Planitia, Mars · − 2 540 m</span></div>` +
    `<div class="cells">` +
    `<div><em>Scale</em><b>1:500</b></div><div><em>Sheet</em><b>03/12</b></div><div><em>Rev</em><b>G</b></div>` +
    `<div><em>Drawn</em><b>GK-04</b></div><div><em>Checked</em><b>GK-01</b></div><div><em>Date</em><b>SOL 214</b></div>` +
    `</div>` +
    `<div class="status"><em>Status</em>As built · Shift 14, held</div>` +
    `</div>` +
    `</div>`
  )
}

/* --------------------------------------------------------------- the API --- */

export function createEntryScreen(parent: HTMLElement): EntryScreen {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'entry'
  root.innerHTML = markup()
  parent.appendChild(root)

  const button = root.querySelector('button') as HTMLButtonElement
  const pct = root.querySelector('.pct') as HTMLElement
  const now = root.querySelector('.p-now') as HTMLElement
  const top = root.querySelector('.p-top') as HTMLElement
  const count = root.querySelector('.count') as HTMLElement
  const rows = LAYERS.map((l) => root.querySelector(`[data-row="${l.key}"]`) as HTMLElement)
  const groups = LAYERS.map((l) => Array.from(root.querySelectorAll(`[data-layer="${l.key}"]`)))

  /**
   * The plot pointer only advances: `render-pipeline` reports twice (it is
   * registered last), and the registry announces `ready` before the shader
   * pre-warm has even started.
   */
  let peak = -1

  const advance = (index: number): void => {
    if (index <= peak) return
    for (let i = peak + 1; i <= index; i++) {
      for (const g of groups[i]) g.classList.add('on')
      rows[i].classList.add('done')
      if (i > 0) rows[i - 1].classList.remove('now')
    }
    rows[index].classList.remove('done')
    rows[index].classList.add('now')
    peak = index
    count.textContent = String(index + 1).padStart(2, '0')
  }

  const indexOf = (label: string): number => {
    const key = LABEL_ALIAS[label] ?? label
    if (key === 'ready') return LAYERS.length - 1
    return LAYERS.findIndex((l) => l.key === key)
  }

  return {
    setProgress(label: string, fraction: number): void {
      const index = indexOf(label)
      if (index >= 0) advance(index)
      const text = CHECK_LABELS[label]
      if (text) now.textContent = text
      pct.textContent = String(Math.round(Math.min(1, Math.max(0, fraction)) * 100))
    },
    showError(title: string, body: string): void {
      root.classList.add('void')
      const head = root.querySelector('.note-head') as HTMLElement
      const text = root.querySelector('.note-body') as HTMLElement
      head.textContent = title
      text.textContent = body
      top.textContent = 'Plot halted'
      now.textContent = 'Not issued'
      count.textContent = '--'
    },
    showEnter(): Promise<void> {
      for (let i = 0; i < LAYERS.length; i++) {
        for (const g of groups[i]) g.classList.add('on')
        rows[i].classList.remove('now')
        rows[i].classList.add('done')
      }
      peak = LAYERS.length - 1
      count.textContent = String(LAYERS.length)
      pct.textContent = '100'
      // Hierarchy inversion: the plate recedes (root `done` washes drawing,
      // register, title block), then the stamp lands over it. Sequenced by
      // CSS — wash eases immediately, stamp animation is delayed 260 ms.
      root.classList.add('done')
      button.disabled = false
      button.classList.add('ready')
      button.focus({ preventScroll: true })
      return new Promise((resolve) => {
        button.addEventListener('click', () => resolve(), { once: true })
      })
    },
    hide(): void {
      root.classList.add('hidden')
      window.setTimeout(() => {
        root.remove()
        style.remove()
      }, 1200)
    },
  }
}
