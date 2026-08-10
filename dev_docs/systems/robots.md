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
