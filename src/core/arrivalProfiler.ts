import type { WebGPURenderer } from 'three/webgpu'
import type { ShadowClipmapSnapshot } from '../render/cachedShadowClipmaps'
import type { GameContext } from '../runtime/context'
import type { FrameTiming, GameLoop } from '../runtime/loop'
import type {
  SystemRegistry,
  SystemTimingHandler,
  SystemUpdatePhase,
} from '../runtime/registry'
import type { TramDebugSnapshot } from '../tram/tramSystem'

const OUTPUT_ID = 'arrival-profile-data'
const GPU_DRAIN_FRAMES = 45
const MAX_SPIKE_DETAILS = 60

interface ArrivalProfilerOptions {
  ctx: GameContext
  loop: GameLoop
  registry: SystemRegistry
  tramSnapshot: () => TramDebugSnapshot
  shadowSnapshot: () => ShadowClipmapSnapshot | null
}

interface FrameRecord {
  frame: number
  rendererFrame: number
  sim: number
  intervalMs: number
  cpuMs: number
  arrivalS: number
  remaining: number
  speed: number
  tram: [number, number, number]
  camera: [number, number, number]
  drawCalls: number
  triangles: number
  points: number
  staticRefreshes: number
  dynamicRefreshes: number
  staticRefreshCpuMs: number
  visibleBundles: number
  visibleCasters: number
  renderCpuMs: number
  pipelineBuilds: PipelineBuildRecord[]
  systems: Record<string, number>
}

interface PipelineBuildRecord {
  kind: 'program' | 'pipeline'
  durationMs: number
  label: string
  object?: string
  geometry?: string
  pipelineKey?: string
}

interface GpuRecord {
  rendererFrame: number
  gpuMs: number
  contexts: number
}

interface TimestampPool {
  timestamps?: Map<string, number>
}

interface ProfileRenderObject {
  object?: { name?: string; type?: string; id?: number }
  material?: { name?: string; type?: string; id?: number }
  geometry?: { name?: string; type?: string; id?: number }
  pipeline?: { cacheKey?: string }
}

interface ProfileProgram {
  stage?: string
  name?: string
  id?: number
}

interface ProfileRenderer extends WebGPURenderer {
  resolveTimestampsAsync(type?: string): Promise<number | undefined>
  backend: WebGPURenderer['backend'] & {
    trackTimestamp?: boolean
    timestampQueryPool?: { render?: TimestampPool }
    createProgram(program: ProfileProgram): void
    createRenderPipeline(renderObject: ProfileRenderObject, promises: unknown): void
  }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
}

function rounded(value: number, places = 3): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function frameScore(record: FrameRecord, gpuMs: number): number {
  return Math.max(record.intervalMs, record.cpuMs, gpuMs)
}

/**
 * Captures exactly one tram arrival after the loopback-gated debug parser has
 * accepted `?profile=arrival`.
 * Output is a hidden JSON script so browser automation can read it without
 * opening a devtools channel or perturbing the render loop during the shot.
 */
export function installArrivalProfiler(options: ArrivalProfilerOptions): void {
  const { ctx, loop, registry, tramSnapshot, shadowSnapshot } = options
  const renderer = ctx.renderer as ProfileRenderer
  const records: FrameRecord[] = []
  const gpuByFrame = new Map<number, { gpuMs: number; contexts: number }>()
  const seenGpuUids = new Set<string>()
  const systemBag = new Map<string, number>()
  const systemTotals = new Map<string, number>()
  const systemMax = new Map<string, number>()
  const pipelineBuildBag: PipelineBuildRecord[] = []
  const gpuEnabled = renderer.backend.trackTimestamp === true
  let previousStaticRefreshes = shadowSnapshot()?.staticRefreshes ?? 0
  let previousDynamicRefreshes = shadowSnapshot()?.dynamicCaster?.renderCount ?? 0
  let resolvingGpu: Promise<void> | null = null
  let finishing = false
  let renderCpuMs = 0

  const previousSystemTiming = registry.onSystemTiming
  const onSystemTiming: SystemTimingHandler = (
    systemId: string,
    phase: SystemUpdatePhase,
    durationMs: number,
  ): void => {
    previousSystemTiming?.(systemId, phase, durationMs)
    const key = `${phase}:${systemId}`
    systemBag.set(key, (systemBag.get(key) ?? 0) + durationMs)
  }
  registry.onSystemTiming = onSystemTiming

  const previousRenderFrame = loop.renderFrame
  loop.renderFrame = (): void => {
    const start = performance.now()
    previousRenderFrame()
    renderCpuMs = performance.now() - start
  }

  const backend = renderer.backend
  const previousCreateProgram = backend.createProgram.bind(backend)
  const previousCreateRenderPipeline = backend.createRenderPipeline.bind(backend)
  backend.createProgram = (program: ProfileProgram): void => {
    const start = performance.now()
    previousCreateProgram(program)
    pipelineBuildBag.push({
      kind: 'program',
      durationMs: performance.now() - start,
      label: `${program.stage ?? 'unknown'}:${program.name || program.id || 'unnamed'}`,
    })
  }
  backend.createRenderPipeline = (
    renderObject: ProfileRenderObject,
    promises: unknown,
  ): void => {
    const start = performance.now()
    previousCreateRenderPipeline(renderObject, promises)
    const material = renderObject.material
    const object = renderObject.object
    const geometry = renderObject.geometry
    pipelineBuildBag.push({
      kind: 'pipeline',
      durationMs: performance.now() - start,
      label: `${material?.name || material?.type || 'material'}#${material?.id ?? '?'}`,
      object: `${object?.name || object?.type || 'object'}#${object?.id ?? '?'}`,
      geometry: `${geometry?.name || geometry?.type || 'geometry'}#${geometry?.id ?? '?'}`,
      pipelineKey: renderObject.pipeline?.cacheKey,
    })
  }

  const collectResolvedGpu = (): void => {
    const timestamps = renderer.backend.timestampQueryPool?.render?.timestamps
    if (!timestamps) return
    for (const [uid, durationMs] of timestamps) {
      if (seenGpuUids.has(uid)) continue
      seenGpuUids.add(uid)
      const match = uid.match(/:f(\d+)$/)
      if (!match) continue
      const rendererFrame = Number(match[1])
      const current = gpuByFrame.get(rendererFrame) ?? { gpuMs: 0, contexts: 0 }
      current.gpuMs += durationMs
      current.contexts++
      gpuByFrame.set(rendererFrame, current)
    }
  }

  const drainGpu = (): Promise<void> => {
    if (!gpuEnabled) return Promise.resolve()
    if (resolvingGpu) return resolvingGpu
    resolvingGpu = Promise.all([
      renderer.resolveTimestampsAsync('render'),
      renderer.resolveTimestampsAsync('compute'),
    ])
      .then(() => collectResolvedGpu())
      .catch((error: unknown) => {
        console.warn('[arrival-profile] WebGPU timestamp resolve failed', error)
      })
      .finally(() => {
        resolvingGpu = null
      })
    return resolvingGpu
  }

  const previousFrameEnd = loop.onFrameEnd
  loop.onFrameEnd = (timing: FrameTiming): void => {
    previousFrameEnd?.(timing)
    const tram = tramSnapshot()
    if (ctx.time.paused || (tram.phase !== 'arrival' && records.length === 0)) {
      systemBag.clear()
      pipelineBuildBag.length = 0
      return
    }

    if (tram.phase === 'arrival') {
      const shadow = shadowSnapshot()
      const staticRefreshTotal = shadow?.staticRefreshes ?? previousStaticRefreshes
      const dynamicRefreshTotal = shadow?.dynamicCaster?.renderCount ?? previousDynamicRefreshes
      const render = renderer.info.render
      const systems = Object.fromEntries(systemBag)
      for (const [key, durationMs] of systemBag) {
        systemTotals.set(key, (systemTotals.get(key) ?? 0) + durationMs)
        systemMax.set(key, Math.max(systemMax.get(key) ?? 0, durationMs))
      }
      records.push({
        frame: ctx.time.frame,
        rendererFrame: renderer.info.frame,
        sim: ctx.time.sim,
        intervalMs: timing.frameIntervalMs,
        cpuMs: timing.cpuMs,
        arrivalS: tram.arrivalS,
        remaining: tram.arrivalLength - tram.arrivalS,
        speed: tram.speed,
        tram: tram.frontCar,
        camera: [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z],
        drawCalls: render.drawCalls,
        triangles: render.triangles,
        points: render.points,
        staticRefreshes: staticRefreshTotal - previousStaticRefreshes,
        dynamicRefreshes: dynamicRefreshTotal - previousDynamicRefreshes,
        staticRefreshCpuMs: shadow?.lastStaticRefreshCpuMs ?? 0,
        visibleBundles: shadow?.staticCasterBundle?.visibleBundleCount ?? 0,
        visibleCasters: shadow?.staticCasterBundle?.visibleCasterCount ?? 0,
        renderCpuMs,
        pipelineBuilds: pipelineBuildBag.splice(0),
        systems,
      })
      previousStaticRefreshes = staticRefreshTotal
      previousDynamicRefreshes = dynamicRefreshTotal
      if (records.length % GPU_DRAIN_FRAMES === 0) void drainGpu()
    }
    systemBag.clear()
    pipelineBuildBag.length = 0

    if (tram.phase === 'dwell' && records.length > 0 && !finishing) {
      finishing = true
      void finish()
    }
  }

  // Warmup can nearly fill Three's 2048-query pool before BOARD. Drain it
  // now so the diagnostic itself cannot create arrival-time query pressure.
  if (gpuEnabled) void drainGpu()

  const finish = async (): Promise<void> => {
    if (resolvingGpu) await resolvingGpu
    await drainGpu()
    registry.onSystemTiming = previousSystemTiming
    loop.onFrameEnd = previousFrameEnd
    loop.renderFrame = previousRenderFrame
    backend.createProgram = previousCreateProgram
    backend.createRenderPipeline = previousCreateRenderPipeline

    const gpuRecords: GpuRecord[] = [...gpuByFrame]
      .map(([rendererFrame, value]) => ({ rendererFrame, ...value }))
      .sort((a, b) => a.rendererFrame - b.rendererFrame)
    const gpuLookup = new Map(gpuRecords.map((record) => [record.rendererFrame, record.gpuMs]))
    const ranked = [...records]
      .sort((a, b) => frameScore(b, gpuLookup.get(b.rendererFrame) ?? 0)
        - frameScore(a, gpuLookup.get(a.rendererFrame) ?? 0))
      .slice(0, MAX_SPIKE_DETAILS)
      .map((record) => ({
        ...record,
        gpuMs: gpuLookup.get(record.rendererFrame) ?? 0,
        systems: Object.fromEntries(
          Object.entries(record.systems)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([key, value]) => [key, rounded(value)]),
        ),
      }))
    const intervalValues = records.map((record) => record.intervalMs)
    const cpuValues = records.map((record) => record.cpuMs)
    const gpuValues = records
      .map((record) => gpuLookup.get(record.rendererFrame))
      .filter((value): value is number => value !== undefined)
    const samples = records.map((record) => [
      record.frame,
      record.rendererFrame,
      rounded(record.sim),
      rounded(record.arrivalS),
      rounded(record.remaining),
      rounded(record.speed),
      ...record.tram.map((value) => rounded(value)),
      rounded(record.intervalMs),
      rounded(record.cpuMs),
      rounded(gpuLookup.get(record.rendererFrame) ?? 0),
      record.drawCalls,
      record.triangles,
      record.points,
      record.staticRefreshes,
      record.dynamicRefreshes,
      rounded(record.staticRefreshCpuMs),
      record.visibleBundles,
      record.visibleCasters,
      rounded(record.renderCpuMs),
    ])
    const summary = {
      schema: [
        'frame', 'rendererFrame', 'sim', 'arrivalS', 'remaining', 'speed',
        'tramX', 'tramY', 'tramZ', 'intervalMs', 'cpuMs', 'gpuMs',
        'drawCalls', 'triangles', 'points', 'staticRefreshes',
        'dynamicRefreshes', 'staticRefreshCpuMs', 'visibleBundles', 'visibleCasters',
        'renderCpuMs',
      ],
      viewport: {
        css: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio,
        drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
        tier: ctx.quality.tier,
      },
      frames: records.length,
      intervalMs: {
        p50: rounded(quantile(intervalValues, 0.5)),
        p95: rounded(quantile(intervalValues, 0.95)),
        p99: rounded(quantile(intervalValues, 0.99)),
        max: rounded(Math.max(...intervalValues)),
      },
      cpuMs: {
        p50: rounded(quantile(cpuValues, 0.5)),
        p95: rounded(quantile(cpuValues, 0.95)),
        p99: rounded(quantile(cpuValues, 0.99)),
        max: rounded(Math.max(...cpuValues)),
      },
      gpuMs: {
        enabled: gpuEnabled,
        samples: gpuValues.length,
        p50: rounded(quantile(gpuValues, 0.5)),
        p95: rounded(quantile(gpuValues, 0.95)),
        p99: rounded(quantile(gpuValues, 0.99)),
        max: rounded(Math.max(0, ...gpuValues)),
      },
      systemTotals: Object.fromEntries(
        [...systemTotals]
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => [key, rounded(value)]),
      ),
      systemMax: Object.fromEntries(
        [...systemMax]
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => [key, rounded(value)]),
      ),
      spikes: ranked,
      samples,
    }
    document.getElementById(OUTPUT_ID)?.remove()
    const output = document.createElement('script')
    output.id = OUTPUT_ID
    output.type = 'application/json'
    output.textContent = JSON.stringify(summary)
    document.body.append(output)
    console.info(
      `[arrival-profile] complete: ${records.length} frames, `
      + `interval max ${summary.intervalMs.max} ms, CPU max ${summary.cpuMs.max} ms, `
      + `GPU max ${summary.gpuMs.max} ms`,
    )
  }
}
