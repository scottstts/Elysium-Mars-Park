import {
  ColorManagement,
  FloatType,
  NeutralToneMapping,
  NormalBlending,
  NoToneMapping,
  SRGBColorSpace,
} from 'three'
import type { Camera, Mesh } from 'three'
import { BlendMode, RenderPipeline } from 'three/webgpu'
import type { Node, PassNode } from 'three/webgpu'
import {
  Fn,
  If,
  dot,
  exp,
  exp2,
  float,
  fract,
  getViewPosition,
  inverseSqrt,
  luminance,
  max,
  mix,
  mrt,
  normalView,
  output,
  pass,
  pow,
  renderOutput,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { latticeSunVisibility } from '../dome/latticeField'
import { marsAmbientIrradiance } from '../sky/skyRadiance'
import { ENVIRONMENT_INTENSITY, SUN_LIGHT_INTENSITY, sunColor, sunDirectionUniform } from '../sky/sun'
import { gtaoVisibility, type GtaoVisibilityNode } from './gtaoVisibility'
import { gradeParams, marsGrade } from './grade'
import { recommendedPixelRatio } from './renderer'

/**
 * Scene-camera coordinates reconstructed once for fullscreen HDR effects.
 *
 * A RenderPipeline draws its final graph with an internal orthographic quad
 * camera, so TSL's implicit camera nodes do not describe the player camera in
 * this part of the graph. Effect owners must consume this explicit context
 * instead of importing cameraPosition/cameraWorldMatrix themselves.
 */
export interface HdrTransformContext {
  sceneDepthNode: Node<'float'>
  viewPositionNode: Node<'vec3'>
  viewZNode: Node<'float'>
  cameraWorldPositionNode: Node<'vec3'>
  worldDirectionNode: Node<'vec3'>
  surfaceWorldNode: Node<'vec3'>
}

/**
 * Contact-AO world radius. Raised from the S4 value of 0.3 m for the rebuilt
 * park: the reference image's grounding comes from 0.3–0.8 m features —
 * kerb noses, planter walls, bench legs, building bases, the reveal under a
 * canopy. A 0.3 m gather never reaches the second surface of any of those.
 */
const AO_WORLD_RADIUS = 0.9
/**
 * Max |Δview-Z| for an occluder to count (m). Three's default is 1.0, which
 * accepts a background surface a metre behind a silhouette and paints the
 * classic thick dark halo around every foreground object.
 */
const AO_THICKNESS = 0.35
/** Visibility power: >1 deepens creases without touching open surfaces. */
const AO_POWER = 2.0
/**
 * Sample spacing bias. The gather spaces taps as `((j+1)/steps)^distanceExponent`,
 * so >1 crowds them toward the centre: with the wide 0.9 m radius above we
 * still get a tight contact line at a kerb nose AND reach the far wall of a
 * planter. Radius alone would trade one for the other.
 */
const AO_DISTANCE_EXPONENT = 2.0
/** Minimum AO authority on a fully sunlit surface (see the composite below). */
const AO_DIRECT_FLOOR = 0.45

/**
 * BLOOM THRESHOLD — the anchor of the whole emissive ladder.
 *
 * Scene-linear HDR, evaluated BEFORE exposure. White structural paint in full
 * sun peaks near 0.9 (albedo 0.8 / π × sun 3.15 × cos 27°, plus ambient), so
 * 1.0 sits just above every ordinary lit surface and just below the dimmest
 * authored emitter (`interiorGlow`, ×2.0). Sun glints on metal cross it, and
 * they should. See world/lightFixtures.ts for the full ladder.
 */
const BLOOM_THRESHOLD = 1.0
const BLOOM_STRENGTH = 0.3
const BLOOM_RADIUS = 0.55
/**
 * Three's r185 default is 0.01 — a hard cut at the threshold, so a highlight
 * crossing it pops. 0.08 gives the knee a real width.
 */
const BLOOM_SMOOTH_WIDTH = 0.08

/**
 * The one owner of the final image (plan §4).
 * Signal order: scene MRT (color/normal/albedo, MSAA 4×) → GTAO (half-res,
 * bilateral-reconstructed, applied to reconstructed INDIRECT only) →
 * hdrTransform hook (aerial medium + interior dust/shafts) → bloom (HDR,
 * pre-tonemap) → fixed authored exposure → Neutral tone map + sRGB via
 * renderOutput → Mars grade LUT + vignette + dither.
 */
export class RenderPipelineSystem implements GameSystem {
  readonly id = 'render-pipeline'
  /** Named debug taps for ?pass= isolation, registered by effect owners. */
  readonly debugNodes: Record<string, object> = {}

  private pipeline: RenderPipeline | null = null
  private appliedScale = 1
  private basePixelRatio = recommendedPixelRatio()
  private context: GameContext | null = null
  private gtaoNode: GtaoVisibilityNode | null = null

  /**
   * The scene pass — exposed so loading-time warmup precompiles materials
   * against the exact render-context state (MRT + MSAA) the live frame uses.
   */
  scenePass: PassNode | null = null

  /**
   * HDR atmosphere hook. Interior haze/shafts transform the lit HDR color
   * using reconstructed view depth before bloom sees the image.
   */
  hdrTransform: (
    hdrColor: object,
    extras: HdrTransformContext,
  ) => object = (c) => c

  init(ctx: GameContext): void {
    const { renderer, scene, camera, flags } = ctx
    this.context = ctx
    ctx.events.on('render/resized', ({ width, height }) => {
      this.basePixelRatio = recommendedPixelRatio(width, height)
      renderer.setPixelRatio(this.basePixelRatio * ctx.quality.renderScale)
    })

    // The renderer itself NEVER tone-maps: side targets stay linear HDR.
    renderer.toneMapping = NoToneMapping

    const scenePass = pass(scene, camera, { samples: 4 })
    // depth32float, not the 24-bit default (r185 PassNode ships FloatType
    // commented out). Under reversed-z, 24-bit fixed depth quantizes the
    // mid-field ground into iso-depth plateaus, and every consumer that
    // RECONSTRUCTS positions from depth (the GTAO horizon march above all)
    // reads the plateau steps as geometry — full-width horizontal
    // "barcode" bands on open regolith (owner report, provable in
    // ?pass=ao). Float depth is what the pipeline's reversed-z guards
    // assume everywhere else.
    if (scenePass.renderTarget.depthTexture) {
      scenePass.renderTarget.depthTexture.type = FloatType
    }
    // The normal target's spare alpha is the AO-receiver mask: lit opaque
    // materials inherit 1; sky/glass override to 0 where AO must not apply.
    // `albedo` is what lets AO stay off direct light (see the composite
    // below); `diffuseColor` is the material's base colour before any
    // lighting, which is exactly the quantity the indirect estimate needs.
    const sceneMrt = mrt({ output, normal: vec4(normalView, 1) })
    // THE MOVING-RECTANGLE ARTIFACT, ROOT CAUSE (owner report, three times):
    // in r185 an MRT attachment that is not `output` gets NO blend state —
    // the material's own blending applies to `output` only, so every
    // transparent/additive fragment REPLACED the normal+receiver buffer
    // across its full rasterized quad (a sprite rasterizes its whole
    // rectangle; opacity only gates colour). The earlier per-material
    // `mrtNode = mrt({ normal: vec4(0) })` fix therefore did not "add
    // nothing" — it stamped zero normals + zero receiver over the quad,
    // which punched moving AO-holes and fed zero-length vectors into the
    // GTAO/bilateral/share chain (normalize(0) = NaN on strict-IEEE paths).
    // The pass-level per-attachment blend below makes the attachment's own
    // source alpha the WRITE AUTHORITY (src·a + dst·(1−a); alpha One /
    // OneMinusSrcAlpha): opaque materials write (normal, 1) → exact replace,
    // bit-identical to before; any material that writes vec4(0) — the mist
    // puffs, the reclaimer vapour, all glazing — now leaves the G-buffer
    // untouched, so AO behind a puff is the AO without the puff, by
    // construction. Per-material MRT blend modes do NOT work in r185 (the
    // pipeline reads blend state from the PASS-level node only, and
    // MRTNode.merge drops them besides) — this must stay on the pass node.
    sceneMrt.setBlendMode('normal', new BlendMode(NormalBlending))
    scenePass.setMRT(sceneMrt)
    this.scenePass = scenePass

    const sceneColor = scenePass.getTextureNode('output')
    const sceneNormal = scenePass.getTextureNode('normal')
    const sceneDepth = scenePass.getTextureNode('depth')

    const projectionInverse = uniform(camera.projectionMatrixInverse)
    const cameraWorld = uniform(camera.matrixWorld)
    const aoNode = gtaoVisibility(sceneDepth, sceneNormal, camera)
    aoNode.resolutionScale = 1 / ctx.quality.params.aoDivisor
    aoNode.radius.value = AO_WORLD_RADIUS
    aoNode.thickness.value = AO_THICKNESS
    aoNode.power.value = AO_POWER
    aoNode.distanceExponent.value = AO_DISTANCE_EXPONENT
    const aoTexture = aoNode.getTextureNode()
    const rawAoTexture = aoNode.getRawTextureNode()
    const aoResolution = aoNode.resolution as unknown as Node<'vec2'>
    this.gtaoNode = aoNode

    // The custom node has already removed gather noise at half resolution.
    // Reconstruct that scalar visibility at full resolution with the four
    // actual bilinear neighbours, then replace the hardware bilinear weights
    // with depth/normal-aware weights. This avoids both 2:1 resample beating
    // and visibility leaking across silhouettes while keeping the upsample
    // bounded to four reads. r185 WebGPU is reversed-Z: depth 0 is sky.
    const reconstructedAo = Fn(() => {
      const centerUv = uv()
      const centerDepth = sceneDepth.sample(centerUv).r
      const result = float(1).toVar()
      If(centerDepth.lessThan(0.999999).and(centerDepth.greaterThan(1e-7)), () => {
        const centerView = getViewPosition(centerUv, centerDepth, projectionInverse)
        const centerRaw = sceneNormal.sample(centerUv).rgb
        const centerNormal = centerRaw.mul(inverseSqrt(max(dot(centerRaw, centerRaw), 1e-8)))
        const aoPixel = centerUv.mul(aoResolution).sub(0.5)
        const basePixel = aoPixel.floor()
        const subpixel = fract(aoPixel)
        const weightedSum = float(0).toVar()
        const weightSum = float(0).toVar()

        for (const y of [0, 1] as const) {
          for (const x of [0, 1] as const) {
            const sampleUv = basePixel
              .add(vec2(x, y))
              .add(0.5)
              .div(aoResolution)
              .clamp(
                vec2(0.5).div(aoResolution),
                vec2(1).sub(vec2(0.5).div(aoResolution)),
              )
            const sampleDepth = sceneDepth.sample(sampleUv).r
            const sampleValid = sampleDepth
              .greaterThan(1e-7)
              .and(sampleDepth.lessThan(0.999999))
            const sampleView = getViewPosition(
              sampleUv,
              sampleDepth.clamp(1e-7, 0.999999),
              projectionInverse,
            )
            const sampleRaw = sceneNormal.sample(sampleUv).rgb
            const sampleNormal = sampleRaw.mul(
              inverseSqrt(max(dot(sampleRaw, sampleRaw), 1e-8)),
            )
            const visibility = aoTexture.sample(sampleUv).r
            const xWeight = x === 0 ? float(1).sub(subpixel.x) : subpixel.x
            const yWeight = y === 0 ? float(1).sub(subpixel.y) : subpixel.y
            const bilinearWeight = xWeight.mul(yWeight)
            const depthSigma = max(float(0.04), centerView.z.abs().mul(0.002))
            const depthWeight = exp(
              sampleView.z.sub(centerView.z).abs().div(depthSigma).negate(),
            )
            const normalWeight = pow(max(dot(centerNormal, sampleNormal), 0), 16)
            const validWeight = sampleValid.select(float(1), float(0))
            const weight = bilinearWeight
              .mul(depthWeight)
              .mul(normalWeight)
              .mul(validWeight)
            weightedSum.addAssign(visibility.mul(weight))
            weightSum.addAssign(weight)
          }
        }

        const centerAoUv = centerUv
          .mul(aoResolution)
          .floor()
          .add(0.5)
          .div(aoResolution)
        result.assign(
          weightSum
            .greaterThan(0.0001)
            .select(weightedSum.div(weightSum), aoTexture.sample(centerAoUv).r),
        )
      })
      return result
    })()

    // Retire AO only when its world radius no longer spans enough AO texels
    // to resolve a horizon. The projected-radius criterion adapts to FOV,
    // viewport resolution, render scale, and AO divisor; it replaces the old
    // fixed 28→70 m workaround and does not hide a near/mid-field defect.
    const sceneDepthNode = sceneDepth.sample(uv()).r
    const footprintDepth = sceneDepthNode.clamp(1e-7, 0.999999)
    const footprintView = getViewPosition(uv(), footprintDepth, projectionInverse)
    const viewZNode = footprintView.z
    // These are deliberately derived from the explicit SCENE camera uniform.
    // The final graph itself is rendered by RenderPipeline's orthographic
    // fullscreen camera; implicit TSL camera nodes would bind to that camera
    // and make world-space effects screen-fixed.
    const cameraWorldPositionNode = cameraWorld.mul(vec4(0, 0, 0, 1)).xyz
    const worldDirectionNode = cameraWorld
      .mul(vec4(footprintView.normalize(), 0))
      .xyz.normalize()
    const surfaceWorld = cameraWorld.mul(vec4(footprintView, 1)).xyz
    const projectedAoRadius = aoNode.projectedRadiusPixels(viewZNode)
    const aoCompetence = smoothstep(8, 16, projectedAoRadius)
    const distanceFilteredAo = mix(float(1), reconstructedAo, aoCompetence)
    const aoReceiver = sceneNormal.a.clamp(0, 1)
    const aoAmount = mix(float(1), distanceFilteredAo, aoReceiver)

    // ── AO APPLIED TO INDIRECT ONLY ─────────────────────────────────────
    // `sceneColor.mul(ao)` — what this pipeline did through S14 — darkens
    // DIRECT sunlight too. On a scene whose whole subject is a low sun
    // raking across paving, that is the documented "sunlit surfaces become
    // gray" failure, and it was a first-order cause of the flat tan read.
    //
    // The GTAO reference's fix reconstructs indirect as `albedo × irradiance`
    // from an albedo MRT attachment. THAT ROUTE IS A DEAD END IN r185: adding
    // `diffuseColor` to the pass-level MRT writes ONE material's albedo for
    // every material that does not override `material.mrtNode` (verified —
    // ground, foliage, benches and building shells all came out the same
    // brown, while glass and the milky panels, which DO override mrtNode and
    // therefore get their own merged MRT node, were correct). Do not re-try
    // it without solving that first; see dev_docs/systems/render-pipeline.md.
    //
    // Take the ratio instead, which needs no albedo at all. For a diffuse
    // surface, sceneColor = albedo · (E_ambient + E_sun·N·L·shadow), so
    //     indirectFraction = E_ambient / (E_ambient + E_sun·N·L·shadow)
    // is ALBEDO-FREE, and `direct + indirect·ao` collapses to the single
    // multiply `sceneColor · mix(1, ao, indirectFraction)`. Both terms are
    // evaluated from the same sky palette and sun the scene is lit by, so
    // they cannot drift; `shadow` uses the analytic dome-lattice visibility
    // (the one shadow signal a post pass can evaluate exactly).
    const normalRaw = sceneNormal.rgb
    const normalUnit = normalRaw.mul(inverseSqrt(max(dot(normalRaw, normalRaw), 1e-8)))
    // Explicit uniform rather than TSL's `cameraWorldMatrix`: inside a
    // fullscreen post pass the implicit camera nodes are the pipeline's
    // business, and the SCENE camera is what turns a view normal into a
    // world normal. Same discipline as `projectionInverse` above.
    // NO bare `.normalize()` here: `normalUnit` is already unit-or-zero
    // (epsilon-guarded above) and the camera matrix is rigid, so a second
    // normalize adds nothing for valid normals and turns the zero vector
    // into NaN — which then rides `indirectFraction` into the composite as
    // undefined-colour pixels on some drivers.
    const worldNormal = cameraWorld.mul(vec4(normalUnit, 0)).xyz
    const ambientTerm = luminance(marsAmbientIrradiance(worldNormal)).mul(ENVIRONMENT_INTENSITY)
    const sunTerm = max(dot(worldNormal, sunDirectionUniform), 0)
      .mul(SUN_LIGHT_INTENSITY * (0.2126 + 0.7152 * sunColor.g + 0.0722 * sunColor.b))
      .mul(latticeSunVisibility(surfaceWorld))
    // Floor: even in full sun, ambient occlusion still eats near-field bounce
    // and part of the 0.35° sun's own penumbra, and the ratio cannot see
    // shadows cast by buildings (no shadow map is reachable from a post
    // pass). The floor keeps contact corners grounded everywhere without
    // letting AO gray out open sunlit paving.
    const indirectFraction = max(ambientTerm.div(ambientTerm.add(sunTerm)), AO_DIRECT_FLOOR)
    const aoApplied = mix(float(1), aoAmount, indirectFraction)
    const occluded = vec4(sceneColor.rgb.mul(aoApplied), sceneColor.a)

    const withMedium = this.hdrTransform(occluded, {
      viewZNode,
      sceneDepthNode,
      viewPositionNode: footprintView,
      cameraWorldPositionNode,
      worldDirectionNode,
      surfaceWorldNode: surfaceWorld,
    }) as typeof occluded

    const bloomNode = bloom(withMedium, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
    bloomNode.smoothWidth.value = BLOOM_SMOOTH_WIDTH
    const hdr = withMedium.add(bloomNode)

    // Neutral (Khronos PBR Neutral) replaces AgX here. AgX desaturates hard
    // across the whole mid-range, and on a palette that is ALREADY one hue
    // family it collapsed rust paving, ochre regolith, warm steel and the
    // butterscotch sky into a single tan — the documented "everything grades
    // to regolith tan" trap. Neutral holds chroma up to its compression knee
    // and desaturates only genuine near-white, which is exactly the reference
    // image's behaviour: rich terracotta mids, clean warm highlights.
    const exposed = hdr.mul(exp2(gradeParams.exposureEV))
    const mapped = renderOutput(exposed, NeutralToneMapping, SRGBColorSpace)
    const graded = marsGrade(mapped)

    // Diagnostic taps. AO's raw gather, denoised half-res visibility,
    // full-res reconstruction, projected-radius competence, indirect share,
    // and applied term are all independently isolatable through PassName.
    const passName =
      new URLSearchParams(window.location.search).get('pass') ?? (flags.pass as string)
    const aoDebugUv = uv()
      .mul(aoResolution)
      .floor()
      .add(0.5)
      .div(aoResolution)

    let outputNode
    switch (passName) {
      case 'ao':
        outputNode = vec4(vec3(reconstructedAo), 1.0)
        break
      case 'aoraw':
        outputNode = vec4(vec3(rawAoTexture.sample(aoDebugUv).r), 1.0)
        break
      case 'aodenoised':
        outputNode = vec4(vec3(aoTexture.sample(aoDebugUv).r), 1.0)
        break
      case 'aoradius':
        outputNode = vec4(vec3(projectedAoRadius.div(16).clamp(0, 1)), 1.0)
        break
      case 'bloom':
        outputNode = renderOutput(bloomNode, NeutralToneMapping, SRGBColorSpace)
        break
      // How much authority AO has at each pixel: black = pure direct sun
      // (AO must not touch it), white = pure ambient (AO owns it).
      case 'aoshare':
        outputNode = vec4(vec3(indirectFraction), 1.0)
        break
      // The AO term actually multiplied into the image, after the share.
      case 'aoapplied':
        outputNode = vec4(vec3(aoApplied), 1.0)
        break
      case 'depth': {
        const linearDepth = scenePass.getLinearDepthNode()
        outputNode = vec4(vec3(linearDepth as unknown as Node<'float'>), 1.0)
        break
      }
      case 'normal':
        outputNode = vec4(sceneNormal.rgb.mul(0.5).add(0.5), 1.0)
        break
      // Scene-camera world ray encoded from [-1, 1] to [0, 1]. This must
      // rotate when the player camera rotates; a screen-fixed result means a
      // fullscreen effect has accidentally rebound to the pipeline quad.
      case 'worldray':
        outputNode = vec4(worldDirectionNode.mul(0.5).add(0.5), 1.0)
        break
      case 'shafts':
        outputNode = renderOutput(
          (this.debugNodes.shafts ?? vec4(0, 0, 0, 1)) as typeof sceneColor,
          NeutralToneMapping,
          SRGBColorSpace,
        )
        break
      case 'shadows':
        outputNode = vec4(
          vec3((this.debugNodes.shadows ?? float(1)) as Node<'float'>),
          1,
        )
        break
      case 'haze':
        outputNode = (this.debugNodes.haze ?? vec4(0, 0, 0, 1)) as typeof sceneColor
        break
      case 'nograde':
        outputNode = mapped
        break
      case 'nopost':
        outputNode = renderOutput(sceneColor, NeutralToneMapping, SRGBColorSpace)
        break
      default:
        outputNode = graded
    }

    const pipeline = new RenderPipeline(renderer, outputNode)
    // renderOutput() is placed explicitly in the graph above — the pipeline
    // must not apply a second output transform.
    pipeline.outputColorTransform = false
    this.pipeline = pipeline
  }

  /** Bound to GameLoop.renderFrame by main.ts. */
  render(): void {
    void this.pipeline?.render()
  }

  /**
   * Compile the ACTUAL final fullscreen pipeline through WebGPU's async path
   * so the first presented frame never stalls on pipeline creation. Three
   * r185 has no RenderPipeline.compileAsync(); its concrete quad is a normal
   * Mesh — keep this adapter guarded so an upgrade fails loudly at load.
   */
  async compileAsync(): Promise<void> {
    const renderer = this.context?.renderer
    const pipeline = this.pipeline as unknown as {
      _quadMesh?: Mesh & { camera?: Camera }
      _update?: () => void
    } | null
    if (!renderer || !pipeline) return
    if (typeof pipeline._update !== 'function' || !pipeline._quadMesh?.camera) {
      throw new Error('Three RenderPipeline warmup contract changed')
    }

    pipeline._update()
    const previousToneMapping = renderer.toneMapping
    const previousOutputColorSpace = renderer.outputColorSpace
    const previousXr = renderer.xr.enabled
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = ColorManagement.workingColorSpace
    renderer.xr.enabled = false
    try {
      await renderer.compileAsync(pipeline._quadMesh, pipeline._quadMesh.camera)
    } finally {
      renderer.xr.enabled = previousXr
      renderer.toneMapping = previousToneMapping
      renderer.outputColorSpace = previousOutputColorSpace
    }
  }

  update(ctx: GameContext): void {
    // Dynamic resolution: quality breathes render scale; pass targets follow
    // the renderer's drawing-buffer size automatically.
    const target = ctx.quality.renderScale
    if (Math.abs(target - this.appliedScale) > 0.01) {
      this.appliedScale = target
      ctx.renderer.setPixelRatio(this.basePixelRatio * target)
    }
  }

  dispose(): void {
    this.gtaoNode?.dispose()
    this.gtaoNode = null
    this.pipeline?.dispose()
    this.pipeline = null
    this.context = null
    this.scenePass = null
  }
}
