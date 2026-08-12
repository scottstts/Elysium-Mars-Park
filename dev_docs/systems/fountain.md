# THE FOUNTAIN (2026-08-12)

Replaces the Regolith Gardens' raked furrows and steel-edged beds at
`gardens-main` (−38, −40) with a monumental tiered fountain on a paved court.
`src/fountain/`, one system, nine modules.

Only design decisions that the code cannot state for itself are recorded here.

---

## 1. Why the gardens went, and what stayed

The rake was authored as swept tube ridges 5 cm proud. At any honest viewing
angle those ridges are sub-pixel, so the karesansui idea never arrived — what
shipped read as a contour map scribed on flat dirt. The steel-edged beds were
four sedge clumps in a picture frame. **Neither is worth re-attempting as
geometry**: raked ground wants a normal-mapped GROUND MATERIAL, and rationed
planting wants a reason to be where it is.

The rock groups stayed. They are the only part of that idea that worked, and
they are what gives open regolith its scale. They are kept off the fountain by
`pavedSignedDistance`, which now includes the court — the same rule that keeps
them off every other pour, not a special case.

`GARDENS` still exists in `parkPlan` as an open-regolith **zone** descriptor
(`groundworks` tints it, `groundScatter` thins its debris, `robotsSystem`
patrols it). It no longer means "there is a garden here".

## 2. One datum, and everything local to it

Every height in `fountainPlan.ts` is metres above the court's paved top.
`FountainSystem.init` samples `interiorHeight` **once** and adds it. Nothing
else in the feature calls `interiorHeight`, because the court is a flat pad and
a second sample can only introduce a second answer.

The consequences of that discipline are worth stating, because they are what
make the piece hold together:

- the ripple field's wave trains are seeded from the ring radii the streams
  module actually throws water at;
- the jet nozzles' cant angle IS the launch angle of the ballistic solve;
- the figures' arm length is stretched to land on `tazzaUndersideY`, so a
  change to the bowl's proportions moves the hands with it;
- the planting and the soil are poured from the same `planterBays()`.

## 3. Water is split at the BREAKUP POINT, not by rendering convenience

This is the load-bearing idea of the whole feature.

- **Before breakup** water has a surface with a normal. It reflects and
  refracts as a body. That length is real connected geometry
  (`waterStreams.coherentSheet` / `coherentJet`) with a Fresnel-driven opacity
  that rises toward the silhouette.
- **After breakup** it is a cloud of independent millimetre lenses. Every one
  is an actual projectile: `p(t) = p₀ + v₀t + ½gt²` solved in closed form per
  instance per frame (`waterDroplets.ts`).

The first implementation drew whole streams as swept sheets with strands cut
out by an alpha function, and it read as **plastic ribbons** — correctly, since
a texture on a fixed surface cannot separate, cannot be overtaken by the parcel
behind it, and cannot be seen edge-on. It was also ruinous on fill rate: a
ribbon rasterises its full height whatever its alpha says. Do not go back.

Three physical behaviours do most of the visual work:

1. **Motion stretch is exposure, not style.** A parcel crossing the sensor
   during an exposure paints a streak of `d + |v|·τ`. At 2–5 m/s that is 6–17 cm
   against a 4 mm droplet, which is why fountains photograph as bright streaks.
   Billboards align to the **screen-projected** velocity.
2. **Atomisation is progressive.** Diameter runs from ligament scale at
   breakup down to fine spray; transverse scatter starts only at breakup. So a
   stream narrows, frays, then disperses — for the reason it does in reality.
3. **Sub-pixel parcels keep their energy.** Below ~1.6 px the quad is clamped
   up and its opacity scaled by the AREA RATIO. Distant spray fades into
   coherent haze instead of aliasing into crawling confetti.

### Making it not look uniform

Six independent hashes per parcel, each retiring a specific artificial-looking
regularity: release phase inside its own slot; launch scatter per orifice;
radial scatter and the size draw; spin direction after breakup; intermittency;
and the snaking phase. Plus a per-strand `flowOf` term — a weir does not shed
evenly along its lip and a ring of orifices is never balanced. Keep the
intermittency GENTLE: an early tuning could take a whole strand to zero, which
reads as "four of the sixteen jets are switched off" rather than as breathing.

## 4. Mars gravity is the strongest single cue

3.721 m/s², everywhere: ballistic arcs, curtain fall times, splash flight, AND
the ripple field's dispersion `ω = √(gk + σk³/ρ)`. A jet that rises 0.9 m hangs
1.4 s here; a 0.6 m ring travels ~40 % slower than on Earth. Nobody names it and
everybody reads it. The caustic clamp is also Mars-specific: the solar disc is
half Earth's angular size, so the web genuinely focuses tighter (0.3, where an
Earth pool would support ~0.5).

## 5. The basin is a RAY-TRACED volume

Every surface under the water is an analytic primitive — dished floor disc,
coping's inner cylinder, island's riser cylinder — so the refracted view ray is
intersected against them and the hit is shaded on the spot. True path length
drives Beer–Lambert; the analytic caustic gain modulates the sun that reaches
it.

This is deliberately NOT a screen-space refraction offset. A heuristic UV push
has no depth rejection, samples foreground objects, and its "thickness" is a
fudge. Here the thickness IS the geometry, so the parallax is right at every
angle and the shoreline against stone stays exact.

There is **no planar reflector**. Reflection is the analytic Mars sky plus an
analytic occlusion of the fountain's own masses (two tazza discs, the island
column, the coping ring seen from inside) — the only local reflectors above
this pool. The sun's mirror image is an authored two-lobe glint, because the
sky function's 1800× disc sampled through a rippled normal is an alias
generator.

### Caustics are analytic, not rasterised

`P(S) = S + β∇h(S)`, so concentration is `1/|det(I + βH)|` — the differential-
area definition evaluated in closed form, which is possible only because the
ripple field has an analytic Hessian. That in turn is why the field is a sum of
authored trains rather than a noise texture.

## 6. Two aliasing traps this feature paid for

**Screen-space derivatives are constant across a triangle.** Driving a steep
fade (micro-band attenuation, floor detail) from `dFdx(position)` stamps the
mesh's own quad grid onto the water as a wire lattice at grazing angles. The
footprint measure is now analytic — pixel angle × range ÷ cos(incidence) — and
therefore continuous. See `metresPerPixel` in `waterSurface.ts`.

**Pure sinusoids interfere into a lattice.** Three tidy capillary bands
produced a perfectly periodic beat, and the caustic Jacobian amplified exactly
that curvature: the basin floor came out woven. There are now seven bands at
mutually incommensurate wavelengths (ratios near √2, φ, √5 — never a simple
fraction) with amplitudes falling as ~λ^(3/4), the equilibrium slope spectrum.
The beat period is now longer than the basin.

## 7. Winding, and the failure mode that hides itself

Two surfaces shipped inside-out during the build and the symptom is not "it
looks wrong" — it is "it is not there", which is far harder to see in a
screenshot than a wrong colour.

- **Hand-built index buffers**: for a polar grid, `(a → b)` is +θ and
  `(a → c)` is +radius, so `θ̂ × r̂` is +Y and `(a, b, c)` faces UP.
- **`archkit` lofts**: `recalcNormals` orients CLOSED components by signed
  volume (safe) but OPEN ones by the AUTHORED winding. An annulus lathe is
  topologically open even when its profile closes on itself, so the basin
  floor's profile must run its underside outward and its top back inward. A
  lathe whose top run goes outward faces down.

## 8. Proportion notes worth keeping

- A tazza's **depth ratio** decides whether it reads as a bowl or a drum.
  0.29 read as a table on a post; 0.45 reads as a tazza. The underside dome
  blends 55 % `sin` with 45 % `1−cos`: pure `1−cos` is a mushroom stalk, pure
  `sin` throws the rim beyond a raised arm's reach.
- **Gadroons**: fewer and deeper. 36 shallow flutes on a 5.4 m bowl are
  sub-pixel and only soften the silhouette into mush.
- **Curtain strands** are set from strand WIDTH, not picked. 36 lanes at a
  0.2 half-width is a 96 mm strand — a picket fence that hid the entire figure
  group. 88 lanes at 0.14 is a 27 mm ligament.
- **Jet launch angle** is `atan(4·rise/span)`. 72° is a garden sprinkler; the
  reference's generous civic arcs are ~52°.
- **Nozzles are plumbed.** A canted head at the launch height with nothing
  under it floats. The riser from the floor slab is what makes the water read
  as *supplied*.

## 9. The figures

Draped caryatids as a stack of honest sections plus a spine — the geometry a
floor-length chiton actually is, which is why caryatids have been carved this
way for 2500 years. There are no legs to model; the garment IS the geometry.

Four things separate "carved" from "lathed", in order of how much they buy:

1. **Fold cross-section shape.** Hanging cloth gathers into round tubular
   ridges separated by narrow creases — fabric cannot hold a sharp convex edge
   but holds a concave one happily. `foldProfile` broadens the positive lobe
   and sharpens the negative. A raw cosine is fluting.
2. **The belt.** Fold amplitude collapses to near zero at the waist and blooms
   above and below it. A monotone taper from hem to shoulder is a column.
3. **Contrapposto.** Hips displaced toward the engaged leg, shoulders
   counter-displaced, head recentred. Sections stacked on one axis read as a
   bollard however good the sections are.
4. **The himation.** A diagonal swag with its own folds and a hard edge. It
   gives the torso a second silhouette, which is what the eye reads as
   "drapery" long before it reads any individual fold.

Faces carry brow, eye SOCKETS, nose, lips, chin, cheekbone and jaw. Cutting
matters more than adding — a socket's shadow under a low sun is what makes a
head read as a head at ten metres, far more than a nose does.

Arms start INSIDE the torso and end 30 mm inside the tazza. Two closed solids
sharing an interior is invisible; two shells butted at a shoulder either gap or
z-fight.

## 10. Contracts inherited from the park

- Every transparent mesh sets `mrtNode = mrt({ normal: vec4(0) })`, and every
  billboard is `markParticle`d. Both lessons are already paid for elsewhere in
  this park (the greenhouse mist's walking rectangles).
- `fountainTime` follows `ctx.time.sim`, not TSL's global `time`: the water
  freezes with the pause card, and a fixed validation camera is therefore a
  usable regression surface.
- The four coping planters are instanced into the **shared** `PlantingPalette`
  by `VegetationSystem`. A private palette for four beds would double every
  foliage draw call and material in the park.

## 11. Naming

The zone is signed **THE FOUNTAIN** — wayfinding fingerposts, the gate ident at
(−18.4, −22.4), the park model's destination list, and the entry-screen map.
The postcard bookmark `gardens` was replaced by `fountain` (the REQUIRED list
in `postcards.ts` changed with it). `parkAmenities`' private drinking-fountain
part cache was renamed `DRINKING_FOUNTAIN` to free the name.
