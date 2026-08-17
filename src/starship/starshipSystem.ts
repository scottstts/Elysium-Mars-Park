import { Vector3 } from 'three'
import type { PointLight, SpotLight } from 'three'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import { markDynamicShadowCasters, restoreDefaultShadowCasters } from '../render/layers'
import { markSwitchableStaticShadowCasters } from '../render/staticShadowScene'
import { lightFixtures } from '../world/lightFixtures'
import { loadStarshipAsset } from './starshipModel'
import { StarshipFlight } from './starshipFlight'
import { createStarshipPlume } from './starshipPlume'
import { createStarshipPadBlast } from './starshipPadBlast'
import { STARSHIP_SITE } from './starshipSite'
import { STARSHIP_STATIC_SHADOW_GROUP } from './starshipShadow'
import type { StarshipAsset } from './starshipModel'
import type { StarshipPlume } from './starshipPlume'
import type { StarshipPadBlast } from './starshipPadBlast'

/**
 * THE LAUNCH SITE — a full-scale Starship stacked on Super Heavy, its OLIT and
 * the orbital launch mount, standing on graded ground west of the arrival
 * tunnel. `starshipSite.ts` owns where; this owns when.
 *
 * IT FLIES, on a ~3½ minute loop that never stops: 30 s on the mount, the arms
 * and the QD arm retract, 33 Raptors light, and it climbs out under integrated
 * thrust until the dust column takes it at 10.4 km. Thirty seconds later it
 * comes back — a dot falling at an angle from 9.5 km, free for half a minute,
 * then a 13-engine braking burn flown by ZEM/ZEV terminal guidance that puts
 * it back on the exact square metre it left, on three engines, at 1.4 m/s.
 * `starshipFlight.ts` owns the profile; `starshipRig.ts` owns what moves.
 *
 * THE VEHICLE SHADOW HANDS OFF INSTEAD OF DISAPPEARING. While parked, the
 * stack is a switchable member of the frozen static shadow world, so the pad
 * receives the same high-quality cached silhouette as any other immovable
 * structure. At ignition its live caster meshes move onto the dynamic shadow
 * layer and SkySystem activates the dedicated 440 m level before retiring the
 * cached copy. The two paths combine by minimum visibility, so their short
 * overlap cannot double-darken. After touchdown the reverse handoff completes
 * before that far live level is released. The vehicle therefore casts a sun
 * shadow while parked, throughout ascent/flight, and after landing, without a
 * welded ghost at the launch mount.
 *
 * NO COLLIDERS. The dome wall is the physical boundary (exteriorTerrain.ts) —
 * the player can look at this from the whole southern half of the park and can
 * never walk to it.
 */

/**
 * Compass bearing the gravity turn takes. South-east: it carries the arc
 * across the viewer rather than straight away from them, it is the one
 * quadrant that crosses neither the dome nor the frozen 250° sun, and it holds
 * the whole flight inside the 14 km far plane (worst case ~11.3 km, measured
 * from the north edge of the park floor).
 */
const DOWNRANGE_BEARING_DEG = 135

/**
 * Ambient pressure falls away fast enough that the plume is visibly blooming
 * within the first kilometre; by 8 km it is effectively firing into vacuum.
 * Drives the plume's flare, which is most of what says "this is Mars, not
 * Florida" about the exhaust.
 */
const VACUUM_ALTITUDE = 8000

/**
 * The burn is the brightest thing that ever happens in this world, and a plume
 * that does not light the steel it is roaring past reads as a decal. This is
 * the one real light the site asks for, and it earns a slot: it is off for most
 * of the cycle, and when it is on it is doing work nothing else can do —
 * throwing the tower, the mount and the slab into relief from below, against a
 * sun that is 49° off and 27° up.
 *
 * `intensity / d²` is the local irradiance, so 34 000 puts ≈ 1.4 on the tower
 * steel 150 m up the stack's own axis — comparable to the 3.15 sun and clearly
 * a second source, without turning the pad into a lamp.
 */
const PLUME_LIGHT_INTENSITY = 34_000
const PLUME_LIGHT_RANGE = 900

/**
 * Seconds for the pad cloud to bleed away after the engines stop. Matched to
 * the column particles' own lifetime so emission and appearance agree. Long,
 * because Mars dust is microns and there is neither weather nor much gravity
 * to bring it down — the pad is still hazy well after the stack has gone.
 */
const PAD_CLOUD_LINGER = 26

export class StarshipSystem implements GameSystem {
  readonly id = 'starship'

  private asset: StarshipAsset | null = null
  private flight: StarshipFlight | null = null
  private plume: StarshipPlume | null = null
  private padBlast: StarshipPadBlast | null = null
  private plumeLight: PointLight | SpotLight | null = null
  /** World position of the engine plane, reused each frame for the light. */
  private readonly enginePlane = new Vector3()
  /** Seconds since the pad last started taking exhaust, for particle ages. */
  private blastElapsed = 0
  /**
   * Emission strength, held and then bled off rather than tracked live.
   * `padBlast` is what the engines are DOING to the pad and it stops the moment
   * they do; the cloud they already threw does not. Multiplying the particles
   * by the live value would snap a 60 m dust column out of existence at engine
   * cut. This decays over the column's own lifetime instead, so the two agree.
   */
  private blastStrength = 0
  private removeStaticShadowReadyListener: (() => void) | null = null

  async init(ctx: GameContext): Promise<void> {
    const asset = await loadStarshipAsset()
    this.asset = asset

    for (const mesh of asset.meshes) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    // Parked flight hardware starts in the immutable cache, but in its own
    // switchable BundleGroups so ignition can retire ONLY the vehicle without
    // rebuilding or hiding the adjacent tower/mount casters.
    markSwitchableStaticShadowCasters(asset.rig.flight, STARSHIP_STATIC_SHADOW_GROUP)
    this.removeStaticShadowReadyListener = ctx.events.on('starship/static-shadow-ready', () => {
      // Sky emits this only after every static clipmap contains the landed
      // silhouette. Returning the live casters to layer 0 now prevents the
      // parked vehicle from needlessly entering the 12/90 m dynamic maps.
      const currentAsset = this.asset
      if (currentAsset) restoreDefaultShadowCasters(currentAsset.rig.flight)
    })

    ctx.scene.add(asset.group)

    this.flight = new StarshipFlight(DOWNRANGE_BEARING_DEG)

    // The plume hangs off the flight group's own origin, which IS the engine
    // exit plane and the attitude pivot — so it needs no transform of its own
    // and can never drift off the bells.
    this.plume = createStarshipPlume(asset.rig.metrics.engineRadius)
    asset.rig.flight.add(this.plume.mesh)

    // The pad blast stays in the WORLD, not on the vehicle: the cloud is left
    // behind at liftoff and is still hanging when the vehicle is 10 km up.
    // Blender (bx, by, bz) → world (site.x + bx, site.y + bz, site.z − by).
    const impingement = new Vector3(
      STARSHIP_SITE.x + asset.rig.metrics.vehicleX,
      STARSHIP_SITE.y + asset.rig.metrics.padTopZ,
      STARSHIP_SITE.z,
    )
    this.padBlast = createStarshipPadBlast(impingement, asset.rig.metrics.deckRadius * 0.62)
    ctx.scene.add(this.padBlast.mesh)

    // Registered once and driven to zero when cold — the rig's rule is that a
    // Light's `visible` is never toggled and none are added after boot, because
    // either one changes the LightsNode cache key and synchronously rebuilds
    // every lit program in the park. Null is a legitimate answer if the budget
    // is spent; the plume's own emission carries the look without it.
    this.plumeLight = lightFixtures().registerRealLight({
      id: 'starship-plume',
      position: [impingement.x, impingement.y, impingement.z],
      color: 0x9fb4ff,
      intensity: 0,
      range: PLUME_LIGHT_RANGE,
    })

    if (ctx.flags.debug) {
      console.info(
        `[starship] ${asset.meshes.length} parts · ${(asset.triangles / 1000).toFixed(0)}k tris · `
          + `${asset.materials.length} materials · built in ${asset.buildMs.toFixed(0)} ms`,
      )
    }
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const flight = this.flight
    const asset = this.asset
    if (!flight || !asset) return

    const wasBlasting = flight.state.padBlast > 0.002
    const previousPhase = flight.state.phase
    flight.step(dt)
    const state = flight.state

    if (state.phase !== previousPhase) {
      if (state.phase === 'ignition') {
        // Ignition is a 2.6 s hold-down period. Put the live vehicle into the
        // dynamic caster layer FIRST, then ask SkySystem to activate the 440 m
        // map and retire its cached twin. The stack is stationary throughout
        // this handoff, so the two silhouettes coincide until liftoff.
        markDynamicShadowCasters(asset.rig.flight)
        ctx.events.emit('starship/dynamic-shadow', { active: true })
      } else if (state.phase === 'parked') {
        // The vehicle has reached the exact authored pad transform again. Sky
        // keeps the live far map until every static level has recaptured this
        // parked silhouette, then releases that map with no shadowless frame.
        ctx.events.emit('starship/dynamic-shadow', { active: false })
      }
    }

    // Restart the particle clock on a fresh ignition rather than letting it run
    // forever: the cloud has to be born at the moment the engines light, and a
    // monotonic clock would have every parcel already dead by then.
    if (!wasBlasting && state.padBlast > 0.002) this.blastElapsed = 0
    else this.blastElapsed += dt
    this.blastStrength = Math.max(state.padBlast, this.blastStrength - dt / PAD_CLOUD_LINGER)

    asset.rig.apply(state)

    // Only the MESHES cut, not the flight group — the plume is a sibling under
    // it and goes on fading smoothly after the hull is gone, which is what a
    // real launch looks like from 10 km: the flame is the last thing you lose.
    // The vehicle is a ~1 px wide sliver by then, so the cut lands where
    // nothing can read it. Fading the meshes instead would mean cloning the
    // shared 20-material array, since 'black', 'dark_metal' and 'steel_dirty'
    // are used by the tower and the mount as well.
    asset.rig.vehicleGroup.visible = state.visibility > 0.02

    const expansion = Math.min(state.altitude / VACUUM_ALTITUDE, 1)
    this.plume?.update(state.throttle, state.engines, expansion, state.visibility)
    this.padBlast?.update(this.blastStrength, this.blastElapsed)

    if (this.plumeLight) {
      // Rides the engine plane, which is the flight group's own origin. Once
      // the stack is high enough that nothing on the ground is inside `range`
      // the light is pure cost, so it dies with the same fade as the vehicle.
      asset.rig.flight.getWorldPosition(this.enginePlane)
      this.plumeLight.position.copy(this.enginePlane)
      const reach = 1 - Math.min(state.altitude / PLUME_LIGHT_RANGE, 1)
      const lit = state.throttle * (state.engines / 33) * state.visibility * reach
      this.plumeLight.intensity = PLUME_LIGHT_INTENSITY * lit
    }
  }

  dispose(ctx: GameContext): void {
    this.removeStaticShadowReadyListener?.()
    this.removeStaticShadowReadyListener = null
    if (!this.asset) return
    // The rig owns its lights and never removes them (removing one rebuilds
    // every lit program in the park); driving it dark is the supported exit.
    if (this.plumeLight) this.plumeLight.intensity = 0
    this.plume?.dispose()
    if (this.padBlast) {
      ctx.scene.remove(this.padBlast.mesh)
      this.padBlast.dispose()
    }
    this.asset.rig.dispose()
    ctx.scene.remove(this.asset.group)
    for (const mesh of this.asset.meshes) mesh.geometry.dispose()
    for (const material of this.asset.materials) material.dispose()
    this.asset = null
    this.flight = null
    this.plume = null
    this.padBlast = null
  }
}
