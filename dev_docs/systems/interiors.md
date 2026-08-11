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
