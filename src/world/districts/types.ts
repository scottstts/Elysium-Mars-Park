import type { Group, Vector3 } from 'three'
import type { PartWriter } from '../../archkit/writer'
import type { Rng } from '../../core/prng'
import type { Interactable } from '../../player/interaction'

export type ColliderSpec =
  | { kind: 'box'; center: Vector3; size: Vector3; yaw?: number }
  | { kind: 'cylinder'; center: Vector3; halfHeight: number; radius: number }

/** A sliding door panel the DoorsSystem animates + gates with a collider. */
export interface DoorSpec {
  panel: Group
  closedPosition: Vector3
  openOffset: Vector3
  /** Caption anchor (usually door center at handle height). */
  anchor: Vector3
  label: string
  /** Blocking collider while closed. */
  collider: { center: Vector3; size: Vector3; yaw?: number }
}

/**
 * Shared context handed to every district builder: ONE writer (whole-park
 * architecture lands as a handful of merged meshes), a group for special
 * meshes (glass, sign faces), collider specs, and seat registration.
 */
export interface DistrictServices {
  writer: PartWriter
  group: Group
  rng: Rng
  colliders: ColliderSpec[]
  seats: Array<{ seat: Vector3; yaw: number; label?: string }>
  interactables: Interactable[]
  doors: DoorSpec[]
  /** Ops room anchor (set by works.ts, consumed by OpsScreensSystem). */
  opsAnchor?: { position: Vector3; yaw: number }
}
