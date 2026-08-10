# Mars sky & exterior world (S2 + S3)

## Sky (`src/sky/`)

- `marsSkyRadiance` is the ONE sky function — dome mesh, PMREM environment
  bake, and any future reflector sample it; they can never disagree.
- Dust-Mie model, all Earth intuitions reversed: butterscotch column, horizon
  brighter than zenith, **cool blue circumsolar glow** (tuned subtle — at 27°
  elevation the blue effect is mild; it peaks at sunset which we never show).
- Sun disc: true 0.35° angular size, Neckel–Labs limb darkening, feathered in
  x² space (numerically stable near cos≈1). Disc ~1800 HDR drives bloom.
- Sun light + env are baked/created once at init (frozen afternoon). The
  4096² single shadow map (±120 m) is an interim rig — S4/S5 replace it with
  cached clipmaps + the analytic lattice net.
- Sun vector: elevation 27°, azimuth 250° — `sky/sun.ts` is the single owner;
  everything (shadows, shafts, lattice net, glints) must import from there.

## Aerial perspective (`src/exterior/marsAerialPerspective.ts`)

- ONE continuous dust medium, applied screen-space in `pipeline.hdrTransform`
  (SeaPark pattern): e-fold ~3.6 km, start 55 m, max 0.93. Interior sightlines
  (≤500 m) get a just-perceptible cue from the same function — deliberate.
- **Inscatter sits AT horizon-sky radiance (dustHazeTint × 0.6), never above**
  — brighter inscatter bleaches the world instead of veiling it (defect seen
  and fixed in S3 probing). Sunward forward-scatter lobe glows the haze.

## Exterior terrain (`src/exterior/`)

- Pure-function height field (`terrainHeight.ts`), lattice-hash value noise —
  deterministic, no RNG state. Crater rim S (2.6 km ring), mesa talus mounds
  W, pad graded flat within ~300 m (fiction: colonists graded it).
- Three polar ring meshes (252 m → 11.2 km) with smooth radial bias; CPU
  finite-difference normals; NO colliders (view-only, plan §5).
- Mesas are separate hero meshes (ring sampling too coarse for silhouettes):
  plateau → hard rim lip → pow-curve cliff (with per-row radial jitter) →
  long talus, edge-blended into the ring surface. Strata tint on steep faces.
- Boulders: 3 deformed-icosahedron variants, ~2400 instances, denser near the
  dome, south tram corridor kept clear (S9 dependency baked in now).
- Dust devils ×2: tapered open cylinders, contrasty scrolled noise opacity,
  dense skirt / wispy crown, drifting on sim time far west. Motion is allowed
  under the frozen-afternoon rule (machines and dust move; the SUN does not).
- Bloom threshold 1.6 so the dust lobes never bloom; only disc + halo do.
