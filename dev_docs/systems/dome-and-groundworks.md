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
**priority**. A lower-priority slab's vertices are PROJECTED onto the boundary
of any higher-priority region containing them, and quads swallowed whole are
dropped. Consequences worth keeping:

- Two slabs can never stack at the same datum → structurally z-fight free.
- Because the projection is exact, junctions close with **zero gap**: a spoke
  butts the plaza on the plaza's own circle, curved, no sliver.
- parkPlan's spines stop short of the plaza/boulevard on purpose; paving
  extends them (`RIBBON_RUNOUT`) INTO the neighbour and lets the trim cut them.
- The tram channel is priority 99 so it cuts through the station forecourt —
  a street-running loop is never interrupted by a building's apron.

Curbs, the slab skirt and the floor lights all march the same boundary walk,
and all three break on one rule: skip where a higher-priority region covers
the station, or where the ground 0.34 m outside is already paved (a junction).
That is why curb runs open exactly at path mouths without any authored gaps.

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

Everything derives from `DOME_RINGS = 36` (θ_base/36 = 4.168 m of arc) and
`DOME_RIBS = 48`:

- Bay width at the foot is 2π·130/48 = 17.0 m; glazing bars halve it twice,
  dropping AT a ring beam (192 lines outboard of ring 16, 96 outboard of
  ring 8, 48 above). Every pane lands in 2.1–4.3 m wide × 4.17 m tall — the
  masterplan's "3–4 m panes" over the whole shell with no special cases.
- Tier counts are multiples of each other on purpose: a finer family always
  *contains* the coarser one, so bars line up through every drop and the
  analytic `max()` of the families never doubles a line.
- The oculus is ring 2 (r = 8.33 m, y = 63.79) so the compression ring sits
  on the same parallel grid as everything else.
- The Panewalker band is rings 12 and 24 — it rides crane rails laid on
  those ring beams. `PANEWALKER_THETA_MIN/MAX` are now *derived* from
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

Strict hierarchy — **ribs continuous, rings stop at rib collars, bars stop
at rings** — plus one radial datum (`DOME_MEMBER_INSET`, every member's
inner face) and differing depths only. Consequences:

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
on the portal meridian and ring beams 33–35 land on a reinforcing frame ring
whose inner edge is the glass aperture. The plinth does not stop at the
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

Gridshell 321 k tris in 6 merged meshes (one per material slot); connector
tube + portal 27 k. 8.6 ms/frame GPU at 2666×1500 (≈116 fps) measured with
`device.queue.onSubmittedWorkDone()` around 60 stepped frames.
