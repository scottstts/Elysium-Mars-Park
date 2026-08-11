# Portal Station — circulation and enclosure

Owner files: `src/world/stationArchitecture.ts` (geometry + route planning),
`src/world/portalStation.ts` (the system: assembly, dressing, colliders).
Datums come from `tram/track.ts`; the deck slab is a corrected COPY of
`emitPlatformSlab` (see "The deck slab" below).

## What decides the layout (constraints, not taste)

Everything sits in the platform's `(u, v)` frame: `u` is arc offset — **positive
u walks toward −x**, the world compass is useless on an arc and the old
"east/west" comments in this area were wrong — and `v` is inward from the
fascia. `platformDeckY(u)` falls with the guideway, so nothing here is level.

The paved ground the station can discharge onto is a T: the **station terrace**
(z ≥ 91, |x| ≤ 19) and the **Meridian walk** (a 6 m ribbon at x ≈ 0 running
south). Everything else behind the deck is regolith. Both pours are **kerbed**
(`CURB.reveal` = 135 mm), so a route that lands outside a paved region lands
against a 135 mm upstand — which is what pins every foot position below.

- **Grand flight** — 5.0 m, off the back edge on the station axis, 5 risers,
  onto the Meridian walk. The walk's kerbs sit at |x| ≈ 2.9–3.1, so 5.0 m is
  the widest ceremonial flight that fits between them.
- **End flights** — 2.4 m, off each deck end along the tangent, in v ∈ [1.5, 3.9]:
  clear of the guideway channel lip (r 95.4 → v 0.2) and clear of the terrace's
  own south kerb (v ≈ 4.5). Wider or deeper drives one edge over a kerb.
- **Ramp** — level head landing at the back-west corner, then ONE splayed run
  converging onto the Meridian walk 9.5 m south, 1:10.5. It cannot run parallel
  to the back edge (6.5 m of clear arc beside the grand flight against ~0.95 m
  of drop = 1:6.8) and it cannot run radially beside the flight (it would land
  outside the 6 m walk, i.e. against the kerb). The splay is the only line that
  keeps the grade AND puts every wheel on kerb-free poured ground.
  It bridges the walk's west kerb with ~0.27 m of clearance; the kerb is buried
  in the ramp's retained mass and re-emerges south of it. That is the honest
  construction condition, not a defect.

## The flushness idiom

**A cast never butts the ground — it crosses it.** Flights carry
`stationSteps`' own −0.34 lead-in under the paving. Everything else gets
`groundApron()`, whose outer edge runs 55 mm BELOW the local surface on a
smoothstep blend: zero slope at the nosing (a linear blend put a 24 % ramp in
the first 120 mm), ~3° at the crossing, so contact is a LINE and there is no
coplanar area for the audit to find. The same pour is what absorbs a landing's
cross-fall — the terrace falls 41 mm/m across the end flights and no level
tread can follow that.

Flight heads solve for `deckY − 0.009` because `stationSteps` stands its
threshold plate 15 mm proud of the cast: the plate then lands 6 mm over the
deck (a real alloy nosing) instead of exactly ON it (0.10 m² of coplanar).

## The screen

A screen, not a wall. Runs are `screenRuns()`; every gap between them is a
route, and each run turns a glazed RETURN onto its own end post at both ends,
so no pane and no rail ever dies in mid air. Openings: 5.32 m clear centred on
the grand flight, and the ramp head's full width (the only things inside it are
the ramp's own kerbs and handrails). Colliders are emitted per RUN, so nothing
spans an opening.

## The deck slab

`track.emitPlatformSlab` caps its loft with ear-clipped n-gons. On an 18 m
annular sector whose vertices carry different heights that produced two
triangles spanning the whole platform, and the walking surface stood up to
**154 mm above `platformDeckY`** mid-deck — burying the tactile corduroy and
the edge lenses, which are correctly placed on the datum. `emitDeckSlab` is the
corrected copy: caps are polar GRIDS, the outline carries the matching radial
subdivision on its end edges so grid and loft share every boundary vertex, and
the arc is segmented at 1.1 m (datum held to under a millimetre).

Two traps inside it: the cap grid must be `cleanMesh`d BEFORE `recalcNormals`
(un-welded it is three open components and the orientation is a coin toss — the
deck rendered back-facing), and the landing's footing is
`platformGroundY − 0.62` **by construction**, 0.20 m under the slab's own, so
the two soffits can never agree by accident.

**Overlook and Farmside still call the original helper and still carry the
faceted deck.** `track.ts` was read-only for this wave.

## Colliders

Name the TOP FACE, never a centre plus a lift: `surface(a, b, halfAcross)`
builds the box from the surface segment. The old centre+lift form measured
171 mm above the deck at the grand flight's head. The deck is six PITCHED
sixths (level boxes tracked the falling deck to ±74 mm; pitched to ~5 mm), and
the ramp's splayed landing needs two boxes — one square to the arc, one square
to the run.

## Gate

`node --experimental-strip-types tools/station-audit.mjs` — builds the station
into a bare `PartWriter`, runs `auditGeometry`, then asserts flush heads, flush
feet against the analytic ground AT THE ACTUAL FOOT POSITION, headroom, egress
envelopes (structure hits and `insidePlanter` samples) and the screen openings.
Run it after any change to the platform, the ground law or `buildPlanters()`.
