import { Vector3 } from 'three'
import {
  join,
  loft,
  offsetPolyline2D,
  polyOffset,
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
import { CABIN, IDX, ceilingY, liningPoint } from './tramShape'

/**
 * The cabin. The player arrives here and rides for minutes, so it is modelled
 * to the same standard as the outside: moulded seat shells with real piped
 * cushions, a kick trim where the floor meets the lining, coved lighting that
 * washes the ceiling, stanchions whose ends are buried and flanged, and a
 * driverless status console.
 *
 * There is no separate inner shell — the hull's lining surface IS the cabin
 * wall (tramShape's inner section), so nothing in here can z-fight against
 * the body.
 */

function linspace(a: number, b: number, steps: number): number[] {
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(a + ((b - a) * i) / steps)
  return out
}

/** Applied moulding swept along the LINING (kick trims, sill caps). */
function liningMoulding(
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

// -------------------------------------------------------------------- seats

/** The seated contact surface: back top → lumbar → pan nose. Every other
 *  part of the seat is generated from THIS polyline, so the cushions cannot
 *  float off the shell (experience-craft §4.2.5). */
const SEAT_CONTACT: Vec2[] = [
  [-0.335, 0.985],
  [-0.318, 0.86],
  [-0.3, 0.7],
  [-0.286, 0.56],
  [-0.276, 0.47],
  [-0.25, 0.432],
  [-0.19, 0.418],
  [-0.08, 0.416],
  [0.04, 0.424],
  [0.14, 0.44],
  [0.205, 0.452],
]

const BENCH_HALF = CABIN.benchHalfWidth

/** Extrude a closed (z,y) loop across the bench with inset end stations, so
 *  the mouldings roll in at the ends instead of finishing as a raw slab. */
function acrossBench(loop: Vec2[], half: number, roll: number, smooth: number): MeshData {
  const stations: Array<[number, number]> = [
    [-half, roll * 2.2],
    [-half + roll * 0.7, roll],
    [-half + roll * 2.4, roll * 0.2],
    [half - roll * 2.4, roll * 0.2],
    [half - roll * 0.7, roll],
    [half, roll * 2.2],
  ]
  const rings = stations.map(([x, inset]) =>
    polyOffset(loop, -inset).map(([z, y]) => [x, y, z] as Vec3),
  )
  const m = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth })
  return unifyOrient(m)
}

function closedFromOffsets(base: Vec2[], front: number, back: number): Vec2[] {
  const a = offsetPolyline2D(base, -front)
  const b = offsetPolyline2D(base, back)
  return [...a, ...b.slice().reverse()]
}

/** One 2-place transit bench: shell, two piped cushions, pedestal, outboard
 *  leg, back grab rail, aisle armrest. ~14 parts. */
function transitBench(): MeshData {
  const parts: MeshData[] = []

  // 1. Moulded shell — a 24 mm skin behind the whole contact surface.
  const shellLoop = closedFromOffsets(SEAT_CONTACT, 0, 0.024)
  parts.push(setSlot(acrossBench(shellLoop, BENCH_HALF, 0.01, 40), 'seatShell'))

  // 2. Cushions: back and pan, each a piped pad standing 32 mm proud of the
  //    shell and buried 6 mm into it, split by a 26 mm shadow gap.
  const backRange = SEAT_CONTACT.slice(0, 5)
  const panRange = SEAT_CONTACT.slice(6)
  for (const [strip, inset] of [
    [backRange, 0.032],
    [panRange, 0.034],
  ] as const) {
    const trimmed = strip.slice()
    const loopPad = closedFromOffsets(trimmed, inset, -0.006)
    parts.push(setSlot(acrossBench(loopPad, BENCH_HALF - 0.035, 0.016, 46), 'seatCushion'))
  }

  // 3. Two slim tubular legs and a transverse spreader instead of a plinth:
  //    a cantilever frame reads as transit furniture, a block reads as a box.
  for (const lx of [-BENCH_HALF + 0.13, BENCH_HALF - 0.13]) {
    const leg = tubeAlong(
      [
        [lx, CABIN.floorY - 0.02, 0.02],
        [lx, 0.13, 0.005],
        [lx, 0.3, -0.09],
        [lx, 0.4, -0.19],
      ],
      roundedRect(0.052, 0.062, 0.024, 3),
      { smooth: 40, capStart: true, capEnd: true },
    )
    parts.push(setSlot(leg, 'alloy'))
    const pad = prism(
      roundedRect(0.14, 0.16, 0.035, 3).map(([a, b]) => [b + 0.02, a + lx] as Vec2),
      'y',
      CABIN.floorY - 0.012,
      CABIN.floorY + 0.016,
      34,
    )
    parts.push(setSlot(pad, 'alloy'))
  }
  const spreader = tubeAlong(
    [
      [-BENCH_HALF + 0.1, 0.36, -0.14],
      [BENCH_HALF - 0.1, 0.36, -0.14],
    ],
    roundedRect(0.05, 0.05, 0.022, 3),
    { smooth: 40, capStart: true, capEnd: true },
  )
  parts.push(setSlot(spreader, 'alloy'))

  // 5. Grab rail across the back top, returning into the shell at both ends.
  const rail = tubeAlong(
    [
      [-BENCH_HALF + 0.02, 0.96, -0.372],
      [-BENCH_HALF + 0.09, 1.005, -0.362],
      [BENCH_HALF - 0.09, 1.005, -0.362],
      [BENCH_HALF - 0.02, 0.96, -0.372],
    ],
    roundedRect(0.036, 0.036, 0.017, 3),
    { smooth: 40, capStart: true, capEnd: true },
  )
  parts.push(setSlot(rail, 'orangeRail'))

  // 6. Aisle armrest, on the inboard end only (fitted at placement time by
  //    mirroring the bench, so it always lands beside the aisle).
  const arm = loft(
    [
      roundedRect(0.06, 0.1, 0.028, 2).map(([x, z]) => [x - BENCH_HALF + 0.03, 0.5, z - 0.12] as Vec3),
      roundedRect(0.062, 0.34, 0.03, 3).map(([x, z]) => [x - BENCH_HALF + 0.03, 0.62, z - 0.02] as Vec3),
      roundedRect(0.05, 0.3, 0.025, 3).map(([x, z]) => [x - BENCH_HALF + 0.03, 0.655, z - 0.02] as Vec3),
    ],
    { closeSection: true, capStart: true, capEnd: true, smooth: 42 },
  )
  parts.push(setSlot(unifyOrient(arm), 'seatShell'))

  return join(parts, 40)
}

// ------------------------------------------------------------------ cabin

export interface SeatPose {
  position: Vector3
  yaw: number
}

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

  // ---- kick trim + window sill cap, both swept along the lining.
  const trimZ = linspace(-3.2, 3.2, 24)
  for (const s of [IDX.SILL_R, IDX.SILL_L]) {
    const dir = s === IDX.SILL_R ? 1 : -1
    slots.add(
      liningMoulding(
        trimZ,
        [
          [s + dir * 0.02, 0.04],
          [s + dir * 0.02, -0.016],
          [s + dir * 0.32, -0.016],
          [s + dir * 0.32, 0.04],
        ],
        'alloy',
      ),
      'alloy',
    )
  }
  for (const s of [IDX.BELT_R, IDX.BELT_L]) {
    const dir = s === IDX.BELT_R ? 1 : -1
    slots.add(
      liningMoulding(
        trimZ,
        [
          [s - dir * 0.34, 0.05],
          [s - dir * 0.34, -0.03],
          [s + dir * 0.06, -0.03],
          [s + dir * 0.06, 0.05],
        ],
        'lining',
        40,
      ),
      'lining',
    )
  }

  // ---- ceiling light coves: a channel recessed into the ceiling with a
  //      diffuser inside it, so the light has a real fixture, not paint.
  for (const sx of [-1, 1]) {
    const x = sx * 0.62
    const top = ceilingY(Math.abs(x))
    const channel = prism(
      [
        [x - 0.085, top - 0.078],
        [x + 0.085, top - 0.078],
        [x + 0.085, top + 0.016],
        [x + 0.062, top + 0.016],
        [x + 0.062, top - 0.052],
        [x - 0.062, top - 0.052],
        [x - 0.062, top + 0.016],
        [x - 0.085, top + 0.016],
      ] as Vec2[],
      'z',
      -3.05,
      3.05,
      26,
    )
    slots.add(setSlot(channel, 'alloy'), 'alloy')
    const diffuser = prism(
      roundedRect(0.116, 0.03, 0.012, 2).map(([a, b]) => [a + x, b + top - 0.064] as Vec2),
      'z',
      -3.0,
      3.0,
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
      [0.3, crown - 0.052],
      [0.3, crown + 0.02],
      [0.24, crown + 0.02],
      [0.24, crown - 0.024],
      [-0.24, crown - 0.024],
      [-0.24, crown + 0.02],
      [-0.3, crown + 0.02],
    ] as Vec2[],
    'z',
    -3.0,
    3.0,
    26,
  )
  slots.add(setSlot(raft, 'alloy'), 'alloy')
  for (let i = 0; i < 9; i++) {
    const z = -2.6 + i * 0.65
    const vent = prism(
      roundedRect(0.34, 0.13, 0.03, 3).map(([a, b]) => [b + z, a] as Vec2),
      'y',
      crown - 0.03,
      crown + 0.004,
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
  for (const zSign of [1, -1] as const) {
    for (const xSign of [1, -1] as const) {
      const bench = transitBench()
      // Mirror so the armrest always finishes on the aisle side.
      if (xSign > 0) {
        for (const v of bench.verts) v[0] = -v[0]
        for (const f of bench.faces) f.reverse()
      }
      if (zSign < 0) rotateY(bench, Math.PI)
      translate(bench, [xSign * CABIN.benchCentreX, 0, zSign * CABIN.benchZ])
      slots.add(bench, 'seatShell')
      for (const seat of [0.235, -0.235]) {
        seats.push({
          position: new Vector3(
            xSign * CABIN.benchCentreX + seat * xSign,
            CABIN.seatY,
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
      const bracket = tubeAlong(
        [
          [x, 1.925, z],
          [x + sx * 0.06, top + 0.02, z],
        ],
        roundedRect(0.03, 0.03, 0.013, 3),
        { smooth: 40, capStart: true, capEnd: true },
      )
      slots.add(setSlot(bracket, 'alloy'), 'alloy')
      const esc = flange(false)
      translate(esc, [x + sx * 0.06, top - 0.001, z])
      slots.add(setSlot(esc, 'alloy'), 'alloy')
    }
  }

  // ---- driverless status console at both ends.
  for (const end of [1, -1] as const) buildConsole(slots, end)

  return seats
}

/** Moulded console under the windshield: desk, tilted status screen with a
 *  real bezel, switch panel, and a vent grille. */
function buildConsole(slots: SlotMesh, end: 1 | -1): void {
  const z = CABIN.consoleZ * end
  const body = loft(
    [
      roundedRect(1.26, 0.4, 0.07, 3).map(([x, zz]) => [x, 0.6, z + zz * end] as Vec3),
      roundedRect(1.3, 0.42, 0.075, 3).map(([x, zz]) => [x, 0.86, z + zz * end] as Vec3),
      roundedRect(1.24, 0.36, 0.07, 3).map(([x, zz]) => [x, 1.03, z + 0.02 * end + zz * end] as Vec3),
    ],
    { closeSection: true, capStart: true, capEnd: true, smooth: 34 },
  )
  slots.add(setSlot(unifyOrient(body), 'seatShell'), 'seatShell')

  // Screen bezel sunk into the cabin-facing face, glass proud inside it.
  const bezel = prism(
    roundedRect(0.62, 0.29, 0.03, 3).map(([x, y]) => [x, y + 0.855] as Vec2),
    'z',
    end > 0 ? z - 0.235 : z + 0.19,
    end > 0 ? z - 0.19 : z + 0.235,
    24,
  )
  slots.add(setSlot(bezel, 'dark'), 'dark')
  const screen = prism(
    roundedRect(0.55, 0.235, 0.016, 2).map(([x, y]) => [x, y + 0.855] as Vec2),
    'z',
    end > 0 ? z - 0.222 : z + 0.196,
    end > 0 ? z - 0.196 : z + 0.222,
    18,
  )
  slots.add(setSlot(screen, 'screen'), 'screen')

  // Switch bank + louvred vent, so the desk is equipment and not a plinth.
  for (let i = 0; i < 5; i++) {
    const bx = -0.44 + i * 0.075
    const key = prism(
      roundedRect(0.03, 0.05, 0.01, 2).map(([kz, kx]) => [kz + z - end * 0.1, kx + bx] as Vec2),
      'y',
      1.018,
      1.046,
      18,
    )
    slots.add(setSlot(key, i === 2 ? 'orange' : 'alloy'), 'alloy')
  }
  for (let i = 0; i < 7; i++) {
    const fin = prism(
      [
        [0.16 + i * 0.036, 0.66],
        [0.16 + i * 0.036 + 0.016, 0.66],
        [0.16 + i * 0.036 + 0.016, 0.8],
        [0.16 + i * 0.036, 0.8],
      ] as Vec2[],
      'z',
      end > 0 ? z - 0.222 : z + 0.204,
      end > 0 ? z - 0.204 : z + 0.222,
      0,
    )
    slots.add(setSlot(fin, 'alloy'), 'alloy')
  }
}
