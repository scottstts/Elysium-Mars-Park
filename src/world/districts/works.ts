import { Mesh, PlaneGeometry, Vector2, Vector3 } from 'three'
import { guardrail, stairFlight } from '../../archkit/kit'
import {
  MeshData,
  SMOOTH,
  arcPts,
  circle,
  cleanMesh,
  insetPoly,
  loft,
  prism,
  revolve,
  rotateZ,
  roundedRect,
  smoothShade,
  solidify,
  translate,
  tubeAlong,
  writeInto,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import { signageMaterial } from '../../materials/library'
import { buildDockedRobot } from '../../robots/chassis'
import type { PartWriter } from '../../archkit/writer'
import { interiorHeight } from '../interiorHeight'
import { lightFixtures } from '../lightFixtures'
import { WATER_TOWER, WORKS } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * THE WORKS — life support, celebrated at park scale.
 *
 * Everything here is authored **Z-up with the plan on world XZ** (the
 * `archkit/meshdata` convention): a point is `[worldX, worldZ, height]` and
 * `writeInto()` flips it to the Y-up world at emit. Plan coordinates therefore
 * read 1:1 against `parkPlan.ts`.
 *
 * The machine hall has its own local frame, `(a, c, h)`:
 *   a = ALONG the 26 m axis (WORKS.machineHall.rotation), ±13
 *   c = ACROSS the 15 m span, ±7.5 at the cladding line
 *   h = height above FLOOR, the poured slab datum
 * `hallPlan(a, c)` converts; `hallBox()` places a writer box in it (writer
 * boxes rotate so size.x runs ACROSS and size.z runs ALONG — the orientation
 * gotcha recorded in dev_docs/systems/park-assembly.md).
 *
 * Ground contact rule for the whole district: nothing is buried. Poured pads
 * carry a skirt whose bottom ring follows `interiorHeight` + 12 mm, so no
 * solid ever runs into the terrain mesh (the audit's `clash` class) and no
 * face is ever coplanar with it (the `zfight` class). Foundations that must
 * read as sunk get a cast block that stands proud instead.
 *
 * Contracts leaving this file:
 *   `services.opsAnchor` — the ops room's floor centre + the hall yaw.
 *   OpsScreensSystem places its three live dashboards at
 *   `anchor + along*(i-1)*1.3 + across*(-1.52) + 1.86·y`, so the room's
 *   screen wall is the ACROSS-minus wall and its inner face sits at -1.545
 *   (25 mm behind the dashboards). See the note in `buildOpsRoom()`.
 */

// --------------------------------------------------------------- hall frame

const HALL = WORKS.machineHall
const PSI = HALL.rotation
const ALONG: [number, number] = [Math.sin(PSI), Math.cos(PSI)]
const ACROSS: [number, number] = [Math.cos(PSI), -Math.sin(PSI)]

/**
 * Rotation for a lathe made about the authoring +X axis so that its axis ends
 * up along the hall's ALONG / ACROSS directions. `rotateZ(m, t)` sends +X to
 * `(cos t, sin t)` in world (x, z); ALONG is `(sin PSI, cos PSI)` and ACROSS
 * is `(cos PSI, -sin PSI)`, hence the two constants below. Getting this wrong
 * rotates a machine 50 degrees off its own skid.
 */
const AX_ALONG = Math.PI / 2 - PSI
const AX_ACROSS = -PSI

/** Hall-local (along, across) to world plan (x, z). */
function hallPlan(a: number, c: number): [number, number] {
  return [HALL.x + a * ALONG[0] + c * ACROSS[0], HALL.z + a * ALONG[1] + c * ACROSS[1]]
}

/** Hall-local to an authoring vertex (worldX, worldZ, height-above-FLOOR+base). */
function hp(a: number, c: number, h: number): Vec3 {
  const [x, z] = hallPlan(a, c)
  return [x, z, FLOOR + h]
}

/** Hall-local to a world Vector3 (for writer boxes, colliders, placements). */
function hv(a: number, c: number, h: number): Vector3 {
  const [x, z] = hallPlan(a, c)
  return new Vector3(x, FLOOR + h, z)
}

// -------------------------------------------------------------- hall design
// Every dimension is metric and named; nothing downstream re-derives one.

/** Cladding line: the hall reads 26.0 x 15.0 on plan. */
const HALF_A = 13.0
const HALF_C = 7.5
/**
 * Portal-frame column centreline and its OUTER fibre. Frames are drawn on the
 * outer fibre (that is where the roof line and the girt line actually live);
 * `portalFrame` shifts each section inward by its own half depth.
 */
const COLUMN_C = 7.13
const COLUMN_OUTER = 7.34
/** Girt line: centred in the 144 mm between the column flange and the sheet. */
const GIRT_C = 7.412
/** Clerestory frame / glass / interior-glow planes (see buildMachineHall). */
const FRAME_C = 7.43
const GLASS_C = 7.435
const GLOW_C = 7.375
/** Six bays; the end frames stand 150 mm inboard of the gable sheeting. */
const FRAME_A = [-12.85, -8.5667, -4.2833, 0, 4.2833, 8.5667, 12.85]
/** Eaves (rafter top flange at the column) and apex, above FLOOR. */
const EAVE_H = 8.2
const APEX_H = 10.68
const ROOF_SLOPE = (APEX_H - EAVE_H) / COLUMN_OUTER
/** Roof line: the rafters' top-flange plane. */
const roofLine = (c: number): number => APEX_H - ROOF_SLOPE * Math.abs(c)
const PURLIN_D = 0.15
const DECK_T = 0.028
const SEAM_H = 0.055
/** Cladding bands: sheeting, clerestory, sheeting. */
const CLEAR_SILL = 6.0
const CLEAR_HEAD = 7.3
const WALL_TOP = 8.0

/**
 * Sheeting rib phase. The first crest of a run sits `CREST_T` along it and
 * they repeat every `CREST_PITCH`; anything bolted THROUGH the sheet has to
 * land on one, so the fastener rows and the sign subframe's fixing rails both
 * read their positions from here rather than each guessing.
 */
const CREST_T = 0.34 * 0.55 + 0.34 * 0.11 + (0.34 * 0.23) / 2
const CREST_PITCH = 0.68
/** Lays a lathed part (screw domes) flat against the park-facing wall. */
const WALL_YAW = Math.atan2(-ACROSS[1], -ACROSS[0])
/** Openings on the park-facing (ACROSS-minus) wall. */
const ROLL_DOOR = { a0: 0.34, a1: 3.94, head: 4.72 }
const PERSON_DOOR = { a0: -2.69, a1: -1.59, head: 2.33 }
/**
 * Girt heights on the ACROSS walls. Shared, because a wall flashing has to be
 * fixed to a girt: the plaza elevation's string course lands on `GIRT_H[2]`.
 */
const GIRT_H = [1.5, 3.2, 4.9, 7.75]
/** Wall-mounted HVAC sets on the park-facing wall (see buildHallServices). */
const HVAC_A = [-9.6, 5.2]
/** The gallery pierces the ALONG-minus gable here. */
const GALLERY_GAP = { c0: -1.35, c1: 1.35, sill: 4.02, head: 6.55 }
/** Gallery deck top, above FLOOR. Skids below clear it by design. */
const DECK_H = 4.3
const WALK_HALF = 0.95
/** Ops room, hung on the ALONG-plus end of the walk. */
const OPS_A = 9.7
const OPS_HALF_A = 2.8
/** Inner face of the screen wall: the dashboards land 25 mm proud of it. */
const OPS_INNER_C = 1.545
const OPS_WALL_T = 0.12
const OPS_H = 2.86

/** Poured slab datum — above the highest ground under the footprint. */
const FLOOR = (() => {
  let max = -Infinity
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 8; j++) {
      const [x, z] = hallPlan(-HALF_A + (i / 12) * 2 * HALF_A, -HALF_C + (j / 8) * 2 * HALF_C)
      max = Math.max(max, interiorHeight(x, z))
    }
  }
  return max + 0.14
})()

// ------------------------------------------------------------ small helpers

/** The regolith under a world point — every foot outside a pad reads this. */
function groundY(p: Vector3): number {
  return interiorHeight(p.x, p.z)
}

/** Highest ground under a plan outline — every pad datum comes from this. */
function outlineTop(outline: Vec2[], margin: number): number {
  let max = -Infinity
  for (const [x, z] of outline) max = Math.max(max, interiorHeight(x, z))
  return max + margin
}

/** Circle of plan points (world x, z) — pad outlines, cradle rings, arcs. */
function planCircle(cx: number, cz: number, r: number, segments: number): Vec2[] {
  return Array.from({ length: segments }, (_, i) => {
    const t = (i / segments) * Math.PI * 2
    return [cx + Math.cos(t) * r, cz + Math.sin(t) * r] as Vec2
  })
}

/** Rectangle of plan points, densified so a skirt can track the ground. */
function planRect(
  cx: number,
  cz: number,
  yaw: number,
  halfA: number,
  halfB: number,
  step = 1.2,
): Vec2[] {
  const A: [number, number] = [Math.sin(yaw), Math.cos(yaw)]
  const B: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]
  const at = (a: number, b: number): Vec2 => [cx + a * A[0] + b * B[0], cz + a * A[1] + b * B[1]]
  const na = Math.max(1, Math.round((2 * halfA) / step))
  const nb = Math.max(1, Math.round((2 * halfB) / step))
  const out: Vec2[] = []
  for (let i = 0; i < na; i++) out.push(at(-halfA + (i / na) * 2 * halfA, -halfB))
  for (let i = 0; i < nb; i++) out.push(at(halfA, -halfB + (i / nb) * 2 * halfB))
  for (let i = 0; i < na; i++) out.push(at(halfA - (i / na) * 2 * halfA, halfB))
  for (let i = 0; i < nb; i++) out.push(at(-halfA, halfB - (i / nb) * 2 * halfB))
  // The (a, b) frame is orientation-reversing against world (x, z), so the
  // walk above comes out clockwise. Everything downstream (`insetPoly`, the
  // pad's fan) needs CCW, which is what `planCircle` already produces.
  out.reverse()
  return out
}

/**
 * A poured pad: flat top at `topY`, a chamfered arris, and a skirt whose
 * bottom ring rides 12 mm over the regolith. Nothing is buried, nothing is
 * coplanar with the ground mesh, and the pour reads as a real upstand where
 * the site falls away.
 */
function pouredPad(
  writer: PartWriter,
  outline: Vec2[],
  topY: number,
  slot: string,
  edgeSlot: string,
  chamfer = 0.035,
): void {
  const inner = insetPoly(outline, chamfer)
  let cx = 0
  let cz = 0
  for (const [x, z] of inner) {
    cx += x
    cz += z
  }
  cx /= inner.length
  cz /= inner.length
  const centre = new Vector3(cx, topY, cz)
  const n = outline.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ai = new Vector3(inner[i][0], topY, inner[i][1])
    const aj = new Vector3(inner[j][0], topY, inner[j][1])
    writer.tri(slot, centre, aj, ai)
    const oi = new Vector3(outline[i][0], topY - chamfer, outline[i][1])
    const oj = new Vector3(outline[j][0], topY - chamfer, outline[j][1])
    writer.quad(edgeSlot, ai, aj, oj, oi)
    const gi = new Vector3(oi.x, interiorHeight(oi.x, oi.z) + 0.012, oi.z)
    const gj = new Vector3(oj.x, interiorHeight(oj.x, oj.z) + 0.012, oj.z)
    writer.quad(edgeSlot, oi, oj, gj, gi)
  }
}

/** Trapezoidal profile-sheet line: `(t along the run, n out of the plane)`. */
function ribLine(length: number, pitch: number, rib: number): Vec2[] {
  const valley = pitch * 0.55
  const web = pitch * 0.11
  const crest = pitch * 0.23
  const pts: Vec2[] = []
  const push = (t: number, n: number): void => {
    const tc = Math.min(t, length)
    const last = pts[pts.length - 1]
    if (last && Math.abs(last[0] - tc) < 1e-6 && Math.abs(last[1] - n) < 1e-6) return
    pts.push([tc, n])
  }
  for (let t = 0; t < length - 1e-6; t += pitch) {
    push(t, 0)
    push(t + valley, 0)
    push(t + valley + web, rib)
    push(t + valley + web + crest, rib)
  }
  push(length, 0)
  return pts
}

interface SheetOpts {
  pitch?: number
  rib?: number
  thickness?: number
  smooth?: number
}

/**
 * One run of trapezoidal profile sheeting between two plan points. The ribs
 * are real geometry (a lofted ribbon solidified to 16 mm), so openings are
 * made by SPLITTING the run — never by a boolean and never by a decal.
 */
function sheetRun(
  from: Vec2,
  to: Vec2,
  outward: Vec2,
  bottom: (u: number) => number,
  top: (u: number) => number,
  opts: SheetOpts = {},
): MeshData {
  const pitch = opts.pitch ?? 0.34
  const rib = opts.rib ?? 0.042
  const thickness = opts.thickness ?? 0.016
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const dir: Vec2 = [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
  const line = ribLine(length, pitch, rib)
  const ring = (z: (u: number) => number): Vec3[] =>
    line.map(
      ([t, n]) =>
        [from[0] + dir[0] * t + outward[0] * n, from[1] + dir[1] * t + outward[1] * n, z(t / length)] as Vec3,
    )
  const md = loft([ring(bottom), ring(top)])
  solidify(md, thickness)
  return smoothShade(md, opts.smooth ?? SMOOTH.moulded)
}

/**
 * Fastener dome, lathed about +X so `rotateZ` can aim its axis along any plan
 * normal. Both profile ends sit on the axis, so the poles weld to one vertex
 * and the head is a closed lens that only TOUCHES its host plane — never
 * coplanar with it and never sunk into it.
 */
function fastener(): MeshData {
  return revolve(
    [
      [0, 0],
      [0.0095, 0.002],
      [0.0082, 0.0058],
      [0, 0.0066],
    ],
    8,
    { axis: 'x', smooth: SMOOTH.tight },
  )
}

/** Welded I-section: `(flange offset, depth offset)` for a given web depth. */
function iSection(depth: number, flange: number, ft: number, wt: number): Vec2[] {
  const d = depth / 2
  const f = flange / 2
  const w = wt / 2
  return [
    [-f, -d],
    [f, -d],
    [f, -d + ft],
    [w, -d + ft],
    [w, d - ft],
    [f, d - ft],
    [f, d],
    [-f, d],
    [-f, d - ft],
    [-w, d - ft],
    [-w, -d + ft],
    [-f, -d + ft],
  ]
}

interface FrameStation {
  /** OUTER-fibre position: the roof line and the girt line are drawn here. */
  c: number
  h: number
  depth: number
}

/**
 * One tapered portal frame, drawn as a single continuous member from base to
 * base with mitred knees and a mitred apex. Column and rafter share one loft,
 * so the knee is a tangency instead of two members pushed into each other.
 * Stations name the OUTER fibre; each section is shifted inward by its own
 * half depth, so purlins land exactly on the rafter top flange and the girts
 * clear the column flange by a known reveal.
 */
function portalFrame(a: number, stations: FrameStation[], flange = 0.19): MeshData {
  const segNormal = (A: FrameStation, B: FrameStation): Vec2 => {
    const dc = B.c - A.c
    const dh = B.h - A.h
    const l = Math.hypot(dc, dh) || 1
    return [dh / l, -dc / l]
  }
  const normals: Vec2[] = []
  for (let i = 0; i < stations.length; i++) {
    if (i === 0) normals.push(segNormal(stations[0], stations[1]))
    else if (i === stations.length - 1) normals.push(segNormal(stations[i - 1], stations[i]))
    else {
      const n0 = segNormal(stations[i - 1], stations[i])
      const n1 = segNormal(stations[i], stations[i + 1])
      const mx = n0[0] + n1[0]
      const my = n0[1] + n1[1]
      const ml = Math.hypot(mx, my) || 1
      const m: Vec2 = [mx / ml, my / ml]
      const scale = 1 / Math.max(0.5, m[0] * n0[0] + m[1] * n0[1])
      normals.push([m[0] * scale, m[1] * scale])
    }
  }
  const rings = stations.map((s, i) => {
    const n = normals[i]
    const cc = s.c - (n[0] * s.depth) / 2
    const hh = s.h - (n[1] * s.depth) / 2
    return iSection(s.depth, flange, 0.016, 0.011).map(([fa, fb]) => {
      const [x, z] = hallPlan(a + fa, cc + n[0] * fb)
      return [x, z, FLOOR + hh + n[1] * fb] as Vec3
    })
  })
  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  return smoothShade(md, SMOOTH.cast)
}

/**
 * Section swept along a horizontal world path (girts, purlins, trims, rails).
 * `closed` drops the end caps: a ring path repeats its first point, so capping
 * it would leave two coincident discs sitting inside each other — the exact
 * `zfight` class this build is not allowed to ship.
 */
function section(
  writer: PartWriter,
  slot: string,
  path: Vector3[],
  profile: Vector2[],
  closed = false,
  smoothAngle = SMOOTH.moulded,
): void {
  writer.tube({
    path,
    radius: 0.05,
    slot,
    profile,
    smoothAngle,
    capStart: !closed,
    capEnd: !closed,
  })
}

/**
 * A CLOSED ring member (cradle girders, tank walkways, tower ring braces).
 * `section()` cannot do this: a ring path that repeats its first point leaves
 * two rings at the same place with different frames, and the seam overlaps.
 * `tubeAlong({closePath:true})` wraps the loft instead, so the member is one
 * continuous casting with no seam and no caps. Pass the loop WITHOUT closing it.
 */
function ringSection(
  writer: PartWriter,
  slot: string,
  loop: Vector3[],
  profile: Vector2[],
  smoothAngle = SMOOTH.moulded,
): void {
  const md = tubeAlong(
    loop.map((p) => [p.x, p.y, p.z] as Vec3),
    profile.map((p) => [p.x, p.y] as Vec2),
    { up: [0, 1, 0], closePath: true, cap: false },
  )
  md.frame = 'y-up'
  md.shading = { mode: 'smooth', angle: smoothAngle }
  writeInto(writer, slot, cleanMesh(md))
}

/** C-section (girt / purlin / stringer), lips turned toward `-b`. */
function cSection(depth: number, width: number, t = 0.01): Vector2[] {
  const d = depth / 2
  const w = width / 2
  return [
    new Vector2(-d, -w),
    new Vector2(-d, w),
    new Vector2(-d + t, w),
    new Vector2(-d + t, -w + t),
    new Vector2(d - t, -w + t),
    new Vector2(d - t, w),
    new Vector2(d, w),
    new Vector2(d, -w),
  ]
}

/** Flat bar / plate section. */
function barSection(across: number, up: number): Vector2[] {
  return roundedRect(across, up, Math.min(across, up) * 0.22, 2).map(([x, y]) => new Vector2(x, y))
}

/** A pair of raised collars: the read of a bolted pipe flange. */
function flangePair(writer: PartWriter, at: Vector3, dir: Vector3, radius: number, slot: string): void {
  const d = dir.clone().normalize()
  for (const s of [-1, 1]) {
    const c = at.clone().addScaledVector(d, s * 0.028)
    writer.tube({
      path: [c.clone().addScaledVector(d, -0.014), c.clone().addScaledVector(d, 0.014)],
      radius: radius * 1.4 + 0.014,
      slot,
      radialSegments: 14,
      capStart: true,
      capEnd: true,
    })
  }
}

/** Ladder with optional safety cage — stacks, tanks, the water tower. */
function ladder(
  writer: PartWriter,
  base: Vector3,
  top: number,
  outward: Vector3,
  caged: boolean,
  cageFrom = 2.4,
): void {
  const out = outward.clone().setY(0).normalize()
  const side = new Vector3(-out.z, 0, out.x)
  for (const s of [-1, 1]) {
    const foot = base.clone().addScaledVector(side, s * 0.23)
    writer.tube({
      path: [foot.clone(), foot.clone().setY(top)],
      radius: 0.024,
      slot: 'steel',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
  const rungs = Math.max(2, Math.round((top - base.y) / 0.28))
  for (let i = 1; i < rungs; i++) {
    const y = base.y + ((top - base.y) * i) / rungs
    writer.tube({
      path: [
        base.clone().addScaledVector(side, -0.21).setY(y),
        base.clone().addScaledVector(side, 0.21).setY(y),
      ],
      radius: 0.014,
      slot: 'steelEdge',
      radialSegments: 6,
      capStart: true,
      capEnd: true,
    })
  }
  if (!caged) return
  const hoops = Math.max(1, Math.round((top - base.y - cageFrom) / 0.9))
  for (let i = 0; i <= hoops; i++) {
    const y = base.y + cageFrom + ((top - base.y - cageFrom) * i) / hoops
    const centre = base.clone().addScaledVector(out, 0.3).setY(y)
    const path = arcPts(0, 0, 0.42, -1.9, 1.9, 14).map(
      ([u, v]) => centre.clone().addScaledVector(side, u).addScaledVector(out, v),
    )
    writer.tube({ path, radius: 0.016, slot: 'steel', radialSegments: 6, capStart: true, capEnd: true })
  }
  for (const t of [-1.75, -0.9, 0, 0.9, 1.75]) {
    const u = Math.sin(t) * 0.42
    const v = Math.cos(t) * 0.42
    const from = base.clone().addScaledVector(side, u).addScaledVector(out, 0.3 + v).setY(base.y + cageFrom)
    writer.tube({
      path: [from, from.clone().setY(top)],
      radius: 0.012,
      slot: 'steel',
      radialSegments: 5,
      capStart: true,
      capEnd: true,
    })
  }
}

/** Small cool bulkhead lamp: dark hood, recessed lens, wall bracket. */
function bulkheadLamp(writer: PartWriter, at: Vector3, facing: Vector3): void {
  const f = facing.clone().setY(0).normalize()
  const yaw = Math.atan2(f.x, f.z)
  writer.box({
    center: at.clone().addScaledVector(f, 0.055),
    size: new Vector3(0.26, 0.2, 0.11),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.018,
  })
  writer.box({
    center: at.clone().addScaledVector(f, 0.121),
    size: new Vector3(0.18, 0.12, 0.016),
    rotationY: yaw,
    slot: 'utilityLight',
  })
  writer.box({
    center: at.clone().addScaledVector(f, -0.01),
    size: new Vector3(0.1, 0.1, 0.04),
    rotationY: yaw,
    slot: 'steelEdge',
    chamfer: 0.008,
  })
}

/**
 * Stencilled plate on standoffs — never a decal laid onto a host face.
 *
 * `signageMaterial` rasterises onto a canvas that is always `width x 0.28
 * width` and letter-spaces every line, so two rules apply to every caller:
 * the plate's own aspect must be 1 : 0.28 or the type stretches, and a line
 * must stay inside roughly 6 / 10 / 14 characters at 1 / 2 / 3 lines or it
 * runs off the plate. `signHeight()` enforces the first; the call sites keep
 * the second by splitting long names across lines.
 */
function signHeight(width: number): number {
  return width * 0.28
}

/**
 * Stencil plate helper.
 *
 * The assembly's geometry along the facing axis `f`, measured from `at`:
 * corner bosses span −0.035 … +0.035, the backing plate +0.010 … +0.060, and
 * the printed face sits at +0.063. So the REARMOST part of a sign is its
 * bosses at `at − 0.035·f` — that is the surface which has to meet its host.
 *
 * `legsToY`: plant two posts down to that world Y — REQUIRED for any plate
 * that isn't carried by a wall or a bracket (a floating sign was an
 * owner-reported defect at the maintenance yard).
 * `standoff`: distance from `at` BACK to the host face. Emits four studs
 * bridging the bosses to the host, so a plate held off profiled sheeting or
 * off a tank reads as fixed rather than hovering. Below 45 mm the bosses
 * already reach and no stud is drawn.
 */
function stencilSign(
  services: DistrictServices,
  opts: {
    at: Vector3
    facing: Vector3
    width: number
    height: number
    lines: string[]
    accent?: string
    background?: string
    ink?: string
    widthPx?: number
    legsToY?: number
    legSpread?: number
    standoff?: number
  },
): void {
  const f = opts.facing.clone().setY(0).normalize()
  const yaw = Math.atan2(f.x, f.z)
  const side = new Vector3(f.z, 0, -f.x)
  if (opts.standoff !== undefined && opts.standoff > 0.045) {
    // Stud from just inside the boss to 10 mm INTO the host: a butt on the
    // host plane would be a coplanar pair, and stopping short is the gap.
    const length = opts.standoff - 0.02
    for (const s of [-1, 1]) {
      for (const v of [-1, 1]) {
        services.writer.box({
          center: opts.at
            .clone()
            .addScaledVector(side, s * (opts.width * 0.5 - 0.12))
            .add(new Vector3(0, v * (opts.height * 0.5 - 0.1), 0))
            .addScaledVector(f, -(opts.standoff + 0.04) / 2),
          size: new Vector3(0.05, 0.05, length),
          rotationY: yaw,
          slot: 'steel',
          chamfer: 0.008,
        })
      }
    }
  }
  if (opts.legsToY !== undefined) {
    for (const s of [-1, 1]) {
      const postX = s * (opts.legSpread ?? opts.width / 2 - 0.17)
      const top = opts.at.y + opts.height / 2 - 0.08
      const bottom = opts.legsToY - 0.004
      const center = opts.at
        .clone()
        .addScaledVector(side, postX)
        .addScaledVector(f, -0.021)
      center.y = (top + bottom) / 2
      services.writer.box({
        center,
        size: new Vector3(0.075, top - bottom, 0.07),
        rotationY: yaw,
        slot: 'steel',
        chamfer: 0.008,
      })
      const foot = opts.at.clone().addScaledVector(side, postX).addScaledVector(f, -0.021)
      foot.y = opts.legsToY + 0.007
      services.writer.box({
        center: foot,
        size: new Vector3(0.17, 0.014, 0.16),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.004,
      })
    }
  }
  services.writer.box({
    center: opts.at.clone().addScaledVector(f, 0.035),
    size: new Vector3(opts.width + 0.08, opts.height + 0.08, 0.05),
    rotationY: yaw,
    slot: 'steelEdge',
    chamfer: 0.012,
  })
  for (const s of [-1, 1]) {
    for (const v of [-1, 1]) {
      services.writer.box({
        center: opts.at
          .clone()
          .addScaledVector(side, s * (opts.width * 0.5 - 0.12))
          .add(new Vector3(0, v * (opts.height * 0.5 - 0.1), 0)),
        size: new Vector3(0.07, 0.07, 0.07),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.01,
      })
    }
  }
  const face = new Mesh(
    new PlaneGeometry(opts.width, opts.height),
    signageMaterial(opts.lines, {
      background: opts.background ?? '#231f1c',
      accent: opts.accent ?? '#c94f1d',
      ink: opts.ink,
      widthPx: opts.widthPx,
    }),
  )
  face.position.copy(opts.at.clone().addScaledVector(f, 0.063))
  face.rotation.y = yaw
  face.name = 'works:sign'
  services.group.add(face)
}

// ============================================================ MACHINE HALL

export function buildMachineHall(services: DistrictServices): void {
  const { writer } = services

  // ---- Poured slab: the whole footprint plus a 120 mm upstand all round.
  pouredPad(
    writer,
    planRect(HALL.x, HALL.z, PSI, HALF_A + 0.12, HALF_C + 0.12, 1.1),
    FLOOR,
    'cast',
    'cast',
    0.045,
  )

  // ---- Portal frames. Column depth is constant, the rafter tapers away from
  // a deep haunch at the knee: the load path is legible from the gallery.
  const midC = COLUMN_OUTER * 0.55
  const stations = (): FrameStation[] => [
    { c: COLUMN_OUTER, h: 0.06, depth: 0.42 },
    { c: COLUMN_OUTER, h: 5.2, depth: 0.42 },
    { c: COLUMN_OUTER, h: EAVE_H, depth: 0.66 },
    { c: midC, h: roofLine(midC), depth: 0.5 },
    { c: 0, h: APEX_H, depth: 0.38 },
    { c: -midC, h: roofLine(midC), depth: 0.5 },
    { c: -COLUMN_OUTER, h: EAVE_H, depth: 0.66 },
    { c: -COLUMN_OUTER, h: 5.2, depth: 0.42 },
    { c: -COLUMN_OUTER, h: 0.06, depth: 0.42 },
  ]
  for (const a of FRAME_A) {
    writeInto(writer, 'steel', cleanMesh(portalFrame(a, stations())), { uvScale: 0.5 })
    // Base plates + holding-down bolts, standing proud of the slab.
    for (const s of [-1, 1]) {
      writer.box({
        center: hv(a, s * COLUMN_C, 0.03),
        size: new Vector3(0.56, 0.06, 0.34),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.01,
      })
      for (const bx of [-0.22, 0.22]) {
        for (const bz of [-0.12, 0.12]) {
          const bolt = revolve(
            [
              [0, 0],
              [0.019, 0.004],
              [0.017, 0.03],
              [0, 0.034],
            ],
            8,
            { smooth: SMOOTH.tight },
          )
          const p = hp(a + bz, s * COLUMN_C + bx, 0.06)
          translate(bolt, p)
          writeInto(writer, 'steelEdge', cleanMesh(bolt))
        }
      }
    }
  }

  // ---- Girts (walls) and purlins (roof). Sections, not boxes.
  for (const s of [-1, 1]) {
    // Girts sit in the 144 mm reveal between the column flange and the sheet,
    // and they STOP at every opening — a rail running across an open doorway
    // is the giveaway that a shed was drawn rather than framed.
    for (const h of GIRT_H) {
      const gaps: Array<[number, number]> = []
      if (s < 0) {
        if (h < ROLL_DOOR.head) gaps.push([ROLL_DOOR.a0 - 0.11, ROLL_DOOR.a1 + 0.11])
        if (h < PERSON_DOOR.head) gaps.push([PERSON_DOOR.a0 - 0.08, PERSON_DOOR.a1 + 0.08])
      }
      gaps.sort((p, q) => p[0] - q[0])
      let cursor = -12.85
      for (const [g0, g1] of [...gaps, [12.85, 12.85] as [number, number]]) {
        if (g0 - cursor > 0.3) {
          section(
            writer,
            'steel',
            [hv(cursor, s * GIRT_C, h), hv(g0, s * GIRT_C, h)],
            cSection(0.12, 0.065),
          )
        }
        cursor = g1
      }
    }
    // Purlins fill the 150 mm between the rafter top flange and the deck.
    for (const c of [7.0, 5.3, 3.6, 1.9, 0.4]) {
      const cc = s * c
      section(
        writer,
        'steel',
        [
          hv(-12.85, cc, roofLine(cc) + PURLIN_D * 0.5),
          hv(12.85, cc, roofLine(cc) + PURLIN_D * 0.5),
        ],
        cSection(0.07, PURLIN_D),
      )
    }
  }

  // ---- Wall sheeting. The runs are SPLIT around every opening; each run is
  // one welded solid whose cut edges are covered by real jamb trims.
  const sheetBand = (
    c: number,
    a0: number,
    a1: number,
    h0: number,
    h1: number,
    slot = 'steel',
  ): void => {
    const outward: Vec2 = c > 0 ? ACROSS : [-ACROSS[0], -ACROSS[1]]
    const face = c > 0 ? HALF_C - 0.008 : -(HALF_C - 0.008)
    writeInto(
      writer,
      slot,
      cleanMesh(
        sheetRun(
          hallPlan(a0, face),
          hallPlan(a1, face),
          outward,
          () => FLOOR + h0,
          () => FLOOR + h1,
        ),
      ),
      { uvScale: 0.6 },
    )
  }

  // The park-facing wall carries both doors, so its lower band is four runs.
  const parkRuns: Array<[number, number, number, number]> = [
    [-HALF_A, PERSON_DOOR.a0, 0.02, CLEAR_SILL],
    [PERSON_DOOR.a0, PERSON_DOOR.a1, PERSON_DOOR.head, CLEAR_SILL],
    [PERSON_DOOR.a1, ROLL_DOOR.a0, 0.02, CLEAR_SILL],
    [ROLL_DOOR.a0, ROLL_DOOR.a1, ROLL_DOOR.head + 0.29, CLEAR_SILL],
    [ROLL_DOOR.a1, HALF_A, 0.02, CLEAR_SILL],
    [-HALF_A, HALF_A, CLEAR_HEAD, WALL_TOP],
  ]
  for (const [a0, a1, h0, h1] of parkRuns) sheetBand(-1, a0, a1, h0, h1)
  // Tank-farm side: unbroken, so the pipe rack has a clean wall to land on.
  sheetBand(1, -HALF_A, HALF_A, 0.02, CLEAR_SILL)
  sheetBand(1, -HALF_A, HALF_A, CLEAR_HEAD, WALL_TOP)

  // Fastener rows, driven off each RUN's own rib phase so every head lands on
  // a crest. The dome is lathed about +X and rolled into the wall plane, so
  // its axis is the sheeting normal — a screw head, not a bump on a surface.
  for (const [a0, a1, h0, h1] of parkRuns) {
    const length = a1 - a0
    for (const h of [h0 + 0.5, (h0 + h1) / 2, h1 - 0.45]) {
      if (h - h0 < 0.3 || h1 - h < 0.3) continue
      for (let k = 0; CREST_T + k * CREST_PITCH < length - 0.5; k++) {
        const [x, z] = hallPlan(a0 + CREST_T + k * CREST_PITCH, -(HALF_C + 0.0435))
        const laid = fastener()
        rotateZ(laid, WALL_YAW)
        translate(laid, [x, z, FLOOR + h])
        writeInto(writer, 'steelEdge', cleanMesh(laid))
      }
    }
  }

  // ---- Gable sheeting: vertical runs up to the rake, split at the gallery.
  const gable = (sign: number): void => {
    const outward: Vec2 = sign > 0 ? ALONG : [-ALONG[0], -ALONG[1]]
    const faceA = sign * (HALF_A - 0.008)
    // The purlins stop 140 mm short of the gable, so the gable sheeting runs
    // right up to the roof deck's underside with a 35 mm reveal.
    const rake = (c: number): number => FLOOR + roofLine(c) + PURLIN_D - 0.035
    const run = (c0: number, c1: number, h0: number, h1: number | null): void => {
      writeInto(
        writer,
        'steel',
        cleanMesh(
          sheetRun(
            hallPlan(faceA, c0),
            hallPlan(faceA, c1),
            outward,
            () => FLOOR + h0,
            h1 === null ? (u) => rake(c0 + (c1 - c0) * u) : () => FLOOR + h1,
          ),
        ),
        { uvScale: 0.6 },
      )
    }
    if (sign < 0) {
      run(-7.44, GALLERY_GAP.c0, 0.02, null)
      run(GALLERY_GAP.c0, GALLERY_GAP.c1, 0.02, GALLERY_GAP.sill)
      run(GALLERY_GAP.c0, GALLERY_GAP.c1, GALLERY_GAP.head, null)
      run(GALLERY_GAP.c1, 7.44, 0.02, null)
    } else {
      run(-7.44, 7.44, 0.02, null)
    }
  }
  gable(-1)
  gable(1)

  // ---- Clerestory. Four planes, each with its own reveal, so nothing in the
  // band ever touches anything else:
  //   column outer flange 7.340 | glow 7.353-7.398 | glass 7.420-7.450
  //   | frame 7.385-7.475 | sheeting crest 7.484-7.542
  // Mullions run the full band height and the transoms stop between them —
  // the stick-system rule, and the reason nothing interpenetrates here.
  const bandMid = (CLEAR_SILL + CLEAR_HEAD) / 2
  const bandH = CLEAR_HEAD - CLEAR_SILL
  for (const s of [-1, 1]) {
    const mullionA = Array.from({ length: 13 }, (_, i) => -12.6 + i * 2.1)
    for (const a of mullionA) {
      writer.box({
        center: hv(a, s * FRAME_C, bandMid),
        size: new Vector3(0.09, bandH + 0.22, 0.09),
        rotationY: PSI,
        slot: 'aluminum',
        chamfer: 0.012,
      })
    }
    for (let bay = 0; bay < 12; bay++) {
      const a0 = mullionA[bay]
      const a1 = mullionA[bay + 1]
      writer.box({
        center: hv((a0 + a1) / 2, s * GLASS_C, bandMid),
        size: new Vector3(0.03, bandH - 0.12, a1 - a0 - 0.12),
        rotationY: PSI,
        // Not `darkGlass`: the warm room light behind this band has to come
        // THROUGH it, and darkGlass is an opaque architectural spandrel.
        slot: 'cabinGlass',
      })
      writer.box({
        center: hv((a0 + a1) / 2, s * GLOW_C, bandMid),
        size: new Vector3(0.045, bandH - 0.3, a1 - a0 - 0.3),
        rotationY: PSI,
        slot: 'interiorGlow',
      })
      // Head and sill transoms, one per bay, stopped 8 mm off each mullion.
      for (const h of [CLEAR_SILL - 0.055, CLEAR_HEAD + 0.055]) {
        writer.box({
          center: hv((a0 + a1) / 2, s * FRAME_C, h),
          size: new Vector3(0.09, 0.09, a1 - a0 - 0.106),
          rotationY: PSI,
          slot: 'aluminum',
          chamfer: 0.01,
        })
      }
    }
  }

  // ---- Roof: two standing-seam planes, a real ridge cap, gutters and rakes.
  for (const s of [-1, 1]) {
    const eaveC = s * 7.86
    const ridgeC = s * 0.14
    // Roof-plane normal in the (c, h) section: the standing seams stand off
    // along it, so they stay perpendicular to the sheet at any pitch.
    const dc = ridgeC - eaveC
    const dh = roofLine(Math.abs(ridgeC)) - roofLine(Math.abs(eaveC))
    const l = Math.hypot(dc, dh)
    // Outward normal = the perpendicular whose height component is positive;
    // the other one points the standing seams down into the purlins.
    const nrm: Vec2 = dc < 0 ? [dh / l, -dc / l] : [-dh / l, dc / l]
    const line = ribLine(2 * 13.35, 0.42, SEAM_H)
    const ring = (c: number, h: number): Vec3[] =>
      line.map(([t, n]) => {
        const [x, z] = hallPlan(-13.35 + t, c + nrm[0] * n)
        return [x, z, FLOOR + h + nrm[1] * n] as Vec3
      })
    const md = loft([
      ring(eaveC, roofLine(Math.abs(eaveC)) + PURLIN_D + DECK_T * 0.5),
      ring(ridgeC, roofLine(Math.abs(ridgeC)) + PURLIN_D + DECK_T * 0.5),
    ])
    solidify(md, DECK_T)
    writeInto(writer, 'aluminum', cleanMesh(smoothShade(md, SMOOTH.moulded)), { uvScale: 0.4 })

    // Eaves gutter, hung clear below the deck edge on cast brackets.
    const gutterH = roofLine(7.86) + PURLIN_D - 0.174
    section(
      writer,
      'steel',
      [hv(-13.4, s * 7.9, gutterH), hv(13.4, s * 7.9, gutterH)],
      [
        new Vector2(-0.11, 0.11),
        new Vector2(-0.11, -0.05),
        new Vector2(-0.07, -0.1),
        new Vector2(0.07, -0.1),
        new Vector2(0.11, -0.05),
        new Vector2(0.11, 0.11),
        new Vector2(0.09, 0.11),
        new Vector2(0.09, -0.04),
        new Vector2(-0.09, -0.04),
        new Vector2(-0.09, 0.11),
      ],
    )
    // Eaves fascia closes the gap between the wall top and the roof edge.
    section(
      writer,
      'steel',
      [hv(-13.3, s * (HALF_C + 0.1), WALL_TOP + 0.11), hv(13.3, s * (HALF_C + 0.1), WALL_TOP + 0.11)],
      barSection(0.05, 0.34),
    )
    for (const a of [-11.2, -3.7, 3.7, 11.2]) {
      writer.box({
        center: hv(a, s * 7.74, gutterH - 0.02),
        size: new Vector3(0.34, 0.05, 0.05),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.008,
      })
    }
    // Rake flashing, wrapped OVER the roof edge clear of the standing seams.
    for (const g of [-1, 1]) {
      section(
        writer,
        'steel',
        [
          hv(g * 13.44, s * 7.86, roofLine(7.86) + PURLIN_D + DECK_T / 2),
          hv(g * 13.44, s * 0.45, roofLine(0.45) + PURLIN_D + DECK_T / 2),
        ],
        barSection(0.14, 0.26),
      )
    }
  }
  // Ridge cap: a folded flashing bridging the 280 mm between the two planes.
  {
    const capProfile = [
      new Vector2(-0.34, -0.11),
      new Vector2(-0.3, 0.005),
      new Vector2(0, 0.05),
      new Vector2(0.3, 0.005),
      new Vector2(0.34, -0.11),
      new Vector2(0.31, -0.12),
      new Vector2(0, 0.028),
      new Vector2(-0.31, -0.12),
    ]
    section(
      writer,
      'aluminum',
      [
        hv(-13.28, 0, APEX_H + PURLIN_D + DECK_T + 0.07),
        hv(13.28, 0, APEX_H + PURLIN_D + DECK_T + 0.07),
      ],
      capProfile,
    )
  }
  // Corner flashings: real L-angles that lap BOTH sheeting ends with an 8 mm
  // reveal, drawn in the hall frame as a prism so they mitre the corner.
  for (const sa of [-1, 1]) {
    for (const sc of [-1, 1]) {
      const p = (a: number, c: number): Vec2 => hallPlan(sa * a, sc * c)
      const outline: Vec2[] = [
        p(12.8, 7.55),
        p(13.05, 7.55),
        p(13.05, 7.3),
        p(13.11, 7.3),
        p(13.11, 7.61),
        p(12.8, 7.61),
      ]
      const angle = prism(outline, FLOOR + 0.03, FLOOR + WALL_TOP + 0.06)
      writeInto(writer, 'steel', cleanMesh(smoothShade(angle, SMOOTH.moulded)))
    }
  }

  buildPlazaElevation(services)
  buildHallOpenings(services)
  buildHallServices(services)
  buildHallInterior(services)

  // ---- Colliders: four wall runs with the roll-up door left open.
  const wall = (a0: number, a1: number, c: number, thick: number): void => {
    services.colliders.push({
      kind: 'box',
      center: hv((a0 + a1) / 2, c, WALL_TOP / 2),
      size: new Vector3(thick, WALL_TOP, a1 - a0),
      yaw: PSI,
    })
  }
  wall(-HALF_A, ROLL_DOOR.a0, -HALF_C + 0.1, 0.3)
  wall(ROLL_DOOR.a1, HALF_A, -HALF_C + 0.1, 0.3)
  wall(-HALF_A, HALF_A, HALF_C - 0.1, 0.3)
  for (const sa of [-1, 1]) {
    services.colliders.push({
      kind: 'box',
      center: hv(sa * (HALF_A - 0.1), 0, WALL_TOP / 2),
      size: new Vector3(2 * HALF_C, WALL_TOP, 0.3),
      yaw: PSI,
    })
  }
}

/** Framed apertures: roll-up door, personnel door, gallery portal. */
export function buildHallOpenings(services: DistrictServices): void {
  const { writer } = services
  // Mounting plane for anything applied to the park-facing wall: the
  // sheeting crest outer face is at HALF_C + 0.042, so applied parts start
  // beyond HALF_C + 0.2 and nothing ever runs into the cladding.
  const outC = -(HALF_C + 0.2)

  // ---- Roll-up door: jambs, head beam, shutter drum, slats rolled up.
  const dw = ROLL_DOOR.a1 - ROLL_DOOR.a0
  for (const a of [ROLL_DOOR.a0, ROLL_DOOR.a1]) {
    writer.box({
      center: hv(a, outC + 0.02, ROLL_DOOR.head / 2),
      size: new Vector3(0.22, ROLL_DOOR.head, 0.16),
      rotationY: PSI,
      slot: 'orange',
      chamfer: 0.018,
    })
    // Guide channel, inset from the jamb face.
    writer.box({
      center: hv(a + (a < 2 ? 0.075 : -0.075), outC - 0.06, ROLL_DOOR.head / 2),
      size: new Vector3(0.1, ROLL_DOOR.head - 0.1, 0.06),
      rotationY: PSI,
      slot: 'dark',
      chamfer: 0.008,
    })
  }
  writer.box({
    center: hv((ROLL_DOOR.a0 + ROLL_DOOR.a1) / 2, outC + 0.02, ROLL_DOOR.head + 0.14),
    size: new Vector3(0.24, 0.26, dw + 0.44),
    rotationY: PSI,
    slot: 'orange',
    chamfer: 0.02,
  })
  // Shutter drum with the curtain coiled on it — the door reads OPEN.
  writer.tube({
    path: [
      hv(ROLL_DOOR.a0 + 0.06, outC - 0.14, ROLL_DOOR.head + 0.46),
      hv(ROLL_DOOR.a1 - 0.06, outC - 0.14, ROLL_DOOR.head + 0.46),
    ],
    radius: 0.28,
    slot: 'dark',
    radialSegments: 20,
    capStart: true,
    capEnd: true,
  })
  for (const s of [-1, 1]) {
    writer.box({
      center: hv((ROLL_DOOR.a0 + ROLL_DOOR.a1) / 2 + (s * dw) / 2, outC - 0.14, ROLL_DOOR.head + 0.46),
      size: new Vector3(0.12, 0.44, 0.06),
      rotationY: PSI,
      slot: 'steelEdge',
      chamfer: 0.01,
    })
  }
  // Hood over the drum.
  writer.box({
    center: hv((ROLL_DOOR.a0 + ROLL_DOOR.a1) / 2, outC - 0.16, ROLL_DOOR.head + 0.84),
    size: new Vector3(0.6, 0.06, dw + 0.2),
    rotationY: PSI,
    slot: 'steel',
    chamfer: 0.014,
  })
  // Threshold plate, standing 26 mm proud of the pour so it reads as a wear
  // strip rather than a coplanar patch on the slab.
  writer.box({
    center: hv((ROLL_DOOR.a0 + ROLL_DOOR.a1) / 2, -HALF_C - 0.19, 0.03),
    size: new Vector3(0.62, 0.052, dw + 0.3),
    rotationY: PSI,
    slot: 'steelEdge',
    chamfer: 0.014,
  })
  // Guard bollards, standing on the regolith beyond the pour.
  for (const a of [ROLL_DOOR.a0 - 0.5, ROLL_DOOR.a1 + 0.5]) {
    const base = hv(a, -HALF_C - 0.55, 0)
    base.y = groundY(base)
    writer.box({
      center: base.clone().setY(base.y + 0.065),
      size: new Vector3(0.34, 0.11, 0.34),
      rotationY: PSI,
      slot: 'cast',
      chamfer: 0.016,
    })
    writer.tube({
      path: [base.clone().setY(base.y + 0.12), base.clone().setY(base.y + 1.0)],
      radius: 0.09,
      slot: 'orange',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
  }

  // ---- Personnel door: lining, leaf, vision panel, lever, threshold.
  const pw = PERSON_DOOR.a1 - PERSON_DOOR.a0
  const pMid = (PERSON_DOOR.a0 + PERSON_DOOR.a1) / 2
  for (const a of [PERSON_DOOR.a0, PERSON_DOOR.a1]) {
    writer.box({
      center: hv(a, outC + 0.015, PERSON_DOOR.head / 2),
      size: new Vector3(0.15, PERSON_DOOR.head, 0.09),
      rotationY: PSI,
      slot: 'steelEdge',
      chamfer: 0.01,
    })
  }
  writer.box({
    center: hv(pMid, outC + 0.015, PERSON_DOOR.head - 0.045),
    size: new Vector3(0.15, 0.09, pw - 0.1),
    rotationY: PSI,
    slot: 'steelEdge',
    chamfer: 0.01,
  })
  writer.box({
    center: hv(pMid, outC - 0.028, PERSON_DOOR.head / 2 - 0.04),
    size: new Vector3(0.048, PERSON_DOOR.head - 0.11, pw - 0.05),
    rotationY: PSI,
    slot: 'habShell',
    chamfer: 0.01,
  })
  writer.box({
    center: hv(pMid, outC - 0.055, 1.62),
    size: new Vector3(0.02, 0.42, 0.28),
    rotationY: PSI,
    slot: 'darkGlass',
  })
  writer.tube({
    path: [hv(pMid + 0.36, outC - 0.07, 1.06), hv(pMid + 0.36, outC - 0.07, 1.24)],
    radius: 0.017,
    slot: 'steelEdge',
    radialSegments: 8,
    capStart: true,
    capEnd: true,
  })
  writer.box({
    center: hv(pMid, -HALF_C - 0.2, 0.025),
    size: new Vector3(0.4, 0.042, pw + 0.4),
    rotationY: PSI,
    slot: 'steelEdge',
    chamfer: 0.012,
  })
  bulkheadLamp(
    services.writer,
    hv(PERSON_DOOR.a1 + 0.4, -HALF_C - 0.11, 2.42),
    new Vector3(-ACROSS[0], 0, -ACROSS[1]),
  )
  bulkheadLamp(
    services.writer,
    hv(ROLL_DOOR.a1 + 0.45, -HALF_C - 0.11, ROLL_DOOR.head + 0.55),
    new Vector3(-ACROSS[0], 0, -ACROSS[1]),
  )

  // ---- Gallery portal through the ALONG-minus gable.
  const gA = -(HALF_A + 0.17)
  for (const c of [GALLERY_GAP.c0, GALLERY_GAP.c1]) {
    writer.box({
      center: hv(gA, c, (GALLERY_GAP.sill + GALLERY_GAP.head) / 2),
      size: new Vector3(0.13, GALLERY_GAP.head - GALLERY_GAP.sill + 0.26, 0.2),
      rotationY: PSI,
      slot: 'orange',
      chamfer: 0.014,
    })
  }
  for (const h of [GALLERY_GAP.sill - 0.065, GALLERY_GAP.head + 0.065]) {
    writer.box({
      center: hv(gA, 0, h),
      size: new Vector3(GALLERY_GAP.c1 - GALLERY_GAP.c0 - 0.2, 0.13, 0.2),
      rotationY: PSI,
      slot: 'orange',
      chamfer: 0.014,
    })
  }
}

/** External services on the hall: pipe rack, cable tray, HVAC, signage. */
export function buildHallServices(services: DistrictServices): void {
  const { writer } = services

  // ---- Cable tray + conduit drops down the park-facing wall.
  const trayC = -(HALF_C + 0.24)
  section(
    writer,
    'dark',
    [hv(-12.4, trayC, 5.55), hv(12.4, trayC, 5.55)],
    [
      new Vector2(-0.19, -0.09),
      new Vector2(0.19, -0.09),
      new Vector2(0.19, -0.075),
      new Vector2(-0.175, -0.075),
      new Vector2(-0.175, 0.09),
      new Vector2(-0.19, 0.09),
    ],
  )
  for (let i = 0; i <= 12; i++) {
    const a = -12.4 + i * 2.07
    writer.box({
      center: hv(a, -(HALF_C + 0.2), 5.55),
      size: new Vector3(0.2, 0.05, 0.06),
      rotationY: PSI,
      slot: 'steelEdge',
      chamfer: 0.008,
    })
  }
  for (const a of [-8.2, -0.4, 7.8]) {
    writer.tube({
      path: [hv(a, trayC + 0.06, 5.46), hv(a, trayC + 0.06, 2.1), hv(a, -(HALF_C + 0.2), 1.7)],
      radius: 0.045,
      slot: 'dark',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    writer.box({
      center: hv(a, -(HALF_C + 0.2), 1.36),
      size: new Vector3(0.26, 0.42, 0.18),
      rotationY: PSI,
      slot: 'steelEdge',
      chamfer: 0.014,
    })
  }

  // ---- Wall-mounted HVAC sets: casing, louvre bank, fan cowl, drain.
  for (const a of HVAC_A) {
    const base = hv(a, -(HALF_C + 0.53), 2.5)
    writer.box({
      center: base,
      size: new Vector3(0.9, 1.5, 1.9),
      rotationY: PSI,
      slot: 'steel',
      chamfer: 0.03,
    })
    for (let i = 0; i < 7; i++) {
      writer.box({
        center: hv(a, -(HALF_C + 1.01), 1.88 + i * 0.19),
        size: new Vector3(0.05, 0.11, 1.72),
        rotationY: PSI - 0.22,
        slot: 'dark',
        chamfer: 0.008,
      })
    }
    const cowl = revolve(
      [
        [0.34, 0],
        [0.4, 0.02],
        [0.4, 0.14],
        [0.36, 0.16],
        [0.2, 0.16],
        [0.2, 0.05],
      ],
      20,
      { axis: 'y', smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    const [cx, cz] = hallPlan(a, -(HALF_C + 0.53))
    translate(cowl, [cx, cz, FLOOR + 3.28])
    writeInto(writer, 'dark', cleanMesh(cowl))
    writer.tube({
      path: [hv(a + 0.3, -(HALF_C + 0.45), 1.76), hv(a + 0.3, -(HALF_C + 0.24), 0.12)],
      radius: 0.026,
      slot: 'steelEdge',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
    for (const s of [-1, 1]) {
      writer.box({
        center: hv(a + s * 0.82, -(HALF_C + 0.37), 1.62),
        size: new Vector3(0.44, 0.1, 0.1),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.01,
      })
    }
  }

  // ---- Downpipes off the gutters, onto splash blocks on the regolith.
  for (const s of [-1, 1]) {
    for (const a of [-11.6, 11.6]) {
      const splash = hv(a, s * (HALF_C + 0.24), 0)
      splash.y = groundY(splash) + 0.048
      writer.tube({
        path: [
          hv(a, s * (HALF_C + 0.42), roofLine(7.86) + PURLIN_D - 0.28),
          hv(a, s * (HALF_C + 0.24), roofLine(7.86) + PURLIN_D - 0.62),
          new Vector3(splash.x, splash.y + 0.12, splash.z),
        ],
        radius: 0.058,
        slot: 'steel',
        radialSegments: 12,
        capStart: true,
        capEnd: true,
      })
      writer.box({
        center: splash,
        size: new Vector3(0.34, 0.09, 0.34),
        rotationY: PSI,
        slot: 'cast',
        chamfer: 0.014,
      })
    }
  }

  // ---- The stencil that names the plant, on the money facade.
  //
  // This plate spans the clerestory, so there is no ONE wall behind it: the
  // section runs glass 7.420-7.450, mullion 7.385-7.475, sheeting crest
  // 7.484-7.542. Its four corners sit over three different hosts (measured:
  // 89 mm, 131 mm and 181 mm back from `at`), which is why no single standoff
  // stud fits and why it hung on nothing for so long.
  //
  // It is carried instead by two vertical outriggers ON THE MULLION LINES —
  // -8.4 and -4.2 are the only mullions inside the plate's -9.0..-3.8 span,
  // which is also why the frame is not symmetric about the sign's own centre.
  // Each one lands on the sheeting band below the sill AND above the head,
  // ties back to the mullion between them, and crosses the glazed band only
  // where a mullion already blocks the view. Panes are 120 mm narrower than
  // their bay, so a 100 mm outrigger on the mullion clears both neighbouring
  // clear fields by 10 mm and nothing else enters one.
  //
  // Depths: frame back 7.535 laps 7 mm into the crest (never a coplanar butt)
  // and clears the glass by 85 mm and the mullion face by 60 mm; frame front
  // 7.652 laps 12 mm into the sign's own backing plate (7.640-7.690) and
  // stops 41 mm short of the printed face, so no member crosses the type.
  // Mullion face to printed face is 218 mm of standoff.
  const SUB_BACK = 7.535
  const SUB_FRONT = 7.652
  for (const ma of [-8.4, -4.2]) {
    writer.box({
      center: hv(ma, -(SUB_BACK + SUB_FRONT) / 2, (5.42 + 7.56) / 2),
      size: new Vector3(SUB_FRONT - SUB_BACK, 7.56 - 5.42, 0.1),
      rotationY: PSI,
      slot: 'steel',
      chamfer: 0.012,
    })
    // Tie-backs to the mullion, clear of both transoms (5.945 and 7.355).
    // NO plane in this frame is shared with another part: the tie-back runs
    // 7.470 (5 mm into the mullion) to 7.555 (20 mm into the outrigger), and
    // the rail below runs 7.528 to 7.606. Butting the tie-back on the
    // outrigger's own 7.535 back plane cost 219 cm2 of z-fight.
    for (const h of [6.3, 7.0]) {
      writer.box({
        center: hv(ma, -(7.47 + 7.555) / 2, h),
        size: new Vector3(7.555 - 7.47, 0.09, 0.07),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.008,
      })
    }
    // Fixing rails on the solid sheeting above and below the band, with real
    // screw heads on the run's OWN crests. Both bands are runs that start at
    // -HALF_A, so they share one phase; each rail catches exactly two crests.
    for (const h of [5.7, 7.44]) {
      writer.box({
        center: hv(ma, -(7.528 + 7.606) / 2, h),
        size: new Vector3(7.606 - 7.528, 0.09, 0.92),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.008,
      })
      for (let k = 0; ; k++) {
        const ca = -HALF_A + CREST_T + k * CREST_PITCH
        if (ca > ma + 0.46) break
        if (ca < ma - 0.46) continue
        const [fx, fz] = hallPlan(ca, -(HALF_C + 0.0435))
        const laid = fastener()
        rotateZ(laid, WALL_YAW)
        translate(laid, [fx, fz, FLOOR + h])
        writeInto(writer, 'steelEdge', cleanMesh(laid))
      }
    }
  }
  stencilSign(services, {
    at: hv(-6.4, -(HALF_C + 0.13), 6.6),
    facing: new Vector3(-ACROSS[0], 0, -ACROSS[1]),
    width: 5.2,
    height: signHeight(5.2),
    lines: ['ATMOSPHERE', 'PROCESSING', 'HALL 1'],
  })
  stencilSign(services, {
    at: hv(PERSON_DOOR.a0 - 1.05, -(HALF_C + 0.13), 2.05),
    facing: new Vector3(-ACROSS[0], 0, -ACROSS[1]),
    width: 1.5,
    height: signHeight(1.5),
    lines: ['PERSONNEL', 'ENTRY'],
    widthPx: 512,
    // Sheeting valley is 131 mm back from `at` (crest 87 mm): the bosses
    // reach 35 mm, so without studs the plate hovered 96 mm off the wall.
    standoff: 0.131,
  })
  // Backlit hall number where the works lane arrives.
  writer.box({
    center: hv(ROLL_DOOR.a1 + 1.5, -(HALF_C + 0.14), 3.2),
    size: new Vector3(0.14, 1.15, 0.75),
    rotationY: PSI,
    slot: 'dark',
    chamfer: 0.02,
  })
  writer.box({
    center: hv(ROLL_DOOR.a1 + 1.5, -(HALF_C + 0.23), 3.2),
    size: new Vector3(0.03, 0.92, 0.56),
    rotationY: PSI,
    slot: 'signageGlow',
  })

  // ---- Process pipe rack: hall to tank farm, on H-frames.
  buildPipeRack(services)
}

/** The main process rack: the hall's ACROSS-plus wall out to the tank farm. */
export function buildPipeRack(services: DistrictServices): void {
  const { writer } = services
  const start = hv(8.4, HALF_C + 0.05, 5.4)
  const farm = new Vector3(WORKS.tankFarm.x, 0, WORKS.tankFarm.z)
  const mid = new Vector3(
    (start.x + farm.x) / 2 + 1.4,
    0,
    (start.z + farm.z) / 2 - 1.2,
  )
  const nodes: Vector3[] = [
    new Vector3(start.x, start.y, start.z),
    new Vector3(start.x + (mid.x - start.x) * 0.34, start.y, start.z + (mid.z - start.z) * 0.34),
    new Vector3(mid.x, start.y - 0.2, mid.z),
    new Vector3(farm.x - 5.6, start.y - 0.4, farm.z - 4.6),
  ]

  // H-frame supports along the run.
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    const span = a.distanceTo(b)
    const count = Math.max(1, Math.round(span / 5.2))
    // Start at k=1 so the node shared with the previous segment is not
    // emitted twice (two identical H-frames = a guaranteed z-fight pair).
    for (let k = 1; k <= count; k++) {
      const p = a.clone().lerp(b, k / count)
      const dir = b.clone().sub(a).setY(0).normalize()
      const side = new Vector3(-dir.z, 0, dir.x)
      const g = interiorHeight(p.x, p.z)
      for (const s of [-1, 1]) {
        // The column stands ON its pad block, never inside it.
        const foot = p.clone().addScaledVector(side, s * 0.8).setY(g + 0.24)
        section(writer, 'steel', [foot, foot.clone().setY(p.y + 0.34)], cSection(0.19, 0.1))
        writer.box({
          center: foot.clone().setY(g + 0.095),
          size: new Vector3(0.4, 0.17, 0.4),
          rotationY: Math.atan2(dir.x, dir.z),
          slot: 'cast',
          chamfer: 0.018,
        })
      }
      for (const h of [-0.32, 0.34]) {
        section(
          writer,
          'steel',
          [
            p.clone().addScaledVector(side, -0.86).setY(p.y + h),
            p.clone().addScaledVector(side, 0.86).setY(p.y + h),
          ],
          cSection(0.16, 0.09),
        )
      }
    }
  }

  // Four pipes on two tiers, two of them jacketed.
  const offsets: Array<{ side: number; lift: number; r: number; slot: string; jacket: boolean }> = [
    { side: -0.62, lift: 0.46, r: 0.16, slot: 'steel', jacket: true },
    { side: 0.0, lift: 0.46, r: 0.11, slot: 'aluminum', jacket: false },
    { side: 0.6, lift: 0.46, r: 0.13, slot: 'steel', jacket: false },
    { side: -0.25, lift: -0.2, r: 0.2, slot: 'aluminum', jacket: true },
  ]
  for (const o of offsets) {
    const path: Vector3[] = []
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[Math.max(0, i - 1)]
      const b = nodes[Math.min(nodes.length - 1, i + 1)]
      const dir = b.clone().sub(a).setY(0).normalize()
      const side = new Vector3(-dir.z, 0, dir.x)
      path.push(nodes[i].clone().addScaledVector(side, o.side).setY(nodes[i].y + o.lift))
    }
    writer.tube({
      path,
      radius: o.r,
      slot: o.slot,
      radialSegments: 14,
      capStart: true,
      capEnd: true,
    })
    if (o.jacket) {
      const from = path[1].clone()
      const to = path[2].clone()
      writer.tube({
        path: [from, to],
        radius: o.r + 0.055,
        slot: 'aluminum',
        radialSegments: 16,
        capStart: true,
        capEnd: true,
      })
      for (let b = 0; b <= 4; b++) {
        const at = from.clone().lerp(to, b / 4)
        const d = to.clone().sub(from).normalize()
        writer.tube({
          path: [at.clone().addScaledVector(d, -0.012), at.clone().addScaledVector(d, 0.012)],
          radius: o.r + 0.068,
          slot: 'steelEdge',
          radialSegments: 16,
          capStart: true,
          capEnd: true,
        })
      }
    }
    const dir = path[1].clone().sub(path[0]).normalize()
    flangePair(writer, path[0].clone().addScaledVector(dir, 0.55), dir, o.r, 'steelEdge')
  }

  // Valve station at the rack's midpoint: bodies, bonnets, handwheels.
  const stationAt = nodes[1].clone().lerp(nodes[2], 0.42)
  const runDir = nodes[2].clone().sub(nodes[1]).setY(0).normalize()
  const runSide = new Vector3(-runDir.z, 0, runDir.x)
  for (let i = 0; i < 2; i++) {
    const at = stationAt.clone().addScaledVector(runSide, -0.62 + i * 0.62).setY(stationAt.y + 0.46)
    writer.box({
      center: at,
      size: new Vector3(0.34, 0.36, 0.3),
      rotationY: Math.atan2(runDir.x, runDir.z),
      slot: 'orange',
      chamfer: 0.02,
    })
    writer.tube({
      path: [at.clone().setY(at.y + 0.16), at.clone().setY(at.y + 0.46)],
      radius: 0.048,
      slot: 'steelEdge',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    const wheel = revolve(
      [
        [0.2, 0],
        [0.26, 0.012],
        [0.26, 0.05],
        [0.2, 0.062],
      ],
      22,
      { axis: 'y', smooth: SMOOTH.turned },
    )
    translate(wheel, [at.x, at.z, at.y + 0.46])
    writeInto(writer, 'orangeTop', cleanMesh(wheel))
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2
      writer.tube({
        path: [
          at.clone().setY(at.y + 0.49),
          at
            .clone()
            .add(new Vector3(Math.cos(ang) * 0.23, 0, Math.sin(ang) * 0.23))
            .setY(at.y + 0.49),
        ],
        radius: 0.014,
        slot: 'orangeTop',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }
  }
  services.colliders.push({
    kind: 'box',
    center: stationAt.clone().setY(interiorHeight(stationAt.x, stationAt.z) + 1.2),
    size: new Vector3(1.9, 2.4, 1.4),
    yaw: Math.atan2(runDir.x, runDir.z),
  })
}

// ------------------------------------------------------- hall interior

/** Big process skids, high-bay lighting, and a monorail — the plant itself. */
export function buildHallInterior(services: DistrictServices): void {
  const { writer } = services

  // ---- Skid 1: compressor set on a channel base, motor + casing + coolers.
  {
    const A = -9.4
    const C = 4.4
    const baseCorners: Vec2[] = [
      hallPlan(A - 2.6, C - 2.15),
      hallPlan(A + 2.6, C - 2.15),
      hallPlan(A + 2.6, C + 2.15),
      hallPlan(A - 2.6, C + 2.15),
    ]
    writeInto(
      writer,
      'dark',
      cleanMesh(smoothShade(prism(baseCorners, FLOOR + 0.01, FLOOR + 0.22), SMOOTH.moulded)),
    )
    // Electric motor: lathed body with cooling fins and a terminal box.
    const motor = revolve(
      [
        [0, 0],
        [0.42, 0],
        [0.42, 0.16],
        [0.5, 0.2],
        [0.5, 1.32],
        [0.42, 1.36],
        [0.42, 1.5],
        [0, 1.5],
      ],
      26,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    rotateZ(motor, AX_ALONG)
    const [mx, mz] = hallPlan(A - 1.35, C)
    translate(motor, [mx, mz, FLOOR + 0.92])
    writeInto(writer, 'steel', cleanMesh(motor))
    for (let i = 0; i < 11; i++) {
      writer.box({
        center: hv(A - 1.98 + i * 0.115, C, 0.92),
        size: new Vector3(0.03, 1.06, 0.03),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.006,
      })
    }
    writer.box({
      center: hv(A - 1.35, C + 0.52, 1.42),
      size: new Vector3(0.34, 0.3, 0.42),
      rotationY: PSI,
      slot: 'dark',
      chamfer: 0.014,
    })
    // Coupling guard, then the compressor casing (a real volute silhouette).
    writer.box({
      center: hv(A - 0.36, C, 0.92),
      size: new Vector3(0.6, 0.62, 0.52),
      rotationY: PSI,
      slot: 'orange',
      chamfer: 0.018,
    })
    const casing = revolve(
      [
        [0, 0],
        [0.52, 0],
        [0.62, 0.14],
        [0.62, 0.62],
        [0.5, 0.78],
        [0, 0.78],
      ],
      24,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    rotateZ(casing, AX_ALONG)
    const [kx, kz] = hallPlan(A + 0.28, C)
    translate(casing, [kx, kz, FLOOR + 0.92])
    writeInto(writer, 'aluminum', cleanMesh(casing))
    // Interstage coolers on saddles.
    for (const s of [-1, 1]) {
      const vessel = revolve(
        [
          [0, 0],
          [0.3, 0.06],
          [0.34, 0.16],
          [0.34, 1.7],
          [0.3, 1.8],
          [0, 1.86],
        ],
        20,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      rotateZ(vessel, AX_ACROSS)
      const [vx, vz] = hallPlan(A + 1.5, C + s * 1.05 - 0.93)
      translate(vessel, [vx, vz, FLOOR + 0.62])
      writeInto(writer, 'aluminum', cleanMesh(vessel))
      for (const t of [0.35, 1.45]) {
        writer.box({
          center: hv(A + 1.5, C + s * 1.05 - 0.93 + t, 0.4),
          size: new Vector3(0.16, 0.44, 0.4),
          rotationY: PSI,
          slot: 'dark',
          chamfer: 0.014,
        })
      }
    }
    // Suction/discharge pipework with flanges.
    writer.tube({
      path: [hv(A + 0.9, C, 1.6), hv(A + 2.2, C, 1.6), hv(A + 2.2, C, 2.9), hv(A + 2.2, C + 2.6, 2.9)],
      radius: 0.15,
      slot: 'steel',
      radialSegments: 14,
      capStart: true,
      capEnd: true,
    })
    // Local control panel.
    writer.box({
      center: hv(A - 2.15, C - 1.35, 1.15),
      size: new Vector3(0.24, 0.9, 0.7),
      rotationY: PSI + 0.3,
      slot: 'steel',
      chamfer: 0.02,
    })
    writer.box({
      center: hv(A - 2.24, C - 1.35, 1.15),
      size: new Vector3(0.03, 0.6, 0.5),
      rotationY: PSI + 0.3,
      slot: 'darkGlass',
    })
    services.colliders.push({
      kind: 'box',
      center: hv(A, C, 1.1),
      size: new Vector3(3.6, 2.2, 5.4),
      yaw: PSI,
    })
  }

  // ---- Skid 2: two scrubber columns, tall enough to read from the gallery.
  for (let i = 0; i < 2; i++) {
    const A = -3.4 + i * 3.1
    const C = -4.7
    const column = revolve(
      [
        [0, 0],
        [0.62, 0.14],
        [0.76, 0.42],
        [0.76, 5.0],
        [0.62, 5.32],
        [0.32, 5.46],
        [0, 5.5],
      ],
      28,
      { smooth: SMOOTH.turned },
    )
    const [x, z] = hallPlan(A, C)
    translate(column, [x, z, FLOOR + 0.32])
    writeInto(writer, 'aluminum', cleanMesh(column))
    // Skirt, base ring, anchor lugs.
    const skirt = revolve(
      [
        [0.6, 0],
        [0.66, 0],
        [0.66, 0.34],
        [0.6, 0.34],
      ],
      24,
      { smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    translate(skirt, [x, z, FLOOR + 0.01])
    writeInto(writer, 'steel', cleanMesh(skirt))
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2
      writer.box({
        center: new Vector3(x + Math.cos(ang) * 0.79, FLOOR + 0.075, z + Math.sin(ang) * 0.79),
        size: new Vector3(0.2, 0.11, 0.28),
        rotationY: -ang,
        slot: 'steelEdge',
        chamfer: 0.012,
      })
    }
    // Manways + nozzles.
    for (const h of [1.3, 3.4]) {
      const nozzle = revolve(
        [
          [0, 0],
          [0.22, 0],
          [0.22, 0.2],
          [0.28, 0.2],
          [0.28, 0.26],
          [0, 0.26],
        ],
        16,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      rotateZ(nozzle, Math.PI - PSI)
      const [nx, nz] = hallPlan(A, C - 0.7)
      translate(nozzle, [nx, nz, FLOOR + 0.32 + h])
      writeInto(writer, 'steelEdge', cleanMesh(nozzle))
    }
    ladder(
      writer,
      new Vector3(x, FLOOR + 0.4, z).addScaledVector(new Vector3(ACROSS[0], 0, ACROSS[1]), 0.82),
      FLOOR + 5.3,
      new Vector3(ACROSS[0], 0, ACROSS[1]),
      true,
      2.2,
    )
    services.colliders.push({
      kind: 'cylinder',
      center: new Vector3(x, FLOOR + 2.9, z),
      halfHeight: 2.85,
      radius: 0.86,
    })
  }
  // Column interconnect + a platform between the two.
  writer.tube({
    path: [hv(-3.4, -3.9, 4.7), hv(-3.4, -3.5, 4.7), hv(-0.3, -3.5, 4.7), hv(-0.3, -3.9, 4.7)],
    radius: 0.16,
    slot: 'steel',
    radialSegments: 12,
    capStart: true,
    capEnd: true,
  })

  // ---- Skid 3: sorbent-bed bank on saddles with a plate exchanger + pumps.
  {
    const A = 4.3
    const C = 4.9
    for (let i = 0; i < 3; i++) {
      const cc = C - 1.5 + i * 1.5
      const bed = revolve(
        [
          [0, 0],
          [0.42, 0.08],
          [0.48, 0.2],
          [0.48, 3.0],
          [0.42, 3.12],
          [0, 3.2],
        ],
        22,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      rotateZ(bed, AX_ALONG)
      const [bx, bz] = hallPlan(A - 1.6, cc)
      translate(bed, [bx, bz, FLOOR + 1.15])
      writeInto(writer, 'aluminum', cleanMesh(bed))
      for (const t of [0.6, 2.6]) {
        writer.box({
          center: hv(A - 1.6 + t, cc, 0.5),
          size: new Vector3(0.46, 0.68, 0.2),
          rotationY: PSI,
          slot: 'dark',
          chamfer: 0.016,
        })
      }
    }
    // Header manifold across the three beds.
    writer.tube({
      path: [hv(A + 1.75, C - 1.5, 1.95), hv(A + 1.75, C + 1.5, 1.95)],
      radius: 0.13,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
    // Plate heat exchanger: a stack of real plates between two end frames.
    for (const s of [-1, 1]) {
      writer.box({
        center: hv(A + 2.6, C + 1.9 + s * 0.5, 1.0),
        size: new Vector3(0.1, 1.5, 0.7),
        rotationY: PSI,
        slot: 'steel',
        chamfer: 0.016,
      })
    }
    for (let i = 0; i < 12; i++) {
      writer.box({
        center: hv(A + 2.6, C + 1.48 + i * 0.07, 1.0),
        size: new Vector3(0.045, 1.32, 0.62),
        rotationY: PSI,
        slot: 'aluminum',
        chamfer: 0.006,
      })
    }
    // Two pump sets on plinths.
    for (let i = 0; i < 2; i++) {
      const pc = C - 1.1 + i * 1.4
      writer.box({
        center: hv(A + 3.4, pc, 0.14),
        size: new Vector3(0.7, 0.28, 1.2),
        rotationY: PSI,
        slot: 'cast',
        chamfer: 0.02,
      })
      const pump = revolve(
        [
          [0, 0],
          [0.2, 0],
          [0.2, 0.5],
          [0.16, 0.56],
          [0, 0.56],
        ],
        16,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      rotateZ(pump, AX_ACROSS)
      const [px, pz] = hallPlan(A + 3.4, pc - 0.44)
      translate(pump, [px, pz, FLOOR + 0.52])
      writeInto(writer, 'aluminum', cleanMesh(pump))
      writer.box({
        center: hv(A + 3.4, pc + 0.2, 0.52),
        size: new Vector3(0.36, 0.36, 0.62),
        rotationY: PSI,
        slot: 'steel',
        chamfer: 0.016,
      })
    }
    services.colliders.push({
      kind: 'box',
      center: hv(A + 0.6, C, 1.4),
      size: new Vector3(3.4, 2.8, 5.6),
      yaw: PSI,
    })
  }

  // ---- Monorail crane over the ACROSS-plus aisle.
  section(
    writer,
    'steel',
    [hv(-11.5, 5.4, 7.1), hv(11.5, 5.4, 7.1)],
    [
      new Vector2(-0.16, 0.22),
      new Vector2(0.16, 0.22),
      new Vector2(0.16, 0.19),
      new Vector2(0.03, 0.17),
      new Vector2(0.03, -0.16),
      new Vector2(0.18, -0.19),
      new Vector2(0.18, -0.24),
      new Vector2(-0.18, -0.24),
      new Vector2(-0.18, -0.19),
      new Vector2(-0.03, -0.16),
      new Vector2(-0.03, 0.17),
      new Vector2(-0.16, 0.19),
    ],
  )
  for (const a of [-8.5, 0, 8.5]) {
    writer.tube({
      path: [hv(a, 5.4, 7.34), hv(a, COLUMN_C - 0.24, roofLine(COLUMN_C - 0.24) - 0.34)],
      radius: 0.035,
      slot: 'steel',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
  // Trolley + hook block.
  writer.box({
    center: hv(2.2, 5.4, 7.16),
    size: new Vector3(0.44, 0.34, 0.6),
    rotationY: PSI,
    slot: 'orange',
    chamfer: 0.018,
  })
  writer.tube({
    path: [hv(2.2, 5.4, 6.98), hv(2.2, 5.4, 4.4)],
    radius: 0.016,
    slot: 'dark',
    radialSegments: 6,
    capStart: true,
    capEnd: true,
  })
  writer.box({
    center: hv(2.2, 5.4, 4.24),
    size: new Vector3(0.2, 0.32, 0.14),
    rotationY: PSI,
    slot: 'orange',
    chamfer: 0.014,
  })

  // ---- High bays hung off the rafters.
  for (const c of [-5.3, 5.3]) {
    for (const a of [-9.5, -3.2, 3.2, 9.5]) {
      writer.tube({
        path: [hv(a, c, roofLine(Math.abs(c))), hv(a, c, 6.4)],
        radius: 0.022,
        slot: 'dark',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
      // Closed hood shell (both profile ends weld on the axis), lens recessed
      // inside its throat so the two never share a plane or a volume.
      const hood = revolve(
        [
          [0, 0.32],
          [0.2, 0.3],
          [0.46, 0.0],
          [0.42, 0.0],
          [0.17, 0.28],
          [0, 0.3],
        ],
        18,
        { axis: 'y', smooth: SMOOTH.turned },
      )
      const [lx, lz] = hallPlan(a, c)
      translate(hood, [lx, lz, FLOOR + 6.06])
      writeInto(writer, 'dark', cleanMesh(hood))
      const lens = revolve(
        [
          [0, 0],
          [0.34, 0],
          [0.34, 0.02],
          [0, 0.02],
        ],
        20,
        { smooth: SMOOTH.turned },
      )
      translate(lens, [lx, lz, FLOOR + 6.115])
      writeInto(writer, 'utilityLight', cleanMesh(lens))
    }
  }
}

// ========================================================== GALLERY + OPS

export function buildGallery(services: DistrictServices): void {
  const { writer } = services

  // ---- Approach stair, outside the ALONG-minus gable, in line with the walk.
  const stairTopA = -(HALF_A + 0.9)
  const [sx, sz] = hallPlan(stairTopA, 0)
  const groundAtStair = interiorHeight(sx, sz)
  const rise = FLOOR + DECK_H - groundAtStair
  const flightRisers = 11
  const stepRise = rise / (flightRisers * 2)
  const run = 0.26
  const landingLen = 1.2
  const totalRun = flightRisers * 2 * run + landingLen
  const baseA = stairTopA - 0.7 - totalRun
  const yawUp = Math.atan2(ALONG[0], ALONG[1])

  const lowerOrigin = hv(baseA, 0, 0)
  lowerOrigin.y = interiorHeight(lowerOrigin.x, lowerOrigin.z)
  stairFlight(writer, {
    origin: lowerOrigin,
    yaw: yawUp,
    steps: flightRisers,
    rise: stepRise,
    run,
    width: 1.7,
  })
  const midA = baseA + flightRisers * run
  const midY = lowerOrigin.y + flightRisers * stepRise
  // Half landing.
  const landingCentreA = midA + 0.1 + (landingLen - 0.14) / 2
  writer.box({
    center: hv(landingCentreA, 0, midY - FLOOR - 0.03),
    size: new Vector3(1.7, 0.06, landingLen - 0.14),
    rotationY: PSI,
    slot: 'deck',
    chamferSlot: 'steelEdge',
    chamfer: 0.012,
  })
  for (const s of [-1, 1]) {
    const foot = hv(landingCentreA, s * 0.78, 0)
    foot.y = interiorHeight(foot.x, foot.z) + 0.06
    section(writer, 'steel', [foot, foot.clone().setY(midY - 0.09)], cSection(0.16, 0.09))
  }
  const upperOrigin = hv(midA + landingLen, 0, midY - FLOOR)
  upperOrigin.y = midY
  stairFlight(writer, {
    origin: upperOrigin,
    yaw: yawUp,
    steps: flightRisers,
    rise: stepRise,
    run,
    width: 1.7,
  })
  services.colliders.push({
    kind: 'box',
    center: hv((baseA + midA) / 2, 0, (lowerOrigin.y + midY) / 2 - FLOOR),
    size: new Vector3(1.7, 0.14, Math.hypot(flightRisers * run, flightRisers * stepRise) + 0.3),
    yaw: PSI,
  })
  services.colliders.push({
    kind: 'box',
    center: hv(landingCentreA, 0, midY - FLOOR - 0.07),
    size: new Vector3(1.8, 0.14, landingLen),
    yaw: PSI,
  })
  services.colliders.push({
    kind: 'box',
    center: hv(
      (midA + landingLen + stairTopA - 0.7) / 2,
      0,
      (midY + FLOOR + DECK_H) / 2 - FLOOR,
    ),
    size: new Vector3(1.7, 0.14, Math.hypot(flightRisers * run, flightRisers * stepRise) + 0.3),
    yaw: PSI,
  })
  // `stairFlight` carries the flight handrails; only the half landing needs a
  // rail of its own, and its ends bury into the flights' rails (same slot).
  for (const s of [-1, 1]) {
    writer.tube({
      path: [
        hv(midA - 0.06, s * 0.79, midY - FLOOR + 1.02),
        hv(midA + landingLen + 0.06, s * 0.79, midY - FLOOR + 1.02),
      ],
      radius: 0.028,
      slot: 'orangeTop',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    const stanchion = hv(landingCentreA, s * 0.79, midY - FLOOR)
    writer.tube({
      path: [stanchion, stanchion.clone().setY(midY + 1.02)],
      radius: 0.022,
      slot: 'orange',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }

  // ---- The walkway itself: outside landing, through the gable, down the hall.
  interface WalkSeg {
    a0: number
    a1: number
    half: number
  }
  const segments: WalkSeg[] = [
    { a0: stairTopA - 0.62, a1: -HALF_A - 0.05, half: WALK_HALF },
    { a0: -HALF_A - 0.05, a1: -9.2, half: WALK_HALF },
    { a0: -9.2, a1: -5.9, half: 1.72 },
    { a0: -5.9, a1: -1.6, half: WALK_HALF },
    { a0: -1.6, a1: 1.7, half: 1.72 },
    { a0: 1.7, a1: OPS_A - OPS_HALF_A - 0.04, half: WALK_HALF },
  ]
  for (const seg of segments) {
    const len = seg.a1 - seg.a0
    const mid = (seg.a0 + seg.a1) / 2
    writer.box({
      center: hv(mid, 0, DECK_H - 0.017),
      size: new Vector3(seg.half * 2, 0.034, len),
      rotationY: PSI,
      slot: 'deck',
      chamferSlot: 'steelEdge',
      chamfer: 0.01,
    })
    // Stringers under the deck.
    for (const s of [-1, 1]) {
      section(
        writer,
        'steel',
        [hv(seg.a0, s * (seg.half - 0.12), DECK_H - 0.19), hv(seg.a1, s * (seg.half - 0.12), DECK_H - 0.19)],
        cSection(0.3, 0.11),
      )
    }
    services.colliders.push({
      kind: 'box',
      center: hv(mid, 0, DECK_H - 0.09),
      size: new Vector3(seg.half * 2, 0.16, len),
      yaw: PSI,
    })
  }
  // Cross beams + hanger rods off the rafters (the floor stays clear).
  for (const a of [-8.5667, -4.2833, 0, 4.2833, 8.5667]) {
    section(
      writer,
      'steel',
      [hv(a, -1.72, DECK_H - 0.32), hv(a, 1.72, DECK_H - 0.32)],
      cSection(0.22, 0.1),
    )
    for (const s of [-1, 1]) {
      const c = s * 0.86
      writer.tube({
        path: [hv(a, c, DECK_H - 0.24), hv(a, c, roofLine(Math.abs(c)) - 0.34)],
        radius: 0.026,
        slot: 'steel',
        radialSegments: 8,
        capStart: true,
        capEnd: true,
      })
      writer.box({
        center: hv(a, c, roofLine(Math.abs(c)) - 0.3),
        size: new Vector3(0.1, 0.14, 0.1),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.01,
      })
    }
  }
  // Sway braces back to two columns.
  for (const a of [-4.2833, 4.2833]) {
    for (const s of [-1, 1]) {
      writer.tube({
        path: [hv(a, s * 1.6, DECK_H - 0.26), hv(a, s * (COLUMN_C - 0.22), 5.6)],
        radius: 0.02,
        slot: 'steel',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }
  }
  // Posts at the two ends, where a hanger cannot reach.
  for (const a of [-12.2, OPS_A - OPS_HALF_A - 0.4]) {
    for (const s of [-1, 1]) {
      const foot = hv(a, s * 0.86, 0.16)
      section(writer, 'steel', [foot, foot.clone().setY(FLOOR + DECK_H - 0.3)], cSection(0.2, 0.2))
      writer.box({
        center: hv(a, s * 0.86, 0.05),
        size: new Vector3(0.36, 0.1, 0.36),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.012,
      })
    }
  }

  // Handrails, kickplates, and a warm guide strip along the deck edge.
  for (const s of [-1, 1]) {
    // One deduped polyline: a repeated point is a zero-length run, and
    // `guardrail` then stamps a second post and base plate on the first.
    const path: Vector3[] = []
    const pushRail = (a: number, half: number): void => {
      const p = hv(a, s * half, DECK_H)
      const last = path[path.length - 1]
      if (last && last.distanceToSquared(p) < 1e-6) return
      path.push(p)
    }
    for (const seg of segments) {
      pushRail(seg.a0, seg.half)
      pushRail(seg.a1, seg.half)
    }
    guardrail(writer, path)
    for (const seg of segments) {
      writer.box({
        center: hv((seg.a0 + seg.a1) / 2, s * (seg.half - 0.16), DECK_H + 0.017),
        size: new Vector3(0.02, 0.022, seg.a1 - seg.a0 - 0.1),
        rotationY: PSI,
        slot: 'runningLight',
      })
    }
  }
  // Viewing-bay plaques.
  stencilSign(services, {
    at: hv(-7.55, -1.74, DECK_H + 0.72),
    facing: new Vector3(-ACROSS[0], 0, -ACROSS[1]),
    width: 1.15,
    height: signHeight(1.15),
    lines: ['CO2', 'FREEZE-OUT'],
    widthPx: 512,
  })
  stencilSign(services, {
    at: hv(0.05, 1.74, DECK_H + 0.72),
    facing: new Vector3(ACROSS[0], 0, ACROSS[1]),
    width: 1.15,
    height: signHeight(1.15),
    lines: ['SORBENT', 'BEDS'],
    widthPx: 512,
  })

  buildOpsRoom(services)
}

/**
 * The ops room: a glazed control pulpit on the gallery, at the ALONG-plus end
 * of the hall, looking back down the plant floor.
 *
 * OpsScreensSystem draws its three live dashboards at
 * `anchor + along*(i-1)*1.3 + across*(-1.52)`, 1.86 m over the anchor. The
 * anchor is therefore the room's floor centre with the HALL yaw, the screen
 * wall is the ACROSS-minus wall, and its inner lining sits at -1.545 so every
 * dashboard stands 25 mm proud of it inside a real bezel. Moving the room
 * means moving the anchor; the screens follow for free.
 */
export function buildOpsRoom(services: DistrictServices): void {
  const { writer } = services
  const a0 = OPS_A - OPS_HALF_A
  const a1 = OPS_A + OPS_HALF_A
  const outer = OPS_INNER_C + OPS_WALL_T

  // Floor slab, flush with the gallery deck.
  writer.box({
    center: hv(OPS_A, 0, DECK_H - 0.09),
    size: new Vector3(outer * 2, 0.18, OPS_HALF_A * 2),
    rotationY: PSI,
    slot: 'deck',
    chamferSlot: 'steelEdge',
    chamfer: 0.014,
  })
  // Roof with a raised upstand.
  writer.box({
    center: hv(OPS_A, 0, DECK_H + OPS_H + 0.07),
    size: new Vector3(outer * 2 + 0.22, 0.14, OPS_HALF_A * 2 + 0.22),
    rotationY: PSI,
    slot: 'steel',
    chamfer: 0.026,
  })
  writer.box({
    center: hv(OPS_A, 0, DECK_H + OPS_H + 0.2),
    size: new Vector3(outer * 2 + 0.06, 0.12, OPS_HALF_A * 2 + 0.06),
    rotationY: PSI,
    slot: 'steelEdge',
    chamfer: 0.014,
  })

  // Three solid walls (screen wall, far wall, back wall).
  const solidWall = (
    cx: number,
    ax: number,
    sizeAcross: number,
    sizeAlong: number,
  ): void => {
    writer.box({
      center: hv(ax, cx, DECK_H + OPS_H / 2),
      size: new Vector3(sizeAcross, OPS_H, sizeAlong),
      rotationY: PSI,
      slot: 'habShell',
      chamfer: 0.024,
    })
  }
  solidWall(-(OPS_INNER_C + OPS_WALL_T / 2), OPS_A, OPS_WALL_T, OPS_HALF_A * 2)
  solidWall(OPS_INNER_C + OPS_WALL_T / 2, OPS_A, OPS_WALL_T, OPS_HALF_A * 2)
  writer.box({
    center: hv(a1 - OPS_WALL_T / 2, 0, DECK_H + OPS_H / 2),
    size: new Vector3(OPS_INNER_C * 2, OPS_H, OPS_WALL_T),
    rotationY: PSI,
    slot: 'habShell',
    chamfer: 0.024,
  })

  // ---- The window wall (ALONG-minus): a stick system looking back down the
  // plant floor. Mullions run full height; transoms and infill stop BETWEEN
  // them, so no two frame members ever occupy the same volume. The left bay
  // is the door: it stays clear of every rail so the sliding leaf can pass.
  const wallA = a0 + OPS_WALL_T / 2
  const mullions = [-1.42, -0.47, 0.48, 1.43]
  for (const c of mullions) {
    writer.box({
      center: hv(wallA, c, DECK_H + OPS_H / 2),
      size: new Vector3(0.09, OPS_H, OPS_WALL_T),
      rotationY: PSI,
      slot: 'aluminum',
      chamfer: 0.012,
    })
  }
  const bays: Array<[number, number]> = [
    [-1.42, -0.47],
    [-0.47, 0.48],
    [0.48, 1.43],
  ]
  const sideBays: Array<[number, number]> = [
    [-OPS_INNER_C, -1.42],
    [1.43, OPS_INNER_C],
  ]
  const reveal = (c0: number, c1: number, max: number): number =>
    Math.min(max, (c1 - c0) * 0.24)
  const rail = (c0: number, c1: number, h: number, depth = 0.09): void => {
    writer.box({
      center: hv(wallA, (c0 + c1) / 2, DECK_H + h),
      size: new Vector3(c1 - c0 - 2 * reveal(c0, c1, 0.053), depth, OPS_WALL_T),
      rotationY: PSI,
      slot: 'aluminum',
      chamfer: 0.012,
    })
  }
  const infill = (c0: number, c1: number, h0: number, h1: number, slot: string): void => {
    writer.box({
      center: hv(wallA, (c0 + c1) / 2, DECK_H + (h0 + h1) / 2),
      size: new Vector3(c1 - c0 - 2 * reveal(c0, c1, 0.063), h1 - h0, slot === 'cabinGlass' ? 0.03 : 0.07),
      rotationY: PSI,
      slot,
      chamfer: slot === 'cabinGlass' ? undefined : 0.012,
    })
  }
  for (const [c0, c1] of [...bays.slice(1), ...sideBays]) {
    rail(c0, c1, 0.34)
    infill(c0, c1, 0.02, 0.29, 'habShell')
    infill(c0, c1, 0.39, 2.23, 'cabinGlass')
  }
  for (const [c0, c1] of [...bays, ...sideBays]) {
    rail(c0, c1, 2.28)
    rail(c0, c1, OPS_H - 0.05, 0.1)
    infill(c0, c1, 2.35, 2.74, 'habShell')
  }
  // Door threshold track, low enough to step over and clear of the leaf.
  rail(-1.42, -0.47, 0.02, 0.032)

  // ---- Screen wall: three pockets in ONE continuous bezel. The dashboards
  // sit on a 1.3 m pitch and are 1.15 m wide, so a per-screen frame would
  // want 160 mm of mullion in a 150 mm gap — the verticals are SHARED, four
  // of them, and each opening's rails butt into the pair that flanks it.
  const MULL = [-1.95, -0.65, 0.65, 1.95]
  for (const m of MULL) {
    writer.box({
      center: hv(OPS_A + m, -1.522, DECK_H + 1.86),
      size: new Vector3(0.055, 0.82, 0.08),
      rotationY: PSI,
      slot: 'steelEdge',
      chamfer: 0.008,
    })
  }
  for (let i = 0; i < 3; i++) {
    const a = OPS_A + (i - 1) * 1.3
    writer.box({
      center: hv(a, -1.585, DECK_H + 1.86),
      size: new Vector3(0.05, 0.72, 1.2),
      rotationY: PSI,
      slot: 'dark',
    })
    for (const s of [-1, 1]) {
      writer.box({
        center: hv(a, -1.522, DECK_H + 1.86 + s * 0.41),
        size: new Vector3(0.055, 0.08, 1.22),
        rotationY: PSI,
        slot: 'steelEdge',
        chamfer: 0.008,
      })
    }
  }
  writer.box({
    center: hv(OPS_A, -1.48, DECK_H + 2.42),
    size: new Vector3(0.06, 0.05, 4.1),
    rotationY: PSI,
    slot: 'runningLight',
  })

  // ---- Colliders: three solid walls plus the window wall's solid parts.
  const opsWall = (ax: number, cx: number, size: Vector3): void => {
    services.colliders.push({
      kind: 'box',
      center: hv(ax, cx, DECK_H + OPS_H / 2),
      size,
      yaw: PSI,
    })
  }
  opsWall(OPS_A, -(OPS_INNER_C + OPS_WALL_T / 2), new Vector3(0.2, OPS_H, OPS_HALF_A * 2))
  opsWall(OPS_A, OPS_INNER_C + OPS_WALL_T / 2, new Vector3(0.2, OPS_H, OPS_HALF_A * 2))
  opsWall(a1 - OPS_WALL_T / 2, 0, new Vector3(OPS_INNER_C * 2, OPS_H, 0.2))
  opsWall(a0 + 0.06, 0.955, new Vector3(1.18, OPS_H, 0.2))
  services.colliders.push({
    kind: 'box',
    center: hv(a0 + 0.06, -0.945, DECK_H + OPS_H - 0.3),
    size: new Vector3(0.95, 0.6, 0.2),
    yaw: PSI,
  })
  // Floor.
  services.colliders.push({
    kind: 'box',
    center: hv(OPS_A, 0, DECK_H - 0.09),
    size: new Vector3(outer * 2, 0.18, OPS_HALF_A * 2),
    yaw: PSI,
  })

  services.opsAnchor = { position: hv(OPS_A, 0, DECK_H), yaw: PSI }

  stencilSign(services, {
    at: hv(a0 - 0.02, 1.0, DECK_H + 2.6),
    facing: new Vector3(-ALONG[0], 0, -ALONG[1]),
    width: 1.1,
    height: signHeight(1.1),
    lines: ['OPS'],
    widthPx: 384,
  })
  bulkheadLamp(
    services.writer,
    hv(a0 - 0.02, -1.42, DECK_H + 2.32),
    new Vector3(-ALONG[0], 0, -ALONG[1]),
  )
}

// ============================================================== RECLAIMER

/**
 * The water reclaimer stands square to the site grid off the hall's
 * ALONG-plus gable. Its two flues are the reason it exists here: RobotsSystem
 * emits vapour at `(machineHall.x + 6 ± 1, machineHall.z + depth/2 + 7)` and
 * `interiorHeight + 7.4`, so the flue mouths land EXACTLY there.
 */
export function buildReclaimer(services: DistrictServices): void {
  const { writer } = services
  // The FLUE axes are fixed: RobotsSystem emits vapour at
  // (machineHall.x + 6 +/- 1, machineHall.z + depth/2 + 7). The skid and its
  // pour are free, and they are shifted 0.6/0.3 m clear so the reclaimer's
  // apron never runs under the machine hall's slab (two pours at one datum).
  const rx = HALL.x + 6
  const rz = HALL.z + HALL.depth / 2 + 7
  const skidX = rx + 0.8
  const skidZ = rz + 0.5
  const ground = interiorHeight(rx, rz)
  const stackTop = ground + 7.4
  const padOutline = planRect(skidX, skidZ, 0, 2.7, 2.2, 0.9)
  const padTop = outlineTop(padOutline, 0.12)

  pouredPad(writer, padOutline, padTop, 'cast', 'cast', 0.04)

  // Skid body: a welded module with a ribbed flank and a lifting frame.
  writer.box({
    center: new Vector3(skidX, padTop + 1.5, skidZ),
    size: new Vector3(4.6, 3.0, 3.2),
    slot: 'steel',
    chamfer: 0.05,
  })
  for (let i = 0; i < 9; i++) {
    writer.box({
      center: new Vector3(skidX - 2.0 + i * 0.5, padTop + 1.5, skidZ + 1.63),
      size: new Vector3(0.1, 2.6, 0.09),
      slot: 'steelEdge',
      chamfer: 0.01,
    })
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      writer.box({
        center: new Vector3(skidX + sx * 2.24, padTop + 1.64, skidZ + sz * 1.54),
        size: new Vector3(0.16, 3.08, 0.16),
        slot: 'steelEdge',
        chamfer: 0.014,
      })
    }
  }
  writer.box({
    center: new Vector3(skidX, padTop + 3.06, skidZ),
    size: new Vector3(4.7, 0.12, 3.3),
    slot: 'steelEdge',
    chamfer: 0.02,
  })
  // Access panels with real hinges + a control cabinet.
  for (const sx of [-1, 1]) {
    writer.box({
      center: new Vector3(skidX + sx * 1.1, padTop + 1.35, skidZ - 1.63),
      size: new Vector3(1.7, 2.0, 0.06),
      slot: 'habShell',
      chamfer: 0.016,
    })
    for (const h of [0.55, 2.1]) {
      writer.box({
        center: new Vector3(skidX + sx * 1.92, padTop + h, skidZ - 1.68),
        size: new Vector3(0.16, 0.14, 0.08),
        slot: 'dark',
        chamfer: 0.01,
      })
    }
  }
  writer.box({
    center: new Vector3(skidX - 2.62, padTop + 1.35, skidZ - 0.4),
    size: new Vector3(0.42, 1.1, 0.8),
    slot: 'steel',
    chamfer: 0.022,
  })
  writer.box({
    center: new Vector3(skidX - 2.84, padTop + 1.35, skidZ - 0.4),
    size: new Vector3(0.03, 0.72, 0.56),
    rotationY: 0,
    slot: 'darkGlass',
  })

  // ---- The two flues. Mouth at exactly ground + 7.4 with a flared lip, so
  // the plume leaves real geometry; the rain caps live on the relief vents.
  for (const s of [-1, 1]) {
    const fx = rx + s
    const base = padTop + 3.12
    writer.tube({
      path: [new Vector3(fx, base, rz), new Vector3(fx, stackTop - 0.16, rz)],
      radius: 0.27,
      slot: 'aluminum',
      radialSegments: 18,
      capStart: true,
      capEnd: false,
    })
    const lip = revolve(
      [
        [0.27, 0],
        [0.27, 0.1],
        [0.36, 0.16],
        [0.33, 0.16],
        [0.25, 0.1],
        [0.25, 0],
      ],
      18,
      { axis: 'y', smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    translate(lip, [fx, rz, stackTop - 0.16])
    writeInto(writer, 'aluminum', cleanMesh(lip))
    // Expansion bellows + a storm collar partway up.
    for (const h of [1.6, 3.6]) {
      for (let k = 0; k < 3; k++) {
        writer.tube({
          path: [
            new Vector3(fx, base + h + k * 0.09, rz),
            new Vector3(fx, base + h + k * 0.09 + 0.045, rz),
          ],
          radius: 0.33,
          slot: 'steelEdge',
          radialSegments: 18,
          capStart: true,
          capEnd: true,
        })
      }
    }
    // Guy ring + three stays back to the skid frame.
    writer.tube({
      path: [
        new Vector3(fx, base + 2.7, rz),
        new Vector3(fx, base + 2.78, rz),
      ],
      radius: 0.35,
      slot: 'steel',
      radialSegments: 18,
      capStart: true,
      capEnd: true,
    })
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + 0.4
      writer.tube({
        path: [
          new Vector3(fx + Math.cos(ang) * 0.35, base + 2.74, rz + Math.sin(ang) * 0.35),
          new Vector3(fx + Math.cos(ang) * 1.7, padTop + 3.1, rz + Math.sin(ang) * 1.7),
        ],
        radius: 0.014,
        slot: 'steel',
        radialSegments: 5,
        capStart: true,
        capEnd: true,
      })
    }
    // Obstruction lamp on each flue.
    writer.box({
      center: new Vector3(fx + s * 0.31, base + 3.2, rz),
      size: new Vector3(0.09, 0.11, 0.09),
      slot: 'utilityLight',
    })
  }
  ladder(
    writer,
    new Vector3(skidX - 1.0, padTop + 3.12, skidZ - 0.62),
    stackTop - 0.9,
    new Vector3(0, 0, -1),
    true,
    1.6,
  )

  // ---- Relief vents with rain caps (the caps live here, clear of the plume).
  for (const s of [-1, 1]) {
    const vx = skidX + s * 1.85
    const vz = skidZ + 0.9
    const top = padTop + 4.7
    writer.tube({
      path: [new Vector3(vx, padTop + 3.1, vz), new Vector3(vx, top, vz)],
      radius: 0.11,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2
      writer.tube({
        path: [
          new Vector3(vx + Math.cos(ang) * 0.128, top - 0.1, vz + Math.sin(ang) * 0.128),
          new Vector3(vx + Math.cos(ang) * 0.13, top + 0.16, vz + Math.sin(ang) * 0.13),
        ],
        radius: 0.012,
        slot: 'steelEdge',
        radialSegments: 5,
        capStart: true,
        capEnd: true,
      })
    }
    const cap = revolve(
      [
        [0, 0.14],
        [0.1, 0.11],
        [0.24, 0.005],
        [0.24, -0.02],
        [0.09, 0.085],
        [0, 0.115],
      ],
      16,
      { axis: 'y', smooth: SMOOTH.turned },
    )
    translate(cap, [vx, vz, top + 0.16])
    writeInto(writer, 'steel', cleanMesh(cap))
  }

  // ---- Pipe bridge back to the hall's gable.
  const gableFace = hv(HALF_A + 0.06, 2.4, 4.4)
  for (const [dz, r] of [
    [-0.5, 0.16],
    [0.5, 0.12],
  ] as const) {
    writer.tube({
      path: [
        new Vector3(skidX - 2.3, padTop + 2.2 + dz * 0.4, skidZ + dz),
        new Vector3(skidX - 4.2, padTop + 2.6 + dz * 0.4, skidZ + dz * 1.4),
        new Vector3(gableFace.x, gableFace.y + dz * 0.4, gableFace.z),
      ],
      radius: r,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
  }
  // ONE escutcheon plate where both pipes land on the gable: the pipe ends
  // bury into it and it stands clear of the gable sheeting's crest face.
  writer.box({
    center: hv(HALF_A + 0.085, 2.4, 4.4),
    size: new Vector3(0.62, 1.0, 0.06),
    rotationY: PSI,
    slot: 'steelEdge',
    chamfer: 0.012,
  })

  services.colliders.push({
    kind: 'box',
    center: new Vector3(skidX, padTop + 1.55, skidZ),
    size: new Vector3(4.8, 3.1, 3.4),
  })
  stencilSign(services, {
    // 1.694, not 1.72: the skid's flank is 61 mm behind `at` at 1.72, so the
    // bosses (35 mm reach) hung 26 mm clear of the machine they name.
    at: new Vector3(skidX, padTop + 2.5, skidZ - 1.694),
    facing: new Vector3(0, 0, -1),
    width: 2.2,
    height: signHeight(2.2),
    lines: ['WATER', 'RECLAIMER', 'R-2'],
    widthPx: 512,
  })
}

// ============================================================== TANK FARM

/**
 * Convex hull of two circles as one CCW plan outline — the tank farm and the
 * water tower share ONE pour, because two overlapping discs at the same datum
 * are a 50 m² coplanar pair by construction.
 */
function planStadium(
  c0: [number, number],
  r0: number,
  c1: [number, number],
  r1: number,
  seg = 18,
): Vec2[] {
  const dx = c1[0] - c0[0]
  const dz = c1[1] - c0[1]
  const L = Math.hypot(dx, dz)
  const psi = Math.atan2(dz, dx)
  const beta = Math.acos(Math.max(-1, Math.min(1, -(r1 - r0) / L)))
  const out: Vec2[] = []
  for (let i = 0; i <= seg; i++) {
    const a = psi + beta + ((2 * Math.PI - 2 * beta) * i) / seg
    out.push([c0[0] + Math.cos(a) * r0, c0[1] + Math.sin(a) * r0])
  }
  for (let i = 0; i <= seg; i++) {
    const a = psi - beta + ((2 * beta) * i) / seg
    out.push([c1[0] + Math.cos(a) * r1, c1[1] + Math.sin(a) * r1])
  }
  return out
}

/** The utilities compound's shared apron: spheres, bullets and the tower. */
function compoundApron(): { outline: Vec2[]; top: number } {
  const farm = WORKS.tankFarm
  const outline = planStadium([farm.x, farm.z], 9.4, [WATER_TOWER.x, WATER_TOWER.z], 4.6, 22)
  return { outline, top: outlineTop(outline, 0.1) }
}

export function buildTankFarm(services: DistrictServices): void {
  const { writer } = services
  const farm = WORKS.tankFarm
  // Face the cluster away from the water tower so the two never collide.
  const phi = Math.atan2(WATER_TOWER.z - farm.z, WATER_TOWER.x - farm.x) + Math.PI
  const U: [number, number] = [Math.cos(phi), Math.sin(phi)]
  const V: [number, number] = [-Math.sin(phi), Math.cos(phi)]
  const fp = (u: number, v: number): [number, number] => [
    farm.x + u * U[0] + v * V[0],
    farm.z + u * U[1] + v * V[1],
  ]
  const fv = (u: number, v: number, y: number): Vector3 => {
    const [x, z] = fp(u, v)
    return new Vector3(x, y, z)
  }

  const apron = compoundApron()
  const padTop = apron.top
  pouredPad(writer, apron.outline, padTop, 'cast', 'cast', 0.05)

  // ---- Three spheres on ring cradles. R = 2.3 m (4.6 m dia).
  const R = 2.3
  const RING_R = 1.7
  const labels = ['O2', 'H2O', 'CH4']
  const codes = ['V-11', 'V-12', 'V-13']
  const spots: Array<[number, number]> = [
    [5.0, 0],
    [2.2, -5.0],
    [2.2, 5.0],
  ]
  spots.forEach(([u, v], index) => {
    const [x, z] = fp(u, v)
    const centreY = padTop + 3.6

    // Shell: a revolve with welded poles, plus a proud equator weld band.
    const profile: Vec2[] = []
    for (let i = 0; i <= 24; i++) {
      const t = -Math.PI / 2 + (i / 24) * Math.PI
      profile.push([Math.cos(t) * R, Math.sin(t) * R])
    }
    const shell = revolve(profile, 36, { smooth: SMOOTH.turned })
    translate(shell, [x, z, centreY])
    writeInto(writer, 'aluminum', cleanMesh(shell))
    const weld = revolve(
      [
        [R + 0.004, -0.055],
        [R + 0.022, -0.03],
        [R + 0.022, 0.03],
        [R + 0.004, 0.055],
      ],
      36,
      { smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    translate(weld, [x, z, centreY])
    writeInto(writer, 'steelEdge', cleanMesh(weld))

    // Curved saddle ring: it follows the shell with a 20 mm reveal, so the
    // sphere is CARRIED rather than pushed into a flat pad.
    {
      const surf = (r: number): number => centreY - Math.sqrt(Math.max(0.01, R * R - r * r))
      const upper: Vec2[] = []
      const lower: Vec2[] = []
      for (let i = 0; i <= 6; i++) {
        const r = 1.5 + (0.4 * i) / 6
        upper.push([r, surf(r) - 0.02])
        lower.push([r, surf(r) - 0.08])
      }
      const prof = [...upper, ...lower.reverse()]
      const rings = Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2
        return prof.map(([r, zz]) => [x + Math.cos(a) * r, z + Math.sin(a) * r, zz] as Vec3)
      })
      const saddle = loft(rings, { closeU: true, closeV: true })
      writeInto(writer, 'dark', cleanMesh(smoothShade(saddle, SMOOTH.turned)))
    }

    // Ring girder on eight braced columns, its top under the saddle.
    const ringY = centreY - Math.sqrt(R * R - RING_R * RING_R) - 0.08 - 0.13
    ringSection(
      writer,
      'steel',
      planCircle(x, z, RING_R, 26).map(([px, pz]) => new Vector3(px, ringY, pz)),
      cSection(0.26, 0.26),
    )
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + 0.2
      const foot = new Vector3(
        x + Math.cos(ang) * (RING_R + 0.34),
        padTop + 0.2,
        z + Math.sin(ang) * (RING_R + 0.34),
      )
      const head = new Vector3(x + Math.cos(ang) * RING_R, ringY + 0.02, z + Math.sin(ang) * RING_R)
      section(writer, 'steel', [foot, head], cSection(0.19, 0.19))
      writer.box({
        center: foot.clone().setY(padTop + 0.058),
        size: new Vector3(0.42, 0.098, 0.42),
        rotationY: -ang,
        slot: 'cast',
        chamfer: 0.012,
      })
      const next = ((k + 1) / 8) * Math.PI * 2 + 0.2
      writer.tube({
        path: [
          new Vector3(x + Math.cos(ang) * (RING_R + 0.28), padTop + 0.5, z + Math.sin(ang) * (RING_R + 0.28)),
          new Vector3(x + Math.cos(next) * (RING_R + 0.06), ringY - 0.24, z + Math.sin(next) * (RING_R + 0.06)),
        ],
        radius: 0.026,
        slot: 'steel',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }

    // Cradle-level walkway: a real annular deck with a rail, clear of the
    // shell by 760 mm — this is the level a fitter actually works from.
    // 2.25 m keeps the deck clear of the shell (1.82 m radius at this height)
    // AND keeps three spheres' walkways from overlapping each other.
    const walkY = ringY + 0.35
    const walkR = 2.25
    ringSection(
      writer,
      'deck',
      planCircle(x, z, walkR, 24).map(([px, pz]) => new Vector3(px, walkY, pz)),
      barSection(0.66, 0.04),
    )
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + 0.1
      const inner = new Vector3(x + Math.cos(ang) * (RING_R + 0.1), ringY + 0.1, z + Math.sin(ang) * (RING_R + 0.1))
      const outer = new Vector3(x + Math.cos(ang) * (walkR + 0.2), walkY - 0.05, z + Math.sin(ang) * (walkR + 0.2))
      writer.tube({ path: [inner, outer], radius: 0.022, slot: 'steel', radialSegments: 6, capStart: true, capEnd: true })
      const post = new Vector3(x + Math.cos(ang) * (walkR + 0.28), walkY + 0.022, z + Math.sin(ang) * (walkR + 0.28))
      writer.tube({
        path: [post, post.clone().setY(walkY + 1.08)],
        radius: 0.021,
        slot: 'orange',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }
    for (const h of [0.53, 1.06]) {
      ringSection(
        writer,
        h > 0.9 ? 'orangeTop' : 'orange',
        planCircle(x, z, walkR + 0.28, 24).map(([px, pz]) => new Vector3(px, walkY + h, pz)),
        barSection(0.036, 0.036),
      )
    }

    // Relief stack off the crown, with a nozzle collar where it leaves the
    // shell, and a level bridle above the walkway on the approach side.
    const stackTop = centreY + R + 2.4
    writer.tube({
      path: [new Vector3(x, centreY + R - 0.16, z), new Vector3(x, stackTop, z)],
      radius: 0.085,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
    const nozzle = revolve(
      [
        [0.085, 0],
        [0.19, 0],
        [0.19, 0.22],
        [0.085, 0.22],
      ],
      16,
      { smooth: SMOOTH.turned, capStart: false, capEnd: false },
    )
    translate(nozzle, [x, z, centreY + R - 0.03])
    writeInto(writer, 'steelEdge', cleanMesh(nozzle))
    flangePair(writer, new Vector3(x, centreY + R + 0.9, z), new Vector3(0, 1, 0), 0.085, 'steelEdge')
    const reliefHead = revolve(
      [
        [0, 0],
        [0.17, 0.02],
        [0.17, 0.24],
        [0.1, 0.3],
        [0, 0.3],
      ],
      14,
      { axis: 'y', smooth: SMOOTH.turned },
    )
    translate(reliefHead, [x, z, stackTop])
    writeInto(writer, 'orange', cleanMesh(reliefHead))
    const gaugeDir = new Vector3(-U[0], 0, -U[1])
    const gx = x + gaugeDir.x * 2.62
    const gz = z + gaugeDir.z * 2.62
    writer.tube({
      path: [new Vector3(gx, centreY - 1.1, gz), new Vector3(gx, centreY + 0.7, gz)],
      radius: 0.035,
      slot: 'steel',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
    writer.box({
      center: new Vector3(gx, centreY - 0.2, gz),
      size: new Vector3(0.1, 1.3, 0.05),
      rotationY: Math.atan2(gaugeDir.x, gaugeDir.z),
      slot: 'darkGlass',
    })

    // Access ladder from the apron to the walkway, outboard of the rail.
    const ladderDir = new Vector3(U[0], 0, U[1])
    ladder(
      writer,
      new Vector3(x + ladderDir.x * (walkR + 0.6), padTop + 0.02, z + ladderDir.z * (walkR + 0.6)),
      walkY + 1.05,
      ladderDir,
      true,
      2.2,
    )

    // Identity plate on the cradle — NASA-punk honesty, read from the walk.
    const face = new Vector3(-U[0], 0, -U[1])
    stencilSign(services, {
      // +0.30, not +0.34: the cradle ring's nearest face is 75 mm behind `at`
      // at 0.34, so the plate's bosses stood 40 mm off the steel.
      at: new Vector3(x + face.x * (RING_R + 0.3), ringY + 0.62, z + face.z * (RING_R + 0.3)),
      facing: face,
      width: 1.25,
      height: signHeight(1.25),
      lines: [labels[index], codes[index]],
      widthPx: 512,
    })
    services.colliders.push({
      kind: 'cylinder',
      center: new Vector3(x, padTop + 1.1, z),
      halfHeight: 1.1,
      radius: 2.1,
    })
    services.colliders.push({
      kind: 'cylinder',
      center: new Vector3(x, centreY, z),
      halfHeight: R * 0.92,
      radius: R * 0.94,
    })
  })

  // ---- Two horizontal bullets on saddles, side by side, axes along V.
  for (let i = 0; i < 2; i++) {
    const u = -2.4
    const v = i === 0 ? -2.4 : 2.4
    const axisYaw = phi + Math.PI / 2
    const half = 2.8
    const BR = 1.2
    const centreYy = padTop + 1.95
    const body = revolve(
      [
        [0, 0],
        [BR * 0.55, 0.02],
        [BR * 0.92, 0.22],
        [BR, 0.56],
        [BR, 2 * half - 0.56],
        [BR * 0.92, 2 * half - 0.22],
        [BR * 0.55, 2 * half - 0.02],
        [0, 2 * half],
      ],
      26,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    rotateZ(body, axisYaw)
    const start = fv(u, v - half, 0)
    translate(body, [start.x, start.z, centreYy])
    writeInto(writer, 'aluminum', cleanMesh(body))
    for (const t of [-1.75, 1.75]) {
      const saddleAt = fv(u, v + t, padTop)
      writer.box({
        center: saddleAt.clone().setY(padTop + 0.395),
        size: new Vector3(1.4, 0.75, 0.5),
        rotationY: axisYaw + Math.PI / 2,
        slot: 'cast',
        chamfer: 0.03,
      })
      const strap = revolve(
        [
          [BR + 0.005, -0.05],
          [BR + 0.03, -0.05],
          [BR + 0.03, 0.05],
          [BR + 0.005, 0.05],
        ],
        26,
        { axis: 'x', smooth: SMOOTH.turned, capStart: false, capEnd: false },
      )
      rotateZ(strap, axisYaw)
      const sp = fv(u, v + t, 0)
      translate(strap, [sp.x, sp.z, centreYy])
      writeInto(writer, 'steelEdge', cleanMesh(strap))
    }
    // Manway on the flank, relief stack and its head off the crown.
    const top = fv(u, v + 0.9, centreYy + BR)
    writer.tube({
      path: [top.clone().setY(centreYy + BR - 0.12), top.clone().setY(centreYy + BR + 1.5)],
      radius: 0.075,
      slot: 'steel',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    const bullHead = revolve(
      [
        [0, 0],
        [0.14, 0.02],
        [0.14, 0.2],
        [0.08, 0.25],
        [0, 0.25],
      ],
      12,
      { axis: 'y', smooth: SMOOTH.turned },
    )
    translate(bullHead, [top.x, top.z, centreYy + BR + 1.5])
    writeInto(writer, 'orange', cleanMesh(bullHead))
    const manwayDir = new Vector3(-U[0], 0, -U[1])
    const mw = fv(u, v - 1.9, 0)
    const manway = revolve(
      [
        [0, 0],
        [0.3, 0],
        [0.3, 0.14],
        [0.36, 0.14],
        [0.36, 0.2],
        [0, 0.2],
      ],
      16,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    rotateZ(manway, Math.atan2(manwayDir.z, manwayDir.x))
    translate(manway, [mw.x + manwayDir.x * (BR - 0.06), mw.z + manwayDir.z * (BR - 0.06), centreYy])
    writeInto(writer, 'steelEdge', cleanMesh(manway))
    services.colliders.push({
      kind: 'box',
      center: fv(u, v, centreYy),
      size: new Vector3(2.4, 2.4, 2 * half),
      yaw: axisYaw,
    })
    stencilSign(services, {
      at: fv(u - 1.34, v, padTop + 1.05),
      facing: new Vector3(-U[0], 0, -U[1]),
      width: 1.15,
      height: signHeight(1.15),
      lines: ['N2', i === 0 ? 'V-31' : 'V-32'],
      widthPx: 512,
      // The vessel's dished end is 0.49-0.64 m behind this plate (it is a
      // curve, so no single standoff fits): stand it on the pad instead.
      legsToY: padTop,
    })
  }

  // ---- Pipe bridge tying the cluster together, on portal supports.
  const bridgeY = padTop + 3.3
  const bridgeNodes = [fv(-1.0, 0, bridgeY), fv(0.5, 0, bridgeY), fv(2.0, 0, bridgeY)]
  for (const p of bridgeNodes) {
    for (const s of [-1, 1]) {
      const foot = p
        .clone()
        .addScaledVector(new Vector3(V[0], 0, V[1]), s * 0.8)
        .setY(padTop + 0.175)
      section(writer, 'steel', [foot, foot.clone().setY(bridgeY + 0.2)], cSection(0.2, 0.11))
      writer.box({
        center: foot.clone().setY(padTop + 0.062),
        size: new Vector3(0.4, 0.106, 0.4),
        rotationY: phi,
        slot: 'cast',
        chamfer: 0.014,
      })
    }
    section(
      writer,
      'steel',
      [
        p.clone().addScaledVector(new Vector3(V[0], 0, V[1]), -0.9).setY(bridgeY + 0.26),
        p.clone().addScaledVector(new Vector3(V[0], 0, V[1]), 0.9).setY(bridgeY + 0.26),
      ],
      cSection(0.18, 0.1),
    )
  }
  for (const [off, r] of [
    [-0.45, 0.13],
    [0, 0.1],
    [0.45, 0.16],
  ] as const) {
    writer.tube({
      path: bridgeNodes.map((p) =>
        p.clone().addScaledVector(new Vector3(V[0], 0, V[1]), off).setY(bridgeY + 0.44),
      ),
      radius: r,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
  }

  lightFixtures().registerGlowPool({
    id: 'works-tankfarm',
    slot: 'utilityLight',
    count: 4,
    position: [farm.x, padTop + 4, farm.z],
  })
  for (const [u, v] of [
    [-0.6, -7.0],
    [-0.6, 7.0],
  ] as const) {
    const mast = fv(u, v, padTop)
    writer.tube({
      path: [mast.clone().setY(padTop + 0.16), mast.clone().setY(padTop + 4.2)],
      radius: 0.07,
      slot: 'steel',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    writer.box({
      center: mast.clone().setY(padTop + 0.09),
      size: new Vector3(0.34, 0.156, 0.34),
      slot: 'cast',
      chamfer: 0.014,
    })
    bulkheadLamp(
      writer,
      mast
        .clone()
        .setY(padTop + 4.1)
        .addScaledVector(new Vector3(-U[0], 0, -U[1]), 0.08),
      new Vector3(-U[0], 0, -U[1]),
    )
  }
}

// ============================================================ WATER TOWER

export function buildWaterTower(services: DistrictServices): void {
  const { writer } = services
  const { x, z } = WATER_TOWER
  // Stands on the compound's shared pour — see planStadium().
  const padTop = compoundApron().top

  const LEGS = 6
  const legFootR = 2.9
  const legHeadR = 1.9
  const tankBottom = padTop + 10.4
  const barrelTop = padTop + 14.6
  const domeTop = padTop + 15.6
  const mastTop = padTop + WATER_TOWER.height

  // ---- Battered lattice legs with three ring braces and X diagonals.
  const legBase = padTop + 0.21
  const legAt = (k: number, t: number): Vector3 => {
    const ang = (k / LEGS) * Math.PI * 2 + 0.26
    const r = legFootR + (legHeadR - legFootR) * t
    return new Vector3(
      x + Math.cos(ang) * r,
      legBase + (tankBottom - legBase) * t,
      z + Math.sin(ang) * r,
    )
  }
  for (let k = 0; k < LEGS; k++) {
    section(writer, 'steel', [legAt(k, 0), legAt(k, 1)], cSection(0.24, 0.14))
    writer.box({
      center: legAt(k, 0).setY(padTop + 0.058),
      size: new Vector3(0.62, 0.098, 0.62),
      rotationY: (k / LEGS) * Math.PI * 2,
      slot: 'cast',
      chamfer: 0.016,
    })
    writer.box({
      center: legAt(k, 0).setY(padTop + 0.124),
      size: new Vector3(0.5, 0.03, 0.5),
      rotationY: (k / LEGS) * Math.PI * 2,
      slot: 'steelEdge',
      chamfer: 0.008,
    })
  }
  for (const t of [0.28, 0.56, 0.84]) {
    ringSection(
      writer,
      'steel',
      Array.from({ length: LEGS }, (_, k) => legAt(k, t)),
      cSection(0.16, 0.1),
    )
  }
  for (const [t0, t1] of [
    [0.02, 0.28],
    [0.28, 0.56],
    [0.56, 0.84],
    [0.84, 1.0],
  ] as const) {
    for (let k = 0; k < LEGS; k++) {
      writer.tube({
        path: [legAt(k, t0), legAt((k + 1) % LEGS, t1)],
        radius: 0.026,
        slot: 'steel',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
      writer.tube({
        path: [legAt((k + 1) % LEGS, t0), legAt(k, t1)],
        radius: 0.026,
        slot: 'steel',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }
  }

  // ---- The tank: torispherical bottom head, barrel, torispherical crown.
  const R = 3.2
  const profile: Vec2[] = []
  profile.push([0, 0])
  for (let i = 1; i <= 9; i++) {
    const t = (i / 9) * (Math.PI / 2)
    profile.push([Math.sin(t) * R, (1 - Math.cos(t)) * 1.05])
  }
  const barrel = barrelTop - (tankBottom + 1.05)
  profile.push([R, 1.05 + barrel])
  for (let i = 1; i <= 9; i++) {
    const t = (i / 9) * (Math.PI / 2)
    profile.push([Math.cos(t) * R, 1.05 + barrel + Math.sin(t) * 1.0])
  }
  const tank = revolve(profile, 40, { smooth: SMOOTH.turned })
  translate(tank, [x, z, tankBottom])
  writeInto(writer, 'habShell', cleanMesh(tank))
  // Painted band, then the settlement's name on bracket-mounted plate.
  const band = revolve(
    [
      [R + 0.004, 0],
      [R + 0.026, 0.05],
      [R + 0.026, 1.0],
      [R + 0.004, 1.05],
    ],
    40,
    { smooth: SMOOTH.turned, capStart: false, capEnd: false },
  )
  translate(band, [x, z, tankBottom + 1.9])
  writeInto(writer, 'orange', cleanMesh(band))
  const faceDir = new Vector3(-x, 0, -z).normalize()
  const side = new Vector3(faceDir.z, 0, -faceDir.x)
  const plateAt = new Vector3(x + faceDir.x * (R + 0.62), tankBottom + 2.42, z + faceDir.z * (R + 0.62))
  for (const s of [-1, 1]) {
    const shellR = Math.sqrt(Math.max(0.04, R * R - 1.32 * 1.32))
    const anchor = new Vector3(x, tankBottom + 2.42, z)
      .addScaledVector(side, s * 1.32)
      .addScaledVector(faceDir, shellR + 0.04)
    writer.tube({
      // Lap the bracket 50 mm INTO the backing plate (which spans +0.010 to
      // +0.060 on faceDir); ending exactly at `plateAt` left a 10 mm gap
      // between the bracket tip and the thing it is supposed to carry.
      path: [anchor, plateAt.clone().addScaledVector(side, s * 1.32).addScaledVector(faceDir, 0.05)],
      radius: 0.035,
      slot: 'steel',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
  stencilSign(services, {
    at: plateAt,
    facing: faceDir,
    width: 3.4,
    height: signHeight(3.4),
    lines: ['ELYSIUM', 'WATER'],
    background: '#e6e0d4',
    // The ONLY light plate in the park. Default ink is #efe9dc, which on this
    // ground is 1.08:1 contrast — the name was invisible from the ground.
    ink: '#2a2521',
    accent: '#c94f1d',
  })

  // ---- Riser, overflow, ladder with cage, crown walkway, beacon.
  writer.tube({
    path: [new Vector3(x + 0.45, padTop + 0.02, z), new Vector3(x + 0.45, tankBottom + 0.2, z)],
    radius: 0.2,
    slot: 'aluminum',
    radialSegments: 14,
    capStart: true,
    capEnd: true,
  })
  writer.tube({
    path: [
      new Vector3(x - 0.5, padTop + 0.02, z + 0.2),
      new Vector3(x - 0.5, tankBottom + 3.4, z + 0.2),
      new Vector3(x - 0.9, tankBottom + 3.7, z + 0.2),
    ],
    radius: 0.11,
    slot: 'steel',
    radialSegments: 10,
    capStart: true,
    capEnd: true,
  })
  const ladderAng = 0.26 + (2 * Math.PI) / LEGS
  const ladderDir = new Vector3(Math.cos(ladderAng), 0, Math.sin(ladderAng))
  ladder(
    writer,
    new Vector3(x + ladderDir.x * (legFootR + 0.46), padTop + 0.02, z + ladderDir.z * (legFootR + 0.46)),
    tankBottom + 0.4,
    ladderDir,
    true,
    2.4,
  )
  const walkR = R + 0.75
  const walkY = tankBottom + 1.2
  ringSection(
    writer,
    'deck',
    planCircle(x, z, walkR, 26).map(([px, pz]) => new Vector3(px, walkY, pz)),
    barSection(0.85, 0.04),
  )
  for (const h of [0.53, 1.06]) {
    ringSection(
      writer,
      h > 0.9 ? 'orangeTop' : 'orange',
      planCircle(x, z, walkR + 0.34, 26).map(([px, pz]) => new Vector3(px, walkY + h, pz)),
      barSection(0.036, 0.036),
    )
  }
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2
    const p = new Vector3(x + Math.cos(ang) * (walkR + 0.34), walkY + 0.022, z + Math.sin(ang) * (walkR + 0.34))
    writer.tube({
      path: [p.clone(), p.clone().setY(walkY + 1.08)],
      radius: 0.021,
      slot: 'orange',
      radialSegments: 6,
      capStart: true,
      capEnd: true,
    })
    const brace = new Vector3(x + Math.cos(ang) * (R - 0.55), walkY - 0.62, z + Math.sin(ang) * (R - 0.55))
    writer.tube({
      path: [brace, p.clone().setY(walkY - 0.05)],
      radius: 0.018,
      slot: 'steel',
      radialSegments: 5,
      capStart: true,
      capEnd: true,
    })
  }
  // Vent mast + beacon at the crown.
  writer.tube({
    path: [new Vector3(x, domeTop - 0.14, z), new Vector3(x, mastTop - 0.16, z)],
    radius: 0.08,
    slot: 'steel',
    radialSegments: 10,
    capStart: true,
    capEnd: true,
  })
  const beaconHood = revolve(
    [
      [0, 0.24],
      [0.14, 0.22],
      [0.17, 0.06],
      [0.14, 0.04],
      [0.05, 0.06],
      [0, 0.1],
    ],
    14,
    { axis: 'y', smooth: SMOOTH.turned },
  )
  translate(beaconHood, [x, z, mastTop - 0.16])
  writeInto(writer, 'dark', cleanMesh(beaconHood))
  const beacon = revolve(
    [
      [0, 0],
      [0.09, 0],
      [0.09, 0.11],
      [0, 0.11],
    ],
    12,
    { smooth: SMOOTH.turned },
  )
  translate(beacon, [x, z, mastTop - 0.26])
  writeInto(writer, 'utilityLight', cleanMesh(beacon))

  for (let k = 0; k < LEGS; k++) {
    const foot = legAt(k, 0)
    services.colliders.push({
      kind: 'box',
      center: foot.clone().setY(padTop + 1.2),
      size: new Vector3(0.4, 2.4, 0.4),
      yaw: (k / LEGS) * Math.PI * 2,
    })
  }
  lightFixtures().registerGlowPool({
    id: 'works-water-tower',
    slot: 'utilityLight',
    count: 1,
    position: [x, mastTop, z],
  })
}


// ======================================================= MAINTENANCE YARD

export function buildMaintenanceYard(services: DistrictServices): void {
  const { writer, rng } = services
  const yard = WORKS.maintenanceYard
  const yaw = 0.0
  const outline = planRect(yard.x, yard.z, yaw, 7.5, 5.5, 1.0)
  const padTop = outlineTop(outline, 0.09)
  pouredPad(writer, outline, padTop, 'cast', 'cast', 0.045)

  const yv = (u: number, v: number, y: number): Vector3 =>
    new Vector3(yard.x + v, padTop + y, yard.z + u)

  // ---- Three charge bays under gantry frames.
  const robotNames = ['GK-03', 'GK-04', 'GK-05']
  for (let bay = 0; bay < 3; bay++) {
    const v = -4.3 + bay * 4.3
    // Gantry: two columns, a header, and a braced knee at each corner.
    for (const s of [-1, 1]) {
      const foot = yv(s * 1.5, v, 0.2)
      section(writer, 'steel', [foot, foot.clone().setY(padTop + 3.14)], cSection(0.22, 0.16))
      writer.box({
        center: yv(s * 1.5, v, 0.057),
        size: new Vector3(0.44, 0.114, 0.44),
        slot: 'steelEdge',
        chamfer: 0.014,
      })
      writer.tube({
        path: [yv(s * 1.5, v, 2.45), yv(s * 0.85, v, 3.05)],
        radius: 0.03,
        slot: 'steel',
        radialSegments: 6,
        capStart: true,
        capEnd: true,
      })
    }
    section(
      writer,
      'orange',
      [yv(-1.72, v, 3.22), yv(1.72, v, 3.22)],
      cSection(0.2, 0.16),
    )
    // Cable reel on the header, with a drooping lead to the charge post.
    const reel = revolve(
      [
        [0, 0],
        [0.34, 0],
        [0.34, 0.05],
        [0.28, 0.06],
        [0.28, 0.28],
        [0.34, 0.29],
        [0.34, 0.34],
        [0, 0.34],
      ],
      18,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    const reelAt = yv(0.55, v, 2.86)
    rotateZ(reel, Math.PI / 2)
    translate(reel, [reelAt.x, reelAt.z - 0.17, reelAt.y])
    writeInto(writer, 'dark', cleanMesh(reel))
    writer.box({
      center: reelAt.clone(),
      size: new Vector3(0.56, 0.1, 0.1),
      slot: 'steelEdge',
      chamfer: 0.01,
    })
    writer.tube({
      path: [
        yv(0.55, v + 0.02, 2.6),
        yv(0.9, v + 0.05, 1.8),
        yv(1.05, v + 0.08, 1.05),
        yv(0.98, v + 0.1, 0.72),
      ],
      radius: 0.026,
      slot: 'dark',
      radialSegments: 6,
      capStart: true,
      capEnd: true,
    })
    // Charge post with a lit status lens.
    writer.box({
      center: yv(1.05, v + 0.1, 0.56),
      size: new Vector3(0.3, 1.12, 0.26),
      slot: 'steel',
      chamfer: 0.02,
    })
    writer.box({
      center: yv(1.05, v - 0.05, 0.56),
      size: new Vector3(0.05, 0.5, 0.19),
      slot: 'dark',
      chamfer: 0.008,
    })
    writer.box({
      center: yv(1.05, v - 0.086, 0.96),
      size: new Vector3(0.02, 0.07, 0.11),
      slot: 'utilityLight',
    })
    // Drip tray: a rolled-rim steel pan the machine parks on.
    const trayOuter = planRect(yard.x + v, yard.z - 0.35, 0, 0.95, 0.8, 0.45)
    const trayInner = insetPoly(trayOuter, 0.06)
    for (let i = 0; i < trayOuter.length; i++) {
      const j = (i + 1) % trayOuter.length
      const a = new Vector3(trayInner[i][0], padTop + 0.008, trayInner[i][1])
      const b = new Vector3(trayInner[j][0], padTop + 0.008, trayInner[j][1])
      const c = new Vector3(trayOuter[j][0], padTop + 0.055, trayOuter[j][1])
      const d = new Vector3(trayOuter[i][0], padTop + 0.055, trayOuter[i][1])
      writer.quad('dark', a, b, c, d)
    }
    // Bay number on the pad edge.
    stencilSign(services, {
      at: yv(2.35, v, 0.5),
      facing: new Vector3(0, 0, -1),
      width: 0.9,
      height: signHeight(0.9),
      lines: [`BAY ${bay + 1}`],
      widthPx: 384,
      // Nothing behind and nothing below: this plate hung in mid-air 0.37 m
      // over the pad until it got posts.
      legsToY: padTop,
    })
    services.colliders.push({
      kind: 'box',
      center: yv(0, v, 1.6),
      size: new Vector3(0.3, 3.2, 0.3),
      yaw: 0,
    })

    // The parked machine itself.
    const robot = buildDockedRobot(robotNames[bay])
    robot.position.copy(yv(-0.35, v, 0.006))
    robot.rotation.y = Math.PI + rng.range(-0.05, 0.05)
    robot.name = `works:docked:${robotNames[bay]}`
    services.group.add(robot)
  }

  // ---- Tool cribs: two ribbed cabinets with real doors and handles.
  for (let i = 0; i < 2; i++) {
    const v = -3.4 + i * 2.8
    const u = 6.0
    const centre = yv(u, v, 1.05)
    writer.box({
      center: centre,
      size: new Vector3(1.05, 2.1, 2.35),
      rotationY: 0,
      slot: 'steel',
      chamfer: 0.03,
    })
    for (const s of [-1, 1]) {
      writer.box({
        center: yv(u + s * 0.57, v - 0.53, 1.02),
        size: new Vector3(0.05, 1.86, 1.06),
        slot: 'habShell',
        chamfer: 0.014,
      })
      writer.tube({
        path: [yv(u + s * 0.12, v - 0.57, 1.34), yv(u + s * 0.12, v - 0.57, 0.94)],
        radius: 0.018,
        slot: 'steelEdge',
        radialSegments: 8,
        capStart: true,
        capEnd: true,
      })
    }
    for (let k = 0; k < 8; k++) {
      writer.box({
        center: yv(u - 1.0 + k * 0.28, v + 0.53, 1.05),
        size: new Vector3(0.06, 1.9, 0.06),
        slot: 'steelEdge',
        chamfer: 0.008,
      })
    }
    writer.box({
      center: yv(u, v, 2.16),
      size: new Vector3(1.15, 0.08, 2.45),
      slot: 'steelEdge',
      chamfer: 0.016,
    })
    services.colliders.push({
      kind: 'box',
      center: centre.clone(),
      size: new Vector3(1.15, 2.2, 2.45),
      yaw: 0,
    })
  }

  // ---- Spare wheel rack: an A-frame carrying four real wheels.
  {
    const u = 3.2
    const v = 4.6
    for (const s of [-1, 1]) {
      const foot = yv(u + s * 0.75, v, 0.02)
      // The two legs stop 100 mm apart so their end caps never coincide.
      section(writer, 'steel', [foot, yv(u + s * 0.05, v, 1.55)], cSection(0.12, 0.09))
    }
    section(writer, 'steel', [yv(u - 0.6, v, 0.72), yv(u + 0.6, v, 0.72)], cSection(0.1, 0.08))
    for (let k = 0; k < 4; k++) {
      const rail = yv(u - 0.62 + k * 0.42, v - 0.2 + (k % 2) * 0.05, 1.0)
      const wheel = revolve(
        [
          [0.06, 0],
          [0.2, 0.01],
          [0.29, 0.03],
          [0.31, 0.06],
          [0.31, 0.14],
          [0.29, 0.17],
          [0.2, 0.19],
          [0.06, 0.2],
          [0.06, 0.16],
          [0.14, 0.14],
          [0.14, 0.06],
          [0.06, 0.04],
        ],
        18,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      translate(wheel, [rail.x - 0.1, rail.z, rail.y])
      writeInto(writer, 'dark', cleanMesh(wheel))
    }
    writer.tube({
      path: [yv(u - 0.75, v - 0.3, 1.02), yv(u + 0.75, v - 0.3, 1.02)],
      radius: 0.024,
      slot: 'steelEdge',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }

  // ---- Task board on twin posts, facing the bays.
  {
    const u = -5.6
    const v = 0.4
    for (const s of [-1, 1]) {
      const foot = yv(u, v + s * 0.8, 0.115)
      writer.tube({
        path: [foot, foot.clone().setY(padTop + 2.05)],
        radius: 0.05,
        slot: 'steel',
        radialSegments: 10,
        capStart: true,
        capEnd: true,
      })
      writer.box({
        center: yv(u, v + s * 0.8, 0.057),
        size: new Vector3(0.26, 0.114, 0.26),
        slot: 'steelEdge',
        chamfer: 0.012,
      })
    }
    stencilSign(services, {
      // The board sits IN FRONT of its posts. At u - 0.06 the plate plane cut
      // straight through both 0.05 m posts and they stood 47 mm proud of the
      // printed face, through the text. u + 0.08 puts the bosses 5 mm into
      // the posts instead.
      at: yv(u + 0.08, v, 1.5),
      facing: new Vector3(0, 0, 1),
      width: 1.85,
      height: signHeight(1.85),
      lines: ['YARD TASK BOARD', 'GK-03 BRUSH SWAP', 'GK-04 CELL 7', 'GK-05 STANDBY'],
      background: '#20211f',
    })
    services.colliders.push({
      kind: 'box',
      center: yv(u, v, 1.1),
      // `yv` sends u to world Z and v to world X, so the board — which spans
      // ±0.8 in v between its posts and is thin in u — is 1.9 m wide on X and
      // 0.3 m thick on Z. The size was authored in (u, v) order: it stood a
      // 1.9 m phantom wall across the yard on Z and left the real board
      // walk-through.
      size: new Vector3(1.9, 2.2, 0.3),
      yaw: 0,
    })
  }

  // ---- Sealed repair patches in the pour: geometry, never a decal.
  for (let i = 0; i < 4; i++) {
    const u = rng.range(-5.5, 5.5)
    const v = rng.range(-6.4, 6.4)
    const rr = rng.range(0.5, 1.05)
    const poly = circle(rr, 9, yard.x + v, yard.z + u).map(
      ([px, pz]) => [px + rng.range(-0.14, 0.14), pz + rng.range(-0.14, 0.14)] as Vec2,
    )
    const patch = prism(poly, padTop + 0.002, padTop + 0.009)
    writeInto(writer, 'dark', cleanMesh(smoothShade(patch, SMOOTH.moulded)))
  }

  stencilSign(services, {
    at: yv(-7.1, -4.3, 1.6),
    facing: new Vector3(0, 0, -1),
    width: 2.4,
    height: signHeight(2.4),
    lines: ['THE WORKS', 'MAINTENANCE', 'YARD'],
    legsToY: padTop,
  })
  lightFixtures().registerGlowPool({
    id: 'works-yard',
    slot: 'utilityLight',
    count: 3,
    position: [yard.x, padTop + 3.2, yard.z],
  })
}

// ========================================================= RADIATOR FIELD

/**
 * Heat-rejection banks in the outer band between the boulevard (r 103) and the
 * rim walk (r 112). Four concentric rows of finned panels in A-frame stands on
 * a common header, with expansion loops at the ends of every run. Nothing
 * reaches the guideway swept volume (r 94.5-99.5) — the field starts at 103.9.
 */
export function buildRadiatorField(services: DistrictServices): void {
  const { writer } = services
  const field = WORKS.radiators
  const theta0 = Math.atan2(field.z, field.x)
  // Rows sit between the boulevard's outer kerb (r 103) and the rim walk's
  // inner edge (r 110.2), with 0.5 m of clearance at each end of the band.
  const radii = [104.4, 105.9, 107.4, 108.9]
  const panels = 9
  const panelW = 1.9
  const panelH = 2.55

  for (let row = 0; row < Math.min(field.rows, radii.length); row++) {
    const R = radii[row]
    const span = (panels * panelW + (panels - 1) * 0.26) / R
    const start = theta0 - span / 2
    const at = (t: number, dr = 0, y = 0): Vector3 => {
      const ang = start + t
      return new Vector3(Math.cos(ang) * (R + dr), y, Math.sin(ang) * (R + dr))
    }
    const headerPath: Vector3[] = []
    for (let i = 0; i <= panels * 3; i++) {
      const p = at((i / (panels * 3)) * span)
      p.y = interiorHeight(p.x, p.z) + 0.46
      headerPath.push(p)
    }
    writer.tube({
      path: headerPath,
      radius: 0.115,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })
    // Return header, 100 mm outboard and level with the panels' top stubs.
    const returnPath = headerPath.map((p) => {
      const q = p.clone().setY(p.y + panelH + 0.5)
      return q.addScaledVector(p.clone().setY(0).normalize(), 0.1)
    })
    writer.tube({
      path: returnPath,
      radius: 0.095,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })

    for (let p = 0; p < panels; p++) {
      const t = ((p + 0.5) * (panelW + 0.26)) / R
      const centre = at(t)
      const ground = interiorHeight(centre.x, centre.z)
      const radial = centre.clone().setY(0).normalize()
      const tangent = new Vector3(-radial.z, 0, radial.x)
      const yaw = Math.atan2(tangent.x, tangent.z)
      const baseY = ground + 0.62
      // Panel core with real fins on both faces.
      writer.box({
        center: centre.clone().setY(baseY + panelH / 2),
        size: new Vector3(0.11, panelH, panelW),
        rotationY: yaw,
        slot: 'aluminum',
        chamfer: 0.012,
      })
      for (let f = 0; f < 22; f++) {
        const off = -panelW / 2 + 0.06 + f * ((panelW - 0.12) / 21)
        for (const s of [-1, 1]) {
          writer.box({
            center: centre
              .clone()
              .addScaledVector(tangent, off)
              .addScaledVector(radial, s * 0.095)
              .setY(baseY + panelH / 2),
            size: new Vector3(0.08, panelH - 0.12, 0.016),
            rotationY: yaw,
            slot: 'aluminum',
            chamfer: 0.003,
          })
        }
      }
      // Top and bottom manifold caps.
      for (const h of [0.0, panelH]) {
        writer.box({
          center: centre.clone().setY(baseY + h),
          size: new Vector3(0.2, 0.13, panelW + 0.08),
          rotationY: yaw,
          slot: 'steel',
          chamfer: 0.014,
        })
      }
      // A-frame stand: two splayed legs, a sill, and a diagonal.
      for (const s of [-1, 1]) {
        const foot = centre
          .clone()
          .addScaledVector(radial, s * 0.5)
          .setY(ground + 0.175)
        section(
          writer,
          'steel',
          [foot, centre.clone().addScaledVector(radial, s * 0.05).setY(baseY + 0.02)],
          cSection(0.13, 0.1),
        )
        writer.box({
          center: foot.clone().setY(ground + 0.062),
          size: new Vector3(0.3, 0.114, 0.3),
          rotationY: yaw,
          slot: 'cast',
          chamfer: 0.012,
        })
      }
      section(
        writer,
        'steel',
        [
          centre.clone().addScaledVector(radial, -0.5).setY(ground + 0.3),
          centre.clone().addScaledVector(radial, 0.5).setY(ground + 0.3),
        ],
        cSection(0.1, 0.08),
      )
      // Panel-to-header stubs.
      for (const h of [0.0, panelH]) {
        writer.tube({
          path: [
            centre.clone().setY(baseY + h),
            centre.clone().addScaledVector(radial, h > 0 ? 0.1 : 0).setY(h > 0 ? baseY + panelH + 0.34 : ground + 0.46),
          ],
          radius: 0.05,
          slot: 'steelEdge',
          radialSegments: 8,
          capStart: true,
          capEnd: true,
        })
      }
    }

    // Expansion loop at the ALONG-plus end of every run.
    const endT = span + 0.9 / R
    const loopBase = at(endT)
    loopBase.y = interiorHeight(loopBase.x, loopBase.z) + 0.46
    const radial = loopBase.clone().setY(0).normalize()
    const tangent = new Vector3(-radial.z, 0, radial.x)
    writer.tube({
      path: [
        headerPath[headerPath.length - 1].clone(),
        loopBase.clone(),
        loopBase.clone().setY(loopBase.y + 1.15),
        loopBase.clone().addScaledVector(tangent, 0.85).setY(loopBase.y + 1.15),
        loopBase.clone().addScaledVector(tangent, 0.85).setY(loopBase.y),
        loopBase.clone().addScaledVector(tangent, 1.7).setY(loopBase.y),
      ],
      radius: 0.115,
      slot: 'steel',
      radialSegments: 12,
      capStart: true,
      capEnd: true,
    })

    const rowMid = at(span / 2)
    const rowTangent = new Vector3(-rowMid.z, 0, rowMid.x).normalize()
    services.colliders.push({
      kind: 'box',
      center: rowMid.setY(interiorHeight(rowMid.x, rowMid.z) + 1.6),
      size: new Vector3(1.5, 3.2, panels * (panelW + 0.26)),
      yaw: Math.atan2(rowTangent.x, rowTangent.z),
    })
  }

  // Pump skid at the field's tangential end — where the buried mains surface.
  {
    const ang = theta0 - 0.135
    const p = new Vector3(Math.cos(ang) * 106.4, 0, Math.sin(ang) * 106.4)
    const ground = interiorHeight(p.x, p.z)
    const yaw = Math.atan2(-Math.sin(ang), -Math.cos(ang))
    writer.box({
      center: p.clone().setY(ground + 0.12),
      size: new Vector3(3.0, 0.24, 2.0),
      rotationY: yaw,
      slot: 'cast',
      chamfer: 0.024,
    })
    writer.box({
      center: p.clone().setY(ground + 0.86),
      size: new Vector3(2.2, 1.28, 1.3),
      rotationY: yaw,
      slot: 'steel',
      chamfer: 0.03,
    })
    for (let i = 0; i < 6; i++) {
      writer.box({
        center: p
          .clone()
          .add(new Vector3(Math.cos(yaw) * 0, 0, 0))
          .setY(ground + 0.4 + i * 0.16),
        size: new Vector3(2.26, 0.07, 0.06),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.006,
      })
    }
    services.colliders.push({
      kind: 'box',
      center: p.clone().setY(ground + 0.86),
      size: new Vector3(2.3, 1.5, 1.4),
      yaw,
    })
    stencilSign(services, {
      at: p.clone().setY(ground + 1.9),
      facing: new Vector3(-Math.cos(ang), 0, -Math.sin(ang)),
      width: 2.2,
      height: signHeight(2.2),
      lines: ['HEAT', 'REJECTION', 'FIELD B'],
      widthPx: 512,
      // Floated 0.4 m above the pump skid with nothing behind it. Legs land
      // on the skid's top face; the 0.45 spread keeps both feet inside that
      // face whatever the skid's yaw resolves to.
      legsToY: ground + 1.5,
      legSpread: 0.45,
    })
  }
}

// ================================================================= ENTRY

export function buildWorks(services: DistrictServices): void {
  buildMachineHall(services)
  buildGallery(services)
  buildReclaimer(services)
  buildTankFarm(services)
  buildWaterTower(services)
  buildMaintenanceYard(services)
  buildRadiatorField(services)

  lightFixtures().registerGlowPool({
    id: 'works-hall',
    slot: 'interiorGlow',
    count: 24,
    position: [HALL.x, FLOOR + CLEAR_SILL, HALL.z],
  })
  lightFixtures().registerGlowPool({
    id: 'works-hall-highbay',
    slot: 'utilityLight',
    count: 8,
    position: [HALL.x, FLOOR + 6, HALL.z],
  })
}

/**
 * The ops room's inside dimensions, for `opsInterior.ts`. The interior derives
 * its frame from `services.opsAnchor` (floor centre + hall yaw) and its
 * extents from here, so moving the room never leaves the furniture behind.
 */
export const OPS_ROOM = {
  /** half length along the hall axis, to the wall INNER face */
  halfAlong: OPS_HALF_A - OPS_WALL_T,
  /** half width across, to the wall INNER face */
  halfAcross: OPS_INNER_C,
  /** floor to ceiling */
  height: OPS_H,
  /** the door bay in the window wall, in ACROSS coordinates */
  doorBay: [-1.42, -0.47] as [number, number],
} as const

// ================================================= PLAZA ELEVATION (trim)

/**
 * THE PLAZA ELEVATION — the missing middle scale on the two faces the park
 * actually sees.
 *
 * From the First Tree plaza the hall presents its ACROSS-minus long wall (its
 * outward normal is 30 degrees off the sightline) and its ALONG-plus gable
 * (60 degrees). Both were profiled sheeting and nothing else: the long wall
 * ran ONE unbroken band from the slab to the clerestory sill, broken only by
 * the two doors, and the gable ran a SINGLE sheet from 0.02 up to the rake —
 * 130 m2 with no opening, no fastener row and no horizontal datum anywhere on
 * it. The ribs are real geometry, but their 340 mm pitch is sub-pixel at 75 m,
 * so the elevation had detail at 0.34 m and at 26 m and nothing in between.
 * That gap is what reads as a flat white shed; the sheeting was never the
 * problem and its albedo is not off the ladder (painted steel 0.79-0.81 sits
 * with habShell 0.73-0.79, which is where white painted cladding belongs).
 *
 * The fix is one CAST-ISRU trim system — plinth with a projecting coping,
 * string course, pilasters, panel ribs — every part in the `cast` slot:
 *
 *  - ONE slot lets the family weld into itself for free (the audit's clash
 *    pass compares merged per-slot meshes), so a pilaster runs THROUGH the
 *    plinth instead of being chopped at it, and a gable post runs through the
 *    string course.
 *  - Cast mineral is albedo 0.44-0.50 against the sheeting's 0.79-0.81, so
 *    the base is a real tonal step and not a 13 % modulation that the tone
 *    map eats (notes S14: "ground art needs GEOMETRY" — so does wall art, and
 *    this is both).
 *  - Everything is APPLIED over the sheeting, bearing on its crests. No
 *    existing run is re-cut, so no opening can be left unclad, and every part
 *    stands at least 6 mm clear of the crest face (|c| 7.542 / a 13.042) —
 *    a cross-slot pair here is never coplanar and never interpenetrates.
 *  - Every run stops at every opening and every wall-mounted fixture it would
 *    otherwise cross, from a gap list built off those parts' own constants.
 *
 * Trim planes, measured OUTWARD from the cladding line (|c| = HALF_C on the
 * long wall, a = HALF_A on the gable, where the sheeting occupies -0.016 ..
 * +0.042). Each family gets its OWN back and front plane, 4 mm apart, so the
 * same-slot family cannot produce a coplanar same-facing pair either.
 */
const TRIM_REVEAL = 0.006
/** The corner angles' inboard faces — the trim dies into them (see the corner
 *  flashing outline in `buildMachineHall`: a 12.8 / |c| 7.3). */
const CORNER_STOP_A = 12.8
const CORNER_STOP_C = 7.3
const PLINTH_BACK = 0.048
const PLINTH_FACE = 0.066
const PLINTH_TOE = 0.082
const COPE_OUT = 0.098
/** Coping soffit / top. The soffit clears the PERSONNEL plate (top 2.26). */
const PLINTH_SOFFIT = 2.28
const PLINTH_TOP = 2.42
const RIB_BACK = 0.062
const RIB_FACE = 0.078
const PIL_BACK = 0.052
const PIL_FACE = 0.074
const BAND_BACK = 0.056
const BAND_FACE = 0.086
const BAND_NOSE = 0.096
/** The string course lands on the third girt: a flashing needs steel behind. */
const BAND_H = GIRT_H[2]
/** Structural bay pitch — the ONLY rhythm on this building. */
const BAY_PITCH = (FRAME_A[FRAME_A.length - 1] - FRAME_A[0]) / (FRAME_A.length - 1)
/**
 * The gable is a wind-post wall: the same bay, re-divided across the 15 m
 * span so the posts land on whole divisions instead of a carried-over pitch.
 */
const GABLE_BAYS = Math.max(2, Math.round((2 * HALF_C) / BAY_PITCH))
const GABLE_STATIONS = Array.from(
  { length: GABLE_BAYS + 1 },
  (_, i) => -HALF_C + (i * 2 * HALF_C) / GABLE_BAYS,
)

/** A run of trim in an elevation's own run coordinate. */
type TrimSpan = [number, number]

/**
 * One elevation, expressed in a single run coordinate `u` (a along the long
 * wall, c across the gable) plus an outward offset `o` from the cladding line.
 */
interface TrimFace {
  /** plan point at (run coordinate, outward offset) */
  plan: (u: number, o: number) => Vec2
  /** the sweep path's world point at (run coordinate, height above FLOOR) */
  at: (u: number, h: number) => Vector3
  u0: number
  u1: number
  /** bay stations INCLUDING the two end frames; posts and ribs derive from it */
  stations: number[]
  plinthGaps: TrimSpan[]
  bandGaps: TrimSpan[]
  /** pilaster head, above FLOOR */
  postTop: number
}

/**
 * `[u0, u1]` minus the gaps, dropping anything shorter than `min`: two gaps
 * that nearly touch (the roll-up door and the HVAC set beside it) would
 * otherwise leave a 130 mm stub of coping, which is a defect, not a panel.
 */
function trimSpans(u0: number, u1: number, gaps: TrimSpan[], min = 0.45): TrimSpan[] {
  const out: TrimSpan[] = []
  let cursor = u0
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 - cursor >= min) out.push([cursor, g0])
    cursor = Math.max(cursor, g1)
  }
  if (u1 - cursor >= min) out.push([cursor, u1])
  return out
}

/**
 * Precast plinth, drawn as ONE section: a projecting toe at the pour, a plumb
 * panel face, and a coping whose soffit carries a real 12 mm throat so the
 * drip is geometry and not a painted line. Two horizontal shadow lines out of
 * one sweep — the toe head at 78 mm and the coping soffit at 2.28 — which is
 * the whole point of the exercise. Nothing here is an albedo band: the tone
 * map eats those (notes S14).
 */
function plinthProfile(): Vector2[] {
  return [
    new Vector2(PLINTH_BACK, 0.02),
    new Vector2(PLINTH_TOE - 0.006, 0.02),
    new Vector2(PLINTH_TOE, 0.03),
    new Vector2(PLINTH_TOE, 0.078),
    new Vector2(PLINTH_FACE, 0.098),
    new Vector2(PLINTH_FACE, PLINTH_SOFFIT),
    new Vector2(PLINTH_FACE + 0.01, PLINTH_SOFFIT),
    new Vector2(PLINTH_FACE + 0.01, PLINTH_SOFFIT + 0.012),
    new Vector2(PLINTH_FACE + 0.022, PLINTH_SOFFIT + 0.012),
    new Vector2(PLINTH_FACE + 0.022, PLINTH_SOFFIT),
    new Vector2(COPE_OUT, PLINTH_SOFFIT),
    new Vector2(COPE_OUT, PLINTH_TOP - 0.048),
    new Vector2(COPE_OUT - 0.012, PLINTH_TOP - 0.036),
    new Vector2(PLINTH_BACK, PLINTH_TOP),
  ]
}

/** Cast string course over the sheeting joint: drip nose low, weathered top. */
function bandProfile(): Vector2[] {
  return [
    new Vector2(BAND_BACK, BAND_H - 0.07),
    new Vector2(BAND_NOSE, BAND_H - 0.07),
    new Vector2(BAND_NOSE, BAND_H - 0.044),
    new Vector2(BAND_FACE, BAND_H - 0.032),
    new Vector2(BAND_FACE, BAND_H + 0.044),
    new Vector2(BAND_BACK, BAND_H + 0.076),
  ]
}

/**
 * Pilaster / wind post: a three-ring loft whose top ring is inset on all
 * three exposed sides, so the head weathers back into the wall instead of
 * ending in a raw slab face (the inset-end-station idiom, geometry-craft
 * §4.2's scroll arms). Width covers `portalFrame`'s 190 mm column flange with
 * a 65 mm cover return each side.
 */
function castPost(
  writer: PartWriter,
  face: TrimFace,
  u: number,
  halfWidth: number,
  h0: number,
  h1: number,
): void {
  const splay = 0.09
  const ring = (w: number, front: number, h: number): Vec3[] =>
    [
      face.plan(u - w, front),
      face.plan(u + w, front),
      face.plan(u + w, PIL_BACK),
      face.plan(u - w, PIL_BACK),
    ].map(([x, z]) => [x, z, FLOOR + h] as Vec3)
  const md = loft(
    [
      ring(halfWidth, PIL_FACE, h0),
      ring(halfWidth, PIL_FACE, h1 - splay),
      ring(halfWidth - 0.045, PIL_BACK + 0.006, h1),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  writeInto(writer, 'cast', cleanMesh(smoothShade(md, SMOOTH.cast)))
}

/**
 * The plinth's panel rib: what makes a 26 m band read as cast PANELS rather
 * than one extrusion. Its back sits 4 mm inside the plinth face and its head
 * runs 20 mm up into the coping — both same-slot burials, which is exactly
 * the license one material slot buys.
 */
function castRib(writer: PartWriter, face: TrimFace, u: number): void {
  const w = 0.03
  const outline: Vec2[] = [
    face.plan(u - w, RIB_BACK),
    face.plan(u + w, RIB_BACK),
    face.plan(u + w, RIB_FACE - 0.006),
    face.plan(u + w - 0.006, RIB_FACE),
    face.plan(u - w + 0.006, RIB_FACE),
    face.plan(u - w, RIB_FACE - 0.006),
  ]
  const md = prism(outline, FLOOR + 0.098, FLOOR + PLINTH_SOFFIT + 0.02)
  writeInto(writer, 'cast', cleanMesh(smoothShade(md, SMOOTH.cast)))
}

/** Midpoint of every consecutive station pair — the half-bay panel module. */
function midStations(stations: number[]): number[] {
  return stations.slice(1).map((v, i) => (v + stations[i]) / 2)
}

export function buildPlazaElevation(services: DistrictServices): void {
  const { writer } = services

  const wall: TrimFace = {
    plan: (u, o) => hallPlan(u, -(HALF_C + o)),
    at: (u, h) => hv(u, -HALF_C, h),
    u0: -(CORNER_STOP_A - TRIM_REVEAL),
    u1: CORNER_STOP_A - TRIM_REVEAL,
    stations: FRAME_A,
    plinthGaps: [
      // Both leaves plus their thresholds, which run wider than the jambs.
      [PERSON_DOOR.a0 - 0.21, PERSON_DOOR.a1 + 0.21],
      [ROLL_DOOR.a0 - 0.17, ROLL_DOOR.a1 + 0.17],
      // The HVAC sets: casing 1.9 m long, brackets and cowl inside that.
      ...HVAC_A.map((a) => [a - 1.02, a + 1.02] as TrimSpan),
    ],
    // At 4.9 m the band clears the HVAC (top 3.25) and the hall number (3.78),
    // so it splits ONLY where the roll-up door's head beam crosses it.
    bandGaps: [[ROLL_DOOR.a0 - 0.24, ROLL_DOOR.a1 + 0.24]],
    // The cable tray at 5.55 owns this wall above the string course, so the
    // covers die 12 mm under it rather than being chopped around the tray.
    postTop: BAND_H - 0.082,
  }

  const gable: TrimFace = {
    plan: (u, o) => hallPlan(HALF_A + o, u),
    at: (u, h) => hv(HALF_A, u, h),
    u0: -(CORNER_STOP_C - TRIM_REVEAL),
    u1: CORNER_STOP_C - TRIM_REVEAL,
    stations: GABLE_STATIONS,
    plinthGaps: [],
    // The reclaimer's pipe escutcheon (buildReclaimer) lands on this gable at
    // c 2.4, 620 mm wide, top 4.9 — the string course stops either side of it.
    bandGaps: [[2.4 - 0.34, 2.4 + 0.34]],
    // No tray on the gable: the posts run up to the eaves datum instead, so
    // the head line carries round the corner from the long wall's fascia.
    postTop: WALL_TOP - 0.07,
  }

  // Both sweeps take `section`'s default 34-degree crease: every turn in these
  // two profiles is 45 degrees or sharper except the coping's two-facet
  // weathering, which is meant to read as one continuous slope.
  for (const face of [wall, gable]) {
    const plinths = trimSpans(face.u0, face.u1, face.plinthGaps)
    for (const [s0, s1] of plinths) {
      section(writer, 'cast', [face.at(s0, 0), face.at(s1, 0)], plinthProfile())
    }
    for (const [s0, s1] of trimSpans(face.u0, face.u1, face.bandGaps)) {
      section(writer, 'cast', [face.at(s0, 0), face.at(s1, 0)], bandProfile())
    }
    // Column covers on every INTERIOR bay station: the two end frames are
    // already expressed by the corner angles, and a cover there would run
    // into them (the no-double-emitted-pilaster rule, geometry-craft §4.1).
    for (const u of face.stations.slice(1, -1)) {
      // h0 = 0.014, NOT the plinth's own 0.02: the cover laps the plinth by
      // ~22 mm of depth, so starting both at one height put their two
      // DOWNWARD faces in one plane — 7 same-facing pairs, 458 cm². The post
      // now bears 6 mm lower than the plinth panel (the stack rule: no two
      // members of a stack may end at the same height), which also reads
      // correctly, a column cover carrying down past the precast. Both are
      // 'cast', so the 6 mm bite welds instead of clashing; and 14 mm still
      // leaves a real shadow reveal at the pour, so nothing lands on the
      // apron's plane either.
      castPost(writer, face, u, 0.16, 0.014, face.postTop)
    }
    // A rib only where the plinth it belongs to actually exists.
    for (const u of midStations(face.stations)) {
      if (plinths.some(([s0, s1]) => u - 0.05 > s0 && u + 0.05 < s1)) castRib(writer, face, u)
    }
  }
}
