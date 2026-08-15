import { Mesh } from 'three'
import type { BufferGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { markDistantTerrainShadowProxy } from '../render/layers'

/**
 * Frozen park-wide map for the immutable mountain ring. It covers the complete
 * 13.5 km terrain disc with a little light-space headroom, so there is no map
 * boundary crossing visible terrain at elevated viewpoints.
 */
export const DISTANT_TERRAIN_SHADOW_HALF_WIDTH = 14_500
export const DISTANT_TERRAIN_SHADOW_MAP_SIZE = 2_048
export const DISTANT_TERRAIN_SHADOW_LIGHT_MARGIN = 3_200
/**
 * The caster and receiver share geometry, so only a small numerical offset is
 * needed. The former 5 m normal offset separated the projected shadow from
 * steep ridge faces by roughly ten metres at the 27 degree sun angle, drawing
 * a bright inner fringe beside the dark shadow edge.
 */
export const DISTANT_TERRAIN_SHADOW_NORMAL_BIAS = 0.75
export const DISTANT_TERRAIN_SHADOW_DEPTH_BIAS_WORLD = 0.1

/**
 * Shadow-only twin of the visible valley. Sharing the exact BufferGeometry is
 * important: a decimated heightfield has a different skyline, so its frozen
 * shadow projects light/dark outlines around ridges when viewed from above.
 * The shared buffer adds no second geometry allocation and is submitted only
 * for the one loading-time terrain-shadow render.
 */
export function createDistantTerrainShadowProxy(geometry: BufferGeometry): Mesh {
  const material = new MeshBasicNodeMaterial()
  material.name = 'Distant terrain shadow-only material'
  const proxy = new Mesh(geometry, material)
  proxy.name = 'exterior:distant-terrain-shadow-proxy'
  proxy.castShadow = true
  proxy.receiveShadow = false
  proxy.frustumCulled = false
  markDistantTerrainShadowProxy(proxy)
  return proxy
}
