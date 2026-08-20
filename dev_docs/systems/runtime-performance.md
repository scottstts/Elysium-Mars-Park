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
- Static sun casters are recorded into 32 m spatial render bundles. Metal
  eagerly records every bundle/clipmap-camera pair during loading. Windows
  records only bundles intersecting the staged arrival clipmaps and lazily
  records later spatial combinations under both the normal one-level refresh
  budget and a hard ceiling of eight new bundle/clipmap pairs per app frame.
  Newly required pairs are recorded without clearing a valid committed map;
  the complete level refresh is deferred until every required pair is ready,
  then cleared and published atomically. Map size, filtering, caster set, and
  shadow coverage remain unchanged.
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


## Windows WebGPU resource policy (2026-08-17)

The 4,000,000-pixel drawing-buffer budget is a hard cap, not a DPR floor. The
old final `Math.max(1, dpr)` defeated that budget whenever the CSS viewport was
itself larger than 4 MP (notably 4K Windows desktops at 100% scaling). Effective
DPR may now fall below 1 only when required by the existing pixel budget. Normal
Retina Mac sizing is unchanged. Resize commits logical width, height and DPR in
one `setDrawingBufferSize()` call, coalesced to one requestAnimationFrame, so a
large target graph is not reallocated once for DPR and again for size.

Windows/D3D12 keeps exactly the same shadow depth maps, filters, world coverage
and final samples, but uses an R8 auxiliary shadow colour attachment when Three's
transmitted-colour-shadow path is disabled. Three r185 still requires a colour
attachment on the generic shadow RenderTarget even though ordinary PCF samples
only its comparison depth texture; the one-channel attachment removes the
otherwise-unused RGBA storage without changing depth precision. Metal retains
Three's stock shadow RenderTarget path.

Windows loading is submission-bounded: pipeline/scene compilation, warmup poses,
Optimus LOD warmup and final static-shadow refill are separated by GPU fences and
a browser-task yield. The final arrival cache is rebuilt one static level per
submission. Metal retains the established eager warmup. Boot and runtime also
surface Three's device-lost/uncaptured WebGPU errors through the entry plate; a
boot-stage tag and viewport/DPR diagnostics replace silent black/frozen failure.

The Starship's 440 m moving-caster target is platform-independent correctness:
it is inactive while the vehicle is parked. The parked vehicle lives in its own
switchable frozen-static caster bundles. Windows shrinks the inactive target to
64²; Metal keeps the original allocation to avoid a new ignition-time resize.
Ignition (during the 2.6 s hold-down) activates the full 440 m live target
before the cached copy is retired; after
touchdown the live target remains until every static clipmap has recaptured the
parked silhouette. The vehicle therefore keeps its shadow throughout ascent and
landing while idle memory/work is removed.
