import { Scene } from 'three'
import type { Mesh, Object3D } from 'three'
import { BundleGroup } from 'three/webgpu'
import { DYNAMIC_SHADOW_LAYER } from './layers'

export interface StaticShadowScene {
  scene: Scene
  casterCount: number
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
 * Frustum culling is deliberately disabled on the proxies: a render bundle's
 * draw list is immutable, whereas each clipmap camera later moves. The GPU
 * clips the same triangles against the live shadow camera, preserving output.
 */
export function createStaticShadowScene(source: Scene): StaticShadowScene {
  source.updateMatrixWorld(true)
  const scene = new Scene()
  scene.name = 'static-sun-shadow-scene'
  const bundle = new BundleGroup()
  bundle.name = 'static-sun-shadow-bundle'
  let casterCount = 0

  source.traverse((object: Object3D) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.castShadow !== true) return
    if ((mesh.layers.mask & (1 << DYNAMIC_SHADOW_LAYER)) !== 0) return

    const proxy = mesh.clone(false)
    proxy.name = `static-shadow:${mesh.name || mesh.id}`
    proxy.matrixAutoUpdate = false
    proxy.matrix.copy(mesh.matrixWorld)
    proxy.matrixWorld.copy(mesh.matrixWorld)
    proxy.frustumCulled = false
    bundle.add(proxy)
    casterCount++
  })

  scene.add(bundle)
  scene.updateMatrixWorld(true)
  return { scene, casterCount }
}
