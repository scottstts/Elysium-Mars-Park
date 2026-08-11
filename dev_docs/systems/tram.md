# The Loop & arrival (S9, P-wave revised)

- Track: closed 48-point circle r 97, street-running in the boulevard
  channel (clockwise from above: portal → farmside → overlook) + the open
  arrival spur from z 420 in the tube, dead straight on x=0 for z ≥ 121,
  hooking west onto the portal stop. `beamTopY()` is the guideway datum.
- Car placement runs in ONE continuous arc-length domain that crosses the
  spur→loop seam (`carPoint` + a `spurActive` window that self-clears once
  the train passes the seam). Never re-place a car at a phase flip — the
  dock cut this killed is documented in notes.md. `nearestS` refines to
  1 cm (it is a pose-continuity datum). Boot starts at arrivalS =
  half a train length so the rear car never clamps onto the front one.
- Station capture: a stop docks when THIS frame's travel would cross it
  (`distance ≤ speed·dt + 5 mm`) — never an absolute window; the braking
  profile's +0.12 m/s creep floor makes any sub-centimetre absolute gate
  unreachable (the tram orbited forever — experience-audit find).
- Motion: comfort profile (a 1.05, cruise 8, tube 11.5, sqrt-braking),
  22 s dwells, door state machine inside dwell.
- Boarding is E-ONLY, enforced by physics: per-car cabin colliders are
  teleported along every fixed step, and `PlayerSystem.nudgeOutOfBox`
  shoves bystanders clear of a moving car (the KCC never resolves unless
  the player moves). Captions are content-aware: "Board" only when docked
  with doors open; a sticky "Exit" override (InteractionSystem.setOverride)
  while riding at an open door; E is swallowed otherwise so it cannot leak
  to platform interactables through the window. No mid-ride exit queue.
- Seated view: the pose yaw's frame delta is carried into the player yaw
  every frame (head rides a TURNING vehicle); boarding eases yaw/pitch
  toward the seat facing while the 1.2 s blend runs.
- Arrival: the player boots ALREADY SEATED, ~50 s unbroken to the dock.
  Wide-pose sneak renders behind the entry screen precompile the park.
- Iris: six sliding petals in a collar at z 128.4, opened by tram
  proximity on the spur; stays open once on the loop.
- ?view modes: no player — the tram circulates (spurActive off).

---

# Vehicle rebuild — "THE LOOP" car (overhaul W2)

`vehicle.ts` is now assembly only. The car lives in five modules:
`tramShape.ts` (the surface), `tramBody.ts` (exterior), `tramRunning.ts`
(bogies), `tramInterior.ts` (cabin), `tramMaterials.ts`, on a local polygon
kit `tramMesh.ts`. **96 k triangles for the two cars.**

## The one idea the whole model rests on

There is a single analytic body surface, and *everything* is a query against
it: `hullPoint(z, s, inset)` where `s` is a continuous index into a 52-point
closed cross-section and `inset` is metres INTO the skin. Positive inset
buries a part, negative stands it proud.

Consequences worth knowing before editing anything:

- **Applied parts cannot float, gap, or z-fight**, because they are generated
  from the host surface rather than positioned beside it. Every moulding —
  sill trim, door track, livery band, cant gutter, skirt rubbing strip — is
  one `mouldingLoft(zs, [[s, inset], …])` call. Adding a new one is four
  numbers, not a placement problem.
- **The taper is a function, not a mesh.** Nose and tail are lateral pinch +
  vertical squeeze + a height-proportional rearward rake (chin leads, crown
  trails 0.80 m). Because it is applied inside `hullPoint`, decals and
  mouldings in the cone follow it for free.
- **Apertures are cut by omission.** `apertureShell` walks the (station,
  section) grid, skips cells listed in `APERTURES`, and emits a reveal quad
  wherever a kept cell borders a missing one. That is the boolean
  replacement; every hole gets jambs of the real wall thickness, and there is
  no CSG anywhere in the vehicle.
- **The lining is the same shell's inner surface**, so there is no second
  skin to fight with. The roof's inner section is deliberately a *flatter*
  arc than its outer one: the wall thickens from 55 mm at the cant to 250 mm
  over the crown, and that thickness IS the HVAC plenum. No separate ceiling
  panel, no hidden double surface.

## Decisions taken during the build (not recoverable from the code)

- **Section datum.** Local y = 0 is the cabin floor, because `tramSystem`
  places the group at guideway point + 0.62 m. Beam top is therefore y =
  −0.62 and the wear strip y = −0.57; the load tyres are sized so the tread
  sinks 3 mm into it. A visible gap at a contact point is the defect.
- **Rubber-tyred, centre-beam guided.** Two load tyres per bogie on the wear
  strips, four horizontal guide wheels per bogie gripping the beam flanks at
  x = ±0.675. The guide wheels must live between y −0.62 and −1.12 (the beam
  side), which is well below the skirt — so they were first modelled hanging
  on thin arms and read as *table legs*. Fixed with **outside drop plates**
  at x = ±0.95…1.02: the plate clears the beam AND the wheels, is buried in
  the skirt at the top, and the wheels are hung inboard off it on outriggers
  fore and aft of the plate so they stay visible from the platform. Do not
  move the plate inboard; there is no room between the beam and the wheels.
- **Livery break at the sill index.** Everything below the cabin floor line
  is dark underframe, everything above is white body. Before this the break
  sat at the skirt chine and the car read as a white bathtub with no ground.
- **Doors are external sliding leaves in a 52 mm bodyside scallop.** Leaf is
  40 mm thick, finishes 6 mm inside the surrounding skin (a reveal, never
  flush) and clears the recessed pocket wall behind it by 6 mm. The recess is
  a per-index share applied inside `sectionAt`, faired out into the roof so
  the cant does not step. The livery band continues across the leaves at
  exactly the bodyside height, so it lines up closed and visibly breaks open.
- **Quarter-lights into the cone are functional, not styling.** The glazing
  originally stopped at the taper start; from the arrival seat (z = 2.42,
  facing forward) that put a 1.1 m blind wall across the one view the whole
  opening sequence is built around. The side panes now run to |z| = 3.74,
  leaving a ~0.2 m A-pillar before the mask edge. **If the seat or the FOV
  moves, re-check this view before anything else.**
- **The front face is the tip cross-section, split at the beltline.** A mask
  ribbon (wall thickness turned forward), then two `fanRings` fills — glass
  above the split, moulded fascia below — closing on *the same* chord samples
  so the two surfaces weld rather than abut. A transom bar covers the joint.
- **Seats live in `tramSeat.ts` and are the cabin's hero object.** The method,
  and the traps it exists to avoid:
  - ONE analytic contact surface. `contactAt(x, s)` is a (z, y) polyline
    (12 deg recline, lumbar prominence, 4.5 deg pan) SCULPTED ACROSS the bench
    by `dish(x)` — a raised cosine hollowing a bucket behind each place and
    leaving a proud bolster at the divider and both outboard ends. That lateral
    term is what makes the shell compound-curved rather than an extrusion; the
    previous benches were a constant section swept across and read as slabs.
  - The contact curve is the BOLSTER line, not the seating reference point:
    `dish` carves ~21 mm down from it at a seat centre, so the pan is authored
    high. Do not "fix" the pan height by moving `PAN_LINE` without re-checking
    `seatSurfaceY()`, which is what the seat contract now reports.
  - The shell carries real POCKETS (`recessAt`): a 12 mm bezel everywhere, the
    full pad depth inside each pad footprint. Pads sit IN the recess with a
    reveal, which is the single detail that separates a seat from a cushion on
    a board.
  - **A pad's underside is sampled from the SHELL'S OWN discretised surface**
    (`shellFrontAt`, bilinear over the shell's station/profile grid), not from
    the analytic surface. Comparing two different discretisations of one
    surface put 117 triangle crossings into the back cushion; a 36 mm pocket
    ramp cannot be resolved by 50 mm station spacing, and the linear chord
    across it sits well above the true pocket floor. The shell also carries
    explicit stations on both edges of every pocket ramp for the same reason.
  - **A pad's rolled edge bulges past its own footprint** by `PAD_ROLL`, so the
    pad finishes `PAD_MARGIN` (> PAD_ROLL) inside the pocket's flat floor. The
    roll is an ELLIPSE, not a half-round: a half-round of a 55 mm pad bulges
    28 mm and punches the bezel.
  - Piping is a real swept cord around each pad's boundary (same slot, so the
    nesting is free). Pad faces are domed and fall 3 mm BELOW the contact line
    at the seam — a face that stays flat to its roll folds at ~70 deg and reads
    as a slab however good the piping is.
  - Armrests are moulded in one piece with the shell (same slot, they weld);
    their outer face lands 3 mm inside `x = ±BENCH_HALF`, because two flush
    faces there are a coplanar same-facing pair — a z-fight even inside one
    material slot.
  - Mounts: bolted floor track with countersunk bolts, a tapered cast leg and
    a saddle whose top clears the shell by 3 mm (measured against the LOWEST
    point under the plate, since the underside is curved). Everything bolted
    down starts 3 mm above the floor covering; an exact butt between two
    material slots is what makes the audit's clash test ambiguous.
  - Shell is much darker than the moquette on purpose — at similar values the
    whole bench reads as one blob.
- **Cabin lamps (READ THIS).** Two `PointLight`s per car, intensity 3, range
  6.5, no shadows, parented to the car group. Emissive coves read as fixtures
  but illuminate nothing, and the ceiling was a black void from every seated
  view. They sit OUTSIDE `LightFixtureRig` because the rig's group is
  world-space and these must travel with the vehicle — they honour the two
  rig disciplines (never toggled, never shadow-casting) but are not in its
  budget of 8. **Lighting owner: 4 of your 8 real lights are effectively
  spoken for while both cars exist.**
- **Materials are object-space, always.** `positionLocal`, never
  `positionWorld` — the park's shared `kitMaterials()` are all world-space
  and would make the pattern crawl across a moving hull. The tram owns
  `tramMaterials.ts` for this reason alone. Emissive rungs follow
  `world/lightFixtures.ts`: headlamps 5.0, tail 2.6, cabin cove 2.0,
  console screen 1.6.
- **Alloy brush frequency is deliberately low.** A physically fine brush
  direction moirés into stripes on a 12 cm door strip long before it reads as
  metal; 42 cycles/m is the value that survived close inspection.

## Contract

`buildTramCar(options?: { index?: number })` → `{ group, doorsLeft,
doorsRight, seats, triangles }`. `index` defaults to an internal counter so
the two cars get "01" and "02" stencils with no caller change.

- `doorsLeft` has exactly two children, child 0 at negative z; `tramSystem`
  drives their local z to ±0.78. Clear opening 1.76 m × 1.94 m.
- `doorsRight` is an empty Group — the vehicle is single-sided (all three
  stops board from the left). Animating it is a harmless no-op.
- `seats` is 8 poses, ordered front-facing first, outboard first, left first.
  `seats[0]` = front-LEFT window seat, the arrival seat. If a more open
  forward view is wanted for the arrival, `seats[2]` is the front-left aisle
  seat and clears the A-pillar.
  Positions: x = ±0.955 (window) / ±0.485 (aisle), z = ±2.42, **y = 0.451**
  (was 0.456 — `tramSeat.seatSurfaceY()` now MEASURES the finished cushion so
  the pose cannot drift from the geometry; `CABIN.seatY` is only the nominal
  it is designed to hit).
- `triangles` ≈ 84.7 k per car (37.2 k exterior + 47.4 k cabin), inside the
  90 k hero budget. Four benches are 36 k of that.

---

# W2 — PERMANENT WAY: guideway, stations, tube interior

Owner files: `src/tram/track.ts`, `src/world/portalStation.ts`.

## The datum stack (everything below is derived, nothing is typed twice)

```
slabTop(x,z)                       paving.ts — the poured civic floor
− GUIDEWAY_CHANNEL.recess (0.06)   the paving agent's recessed tram channel
= beamTopY(x,z)                    the guide-beam CROWN, street-running
+ RAIL_TOP (0.050)                 the wear-rail head — what the tyres roll on
+ CAR_FLOOR (0.620)                the cabin floor  (tramSystem's contract)
− 0.020                            platform deck (the step a real platform has)
```

`beamTopY` no longer knows about station pads. Inside the channel it IS the
channel floor; outside it (only the arrival spur ever asks) it rides clear of
grade, and the two blend over 2.4 m so a curve sampled across the boundary
cannot kink. Car floor lands at `slabTop + 0.56` all the way round the Loop —
verified by sweeping 360 bearings.

## One cross-section, built three ways

The vehicle decides the section, not the other way round. `tramShape`
/`tramRunning` put two load tyres at x = ±0.42 and four guide wheels gripping
the beam FLANKS at x = ±0.675, 0.18–0.28 m below the running surface. So:

- **Street-running** (the whole Loop, and the spur inboard of the promenade):
  the beam is SUNK. Its crown is flush in the paving and a 0.28 m guide groove
  either side exposes the flanks, so the same guide wheels work with nothing
  standing above the floor. Trackbed apron 18 mm over the channel floor and
  42 mm under the boulevard paving — nothing is ever coplanar with the pour.
- **Elevated** (spur, z ≈ 116 → the portal): the same crown on a haunched box
  girder, on lofted piers with a bedding plate and an elastomeric pad. Where
  the clearance is too small for a pier the section grows a `root` and becomes
  a plinth wall instead of hovering.
- **Tube** (z 129.9 → 426): the girder cast monolithically into a full-width
  deck whose edges tuck against the lining behind a 20 mm drainage reveal.

The three runs meet at 20 mm movement joints — opposed capped faces, which is
a real structural joint and mechanically a `backToBack` pair, never a `zfight`.

## Decisions that are not visible in the code

- **APRON_HALF is 1.35, and the STATIONS set it, not the channel.** A side
  platform's fascia stands at r = 95.60; a 1.545 apron put the trackbed's
  inner face at 95.455 and the two solids interpenetrated for the whole length
  of every platform. The remaining 0.25 m each side of the 3.2 m channel stays
  the paving agent's surface.
- **Platform decks are ARCS and they are NOT LEVEL.** A straight 18 m edge held
  1.4 m off a 97 m radius reaches r = 96.2 at its ends — inside the 2.60 m car.
  And `groundGrade` moves under the boulevard, so the guideway moves with it:
  the car floor swings 0.48 m across Overlook's platform and 0.17 m across
  Portal's. Every element is therefore placed at `platformDeckY(u)`, and the
  slab's footing at `platformGroundY(u) − 0.42`. Top follows the guideway,
  bottom follows the terrain, and neither end can float or lose the car floor.
- **18 m of deck, not 20+.** The boulevard planters resume ±0.115 rad off every
  station bearing (`pavingPlan` arcRun gaps); the deck AND its end flights have
  to land inside that gap. 18 m still serves the 16.7 m two-car train.
- **The arrival spur's vertical is a civil-engineering decision.** The beam has
  to be flush BEFORE it crosses the rim promenade (r ≈ 112): a viaduct there
  would either wall the promenade off or hang a 0.4 m soffit over it. So the
  descent starts deep inside the tube and holds ≈ 6 %, and the last 15 m into
  the station is level at the channel datum. Stations at z ≥ 168 are FIXED —
  `dome/connectorTube.ts` blends its duct axis onto this curve over z 132→168.
- **The tube lining replicates the dome agent's `tubeAxis` rather than reading
  the spur directly**, so lowering the beam inside the tube can never drag the
  lining off the duct it lives in. Lining r = 5.6, flaring to 5.86 at its mouth
  so it tucks INTO the bulkhead bore (5.9) with a 40 mm reveal — no surface is
  ever shared with either the bore or the duct (flare 7.2 → run 6.05).
- **Riser counts are derived, never assumed.** Every drop here comes out of the
  terrain, so `steps = round(drop / 0.165)` (grand flight) or `/ 0.145` (end
  flights). Portal's grand flight lands on 5 × 160 mm; that is arithmetic, not
  a chosen number. A hardcoded "4 steps" produced a 45 mm rise in the old file.
- **Ramps are RETAINED solids**, thickness per segment down to 0.3 m below the
  local grade. Behind Overlook the ground falls into a swale; a fixed-thickness
  deck hovered 0.65 m over it.
- **Level boxes cannot live on a sloping plane.** The canopy roof rises 0.26 m
  from eave to back, so purlins, pressure caps, gutters and windbreak rails are
  swept members or slabs on the roof/deck plane. Every one of them was a box
  first, and every one of them produced a coplanar pair.

## Audit state (module-level gate)

`buildGuideway + buildTube + buildStations + PortalStationSystem` = **134 k
triangles**, and `auditGeometry` over that set reports **zfight 0,
degenerate 0, nomat 0**, backToBack 4167.

`clash` reports 14 slot-pairs and CANNOT be driven to zero here: `PartWriter`
merges a whole assembly into one mesh per material slot, and `clashPass`
compares MESH pairs, so every authored bury-and-cap joint (rail in its rebate,
lens behind its bezel, bearing pad into the girder soffit, nosing into its
tread) registers as a crossing between two slot meshes. The number that means
something is `zfight`. If the whole-scene gate is ever wanted at zero clash,
the fix is `clashAllow` pairs on slot names, not thinner joints.

## Contract

`track.ts` keeps every previous export (`buildTrackData`, `beamTopY`,
`buildGuideway`, `buildTube`, `TrackData`, `TubeParts`) and adds:

- `CAR_FLOOR`, `carFloorY(x,z)` — the placement datum, so nobody re-derives 0.62.
- `buildStations(writer, group, physics)` — Overlook + Farmside. Signature is
  exactly the local function it replaces in `tramSystem.ts`.
- `guidewayColliders(track)` — analytic boxes for the elevated girder.
  `buildGuideway` has no physics handle (its signature is a contract with
  `tramSystem`), so whoever owns a world asks for these; `PortalStationSystem`
  currently does. **The street-running channel is deliberately unwalled** —
  crossing the tracks is the point of a street tramway.
- `ArcPlatform` + `platformPoint/Tangent/Outward/DeckY/GroundY`,
  `emitPlatformSlab/Edge/Canopy/Ramp`, `stationSteps`, `stationSign`,
  `leaningRail`, `litterBin` — the station kit `portalStation.ts` reuses.

`track.ts` uses ONLY slots that already exist in `kitMaterials()`, because
`tramSystem` builds its writer with a bare `kitMaterials()` and an unbound slot
throws. `portalStation.ts` owns its own build call and adds `stationGlass`.
