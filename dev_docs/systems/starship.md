# THE LAUNCH SITE — Starship / Super Heavy / OLIT (2026-08-12)

A full-scale stack on its tower and launch mount, standing on graded ground
west of the arrival tunnel, ~215 m out from the park centre. 147 m tall, a
68.6 × 62.6 m concrete platform, 352,746 triangles in 17 parts.

Ported from `ref_images/starship.html` under a hard requirement: **100 %
geometry and material parity**. Everything below is what that requirement, and
the site it landed on, forced.

- `src/procgen/sslib/` — the reusable half of the demo (mesh kit, Blender's
  evaluated mesh, Blender's shader nodes in WGSL)
- `src/starship/` — the vehicle, the tower, the mount, the site, the worker
- `tools/starship-gen.mjs` — emits the port
- `tools/starship-parity.mjs` — proves it is the demo's mesh
- `tools/starship-site-audit.mjs` — proves the site works

---

## 1. Parity is a property of the BUILD, not of the diff

The port is **generated**, not hand-translated. `tools/starship-gen.mjs` slices
line ranges out of the HTML and applies an asserted patch table; every line not
named in a patch is byte-identical by construction, and a patch whose `find`
string stops matching throws instead of silently emitting a near-copy.

Patches are only ever one of four kinds — `export`, a type annotation, strict-
compiler housekeeping, or the single structural deviation below. 186 patches
over 1,888 source lines.

`tools/starship-parity.mjs` then runs **both** builds in one process — the
demo's own `<script>` body against a stub THREE, and the emitted TypeScript —
and compares name, shading angle, slot list, placement, group ranges and the
raw position/normal/uv `Float32Array`s element for element. Current result:

```
17 objects, 352,746 triangles compared
PARITY OK — every vertex, normal, uv and group range is identical
```

Run it after any edit to the generator. This is what makes "100 %" checkable
rather than asserted.

### The one deviation

`buildGeometry` returns plain typed arrays instead of a `THREE.BufferGeometry`,
because the build runs on a worker and three.js must not be imported there. The
arrays are the demo's arrays; the parity harness compares them directly.

### Two things the strict compiler forced, worth knowing

- Six slot-index constants in the source are **declared and never used**
  (`S_TILEN`, `B_DIRTY`, tower's `T_CONC`/`T_BLK`, olm's `T_ORG`/`T_WHT`).
  They are dropped from the `const` lines with a comment; **every surviving
  index keeps its source value** and the `slots` arrays are untouched, so no
  face changes material.
- `SHIP`, `BST` and `TW` are literals the source then bolts derived fields
  onto (`BST.BODY_TOP = …`). They carry an interface and an `as` assertion so
  the two-step stays two steps. That assertion is the one place tsc is not
  checking the numbers — the parity harness is.

---

## 2. `procgen/sslib/` is a SECOND Blender kit, deliberately

`procgen/blenderkit/` already exists (the Optimus port: optlib.py, fitted
curves, BSP booleans, the bevel modifier). This demo comes from a different
Blender library — `sslib.py`: a mesh builder with swept prisms and lathes — and
its shader nodes are **raw WGSL**, not TSL.

They are kept apart on purpose. Both reproduce Blender; neither is a rewrite of
the other; merging them would put one demo's pixels at the mercy of the other's
edits. A future port should extend whichever kit its own source came from.

| | `blenderkit` | `sslib` |
|---|---|---|
| source | optlib.py | sslib.py |
| mesh | `Mesh` + curves + CSG | `MB` + prism/lathe |
| noise | Blender lookup3 as **TSL** | Blender lookup3 as **WGSL** |
| output | indexed, welded | non-indexed, grouped |

**This is the project's first raw WGSL.** `wgsl()` injects the hash, Perlin/fBm,
white noise and the HexGrid node group verbatim; `wgslFn()` wraps them. TSL's
own `mx_noise` is a *different noise basis* — substituting it would change every
material in the port, which is exactly what parity forbids.

---

## 3. The materials keep their local frame, so the scene graph is two groups

Four of the twenty materials read `positionLocal` — Blender's *Texture
Coordinate > Object*. The tower steel, the engine metal, the concrete and the
painted parts all derive their noise from it.

That makes the transform chain load-bearing, not cosmetic:

```
site group      position = STARSHIP_SITE, rotation.y = yaw
 └─ blender     rotation.x = −π/2          (Blender Z-up → three Y-up)
     └─ meshes  the demo's own local pos / rotZ, geometry in Blender coords
```

**Baking the world transform into the vertices — or collapsing the two groups
into one Euler — moves that texture space and changes how those surfaces look.**
The demo's own root does exactly the `−π/2` step; the site group is the only
thing added, and it sits *outside* it.

All twenty materials are `DoubleSide` (`use_backface_culling = False`). Not
negotiable here: the TPS shell, the hot stage and most lathes in this build are
**open shells whose caps were never authored**. Backface culling would put holes
in the vehicle, not save fill rate.

The demo's studio rig — three lights and a synthetic equirect — is **not**
ported. It is not "geometry and material", and it would mean a second sun over
the valley. The stack is lit by the park's Mars sun and baked sky.

Draw shape: one shared 20-material array, parts remap their own slot lists into
it. The demo could afford per-object arrays because it rebuilt them per object;
one array here means twenty materials compile once instead of ninety times.

---

## 4. No LOD — and that is the interesting half

The Optimus asset carries three LODs. This one carries none, on purpose:

| | Optimus | Starship |
|---|---|---|
| triangles | 890 k | 353 k |
| closest approach | ~1 m | **215 m, unreachable** |
| max subtended angle | ~40° at 1 m | ~35°, fixed |

A coarser tier would save draw work the frame does not miss and would cost a
second copy of a 34 MB vertex buffer. Frustum culling is **per part** rather
than per stack, which matters: from inside the dome the ship is on screen while
the pad slab under it usually is not.

Build cost is ~450 ms — off the main thread in a worker (34.7 kB chunk, no
three.js in its import graph), with an inline fallback if module workers are
unavailable.

---

## 5. Siting: west of the tunnel, and what the sun does about it

Coming up the tube into the dome the stack stands **on your left** — the Bowl's
side. The tower is on the far side of the vehicle with the catch arms reaching
back east toward the tunnel, so from inside the park you look *through* the arms
at the ship rather than at the back of the tower.

```
assembly origin   (−83, −0.54, 200)   yaw 0   (Blender +X = world +X)
vehicle axis      (−77.6, 200)        r 214.5 m from the park centre
tower axis        (−100.5, 200)
pad slab          X −121.3 … −52.7    Z 168.7 … 231.3
tube skin (r 7.2) 45.5 m of open regolith between
dome glass foot   nearest vertex at r 176.8 m
```

**The sun is 49° off the sightline from the park, so the stack is backlit** —
contre-jour, a dark lattice and a specular rim down the stainless hull. The east
side would have been 91° (full raking side light); west was the owner's call
from the drawing and the Bowl. It is *why* the shadow work below was worth
doing: a backlit lattice that does not self-shadow is a flat grey cutout.

### The site is GRADED, and the grade is applied last

Natural relief across the slab's footprint runs −1.13 … −0.05 — a 1.08 m swale
under a 68 × 62 m pour. You do not pour a launch platform on that.

`exteriorHeight` gained a graded platform, the same mechanism it already uses
for the dome apron and the spaceport corridor: level −0.44 (the footprint's own
mean, so cut and fill balance at 0.58 / 1.05 m), a flat rectangle clearing the
slab by 4 m on every side, and a **30 m skirt** — deliberately wide, because the
valley mesh is polar with ~10 m radial rows out here and a tighter ramp comes
out as a staircase rather than an apron. Apron grade ≤ 3.5 %.

**It is applied AFTER the interior blend, at the very end of the function.** The
pad straddles r 177–261 and that blend still mixes in 66 % of `interiorHeight`
at the near corner; grading before it would leave the pour riding the dome's own
falloff instead of being level. Measured flatness under the slab: **0.00 mm**.

The skirt dies at x −19.3, so it never reaches the arrival tube (which reads
`exteriorHeight` for its own ground line).

Both boulder-scatter loops skip the pad plus a 6 m verge. The existing corridor
sweep only covers |x| < 58–70; this site spans |x| 53–121 and would otherwise
have had rocks standing on the concrete and half-buried in the apron ramp.

Seating: the demo's 2.4 m raft runs −1.10 … +1.30 about the assembly origin.
At origin Y −0.54 it is **1.20 m buried and 1.73 m proud** all the way round.

---

## 6. Shadows — and the valley had to start receiving them

The first pass gave the stack `castShadow`/`receiveShadow` and stopped there, on
the reasoning that the ground shadow was invisible anyway because the terrain
does not receive. **Shipped like that, the complex casts nothing you can see**
(owner report). Two compounding reasons, and the second is the real one:

1. **Metal barely self-shades.** The vehicle is `metalness 1.0` and the tower
   `0.64`. A pure metal has no diffuse term — nearly all of its appearance is
   environment reflection, which a shadow map does not attenuate. Self-shadowing
   an object like this changes almost nothing.
2. **So on this asset the shadow map reads as CAST shadow on the ground.** The
   OLIT's is 287 m long at the frozen 27° sun and sweeps east-north-east
   straight across the regolith between the pad and the tunnel — exactly the
   sightline from inside the dome. All of it was landing on a non-receiving
   floor, and the complex read as a decal pasted onto the valley.

So `exteriorTerrain`'s valley mesh now has **`receiveShadow = true`**. Two things
come along for free and are correct: the connector tube already cast, and the
dome's analytic lattice net rides the same shadow node — `latticeSunVisibility`
is a ray-sphere test gated on `smoothstep(-0.5, 0.5, t)`, so it returns 1 out on
the sun side and projects the rib net onto the floor on the far side.

The cost is shadow sampling over every terrain pixel, and the terrain is a large
slice of the frame near the glass. It is bounded — the clipmaps reach 440 m from
the camera and everything past that samples out of range — but it is not free.
**That one flag is the whole revert if the frame budget says no.**

### Boulders cast through a cheap stand-in

Once the floor takes shadow, 2 600 rocks standing on it casting nothing is the
new artifact. They cast through a separate proxy on
`STATIC_SHADOW_PROXY_LAYER`, not by flipping `castShadow` on the visible
instances, because the cached bundle is recorded `frustumCulled = false` — every
instance runs its vertex stage on every level refresh whether it is in that
level's box or not. Two cuts:

- **detail 1, not 2** (80 tris vs 320). A boulder's silhouette at 27° elevation
  is the same either way and nothing else about it is used.
- **only inside r 510.** The camera never leaves the park floor (r ≤ 122) and the
  outermost level spans 440 m, so a rock past that can never land in any map.

1 365 of 2 600 rocks survive both: **109 k triangles instead of 832 k.**

### The two clipmap changes

**A fifth rung, not a wider fourth.** From the far rim the stack's light-space
distance reaches 298 m, past the old outermost level at 260 — the whole thing
would have flipped to flat-lit as the player walked north. `15 · 2.59³ ≈ 260.6`
keeps every existing half-width exactly where it was tuned and the new level
alone stretches out. Raising `maxDistance` on four levels instead would have
grown L3's texel ~46 % for one object's benefit.

**And the reach number is NOT `maxDistance`.** `levelData.z` is
`halfWidth · (1 − guardBand)` and the fade opens a further `blendRatio` before
that, so usable reach is `maxDistance · 0.88 · 0.84`. The first attempt at 380
looked fine against `maxDistance` and was actually leaving the far rim inside
the fade band at ~76 % weight. **440** puts the fade edge at 325 m against a
measured worst case of 298 m — 27 m of margin, verified over 160 camera
positions (the whole park floor, the Freedom gallery deck, and the arrival ride
out to z 430) × 20 k sample points on the stack.

**`lightMargin` 150 → 360.** The project's own rule is that a caster `h` metres
above the level centre needs `h / sin(27°)` of up-sun near-plane reach; the OLIT
crown is 144 m above the eye, so 317 m. At 150 the tower's shadow would have been
cut off two thirds of the way up — the exact defect the 120 → 150 bump was made
to fix, on the tallest object in the world. This only widens each shadow camera's
depth slab, and `shadowDepthBias` divides by that slab, so the world-space
receiver offset is unchanged and nothing else needed retuning.

No colliders — the dome wall is the physical boundary. No `update()`: the frozen
afternoon extends to the spaceport, so the system costs nothing per frame once
loaded.

---

## 7. Known, measured, and deliberately kept: 91.2 m² of coincident face

The demo seats the OLM's **six leg footings** and the **booster QD block** flush
*on* the pad slab's top face rather than 20 mm into it. Three coincident pairs
at Y 0.760, with true rasterized overlap:

| pair | overlap |
|---|---|
| OLM_Table / Pad_Platform | 72.1 m² |
| OLM_BQD / Pad_Platform | 14.3 m² |
| OLM_Table / OLM_BQD | 4.8 m² |

This is the project's banned z-fight class, and it is the demo's own geometry —
kept because parity was the explicit requirement. It is invisible in practice:
the deck is at Y 0.76, the eye at 1.7 m and 215 m away, so the plane is seen at
**0.25° — edge on** — and the OLM table, its legs and the booster stand between
the viewer and most of it.

**The fix, if it is ever wanted, is two numbers**: start those prisms at
`PLAT_Z − 0.02` instead of `PLAT_Z` in `parts/olm.ts` (via the generator's patch
table). The boxes get 20 mm taller, buried in concrete, and the coincidence is
gone. It breaks byte-parity on two source lines, which is why it was not done
unilaterally.

The site audit records this plane as a known baseline and **still fails on any
coincidence the port introduces itself** — two other shared planes exist
(Y 75.610 and Y 89.560, booster vs tower) but the parts are 23 m apart in plan,
so rasterized overlap is zero and they are not z-fights. Sharing a plane is not
the defect; overlapping on one is.

---

## 8. Open items

- **The WGSL is unverified on device.** `wgsl()`/`wgslFn()` compile only at
  render time and nothing here can be checked headlessly. Same three version as
  the demo (r185), same module, so it should be identical — but this is the
  first raw WGSL in the project and the first thing to suspect if the launch
  site renders black.
- **Self-shadow acne on the open shells** is the other thing to look for: 20
  `DoubleSide` materials go into the shadow map, and three renders DoubleSide
  casters from both faces. `normalBias` is scaled per level and should hold, but
  the TPS shell and the hot stage are thin and were never tested as casters.
- **Static-bundle refresh cost.** All 17 parts join the cached shadow bundle,
  which is recorded with `frustumCulled = false`, so a level recentre runs the
  vertex stage over the stack's 1.06 M vertices whether it is in that level's
  box or not — roughly doubling the bundle's vertex cost, at a budget of one
  level per frame. If recentre hitches ever show up, the lever is a decimated
  stand-in on `STATIC_SHADOW_PROXY_LAYER` (`procgen/blenderkit/decimate.ts`
  already has the cluster decimator) — at the price of a second vertex buffer
  and a slightly different self-shadow silhouette, which is the whole reason
  the shadow exists here.
- The site has no approach road. The design notes describe a spaceport road
  continuing south past the tube; nothing here builds it, and the player can
  never walk out there anyway.
