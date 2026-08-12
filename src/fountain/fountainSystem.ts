import { Group, Vector3 } from 'three'
import { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import type { PhysicsSystem } from '../physics/physicsWorld'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { interiorHeight } from '../world/interiorHeight'
import { FOUNTAIN } from '../world/parkPlan'
import { fountainMaterials } from './fountainMaterials'
import {
  BASIN_INNER_R,
  BAY_HALF_ANGLE,
  BAY_RAMP,
  BAY_SWELL,
  COPING_TOP_Y,
  LOWER_TAZZA,
  MAIN_CURTAIN_LAND_R,
  PLANTER_BAYS,
  PODIUM_Y,
  STYLOBATE_STEPS,
  UPPER_TAZZA,
  WALL_THICKNESS,
  WATER_Y,
} from './fountainPlan'
import { buildFountainStone } from './fountainStone'
import { buildFountainVortices } from './fountainVortices'
import { wanderRadial } from './waterDroplets'
import { fountainTime } from './waterField'
import { FountainWaterSim } from './waterSim'
import { buildFountainStreams } from './waterStreams'
import type { ImpactSource } from './waterStreams'
import { fountainWaterMesh, tazzaWaterMesh } from './waterSurface'

/**
 * THE FOUNTAIN — assembly and clock.
 *
 * The system itself is deliberately thin: it resolves the ONE datum every
 * other module is authored against (the court's paved top under the axis),
 * builds the five layers, installs the colliders, and drives the clock and
 * the basin simulation. Everything with an opinion lives in its own module.
 *
 * Layers, in the order they are added:
 *   `fountainStone`    stylobate, coping, basin floor, island, tazze, bronze
 *   `fountainVortices` the four petrified dust devils carrying the bowl
 *   `waterSurface`     the basin's ray-traced volume + the two dish surfaces
 *   `waterStreams`     the flight solves and the short COHERENT cores
 *   `waterDroplets`    every disconnected parcel, as a real projectile
 *   `waterSim`         the basin heightfield the surface reads
 *
 * ## The clock
 *
 * `fountainTime` follows `ctx.time.sim`, the accumulated fixed-step park
 * clock, NOT TSL's global `time`. Two consequences that both matter: the water
 * freezes with the pause card instead of running behind it, and two sessions
 * with the same seed show the same wave at the same tick — which is what makes
 * a fixed validation camera a usable regression surface for this feature.
 *
 * ## The impact sampler
 *
 * The sim is forced by discrete impact events, sampled here on the CPU from
 * the stream module's source descriptions: each fixed step draws a handful of
 * landing points — on the wandered landing rings, with the same aim-wander
 * function the droplet shader evaluates — and pushes them as drops. No GPU
 * readback anywhere: the shader and the sampler agree because they share the
 * numbers, not because one reads the other.
 */
export class FountainSystem implements GameSystem {
  readonly id = 'fountain'
  private readonly group = new Group()
  private readonly physics: PhysicsSystem
  private sim: FountainWaterSim | null = null
  private sources: ImpactSource[] = []
  private accumulators: number[] = []
  private rng: Rng | null = null
  private pendingSteps = 0
  /** Extra sim steps on early frames, so the pool is already alive when the
   * player first sees it (5 s of waves, spread invisibly over ~1 s). */
  private warmup = 300

  constructor(physics: PhysicsSystem) {
    this.physics = physics
  }

  init(ctx: GameContext): void {
    this.group.name = 'fountain'
    // THE datum. Every height in `fountainPlan` is local to this point, and
    // nothing else in the feature calls `interiorHeight` — the fountain court
    // is a flat pad, so one sample is the whole ground truth.
    const center = new Vector3(FOUNTAIN.x, interiorHeight(FOUNTAIN.x, FOUNTAIN.z), FOUNTAIN.z)

    const writer = new PartWriter()
    buildFountainStone(writer, center)
    buildFountainVortices(writer, center)
    const materials = fountainMaterials({
      waterWorldY: center.y + WATER_Y,
      landRadius: MAIN_CURTAIN_LAND_R,
      center: { x: center.x, z: center.z },
    })
    const stone = writer.build(materials, { castShadow: true })
    stone.name = 'fountain-stone'
    this.group.add(stone)

    // The basin simulation — built first, because the surface material closes
    // over its texture nodes.
    this.sim = new FountainWaterSim()

    // Water. The basin's surface is opaque (it computes its own volume), so it
    // sits in the normal depth-sorted pass; everything else here is
    // transparent and renders after it by renderOrder.
    this.group.add(fountainWaterMesh({ center, sim: this.sim }))
    this.group.add(tazzaWaterMesh(center, LOWER_TAZZA))
    this.group.add(tazzaWaterMesh(center, UPPER_TAZZA))

    const streams = buildFountainStreams(center)
    for (const mesh of streams.meshes) this.group.add(mesh)
    this.sources = streams.sources
    this.accumulators = this.sources.map(() => 0)
    this.rng = ctx.rng.fork('fountain-impacts')

    this.installColliders(center)
    ctx.scene.add(this.group)

    if (ctx.flags.debug) {
      let triangles = 0
      this.group.traverse((node) => {
        const geometry = (node as { geometry?: { index?: { count: number } | null } }).geometry
        if (geometry?.index) triangles += geometry.index.count / 3
      })
      console.info('[fountain]', {
        courtY: Number(center.y.toFixed(3)),
        waterY: Number((center.y + WATER_Y).toFixed(3)),
        crownY: Number((center.y + UPPER_TAZZA.rimTopY).toFixed(2)),
        impacts: streams.impacts.length,
        triangles: Math.round(triangles),
      })
    }
  }

  /**
   * Colliders: three concentric cylinders (the two steps and the coping wall)
   * plus one box per planter bay.
   *
   * The steps are walkable — the character controller autosteps 0.42 m, so a
   * 155 mm riser is climbed, not blocked — and the coping cylinder stops the
   * player at the water. The bays swell past the wall's cylinder, so they get
   * their own boxes; without them a guest walks bodily through a planter,
   * which is the exact defect class the park's prop-overlap audit exists for.
   */
  private installColliders(center: Vector3): void {
    const world = this.physics.world
    const api = this.physics.api
    if (!world || !api) return
    const body = world.createRigidBody(api.RigidBodyDesc.fixed())

    const cylinder = (radius: number, top: number): void => {
      const bottom = -0.6
      const halfHeight = (top - bottom) / 2
      world.createCollider(
        api.ColliderDesc.cylinder(halfHeight, radius).setTranslation(
          center.x,
          center.y + bottom + halfHeight,
          center.z,
        ),
        body,
      )
    }
    for (const step of STYLOBATE_STEPS) cylinder(step.radius, step.top)
    cylinder(BASIN_INNER_R + WALL_THICKNESS, COPING_TOP_Y)
    // The KEEP-OUT barrier. The coping cylinder alone stops a walker (its
    // 0.525 m rise beats the 0.42 m autostep) but not a 0.38 g JUMPER — a
    // floaty lope clears the seat height easily, and the solid stack under
    // it would then let a guest stroll across the pool a hand above the
    // water. This inner cylinder rises to 3.4 m — beyond any reach the
    // park's gravity grants from the coping — at the coping's INNER lip, so
    // sitting on the rim still works and crossing it never does. Circular by
    // construction, like everything else here.
    cylinder(BASIN_INNER_R + 0.08, 3.4)

    for (let b = 0; b < PLANTER_BAYS; b++) {
      const theta = (b / PLANTER_BAYS) * Math.PI * 2
      const rMid = BASIN_INNER_R + WALL_THICKNESS + BAY_SWELL * 0.5
      const halfArc = BAY_HALF_ANGLE + BAY_RAMP * 0.6
      const halfDepth = BAY_SWELL * 0.5 + 0.06
      const halfWidth = Math.sin(halfArc) * (rMid + halfDepth)
      const top = center.y + COPING_TOP_Y
      const bottom = center.y + PODIUM_Y - 0.2
      const half = (top - bottom) / 2
      world.createCollider(
        api.ColliderDesc.cuboid(halfDepth, half, halfWidth)
          // The box's local X is radial, so the yaw that aligns it with the
          // bay is the bearing negated (the park's Y-up yaw convention runs
          // clockwise seen from above — see kit.ts).
          .setTranslation(
            center.x + Math.cos(theta) * rMid,
            bottom + half,
            center.z + Math.sin(theta) * rMid,
          )
          .setRotation({ x: 0, y: Math.sin(-theta / 2), z: 0, w: Math.cos(-theta / 2) }),
        body,
      )
    }
  }

  fixedUpdate(ctx: GameContext, _dt: number): void {
    fountainTime.value = ctx.time.sim
    this.pendingSteps++
    this.sampleImpacts(ctx.time.sim)
  }

  /**
   * One fixed step's worth of landing events, pushed as sim drops. Fractional
   * per-step rates accumulate, so a source owed 0.4 events a step fires every
   * 2–3 steps rather than never.
   */
  private sampleImpacts(simTime: number): void {
    const sim = this.sim
    const rng = this.rng
    if (!sim || !rng) return
    for (let i = 0; i < this.sources.length; i++) {
      const source = this.sources[i]
      this.accumulators[i] += source.perStep
      let due = Math.floor(this.accumulators[i])
      this.accumulators[i] -= due
      while (due-- > 0) {
        let bearing: number
        let site: number
        if (source.kind === 'points') {
          site = Math.floor(rng.range(0, source.count)) % source.count
          bearing = (site / source.count) * Math.PI * 2 + source.phase
        } else {
          bearing = rng.range(0, Math.PI * 2)
          site = (bearing / (Math.PI * 2)) * source.count
        }
        // The SAME wander the droplet shader launches with, evaluated at this
        // parcel's launch time — so the ring the waves radiate from is the
        // ring the streaks are visibly landing on, even while it drifts.
        const wander = wanderRadial(site, simTime - source.flightTime, source.wander)
        const swing = source.span * (wander - 1) * (source.inward ? -1 : 1)
        // Triangular scatter around the wandered ring: individual parcels
        // never land in single file.
        const spread = (rng.range(0, 1) + rng.range(0, 1) - 1) * source.spread * 1.7
        const radius = source.radius + swing + spread
        sim.pushDrop(
          Math.cos(bearing) * radius,
          Math.sin(bearing) * radius,
          source.dropRadius * rng.range(0.85, 1.2),
          source.dropDepth * rng.range(0.7, 1.35),
        )
      }
    }
  }

  update(ctx: GameContext, _dt: number, _alpha: number): void {
    const sim = this.sim
    if (!sim) return
    let steps = this.pendingSteps
    this.pendingSteps = 0
    if (this.warmup > 0 && steps > 0) {
      // Catch-up ramp: a few extra steps per frame until the field carries
      // its steady-state wave energy. Impacts for the extra steps too, or the
      // warm field would be suspiciously calm.
      const extra = Math.min(6, this.warmup)
      this.warmup -= extra
      for (let i = 0; i < extra; i++) this.sampleImpacts(ctx.time.sim)
      steps += extra
    }
    sim.update(ctx.renderer, steps)
  }

  dispose(ctx: GameContext): void {
    this.sim?.dispose()
    ctx.scene.remove(this.group)
  }
}
