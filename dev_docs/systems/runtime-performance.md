# Runtime performance

The 2026-08-13 zero-compromise sweep keeps every visual and simulation budget
unchanged: DPR, render scale, pass resolutions, shadow maps, shader work,
simulation rates, geometry, culling, texture filtering, and update cadence are
not performance controls unless a later visual review explicitly approves a
change.

Quality-neutral runtime rules established by the sweep:

- `@dimforge/rapier3d-compat` is pinned to `0.19.3`. Its WASM is unchanged;
  `tools/patch-rapier-init.mjs` only converts the wrapper's deprecated
  positional wasm-bindgen initializer call to the equivalent object form.
  The regular `@dimforge/rapier3d` package is not a byte-identical substitute
  even at the same version.
- A dynamic `CanvasTexture` must have a 2D context and a painted initial frame
  before the texture can reach WebGPU. The Ops dashboards retain their 0.7 s
  refresh cadence, but now paint once during initialization.
- Frame-loop scratch vectors, quaternions, pose records, physics translation
  records, and fixed small iteration lists are owner-held and reused. They may
  only be reused where consumers read them synchronously and do not retain
  them.
- Frame pacing history is a fixed 120-sample ring. Median results are order
  independent, so this removes the per-frame `Array.shift()` without changing
  the diagnostic value.

Broad static-transform freezing and render-quality reductions were explicitly
rejected: their ownership or visual equivalence is not provable park-wide.
