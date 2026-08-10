import { BackSide, DirectionalLight, Mesh, Scene, SphereGeometry } from 'three'
import { MeshBasicNodeMaterial, PMREMGenerator } from 'three/webgpu'
import { float, normalize, positionLocal } from 'three/tsl'
import { CachedShadowClipmapNode } from '../render/cachedShadowClipmaps'
import { DYNAMIC_SHADOW_LAYER } from '../render/layers'
import { createStaticShadowScene } from '../render/staticShadowScene'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { marsSkyRadiance } from './skyRadiance'
import { SUN_LIGHT_INTENSITY, sunColor, sunDirection } from './sun'

/**
 * Sky dome (shared radiance function), the one directional sun with cached
 * camera-centered shadow clipmaps (the fixed-sun dividend, plan §4), and a
 * once-baked PMREM environment. The clipmap node also multiplies in the
 * dome's analytic lattice net — at the light, for every receiver.
 */
export class SkySystem implements GameSystem {
  readonly id = 'sky'

  readonly sun = new DirectionalLight(sunColor, SUN_LIGHT_INTENSITY)
  private dome: Mesh | null = null
  private clipmaps: CachedShadowClipmapNode | null = null

  init(ctx: GameContext): void {
    const { scene, renderer, quality } = ctx

    const domeMaterial = new MeshBasicNodeMaterial()
    domeMaterial.colorNode = marsSkyRadiance(normalize(positionLocal), float(1))
    domeMaterial.side = BackSide
    domeMaterial.depthWrite = false
    domeMaterial.fog = false
    const dome = new Mesh(new SphereGeometry(12500, 64, 32), domeMaterial)
    dome.frustumCulled = false
    dome.renderOrder = -100
    scene.add(dome)
    this.dome = dome

    const sun = this.sun
    sun.castShadow = true
    sun.shadow.mapSize.set(quality.params.shadowMapSizes[0], quality.params.shadowMapSizes[0])
    sun.shadow.bias = -0.0003
    sun.shadow.normalBias = 0.03
    sun.position.copy(sunDirection).multiplyScalar(700)
    sun.target.position.set(0, 0, 0)
    scene.add(sun)
    scene.add(sun.target)
    this.clipmaps = new CachedShadowClipmapNode(sun, {
      camera: ctx.camera,
      levelMapSizes: quality.params.shadowMapSizes,
      firstRadius: 30,
      scaleFactor: 3.2,
      maxDistance: 560,
      // The frozen world never expires; robots/tram render into their own
      // small continuously-refreshed maps on the dynamic caster layer.
      dynamicLevels: 0,
      updateBudget: 1,
      maxCacheAge: 0,
      dynamicCasterLayer: DYNAMIC_SHADOW_LAYER,
      dynamicCasterHalfWidths: [18, 120],
      dynamicCasterMapSizes: [
        quality.params.shadowMapSizes[0],
        quality.params.shadowMapSizes[0],
      ],
    }).attach()

    // Fixed sky → bake the environment exactly once. The bake dome reuses
    // the same radiance material so IBL and the visible sky cannot disagree.
    const envScene = new Scene()
    envScene.add(new Mesh(new SphereGeometry(50, 32, 16), domeMaterial))
    const pmrem = new PMREMGenerator(renderer)
    const envTarget = pmrem.fromScene(envScene, 0.03, 1, 90)
    scene.environment = envTarget.texture
    scene.environmentIntensity = 0.5
    pmrem.dispose()
  }

  update(ctx: GameContext): void {
    // The dome rides the camera: the sky is at optical infinity.
    this.dome?.position.copy(ctx.camera.position)
  }

  /** Called after every world system initialized, before the first render. */
  sealStaticShadowCasters(scene: Scene): void {
    if (!this.clipmaps) return
    const staticShadows = createStaticShadowScene(scene)
    this.clipmaps.setStaticCasterScene(staticShadows.scene, staticShadows.casterCount)
  }

  /** Force every clipmap level to re-render on the next frame (warmup). */
  invalidateShadowLevels(): void {
    this.clipmaps?.invalidate()
  }

  dispose(ctx: GameContext): void {
    if (this.dome) ctx.scene.remove(this.dome)
    this.clipmaps?.detach()
    ctx.scene.remove(this.sun)
    this.dome = null
  }
}
