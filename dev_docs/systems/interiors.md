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
