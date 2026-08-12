import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { loadStarshipAsset } from './starshipModel'
import type { StarshipAsset } from './starshipModel'

/**
 * THE LAUNCH SITE — a full-scale Starship stacked on Super Heavy, its OLIT and
 * the orbital launch mount, standing on graded ground west of the arrival
 * tunnel. `starshipSite.ts` owns where; this owns when.
 *
 * IT CASTS AND RECEIVES, which nothing else beyond the glass does — the
 * valley mesh and its boulders are both cast=false/receive=false, because out
 * there a shadow map buys nothing and costs a whole terrain's worth of raster.
 * A 147 m backlit lattice is the exception: with the sun 49° off the sightline
 * from the park, the tower and the catch arms are read almost entirely by how
 * they shadow themselves, and the pad slab catching the vehicle's shadow is
 * most of what says the stack is standing on it rather than floating over it.
 * `sky/skySystem.ts` grew a fifth clipmap rung to reach out here; see the note
 * there for what that cost.
 *
 * NO COLLIDERS. The dome wall is the physical boundary (exteriorTerrain.ts) —
 * the player can look at this from the whole southern half of the park and can
 * never walk to it.
 *
 * NO UPDATE. The park's frozen afternoon extends to the spaceport: nothing
 * here moves, so the system has no per-frame cost at all once it has loaded.
 */
export class StarshipSystem implements GameSystem {
  readonly id = 'starship'

  private asset: StarshipAsset | null = null

  async init(ctx: GameContext): Promise<void> {
    const asset = await loadStarshipAsset()
    this.asset = asset

    for (const mesh of asset.meshes) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    // The stack is 147 m of mostly-empty lattice: culling it per part rather
    // than as one 68 x 62 x 147 m box means the ship can be on screen while
    // the pad slab under it is not, which is the common case from inside the
    // dome. Each part carries its own bounding sphere from the payload.
    ctx.scene.add(asset.group)

    if (ctx.flags.debug) {
      console.info(
        `[starship] ${asset.meshes.length} parts · ${(asset.triangles / 1000).toFixed(0)}k tris · `
          + `${asset.materials.length} materials · built in ${asset.buildMs.toFixed(0)} ms`,
      )
    }
  }

  dispose(ctx: GameContext): void {
    if (!this.asset) return
    ctx.scene.remove(this.asset.group)
    for (const mesh of this.asset.meshes) mesh.geometry.dispose()
    for (const material of this.asset.materials) material.dispose()
    this.asset = null
  }
}
