# Archkit & materials (S7)

- `PartWriter` is the hard-surface authoring core: slot-keyed merged
  geometry, chamfered boxes (45° band, routable to a worn-edge slot), slabs,
  polyline tubes, lathes. Chamfers are the NASA-punk tell — never emit a
  sharp CG box for hardware. One writer per assembly → a handful of draws.
- Kit parts (archkit/kit.ts): guardrail runs (posts + polished top rail +
  kick plate), stair flights (treads with nose overhang, set-back risers,
  sloped stringers, twin rails), benches (true slat gaps), lamp posts
  (unlit — the afternoon is eternal), canopies (pitched slabs + ridge +
  fascia), sign totems, pressure tanks.
- Materials library: paintedSteel / wornEdgeSteel (chamfer slot) / bare
  aluminum / safetyOrange + polishedRailTop (palm-worn) / darkSteel /
  deckPlate / heroGlass (physical transmission, small panes ONLY) /
  signageMaterial (canvas-rasterized letterspaced Helvetica on a plate).
  All lit materials get geometric specular AA.
- Signage plates mount 6 mm proud of their body — never coplanar.
- Portal Station is the hero proof: platform inside the loop, tram edge
  with tactile strip, canopy, code-height rails, 4-step flight onto a
  poured apron pad (`station-foot` in parkPlan — terrain pads make stair
  math deterministic), sign totem + hanging boards, benches registered as
  seats (label flips Sit/Stand via function labels).
- Interactables are POSITION-based (`position`, live-updatable), not
  Object3D-based; captions accept label functions.
- Colliders: platform box, rotated-cuboid stair ramp, columns, rail walls.
