import { PerspectiveCamera, Scene } from 'three'
import { parseFlags } from './core/debug'
import { DebugOverlaySystem } from './core/debugOverlay'
import { EventBus } from './core/events'
import type { GameEvents } from './core/gameEvents'
import { auditPostcardBookmarks } from './core/postcards'
import { Rng } from './core/prng'
import { QualityState } from './core/quality'
import { DomeSystem } from './dome/domeSystem'
import { shaftStrength } from './dome/interiorHaze'
import { penumbraScale } from './dome/latticeField'
import { ExteriorSystem } from './exterior/exteriorTerrain'
import { FOG_EXTINCTION_PER_METER } from './exterior/marsAerialPerspective'
import { PhysicsSystem } from './physics/physicsWorld'
import { InteractionSystem } from './player/interaction'
import { PlayerSystem } from './player/playerSystem'
import { enableMainDetailLayer } from './render/layers'
import { RobotsSystem } from './robots/robotsSystem'
import { VegetationSystem } from './vegetation/vegetationSystem'
import { RenderPipelineSystem } from './render/pipeline'
import { createRenderer, recommendedPixelRatio, webgpuAvailable } from './render/renderer'
import { SkySystem } from './sky/skySystem'
import type { GameContext } from './runtime/context'
import { GameLoop } from './runtime/loop'
import { SystemRegistry } from './runtime/registry'
import { TramSystem } from './tram/tramSystem'
import { AudioEngineSystem } from './audio/engine'
import { createEntryScreen } from './ui/entryScreen'
import { DevOrbitSystem } from './world/devOrbit'
import { DoorsSystem } from './world/doors'
import { GroundworksSystem } from './world/groundworks'
import { OpsScreensSystem } from './world/opsScreens'
import { ParkAssemblySystem } from './world/parkAssembly'
import { PortalStationSystem } from './world/portalStation'
import { TestGallerySystem } from './world/testGallery'

// The year the first crew broke ground at Elysium Base.
const DEFAULT_SEED = 20520114

async function boot(): Promise<void> {
  const entry = createEntryScreen(document.body)
  const flags = parseFlags()
  const validationMode = flags.view !== null || flags.pass !== 'final'

  if (!(await webgpuAvailable())) {
    entry.showError(
      'WebGPU required',
      'Elysium Commons is rendered with WebGPU only. Please visit with a current Chrome, Edge, or Safari on a supported GPU.',
    )
    return
  }

  const canvas = document.createElement('canvas')
  canvas.id = 'scene'
  document.body.prepend(canvas)

  entry.setProgress('render-pipeline', 0.05)
  let renderer
  try {
    renderer = await createRenderer(canvas, flags.debug)
  } catch {
    entry.showError(
      'WebGPU required',
      'A WebGPU adapter was found but could not be initialized. Please update your browser or graphics drivers.',
    )
    return
  }

  const scene = new Scene()
  // Far plane covers the exterior skyline ring (~12 km); near stays tight for
  // close inspection. WebGPU float depth keeps the ratio artifact-free.
  const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 14000)

  const ctx: GameContext = {
    renderer,
    scene,
    camera,
    events: new EventBus<GameEvents>(),
    rng: new Rng(flags.seed ?? DEFAULT_SEED),
    flags,
    quality: new QualityState(flags.tier ?? 2),
    time: { elapsed: 0, sim: 0, frame: 0, paused: true },
  }

  const handleResize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    // A hidden/minimized window reports 0x0; a 0-sized swapchain poisons
    // every render pass with validation errors. Keep the last real size.
    if (width === 0 || height === 0) return
    renderer.setPixelRatio(recommendedPixelRatio(width, height))
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    ctx.events.emit('render/resized', { width, height, renderScale: ctx.quality.renderScale })
  }
  window.addEventListener('resize', handleResize)

  enableMainDetailLayer(camera)

  const registry = new SystemRegistry()
  const pipeline = new RenderPipelineSystem()
  if (flags.debug) registry.add(new DebugOverlaySystem())
  const sky = registry.add(new SkySystem())
  registry.add(new ExteriorSystem(pipeline))
  registry.add(new DomeSystem(pipeline))
  registry.add(new GroundworksSystem())
  const physics = registry.add(new PhysicsSystem())
  if (flags.view === 'gallery') registry.add(new TestGallerySystem())
  if (flags.view) {
    // Fixed validation cameras inspect with orbit controls, not the player.
    registry.add(new DevOrbitSystem())
    registry.add(new PortalStationSystem(physics, null, null))
    const doors = registry.add(new DoorsSystem(physics, null))
    const assembly = registry.add(new ParkAssemblySystem(physics, null, null, doors))
    const tram = registry.add(new TramSystem(physics, null, null))
    const robots = registry.add(new RobotsSystem(null))
    registry.add(new OpsScreensSystem(assembly, tram, robots))
    registry.add(new VegetationSystem(physics))
  } else {
    const player = registry.add(new PlayerSystem(physics))
    const interaction = registry.add(new InteractionSystem(player))
    registry.add(new PortalStationSystem(physics, player, interaction))
    const doors = registry.add(new DoorsSystem(physics, interaction))
    const assembly = registry.add(new ParkAssemblySystem(physics, player, interaction, doors))
    const tram = registry.add(new TramSystem(physics, player, interaction))
    const robots = registry.add(new RobotsSystem(player))
    registry.add(new OpsScreensSystem(assembly, tram, robots))
    registry.add(new VegetationSystem(physics))
    registry.add(new AudioEngineSystem(player, robots, tram))
  }
  // The pipeline registers last: every system's scene contribution exists
  // before the pass graph is built.
  registry.add(pipeline)

  const postcardAudit = auditPostcardBookmarks()
  if (!postcardAudit.complete) {
    throw new Error(`Missing postcard bookmarks: ${postcardAudit.missing.join(', ')}`)
  }

  await registry.init(ctx, (label, index, total) =>
    entry.setProgress(label, 0.1 + 0.8 * (index / Math.max(1, total))),
  )

  // The frozen world records its shadow bundle once, behind the entry screen.
  sky.sealStaticShadowCasters(scene)

  entry.setProgress('prewarm', 0.92)
  await pipeline.compileAsync()

  const loop = new GameLoop(ctx, registry)
  loop.renderFrame = () => pipeline.render()
  loop.onFrameEnd = (timing) => {
    ctx.quality.submitFrame(timing.frameIntervalMs)
  }
  loop.start()

  if (!validationMode) {
    // Sneak-render wide poses behind the entry screen so every park material
    // compiles NOW — the arrival reveal must never hitch on first sight.
    entry.setProgress('prewarm', 0.96)
    camera.position.set(190, 150, 260)
    camera.lookAt(0, 20, 0)
    pipeline.render()
    camera.position.set(0, 4.2, 246)
    camera.lookAt(0, 2, 100)
    pipeline.render()
    camera.position.set(-40, 3, -30)
    camera.lookAt(-150, 4, -60)
    pipeline.render()
  }

  if (flags.debug) {
    // Console/automation handle for live inspection (agents + humans).
    // step(n) renders n synthetic frames even while rAF is throttled.
    ;(window as unknown as { __elysium: object }).__elysium = {
      ctx,
      registry,
      loop,
      penumbraScale,
      shaftStrength,
      fogExtinction: FOG_EXTINCTION_PER_METER,
      step: (n = 1, dtMs = 1000 / 60): number => {
        for (let i = 0; i < n; i++) loop.manualStep(dtMs)
        return ctx.time.frame
      },
    }
  }

  if (!validationMode) await entry.showEnter()
  entry.hide()
  ctx.time.paused = false
  ctx.events.emit('park/entered', { arrival: !validationMode })
}

void boot()
