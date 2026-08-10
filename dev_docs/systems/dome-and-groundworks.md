# Dome One & interior groundworks (S4 + S5)

## Dome (`src/dome/`)

- Cap geometry: ⌀500 m, crown 120 m → sphere R 320.417 centered y −200.417,
  θ_base 0.8952. These constants live ONLY in `latticeField.ts`.
- Structural members built as instanced boxes (primaries/rings/gussets/
  footing); the fine 2.5 m net is SHADER-ONLY — in the glass (pixel-soft
  lines) and in the shadow (penumbra-soft lines). Members cast no shadow
  maps; the analytic net owns all dome shadowing (never double-darken).
- Glass shell: alpha-blend Fresnel + ISRU green tint + dust film (rim-heavy,
  Panewalker swath uniform `panewalkerPhi`) + portal arch cut (`portalCut`
  shared for S9's frame/iris). No physical transmission on the big shell —
  hero panes elsewhere may use it. `mrt normal.a = 0` (no AO on glass).
- Interior shafts: march that accumulates the DIFFERENCE the lattice makes
  (negative carve + tiny glow), NOT absolute inscatter — the aerial medium
  owns base haze. Net-zero in open sun, so the "wash the whole frame"
  defect class is structurally impossible. Forward-scatter phase on both.

## The lattice-shadow saga (read before touching ANY shadow code)

1. **Per-material `receivedShadowNode` is a trap in three r185**:
   `AnalyticLightNode.setupShadow` caches `shadowColorNode` on the LIGHT for
   the FIRST-built receiver — every other material silently reuses that
   wrap (or its absence). Diagnosed via sine-stripe hook: worked on the
   gallery floor, dead on the groundworks floor, toggled by build order.
2. Therefore the net multiplies into the sun's shadow INSIDE
   `CachedShadowClipmapNode.setup` (adopted from SeaPark, verbatim except
   that multiply) — one place, all receivers, no ordering hazard.
3. **Line coverage must be energy-conserving**: the original reversed-edge
   smoothstep "line" overestimated wildly at large penumbra and produced
   uniform mush. Correct form is the 1-D box-overlap integral
   `clamp((min(d+soft,hw) − max(d−soft,−hw)) / 2soft, 0, 1)`.
4. **The physics verdict**: with the real 0.35° sun, fine-net shadows wash
   out beyond ~30 m from the lattice. The net is CRISP near the rim, reads
   as ~19%-deep soft bands from primary ribs mid-floor, and the crown
   converge casts one substantial blob NE. This is correct and accepted —
   do not "fix" it by shrinking the penumbra (`penumbraScale` is a debug
   dial, ship value 1).

## Groundworks (`src/world/`)

- `parkPlan.ts` is the single source of truth (paths, pads, districts,
  loop, hab sites). `interiorHeight` = relief + pad flattening + bowl.
- Floor: polar grid r ≤ 250 with per-vertex `wear` (desire lines from the
  path graph) and `garden` masks baked at build; regolith material reads
  them (compaction darkening, raked rings in garden zones).
- Paths: Catmull-Rom ribbons hugging the terrain, (s,t) UVs; paver shader
  is a staggered-brick pattern in path-local space with per-brick tone;
  curbs are instanced boxes along paver edges.
- Physics: heightfield collider (160² over the footprint) + 56-segment
  dome wall ring at r 248.9. No colliders outside — view-only exterior.

## Open items

- Boot-time one-shot WebGPU error: a 0×0 texture render on `renderContext_3`
  during init (steady-state clean — verified via console mark test). Chase
  during the S9 warmup rework.
- Paver/floor contrast and the wash-out of albedo variation at distance
  needs a look when real scene content lands (S7/S8).
