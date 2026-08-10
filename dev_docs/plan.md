# Mars Park — Implementation Plan

> Targets the **ultimate state** in one continuous build. Design canon: `dev_docs/design.md` (confirmed 2026-08-10). Stages are dependency ordering, not feature tiers — everything listed ships at final quality.

## 0. North star

Grounded photorealism with one authored moment of light. Every system is physically based — real scale, real Mars sun, real 0.38 g — and the entire graphics effort converges on a single frozen late afternoon, which we exploit ruthlessly:

- **Fixed sun ⇒ precomputed light.** The sky, environment lighting, and every static shadow can be computed once at load and cached. This buys AAA lighting density at runtime prices — it is the single biggest architectural advantage this project has, and every renderer decision should lean on it.
- **The lattice shadow-net is the signature graphic.** The dome's shadow across the ground must be *crisp everywhere* — it is treated as a first-class analytic system, not a byproduct of shadow maps.
- **Green is the rarest color.** Vegetation is sparse by design (Scott: "it shouldn't feel like Earth… not a garden-like place"). The green budget is one hero tree, bounded beds, and the greenhouse interior.
- **Emptiness reads as readiness.** Pristine materials, no decay, no grime beyond honest dust. Wear is *use*, not ruin: worn path centers, polished handrail tops, cleaned dome swaths.

Anti-goals: no demo-scale shortcuts, no placeholder art shipped as final, no invisible walls, no Earth-blue sky, no lushness.

## 1. World model (load-bearing decisions)

- **Frozen time.** Sun elevation **27°**, azimuth **250° (WSW)**, forever. No time system exists at all — only machine timetables (tram, robots, misting) driven by a park clock.
- **Gravity 3.71 m/s²** for the player and every simulated body. Physics is otherwise ordinary dry physics; dome air is still (interior "breeze" is a gentle HVAC drift field for foliage micro-motion only).
- **Interior only.** The exterior world is view-only through glass: no exterior colliders, no EVA, generous LOD. The dome shell is a physical collider; containment is always physical (glass, railings, curbs).
- **Coordinates & scale** (park floor = y 0, dome center = origin, +X east, +Z south):
  - Dome One: spherical cap, **⌀500 m, crown 120 m** (curvature radius ≈ 330 m). 24 primary meridian ribs, ring beams, triangulated sub-lattice, ~2.5 m glass panels. Foundation ring beam with sealed service portals + the tram portal (south).
  - Interior terrain: ±4 m sculpted relief, flat authored pads for plazas/buildings.
  - The Loop tram: ~1.2 km closed circuit, 3 stations (Portal S, Overlook W, Farmside E), top speed 8 m/s, ~4 min lap including dwells.
  - First Tree: 12 m ginkgo at origin, raised soil ring ⌀14 m.
  - Amphitheater: ~90 m bowl, ~4,000 seats, facing west.
  - Residential arc NW: 10 hab cylinders (⌀4.5 m × 12 m) + Common Hab; playground.
  - Farmside E: 3 vaulted glasshouses (12 × 60 m); The Works NE: machine hall, tank farm (spheres ⌀8 m), radiators, depot, maintenance yard.
  - Exterior: heightfield to ~10 km, skyline ring beyond (mesas W, crater rim S), boulder fields, 2 distant dust devils (drifting motion is fine; time-of-day change is not).
  - Eye height 1.7 m; every walkable surface reachable on foot obeys real human dimensions (stairs 17 cm risers, rails 1.1 m).
- **Session:** no saves, no persistence. Boot → entry screen → arrival tram → free roam.
- **Determinism:** all generation from seeded PRNG; zero `Math.random()`/`Date.now()` in world gen. `world/parkPlan.ts` is the single source of truth for layout, path graph, timetable, robot routes, scatter seeds — nothing hardcodes positions elsewhere.

## 2. Tech stack

| Piece | Choice | Notes |
|---|---|---|
| Bundler | Vite + TypeScript (strict), **React removed** | plain TS; minimal DOM for UI |
| Renderer | `three` latest at install, `three/webgpu` + `three/tsl` | WebGPU only; styled "WebGPU required" gate on the entry screen |
| Physics | `@dimforge/rapier3d-compat` | character controller, tram/robot kinematics, prop colliders |
| Lint/type | eslint + @typescript-eslint; `tsc -b` | run after every task |
| Debug-only | `tweakpane`, `stats-gl` behind dynamic import + `?debug` | never in the shipped path |
| Audio | WebAudio (native + PositionalAudio) | procedural synthesis by default |

No CDN assets, no texture downloads; materials are procedural TSL (real PBR textures only if Scott supplies them). DPR policy per CLAUDE.md: `maxPixels 4_000_000`, dpr ≤ 1.7.

## 3. Code architecture

`src/main.ts` is bootstrap only; `runtime/` owns the loop (fixed-step sim + variable render) and system registry and nothing else. Every feature is a system module (`init/update/dispose`), registered explicitly.

```
src/
  main.ts          bootstrap: WebGPU gate, entry screen, system registration
  runtime/         loop, registry, shared context
  core/            seeded PRNG, math, event bus, park clock/timetables, quality tiers, debug harness
  physics/         rapier world, collider factories, sync helpers
  render/          renderer setup, pass graph, exposure/grade/LUT, cached shadow clipmaps,
                   env probes, pipeline warmup
  sky/             Mars atmosphere + sun disc, baked sky/IBL
  exterior/        far terrain, skyline, boulder scatter, dust devils
  dome/            structure generator (ribs/rings/lattice/panels), ISRU glass material,
                   dust-film + cleaned-swath masks, analytic lattice shadow, interior haze & sun shafts
  world/           parkPlan (single source of truth), interior terrain & paths, districts/, props/,
                   signage, set-dressing (storytelling beats)
  archkit/         NASA-punk generators: hab kit, glasshouse kit, truss/gantry, guardrails, stairs,
                   deck plate, conduit/pipe routing, tanks, radiators, portal frames, benches/lamps
  materials/       TSL library (painted steel, alloys, ISRU glass, sintered brick, regolith states,
                   rubber deck, robot skins, emissive displays, plant materials)
  vegetation/      First Tree (hero), bounded beds & tufts, greenhouse crops
  robots/          shared chassis/articulation kit, task routines, groundskeepers, sweeper, mule, Panewalker
  tram/            track spline, vehicle dynamics, stations/doors, boarding, arrival sequence
  interiors/       greenhouse hall, overlook lounge, ops room, common hab
  player/          rapier controller, interaction raycast, seating
  audio/           engine, synth instruments, acoustic zones, footstep surfaces
  ui/              entry screen, contextual prompt, pause card
```

- Mesh-craft rules (CLAUDE.md) are enforced in archkit/writers: welded assemblies, no coplanar overlaps, no gap/overlap joins; close-inspection budget 0.5 m.
- Docs: each system lands with `dev_docs/systems/<name>.md` (design choices beyond code only).
- Debug harness: `?view=<postcard>` fixed cameras, `?pass=<name>` isolation (ao / shafts / shadows / depth / normals / no-post), `?tier=<0-2>`, `?debug` (tweakpane + stats + GPU timings).

## 4. Render pipeline

Skills: threejs-image-pipeline, threejs-bloom, threejs-exposure-color-grading, threejs-screen-space-ambient-occlusion, threejs-shadow-systems.

- Forward WebGPU, MSAA 4×, HDR half-float; single `PostProcessing` graph owns tone mapping.
- Pass graph: opaque + MRT (color/normal/depth) → GTAO half-res + bilateral upsample → glass/transparents (dome shell, glasshouse panes, tram windows) → volumetric interior shafts composited by depth → bloom (scene-relative: sun glints > emissive displays > grow lights) → fixed authored exposure → AgX → 32³ LUT grade (warm ochre bias, protected greens so vegetation stays precious, gentle highlight bloom into butterscotch).
- **Shadow strategy (the fixed-sun dividend):**
  1. **Analytic lattice shadow** — the dome lattice is parametric, so its shadow-net is computed as a world-space projected TSL function (exact rib/ring/frame widths projected along the sun direction), giving an infinitely crisp net at any distance — no shadow map could hold this over 500 m. Applied as a light modulator to all lit surfaces.
  2. **Cached static clipmaps** for architecture/terrain/props (rendered once at load, targeted invalidation only).
  3. One small **dynamic near cascade** for player-adjacent movers (robots, tram) + a dedicated tiny projected map for the Panewalker's traveling ground shadow.
- Static sky ⇒ sky env + a small set of interior IBL probes baked at load (park interior, each hero interior).
- Specular AA (roughness-from-normal-derivative) on all procedural materials.

## 5. Mars sky & exterior world

Skills: threejs-atmosphere-aerial-perspective, threejs-procedural-fields, threejs-procedural-planets (skyline forms).

- **Atmosphere:** dust-dominated Mie model — butterscotch sky brightest near the horizon, **blue circumsolar glow** (Mars's reversed colors), sun disc at true 0.35° angular size, irradiance ~43% of Earth's (authored exposure absorbs this). Computed once into the baked sky; an analytic aerial-perspective node (ochre inscatter + extinction) applies to exterior terrain and — very faintly — across long interior sightlines so 500 m reads as distance.
- **Exterior terrain:** ~10 km heightfield (Elysium Planitia character: flat lava plain, subtle ridges), sculpted mesa cluster W and crater rim S on the skyline ring, instanced boulder fields and rock scatter concentrated near the dome where scrutiny is highest. View-only: no colliders, LOD rings, updates effectively static.
- **Dust devils:** 2 far columns (soft raymarched/billboard hybrid), drifting slowly, catching sunlight. Motion, not weather.

## 6. Dome One (hero system)

Skills: threejs-procedural-geometry, threejs-procedural-materials, threejs-procedural-vfx (shafts).

- **Structure generator:** 24 meridian ribs + ring beams + triangulated sub-lattice compiled into instanced frame members (welded profiles, no coplanar junk at nodes — node spheres/gussets where members meet); glass as a single merged shell mesh in few draws (no per-panel sorting). Foundation ring beam, portal frames, service doors.
- **ISRU glass material:** thin transmission (no scene refraction — panels are thin and flat), Fresnel reflection from interior probes + analytic sun glint, faint green edge tint, per-panel manufactured normal ripple (sells realism at glancing angles), **exterior dust-film mask** — procedural gradient heaviest near the base, cut by clean swaths along the Panewalker's rail history.
- **Interior haze & shafts:** a faint dust/air scattering slab (ground → ~40 m) modulated by the analytic lattice shadow, producing structured crepuscular shafts under the ribs without ever reading as fog. Quality-tiered step count; composited by depth.
- The dome is a Rapier collider (trimesh shell, coarse).

## 7. Interior groundworks & vegetation

Skills: threejs-procedural-fields, threejs-procedural-vegetation.

- 1024² interior heightfield: sculpted relief, flat pads, curb-edged path network from parkPlan. Shared field stack (one cause, many channels): regolith compaction (loose ↔ tracked ↔ worn), path-wear along desire lines, rake-pattern masks for the Regolith Gardens, bed placement, scatter densities.
- Materials: loose regolith (coarse normal detail, footpath-worn centers), **sintered-regolith pavers** on main walks (ISRU brick — subtle firing color variation), steel curbing, rake-spiral displacement in the gardens, placed excavation boulders (sculpted, not scattered spheres).
- **Vegetation (the whole green budget):** the **First Tree** — a hero-crafted procedural ginkgo (trunk/branch lofts with real ramification, petiole-hinged leaves with barely-there HVAC shimmer) in its soil ring with a dense groundcover collar; bounded steel-edged beds of sedge/groundcover tufts (low counts, high per-blade quality) along the Meridian Walk and gardens; nothing green outside beds. Greenhouse crops live in §9.
- Rapier heightfield + static colliders for curbs, beds, boulders.

## 8. Archkit & material library

Skills: threejs-procedural-architecture, threejs-procedural-geometry, threejs-procedural-materials.

- Generators (parametric, seeded, material-slot meshes): hab cylinder kit (ring-stiffened shells, end domes, window frames, porch decks), glasshouse vault kit, truss/gantry members, guardrails (international orange, 1.1 m), stairs/ramps/kick-plates, deck plating with real fastener detail at close range, spline-routed conduit & pipe runs with brackets and labels, spherical tanks + saddles, radiator arrays, tram portal iris, station canopies, signage system (stencil typography rasterized to crisp SDF-style textures), fixed bench/lamp prototypes placed via instancing.
- Amphitheater: regolith-cast seating rows compiled as ring segments (exact-fit, no gaps).
- **materials/**: white painted steel with curvature/AO edge wear, bare aluminum, anodized fittings, sintered brick, rubberized deck, glasshouse glass, fabric (porch chairs), robot skins (paint + decals + dust), **emissive display material** for ops dashboards (canvas-rendered live UI textures), soil, grow substrate. All TSL, all specular-AA'd.
- Wear discipline: use-wear only (polished rail tops, path centers, door thresholds); zero rust/ruin.

## 9. Hero interiors (4)

Sliding doors with real pocket reveals (no coplanar cheats), threshold acoustic swap, interior IBL probe each. Interior fixtures on — justified because interiors sit dimmer than the daylit park.

1. **Greenhouse Hall (Farmside):** hydroponic rack rows (instanced crop species — lettuce, basil, dwarf wheat, tomato), warm-white grow bar lighting with faint magenta accent rows, drip lines, harvest-log chalkboard, **misting cycle**: timed fog bursts drifting down the aisles through sunbeams (instanced volume puffs; this is irrigation hardware, not a water feature). The densest green in the game.
2. **Overlook Lounge (west rim):** long window wall facing the sunlit plain, lounge chairs, warm interior against cold vista, ghost reflections in the pane.
3. **Ops Room (The Works gallery):** dashboard wall **live-mirroring actual game state** — tram position on the loop, robot task queue, dome pressure/air numbers, shadow-cache status. Diegetic truth; the displays never lie.
4. **Common Hab (Residential):** kitchen, mismatched chairs, board game mid-play, personal clutter — the domestic storytelling core.

## 10. Player, camera, interaction

Skill: threejs-camera-direction.

- Rapier character controller: walk 1.6 m/s, sprint 4.2 m/s (low-G lope), eye 1.7 m, smooth step handling, slope limits. **Jump: v₀ 3.0 m/s under 3.71 m/s² → ~1.2 m apex, ~1.6 s hang** — floaty but composed; airborne control minimal; landing recovery soft. Subtle lope in the headbob, tuned for comfort.
- Interaction: proximity + view-cone raycast → single contextual DOM caption (stencil type, fades). Interactables: hero doors, tram call plates + boarding, benches/seats everywhere (amphitheater rows included), greenhouse misting override, playground swing (sittable).
- Seating: smooth authored camera in/out (no cuts anywhere in the game), seated free-look with comfortable limits.

## 11. The Loop (tram) & arrival

Skill: threejs-procedural-animation.

- Track: closed C² spline (~1.2 km) with solved banking on curves, rail + sleeper + support geometry generated along arc length; the south segment dives into the portal tube (the only path through the dome wall).
- Vehicle: single articulated two-car tram, kinematic on arc-length dynamics (authored accel ≤ 1.1 m/s², top 8 m/s, station dwells), sliding doors, interior cabin with seats and window glass; positional rail-sing + door chimes.
- Boarding at 3 stations via contextual prompt; ride seated with free-look; disembark on dwell.
- **Arrival sequence (game start):** you begin seated in the tube — running lights, tunnel boom — portal irises, and the tram emerges into the full park in one unbroken shot. Requires pipeline warmup during the entry screen (precompile all pipelines, pre-render hidden frames) so the reveal cannot hitch. The same tram keeps running its timetable afterward; the arrival is just its normal service.

## 12. Robots

Skills: threejs-procedural-geometry, threejs-procedural-animation.

- Shared chassis kit (crafted wheels/rockers/masts/arms, decals, wear) → **groundskeepers ×2** (bed tending, rake passes in the gardens), **sweeper ×1** (path circuit), **cargo mule ×1** (Farmside ↔ depot), dormant charging row at the yard (one with painted-on eyes — set dressing).
- Routines: parkPlan route graph + task loops on the park clock; kinematic bodies with real wheel-contact roll, task poses (arm articulation), and servo/drivetrain positional audio. Player collision: they stop politely, resume after.
- **Panewalker:** dome gantry on lattice rails high overhead, 0.4 m/s glacial traverse, brush arms in slow sweep; its projected traveling shadow (dedicated small shadow map) is the park's only "cloud". Its rail history drives the clean-swath mask in §6.

## 13. Audio & the park clock

- Procedural synthesis (WebAudio): the dome's room tone (vast soft air bed), HVAC breath cycles, sparse glass ticks (thermal), per-surface footsteps (regolith crunch / brick click / deck ring / interior floors), servo whines, tram rail-sing with doppler + door chimes, greenhouse mist hiss, vapor vents at The Works. **No music** (confirmed).
- Acoustic zones: open dome (huge, soft, distant sources low-passed), interiors (small warm rooms), tram cabin (tight), portal tube (boomy). Crossing a threshold audibly swaps worlds.
- Park clock (`core/`): tram timetable, robot task rotations, misting cycle, Panewalker traverse — the machinery is the schedule; no announcements, no PA.

## 14. UI

- **Entry screen:** colonist boarding-pass motif over a live blurred view; doubles as WebGPU gate and load progress (styled as a systems checklist); click to enter = pointer lock, seated in the tram.
- In play: the single contextual caption only. No HUD, no minimap; FPS/GPU readouts live behind `?debug` only.
- **Pause card (Esc):** resume / quality tier / volume, styled as the back of your colonist ID.

## 15. Performance plan

Reference hardware: **Scott's Apple M5, 32 GB** (detected 2026-08-10). Target **60 fps** at the CLAUDE.md DPR policy (≈4 MP); hard floor 20 fps with zero hitches/freezes. Three quality tiers (volumetric steps, GTAO res, scatter density, exterior LOD radius), auto-benched on first load, overridable in pause.

Frame budget (16.6 ms): opaque scene 4.5 · dome glass + lattice 2.0 · interior shafts/haze 1.5 · GTAO 1.2 · shadows (cached; dynamic slivers) 1.2 · exterior terrain 1.0 · bloom/exposure/grade 1.0 · robots + tram 0.8 · physics 0.8 · headroom 2.6.

Key strategies: everything static is precomputed at load (sky, IBL, shadow clipmaps, analytic lattice shadow is pure math); instancing/BatchedMesh for lattice frames, boulders, tufts, seats, racks, conduit brackets; single-shell dome glass; procedural materials = no texture streaming; full geometry to ~150 m interior, generated LOD beyond; load < 8 s to the tram seat.

## 16. Validation

Skill: threejs-visual-validation.

- **The ten postcards are the visual contract** (`?view=arrival|firsttree|rim|panewalker|greenhouse|amphitheater|works|porch|gardens|jump`), matching design.md exactly. Graphics changes are judged at these fixed cameras against the postcard intent.
- `?pass=` isolation for every major effect; no-post baseline; scatter-seed sweep (3 seeds → coherent park, authored placements invariant); GPU timings under `?debug`.
- Every stage ends: lint + typecheck clean, `dev_docs/systems/*.md` written/updated, notes.md appended when a lesson surfaced.

## 17. Build order

| # | Stage | Delivers | Acceptance |
|---|---|---|---|
| S0 | Foundation | React stripped; deps installed; WebGPU boot + entry-screen shell; fixed-step loop, registry, PRNG, park clock, debug harness | boots to empty HDR scene; `?debug` works |
| S1 | Image pipeline | pass graph, MSAA, GTAO, bloom, exposure→AgX→LUT, specular-AA base | test scene passes `?pass=` checks |
| S2 | Mars sky & sun | atmosphere model, sun disc, baked sky/IBL, authored exposure | horizon-to-zenith sky reads as Mars, blue glow at sun |
| S3 | Exterior Mars | far terrain, skyline mesas/crater, boulders, dust devils, aerial perspective | `?view=rim` (pre-dome) reads as standing on Mars |
| S4 | Dome One | structure gen, ISRU glass, dust film, analytic lattice shadow, haze & shafts | `?view=gardens` sky-through-lattice + shadow-net postcard-grade |
| S5 | Interior groundworks | terrain, paths, regolith/brick materials, curbs, boulders, colliders | walkable landscape with worn paths under the net |
| S6 | Player & interaction | controller, 0.38 g jump, prompts, seating | `?view=jump`; sit on a test bench; comfort verified |
| S7 | Archkit & materials | full generator kit + library, hero-tested on Portal Station | station close-inspection at 0.5 m holds |
| S8 | Park assembly | parkPlan final; all districts, props, signage, set-dressing, containment | full park walkable end to end; storytelling beats placed |
| S9 | The Loop & arrival | track, tram, 3 stations, boarding, warmup, unbroken arrival | `?view=arrival` plays hitch-free from cold start |
| S10 | Hero interiors | greenhouse hall, overlook lounge, ops room (live dashboards), common hab | all four enterable, postcard-grade, acoustic swap |
| S11 | Robots | chassis kit, 4 ground robots + routines, Panewalker + traveling shadow + clean swaths | `?view=panewalker` shadow sweep; robots run the clock |
| S12 | Vegetation | First Tree hero, beds/tufts, greenhouse crops + misting | `?view=firsttree`, `?view=greenhouse` postcard-grade |
| S13 | Audio | synth engine, zones, footsteps, all sources on the clock | eyes-closed test: the park is legible by ear |
| S14 | Final | LUT/grade lock, tiers + auto-bench, perf pass, full 10-postcard sweep | 60 fps on the M5 across all postcards; no hitches |

## 18. Needs from Scott

1. **Package approval** (rule: ask before installing): three (latest), @dimforge/rapier3d-compat, tweakpane + stats-gl (dev-only) — and removal of react/react-dom + plugin. Approving this plan approves the installs/removals.
2. **Optional, at your leisure:** a regolith/soil macro-detail PBR set and a brick/fabric set would raise ground realism further (everything has a procedural default; nothing blocks). Likewise a footstep sample pack if you'd rather not have synthesized steps.
3. **Reference hardware** assumed to be this M5 MacBook Pro — say so if you'll judge on anything else.

## 19. Risks & mitigations

- **Lattice shadow fidelity over 500 m** — no shadow map survives that span with 10 cm members; hence the analytic projected lattice shadow (§4/§6) as a first-class system. Shadow maps only for what genuinely needs them.
- **Glass omnipresence** (dome + glasshouses + tram + lounges) — single-shell merged draws, no per-panel sorting, transmission without scene refraction; probe-based reflections, never SSR-everything.
- **TSL/WebGPU API churn** — pin the installed minor version; upgrade deliberately between stages only; note breakages in notes.md.
- **Two environments (exterior + interior)** — exterior is view-only and static-sun: aggressive LOD, no physics, effectively free after S3.
- **Arrival must not hitch** — full pipeline precompilation + hidden warm-up frames behind the entry screen; measured before S9 closes.
- **0.38 g feel** — floaty can drift into moon-silliness; jump/lope tuned toward composure, validated early in S6, revisited after content lands.
- **Scope** — parkPlan-driven layout means content grows without code churn; stage gates keep every increment shippable-quality.
