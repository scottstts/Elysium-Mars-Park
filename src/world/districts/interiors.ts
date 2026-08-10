import { Group, Mesh, PlaneGeometry, Vector3 } from 'three'
import { PartWriter } from '../../archkit/writer'
import { bench } from '../../archkit/kit'
import { kitMaterials, signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { FARMSIDE, OVERLOOK_LOUNGE, habSites, RESIDENTIAL } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * The four hero interiors (S10): furniture, light coves, and the sliding
 * doors (DoorsSystem animates them). Shel apertures were cut in the
 * district builders; this pass makes the rooms worth entering.
 */
export function buildInteriors(services: DistrictServices): void {
  buildLoungeInterior(services)
  buildOpsInterior(services)
  buildCommonHabInterior(services)
  buildGreenhouseDoors(services)
}

function slidingDoor(
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
  writer.box({
    center: new Vector3(0, 0.25, 0.005),
    size: new Vector3(width - 0.35, 0.7, 0.09),
    slot: 'darkGlass',
  })
  writer.box({
    center: new Vector3(0, -height / 2 + 0.09, 0.006),
    size: new Vector3(width - 0.2, 0.18, 0.09),
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

function buildLoungeInterior(services: DistrictServices): void {
  const { writer } = services
  const lounge = OVERLOOK_LOUNGE
  const ground = lounge.y
  const center = new Vector3(lounge.x, ground, lounge.z)
  const depth = lounge.depth

  // Floor + ceiling cove light.
  writer.box({
    center: center.clone().setY(ground + 0.14),
    size: new Vector3(depth - 0.5, 0.08, lounge.width - 0.5),
    slot: 'deck',
  })
  writer.box({
    center: center.clone().setY(ground + 3.28),
    size: new Vector3(0.4, 0.04, lounge.width - 3),
    slot: 'runningLight',
  })

  // Two rows of lounge benches facing the window wall (west), low tables.
  for (const rowX of [-0.4, 2.2]) {
    for (const seatZ of [-8, -3.4, 1.2, 5.8]) {
      const spot = new Vector3(lounge.x + rowX, ground + 0.16, lounge.z + seatZ)
      const seat = bench(services.writer, spot, -Math.PI / 2)
      services.seats.push({ ...seat, label: 'Watch the planet' })
    }
  }
  for (const tz of [-5.7, 3.5]) {
    writer.box({
      center: new Vector3(lounge.x + 0.9, ground + 0.42, lounge.z + tz),
      size: new Vector3(0.9, 0.06, 1.4),
      slot: 'aluminum',
      chamfer: 0.015,
    })
    writer.box({
      center: new Vector3(lounge.x + 0.9, ground + 0.24, lounge.z + tz),
      size: new Vector3(0.12, 0.34, 0.12),
      slot: 'dark',
    })
  }
  // Coffee console at the north end + wall plate.
  writer.box({
    center: new Vector3(lounge.x + 1.2, ground + 0.62, lounge.z - lounge.width / 2 + 1.2),
    size: new Vector3(1.8, 0.92, 0.7),
    slot: 'habShell',
    chamfer: 0.03,
  })
  writer.box({
    center: new Vector3(lounge.x + 1.2, ground + 1.28, lounge.z - lounge.width / 2 + 1.05),
    size: new Vector3(0.4, 0.4, 0.34),
    slot: 'aluminum',
    chamfer: 0.02,
  })
  services.colliders.push({
    kind: 'box',
    center: new Vector3(lounge.x + 1.2, ground + 0.62, lounge.z - lounge.width / 2 + 1.2),
    size: new Vector3(1.8, 0.95, 0.7),
  })

  slidingDoor(
    services,
    new Vector3(lounge.x + depth / 2 - 0.15, ground + 1.32, lounge.z + 2),
    Math.PI / 2,
    'Enter the lounge',
  )
}

function buildOpsInterior(services: DistrictServices): void {
  const { writer } = services
  const anchor = services.opsAnchor
  if (!anchor) return
  const yaw = anchor.yaw
  const base = anchor.position
  const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))

  // Desk run under the window strip, console slabs, an operator stool.
  writer.box({
    center: base.clone().setY(base.y + 0.78).addScaledVector(across, -1.05),
    size: new Vector3(3.9, 0.07, 0.75),
    rotationY: yaw,
    slot: 'aluminum',
    chamfer: 0.015,
  })
  for (const legA of [-1.7, 0, 1.7]) {
    writer.box({
      center: base
        .clone()
        .setY(base.y + 0.4)
        .addScaledVector(across, -1.05)
        .addScaledVector(along, legA),
      size: new Vector3(0.1, 0.76, 0.6),
      rotationY: yaw,
      slot: 'dark',
    })
  }
  writer.box({
    center: base.clone().setY(base.y + 0.5).addScaledVector(across, 0.9),
    size: new Vector3(0.46, 0.5, 0.46),
    rotationY: yaw,
    slot: 'fabricBlue',
    chamfer: 0.04,
  })
  writer.box({
    center: base.clone().setY(base.y + 2.72),
    size: new Vector3(3.4, 0.04, 0.36),
    rotationY: yaw,
    slot: 'runningLight',
  })
  services.colliders.push({
    kind: 'box',
    center: base.clone().setY(base.y + 0.6).addScaledVector(across, -1.05),
    size: new Vector3(3.9, 0.8, 0.8),
    yaw,
  })

  slidingDoor(
    services,
    base.clone().setY(base.y + 1.27).addScaledVector(along, -2.3 + 0.08),
    yaw,
    'Enter ops',
    1.2,
    2.25,
  )
}

function buildCommonHabInterior(services: DistrictServices): void {
  const { writer, rng } = services
  const site = habSites()[RESIDENTIAL.commonHabIndex]
  const centerYaw = Math.atan2(-site.x, -site.z)
  const along = new Vector3(Math.sin(centerYaw + Math.PI / 2), 0, Math.cos(centerYaw + Math.PI / 2))
  const forward = new Vector3(Math.sin(centerYaw), 0, Math.cos(centerYaw))
  const ground = interiorHeight(site.x, site.z)
  const floorY = ground + 0.42
  const base = new Vector3(site.x, floorY, site.z)

  // Kitchenette run along the back wall.
  const counter = base.clone().addScaledVector(forward, -1.9)
  writer.box({
    center: counter.clone().addScaledVector(along, -2.4).setY(floorY + 0.46),
    size: new Vector3(4.4, 0.92, 0.65),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'habShell',
    chamfer: 0.025,
  })
  writer.box({
    center: counter.clone().addScaledVector(along, -2.4).setY(floorY + 0.945),
    size: new Vector3(4.5, 0.05, 0.7),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'steelEdge',
    chamfer: 0.012,
  })
  writer.box({
    center: counter.clone().addScaledVector(along, -3.6).setY(floorY + 1.06),
    size: new Vector3(0.5, 0.18, 0.5),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'aluminum',
    chamfer: 0.02,
  })
  writer.box({
    center: counter.clone().addScaledVector(along, -2.4).setY(floorY + 1.9),
    size: new Vector3(4.4, 0.7, 0.4),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'habShell',
    chamfer: 0.025,
  })
  services.colliders.push({
    kind: 'box',
    center: counter.clone().addScaledVector(along, -2.4).setY(floorY + 0.5),
    size: new Vector3(4.4, 1, 0.7),
    yaw: centerYaw + Math.PI / 2,
  })

  // The table, mid-game: board, mugs, scattered tokens; four stools.
  const table = base.clone().addScaledVector(along, 1.6)
  writer.box({
    center: table.clone().setY(floorY + 0.72),
    size: new Vector3(1.7, 0.06, 1.1),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'aluminum',
    chamfer: 0.015,
  })
  writer.box({
    center: table.clone().setY(floorY + 0.37),
    size: new Vector3(0.14, 0.68, 0.14),
    slot: 'dark',
  })
  writer.box({
    center: table.clone().setY(floorY + 0.765),
    size: new Vector3(0.62, 0.02, 0.62),
    rotationY: centerYaw + Math.PI / 2 + 0.2,
    slot: 'fabricRust',
  })
  const tokenRng = rng.fork('board-game')
  for (let i = 0; i < 8; i++) {
    writer.box({
      center: table
        .clone()
        .setY(floorY + 0.79)
        .addScaledVector(along, tokenRng.range(-0.24, 0.24))
        .addScaledVector(forward, tokenRng.range(-0.24, 0.24)),
      size: new Vector3(0.045, 0.02, 0.045),
      rotationY: tokenRng.range(0, Math.PI),
      slot: i % 2 === 0 ? 'orange' : 'playBlue',
    })
  }
  for (const [ax, az] of [
    [0.75, 0.4],
    [0.75, -0.4],
    [-0.75, 0.4],
    [-0.75, -0.4],
  ] as const) {
    const stool = table.clone().addScaledVector(along, ax).addScaledVector(forward, az)
    writer.box({
      center: stool.clone().setY(floorY + 0.24),
      size: new Vector3(0.4, 0.48, 0.4),
      rotationY: centerYaw,
      slot: 'fabricSand',
      chamfer: 0.05,
    })
    services.seats.push({
      seat: stool.clone().setY(floorY + 0.48),
      yaw: Math.atan2(table.x - stool.x, table.z - stool.z),
      label: 'Join the game',
    })
  }
  services.colliders.push({
    kind: 'box',
    center: table.clone().setY(floorY + 0.45),
    size: new Vector3(1.7, 0.75, 1.1),
    yaw: centerYaw + Math.PI / 2,
  })

  // Sofa bench + shelf + ceiling light.
  const sofa = base.clone().addScaledVector(along, 4.6)
  const sofaSeat = bench(writer, sofa.clone().setY(floorY), centerYaw + Math.PI)
  services.seats.push({ ...sofaSeat, label: 'Sit' })
  writer.box({
    center: base.clone().addScaledVector(along, -5.2).setY(floorY + 1.1),
    size: new Vector3(0.4, 2.2, 1.4),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'habShell',
    chamfer: 0.025,
  })
  writer.box({
    center: base.clone().setY(floorY + 2.9),
    size: new Vector3(0.4, 0.04, 8),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'runningLight',
  })

  slidingDoor(
    services,
    base.clone().addScaledVector(forward, 2.41).setY(floorY + 1.15),
    centerYaw,
    'Enter the common hab',
    1.28,
    2.28,
  )
}

function buildGreenhouseDoors(services: DistrictServices): void {
  // The middle glasshouse becomes enterable: its lane door slides.
  const house = FARMSIDE.glasshouses[1]
  const yaw = house.rotation
  const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const ground = interiorHeight(house.x, house.z)
  const doorCenter = new Vector3(house.x, ground + 1.16, house.z)
    .addScaledVector(along, -house.length / 2 - 0.02)
    .addScaledVector(across, 1.6)
  slidingDoor(services, doorCenter, yaw, 'Enter the greenhouse', 1.18, 2.24)

  // Aisle decks between the racks so the walk reads intentional.
  for (const aisle of [-house.width / 4 + 0.4, house.width / 4 - 0.4]) {
    services.writer.box({
      center: new Vector3(house.x, ground + 0.06, house.z).addScaledVector(across, aisle),
      size: new Vector3(1.3, 0.1, house.length - 4),
      rotationY: yaw,
      slot: 'deck',
    })
  }
}

/** Sign hung inside the lounge — a quiet joke for those who look back. */
export function loungeInteriorSign(): Mesh {
  return new Mesh(
    new PlaneGeometry(1.5, 0.34),
    signageMaterial(['THE PLANET IS OPEN ALL DAY'], {
      background: '#2b2723',
      widthPx: 640,
    }),
  )
}
