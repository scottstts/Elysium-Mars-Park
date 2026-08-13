# THE OPTIMUS EXHIBIT (2026-08-12)

Eight Tesla Optimus Gen-2 humanoids standing in formation on a round cast
platform, on the open regolith between the Amphitheater bowl and the arrival
station. `src/procgen/blenderkit/` (generic), `src/robots/optimus/` (the
figure), `src/world/districts/optimusPlaza.ts` (the platform),
`src/robots/optimusExhibit.ts` (the system).

Only design decisions the code cannot state for itself are recorded here.

---

## 1. The figure is a VERBATIM port, and it is provable

The owner's requirement was that geometry and materials be 100 % identical to
`ref_images/optimus.html` — itself a port of a Blender/bpy build. So the port
was done **mechanically**: the reference's script body was sliced by line
range into modules and the only edits applied were an explicit patch table of
type annotations. No line was retyped.

The proof is a checksum harness: run the reference `.html`'s script body under
node and the ported `src/` modules under the same driver, and compare every
object name, vertex count, face count, material-slot list, a weighted sum over
all 446,593 vertex positions, and a weighted sum over every split normal.

```
ref : {objs:176, tris:891809, verts:446593, sum:3081445.151176762, nsum:133369.41747025977}
port: {objs:176, tris:891809, verts:446593, sum:3081445.151176762, nsum:133369.41747025977}
```

**Anyone touching `blenderkit/` or `optimus/parts/` should re-run that
comparison.** Bit-identical is the contract, and a plausible-looking refactor
of `applyBevel` or `weldVerts` will change the mesh without changing anything
that looks wrong.

Three deliberate deviations from the reference, none of them geometric:

- `M_GLOSSBLACK` and `M_STEEL` are built but unused by any face (the reference
  says so of the first). Twelve of the fourteen materials reach the GPU.
- The reference's studio rig (equirect soft boxes, four directional lights, a
  sweep floor, AgX at 1.15) is **not** ported. The figure is lit by the park.
- **`M_LED` breathes** (owner request). See §9.

## 2. What "reusable helpers" meant in practice

The split is between *generic Blender-op ports* and *this model's parts*:

| `procgen/blenderkit/` | what it is |
|---|---|
| `mathkit` | `V3`, `TAU`, `R`, `pmod`, `smoothstep`, `lateInit` |
| `curves` | pchip/natural-spline slopes, `Curve1D`, `polyfit`/`polyval` |
| `transform` | Blender `mat4`/`quat` incl. `to_track_quat('Z','Y')` |
| `meshdata` | n-gon mesh, `remove_doubles`, `recalc_face_normals`, angle-weighted split normals |
| `csg` | EXACT-solver boolean difference (BSP) |
| `bevel` | the BEVEL modifier with `harden_normals`, plus `finish`/`apply_mods` |
| `profiles` | super-ellipse sections, pillow parameterisation, outline resampling |
| `loftkit` | the mesh-CREATING generators, bound to a collection set |
| `collections` | named collections, generic over the name set |
| `blenderNoise` | Blender's lookup3 Perlin + fBm in TSL |
| `toGeometry` | mesh → transferable typed arrays |
| `decimate` | vertex-cluster LOD |

The one design problem was that `optlib`'s generators write into module-global
Blender collections (`COLL.TORSO`, …), which is exactly what a second ported
model must not inherit. Threading a collection argument through every call
would have changed hundreds of ported call sites — and every changed line is a
line the checksum can no longer defend.

**So the binding is a factory, not a parameter.** `createCollectionApi(names)`
and `createLoftKit(api)` return closures; `robots/optimus/optimusKit.ts` binds
them once to `['TORSO','HEAD','ARM','HAND','HIP','LEG','FOOT']` and re-exports
`loft`, `pillow`, `meshObj`, … Ported call sites read exactly as the Python
does. A future port writes its own six-line `xKit.ts` and touches nothing
here.

`lateInit<T>()` exists for the same reason: Blender declares fitted curves at
module scope and fills them from a `*Curves()` entry point, so `let C_AX =
null` has nothing to infer from. Typing them nullable would have put a `!` on
every one of ~200 call sites.

## 3. Why the build runs on a worker

The figure costs **~1.1 s in the part generators and ~1.9 s in the bevel /
boolean / split-normal pass** — 3.4 s including the merge and the two LODs.
That is pure single-threaded CPU with no DOM and no GPU, so it runs in
`optimusWorker.ts` and overlaps every other system's init instead of freezing
the entry screen's progress bar for three seconds.

Nothing in the worker's import graph touches three.js. The shipped chunk is
**70 kB** against the main bundle's 3.9 MB; if a future edit imports
`optimusMaterials.ts` (or anything under `three/`) into `optimusBuild.ts`, the
whole renderer lands in the worker chunk. Keep the two apart.

There is an inline fallback if `new Worker(...)` throws. It is a 3 s block
behind the entry screen — worse, but an exhibit that silently fails to appear
is worse still.

## 4. Merge, axes, and the instancing shape

The reference emits **176 separate meshes**. Merging by material collapses
that to **12 draw ranges in one geometry**, so a figure is 12 draws regardless
of how many objects the Blender build used. Merging splits a vertex shared by
two slots, which is why the merged count is 533,003 against the source's
446,593 — the triangle count is unchanged.

Blender's Z-up frame is baked out **once**, during the merge, into the
positions and normals: `(x, y, z) -> (x, z, -y)`. Consequences worth knowing:

- the model's origin is the floor between the ankles, so an instance placed at
  the deck datum sits on it exactly — no per-figure Y fudge exists or is
  wanted;
- the rest facing (Blender −Y) becomes **world +Z**, so `yaw = π/2` faces +X;
- measured bounds are `y 0.000 … 1.732`, `x ±0.28`, `z ±0.19` — the stated
  1730 mm, which is also the check that the axis swap is right way round.

All eight figures are one `InstancedMesh` per LOD (geometry + material array,
8 instances). LOD0 is 22.4 MB of GPU buffers, shared by all eight.

## 5. LOD is per GROUP, and the shadow does not switch at all

The owner asked for full fidelity up close and LOD beyond. Two constraints
decided the shape of it:

1. An `InstancedMesh` draws one range. Giving two instances different detail
   means two meshes with two counts.
2. A cached shadow clipmap records its casters into an **immutable render
   bundle** (`render/staticShadowScene.ts`). Anything whose draw changes after
   the seal — an instance count that moves, a mesh that turns invisible — is
   either frozen at whatever it looked like at seal time or drops out of the
   shadow entirely.

So: **one LOD switch for all eight**, on camera distance to the formation's
centroid (30 m / 70 m, 4 m hysteresis, finer levels have to earn the switch).
The formation is 7.2 × 3.0 m, which at 30 m subtends about 4° — every figure
is effectively the same distance away, so per-figure LOD buys nothing while
costing per-frame instance-buffer churn.

And the shadow is cast by a **fourth, never-switched instance set** at LOD1,
on a new `STATIC_SHADOW_PROXY_LAYER` (4) that the main camera never enables
and the static clipmap cameras do. It is the general answer to "this object
LOD-switches but its shadow must not": the cached maps get one fixed
silhouette, and the main view swaps detail underneath it. Handing the cached
maps the exact mesh instead would put 7.1 M triangles into a refresh that is
supposed to be cheap.

| LOD | cluster | tris | ×8 | used |
|---|---|---|---|---|
| 0 | — (exact) | 891,809 | 7.13 M | < 30 m |
| 1 | 6 mm | 193,804 | 1.55 M | 30–70 m, **and every shadow** |
| 2 | 22 mm | 19,979 | 0.16 M | > 70 m |

All three visible LODs are explicitly compiled during boot against the live
MRT/MSAA scene pass. This is required even though they share one material
array: each decimated geometry produces a distinct TSL vertex program. The
arrival camera crosses into LOD1 visibility exactly at the tunnel mouth; if
warmup compiles only the currently active far LOD, Three r185 synchronously
generates twelve missing vertex programs in that frame. `compileAllLods()`
temporarily exposes one LOD at a time behind the entry plate and restores the
runtime selection afterward. It also bypasses frustum culling for the selected
compile-only mesh because the broad warmup camera does not contain the court;
both visibility and culling state are restored before BOARD. This does not
change the LOD thresholds or image.

Three r185's `PassNode.compileAsync()` still omits these grouped
`InstancedMesh` variants from its persistent render cache. Each forced LOD
therefore also receives one real `pipeline.render()` while the entry plate is
up. That is the exact live path, so it cannot defer node-program generation;
the final warmup GPU fence covers these submissions.

Decimation is vertex clustering, not edge collapse: it is O(n), it needs no
manifold topology (a CSG'd, beveled, distance-welded mesh is emphatically not
manifold), and its one weakness — softened hard edges — is indistinguishable
from the correct filtered result at the pixel sizes it runs for. Clusters are
keyed by **material as well as position** so two touching slots can never
merge into one blended vertex.

## 6. The plinth: two lathes and four prisms

`PLINTH` is 6.0 m radius, 0.6 m tall, four flights of three treads on the
cardinal bearings. The whole thing is 5,000 triangles and passes
`archkit/audit.ts` at **0 z-fighting pairs / 0 back-to-back / 0 defects /
0 clash**.

The deck the figures stand on is a **75 mm slab of polished dark marble**
(`darkStone`) over a cast drum (`cast`) — a real layer with a readable edge
band, not a finish painted onto the top face. It oversails the drum by 22 mm
so the material joint throws a shadow line instead of being a colour change on
a flush face; that oversail lands 75 mm above the top tread, which is a stair
nosing's overhang and behaves like one. The drum keeps its own base reveal, so
the object is articulated at head and foot.

Four decisions carry the audit result:

1. **The slab and the drum are two revolved profiles, each CLOSED on the
   axis, overlapping rather than sharing a rim.** `writer.lathe` takes one
   slot, so a material change means a second lathe. The obvious move — split
   one profile at the material boundary so the two shells share a rim —
   **ships an invisible floor**: that leaves two OPEN profiles, and an open
   profile takes its orientation from the profile's direction. The natural
   `axis → outward` direction comes out inside-out, so the deck was
   backface-culled and you looked straight through the plinth. `revolve`
   corrects a CLOSED shell whichever way it is authored, so both halves close
   on the axis and the drum's top disc is buried 20 mm inside the slab, where
   the slab's own shell hides it.

   The geometry gate does not catch this — it checks coplanarity, not
   orientation. The standing check is signed volume: the slab reads
   **+8.47 m³** against an analytic π·6²·0.075 = 8.48, the drum +110.17 m³,
   and 1,664 of 1,664 deck faces point up.
2. **Everything else is ONE profile each** — deck field, edge chamfer, edge
   band, soffit on the slab; fascia, base reveal, toe and buried skirt on the
   drum. A stack of cylinders would put a horizontal joint at every datum
   change.
3. **Each flight is ONE extruded prism**, not a stack of tread boxes. Stacked
   boxes share their side faces exactly: four coplanar walls per flight, which
   is the classic flicker. Sweeping the staircase profile across the flight
   width gives a watertight solid whose only planar surfaces are the treads.
4. **The flights stop one riser BELOW the deck** — the last 0.15 m rise is the
   plinth's own fascia. This is what keeps (1) and (2) from meeting: a flight
   carrying its top tread to deck level would put a tread face in the deck
   disc's plane over the whole overlap. Each prism's inner end is instead
   buried 0.4 m inside the drum, where the lathe's closed shell hides it, and
   its ground line sits 60 mm **below** the court paving for the same reason.

The concentric rings across the deck field are not decoration: a 6 m triangle
fan from the centre bands badly under per-vertex terms in the image pipeline.

## 7. Siting

`OPTIMUS_COURT` (−28, 70), court radius 9.4 m — the Fountain/Freedom-Tower
pattern: a monument fronts onto paving, never onto raw regolith, and is
reached by a real walk. The natural grade there runs −0.15 … +0.26 across the
site; a round plinth with four cardinal flights cannot absorb a 0.4 m swale
(every flight's bottom riser would meet the ground at a different height), so
the pad flattens it at y = 0.05 with a 7 m skirt.

`optimus-spur` branches off the Meridian Walk at **priority 39, not 40** — two
ribbons at one priority never trim each other (the `tower-walk` lesson). Its
3 m runout is taken along its own bearing, so its start point sits 1.5 m WEST
of the Meridian centreline: any further east and the extended tip lands
outside the walk's half-width and hangs an untrimmed 3.2 m cap of paving off
its flank. Measured against HEAD, the court + spur add **zero core holes and
zero stacked slabs**; the branch junction leaves 16 cm² of seam sliver against
the shipped `tower-walk` junction's 54 cm².

Formation: two ranks of four facing +X — head-on to the east flight, where the
spur lands. 2.4 m along the rank, 3.0 m between ranks, so ~1.8 m of clear
floor between neighbouring shoulders (which are 0.56 m wide). The outermost
figure stands at r = 3.90 m, leaving 2.10 m of perimeter walk.

The eight are **solid**: a 0.30 m cylinder each. A guest who can walk through a
1.7 m machine at arm's length stops believing it is there.

## 8. The marque (`districts/optimusSign.ts`)

A backlit Tesla sign at the plinth's west edge, behind the formation, facing
back down its bearing.

**It is a portal, not a blade, and that was forced.** The figures face +X, so
"behind them" is the −X edge — which is exactly where the west flight lands. A
solid sign there bricks a stair, and this park has a standing rule against
structures that lead nowhere. Lifting the panel onto two posts keeps the
flight and reads better anyway: from the east approach the sign floats above
and behind the heads instead of standing among them. Measured: clear opening
**2.93 m wide × 2.25 m high** over the deck (2.40 m over the top tread)
against the flight's 2.40 m width, and every member stays ≥ 0.24 m inside the
slab edge.

**The frame's one rule: wherever two members meet, one contains the other's
boundary completely.** Posts are slimmer than the beams in both plan axes and
die 40 mm *inside* the head beam; the carcass runs 30 mm into each post; each
post runs down into its base plate. Nothing butts. The first pass had the
posts finishing flush with the head beam's top face and the geometry gate
caught it immediately — **469 cm² of coplanar overlap over 6 pairs**. After
the rule: **0 z-fight pairs**. The `clash` crossings that remain are those
deliberate containments; three members cannot meet without either
interpenetrating or butting, and butting is what makes coplanar pairs.

**The panel is a lightbox, not a printed plate.** `src/assets/tesla_logo.png`
is a neon mark on a black ground, so one `texture()` node drives both
`colorNode` and `emissiveNode`. Emissive sits on the park's sign rung (3.4),
so the artificial layer keeps one ladder, and the faces do not cast (an
emitter throwing a shadow of its own glow is a contradiction the cached maps
cannot express).

**The artwork's painted halo has to be held under the bloom threshold, and
that took two passes to get right.** The source already contains a glow, so
emitting it flat double-counts it. Measured over the band the panel shows
(bloom is threshold 1.0 / strength 0.3), against a **true neon-stroke area of
1.53 %**:

| emission curve | bloom area | bloom energy | peak | at mip4 |
|---|---|---|---|---|
| flat `lum · 3.4` | 26.2 % | — | 3.40 | — |
| `lum^2.2 · 3.4` | 6.0 % | 0.0464 | 3.40 | peak 1.91 |
| `lum^6 · 2.0` | 1.42 % | 0.0099 | 2.00 | **peak 0.68 — sign goes dark** |
| **shipped:** core + base | **2.63 %** | **0.0187** | **2.20** | peak 1.44 ✓ |

A single power curve cannot do both jobs. Crushed hard enough to keep the
letter counters open up close, it collapses under mip averaging and the sign
switches OFF at distance. So the curve is two terms:

- **CORE** — `smoothstep(0.62, 0.95, luminance) · 1.7`, which only opens on
  the true strokes. This is the only term allowed over the threshold, so it is
  the only thing that blooms.
- **BASE** — `luminance · 0.5`, capped below the threshold by construction
  (0.5 can never reach 1.0). It carries the painted halo as plain lit panel
  and is what keeps the sign reading once mip averaging has thinned the
  strokes.

Bloom energy is 2.5× lower up close and 6.9× lower at mip4 than the first
version, with the panel still glowing at every range. The diffuse is the
panel, not the sign: `art · 0.22`, a dark acrylic face that happens to be
lighter where the tubes are printed.

The lit quads stand 4 mm proud of the carcass — not coplanar with it — inside
a 20 mm dark reveal. UVs show a horizontal BAND of the source at its true
pixel aspect (`v` 0.247…0.777 for the 2.83:1 face) rather than stretching a
3:2 image onto it, and the band's handedness is mirrored per side: get that
backwards and the mark reads reversed. Double-sided, because anyone arriving
up the flight beneath it would otherwise meet its back.

The texture is `await`ed in `OptimusExhibitSystem.init` alongside the figure
build, so no frame can rasterise an undecoded map.

## 9. The visor breathes

Owner request, and the one material change from the reference. `M_LED`'s
`emissiveNode` is a triangle over `LED_PERIOD = 2.0 s` — one second dark to
lit, one second back — eased with a smoothstep so the turn is soft rather
than a corner. The colour and the 11.0 peak are the demo's, so the fully-lit
frame is exactly the reference's look.

Two things worth knowing:

- It is driven by a **uniform fed from `ctx.time.sim`**, not TSL's own `time`.
  The park pauses; a pause menu over a scene that is still breathing reads as
  a bug.
- The clock is fed `sim % LED_PERIOD`, not raw seconds. A float32 uniform
  loses sub-frame resolution on a clock that has been running for hours, and
  the pulse would visibly quantise.

All eight share one material, so they breathe in unison. Staggering them would
mean per-figure material instances and would cost the single-draw property
that §4 is built on.

## 10. Open items

- **`M_LED`'s peak sits above the park's emissive ladder.** The reference's
  visor LED is `emissive lin(0.03,0.72,1.0) × 11.0`; the park's ladder tops
  out at `utilityLight 5.0` against a bloom threshold of 1.0 (notes.md). Kept
  at 11.0 because the owner asked for the demo's look, and the emitting area
  is a 1.45 × 1.05 mm section — the ladder's own rule is "scale the AREA, not
  the multiplier". The pulse (§9) means it only reaches that peak once every
  two seconds. If it still blooms too hard, the fix is one number.
- **`tesla_logo.png` ships at 946 kB** (1536 × 1024 RGBA) for a 2.89 m panel.
  The image is a black field with a soft glow, which PNG compresses badly;
  re-encoding, or halving the resolution, would cost nothing visible. Left as
  supplied.
- **No `applySpecularAA`.** The park applies it to every lit material; the
  reference does not, and these are the reference's materials. Worth a look on
  the machined `M_ALU` / `M_STEEL` slots at distance.
- **Step-free access.** The plinth is stairs-only on all four bearings, as
  asked. The park is otherwise careful about step-free routes.
- **`tools/paving-coverage.mjs` crashes** on the current region set — its
  `regionBox`/label paths predate `kind: 'zone'` (the turnout throat) and hit
  `r.line is not iterable`. Pre-existing, not from this work; a two-line fix
  (`if (r.kind === 'zone') return [r.minX, r.minZ, r.maxX, r.maxZ]` plus a
  label branch) makes the paving proof runnable again.
