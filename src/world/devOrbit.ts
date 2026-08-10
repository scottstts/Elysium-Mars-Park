import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getBookmark } from '../core/debug'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'

/**
 * Development orbit camera used for ?view= validation bookmarks and for
 * pre-player inspection. Never active alongside the player controller.
 */
export class DevOrbitSystem implements GameSystem {
  readonly id = 'devOrbit'
  private controls: OrbitControls | null = null

  init(ctx: GameContext): void {
    const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxDistance = 2400
    const bookmark = getBookmark(ctx.flags.view ?? 'overview')
    if (bookmark) {
      ctx.camera.position.set(...bookmark.position)
      controls.target.set(...bookmark.look)
    }
    controls.update()
    this.controls = controls
  }

  update(): void {
    this.controls?.update()
  }

  dispose(): void {
    this.controls?.dispose()
    this.controls = null
  }
}
