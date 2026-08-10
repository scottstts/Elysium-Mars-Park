import { Group, Vector3 } from 'three'
import { PartWriter } from '../archkit/writer'
import { kitMaterials } from '../materials/library'

/**
 * One tram car with REAL window apertures: the shell is panels (floor band,
 * pillars, roof band), never a solid box with glass stickers — the player
 * rides inside and the view through the glass IS the arrival. Origin at
 * floor center; +Z is travel.
 */
export interface TramCar {
  group: Group
  doorsLeft: Group
  doorsRight: Group
  /** Cabin seat surfaces (local space) facing `yaw` (0 = travel). */
  seats: Array<{ position: Vector3; yaw: number }>
}

export const CAR_LENGTH = 8
export const CAR_WIDTH = 2.5
const SILL = 1.1 // window sill height
const HEAD = 1.98 // window head height
const ROOF = 2.3

export function buildTramCar(): TramCar {
  const writer = new PartWriter()
  const materials = kitMaterials()
  const half = CAR_LENGTH / 2
  const side = CAR_WIDTH / 2

  // Floor + underframe + bogie skirts.
  writer.box({
    center: new Vector3(0, -0.14, 0),
    size: new Vector3(CAR_WIDTH, 0.36, CAR_LENGTH),
    slot: 'dark',
    chamfer: 0.05,
  })
  writer.box({
    center: new Vector3(0, 0.045, 0),
    size: new Vector3(CAR_WIDTH - 0.16, 0.09, CAR_LENGTH - 0.2),
    slot: 'deck',
  })
  for (const end of [-1, 1]) {
    writer.box({
      center: new Vector3(0, -0.44, end * 2.55),
      size: new Vector3(CAR_WIDTH - 0.55, 0.42, 1.8),
      slot: 'dark',
      chamfer: 0.04,
    })
  }

  // Side shells: lower band, window pillars, upper band. Door aperture at
  // the center (−0.95..0.95), windows rear (−3.3..−1.35) and front
  // (1.35..3.3); glass fills the apertures, inset 15 mm.
  for (const s of [-1, 1]) {
    const x = s * (side - 0.06)
    writer.box({
      center: new Vector3(x, SILL / 2, 0),
      size: new Vector3(0.12, SILL, CAR_LENGTH),
      slot: 'habShell',
      chamfer: 0.03,
      uvScale: 0.5,
    })
    writer.box({
      center: new Vector3(x, (HEAD + ROOF) / 2, 0),
      size: new Vector3(0.12, ROOF - HEAD, CAR_LENGTH),
      slot: 'habShell',
      chamfer: 0.03,
    })
    // Pillars: ends + door jambs + mid-window mullions.
    for (const pz of [-half + 0.2, -1.15, 1.15, half - 0.2]) {
      writer.box({
        center: new Vector3(x, (SILL + HEAD) / 2, pz),
        size: new Vector3(0.12, HEAD - SILL, 0.4),
        slot: 'habShell',
        chamfer: 0.025,
      })
    }
    for (const wz of [-2.32, 2.32]) {
      writer.box({
        center: new Vector3(x, (SILL + HEAD) / 2, wz),
        size: new Vector3(0.1, HEAD - SILL, 0.09),
        slot: 'dark',
      })
    }
    // Window glass (real apertures behind it).
    for (const [z0, z1] of [
      [-3.3, -1.35],
      [1.35, 3.3],
    ] as const) {
      writer.box({
        center: new Vector3(s * (side - 0.1), (SILL + HEAD) / 2, (z0 + z1) / 2),
        size: new Vector3(0.025, HEAD - SILL - 0.06, z1 - z0),
        slot: 'cabinGlass',
      })
    }
    // Orange accent + polished sill cap.
    writer.box({
      center: new Vector3(x + s * 0.065, 0.42, 0),
      size: new Vector3(0.015, 0.12, CAR_LENGTH - 0.6),
      slot: 'orange',
    })
    writer.box({
      center: new Vector3(x + s * 0.045, SILL + 0.015, 0),
      size: new Vector3(0.05, 0.03, CAR_LENGTH - 0.5),
      slot: 'steelEdge',
      chamfer: 0.008,
    })
  }

  // Ends: band + pillars + big window + headlight bar.
  for (const e of [-1, 1]) {
    const z = e * (half - 0.06)
    writer.box({
      center: new Vector3(0, SILL / 2, z),
      size: new Vector3(CAR_WIDTH, SILL, 0.12),
      slot: 'habShell',
      chamfer: 0.03,
    })
    writer.box({
      center: new Vector3(0, (HEAD + ROOF) / 2, z),
      size: new Vector3(CAR_WIDTH, ROOF - HEAD, 0.12),
      slot: 'habShell',
      chamfer: 0.03,
    })
    for (const px of [-side + 0.18, side - 0.18]) {
      writer.box({
        center: new Vector3(px, (SILL + HEAD) / 2, z),
        size: new Vector3(0.36, HEAD - SILL, 0.12),
        slot: 'habShell',
        chamfer: 0.025,
      })
    }
    writer.box({
      center: new Vector3(0, (SILL + HEAD) / 2, e * (half - 0.1)),
      size: new Vector3(CAR_WIDTH - 0.72, HEAD - SILL - 0.06, 0.025),
      slot: 'cabinGlass',
    })
    writer.box({
      center: new Vector3(0, 0.52, e * (half + 0.005)),
      size: new Vector3(1.4, 0.09, 0.04),
      slot: 'runningLight',
    })
  }

  // Roof + equipment pod + cabin light strip.
  writer.box({
    center: new Vector3(0, ROOF + 0.05, 0),
    size: new Vector3(CAR_WIDTH, 0.14, CAR_LENGTH),
    slot: 'habShell',
    chamfer: 0.05,
    uvScale: 0.5,
  })
  writer.box({
    center: new Vector3(0, ROOF + 0.32, 0),
    size: new Vector3(1.6, 0.34, 5.2),
    slot: 'aluminum',
    chamfer: 0.05,
  })
  writer.box({
    center: new Vector3(0, ROOF - 0.045, 0),
    size: new Vector3(0.5, 0.035, CAR_LENGTH - 2),
    slot: 'runningLight',
  })

  // Seats: front pair faces FORWARD at the front (the view seat), rear pair
  // faces backward — nobody stares at a seat back through the money shot.
  const seats: TramCar['seats'] = []
  for (const [sx, sz, yaw] of [
    [-0.72, 2.55, 0],
    [0.72, 2.55, 0],
    [-0.72, -2.55, Math.PI],
    [0.72, -2.55, Math.PI],
  ] as const) {
    const back = yaw === 0 ? sz - 0.28 : sz + 0.28
    writer.box({
      center: new Vector3(sx, 0.38, sz),
      size: new Vector3(1.0, 0.1, 0.55),
      slot: 'fabricBlue',
      chamfer: 0.025,
    })
    writer.box({
      center: new Vector3(sx, 0.19, sz),
      size: new Vector3(0.9, 0.3, 0.5),
      slot: 'dark',
      chamfer: 0.02,
    })
    writer.box({
      center: new Vector3(sx, 0.8, back),
      size: new Vector3(1.0, 0.76, 0.09),
      slot: 'fabricBlue',
      chamfer: 0.03,
    })
    seats.push({ position: new Vector3(sx, 0.43, sz), yaw })
  }
  for (const pz of [-1.15, 1.15]) {
    writer.tube({
      path: [new Vector3(0.95, 0.1, pz), new Vector3(0.95, ROOF - 0.06, pz)],
      radius: 0.022,
      slot: 'steelEdge',
      radialSegments: 8,
    })
  }

  const group = new Group()
  const body = writer.build(materials)
  body.traverse((o) => {
    o.castShadow = true
  })
  group.add(body)

  // Pocket doors: two independently sliding panels per side. With +Z travel
  // in a right-handed frame, +X local is the LEFT (platform) side.
  const doorsLeft = new Group()
  const doorsRight = new Group()
  for (const [s, doors] of [
    [1, doorsLeft],
    [-1, doorsRight],
  ] as const) {
    for (const panel of [-1, 1]) {
      const doorWriter = new PartWriter()
      doorWriter.box({
        center: new Vector3(s * (side - 0.09), 1.02, panel * 0.44),
        size: new Vector3(0.05, 2.0, 0.86),
        slot: 'habShell',
        chamfer: 0.02,
      })
      doorWriter.box({
        center: new Vector3(s * (side - 0.075), 1.5, panel * 0.44),
        size: new Vector3(0.03, 0.62, 0.52),
        slot: 'cabinGlass',
      })
      doors.add(doorWriter.build(materials))
    }
    group.add(doors)
  }

  return { group, doorsLeft, doorsRight, seats }
}
