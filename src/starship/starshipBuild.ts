import { assembleStarship } from './starshipAssemble'
import { TW, carriage, chopstick } from './parts/tower'
import { OLM } from './parts/olm'
import { MB } from '../procgen/sslib/meshbuilder'
import { buildGeometry } from '../procgen/sslib/evalmesh'
import type { BuildObject, GeometryGroup } from '../procgen/sslib/evalmesh'
import type { Vec3 } from '../procgen/sslib/mathkit'

/**
 * Runs the whole ported build and flattens it to transferable buffers.
 *
 * Deliberately free of three.js so it can run on a worker: the port spends
 * ~420 ms here (the two 192-segment hull lathes and the 136-column TPS shell
 * are most of it), which on the main thread is a visible hitch at boot.
 *
 * NO LOD, unlike the Optimus asset. That figure is 890 k triangles standing
 * 2 m from the player's face; this is 353 k standing 215 m outside the glass,
 * where it never subtends more than ~35°, and it can never be approached. A
 * coarser tier would save draw work the frame does not miss and would cost a
 * second copy of a 34 MB vertex buffer.
 */
export interface StarshipPart {
  name: string
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
  groups: GeometryGroup[]
  /** Material slot NAMES, indexed by `GeometryGroup.materialIndex`. */
  slots: readonly string[]
  /** Placement in the demo's own Blender frame — the port keeps it there. */
  pos: Vec3
  rotZ: number
  triangles: number
}

/**
 * The numbers the flight animation needs, measured off the build rather than
 * re-declared next to it. All of them are in the demo's BLENDER frame, which
 * `starshipModel` mounts at yaw 0 — so it is a plain ENU frame: +X east,
 * +Y north, +Z up. Every flight calculation is done there and nothing has to
 * know about the site transform.
 */
export interface StarshipRig {
  /** Vertical hinge of each catch arm, and of the QD arm. */
  armPivotP: Vec3
  armPivotN: Vec3
  qdPivot: Vec3
  /** Parked splay of the catch arms, degrees (the arm's own yaw about +Z). */
  armSplayDeg: number
  /** Vehicle axis in plan, and the height of its lowest structure. */
  vehicleX: number
  vehicleBaseZ: number
  /** Booster engine exit plane and the radius its 33 bells stand within. */
  engineExitZ: number
  engineRadius: number
  /** Top of the stack when parked — the fade-out needs the whole silhouette. */
  vehicleTopZ: number
  /** OLM deck: the vehicle stands on it, and the exhaust falls through it. */
  deckZ: number
  deckRadius: number
  /** Top of the concrete raft, 19 m below the deck — where the blast lands. */
  padTopZ: number
}

export interface StarshipPayload {
  parts: StarshipPart[]
  /** Assembly scalars, carried across so the main thread can assert them. */
  vehicleX: number
  armZ: number
  rig: StarshipRig
  buildMs: number
}

/** Parts that leave the ground together. Everything else stays on the pad. */
export const VEHICLE_PARTS: ReadonlySet<string> = new Set([
  'Ship_Hull', 'Ship_TPS', 'Ship_Flaps', 'Ship_Engines', 'Ship_Details',
  'Booster_Hull', 'Booster_HotStage', 'Booster_GridFins', 'Booster_Chines',
  'Booster_Engines', 'Booster_Details',
])

export const TOWER_ARM_P = 'Tower_ArmP'
export const TOWER_ARM_N = 'Tower_ArmN'
export const TOWER_QD_ARM = 'Tower_QDArm'

/**
 * THE CHOPSTICKS ARE SPLIT, and the split is lossless by construction.
 *
 * The demo fuses the carriage and both catch arms into one `Tower_Chopsticks`
 * mesh, parked closed with the pads seated under the ship's forward flaps.
 * Nothing can launch through that: the booster's grid fins stand directly
 * beneath the arm trusses, and the vehicle's swept silhouette passes 44.7 m of
 * itself through each arm on the way up and again on the way down (measured,
 * tools/starship-clearance-audit.mjs).
 *
 * `MB.add_v` NEVER WELDS — every `prism()`/`lathe()` appends a fresh vertex
 * island — so the carriage and the arms share no vertex, no edge and no
 * smoothing group even in the fused build. Rebuilding them into three MBs
 * therefore cannot change a single normal: `buildGeometry`'s edge map is keyed
 * on vertex indices that were never shared, and its duplicate-poly pass can
 * only ever fire within one primitive. The only thing that changes is the
 * order faces appear in inside each material group, which nothing reads.
 *
 * The generator still emits the FUSED object as well — `tools/starship-gen.mjs`
 * is untouched apart from two `export` patches — so `tools/starship-parity.mjs`
 * keeps comparing the demo's own `Tower_Chopsticks` vertex for vertex. The
 * fused mesh is built and dropped; that is one MB of waste on a worker thread,
 * and it is what keeps parity a property of the build rather than a claim.
 */
function splitChopsticks(): BuildObject[] {
  const slots = ['tower', 'tower_dark', 'grate', 'dark_metal', 'concrete', 'black']
  const T_MAIN = 0, T_DARK = 1, T_GRATE = 2, T_DKM = 3

  const carriageMb = new MB()
  carriage(carriageMb, TW.ARM_Z, T_MAIN, T_MAIN, T_DARK, T_GRATE)

  const arms = [1, -1].map((sgn) => {
    const mb = new MB()
    chopstick(mb, [TW.HW + 1.1, sgn * TW.ARM_PIVOT_Y, TW.ARM_Z], sgn * TW.ARM_SPLAY,
      TW.ARM_LEN, T_MAIN, T_MAIN, T_DARK, T_GRATE, T_DKM)
    return mb
  })

  return [
    { name: 'Tower_Carriage', mb: carriageMb, smooth: 30, slots, pos: [TW.TOWER_X, 0, 0] },
    { name: TOWER_ARM_P, mb: arms[0], smooth: 30, slots, pos: [TW.TOWER_X, 0, 0] },
    { name: TOWER_ARM_N, mb: arms[1], smooth: 30, slots, pos: [TW.TOWER_X, 0, 0] },
  ]
}

export function buildStarshipPayload(): StarshipPayload {
  const started = performance.now()
  const assembly = assembleStarship()
  const parts: StarshipPart[] = []

  const objects: BuildObject[] = []
  for (const object of assembly.objs) {
    if (object.name === 'Tower_Chopsticks') objects.push(...splitChopsticks())
    else objects.push(object)
  }

  for (const object of objects) {
    const geometry = buildGeometry(object.mb, object.smooth)
    parts.push({
      name: object.name,
      position: geometry.position,
      normal: geometry.normal,
      uv: geometry.uv,
      groups: geometry.groups,
      slots: object.slots,
      pos: object.pos ?? [0, 0, 0],
      rotZ: object.rotZ ?? 0,
      triangles: geometry.tris,
    })
  }

  // The booster's 33 bells: `raptor()` puts the exit plane at z - len*0.80,
  // and the outermost ring stands at r 3.90 with a 0.62 m exit radius.
  const BOOSTER_ENGINE_Z = 2.42, BOOSTER_ENGINE_LEN = 3.10
  const engineExitZ = assembly.DECK + BOOSTER_ENGINE_Z - BOOSTER_ENGINE_LEN * 0.80

  return {
    parts,
    vehicleX: assembly.VEH_X,
    armZ: assembly.ARM_Z,
    rig: {
      armPivotP: [TW.TOWER_X + TW.HW + 1.1, TW.ARM_PIVOT_Y, assembly.ARM_Z],
      armPivotN: [TW.TOWER_X + TW.HW + 1.1, -TW.ARM_PIVOT_Y, assembly.ARM_Z],
      qdPivot: [TW.TOWER_X + TW.HW + 0.5, 0, TW.QD_Z],
      armSplayDeg: TW.ARM_SPLAY,
      vehicleX: assembly.VEH_X,
      vehicleBaseZ: assembly.DECK,
      engineExitZ,
      engineRadius: 4.52,
      vehicleTopZ: assembly.SHIP_Z + 50.3,
      deckZ: OLM.DECK_Z,
      deckRadius: OLM.R_DECK,
      padTopZ: OLM.PLAT_Z,
    },
    buildMs: performance.now() - started,
  }
}
