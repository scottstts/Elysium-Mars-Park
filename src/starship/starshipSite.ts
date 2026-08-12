/**
 * WHERE THE LAUNCH SITE IS. Plain numbers, no three.js and no imports — the
 * exterior height field reads this at module scope to grade the platform, and
 * the scatter reads it to keep boulders off the concrete.
 *
 * THE SITE. West of the arrival tunnel, on the Bowl's side of it, 70 m beyond
 * the dome glass: coming up the tube into the dome the stack stands on your
 * left. The tower is on the far side of the vehicle from the tunnel with the
 * catch arms reaching back east toward it, which is the whole point of the
 * layout — from inside the park you look through the arms at the ship, not at
 * the back of the tower.
 *
 * ORIENTATION. Yaw 0: the demo's Blender +X (tower → vehicle) runs due world
 * +X, so the arms point at the tunnel. Under the frozen WSW sun this puts the
 * stack 49° off the sightline from the park — contre-jour, a dark lattice and
 * a specular rim down the stainless hull. That is the owner's call and the
 * reason the shadow ladder was extended to cover it (render/sky notes): a
 * backlit 147 m tower reads only if it self-shadows.
 *
 * CLEARANCES (measured, tools/starship-site-audit.mjs):
 *   pad slab       world X −121 … −53,  Z 169 … 231
 *   tube skin      r 7.2 about x = 0    → 45.8 m of open regolith between
 *   dome glass     foot at r 130        → nearest slab corner at r 177
 *   vehicle axis   (−77.6, 200)         → r 215 from the park centre
 *   tower axis     (−100.5, 200)
 */

/**
 * World position of the ASSEMBLY ORIGIN — the demo's own Blender origin, which
 * is the OLM/tower datum, not the middle of anything. The vehicle stands
 * `VEH_X` (5.358 m, derived by the assembly from the catch-pad seat) east of
 * it; `starshipSystem` asserts that offset still holds after a rebuild.
 */
export const STARSHIP_SITE = {
  x: -83,
  z: 200,
  /**
   * The assembly origin's height. The pad slab runs −1.10 … +1.30 about it, so
   * on a platform graded to `STARSHIP_PAD.y` the 2.4 m raft is half buried and
   * stands 1.20 m proud all the way round — a poured pad, not a raft dropped
   * on dunes.
   */
  y: -0.54,
  /** Rotation about world +Y. Zero: Blender +X is world +X. */
  yaw: 0,
} as const

/** Where the vehicle axis lands, given the origin above. Documentation and a
 *  boot-time assertion — nothing derives geometry from it. */
export const STARSHIP_VEHICLE_OFFSET_X = 5.358443272894105

/**
 * THE GRADED PLATFORM. The natural valley floor runs −1.13 … −0.05 across the
 * slab's footprint — a 1.08 m swale under a 68 × 62 m pour. You do not pour a
 * launch platform on that, you cut and fill it flat first, exactly as the
 * height field already does for the dome apron and the spaceport corridor.
 *
 * `y` is the balanced cut/fill level (the footprint's own mean): 0.69 m of cut
 * at the high corner, 0.39 m of fill at the low one.
 *
 * The flat rectangle clears the slab by 4 m on every side so the grade break
 * is never under the concrete, and the skirt is 30 m — deliberately wide,
 * because the valley mesh is polar with ~10 m radial rows out here and a
 * tighter ramp would come out as a staircase rather than an apron. At its
 * inner tip the skirt still dies 19 m short of the tunnel's centreline.
 */
export const STARSHIP_PAD = {
  x: -87,
  z: 200,
  halfX: 38,
  halfZ: 35,
  y: -0.44,
  skirt: 30,
} as const

/**
 * 1 on the graded platform, 0 outside its skirt. A ROUNDED rectangle: the
 * corner blend is taken on the diagonal distance, because two independent
 * axis ramps meeting at a corner read as a crease from inside the dome.
 */
export function starshipPadWeight(x: number, z: number): number {
  const dx = Math.abs(x - STARSHIP_PAD.x) - STARSHIP_PAD.halfX
  const dz = Math.abs(z - STARSHIP_PAD.z) - STARSHIP_PAD.halfZ
  if (dx >= STARSHIP_PAD.skirt || dz >= STARSHIP_PAD.skirt) return 0
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0))
  const t = Math.min(1, Math.max(0, outside / STARSHIP_PAD.skirt))
  return 1 - t * t * (3 - 2 * t)
}

/**
 * True where scatter must not place a rock: the concrete plus a 6 m verge.
 * Cheaper and stricter than the weight above — a boulder half-buried in the
 * apron ramp is as wrong as one standing on the deck.
 */
export function insideStarshipPad(x: number, z: number): boolean {
  return (
    Math.abs(x - STARSHIP_PAD.x) < STARSHIP_PAD.halfX + 6
    && Math.abs(z - STARSHIP_PAD.z) < STARSHIP_PAD.halfZ + 6
  )
}
