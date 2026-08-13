# Park assembly (S8)

- ONE PartWriter for every district: all park architecture lands as ~16
  merged slot meshes (draw calls stay flat as content grows). Special
  meshes (milky vault glass, hero panes, sign faces) join a shared group.
- District builders in `world/districts/`: residential (10 habs on cradles,
  porches to the park, five personal-touch variants, the jacket on hab #3),
  farmside (3 barrel vaults, arch-fitted milky end glazing, interior racks +
  grow bars so the glow silhouettes read, harvest chalkboard), works
  (pilastered machine hall, 2×2 tank farm with piped racks + valve wheel,
  radiator rows, charging docks, elevated gallery to the Ops box),
  leisure (amphitheater arcs of cast rows with three aisles + stage facing
  the planet, Overlook Lounge with the ONLY true-transmission window wall,
  playground with climbing dome/swings/Ares-VII plaque, First Tree plaza
  with soil fill + ring benches + founding plaque).
- `districts/optimusPlaza.ts` pours the humanoid exhibit's plinth on the
  `optimus-court` disc (−28, 70) and publishes the deck datum + the eight
  stances; the figures themselves are an instanced asset owned by
  `robots/optimusExhibit.ts`. See `dev_docs/systems/optimus-exhibit.md`.
- `parkAmenities` marches benches/lamps/waste pairs down the paver paths
  with exclusion zones around set-piece areas. Every bench everywhere is a
  registered seat (seat contract: SURFACE point + facing yaw).
- Colliders flow through `DistrictServices.colliders` into one fixed body.
- Orientation gotcha that bit twice: `writer.box` size.x runs along the
  rotated (cos,0,−sin) axis and size.z along (sin,0,cos) — for a wall in
  the YZ plane at constant X use rotationY = yaw (not yaw + π/2).
- Canvas-signage backgrounds are #RRGGBB — an accidental 8-digit hex made
  one sign transparent (found in survey).
- Milky vault glazing is deliberately NOT physical transmission (area too
  large); the ONLY transmissive panes are the Overlook window wall.

## OVERHAUL W2 — Farmside rebuild (`districts/farmside.ts` + `greenhouseInterior.ts`)

The three ranges, their reclaim tank and the tram-side depot are rebuilt
against `craft/geometry-craft.md`. Design decisions worth carrying forward:

- **One analytic section drives everything.** `sectionPoint(u)` walks the
  cross-section by arc length (straight glazed haunch → circular vault →
  straight haunch) and `sectionOffset(u, a)` offsets it along the outward
  normal. Ribs, glazing bars, transoms, panes, gutters, shade rails, vent
  kerbs and sashes are all *generated* from it with a signed `a`, never
  positioned beside one another. Adding a member is one number, and coplanar
  faces / floats / gaps cannot be authored by accident.
- **Authoring frame per house**: +X across the span, +Y along the range
  (−Y is the lane end and the door), +Z up from the FLOOR datum. `place()`
  does `toYUp()` + `placeYaw()` once at emit, so plan polygons are literally
  the plan and section profiles are (across, up).
- **Datums**: `FLOOR = max(interiorHeight over the footprint) + 55 mm` — a
  LEVEL slab on sloping ground, with the foundation upstand showing 0.20 m
  at the paved centre and 0.38 m at the fallen corners. Nothing is ever
  coplanar with the regolith or the paved apron. `FOUND_TOP = FLOOR+0.14`,
  `TRACK_TOP = +0.19`, glazing datum `SILL_Z = +0.20`.
- **Clash-free frame hierarchy** (the gridshell rule, applied twice): ribs
  land on cast shoes → intermediate bars bed into a base track that is
  *split* into 12 runs between those shoes → transoms stop 1 mm short of the
  bar base flanges → panes stop short of both. In the gable: mullions are
  continuous, transoms are segmented between them, the louvred vent FILLS one
  grid cell whose pane is skipped.
- **Foundations are one continuous mitred casting** (`runMolding`). The
  walkable range's run starts at one door jamb, mitres round all four
  corners and stops at the other — the run is *split*, never cut, and a
  separate cast threshold spans the opening.
- **Vents are apertures, not patches**: a vent trims the three intermediate
  bars it crosses (their run is split around it), the pane cells are skipped,
  and the sash hinges on the kerb OUTSIDE the glazing plane. All six per
  range stand open — it is a warm afternoon, and an open sash hides the
  chord-vs-arc sagitta a closed flat sash would show.
- **Glass** is a lit `MeshStandardNodeMaterial` with a *normal-driven*
  constant alpha (never an authored Fresnel over the material's own): 0.14 on
  the near-vertical haunches so the racks and grow bars read straight through
  from the boulevard, ~0.46 at the crown where Mars fines settle. `castShadow
  = false`, `renderOrder = 12` (after the dome shell — panes are always
  nearer to an interior camera).
- **Cost discipline**: `bevel()` regenerates a box as a 432-triangle fillet
  grid. That is right for hero parts and ruinous for hardware that repeats
  hundreds of times, so `blockZ()` (a chamfered plan profile extruded, 20
  triangles, edge treatment in the profile per geometry-craft §0.3) carries
  crates, pallets, caps, hangers, kerbs and steps. Prototype-and-`clone()`
  for the 78 perforated uprights and every repeated lathe. Together: 1.13 M
  → 555 k triangles and 7.7 s → 0.63 s build (node measure).
- **The crop contract**: `CROP_TRAYS` (one entry per rack run: world centre of
  the LOWEST tray surface, yaw, plantable length/width, tier count) plus
  `CROP_TRAY_TIER_PITCH`, the flattened `CROP_TRAY_SURFACES`, and
  `MIST_NOZZLES`. All three ranges are planted — the two sealed ones carry
  the same rack skeleton because they are what makes the row blaze green
  through its panes.

## The dressing layer — `world/parkAmenities.ts` (overhaul W2)

The old three-family march (bench 34 m / lamp 27 m / waste 61 m, four hardcoded
exclusion discs) is gone. `parkAmenities` is now the SeaPark `parkFacilities`
pass for Mars Park: ~170 authored placements across 22 families, one sign atlas,
and the only two moving things in the park.

### Placement is a rule engine, not a list

`Site` is the single gate every family goes through, so a new family can never
quietly break an old invariant:

- **Walking corridor, not paved width.** `corridorHalf(width) = clamp(width ×
  0.31, 0.9, 1.6)`. A path's paved width is not all circulation — roughly a
  third of it is verge, and that is exactly where furniture belongs. Testing
  against the FULL width (the first version) rejected every rim-walk placement
  and left a 700 m promenade empty.
- **Guideway**: `|r − 97| > 2.5 + footprint + 0.15`, non-negotiable.
- **Blockers** are per-structure discs sized to the real footprint. Two were
  originally guessed 30–40 % too large (portal station 21 → 17 m for a 30×13
  deck; tram platforms r 91.6/11 → 93.4/9.5 for a 4.6×16 deck + ramp) and that
  alone unplaced every station board and rack.
- **`nudge()` searches a fan**, not a ray. A single outward ray gives up the
  moment one blocker sits on that line.
- Rejections are counted per family and printed at build time. 40–60 refusals
  out of ~210 attempts is the healthy signal that the rules are load-bearing.

Plaza entries are **read off the paved field** (`pavedSignedDistance` sampled
round r = 27.6, runs of paved bearings = spoke mouths) rather than guessed:
parkPlan authors spokes that stop short of the plaza and `pavingPlan` runs them
in, so only the field knows where the openings in the planter ring are.

### One atlas for every legend in the park

`buildAtlas()` shelf-packs each sign at its OWN aspect into a 2048-wide canvas
(no stretching), returns a rect per id, and emits **two merged quad meshes**:
`amenities:signs-lit` (emissive ×3.4 — the ink is the emitter, so a dark ground
stays dark and only the legend crosses the bloom threshold) and
`amenities:signs-plate` (matte, engraved). ~170 faces, 49 tiles, 2 draws. Banner
cloths index the same atlas.

Sign-face convention: `yaw` gives the face normal `(sin, 0, cos)`, `pitch`
rotates it about the face's own right vector (`+π/2` = lying face-up, which is
why ground stencils are authored with `yaw = readingDirection + π`). Do NOT add
a `mirror` flag for a back face: the quad's right vector already flips with the
yaw. The banner cloth is the one exception — both of its layers share one
authored right vector, so its back layer does need the u flip.

### Ambient motion

Banners and festoons ride a baked `sway` vec3 attribute — `(dirX·w, dirZ·w,
phase)`, where `dir` is the horizontal flutter direction and `w` the free-edge
weight — so hundreds of independent cloths and bulbs merge into ONE geometry and
still move apart. Amplitude is 35–50 mm: this is sealed interior air, not
weather. Banners are two single-sided layers 7 mm apart with mirrored UVs (a
DoubleSide cloth shows its legend backwards from behind), hemmed 3.5 % short of
each arm so the grid never threads the 46 mm arm section.

### Joinery rules this layer had to learn (all found by the gate)

1. **Never `insetPoly` a rounded rect by more than its corner radius.** The
   corner arcs fold back through themselves and the fold ships as coplanar
   same-facing cap triangles. Every hollow shell and recessed lens in the first
   pass had one. Fix: author the inner outline (`insetRect(w,h,r,seg,d)` in
   `kit.ts`, or an explicit `roundedRect`), and keep its radius comfortably
   larger than `hollowPrism`'s own rim bevel — the rim ring is `insetPoly(inner,
   rimBevel)` and folds for the same reason.
2. **Do not land a part EXACTLY on another slot's plane.** A post foot on its
   shoe's cup floor is the textbook butt joint, but the clash pass's
   edge/triangle test is numerically ambiguous on a shared plane and reports
   crossings. Every post here sits 3 mm above its cup floor and 6+ mm inside its
   bore; every applied plate stands 3 mm off its recess floor.
3. **Rails stop at post faces.** A continuous guardrail rail threads through
   every stanchion — the dome gridshell rule again. `guardrail()` now emits
   bay-by-bay between post faces with a 3 mm shadow gap.
4. **Prefer ONE slot over a clean joint.** The lamp's pole, hatch, bracket arm,
   luminaire body, fins and screws are all `steel`; the fountain is entirely
   `aluminum`; the fingerboards share the posts' slot. Interpenetration inside a
   slot is a joint (invisible to the clash pass, and the "bury and cap" idiom
   the craft docs recommend); across slots it is a defect.
5. **Anything with a plan outline that repeats needs a real object, not two
   copies.** The bike rack's first version put two ground rails at the same
   y and z (the hoops were planar), i.e. two bars in one volume.

### Verification

`node --experimental-strip-types tools/amenity-audit.mjs` builds every kit
family in isolation, then the whole dressing pass, and runs `archkit/audit.ts`
over each. It needs no browser and survives the park being mid-rewrite. Current
state: **zero zfight, zero clash, zero defects** across 16 meshes / 258 k
triangles. The one filtered pair is pre-existing and belongs to
`archkit/kitBench.ts` (below).

### Known defect NOT from this layer

`kitBench.ts` ends its aluminium cross stretchers exactly on the cast frame's
inner cap plane (`x = ±0.7225`), so `part:cast` × `part:aluminum` reports 60
crossings per bench park-wide. One-line fix: shorten the stretchers to
`±(FRAME_X - FRAME_T/2) - 0.003`.

---

## The Commons + the Hydroponics tower (W2, commons agent)

`world/districts/commons.ts` and `world/districts/hydroTower.ts` build the two
reference-image hero buildings. The **hydroponics tower is sealed** — no
`services.doors` entry, no interior access; its whole job is to be looked
*into*. **The Commons is enterable** (overhaul, commons agent): two real
sliding leaves, a walkable hall, a helical stair and a gallery. Its fit-out
lives in `world/districts/commonsInterior.ts`; see "The Commons interior"
below.

### Authoring frame

Both are drawn Z-UP in the building's own local frame — plan `(x, y)` are
offsets east/south of the `parkPlan` anchor, `z` is height above the paved
apron — and each part is `translate`d by `[cx, cz, y0]` at emit, where
`y0 = interiorHeight(anchor)`. Nothing in either file re-derives a dimension:
the named constants at the top of each file ARE the layout.

### The curtain-wall assembly rule

Restated from the dome gridshell, and the reason both buildings audit clean:

> ring beams / floor bands are **continuous** → mullions stop `REVEAL` (6 mm)
> short of them → transoms stop short of the mullions → the pane plane sits
> `MULL_GAP` (12 mm) inboard of every mullion's inner face.

One radial datum per member family; depth is the only variable. The panes are
**faceted** (a flat pane per bay, 48 bays on the Commons, 32 on the tower),
because that is how a curtain wall on a drum is actually glazed, and it means
the straight mullions and the glass agree about where the wall is.

`memberSection()` (both files) carries a **splayed shoulder** where the cap
meets the web. This is mesh hygiene, not styling: a square shoulder puts four
collinear points on the line `u = depth`, and the n-gon ear-clipper then emits a
zero-area triangle in every extrusion end cap — 41 of them on the first pass.

### `BUTT = 0.004` — the reveal at every cylinder-to-cylinder joint

Two rings authored to the SAME radius produce exactly coincident faces. The
audit reads that as a clash (the edge/triangle test is ambiguous on a shared
surface) and a renderer reads it as a flicker. Every ring that butts another
ring radially is inset 4 mm. Planar butts (an underside on a top) stay exact —
those are the legitimate `backToBack` class.

### `groundedBand()` — the aprons are NOT level

`PADS` skirts from neighbouring pads bleed across each other: the works pad
tilts the **Commons apron 84 mm** from centre to edge (15–47 mm on the tower).
A plinth authored at one datum therefore floats a visible 5 cm on the low side.
`groundedBand(rOuter, rInner, zTop, ground, a0, a1)` lofts a band whose top is
flat and whose bottom samples `interiorHeight` per vertex. Used for both base
rails, the Commons interior floor, the threshold plate and the tower plinth;
columns, flagpoles, the stair newel and the blade sign take their own foot
height instead. **Any future object that touches an apron owes this.**

### Sign boxes (`signBox` + `curvedSignMesh`, exported from commons.ts)

A backlit sign is a back plate applied `BUTT` proud of its host, a four-member
bezel proud of that, and a **zero-thickness face mesh** in the reveal between
them, with two `signageGlow` wash strips in the 30 mm band between the face edge
and the bezel rail. `signBox()` RETURNS the face's radius/arc/height so callers
cannot re-derive it wrong. Three traps, all of which shipped once:

1. The face is one lofted strip; `recalcNormals` orients an open component by a
   majority keep-score, which for a single quad row is arbitrary — both faces
   came out back-facing (an empty tray with lit reveals). `signFaceMaterial`
   forces `DoubleSide`.
2. Seen from OUTSIDE a drum, screen-right is **decreasing** plan angle, so the
   u remap must run against the bearing or the lettering mirrors.
3. `CanvasTexture.flipY` already turns the image over: inverting v as well
   flips every glyph upside down.
4. **Panel proportion is a contract with the canvas.** face width = arc ×
   radius, face height = `2·(halfZ − rail − 0.03)`; `signFaceMaterial`'s
   `aspect` must match, or the letterform stretches (the "62" was 3× off).

Emissive is `ink × 3.4` over a dark field, so only the lettering sits on the
`signageGlow` rung and the field stays dark — the reference's exact look.

### Light

`interiorGlow` cove rings (recessed 45 mm behind their own trim), pendant
lenses, and the canopy soffit slot; `signageGlow` at the sign boxes, the blade
sign edges and the counter reveal; `growBar` under every tower tray;
`utilityLight` only on lenses under ~0.1 m² (bollard rings, beacons). Neither
file registers a real light — `commons-entry` and `hydro-tower-spill` already
exist in `world/lightFixtures.ts`.

### Contract for the vegetation pass

`hydroTower.ts` exports `HYDRO_SHELVES: HydroShelfRun[]` (24 entries = 3 floors
× 8 arc runs) and `HYDRO_TIER_HEIGHTS`. Each run gives the world centre at its
floor level, the tangent `yaw` (`(sin yaw, cos yaw)` in world x/z), the arc
`width` at the rack mid-radius and the tier count. Baseline planting (552 leaf
cards over two species) is already built; this exists so a denser pass can be
laid on top without re-deriving a dimension.

### The Commons interior (`districts/commonsInterior.ts`)

`commons.ts` owns the drum; `commonsInterior.ts` owns everything a guest can
walk on, sit at or read. The interior file publishes `COMMONS_STAIR` and
`COMMONS_WELL`, and the shell reads them to cut the level-2 plate — the stair
and the hole it climbs through cannot drift apart. `commons.ts` hands over a
`CommonsShell` (emit, world, every radius and level, the door angles, the
foliage accumulator); nothing on either side re-derives a dimension.

Programme, in plan angles (0 = +x, entrance at +90):

| sector | what |
|---|---|
| 82.5–97.5 | entrance: portal, two sliding leaves, a 1.72 m dust grate |
| 118–180.4 | helical stair, 29 risers × 168 mm on the r 7.45 walking line |
| 196–252 | GALLEY — served counter + back-bar gantry |
| 282–332 | CLINIC — nook behind a glazed screen with a 1.1 m doorway |
| r < 4.28 | ASSEMBLY — two refectory tables + lectern on a raised medallion |

**The entrance is a flat applied portal, and it has to be.** `DoorSpec`'s
`openOffset` is a linear translation, so a leaf authored on the drum's curve
cannot slide along its own wall. The portal plane stands 220 mm proud of the
glazing (leaf inner face at r 9.16 measured on the tangent at `PHI_FRONT`),
which is the smallest offset that clears every mullion cap — they reach
r 9.092 — over the leaves' whole 1.19 m travel. Two radial glazed returns
spring off the jamb mullions at ±15° and close the wedge, so the porch is not a
way round the doors. Clear opening **2.26 m × 2.42 m**.

**The drum is a wall, not a rock.** The old single r 9.18 cylinder collider is
replaced by `wallRingColliders()`: chord cuboids (local +X on the tangent, yaw
`atan2(−cos φ, −sin φ)`) with a gap over the two entrance bays. Door blocking is
the `DoorSpec` collider's job — `DoorsSystem` disables it past `open01 = 0.4`.

**Each stair step is one cast block**, not a tread on a stringer: a level tread
and a raking stringer disagree by half a riser across one tread, so the tread
either floats or drives in. Blocks overlap by 0.8 mrad (same slot, so it welds),
the metal tread plate floats over each on a 4 mm shadow gap and stops short of
the next block's nosing, and the balustrade is a `loft` of VERTICAL sections —
`tubeAlong` frames its profile perpendicular to the path and on a 30° rake that
leans the whole ribbon back half a metre.

**The stair is dimensioned by the CHARACTER CONTROLLER, not by code minima**, and
all three numbers were wrong on the first pass — the gallery was unreachable on
foot while the geometry audited perfectly clean:

1. **Headroom is `capsule + autostep` = 1.8 + 0.42 = 2.22 m**, because rapier
   lifts the capsule by `maxHeight` before casting forward. `COMMONS_WELL.a0`
   is set so every tread above it is open to the atrium (2.7 m at the edge).
2. **`minWidth` (0.28 m) is checked against the going at `rIn`**, which on a
   helix is the shortest: `dTheta` is 0.0428 so the inner going is 0.287 m.
   Quoting the walking line (0.319 m) hides a failing stair.
3. **A ring collider with a gap must be generated from explicit angles.** The
   gallery deck was chord boxes culled by centre angle; each box's inner corners
   swing `atan(halfWidth / r)` forward, so the deck roofed the flight 9° past
   where the mesh ended. It is now two radial bands over explicit runs.

Railing colliders match their blades (0.06 m, not 0.14) — collider thickness is
walkable width, and the corridor must keep ≥0.6 m of lateral play for the
capsule. Mechanical gates for headroom and corridor live alongside the geometry
audit; both are cheap loops over `services.colliders`.

**The floor is `cast`, not `deck`.** `deckPlate` is a ribbed treadplate; in
raking sun through the curtain wall a civic hall floored in it reads as a
gantry. Four terrazzo fields, three recessed `steelEdge` divider channels, a
raised medallion and the grate. The finish is **76 mm** thick (`Z_SCREED`) —
16 mm has nowhere to put a recess.

### Verification

Isolated per-part audit (each `writer.raw()` call in its own slot, so the clash
pass names individual parts):

- hydroponics tower — 815 parts: **zfight 0, clash 0, defects 0**
- the Commons — 1402 parts, 189 k triangles: **zfight 0, defects 0**, 9
  cross-slot clashes, every one a deliberate 4 mm reveal (floor divider
  channels, cove pockets, sign bezels) tripping the audit's 30 mm scaled
  tolerance. `zfight` is the gate; clash at this granularity is noise.

Note the `kitBench.ts` cast × aluminium defect is invisible at `yaw = 0` because
the clash pre-filter is axis-aligned — audit rotated copies.

---

## The leisure heart (W2, leisure agent) — `districts/leisure.ts` + `loungeInterior.ts`

The assembly bowl, the Overlook Lounge drum, the First Tree's soil ring and the
playground, rebuilt as profile sweeps. Both files author Z-UP with the plan as
`(worldX, worldZ)`, so a swept section reads `(outward, up)` and `toTriangles()`
converts once at emit.

### The bowl is laid out from the STAGE, not from +X

`ARC_CENTER = bearing(bowl → stage pad) + π`. The stage pad sits 23° off the +X
axis, so the previous arc (centred on +X, itself a fix for a worse bug) had the
audience facing 23° past the stage. Centring on the stage axis also lands the
whole bowl on the frozen sun's bearing (≈160° math) — stage, west glass and low
sun arrive in one look, which is the postcard.

### Deck heights are SOLVED, never authored

`deckHeights()` takes a constant 0.30 m rise per terrace and raises the whole
stack until (a) row A clears the orchestra by a real riser and (b) every deck
clears the paved vomitory at its own OUTER edge by 0.22 m. Both constraints read
`interiorHeight`, so a change to the authored dish moves the bowl with it. The
result: decks −0.98 … +0.52, crown standing 0.81 m proud of grade at r = 25.3
(the outer retaining wall is what makes the bowl read as a structure from the
plaza approach rather than a dent).

### The `amphitheater-spur` paving IS the fourth aisle

`pavingPlan` runs that ribbon from the plaza down to r ≈ 10 — through the middle
of the seating. Rather than build over a slab we do not own, `rowRuns()` trims
each row with `pavedSignedDistance(...) < 1.0`, so the corridor stays open at
grade and becomes the bowl's vomitory ramp (it takes 21 % of row A's arc, 9 % of
row F's — a wedge that narrows as it climbs, exactly like a real one). Three
STEPPED aisles are authored on top of that at 0.2 / 0.6 / 0.8 of the arc.
**Consequence for anyone moving that path: the bowl re-cuts itself.**

### Joinery rules the gate forced (beyond the ones already in this file)

- **A 30 mm movement joint at every run end.** Two cast solids meeting on an
  exactly shared plane trade numerical crossings all along it. `rowRuns()`
  shrinks each run by 30 mm of arc; a poured bowl has that joint anyway.
- **A scaled-down ellipse is NOT a parallel curve.** `ellipse(ax−d, az−d)` and
  the true normal offset differ by 120 mm at 45° on this drum — enough for the
  lounge's floor slab, mezzanine and roof slab to grow through the beams they
  were meant to butt. `ellipseInset()` / `drumInset()` do it properly, and every
  slab still stops 30 mm short of its beam.
- **A bay's chord midpoint is not on the ellipse.** The base band's light slot
  was placed per BAY and sat up to 90 mm inside its own groove at the drum's
  ends. Stepped per FINE station (3 per bay) it is 10 mm.
- **Offsetting a rounded corner by its own radius collapses the arc** to a stack
  of coincident points — the name stone's 0.06 corner under a 0.06 inset, and
  `roundedRect(d, d, d/2)` used as a circle (four doubled vertices). Use
  `circle()` when you mean a circle.
- **A swept section that runs INWARD further than the path's radius of
  curvature folds through itself.** The stage's perimeter beam (0.20 m inward on
  a 0.17 m corner radius) was self-coplanar; the deck corner went to 0.85 m.
- **Bury foundations, do not rest them on the regolith.** The stage steps'
  undersides sat exactly on the pad's dead-flat −1.80 m plane: 16.5 m² of
  `part:cast` × `ground:regolith` z-fight. Paving is more forgiving but the rule
  is the same — the bottom step and the perimeter beam are now founded 0.30 m
  down.
- **Playground equipment stands ON the poured surface, and its shoes take the
  frame's slot.** A slanted leg's end cap dips below its own axis, so leg and
  shoe always share a little volume; that is a joint inside one slot and a
  defect across two.

### Elements worth knowing about

- **Terraces** are one swept casting per row per block (profile: deck with a
  13 mm inward fall, 22 mm nosing arris, riser, 34 mm set-back foot). The top
  row's profile grows the crown parapet instead of an outer face — one casting,
  no applied coping.
- **Benches** are a separate continuous casting per block, hard against the
  riser above with a 38 mm shadow gap, its underside cut to the deck's fall
  plane so it butts rather than gapping or bedding.
- **Aisles** are ONE casting each: a radial staircase profile (13 risers, a
  60 × 14 mm light rebate in every tread) swept along a short arc, so the treads
  are concentric with the terraces and the aisle is an authentic radial wedge.
- **The stage shell is capped at 2.05 m above the deck ON PURPOSE** — from row
  A's eye (+0.15 m) the mountains have to clear it. The concert canopy now
  rises separately on an open truss frame; the low shell remains the opaque
  horizon blocker and acoustic surface.
- **The Bowl stage keeps its original cast construction at 1.8× linear size.**
  The bullnose deck, set-back perimeter beam, founded side flights and acoustic
  shell are still the same authored lofts/sweeps, now **23.40 × 14.04 m**.
  Pier rhythm, front lenses, shell ribs and every collider are re-derived from
  the enlarged contract; there is no late object scale and no old-size physics
  box hidden under the deck.
- **The concert kit is a separate deterministic assembly** in
  `districts/amphitheaterStage.ts`: four 380 mm aluminum box-truss towers on
  bolted feet, five bowed roof trusses, two longitudinal edge trusses and a
  65 mm closed fabric canopy whose crown is 7.01 m above the deck. The truss
  web terminates on chord centrelines and is batched into the shared aluminum
  slot; the membrane is one watertight grid shell, not overlapping roof strips.
- **The stage equipment has a front and a signal path.** A quarter-sawn walnut
  lectern stands on the audience axis near the apron, with a tapered one-piece
  carcass, canted reading top, raised/brass-trimmed front panel and swept
  gooseneck microphone. At the rear are matched dual-driver subwoofer cabinets,
  three-module line arrays per side, a six-unit amplifier rack, two canted
  floor monitors and a raised cable bridge. Drivers are revolved cones and
  surrounds rather than dark discs; horn mouths are real open flares.
- **Stage materials own physical roles.** `stageWood`, `stageBrass`,
  `stageBlack`, `stageCone` and `stageCanopy` are procedural TSL materials in
  the shared library. Their UV/world-space fields preserve metre-scale walnut
  figure, brushed brass, touring-case pebble, graphite fibre and technical
  weave while specular AA keeps grazing highlights stable.
- **The Overlook Lounge is an ELLIPSE** (5.35 × 9.55), which fills parkPlan's
  20 × 11 footprint, curves continuously from every bearing, and gives
  design.md's "long window" on the west flank. 32 arc-length-equal bays.
  `loungeShell()` is the shared contract between the shell and the fit-out —
  levels, stations and the roof opening — so neither file can drift.
- **The mezzanine is a chord-cut floor over the north third, not an annular
  gallery.** A gallery leaves nowhere for a stair to land (the run has to start
  outside the drum), and the open two thirds is what makes the lit interior read
  as one volume through the glazing.
- **Both interior flights are authored ONE RISER SHORT**: the slab they arrive
  at is the top nosing. A full-height flight buries its last tread in the floor.
- **The soil ring is one loft with a per-longitude section** — the plain coping
  on the south half grows continuously into a seat ledge and a back on the north
  half over ~20°, so the bench is part of the pour. The soil surface is at
  `plaza + 0.425` with a 75 mm crown, because `vegetationSystem` plants the tree
  at `plaza + 0.5` and contact is a sink, not a rest.

### Verification

`tools/amphitheater-stage-audit.mjs` compiles the concert kit headlessly through
the shipping `PartWriter`. It asserts the 1.8× envelope, eight material roles,
12 owned colliders (including three silhouette-fitted lectern volumes),
573 deterministic authored parts, 43,648 triangles, zero
degenerate/non-finite records and zero cross-slot coplanar pairs. It starts no
renderer or browser.

`zfight 0` for every part of this district, confirmed two ways: a headless
per-part audit (every `writer` call in its own mesh, 1 251 parts) and the
in-page gate bounded to each site. The two remaining merged-level z-fight pairs
are `interiorShared.slidingDoor`'s own (below), and the remaining clash pairs
are `kitBench` and `kit.stairFlight` internals already documented above.

### Known defect NOT from this district — `interiorShared.slidingDoor`

The door leaf's glazing panel and kick plate are 0.09 m deep on an 0.08 m leaf,
centred +0.005/+0.006, so their BACK faces land within 1 mm of the leaf's back
face: `part:aluminum` × `part:darkGlass` (5 562 cm²) and `part:orange` ×
`part:aluminum` (1 819 cm²) on every sliding door in the park. Fix: make both
applied panels shallower than the leaf and push them forward, e.g. depth 0.07
centred at z = +0.012 (proud in front, clear of the back).

---

## Residential Arc (overhaul W2) — `districts/residential.ts` + `habUnit.ts` + `habInterior.ts`

Ten homes waiting for their city. `habUnit.ts` is the parametric dwelling (one
product, two sizes); `residential.ts` places, dresses and contracts;
`habInterior.ts` furnishes the one enterable room.

### Where the row stands, and why it is NOT on r = 88

`habSites()` surveys ten sites on r = 88. Two neighbours squeeze that line and
both push inward, so the survey arc is the line the row is set out FROM, not
the line it stands on:

- **Outward** — the boulevard's inner curb presents its outer face at
  `BOULEVARD.innerRadius - 0.165 = 90.835`, and past it is the guideway swept
  volume (94.5–99.5).
- **Inward** — `PATHS['residential-lane']` TERMINATES at (−86, −26), 1.85 m
  behind hab 1's survey site. Its paved capsule plus curb reaches in to
  **r = 87.98**, so a hab centred on its site (back face r = 90.75) has a white
  curb and 3.4 m of paving running under it.

`BACK_LINE = 87.55` is therefore the row's single back building line —
0.43 m clear of the lane's turning head, 3.28 m clear of the boulevard curb,
7 m clear of the guideway. Uniform on purpose: a per-hab setback puts one unit
visibly out of an otherwise perfect arc. Habs are placed by `BACK_LINE −
shellHalf[2]`, so changing the barrel's width does not move the back line.

**OPEN LAYOUT CONFLICT (needs a `parkPlan.ts` edit, not fixable from here):**
`PLAYGROUND = (−62, −54, r 9)` sits at bearing 3.858 — 0.039 rad from hab 5
(3.897) and only 5.8 m radially inboard of the survey arc. Its poured surface
swallows habs 4 and 5 at ANY radius the arc can legally take (hab 5's centre is
4.2 m from the playground centre at the built radius; 6.7 m on the raw survey
arc — the disc's radius is 9). Proposed fix: move `PLAYGROUND` to (−50, −44)
(r 66.6, still ~14 m from the Common Hab, so "nearby" holds) or shrink it to
r ≤ 4.5. Second, smaller request: trim the `residential-lane` spine's last
point from (−86, −26) to (−88, −30) so the lane dies in the boulevard instead
of at hab 1's back door; the arc could then move back out ~2 m.

### The hab shell: one analytic surface, no assembly

The whole read of the object comes from ONE idea (`experience-craft.md` §5.2):
the shell is a closed section swept along the frontage, and every feature is
GENERATED from that surface — `pt(i, j, off) = ring[i][j] + normal[i][j]·off`.

- `off > 0` proud (the pressed window surrounds, 24 mm), `off = 0` the skin,
  `off < 0` the reveal / jamb / inner lining. Skin, holes, reveals, surrounds
  and lining share ONE welded vertex pool, so the shell is a single closed
  solid: no part can drift, no jamb can gap, no boolean anywhere.
- Transverse panel joints are **grooves in the section offset** (`insetAt`),
  not strips laid on the skin — a strip tangent to its host is exactly the
  coplanar defect the audit exists to find. Same for the belt rail at the
  waist: four knots in the profile.
- The two end bulkheads are a quarter-round roll built the same way.
- The airlock collar's ROOT RING **is** the door aperture's boundary on the
  curved shell; it flares over five rings onto a flat vertical mouth, which is
  what turns a leaning opening in a barrel into a square pressure-door frame.

### Three traps this rebuild hit, all found by the audit and not by eye

1. **Offsetting a section inward folds its own detail.** The lining is offset
   from `HabSection.flat` (the outline with the belt rail flattened back onto
   the base curve), never from `pts`: a 60 mm proud rail offset inward by the
   95 mm wall folds through itself and produced **3 m² of same-facing coplanar
   overlap running the length of the hab**. The same thing happens at the end
   roll, where the outer ring is offset by up to 130 mm — so the rail FADES
   OUT into the roll (`fade = min(1, roll/0.018)`), and the lining's total
   inset is clamped to `LINING_MAX = 0.165` because the 260 mm bottom fillet,
   sampled at 22.5°, collapses and crosses its own mitres past ~175 mm. An
   n-gon end cap built on a self-intersecting outline ear-clips into
   overlapping coplanar triangles.
2. **A capped stacked-ring `loft` emits SOLID DISCS, not a shell.** Three
   parts were authored as "a bead / a ring / a picture frame" and shipped as
   slabs covering their hosts (the planter hoops, the hand-cart frame, the
   notice-board surround — 1.07 m² of steel straight over the board's face).
   Use `annularPrism` when you want a ring; `capStart/capEnd` on a stacked-ring
   loft is only correct when the part really is solid (a table top, a cushion,
   a door leaf).
3. **`roundedRect(w, h, r)` offset inward by more than `r` inverts its
   corners** and self-intersects silently. Every `polyOffset(poly, −d)` in
   this district now keeps `r > d`. This produced z-fights on the table apron,
   the sofa cushions and the shelf boards.

### Slot discipline (the clash pass compares mesh PAIRS)

`PartWriter` merges one mesh per material slot for the whole park, so two parts
in DIFFERENT slots may never interpenetrate — and an EXACT butt reads as a
crossing too. Every cross-slot joint here carries a 2 mm reveal. Where a
fitting genuinely has to bury itself (hatch upstand, vent flange, lamp hood,
HVAC cradle, plate ribs) it is authored in the `habShell` slot so the bury
welds instead of clashing — which is also what those parts are: mouldings of
the shell. Same reasoning put the fan guard's spokes in `dark` with its ring,
the foundation cross braces in `steel` with the skids, and the conduit's clips
and junction box in `dark` with the pipe.

Bedded roof fittings stop INSIDE the 95 mm wall cavity (`bedZ = crownZ −
0.055`): a downward-facing face at the lining plane is coplanar with the
ceiling and z-fights it.

### Ground contact is per-site, not per-datum

`interiorHeight` varies by ~±0.1 m across a 7 × 5.5 m footprint, so one hab
height would float half the feet. `buildJackFoot(groundDrop)`,
`buildPier(...)` and `buildStepBlock(...)` are built PER SITE against their own
sampled grade — the jack screws really do differ in length down the row, which
is what jacks are for. Pads bed 10–12 mm (contact is a sink, never a rest).

### Windows: the arc's signature at dusk

`HabUnitContract.panes[]` hands the caller a SURFACE QUERY `at(u, v, off)`, not
a rectangle: the opening is on a leaning wall and a flat rectangle pokes
through the skin at one end. Layers, all inside the reveal: glazing at
30–50 mm (`interiorGlow` when lit, `darkGlass` when not), mullions proud of it
at 12–26 mm, curtains behind at 58–70 mm. Lit-ness, curtain colour and
drawn/parted come from `rng.fork('hab-light-N')`, ~78 % lit on the porch side
and ~45 % on the guideway side — that mix is what stops ten copies reading as
ten copies. All ten hab numbers are ONE canvas atlas on ONE merged mesh
(`emissiveNode = texture·3.0`, just under the `signageGlow` rung).

### Contracts

- `habFrames()` / `commonHabFrame()` — the row's authored placement, shared
  with `habInterior.ts`. `HabUnitContract` carries `panes`, `jacks`, `piers`,
  `chairAt`, `touchAt`, deck geometry, `plateAt`/`plateNormal`, `doorMouth`
  and `shellHalf` so no caller re-derives a dimension.
- `HabUnitSpec.openDoor` leaves the collar mouth EMPTY for the Common Hab so
  `habInterior.ts` can hang the animated sliding panel there. Two leaves in
  one opening is the classic way to grow a second door out of the first.
- Seats: 3 sittable porch chairs (habs 1, 3, 8, "Sit on the porch"), 4 stools
  ("Join the game"), 1 sofa ("Sit"). 87 colliders (shell boxes, Common Hab
  wall runs with the door bay open, walkable porch decks, two step treads
  inside the 0.42 m autostep, railings).

### Verification (mechanical; no screenshot — every browser tab was held by a
peer agent at hand-off)

Per-part audit of each variant (every `MeshData` in its own named mesh, which
is far stricter than the merged-by-slot scene the real gate sees):

- dwelling — 137 parts, 23.7 k tris: **zfight 0, defects 0**, no cross-slot clash
- Common Hab shell + interior — 162 meshes, 42 k tris: **zfight 0, defects 0**,
  no cross-slot clash
- whole district merged (20 slot meshes, 363 k tris, 262 k triangles compared):
  **zfight 1 hit / 31 cm², defects 0**, backToBack 3258. Down from 6 hits /
  26 991 cm² on the first pass. The residual is a 0.003 m² same-slot `dark`
  patch on the Common Hab's porch fittings — under the visual threshold, still
  worth a look if anyone is in there.
- The shell's signed volume is positive for both variants (the S14 inside-out
  barrel check), all normals unit and finite, zero degenerate triangles.
- Build cost 330 ms for the whole district (both unit variants are built once
  and each site transforms a cached triangle soup, `kitBench.ts` pattern).

Residual cross-slot clash pairs (25) are small decorative interpenetrations in
the touches and the between-hab dressing; none is a structural defect and the
same pair names already exist park-wide. Worth another pass when someone is
next in this file.

### Postcard

`core/postcards.ts:porch` still frames the OLD arc and now looks into the back
of hab 3 from inside its footprint. Requested replacement (measured against
the built row, eye 1.68 m on the front walk, looking at hab 3's door and
porch): `porch: { position: [-66.3, 1.8, -38.4], look: [-70.5, 1.5, -41.9] }`.

---

## The Works (W2, works agent) — `districts/works.ts` + `districts/opsInterior.ts`

Life support at park scale: a real portal-framed machine hall you can walk
into and over, a tank farm of metal spheres, the white water tower on the
skyline, a maintenance yard with docked machines, and the radiator field in
the outer band. 225 k triangles, 16 slots, 53 colliders, 2 seats, 1 door.

### Authoring frame

Everything is drawn **Z-up with the plan on world XZ** — a vertex is
`[worldX, worldZ, height]` — so plan coordinates read 1:1 against
`parkPlan.ts` and no `placeYaw` is needed for the district as a whole. The
machine hall adds one local frame, `(a, c, h)` = (along the 26 m axis, across
the 15 m span, height above the poured slab), with `hallPlan(a, c)` / `hv()`
/ `hp()` as the only converters. Two constants exist purely so lathes land
right: `AX_ALONG` / `AX_ACROSS` are the `rotateZ` angles that put an
`axis:'x'` revolve onto the hall's own axes. Getting that wrong rotates a
compressor 50° off its skid and is invisible until you look down the hall.

### Datums — nothing is ever buried, nothing is ever flush

- `FLOOR` = max(`interiorHeight`) over the hall footprint + 0.14. The ground
  falls 100 mm across the hall (the yard pad's skirt bleeds under its west
  corner), so the slab is LEVEL and the upstand shows 0.14–0.24 m.
- `pouredPad(outline, topY, …)` is the district's one ground-contact tool: a
  centroid-fan top, a chamfer band, and a skirt whose bottom ring rides
  `interiorHeight + 12 mm` per sample. No solid ever enters the terrain mesh
  (the `clash` class) and no face is ever coplanar with it (the `zfight`
  class). Every pad datum comes from `outlineTop()`, never from `PADS[].y`.
- **Two pours may not share a datum.** The tank farm and the water tower are
  7.2 m apart with r 9.4 / r 4.6 aprons: as separate discs they overlapped
  by 50 m² at exactly the same height. They now share ONE pour, the convex
  hull of the two circles (`planStadium`). The reclaimer keeps its own pour
  and is shifted 0.8/0.5 m so it cannot reach under the hall slab.

### The assembly rule, restated for a shed

Same hierarchy as the dome gridshell and the curtain walls above:

> frames continuous → purlins and girts fill the reveal BETWEEN the frame's
> outer fibre and the sheeting → sheeting runs are SPLIT at every opening →
> jamb / head / rake trims lap both cut edges with an 8 mm reveal.

Concretely, one radial section through the long wall, and the reason it
audits clean: column outer flange **7.340** | glow panel 7.353–7.398 |
clerestory glass 7.420–7.450 | frame member 7.385–7.475 | girt 7.352–7.472 |
sheeting crest 7.484–7.542. Every applied thing on that facade — trays,
HVAC, signs, lamps, downpipes — starts beyond 7.55.

- `portalFrame()` stations name the member's **OUTER FIBRE**, and the loft
  offsets each section inward by its own half depth. That is what lets a
  purlin land exactly on the rafter's top flange instead of 150 mm above it,
  and it is why the roof line is a single function `roofLine(c)`.
- The knee and the apex are **mitred in one continuous loft** (bisector
  normal, scaled `1/cos`), so column and rafter are one casting rather than
  two members pushed into each other.
- Cladding is real trapezoidal profile sheeting: `ribLine()` walks the
  section, two rings are lofted, and `solidify(16 mm)` closes it with real
  rims. Openings are made by splitting the run — never a boolean, never a
  decal. Fastener domes are driven off **each run's own rib phase** so every
  head lands on a crest.
- Girts stop at openings. A rail running across an open roll-up door is the
  one detail that says a shed was drawn rather than framed.

### Traps this district hit, in the order they cost time

1. **`section()` centres its profile on the path.** A member "standing at
   `y`" actually reaches `y − halfDepth`, so every socketed foot has to be
   raised by its own half-depth or it sits inside its own pad. This produced
   most of the district's first-pass `cast × steel` crossings.
2. **A closed ring path is not a closed member.** Repeating the first point
   and capping leaves two rings at one place with different frames — the
   seam overlaps and z-fights. `ringSection()` uses
   `tubeAlong({closePath: true, cap: false})` instead; use it for every
   girder, walkway and rail ring. Pass the loop WITHOUT closing it.
3. **A repeated point in a `guardrail()` path stamps a second post and shoe
   on the first.** The walk's rail is one deduped polyline. Likewise, do not
   run a guardrail alongside `stairFlight()` — it already carries handrails,
   and two cast shoes 106 mm apart overlap.
4. **Crossing bars in one plane.** Bezels, luminaire trays and curtain-wall
   rails all wanted a "frame" made of four bars; four bars that cross at the
   corners are four coplanar same-facing pairs. Verticals run through,
   horizontals butt between them — and where screens sit on a 1.3 m pitch
   with 1.15 m faces, the verticals must be **shared** (4 mullions for 3
   openings), because a per-screen frame wants 160 mm of mullion in a 150 mm
   gap.
5. **Two identical parts at one place** is the highest-yield defect class:
   two bullet tanks laid end-to-end shared their saddles and caps (4.4 m²
   coplanar); an H-frame emitted at both segments' shared node; two coolers
   overlapping by 460 mm. The audit finds all of them instantly — run it per
   sub-builder, not per district.
6. **`darkGlass` is an opaque spandrel.** Interior light behind it is
   invisible. Anything that has to be *lit from within* — the clerestory,
   the ops window — is `cabinGlass`.
7. **`signageMaterial` letter-spaces its text on a canvas that is always
   1 : 0.28.** A plate must carry that aspect (`signHeight(width)`) and a
   line must stay inside roughly **6 / 10 / 14 characters at 1 / 2 / 3
   lines**, or the type runs off the plate. Every legend here is split
   across lines for that reason.

### Contracts leaving this file

- `services.opsAnchor = { position, yaw }` — the ops room's FLOOR CENTRE and
  the hall yaw. `OpsScreensSystem` places its three live dashboards at
  `anchor + along·(i−1)·1.3 + across·(−1.52)`, 1.86 m up, so the screen wall
  is the ACROSS-minus wall and its lining sits at −1.545 (25 mm behind the
  dashboards) inside a shared bezel. Move the room and the screens follow.
  **Open request:** `opsScreens.ts:146` sets `screen.rotation.y = yaw +
  Math.PI`, which faces the dashboards along their own spread axis (they
  come out edge-on). The one-line fix is `yaw + Math.PI / 2`; the geometry
  here is built for the corrected value.
- `OPS_ROOM` (half extents, height, door bay) — `opsInterior.ts` derives its
  whole fit-out from it plus the anchor, so shell and furniture cannot drift.
- The reclaimer's two flues are pinned to `RobotsSystem`'s vapour emitters:
  `(machineHall.x + 6 ± 1, machineHall.z + depth/2 + 7)` with the mouths at
  `interiorHeight + 7.4`. The flue tops are open flares; the rain caps live
  on the two relief vents beside them so nothing sits in the plume.
- The gallery walk is walkable: box colliders follow the deck, both stair
  flights, the half landing and the ops room floor.

### Verification

`zfight 0 · clash 25 (slot-pair, all bury-and-cap joints) · defects 0 ·
nomat 0` over 225 k triangles; nothing enters the guideway swept volume
(r 94.5–99.5) and the field's outermost vertex is r 109.6 against the rim
walk's inner edge at 110.2. Probed headlessly by building the district into a
bare `PartWriter` in node (a stub `document.createElement` is all the canvas
signage needs) and running `archkit/audit.ts` per sub-builder — isolating the
builder is what makes a 226-pair hit findable in one step.
