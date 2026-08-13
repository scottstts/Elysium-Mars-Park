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
- Arrival: the player boots ALREADY SEATED, ~9.5 s unbroken to the dock.
  The exact MRT scene pass is asynchronously compiled and awaited at the
  arrival seat plus three wide park poses behind the entry plate. The first
  wide pose also compiles all three Optimus LOD meshes explicitly: LOD1 first
  enters the arrival frustum at the tunnel mouth, and relying on its runtime
  visibility switch deferred twelve TSL vertex programs into that frame. The
  camera, Optimus selection, and every static shadow level are restored to the
  real arrival state before BOARD becomes available; prewarm views must never
  leak into live clipmap state.
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

## Rails are ONE member; the turnout is REAL switchwork (P-wave 4)

- The wear rails sweep on their OWN alignments (`RAIL_STEP` 0.45 m spur,
  `LOOP_RAIL_STEP` 1.2 m loop), independent of the cast's stations:
  continuously-welded steel does not observe the concrete's movement joints,
  and the old per-structure rail sweeps read as "pieced parts" (owner
  defect). One unbroken run per rail from the tube overrun into the turnout.
- The turnout is computed from the alignment itself (`computeTurnout`) and
  built as three pieces of real switchwork — the P-wave-3 "feather the rail
  down into the slab" idiom is DEAD (owner: rails must reach the circle):
  - **Blades**: each spur rail runs until its foot lies against the OUTER
    face of its stock rail (profile clamped via `x = max(x, clampFace − ρ)`,
    same collapsed-topology trick as the cast wedge), so the section tapers
    against real steel and dies exactly at the tangency. The 7 mm head-flank
    reveal that falls out of foot-to-foot contact IS the switch look.
  - **Frog**: the spur's inner rail must CROSS the outer loop rail to reach
    the inner circle. The outer loop rail is an OPEN sweep with a real gap
    (crossing envelope + a `FLANGEWAY` each side); the spur rail runs
    continuous through it, feet bedded on the flush special-work deck. NO
    base plate under the crossing — the plate box read as a loose grey patch
    from above (owner defect, P-wave 5); the deck itself is the bearing
    surface. NO check rail either: the flared guard read as a loose strip
    beside the crossing (owner sketch: only smooth curves joining the main
    rails). The joint is exactly four running rails and the flangeway gap.
  - **Special work**: over the zone (plus 2.2 m morph ramps) BOTH casts
    morph to one flush deck at `APRON_TOP` (`morphEmbedded`: grooves close,
    rebates fill, crown rises; same point count, one loft). Rails through
    the zone read as let into a solid panel — real street-tramway special
    work. Joint/drain furniture stops at the zone (drains need grooves).
- The LOOP's built geometry (cast, rails, furniture) marches the ANALYTIC
  ring with `beamTopY` sampled per station — and `buildTrackData` carries
  360 control points, not 48: the boulevard swales have a 33 m component
  that a 12.7 m control spacing aliases, and the curve ran up to ~0.2 m off
  the true crown — the channel floor (poured per-vertex from the same
  slabTop) rose OVER the trackbed and buried whole stretches of rail (owner
  defect, screenshot: "rails buried underneath the ground").
- The paving yields ONE spur cutting away from the station
  (`'spur-corridor-promenade'` across the rim walk, priority 98): a genuine
  CUTTING — floor follows the trackbed crown − 10 mm (`interiorHeight.
  spurTrackDatum`), vertical cast walls to 60 mm below the slab, then a
  90 mm chamfered lip to the trimmed edge — the cut edge is a treated arris
  exactly as along the ring channel. The boulevard throat is NOT a cutting:
  see THE TURNOUT THROAT below.
- THE TURNOUT THROAT (owner reference image: "clean pavement with track on
  top", built as ONE PIECE OF MODELLING, not an assembly). Everything in
  the zone derives from one scalar union field
  `pavingPlan.throatU(x,z) = smoothmin(|ρ−R| clamped to the zone bearings,
  d(spurLine), k = 0.35)` minus a WEDGE BRIDGE:
  - `spurLine` is marched to TANGENCY (ρ → R + 0.02) and continued along
    the ring so its end cap nests inside the ring band — a line cut short
    bulges the union contour at the hand-off.
  - The zone spans the whole station frontage
    (`phiLo/phiHi = π/2 ∓ 0.1937`, 0.6 m inside the terrace corners), so
    the picture-frame headers land on existing field boundary lines and no
    street end is ever mid-view. The channel treatment (floors, lips,
    verge skirt) is clipped EXACTLY on those bearings (`zoneClip`
    bisection), never at segment granularity.
  - Street: one clipped XZ grid at blended crown + 14 mm (4 mm under the
    cast aprons, edges tucked under the casts at |d| = 1.30), poured to
    U ≤ half + 0.16 (30 mm PAST the tile cut, buried 46 mm under the
    tiles) and additionally over any live bridge — a bridged plateau's
    U-band widens into square metres the tile trim cannot resolve.
  - Strips: the iso-contour U = half + 0.09, MARCHED (predictor-corrector
    on `throatUOpen` — the unclamped field; a march cannot cross the
    clamp's discontinuity and orbits the zone if you try), Chaikin-faired,
    swept as a 0.18 m section 6 mm proud of the tiles. Ends never die in
    the open: headers cap one movement joint off the cast aprons, trench
    legs dive bodily under the conform dirt.
  - Tiles: the fields trim on the SAME field at U = half + 0.13 via the
    `'zone'` region kind (a signed-distance region — round-capped ribbons
    cannot express a field footprint); the cut is buried under the strip
    and keeps its interior `edge` attribute (no border course → no moat).
  - Heights: `interiorHeight.throatCrown` = the two ways' crowns blended
    by squared inverse distance ANCHORED AT THE CAST EDGES (|d| = 1.3), so
    the street meets EVERY cast at its own datum and never creases at the
    generator switch. `throatLift` grades the fields to the street
    (tiles = street + 46 mm at the strip, fading over 8 m laterally, 5 m
    of arc past the headers) — the cross-slope absorber of the zone; the
    regolith sheet FOLLOWS the lift down where it is negative
    (`regolithSurface`), or dirt roofs the lowered tiles.
  - The vee wedges between the diverging ways bridge to street below
    ~1.35 m of clear gap ("between" = the directions to the two nearest
    alignments OPPOSE — in the merged stretch both measure the same side
    and the bridge must stay off or the band balloons). The strip contour
    wraps each vee's rounded end automatically.
- THE CORRIDOR CONFORM LAW (P-wave 5, replaces the old trenchDip/lid-clamp
  patchwork): `groundGrade` stays PURE (every pour datum reads undipped
  grade, slabs stay flat), and ONE law shapes the dirt near the whole
  embedded Loop — `interiorHeight.corridorField(x,z)` returns lateral
  distance to the nearest alignment (ring analytic + arrival tail) and the
  crown AT THE PROJECTED POINT; `corridorDip` digs the sheet to EXACTLY
  crown − 0.13 within 2.2 m, fading to nothing by 3.3 m, dig-only. Because
  every pour/cast datum derives from the same projected crown, the sheet's
  offset to each is CONSTANT at every point: floors +60 mm over it, lips
  +190 mm (the curb reveal), trackbed apron +148 mm on the open trench. The
  old patchwork (spur-only dig + turnout lid + ring-band guard) left the
  sheet AT GRADE across the ring band — 55 mm ABOVE the exposed channel
  margins everywhere (floors sit at grade + rise − 0.13, rise is 0.075) —
  and partial blend weights made ragged wedges at the turnout.
- DATUMS ARE PROJECTED, NEVER LOCAL: the channel floor used to pour from
  the LOCAL slabTop per vertex; near the Overlook pad skirt the radial
  cross-slope reaches ±0.15 m ACROSS the 3.2 m channel, and the locally
  poured floor climbed 56 mm over the conformed sheet (5° ring sweep
  finding). The floor now keys to the crown at the projected ring point —
  level across, like the cast and the sheet — and the chamfered LIP is the
  member that absorbs cross-slope, which is what a lip is for. Curb reveal
  then varies 91–308 mm around the ring purely with real cross-slope, and
  never goes negative.
- The channel gains a VERGE SKIRT (`emitGuidewayChannel`): lip arris down
  and outward to projected crown − 0.45 at 0.42 m beyond the lip. The
  conformed sheet (crown − 0.13) crosses over it on one clean line, so the
  skirt's outer edge is buried by construction on open stretches and hides
  under the boulevard slab on paved ones — the seam between curb and dirt
  cannot open anywhere.
- Both curves get `arcLengthDivisions = 2400`: three's default 200-division
  LUT quantises `getPointAt` to ~1.7 m, visible as jitter on 0.45 m stations.
- Piers and tube struts are placed by RUN DISTANCE, not station index, so
  sampling density can change without changing their cadence; girder
  colliders decimate the 0.9 m stations 3:1.
- DANGER: `groundGrade(0, LOOP.radius)` is the anchor every guideway datum
  derives from. Any modifier must live OUTSIDE `groundGrade` (that purity is
  why the conform law may dig the ring band freely: `corridorDip` shapes
  only the sheet, never the pour datums). Putting a dip INSIDE groundGrade
  sank the whole trackbed by 45 mm once — never again.

## The arrival is a ten-second shot (P-wave 4)

- `ARRIVAL_CRUISE` 45 m/s, one continuous `ARRIVAL_BRAKE` 9 m/s²
  sqrt-profile: brake engages ~112 m out (still inside the tube), the car
  threads the gate at ~25 m/s and glides the hook to the stop. Measured
  board-to-stop: 9.47 s sim over the 326 m spur (owner spec: ~10 s).
- The portal gate (its own module, `tram/portalGate.ts`, `setOpen(eased)`)
  triggers at `GATE_OPEN_REMAINING` 190 m — 1.6 s blade travel is fully
  housed ~2.5 s before the car passes — and RESEALS a few seconds after the
  dock (a pressure closure stands closed; target 1 only during approach and
  the first seconds of the portal dwell).
- The gate is a TELESCOPING SEGMENT GATE, not an iris: a plain iris cannot
  live in this collar — any rigid piece covering the centre must retreat
  ≥ 5.9 m (the bore) and the blade slot is only 3.3 m deep (r ≤ 9.2). Six
  64° sectors of TWO plates each (outer band r 3.00–6.15, inner wedge
  r 0.05–3.24 nested behind it) telescope radially: outer travels 2.97 m,
  inner 5.93 m, everything lands in r 5.95–9.17 at open. Sealing is by
  Z-LAPS only (four 90 mm plate bands 20+ mm apart through the slot, 4° arc
  laps between adjacent sectors, a 0.24 m ring lap between stages) — no two
  plates ever share a plane, and the residual centre is a centimetre iris
  dot. Fixed trim rings frame the slot mouth, buried 20 mm into the bore
  wall. The original 6-box "petal" stub never actually cleared the bore at
  open — check any full-open state against the swept envelope, not the rest
  pose.

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
  `emitPlatformSlab/Edge/Canopy`, `stationSteps`, `stationSign`,
  `leaningRail`, `litterBin` — the shared platform kit. The Portal terminus
  builds through `world/stationArchitecture.ts` (see
  `systems/portal-station.md`); the SIDE stations build through
  `world/sideStations.ts` (planFlight flights, derived 1:10 ramp, canonical
  rails — `tramSystem` calls its `buildSideStations`). `emitPlatformSlab`
  carries the grid-cap fix (P-wave 5: ear-clipped caps bridged the falling
  deck by up to 154 mm); `emitPlatformRamp` and the old in-file side
  stations are deleted. All handrails everywhere are `kit.railRun`/`railPost`
  on `tubeAlong`'s rotation-minimising frames.

`track.ts` uses ONLY slots that already exist in `kitMaterials()`, because
`tramSystem` builds its writer with a bare `kitMaterials()` and an unbound slot
throws. `portalStation.ts` owns its own build call and adds `stationGlass`.

## Cabin collision is a convex hull, not a box (2026-08-13)

The cabin collider was `cuboid(CAR_WIDTH/2 + 0.05, 1.5, CAR_LENGTH/2 + 0.05)`,
and it failed in two directions at once — the owner's "blocked where nothing
is, and I can walk through the wall".

- **Too big.** `taperAt` pinches the section to 0.7 at the nose, so the box
  stood **0.44 m** proud of the skin there; with the capsule radius and the
  controller offset that is 0.85 m of phantom blocking off a body the guest can
  see they are not touching.
- **Wrongly oriented.** The yaw was read back from `car.rotation.y` AFTER
  `car.rotateX(-pitch)`. That Euler is an XYZ decomposition of
  `Ry(yaw)·Rx(−pitch)`, whose `y` term is `asin(sin yaw · cos pitch)` — not the
  yaw at all outside ±90°, which is half the Loop. **Never rebuild a rotation
  from an Euler component after `rotateX`/`rotateOnAxis`.**

`tramShape.hullCollisionPoints()` samples the outer skin at every authored `z`
station (2 652 points) and `RAPIER.ColliderDesc.convexHull` wraps it; the body
takes the car's full quaternion. The hull is exact wherever the section is
convex — everywhere above the chine — and bridges only the bogie tunnel (below
the beam top, inside the guideway channel) and the 52 mm door-bay scallop,
which is what we want: the doorway must block as solidly as the wall.
`placeCars` records the true yaw in `carYaw[]` for `nudgeOutOfBox`, which is
still an OBB because it is a safety shove, not the barrier.
`placeCars` records the true yaw in `carYaw[]` for `nudgeOutOfBox`, which is
still an OBB because it is a safety shove, not the barrier.

## Placement is the chord between the BOGIES

A car is carried by two trucks, so it is placed by them: `placeCars` samples the
alignment at `s ± BOGIE_Z` (±2.45 m), sets the body's position to the midpoint
of those two points and its heading to their chord.

It used to take the position from a curve sample at `s` and the heading from a
±0.75 m chord about it. On plain track the difference is millimetres; on the
arrival spur's hook it is not. Measured over the whole park
(`tools/tram-alignment-probe.mjs`):

| | tangent placement | bogie chord |
|---|---|---|
| bogies off the guideway, Loop | 31 mm | **2 mm** |
| bogies off the guideway, spur | 781 mm | **66 mm** |
| coupler-face span, spur | ≤ 1.97 m | **≤ 1.24 m** |

The old model was literally running the car beside its own beam through the
hook. Anything else in the park carried on a pair of trucks should be placed the
same way.

## The alignment's terminal hook — read this before touching the coupling

`ARRIVAL_SPINE` runs dead straight down x = 0 through the portal (the car has to
thread the bulkhead dead-centre) and then has to meet the loop **tangentially**
at (0, 97). That is an ~85° reverse curve inside 11 m, and the osculating radius
falls to **5.3 m** at the very end. Consequences, all measured, none of them
fixable downstream:

- the two cars sit **53° apart while DOCKED** — the pose a guest on the platform
  stands next to for the whole 22 s dwell;
- their coupler faces are **1.45 m** apart there, against 0.58 m on plain track;
- the bar leaves the rear car's head at **95°** to that car's own axis.

The car bodies themselves stay 1.15 m apart, so nothing interpenetrates. But no
coupling that reads as real hardware can look relaxed at 53°; if the arrival is
ever revisited, easing this hook is the fix.

## The coupling (`tram/tramCoupling.ts`)

A four-stage telescopic drawbar hung between two VERTICAL KINGPINS.

- `forkFront` / `forkRear` — a fork on each car's coupler head: two jaw plates
  rooted 80 mm inside the head casting, a turned pin through both, and the two
  jumper glands outboard of them. Each is a CHILD of its own car; add once.
  Anything that bolts to a car and is not that car's child stands proud of it
  the moment the pair kinks — the old root flange lived in the aimed group and
  at 22° stood a 27 mm wedge out of the casting it was bolted to, which is the
  "broken at this angle" report.
- `group` — the bar, the two eyes and the two hoses, in world space, rebuilt
  every fixed step. Roll comes from the MEAN of the two cars' local up, built
  through `Matrix4.makeBasis`, not from a look-at (whose arbitrary roll would
  flip the hoses through a grade change).

**Kingpins, not ball seats.** A spherical seat closes over its ball at ~66° and
cannot pass a bar leaving at 95°. A vertical pin in an open fork has no yaw
limit at all; pitch and roll on a 4 % grade are a bush's job. The forks sit at
`PIN_Y = −0.12`, below the bumper, so nothing on the car's face is inside the
shank's sweep at any angle.

**The stroke is TRANSLATED, never stretched.** 0.58 → 1.45 m is a 2.5:1 range.
Four 0.44 m stages, each nested in the last, cover it with 135 mm of overlap
still in hand at full draw; `update` only sets `position.z` on each stage, so no
part of the assembly is ever scaled. The previous gear scaled a ribbed bellows
over 0.06 → 0.61 m, which past about double reads as a lumpy sausage.

**The hoses are rebuilt, not posed.** `FlexHose` owns a fixed-topology tube
(22 stations × 8 sides) whose positions and normals are recomputed each step
from a cubic Hermite between the two glands — the one part of the gear that
genuinely has to change shape. Two traps it cost:

- the ARRIVING tangent's rise is negative. It is a direction of travel, not an
  offset; sharing the sign with the leaving tangent sank the far control point
  113 mm under its gland and swung the hose into the rear car's nose;
- the glands are CANTED outboard and up (`hoseAxis`). Aimed along their own
  car's axis they aim across the *other* car's nose at 53° of kink, and the
  hose's first third runs through it.

`buildEnd`'s draft housing finishes at `COUPLER_HEAD_Z = 4.06` at the coupler's
own datum (y = `PIN_Y`), and the fork's jaws lap 80 mm back into it.

Gate: `node --experimental-strip-types tools/tram-coupling-audit.mjs` — hull
extents, bogie tracking error, telescope reach and nesting, gland accuracy, and
the depth of any bar or hose intrusion into either car's TRUE cross-section
(not a box of its widest half-width — the coupling all lives at y ≈ 0 where the
car is a 1.16 m bumper), swept over the real loop and spur curves including the
docked pose.
