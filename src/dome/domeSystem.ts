import { Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial } from 'three'
import { uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { RenderPipelineSystem } from '../render/pipeline'
import { buildDomeStructure } from './domeGeometry'
import { createGlassShell, createShellRimGlow } from './glassShell'
import { attachInteriorShafts } from './interiorHaze'

/**
 * Dome One (plan §6): structural members, ISRU glass shell with dust film +
 * portal cut, rim glow, the exterior connector-tube stub (S9 replaces with
 * the real tram tube), and the interior shaft march wired into the pipeline.
 *
 * The analytic lattice field (latticeField.ts) is the load-bearing piece —
 * materials pick up the shadow net via `applyLatticeShadow` (see S5).
 */
export class DomeSystem implements GameSystem {
  readonly id = 'dome'
  private readonly group = new Group()
  private readonly pipeline: RenderPipelineSystem

  constructor(pipeline: RenderPipelineSystem) {
    this.pipeline = pipeline
  }

  init(ctx: GameContext): void {
    const { scene, camera, quality } = ctx

    const steel = new MeshStandardMaterial({
      color: new Color(0.815, 0.8, 0.77),
      roughness: 0.42,
      metalness: 0.12,
    })
    const dark = new MeshStandardMaterial({
      color: new Color(0.2, 0.19, 0.185),
      roughness: 0.6,
      metalness: 0.25,
    })

    this.group.add(buildDomeStructure(steel, dark))

    const { mesh, exteriorMesh } = createGlassShell()
    this.group.add(mesh)
    this.group.add(exteriorMesh)
    this.group.add(createShellRimGlow())

    // Connector tube stub heading south through the haze (arrival, S9).
    const tube = new Mesh(
      new CylinderGeometry(5.6, 5.6, 420, 28, 1, true),
      new MeshStandardMaterial({
        color: new Color(0.62, 0.6, 0.57),
        roughness: 0.5,
        metalness: 0.2,
        side: DoubleSide,
      }),
    )
    tube.rotation.x = Math.PI / 2
    tube.position.set(0, 4.4, 250 + 210)
    this.group.add(tube)

    scene.add(this.group)

    // Interior shafts splice into the hdrTransform chain after the aerial
    // medium (ExteriorSystem registered it first).
    const projectionInverse = uniform(camera.projectionMatrixInverse)
    attachInteriorShafts(
      this.pipeline,
      projectionInverse as unknown as Node<'mat4'>,
      quality.params.shaftSteps,
    )
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
