import { DOME_CENTER_Y, DOME_SPHERE_RADIUS } from '../dome/latticeField'

interface PointLike {
  x: number
  y: number
  z: number
}

type MutableMovement = PointLike

/**
 * Keep a vertical capsule wholly inside the dome's spherical pressure shell.
 *
 * A capsule is a line segment swept by a sphere. Because Dome One's sphere
 * centre is far below the walkable floor, the segment's upper endpoint is
 * always the limiting point. Shrinking the dome radius by the capsule radius
 * and shifting the admissible centre down by the capsule half-height turns
 * containment into a simple point-in-sphere test for the body centre.
 *
 * Movement is clipped along its original vector to the FIRST contact with the
 * glass. There is deliberately no tangent projection/slide here: when a jump
 * reaches the curved shell it ends at the impact point instead of spending the
 * remaining upward travel by shoving the player sideways along the dome.
 */
export function clipCapsuleMovementToDome(
  position: PointLike,
  movement: MutableMovement,
  capsuleHalfHeight: number,
  capsuleRadius: number,
): boolean {
  const allowedRadius = DOME_SPHERE_RADIUS - capsuleRadius
  const allowedRadiusSq = allowedRadius * allowedRadius

  const startX = position.x
  const startY = position.y - (DOME_CENTER_Y - capsuleHalfHeight)
  const startZ = position.z
  const endX = startX + movement.x
  const endY = startY + movement.y
  const endZ = startZ + movement.z

  const startSq = startX * startX + startY * startY + startZ * startZ
  const endSq = endX * endX + endY * endY + endZ * endZ

  if (endSq <= allowedRadiusSq) return false

  // Do not forcibly project an already-invalid pose somewhere else. Allow an
  // inward recovery move, otherwise hold position until another system places
  // the player back in valid space.
  if (startSq > allowedRadiusSq) {
    if (endSq < startSq) return false
    movement.x = 0
    movement.y = 0
    movement.z = 0
    return true
  }

  const dx = movement.x
  const dy = movement.y
  const dz = movement.z
  const a = dx * dx + dy * dy + dz * dz
  if (a <= Number.EPSILON) return false

  const b = 2 * (startX * dx + startY * dy + startZ * dz)
  const c = startSq - allowedRadiusSq
  const discriminant = Math.max(0, b * b - 4 * a * c)
  const exitT = (-b + Math.sqrt(discriminant)) / (2 * a)
  // Leave a microscopic numerical cushion inside the shell so the next fixed
  // step begins from an unambiguously valid point.
  const t = Math.max(0, Math.min(1, exitT - 1e-6))

  movement.x *= t
  movement.y *= t
  movement.z *= t
  return true
}
