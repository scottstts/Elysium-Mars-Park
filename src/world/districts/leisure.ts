import { Mesh, PlaneGeometry, Vector3 } from 'three'
import { bench } from '../../archkit/kit'
import { heroGlass, signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { AMPHITHEATER, FIRST_TREE, OVERLOOK_LOUNGE, PLAYGROUND } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * Leisure heart: the amphitheater bowl (4,000 cast seats facing the planet
 * through the glass), the Overlook Lounge shell with its true-transmission
 * window wall, the built-for-the-future playground, and the First Tree
 * plaza's ring bench + plaques (the tree itself lands in S12).
 */
export function buildLeisure(services: DistrictServices): void {
  buildAmphitheater(services)
  buildOverlook(services)
  buildPlayground(services)
  buildFirstTreePlaza(services)
}

function buildAmphitheater(services: DistrictServices): void {
  const { writer } = services
  const center = new Vector3(AMPHITHEATER.x, 0, AMPHITHEATER.z)
  const rows = 6
  const arcSpan = (Math.PI * 5) / 6
  // Seat arc on the EAST side of the bowl (angle 0 = +X): rows face west
  // across the orchestra flat to the stage, planet backdrop beyond. An arc
  // centered at PI put the rows WEST with the stage threaded between them.
  const arcCenter = 0

  for (let row = 0; row < rows; row++) {
    const radius = 16 + row * 4.6
    const segments = Math.round((arcSpan * radius) / 2.9)
    for (let segment = 0; segment < segments; segment++) {
      const t = segment / (segments - 1)
      // Three radial aisles split the arc.
      const aisle = Math.abs(t - 0.25) < 0.02 || Math.abs(t - 0.5) < 0.02 || Math.abs(t - 0.75) < 0.02
      if (aisle) continue
      const angle = arcCenter - arcSpan / 2 + t * arcSpan
      const segmentCenter = center
        .clone()
        .add(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      const ground = interiorHeight(segmentCenter.x, segmentCenter.z)
      const yaw = Math.atan2(-Math.cos(angle), Math.sin(angle))
      // Plinth + seat slab: cast mineral, chamfered.
      writer.box({
        center: segmentCenter.clone().setY(ground + 0.18),
        size: new Vector3(2.6, 0.36, 0.62),
        rotationY: yaw,
        slot: 'cast',
        chamfer: 0.02,
      })
      writer.box({
        center: segmentCenter.clone().setY(ground + 0.43),
        size: new Vector3(2.6, 0.14, 0.5),
        rotationY: yaw,
        slot: 'cast',
        chamfer: 0.025,
      })
      // Per-seat collider following the bowl's rake — a full-disc cylinder
      // here flattens the whole dished floor into an invisible cap.
      services.colliders.push({
        kind: 'box',
        center: segmentCenter.clone().setY(ground + 0.25),
        size: new Vector3(2.6, 0.5, 0.62),
        yaw,
      })
      if (row % 2 === 0 && segment % 5 === 2) {
        services.seats.push({
          seat: segmentCenter.clone().setY(ground + 0.5),
          yaw: yaw + Math.PI,
          label: 'Sit',
        })
      }
    }
  }

  // Low stage looking west — the planet is the backdrop.
  const stageCenter = center.clone().add(new Vector3(-24, 0, 0))
  const stageGround = interiorHeight(stageCenter.x, stageCenter.z)
  writer.box({
    center: stageCenter.clone().setY(stageGround + 0.25),
    size: new Vector3(6.5, 0.5, 9),
    slot: 'cast',
    chamfer: 0.03,
  })
  services.colliders.push({
    kind: 'box',
    center: stageCenter.clone().setY(stageGround + 0.25),
    size: new Vector3(6.5, 0.5, 9),
  })

  const plaque = new Mesh(
    new PlaneGeometry(1.7, 0.5),
    signageMaterial(['ASSEMBLY BOWL', 'CAPACITY 4 000'], {
      background: '#2b2723',
      widthPx: 512,
    }),
  )
  // Outside the dug bowl, beside the spur path from the east.
  const plaqueSpot = center.clone().add(new Vector3(38, 0, 30))
  plaque.position.copy(plaqueSpot.setY(interiorHeight(plaqueSpot.x, plaqueSpot.z) + 1.15))
  plaque.rotation.y = Math.atan2(plaqueSpot.x - center.x, plaqueSpot.z - center.z) + Math.PI
  services.group.add(plaque)
  writer.box({
    center: plaque.position.clone().add(new Vector3(0, -0.08, 0.05)),
    size: new Vector3(1.85, 0.85, 0.09),
    rotationY: plaque.rotation.y,
    slot: 'dark',
    chamfer: 0.015,
  })
}

function buildOverlook(services: DistrictServices): void {
  const { writer } = services
  const lounge = OVERLOOK_LOUNGE
  const ground = lounge.y
  const center = new Vector3(lounge.x, ground, lounge.z)
  const width = lounge.width // along z
  const depth = lounge.depth // along x
  const height = 3.4

  // Shell: back wall in two runs flanking the door bay, sides, roof.
  const doorZ = center.z + 2
  const bayHalf = 0.62
  for (const [z0, z1] of [
    [center.z - width / 2, doorZ - bayHalf],
    [doorZ + bayHalf, center.z + width / 2],
  ] as const) {
    writer.box({
      center: new Vector3(center.x + depth / 2 - 0.15, ground + height / 2, (z0 + z1) / 2),
      size: new Vector3(0.3, height, z1 - z0),
      slot: 'habShell',
      chamfer: 0.03,
    })
  }
  for (const s of [-1, 1]) {
    writer.box({
      center: center.clone().setY(ground + height / 2).add(new Vector3(0, 0, (width / 2 - 0.15) * s)),
      size: new Vector3(depth, height, 0.3),
      slot: 'habShell',
      chamfer: 0.03,
    })
  }
  writer.box({
    center: center.clone().setY(ground + height + 0.14),
    size: new Vector3(depth + 1.6, 0.28, width + 0.8),
    slot: 'steel',
    chamfer: 0.03,
  })
  writer.box({
    center: center.clone().setY(ground + 0.1),
    size: new Vector3(depth + 0.6, 0.2, width + 0.6),
    slot: 'cast',
    chamfer: 0.03,
  })

  // West window wall: mullion grid + hero transmission panes.
  const glassX = center.x - depth / 2 + 0.12
  const columns = 4
  const paneWidth = (width - 0.3) / columns
  for (let column = 0; column <= columns; column++) {
    writer.box({
      center: new Vector3(glassX, ground + height / 2, center.z - width / 2 + 0.15 + column * paneWidth),
      size: new Vector3(0.16, height, 0.12),
      slot: 'dark',
      chamfer: 0.015,
    })
  }
  for (const railY of [0, height / 2 - 0.05, height - 0.16]) {
    writer.box({
      center: new Vector3(glassX, ground + railY + 0.08, center.z),
      size: new Vector3(0.16, 0.16, width - 0.2),
      slot: 'dark',
      chamfer: 0.015,
    })
  }
  const glass = heroGlass()
  for (let column = 0; column < columns; column++) {
    for (const [y0, y1] of [
      [0.16, height / 2 - 0.05],
      [height / 2 + 0.11, height - 0.16],
    ]) {
      const pane = new Mesh(new PlaneGeometry(paneWidth - 0.2, (y1 as number) - (y0 as number)), glass)
      pane.position.set(
        glassX - 0.02,
        ground + ((y0 as number) + (y1 as number)) / 2,
        center.z - width / 2 + 0.15 + (column + 0.5) * paneWidth,
      )
      pane.rotation.y = -Math.PI / 2
      services.group.add(pane)
    }
  }

  // East wall: real door aperture (1.24 × 2.3) at z offset +2; the panel
  // itself registers with the DoorsSystem in the interiors pass.
  writer.box({
    center: center.clone().setY(ground + height - 0.35).add(new Vector3(depth / 2 - 0.15, 0, 2)),
    size: new Vector3(0.3, 0.7, 1.24),
    slot: 'habShell',
    chamfer: 0.02,
  })
  const sign = new Mesh(
    new PlaneGeometry(2.4, 0.5),
    signageMaterial(['OVERLOOK LOUNGE'], { background: '#25231f', accent: '#c94f1d', widthPx: 640 }),
  )
  sign.position.copy(center.clone().setY(ground + 2.9).add(new Vector3(depth / 2 + 0.06, 0, 0)))
  sign.rotation.y = Math.PI / 2
  services.group.add(sign)

  // Colliders: window wall, side walls, and the split back wall (door gap).
  services.colliders.push(
    {
      kind: 'box',
      center: new Vector3(center.x - depth / 2 + 0.12, ground + height / 2, center.z),
      size: new Vector3(0.25, height, width),
    },
    {
      kind: 'box',
      center: new Vector3(center.x, ground + height / 2, center.z - width / 2 + 0.15),
      size: new Vector3(depth, height, 0.3),
    },
    {
      kind: 'box',
      center: new Vector3(center.x, ground + height / 2, center.z + width / 2 - 0.15),
      size: new Vector3(depth, height, 0.3),
    },
    {
      kind: 'box',
      center: new Vector3(
        center.x + depth / 2 - 0.15,
        ground + height / 2,
        (center.z - width / 2 + (doorZ - bayHalf)) / 2,
      ),
      size: new Vector3(0.3, height, doorZ - bayHalf - (center.z - width / 2)),
    },
    {
      kind: 'box',
      center: new Vector3(
        center.x + depth / 2 - 0.15,
        ground + height / 2,
        (doorZ + bayHalf + center.z + width / 2) / 2,
      ),
      size: new Vector3(0.3, height, center.z + width / 2 - (doorZ + bayHalf)),
    },
  )

  // Rim benches flanking the lounge, facing the planet.
  for (const s of [-1, 1]) {
    const spot = new Vector3(lounge.x - depth / 2 - 2.4, 0, lounge.z + (width / 2 + 4.5) * s)
    spot.setY(interiorHeight(spot.x, spot.z))
    const seat = bench(writer, spot, -Math.PI / 2)
    services.seats.push({ ...seat, label: 'Watch the planet' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.3),
      size: new Vector3(1.9, 0.6, 0.6),
      yaw: -Math.PI / 2,
    })
  }
}

function buildPlayground(services: DistrictServices): void {
  const { writer } = services
  const ground = 0.4
  const center = new Vector3(PLAYGROUND.x, ground, PLAYGROUND.z)

  // Poured safety surface + curb ring.
  writer.disc(center.clone().setY(ground + 0.03), PLAYGROUND.radius - 1, 'playSoft', { uvScale: 0.4 })
  const curbSegments = 26
  for (let s = 0; s < curbSegments; s++) {
    const angle = (s / curbSegments) * Math.PI * 2
    writer.box({
      center: center
        .clone()
        .add(new Vector3(Math.cos(angle) * (PLAYGROUND.radius - 0.8), 0.06, Math.sin(angle) * (PLAYGROUND.radius - 0.8))),
      size: new Vector3(0.18, 0.14, (2 * Math.PI * (PLAYGROUND.radius - 0.8)) / curbSegments + 0.02),
      rotationY: -angle,
      slot: 'cast',
      chamfer: 0.015,
    })
  }

  // Climbing dome: three latitude rings + eight meridians of tube.
  const domeCenter = center.clone().add(new Vector3(-4.5, 0, 2))
  const domeRadius = 2.1
  for (const lat of [0.25, 0.5, 0.75]) {
    const ringPath: Vector3[] = []
    const r = Math.sin(lat * Math.PI * 0.5) * domeRadius
    const y = Math.cos(lat * Math.PI * 0.5) * domeRadius
    for (let s = 0; s <= 24; s++) {
      const angle = (s / 24) * Math.PI * 2
      ringPath.push(domeCenter.clone().add(new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r)))
    }
    writer.tube({ path: ringPath, radius: 0.035, slot: 'playRed', radialSegments: 8 })
  }
  for (let meridian = 0; meridian < 8; meridian++) {
    const angle = (meridian / 8) * Math.PI * 2
    const path: Vector3[] = []
    for (let s = 0; s <= 8; s++) {
      const t = (s / 8) * Math.PI * 0.5
      path.push(
        domeCenter
          .clone()
          .add(
            new Vector3(
              Math.cos(angle) * Math.sin(t) * domeRadius,
              Math.cos(t) * domeRadius,
              Math.sin(angle) * Math.sin(t) * domeRadius,
            ),
          ),
      )
    }
    writer.tube({ path, radius: 0.035, slot: 'playBlue', radialSegments: 8 })
  }
  services.colliders.push({
    kind: 'cylinder',
    center: domeCenter.clone().setY(ground + domeRadius / 2),
    halfHeight: domeRadius / 2,
    radius: domeRadius,
  })

  // Swing frame: two A-frames + top bar + two swings.
  const swingCenter = center.clone().add(new Vector3(3.8, 0, -3))
  const barHeight = 2.6
  for (const s of [-1.8, 1.8]) {
    for (const leg of [-0.9, 0.9]) {
      writer.tube({
        path: [
          swingCenter.clone().add(new Vector3(s, barHeight, 0)),
          swingCenter.clone().add(new Vector3(s + leg * 0.35, 0, leg)),
        ],
        radius: 0.05,
        slot: 'playBlue',
        radialSegments: 8,
      })
    }
  }
  writer.tube({
    path: [
      swingCenter.clone().add(new Vector3(-1.8, barHeight, 0)),
      swingCenter.clone().add(new Vector3(1.8, barHeight, 0)),
    ],
    radius: 0.055,
    slot: 'playRed',
    radialSegments: 8,
  })
  for (const s of [-0.8, 0.8]) {
    for (const chain of [-0.22, 0.22]) {
      writer.tube({
        path: [
          swingCenter.clone().add(new Vector3(s + chain, barHeight - 0.03, 0)),
          swingCenter.clone().add(new Vector3(s + chain, 0.62, 0)),
        ],
        radius: 0.012,
        slot: 'dark',
        radialSegments: 5,
      })
    }
    writer.box({
      center: swingCenter.clone().add(new Vector3(s, 0.58, 0)),
      size: new Vector3(0.52, 0.05, 0.22),
      slot: 'fabricSand',
      chamfer: 0.015,
    })
  }
  services.colliders.push({
    kind: 'box',
    center: swingCenter.clone().setY(ground + 1.3),
    size: new Vector3(4.2, 2.6, 2.2),
  })

  // Balance beam + the Ares VII plaque.
  writer.box({
    center: center.clone().add(new Vector3(0.5, 0.24, 4.5)),
    size: new Vector3(3.2, 0.16, 0.16),
    rotationY: 0.5,
    slot: 'playRed',
    chamfer: 0.02,
  })
  const plaqueBase = center.clone().add(new Vector3(PLAYGROUND.radius - 1.6, 0, -PLAYGROUND.radius + 2.4))
  writer.box({
    center: plaqueBase.clone().setY(ground + 0.55),
    size: new Vector3(0.7, 1.1, 0.12),
    rotationY: 2.4,
    slot: 'dark',
    chamfer: 0.015,
  })
  const plaque = new Mesh(
    new PlaneGeometry(0.62, 0.3),
    signageMaterial(['DONATED BY THE', 'CREW OF ARES VII'], { background: '#2b2723', widthPx: 384 }),
  )
  plaque.position.copy(plaqueBase.clone().setY(ground + 0.78).add(new Vector3(Math.sin(2.4) * 0.07, 0, Math.cos(2.4) * 0.07)))
  plaque.rotation.y = 2.4
  services.group.add(plaque)
}

function buildFirstTreePlaza(services: DistrictServices): void {
  const { writer } = services
  const plazaY = 0.55
  const center = new Vector3(FIRST_TREE.x, plazaY, FIRST_TREE.z)

  // Paver apron ring around the future soil ring (S12 plants the tree).
  writer.disc(center.clone().setY(plazaY + 0.02), FIRST_TREE.plazaRadius, 'cast', { uvScale: 0.35 })
  // Raised soil ring wall.
  const wallSegments = 40
  for (let s = 0; s < wallSegments; s++) {
    const angle = (s / wallSegments) * Math.PI * 2
    writer.box({
      center: center
        .clone()
        .add(
          new Vector3(
            Math.cos(angle) * FIRST_TREE.soilRingRadius,
            0.28,
            Math.sin(angle) * FIRST_TREE.soilRingRadius,
          ),
        ),
      size: new Vector3(0.35, 0.56, (2 * Math.PI * FIRST_TREE.soilRingRadius) / wallSegments + 0.03),
      rotationY: -angle,
      slot: 'cast',
      chamfer: 0.025,
    })
  }
  // Soil fill — the only open earth on Mars, waiting for its tree (S12).
  writer.disc(center.clone().setY(plazaY + 0.5), FIRST_TREE.soilRingRadius - 0.12, 'soil', {
    uvScale: 0.8,
  })
  services.colliders.push({
    kind: 'cylinder',
    center: center.clone().setY(plazaY + 0.3),
    halfHeight: 0.32,
    radius: FIRST_TREE.soilRingRadius + 0.2,
  })

  // Ring bench facing the tree.
  const benchRadius = FIRST_TREE.soilRingRadius + 3.4
  for (let s = 0; s < 8; s++) {
    if (s % 2 === 0) continue // gaps for the paths
    const angle = (s / 8) * Math.PI * 2
    const spot = center
      .clone()
      .add(new Vector3(Math.cos(angle) * benchRadius, 0, Math.sin(angle) * benchRadius))
      .setY(plazaY)
    const yaw = Math.atan2(center.x - spot.x, center.z - spot.z)
    const seat = bench(writer, spot, yaw)
    services.seats.push({ ...seat, label: 'Sit with the tree' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(plazaY + 0.3),
      size: new Vector3(1.9, 0.6, 0.6),
      yaw,
    })
  }

  // Founding plaque.
  const plaque = new Mesh(
    new PlaneGeometry(0.9, 0.42),
    signageMaterial(['THE FIRST TREE', 'GINKGO BILOBA · PLANTED SOL 1', 'FOR THE CITY TO COME'], {
      background: '#2b2723',
      widthPx: 512,
    }),
  )
  plaque.position.set(center.x + FIRST_TREE.soilRingRadius + 0.55, plazaY + 0.72, center.z + 1.2)
  plaque.rotation.y = Math.PI / 2 + 0.15
  plaque.rotation.x = -0.35
  services.group.add(plaque)
  writer.box({
    center: new Vector3(center.x + FIRST_TREE.soilRingRadius + 0.62, plazaY + 0.42, center.z + 1.2),
    size: new Vector3(0.16, 0.9, 1.0),
    rotationY: Math.PI / 2 + 0.15,
    slot: 'dark',
    chamfer: 0.02,
  })

  // Capacity sign at the plaza's south entry.
  const capacity = new Mesh(
    new PlaneGeometry(1.5, 0.4),
    signageMaterial(['ELYSIUM COMMONS · MAX OCCUPANCY 4 000'], {
      background: '#25231f',
      widthPx: 768,
    }),
  )
  capacity.position.set(center.x + 3.4, plazaY + 1.5, center.z + FIRST_TREE.plazaRadius + 1.4)
  capacity.rotation.y = Math.PI
  services.group.add(capacity)
  writer.box({
    center: new Vector3(center.x + 3.4, plazaY + 0.85, center.z + FIRST_TREE.plazaRadius + 1.46),
    size: new Vector3(0.09, 1.7, 0.09),
    slot: 'dark',
  })
}
