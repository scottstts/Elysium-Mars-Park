import { NoToneMapping } from 'three'
import { WebGPURenderer } from 'three/webgpu'

/** True only when a real WebGPU adapter is obtainable — we never run WebGL. */
export async function webgpuAvailable(): Promise<boolean> {
  if (!('gpu' in navigator) || !navigator.gpu) return false
  try {
    return (await navigator.gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  trackTimestamp = false,
): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    canvas,
    // The scene pass owns 4x MSAA; multisampling the final fullscreen canvas
    // resolve would cost a second resolve without improving geometry edges.
    antialias: false,
    powerPreference: 'high-performance',
    trackTimestamp,
  })
  await renderer.init()

  // WebGPURenderer silently falls back to WebGL2 when WebGPU is missing.
  // This project is WebGPU-only: refuse the fallback outright.
  const backend = renderer.backend as { isWebGPUBackend?: boolean }
  if (backend.isWebGPUBackend !== true) {
    renderer.dispose()
    throw new Error('webgpu-backend-unavailable')
  }

  // Hidden panes/minimized windows report 0x0 at boot; a 0-sized canvas
  // makes an invalid swapchain. Start at 1x1 and let resize catch up. Commit
  // logical size + DPR atomically so large render-target graphs are not
  // reallocated once for setPixelRatio() and again for setSize().
  const width = Math.max(1, window.innerWidth)
  const height = Math.max(1, window.innerHeight)
  renderer.setDrawingBufferSize(width, height, recommendedPixelRatio(width, height))
  // Never tone-map at the renderer — the pipeline's explicit renderOutput()
  // is the single output transform (side targets must stay linear).
  renderer.toneMapping = NoToneMapping
  renderer.shadowMap.enabled = true
  return renderer
}

/** AGENTS.md DPR policy: cap DPR and total drawing-buffer pixels. */
export function recommendedPixelRatio(
  width = window.innerWidth,
  height = window.innerHeight,
): number {
  const maxPixels = 4_000_000
  const dpr = Math.min(
    window.devicePixelRatio,
    1.7,
    Math.sqrt(maxPixels / Math.max(1, width * height)),
  )
  // Do not floor at DPR 1: on a CSS viewport larger than maxPixels (common
  // on 4K Windows desktops at 100% scaling), doing so defeats the pixel cap.
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1
}
