# Render pipeline (S1)

Single `RenderPipeline` (three r185 name for the post graph) owns the final
image; `pipeline.outputColorTransform = false` and the one output transform is
the explicit `renderOutput(exposed, AgX, sRGB)` in the graph. Renderer never
tone-maps (side targets stay linear HDR).

Signal order: scene MRT (color + normal/aoReceiver-alpha, MSAA 4×) → GTAO
(half-res) → full-res bilateral reconstruction → hdrTransform hook → bloom →
fixed EV exposure → AgX → 32³ Mars LUT + vignette.

Choices beyond the code:

- **GTAO reconstruction is copied from SeaPark deliberately** (same three
  version): r185 GTAO emits raw magic-square noise, no denoise. The bilateral
  needs all three guards (distance-scaled depth sigma, weak-support fallback
  to box mean, epsilon-guarded normal renormalization) or thin members strobe
  at walking speed. The dome lattice makes this defect class fatal here — do
  not simplify the filter.
- **AO receiver mask** rides the normal MRT alpha: materials that must not
  receive AO (sky, dome glass) write 0 there when they land.
- **`hdrTransform` hook** is where S4's interior haze + shafts transform the
  HDR image (depth-aware), keeping the pipeline file effect-agnostic.
- **Fixed authored exposure** (`gradeParams.exposureEV`) — no meter, no
  adaptation; the frozen afternoon makes metering pointless (plan §0).
- **Mars grade**: warm shadow lift (Mars skylight is butterscotch — shadows
  go warm, never Earth-blue), red gain/blue pull, and green-dominant vibrance
  boost so scarce vegetation pops (design pillar "green is currency").
- `compileAsync()` adapter reaches into `RenderPipeline._quadMesh` (guarded,
  throws on upgrade) because r185 lacks a public async compile for it.
- `?pass=` views: final · nopost · ao · bloom · depth · normal · shafts ·
  shadows (last two filled by S4 via `pipeline.debugNodes`).
- Gallery scene (`?view=gallery`) is the standing calibration set: PBR
  sweeps, emissive bloom bar, thin-member AO sentinel, contact boxes.
