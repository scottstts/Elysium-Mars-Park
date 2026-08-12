# Render pipeline (S1)

Single `RenderPipeline` (three r185 name for the post graph) owns the final
image; `pipeline.outputColorTransform = false` and the one output transform is
the explicit `renderOutput(exposed, Neutral, sRGB)` in the graph. Renderer never
tone-maps (side targets stay linear HDR).

Signal order: scene MRT (color + normal/aoReceiver-alpha, MSAA 4×) → GTAO
(half-res R16F six-slice gather → separable bilateral denoise) → full-res joint
bilateral reconstruction → hdrTransform hook → bloom → fixed EV exposure →
Neutral → 32³ Mars LUT + vignette.

Choices beyond the code:

- **GTAO is project-owned, not Three's stock `GTAONode`.** The gather keeps
  the cosine-weighted Activision integral, but distributes the same 36 depth
  taps over six slices instead of three, uses non-repeating IGN rotation,
  writes scalar visibility to R16F, and denoises it with a separable 5-tap
  depth/normal bilateral before a four-neighbour joint bilateral upsample.
  Reversed-Z guards, epsilon-safe normalisation, off-viewport rejection and
  receiver-alpha are part of the contract; do not simplify them independently.
- **AO receiver mask** rides the normal MRT alpha — and since the
  moving-rectangle fix (2026-08-11) that alpha is also the WRITE AUTHORITY.
  r185 gives non-`output` MRT attachments NO blend state (material blending
  applies to `output` only; per-material MRT blend modes are read from the
  PASS node only, and `MRTNode.merge` drops them besides), so every
  transparent fragment used to REPLACE the normal+receiver buffer across its
  full rasterized footprint — a sprite's whole quad, which is the
  greenhouse-mist "moving dark rectangles" artifact, mis-fixed twice before
  the mechanism was found. The pass now sets
  `setBlendMode('normal', new BlendMode(NormalBlending))`: opaque materials
  write alpha 1 → exact replace, bit-identical to before; mist/vapour
  override `mrt({ normal: vec4(0) })` → zero authority, G-buffer untouched;
  glazing's `vec4(normalView, 0)` now PRESERVES the background pair
  (consistent with the background depth glass never writes) instead of
  forcing receiver 0 — AO seen through glass is the background's own, which
  is the physically right answer. Any future transparent/additive billboard
  MUST carry the `vec4(0)` override; the pass default writes alpha 1.
- **`hdrTransform` hook** is where S4's interior haze + shafts transform the
  HDR image (depth-aware), keeping the pipeline file effect-agnostic.
- **Fixed authored exposure** (`gradeParams.exposureEV`) — no meter, no
  adaptation; the frozen afternoon makes metering pointless (plan §0).
- **Mars grade**: warm shadow lift (Mars skylight is butterscotch — shadows
  go warm, never Earth-blue), red gain/blue pull, and green-dominant vibrance
  boost so scarce vegetation pops (design pillar "green is currency").
- `compileAsync()` adapter reaches into `RenderPipeline._quadMesh` (guarded,
  throws on upgrade) because r185 lacks a public async compile for it.
- `?pass=` views: final · nopost · ao · aoraw · aodenoised · aoradius ·
  aoshare · aoapplied · bloom · depth · normal · shafts · shadows (last two
  filled by S4 via `pipeline.debugNodes`). `aoradius` is projected gather
  radius divided by 16: white means the AO gather is fully competent.
- Gallery scene (`?view=gallery`) is the standing calibration set: PBR
  sweeps, emissive bloom bar, thin-member AO sentinel, contact boxes.

## AO barcode correction (2026-08-12)

The dark vertical bars visible on broad surfaces when looking toward the sun
were AO sampling structure, not a material texture, shadow-map cascade, haze,
or output quantisation. Three r185's stock node combined four properties that
made the error coherent:

1. `samples = 16` selects only **three angular slices** (six radial steps on
   each side, 36 depth reads total), so the missing directions form long
   screen-aligned lobes rather than isotropic noise.
2. The per-pixel rotation repeats a 5×5 magic-square texture.
3. The default `RedFormat` target is `R8Unorm`, quantising visibility before
   reconstruction.
4. The node exposes the raw gather; the old full-resolution 3×3 fallback could
   organise that coherent error into bands instead of removing it.

Looking toward the sun exposes the defect because camera-facing surfaces are
often back-lit: the indirect-share composite gives AO much more authority when
`N·L` is small. The analytic lattice visibility can reduce the local direct
term further. This changes contrast, not the spatial frequency, which is why
the bars follow the screen and shift slightly with camera movement.

`GtaoVisibilityNode` fixes each cause while preserving existing lighting
ownership. It uses six angular slices × three radial steps × two sides, so the
raw horizon budget remains 36 depth reads. Stable interleaved-gradient noise
rotates the slices without a repeating tile. Raw and filtered visibility live
in filterable `R16F` targets. A separable binomial bilateral removes gather
noise at half resolution, followed by a four-tap full-resolution joint
bilateral that preserves geometry edges. There is deliberately no temporal
history: robots, tram cars, foliage and transparent effects have no velocity
buffer, so temporal AO would trade the bars for ghosting.

The old fixed 28→70 m retirement was a symptom mask and is gone. Competence is
now derived from the 0.9 m world radius projected into AO-buffer pixels, so it
self-adjusts to viewport size, dynamic render scale, FOV, and quality divisor.
AO reaches full authority at 16 projected pixels and retires below 8. The
receiver mask, indirect-only share, radius, thickness, power, and distance
spacing are otherwise unchanged, containing regression risk to AO sampling
and reconstruction.

---

# Overhaul W1-light — the dusk look (2026-08-10)

The first build read as "a uniform tan wash with no shadow presence and no
artificial light". Five things caused that, and all five are pipeline-side.
Recorded here because each one is a decision that is not visible in the code.

## 1. Tone mapping: AgX → Neutral

AgX desaturates hard through the whole mid-range. On Mars Park that is fatal
rather than merely stylistic: the palette is ALREADY one hue family (rust
regolith, ochre paving, butterscotch sky, warm steel), so an operator that
pulls chroma out of the mids collapses four different materials onto the same
tan. `NeutralToneMapping` (Khronos PBR Neutral) holds chroma up to its
compression knee and desaturates only genuine near-white — which is exactly
the reference image's behaviour. **Single tone-map ownership is unchanged**:
`renderer.toneMapping = NoToneMapping`, `outputColorTransform = false`, one
explicit `renderOutput()` in the graph.

## 2. The sky palette and the grade are ONE system

`sky/skyRadiance.ts`'s three stops were solved backward from
`ref_images/mars_park.png` **through the whole shipped chain** (+0.15 EV →
Neutral → sRGB → the 32³ LUT), not picked by eye in linear space. There is a
CPU mirror of that chain used to do it; if the palette ever needs re-tuning,
rebuild the mirror rather than nudging one end. Tuning sky OR grade alone
puts the image straight back into the wash, because each compensates for the
other and the compensation is invisible in a single screenshot.

Concretely: horizon `(0.620, 0.335, 0.245)` → `#e7a584` on screen against ref
samples of ≈ `#e0ab8e`. The hue is nearly constant up the column; only the
value falls. The zenith is the one place blue passes green — that is what
makes it "dusty rose" instead of "dark butterscotch".

## 3. The grade: separation, not saturation

The S4 grade's vibrance term boosted LOW-chroma colours. In a world where
every surface is already red-orange, that pulls steel, concrete and sky toward
the regolith's ochre — it actively destroys the separation it looks like it is
adding. The new recipe has **no low-chroma vibrance at all**: a straight
saturation gain (1.10) leaves neutrals neutral by construction while rust gets
richer, and the only exception is the green-dominance protection that keeps
scarce vegetation precious.

Also: the key light was deliberately NOT made more orange. The reference's
gridshell and panels read close to neutral in the light; that frame's warmth
comes from the sky, the dust and the made light. An orange key is the fastest
route back to a one-hue image.

Three tonal weights (shadow / midtone / highlight) drive three independent
channel gains, so "warm highlights over cool-neutral shade" is expressible —
a global lift + gain cannot express it, and dusk shade must go slightly COOL
or the warm artificial layer has nothing to read against.

## 4. Output dither is load-bearing here

The sky is an enormous smooth gradient filling most of every outward frame,
and a contrast-adding LUT makes 8-bit banding worse. `marsGrade` adds one LSB
of triangular-PDF interleaved-gradient noise after the vignette. Screen-stable
(no temporal shimmer), invisible, and it removes the contours completely.

## 5. AO applies to indirect light only — via the RATIO, not an albedo buffer

`sceneColor.mul(ao)` darkens direct sunlight too — the documented "sunlit
surfaces become gray" failure, and a first-order cause of the flat read on a
scene whose subject is a low sun raking across paving.

**The albedo-MRT route is a dead end in r185 — do not spend a day on it
again.** Adding `diffuseColor` as a third pass-level MRT attachment compiles
and renders, but every material that does NOT set its own `material.mrtNode`
writes the *same* albedo: ground, foliage, benches and building shells all
came out one identical brown (0.577, 0.396, 0.247), while dome glass and
`milkyPanel` — which do override `mrtNode`, and therefore get their own merged
MRT node via `mrt.merge(materialMRT)` — were correct. Passing the property
node bare (`mrt({ …, diffuseColor })`, three's own SSRNode convention) instead
of wrapped (`vec4(diffuseColor.rgb, 1)`) changes nothing. Diagnose it with a
raw, unconverted tap; a `renderOutput()`-wrapped one hides how flat it is.

What ships instead needs no albedo at all. For a diffuse surface

```
sceneColor      = albedo · (E_ambient + E_sun · N·L · shadow)
indirectShare   = E_ambient / (E_ambient + E_sun · N·L · shadow)     ← albedo-free
direct + indirect·ao  ==  sceneColor · mix(1, ao, indirectShare)     ← one multiply
```

Both terms come from the same sky palette and the same sun the scene is lit
by (`marsAmbientIrradiance` + `ENVIRONMENT_INTENSITY` + `SUN_LIGHT_INTENSITY`),
so they cannot drift; `shadow` uses `latticeSunVisibility`, the one shadow
signal a post pass can evaluate exactly. This also *saves* a full-res MSAA 4×
render target rather than adding one.

Its known limit is building shadows: no shadow map is reachable from a post
pass, so a pixel in a building's shade still scores as "sunlit" and would lose
its AO. `AO_DIRECT_FLOOR = 0.45` is the answer — a floor on AO authority that
is independently justified (AO also occludes near-field bounce and part of the
0.35° sun's own penumbra). Diagnose with `?pass=aoshare` (black = pure direct,
white = pure ambient) and `?pass=aoapplied` (the term actually multiplied in).

`ENVIRONMENT_INTENSITY` lives in `sky/sun.ts` next to the sun, not inside
`SkySystem`, precisely because the PMREM bake and this reconstruction must
read one number.

The project GTAO has no bent-normal output, so the reference's bent-tint stage
is not implemented. Set: `thickness` 0.35 m (the named halo fix), `power` 2.0,
`distanceExponent` 2.0, `radius` 0.9 m (up from 0.3). Radius and exponent are
a pair: the reference image's grounding comes from 0.3–0.8 m features — kerb
noses, planter walls, bench legs, building bases — and a 0.3 m gather never
reaches the second surface of any of them, while a 0.9 m gather with linear
tap spacing loses the tight contact line. Exponent 2 crowds taps toward the
centre and buys both.

## 6. Key/fill ratio is the dusk look

Sun 2.6 → **3.15**, `environmentIntensity` 0.5 → **0.33**. Raising the key and
dropping the fill together is what makes shaded parts of the dome read
dusk-dim so the artificial layer registers, *without* making the scene look
like night — the sunlit paving is every bit as bright as before. It is still
late afternoon; the fixtures read because the shade got deeper, not because
the world got darker.

## 7. Interior medium: bounded by construction

`dome/interiorHaze.ts` was a signed carve+glow that relied on the exterior
aerial medium for its base inscatter — and a signed difference cannot be
bounded. It is now one march producing `density` and `lit` (how much of that
medium the analytic lattice lets the sun reach); their ratio IS the shaft, and
the result is `mix(scene, inscatter, amount)` with `amount` hard-capped at
**0.18**. No view can paint the dome into a tan wall any more.

Glass clarity is the hard constraint the numbers serve: the slab dies at 48 m
(well under the 64 m crown) with a 24 m e-folding height, so a ray heading up
and out through the glazing leaves the medium after ~50 m and collects under
2 %. Only long horizontal interior sightlines approach the cap. Do not raise
`MAX_INTERIOR_HAZE` without checking `?view=rim` against the reference.

## 8. Bloom threshold anchors an authored emissive ladder

Threshold 1.6 → **1.0**, strength 0.16 → 0.30, radius 0.55, and `smoothWidth`
is finally set (0.08 — r185's default 0.01 is a hard cut that pops). 1.0 sits
just above the brightest ordinary lit surface (white paint in full sun peaks
≈ 0.9) and just below the dimmest authored emitter. The ladder itself lives in
`world/lightFixtures.ts`; four new `kitMaterials()` slots (`signageGlow` 3.4,
`floorLens` 2.6, `interiorGlow` 2.0, `utilityLight` 5.0) implement it. Scale a
fixture's AREA, never its multiplier.

## 9. Shadow clipmap ladder re-derived for the 260 m world

30/96/560 (three levels, cut for the 500 m dome) → **12/34.8/100.9/260** (four
levels). Two reasons: the finest level now resolves a kerb (5.9 mm texel on a
4096 map), and no level makes an outsized jump — the old 96→560 step forced
level-2 normal bias to 0.75 m, a peter-panning generator at park scale. Base
normal bias 0.03 → 0.014 (≈2.4 finest texels). `maxDistance` only has to cover
the dome: everything beyond the glass is analytic or too far to matter.

## 10. Real lights are rationed, and never toggled

Six of a budgeted eight shadowless lights, placed from `parkPlan.ts`
coordinates by `installLightFixtures()` (called from `SkySystem.init`, which
runs before any district, so districts can register in their own `init`).
Everything else in the artificial layer is emissive geometry + bloom.
`setIntensity()` is the only supported mutation: toggling `Light.visible`
changes the LightsNode cache key and synchronously rebuilds every lit WGSL
program in the park.

## 11. The depth buffer is NOT reversed — plan every epsilon against that

Several comments in this pipeline (and in `gtaoVisibility`, `marsAerialPerspective`,
`glassShell`) assert "r185 WebGPU is reversed-Z". **It is not.** `reversedDepthBuffer`
defaults to `false` in `WebGPURenderer` and nothing here passes it, so depth runs
0 = near → 1 = far with `less` compare. The guards those modules carry test BOTH
ends (`> 1e-7 && < 0.999999`), which is why nothing broke and why the belief
survived; treat the comments as unverified, not as a spec.

What it costs, with the camera at near 0.08 / far 14000 and `depth32float` (which
concentrates precision near the NEAR plane, so it buys nothing out here):

| view distance | 10 m | 30 m | 50 m | 80 m | 150 m |
| depth quantum | 0.07 mm | 0.7 mm | 1.9 mm | 4.8 mm | 17 mm |

So any two parallel surfaces closer than a few millimetres z-fight in the far
field while reading perfectly at arm's length — the works hall sign's printed
face over its backing plate was the first one big enough to see it (fixed with a
quantum-counted `polygonOffset`, not a wider gap; see `signageMaterial`).

Two levers exist if this bites again more broadly, both renderer-wide and both
needing a real visual pass before adoption: raising the near plane (quantum ∝ 1/near)
or enabling `reversedDepthBuffer` (~500× at 50 m, and it would make the comments
above true). Neither is applied.

## 12. Sun-shadow filter — Freedom deck sawtooth resolved

Facts, so nobody re-derives them:

- `renderer.shadowMap.type` is three's default `PCFShadowMap`, so the filter is
  `PCFShadowFilter`: 5 Vogel taps on a `radius`-texel disk, IGN-rotated per pixel.
- **Hardware PCF is already on.** `ShadowNode.setupShadow` overwrites the depth
  texture's filters to `LinearFilter` for PCF/PCFSoft immediately after
  `setupRenderTarget` returns, so each tap is a bilinear 2×2 compare. Overriding
  `setupRenderTarget` to set Linear is a **no-op** — it was tried.
- Static L0 uses a per-level radius of 1.6; every coarse static and moving-caster
  map remains radius 1. L0 is 1.6× denser in world space, so this preserves the
  old physical filter width rather than making the sun softer.
- Level texels at tier 2 / tier 0: L0 3.7 / 7.3 mm, L1 19 / 38 mm, L2 66 / 98 mm,
  L3 254 / 338 mm. On a horizontal floor under the 27° sun, multiply by 2.2 for
  the along-sun footprint.
- Level choice is the fragment's Chebyshev distance from the CAMERA in light-space
  XY, blended over the last 16 % of each box. L0 is now 15 m half-width: its
  full-weight region ends at 11.09 m, beyond the deck's 10.9 m diameter.

**Root cause:** the PCF signal was valid, but its input silhouette was too coarse
for this receiver. The 27° sun stretches a light-space texel 2.2× across the
horizontal deck, and a single wide shadow edge exposes that stair directly.
Thin 75–130 mm rail/mullion shadows looked clean because their two PCF ramps
overlap; they were never evidence of a different shadow source. Three controlled
tests established this: expanding L0 coverage alone did not change the teeth;
switching to `PCFSoftShadowMap` or doubling only `radius` merely widened the same
steps; increasing spatial density reduced the step size in direct proportion.

**Fix:** static L0 is 15 m at 2× its tier map size (8192² on tier 2), while its
PCF radius and base normal bias are adjusted by the actual 1.6× world-density
gain. L1–L3 therefore keep their established world-space bias/filter behaviour,
and dynamic shadows remain at their tier resolutions and radius 1. The map count
and per-frame static draw count do not increase; L0 is frozen after load. The
explicit cost is memory: tier-2 L0's depth attachment is roughly 256 MiB instead
of 64 MiB (implementation-dependent format allocation).

Always **judge shadow filtering on a bare bright plane**, not on
regolith or paving — the deck is the park's only one, which is why this shipped
unnoticed.

## Diagnostics added

`?pass=aoshare` · `?pass=aoapplied` (the AO split, read in that order when
contact grounding looks wrong) and `?pass=nograde` (tone-mapped, pre-LUT — the
honest baseline for any palette argument). Raw and filtered AO diagnostics are
also available as `?pass=aoraw`, `?pass=aodenoised`, and `?pass=aoradius`; all
are registered in `core/debug.ts`.

`?view=freedomdeck` is the fixed bare-plane shadow contract. Validate `final`
and `nopost` there after changing the clipmap ladder, map sizes, PCF filter, sun
direction, or gallery geometry.

## Verified (2026-08-10, tier 2, 2176×1224, ~4.5 M tris, 766 draws)

- `?view=rim` and `?view=firsttree` sampled against the reference image:
  mountains `#b57153` vs ref `#af795f`; sky above the massifs `#ae8065` vs ref
  `#ab8572`. Chroma within 0.03–0.07 of the reference everywhere measured.
- `?pass=bloom` at `?view=greenhouse`: black frame except the grow-light bars
  and one specular glint. Bloom is emitter-only.
- GPU-fenced frame time 8.1 ms (≈124 fps) at both `?view=arrival` and
  `?view=firsttree` with the six real lights live.

Measuring frame time headlessly: `setTimeout` is throttled to 1 s in a hidden
browser pane, so a per-frame flush loop built on it appears to hang. Use a
`MessageChannel` port round-trip as the macrotask flush, `step(1)` per
iteration, and `device.queue.onSubmittedWorkDone()` as the fence at both ends
— `pipeline.render()` is `void`ed and async, so a fence without the flush
measures nothing and reports absurd frame rates.
