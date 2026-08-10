# The Loop & arrival (S9)

- Track: closed 48-point circle r 206 (clockwise from above so the portal
  station departs eastward: portal → farmside → overlook) + the open arrival
  spur from z 640 in the tube through the portal onto the portal stop.
  `beamTopY()` is the guideway datum — pad-aware (see notes.md).
- Guideway: cast beam segments + twin wear strips + auto pylons where the
  grade drops; the tube gets interior lining (double-sided), structural
  rings, warm running-light strips, and walkway decks.
- Vehicle: panel-built shell with REAL window apertures (no glass stickers
  on solid boxes — the ride view is the product). Front seat pair faces
  forward at the front; cabin light strip; pocket doors slide per side.
  Doors: with +Z travel, +X local = LEFT = platform side at all three stops.
- Motion: arc-length kinematics, comfort profile (a 1.05, cruise 8, tube
  11.5, sqrt-braking into stops), 22 s dwells, door state machine inside
  dwell. Cars follow at ±(length+gap)/2 with per-car pitch.
- Arrival: the player boots ALREADY SEATED (enterVehicle pose closure →
  PlayerSystem generalized seat), ~50 s unbroken: dark tube → running
  lights → iris petals slide open → the reveal → sweep → dock → doors.
  Wide-pose sneak renders behind the entry screen precompile the park so
  the reveal cannot hitch on first-sight pipelines.
- Riding: E during dwell alights (left door, onto the platform); E while
  moving queues alighting at the next stop. Board prompt anchors to the
  front car's left door via a live-updated interactable position.
- Iris: six sliding petals in a collar at z 250.4, opened by tram
  proximity on the spur; stays open once on the loop.
- ?view modes: no player — the tram simply circulates for postcards.
