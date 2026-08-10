import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Material } from 'three'
import {
  DOME_CENTER_Y,
  DOME_SPHERE_RADIUS,
  DOME_THETA_BASE,
  PRIMARY_MERIDIANS,
  SECONDARY_MERIDIANS,
  STRUCTURAL_RINGS,
} from './latticeField'

/**
 * The BUILT structural members of Dome One: primary/secondary meridian ribs,
 * ring beams, node gussets, crown hub, and the foundation ring. Only members
 * thick enough to matter as geometry are built — the fine 2.5 m net lives in
 * the shell shader + analytic shadow (latticeField), where it stays crisp at
 * any distance for free.
 *
 * Members cast NO shadow maps: the analytic net owns all dome shadowing, so
 * the two systems can never double-darken (plan §6).
 */

const surfacePoint = (theta: number, phi: number, radialOffset = 0): Vector3 => {
  const r = DOME_SPHERE_RADIUS + radialOffset
  return new Vector3(
    Math.sin(theta) * Math.cos(phi) * r,
    DOME_CENTER_Y + Math.cos(theta) * r,
    Math.sin(theta) * Math.sin(phi) * r,
  )
}

interface MemberSpec {
  start: Vector3
  end: Vector3
  width: number
  depth: number
}

function buildInstancedMembers(members: MemberSpec[], material: Material): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1)
  const mesh = new InstancedMesh(geometry, material, members.length)
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const direction = new Vector3()
  const up = new Vector3()
  const m = new Matrix4()
  for (let i = 0; i < members.length; i++) {
    const member = members[i]
    direction.subVectors(member.end, member.start)
    const length = direction.length()
    position.addVectors(member.start, member.end).multiplyScalar(0.5)
    // Orient +Z along the member; radial direction (from sphere center) is
    // the member's depth axis so profiles sit proud of the glass.
    up.copy(position).sub(new Vector3(0, DOME_CENTER_Y, 0)).normalize()
    m.identity()
    const z = direction.clone().normalize()
    const x = new Vector3().crossVectors(up, z).normalize()
    const y = new Vector3().crossVectors(z, x)
    m.makeBasis(x, y, z)
    quaternion.setFromRotationMatrix(m)
    scale.set(member.width, member.depth, length + member.width * 0.6)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

export function buildDomeStructure(steel: Material, dark: Material): Group {
  const group = new Group()
  const members: MemberSpec[] = []
  const slimMembers: MemberSpec[] = []

  // Primary meridian ribs: 24, root to crown, 36 segments each.
  for (let i = 0; i < PRIMARY_MERIDIANS; i++) {
    const phi = (i / PRIMARY_MERIDIANS) * Math.PI * 2
    const segments = 36
    for (let s = 0; s < segments; s++) {
      const theta0 = DOME_THETA_BASE * (1 - s / segments)
      const theta1 = DOME_THETA_BASE * (1 - (s + 1) / segments)
      members.push({
        start: surfacePoint(theta0, phi, 0.22),
        end: surfacePoint(theta1, phi, 0.22),
        width: 0.34,
        depth: 0.72,
      })
    }
  }

  // Secondary meridians: slimmer, stop short of the crowded crown.
  for (let i = 0; i < SECONDARY_MERIDIANS; i++) {
    if (i % (SECONDARY_MERIDIANS / PRIMARY_MERIDIANS) === 0) continue
    const phi = (i / SECONDARY_MERIDIANS) * Math.PI * 2
    const segments = 26
    for (let s = 0; s < segments; s++) {
      const span = DOME_THETA_BASE - 0.17
      const theta0 = DOME_THETA_BASE - (s / segments) * span
      const theta1 = DOME_THETA_BASE - ((s + 1) / segments) * span
      slimMembers.push({
        start: surfacePoint(theta0, phi, 0.12),
        end: surfacePoint(theta1, phi, 0.12),
        width: 0.15,
        depth: 0.34,
      })
    }
  }

  // Ring beams at each structural parallel.
  for (let j = 1; j <= STRUCTURAL_RINGS; j++) {
    const theta = (j / STRUCTURAL_RINGS) * DOME_THETA_BASE
    const circumference = Math.PI * 2
    const segments = Math.max(48, Math.round(160 * Math.sin(theta)))
    for (let s = 0; s < segments; s++) {
      const phi0 = (s / segments) * circumference
      const phi1 = ((s + 1) / segments) * circumference
      members.push({
        start: surfacePoint(theta, phi0, 0.16),
        end: surfacePoint(theta, phi1, 0.16),
        width: 0.18,
        depth: 0.4,
      })
    }
  }

  group.add(buildInstancedMembers(members, steel))
  group.add(buildInstancedMembers(slimMembers, steel))

  // Node gussets where primaries cross rings.
  const gussetGeometry = new SphereGeometry(0.42, 12, 10)
  const gussets = new InstancedMesh(
    gussetGeometry,
    steel,
    PRIMARY_MERIDIANS * STRUCTURAL_RINGS,
  )
  const matrix = new Matrix4()
  let gussetIndex = 0
  for (let i = 0; i < PRIMARY_MERIDIANS; i++) {
    const phi = (i / PRIMARY_MERIDIANS) * Math.PI * 2
    for (let j = 1; j <= STRUCTURAL_RINGS; j++) {
      const theta = (j / STRUCTURAL_RINGS) * DOME_THETA_BASE
      matrix.makeTranslation(surfacePoint(theta, phi, 0.24))
      gussets.setMatrixAt(gussetIndex++, matrix)
    }
  }
  gussets.instanceMatrix.needsUpdate = true
  gussets.castShadow = false
  group.add(gussets)

  // Crown hub: the compression ring all primaries land on.
  const hub = new Mesh(new CylinderGeometry(6.5, 7.4, 2.6, 48, 1), steel)
  hub.position.y = DOME_CENTER_Y + Math.cos(0.021) * DOME_SPHERE_RADIUS
  hub.castShadow = false
  group.add(hub)

  // Foundation ring beam: the massive footing the shell lands on.
  const footingSegments = 144
  const footing: MemberSpec[] = []
  for (let s = 0; s < footingSegments; s++) {
    const phi0 = (s / footingSegments) * Math.PI * 2
    const phi1 = ((s + 1) / footingSegments) * Math.PI * 2
    const p0 = surfacePoint(DOME_THETA_BASE, phi0, 0)
    const p1 = surfacePoint(DOME_THETA_BASE, phi1, 0)
    p0.y = 0.75
    p1.y = 0.75
    footing.push({ start: p0, end: p1, width: 1.15, depth: 1.5 })
  }
  group.add(buildInstancedMembers(footing, dark))

  return group
}
