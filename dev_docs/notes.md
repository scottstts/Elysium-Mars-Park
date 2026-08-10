# Notes & Lessons (agent continuous memory)

- 2026-08-10: `design.md` + `plan.md` are canon, confirmed by Scott via Q&A. Hard constraints that shaped them (do not drift): **single frozen late afternoon** (no time system of any kind), interior-only (no EVA), true 0.38 g everywhere, robots are the only moving life, **vegetation sparse and Mars-feeling — Scott explicitly does not want a garden/Earth-like park**, no open water (pipes + greenhouse mist only), environmental storytelling only, ambient sound only (no music).
- Stack precedent is **SeaPark** (`~/Documents/Projects/Node/SeaPark/`): vanilla TS + three/webgpu + TSL + rapier3d-compat, system-registry runtime, `parkPlan.ts` as single source of truth, `?view=` postcard cameras + `?pass=` isolation as the validation harness. Geometry craft precedent is **friends** (`~/Documents/Projects/Node/friends/`). Read both before building similar systems.
- Scott's standing preference (stated for SeaPark, applies here): make bold, confident aesthetic choices rather than asking about art details; build a sophisticated full world-system, never demo-scale. Ask before installing packages or degrading to inferior fallbacks.
- The fixed sun is the project's core rendering advantage: precompute/bake everything static (sky, IBL, shadow clipmaps) and treat the dome-lattice shadow-net as an analytic projected function, not a shadow map (plan §4/§6).
- Starter repo still contains React (to be stripped in S0 per plan §18 approval).
- 2026-08-10 (S0): The in-app browser pane suspends requestAnimationFrame while hidden — the game loop does NOT tick during headless probing. Use `window.__elysium.step(n)` (added to the ?debug handle) to drive synthetic frames, then screenshot. Also: `computer` clicks take screenshot-pixel coordinates (800×450 space), not viewport px — prefer read_page refs for clicking.
- 2026-08-10 (S0): WebGPU confirmed working in the in-app browser pane (three 0.185.1 WebGPURenderer, real WebGPU backend, no WebGL fallback). Canvas DPR lands at 1.7 capped by the 4MP policy at 1280×720 viewport.
- 2026-08-10 (S4/S5): **three r185 receivedShadowNode is per-LIGHT-cached, not per-material** — AnalyticLightNode.setupShadow caches shadowColorNode from the FIRST-built receiver for all materials. Any global shadow modifier must live inside a custom ShadowBaseNode assigned to light.shadow.shadowNode (we adopted SeaPark's CachedShadowClipmapNode and multiply the analytic dome-lattice visibility there).
- 2026-08-10 (S4/S5): Analytic soft-shadow line patterns MUST use the energy-conserving box-overlap integral, not reversed-edge smoothstep — otherwise large penumbra (0.35° sun × 100m+ lattice height) turns the pattern into uniform mush. Fine-net shadows physically wash out beyond ~30m from the glass; crisp net lives near the rim. Accepted as canon (realism rule).
- 2026-08-10 (S4/S5): Volumetric effects that overlap an existing analytic medium must accumulate the DIFFERENCE they cause (carve negative + small glow), never absolute inscatter — the interior shafts originally washed the whole frame +0.3 HDR before the rewrite.
- 2026-08-10 (S4/S5): Open item — one-shot 0×0-texture WebGPU validation error during boot (renderContext_3); steady-state clean (verified with console marks around stepped frames). Revisit in S9 warmup rework.
- 2026-08-10 (S9): Seat/vehicle pose yaw convention: player yaw 0 looks −Z, so "look along travel direction T" = atan2(−T.x, −T.z). With +Z-forward cars in a right-handed frame, +X local is the LEFT side (platform side). Both bit once.
- 2026-08-10 (S9): The guideway datum must NOT read pad-flattened terrain — beamTopY() drops through station pads so car floor (beam+0.62) meets deck; mini-station decks derive from beamTopY, never hardcode.
- 2026-08-10 (S9): Boot 0×0-texture error persists WITHOUT ?debug and WITHOUT compileAsync — not stats-gl, not the warmup adapter. One burst per load, renderContext_3 (canvas ctx), steady-state clean. Parked; revisit at S14 (consider three upgrade or dawn-level capture).
- 2026-08-10 (S12): **Buried-camera black void** — a validation camera below terrain renders as a near-black frame (zero-distance AO + unlit interior faces) that perfectly impersonates a pipeline bug. Cost a long spelunk through AO/aerial/NaN theories. RULE: audit every fixed camera against interiorHeight (+1.7 eye) — bookmarks now carry a warning comment. The spelunk still yielded real hardening: reversed-z background guards (r185 WebGPU clears depth to 0!), view distance derived from reconstructed positions instead of getViewZNode, NaN-normal scrubbing + degenerate-face dropping in PartWriter (the greenhouse arch fans DID produce NaN normals at their collapsed端 quads).

## S13 audio + the boot 0x0 mystery solved
- Audio is fully synth (audio/engine.ts): beds + panner point sources +
  stride-driven footsteps. Validated headlessly by monkey-patching the
  footstep method and stepping frames — surfaces classified correctly
  (deck→regolith transition captured on a real walk off the pad).
- Keyboard events dispatched via `window.dispatchEvent(new KeyboardEvent(...))`
  DO drive the player in headless probes — no pointer lock needed. 6 s of
  KeyW moved the player 9.4 m. Great for probing traversal.
- THE PARKED BOOT ERROR IS SOLVED: hidden browser panes report
  innerWidth/Height 0x0 → renderer.setSize(0,0) → invalid swapchain +
  0-sized post targets → the renderContext_3 validation burst. Fix:
  clamp boot size to >=1x1 (renderer.ts) and early-return the resize
  handler on 0x0 (main.ts). Verified: 90 frames at 0x0 window, zero
  errors. Reminder: browser-pane console output ACCUMULATES across
  reloads — instrument console.error counts in-page instead of trusting
  read_console_messages after a navigate.
- Vite full-reloads the page on any src edit — a live probe session dies
  with it (entry screen returns, sim resets). Re-click BOARD after edits.
- Browser-pane clicks by coordinate use SCREENSHOT pixel space (800x450
  when the pane is hidden-ish) — a miss lands as no-op. Prefer
  read_page + click by ref for DOM buttons.

## S14 final sweep — the big finds
- **PartWriter.tube barrels were wound INSIDE-OUT since S7.** Explicit
  vertex normals pointed outward, triangle winding pointed inward — culled
  fronts. Invisible on thin rails/lattice, catastrophic on the fat hab
  pods (whole shell rendered near-black = backfaces). Fixed by reordering
  quad emission (writer.ts). tubeWall (arrival duct, seen from inside) is
  DoubleSide so it survived the flip. If a big writer.tube surface ever
  renders black again: check winding FIRST.
- **The amphitheater was flattened by TWO stacked mistakes**: per-row
  full-disc cylinder colliders capped the bowl for physics, and the
  'amphitheater' PAD (r30+skirt22, y −2.6) flattened the terrain itself.
  Also the seat arc was centered at PI (rows WEST of center with the
  stage threaded BETWEEN the radii, audience facing away from the
  planet). Fixes: per-seat box colliders, pad shrunk to the r12 stage
  flat, arc centered at 0. interiorHeight now AUTHORS the dish (blends
  out base noise inside the bowl — a 3.4 m dish can't survive ±1.9 m
  noise).
- **Debug-paint through the grade lies**: vec3(garden, rake, wear) debug
  colors render as PERFECT regolith tan after AgX + the Mars LUT (warm
  channels dominate). I chased a phantom "cover mesh" for an hour because
  the paint WAS showing and looked like ground. When debug-painting
  through a graded pipeline, use SATURATED MAGENTA/CYAN, never
  warm-channel combos.
- Rake rings as ±13% albedo modulation at 0.85 m pitch are invisible
  after grading+haze from eye height. Ground art needs GEOMETRY: the
  raked furrows are now real writer tubes (slot 'soil', r 0.055, 1.9 m
  pitch) that break around paths/beds. Postcard 9 finally exists.
- Panewalker boots ON the sun line (phi0 2.793 rad; sun's math bearing =
  atan2(z,x) ≈ 160°, NOT the compass 250° — convention trap). Glass
  swath is now directional (trailing wake only). Carriages beefed to
  2.3 m so the rig silhouettes at 150 m.
- Sprite materials NEED a radial opacity falloff (uv-based smoothstep);
  a bare SpriteNodeMaterial is a hard translucent SQUARE (mist + vapor
  both fixed).
- Headless screenshot pipeline (pane won't composite): tiny node HTTP
  server on :9911 + page fetch-POSTs canvas.toDataURL JPEGs; Read the
  saved file. Canvas readback works right after manualStep renders.
  Keep h.step() batches <= ~1500 frames per JS call (30 s eval limit).
- Vite full-reloads on EVERY src edit: mid-session edits can produce
  one-off half-graph loads ('X is not defined' uncaught at boot). Always
  hard-reload once more after the last edit before trusting a probe.
- Rapier world.castRay returns nothing before the first world.step() —
  step at least once before headless ray probes.
