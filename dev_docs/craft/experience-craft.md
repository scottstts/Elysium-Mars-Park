# Experience craft — what SeaPark does that Mars Park does not

A craft study of `~/Documents/Projects/Node/SeaPark/` (finished, exemplary) read against
`mars_park` (currently reads flat/empty). Every claim is cited `file:line` into SeaPark.
Snippets are already adapted to our stack (three 0.185.1, WebGPU+TSL, `PartWriter`,
`kitMaterials()`, `GameSystem`).

**The thesis in one line.** SeaPark is not better because it has more assets — it has
*two* amenity prototypes and thirteen archkit modules. It is better because (a) every
camera handoff is an authored blend with an explicit owner, (b) every district gets a
dedicated `detailX()` dressing pass, (c) light fixtures actually emit light, and (d)
everything that repeats is instanced/merged so density is free. Mars Park has the
architecture for all four and uses none of them.

---

## 1. Arrival + camera craft

### 1.1 The core artefact: `VehicleSeatRig`

SeaPark has exactly ONE camera-handoff class, shared by four rides
(`rides/vehicleSeat.ts:15`; used at `descentBell.ts:414`, `greatWheel.ts:490`,
`pearlLine.ts:230`, `carousel.ts:441`). Its whole contract is 138 lines:

- Three phases `'in' | 'riding' | 'out'` (`vehicleSeat.ts:21`), never a cut.
- Blend durations are asymmetric and authored: `BLEND_IN = 1.2`, `BLEND_OUT = 0.9`
  (`vehicleSeat.ts:4-5`). Getting in is slower than getting out.
- Ease is smoothstep on the blend scalar: `t*t*(3-2*t)` (`vehicleSeat.ts:106`, `:120`).
  The same ease appears in every blend in the project — submarine boarding
  (`submarine.ts:820`), bell travel (`descentBell.ts:510`), iris/telemetry. **One ease
  curve for the whole game.**
- Position lerps, orientation **slerps**: `camera.quaternion.copy(from).slerp(target, eased)`
  (`vehicleSeat.ts:108`). Never euler-lerp a camera through a handoff.
- Seat orientation is composed, not assigned:
  `vehicleAttitude × seatFacing(baseYaw) × freeLook(lookYaw, lookPitch)`
  (`vehicleSeat.ts:96-101`). The rider keeps mouse-look *inside* the seat, clamped to
  `PITCH_LIMIT = π*0.42` (`vehicleSeat.ts:7`), and free-look only works under pointer
  lock (`vehicleSeat.ts:41-42`) — otherwise a stray cursor drifts the seated view.
- **The body never travels.** The player capsule stays parked at the exit point for the
  whole ride; hand-back is `player.setLook(euler.y, euler.x)` then
  `player.placeAt(exit)` then `controlEnabled = true` (`vehicleSeat.ts:126-131`). The
  camera reaches the standing eye BEFORE the body is moved, so there is no frame where
  the two disagree.
- The exit is gated by a flag the ride owns: `canExit` (`vehicleSeat.ts:33-34`), flipped
  true only at a dock (`descentBell.ts:514`, `greatWheel.ts:643`).
- `attachImmediate()` (`vehicleSeat.ts:73-77`) exists for the *opening* shot — camera
  starts in the seat with `blend = 1`, no move-in.

### 1.2 Mars Park's actual bug — the blend-out is dead code

`playerSystem.ts:229` gates the seat blend on `this.seatBlend > 0 && pose`. But
`standAt()` (`playerSystem.ts:112-122`) and `stand()` (`:124-138`) both set
`this.seatedPose = null` **and** teleport the rigid body in the same call. So on the very
next frame `pose` is null, the `else` branch runs `eye.copy(position)`, and the camera
hard-cuts from the seat eye to the walking eye at the new teleported location.
`seatBlend` decays from 1 to 0 over 0.55 s with nothing reading it. That is precisely the
"crude and blunt" transition. The move-*in* works (`enterVehicle` sets the pose first, so
the blend runs); only the move-*out* is broken.

Secondary problems in the same area:

- `tramSystem.ts:151-156` seats the player at `init()` with `enterVehicle()` — instant,
  `seatBlend` starts at 0 so there IS a 0.55 s rise, but from the spawn pose at the
  portal platform, not from anywhere authored.
- `tramSystem.ts:175-189` `alight()` computes a door point and calls `standAt()` — no
  blend, no look handoff, and the `door.y = 0.9` hack at `:187` is a magic patch.
- `tramSystem.ts:269-276` consumes the raw `input.useQueued` through a cast, competing
  with `InteractionSystem` (`interaction.ts:106-109`) which drains the same flag. Two
  owners of one input edge.

### 1.3 The recipe for Mars Park

Create `src/player/vehicleSeatRig.ts` — do not extend `playerSystem.ts`.

Fields are the obvious ones (`vehicle`, `phase`, `blend`, `localEye`, `baseYaw`,
`fromPosition`, `fromQuaternion`, `eyeWorld`, `targetQuaternion`, a scratch `Object3D`,
`exitTarget`, public `canExit` / `onExited`). `attach()` stores the camera's current pose
as `from*`, zeroes the look offsets, sets `phase='in'; blend=0`, and takes control:
`player.controlEnabled = false`. `attachImmediate()` calls it then forces
`phase='riding'; blend=1`. `requestExit(exit)` no-ops unless `canExit`. The whole method
that matters:

```ts
update(camera: PerspectiveCamera, dt: number): void {
  const vehicle = this.vehicle
  if (!vehicle) return
  vehicle.updateMatrixWorld(true)
  this.eyeWorld.copy(this.localEye)
  vehicle.localToWorld(this.eyeWorld)

  // Seat orientation = vehicle attitude × seat facing × free-look.
  vehicle.getWorldQuaternion(this.targetQuaternion)
  this.scratch.quaternion.copy(this.targetQuaternion)
  this.scratch.rotateY(this.baseYaw + this.lookYaw)
  this.scratch.rotateX(this.lookPitch)
  this.targetQuaternion.copy(this.scratch.quaternion)

  if (this.phase === 'in') {
    this.blend = Math.min(1, this.blend + dt / BLEND_IN)
    const eased = this.blend * this.blend * (3 - 2 * this.blend)
    camera.position.lerpVectors(this.fromPosition, this.eyeWorld, eased)
    camera.quaternion.copy(this.fromQuaternion).slerp(this.targetQuaternion, eased)
    if (this.blend >= 1) this.phase = 'riding'
  } else if (this.phase === 'riding') {
    camera.position.copy(this.eyeWorld)
    camera.quaternion.copy(this.targetQuaternion)
  } else if (this.exitTarget) {
    if (this.blend === 0) {                 // capture the seat pose once, on entry
      this.fromPosition.copy(camera.position)
      this.fromQuaternion.copy(camera.quaternion)
    }
    this.blend = Math.min(1, this.blend + dt / BLEND_OUT)
    const eased = this.blend * this.blend * (3 - 2 * this.blend)
    const standing = this.eyeWorld.set(
      this.exitTarget.x, this.exitTarget.y + 1.55, this.exitTarget.z)  // Mars eye height
    camera.position.lerpVectors(this.fromPosition, standing, eased)
    camera.quaternion.copy(this.fromQuaternion)  // hold orientation, translate only
    if (this.blend >= 1) {
      const exit = this.exitTarget
      const euler = new Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      this.player.setLook(euler.y, euler.x)      // ← §1.4: must exist
      this.player.placeAt(exit.x, exit.y, exit.z)
      this.player.controlEnabled = true
      this.vehicle = null; this.exitTarget = null
      this.onExited?.(); this.onExited = null
    }
  }
}
```

Constants: `BLEND_IN = 1.2`, `BLEND_OUT = 0.9`, `LOOK_SENSITIVITY = 0.0023`,
`PITCH_LIMIT = Math.PI * 0.42`. The `mousemove` listener accumulates `lookYaw/lookPitch`
only when `document.pointerLockElement` is set and `phase !== 'out'`.

Note the exit blend **holds orientation and only translates** (`vehicleSeat.ts:124`). It
reads as "standing up and stepping out", not as a camera slew.

### 1.4 Required `PlayerSystem` surface (Mars Park is missing all three)

SeaPark's player exposes exactly what rigs need and nothing more:

- `controlEnabled` — "an external system is driving the camera" (`player/player.ts:37-38`).
- `inputFrozen` — a *separate* modal freeze, deliberately not the same flag
  (`player/player.ts:40-46`): the pause card and rides own `controlEnabled`, so layering
  a second owner on it strands control when a pause captures a borrowed value.
- `setLook(yaw, pitch)` (`player/player.ts:222-226`) and `placeAt(x, y, z, yaw?)`
  (`player/player.ts:229-238`), where `placeAt` also clears in-flight jump state and
  re-arms snap-to-ground so the guest "arrives settled".
- `player.update()` early-returns when `!controlEnabled` (`player/player.ts:209`) — the
  rig is the sole camera writer during a ride. Mars Park's `playerSystem.update()`
  unconditionally writes `ctx.camera` at `:241-242`, so any rig would fight it.

Add all of these before touching the tram.

### 1.5 Tram boarding / alighting / arrival — the concrete plan

| Beat | SeaPark precedent | Mars Park action |
|---|---|---|
| Opening shot | Bell opens with the guest **standing on the deck**, free to linger; nothing moves until they press E (`descentBell.ts:466-471`) | Keep the seated-in-the-dark opening (it is canon) but use `rig.attachImmediate(car.group, seatEye, 0)` so frame 1 is authored, not a spawn-pose lerp |
| Departure delay | `DOCK_DELAY = 2.4 s` between boarding and motion (`descentBell.ts:44`, applied `:496-504`) | Tram already has `DWELL_SECONDS`; add a 2.0–2.5 s hold after `board()` before the doors close, so the blend-in completes *before* the car moves |
| Travel ease | `travel` integrates linearly then is smoothstepped for the actual position (`descentBell.ts:508-511`) — constant-rate clock, eased motion | The tram's `sqrt(2·a·s)` brake (`tramSystem.ts:229`) is good physics; keep it, but land it exactly (see next row) |
| Exact landings | The wheel clamps the integration step so the rotor halts precisely on the dock angle with speed hard-zeroed, because "detect-then-ease" overshot by 0.7 m (`greatWheel.ts:626-645`) | `tramSystem.ts:232` uses `distance < 0.25 && speed < 0.3` then snaps `loopS = stopS` — that IS a visible snap of up to 25 cm. Clamp the step instead: `if (step >= distance) { step = distance; speed = 0; … }` |
| Door → exit gating | `canExit` true only while docked (`descentBell.ts:456`, `:463`) | Gate on `phase === 'dwell' && doorOpen > 0.9`, and register the exit as a normal `Interactable` with a `label()` that returns `''` when not permitted — never poll `input.useQueued` directly |
| Refusal | `interaction.notice('Settle on the seabed or a solid floor to step out')` — a transient caption in the same voice, no key chip (`submarine.ts:396`, impl `interact.ts:48-60`) | Add `notice()` to `InteractionSystem`; use it for "wait for the doors" instead of the silent `alightQueued` toggle at `tramSystem.ts:274` |
| Exclusive focus | While piloting, `interaction.exclusive = exitInteractable` mutes every other prompt in the park (`submarine.ts:357`, `interact.ts:28-34`, cleared `:429`) | Set `exclusive` while riding the tram — otherwise station benches and doors will fire from an E meant for the tram |
| Long transitions | Teleport dissolves through an opaque DOM overlay: 0.55 s out / 0.5 s hold / 0.75 s in, with the camera cut performed under full cover (`teleport.ts:15-17`, `:118-149`) | Use this exact envelope for anything that cannot be blended in-world (e.g. a future fast-travel). Do **not** use it for the tram — the tram must stay one unbroken shot |

**Chase-camera craft, if the tram ever gets an exterior view** (`submarine.ts:114-134`,
`:833-855`): position/look are separate exponential eases (`CAM_POS_RESPONSE = 5.5`,
`CAM_LOOK_RESPONSE = 8.5`), and vertical follow is deliberately much slower
(`CAM_HEIGHT_RESPONSE = 0.45`) with a catch-up ramp — because if the eye follows the
vehicle's vertical motion 1:1, on screen the vehicle sits still and the *world* appears
to move (`submarine.ts:124-129`). Also: use `Matrix4.lookAt` + `setFromRotationMatrix`
for blend targets, not `Object3D.lookAt` — the latter aims +z and will slew the blend
exactly backwards (`submarine.ts:823-825`).

**Input during a blend**: SeaPark captures steering keys during `'entering'` so a held W
engages the instant the helm goes live (`submarine.ts:313-319`). Mirror this for any
tram controls.

---

## 2. Presentation density — why SeaPark is not empty

### 2.1 The dressing categories SeaPark deploys

1. **Structural repetition** — colonnades, arches, cornices at fixed spacing
   (`parkAssembly.ts:118-130`: 18 columns + 14 arches for one boulevard).
2. **A per-district detail pass.** `parkFacilities.ts` exports `detailEsplanade`,
   `detailMidway`, `detailCafe`, `detailObservatory`, `detailOverlook`,
   `detailTidalCourt`, `detailAtrium` — each takes `{ kit, writer, materials, physics }`
   (`parkFacilities.ts:19-24`) and adds 17–64 discrete placements. Midway alone gets 12
   arches, 12 cornices, and 5 game counters × 8 parts (`parkFacilities.ts:92-152`).
   **This is the single highest-leverage missing thing in Mars Park.**
3. **Amenity march** — benches and lamps at authored intervals along every path.
4. **Signage** as a data-driven system (§2.2).
5. **Light fixtures that emit light** — `PointLight(0xffd9a0, 5.5, 12, 1.8)` attached to
   lamp globes (`parkAssembly.ts:81-89`, `descentBell.ts:141-143`). SeaPark has 9
   `new PointLight` sites. **Mars Park has zero.**
6. **Ambient motion** — silk banners swaying in the vertex stage
   (`parkAssembly.ts:144-221`), 12 catenary festoon wires + 72 instanced bulbs
   (`parkAssembly.ts:347-386`), a rippling reflecting pool (`parkAssembly.ts:278-302`).
7. **Ambient life** — 400 jellies + 44 butterflies as single instanced draws with 100 %
   vertex-shader motion and zero per-frame CPU (`wildlife/ambientLife.ts:706-779`,
   `:787-864`); low-count heroes as rigs on CPU splines with a cluster distance gate at
   120 m (`ambientLife.ts:905-907`).
8. **Timed shows** — a pure `cue(time)` function with six named sections and a 6 s glide
   back to idle, never a hard cut (`shows/bubbleFountain.ts:828-918`, `:206-225`); the
   idle state is never dead (`:807-820`).
9. **Diegetic information** — two mechanical timetable boards, flip-staggered 0.55 s
   apart so the texture re-uploads don't stack on one frame
   (`shows/scheduleBoard.ts:68-74`, `:117-194`). No HUD.
10. **Narrative micro-dressing** — a coiled mooring line laid on the planks "that says a
    crew was just here" (`world/arrival.ts:553-565`); mooring wraps still hitched round
    the bollards (`:546-551`); a compass rose inlaid in the bell floor because it is
    "the detail a seated guest looks straight down at through the whole descent"
    (`descentBell.ts:285-303`).

### 2.2 The signage system

`world/facilitySigns.ts` — 16 signs, **4 draw calls total**:

- Data lives in the layout file. `FacilityEntranceSign = { id, title, subtitle?, x, z,
  approachX, approachZ }` (`world/parkLayout.ts:77-86`), with coordinates expressed
  relative to `PARK_PLAN` anchors so moving a district moves its sign
  (`parkLayout.ts:104-108`).
- `approachX/approachZ` is the *facing authority*: `init()` throws if any sign's facing
  dot is below 0.999999 (`facilitySigns.ts:106-109`). It is also the teleport spawn ray
  (`teleport.ts:78-94`).
- Text is a 2D-canvas **atlas** (256×128 per tile in a 4×N grid,
  `facilitySigns.ts:25-32`, `:230-272`), with `fitFont()` auto-shrinking to 10 px so long
  names never overflow (`:274-290`). All faces merge into ONE `PlaneGeometry` with
  per-sign UV remapping (`:200-228`).
- Label material is `MeshBasicNodeMaterial` with `toneMapped = false`
  (`facilitySigns.ts:96-98`) — lighting- and tonemap-independent, always readable.
- Sign anatomy is 15 parts: twin posts, foot collar, brass finials, header rail, board,
  a four-bar brass picture-frame, a half-torus crown with springing balls
  (`facilitySigns.ts:162-193`).
- An audit enforces uniqueness, atlas fit, "rooted and crowned" bounds, and **≥ 0.35 m
  clearance from every walking lane** (`facilitySigns.ts:334-381`).

Mars Park's `signageMaterial()` (`materials/library.ts:138-181`) already rasterizes text
per sign — but it allocates a fresh 1024-wide canvas + `CanvasTexture` + material per
call, and signs are one-off `Mesh` + `PlaneGeometry` glued on at
`districts/leisure.ts:93-111` and `tramSystem.ts:376-386`. Convert to the atlas pattern,
declare the roster in `parkPlan.ts`, and add the clearance audit.

### 2.3 Scatter that reads as designed

`world/reefPatches.ts` is a pure deterministic **layout oracle** — it instances nothing;
flora and wildlife each call `computeSeabedColonies(ctx.rng)` and get the identical world
because fork sequences depend only on seed + label (`reefPatches.ts:1-20`). Two mechanisms
worth stealing wholesale:

- **One signed-distance keepout field** shared by scatter, signage clearance and future
  navigation: `parkFootprintSignedDistance` over 15 discs plus capsules auto-expanded
  from every path at `width/2 + 1.5` (`world/parkPlan.ts:50-76`, `:20-47`). Mars Park's
  equivalent is four hardcoded circles in `parkAmenities.ts:13-18`.
- **A verge sampler with squared lateral falloff**: `sampleParkVergePoint(rng, min, max)`
  picks a path/keepout edge weighted by length, then `lateral = min + (max-min)·rng²`,
  biasing planting hard against the curb (`reefPatches.ts:228-263`). 25 % of the 15 000
  algae instances are reserved for verges (`world/flora.ts:393-397`). The stated reason
  is the whole density doctrine: *"a guest standing anywhere in the park should see life
  within arm's reach, so close-in patches and verge planting matter more than far
  wilderness"* (`reefPatches.ts:15-20`).
- Field scatter is a Neyman–Scott cluster process — each accepted parent seeds 1–3
  children within 0.5–1.9 m, gated by a clump field: "multi-scale patchiness, never
  uniform sprinkle" (`flora.ts:325-390`). Mars Park's amenities are a uniform march at
  34 m / 27 m / 61 m (`parkAmenities.ts:31`, `:56`, `:76`), which is exactly the read of
  "sprinkled", not "designed".

### 2.4 Density target

Worked count for one SeaPark boulevard (`parkAssembly.ts:114-221` + `parkFacilities.ts:48`):
18 columns, 14 arches, 8 lamps, 4 benches, 14 cornices, 4 urns, 10 banners + 10 rods +
10 balls ≈ **92 placements**, each a 10–31 part module → on the order of 1 000 authored
primitives, compiled into ~12 merged slot draws + 7 instanced amenity draws.

Mars Park's biggest district file makes 32 writer calls total
(`world/districts/residential.ts`). The gap is roughly 3× at the placement level and
~10× at the primitive level.

---

## 3. Render pipeline + lighting

Our `render/pipeline.ts` is a faithful port of SeaPark's AO stage — the GTAO bilateral
reconstruction, the footprint fade, the reversed-z guards are all present and in places
*better* (mars `:115` guards both depth ends; sea `:150` guards only one). What is
missing is everything downstream and around it.

| Capability | SeaPark | Mars Park | Verdict |
|---|---|---|---|
| Scene MRT + MSAA 4× | `pipeline.ts:109-113` | `pipeline.ts:84-87` | parity |
| GTAO + 8-tap bilateral | `:120-186` | `:94-151` | parity |
| AO reliability fades | `:196-213` | `:159-169` | parity |
| `hdrTransform` hook | `:215-218` | `:172-175` | parity |
| **`lensTransform` hook** | `:93`, `:219` | absent | **missing** |
| **Auto exposure meter** | `ExposureMeter` at `:222`, `:257-258`, tapped at zero weight `:299` | fixed EV only (`grade.ts:19-23`) | **missing** |
| Bloom | `bloom(withLens, 0.35, 0.55, 1.0)` `:220` | `bloom(withMedium, 0.16, 0.35, 1.6)` `:180` | ours is far more conservative — correct given no HDR sources exist yet, wrong once fixtures land |
| `?pass=` isolation views | 20 named taps `:230-300` | 8 taps `:188-224` | thin |
| Debug pane bindings | exposure / lut / vignette live `:367-376` | absent | missing |
| Async pipeline warmup | `compileAsync()` `:326-354` **plus** `warmupRenderer` drawing every mesh behind the ticket (`main.ts:263-289`) and `releaseStaticGeometryArrays` freeing CPU copies (`main.ts:279-287`) | `compileAsync()` only, plus 3 hand-posed sneak renders (`main.ts:158-171`) | **weak** — three poses cannot cover every material |

### 3.1 Lighting is the biggest single gap

- SeaPark: 9 `PointLight` sites, 16 `emissiveNode` materials.
- Mars Park: **0 `PointLight`**, 3 `emissiveNode` materials (`materials/library.ts:254`
  grow bar ×2.6, `:342` running light ×3.2, `dome/glassShell.ts:128`).

A park lit only by one `DirectionalLight` (`sky/skySystem.ts:21`) cannot read as
inhabited. Every lamp post placed by `parkAmenities.ts:67` is currently a dead prop.
SeaPark's pattern, adapted:

```ts
// world/parkAmenities.ts — lamp placement gains a real fixture
const globeY = spot.y + 3.05
lampPost(writer, spot)
const globe = new Mesh(lampGlobeGeometry, kitMaterials().lampGlobe)  // emissive material
globe.position.set(spot.x, globeY, spot.z)
services.group.add(globe)
if (lit) {                      // only every Nth lamp carries a real light
  const light = new PointLight(0xffd9a0, 5.5, 12, 1.8)
  light.position.set(spot.x, globeY, spot.z)
  services.group.add(light)
}
```

Two disciplines from SeaPark that must come with it:

1. **Not every fixture gets a `PointLight`.** `parkAssembly.ts:81-89` takes a `lit`
   boolean; most lamps are emissive geometry only, and lights are placed at gateways and
   plaza corners (`:317`, `:330-331`, `:410-411`, `:447-448`).
2. **Never toggle a Light's `visible`.** Drive intensity to zero instead — toggling
   visibility changes the `LightsNode` cache key and synchronously rebuilds every lit
   WGSL program in the park (`shows/bubbleFountain.ts:233-238`). This is a hard-won
   lesson; obey it.

Also add the `lampGlobe` material itself — SeaPark's is not flat emissive paint but a
faint fbm mantle mottle at unchanged mean intensity so the HDR hierarchy stays calibrated
(`materials/library.ts:215-222`). With real emissives present, re-tune our bloom
threshold from 0.16 upward.

### 3.2 `lensDrips` and why it matters here

`render/lensDrips.ts:188-263` is a screen-space water film on the lens, armed only when
the camera breaks the surface, running in HDR *before* bloom via the `lensTransform`
hook. Two transferable techniques:

- **Coherent branch for cost**: the whole effect sits inside
  `If(washWeight.greaterThan(0.001), …)` (`lensDrips.ts:223`), so once the 5 s wash
  completes every stochastic sample vanishes from the workload.
- **Mask the resample**: only the droplet bodies and trails resample the scene; the
  surrounding frame keeps its existing warmth, sharpness and vignette
  (`lensDrips.ts:248-251`).

Mars Park's direct analogue is **dust on the visor / dome-glass grime**, and the tram
window when the car passes through the portal iris. Port the hook (`pipeline.ts:93`,
`:219`) even before the effect exists — it costs nothing and it is where any lens
treatment belongs.

### 3.3 Grade

Both grades bake a 32³ LUT on the CPU and apply a vignette outside it
(sea `grade.ts:33-45`, mars `grade.ts:28-40`). Ours is arguably better authored —
warm shadow lift, green-dominance vibrance protection for the rare vegetation
(`grade.ts:82-95`). The difference is that SeaPark's exposure is metered, not fixed
(`pipeline.ts:222-225`), and its three grade knobs are live in a debug pane
(`pipeline.ts:367-376`). Keep the fixed EV (a frozen afternoon is canon) but expose the
knobs.

---

## 4. Materials

SeaPark's authoring doctrine is stated at `materials/library.ts:47-57`:

> every channel of a material derives from the SAME few causal fields — never one noise
> per channel — and fine microstructure fades with camera distance before it can alias
> into shimmer.

Concretely:

- **One or two named causes per material**, reused across colour, roughness and
  metalness. Brass: `hammer` sets tone *and* roughness streaks, `tarnish` darkens colour
  *and* roughens the film (`:94-115`). Verdigris: a single `patina` selects the
  copper→green identity, raises roughness *and* drops metalness where oxide took
  (`:120-138`). Marble: one `warp` field carves both vein families, the undertone drift
  and the polish variation (`:144-161`).
- **`detailKeep(far)`** — a shared microstructure fade, `1 - smoothstep(far*0.45, far,
  viewDistance)` (`:84-86`), applied per-material with an authored range: brass streaks
  28 m, iron scale 24 m, nacre ripple 16 m, wood fine grain 14 m, canvas weave 12 m,
  rope lay 10 m.
- **Pixel-footprint retirement for anything gridded.** The mosaic retires its grout,
  tesserae and bevel by `fwidth(cell)` in *tile units*, not by distance — because at
  grazing incidence the footprint grows as distance²/eye-height while distance grows
  linearly, so a distance fade leaves dozens of tiles inside one pixel out along the
  esplanade (`:236-315`, esp. the essay at `:224-235` and `:294-305`). The grout's
  filtered branch is the exact running-integral average, so it converges on its own with
  no separate fade and no mean constant (`:253-266`).
- **Grazing-angle sheen** as a shared idiom: `grazing = 1 - |dot(viewDir, normalWorld)|`
  (`:88`), lifted into brass rim (`:107`), iron (`:200`), lacquer (`:388`), foliage
  (`:355`).
- **Emissive hierarchy is explicit and scene-relative.** Lamp globe ×2.6 (`:220`),
  foliage sub-glow ×0.004–0.012 (`:358`) — a deliberate three-orders-of-magnitude spread
  so bloom can threshold meaningfully.
- **Palette discipline**: 15 named materials, all shared, all created once
  (`:58-73`). Ride vehicles use `lacquer` + `leather` + `brass`; nothing invents a
  one-off colour.

Mars Park's library (`materials/library.ts`) is honest NASA-punk and has one thing
SeaPark lacks — `applySpecularAA()` (`:27-34`), which is genuinely good and should stay.
But its materials are **one `worldNoise` per material, used once**, at
`vec2(positionWorld.xz)` only (`:36-39`). Nothing derives roughness from the same cause
as colour; nothing fades with distance; nothing uses `fwidth`. Concretely to fix:

1. Add a shared `detailKeep(far)` helper and a `grazing` node next to `applySpecularAA`.
2. Give every material two named causes (e.g. `paintedSteel`: `patina` + `panelSeam`;
   `castMineral`: `pour` + `aggregate`) and derive colour, roughness and metalness from
   both.
3. `deckPlate` (`:105-116`) computes a stripe from `positionWorld.x*6.5 + z*6.5` — a
   diagonal grid with no footprint retirement. It will alias at range. Convert to the
   mosaic's `fwidth` band pattern.
4. Add a `lampGlobe` material with an fbm mantle, and a `duskGlow`/`signLit` tier, so the
   emissive hierarchy has more than two rungs.
5. `worldNoise` sampling only `xz` means vertical surfaces get a smeared vertical
   streak. SeaPark always mixes `positionWorld.y` in (`:98`, `:171`, `:195`).

---

## 5. Hero vehicle modeling — the `submarineModel.ts` method

1 935 lines, ~70 meshes, one hero object. The tram rebuild should imitate its *method*,
not its style.

### 5.1 Shape of the file

```
:99    deterministic seed
:111   design contract (metres) — `D`, frozen `as const`, "+Z is forward. One object = one role."
:144   palette — 9 named colors
:157   small math helpers (splinePts, smooth01, parallel-transport frames)
:207   GEOMETRY KIT — "Triangle emission is the last step; everything is a sampled plan."
:435   DETAIL ATLAS — 2048×1024, R = window cut-out · G = gold-leaf mask · B = grime/AO
:708   MATERIAL BUNDLES
:891   ASSEMBLY
```

Assembly is **region-by-region, and within each region shell → trim → hardware → lamp** —
never a global "greeble pass at the end":

```
:916  hull spine & radius laws, sampled once      :1278 DOME, CAGE & CABIN
:1000 hull skin                                    :1282   glass cap
:1014 brass collar + glazing bead                  :1296   armillary cage inside the glass
:1024 side windows: frame + bulged glazing         :1351   crown lantern
:1087 flank spears                                 :1391 CABIN
:1137 belly step with rails & S-brackets           :1398   walnut deck with brass nosing
:1179 under-nose lamp                              :1432   quilted salon chair
:1203 top handle pipe + escutcheons + vent dome    :1476   helm: wheel, column, gauges, lever
:1258 collar rivets (30, instanced)                :1586   cabin point light
                                                   :1593 STERN  :1809 FINS with lamp pods
```

Line budget: ~10 % base shell, **~35 % hardware/trim/greebles**, ~19 % interior,
~20 % stern machinery.

### 5.2 The techniques that prevent coplanar / gap / overlap defects

This is the part that matters most for our CLAUDE.md rules.

1. **Build one queryable analytic surface first, then place everything on it.**
   `hullSample(u, t) → { p, n }` central-differences the parametric hull and crosses to
   get an outward normal (`submarineModel.ts:991-998`). Every bolt-on is
   `p.addScaledVector(n, ±ε)`. The sign is the entire grammar:
   - `+0.01` window frame bead stands proud (`:1054`); `+0.006` hairline echo (`:1061`);
     `+0.034` spear rod floats clear (`:1093`).
   - `−0.005` saddle-mount foot sunk in (`:1127`); `−0.01` bracket root (`:1169`);
     `−0.02` grab-handle ends buried (`:1214`); `−0.004` escutcheon seated below skin
     (`:1239`).

   Positive ε ⇒ no two faces are ever coplanar. Negative ε ⇒ no gap at a joint and no
   coincident face.
2. **Cap every buried foot with a lathed flange.** The escutcheon at `:1228-1241` is what
   makes the −0.004 sink invisible. Bury + cap is the standard joint.
3. **Solve terminations analytically, then flare onto the host.** The dome cap sweeps to
   exactly the collar plane, `thMax = acos(-planeOffset/domeR)` (`:1284`); each cage rib
   solves where its own great arc crosses the tilted plane (`:1312-1316`) and then
   flares its radius over the last 14 % to land *on* the collar tube:
   `rr = lerp(rC, 0.972, smooth01((s-0.86)/0.14))  // flare tip onto collar tube` (`:1322`).
   The junction becomes a tangency, not an intersection.
4. **Oversize joint collars by an explicit delta** so the seam is *inside* the tube:
   collar at `hull.tailR + 0.006`, tip collar at `tipR + 0.012` (`:1615-1620`); prop halo
   at `prop.r + 0.012` (`:1727`).
5. **Rotate seams somewhere unseen**: `const a = (i/secN)*TAU + Math.PI*0.75  // seam
   tucked inner-rear` (`:1629`); lathe `u=0` parked at the belly (`:315`).
6. **Never author a zero radius.** Profiles end at `0.0015`, and the lathe clamps
   `Math.max(p.x, 0.0015)` (`:318`) — a tip is a tiny disc, never a zero-area fan.
7. **One `flip` flag negates normals AND reverses winding together** (`:261`, `:277-281`)
   — you cannot produce half-inverted geometry. Directly relevant: our own
   `PartWriter.tube` shipped inside-out for seven stages (see `dev_docs/notes.md`, S14).
8. **Cut apertures with alpha-test from the same UV shape that painted the ornament**
   (`:761-762` ↔ `:139` ↔ `:1025-1044`), then bead the cut edge so the alpha stair-step
   is hidden (`:1052-1064`).
9. **Paint ornament, sculpt structure.** 187 lines of canvas 2D (`:442-628`) replace
   hundreds of tiny swept tubes.
10. **Ground contact is a sink, not a rest.** `SUBMARINE_REST_HEIGHT` is chosen so the
    belly step sinks a few millimetres into the sand (`:76-78`) — a visible gap at the
    contact point is the defect.

### 5.3 Interior authoring and camera-inside

The cabin lives in the **same local space** as the hull — no nested interior shell
(`:1394-1395`). The critical trick: there is **no `FrontSide`/`BackSide` anywhere** in
the model. The hull is `DoubleSide` and every PBR channel is a `select(frontFacing, …)`
branch (`:750-758`):

```ts
hull.side = DoubleSide
hull.colorNode     = select(frontFacing, exteriorColor, color(PAL.interiorDark))
hull.metalnessNode = select(frontFacing, goldMask.mul(0.95), float(0))
hull.roughnessNode = select(frontFacing, exteriorRough, float(0.85))
```

One mesh is both the exterior skin and the cabin lining. Compare
`descentBell.ts:158-166`, which takes the opposite route for a *decorative* glass shell
(clone the shared glass, force `FrontSide`) because DoubleSide backfaces laid "a pale
camera-centred bubble" over the passenger view. **Rule: opaque hull → DoubleSide +
frontFacing branch; enclosing glass → FrontSide clone.**

Our tram car (`tram/vehicle.ts`) is 239 lines of axis-aligned `writer.box` calls with a
real window aperture pattern — the aperture idea is right, the execution is a crate.
Rebuild against §5.2: a lofted body-side profile, a real cant rail and skirt, corner
radii, door pockets with visible tracks, grab poles landing in ceiling escutcheons,
seat frames rather than three stacked boxes, destination blind, and a lit interior.

### 5.4 Materials / instancing on a hero model

- One shared record of 13 slots built once, referenced directly; no per-part clones
  (`:711-725`, `:727-879`). Parameterised factories (`brassOf(rough, cc)`, `:777-789`)
  instead of cloning.
- Noise samples **geometry space, not world space**: "the vehicle moves, so worldspace
  patterns would crawl across the hull under way" (`:734-736`). Our `worldNoise()`
  (`materials/library.ts:36-39`) is world-space — a tram built from `kitMaterials()`
  will have its texture swim as it moves. **Needs a vehicle-local variant.**
- `InstancedMesh` used exactly once, for 30 collar rivets (`:1259-1276`). Geometry is
  *shared* where cheap (one blade geometry across 8 meshes, `:1721-1726`). No merging —
  deliberately, because mirrored `scale.x = -1` fins would need manual index flips.
- Motion-fake objects are **siblings, not children** of what they fake: the propeller
  blur disc is not parented to the spinning group, or the pattern would spin at shaft
  rate and strobe exactly like the blades it replaces (`:1748-1754`).
- `dispose()` collects geometries into a `Set` (dedupes shared geometry) and tracks
  `ownedTextures` passed *into* the material builder so clones register themselves
  (`:1916-1933`).

---

## 6. Audio

Mars Park's engine (`audio/engine.ts`) already has zone crossfades, a per-zone master
lowpass (`:362-366`), surface-classified footsteps (`:258-281`), positional servo and
tram sources, and hiss beds. That is a genuinely good spine. What SeaPark adds:

1. **The master envelope matches the visual reveal.** The AudioContext starts on the
   click gesture but master gain ramps over exactly `revealSeconds`, so sound and image
   arrive together instead of audio slamming in under an almost-opaque ticket
   (`audio/engine.ts:178-186`; the value is threaded from `main.ts:337`). Ours jumps to
   0.72 instantly (`:64`).
2. **Every machine has a voice keyed to an event, with hysteresis at the source.** The
   submarine emits `vehicle/submarine-running` only on spin thresholds (start > 1.2,
   stop < 0.6) and re-emits when the spin fraction moves > 0.015
   (`vehicles/submarine.ts:643-655`). The engine then sweeps *every* pitched element
   toward the shaft rate so spin-up rises and coast-down audibly winds down
   (`audio/engine.ts:566-580`).
3. **Loudness and start/stop envelopes never share an AudioParam.** A dedicated `level`
   gain carries spin; the `gain` node carries the fade. "Steps are clicks"
   (`audio/engine.ts:522-526`).
4. **Stops re-anchor before ramping.** `cancelScheduledValues(now)` →
   `setValueAtTime(gain.value, now)` → `setTargetAtTime(0.0001, now, tail)`, and sources
   stop only after the envelope is inaudible — a bare ramp measures from the last
   *scheduled* event and puts a step discontinuity right at the stop moment
   (`audio/engine.ts:480-497`). Our `doorChime` and hiss beds set `.value` directly every
   frame (`:420-431`), which is a zipper source.
5. **Asymmetric show fades**: the fountain bus ramps in with a 1.8 s time constant and
   out with 0.8 s (`audio/engine.ts:290-299`) — music swells in, ducks out faster.
6. **A medium filter per source, not only on the master.** The submarine hum has its own
   lowpass swept 260 Hz ↔ 2400 Hz by the waterline crossing (`:16-17`, `:115-121`). Mars
   analogue: the tram's rail-sing should have its own filter for tube vs. dome, separate
   from the zone master.
7. **Distance mixing with a per-source filter**, not just a panner: the carousel waltz
   gains `min(0.55, 36/max(9, d²))` and its filter sweeps `max(700, 7000 - d*55)`
   (`:277-285`).
8. **Sound arrives before sight.** The whale sings twelve seconds before it appears
   (`:330-377`). Mars analogue: the tram should be audible approaching a station well
   before it is visible around the loop.
9. **Typed events, not casts.** SeaPark's audio subscribes to `ride/*`, `vehicle/*`,
   `schedule/*` on a typed bus. Ours reaches into systems through
   `as unknown as { robots: … }` (`:127`, `:391-395`, `:410-413`) — three private-state
   casts that will silently break. Replace with events on `GameEvents`.

---

## 7. Assembly architecture

SeaPark and Mars Park have converged on the same *shape* — a services object threaded
through district builders, one merged writer, colliders collected and created in bulk.
Ours is arguably cleaner (`world/parkAssembly.ts:45-113`: one `PartWriter`, one fixed
body, seats and interactables registered in a loop). The differences that matter:

- **SeaPark's services carry live systems**, not just buffers:
  `DistrictServices { physics, materials, amenities, interaction? }`
  (`main.ts:153`, `:163`). `amenities.addBenchFacing(x, y, z, targetX, targetZ)` is a
  *service call* that writes into per-material `InstancedMesh` slots
  (`world/parkAmenities.ts:76`, `:126-134`), so bench wood/iron/brass can never drift
  apart and the whole park costs 3 + 4 = 7 draw calls of amenities.
- **Facing is declared by target and asserted.** `addBenchFacing` computes yaw toward a
  point and throws if the resulting facing dot is below 0.999999
  (`parkAmenities.ts:85-87`). You cannot author a bench facing the wrong way. Same
  pattern for signs (`facilitySigns.ts:106-109`).
- **Hard capacity caps that throw**: `BENCH_CAPACITY = 24`, `LAMP_CAPACITY = 64`
  (`parkAmenities.ts:22-23`, `:83`, `:95`).
- **A `detailX(ctx, floorY)` pass per district**, separate from the shell
  (`parkFacilities.ts`). Every comment in that file records *the bug it fixes* — floating
  pearls, culled backfaces on an open ribbon, planters threaded through fence posts
  (`:70-89`, `:154-188`, `:327-341`). That is why the dressing reads designed.
- **Bookmarks are registered by the systems that own the geometry**, not tabulated
  centrally: 56 `registerBookmark` sites across SeaPark (`arrival.ts:647-664`,
  `parkAssembly.ts:456-479`, `greatWheel.ts:475-486`, …), audited against a 10-postcard
  contract at boot (`core/postcards.ts`, `main.ts:234-238`). Mars Park has **zero**
  registration sites — all 12 bookmarks are a hand-maintained table in
  `core/postcards.ts:16-51` with an "OVERHAUL NOTE: these are rough first passes"
  admission at `:14-15`. Port `registerBookmark` and let each district own its framing.
- **Colliders are authored beside the geometry that needs them**, at real thickness —
  e.g. a lamp post gets `physics.addStaticBox(x, y+1.7, z, 0.12, 1.7, 0.12)` right at the
  placement (`parkAssembly.ts:83`). Ours does this correctly already.

---

## 8. What Mars Park must change — prioritized

**P0 — the transitions the owner named**

1. Fix the dead blend-out. `playerSystem.ts:229` never runs on exit because
   `standAt`/`stand` null the pose in the same call. Extract camera handoff into a
   `VehicleSeatRig` (§1.3) and add `controlEnabled`, `inputFrozen`, `setLook`,
   `placeAt` to `PlayerSystem` (§1.4). Make `PlayerSystem.update` early-return when a rig
   owns the camera.
2. Rebuild tram boarding/alighting on the rig: `attachImmediate` for the opening,
   2.4 s dock delay before departure, `canExit` gated on `doorOpen > 0.9`, an
   `Interactable`-driven exit (not `input.useQueued` at `tramSystem.ts:269-276`), and
   `interaction.exclusive` while riding.
3. Kill the 25 cm station snap — clamp the integration step to land exactly
   (`greatWheel.ts:626-645` pattern) instead of `tramSystem.ts:232`'s threshold test.
4. Add `InteractionSystem.notice()` (`interact.ts:48-60`) and use it for every refused
   action.

**P1 — why it reads empty**

5. **Put lights in the light fixtures.** Zero `PointLight` in the entire project. Add the
   `lit` lamp pattern (§3.1) plus an emissive `lampGlobe` material, and never toggle a
   light's `visible`.
6. Write a `detailX()` dressing pass per district (`parkFacilities.ts` shape) targeting
   ~60–90 placements per district. Nothing else moves the needle as far.
7. Replace the uniform 34/27/61 m amenity march (`parkAmenities.ts:31,56,76`) with a
   verge sampler using `rng²` lateral falloff and one shared signed-distance keepout
   field derived from `PATHS` (§2.3).
8. Add ambient motion. Today there is none in the park proper: no banners, no festoons,
   no flags, no water. Port the vertex-shader banner (`parkAssembly.ts:144-221`) as dome
   pennants / farmside row markers, and the catenary festoon
   (`parkAssembly.ts:347-386`) for the plaza.
9. Make signage a system: roster in `parkPlan.ts`, one canvas atlas, one merged mesh,
   `toneMapped = false` labels, `approach` point as facing authority, path-clearance
   audit (§2.2).
10. Add a timed show + a diegetic board. The tram already emits `tram/docked`; a station
    timetable board with a live countdown (`scheduleBoard.ts:204-242`) is cheap and
    instantly reads as an operating place.

**P2 — image quality**

11. Add the `lensTransform` hook to `pipeline.ts` (one field + one call site) and, once
    fixtures exist, re-tune bloom above 0.16 with a real emissive hierarchy.
12. Replace the 3 hand-posed sneak renders (`main.ts:158-171`) with a real
    `warmupRenderer` that draws every registered mesh behind the entry screen, then
    release static CPU geometry arrays (`main.ts:263-289` in SeaPark).
13. Expose exposure / LUT / vignette in the debug pane (`pipeline.ts:367-376`).
14. Widen `?pass=` coverage toward SeaPark's 20 taps.

**P3 — materials and the hero model**

15. Add `detailKeep(far)` and a shared `grazing` node; give every material two named
    causes driving colour + roughness + metalness together; mix `positionWorld.y` into
    every noise (§4).
16. Convert `deckPlate`'s stripe to a `fwidth`-retired band (mosaic pattern,
    `materials/library.ts:236-315`).
17. Add a **vehicle-local** noise helper — `worldNoise()` will swim on a moving tram
    (`submarineModel.ts:734-736`).
18. Rebuild the tram car per §5: analytic body surface first, then `p ± ε·n` for every
    attachment, bury-and-cap joints, oversized collars, seams rotated out of sight, and a
    `DoubleSide` + `select(frontFacing, …)` hull so the exterior skin *is* the cabin
    lining. Budget ~35 % of the file to hardware and trim.

**P4 — plumbing**

19. Register bookmarks from the systems that own the geometry; keep the postcard audit.
20. Replace the three `as unknown as {…}` private-state casts in `audio/engine.ts`
    (`:127`, `:391`, `:410`) with typed `GameEvents`.
21. Match the audio master envelope to the entry-screen fade; re-anchor every gain before
    ramping; give the tram its own medium filter for tube vs. dome.
