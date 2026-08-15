# Vegetation (OVERHAUL W2)

Rebuilt from scratch against `ref_images/mars_park.png`. Files under
`src/vegetation/`: `firstTree` · `planting` · `gardens` · `greenhouse` ·
`species` · `rocks` · `foliageMaterial` · `leafTextures` · `vegetationSystem`.

## The reconciliation that governs everything

`design.md` says vegetation is sparse and Mars-feeling; the reference image
shows planters overflowing. Both are true at once, and the mechanism is the
**wall**: green is lush *inside* raised planters and glass buildings, and open
ground stays mineral. The plaza and boulevard read green because 42 walled
beds overflow — walk ten metres off the paving and you are on raked regolith
with rock and a rationed steel-edged bed. Densifying the gardens, or thinning
the planters, breaks the idea rather than balancing it.

## Ownership boundaries that must not drift

- `world/paving.ts` owns planter walls, coping, and the soil SURFACE at
  `slabTop + 0.38` **crowned 3 cm at mid-width**. `planting.ts` re-derives that
  crown formula to seat plants; a plant placed on a flat 0.38 hovers 3 cm over
  the middle of every bed. If paving changes the crown, change it here too.
- The First Tree's **pit** (ring wall + soil disc + 24 wall colliders) is built
  by `planting.buildTreeRing`, not by paving — the plaza is a continuous paved
  disc and without the pit the tree grows out of a slab. It is built from
  paving's own `PLANTER` constants and `createConcreteMaterial()` so it reads
  as one family with the 42 arc beds. **If the ground agent ever adds a tree
  surround, delete this instead of having two.**
- `farmside.ts` publishes `CROP_TRAY_SURFACES` / `MIST_NOZZLES`;
  `hydroTower.ts` publishes `HYDRO_SHELVES`. `greenhouse.ts` consumes them and
  never re-derives rack geometry. hydroTower states it already builds baseline
  planting, so the pass there is deliberately a light front row on alternate
  tiers only.

## The First Tree

A 12.0 m ginkgo grown with the structured-ash method (skill
`threejs-procedural-vegetation`), retuned to a ginkgo species table. What that
method buys over hand-placed swept tubes: the **continuation model** (one
terminal continuation per branch inheriting the parent's section/segment
counts, plus stratified laterals) is what produces a real leader and an
irregular crown — lateral-only generators make a candelabra.

Declared divergences from the ash contract (§11 of its reference):

1. Ginkgo table, metric, 12 m not 80.
2. Longitudinal UV is **real arc length in metres** and U is metric
   circumference, not the alternating 0/1 ring pattern — bark grain then has
   one physical scale on the trunk and on a twig.
3. Trunk sections eased `t^1.35`, so 8 of 16 land in the bottom 1.4 m. A root
   flare needs resolution and a 12 m tree has no sections to spend uniformly.
4. **Bark ridges are geometry**, not paint: each ring's radius is cut by a
   periodic fissure field (integer θ harmonics so it closes) with an analytic
   θ-derivative feeding the normal. `aRidge` is baked per vertex so the
   material's colour and the geometry's form cannot disagree.
5. Root flare and branch grafts are **radius laws on the branch's own rings**.
   Every lateral begins at `0.42 × childRadius`, seated
   `0.38 × parentRadius` inside the parent; three short spans grow it into a
   restrained `1.16×` shoulder before it settles to the limb radius. The old
   collar started as one exposed `2.45×` ring, so low-sided branch tubes made
   pointed wedges at their forks. Major radial resolution is now 30/18/12/8
   sides instead of 24/11/7/5.
6. **Short shoots (spurs)** added — 700 of them, knobbly alternating ring
   radii, five individually oriented leaf sites each. Not in the ash preset;
   the single most ginkgo-specific feature of the tree.
7. **One growth site is one leaf.** Each site emits one 3×4 cupped card with a
   single fan-shaped ginkgo painting, rounded crown-aware normals and
   petiole-rooted wind. The earlier canopy crossed two cards per site and
   painted ten leaves on each card; that multiplicative representation made
   close foliage read as dark, repeated clumps and concealed the branches.

Mechanical audit (`tools/first-tree-audit.mjs`, fixed seed): 195 840 tris
(61 440 wood + 134 400 canopy), 5 600 individual leaves, 139 lateral junctions
with 556 graft rings, crown footprint 6.9 × 8.8 m, lowest leaf at 3.6 m. Zero
invalid attributes, degenerate faces, duplicate leaf faces, or non-unit
normals. The audit also caps the graft shoulder at `1.2×`, requires at least
four resolved rings per junction, and enforces the one-site/one-leaf contract.

## Species and instancing

Seven ornamental species + three crop species, one `InstancedMesh` each.
`species.ts` has two construction families chosen by viewing distance:

- `bladeCluster()` — real tapered strips for sedge and the tree collar, with
  the meadow-grass **hand-authored hemispherical normal `(sin, 0.34, cos)`** so
  a tuft lights like a mound instead of like five fins.
- `buildPlant()` / `CardSink` — cupped alpha cards carrying the ash system's
  **rounded normal** `normalize(cardNormal + (vertex − origin))`, which fakes
  the volume the card stands for. Flat card normals are what make a bush read
  as a decal.

Both bake `aDepth` (0 outside the plant, 1 buried in its middle). The foliage
material uses it to darken the interior and kill the backlight there — free
self-occlusion, and the cheapest single thing that stops a shrub reading as a
sticker. Placement is always clustered (parents seeding 2–4 children), never a
uniform sprinkle.

## Materials

`foliageMaterial.ts` owns every foliage/bark/rock material.

- **Backlight** is the Frostbite translucency approximation
  `pow(saturate(dot(−V, L)), k)` with no normal term, because a double-sided
  card has no meaningful side. It is the park's second postcard: the low frozen
  sun through the ginkgo canopy. Peaks stay UNDER the 1.0 bloom threshold.
- **The blade bend is the exact inextensible circular arc**, not a sine offset:
  `phi = clamp(strength·intensity·3, 0, 1.48)`, `a = phi·t^1.5`,
  `r = height/phi`, `arc = r(1−cos a)`, `drop = r·sin a − y`. Blade length is
  preserved and the tip drops as it leans.
- Wind is rooted (`rootWeight` weighting, three detuned sines) and lives in
  `positionNode`, which three reuses as the shadow position node — so shadows
  sway with the leaves for free.

## Colliders

Tree trunk cylinder, 24 boxes around the tree-pit wall, and cylinders on hero
boulders (> 0.55 m). Everything else is walk-through by design.

## Known follow-ups

- **Boulder silhouette.** The bedding and facets now read, but the `shape(v)`
  law still produces a domed mass. Angular blocks, flatter crowns and a real
  overhang would push these from "good rock" to "sculpture".
- **Boulevard planters reach r = 94.9**, and the masterplan's guideway swept
  volume starts at 94.5. Planting compensates (no outward spill, tall species
  confined to the park side), but the WALL itself is over the line — a
  paving/tram question, not a vegetation one.
- The scene-wide `window.__elysium.audit()` gate has not been run against this
  build: the app was unbootable throughout the session on other agents'
  in-flight errors. Geometry was verified mechanically instead (headless
  NaN/degenerate/normal-length sweep over the tree and rocks).

## The bench crop is modelled, not painted (2026-08-13)

`cropHead()` — three alpha cards carrying a painted bush — is gone from the
glasshouses and the hydroponics tower. At bench distance (the walkable range
puts a guest 0.6 m from a tray) three cards read as three flat angular blobs,
and the tower's crops were literally `PlaneGeometry` seen through clear glass.

`vegetation/cropSpecies.ts` builds four real varieties — **butterhead,
romaine, chard, pak choi** — plus a seedling, and both consumers pick per
PLANT so no two neighbours share a silhouette. Three things do the work, and
none of them is polygon count:

- **A width profile with a petiole**: `sin(pi·t^k)` peaking at the blade's
  belly, floored at the stalk width below it.
- **A ruffled margin**: out-of-plane displacement weighted by `(2u−1)²`, so the
  centre stays flat and the EDGE waves. This is the whole lettuce read.
- **Rounded normals**, kept from the card system, so a head lights as a ball.

**Cup and ruffle scale with the LOCAL width, never the maximum.** Against the
maximum, a leaf whose stalk is 15 mm across still got ±80 mm of ruffle there:
the petiole fanned open and the outer whorl's margins dropped 56 mm below the
tray the head stands on.

Two baked attributes carry the shading contract — `aDepth` (0 outside the head,
1 in its heart) and `aPale` (the blanched stalk). `uv.y` is root-to-tip and
`uv.x` is across, so the midrib is derived, never baked. `createCropMaterial`
needs no map and no alpha test: the silhouette is geometry, so the shadow pass
gets it for free and `foliageMaterial`'s r185 cut-out contract does not apply.

**Sizes are contracts with the racks**, and `tools/crop-audit.mjs` enforces
them: glasshouse tiers are 0.52 m apart with a grow bar hanging 0.10 m under
each shelf, so a head scaled by the planter's 1.18 must stay under ~0.39 m
tall; benches plant on a 0.30 m pitch, so a mature head must finish under
0.42 m across (just touching its neighbours). Cost: 108 tris/head average,
~11 800 plants, **1.27 M triangles in 5 instanced draws** (the card build was
0.28 M, but alpha-tested and double-sided).

Fixed alongside: the tower densifying pass stepped its tiers by the
GLASSHOUSE's `CROP_TRAY_TIER_PITCH` from the floor level, so that row grew out
of the floor plate instead of standing in the trays. It reads
`HYDRO_TIER_HEIGHTS` now.
