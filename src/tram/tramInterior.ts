import { Vector3 } from 'three'
import {
  arcPts,
  loft,
  prism,
  revolveY,
  rotateY,
  roundedRect,
  setSlot,
  translate,
  tubeAlong,
  unifyOrient,
} from './tramMesh'
import type { MeshData, SlotMesh, Vec2, Vec3 } from './tramMesh'
import { APERTURES, CABIN, IDX, ceilingY, liningPoint } from './tramShape'
import type { Aperture } from './tramShape'
import { buildBench, seatSurfaceY } from './tramSeat'

/**
 * The cabin. The player begins the game seated in here, so everything within
 * two metres of the arrival seat is modelled to the same standard as the
 * seats themselves (`tramSeat.ts`): moulded window surrounds with a reveal to
 * the glass, a coved ceiling with a recessed diffuser, two-piece clamp
 * fittings on the handrails, and a console that is equipment rather than a
 * plinth.
 *
 * There is no separate inner shell — the hull's lining surface IS the cabin
 * wall (tramShape's inner section), so every applied part in here is
 * GENERATED from `liningPoint(z, s, inset)` with a signed inset. NOTE the
 * sense is the OPPOSITE of `hullPoint`'s: the lining loop's outward normal
 * points into the wall, so a POSITIVE inset stands proud into the cabin and a
 * negative one buries. Nothing in here is placed by eye.
 */

function linspace(a: number, b: number, steps: number): number[] {
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(a + ((b - a) * i) / steps)
  return out
}

/** Applied moulding swept ALONG the car, profiled in (sectionIndex, inset). */
function liningRunZ(
  zs: number[],
  profile: Array<[number, number]>,
  slot: string,
  smooth = 36,
): MeshData {
  const rings = zs.map((z) => profile.map(([s, inset]) => liningPoint(z, s, inset)))
  const m = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth })
  unifyOrient(m)
  return setSlot(m, slot)
}

/** Escutcheon: the lathed flange that makes a buried rail end invisible. */
function flange(up: boolean): MeshData {
  const s = up ? 1 : -1
  const m = revolveY(
    [
      [0.0, 0.0],
      [0.056, 0.0],
      [0.059, s * 0.013],
      [0.034, s * 0.029],
      [0.0, s * 0.031],
    ],
    16,
    { smooth: 44 },
  )
  return unifyOrient(m)
}

/**
 * Half of a two-piece clamp fitting: a C-section (outer arc out, inner arc
 * back) extruded across the rail. A clamp IS two halves bolted together, and
 * modelling it that way means the bore never has to interpenetrate the rail —
 * the 1.5 mm bore clearance and the 3 deg split gaps are the whole joint.
 */
function clampHalf(a0: number, a1: number, bore: number, outer: number, half: number): MeshData {
  const poly: Vec2[] = [
    ...arcPts(0, 0, outer, a0, a1, 9),
    ...arcPts(0, 0, bore, a1, a0, 9),
  ]
  return prism(poly, 'z', -half, half, 34)
}

/**
 * The status display's glass, as ONE quad with AUTHORED UVs.
 *
 * It cannot be a prism: `planarUV` derives u from world x for any face whose
 * dominant normal is z, and the two consoles face opposite ways, so one of them
 * always renders its lettering mirrored. Screen-right is −x at the +z end and
 * +x at the −z end; the winding follows from the same sign, which is what puts
 * the emissive face toward the cabin.
 */
function screenFace(
  z: number,
  end: 1 | -1,
  width: number,
  height: number,
  cy: number,
): MeshData {
  const hw = width / 2
  const hh = height / 2
  const right = -end // screen-right in world x
  const verts: Vec3[] = [
    [-right * hw, cy - hh, z],
    [right * hw, cy - hh, z],
    [right * hw, cy + hh, z],
    [-right * hw, cy + hh, z],
  ]
  const m: MeshData = {
    verts,
    faces: [[0, 1, 2, 3]],
    faceSlot: ['screen'],
    faceUV: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ],
    smooth: 0,
  }
  return m
}

// ------------------------------------------------------------ window trim

/**
 * Moulded interior window surround. Swept once around the aperture as a closed
 * mitre-free loop, so the four corners cannot gap or double up, and stopping
 * 6 mm clear of the opening so there is a reveal to the pane's rubber rather
 * than a lap that would z-fight it.
 */
function windowSurround(a: Aperture): MeshData {
  const sLo = Math.min(a.j0, a.j1 + 1)
  const sHi = Math.max(a.j0, a.j1 + 1)
  const zc = (a.z0 + a.z1) / 2
  const sc = (sLo + sHi) / 2
  // Section index is not a length; measure how many metres one unit is worth
  // here so the profile can be authored in millimetres like everything else.
  const pA = liningPoint(zc, sc - 0.5)
  const pB = liningPoint(zc, sc + 0.5)
  const mPerS = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2])

  const hz = (a.z1 - a.z0) / 2 + 0.006
  const hs = ((sHi - sLo) / 2) * mPerS + 0.006
  const r = Math.min(0.05, hz * 0.6, hs * 0.6)

  // Path in (z, s-as-metres), densified along the long sides so the surround
  // follows the tumblehome instead of chording across it.
  const path: Array<[number, number]> = []
  const outward: Array<[number, number]> = []
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= 4; i++) {
      const ang = a0 + ((i / 4) * Math.PI) / 2
      path.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r])
      outward.push([Math.cos(ang), Math.sin(ang)])
    }
  }
  const zi = hz - r
  const si = hs - r
  const side = (
    from: [number, number],
    to: [number, number],
    dir: [number, number],
    steps: number,
  ): void => {
    for (let i = 1; i < steps; i++) {
      path.push([from[0] + (to[0] - from[0]) * (i / steps), from[1] + (to[1] - from[1]) * (i / steps)])
      outward.push(dir)
    }
  }
  const zSteps = Math.max(2, Math.round((zi * 2) / 0.22))
  corner(zi, si, 0)
  side([zi, si + r], [-zi, si + r], [0, 1], zSteps)
  corner(-zi, si, Math.PI / 2)
  side([-zi - r, si], [-zi - r, -si], [-1, 0], 3)
  corner(-zi, -si, Math.PI)
  side([-zi, -si - r], [zi, -si - r], [0, -1], zSteps)
  corner(zi, -si, Math.PI * 1.5)
  side([zi + r, -si], [zi + r, si], [1, 0], 3)

  // (outward offset, inset). For the LINING loop the outward normal points
  // into the wall, so a POSITIVE inset stands proud into the cabin and a
  // negative one buries — the opposite sense to `hullPoint`. Getting this
  // backwards turns every moulding inside out.
  const profile: Array<[number, number]> = [
    [0.0, -0.004],
    [0.0, 0.024],
    [0.012, 0.029],
    [0.03, 0.024],
    [0.034, -0.004],
  ]
  const rings = path.map(([pz, ps], i) =>
    profile.map(([out, inset]) =>
      liningPoint(zc + pz + outward[i][0] * out, sc + (ps + outward[i][1] * out) / mPerS, inset),
    ),
  )
  const m = loft(rings, { closeSection: true, closeStations: true, smooth: 38 })
  return setSlot(unifyOrient(m), 'lining')
}

// ------------------------------------------------------------------ cabin

export interface SeatPose {
  position: Vector3
  yaw: number
}

/** The cove and the crown raft stop here: past it the roof section starts to
 *  taper and a straight extrusion would emerge through the lining. */
const ROOF_TRIM_END = 2.84

export function buildInterior(slots: SlotMesh): SeatPose[] {
  const seats: SeatPose[] = []

  // ---- floor: anti-slip covering, buried 20 mm into the lining all round.
  const floorZ = linspace(-3.28, 3.28, 26)
  const floorRings = floorZ.map((z) => {
    const left = liningPoint(z, IDX.SILL_R, -0.02)
    const right = liningPoint(z, IDX.SILL_L, -0.02)
    return [
      [right[0], -0.006, z],
      [left[0], -0.006, z],
      [left[0], CABIN.floorY, z],
      [right[0], CABIN.floorY, z],
    ] as Vec3[]
  })
  const floor = loft(floorRings, {
    closeSection: true,
    capStart: true,
    capEnd: true,
    smooth: 20,
  })
  slots.add(setSlot(unifyOrient(floor), 'floorGrip'), 'floorGrip')

  // ---- kick trim + window sill rail, both swept along the lining.
  const trimZ = linspace(-3.2, 3.2, 24)
  for (const s of [IDX.SILL_R, IDX.SILL_L]) {
    const dir = s === IDX.SILL_R ? 1 : -1
    slots.add(
      liningRunZ(
        trimZ,
        [
          [s + dir * 0.02, 0.04],
          [s + dir * 0.02, -0.016],
          [s + dir * 0.1, -0.021],
          [s + dir * 0.3, -0.019],
          [s + dir * 0.32, 0.04],
        ],
        'alloy',
      ),
      'alloy',
    )
  }
  // Sill rail: pulled clear of the glazing line so the window surround below
  // can finish against it with a reveal instead of inside it.
  for (const s of [IDX.BELT_R, IDX.BELT_L]) {
    const dir = s === IDX.BELT_R ? 1 : -1
    slots.add(
      liningRunZ(
        trimZ,
        [
          [s - dir * 0.5, 0.05],
          [s - dir * 0.5, -0.03],
          [s - dir * 0.44, -0.036],
          [s - dir * 0.26, -0.034],
          [s - dir * 0.22, 0.05],
        ],
        'lining',
        40,
      ),
      'lining',
    )
  }

  // ---- window surrounds, one closed sweep per aperture.
  for (const aperture of APERTURES) {
    if (aperture.kind !== 'window') continue
    slots.add(windowSurround(aperture), 'lining')
  }

  // ---- ceiling light coves: a channel recessed into the ceiling with a
  //      diffuser inside it, so the light has a real fixture, not paint.
  for (const sx of [-1, 1]) {
    const x = sx * 0.62
    const top = ceilingY(Math.abs(x))
    const channel = prism(
      [
        [x - 0.092, top - 0.086],
        [x - 0.074, top - 0.094],
        [x + 0.074, top - 0.094],
        [x + 0.092, top - 0.086],
        [x + 0.092, top + 0.016],
        [x + 0.062, top + 0.016],
        [x + 0.062, top - 0.058],
        [x + 0.05, top - 0.066],
        [x - 0.05, top - 0.066],
        [x - 0.062, top - 0.058],
        [x - 0.062, top + 0.016],
        [x - 0.092, top + 0.016],
      ] as Vec2[],
      'z',
      -ROOF_TRIM_END,
      ROOF_TRIM_END,
      26,
    )
    slots.add(setSlot(channel, 'alloy'), 'alloy')
    // Diffuser sits INSIDE the channel's lip: its edges are never seen, so
    // the light appears to come from the cove rather than from a panel.
    const diffuser = prism(
      roundedRect(0.108, 0.028, 0.011, 2).map(([a, b]) => [a + x, b + top - 0.076] as Vec2),
      'z',
      -ROOF_TRIM_END + 0.05,
      ROOF_TRIM_END - 0.05,
      20,
    )
    slots.add(setSlot(diffuser, 'lampWarm'), 'lampWarm')
  }

  // Centre ceiling raft between the coves: without it the crown is a blank
  // 7 m void directly in the seated passenger's upward view.
  const crown = ceilingY(0)
  const raft = prism(
    [
      [-0.3, crown - 0.052],
      [-0.28, crown - 0.06],
      [0.28, crown - 0.06],
      [0.3, crown - 0.052],
      [0.3, crown + 0.02],
      [0.24, crown + 0.02],
      [0.24, crown - 0.028],
      [-0.24, crown - 0.028],
      [-0.24, crown + 0.02],
      [-0.3, crown + 0.02],
    ] as Vec2[],
    'z',
    -ROOF_TRIM_END,
    ROOF_TRIM_END,
    26,
  )
  slots.add(setSlot(raft, 'alloy'), 'alloy')
  for (let i = 0; i < 9; i++) {
    const z = -2.6 + i * 0.65
    const vent = prism(
      roundedRect(0.34, 0.13, 0.03, 3).map(([a, b]) => [b + z, a] as Vec2),
      'y',
      crown - 0.036,
      crown - 0.002,
      20,
    )
    slots.add(setSlot(vent, 'dark'), 'dark')
  }

  // Low-level door-bay wash so the step is lit at the platform edge.
  for (const sz of [-1, 1]) {
    const strip = prism(
      roundedRect(0.05, 0.024, 0.01, 2).map(([a, b]) => [a + 1.16, b + 0.2] as Vec2),
      'z',
      sz * 0.9,
      sz * 1.82,
      18,
    )
    slots.add(setSlot(strip, 'lampWarm'), 'lampWarm')
  }

  // ---- seating: two forward benches at the front, two rearward at the back.
  //      The bench is symmetric now (armrests at BOTH ends), so it is placed
  //      by translation only — no mirroring, and therefore no chance of a
  //      negative-determinant part shipping inside-out.
  const seatY = seatSurfaceY()
  for (const zSign of [1, -1] as const) {
    for (const xSign of [1, -1] as const) {
      for (const part of buildBench()) {
        if (zSign < 0) rotateY(part, Math.PI)
        translate(part, [xSign * CABIN.benchCentreX, 0, zSign * CABIN.benchZ])
        slots.add(part, 'seatShell')
      }
      for (const seat of [0.235, -0.235]) {
        seats.push({
          position: new Vector3(
            xSign * CABIN.benchCentreX + seat * xSign,
            seatY,
            zSign * CABIN.benchZ,
          ),
          yaw: zSign > 0 ? 0 : Math.PI,
        })
      }
    }
  }

  // ---- stanchions at the door bay, floor to ceiling, ends buried + flanged.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * CABIN.doorPoleX
      const z = sz * CABIN.doorPoleZ
      const top = ceilingY(Math.abs(x))
      const pole = tubeAlong(
        [
          [x, CABIN.floorY - 0.03, z],
          [x, top + 0.03, z],
        ],
        roundedRect(0.038, 0.038, 0.019, 4),
        { smooth: 40, capStart: true, capEnd: true },
      )
      slots.add(setSlot(pole, 'orangeRail'), 'orangeRail')
      const low = flange(true)
      translate(low, [x, CABIN.floorY + 0.001, z])
      slots.add(setSlot(low, 'alloy'), 'alloy')
      const high = flange(false)
      translate(high, [x, top - 0.001, z])
      slots.add(setSlot(high, 'alloy'), 'alloy')
    }
  }

  // ---- longitudinal grab rails on drop brackets over the aisle seats.
  for (const sx of [-1, 1]) {
    const x = sx * 0.93
    const rail = tubeAlong(
      [
        [x, 1.9, -2.86],
        [x, 1.93, -1.7],
        [x, 1.93, 1.7],
        [x, 1.9, 2.86],
      ],
      roundedRect(0.038, 0.038, 0.019, 4),
      { smooth: 40, capStart: true, capEnd: true },
    )
    slots.add(setSlot(rail, 'orangeRail'), 'orangeRail')
    for (const z of [-2.6, -1.35, 1.35, 2.6]) {
      const top = ceilingY(Math.abs(x))
      // The bracket starts INSIDE the clamp (both alloy, so they weld) rather
      // than inside the rail, which would be an alloy-into-orangeRail clash.
      const bracket = tubeAlong(
        [
          [x, 1.944, z],
          [x + sx * 0.06, top + 0.02, z],
        ],
        roundedRect(0.03, 0.03, 0.013, 3),
        { smooth: 40, capStart: true, capEnd: true },
      )
      slots.add(setSlot(bracket, 'alloy'), 'alloy')
      // Two-piece clamp where the bracket picks the rail up, with its own
      // bolt bosses. The bore clears the rail by 1.5 mm, so an alloy fitting
      // and an orange rail can share a joint without interpenetrating.
      for (const [a0, a1] of [
        [0.06, Math.PI - 0.06],
        [Math.PI + 0.06, Math.PI * 2 - 0.06],
      ]) {
        const half = clampHalf(a0, a1, 0.0205, 0.032, 0.021)
        translate(half, [x, 1.93, z])
        slots.add(setSlot(half, 'alloy'), 'alloy')
      }
      const esc = flange(false)
      translate(esc, [x + sx * 0.06, top - 0.001, z])
      slots.add(setSlot(esc, 'alloy'), 'alloy')
    }
  }

  // ---- driverless status console at both ends.
  for (const end of [1, -1] as const) buildConsole(slots, end)

  return seats
}

/**
 * Moulded console under the windshield — the object directly ahead of the
 * arrival seat, so it gets a rolled desk edge, a recessed screen in a gasketed
 * bezel, keys in a sunk tray, and a louvred vent inside its own frame.
 */
function buildConsole(slots: SlotMesh, end: 1 | -1): void {
  const z = CABIN.consoleZ * end
  const face = (dz: number): number => z - end * dz

  // Body: five levels, so the desk has a plinth reveal, a rolled top edge and
  // a slight tumble home rather than three stacked rounded boxes.
  const levels: Array<[number, number, number, number]> = [
    // [y, halfWidth, halfDepth, cornerRadius]. The base stops 3 mm above the
    // floor covering: a console that starts at y = 0.6 (as this one did) is a
    // box hanging in the air right in front of the arrival seat.
    [0.009, 0.6, 0.19, 0.05],
    [0.045, 0.622, 0.2, 0.055],
    [0.6, 0.63, 0.205, 0.06],
    [0.86, 0.648, 0.212, 0.065],
    [0.995, 0.634, 0.196, 0.06],
    [1.028, 0.614, 0.176, 0.05],
  ]
  const body = loft(
    levels.map(([y, hw, hd, r]) =>
      roundedRect(hw * 2, hd * 2, r, 3).map(([x, zz]) => [x, y, z + zz * end] as Vec3),
    ),
    { closeSection: true, capStart: true, capEnd: true, smooth: 34 },
  )
  slots.add(setSlot(unifyOrient(body), 'seatShell'), 'seatShell')

  // Screen: a gasket band around a bezel around the glass, each stepping in
  // and standing proud of the last — never a plate laid on a face.
  const bezel = prism(
    roundedRect(0.64, 0.31, 0.032, 3).map(([x, y]) => [x, y + 0.855] as Vec2),
    'z',
    face(0.236),
    face(0.19),
    24,
  )
  slots.add(setSlot(bezel, 'dark'), 'dark')
  const gasket = prism(
    roundedRect(0.582, 0.256, 0.022, 3).map(([x, y]) => [x, y + 0.855] as Vec2),
    'z',
    face(0.243),
    face(0.222),
    24,
  )
  slots.add(setSlot(gasket, 'rubber'), 'rubber')
  slots.add(screenFace(face(0.2455), end, 0.552, 0.228, 0.855), 'screen')

  // Switch bank: a raised bezel on the desk with the keys standing in it on a
  // 2.5 mm reveal — the shadow line under a key cap, and the joint that keeps
  // an alloy part out of a dark part without either burying or floating.
  const tray = prism(
    roundedRect(0.104, 0.44, 0.018, 3).map(([kz, kx]) => [kz + face(0.098), kx - 0.26] as Vec2),
    'y',
    1.02,
    1.038,
    26,
  )
  slots.add(setSlot(tray, 'dark'), 'dark')
  for (let i = 0; i < 5; i++) {
    const bx = -0.26 - 0.16 + i * 0.08
    const key = prism(
      roundedRect(0.058, 0.03, 0.009, 2).map(([kz, kx]) => [kz + face(0.098), kx + bx] as Vec2),
      'y',
      1.0405,
      1.0525,
      18,
    )
    slots.add(setSlot(key, i === 2 ? 'orange' : 'alloy'), i === 2 ? 'orange' : 'alloy')
  }

  // Louvred vent. The frame is a REAL picture frame — four rings closed on
  // themselves — so the fins sit in an opening instead of inside a slab, and
  // the corners can neither cross nor gap (the "four bars in one plane" trap).
  // Centre 0.575: the frame's top edge (+0.10) must clear the screen bezel's
  // bottom edge (y 0.70, x reach ±0.32) — at the old 0.735 the two shared the
  // face band x 0.14…0.32 / y 0.70…0.835 and interpenetrated.
  const ventX = 0.31
  const ventY = 0.575
  const frameRings: Vec3[][] = [
    ...([
      [0.34, 0.2, 0.022, 0.226],
      [0.34, 0.2, 0.022, 0.196],
      [0.292, 0.152, 0.014, 0.196],
      [0.292, 0.152, 0.014, 0.226],
    ] as Array<[number, number, number, number]>).map(([w, h, r, d]) =>
      roundedRect(w, h, r, 3).map(([x, y]) => [x + ventX, y + ventY, face(d)] as Vec3),
    ),
  ]
  const frame = loft(frameRings, { closeSection: true, closeStations: true, smooth: 30 })
  slots.add(setSlot(unifyOrient(frame), 'alloy'), 'alloy')
  for (let i = 0; i < 5; i++) {
    const fy = ventY - 0.062 + i * 0.031
    const fin = prism(
      [
        [ventX - 0.15, fy],
        [ventX + 0.15, fy],
        [ventX + 0.15, fy + 0.015],
        [ventX - 0.15, fy + 0.015],
      ] as Vec2[],
      'z',
      face(0.222),
      face(0.204),
      0,
    )
    slots.add(setSlot(fin, 'alloy'), 'alloy')
  }
}
