import { Group, Vector3 } from 'three'
import { PartWriter } from '../../archkit/writer'
import { kitMaterials } from '../../materials/library'
import type { DistrictServices } from './types'

/**
 * Shared interior fittings. Each hero interior lives in its own file
 * (loungeInterior / opsInterior / habInterior / greenhouseInterior) with its
 * own district owner; only genuinely shared pieces belong here.
 */
export function slidingDoor(
  services: DistrictServices,
  center: Vector3,
  yaw: number,
  label: string,
  width = 1.2,
  height = 2.3,
): void {
  const writer = new PartWriter()
  writer.box({
    center: new Vector3(0, 0, 0),
    size: new Vector3(width, height, 0.08),
    slot: 'aluminum',
    chamfer: 0.02,
  })
  // Applied panels are SHALLOWER than the leaf and sit proud of its front
  // face only — a 0.09-deep panel on a 0.08 leaf z-fights its back face
  // (leisure-district audit finding: 7,381 cm² across every door).
  writer.box({
    center: new Vector3(0, 0.25, 0.012),
    size: new Vector3(width - 0.35, 0.7, 0.07),
    slot: 'darkGlass',
  })
  writer.box({
    center: new Vector3(0, -height / 2 + 0.09, 0.012),
    size: new Vector3(width - 0.2, 0.18, 0.07),
    slot: 'orange',
    chamfer: 0.012,
  })
  const panel = new Group()
  panel.add(writer.build(kitMaterials()))
  panel.rotation.y = yaw
  services.group.add(panel)

  const slide = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(width + 0.08)
  services.doors.push({
    panel,
    closedPosition: center.clone(),
    openOffset: slide,
    anchor: center.clone(),
    label,
    collider: { center: center.clone(), size: new Vector3(width + 0.1, height, 0.3), yaw },
  })
}
