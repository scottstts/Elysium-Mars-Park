import { Mesh, PlaneGeometry, Vector3 } from 'three'
import { stairFlight } from '../../archkit/kit'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  bevel,
  ccw,
  circle,
  cleanMesh,
  loft,
  polyOffset,
  prism,
  prismYZ,
  revolve,
  rotateZ,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  writeInto,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import { signageMaterial } from '../../materials/library'
import type { DistrictServices } from './types'
import { loungeShell } from './leisure'
import { slidingDoor } from './interiorShared'

/**
 * OVERLOOK LOUNGE — interior fit-out (leisure district owns this file).
 *
 * The shell is in `leisure.ts`; both read `loungeShell()` so a level or a bay
 * boundary can never drift between them. Local coordinates here are the drum's:
 * `u = x − centre.x` (east positive), `v = z − centre.z` (south positive). The
 * long west flank is the view; everything that seats a guest faces it.
 *
 * The mezzanine is a CHORD-CUT floor over the north third rather than a full
 * annular gallery: a gallery leaves nowhere for a stair to land (the run has to
 * start outside the drum), and the open two thirds is what makes the lit
 * interior read as one volume through the glazing from the rim walk.
 */

type Part = [string, MeshData]

function emit(services: DistrictServices, parts: Part[]): void {
  for (const [slot, part] of parts) writeInto(services.writer, slot, cleanMesh(part))
}

/** Ellipse plan outline, counter-clockwise, centred on the drum. */
function drumPoly(cx: number, cz: number, ax: number, az: number, count: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const t = (Math.PI * 2 * i) / count
    out.push([cx + Math.cos(t) * ax, cz + Math.sin(t) * az])
  }
  return out
}

/**
 * The drum outline pulled in by `inset` along its TRUE normal. A scaled-down
 * ellipse is not a parallel curve — at 45 deg the two differ by 12 cm here,
 * which is exactly enough for a floor slab to overlap the wall base it is
 * meant to butt.
 */
function drumInset(
  cx: number,
  cz: number,
  ax: number,
  az: number,
  inset: number,
  count: number,
): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < count; i++) {
    const t = (Math.PI * 2 * i) / count
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const nl = Math.hypot(az * ct, ax * st) || 1
    out.push([cx + ct * ax - ((az * ct) / nl) * inset, cz + st * az - ((ax * st) / nl) * inset])
  }
  return out
}

/** `rotateZ` angle that turns a part authored with +Y = BACK to face `(fx, fz)`. */
function chairYaw(fx: number, fz: number): number {
  return Math.atan2(fx, -fz)
}

/** Player yaw that LOOKS along `(dx, dz)` — yaw 0 looks −Z. */
function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

// ------------------------------------------------------------------ chair ----

/**
 * The window-facing lounge chair. Local frame: +X right, +Y toward the BACK,
 * standing on z = 0 — the bench's convention, so the same placement maths
 * works. NOT a bench: a bent-tube cantilever side frame carries a moulded seat
 * and back shell, with cushions that sit proud of both.
 *
 * 12 parts, ~3.6 k triangles, two slots (`aluminum`, `fabricRust`).
 */
const CHAIR_SEAT_Z = 0.44

function chairSideFrame(sx: number): MeshData {
  // A closed side-elevation loop: rear foot, back post, arm, front post,
  // runner. Swept with `up` = the chair's X axis so the vertical legs cannot
  // flip the sweep frame (the classic twist in a bent-tube part).
  const path: Vec3[] = [
    [sx, 0.3, 0.035],
    [sx, 0.305, 0.2],
    [sx, 0.285, 0.5],
    [sx, 0.262, 0.73],
    [sx, 0.14, 0.7],
    [sx, -0.05, 0.665],
    [sx, -0.24, 0.645],
    [sx, -0.295, 0.5],
    [sx, -0.3, 0.2],
    [sx, -0.3, 0.035],
    [sx, -0.16, 0.035],
    [sx, 0.14, 0.035],
  ]
  return smoothShade(
    tubeAlong(path, roundedRect(0.052, 0.042, 0.014, 3), {
      up: [1, 0, 0],
      closePath: true,
      cap: false,
    }),
    SMOOTH.moulded,
  )
}

/** Moulded shell: a crowned section lofted across with inset end stations. */
function chairShell(section: Vec2[], halfWidth: number): MeshData {
  const stations: Array<[number, number]> = [
    [-1, -0.012],
    [-0.93, -0.003],
    [0.93, -0.003],
    [1, -0.012],
  ]
  const rings = stations.map(([t, inset]) => {
    const poly = inset ? polyOffset(section, inset) : section
    const x = halfWidth * t
    return poly.map(([y, z]) => [x, y, z] as Vec3)
  })
  return smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell)
}

function loungeChairParts(): { parts: Part[]; seat: Vec3 } {
  const parts: Part[] = []
  for (const sx of [-0.29, 0.29]) parts.push(['aluminum', chairSideFrame(sx)])

  // Two cross rails tying the frames, landing exactly on their inner faces.
  for (const [y, z] of [
    [-0.16, 0.09],
    [0.2, 0.09],
  ]) {
    parts.push([
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [-0.268, y, z],
            [0.268, y, z],
          ],
          roundedRect(0.03, 0.026, 0.008, 2),
          { up: [0, 0, 1], cap: true },
        ),
        SMOOTH.moulded,
      ),
    ])
  }

  // Seat shell: crowned top, relieved underside, arrised nose.
  const seatSection = ccw([
    [-0.29, 0.4],
    [-0.255, 0.412],
    [-0.1, 0.418],
    [0.16, 0.412],
    [0.245, 0.402],
    [0.26, 0.386],
    [0.24, 0.376],
    [0.15, 0.386],
    [-0.1, 0.392],
    [-0.245, 0.386],
    [-0.285, 0.378],
  ] as Vec2[])
  parts.push(['aluminum', chairShell(seatSection, 0.262)])

  // Back shell: leans 12 deg, rolled top edge.
  const backSection = ccw([
    [0.208, 0.44],
    [0.196, 0.62],
    [0.184, 0.72],
    [0.2, 0.735],
    [0.226, 0.728],
    [0.238, 0.62],
    [0.25, 0.44],
    [0.232, 0.428],
  ] as Vec2[])
  parts.push(['aluminum', chairShell(backSection, 0.256)])

  // Cushions stand proud of both shells — foam, not paint.
  const pad = bevel(
    prism(
      roundedRect(0.5, 0.46, 0.06, 4).map(([x, y]) => [x, y - 0.03] as Vec2),
      0.418,
      0.5,
    ),
    BEVEL.soft,
    3,
  )
  parts.push(['fabricRust', smoothShade(pad, SMOOTH.shell)])
  // The back cushion butts the shell's front face (y = 0.184) and stands proud
  // of it; overlapping the shell instead is a same-slot z-fight in the making.
  const backPad = prismYZ(
    [
      [0.112, 0.47],
      [0.107, 0.6],
      [0.118, 0.69],
      [0.17, 0.7],
      [0.178, 0.6],
      [0.182, 0.47],
      [0.15, 0.455],
    ],
    -0.23,
    0.23,
  )
  parts.push(['fabricRust', smoothShade(backPad, SMOOTH.shell)])

  // Feet: turned pads with a reveal at the floor.
  for (const sx of [-0.29, 0.29]) {
    for (const y of [-0.3, 0.3]) {
      const foot = revolve(
        [
          [0, 0],
          [0.03, 0],
          [0.032, 0.014],
          [0.024, 0.03],
          [0, 0.032],
        ],
        12,
        { capStart: false, capEnd: false, smooth: SMOOTH.tight },
      )
      translate(foot, [sx, y, 0])
      parts.push(['dark', foot])
    }
  }

  return { parts, seat: [0, 0.02, CHAIR_SEAT_Z + 0.06] }
}

let chairCache: { parts: Part[]; seat: Vec3 } | null = null

/** Place a chair, facing `(fx, fz)`. Returns the world seat contract. */
function placeChair(
  services: DistrictServices,
  parts: Part[],
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
): void {
  if (!chairCache) chairCache = loungeChairParts()
  const yaw = chairYaw(fx, fz)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  for (const [slot, part] of chairCache.parts) {
    const copy = part.clone()
    rotateZ(copy, yaw)
    translate(copy, [x, z, y])
    parts.push([slot, copy])
  }
  const [, sy, sz] = chairCache.seat
  services.seats.push({
    seat: new Vector3(x - sin * sy, y + sz, z + cos * sy),
    yaw: faceYaw(fx, fz),
    label: 'Watch the planet',
  })
  services.colliders.push({
    kind: 'box',
    center: new Vector3(x, y + 0.36, z),
    size: new Vector3(0.72, 0.72, 0.72),
    yaw: -yaw,
  })
}

// ------------------------------------------------------------------ table ----

function lowTable(x: number, y: number, z: number, radius: number): Part[] {
  const top = smoothShade(
    loft(
      (
        [
          [-0.02, 0],
          [0.008, 0.012],
          [0.008, 0.036],
          [-0.02, 0.048],
        ] as Array<[number, number]>
      ).map(([offset, dz]) =>
        // A real circle: `roundedRect(d, d, d/2)` doubles up a vertex at each
        // of the four arc joins, and `polyOffset` turns those into spikes.
        polyOffset(circle(radius, 28), offset).map(([px, pz]) => [px, pz, dz] as Vec3),
      ),
      { closeV: true, capStart: true, capEnd: true },
    ),
    SMOOTH.top,
  )
  translate(top, [x, z, y + 0.4])
  const column = revolve(
    [
      [0.26, 0],
      [0.26, 0.016],
      [0.2, 0.04],
      [0.048, 0.09],
      [0.042, 0.38],
      [0.09, 0.4],
      [0, 0.4],
    ],
    24,
    { capStart: true, capEnd: false, smooth: SMOOTH.turned },
  )
  translate(column, [x, z, y])
  return [
    ['aluminum', column],
    ['aluminum', top],
  ]
}

// -------------------------------------------------------------- fit-out ----

export function buildLoungeInterior(services: DistrictServices): void {
  const shell = loungeShell()
  const parts: Part[] = []
  const ux = (u: number): number => shell.x + u
  const vz = (v: number): number => shell.z + v

  // ---- floor topping, poured over the apron inside the base band. Its edge
  // stops 60 mm inside the band's inner face: a shadow gap at the skirting,
  // and no chance of two slabs sharing the apron plane.
  parts.push([
    'deck',
    bevel(
      prism(drumInset(shell.x, shell.z, shell.ax, shell.az, 0.52, 84), shell.apron, shell.floor),
      BEVEL.panel,
      1,
    ),
  ])

  // ---- ceiling coves. Both hang under a structural band, so neither floats:
  // the strip lives in a pocket behind a 0.24 m fascia and is never seen
  // directly — an exposed emissive face reads as paint, not as light.
  for (const level of [shell.mezzBottom, shell.head]) {
    parts.push([
      'cast',
      smoothShade(
        tubeAlong(
          drumPoly(shell.x, shell.z, shell.ax, shell.az, 96).map(([x, z]) => [x, z, level] as Vec3),
          // Held back to a = −0.20: the curtain wall's mullions occupy
          // −0.14 … +0.11, and a cove that reached the glass would be threaded
          // straight through every one of them.
          [
            [-0.5, 0],
            [-0.2, 0],
            [-0.2, -0.06],
            [-0.24, -0.1],
            [-0.24, -0.24],
            [-0.4, -0.24],
            [-0.4, -0.06],
            [-0.5, -0.06],
          ],
          { up: [0, 0, 1], closePath: true, cap: false },
        ),
        SMOOTH.cast,
      ),
    ])
    parts.push([
      'interiorGlow',
      smoothShade(
        tubeAlong(
          drumPoly(shell.x, shell.z, shell.ax, shell.az, 96).map(([x, z]) => [x, z, level] as Vec3),
          [
            [-0.38, -0.06],
            [-0.38, -0.12],
            [-0.27, -0.12],
            [-0.27, -0.06],
          ],
          { up: [0, 0, 1], closePath: true, cap: false },
        ),
        SMOOTH.moulded,
      ),
    ])
  }

  // ---- mezzanine: a chord-cut plate over the north third.
  const mezzOuterAx = shell.ax - 0.5
  const mezzOuterAz = shell.az - 0.5
  const chordV = -2.2
  const tCut = Math.asin(Math.max(-1, Math.min(1, chordV / mezzOuterAz)))
  // The slab stops 30 mm inside the ring beam's inner face. Flush is not an
  // option: the beam's inner edge is a swept chord-normal offset and this is a
  // scaled ellipse, and the two curves cross each other all the way round.
  const mezzPoly: Vec2[] = []
  const arcSteps = 40
  const mezzInset = 0.53
  for (let i = 0; i <= arcSteps; i++) {
    const t = -(Math.PI - tCut) + ((Math.PI + 2 * tCut) * i) / arcSteps
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const nl = Math.hypot(shell.az * ct, shell.ax * st) || 1
    mezzPoly.push([
      shell.x + ct * shell.ax - ((shell.az * ct) / nl) * mezzInset,
      shell.z + st * shell.az - ((shell.ax * st) / nl) * mezzInset,
    ])
  }
  parts.push(['cast', bevel(prism(ccw(mezzPoly), shell.mezzBottom, shell.mezzTop), BEVEL.carcass, 2)])

  // Edge beam UNDER the slab's chord, plus a guardrail broken where the stair
  // lands. Inside the slab's own depth it would simply z-fight its top face.
  const chordHalf = Math.abs(mezzPoly[0][0] - shell.x) - 0.12
  parts.push([
    'cast',
    bevel(
      prism(
        [
          [ux(-chordHalf), vz(chordV)],
          [ux(chordHalf), vz(chordV)],
          [ux(chordHalf), vz(chordV - 0.34)],
          [ux(-chordHalf), vz(chordV - 0.34)],
        ],
        shell.mezzBottom - 0.3,
        shell.mezzBottom,
      ),
      BEVEL.carcass,
      2,
    ),
  ])
  for (const [u0, u1] of [
    [-chordHalf + 0.2, 1.7],
    [3.5, chordHalf - 0.2],
  ]) {
    for (const [height, profile, slot] of [
      [1.06, roundedRect(0.055, 0.045, 0.014, 3), 'orangeTop'],
      [0.6, roundedRect(0.036, 0.03, 0.01, 2), 'orange'],
    ] as const) {
      parts.push([
        slot,
        smoothShade(
          tubeAlong(
            [
              [ux(u0), vz(chordV - 0.09), shell.mezzTop + height],
              [ux(u1), vz(chordV - 0.09), shell.mezzTop + height],
            ],
            profile,
            { up: [0, 0, 1], cap: true },
          ),
          SMOOTH.moulded,
        ),
      ])
    }
    const posts = Math.max(2, Math.round((u1 - u0) / 1.3))
    for (let p = 0; p <= posts; p++) {
      const u = u0 + ((u1 - u0) * p) / posts
      const post = prism(
        roundedRect(0.05, 0.05, 0.012, 2),
        shell.mezzTop + 0.02,
        shell.mezzTop + 1.0375,
      )
      translate(post, [ux(u), vz(chordV - 0.09), 0])
      parts.push(['orange', smoothShade(post, SMOOTH.moulded)])
    }
  }
  services.colliders.push({
    kind: 'box',
    center: new Vector3(shell.x, (shell.mezzBottom + shell.mezzTop) / 2, vz((chordV - shell.az) / 2)),
    size: new Vector3(2 * mezzOuterAx, shell.mezzTop - shell.mezzBottom, shell.az - 0.5 + chordV),
  })

  // ---- stairs. Flight 1 runs north to the mezzanine, flight 2 east across it
  // to the roof opening. Both are authored ONE RISER SHORT: the floor they
  // arrive at IS the top nosing, which is how a real flight meets a slab and
  // the only way the last tread does not end up buried in it.
  const riseA = (shell.mezzTop - shell.floor) / 23
  stairFlight(services.writer, {
    origin: new Vector3(ux(2.6), shell.floor, vz(chordV + 23 * 0.29)),
    yaw: Math.PI,
    steps: 22,
    width: 1.5,
    rise: riseA,
    run: 0.29,
  })
  services.colliders.push({
    kind: 'box',
    center: new Vector3(ux(2.6), shell.floor + (shell.mezzTop - shell.floor) / 2 - 0.4, vz(chordV + 3.4)),
    size: new Vector3(1.7, shell.mezzTop - shell.floor, 6.9),
  })
  const opening = shell.roofOpening
  const riseB = (shell.roofTop - shell.mezzTop) / 20
  stairFlight(services.writer, {
    origin: new Vector3(ux(opening.u1 - 20 * 0.29), shell.mezzTop, vz((opening.v0 + opening.v1) / 2)),
    yaw: Math.PI / 2,
    steps: 19,
    width: 1.4,
    rise: riseB,
    run: 0.29,
  })

  // Roof penthouse over the opening: three cast walls as one U prism, a lid,
  // and a warm lens so the head of the stair reads at dusk from the terrace.
  const pu = (opening.u0 + opening.u1) / 2
  const pv = (opening.v0 + opening.v1) / 2
  const hu = (opening.u1 - opening.u0) / 2 + 0.22
  const hv = (opening.v1 - opening.v0) / 2 + 0.22
  parts.push([
    'cast',
    bevel(
      prism(
        ccw([
          [ux(pu - hu), vz(pv - hv)],
          [ux(pu + hu), vz(pv - hv)],
          [ux(pu + hu), vz(pv + hv)],
          [ux(pu - hu), vz(pv + hv)],
          [ux(pu - hu), vz(pv + hv - 0.22)],
          [ux(pu + hu - 0.22), vz(pv + hv - 0.22)],
          [ux(pu + hu - 0.22), vz(pv - hv + 0.22)],
          [ux(pu - hu), vz(pv - hv + 0.22)],
        ] as Vec2[]),
        shell.roofTop,
        shell.roofTop + 2.24,
      ),
      BEVEL.carcass,
      2,
    ),
  ])
  parts.push([
    'cast',
    bevel(
      prism(
        roundedRect(2 * hu + 0.16, 2 * hv + 0.16, 0.1, 3).map(
          ([x, z]) => [ux(pu) + x, vz(pv) + z] as Vec2,
        ),
        shell.roofTop + 2.24,
        shell.roofTop + 2.38,
      ),
      BEVEL.carcass,
      2,
    ),
  ])
  const lamp = bevel(
    prism(
      roundedRect(0.09, 0.5, 0.02, 2).map(([x, z]) => [ux(pu - hu + 0.14) + x, vz(pv) + z] as Vec2),
      shell.roofTop + 2.06,
      shell.roofTop + 2.12,
    ),
    BEVEL.hardware,
    1,
  )
  parts.push(['utilityLight', smoothShade(lamp, SMOOTH.tight)])
  services.colliders.push({
    kind: 'box',
    center: new Vector3(ux(pu + 0.11), shell.roofTop + 1.2, vz(pv)),
    size: new Vector3(2 * hu - 0.22, 2.4, 2 * hv),
  })

  // ---- the seating. Everything on the ground floor is aimed west, at the
  // plain: design.md's "chairs aimed at nothing but Mars".
  for (const [u, v, fan] of [
    [-3.25, -4.4, 0.26],
    [-3.45, -2.5, 0.12],
    [-3.5, -0.4, -0.02],
    [-3.35, 1.6, -0.14],
    [-3.0, 3.5, -0.3],
    [-2.35, 5.3, -0.5],
  ]) {
    placeChair(services, parts, ux(u), shell.floor, vz(v), -Math.cos(fan), Math.sin(fan))
  }
  for (const [u, v] of [
    [-2.0, -3.5],
    [-2.15, 0.6],
    [-1.6, 4.4],
  ]) {
    for (const part of lowTable(ux(u), shell.floor, vz(v), 0.34)) parts.push(part)
  }

  // A facing pair away from the glass, for people who came to talk.
  placeChair(services, parts, ux(0.9), shell.floor, vz(4.9), 0.2, -1)
  placeChair(services, parts, ux(0.4), shell.floor, vz(2.9), -0.2, 1)
  for (const part of lowTable(ux(0.65), shell.floor, vz(3.9), 0.3)) parts.push(part)

  // Mezzanine seating, visible through the upper glazing from the rim walk.
  // Kept off v = −4.8 … −6.2, which the flight to the roof runs through.
  for (const [u, v, fan] of [
    [-2.95, -2.9, 0.16],
    [-2.7, -4.1, 0.3],
    [-1.7, -7.5, 0.72],
  ]) {
    placeChair(services, parts, ux(u), shell.mezzTop, vz(v), -Math.cos(fan), Math.sin(fan))
  }
  for (const part of lowTable(ux(-1.85), shell.mezzTop, vz(-3.5), 0.3)) parts.push(part)

  // ---- coffee console against the sill wall, clear of the stair's run
  // (u 1.85 … 3.35, v −2.2 … 4.5).
  const console0 = { u: 4.15, v: 1.2 }
  parts.push([
    'cast',
    bevel(
      prism(
        roundedRect(0.72, 2.1, 0.05, 3).map(([x, z]) => [ux(console0.u) + x, vz(console0.v) + z] as Vec2),
        shell.floor,
        shell.floor + 0.9,
      ),
      BEVEL.carcass,
      2,
    ),
  ])
  parts.push([
    'aluminum',
    bevel(
      prism(
        roundedRect(0.78, 2.16, 0.06, 3).map(([x, z]) => [ux(console0.u) + x, vz(console0.v) + z] as Vec2),
        shell.floor + 0.9,
        shell.floor + 0.94,
      ),
      BEVEL.panel,
      2,
    ),
  ])
  const urn = revolve(
    [
      [0, 0],
      [0.17, 0],
      [0.17, 0.34],
      [0.13, 0.4],
      [0.13, 0.44],
      [0, 0.44],
    ],
    20,
    { capStart: false, capEnd: false, smooth: SMOOTH.turned },
  )
  translate(urn, [ux(console0.u), vz(console0.v - 0.6), shell.floor + 0.94])
  parts.push(['aluminum', urn])
  services.colliders.push({
    kind: 'box',
    center: new Vector3(ux(console0.u), shell.floor + 0.47, vz(console0.v)),
    size: new Vector3(0.8, 0.95, 2.2),
  })

  // ---- entry door in the missing bay, from the rim promenade side.
  const start = shell.stations[shell.doorBay]
  const end = shell.stations[(shell.doorBay + 1) % shell.bays]
  const width = Math.hypot(end.x - start.x, end.z - start.z)
  const dux = (end.x - start.x) / width
  const duz = (end.z - start.z) / width
  slidingDoor(
    services,
    new Vector3((start.x + end.x) / 2, shell.apron + 1.18, (start.z + end.z) / 2),
    Math.atan2(-duz, dux),
    'Enter the lounge',
    Math.min(1.45, width - 0.3),
    2.36,
  )

  // ---- the sign, hung inside above the door: a quiet joke on the way out.
  const sign = loungeInteriorSign()
  const inx = -(start.nx + end.nx)
  const inz = -(start.nz + end.nz)
  const inl = Math.hypot(inx, inz) || 1
  sign.position.set(
    (start.x + end.x) / 2 + (inx / inl) * 0.42,
    shell.apron + 2.72,
    (start.z + end.z) / 2 + (inz / inl) * 0.42,
  )
  sign.rotation.y = Math.atan2(inx / inl, inz / inl)
  services.group.add(sign)

  emit(services, parts)
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
