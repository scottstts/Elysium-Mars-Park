import { HalfFloatType, Vector2 } from 'three'
import type { PerspectiveCamera, Scene } from 'three'
import {
  NodeMaterial,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  TempNode,
} from 'three/webgpu'
import type {
  Node,
  NodeBuilder,
  NodeFrame,
  PassNode,
  Renderer,
  TextureNode,
} from 'three/webgpu'
import { NodeUpdateType, mrt, output, passTexture, uv, vec4 } from 'three/tsl'

type RendererState = Parameters<typeof RendererUtils.restoreRendererState>[1]

/**
 * Composites the scene's transparent render list over an already-processed
 * opaque HDR image while retaining opaque-scene occlusion.
 *
 * This is intentionally a render-list split rather than a special-case glass
 * shader. Dome glazing, physical transmission, water, particles and every
 * future transparent material keep Three's normal sorting/blending path. The
 * only changed contract is ordering:
 *
 *   opaque scene -> depth-based medium -> transparent scene
 *
 * Filling the target with `opaqueHdrNode` first also gives transmissive
 * materials the atmosphere-correct framebuffer they expect to refract.
 */
export class TransparentCompositeNode extends TempNode<'vec4'> {
  readonly opaqueHdrNode: Node<'vec4'>
  readonly scene: Scene
  readonly camera: PerspectiveCamera

  private readonly opaqueDepthNode: TextureNode
  private readonly drawingBufferSize = new Vector2()
  private readonly target: RenderTarget
  private readonly textureNode: TextureNode
  private readonly outputMrt = mrt({ output })
  private readonly depthSeedMaterial = new NodeMaterial()
  private readonly copyMaterial = new NodeMaterial()
  private readonly quad = new QuadMesh()
  private rendererState = {} as RendererState

  constructor(
    opaqueHdrNode: Node<'vec4'>,
    scene: Scene,
    camera: PerspectiveCamera,
    opaqueDepthNode: TextureNode,
    samples: number,
  ) {
    super('vec4')
    this.opaqueHdrNode = opaqueHdrNode
    this.scene = scene
    this.camera = camera
    this.opaqueDepthNode = opaqueDepthNode
    this.target = new RenderTarget(1, 1, {
      depthBuffer: true,
      samples,
      type: HalfFloatType,
    })
    // MRTNode resolves outputs by texture NAME. Keeping the canonical output
    // name also lets material-level normal MRT overrides merge safely: their
    // unused normal member is ignored, while output remains a valid struct.
    this.target.texture.name = 'output'
    this.textureNode = passTexture(
      this as unknown as PassNode,
      this.target.texture,
    )
    this.depthSeedMaterial.name = 'Park opaque depth seed'
    this.depthSeedMaterial.depthTest = false
    this.depthSeedMaterial.depthWrite = true
    this.depthSeedMaterial.colorWrite = false
    this.copyMaterial.name = 'Park atmosphere-correct transparent backdrop'
    this.copyMaterial.depthTest = false
    this.copyMaterial.depthWrite = false
    this.updateBeforeType = NodeUpdateType.FRAME
  }

  getTextureNode(): TextureNode {
    return this.textureNode
  }

  setup(builder: NodeBuilder): Node {
    const sharedContext = (
      builder as NodeBuilder & { getSharedContext(): object }
    ).getSharedContext()
    // The composite owns a separate depth attachment. Copy the opaque pass's
    // resolved depth into it with a fullscreen depth write rather than sharing
    // a DepthTexture between RenderTargets: Three's WebGPU backend gives an
    // attachment one lifecycle owner and otherwise destroys it during target
    // resize/disposal while the other target can still reference it.
    this.depthSeedMaterial.fragmentNode = vec4(0).context(sharedContext)
    this.depthSeedMaterial.depthNode = this.opaqueDepthNode
      .sample(uv())
      .r
      .context(sharedContext)
    this.depthSeedMaterial.needsUpdate = true
    this.copyMaterial.fragmentNode = this.opaqueHdrNode.context(sharedContext)
    this.copyMaterial.needsUpdate = true
    return this.textureNode
  }

  updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = frame.renderer
    if (!renderer) return undefined

    const size = renderer.getDrawingBufferSize(this.drawingBufferSize)
    this.ensureSize(size.width, size.height)

    this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState)
    const previousOpaque = renderer.opaque
    const previousTransparent = renderer.transparent
    try {
      renderer.setRenderTarget(this.target)
      renderer.setMRT(this.outputMrt)

      // This target owns both attachments, so a resize/clear can never
      // invalidate the opaque pass. Seed its depth first, then broadcast the
      // processed HDR backdrop to every colour sample.
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, true, false)
      renderer.autoClear = false
      renderer.opaque = true
      renderer.transparent = true

      this.quad.material = this.depthSeedMaterial
      this.quad.name = 'Park transparent composite [ opaque depth seed ]'
      this.quad.render(renderer)

      this.quad.material = this.copyMaterial
      this.quad.name = 'Park transparent composite [ HDR backdrop ]'
      this.quad.render(renderer)

      // Reuse Three's ordinary transparent list. Opaque geometry is neither
      // rebuilt nor redrawn, and depth testing uses the copied opaque depth.
      renderer.opaque = false
      renderer.transparent = true
      renderer.render(this.scene, this.camera)
    } finally {
      renderer.opaque = previousOpaque
      renderer.transparent = previousTransparent
      RendererUtils.restoreRendererState(renderer, this.rendererState)
    }
    return undefined
  }

  /** Compile both the backdrop copy and the transparent-only scene context. */
  async compileAsync(renderer: Renderer): Promise<void> {
    this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState)
    const previousOpaque = renderer.opaque
    const previousTransparent = renderer.transparent
    try {
      renderer.setRenderTarget(this.target)
      renderer.setMRT(this.outputMrt)
      renderer.opaque = true
      renderer.transparent = true
      this.quad.material = this.depthSeedMaterial
      await renderer.compileAsync(this.quad, this.quad.camera)

      this.quad.material = this.copyMaterial
      await renderer.compileAsync(this.quad, this.quad.camera)

      renderer.opaque = false
      renderer.transparent = true
      await renderer.compileAsync(this.scene, this.camera)
    } finally {
      renderer.opaque = previousOpaque
      renderer.transparent = previousTransparent
      RendererUtils.restoreRendererState(renderer, this.rendererState)
    }
  }

  dispose(): void {
    this.target.dispose()
    this.depthSeedMaterial.dispose()
    this.copyMaterial.dispose()
  }

  /** Keep the independently-owned composite attachments at drawing size. */
  syncSize(renderer: Renderer): void {
    const size = renderer.getDrawingBufferSize(this.drawingBufferSize)
    this.ensureSize(size.width, size.height)
  }

  private ensureSize(width: number, height: number): void {
    if (this.target.width === width && this.target.height === height) return
    this.target.setSize(width, height)
  }
}

export const transparentComposite = (
  opaqueHdrNode: Node<'vec4'>,
  scene: Scene,
  camera: PerspectiveCamera,
  opaqueDepthNode: TextureNode,
  samples: number,
): TransparentCompositeNode => new TransparentCompositeNode(
  opaqueHdrNode,
  scene,
  camera,
  opaqueDepthNode,
  samples,
)
