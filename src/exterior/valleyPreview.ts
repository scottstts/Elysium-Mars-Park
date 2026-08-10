import {
  ACESFilmicToneMapping,
  BackSide,
  DirectionalLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three'
import { MeshBasicNodeMaterial, PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { float, normalize, positionLocal } from 'three/tsl'
import { marsSkyRadiance } from '../sky/skyRadiance'
import { SUN_LIGHT_INTENSITY, sunColor, sunDirection } from '../sky/sun'
import type { GameContext } from '../runtime/context'
import type { RenderPipelineSystem } from '../render/pipeline'

/**
 * DEV-ONLY isolated harness for the valley terrain.
 *
 * The full game boot depends on every other system compiling; while the park
 * is being rebuilt in parallel a single broken district takes the whole scene
 * down and the terrain becomes unverifiable. This mounts JUST the sky, the
 * sun, and `ExteriorSystem` in a throwaway renderer so the valley can be
 * judged on its own. Drive it from the console:
 *
 *     const p = await import('/src/exterior/valleyPreview.ts')
 *     const view = await p.mountValleyPreview()
 *     view.look([-104, 3.2, -26], [-220, 26, -16])
 *
 * Nothing in the shipped runtime imports this module.
 */
export interface ValleyPreview {
  look(position: [number, number, number], target: [number, number, number]): void
  eyeAt(x: number, z: number, bearingDegrees: number, elevationDegrees?: number): void
  /** The harness tone-maps with plain ACES; the shipped pipeline does not. */
  setExposure(value: number): void
  /** The terrain mesh, so a console session can swap in debug material nodes. */
  terrain(): Mesh | null
  redraw(): void
  dispose(): void
}

export async function mountValleyPreview(
  width = 1600,
  height = 900,
  /**
   * Cache-buster appended to the terrain module specifiers, e.g. `?t=${Date.now()}`.
   * A page that has already imported the terrain keeps the old module instance
   * in its registry, so an edit-then-remount silently re-renders the previous
   * build — this forces a fresh instance.
   */
  bust = '',
): Promise<ValleyPreview> {
  const terrainModule = (await import(
    /* @vite-ignore */ `./exteriorTerrain${bust}`
  )) as typeof import('./exteriorTerrain')
  const heightModule = (await import(
    /* @vite-ignore */ `./terrainHeight${bust}`
  )) as typeof import('./terrainHeight')
  const { ExteriorSystem } = terrainModule
  const { exteriorHeight } = heightModule

  const canvas = document.createElement('canvas')
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:99999`
  document.body.appendChild(canvas)

  const renderer = new WebGPURenderer({ canvas, antialias: true })
  await renderer.init()
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new Scene()
  const camera = new PerspectiveCamera(58, width / height, 0.5, 40000)

  const skyMaterial = new MeshBasicNodeMaterial()
  skyMaterial.colorNode = marsSkyRadiance(normalize(positionLocal), float(1))
  skyMaterial.side = BackSide
  skyMaterial.depthWrite = false
  const skyDome = new Mesh(new SphereGeometry(20000, 64, 32), skyMaterial)
  skyDome.frustumCulled = false
  skyDome.renderOrder = -100
  scene.add(skyDome)

  const sun = new DirectionalLight(sunColor, SUN_LIGHT_INTENSITY)
  sun.position.copy(sunDirection).multiplyScalar(900)
  scene.add(sun)
  scene.add(sun.target)

  const environmentScene = new Scene()
  environmentScene.add(new Mesh(new SphereGeometry(50, 32, 16), skyMaterial))
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(environmentScene, 0.03, 1, 90).texture
  scene.environmentIntensity = 0.5
  pmrem.dispose()

  // ExteriorSystem only needs these four pieces of context; the rest of the
  // GameContext surface never gets touched during init.
  const pipelineStub = { hdrTransform: null, debugNodes: {} } as unknown as RenderPipelineSystem
  const system = new ExteriorSystem(pipelineStub)
  const buildStart = performance.now()
  system.init({
    scene,
    camera,
    quality: { params: { scatterDensity: 1, exteriorDetailRadius: 2600 } },
    rng: { fork: () => makeRng(1337) },
    time: { sim: 0 },
  } as unknown as GameContext)
  const buildMs = performance.now() - buildStart

  const render = (): void => {
    skyDome.position.copy(camera.position)
    renderer.render(scene, camera)
  }

  const preview: ValleyPreview = {
    look(position, target) {
      camera.position.set(position[0], position[1], position[2])
      camera.lookAt(target[0], target[1], target[2])
      render()
    },
    eyeAt(x, z, bearingDegrees, elevationDegrees = 0) {
      const bearing = (bearingDegrees * Math.PI) / 180
      const eye = exteriorHeight(x, z) + 1.7
      const reach = 3000
      preview.look(
        [x, eye, z],
        [
          x + Math.cos(bearing) * reach,
          eye + Math.tan((elevationDegrees * Math.PI) / 180) * reach,
          z + Math.sin(bearing) * reach,
        ],
      )
    },
    setExposure(value) {
      renderer.toneMappingExposure = value
      render()
    },
    terrain() {
      let found: Mesh | null = null
      scene.traverse((object) => {
        const mesh = object as Mesh
        if (found === null && mesh.isMesh && mesh.renderOrder === -50) found = mesh
      })
      return found
    },
    redraw: render,
    dispose() {
      renderer.dispose()
      canvas.remove()
    },
  }
  ;(preview as ValleyPreview & { buildMs: number }).buildMs = buildMs
  render()
  return preview
}

/** Tiny deterministic RNG matching the shape ExteriorSystem expects. */
function makeRng(seed: number): { float(): number } {
  let state = seed >>> 0
  return {
    float(): number {
      state = (Math.imul(state ^ (state >>> 15), 2246822519) + 374761393) >>> 0
      state ^= state >>> 13
      return (state >>> 0) / 4294967296
    },
  }
}
