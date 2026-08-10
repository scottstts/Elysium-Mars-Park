import { Group } from 'three'
import {
  apertureShell,
  bridge,
  emptyMesh,
  fanRings,
  flipFaces,
  join,
  loft,
  prism,
  revolveY,
  roundedRect,
  setSlot,
  tubeAlong,
  unifyOrient,
} from './tramMesh'
import type { MeshData, SlotMesh, Vec2, Vec3 } from './tramMesh'
import {
  APERTURES,
  DOOR_HALF,
  HALF_LENGTH,
  IDX,
  STATIONS,
  hullPoint,
  sectionAt,
  taperApply,
} from './tramShape'
import type { TramMaterials } from './tramMaterials'

/**
 * Exterior of THE LOOP. Assembly order is region-by-region and, within each
 * region, shell → trim → hardware → lamp (experience-craft §5.1) — never a
 * "greeble pass at the end".
 *
 * Two habits do all the defect prevention here:
 *  - every applied part is a `mouldingLoft` over `(sectionIndex, inset)`, so
 *    it is generated FROM the hull surface and physically cannot float, gap,
 *    or land coplanar with it;
 *  - every part that meets the skin is buried a few millimetres INTO it and,
 *    where the burial would show, capped with a flange.
 */

// ------------------------------------------------------------ hull helpers

/**
 * Sweep a closed `(sectionIndex, inset)` profile along the body. This is the
 * workhorse: sill trims, livery bands, door tracks and rubbing strips are all
 * the same call with a different profile.
 */
export function mouldingLoft(
  zs: number[],
  profile: Array<[number, number]>,
  slot: string,
  options: {
    withRecess?: boolean
    /** Extra inset per station — ramp a moulding into the skin at its ends. */
    insetShift?: (z: number) => number
    smooth?: number
  } = {},
): MeshData {
  const withRecess = options.withRecess ?? true
  const rings = zs.map((z) => {
    const shift = options.insetShift ? options.insetShift(z) : 0
    return profile.map(([s, inset]) => hullPoint(z, s, inset + shift, withRecess))
  })
  const m = loft(rings, {
    closeSection: true,
    capStart: true,
    capEnd: true,
    smooth: options.smooth ?? 36,
  })
  unifyOrient(m)
  return setSlot(m, slot)
}

function linspace(a: number, b: number, steps: number): number[] {
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(a + ((b - a) * i) / steps)
  return out
}

// ------------------------------------------------------------------- hull

// Livery break: everything BELOW the cabin floor line is the dark underframe
// valance, everything above is the white body. The break lands on the sill
// index, so it is exactly the same line the door threshold sits on.
const SKIRT_CELL_MAX = IDX.SILL_R - 1 // cells 0..9
const SKIRT_CELL_MIN_L = IDX.SILL_L // cells 42..51 mirror it

function hullSlotOuter(j: number): string {
  return j <= SKIRT_CELL_MAX || j >= SKIRT_CELL_MIN_L ? 'dark' : 'body'
}

function hullSlotReveal(j: number): string {
  // Door jambs and the threshold are dark; every glazing reveal is anodized.
  return j >= IDX.SILL_R && j < IDX.BELT_R ? 'dark' : 'alloy'
}

function cellIsSolid(zMid: number, j: number): boolean {
  for (const a of APERTURES) {
    if (zMid > a.z0 && zMid < a.z1 && j >= a.j0 && j <= a.j1) return false
  }
  return true
}

/** The monocoque: one welded grid, apertures cut by omission, every hole
 *  jambed by a reveal quad of the real wall thickness. */
export function buildHull(slots: SlotMesh): void {
  const outer: Vec3[][] = STATIONS.map((z) =>
    sectionAt(z).outer.map((p) => taperApply(p, z)),
  )
  const inner: Vec3[][] = STATIONS.map((z) =>
    sectionAt(z).inner.map((p) => taperApply(p, z)),
  )
  const shell = apertureShell(
    { outer, inner },
    {
      closeSection: true,
      smooth: 32,
      solid: (i, j) => cellIsSolid((STATIONS[i] + STATIONS[i + 1]) * 0.5, j),
      outerSlot: (_i, j) => hullSlotOuter(j),
      innerSlot: () => 'lining',
      revealSlot: (_i, j) => hullSlotReveal(j),
    },
  )
  slots.add(shell, 'body')
}

// ---------------------------------------------------------------- glazing

/**
 * A pane and its gasket as ONE part: the outer ring of the grid sits 4 mm
 * below the skin (buried under the reveal) and the next ring drops to the
 * 30 mm glass plane, so the band between them IS the rubber glazing seal.
 * No separate frame, no coincident face, no visible slot.
 */
function framedPane(z0: number, z1: number, s0: number, s1: number): MeshData {
  const zs = [z0 - 0.012, z0 + 0.006, ...linspace(z0 + 0.14, z1 - 0.14, 4), z1 - 0.006, z1 + 0.012]
  const ss = [s0 - 0.14, s0 + 0.07, ...linspace(s0 + 0.4, s1 - 0.4, 3), s1 - 0.07, s1 + 0.14]
  const isEdge = (i: number, n: number): boolean => i === 0 || i === n - 1
  const rings = zs.map((z, zi) =>
    ss.map((s, si) => {
      const border = isEdge(zi, zs.length) || isEdge(si, ss.length)
      return hullPoint(z, s, border ? 0.004 : 0.03)
    }),
  )
  const m = loft(rings, { smooth: 24 })
  // Route the border band to rubber; the loft emits (station, section) order.
  const cols = ss.length - 1
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const border = i === 0 || i === zs.length - 2 || j === 0 || j === cols - 1
      m.faceSlot[i * cols + j] = border ? 'rubber' : 'glass'
    }
  }
  return m
}

export function buildGlazing(slots: SlotMesh): void {
  for (const a of APERTURES) {
    if (a.kind !== 'window') continue
    slots.add(framedPane(a.z0, a.z1, a.j0, a.j1 + 1), 'glass')
  }
}

// ------------------------------------------------------------------ doors

const LEAF_WIDTH = 0.88
const LEAF_S0 = 10.03
const LEAF_S1 = 17.92

/**
 * External sliding leaf. Sampled from the hull WITHOUT the door-bay recess,
 * so the closed leaf finishes 6 mm inside the surrounding skin and still
 * clears the recessed pocket wall behind it by 6 mm when open.
 */
function doorLeaf(zCentre: number): MeshData {
  const z0 = zCentre - LEAF_WIDTH / 2
  const z1 = zCentre + LEAF_WIDTH / 2
  const zs = [z0, z0 + 0.05, ...linspace(z0 + 0.2, z1 - 0.2, 3), z1 - 0.05, z1]
  const ss = [LEAF_S0, LEAF_S0 + 0.16, ...linspace(11.4, 16.9, 5), LEAF_S1 - 0.16, LEAF_S1]
  const outer = zs.map((z) => ss.map((s) => hullPoint(z, s, 0.006, false)))
  const inner = zs.map((z) => ss.map((s) => hullPoint(z, s, 0.046, false)))
  // Window aperture: a rounded opening in the middle of the leaf.
  const winZ0 = z0 + 0.11
  const winZ1 = z1 - 0.11
  const winS0 = 14.05
  const winS1 = 17.35
  const solid = (i: number, j: number): boolean => {
    const zm = (zs[i] + zs[i + 1]) * 0.5
    const sm = (ss[j] + ss[j + 1]) * 0.5
    return !(zm > winZ0 && zm < winZ1 && sm > winS0 && sm < winS1)
  }
  const leaf = apertureShell(
    { outer, inner },
    {
      smooth: 30,
      solid,
      outerSlot: () => 'body',
      innerSlot: () => 'lining',
      revealSlot: () => 'alloy',
    },
  )
  // Close the leaf's four edges with the wall thickness, and make the two
  // vertical edges rubber — those are the seals you see meeting at the centre.
  const zLast = zs.length - 1
  const sLast = ss.length - 1
  const rowOuter = (index: number): Vec3[] => outer.map((r) => r[index])
  const rowInner = (index: number): Vec3[] => inner.map((r) => r[index])
  const edges = [
    setSlot(flipFaces(bridge(outer[0], inner[0])), 'rubber'),
    setSlot(bridge(outer[zLast], inner[zLast]), 'rubber'),
    setSlot(bridge(rowOuter(0), rowInner(0)), 'alloy'),
    setSlot(flipFaces(bridge(rowOuter(sLast), rowInner(sLast))), 'alloy'),
  ]
  // Glass in the leaf window, plus its own gasket band.
  const glassZ = [winZ0 - 0.01, winZ0 + 0.008, ...linspace(winZ0 + 0.1, winZ1 - 0.1, 2), winZ1 - 0.008, winZ1 + 0.01]
  const glassS = [winS0 - 0.12, winS0 + 0.06, ...linspace(winS0 + 0.5, winS1 - 0.5, 2), winS1 - 0.06, winS1 + 0.12]
  const glassRings = glassZ.map((z, zi) =>
    glassS.map((s, si) => {
      const border =
        zi === 0 || zi === glassZ.length - 1 || si === 0 || si === glassS.length - 1
      return hullPoint(z, s, border ? 0.01 : 0.026, false)
    }),
  )
  const pane = loft(glassRings, { smooth: 24 })
  const cols = glassS.length - 1
  for (let i = 0; i < glassZ.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const border = i === 0 || i === glassZ.length - 2 || j === 0 || j === cols - 1
      pane.faceSlot[i * cols + j] = border ? 'rubber' : 'glass'
    }
  }
  // The livery band continues across the leaf at exactly the bodyside
  // height, so it lines up when closed and visibly breaks when open.
  const strip = mouldingLoft(
    linspace(z0 + 0.015, z1 - 0.015, 3),
    [
      [13.98, 0.05],
      [13.98, -0.013],
      [13.5, -0.013],
      [13.5, 0.05],
    ],
    'orange',
    { withRecess: false },
  )
  return join([leaf, ...edges, pane, strip], 30)
}

/** The doorsLeft contract: a Group with exactly two children, child 0 at
 *  negative z. `tramSystem` slides them ±0.78 m along local Z. */
export function buildDoors(materials: TramMaterials, makeSlots: () => SlotMesh): Group {
  const doors = new Group()
  doors.name = 'tram-doors-left'
  for (const sign of [-1, 1]) {
    const slots = makeSlots()
    slots.add(doorLeaf(sign * (LEAF_WIDTH / 2 + 0.005)), 'body')
    const leaf = slots.build(materials)
    leaf.name = `door-leaf-${sign < 0 ? 'a' : 'b'}`
    doors.add(leaf)
  }
  return doors
}

/** Everything that frames the doorway and does not move with the leaves. */
export function buildDoorSurround(slots: SlotMesh): void {
  const bayZ = linspace(-1.92, 1.92, 14)
  // Sill trim / lower door track: fills the undercut below the leaves.
  slots.add(
    mouldingLoft(
      bayZ,
      [
        [10.05, 0.03],
        [10.05, -0.052],
        [9.86, -0.058],
        [9.6, -0.012],
        [9.6, 0.04],
      ],
      'alloy',
      { insetShift: (z) => (Math.abs(z) > 1.86 ? (Math.abs(z) - 1.86) * 0.5 : 0) },
    ),
    'alloy',
  )
  // Upper track fascia — the leaves hang from this.
  slots.add(
    mouldingLoft(
      bayZ,
      [
        [17.6, 0.045],
        [17.6, -0.05],
        [18.4, -0.05],
        [18.4, 0.045],
      ],
      'dark',
      { insetShift: (z) => (Math.abs(z) > 1.86 ? (Math.abs(z) - 1.86) * 0.5 : 0) },
    ),
    'dark',
  )
  // Jamb grab rails: inside the opening, clear of the leaves' travel. Both
  // ends are buried in the threshold and the header and capped with a lathed
  // escutcheon, the standard joint (experience-craft §5.2.2).
  for (const sign of [-1, 1]) {
    const z = sign * (DOOR_HALF - 0.025)
    const x = hullPoint(z, 13.0, 0.115)[0]
    const rail = tubeAlong(
      [
        [x, -0.035, z],
        [x, 1.98, z],
      ],
      roundedRect(0.036, 0.05, 0.016, 3),
      { smooth: 40, capStart: true, capEnd: true },
    )
    slots.add(setSlot(rail, 'orangeRail'), 'orangeRail')
    for (const [y, up] of [
      [0.004, 1],
      [1.936, -1],
    ] as const) {
      const flange = revolveY(
        [
          [0.0, 0.0],
          [0.056, 0.0],
          [0.059, up * 0.013],
          [0.034, up * 0.029],
          [0.0, up * 0.031],
        ],
        16,
        { smooth: 44 },
      )
      unifyOrient(flange)
      for (const v of flange.verts) {
        v[0] += x
        v[1] += y
        v[2] += z
      }
      slots.add(setSlot(flange, 'alloy'), 'alloy')
    }
  }
}

// -------------------------------------------------------------- nose / tail

/** Cab mask, windshield, fascia, lamps — built from the tip cross-section so
 *  the glass, the mask and the bodyside all share exact vertices. */
export function buildEnd(slots: SlotMesh, end: -1 | 1): void {
  const zTip = end * HALF_LENGTH
  const pair = sectionAt(zTip)
  const tipOuter = pair.outer.map((p) => taperApply(p, zTip))
  const tipInner = pair.inner.map((p) => taperApply(p, zTip))

  // 1. Mask edge: the wall thickness turned forward at the tip.
  const ribbon = bridge(tipOuter, tipInner, { close: true, smooth: 30 })
  if (end < 0) flipFaces(ribbon)
  slots.add(setSlot(ribbon, 'body'), 'body')

  // 2. Split the opening at the beltline: glass above, moulded fascia below.
  //    Both halves close on the SAME chord samples (one reversed), so the
  //    windshield and the fascia weld instead of merely abutting.
  const chord: Vec3[] = []
  for (let k = 1; k <= 5; k++) {
    const t = k / 6
    const a = tipInner[IDX.BELT_L]
    const b = tipInner[IDX.BELT_R]
    chord.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
  const upper: Vec3[] = []
  for (let j = IDX.BELT_R; j <= IDX.BELT_L; j++) upper.push(tipInner[j])
  upper.push(...chord)
  const lower: Vec3[] = []
  for (let j = IDX.BELT_L; j < IDX.COUNT; j++) lower.push(tipInner[j])
  for (let j = 0; j <= IDX.BELT_R; j++) lower.push(tipInner[j])
  lower.push(...chord.slice().reverse())

  const centroid = (loop: Vec3[]): Vec3 => {
    const c: Vec3 = [0, 0, 0]
    for (const p of loop) {
      c[0] += p[0]
      c[1] += p[1]
      c[2] += p[2]
    }
    return [c[0] / loop.length, c[1] / loop.length, c[2] / loop.length]
  }

  const windshield = fanRings(upper, centroid(upper), 4, [0, 0, end * 0.09], 26)
  if (end < 0) flipFaces(windshield)
  slots.add(setSlot(windshield, 'glass'), 'glass')

  const fascia = fanRings(lower, centroid(lower), 4, [0, 0, end * 0.11], 28)
  if (end < 0) flipFaces(fascia)
  slots.add(setSlot(fascia, 'body'), 'body')

  // 3. Transom bar over the joint between glass and fascia.
  const barA = tipInner[IDX.BELT_R]
  const barB = tipInner[IDX.BELT_L]
  const bar = tubeAlong(
    [
      [barA[0] + end * 0.02, barA[1], barA[2] + end * 0.014],
      [0, barA[1], barA[2] + end * 0.03],
      [barB[0] - end * 0.02, barB[1], barB[2] + end * 0.014],
    ],
    roundedRect(0.052, 0.038, 0.016, 2),
    { smooth: 40, capStart: true, capEnd: true },
  )
  slots.add(setSlot(bar, 'alloy'), 'alloy')

  // 4. Lamp clusters — housing buried in the fascia, lenses proud of it.
  for (const sx of [-1, 1]) {
    const cx = sx * 0.565
    const housing = prism(
      roundedRect(0.53, 0.235, 0.06, 3).map(([x, y]) => [x + cx, y + 0.265] as Vec2),
      'z',
      end > 0 ? 3.78 : -4.1,
      end > 0 ? 4.1 : -3.78,
      24,
    )
    slots.add(setSlot(housing, 'dark'), 'dark')
    const white = prism(
      roundedRect(0.44, 0.1, 0.035, 3).map(([x, y]) => [x + cx, y + 0.31] as Vec2),
      'z',
      end > 0 ? 3.95 : -4.115,
      end > 0 ? 4.115 : -3.95,
      20,
    )
    slots.add(setSlot(white, 'lampHead'), 'lampHead')
    const red = prism(
      roundedRect(0.44, 0.06, 0.024, 3).map(([x, y]) => [x + cx, y + 0.198] as Vec2),
      'z',
      end > 0 ? 3.95 : -4.112,
      end > 0 ? 4.112 : -3.95,
      20,
    )
    slots.add(setSlot(red, 'lampTail'), 'lampTail')
  }

  // 4b. Light-bar strake tying the two clusters into one designed unit.
  const strake = prism(
    roundedRect(0.66, 0.1, 0.035, 3).map(([x, y]) => [x, y + 0.28] as Vec2),
    'z',
    end > 0 ? 3.8 : -4.03,
    end > 0 ? 4.03 : -3.8,
    20,
  )
  slots.add(setSlot(strake, 'dark'), 'dark')

  // 5. Coupler cover / bumper with its hazard face.
  const bumper = prism(
    roundedRect(1.16, 0.15, 0.05, 3).map(([x, y]) => [x, y + 0.035] as Vec2),
    'z',
    end > 0 ? 3.82 : -4.12,
    end > 0 ? 4.12 : -3.82,
    26,
  )
  slots.add(setSlot(bumper, 'dark'), 'dark')
  const hazard = prism(
    roundedRect(1.0, 0.052, 0.02, 2).map(([x, y]) => [x, y + 0.035] as Vec2),
    'z',
    end > 0 ? 4.06 : -4.132,
    end > 0 ? 4.132 : -4.06,
    18,
  )
  slots.add(setSlot(hazard, 'orange'), 'orange')
  // Coupler head itself, so the bumper is covering something real.
  const coupler = prism(
    roundedRect(0.3, 0.2, 0.05, 3),
    'z',
    end > 0 ? 4.0 : -4.24,
    end > 0 ? 4.24 : -4.0,
    22,
  )
  slots.add(setSlot(coupler, 'dark'), 'dark')
}

// ---------------------------------------------------------------- livery

/**
 * Alpha-cut paint on the bodyside, generated FROM the hull so it curves with
 * it and cannot z-fight: 3 mm proud, well over the 0.8 mm floor for an
 * applied part but far below anything that reads as a plaque.
 *
 * Reading direction: standing outside the +X side the viewer's right is −Z,
 * so u runs against z there and with z on −X; v runs with height, and on −X
 * the section index descends with height, hence `flipV`.
 */
function decalPatch(
  z0: number,
  z1: number,
  s0: number,
  s1: number,
  slot: string,
  flipU: boolean,
  flipV: boolean,
): MeshData {
  const zs = linspace(z0, z1, 6)
  const ss = linspace(s0, s1, 3)
  const m = emptyMesh(24)
  const rows: number[][] = []
  for (const z of zs) {
    const row: number[] = []
    for (const s of ss) {
      row.push(m.verts.length)
      m.verts.push(hullPoint(z, s, -0.003))
    }
    rows.push(row)
  }
  const uu = (u: number): number => (flipU ? 1 - u : u)
  const vv = (v: number): number => (flipV ? 1 - v : v)
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < ss.length - 1; j++) {
      const u0 = uu(i / (zs.length - 1))
      const u1 = uu((i + 1) / (zs.length - 1))
      const v0 = vv(j / (ss.length - 1))
      const v1 = vv((j + 1) / (ss.length - 1))
      m.faces.push([rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]])
      m.faceSlot.push(slot)
      m.faceUV.push([
        [u0, v0],
        [u0, v1],
        [u1, v1],
        [u1, v0],
      ])
    }
  }
  return m
}

const MIRROR_S = (s: number): number => IDX.COUNT - s

export function buildLivery(slots: SlotMesh): void {
  // Orange waist band: 86 mm tall, 7 mm proud, faired into the skin at both
  // ends so it terminates instead of stopping.
  const bandZ = linspace(-3.62, 3.62, 30)
  const fade = (z: number): number => {
    const a = Math.abs(z)
    if (a < 3.05) return 0
    return Math.min(0.03, (a - 3.05) * 0.055)
  }
  for (const [a, b] of [
    [13.5, 13.98],
    [MIRROR_S(13.98), MIRROR_S(13.5)],
  ]) {
    slots.add(
      mouldingLoft(
        bandZ,
        [
          [b, 0.02],
          [b, -0.007],
          [a, -0.007],
          [a, 0.02],
        ],
        'orange',
        { insetShift: fade, smooth: 40 },
      ),
      'orange',
    )
  }
  // Wordmark + unit number, alpha-cut paint 3 mm proud of the bodyside.
  slots.add(decalPatch(2.06, 3.14, 11.7, 12.85, 'livery', true, false), 'livery')
  slots.add(decalPatch(2.06, 3.14, MIRROR_S(12.85), MIRROR_S(11.7), 'livery', false, true), 'livery')
  slots.add(decalPatch(-3.2, -2.78, 11.95, 12.8, 'unit', true, false), 'unit')
  slots.add(decalPatch(-3.2, -2.78, MIRROR_S(12.8), MIRROR_S(11.95), 'unit', false, true), 'unit')
}

// -------------------------------------------------------------- roof pod

/** Low HVAC fairing + antenna + beacon. The pod's underside is generated
 *  from the roof section and sunk 20 mm into it, so there is no seam gap and
 *  no shared plane anywhere along a 3.6 m contact line. */
export function buildRoofPod(slots: SlotMesh): void {
  const z0 = -2.5
  const z1 = 1.15
  const topY = 2.562
  const roofIndices = [23, 24, 25, 26, 27, 28, 29]
  const zs = [z0, z0 + 0.14, ...linspace(z0 + 0.7, z1 - 0.7, 3), z1 - 0.14, z1]
  const shrink = (z: number): number => {
    const t = Math.min(1, Math.min(z - z0, z1 - z) / 0.32)
    return 0.86 + 0.14 * Math.max(0, t)
  }
  const rings: Vec3[][] = zs.map((z) => {
    const sec = sectionAt(z).outer
    const k = shrink(z)
    const ring: Vec3[] = []
    for (const j of roofIndices) {
      const p = taperApply([sec[j][0] * k, sec[j][1] - 0.02], z)
      ring.push(p)
    }
    const drop = (1 - k) * 0.16
    ring.push(taperApply([sec[29][0] * k * 0.94, topY - drop], z))
    ring.push(taperApply([sec[23][0] * k * 0.94, topY - drop], z))
    return ring
  })
  const pod = loft(rings, { closeSection: true, capStart: true, capEnd: true, smooth: 34 })
  unifyOrient(pod)
  slots.add(setSlot(pod, 'dark'), 'dark')

  // Intake stacks: a proud alloy plenum with an upward louvre bank, so the
  // grille is real slats above a dark throat rather than a painted rectangle.
  for (const [gz0, gz1] of [
    [-2.26, -1.48],
    [0.18, 0.96],
  ] as const) {
    const throat = prism(
      roundedRect(gz1 - gz0 - 0.06, 1.2, 0.04, 3).map(
        ([z, x]) => [z + (gz0 + gz1) / 2, x] as Vec2,
      ),
      'y',
      topY - 0.09,
      topY + 0.052,
      20,
    )
    slots.add(setSlot(throat, 'dark'), 'dark')
    const rim = prism(
      roundedRect(gz1 - gz0, 1.28, 0.05, 3).map(([z, x]) => [z + (gz0 + gz1) / 2, x] as Vec2),
      'y',
      topY - 0.06,
      topY + 0.03,
      20,
    )
    slots.add(setSlot(rim, 'alloy'), 'alloy')
    const slatCount = Math.max(2, Math.round((gz1 - gz0 - 0.1) / 0.07))
    for (let i = 0; i < slatCount; i++) {
      const zc = gz0 + 0.07 + ((gz1 - gz0 - 0.14) * i) / (slatCount - 1)
      const slat = prism(
        [
          [zc - 0.024, -0.56],
          [zc - 0.024, 0.56],
          [zc + 0.012, 0.56],
          [zc + 0.012, -0.56],
        ] as Vec2[],
        'y',
        topY + 0.04,
        topY + 0.062,
        0,
      )
      slots.add(setSlot(slat, 'alloy'), 'alloy')
    }
  }

  // Antenna mast with a swept blade, and the roof beacon.
  const mast = tubeAlong(
    [
      [0.0, topY - 0.05, 1.02],
      [0.0, topY + 0.34, 0.94],
    ],
    roundedRect(0.036, 0.036, 0.014, 2),
    { smooth: 40, capStart: true, capEnd: true },
  )
  slots.add(setSlot(mast, 'alloy'), 'alloy')
  const blade = prism(
    [
      [0.0, -0.09],
      [0.3, -0.024],
      [0.3, 0.024],
      [0.0, 0.09],
    ] as Vec2[],
    'x',
    -0.011,
    0.011,
    0,
  )
  slots.add(setSlot(translateMesh(blade, [0, topY + 0.02, 0.7]), 'dark'), 'dark')

  const beaconBase = revolveY(
    [
      [0.0, 0.0],
      [0.075, 0.0],
      [0.078, 0.022],
      [0.062, 0.036],
      [0.0, 0.036],
    ],
    18,
  )
  slots.add(setSlot(translateMesh(beaconBase, [0, topY - 0.006, -2.12]), 'dark'), 'dark')
  const beaconLens = revolveY(
    [
      [0.0, 0.0],
      [0.058, 0.004],
      [0.052, 0.05],
      [0.03, 0.072],
      [0.0, 0.078],
    ],
    18,
  )
  slots.add(setSlot(translateMesh(beaconLens, [0, topY + 0.024, -2.12]), 'lampTail'), 'lampTail')

  // Lifting eyes: four, where a real vehicle is craned.
  for (const sx of [-1, 1]) {
    for (const lz of [-2.1, 0.7]) {
      const eye = revolveY(
        [
          [0.0, 0.0],
          [0.055, 0.0],
          [0.058, 0.02],
          [0.038, 0.05],
          [0.03, 0.086],
          [0.0, 0.088],
        ],
        14,
      )
      const seat = taperApply([sx * 1.02, 2.29], lz)
      slots.add(setSlot(translateMesh(eye, [seat[0], seat[1] - 0.012, seat[2]]), 'alloy'), 'alloy')
    }
  }
}

function translateMesh(m: MeshData, d: Vec3): MeshData {
  for (const v of m.verts) {
    v[0] += d[0]
    v[1] += d[1]
    v[2] += d[2]
  }
  return m
}

// ---------------------------------------------------- exterior small parts

export function buildExteriorTrim(slots: SlotMesh): void {
  // Cant-rail rain gutter both sides, ending short of the cones.
  const gutterZ = linspace(-3.3, 3.3, 22)
  for (const s of [19.2, MIRROR_S(19.2)]) {
    slots.add(
      mouldingLoft(
        gutterZ,
        [
          [s - 0.32, 0.03],
          [s - 0.32, -0.016],
          [s + 0.1, -0.022],
          [s + 0.1, 0.03],
        ],
        'alloy',
        {
          insetShift: (z) => Math.max(0, (Math.abs(z) - 2.95) * 0.09),
          smooth: 40,
        },
      ),
      'alloy',
    )
  }
  // Underframe rubbing strip along the skirt — the part that meets platforms.
  const skirtZ = linspace(-3.5, 3.5, 24)
  for (const s of [8.6, MIRROR_S(8.6)]) {
    slots.add(
      mouldingLoft(
        skirtZ,
        [
          [s - 0.3, 0.03],
          [s - 0.3, -0.012],
          [s + 0.3, -0.012],
          [s + 0.3, 0.03],
        ],
        'rubber',
        { insetShift: (z) => Math.max(0, (Math.abs(z) - 3.0) * 0.06), smooth: 36 },
      ),
      'rubber',
    )
  }
}
