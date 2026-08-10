import { Mesh, PlaneGeometry, Vector3 } from 'three'
import { guardrail, pressureTank, stairFlight } from '../../archkit/kit'
import { signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { WORKS } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * The Works: life support, honored. Machine hall with pilastered panels and
 * a big rolling door, the gleaming tank farm with real pipe runs, radiator
 * rows, the maintenance yard's charging frames, and the elevated gallery
 * walk ending at the Ops room (interior S10).
 */
export function buildWorks(services: DistrictServices): void {
  const { writer } = services

  // ---- Machine hall.
  const hall = WORKS.machineHall
  const hallGround = interiorHeight(hall.x, hall.z)
  const hallCenter = new Vector3(hall.x, hallGround, hall.z)
  const yaw = hall.rotation
  const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const hallHeight = 7.5

  writer.box({
    center: hallCenter.clone().setY(hallGround + hallHeight / 2),
    size: new Vector3(hall.width, hallHeight, hall.depth),
    rotationY: yaw + Math.PI / 2,
    slot: 'steel',
    chamfer: 0.05,
    uvScale: 0.4,
  })
  // Pilasters on the long faces.
  for (const side of [-1, 1]) {
    for (let p = 0; p <= 8; p++) {
      const alongOffset = -hall.width / 2 + (p / 8) * hall.width
      writer.box({
        center: hallCenter
          .clone()
          .addScaledVector(along, alongOffset)
          .addScaledVector(across, (hall.depth / 2 + 0.09) * side)
          .setY(hallGround + hallHeight / 2 - 0.3),
        size: new Vector3(0.42, hallHeight - 0.6, 0.2),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.02,
      })
    }
    // High louver band.
    writer.box({
      center: hallCenter
        .clone()
        .addScaledVector(across, (hall.depth / 2 + 0.06) * side)
        .setY(hallGround + hallHeight - 1.1),
      size: new Vector3(hall.width - 2, 1.1, 0.12),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.015,
    })
  }
  // Parapet + rolling door on the yard side (south-west face).
  writer.box({
    center: hallCenter.clone().setY(hallGround + hallHeight + 0.22),
    size: new Vector3(hall.width + 0.3, 0.44, hall.depth + 0.3),
    rotationY: yaw + Math.PI / 2,
    slot: 'dark',
    chamfer: 0.03,
  })
  const doorCenter = hallCenter
    .clone()
    .addScaledVector(along, -hall.width / 2 - 0.08)
    .setY(hallGround + 2.6)
  writer.box({
    center: doorCenter,
    size: new Vector3(0.16, 5.2, 6.5),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.02,
  })
  for (const s of [-1, 1]) {
    writer.box({
      center: doorCenter.clone().addScaledVector(across, 3.4 * s),
      size: new Vector3(0.22, 5.4, 0.3),
      rotationY: yaw,
      slot: 'orange',
      chamfer: 0.015,
    })
  }
  services.colliders.push({
    kind: 'box',
    center: hallCenter.clone().setY(hallGround + hallHeight / 2),
    size: new Vector3(hall.width, hallHeight, hall.depth),
    yaw: yaw + Math.PI / 2,
  })
  const hallSign = new Mesh(
    new PlaneGeometry(6.4, 0.9),
    signageMaterial(['ATMOSPHERE PROCESSING · HALL 1'], {
      background: '#262421',
      accent: '#c94f1d',
    }),
  )
  hallSign.position.copy(
    hallCenter
      .clone()
      .addScaledVector(across, hall.depth / 2 + 0.22)
      .setY(hallGround + hallHeight - 2),
  )
  hallSign.rotation.y = yaw
  services.group.add(hallSign)

  // ---- Tank farm: 2×2 spheres + interconnect pipes on racks.
  const farm = WORKS.tankFarm
  const farmGround = interiorHeight(farm.x, farm.z)
  const tankRadius = 4.1
  const tankCenters: Vector3[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tankCenter = new Vector3(
        farm.x + sx * (tankRadius + 1.6),
        farmGround,
        farm.z + sz * (tankRadius + 1.6),
      )
      tankCenters.push(tankCenter)
      pressureTank(writer, tankCenter, tankRadius)
      services.colliders.push({
        kind: 'cylinder',
        center: tankCenter.clone().setY(farmGround + tankRadius * 0.9),
        halfHeight: tankRadius,
        radius: tankRadius * 0.92,
      })
    }
  }
  // Pipe run from the hall to the farm on H-racks.
  const pipeStart = hallCenter
    .clone()
    .addScaledVector(along, hall.width / 2 - 2)
    .addScaledVector(across, -hall.depth / 2)
    .setY(farmGround + 2.1)
  const pipeEnd = new Vector3(farm.x - tankRadius - 2.4, farmGround + 2.1, farm.z)
  for (const lift of [0, 0.45]) {
    writer.tube({
      path: [
        pipeStart.clone().add(new Vector3(0, lift, lift * 0.6)),
        pipeEnd.clone().add(new Vector3(0, lift, lift * 0.6)),
      ],
      radius: 0.24,
      slot: 'steel',
      radialSegments: 14,
    })
  }
  const rackCount = Math.max(2, Math.round(pipeStart.distanceTo(pipeEnd) / 6))
  for (let r = 0; r <= rackCount; r++) {
    const rackBase = pipeStart.clone().lerp(pipeEnd, r / rackCount)
    for (const s of [-0.45, 0.45]) {
      writer.box({
        center: new Vector3(rackBase.x + s, (interiorHeight(rackBase.x, rackBase.z) + rackBase.y + 0.3) / 2, rackBase.z),
        size: new Vector3(0.12, rackBase.y + 0.3 - interiorHeight(rackBase.x, rackBase.z), 0.12),
        slot: 'steel',
      })
    }
    writer.box({
      center: rackBase.clone().add(new Vector3(0, 0.32, 0)),
      size: new Vector3(1.2, 0.12, 0.12),
      slot: 'steel',
      chamfer: 0.015,
    })
  }
  // Valve station with a hand wheel.
  const valveBase = pipeStart.clone().lerp(pipeEnd, 0.5)
  writer.box({
    center: valveBase.clone().setY(interiorHeight(valveBase.x, valveBase.z) + 0.55),
    size: new Vector3(0.7, 1.1, 0.5),
    slot: 'orange',
    chamfer: 0.02,
  })
  const wheelCenter = valveBase.clone().setY(valveBase.y + 0.3)
  const wheelPath: Vector3[] = []
  for (let s = 0; s <= 16; s++) {
    const angle = (s / 16) * Math.PI * 2
    wheelPath.push(
      wheelCenter.clone().add(new Vector3(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0)),
    )
  }
  writer.tube({ path: wheelPath, radius: 0.03, slot: 'steelEdge', radialSegments: 8 })

  // ---- Radiator rows.
  const radiators = WORKS.radiators
  for (let row = 0; row < radiators.rows; row++) {
    for (let panel = 0; panel < 7; panel++) {
      const px = radiators.x - 6 + panel * 2.1
      const pz = radiators.z - row * 4.2
      const ground = interiorHeight(px, pz)
      writer.box({
        center: new Vector3(px, ground + 1.5, pz),
        size: new Vector3(1.8, 2.4, 0.12),
        slot: 'aluminum',
        chamfer: 0.02,
      })
      writer.box({
        center: new Vector3(px, ground + 0.15, pz),
        size: new Vector3(0.5, 0.3, 0.35),
        slot: 'dark',
      })
    }
    services.colliders.push({
      kind: 'box',
      center: new Vector3(radiators.x, interiorHeight(radiators.x, radiators.z) + 1.4, radiators.z - row * 4.2),
      size: new Vector3(14.5, 2.8, 0.4),
    })
  }

  // ---- Maintenance yard: charging frames (robots dock here, S11).
  const yard = WORKS.maintenanceYard
  const yardGround = interiorHeight(yard.x, yard.z)
  for (let dock = 0; dock < 5; dock++) {
    const dockBase = new Vector3(yard.x - 7 + dock * 3.4, yardGround, yard.z + 4)
    for (const s of [-0.8, 0.8]) {
      writer.box({
        center: dockBase.clone().add(new Vector3(s, 1.15, 0)),
        size: new Vector3(0.14, 2.3, 0.14),
        slot: 'steel',
        chamfer: 0.015,
      })
    }
    writer.box({
      center: dockBase.clone().add(new Vector3(0, 2.28, 0)),
      size: new Vector3(1.78, 0.16, 0.16),
      slot: 'orange',
      chamfer: 0.015,
    })
    writer.box({
      center: dockBase.clone().add(new Vector3(0.55, 1.35, 0.09)),
      size: new Vector3(0.3, 0.42, 0.18),
      slot: 'dark',
      chamfer: 0.012,
    })
    // Drooping charge cable.
    writer.tube({
      path: [
        dockBase.clone().add(new Vector3(0.55, 1.14, 0.12)),
        dockBase.clone().add(new Vector3(0.42, 0.55, 0.3)),
        dockBase.clone().add(new Vector3(0.2, 0.18, 0.38)),
      ],
      radius: 0.028,
      slot: 'dark',
      radialSegments: 6,
    })
  }

  // ---- Gallery walk: elevated deck skirting the hall's park side, with
  // stairs at the near end and the Ops room at the far end.
  const walkStart = hallCenter
    .clone()
    .addScaledVector(across, hall.depth / 2 + 2.6)
    .addScaledVector(along, -hall.width / 2 + 2)
  const walkEnd = walkStart.clone().addScaledVector(along, 20)
  const walkY = hallGround + 4.1
  const posts = 6
  for (let p = 0; p <= posts; p++) {
    const postBase = walkStart.clone().lerp(walkEnd, p / posts)
    writer.box({
      center: new Vector3(postBase.x, (interiorHeight(postBase.x, postBase.z) + walkY - 0.15) / 2, postBase.z),
      size: new Vector3(0.18, walkY - 0.15 - interiorHeight(postBase.x, postBase.z), 0.18),
      slot: 'steel',
      chamfer: 0.02,
    })
  }
  writer.box({
    center: walkStart.clone().lerp(walkEnd, 0.5).setY(walkY),
    size: new Vector3(2.2, 0.14, 20.6),
    rotationY: yaw,
    slot: 'deck',
    chamferSlot: 'steelEdge',
    chamfer: 0.02,
  })
  const railLift = new Vector3(0, 0.07, 0)
  for (const s of [-1.02, 1.02]) {
    guardrail(writer, [
      walkStart.clone().addScaledVector(across, s).setY(walkY).add(railLift),
      walkEnd.clone().addScaledVector(across, s).setY(walkY).add(railLift),
    ])
  }
  services.colliders.push({
    kind: 'box',
    center: walkStart.clone().lerp(walkEnd, 0.5).setY(walkY - 0.07),
    size: new Vector3(2.2, 0.14, 20.6),
    yaw,
  })
  // Access stairs from the works lane.
  const stairBase = walkStart.clone().addScaledVector(along, -0.9)
  const stairGround = interiorHeight(stairBase.x, stairBase.z)
  const stairSteps = Math.max(8, Math.round((walkY - 0.08 - stairGround) / 0.17))
  stairFlight(writer, {
    origin: new Vector3(stairBase.x, stairGround, stairBase.z).addScaledVector(
      along,
      -stairSteps * 0.27,
    ),
    yaw: Math.atan2(along.x, along.z),
    steps: stairSteps,
    rise: (walkY - 0.08 - stairGround) / stairSteps,
    run: 0.27,
    width: 1.7,
  })
  services.colliders.push({
    kind: 'box',
    center: stairBase
      .clone()
      .addScaledVector(along, -stairSteps * 0.27 * 0.5)
      .setY(stairGround + (walkY - stairGround) / 2),
    size: new Vector3(1.7, 0.12, Math.hypot(stairSteps * 0.27, walkY - stairGround)),
    yaw: Math.atan2(along.x, along.z),
  })

  // Ops room at the walk's far end: panel shell with a REAL door aperture
  // facing the walkway; interiors.ts dresses it, OpsScreensSystem lives here.
  const ops = walkEnd.clone().addScaledVector(along, 2.9).setY(walkY - 0.05)
  const opsW = 4.6 // along travel of the walk
  const opsD = 3.4
  const opsH = 3.0
  // Floor + roof.
  writer.box({
    center: ops.clone().setY(ops.y + 0.06),
    size: new Vector3(opsW, 0.12, opsD),
    rotationY: yaw,
    slot: 'deck',
  })
  writer.box({
    center: ops.clone().setY(ops.y + opsH + 0.1),
    size: new Vector3(opsW + 0.3, 0.2, opsD + 0.3),
    rotationY: yaw,
    slot: 'steel',
    chamfer: 0.03,
  })
  // Long walls: window wall (toward the hall/park) gets the glass strip.
  writer.box({
    center: ops.clone().setY(ops.y + opsH / 2).addScaledVector(across, opsD / 2 - 0.08),
    size: new Vector3(opsW, opsH, 0.16),
    rotationY: yaw,
    slot: 'habShell',
    chamfer: 0.03,
  })
  for (const [y0, y1] of [
    [0, 1.05],
    [2.15, opsH],
  ] as const) {
    writer.box({
      center: ops
        .clone()
        .setY(ops.y + (y0 + y1) / 2)
        .addScaledVector(across, -opsD / 2 + 0.08),
      size: new Vector3(opsW, y1 - y0, 0.16),
      rotationY: yaw,
      slot: 'habShell',
      chamfer: 0.03,
    })
  }
  writer.box({
    center: ops.clone().setY(ops.y + 1.6).addScaledVector(across, -opsD / 2 + 0.07),
    size: new Vector3(opsW - 0.4, 1.1, 0.04),
    rotationY: yaw,
    slot: 'darkGlass',
  })
  // End walls: far end solid; near end (walk side) split for the door.
  writer.box({
    center: ops.clone().setY(ops.y + opsH / 2).addScaledVector(along, opsW / 2 - 0.08),
    size: new Vector3(0.16, opsH, opsD),
    rotationY: yaw,
    slot: 'habShell',
    chamfer: 0.03,
  })
  for (const [z0, z1] of [
    [-opsD / 2, -0.62],
    [0.62, opsD / 2],
  ] as const) {
    writer.box({
      center: ops
        .clone()
        .setY(ops.y + opsH / 2)
        .addScaledVector(along, -opsW / 2 + 0.08)
        .addScaledVector(across, (z0 + z1) / 2),
      size: new Vector3(0.16, opsH, z1 - z0),
      rotationY: yaw,
      slot: 'habShell',
      chamfer: 0.03,
    })
  }
  writer.box({
    center: ops.clone().setY(ops.y + opsH - 0.32).addScaledVector(along, -opsW / 2 + 0.08),
    size: new Vector3(0.16, 0.64, 1.24),
    rotationY: yaw,
    slot: 'habShell',
    chamfer: 0.02,
  })
  // Colliders: walls with the door gap.
  const opsWall = (offsetAlong: number, offsetAcross: number, size: Vector3): void => {
    services.colliders.push({
      kind: 'box',
      center: ops
        .clone()
        .setY(ops.y + opsH / 2)
        .addScaledVector(along, offsetAlong)
        .addScaledVector(across, offsetAcross),
      size,
      yaw,
    })
  }
  opsWall(0, opsD / 2 - 0.08, new Vector3(opsW, opsH, 0.2))
  opsWall(0, -opsD / 2 + 0.08, new Vector3(opsW, opsH, 0.2))
  opsWall(opsW / 2 - 0.08, 0, new Vector3(0.2, opsH, opsD))
  opsWall(-opsW / 2 + 0.08, -(0.62 + opsD / 2) / 2, new Vector3(0.2, opsH, opsD / 2 - 0.62))
  opsWall(-opsW / 2 + 0.08, (0.62 + opsD / 2) / 2, new Vector3(0.2, opsH, opsD / 2 - 0.62))
  services.opsAnchor = { position: ops.clone(), yaw }
  const opsSign = new Mesh(
    new PlaneGeometry(1.4, 0.42),
    signageMaterial(['OPS'], { background: '#25231f', accent: '#c94f1d', widthPx: 384 }),
  )
  opsSign.position.copy(ops.clone().setY(ops.y + 3.05).addScaledVector(across, -1.72))
  opsSign.rotation.y = yaw + Math.PI
  services.group.add(opsSign)

  // Reclaimer block with twin vent stacks (vapor animates in S11).
  const reclaimer = new Vector3(hall.x + 6, 0, hall.z + hall.depth / 2 + 7)
  const reclaimerGround = interiorHeight(reclaimer.x, reclaimer.z)
  writer.box({
    center: new Vector3(reclaimer.x, reclaimerGround + 1.5, reclaimer.z),
    size: new Vector3(4.4, 3, 3.2),
    slot: 'steel',
    chamfer: 0.04,
  })
  for (const s of [-1, 1]) {
    writer.tube({
      path: [
        new Vector3(reclaimer.x + s, reclaimerGround + 2.8, reclaimer.z),
        new Vector3(reclaimer.x + s, reclaimerGround + 7.4, reclaimer.z),
      ],
      radius: 0.26,
      slot: 'aluminum',
      radialSegments: 14,
      capEnd: false,
    })
  }
  services.colliders.push({
    kind: 'box',
    center: new Vector3(reclaimer.x, reclaimerGround + 1.5, reclaimer.z),
    size: new Vector3(4.4, 3, 3.2),
  })
}
