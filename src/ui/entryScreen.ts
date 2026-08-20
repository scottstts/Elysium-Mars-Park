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
 *
 * REV H is the park catching up with itself: the FREEDOM TOWER (in the section,
 * in chain line — it stands 33 m in front of the cut), THE FOUNTAIN and THE
 * OPTIMUS COURT (a shared 1:150 cell, half section and elevation), and THE
 * LAUNCH SITE (a 1:2500 comparative elevation whose whole argument is that the
 * 147 m stack beyond the glass dwarfs the 64 m dome). The plotter's pen table
 * and the standard-parts schedule gave up their cells for them and went to
 * Sheet 05; the pens survive as a one-line legend under the section and the
 * kit as balloon tags on the parts where they occur.
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
/* Work standing IN FRONT of the cutting plane — long-dash-dot, the drafting
   convention that keeps the Freedom Tower legible as "nearer than the cut"
   without pretending it was sectioned. Its lattice is inked at .sf. */
#entry .sk { stroke: var(--ink-2); stroke-width: 1.2; stroke-dasharray: 13 3 1.6 3; }
#entry .sf { stroke: var(--ink-3); stroke-width: 0.85; }
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
  { key: 'starship', code: 'S-PAD', name: 'Launch site · OLIT, stack' },
  { key: 'dome', code: 'A-SHEL', name: 'Dome One · shell, 13 rings' },
  { key: 'groundworks', code: 'C-DECK', name: 'Park deck · levels, plinth' },
  { key: 'player', code: 'G-FIG', name: 'Scale figure · 1.70 m eye' },
  { key: 'archkit', code: 'A-KIT', name: 'Standard parts · tagged' },
  { key: 'interiors', code: 'A-INT', name: 'Interiors · rooms, notes' },
  { key: 'park', code: 'G-KEY', name: 'Key plan · districts' },
  { key: 'tram', code: 'T-LOOP', name: 'The Loop · track, Gate S' },
  { key: 'freedomElevator', code: 'A-TWR', name: 'Freedom Tower · lift, deck' },
  { key: 'robots', code: 'M-GKR', name: 'Groundskeepers · GK series' },
  { key: 'optimus-exhibit', code: 'M-OPT', name: 'Optimus court · the eight' },
  { key: 'vegetation', code: 'L-PLNT', name: 'Planting · Tree 1' },
  { key: 'fountain', code: 'P-FTN', name: 'The Fountain · basin, jets' },
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
  starship: 'Siting the launch pad',
  dome: 'Striking the shell',
  groundworks: 'Setting out levels',
  player: 'Adding the figure',
  archkit: 'Tagging the parts',
  interiors: 'Fitting out interiors',
  park: 'Drawing the key plan',
  tram: 'Laying the Loop',
  freedomElevator: 'Raising the tower',
  robots: 'Logging groundskeepers',
  'optimus-exhibit': 'Ranking the eight',
  vegetation: 'Planting Tree 1',
  fountain: 'Filling the basin',
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
  /**
   * FREEDOM TOWER (parkPlan + districts/freedomTower). Everything above the
   * terrace is derived in the district from the dome sphere at the tower's own
   * plan radius (65.86), which is why the tip sits 0.90 under a glass line
   * 3.56 LOWER than the shell drawn on this section's own plane — see the
   * phantom arc struck over the tower in A-TWR.
   */
  tower: {
    x: 33,
    z: 57,
    terraceR: 12.76,
    terraceY: 0.986,
    padY: 0.55,
    legBaseR: 7.8,
    legTopR: 4.42,
    legBaseY: 1.75,
    legTopY: 37.946,
    twist: 1.55,
    legs: 16,
    rings: [5.2, 13.6, 18.8, 22.8, 26.2, 29.3, 32.5, 35.7] as const,
    deckY: 38.746,
    deckR: 5.45,
    wallHead: 2.78,
    roof: [
      [5.45, 3.05],
      [3.9, 4.3],
      [2.3, 5.45],
      [0.78, 6.25],
    ] as ReadonlyArray<readonly [number, number]>,
    spireBase: 44.646,
    tipY: 49.296,
    glassY: 50.196,
    glassR: 160.681,
  },
  /** THE FOUNTAIN (fountain/fountainPlan), heights local to its court. */
  ftn: {
    x: -38,
    z: -40,
    courtR: 12.6,
    steps: [
      [9.3, 0.155],
      [8.62, 0.31],
    ] as ReadonlyArray<readonly [number, number]>,
    basinR: 6.98,
    wall: 0.62,
    copingY: 0.835,
    waterY: 0.645,
    floorY: 0.375,
    plinth: [
      [2.42, 0.79],
      [2.08, 1.03],
      [1.74, 1.27],
    ] as ReadonlyArray<readonly [number, number]>,
    pedR: 1.36,
    pedY: 1.95,
    lower: { core: 4.1, rimR: 2.68, rimY: 5.3 },
    upper: { core: 6.06, rimR: 1.06, rimY: 6.72 },
    finialY: 6.9,
    crownJetY: 9.45,
  },
  /** THE OPTIMUS COURT (world/districts/optimusPlaza + optimusSign). */
  opt: {
    x: -28,
    z: 70,
    courtR: 9.4,
    plinthR: 6,
    deckY: 0.6,
    riser: 0.15,
    tread: 0.36,
    steps: 3,
    figure: 1.73,
    rankPitch: 2.4,
    signOffset: 5.35,
    signClear: 2.25,
    signPanel: 1.06,
  },
  /** THE LAUNCH SITE (starship/starshipSite + parts). Heights over park datum. */
  ship: {
    x: -83,
    z: 200,
    range: 215,
    slabW: 68.6,
    slabTop: 0.76,
    padY: -0.44,
    towerX: -100.5,
    towerW: 12.2,
    trussTop: 132.86,
    crownTop: 138.96,
    rodTop: 145.46,
    armY: 125.46,
    armLen: 26.5,
    qdY: 94.06,
    deckY: 20.06,
    vehX: -77.6,
    vehR: 4.5,
    boosterTop: 91.06,
    noseY: 141.3,
    noseLen: 12.7,
  },
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
  mon: { x: 424, y: 646, w: 366, h: 160 },
  launch: { x: 810, y: 410, w: 370, h: 176 },
  notes: { x: 810, y: 604, w: 370, h: 202 },
}

/** DETAIL A, at 1:50 — ten times the section, where a body is worth drawing. */
const DET = { k: 37.8, cx: 556, gy: 588 }
const dx = (m: number): number => DET.cx + m * DET.k
const dy = (m: number): number => DET.gy - m * DET.k

/**
 * THE MONUMENTS, at 1:125 — the two pieces that are too small to read at
 * 1:500 and too large to draw at 1:50. The Fountain is a half section about
 * its own axis (it is a solid of revolution; drawing both halves says
 * nothing twice), the Optimus court a straight elevation from the spur.
 */
const MON = { k: 12.6, gy: 780, ftnCx: 436, optCx: 672 }
const fx = (m: number): number => MON.ftnCx + m * MON.k
const ox = (m: number): number => MON.optCx + m * MON.k
const my = (m: number): number => MON.gy - m * MON.k

/**
 * THE LAUNCH SITE, at 1:2500 — the only scale that holds a 147 m stack and
 * the dome it is seen over on one ground line. That comparison IS the
 * drawing: the tallest thing in the world is not in the park.
 */
const LAU = { k: 0.756, gy: 564, domeCx: 921, shipCx: 1090 }
const lx0 = (m: number): number => LAU.domeCx + m * LAU.k
const lx1 = (m: number): number => LAU.shipCx + m * LAU.k
const ly = (m: number): number => LAU.gy - m * LAU.k

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
        frame(BOX.mon, 'THE MONUMENTS · 1:150') +
        frame(BOX.launch, 'THE LAUNCH SITE · 1:2500') +
        frame(BOX.notes, 'GENERAL NOTES'),
    ),
  )
  return out.join('')
}

/* --------------------------------------------------------------- layers --- */

const layer = (key: string, body: string): string => `<g class="ly" data-layer="${key}">${body}</g>`

/** Tier-3 ink: accompaniment that must read as texture, never as content. */
const t3 = (body: string): string => `<g class="t3">${body}</g>`

/**
 * X-PEN — the plotter calibrating itself, still the first thing to ink, but
 * now a single ruled strip under the section rather than a boxed table: the
 * two new drawings (THE MONUMENTS, THE LAUNCH SITE) took the table's cell,
 * and a pen legend only ever needed one line.
 */
function penTable(): string {
  const y = 390
  const cells: ReadonlyArray<readonly [string, string]> = [
    ['0.13', 's0'],
    ['0.25', 's1'],
    ['0.35', 's1 dash'],
    ['0.50', 's2'],
    ['0.70', 's3'],
    ['IFC', 'sk'],
    ['REV', 'sr'],
  ]
  const out: string[] = [tx(596, y + 3.4, 'PENS', 'ts')]
  cells.forEach((cell, i) => {
    const x = 640 + i * 66
    out.push(ln(x, y, x + 36, y, cell[1]))
    out.push(tx(x + 18, y + 12, cell[0], 'tn', 'middle'))
  })
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

/**
 * A-KIT — the kit, TAGGED rather than drawn. The standard-parts cell went to
 * THE LAUNCH SITE, and a general-arrangement sheet is the wrong place to
 * repeat a component schedule anyway: the section now carries balloon tags
 * onto the parts where they actually occur, and note 5 sends the reader to
 * the schedule sheet.
 */
function partsLayer(): string {
  const out: string[] = []
  const tag = (x: number, y: number, tipX: number, tipY: number, id: string): string =>
    ln(x, y, tipX, tipY, 's0') +
    ci(tipX, tipY, 1.7, 'f2') +
    ci(x, y, 12.5, 'fp') +
    ci(x, y, 12.5, 's1') +
    tx(x, y + 3.4, id, 'tn', 'middle')

  // 02 — the canopy bay standing over Gate S.
  out.push(tag(215, sy(24.9), sz(93), sy(W.canopyH), '02'))
  // 11 — the planter kerb that rings Tree 1.
  out.push(tag(640, sy(15.6), sz(-W.soilRing), sy(0.52), '11'))
  // 07 — the hab barrel, off this cut but tagged where its lane leaves.
  out.push(tag(880, sy(10.6), sz(-104), sy(0.2), '07'))
  out.push(tx(1166, 96, 'PART TAGS TO THE STANDARD PARTS SCHEDULE, SHEET 05', 'ts', 'end'))
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
    ['THE FREEDOM TOWER STANDS 33.0 IN FRONT', 'OF THE CUT, SO IT IS DRAWN IN CHAIN.'],
    ['NO EVA. THE SHELL IS SEALED AND STAYS', 'SEALED. 71.2 kPa, 21.4 °C, RH 34 %.'],
    ['MAINTAINED BY THE GK SERIES AND THE', 'EIGHT. IN PARK TODAY 214 OF 10 000.'],
    ['THE ONLY SOUND IS AIR, WATER, MACHINERY', 'AND THE TRAM. NOTHING IS PLAYED.'],
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
  out.push(tx(px(-2), py(-54) - 21, 'THE COMMONS', 'ts', 'middle'))
  out.push(ci(px(37), py(23), 7 * k, 's2'))
  out.push(ci(px(-52), py(34), 24 * k, 's0 dash'))
  out.push(tx(px(-52), py(34) + 4, 'BOWL', 'ts', 'middle'))
  // The open-regolith zone (dashed) with THE FOUNTAIN's paved court inside it:
  // court disc, stylobate, then the basin's inner face, which is the water.
  out.push(ci(px(W.ftn.x), py(W.ftn.z), 28 * k, 's0 dash'))
  out.push(ci(px(W.ftn.x), py(W.ftn.z), W.ftn.courtR * k, 's2'))
  out.push(ci(px(W.ftn.x), py(W.ftn.z), W.ftn.steps[0][0] * k, 's0'))
  out.push(ci(px(W.ftn.x), py(W.ftn.z), W.ftn.basinR * k, 'f1'))
  out.push(ci(px(W.ftn.x), py(W.ftn.z), W.ftn.basinR * k, 's2'))
  out.push(tx(px(W.ftn.x), py(W.ftn.z) - 20, 'THE FOUNTAIN', 'ts', 'middle'))
  // THE FREEDOM TOWER on its terrace, reached by the tower walk off the
  // Meridian; the deck circle is the gallery, 38.75 up.
  out.push(pl([[px(2), py(50)], [px(12), py(52)], [px(22.6), py(54.8)]], 's0'))
  out.push(ci(px(W.tower.x), py(W.tower.z), W.tower.terraceR * k, 's2'))
  out.push(ci(px(W.tower.x), py(W.tower.z), W.tower.legBaseR * k, 's0'))
  out.push(ci(px(W.tower.x), py(W.tower.z), W.tower.deckR * k, 'f2'))
  out.push(tx(px(W.tower.x) + 16, py(W.tower.z) + 3.4, 'FREEDOM TOWER', 'ts'))
  // THE OPTIMUS COURT, off the Meridian's west flank on its own spur.
  out.push(pl([[px(-2.4), py(73.2)], [px(-9), py(71.6)], [px(-22), py(70)]], 's0'))
  out.push(ci(px(W.opt.x), py(W.opt.z), W.opt.courtR * k, 's2'))
  out.push(ci(px(W.opt.x), py(W.opt.z), W.opt.plinthR * k, 'f2'))
  out.push(tx(px(W.opt.x) - 14, py(W.opt.z) + 3.4, 'THE EIGHT', 'ts', 'end'))
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
  out.push(tx(px(-67) - 6, py(-76), 'HABS 01–10', 'ts', 'end'))
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
  // The launch site is 215 m out — off this plan at 1:2000. A bearing line
  // and a break carry it off the sheet to its own elevation.
  const ux = -87 / 218.1
  const uz = 200 / 218.1
  const bear = (r: number): Pt => [px(ux * r), py(uz * r)]
  out.push(pl([bear(136), bear(184)], 's1 chain'))
  const [ax, ay] = bear(190)
  const [bx0, by0] = bear(178)
  out.push(pl([[ax, ay], [bx0 - 4.6, by0 - 2.4], [bx0 + 3.4, by0 - 5.6]], 'f2', true))
  out.push(tx(bear(170)[0] - 8, bear(170)[1] - 4, 'LAUNCH SITE 215 m', 'ts', 'end'))
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
  // The Gate S annotation reads LEFT, out over the exterior sky: the airspace
  // it used to land in (z 44…70, above the deck) is the Freedom Tower's now.
  out.push(leader([edge - 6, sy(2.2)], [252, 152], -12, 'GATE S · PORTAL STATION'))
  out.push(tx(240, 165, 'HEADWAY 4 MIN · 2 CARS · 8 m/s', 'ts', 'end'))
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

/**
 * A-TWR — THE FREEDOM TOWER. It stands 33.0 m IN FRONT of this cutting plane,
 * so nothing here is a cut: the profile is chain line (the convention for work
 * nearer than the section) over a hairline lattice. Its clearance cannot be
 * read off the shell arc on this sheet either — the glass over the tower's own
 * plan radius (65.86) is 3.56 lower than the glass on the section plane — so a
 * phantom arc at R 160.681 is struck over it and the 0.900 is taken to that.
 */
function freedomLayer(): string {
  const T = W.tower
  const out: string[] = []
  /** Section abscissa for a point `dz` along world +z from the tower axis. */
  const tz = (dz: number): number => sz(T.z + dz)
  /** Lattice envelope radius at a world height — the hyperboloid's throat. */
  const envelope = (y: number): number => {
    const t = (y - T.legBaseY) / (T.legTopY - T.legBaseY)
    const ax = T.legBaseR
    const bx = T.legTopR * Math.cos(T.twist)
    const by = T.legTopR * Math.sin(T.twist)
    const px2 = ax + (bx - ax) * t
    const py2 = by * t
    return Math.hypot(px2, py2)
  }

  // The phantom glass line over the tower's own axis, and what it costs.
  const gr = T.glassR * SCALE_500
  const gy = (z: number): number => W.domeCenterY + Math.sqrt(T.glassR ** 2 - z * z)
  out.push(
    pa(
      `M ${u(sz(92))} ${u(sy(gy(92)))} A ${u(gr)} ${u(gr)} 0 0 1 ${u(sz(24))} ${u(sy(gy(24)))}`,
      's1 chain',
    ),
  )
  out.push(tx(sz(10), 158, 'GLASS AT x + 33.0 · R 160.681', 'ts'))
  out.push(tx(sz(10), 171, 'SPIRE TIP HOLDS 0.900 UNDER IT', 'ts'))

  // Terrace: paved disc, three cast steps, the walking surface at + 0.986.
  const terr: Pt[] = []
  const rise = (T.terraceY - (T.padY + 0.075)) / 3
  for (let i = 0; i <= 3; i++) {
    const r = T.terraceR - i * 0.74
    const y = T.padY + 0.075 + i * rise
    terr.push([tz(r), sy(y)], [tz(r - 0.74), sy(y)], [tz(r - 0.74), sy(y + rise)])
  }
  out.push(pl(terr, 'sk'))
  out.push(pl(terr.map((p) => [2 * tz(0) - p[0], p[1]] as Pt), 'sk'))
  out.push(ln(tz(T.terraceR), sy(T.padY + 0.075), tz(-T.terraceR), sy(T.padY + 0.075), 's0'))

  // The lattice: two opposed ruling families. Only the far half is drawn —
  // the near half stands between the reader and the tower.
  for (const family of [1, -1] as const) {
    for (let i = 0; i < T.legs; i++) {
      const a = (i / T.legs) * Math.PI * 2
      if (Math.cos(a) > 0.001) continue
      const b = a + family * T.twist
      out.push(
        ln(
          tz(T.legBaseR * Math.sin(a)),
          sy(T.legBaseY),
          tz(T.legTopR * Math.sin(b)),
          sy(T.legTopY),
          'sf',
        ),
      )
    }
  }
  for (const z of T.rings) {
    const y = T.padY + z
    const r = envelope(y)
    out.push(ln(tz(r), sy(y), tz(-r), sy(y), 'sk'))
  }

  // The gallery: deck plate, sixteen bays of glass, the faceted tent, spire.
  out.push(rc(tz(T.deckR), sy(T.deckY), T.deckR * 2 * SCALE_500, 0.62 * SCALE_500, 'sk'))
  for (let i = -3; i <= 3; i++) {
    const r = (i / 3) * (T.deckR - 0.1)
    out.push(ln(tz(r), sy(T.deckY), tz(r), sy(T.deckY + T.wallHead), 'sf'))
  }
  out.push(ln(tz(T.deckR), sy(T.deckY + T.wallHead), tz(-T.deckR), sy(T.deckY + T.wallHead), 'sk'))
  const roofL: Pt[] = T.roof.map(([r, dz]) => [tz(r), sy(T.deckY + dz)] as Pt)
  const roofR: Pt[] = T.roof.map(([r, dz]) => [tz(-r), sy(T.deckY + dz)] as Pt)
  out.push(pl([...roofL].reverse().concat(roofR), 'sk'))
  out.push(
    pl(
      [
        [tz(0.34), sy(T.spireBase)],
        [tz(0), sy(T.tipY)],
        [tz(-0.34), sy(T.spireBase)],
      ],
      'sk',
    ),
  )
  out.push(level(tz(0), sy(T.tipY), '+ 49.296 SPIRE TIP', 1))
  out.push(leader([tz(-T.deckR), sy(T.deckY)], [455, 212], 46, 'FREEDOM TOWER · DECK + 38.746', 'tb', 's1'))
  return layer('freedomElevator', out.join(''))
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
  // Nothing between z 44 and z 70: that ground is the Freedom Tower's terrace.
  for (const z of [22, 34, 78, -20, -30, -74]) {
    const x = sz(z)
    out.push(pa(scallop(cloudRing(x, sy(2.2), 8, 6, 8, z)), 's1'))
    out.push(ln(x, g, x, sy(1.1), 's1'))
  }
  out.push(dimH(sz(W.soilRing), sz(-W.soilRing), sy(-6), g, 'Ø 11.0 SOIL RING'))
  return layer('vegetation', out.join(''))
}

/**
 * P-FTN — THE FOUNTAIN, half section at 1:150. It is a solid of revolution:
 * drawing both halves would say the same thing twice, so the axis is the left
 * edge of the drawing and the water is a hatched pool against it. The stone is
 * cut; the jets are the plan's own ballistic arcs, dashed, because they are
 * the only part of this piece that is not stone.
 */
function fountainLayer(): string {
  const F = W.ftn
  const out: string[] = []
  const g = my(0)

  // Court paving, stylobate, basin wall, coping — one cut profile outward.
  // The paving stub stops at 9.9: the Optimus court's own ground line starts
  // at 571 and the two cells must not run into each other.
  const cut: Pt[] = [
    [fx(9.9), g],
    [fx(F.steps[0][0]), g],
    [fx(F.steps[0][0]), my(F.steps[0][1])],
    [fx(F.steps[1][0]), my(F.steps[0][1])],
    [fx(F.steps[1][0]), my(F.steps[1][1])],
    [fx(F.basinR + F.wall), my(F.steps[1][1])],
    [fx(F.basinR + F.wall), my(F.copingY)],
    [fx(F.basinR), my(F.copingY)],
    [fx(F.basinR), my(F.floorY)],
    [fx(F.plinth[0][0]), my(F.floorY - 0.03)],
  ]
  out.push(pl(cut, 'fh', true))
  out.push(pl(cut, 's3'))
  // The water: a still pool against the axis, 0.19 under the coping.
  out.push(rc(fx(0), my(F.waterY), F.basinR * MON.k, (F.waterY - F.floorY + 0.03) * MON.k, 'f1'))
  out.push(ln(fx(0), my(F.waterY), fx(F.basinR), my(F.waterY), 's1'))

  // The island — three steps, the moulded pedestal, both tazze and the finial
  // as ONE closed cut silhouette. Drawn as separate open profiles they read as
  // scribble at this scale: everything on the axis is cut by the section, so
  // it is poché'd like the rest of the stone and the piece reads as a solid.
  const bowl = (t: { core: number; rimR: number; rimY: number }, stem: number): Pt[] => [
    [fx(stem), my(t.core)],
    [fx(t.rimR * 0.6), my(t.core + (t.rimY - t.core) * 0.44)],
    [fx(t.rimR), my(t.rimY - 0.14)],
    [fx(t.rimR), my(t.rimY)],
    [fx(t.rimR * 0.93), my(t.rimY - 0.07)],
    [fx(t.rimR * 0.11), my(t.rimY - 0.44)],
  ]
  const isle: Pt[] = [[fx(F.plinth[0][0]), my(F.floorY - 0.03)]]
  for (let i = 0; i < F.plinth.length; i++) {
    const [r, top] = F.plinth[i]
    const next = F.plinth[i + 1]
    isle.push([fx(r), my(top)], [fx(next ? next[0] : F.pedR), my(top)])
  }
  isle.push([fx(F.pedR), my(F.pedY)], [fx(0.34), my(F.pedY + 0.14)], [fx(0.34), my(F.lower.core)])
  isle.push(...bowl(F.lower, 0.34))
  isle.push([fx(0.3), my(F.upper.core)])
  isle.push(...bowl(F.upper, 0.3))
  isle.push([fx(0.12), my(F.finialY)], [fx(0), my(F.finialY)], [fx(0), my(F.floorY - 0.03)])
  out.push(pl(isle, 'fh', true))
  out.push(pl(isle, 's3', true))

  // The jets. Mars gravity is 3.721, so these hang almost three times as long
  // as an Earth fountain's — the arcs are drawn from the plan's own solve.
  const jet = (r0: number, y0: number, r1: number, rise: number): string =>
    pa(
      `M ${u(fx(r0))} ${u(my(y0))} Q ${u(fx((r0 + r1) / 2))} ${u(my(y0 + rise * 2))} ` +
        `${u(fx(r1))} ${u(my(F.waterY))}`,
      's1 dash',
    )
  out.push(jet(6.3, F.waterY + 0.06, 3.5, 0.9))
  out.push(jet(3.15, F.waterY + 0.08, 5.55, 0.78))
  // The crown jet is cut short at + 8.0 and its apex called out instead: the
  // cell is 160 units deep and the real 9.45 m plume would break the frame.
  out.push(ln(fx(0), my(F.finialY), fx(0), my(8), 's1 dash'))
  out.push(ln(fx(0), my(8), fx(0), g, 's0 chain'))

  out.push(tx(fx(0.4), my(7.6), 'CROWN JET + 9.45', 'tn'))
  // Lifted off the water line on a leader: sat on it, the label ran straight
  // through both jet arcs, which are the only moving thing in the cell.
  out.push(leader([fx(5.2), my(F.waterY)], [fx(5.9), my(3.2)], 22, 'WATER + 0.645', 'tn'))
  out.push(tx(fx(0), g + 11, 'THE FOUNTAIN · HALF SECTION', 'ts'))
  out.push(tx(fx(0), g + 22, 'BASIN Ø 13.96 · SEAT 0.835', 'tn'))
  return layer('fountain', t3(out.join('')))
}

/**
 * M-OPT — THE OPTIMUS COURT, elevation from the spur. The spur lands on the
 * east flight head-on to the front rank, so this is the view a visitor
 * actually gets: eight of them, facing you, on a 0.6 m cast plinth.
 */
function optimusLayer(): string {
  const O = W.opt
  const out: string[] = []
  const g = my(0)
  const k = MON.k

  // Ground line stops at ±8.0, not the court's full 9.4: the cell is 366 wide
  // and the full disc would run under the Fountain on one side and out of the
  // frame on the other.
  out.push(ln(ox(-8), g, ox(8), g, 's2'))
  // Plinth drum and slab, with a cardinal flight breaking each side.
  const run = O.steps * O.tread
  const stair: Pt[] = [[ox(-(O.plinthR + run)), g]]
  for (let i = 1; i <= O.steps; i++) {
    stair.push([ox(-(O.plinthR + run - (i - 1) * O.tread)), my(i * O.riser)])
    stair.push([ox(-(O.plinthR + run - i * O.tread)), my(i * O.riser)])
  }
  stair.push([ox(-O.plinthR), my(O.deckY)], [ox(O.plinthR), my(O.deckY)])
  for (let i = O.steps; i >= 1; i--) {
    stair.push([ox(O.plinthR + run - i * O.tread), my(i * O.riser)])
    stair.push([ox(O.plinthR + run - (i - 1) * O.tread), my(i * O.riser)])
  }
  stair.push([ox(O.plinthR + run), g])
  out.push(pl(stair, 'fh', true))
  out.push(pl(stair, 's3'))
  out.push(ln(ox(-O.plinthR), my(O.deckY - 0.075), ox(O.plinthR), my(O.deckY - 0.075), 's0'))

  // The front rank of four, and the rank behind it in thin line.
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * O.rankPitch
    out.push(figureSilhouette(ox(z + 0.5), my(O.deckY), k * 0.985))
    out.push(figureSilhouette(ox(z - 0.5), my(O.deckY), k * 0.985))
  }
  out.push(dimV(my(O.deckY + O.figure), my(O.deckY), ox(O.plinthR + run) + 12, ox(4.2), '1730'))
  // Right-anchored to the cell edge, not centred on the drawing: centred, the
  // two captions close to within a few units of the Fountain's own pair.
  out.push(tx(BOX.mon.x + BOX.mon.w - 12, g + 11, 'THE OPTIMUS COURT', 'ts', 'end'))
  out.push(tx(BOX.mon.x + BOX.mon.w - 12, g + 22, 'PLINTH Ø 12.0 · EIGHT', 'tn', 'end'))
  return layer('optimus-exhibit', t3(out.join('')))
}

/**
 * S-PAD — THE LAUNCH SITE, against the dome at one scale. This box exists for
 * the comparison and nothing else: Dome One's crown is + 64.000 and the stack
 * beyond the glass is 147.1 m to the rod. The tallest thing in this world is
 * not in the park.
 */
function launchLayer(): string {
  const S = W.ship
  const out: string[] = []
  const g = ly(0)
  const k = LAU.k
  /** Local frame of the launch assembly: 0 is the OLM/tower datum. */
  const s = (m: number): number => lx1(m)

  out.push(ln(lx0(-138), g, lx0(138), g, 's2'))
  const dr = W.domeSphere * k
  out.push(
    pa(
      `M ${u(lx0(W.domeBase))} ${u(g)} A ${u(dr)} ${u(dr)} 0 0 0 ${u(lx0(-W.domeBase))} ${u(g)}`,
      's2',
    ),
  )
  out.push(ln(lx0(-W.tower.z * 0.42), ly(W.tower.tipY), lx0(W.tower.z * 0.42), ly(W.tower.tipY), 's0 dash'))
  out.push(tx(lx0(0), ly(W.tower.tipY) - 4, 'FREEDOM TOWER + 49.30', 'tn', 'middle'))
  out.push(tx(lx0(0), g + 13, 'DOME ONE · CROWN + 64.000', 'ts', 'middle'))

  // The graded platform, the raft, the OLM, the tower and the stack on it.
  out.push(ln(s(-42), ly(S.padY), s(34), ly(S.padY), 's2'))
  out.push(rc(s(-38.3), ly(S.slabTop), 68.6 * k, 2.4 * k, 'fh'))
  out.push(rc(s(-38.3), ly(S.slabTop), 68.6 * k, 2.4 * k, 's2'))
  const tw = S.towerW / 2
  const tx0 = -17.5
  out.push(rc(s(tx0 - tw), ly(S.rodTop), S.towerW * k, (S.rodTop - S.slabTop) * k, 's2'))
  for (let i = 1; i < 10; i++) {
    const y = ly(S.slabTop + ((S.trussTop - S.slabTop) * i) / 10)
    out.push(ln(s(tx0 - tw), y, s(tx0 + tw), y, 's0'))
  }
  out.push(ln(s(tx0 + tw), ly(S.armY), s(tx0 + tw + S.armLen), ly(S.armY + 1.4), 's2'))
  out.push(ln(s(tx0 + tw), ly(S.armY - 2.6), s(tx0 + tw + S.armLen), ly(S.armY - 0.8), 's1'))
  out.push(ln(s(tx0 + tw), ly(S.qdY), s(tx0 + tw + 9), ly(S.qdY), 's1'))
  // OLM table, booster, ship.
  const vx = 5.36
  out.push(rc(s(vx - 10.3), ly(S.deckY), 20.6 * k, 3.6 * k, 's2'))
  out.push(rc(s(vx - S.vehR), ly(S.boosterTop), S.vehR * 2 * k, (S.boosterTop - S.deckY) * k, 's3'))
  out.push(
    pa(
      `M ${u(s(vx - S.vehR))} ${u(ly(S.boosterTop))} L ${u(s(vx - S.vehR))} ${u(ly(S.noseY - S.noseLen))} ` +
        `Q ${u(s(vx - S.vehR))} ${u(ly(S.noseY))} ${u(s(vx))} ${u(ly(S.noseY))} ` +
        `Q ${u(s(vx + S.vehR))} ${u(ly(S.noseY))} ${u(s(vx + S.vehR))} ${u(ly(S.noseY - S.noseLen))} ` +
        `L ${u(s(vx + S.vehR))} ${u(ly(S.boosterTop))} Z`,
      's3',
    ),
  )
  out.push(dimV(ly(S.rodTop), ly(S.padY), s(34) + 14, s(tx0 + tw + S.armLen), '147 100'))
  out.push(tx(s(-4), g + 13, 'THE LAUNCH SITE · 215 m WSW', 'ts', 'middle'))
  return layer('starship', t3(out.join('')))
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
    launchLayer() +
    domeLayer() +
    deckLayer() +
    figureLayer() +
    partsLayer() +
    interiorsLayer() +
    keyPlanLayer() +
    tramLayer() +
    freedomLayer() +
    robotsLayer() +
    optimusLayer() +
    plantingLayer() +
    fountainLayer() +
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
    `<div class="rev"><i>F</i><b>SOL 190</b><span>Loop headway 6 → 4 min. Park opened.</span></div>` +
    `<div class="rev"><i>G</i><b>SOL 214</b><span>Tree 1 at 12.0 m — 1.0 m above planting envelope. Drawing amended to suit.</span></div>` +
    `<div class="rev last"><i>H</i><b>SOL 241</b><span>Freedom Tower, the Fountain, the Optimus court and the launch site added. Pen table and parts schedule to Sheet 05.</span></div>` +
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
    `<div class="sub">Section A–A · Key plan · Detail A · The monuments · The launch site · Sheet 03 of 12</div>` +
    `<div class="adm">Admission is by stamp. Gate S is always open.</div>` +
    `</div>` +
    `<div class="title">` +
    `<div class="proj"><b>Elysium Commons</b><span>Elysium Planitia, Mars · − 2 540 m</span></div>` +
    `<div class="cells">` +
    `<div><em>Scale</em><b>1:500</b></div><div><em>Sheet</em><b>03/12</b></div><div><em>Rev</em><b>H</b></div>` +
    `<div><em>Drawn</em><b>GK-04</b></div><div><em>Checked</em><b>GK-01</b></div><div><em>Date</em><b>SOL 241</b></div>` +
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
  let hideTimer: number | null = null
  let enterResolve: (() => void) | null = null

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
      // Device loss can happen after BOARD, when hide() has already begun.
      // Keep this same screen reusable as the runtime fatal surface instead of
      // silently leaving the last frame frozen. Reattach it if its fade timer
      // already removed the DOM/style.
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer)
        hideTimer = null
      }
      if (!style.isConnected) document.head.appendChild(style)
      if (!root.isConnected) parent.appendChild(root)
      root.classList.remove('hidden', 'done')
      root.classList.add('void')
      // A device/GPU failure may replace BOARD while boot is awaiting the
      // stamp. Release that waiter so main.ts can observe the stored renderer
      // failure and terminate its boot promise instead of leaving it pending.
      enterResolve?.()
      enterResolve = null
      button.disabled = true
      button.classList.remove('ready')
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
        enterResolve = () => resolve()
        button.addEventListener('click', () => {
          enterResolve = null
          resolve()
        }, { once: true })
      })
    },
    hide(): void {
      root.classList.add('hidden')
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        hideTimer = null
        root.remove()
        style.remove()
      }, 1200)
    },
  }
}
