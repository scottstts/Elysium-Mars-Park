# Geometry craft — the *friends* standard, applied to Mars Park

Reference project: `~/Documents/Projects/Node/friends/` (three 0.182, WebGPU + TSL, Z-up,
fully procedural, hand-ported from a Blender polygon build). Citations are
`friends/src/...:line` or `friends/build_scripts/...:line`. **Read the cited source before
imitating it.**

This is the rebuild contract. Every Mars Park object — tram, bogie, bench, lamp, planter,
hab, airlock, robot, kiosk — ships against §10's gate. If a part is a bare
`writer.box(...)`, it is not finished.

The whole standard in one paragraph, from the original build
(`Central_Perk/mlib.py:1-7`, identical in Monica's):

> Everything is real geometry: quad-dominant meshes built from profiles, lathes, lofts and
> mitred sweeps. **No stacked primitives, no coplanar decals** (all applied trim is a
> separate solid that sits proud of / inset into its host surface so nothing z-fights).

And it was enforced by a program, not by eye — §10.1.

## 0. The ten rules

1. **Author polygons, triangulate once.** Quads and n-gons in a `MeshData`, triangulated
   only at `toGeometry()`. `lib/mesh.ts:1-10, 761-823`
2. **Profiles, not primitives.** The silhouette is a 2-D point list that gets swept
   (extrude / lathe / loft / tube). A box is a last resort, not a starting point.
3. **Edge treatment lives in the profile.** Bullnoses, beads, reveals and chamfers are
   extra levels in the sweep. Only `box` and `prism` get a retro-fit bevel at all.
   `lib/mesh.ts:671-696`
4. **No booleans, ever.** Apertures are welded vertex grids or purpose-made annular /
   apertured prisms. `lib/mlib.ts:119-178, 472-586`
5. **Parts butt or weld — never overlap.** Two faces from different parts may not share a
   plane. Floor for a proud applied part: 0.8 mm. `joey/joinery.ts:70-75`,
   `monica/kitchen.ts:408-410`
6. **Weld and clean before emit.** `cleanMesh` welds at 0.02 mm and drops zero-area faces;
   every loft fold and pole leaves both behind. `lib/mesh.ts:709-757`
7. **Normals are decided, not defaulted.** `recalcNormals` per component, then an explicit
   smooth-by-angle number per part. `lib/mesh.ts:246-338, 700-707`
8. **Metric and traceable.** `perk/layout.ts` is 322 lines of nothing but named millimetres.
9. **One merged mesh per material for the whole scene**, not per object. `core/world.ts:38-52, 212-250`
10. **Collision is authored analytically**, never derived from the render mesh at runtime.
    `core/world.ts:94-159`

## 1. The authoring model

`MeshData` is a polygon soup in **world space** (`lib/mesh.ts:30-62`):

```ts
class MeshData {
  verts: Vec3[]; faces: number[][]        // polygons — quads and n-gons, not triangles
  uvs: (Vec2[] | null)[] | null           // per FACE CORNER, parallel to faces
  colors: Vec3[] | null                   // per-vertex attribute (baked masks)
  faceMat: number[] | null                // per-face material slot
  shading: {mode:'flat'} | {mode:'smooth', angle:number}
  provenance: 'box' | 'prism' | null      // lets bevel() regenerate the part rounded
}
```

Four consequences to internalise:

- **Helpers move vertices, not objects** (`mesh.ts:142-214`). No transform hierarchy, so
  merging is free and materials read `positionLocal` as world position. The build calls
  this deliberate and consequential (`Joeys_apt/mlib.py:1-16`): object/generated texture
  coordinates land in world space, so "two cabinet doors cut from the same stock should not
  share a grain pattern." Mars Park gets this free on static geometry; **moving** objects
  (tram cars, robots) must keep procedural fields in local space instead.
- **Modifiers are eager and ordered** — solidify → subsurf → bevel (`mesh.ts:340-696`).
- **Triangulation happens once**: quads split on the shorter diagonal, n-gons ear-clipped
  on the Newell plane (`mesh.ts:99-138`).
- **Output is non-indexed with per-corner normals** — a corner averages only adjacent faces
  inside the smooth angle, so creases are exact and free, with no split-normal bookkeeping
  and no `computeVertexNormals()` mush (`mesh.ts:761-823`).

**Tangents: there are none.** All relief is derivative bump (`mats/tsl.ts:346-363`). Mars
Park should match — it removes the tangent attribute entirely. Bind a tangent-space normal
map and you owe that geometry tangents; prefer not to.

## 2. The toolkit

### 2.1 Solids

| API | What it is | Cite |
|---|---|---|
| `box(x0,y0,z0,x1,y1,z1)` | 8 verts / 6 quads, marked `box` so `bevel()` can round it | `mlib.ts:33-55` |
| `prism(poly, z0, z1, flip?)` | extrude CCW XY polygon along Z, marked `prism` | `mlib.ts:58-75` |
| `prismXZ(poly, y0, y1)` / `prismYZ(poly, x0, x1)` | same on the other axes — how every *section* part is made | `mlib.ts:78-113` |
| `meshObj(verts, faces)` | hand-written polygons for one-off wedges | `mlib.ts:25-30` |
| `panelWithHoles(w,h,t,holes)` | flat panel with rectangular openings as a **welded vertex grid** → manifold, reveals included | `mlib.ts:119-178` |
| `wallRun(p0,p1,t,z0,z1,holes,…)` | same along a plan line, as ONE welded solid, per-end cap control | `perk/geo.ts:14-88` |

`panelWithHoles`/`wallRun` are the boolean replacement: build coordinate lists from the
union of all hole edges, emit only solid cells, and emit a reveal quad exactly where a
neighbouring cell is missing (`geo.ts:79-82`). No cracks, no coincident faces, and the hole
jambs are real geometry. `wallRun`'s thickness is measured *from* the layout line toward one
named side "so the inner face of every wall lands exactly on its layout line and nothing has
to be nudged afterwards" (`Central_Perk/mlib.py:686-694`).

### 2.2 Sweeps — the actual craft

```ts
loft(rings: Vec3[][], { closeU, closeV, weldPoles, capStart, capEnd })    // mlib.ts:190-252
revolve(profile: Vec2[] /* (r,z) */, segments, { arc, capStart, capEnd }) // mlib.ts:255-271
tubeAlong(path: Vec3[], profile: Vec2[], { closePath, up, cap })          // mlib.ts:274-318
sweepRectFrame(w, h, profile: Vec2[] /* (outward, alongNormal) */)        // mlib.ts:324-346
sweepPlanarLoop(path: Vec2[], profile: Vec2[], close)                     // mlib.ts:349-363
runMolding(path: Vec2[], profile: Vec2[] /* (z, depthIntoRoom) */, …)     // lib/molding.ts:55-75
tubeAlongMiter(path, profile, { miter:true })                             // perk/geo.ts:163-215
sweepVar(spine, radii: Vec2[] /* per-station (across, vertical) */, …)    // joey/props.ts:49-71
```

`loft` is the engine — everything above funnels into it. Three guarantees make it safe:
`weldPoles` collapses on-axis ring ends into **one** vertex, not *n* coincident ones
(`mlib.ts:202-217`); degenerate quads are dropped by de-duplicating the four corner indices
(`mlib.ts:230-234`); and the cap logic distinguishes revolve-style (u sweeps) from
stacked-ring style (v wraps) so a cap is a real n-gon on the right loop (`mlib.ts:236-248`).

**Mitre corrections separate this from a naive sweep.** `densify(pts, d)` inserts a point
`d` before and after every interior corner so a swept profile's mitre stays *confined to the
corner* instead of twisting the whole run (`perk/geo.ts:143-159`). `tubeAlongMiter(…,
{miter:true})` scales the profile's across-axis by `1/cos` at interior corners so the section
keeps a constant apparent width through a bend (`perk/geo.ts:196-200`).

### 2.3 Offsets — the workhorse

```ts
polyOffset(poly, d)              // perk/geo.ts:91-124   (mitre scale clamped to 1/max(0.25, ·))
insetPoly(poly, d)               // lib/mesh.ts:608-633  (same, clamp cosh to 0.2)
offsetPolyline(pts, d, closed)   // lib/molding.ts:17-51 (right-of-travel, true segment mitre)
```

Every reveal, bullnose, fielded panel and chamfered plan-form is `polyOffset` applied at
several z levels and lofted. The clamps stop mitre spikes at sharp corners. Learn this one.

### 2.4 Boolean-free apertures

| API | Use |
|---|---|
| `hollowPrism(outer, z0, z1, inner, cavityZ, rimBevel)` | sunk cavity with a rolled rim, as ONE closed shell. "Same silhouette the Blender boolean produced, built directly." `mlib.ts:427-467` |
| `annularPrism(outer, inner, z0, z1, r, seg)` | through-cut ring, rounded inner **and** outer edges, "without leaving a false cavity floor across the opening" `mlib.ts:472-522` |
| `aperturedPrism(outer, inner, z0, z1, outerBevel, seg)` | through-cut, outer edges round but the aperture stays sharp — worktop around a sink `mlib.ts:527-586` |

Both outlines must have matching vertex counts and matching *semantic* corners so each
annular band bridges the right pair. That is the price of never using CSG, and it's cheap:
build both outlines from the same `roundedRect`/`polyOffset` call.

### 2.5 Edge treatment

```ts
roundedBoxMesh(bounds, radius, segments)  // mesh.ts:529-605
beveledPrismMesh(poly, z0, z1, r, seg)    // mesh.ts:637-667
bevel(md, amount=0.004, segments=2)       // mesh.ts:671-687 — only acts on box/prism provenance
```

`roundedBoxMesh` is a real fillet, not a 45° cut: per-axis knots spaced by `tan(π/4 · k/s)`
concentrate the grid on the arc, points are clamp-and-projected onto the rounded box, and
shared edge points weld by an exact quantised key (`mesh.ts:539-571`). Ships smooth at 40°.

**Measured radii across all 164 `bevel` calls:** 0.0012–0.0025 m ×12 (hardware, hinges,
casings, door leaves) · 0.003–0.005 ×56 (shelves, slats, panel edges, drawer fronts) ·
0.006–0.008 ×41 (plinths, carcasses, cornices, stone) · 0.010–0.016 ×22 (sofa frames,
aprons, machine bodies, tops) · 0.045 ×2 (upholstered arms and backs). **There is no zero.**
Segments are almost always 2, sometimes 3 on a prominent corner.

Anything that is not a box or prism carries its edge treatment in the profile:

```ts
// True half-round stone lip: 5 offset levels, not a chamfer.   perk/counter.ts:62-74
const levels: [number, number][] = [
  [-0.004, 0], [over*0.72, 0.006], [over, (z1-z0)*0.5], [over*0.72, z1-z0-0.006], [-0.004, z1-z0],
]
loft(levels.map(([o, dz]) => polyOffset(poly, o).map(([x,y]) => [x, y, z0+dz])),
     { closeV: true, capStart: true, capEnd: true })   // smoothShade 34

// Fielded panel: face plane, bead, sunk field — 3 levels of one loft.  perk/counter.ts:36-59
// Each level insets ALONG the bay and offsets ALONG the normal simultaneously.
const panel: [number, number][] = [[0, 0], [bead, -depth*0.55], [bead*1.9, -depth]]
```

### 2.6 Weld / clean / normals / shading

```ts
recalcNormals(md, flip?)  // mesh.ts:246-338
cleanMesh(md, dist=2e-5)  // mesh.ts:713-757
smoothShade(md, angle)    // mesh.ts:700-703
solidify(md, thickness)   // mesh.ts:343-391  — offset-0 shell + rim on boundary edges
subsurf(md, levels)       // mesh.ts:394-523  — Catmull-Clark with the boundary rule
```

`recalcNormals` makes winding consistent per connected component by edge traversal, then
orients each: **closed** components by signed volume, **open** ones by majority keep-score
(`mesh.ts:297-336`). Call it after any mirror (`scaleMesh([1,-1,1])`) and any `transform4`
with negative determinant (`joey/joinery.ts:106-114`, `monica/kitchen.ts:217-221`).

`cleanMesh` welds at 0.02 mm and drops faces below 3 unique verts or 1e-12 area. Its
docstring names the failure: "Lofts and joins leave both behind wherever a ring collapses…
and shading breaks along the whole edge loop when a normal is asked for there"
(`mesh.ts:709-712`). The Blender build ran `clean_all()` over everything before auditing
rather than "hunting them one at a time" (`Central_Perk/mlib.py:822-830`).

**Smooth angles actually used** (217 calls): `40°` ×85 (default for lathes, tubes, turned
parts), `34°` ×28 (moulded slabs and slats), `44–46°` ×37 (upholstery and shells), `38°` ×13
(cast iron), `50°` ×11 (buttons, tight rolls), `32–36°` ×11 (table tops). Pick deliberately:
the angle is the crease threshold, and one wrong number turns a bullnose into a facet.

### 2.7 What friends deliberately does *not* have

No CSG. No `ExtrudeGeometry`/`LatheGeometry`. No convex hull. No simplification. No
tangents. No runtime geometry. No per-object meshes. That is the entire surface area — the
power is in profiles and offsets, not an API zoo.

## 3. Joining: no overlap, no gap, no coplanar

**Coplanar**, quoted from source comments. `monica/kitchen.ts:408-410`: "Butt the body
against the fascia instead of overlapping their top faces; that 32 mm coplanar overlap was
the flickering bronze strip." `monica/shell.ts:296-297`: "Start behind the header instead of
overlapping its lower front face; the shared coplanar band was flickering above the
living-room window." `monica/openings.ts:650-652`: a transom at full rough-opening width
"sits inside both jambs and the shared faces flicker at the two top corners" — so it is sized
*between the linings*. `joey/joinery.ts:70-75`: "Offset the complete turned assembly by
0.8 mm along its outward axis so the rose and leaf never submit coplanar fragments in
WebGPU" — every profile point in that lathe carries `+ clearance`. `joey/extra.ts:98-99`:
"WebGPU cannot resolve the Blender well/body faces when both begin at XF."

> **Rule.** 0.8 mm is the floor for a *proud* applied part; 1.5–6 mm is the working range for
> a *reveal*; flush is forbidden. `raisedPanel` uses `proud = 0.008` (`joey/joinery.ts:23-29`),
> `casing` uses `reveal = 0.006` (`joey/joinery.ts:98-104`), cabinet doors `proud = 0.0055`
> (`joey/props.ts:84-93`). These sit deliberately *below* the audit's 1.5 mm coplanar
> distance (§10.1), so intent and defect are mechanically separable.

**Overlap.** Where parts genuinely share volume, friends either welds them into one
`MeshData` + `cleanMesh`, or subtracts at authoring time by splitting the run. The counter's
display case is the textbook case: not one prism with a box punched through it, but **two
prisms for the spans north and south of the case, plus a back slab, plus four frame boxes**
(`perk/counter.ts:94-136`). The oven door is `panelWithHoles`, not box-minus-box
(`monica/kitchen.ts:470-479`).

**Gaps.** Anything reading as a gap is ≥4 mm so it survives at 2 m and casts a line. The
plank tabletop makes board gaps explicit and alternates board cup by ±1.6 mm so the seam is
never a straight zero-width line (`perk/tables.ts:145-158`). Duvet vs mattress: "Extend the
spread past the mattress foot so the two bulged surfaces do not sit within a few millimetres
and z-fight at grazing views" (`monica/beds.ts:131-133`).

**Datum discipline.** `joey/rooms.ts:15-19`: "nothing hung on a bathroom wall sits on the
wall LINE (tiling is 13 mm proud), and everything in the room stands on the tile top,
14.5 mm proud of the parquet datum the rest of the flat is set out from." Constants
`TILE_F`/`BFL` exist so nobody re-derives it. Mars Park needs the same for deck plate, apron
pour, tile and regolith datums.

## 4. Decomposition craft — three objects reverse-engineered

### 4.1 The Central Perk service counter — `perk/counter.ts:78-205`

The plan comes from six named points, not a width/depth (`perk/layout.ts:121-128`), and
every part is generated by walking that polyline.

| Part | Construction | Why |
|---|---|---|
| plinth | `prism(polyOffset(poly, -0.022), 0, 0.115)` + `bevel(0.006,2)` | set back 22 mm → shadow line at the floor |
| carcass ×2 (N and S of the case) | `prism` over filtered sub-polygons | avoids a boolean |
| case back slab | `prism` between case Y bounds | closes the recess |
| case frame ×4 | boxes (jambs, head, sill) + `bevel(0.004,2)` | real reveals around the opening |
| glass shelves ×3 | boxes + `bevel(0.003,2)` | 20 mm thick, inset 4 and 12 mm |
| fielded panels ×13 | one `panelBay` per ~620 mm — count *derived*: `n = round(len/0.62)` | module rhythm from the plan |
| pilasters ×13 | `prism` of a 4-point plan quad + `bevel(0.004,2)`, one per bay boundary; only the last bay emits both ends | no double-emitted shared pilaster |
| stone top | `bullnoseTop(poly, H-0.055, H, 0.048)`, 5-level offset loft | true half-round lip, 48 mm overhang |

Then collision: three axis boxes plus two OBBs generated from the diagonal segments
(`counter.ts:193-204`). Two material buckets total: `cw_oak`, `cw_marble`.

**Pattern to imitate:** *plan polyline → derived module count → per-module part loop →
independent top/plinth as offset lofts → analytic collider.* Never "a big box with a smaller
box on top".

### 4.2 The hero couch — `perk/seating.ts:331-432`

The most instructive object in the repo. Local frame: +X along the length, +Y toward the
back, standing on z = 0 (`seating.ts:1-4`). Ten part families:

1. **Frame rail** `prism` + `bevel(0.012,2)`; **deck** `box` + `bevel(0.01,2)`; **apron**
   `prism` + `bevel(0.016,2)`.
2. **Four feet** — `revolve` of an 8-point turned profile, 16 segments, smooth 40
   (`seating.ts:355-373`).
3. **Tufted back** — one closed loft, 121 × 41, with buttoning as *real displacement*:
   `tuftField` is the distance to the **nearest** button, so creases fall on the Voronoi
   boundaries of the lattice — "which is what makes the diamonds diamonds"
   (`seating.ts:41-49`). A smoothstepped border term damps tufting at the seams
   (`seating.ts:109-112`).
4. **The crest roll** — read `seating.ts:77-85` in full. Capping the top ring fan-
   triangulated an n-gon 115 mm out of plane and "that fan, shaded across a curved crest,
   read as a crease running the length of the back." Fix: the panel stops one roll-radius
   short and `wrap()` arcs rings from the front face over the ridge to the back; nothing is
   capped; every face is a quad or a ridge triangle; `cleanMesh` welds the closing ring
   (`seating.ts:132-155`).
5. **Buttons** — `buttonsOn` re-evaluates *the same surface equation* the panel used, so the
   top row cannot float off the cover; the docstring says so (`seating.ts:163-172`).
6. **Scroll arms** — a closed YZ silhouette (straight back, arc via `arcPts` through 283°,
   return leg) lofted across the arm with eight **inset stations**
   `[0,-0.058] … [0.075,-0.002] … [1,-0.058]` so the ends *tuck* instead of ending flat
   (`seating.ts:205-235`). This idiom is the single best "make an extrusion look modelled"
   trick in the codebase; the recliner reuses it (`seating.ts:694-712`).
7. **Carved volute** — 41-point spiral path with `r(1-0.68t)`, tubed with a circle, mirrored
   by `scaleMesh([1,-1,1])` + `recalcNormals` (`seating.ts:238-255`).
8. **Cushion** — `plump()`: 6 levels where two mid levels push a *welt* outward along the
   radial direction, so the seam is a real piped edge (`seating.ts:303-328`).
9. **Bullion fringe** — one twisted cord per 7.2 mm of hem, ~870 of them, each with its own
   length jitter and sway (`seating.ts:260-298`).
10. Three material buckets total (velvet, walnut, fringe). ≈70 k triangles.

### 4.3 Monica's cabinet run + pro range — `monica/kitchen.ts:137-233, 402-550`

`baseRun(world, run, M, opts)` is a parametric run along a plan segment with **mitre
awareness**: a neighbouring run is passed in, and each offset line is intersected with the
neighbour's corresponding offset line, so carcass, toe kick, door line and worktop each mitre
correctly *at their own depth* (`kitchen.ts:150-171`). Fronts divide on their own offset
line, not the carcass line. A sink is cut with `aperturedPrism`, not a boolean
(`kitchen.ts:178-184, 222-229`). `transform4` places the run and `recalcNormals` repairs
winding (`kitchen.ts:217-221`).

Doors are `slabDoor`: `panelWithHoles` frame + a separate recessed panel, joined then
`bevel(0.0025,2)` (`kitchen.ts:68-75`). Pulls are three lathes (`kitchen.ts:77-108`).

The range, ≈60 parts: body / fascia / cooktop / 6 lathed burner bases / 6 built-up grates
(10 boxes each) / riser with 9 slot vents / oven door as `panelWithHoles` + separate glass /
tubular handle on two lathed standoffs / 5 lathed knobs each with a dark boss box / lower
drawer / two draped towels as a 17 × 14 loft with RNG-seeded folds. The explicit "butt, don't
overlap" comment sits at `kitchen.ts:408-410`.

## 5. Detail-density norms

Measured across `friends/src/scenes/**` (26 574 lines, 1 655 primitive calls): `box` 239 ·
`smoothShade` 217 · `bevel` 164 · `revolve` 158 · `join` 134 · `prism` family 116 ·
`roundedRect` 93 · `tubeAlong` 91 · `circle` 77 · `loft` 64.

`revolve` profiles: median **5 points**; hero profiles 10–22 (urn 16, `counter.ts:530-550`;
pedestal 22, `tables.ts:31-54`; turned leg 11, `seating.ts:742-757`). Segment counts: 10–14
for details ≤25 mm radius, 16–24 for ≤100 mm, 28–48 for anything the player stands beside.

| Tier | Parts | Triangles | Example |
|---|---|---|---|
| Hero, player touches it | 40–90 | 40–90 k | hero couch ≈70 k (`seating.ts:331`) |
| Hero fitting / appliance | 40–60 | 8–15 k | espresso machine, 45 parts (`counter.ts:360-524`) |
| Major furniture | 12–30 | 3–10 k | coffee table 12 parts (`tables.ts:162`), bistro chair 16 (`seating.ts:728`) |
| Architectural run per 3 m | 8–20 | 2–6 k | back bar bay (`counter.ts:243-262`) |
| Background prop | 3–6 | 300–900 | shop jar ≈540 tris (`counter.ts:898-942`) |
| Scatter / clutter | 1–3 | 100–400 | tin, carton (`counter.ts:945-1008`) |

**Scene scale:** one apartment set is **~750 objects** before merging
(`Monicas_apt/README.md:5-8`), collapsed to a few dozen draws by the material buckets. Do
not economise on part count; economise on draw calls.

**Surfaces are geometry too.** The parquet floor is *one slab per piece* with its own grain
and tone (`Monicas_apt/s_floor.py:1-8`); Joey's is *one slab per finger* because "it will not
survive being a texture" (`Joeys_apt/s_floor.py:1-15`). Mars Park equivalents: deck plating,
apron pours, tactile strips, tread nosings, planter coping — build the modules, don't paint
them. Already learned here once: `dev_docs/notes.md` S14 — "Rake rings as ±13% albedo
modulation … are invisible after grading+haze. Ground art needs GEOMETRY."

**Where a chamfer/reveal is *always* added:** floor-to-plinth (set back 20–30 mm),
plinth-to-carcass, every door/drawer front (6–12 mm gap all round), every applied panel
(proud 0.8–8 mm), every worktop nose, every hardware rose (0.8 mm clearance), every
wall/ceiling junction, every opening (lining + casing + reveal), every slat gap, every mating
flange, the foot of every leg, and the top and bottom of every extruded prism seen edge-on.

## 6. Material binding

- **Slots are material buckets, not part identities.** A builder collects `MeshData[]` per
  material and joins once: `[[steel, chrome], [blk, black], [wht, card], [brs, brass]]`
  (`perk/counter.ts:512-523`). Scene-wide, `World` buckets by material object and merges at
  `finalize()` (`core/world.ts:38-52, 212-250`).
- **Per-face slots exist** for walls: `faceMat` + `World.addMulti` splits one mesh into
  per-slot children (`mesh.ts:39-40`, `core/world.ts:67-92`).
- **UVs are optional and mostly absent.** Materials are procedural in object/world space:
  `positionLocal` (`mats.ts:236, 329, 480`), a wall projection building arc-length from
  position and the true normal (`mats.ts:177-184`), or a baked vertex attribute where a
  surface parameter is needed (`perforated` reads a `surfq` vec3 for its punched hole
  lattice, `mats.ts:575-628`, written at `monica/kitchen.ts:833`).
- **Generated coordinates** are emulated by feeding `userData.generatedBox` from the merged
  bounding box at finalize (`core/world.ts:228-234`, `mats.ts:852-978`).
- **Trim/edge materials differ from faces by being separate parts**, not UV masks: the
  chalkboard is a slate box inside four green frame boxes (`counter.ts:839-854`); glazing is
  its own bucket with `userData.noShadow` (`mats.ts:631-656`).
- `principled()` forces `side = DoubleSide` for Blender parity (`mats.ts:119-122`). **Do not
  copy that** — keep front-face culling and get the winding right.

## 7. Organization & naming

`scenes/<scene>/` — `layout.ts`|`L.ts` (authoritative dimensions, origin definition, helper
predicates like `ground(x,y)`, `kitchenOuter()`, `diagPt(u,off)`) · `geo.ts` (scene-specific
mesh helpers) · `materials.ts` (scene-prefixed cache keys) · `shell.ts` (floors, walls,
structure) · `openings.ts` (doors/windows placed into the shell) · `joinery.ts` (reusable
door/window/panel components) · `<room>.ts` (counter, seating, tables, kitchen, living,
beds) · `props.ts` (small-prop builders) · `dress.ts` (**placement only**: anchors, settling,
colliders) · `index.ts` (scene contract).

- **Every builder is local-frame + explicit anchor.** "Local frame: +X along the length, +Y
  toward the BACK, standing on z = 0" (`seating.ts:1-4`); "modelled on z = 0 at the origin,
  moved to their anchors by the caller" (`tables.ts:1-4`).
- **Builders return `Placed[] = {md, mat}[]`** so the placement pass moves a multi-material
  object as a unit (`seating.ts:13-16`).
- **A separate dressing pass owns placement** and *settles* pieces onto whatever they stand
  on by measuring group bounds (`perk/dress.ts:22-70`). Colliders get an inset because
  "chairs and turned-leg pieces are mostly air at knee height, and the raw box seals walkways
  the floor plan keeps open" (`dress.ts:62-65`).
- **`face(x,y,tx,ty,jitter)` / `seat(…)`** turn a piece toward a target with a named jitter
  in degrees, so scatter is legible in the layout file (`layout.ts:141-148`).
- **Measures stay re-checkable**: Perk's layout keeps `PPM = 70.0` (floor-plan pixels per
  metre) plus `X()`/`Y()` helpers so any dimension traces back to the source plan
  (`Central_Perk/L.py:7-13`). Mars Park's equivalent is `parkPlan.ts`.
- **Part names carry the audit contract** (§10.1): prefix by family (`Win_`, `Door_`,
  `Base_`, `Cornice_`, `EXT_`) so legitimate interpenetrations are whitelisted by prefix
  rather than by loosening a tolerance.
- Params named, defaulted, in metres; no unit suffixes; no magic numbers outside the layout
  module.

## 8. Mars Park today vs. what it needs

Current toolkit: `src/archkit/writer.ts` (379) + `src/archkit/kit.ts` (366).

**KEEP.** Slot-keyed accumulation + merged build (`writer.ts:13-27, 359-378`) — this *is*
friends' bucket idea. Degenerate-face rejection (`writer.ts:39-41, 58`) and the NaN-normal
discipline from `dev_docs/notes.md` (S12). `chamferSlot` routing (`writer.ts:88, 150-163`) —
a good idea friends lacks; keep it for worn-edge paint. And `kit.ts`'s engineering literacy
(code rise/run, rail heights, nose overhang, set-back risers, slat gaps, seat contracts): the
*dimensions* are already right, only the *geometry* is crude.

**EXTEND.**
- `box` → multi-segment **fillet** with welded corner points and smooth-by-angle emit, i.e.
  port `roundedBoxMesh` (`mesh.ts:529-605`). The current single 45° band with 8 hard-split
  corner triangles reads as a bevel, not a radius, and those tris are a shading break.
- `lathe` → add `capStart`/`capEnd`, **pole welding**, arc support, angle smoothing.
  `writer.ts:311-357` has no caps; a profile touching the axis makes a fan of coincident verts.
- `tube` → take a **profile**, not just a radius (`mlib.ts:274-318`), plus the mitre width
  correction (`geo.ts:196-200`).
- `slab` → replace with `prism`/`prismXZ`/`prismYZ` over arbitrary polygons + `polyOffset`
  level lofts for the edges.

**REPLACE / ADD — the port list, in priority order.** Add `src/archkit/mesh.ts` +
`src/archkit/mlib.ts` as a near-1:1 port of `friends/src/lib/{mesh,mlib,molding}.ts` and
`scenes/perk/geo.ts`, then rebuild `kit.ts` on top:

1. `MeshData` polygons + `join` + `toGeometry` with **smooth-by-angle** per-corner normals.
   *Without this nothing else matters* — it is why Mars Park objects read as LEGO.
2. `polyOffset` / `insetPoly` / `offsetPolyline`.
3. `loft` with `weldPoles`, `closeU/closeV`, cap logic, degenerate-quad dropping.
4. `prism` / `prismXZ` / `prismYZ` over arbitrary CCW polygons; `roundedRect`, `circle`,
   `arcPts`, `bez`.
5. `panelWithHoles` / `wallRun` — real apertures. Already needed: the tram car fakes window
   apertures with a lattice of boxes (`src/tram/vehicle.ts:55-109`).
6. `revolve` with caps + pole weld; `tubeAlong` with a profile; `sweepRectFrame`.
7. `cleanMesh`, `recalcNormals`, `solidify`.
8. `aperturedPrism` / `annularPrism` / `hollowPrism`.
9. `bevel` provenance for `box`/`prism`, backed by `roundedBoxMesh`/`beveledPrismMesh`.
   (Note: friends never re-exports `roundedBoxMesh` from `mlib.ts` even though the Python
   `rounded_box` had 30 call sites — export it here.)
10. A scene-level `World`-style material bucket registry so static park geometry merges
    across objects, not per assembly.

**The one adaptation to get right: Z-up authoring → Y-up world.** Every friends profile
convention is Z-up (`prism` extrudes along Z, `revolve` profiles are `(r, z)`, `tubeAlong`
up is `[0,0,1]`). Port them **unchanged** — otherwise every profile in this document must be
mentally rotated — and convert once at emit:

```ts
// src/archkit/mesh.ts
/** Author Z-up (friends convention); emit Y-up (Mars Park world).
 *  (x,y,z) -> (x,z,y) is a mirror, so every face winding is reversed to keep normals
 *  outward. Plan coordinates then map 1:1 onto world XZ, which is what parkPlan.ts
 *  already uses. Call once, immediately before toGeometry(). */
export function toYUp(m: MeshData): MeshData {
  for (const v of m.verts) { const y = v[1]; v[1] = v[2]; v[2] = y }
  for (let i = 0; i < m.faces.length; i++) {
    m.faces[i].reverse()
    if (m.uvs?.[i]) m.uvs[i]!.reverse()
  }
  m.provenance = null
  return m
}
```

The emit path is a straight port of `mesh.ts:761-823` against three 0.185.1
(`import { BufferGeometry, Float32BufferAttribute } from 'three'`). Its one load-bearing
line is the corner normal — copy exactly:

```ts
// A corner's normal averages ONLY the adjacent faces inside the smooth angle.
// This is what makes creases exact and free; computeVertexNormals() cannot do it.
const cosLimit = smooth ? Math.cos((m.shading.angle * Math.PI) / 180) : 2
const cornerNormal = (vi: number, fi: number): Vec3 => {
  if (!smooth) return faceN[fi]
  let x = 0, y = 0, z = 0
  for (const o of vertFaces[vi]) {
    if (dot(faceN[fi], faceN[o]) >= cosLimit - 1e-9) { x += faceN[o][0]; y += faceN[o][1]; z += faceN[o][2] }
  }
  const l = Math.hypot(x, y, z)
  return l < 1e-9 ? faceN[fi] : [x / l, y / l, z / l]
}
// Emit non-indexed: position + normal only. No uv, no tangent — materials are
// world/object-space procedural. ~2x vertices vs an indexed weld; the correct trade for
// static merged geometry, and it removes all split-normal bookkeeping.
```

Material binding stays `Record<slot, Material>`, but the bucket moves to scene scope, and
`applySpecularAA` (`src/materials/library.ts:27-34`) becomes *more* important once objects
carry real fillets and fine slats.

## 9. Worked mini-example: the park bench, the *friends* way

Today: 8 chamfered boxes (`src/archkit/kit.ts:169-210`). The rebuild — author Z-up, local
origin on the ground under the bench centre, +X along the length, +Y toward the back.

**Decomposition — 26 parts, ≈5 k tris:** 2 end frames (side-elevation silhouette lofted
across with inset end stations) · 4 foot pads (inset → reveal at the ground) · 2 seat rails
(`tubeAlong`, rounded-rect profile) · 5 seat slats + 3 back slats (crowned, relieved,
arrised section; real 8 mm gaps) · 10 fastener domes (`revolve`).

```ts
import * as m from '../archkit/mlib'
import type { MeshData, Vec2, Vec3 } from '../archkit/mesh'

const L = 1.8, W = 0.52, SEAT = 0.45, FRAME_T = 0.075

/** Cast-ISRU end frame, drawn as a real side elevation (y = across, z = up). */
function endFrame(sx: number): MeshData {
  const yb = W / 2, yf = -W / 2
  const sil: Vec2[] = [
    [yf + 0.035, 0],            [yf + 0.115, 0],              // front foot
    [yf + 0.145, 0.055],        [yf + 0.100, 0.22],           // taper to the knee
    [yf + 0.085, SEAT - 0.055], [yb - 0.055, SEAT - 0.055],   // seat rail line
    [yb - 0.020, SEAT + 0.02],  [yb + 0.020, 0.98],           // back stay, leaning 8 deg
    [yb - 0.055, 0.98],         [yb - 0.075, SEAT + 0.02],
    [yb - 0.085, SEAT - 0.115], [yb - 0.055, 0.24],
    [yb - 0.030, 0.055],        [yb - 0.005, 0],              // rear foot
  ]
  // Inset end stations: the outer 6 mm of the casting rolls in, so the frame reads as a
  // moulded part, not a slab.  (perk/seating.ts:216-231)
  const steps: [number, number][] = [[0, -0.006], [0.10, -0.0015], [0.90, -0.0015], [1, -0.006]]
  const x0 = sx * (L / 2 - 0.14 - FRAME_T / 2), x1 = x0 + sx * FRAME_T
  const rings = steps.map(([t, ins]) => {
    const poly = ins ? m.polyOffset(sil, ins) : sil
    const x = x0 + (x1 - x0) * t
    return poly.map(([y, z]) => [x, y, z] as Vec3)
  })
  const md = m.loft(rings, { closeV: true, capStart: true, capEnd: true })
  m.smoothShade(md, 34)   // 34 deg: the knee reads round, the flats stay flat
  return md
}

/** Extruded aluminium slat: crowned top, relieved underside, arrised edges. */
function slat(z: number, y: number, tilt = 0): MeshData {
  const sec: Vec2[] = [
    [-0.048, 0], [-0.044, 0.0035], [-0.030, 0.0065], [0, 0.0075],
    [0.030, 0.0065], [0.044, 0.0035], [0.048, 0],
    [0.042, -0.010], [0.030, -0.013], [-0.030, -0.013], [-0.042, -0.010],
  ]
  const md = m.prismYZ(sec.map(([a, b]) => [y + a, z + b] as Vec2), -L / 2 + 0.02, L / 2 - 0.02)
  if (tilt) m.rotX(md, tilt, [0, y, z])
  m.smoothShade(md, 30)
  return md
}

export function bench(): { cast: MeshData; metal: MeshData; seat: Vec3 } {
  const cast: MeshData[] = [], metal: MeshData[] = []
  for (const sx of [-1, 1]) {
    cast.push(endFrame(sx))
    for (const sy of [-1, 1]) {                        // foot pads, inset 8 mm -> reveal
      const pad = m.prism(m.roundedRect(0.115, 0.075, 0.012, 3), 0, 0.014)
      m.translate(pad, [sx * (L / 2 - 0.14), sy * (W / 2 - 0.10), 0])
      m.bevel(pad, 0.005, 2)
      cast.push(pad)
    }
  }
  // Seat rails carry the slats; the slats float 12 mm above them -> shadow gap.
  for (const sy of [-1, 1]) metal.push(m.smoothShade(m.tubeAlong(
    [[-(L / 2 - 0.14), sy * (W / 2 - 0.14), SEAT - 0.028], [L / 2 - 0.14, sy * (W / 2 - 0.14), SEAT - 0.028]],
    m.roundedRect(0.042, 0.030, 0.006, 2)), 34))
  for (let i = 0; i < 5; i++) metal.push(slat(SEAT + 0.012, -W / 2 + 0.115 + i * 0.104))  // 8 mm gaps
  for (let i = 0; i < 3; i++) metal.push(slat(0.66 + i * 0.135, W / 2 - 0.045, (8 * Math.PI) / 180))
  // Fastener domes where every slat crosses a frame — the detail that says "made".
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
    const b = m.revolve([[0, 0], [0.0075, 0.0015], [0.0065, 0.0045], [0, 0.005]], 10)
    m.translate(b, [sx * (L / 2 - 0.14), -W / 2 + 0.115 + i * 0.104, SEAT + 0.0195])
    m.smoothShade(b, 50)
    metal.push(b)
  }
  const cj = m.join(cast), mj = m.join(metal)
  m.cleanMesh(cj); m.cleanMesh(mj)
  return { cast: cj, metal: mj, seat: [0, 0, SEAT + 0.0195] }
}
```

Versus the box version: a curved cast silhouette instead of a slab; inset end stations so the
frame is moulded; crowned and relieved slats with a real underside; 8 mm authored gaps at
104 mm pitch; a 12 mm shadow gap between slats and rail; inset foot pads giving a reveal at
the ground; ten fastener domes; two material groups; a smooth angle chosen per part.

**Same method, a tram bogie (sketch).** Frame: two side frames as `prismYZ` of a fabricated
I-section silhouette (cope reliefs and lightening holes via `panelWithHoles`, not booleans) +
two transverse box beams + four gusset plates, all butted with 2 mm reveals. Wheels:
`revolve` of a 9-point tyre profile (flange radius, tread taper 1:20, back-face relief, hub
fillet), 32 segments, smooth 40°. Axleboxes: `revolve` + `prism` housing + four lathed bolt
heads. Primary suspension: `tubeAlong` on a helical path with ground end coils. Dampers: two
lathes + rod + two `torus` eye-ends. Brake discs: `revolve` with a vented-hat profile;
callipers: `prismYZ` silhouettes. Traction rod, sandbox, pickup shoe, cable runs:
`tubeAlong` with mitre correction. ≈55 parts, ≈25 k tris — visible from the platform and from
under the car, so hero tier.

## 10. The gate

### 10.1 The mechanical audit — build this

friends did **not** rely on eye or checklist. It shipped `Central_Perk/audit.py` (also in
`Joeys_apt/`), and `Central_Perk/build_all.py:41-43` states the gate: *"the build is not
finished until this says zero: coplanar same-facing pairs are z-fighting."* The docstring
says why (`audit.py:3-6`):

> Coplanar faces from two different objects are the one defect that always survives a
> screenshot check: they look fine from most angles, then flicker from one. So the build
> asserts they do not exist rather than trusting the eye.

**Checks and tolerances** (`audit.py:27-56`) — adopt verbatim:

| Check | What it finds | Tolerance |
|---|---|---|
| `zfight` | coplanar, **same-facing**, genuinely overlapping triangles | normal dot `ANG = 0.0025` (~0.13°), plane distance `DIST = 0.0015` (1.5 mm), shared area `OVERLAP_A = 2e-4` (2 cm²) |
| `backtoback` | coplanar but **opposed** (an underside on a floor, a lining's back in its reveal) — informational; safe when both belong to closed solids | same |
| `degenerate` | zero-area faces, loose vertices, duplicate vertices | — |
| `manifold` | edges with other than two faces | — |
| `nomat` | meshes with no material | — |
| `clash` | two **solids** interpenetrating (a stool leg through a counter) — real triangle-triangle intersection through a BVH, because every stool's bbox overlaps the counter's | `CLASH_DEPTH = 0.030` |
| `lights` | every non-sun light needs a fixture mesh nearby | `FIXTURE_R = 0.30` |

Two implementation lessons are recorded and must not be re-learned (`audit.py:11-24`):
bucket triangles into **all sixteen** neighbouring cells of the 4-D plane grid (a quantised
plane key without neighbour expansion silently misses pairs whose normals straddle a cell
boundary), and measure **true clipped triangle overlap area**, not bbox overlap (which
reported L-shaped floor slabs that merely touch along an edge).

`DIST = 1.5 mm` is "tighter than any deliberate offset in the build" — the origin of §3's
0.8 mm floor. Legitimate interpenetrations are whitelisted **by name prefix**
(`Joeys_apt/audit.py:17-28`: `Win_`, `FD_`, `Door_`, `Floor_Parquet`, `Base_`, `Bath_Tiling`,
`W_North`, `Cornice`, `Ceiling`, `EXT_`; Perk adds `NOWELD = ("Menu_", "Neon_",
"Service_t")`, `Central_Perk/mlib.py:841-844`). That whitelist *is* the naming convention.

**Action:** port this as `tools/geometry-audit.mjs` over the built `MeshData` set (before
`toGeometry`, while faces are still polygons and part names known). Run `cleanMesh` on every
part first, then audit.

### 10.2 QUALITY CHECKLIST — self-audit every rebuilt object

Answer every line in the PR/commit note. Any "no" is a blocker.

**Silhouette & form**
- [ ] No part is a bare rectangular box in silhouette. Curved forms come from profiles, not
      scaled cubes.
- [ ] Every visible straight edge carries a fillet or chamfer, radius from §2.5 (never 0,
      never one global value for the whole object).
- [ ] Curved parts have enough segments: ≤25 mm radius → 10–14; ≤100 mm → 16–24; ≥150 mm or
      player-adjacent → 28–48. No visible facets at 1 m.
- [ ] Extrusions seen end-on have **inset end stations** (`[0,-r] … [1,-r]`) so the end is
      rolled, not raw.

**Joins**
- [ ] No two faces from different parts are coplanar. Applied parts stand ≥0.8 mm proud or
      sit in a ≥1.5 mm reveal. Signage, glazing, labels, plates verified individually.
- [ ] No unintended overlap: shared volume is either welded + `cleanMesh`'d, or the run is
      split so nothing intersects.
- [ ] No unintended gap >0.5 mm. Intended gaps (slats, doors, drawers, vents) are ≥4 mm.
- [ ] Every mating part references the same layout constant. No re-derived dimensions.

**Mesh hygiene**
- [ ] **The §10.1 audit reports zero `zfight`, `degenerate`, `clash`, `nomat`** for this
      object and its junctions with everything it touches. Any `clash` is fixed or added to
      the named whitelist with a reason.
- [ ] `cleanMesh` run before emit; zero zero-area faces; zero NaN normals.
- [ ] `recalcNormals` after every mirror, negative-determinant `transform4`, and hand-
      authored polygon set. Closed shells verified outward.
- [ ] Lathes touching the axis use pole welding; no fans of coincident vertices.
- [ ] No smooth-shaded n-gon cap across a curved surface (the crest-roll trap,
      `perk/seating.ts:77-85`). Caps are flat, or the surface wraps instead.
- [ ] A deliberate smooth angle per part, from §2.6's distribution. State it.

**Scale & ergonomics**
- [ ] Every dimension traceable to a layout module or a cited standard. Human contact
      surfaces: seat 430–460 mm, rail top 1020–1100 mm, tread rise 165 / run 290, counter
      900, door 2100 × 860, handrail Ø 32–45 mm.
- [ ] 0.38 g but human-built: Earth ergonomic standards, not scaled ones.
- [ ] Placed on its real datum (deck top, apron pour, tile top), not on y = 0.

**Budgets & bindings**
- [ ] Part count and triangle count inside §5's tier band. State both.
- [ ] Parts routed to slots by **material identity**; chamfer bands routed to a wear slot
      only where the material story justifies it.
- [ ] No UV attribute unless a texture/decal needs one; materials read object/world position.
- [ ] Contributes to a scene-level merged bucket, not a per-object mesh.

**Collision & contracts**
- [ ] Analytic colliders authored alongside geometry, with an inset for airy pieces.
- [ ] Any interaction contract (seat surface + yaw, door swing, boarding point) returned from
      the builder, not guessed by the caller.

## Appendix — source map

All paths under `friends/src/` unless noted. `lib/mesh.ts` (823) mesh core, modifiers,
triangulation, normals · `lib/mlib.ts` (627) primitives · `lib/molding.ts` (75) mitred
moulding sweeps · `scenes/perk/geo.ts` (250) wallRun, densify, mitred tube · `core/world.ts`
(251) material buckets, colliders, lights · `mats/tsl.ts` (363) TSL node ports ·
`mats/mats.ts` (1005) material library · `scenes/perk/counter.ts` (1133) counter, machines,
retail stock · `scenes/perk/seating.ts` (1009) upholstery, tufting, scroll arms, fringe ·
`scenes/perk/tables.ts` (270) turned/lathed furniture · `scenes/monica/kitchen.ts` (1324)
casework runs, appliances, mitres · `scenes/joey/joinery.ts` (243) panel doors, sashes,
casings, blinds · `scenes/joey/props.ts` (412) prop builders · `scenes/perk/dress.ts` (358)
placement, settling, group colliders · `friends/dev_docs/{geometry-and-world,materials,scenes}.md`
stated conventions.

**Blender ground truth** (`friends/build_scripts/{Monicas_apt,Joeys_apt,Central_Perk}/`, ~29
files; there was never a converter — the TS is a hand port, module for module, per
`friends/dev_docs/scenes.md:35-94`): `*/mlib.py:1-16` the craft statement and world-space
rationale · `Central_Perk/audit.py` the mechanical gate · `Central_Perk/mlib.py:686-694`
wall-line datum · `Central_Perk/mlib.py:822-830` why `clean_all()` runs everywhere ·
`*/L.py:1-13` origin/axis declarations and `PPM` traceability · `*/s_floor.py:1-15` "one slab
per finger… it will not survive being a texture" · `Monicas_apt/README.md:76-108` the lighting
rule (every light justified by a visible emitter; `fill()` is empty on purpose).

Two Python capabilities the TS deliberately dropped, worth knowing before reaching for them:
**`boolean()` (EXACT CSG)** — 6 call sites, all replaced by `hollowPrism`/`annularPrism`/
`aperturedPrism`; and **`bake_surface_attr`/`uv_planar`** — replaced by one hand-authored
vertex-colour attribute (`monica/kitchen.ts:833` writes `surfq`, `mats/mats.ts:589` reads it).
