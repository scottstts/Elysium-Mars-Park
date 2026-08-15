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
- WebGPU scene warmup must use `PassNode.compileAsync(renderer)` with the live
  MRT/MSAA target and must be awaited. A plain `render()` is deliberately
  non-blocking in Three r185: it queues deferred node/pipeline builders, so a
  fire-and-forget loading render can overlap the first gameplay frames.
- Visibility-switched geometry variants need explicit warmup. The arrival
  camera first exposes `optimus:lod1` at the tunnel mouth; compiling only the
  currently selected LOD left twelve TSL vertex programs to generate in that
  frame. Warmup temporarily selects each Optimus LOD, awaits the exact scene
  pass, and submits one covered real render because Three r185's compile path
  omits these grouped `InstancedMesh` variants. It then restores the real
  selection before BOARD. Geometry, thresholds, materials, and runtime draw
  selection are unchanged.
- Static sun casters are recorded into 32 m spatial render bundles. Every
  bundle/clipmap-camera pair is recorded during the loading frame; later map
  refreshes submit only bundles whose conservative world sphere intersects
  the committed light-space square. Map size, filtering, update cadence,
  caster set, and shadow coverage remain unchanged.
- Development `?profile=arrival` records the full arrival without console
  traffic during the shot. It correlates tram/camera position, frame interval,
  render CPU, per-system CPU, draw/triangle counts, static/dynamic shadow
  refreshes, and any lazy WebGPU program/pipeline creation into the hidden
  `#arrival-profile-data` JSON element after docking. Add `?debug` only when
  GPU timestamp queries are specifically required.
- URL diagnostics are loopback-only. `parseFlags` is the single authority for
  `view`, `pass`, `tier`, `seed`, `debug`, `freeze`, and `profile=arrival`; it
  returns shipped defaults on every non-loopback hostname. Consumers must not
  re-read `window.location.search`, because doing so bypasses the host gate.
  `tools/diagnostic-gate-audit.mjs` covers localhost, IPv4/IPv6 loopback, and
  hosted/lookalike hostnames.

Broad static-transform freezing and render-quality reductions were explicitly
rejected: their ownership or visual equivalence is not provable park-wide.
