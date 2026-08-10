# Skills → Mars Park subsystem map

Which **example source files** in `~/.claude/skills/threejs-*/` each rebuild agent should read, what to lift by name, what breaks under r185 WebGPU+TSL, and what to skip. Reference target: `ref_images/mars_park.png` — glass gridshell dome, Mars massifs outside, polished paving with inset tram rails, raised planters, multi-storey curved-glass pavilions, dusk + warm artificial light.

**Rule for every agent: read the example CODE, not just SKILL.md/references.** The md files describe; the code contains the epsilons, the winding fixes and the failure guards that actually decide whether geometry is AAA or sloppy.

---

## 0. Language triage — read this before opening anything

Mars Park is **WebGPU + TSL only**. The examples are not uniform. Sort by cost-to-adopt:

| Class | Files | Cost |
|---|---|---|
| **TSL-native, lift near-verbatim** | `procedural-geometry/examples/sport-motorcycle/source/*` · `porcelain-brass-submarine/source/*` · `formula-one-race-car/source/race-car-materials.js` · `procedural-architecture/examples/procedural-financial-tower/{building-system,shadow-clipmaps}.js` · `procedural-materials/examples/spectral-dispersive-glass/{glass-optics,spectral-glass-material}.js` · `parallax-occlusion-mapping/examples/silhouette-relief/{ParallaxOcclusion,silhouette-relief-system}.js` · `procedural-vfx/examples/volumetric-fluid-fire/source/**` | hours |
| **Renderer-agnostic** (pure JS geometry/data — runs on WebGPU unchanged, only the material constructors change) | `procedural-vegetation/examples/structured-ash-growth/{tree-system,ash-preset}.js` · `procedural-surface-ivy/source/{ivy,leafTexture,bvh,wind,flowers}.ts` · `procedural-planets/examples/procedural-planet-surface/terrain-field.js` · `procedural-geometry/examples/sculpted-gallery-frame/frame-geometry.js` · `parallax-occlusion-mapping/examples/silhouette-relief/bulkhead-height-maps.js` (Canvas2D) | hours |
| **GLSL — algorithm survives, code does not** | `procedural-materials/examples/hybrid-soil-moss-surface/*` (`onBeforeCompile` chunk surgery) · `procedural-planet-surface/planet-system.js` (`ShaderMaterial`) · `procedural-vegetation/examples/gpu-computed-grass/*` (WebGL MRT-as-compute) · `stylized-meadow-grass/*` · `lava-flow-surface` · `raytraced-diamond` | days |
| **GLSL + `postprocessing` lib + shipped LUT assets** | `atmosphere-aerial-perspective/examples/lut-aerial-perspective/**` · `volumetric-clouds/**` · `temporal-surfaces/**` · `precipitation-surfaces/**` · `raymarched-space-effects/**` | weeks — see §11/§13 before committing |

`building-system.js` is a **bundler capture** — `import * as THREE from "three/webgpu"` appears twice (lines 2 and 2574) with collision-renamed symbols (`THREE2`, `quad2`, `cornerTrimJoints2/3`, `module2`). Dedupe when lifting.

---

## 1. Interior ground, paving, tram-track inset

**Study**
- `threejs-parallax-occlusion-mapping/examples/silhouette-relief/ParallaxOcclusion.js` (487 ln, **TSL**) — `parallaxOcclusionUV(heightMap, opts)`; ships as `three/addons/tsl/utils/ParallaxOcclusion.js` in r185, so you may be able to import it rather than vendor it. **Check the installed addon first.**
- `.../silhouette-relief/silhouette-relief-system.js` (260 ln, **TSL**) — `buildRelief()` and `makePlatingMaterial()`: the complete wiring of POM into `MeshStandardNodeMaterial`.
- `.../silhouette-relief/bulkhead-height-maps.js` (309 ln, Canvas2D) — `createFloorMap()`, `createWallMap()`, `wearEdges()`, `grimeShadow()`: how to author a height map procedurally with 2D canvas and ship it as `CanvasTexture`.
- `threejs-procedural-fields/references/field-stack-recipes.md` §4 "Wetness-coupled game terrain" (L123–151) and §1 "Stable coordinate ownership" (L17–44).
- `threejs-procedural-materials/references/hybrid-soil-moss-surface.md` — the whole file; §"Mound formula" (L138–151) and §"Crack formula" (L158–168) are copy-ready.
- `threejs-procedural-architecture/examples/.../building-system.js` `appendAtlasQuad` (:2610), `segmentCuts` (:2684), `atlasUvs` (:2693) — physical-tile UV subdivision.

**Lift by name**
- `parallaxOcclusionUV` with `silhouette: false` for the floor (the floor plane has no silhouette to clip) — exactly how `silhouette-relief-system.js:232–241` does it: `scale: depthScale.mul(0.4)`, `worldPerTile [3.2, 3.2]`, `uvNode: uv().mul(5)`.
- `buildRelief()`'s **two separate `parallaxOcclusionUV()` calls** (lines 27–28) — one for the material body, one for the normal graph. The header comment at `ParallaxOcclusion.js:57–62` states the rule: `normalNode` compiles in its own sub-build, so a shared call result miscompiles. Non-negotiable.
- The **depth-correct march**: `silhouette-relief-system.js:106–116` reprojects the marched world point and writes `material.depthNode` + `material.receivedShadowPositionNode`. This is what makes inset tram rails and paver joints receive shadows and occlude correctly instead of floating on the flat plane. **This is the single highest-payoff pattern for the paving.**
- `relief.shadow(lightDir, {steps, strength})` (`ParallaxOcclusion.js:439–483`) for self-shadowed groove interiors at 27° sun.
- `field-stack-recipes.md` L136 `grassness = smoothstep(0.01, 1, normalWorld.y^1.6)` — rename to `dustCoverage`, feed `normalWorld.y` + cavity, drive **albedo + roughness + normal-flattening from the one mask**. Mars Park has no dust-settling layer on interior paving today; this is the missing wear system.
- Wear-as-use (per `plan.md` §0): `wetness` in recipe 4 (L143–147) is structurally the template for *cleared* dust along desire lines — same shape, subtractive.

**r185 gotchas**
- POM geometry needs `geometry.computeTangents()` (`silhouette-relief-system.js:133, 180, 230`). Our `archkit/writer.ts` does not emit tangents — add a tangent path or a `computeTangents()` call for any POM-bearing surface.
- Inside the marched region, **never use implicit derivatives**: `textureLevel(map, uv, 0)` for height fetches, `texture(map, uv).grad(gradX, gradY)` for colour (`ParallaxOcclusion.js:162–169, 364`). The `dFdx(uvNode).clamp(-0.1, 0.1)` guard (L162) prevents the seam-mip collapse.
- With `alphaTestNode` set, do not call `sample()` inside `normalNode` — driver miscompile at grazing angles (header note L58–62). Use `textureLevel`.
- `alphaToCoverage = true` interacts with our MSAA-4× scene pass (`src/render/pipeline.ts:84`) — verify, don't assume.
- The atlas subdivision cost is real: a 10×13 m wall becomes 63 quads at 1.45 m tiles. **For park-scale paving prefer repeat-wrap UVs (`appendQuad`'s non-atlas path, uvScale 0.35 ⇒ 2.857 m per repeat); reserve subdivision for close-inspection surfaces only.**

**Payoff** Inset rails, paver joints, expansion gaps, and drainage channels get real depth and real self-shadow at 0.5 m inspection with zero added triangles — and the reference image's floor is the single largest surface in frame.

---

## 2. Exterior mountains + Mars atmosphere

**Study**
- `threejs-procedural-planets/examples/procedural-planet-surface/terrain-field.js` (72 ln, pure JS) — `terrainSample(direction)` L51–72 is the whole field composition; `valueNoise3` L10–30, `fbmNoise3` L32–47.
- `.../planet-system.js` (417 ln, **GLSL ShaderMaterial**) — read for three blocks only: the **tangential domain warp** (L230–238), the **biome-mask architecture** (L261–301), and the **derivative bump + specular-AA pair** (L303–333).
- `threejs-procedural-planets/references/planet-field-and-atmosphere-systems.md` — §Mars identity list (L360–368) and §dune coordinate (L369–375).
- `threejs-procedural-fields/references/field-stack-recipes.md` §2 band table (L57–63) and §3 altitude filtering (L103–121).
- `threejs-atmosphere-aerial-perspective/references/atmosphere-system-contract.md` — **the dynamic-integration path at L113–156**, not the LUT path.

**Lift by name**
- `terrainSample`'s band composition **structurally verbatim**: `0.62·continental(5 oct) + 0.24·highlands(4 oct) + 0.34·ridged` where `ridged = 1 - |2n-1|`. Ridged is what makes mountains; raise its weight and `pow()` it for Mars scarps/mesas.
- The **3-channel domain warp before the fbm stack** (`terrain-field.js:56–61`, amplitude 2.4 at freq 0.75). Without it, ridges read as a grid.
- `slope = 1 - abs(dot(normal, up))` (`planet-system.js:256`) → drives rock vs regolith vs dust.
- **The derivative bump + specular AA pair** (`planet-system.js:303–333`) — *the single most valuable block in the planets skill for us*. `roughness = clamp(sqrt(base² + min(variance*0.8, 1)), 0, 1)` with `variance = max(dot(dFdx(N),dFdx(N)), dot(dFdy(N),dFdy(N)))`. Mandatory on distant massifs where one triangle covers many pixels. Same formula in `procedural-pbr-system.md` L42–50.
- **Detail filtering by strength, never frequency** (`planet-system.js:307`; `field-stack-recipes.md` L120–121). Restate `uCameraAltitude` as fragment distance.
- Dune coordinate: `u = dot(pos, windDir)`, `v = dot(pos, perpWind)` (planets ref L369–375) — trivially portable to a plane, exactly right for regolith between massifs.

**DROP from the planets example** — `createTerrainPlanetGeometry` L8–112 entirely (cube-sphere, `directionKey` string-Map dedup is catastrophic at our vertex counts, `pushOutwardTriangle` centroid winding); everything spherical (`radial`, `radiusKm = 12000`, `abs(radial.y)` latitude); **the whole continent/ocean/coast axis** (`landMask`, `coastMask`, `oceanDepth`) — Mars has no sea level; `humidity`/`temperature`/`lush`; the whole-sphere `THREE.LOD` scheme (prose-only, and the ref itself warns it's wrong for ground scale); `computeVertexNormals()` — derive normals analytically by finite-differencing the same `Fn`; the hand-rolled Blinn-Phong (L335–357).

**ADD — absent from the skill entirely**
- Real craters. `terrain-field.js` has **no crater operator**; the ref admits (L90–92) its cavity noise "is not a crater model with explicit bowl/rim/ejecta topology" while SKILL.md L32 demands one. For the crater rim S in `plan.md` §1, author 2–5 explicit SDF stamps (bowl + wall + rim + ejecta) blended into the height field. Use `field-stack-recipes.md` §6 (L182–201, which names crater distribution explicitly) to stratify their placement.
- Dust mantling + dark slope streaks — named in the planets ref (L360–368) as Mars identity, implemented nowhere. Build from slope + curvature.

**Atmosphere — the hard call, decide before coding**
The LUT example ships **pre-baked Earth textures as binary assets** (`assets/lut-aerial-perspective/scattering.bin` = 8.4 MB, `transmittance.bin`, `irradiance.bin`). `PrecomputedTexturesLoader.ts` is a **loader only** — there is zero precompute code in the skill. `AtmosphereParameters.ts:42–74` exposes only `solarIrradiance`, `sunAngularRadius`, `bottomRadius`, `topRadius`, `rayleighScattering`, `mieScattering`, `miePhaseFunctionG`, `muSMin`, and the two `*RadianceToLuminance` vectors. **The Rayleigh/Mie/absorption *density profiles* (`expScale -0.125` / `-0.833333`), Mie extinction, ozone absorption and ground albedo are baked into the .bin files.** Mars's defining look — dust at ~11 km scale height instead of aerosol at 1.2 km, no ozone — lives entirely inside the bake. **Loading Earth LUTs and only editing `AtmosphereParameters` cannot produce Mars.** Do not attempt it.

What to actually do:
1. Keep `src/sky/skyRadiance.ts` (the hand-authored butterscotch column with the cool blue circumsolar lobe and Neckel–Labs limb darkening) and the one-shot PMREM bake. For a *frozen* sun a PMREM captures the disc and the anisotropic dust lobe better than the skill's L1 `SkyLightProbe` can.
2. **Upgrade `src/exterior/marsAerialPerspective.ts`** with the contract's one non-negotiable rule (`atmosphere-system-contract.md`, echoed in `AerialPerspectiveEffect`): **transmittance and inscatter are separate signals — do not collapse them into one fog colour.** Today it is a single `mix(scene, inscatter, amount)` with one scalar extinction. Make extinction a `vec3` so distance reddens, and split multiplicative transmittance from additive inscatter. ~20 lines, most of the physical read.
3. Port `helpers/functions.ts` verbatim (`safeSqrt`, `clampDistance`, `rayIntersectsGround`, `distanceToTopAtmosphereBoundary`, `getTextureCoordFromUnitRange`) — small, correct, and the half-texel convention must match if you ever do bake.
4. Skip the entire `source/geospatial/` layer (Ellipsoid/WGS84/ECEF/`getOsculatingSphereCenter`). A 500 m park on a graded pad needs one sphere of `bottomRadius = 3_389_500`. That deletes ~2/3 of the port.
5. `celestialDirections.ts` is Earth-only (`astronomy-engine`, `Body.Sun` geocentric) — useless; we have a frozen sun anyway.
6. Bug to not inherit: `SunDirectionalLight.ts:43` destructures `irradianceTexture` but the interface declares `transmittanceTexture` (L12) — following the type signature yields a permanently uncoloured sun.

---

## 3. Dome structure + glass

**Study**
- `threejs-procedural-geometry/examples/sport-motorcycle/source/mesh-kit.js` (588 ln, **`three/webgpu`**) — the best mesh kernel in the whole pack.
- `threejs-procedural-geometry/examples/porcelain-brass-submarine/source/mesh-kit.js` (302 ln) — the smaller sibling; `gridGeometry` with the same seam handling, `latheZ`, `sweepTube` with `roundEnds`.
- `threejs-procedural-geometry/references/profile-sweeps-and-mesh-writers.md` — §Sculpted frame profile (L17–50), §Selection and LOD (L152–175).
- `threejs-procedural-materials/references/dielectric-glass-optics.md` (325 ln) — read **all** of it before touching dome glass.
- `threejs-procedural-materials/examples/spectral-dispersive-glass/{glass-optics.js, spectral-glass-material.js}` (**TSL**).

**Lift by name — from `sport-motorcycle/source/mesh-kit.js`**
- `class Writer` (L47–151): `vert/tri/quad/grid/fan/band/geometry`. `grid()` (L60–98) has the **explicit seam column** (`closeU` emits `C+1` columns) so the UV wrap is not shared with the geometric seam — this is the difference between a clean gridshell and a visible seam line. `band()` (L123–141) with `hard: true` emits per-quad flat normals; `hard: false` routes to `grid` for smooth. **You need both on the dome: smooth along the rib tube, hard at node collars.**
- `transportFrames(points, seedUp)` (L203–227) — parallel-transport frames, minimal twist. **Use for meridian ribs.** `uprightFrames(points, up)` (L230–244) — world-up locked, no roll. **Use for ring beams and the foundation ring so their section never rolls.** Having both, and choosing per member, is the craft point.
- `sweep(path, sectionFn, opts)` (L246–265) + `tube(path, radius, segments, opts)` (L266–276) — arc-length `vRow` so bark/paint UV density is physical, not normalized per member.
- `roundRect(halfW, halfH, r, segments)` (L315–337) — **sampled by true perimeter arc length**, so a rib's corner radius stays exact at any segment count and the seam lands mid-straight. Correct section for a rectangular-hollow gridshell member.
- `superSection({halfW, top, bottom, nTop, nBot, shoulder, ...})` (L291–312) — four-quadrant superellipse, one control set spanning soft to knife-edged. Rib sections, planter coping, tram nose.
- `filletBox(w, h, d, r, ...)` (L463–487) — **true 3D spherical fillet** (`inset = r - sqrt(r² - over²)`), not a chamfer. This is what node gussets, junction boxes and equipment housings should be.
- `panelShell(rows, thickness, {rim, taper})` (L365–387) — offsets a sampled surface along its own normals and **stitches all four boundary bands**. Glass panels are not zero-thickness sheets; this gives them a real visible edge.
- **`orient(geometry)` / `signedVolume()` / `flipGeometry()` (L496–525) — adopt this immediately.** Every closed body is volume-checked and flipped if inside-out. The in-code comment is the lesson: *"Silent inversion is the single most common failure in generated hard surfaces — it survives a wireframe check and only shows up as wrong light."* `notes.md` S14 records exactly this bug costing us the hab pods (`PartWriter.tube` wound inside-out since S7). `invertedCount()` / `resetInvertedCount()` (L586–588) are the assertion hook.
- `pair(parent, geom, mat, name)` (L564–568) — author once on +X, mirror to −X; `mirrorX` (L528–537) flips index winding *and* negates normal.x. The symmetry contract.
- `add()` / `instance()` (L553–580) with the `PARTS[]` registry recording `{name, tris, slot}` — free triangle accounting per part, which the validation protocol requires.
- `seg(n)` from `design-contract.js:173` — **one global quality scalar thins every revolve and sweep together.** `setQualityScale()` wires straight into our `QualityState`.

**`design-contract.js` (motorcycle, 182 ln) is the model for the whole dome contract.** Units/frame/origin declared at the top; every dimension from real figures; derived frames (`AX`, `forkPt(L, s)`, `steerPt(L)`) so nothing is nudged into place afterwards. Write `dome/domeContract.ts` this way: curvature radius 330 m, 24 meridians, ring-beam stations, panel 2.5 m, member sections, node collar radii — then generate everything from sampled points on that contract.

**Dome glass — the decision**
`dielectric-glass-optics.md` §"Choosing between geometric and image-space transmission" (L254–271) is the routing table. **Dome glass fails the criteria for both spectral paths.** The whole two-pass machine (back-face RGBA16F buffer, inverted depth, 8 spectral samples × 4 segments × 3 refinements) exists for *cast solids*. Our panels are thin, flat, and cover the sky — `plan.md` §6 already settled on "thin transmission, no scene refraction". Correct call; keep it.

Lift from the glass example anyway:
- `absorptionCoefficients(tint, depth)` (`glass-optics.js:80`) — `σ = -ln(clamp(t,1e-4,1)) / max(depth,1e-3)`. Even for thin panels, deriving green edge tint from a **Beer-Lambert σ over real panel thickness** makes a 12 mm pane and a laminated node plate agree. The reference's warning at L159–169 is the trap: **parse the tint literal as `LinearSRGBColorSpace`** — an extra `convertSRGBToLinear()` squares the transfer and inflates σ by ~2.3×, invisibly.
- `fresnelDielectric(cosI, n1, n2)` (`glass-optics.js:102`) — exact unpolarised Fresnel. The ref (L119–124) is explicit that Schlick drifts precisely at the grazing incidence a dome interior is full of, and never reaches 1 at the critical angle.
- `createEnvironmentSampler({texture, rotation})` (L165) and the **`backgroundNode` note** (`spectral-glass-material.js:478–496`): derive background direction from `normalWorldGeometry`, **never** `positionWorld - cameraPosition`. The failure is quiet — a warped magnified environment that reads as a low-res probe.
- Diagnostics ladder (`dielectric-glass-optics.md` L302–326): thickness → back-face normal → entry Fresnel, read in that order.

**Anti-coplanar, anti-gap — the mechanisms that matter (all from `building-system.js`)**
There is **no vertex welding, no `mergeVertices`, no epsilon nudging and no polygon offset** anywhere in that file. Z-fighting is avoided structurally:
1. **`slab()` (:1566) is a 5-sided open-backed box — the coincident face is never emitted.** `solidBox` (:1574) emits 6. Anything pressed against a host surface uses `slab` with `z0` on or behind it. Nothing to fight with. **Adopt into `archkit/writer.ts` as a first-class primitive.**
2. **A monotonic depth ladder in local Z.** `framedWindow` (:1674) reads as a real construction section: metal backing 0.04 < glass 0.08 < mullion front 0.18 < sill/spandrel 0.22 < head 0.26 < jamb 0.28. Glass recessed 0.20 m behind the stone reveal — that recess is why façades read at grazing light instead of looking printed.
3. **Deliberate overlap at seams, never butt joints.** Glass oversized 1 cm per side into the opening, black-metal frame 4 cm; mullions *inset* 4 cm so they land on glass, never on the reveal. No float rounding can open a gap, and nothing is coplanar because each sits at a different z.
4. **Negative `z0` everywhere** (−0.06 … −0.18): every façade slab starts *behind* the wall plane, burying its unwritten back face inside solid geometry.
5. **Authored corner joints instead of mitres.** `cornerTrimJoints` (:700 / :880 / :1307) places an L-block **inset 0.32 m from each run end**, width 0.86, straddling the corner. A physically-sized corner piece swallows the open slab ends — no mitre maths, no shared vertices. This is how a gridshell node or a paving-edge return reads correctly.
6. **Coursing lines are proud strips, never coplanar decals** — a 1–2 cm slab pushed 8–16 cm forward (`brickCourses` :2361 at y ± 0.01, z 0.32→0.42).
7. **Ground contact sinks 2 cm** (`sidewalk-entry`, `bollard` at `y: -0.02`, :1012/:1014). Bury; never kiss. Directly applicable to planter kerbs and rails on polished paving.
8. **Deck epsilon −0.035**: `appendTierDeck` (:2790) puts the deck top 3.5 cm below the nominal tier top so parapets and roof modules land proud; roof placements then start `+0.12` clear (:1023). `almostEqual` (:2841) is `< 1e-3`.
9. **`facadeTransform` (:2753) — all four sides are pure rotations with det = +1, never a mirror.** Because `faceNormal` (:2720) is computed from already-transformed corners, normals stay outward with zero per-side special-casing. **If you add a mirrored side to any transform table, every module's normals flip. Assert det = +1.**

**Payoff** The gridshell in the reference image is 100% of the upper frame. Getting node junctions, member sections and panel edges right is the difference between AAA and a wireframe sphere.

---

## 4. Buildings / pavilions / archkit

**Study** `threejs-procedural-architecture/examples/procedural-financial-tower/building-system.js` (3073 ln — read it all in chunks) + `references/grammar-and-mesh-compiler.md` (509 ln).

**Lift near-verbatim**
- `createRandom(seed)` (:4) — counter-based lowbias32 hash, `{next, range, int, chance}`. **And the discipline**: it is called in exactly one place, `createMassTiers` (:87). Every façade rhythm downstream is a pure function of settings + integer indices (`index % 2`, `floor % 4`). Randomness selects among valid designs; it never repairs invalid geometry. `world/parkPlan.ts` should hold to this.
- **Exposed-edge analysis** — `exposedEdgesFor` (:21), `exposedSegments` (:24), `blockerSegment` (:29), `overlap` (:46), `subtractSegments` (:51), `subtractSegment` (:58), `toEdge` (:65). 1D interval subtraction per rect side. Three load-bearing tolerances: `epsilon = 1e-3` face-touching, `> 0.01` minimum blocker overlap, `> 0.25` sliver discard. **Essential for pavilions that abut each other or the dome ring — it is what stops us generating façade detail on a wall nobody can see.** Known defect to fix while lifting: `toEdge` sets both inner-corner flags from the same predicate (:78–79), so it cannot tell which end was clipped.
- **Bays vs seams** — `edgeBayCount(edge, min)` (:453), `edgeBayCenter` (:456), `edgeSeamCenter` (:460). Effective bay width **stretches to fit the exposed segment**; there is never a runt remainder bay. `edgeBayCenter` for infill (glass panels), `edgeSeamCenter` for things on the joint (mullions, columns). That split *is* the mullion/glass contract.
- `footprintPieces(style, w, d, settings)` (:182) — non-unioned rects for `free-court | l-shape | t-shape | u-shape | courtyard-block | high-rise-block | rectangle`, with hardcoded ratios worth keeping as a starting palette.
- `clampedSpan(span, inset)` (:428) — `max(BAY_WIDTH*4, span - inset*2)`. Never let a setback produce a sub-4-bay span.
- **The reserved-zone pattern** — `verticalZones` (:1322) emits whole-height placements (central glass shaft, side piers, service blank, recessed slot, corner piers) and `isReservedVerticalZone` (:1361) is the mirror predicate the per-floor loop consults to skip those bay indices (:1121–1126). **This is the most reusable idea for the multi-storey curved-glass pavilions in the reference image.** Improve on lift: return a `Set<index>` from `verticalZones` and consume it, rather than duplicating a predicate that must agree.
- Ornament as **real geometry gated by density**, never a texture swap (:1136–1180): above `ornamentDensity 0.52` and `(floor + index) % 5 === 2`, one bay placement becomes *two* — spandrel panel + shortened window. Roof equipment uses discrete gates (0.12 mech box, 0.32 hvac, 0.58 second box, 0.66 antenna).
- **`KitMeshWriter`** (:2592) with `appendQuad/appendAtlasQuad/appendQuadRaw/appendBox/appendFrom/toGeometries/triangleCount`. One buffer per material slot ⇒ **8 draw calls per building regardless of module count**. Indexed within each quad (4 verts → 6 indices), **no vertex sharing between quads, no dedup pass**. Normals are **authored per-quad via `faceNormal` (:2720), never `computeVertexNormals()`** — perfectly hard edges by construction, correct creases on trim, zero smoothing cost.
- `surfaceKey` (:2523) / `duplicateSurfaceOwners` (:2508) / `assertGeneratorInvariants` (:2498) — double-ownership detection. **Upgrade on lift**: it is exact-duplicate only; partially overlapping placements pass silently (the ref admits this at L437–440). Add a real interval-overlap test per (tier, side, edge).
- `debugMode: "topology"` (:2867) — short-circuits the compile to one coloured box per tier. Keep it; it is how you debug park massing before any glass exists.
- `appendMassCaps` family (:2768–2856) — soffit/deck/connector epsilons translate directly to pavilion floor plates, mezzanine returns and the tram platform edge.
- The `compileBuilding(planOrSettings, materials)` **materials-injection contract** (:2991): the compiler never authors a shader; you hand it `{glass: myGlassNodeMaterial, paving: …}` and it only falls back per empty slot. **Preserve that boundary — it is the single most valuable architectural decision in the file for a TSL project.**

**r185 / Mars Park deltas**
- The geometry writer bakes `vertexColors` (RGB per vertex, :2642/:2715) so three stone tones ship in one draw. In TSL that is `attribute('color')` multiplied into `colorNode` — your materials must honour it.
- **No smooth-normal path exists.** For the dome gridshell add an optional `normalOverride` to `appendQuadRaw`; do **not** post-hoc `computeVertexNormals()`, which would wreck every hard trim edge.
- **No instancing, no LOD, no `BatchedMesh`.** A `window-3m` used 200× writes 200 copies. Fine for *one* pavilion; do not repeat naively for 12 pavilions + tram. Reuse compiled `BufferGeometry` across identical pavilions with distinct `Object3D` transforms, or per-module `InstancedMesh`.
- `appendFrom` (:2657) uses `target.positions.push(...source.positions)` — spread on a 100k-element array blows the call stack. Rewrite as a loop before using it.
- `appendPlacement` does `plan.tiers.find(...)` per placement (:2884) — O(placements × tiers). Build a `Map<name, tier>` once.
- Every mesh gets `castShadow = receiveShadow = true` including glass (:3013). **Turn `castShadow` off for dome/pavilion glass** — we have the analytic lattice shadow instead.
- Dead code to drop on lift: `legacyBays` (:2559), `ctx.anchors` (:2902 — written by `roundColumnModule` :1609, never read). *Or* wire anchors up: attaching a light fixture to a mullion anchor is exactly what the reference image's under-canopy strips need.
- `chooseStoneAtlasCell` (:2689) returns the same cell for both branches — per-quad variety is stubbed out. Deliberate: random cells on a subdivided wall look like noise.

---

## 5. Tram + track

**Study**
- `threejs-procedural-geometry/examples/sport-motorcycle/source/{design-contract.js, mesh-kit.js, motorcycle-parts.js}` — `motorcycle-parts.js` (1871 ln, TSL) is the reference for a fully-crafted vehicle assembly.
- `threejs-procedural-geometry/references/vehicle-loft-and-projector-contract.md` (280 ln).
- `threejs-procedural-animation/references/procedural-motion-and-docking-systems.md` — §Piecewise launch kinematics (L40–86), §Docking-frame decomposition (L214–250), §Spring convergence (L252–278), §Frame-rate-independent response (L314–332).

**Lift**
- `sweep()` with **`uprightFrames`** for the rail head/web/foot profile and the guideway beam — the section must not roll along the path (`mesh-kit.js:228–229` states exactly this rationale for chassis rails). Our banked curves then bank *the car*, not the rail section, which is correct.
- `arcPath` + `catmull3` (`mesh-kit.js:277–285, 39–44`, `curveType = "centripetal"`) for the closed C² loop.
- `extrudePlate` / `extrudeRing` (L405/L436) with `offsetPoly` mitre-limited at `cosHalf >= 0.35` — sleepers, base plates, bogie discs, station deck grating.
- **Station berthing**: `Docking-frame decomposition` (animation ref L214–250) — `parallel = dot(offset, axis)`, `radialVector = offset - axis*parallel`, then drive parallel and radial on **separate** lerp schedules. Today `tramSystem.ts` has no corridor concept; this is what makes a berth read as berthing.
- **Doors and the dome iris**: `computeAscentKinematics()` (animation ref L40–86) — a three-phase profile with **position and speed continuous** across slow/accel/decel. The ref is explicit: *"Do not approximate this authored timeline by repeatedly lerping position toward an endpoint."* Smoothstep on `t` is the wrong tool for an authored travel with a known duration.
- **Iris petals** = one alignment quaternion from the aperture frame × one spin quaternion about the aperture axis (animation ref L118–127). Keep the two separate; normalize periodically.
- **Frame-rate independence**: `alpha = 1 - exp(-lambda * dt)` (L314–332). `robotsSystem.ts:231` currently uses `dampAngle(cur, tgt, 4*dt)` → a *linear* per-frame lerp, so response differs measurably at 30 vs 120 Hz. One-line fix, applies to doors and iris too.
- Carriage vibration on the object, camera shake on the rig — **never merged** (L129–149), so either can be disabled for diagnostics.

---

## 6. Props, amenities, hard-surface craft

**Study**
- `threejs-procedural-geometry/examples/sculpted-gallery-frame/frame-geometry.js` — `profileZAt(t, railWidth)` (:13) and `buildFrameProfile(railWidth, samples=92)` (:45).
- `references/profile-sweeps-and-mesh-writers.md` §Sculpted frame profile (L17–50).
- `building-system.js` `stackedColumn` (:1525), `profiledCylinder` (:1510), `fluteRadius` (:1561), `cornice` (:2417), `bead` (:2454), `archRing` (:1777), `chamferFace` (:2353), `railing` (:2031), `grilleBars` (:1937), `louverBox` (:2020).

**Lift**
- **The named-lobe profile** — a normalized rail coordinate `t` drives a sum of named Gaussian lobes (crown / inner bead / outer bead / inner groove / outer groove / shoulder / cove), each with its own centre, width and amplitude, all scaled by `railWidth / 0.75`. This is the correct authoring model for **planter coping, handrail tops, kerb noses, bench edges, signage bezels** — everything the reference image shows catching a highlight at a grazing 27° sun. 92 samples is deliberate hero resolution, not a default; LOD by *reducing samples while retaining crown and groove extrema* (ref L170–175).
- `stackedColumn` (:1525) — the **profile-as-band-table** shortcut: 7 radius bands over normalized height, each an independent overlapping cylinder (56 segments on the shaft band, 44 elsewhere). Cheaper to author than a true sweep, and the overlaps *are* the moulding. Right for lamp stanchions, bollards, planter rim mouldings, tram stanchions.
- `fluteRadius` (:1561) = `radius * (0.93 + max(0, sin(angle*flutes)) * 0.07)` — fluting as 7% half-rectified radius modulation, so flutes are grooves, not a sine wave.
- `cornice` (:2417) — three courses with lateral overhang 0 → 0.12 → 0.18 so adjacent runs **interpenetrate rather than butt**.
- `triangleFace` / `roofTriangle` (:1816/:2108) emit a **degenerate quad** `[a,b,c,c]` — one code path, one index pattern, one wasted triangle. Simplifies the writer enormously.
- Cost warning: `rosette` (:1656) is 13 slabs × 5 quads = 65 quads each. Budget ornaments explicitly.
- Authored PBR identities table — `procedural-pbr-system.md` L136–152: walnut 0.42/0.04/cc 0.62, antique gold 0.24/0.78/cc 0.24, ebony 0.40/0.03/cc 0.70; plaster 0.94–0.96, floor 0.92, mat 0.92. **These ranges preserve material separation before bloom** — which is exactly the validation gate.

---

## 7. Vegetation and planters

**Study**
- `threejs-procedural-vegetation/examples/structured-ash-growth/tree-system.js` (477 ln, **renderer-agnostic**) + `ash-preset.js` (31 ln) + `references/structured-ash-growth-system.md` (309 ln).
- `.../examples/procedural-surface-ivy/source/{ivy.ts (769), leafTexture.ts (164), wind.ts, bvh.ts, flowers.ts}` — **closest to drop-in in the whole pack**; only 4 `MeshStandardMaterial` constructors (ivy.ts L152/163/173/178) need swapping to `MeshStandardNodeMaterial`.
- `.../examples/stylized-meadow-grass/grass-system.js` (449 ln) — geometry + placement are renderer-agnostic; the material is ~250 lines of GLSL to rewrite.
- `.../examples/gpu-computed-grass/gpu-grass-system.js` (1071 ln) — read for the *algorithm*; the implementation is WebGL-only.

**First Tree — `tree-system.js`**
Single export `compileAshTree(preset)` → `{branchGeometry, leafGeometry, leafOrigins, stats}`.
- **Rings are NOT parallel-transport.** They are built in the XZ plane and rotated by a **mutating `THREE.Euler` accumulator** (L325–358). Gnarliness `g = max(1, 1/sqrt(radius)) * gnarliness[level]` (L381–386) — thin branches wobble more. Twist is a **post-multiplied** local-Y quaternion (L388–396); tropism is a **pre-multiplied** world-space rotation with `step = forceStrength / safeRadius` (L397–419), so twigs snap toward vertical while the trunk barely moves. The reference is explicit (L167): *do not derive child orientation from a newly constructed tangent frame* — the Euler accumulation IS the species identity. Contrast: `ivy.ts:182–241` *does* use true parallel transport, correctly, because a vine is a tube on a surface.
- **Bark UV**: `wrapsX = max(1, round(radius * textureScaleX))` (L301–304) — one integer wrap per branch, so bark scale does not drift with radius. Each section pushes `segmentCount + 1` vertices (explicit seam duplicate at `u = wrapsX`, L359–369).
- **Continuation model** (L441–462) is the crown-shape mechanism: while `level < branchLevels`, push a *terminal continuation* inheriting the parent's section/segment counts, **then** lateral children. Lateral-only generators produce a candelabra (ref L50–58).
- **Stratified placement** (L217–224, L253–259): `along = start + (slot + jitter)*(1-start)/count`; `azimuth = 2π*(radialOffset + (permutedSlot + jitter[-0.5,0.5])/count)` with `shuffledIndices` (L17–24). Generalized in `field-stack-recipes.md` §6 — **stratify the domain before applying random jitter**.
- **Leaf cards**: `emitLeaf` (L153–208) makes two cards at 0 and π/2, base at `y=0` so the pivot sits at the attachment point; **both cards deliberately share one normal** (computed L177–179 before the card rotation); rounded normal `normalize(cardNormal + (vertex - origin))` (L186–189) fakes canopy volume.
- **Wind is not in this file.** Contract is prose at ref L206–237: `windPhase = 2π·simplex3(pos/70)`; three detuned sines; `displacement = leafUvY * windStrength * wind`; **leaf geometry only, branch geometry static**. Re-express in TSL `positionNode`.
- **Scale warning:** `ash-preset.js` is ~80 units tall, trunk radius 2, `leaves.size 2.67`. Our First Tree is a 12 m ginkgo. Either scale the group by ~0.15 (preserves the numeric contract, breaks wind-strength units) or divide `length[]`/`radius[0]`/`leaves.size` (breaks the ref's numeric gate at L297–306 — record as intentional divergence). Gate values: branch 6639 v / 9120 tri, leaf 21760 v / 10880 tri = 2720 leaves = 160 terminals × 17.
- Quirk to preserve or knowingly diverge from: `interpolateSection` L92 does `qB.slerp(qA, alpha)` — **reversed**; alpha=0 gives B.
- `SeededRandom.value(max, min)` — **argument order is (max, min)**, opposite to `stylized-meadow-grass`'s `value(min, max)`. Both are in the pack. Do not mix.

**Planters — use `stylized-meadow-grass`, not `gpu-computed-grass`**
- `createStylizedGrassBladeGeometry({height, width, segments=6, planes=5})` (L32–88): one instance is a **cluster of 5 intersecting yaw-spread quad-strips** with a hand-authored hemispherical normal `(sin, 0.34, cos)` (L47) so a cluster lights like a soft mound. ~70 verts/cluster; 18k instances ≈ 90k visual blades.
- `bendOffset(local, bladeT)` (L176–215) is an **exact inextensible circular-arc bend**, not a sine offset: `phi = clamp(strength*intensity*3, 0, 1.48)`, `a = phi*bladeT^1.5`, `radius = height/phi`, `arc = radius*(1-cos a)`, `drop = radius*sin(a) - local.y`. Blade length is preserved and the tip drops as it bends. **Reads far better than the GPU version's Bezier control-point push at planter-close range.**
- `pathSampler(x, z)` (L412) is already exactly a **planter-footprint mask** hook; blades with `pathValue >= 0.52` get `scale = 0.001` (L422) rather than removal, so instance count stays constant.
- Ground-colour projection (L299–304): grass samples the ground albedo at its base, fading toward the tip — a very cheap grounding/AO trick worth keeping.
- From `gpu-grass-system.js`, borrow only the ideas: `getClumpInfo` (L251–271, 3×3 jittered Voronoi F1), `calculatePresence` (L281–286, smoothstep r 0.7→1.0), `densityCompensation` (L534–538, widen survivors as stochastic culling thins the field so coverage stays constant), and `computeLightingNormal` (L614–634, blend the blade normal toward a **clump-dome normal** `normalize(vec3(toCenter.x, 0.7, toCenter.y))` by height and distance — this is what stops distant grass sparkling). **Feed `presence` a planter-footprint SDF instead of the Voronoi radius.**
- Two defects in the GPU file not to inherit: yaw is never applied to the shading normal (L530–543); `lodSeed01` is computed (L347) and never read, so `calculateLODPositionT` uses `step(0.5, lodWeight)` (L491) and the LOD **pops hard**.
- Scale note: defaults are `area 40, count 18000` ≈ 11 clusters/m². Planters want 200–800/m² over a few m².

**Ivy on struts, planter walls, pavilion columns — `ivy.ts`**
- `project(pos, normal)` (L696–711): `origin = pos + normal*LIFT` (LIFT = 0.09), `direction = -normal`, `raycaster.far = LIFT*2.2`; returns the face normal transformed to world and **flipped to agree with the incoming normal** (L706–707) — the seam/backface guard.
- `creep()` (L534–576): while attached, **project direction into the tangent plane** (`dir.addScaledVector(normal, -dir.dot(normal))`, L555); when detached, droop `dir.y -= 0.45` (L557). That single hard-coded gravity constant should be reduced for 0.38 g.
- `buildStemGeometry` (L182–241) emits indices **ring-by-ring specifically so `setDrawRange` reveals the stem in growth order** (L227/291).
- **Petiole-hinge wind** (`updateLeaves`, L337–379): rest quat post-multiplied by `axisAngle(X, flap)` and `axisAngle(Y, twist)`, and the leaf geometry is `PlaneGeometry` with `translate(0, 0.5, 0)` (L120) so the pivot is the blade base — the blade can never detach. Steady lean comes from **pressure on the blade face** (`press = dx*normal.x + dz*normal.z`, L366) so edge-on blades get no lean. **The asymmetric clamp `clamp(…, -0.18, 0.85)` (L370) is why blades never punch into the host wall.** Keep it.
- `createSprigTexture(size)` (`leafTexture.ts:95–164`) — a fan of ~17 pointed leaves drawn in **pale sage** so a per-instance tint carries the colour ramp; "one card reads as a dozen leaves". **This is the right tool for planter shrub canopies and the First Tree's mid/far foliage** — far cheaper than 2720 individual double-cards.
- Caveats: `LIFT 0.09` with `far ≈ 0.198` bounds trackable geometry — a strut thinner than ~0.18 m lets the ray through to the far side; scale LIFT/STEP to strut radius or restrict `targets` to one strut. `indexForRaycasts(root)` (`bvh.ts:18`) must be called first. `updateLeaves` writes instance matrices on the CPU every frame — move to `positionNode` or a TSL compute kernel for large coverage.
- `flowers.ts` `buildUmbel` / `buildBudBall` (L50/L105) — golden-spiral placement (`az = i*2.39996`); `mergeParts` (L30) flattens to non-indexed first because `mergeGeometries` refuses mixed indexing.

**Soil in beds** — `field-stack-recipes.md` §4 `soilNoise` three-band stack (L126–131) verbatim, **keeping the anisotropic scalings** `(0.2, 1, 0.2)` and `(14, 3, 14)` so bands read as horizontal soil layering rather than isotropic mush.

---

## 8. Robots

**Study** `threejs-procedural-animation/references/procedural-motion-and-docking-systems.md` (362 ln) + `sport-motorcycle/source/motorcycle-parts.js` for chassis craft + `procedural-vfx/references/procedural-vfx-system.md` §Holographic projection shells (L178–257).

**Lift**
- **State contract** (L20–38): `{elapsedSeconds, phase, position, velocity, baseQuaternion, spinAngle, angularVelocity, eventFlags}`, **scratch vectors outside the state**. `robotsSystem.ts:206, 212` allocates `new Vector3()` per robot per fixed-update — a direct hit.
- **Spring convergence + terminal lock** (L252–278): `a = (target-cur)*stiffness - vel*damping`; stiffness ramps 5.0 → 9.8, damping 4.6 → 7.4 as the sequence settles; **past settle 0.995, copy the target exactly and zero velocity** — a spring alone retains imperceptible destabilizing residual motion. Today the arm is an open-loop `sin(toolPhase*2.2)*0.14` (`robotsSystem.ts:199`); spring-follow toward a work-target pose gives real settle and overshoot.
- **Panewalker on the shell**: derive base orientation from the shell-tangent frame with `quaternionFromUnitVectors`, then apply traverse spin as a **separate** quaternion (L118–127). Today it sets `rotation.y = -phi` on an Euler (`robotsSystem.ts:238–240`).
- **Mule docking at the depot**: docking-frame decomposition (L214–250) instead of `normalize(target-pos)` steering with a `distance < 0.35` waypoint pop.
- `clamp` the integration `dt` (L341) — semi-implicit springs blow up after tab suspension. Our `fixedUpdate(ctx, dt)` already gives this; keep it.
- **Ops-room / robot holograms** — `procedural-vfx-system.md` L178–257 gives exact terms: `density = mix(0.25, pow(mod((worldY - t*0.2)*20, 1), 3), bandKeep)`; `fresnel = pow(1 - abs(dot(N,V)), 2)` (**`abs` required — both facings**); `alpha = (density*fresnel + fresnel*1.25) * smoothstep(0.8, 0, fresnel)`. Footprint-filter the band with `fwidth` and fade to the band's own mean **0.25, not zero**. Incidence must use the inverse-transpose normal matrix in view space.
- **Dust capping on robots** — `precipitation-surfaces/references/precipitation-surface-systems.md` §Object snow capping (L104–119): `snowAccumAt(worldNormal, modelXZ) = smoothstep(flatThreshold, 1, clamp(worldNormal.y,0,1)) * coverageMask(modelXZ)` with `flatThreshold 0.35`, `thickness 0.06`, `coverage 0.7`, `edge 0.15`. **Must be sampled in model space** via a world-to-model matrix — the named failure is "object snow uses world coordinates and slides under animation". Retint from snow-white to `dustLight = vec3(0.45, 0.293, 0.178)` (already in `exteriorTerrain.ts:345`) and push roughness **up**, not down.

---

## 9. Lighting and post pipeline (deltas only — the pipeline already exists)

Our stack: MSAA 4× scene pass + MRT(output, normal) → stock `ao()` + custom TSL bilateral → `hdrTransform` hook (haze/shafts) → `bloom(0.16, 0.35, 1.6)` → `exp2(exposureEV=0)` → `renderOutput(AgX, sRGB)` → `marsGrade`. `outputColorTransform = false`, `toneMapping = NoToneMapping` in two places. **Single tone-map ownership is fully compliant and in fact stricter than the docs.** Order is compliant. Do not restructure.

**Top adoptions, ranked**
1. **Add `albedo` to the scene MRT and stop multiplying scene colour by AO.** `gtao-bent-normal-pipeline.md` §9 is explicit: *"Do not multiply final scene color by AO"* — the named failure "sunlit surfaces become gray" is exactly `sceneColor.mul(aoAmount)` at `pipeline.ts:170`. Prescribed split: `indirect = min(albedo * environmentIntensity * irradiance, sceneColor)`; `direct = sceneColor - indirect`; `occludedIndirect = indirect * visibility`; `tintAmount = saturate(1 - dot(bentView, geoNormal)) * (1 - visibility) * 0.35`; `output = direct + mix(occludedIndirect, occludedIndirect*irradiance, tintAmount)`. Fallback cavity colour `(0.55, 0.62, 0.78)`. **Blocker: the MRT has no albedo channel.** Keep the existing AO-receiver mask in `normal.a` when you add it.
2. **Three unset GTAO uniforms.** Stock r185 `thickness = 1` vs prescribed **0.35 m** — the doc's *named primary cause of thick silhouette halos*. `scale` (power) `1` vs **1.6**. `radius` 0.3 vs **0.5 m**. Three one-liners with real image impact.
3. **Fix the shadow level ladder.** `levels` comes from `levelMapSizes.length` (3), not the formula `ceil(log(maxDistance/firstRadius)/log(scaleFactor)) + 1` = 4. Half-widths land at [30, 96, 560]; the L1→L2 blend crosses a **5.83× half-width and 7.8× texel step**, pushing per-level normal bias to **0.747 m** — a peter-panning generator. Go to 4 levels (30/96/307/560) or `maxDistance ≈ 310`.
4. **Bloom `smoothWidth` is never set** → stays at r185's `uniform(0.01)` vs the doc's **0.08**. At threshold 1.6 that is a hard cut — a plausible source of popping highlights as the tram moves.
5. **Author a real emissive hierarchy** anchored to the 1.6 threshold. The doc's ladder spans 8× (laser 10 → projectile 30 → spark 80) and is explicitly *relative, not photometric*. Our two shipping emitters (`materials/library.ts:254` ×2.6 and `:342` ×3.2) are **1.23× apart** — the doc's failure condition "all bright materials share one arbitrary emission multiplier". Suggested ladder: sun disc 1800 ≫ specular glints 30–80 > displays/holograms 4–10 > warm bollards 1.8–2.2 > threshold 1.6 > lit regolith < 1.0.
6. **`maxCacheAge = 0` disables the whole age/expiry policy** and the age-staggering initializer degenerates to 0 for every level. Any caster not manually tagged onto `DYNAMIC_SHADOW_LAYER` (wind-deformed vegetation, doors, deployed props) is **silently frozen forever**. Re-enable it, or start calling `invalidate(sphere)` — the only current call is whole-world at warmup.
7. **Turn GPU timing on** (`trackTimestamp: true`, `Stats({trackGPU: true})`). The validation protocol's step 10 — "never infer GPU cost solely from CPU frame time" — is currently unmeetable by construction.
8. **Grading**: `grade.ts` implements ~3 of the 11 prescribed stages. Cheapest high-value addition is the three tonal weights — `shadow = 1 - smoothstep(0.12, 0.54, luma)`, `highlight = smoothstep(0.48, 0.92, luma)`, `midtone = max(0, 1 - |luma-0.5|*2)` — driving **separate shadow/midtone/highlight tints**. A dusk Mars palette wants a warm shadow tint that does not touch midtones; a global lift (what we do now) cannot express that. Also missing and worth adding on a saturated-ochre AgX palette: **output dithering and gamut compression** (absent from the docs too — 8-bit banding in large smooth sky gradients is a real risk).
9. `exposureEV = 0` makes the exposure stage a literal no-op multiply. Either give it an authored value or delete the stage — a no-op node is what the validation doc calls a false-confidence control.

**Where we are already better than the docs — do not regress**
- Our bilateral has a **normal-similarity term** `pow(max(dot(nC,nS),0), 12)`, **distance-scaled depth sigma** `max(0.08, |viewZ|*0.04)`, a **diagonal weight** 0.70710678, and **per-axis texel** `vec2(1).div(aoResolution)` (the doc's `screenTexelHint` uses 1/width for both axes — a bug).
- Our weak-support fallback is the **box mean**, not the centre texel, with the documented reason that the centre texel *strobes on thin members* (the dome lattice) at walking speed. This contradicts §8 and our reason is stronger. Flag as a doc correction.
- **Reliability fades** (`aoGatherFootprint` + distance fade) solve "AO remains strong where its world radius is subpixel"; the doc's only tool is a `radiusUv` clamp.
- Reversed-Z: r185 WebGPU clears depth to **0**; guard both ends (`> 1e-7 && < 0.999999`) and derive distances from `getViewPosition(uv, depth, projInv)` — `getViewZNode()` mislinearizes at range.
- Urgency-sorted shadow budget, velocity-lead recentering (`LEAD_SECONDS = 1`), `DEPTH_REACH = 70` on the far-plane formula, and the **static/dynamic scene split** (`staticShadowScene.ts` clones all static casters into a `BundleGroup`, then `min(staticShadow, dynamicShadow)` — *not* multiplication, to avoid double-darkened overlapping penumbrae) are all genuine additions beyond the reference. Treat the static-scene split as the primary pattern and `dynamicLevels` as the fallback.
- Dynamic resolution (`QualityState.renderScale` with hysteresis) has no equivalent in the docs.

---

## 10. Camera transitions (tram boarding / alighting)

**Study** `threejs-camera-direction/references/camera-rig-and-cinematic-systems.md` — §Explicit camera handoffs, §PointerLookControls, §projection and lifecycle ownership.

**The headline delta.** Boarding currently violates the transition invariant. Orientation is **not slerped** — seated yaw is clamped instantly into a ±1.35 rad cone (`playerSystem.ts:237–239`) — and **two smoothers are stacked** over the same interval (`position.lerpVectors` + walk bob feeding `eye.lerpVectors(position, now.eye, seatBlend)`). The prescription is exact:

```
capture startPosition + startQuaternion at transition start
eased       = 1 - (1 - t)^1.8
position    = lerp(start, target, eased)
orientation = slerp(startQuat, targetQuat, eased)
→ write the camera and RETURN from the update
```
*"Do not apply the normal follow smoother after this interpolation. Stacked smoothing causes a mid-transition half-halt."* Outside transitions: `lambda 9.5` while blending, `18` when pure, and **copy the pose exactly at zero blend** to kill the permanent subpixel tail.

**Second delta:** the seat pose closure returns `{eye, yaw}` — a scalar. `tramSystem.ts:163` already computes `car.group.getWorldQuaternion()` and then throws it away. **Change the closure to carry a quaternion** and slerp pointer-look on top; a banked car can then tilt the view. That is the seated-ride feel fix.

Also adopt: **clear input keys on pointer-lock exit and on window blur** (`input.ts` has neither — a held W at tab-switch keeps walking); re-sync yaw/pitch from the camera quaternion on lock acquisition (benign today, load-bearing the moment a cinematic writes the camera); save/restore `{fov, near, far}` in a `finally` if the arrival sequence ever pushes a lens. Our Euler order `YXZ` and ±1.533 pitch clamp already match. **No floating origin needed** (park is ±300 m) and the camera-tethered sky dome already satisfies the background rule — say so explicitly so nobody adds one.

---

## 11. VFX — dust, vapor, shafts

**Study** `threejs-procedural-vfx/references/procedural-vfx-system.md` (329 ln) + `examples/volumetric-fluid-fire/source/{VolumetricFluidFire.ts, FluidFireShaderContext.ts, util/createStorage3D.ts, pass/advectDyePass.ts}` (**TSL compute — the only WebGPU-native volume example in the pack**).

**Dust motes** — the **instanced spark contract** (L118–140), stripped: fixed pool of ~12k sprite instances, per-instance `startPosition/startVelocity/acceleration/spawnTimeSeconds`. For motes kill the decay, near-zero acceleration, long lifetime, camera-anchored respawn volume. Mars Park has no mote system today. Pair with the **dense-swap pool ownership invariant** (L143–176): on removal, swap the last live instance into the vacant slot and copy the matrix, **every custom attribute slice**, and the entity→index map — updating only `mesh.count` attaches stale effect state.

**Vapor plumes** — the reusable TSL compute grammar, worth memorising:
```ts
// createStorage3D.ts
new THREE.Storage3DTexture(sx, sy, sz)   // Linear/Linear, ClampToEdge on S,T,AND R, no mipmaps
// FluidFireShaderContext.ts:85–119 — ONE texture, TWO nodes
texture3D(tex)                       // read
storageTexture(tex).toWriteOnly()    // write
swap() { /* reassign node.value, NOT rebind targets */ }   // :324–328
// VolumetricFluidFire.ts:384–402
Fn(() => { If(globalId out of bounds, () => Return()); pass(); })()
  .compute(DISPATCH, [4, 4, 4])
```
Then `await renderer.computeAsync(kernel)` in a **fixed order with an even ping-pong count**. For cold vapor drop vorticity, pressure/Jacobi/projection and the SDF collider entirely: advect + buoyancy + curl-noise forcing on a 48×64×48 grid + a 22-step additive raymarch. Composition constants worth copying: double-sided additive, `depthWrite` off, jitter = IGN + `frameId * 0.118033988749895` fract'd, scene depth bound so opaque geometry terminates the march, volume pass at 0.75 resolution scale. **Honest assessment: for two vents, the current 12-sprite approach (`robotsSystem.ts:149–176`) is the correct engineering trade.** Read the pattern; deploy it only if vapor becomes hero.

**Light shafts** — `src/dome/interiorHaze.ts` is already better-fitted than anything in the skill, because it marches the *same* `latticeSunVisibility` that shadows the ground, so shafts and shadow-net agree by construction, and it accumulates only the **difference** (`CARVE_DENSITY 0.0011`, `GLOW_DENSITY 0.00006`, net-zero in open sun) — the lesson already in `notes.md`. It is compliant with the aurora recipe's transferable rules (uniform steps, step-length weighting, hash jitter, finite footprint). **Do not replace it.**

**Dust devils** — no named recipe covers one. Closest structural fit is the **wake construction** grammar: separate **core and haze meshes at different scales and speeds**, `radial spread = 1 + t^1.24 * expansion`, `profile turbulence = 1 + sin(theta*3.3 + t*8.7)*0.1*t`. Today `exteriorTerrain.ts:139–167` is a single cylinder with scrolled `mx_noise_float` opacity — core+haze is the upgrade. At 5–7 km and 2 instances, the current version is a defensible trade, not a defect.

**Dust deposition on paving and glass** — `temporal-surfaces` gives the ping-pong mechanism (persistent half-float, decay as `1 - exp(-rate*dt)`, explicit resize policy, deposit brush) but **explicitly routes world footprints away** (SKILL.md:43). If you build it, bind it to a **top-down orthographic world-space target over the park footprint**, never a screen target. For dome glass, `glassShell.ts:95–129` is already analytic (directional trailing wake from the Panewalker's `phi`) and the skill's own opening rule applies: *do not allocate history for an effect whose complete state is analytic in time*. **Keep it analytic.**

`refractive-window-rain` reads as applicable to dusty glass but is a **view-aligned screen-space pane** effect — streaks would slide across the dome as the player turns, which is the exact failure the skill warns about. Take only the layer grammar and the rule that **the optical normal must come from the coverage field itself** (never a second noise field), and evaluate it in the dome's own (θ, φ) parameterisation, which `glassShell.ts` already has.

---

## 12. Validation workflow

`threejs-visual-validation/references/graphics-validation-protocol.md` (406 ln). Ordered checklist:

0. **Acceptance principle** — all four layers must agree: declared mechanism → inspectable implementation → diagnostic evidence → final image satisfying the contract. A beautiful frame alone is not acceptance; nor is plausible code.
1. **Write the `VisualContract` before tuning**: `{subject, identity[], silhouette[], materialSeparation[], motion[], cameraEnvelope{near, design, far}, lightingEnvelope[], invariants[], allowedDivergences[], frameBudgetMs}`. **Every invariant must be observable** — "the primary rim remains visible without bloom", not "looks cinematic". When matching `ref_images/mars_park.png`, record the mechanisms creating its identity **and every deliberate divergence** (backend, resolution, asset, scale, composition). *Mars Park has no written VisualContract — this is the first artifact to produce.*
2. **Freeze deterministic inputs**: seed · camera transform+projection · viewport · DPR · time/paused · quality tier · backend · asset versions. Named bookmarks only — "reproducing a comparison by manually orbiting until it looks close invalidates image evidence."
3. **Controls must alter the real pipeline.** "A debug dropdown that only changes a label is worse than no diagnostic."
4. **Capture the no-post baseline**, then per effect: final · no-bloom · effect contribution only · controlling field/mask · normal/depth/history.
5. **Isolation gate — reject when** bloom supplies the only readable silhouette · atmosphere hides flat fields · post blur hides aliasing · a normal map implies relief absent from geometry · **shadows are judged only in the final graded image**.
6. **Shadow evidence (mandatory here)**: level ownership · committed light-space centres · texel grid · levels refreshed this frame · **cross-level blend weights** · normal bias in world units · **unshadowed outside-coverage weight**. Our `debugSnapshot()` covers most; the two bolded are missing.
7. **Camera-distance envelope**: near / design / far captures.
8. **Seed sweep** — at least one stress seed; identity must survive.
9. **Temporal validation**: `t=0 reset · first visible response · steady state · disocclusion/invalidation · recovery`, inspected at speed **and** frame-by-frame. Cover shadow-cache refresh and pool birth/death/reuse.
10. **Performance**: CPU *and* GPU frame time, draw calls, tri/instance counts, sim resolution, render-target count/format/dims, active tier, cache updates this frame, GPU memory. Warm up first; separate compile from steady state.
11. **Capture set, 7 minimum**: design · near/detail · far/silhouette · no-post · one controlling diagnostic · one failure-sensitive diagnostic · one stress condition.
12. **Rejection criteria** (any one ⇒ withhold): weaker than the reference in the target feature · mostly generic noise boilerplate · mechanism constants replaced by guesses · no diagnostic proving the claimed mechanism · relies on post to manufacture missing form · undisclosed divergences · deterministic reset impossible · misses its declared performance envelope.

**Our standing:** we have `?view=` (13 bookmarks), `?pass=` (9 views), `?tier=`, `?seed=`, `?freeze`, and a standing calibration scene (`?view=gallery`). Missing: GPU timing (off by construction), render-target inventory, draw/triangle counts, **runtime pass toggles** (the graph is built once from `flags.pass`, so every toggle is a page reload — state this limitation, since a node graph has no per-pass enable flag), cross-level shadow blend weights, a pre-LUT/post-tonemap comparison, the written contract, and any sign-off record.

---

## 13. Do NOT bother

| Skill / example | Why |
|---|---|
| `threejs-spectral-ocean` (all), `threejs-water-optics` (all) | No open water — `plan.md`/`notes.md` canon: pipes and greenhouse mist only. Nothing generalizes that isn't better covered by `procedural-fields`. |
| `threejs-raymarched-space-effects` (all) | Black holes, geodesics, wormholes. Zero relevance. If Phobos/Deimos ever appear through the apex glass, `references/lensed-celestial-spheres.md` is where flux-conserving star point-spread lives — until then, `skyRadiance.ts`'s analytic disc is the right tier. |
| `threejs-volumetric-clouds` (all) | Every control is a *water-cloud weather* control. Mars at a frozen 27° afternoon has none. The skill's own routing boundary sends dust to the atmosphere skill. Steal only its failure checklist ("density is only `fbm(position)`", "the raymarch traverses the full camera range") as a sanity check on the dust devils. |
| `atmosphere-aerial-perspective/examples/lut-aerial-perspective/source/geospatial/**` (~30 files) | WGS84 ellipsoid, ECEF, tiling schemes, EXR3D loaders. A 500 m park on a graded pad needs one sphere. Deleting this is 2/3 of the port. |
| `.../source/atmosphere/celestialDirections.ts` | Earth-only `astronomy-engine`, and our sun is frozen. |
| The shipped `.bin`/`.exr` LUTs | Earth bake. Editing `AtmosphereParameters` cannot make Mars — the density profiles are inside the bake. See §2. |
| `procedural-planets/examples/.../planet-system.js` L8–112 (`createTerrainPlanetGeometry`) and the ocean/coast axis | Cube-sphere + string-keyed vertex dedup + sea level. All wrong for a flat exterior. §2 lists exactly what to keep. |
| `procedural-vegetation/examples/gpu-computed-grass` **as an implementation** | WebGL2 MRT-as-compute, `glslVersion: GLSL3`, `onBeforeCompile` chunk surgery, `texelFetch`, fullscreen-quad-as-kernel. Nothing survives literally. Read it for `getClumpInfo`/`calculatePresence`/`densityCompensation`/`computeLightingNormal` only, then build on `stylized-meadow-grass`'s cluster topology. |
| `procedural-materials/examples/raytraced-diamond`, `lava-flow-surface` | Faceted gems and molten rock. No subject in the park. |
| `spectral-dispersive-glass` **as a whole system** | Two-pass back-face buffer, 8 spectral samples × 4 segments × 3 refinements per fragment, for *cast solids*. Our panels are thin and flat. Lift only `absorptionCoefficients`, `fresnelDielectric`, `createEnvironmentSampler`, the `backgroundNode` rule and the diagnostics ladder. |
| `precipitation-surfaces/examples/wet-puddle-rain` | Contains **GPL-licensed source material** (SKILL.md:37–38) and license notices are stripped. **Do not copy from this example into mars_park.** The snow-accumulation contract in the reference md is safe and is the useful part. |
| `temporal-surfaces` for paving dust or dome glass | Screen-space history; the skill explicitly routes world footprints away, and our glass film is analytic. §11. |
| `procedural-vfx` reentry plasma / capsule wake / SDF fire collision | Ship plasma. Only the wake *grammar* (core+haze at different scales) transfers, to the dust devils. |
| `building-system.js` atlas subdivision for park-scale paving | 63 quads where 1 would do. Use repeat-wrap UVs; reserve subdivision for close-inspection surfaces. |
| `threejs-bloom`'s dual-bloom **implementation** (layer swap + shared black material + try/finally restoration + multiple scene renders) | A WebGL composer idiom. In WebGPU use a second MRT contribution channel — the doc itself says "prefer a dedicated contribution target when MRT/backend architecture supports it". The whole material-substitution transaction and its leak assertion disappear. |
| `toneMapped = false` on emissive materials | Meaningless here — the renderer never tone-maps; one `renderOutput` owns the transform. Do not port the idiom. |
| A depth prepass | `pass(scene, camera, {samples: 4})` already owns depth (`getTextureNode('depth')`, `getLinearDepthNode()`). Adding one violates "every signal has one producer". |
| FXAA | Replaced by scene-pass MSAA 4× with `antialias: false` on the renderer (avoids a second resolve). Better than the docs for WebGPU. |
| A floating origin | Park is ±300 m. The camera-tethered sky dome already covers the background rule. |

---

## 14. Cross-cutting r185 landmines (memorise)

1. **Reversed-Z.** r185 WebGPU clears depth to **0**. Guard both ends (`> 1e-7 && < 0.999999`). `getViewZNode()` mislinearizes at range — reconstruct with `getViewPosition(uv, depth, projectionMatrixInverse)`.
2. **`receivedShadowNode` is per-LIGHT-cached, not per-material.** `AnalyticLightNode.setupShadow` caches the shadowColorNode from the **first-built** receiver for all materials. Any global shadow modifier (our analytic lattice) must live inside a custom `ShadowBaseNode` on `light.shadow.shadowNode`.
3. **`NodeFrame` is a singleton** whose `.scene` is reassigned by every nested render. Clone per nested render: `Object.assign(Object.create(frame), { scene })`. Otherwise a static shadow refresh leaves `frame.scene` on the proxy and the next pass renders an empty map.
4. **Set `updateBeforeType = NodeUpdateType.FRAME`** on custom nodes, or `updateBefore` re-runs per render pass in a multi-pass graph. The skill example omits it.
5. **`reference("_levelData", "vec4", this).element(i)`** is the fragile call in `shadow-clipmaps.js`. Verify on r185; `uniformArray(this._levelData, 'vec4')` is the fallback. Also: the key must match the actual instance property name.
6. **`RenderPipeline.compileAsync()` does not exist in r185.** Warm up through `renderer.compileAsync(pipeline._quadMesh, pipeline._quadMesh.camera)` after `pipeline._update()`, with a guarded contract check and a `finally` restoring `toneMapping`/`outputColorSpace`/`xr.enabled`.
7. **Non-uniform control flow forbids implicit derivatives.** Inside any `Loop`, use `textureLevel(map, uv, 0)` or `.grad(gradX, gradY)`. Applies to POM, glass, every raymarch.
8. **WGSL's `smoothstep` is undefined when `edge0 > edge1`**, same as GLSL. Always write `1 - smoothstep(lo, hi, x)`. (Also `notes.md`: reversed-edge smoothstep already burned us once on the analytic lattice penumbra.)
9. **Silent winding inversion** is the most common generated-geometry failure — it survives a wireframe check and only shows as wrong light. Run `orient()`/`signedVolume()` on every closed body and assert `invertedCount()` in a test.
10. **`SpriteNodeMaterial` needs an explicit radial opacity falloff** — a bare one is a hard translucent square (`notes.md` S14, bit us twice).
11. **Debug-paint through AgX + the Mars LUT lies.** Warm-channel debug colours render as perfect regolith tan. Use saturated magenta/cyan only (`notes.md` S14).
12. **Audit every fixed camera against `interiorHeight` + 1.7 m eye.** A buried camera renders a near-black frame that perfectly impersonates a pipeline bug (`notes.md` S12).
