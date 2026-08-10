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

# The polygon layer (overhaul wave 1)

`src/archkit/meshdata.ts` is the friends-grade authoring layer; `writer.ts`
stays the sink. Read `dev_docs/craft/geometry-craft.md` first — this section
only records the decisions that code and craft doc together do not state.

## Two sinks, one merge

`PartWriter` was kept verbatim (every district builds through it) and gained
one new primitive: `writer.raw(slot, positions, normals, uvs)`. Everything the
polygon layer produces arrives that way, so **smooth-by-angle normals survive
into the writer** instead of being recomputed per face. A builder mixes both
freely — `writer.box()` for a bracket, `writeInto(writer, slot, md)` for
anything with a silhouette — and they land in the same merged per-slot draw.
`buildGroup(parts, materials)` is the standalone twin, shaped exactly like
`PartWriter.build()`, so a builder can be moved between sinks without edits.

## Z-up authoring, Y-up emit

`MeshData` carries a `frame` field and is authored **Z-up**, unchanged from the
reference project: `prism` extrudes along Z, `revolve` profiles are `(r, z)`,
`tubeAlong`'s default up is `[0,0,1]`, plan polygons are `(x, y)`. Every
profile in the craft doc can therefore be read literally. `toTriangles()`
applies `(x,y,z) -> (x,z,y)` inline and reverses each triangle's corner order,
because the swap is a mirror. Authored `+Z` (up) lands on world `+Y`, and plan
coordinates map 1:1 onto world XZ — the frame `parkPlan.ts` already uses.

The one thing to remember: **`translate`/`rotX`/`rotY` before emit operate in
Z-up.** `placeYaw()` is the exception — it is for parts already flipped to
Y-up, and applies the identical transform `kit.offset()` uses.

## Do not `join()` a multi-part object before emit

`join` takes a single smooth angle for the whole result, and `cleanMesh` is
then free to weld vertices **across a butt joint** between two parts that were
never meant to share topology. Keep parts as separate `MeshData` in the slot
arrays (`SlotParts = Record<slot, MeshData[]>`) and clean each one; the writer
merges them into one draw regardless. Join only what is genuinely one shell.

## Additive writer extensions

- `box({ fillet, filletSegments })` — a true radius (rounded-box grid, welded
  edge points, smooth 40°) instead of the 45° band. The band reads as a bevel
  and its 8 hard corner triangles are a shading break; `chamferSlot` has no
  meaning with a fillet because there is no separate band.
- `lathe(...)` now routes through `revolve`: **poles weld to one vertex**
  instead of a fan of `segments` coincident verts (those fans were producing
  zero-area faces — the NaN-normal risk from notes S12), and shading is
  smooth-by-angle. `capStart`/`capEnd`/`arc`/`smoothAngle` are new;
  `legacyNormals: true` restores the old per-ring path.
- `tube({ profile, miter })` — sweep a real section instead of a circle. Run
  the path through `meshdata.densify()` first so a mitre stays confined to its
  corner.

All three are opt-in by parameter; no existing call site changed meaning. The
circle-tube path is untouched (its winding fix from S14 is load-bearing).

## The gate: `window.__elysium.audit()`

`src/archkit/audit.ts` ports `Central_Perk/audit.py` with its tolerances
verbatim (0.13° normal, 1.5 mm plane distance, 2 cm² true clipped overlap,
30 mm scaled clash depth). It runs **in the page**, over the built scene:

    await window.__elysium.audit()                 // needs ?debug for ctx.scene
    await window.__elysium.audit({ clash: false })
    await window.__elysium.audit(someGroup, { bounds: null })

There is deliberately **no `tools/geometry-audit.mjs`**: the scene only exists
after the WebGPU renderer and the physics WASM have booted, so a headless port
would have to re-implement the game to have anything to audit.
`tools/archkit-selftest.mjs` (`node --experimental-strip-types`) proves the
algorithm instead — it plants a z-fight, a butt joint and a 60 mm
interpenetration and asserts the gate calls each one correctly — and checks
every primitive for closed shells, unit normals and outward winding.

Three adaptations that matter when reading a report:

- **Same-mesh pairs are compared.** `PartWriter` merges a whole assembly into
  one mesh per slot, so "different object" is not a usable filter here. Two
  triangles of one flat face share an edge and clip to zero area, so a
  well-built merged mesh still reports nothing; a same-mesh hit is a real
  defect (two parts stacked inside one slot).
- **Triangles below 2 cm² are dropped up front.** A clipped overlap can never
  exceed the smaller triangle's own area, so this is exact — and it removes the
  chamfer bands and lattice tubes that are most of the scene's triangle count.
- **The AABB pre-reject is inflated by the plane tolerance.** Two coplanar
  faces 0.5 mm apart have boxes that do *not* overlap; a bare box test silently
  drops exactly the pairs the gate exists to find. (Cost one debugging round.)

`backToBack` is informational and expected: it is every butt joint in the
scene — an underside on a top, a pad under a foot. Both parts are closed
solids, so the nearer face always wins. Only `zfight` must reach zero.

The clash pass is only as sharp as the writer split: with one merged mesh per
district it reports district-vs-district. Split writers per assembly when you
want it to name parts.

## The worked example

`src/archkit/kitBench.ts` is the reference object — 37 parts, 2 640 triangles,
two slots, seat 451 mm, and it passes its own audit with zero z-fight and zero
clash. `kit.bench()` delegates to it with the same signature and seat
contract, so every existing placement picked it up without an edit.

Two joinery decisions worth copying:

- The frame's **inset end stations are weighted 0 on the seat land and the foot
  bottoms**, so those two faces stay planar across the full 75 mm of the
  casting and their mating parts butt exactly, while everything else rolls in
  6 mm at the ends (which is where the moulded read comes from). A uniform
  `polyOffset` at the end stations would have lifted the foot bottoms 6 mm off
  their pads and left a 1.5 mm gap under the packers.
- The bench is authored **once** and each placement transforms a cached
  triangle soup. Forty benches would otherwise pay for forty rebuilds of the
  same 35 parts at boot.
