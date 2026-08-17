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
/**
 * Geometry that exists ONLY to cast the cached sun shadow: never rendered by
 * the main camera, always rendered by the static clipmap cameras.
 *
 * This is what lets an object LOD-switch in the main view while its shadow
 * stays fixed. A cached clipmap records its casters into an immutable render
 * bundle once; an object whose draw changes afterwards (an InstancedMesh
 * whose `count` moves, a mesh that turns invisible) either freezes at
 * whatever it looked like at seal time or drops out of the shadow entirely.
 * A separate, never-switched proxy at a mid LOD sidesteps both: the shadow is
 * stable and cheap, and the main view is free to swap detail underneath it.
 */
export const STATIC_SHADOW_PROXY_LAYER = 4
/** Exact shadow-only twin of the exterior heightfield, used only by the
 * frozen park-wide mountain map. Keeping it separate prevents the
 * kilometre-scale caster from entering the camera-centred clipmaps or the
 * main view. */
export const DISTANT_TERRAIN_SHADOW_LAYER = 5

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

/** Confine an object to the cached sun-shadow pass — see the layer's note. */
export function markStaticShadowProxy(object: Object3D): void {
  object.traverse((node) => {
    node.layers.set(STATIC_SHADOW_PROXY_LAYER)
  })
}

/** Confine a mountain shadow twin to the one-shot distant terrain map. */
export function markDistantTerrainShadowProxy(object: Object3D): void {
  object.traverse((node) => {
    node.layers.set(DISTANT_TERRAIN_SHADOW_LAYER)
  })
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
 * Return moving shadow casters to the ordinary layer after a cached-static
 * handback has completed. The main camera includes layer 0, so rendering is
 * unchanged; only the moving-caster auxiliary maps stop seeing the object.
 */
export function restoreDefaultShadowCasters(object: Object3D): void {
  object.traverse((node) => {
    const caster = node as Object3D & { castShadow?: boolean }
    if (caster.castShadow === true) caster.layers.set(0)
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
