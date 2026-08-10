import { BackSide, DirectionalLight, Mesh, Scene, SphereGeometry } from 'three'
import { MeshBasicNodeMaterial, PMREMGenerator } from 'three/webgpu'
import { float, normalize, positionLocal } from 'three/tsl'
import { CachedShadowClipmapNode } from '../render/cachedShadowClipmaps'
import { DYNAMIC_SHADOW_LAYER } from '../render/layers'
import { createStaticShadowScene } from '../render/staticShadowScene'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { installLightFixtures, type LightFixtureRig } from '../world/lightFixtures'
import { marsSkyRadiance } from './skyRadiance'
import { ENVIRONMENT_INTENSITY, SUN_LIGHT_INTENSITY, sunColor, sunDirection } from './sun'

/**
 * The lighting owner: sky dome (shared radiance function), the one directional
 * sun with cached camera-centered shadow clipmaps (the fixed-sun dividend,
 * plan §4), a once-baked PMREM environment, and the artificial light rig. The
 * clipmap node also multiplies in the dome's analytic lattice net — at the
 * light, for every receiver.
 */

/**
 * CLIPMAP LADDER — re-derived for the 260 m dome (the world halved in the
 * overhaul; the old 30/96/560 ladder was cut for a 500 m dome).
 *
 * Three constraints decide these numbers:
 *  1. The finest level must resolve a KERB. At 12 m half-width on a 4096 map
 *     the texel is 5.9 mm, so a 120 mm curb nose casts a shadow with a real
 *     edge instead of a smear. This is the single biggest contributor to the
 *     reference image's "everything is sitting on the ground" read.
 *  2. Levels must be a geometric ladder that ENDS at maxDistance, because the
 *     node clamps the last level to `maxDistance` regardless of the factor.
 *     12 · 2.9³ ≈ 293 ≈ 260, so no level makes an outsized jump. The old set
 *     jumped 96 → 560 (5.8×), which forced level-2 normal bias to 0.75 m —
 *     a peter-panning generator at park scale.
 *  3. maxDistance only has to cover the dome: 260 m is the full diameter, and
 *     everything beyond the glass is either analytic (the lattice net) or too
 *     far for a shadow map to matter.
 */
const CLIPMAP_FIRST_RADIUS = 12
const CLIPMAP_SCALE_FACTOR = 2.9
const CLIPMAP_MAX_DISTANCE = 260
const CLIPMAP_LEVELS = 4

/**
 * Base normal offset, in metres, at the FINEST level; the node scales it by
 * each level's texel ratio. 14 mm ≈ 2.4 texels of the 5.9 mm finest texel —
 * enough to kill acne on the 27° sun's grazing incidence, small enough that
 * contact shadows still touch their objects.
 */
const SHADOW_NORMAL_BIAS = 0.014

export class SkySystem implements GameSystem {
  readonly id = 'sky'

  readonly sun = new DirectionalLight(sunColor, SUN_LIGHT_INTENSITY)
  private dome: Mesh | null = null
  private clipmaps: CachedShadowClipmapNode | null = null
  private fixtures: LightFixtureRig | null = null

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
    sun.shadow.normalBias = SHADOW_NORMAL_BIAS
    sun.position.copy(sunDirection).multiplyScalar(700)
    sun.target.position.set(0, 0, 0)
    scene.add(sun)
    scene.add(sun.target)

    // The quality tier ships three map sizes; the ladder wants four levels.
    // Extend with the coarsest size rather than adding a tier field — the
    // outermost level is the cheapest one to leave slightly soft.
    const tierSizes = quality.params.shadowMapSizes
    const levelMapSizes = Array.from(
      { length: CLIPMAP_LEVELS },
      (_, index) => tierSizes[Math.min(index, tierSizes.length - 1)],
    )

    this.clipmaps = new CachedShadowClipmapNode(sun, {
      camera: ctx.camera,
      levelMapSizes,
      firstRadius: CLIPMAP_FIRST_RADIUS,
      scaleFactor: CLIPMAP_SCALE_FACTOR,
      maxDistance: CLIPMAP_MAX_DISTANCE,
      // The frozen world never expires; robots/tram render into their own
      // small continuously-refreshed maps on the dynamic caster layer.
      dynamicLevels: 0,
      updateBudget: 1,
      maxCacheAge: 0,
      dynamicCasterLayer: DYNAMIC_SHADOW_LAYER,
      // Halved with the world: the tram car is the biggest moving caster and
      // it lives on a 97 m loop, so 90 m covers "everything moving that the
      // player can see move".
      dynamicCasterHalfWidths: [12, 90],
      dynamicCasterMapSizes: [tierSizes[0], tierSizes[0]],
    }).attach()

    // Fixed sky → bake the environment exactly once. The bake dome reuses
    // the same radiance material so IBL and the visible sky cannot disagree.
    const envScene = new Scene()
    envScene.add(new Mesh(new SphereGeometry(50, 32, 16), domeMaterial))
    const pmrem = new PMREMGenerator(renderer)
    const envTarget = pmrem.fromScene(envScene, 0.03, 1, 90)
    scene.environment = envTarget.texture
    scene.environmentIntensity = ENVIRONMENT_INTENSITY
    pmrem.dispose()

    // The artificial layer. Installed HERE, before any district initializes,
    // so every later system can call `lightFixtures().registerRealLight()`
    // inside its own init and get a truthful budget answer.
    this.fixtures = installLightFixtures(ctx)
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
    this.fixtures?.dispose(ctx.scene)
    this.fixtures = null
    ctx.scene.remove(this.sun)
    this.dome = null
  }
}
