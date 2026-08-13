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

## OVERHAUL W1 — ground/paving (read before touching any floor material)

- **AgX's shoulder can hide a 2:1 albedo range.** I spent a long time
  convinced `mx_noise_float` was returning a constant because the regolith
  rendered dead flat. It was not: an isolated field render showed strong
  patches. The validation harness was simply over-lit (sun 3.4 + hemi 1.35,
  exposure 1.15), which parked the ground in AgX's shoulder where a 0.23↔0.45
  albedo step compresses to nothing. **Calibrate a validation harness's
  exposure before judging any albedo work** — the real pipeline sits near
  exposureEV 0.15. Corollary: `mx_noise_float(vec2)` is fine and full-range.
- **LOD-fade each detail band by ITS OWN wavelength, not by one global
  cutoff.** A single `1 − smoothstep(0.06, 0.34, footprint)` on the whole
  relief field killed the 0.55 m aeolian ripples at exactly the grazing angles
  where ripples are the entire point, because the footprint blows up along a
  glancing view. Ripples now fade at (0.16 → 0.52 m) and pebble/grit micro at
  (0.03 → 0.13 m). This single change is what made the ground read as Mars.
- **Derivative bump: recover the TRUE world gradient.** three's `bumpMap`
  normalizes the position derivatives away, so its strength drifts with
  distance. `groundMaterials.worldGradient()` solves the 2×2 system from
  `dFdx/dFdy` of both the height AND `positionWorld`, giving a scale-correct
  slope. Costs nothing extra: screen derivatives never re-evaluate the field.
- **Winding decides visibility, and swept sections are easy to get backwards.**
  `sweepSection` requires stations ordered so `travel = (−out.z, 0, out.x)`;
  an outward-facing circle therefore walks INCREASING angle and an inward-
  facing one (an annulus's inner kerb) walks DECREASING. Up-facing polar quads
  must be emitted angular-then-radial. Both were wrong on the first pass and
  would have shipped invisible curbs (cf. S14's inside-out tube barrels).
- **Overlapping surfaces at one datum are the z-fight generator.** Paved
  regions carry a priority and lower slabs get their vertices projected onto
  the higher region's boundary. Exact projection = zero-gap junctions AND no
  stacked surfaces, from one rule. Prefer this to nudging Y offsets.
- A polar grid that starts at r = 0 emits one **zero-area triangle per angular
  segment** (640 of them here) — the audit's `degenerate` check catches it.
  Start the innermost ring at r > 0 and hide the pinhole.
- `interiorHeight()` now returns the WALKABLE surface (regolith grade + the
  0.075 m paved lift); `groundGrade()` is the regolith alone. Place anything
  that stands on the ground with `interiorHeight`, never with `PADS[].y`, and
  never author a flat apron at exactly `interiorHeight` — that is coplanar
  with the regolith mesh.
- parkPlan's pad skirts (5–8 m against 0.5–1.4 m steps) are 20%+ ramps. They
  are eased over 1.8× and the swale amplitude collapses near every pad, or
  paving crossing a skirt turns into a ski slope. Verified mechanically by
  sampling the slope over every paved square metre — do that again after any
  layout change (max should stay under ~15%).
- Multi-agent verification reality: with N agents editing `src/`, vite
  full-reloads every few seconds and kills any in-page probe. Two things that
  work: (1) `await import('/src/world/x.ts?t=' + Date.now())` runs YOUR module
  in the live page independent of whether the app boots at all — great for
  mechanical audits; (2) build a self-contained render harness (own canvas at
  a FIXED pixel size, own renderer, own lights) inside a single tool call. A
  hidden browser pane reports `innerWidth === 0`, so any canvas sized from the
  window is 1×1 and every screenshot comes back black.

## Overhaul W1 — archkit polygon layer + the audit gate
- `src/archkit/meshdata.ts` is now the authoring model (friends port);
  `writer.ts` is only the SINK. Anything with a silhouette gets a profile,
  not a box. `writeInto(writer, slot, md)` mixes both in one assembly via
  the new `PartWriter.raw()`. Read `dev_docs/systems/archkit.md` §"The
  polygon layer" before authoring geometry.
- **Author Z-up, emit Y-up.** MeshData carries `frame`; `toTriangles()`
  swaps y/z and reverses winding at emit. So `translate`/`rotX` before
  emit are in Z-UP. Every profile in geometry-craft.md can be typed in
  literally. `placeYaw()` is the only Y-up transform.
- **Never `join()` a multi-part object before emit.** join collapses to one
  smooth angle, and cleanMesh will then weld vertices ACROSS a butt joint
  between parts that were never one shell. Keep `Record<slot, MeshData[]>`
  and clean each part; the writer merges them anyway.
- `writer.lathe` now welds poles (routes through `revolve`). The old path
  emitted `segments` coincident verts at any on-axis profile point — that
  is the same zero-area-face → NaN-normal family as S12's greenhouse arches.
  `legacyNormals: true` if you ever need the old shading back.
- **The audit gate is `await window.__elysium.audit()`** (needs `?debug`).
  Ports Central_Perk/audit.py verbatim: 0.13°, 1.5 mm, 2 cm² TRUE CLIPPED
  overlap, 30 mm scaled clash. `zfight` must be zero; `backToBack` is every
  legitimate butt joint and is expected to be large.
- Two audit bugs that cost time and must not be re-introduced: (1) the AABB
  pre-reject MUST be inflated by the 1.5 mm plane tolerance — two coplanar
  faces 0.5 mm apart have non-overlapping boxes, so a bare box test drops
  exactly the pairs the gate exists to find; (2) scene walks must use
  `node.isMesh`, never `instanceof Mesh` — a page can hold two copies of
  three (vite's pre-bundled dep + a raw module URL) and `instanceof` then
  matches NOTHING, i.e. a perfect report from auditing zero meshes.
- Probing archkit without booting the game: vite serves TS on demand, so
  `await import('/src/archkit/meshdata.ts')` works straight from the console
  even while another agent's edit has main.ts throwing at boot. Use
  `await import('three')`-equivalent care: import three via the SAME
  specifier the module under test uses, or rely on duck-typed flags.
- `node --experimental-strip-types tools/archkit-selftest.mjs` runs 104
  assertions over every primitive (closed shells, unit normals, outward
  winding, pole welding) plus the audit's own true/false positives and the
  bench. `src/` imports are extensionless, so the script registers a
  `node:module` resolve hook that appends `.ts` — hence its dynamic imports.
- Park bench is the reference object (`archkit/kitBench.ts`): 37 parts,
  2 640 tris, seat 451 mm, zero z-fight/clash. `kit.bench()` delegates with
  an unchanged signature, so all 6 placements picked it up with no edits.

## Overhaul W1-light (lighting/grade/AO) — lessons
- **Screen-space “barcode” bars were stock GTAO structure, revealed by the
  sun-facing composite.** r185's nominal 16-sample mode is actually three
  angular slices × six steps × two sides (36 depth taps), rotated by a repeating
  5×5 texture and quantised to R8 before any denoise. Back-lit surfaces give AO
  more indirect-light authority, making that pattern look sun-dependent. The
  permanent fix keeps 36 gather taps but redistributes them over six slices,
  uses non-repeating IGN, R16F visibility, separable half-res depth/normal
  denoise and four-tap joint upsampling (`render/gtaoVisibility.ts`). Do not add
  temporal accumulation without motion vectors; moving park systems would
  ghost. Diagnose in order with `?pass=aoraw`, `aodenoised`, `ao`, `aoradius`,
  then `aoshare`/`aoapplied`.
- **AgX was a first-order cause of the "flat tan wash".** On a palette that
  is already one hue family, an operator that desaturates the whole mid-range
  collapses rust paving, ochre regolith, warm steel and butterscotch sky onto
  the same tan. Switched to `NeutralToneMapping`. If anyone reaches for AgX
  again on this project, they must re-solve the whole sky+grade palette.
- **Sky palette and LUT are ONE system — never tune one alone.** The sky's
  three stops were solved BACKWARD from ref_images/mars_park.png through the
  whole shipped chain (exposure → Neutral → sRGB → LUT). A CPU mirror of that
  chain is the only honest way to do it; eyeballing linear values is how the
  first pass ended up 50% over-saturated in the horizon. Rebuild the mirror
  before re-tuning (it is ~90 lines: neutral() + srgb() + gradeSample()).
- **Vibrance that boosts LOW-chroma colours destroys separation here.** The
  S4 grade did that, which pulled steel/concrete/sky toward regolith ochre.
  Plain saturation leaves neutrals neutral by construction — that IS the
  separation. Same logic says: do NOT warm the sun colour to get a dusk look.
  Warmth belongs to the sky, the dust and the artificial layer; an orange key
  re-flattens everything.
- **`sceneColor.mul(ao)` darkens direct sun** — the GTAO reference's named
  "sunlit surfaces become gray". Fixed WITHOUT an albedo buffer: for a diffuse
  surface `indirectShare = E_amb / (E_amb + E_sun·N·L·shadow)` is albedo-free,
  and `direct + indirect·ao` collapses to `sceneColor · mix(1, ao, share)`.
  `ENVIRONMENT_INTENSITY` therefore lives in `sky/sun.ts` — the PMREM bake and
  the AO reconstruction must read one number.
- **DEAD END, do not retry blind: `albedo` as a third pass-level MRT
  attachment.** In r185 every material that does NOT set its own
  `material.mrtNode` writes the SAME albedo — ground, foliage, benches and
  building shells all came out one identical brown, while dome glass and
  milkyPanel (which DO override mrtNode, so they get their own merged MRT
  node) were correct. Passing the property node bare (`mrt({…, diffuseColor})`,
  three's SSRNode convention) rather than wrapped in `vec4(...)` changes
  nothing. Same family as the r185 `receivedShadowNode` per-light cache trap.
  Diagnose MRT attachments with a RAW tap (`vec4(tex.rgb,1)` straight to the
  output) — a `renderOutput()`-wrapped one hides how flat the data is.
- **Dusk-dim comes from the key/fill RATIO, not from a darker world.** Sun
  2.6→3.15 and environmentIntensity 0.5→0.33 together: shade deepens enough
  for fixtures to register while sunlit paving stays exactly as bright. It is
  still late afternoon; do not lower exposure to fake evening.
- **A signed carve+glow volumetric cannot be bounded.** The old interior haze
  accumulated a difference and leaned on the aerial medium for its base. It is
  now one march producing `density` + `lit` (their ratio is the shaft) and a
  `mix(scene, inscatter, amount)` with `amount` hard-capped at 0.18. Any
  volumetric that can paint the frame should be capped by construction.
- **Do not use TSL's implicit `cameraWorldMatrix`/`cameraPosition` for new
  work inside the fullscreen post pass** — pass `uniform(camera.matrixWorld)`
  explicitly like `projectionInverse` already does. (The existing haze code
  uses the implicit nodes and works, but the explicit form removes a class of
  "which camera is this?" doubt for free.)
- **8-bit banding is a real risk on the Mars sky** (a huge smooth gradient
  filling most outward frames, plus a contrast-adding LUT). `marsGrade` now
  adds 1 LSB of triangular-PDF interleaved-gradient dither after the vignette.
- **TDZ trap when baking a LUT at module load**: `export const marsLutTexture
  = createMarsLutTexture()` runs immediately, so every recipe constant it
  reads must be declared ABOVE it. Cost one broken boot
  ("Cannot access 'WHITE_POINT' before initialization").
- Emissive slot ladder is now authored against the bloom threshold (1.0):
  utilityLight 5.0 > signageGlow 3.4 > runningLight 3.2 > floorLens 2.6 ≈
  growBar 2.6 > interiorGlow 2.0 > threshold > brightest lit surface ≈0.9.
  Rule for anyone adding a fixture: **scale the emissive AREA, not the
  multiplier** — the ladder only means something as a whole.
- Real lights are budgeted (`REAL_LIGHT_BUDGET = 8`, 6 spent) in
  `world/lightFixtures.ts`, installed from `SkySystem.init` so every district
  can register during its own `init()`. Never toggle `Light.visible` — drive
  `intensity` via `setIntensity()`; visibility changes the LightsNode cache
  key and rebuilds every lit WGSL program in the park.
- Headless probing with several agents live: give yourself your OWN browser
  tab (`tabs_create`), and after every navigate do `dispatchEvent(new
  Event('resize'))` + a ~600 ms wait BEFORE the first `step()` — a background
  pane boots at 1×1 and the first frames render into a 1-pixel swapchain
  (looks exactly like a solid-black "pipeline bug"). Also: `requestAnimation
  Frame` never fires in a hidden pane — awaiting one hangs the eval for 30 s.

## Overhaul W1-dome (gridshell + glass) — lessons
- **The dome's tan-balloon was a DOUBLE FRESNEL, and it was provable in one
  minute**: set `visible=false` on the three meshes with `renderOrder >= 9`
  and re-step. The sky gradient, the mountains and the rib grid all came
  back instantly, which ruled out interiorHaze/aerial/grade before touching
  any of them. Do this glass-off A/B before theorising about a veil.
  The cause: a lit `MeshStandardNodeMaterial` already Fresnel-weights its
  env specular, and the shell then multiplied a hand-authored Fresnel
  `opacityNode` on top. Big glazing is now `MeshBasicNodeMaterial` with an
  authored response where **the alpha IS the physical reflectance**, so the
  blend `bg·(1−R) + reflected·R` is the correct thin-sheet answer by
  construction. Rule: never stack an authored Fresnel alpha on a lit
  material's own Fresnel.
- Corollary for anything alpha-blended and physical: compute each layer's
  (weight, radiance) pair, sum the weights into `opacityNode`, and divide
  the weighted radiance sum by that alpha for `colorNode`. Then adding a
  layer (dust film, seam) can never brighten or darken the layers under it.
- **Once a member family is real geometry, the analytic field must stop
  drawing it.** Two copies 0.1–1.0 m apart radially = doubled lines with
  parallax at every oblique angle. `latticeField` now exposes
  `latticeCoverage` (members → shadow net + shafts) and `latticePaneSeams`
  (16 mm silicone joints → the glass) as two WIDTH SETS over one family
  definition, so they still cannot disagree about where a line is.
- **WGSL leaves `smoothstep(hi, lo, x)` implementation-defined.** The dome
  had two reversed-edge smoothsteps (Panewalker θ band, clean-swath falloff).
  Always write an inward mask as `1 − smoothstep(lo, hi, x)`.
- Gridshell assembly rule that removed every clash without a boolean:
  **ribs continuous → rings stop at rib collars → bars stop at rings**, one
  shared radial datum for all inner faces, depth the only difference, 15 mm
  reveal at every butt joint, and a cast collar that swallows the rib's whole
  section (proud on all four faces, so nothing is ever coplanar).
- Trimming a shell opening generically: mark each station inside/outside the
  bore, split the station list into runs, and bisect the boundary segment,
  **re-projecting the interpolated point back onto the sphere**. 14 iterations
  is exact to well under a millimetre and it works for ribs, rings, bars,
  collars and base shoes with one code path.
- A full ring that must clear a penetration is best built as a revolve with a
  **per-longitude profile** (the plinth dips under the connector tube) — one
  continuous casting, no arc end-caps, no patch under the bore.
- Horizontal exterior structures weather by SETTLING, not splash: key the
  dust on `normalWorld.y`, not on height. The shell's height-based grime
  applied to the 300 m connector duct painted the whole thing brown.
- Headless probing when several agents share the browser pane: pass an
  explicit `tabId` on EVERY call — otherwise another agent's `navigate`
  steals the active tab and your `?pass=`/camera silently become theirs
  (I spent a while reading someone else's `pass=albedo` frames).
  Also, `toDataURL` on the WebGPU canvas returns a STALE image unless the
  pane has composited since the last `step()`; take a `computer screenshot`
  first (that forces a composite), then POST the canvas for a full-res copy.

## S15 robots overhaul — geometry method, contracts, harness
- `src/robots/forge.ts` is a self-contained polygon toolkit (profiles →
  `prism`/`revolveY`/`tube`/`loft`, weld, smooth-by-angle per-corner normals,
  ear-clipped n-gons). It exists because the robots were rebuilt in parallel
  with the archkit MeshData port; when `archkit/meshdata.ts` stabilises the
  forge should collapse onto it — the authoring model is deliberately the
  same (parts emitted individually so two touching parts never smooth into
  each other; `join()` before `add()` when you WANT one welded shell).
- **Fan triangulation of an n-gon is only safe for convex caps.** The moulded
  shells here use U-band sections (open underneath, real wall thickness) and
  a vertex-0 fan across one emits inverted overlapping triangles. Ear-clip on
  the face's own plane, dropping the dominant axis and swapping the remaining
  pair when the normal points negative.
- **Never mirror a part with `object.scale.x = -1`.** Mirror the polygons and
  reverse their winding in the same pass (`mirrorX`). A negative-determinant
  object leans on backend winding-flip behaviour; mirrored geometry cannot
  render inside-out no matter what the backend does.
- Vehicle materials MUST read `positionLocal`/`normalLocal`, never
  `positionWorld` (`kitMaterials()` are world-space and will swim on anything
  that drives). `robotMaterials.ts` is the object-space set: two named causes
  (`dust` settling on local-up faces, `wear` rubbing paint back to primer)
  drive colour + roughness + metalness together, with `detailKeep(far)` so
  fine grain retires before it aliases.
- Rotation-order trick that keeps a rig contract intact: a spinner Group with
  `rotation.x = π/2` baked and only `rotation.z` incremented spins about its
  OWN axis (three composes Euler XYZ as Rx·Ry·Rz, so Rz applies first in the
  local frame). That is how the sweeper's twin brooms spin in place while the
  carriage they hang from is a separate nodding `tool` group.
- Watch the sign when a part swings on a hinge: both the mule's drop side
  (`rotateZ`) and the groundskeeper's charge-port door (`rotateY`) folded
  INTO the body on the first pass. A folded panel lying across the cargo bed
  reads as a mysterious black slab in shots — check the rotated centre by
  hand before blaming materials.
- **Isolated-model harness** (worth reusing, needs no repo file): from the
  running dev page, `await import('http://localhost:5173/src/<file>.ts?t=' +
  Date.now())` gets a fresh copy of any module through Vite, and the
  optimised three chunks are importable by the URLs in
  `performance.getEntriesByType('resource')`. Build a private
  `WebGPURenderer` on your own sized canvas, add the built rig, POST
  `toDataURL` to the shot server. This survives the park being mid-rewrite by
  other agents, gives real close-ups the park camera can never frame, and
  sidesteps the hidden-pane 0×0 canvas (the app's post targets are sized at
  boot, so an in-app `setSize` afterwards renders a stale near-black frame).

## W2 tram — verification harness + geometry lessons
- **The masterplan's probe loop breaks down when 5+ agents edit at once.**
  Vite full-reloads the page for ANY src edit, so a 20 s probe against the
  main app almost never completes ("Inspected target navigated or closed").
  Fix that worked: a throwaway page whose HMR graph contains ONLY your own
  modules — `src/<area>/preview.html` + `preview.ts` importing just your
  builder, served at `http://localhost:5173/src/<area>/preview.html`. Other
  agents' edits then do not reload it. Delete both files when done. Recipe:
  WebGPURenderer + 3 DirectionalLights + AmbientLight, expose
  `window.__x = { look(p,t,fov), shot(name) }` where `look` does
  `renderer.renderAsync` and `shot` POSTs `toDataURL` to :9911.
- **Canvas readback in the browser pane is ONE FRAME STALE** when you drive
  the main app with `loop.manualStep()` — `manualStep` does not await the
  async WebGPU render, so `toDataURL` returns the previous frame. Symptom:
  you move the camera, the image never changes, and you conclude the camera
  is being overridden. Step 2–3 times (re-applying the camera each time)
  before reading, or use `renderAsync` directly and await it.
- Also: a hidden pane boots the canvas at 1×1 (notes S13 clamp). Always
  `window.dispatchEvent(new Event('resize'))` once after boot before probing.
- **Geometry**: a "queryable analytic surface + signed inset" model
  (`hullPoint(z, s, inset)`) removes essentially every coplanar/gap/float
  defect class by construction — applied trim is GENERATED from its host
  rather than positioned next to it. It also makes late changes cheap: the
  door-bay scallop, the livery band and the quarter-lights were each a
  handful of numbers, not a remodel. Worth copying for any other hero object.
- **Closed-shell winding is not worth hand-checking.** `unifyOrient()`
  (edge-traversal flood fill + signed-volume flip) makes any hand-authored
  closed solid outward-facing automatically. Use it on every prism/lathe/
  capped loft and stop reasoning about quad order (cf. the S14 inside-out
  tube barrels).
- **Reversed-edge `smoothstep(hi, lo, x)` is a WGSL hazard** — write
  `float(1).sub(smoothstep(lo, hi, x))`. `materials/library.ts:deckPlate`
  still has two reversed-edge calls.
- Emissive geometry must NOT cast shadows: a transparent pane written into
  the sun's shadow map darkens the cabin it is meant to let light into.

## Overhaul W2 vegetation — the r185 traps and the harness truth

- **THE ALPHA-CUT FOLIAGE SHADOW CONTRACT (r185).** Shadow maps render with ONE
  `scene.overrideMaterial`; `Renderer._getShadowNodes` copies almost nothing
  across. Consequences, all verified in three's source:
  - `material.map`'s ALPHA is multiplied into the shadow alpha and is the ONLY
    route by which a cut-out silhouette reaches the shadow pass. Foliage that
    carries its cut-out purely in `colorNode` casts SOLID RECTANGLES.
  - `colorNode.a` is ALSO multiplied in. So put the cut-out in `opacityNode`
    and keep `colorNode.a` exactly 1, or the shadow silhouette erodes to
    `sqrt(alphaTest)` and thin leaf tips vanish from the dapple.
  - `material.alphaTest` (the NUMBER) is copied; `alphaTestNode` is NOT. Always
    set the scalar too, even when driving the test with a node, or the shadow
    pass has no cut at all.
  - `material.positionNode` is reused as the shadow position node — wind sway
    moves the shadow with the leaf for free.
  The recipe: `map` + `colorNode = vec4(tint, 1)` + `opacityNode = map.a` + a
  real `alphaTest` number.
- **`toDataURL` on the WebGPU canvas is stale until the pane COMPOSITES**, and
  a hidden pane never composites on its own. I ran four A/B tests (backlight
  off, roughness 1, sun 0, hemi 0) and got four byte-identical images before
  realising every frame was the one captured at page load. `renderAsync` is not
  enough. Force a composite with a `computer screenshot` call FIRST, then read
  the canvas — or better, see the next note.
- **Drive a validation camera by QUERY PARAM, never by a follow-up console
  call.** With ten agents editing `src/`, vite reloads a preview page every few
  seconds; a camera pushed in from outside is lost and the page re-renders its
  own default view. Every screenshot then looks identical, which reads exactly
  like "something is overriding my camera". `preview.html?v=planterclose` is
  reload-proof: navigate, screenshot, done.
- **A tint ramp that saturates is a brightness multiplier.** The canopy's warm
  ramp was `saturate(uvY*0.55 + seed*0.5 + 0.1)`, which returns 1 for nearly
  every vertex — so every leaf got the full warm end and the whole tree
  rendered cream. Check the ramp's typical value, not just its endpoints.
- **`smoothShade` erases any relief gentler than its angle.** Rock strata as a
  6 cm radius change spread over a 40 cm band is an 8 degree slope; at
  `smoothShade(26)` it averaged to nothing and every boulder was a soap bar.
  A bed has to be a riser-and-tread (sharp change over ~15% of the band) and
  the smooth angle has to sit below it. Same logic as S14's "ground art needs
  GEOMETRY", one level down: geometry finer than the shading threshold is not
  geometry either.
- **A rock the same value as the ground is invisible however well it is
  modelled.** The first boulder pass was a tan barely distinguishable from
  regolith. Mineral features need value separation from the surface they sit on
  before they need detail.
- **`bladeCluster`'s `width` is a HALF-width.** The stylized-meadow-grass source
  ships `0.085` because its blades are stylised 17 cm straps; copied straight
  into a realistic planter it produced 11 cm sedge that read as palm fronds.
  Sedge wants ~0.006-0.012.
- `attribute(name, 'float')` types as `AttributeNode<string>` in TS and loses
  every chaining method — `foliageMaterial.floatAttribute()` is the single cast
  site. And a material that reads a baked attribute (`aRidge`) will log
  `AttributeNode: Vertex attribute not found` the moment it is bound to
  geometry that came through `PartWriter`, which carries position/normal/uv and
  nothing else. Give such materials a procedural fallback parameter.
- Instanced species get per-instance variation from `hash(instanceIndex)` — no
  custom instanced attributes needed, and no risk. Anything that is genuinely
  per-VERTEX (clump depth, wind seed on baked canopy geometry) is a normal
  geometry attribute. Between them there is no case left that needs
  `instancedBufferAttribute`.
- Layout note for whoever owns paving/tram: the boulevard planters run out to
  r = 94.9 while the masterplan's guideway swept volume starts at r = 94.5.
  Vegetation compensates (no outward spill there, tall species on the park side
  only), but the wall itself is over the line.

## W2 farmside — geometry cost, and the audit on merged slot meshes
- **`bevel()` is a 432-triangle fillet grid.** `roundedBoxMesh` at 2
  segments emits 6 faces x 36 quads. On hardware that repeats (364 grating
  bars, 231 pallet boards, 234 post caps) that alone was 1.13 M triangles
  and a 7.7 s district build. The fix is not "stop chamfering" — it is to
  put the edge treatment in the PROFILE (`prism(chamferRect(...))`, 20 tris)
  for anything that repeats, and keep the true fillet for parts a guest can
  put their face against. Same rule for `panelWithHoles` uprights and
  repeated lathes: build ONE prototype and `MeshData.clone()` it.
- **`auditGeometry`'s `at` is the centroid of the FIRST pair recorded for a
  mesh-pair key, not the centroid of the whole hit.** Chasing it as "the"
  location wastes time when one key aggregates hundreds of pairs. What works:
  fix the structurally obvious defect at that point, re-run, and read the new
  `at` — it walks you down the list. Also: because PartWriter merges a whole
  district into one mesh per SLOT, the `clash` pass compares slot meshes, so
  its `crossings` numbers are district-wide and effectively uninformative;
  `zfight` is the gate that still means something.
- Defect families this district actually produced, all of them "two parts
  authored to the same footprint": a crate's four walls overlapping at the
  corners (split the runs), a base slab spanning under its own walls, a rim
  band occupying the same z as the walls it caps, a post standing through the
  foot plate it is bolted to (start it ON the plate), a stair whose top tread
  shares the deck plane (the deck IS the top landing), gable mullions and
  transoms in ONE y-slab crossing each other (segment the transoms), a
  louvre pasted over the mullion it crosses (make it fill a grid cell), a
  ridge beam running into the gable arch, and a bund kerb built as a slab
  over its own sump (make it a ring of four bars).
- Headless district probe that needs no browser: `node
  --experimental-strip-types` + a `node:module` resolve hook, a `document`
  stub for `signageMaterial`'s canvas, and a Proxy material map for
  `writer.build()`. Builds the district, counts triangles per slot, checks
  the guideway keep-out by sampling vertices, and runs `auditGeometry`
  directly. Seconds per iteration versus minutes through the shared page.
- With all nine browser tabs claimed by other agents, the way to get shots
  without stealing one is `javascript_tool` on an existing tab building a
  PRIVATE canvas + `WebGPURenderer` + `await import('/src/...?t=N')` copies
  of your own modules (S15's isolated-model harness). It never touches the
  host app's camera or loop. Two traps: the FIRST `toDataURL` after
  `renderer.init()` is always stale (render + read once and throw it away),
  and any other agent's edit full-reloads the page mid-eval, so build and
  shoot in ONE call rather than stashing a handle on `window`.

## W2 track/stations — datum traps and the shared-pane workaround
- **`beamTopY` is now the paving datum, not a pad table.** Street-running means
  `slabTop(x,z) − GUIDEWAY_CHANNEL.recess`, so the Loop's car floor is
  `slabTop + 0.56` everywhere by construction. Anything that needs the cabin
  floor must call `track.carFloorY(x,z)`; never re-type 0.62.
- **A platform on a 97 m radius CANNOT be a rectangle.** A straight 18 m edge
  held 1.4 m off the alignment reaches r = 96.2 at its ends — inside the 2.6 m
  car. Everything at a station is placed in an (arc offset u, inward v) frame.
- **And it cannot be LEVEL.** `groundGrade` swings 0.48 m across Overlook's
  18 m of arc; the guideway follows the paving, so the deck has to follow the
  guideway or the car floor is half a metre out at one end. Decks now take
  `platformDeckY(u)` and footings `platformGroundY(u) − 0.42`: top tracks the
  guideway, bottom tracks the terrain. Check this on ANY new platform-like slab
  — the failure is invisible at the centre and glaring at the ends.
- **The station kit and the paving planters share one 0.115 rad gap.**
  `pavingPlan`'s boulevard planter run reopens ±0.115 rad off every station
  bearing. Deck arc AND end flights have to fit inside it (18 m deck, flights
  landing by ±0.104 rad). Widening a platform silently drives it into a planter.
- **Level boxes on a sloping plane are a coplanar-pair factory.** A canopy roof
  that rises 0.26 m, a deck that falls 0.17 m — purlins, pressure caps, gutters
  and guard rails all have to be swept members or slabs ON that plane. Six of
  the eight zfight pairs in this wave were a box placed at the plane's midpoint.
- **Bury-and-cap has a stack rule.** A bearing that sits INSIDE its capital with
  its top face at the capital's top face is a same-facing coplanar pair, i.e. a
  zfight, not a joint. Every member of a stack must bite the next by 3–6 mm and
  no two faces may end at the same height: capital top → plate (5 mm in) → pad
  (3 mm into the plate, 4 mm into the girder).
- **`clashPass` cannot see parts, only slots.** PartWriter merges by material,
  so every correct bury-and-cap registers as a mesh-pair crossing. `zfight` is
  the number that means something; drive `clash` with `clashAllow`, never by
  making joints thinner.
- **Verification when the app will not boot and the tab cap is reached** (10
  agents): `tabs_create` fails, and someone else's broken module stops
  `window.__elysium` ever existing. What works: run everything through Vite in
  ANY existing tab — `await import('/src/tram/track.ts?t='+Date.now())`, build
  into a `PartWriter`, and call `auditGeometry(root)` on your own root. For
  pictures, import three via `performance.getEntriesByType('resource')`
  (`/node_modules/.vite/deps/three.js?v=…` and `three_webgpu.js?v=…`), build a
  private `WebGPURenderer` on your own 1280×720 canvas and POST `toDataURL` to
  your own shot server. Two gotchas: the FIRST `renderAsync` on a fresh
  renderer comes back blank (render a throwaway frame first), and a long eval
  is regularly killed mid-flight by another agent's HMR reload — keep evals
  self-contained and just retry on a different tab.

## W2 amenities — the dressing layer, and what the gate taught it
- **`insetPoly` on a rounded rect is a z-fight generator.** Offsetting by more
  than the corner radius folds the arcs back through themselves; the fold
  emits coplanar same-facing cap triangles. It bit EVERY hollow shell and
  recessed lens in the first pass (lamp luminaire, waste hood, emergency and
  fire cabinets, notice board, monolith). Author the inner outline instead —
  `kit.insetRect(w,h,r,seg,d)` shrinks the rect, same vertex count, same
  semantic corners. Second-order trap: `hollowPrism` itself does
  `insetPoly(innerPoly, rimBevel)`, so the INNER outline's radius must stay
  comfortably above the rim bevel too.
- **Never land a part exactly on another slot's plane.** A post cap on its
  shoe's cup floor is a textbook butt, but `audit.ts`'s clash test
  (Möller–Trumbore edge/triangle) is numerically ambiguous when an edge lies
  IN the other triangle's plane, and reports crossings. Give every such joint
  a 3 mm reveal — which is also what geometry-craft §3 says (flush is
  forbidden). Same for applied plates in a recess.
- **Prefer one material slot over a clean cross-slot joint.** The clash pass
  compares MERGED per-slot meshes, so interpenetration inside a slot is
  invisible (and is the "bury and cap" idiom), while any cross-slot
  interpenetration anywhere in the park is a hit. Deciding the lamp is all
  `steel` above its shoe removed six defects and cost nothing visually.
- **Continuous rails thread through their posts.** Guardrail rails are now
  emitted bay-by-bay between post faces (the dome gridshell rule). Anything
  swept along a line of repeated posts needs the same treatment.
- **Placement rules need the *walking corridor*, not the paved width.**
  Rejecting anything within `width/2` of a path centreline emptied the entire
  700 m rim promenade. `clamp(width × 0.31, 0.9, 1.6)` keeps ~2/3 clear and
  puts furniture on the verge, which is where the reference image has it.
  Blocker discs must also match the real footprint — two guessed 30–40 % large
  silently unplaced every station board and rack.
- **A headless gate beats the browser when ten agents share it.**
  `tools/amenity-audit.mjs` imports the module under test in node
  (`--experimental-strip-types`, the `registerHooks` resolver from
  `archkit-selftest.mjs`), stubs `document.createElement` for the canvas
  atlas, builds into a `PartWriter`, and runs `archkit/audit.ts` over the
  emitted group — per family in ISOLATION first, then merged. A defect inside
  one bin is invisible once sixty of them merge into `part:dark` with
  everything else. `three/webgpu` + TSL node graphs construct fine in node.
- Corollary: `import.meta.env` is undefined outside vite, so dev-only logging
  must be `import.meta.env?.DEV !== false`, not truthy.
- **Browser reality, 2026-08-10 evening**: the tab cap (8) was reached, and
  the app itself would not boot (another agent's in-flight
  `aperturedPrism: outline vertex counts must match`). The throwaway-preview
  recipe from W2-tram is what saved the visual check: `src/<area>/preview.html`
  + `preview.ts` importing ONLY your builders, its own WebGPURenderer on a
  fixed-size canvas, `window.__x.look(p,t,fov)` doing `renderer.renderAsync`.
  Two extra gotchas: the pane's composite is ONE FRAME STALE, so render 2–3
  times before `computer screenshot`; and the shot server on :9911 expects
  RAW base64 (strip the `data:image/jpeg;base64,` prefix yourself).
- Sign-face convention (`parkAmenities`): `yaw` gives the face normal
  `(sin,0,cos)`, `pitch` rotates about the face's right vector, `+π/2` is
  face-up (so a ground stencil is authored with `yaw = walkDirection + π`).
  Do NOT mirror the UVs of a back face — the quad's right vector already flips
  with the yaw. Only geometry whose two layers share one authored right vector
  (the banner cloth) needs the flip.

## W2 commons + hydro tower — traps worth not re-learning
- **The pads are NOT level.** `PADS` skirts bleed across each other
  (`interiorHeight` is a blend over ALL pads in order), so the Commons apron
  falls **84 mm** from centre to edge and the tower's 15–47 mm. Anything with a
  footprint bigger than ~3 m that rests on an apron must sample
  `interiorHeight` PER VERTEX along its foot, or it floats a visible 5 cm on
  the low side. `commons.ts` exports `groundedBand()` for exactly this; small
  objects (columns, poles, sign plinths) just take their own foot height.
- **Exactly coincident cylinders read as a clash.** Two rings authored to the
  same radius have coincident faces; the audit's edge/triangle test is
  ambiguous there and reports hundreds of crossings. 4 mm (`BUTT`) at every
  ring-to-ring radial butt. Planar butts (underside on top) stay exact — that
  is the legitimate `backToBack` class.
- **A swept section bows INWARD between stations.** The helical stair's
  stringer at r 1.9 with 0.215 rad steps has an inner face that dips
  1.865 → 1.854 at mid-span, so treads clearing the NOMINAL face still cut it.
  Clear the chord dip (`r·cos(dθ/2)`), not the nominal radius. Same maths bit
  the tower's rack posts against a 48-gon tray.
- **Four collinear points on an n-gon cap = a zero-area ear.** A square-
  shouldered T-section (web + cap at one depth) puts 4 points on one line, and
  `ShapeUtils.triangulateShape` emits a degenerate triangle in every extrusion
  end cap. Splay the shoulder so no line carries more than 2 points.
- **`rotateZ(md, phi)` puts local +X on the RADIAL axis; `phi − π/2` puts it on
  the TANGENT.** Getting this backwards drove a 3.5 m louvre blade 1.7 m into a
  plant room and a bridge deck 270 mm into a roof. Check which one you want
  every single time.
- **A lofted open strip has arbitrary winding.** `recalcNormals` orients open
  components by a majority keep-score; for a single quad row that is a coin
  toss. Both sign faces shipped back-facing (an empty tray with lit reveals).
  Zero-thickness applied faces should be `DoubleSide` by default.
- **Curved sign UVs**: seen from outside a drum, screen-right is DECREASING
  plan angle (u must run against the bearing), and `CanvasTexture.flipY` has
  already turned the image over (do NOT also invert v). Both mistakes are
  silent — you get mirrored or upside-down lettering that reads fine at a
  glance in a thumbnail.
- **Canvas sign panels are a proportion contract.** face width = arc × radius,
  face height = the box's open height; the canvas aspect must match or the
  letterform stretches. Cheaper to change the BOX than to fight the canvas.
- **kitBench has a real cast × aluminium interpenetration** (also found by the
  amenities agent) and it is INVISIBLE at yaw 0 — the clash pre-filter is
  axis-aligned, so a bench square to the axes never trips it. Audit rotated
  copies of anything you place with a yaw.
- Isolated per-part auditing beats slot-level auditing: subclass `PartWriter`
  and route every `raw()` into its own slot name, then the clash pass names
  individual parts and prints their bboxes. That plus a `document`/canvas stub
  runs the whole thing headless in node in ~40 s, no browser, and it survives
  the park being mid-rewrite by other agents.

## W2 residential — three geometry traps worth never re-learning
- **Offsetting a section inward folds its own detail.** A 60 mm proud belt
  rail in a profile, offset inward by the 95 mm wall to make an inner lining,
  crosses itself and emits ~3 m² of same-facing coplanar overlap running the
  whole length of the object. Keep a SECOND outline (`HabSection.flat`) with
  such details flattened back onto the base curve and offset THAT. Same at any
  end roll: fade the detail out as the roll deepens, and clamp the deepest
  offset (a 260 mm fillet sampled at 22.5° collapses past ~175 mm inward).
  An n-gon cap built on a self-intersecting outline ear-clips into overlapping
  coplanar triangles — that is how it shows up in the audit.
- **`loft(rings, {capStart, capEnd})` on a STACKED-RING loft emits solid
  discs.** Three parts authored as "a bead / a ring / a picture frame" shipped
  as slabs lying over their hosts. Caps are only correct when the part really
  is solid (table top, cushion, door leaf). Want a ring? `annularPrism`.
- **`roundedRect(w,h,r)` offset inward by more than `r` inverts its corners**
  silently and self-intersects. Keep `r > d` for every `polyOffset(poly, −d)`.
  This alone produced z-fights on a table apron, sofa cushions and shelves.
- **The audit's clash pass compares mesh PAIRS, i.e. SLOT pairs**, over the
  whole park, and reports any real triangle crossing — an EXACT butt between
  two slots counts. So: every cross-slot joint needs a ~2 mm reveal, and
  anything that must genuinely bury itself (a moulded upstand, a bedded
  flange, a welded brace) belongs in ITS HOST'S SLOT, where the bury welds
  instead of clashing. Same-slot crossings are invisible to the pass by
  construction, which is the correct license: they are one part.
  `crossings` is capped at 513, so 513 means "at least 513".
- **A per-part audit is far stricter than the shipped gate** and is the way to
  localise a defect: emit every `MeshData` into its own named `Mesh`, audit
  that, then filter out same-slot pairs. `scratchpad/` recipe: a node script
  with the `registerHooks` `.ts` resolver from `tools/archkit-selftest.mjs`,
  importing the builder directly. `globalThis.document = { createElement: () =>
  ({ getContext: () => null }) }` is enough to let canvas-atlas code run
  headlessly. Whole-district build + audit costs ~5 s and needs no browser.
- Ground contact under a large object cannot use one datum: `interiorHeight`
  moves ±0.1 m across a 7 m footprint. Build the feet PER SITE against their
  own sampled grade (variable jack extension is what jacks are for).
- Layout collisions found in `parkPlan.ts` while placing the arc, both need an
  orchestrator edit: `PLAYGROUND` (−62,−54,r9) sits on hab 5's bearing 5.8 m
  inboard of the survey arc and swallows habs 4–5 at any legal radius; and
  `PATHS['residential-lane']` terminates at (−86,−26), whose paved capsule +
  curb reaches r 87.98 — 1.85 m behind hab 1's site. The row's back building
  line (87.55) is set by that lane end, not by the guideway.

## W2 works — the defect classes that actually cost time
- **Build the district into a bare `PartWriter` in node and audit it there.**
  `registerHooks` + a 10-line `document.createElement` stub is all the canvas
  signage needs; three/webgpu constructs fine headless. A whole-district
  audit runs in ~1 s, survives the app being mid-rewrite by five other
  agents, and — crucially — can be run PER SUB-BUILDER. Every big hit I had
  was findable in one step once isolated and unfindable in the aggregate.
  (Recipe: `tools/amenity-audit.mjs` is the same idea, committed.)
- The five defect families, ranked by how much geometry they wrecked:
  1. **Two identical parts at one place.** Two bullets laid end to end shared
     their saddles; an H-frame emitted at both segments' shared node; a
     `guardrail()` path with a repeated point stamps a second post AND shoe.
     A single 4.4 m² coplanar hit is almost always this.
  2. **Crossing bars in one plane.** Any "frame" made of four bars crossing
     at the corners is four coplanar same-facing pairs. Verticals continuous,
     horizontals butt between them — and SHARE the verticals when the modules
     are closer together than two bar widths.
  3. **`section()`/`tubeAlong` centres its profile on the path**, so a member
     "standing at y" reaches `y − halfDepth` and sits inside its own base pad.
  4. **A closed ring path is not a closed member.** Repeating the first point
     and capping leaves two rings at one place with different frames. Use
     `tubeAlong({closePath: true, cap: false})`.
  5. **A body of revolution's axis.** `revolve(..., {axis:'x'})` then
     `rotateZ(t)` sends +X to `(cos t, sin t)` in world (x, z). For a district
     on a yaw ψ that is `π/2 − ψ` for the ALONG axis and `−ψ` for ACROSS —
     NOT ψ. Wrong by 50° and invisible until you stand in the room.
- **Two poured pads may never share a datum.** Overlapping discs at the same
  height are a 50 m² z-fight. Either merge them into one pour (convex hull of
  the two circles) or move one clear. Same for a pad and a building slab.
- **`darkGlass` is opaque** — nothing lit from behind reads through it. Use
  `cabinGlass` for any glazing with `interiorGlow` behind it.
- **`signageMaterial` letter-spaces onto a canvas that is always 1 : 0.28.**
  A plate must carry that aspect or the type stretches, and a line must stay
  inside about **6 / 10 / 14 characters at 1 / 2 / 3 lines** or it runs off
  the plate. (The width term in the rasteriser ignores the letter spacing, so
  anything ≥ 12 characters on one line overflows by ~70 % at any `widthPx`.)
- Girts/rails that run across an open doorway are the single clearest "this
  was drawn, not framed" tell. Split the run at every opening.
- Multi-agent browser reality: the pane's tab cap can be full, so budget for
  taking over an idle tab. After `tabs_select` + `resize_window(1280,720)`,
  `innerWidth` becomes real and the canvas resizes; before that it is 1×1.
  `toDataURL` needs a `computer screenshot` in between to force a composite,
  otherwise five different camera positions all return the FIRST frame.

## W2 leisure (bowl / Overlook drum / tree ring / playground) — lessons
- **A per-PART audit harness is worth building before you author anything.**
  `auditGeometry` names MESHES, and everything in this park merges to
  `part:<slot>` — so the whole district is one row and you cannot tell which
  of 1 200 parts is wrong. Wrapping `PartWriter` in a Proxy that runs EVERY
  call into its own throwaway writer + Mesh (named `pN:slot`, indexed by
  bbox centre) turns the same report into "p169 X p87 at (x,y,z)". Every
  defect below was found in minutes with it and would have taken hours by
  eye. It needs no browser: node + `--experimental-strip-types` + a
  `registerHooks` resolver that appends `.ts`, plus a `globalThis.document`
  stub whose `getContext` returns null (that makes `signageMaterial` fall
  through to a blank CanvasTexture).
- **Same-slot interpenetration is free; cross-slot is a defect.** The clash
  pass compares mesh PAIRS, and the park merges per material slot, so two
  parts in one slot are never tested. That is the deciding argument for
  giving a playground shoe the frame's colour rather than concrete, and for
  keeping a whole assembly (climbing dome members + hub balls) in one slot.
- **Exactly coincident planes between two solids are a defect, not a butt.**
  Both the coplanar pass (which flags the pair) and the clash pass (whose
  edge/triangle test is numerically ambiguous there) react to it. Author a
  0.03 m movement joint, a 1.5–6 mm reveal, or a real 0.3 m foundation
  instead. Corollary that cost the most time: **never rest a slab on the
  regolith.** `PADS` are dead flat, so a foundation whose underside sits at
  the pad datum z-fights the terrain over its entire footprint.
- **A scaled ellipse is not a parallel curve.** `ellipse(a−d, b−d)` differs
  from the true normal offset by 120 mm at 45° on a 2:1 drum. Any slab meant
  to butt a swept band needs the normal offset (and 30 mm of reveal on top,
  because the band's own chord sag is ~10 mm).
- **`polyOffset` on a rounded corner by ≥ its radius collapses the arc** into
  coincident points, and the loft/ear-clipper then ships overlapping cap
  triangles. Also: `roundedRect(d, d, d/2)` is NOT a circle — it doubles a
  vertex at each of the four arc joins. Use `circle()`.
- **A swept section that reaches inward further than the path's radius of
  curvature folds through itself.** Check `min corner radius > inward depth`
  on any closed `sweep`.
- **A bay's chord midpoint is up to a sagitta inside its own curve** (90 mm
  on this drum's tight ends). Place per-bay hardware at a station, or step
  it finer.
- **Build ON the shared plan, not beside it.** `pavingPlan.pavedSignedDistance`
  is the honest way to keep a structure off another agent's slab: the
  amphitheater's rows trim themselves against the `amphitheater-spur` ribbon
  and turn it into the bowl's vomitory ramp, so the two authors cannot
  collide no matter who edits first.
- Multi-agent browser reality (still true, worse now): all 8 tabs were held
  by other agents, vite full-reloads every few seconds, and `?view=` boots
  `DevOrbitSystem`, which OWNS the camera — setting `ctx.camera` directly
  does nothing visible. Move `registry.systems.find(s => s.controls)`'s
  `controls.object.position` + `controls.target` and call `controls.update()`.
  Do the click-Board / wait-for-handle / move / step in ONE eval so a reload
  between calls cannot strand you.

## Overhaul integration pass (2026-08-10, orchestrator)

- **The interior floor was face-down culled for half the overhaul** — the
  ground rewrite's polar grid wound (a,c,b) exactly as the exterior agent
  warned. What everyone (including me) judged as "pale regolith" was the SKY
  DOME'S below-horizon glow through the culled mesh. I initially REJECTED the
  exterior agent's fix because "the floor is visible" — the visible thing was
  the glow. Lesson: when two grids share a pattern and one is proven
  inside-out, verify the other by HIDING it (does the image change?), not by
  looking at it. A mesh can be "visible" because something else fills its
  pixels.
- **Albedo re-solve after a tone-map change is not optional.** AgX→Neutral
  invalidated every ground albedo authored under AgX's shoulder. Paving stops
  went ×0.72, regolith to the physical 0.15–0.25 Mars range (the exterior
  agent's number). If the tone mapper changes again, re-solve ALL ground
  albedos through the CPU mirror-chain method (grade.ts doc).
- **Boot-order trap: seatPose before first placeCars()** reads the car at the
  origin facing +Z → seat yaw π wrong → pinned at the look-cone edge (the
  camera stares at the side window all ride). placeCars() now runs before
  enterVehicleImmediate in TramSystem.init. Any system that derives a pose
  from another object's matrixWorld at init must force that object's
  placement first.
- **Seat transitions**: SeaPark's three-phase rig is ported into
  playerSystem (asymmetric 1.2 s/0.9 s smoothstep, exitPose retained through
  blend-out, body parked at the exit immediately, cone limits scale with
  blend). Alight+board verified frame-by-frame — no cuts. `controlEnabled`,
  `setLook`, `placeAt`, `enterVehicleImmediate` now exist for future rigs.
- **Footstep surface truth is pavedSignedDistance**, not PATHS ribbons — the
  civic floor is far wider than the path polylines now.
- Full-scene audit: baseline 25 zfight pairs / 68,840 m² → **1 pair (~0 cm²)**;
  4 defects; clashes are the documented bury-and-cap slot-granularity noise.
- Perf (real, player mode, compositing): 117–480 fps ride/park, 217 typical.
- POLISH BACKLOG (none blocking): crop-card backlight at <1 m; boulder
  silhouettes still domed (shape law wants angular blocks); tram carries 4
  PointLights outside the budget ledger (works fine — reconcile if the light
  budget ever grows); robots/forge.ts should collapse onto archkit/meshdata;
  works south apron could take an oil-stain/track dressing pass; hab window
  interiorGlow reads slightly hot; mountain 1.5–3 km band stipple under
  backlight (denser tessellation fixes); plaza name-stone back face is plain.

## Dome gridshell — sparse rebuild (2026-08-10)

- **A repeating structure is read as a GRAMMAR, not as a set of local
  decisions.** The dome's glazing bars doubled at ring 8 and again at ring 16
  to hold pane size roughly constant as the bay widened — locally sensible,
  globally fatal: one bay showed 1 intermediate bar high up and 3 low down,
  and the owner read the whole shell as a spider net. Constant pane size is
  worth less than a constant rule. The shell is now 24 ribs × 13 rings and
  nothing else (288 member runs, down from 4896).
- **The fix for "the panes are absurdly large" is a CONSTANT-count seam grid,
  not a tiered one.** Each bay is glazed 4 columns × 2 rows (96 meridian + 26
  parallel seam lines, 2304 panes), drawn as hairlines by the glass only —
  never as 3-D bars. Constant per-bay counts simply converge toward the crown
  and read as perspective; it is the *change* of count with height that reads
  as mess. Keep the seam counts exact multiples of the member counts
  (96 = 24×4, 26 = 13×2) so every 4th/2nd seam lands on a member's own joint
  and `max()` can never double a line.
- Seams are drawn on the glass but kept OUT of the shadow field
  (`SEAM_WIDTHS` yes, `MEMBER_WIDTHS` no). A 32 mm joint is ~0.9 % of
  patternless coverage that the 0.35° penumbra turns into uniform grey wash,
  and the interior shaft march pays for it per step.
- **On an exoskeleton gridshell, "thick" means WIDE, not deep.** Every member
  sits radially outboard of the glass, so from inside the park you see width
  and almost no depth. Widths went 0.32 → 0.84 m at the springing; depth grew
  as well but only buys exterior silhouette. If a shell still reads thin,
  widen it — deepening will not register from the floor.
- **Flanged sections, not chamfered boxes**, are what make a member read as
  structure at 130 m (inner flange catches sky, web goes dark, flange returns
  draw a hard line down the member). But a flanged profile is NOT star-shaped
  about its centroid, so the usual centroid-fan end cap lays triangles across
  both web notches. Ear-clip caps from the 2-D profile
  (`ShapeUtils.triangulateShape`) — it also handles any future profile.
  Keeping chamfers on ODD profile edges lets one `e % 2 === 1` test route the
  wear slot for every section, however many points it has.
- **A shipped half-bay phase bug worth checking for elsewhere**: a periodic
  line family written as `|fract(x) − 0.5|` puts its lines at HALF indices,
  i.e. mid-bay. `latticeField` had drawn every shadow stripe and every glass
  seam half a bay (up to 17 m) away from the member it belonged to, and it
  survived review because a periodic pattern looks right in isolation. Lines
  land on integer indices only with `|fract(x + 0.5) − 0.5|`. Whenever an
  analytic field is supposed to mirror built geometry, test one known
  member's φ/θ through the field rather than eyeballing the pattern.
- Members halved but 2.6× wider ⇒ mean shell coverage only 8.3 % → 7.2 %
  (open sky 91.7 → 92.8 %). Sparser structure does not automatically mean a
  brighter park; what changes is the distribution — broad bands with solid
  cores instead of a fine net the 0.35° penumbra smears into grey wash.
- **Anything that runs in φ crosses everything that runs in θ.** The crane
  rail was laid at "ring depth + 95 mm" and was therefore buried inside all
  48 ribs and their collars — invisible, and shipped. It now rides above the
  node line on sole plates + stools, and `domeCraneRailLift(θ)` is exported
  so `robots/panewalker.ts` derives its stand-off instead of hardcoding 0.5.
- Verification when the shared dev server is down (another agent had
  main.ts throwing): mirror the assembly maths in a throwaway node script and
  assert the invariants numerically — profile simple/CCW/even over the whole
  taper range, collar proud of the rib on all four faces, ring-end reveal
  exactly 15 mm, rail soffit above the deepest thing it crosses, shoe inside
  the plinth face. That found the buried rail; no screenshot would have.

## Glasshouse envelope rebuild — clipping, entrances, and the readback wall

- **A rectangular pane grid can never fit a curved frame; CLIP it.** The gable
  glazing used to be a rect grid with per-bay `min(z, soffit)` corners: the
  corners poked past the arch on one side of every bay, the chord left a gap on
  the other, and a "both corners are under the arch" test silently DROPPED the
  two part-cells at the springings (the owner counted them). The fix is one
  Sutherland-Hodgman pass per cell against the arch's own outline. It is only
  that simple because the clear region is **provably convex**: two haunch
  half-planes, a floor, and a disc. Author the outline as the CONVEX HULL of the
  offset section (one straight chord from the haunch foot to the arc springing)
  — the true offset has a 15 mm notch at the eaves that would break convexity,
  and the hull exceeds the real curve by at most 1.0 mm, buried under a 110 mm
  arch leg.
- **Prove coverage by raster, not by eye.** 10 mm grid over the clear region,
  counting how many pane triangles cover each sample: 0 = hole, >1 = overlap.
  264,917 samples, 0 and 0. That check found the two missing cells instantly and
  is the only honest answer to "make sure the glass fits perfectly".
- **Panes tuck, members stop short, the bead laps.** One number (the arch
  soffit as a section offset) generates all three: panes +4 mm INTO the rebate,
  members −52 mm (clear of the bead), bead from −2 mm to −44 mm. Members that
  stop at the *arch* instead of at the *bead* land their end caps on the bead's
  curved face — the centre mullion's cap sat 2 mm under it, same-facing.
- **A clear doorway is testable.** Triangle-vs-AABB (Akenine-Möller) over every
  emitted triangle against the clear-opening prism: closed → only the leaf's
  3,480 triangles; open → ZERO. Worth doing for any aperture a guest walks
  through; it catches the transom-across-the-door class by construction.
- **`box()` does not sort its bounds and `bevel()` re-generates from them**, so
  a mirrored part authored `y0 > y1` comes back inside-out and self-overlapping.
  Bit the mirrored gable sign plate/lens and (pre-existing) the tray end dams.
  Always `Math.min/Math.max` when a bound carries an `end`/mirror sign.
- **Repeated parts must differ in every plane they share.** A flight of approach
  treads nested back to one inner face, one base and one half-width was three
  separate coplanar families at once (9 m² of cast). Stagger the bite, the
  depth AND the width.
- **Collider `size` is (across, up, along) at `yaw = frame.yaw`.** The gable
  wall segments were still sized for the old (wrong) +π/2 yaw, so the far gable
  was a 0.4 × 9 m slab sticking out of the end of the house. Same swap was live
  on greenhouseInterior's skid and service-bay colliders. After ANY collider-yaw
  fix, re-read every `size` vector that yaw was serving.
- **Additive sprites must draw AFTER the glazing.** At the default renderOrder
  the panes (transparent, `depthWrite:false`, renderOrder 12) composited over
  the mist, so mist was attenuated by glass BEHIND it indoors and not at all
  once you stepped through the door — a step change exactly at the threshold.
  `sprite.renderOrder = 13` makes it continuous on both sides.
- **A burst is a valve, not a switch.** `sprite.visible = active` on a 10 s
  window pops at full opacity. One shared `env` uniform multiplied into every
  puff's `opacityNode` (2.5 s smootherstep in, 3.5 s out) fixes it; keep the
  per-puff `life` fade untouched and only cull on true zero.
- **Browser reality, 2026-08-10 late:** the park would not boot at all
  (`porch is not defined`, `DOME_COLLAR_PROUD is not defined` from two other
  agents mid-edit), AND the throwaway-preview recipe failed a level deeper:
  the pane will not composite a private WebGPU canvas, that canvas's own
  `toDataURL` returns a blank buffer, and the render-target fallback dies
  because the park's materials carry an `mrtNode` (single-attachment target →
  `struct OutputType {}` → WGSL "structures must have at least one member").
  If you go the render-target route you MUST replace every material with plain
  PBR first. When all of that is gone, node-side geometric assertions
  (coverage raster, tri-vs-AABB clearance, per-part audit) are strictly better
  evidence than a screenshot anyway — they answer the actual question.

## W3 tram cabin — the seat rebuild, and two defect classes it exposed

- **`SlotMesh.add` now EAR-CLIPS n-gons instead of fanning from vertex 0**
  (`tram/tramMesh.ts:triangulateFace`). Every channel section on the vehicle —
  the ceiling light cove, the crown raft, the seat track's T-slot — is a U, and
  a fan across a U emits triangles that fold outside the outline and overlap
  each other. It showed up as a mesh Z-FIGHTING WITH ITSELF plus one degenerate
  triangle per cap. If you author a concave prism anywhere, this is why it now
  just works; do not reintroduce a fan.
- **`zipCaps(m, ringSize, stations)`** closes a lofted tube by pairing `k` with
  `count − k` instead of capping with an n-gon. A moulded seat's cross-section
  is a banana; the same fan trap applies. Any loop authored with its two
  extremities at index 0 and `count / 2` can use it.
- **Never compare two different discretisations of one analytic surface.** The
  seat's pads are offsets of the same contact surface as the shell, and sampling
  each on its own grid put 117 triangle crossings into the back cushion: a 36 mm
  pocket ramp cannot be resolved by the shell's 50 mm station spacing, and the
  linear chord across it sits ~9 mm above the true pocket floor. Fix that
  actually holds: the pad's underside is bilinearly sampled from the SHELL'S OWN
  emitted grid (`shellFrontAt`). Same idea applies to any "part that sits in a
  recess in another part".
- **A rolled edge bulges past its own footprint by its roll radius.** Half a
  55 mm pad is 28 mm, so a pad whose footprint stopped at the pocket's flat
  floor punched straight through the bezel. Either inset the part by more than
  the roll, or make the roll an ellipse (a cap on the outward radius) — the seat
  does both.
- **A pad face that stays flat right up to its roll folds at ~70 deg and reads
  as a slab** no matter how good the piping is. Dome the face and let it fall
  ~3 mm BELOW the contact line at the seam, so the roll leaves tangentially.
- **`liningPoint`'s inset sign is the OPPOSITE of `hullPoint`'s.** Both do
  `p − n·inset`, but the lining loop's outward normal points INTO the wall, so
  positive inset stands PROUD into the cabin. Every interior moulding is built
  on that; getting it backwards turns the moulding inside out. (The file header
  in `tramInterior.ts` said the wrong thing for a while — it is fixed.)
- **`planarUV` mirrors any lettering on a −Z-facing face.** It derives u from
  world x for every face whose dominant normal is z, so of the two consoles one
  always rendered "LOOP" backwards. Anything carrying TEXT needs authored
  `faceUV` (see `screenFace`), not a prism.
- **The nose and the tail each had 0.54 m² of z-fighting since the tram was
  built**: `apertureShell` already closes its grid's last station with the mask
  ribbon (its `solid()` returns false past the end) and `buildEnd` built the
  same ribbon again. Whenever a grid shell is closed by its own boundary
  reveals, do not also hand-build the end cap.
- Verification reality, 2026-08-10 night: the browser pane would not composite
  at all, so `computer screenshot` fails outright AND `toDataURL` on the app's
  canvas returns the boot frame forever. The only thing that worked was the
  throwaway `src/tram/preview.html` + `preview.ts` page (own canvas, own
  `WebGPURenderer`, `await renderAsync`, POST to a shot server) — and it must
  take its shots ON LOAD, because a console eval against the app page is killed
  by another agent's HMR reload within seconds. Port 9911 is usually already
  taken by another agent's shot server; pick your own.

## P-wave orchestrator pass (2026-08-10, late)

- **The farm-quarter "invisible wall across the park" was a collider YAW bug**:
  `buildHouseColliders` rotated every glasshouse box by `frame.yaw + π/2`. The
  convention (proved empirically): parkAssembly's collider yaw θ maps box local
  X → world (cosθ, −sinθ) — exactly `frame.point`'s ACROSS axis at θ =
  `frame.yaw`. Never add the π/2. TWO more latent size-swap colliders (gable
  segments, skid/service bays) were still authored for the old rotated frame —
  when you fix a rotation bug, re-audit every SIZE authored under it.
- **Rapier queries return NOTHING until the world has stepped once.** Under
  `&freeze`, `fixedUpdate` never runs, so `intersectionsWithShape` finds no
  colliders anywhere and a collision audit passes vacuously. `world.step()`
  once before querying. The park-wide ASCII obstruction map (capsule
  intersection per 2 m cell, heightfield filtered out) is in the transcript and
  cheap — use it for any future traversal claim.
- **The tram dock camera cut was a curve-swap teleport**: per-car arc offsets
  clamped at the arrival curve's end (front car pinned early with
  `atan2(0,0)` → rotation zeroed), then the dock instant re-placed cars on the
  loop ~3.9 m away. Fix shape: ONE continuous arc-length domain that crosses
  the spur→loop seam (`carPoint` + `spurActive` window that self-clears once
  the train passes the seam, switching domains at exact equality). Also:
  `nearestS` coarse pass quantizes ~1 m on the loop — refine to 1 cm, it is a
  pose-continuity datum. Station stops now trigger at 2 cm/0.2 m/s, not
  25 cm/0.3 (the old threshold was a visible lurch).
- **Boarding is E-only by physics**: per-car fixed cuboid colliders teleported
  along in `fixedUpdate` + `PlayerSystem.nudgeOutOfBox` (yaw-OBB depenetration)
  for the moving case — the kinematic character controller never resolves
  collisions unless the PLAYER moves, so a sweeping vehicle must shove.
- **Autostep min-width was the "jump over every little lip" bug**:
  `enableAutostep(0.42, 0.28, true)` rejects any step whose clear landing is
  under 0.28 m — stair nosings and floor-light bezels are. Now (0.42, 0.05).
- **Pause = `ctx.time.paused` + pointerlockchange.** The loop already renders
  exactly one frame then halts when paused. Browsers deliver ESC-in-lock as a
  lock EXIT (no keydown), so pause on unlock; resume ONLY on lock-acquired
  (the ~1.25 s relock cooldown means a resume click can be rejected — leave
  the menu up). Audio: 60 ms master-gain fade THEN `context.suspend()`
  (guarded by a `pauseWanted` flag against the resume race).
- **`signageMaterial` squash class**: the canvas was fixed 1:0.28 landscape;
  every portrait/odd plate stretched it. It now takes `aspect` (plane w/h) —
  pass it at EVERY call site whose plane isn't 1:0.28. Free-standing
  `stencilSign` plates take `legsToY` (world ground Y) or they float.
- From the regolith agent (its files, its proofs): (1) never build a rotating
  anisotropic field as `p · dir(p)` — the gradient carries a |p| factor and
  folds far from origin; bend with a LATERAL coordinate displacement, each
  octave specced as (wavelength, max slope), sampled ~6:1 stretched along
  flow. (2) `IcosahedronGeometry`/`PolyhedronGeometry` are NON-INDEXED —
  `computeVertexNormals()` is flat shading; smooth low-poly needs an indexed
  build. (3) A partially buried body must be widest at or below the contact
  line or it reads as a perched mushroom. (4) Footprint LOD alone cannot stop
  moiré against a second pattern — fine bands need an explicit view-distance
  fade, and the albedo carrying a pattern must fade on the same band as its
  normal.
- **Browser-pane probing**: `computer` coordinates are in the SCREENSHOT's
  pixel space (e.g. 800×450), not the upscaled image you view — a click at
  image coords silently misses. When the pane isn't displayed nothing
  composites (no screenshots); DOM-clicking the BOARD button via
  `querySelector('#entry button').click()` still boots player mode headless,
  and all the `__elysium` step/placeAt/setLook probing still works.
- zsh profile breaks `python3` heredocs AND the bare `python3` alias
  (`_uv_msg` noise) — use `/usr/bin/python3`.

## Overhaul — THE COMMONS made enterable (commons agent)

- **A sliding leaf cannot live on a curved wall.** `DoorSpec.openOffset` is a
  linear translation, so any leaf authored on the drum's arc either leaves its
  own wall or ploughs through the next bay. Every option was tried on paper
  (leaf on its own bay chord, leaf recessed into the drum, leaf pocketed inside)
  and they all died on the same number: the curtain-wall mullion CAPS reach
  r 9.092, so the leaf plane must stand ≥ that everywhere along its travel. The
  answer is a FLAT applied portal — leaf inner face at 9.16 on the tangent,
  0.22 m proud of the glazing, 1.19 m of travel, and two radial glazed returns
  springing off the jamb mullions to close the wedge. If you ever move an
  entrance on a drum, solve for the cap radius first.
- **The old build had an unnoticed 2.3 × 1.8 m HOLE above its doors**: the
  ground glazing skipped both entrance bays full height while the decorative
  leaves only reached 2.6 m. Nobody saw it because the leaves were dark and the
  drum is read from 40 m. When you skip bays in a `glassBand` run, say out loud
  what fills the rest of the opening.
- **`deckPlate` is a ribbed treadplate.** It is the obvious slot for anything
  called "floor" and it is wrong for every civic room: in raking sun through a
  curtain wall a hall floored in it reads as a gantry. `cast` (castMineral) is
  the poured-floor slot. Same for a porch slab.
- **A 16 mm floor finish has nowhere to put a recess.** The Commons finish was
  `Z_FLOOR .. Z_FLOOR + 0.016`; a recessed matting well drove straight through
  the structural slab and produced 3.65 m² of coplanar same-facing floor — the
  single largest defect in the building. Finish thickness is a STRUCTURAL
  decision: `Z_SCREED = Z_FLOOR − 0.06` gives 76 mm and every recessed inlay
  then fits. Check the finish depth before authoring anything that sinks into it.
- **`tubeAlong` frames its profile PERPENDICULAR TO THE PATH.** On a stair's
  30° rake that leans the whole balustrade back half a metre — the top edge ends
  up over a different tread from its foot, its guard height is `h·cos(pitch)`
  instead of `h`, and it crosses its own capping rail. Sweep only things that
  really are normal to the run (handrails); `loft` VERTICAL rings for anything
  that must stand up. Same trap applies to any sloping guard, kerb or fascia.
- **A helical stair wants ONE SOLID BLOCK PER STEP.** A level tread bearing on
  a raking stringer is off by half a riser across a single tread, so it either
  floats above the stringer or drives into it — there is no offset that works.
  Cast block (carcass) + a tread plate floating on a 4 mm shadow gap is both the
  real detail and the only version with no cross-slot contact. Consecutive
  blocks must OVERLAP by ~1 mrad, never butt: same slot makes the overlap a
  weld, while an exact shared radial plane is a defect at both passes.
  Corollary: put the balustrade in the STEPS' slot. A raking blade crosses every
  tread's leading edge, so any other slot is a guaranteed clash on all 28 of
  them, and lifting it clear leaves a stepped gap under a continuous ribbon.
- **The tread plate must stop where the next block's nosing starts.** Running it
  the full block width buries its leading 26 mm inside the step above — a
  cross-slot clash on every tread, and completely invisible.
- Two railing runs meeting at a corner are TWO PARTS AT ONE PLACE (defect family
  #1): duplicate posts AND a 0.22 × 0.22 same-facing patch where the upstands
  overlap. Either sweep the whole perimeter as one path, or hold each run clear
  of the other's upstand width (here 4 mm past r ± 0.11).
- **A drum's collider is a wall, not a cylinder.** Rapier has no annulus and no
  hollow cylinder, so an enterable round building is an n-gon of chord cuboids
  with local +X on the tangent (`yaw = atan2(−cos φ, −sin φ)`; local +X on the
  RADIAL is `yaw = −φ`). Pad each chord ~0.1 m so consecutive boxes overlap —
  a needle seam is exactly the width a capsule finds. Same for an annular
  gallery floor (24 segments puts the inner 24-gon's vertices 60 mm outside the
  true void edge, i.e. under the upstand, i.e. unreachable).
- **The 30 mm scaled clash tolerance means every deliberate 4 mm reveal reports
  as a clash**, at 513 crossings (the cap). Do not chase them. `zfight` is the
  gate; a clash list made only of known reveals is a pass.
- Two solids whose radial END CAPS lie in one plane make the clash test
  ambiguous and report hundreds of crossings even though they are 4 mm apart
  everywhere else. Stagger the ends by a few mrad (cove strips inside their
  trims, divider channels inside their fields).
- **Check the OTHER agent's objects before placing yours.** A directory totem
  landed 91 mm from an entrance planter that had been in the file for weeks; the
  audit found it as a 1077 cm² cast × dark pair. Coordinates in one file are not
  a claim on the space.
- A closed-loop `tubeAlong` whose U-turn legs are closer together than the
  section is wide sweeps straight through itself — 14.6 cm² per chair, ×40. The
  chair frame is now ONE OPEN sled-base run, capped. Check every `closePath:
  true` for a fold narrower than the profile.
- Headless gate for a whole district in ~1.5 s, no browser (recipe now proven a
  third time): `node --experimental-strip-types` + the `registerHooks` `.ts`
  resolver + a `document.createElement` stub whose 2D context is a Proxy that
  returns ITSELF from every method (so `createLinearGradient().addColorStop()`
  chains — a stub returning a plain object dies inside `leafTextures`). Subclass
  `PartWriter` and route every `raw()` into its own named mesh for per-part
  naming, then print each hit's bbox in the BUILDING's local (r, angle, z) —
  that is the only frame the source is written in, and it turns "p907 × p883"
  into a line number in seconds.
- To measure a triangle DELTA without touching git state: `git show
  HEAD:src/.../x.ts` into the scratchpad, sed the relative imports to absolute
  `src/` paths, sed `.ts` onto them (the resolve hook only fixes `./` forms),
  and build both. Commons: 158.8 k → 189.0 k.

## Plinths/monoliths — one loft can carry batter AND sunk panels

- **Author the plan, don't offset it.** A level loft whose rings come from
  `plan(o, panel)` — a hand-walked rounded rect where `o` moves the four face
  lines (corner CENTRES stay put, so the radius follows) — carries a battered
  die, a set-back toe, a cyma base, a cornice with a drip groove AND a sunk
  fielded panel on all four faces as ONE part. `polyOffset` cannot do the
  panel at all (it is per-face), and it collapses the corner arcs near `r`.
  Give every run six stations: arc end, shoulder, field, field, shoulder, arc
  end, and swap the two field stations' depth per level. First Tree's
  dedication plinth: 23 levels × 44 points = 2020 tris for the whole casting.
- **A field/hollow depth of exactly 0 is a defect.** It puts four collinear
  points on the run, and a CAPPED ring then ear-clips into zero-area
  triangles (`triangulateFace` → `ShapeUtils`). Flat levels carry a 2 mm
  hollow instead (shoulder 1 mm, field 2 mm) — invisible, and it also
  guarantees no face of the casting is ever dead flat.
- **Panel edges must splay steeper than the smooth angle or they read as a
  dish.** A 22 mm-deep field with a 30 mm return splays at 36°, which smooths
  straight into the face at `SMOOTH.cast` (38). 18 mm in plan and 22 mm in
  section → 51°/47° and both edges crease. Check the splay angle against the
  part's smooth angle every time, in BOTH plan and section.
- **A part that must sit on a battered or canted face belongs in a face
  frame.** Author it flat in XY extruded along +Z, then one `rotX`: `rotX(β −
  π/2)` sends face +Z to a wall normal tipped up by the batter β, and
  `rotX(θ)` sends it to a top canted by θ. Both are pure rotations (no
  `recalcNormals`); the mirror that keeps "up" up is not.
- **A canted plate needs `rotation.order = 'YXZ'`.** `set(θ − π/2,
  plateYaw(fx,fz), 0)` lays a `PlaneGeometry` on a surface canted by θ toward
  `(fx,fz)`, and `set(−β, plateYaw(fx,fz), 0)` leans one back by β on a
  battered wall. Both reduce to this file's existing flat/upright conventions
  at 0. With the default XYZ order the X term is applied in WORLD space and
  tips the plate toward world +Z regardless of its yaw.
- Keep a whole monument in ONE slot and let the applied parts (bezels, bosses,
  the canted desk) bed 4–12 mm INTO their host. Same-slot buries weld; the
  alternative — landing them on the host's face — is coplanar either way.

## Park-wide signage audit (2026-08-10) — the squash/float defect class

- **`tools/signage-audit.mjs` is the gate for anything with text on it.** Same
  headless recipe as `amenity-audit.mjs`, plus two things worth reusing: the
  2D-context stub is a Proxy that returns ITSELF from every method but a NUMBER
  from `width`-ish reads (so `createLinearGradient().addColorStop()` chains AND
  `measureText(s).width` works — returning a plain object dies in `commons.ts`,
  returning only functions dies in `leafTextures`); and every sign's canvas
  dimensions are read straight off `material.map.image`, because the builders
  assign `canvas.width/height` onto the stub. Canvas aspect vs mesh aspect then
  falls out mechanically for every plate in the park in ~2 s.
- **Raycast the FOUR BOSS CORNERS, not the plate centre.** The centre ray lies
  about mounting in both directions: the works viewing-bay plaques look "buried
  41 mm" at the centre (they are hung on a guardrail mid-rail the corner rays
  pass above and below — fine, leave them), while the big hall sign looks
  uniformly mounted at the centre and its corners straddle the clerestory sill
  with hosts 89 mm and 181 mm back. Also probe DOWN on the leg plane (21 mm
  behind `at`, starting 60 mm under the plate) — a downward ray on the face
  plane just hits the sign's own backing plate and reads 0.03 for everything.
- **`stencilSign`'s geometry along the facing axis, from `at`:** bosses
  −0.035…+0.035, backing plate +0.010…+0.060, printed face +0.063. The
  REARMOST part is the bosses, so `at` must sit 35 mm proud of the host — not
  on it. It now takes `standoff` (distance back to the host; emits four studs
  that lap 10 mm INTO it), `legSpread`, and `ink`.
- **Two different `aspect` parameters mean opposite things.**
  `materials/library.ts signageMaterial` takes **w/h**; `commons.ts
  signFaceMaterial` takes **h/w**. Copying a number between them inverts it.
- **`signBox` RETURNS the face it actually built — never re-derive the arc from
  the angles you passed in.** It eats `jamb + 0.004` at each end (0.03 rad
  total), so hydroTower's "17° × r 7.2 = 2.14 m" comment was wrong by 10 % and
  the hard-coded 0.52 squashed the supergraphic 12 %; the Commons fascia was
  8 % off the same way. Both now compute
  `(z1 - z0) / ((a1 - a0) * radius)` from the returned face.
- **A flat plate on a drum is a CHORD.** At r 7.88 a 1.94 m fascia's ends
  recede 60 mm — past the tray's own inner face, so 42 % of the plate was
  inside the tray (48 % at the clinic's tighter radius). Fix: bend the
  POSITIONS onto the drum and leave the UVs alone. That is exactly an unrolled
  cylinder, so the type still reads true, and it stands 20 mm proud all across.
- **A two-sided directional sign needs TWO TILES, not a mirror flag.** The two
  broad faces of a finger board have opposite right-vectors, so the chevron
  drawn at u 0.8–0.95 pointed at the TIP on one face and back at the POST on
  the other — half of every fingerboard in the park pointed the wrong way.
  Mirroring the tile would fix the arrow and reverse the text; `SignArt` now
  carries `arrowLeft` and registers `finger-X-l` / `finger-X-r`.
- **Derive a decal canvas from its plate, never assume.** `chassis.ts` had one
  256×128 canvas on plates of aspect 2.64–3.06 (32–53 % stretch on every
  machine); `tramMaterials.ts` had a SQUARE canvas on a 1.736 patch (74 %, the
  worst in the project). `decalPlate(draw, w, h)` now builds texture and mesh
  together so they cannot drift, and every layout is expressed as a FRACTION of
  the canvas — which makes the world result invariant, so the painted eyes keep
  the proportions they were authored with.
- **A light plate needs dark ink AND a dark border.** The water tower's
  `#e6e0d4` ground took the default `#efe9dc` ink: 1.08:1 contrast, invisible.
  `signageMaterial`'s border is now the ink at 0.25 alpha rather than a
  hard-coded pale grey (identical pixel for the default cream ink).

## Geometry-fit audit sweep (2026-08-10) — instrument traps and five defect causes

- **THE SHIPPED GATE DOES NOT SEE THE TRAM.** `audit.ts`'s `DEFAULT_BOUNDS` is
  radius 260 about the origin, and the cars park on the arrival spur at
  z ~ +415 (r > 400). Every tram defect is invisible to a default
  `window.__elysium.audit()`. Audit the vehicle with explicit
  `bounds: {centerX, centerZ, radius: 8}` around a car, or headlessly (below).
- **The default audit is also TRUNCATED.** `maxTriangles` defaults to 600 000
  and the park emits ~3.9 M, so a bare `audit()` compares the first 15 % of the
  scene in traversal order and reports a clean-looking 3 rows. Pass
  `maxTriangles: 6_000_000`. Also pass `skip: (m,n) => n.includes('dome:glass')`
  — the dome's two glass shells are a deliberate double surface and they
  register 659 M cm² across 31 800 pairs, which buries everything else.
- **`ANG = 0.0025` is a normal-DOT, i.e. ~4 degrees, not the 0.13 degrees the
  comment claims.** This matters: any applied moulding that *fairs into* its
  host crosses the host's plane at a shallow angle, and a 3 degree taper stays
  inside the tolerance for the whole ~50 mm either side of the crossing. **A
  moulding may taper, but it must never reach zero standoff** — clamp the fade
  so the proud face keeps >= 2x the 1.5 mm DIST (3 mm is comfortable).
- **Never sample an applied part COARSER than the surface it lies on.** A decal
  or band 3 mm proud of a curved hull, lofted over fewer stations than the
  hull's own grid, chords straight through its standoff — the sag goes as the
  square of the step. The tram wordmark (2 section intervals across the
  tumblehome's widest point) and the livery band (0.24 m stations through the
  nose taper, where the bodyside pulls in 50 mm per station) both did this.
  Refine the applied part's grid; do not thicken the standoff.
- **`apertureShell` closes EVERY grid boundary with a reveal ribbon**, not just
  aperture edges (`solid()` returns false off the grid). `doorLeaf` bridged its
  four edges again on top of that — 0.26 m² of z-fight per leaf, the identical
  bug `buildEnd` §1 already documents for the nose/tail. If you need different
  slots on different edges, route them through `revealSlot(i, j)`; never build
  the ribbon yourself.
- **A wall whose two skins meet at the same height makes every aperture reveal
  coplanar with the floor.** The tram's `outer[SILL_R]` and `inner[SILL_R]` were
  both at y = 0, so the door threshold reveal lay IN the cabin floor plane, and
  the door-bay recess then pulled the inner point inboard of the floor's own
  j = 8/9 points so the reveal doubled back across it (349 cm² per car). Lifting
  the outer sill 6 mm tilts the reveal 6.2 degrees — outside the ~4 degree
  tolerance — and a threshold proud of the floor is the correct detail anyway.
  Generally: check that a section's inner loop is MONOTONIC through any index
  where a recess is ramped in, or the surface folds.
- **Defect family #1 again, and it was the park's biggest single z-fight:**
  `emitFloorLights` snapped each 7 m target to the NEAREST boundary station, so
  wherever stations were sparser than the spacing several targets collapsed onto
  one station and stamped the fixture twice — 70 duplicated lights, 12.19 m² of
  coincident bezel + 1.08 m² of coincident lens (73 m² and 6.4 m² of reported
  z-fight). Guard on the EMITTED POSITION, not on the index: one `emitted[]`
  list plus a distance test kills every cause at once. **Any "snap to nearest"
  placement loop needs this guard.**
- Cheap detector for that whole family, worth running before anything else:
  quantise every triangle centroid to 0.5 mm and count collisions per merged
  mesh. 2 520 of pathLightBezel's 8 604 triangles were exact duplicates — it
  names the defect in one pass, with no coplanar maths at all.
- **`auditGeometry`'s `at` is useless on an aggregate** (already noted for
  farmside; re-confirmed). `part:dark`'s 51 m² reported at a point that holds
  34 cm². Cluster the hits by position instead — see below.
- **Headless per-slot cluster harness (reload-proof, and the only thing that
  worked).** With several agents editing `src/`, vite full-reloads every few
  seconds and any in-page eval longer than ~10 s dies with "Inspected target
  navigated or closed". `node --experimental-strip-types` + the `registerHooks`
  `.ts` resolver + a `document.createElement` stub whose 2-D context Proxy
  returns ITSELF, then `import('file:///…/src/world/paving.ts')` and call
  `buildPaving()` / `buildTramCar()` directly. Run the audit's own plane-grid +
  Sutherland-Hodgman clip over the result but BUCKET THE HITS BY POSITION
  (5 m cells) — that turns "56 m² somewhere" into "52 m² in a 15 degree wedge at
  r 89-104, bearing 202-217". Import by absolute `file://` URL; a relative path
  from the scratchpad resolves against `/private` and fails.
- **Two crude shortcuts that produce false positives** (both cost me a probe):
  a bbox-overlap test instead of the true clipped area flags every pair of
  edge-sharing neighbours in a fan or a grid; and a centroid-distance filter
  flags parts that are merely near each other. Use the real clip.
- FIXED (see "Paving: clip, never project" below): `ground:paving` self-overlap
  was 1 450 367 cm² of same-slot z-fight, now 13 cm².

## Paving: clip, never project — and prove the floor with a raster

- **A per-vertex PROJECTION can never trim a surface.** Projection is
  many-to-one: it collapses a cell's whole area onto the neighbour's boundary
  CURVE, so two adjacent cells that both project land on top of each other.
  That, not the "quad straddling two pours" case, was the bulk of the park's
  largest z-fight (145 m², one slot, 3 482 pairs). Replace it with a real CLIP:
  marching squares over a signed "does anything outrank me here" field, per
  parametric cell. Cells inside vanish, cells outside are untouched, crossed
  cells are cut on the boundary. Adjacent cells bisect the SAME shared edge, so
  the cut is watertight with no welding step.
- **Nine samples per cell, not four.** Four corners decide the topology; the
  four EDGE MIDPOINTS catch a boundary that enters and leaves through one edge,
  and the CENTRE catches a notch between two pours inside an apparently-covered
  cell. Anything inconsistent subdivides (depth 4 was ample). Also subdivide
  when the two cut points sit on DIFFERENT neighbours — a straight chord
  between them slices off the wedge where those two pours cross, which is a
  hole at every triple junction (1.4 m² of them here).
- **Trim against the neighbour's MESH, not against the plan.** A curved region
  emits an inscribed polygon; cutting on the plan's ideal circle leaves a
  crescent of bare regolith up to the tessellation's sagitta (27 mm at an
  apron). Measure the trim field against the polygon actually emitted, and
  thread that polygon's own vertices into the cut (`footprintWalk`) so both
  surfaces share one edge. Corollary: a neighbour's footprint is what its mesh
  covers, not what its plan says — the tram channel's mesh includes its
  chamfered lips, and paving that stopped at the plan buried the arris under
  90 mm of overhanging slab.
- **Two rings of a lathe-like surface at different angular counts do not meet.**
  Concentric bands each sized for near-square panels met as two inscribed
  polygons on the SAME circle with different sagittas: a 67 mm slot of open
  regolith at the plaza's r = 6.5 seam, ~20 m² park-wide, shipped and invisible
  to every z-fight gate (gaps are not overlaps). Use ONE angular step for the
  whole surface and keep the panel count in the shader coordinate only — joints
  are drawn from `uv`, so the pattern is unchanged and the seams share vertices.
  Cost was ~2 k triangles. **Any banded/LOD-ringed surface has this bug.**
- **Prove it by raster** (`tools/paving-coverage.mjs`, the glasshouse-pane
  method applied to a floor): grid the union of the plan, count covering
  triangles per sample, 0 = hole, >1 = z-fight, 1 = correct. 67.13 m² of hole
  and 285.19 m² of double coverage before; 0.07 and 0.00 after, over 13 084 m².
  The raster found holes no overlap gate could — including a 9 m² one at the
  plaza centre, where the pole cell's two coincident corners made
  `GroundWriter.face` compute a zero-length normal and drop the face outright.
- **Also check WINDING in the harness.** An inside-out cell is invisible AND a
  z-fight, and `auditGeometry` structurally cannot see it: it flips each
  triangle's geometric normal to agree with the vertex attribute, which is
  authored upward whatever the winding says. Two appeared here, both from a
  cut point and a threaded boundary vertex landing ~9 mm apart: the resulting
  sliver gives `face()` a meaningless normal, ear-clipping fails, and its FAN
  FALLBACK folds a triangle inside out. Drop threaded vertices that land within
  ~20 mm of a cut; they correct microns and cost a degenerate ring.
- **An unmitred 90° corner in a swept run folds the casting through itself.**
  The planter beds ran their outer arc straight into the end wall (and at the
  inner corner even shared a station, rotating 90° over ZERO travel): 4.3 m² of
  concrete-on-concrete. `rectBoundary` had the mitre but still pushed an edge's
  i = 0 station ON the corner the mitre station already occupied — same fold,
  0.26 m² per corner. Rule: a mitre station REPLACES the corner, runs carry
  interior stations only, and no station may repeat a position. Neat identity:
  for a 90° turn the correctly widened outward vector is just the UNNORMALISED
  sum of the two edge normals (|r̂ ± θ̂| = √2 = 1/cos 45°).
- **`boundaryOpen`-style probes need two reaches.** A single 0.34 m probe steps
  clean OVER a neighbouring pour that ends just outside the line: the station
  terrace's south edge is tangent to the boulevard's inner circle and 0.14 m
  inside it a few metres along, so both pours kerbed the same junction and the
  two castings ran through each other. Probe at a kerb's width as well.
- **An applied part 4 mm above its host is inside the host's own interpolation
  error.** The floor-light housings' trough floor sat at +4 mm; the slab mesh
  chords the terrain between its vertices, so mid-cell the slab rose through it
  (0.11 m² of bezel-on-paving). Deepened to +12 mm — a better reveal anyway.
  Same family as "never sample an applied part coarser than its host".

## W2 works — the machine hall's plaza elevation (facade articulation)

- **"Flat white shed" is almost never an albedo bug.** The hall already had
  real trapezoidal sheeting on both plaza-facing elevations; the failure was
  that it had detail at 0.34 m (rib pitch, sub-pixel at 75 m) and at 26 m
  (the massing) and NOTHING in between. Measured park albedo ladder before
  touching anything: `paintedSteel` 0.79–0.815 · `habShell` 0.73–0.79 ·
  `wornEdgeSteel` 0.65–0.78 · `bareAluminum` 0.57–0.64 · `castMineral`
  0.44–0.50 · `darkSteel` 0.20. White painted cladding belongs at the top of
  that ladder — `steel` is NOT off-ladder, and darkening a park-wide slot to
  fix one elevation would have repainted every district.
- **Which faces the plaza actually sees is a dot product, not a compass.**
  Direction hall→plaza is `normalize(PLAZA − HALL)`; dot it with each face
  normal. For `WORKS.machineHall` (48, −58, ψ 0.35) that is ACROSS-minus at
  30° off (the primary face, already the "money facade") and ALONG-plus gable
  at 60°. The gable was the bare one: one `run(−7.44, 7.44, 0.02, null)`,
  130 m² with no opening, no fastener row, no datum line at all.
- **Applied trim in ONE slot is the cheapest way to stay clean.** Plinth,
  coping, string course, pilasters and panel ribs all go to `cast`: same-slot
  parts merge into one mesh so the clash pass never tests them, which is what
  lets a pilaster run THROUGH the plinth and a wind post THROUGH the string
  course instead of being chopped at every crossing. Cross-slot clearance to
  the sheeting/services is ≥6 mm everywhere.
- **Same-slot still has to dodge the COPLANAR pass.** Two same-slot parts that
  share a back plane over an overlapping area are a `zfight` pair even though
  they never `clash`. Give every trim family its own back and front plane 4 mm
  apart (plinth 0.048/0.066, rib 0.062/0.078, pilaster 0.052/0.074, band
  0.056/0.086). Cheap, and it makes the family self-documenting.
- **Over-clad, do not re-cut.** The first design split the sheet runs so the
  plinth replaced them; that instantly opens a 2.4 m hole wherever the plinth
  is interrupted (HVAC sets, door jambs) because the split is by RUN and the
  interruption is by FIXTURE. Standing the trim on the sheeting crests costs
  ~1 k hidden triangles behind 40 m of plinth and removes the whole class of
  bug. The stop ends then correctly show the sheeting continuing behind.
- **The gap list is the real work, and it comes from the fixtures' own
  constants**, not from eyeballing: door THRESHOLD plates run wider than their
  jambs (roll-up 0.19–4.09 vs jambs 0.26–4.02), a roll-up door's HEAD BEAM is
  `dw + 0.44` so a band at 4.9 m must clear ±0.24 not ±0.17, and the reclaimer's
  pipe escutcheon lands on the ALONG-plus gable at c 2.4 × 620 mm, top 4.9.
  `trimSpans(u0, u1, gaps, min)` subtracts them and DROPS spans under 450 mm —
  the roll-up door's gap and the HVAC set beside it would otherwise leave a
  130 mm stub of coping, which reads worse than the gap.
- **The cable tray at h 5.55 has its inner edge only 8 mm off the sheeting
  crest**, so ANY vertical applied member thicker than 8 mm crossing the park
  wall above 5.4 m clashes with it. That, not composition, is why the long
  wall's column covers die 12 mm under the 4.9 m string course while the
  gable's wind posts run on to the eaves datum.
- Rhythm derivation that held up: `BAY_PITCH` from `FRAME_A`'s ends over its
  count (4.2833); posts on the INTERIOR stations only (the end frames are
  already expressed by the corner angles, and a cover there interpenetrates
  them); the gable re-divides its own span by the same bay
  (`round(15 / 4.2833) = 4` → posts at −3.75/0/+3.75); panel ribs on the
  half-bay midpoints so they can never drift off the pilasters.

## Experience audit (2026-08-10, late) — probing recipe + interaction defects

- **`loop.renderFrame = () => {}` is the single biggest probing win.** `step(n)`
  renders a full WebGPU frame per call; with the render callback nulled, 300
  steps take **35 ms instead of ~9 s** (~250x). Camera pose, physics, DOM
  captions and every system's `update` still run, so nothing you actually
  measure is lost. Restore it (keep a handle first) only if you need pixels.
  This also stops the tab dying: driving hundreds of real frames while other
  agents hold their own tabs open is what gets the renderer discarded.
- **Wrap every probe in a boot-wait promise and stash the harness in
  `localStorage`.** `javascript_tool` DOES await a returned promise, so
  `new Promise(res => setInterval(check, 400))` is the reliable pattern; a
  bare `window.__aud` dies on every reload. Re-`eval` a stored source string
  instead of retyping the harness.
- **Do NOT `import()` three from `/node_modules/.vite/deps/...`.** It triggers
  a Vite dep re-optimize (504 "Outdated Optimize Dep") and a full reload loop,
  and the second copy's `Sprite.raycast` throws on the app's objects. Physics
  ray/shape queries answer every geometric question a mesh raycast would, and
  a scene-wide mesh ray costs ~330 ms anyway (no BVH).
- `ReferenceError: <helper> is not defined` at boot (`buildPlazaElevation`,
  `earClip`) while the symbol IS defined on disk = a **stale partial HMR module
  graph**, not a real break. `navigate(force: true)` fixes it; do not "fix" the
  other agent's file.
- **Rapier `halfExtents()` is the box's LOCAL half-size; read `rotation()`
  separately.** Reasoning about a rotated collider as an AABB will put you on
  the wrong side of a door — it made the ops console read as a 0.76 m step at
  the threshold when the console is simply 0.4 m inside the room.
- **`stand()` steps BACKWARD.** Look-forward in this engine is
  `(-sin yaw, 0, -cos yaw)` (see `fixedUpdate`'s desiredX/Z and the YXZ camera);
  `stand()` uses `(+sin, +cos)`. Swept over all 114 seat interactables the
  actual exit lands inside a collider on 56 of them — but the FORWARD point is
  blocked on 71, and 47 are blocked BOTH ways, so a sign flip is not the fix.
  Any exit-point change has to be a clearance search, not a constant.
- **A stop gate must be compared against one frame of travel.** The tram's
  `distance < 0.02 && speed < 0.2` cannot fire: the approach profile
  `sqrt(2·ACCEL·d) + 0.12` has a creep floor, so speed only drops under
  0.2 m/s inside the last 3.05 mm while a frame advances 3.33 mm. 0/200
  sub-frame phases captured. Gate on `distance <= speed·dt` instead.
- **Seated look is world-locked**: the seat branch clamps yaw to a cone but
  never carries it with the seat, so a curving vehicle rotates the cabin under
  a fixed head (measured 0.000 deg/frame camera rotation through a turn, relYaw
  drifting to the −77.35 deg cone limit and pinning). Any future rig that
  moves AND turns needs the seat's yaw delta added to the player's yaw first.
- Interior AUDIO zones are an allow-list of two boxes (Overlook lounge +
  `glasshouses[1]`). Everything else — the other two walk-in glasshouses, the
  Commons, the hab, ops — reads `park`, and the hab floor reports `regolith`
  footsteps. If you make a room enterable, add it to `classifyZone` in the same
  commit, and make the test oriented: the glasshouse one is only correct
  because that rotation happens to be exactly pi/2.
- **A sign that spans a band change needs a SUBFRAME, not a standoff.** The
  hall facade plate covers the clerestory, so its four corners sit over three
  different hosts (sheeting crest 7.542, sheeting valley 7.499, glazing frame
  7.475) and no single stud length fits any two of them. It is now carried by
  two vertical outriggers on the MULLION LINES — and the mullion grid, not the
  sign, picks their positions (`-12.6 + i*2.1` gives only -8.4 and -4.2 inside
  the plate's span, so the frame is deliberately asymmetric about the sign's
  own centre). Panes are 120 mm narrower than their bay, so a 100 mm outrigger
  on a mullion clears both neighbouring clear fields by 10 mm. Verified by
  raycasting backward from the plate at the outrigger offsets AND at the
  centre: hits at 0.042/0.159 on the outrigger lines, and nothing at all
  between the sign and the glazing anywhere else.
- **Staggering is not optional on an applied frame.** The first cut butted the
  mullion tie-back on the outrigger's own 7.535 back plane — 219 cm2 of
  `steelEdge x steel` z-fight, caught by `archkit/audit.ts`, invisible to the
  eye. Every plane in that frame is now unique (outrigger 7.535/7.652, rail
  7.528/7.606, tie-back 7.470/7.555), each lapping its neighbour 5-20 mm.
- **Get a BASELINE before blaming yourself (or clearing yourself).** Building
  `git show HEAD:...works.ts` against current dependencies gave zfight 1; the
  live tree gave 3. That instantly separated my one real defect from a
  pre-existing yard pair and from another agent's new `cast` plinth. Recipe
  needs BOTH seds: rewrite `../`-style specifiers to absolute AND append `.ts`
  (the resolve hook only fixes `./` forms).
- `CREST_T` / `CREST_PITCH` / `WALL_YAW` are now module-scope in `works.ts` —
  anything bolted through the hall's sheeting reads crest positions from them
  instead of re-deriving the rib phase.
- **The stack rule applies to UNDERSIDES, not just tops.** The note above says
  no two members of a stack may end at the same HEIGHT; the plaza elevation's
  trim proved the same is true downward. `buildPlazaElevation`'s plinth sections
  and its `castPost` column covers both started at h = 0.02 above FLOOR, and the
  covers lap the plinth by ~22 mm of depth — so their two DOWNWARD faces shared
  one plane, 7 same-facing pairs / 458 cm². Starting the post 6 mm lower (0.014)
  cleared it, welds because both are 'cast', and still keeps 14 mm of reveal at
  the pour so nothing lands on the apron's plane either. **Whenever two applied
  trim families stand on one datum, offset their bases as deliberately as their
  heads.**
- Per-PART localisation of a district defect, in ~2 s and no browser: most
  district sub-builders destructure only `writer` from `DistrictServices`, so
  `buildPlazaElevation({ writer })` runs standalone. Every emit funnels through
  `PartWriter.raw`, so `class NamedWriter extends PartWriter { raw(slot, ...a) {
  super.raw(`p${this.n++}:${slot}`, ...a) } }` plus a Proxy material map turns
  `part:cast :: part:cast` into `p001 :: p007` with both bounding boxes — which
  names the two source functions immediately.

## Traversal audit (2026-08-11) — the collider-frame bug family, park-wide

- **The collider yaw convention, stated once so nobody re-derives it wrong.**
  Every box collider spec (`parkAssembly`, `groundworks`, `doors`,
  `portalStation`, `track`) builds its rotation as a pure +Y quaternion, which
  sends local **+X → (cos θ, −sin θ)** and local **+Z → (sin θ, cos θ)**.
  Therefore, for a box on an arc at plan angle φ:
  - local +X on the **RADIAL**  → `yaw = −φ`
  - local +X on the **TANGENT** → `yaw = atan2(−cos φ, −sin φ)` (= π/2 − φ)
  - local +Z on a direction `d` → `yaw = atan2(d.x, d.z)`  (this is `yawAlong`)
  `Math.atan2(Math.cos(φ), -Math.sin(φ))` is **φ + π/2** — it is NEITHER, and it
  was copy-pasted into two planter builders. Its signature failure is that the
  box's true axis *rotates with φ*: correct at the diagonals, 90° wrong at
  φ = 0, ±π/2, ±π. If you see a ring of colliders that blocks in some places and
  leaks in others, this is it. Fixed in `paving.emitPlanters` and
  `planting.ts`'s tree-pit ring (both now `-mid`).
- **`yawAlong(d)` puts the size's Z on `d`, not its X.** `track.ts` and
  `portalStation.ts` built the station DECKS and END FLIGHTS on
  `platformOutward` while sizing them `(depth, h, arcLength/6)` — so the three
  deck boxes, whose CENTRES march along the arc, were each `depth` long
  *along the arc* and `arcLength/3` deep. Result: a fall-through hole at both
  seams of every arc platform (measured 0.6 m at Overlook, 1.0 m at Farmside)
  and a deck of the wrong depth. The tell is arithmetic, not visual: **if N
  boxes tile a run by stepping `L/N` along an axis, their half-extent on that
  same axis must be `L/2N`** — check which extent the yaw actually puts there.
  The access RAMPs were already on `platformTangent` and were the correct
  reference all along.
- **Autostep needs 1.8 + 0.42 = 2.22 m of clear height, not 1.8.** Rapier's
  autostep lifts the whole capsule by `maxHeight` before casting forward, so a
  soffit that clears a standing player still kills the climb. The Commons
  helical stair passes under the gallery deck (soffit y 5.33) and the player
  stops dead at the tread where `feet + 0.42 + 1.8` reaches it — proved by
  disabling the 26 gallery slabs at runtime, after which the same climb went
  from y 3.06 to 4.57. **Any stair running under a deck needs ≥ 2.25 m clear,
  and the free-height check must be made against the collider soffit.**
- **Probing recipes that were wrong, and the ones that replaced them.**
  (1) An obstruction map built at `interiorHeight + 1.125` reports the whole
  amphitheater bowl and every raised floor as solid, because the walk surface is
  the seat tiers / deck, not the dish. Build the map on a **downward ray from
  `ground + 3`** (the true standable surface) and probe the capsule there.
  (2) A "mesh in the walk band" grid must be rasterised **per triangle** against
  the band; taking a cell's min/max over all meshes makes every building with a
  roof and a slab look like a solid wall at head height.
  (3) `vegetation-hardscape/*` and `paving/ground:concrete|plantSoil` ARE the
  planter masonry — excluding them by a `/vegetation|ground:/` skip regex turns
  every planter collider into a false "phantom".
- **An automatic phantom/walk-through test that is worth keeping**: score every
  box collider's footprint against a 0.5 m solid-mesh occupancy grid, then
  re-score it with `he.x`/`he.z` swapped. Anything where the swap scores > 0.2
  better is an axis bug. Over 864 boxes it flagged 16, of which the real ones
  were the yard task board (`works.ts`, size authored in the yard's own (u, v)
  order but `yv` maps u→Z, v→X) and the portal windbreak.
- **The tab reloads under you.** Vite HMR from other agents' saves wipes all
  `window` state mid-audit, and a multi-million-entry triangle hash will OOM the
  renderer on its own. Keep the whole probing toolkit in `localStorage` and
  re-`eval` + re-`__init()` at the top of every call — a full re-bootstrap
  (collider snapshot, builder attribution, ground grid, obstruction map) is ~2 s.
- **Attribute colliders to their builder by HANDLE ORDER, not position.**
  `world.forEachCollider` returns parkAssembly's body in creation order, which
  is exactly `services.colliders` order, so `sort((a,b)=>a.hi-b.hi)[i]` is spec
  `i` and the district ranges fall out of re-running the builders into a throw-
  away `services`. Matching by rounded centre silently mis-attributes ~13 % of
  them because `ctx.rng.fork` does not replay identically after boot.

## Traversal — the two rapier rules that decide whether a stair works

Found the hard way when the Commons gallery turned out to be unreachable on
foot despite the geometry auditing clean. Both are properties of the CHARACTER
CONTROLLER, invisible to `auditGeometry`, and neither is about the mesh.

- **Headroom over a stair is `capsule + autostep`, not `capsule`.** Rapier's
  autostep lifts the capsule by `maxHeight` BEFORE casting forward, so our
  1.8 m capsule with `enableAutostep(0.42, 0.28, true)` needs **2.22 m** of
  clear air over EVERY tread. At 2.05 m the player stops dead, silently, with
  nothing visible in the way — it reads exactly like a missing collider.
- **`minWidth` (0.28 m, the second autostep argument) rejects a step whose
  clear top is narrower than it.** On a HELICAL stair the going is `dTheta · r`,
  so it is shortest at the inner stringer: 0.29 m on the walking line was only
  0.26 m at `rIn`, and the flight was climbable in a narrow band and nowhere
  else. Quote the going at the INNER radius, not the walking line.
- **A collider box culled by its CENTRE angle overhangs.** The gallery floor was
  24 chord boxes, each 2.1 m along the tangent and 6.6 m deep, skipped when
  their centre fell in the stairwell. A box is a rectangle: its inner corners
  swing `atan(halfWidth / r)` forward in plan — 9 deg at the stair's radius — so
  the deck roofed the flight 9 deg past where the MESH deck ended. Generate such
  runs from explicit start/end angles and split them radially so each box is
  narrow; never cull by centre. Same trap for any ring collider with a gap.
- **Collider thickness is walkable width.** The stair's balustrade colliders were
  0.14 m thick against 0.048 m blades, eating 46 mm of going per side and
  squeezing the corridor to 1.18 m against a 0.70 m capsule. Any drift off the
  walking line pinned the player against a railing. Match a railing's collider
  to its blade and keep ≥0.6 m of lateral play for the capsule.
- **Mechanical traversal gates are cheap and belong next to the geometry audit.**
  Two loops over `services.colliders` — (1) lowest box soffit over each tread vs
  `capsule + autostep`, (2) widest run of capsule-centre radii across each tread
  that clears every box spanning the walker's height band — turn "the stair
  feels stuck" into "tread 15 at 151.6 deg has 1.98 m". Skip boxes whose top is
  within autostep of the tread: those are the next STEP, not a wall (getting
  that wrong reports zero corridor everywhere).
- Probing a stall in the live page: `world.castRay` straight up from the capsule
  returning `null` proves it is not headroom; a forward ray returning
  `timeOfImpact 0` means the origin is INSIDE a collider. Then sweep the real
  controller across radii (`placeAt` at r = 6.95…7.95 on the same tread, drive
  W for 25 frames, record dy) — a stall that depends on RADIUS is a corridor
  problem, one that depends on TREAD NUMBER is a headroom problem.

## P-wave closing status (2026-08-11)

Final full-scene audit (6 M-triangle cap, no truncation): 25 pairs. Excluding
the dome's DELIBERATE two-surface glass (glass-inner :: glass-outer — skip it
in any future audit read), the remaining tail is ~66 m², all pre-existing and
ledgered: part:dark :: part:dark ~51 m² (diffuse, needs per-part harness
sweeps — the top open follow-up), part:cast :: ground:channel ~11 m²,
ground:regolith :: part:cast ~2.4 m². Every class targeted this session is at
or near zero: paving self-overlap 145 m² → 13 cm² (raster-proof: 581,513
samples covered exactly once), concrete 4.3 m² → 0, duplicate floor lights
79 m² → 0, tram car → 0, dome → 0, works trim → 0. Perf while compositing:
1200+ fps exterior, ~58 fps inside the fully-dressed Commons on the dev
machine's pane (hidden-pane FPS readings remain meaningless).

## P-wave 3 orchestrator (2026-08-11): rails/turnout, corridor, entry UI

- **Vite HMR is not to be trusted across multi-file cross-module edits.** After
  editing track/pavingPlan/parkPlan together, every boot threw
  `ReferenceError: emitRails is not defined` (and later ARRIVAL_SPINE) from
  STALE transformed modules — with `tsc -b` green. The scene half-builds
  (buildGuideway dies, park continues), which reads as "my geometry silently
  vanished". After any batch of edits spanning import edges: RESTART the dev
  server, then verify. Check the browser console for `Uncaught (in promise)`
  before believing any visual absence.
- **Screenshots can be COMPOSITOR-STALE when the pane is hidden.** Two
  "different" loads returned pixel-identical frames (same FPS overlay text —
  that's the tell). Front the tab (`tabs_select`) and re-shoot; cross-check the
  FPS overlay string changed before drawing conclusions.
- **Raycast probes beat screenshots for geometry truth.** `import three from
  /node_modules/.vite/deps/three.js?v=<hash>`, collect `o.isMesh && !o.isSprite`,
  one downward `Raycaster` per point, list `object.name@y`. Slice enough hits:
  coplanar pairs (corridor floor vs crown) hide the third hit if you slice 2.
  Finding any canvas sign: traverse for `material.map.isCanvasTexture` and read
  boundingSphere centres through `matrixWorld` — no hunting by eye.
- **`player.placeAt` raycasts from the sky** — it will stand you on the dome
  glass. Teleport by `body.setTranslation` + reset previous/currentPosition +
  `setLook`, after clearing seatedPose/exitPose/seatBlend/seatYawCarry when the
  boot ride is involved.
- **The guideway datum anchor is `groundGrade(0, LOOP.radius)`.** slabTop =
  groundGrade + PAVE.rise everywhere; street/crown/channel-floor/corridor all
  derive from the ring value. Field modifiers (the corridor's regolith dip)
  MUST exclude the ring band or every guideway datum sinks together (45 mm).
- **Region-based paving contracts:** a new pour-yielding surface = a region
  (priority > its neighbours) + skip in the pour loop + its own emitter + a
  field decision. The field treats EVERY region as slab for the walkable datum,
  so a region that is actually a recess needs an explicit interiorHeight
  branch; and any region polyline that leaves the existing paved band lifts
  regolith out in the open. March coverage from the CHANNEL end backward — the
  spur also crosses the rim promenade, and a forward scan latches onto it.
- **Blend by signed distance, never by nested boolean margins.** The two-level
  `insideX(m1)/insideX(m2)` blend tore the channel floor into shards (adjacent
  vertices 12 cm apart). Expose the distance and smoothstep it.
- **Sign accent bars:** `signageMaterial` lays the text block first and
  reserves the accent strip under it (heat-rejection finding). Never draw
  plate decorations at fixed canvas offsets.
- **Entry screen (P3 redesign) — SUPERSEDED**, see "Entry screen: SHEET 03"
  at the end of this file. The typographic version (centred ELYSIUM wordmark,
  dome-as-hairline-arc on a glowing horizon, BOARD ghost button) was rejected
  by the owner as landing-page cliche. What still holds from it: keep the
  `createEntryScreen` API stable, and `flags.debug` overlay sits top-left
  above the screen.

## Continuity audit (P-wave 3) — every linear run that was pieced or hung

Owner rejection: tram rails read as "pieced parts" instead of one continuous
curve. Same class hunted across the park's other linear elements. **The rule
that came out of it: a run is ONE sweep between two real terminations, and a
free end is a defect until it dies into a post, a wall, a socket or a flange.**

- **Radiator headers** (`works.ts` buildRadiatorField) — the supply header and
  its expansion loop were two `writer.tube` calls butted at `headerPath[last]`:
  two capped discs at the same point on the same tangent (a coplanar pair AND a
  pieced run), and the supply's start, the loop's tail and BOTH ends of the
  return header were flat caps floating 0.46–3.51 m up. Now one tube per header
  through `filletPath`, ending in a `pipeBlock` at each end.
- **`pipeBlock` / `wallSleeve` (new, `works.ts`)** — the two honest ways for a
  pipe to stop. Both are the guardrail shoe's rule at pipe scale: a skirt or
  plate, a rim, then a bore turned back to a cup floor, so the pipe ends INSIDE
  a socket with a 18–40 mm annular reveal. No burial across slots, no cap in
  air, and no pipe stabbing the regolith. Reach for these before inventing a
  new termination.
- **`filletPath` (new, `works.ts`)** — `writer.tube` frames each station on the
  MEAN of its two edges, so a bare 90 deg vertex creases the section rather
  than bending it. Quadratic-Bezier corners at 1.5 D, clamped to 45 % of the
  shorter neighbour. Its 0.06 rad straight-through cut-off means a fine arc
  (0.4 deg per station) passes untouched — safe to wrap a whole alignment in.
- **Pipe rack wall end** (`works.ts` buildPipeRack) — the four pipes were the
  shared start node plus a `side` offset, and `side` runs 55 deg ACROSS the
  hall wall: the +0.6 pipe ended 0.48 m INSIDE the cladding at 5.4 m, the −0.62
  one hung 0.51 m off it. Each pipe now leaves its OWN sleeve square to the
  wall and fans onto its rack line at the first H-frame. **Never offset a run
  laterally at a node that sits on a wall — offset it at the first support.**
- **Pipe rack far end** — four capped tubes ending in mid-air over the tank
  farm. Now carried 0.45 m past the last H-frame to a `flangePair` blank (a
  flange is a legitimate terminus; a bare cap is not). A riser to grade was
  rejected: the drop lands within 0.22 m of an LNG sphere.
- **Conduit drops** (`works.ts` buildHallServices) — top cap sat at 5.46,
  exactly the cable tray's soffit plane; the bottom stopped 0.13 m above its
  pull box. Tray, drop and box are now ONE slot, so both ends socket in.
- **Gallery stair rails** (`works.ts` buildGallery) — `stairFlight`'s rails are
  bare tube ends. The chain's two FREE ends are the caller's to finish: a newel
  return to a plate at the foot, and a cranked link into the walk guardrail's
  first post (stopping 4 mm off its face, the run's own shadow gap).
- **Overlook roof guardrail** (`leisure.ts`) — rails were sampled at the POST
  pitch (30 equal-arc stations). On a 2:1 ellipse the tightest radius is
  `ax²/az` = 2.71 m, so a 1.52 m chord sagged **106 mm** inside its own curve
  and the rail cut both corners. Sampling now 150 (a multiple of the post
  count, so every post still lands on a station). **Sample a rail from the
  CURVE's tightest radius, never from the post pitch** — and note that equal
  ARC spacing is the worst choice on an ellipse: parameter-uniform spacing
  already bunches stations where the curvature is tight (the parapet's 96-point
  `ellipsePoly` sags only 5 mm for that reason).
- **Slide grab rails** (`leisure.ts`) — began 0.9 m above the deck and stopped
  0.6 m above the chute, capped at both ends. Now one run: a foot buried in the
  deck, a 0.16 m knee onto the grab line (the entry arc leaves t=0 horizontal,
  so it stays tangent-continuous) and a leg landing on the chute's outer
  flange. The chute's own frame decides that landing point:
  `axis + across·0.295 + up·0.13`, where `up` is normal to the chute's slope.
- **Ramp handrail** (`portalStation.ts` accessRamp) — flat capped ends at both
  ends of the ramp, and `dark` stanchions climbing to the `orangeTop` rail's
  AXIS (26 mm of one material inside another). Now a 90 mm turn-down return
  inside each end (the kit handrail's detail), posts stopping 4 mm under the
  soffit, end posts moved in so they carry rail, and post pitch off the run
  (1.6 m). The ramp KERB's two end stations were dropped below the ramp top so
  the run rises out of the pour instead of butting a capped disc on open slab —
  the tram rails' feather, at kerb scale.
- **Bike rack tie rail** (`parkAmenities.ts`) — "ONE ground rail ties every
  foot" ran up the middle at y 0, which is 0.69 m under the crown of every arch
  and touches NOTHING, then overhung both end hoops by 0.16 m into air. Moved
  onto the foot line (y = −HALF) and ended inside the two end legs.

Still open (out of this wave's scope, all verified by reading):
- `archkit/kit.ts` `stairFlight` emits rails and balusters through
  `writer.tube` **without cap flags — and caps default to OFF**, so every
  flight in the Works and the lounge has open-ended hollow rails. Any
  `writer.tube` that is not `capStart/capEnd: true` is an open pipe.
- `tram/track.ts` `leaningRail`: top rail overhangs its posts by 90 mm and ends
  in a flat cap, and the `dark` posts run up to the `orangeTop` rail's axis —
  the identical pair of defects the portal ramp had.
- `works.ts` cable tray stops 0.6 m short of both gables with no pull box.
- Festoon wire (`parkAmenities.ts`) is deliberately per-segment (each run
  carries its own sway weight); the 0.55 mm joint gap at 9 mm radius is below
  notice. Leave it.

## Plausibility sweep (P-wave 3) — "cleanly modelled but physically impossible"

Lens: not overlap or z-fight, but whether a thing could WORK. Nine fixes, all
arithmetic-confirmed against the builders before touching anything.

- **A base plate is not a bearing unless the member LANDS on it.** Three
  independent sites in `works.ts` started their columns well above their own
  plates: yard gantry `foot` at padTop + 0.2 over a plate topping out at 0.114
  (86 mm of daylight × 6), tank-farm sphere cradles 0.2 over 0.107 (93 mm × 24),
  water-tower `legBase` 0.21 over a shim at 0.139 (71 mm × 6). The task board in
  the SAME yard function already did it right (post at 0.115 on a 0.114 plate) —
  when one member in a file bears correctly, diff every other one against it.
  For a BATTERED leg add the end cap's dip: `section()` sweeps perpendicular to
  the path, so a leg at tilt θ with a half-profile p drops `p·sinθ` below its
  path start (19 mm on the cradles, 12 mm on the tower). Fixed → 2 mm reveal.
- **The "docked" flag on a robot is a contract the site has to honour.**
  `buildDockedRobot` swings the charge-port door open on the groundskeeper's
  LEFT flank (local (-0.206, 0.33, -0.055)); the yard's lead stopped inside the
  charge post 1.35 m away, so three machines sat "on charge" plugged into
  nothing. The lead is now one continuous tube reel → post gland → outboard
  flank → socket, and the dock YAW is drawn before the cable (`rng.range` hoisted
  above the tube) because the socket's world position depends on it. Approach
  the socket over the machine's REAR quarter: the open door swings onto the
  nose side (local +Z), so a lead coming straight down the axis lands on it.
- **Check which axis a stack is stepping along.** The spare wheel rack put four
  Ø0.62 m wheels 0.42 m apart ACROSS their own axis, so every neighbouring pair
  interpenetrated — invisible to the audit because they share slot `dark`
  (same-slot crossings are licensed by construction). Wheels with a bore only
  make sense threaded: `rotateZ(md, π/2)` swings a `revolve({axis:'x'})` onto
  +Z, hub rides `bore − railR` under the rail, pitch ≥ tyre width.
- **A hanging load needs a frame in the direction it hangs.** The same rack's
  rail floated 0.3 m off a single planar A-frame that never touched it (and the
  frame had zero base in that direction, so it would topple). Rebuilt as two
  trestles splayed ACROSS the rail with the rail spanning them. Corollary from
  the same object: a brace quoted at a fixed half-span runs PAST converging
  legs — quote it at the legs' own offset for its height.
- **A ladder is a claim about a route.** The water tower's only ladder stopped
  at tankBottom + 0.4, 0.8 m under the crown walkway at tankBottom + 1.2; the
  reclaimer's stack ladder BEGAN at padTop + 3.12 on a skid roof nothing else
  could reach. Both fixed. `ladder()` now takes `cageTo` (default `top`) —
  a landing needs the stiles 1 m past the deck AND the hoops dead below it, and
  those are different heights. Also tied the tower ladder to leg 1 at the three
  ring-brace nodes: a 12 m ladder standing free of its own tower is the same
  defect from the other side.
- **A drum's axle must be ON its axis.** The yard reel (`rotateZ(π/2)` → Z axis)
  was "mounted" by a 0.56 m bar lying across its FACE, and its 0.34 m crown sat
  60 mm inside the header beam. Now hung on two cheeks written in the HEADER's
  slot (so the hanger welds to the beam it hangs from) with the drum 80 mm
  clear underneath.
- **Sag is not optional to bound.** The Common Hab festoon (`residential.ts`)
  tied its front ends 0.57 m above the porch rail posts (`habUnit` postTop =
  floor + 1.048) — nothing there — and its `hypot·0.12 + 0.06` drop over the
  6.2 m cross run put the string 0.82 m above the deck, straight across the
  step opening. Masts spliced onto the corner posts in the posts' own `orange`
  slot, ties at floor + 2.54, sag capped at 0.34 m.
- Convention confirmed while chasing a false alarm: the porch chairs are NOT
  facing the wall. `writeSoups` maps a part's local +Y to `(sin yaw, cos yaw)`
  and the chair is authored with +Y toward its BACK, while the PLAYER's forward
  for the same yaw is `(−sin, −cos)`. `chairYaw = habYaw + π·{0.82,1.18}` puts
  both the seat and the seated camera looking out at the park, ±32°.

### Reported, not fixed
- `works.ts` reclaimer: `planRect(skidX, skidZ, 0, 2.7, 2.2, 0.9)` pours a
  4.4 m-wide pad under a 4.6 m-wide skid — the module overhangs its own
  foundation 100 mm on both X faces. Widening `halfB` to 2.75 fixes it but
  re-samples `outlineTop` (padTop moves) and cuts the clearance to the machine
  hall's ACROSS-plus face from 0.96 m to 0.77 m — the two-pours-at-one-datum
  hazard. Decide against the hall apron's real extent first.
- `works.ts` yard registers a 3-lamp glow pool at padTop + 3.2 but carries no
  `utilityLight` geometry above 0.96 m (only the three charge-post status
  lenses). Either the gantry headers want downlights or the pool wants moving.
- `PATHS['works-lane']` ends at (42, −54); the maintenance yard's 11 × 15 m pour
  at (28, −70) has no path reaching it at all.

### Probing note
The browser pane's WebGPU canvas went **permanently stale** partway through this
session: `toDataURL` AND a live `computer screenshot` both kept returning one
frozen frame (proved by capturing pitch +1.2 and −1.2 and diffing 32×18 row
means — identical). Survived `navigate(force:true)`, a fresh tab, and
`tabs_select`; a brand-new tab then rendered 0 FPS black. Cheap gate worth
keeping: JPEG byte length or a 5-row brightness profile tells you the frame is
stale for free, before you spend a screenshot on it.

## Prop-overlap audit (P-wave 3) — dressing that clashes, floats or is buried

Same class as the tram console/vent fix, swept across the four hero interiors,
the greenhouse fit-out and the station/plaza/hab/leisure dressing. One line per
defect: what was wrong → root cause → the constraint that now holds it.

**Hero interiors**
- `opsInterior` console: 6 switch panels on a flat 0.7 stride over a bezel that
  runs in TWO segments → panel 3 bridged the 120 mm break with nothing behind
  it, panel 6 stood 225 mm past the bezel and 145 mm past the worktop. Stations
  now derive from `bezelRuns` (3 per segment, half a panel + 70 mm of bezel).
- `opsInterior` console: indicator lenses at rake d 0.041 against a panel face
  at 0.032 → 3 mm float. Now 0.0395, the drawer-pull reveal.
- `opsInterior` bench: the clipboard was 0.32 m of HEIGHT centred at 0.93 — an
  unsupported upright with its bottom 22 mm inside the 35 mm shelf. Now flat,
  long edge ACROSS the 0.34 m deep bench.
- `opsInterior` rack: `writer.box` size is (ACROSS, height, ALONG); the 9 U
  blanks and their lamps had those two swapped → each blank a 28 mm blade
  560 mm deep, standing 255 mm out of the cabinet; the two rails sat 15 mm
  BEHIND the face. All now set out from `rackFace = a − 0.4`.
- `habInterior` shelf unit: contents on a fixed 70 mm stride with rng widths to
  90 mm → neighbours overlapped up to 20 mm and the end pair cut the case
  sides. Now one item per CELL with a 14 mm gap each side, heights clamped to
  the clear height, and the case head 0.28 over the top shelf (was 94 mm, so
  every top-shelf item grew out of the case).
- `greenhouseInterior`: the dosing skid's bund began at along 14.80 — exactly
  the last rack frame — so two uprights rose through the kerb and their 140 mm
  foot plates were cast into the tray. `SKID_ALONG` 15.55 → 15.8.
- `greenhouseInterior`: the hall's aisle deck started at −15.4, driving a 45 mm
  panel through the potting bench's front leg and a bin corner. `runStart` is
  now index-dependent, mirroring the existing `runEnd` rule.
- `greenhouseInterior`: the service board's two stays raked FORWARD and stopped
  at z 2.12 in open air → rear kickers to pads on the slab instead.
- `greenhouseInterior`: the control cabinet bore on the bund kerb over 90 of
  its 220 mm and cantilevered the rest 75 mm over the sump → two feet.
- `commonsInterior` galley: the toe wash sat 36–90 mm in FRONT of the carcass
  with its plinth 114 mm behind it → moved into the plinth's 24 mm set-back.
- `commonsInterior` galley: back-bar shelves stopped 287 mm short of the cheeks
  that carry them at BOTH ends → `shelfIn` from the cheek's own half-thickness.
- `commonsInterior` clinic: the wall screen's panel was inside a SOLID bezel on
  every axis. The bezel is now a four-member frame with a 2 mm reveal round the
  panel, and the panel runs back to a BUTT off its tray instead of hanging
  14 mm off it.
- `commonsInterior` clinic: the supply cabinet's head strip hung 36 mm off the
  carcass face → back on the 4 mm butt.
- `commonsInterior`: hall pendants at 280/308 deg ran through the clinic's
  glazing, its head rail and the CLINIC fascia → the ring now breaks over the
  clinic exactly as it breaks over the stair (3.2 deg of clear angle needed).
- `commonsInterior`: wayfinding plates were sized `width × 0.28` (0.544 m) on a
  0.40 m tray → through both rails and 72 mm into air. Height is now the tray's
  clear field and the canvas aspect follows it.
- `commonsInterior`: planting troughs were ONE solid 0.70 m block, so the liner
  and the soil were entirely inside it and the foliage cards' bases were 20 mm
  under its top face. Now base + four kerb walls with the soil filling the void.
- `commonsInterior`: the entrance pots' soil bed sat below the pot's own dished
  inner floor → bed on the dish (0.575), planting datum 0.60.
- `commonsInterior`: the lectern's reading lamp was a straight bar at ly − 0.26
  while the lectern is an ARC whose nearest material is ly + 0.204 → 0.46 m of
  air. Now an arc on the concave face under the desk top.
- `commonsInterior` assembly: long-table foot pads started at z 0 on a
  medallion that is 2.5 mm proud → 0.004.
- `loungeInterior`: the penthouse lamp hung at 2.06–2.12 on the `pu − hu` line,
  which is the U-prism's OPEN side → recessed into the lid's soffit.

**Dressing (residential / leisure / parkAmenities)**
- Common-Hab notice board: datum was the DOOR SILL face (`deckBack`), and the
  barrel bulges 0.52 m further out by the board's own height → board, frame and
  all six notices were 40–110 mm INSIDE the skin. Datum is now
  `shellHalf[2] + 0.06` (the belt rail, the section's widest point).
- …its surround: `annularPrism` builds its ring in XY and extrudes along Z — in
  a +Y-forward frame that lays the "picture frame" FLAT, 3.1 m up over the
  deck. Now four `prismXZ` members lapping the board's face by 24 mm.
- …its notices: ±0.04 row jitter on a 0.28 pitch with 0.22 tall notes → 20 mm
  overlap with coplanar same-facing faces. Jitter ±0.025.
- Dry rack: `0.03 + t*0.21*(z === 0.86 ? 0 : 0)` is identically zero, so two
  rails ended 53/101 mm short of the raking legs and the lower towel hung
  250 mm off every rail. Both now read `rackRailY(z)`.
- Clothesline: the post's first loft station was t 0.03 of a 2.086 run → 67 mm
  of air over its cast foot. Garments were centred on x 0 BETWEEN the two lines
  (±0.16) and 21 mm below them → each now hangs on a line with the same sag.
- Porch chair: the rear leg ended 10 mm above its own pad (×10 chairs).
- Stage: front-edge lens bars at `front − 0.45` were 60 mm inside the perimeter
  beam, whose face is at `front − 0.36`.
- Equipment alcove: the rack panel hung 10 mm off the wall's inner face; the
  work lamp hung 30 mm under the roof soffit.
- Bowl totem: the `signageGlow` bar was inside the 0.24 m post on every axis →
  moved to the post's crown.
- Climbing dome: `member()` trims `hub·0.83` off BOTH ends, so the 0.15 m legs
  came out as 25 mm stubs floating 102 mm over their shoes, eight times round.
  Legs are now built directly and buried into the shoe.
- Overlook planter: soil 60 mm inside the wall's inner face AND 60 mm above the
  apron → a floating block of earth. Now a 12 mm reveal, bedded on the apron.
- Banner cloth: `HEM` 0.035 of the span = 52.5 mm inset against a ±23 mm arm →
  29.5 mm of daylight at both arms.
- Festoon: catenary ends pushed a blanket 0.1 along the span → 39 mm short of
  the hanging eye. Now 0.052 = eye radius − wire radius.
- Park model: bases at `TOP + 0.008`, a clearance sized for the plaza disc, so
  every building standing on the bare table was undercut by 8 mm.
- Fire point: the cabinet's back plate at y 0.09 against legs whose face is at
  0.0445 — 45.5 mm with nothing spanning it. Two mounting pads per leg.

**Lessons**
- `writer.box`'s `size` is (ACROSS, height, ALONG) in the ops/hall frames. An
  axis swap there does not look wrong in the numbers — it reads as a prop
  stabbing out of its host. Write the host's FACE plane down as a named const
  (`rackFace`, `bezelRuns`) and set everything applied out from it.
- `annularPrism` builds in XY and extrudes in Z. In any Y-forward authoring
  frame it silently lays a ring flat. Use `prismXZ` members for a vertical
  frame; `prismXZ` is the only one of the pair that takes (x, z) + y bounds.
- Four separate lit strips this pass were floating in front of, or buried
  inside, their host — always the same cause: the host's face plane was never
  written down, so the strip's radius/offset was chosen by eye. An emissive bar
  is an APPLIED part and needs the same 4 mm butt every other applied part gets.
- A planter must be a VOID with walls. A solid prism plus a soil prism inside
  it hides the soil and buries the planting datum — check any planter whose
  body is one `sector`/`prism` call (Commons troughs, Overlook planter, and the
  entrance pots' dished-solid variant were all this).
- When a run of props is set out on a flat stride but its HOST comes in
  segments (bezel runs, kerbs, cheeks, bays), derive the stations from the
  host's own array. Three defects this pass were exactly that.
- rng-packed shelf/notice content needs CELLS, not a pitch: `pitch − 2·halfMax`
  must be provably positive for the widest draw, or some seed overlaps.
- Probing, with several agents saving at once: `window.__elysium.audit()` never
  survived to completion — Vite HMR reloaded the page under it twice. The cheap
  substitute for "did every district builder run" is the entry button: it only
  reaches class `ready` after the world is built, so `navigate(force:true)` +
  reading `document.querySelector('#entry button').className` is a 10-second
  proof that nothing throws, for one tool call and no screenshot.

## Signage audit (P-wave 3) — the tracking, the frame and the fin

- **`signageMaterial`'s letterspacing is a PAIR OF U+200A HAIR SPACES, and the
  shipping face draws U+200A at 0.015 em.** The old width budget
  `width*0.78 / (1.18*line.length)` costed a character plus tracking at 1.18 em;
  the real figure is ~0.72 em. So every width-bound line rendered at ~57 % of
  the size that fits — the founding stone's 30 characters came out 4.4 cm tall
  on a 2 m plate. Budgets over this string must be MEASURED (`measureText` at a
  probe size), never counted off `line.length`. If you ever hand-type the
  separator, note it is NOT two ASCII spaces; `tracked()` in `materials/library`
  is now the single definition and is exported.
- **A per-line size fit makes a sign ragged.** The clamp was applied per line,
  so on any plate where width binds, shorter lines came out bigger: the hydro
  totem drew 46/63/25/30 px (its subtitle half again its own name), the
  greenhouse chalkboard 38/19/20/18, the commons directory 42/56/56. One size
  for the block, fitted to the longest line. A sign that wants a hierarchy must
  say so in the CONTENT — two plates — not by accident of character count.
- **A frame in absolute pixels is a different frame on every sign.** The fixed
  14 px inset / 6 px stroke is 2 % of the 1670 px hydro totem (a 7 mm hairline)
  and 24 % of the 108 px bay plate (thick enough for the top line of type and
  the accent bar to land on it). Keyed to `Math.min(w,h)*0.049 / *0.021` it is a
  constant fraction of the PLATE and reproduces the old 14/6 exactly on the
  1 : 0.28 plates. That one change cleared every BORDER collision in the park;
  the text box itself did not need to move.
- **`writer.box` + `placeYaw` sends LOCAL +Z to `rotationY`.** For a sign built
  on a facing direction that makes local X the WIDTH and local Z the DEPTH.
  `stationSign` and `departureBoard` had them swapped, so their cabinets were
  0.1 m wide and `width` DEEP — a 3.2 m (portal: 5.2 m) fin standing out of the
  middle of the plate straight at the reader. The plate was always right, which
  is why nothing caught it: the tell is in the audit's backward ray, which read
  1.62 m of "host" behind a 3.2 m sign — exactly half its width.
  `works.ts stencilSign` has the same construction the right way round; copy
  that one.
- **Check what is IN FRONT of a sign, not just behind it.** Two signs were
  perfectly built and unreadable: the side-platform name boards sat at u 0,
  which `emitPlatformCanopy` makes a bay boundary (12.8 m in 2 bays → columns at
  −6.4, 0, +6.4), and the commons directory sat at 112 deg, 0.5 deg off the hall
  column at 112.5 — and its blade faces look RADIALLY, so the inward face was
  read straight through that column. `tools/signage-audit.mjs` now casts from a
  reader's eye 3 m out on each plate's normal back to the plate and reports
  anything in between.
- **The commons free arc for floor-standing signage is 97.5…118 deg only** —
  entrance below, helical stair above (118…180). The directory totem is at 100.
- The departure board draws its own canvas: a board is a TABLE (destinations
  flush left, times flush right, shared baseline grid) and `signageMaterial`
  centres every line, so the columns were faked with runs of spaces costed for a
  monospace font — the time column landed 6.3/8.1/6.3 em from the row start,
  ragged by ~8 cm on a 2.2 m board. Anything tabular needs its own layout.
- **`tools/signage-audit.mjs` gained three things worth keeping**: a recording
  2D context (per-line font size, every ink box, every rect/stroke drawn over
  it) with MEASURED Helvetica Neue advance widths, so type defects fall out
  arithmetically; coverage of the two owners the first version silently skipped
  (`PortalStationSystem` is a class, not a `build*(services)` function, and the
  side platforms come from `track.buildStations`); and detection of
  `material.colorNode`/`emissiveNode` textures — `parkAmenities` binds its atlas
  through TSL, not `material.map`, so all 66 atlas tiles were invisible to the
  gate. They pass: no legend leaves its tile.

### P-wave 3, second pass — the leftovers, plus the reassigned works/rim items

- **`parkAmenities` rim walk: the instruction was arithmetically impossible, and
  my own first-pass "fix" had silently emptied the walk.** The brief was to pull
  the dressing radii in from ±2.45 so the props land on the paved promenade.
  They cannot: the promenade's WALKING CORRIDOR is `corridorHalf(3.6)` = 1.116 m
  and `SiteRegistry.free()` refuses anything whose `laneClearance` is under
  `r + LANE_CLEARANCE`, so the nearest a bench (claim r 1.0) may stand is
  1.116 + 1.0 + 0.28 = **2.396 m** off the centre line — already 0.6 m outside
  the 1.8 m paving. Even the plaque (r 0.5) needs 1.896 against 1.8. Pulled to
  ±1.2, **all 46 rim placements were refused and the 700 m walk had no dressing
  at all** (the signage tool's placement census is what caught it: `rim-lamp 23,
  rim-bench 8, rim-viewer 8, rim-plaque 7` refused, none placed). Reverted to
  ±2.45 → 40 of 46 place. The verge IS the design: principle 2 in that file's
  header says items on regolith get a base plate that reads as bedded.
- **`tools/signage-audit.mjs` now prints each blocker's world POINT.** The slot
  meshes are park-wide merges, so `part:steel` names nothing; the coordinates
  are what let you find the member. It also tells a POST from a WALL for free:
  slide the plate along its host and re-run — a post stays put, a wall's hit
  tracks the plate. That is how the reclaimer's blocker turned out to be the
  machine hall's gable sheeting 2 m away and not a rail.
- works yard: all 9 partial occlusions cleared, 9 → 0. Bay numbers were on the
  bay centre line, which is also the charge post's and the gantry column's; the
  docked machines' name plates looked straight down the far column (14 deg of
  park clears them, and the whole charging lead is derived from the pose, so it
  follows); two of the three sphere cradle plates faced the horizontal N2
  bullets 1.6 m away, and now take their outboard V face instead — the plate
  goes on the face that has a read, which is not the same face on all three.
- works yard: `works-yard` registered 3 `utilityLight` sources at padTop + 3.2
  with **no emissive geometry above 0.96 m anywhere in the yard**. Three real
  luminaires now hang off each bay's gantry header on cheeks in the header's own
  slot. If a glow pool's `count` has no fixture behind it the rig is lighting
  from nothing — worth a sweep of the other `registerGlowPool` sites.
- Fixed with the same arithmetic as the first pass: the Ares/name-stone field
  buried inside its own monolith (the face is the `+0.02` loft station, 0.28 off
  the centre line, and the field sat at 0.245); the OVERLOOK stays running 10 mm
  through the printed face; the entrance wash bar 158 mm from any solid (now
  recessed under the head casting); the base-band wall-wash floating in the
  middle of its groove; the Common Hab festoon's two back ties starting 95 mm
  off a barrel that has already leaned in by that height; the connector walk's
  tail (`link[length−1]` re-read INSIDE the interpolation loop, so the last two
  pads landed 0.48 m apart); every dwelling's first spur pad inside the precast
  step block; the rim binoculars' barrel hanging 85 mm in front of its yoke with
  the lens hood on the wrong end; the park-model plaque as a 0.54 m flat quad on
  a lathe (92 mm of air at both ends — a turned plinth needs a flat boss); the
  fire-point legend running through the hose drum; the drinking fountain's pedal
  and linkage inside the pedestal.
- **Two findings from the first pass were wrong, and both were wrong the same
  way — judging a joint without checking the SLOT.** The residential window's
  mullion and transom share both offset planes, but they are one slot: a flush
  mullion/transom in a single frame plane is normal joinery and the clash pass
  compares slot pairs, so there is nothing to fix. Same for walk pads lapping
  each other. Before reporting a coplanar pair, check whether the two parts are
  even in different meshes.
- Verified-resolved by another agent, left alone: the playground slide's grab
  rails (foot now 50 mm into the deck slab, far end landed on the chute's outer
  wall). Re-read a site before you fix it from an old note.

**Third pass — nudge-scale leftovers only.** `leisure` bowl capacity stencils
0.400 → 0.383 (the cheek is a ±0.19 wall shifted 0.19, face at 0.38);
`leisure` bowl totem plate 0.142 → 0.123 (0.24 deep blade, face at 0.12);
`leisure` Ares VII plaque 0.192 → 0.173 (0.34 deep stone, face at 0.17) — all
three now on this file's 3 mm plate standoff, confirmed by the signage tool's
`behind[0.004, …]` column. `residential` guitar case: `rotateInto`'s lift
0.53 → 0.5124, because the tipped case's deepest vertex (y 0.52, z 0.018) maps
to −0.5104 and the case leaned on nothing 19.6 mm over the deck.
`residential` telescope legs end at foot + 0.021 rather than + 0.028: the 21.5
deg rake dips the perpendicular end cap 4.8 mm, so all three legs finished 9 mm
above their own pads. Lesson: a raked tube's end cap is BELOW its path end by
`halfSection · sin(rake)` — quote a foot height at the cap, not at the axis.

## P-wave 3 closing (2026-08-11)

Owner's four screenshot defects all fixed and verified live: console vent
relocated below the screen (25 mm clear); entry screen rebuilt as the
typographic dome-on-the-horizon boot page; rails rebuilt as single continuous
sweeps with a real turnout + TWO paving cuttings (boulevard throat, promenade
level crossing) + a graded trench under the whole embedded run; the accent bar
reserves its strip (and the signage agent then found the deeper truths: ALL
sign type had rendered at ~57 % of fit size, fitting was per-line, frames were
fixed-pixel — all measured now).

Wave 3 (4 Opus agents, ~80 confirmed defects fixed): continuity (pipe
fillets/sockets, rail terminations, 106 mm rail sag, bike rack), plausibility
(charge leads that PLUG IN, ladders that ARRIVE, columns that BEAR, wheel
rack/reel rebuilds, festoon rig), signage (systemic type engine + inside-out
cabinets + occlusions 9→0 + measured audit gate), props (3 passes, ~50
interpenetration/float/support fixes across every interior + dressing; two
false alarms retracted; rim-walk tighten honestly REVERTED — the verge is the
design, documented in code).

Orchestrator batch: spurTrackDatum (interiorHeight) is the spur's ground
truth — corridors' floors, the trench dip and the walkable datum all derive
from it; stairFlight caps + baluster soffit gap; removable bollard now
DROPPED INTO its socket; leaningRail turn-down returns + post soffit gap;
works-lane extended to the maintenance yard.

LEDGERED FOLLOW-UPS (explicit, small): trike + hand-cart are disconnected
assemblies needing rebuilds (residential.ts); reclaimer pad underhangs its
skid 100 mm both X faces (needs machine-hall apron extent before widening,
works.ts ~2632); works cable tray stops 0.6 m short of both gables with no
pull box; pre-existing diffuse part:dark::part:dark ~51 m² class (needs
per-part sweeps). A raked tube's end cap sits below its path end by
halfSection·sin(rake) — quote foot heights at the CAP (two agents hit this).

Gates: tsc -b EXIT 0, eslint src --max-warnings=0 EXIT 0, fresh-server boot
clean (no console errors), turnout/trench/crossing/yard/plaza verified live.
Nothing committed (owner commits).

## P-wave 4 (2026-08-11): turnout switchwork, ONE ground field split, 10 s ride

Owner defects → root causes (all fixed + live-verified):
- "Rails still not connected to the circle" → the feather-sink blade idiom.
  Replaced with REAL switchwork: blades clamp their profile against the stock
  rail's outer face (collapsed-topology clamp, same trick as the cast wedge)
  and die at tangency; the outer loop rail carries a real FROG GAP (open
  sweep + flangeways) the spur's inner rail crosses continuously; both casts
  morph to one flush special-work deck (`morphEmbedded`) through the zone.
  `computeTurnout(track)` derives zone/gap/frog from the alignment — nothing
  hand-placed.
- "Rails buried underneath the ground" (loop, west stretches) → the loop
  curve carried Y from 48 control points (12.7 m spacing) while the channel
  floor pours slabTop per-vertex; the 33 m swale component aliased and the
  curve ran ~0.2 m low/high between controls. Loop control points 360 now,
  AND the built loop (cast/rails/furniture) marches the analytic ring with
  beamTopY per station. The CAR still rides the curve — with 360 points the
  two agree to millimetres.
- "Paved ground carved up" at the throat → the trench dip lived inside
  groundGrade, so slabTop dug the neighbouring slabs. THE FIELD SPLIT:
  groundGrade is now PURE (pours flat); `trenchDip` + `regolithSurface`
  carry the trench for the SHEET + scatter + open-ground walkable only.
  Beware the third failure mode found on the way: with the dip guarded by
  `sd > 0.25` alone, the sheet's big triangles ROOFED the cuttings (vertices
  under adjacent slabs held them at deck height, z-fighting the cast). And a
  fourth: inside the RING BAND (trenchDip's mandatory exclusion) the sheet
  breached the corridor-eased channel floor wherever a swale ran high —
  regolithSurface clamps under `streetDatum() − 0.07` across the corridor
  blend there. Lesson: a surface that is HIDDEN by design (sheet under
  slabs) becomes a defect the moment a cutting removes its cover — check
  what a new hole EXPOSES, not just what it cuts.
- Corridor cut edges: raw 90° arris → wall stops 60 mm short + 90 mm
  chamfered lip; corridor REGION halfWidth = width/2 + lip so pours trim to
  the lip's outer arris (the channel-footprint move, reused).
- Exterior flat "pattern shifts when camera moves" → the valley material's
  band filter used the GEOMETRIC MEAN pixel footprint, which under-filters
  the stretched axis at grazing (metres along-view vs cm across-view →
  moiré that crawls). Filter by MAX footprint with a 0.15λ→0.7λ fade:
  grazing bands fade (honest — one tap cannot aniso-filter), face-on slopes
  (max ≈ mean) keep their detail. If a band has a hard threshold it needs
  the same weight.
- Intro ride: ARRIVAL_CRUISE 45, ARRIVAL_BRAKE 9 sqrt-profile → 9.47 s
  measured board-to-stop; gate triggers at remaining 190 m, reseals after
  dock (pressure closures stand closed). Gate is its own module now
  (`tram/portalGate.ts`, `PortalGate.setOpen(eased01)`), rebuilt by a
  dedicated agent; tramSystem only drives the openness scalar.

Verification craft added this wave: `?debug&view=overview` + DevOrbit +
`window.__cam(px,py,pz,tx,ty,tz)` (set camera + controls.target + step) is
the fastest geometry-inspection rig — no player/seat state to fight. Board
clicks from automation: dispatch `button.click()` via JS (synthetic
computer-clicks miss the entry overlay), and remember the unpause lands on a
microtask — step in a LATER eval. Background tabs rAF-throttle to ~1 fps:
drive frames with `__elysium.step(n)` and measure in SIM time, never wall
clock. A stale console error with a `?t=` timestamped URL is from a PREVIOUS
load — verify `window.__elysium` before believing a boot failed.

OWNER STANDARD (2026-08-11, learn this): the trackbed z-fight mush WAS visible
in the orchestrator's own verification screenshots and got rationalised as
"morph facets catching the light" — the owner had to point it out. The rule
now: an anomaly in a verification frame is NEVER "probably fine". If you
cannot fully explain a patch/edge/patttern from the code you just wrote,
raycast/probe that exact spot before calling the frame verified. Corollary
that caused it: two meshes snapped to THE SAME datum are coplanar by
construction — "fixing" a burial by equalising datums just converts it into
z-fighting; separation must exceed the two meshes' mutual sampling error
(hence GUIDEWAY_CHANNEL.gutter = 0.07 under the crown for every cut floor).

P-wave 4 closing additions:
- Trackbed bed rebuild (owner's z-fight report): all cut floors now hang a
  GUTTER (0.07) below the crown datum (`GUIDEWAY_CHANNEL.gutter`), except a
  10 mm-shallow zone through the turnout mouth where the crossing rails run
  past the cast's cap and need their feet bedded — verify bury margins at
  the floor's TRIANGLES, not the formula: cell interpolation across a blend
  ate 12 mm of a 15 mm nominal. Probe stacks (`__ray`-style vertical
  raycasts listing surface@height) are the standard instrument now.
- The frog base plate is centred on the DETECTED centre-crossing, no manual
  offset: two eyeballed nudges in a row put it off the X. If a placement
  looks wrong in a frame, measure the discrepancy before moving anything.
- Check rail added opposite the frog (guard a flangeway inside the gauge,
  flared ends) — the piece of switchwork that makes a gapped stock rail
  read intentional.
- PORTAL GATE: the dedicated agent failed twice (64k output-token cap while
  studying; produced zero file output) — stopped and built by the
  orchestrator. It is a TELESCOPING SEGMENT GATE (see systems/tram.md): a
  true iris is geometrically impossible in a 3.3 m-deep slot around a 5.9 m
  bore. The old stub's "open" petals never cleared the bore — visible in
  ride frames as dark wedges in the aperture corners.
- Dust devils REMOVED (owner: "moving beam of light outside the dome").
  Unlit translucent billboard columns read as glowing beams whenever one
  drifted near the glass; the aerial dust medium is the valley's weather.
- Vite stale-transform gremlin struck twice more (CylinderGeometry /
  spurCorridorDistance ReferenceErrors at boot with tsc green): ALWAYS
  restart the dev server after any cross-module or import-list edit, and
  judge console errors by their `?t=` timestamps — stale entries from prior
  loads persist in the console tool's log.

## P-wave 5 (corridor conform law + parallel platform agent)

- ONE LAW BEATS N PATCHES. The rail-corridor dirt was governed by three
  accreted patches (spur trenchDip, turnout lid clamp, ring-band guard) and
  every patch BOUNDARY was a visible defect: the guard left the sheet at
  grade across the ring band → dirt roofed the exposed channel margins by a
  constant 55 mm (floors sit at grade + 0.075 − 0.13) everywhere the slab
  didn't hide it; partial blend weights left ragged dirt wedges at the
  turnout. Replaced by `corridorField/corridorDip` (interiorHeight.ts): dirt
  = projected crown − 0.13 exactly, full to 2.2 m, gone by 3.3 m, dig-only.
  When ground must "match at EVERY point", make the ground CONFORM to the
  structure's datum; never chase the ground with the structure.
- PROJECTED DATUM, NEVER LOCAL. Anything poured alongside a swept alignment
  must key to the crown at the PROJECTED alignment point, not to
  local-at-(x,z) fields: near pad skirts (Overlook) the radial cross-slope
  is ±0.15 m across the 3.2 m channel and a locally-poured floor climbed
  56 mm over the conformed sheet. Cross-slope belongs to ONE designated
  absorber (the chamfered lip), not to every member a little.
- Channel verge SKIRT: lip arris → crown − 0.45 at 0.42 m out; the
  conformed sheet crosses it on one line, burying its outer edge by
  construction. Seam-closure by construction > seam-closure by tuning.
- Frog base plate DELETED (owner: "cheap ugly rectangle patch"). Real
  special work carries crossings on the flush deck itself; if a joint needs
  a cosmetic plate to read intentional, the joint is wrong.
- Probe-rig economics: the 195k-tri regolith sheet has no BVH — a 1400-ray
  sweep against it wedges the tab for MINUTES (evals queue behind it; even
  `1+1` times out). Read the polar grid's position buffer analytically
  (bilinear on the 641×153 grid) and raycast only the small pour meshes;
  full-ring sweeps then run in seconds. Reload the tab to kill a runaway
  eval.
- Parallel-agent file protocol that worked: main agent owns the ground/track
  files, platform agent owns portalStation.ts + a narrow named exception
  (buildPlanters() in pavingPlan.ts), track.ts helpers are import-or-copy,
  never edit; browser split = agent creates its own tab, never touches the
  main instrument tab ("seed"); shared dev server, reload-and-rerun after
  the other's HMR.

## P-wave 5, second half (rails/joints/planters/side stations)

- `tubeAlong` now uses ROTATION-MINIMISING frames (double reflection; `up`
  seeds only the first frame; closed paths unwind the wrap mismatch). The
  old per-station `cross(t, up)` frame spun wherever a path curled, and the
  loft sheared into pinched ribbon twists — every kinked handrail elbow and
  twisted stair rail was this one bug. Fix frames in the SWEEPER, not at
  call sites.
- ONE canonical rail builder: `kit.railRun` (filleted corners via quadratic
  bezier, real returns curling out-and-down, twist-free tube) +
  `kit.railPost` (stanchion to 4 mm under the soffit). kit.handrail,
  stairFlight, track.leaningRail, stationSteps and the station ramps all
  route through it — a rail is well-made in exactly one place. NEVER draw a
  post and its rail as one tube (stationSteps did; the vertical start
  segment is what twisted).
- Turnout joins show ONLY running rails (owner sketch): no check rail, no
  frog plate. If a joint needs an extra strip to read "engineered", the
  owner reads it as clutter.
- Planter rule: NOTHING of a planting shows outside its container. Absolute
  wall margins (metres, not across-fractions — 6 % of a 1 m bed is 6 cm and
  pokes tuft cards through a 0.2 m wall) + no outward rim drape at all. The
  drape was tried twice: soil-rooted crosses THROUGH the wall (stem comb);
  rim-rooted reads as flat dark ribbons pasted on the sunlit face. Break the
  coping line with tall species silhouettes instead.
- Sprites/particles live on PARTICLE_LAYER (3), enabled ONLY on the main
  camera: any shadow/aux pass rasterizes a billboard as its full RECTANGLE.
  The greenhouse-spray "rectangular silhouette shadows" the owner reported
  could not be reproduced in the tool environment (six attempts, both
  pipelines, live + stepped) — the layer confinement removes the whole
  mechanism class; if it ever recurs, next suspects are the shadow-clipmap
  tile cadence and the (deliberate, static) ridge-vent panes.
- Side stations live in `world/sideStations.ts` (track.ts keeps only the
  shared kit; tramSystem imports buildSideStations). Their ramp is DERIVED:
  grade fixed 1:10, run solved by iterating the ground AT the foot across
  the full width — the old emitPlatformRamp probed a proxy point and hung.
- Regolith palette holds R/G ≈ 1.8–2.0 across the whole family (fines to
  curb dust). The pale drift/dust fields at R/G 1.55 were what made the
  floor read yellow-tan; shift the FAMILY, not one stop, and hold luminance
  so the exposure/LUT chain stays untouched.

## P-wave 5 — Portal Station circulation rebuild (2026-08-11)

Owner's three defects were one disease (a look, not architecture) and every
fix is now derived + asserted rather than typed. `src/world/stationArchitecture.ts`
owns circulation/enclosure; `portalStation.ts` is the system only.

- **`track.emitPlatformSlab` ships a BROKEN DECK and the mini-stations still
  use it.** Its `loft(..., capStart/capEnd)` ear-clips the deck outline, which
  on an 18 m annular sector with per-vertex heights (the deck falls with the
  guideway) produced two triangles spanning the whole platform. Measured
  in-engine, the walking surface stood up to **154 mm above `platformDeckY`**
  in the middle — which buried the tactile corduroy and the edge lenses (both
  correctly placed ON the datum) and made every flush claim meaningless. Fixed
  by a copy (`emitDeckSlab`) whose caps are polar GRIDS and whose outline
  carries the matching radial subdivision on its end edges. Overlook and
  Farmside still carry the defect — an orchestrator job, `track.ts` is
  read-only in a multi-agent wave.
- **A cap grid appended to a loft must be `cleanMesh`d BEFORE `recalcNormals`.**
  Un-welded, the tube and the two caps are three OPEN components, and
  `recalcNormals` orients an open component by a majority keep-score — a coin
  toss. It came up tails and the whole deck rendered back-facing (a downward
  raycast passed straight through). Weld first, then orient: a closed
  component gets the signed-volume flip and is deterministic.
- **Fixing one datum exposes the next.** With the deck correct, `stationSteps`'
  head plate (15 mm proud of the cast) became exactly coplanar with the deck
  it lands on — 0.10 m² per flight. Solve the flight head for
  `deckY − 0.009` so the plate stands 6 mm proud: a real alloy nosing, and
  inside the 20 mm flush tolerance.
- **Flushness idiom worth reusing: a cast CROSSES the ground, never butts it.**
  `groundApron()` runs its outer edge 55 mm BELOW the local surface with a
  SMOOTHSTEP blend (zero slope at the nosing, ~3° at the crossing) — contact is
  a line, so there is no coplanar area, and the same pour absorbs a landing's
  cross-fall. The station terrace falls 41 mm/m across the end flights; no
  level tread can follow that, and no flight lands flush there without an
  apron.
- **The Meridian walk is KERBED (`CURB.reveal` 135 mm) and that decides the
  ramp's line.** A step-free route landing outside a paved region lands against
  a kerb. Parallel-to-the-back-edge is impossible (6.5 m of clear arc beside the
  grand flight against a ~0.95 m drop = 1:6.8) and radial-beside-the-flight
  lands off the 6 m walk, so the ramp SPLAYS: level head landing at the deck's
  back-west corner, then one run converging onto the walk 9.5 m south at 1:10.5.
  It bridges the walk's west kerb ~0.27 m clear, with the kerb buried in the
  ramp's retained mass — the honest condition, not a defect.
- **A splayed run needs a splayed landing.** Built arc-aligned it left a
  triangular notch each side (the run leaves at 33° to the radial) — a visible
  hole under the ramp. The pad, its kerbs and its handrails now share ONE warp
  function (arc edge → the run's first section), so nothing can miss.
- **`across = (−dir.z, dir.x)` is a coin toss too.** Left bare it pointed
  against increasing u, and the kerbs AND handrails swapped sides at the
  landing/run junction — an X across the ramp head. Force the sign against the
  platform tangent.
- **Name the collider's TOP FACE, never a centre + a lift.** The old
  `centre + 0.08` with a 0.1 half-height put the grand flight's collider
  **171 mm above the deck** (rapier ray, in-engine) — a step where the drawing
  says flush. And level deck boxes tracked a falling deck to ±74 mm; six
  PITCHED sixths hold it to ~5 mm.
- **A radial ray cannot see a radial pane.** The screen-opening test shoots
  across the screen line, so it is blind to the glazed RETURNS at the jambs
  (which are radial by design). Check openings with both the crossing ray and a
  vertical stack, and remember that a physics down-ray standing on a screen
  reports the screen's top as "the floor" (that produced a phantom 1.735 m
  headroom reading).
- `tools/station-audit.mjs` is the regression gate: builds the station into a
  bare `PartWriter` in node, runs `auditGeometry`, then asserts flush heads,
  flush feet against the analytic ground AT THE ACTUAL FOOT POSITION, headroom,
  egress envelopes (structure hits AND `insidePlanter` samples) and the screen
  openings. Seconds per iteration, no browser, survives other agents' edits.
- `pavingPlan.buildPlanters()` now takes a per-gap half-width: station bearings
  open 0.148 rad instead of 0.115, which clears the end flight foot, its 2.2 m
  apron and the 1.5 m egress envelope. Anything that grows a station platform
  outward has to re-check that number.

## P-wave 6 — turnout throat rebuild + Farmside lane + MRT sprites (owner arrows session)

- **One field, not legs.** The throat's street/strips/tile-cut are three
  offsets of ONE union field (`throatU`). Every prior mess (crossing lines,
  dying stubs, T-joints) came from building per-leg and clipping legs
  against each other. If two swept systems share ground, derive both from
  one scalar field; iso-contours cannot cross themselves.
- **Never march a clamped field.** Contour marching cannot cross a
  discontinuity: the marcher turns and runs ALONG it (ours orbited the
  whole 236 m zone boundary and emitted strip knots inside the band). March
  the smooth unclamped field; end paths with explicit stop functions.
- **Anchor cross-datum blends at the built edges.** Blending two ways'
  crowns by plain medial distance left the street ~50 mm shy of each cast
  near the merge (every flank read as a loose panel). Squared IDW with
  weights anchored at the cast edges (|d| − 1.3) pins the surface to each
  neighbour exactly where they meet.
- **Grade conforms must propagate to the sheet.** `throatLift` pulls fields
  DOWN toward the street where the terrain is high; the regolith sheet had
  to follow (`regolithSurface` takes `min(corridorDip, min(0, throatLift))`)
  or dirt roofs the lowered tiles. Any future re-grading of paving needs
  the same audit.
- **Field-defined regions**: new `Region` kind `'zone'` (signed distance
  fn + bbox). Ribbons always end in round caps — they cannot express a
  square-ended or field-shaped trim. `MAX_TRIM_DEPTH` is now 6; but note a
  sub-cell stripe can still be MISSED by the 9-sample cell test (dropped
  whole, silently) — that is why the bridge pours street over every
  plateau instead of trusting the tile trim there.
- **Sprites in the MRT scene pass corrupt aux attachments.** Any material
  that does not override `material.mrtNode` gets the pass-level
  `normal: vec4(normalView, 1)` written across its full rasterized QUAD —
  additive blending ADDS it, GTAO reads the garbage, and the sprite's
  rectangle darkens and grows with it (the greenhouse "moving shadow").
  EVERY additive/transparent billboard must set
  `material.mrtNode = mrt({ normal: vec4(0) })` (mist + reclaimer vapour
  done; glassShell already had its own override). castShadow/layers do NOT
  touch this path.
- **Farmside step-free route**: farm-lane's runout now ends ON the side
  ramp's discharge apron (`RIBBON_RUNOUT 'farm-lane': [4, 10.5]`,
  end ≈ (89.6, 3.9)); `planSideRamp` iterates its foot against
  `interiorHeight` so the landing came out flush (0.68 = 0.68) with no
  further change. A ramp/stair is only DONE when its discharge lands on a
  real walk — probe `pavedSignedDistance` at the foot.
- **Verification tooling**: `node --experimental-strip-types` probes can
  import the real modules and raycast a `buildPaving()` result headlessly
  (fast iteration, exact numbers) — see scratchpad throat-probe*.mjs
  pattern. In-page, raycast through SCREEN PIXELS
  (`raycaster.setFromCamera`) to identify what a visual defect actually is
  before theorising; include `ground:regolith` in the mesh set. The FPS
  overlay reads ~3 FPS whenever the browser pane is hidden (rAF
  throttling) — front the tab before judging performance (32+ FPS real).
- Vite dev can serve MIXED stale/new modules across cross-module edit
  bursts even after a server restart; `rm -rf node_modules/.vite` +
  restart + hard navigate, then verify IN PAGE (fetch the module source or
  probe built geometry) before debugging "unchanged" visuals.
- **Rails define access topology, not just safety.** The side ramps were
  geometrically perfect AND unenterable: both long edges railed end-to-end
  fenced the head off from the back band it lies flush with, so the whole
  ramp read as a raised dead box (the owner's "big stairs that lead
  nowhere" — the SECOND complaint after the landing was already fixed).
  `buildSideRamp` now leaves the first 1.35 m of the deck-side edge open
  (the entry) and closes the head's END FACE with a return that turns down
  the far edge as one continuous railRun. When auditing egress: walk the
  route in your head THROUGH the railings — foot AND head — not just the
  surfaces.
- **`PartWriter.slab` extrudes along the corner winding's NEGATIVE face
  normal — corner order decides UP vs DOWN.** The side-station ramp passed
  (across, then down-run) corners, whose normal points DOWN in the platform
  frame, so every slab extruded UPWARD: a solid box standing proud of the
  intended walking plane. THIS was the entire "giant stairs / giant block"
  saga — the surface numbers probed correct while the phantom body stood on
  top of them (the old segmented version stacked stepped boxes; the
  monolith made one big one). Order down-run-first for an up normal, and
  when a slab looks wrong, raycast the BODY (probe for tops ABOVE the
  intended plane), not just the plan surface.

## Owner fix session (2026-08-11 evening): mist rectangles ROOT-CAUSED, livery clip, gait clock

- **THE GREENHOUSE-MIST RECTANGLES, ACTUAL MECHANISM (third report, now dead
  by construction).** In r185, a material's blending applies to the MRT's
  `output` attachment ONLY. Every other attachment gets NO blend state
  (`WebGPUPipelineUtils`: `getBlendMode(name)` defaults to `_noBlending` →
  `blend: undefined` → unblended REPLACE). So every transparent/additive
  fragment REPLACED the normal+receiver buffer across its full rasterized
  footprint — a sprite's whole quad. The two earlier fixes failed because
  their premises were wrong: the particle layer / castShadow never touch the
  MRT path, and `mrt({ normal: vec4(0) })` did not "add nothing under
  additive blending" — it stamped zero-normals + zero-receiver over the quad
  (AO-holes + `normalize(vec3(0))` NaN risk through GTAO/bilateral/share).
  Fix: pass-level `sceneMrt.setBlendMode('normal', new BlendMode(NormalBlending))`
  makes the attachment's OWN source alpha the write authority (color
  SrcAlpha/1−SrcAlpha, alpha One/1−SrcAlpha): opaque writes (n, 1) → exact
  replace as before; `vec4(0)` → write NOTHING (G-buffer bit-identical to the
  no-sprite frame); glazing's `(normalView, 0)` now preserves the background
  pair instead of forcing receiver 0 — through-glass AO is the background's
  own, consistent with the background depth that glass never overwrote.
  THREE FACTS TO NOT RE-LEARN: (1) per-MATERIAL MRT blend modes do nothing —
  the pipeline reads blend state from the PASS-level MRT node only;
  (2) `MRTNode.merge` has an r185 bug assigning merged modes to a dead
  `.blendings` property; (3) any new transparent/additive billboard MUST set
  `material.mrtNode = mrt({ normal: vec4(0) })` — the pass default writes
  authority 1. Also removed the bare `.normalize()` on the share path's
  world normal (zero-length → NaN); `normalUnit` is already epsilon-guarded.
- **A wrong mechanism in a comment steers the NEXT agent wrong.** The mist
  code carried a confident, incorrect explanation ("additive blending ADDS…
  zeroing makes it a no-op") that survived one whole fix wave and framed the
  next. When a fix does not hold in the owner's build, re-derive the
  mechanism from the renderer source before re-fixing — both sprite sites'
  comments now state the verified path.
- **Tram livery clip ("ELYSIUM L"):** raising the decal canvas 192 → 310 for
  the aspect fix scaled the h-keyed fonts 1.61× past the unchanged 1024px
  width; canvas text does not wrap, it CLIPS at the bitmap edge. Both lines
  now measure-fit into the margin box (`fitText`) — and the fit must probe
  and scale the SAME integer px then FLOOR, or measure-at-rounded /
  scale-from-unrounded lands a few px back over the margin. Verified
  headlessly (scratchpad livery-probe recipe: signage-audit advance-width
  tables + recording ctx): 91→90px wordmark, right edge 989/1024, both lines
  inside margins.
- **Gait is ONE clock now (owner spec: 2.5 steps/s walk, 4.0 sprint).**
  Cadence linear in TRUE planar speed through those two points
  (`CADENCE_BASE/SLOPE` in playerSystem); `bobPhase` advances cadence·π/s so
  `sin(2φ)` dips once per step; `PlayerSystem.stepCount` increments at each
  bob LOW point (φ ≡ 3π/4 mod π, grounded, >0.5 m/s) and the audio fires
  footsteps off that counter. The old audio stride accumulator (1.95 m) ran
  0.82 steps/s at walk against a 1.57 Hz bob — two free-running clocks; any
  future gait consumer (dust kicks, controller rumble) must read `stepCount`,
  never integrate its own.

## Entry screen: SHEET 03 (boot page rebuilt, 2026-08-11)

Owner rejected the previous boot page as "landing page cliche / AI frontend
slop" (centred letterspaced wordmark + ghost button + thin progress bar +
corner whispers). The replacement is one authored concept: **the entry screen
is SHEET 03 of the drawing set for Dome One** — an A0 plate, dark ink on bone
plotter paper, section + key plan + detail + title block. Not a dark screen.
Not a wordmark. If a future request is "restyle the entry screen", restyle the
plate; do not regress to a hero + button.

- **The load IS the artwork.** Each system that reports in inks the layer it
  builds (`sky` → sun + oculus shaft, `dome` → the shell, `tram` → the Loop
  and Gate S, `vegetation` → Tree 1). 14 `<g class="ly" data-layer=…>` groups,
  revealed by adding `.on` — pure CSS opacity, no rAF, no canvas, so the main
  thread stays free while shaders compile. Progress is a **plot register** in
  the right margin (code + name + a box that inks), never a bar.
- **The drawing is struck from the live constants, not eyeballed.** `W` in
  entryScreen.ts quotes latticeField/parkPlan/track/firstTree (base 130, crown
  64, sphere R 164.031, θ_base 0.91495, the 13 ring parallels, plinth
  128.9/131.7/+1.15/−2.40, LOOP r 97, platform edge 95.6, car 2.60 × 3.048,
  12.0 m ginkgo). The springing is verified to land at exactly z 130 / y 0.000,
  which is why the sheet can say "the springing IS the datum". **If those world
  constants change, the plate is wrong** — it is a second consumer of them.
- Scales are internally consistent and derive from one number (`SCALE_500`
  3.78 units/m): section 1:500, key plan 1:2000, DETAIL A 1:50, parts as noted.
- **The soul of the sheet is REV G:** Tree 1 grew 1.0 m past the dashed
  planting envelope it was drawn inside; the canopy breaks the envelope, a rust
  revision cloud rings it, and the revision table says "drawing amended to
  suit". Keep it. The park winning an argument with its own drawing is the
  whole idea.
- **The one action is a rubber stamp**, bottom-right in the title block:
  a dashed empty box carrying the plot percentage until ready, then the rust
  ADMIT ONE / BOARD stamp lands rotated −2.6°. Contract unchanged and load
  bearing: root `id="entry"`, exactly ONE `<button>`, gains class `ready`
  (headless probes read `#entry button`.className). It is `disabled` until
  ready, which does not affect className.
- **The plot pointer is monotonic on purpose.** Real emit order is
  main.ts's 0.05 `render-pipeline`, then registry ids, then `ready` (which the
  registry fires BEFORE the shader pre-warm), then `prewarm` twice. So
  `advance()` never moves backwards, `LABEL_ALIAS` folds physics→groundworks,
  interaction→player, doors/opsScreens→interiors, and `ready` maps to the LAST
  row rather than to completion — completion only happens in `showEnter()`.
  Verified by replaying both the player-mode and `flags.view` label sequences.
- **Verifying a dense SVG plate without a browser:** copy the module to the
  scratchpad, append `export const __svg = drawing()`, transpile with
  `tsc --ignoreConfig --module esnext`, and run node checks over the string —
  (1) no NaN/undefined in any attribute, (2) tag balance, (3) every numeric
  attribute inside the viewBox, and above all (4) **estimate each `<text>`
  box from its class font-size, char count and anchor and report overlapping
  pairs**. That last check found 7 real label collisions and 1 label running
  off the plate that hand-computed layout had missed. Cheap, repeatable, and
  the only honest way to lay out ~110 annotations blind.
- SVG paint defaults are set once on `#entry svg { fill: none; stroke: none }`
  and inherited, so stroke-weight classes (`s0`…`s3`, `sr`) and fill classes
  (`f1`, `f2`, `fp`, `fe`, `fh`) compose freely on one element. Strokes are
  NOT `non-scaling-stroke`: the plate scales as a whole, like a real plot.
- Long annotation must be wrapped by hand into ≤ ~40-character lines. Forcing
  a 66-character note into a 370-unit column with `textLength` crushes the
  tracking to negative; SVG text does not wrap.

## SHEET 03 REV H — hierarchy pass (owner critique) + the desktop gate

- **Owner rejected the first SHEET 03 execution on HIERARCHY, not concept**:
  "drowning in distractions… user might not even realize i'm supposed to
  click Board". The fix is two states with inverted orders, all CSS:
  (1) PLOTTING — the section is the figure; the live percentage/caption and
  register are the one secondary focus (full ink now); all five
  accompaniment boxes (pen table, key plan, Detail A, standard parts, notes)
  are wrapped in `<g class="t3">` at 55% ink — texture, not content. The t3
  wrapper multiplies with the `.ly` plot-in, so a demoted box inks straight
  to its demoted weight. (2) READY — root gains `done`: drawing washes to
  40%, margin/title/foot to ~45%, and the button leaves the register cell
  via `position: fixed` (the #entry overlay IS the viewport) to land as a
  min(max(44vw, 52vmin), 86vw, 900px) stamp, aspect-ratio 3.15/1, over the
  receded plate — delayed 260 ms behind the wash, with an explicit CLICK TO
  BOARD mono line fading in under it. Lesson for any boot-page work: a
  dense aesthetic is fine, but the CTA state must INVERT the hierarchy, not
  join the density; and a button confined to a layout cell can never become
  primary — promote it out of flow at the state change.
- The behavioral probe recipe for this screen lives in the session
  scratchpad (`entry-probe.mjs`): run the REAL createEntryScreen against a
  ~80-line DOM stub (classList sets, innerHTML capture, querySelector memo),
  replay the true boot label sequence including aliases and the double
  render-pipeline report, then assert the contract classes (`button.ready`,
  root `done`), one-button rule, balanced `<g>`, and the 7 t3 groups. 46
  assertions, no browser.
- **The game is now DESKTOP CHROMIUM ONLY (owner directive).** `index.html`
  loads `src/boot.ts`, which imports ONLY `ui/platformGate.ts` and
  dynamically imports `main.ts` on an eligible platform — vite splits the
  whole game behind that import (verified by build: 7.87 kB gate chunk vs
  3.8 MB game chunk), so phones never fetch the game. Detection:
  `navigator.userAgentData` (Chromium-only API) — brands must include
  "Chromium", `mobile === false`, and platform ∈ {Windows, macOS, Linux,
  Chrome OS, Chromium OS} (Android tablets report mobile: false but
  platform Android). WebGPU is deliberately NOT gated in boot — an eligible
  desktop Chromium without WebGPU still reaches main.ts's detailed entry
  error. Ineligible devices get SHEET 00 (`platformGate.ts`): the plate
  language, single column, composes from 320 px phones up, with a diegetic
  admission survey (Engine/Device/Renderer PASS-FAIL rows) and an ADMISSION
  HELD · DESKTOP ONLY stamp. Caveat recorded in the module header:
  userAgentData requires a secure context — localhost passes, plain-http
  LAN serving gates out a real desktop Chrome.
- SHEET 00 stamp follow-up (owner rewording overflowed it): a stamp die must
  be an SVG, never nowrap HTML — viewport-keyed type in a width-capped sheet
  overflows the moment the wording grows. `stampSvg()` derives the ring
  geometry from the string, pins every line with `textLength`/`spacing` (the
  tracking IS the fit, like a real die), and scales as one drawing at
  `min(97%, 520px)` of the sheet (the 3% eats the 3° rotation's reach), so
  ANY future wording self-fits on any font stack. Also: centre an
  over-viewport sheet with `margin: auto` on the child, not flex alignment —
  flex-centred overflow clips the top unreachably on short landscape phones.
- SHEET 00 survey follow-up (owner on desktop Safari: "somehow it also fails
  at being desktop"): each diagnostic row must be TRUE ON ITS OWN EVIDENCE.
  Deriving the DEVICE row from userAgentData — a Chromium-only API — made
  every non-Chromium desktop inherit the engine's absence as a device FAIL,
  blaming the visitor's machine for the browser's engine. `detectPlatform`
  now falls back to the UA string for desktop-ness (handheld tokens, plus
  the iPadOS masquerade tell: Macintosh UA with maxTouchPoints > 1 is an
  iPad, no real Mac reports touch). Eligibility is provably unchanged —
  `chromium` can only be true when uaData exists, where the old path still
  rules — the fallback only keeps the diagnosis honest. Probe matrix now
  asserts the desktop FLAG per browser, not just eligibility (14 UA cases).

## Freedom Tower build (2026-08-11) — the landmark + gallery lift

- Full write-up: `dev_docs/systems/freedom-tower.md`. Headlines for future
  agents, beyond what that doc and the code say:
- **Derive landmark heights from the dome, never author them.** The spire
  tip is `√(R² − r_site²) + centerY − clearance`; the audit asserts every
  vertex ≥ 0.55 m inside the shell. Any tall build near the glass owes the
  same derivation + assert.
- **A tall public vantage is a NEW TEST CATEGORY.** Three latent park-wide
  defects were invisible until a 40 m gallery existed: (1) shadow-clipmap
  casters clip at `lightMargin < h/sinθ` (→150) and receivers clip at
  `DEPTH_REACH < h·2.2` below a high camera (→200) — a shadow that "ends on
  a hard line ⊥ sun" is ALWAYS this slab, one end or the other; (2) GTAO
  emits full-width iso-depth "barcode" rows wherever its world radius spans
  < ~8 gather texels — the fix that holds is a COMPETENCE fade (footprint
  between radius/8 and radius/3.3), not distance windows (whack-a-mole);
  (3) r185 PassNode depth defaults to 24-bit (`FloatType` commented out in
  three's source) — set it explicitly on any pass whose depth is
  reconstructed from.
- **Two paving ribbons at ONE priority never trim each other** — the clip
  cuts lower against higher only. Every earlier spoke junction landed on a
  higher-priority disc, so the first spoke-to-spoke branch (tower-walk off
  the Meridian) shipped a coplanar overlap. Rule: a branch spoke sits one
  rung (39) below its trunk (40).
- **`stadiumRadius`-style star-shaped fields** are the drum-collider lesson
  generalized: pit, curbs, screens, aperture, colliders all from one signed
  field about the cab/core spine — nothing can disagree. Worth copying for
  any future shaft/void.
- **Elevator state machines need an explicit `departing` flag**: an arrived
  cab is also riding+parked, and the doors-shut→depart rule re-fires
  instantly without it (the first live ride bounced off the top). Found by
  RIDING it headlessly (keyboard events + step batches), not by the audit.
- **The interaction caption override is last-writer-wins**: the tram writes
  unconditionally every frame; any later system may only write while it
  owns the ride + one null on release. Register ride systems AFTER the tram.
- kit.bench on a raised deck works fine (seats registered on the gallery,
  sight-line raycast passes) — but bench colliders are the CALLER's job.
- Probing traps re-confirmed: `placeAt` puts the body EXACTLY where told —
  0.7 m past the deck edge is a 38 m fall (compute r before teleporting);
  and a probe that presses E during the door-closing window CANCELS the
  ride (by design) — wait for `departing` to clear before judging a stall.
- **A bare `MeshData.from` quad has NO uvs, and `toTriangles` falls back to
  planar WORLD-coordinate uvs** — on a clamped CanvasTexture that renders as
  one edge-pixel smear (the tower's name blade shipped as a blank dark
  plate). Any hand-built printed face needs explicit 0..1 uvs
  (`printedQuad` in freedomTower.ts), and the read direction is fixed by
  the VERTEX-TO-UV pairing alone — reversing the winding with matching uv
  reversal changes NOTHING visible. Derive mirrorU per face from the
  reader's screen-right = forward × up vs the authored +x image (the tower
  blade + deck lintel + lectern plaque mirror; the gallery orientation
  desks do not).

## THE FOUNTAIN (2026-08-12) — water, and two aliasing traps

Replaced the Regolith Gardens' raked rings + steel beds with a monumental
tiered fountain (`src/fountain/`, `dev_docs/systems/fountain.md`). The lessons
below are the ones that cost time and are not specific to fountains.

### Winding failures HIDE themselves

Two surfaces shipped inside-out and the symptom was not "it looks wrong", it
was "it is not there". Hours went into diagnosing a water shader that was
never running a single fragment. Two rules, both now in the fountain doc:

- **Hand-built polar index buffers.** `(a → b)` is +θ and `(a → c)` is +radius,
  so `θ̂ × r̂` is +Y: `(a, b, c)` faces UP. The reverse is culled outright.
- **`archkit` `loft`/`revolve` on an ANNULUS.** `recalcNormals` orients closed
  components by signed volume (always safe) but OPEN ones by the AUTHORED
  winding — and an annulus lathe is topologically open even when its profile
  closes on itself, because the duplicated seam ring is not welded until
  `cleanMesh` runs later. A lathe whose TOP run goes outward faces DOWN. Run
  the underside outward and the top back inward.

Diagnostic that finally settled it: swap the material for a plain red
`MeshBasicMaterial` from the console. If no red appears, it is geometry, not
shading — stop reading the shader.

### `dFdx` is CONSTANT ACROSS A TRIANGLE

Screen-space derivatives of a linearly interpolated varying are piecewise
constant. Driving a *steep* fade from them (micro-band attenuation, texture
detail LOD) therefore quantises to the mesh and stamps its quad grid onto the
surface — on the fountain's water it read as a wire lattice lying on the basin
at grazing angles. Fix is an analytic footprint: pixel angle × range ÷
cos(incidence), computed by projecting the point and the point one metre above
it and differencing in NDC (`waterSurface.metresPerPixel`). Continuous
everywhere, exact for any projection, and needs no matrix element access —
`cameraProjectionMatrix.element()` is not typed in r185 anyway.

The park's other footprint fades (`causticWorldSample`, the ocean LOD in
SeaPark) use `dFdx` on flat, densely tessellated surfaces where the per-triangle
step is invisible. On anything with 10 cm cells seen at 80°, it is not.

### Pure sinusoids interfere into a visible lattice

Three tidy capillary bands beat into a perfectly periodic pattern, and any
downstream amplifier (here the caustic Jacobian, which scales as A·k²) turns
that beat into a wire mesh. Seven bands at mutually incommensurate wavelengths
(ratios near √2, φ, √5 — never a simple fraction) with amplitudes falling as
~λ^(3/4) push the beat period past the object's own diameter. Same trick
applies to any procedural surface built from summed waves.

### Water: split at the breakup point, not by rendering convenience

Streams drawn as swept alpha-carved sheets read as PLASTIC RIBBONS, however
good the shader. A texture on a fixed surface cannot separate, cannot be
overtaken by the parcel behind it, and cannot be seen edge-on. What works is
the physical split: a short COHERENT length as real geometry (Fresnel opacity
rising toward the silhouette), then independent ballistic parcels. Motion
stretch is `d + |v|·τ` with τ an exposure — at fountain speeds that is a 10 cm
streak off a 4 mm droplet, and it is most of why the result reads as fast.
Sub-pixel parcels must be clamped up in size with opacity scaled by the AREA
RATIO, or distant spray aliases into crawling confetti.

It is also far CHEAPER: the ribbon version rasterised its full height whatever
its alpha said, and cost more than the entire droplet system that replaced it.

### Six hashes, six kinds of regularity

Every hash in the droplet system exists to retire one specific artificial
uniformity: release phase within its own slot, per-orifice launch scatter,
size draw, spin direction, intermittency, snaking phase — plus a per-strand
flow term, because a weir does not shed evenly along its lip. Keep
intermittency gentle: taking a whole strand to zero reads as "some jets are
switched off", not as breathing.

### Mars gravity is the strongest single cue, and it is free

3.721 m/s² in every ballistic solve AND in the ripple dispersion
`ω = √(gk + σk³/ρ)`. Arcs hang ~1.6× longer than Earth's and rings spread ~40 %
slower. Nobody names it; everybody reads it. Same for the solar disc: half
Earth's angular size, so caustics genuinely focus tighter.

### Proportion numbers that were wrong the first time

- A tazza's DEPTH RATIO decides bowl-vs-drum: 0.29 is a table on a post, 0.45
  is a tazza.
- Flutes/gadroons: fewer and deeper. Sub-pixel flutes only soften a silhouette
  into mush.
- Curtain strand count is set from strand WIDTH: 36 lanes at 0.2 half-width is
  a 96 mm strand, i.e. a picket fence.
- Jet launch angle is `atan(4·rise/span)`. 72° is a garden sprinkler; civic
  arcs are ~52°.
- A canted nozzle head at the launch height with nothing under it FLOATS. The
  riser from the floor is what makes water read as supplied.

### FPS in the in-app browser pane is not a measurement

The pane throttles compositing when it is not fronted, and after any
`javascript_tool` interaction. A "1 fps" reading appeared on `?view=firsttree`
with no fountain in frame. Compare two views in the same session before
believing a regression, and prefer the GPU-fenced `MessageChannel` harness
(notes: render-pipeline) for anything load-bearing.

## FOUNTAIN physics pass (2026-08-12b) — sim, drag, and three expensive illusions

The fountain's water is now a real system: a 512² heightfield SIM in the basin
(damped wave equation at Mars wave speed, forced by sampled droplet impacts,
foam as a simulated scalar — see `systems/fountain.md` §3) and closed-form
LINEAR-DRAG flight for every parcel (τ ∝ diameter; the dome is a ~70 kPa
habitat, so drag is real and big). The caryatids are gone — replaced by four
petrified dust-devil vortices (`fountainVortices.ts`). Lessons with reach
beyond the fountain:

### `.toVar()` defeats dead-code pruning — bisect returns lie

TSL emits every `.toVar()` chain even when your early debug `return` skips
using it. An early-return bisect therefore only changes WHICH value reaches
`output.color`, not what is compiled — every "stage" of mine carried the whole
shader, and the pass/fail pattern I read as "this subtree kills the draw" was
actually "this OUTPUT VALUE looks like the background at this camera angle".

### Calm water over its own refracted floor is invisible — HOIST it

A ray-traced pool seen from above shows its floor image 27 cm above the real
floor at 3 % fresnel — near-identical to no water at all. Before diagnosing
"the mesh is not rendering," move it: `mesh.position.y += 0.5` from the
console. A glass disc appears → it was always rendering. (It was.) This is the
transmission-side sibling of the red-material trick already in these notes.

### The in-app pane SUSPENDS rAF while hidden

A freshly navigated page has ticked ~0 frames when you probe it headlessly:
systems have not updated, sims are flat, `window.__x` handles you added in
`update()` are undefined. That is not a broken loop — it is a paused one. Use
`?debug=1` + `__elysium.step(n)` (built for exactly this) to drive synthetic
frames, and only then judge.

### GPU compute on this stack: crib SeaPark's `wakeFoamMap.ts`

StorageTexture ping-pong, `textureLoad(texture(t), ivec2)`, bare
`textureStore(...)` statements, uniformArray splats, `.value` repointing after
swap (TextureNode `.sample()` clones follow the base via referenceNode) — all
proven there, reused verbatim in `waterSim.ts`. `renderer.debug.getShaderAsync`
dumps generated WGSL; `device.addEventListener('uncapturederror', ...)` hooked
from a system's init() catches pipeline errors that fire before console tools
attach.

### Emitter geometry: parcels must launch FROM their site

A per-parcel angular offset that fills the ring is right for a WEIR (sites are
virtual ligaments) and wrong for a NOZZLE (site is a physical orifice) — the
uniform half-slot version had jet threads rising a metre beside their nozzles.
`angularSpread` is per-emitter now. Same family: breakup time solves
v₀t + ½gt² = L (arc length), not L/v₀ — a sheet leaving at 0.07 m/s does not
take 30 s to fall 42 cm.

### Drag flattens launch angles — hardware must read the same solve

Through air the solve launches faster and ~5° flatter to land on the same
ring; nozzle cant now reads `jetLaunchAngle()`. Any time water and hardware
are authored from "the same numbers", make sure they are the same SOLVED
numbers, not the same inputs.

### Procedural humans: retired, and the lesson is the replacement

Two full passes of honest craft (canon sections, contrapposto, fold cascade,
knee press, baked crevice channel) landed at "good for procedural" — which is
another way of saying wrong. The owner's call: subjects whose identity IS a
mathematical form (vortices: lobed column × helical twist × meander) render
EXACTLY at any resolution with no anatomical judgement to miss. Craft still
bites: mouth flares welding onto a dome must be modest and weld late (else
melted cheese), grooves must survive to the top (else turned baluster), and
crevice-occlusion bakes must WHISPER (−18 %) — at −40 % they are painted
stripes.

### Misc numbers that were wrong the first time

Tazza rim: gadroons must stop BEFORE the ovolo; the moulding needs ~10 edges
for its 150° roll (40° smooth threshold); the DRIP ARRIS is the section's
outermost point with undercut below (the sheet must clear the stone).
Marble hairlines bundle to the bedding or they read as topo contours. MP3
loops need loopStart/End inside the encoder padding, decoded to a buffer
(HTMLAudio gaps). The fountain keep-out is sized against the JUMP (3 m/s at
0.38 g = 1.21 m apex), not the autostep.

## Three distance/precision defects (2026-08-12) — sign, deck shadows, glass AO

All three were reported as "looks wrong from over there, fine up close", and all
three were the SAME kind of mistake: an epsilon or a filter chosen against how a
thing looks in the hand rather than against the buffer that has to resolve it.

- **THE DEPTH BUFFER IS NOT REVERSED.** `pipeline.ts`, `gtaoVisibility.ts`,
  `marsAerialPerspective.ts` and `glassShell.ts` all state that r185 WebGPU is
  reversed-Z. `WebGPURenderer`'s `reversedDepthBuffer` defaults to false and
  nothing sets it. Their guards happen to test both ends of the range, so
  nothing broke and the belief propagated agent to agent — do not treat those
  comments as a spec. At near 0.08 / far 14000 the quantum is 0.7 mm at 30 m,
  1.9 mm at 50 m, 4.8 mm at 80 m. **Any two parallel faces under ~5 mm apart
  z-fight in the far field.** Also note `depth32float` (set for the GTAO barcode
  fix) buys nothing out there — float precision crowds the NEAR plane; near 1.0
  it is exactly the 24-bit unorm step.
- **A printed skin can't buy depth with millimetres — state the ordering.**
  `stencilSign`'s face sits 3 mm off its plate, which is physically right
  (widening it opens a slot at the plate border, and the plate must stay a full
  slab for the outriggers to lap into). `signageMaterial` now carries
  `polygonOffset` at −2 units: WebGPU depthBias is counted in depth QUANTA (on a
  float attachment, scaled by the primitive's own exponent), so a fixed −2 wins
  by the same margin at 10 m and at 300 m. Sign convention is tied to
  non-reversed depth — flip it if `reversedDepthBuffer` is ever enabled.
- **DEAD END, do not repeat: forcing `LinearFilter` on the shadow depth texture.**
  three's `DepthTexture` really does default mag/min to Nearest, so
  `ShadowNode.setupRenderTarget` looks like it hands the PCF filter a
  non-filtering comparison sampler — but `setupShadow` **overwrites both to
  `LinearFilter` on the very next lines** whenever `shadowMap.type` is PCF or
  PCFSoft (it is, by default). Hardware 2×2 PCF has been on the whole time; an
  override of `setupRenderTarget` is a no-op. Verified in the r185 bundle
  (`setupShadow`, just after the `setupRenderTarget` call).
- **The gallery deck sawtooth was an oriented shadow-SILHOUETTE/filter-support
  defect, not a missing comparison sampler.** Coverage-only and
  `PCFSoftShadowMap` trials left the same teeth; spatial supersampling reduced
  them proportionally. Thin
  75–130 mm mullion shadows looked clean because their two filtered edges
  overlap, while a wide edge exposes the light-space raster grid directly.
  Static L0 is now 15 m / 8192² at tier 2, keeping the whole 10.9 m deck inside
  its full-weight region. A fine-only radius 3.2 covers the residual stair;
  coarse/dynamic maps retain radius 1. `?view=freedomdeck&pass=nopost` is the
  edge gate. Cost: ~192 MiB extra tier-2 depth allocation, but no extra texture
  or recurring static shadow draw (L0 is cached after load).
- **Directional-light `shadow.bias` is normalized DEPTH, not a world-space
  epsilon.** The old `-0.0003` across L0's ~379 m camera slab represented about
  114 mm of peter-panning, plus 8.75 mm normal bias. The Gale lectern begins
  only 2 mm over the deck, proving the reported moat was a shadow error rather
  than floating geometry. `CachedShadowClipmapNode` now accepts
  `depthBiasWorld`, converts it by each camera's `(far-near)`, and exposes both
  the authored and normalized values in its snapshot. Freedom uses 1.5 mm
  depth + 1.5 mm L0 normal bias. `?view=freedomshadow` is the contact gate.
- **Judge shadow filtering on a bare bright plane.** The defect had
  shipped park-wide and was invisible until the Freedom Tower deck existed: 5 m
  of clean near-white plate seen from 2 m, under a 27° sun that stretches every
  texel 2.2× along its own direction, sitting right beside the analytic lattice
  net's true penumbra for comparison. Regolith and paving albedo hide it
  completely. A tall vantage was already a new test category (freedom-tower
  notes); so is a large untextured floor.
- **Every glazing material owes `mrt({ normal: vec4(normalView, 0) })`.** It is
  the AO-receiver mask, and `curtainGlassMaterial` (Commons drum, hydro tower,
  the whole Freedom Tower gallery) and `shaftGlass` were both missing it while
  `heroGlass`/`cabinGlass`/`milkyPanel`/the dome shell all carried it. Receiver
  1 lets GTAO darken the PANE wherever a mullion, a leaning rail or a head
  channel stands close to it — soft smudges on the glass that read as dirt. On a
  TRANSPARENT material it is worse than on an opaque one: opacity gates colour
  only, so the quad stamps its normal + receiver over its whole rasterized
  rectangle and erases the G-buffer of whatever is seen through it. Checklist
  for any new pane: side, depthWrite, and the receiver mask.

## Ports of external Blender/three builds (2026-08-12, Optimus exhibit)

Full write-up: `dev_docs/systems/optimus-exhibit.md`. The transferable lessons:

- **Port mechanically, then PROVE it.** When the brief is "identical to this
  reference", do not retype the source. Slice the reference by line range with
  a script, apply a table of explicit find/replace patches for the type
  annotations, and regenerate. Every unpatched line is then byte-identical by
  construction. Then verify with a checksum harness that runs BOTH the
  reference and the port under one driver and compares object names, vertex and
  face counts, material-slot lists, and weighted sums over all positions AND
  all split normals. The Optimus port matched to the last digit
  (176 objects / 891,809 tris / 446,593 verts). **Re-run it after any edit to
  `procgen/blenderkit/` or `robots/optimus/parts/`** — a plausible refactor of
  `applyBevel` or `weldVerts` changes the mesh without looking wrong.
- **Bind a ported library with a FACTORY, not by threading parameters.**
  Blender's `optlib` writes into module-global collections. Making that generic
  by adding a `coll` argument would have changed hundreds of ported call sites,
  and every changed line is one the checksum can no longer defend.
  `createCollectionApi(names)` + `createLoftKit(api)` return closures that a
  six-line `xKit.ts` binds once; the ported call sites are untouched.
- **`lateInit<T>()` (`procgen/blenderkit/mathkit.ts`)** is the idiom for a
  ported module-scope slot filled by a `*Curves()` entry point. Typing those
  nullable puts a `!` on ~200 call sites for no safety.
- **Keep heavy CPU generators three.js-free and run them on a worker.** The
  Optimus build is 3.4 s of pure CPU (1.1 s generators, 1.9 s bevel/boolean/
  split normals). Off-thread it overlaps init and the entry screen keeps
  animating; on the main thread it is a visible three-second freeze. The
  worker chunk is 70 kB — but only because nothing in its import graph touches
  `three/`. One stray import of a materials module drags the whole renderer in.
- **Reference materials can violate the park's emissive ladder.** The demo's
  visor LED is emissive × 11.0 against a ladder that tops out at 5.0
  (threshold 1.0). Kept, because the emitting area is ~1.5 mm and the ladder's
  own rule is "scale the AREA, not the multiplier" — but check any imported
  material against the ladder before assuming it is fine.

### Shadow-only proxies for LOD-switching objects (new layer)

`STATIC_SHADOW_PROXY_LAYER = 4` (`render/layers.ts`, + `markStaticShadowProxy`).
The main camera never enables it; the static clipmap cameras always do.

The problem it solves is general: **a cached shadow clipmap records its casters
into an immutable render bundle**, so anything whose draw changes after
`sealStaticShadowCasters` — an `InstancedMesh` count that moves, a mesh that
turns invisible on an LOD switch — either freezes at its seal-time appearance
or vanishes from the shadow. Give the cached maps a separate, never-switched
proxy at a mid LOD and the main view is free to swap detail underneath it.
Verified: `InstancedMesh.clone(false)` preserves count, the layer mask, the
material array and the instance matrices, into its OWN buffer.

Corollary for instanced statics: **per-instance LOD is not free.** An
`InstancedMesh` draws one range, so differing detail means differing counts,
which is what breaks the bundle. For a tight formation (the eight figures span
7.2 m, ~4° at the switch distance) one group-level switch is both cheaper and
strictly correct.

### Geometry craft confirmed again

- A round stepped plinth wants **one lathe + one extruded prism per flight**.
  Stacked tread boxes share their side faces exactly — four coplanar walls per
  flight. Result: 0 z-fight pairs over 4,232 triangles.
- **Stop a flight one riser below the deck it serves.** Carrying the top tread
  to deck level puts a tread face in the deck's plane over the whole overlap;
  letting the plinth's own fascia be the last rise removes the overlap
  entirely. Same reasoning sinks the flight's ground line 60 mm under the
  paving instead of closing it at the slab top.
- A **branch spoke's runout is taken along its own bearing**, so its start
  point must sit well inside the trunk's half-width — `optimus-spur` starts
  1.5 m west of the Meridian centreline because a 3 m runout from its old
  start threw the tip clear of the walk and hung an untrimmed cap of paving off
  the flank. The coverage raster does not catch that (extra paving is not a
  hole and not an overlap); only reading the runout geometry does.
- `tools/paving-coverage.mjs` **crashes on the current region set** —
  `regionBox` and the label line predate `kind: 'zone'` (the turnout throat)
  and hit `r.line is not iterable`. Two lines fix it; left alone here because
  it is outside this change. Until then the paved-floor proof cannot be run.

### EVERY lathe profile must start AND end on the axis (open ones invert)

**This one shipped a frame with an invisible floor.** `revolve` orients a
CLOSED shell for you whichever direction the profile is authored — but an
OPEN profile takes its orientation from the profile's direction, and the
`axis → outward` direction that reads most naturally comes out **inside-out**:
winding and shading normals both flipped, so the surface is backface-culled
and you look straight through the object. Measured on a bare disc at y = 1:

```
OPEN   axis -> outward                       top faces up=0  down=32   INVERTED
OPEN   outward -> axis                       top faces up=32 down=0    ok
CLOSED axis -> top -> edge -> soffit -> axis top faces up=32 down=0    ok
CLOSED the same profile reversed             top faces up=32 down=0    ok
```

So: giving part of a revolved solid its own material means a second lathe
(`PartWriter.lathe` takes one slot), and the tempting move — split the profile
at the material boundary so the two shells share a rim — produces TWO OPEN
profiles and inverts both. **Make each half a closed solid and let them
overlap instead**, one containing the other's boundary (see the containment
rule below). The Optimus plinth's marble slab and cast drum are the worked
example: the drum's top disc is buried 20 mm inside the slab.

**The geometry gate does not catch this.** `archkit/audit.ts` reported
`zfight 0 / defects 0` on the inside-out version — it checks coplanarity, not
orientation. Cheap standing check for any lathe or hand-wound prism: sum the
signed volume of its triangles about the object's own centre; a closed solid
must come out POSITIVE and within a few percent of its analytic volume. The
plinth slab reads +8.47 m³ against π·6²·0.075 = 8.48.

Two related craft points from the same slab:

- **A finish layer wants real thickness.** A material change on a flush face
  is a colour change; 75 mm of stone with a visible edge band, oversailing the
  drum by 22 mm, is a slab. The oversail also gives the joint a shadow line
  instead of a hairline.
- **Where an oversail lands over a stair, check it as a nosing.** The plinth's
  slab overhangs the drum 75 mm above the top tread by 22 mm — which is
  exactly a stair nosing's overhang, so it reads and behaves as one. Had the
  reveal been at ankle height on the final riser it would have been a
  toe-catcher.

`materials/library.ts` gained `darkMarble()` (slot `darkStone`). It uses the
fountain's vein technique — zero-crossings of a folded field over a
domain-warped 3-D noise, hairlines bundled to the bedding — on a dark palette,
duplicated deliberately: the shared kit must not import a feature module.

### A fabricated frame has ONE rule: containment, never butting

Posts, beams and a panel cannot meet without either interpenetrating or
butting — and butting is what makes coplanar pairs. So: **wherever two members
meet, one must contain the other's boundary completely.** For the Optimus
marque that meant posts slimmer than the beams in BOTH plan axes, dying 40 mm
inside the head beam rather than finishing flush with it; the sign carcass
running 30 mm into each post; each post running down into its own base plate
rather than sitting on it.

The first pass had flush-topped posts under a flush beam and the geometry gate
found **469 cm² over 6 pairs** immediately. After the rule: 0. The `clash`
crossings that remain are exactly those deliberate containments and are the
correct outcome, not a defect — the same category `archkit/kitBench.ts`
whitelists.

Corollary worth remembering: a base plate resting ON a deck puts its underside
in the deck's plane. Bed it 4 mm in. There is room inside any real slab.

### Backlit signs: the image IS the emitter — but crush a PAINTED halo first

For artwork that is a light source on a dark ground (neon, backlit acrylic),
feed ONE `texture()` node to both `colorNode` and `emissiveNode.mul(rung)`.
The dark ground stays dark, only the legend crosses the bloom threshold, and
you never fight a separate glow mask. Pattern already in `parkAmenities`
(`signs-lit`); the Optimus marque is the second user.

**Caveat that cost two frames:** artwork that ALREADY has a glow baked into it
double-counts. Emitting the Tesla marque flat at rung 3.4 put **26 % of the
panel over the bloom threshold** against a true stroke area of **1.53 %** —
the scene's bloom spread that again and the letter counters filled in solid.

The obvious fix, a power curve on luminance, is a trap: crushed hard enough to
keep the counters open up close (`lum^6`, 1.42 % blooming) it **collapses
under mip averaging and the sign switches OFF at distance** — measured peak
0.68 at mip4, under the threshold. Use TWO terms instead:

- a **core** term, `smoothstep(lo, hi, luminance) · gain`, that only opens on
  the real strokes — the only term allowed over the threshold, so the only
  thing that blooms;
- a **base** term, `luminance · g` with `g < 1`, capped under the threshold by
  construction, which carries the painted halo as plain lit panel and keeps
  the sign readable once mips have thinned the strokes.

Marque ships at core `smoothstep(0.62,0.95)·1.7` + base `·0.5`: 2.63 %
blooming, peak 2.20, and 6.9× less bloom energy than the first version at
mip4 while still glowing there.

**Measure this, do not eyeball it.** Decoding a PNG in node is ~40 lines
(parse IHDR/IDAT, `zlib.inflateSync`, undo the per-scanline filters), and
box-averaging the band in LINEAR light simulates the mip chain. That is what
turned "it looks mushy" into the table above.

Rules that came with it:

- the lit quad stands a few mm PROUD of its carcass, never coplanar with it;
- emissive faces do not cast shadows;
- map a horizontal BAND of the source at its true pixel aspect rather than
  stretching the whole image onto a wide panel, and mirror the u handedness
  per side on a double-sided face or the mark reads reversed.

### Driving an animated material: uniform from `ctx.time.sim`, not TSL `time`

The park pauses. TSL's `time` does not, so a material animated on it keeps
breathing over the pause menu. Feed a `uniform` from `ctx.time.sim` in a
system's `update()` instead — and feed it `sim % period`, not raw seconds: a
float32 uniform loses sub-frame resolution after a few hours of clock and the
animation visibly quantises. (The Optimus visor pulse, `LED_PERIOD = 2 s`.)

## Second external port: the launch site (2026-08-12, Starship / OLIT)

Full write-up: `dev_docs/systems/starship.md`. The generator + parity-harness
method from the Optimus port held up unchanged on a second, quite different
reference (1,888 lines, 186 patches, 352,746 triangles, bit-identical). What
was NEW this time:

### Prove parity by running BOTH builds in one process

Optimus used checksums (counts + weighted sums). Better, when the reference is
a self-contained `<script>`: **evaluate the reference itself** with `new
Function` against a stub `THREE`, run the port beside it, and compare the raw
`Float32Array`s element for element. `tools/starship-parity.mjs` — no checksum
to argue about, and it catches a reordering that a sum would not.
The demo's TSL surface only has to *exist* for this (materials are never
called), so a `Proxy` returning itself for every name is enough.

### A second Blender kit is the right answer, not one merged kit

`procgen/sslib/` sits beside `procgen/blenderkit/`. Different Blender library
(sslib.py's `MB`/prism/lathe vs optlib.py's curves/CSG/bevel), different node
implementation (raw **WGSL** vs TSL), different output (non-indexed + groups vs
indexed + welded). Merging them would put one demo's pixels at the mercy of the
other's edits. **Extend the kit your source came from; do not unify.**

### `positionLocal` in a ported material makes the SCENE GRAPH load-bearing

Blender's *Texture Coordinate > Object* ports to `positionLocal`. Any port using
it must keep its geometry in the source's own local frame, with the source's own
per-object transform, under a Z-up→Y-up parent — and the world placement goes in
a group OUTSIDE that. Bake the transform into the vertices (or collapse the two
groups into one Euler) and the texture space moves: the surfaces still render,
they just stop looking like the reference. Four of this demo's twenty materials
read it.

### Raw WGSL (`wgsl` / `wgslFn`) is available and is sometimes the honest choice

First use in the project. Blender's lookup3 hash / Perlin / fBm / HexGrid go in
verbatim as WGSL functions injected with `wgsl()` and wrapped with `wgslFn(code,
[dep])`. TSL's `mx_noise` is a **different noise basis** — substituting it is
not a port. Cost: it compiles only at render time, so nothing about it can be
checked headlessly. Typing is loose (`Node`, not `Node<'float'>`); cast at the
wrapper, once.

### A reference build's own defects survive the port — find them and SAY so

Parity means importing the source's mistakes. This one seats six OLM leg
footings and the QD block flush ON the pad slab instead of 20 mm into it:
**91.2 m² of coincident horizontal face**, the class this project bans. Kept
(parity was the brief; the deck is seen at 0.25° from 215 m), reported, and the
two-number fix written down.

Worth building for this: a **coincident-plane census** that buckets horizontal
triangles by world Y to the millimetre, then RASTERIZES each candidate pair to
get true overlap. Sharing a plane is not the defect — two parts 23 m apart in
plan shared a Y here and are harmless. Overlapping on one is. Record known
demo-inherited planes as a baseline so the gate still fails on anything the
port introduces itself.

### Grading a site into `exteriorHeight`: apply it LAST

`exteriorHeight` ends with a blend toward `interiorHeight` (66 % of it even at
r 177). Anything that must be genuinely FLAT — a launch platform, any future
pour out there — has to be applied **after** that blend or it rides the dome's
own falloff. Measured 0.00 mm across 69 × 63 m once moved to the end.

Two more rules for exterior pads: make the skirt wide (30 m here) because the
valley mesh is polar with ~10 m radial rows and a tight ramp reads as a
staircase; and add the footprint to **both** boulder-scatter loops — the
existing corridor sweep only covers |x| < 58–70 and says nothing about a site
off to the side.

### Extending the shadow ladder: add a RUNG, do not stretch the last one

A 147 m caster 215 m outside the dome left the outermost clipmap level (260 m)
from the far rim — the whole stack flipped to flat-lit as the player walked
north. `CLIPMAP_LEVELS 4 → 5` with `maxDistance 260 → 380` keeps every tuned
half-width exactly where it was (`15 · 2.59³ ≈ 260.6`) and adds one level for
the new range. Widening the fourth instead would have coarsened L3's texel 46 %
for one object. Cost: one cached map + one sample per lit pixel.

`lightMargin` scales with the tallest caster by the file's own `h / sin(27°)`
rule — 144 m crown → 317 m → set 360. It only widens the depth slab, and
`shadowDepthBias` divides by that slab, so the world-space receiver offset is
unchanged and no other shadow constant needs retuning.

### Skip LOD when the object can never be approached

Optimus gets three LODs (890 k tris, 1 m away). This gets none: 353 k tris that
never come closer than 215 m or subtend more than ~35°. A coarser tier would
save draw work the frame does not miss and cost a second 34 MB vertex buffer.
Do cull **per part** rather than per assembly — from inside the dome the ship is
on screen while the pad under it is not.

### Shadows on METAL are mostly cast shadows — the receiver decides, not the caster

Shipped the launch site with `castShadow`/`receiveShadow` on the stack and
nothing else, reasoning that the ground shadow was invisible anyway because the
exterior terrain does not receive. Owner report: *"i don't see the shadow."*
Both halves of that were wrong in an instructive way.

- **A metal asset barely self-shades.** `metalness 1.0` has no diffuse term;
  almost all of its appearance is environment reflection, which a shadow map
  does not attenuate. Giving a stainless rocket `castShadow` and calling it
  done changes nearly nothing about how it looks.
- **So the shadow you are buying is the CAST one, on the ground** — 287 m of
  tower shadow at 27° elevation, sweeping across exactly the sightline from
  inside the dome. If the ground does not receive, the whole feature is
  invisible and the object reads as a decal pasted on the terrain.

`exteriorTerrain`'s valley now has `receiveShadow = true`. **Before enabling a
caster, check what it is going to land ON.**

And the follow-on: once a floor starts receiving, everything standing on it
that does not cast becomes the new artifact. 2 600 boulders needed shadows
too — through a **detail-1 proxy on `STATIC_SHADOW_PROXY_LAYER`, limited to
r < 510** (camera ≤ 122 + outermost level 440 = nothing further can reach a
map). 109 k triangles instead of 832 k, identical silhouettes.

### The clipmap's usable reach is NOT `maxDistance` — it is `maxDistance · 0.88 · 0.84`

`levelData.z` is `halfWidth · (1 − guardBand)` (guardBand 0.12) and the shader
fades a further `blendRatio` (0.16) before that. A gate written against
`maxDistance` says "covered" while the object is actually sitting in the fade
band at 76 % weight. The metric is also a **Chebyshev** distance in the
clipmap's own light basis (`lookAt(ORIGIN, lightDirection, +Y).invert()`), so
an audit that invents its own perpendicular axes gets a different number.
Replicate both or the check is theatre — `tools/starship-site-audit.mjs`.

### Movement input must be normalized before it is scaled by target speed

`PlayerInput.forward` / `.strafe` are each −1/0/+1, so any diagonal (W+D,
S+A, …) is a √2-magnitude stick. Multiplying that raw by `SPRINT_SPEED`
made a diagonal sprint run at 5.94 m/s instead of 4.2.

The visible symptom was NOT "I move too fast" — it was **footsteps that got
faster than sprint when strafing**, because the cadence law
(`CADENCE_BASE + planarSpeed · CADENCE_SLOPE`) reads TRUE planar speed, so
the overspeed extrapolated past the 4.0 steps/s sprint cadence to ~5.0.
Anything derived from real speed (bob, cadence, future stamina/dust/audio)
will amplify a locomotion bug into a symptom that looks unrelated to speed.
Fix is at the source: `targetSpeed / max(1, hypot(forward, strafe))`.

## Zero-compromise performance sweep (2026-08-13)

- Chromium WebGPU cannot upload a `CanvasTexture` whose canvas has never
  acquired/painted a 2D context. The three untouched Ops canvases caused the
  three `CopyExternalImageToTexture()` warnings; paint their real initial
  state before constructing the texture, then keep the authored refresh
  cadence.
- `@dimforge/rapier3d-compat@0.19.3` itself calls wasm-bindgen with the
  deprecated positional initializer. Keep its exact WASM and patch only the
  wrapper call via `tools/patch-rapier-init.mjs`. The regular
  `@dimforge/rapier3d@0.19.3` WASM has a different SHA-256/byte length, so it
  is not an acceptable silent substitution when behavior must remain
  identical.
- Reuse owner-held scratch objects only across synchronous consumers that do
  not retain them. This safely covers audio listener axes, robot steering
  deltas, tram curve samples/collider centres, seat-pose records, player
  movement records, and frame timing; it does not justify broad matrix
  freezing or any render/simulation budget reduction.

## Owner fix session (2026-08-13, afternoon): five targeted defects

- **An Euler component is not an angle after `rotateX`.** `placeCars` did
  `car.rotation.set(0, yaw, 0)` then `car.rotateX(-pitch)`; three re-derives
  `rotation` from the quaternion, so `car.rotation.y` became
  `asin(sin yaw · cos pitch)` — right only inside ±90°, wrong over half the
  Loop. The tram's collider took its yaw from there, so it stood ACROSS the
  car on half the circuit. Symptom pair: "blocked where nothing is" AND "I can
  walk through the wall". **Record the angle you computed; never read it back
  out of an Euler.**
- A bounding box is not a collider for a tapered body. `CAR_WIDTH/2 + 0.05`
  stood 0.44 m proud of the skin at the nose (0.85 m with the capsule and the
  controller offset). `RAPIER.ColliderDesc.convexHull` over the analytic skin
  is exact where the section is convex and bridges only what should be solid
  anyway (the door bay, the bogie tunnel). 2 652 points, built once, shared.
- **A forward-only lookahead biases every heading.** Taking a car's yaw from a
  point 1.5 m ahead lags the true tangent by half that chord: 0.44° of outward
  yaw, and 13 mm of separation between two cars' coupler faces on the Loop.
  A CENTRED chord (`s ± 0.75`) is free and exact on any circle.
- **Kinematic placement at fixed ARC offsets makes coupler distance breathe.**
  Two cars 8.7 m apart on the real Loop present 0.226…0.350 m between their
  coupler faces, and up to 0.773 m through the spur's terminal hook. Anything
  bridging two independently-placed vehicles must TELESCOPE: fixed root, head
  placed at the measured length, scaled run between. Only scale the run — a
  scaled flange or ball is instantly visible.
- **`revolveZ` (dome/connectorTube) wants CLOCKWISE (r, z) profiles**: its
  normal is the LEFT normal of travel, `(−dz, dr)`. The portal collar was
  authored CCW and shipped inside-out for the whole project's life — the
  bulkhead drum was a culled backface. The hazard band beside it was CW, which
  is how the two disagreed without anyone noticing. Same family as S14's
  inside-out tube barrels; check winding FIRST when a big revolve looks wrong.
- **A `min()` in a swept rim is a fold generator.** The portal skirt's outer
  rim was `min(collarFace, apertureZ − 0.4)`; the branch swap-over latitude was
  a hard crease, which is what read as "triangular faces", and the wrong branch
  pointed the rim back into the park through the glass. Sweep to the real
  boundary and shape the meridian instead.
- **`writer.quad` flat-shades.** Right for a machined plate, wrong for every
  barrel: a 9.7 m drum on 72 segments facets into 0.85 m plates. Anything
  curved needs per-vertex normals through `writer.raw` — analytic around a
  surface of revolution, central differences on a warped grid.
- **Decide which local axis carries a part's LENGTH before picking a yaw
  helper.** `prismXZ` extrudes along +Y; `prism` of a plan polygon carries its
  length on +X. `crossYaw` is for the latter. Getting it backwards rotated every
  transom in the Overlook drum 90° — 62 bars poking radially into the room,
  attached to nothing. (Same trap as W2-works' "body of revolution's axis" and
  W2-commons' `rotateZ(phi)` vs `phi − π/2`.)
- **Furniture has to respect the circulation, not just the wall.** The lounge's
  coffee console was 0.8 m in front of the door; but the fix is not "slide it
  along the wall", because the stair already claims u 1.85…3.35 and the whole
  east flank is a 1.35 m entry corridor. Audit the CORRIDOR (`tools/lounge-
  audit.mjs` sweeps a capsule in from the threshold, then laterally).
- **Cup and ruffle must scale with a leaf's LOCAL width.** Scaling them by the
  blade's maximum fanned the petiole open (±80 mm of ruffle on a 15 mm stalk)
  and dropped the outer whorl 56 mm below the tray. Real modelled crops at
  ~108 tris/head cost 1.27 M instanced triangles across ~11 800 plants — but
  they drop the alpha test, which double-sided cut-out cards make expensive.
- **Two districts anchored on two `parkPlan` constants cannot notice they
  overlap.** The hydro tower at (52, 18) ate 6.7 m of the glasshouse at
  (70, 22) and its spiral stair stood entirely inside that house. Solve a
  building's site against its neighbours' real extents and keep the solver:
  `tools/farm-layout-audit.mjs` builds both districts and compares every part
  box (773 intersections at the old site, 0 at (37, 23)).
- **One aimed group per TARGET, not per assembly.** The coupling's bar ends on
  the socket seat; its jumper hoses end on the rear car's head TIP, 0.16 m
  further along that car's own axis — which is up to 4° off the bar's aim. Both
  in one aimed group left the hose ends 139 mm short on the Loop. Two aims from
  one origin cost nothing and are exact (measured error = the authored 4 mm
  reveal, on every curve).
- New headless gates this session, all node + `--experimental-strip-types`, no
  browser: `tools/tram-coupling-audit.mjs`, `tools/lounge-audit.mjs`,
  `tools/crop-audit.mjs`, `tools/farm-layout-audit.mjs`. The lounge one's
  "floating part" test — a part whose inflated box touches nothing else and
  reaches no floor level — is generic and worth porting to other interiors.

## Owner fix session (2026-08-13, evening)

- **A bogied vehicle is placed by its BOGIES, not by a point on the alignment.**
  `tramSystem.placeCars` used to set each car's position to a curve sample and
  its heading to a ±0.75 m chord. On the arrival spur's hook that threw the
  car's own bogies **0.82 m off the guideway** they run on, and blew the
  coupler-face span out to 1.97 m. Chording between the two bogie centres
  (±2.45 m) is one line of change and brings the worst wheel error over the
  whole park to 66 mm and the span to 1.24 m. Anything else carried on a pair
  of trucks should be placed the same way. `tools/tram-alignment-probe.mjs`
  prints both models side by side.
- **The arrival spur's hook is a 5.3 m radius.** `ARRIVAL_SPINE` runs dead
  straight down x = 0 to the portal and then has to meet the loop tangentially
  at (0, 97), which is a ~85° reverse curve inside 11 m. Two rigid 8 m cars on
  that sit **53° apart while docked** — the pose guests stand next to for 22
  seconds — with 1.45 m between their coupler faces against 0.58 m on plain
  track. Every choice in `tramCoupling` follows from that measured range. If the
  alignment is ever revisited, that hook is the thing to fix; nothing
  downstream of it can be made to look like real hardware for free.
- **A joint's TYPE is set by the worst angle it sees, not by the nominal one.**
  A spherical seat closes over its ball at ~66°, so it cannot pass a bar leaving
  at 95° — which is what the rear car asks for at the stop. A vertical KINGPIN
  in an open fork has no yaw limit at all, and pitch/roll on a 4 % grade is a
  bush's job. Check the extreme before choosing the mechanism.
- **Absorb a stroke by TRANSLATING parts, never by scaling one.** The old draw
  gear stretched a ribbed bellows over 0.06 → 0.61 m; past about double, a
  bellows reads as a lumpy sausage. Four nested 0.44 m tubes cover 0.58 → 1.45 m
  with 135 mm of overlap in hand and no part is ever distorted.
- **A flexible part has to be REBUILT, not posed.** The jumper hoses are a
  fixed-topology tube whose positions and normals are recomputed each fixed step
  from a Hermite between the two glands (22 × 8 verts; free at 60 Hz). Two
  things it taught: the arriving tangent's rise is NEGATIVE (it is a direction
  of travel, not an offset), and the glands must be CANTED outboard and up —
  aimed along their own car's axis they aim across the *other* car's nose on the
  hook, and the hose's first third runs through it.
- **Colliders are a separate model and they rot separately.** The Overlook
  Lounge had correct stair geometry with ONE SOLID BOX over each flight, drum
  walls that stopped 0.54 m above the mezzanine floor, and no roof deck at all —
  so two of its three storeys were unreachable and the third was fall-through.
  If a building has floors, gate the WALK, not the parts: `tools/lounge-audit.mjs`
  now climbs both flights against the collider set with the real capsule and
  autostep, and checks headroom, landing heights and edge protection.
- **Quantised colliders cut apertures in the wrong place.** Tiling the roof
  terrace on a fixed 1.35 m grid and dropping any cell that touched the stair
  well moved the well's edge outward by up to 0.77 m — the head of the flight
  came out over open air. Tile each band around the aperture with cells sized to
  divide it exactly instead.
- **`asin` gives you an angle, not an arc.** The mezzanine's chord-cut plate
  swept `[−(π − tCut), … ]` over `π + 2·tCut`, which is neither symmetric about
  the drum's axis nor the right length: the plate shipped as a lopsided crescent
  running from v = +2.25 on one flank to −6.18 on the other, 8.4 m out of true.
  For `az·sin t ≤ chordV` the arc is `[−π + asin(−chordV/az), −asin(−chordV/az)]`.
  Derive the limits from the inequality you actually mean.
- **Bury a rim inside solid material rather than landing it on a face.** The
  portal hood's two bad seams were a sheet landing tangentially on the bulkhead's
  flange plane: every meridian's last half metre sat within its own 55 mm wall of
  that plane, and at the two meridians where the glass aperture crosses z =
  127.10 the WHOLE meridian did. Moving the rim to (r 9.52, z 127.90) — inside
  the casting, between the flange and the petal slot — makes every meridian
  PIERCE the face at 24…58° instead, and trimming the hood to the arc where it
  genuinely stands clear removes the buried lower half entirely.
  `tools/portal-audit.mjs` gates the crossing angle and the coplanar band width.
- **A stair you do not want climbed still has to STOP you.** The hydro tower's
  spiral only collided its newel, so guests walked through the flight. It is
  now a flat-topped barrier over the sector where the treads are below head
  height — 3.4 m tall so it cannot be jumped in 0.38 g, and absent past that
  sector, where the treads are genuinely overhead and you should be able to walk
  under them.

## The Starship flies (2026-08-13)

Full write-up: `dev_docs/systems/starship.md` §8. The lessons that generalise:

- **A scripted flight path looks scripted; an integrated one does not.** The
  give-away for a keyframed launch is that its speed at any height is whatever
  the curve says, not what the last few seconds of thrust earned. Author the
  two things the vehicle actually controls — throttle and where it points — and
  let position fall out of `a = T/m·axis − g` at the fixed step. It is not more
  code than a curve and it cannot look wrong.
- **ZEM/ZEV terminal guidance is the right tool for "land on the exact spot",
  and it has two teeth.** With `r_f = 0, v_f = 0` it collapses to
  `a = −6r/t² − 4v/t + g_up`. (1) **Recompute `t_go` every step** (`2z/v_descent`);
  counting a t_go fixed at ignition down to zero diverges the `6/t²` gain while
  the vehicle is still hundreds of metres up — my first build flew the stack to
  344 km. (2) **Clamp the thrust and the axis.** Unbounded, it will ask for any
  acceleration the geometry implies: asked to null 3.2 km of crossrange in 17 s
  it inverted the vehicle and demanded 7 700 g. Give it a problem it can fly —
  back-solve the entry state so the free fall does the transport and guidance
  only trims.
- **Simulate the profile headlessly before wiring it to a scene.** ~40 lines of
  node against the flight class printed the phase table and caught all of the
  above, plus three continuity traps that would otherwise have shipped: an
  attitude snapping 13° in one frame (25 m of nose travel on a 147 m vehicle),
  a crossrange nulled on a time constant that read as a sidestep, and a
  re-entry teleport landing where the vehicle was still a visible size. None of
  these are visible in code review; all are obvious in a printed table.
- **`MB.add_v` never welds.** Every `prism()`/`lathe()` in `procgen/sslib`
  appends a fresh vertex island, so primitives in one MB share no vertex, edge
  or smoothing group. That makes splitting a fused generated mesh into movable
  pieces **provably lossless** — rebuild the sub-parts into their own MBs and
  the union is the original, triangle for triangle. Prove it, don't assert it
  (`tools/starship-split-audit.mjs`), and keep building the fused object so the
  parity harness still has something to compare.
- **Parity survives a movable asset if the split happens after the payload.**
  Two `export` patches in the generator (kind 1, already sanctioned) plus a
  swap in the hand-written `starshipBuild.ts`. The generated files still emit
  exactly what they emitted.
- **A swept-volume clearance test must use the plan SILHOUETTE, not a radius.**
  My hand arithmetic used the vehicle's max radius and got 10.75 m, set by the
  ship's flaps — where the real footprint is a 4.5 m hull with four flaps and
  four fins at fixed azimuths (the vehicle does not roll). The disc test
  condemned the QD arm, which nothing ever passes over. Rasterise the mover
  into a plan grid holding the **lowest geometry per cell**; a static member is
  fouled exactly when something stands over its cell at or below its height.
  It is barely more code and it is exact.
- **Measure retraction angles, don't reason them.** Every number I derived by
  hand for the arms was wrong, in both directions — the parked fouling was 44.7 m
  and not 0.7 m, and the tower contact I predicted at one angle appeared at
  another. `tools/starship-clearance-audit.mjs` swept the angles in seconds.
- **Anything that MOVES cannot be in the cached static shadow bundle** — it is
  sealed during the loading frame and immutable after, so its shadow stays
  welded where the object was. `markDynamic()` is the fix, and the cost is that
  the dynamic caster maps are **camera-centred and short** (12/90 m): an object
  200 m away lands in none of them and silently stops casting. If it matters,
  add a rung sized to the object's LIGHT-space reach, not its distance.
- **Emission strength and cloud lifetime are different things.** Multiplying
  particles by a live "how hard is the pad being hit" value snaps the whole
  dust column out of existence the instant the engines cut. Hold the strength
  and bleed it over the particles' own lifetime.
- **Methalox plumes are blue-violet, not orange.** The orange in launch footage
  is recirculated pad debris and afterburning. And in a thin atmosphere the
  nozzle is grossly under-expanded, so the plume blooms into a huge bell
  immediately and keeps blooming with altitude — that flare is most of what
  says "not Earth". Put orange only on the cool entrained skirt.
- **Use a cone of revolution for a plume, not an axis-aligned billboard.** The
  ribbon is cheaper and degenerates to a line exactly when the viewer is under
  the vehicle looking up the axis — which is most of an ascent seen from 215 m.
- **Hide the mesh, not the group, when an effect must outlive its object.** The
  plume is a sibling under the flight transform; cutting the vehicle's meshes at
  ~1 px lets the exhaust go on fading, which is what a distant launch actually
  looks like. Fading the meshes themselves was not available — the port shares
  one 20-material array between the vehicle, the tower and the mount.

### Two corrections after owner review (2026-08-13)

- **Drive a mechanism off the thing it has to avoid, not off a timer.** The
  chopsticks were opened during a pre-launch hold on a phase timer. The owner's
  correction — they should spread as the vehicle climbs out through them, and
  close as it comes back down — is not just more real, it is *cheaper to get
  right*: `armOpen = smoothstep(0, H, altitude)` is one function for both
  directions, so the descent cannot drift out of step with the ascent because
  it is the same schedule read backwards. And because the pose then depends on
  a single parameter, "do they ever touch?" stops being a question about timing
  and becomes a walk over a one-parameter family that a tool can just check.
  It has a real ceiling — measured, a never-moving arm is ploughed from 20.5 to
  44.5 m of ascent, the schedule is clean to H=44 and fouls at H=46 — and my
  first guess (60 m) put 0.42 m³ of truss through the vehicle.
- **A plume must not have a silhouette.** Nested additive lathe shells read as
  "a solid cone bolted to the tail" (owner report) no matter how they are
  shaded. The radial-brightness reasoning that justified the mesh was sound and
  irrelevant: what makes exhaust look like gas is that its EDGE is made of
  separate parcels moving at different speeds and dying at different distances.
  Instanced camera-facing parcels flowing down the axis, growing as they go.
  Bonus — it removes the reason the cone was chosen over a ribbon (a ribbon
  degenerates to a line when viewed along the axis; billboards have no
  preferred direction).
- **Keyed to distance, not to age.** Shock diamonds stand still in space while
  the gas flows through them. Modulate on axial position and parcels brighten
  as they cross a node; modulate on parcel age and the whole plume strobes.
- **Cache voxelisations by pose when sweeping a parameter.** The clearance walk
  re-voxelised a 1 600-triangle arm thousands of times and ran for minutes;
  memoising on the angle quantised to a quarter degree cut it to ~45 s, because
  a few dozen distinct angles serve the whole sweep.

### The wheeled robots' ring (2026-08-13)

- **Steady point-source loops must be broadband and out of 2–4 kHz.** The four
  ground robots were one thin sawtooth each at 1150–1670 Hz behind a Q=6
  bandpass at 1500–1860 Hz, running always, at a fixed pitch. Owner report:
  "really high pitch ring, unpleasant" — and it *is* a ring, not a robot, for
  three independently sufficient reasons. A high-Q band on a saw is a whistle,
  the band sits on the ear's sensitivity peak, and nothing about it moves. If a
  loop never stops, none of those three is survivable.
- **Machine voices belong in the motor register.** The replacement
  (`src/audio/robotVoice.ts`) is four layers, all under ~900 Hz: drive hum (saw
  into a lowpass that opens with load), gear mesh (TRIANGLE at 4.5× the
  fundamental — a saw there re-introduces the whistle an octave up), roll grit
  (brown noise bandpassed by wheel radius), brush swish for rigs with
  `spinners`. Noise carries the moving cue because noise cannot ring.
- **Derive the modulator from the geometry that already exists.** Drive pitch
  is the motor pole-passing rate off real wheel revolutions per second
  (`speed / 2πr`), so the fleet's voices separate by wheel size for free —
  sweeper 0.132 m sits above the mule's 0.186 m without a per-robot table.
- **Measure speed from the position delta, never from the configured field.**
  `robot.speed` is the routine's *setting*; robots hold state `'moving'` while
  they stand still yielding to the player, so a declared-speed gate has them
  droning at a wall. A frame delta gets pauses, yields and corner damping right
  with no extra state, and hands you a continuous value for pitch as a bonus.
- **Idle needs a texture, not a tone.** A parked machine held at low gain on
  the same oscillator is exactly the ring, quieter. While `'working'` the grit
  layer now swells on `|sin(toolPhase · 2.2)|` — the identical term
  robotsSystem bobs the rake/brush with — so the scrub you hear is the stroke
  you see. Reuse the animation's own phase term for its sound wherever one
  exists; it costs nothing and can never drift.
