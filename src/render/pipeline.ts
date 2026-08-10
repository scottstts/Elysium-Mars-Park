import { AgXToneMapping, ColorManagement, NoToneMapping, SRGBColorSpace } from 'three'
import type { Camera, Mesh } from 'three'
import { RenderPipeline } from 'three/webgpu'
import type { Node, PassNode } from 'three/webgpu'
import {
  Fn,
  If,
  dFdx,
  dFdy,
  dot,
  exp,
  exp2,
  float,
  getViewPosition,
  inverseSqrt,
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
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { gradeParams, marsGrade } from './grade'
import { recommendedPixelRatio } from './renderer'

/** Contact-AO world radius: benches, conduit runs, rock bases, deck seams. */
const AO_WORLD_RADIUS = 0.3

/**
 * The one owner of the final image (plan §4).
 * Signal order: scene MRT (color/normal/depth, MSAA 4×) → GTAO (half-res,
 * bilateral-reconstructed, multiplied into HDR) → hdrTransform hook (interior
 * haze + shafts splice here in S4) → bloom (HDR, pre-tonemap) → fixed
 * authored exposure → AgX + sRGB via renderOutput → Mars grade.
 */
export class RenderPipelineSystem implements GameSystem {
  readonly id = 'render-pipeline'
  /** Named debug taps for ?pass= isolation, registered by effect owners. */
  readonly debugNodes: Record<string, object> = {}

  private pipeline: RenderPipeline | null = null
  private appliedScale = 1
  private basePixelRatio = recommendedPixelRatio()
  private context: GameContext | null = null

  /**
   * The scene pass — exposed so loading-time warmup precompiles materials
   * against the exact render-context state (MRT + MSAA) the live frame uses.
   */
  scenePass: PassNode | null = null

  /**
   * HDR atmosphere hook. Interior haze/shafts (S4) transform the lit HDR
   * color using reconstructed view depth before bloom sees the image.
   */
  hdrTransform: (
    hdrColor: object,
    extras: { viewZNode: object; sceneDepthNode: object },
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
    // The normal target's spare alpha is the AO-receiver mask: lit opaque
    // materials inherit 1; sky/glass override to 0 where AO must not apply.
    scenePass.setMRT(mrt({ output, normal: vec4(normalView, 1) }))
    this.scenePass = scenePass

    const sceneColor = scenePass.getTextureNode('output')
    const sceneNormal = scenePass.getTextureNode('normal')
    const sceneDepth = scenePass.getTextureNode('depth')

    const aoNode = ao(sceneDepth, sceneNormal, camera)
    aoNode.resolutionScale = 1 / ctx.quality.params.aoDivisor
    aoNode.radius.value = AO_WORLD_RADIUS
    const aoTexture = aoNode.getTextureNode()
    const aoResolution = aoNode.resolution as unknown as Node<'vec2'>

    // Three r185 GTAO emits raw half-resolution magic-square noise with no
    // denoise. Reconstruct at full resolution with an eight-neighbour
    // bilateral: depth similarity (distance-scaled tolerance) rejects
    // fore/background bleeding, normal similarity preserves edges, and weak
    // bilateral support falls back to the nine-tap mean — never the raw
    // centre sample, which strobes on thin members (dome lattice!) at
    // walking speed. MSAA-resolved normals can cancel to zero length at
    // silhouettes; epsilon-guarded inverse sqrt avoids WGSL fast-math NaN.
    // r185 WebGPU renders REVERSED-Z: the cleared background is depth 0
    // (sky/glass write no depth). Guard BOTH ends everywhere.
    const projectionInverse = uniform(camera.projectionMatrixInverse)
    const filteredAo = Fn(() => {
      const centerUv = uv()
      const centerDepth = sceneDepth.sample(centerUv).r
      const result = float(1).toVar()
      If(centerDepth.lessThan(0.999999).and(centerDepth.greaterThan(1e-7)), () => {
        const centerView = getViewPosition(centerUv, centerDepth, projectionInverse)
        const centerRaw = sceneNormal.sample(centerUv).rgb
        const centerNormal = centerRaw.mul(inverseSqrt(max(dot(centerRaw, centerRaw), 1e-8)))
        const centerVisibility = aoTexture.sample(centerUv).r
        const texel = vec2(1).div(aoResolution)
        const depthSigma = max(float(0.08), centerView.z.abs().mul(0.04))
        const weightedSum = centerVisibility.toVar()
        const weightSum = float(1).toVar()
        const boxSum = centerVisibility.toVar()
        const offsets = [
          [-1, -1], [0, -1], [1, -1],
          [-1, 0], [1, 0],
          [-1, 1], [0, 1], [1, 1],
        ] as const

        for (const [x, y] of offsets) {
          const sampleUv = centerUv.add(texel.mul(vec2(x, y)))
          const sampleDepth = sceneDepth.sample(sampleUv).r
          const sampleView = getViewPosition(sampleUv, sampleDepth, projectionInverse)
          const sampleRaw = sceneNormal.sample(sampleUv).rgb
          const sampleNormal = sampleRaw.mul(inverseSqrt(max(dot(sampleRaw, sampleRaw), 1e-8)))
          const visibility = aoTexture.sample(sampleUv).r
          const depthWeight = exp(sampleView.z.sub(centerView.z).abs().div(depthSigma).negate())
          const normalWeight = pow(max(dot(centerNormal, sampleNormal), 0), 12)
          const spatialWeight = x !== 0 && y !== 0 ? 0.70710678 : 1
          const weight = depthWeight.mul(normalWeight).mul(spatialWeight)
          weightedSum.addAssign(visibility.mul(weight))
          weightSum.addAssign(weight)
          boxSum.addAssign(visibility)
        }

        const support = smoothstep(0.35, 1.6, weightSum.sub(1))
        result.assign(mix(boxSum.div(9), weightedSum.div(weightSum), support))
      })
      return result
    })()

    // AO is a contact effect: fade it out where the half-res gather texel
    // approaches the world radius (grazing regolith at range would otherwise
    // quantize into false-occlusion rows) and beyond hero distance entirely.
    // Under r185's reversed-z, getViewZNode() mislinearizes at range — every
    // distance consumer derives from the RECONSTRUCTED view position instead
    // (getViewPosition uses the true projection inverse, convention-proof).
    const footprintDepth = sceneDepth.sample(uv()).r.clamp(1e-7, 0.999999)
    const footprintView = getViewPosition(uv(), footprintDepth, projectionInverse)
    const viewZNode = footprintView.z
    const aoDistance = (viewZNode as unknown as ReturnType<typeof float>).negate()
    const aoGatherFootprint = max(dFdx(footprintView).length(), dFdy(footprintView).length()).mul(2.0)
    const aoFootprintFade = smoothstep(AO_WORLD_RADIUS * 0.25, AO_WORLD_RADIUS, aoGatherFootprint)
    const aoDistanceFade = smoothstep(60.0, 160.0, aoDistance)
    const aoReliabilityFade = max(aoDistanceFade, aoFootprintFade)
    const distanceFilteredAo = mix(filteredAo, float(1), aoReliabilityFade)
    const aoReceiver = sceneNormal.a.clamp(0, 1)
    const aoAmount = mix(float(1), distanceFilteredAo, aoReceiver)
    const occluded = sceneColor.mul(aoAmount)

    const withMedium = this.hdrTransform(occluded, {
      viewZNode,
      sceneDepthNode: sceneDepth.sample(uv()).r,
    }) as typeof occluded

    // Bloom hierarchy (scene-relative): sun glints > emissive displays >
    // grow lights. Threshold sits above diffuse afternoon whites AND above
    // the sky's dust lobes so only true HDR sources (disc, glints) bloom.
    const bloomNode = bloom(withMedium, 0.16, 0.35, 1.6)
    const hdr = withMedium.add(bloomNode)

    const exposed = hdr.mul(exp2(gradeParams.exposureEV))
    const mapped = renderOutput(exposed, AgXToneMapping, SRGBColorSpace)
    const graded = marsGrade(mapped)

    let outputNode
    switch (flags.pass) {
      case 'ao':
        outputNode = vec4(vec3(filteredAo), 1.0)
        break
      case 'bloom':
        outputNode = renderOutput(bloomNode, AgXToneMapping, SRGBColorSpace)
        break
      case 'depth': {
        const linearDepth = scenePass.getLinearDepthNode()
        outputNode = vec4(vec3(linearDepth as unknown as Node<'float'>), 1.0)
        break
      }
      case 'normal':
        outputNode = vec4(sceneNormal.rgb.mul(0.5).add(0.5), 1.0)
        break
      case 'shafts':
        outputNode = renderOutput(
          (this.debugNodes.shafts ?? vec4(0, 0, 0, 1)) as typeof sceneColor,
          AgXToneMapping,
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
      case 'nopost':
        outputNode = renderOutput(sceneColor, AgXToneMapping, SRGBColorSpace)
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
    this.pipeline?.dispose()
    this.pipeline = null
    this.context = null
    this.scenePass = null
  }
}
