/**
 * Deterministic seeded PRNG (mulberry32). All world generation flows from
 * one of these — `Math.random()` and `Date.now()` are banned in world gen
 * so the same seed always builds the identical park.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) this.state = 0x9e3779b9
  }

  /** Uniform float in [0, 1). */
  float(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float()
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1))
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.float() * items.length))]
  }

  /** Random sign, ±1. */
  sign(): number {
    return this.float() < 0.5 ? -1 : 1
  }

  /**
   * Stable child stream: the same parent seed + label always produces the
   * same fork, so adding a new consumer never reshuffles existing content.
   */
  fork(label: string): Rng {
    let hash = 0x811c9dc5
    for (let i = 0; i < label.length; i++) {
      hash ^= label.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return new Rng((hash ^ Math.imul(this.state, 0x85ebca6b)) >>> 0)
  }
}
