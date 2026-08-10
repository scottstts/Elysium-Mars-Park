# Mars sky & exterior world (S2 + S3)

## Sky (`src/sky/`)

- `marsSkyRadiance` is the ONE sky function — dome mesh, PMREM environment
  bake, and any future reflector sample it; they can never disagree.
- Dust-Mie model, all Earth intuitions reversed: butterscotch column, horizon
  brighter than zenith, **cool blue circumsolar glow** (tuned subtle — at 27°
  elevation the blue effect is mild; it peaks at sunset which we never show).
- Sun disc: true 0.35° angular size, Neckel–Labs limb darkening, feathered in
  x² space (numerically stable near cos≈1). Disc ~1800 HDR drives bloom.
- Sun light + env are baked/created once at init (frozen afternoon). The
  4096² single shadow map (±120 m) is an interim rig — S4/S5 replace it with
  cached clipmaps + the analytic lattice net.
- Sun vector: elevation 27°, azimuth 250° — `sky/sun.ts` is the single owner;
  everything (shadows, shafts, lattice net, glints) must import from there.

## Aerial perspective (`src/exterior/marsAerialPerspective.ts`)

- ONE continuous dust medium, applied screen-space in `pipeline.hdrTransform`
  (SeaPark pattern), start 55 m. Interior sightlines (≤500 m) get a
  just-perceptible cue from the same function — deliberate.
- **Rewritten from a fog lerp to the real two-term form**:
  `L = L_surface·T + L_sky(dir)·(1−T)`, `T = exp(−σ·d)`, and both halves matter:
  - **σ is a vec3** — base 1/5200 m on green, ×(0.78, 1.0, 1.28) per channel.
    Mars dust scrubs blue out of the transmitted beam ~1.6× faster than red
    (the same physics that makes the sky butterscotch), so distance REDDENS
    the massifs. A scalar σ veils every channel equally and turns them gray,
    which is what the first build did. At 2.5 km T = (0.69, 0.62, 0.54).
  - **The source function is `marsSkyRadiance(viewDirection, 0)`**, not a
    constant tint: a fully extinguished ridge lands exactly on the sky behind
    it, so the horizon dissolves with no seam and the haze can never outshine
    the sky it is supposed to be. The sunward forward-scatter lobe and the
    elevation gradient come along for free. Clamped at 3.0 so the circumsolar
    aureole cannot blow out a ridge on the sun line.
- e-fold lengthened 3.6 km → 5.2 km: at 3.6 km the 2–4 km ridges lost their
  form before they reached the glass. `FOG_EXTINCTION_PER_METER` is still the
  live-tunable uniform on `window.__elysium.fogExtinction`.
- `dustHazeTint` in `skyRadiance.ts` is now unused (the directional radiance
  replaced it) — left for the sky owner to remove or repurpose.

## Exterior terrain (`src/exterior/`) — OVERHAULED, the walled valley

Superseded the flat plain + distant-mesa version entirely. The park sits on
the floor of a valley ringed by rocky mountains in every direction
(ref_images/mars_park.png).

### The height field (`terrainHeight.ts`)

- Still one pure deterministic `exteriorHeight(x,z)`. Layered radial bands so
  the skyline reads with parallax, not as one wall:
  foothills 0.5–2.0 km (≤260 m) · valley RIM 1.25–2.7 km (300 m) ·
  main massifs 1.2–4.4 km (520 m) · far highlands 3.2 km+ (340 m).
- **The rim band is the guarantee.** Ridged noise alone leaves whole bearings
  in a radial valley — the first build had an empty east horizon. The rim is
  a continuous, noise-modulated band of rock that the ridged massifs ride on
  top of. Two ridged fields (2450 m and 1380 m) are **screen-blended**
  (`a+b−ab`) for the same reason: two scales rarely have valleys on the same
  sightline.
- **Ridges use GRADIENT noise, not value noise.** Value noise's zero set is a
  broad smooth band, so `1−|n|` came out as rounded wax blobs (verified with
  a CPU hillshade render). Gradient noise is linear through zero and creases
  into a real ridgeline. Value noise is still used for the smooth terms
  (massif envelope, valley floor swells) where it is cheaper and adequate.
- Ridged multifractal uses PARTIAL weight feedback (`0.34 + signal*1.7`).
  Full Musgrave feedback starves the slopes and the range melts into lobes.
- **Detail is radius-gated** (`fineDetail`, `midDetail`) so the field is
  band-limited to what the ring LOD can tessellate. The field coarsens with
  radius because the mesh does.
- Two deliberate cuts: the **south pass** (widening corridor along +Z; the
  graded strip keeps |x|<~40, z 124–470 at y≈0.02 so the arrival tube at
  y≈6 can never pierce rock) and the **sun window** (a −20% saddle on the
  WSW bearing). The far highland band ignores the pass so distant ranges
  still close the gap behind it.
- `MESA_SITES` are now four flat-topped buttes at 1.8–3.3 km west, folded
  into the height field (no separate cliff meshes — an overlapping hero mesh
  on top of the ring surface is exactly the double-surface sloppiness the
  project bans).
- Planet curvature (`−r²/2R`) is subtracted: the open floor sinks under the
  true horizon at ~3.4 km so only mountains stand on the skyline.
- **The field is joined to the park floor, not left with a hole.** The old
  build had NO ground at all between r=132 (groundworks floor edge) and
  r=252; you saw the sky dome's below-horizon glow through it. Inside r<244
  `exteriorHeight` blends to (and at r≤134 IS) `interiorHeight`, so the two
  surfaces butt-join with zero step and never overlap. **Contract: the
  groundworks floor mesh must keep its outer radius at 132** —
  `TERRAIN_INNER_RADIUS` is the single constant on this side.

Verified numerically: seam delta 0.000 m; skyline from eye height p10 12°,
median 14.8°, max 21.6°, and 3.6° only in the south pass; max apparent ridge
elevation along the sun bearing 14.1° (sun sits at 27°).

### The mesh (`exteriorTerrain.ts`)

- **ONE radially-graded polar mesh**, 896 columns × ~410 rows (368 k verts,
  735 k tris), not a stack of concentric rings. Vertex spacing follows a
  schedule (9 m at the apron → 16.8 m through the mountain band → 270 m at
  13.5 km): the same LOD idea with no ring-to-ring seam that can crack. The
  angular seam is closed by **index wrap**, not a duplicated column.
- Normals come from that grid (central differences in radius/arc-length),
  **one height evaluation per vertex**. Independent finite differencing costs
  five evaluations per vertex and pushed the build past 2 s; this is ~370 ms.
- Winding is `(a,b,c)/(b,d,c)`. **The `(a,c,b)` order used elsewhere in the
  project faces DOWN and is back-face culled** — see the note below.

### The material

- Everything derives from two causes — SLOPE (from the field's own normals)
  and world position — so albedo, strata, streaks and bump cannot disagree:
  dusty regolith on flats → oxide staining → scree mottle → bedrock with
  horizontal strata (phase = world Y, drifting slowly so fault blocks offset)
  → dark slope streaks (the dust-avalanche tracks that make a Martian
  escarpment unmistakable).
- Cellular bands do work Perlin cannot: a **gravel lag** (worley, 3.1 m,
  patchy) and **blocky fracture** on bedrock (worley, 23 m). Without them the
  valley reads as sculpted clay however many Perlin octaves are stacked. The
  lag must be patchy — at uniform full contrast it tiles into cobblestones.
- Albedo sits at Mars's real ~0.15–0.25 range. The first pass was near 0.45
  and the mountains rendered BRIGHTER than the sky they stand against.
- **Band filtering is by pixel footprint, not distance**, using the geometric
  mean of `|dFdx(positionWorld)|` and `|dFdy(positionWorld)|` (the side of a
  square with the pixel's ground area). Summing them over-filters (grazing
  floor went smooth); taking the min under-filters (the stretched axis
  speckles). Fades are spread over a decade because `positionWorld`'s
  derivative is a per-TRIANGLE constant — a tight fade steps between
  neighbouring triangles and stipples the surface. Any band with a hard
  threshold (slope streaks, strata harmonics) needs the weight too.
- Aerial perspective is unchanged and NOT duplicated here: the shared
  screen-space medium already hazes the ridges toward the sky's dust colour
  (~50% at 2.5 km), which is what makes the ranges layer.

### Scatter

- Boulders are placed by cause: clustered fields on the valley floor plus
  talus aprons weighted to where `mountainMask` is at the mountain foot.
  Two LOD tiers (icosahedron detail 2 near / 1 far), seated a third into the
  regolith. A **size ceiling rising with radius** models a cleared apron —
  without it the dome is ringed by 6 m blocks standing 20 m off the glass.
  The graded spaceport corridor is swept clear.
- Dust devils ×3, retuned to the valley: one coming up the south pass on the
  arrival sightline, one crossing the east floor, one high on the NW range
  front. Motion is allowed under the frozen-afternoon rule (machines and dust
  move; the SUN does not).
- Bloom threshold 1.6 so the dust lobes never bloom; only disc + halo do.

### Two engine traps found here (both cost real time)

1. **`bumpMap()` silently no-ops on procedural nodes.** It re-samples its
   input through a texture UV context (`textureNode.context({ getUV })`), so
   a node with no `uvNode` returns the same value for all three taps, the
   derivative is zero, and it returns the untouched geometric normal. Use the
   local `proceduralBump()` (same Mikkelsen math, real `dFdx`/`dFdy`).
2. **Polar grids wound `(a,c,b)` face downward.** For a=(row,col),
   b=(row,col+1) tangential, c=(row+1,col) radial, `(v1−v0)×(v2−v0)` is −Y.
   The terrain rendered as a "flat featureless plain" for the whole first
   build — that plain was the sky dome's below-horizon ground glow seen
   through the culled mesh. `world/groundworks.ts` builds its floor with the
   identical pattern and needs the same audit.

### Dev harness

`src/exterior/valleyPreview.ts` mounts JUST sky + sun + `ExteriorSystem` in a
throwaway renderer, so the terrain stays verifiable when another system
breaks the main boot. Nothing in the shipped runtime imports it. Drive it
from the console (it takes a cache-bust suffix because an already-imported
module instance survives an edit):

```js
const p = await import('/src/exterior/valleyPreview.ts?t=' + Date.now())
const v = await p.mountValleyPreview(1600, 900, '?t=' + Date.now())
v.setExposure(0.42); v.eyeAt(0, 150, 90, 3)   // stand at x,z look on a bearing
```
