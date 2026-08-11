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
