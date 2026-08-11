# Foundation (S0)

Runtime shape mirrors SeaPark: `main.ts` is bootstrap only; `runtime/loop.ts`
runs fixed 60 Hz simulation with variable-rate render and interpolation alpha;
`runtime/registry.ts` init-orders systems and drives fixed/update/lateUpdate;
systems are wired explicitly in main.ts, never discovered via context.

Choices beyond the code:

- **`GameLoop.manualStep(dtMs)` + `window.__elysium.step(n)`** exist because
  the in-app browser pane suspends `requestAnimationFrame` entirely while
  hidden. All agent-side visual verification must step frames synthetically
  and then screenshot; never wait on the live loop advancing headless.
- **`canvas.dataset.performance`** (written by `DebugOverlaySystem` every 60
  frames) is the automation channel for perf numbers — read it with JS, don't
  screen-scrape the stats panels.
- **Entry screen registration** (SHEET 03 plate, see notes.md): a new system
  id needs `CHECK_LABELS` (caption text) AND either its own `LAYERS` row —
  inserted at the real registry init order, pointer is monotonic — with a
  matching `<g class="ly" data-layer="KEY">` drawing group, or a
  `LABEL_ALIAS` entry folding it onto a neighbouring row. A bare
  `CHECK_LABELS` line no longer advances the plot register or inks anything.
- `?freeze` halts the park clock (no fixedUpdate) while still laying out and
  rendering — the frozen-validation-frame flag for postcard comparisons.
- Postcard names are audited at boot against design.md's ten; adding/renaming
  a postcard means updating `core/postcards.ts` and the design doc together.
- Seed constant 20520114; `Rng.fork(label)` is required for every subsystem
  stream so adding consumers never reshuffles existing generation.
