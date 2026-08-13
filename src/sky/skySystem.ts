import { BackSide, DirectionalLight, Mesh, Scene, SphereGeometry } from 'three'
import { MeshBasicNodeMaterial, PMREMGenerator } from 'three/webgpu'
import { float, normalize, positionLocal } from 'three/tsl'
import {
  CachedShadowClipmapNode,
  type ShadowClipmapSnapshot,
} from '../render/cachedShadowClipmaps'
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
 *  3. maxDistance used to only have to cover the dome — 260 m is its full
 *     diameter, and everything beyond the glass was either analytic (the
 *     lattice net) or too far for a shadow map to matter. THE LAUNCH SITE
 *     BROKE THAT. It stands 215 m outside, is 147 m tall, and is backlit, so
 *     it is read almost entirely by its own self-shadowing; from the far (NE)
 *     rim of the park its light-space distance reaches ~270 m, past the old
 *     outermost level, and the whole stack would have flipped to flat-lit as
 *     the player walked north.
 *
 *     A FIFTH RUNG rather than a wider fourth. 15 · 2.59³ ≈ 260.6 keeps every
 *     existing level's half-width EXACTLY where it was tuned; the new level
 *     alone stretches out. Simply raising maxDistance on four levels would
 *     have grown L3's texel ~46 % for one object's benefit. The cost is one
 *     more cached map at the coarsest tier size and one more sample per lit
 *     pixel — the maps are static and re-render only on recentre.
 *
 *     THE NUMBER IS NOT `maxDistance`. A level stops contributing at
 *     `halfWidth · (1 − guardBand)` and starts FADING a further `blendRatio`
 *     before that, so the usable reach is `maxDistance · 0.88 · 0.84`, not
 *     `maxDistance`. Worst light-space distance from the park floor to the
 *     stack is 298 m (measured, tools/starship-site-audit.mjs), so 380 would
 *     have left the far rim inside the fade band at ~76 % weight. 440 puts
 *     the fade edge at 325 m with real margin, and only costs texel width on
 *     the outermost rung — which nothing but the spaceport uses.
 */
const CLIPMAP_FIRST_RADIUS = 15
const CLIPMAP_SCALE_FACTOR = 2.59
const CLIPMAP_MAX_DISTANCE = 440
const CLIPMAP_LEVELS = 5

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
      // the z-recentre quantum and headroom: was 150.
      //
      // The OLIT crown stands 146 m: 146 / sin 27° ≈ 322 m by the same rule,
      // and clipping it would cut the tower's shadow off two thirds of the way
      // up — the exact defect above, on the tallest object in the world. 360
      // keeps the same ~12 % headroom. This only widens each shadow camera's
      // depth slab; `shadowDepthBias` divides by that slab, so the WORLD-space
      // receiver offset is unchanged and nothing else has to be retuned.
      lightMargin: 360,
      // The frozen world never expires; robots/tram render into their own
      // small continuously-refreshed maps on the dynamic caster layer.
      dynamicLevels: 0,
      updateBudget: 1,
      maxCacheAge: 0,
      dynamicCasterLayer: DYNAMIC_SHADOW_LAYER,
      // Halved with the world: the tram car is the biggest moving caster and
      // it lives on a 97 m loop, so 90 m covers "everything moving that the
      // player can see move".
      //
      // A THIRD RUNG AT 440 m EXISTS ONLY FOR THE STARSHIP. Once the vehicle
      // flies it cannot be in the cached static bundle — that bundle is sealed
      // during the loading frame and immutable after, so a moving mesh would
      // leave its shadow welded to the pad forever. Moving it to this layer
      // fixes that and creates a second problem: the pad is 93–340 m from the
      // camera and the stack's LIGHT-space reach at 27° is ~298 m (measured,
      // tools/starship-site-audit.mjs), all far outside 90 m. Without this rung
      // the tower would go on printing its 287 m shadow across the regolith
      // while the 147 m rocket standing beside it printed nothing.
      //
      // 440 m is the static L4's number, chosen there against the same measured
      // 298 m worst case. The cost is one more continuously refreshed map: the
      // stack's 353 k triangles while it is low (frustum culling drops it once
      // it climbs out of the box), plus the robots and the tram, which were
      // already paying for two. Texel is 0.43 m at tier 0 — soft, but a soft
      // 147 m streak on regolith reads as penumbra, and the alternative is no
      // streak at all.
      dynamicCasterHalfWidths: [12, 90, 440],
      dynamicCasterMapSizes: [tierSizes[0], tierSizes[0], tierSizes[0]],
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
    this.clipmaps.setStaticCasterScene(staticShadows)
  }

  /** Force every clipmap level to re-render on the next frame (warmup). */
  invalidateShadowLevels(): void {
    this.clipmaps?.invalidate()
  }

  /** Read-only state for the opt-in arrival profiler and visual validation. */
  debugShadowSnapshot(): ShadowClipmapSnapshot | null {
    return this.clipmaps?.debugSnapshot() ?? null
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
