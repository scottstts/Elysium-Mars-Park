# Dome One & interior groundworks (S4 + S5)

> **Superseded in part by the 2026-08-10 overhaul — see "Gridshell overhaul"
> at the end of this file.** The lattice-shadow saga below is still canon.

## Dome (`src/dome/`)

- Cap geometry: ⌀500 m, crown 120 m → sphere R 320.417 centered y −200.417,
  θ_base 0.8952. These constants live ONLY in `latticeField.ts`.
  (OVERHAUL: now ⌀260 m, crown 64 m, R 164.031, y −100.031, θ_base 0.9147.)
- Structural members built as instanced boxes (primaries/rings/gussets/
  footing); the fine 2.5 m net is SHADER-ONLY — in the glass (pixel-soft
  lines) and in the shadow (penumbra-soft lines). Members cast no shadow
  maps; the analytic net owns all dome shadowing (never double-darken).
- Glass shell: alpha-blend Fresnel + ISRU green tint + dust film (rim-heavy,
  Panewalker swath uniform `panewalkerPhi`) + portal arch cut (`portalCut`
  shared for S9's frame/iris). No physical transmission on the big shell —
  hero panes elsewhere may use it. `mrt normal.a = 0` (no AO on glass).
- Interior shafts: march that accumulates the DIFFERENCE the lattice makes
  (negative carve + tiny glow), NOT absolute inscatter — the aerial medium
  owns base haze. Net-zero in open sun, so the "wash the whole frame"
  defect class is structurally impossible. Forward-scatter phase on both.

## The lattice-shadow saga (read before touching ANY shadow code)

1. **Per-material `receivedShadowNode` is a trap in three r185**:
   `AnalyticLightNode.setupShadow` caches `shadowColorNode` on the LIGHT for
   the FIRST-built receiver — every other material silently reuses that
   wrap (or its absence). Diagnosed via sine-stripe hook: worked on the
   gallery floor, dead on the groundworks floor, toggled by build order.
2. Therefore the net multiplies into the sun's shadow INSIDE
   `CachedShadowClipmapNode.setup` (adopted from SeaPark, verbatim except
   that multiply) — one place, all receivers, no ordering hazard.
3. **Line coverage must be energy-conserving**: the original reversed-edge
   smoothstep "line" overestimated wildly at large penumbra and produced
   uniform mush. Correct form is the 1-D box-overlap integral
   `clamp((min(d+soft,hw) − max(d−soft,−hw)) / 2soft, 0, 1)`.
4. **The physics verdict**: with the real 0.35° sun, fine-net shadows wash
   out beyond ~30 m from the lattice. The net is CRISP near the rim, reads
   as ~19%-deep soft bands from primary ribs mid-floor, and the crown
   converge casts one substantial blob NE. This is correct and accepted —
   do not "fix" it by shrinking the penumbra (`penumbraScale` is a debug
   dial, ship value 1).

## Groundworks — the paved civic floor (OVERHAUL W1)

Superseded the S5 build entirely. Five modules, one datum stack:

| file | owns |
|---|---|
| `world/pavingPlan.ts` | what is paved, the datums, the field, PLANTERS, the guideway channel |
| `world/paving.ts` | the paved geometry: slabs, curbs, planters, floor lights, channel |
| `world/groundMaterials.ts` | every floor material (regolith, paving, concrete, channel, bezel, lens, clasts) |
| `world/groundWriter.ts` | slot-merged mesh writer with authored `uv`/`pav` attributes + `sweepSection` |
| `world/groundScatter.ts` | instanced surface clasts |
| `world/groundworks.ts` | the system: regolith mesh, assembly, planter colliders |

### The datum stack (never re-derive these)

```
groundGrade(x,z)          regolith surface — what the floor mesh draws
  + PAVE.rise (0.075)     the paved slab TOP  ==  interiorHeight() on paving
  + CURB.reveal (0.135)   the curb top
  + PLANTER.rimY (0.52)   the planter coping top
```

`interiorHeight()` now means **the walkable surface** and carries the paved
lift. Physics, prop placement, foundations and the guideway datum all read it,
so anything standing on paving stands ON the paving. Nothing may add
`PAVE.rise` a second time, and a district apron must never be authored at
exactly `interiorHeight` — that is coplanar with the regolith mesh and
z-fights (sit it ≥30 mm proud, or let paving own the area).

### Why a priority field instead of decals

Paved regions (`PAVED_REGIONS`) are discs / annuli / rects / ribbons with a
**priority**. A lower-priority slab is CLIPPED, cell by cell, to the part no
higher-priority pour covers. Consequences worth keeping:

- Two slabs can never stack at the same datum → structurally z-fight free.
- parkPlan's spines stop short of the plaza/boulevard on purpose; paving
  extends them (`RIBBON_RUNOUT`) INTO the neighbour and lets the trim cut them.
- The tram channel is priority 99 so it cuts through the station forecourt —
  a street-running loop is never interrupted by a building's apron.

**The trim is a clip, never a projection** (rebuilt after the projection
version shipped 145 m² of same-slot z-fight). Projection is many-to-one: it
collapses a cell's area onto the neighbour's boundary curve, so every cell that
sat deep inside a neighbouring pour came back as a stretched triangle lying
across the cells that legitimately paved there. `emitPatchCell` instead runs
marching squares over `coverDistance` on each parametric cell — inside cells
vanish, outside cells are untouched, crossed cells are cut on the boundary
itself. Three properties are load-bearing:

- **Nine samples per cell** (4 corners, 4 edge midpoints, centre). The
  midpoints catch a boundary entering and leaving through one edge; the centre
  catches a notch between two pours inside an apparently-covered cell. A naive
  "drop it when all four corners are covered" rule opens holes in walkable
  floor, which is worse than the z-fight it fixes.
- **Cut against the neighbour's MESH, not the plan.** A curved pour emits an
  inscribed polygon, so cutting on the plan's ideal circle leaves a crescent of
  bare regolith up to a sagitta wide (27 mm at an apron). `surfaceSigned` uses
  the polygon actually emitted, and `footprintWalk` threads that polygon's own
  vertices into the cut. The guideway channel's footprint includes its
  chamfered LIPS, so paving no longer overhangs the arris meant to protect it.
- **One angular step per polar surface.** Per-band step counts met each other
  as two inscribed polygons of different fineness on the same circle, leaving a
  67 mm slot of bare regolith at the plaza's r = 6.5 seam. The panel count now
  lives only in `vScale` (joints are shader-side from `uv`), so the visual
  pattern is unchanged and every band seam shares vertices.

Curbs, the slab skirt and the floor lights all march the same boundary walk,
and all three break on one rule: skip where a higher-priority region covers the
station, or where the ground is already paved 0.14 m or 0.34 m outside (a
junction). Two probes, not one: the terrace's south edge is tangent to the
boulevard's inner circle, and a single 0.34 m probe stepped clean over it so
both pours kerbed the same junction and the castings ran through each other.

### Proving the floor, not eyeballing it

`node --experimental-strip-types tools/paving-coverage.mjs` builds the paving
headless and rasters the union of the paved plan, counting how many
`ground:paving` triangles cover each sample: **0 is a hole in a walkable floor,
>1 is a z-fight, and only 1 is correct.** It also replicates the shipped gate's
coplanar test bucketed by position, and checks winding (an inside-out cell is
invisible AND a z-fight, and the coplanar gate cannot see it — it reads normals
from the vertex attribute, which is authored upward regardless). Run it after
ANY change to the trim, the bands or the region plan. Current state: 0.07 m² of
hole and 0.00 m² of double coverage over 13,084 m² of floor, 13 cm² of
coplanar overlap in the whole build, zero flipped triangles.

Residual, and why it is not a defect: ~10 m² of samples within 80 mm of a
region edge read as uncovered, every one of them inside a single region. That
is the polygon-vs-circle sagitta at a FREE edge (≤14 mm), and a free edge
always carries a kerb reaching 165 mm back over the slab, so it is buried in
the casting.

### Edge construction (no coplanar pairs anywhere)

Lateral 0 of the curb profile IS the paved boundary. The casting stands 65 mm
proud of it and reaches 165 mm back over the slab; the slab mesh stops at
`PAVE.slabInset` (60 mm) inside the boundary, so the slab's own skirt is buried
INSIDE the curb solid. Nothing shares a plane; the deliberate interpenetration
is a bedding joint, not a defect.

### The regolith

Polar mesh, r ≤ 132, 640 × 152, per-vertex `wear` / `garden` / `paved`
(distance to the nearest paving, which drives the dust berm). The innermost
ring sits at r = 0.43 m, not at the pole: a polar grid that starts at r=0 emits
one zero-area triangle per angular segment, which is exactly what the geometry
audit's `degenerate` check flags.

Relief lives in TWO places on purpose: `interiorHeight` carries ±9 cm of
authored high-frequency ground (so props and the player follow it) but ONLY on
open ground — suppressed under paving and on pads, or the slab would be
punched through from below. Everything under ~1 m is the material's job.

Grade changes: `groundGrade` damps its swale amplitude near every pad and eases
pad skirts over 1.8× their authored width, because parkPlan's 5–8 m skirts
against 0.5–1.4 m steps are 20%+ ramps. Measured after the change: max paved
slope 15%, zero paved area above 20%, 91% of paving under 4%. That is why the
build needs no stairs — every level change on paving is a conforming ramp.

### Contracts other agents consume

- `PLANTERS: PlanterSpec[]` — annular sectors (`cx, cz, rInner, rOuter, a0, a1,
  wall`); soil surface at `slabTop + PLANTER.rimY − PLANTER.soilDrop`.
- `GUIDEWAY_CHANNEL` — `{radius 97, width 3.2, recess 0.06, lip 0.09}`; the
  channel floor is `slabTop(x,z) − recess`. Track agent insets rails into it.
- Emissive slot **`pathLight`** (lens) + `pathLightBezel` (housing), built by
  `createLensMaterial()`; the lighting agent owns the level.
- `slabTop(x,z)` from `paving.ts` — the paved datum for anything sitting on it.

## Open items

- Boot-time one-shot WebGPU error: a 0×0 texture render on `renderContext_3`
  during init (steady-state clean — verified via console mark test). Chase
  during the S9 warmup rework.
- The physics heightfield is 160² over 260 m (1.63 m cells) — coarse against
  the ±9 cm authored relief and the 0.075 m paved lift. Nothing steps or
  bumps (both fields are smooth), but raising it to ~320² would make the
  collision surface match the visual one within a centimetre.
- Portal station: the platform deck (0.9) is flush with the pad datum, so its
  4-step stair flight has nowhere to descend to. Belongs to the station/tram
  agents; the terrace paving deliberately stops clear of the `station-foot`
  pad so it does not dish the forecourt.

---

# Gridshell overhaul (2026-08-10, W1 dome)

Design notes only — things the code cannot tell you on its own.

## Why the dome read as a tan opaque balloon

Proven, not guessed: hiding the three glass meshes (`renderOrder ≥ 9`) at
runtime restored a warm sky gradient, readable mountains and a clean rib
grid instantly. `interiorHaze` was NOT implicated (it accumulates only the
difference the lattice makes, so it is net-zero in open sun by construction).
Two independent causes, both inside `glassShell.ts`:

1. **Double Fresnel.** The shell was a `MeshStandardNodeMaterial` (roughness
   0.055) whose env specular is already Fresnel-weighted, multiplied *again*
   by a hand-authored Fresnel `opacityNode`. Under the alpha blend that reads
   as a milky sheet whose brightness tracks the sky it is standing in front
   of — i.e. an opaque tan wall. **Rule: never stack an authored Fresnel
   alpha on a lit material's own Fresnel specular.** The shell is now
   `MeshBasicNodeMaterial` with a fully authored response, and the alpha IS
   the physical reflectance, so `bg·(1−R) + reflected·R` is exact.
2. **A shader net that no longer matched the geometry.** The analytic field
   drew 192 meridians + 56 rings + a diagonal family over the built members,
   ~9 % average coverage at any distance — a permanent screen door.

## The grid, and why these numbers

> **Replaced by the sparse rebuild — see "Sparse gridshell rebuild" at the
> end of this file.** The tiered grid described here (48 ribs, 36 rings,
> glazing bars doubling at rings 8 and 16) is gone; the paragraphs below are
> kept only because they explain what the tiering was *for*, which is the
> trap the rebuild had to solve differently.

Everything derived from `DOME_RINGS = 36` (θ_base/36 = 4.168 m of arc) and
`DOME_RIBS = 48`:

- Bay width at the foot is 2π·130/48 = 17.0 m; glazing bars halved it twice,
  dropping AT a ring beam (192 lines outboard of ring 16, 96 outboard of
  ring 8, 48 above), to hold every pane at 2.1–4.3 m wide × 4.17 m tall.
- Tier counts were multiples of each other on purpose: a finer family always
  *contains* the coarser one, so bars line up through every drop and the
  analytic `max()` of the families never doubles a line.
- The Panewalker band was rings 12 and 24 — it rides crane rails laid on
  ring beams. `PANEWALKER_THETA_MIN/MAX` are *derived* from
  `DOME_RING_STEP`, so the machine can never drift off the structure.

## One field, two widths

`latticeCoverage` (members) and `latticePaneSeams` (16 mm silicone joints)
are two width sets over ONE internal family definition. The split exists
because the members are now real geometry: painting them on the glass as
well would double every line with up to a metre of parallax. What the glass
legitimately owns is the joint, which really does lie in the glass plane.
If you add a family, add it once in `latticeField` and both consumers plus
the shadow net follow.

## Assembly rule that keeps the shell clean

Strict hierarchy — **ribs continuous, rings stop at rib collars** (bars used
to stop at rings; there are no bars any more) — plus one radial datum
(`DOME_MEMBER_INSET`, every member's inner face) and differing depths only.
Consequences:

- No member ever intersects another; the only "overlap" is the cast collar
  deliberately swallowing the rib's whole section (proud on all four faces,
  so no pair of faces is ever coplanar).
- Every butt joint carries a 15 mm reveal (`JOINT_REVEAL`). Flush is banned.
- Chamfers are profile points in `sweepSection`, not a post-process, so a
  bend never opens a corner; the four chamfer bands route to a worn-edge
  material slot.

## The portal is a trimmed opening, not a hole

`emitMember` cuts any member entering the tube bore and walks the cut end
out to the reveal line by bisection (re-projecting onto the sphere). The rib
on the portal meridian and (since the rebuild) ring beam 12 land on a
reinforcing frame ring whose inner edge is the glass aperture — the frame is
the same code path whatever the grid density is, which is why halving the
member count needed no portal work at all. The plinth does not stop at the
portal either — `revolveVarying` gives the footing a per-longitude profile so
it *dips* under the tube as one continuous casting (an arc with end caps
would have needed a patch under the bore).

## Known geometric disagreement (needs a tram-side diff)

The portal is built on the design truth: tube axis (0, 4.6) at z = 128.4,
which is where `tramSystem`'s iris petals already are. The arrival spur in
`tram/track.ts` bends west/down before the wall — at z = 128.4 its lining is
about (−2.4, 3.6), 2.5 m off axis. The duct's portal flare (r 7.2 → 6.05 by
z = 175) hides most of it, but the fix is one control point: the spur should
run straight at x = 0, y = 3.0 for all z ≥ 126 and start its bend inboard.

## Budget

Gridshell was 321 k tris in 6 merged meshes (one per material slot);
connector tube + portal 27 k. 8.6 ms/frame GPU at 2666×1500 (≈116 fps)
measured with `device.queue.onSubmittedWorkDone()` around 60 stepped frames.
The sparse rebuild took the gridshell to ~200 k (see below).

# Sparse gridshell rebuild (2026-08-10)

Owner's review from inside the dome: *"the dome structure has inconsistent
branch count per grid as it goes lower. i want the dome structure to be less
dense with much less bone branches (like a structure instead of a spider
net), and what remains should look thick and sturdy."*

## What was actually wrong (worth naming, because it is a general trap)

The tiered glazing bars were a *locally* sensible idea — hold the pane size
roughly constant as the bay widens — with a *globally* fatal consequence: the
grid changes grammar as you walk your eye down a rib. One structural bay
showed 1 intermediate bar near the crown, 2 outboard of ring 8 and 3 outboard
of ring 16. Nothing is wrong at any one place, and the whole thing reads as
noise. **A repeating structure is read as a grammar, not as a set of local
decisions; if the grammar changes anywhere, the eye reports "mess" long
before it can say why.** Constant pane size is worth less than a constant
rule.

## The grammar now

24 ribs (every 15°) × 13 ring parallels (11.54 m of arc), and *nothing else*.
Ring 1 is the oculus compression ring, rings 2–12 are ring beams, ring 13 is
the springing (plinth + glazing boot, no beam). 288 member runs where there
were 4896. Bays run 3.0 × 11.5 m at the oculus to 34.0 × 11.5 m at the foot:
the aspect ratio is deliberately *allowed* to drift, because that is what a
single rule produces on a sphere, and it is the drift-free thing to look at.

**A bay is glazed, not filled with one pane.** A structural bay is far too
big to be a single sheet (34 × 11.5 m at the foot), so each bay carries a
pane grid — `DOME_PANE_COLUMNS = 4` × `DOME_PANE_ROWS = 2`, i.e. 3 vertical
seams and 1 horizontal mid-seam per bay — drawn as **hairlines by the glass**
(`latticePaneSeams`) and never as 3-D bars. 96 meridian and 26 parallel seam
lines over the shell, 2304 panes, 8.5 × 5.8 m at the springing down to
~0.8 × 5.8 m at the compression ring.

The rule that makes this safe is that the counts are **per bay and constant
over the whole dome**. The killed defect was not "many lines", it was a
subdivision count that *changed with height*; a constant count merely
converges toward the crown, which the eye reads as perspective. Both counts
are exact multiples of the member counts (96 = 24×4, 26 = 13×2), so every
4th meridian seam and every 2nd parallel seam lands ON a member's own joint —
the `max()` can never draw a doubled line and the pane grid can never drift
out of its bay. **If you ever retune the grid, keep that divisibility.**

Seams are in `SEAM_WIDTHS` only, not in `MEMBER_WIDTHS`: they are drawn on
the glass but deliberately absent from the shadow field. A 32 mm silicone
joint contributes ~0.9 % of *patternless* coverage that the 0.35° penumbra
smears into precisely the uniform grey wash this rewrite removed, and it
would be paid for per step inside the interior shaft march. One constant
(`pane:` in `MEMBER_WIDTHS`) flips it back if seam shadows are ever wanted.

## Thick means WIDE here, not deep

The gridshell is an exoskeleton: every member sits radially *outboard* of the
glass (`DOME_MEMBER_INSET`), which is why the Panewalker can ride its ring
beams and why internal pressure presses the panes onto the frame. From inside
the park you therefore see a member's **width** and almost none of its depth.
Sections went 0.32 → 0.84 m wide at the springing (0.17 → 0.36 m at the
crown); depth grew too (0.95 → 1.55 m) but that buys exterior silhouette and
self-shading, not apparent mass from the floor. If a future pass is told "the
structure still looks thin", widen; deepening will not do it.

Members are now **flanged sections**, not chamfered boxes: wide inner flange,
narrow web, slightly narrower outer flange, filleted at both web junctions.
That is what separates "structure" from "stick" at 130 m — the inner flange
catches sky, the web goes dark, and the flange returns draw a hard bright
line down the whole member. Consequence to know: a flanged profile is **not
star-shaped about its centroid**, so the old centroid-fan end cap laid
triangles straight across both web notches. Caps are ear-clipped
(`ShapeUtils.triangulateShape`) from the 2-D profile instead.

## The half-bay phase bug (this one had been shipping)

`latticeField`'s line families were written as `|fract(x) − 0.5|`, which puts
lines at **half** indices — φ = (i+½)·2π/N and θ = (k+½)·step, i.e. exactly
mid-bay — while `domeGeometry` builds ribs at φ = i·2π/N and rings at
θ = k·step. Every shadow stripe on the park floor, and every silicone seam on
the glass, was therefore **half a bay out of register with the members it was
supposed to belong to** (17 m at the springing). It survived because both
families are periodic, so the *pattern* looks right in isolation. The form is
now `|fract(x + 0.5) − 0.5|`; if you add a family, use the same helper.

Two more fidelity fixes in the same pass: the ring family is masked to the
rings that are actually built (`DOME_RING_FIRST…DOME_RING_LAST`), and the
opaque hub cap is now a disc of coverage in the field, so the crown plate
casts the soft blob it should.

## Brightness delta (honest numbers)

Area-weighted mean coverage over the cap: **8.3 % → 7.2 %**, i.e. open sky
91.7 % → 92.8 %, about **+1.2 % more direct sun**. Nearly a wash, on purpose:
half the member count at 2.6× the width is roughly the same occlusion. What
changed is the *distribution* — the fine net (which the 0.35° penumbra
smeared into a uniform grey wash, and which beat against the regolith mesh as
moiré) is replaced by 24 broad radial bands and 11 ring bands with solid
cores. Expect the floor to read *contrastier*, not brighter.

## The crane rail was buried in the ribs (pre-existing)

The rail runs in φ, so it crosses every rib and every node collar — both far
deeper than the ring beam it follows. Laying it at `ring depth + 95 mm` (the
old formula) buried it inside 48 ribs. It now flies above the node line on a
90 mm sole plate at each node and on stools every ~3.5 m between them, which
is how a crane rail is built anyway. `domeCraneRailLift(θ)` is exported so
the Panewalker derives its stand-off instead of hardcoding one — **the gantry
in `robots/panewalker.ts` must use it** (see the shared-file note in that
file's header when it is updated).

## The portal bulkhead was inside-out, and the skirt was folded (2026-08-13)

Two defects, both visible as "triangular faces" on the tunnel entrance frame.

**`revolveZ`'s normal is the profile's LEFT normal**, `(−dz, dr)` — so a
profile must run CLOCKWISE in the (r, z) plane. The collar's 13-point section
was authored counter-clockwise, which shipped the whole bulkhead casting
inside-out: the outer drum was a culled backface and the inboard flange faced
away from the park. The hazard band next to it was CW and therefore correct,
which is how the two disagreed. The profile is reversed, the convention is now
documented on the function, and normals are ANALYTIC — smooth around the
circumference (a 9.7 m drum on 72 segments facets into 0.85 m plates, and
`writer.quad` flat-shades every one of them), sharp across every profile
crease.

**`buildPortalSkirt`'s outer rim was `min(collarFace, apertureZ − 0.4)`.** Over
the whole upper half of the ring that put the rim 0.4 m INBOARD of the glass
instead of 6 m outboard on the bulkhead — a cowl leaning back into the park,
folded along the latitude where the two branches of that `min` swap over. That
fold is what showed as hard triangular faces, and it drove the rim through the
glass shell and the portal ring frame as well. The rim is now the flange,
unconditionally; the meridian is a Hermite flare (`e(t) = 1 − (1 − t)²`, which
leaves the aperture immediately — a symmetric ease left only 50 mm of clearance
off the glass at the springing — and lands tangent to the flange); and the
surface is a 12 × 96 grid with per-vertex normals by central differences.
Verified: zero meridian direction reversals, and the samples that sit inside
the glass shell drop from 4 818 to 2 822 (the remainder is the collar drum's
own pre-existing penetration near the springing, below the plinth top).

`SmoothSoup` in that file is the shared sink for anything curved here; the
connector duct's 44-segment barrel goes through it too, smooth around and sharp
along so the rib shoulders stay creases.

## The hood's two seams: a rim landing ON a face (2026-08-13, evening)

Owner report: "two spots where the material seems different, like two meshes
combined together in an unclean way", left and right of the bore, just below
the axis.

Both spots are the same defect, and its position is derivable. The glass
aperture's z runs 120.97 m at the crown of the hole to 131.18 m at its invert
(it is an oblique cut through a 164 m sphere), while the bulkhead's inboard
flange is a PLANAR ring at 127.10 — so the aperture crosses that plane at the
two meridians where `apertureZ = 127.10`, i.e. **10.5° below the axis, left and
right**. With the rim landing on the flange at (r 9.70, z 127.10), those two
meridians lie ENTIRELY in the flange plane: a 3.5 m × 1.5 m lens of sheet
sitting inside its own 55 mm wall of the casting's face. Everywhere else the
same tangential landing left a 0.4 m near-coplanar ring at the outer edge, and
the whole LOWER half of the ring was buried inside the collar doing nothing.

Three changes, each measured by `tools/portal-audit.mjs`:

- **The rim is buried in solid metal** — (r 9.52, z 127.90), inside the drum and
  between the flange face and the petal slot at 128.10. A meridian aimed there
  PIERCES the flange plane at 24…58° instead of grazing it, so the sheet meets
  the casting transversally and everything past the crossing is hidden inside
  the casting. Widest band within a half wall of the face: **152 mm**, against
  the whole meridian before.
- **The hood is an ARC, not a ring** — emitted only where the aperture stands
  0.9 m clear in front of the flange (180.5° of arc, ends just below the axis).
  Past that the glass runs straight into the casting and the tube shell covers
  the rest; there is nothing for a transition piece to span. The two cut ends
  get cheek plates, because a sheet that simply stops reads as torn metal.
- **The meridian is a cubic Hermite with end slopes 2.0 and 1.0** — steep off
  the glass (0.71 m of clearance at quarter span, where the old symmetric ease
  left 50 mm) and still moving when it reaches the casting, so it cuts the face
  rather than settling onto it. Wall thinned 0.11 → 0.07 m, which halves the
  coplanar band for free.

Gate: `node --experimental-strip-types tools/portal-audit.mjs` — rim burial,
shallowest flange crossing, widest coplanar band, and that the hood never
re-enters the dome.
