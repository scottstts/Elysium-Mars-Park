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
  /** Enable every bundle while loading so each level records every GPU bundle. */
  showAllBundles(): void
  /** Conservatively select bundles intersecting one light-space clipmap square. */
  selectBundles(
    centerX: number,
    centerY: number,
    halfWidth: number,
    worldToLight: Matrix4,
  ): void
}

interface StaticShadowBundle {
  group: BundleGroup
  worldBounds: Sphere
  casterCount: number
  boundsBox: Box3
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
    const key = worldBounds.radius >= LARGE_CASTER_RADIUS
      ? `large:${mesh.id}`
      : [worldBounds.center.x, worldBounds.center.y, worldBounds.center.z]
          .map((value) => Math.floor(value / SHADOW_BUNDLE_CELL))
          .join(':')
    let record = bundlesByCell.get(key)
    if (!record) {
      const group = new BundleGroup()
      group.name = `static-sun-shadow-bundle:${key}`
      record = {
        group,
        worldBounds: new Sphere(),
        casterCount: 0,
        boundsBox: new Box3(),
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
      for (const bundle of bundles) bundle.group.visible = true
      visibleBundleCount = bundles.length
      visibleCasterCount = casterCount
    },
    selectBundles(centerX, centerY, halfWidth, worldToLight): void {
      let nextBundleCount = 0
      let nextCasterCount = 0
      for (const bundle of bundles) {
        LIGHT_BUNDLE_CENTER.copy(bundle.worldBounds.center).applyMatrix4(worldToLight)
        const reach = halfWidth + bundle.worldBounds.radius
        const visible =
          Math.abs(LIGHT_BUNDLE_CENTER.x - centerX) <= reach
          && Math.abs(LIGHT_BUNDLE_CENTER.y - centerY) <= reach
        bundle.group.visible = visible
        if (!visible) continue
        nextBundleCount++
        nextCasterCount += bundle.casterCount
      }
      visibleBundleCount = nextBundleCount
      visibleCasterCount = nextCasterCount
    },
  }
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
