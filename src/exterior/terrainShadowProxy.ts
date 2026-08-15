import { BufferAttribute, BufferGeometry, Mesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { markDistantTerrainShadowProxy } from '../render/layers'
import { exteriorHeight } from './terrainHeight'

/**
 * Fixed-map contract for the mountain ring. The caster stops well inside the
 * projection so long shadows can finish before the bounded map returns lit.
 */
export const DISTANT_TERRAIN_SHADOW_HALF_WIDTH = 10_500
export const DISTANT_TERRAIN_SHADOW_MAP_SIZE = 1_024
export const DISTANT_TERRAIN_SHADOW_LIGHT_MARGIN = 3_200
export const DISTANT_TERRAIN_SHADOW_NORMAL_BIAS = 5
export const DISTANT_TERRAIN_SHADOW_DEPTH_BIAS_WORLD = 0.5

const SHADOW_CASTER_INNER_RADIUS = 480
const SHADOW_CASTER_OUTER_RADIUS = 7_200
const SHADOW_CASTER_COLUMNS = 384

/**
 * Low-frequency copy of the exterior heightfield for the one frozen sun map.
 * It carries the same deterministic macro shape as the visible valley, but
 * only enough tessellation to cast broad mountain and ravine shadows at
 * kilometre viewing distances. It is never visible to the main camera.
 */
export function createDistantTerrainShadowProxy(): Mesh {
  const geometry = buildDistantTerrainShadowGeometry()
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

function buildDistantTerrainShadowGeometry(): BufferGeometry {
  const radii = buildShadowRadiusTable()
  const rows = radii.length
  const columns = SHADOW_CASTER_COLUMNS
  const vertexCount = rows * columns
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array((rows - 1) * columns * 6)
  const angleStep = (Math.PI * 2) / columns

  for (let row = 0; row < rows; row++) {
    const radius = radii[row]
    for (let column = 0; column < columns; column++) {
      const angle = column * angleStep
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const vertex = (row * columns + column) * 3
      positions[vertex] = x
      positions[vertex + 1] = exteriorHeight(x, z)
      positions[vertex + 2] = z
    }
  }

  let cursor = 0
  for (let row = 0; row < rows - 1; row++) {
    const current = row * columns
    const next = (row + 1) * columns
    for (let column = 0; column < columns; column++) {
      const nextColumn = column === columns - 1 ? 0 : column + 1
      const a = current + column
      const b = current + nextColumn
      const c = next + column
      const d = next + nextColumn
      indices[cursor++] = a
      indices[cursor++] = b
      indices[cursor++] = c
      indices[cursor++] = b
      indices[cursor++] = d
      indices[cursor++] = c
    }
  }

  const geometry = new BufferGeometry()
  geometry.name = 'Distant terrain shadow proxy'
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function buildShadowRadiusTable(): Float64Array {
  const radii: number[] = [SHADOW_CASTER_INNER_RADIUS]
  let radius = SHADOW_CASTER_INNER_RADIUS
  while (radius < SHADOW_CASTER_OUTER_RADIUS) {
    const spacing = radius < 4_500 ? 48 : 96
    radius = Math.min(SHADOW_CASTER_OUTER_RADIUS, radius + spacing)
    radii.push(radius)
  }
  return Float64Array.from(radii)
}
