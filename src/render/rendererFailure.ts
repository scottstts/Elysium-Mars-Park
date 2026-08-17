import type { WebGPURenderer } from 'three/webgpu'

export interface RendererFailure {
  kind: 'device-lost' | 'gpu-error'
  api: string
  type: string
  message: string
  /** Validation errors can be diagnostic; loss/OOM/internal errors are fatal. */
  fatal: boolean
}

interface RendererFailureInfo {
  api?: string
  type?: string
  reason?: string
  message?: string
  error?: { message?: string }
}

interface RendererFailureHooks {
  onDeviceLost?: (info: RendererFailureInfo) => void
  onError?: (info: RendererFailureInfo) => void
}

/**
 * Preserve Three's own logging/device-lost bookkeeping, then surface enough
 * structured information for the app to turn remote Windows failures into an
 * actionable loading/runtime error instead of a frozen canvas.
 */
export function installRendererFailureHandlers(
  renderer: WebGPURenderer,
  onFailure: (failure: RendererFailure) => void,
): void {
  const hooks = renderer as unknown as RendererFailureHooks
  const defaultDeviceLost = hooks.onDeviceLost?.bind(renderer)
  const defaultError = hooks.onError?.bind(renderer)

  hooks.onDeviceLost = (info) => {
    defaultDeviceLost?.(info)
    onFailure({
      kind: 'device-lost',
      api: info.api ?? 'WebGPU',
      type: info.reason ?? info.type ?? 'unknown',
      message: info.message ?? info.error?.message ?? 'The WebGPU device was lost.',
      fatal: true,
    })
  }

  hooks.onError = (info) => {
    defaultError?.(info)
    const type = info.type ?? 'unknown'
    const message = info.message ?? info.error?.message ?? 'Uncaptured WebGPU error.'
    const fatal = /out.?of.?memory|internal|device.?lost/i.test(`${type} ${message}`)
    onFailure({
      kind: 'gpu-error',
      api: info.api ?? 'WebGPU',
      type,
      message,
      fatal,
    })
  }
}
