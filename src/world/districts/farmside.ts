import { BufferAttribute, BufferGeometry, Mesh, PlaneGeometry, Vector3 } from 'three'
import { milkyPanel, signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { FARMSIDE } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * Farmside: three barrel-vault glasshouses blazing green through milky
 * diffusing panels. Racks and grow bars are real geometry inside, so the
 * glow silhouettes read; crops arrive in S12, interiors open in S10.
 */
export function buildFarmside(services: DistrictServices): void {
  const { writer } = services
  const milky = milkyPanel()

  for (let houseIndex = 0; houseIndex < FARMSIDE.glasshouses.length; houseIndex++) {
    const house = FARMSIDE.glasshouses[houseIndex]
    const yaw = house.rotation
    const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const ground = interiorHeight(house.x, house.z)
    const base = new Vector3(house.x, ground, house.z)
    const radius = house.width / 2
    const length = house.length

    // Foundation curbs: two long side rails + two end sills.
    for (const s of [-1, 1]) {
      writer.box({
        center: base.clone().addScaledVector(across, radius * s).setY(ground + 0.22),
        size: new Vector3(0.35, 0.44, length + 0.5),
        rotationY: yaw,
        slot: 'cast',
        chamfer: 0.02,
      })
      writer.box({
        center: base.clone().addScaledVector(along, (length / 2) * s).setY(ground + 0.22),
        size: new Vector3(house.width - 0.4, 0.44, 0.35),
        rotationY: yaw,
        slot: 'cast',
        chamfer: 0.02,
      })
    }

    // Vault ribs + ridge + glass strips.
    const ribCount = Math.round(length / 2.9)
    const arcSegments = 14
    const glassPositions: number[] = []
    const glassNormals: number[] = []
    const glassIndices: number[] = []
    const arcPoint = (t: number, alongOffset: number): Vector3 => {
      const angle = Math.PI * t
      return base
        .clone()
        .addScaledVector(along, alongOffset)
        .addScaledVector(across, -Math.cos(angle) * radius)
        .add(new Vector3(0, Math.sin(angle) * radius + 0.42, 0))
    }
    for (let ribIndex = 0; ribIndex <= ribCount; ribIndex++) {
      const alongOffset = -length / 2 + (ribIndex / ribCount) * length
      const ribPath: Vector3[] = []
      for (let s = 0; s <= arcSegments; s++) ribPath.push(arcPoint(s / arcSegments, alongOffset))
      writer.tube({ path: ribPath, radius: 0.05, slot: 'steel', radialSegments: 8 })
    }
    writer.tube({
      path: [arcPoint(0.5, -length / 2 - 0.1), arcPoint(0.5, length / 2 + 0.1)],
      radius: 0.06,
      slot: 'steel',
      radialSegments: 10,
    })
    // Glass shell as one indexed strip mesh.
    const rows = ribCount
    for (let r = 0; r <= rows; r++) {
      const alongOffset = -length / 2 + (r / rows) * length
      for (let s = 0; s <= arcSegments; s++) {
        const p = arcPoint(s / arcSegments, alongOffset)
        const inner = base
          .clone()
          .addScaledVector(along, alongOffset)
          .setY(ground + 0.42 + radius * 0.5)
        const normal = p.clone().sub(inner).normalize()
        glassPositions.push(p.x, p.y, p.z)
        glassNormals.push(normal.x, normal.y, normal.z)
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < arcSegments; s++) {
        const a = r * (arcSegments + 1) + s
        const b = a + 1
        const c = a + arcSegments + 1
        const d = c + 1
        glassIndices.push(a, c, b, b, c, d)
      }
    }
    const glassGeometry = new BufferGeometry()
    glassGeometry.setAttribute('position', new BufferAttribute(new Float32Array(glassPositions), 3))
    glassGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(glassNormals), 3))
    glassGeometry.setIndex(glassIndices)
    const glassMesh = new Mesh(glassGeometry, milky)
    glassMesh.renderOrder = 8
    services.group.add(glassMesh)

    // End walls: low steel wall, arch-fitted milky glazing above, lane door.
    for (const endSign of [-1, 1]) {
      const wallCenter = base
        .clone()
        .addScaledVector(along, (length / 2 + 0.08) * endSign)
      writer.box({
        center: wallCenter.clone().setY(ground + 1.2),
        size: new Vector3(house.width - 0.3, 2.4, 0.14),
        rotationY: yaw,
        slot: 'steel',
        chamfer: 0.02,
      })
      // Arch glazing: a strip from the y=2.4 sill up to the vault arc.
      const sillY = ground + 2.4
      const archPositions: number[] = []
      const archIndices: number[] = []
      // Inset the range: at exactly startT the arc TOUCHES the sill and the
      // end quads collapse to zero area → NaN normals that poison AO/bloom
      // into black frames (found the hard way; see notes.md).
      const startT = Math.asin((sillY - ground - 0.42) / radius) / Math.PI + 0.02
      const strips = 12
      for (let s = 0; s <= strips; s++) {
        const t = startT + (s / strips) * (1 - 2 * startT)
        const p = arcPoint(t, (length / 2 + 0.06) * endSign)
        archPositions.push(p.x, p.y, p.z)
        const sill = base
          .clone()
          .addScaledVector(along, (length / 2 + 0.06) * endSign)
          .addScaledVector(across, -Math.cos(Math.PI * t) * radius)
          .setY(sillY)
        archPositions.push(sill.x, sill.y, sill.z)
      }
      for (let s = 0; s < strips; s++) {
        const a = s * 2
        if (endSign > 0) archIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        else archIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
      const archGeometry = new BufferGeometry()
      archGeometry.setAttribute('position', new BufferAttribute(new Float32Array(archPositions), 3))
      archGeometry.setIndex(archIndices)
      archGeometry.computeVertexNormals()
      // Belt & suspenders: never ship a NaN normal into the MRT.
      const normalArray = (archGeometry.getAttribute('normal') as BufferAttribute).array as Float32Array
      for (let i = 0; i < normalArray.length; i += 3) {
        if (
          !Number.isFinite(normalArray[i]) ||
          !Number.isFinite(normalArray[i + 1]) ||
          !Number.isFinite(normalArray[i + 2])
        ) {
          normalArray[i] = 0
          normalArray[i + 1] = 1
          normalArray[i + 2] = 0
        }
      }
      const archMesh = new Mesh(archGeometry, milky)
      archMesh.renderOrder = 8
      services.group.add(archMesh)
      if (endSign < 0) {
        // Door facing the farm lane.
        writer.box({
          center: wallCenter.clone().setY(ground + 1.12).addScaledVector(across, 1.6),
          size: new Vector3(1.15, 2.2, 0.2),
          rotationY: yaw,
          slot: 'aluminum',
          chamfer: 0.02,
        })
      }
    }

    // Interior racks: 3 rows × 3 tiers with grow bars beneath each tier.
    for (const rackOffset of [-radius * 0.55, 0, radius * 0.55]) {
      for (let postIndex = 0; postIndex <= 8; postIndex++) {
        const alongOffset = -length / 2 + 2 + (postIndex / 8) * (length - 4)
        const postBase = base
          .clone()
          .addScaledVector(along, alongOffset)
          .addScaledVector(across, rackOffset)
        writer.box({
          center: postBase.clone().setY(ground + 0.95),
          size: new Vector3(0.07, 1.9, 0.07),
          rotationY: yaw,
          slot: 'aluminum',
        })
      }
      for (const tierY of [0.55, 1.15, 1.75]) {
        writer.box({
          center: base.clone().addScaledVector(across, rackOffset).setY(ground + tierY),
          size: new Vector3(1.05, 0.06, length - 4),
          rotationY: yaw + Math.PI / 2,
          slot: 'aluminum',
          chamfer: 0.012,
        })
        writer.box({
          center: base.clone().addScaledVector(across, rackOffset).setY(ground + tierY + 0.42),
          size: new Vector3(0.16, 0.04, length - 4.6),
          rotationY: yaw + Math.PI / 2,
          slot: 'growBar',
        })
      }
    }

    if (houseIndex === 1) {
      // Enterable house: side walls + far end + near-end segments flanking
      // the lane door (the DoorsSystem gates the aperture itself).
      for (const s of [-1, 1]) {
        services.colliders.push({
          kind: 'box',
          center: base.clone().addScaledVector(across, radius * s).setY(ground + radius / 2),
          size: new Vector3(0.5, radius + 0.5, length),
          yaw,
        })
      }
      services.colliders.push({
        kind: 'box',
        center: base.clone().addScaledVector(along, length / 2).setY(ground + radius / 2),
        size: new Vector3(house.width, radius + 0.5, 0.4),
        yaw,
      })
      for (const [c0, c1] of [
        [-house.width / 2, 0.95],
        [2.25, house.width / 2],
      ] as const) {
        services.colliders.push({
          kind: 'box',
          center: base
            .clone()
            .addScaledVector(along, -length / 2)
            .addScaledVector(across, (c0 + c1) / 2)
            .setY(ground + radius / 2),
          size: new Vector3(c1 - c0, radius + 0.5, 0.4),
          yaw,
        })
      }
    } else {
      services.colliders.push({
        kind: 'box',
        center: base.clone().setY(ground + radius / 2),
        size: new Vector3(house.width, radius + 0.5, length),
        yaw: yaw + Math.PI / 2,
      })
    }

    // The harvest-log chalkboard beside the middle house's door.
    if (houseIndex === 1) {
      const boardSpot = base
        .clone()
        .addScaledVector(along, -length / 2 - 0.3)
        .addScaledVector(across, 3.2)
      writer.box({
        center: boardSpot.clone().setY(ground + 1.25),
        size: new Vector3(1.15, 1.5, 0.08),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.015,
      })
      const board = new Mesh(
        new PlaneGeometry(1.0, 1.2),
        signageMaterial(
          ['HARVEST LOG', 'SOL 214 · BASIL 4.2 KG', 'SOL 213 · WHEAT 11 KG', 'DO NOT TOUCH THE SCALE'],
          { background: '#232722', ink: '#cfd8c8', widthPx: 512 },
        ),
      )
      board.position.copy(boardSpot.clone().setY(ground + 1.3).addScaledVector(along, 0.05))
      board.rotation.y = yaw + Math.PI
      services.group.add(board)
    }
  }

}
