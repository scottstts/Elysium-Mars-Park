# Robots (S11)

- Ground fleet: GK-01 (gardens circuit), GK-02 (bed run down the Meridian,
  wears the painted eyes — nobody has confessed), SWEEP-1 (rim promenade,
  spinning brush), MULE-1 (farmside ↔ works ↔ depot). Waypoint routines
  with working pauses (tool bob), wheel spin from contact speed, polite
  1.7 m yield to the walking player, `markDynamic` for the near shadow maps.
- Panewalker: exterior gantry truss spanning θ 0.30–0.62, traveling at
  0.0031 rad/s (one lap ≈ 34 min). `panewalkerPhi` is THE shared uniform:
  geometry rotation, the glass dust-film cleaned wake, AND its traveling
  shadow — implemented as an occluder band inside `latticeSunVisibility`
  on the same sphere projection as the net (soft cloud via the same
  box-overlap penumbra). One uniform, three phenomena, zero drift.
- Ops dashboards now read `RobotsSystem.roster()` live.
- Reclaimer vapor: sprite stacks with a life-cycled shared uniform.
- S14: the Panewalker boots ON the sun line (phi0 = 2.793 rad — math
  bearing atan2(z,x), not compass azimuth) so a fresh session opens with
  the gantry in the glare and the swath shadow near the plaza; it then
  walks west across the gardens. Brush carriages are 2.3 m pods so the
  rig silhouettes from the park floor. The glass swath is directional:
  a 0.5 rad cleaned wake TRAILING the walker only.

## S15 rebuild — the fleet as machines (design notes)

**Method.** Every machine follows the hero-model recipe: an analytic base body
first (a lofted shell from named sections), then every attachment placed on it
at ±ε. Proud parts stand ≥0.8 mm off so no two faces are ever coplanar; feet
that must not show a gap are *buried* and capped with a lathed flange. There
are no stacked primitives — the only boxes are true filleted solids swept from
a rounded-rect profile, and the toolkit is `robots/forge.ts`.

**Body architecture (all three ground machines).** A narrow structural
chassis (closed lofted tub) carries the running gear; a separate moulded
**shell** sits over it. The shell section is a U-band — outer skin, real wall
thickness, open underneath — so the bottom rim shows its own edge and the
machine reads as a pressing over a frame rather than a sealed box. Both ends
of that shell get a **bulkhead**: without them the open underside reads as a
cavity from behind, which was the single worst thing in the first pass.

**GK-01 / GK-02.** Rocker chassis with a real side-elevation silhouette
extruded across, pivot bosses through the tub (capped both sides), axle stubs
out to the hubs, a coil-over per side (lathed barrel + gland + rod + eye ends,
plus a helical spring swept along its own path) and a **differential bar**
across the deck linked down to both rockers — the detail that says "rover".
The nose is a laid-back **face panel** closing the shell: it is the machine's
face, it carries the fleet stencil, and it is where GK-02's painted eyes live.
They were illegible in the first pass because the nose was an open mouth and
the decal sat inside it in shadow; a panel that closes the nose is the fix, and
the eyes now read from 2 m. Liveries differ by paint/accent colour and a wear
multiplier (GK-02 is the older machine) — the decals do the rest.

**SWEEP-1.** Twin gutter brooms **lead** the machine, ahead of the front
wheels: mounted alongside they interpenetrate the tyres at every angle, and the
front axle was moved back to buy the clearance rather than shrinking the
brooms. The `tool` group is the brush carriage (the routine's working bob
raises and lowers it); the discs are separate spinners inside it. A hinged
hopper sits on the rear deck rather than being sunk into the shell — no
aperture needed, and a cracked-open lid on real hinge barrels tells the story.

**MULE-1.** Ladder frame (two C-section rails + cross members + gussets)
visible under the bed, trailing arm and hub motor per wheel station, tie-down
rail mitred round the bed with D-rings, a drop side hanging outboard on its
hinges, and a load of three varied crates under ratchet straps. The pennant
mast is the yard-vehicle tell.

**Panewalker.** Rebuilt as a real gantry: two curved **rail shoes** ride ring
ribs at θ_min/θ_max — their beams run in φ (along the rib) and their bogie
wheels straddle the rib in θ (across it); getting that pair of directions the
right way round is the whole difference between gripping the dome and lying on
it. Between them runs a square box truss (four curved chords, posts,
transverse ties, K-bracing, gusset plates in the meridian plane), a maintenance
walkway with handrails along the top chord, a wash-fluid trunk main, and three
brush carriages on rack columns with drum, squeegee, tank, hose and lamps. The
section of any part laid on the shell is seeded with the **shell normal** as
its up vector; a default +Y seed leaves box sections standing vertical on a
35° slope. All of it derives from the dome constants, so the gantry re-fits
itself when the dome is retuned.

**Rig contract (changed, deliberately).** `RobotRig` now carries
`wheelRadius` and `spinners`:
- `wheelRadius` — `robotsSystem.fixedUpdate` rolls each rig off its own radius
  instead of one shared assumed 0.18 m. GK 0.152, SWEEP 0.132, MULE 0.186.
- `spinners` — sub-assemblies that spin about their own local Z. The sweeper's
  `tool` is the carriage (still bobbed by the working branch); its two brooms
  are spinners, because two discs parented to one spinning group would orbit
  rather than turn.
`group`, `wheels`, `tool` and `roster()` are unchanged, so the audio engine's
positional servo sources and the Ops screens keep working untouched.

**`buildDockedRobot(name)`** exports the parked pose for the maintenance
yard's charging row (works district): boom folded and stowed, charge-port door
swung open. Origin at ground contact, +Z forward — place and yaw it like any
other prop.

**Budgets.** GK ≈20.7 k tris, SWEEP ≈17.0 k, MULE ≈28.1 k, Panewalker ≈24.7 k
(the gantry is ~53 m of arc at the current dome radius, not the 100 m the
older constants implied). Wheels are built once per (spec, hand) and cloned, so
the four/six wheels of a machine share geometry and materials.
