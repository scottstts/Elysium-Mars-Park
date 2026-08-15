# THE LAUNCH SITE — Starship / Super Heavy / OLIT (2026-08-12)

A full-scale stack on its tower and launch mount, standing on graded ground
west of the arrival tunnel, ~215 m out from the park centre. 147 m tall, a
68.6 × 62.6 m concrete platform, 352,746 triangles in 19 parts.

**It flies** — see §8, added 2026-08-13. The demo's 17 objects became 19 when
the fused chopsticks mesh was split so the catch arms can retract; the triangle
count is unchanged and parity is unaffected.

Ported from `ref_images/starship.html` under a hard requirement: **100 %
geometry and material parity**. Everything below is what that requirement, and
the site it landed on, forced.

- `src/procgen/sslib/` — the reusable half of the demo (mesh kit, Blender's
  evaluated mesh, Blender's shader nodes in WGSL)
- `src/starship/` — the vehicle, the tower, the mount, the site, the worker
- `tools/starship-gen.mjs` — emits the port
- `tools/starship-parity.mjs` — proves it is the demo's mesh
- `tools/starship-site-audit.mjs` — proves the site works
- `tools/starship-split-audit.mjs` — proves splitting the chopsticks is free
- `tools/starship-clearance-audit.mjs` — proves the retraction clears

Run all four after any edit to the generator or the retraction angles.

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

## 8. IT FLIES (2026-08-13)

A ~3½ minute loop that never stops. `starshipFlight.ts` owns the profile,
`starshipRig.ts` owns what moves, `starshipSystem.ts` owns the wiring.

```
parked  30 s   the owner's dwell
prep    11 s   the QD arm folds. THE CATCH ARMS DO NOT MOVE
ignition 2.6 s spool against the hold-downs, arms still closed
ascent  63 s   integrated thrust to 10.4 km, 4.0 km downrange SE
               — arms spread as it climbs out through them, T+1.5 s to T+4 s
away    30 s   the owner's gap
entry   36 s   free fall from 10.4 km, 32° off vertical, aimed at the pad
burn    20 s   13 engines, ZEM/ZEV, then 3 for the last 60 m
               — arms close back around it over the last 36 m
touchdown 14 s engines out, the QD arm re-mates → parked
```

Owner's calls, for the record: the stack flies **whole** (no hot-stage
separation), the gravity turn goes **south-east**, and the whole thing is
**silent** — nothing was added to the audio engine.

### 8.1 Integrated, not keyframed — and the guidance is real

Position falls out of `a = T/m·axis − g` at the fixed 60 Hz step. Only throttle
and attitude are authored. A launch read off a curve moves like an elevator;
the tell is that its speed at any height is whatever the curve says instead of
whatever the last few seconds of thrust earned.

Ascent is a gravity turn (vertical to 220 m, then `pitch^0.7` to 42°). TWR runs
2.2 → 3.4 as propellant burns off. **2.2, not the ~1.5 a Starship leaves Earth
with**: in a third of the gravity 1.5 gives 1.9 m/s² and the stack crawls. 2.2
puts the initial 4.5 m/s² and the ~7 s tower-clear where a real launch's are,
which is the cadence the eye recognises.

The landing is **ZEM/ZEV terminal guidance**. With `r_f = 0`, `v_f = 0` the
standard law collapses to a closed form worth writing down, because getting it
wrong is invisible until it isn't:

```
a_thrust = −6·r/t_go²  −  4·v/t_go  +  g_up
```

Two things about it are load-bearing and were both got wrong first time:

- **`t_go` is recomputed every step** as `2z / descentRate`. Fixing it at
  ignition and counting down is the classic way to detonate this law — the
  `6/t²` gain diverges while the vehicle is still hundreds of metres up. The
  first build flew the stack to **344 km**.
- **Thrust is clamped** (20 m/s², ~5.4 g_mars) and the axis is never allowed
  below 8.6° above horizontal. Unbounded, the law will ask for any acceleration
  the geometry implies; asked to null 3.2 km of crossrange in 17 s it inverted
  the vehicle and demanded 7 700 g.

That crossrange was the actual bug. The entry point is now **back-solved**
(`entryGroundRange`) from the closed-form fall so the free fall carries the
vehicle most of the way home and the guidance is only ever trimming — the
regime the law is well behaved in. Put the entry anywhere else and you are
asking a booster to do something a booster cannot do.

Below 60 m ZEM/ZEV hands over to a constant-deceleration settle. That is not a
shape picked to look nice: feed `t_go = √(2z/a)` back into the law and it
returns `a + g` exactly, so the settle **is** ZEM/ZEV's own profile, solved
instead of integrated. Same deceleration, same throttle, no step at handover —
and contact is exact rather than nearly. Residual at touchdown is `(0, 0, 0)`.

Three continuity traps found by simulating the profile headlessly, all of which
would have shipped:

- The settle's **attitude** snapped from the burn's ~13° lean to vertical in one
  frame. On a 147 m vehicle that throws the nose 25 m. Now interpolated to
  vertical over the remaining height — which is also what a booster does.
- The settle's **crossrange** was nulled on a time constant, eating ~20 m in a
  second and reading as a sidestep. Now walked out in proportion to remaining
  height, so it reaches zero exactly when the altitude does.
- The **re-entry is a teleport**, so it happens at `FADE_END_ALT` — the exact
  altitude the ascent vanished at, where visibility is already 0. There is no
  frame in which the vehicle appears.

No drag, and that is physics rather than a shortcut: at the 292 m/s peak the
Mars column gives ~30 kN against a vehicle in the 10⁶ kg class, four orders of
magnitude under gravity.

### 8.2 The frame is ENU, for free

The demo's Blender group sits at yaw 0, so it is already **+X east, +Y north,
+Z up**. Every flight calculation happens there and nothing in it knows about
the site transform. World mapping is one line: `(bx, by, bz) → (site.x + bx,
site.y + bz, site.z − by)`.

The vehicle turns about its **engine exit plane**, not the assembly datum
(which is the tower's, 5.36 m away in plan and on the ground). Two nested
groups do it and stay exactly identity when parked. That point is also where
the plume attaches and the one place the guidance must be exact.

**Nothing is ever baked into vertices.** Four of the twenty materials read
`positionLocal` as Blender's Texture Coordinate > Object; animating a parent
leaves geometry coordinates alone, while baking motion in would slide the noise
across the tower steel and engine metal every frame.

### 8.3 The chopsticks had to be split, and the split is free

The demo fuses the carriage and both catch arms into one `Tower_Chopsticks`
mesh, parked closed with the pads under the ship's forward flaps. **Measured,
the vehicle's swept silhouette passes 44.7 m of itself through each arm** — the
grid fins stand directly beneath them. Nothing can launch through that.

`MB.add_v` **never welds**: every `prism()`/`lathe()` appends a fresh vertex
island, so the carriage and the arms share no vertex, no edge and no smoothing
group even fused. Rebuilding them into three MBs therefore cannot change a
normal — `buildGeometry`'s edge map is keyed on indices that were never shared,
and its duplicate-poly pass can only fire within one primitive.

So the generator gained exactly **two `export` patches** (patch kind 1, already
sanctioned) on `carriage()` and `chopstick()`, and `starshipBuild.ts` — which
is hand-written, not generated — swaps the fused object for three. **The fused
object is still built and dropped**, one MB of waste on a worker thread, so
`tools/starship-parity.mjs` goes on comparing the demo's own `Tower_Chopsticks`
vertex for vertex. `tools/starship-split-audit.mjs` proves the three meshes are
that mesh, triangle for triangle, bucketed by material.

### 8.4 Retraction angles are measured, not reasoned

`tools/starship-clearance-audit.mjs`. The test that matters is exact, and
setting it up correctly is the whole trick: **the vehicle leaves vertically and
does not roll**, so it sweeps its own plan silhouette extruded upward — not a
disc of its maximum radius. Hand arithmetic using a disc gives 10.75 m (the
ship's flaps) where the real footprint is a 4.5 m hull with four flaps and four
fins at fixed azimuths, and condemns members nothing passes near. The audit
rasterises the vehicle into a plan grid holding the **lowest geometry per
cell**; a member is fouled exactly when something stands over its cell at or
below its height.

| | measured |
|---|---|
| catch arms parked | swept by 44.7 m at (−2.2, ±5.7, 130.2) |
| catch arms +25° | nothing on the vehicle stands over them at all |
| QD arm parked | **never swept** — nothing over it, ever |
| arm hinge in tower/carriage at rest | 1.27 m³ (the demo's own construction) |
| added by +25° | 0.22 m³ (0.54 at 30°, 0.75 at 34°) |
| QD fold 55° | +0.32 m³; yawing it aside 60° instead costs 1.96 m³ |

Two consequences worth keeping:

- **25°, not more.** Past the measured floor, opening buys nothing and costs
  tower.
- **The QD arm retracts for honesty alone.** It could legally stay put; a mated
  umbilical on a launching rocket is simply wrong. That makes its cost pure,
  which is what picks the axis: its root sits 0.5 m east of the tower face with
  a 3.9 m section, so *every* retraction drives some hinge into the face rails.
  Down is six times cheaper than aside, and 55° reads as retracted without the
  extra intersection 80° would buy nothing with.

### 8.4b The arms are driven by ALTITUDE, and that is what makes it provable

Owner's note, and it is how the real pad works: the chopsticks are still around
the vehicle at ignition and **spread as it rises through them**; on the way in
they **close back around it in the last moments before contact**. They are never
opened during a hold.

So `armOpen = smoothstep(0, ARM_OPEN_ALTITUDE, altitude)` — one function, every
phase, both directions. Three things fall out:

- **The descent cannot drift from the ascent**, because it is not a second
  schedule. It is the same one read backwards. Nothing is tuned twice.
- **Parked is exactly 0**, so they are mated at ignition with no special case.
- **Clearance becomes provable.** Because the angle depends only on altitude,
  "do they ever touch?" is a question about a one-parameter family of poses
  rather than about timing, and the audit can simply walk it.

The walk is the part worth having. It is a solid-vs-solid voxel test at every
height — the swept-silhouette test in §8.4 cannot answer this, because it asks
whether anything EVER passes over a member, which for a member that moves out
of the way is the wrong question.

| | measured |
|---|---|
| window a **never-moving** arm is ploughed through | ascent 20.5 → 44.5 m |
| what does the ploughing | grid fins, then chines |
| schedule clean up to | `ARM_OPEN_ALTITUDE` 44 m |
| first failing value | 46 m — fouls at 24–25 m of ascent, arms half spread |
| chosen | **36 m** — 28 % margin, full spread ~4 s after liftoff |

Contact at ascent 0 is excluded and is not a defect: in the parked pose the
catch pads are **seated on the ship's forward flap undersides**, ~0.2 m³ of
it — that is the demo's own mated geometry, and the vehicle is off the pads
within the first half metre of ascent.

This is a real constraint, not a formality: at the first tried value (60 m) the
fins arrived while the arms were 12.5° open and put 0.42 m³ of truss through
the vehicle.

### 8.5 What the shadow cost

**The vehicle can no longer be in the cached static bundle.** That bundle is
sealed during the loading frame and immutable after, so a mesh that later moves
leaves its shadow welded to the pad for the session. The eleven vehicle parts
go to `DYNAMIC_SHADOW_LAYER`.

That creates the second problem: the dynamic caster maps reached 90 m around
the camera, and the pad is 93–340 m away with a light-space reach of ~298 m at
27°. Without more, the tower would go on printing its 287 m shadow across the
regolith while the 147 m rocket beside it printed nothing.

So `skySystem` gained a **third dynamic caster rung at 440 m** — the static
L4's number, chosen there against the same measured 298 m worst case. Cost is
one more continuously refreshed map: the stack's 353 k triangles while it is
low (frustum culling drops it once it climbs out of the box), plus the robots
and the tram, which were already paying for two. Texel is 0.43 m at tier 0.
Soft — but a soft 147 m streak on regolith reads as penumbra, and the
alternative is no streak.

**This rung is the whole revert if the frame budget says no**, exactly as
`receiveShadow` on the valley mesh is for §6.

### 8.6 The plume, and where it sits on the ladder

`starshipPlume.ts`. A methalox plume is **not orange** — the orange in a launch
photograph is recirculated pad debris and afterburning. Clean CH₄/O₂ is a
blue-violet Mach-shocked core, and on Mars the nozzle is grossly
**under-expanded** (exit pressure thousands of times ambient), so the flow
blooms the moment it leaves the bell and keeps blooming as the vehicle climbs.
Short white throat, diamond-shocked violet barrel, huge soft flare, orange only
where it belongs — the cool entrained skirt. The owner asked for
blue/purple/orange ionised air; this is that, with the orange put physically.

**IT IS NOT A MESH, and the first version's mistake is worth keeping written
down.** That build was three nested additive lathe shells, and it read as
exactly what it was — a solid cone bolted to the tail (owner report). The
reasoning behind it was sound and still wrong: a single shell cannot be shaded
by radial position, so nesting shells was the cheap way to get brightness
peaking on the axis. But what makes a plume look like gas is not its radial
profile. It is that its edge is made of separate parcels moving at different
speeds and dying at different distances — **a plume has no silhouette**, and
any mesh has one.

So it is a stream of ~360 additive camera-facing parcels flowing down the axis,
one instanced draw, all placement in the vertex stage. Parcels grow as they mix
outward, which is the single strongest cue that this is gas expanding rather
than a shape being drawn.

That also disposes of the reason the mesh existed in the first place. A cone
survives being viewed along its own axis where an axis-aligned ribbon
degenerates to a line — and from 215 m, most of an ascent is spent looking
straight up the axis. Camera-facing parcels have no preferred direction, so the
problem never arises.

**The diamonds are stationary and the gas is not.** Shock cells stand still in
space while flow passes through them, so the banding is keyed to axial distance
and parcels brighten as they cross a node. Keying it to parcel age instead
makes the whole plume strobe.

HDR placement against `world/lightFixtures.ts`: bloom threshold 1.0, brightest
authored fixture 5.0, sun disc 1800. The core sits at **80** — a rocket exhaust
belongs between the lamps and the sun, not near the lamps. Exposure is authored
and fixed, so nothing else in the frame is crushed when it lights.

The engine count drives the root width, which is why the exhaust visibly steps
down twice on the way in: **33 → 13 → 3**, Super Heavy's own sequence.

One **real light** (`starship-plume`, 1 of 8) rides the engine plane. A plume
that does not light the steel it is roaring past reads as a decal. It is
registered at boot and driven to zero when cold — the rig's rule is that a
Light's `visible` is never toggled and none are added after boot, because
either rebuilds every lit program in the park.

### 8.7 The pad blast

`starshipPadBlast.ts`. 33 Raptors into a mount with a 4.86 m throat, over
graded regolith. Two things happen, and both are visible from the park: a
radial **sheet** that in 600 Pa outruns anything on Earth and crosses the 68 m
slab in a couple of seconds, and a **column** that lifts off the ring and
hangs — Mars dust is microns, with a tenth of the gravity and no rain.

It emits at the **raft**, not the deck: the vehicle stands 19 m up on the table
and the flow falls through the hole before it turns, so the cloud is seen
boiling out from *under* the table. Emitting from a point would put its origin
inside the launch table.

One draw of 900 instanced quads with **no CPU-side particle state** — every
instance derives its position from `instanceIndex`, a hash and two uniforms.
The pad is 215 m away and usually off screen; a per-frame loop over a thousand
particles would be paid whether or not anyone was looking.

Emission strength is **held and bled off over 26 s**, not tracked live.
`padBlast` is what the engines are doing to the pad and it stops when they do;
the cloud they already threw does not. Multiplying the particles by the live
value snapped a 60 m dust column out of existence at engine cut.

The sheet is constrained by Dome One's **exact spherical shell**, not a plan
circle. Its unconstrained reach exceeds the 85 m gap from vehicle axis to
glass, so inward parcels otherwise genuinely enter the sealed volume. Each
parcel centre is projected to at least `DOME_SPHERE_RADIUS + grow / sqrt(2) +
0.25 m`; `grow / sqrt(2)` is the camera-facing quad's half diagonal, which
keeps every pixel of the puff outside from every player view while letting the
blast turn upward around the exterior. The blast composites at render order 8,
before the exterior/inner glass at 9/10, so the pane response remains visibly
in front of the outside dust instead of dust alpha being painted over it.

`markParticle` is not optional here — a camera-facing quad rasterises as its
full rectangle in any depth or shadow pass, and a thousand of them under a
shadow-casting sun paint a moving grey slab across the valley. That is the
project's own documented defect class, from the greenhouse spray.

### 8.8 Why the vehicle cuts rather than fades

Only the **meshes** cut, at `visibility ≤ 0.02`; the plume is a sibling under
the same flight group and goes on fading smoothly after the hull is gone —
which is what a real launch looks like from 10 km, where the flame is the last
thing you lose. By then the vehicle is a ~1 px wide sliver at ~88 % haze
extinction, so the cut lands where nothing can read it.

Fading the meshes instead would mean cloning the shared 20-material array:
`black`, `dark_metal` and `steel_dirty` are used by the tower and the mount as
well, so there is no per-mesh opacity available without a second set of
compiles and a transparent-pass sort for 353 k triangles.

Fade window 6.8 → 10.4 km, and `PITCH_MAX_DEG` is **42, not 52**, for the same
reason: at 52° the stack ran 6.3 km downrange and its slant range reached
13.2 km — inside the 14 km far plane by less than the length of the vehicle.
42° holds the worst case near 11.3 km from anywhere on the park floor.

---

## 9. Open items

- **The WGSL is unverified on device.** `wgsl()`/`wgslFn()` compile only at
  render time and nothing here can be checked headlessly. Same three version as
  the demo (r185), same module, so it should be identical — but this is the
  first raw WGSL in the project and the first thing to suspect if the launch
  site renders black.
- **Self-shadow acne on the open shells** is the other thing to look for: 20
  `DoubleSide` materials go into the shadow map, and three renders DoubleSide
  casters from both faces. `normalBias` is scaled per level and should hold, but
  the TPS shell and the hot stage are thin and were never tested as casters.
- **Static-bundle refresh cost.** The eight parts that stay on the ground join
  the cached shadow bundle, which is recorded with `frustumCulled = false`, so
  a level recentre runs the vertex stage over them whether they are in that
  level's box or not, at a budget of one level per frame. Much cheaper than it
  was — §8.5 moved the eleven vehicle parts (the bulk of the 1.06 M vertices)
  off the bundle entirely — but the OLIT is still 18 k triangles of lattice. If
  recentre hitches ever show up, the lever is a decimated stand-in on
  `STATIC_SHADOW_PROXY_LAYER` (`procgen/blenderkit/decimate.ts` already has the
  cluster decimator).
- **The plume and the pad blast are unvalidated on device**, like everything
  else here. The plume's HDR core is authored at 80 against a 1.0 bloom
  threshold; if it blows the frame out, that multiplier is the one dial, and
  `?pass=bloom` isolates it.
- The site has no approach road. The design notes describe a spaceport road
  continuing south past the tube; nothing here builds it, and the player can
  never walk out there anyway.
