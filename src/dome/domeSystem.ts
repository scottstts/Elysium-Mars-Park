import { Group } from 'three'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { RenderPipelineSystem } from '../render/pipeline'
import { buildConnectorTube } from './connectorTube'
import { buildDomeStructure } from './domeGeometry'
import { domeMaterials } from './domeMaterials'
import { createGlassShell, createShellRimGlow } from './glassShell'
import { attachInteriorShafts } from './interiorHaze'

/**
 * Dome One's entry point — assembly only. The parts live next door:
 * latticeField (the grid as math), domeGeometry (the built gridshell),
 * glassShell (the panes), connectorTube (portal bulkhead + arrival duct),
 * domeMaterials (the shell's own material set), interiorHaze (the shaft
 * march spliced into the render pipeline).
 */
export class DomeSystem implements GameSystem {
  readonly id = 'dome'
  private readonly group = new Group()
  private readonly pipeline: RenderPipelineSystem

  constructor(pipeline: RenderPipelineSystem) {
    this.pipeline = pipeline
  }

  init(ctx: GameContext): void {
    const { scene, quality } = ctx
    const materials = domeMaterials()

    this.group.add(buildDomeStructure(materials))
    this.group.add(buildConnectorTube(materials))

    const { mesh, exteriorMesh } = createGlassShell()
    this.group.add(mesh)
    this.group.add(exteriorMesh)
    this.group.add(createShellRimGlow())

    scene.add(this.group)

    // Interior shafts splice into the hdrTransform chain after the aerial
    // medium (ExteriorSystem registered it first).
    attachInteriorShafts(this.pipeline, quality.params.shaftSteps)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
