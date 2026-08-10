import { Color, Group, PointLight, SpotLight } from 'three'
import type { Object3D } from 'three'
import type { GameContext } from '../runtime/context'
import {
  COMMONS,
  FARMSIDE,
  FIRST_TREE,
  HYDRO_TOWER,
  OVERLOOK_LOUNGE,
  PORTAL_STATION,
} from './parkPlan'

/**
 * THE ARTIFICIAL LIGHT LAYER (overhaul W1-light).
 *
 * The reference image is lit twice: a low warm sun, and a whole second layer
 * of made light — backlit signage, recessed floor lenses, interior spill
 * through glazing, small cool utility lamps. In a WebGPU FORWARD renderer
 * every real light is paid for by every fragment of every lit material, so
 * the layer is built from two very different mechanisms and they are not
 * interchangeable:
 *
 *  1. EMISSIVE GEOMETRY + HDR BLOOM carries the *appearance* of light. It is
 *     free (one more material term), scales to hundreds of fixtures, and is
 *     what the eye actually reads as "that sign is lit". Every fixture in the
 *     park uses this. Slots live in `materials/library.ts` (see the ladder
 *     below) so the whole park shares one calibrated HDR hierarchy.
 *  2. REAL LIGHTS carry *illumination* — the warm pool on the paving, the
 *     falloff up a wall, the shape of a canopy. They are rationed. A hard
 *     budget is enforced here because "one more light" is the classic way a
 *     forward scene silently loses half its frame rate.
 *
 * Two disciplines, both non-negotiable:
 *  - NEVER toggle a Light's `visible` (or add/remove one after boot). That
 *    changes the LightsNode cache key and synchronously rebuilds every lit
 *    WGSL program in the park. Drive `intensity` to zero instead —
 *    `setIntensity()` below is the only supported mutation.
 *  - Real lights NEVER cast shadows. The one shadow-casting light in this
 *    game is the sun (cached clipmaps + the analytic lattice net).
 */

/** Hard cap on simultaneous real lights. Raising this needs a perf pass. */
export const REAL_LIGHT_BUDGET = 8

/**
 * Emissive slot conventions — the contract W2 agents build against.
 *
 * These names index `kitMaterials()`. The numbers are the authored HDR
 * emissive multipliers baked into those materials; they are listed here
 * because the BLOOM THRESHOLD (1.0, see render/pipeline.ts) sits between the
 * brightest ordinary lit surface and the dimmest emitter, and the ladder only
 * means something as a whole:
 *
 *   sun disc                 1800     (sky radiance; the only true HDR source)
 *   sunlit specular glints   1.2–30   (material response, not authored here)
 *   utilityLight             5.0      small cool-white lamps, points of light
 *   signageGlow              3.4      backlit white sign faces
 *   runningLight             3.2      tube/vehicle guidance strips (existing)
 *   floorLens                2.6      recessed floor + kerb light lenses
 *   growBar                  2.6      horticultural bars (existing)
 *   interiorGlow             2.0      warm room light seen through glazing
 *   --- bloom threshold      1.0 ---
 *   brightest lit surface    ~0.9     white steel in full sun
 *
 * Rules for W2:
 *  - Pick the slot by ROLE, never by "how bright I want it here". Scale the
 *    AREA of the emissive surface, not the multiplier — a bigger lens reads
 *    brighter and stays inside the ladder.
 *  - Emissive faces are geometry, not decals: give a lens a real recess and a
 *    bezel, or it reads as paint.
 *  - Anything that must also *illuminate* its surroundings needs a real light
 *    — call `registerRealLight()` and check the return value.
 */
export const EMISSIVE_SLOTS = [
  'signageGlow',
  'floorLens',
  'interiorGlow',
  'utilityLight',
] as const

export type EmissiveSlot = (typeof EMISSIVE_SLOTS)[number]

/** A group of emissive-only fixtures. Bookkeeping + audit, no scene cost. */
export interface GlowPoolSpec {
  id: string
  slot: EmissiveSlot
  /** How many discrete emissive faces the pool contains. */
  count: number
  /** Representative world position (used by the audit and by tooling). */
  position: [number, number, number]
}

export interface RealLightSpec {
  id: string
  position: [number, number, number]
  /** Linear-sRGB fixture colour. */
  color: number
  /**
   * Candela-ish. Local irradiance is `intensity / d²`, so a fixture 5 m above
   * the paving at intensity 25 lands ≈ 1.0 — about a third of the 3.15 sun.
   */
  intensity: number
  /** Hard cutoff radius (m). Keep tight: it bounds the per-fragment cost. */
  range: number
  /**
   * Optional downlight cone. `target` is a world point; a canopy or eave
   * fixture should always be a cone so its light does not wash the sky side
   * of everything within `range`.
   */
  cone?: { angle: number; penumbra: number; target: [number, number, number] }
}

interface RegisteredLight {
  spec: RealLightSpec
  light: PointLight | SpotLight
}

/**
 * The park's light rig. One instance, created by SkySystem (the lighting
 * owner) before any district builds, so district `init()` can register.
 */
export class LightFixtureRig {
  readonly group = new Group()

  private readonly lights = new Map<string, RegisteredLight>()
  private readonly pools: GlowPoolSpec[] = []

  constructor() {
    this.group.name = 'light-fixtures'
  }

  /**
   * Declare a pool of emissive-only fixtures. Costs nothing at runtime; it
   * exists so the artificial layer can be audited (`snapshot()`) and so a
   * later pass can promote the few pools that deserve a real light.
   */
  registerGlowPool(spec: GlowPoolSpec): void {
    this.pools.push(spec)
  }

  /**
   * Ask for one of the scarce real lights. Returns the light when the budget
   * allowed it and `null` when it did not — callers MUST tolerate null and
   * fall back to emissive-only. Duplicate ids are a programming error.
   */
  registerRealLight(spec: RealLightSpec): PointLight | SpotLight | null {
    if (this.lights.has(spec.id)) {
      throw new Error(`Duplicate real light id: ${spec.id}`)
    }
    if (this.lights.size >= REAL_LIGHT_BUDGET) return null

    const color = new Color(spec.color)
    const [x, y, z] = spec.position
    let light: PointLight | SpotLight
    if (spec.cone) {
      const spot = new SpotLight(color, spec.intensity, spec.range, spec.cone.angle, spec.cone.penumbra, 2)
      spot.target.position.set(...spec.cone.target)
      this.group.add(spot.target)
      light = spot
    } else {
      light = new PointLight(color, spec.intensity, spec.range, 2)
    }
    light.position.set(x, y, z)
    // The sun is the only shadow caster in this game (cached clipmaps + the
    // analytic lattice net). A second shadow-casting light would double every
    // caster's cost for a pool of light nobody looks at the edge of.
    light.castShadow = false
    light.name = `fixture:${spec.id}`
    this.group.add(light)
    this.lights.set(spec.id, { spec, light })
    return light
  }

  /**
   * The ONLY supported way to change a fixture. Never touch `.visible`: it
   * changes the LightsNode cache key and rebuilds every lit shader in the
   * park on the frame it happens.
   */
  setIntensity(id: string, intensity: number): void {
    const entry = this.lights.get(id)
    if (entry) entry.light.intensity = Math.max(0, intensity)
  }

  /** Remaining real-light slots. Check before designing around a light. */
  get remainingBudget(): number {
    return REAL_LIGHT_BUDGET - this.lights.size
  }

  snapshot(): {
    realLights: Array<{ id: string; intensity: number; range: number }>
    budget: { used: number; total: number }
    glowPools: Array<{ id: string; slot: EmissiveSlot; count: number }>
    glowFaces: number
  } {
    return {
      realLights: [...this.lights.values()].map(({ spec, light }) => ({
        id: spec.id,
        intensity: light.intensity,
        range: spec.range,
      })),
      budget: { used: this.lights.size, total: REAL_LIGHT_BUDGET },
      glowPools: this.pools.map(({ id, slot, count }) => ({ id, slot, count })),
      glowFaces: this.pools.reduce((sum, pool) => sum + pool.count, 0),
    }
  }

  dispose(parent: Object3D): void {
    for (const { light } of this.lights.values()) light.dispose()
    this.lights.clear()
    this.pools.length = 0
    parent.remove(this.group)
    this.group.clear()
  }
}

let rig: LightFixtureRig | null = null

/**
 * The rig, for any system that wants to register a fixture. Available from
 * the moment SkySystem has initialized — i.e. inside every other system's
 * `init()`, because SkySystem is registered first.
 */
export function lightFixtures(): LightFixtureRig {
  if (!rig) rig = new LightFixtureRig()
  return rig
}

/**
 * Create the rig, attach it to the scene, and spend the opening real-light
 * budget on the four pools the reference image makes unmissable: the station
 * canopy, the plaza around the First Tree, the Commons entry, and the
 * greenhouse spill (hydroponics tower + farmside glasshouse row). Two slots
 * are deliberately left for W2 districts.
 *
 * Positions come from `parkPlan.ts` — never hardcode a placement here, or the
 * light and the building it belongs to will drift apart.
 */
export function installLightFixtures(ctx: GameContext): LightFixtureRig {
  const fixtures = lightFixtures()
  ctx.scene.add(fixtures.group)

  // Station canopy: a cone, not a point — a canopy fixture that also lights
  // the platform's sky side reads like a floating bulb.
  fixtures.registerRealLight({
    id: 'portal-canopy',
    position: [PORTAL_STATION.x, PORTAL_STATION.y + 4.6, PORTAL_STATION.z],
    color: 0xffcf9c,
    intensity: 34,
    range: 30,
    cone: {
      angle: 1.05,
      penumbra: 0.75,
      target: [PORTAL_STATION.x, PORTAL_STATION.y, PORTAL_STATION.z - 1.5],
    },
  })

  // Plaza: the warm pool the First Tree stands in. Deliberately OFF-CENTRE
  // and inside the soil ring — dead centre puts the source inside the trunk,
  // and with no shadow casting it would light the trunk's far side through
  // the wood. Low, so the canopy underside catches it and the pool on the
  // paving has a wide soft falloff rather than a hard disc.
  fixtures.registerRealLight({
    id: 'plaza-ring',
    position: [FIRST_TREE.x + 3.2, 4.0, FIRST_TREE.z + 3.2],
    color: 0xffc596,
    intensity: 15,
    range: 32,
  })

  // Commons entry: interior spill through the drum's south glazing, aimed
  // out across the plaza approach.
  fixtures.registerRealLight({
    id: 'commons-entry',
    position: [COMMONS.x, COMMONS.y + 3.6, COMMONS.z + COMMONS.radius + 1.2],
    color: 0xffd6ab,
    intensity: 34,
    range: 26,
  })

  // Hydroponics tower: the "62" building's shelf glow — cool green-white,
  // deliberately the odd colour out so the farm lane reads as a different
  // kind of light from the civic warm.
  fixtures.registerRealLight({
    id: 'hydro-tower-spill',
    position: [HYDRO_TOWER.x, HYDRO_TOWER.y + 5.4, HYDRO_TOWER.z],
    color: 0xd6ffdd,
    intensity: 30,
    range: 24,
  })

  // Farmside glasshouse row: grow-light wash over the middle house.
  const middleHouse = FARMSIDE.glasshouses[1]
  fixtures.registerRealLight({
    id: 'farmside-spill',
    position: [middleHouse.x, 4.2, middleHouse.z],
    color: 0xe6ffd2,
    intensity: 26,
    range: 28,
  })

  // Overlook Lounge: the west rim's warm window, the one made light visible
  // against the mountains in the `rim` postcard.
  fixtures.registerRealLight({
    id: 'overlook-lounge',
    position: [OVERLOOK_LOUNGE.x + 3.5, OVERLOOK_LOUNGE.y + 3.0, OVERLOOK_LOUNGE.z],
    color: 0xffcc96,
    intensity: 22,
    range: 20,
  })

  return fixtures
}
