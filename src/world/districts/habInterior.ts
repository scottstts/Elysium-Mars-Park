/**
 * The Common Hab interior — the residential district's one enterable room.
 *
 * Contracts kept from the first build (other systems and the design doc rely
 * on them): a kitchenette run, a board game mid-play with four sittable
 * stools, a sofa, and the sliding entry door. The furniture is rebuilt to the
 * `friends` standard: the cabinet run is a real run — kick recess, carcass,
 * doors on their own offset line with authored gaps, a worktop with a
 * bullnose nose and a boolean-free sink cut-out — and every cushion is a
 * `plump` loft with a piped welt rather than a rounded box.
 *
 * ## Working inside a tumblehome barrel
 *
 * The shell leans: the inner wall is at |y| = 2.72 at floor level and bulges
 * to 3.27 at the waist (`habUnit.ts` section). So the run is set out from the
 * FLOOR line and the wall cabinets from the WAIST line, and the wedge between
 * them is a real niche rather than an accident. Nothing here may cross the
 * lining — different material slots are different merged meshes, and the
 * audit's clash pass compares mesh pairs.
 *
 * Local frame is the hab's own (see `habUnit.ts`): +X along the frontage,
 * +Y toward the porch, +Z up, z = 0 on the site's grade datum.
 */
import { Vector3 } from 'three'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  annularPrism,
  aperturedPrism,
  bevel,
  cleanMesh,
  circle,
  hollowPrism,
  loft,
  polyOffset,
  prism,
  prismXZ,
  revolve,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { Rng } from '../../core/prng'
import type { DistrictServices } from './types'
import { HAB_FLOOR_Z, habLocalToWorld, toSoups, writeSoups } from './habUnit'
import { commonHabFrame } from './residential'
import { slidingDoor } from './interiorShared'

/**
 * Floor level: 2 mm over the shell's floor covering, so every piece in the
 * room carries a reveal at its base rather than an exact cross-slot butt.
 */
const F = HAB_FLOOR_Z + 0.002
/** Worktop height above the floor (900 mm, the ergonomic standard). */
const COUNTER_H = 0.9
/** Seat surfaces: stool 0.46, sofa 0.44 (contract range 430-460). */
const STOOL_SEAT = 0.46
const SOFA_SEAT = 0.44
/**
 * Set-out lines measured off the shell's own section (`habUnit.ts`), all at
 * widthScale 1.2. The barrel leans, so a single "wall" number is a lie:
 *   FLOOR_HALF   the floor covering's edge — everything STANDS inside this
 *   WALL_UPPER   the lining at 2.42 m, where the wall cabinets' top-back
 *                corner would otherwise punch straight through the shell
 */
const FLOOR_HALF = 2.53
const WALL_UPPER = 3.1

function put(parts: Record<string, MeshData[]>, slot: string, ...md: MeshData[]): void {
  const list = parts[slot] ?? (parts[slot] = [])
  for (const m of md) list.push(cleanMesh(m))
}

/**
 * A cushion: six offset levels where the two mid ones push a **welt** outward,
 * so the seam is a real piped edge instead of a chamfer (`geometry-craft.md`
 * §4.2, `plump`). Nothing in this room is a rounded box.
 */
function plump(poly: Vec2[], z0: number, z1: number, welt = 0.012): MeshData {
  const h = z1 - z0
  const levels: Array<[number, number]> = [
    [-0.055, 0],
    [-0.012, 0.1],
    [welt, 0.36],
    [welt, 0.64],
    [-0.012, 0.9],
    [-0.055, 1],
  ]
  const md = loft(
    levels.map(([off, t]) => polyOffset(poly, off).map(([x, y]) => [x, y, z0 + h * t] as Vec3)),
    { closeV: true, capStart: true, capEnd: true },
  )
  return smoothShade(md, SMOOTH.shell)
}

/** A cabinet pull: two turned standoffs and a bar (the friends idiom). */
function pull(cx: number, y: number, z: number, span: number, parts: Record<string, MeshData[]>): void {
  for (const sx of [-1, 1]) {
    const boss = revolve(
      [
        [0, 0],
        [0.011, 0],
        [0.011, 0.026],
        [0.007, 0.032],
        [0, 0.034],
      ],
      10,
      { axis: 'y', smooth: SMOOTH.turned },
    )
    translate(boss, [cx + sx * (span / 2), y, z])
    put(parts, 'aluminum', boss)
  }
  put(
    parts,
    'aluminum',
    smoothShade(
      tubeAlong(
        [
          [cx - span / 2, y + 0.034, z],
          [cx + span / 2, y + 0.034, z],
        ],
        circle(0.011, 10),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
}

/**
 * The kitchenette run. Plan line is the BACK wall at floor level; every part
 * mitres on its own offset from that line — plinth set back 60 mm for a
 * shadow gap at the floor, fronts on their own line with 8 mm gaps all round,
 * worktop overhanging the fronts by 25 mm with a true bullnose nose.
 */
function cabinetRun(parts: Record<string, MeshData[]>): { x0: number; x1: number; back: number; front: number } {
  const x0 = -4.2
  const x1 = -0.6
  const back = -(FLOOR_HALF - 0.02)
  const depth = 0.64
  const front = back + depth

  const carcassPoly = (inset: number): Vec2[] =>
    roundedRect(x1 - x0 - inset * 2, depth - inset * 2, 0.012, 1).map(
      ([x, y]) => [x + (x0 + x1) / 2, y + (back + front) / 2] as Vec2,
    )

  // plinth, set back so a shadow line runs at the floor
  const plinth = prism(carcassPoly(0.06), F, F + 0.128)
  bevel(plinth, BEVEL.carcass, 2)
  put(parts, 'dark', plinth)
  // carcass — a real open-topped box, so the sink bowl hangs into a CAVITY
  // rather than into solid material
  put(
    parts,
    'habShell',
    hollowPrism(carcassPoly(0), F + 0.13, F + COUNTER_H - 0.042, carcassPoly(0.02), F + 0.17, 0.01),
  )
  // fronts: five modules on their own offset line, 8 mm gaps all round
  const modules = 5
  const span = (x1 - x0 - 0.016) / modules
  for (let k = 0; k < modules; k++) {
    const cx = x0 + 0.008 + span * (k + 0.5)
    const drawer = k === 1 || k === 3
    if (drawer) {
      for (let d = 0; d < 3; d++) {
        const zl = F + 0.14 + d * ((COUNTER_H - 0.19) / 3)
        const zh = zl + (COUNTER_H - 0.19) / 3 - 0.008
        const face = prism(
          roundedRect(span - 0.016, 0.024, 0.006, 1).map(([x, y]) => [x + cx, y + front + 0.019] as Vec2),
          zl,
          zh,
        )
        bevel(face, BEVEL.hardware, 2)
        put(parts, 'steelEdge', face)
        pull(cx, front + 0.0315, (zl + zh) / 2, Math.min(0.34, span * 0.5), parts)
      }
    } else {
      const face = prism(
        roundedRect(span - 0.016, 0.024, 0.006, 1).map(([x, y]) => [x + cx, y + front + 0.019] as Vec2),
        F + 0.14,
        F + COUNTER_H - 0.048,
      )
      bevel(face, BEVEL.hardware, 2)
      put(parts, 'steelEdge', face)
      pull(cx, front + 0.0315, F + COUNTER_H - 0.16, Math.min(0.34, span * 0.5), parts)
    }
  }
  // worktop: bullnose nose, 25 mm overhang, a boolean-free sink cut-out
  // same corner-segment count as the sink outline: `aperturedPrism` bridges
  // the two outlines vertex for vertex, so their counts AND their semantic
  // corners have to agree (that is the price of never using CSG)
  const topOuter = roundedRect(x1 - x0 + 0.06, depth + 0.05, 0.02, 3).map(
    ([x, y]) => [x + (x0 + x1) / 2, y + (back + front) / 2 + 0.025] as Vec2,
  )
  const sinkOuter = roundedRect(0.62, 0.42, 0.06, 3).map(([x, y]) => [x + x0 + 0.85, y + back + depth * 0.52] as Vec2)
  const top = aperturedPrism(topOuter, sinkOuter, F + COUNTER_H - 0.04, F + COUNTER_H, 0.014, 2)
  put(parts, 'steelEdge', top)
  // Top-mount sink: the bowl hangs THROUGH the cut-out (so it never touches
  // the worktop's jamb) and the rim plate lands on top of the worktop with a
  // 2 mm reveal. An under-mount bowl wider than its own aperture would run
  // straight through both the worktop and the carcass.
  const bowl = hollowPrism(
    polyOffset(sinkOuter, -0.012),
    F + COUNTER_H - 0.24,
    F + COUNTER_H + 0.014,
    polyOffset(sinkOuter, -0.03),
    F + COUNTER_H - 0.228,
    0.014,
  )
  put(parts, 'aluminum', bowl)
  put(
    parts,
    'aluminum',
    annularPrism(polyOffset(sinkOuter, 0.03), sinkOuter, F + COUNTER_H + 0.002, F + COUNTER_H + 0.014, 0.005, 1),
  )
  // mixer tap
  put(
    parts,
    'aluminum',
    smoothShade(
      tubeAlong(
        [
          [x0 + 0.85, back + 0.1, F + COUNTER_H],
          [x0 + 0.85, back + 0.1, F + COUNTER_H + 0.24],
          [x0 + 0.85, back + 0.22, F + COUNTER_H + 0.32],
          [x0 + 0.85, back + 0.36, F + COUNTER_H + 0.28],
        ],
        circle(0.019, 10),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  // hob: a recessed plate with four turned rings
  const hobPlate = prism(
    roundedRect(0.6, 0.46, 0.03, 2).map(([x, y]) => [x + x1 - 0.62, y + back + depth * 0.5] as Vec2),
    F + COUNTER_H,
    F + COUNTER_H + 0.012,
  )
  bevel(hobPlate, BEVEL.hardware, 2)
  put(parts, 'dark', hobPlate)
  for (const [dx, dy] of [
    [-0.14, -0.1],
    [0.14, -0.1],
    [-0.14, 0.1],
    [0.14, 0.1],
  ] as const) {
    const ring = revolve(
      [
        [0.055, 0],
        [0.085, 0.002],
        [0.085, 0.012],
        [0.055, 0.014],
      ],
      16,
      { smooth: SMOOTH.turned },
    )
    translate(ring, [x1 - 0.62 + dx, back + depth * 0.5 + dy, F + COUNTER_H + 0.012])
    put(parts, 'steelEdge', ring)
  }

  // wall cabinets set out from the WAIST line, so the barrel's lean makes a
  // niche over the worktop instead of a mystery gap
  const upBack = -(WALL_UPPER - 0.02)
  const upFront = upBack + 0.42
  const upPoly = roundedRect(x1 - x0 - 0.4, 0.42, 0.014, 1).map(
    ([x, y]) => [x + (x0 + x1) / 2, y + (upBack + upFront) / 2] as Vec2,
  )
  const uppers = prism(upPoly, F + 1.34, F + 1.92)
  bevel(uppers, BEVEL.panel, 2)
  put(parts, 'habShell', uppers)
  for (let k = 0; k < 4; k++) {
    const w = (x1 - x0 - 0.42) / 4
    const cx = x0 + 0.21 + w * (k + 0.5)
    const face = prism(
      roundedRect(w - 0.012, 0.022, 0.005, 1).map(([x, y]) => [x + cx, y + upFront + 0.012] as Vec2),
      F + 1.35,
      F + 1.91,
    )
    bevel(face, BEVEL.hardware, 2)
    put(parts, 'steelEdge', face)
    pull(cx, upFront + 0.023, F + 1.42, Math.min(0.3, w * 0.5), parts)
  }
  // under-cabinet light: a recessed lens behind a bezel (never bare paint)
  const bezel = prismXZ(
    [
      [x0 + 0.24, F + 1.302],
      [x1 - 0.24, F + 1.302],
      [x1 - 0.24, F + 1.34],
      [x0 + 0.24, F + 1.34],
    ],
    upBack + 0.06,
    upFront - 0.02,
  )
  put(parts, 'dark', bezel)
  const lens = prismXZ(
    [
      [x0 + 0.28, F + 1.318],
      [x1 - 0.28, F + 1.318],
      [x1 - 0.28, F + 1.336],
      [x0 + 0.28, F + 1.336],
    ],
    upBack + 0.12,
    upFront - 0.08,
  )
  put(parts, 'utilityLight', lens)

  return { x0, x1, back, front }
}

/** The board table: moulded top on an apron and four tapered legs. */
function boardTable(parts: Record<string, MeshData[]>, cx: number, cy: number, rng: Rng): void {
  const w = 1.62
  const d = 1.06
  const topZ = F + 0.74
  const plan = roundedRect(w, d, 0.14, 3).map(([x, y]) => [x + cx, y + cy] as Vec2)
  // a real bullnose: five offset levels, not a chamfer
  const top = loft(
    (
      [
        [-0.006, 0],
        [0.0, 0.008],
        [0.004, 0.024],
        [0.0, 0.04],
        [-0.006, 0.048],
      ] as Array<[number, number]>
    ).map(([off, dz]) => polyOffset(plan, off).map(([x, y]) => [x, y, topZ - 0.048 + dz] as Vec3)),
    { closeV: true, capStart: true, capEnd: true },
  )
  put(parts, 'aluminum', smoothShade(top, SMOOTH.top))
  const apron = prism(polyOffset(plan, -0.09), topZ - 0.15, topZ - 0.052)
  bevel(apron, BEVEL.frame, 2)
  put(parts, 'habShell', apron)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const foot = roundedRect(0.07, 0.07, 0.022, 2)
      const legX = cx + sx * (w / 2 - 0.13)
      const legY = cy + sy * (d / 2 - 0.13)
      const leg = loft(
        (
          [
            [0, -0.012],
            [0.06, 0],
            [1, -0.014],
          ] as Array<[number, number]>
        ).map(([t, off]) =>
          polyOffset(foot, off).map(([x, y]) => [x + legX, y + legY, F + t * (topZ - 0.152 - F)] as Vec3),
        ),
        { closeV: true, capStart: true, capEnd: true },
      )
      put(parts, 'dark', smoothShade(leg, SMOOTH.moulded))
    }
  }
  // the game, mid-play: a board with a raised border, tokens, two mugs
  const boardPlan = roundedRect(0.66, 0.66, 0.02, 2).map(([x, y]) => [x + cx - 0.08, y + cy + 0.04] as Vec2)
  const board = prism(boardPlan, topZ + 0.004, topZ + 0.017)
  bevel(board, BEVEL.hardware, 2)
  put(parts, 'fabricRust', board)
  put(
    parts,
    'dark',
    annularPrism(polyOffset(boardPlan, 0.014), polyOffset(boardPlan, 0.002), topZ + 0.004, topZ + 0.02, 0.004, 1),
  )
  for (let i = 0; i < 11; i++) {
    const token = revolve(
      [
        [0, 0],
        [0.019, 0],
        [0.021, 0.004],
        [0.021, 0.011],
        [0.017, 0.014],
        [0, 0.014],
      ],
      10,
      { smooth: SMOOTH.tight },
    )
    translate(token, [cx - 0.08 + rng.range(-0.26, 0.26), cy + 0.04 + rng.range(-0.26, 0.26), topZ + 0.019])
    put(parts, i % 2 === 0 ? 'orange' : 'playBlue', token)
  }
  for (const [mx, my] of [
    [0.58, -0.26],
    [0.5, 0.3],
  ] as const) {
    const mug = revolve(
      [
        [0, 0],
        [0.041, 0],
        [0.043, 0.008],
        [0.044, 0.088],
        [0.04, 0.094],
        [0.036, 0.088],
        [0.035, 0.012],
        [0, 0.01],
      ],
      14,
      { smooth: SMOOTH.turned },
    )
    translate(mug, [cx + mx, cy + my, topZ + 0.002])
    put(parts, 'habShell', mug)
    const handle = tubeAlong(
      [
        [cx + mx + 0.042, cy + my, topZ + 0.032],
        [cx + mx + 0.078, cy + my, topZ + 0.052],
        [cx + mx + 0.042, cy + my, topZ + 0.074],
      ],
      circle(0.008, 8),
      { cap: true },
    )
    put(parts, 'habShell', smoothShade(handle, SMOOTH.turned))
  }
}

/** A stool: turned pedestal, foot ring, dished moulded seat. */
function stool(parts: Record<string, MeshData[]>, x: number, y: number): void {
  const base = revolve(
    [
      [0, 0],
      [0.19, 0],
      [0.2, 0.014],
      [0.19, 0.03],
      [0.06, 0.042],
      [0.055, 0.09],
      [0, 0.09],
    ],
    20,
    { smooth: SMOOTH.turned },
  )
  translate(base, [x, y, F])
  put(parts, 'dark', base)
  const column = revolve(
    [
      [0, 0.092],
      [0.052, 0.092],
      [0.048, 0.16],
      [0.042, STOOL_SEAT - 0.1],
      [0.055, STOOL_SEAT - 0.07],
      [0, STOOL_SEAT - 0.066],
    ],
    16,
    { smooth: SMOOTH.turned },
  )
  translate(column, [x, y, F])
  put(parts, 'aluminum', column)
  const ring = revolve(
    [
      [0.145, 0],
      [0.163, 0.004],
      [0.163, 0.024],
      [0.145, 0.028],
    ],
    20,
    { smooth: SMOOTH.turned },
  )
  translate(ring, [x, y, F + 0.19])
  put(parts, 'aluminum', ring)
  const seatPlan = roundedRect(0.34, 0.34, 0.14, 4).map(([sx, sy]) => [sx + x, sy + y] as Vec2)
  const seat = loft(
    (
      [
        [-0.03, 0],
        [-0.004, 0.012],
        [0.002, 0.034],
        [-0.008, 0.056],
        [-0.05, 0.062],
      ] as Array<[number, number]>
    ).map(([off, dz]) => polyOffset(seatPlan, off).map(([sx, sy]) => [sx, sy, F + STOOL_SEAT - 0.062 + dz] as Vec3)),
    { closeV: true, capStart: true, capEnd: true },
  )
  put(parts, 'fabricSand', smoothShade(seat, SMOOTH.shell))
}

/** The sofa: frame, turned feet, plumped cushions with piped welts, rolls. */
function sofa(parts: Record<string, MeshData[]>, cx: number, cy: number, yawFlip: number): void {
  const w = 2.0
  const d = 0.86
  const sx = (x: number): number => cx + x * yawFlip
  const plan = roundedRect(w, d, 0.09, 2).map(([x, y]) => [sx(x), y + cy] as Vec2)
  const frame = prism(polyOffset(plan, -0.02), F + 0.12, F + 0.3)
  bevel(frame, BEVEL.frame, 2)
  put(parts, 'habShell', frame)
  const apron = prism(polyOffset(plan, -0.05), F + 0.09, F + 0.118)
  bevel(apron, BEVEL.carcass, 2)
  put(parts, 'dark', apron)
  for (const ax of [-1, 1]) {
    for (const ay of [-1, 1]) {
      const foot = revolve(
        [
          [0, 0],
          [0.036, 0],
          [0.038, 0.012],
          [0.03, 0.05],
          [0.034, 0.075],
          [0.03, 0.1],
          [0, 0.105],
        ],
        14,
        { smooth: SMOOTH.turned },
      )
      translate(foot, [sx(ax * (w / 2 - 0.11)), cy + ay * (d / 2 - 0.11), F])
      put(parts, 'dark', foot)
    }
  }
  // seat cushions
  for (const k of [-1, 1]) {
    const poly = roundedRect(w / 2 - 0.22, 0.58, 0.09, 3).map(
      ([x, y]) => [sx(x + k * 0.46), y + cy - 0.1] as Vec2,
    )
    put(parts, 'fabricBlue', plump(poly, F + 0.302, F + SOFA_SEAT, 0.014))
  }
  // back cushions, leaning
  for (const k of [-1, 1]) {
    const poly = roundedRect(w / 2 - 0.22, 0.2, 0.06, 3).map(
      ([x, y]) => [sx(x + k * 0.46), y + cy + 0.31] as Vec2,
    )
    const cushion = plump(poly, F + SOFA_SEAT + 0.02, F + 0.88, 0.016)
    for (const v of cushion.verts) {
      const t = (v[2] - (F + SOFA_SEAT + 0.02)) / 0.42
      v[1] += t * 0.09 * yawFlip * yawFlip
    }
    put(parts, 'fabricBlue', cushion)
  }
  // scroll arms: a closed side silhouette lofted across with inset ends
  for (const k of [-1, 1]) {
    const sil: Vec2[] = [
      [cy - d / 2 + 0.03, F + 0.302],
      [cy + d / 2 - 0.03, F + 0.302],
      [cy + d / 2 - 0.03, F + 0.6],
      [cy + d / 2 - 0.09, F + 0.66],
      [cy - d / 2 + 0.12, F + 0.66],
      [cy - d / 2 + 0.03, F + 0.58],
    ]
    const stations: Array<[number, number]> = [
      [0, -0.02],
      [0.16, -0.004],
      [0.84, -0.004],
      [1, -0.02],
    ]
    const xa = sx(k * (w / 2 - 0.12))
    const xb = sx(k * (w / 2 + 0.02))
    const arm = loft(
      stations.map(([t, off]) =>
        polyOffset(sil, off).map(([y, z]) => [xa + (xb - xa) * t, y, z] as Vec3),
      ),
      { closeV: true, capStart: true, capEnd: true },
    )
    put(parts, 'fabricSand', smoothShade(arm, SMOOTH.shell))
  }
}

/**
 * A shelf unit against the far end wall — the room's stored life.
 *
 * Set-out that the contents depend on: the side panels' INNER faces are at
 * `x ± 0.184` (centres ±0.197, 26 mm thick) and the shelf pitch is 0.40, so
 * every shelf has 0.374 of clear height under the next one. The case head is
 * 0.28 over the top shelf for the same reason — at the old 1.94 the top shelf
 * had 94 mm of air over it and its contents grew straight out of the case.
 */
const SHELF_PITCH = 0.4
const SHELF_0 = 0.22
const SHELF_COUNT = 5
const CASE_H = SHELF_0 + (SHELF_COUNT - 1) * SHELF_PITCH + 0.28
/** Clear width the contents may occupy: inner faces less an 8 mm side margin. */
const SHELF_CLEAR_HALF = 0.176

function shelfUnit(parts: Record<string, MeshData[]>, x: number, rng: Rng): void {
  const back = -(FLOOR_HALF - 0.03)
  const depth = 0.36
  const plan = roundedRect(0.42, depth, 0.045, 2).map(([px, py]) => [px + x, py + back + depth / 2] as Vec2)
  for (const sy of [-1, 1]) {
    const side = prism(
      roundedRect(0.026, depth, 0.006, 1).map(([px, py]) => [px + x + sy * 0.197, py + back + depth / 2] as Vec2),
      F,
      F + CASE_H,
    )
    bevel(side, BEVEL.panel, 2)
    put(parts, 'habShell', side)
  }
  for (let k = 0; k < SHELF_COUNT; k++) {
    const z = F + SHELF_0 + k * SHELF_PITCH
    const shelf = prism(polyOffset(plan, -0.028), z, z + 0.024)
    bevel(shelf, BEVEL.panel, 2)
    put(parts, 'habShell', shelf)
    // Contents are packed into equal CELLS across the clear width, one item per
    // cell with a 14 mm gap either side of it. On the old fixed 70 mm stride
    // (`x − 0.14 + i/(items−1) · 0.28`) two 90 mm boxes could not both fit in
    // it: at five items neighbours overlapped by up to 20 mm and the end pair
    // ran 1 mm into the side panels.
    const items = rng.int(2, 5)
    const cell = (SHELF_CLEAR_HALF * 2) / items
    // Height is bounded by what is actually over this shelf, so nothing grows
    // through the shelf above it or out of the top of the case.
    const clear = (k === SHELF_COUNT - 1 ? CASE_H - (SHELF_0 + k * SHELF_PITCH) : SHELF_PITCH) - 0.026 - 0.03
    for (let i = 0; i < items; i++) {
      const h = rng.range(0.1, Math.min(0.24, clear))
      const wdt = Math.min(rng.range(0.04, 0.09), cell - 0.028)
      const slack = (cell - wdt - 0.028) / 2
      const px = x - SHELF_CLEAR_HALF + (i + 0.5) * cell + rng.range(-slack, slack)
      const box = prism(
        roundedRect(wdt, rng.range(0.14, 0.24), 0.008, 1).map(
          ([bx, by]) => [bx + px, by + back + depth * 0.5] as Vec2,
        ),
        z + 0.026,
        z + 0.026 + h,
      )
      bevel(box, BEVEL.hardware, 2)
      put(parts, rng.pick(['fabricSand', 'fabricRust', 'steelEdge', 'dark']), box)
    }
  }
}

/** Two linear pendants — the light the porch sees through the glazing. */
function pendants(parts: Record<string, MeshData[]>, ceilingZ: number): void {
  for (const cx of [-2.3, 1.9]) {
    for (const sy of [-1, 1]) {
      put(
        parts,
        'dark',
        smoothShade(
          tubeAlong(
            [
              [cx + sy * 0.5, 0, ceilingZ],
              [cx + sy * 0.5, 0, ceilingZ - 0.42],
            ],
            circle(0.008, 6),
            { cap: true },
          ),
          SMOOTH.turned,
        ),
      )
    }
    const housing = prism(roundedRect(1.36, 0.24, 0.05, 3), ceilingZ - 0.5, ceilingZ - 0.42)
    bevel(housing, BEVEL.frame, 2)
    translate(housing, [cx, 0, 0])
    put(parts, 'dark', housing)
    const lens = prism(roundedRect(1.26, 0.18, 0.04, 3), ceilingZ - 0.53, ceilingZ - 0.5)
    bevel(lens, BEVEL.panel, 1)
    translate(lens, [cx, 0, 0])
    put(parts, 'interiorGlow', lens)
  }
}

/** Common Hab interior (residential district owns this file). */
export function buildCommonHabInterior(services: DistrictServices): void {
  const { writer } = services
  const frame = commonHabFrame()
  const rng = services.rng.fork('common-hab-interior')
  const parts: Record<string, MeshData[]> = {}
  const world = (x: number, y: number, z: number): Vector3 =>
    habLocalToWorld(frame.center, frame.yaw, x, y, z)

  const run = cabinetRun(parts)
  services.colliders.push({
    kind: 'box',
    center: world((run.x0 + run.x1) / 2, (run.back + run.front) / 2, 0).setY(frame.ground + F + 0.46),
    size: new Vector3(run.x1 - run.x0 + 0.06, 0.92, run.front - run.back + 0.05),
    yaw: frame.yaw,
  })

  const tableX = 0.9
  const tableY = -0.15
  boardTable(parts, tableX, tableY, rng.fork('board-game'))
  services.colliders.push({
    kind: 'box',
    center: world(tableX, tableY, 0).setY(frame.ground + F + 0.38),
    size: new Vector3(1.62, 0.76, 1.06),
    yaw: frame.yaw,
  })
  for (const [ax, ay] of [
    [-1.06, 0.12],
    [-1.02, -0.5],
    [2.84, 0.06],
    [2.8, -0.52],
  ] as const) {
    stool(parts, ax, ay)
    const seat = world(ax, ay, F + STOOL_SEAT)
    services.seats.push({
      seat,
      yaw: Math.atan2(world(tableX, tableY, 0).x - seat.x, world(tableX, tableY, 0).z - seat.z),
      label: 'Join the game',
    })
  }

  // the sofa sits at the +x end, facing back down the room
  const sofaX = 3.55
  const sofaY = 0.9
  sofa(parts, sofaX, sofaY, 1)
  services.seats.push({
    seat: world(sofaX, sofaY - 0.06, F + SOFA_SEAT),
    yaw: frame.yaw + Math.PI,
    label: 'Sit',
  })
  services.colliders.push({
    kind: 'box',
    center: world(sofaX, sofaY, 0).setY(frame.ground + F + 0.3),
    size: new Vector3(2.1, 0.6, 0.9),
    yaw: frame.yaw,
  })

  shelfUnit(parts, 1.9, rng.fork('shelves'))
  pendants(parts, F + 2.86)

  writeSoups(writer, toSoups(parts), frame.center, frame.yaw)

  // the animated entry panel goes in the collar mouth the shell handed back
  const mouth = frame.unit.doorMouth
  slidingDoor(
    services,
    world(mouth.center[0], mouth.center[1] - 0.06, mouth.center[2]),
    frame.yaw,
    'Enter the common hab',
    mouth.width - 0.05,
    mouth.height - 0.05,
  )
}
