import { Group, MathUtils, Quaternion, Vector3 } from 'three'
import type { Mesh, Object3D } from 'three'
import { TOWER_ARM_N, TOWER_ARM_P, TOWER_QD_ARM, VEHICLE_PARTS } from './starshipBuild'
import type { StarshipRig as RigMetrics } from './starshipBuild'
import type { StarshipFlightState } from './starshipFlight'

/**
 * THE MOVING PARTS — what the flight state is actually applied to.
 *
 * Three hinges and one free body, all of them children of the demo's own
 * Blender-frame group so that nothing here has to know about the site
 * transform, and — the load-bearing part — so that no mesh's `positionLocal`
 * ever moves. Four of the twenty materials read it as Blender's Texture
 * Coordinate > Object; animating a PARENT leaves the geometry's own
 * coordinates alone, while baking motion into vertices would slide the noise
 * across the tower steel and the engine metal every frame.
 */

/**
 * How far the catch arms open, on top of the demo's parked 10° splay.
 *
 * THE PARKED POSE IS NOT SURVIVABLE and that is why this exists: the pads are
 * seated under the ship's forward flaps, and directly beneath them stand the
 * booster's grid fins. Measured, the vehicle's swept plan silhouette passes
 * 44.7 m of itself straight through each arm truss at (−2.2, ±5.7, 130.2).
 *
 * 25° is the measured floor plus margin. At 20° the arms are only just outside
 * the silhouette; at 25° nothing on the vehicle stands over any part of an arm
 * at all. Going further buys nothing and costs tower: the hinge is embedded in
 * the carriage by the demo's own construction (1.27 m³ at rest), and opening
 * adds 0.22 m³ at 25°, 0.54 at 30°, 0.75 at 34°.
 *
 * All of it is checked by tools/starship-clearance-audit.mjs, which rasterises
 * the vehicle into a plan grid of its LOWEST geometry per cell — the vehicle
 * neither rolls nor pitches below 220 m, so its flaps and fins keep fixed
 * azimuths and the sweep is its real silhouette, not a 10.75 m disc.
 */
const ARM_OPEN_DEG = 25

/**
 * The QD arm FOLDS DOWN rather than swinging aside, and it retracts at all
 * only for honesty — measured, NOTHING on the vehicle ever passes over it, so
 * unlike the catch arms it could legally stay put. A mated umbilical on a
 * launching rocket is simply wrong, so it goes.
 *
 * That makes its cost pure, which is what picks the axis and the angle. Its
 * root sits 0.5 m east of the tower's east face with a 3.9 m wide section, so
 * every retraction drives some of the hinge into the face's rails: yawing it
 * aside 60° buries 1.96 m³, folding it down 55° buries 0.32 m³. Down, then,
 * and only as far as reads — 55° is unmistakably retracted, and 80° would put
 * it nearly vertical for twice the intersection and no more legibility.
 */
const QD_FOLD_DEG = 55

export interface StarshipRigHandles {
  /** Everything that leaves the ground, under one animated transform. */
  flight: Group
  /**
   * Just the meshes, inside `flight`. Hiding THIS rather than `flight` is what
   * lets the plume outlive the vehicle at the top of the climb — the exhaust
   * is the last thing visible from 10 km, exactly as it is in real footage.
   */
  vehicleGroup: Group
  vehicleMeshes: Mesh[]
  /** Meshes that never move — the tower, the carriage, the mount, the slab. */
  staticMeshes: Mesh[]
  /** Blender-frame position of the engine exit plane when parked. */
  enginePivot: Vector3
  metrics: RigMetrics
  apply(state: StarshipFlightState): void
  dispose(): void
}

const BLENDER_UP = /*@__PURE__*/ new Vector3(0, 0, 1)

/**
 * Reparents the flat mesh list into the hinges above.
 *
 * @param blender the demo's −90° X group; every mesh is already a child of it
 *   with its own local `pos`/`rotZ`, and those are left exactly as they are.
 */
export function createStarshipRig(
  blender: Object3D,
  meshes: Mesh[],
  metrics: RigMetrics,
): StarshipRigHandles {
  const byName = new Map(meshes.map((mesh) => [mesh.name.replace(/^starship:/, ''), mesh]))

  // The vehicle turns about its ENGINE PLANE, not about the assembly datum
  // (which is the tower's, 5.36 m away in plan and on the ground). Two nested
  // groups get that for free and stay exactly identity when parked: the outer
  // one is translated to the pivot and carries the motion, the inner one undoes
  // the translation so the meshes keep the positions the build gave them.
  const enginePivot = new Vector3(metrics.vehicleX, 0, metrics.engineExitZ)

  const flight = new Group()
  flight.name = 'starship:flight'
  flight.position.copy(enginePivot)
  blender.add(flight)

  const vehicle = new Group()
  vehicle.name = 'starship:vehicle'
  vehicle.position.copy(enginePivot).multiplyScalar(-1)
  flight.add(vehicle)

  const vehicleMeshes: Mesh[] = []
  const staticMeshes: Mesh[] = []

  const hinge = (name: string, pivot: readonly number[]): Group | null => {
    const mesh = byName.get(name)
    if (!mesh) return null
    const group = new Group()
    group.name = `starship:hinge:${name}`
    group.position.set(pivot[0], pivot[1], pivot[2])
    blender.add(group)
    // The mesh keeps its own build position; the hinge only re-expresses it
    // relative to the pivot, so the parked pose is bit-for-bit unchanged.
    mesh.position.sub(group.position)
    mesh.updateMatrix()
    group.add(mesh)
    return group
  }

  const armP = hinge(TOWER_ARM_P, metrics.armPivotP)
  const armN = hinge(TOWER_ARM_N, metrics.armPivotN)
  const qdArm = hinge(TOWER_QD_ARM, metrics.qdPivot)
  const hinged = new Set([TOWER_ARM_P, TOWER_ARM_N, TOWER_QD_ARM])

  for (const mesh of meshes) {
    const name = mesh.name.replace(/^starship:/, '')
    if (VEHICLE_PARTS.has(name)) {
      vehicle.add(mesh)
      vehicleMeshes.push(mesh)
    } else if (!hinged.has(name)) {
      staticMeshes.push(mesh)
    }
  }

  const armOpen = MathUtils.degToRad(ARM_OPEN_DEG)
  const qdFold = MathUtils.degToRad(QD_FOLD_DEG)
  const attitude = new Quaternion()

  return {
    flight,
    vehicleGroup: vehicle,
    vehicleMeshes,
    staticMeshes,
    enginePivot,
    metrics,
    apply(state: StarshipFlightState): void {
      flight.position.copy(enginePivot).add(state.position)
      // Minimal rotation from the parked axis to the commanded one: no roll is
      // introduced, and a vertical axis returns exact identity, so a touchdown
      // resolves to the pose the build produced rather than near it.
      attitude.setFromUnitVectors(BLENDER_UP, state.axis)
      flight.quaternion.copy(attitude)

      if (armP) armP.rotation.z = armOpen * state.armOpen
      if (armN) armN.rotation.z = -armOpen * state.armOpen
      if (qdArm) qdArm.rotation.y = qdFold * state.qdOpen
    },
    dispose(): void {
      flight.removeFromParent()
      armP?.removeFromParent()
      armN?.removeFromParent()
      qdArm?.removeFromParent()
    },
  }
}
