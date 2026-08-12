# Freedom Tower + the gallery lift

`districts/freedomTower.ts` (everything static) + `world/freedomElevator.ts`
(everything that moves). The landmark of the park: a Shukhov hyperboloid
lattice on a stepped cast stylobate at `FREEDOM_TOWER` (33, 57), carrying a
sixteen-bay glass gallery under a faceted glass tent roof and an octagonal
spire whose tip is **derived** from the dome shell — not authored.

## The one contract

`freedomFrame()` (exported from the district) computes every shared datum
once from `parkPlan.FREEDOM_TOWER` + the dome constants: terrace/deck/tip
world heights, the door axis, cab axis and radius, parked cab-floor heights,
portal anchors and alight points. The elevator, the district and any future
consumer read THIS — no second source of truth. Spire tip =
`√(R_dome² − r_site²) + domeCenterY − 0.9`, so if the dome ever changes the
tower still fits the glass (audit gate asserts ≥ 0.55 m on every vertex).

## Geometry decisions worth keeping

- **Both ruling families spring from shared pedestals**, split ±0.026 rad so
  the paired sockets never cross at the root. Leg–leg crossings are solved as
  segment–segment closest approach (not the closed form — it survives the
  stagger), and every true crossing gets a two-sided bolted clamp cleat.
  Rings thread THROUGH the legs (one 'steel' slot: crossings weld); a saddle
  plate dresses each pass. Ring heights are chosen BETWEEN the crossing
  bands (`RING_Z` vs the k-table in the file).
- **The shaft plan is one star-shaped "stadium" field** (`stadiumRadius(b)`)
  about the cab/core spine: the pit, both curbs, both screens, the deck
  aperture and its colliders are all generated from it, so they cannot
  disagree. The curbs dip flush across the portal arc (plinth `portalDip`
  idiom) and carry the glazing rebate the screen channels float in (3 mm,
  hidden by the lips — cast/steel never touches aluminum).
- **Cast never touches steel, steel never touches aluminum**: pedestal
  shoes float in curb-ring cups; mullions stand in shoe cups via their own
  base plates (undersides staggered −0.022 / −0.014 / +0.037 — the
  stack rule applies DOWNWARD); glazing channels bury only into aluminum.
- **Ring solids are `tubeAlong` closed sections** (`ringSolid`), never
  capped stacked-ring lofts — the pedestal curb shipped as end-cap DISCS
  coplanar with the block top the first time (25 z-fight pairs).
- The roof is a **faceted tent** (ROOF_RINGS polyline), so every pane is a
  planar symmetric trapezoid; the apex compression ring is carried by the
  rafters while the spire stands on the core's crown post THROUGH the ring
  bore (0.2 m annular reveal, storm collar above).
- The terrace ground plane belongs to PAVING ('freedom-terrace' disc region,
  the station-terrace pattern) — the stylobate stands on that slab with
  line-contact skirts. The 'tower-walk' ribbon ends INSIDE the disc and is
  priority **39**: two ribbons at one priority never trim each other, and
  this is the park's first spoke-to-spoke junction (owner-reported coplanar
  flicker until the branch dropped a rung).

## The lift

One scalar (`cabFloorY`) poses everything: cab, both rope groups (unit
tubes, `scale.y` = span), counterweight (`cwtLow + (topFloor − cabFloorY)`),
sheave spin. Materials are object-space (`positionLocal`) — the cab travels
38 m and kit materials would swim.

State machine: `parkedBottom | up | down | parkedTop` + `riding` +
**`departing`** — the flag exists because an ARRIVED cab is also
riding-and-parked, and without it the first live ride bounced straight back
down. Doors: per-landing open scalar; a landing's pair opens while the cab
is parked there AND someone stands in the portal vicinity (the rider inside
counts — that is what reopens them on arrival); `departing && boardWait ≤ 0`
forces them shut for departure; the landing-door colliders enable below
open 0.4. E during the closing window alights (cancels) — deliberate, the
tram's own rule. Auto-dispatch sends the parked cab to a waiting player at
the other landing, so nobody can be stranded (doors shut first).

The rider's body never rides: `enterVehicle` freezes it at the boarding
landing, the camera follows the pose closure (eye = cab floor + 1.70,
yaw = the door axis), and `alight()` re-places the body at the destination
stand point. No moving-platform physics exists.

Caption override discipline: the elevator registers AFTER the tram in
main.ts and only touches `interaction.setOverride` while `riding` (plus one
null on release) — the tram writes unconditionally every frame, so the later
system must be the polite one or captions clobber.

## Rendering lessons this build surfaced (fixed park-wide)

- `CachedShadowClipmapNode` slab: casters need `lightMargin ≥ h/sin 27°`
  (crown ≈ 50 m → 150) and receivers below a high camera need
  `DEPTH_REACH ≥ 2.2 × camera height` (→ 200). Both ends of the tower's
  shadow were cut before (owner reports) — the gallery made high cameras a
  public vantage for the first time.
- GTAO "barcode" rows: three fixes in `render/pipeline.ts` — float32 pass
  depth (r185 PassNode default is 24-bit), texel-centred half-res AO reads
  in the bilateral, and above all the **competence fade**: AO retires where
  its world radius spans < ~8 gather texels (`footprint` between
  radius/8 and radius/3.3), a ratio that self-adapts to any resolution.
- Hand-quad sign faces are DoubleSide (`signFace()`), per the commons rule.
- Shadow sawtooth on the gallery deck: fixed in the cached sun rig, not in the
  tower material. This is the park's only broad, untextured bright receiver;
  its raking wide shadows exposed the rasterized light-space texel staircase
  that narrow rail shadows hid by overlapping their two filtered edges. Static
  L0 now owns the full 10.9 m deck at a denser grid while preserving the old
  world-space PCF width. See `render-pipeline.md` §12.
- `curtainGlassMaterial` and `shaftGlass` were missing the AO-receiver mask
  (`mrt({ normal: vec4(normalView, 0) })`) that every other pane in the park
  carries, so GTAO darkened the GLASS around the leaning rail, the mullions and
  the head channel on every bay. Fixed at both materials — which also fixes the
  Commons drum and the hydro tower, since they share the recipe.

## Contracts and consumers

- Wayfinding: `DESTINATIONS` gained FREEDOM TOWER (fingerposts pick it up
  automatically), the 'freedom' gate monolith stands off the approach walk,
  the park model carries a 1:210 spire, and the amenity blocker keeps
  furniture off the terrace.
- `?view=freedom` (approach postcard), `?view=freedomup` (under-lattice
  look-up), and `?view=freedomdeck` (bare-plane shadow regression) are the
  saved cameras.
- Audio: the cab in flight + the gallery classify as 'interior'
  (`engine.ts`, plan-radius 6 above y 4.5).
- Gate: `node --experimental-strip-types tools/freedom-audit.mjs` — per-part
  audit (every raw() its own mesh), dome-margin assert, shaft-envelope
  clearance sweep, cab assembly audit, door-sweep bands. Current: zfight 0 ·
  cross-slot clash 0 · degenerate 0 over 431 k triangles, 810 parts.
