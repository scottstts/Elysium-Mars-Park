import { PerspectiveCamera, Scene } from 'three'
import { parseFlags } from './core/debug'
import { DebugOverlaySystem } from './core/debugOverlay'
import { EventBus } from './core/events'
import type { GameEvents } from './core/gameEvents'
import { auditPostcardBookmarks } from './core/postcards'
import { Rng } from './core/prng'
import { QualityState } from './core/quality'
import { isWindowsPlatform } from './core/platform'
import { DomeSystem } from './dome/domeSystem'
import { interiorHazeStrength, shaftStrength } from './dome/interiorHaze'
import { gradeParams } from './render/grade'
import { penumbraScale } from './dome/latticeField'
import { ExteriorSystem } from './exterior/exteriorTerrain'
import { StarshipSystem } from './starship/starshipSystem'
import { FountainSystem } from './fountain/fountainSystem'
import { FOG_EXTINCTION_PER_METER } from './exterior/marsAerialPerspective'
import { PhysicsSystem } from './physics/physicsWorld'
import { InteractionSystem } from './player/interaction'
import { PlayerSystem } from './player/playerSystem'
import { enableMainDetailLayer } from './render/layers'
import { OptimusExhibitSystem } from './robots/optimusExhibit'
import { RobotsSystem } from './robots/robotsSystem'
import { VegetationSystem } from './vegetation/vegetationSystem'
import { RenderPipelineSystem } from './render/pipeline'
import { createRenderer, recommendedPixelRatio, webgpuAvailable } from './render/renderer'
import type { RendererFailure } from './render/rendererFailure'
import { SkySystem } from './sky/skySystem'
import type { GameContext } from './runtime/context'
import { GameLoop } from './runtime/loop'
import { SystemRegistry } from './runtime/registry'
import { TramSystem } from './tram/tramSystem'
import { AudioEngineSystem } from './audio/engine'
import { createEntryScreen } from './ui/entryScreen'
import { PauseSystem } from './ui/pauseMenu'
import { DevOrbitSystem } from './world/devOrbit'
import { DoorsSystem } from './world/doors'
import { FreedomElevatorSystem } from './world/freedomElevator'
import { GroundworksSystem } from './world/groundworks'
import { OpsScreensSystem } from './world/opsScreens'
import { ParkAssemblySystem } from './world/parkAssembly'
import { PortalStationSystem } from './world/portalStation'
import { TestGallerySystem } from './world/testGallery'

// The year the first crew broke ground at Elysium Base.
const DEFAULT_SEED = 20520114

let bootStage = 'entry'
let activeEntry: ReturnType<typeof createEntryScreen> | null = null
let activeLoop: GameLoop | null = null
let bootFinished = false
let fatalShown = false
let windowsPlatform = false
let bootRendererFailure: Error | null = null

function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

function showFatalError(title: string, error: unknown, detail = ''): void {
  if (fatalShown) return
  fatalShown = true
  activeLoop?.stop()
  const entry = activeEntry ?? createEntryScreen(document.body)
  activeEntry = entry
  const width = Math.max(1, window.innerWidth)
  const height = Math.max(1, window.innerHeight)
  const diagnostics = [
    `Stage ${bootStage}`,
    describeFailure(error),
    detail,
    `${width}×${height} CSS px · device DPR ${window.devicePixelRatio.toFixed(2)} · render DPR ${recommendedPixelRatio(width, height).toFixed(2)}`,
    windowsPlatform ? 'Platform Windows' : 'Platform non-Windows',
  ].filter(Boolean).join(' · ')
  entry.showError(title, diagnostics)
}

function yieldBrowserTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function boot(): Promise<void> {
  const entry = createEntryScreen(document.body)
  activeEntry = entry
  windowsPlatform = isWindowsPlatform()
  bootStage = 'webgpu-gate'
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
  bootStage = 'renderer-init'
  const handleRendererFailure = (failure: RendererFailure): void => {
    const detail = `${failure.api} ${failure.type}: ${failure.message}`
    // Any uncaptured GPU error during boot invalidates the warmup result. Once
    // gameplay has started, keep validation diagnostics non-fatal but always
    // surface device loss, OOM and internal backend failures.
    if (!bootFinished) {
      bootRendererFailure = new Error(detail)
    }
    if (!bootFinished || failure.fatal) {
      showFatalError(
        failure.kind === 'device-lost' ? 'Graphics device lost' : 'Graphics error',
        failure.message,
        detail,
      )
    }
  }
  const throwIfBootRendererFailed = (): void => {
    if (bootRendererFailure) throw bootRendererFailure
  }
  let renderer
  try {
    renderer = await createRenderer(canvas, flags.debug, handleRendererFailure)
    throwIfBootRendererFailed()
  } catch (error) {
    showFatalError('WebGPU initialization failed', error)
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

  let resizeFrame: number | null = null
  const commitResize = (): void => {
    resizeFrame = null
    if (fatalShown) return
    const width = window.innerWidth
    const height = window.innerHeight
    // A hidden/minimized window reports 0x0; a 0-sized swapchain poisons
    // every render pass with validation errors. Keep the last real size.
    if (width === 0 || height === 0) return
    const pixelRatio = recommendedPixelRatio(width, height) * ctx.quality.renderScale
    // One atomic drawing-buffer change. Calling setPixelRatio() and setSize()
    // separately reallocates this renderer's very large target graph twice.
    renderer.setDrawingBufferSize(width, height, pixelRatio)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    ctx.events.emit('render/resized', { width, height, renderScale: ctx.quality.renderScale })
  }
  const handleResize = (): void => {
    if (fatalShown || resizeFrame !== null) return
    resizeFrame = window.requestAnimationFrame(commitResize)
  }
  window.addEventListener('resize', handleResize)

  enableMainDetailLayer(camera)

  const registry = new SystemRegistry()
  const pipeline = new RenderPipelineSystem()
  let tram: TramSystem
  let optimus: OptimusExhibitSystem
  if (flags.debug) registry.add(new DebugOverlaySystem())
  const sky = registry.add(new SkySystem())
  registry.add(new ExteriorSystem(pipeline))
  // Beyond the glass, with the terrain: the launch site is exterior scenery,
  // has no colliders and no interactions, and only has to exist before
  // `sealStaticShadowCasters` records the static bundle below.
  registry.add(new StarshipSystem())
  registry.add(new DomeSystem(pipeline))
  const physics = registry.add(new PhysicsSystem())
  // Groundworks registers AFTER physics: its planter walls are real colliders,
  // so the rapier world has to exist when it initialises.
  registry.add(new GroundworksSystem(physics))
  if (flags.view === 'gallery') registry.add(new TestGallerySystem())
  if (flags.view) {
    // Fixed validation cameras inspect with orbit controls, not the player.
    registry.add(new DevOrbitSystem())
    registry.add(new PortalStationSystem(physics, null, null))
    const doors = registry.add(new DoorsSystem(physics, null))
    const assembly = registry.add(new ParkAssemblySystem(physics, null, null, doors))
    tram = registry.add(new TramSystem(physics, null, null))
    registry.add(new FreedomElevatorSystem(physics, null, null))
    const robots = registry.add(new RobotsSystem(null))
    optimus = registry.add(new OptimusExhibitSystem())
    registry.add(new OpsScreensSystem(assembly, tram, robots))
    registry.add(new VegetationSystem(physics))
    registry.add(new FountainSystem(physics))
  } else {
    const player = registry.add(new PlayerSystem(physics))
    const interaction = registry.add(new InteractionSystem(player))
    registry.add(new PortalStationSystem(physics, player, interaction))
    const doors = registry.add(new DoorsSystem(physics, interaction))
    const assembly = registry.add(new ParkAssemblySystem(physics, player, interaction, doors))
    tram = registry.add(new TramSystem(physics, player, interaction))
    // After the tram: both share the caption override, and the later system
    // must be the elevator so its seated hint wins while a guest rides it.
    registry.add(new FreedomElevatorSystem(physics, player, interaction))
    const robots = registry.add(new RobotsSystem(player))
    optimus = registry.add(new OptimusExhibitSystem())
    registry.add(new OpsScreensSystem(assembly, tram, robots))
    registry.add(new VegetationSystem(physics))
    // The fountain owns its own stone, water and spray; its four coping
    // planters are instanced by VegetationSystem into the shared foliage
    // palette, so the two are decoupled and the order here is free.
    registry.add(new FountainSystem(physics))
    const audio = registry.add(new AudioEngineSystem(player, robots, tram))
    registry.add(new PauseSystem(player, audio))
  }
  // The pipeline registers last: every system's scene contribution exists
  // before the pass graph is built.
  registry.add(pipeline)

  const postcardAudit = auditPostcardBookmarks()
  if (!postcardAudit.complete) {
    throw new Error(`Missing postcard bookmarks: ${postcardAudit.missing.join(', ')}`)
  }

  bootStage = 'systems-init'
  await registry.init(ctx, (label, index, total) => {
    bootStage = `init:${label}`
    entry.setProgress(label, 0.1 + 0.8 * (index / Math.max(1, total)))
  })

  // The frozen world records its shadow bundle once, behind the entry screen.
  bootStage = 'static-shadow-seal'
  sky.sealStaticShadowCasters(scene)

  // Lay out the boot-time camera and live canvas textures once without
  // advancing simulation. The player begins inside a moving tram, so init()
  // alone has not yet copied that seated pose onto the camera.
  bootStage = 'initial-layout'
  registry.update(ctx, 0, 0)
  registry.lateUpdate(ctx, 0, 0)

  const finishWindowsBatch = async (): Promise<void> => {
    if (!windowsPlatform) {
      throwIfBootRendererFailed()
      return
    }
    await pipeline.finishWarmup()
    await yieldBrowserTask()
    throwIfBootRendererFailed()
  }

  entry.setProgress('prewarm', 0.92)
  bootStage = 'pipeline-compile'
  await pipeline.compileAsync()
  await finishWindowsBatch()
  bootStage = 'scene-compile:arrival'
  await pipeline.compileSceneAsync()
  await finishWindowsBatch()

  if (!validationMode) {
    // Compile the ACTUAL scene pass at the same wide poses previously used as
    // fire-and-forget sneak renders. Three r185 defers uncached WebGPU builds
    // from render(), so those renders could still be compiling after BOARD.
    // Awaiting PassNode.compileAsync() keeps all of that work behind the plate.
    entry.setProgress('prewarm', 0.96)
    const arrivalPosition = camera.position.clone()
    const arrivalQuaternion = camera.quaternion.clone()

    camera.position.set(100, 80, 135)
    camera.lookAt(0, 20, 0)
    bootStage = 'scene-compile:wide-aerial'
    await pipeline.compileSceneAsync()
    await finishWindowsBatch()

    bootStage = 'optimus-lod-warmup'
    await optimus.compileAllLods(async () => {
      await pipeline.compileSceneAsync()
      await finishWindowsBatch()
      pipeline.render()
      await finishWindowsBatch()
    })
    bootStage = 'scene-render:wide-aerial'
    pipeline.render()
    await finishWindowsBatch()

    camera.position.set(0, 4.2, 246)
    camera.lookAt(0, 2, 100)
    bootStage = 'scene-compile:portal'
    await pipeline.compileSceneAsync()
    await finishWindowsBatch()
    bootStage = 'scene-render:portal'
    pipeline.render()
    await finishWindowsBatch()

    camera.position.set(-40, 3, -30)
    camera.lookAt(-150, 4, -60)
    bootStage = 'scene-compile:west'
    await pipeline.compileSceneAsync()
    await finishWindowsBatch()
    bootStage = 'scene-render:west'
    pipeline.render()
    await finishWindowsBatch()

    // The broad poses must not leave camera-centred shadow maps committed far
    // from the arrival tram. Restore the real seat pose before BOARD.
    camera.position.copy(arrivalPosition)
    camera.quaternion.copy(arrivalQuaternion)
    bootStage = 'scene-compile:arrival-final'
    await pipeline.compileSceneAsync()
    await finishWindowsBatch()

    if (windowsPlatform) {
      // D3D12 gets one cached level per fenced submission. Combined with the
      // Windows-only lazy BundleGroup policy this records only the arrival
      // region now, never every spatial bundle × every clipmap level at once.
      sky.invalidateShadowLevels(true)
      let passes = 0
      const passLimit = sky.staticShadowWarmupPassLimit()
      while (!sky.staticShadowWarmupComplete()) {
        if (passes++ >= passLimit) throw new Error('static-shadow-warmup-did-not-converge')
        bootStage = `static-shadow-warmup:${passes}`
        pipeline.render()
        await finishWindowsBatch()
      }
    } else {
      // Preserve the established Metal path exactly: all forced levels are
      // refreshed together, followed by the single final GPU fence.
      bootStage = 'static-shadow-warmup'
      sky.invalidateShadowLevels()
      pipeline.render()
      await pipeline.finishWarmup()
      throwIfBootRendererFailed()
    }
  }

  throwIfBootRendererFailed()
  bootStage = 'game-loop'
  const loop = new GameLoop(ctx, registry)
  activeLoop = loop
  let firstGameplayFramePending = false
  loop.renderFrame = () => {
    pipeline.render()
    if (!firstGameplayFramePending) return
    firstGameplayFramePending = false
    ctx.events.emit('render/started', { arrival: true })
  }
  loop.onFrameEnd = (timing) => {
    ctx.quality.submitFrame(timing.frameIntervalMs)
  }
  loop.start()

  if (flags.debug) {
    // Console/automation handle for live inspection (agents + humans).
    // step(n) renders n synthetic frames even while rAF is throttled.
    ;(window as unknown as { __elysium: object }).__elysium = {
      ctx,
      registry,
      loop,
      penumbraScale,
      shaftStrength,
      interiorHazeStrength,
      gradeParams,
      fogExtinction: FOG_EXTINCTION_PER_METER,
      step: (n = 1, dtMs = 1000 / 60): number => {
        for (let i = 0; i < n; i++) loop.manualStep(dtMs)
        return ctx.time.frame
      },
    }
  }

  if (
    import.meta.env.DEV
    && !validationMode
    && flags.profileArrival
  ) {
    const { installArrivalProfiler } = await import('./core/arrivalProfiler')
    installArrivalProfiler({
      ctx,
      loop,
      registry,
      tramSnapshot: () => tram.debugSnapshot(),
      shadowSnapshot: () => sky.debugShadowSnapshot(),
    })
  }

  bootStage = 'board'
  if (!validationMode) {
    await entry.showEnter()
    throwIfBootRendererFailed()
  }
  entry.hide()
  ctx.events.emit('park/entered', { arrival: !validationMode })
  // Audio is gesture-armed (silently) by park/entered. The render callback
  // releases it only after this first unpaused gameplay frame is submitted.
  firstGameplayFramePending = !validationMode
  ctx.time.paused = false
  bootFinished = true
  bootStage = 'running'
}

void boot().catch((error) => {
  showFatalError('Loading failed', error)
})
