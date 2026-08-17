import {
  DepthTexture,
  GreaterEqualCompare,
  LessEqualCompare,
  Light,
  Matrix4,
  Object3D,
  RedFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three'
import type { DirectionalLight, DirectionalLightShadow, RenderTarget } from 'three'
import { NodeUpdateType, ShadowBaseNode, ShadowNode } from 'three/webgpu'
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu'
import {
  BasicShadowFilter,
  Fn,
  abs,
  float,
  max,
  min,
  reference,
  renderGroup,
  shadowPositionWorld,
  smoothstep,
  uniform,
  vec4,
} from 'three/tsl'
import { MAIN_DETAIL_LAYER, STATIC_SHADOW_PROXY_LAYER } from './layers'
import { latticeSunVisibility } from '../dome/latticeField'
import type { StaticShadowScene } from './staticShadowScene'

const ORIGIN = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)
const LIGHT_DIRECTION = new Vector3()
const LIGHT_ORIENTATION = new Matrix4()
const CAMERA_WORLD = new Vector3()
const CAMERA_LIGHT = new Vector3()
const LEVEL_CENTER = new Vector3()
const REGION_CENTER = new Vector3()

const DIRTY_DYNAMIC = 1 << 0
const DIRTY_INVALID = 1 << 1
const DIRTY_FORCED = 1 << 2
const DIRTY_MOVED = 1 << 3
const DIRTY_EXPIRED = 1 << 4
const DIRTY_DIRECTION = 1 << 5
const DIRTY_CONTENT = 1 << 6

/** How far ahead (in seconds of travel) recentering leads a moving camera. */
const LEAD_SECONDS = 1

/**
 * Extra down-sun slab depth so ground far below a high camera stays inside.
 * The level centre tracks the CAMERA in light space, so the ground below a
 * camera at height h sits h / sin(sun elevation) down-sun of it — at this
 * park's 27° sun that is 2.2 × h. A receiver past a level's far plane
 * returns fully lit while the level still claims the pixel (XY-only level
 * weighting), which reads as the shadow ENDING on a hard line perpendicular
 * to the sun (owner report: the Freedom Tower's shadow cut off from aerial
 * views — the gallery deck at 40 m made high cameras a public vantage).
 * 200 covers ~90 m of camera height with the finest level's own width on top.
 */
const DEPTH_REACH = 200

interface ClipmapLight extends Object3D {
  target: Object3D
  castShadow: true
  shadow: DirectionalLightShadow
}

interface LevelState {
  contentRevision: number
  halfWidth: number
  centerX: number
  centerY: number
  centerZ: number
  desiredX: number
  desiredY: number
  desiredZ: number
  texelWidth: number
  depthBias: number
  normalBias: number
  valid: boolean
  forceDirty: boolean
  age: number
  dirtyReasons: number
  renderCount: number
}

interface ShadowFilterArguments {
  filterFn: (args: {
    depthTexture: Node
    shadowCoord: Node<'vec4'>
    shadow: DirectionalLightShadow
    depthLayer: Node | null
  }) => Node<'float'>
  depthTexture: Node
  shadowCoord: Node<'vec4'>
  shadow: DirectionalLightShadow
  depthLayer: Node | null
}

interface InternalShadowNode extends ShadowNode {
  shadowMap?: RenderTarget
  updateShadow(frame: NodeFrame): void
}

interface DynamicCasterLevel {
  halfWidth: number
  mapSize: number
  active: boolean
  light: ClipmapLight
  shadowNode: BoundedShadowNode
  center: Vector3
  texelWidth: number
  depthBias: number
  normalBias: number
  renderCount: number
}

interface DistantTerrainLevel {
  halfWidth: number
  mapSize: number
  lightMargin: number
  depthBiasWorld: number
  normalBias: number
  light: ClipmapLight
  shadowNode: BoundedShadowNode
  texelWidth: number
  depthBias: number
  valid: boolean
  forceDirty: boolean
  renderCount: number
  lastCpuMs: number
}

export interface ShadowClipmapOptions {
  camera: Object3D
  levelMapSizes: readonly number[]
  /** Per-level PCF radii; omitted entries inherit the source light's radius. */
  levelFilterRadii?: readonly number[]
  /** Constant receiver depth offset in metres, converted per shadow camera. */
  depthBiasWorld?: number
  firstRadius?: number
  scaleFactor?: number
  maxDistance?: number
  lightMargin?: number
  shadowCameraNear?: number
  shadowCameraFar?: number
  guardBand?: number
  blendRatio?: number
  dynamicLevels?: number
  updateBudget?: number
  maxCacheAge?: number
  directionEpsilon?: number
  /** Maximum age of a dynamic near map before moving casters refresh it. */
  dynamicRefreshFrames?: number
  /** Object layer isolated into a cheap continuously refreshed shadow map. */
  dynamicCasterLayer?: number
  /** Finest-to-coarsest half-widths for the continuously refreshed hierarchy. */
  dynamicCasterHalfWidths?: readonly number[]
  /** Per-level map sizes paired with `dynamicCasterHalfWidths`. */
  dynamicCasterMapSizes?: readonly number[]
  /** Number of dynamic levels that begin active; later levels stay tiny/dormant. */
  dynamicCasterInitialActiveLevels?: number
  /** Dormant target edge length for inactive dynamic levels. */
  dynamicCasterDormantMapSize?: number
  /** Keep the legacy all-bundles-per-level loading warmup. */
  prewarmAllStaticBundles?: boolean
  /** Use a single-channel color attachment beside the required shadow depth. */
  compactShadowColorTarget?: boolean
  /** @deprecated Use `dynamicCasterHalfWidths`. */
  dynamicCasterHalfWidth?: number
  /** @deprecated Use `dynamicCasterMapSizes`. */
  dynamicCasterMapSize?: number
  /** Shadow-only layer containing the immutable mountain geometry twin. */
  distantTerrainCasterLayer?: number
  /** Fixed light-space half-width covering the mountain ring and its shadows. */
  distantTerrainShadowHalfWidth?: number
  /** One-shot map size for kilometre-scale terrain shadows. */
  distantTerrainShadowMapSize?: number
  /** Up-sun reach for the tallest mountain in the fixed map. */
  distantTerrainShadowLightMargin?: number
  /** World-space receiver normal offset for the exact terrain twin. */
  distantTerrainShadowNormalBias?: number
  /** World-space depth offset for the exact terrain twin. */
  distantTerrainShadowDepthBiasWorld?: number
}

export interface ShadowClipmapSnapshot {
  textureCount: number
  staticCasterBundle: null | {
    casterCount: number
    bundleCount: number
    visibleBundleCount: number
    visibleCasterCount: number
  }
  dynamicLevels: number
  dynamicRefreshFrames: number
  updateBudget: number
  budgetBefore: number
  budgetAfter: number
  directionDelta: number
  staticRefreshes: number
  lastStaticRefreshCpuMs: number
  maxStaticRefreshCpuMs: number
  depthBiasWorld: number | null
  distantTerrain: null | {
    layer: number
    renderedHalfWidth: number
    mapSize: number
    texelWidth: number
    depthBias: number
    normalBias: number
    valid: boolean
    renderCount: number
    lastCpuMs: number
  }
  dynamicCaster: null | {
    layer: number
    halfWidth: number
    mapSize: number
    texelWidth: number
    committed: [number, number, number]
    renderCount: number
    levels: Array<{
      index: number
      renderedHalfWidth: number
      sampledHalfWidth: number
      mapSize: number
      texelWidth: number
      depthBias: number
      normalBias: number
      filterRadius: number
      committed: [number, number, number]
      renderCount: number
      active: boolean
      allocatedMapSize: number
    }>
  }
  levels: Array<{
    index: number
    renderedHalfWidth: number
    sampledHalfWidth: number
    mapSize: number
    texelWidth: number
    desired: [number, number, number]
    committed: [number, number, number]
    dynamic: boolean
    valid: boolean
    forceDirty: boolean
    age: number
    dirtyReasons: number
    depthBias: number
    normalBias: number
    filterRadius: number
    renderCount: number
  }>
}

/** Always sample the comparison texture; select lit outside its XYZ projection. */
class BoundedShadowNode extends ShadowNode {
  private readonly compactColorTarget: boolean

  constructor(
    light: ClipmapLight,
    shadow: DirectionalLightShadow,
    compactColorTarget = false,
  ) {
    super(light as unknown as Light, shadow)
    this.compactColorTarget = compactColorTarget
  }

  setupRenderTarget(
    shadow: DirectionalLightShadow,
    builder: NodeBuilder,
  ): { shadowMap: RenderTarget; depthTexture: DepthTexture } {
    const transmittedShadows = (builder.renderer.shadowMap as { transmitted?: boolean }).transmitted
    if (!this.compactColorTarget || transmittedShadows === true) {
      // `setupRenderTarget` exists on ShadowNode at runtime in Three r185, but
      // it is intentionally omitted from the published ShadowNode type. Call
      // the original prototype method through a narrow runtime-only type so
      // the default (including the entire Mac path) remains exactly Three's
      // stock implementation without making TypeScript depend on an internal
      // declaration that is not present in the package types.
      const setupRenderTarget = (ShadowNode.prototype as unknown as {
        setupRenderTarget(
          this: ShadowNode,
          shadow: DirectionalLightShadow,
          builder: NodeBuilder,
        ): { shadowMap: RenderTarget; depthTexture: DepthTexture }
      }).setupRenderTarget
      return setupRenderTarget.call(this, shadow, builder)
    }

    // Three's generic shadow target carries an RGBA color attachment even
    // when transmitted/color shadows are disabled and only the comparison
    // depth texture is sampled. WebGPU RenderTarget currently requires at
    // least one color attachment, so use the smallest renderable one on the
    // Windows/D3D12 path instead of paying four channels per texel.
    const depthTexture = new DepthTexture(shadow.mapSize.width, shadow.mapSize.height)
    depthTexture.name = 'ShadowDepthTexture'
    depthTexture.compareFunction = builder.renderer.reversedDepthBuffer
      ? GreaterEqualCompare
      : LessEqualCompare
    const targetBuilder = builder as NodeBuilder & {
      createRenderTarget(
        width: number,
        height: number,
        options?: { format?: number; type?: number },
      ): RenderTarget
    }
    const shadowMap = targetBuilder.createRenderTarget(
      shadow.mapSize.width,
      shadow.mapSize.height,
      { format: RedFormat, type: UnsignedByteType },
    )
    shadowMap.texture.name = 'ShadowMapCompact'
    shadowMap.texture.type = shadow.mapType
    shadowMap.depthTexture = depthTexture
    return { shadowMap, depthTexture }
  }

  setupShadowFilter(_builder: NodeBuilder, args: ShadowFilterArguments): Node<'float'> {
    const { filterFn, depthTexture, shadowCoord, shadow, depthLayer } = args
    const inProjection = shadowCoord.x
      .greaterThanEqual(0)
      .and(shadowCoord.x.lessThanEqual(1))
      .and(shadowCoord.y.greaterThanEqual(0))
      .and(shadowCoord.y.lessThanEqual(1))
      .and(shadowCoord.z.greaterThanEqual(0))
      .and(shadowCoord.z.lessThanEqual(1))
    const shadowValue = filterFn({ depthTexture, shadowCoord, shadow, depthLayer })
    return inProjection.select(shadowValue, float(1))
  }
}

/**
 * Fixed-sun directional shadow clipmaps. Selection uses committed map state,
 * so a cached level can wait for its budget slot without its sample box
 * drifting away from the texture it actually contains.
 */
export class CachedShadowClipmapNode extends ShadowBaseNode {
  override readonly light: DirectionalLight
  readonly camera: Object3D
  readonly levels: number
  readonly maxDistance: number
  readonly lightMargin: number
  readonly shadowCameraNear: number
  readonly shadowCameraFar: number
  readonly guardBand: number
  readonly blendRatio: number
  readonly dynamicLevels: number
  readonly updateBudget: number
  readonly maxCacheAge: number
  readonly dynamicRefreshFrames: number
  readonly dynamicCasterLayer: number | null
  readonly dynamicCasterHalfWidths: readonly number[]
  readonly dynamicCasterMapSizes: readonly number[]
  readonly dynamicCasterInitialActiveLevels: number
  readonly dynamicCasterDormantMapSize: number
  readonly prewarmAllStaticBundles: boolean
  readonly compactShadowColorTarget: boolean
  /** Outermost level, retained for snapshot/API compatibility. */
  readonly dynamicCasterHalfWidth: number
  /** Outermost level, retained for snapshot/API compatibility. */
  readonly dynamicCasterMapSize: number
  readonly depthBiasWorld: number | null
  readonly distantTerrainCasterLayer: number | null
  readonly distantTerrainShadowHalfWidth: number
  readonly distantTerrainShadowMapSize: number
  readonly distantTerrainShadowLightMargin: number
  readonly distantTerrainShadowNormalBias: number
  readonly distantTerrainShadowDepthBiasWorld: number

  private readonly levelMapSizes: readonly number[]
  private readonly levelFilterRadii: readonly number[]
  private readonly halfWidths: number[] = []
  private readonly levelStates: LevelState[] = []
  private readonly levelData: Vector4[] = []
  private readonly shadowNodes: BoundedShadowNode[] = []
  private readonly lights: ClipmapLight[] = []
  private readonly worldToLight = new Matrix4()
  private readonly lastDirection = new Vector3()
  private readonly lastCameraLight = new Vector3(Number.NaN, Number.NaN, Number.NaN)
  private readonly velocityLight = new Vector3()
  private readonly dynamicLevelData: Vector4[] = []
  private readonly dynamicCasterLevels: DynamicCasterLevel[] = []
  private distantTerrainLevel: DistantTerrainLevel | null = null
  private readonly directionCos: number
  private dynamicRenderCount = 0
  private baseBias = 0
  private baseNormalBias = 0
  private firstUpdate = true
  private initialized = false
  private budgetBefore = 0
  private budgetAfter = 0
  private directionDelta = 0
  private staticCasterScene: StaticShadowScene | null = null
  private staticContentRevision = 0
  private staticRefreshes = 0
  private lastStaticRefreshCpuMs = 0
  private maxStaticRefreshCpuMs = 0

  constructor(light: DirectionalLight, options: ShadowClipmapOptions) {
    super(light)
    this.light = light
    this.camera = options.camera
    this.levelMapSizes = options.levelMapSizes
    this.levelFilterRadii = options.levelFilterRadii ?? []
    this.depthBiasWorld = options.depthBiasWorld === undefined
      ? null
      : Math.max(0, options.depthBiasWorld)
    this.levels = Math.max(1, this.levelMapSizes.length)
    const firstRadius = Math.max(1, options.firstRadius ?? 28)
    const scaleFactor = Math.max(1.5, options.scaleFactor ?? 3)
    this.maxDistance = Math.max(firstRadius, options.maxDistance ?? 650)
    for (let index = 0; index < this.levels; index++) {
      const width = Math.min(firstRadius * scaleFactor ** index, this.maxDistance)
      this.halfWidths.push(index === this.levels - 1 ? this.maxDistance : width)
    }
    this.lightMargin = options.lightMargin ?? 120
    this.shadowCameraNear = options.shadowCameraNear ?? 1
    this.shadowCameraFar = options.shadowCameraFar ?? 1_600
    this.guardBand = clamp(options.guardBand ?? 0.12, 0.02, 0.5)
    this.blendRatio = clamp(options.blendRatio ?? 0.16, 0.01, 0.9)
    this.dynamicLevels = Math.round(clamp(options.dynamicLevels ?? 1, 0, this.levels))
    this.updateBudget = Math.max(1, Math.round(options.updateBudget ?? 1))
    this.maxCacheAge = Math.max(0, Math.round(options.maxCacheAge ?? 180))
    this.dynamicRefreshFrames = Math.max(1, Math.round(options.dynamicRefreshFrames ?? 2))
    this.dynamicCasterLayer = options.dynamicCasterLayer ?? null
    const requestedHalfWidths = options.dynamicCasterHalfWidths
      ?? [options.dynamicCasterHalfWidth ?? firstRadius * 4]
    const requestedMapSizes = options.dynamicCasterMapSizes
      ?? [options.dynamicCasterMapSize ?? this.levelMapSizes[0]]
    const dynamicHalfWidths: number[] = []
    const dynamicMapSizes: number[] = []
    for (let index = 0; index < Math.max(1, requestedHalfWidths.length); index++) {
      const previous = dynamicHalfWidths[index - 1] ?? 0
      dynamicHalfWidths.push(Math.max(previous + 1e-3, requestedHalfWidths[index] ?? previous + 1))
      const requestedMapSize = requestedMapSizes[index]
        ?? requestedMapSizes[requestedMapSizes.length - 1]
        ?? this.levelMapSizes[0]
      dynamicMapSizes.push(Math.max(128, Math.round(requestedMapSize)))
    }
    this.dynamicCasterHalfWidths = dynamicHalfWidths
    this.dynamicCasterMapSizes = dynamicMapSizes
    this.dynamicCasterInitialActiveLevels = Math.round(clamp(
      options.dynamicCasterInitialActiveLevels ?? dynamicHalfWidths.length,
      0,
      dynamicHalfWidths.length,
    ))
    this.dynamicCasterDormantMapSize = Math.max(16, Math.round(
      options.dynamicCasterDormantMapSize ?? 64,
    ))
    this.prewarmAllStaticBundles = options.prewarmAllStaticBundles ?? true
    this.compactShadowColorTarget = options.compactShadowColorTarget ?? false
    this.dynamicCasterHalfWidth = dynamicHalfWidths[dynamicHalfWidths.length - 1]
    this.dynamicCasterMapSize = dynamicMapSizes[dynamicMapSizes.length - 1]
    this.distantTerrainCasterLayer = options.distantTerrainCasterLayer ?? null
    this.distantTerrainShadowHalfWidth = Math.max(
      1,
      options.distantTerrainShadowHalfWidth ?? this.maxDistance,
    )
    this.distantTerrainShadowMapSize = Math.max(
      128,
      Math.round(
        options.distantTerrainShadowMapSize
          ?? this.levelMapSizes[this.levelMapSizes.length - 1]
          ?? 1_024,
      ),
    )
    this.distantTerrainShadowLightMargin = Math.max(
      0,
      options.distantTerrainShadowLightMargin ?? this.lightMargin,
    )
    this.distantTerrainShadowNormalBias = Math.max(
      0,
      options.distantTerrainShadowNormalBias ?? this.light.shadow.normalBias,
    )
    this.distantTerrainShadowDepthBiasWorld = Math.max(
      0,
      options.distantTerrainShadowDepthBiasWorld ?? this.depthBiasWorld ?? 0,
    )
    this.directionCos = Math.cos(options.directionEpsilon ?? 0.002)
    // These world-space clipmaps are camera-independent once rendered, so
    // every render pass in one app frame must reuse the committed maps.
    this.updateBeforeType = NodeUpdateType.FRAME
  }

  attach(): this {
    ;(this.light.shadow as DirectionalLightShadow & { shadowNode?: Node }).shadowNode = this
    return this
  }

  /** Use a sealed, render-bundled proxy scene for immutable clipmap levels. */
  setStaticCasterScene(scene: StaticShadowScene): void {
    this.staticCasterScene = scene
    if (this.distantTerrainLevel) this.distantTerrainLevel.forceDirty = true
  }

  /**
   * Toggle a switchable subset of the frozen caster scene and schedule each
   * static clipmap to absorb the new contents at its normal refresh budget.
   */
  setStaticCasterGroupEnabled(groupId: string, enabled: boolean): boolean {
    if (!this.staticCasterScene?.setCasterGroupEnabled(groupId, enabled)) return false
    this.staticContentRevision++
    return true
  }

  /** True once every static map has rendered the latest caster-content revision. */
  isStaticCasterContentCurrent(): boolean {
    return this.levelStates.length === this.levels
      && this.levelStates.every((state) => state.contentRevision === this.staticContentRevision)
  }

  /** True once every static level contains a valid map at the current revision. */
  isStaticCacheSettled(): boolean {
    return this.levelStates.length === this.levels
      && this.levelStates.every((state) => (
        state.valid
        && !state.forceDirty
        && state.contentRevision === this.staticContentRevision
      ))
  }

  /** Activate/deactivate a dynamic hierarchy level without recompiling shaders. */
  setDynamicCasterLevelActive(index: number, active: boolean): void {
    const level = this.dynamicCasterLevels[index]
    if (!level || level.active === active) return
    level.active = active
    const size = active ? level.mapSize : this.dynamicCasterDormantMapSize
    level.light.shadow.mapSize.set(size, size)
    const shadowMap = (level.shadowNode as unknown as InternalShadowNode).shadowMap
    shadowMap?.setSize(size, size)
    level.center.set(Number.NaN, Number.NaN, Number.NaN)
    this.dynamicLevelData[index]?.set(1e9, 1e9, 1, active ? 1 : 0)
  }

  /** Zero-allocation live counters for per-frame hitch attribution. */
  get liveStaticRefreshCount(): number {
    return this.staticRefreshes
  }

  get liveDynamicRenderCount(): number {
    return this.dynamicRenderCount
  }

  staticPerformanceSnapshot(): {
    casterCount: number
    bundleCount: number
    visibleBundleCount: number
    visibleCasterCount: number
    refreshes: number
    lastCpuMs: number
    maxCpuMs: number
  } {
    return {
      casterCount: this.staticCasterScene?.casterCount ?? 0,
      bundleCount: this.staticCasterScene?.bundleCount ?? 0,
      visibleBundleCount: this.staticCasterScene?.visibleBundleCount ?? 0,
      visibleCasterCount: this.staticCasterScene?.visibleCasterCount ?? 0,
      refreshes: this.staticRefreshes,
      lastCpuMs: this.lastStaticRefreshCpuMs,
      maxCpuMs: this.maxStaticRefreshCpuMs,
    }
  }

  resetStaticPerformance(): void {
    this.staticRefreshes = 0
    this.lastStaticRefreshCpuMs = 0
    this.maxStaticRefreshCpuMs = 0
  }

  detach(): this {
    const shadow = this.light.shadow as DirectionalLightShadow & { shadowNode?: Node }
    if (shadow.shadowNode === this) delete shadow.shadowNode
    return this
  }

  override setup(builder: NodeBuilder): Node {
    if (!this.initialized) this.initLevels()
    const levelData = reference('levelData', 'vec4', this)
    levelData.setName('shadowClipmapLevels')
    const levelDataArray = levelData as unknown as { element(index: number): Node<'vec4'> }
    const dynamicLevelData = reference('dynamicLevelData', 'vec4', this)
    dynamicLevelData.setName('dynamicShadowClipmapLevels')
    const dynamicLevelDataArray = dynamicLevelData as unknown as {
      element(index: number): Node<'vec4'>
    }
    const worldToLight = uniform(this.worldToLight)
      .setGroup(renderGroup)
      .setName('shadowClipmapWorldToLight')

    return Fn(() => {
      this.setupShadowPosition(builder)
      const lightPosition = worldToLight
        .mul(vec4(shadowPositionWorld as Node<'vec3'>, 1))
        .xy.toVar()
      const accumulated = vec4(0).toVar()
      const remaining = float(1).toVar()
      for (let index = 0; index < this.levels; index++) {
        const level = vec4().toVar(`shadowClipmapLevel${index}`)
        level.assign(levelDataArray.element(index))
        const distance = max(
          abs(lightPosition.x.sub(level.x)),
          abs(lightPosition.y.sub(level.y)),
        )
        const fade = float(1).sub(
          smoothstep(level.z.mul(1 - this.blendRatio), level.z, distance),
        )
        const weight = fade.mul(remaining)
        const shadowSample = this.shadowNodes[index] as unknown as Node<'float'>
        accumulated.addAssign(shadowSample.mul(weight))
        remaining.mulAssign(float(1).sub(fade))
      }
      const clipmapShadow = accumulated.add(vec4(remaining))
      const staticShadow = this.distantTerrainLevel
        ? min(
            clipmapShadow,
            vec4(this.distantTerrainLevel.shadowNode as unknown as Node<'float'>),
          )
        : clipmapShadow
      if (this.dynamicCasterLevels.length > 0) {
        const dynamicAccumulated = vec4(0).toVar()
        const dynamicRemaining = float(1).toVar()
        for (let index = 0; index < this.dynamicCasterLevels.length; index++) {
          const level = vec4().toVar(`dynamicShadowClipmapLevel${index}`)
          level.assign(dynamicLevelDataArray.element(index))
          const distance = max(
            abs(lightPosition.x.sub(level.x)),
            abs(lightPosition.y.sub(level.y)),
          )
          // CPU state encodes the current outermost ACTIVE level with a
          // negative radius. That lets the 90 m level become the broad
          // fallback while Starship's 440 m level is dormant, then hand that
          // role to 440 m at ignition without changing/recompiling the graph.
          const radius = abs(level.z)
          const isOutermostActive = level.z.lessThan(0)
          const spatialFade = isOutermostActive.select(
            float(1),
            float(1).sub(
              smoothstep(radius.mul(1 - this.blendRatio), radius, distance),
            ),
          )
          const fade = spatialFade.mul(level.w)
          const weight = fade.mul(dynamicRemaining)
          const shadowSample = this.dynamicCasterLevels[index]
            .shadowNode as unknown as Node<'float'>
          dynamicAccumulated.addAssign(shadowSample.mul(weight))
          dynamicRemaining.mulAssign(float(1).sub(fade))
        }
        const dynamicShadow = dynamicAccumulated.add(vec4(dynamicRemaining))
        // One sun, two caster sets: the union is the darker visibility, not
        // multiplication (which would double-darken overlapping penumbrae).
        // Mars Park: the dome's analytic lattice net multiplies in HERE — at
        // the light itself — so every receiver gets it. (Per-material
        // receivedShadowNode is a trap in r185: AnalyticLightNode caches the
        // first-built receiver's wrap for all materials.)
        const lattice = latticeSunVisibility(shadowPositionWorld as Node<'vec3'>)
        return min(staticShadow, dynamicShadow).mul(lattice)
      }
      const lattice = latticeSunVisibility(shadowPositionWorld as Node<'vec3'>)
      return staticShadow.mul(lattice)
    })()
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    if (!this.light.parent) return undefined
    if (!this.initialized) this.initLevels()
    // NodeFrame is a singleton whose `scene` is reassigned by every nested
    // render. A static level refresh below renders the bundle proxy scene,
    // which leaves `frame.scene` pointing at it — and the dynamic caster
    // pass afterwards would then render that proxy scene (no layer-2
    // objects) instead of the live world: an empty moving-caster map for
    // exactly the recenter frame. That was the "moving shadows blink while
    // walking" defect. Pin the live scene before any level renders.
    const liveScene = frame.scene
    for (const levelLight of this.lights) {
      if (levelLight.parent) continue
      this.light.parent.add(levelLight.target)
      this.light.parent.add(levelLight)
    }
    for (const level of this.dynamicCasterLevels) {
      if (level.light.parent) continue
      this.light.parent.add(level.light.target)
      this.light.parent.add(level.light)
    }
    const distantTerrain = this.distantTerrainLevel
    if (distantTerrain && !distantTerrain.light.parent) {
      this.light.parent.add(distantTerrain.light.target)
      this.light.parent.add(distantTerrain.light)
    }

    LIGHT_DIRECTION.subVectors(this.light.target.position, this.light.position).normalize()
    LIGHT_ORIENTATION.lookAt(ORIGIN, LIGHT_DIRECTION, WORLD_UP)
    this.worldToLight.copy(LIGHT_ORIENTATION).invert()
    this.directionDelta = this.lastDirection.lengthSq() === 0
      ? Math.PI
      : Math.acos(clamp(LIGHT_DIRECTION.dot(this.lastDirection), -1, 1))
    const directionChanged = LIGHT_DIRECTION.dot(this.lastDirection) < this.directionCos
    if (directionChanged) this.lastDirection.copy(LIGHT_DIRECTION)
    CAMERA_WORLD.setFromMatrixPosition(this.camera.matrixWorld)
    CAMERA_LIGHT.copy(CAMERA_WORLD).applyMatrix4(this.worldToLight)

    // Camera velocity in light space (smoothed). Recentering leads a moving
    // camera by up to LEAD_SECONDS so the terrain a rider is approaching is
    // shadowed BEFORE they arrive — purely reactive recentering always put
    // the freshest gap exactly where a fast camera was looking.
    const deltaTime = Math.min(0.1, Math.max(1e-3, frame.deltaTime || 1 / 60))
    if (Number.isNaN(this.lastCameraLight.x) || directionChanged) {
      this.velocityLight.set(0, 0, 0)
    } else {
      const blend = Math.min(1, deltaTime * 5)
      this.velocityLight.x +=
        ((CAMERA_LIGHT.x - this.lastCameraLight.x) / deltaTime - this.velocityLight.x) * blend
      this.velocityLight.y +=
        ((CAMERA_LIGHT.y - this.lastCameraLight.y) / deltaTime - this.velocityLight.y) * blend
    }
    this.lastCameraLight.copy(CAMERA_LIGHT)
    const lightSpeed = Math.hypot(this.velocityLight.x, this.velocityLight.y)

    const initialUpdate = this.firstUpdate
    const warmingAllStaticBundles = initialUpdate && this.prewarmAllStaticBundles
    let budget = initialUpdate
      ? (this.prewarmAllStaticBundles ? this.levels : this.updateBudget)
      : directionChanged ? this.levels : this.updateBudget
    this.budgetBefore = budget
    this.firstUpdate = false
    let finestTexel = 0

    // ── Pass 1: state, lead-biased desired centers, dirty reasons ────────
    for (let index = 0; index < this.levels; index++) {
      const state = this.levelStates[index]
      const shadow = this.lights[index].shadow
      const camera = shadow.camera
      const texelWidth = (camera.right - camera.left) / shadow.mapSize.width
      if (index === 0) finestTexel = texelWidth
      const texelScale = finestTexel > 0 ? texelWidth / finestTexel : 1
      shadow.bias = this.shadowDepthBias(shadow)
      state.depthBias = shadow.bias
      shadow.normalBias = this.baseNormalBias * texelScale
      state.texelWidth = texelWidth
      state.normalBias = shadow.normalBias
      state.age++

      // Lead clamped to 0.3·halfWidth: the camera stays well inside the
      // sampled box (0.88·halfWidth) even fully ahead-biased.
      const lead =
        lightSpeed > 1e-3
          ? Math.min(LEAD_SECONDS, (state.halfWidth * 0.3) / lightSpeed)
          : 0
      const targetX = CAMERA_LIGHT.x + this.velocityLight.x * lead
      const targetY = CAMERA_LIGHT.y + this.velocityLight.y * lead
      state.desiredX = Math.round(targetX / texelWidth) * texelWidth
      state.desiredY = Math.round(targetY / texelWidth) * texelWidth
      const zQuantum = state.halfWidth * 0.5
      state.desiredZ = Math.round(CAMERA_LIGHT.z / zQuantum) * zQuantum
      const dynamic = index < this.dynamicLevels
      // Cached levels own a guard band precisely so their committed map can
      // remain valid while the camera moves. Refreshing on every one-texel
      // shift defeated that cache and caused broad full-world shadow spikes.
      // The near dynamic level still follows its texel grid immediately.
      const recenterDistance = state.halfWidth * this.guardBand * 0.5
      const moved = dynamic
        ? state.desiredX !== state.centerX
          || state.desiredY !== state.centerY
          || state.desiredZ !== state.centerZ
        : !state.valid
          || Math.abs(state.desiredX - state.centerX) >= recenterDistance
          || Math.abs(state.desiredY - state.centerY) >= recenterDistance
          || state.desiredZ !== state.centerZ
      const expired = this.maxCacheAge > 0 && state.age >= this.maxCacheAge
      let dirtyReasons = 0
      if (dynamic && state.age >= this.dynamicRefreshFrames) dirtyReasons |= DIRTY_DYNAMIC
      if (!state.valid) dirtyReasons |= DIRTY_INVALID
      if (state.forceDirty) dirtyReasons |= DIRTY_FORCED
      if (moved) dirtyReasons |= DIRTY_MOVED
      if (expired) dirtyReasons |= DIRTY_EXPIRED
      if (directionChanged) dirtyReasons |= DIRTY_DIRECTION
      if (state.contentRevision !== this.staticContentRevision) dirtyReasons |= DIRTY_CONTENT
      state.dirtyReasons = dirtyReasons
    }

    // ── Pass 2: render forced/dynamic levels always, then hand the budget
    // to the MOST-LAGGED dirty levels first. The old lowest-index-first
    // order let a fast camera keep the fine levels dirty every frame and
    // starve the mid levels — their eventual catch-up was the "shadow
    // appears one section at a time" pop during rides.
    const pending: { index: number; urgency: number }[] = []
    for (let index = 0; index < this.levels; index++) {
      const state = this.levelStates[index]
      if (state.dirtyReasons === 0) continue
      const dynamic = index < this.dynamicLevels
      if (dynamic || state.forceDirty) {
        this.renderLevel(index, frame, warmingAllStaticBundles)
        continue
      }
      const recenterDistance = Math.max(1e-6, state.halfWidth * this.guardBand * 0.5)
      const urgency = state.valid
        ? Math.max(
            Math.abs(state.desiredX - state.centerX),
            Math.abs(state.desiredY - state.centerY),
          ) / recenterDistance
          + (state.desiredZ !== state.centerZ ? 10 : 0)
        : Infinity
      pending.push({ index, urgency })
    }
    pending.sort((a, b) => b.urgency - a.urgency)
    for (const entry of pending) {
      if (budget <= 0) break
      budget--
      this.renderLevel(entry.index, frame, warmingAllStaticBundles)
    }

    for (let index = 0; index < this.levels; index++) {
      const state = this.levelStates[index]
      if (state.valid) {
        this.levelData[index].set(
          state.centerX,
          state.centerY,
          state.halfWidth * (1 - this.guardBand),
          0,
        )
      }
    }
    this.updateDistantTerrainShadow(frame, directionChanged)
    const dynamicFrame = Object.assign(Object.create(frame), { scene: liveScene }) as NodeFrame
    this.updateDynamicCasterShadow(dynamicFrame)
    this.budgetAfter = budget
    return undefined
  }

  /** Commit a level's desired center and render its shadow map. */
  private renderLevel(
    index: number,
    frame: NodeFrame,
    warmingAllStaticBundles = false,
  ): void {
    const state = this.levelStates[index]
    const levelLight = this.lights[index]
    const shadow = levelLight.shadow
    state.centerX = state.desiredX
    state.centerY = state.desiredY
    state.centerZ = state.desiredZ
    state.valid = true
    state.forceDirty = false
    state.age = 0
    state.renderCount++

    LEVEL_CENTER.set(
      state.centerX,
      state.centerY,
      state.centerZ + state.halfWidth + this.lightMargin,
    ).applyMatrix4(LIGHT_ORIENTATION)
    levelLight.position.copy(LEVEL_CENTER)
    levelLight.target.position.copy(LEVEL_CENTER).add(LIGHT_DIRECTION)
    levelLight.updateMatrixWorld(true)
    levelLight.target.updateMatrixWorld(true)
    shadow.needsUpdate = true
    const shadowNode = this.shadowNodes[index] as unknown as InternalShadowNode
    if (shadowNode.shadowMap) {
      const started = performance.now()
      if (this.staticCasterScene) {
        if (warmingAllStaticBundles) {
          // Record every spatial bundle for every level while the loading
          // screen is still up. Later visibility changes then only choose
          // already-recorded GPU bundles; they never trigger lazy recording.
          this.staticCasterScene.showAllBundles()
        } else {
          this.staticCasterScene.selectBundles(
            state.centerX,
            state.centerY,
            state.halfWidth,
            this.worldToLight,
          )
        }
        const staticFrame = Object.assign(Object.create(frame), {
          scene: this.staticCasterScene.scene,
        }) as NodeFrame
        shadowNode.updateShadow(staticFrame)
      } else {
        shadowNode.updateShadow(frame)
      }
      this.lastStaticRefreshCpuMs = performance.now() - started
      this.maxStaticRefreshCpuMs = Math.max(
        this.maxStaticRefreshCpuMs,
        this.lastStaticRefreshCpuMs,
      )
      state.contentRevision = this.staticContentRevision
      this.staticRefreshes++
      shadow.needsUpdate = false
    }
  }

  /** Force every level, or only levels overlapping a world-space sphere. */
  invalidate(worldBounds?: Sphere): void {
    if (!worldBounds) {
      for (const state of this.levelStates) state.forceDirty = true
      return
    }
    REGION_CENTER.copy(worldBounds.center).applyMatrix4(this.worldToLight)
    for (const state of this.levelStates) {
      const reach = state.halfWidth + worldBounds.radius
      if (
        Math.abs(REGION_CENTER.x - state.centerX) < reach
        && Math.abs(REGION_CENTER.y - state.centerY) < reach
      ) {
        state.forceDirty = true
      }
    }
  }

  /**
   * Invalidate every static level but let the normal update budget refill
   * them. Used by the Windows loading path to avoid one giant GPU submission.
   */
  invalidateIncremental(): void {
    for (const state of this.levelStates) {
      state.valid = false
      state.forceDirty = false
      state.dirtyReasons = DIRTY_INVALID
    }
  }


  debugSnapshot(): ShadowClipmapSnapshot {
    let outerDynamicIndex = -1
    for (let index = this.dynamicCasterLevels.length - 1; index >= 0; index--) {
      if (!this.dynamicCasterLevels[index].active) continue
      outerDynamicIndex = index
      break
    }
    const outerDynamicLevel = outerDynamicIndex >= 0
      ? this.dynamicCasterLevels[outerDynamicIndex]
      : undefined
    const distantTerrain = this.distantTerrainLevel
    return {
      textureCount: this.levels + this.dynamicCasterLevels.length + (distantTerrain ? 1 : 0),
      staticCasterBundle: this.staticCasterScene
        ? {
            casterCount: this.staticCasterScene.casterCount,
            bundleCount: this.staticCasterScene.bundleCount,
            visibleBundleCount: this.staticCasterScene.visibleBundleCount,
            visibleCasterCount: this.staticCasterScene.visibleCasterCount,
          }
        : null,
      dynamicLevels: this.dynamicLevels,
      dynamicRefreshFrames: this.dynamicRefreshFrames,
      updateBudget: this.updateBudget,
      budgetBefore: this.budgetBefore,
      budgetAfter: this.budgetAfter,
      directionDelta: this.directionDelta,
      staticRefreshes: this.staticRefreshes,
      lastStaticRefreshCpuMs: this.lastStaticRefreshCpuMs,
      maxStaticRefreshCpuMs: this.maxStaticRefreshCpuMs,
      depthBiasWorld: this.depthBiasWorld,
      distantTerrain: distantTerrain && this.distantTerrainCasterLayer !== null
        ? {
            layer: this.distantTerrainCasterLayer,
            renderedHalfWidth: distantTerrain.halfWidth,
            mapSize: distantTerrain.mapSize,
            texelWidth: distantTerrain.texelWidth,
            depthBias: distantTerrain.depthBias,
            normalBias: distantTerrain.normalBias,
            valid: distantTerrain.valid,
            renderCount: distantTerrain.renderCount,
            lastCpuMs: distantTerrain.lastCpuMs,
          }
        : null,
      dynamicCaster: this.dynamicCasterLayer === null
        ? null
        : {
            layer: this.dynamicCasterLayer,
            halfWidth: this.dynamicCasterHalfWidth,
            mapSize: this.dynamicCasterMapSize,
            texelWidth: outerDynamicLevel?.texelWidth ?? 0,
            committed: [
              outerDynamicLevel?.center.x ?? Number.NaN,
              outerDynamicLevel?.center.y ?? Number.NaN,
              outerDynamicLevel?.center.z ?? Number.NaN,
            ],
            renderCount: this.dynamicRenderCount,
            levels: this.dynamicCasterLevels.map((level, index) => ({
              index,
              renderedHalfWidth: level.halfWidth,
              sampledHalfWidth: !level.active
                ? 0
                : index === outerDynamicIndex
                  ? level.halfWidth
                  : level.halfWidth * (1 - this.guardBand),
              mapSize: level.mapSize,
              texelWidth: level.texelWidth,
              depthBias: level.depthBias,
              normalBias: level.normalBias,
              filterRadius: level.light.shadow.radius,
              committed: [level.center.x, level.center.y, level.center.z],
              renderCount: level.renderCount,
              active: level.active,
              allocatedMapSize: level.light.shadow.mapSize.width,
            })),
          },
      levels: this.levelStates.map((state, index) => ({
        index,
        renderedHalfWidth: state.halfWidth,
        sampledHalfWidth: state.halfWidth * (1 - this.guardBand),
        mapSize: this.levelMapSizes[index],
        texelWidth: state.texelWidth,
        desired: [state.desiredX, state.desiredY, state.desiredZ],
        committed: [state.centerX, state.centerY, state.centerZ],
        dynamic: index < this.dynamicLevels,
        valid: state.valid,
        forceDirty: state.forceDirty,
        age: state.age,
        dirtyReasons: state.dirtyReasons,
        depthBias: state.depthBias,
        normalBias: state.normalBias,
        filterRadius: this.lights[index].shadow.radius,
        renderCount: state.renderCount,
      })),
    }
  }

  override dispose(): void {
    this.detach()
    for (const shadowNode of this.shadowNodes) shadowNode.dispose()
    for (const levelLight of this.lights) {
      levelLight.shadow.dispose()
      levelLight.parent?.remove(levelLight)
      levelLight.target.parent?.remove(levelLight.target)
    }
    for (const level of this.dynamicCasterLevels) {
      level.shadowNode.dispose()
      level.light.shadow.dispose()
      level.light.parent?.remove(level.light)
      level.light.target.parent?.remove(level.light.target)
    }
    if (this.distantTerrainLevel) {
      this.distantTerrainLevel.shadowNode.dispose()
      this.distantTerrainLevel.light.shadow.dispose()
      this.distantTerrainLevel.light.parent?.remove(this.distantTerrainLevel.light)
      this.distantTerrainLevel.light.target.parent?.remove(this.distantTerrainLevel.light.target)
      this.distantTerrainLevel = null
    }
    this.dynamicCasterLevels.length = 0
    this.dynamicLevelData.length = 0
    this.staticCasterScene?.scene.clear()
    this.staticCasterScene = null
    super.dispose()
  }

  private initLevels(): void {
    if (this.initialized) return
    this.initialized = true
    this.baseBias = this.light.shadow.bias
    this.baseNormalBias = this.light.shadow.normalBias
    for (let index = 0; index < this.levels; index++) {
      const halfWidth = this.halfWidths[index]
      const target = new Object3D()
      const shadow = this.light.shadow.clone()
      shadow.mapSize.set(this.levelMapSizes[index], this.levelMapSizes[index])
      shadow.radius = this.levelFilterRadii[index] ?? this.light.shadow.radius
      shadow.camera.left = -halfWidth
      shadow.camera.right = halfWidth
      shadow.camera.top = halfWidth
      shadow.camera.bottom = -halfWidth
      shadow.camera.near = this.shadowCameraNear
      // Down-sun reach = halfWidth + DEPTH_REACH past the level center. The
      // center tracks the CAMERA's light-space depth, so a rider 40–60 m
      // above the seabed (Torrent plunge/helix) pushed the ground below
      // OUTSIDE the old margin+2·halfWidth slab of the finest level — and
      // because level blending weighs XY only, that level CLAIMED the region
      // and returned lit: whole chunks of ground shadow popped in and out as
      // the z-center requantized. DEPTH_REACH covers the park's full
      // camera-over-ground range (~80 m · sin 42° + z-quantum lag).
      shadow.camera.far = Math.max(
        this.shadowCameraNear + 1,
        Math.min(this.shadowCameraFar, this.lightMargin + halfWidth * 2 + DEPTH_REACH),
      )
      shadow.camera.updateProjectionMatrix()
      // A non-default mask prevents Three from replacing this with the main
      // camera mask during the shadow render. Static maps retain ordinary and
      // main-detail casters while excluding the dedicated moving-caster layer.
      if (this.dynamicCasterLayer !== null) shadow.camera.layers.enable(MAIN_DETAIL_LAYER)
      // Shadow-only stand-ins (render/layers.ts): geometry the main camera
      // never sees, so a LOD-switching object can hand the cached maps one
      // fixed silhouette instead of whatever detail level happened to be up
      // when the bundle was recorded.
      shadow.camera.layers.enable(STATIC_SHADOW_PROXY_LAYER)
      shadow.autoUpdate = false
      shadow.needsUpdate = false
      const levelLight = Object.assign(new Object3D(), {
        target,
        castShadow: true as const,
        shadow,
      }) as ClipmapLight
      this.lights.push(levelLight)
      this.shadowNodes.push(new BoundedShadowNode(
        levelLight,
        shadow,
        this.compactShadowColorTarget,
      ))
      this.levelData.push(new Vector4(1e9, 1e9, 1e-6, 0))
      this.levelStates.push({
        contentRevision: -1,
        halfWidth,
        centerX: Number.NaN,
        centerY: Number.NaN,
        centerZ: Number.NaN,
        desiredX: Number.NaN,
        desiredY: Number.NaN,
        desiredZ: Number.NaN,
        texelWidth: 0,
        depthBias: 0,
        normalBias: 0,
        valid: false,
        forceDirty: false,
        age: Math.floor(-(index * this.maxCacheAge) / this.levels),
        dirtyReasons: DIRTY_INVALID,
        renderCount: 0,
      })
    }
    this.initDynamicCasterShadow()
    this.initDistantTerrainShadow()
  }

  private initDynamicCasterShadow(): void {
    if (this.dynamicCasterLayer === null || this.dynamicCasterLevels.length > 0) return
    for (let index = 0; index < this.dynamicCasterHalfWidths.length; index++) {
      const target = new Object3D()
      const shadow = this.light.shadow.clone()
      const halfWidth = this.dynamicCasterHalfWidths[index]
      const mapSize = this.dynamicCasterMapSizes[index]
      const active = index < this.dynamicCasterInitialActiveLevels
      const allocatedMapSize = active ? mapSize : this.dynamicCasterDormantMapSize
      shadow.mapSize.set(allocatedMapSize, allocatedMapSize)
      shadow.camera.left = -halfWidth
      shadow.camera.right = halfWidth
      shadow.camera.top = halfWidth
      shadow.camera.bottom = -halfWidth
      shadow.camera.near = this.shadowCameraNear
      // Dynamic hierarchy weights are selected in light-space XY, so a level
      // that owns a receiver must also cover the park's camera-to-ground depth.
      // Match the static levels' allowance or the fine map returns fully lit
      // past its far plane and suppresses the valid broad-map fallback.
      shadow.camera.far = Math.max(
        this.shadowCameraNear + 1,
        Math.min(this.shadowCameraFar, this.lightMargin + halfWidth * 2 + DEPTH_REACH),
      )
      shadow.camera.layers.set(this.dynamicCasterLayer)
      shadow.camera.updateProjectionMatrix()
      shadow.autoUpdate = false
      shadow.needsUpdate = false
      const light = Object.assign(new Object3D(), {
        target,
        castShadow: true as const,
        shadow,
      }) as ClipmapLight
      this.dynamicCasterLevels.push({
        halfWidth,
        mapSize,
        active,
        light,
        shadowNode: new BoundedShadowNode(light, shadow, this.compactShadowColorTarget),
        center: new Vector3(Number.NaN, Number.NaN, Number.NaN),
        texelWidth: 0,
        depthBias: 0,
        normalBias: 0,
        renderCount: 0,
      })
      this.dynamicLevelData.push(new Vector4(1e9, 1e9, 1e-6, active ? 1 : 0))
    }
  }

  private updateDynamicCasterShadow(frame: NodeFrame): void {
    const staticFinestTexel = Math.max(1e-6, this.levelStates[0].texelWidth)
    let outermostActiveIndex = -1
    for (let index = this.dynamicCasterLevels.length - 1; index >= 0; index--) {
      if (!this.dynamicCasterLevels[index].active) continue
      outermostActiveIndex = index
      break
    }
    const fallbackLevel = outermostActiveIndex >= 0
      ? this.dynamicCasterLevels[outermostActiveIndex]
      : null
    const fallbackTexelWidth = fallbackLevel
      ? (fallbackLevel.halfWidth * 2) / fallbackLevel.mapSize
      : staticFinestTexel
    // Before the hierarchy existed, every moving receiver used the broad
    // fallback map's normal offset. Preserve that proven acne-free floor on
    // tighter inner levels; reducing it alongside texel width exposed the
    // submarine shroud's individual polygons as self-shadow bands.
    const fallbackNormalBias = this.baseNormalBias * (
      fallbackTexelWidth / staticFinestTexel
    )
    for (let index = 0; index < this.dynamicCasterLevels.length; index++) {
      const level = this.dynamicCasterLevels[index]
      if (!level.active) {
        level.texelWidth = 0
        this.dynamicLevelData[index].set(1e9, 1e9, 1, 0)
        continue
      }
      const { halfWidth, mapSize, light: levelLight } = level
      const shadowNode = level.shadowNode as unknown as InternalShadowNode
      const shadow = levelLight.shadow
      const texelWidth = (halfWidth * 2) / mapSize
      level.texelWidth = texelWidth
      level.center.set(
        Math.round(CAMERA_LIGHT.x / texelWidth) * texelWidth,
        Math.round(CAMERA_LIGHT.y / texelWidth) * texelWidth,
        Math.round(CAMERA_LIGHT.z / (halfWidth * 0.5)) * (halfWidth * 0.5),
      )
      this.dynamicLevelData[index].set(
        level.center.x,
        level.center.y,
        index === outermostActiveIndex
          ? -halfWidth
          : halfWidth * (1 - this.guardBand),
        1,
      )
      shadow.bias = this.shadowDepthBias(shadow)
      level.depthBias = shadow.bias
      // Coarser levels still scale by their own world texel. Inner levels do
      // not fall below the old broad-map receiver offset.
      shadow.normalBias = Math.max(
        fallbackNormalBias,
        this.baseNormalBias * (texelWidth / staticFinestTexel),
      )
      level.normalBias = shadow.normalBias
      LEVEL_CENTER.set(
        level.center.x,
        level.center.y,
        level.center.z + halfWidth + this.lightMargin,
      ).applyMatrix4(LIGHT_ORIENTATION)
      levelLight.position.copy(LEVEL_CENTER)
      levelLight.target.position.copy(LEVEL_CENTER).add(LIGHT_DIRECTION)
      levelLight.updateMatrixWorld(true)
      levelLight.target.updateMatrixWorld(true)
      shadow.needsUpdate = true
      if (shadowNode.shadowMap) {
        shadowNode.updateShadow(frame)
        shadow.needsUpdate = false
        level.renderCount++
        this.dynamicRenderCount++
      }
    }
  }

  private initDistantTerrainShadow(): void {
    if (this.distantTerrainCasterLayer === null || this.distantTerrainLevel) return
    const target = new Object3D()
    const shadow = this.light.shadow.clone()
    const halfWidth = this.distantTerrainShadowHalfWidth
    const mapSize = this.distantTerrainShadowMapSize
    shadow.mapSize.set(mapSize, mapSize)
    shadow.radius = 0
    shadow.camera.left = -halfWidth
    shadow.camera.right = halfWidth
    shadow.camera.top = halfWidth
    shadow.camera.bottom = -halfWidth
    shadow.camera.near = this.shadowCameraNear
    shadow.camera.far = Math.max(
      this.shadowCameraNear + 1,
      this.distantTerrainShadowLightMargin + halfWidth * 2 + DEPTH_REACH,
    )
    shadow.camera.layers.set(this.distantTerrainCasterLayer)
    shadow.camera.updateProjectionMatrix()
    // One hardware-filtered comparison is enough at kilometre scale. The
    // ordinary PCF path would spend five samples softening an edge whose
    // single texel already spans tens of metres on the ground.
    ;(shadow as DirectionalLightShadow & {
      filterNode?: typeof BasicShadowFilter
    }).filterNode = BasicShadowFilter
    shadow.autoUpdate = false
    shadow.needsUpdate = false
    const light = Object.assign(new Object3D(), {
      target,
      castShadow: true as const,
      shadow,
    }) as ClipmapLight
    const depthRange = Math.max(1e-6, shadow.camera.far - shadow.camera.near)
    this.distantTerrainLevel = {
      halfWidth,
      mapSize,
      lightMargin: this.distantTerrainShadowLightMargin,
      depthBiasWorld: this.distantTerrainShadowDepthBiasWorld,
      normalBias: this.distantTerrainShadowNormalBias,
      light,
      shadowNode: new BoundedShadowNode(light, shadow, this.compactShadowColorTarget),
      texelWidth: (halfWidth * 2) / mapSize,
      depthBias: -this.distantTerrainShadowDepthBiasWorld / depthRange,
      valid: false,
      forceDirty: true,
      renderCount: 0,
      lastCpuMs: 0,
    }
  }

  /** Render the fixed-sun mountain map once, or again after explicit invalidation. */
  private updateDistantTerrainShadow(frame: NodeFrame, directionChanged: boolean): void {
    const level = this.distantTerrainLevel
    if (!level || (level.valid && !level.forceDirty && !directionChanged)) return
    const { light: levelLight, shadowNode } = level
    const shadow = levelLight.shadow
    LEVEL_CENTER.set(0, 0, level.halfWidth + level.lightMargin).applyMatrix4(LIGHT_ORIENTATION)
    levelLight.position.copy(LEVEL_CENTER)
    levelLight.target.position.copy(LEVEL_CENTER).add(LIGHT_DIRECTION)
    levelLight.updateMatrixWorld(true)
    levelLight.target.updateMatrixWorld(true)
    shadow.bias = level.depthBias
    shadow.normalBias = level.normalBias
    shadow.needsUpdate = true
    const internalNode = shadowNode as unknown as InternalShadowNode
    if (!internalNode.shadowMap) return

    const started = performance.now()
    if (this.staticCasterScene) {
      this.staticCasterScene.selectBundles(0, 0, level.halfWidth, this.worldToLight)
      const staticFrame = Object.assign(Object.create(frame), {
        scene: this.staticCasterScene.scene,
      }) as NodeFrame
      internalNode.updateShadow(staticFrame)
    } else {
      internalNode.updateShadow(frame)
    }
    level.lastCpuMs = performance.now() - started
    level.valid = true
    level.forceDirty = false
    level.renderCount++
    shadow.needsUpdate = false
  }

  /**
   * Three's scalar shadow bias is normalized projection depth. Reusing one
   * value across clipmaps therefore turns the same setting into a different
   * world-space gap at every camera range. Convert the authored metre offset
   * per orthographic slab so contact attachment is scale invariant.
   */
  private shadowDepthBias(shadow: DirectionalLightShadow): number {
    if (this.depthBiasWorld === null) return this.baseBias
    const depthRange = Math.max(1e-6, shadow.camera.far - shadow.camera.near)
    return -this.depthBiasWorld / depthRange
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
