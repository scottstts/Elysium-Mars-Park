import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { markStaticShadowProxy } from '../render/layers'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { optimusStances } from '../world/districts/optimusPlaza'
import { loadOptimusSignFaces } from '../world/districts/optimusSign'
import { loadOptimusAsset } from './optimus/optimusModel'
import { LED_PERIOD, optimusLedClock } from './optimus/optimusMaterials'

/**
 * THE OPTIMUS EXHIBIT — eight humanoids standing on the court plinth.
 *
 * The figures are a single ~890 k-triangle asset drawn as eight instances of
 * one geometry; `world/districts/optimusPlaza.ts` owns the platform they
 * stand on and publishes the eight stances, so the deck datum has exactly one
 * author.
 *
 * LOD IS PER GROUP, NOT PER FIGURE. An InstancedMesh draws one range, so the
 * only way to give two instances different detail is two meshes with two
 * counts — and a count that moves after the cached shadow bundle is sealed
 * desynchronises the shadow (render/layers.ts). The formation is 7.2 × 3.0 m,
 * which at the near threshold subtends barely 4°: every figure is effectively
 * the same distance away, so one switch for all eight loses nothing and keeps
 * both the instance buffers and the shadow bundle completely static.
 *
 * The shadow is cast by a fourth, never-switched instance set on the
 * shadow-proxy layer, at the middle LOD. The cached clipmaps rasterise their
 * casters on every recenter; handing them the exact mesh would put 7.1 M
 * triangles into a refresh that is supposed to be cheap.
 */

/** Camera distance (m, from the court centre) at which each LOD takes over. */
const LOD_DISTANCES = [30, 70]
/** Switch hysteresis, so a player pacing the threshold does not flicker. */
const LOD_HYSTERESIS = 4

export class OptimusExhibitSystem implements GameSystem {
  readonly id = 'optimus-exhibit'

  private readonly group = new Group()
  private readonly meshes: InstancedMesh[] = []
  private readonly centre = new Vector3()
  private active = -1
  private triangles: number[] = []

  async init(ctx: GameContext): Promise<void> {
    // The figure build and the marque's texture decode are independent; the
    // worker is the long pole either way.
    const [asset, marque] = await Promise.all([loadOptimusAsset(), loadOptimusSignFaces()])
    this.group.add(marque)
    const stances = optimusStances()
    this.triangles = asset.lods.map((lod) => lod.triangles)

    for (const stance of stances) this.centre.add(stance.position)
    this.centre.divideScalar(stances.length)

    const matrices = stances.map((stance) =>
      new Matrix4().compose(
        stance.position,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), stance.yaw),
        new Vector3(1, 1, 1),
      ),
    )

    const place = (level: number): InstancedMesh => {
      const mesh = new InstancedMesh(asset.lods[level].geometry, asset.materials, stances.length)
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i])
      mesh.instanceMatrix.needsUpdate = true
      // The formation never moves; three can skip its per-frame matrix work.
      mesh.frustumCulled = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      return mesh
    }

    for (let level = 0; level < asset.lods.length; level++) {
      const mesh = place(level)
      mesh.name = `optimus:lod${level}`
      // Shadows come from the proxy below — a visible LOD that also cast
      // would either double the silhouette or vanish with its own count.
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.visible = false
      this.meshes.push(mesh)
      this.group.add(mesh)
    }

    const shadowLevel = Math.min(1, asset.lods.length - 1)
    const proxy = place(shadowLevel)
    proxy.name = 'optimus:shadow-proxy'
    proxy.castShadow = true
    proxy.receiveShadow = false
    // Bundled draws are immutable once recorded, so this one must never be
    // culled out from under the clipmap camera that recorded it.
    proxy.frustumCulled = false
    markStaticShadowProxy(proxy)
    this.group.add(proxy)

    this.select(0)
    ctx.scene.add(this.group)

    if (ctx.flags.debug) {
      const counts = this.triangles.map((t) => `${(t / 1000).toFixed(0)}k`).join(' / ')
      console.info(
        `[optimus] ${stances.length} figures · LOD tris ${counts} · built in ${asset.buildMs} ms`,
      )
    }
  }

  update(ctx: GameContext): void {
    // Visor breath. Wrapped to the period rather than fed raw sim seconds:
    // a float32 uniform loses sub-frame resolution on a clock that has been
    // running for hours, and the pulse would visibly quantise.
    optimusLedClock.value = ctx.time.sim % LED_PERIOD

    if (this.meshes.length === 0) return
    const distance = ctx.camera.position.distanceTo(this.centre)
    let level = this.meshes.length - 1
    for (let i = 0; i < LOD_DISTANCES.length; i++) {
      // Stepping to a FINER level has to earn it (threshold − h); holding the
      // current one is free (threshold + h). That asymmetry is the hysteresis.
      const bias = i < this.active ? -LOD_HYSTERESIS : LOD_HYSTERESIS
      if (distance < LOD_DISTANCES[i] + bias) {
        level = i
        break
      }
    }
    this.select(level)
  }

  /**
   * Compile every visible-geometry LOD in the caller's current render context.
   * Only one mesh is exposed at a time, exactly like runtime selection; the
   * prior selection is restored even if compilation fails.
   */
  async compileAllLods(compileScene: () => Promise<void>): Promise<void> {
    if (this.meshes.length === 0) return
    const restoreLevel = this.active
    const restoreFrustumCulled = this.meshes.map((mesh) => mesh.frustumCulled)
    try {
      for (let level = 0; level < this.meshes.length; level++) {
        for (let i = 0; i < this.meshes.length; i++) {
          this.meshes[i].visible = i === level
          // The authored wide camera warms most of the park, but the court is
          // outside that pose's frustum. Compilation must still visit the one
          // explicitly selected mesh.
          this.meshes[i].frustumCulled = false
        }
        await compileScene()
      }
    } finally {
      for (let i = 0; i < this.meshes.length; i++) {
        this.meshes[i].visible = i === restoreLevel
        this.meshes[i].frustumCulled = restoreFrustumCulled[i]
      }
    }
  }

  private select(level: number): void {
    if (level === this.active) return
    this.active = level
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = i === level
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
    for (const mesh of this.meshes) mesh.dispose()
  }
}
