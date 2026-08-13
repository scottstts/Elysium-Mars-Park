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

// --------------------------------------------------------------- stairs ----

interface FlightSpec {
  origin: Vector3
  yaw: number
  steps: number
  width: number
  rise: number
  run: number
}

/**
 * Collide a flight TREAD BY TREAD, so it can actually be walked.
 *
 * Both flights used to be covered by one solid box spanning the whole rise:
 * the geometry was there, the guardrails were there, and the player simply hit
 * a wall (owner report). One box per going — top face exactly on the tread,
 * carried down to the flight's foot so there is no way to fall between them —
 * gives the character controller a 0.17 m step against a 0.42 m autostep, and
 * the stair reads to physics exactly as it reads to the eye.
 */
function stairColliders(services: DistrictServices, spec: FlightSpec): void {
  const sin = Math.sin(spec.yaw)
  const cos = Math.cos(spec.yaw)
  for (let i = 0; i < spec.steps; i++) {
    const top = spec.origin.y + (i + 1) * spec.rise
    const centreAlong = (i + 0.5) * spec.run
    const height = top - (spec.origin.y - 0.25)
    services.colliders.push({
      kind: 'box',
      center: new Vector3(
        spec.origin.x + sin * centreAlong,
        top - height / 2,
        spec.origin.z + cos * centreAlong,
      ),
      size: new Vector3(spec.width, height, spec.run),
      // `ColliderSpec.yaw` rotates the box about +Y, and the flight's LENGTH is
      // its local z — the same convention `stairFlight` uses for its treads.
      yaw: spec.yaw,
    })
  }
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
  const chordV = -2.2
  // The arc is the part of the ellipse NORTH of the chord: `az·sin t ≤ chordV`
  // gives `t ∈ [−π + tCut, −tCut]`, which is symmetric about −π/2.
  //
  // It used to sweep `[−(π − asin(chordV/az)), … ]` over a span of `π + 2·asin`,
  // which is neither symmetric nor the right length: the plate came out as a
  // lopsided crescent running from v = +2.25 on the west flank to v = −6.18 on
  // the east, so the "chord" was a slanted line 8.4 m out of true and flight 1
  // aimed at an edge that was not there.
  const tCut = Math.asin(Math.max(-1, Math.min(1, -chordV / shell.az)))
  // The slab stops 30 mm inside the ring beam's inner face. Flush is not an
  // option: the beam's inner edge is a swept chord-normal offset and this is a
  // scaled ellipse, and the two curves cross each other all the way round.
  const mezzPoly: Vec2[] = []
  const arcSteps = 40
  const mezzInset = 0.53
  for (let i = 0; i <= arcSteps; i++) {
    const t = -Math.PI + tCut + ((Math.PI - 2 * tCut) * i) / arcSteps
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const nl = Math.hypot(shell.az * ct, shell.ax * st) || 1
    mezzPoly.push([
      shell.x + ct * shell.ax - ((shell.az * ct) / nl) * mezzInset,
      shell.z + st * shell.az - ((shell.ax * st) / nl) * mezzInset,
    ])
  }
  parts.push(['cast', bevel(prism(ccw(mezzPoly), shell.mezzBottom, shell.mezzTop), BEVEL.carcass, 2)])
  // The slab's real south edge, which is where flight 1 has to land. It is NOT
  // `chordV`: the poly's arc ends are pulled 45 mm further north by the
  // true-normal inset, and a flight aimed at `chordV` stops that far short.
  const mezzEdgeV = Math.max(...mezzPoly.map((p) => p[1])) - shell.z

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
  const mezzNorthV = -(shell.az - mezzInset)
  services.colliders.push({
    kind: 'box',
    center: new Vector3(
      shell.x,
      (shell.mezzBottom + shell.mezzTop) / 2,
      vz((mezzEdgeV + mezzNorthV) / 2),
    ),
    size: new Vector3(2 * mezzOuterAx, shell.mezzTop - shell.mezzBottom, mezzEdgeV - mezzNorthV),
  })
  // Guardrail along the mezzanine's open chord, broken where the flight lands
  // — a floor you can now walk on needs an edge you cannot walk off.
  for (const [u0, u1] of [
    [-chordHalf + 0.2, 1.7],
    [3.5, chordHalf - 0.2],
  ]) {
    services.colliders.push({
      kind: 'box',
      center: new Vector3(ux((u0 + u1) / 2), shell.mezzTop + 0.55, vz(chordV - 0.09)),
      size: new Vector3(u1 - u0, 1.1, 0.24),
    })
  }

  // ---- stairs. Flight 1 runs north to the mezzanine, flight 2 north again
  // across it to the roof opening. Both are authored ONE RISER SHORT: the
  // floor they arrive at IS the top nosing, which is how a real flight meets a
  // slab and the only way the last tread does not end up buried in it —
  // which is why each origin is `steps · run` back from the slab edge it lands
  // on, not `(steps + 1) · run`. At 23 the top tread finished 0.34 m short of
  // the mezzanine and left a gap the capsule had to bridge.
  const RUN = 0.29
  const riseA = (shell.mezzTop - shell.floor) / 23
  const flightA = {
    origin: new Vector3(ux(2.6), shell.floor, vz(mezzEdgeV + 22 * RUN)),
    yaw: Math.PI,
    steps: 22,
    width: 1.5,
    rise: riseA,
    run: RUN,
  }
  stairFlight(services.writer, flightA)
  stairColliders(services, flightA)

  // Flight 2 climbs SOUTH along the drum's long axis, from the mezzanine's
  // north end out into the middle of the roof terrace.
  //
  // It used to run east–west and climb toward the penthouse's blank wall: the
  // U-shaped penthouse opens WEST and the flight arrived at its EAST end, so
  // the head of the stair faced a wall with the stairwell behind it. Running
  // it along v also solves the headroom, which is what really sets the roof
  // opening's length — the soffit is 2.88 m over the mezzanine and a climber
  // needs 1.8 m of it, so every tread above `mezzTop + 1.08` must be under
  // open sky. That is treads 6 upward, i.e. the last 4.0 m of a 5.51 m run,
  // and no 2.7 m hole can cover it.
  const riseB = (shell.roofTop - shell.mezzTop) / 20
  const opening = shell.roofOpening
  const flightB = {
    // 19 goings back from the well's south edge, so the top nosing IS that
    // edge and the climber steps straight off onto the terrace deck.
    origin: new Vector3(ux((opening.u0 + opening.u1) / 2), shell.mezzTop, vz(opening.v1 - 19 * RUN)),
    yaw: 0,
    steps: 19,
    width: 1.4,
    rise: riseB,
    run: RUN,
  }
  stairFlight(services.writer, flightB)
  stairColliders(services, flightB)

  // Roof penthouse over the opening: three cast walls as one U prism, a lid,
  // and a warm lens so the head of the stair reads at dusk from the terrace.
  // Its open side is the SOUTH one, which is the direction the flight climbs —
  // a stair house has its door at the head of its own stair, and this one used
  // to open west while the flight arrived from the east.
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
          [ux(pu + hu - 0.22), vz(pv + hv)],
          [ux(pu + hu - 0.22), vz(pv - hv + 0.22)],
          [ux(pu - hu + 0.22), vz(pv - hv + 0.22)],
          [ux(pu - hu + 0.22), vz(pv + hv)],
          [ux(pu - hu), vz(pv + hv)],
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
  // The lens is recessed into the LID's soffit (2.24), 4 mm clear of it, just
  // inboard of the doorway head. It has to sit over a WALL line: the penthouse
  // is a U, so a strip on the open side hangs in mid-air over the stairwell.
  const lamp = bevel(
    prism(
      roundedRect(0.5, 0.09, 0.02, 2).map(([x, z]) => [ux(pu) + x, vz(pv + hv - 0.14) + z] as Vec2),
      shell.roofTop + 2.176,
      shell.roofTop + 2.236,
    ),
    BEVEL.hardware,
    1,
  )
  parts.push(['utilityLight', smoothShade(lamp, SMOOTH.tight)])
  // Penthouse WALLS, not a solid block. The old box filled the whole house and
  // sealed the head of the stair off from the terrace it exists to reach.
  for (const [cu, cv, su, sv] of [
    [pu, pv - hv + 0.11, 2 * hu, 0.22],
    [pu - hu + 0.11, pv, 0.22, 2 * hv],
    [pu + hu - 0.11, pv, 0.22, 2 * hv],
  ]) {
    services.colliders.push({
      kind: 'box',
      center: new Vector3(ux(cu), shell.roofTop + 1.2, vz(cv)),
      size: new Vector3(su, 2.4, sv),
    })
  }

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

  // Roof terrace seating. The terrace is a place now that the flight up to it
  // works, and an empty deck with a 4.9 m stair house on it reads as plant, not
  // as a room. Kept on the west flank, well inboard of the guardrail, aimed at
  // the plain like everything else in this building.
  for (const [u, v, fan] of [
    [-3.3, -0.9, 0.06],
    [-3.25, 1.5, -0.1],
    [-2.95, 3.9, -0.26],
  ]) {
    placeChair(services, parts, ux(u), shell.roofTop, vz(v), -Math.cos(fan), Math.sin(fan))
  }
  for (const part of lowTable(ux(-2.1), shell.roofTop, vz(0.3), 0.32)) parts.push(part)

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

  // ---- coffee console, in the low-ceilinged nook UNDER the mezzanine on the
  // east wall, north of the stair's north end.
  //
  // It used to stand at (4.15, 1.2), which is 0.8 m straight in front of the
  // entrance: the door is centred on v 0.745 and a guest walks in along −u, so
  // the console (0.72 × 2.1, plus the urn) closed the doorway completely
  // (owner report). Moving it along the same wall was not enough — the stair
  // occupies u 1.85…3.35 across v −1.9…4.5, so the whole east flank from the
  // door southward is a 1.35 m entry corridor serving that flight, and
  // anything parked in it narrows the only way into the room. North of v −2.8
  // the flank opens out under the mezzanine slab, which is where a coffee
  // point belongs anyway.
  //
  // 1.6 m long, not 2.1: a straight counter against a 2:1 drum only touches
  // its curve at one point, and the shorter run keeps the service gap behind
  // it between 0.28 m (ends) and 0.47 m (middle) instead of half a metre.
  const console0 = { u: 3.58, v: -3.6, length: 1.6 }
  parts.push([
    'cast',
    bevel(
      prism(
        roundedRect(0.72, console0.length, 0.05, 3).map(
          ([x, z]) => [ux(console0.u) + x, vz(console0.v) + z] as Vec2,
        ),
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
        roundedRect(0.78, console0.length + 0.06, 0.06, 3).map(
          ([x, z]) => [ux(console0.u) + x, vz(console0.v) + z] as Vec2,
        ),
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
  translate(urn, [ux(console0.u), vz(console0.v - 0.46), shell.floor + 0.94])
  parts.push(['aluminum', urn])
  services.colliders.push({
    kind: 'box',
    center: new Vector3(ux(console0.u), shell.floor + 0.47, vz(console0.v)),
    size: new Vector3(0.8, 0.95, console0.length + 0.1),
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
  // 0.50 inboard, not 0.42: the door head casting (leisure.ts, `head`) runs
  // from 0.16 to 0.46 inboard, so at 0.42 this plate was ENTIRELY INSIDE the
  // lintel — invisible from the room it is hung for. 0.50 stands it 40 mm
  // proud of the casting's soffit face.
  sign.position.set(
    (start.x + end.x) / 2 + (inx / inl) * 0.5,
    shell.apron + 2.72,
    (start.z + end.z) / 2 + (inz / inl) * 0.5,
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
      aspect: 1.5 / 0.34,
    }),
  )
}
