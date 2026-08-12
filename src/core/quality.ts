export interface QualityParams {
  /** Volumetric shaft march steps. */
  shaftSteps: number
  /** GTAO resolution divisor (2 = half res). */
  aoDivisor: number
  /** Exterior full-detail radius (m). */
  exteriorDetailRadius: number
  /** Scatter density multiplier for instanced dressing. */
  scatterDensity: number
  /** Dynamic resolution floor. */
  minRenderScale: number
  /** Cached shadow clipmap level sizes, finest → coarsest. */
  shadowMapSizes: readonly number[]
}

const TIERS: readonly QualityParams[] = [
  {
    shaftSteps: 12,
    aoDivisor: 2,
    exteriorDetailRadius: 900,
    scatterDensity: 0.55,
    minRenderScale: 0.7,
    shadowMapSizes: [2048, 2048, 2048, 1536],
  },
  {
    shaftSteps: 20,
    aoDivisor: 2,
    exteriorDetailRadius: 1600,
    scatterDensity: 0.8,
    minRenderScale: 0.8,
    shadowMapSizes: [3072, 3072, 2048, 2048],
  },
  {
    shaftSteps: 28,
    aoDivisor: 2,
    exteriorDetailRadius: 2600,
    scatterDensity: 1,
    minRenderScale: 0.85,
    shadowMapSizes: [4096, 4096, 3072, 2048],
  },
]

/**
 * Quality tier + dynamic render scale. Tier is fixed at boot (auto-bench in
 * S14, ?tier override); render scale adjusts gently against frame pacing.
 */
export class QualityState {
  tier: number
  renderScale = 1

  private readonly recent = new Float64Array(120)
  private recentCount = 0
  private recentCursor = 0

  constructor(tier: number) {
    this.tier = Math.max(0, Math.min(2, tier))
  }

  get params(): QualityParams {
    return TIERS[this.tier]
  }

  /** Called once per frame with the presented frame interval. */
  submitFrame(frameIntervalMs: number): void {
    this.recent[this.recentCursor] = frameIntervalMs
    this.recentCursor = (this.recentCursor + 1) % this.recent.length
    this.recentCount = Math.min(this.recent.length, this.recentCount + 1)
  }

  /** Rolling median frame interval (ms) for auto-tuning decisions. */
  medianFrameMs(): number {
    if (this.recentCount === 0) return 16.6
    const sorted = Array.from(this.recent.subarray(0, this.recentCount)).sort((a, b) => a - b)
    return sorted[sorted.length >> 1]
  }
}
