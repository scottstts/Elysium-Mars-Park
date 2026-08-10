# Park assembly (S8)

- ONE PartWriter for every district: all park architecture lands as ~16
  merged slot meshes (draw calls stay flat as content grows). Special
  meshes (milky vault glass, hero panes, sign faces) join a shared group.
- District builders in `world/districts/`: residential (10 habs on cradles,
  porches to the park, five personal-touch variants, the jacket on hab #3),
  farmside (3 barrel vaults, arch-fitted milky end glazing, interior racks +
  grow bars so the glow silhouettes read, harvest chalkboard), works
  (pilastered machine hall, 2×2 tank farm with piped racks + valve wheel,
  radiator rows, charging docks, elevated gallery to the Ops box),
  leisure (amphitheater arcs of cast rows with three aisles + stage facing
  the planet, Overlook Lounge with the ONLY true-transmission window wall,
  playground with climbing dome/swings/Ares-VII plaque, First Tree plaza
  with soil fill + ring benches + founding plaque).
- `parkAmenities` marches benches/lamps/waste pairs down the paver paths
  with exclusion zones around set-piece areas. Every bench everywhere is a
  registered seat (seat contract: SURFACE point + facing yaw).
- Colliders flow through `DistrictServices.colliders` into one fixed body.
- Orientation gotcha that bit twice: `writer.box` size.x runs along the
  rotated (cos,0,−sin) axis and size.z along (sin,0,cos) — for a wall in
  the YZ plane at constant X use rotationY = yaw (not yaw + π/2).
- Canvas-signage backgrounds are #RRGGBB — an accidental 8-digit hex made
  one sign transparent (found in survey).
- Milky vault glazing is deliberately NOT physical transmission (area too
  large); the ONLY transmissive panes are the Overlook window wall.
