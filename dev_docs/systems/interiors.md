# Hero interiors (S10)

- Shells got REAL door apertures (walls split into runs + header) in their
  district builders; `DoorsSystem` animates sliding panels, flips captions
  Open/Close, and toggles a blocking collider per door (enabled < 0.4 open).
- Door panel orientation rule: the panel's local X must lie IN the wall
  plane — θ = the wall's run direction, NOT the wall normal (bit three
  times; see slidingDoor call sites).
- The Common Hab was rebuilt as a panel hall (5×12) — a cylinder can't take
  a clean aperture from a merged tube, and the community building being
  architecturally bespoke reads intentionally.
- Interiors: lounge (bench rows to the window wall, tables, coffee console,
  cove light), ops (desk run + stool + three CANVAS-TEXTURE dashboards that
  live-mirror real state: loop diagram with the actual tram dot, park
  clock, robot roster — bound to real robots in S11), common hab
  (kitchenette, the mid-game table with seeded scattered tokens, stools as
  seats, sofa, shelf), greenhouse (sliding lane door + aisle decks; racks
  and grow bars were S8).
- Interior lighting: emissive cove strips only — interiors are deliberately
  dim against the blazing window openings (the lounge's raking mullion
  shadows are the money read).
- Probing gotcha: the player BOOTS riding the tram — interior probes must
  `tram.riding=false; player.standAt(...)` before interacting.

## Glasshouse entrances (overhaul, owner-flagged)

- The three farmside ranges are **walk-through**: an identical entrance at
  BOTH gables of all three, six `DoorSpec`s in total. The entrance belongs to
  `farmside.ts`, not to `greenhouseInterior.ts` — the doorway is an aperture
  cut from the gable's own welded grid, so its jambs, header, threshold and
  leaf have to be authored where that grid is.
- The grid IS the door frame: the door bay's two mullions are its jambs (at a
  heavier section, on the same grid lines), and the door-head transom is its
  header. Nothing else is added, and every member/pane that would cross the
  clear opening is simply never emitted. `DOOR_CLEAR_WIDTH` is therefore
  derived — `bay − 2 × JAMB_HALF` — not a number invented next to a grid line.
- The leaf hangs **inboard**, 30 mm clear of the foundation upstand's inner
  face. Any leaf hung outboard has to clear a 488 mm × 140 mm concrete
  upstand along its whole travel, which means either a 300 mm stand-off or
  breaking the upstand under the parking bay. Inboard costs nothing.
- Thresholds: the doorway sits 55–194 mm above the apron across the three
  ranges (`interiorHeight` fall differs per house). The approach is divided
  into risers of ≤58 mm, each with its own collider, rather than leaning on
  the character controller's 0.42 m autostep.

## Overlook Lounge — the floating transoms, and the blocked door (2026-08-13)

**Every curtain-wall transom in the drum ran RADIALLY.** `prismXZ` extrudes
along local +Y, so a transom's LENGTH is its +Y axis and its depth is +X — the
mullion's convention, i.e. the plain bearing of the bay normal
(`atan2(nz, nx)`). It was being rotated by `crossYaw`, which lays +X ACROSS the
face and is right for `lensBar` and for plan-section `prism`s but is exactly 90°
wrong here. The result was 62 bars poking 1.4 m into the room from a point in
mid-air: the owner's "floating blocks attached to nothing", horizontal in the
lower band and raking in the upper one purely because the upper band sits 3.6 m
above the eye and a radial bar converges in perspective.

**Rule:** decide which local axis a builder puts the part's LENGTH on before
picking a yaw helper. `crossYaw(f)` is for parts whose length is local +X;
`atan2(nz, nx)` is for parts whose length is local +Y.

**The coffee console closed the entrance.** It stood at (u 4.15, v 1.2) — 0.8 m
straight in front of a door centred on v 0.745 that a guest walks in along −u.
Moving it along the same wall was not enough: the stair occupies u 1.85…3.35
across v −1.9…4.5, so the whole east flank from the door southward is a 1.35 m
entry corridor serving that flight, and anything parked in it narrows the only
way into the room. It now sits in the low-ceilinged nook UNDER the mezzanine at
(3.58, −3.6), shortened from 2.1 m to 1.6 m — a straight counter against a 2:1
drum only touches its curve at one point, and the shorter run keeps the service
gap behind it between 0.28 m and 0.47 m instead of half a metre.

Gate: `node --experimental-strip-types tools/lounge-audit.mjs` — transoms
tangential, no part in the drum floating (every part's inflated box must touch
another or reach a floor level), and a walkable threshold plus a corridor off
it. It found the transoms in one run and would have failed the old console.

## Overlook Lounge — three storeys, none of them reachable (2026-08-13, evening)

Owner report: "player cannot go up the stairs inside... i want to be able to go
up the stairs and see them". The geometry was all there. The COLLIDERS were a
different model, and it had rotted separately:

- each flight was covered by ONE SOLID BOX spanning its whole rise, so both
  stairs were walls;
- the drum's wall colliders stopped at apron + 4.4, which is 0.54 m above the
  mezzanine floor — anyone who did reach the mezzanine could walk out through
  the upper glazing;
- the roof terrace had no deck collider at all, and the penthouse had a solid
  block filling it, sealing the head of the stair off from the terrace it
  exists to reach.

Now: one collider per GOING, top face exactly on the tread and carried down to
the flight's foot (0.17 m against a 0.42 m autostep); the wall ring runs the
full height with a second 1.1 m ring for the roof parapet; the terrace deck is
tiled with the well left open; the mezzanine's open chord gets a guardrail
collider broken where the flight lands; and the penthouse is three walls.

**Three geometry defects surfaced by making it walkable:**

- **The mezzanine plate was a lopsided crescent.** Its arc swept
  `[−(π − asin(chordV/az)), …]` over `π + 2·asin(…)`, which is neither symmetric
  about the drum's axis nor the right length: the "chord" ran from v = +2.25 on
  the west flank to −6.18 on the east, 8.4 m out of true. For `az·sin t ≤ chordV`
  the arc is `[−π + tCut, −tCut]` with `tCut = asin(−chordV/az)`.
- **Flight 1 was authored one going too long** — `chordV + 23·run` back from a
  slab whose real edge is at `chordV − 0.045` (the true-normal inset pulls the
  arc ends north). The top tread finished 0.34 m short of the floor it lands on.
  The origin is now solved from the polygon's own measured edge.
- **The roof flight climbed at the penthouse's blank wall.** The penthouse is a
  U and opened WEST while the flight arrived from the EAST, so the head of the
  stair faced a wall with the stairwell behind it. Both now run along the drum's
  LONG axis, climbing south, and the doorway is at the head of its own stair.

**Headroom is what sizes a roof well, not the flight's width.** The soffit is
2.88 m over the mezzanine and a climber needs 1.8 m of it, so every tread above
`mezzTop + 1.08` — treads 6 up, the last 4.0 m of a 5.51 m run — has to be under
open sky. The old 2.7 m hole covered barely half of that. The well is 4.6 m
long, and its north edge is pushed a further 0.4 m out so the capsule's shoulder
clears the edge, not just its axis.

**Do not quantise an aperture.** Tiling the deck on a fixed grid and dropping
any cell that touched the well moved the well's edge outward by up to 0.77 m and
the head of the flight came out over open air. Each band around the aperture is
tiled with cells sized to divide it exactly.

The terrace now carries three chairs and a table on its west flank, aimed at the
plain like everything else in this building: an empty deck with a 5 m stair
house on it reads as plant, not as a room.

Gate: `tools/lounge-audit.mjs` gained a `storeys` check that CLIMBS both flights
against the collider set with the real capsule (r 0.35, 1.8 m) and autostep,
verifying support under every step, no blocking collider, the landing height,
headroom against the roof slab, and edge protection at every bay on both upper
levels.
