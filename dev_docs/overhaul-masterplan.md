# Mars Park OVERHAUL Masterplan (2026-08-10)

> **STATUS: EXECUTED.** All waves complete (studies → toolkit → foundations →
> object fleet → transitions → integration). See dev_docs/notes.md
> "Overhaul integration pass" for the closing lessons + polish backlog.

**Read this first.** Every rebuild agent works from this document plus the craft
guides in `dev_docs/craft/`. The owner reviewed the first complete build and
rated it ~40%: "looks like a flat lower quality game." The target is
`ref_images/mars_park.png` — study it before writing any code.

## The verdict on the first build (what went wrong)

1. Ground reads as generic flat desert: uniform color, no displacement, no
   texture detail, no rocks/tracks/variation.
2. The park is mostly empty regolith; built content too sparse for the dome.
3. Objects are "3D-LEGO": primitives glued together. Every object is assumed
   BAD by default — rebuild or massively overhaul; no marginal tweaks.
4. No mountains: outside should be a valley ringed by big rocky Mars ridges.
5. Camera transitions (tram interior↔outside) crude and blunt.
6. Dome glass reads as an opaque tan wall instead of near-invisible glazing
   with the landscape behind it.

## The reference image contract (ref_images/mars_park.png)

What AAA looks like for this game — every wave pushes toward it:

- **Dome**: elegant steel gridshell — slender radial ribs + concentric rings,
  oculus compression ring at crown — over glass so clear it's mostly visible
  as reflections/tint. The structure is the visual, not the glass.
- **Outside**: huge rocky red mountains fill the lower view through the glass
  in every direction; soft salmon-butterscotch sky above them.
- **Floor**: polished rust-toned paving with expansion joints, inset guide
  tracks curving through it, embedded low floor lights, white concrete curbs
  and raised planter walls. NOT open sand.
- **Green**: lush — but confined to raised planters and glass buildings
  (hydroponic shelving visible through glazing). Open ground stays mineral.
- **Buildings**: multi-story glass drums/pavilions with visible lit interiors,
  external pipe runs, railed roof terraces, stencil signage, panel seams.
- **Light**: dusk-warm; low sun + artificial layer (backlit signs, floor
  strips, interior glow) reflecting in the polished floor. Deep soft AO
  everywhere, gentle bloom on emitters.

## New world frame (wave 0 — DONE)

- Dome: **260 m diameter** (was 500), crown **64 m**, glass foot r=130,
  sphere R=164.03, center y=−100.03, θ_base=0.9147. `src/dome/latticeField.ts`
- Usable floor r≈122; rim promenade r=112 (`PARK` in parkPlan).
- Loop tram: r=97 street-running in a paved **boulevard** annulus r 91–103,
  stations Portal (0,97), Overlook West (−97,~0), Farmside (+97,~0).
- Arrival tube crosses the dome wall at **z=128.4**, spur from z≈420.
- Plaza r=26 around the First Tree; paved spokes (see PATHS); Commons
  pavilion (−2,−54); Hydroponics tower (52,18); water tower (66,−34);
  Amphitheater bowl (−52,34) r24; gardens (−38,−40) r28 + (−12,60) r16;
  hab arc r=88 NW; Farmside glasshouses x≈70; Works cluster NE inside the
  loop (machine hall (48,−58), tanks (70,−40), yard (28,−70)) with the
  radiator field in the outer band (104,−34).
- HARD RULE learned the hard way: no structure may enter the guideway swept
  volume r 94.5–99.5 (any bearing); check center-radius + extents against
  BOULEVARD before placing anything.
- Interior relief: ±~0.8 m swales, flatter near center; every pad flattens.
- All layout facts live in `src/world/parkPlan.ts` — read it, never hardcode.

## Non-negotiables (CLAUDE.md, restated)

- Realism first; >20 fps; no freezes/stutter.
- ZERO mesh sloppiness: no coplanar faces, no unintentional overlaps/gaps.
  Excessive loose assembly is the enemy — model parts that join, share
  profiles, and read as manufactured.
- WebGPU + TSL only (three 0.185.1, `three/webgpu`, NodeMaterials). No WebGL.
- Procedural materials (no downloaded assets).
- No HUD; contextual prompts only.
- Lint + typecheck must pass after every task: `./node_modules/.bin/tsc -b`
  and `./node_modules/.bin/eslint src --max-warnings=0`.
- Do NOT commit. Do NOT edit files outside your ownership (below).

## Quality bar per object (the "friends" standard)

Every object gets the treatment in `dev_docs/craft/geometry-craft.md`:
decomposed like a manufactured product (chassis/panels/trim/fasteners),
profile-driven curved surfaces, chamfered/beveled edges everywhere a real
object has them, shadow gaps and reveals between parts, correct joins (no
float, no z-fight), deliberate material slots, real-world dimensions. Budget
guidance: a hero object (tram car, First Tree, Commons facade) can spend
50–150k triangles; background props 2–20k. We have GPU headroom: current
scene is 1.9 M tris at 250+ fps — we can afford 6–10 M total.

## Verification protocol (every agent)

The dev server runs at http://localhost:5173 (vite; every src edit
hot-full-reloads). Headless screenshot loop WITHOUT the browser pane:

1. `node scratchpad/shot-server.mjs &` — HTTP receiver on :9911 (if not
   already running; check first) saving JPEGs to `scratchpad/shots/`.
2. Drive the page via the Browser-pane MCP tools if available to you;
   otherwise ask the orchestrator for screenshots. In-page helpers:
   `window.__elysium` exposes `{ctx, registry, loop, step(n)}`;
   `?view=<bookmark>` boots a fixed camera (see src/core/postcards.ts);
   `step(n)` advances synthetic frames (batch ≤1500).
3. Judge your work against ref_images/mars_park.png, not against "better
   than before".

## Waves & file ownership

Shared read-only for everyone: parkPlan.ts, craft docs, materials/library.ts
(extend via your own module-local materials unless you own it).

- **W1 ground** (owner: ground agent): world/groundworks.ts,
  world/interiorHeight.ts, new world/paving.ts — plaza/boulevard/spoke slabs,
  curbs, floor lights, joints; regolith displacement + rich material; rocks.
- **W1 exterior** (exterior agent): exterior/terrainHeight.ts,
  exterior/exteriorTerrain.ts — valley + mountain ring, rock material,
  boulder fields, dust devils.
- **W1 dome** (dome agent): dome/latticeField.ts (families/geometry consts),
  dome/domeGeometry.ts, dome/glassShell.ts, dome/domeSystem.ts — gridshell +
  clear glass + oculus; keep analytic shadow contract.
- **W1 light** (lighting agent): sky/*, render/grade.ts, render/pipeline.ts
  (tuning only), world/lightFixtures.ts (new) — dusk palette, artificial
  light layer, bloom/AO tune.
- **W2 tram** (2 agents): tram/vehicle.ts | tram/track.ts + world/portalStation.ts.
  tramSystem.ts stays with the orchestrator/transitions agent.
- **W2 buildings** (agents by district): world/districts/farmside.ts,
  works.ts, residential.ts, leisure.ts, interiors.ts + new commons.ts,
  hydroTower.ts. opsScreens.ts stays as-is (screens still true).
- **W2 amenities**: world/parkAmenities.ts + archkit/kit.ts additions.
- **W2 robots**: robots/chassis.ts (+ robotsSystem visuals only).
- **W2 vegetation**: vegetation/*.
- **W3 transitions**: tram/tramSystem.ts camera/boarding + player/*.
- **W3 integration** (orchestrator): audio, colliders, postcards, perf, docs.

## Coordination rules

- Never `git` anything. Never touch files you don't own; if you need a
  change in a shared file, put the exact requested diff in your final report.
- New exports from your files are fine; keep existing export names working
  (other systems import them).
- If you must regenerate kitMaterials slots, ADD slots — never rename.
- After your build: tsc + eslint clean, then report what you changed, what
  to look at (bookmark names / coordinates), and any shared-file requests.
