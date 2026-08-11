import type { Camera, Object3D } from 'three'

/**
 * Main-view dynamic detail. Kept as an explicit layer so any future auxiliary
 * render can opt out of bulk particles without changing object ownership.
 */
export const MAIN_DETAIL_LAYER = 1
/** Moving sun-shadow casters rendered by the lightweight dynamic maps
 * (robots, the tram) instead of the cached static clipmaps. */
export const DYNAMIC_SHADOW_LAYER = 2
/** Camera-facing particles (mist puffs). ONLY the main camera enables this
 * layer, so no shadow, clipmap or auxiliary pass can ever rasterize a
 * particle quad — a billboard in any depth/shadow path renders as its full
 * RECTANGLE and walks across the ground as a growing silhouette (owner
 * defect class, greenhouse spray). */
export const PARTICLE_LAYER = 3

export function enableMainDetailLayer(camera: Camera): void {
  camera.layers.enable(MAIN_DETAIL_LAYER)
  camera.layers.enable(DYNAMIC_SHADOW_LAYER)
  camera.layers.enable(PARTICLE_LAYER)
}

/** Confine a particle object to the main camera's render, out of every
 * shadow/aux pass. */
export function markParticle(object: Object3D): void {
  object.layers.set(PARTICLE_LAYER)
}

export function markMainDetail(object: Object3D): void {
  object.layers.set(MAIN_DETAIL_LAYER)
}

/**
 * Move already-authored shadow casters out of the cached static-world maps.
 * Layers are per-object rather than inherited, so only actual caster meshes
 * change; non-rendering transform parents stay untouched.
 */
export function markDynamicShadowCasters(object: Object3D): void {
  object.traverse((node) => {
    const caster = node as Object3D & { castShadow?: boolean }
    if (caster.castShadow === true) caster.layers.set(DYNAMIC_SHADOW_LAYER)
  })
}

/**
 * Move an entire moving subtree onto the dynamic layer, casters or not —
 * keeps a vehicle/robot together so static auxiliary passes can't freeze
 * only part of it. The main camera renders this layer, so visibility is
 * unchanged.
 */
export function markDynamic(object: Object3D): void {
  object.traverse((node) => {
    if ((node as Object3D & { isMesh?: boolean }).isMesh) {
      node.layers.set(DYNAMIC_SHADOW_LAYER)
    }
  })
}
