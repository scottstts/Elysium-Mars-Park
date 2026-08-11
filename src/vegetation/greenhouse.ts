import { AdditiveBlending, Color, Sprite, Vector3 } from 'three'
import type { InstancedMesh, Object3D } from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import { float, mix, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl'
import type { Rng } from '../core/prng'
import {
  CROP_TRAY_SURFACES,
  CROP_TRAY_TIER_PITCH,
  MIST_NOZZLES,
} from '../world/districts/farmside'
import { HYDRO_SHELVES } from '../world/districts/hydroTower'
import { createFoliageMaterial, floatAttribute, instanceSeed } from './foliageMaterial'
import { cropHeadTexture, seedlingTexture } from './leafTextures'
import { buildPlant, cropHead, SpeciesInstances } from './species'

/**
 * FARMSIDE + HYDROPONICS — the working green, as opposed to the ornamental
 * green in the planters. Two things distinguish it and both are story:
 *
 *   • **Growth stages.** A working range is never uniform. Trays are assigned
 *     a stage from their own (house, rack, tier) index, so one bench carries
 *     seedlings while the one above it is ready to cut.
 *   • **A harvested run.** Exactly one tray has a cleared section with the
 *     stumps still in it. It is the difference between a farm and a display.
 *
 * `world/districts/farmside.ts` publishes `CROP_TRAY_SURFACES` (one entry per
 * individual tray, world space) — this module never re-derives rack geometry.
 */

/** Growth stages, cycled deterministically per tray. */
type Stage = 'seedling' | 'young' | 'mature' | 'chard'

const STAGE_ORDER: Stage[] = ['mature', 'young', 'chard', 'mature', 'seedling', 'chard', 'young', 'mature']

export interface CropStats {
  trays: number
  heads: number
  harvestedTray: string
  hydroRuns: number
}

export class GreenhouseCrops {
  readonly mature: SpeciesInstances
  readonly chard: SpeciesInstances
  readonly seedling: SpeciesInstances

  constructor() {
    const headGeometry = buildPlant(cropHead(3, 0.24))
    const seedTray = buildPlant(cropHead(2, 0.1))

    const common = {
      seed: instanceSeed(),
      depth: floatAttribute('aDepth'),
      // Under grow bars, not the sun: these read cooler and flatter than the
      // planter species, which is what makes the glasshouses feel artificial.
      tintCool: new Color(0.74, 0.86, 0.74),
      tintWarm: new Color(1.08, 1.1, 0.88),
      transmit: new Color(0.34, 0.54, 0.18),
      backlight: 0.6,
      sway: 0.008,
      alphaTest: 0.34,
      far: 26,
    }

    this.mature = new SpeciesInstances(
      'crop-leaf',
      headGeometry,
      createFoliageMaterial({ ...common, map: cropHeadTexture(37, false) }),
      false,
    )
    this.chard = new SpeciesInstances(
      'crop-chard',
      headGeometry,
      createFoliageMaterial({ ...common, map: cropHeadTexture(61, true) }),
      false,
    )
    this.seedling = new SpeciesInstances(
      'crop-seedling',
      seedTray,
      createFoliageMaterial({ ...common, map: seedlingTexture(), alphaTest: 0.28, far: 18 }),
      false,
    )
  }

  all(): SpeciesInstances[] {
    return [this.mature, this.chard, this.seedling]
  }

  meshes(): InstancedMesh[] {
    const out: InstancedMesh[] = []
    for (const species of this.all()) {
      const mesh = species.build()
      if (mesh) out.push(mesh)
    }
    return out
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const species of this.all()) out[species.name] = species.count
    return out
  }
}

export function plantGreenhouses(crops: GreenhouseCrops, rng: Rng): CropStats {
  let heads = 0
  // One tray, somewhere in the middle of the walkable range, has been cut.
  const harvestIndex = Math.max(
    0,
    Math.min(CROP_TRAY_SURFACES.length - 1, Math.floor(CROP_TRAY_SURFACES.length * 0.45)),
  )
  const harvestFrom = rng.range(0.18, 0.34)
  const harvestTo = harvestFrom + rng.range(0.2, 0.3)

  CROP_TRAY_SURFACES.forEach((tray, index) => {
    const stage = STAGE_ORDER[index % STAGE_ORDER.length]
    const [tx, ty, tz] = tray.position
    const along = new Vector3(Math.sin(tray.yaw), 0, Math.cos(tray.yaw))
    const across = new Vector3(Math.cos(tray.yaw), 0, -Math.sin(tray.yaw))
    const pitch = stage === 'seedling' ? 0.15 : 0.3
    const rows = Math.max(1, Math.floor(tray.length / pitch))
    // Two planting lines across the tray for the mature stages, four for
    // seedlings — a propagation tray is always denser than a finishing one.
    const lines = stage === 'seedling' ? [-0.36, -0.12, 0.12, 0.36] : [-0.26, 0.26]
    const species =
      stage === 'seedling' ? crops.seedling : stage === 'chard' ? crops.chard : crops.mature
    const scaleBase = stage === 'young' ? 0.6 : stage === 'seedling' ? 1 : 0.95

    for (let row = 0; row < rows; row++) {
      const t = (row + 0.5) / rows
      if (index === harvestIndex && t > harvestFrom && t < harvestTo) {
        // Cut. Leave a stump every third station so the gap reads as work
        // done rather than as a hole in the placement code.
        if (row % 3 === 0) {
          const offset = -tray.length / 2 + t * tray.length
          for (const lateral of lines) {
            const position = new Vector3(tx, ty, tz)
              .addScaledVector(along, offset)
              .addScaledVector(across, lateral * tray.width)
            crops.mature.add(position, rng.range(0, Math.PI * 2), rng.range(0.16, 0.24))
            heads++
          }
        }
        continue
      }
      const offset = -tray.length / 2 + t * tray.length + rng.range(-0.02, 0.02)
      for (const lateral of lines) {
        const position = new Vector3(tx, ty, tz)
          .addScaledVector(along, offset)
          .addScaledVector(across, lateral * tray.width + rng.range(-0.015, 0.015))
        species.add(
          position,
          rng.range(0, Math.PI * 2),
          scaleBase * rng.range(0.82, 1.18),
          rng.range(-0.07, 0.07),
          rng.range(-0.07, 0.07),
        )
        heads++
      }
    }
  })

  // ── Hydroponics tower: a light densifying pass only. hydroTower.ts states
  // it already builds baseline planting on these runs, so this adds a front
  // row on alternate tiers rather than a second full crop.
  let hydroRuns = 0
  for (const run of HYDRO_SHELVES) {
    const [rx, ry, rz] = run.position
    const along = new Vector3(Math.sin(run.yaw), 0, Math.cos(run.yaw))
    const count = Math.max(2, Math.floor(run.width / 0.55))
    for (let tier = 0; tier < run.tiers; tier += 2) {
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5
        const position = new Vector3(rx, ry + tier * CROP_TRAY_TIER_PITCH + 0.02, rz).addScaledVector(
          along,
          t * run.width * 0.86,
        )
        crops.mature.add(position, rng.range(0, Math.PI * 2), rng.range(0.55, 0.8))
        heads++
      }
    }
    hydroRuns++
  }

  return {
    trays: CROP_TRAY_SURFACES.length,
    heads,
    harvestedTray: `surface-${harvestIndex}`,
    hydroRuns,
  }
}

/**
 * The misting cycle. Kept as sprites deliberately — the puffs are seen
 * against dark trays through diffusing glazing, where a billboard is exactly
 * right and a volumetric would be a hundred times the cost for nothing.
 *
 * TWO things here are load-bearing and were learned the hard way:
 *   • A bare `SpriteNodeMaterial` is a hard translucent SQUARE. The radial
 *     `smoothstep` opacity falloff is not decoration (notes.md S14).
 *   • The per-sprite phase is a UNIFORM, not a baked constant. Twenty
 *     structurally identical graphs share ONE compiled program; twenty graphs
 *     with different literals compile twenty times at boot.
 */
/** Burst window inside the 90 s cycle, and its fade shoulders (seconds). */
const MIST_PERIOD = 90
const MIST_BURST = 10
const MIST_FADE_IN = 2.5
const MIST_FADE_OUT = 3.5

const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export class MistSystem {
  private readonly sprites: Sprite[] = []
  private readonly phases: Array<{ node: ReturnType<typeof uniform>; seed: number; baseY: number }> = []
  private readonly life = uniform(0)
  /**
   * ONE envelope uniform shared by every puff's material. The burst used to
   * switch `sprite.visible`, which is a hard on/off at full opacity — the
   * mist snapped into and out of existence mid-room. The per-puff `life`
   * fade stays exactly as it was; this multiplies the whole valve on top of
   * it, so a burst opens and closes like a valve instead of a light switch.
   */
  private readonly env = uniform(0)

  constructor() {
    MIST_NOZZLES.forEach((nozzle, index) => {
      const seed = (index * 0.37) % 1
      const seedUniform = uniform(seed)
      const material = new SpriteNodeMaterial()
      material.transparent = true
      material.depthWrite = false
      material.blending = AdditiveBlending
      const life = this.life.add(seedUniform).fract()
      material.colorNode = mix(vec3(0.62, 0.68, 0.66), vec3(0.36, 0.4, 0.39), life)
      // Radial falloff — without it every puff is a translucent square.
      const radial = smoothstep(0.5, 0.12, uv().sub(vec2(0.5)).length())
      material.opacityNode = float(0.3)
        .mul(float(1).sub(life))
        .mul(life.mul(5).min(1))
        .mul(radial)
        .mul(this.env)

      const sprite = new Sprite(material)
      // Puffs fall from the nozzle mouth toward the trays.
      sprite.position.set(nozzle[0], nozzle[1], nozzle[2])
      sprite.scale.setScalar(2.1)
      sprite.visible = false
      // The glazing is `transparent` with `depthWrite: false` at renderOrder
      // 12, so at the default order the panes composited OVER the puffs — the
      // mist was attenuated by glass BEHIND it whenever the camera was inside
      // the house, and not attenuated at all once you stepped through the
      // door. Additive mist drawn last is continuous on both sides of the
      // glazing, which is what the doorway walk-through has to look like.
      sprite.renderOrder = 13
      this.sprites.push(sprite)
      this.phases.push({ node: seedUniform, seed, baseY: nozzle[1] })
    })
  }

  objects(): Object3D[] {
    return this.sprites
  }

  /** Burst 10 s in every 90 s of park time — the window audio syncs against. */
  update(simTime: number): void {
    const t = ((simTime % MIST_PERIOD) + MIST_PERIOD) % MIST_PERIOD
    const envelope =
      smootherstep(0, MIST_FADE_IN, t) * (1 - smootherstep(MIST_BURST - MIST_FADE_OUT, MIST_BURST, t))
    this.env.value = envelope
    this.life.value = (simTime * 0.22) % 1
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i]
      // Culled only where the envelope is genuinely zero, and the positions
      // keep advancing regardless so a burst never opens on a stale frame.
      sprite.visible = envelope > 0.002
      const phase = this.phases[i]
      const life = ((this.life.value as number) + phase.seed) % 1
      // The puff sinks and spreads: it is being sprayed DOWN onto a bench.
      sprite.position.y = phase.baseY - life * 1.5
      sprite.scale.setScalar(0.8 + life * 2.6)
    }
  }
}
