import { CatmullRomCurve3, Vector3 } from 'three'
import { bench, lampPost } from '../archkit/kit'
import { interiorHeight } from './interiorHeight'
import { PATHS } from './parkPlan'
import type { DistrictServices } from './districts/types'

/**
 * Amenities march the path network: benches (all sittable), unlit lamps,
 * waste pairs. Deterministic spacing with seeded jitter; side alternates.
 * Zones near the station and plaza already carry their own furniture, so a
 * simple exclusion radius keeps doubles away.
 */
const EXCLUSIONS: Array<{ x: number; z: number; r: number }> = [
  { x: 0, z: 194, r: 30 }, // portal station
  { x: 0, z: 0, r: 20 }, // first tree plaza
  { x: -86, z: 58, r: 46 }, // amphitheater bowl
  { x: -128, z: -98, r: 16 }, // playground
]

export function buildAmenities(services: DistrictServices): void {
  const { writer, rng } = services

  for (const path of PATHS) {
    if (path.surface !== 'paver') continue
    const points3 = path.points.map((p) => new Vector3(p.x, 0, p.y))
    const closed = path.points[0].distanceTo(path.points[path.points.length - 1]) < 0.01
    if (closed) points3.pop()
    const curve = new CatmullRomCurve3(points3, closed, 'centripetal', 0.5)
    const length = curve.getLength()

    const benchEvery = 34
    const benchCount = Math.floor(length / benchEvery)
    for (let i = 1; i <= benchCount; i++) {
      const t = (i / (benchCount + 1)) % 1
      const point = curve.getPointAt(t)
      if (excluded(point)) continue
      const tangent = curve.getTangentAt(t)
      const side = new Vector3(-tangent.z, 0, tangent.x)
      const flip = i % 2 === 0 ? 1 : -1
      const spot = point
        .clone()
        .addScaledVector(side, (path.width / 2 + 1.1) * flip)
        .add(new Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4)))
      spot.setY(interiorHeight(spot.x, spot.z))
      const yaw = Math.atan2(-side.x * flip, -side.z * flip)
      const seat = bench(writer, spot, yaw)
      services.seats.push({ ...seat, label: 'Sit' })
      services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 0.32),
        size: new Vector3(1.9, 0.64, 0.62),
        yaw,
      })
    }

    const lampEvery = 27
    const lampCount = Math.floor(length / lampEvery)
    for (let i = 0; i <= lampCount; i++) {
      const t = (i / (lampCount + 1) + 0.5 / (lampCount + 1)) % 1
      const point = curve.getPointAt(t)
      if (excluded(point)) continue
      const tangent = curve.getTangentAt(t)
      const side = new Vector3(-tangent.z, 0, tangent.x)
      const flip = i % 2 === 0 ? -1 : 1
      const spot = point.clone().addScaledVector(side, (path.width / 2 + 0.55) * flip)
      spot.setY(interiorHeight(spot.x, spot.z))
      lampPost(writer, spot)
      services.colliders.push({
        kind: 'cylinder',
        center: spot.clone().setY(spot.y + 1.5),
        halfHeight: 1.5,
        radius: 0.09,
      })
    }

    const wasteEvery = 61
    const wasteCount = Math.floor(length / wasteEvery)
    for (let i = 1; i <= wasteCount; i++) {
      const t = (i / (wasteCount + 1) + 0.31) % 1
      const point = curve.getPointAt(t)
      if (excluded(point)) continue
      const tangent = curve.getTangentAt(t)
      const side = new Vector3(-tangent.z, 0, tangent.x)
      const spot = point.clone().addScaledVector(side, path.width / 2 + 0.7)
      spot.setY(interiorHeight(spot.x, spot.z))
      const yaw = Math.atan2(side.x, side.z)
      writer.box({
        center: spot.clone().setY(spot.y + 0.42),
        size: new Vector3(0.42, 0.84, 0.42),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.02,
      })
      writer.box({
        center: spot.clone().addScaledVector(side, 0.5).setY(spot.y + 0.42),
        size: new Vector3(0.42, 0.84, 0.42),
        rotationY: yaw,
        slot: 'orange',
        chamfer: 0.02,
      })
      services.colliders.push({
        kind: 'box',
        center: spot.clone().addScaledVector(side, 0.25).setY(spot.y + 0.42),
        size: new Vector3(1.0, 0.9, 0.5),
        yaw,
      })
    }
  }
}

function excluded(point: Vector3): boolean {
  for (const zone of EXCLUSIONS) {
    if (Math.hypot(point.x - zone.x, point.z - zone.z) < zone.r) return true
  }
  return false
}
