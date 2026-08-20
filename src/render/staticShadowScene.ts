import { Box3, Scene, Sphere, Vector3 } from 'three'
import type { Matrix4, Mesh, Object3D } from 'three'
import { BundleGroup } from 'three/webgpu'
import { DYNAMIC_SHADOW_LAYER } from './layers'

export interface StaticShadowScene {
  scene: Scene
  casterCount: number
  bundleCount: number
  readonly visibleBundleCount: number
  readonly visibleCasterCount: number
  /** Enable every currently-active bundle while loading. */
  showAllBundles(): void
  /** Toggle a named switchable caster set without rebuilding proxy geometry. */
  setCasterGroupEnabled(groupId: string, enabled: boolean): boolean
  /** Conservatively select bundles intersecting one light-space clipmap square. */
  selectBundles(
    centerX: number,
    centerY: number,
    halfWidth: number,
    worldToLight: Matrix4,
  ): void
  /**
   * Select at most `limit` relevant bundle/clipmap pairs that have never been
   * recorded for this level. The caller records this batch without replacing
   * the currently published shadow map, then marks it complete below.
   */
  selectBundleWarmupBatch(
    levelIndex: number,
    centerX: number,
    centerY: number,
    halfWidth: number,
    worldToLight: Matrix4,
    limit: number,
  ): { selected: number; remaining: number }
  /** Mark the currently visible bundle groups as recorded for one clipmap camera. */
  markVisibleBundlesRecorded(levelIndex: number): void
}

interface StaticShadowBundle {
  group: BundleGroup
  worldBounds: Sphere
  casterCount: number
  boundsBox: Box3
  casterGroupId: string | null
  enabled: boolean
  /** Allocated only by the Windows lazy-recording path. */
  recordedLevels?: Set<number>
}

/**
 * Small enough to reject whole districts from the 15/39 m clipmaps, but
 * large enough that a level submits tens of bundles rather than hundreds.
 */
const SHADOW_BUNDLE_CELL = 32
const LARGE_CASTER_RADIUS = SHADOW_BUNDLE_CELL * 0.75
const BOUNDS_MIN = new Vector3()
const BOUNDS_MAX = new Vector3()
const LIGHT_BUNDLE_CENTER = new Vector3()
const STATIC_SHADOW_CASTER_GROUP = '__staticShadowCasterGroup'

/**
 * Mark a caster subtree as a switchable member of the frozen shadow world.
 * The proxy scene gives that subtree dedicated BundleGroups so it can be
 * removed/reintroduced without rebuilding unrelated district bundles.
 */
export function markSwitchableStaticShadowCasters(object: Object3D, groupId: string): void {
  object.traverse((node) => {
    const caster = node as Object3D & { castShadow?: boolean }
    if (caster.castShadow === true) caster.userData[STATIC_SHADOW_CASTER_GROUP] = groupId
  })
}

/**
 * Freeze immutable sun-shadow casters into a shadow-only WebGPU render bundle.
 *
 * Cached clipmap refreshes used to traverse and encode the entire live scene
 * synchronously whenever the walking camera crossed a recenter threshold.
 * That work scales with every decorative transform even though the sun and
 * static casters never change. A flat proxy scene keeps the exact geometry,
 * materials, world transforms, and map resolutions, while its render bundle
 * records the shadow commands once during the loading-screen frame.
 *
 * A single park-wide bundle still submits every caster on every fine-level
 * recenter. The arrival camera crosses hundreds of texel-stabilized centres;
 * once it reaches the dense portal district that unnecessary vertex work is a
 * visible hitch. Casters are therefore recorded into fixed spatial bundles.
 * Proxies remain non-frustum-culled INSIDE each immutable bundle, while whole
 * bundles are conservatively selected against the committed light-space
 * square before a refresh. A bundle is rejected only when its world bounding
 * sphere cannot intersect the square, so map contents are unchanged.
 */
export function createStaticShadowScene(source: Scene): StaticShadowScene {
  source.updateMatrixWorld(true)
  const scene = new Scene()
  scene.name = 'static-sun-shadow-scene'
  const bundlesByCell = new Map<string, StaticShadowBundle>()
  let casterCount = 0

  source.traverse((object: Object3D) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.castShadow !== true) return
    if ((mesh.layers.mask & (1 << DYNAMIC_SHADOW_LAYER)) !== 0) return

    const worldBounds = casterWorldBounds(mesh)
    const casterGroupId = typeof mesh.userData[STATIC_SHADOW_CASTER_GROUP] === 'string'
      ? mesh.userData[STATIC_SHADOW_CASTER_GROUP] as string
      : null
    const spatialKey = worldBounds.radius >= LARGE_CASTER_RADIUS
      ? `large:${mesh.id}`
      : [worldBounds.center.x, worldBounds.center.y, worldBounds.center.z]
          .map((value) => Math.floor(value / SHADOW_BUNDLE_CELL))
          .join(':')
    // Switchable casters may never share a render bundle with permanent
    // casters: BundleGroup recordings are immutable until invalidated, so a
    // visibility handoff (Starship parked -> flying) must be able to exclude
    // the whole recorded command bundle without touching the tower beside it.
    const key = casterGroupId ? `switch:${casterGroupId}:${spatialKey}` : spatialKey
    let record = bundlesByCell.get(key)
    if (!record) {
      const group = new BundleGroup()
      group.name = `static-sun-shadow-bundle:${key}`
      record = {
        group,
        worldBounds: new Sphere(),
        casterCount: 0,
        boundsBox: new Box3(),
        casterGroupId,
        enabled: true,
      }
      bundlesByCell.set(key, record)
      scene.add(group)
    }

    const proxy = mesh.clone(false)
    proxy.name = `static-shadow:${mesh.name || mesh.id}`
    proxy.matrixAutoUpdate = false
    proxy.matrix.copy(mesh.matrixWorld)
    proxy.matrixWorld.copy(mesh.matrixWorld)
    proxy.frustumCulled = false
    record.group.add(proxy)
    record.casterCount++
    BOUNDS_MIN.copy(worldBounds.center).addScalar(-worldBounds.radius)
    BOUNDS_MAX.copy(worldBounds.center).addScalar(worldBounds.radius)
    record.boundsBox.expandByPoint(BOUNDS_MIN)
    record.boundsBox.expandByPoint(BOUNDS_MAX)
    casterCount++
  })

  const bundles = Array.from(bundlesByCell.values())
  for (const bundle of bundles) {
    bundle.boundsBox.getBoundingSphere(bundle.worldBounds)
  }
  scene.updateMatrixWorld(true)
  let visibleBundleCount = bundles.length
  let visibleCasterCount = casterCount

  return {
    scene,
    casterCount,
    bundleCount: bundles.length,
    get visibleBundleCount(): number {
      return visibleBundleCount
    },
    get visibleCasterCount(): number {
      return visibleCasterCount
    },
    showAllBundles(): void {
      let nextBundleCount = 0
      let nextCasterCount = 0
      for (const bundle of bundles) {
        bundle.group.visible = bundle.enabled
        if (!bundle.enabled) continue
        nextBundleCount++
        nextCasterCount += bundle.casterCount
      }
      visibleBundleCount = nextBundleCount
      visibleCasterCount = nextCasterCount
    },
    setCasterGroupEnabled(groupId, enabled): boolean {
      let changed = false
      for (const bundle of bundles) {
        if (bundle.casterGroupId !== groupId || bundle.enabled === enabled) continue
        bundle.enabled = enabled
        // Disabling is immediate. Enabling waits for the next spatial
        // selection so an out-of-range bundle is not submitted accidentally.
        if (!enabled) bundle.group.visible = false
        changed = true
      }
      return changed
    },
    selectBundles(centerX, centerY, halfWidth, worldToLight): void {
      let nextBundleCount = 0
      let nextCasterCount = 0
      for (const bundle of bundles) {
        LIGHT_BUNDLE_CENTER.copy(bundle.worldBounds.center).applyMatrix4(worldToLight)
        const reach = halfWidth + bundle.worldBounds.radius
        const visible = bundle.enabled
          && Math.abs(LIGHT_BUNDLE_CENTER.x - centerX) <= reach
          && Math.abs(LIGHT_BUNDLE_CENTER.y - centerY) <= reach
        bundle.group.visible = visible
        if (!visible) continue
        nextBundleCount++
        nextCasterCount += bundle.casterCount
      }
      visibleBundleCount = nextBundleCount
      visibleCasterCount = nextCasterCount
    },
    selectBundleWarmupBatch(
      levelIndex,
      centerX,
      centerY,
      halfWidth,
      worldToLight,
      limit,
    ): { selected: number; remaining: number } {
      const missing: StaticShadowBundle[] = []
      for (const bundle of bundles) {
        if (
          bundle.enabled
          && !bundle.recordedLevels?.has(levelIndex)
          && bundleIntersects(bundle, centerX, centerY, halfWidth, worldToLight)
        ) {
          missing.push(bundle)
        }
        bundle.group.visible = false
      }

      const selected = Math.min(Math.max(0, Math.floor(limit)), missing.length)
      let selectedCasters = 0
      for (let index = 0; index < selected; index++) {
        const bundle = missing[index]
        bundle.group.visible = true
        selectedCasters += bundle.casterCount
      }
      visibleBundleCount = selected
      visibleCasterCount = selectedCasters
      return { selected, remaining: missing.length - selected }
    },
    markVisibleBundlesRecorded(levelIndex): void {
      for (const bundle of bundles) {
        if (!bundle.enabled || !bundle.group.visible) continue
        bundle.recordedLevels ??= new Set<number>()
        bundle.recordedLevels.add(levelIndex)
      }
    },
  }
}

function bundleIntersects(
  bundle: StaticShadowBundle,
  centerX: number,
  centerY: number,
  halfWidth: number,
  worldToLight: Matrix4,
): boolean {
  LIGHT_BUNDLE_CENTER.copy(bundle.worldBounds.center).applyMatrix4(worldToLight)
  const reach = halfWidth + bundle.worldBounds.radius
  return Math.abs(LIGHT_BUNDLE_CENTER.x - centerX) <= reach
    && Math.abs(LIGHT_BUNDLE_CENTER.y - centerY) <= reach
}

/** World-space conservative sphere, including instance transforms. */
function casterWorldBounds(mesh: Mesh): Sphere {
  const bounded = mesh as Mesh & {
    boundingSphere?: Sphere | null
    computeBoundingSphere?: () => void
  }
  if (bounded.boundingSphere === null && bounded.computeBoundingSphere) {
    bounded.computeBoundingSphere()
  }
  const localBounds = bounded.boundingSphere ?? mesh.geometry.boundingSphere
  if (!localBounds) mesh.geometry.computeBoundingSphere()
  const resolved = bounded.boundingSphere ?? mesh.geometry.boundingSphere
  if (!resolved || !Number.isFinite(resolved.radius)) {
    throw new Error(`Static shadow caster has invalid bounds: ${mesh.name || mesh.id}`)
  }
  return resolved.clone().applyMatrix4(mesh.matrixWorld)
}
