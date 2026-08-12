# THE FOUNTAIN (2026-08-12, physics pass 2026-08-12b)

Replaces the Regolith Gardens' raked furrows and steel-edged beds at
`gardens-main` (−38, −40) with a monumental tiered fountain on a paved court.
`src/fountain/`, one system, ten modules.

Only design decisions that the code cannot state for itself are recorded here.

---

## 1. Why the gardens went, and what stayed

The rake was authored as swept tube ridges 5 cm proud. At any honest viewing
angle those ridges are sub-pixel, so the karesansui idea never arrived. The
steel-edged beds were four sedge clumps in a picture frame. **Neither is worth
re-attempting as geometry.** The rock groups stayed — kept off the fountain by
`pavedSignedDistance`, the same rule that keeps them off every other pour.

`GARDENS` still exists in `parkPlan` as an open-regolith **zone** descriptor.
It no longer means "there is a garden here".

## 2. One datum, and everything local to it

Every height in `fountainPlan.ts` is metres above the court's paved top.
`FountainSystem.init` samples `interiorHeight` **once** and adds it. Nothing
else in the feature calls `interiorHeight`. Consequences of the discipline:

- the sim's impact sampler, the droplet shader and the splash rings all read
  the same drag-corrected landing solves;
- the jet nozzles' cant angle IS the launch angle of the flight solve;
- the vortex columns run from the pedestal cap to `tazzaUndersideY`, so
  re-authoring the bowl moves the sculpture with it;
- the planting and the soil are poured from the same `planterBays()`.

## 3. The basin is a SIMULATION (`waterSim.ts`)

The water's meso-scale motion is a bounded heightfield fluid sim: the damped
wave equation on a 512² grid (28 mm texels) over the basin annulus, forced by
DISCRETE IMPACT EVENTS and reflecting off the same two walls the ray-traced
volume intersects. Rings radiate from where water landed this second,
interfere where they cross, and come back off the coping — none of which the
previous steady authored wave trains could do, because a steady train has no
memory.

- **Forcing without readback.** Each fixed step the CPU sampler
  (`fountainSystem.sampleImpacts`) draws a handful of landing events from the
  stream module's source specs — on the wandered landing rings, using the
  SAME `wanderRadial` function the droplet shader launches with — and pushes
  them as volume-neutral craters `(1 − 2q²)e^(−2q²)`. Neutrality is not
  cosmetic: the wave update cannot damp a DC offset, so a biased deposit
  would ratchet the pool level forever.
- **Wave speed** is the deep-water phase speed of the dominant ring at MARS
  gravity (c = √(g·λ/2π) ≈ 0.5 m/s; kh ≈ 6, comfortably deep-water — √(g·h)
  would be wrong here). Non-dispersive is THE approximation of the scheme;
  the capillary bands, whose dispersion matters visually, stay analytic in
  `waterField.ts` with their exact ω(k).
- **Explicit viscosity** (`h += ν·∇²h`, small) kills the discrete Laplacian's
  weakly-damped Nyquist checkerboard, which otherwise reaches the specular
  lobe as glitter noise.
- **Foam is a simulated scalar** in the same texture: injected by impacts,
  diffusing, decaying on ~3 s. It sits exactly where water lands — including
  everywhere the jets' aim wander drags their rings — and the surface's foam
  mask reads it instead of painting analytic landing bands (a band centred on
  a nominal radius is a decal once the landing point actually moves).
- **The derive kernel** turns the raw field into one texture the surface
  reads with two taps: gradient, foam, and the differential-area caustic
  gain 1/|det(I + βH)| — sim Hessian by finite differences PLUS the analytic
  capillary Hessian in closed form. Moving this off the water fragment onto
  0.26 M texels is a net perf win, and the texture's bilinear filter is
  itself the caustic web's anti-aliasing.
- **Clocking:** one kernel dispatch per FIXED park step (catch-up batched per
  frame, warmup ramp on early frames), so the sim freezes with the pause card
  and stays in lockstep with `fountainTime`. CFL ≈ 0.29.

The template for the storage-texture ping-pong compute pattern is SeaPark's
`wakeFoamMap.ts` — proven idioms for `textureStore`/`textureLoad`/uniform
splat arrays on this exact stack.

## 4. Streams: split at the breakup point, DRAGGED after it

Before breakup water is real connected geometry (Fresnel cores — and
BALLISTIC: a coherent column's mass-to-surface ratio makes its drag
negligible over half a metre). After breakup every parcel is an independent
projectile IN AIR: Mars gravity plus the linear-drag closed form

    v_t = g·τ;  x(t) = v_h·τ(1−e^(−t/τ));  y(t) = (v_y+v_t)·τ(1−e^(−t/τ)) − v_t·t

with τ ∝ the parcel's own size draw. Dome One holds a breathable ~70 kPa mix
(ρ ≈ 0.85 kg/m³) — this is a park, not the 600 Pa outside — and at these
speeds drag is anything but negligible:

- arcs lose ~30 % of their vacuum reach, so `dragArc()` (Newton on the apex
  identity and the landing time) solves launch velocities that put the MEAN
  parcel on the designed ring; heavies overshoot, fines fall short — spread
  around the ring, not a shifted ring;
- the launch angle comes out ~5° flatter than the vacuum identity
  atan(4·rise/span); the nozzle cant reads `jetLaunchAngle()` so the hardware
  points where the water actually goes;
- fines decelerate toward a ~1 m/s terminal fall and hang (the veil), heavies
  fly on — sprays sort themselves by size along the arc;
- each parcel Newton-solves its OWN landing time from its own τ in the vertex
  stage (3 iterations) and recycles exactly when it lands — a height-based
  death, not a timer;
- splash crown speeds are set from the impact speed the drag actually
  delivers.

**Breakup time is arc length, not length/launch-speed:** a weir sheet leaves
its lip at centimetres a second and is doing 1.8 m/s by the end of its
coherent run, so t solves v₀t + ½gt² = L. The length/speed version put a
curtain's breakup 2 m below the end of its sheet and the water vanished in
between.

**Parcels launch FROM their site.** Angular spread is a per-emitter fraction
of the site spacing (~0.9 for a weir's virtual ligaments, ~0.05 for a
physical orifice). The first pass used a uniform half-slot offset and the jet
threads rose a metre beside their nozzles.

**Aim wander:** two incommensurate sine pairs per site, evaluated at the
parcel's LAUNCH time, shared verbatim with the CPU impact sampler — arcs
snake, landing rings breathe, and the sim's rings follow the water exactly.

## 5. The basin surface (`waterSurface.ts`)

Still a ray-traced volume: refracted view ray intersected against the dished
floor disc, the coping's inner cylinder and the island's riser; Beer–Lambert
over the true path; no screen-space refraction, no planar reflector.
Changes in the physics pass:

- normals = sim gradient (footprint-faded) + analytic capillary + seiche;
- caustic = ONE texture tap at the sun's entry point (see §3);
- foam = the simulated field, shaped by churn noise + the two shoreline
  scum lines + crest whitening;
- foam also boosts the water column's in-scatter — plunge zones read milky;
- **the sun glint is a filtered microfacet lobe** (GGX, height-correlated
  Smith): α² = 2σ², where σ² is the slope variance every unresolved band
  paid in (chop fade + sim fade + a base micro-turbulence floor). Energy
  moves from geometry to roughness, never vanishes — up close resolved
  wavelets flash the sun as real geometry; with distance the same energy
  widens into the smooth sheen a photograph shows. The anti-aliasing is IN
  the BRDF; the authored two-lobe glint is gone.

**The looks-like-the-floor illusion (diagnostic lesson).** From above, calm
water over its own ray-traced floor image is nearly indistinguishable from
the bare floor mesh (the parallax is 27 cm, fresnel is 3 %). The definitive
test is not staring at screenshots: HOIST THE MESH half a metre from the
console — if it is rendering you see a glass disc; if not, nothing changes.
An afternoon of shader bisecting chased a bug that did not exist. Related:
`.toVar()` chains are EMITTED even when an early debug return skips them —
early-return bisects do not prune what you think they prune.

## 6. Mars gravity is the strongest single cue

3.721 m/s² in every flight solve AND the ripple dispersion AND the sim's
wave speed. Arcs hang ~1.6× Earth, rings spread ~40 % slower, and the solar
disc is half Earth's — the caustic web genuinely focuses tighter (clamp 3.4).

## 7. Two aliasing traps this feature paid for (unchanged)

**Screen-space derivatives are constant across a triangle** — footprint fades
must be analytic (`metresPerPixel`). **Pure sinusoids interfere into a
lattice** — seven incommensurate capillary bands, amplitudes ~λ^(3/4).

## 8. Stone: proportions and the drip arris

- A tazza's DEPTH RATIO decides bowl-vs-drum: 0.45 here.
- Gadroons: fewer and deeper; they stop BEFORE the rim moulding — a lobe
  reaching into the ovolo scallops it ±15 mm, which reads at grazing light
  as bright/dark patches along the whole rim.
- The rim moulding is a DENSE roll (~150° of section turn over 10 edges,
  every dihedral under the 40° smooth-shade threshold) whose outermost point
  is the DRIP ARRIS (`tazzaDripY/R` in the plan), with everything below it
  undercut. The first pass put the widest bulge BELOW the shedding lip —
  backwards: the falling curtain must clear the stone. Both curtains launch
  from the arris helpers, so stone and water share the line.
- Marble hairline veins are BUNDLED to the broad bedding (`nearBed` gate in
  `marbleAlbedo`); hairlines wandering alone across clear field read as
  contour lines on a survey map — the tazza bowls proved it.
- Nozzles are plumbed: flange, riser, canted head (cant = `jetLaunchAngle`).

## 9. THE VORTEX RING (`fountainVortices.ts`)

The four draped caryatids are gone, by owner directive: **a draped human
figure lives or dies on a thousand anatomical judgements a parametric loft
cannot make.** Two full passes (canon sections, contrapposto, fold cascade,
knee press, baked cavity) produced "remarkably good for procedural" and
nothing better. The replacement inverts the problem: choose a subject whose
whole identity IS a mathematical form.

**Four dust devils turned to stone**, carrying the bowl — the park's vista
shows real ones walking the valley through the glass, and the one place the
colony spends water in public is now held up by the planet's own dry
weather. Each column is a single closed loft: a wide turbulent SKIRT merging
into the pedestal cap; a FUNNEL of five braided lobes (rounded crests,
narrowed grooves — a raw cosine is machine fluting) under a helical twist
that ACCELERATES with height, counter-spiralled by fine striations; a MOUTH
whose last rings morph per-vertex onto `tazzaUndersideY` + 30 mm, welding
into the bowl whatever its future shape. One rotation sense across the four
(a cyclonic family), individual twist rates and meanders.

Craft notes that cost a pass each: the mouth flare must be MODEST and the
weld band SHORT (a wide flare flattening onto the dome smears sideways into
melted cheese); the lobe depth must survive to the top (fading it 45 % made
the upper third a plain turned baluster).

The baked `uv.x` cavity channel (per-face-corner uvs authored after `loft`,
surviving `cleanMesh` — order matters) reads as crevice occlusion in the
`sculpture` material slot. GENTLE: at −40 % a crease is a painted black
stripe from two metres; occlusion whispers (−18 %, dust only past 0.72).

## 10. Audio and the keep-out

- `src/assets/fountain.mp3` is the soundscape's ONE recorded asset (owner
  supplied). Decoded to an AudioBuffer for a sample-accurate loop; loop
  points step inside the file ends because MP3 encoder padding otherwise
  ticks once per lap; playback starts at `loopStart` so the first second is
  water, not lead-in. Distance does the mixing: an inverse-law PannerNode at
  the fountain axis under the engine's shared listener pose — audible swell
  by the court, gone under the room tone by ~40 m. Starts on the same
  user-gesture event as the rest of the soundscape.
- Colliders: two walkable stylobate cylinders, the coping cylinder, one box
  per planter bay — plus the KEEP-OUT: a solid cylinder at the coping's
  INNER lip rising to 3.4 m. The coping alone stops a walker (0.525 m rise
  vs 0.42 m autostep) but not a 0.38 g jumper (3 m/s jump ⇒ 1.21 m apex ⇒
  2.05 m reach from the coping seat); 3.4 m clears that by a margin. Sitting
  on the rim still works; crossing it never does. Circular by construction.

## 11. Contracts inherited from the park (unchanged)

Transparent meshes set `mrtNode = mrt({ normal: vec4(0) })`; billboards are
`markParticle`d; `fountainTime` follows `ctx.time.sim`; the coping planters
are instanced into the shared `PlantingPalette`.

## 12. Verifying in the in-app pane

The pane SUSPENDS requestAnimationFrame while hidden: a freshly loaded page
has ticked ~0 frames when you probe it, and the sim will genuinely be flat.
Load with `?debug=1` and drive `window.__elysium.step(n)` — synthetic frames
that run fixed steps, updates and renders regardless of pane visibility.
Never diagnose "broken" from a screenshot of a page that has not ticked.

## 13. Naming

The zone is signed **THE FOUNTAIN** — wayfinding fingerposts, the gate ident,
the park model's destination list, the entry-screen map, and the postcard
bookmark `fountain` (REQUIRED list updated). `parkAmenities`' drinking
fountain part cache is `DRINKING_FOUNTAIN`.
