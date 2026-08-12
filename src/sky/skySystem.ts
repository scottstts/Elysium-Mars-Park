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
 *  1. The finest level must resolve a KERB and keep the complete 10.9 m
 *     Freedom Tower gallery inside its full-weight region. A 15 m half-width
 *     fades only after 15 · 0.88 · 0.84 = 11.09 m, so a guest at either rim
 *     cannot push the opposite edge into L1. Its static-only 2x map scale
 *     makes tier 2 an 8192 map (3.7 mm texels), 1.6x denser in world space
 *     than the old 12 m / 4096 level. Wide raking shadows therefore stop
 *     exposing the light-space texel staircase on this bare bright receiver.
 *  2. Levels must be a geometric ladder that ENDS at maxDistance, because the
 *     node clamps the last level to `maxDistance` regardless of the factor.
 *     15 · 2.59³ ≈ 260, so no level makes an outsized jump. The old set
 *     jumped 96 → 560 (5.8×), which forced level-2 normal bias to 0.75 m —
 *     a peter-panning generator at park scale.
 *  3. maxDistance only has to cover the dome: 260 m is the full diameter, and
 *     everything beyond the glass is either analytic (the lattice net) or too
 *     far for a shadow map to matter.
 */
const CLIPMAP_FIRST_RADIUS = 15
const CLIPMAP_SCALE_FACTOR = 2.59
const CLIPMAP_MAX_DISTANCE = 260
const CLIPMAP_LEVELS = 4

/**
 * Static L0 is rendered once and then cached, so spatial supersampling costs
 * memory but no recurring shadow draw. Its wider PCF footprint covers the
 * residual light-space raster stair on broad raking edges; coarse static and
 * continuously refreshed dynamic maps retain their proven one-texel radius.
 */
const STATIC_FINE_SHADOW_MAP_SCALE = 2
const STATIC_FINE_SHADOW_FILTER_RADIUS = 3.2

/**
 * Receiver offsets in metres at the finest level. The old -0.0003 depth bias
 * was normalized projection depth: across L0's ~379 m slab it became a
 * ~114 mm separation before normal bias was even applied. Keep both offsets
 * at the millimetre scale; the clipmap converts depth bias per camera range.
 */
const SHADOW_NORMAL_BIAS = 0.0015
const SHADOW_DEPTH_BIAS_WORLD = 0.0015

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
    sun.shadow.bias = 0
    sun.shadow.normalBias = SHADOW_NORMAL_BIAS
    sun.shadow.radius = 1
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
      (_, index) => index === 0
        ? Math.min(8_192, tierSizes[0] * STATIC_FINE_SHADOW_MAP_SCALE)
        : tierSizes[Math.min(index, tierSizes.length - 1)],
    )

    this.clipmaps = new CachedShadowClipmapNode(sun, {
      camera: ctx.camera,
      levelMapSizes,
      // Only the dense cached L0 gets the wider support needed to hide its
      // direction-dependent raster staircase. Coarse static and continuously
      // refreshed dynamic maps retain the source light's radius 1.
      levelFilterRadii: [STATIC_FINE_SHADOW_FILTER_RADIUS],
      depthBiasWorld: SHADOW_DEPTH_BIAS_WORLD,
      firstRadius: CLIPMAP_FIRST_RADIUS,
      scaleFactor: CLIPMAP_SCALE_FACTOR,
      maxDistance: CLIPMAP_MAX_DISTANCE,
      // Up-sun caster reach. A caster h metres above the level centre sits
      // h / sin(27°) up-sun of it, and the centre tracks the CAMERA — so with
      // the default 120 m margin the Freedom Tower's crown (≈ 50 m, tallest
      // thing under the shell) clipped through the shadow camera's near
      // plane whenever the camera stood low, and the tower's shadow ended in
      // a hard mid-lattice line (owner report). 50 / sin 27° ≈ 110 m, plus
      // the z-recentre quantum and headroom: 150.
      lightMargin: 150,
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
