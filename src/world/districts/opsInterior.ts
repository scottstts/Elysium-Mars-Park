import { Vector3 } from 'three'
import {
  MeshData,
  SMOOTH,
  box,
  cleanMesh,
  loft,
  placeYaw,
  polyOffset,
  prism,
  prismYZ,
  revolve,
  rotY,
  roundedRect,
  smoothShade,
  toYUp,
  translate,
  writeInto,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { PartWriter } from '../../archkit/writer'
import { slidingDoor } from './interiorShared'
import type { DistrictServices } from './types'
import { OPS_ROOM } from './works'

/**
 * The Ops room's fit-out (the works district owns this file).
 *
 * Frame: `services.opsAnchor` gives the room's FLOOR CENTRE and the hall yaw.
 * `along` runs the length of the room (and of the machine hall below);
 * `across` runs from the window wall's screens toward the tank-farm side.
 * Nothing here re-derives a room dimension — `OPS_ROOM` in `works.ts` owns
 * them, so the shell and the furniture cannot drift apart.
 *
 * Layout, all measured from the anchor:
 *   across -1.545  screen wall: three live dashboards (OpsScreensSystem) over
 *                  the main console run
 *   across -1.145  console: plinth, pedestals, worktop with a bullnose front,
 *                  raked instrument bezel, cable trough
 *   across  -0.1   two operator chairs (registered seats, facing the screens)
 *   along  -2.68   window wall onto the plant floor, with the sliding door
 *   along  +2.68   equipment rack
 */

// 2.0 (was 2.2): the 4.4 m desk's end sat 0.41 m from the door path and
// bricked head-on entry (experience-audit) — 4.0 m clears both ends.
const CONSOLE_HALF = 2.0
const CONSOLE_BACK = -OPS_ROOM.halfAcross
const CONSOLE_DEPTH = 0.8
const CONSOLE_FRONT = CONSOLE_BACK + CONSOLE_DEPTH
/** Ergonomics: worktop 745 mm, seat 460 mm, bezel top 1.10 m. */
const TOP_H = 0.745
const PLINTH_H = 0.1
const SEAT_H = 0.46

interface Frame {
  /** hall-local (along, across, height above the floor) to a world Vector3 */
  v: (a: number, c: number, h: number) => Vector3
  /** the same, as a Z-up authoring vertex `[worldX, worldZ, worldY]` */
  p: (a: number, c: number, h: number) => Vec3
  yaw: number
  /** yaw of something facing the screen wall */
  faceScreens: number
  base: Vector3
}

function makeFrame(base: Vector3, yaw: number): Frame {
  const along = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const v = (a: number, c: number, h: number): Vector3 =>
    base.clone().addScaledVector(along, a).addScaledVector(across, c).setY(base.y + h)
  return {
    v,
    p: (a, c, h) => {
      const w = v(a, c, h)
      return [w.x, w.z, w.y]
    },
    yaw,
    faceScreens: Math.atan2(-across.x, -across.z),
    base,
  }
}

/** Place a locally authored (Z-up) part into the room and emit it. */
function put(
  writer: PartWriter,
  slot: string,
  part: MeshData,
  frame: Frame,
  a: number,
  c: number,
  h: number,
  yaw: number,
): void {
  toYUp(part)
  const at = frame.v(a, c, h)
  placeYaw(part, [at.x, at.y, at.z], yaw)
  writeInto(writer, slot, cleanMesh(part))
}

// ------------------------------------------------------------------ console

/**
 * The main console run. Not a box with a lid: a set-back plinth, three
 * pedestals with a real knee void between them, a worktop whose front edge is
 * a five-level bullnose loft, a raked instrument bezel, and a cable trough.
 */
function consoleRun(services: DistrictServices, frame: Frame): void {
  const { writer } = services
  const yaw = frame.yaw

  // Plinth, set back 55 mm so a shadow line runs at the floor.
  writer.box({
    center: frame.v(0, CONSOLE_BACK + CONSOLE_DEPTH / 2 + 0.02, PLINTH_H / 2),
    size: new Vector3(CONSOLE_DEPTH - 0.11, PLINTH_H, CONSOLE_HALF * 2 - 0.11),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.012,
  })
  // Three pedestals; the two knee voids between them are the point.
  for (const a of [-CONSOLE_HALF + 0.45, 0, CONSOLE_HALF - 0.45]) {
    writer.box({
      center: frame.v(a, CONSOLE_BACK + CONSOLE_DEPTH / 2, PLINTH_H + (TOP_H - PLINTH_H - 0.045) / 2),
      size: new Vector3(CONSOLE_DEPTH, TOP_H - PLINTH_H - 0.045, 0.9),
      rotationY: yaw,
      slot: 'habShell',
      chamfer: 0.016,
    })
    // Drawer fronts, 8 mm proud with a 10 mm gap all round.
    for (let d = 0; d < 3; d++) {
      writer.box({
        center: frame.v(a, CONSOLE_FRONT + 0.0135, 0.19 + d * 0.17),
        size: new Vector3(0.025, 0.152, 0.86),
        rotationY: yaw,
        slot: 'aluminum',
        chamfer: 0.006,
      })
      writer.box({
        center: frame.v(a, CONSOLE_FRONT + 0.0385, 0.19 + d * 0.17),
        size: new Vector3(0.022, 0.022, 0.28),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.006,
      })
    }
  }
  // Back panel + cable trough, in the two knee voids only.
  const knees: Array<[number, number]> = [
    [-CONSOLE_HALF + 0.9, -0.45],
    [0.45, CONSOLE_HALF - 0.9],
  ]
  for (const [k0, k1] of knees) {
    writer.box({
      center: frame.v((k0 + k1) / 2, CONSOLE_BACK + 0.06, PLINTH_H + (TOP_H - PLINTH_H) / 2),
      size: new Vector3(0.03, TOP_H - PLINTH_H - 0.06, k1 - k0 - 0.02),
      rotationY: yaw,
      slot: 'dark',
    })
    writer.box({
      center: frame.v((k0 + k1) / 2, CONSOLE_BACK + 0.135, TOP_H - 0.13),
      size: new Vector3(0.12, 0.1, k1 - k0 - 0.16),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.008,
    })
  }

  // Worktop: a five-level offset loft, so the front edge is a true bullnose
  // with a 40 mm overhang rather than a chamfered slab.
  {
    const plan: Vec2[] = [
      [-CONSOLE_HALF - 0.02, CONSOLE_BACK],
      [CONSOLE_HALF + 0.02, CONSOLE_BACK],
      [CONSOLE_HALF + 0.02, CONSOLE_FRONT + 0.04],
      [-CONSOLE_HALF - 0.02, CONSOLE_FRONT + 0.04],
    ]
    const t = 0.045
    const levels: Array<[number, number]> = [
      [-0.004, 0],
      [-0.001, 0.006],
      [0, t * 0.5],
      [-0.001, t - 0.006],
      [-0.004, t],
    ]
    const rings = levels.map(([off, dz]) =>
      polyOffset(plan, off).map(([a, c]) => {
        const w = frame.v(a, c, TOP_H - t + dz)
        return [w.x, w.z, w.y] as Vec3
      }),
    )
    const top = loft(rings, { closeV: true, capStart: true, capEnd: true })
    writeInto(writer, 'aluminum', cleanMesh(smoothShade(top, SMOOTH.top)))
  }

  // Raked instrument bezel: a real section swept along the run, with recessed
  // switch panels and indicator lenses set into it.
  {
    const sec: Vec2[] = [
      [CONSOLE_BACK + 0.02, TOP_H],
      [CONSOLE_BACK + 0.02, TOP_H + 0.355],
      [CONSOLE_BACK + 0.1, TOP_H + 0.355],
      [CONSOLE_BACK + 0.38, TOP_H + 0.08],
      [CONSOLE_BACK + 0.38, TOP_H],
    ]
    // The bezel runs in TWO segments with a 120 mm break on the centre line,
    // over the gap between the two knee voids. Everything applied to the rake
    // is set out FROM these runs — see the panel loop.
    const bezelRuns = [
      [-CONSOLE_HALF + 0.06, -0.06],
      [0.06, CONSOLE_HALF - 0.06],
    ] as const
    for (const [a0, a1] of bezelRuns) {
      const rings = [a0, a1].map((a) => sec.map(([c, h]) => frame.p(a, c, h)))
      const bezel = loft(rings, { closeV: true, capStart: true, capEnd: true })
      writeInto(writer, 'habShell', cleanMesh(smoothShade(bezel, SMOOTH.moulded)))
    }
    // Switch panels lying ON the rake. `writer.box` can only yaw, so these are
    // authored flat, tilted about the console's own axis with `rotY`, and then
    // placed — a panel yawed instead of tilted floats off the face it belongs
    // to. Authoring X runs ACROSS, authoring Y runs ALONG (see `put`).
    const RAKE = Math.atan2(0.275, 0.28)
    const NX = Math.sin(RAKE)
    const NZ = Math.cos(RAKE)
    const faceC = CONSOLE_BACK + 0.24
    const faceH = TOP_H + 0.2175
    const onRake = (d: number): [number, number] => [faceC + NX * d, faceH + NZ * d]
    // A panel is set out inside ITS OWN bezel run: three per segment, with half
    // a panel (0.245) plus 70 mm of bezel at each end. On the old flat stride
    // (`-CONSOLE_HALF + 0.42 + i·0.7`) panel 3 spanned the 120 mm break between
    // the two segments with nothing behind it, and panel 6 ran 225 mm past the
    // bezel's end and 145 mm past the worktop — both standing in open air.
    for (const [a0, a1] of bezelRuns) {
      for (const a of [a0 + 0.315, (a0 + a1) / 2, a1 - 0.315]) {
        const panel = box(-0.093, -0.245, -0.014, 0.093, 0.245, 0.014)
        rotY(panel, RAKE)
        const [pc, ph] = onRake(0.018)
        put(writer, 'dark', panel, frame, a, pc, ph, yaw)
        for (let k = 0; k < 3; k++) {
          const lens = box(-0.016, -0.016, -0.006, 0.016, 0.016, 0.006)
          rotY(lens, RAKE)
          // 0.0395 on the rake normal, not 0.041: the panel's own face is at
          // 0.032 (centre 0.018, half 0.014), so a lens at 0.041 hovered 3 mm
          // off the part it is fitted into. This lands it on the 1.5 mm reveal
          // the drawer pulls use.
          const [lc, lh] = onRake(0.0395)
          put(writer, 'utilityLight', lens, frame, a - 0.15 + k * 0.15, lc, lh, yaw)
        }
      }
    }
  }

  for (const a of [-0.9, 0.9]) {
    writer.tube({
      path: [
        frame.v(a, CONSOLE_BACK + 0.135, TOP_H - 0.09),
        frame.v(a, CONSOLE_BACK + 0.05, TOP_H - 0.3),
        frame.v(a, CONSOLE_BACK + 0.05, PLINTH_H + 0.06),
      ],
      radius: 0.026,
      slot: 'dark',
      radialSegments: 6,
      capStart: true,
      capEnd: true,
    })
  }

  services.colliders.push({
    kind: 'box',
    center: frame.v(0, CONSOLE_BACK + CONSOLE_DEPTH / 2, TOP_H / 2),
    size: new Vector3(CONSOLE_DEPTH + 0.08, TOP_H, CONSOLE_HALF * 2),
    yaw,
  })
}

// -------------------------------------------------------------------- chair

/**
 * Operator chair, authored in its own Z-up frame (+X right, +Y forward,
 * standing on z = 0): 5-star base with real castors, a gas column, a dished
 * seat pan on a moulded shell, a lumbar-curved back, and two armrests.
 * ~24 parts.
 */
function buildChair(): { shell: MeshData[]; metal: MeshData[]; fabric: MeshData[] } {
  const shell: MeshData[] = []
  const metal: MeshData[] = []
  const fab: MeshData[] = []

  // Star base: a cast hub with five tapered arms and a castor on each.
  shell.push(
    revolve(
      [
        [0, 0.05],
        [0.104, 0.05],
        [0.104, 0.1],
        [0.088, 0.118],
        [0, 0.118],
      ],
      20,
      { smooth: SMOOTH.turned },
    ),
  )
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2 + 0.3
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    // Section perpendicular to the arm: (half width, top height), tapering out.
    const ring = (r: number, w: number, hTop: number): Vec3[] =>
      (
        [
          [-w, 0.035],
          [w, 0.035],
          [w, hTop],
          [-w, hTop],
        ] as Array<[number, number]>
      ).map(([u, h]) => [dx * r - dy * u, dy * r + dx * u, h] as Vec3)
    const arm = loft([ring(0.095, 0.045, 0.108), ring(0.19, 0.04, 0.092), ring(0.295, 0.03, 0.055)], {
      closeV: true,
      capStart: true,
      capEnd: true,
    })
    shell.push(smoothShade(arm, SMOOTH.moulded))
    const castor = revolve(
      [
        [0, 0],
        [0.032, 0.006],
        [0.035, 0.028],
        [0.032, 0.05],
        [0, 0.056],
      ],
      12,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    translate(castor, [dx * 0.305 - dy * 0.028, dy * 0.305 + dx * 0.028, 0.032])
    metal.push(castor)
  }
  // Gas column, seated in the hub.
  metal.push(
    revolve(
      [
        [0, 0.1],
        [0.055, 0.1],
        [0.05, 0.24],
        [0.032, 0.25],
        [0.032, 0.4],
        [0, 0.4],
      ],
      18,
      { smooth: SMOOTH.turned },
    ),
  )
  // Seat shell: a moulded pan with a rolled edge, then the cushion in it.
  {
    const plan = roundedRect(0.48, 0.46, 0.09, 4)
    const levels: Array<[number, number]> = [
      [-0.03, 0],
      [-0.005, 0.014],
      [0, 0.05],
      [-0.02, 0.062],
    ]
    const rings = levels.map(([off, dz]) =>
      polyOffset(plan, off).map(([x, y]) => [x, y - 0.02, 0.4 + dz] as Vec3),
    )
    shell.push(smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
    const cushionPlan = roundedRect(0.41, 0.39, 0.075, 4)
    const cLevels: Array<[number, number]> = [
      [-0.012, 0],
      [0, 0.02],
      [-0.004, 0.045],
      [-0.05, 0.055],
    ]
    const cRings = cLevels.map(([off, dz]) =>
      polyOffset(cushionPlan, off).map(([x, y]) => [x, y - 0.02, 0.462 + dz] as Vec3),
    )
    fab.push(smoothShade(loft(cRings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
  }
  // Back: a lumbar-curved shell lofted across, its ends rolled in by inset
  // stations (geometry-craft §4.2) so the edge reads moulded, not sliced.
  {
    // CCW in (y, z): up the BACK face, then down the FRONT face.
    const sil: Vec2[] = [
      [0.09, 0.5],
      [0.06, 0.62],
      [0.04, 0.74],
      [0.052, 0.86],
      [0.086, 0.95],
      [0.05, 0.95],
      [0.012, 0.86],
      [0.0, 0.74],
      [0.02, 0.62],
      [0.05, 0.5],
    ]
    const stations: Array<[number, number]> = [
      [-0.22, -0.011],
      [-0.192, -0.002],
      [0.192, -0.002],
      [0.22, -0.011],
    ]
    const rings = stations.map(([x, off]) =>
      polyOffset(sil, off).map(([y, z]) => [x, y - 0.15, z] as Vec3),
    )
    fab.push(smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
    for (const sx of [-1, 1]) {
      const stay = prismYZ(
        [
          [-0.19, 0.44],
          [-0.135, 0.44],
          [-0.1, 0.57],
          [-0.145, 0.57],
        ],
        sx * 0.19 - 0.016,
        sx * 0.19 + 0.016,
      )
      metal.push(smoothShade(stay, SMOOTH.moulded))
    }
  }
  // Armrests: a vertical post clear of the seat shell, carrying a soft pad.
  for (const sx of [-1, 1]) {
    const post = prism(
      roundedRect(0.05, 0.055, 0.018, 3).map(([x, y]) => [sx * 0.278 + x, y - 0.045] as Vec2),
      0.4,
      0.655,
    )
    metal.push(smoothShade(post, SMOOTH.moulded))
    const pad = prism(
      roundedRect(0.075, 0.21, 0.03, 3).map(([x, y]) => [sx * 0.278 + x, y - 0.07] as Vec2),
      0.655,
      0.681,
    )
    fab.push(smoothShade(pad, SMOOTH.shell))
  }
  return { shell, metal, fabric: fab }
}

function placeChair(services: DistrictServices, frame: Frame, a: number, c: number, yaw: number): void {
  const { writer } = services
  const parts = buildChair()
  for (const [slot, list] of [
    ['dark', parts.shell],
    ['aluminum', parts.metal],
    ['fabricBlue', parts.fabric],
  ] as const) {
    for (const part of list) put(writer, slot, part, frame, a, c, 0, yaw)
  }
  services.seats.push({ seat: frame.v(a, c, SEAT_H), yaw, label: 'Take the ops chair' })
}

// -------------------------------------------------------------- fit-out

export function buildOpsInterior(services: DistrictServices): void {
  const anchor = services.opsAnchor
  if (!anchor) return
  const { writer } = services
  const frame = makeFrame(anchor.position, anchor.yaw)
  const yaw = frame.yaw
  const halfA = OPS_ROOM.halfAlong
  const halfC = OPS_ROOM.halfAcross

  consoleRun(services, frame)
  placeChair(services, frame, -0.85, -0.12, frame.faceScreens)
  placeChair(services, frame, 0.95, -0.12, frame.faceScreens + 0.34)

  // ---- Window bench: a shelf on folded brackets, clear of the door bay.
  {
    const c0 = -0.35
    const c1 = halfC - 0.12
    writer.box({
      center: frame.v(-halfA + 0.19, (c0 + c1) / 2, 0.775),
      size: new Vector3(c1 - c0, 0.035, 0.34),
      rotationY: yaw,
      slot: 'aluminum',
      chamfer: 0.008,
    })
    for (const c of [c0 + 0.16, c1 - 0.16]) {
      writer.box({
        center: frame.v(-halfA + 0.19, c, 0.7),
        size: new Vector3(0.02, 0.12, 0.3),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.006,
      })
    }
    // The detail that says a shift just ended: a mug and a clipboard.
    const mug = revolve(
      [
        [0, 0],
        [0.041, 0.004],
        [0.041, 0.09],
        [0.035, 0.09],
        [0.035, 0.012],
        [0, 0.012],
      ],
      14,
      { smooth: SMOOTH.turned },
    )
    // Loose items stand 1.5 mm proud of the shelf top (0.7925 = 0.775 + 0.035/2)
    // — the reveal the drawer pulls use, never a flush butt.
    put(writer, 'habShell', mug, frame, -halfA + 0.19, c1 - 0.42, 0.794, yaw)
    // The clipboard lies FLAT and its long edge runs ACROSS the bench. Authored
    // as 0.32 m of HEIGHT centred at 0.93 it stood upright with nothing holding
    // it and its bottom edge 22 mm inside the 35 mm shelf slab; laid along the
    // bench instead it would overhang the 0.34 m deep shelf by 35 mm.
    writer.box({
      center: frame.v(-halfA + 0.19, c0 + 0.42, 0.8),
      size: new Vector3(0.32, 0.012, 0.24),
      rotationY: yaw - 0.14,
      slot: 'habShell',
      chamfer: 0.004,
    })
  }

  // ---- Equipment rack against the far wall: rails, blanks, patch, status.
  {
    const a = halfA - 0.42
    const c = 0.85
    writer.box({
      center: frame.v(a, c, 1.02),
      size: new Vector3(0.66, 2.04, 0.8),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.02,
    })
    // The cabinet's FRONT FACE is `along = a − 0.4`, and `writer.box` sizes are
    // (ACROSS, height, ALONG) — the same order the console and the luminaires
    // use. The blanks and their lamps were authored with those two swapped, so
    // every blank was a 28 mm blade 560 mm deep that stood 255 mm out of the
    // cabinet and 305 mm inside it, and the two rails sat 15 mm BEHIND the face
    // where nothing can be seen. Everything applied here now stands 1.5 mm off
    // the face it is fixed to, the reveal the console's drawer fronts use:
    // rails proud, blanks recessed between them, lamps proud of the blanks.
    const rackFace = a - 0.4
    for (const s of [-1, 1]) {
      writer.box({
        center: frame.v(rackFace - 0.0265, c + s * 0.27, 1.06),
        size: new Vector3(0.03, 1.86, 0.05),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.006,
      })
    }
    for (let u = 0; u < 9; u++) {
      const h = 0.24 + u * 0.19
      const kind = u % 4
      // 0.50 across: the rails' inner faces are at ±0.255 off the centre line,
      // so a full 0.56 blank would run straight through both of them.
      writer.box({
        center: frame.v(rackFace - 0.0155, c, h),
        size: new Vector3(0.5, 0.17, 0.028),
        rotationY: yaw,
        slot: kind === 0 ? 'aluminum' : 'habShell',
        chamfer: 0.006,
      })
      if (kind === 2) {
        for (let k = 0; k < 4; k++) {
          writer.box({
            center: frame.v(rackFace - 0.037, c - 0.2 + k * 0.13, h + 0.05),
            size: new Vector3(0.022, 0.022, 0.012),
            rotationY: yaw,
            slot: 'utilityLight',
          })
        }
      }
    }
    services.colliders.push({
      kind: 'box',
      center: frame.v(a, c, 1.02),
      size: new Vector3(0.72, 2.1, 0.86),
      yaw,
    })
  }

  // ---- Ceiling: two luminaires, each a four-bar bezel with the diffuser
  // recessed 40 mm inside it. A solid hood plus a flush panel would put two
  // faces on one plane; a bezel leaves the panel a real reveal to sit in.
  for (const a of [-1.15, 1.15]) {
    const h = OPS_ROOM.height - 0.065
    for (const s of [-1, 1]) {
      writer.box({
        center: frame.v(a + s * 0.72, 0.35, h),
        size: new Vector3(0.78, 0.13, 0.07),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.012,
      })
      writer.box({
        center: frame.v(a, 0.35 + s * 0.355, h),
        size: new Vector3(0.07, 0.13, 1.37),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.012,
      })
    }
    writer.box({
      center: frame.v(a, 0.35, OPS_ROOM.height - 0.045),
      size: new Vector3(0.63, 0.026, 1.37),
      rotationY: yaw,
      slot: 'interiorGlow',
    })
  }

  // ---- The door, in the window wall's left bay. It slides ACROSS, parking
  // in front of the neighbouring fixed pane exactly as a real one would.
  const doorC = (OPS_ROOM.doorBay[0] + OPS_ROOM.doorBay[1]) / 2
  slidingDoor(
    services,
    frame.v(-halfA + 0.06, doorC, 1.125),
    yaw,
    'Enter ops',
    1.0,
    2.25,
  )
}
