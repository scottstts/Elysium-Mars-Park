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
