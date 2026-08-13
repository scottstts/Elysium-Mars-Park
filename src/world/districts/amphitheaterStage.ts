import { Vector3 } from 'three'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  bevel,
  box,
  cleanMesh,
  loft,
  meshObj,
  prismXZ,
  revolve,
  rotY,
  rotateZ,
  smoothShade,
  translate,
  tubeAlong,
  writeInto,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { DistrictServices } from './types'

/**
 * Shared, inspectable contract between the retained cast platform and the
 * concert-stage kit mounted on it. All dimensions are real metres.
 */
export interface AmphitheaterStagePlan {
  center: { x: number; z: number }
  facing: number
  deckTop: number
  halfWidth: number
  front: number
  back: number
}

export const AMPHITHEATER_STAGE_SCALE = 1.8

export const AMPHITHEATER_STAGE_DIAGNOSTICS = Object.freeze({
  scale: AMPHITHEATER_STAGE_SCALE,
  trussTowers: 4,
  roofRibs: 5,
  stereoStacks: 2,
  subwoofers: 2,
  lineArrayCabinets: 6,
  stageMonitors: 2,
  frontLights: 9,
  lecternColliders: 3,
  microphoneSocketForwardOffset: -0.17,
  microphoneCapsuleForwardOffset: -0.465,
})

type StageSlot =
  | 'aluminum'
  | 'dark'
  | 'stageWood'
  | 'stageBrass'
  | 'stageBlack'
  | 'stageCone'
  | 'stageCanopy'
  | 'utilityLight'

const CIRCLE_8 = circleProfile(1, 8)
const CIRCLE_10 = circleProfile(1, 10)

function circleProfile(radius: number, segments: number): Vec2[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as Vec2
  })
}

/**
 * The concert kit is authored once in a stage-local Z-up frame:
 * +X faces the audience, +Y crosses stage left-to-right, +Z is height.
 */
class StageWriter {
  readonly services: DistrictServices
  readonly plan: AmphitheaterStagePlan
  readonly cos: number
  readonly sin: number
  parts = 0

  constructor(services: DistrictServices, plan: AmphitheaterStagePlan) {
    this.services = services
    this.plan = plan
    this.cos = Math.cos(plan.facing)
    this.sin = Math.sin(plan.facing)
  }

  emit(slot: StageSlot, part: MeshData): void {
    rotateZ(part, this.plan.facing)
    translate(part, [this.plan.center.x, this.plan.center.z, 0])
    writeInto(this.services.writer, slot, cleanMesh(part))
    this.parts++
  }

  tube(slot: StageSlot, path: Vec3[], radius: number, segments = 8): void {
    const unit = segments > 8 ? CIRCLE_10 : CIRCLE_8
    const profile = unit.map(([x, y]) => [x * radius, y * radius] as Vec2)
    this.emit(slot, smoothShade(tubeAlong(path, profile, { cap: true }), SMOOTH.turned))
  }

  localToWorld(forward: number, lateral: number, height: number): Vector3 {
    return new Vector3(
      this.plan.center.x + this.cos * forward - this.sin * lateral,
      height,
      this.plan.center.z + this.sin * forward + this.cos * lateral,
    )
  }

  collider(forward: number, lateral: number, height: number, depth: number, width: number, tall: number): void {
    this.services.colliders.push({
      kind: 'box',
      center: this.localToWorld(forward, lateral, height),
      size: new Vector3(depth, tall, width),
      yaw: -this.plan.facing,
    })
  }
}

function filletedBox(
  writer: StageWriter,
  slot: StageSlot,
  bounds: [number, number, number, number, number, number],
  radius: number = BEVEL.panel,
  segments = 2,
): void {
  writer.emit(slot, bevel(box(...bounds), radius, segments))
}

function ringAt(forward: number, lateral: number, halfDepth: number, halfWidth: number, height: number): Vec3[] {
  return [
    [forward - halfDepth, lateral - halfWidth, height],
    [forward + halfDepth, lateral - halfWidth, height],
    [forward + halfDepth, lateral + halfWidth, height],
    [forward - halfDepth, lateral + halfWidth, height],
  ]
}

function buildTower(
  writer: StageWriter,
  forward: number,
  lateral: number,
  base: number,
  top: number,
): void {
  const half = 0.19
  const foot = 0.72
  filletedBox(
    writer,
    'stageBlack',
    [forward - foot / 2, lateral - foot / 2, base + 0.004, forward + foot / 2, lateral + foot / 2, base + 0.052],
    0.018,
    2,
  )

  // Four continuous chords; every brace terminates on their centrelines.
  for (const df of [-half, half]) {
    for (const dl of [-half, half]) {
      writer.tube('aluminum', [[forward + df, lateral + dl, base + 0.052], [forward + df, lateral + dl, top]], 0.048)
    }
  }

  const bays = Math.max(5, Math.round((top - base) / 0.82))
  for (let bay = 0; bay <= bays; bay++) {
    const z = base + 0.08 + ((top - base - 0.12) * bay) / bays
    writer.tube('aluminum', [[forward - half, lateral - half, z], [forward + half, lateral - half, z]], 0.028)
    writer.tube('aluminum', [[forward + half, lateral - half, z], [forward + half, lateral + half, z]], 0.028)
    writer.tube('aluminum', [[forward + half, lateral + half, z], [forward - half, lateral + half, z]], 0.028)
    writer.tube('aluminum', [[forward - half, lateral + half, z], [forward - half, lateral - half, z]], 0.028)
  }
  for (let bay = 0; bay < bays; bay++) {
    const z0 = base + 0.08 + ((top - base - 0.12) * bay) / bays
    const z1 = base + 0.08 + ((top - base - 0.12) * (bay + 1)) / bays
    const swap = bay % 2 === 0
    for (const fixedL of [-half, half]) {
      writer.tube(
        'aluminum',
        [
          [forward + (swap ? -half : half), lateral + fixedL, z0],
          [forward + (swap ? half : -half), lateral + fixedL, z1],
        ],
        0.024,
      )
    }
    for (const fixedF of [-half, half]) {
      writer.tube(
        'aluminum',
        [
          [forward + fixedF, lateral + (swap ? -half : half), z0],
          [forward + fixedF, lateral + (swap ? half : -half), z1],
        ],
        0.024,
      )
    }
  }

  // Four real anchor bolts stand proud of the powder-coated foot plate.
  for (const df of [-0.26, 0.26]) {
    for (const dl of [-0.26, 0.26]) {
      const bolt = revolve(
        [
          [0, 0],
          [0.026, 0],
          [0.033, 0.012],
          [0.033, 0.038],
          [0.025, 0.05],
          [0, 0.05],
        ],
        12,
      )
      translate(bolt, [forward + df, lateral + dl, base + 0.052])
      writer.emit('stageBrass', bolt)
    }
  }
  writer.collider(forward, lateral, base + 1.2, foot, foot, 2.4)
}

function canopyHeight(lateral: number, halfSpan: number, eave: number): number {
  const t = Math.min(1, Math.abs(lateral) / halfSpan)
  return eave + 0.72 * (1 - t * t)
}

function archedRoofTruss(
  writer: StageWriter,
  forward: number,
  halfSpan: number,
  eave: number,
): void {
  const segments = 12
  const upper: Vec3[] = []
  const lower: Vec3[] = []
  for (let index = 0; index <= segments; index++) {
    const lateral = -halfSpan + (2 * halfSpan * index) / segments
    const z = canopyHeight(lateral, halfSpan, eave) - 0.12
    upper.push([forward, lateral, z])
    lower.push([forward, lateral, z - 0.48])
  }
  writer.tube('aluminum', upper, 0.052)
  writer.tube('aluminum', lower, 0.044)
  for (let index = 0; index <= segments; index++) {
    writer.tube('aluminum', [upper[index], lower[index]], 0.026)
    if (index < segments) {
      writer.tube('aluminum', [index % 2 === 0 ? upper[index] : lower[index], index % 2 === 0 ? lower[index + 1] : upper[index + 1]], 0.025)
    }
  }
}

function longitudinalRoofTruss(
  writer: StageWriter,
  lateral: number,
  back: number,
  front: number,
  eave: number,
): void {
  const top = eave - 0.12
  const bottom = eave - 0.6
  writer.tube('aluminum', [[back, lateral, top], [front, lateral, top]], 0.052)
  writer.tube('aluminum', [[back, lateral, bottom], [front, lateral, bottom]], 0.044)
  const bays = 6
  for (let bay = 0; bay <= bays; bay++) {
    const f = back + ((front - back) * bay) / bays
    writer.tube('aluminum', [[f, lateral, top], [f, lateral, bottom]], 0.025)
    if (bay < bays) {
      const next = back + ((front - back) * (bay + 1)) / bays
      writer.tube('aluminum', [[f, lateral, bay % 2 === 0 ? top : bottom], [next, lateral, bay % 2 === 0 ? bottom : top]], 0.025)
    }
  }
}

function canopyShell(
  back: number,
  front: number,
  halfSpan: number,
  eave: number,
): MeshData {
  const rows = 8
  const columns = 24
  const thickness = 0.065
  const verts: Vec3[] = []
  const faces: number[][] = []
  const index = (layer: number, row: number, column: number): number =>
    layer * (rows + 1) * (columns + 1) + row * (columns + 1) + column

  for (const offset of [0, -thickness]) {
    for (let row = 0; row <= rows; row++) {
      const forward = back + ((front - back) * row) / rows
      for (let column = 0; column <= columns; column++) {
        const lateral = -halfSpan + (2 * halfSpan * column) / columns
        const longitudinalCrown = 0.08 * Math.sin((Math.PI * row) / rows)
        verts.push([forward, lateral, canopyHeight(lateral, halfSpan, eave) + offset + longitudinalCrown])
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = index(0, row, column)
      const b = index(0, row + 1, column)
      const c = index(0, row + 1, column + 1)
      const d = index(0, row, column + 1)
      faces.push([a, b, c, d])
      faces.push([
        index(1, row, column + 1),
        index(1, row + 1, column + 1),
        index(1, row + 1, column),
        index(1, row, column),
      ])
    }
  }
  for (let row = 0; row < rows; row++) {
    faces.push([index(0, row, 0), index(1, row, 0), index(1, row + 1, 0), index(0, row + 1, 0)])
    faces.push([
      index(0, row + 1, columns),
      index(1, row + 1, columns),
      index(1, row, columns),
      index(0, row, columns),
    ])
  }
  for (let column = 0; column < columns; column++) {
    faces.push([index(0, 0, column + 1), index(1, 0, column + 1), index(1, 0, column), index(0, 0, column)])
    faces.push([
      index(0, rows, column),
      index(1, rows, column),
      index(1, rows, column + 1),
      index(0, rows, column + 1),
    ])
  }
  return smoothShade(meshObj(verts, faces), SMOOTH.moulded)
}

function buildFrontLight(writer: StageWriter, forward: number, lateral: number, height: number): void {
  const pivot: Vec3 = [forward, lateral, height]
  const angle = 0.5
  const body = revolve(
    [
      [0, -0.28],
      [0.13, -0.27],
      [0.17, -0.19],
      [0.18, 0.14],
      [0.145, 0.23],
      [0, 0.24],
    ],
    18,
    { axis: 'x' },
  )
  rotY(body, angle)
  translate(body, pivot)
  writer.emit('stageBlack', body)

  const lens = revolve(
    [
      [0, 0],
      [0.13, 0],
      [0.142, 0.014],
      [0, 0.02],
    ],
    18,
    { axis: 'x' },
  )
  // The body points down along +X after this tilt; the lens sits at that end.
  translate(lens, [0.235, 0, 0])
  rotY(lens, angle)
  translate(lens, pivot)
  writer.emit('utilityLight', lens)
}

function buildCanopy(writer: StageWriter): void {
  const { deckTop, halfWidth, front, back } = writer.plan
  const towerHalfSpan = halfWidth - 0.9
  const frontTower = front - 0.72
  const backTower = back + 0.72
  const eave = deckTop + 6.15

  for (const forward of [frontTower, backTower]) {
    for (const lateral of [-towerHalfSpan, towerHalfSpan]) {
      buildTower(writer, forward, lateral, deckTop, eave - 0.08)
    }
  }

  for (let rib = 0; rib < AMPHITHEATER_STAGE_DIAGNOSTICS.roofRibs; rib++) {
    const forward = backTower + ((frontTower - backTower) * rib) / (AMPHITHEATER_STAGE_DIAGNOSTICS.roofRibs - 1)
    archedRoofTruss(writer, forward, towerHalfSpan, eave)
  }
  for (const lateral of [-towerHalfSpan, towerHalfSpan]) {
    longitudinalRoofTruss(writer, lateral, backTower, frontTower, eave)
  }

  writer.emit('stageCanopy', canopyShell(backTower - 0.48, frontTower + 0.62, halfWidth - 0.2, eave + 0.06))

  // One continuous lighting pipe under the audience edge. Nine compact cans
  // hang from real clamps rather than floating below the roof.
  const lightHeight = eave - 0.9
  writer.tube('dark', [[frontTower - 0.04, -towerHalfSpan + 0.4, lightHeight], [frontTower - 0.04, towerHalfSpan - 0.4, lightHeight]], 0.042)
  for (let light = 0; light < AMPHITHEATER_STAGE_DIAGNOSTICS.frontLights; light++) {
    const lateral = -towerHalfSpan + 1.15 + ((2 * towerHalfSpan - 2.3) * light) / (AMPHITHEATER_STAGE_DIAGNOSTICS.frontLights - 1)
    writer.tube('dark', [[frontTower - 0.04, lateral, lightHeight + 0.16], [frontTower - 0.04, lateral, lightHeight + 0.02]], 0.022)
    buildFrontLight(writer, frontTower - 0.04, lateral, lightHeight - 0.24)
  }
}

function buildLectern(writer: StageWriter): void {
  const base = writer.plan.deckTop
  const forward = writer.plan.front - 2.05
  const bodyBottom = base + 0.14

  // Layered plinth, each course ending before the next begins vertically.
  filletedBox(writer, 'stageWood', [forward - 0.37, -0.47, base + 0.006, forward + 0.37, 0.47, base + 0.075], 0.028, 3)
  filletedBox(writer, 'stageBrass', [forward - 0.32, -0.415, base + 0.075, forward + 0.32, 0.415, base + 0.098], 0.008, 2)
  filletedBox(writer, 'stageWood', [forward - 0.29, -0.39, base + 0.098, forward + 0.29, 0.39, bodyBottom], 0.018, 2)

  // One tapered carcass loft. The waist and shoulder are derived rings rather
  // than boxes intersecting around a hollow centre.
  const body = smoothShade(
    loft(
      [
        ringAt(forward, 0, 0.285, 0.37, bodyBottom),
        ringAt(forward - 0.015, 0, 0.245, 0.335, base + 0.54),
        ringAt(forward - 0.005, 0, 0.31, 0.405, base + 1.02),
      ],
      { closeV: true, capStart: true, capEnd: true },
    ),
    SMOOTH.moulded,
  )
  writer.emit('stageWood', body)

  // Raised audience panel and its four-sided brass reveal. All applied pieces
  // stand 5–9 mm proud, so no coincident faces sit on the carcass.
  filletedBox(writer, 'stageWood', [forward + 0.286, -0.3, base + 0.29, forward + 0.323, 0.3, base + 0.86], 0.018, 3)
  const panelX0 = forward + 0.324
  const panelX1 = panelX0 + 0.018
  filletedBox(writer, 'stageBrass', [panelX0, -0.325, base + 0.255, panelX1, 0.325, base + 0.282], 0.006, 2)
  filletedBox(writer, 'stageBrass', [panelX0, -0.325, base + 0.868, panelX1, 0.325, base + 0.895], 0.006, 2)
  filletedBox(writer, 'stageBrass', [panelX0, -0.325, base + 0.282, panelX1, -0.3, base + 0.868], 0.006, 2)
  filletedBox(writer, 'stageBrass', [panelX0, 0.3, base + 0.282, panelX1, 0.325, base + 0.868], 0.006, 2)
  for (const lateral of [-0.17, 0, 0.17]) {
    filletedBox(writer, 'stageWood', [panelX1 + 0.001, lateral - 0.012, base + 0.35, panelX1 + 0.018, lateral + 0.012, base + 0.8], 0.007, 2)
  }

  // A genuinely canted reading top: the front edge is higher than the speaker
  // edge, with an integral rolled nose and no late rotation nudge.
  const topProfile: Vec2[] = [
    [forward - 0.43, base + 1.035],
    [forward - 0.405, base + 1.012],
    [forward + 0.37, base + 1.16],
    [forward + 0.418, base + 1.19],
    [forward + 0.42, base + 1.235],
    [forward + 0.385, base + 1.262],
    [forward - 0.41, base + 1.112],
    [forward - 0.438, base + 1.08],
  ]
  writer.emit('stageWood', smoothShade(prismXZ(topProfile, -0.49, 0.49), SMOOTH.top))

  // Brass reading lip follows the high front edge and terminates in collars.
  writer.tube('stageBrass', [[forward + 0.39, -0.4, base + 1.275], [forward + 0.39, 0.4, base + 1.275]], 0.014, 10)

  // Gooseneck microphone: one swept path, then a dimensioned capsule on the
  // same centreline. It grows from a brass socket in the reading surface.
  const socket = revolve(
    [
      [0, 0],
      [0.048, 0],
      [0.055, 0.018],
      [0.048, 0.055],
      [0, 0.064],
    ],
    18,
  )
  translate(socket, [forward + AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneSocketForwardOffset, 0, base + 1.1])
  writer.emit('stageBrass', socket)
  writer.tube(
    'dark',
    [
      [forward - 0.17, 0, base + 1.15],
      [forward - 0.22, 0, base + 1.34],
      [forward - 0.29, 0, base + 1.49],
      [forward - 0.39, 0, base + 1.54],
    ],
    0.013,
    10,
  )
  const capsule = revolve(
    [
      [0, -0.075],
      [0.031, -0.064],
      [0.038, -0.045],
      [0.038, 0.045],
      [0.031, 0.064],
      [0, 0.075],
    ],
    18,
    { axis: 'x' },
  )
  translate(capsule, [forward + AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneCapsuleForwardOffset, 0, base + 1.54])
  writer.emit('stageBlack', capsule)

  // Physics follows the actual three-volume silhouette instead of turning the
  // whole lectern envelope into one blunt block: short plinth, tapered carcass
  // and reading top. The microphone is intentionally non-colliding at 13 mm.
  writer.collider(forward, 0, base + 0.07, 0.74, 0.94, 0.14)
  writer.collider(forward - 0.005, 0, base + 0.58, 0.62, 0.81, 0.88)
  writer.collider(forward - 0.009, 0, base + 1.143, 0.858, 0.98, 0.27)
}

function speakerDriver(
  writer: StageWriter,
  front: number,
  lateral: number,
  height: number,
  radius: number,
): void {
  const surround = revolve(
    [
      [radius * 0.56, -0.012],
      [radius * 0.9, 0],
      [radius * 1.03, 0.025],
      [radius * 0.98, 0.052],
      [radius * 0.61, 0.026],
    ],
    28,
    { axis: 'x' },
  )
  translate(surround, [front, lateral, height])
  writer.emit('stageCone', surround)

  const cone = revolve(
    [
      [0, -radius * 0.23],
      [radius * 0.22, -radius * 0.2],
      [radius * 0.58, -radius * 0.08],
      [radius * 0.78, 0.008],
    ],
    28,
    { axis: 'x' },
  )
  translate(cone, [front + 0.01, lateral, height])
  writer.emit('stageCone', cone)

  const cap = revolve(
    [
      [0, -radius * 0.07],
      [radius * 0.22, -radius * 0.045],
      [radius * 0.28, 0.014],
    ],
    22,
    { axis: 'x' },
  )
  translate(cap, [front + 0.045, lateral, height])
  writer.emit('stageBlack', cap)
}

function lineArrayCabinet(
  writer: StageWriter,
  forward: number,
  lateral: number,
  base: number,
  index: number,
): void {
  const width = 1.14
  const depth = 0.64
  const tall = 0.62
  const z0 = base + index * 0.64
  const tilt = (-index * 2.5 * Math.PI) / 180
  const pivot: Vec3 = [forward, lateral, z0 + tall / 2]

  const cabinet = bevel(
    box(forward - depth / 2, lateral - width / 2, z0, forward + depth / 2, lateral + width / 2, z0 + tall),
    0.028,
    3,
  )
  rotY(cabinet, tilt, pivot)
  writer.emit('stageBlack', cabinet)

  const baffle = bevel(
    box(forward + depth / 2 + 0.004, lateral - width / 2 + 0.055, z0 + 0.045, forward + depth / 2 + 0.025, lateral + width / 2 - 0.055, z0 + tall - 0.045),
    0.012,
    2,
  )
  rotY(baffle, tilt, pivot)
  writer.emit('stageBlack', baffle)

  const front = forward + depth / 2 + 0.028
  const driver = revolve(
    [
      [0, -0.045],
      [0.13, -0.028],
      [0.18, 0.012],
      [0.17, 0.035],
    ],
    22,
    { axis: 'x' },
  )
  translate(driver, [front, lateral - 0.24, z0 + tall * 0.48])
  rotY(driver, tilt, pivot)
  writer.emit('stageCone', driver)

  const horn = loft(
    [
      [
        [front - 0.1, lateral + 0.14, z0 + tall * 0.34],
        [front - 0.1, lateral + 0.14, z0 + tall * 0.64],
        [front - 0.1, lateral + 0.33, z0 + tall * 0.64],
        [front - 0.1, lateral + 0.33, z0 + tall * 0.34],
      ],
      [
        [front + 0.006, lateral + 0.07, z0 + tall * 0.24],
        [front + 0.006, lateral + 0.07, z0 + tall * 0.74],
        [front + 0.006, lateral + 0.4, z0 + tall * 0.74],
        [front + 0.006, lateral + 0.4, z0 + tall * 0.24],
      ],
    ],
    { closeV: true, capStart: true, capEnd: false },
  )
  rotY(horn, tilt, pivot)
  writer.emit('stageCone', horn)
}

function buildStereoStack(writer: StageWriter, lateral: number): void {
  const deck = writer.plan.deckTop
  const forward = writer.plan.back + 1.48
  const subWidth = 1.62
  const subDepth = 0.92
  const subHeight = 1.58

  filletedBox(
    writer,
    'stageBlack',
    [forward - subDepth / 2, lateral - subWidth / 2, deck + 0.008, forward + subDepth / 2, lateral + subWidth / 2, deck + subHeight],
    0.045,
    3,
  )
  filletedBox(
    writer,
    'stageBlack',
    [forward + subDepth / 2 + 0.004, lateral - subWidth / 2 + 0.075, deck + 0.075, forward + subDepth / 2 + 0.03, lateral + subWidth / 2 - 0.075, deck + subHeight - 0.075],
    0.018,
    2,
  )
  for (const height of [deck + 0.49, deck + 1.08]) {
    speakerDriver(writer, forward + subDepth / 2 + 0.034, lateral, height, 0.3)
  }
  // Protective corner shoes and top rigging plate.
  for (const side of [-1, 1]) {
    filletedBox(
      writer,
      'aluminum',
      [forward + subDepth / 2 + 0.031, lateral + side * (subWidth / 2 - 0.075) - 0.045, deck + 0.035, forward + subDepth / 2 + 0.07, lateral + side * (subWidth / 2 - 0.075) + 0.045, deck + 0.22],
      0.008,
      2,
    )
  }
  filletedBox(
    writer,
    'aluminum',
    [forward - 0.29, lateral - 0.48, deck + subHeight, forward + 0.29, lateral + 0.48, deck + subHeight + 0.045],
    0.012,
    2,
  )

  const arrayBase = deck + subHeight + 0.07
  for (let cabinet = 0; cabinet < 3; cabinet++) {
    lineArrayCabinet(writer, forward + 0.02 + cabinet * 0.018, lateral, arrayBase, cabinet)
  }

  writer.collider(forward, lateral, deck + 1.75, subDepth, subWidth, 3.5)
}

function buildAmplifierRack(writer: StageWriter): void {
  const deck = writer.plan.deckTop
  const forward = writer.plan.back + 1.36
  const width = 2.18
  const depth = 0.78
  const tall = 1.72
  filletedBox(
    writer,
    'stageBlack',
    [forward - depth / 2, -width / 2, deck + 0.008, forward + depth / 2, width / 2, deck + tall],
    0.035,
    3,
  )
  const face = forward + depth / 2 + 0.012
  const railY = width / 2 - 0.13
  for (const lateral of [-railY, railY]) {
    filletedBox(writer, 'aluminum', [face, lateral - 0.025, deck + 0.12, face + 0.025, lateral + 0.025, deck + tall - 0.12], 0.006, 2)
  }
  const units = 6
  for (let unit = 0; unit < units; unit++) {
    const z0 = deck + 0.13 + unit * 0.245
    filletedBox(writer, 'aluminum', [face + 0.026, -railY + 0.06, z0, face + 0.052, railY - 0.06, z0 + 0.19], 0.01, 2)
    filletedBox(writer, 'stageBlack', [face + 0.053, -0.62, z0 + 0.043, face + 0.071, 0.26, z0 + 0.15], 0.006, 2)
    filletedBox(writer, 'utilityLight', [face + 0.072, -0.48, z0 + 0.074, face + 0.084, -0.15, z0 + 0.118], 0.005, 2)
    for (const lateral of [0.48, 0.68]) {
      const knob = revolve(
        [
          [0, -0.015],
          [0.035, -0.015],
          [0.041, 0],
          [0.041, 0.025],
          [0, 0.03],
        ],
        14,
        { axis: 'x' },
      )
      translate(knob, [face + 0.076, lateral, z0 + 0.096])
      writer.emit('stageBrass', knob)
    }
  }
  // Touring handles and four casters complete the rack as a movable unit.
  for (const lateral of [-0.78, 0.78]) {
    writer.tube('stageBrass', [[face + 0.065, lateral - 0.12, deck + 1.53], [face + 0.12, lateral - 0.12, deck + 1.58], [face + 0.12, lateral + 0.12, deck + 1.58], [face + 0.065, lateral + 0.12, deck + 1.53]], 0.015, 10)
  }
  writer.collider(forward, 0, deck + tall / 2, depth, width, tall)
}

function buildMonitor(writer: StageWriter, lateral: number): void {
  const deck = writer.plan.deckTop
  const forward = writer.plan.front - 1.18
  const width = 0.96
  const profile: Vec2[] = [
    [forward - 0.45, deck + 0.008],
    [forward + 0.45, deck + 0.008],
    [forward + 0.45, deck + 0.16],
    [forward - 0.35, deck + 0.58],
    [forward - 0.45, deck + 0.51],
  ]
  writer.emit('stageBlack', smoothShade(prismXZ(profile, lateral - width / 2, lateral + width / 2), SMOOTH.moulded))

  const driver = revolve(
    [
      [0, -0.055],
      [0.2, -0.04],
      [0.29, 0.012],
      [0.275, 0.04],
    ],
    24,
    { axis: 'x' },
  )
  rotY(driver, -0.5)
  translate(driver, [forward + 0.04, lateral, deck + 0.43])
  writer.emit('stageCone', driver)
  writer.collider(forward, lateral, deck + 0.28, 0.9, width, 0.56)
}

function buildStereo(writer: StageWriter): void {
  const lateral = Math.min(writer.plan.halfWidth - 3.0, 7.6)
  buildStereoStack(writer, -lateral)
  buildStereoStack(writer, lateral)
  buildAmplifierRack(writer)
  buildMonitor(writer, -3.65)
  buildMonitor(writer, 3.65)

  // The central rack and both stacks are tied by one raised cable bridge at
  // the back edge; it gives the system a readable signal path without laying
  // coplanar cables across the walking deck.
  const z = writer.plan.deckTop + 0.11
  writer.tube('dark', [[writer.plan.back + 0.68, -lateral, z], [writer.plan.back + 0.68, lateral, z]], 0.024, 10)
}

/** Add the complete deterministic concert kit on top of the retained stage. */
export function buildAmphitheaterConcertStage(
  services: DistrictServices,
  plan: AmphitheaterStagePlan,
): { parts: number } {
  const writer = new StageWriter(services, plan)
  buildCanopy(writer)
  buildStereo(writer)
  buildLectern(writer)
  return { parts: writer.parts }
}
