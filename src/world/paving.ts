import { Group, Vector2, Vector3 } from 'three'
import type { Material } from 'three'
import { soilBed } from '../materials/library'
import {
  createBezelMaterial,
  createChannelMaterial,
  createConcreteMaterial,
  createLensMaterial,
  createPavingMaterial,
} from './groundMaterials'
import { GroundWriter, sweepSection } from './groundWriter'
import type { GroundVertex, SweepStation } from './groundWriter'
import { groundGrade, spurTrackDatum, throatCrown, throatLift } from './interiorHeight'
import {
  CURB,
  GUIDEWAY_CHANNEL,
  PAVE,
  PAVED_REGIONS,
  PLANTER,
  PLANTERS,
  THROAT,
  coveringRegion,
  insideGuidewayChannel,
  insidePlanter,
  insideSpurCorridor,
  pavedSignedDistance,
  pavedTraffic,
  regionDistance,
  spurCorridorDistance,
  throatBridge,
  throatU,
  throatUOpen,
} from './pavingPlan'
import type { Region } from './pavingPlan'

/**
 * THE PAVED CIVIC FLOOR — geometry.
 *
 * Real modelled surface, never decals: every paved region is a slab whose top
 * sits `PAVE.rise` over the regolith grade, edged with precast white curbs,
 * lined with raised planters and studded with embedded floor lights, and the
 * tram's channel is recessed into it so the track agent can inset rails flush.
 *
 * Overlap policy (the one rule that keeps this z-fight free): paved regions are
 * PRIORITISED, and a lower-priority slab is CLIPPED to the part no
 * higher-priority pour covers — cell by cell, on the neighbour's own emitted
 * boundary (see "THE TRIM" below). Two slabs never stack at the same datum, and
 * because the cut runs along the neighbour's own vertices the junction closes
 * with no gap — a spoke butts the plaza on the plaza's own edge.
 *
 * Proven, not asserted: `tools/paving-coverage.mjs` rasters the union of the
 * paved plan and counts how many triangles cover each sample. It must be
 * exactly one everywhere; 0 is a hole in a walkable floor and >1 is a z-fight.
 *
 * Material slots emitted here:
 *   paving       polished sintered-regolith panels
 *   concrete     curbs, planter walls + copings
 *   channel      the recessed tram channel and its lips
 *   pathLightBezel  alloy housings of the embedded floor lights
 *   pathLight    EMISSIVE lenses (the lighting agent owns the level)
 *   plantSoil    planter fill surfaces
 */

export interface PavingColliderSpec {
  center: Vector3
  size: Vector3
  yaw: number
}

export interface PavingBuild {
  group: Group
  /** Planter walls — solid enough to lean on, so physics must know. */
  colliders: PavingColliderSpec[]
  triangles: number
}

/** The slab top at a point: the ONE definition of the paved datum. Carries
 *  the throat's grade conform — around the turnout the fields are graded to
 *  the street (interiorHeight.throatLift), so tiles meet the edging strips
 *  flush instead of stepping the natural cross-fall at them. */
export function slabTop(x: number, z: number): number {
  return groundGrade(x, z) + PAVE.rise + throatLift(x, z)
}

const NORMAL_EPS = 1.1

function slabNormal(x: number, z: number, out: Vector3): Vector3 {
  const base = groundGrade(x, z)
  const dx = groundGrade(x + NORMAL_EPS, z) - base
  const dz = groundGrade(x, z + NORMAL_EPS) - base
  return out.set(-dx / NORMAL_EPS, 1, -dz / NORMAL_EPS).normalize()
}

interface PaveVertex {
  x: number
  z: number
  /** Panel coordinates in metres (joints land on multiples of PAVE.panel). */
  u: number
  v: number
  /** Distance to this region's own paved edge. */
  edge: number
  /** Coordinate parallel to the nearest edge — the border course runs on it. */
  along: number
}

function toGroundVertex(vertex: PaveVertex): GroundVertex {
  const y = slabTop(vertex.x, vertex.z)
  return {
    p: new Vector3(vertex.x, y, vertex.z),
    n: slabNormal(vertex.x, vertex.z, new Vector3()),
    uv: new Vector2(vertex.u, vertex.v),
    pav: new Vector3(
      Math.max(0, vertex.edge),
      vertex.along,
      pavedTraffic(vertex.x, vertex.z),
    ),
  }
}

const TAU = Math.PI * 2

// ------------------------------------------------------------- trimming ----

/**
 * THE TRIM. A slab covers its region MINUS every higher-priority pour, and the
 * junction has to close with neither a gap nor a stacked surface. Two rules
 * make that true by construction:
 *
 *  1. CUT, NEVER PROJECT. The old scheme pushed each covered corner onto the
 *     covering region's boundary and dropped a cell only when all four corners
 *     named the SAME region. Projection is many-to-one — it collapses area onto
 *     a curve — so every cell deep inside a neighbouring pour came back as a
 *     stretched triangle lying across the cells that legitimately paved there
 *     (145 m² of same-slot z-fight), and any cell straddling two pours survived
 *     with its corners on two different boundaries. Instead each cell is CLIPPED
 *     (marching squares over `coverDistance`): cells inside the neighbour vanish,
 *     cells outside are untouched, and a crossed cell is cut on the boundary
 *     itself. Two cells sharing an edge bisect the same edge for the same
 *     crossing, so the cut is watertight without any welding.
 *  2. CUT AGAINST THE NEIGHBOUR'S MESH, NOT AGAINST THE PLAN. A curved pour
 *     emits an inscribed polygon, so stopping on the plan's ideal circle leaves
 *     a crescent of bare regolith up to a sagitta wide (27 mm at an apron ring).
 *     `surfaceSigned` measures against the polygon the neighbour really emits,
 *     and `footprintWalk` threads that polygon's own vertices into the cut, so
 *     the two surfaces share an identical edge.
 */

/** Pours this one must yield to. Same order `coveringRegion` applies. */
function outrankingRegions(region: Region): Region[] {
  return PAVED_REGIONS.filter((other) => other.priority > region.priority)
}

/** Panels per ring at this radius, so a ring band's panels stay near-square. */
function ringPanels(radius: number): number {
  return Math.max(6, Math.round((TAU * radius) / PAVE.panel))
}

interface PolarBand {
  r0: number
  r1: number
  /** Quads around the full circle. */
  angularSteps: number
  radialSteps: number
  vScale: number
}

/**
 * The ring bands of a polar surface — the ONE definition, read by the mesh and
 * by the trim field, so the polygon a neighbour is cut against can never drift
 * from the polygon this surface emits.
 *
 * Ring joints land on multiples of PAVE.panel measured from the centre; radial
 * joints subdivide each band into whole panels, and `vScale` is authored so
 * those land on multiples of PAVE.panel too — one shader, no per-surface
 * branching, joint widths still true metres.
 *
 * The MESH, however, is subdivided at ONE angular step for the whole surface.
 * A band that carried its own step count met its neighbour as two inscribed
 * polygons of different fineness on the same circle, and the crescent between
 * those two chords was a real slot of bare regolith 75 mm down — 67 mm wide at
 * the plaza's r = 6.5 seam, ~20 m² of open floor across the park. Joints are
 * drawn by the shader from `uv`, so holding the panel count in `vScale` alone
 * keeps the pattern exactly as authored while every seam closes on shared
 * vertices. It costs ~2 k triangles, all of them in the inner rings.
 */
function polarBands(rInner: number, rOuter: number): PolarBand[] {
  const bands: PolarBand[] = []
  const firstBand = Math.floor(rInner / PAVE.panel)
  const lastBand = Math.ceil(rOuter / PAVE.panel)
  let angularSteps = 0
  for (let band = firstBand; band < lastBand; band++) {
    const r0 = Math.max(rInner, band * PAVE.panel)
    const r1 = Math.min(rOuter, (band + 1) * PAVE.panel)
    if (r1 - r0 < 0.02) continue
    const panels = ringPanels((r0 + r1) * 0.5)
    angularSteps = Math.max(angularSteps, panels * 2)
    bands.push({
      r0,
      r1,
      angularSteps: 0,
      radialSteps: Math.max(1, Math.round((r1 - r0) / 1.7)),
      vScale: (panels * PAVE.panel) / TAU,
    })
  }
  for (const band of bands) band.angularSteps = angularSteps
  return bands
}

/** The footprint a region's MESH occupies (curves as the emitted polygon). */
type Footprint =
  | {
      kind: 'ring'
      cx: number
      cz: number
      rOuter: number
      outerSteps: number
      /** 0 for a disc. */
      rInner: number
      innerSteps: number
    }
  | { kind: 'plan'; region: Region }

const footprints = new Map<Region, Footprint>()

function footprintOf(region: Region): Footprint {
  const cached = footprints.get(region)
  if (cached) return cached
  let footprint: Footprint
  if (region.kind === 'annulus' && region.id === 'guideway-channel') {
    // The channel's mesh reaches past the plan: its chamfered LIPS climb from
    // the recess back up to the slab top `GUIDEWAY_CHANNEL.lip` outside the
    // channel proper. Paving to the plan's edge buries that arris under 90 mm
    // of overhanging slab, which is exactly the raw cut the lip exists to avoid.
    const steps = Math.round((TAU * GUIDEWAY_CHANNEL.radius) / 1.4)
    footprint = {
      kind: 'ring',
      cx: region.cx,
      cz: region.cz,
      rOuter: region.rOuter + GUIDEWAY_CHANNEL.lip,
      outerSteps: steps,
      rInner: region.rInner - GUIDEWAY_CHANNEL.lip,
      innerSteps: steps,
    }
  } else if (region.kind === 'disc') {
    const bands = polarBands(0, region.radius)
    footprint = {
      kind: 'ring',
      cx: region.cx,
      cz: region.cz,
      rOuter: region.radius,
      outerSteps: bands[bands.length - 1].angularSteps,
      rInner: 0,
      innerSteps: 0,
    }
  } else if (region.kind === 'annulus') {
    const bands = polarBands(region.rInner, region.rOuter)
    footprint = {
      kind: 'ring',
      cx: region.cx,
      cz: region.cz,
      rOuter: region.rOuter,
      outerSteps: bands[bands.length - 1].angularSteps,
      rInner: region.rInner,
      innerSteps: bands[0].angularSteps,
    }
  } else {
    // A rect's edges are straight and a ribbon's strip is its own polyline:
    // for those the plan IS the mesh.
    footprint = { kind: 'plan', region }
  }
  footprints.set(region, footprint)
  return footprint
}

/** Signed distance to a regular N-gon inscribed in a circle; > 0 outside. */
function ngonSigned(
  cx: number,
  cz: number,
  radius: number,
  steps: number,
  x: number,
  z: number,
): number {
  const step = TAU / steps
  const apothem = radius * Math.cos(step / 2)
  const dx = x - cx
  const dz = z - cz
  const r = Math.hypot(dx, dz)
  if (r < 1e-9) return -apothem
  const angle = Math.atan2(dz, dx)
  // Offset from the mid-angle of the edge facing this point: r·cos(offset) is
  // the point's distance along that edge's own normal.
  const offset = angle - (Math.floor(angle / step) + 0.5) * step
  return r * Math.cos(offset) - apothem
}

/** Signed distance to the surface a region emits; > 0 = not covered by it. */
function surfaceSigned(region: Region, x: number, z: number): number {
  const footprint = footprintOf(region)
  if (footprint.kind === 'plan') return regionDistance(footprint.region, x, z)
  const outer = ngonSigned(
    footprint.cx,
    footprint.cz,
    footprint.rOuter,
    footprint.outerSteps,
    x,
    z,
  )
  if (footprint.innerSteps === 0) return outer
  const inner = ngonSigned(
    footprint.cx,
    footprint.cz,
    footprint.rInner,
    footprint.innerSteps,
    x,
    z,
  )
  return Math.max(outer, -inner)
}

/** > 0 where no outranking pour covers the point: this slab's to pave. */
function coverDistance(cover: Region[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (const region of cover) {
    const d = surfaceSigned(region, x, z)
    if (d < best) best = d
  }
  return best
}

/** The outranking pour whose edge is nearest — whose boundary a cut lies on. */
function coverRegionAt(cover: Region[], x: number, z: number): Region | null {
  let best = Number.POSITIVE_INFINITY
  let which: Region | null = null
  for (const region of cover) {
    const d = surfaceSigned(region, x, z)
    if (d < best) {
      best = d
      which = region
    }
  }
  return which
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** A cut vertex at a world point, carrying attributes lerped along the cut. */
function cutPoint(from: PaveVertex, to: PaveVertex, x: number, z: number): PaveVertex {
  const span = Math.hypot(to.x - from.x, to.z - from.z)
  const t = span < 1e-9 ? 0 : clamp01(Math.hypot(x - from.x, z - from.z) / span)
  return {
    x,
    z,
    u: from.u + (to.u - from.u) * t,
    v: from.v + (to.v - from.v) * t,
    // On the effective paved edge: the border course runs along the junction
    // exactly as it runs along a free edge.
    edge: 0,
    along: from.along + (to.along - from.along) * t,
  }
}

/**
 * The covering region's OWN boundary vertices strictly between two cut points,
 * in that order. Threading them into the cut is what makes the junction exact:
 * a straight chord across them would ride up to a sagitta inside the neighbour
 * (overlap) or outside it (a hairline of bare regolith).
 */
function footprintWalk(region: Region, from: PaveVertex, to: PaveVertex): PaveVertex[] {
  // Both ends must sit on THIS region's edge, or the cell straddles a triple
  // junction and there is no single boundary to follow.
  if (
    Math.abs(surfaceSigned(region, from.x, from.z)) > 2e-3 ||
    Math.abs(surfaceSigned(region, to.x, to.z)) > 2e-3
  ) {
    return []
  }
  const footprint = footprintOf(region)
  const out: PaveVertex[] = []
  const push = (x: number, z: number): void => {
    // A boundary vertex landing within a couple of centimetres of a cut point
    // buys nothing — the chord it would correct deviates by microns — and it
    // costs a sliver so thin that `GroundWriter.face` takes a meaningless face
    // normal from it, fails to ear-clip, and falls back to a fan that folds one
    // triangle INSIDE OUT (invisible, and a z-fight the coplanar gate cannot
    // see because it reads normals from the attribute).
    if (Math.hypot(x - from.x, z - from.z) < 0.02) return
    if (Math.hypot(x - to.x, z - to.z) < 0.02) return
    out.push(cutPoint(from, to, x, z))
  }
  if (footprint.kind === 'ring') {
    const rFrom = Math.hypot(from.x - footprint.cx, from.z - footprint.cz)
    const rTo = Math.hypot(to.x - footprint.cx, to.z - footprint.cz)
    const onOuter = (r: number): boolean =>
      footprint.innerSteps === 0 ||
      Math.abs(r - footprint.rOuter) <= Math.abs(r - footprint.rInner)
    if (onOuter(rFrom) !== onOuter(rTo)) return []
    const radius = onOuter(rFrom) ? footprint.rOuter : footprint.rInner
    const steps = onOuter(rFrom) ? footprint.outerSteps : footprint.innerSteps
    const step = TAU / steps
    const a0 = Math.atan2(from.z - footprint.cz, from.x - footprint.cx)
    const a1 = Math.atan2(to.z - footprint.cz, to.x - footprint.cx)
    let delta = a1 - a0
    while (delta > Math.PI) delta -= TAU
    while (delta < -Math.PI) delta += TAU
    const vertexAt = (angle: number): void => {
      push(footprint.cx + Math.cos(angle) * radius, footprint.cz + Math.sin(angle) * radius)
    }
    if (delta > 0) {
      for (let j = Math.floor(a0 / step) + 1; j * step < a0 + delta && out.length < 64; j++) {
        vertexAt(j * step)
      }
    } else {
      for (let j = Math.ceil(a0 / step) - 1; j * step > a0 + delta && out.length < 64; j--) {
        vertexAt(j * step)
      }
    }
    return out
  }
  if (footprint.region.kind !== 'rect') return []
  const rect = footprint.region
  const corners: Array<[number, number]> = [
    [rect.cx - rect.halfX, rect.cz - rect.halfZ],
    [rect.cx + rect.halfX, rect.cz - rect.halfZ],
    [rect.cx + rect.halfX, rect.cz + rect.halfZ],
    [rect.cx - rect.halfX, rect.cz + rect.halfZ],
  ]
  // Perimeter parameter 0..4, one unit per side, corners on the integers.
  const perimeter = (x: number, z: number): number => {
    const left = Math.abs(x - corners[0][0])
    const right = Math.abs(x - corners[1][0])
    const bottom = Math.abs(z - corners[0][1])
    const top = Math.abs(z - corners[2][1])
    const nearest = Math.min(left, right, bottom, top)
    if (nearest === bottom) return clamp01((x - corners[0][0]) / (rect.halfX * 2))
    if (nearest === right) return 1 + clamp01((z - corners[1][1]) / (rect.halfZ * 2))
    if (nearest === top) return 2 + clamp01((corners[2][0] - x) / (rect.halfX * 2))
    return 3 + clamp01((corners[3][1] - z) / (rect.halfZ * 2))
  }
  const t0 = perimeter(from.x, from.z)
  let delta = perimeter(to.x, to.z) - t0
  while (delta > 2) delta -= 4
  while (delta < -2) delta += 4
  if (delta > 0) {
    for (let c = Math.floor(t0) + 1; c < t0 + delta; c++) push(...corners[((c % 4) + 4) % 4])
  } else {
    for (let c = Math.ceil(t0) - 1; c > t0 + delta; c--) push(...corners[((c % 4) + 4) % 4])
  }
  return out
}

// ------------------------------------------------------ region surfaces ----

/** A surface as a continuous parametric patch, plus what outranks it. */
interface Patch {
  cover: Region[]
  at: (u: number, v: number) => PaveVertex
}

/** How far a crossed cell may subdivide before its centre simply decides.
 *  6 (1/64 cell ≈ 2.7 cm on the coarsest fields) — at 4 the terrace dropped
 *  whole cells in the throat's vee tips, where two zone boundaries cross one
 *  cell closer together than an eighth of it. */
const MAX_TRIM_DEPTH = 6
/** Below this a clipped cell is a shading artefact, not a floor (1 cm²). */
const MIN_CELL_AREA = 1e-4

/**
 * SIGNED plan area. A +Y-facing ring is NEGATIVE here (the Y component of the
 * edge cross product is `ez·fx − ex·fz`, the opposite sign to the XZ shoelace),
 * so this both sizes a cell and proves it still faces up: where two cut points
 * land a few millimetres apart on a neighbour's polygon the ring can come back
 * inside-out, and an inside-out sliver is invisible AND a z-fight. The
 * coplanar gate cannot catch that class — it takes each triangle's normal from
 * the vertex attribute, which is authored upward whatever the winding says.
 */
function ringSignedArea(ring: PaveVertex[]): number {
  let doubled = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    doubled += p.x * q.z - q.x * p.z
  }
  return doubled * 0.5
}

function emitRing(writer: GroundWriter, ring: PaveVertex[]): void {
  // Weld coincident neighbours: a disc's pole cell is a triangle, and a cut
  // that lands on a corner must not ship a zero-length edge (GroundWriter takes
  // its face normal from corners 0, 1 and the last, and drops the face if they
  // are collinear).
  const welded: PaveVertex[] = []
  for (const vertex of ring) {
    const previous = welded[welded.length - 1]
    if (previous && Math.hypot(previous.x - vertex.x, previous.z - vertex.z) < 1e-5) continue
    welded.push(vertex)
  }
  while (
    welded.length > 2 &&
    Math.hypot(welded[0].x - welded[welded.length - 1].x, welded[0].z - welded[welded.length - 1].z) < 1e-5
  ) {
    welded.pop()
  }
  if (welded.length < 3 || ringSignedArea(welded) > -MIN_CELL_AREA) return
  writer.face('paving', welded.map(toGroundVertex))
}

/** Bisect a cell edge onto the covering pour's boundary. */
function cutVertex(
  patch: Patch,
  ua: number,
  va: number,
  ub: number,
  vb: number,
  da: number,
): PaveVertex {
  let lo = 0
  let hi = 1
  const ownedAtLo = da > 0
  // 22 halvings of a ≤2 m edge lands inside a micrometre — and the neighbouring
  // cell bisects the SAME edge between the SAME endpoints, so both land on the
  // same point and the cut is watertight.
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5
    const probe = patch.at(ua + (ub - ua) * mid, va + (vb - va) * mid)
    if (coverDistance(patch.cover, probe.x, probe.z) > 0 === ownedAtLo) lo = mid
    else hi = mid
  }
  const t = (lo + hi) * 0.5
  const vertex = patch.at(ua + (ub - ua) * t, va + (vb - va) * t)
  // A cut against the throat zone keeps its interior edge distance: the
  // border course belongs to junctions BETWEEN fields, and painting it
  // along the street cut turned the whole zone boundary into a dark moat
  // (owner arrows). The cut there is buried under the edging strip anyway.
  const against = coverRegionAt(patch.cover, vertex.x, vertex.z)
  if (!against || against.kind !== 'zone') vertex.edge = 0
  return vertex
}

/** Clip one parametric cell to the part this pour owns, and emit it. */
function emitPatchCell(
  writer: GroundWriter,
  patch: Patch,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  depth: number,
): void {
  const pu = [u0, u0, u1, u1]
  const pv = [v0, v1, v1, v0]
  const corner: PaveVertex[] = []
  const owned: boolean[] = []
  let ownedCount = 0
  for (let i = 0; i < 4; i++) {
    const vertex = patch.at(pu[i], pv[i])
    corner.push(vertex)
    const own = coverDistance(patch.cover, vertex.x, vertex.z) > 0
    owned.push(own)
    if (own) ownedCount++
  }

  // Nine samples decide a cell. The four edge midpoints catch a boundary that
  // enters and leaves through ONE edge (marching squares would miss it), and
  // the centre catches both an island of cover inside an untouched cell and a
  // NOTCH between two pours inside a covered one — dropping that notch is how a
  // "drop it if all four corners are covered" rule opens a hole in a floor.
  const centre = patch.at((u0 + u1) / 2, (v0 + v1) / 2)
  const centreOwned = coverDistance(patch.cover, centre.x, centre.z) > 0
  let clean = true
  for (let i = 0; i < 4 && clean; i++) {
    const j = (i + 1) % 4
    const middle = patch.at((pu[i] + pu[j]) / 2, (pv[i] + pv[j]) / 2)
    const middleOwned = coverDistance(patch.cover, middle.x, middle.z) > 0
    if (middleOwned !== owned[i] && middleOwned !== owned[j]) clean = false
  }
  if (ownedCount === 4 && !centreOwned) clean = false
  if (ownedCount === 0 && centreOwned) clean = false
  // A saddle (the two owned corners diagonal) means the boundary crosses the
  // cell twice; subdivide rather than guess which pair of cuts to join.
  if (ownedCount === 2 && owned[0] === owned[2]) clean = false

  if (!clean) {
    if (depth < MAX_TRIM_DEPTH) {
      const um = (u0 + u1) / 2
      const vm = (v0 + v1) / 2
      emitPatchCell(writer, patch, u0, um, v0, vm, depth + 1)
      emitPatchCell(writer, patch, u0, um, vm, v1, depth + 1)
      emitPatchCell(writer, patch, um, u1, v0, vm, depth + 1)
      emitPatchCell(writer, patch, um, u1, vm, v1, depth + 1)
      return
    }
    // Out of subdivisions (a triple junction, at 1/8 of a cell): the centre
    // decides, so the cell is whole or absent — never an unresolvable cut.
    if (centreOwned) emitRing(writer, corner)
    return
  }
  if (ownedCount === 4) {
    emitRing(writer, corner)
    return
  }
  if (ownedCount === 0) return

  const ring: PaveVertex[] = []
  const isCut: boolean[] = []
  const cuts: PaveVertex[] = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    if (owned[i]) {
      ring.push(corner[i])
      isCut.push(false)
    }
    if (owned[i] !== owned[j]) {
      const cut = cutVertex(patch, pu[i], pv[i], pu[j], pv[j], owned[i] ? 1 : -1)
      ring.push(cut)
      isCut.push(true)
      cuts.push(cut)
    }
  }
  // Two cuts on two DIFFERENT pours means those pours cross inside this cell,
  // and a straight chord between the cuts would slice off the wedge between
  // them — a hole at every triple junction. Subdivide onto the corner instead.
  if (
    depth < MAX_TRIM_DEPTH &&
    cuts.length === 2 &&
    coverRegionAt(patch.cover, cuts[0].x, cuts[0].z) !==
      coverRegionAt(patch.cover, cuts[1].x, cuts[1].z)
  ) {
    const um = (u0 + u1) / 2
    const vm = (v0 + v1) / 2
    emitPatchCell(writer, patch, u0, um, v0, vm, depth + 1)
    emitPatchCell(writer, patch, u0, um, vm, v1, depth + 1)
    emitPatchCell(writer, patch, um, u1, v0, vm, depth + 1)
    emitPatchCell(writer, patch, um, u1, vm, v1, depth + 1)
    return
  }
  // Thread the covering pour's own boundary vertices between the cut that
  // leaves this slab and the cut that re-enters it.
  let exit = -1
  for (let i = 0; i < ring.length; i++) {
    if (isCut[i] && !isCut[(i - 1 + ring.length) % ring.length]) {
      exit = i
      break
    }
  }
  if (exit >= 0 && isCut[(exit + 1) % ring.length]) {
    const from = ring[exit]
    const to = ring[(exit + 1) % ring.length]
    const region = coverRegionAt(patch.cover, (from.x + to.x) / 2, (from.z + to.z) / 2)
    if (region) ring.splice(exit + 1, 0, ...footprintWalk(region, from, to))
  }
  emitRing(writer, ring)
}

/** Concentric ring bands (see `polarBands` for how the joints are authored). */
function emitPolarSurface(
  writer: GroundWriter,
  region: Region,
  cx: number,
  cz: number,
  rInner: number,
  rOuter: number,
): void {
  const cover = outrankingRegions(region)
  for (const band of polarBands(rInner, rOuter)) {
    const patch: Patch = {
      cover,
      at: (r: number, angle: number): PaveVertex => {
        const edgeOuter = rOuter - r
        const edgeInner = rInner > 0 ? r - rInner : Number.POSITIVE_INFINITY
        const edge = Math.min(edgeOuter, edgeInner)
        const alongRadius = edgeOuter <= edgeInner ? rOuter : rInner
        return {
          x: cx + Math.cos(angle) * r,
          z: cz + Math.sin(angle) * r,
          u: r,
          v: angle * band.vScale,
          edge,
          along: angle * alongRadius,
        }
      },
    }
    for (let i = 0; i < band.radialSteps; i++) {
      const ra = band.r0 + ((band.r1 - band.r0) * i) / band.radialSteps
      const rb = band.r0 + ((band.r1 - band.r0) * (i + 1)) / band.radialSteps
      for (let j = 0; j < band.angularSteps; j++) {
        // Angular-then-radial: tangential × radial = +Y, so the slab faces up
        // and survives back-face culling.
        emitPatchCell(
          writer,
          patch,
          ra,
          rb,
          (j / band.angularSteps) * TAU,
          ((j + 1) / band.angularSteps) * TAU,
          0,
        )
      }
    }
  }
}

function emitRectSurface(
  writer: GroundWriter,
  region: Region & { kind: 'rect' },
): void {
  const stepsX = Math.max(2, Math.round((region.halfX * 2) / 1.7))
  const stepsZ = Math.max(2, Math.round((region.halfZ * 2) / 1.7))
  const patch: Patch = {
    cover: outrankingRegions(region),
    at: (ix: number, iz: number): PaveVertex => {
      const u = (region.halfX * 2 * ix) / stepsX
      const v = (region.halfZ * 2 * iz) / stepsZ
      const edgeX = Math.min(u, region.halfX * 2 - u)
      const edgeZ = Math.min(v, region.halfZ * 2 - v)
      return {
        x: region.cx - region.halfX + u,
        z: region.cz - region.halfZ + v,
        u,
        v,
        edge: Math.min(edgeX, edgeZ),
        along: edgeX <= edgeZ ? v : u,
      }
    },
  }
  for (let iz = 0; iz < stepsZ; iz++) {
    for (let ix = 0; ix < stepsX; ix++) {
      emitPatchCell(writer, patch, ix, ix + 1, iz, iz + 1, 0)
    }
  }
}

/** Per-station frame of a ribbon: point, unit tangent, unit left normal. */
interface RibbonFrame {
  x: number
  z: number
  tx: number
  tz: number
  nx: number
  nz: number
  run: number
}

function ribbonFrames(line: Vector2[]): RibbonFrame[] {
  const frames: RibbonFrame[] = []
  let run = 0
  for (let i = 0; i < line.length; i++) {
    const previous = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    const tx = next.x - previous.x
    const tz = next.y - previous.y
    const length = Math.hypot(tx, tz) || 1
    if (i > 0) run += line[i].distanceTo(line[i - 1])
    frames.push({
      x: line[i].x,
      z: line[i].y,
      tx: tx / length,
      tz: tz / length,
      nx: -tz / length,
      nz: tx / length,
      run,
    })
  }
  return frames
}

/** A ribbon's free end is radiused; `ribbonBoundary` kerbs it in this many steps. */
const RIBBON_CAP_STEPS = 5

/**
 * The half-disc at a ribbon end. The PLAN measures a ribbon as a distance to
 * its centreline, so its region — the walkable datum, the dust band, the kerb
 * loop — is round-ended; a square-ended surface left the kerb sweeping its
 * radius around bare regolith. Ends that run into another pour are cut away by
 * the trim like any other cell, so this is only ever seen where it should be.
 */
function emitRibbonCap(
  writer: GroundWriter,
  region: Region & { kind: 'ribbon' },
  cover: Region[],
  frame: RibbonFrame,
  atEnd: boolean,
): void {
  const patch: Patch = {
    cover,
    at: (r: number, step: number): PaveVertex => {
      const angle = (step / RIBBON_CAP_STEPS) * Math.PI
      // Matches ribbonBoundary's cap exactly: from the right edge, round the
      // end, to the left edge (mirrored at the start).
      const lateral = (atEnd ? -1 : 1) * Math.cos(angle) * r
      const forward = (atEnd ? 1 : -1) * Math.sin(angle) * r
      return {
        x: frame.x + frame.nx * lateral + frame.tx * forward,
        z: frame.z + frame.nz * lateral + frame.tz * forward,
        u: frame.run + forward,
        v: lateral,
        edge: region.halfWidth - r,
        along: frame.run + forward,
      }
    },
  }
  const radialSteps = Math.max(1, Math.round(region.halfWidth / 1.15))
  for (let i = 0; i < radialSteps; i++) {
    const ra = (region.halfWidth * i) / radialSteps
    const rb = (region.halfWidth * (i + 1)) / radialSteps
    for (let s = 0; s < RIBBON_CAP_STEPS; s++) {
      emitPatchCell(writer, patch, ra, rb, s, s + 1, 0)
    }
  }
}

function emitRibbonSurface(writer: GroundWriter, region: Region & { kind: 'ribbon' }): void {
  const cover = outrankingRegions(region)
  const frames = ribbonFrames(region.line)
  const spans = Math.max(4, Math.round((region.halfWidth * 2) / 1.15))
  const patch: Patch = {
    cover,
    at: (station: number, span: number): PaveVertex => {
      const i = Math.min(frames.length - 2, Math.max(0, Math.floor(station)))
      const t = station - i
      const a = frames[i]
      const b = frames[i + 1]
      const lateral = -region.halfWidth + (region.halfWidth * 2 * span) / spans
      const nx = a.nx + (b.nx - a.nx) * t
      const nz = a.nz + (b.nz - a.nz) * t
      const run = a.run + (b.run - a.run) * t
      return {
        x: a.x + (b.x - a.x) * t + nx * lateral,
        z: a.z + (b.z - a.z) * t + nz * lateral,
        u: run,
        v: lateral,
        edge: region.halfWidth - Math.abs(lateral),
        along: run,
      }
    },
  }
  for (let i = 0; i < frames.length - 1; i++) {
    for (let s = 0; s < spans; s++) {
      emitPatchCell(writer, patch, i, i + 1, s, s + 1, 0)
    }
  }
  emitRibbonCap(writer, region, cover, frames[frames.length - 1], true)
  emitRibbonCap(writer, region, cover, frames[0], false)
}

// -------------------------------------------------------------- borders ----

/** A boundary station: on the region's paved edge, with its outward normal. */
interface BoundaryStation {
  x: number
  z: number
  outX: number
  outZ: number
  /** Mitre widening for sharp corners (geometry-craft §2.2). */
  scale: number
  run: number
}

function circleBoundary(
  cx: number,
  cz: number,
  radius: number,
  outward: number,
): BoundaryStation[] {
  const steps = Math.max(24, Math.round((TAU * radius) / 0.95))
  const stations: BoundaryStation[] = []
  for (let i = 0; i < steps; i++) {
    // The sweep contract needs travel = (−out.z, 0, out.x): that is INCREASING
    // angle for an outward-facing edge and DECREASING for an inward-facing one
    // (the annulus's inner kerb faces the park, not the street).
    const step = outward > 0 ? i : steps - i
    const angle = (step / steps) * TAU
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    stations.push({
      x: cx + cos * radius,
      z: cz + sin * radius,
      outX: cos * outward,
      outZ: sin * outward,
      scale: 1,
      run: angle * radius,
    })
  }
  return stations
}

function rectBoundary(region: Region & { kind: 'rect' }): BoundaryStation[] {
  const corners: Array<[number, number]> = [
    [region.cx - region.halfX, region.cz - region.halfZ],
    [region.cx + region.halfX, region.cz - region.halfZ],
    [region.cx + region.halfX, region.cz + region.halfZ],
    [region.cx - region.halfX, region.cz + region.halfZ],
  ]
  const stations: BoundaryStation[] = []
  let run = 0
  for (let c = 0; c < 4; c++) {
    const [x0, z0] = corners[c]
    const [x1, z1] = corners[(c + 1) % 4]
    const dx = x1 - x0
    const dz = z1 - z0
    const length = Math.hypot(dx, dz)
    const steps = Math.max(2, Math.round(length / 0.95))
    // Edge normal points away from the rect centre (CCW walk → right-hand side).
    const nx = dz / length
    const nz = -dx / length
    // INTERIOR stations only. Starting at i = 0 put a station on the corner
    // carrying this edge's normal, immediately after the mitre station already
    // standing there with the averaged one — a 45° section rotation over zero
    // travel, which folds the casting through itself (0.26 m² per rect corner).
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      stations.push({
        x: x0 + dx * t,
        z: z0 + dz * t,
        outX: nx,
        outZ: nz,
        scale: 1,
        run: run + length * t,
      })
    }
    run += length
    // Mitred corner: one station carrying the averaged normal, widened by
    // 1/cos(half angle) so the swept section keeps its true width round it.
    const [x2, z2] = corners[(c + 2) % 4]
    const nx2 = (z2 - z1) / Math.hypot(x2 - x1, z2 - z1)
    const nz2 = -(x2 - x1) / Math.hypot(x2 - x1, z2 - z1)
    const mx = nx + nx2
    const mz = nz + nz2
    const mLength = Math.hypot(mx, mz) || 1
    stations.push({
      x: x1,
      z: z1,
      outX: mx / mLength,
      outZ: mz / mLength,
      scale: 1 / Math.max(0.35, (mx / mLength) * nx + (mz / mLength) * nz),
      run,
    })
  }
  return stations
}

function ribbonBoundary(region: Region & { kind: 'ribbon' }): BoundaryStation[] {
  const frames = ribbonFrames(region.line)
  const stations: BoundaryStation[] = []
  let run = 0
  const push = (x: number, z: number, outX: number, outZ: number): void => {
    if (stations.length > 0) {
      const previous = stations[stations.length - 1]
      run += Math.hypot(x - previous.x, z - previous.z)
    }
    stations.push({ x, z, outX, outZ, scale: 1, run })
  }
  // ONE closed loop — right edge forward, rounded end, left edge back, rounded
  // start — so trimming opens it exactly where the ribbon meets another pour
  // and free ends get a real radiused kerb instead of a raw butt.
  // Direction follows the sweep contract: travel = (−out.z, 0, out.x).
  for (const frame of frames) {
    push(
      frame.x - frame.nx * region.halfWidth,
      frame.z - frame.nz * region.halfWidth,
      -frame.nx,
      -frame.nz,
    )
  }
  const capSteps = 5
  const endFrame = frames[frames.length - 1]
  for (let i = 1; i < capSteps; i++) {
    const angle = (i / capSteps) * Math.PI
    const ox = -endFrame.nx * Math.cos(angle) + endFrame.tx * Math.sin(angle)
    const oz = -endFrame.nz * Math.cos(angle) + endFrame.tz * Math.sin(angle)
    push(endFrame.x + ox * region.halfWidth, endFrame.z + oz * region.halfWidth, ox, oz)
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]
    push(
      frame.x + frame.nx * region.halfWidth,
      frame.z + frame.nz * region.halfWidth,
      frame.nx,
      frame.nz,
    )
  }
  const startFrame = frames[0]
  for (let i = 1; i < capSteps; i++) {
    const angle = (i / capSteps) * Math.PI
    const ox = startFrame.nx * Math.cos(angle) - startFrame.tx * Math.sin(angle)
    const oz = startFrame.nz * Math.cos(angle) - startFrame.tz * Math.sin(angle)
    push(startFrame.x + ox * region.halfWidth, startFrame.z + oz * region.halfWidth, ox, oz)
  }
  return stations
}

function regionBoundaries(region: Region): BoundaryStation[][] {
  switch (region.kind) {
    case 'disc':
      return [circleBoundary(region.cx, region.cz, region.radius, 1)]
    case 'annulus':
      return [
        circleBoundary(region.cx, region.cz, region.rOuter, 1),
        circleBoundary(region.cx, region.cz, region.rInner, -1),
      ]
    case 'rect':
      return [rectBoundary(region)]
    case 'ribbon':
      return [ribbonBoundary(region)]
    case 'zone':
      // The throat zone never carries curbs or lights — its edging is the
      // swept strip system in emitThroatGround.
      return []
  }
}

/**
 * Precast curb section. Lateral 0 IS the paved boundary: the unit stands
 * 65 mm proud of it and reaches 165 mm back over the slab, so the slab's own
 * skirt (at −PAVE.slabInset) is buried inside the casting and no two faces
 * from the two parts ever share a plane.
 */
const CURB_PROFILE: Array<[number, number]> = [
  [-CURB.halfWidth - 0.05, -CURB.root],
  [CURB.halfWidth - 0.05, -CURB.root],
  [CURB.halfWidth - 0.05, CURB.reveal - CURB.chamfer],
  [CURB.halfWidth - 0.05 - CURB.chamfer, CURB.reveal],
  [-CURB.halfWidth - 0.05 + CURB.chamfer, CURB.reveal],
  [-CURB.halfWidth - 0.05, CURB.reveal - CURB.chamfer],
]

/** Floor-light housing: a trough section with a recessed, chamfered rim. */
const LIGHT_PROFILE: Array<[number, number]> = [
  [-0.082, -0.09],
  [0.082, -0.09],
  [0.082, 0.014],
  [0.068, 0.03],
  [0.05, 0.03],
  [0.05, 0.012],
  [-0.05, 0.012],
  [-0.05, 0.03],
  [-0.068, 0.03],
  [-0.082, 0.014],
]

const PLANTER_PROFILE: Array<[number, number]> = [
  [-PLANTER.wall / 2, -0.06],
  [PLANTER.wall / 2, -0.06],
  [PLANTER.wall / 2, PLANTER.rimY - PLANTER.copingThickness - 0.03],
  [PLANTER.wall / 2 + PLANTER.copingOverhang, PLANTER.rimY - PLANTER.copingThickness],
  [PLANTER.wall / 2 + PLANTER.copingOverhang, PLANTER.rimY - 0.022],
  [PLANTER.wall / 2 + PLANTER.copingOverhang - 0.022, PLANTER.rimY],
  [-PLANTER.wall / 2 - PLANTER.copingOverhang + 0.022, PLANTER.rimY],
  [-PLANTER.wall / 2 - PLANTER.copingOverhang, PLANTER.rimY - 0.022],
  [-PLANTER.wall / 2 - PLANTER.copingOverhang, PLANTER.rimY - PLANTER.copingThickness],
  [-PLANTER.wall / 2, PLANTER.rimY - PLANTER.copingThickness - 0.03],
]

/** Where the curb must break: junctions with other pours, and covered edges. */
function boundaryOpen(station: BoundaryStation, priority: number): boolean {
  if (coveringRegion(station.x, station.z, priority) >= 0) return false
  // Probe at two reaches. A single 0.34 m probe steps clean OVER a neighbouring
  // pour that ends just outside this line — which is what the station terrace's
  // south edge does to the boulevard, tangent to it at x = 0 and 0.14 m inside
  // it at x = 5: both pours kerbed the same junction and the two castings ran
  // through each other. If another slab is still there a curb's width out, this
  // is a joint between pours, not an edge.
  for (const reach of [0.14, 0.34]) {
    const probeX = station.x + station.outX * reach
    const probeZ = station.z + station.outZ * reach
    if (pavedSignedDistance(probeX, probeZ) <= -0.02) return false
  }
  return true
}

function emitEdgework(
  writer: GroundWriter,
  region: Region,
  lightRuns: BoundaryStation[][],
): void {
  for (const loop of regionBoundaries(region)) {
    const open = loop.map((station) => boundaryOpen(station, region.priority))
    // Split the closed loop into contiguous runs of open boundary.
    const runs: BoundaryStation[][] = []
    let current: BoundaryStation[] | null = null
    const total = loop.length
    let start = 0
    while (start < total && open[start] && open[(start - 1 + total) % total]) start++
    for (let step = 0; step < total; step++) {
      const index = (start + step) % total
      if (open[index]) {
        if (!current) {
          current = []
          runs.push(current)
        }
        current.push(loop[index])
      } else {
        current = null
      }
    }
    const closedLoop = runs.length === 1 && runs[0].length === total

    for (const run of runs) {
      if (run.length < 3) continue
      const stations: SweepStation[] = run.map((station) => ({
        x: station.x,
        z: station.z,
        outX: station.outX,
        outZ: station.outZ,
        baseY: slabTop(station.x, station.z),
        run: station.run,
      }))
      // Mitre widening at sharp corners: scaling the station's outward vector
      // scales every lateral in the profile by 1/cos(half angle), so the
      // section keeps its true width round the corner instead of pinching.
      for (let i = 0; i < stations.length; i++) {
        const scale = run[i].scale
        if (scale === 1) continue
        stations[i].outX *= scale
        stations[i].outZ *= scale
      }
      sweepSection(writer, 'concrete', stations, CURB_PROFILE, { closedRun: closedLoop })

      // The slab's own skirt: hidden inside the curb, and the safety net if a
      // curb ever breaks somewhere the ground still falls away.
      for (let i = 0; i < stations.length - 1; i++) {
        const a = run[i]
        const b = run[i + 1]
        const ax = a.x - a.outX * PAVE.slabInset
        const az = a.z - a.outZ * PAVE.slabInset
        const bx = b.x - b.outX * PAVE.slabInset
        const bz = b.z - b.outZ * PAVE.slabInset
        const ay = slabTop(ax, az)
        const by = slabTop(bx, bz)
        writer.face('concrete', [
          { p: new Vector3(ax, ay, az), uv: new Vector2(a.run, 0) },
          { p: new Vector3(bx, by, bz), uv: new Vector2(b.run, 0) },
          { p: new Vector3(bx, by - 0.3, bz), uv: new Vector2(b.run, -0.3) },
          { p: new Vector3(ax, ay - 0.3, az), uv: new Vector2(a.run, -0.3) },
        ])
      }
      lightRuns.push(run)
    }
  }
}

/** Embedded guide lights: little modelled fixtures, not glowing decals. */
function emitFloorLights(writer: GroundWriter, runs: BoundaryStation[][]): number {
  let placed = 0
  // Every fixture already emitted. The target-to-station snap below picks the
  // NEAREST station to each 7 m target, so wherever a run's stations are
  // sparser than the spacing — or wherever two runs walk the same boundary —
  // several targets collapse onto one station and stamp a second housing in
  // exactly the same place. That shipped 70 duplicated fixtures: 12.19 m² of
  // coincident bezel and 1.08 m² of coincident lens, the single largest
  // z-fight in the park. Guarding on the emitted POSITION catches every cause
  // at once (defect family #1, dev_docs/notes.md "W2 works").
  const emitted: Array<[number, number]> = []
  const tooClose = (x: number, z: number): boolean => {
    for (const [ex, ez] of emitted) {
      const dx = x - ex
      const dz = z - ez
      if (dx * dx + dz * dz < 6.25) return true
    }
    return false
  }
  for (const run of runs) {
    const runLength = Math.abs(run[run.length - 1].run - run[0].run)
    if (runLength < 9) continue
    const spacing = 7
    const count = Math.floor(runLength / spacing)
    for (let i = 1; i <= count; i++) {
      const target = run[0].run + Math.sign(run[run.length - 1].run - run[0].run) * i * spacing
      let best = run[0]
      let bestDistance = Infinity
      for (const station of run) {
        const d = Math.abs(station.run - target)
        if (d < bestDistance) {
          bestDistance = d
          best = station
        }
      }
      // 0.55 m inboard of the curb, clear of beds and of the tram channel.
      const x = best.x - best.outX * 0.55
      const z = best.z - best.outZ * 0.55
      if (insidePlanter(x, z, 0.5) || insideGuidewayChannel(x, z, 0.9)) continue
      if (insideSpurCorridor(x, z, 0.9)) continue
      if (pavedSignedDistance(x, z) > -0.2) continue
      // 2.5 m guard against a 7 m nominal pitch: only ever rejects a repeat
      // stamp, never a legitimately spaced fixture.
      if (tooClose(x, z)) continue
      emitted.push([x, z])
      const baseY = slabTop(x, z)
      const alongX = -best.outZ
      const alongZ = best.outX
      const half = 0.11
      const stations: SweepStation[] = [
        { x: x - alongX * half, z: z - alongZ * half, outX: best.outX, outZ: best.outZ, baseY, run: 0 },
        { x: x + alongX * half, z: z + alongZ * half, outX: best.outX, outZ: best.outZ, baseY, run: 0.22 },
      ]
      sweepSection(writer, 'pathLightBezel', stations, LIGHT_PROFILE)
      // Lens: a plate 6 mm proud of the trough floor — a real reveal, never
      // flush, so nothing can z-fight with the housing.
      const lensHalfWidth = 0.044
      const lensY = baseY + 0.018
      const corner = (sa: number, sl: number): GroundVertex => ({
        p: new Vector3(
          x + alongX * sa * (half - 0.022) + best.outX * sl * lensHalfWidth,
          lensY,
          z + alongZ * sa * (half - 0.022) + best.outZ * sl * lensHalfWidth,
        ),
        n: new Vector3(0, 1, 0),
        uv: new Vector2(sa * 0.5 + 0.5, sl * 0.5 + 0.5),
      })
      writer.face('pathLight', [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)])
      placed++
    }
  }
  return placed
}

// ------------------------------------------------------------- planters ----

function emitPlanters(writer: GroundWriter, colliders: PavingColliderSpec[]): void {
  for (const planter of PLANTERS) {
    const midRadius = (planter.rInner + planter.rOuter) * 0.5
    const wallMid = planter.wall / 2
    // Closed loop around the bed: outer arc, end wall, inner arc, end wall.
    const stations: SweepStation[] = []
    let run = 0
    const push = (x: number, z: number, outX: number, outZ: number): void => {
      if (stations.length > 0) {
        const previous = stations[stations.length - 1]
        run += Math.hypot(x - previous.x, z - previous.z)
      }
      stations.push({ x, z, outX, outZ, baseY: slabTop(x, z), run })
    }
    const outerR = planter.rOuter - wallMid
    const innerR = planter.rInner + wallMid
    const arcSteps = Math.max(4, Math.round(((planter.a1 - planter.a0) * midRadius) / 0.85))
    const endSteps = Math.max(2, Math.round((outerR - innerR) / 0.8))
    const at = (r: number, angle: number): [number, number] => [
      planter.cx + Math.cos(angle) * r,
      planter.cz + Math.sin(angle) * r,
    ]
    /**
     * MITRED CORNER, exactly as `rectBoundary` turns a curb (geometry-craft
     * §2.2). The bed used to run its outer arc THROUGH the corner and straight
     * into the end wall, so the section swung 90° in one step — and at the
     * inner corner the two runs even shared a station, swinging 90° over zero
     * length. A swept section that rotates faster than it travels folds through
     * itself: that was 4.3 m² of concrete z-fighting concrete, a ring of it
     * under every coping. One station carrying the averaged normal, widened by
     * 1/cos(45°) so the casting keeps its true width round the turn, splits the
     * turn into two 45° steps that each travel further than they rotate.
     */
    const corner = (r: number, angle: number, radial: number, along: number): void => {
      // The two runs meet at 90°, so their averaged normal is (r̂ ± θ̂)/√2 and
      // the widening is 1/cos(45°) = √2: the UNNORMALISED sum is already the
      // scaled outward vector `sweepSection` wants.
      push(
        ...at(r, angle),
        Math.cos(angle) * radial - Math.sin(angle) * along,
        Math.sin(angle) * radial + Math.cos(angle) * along,
      )
    }
    // Closed loop: outer arc, end wall, inner arc, start wall — corners mitred,
    // and every run carrying its INTERIOR stations only so no station repeats.
    corner(outerR, planter.a0, 1, -1)
    for (let i = 1; i < arcSteps; i++) {
      const angle = planter.a0 + ((planter.a1 - planter.a0) * i) / arcSteps
      push(...at(outerR, angle), Math.cos(angle), Math.sin(angle))
    }
    corner(outerR, planter.a1, 1, 1)
    for (let i = 1; i < endSteps; i++) {
      const r = outerR + ((innerR - outerR) * i) / endSteps
      push(...at(r, planter.a1), -Math.sin(planter.a1), Math.cos(planter.a1))
    }
    corner(innerR, planter.a1, -1, 1)
    for (let i = arcSteps - 1; i >= 1; i--) {
      const angle = planter.a0 + ((planter.a1 - planter.a0) * i) / arcSteps
      push(...at(innerR, angle), -Math.cos(angle), -Math.sin(angle))
    }
    corner(innerR, planter.a0, -1, -1)
    for (let i = 1; i < endSteps; i++) {
      const r = innerR + ((outerR - innerR) * i) / endSteps
      push(...at(r, planter.a0), Math.sin(planter.a0), -Math.cos(planter.a0))
    }
    sweepSection(writer, 'concrete', stations, PLANTER_PROFILE, { closedRun: true })

    // Fill: a soil surface set 140 mm below the coping — a real reveal, with
    // a slight crown so it reads as loose fill rather than a poured lid.
    const soilY = PLANTER.rimY - PLANTER.soilDrop
    const fillInner = innerR + wallMid - 0.02
    const fillOuter = outerR - wallMid + 0.02
    const radialSteps = Math.max(2, Math.round((fillOuter - fillInner) / 0.8))
    const soilAt = (r: number, angle: number): GroundVertex => {
      const x = planter.cx + Math.cos(angle) * r
      const z = planter.cz + Math.sin(angle) * r
      const across = (r - fillInner) / Math.max(0.001, fillOuter - fillInner)
      const crown = Math.sin(Math.PI * across) * 0.03
      return {
        p: new Vector3(x, slabTop(x, z) + soilY + crown, z),
        n: new Vector3(0, 1, 0),
        uv: new Vector2(x * 0.5, z * 0.5),
      }
    }
    for (let i = 0; i < radialSteps; i++) {
      const ra = fillInner + ((fillOuter - fillInner) * i) / radialSteps
      const rb = fillInner + ((fillOuter - fillInner) * (i + 1)) / radialSteps
      for (let j = 0; j < arcSteps; j++) {
        const a0 = planter.a0 + ((planter.a1 - planter.a0) * j) / arcSteps
        const a1 = planter.a0 + ((planter.a1 - planter.a0) * (j + 1)) / arcSteps
        writer.face('plantSoil', [soilAt(ra, a0), soilAt(ra, a1), soilAt(rb, a1), soilAt(rb, a0)])
      }
    }

    // Colliders: the walls are solid, so approximate the sector with boxes
    // marching along its mid-arc (inset, per friends' dress.ts practice).
    const colliderSteps = Math.max(1, Math.round(((planter.a1 - planter.a0) * midRadius) / 3))
    for (let i = 0; i < colliderSteps; i++) {
      const a0 = planter.a0 + ((planter.a1 - planter.a0) * i) / colliderSteps
      const a1 = planter.a0 + ((planter.a1 - planter.a0) * (i + 1)) / colliderSteps
      const mid = (a0 + a1) * 0.5
      const x = planter.cx + Math.cos(mid) * midRadius
      const z = planter.cz + Math.sin(mid) * midRadius
      const length = (a1 - a0) * midRadius
      colliders.push({
        center: new Vector3(x, slabTop(x, z) + PLANTER.rimY / 2, z),
        size: new Vector3(planter.rOuter - planter.rInner, PLANTER.rimY, length + 0.1),
        // size.x is the RADIAL bed thickness and size.z the arc chunk, so
        // local +X must be the radial. The convention maps local +X to
        // (cos yaw, −sin yaw) = the radial only at yaw = −mid; the old
        // `atan2(cos mid, −sin mid)` is mid + π/2 and put the 4.1 m radial
        // thickness on the TANGENT — the plaza beds blocked only their middle
        // 2.75 m (walk-through at both walls) while overrunning 0.73 m of arc
        // into every path gap.
        yaw: -mid,
      })
    }
  }
}

// ------------------------------------------------------ tram guideway ------

/**
 * The recessed channel the street-running Loop sits in. This module owns the
 * channel and its lips; the track agent insets rails into it (contract in
 * GUIDEWAY_CHANNEL).
 */
function emitGuidewayChannel(writer: GroundWriter): void {
  const rInner = GUIDEWAY_CHANNEL.radius - GUIDEWAY_CHANNEL.width / 2
  const rOuter = GUIDEWAY_CHANNEL.radius + GUIDEWAY_CHANNEL.width / 2
  const steps = Math.round((TAU * GUIDEWAY_CHANNEL.radius) / 1.4)
  // The channel floor runs a full GUTTER below the crown datum — see the
  // constant: at smaller separations the cast's station-sampled crown and
  // this per-vertex pour z-fight. Level across, crown-keyed (see floorY); at
  // the turnout mouth it blends onto the corridor floor's constant
  // level — a FULL blend, up or down, so the two floors meet with no step
  // whichever side of the swale the junction lands on.
  // 15 mm below the crown datum through the turnout mouth, NOT the full
  // gutter: past the spur cast's cap the crossing rails run with no cast
  // beneath them, and a deep floor leaves their feet hanging in air. The
  // shallow zone cannot z-fight — the spine's tail nodes are all at street
  // level so every datum agrees to millimetres there, the exposed margins
  // carry no cast overhead, and under the cast the floor is inside the
  // solid. It also matches `emitSpurCut`'s mouth depth so the floors meet.
  const corridorLevel =
    groundGrade(0, GUIDEWAY_CHANNEL.radius) + PAVE.rise - GUIDEWAY_CHANNEL.recess - 0.01
  const floorY = (x: number, z: number): number => {
    // LEVEL ACROSS: the floor keys to the crown at the PROJECTED ring point —
    // one datum with the swept cast and the conformed sheet — never to the
    // LOCAL slabTop. Near the pad skirts (Overlook) the radial cross-slope
    // reaches ±0.15 m over the channel width; a locally-poured floor climbed
    // 56 mm over the sheet on the high side (owner sweep finding). The
    // chamfered lip is the piece that absorbs cross-slope, as on any trackbed
    // cut through side-sloping ground.
    const rr = Math.hypot(x, z) || 1
    const px = (x / rr) * GUIDEWAY_CHANNEL.radius
    const pz = (z / rr) * GUIDEWAY_CHANNEL.radius
    const dished = slabTop(px, pz) - GUIDEWAY_CHANNEL.recess - GUIDEWAY_CHANNEL.gutter
    // Smooth by true corridor distance: a stepped blend tears the floor into
    // shards where adjacent vertices land on different levels.
    const d = spurCorridorDistance(x, z)
    if (d >= 0.9) return dished
    const t = Math.min(1, (0.9 - d) / 1.2)
    const eased = t * t * (3 - 2 * t)
    return dished + (corridorLevel - dished) * eased
  }
  const point = (r: number, angle: number, y: (x: number, z: number) => number): GroundVertex => {
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    return {
      p: new Vector3(x, y(x, z), z),
      n: new Vector3(0, 1, 0),
      uv: new Vector2(angle * GUIDEWAY_CHANNEL.radius, r - GUIDEWAY_CHANNEL.radius),
    }
  }
  // The turnout throat owns its zone whole: no floors, no lips, no verge
  // skirt there — emitThroatGround pours the ground and the edging. The cut
  // is EXACT (every polygon bisected on the header bearings), so the
  // resuming floors butt the street's header strips on one radial joint
  // instead of a 1.4 m segment staircase.
  const zoneClip = (x: number, z: number): number => {
    if (!THROAT) return 1
    const phi = Math.atan2(z, x)
    return Math.max(THROAT.phiLo - phi, phi - THROAT.phiHi) * GUIDEWAY_CHANNEL.radius
  }
  const clippedFace = (corners: GroundVertex[]): void => {
    const cell = clipGround(corners, zoneClip)
    if (cell.length >= 3) writer.face('channel', cell)
  }
  const radialSteps = 3
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU
    const a1 = ((i + 1) / steps) * TAU
    if (
      THROAT &&
      (a0 + a1) / 2 > THROAT.phiLo + 0.02 &&
      (a0 + a1) / 2 < THROAT.phiHi - 0.02
    ) {
      continue
    }
    for (let j = 0; j < radialSteps; j++) {
      const ra = rInner + ((rOuter - rInner) * j) / radialSteps
      const rb = rInner + ((rOuter - rInner) * (j + 1)) / radialSteps
      clippedFace([
        point(ra, a0, floorY),
        point(ra, a1, floorY),
        point(rb, a1, floorY),
        point(rb, a0, floorY),
      ])
    }
    // Lips: the paving drops into the channel over a 90 mm chamfer, so the
    // slab edge is a treated arris rather than a raw cut.
    for (const [radius, outward] of [
      [rInner, -1],
      [rOuter, 1],
    ] as const) {
      const lipR = radius + GUIDEWAY_CHANNEL.lip * outward
      const a = { x: Math.cos(a0) * radius, z: Math.sin(a0) * radius }
      const b = { x: Math.cos(a1) * radius, z: Math.sin(a1) * radius }
      // The spur corridor opens through the outer lip at the turnout — a lip
      // segment there would stand as a berm across the trackbed's path.
      if (outward > 0 && insideSpurCorridor((a.x + b.x) / 2, (a.z + b.z) / 2, -0.02)) continue
      const c = { x: Math.cos(a1) * lipR, z: Math.sin(a1) * lipR }
      const d = { x: Math.cos(a0) * lipR, z: Math.sin(a0) * lipR }
      const corners: GroundVertex[] = [
        { p: new Vector3(a.x, floorY(a.x, a.z), a.z), uv: new Vector2(a0 * radius, 0) },
        { p: new Vector3(d.x, slabTop(d.x, d.z), d.z), uv: new Vector2(a0 * radius, 0.09) },
        { p: new Vector3(c.x, slabTop(c.x, c.z), c.z), uv: new Vector2(a1 * radius, 0.09) },
        { p: new Vector3(b.x, floorY(b.x, b.z), b.z), uv: new Vector2(a1 * radius, 0) },
      ]
      clippedFace(outward < 0 ? corners : [...corners].reverse())
      // Verge skirt: from the lip arris down and outward to crown − 0.45.
      // On open stretches the regolith sheet lies EXACTLY at crown − 0.13
      // (interiorHeight's corridor conform law), so the skirt crosses under
      // it on one clean line and its outer edge is buried by construction —
      // the curb can never hover over dirt or drown in it again. Where the
      // boulevard slab runs beyond the lip the skirt is inside the pour's
      // shadow (deliberate hidden bury); the crown is evaluated at the
      // PROJECTED ring point, same as every other corridor datum.
      const skirtR = radius + (GUIDEWAY_CHANNEL.lip + 0.42) * outward
      const crown0 =
        slabTop(Math.cos(a0) * GUIDEWAY_CHANNEL.radius, Math.sin(a0) * GUIDEWAY_CHANNEL.radius) -
        GUIDEWAY_CHANNEL.recess
      const crown1 =
        slabTop(Math.cos(a1) * GUIDEWAY_CHANNEL.radius, Math.sin(a1) * GUIDEWAY_CHANNEL.radius) -
        GUIDEWAY_CHANNEL.recess
      const skirt: GroundVertex[] = [
        { p: new Vector3(d.x, slabTop(d.x, d.z), d.z), uv: new Vector2(a0 * radius, 0.09) },
        {
          p: new Vector3(Math.cos(a0) * skirtR, crown0 - 0.45, Math.sin(a0) * skirtR),
          uv: new Vector2(a0 * radius, 0.51),
        },
        {
          p: new Vector3(Math.cos(a1) * skirtR, crown1 - 0.45, Math.sin(a1) * skirtR),
          uv: new Vector2(a1 * radius, 0.51),
        },
        { p: new Vector3(c.x, slabTop(c.x, c.z), c.z), uv: new Vector2(a1 * radius, 0.09) },
      ]
      clippedFace(outward < 0 ? skirt : [...skirt].reverse())
    }
  }
}

/** Clip a ground polygon to f(x,z) ≥ 0, bisecting the boundary crossings. */
function clipGround(
  corners: GroundVertex[],
  f: (x: number, z: number) => number,
): GroundVertex[] {
  const out: GroundVertex[] = []
  const value = corners.map((corner) => f(corner.p.x, corner.p.z))
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length
    const a = corners[i]
    const b = corners[j]
    if (value[i] >= 0) out.push(a)
    if (value[i] >= 0 !== value[j] >= 0) {
      let lo = 0
      let hi = 1
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2
        const x = a.p.x + (b.p.x - a.p.x) * mid
        const z = a.p.z + (b.p.z - a.p.z) * mid
        if (f(x, z) >= 0 === value[i] >= 0) lo = mid
        else hi = mid
      }
      const t = (lo + hi) / 2
      out.push({
        p: a.p.clone().lerp(b.p, t),
        n: a.n && b.n ? a.n.clone().lerp(b.n, t).normalize() : undefined,
        uv: a.uv && b.uv ? a.uv.clone().lerp(b.uv, t) : undefined,
      })
    }
  }
  return out
}

/**
 * The arrival spur's recessed cuttings — emitGuidewayChannel's counterpart
 * along the spur ribbons (the boulevard throat AND the rim-promenade
 * crossing). The floor follows the trackbed crown 10 mm below it (level at
 * the ring, descending across the promenade), flush with the channel floor
 * where they butt on the channel's own emitted n-gon; the sides are vertical
 * cast walls up to the local slab top, not 60 mm lips. The mouths toward the
 * regolith trench stay open (the trackbed apron crosses them).
 */
function emitSpurCorridor(writer: GroundWriter): void {
  // Only the rim-promenade crossing keeps the recessed-cut treatment; the
  // boulevard throat is the turnout ground now (emitThroatGround).
  for (const id of ['spur-corridor-promenade']) emitSpurCut(writer, id)
}

function emitSpurCut(writer: GroundWriter, id: string): void {
  const region = PAVED_REGIONS.find((entry) => entry.id === id)
  if (!region || region.kind !== 'ribbon') return
  const line = region.line
  // The region reaches to the OUTSIDE of the lip (paving trims there); the
  // cut's own walls stand at the channel width and the chamfer bridges.
  const half = GUIDEWAY_CHANNEL.width / 2
  const steps = Math.round((TAU * GUIDEWAY_CHANNEL.radius) / 1.4)
  const rOuter = GUIDEWAY_CHANNEL.radius + GUIDEWAY_CHANNEL.width / 2
  // The corridor approaches the ring from outside: > 0 = clear of the channel.
  const clear = (x: number, z: number): number => ngonSigned(0, 0, rOuter, steps, x, z)
  // The crown datum comes from the spur's own ground truth; the fallback is
  // the ring street level (only reachable if a ribbon strays past the tail's
  // bounding box, which the plan construction prevents). Depth is SPATIAL:
  // a full GUTTER along the run — the cast sweeps a Catmull while this floor
  // lerps the spine nodes, and their divergence reaches a few cm upstream,
  // so anything shallower z-fights (owner finding) — rising to a 15 mm
  // reveal through the turnout mouth, where the crossing rails run past the
  // cast's cap with nothing beneath them and a deep floor left their feet
  // hanging in air. The tail nodes are all at street level there, so the
  // datums agree to millimetres and 15 mm can never fight.
  const fallback = groundGrade(0, GUIDEWAY_CHANNEL.radius) + PAVE.rise - GUIDEWAY_CHANNEL.recess
  const floorAt = (x: number, z: number): number => {
    const crown = spurTrackDatum(x, z)?.y ?? fallback
    // Shallow (10 mm) until PAST the cast's cap (clear ≈ 0.49): the crossing
    // rails' feet sit at crown − 0.03 and must stay bedded at every floor
    // TRIANGLE — the cells interpolate across this blend, and a 15 mm nominal
    // measured only 3 mm at the worst cell. The deepening happens under the
    // cast, where the floor is inside the solid anyway.
    const t = clamp01((clear(x, z) - 0.55) / 1.05)
    return crown - 0.01 - (GUIDEWAY_CHANNEL.gutter - 0.01) * (t * t * (3 - 2 * t))
  }
  const run: number[] = [0]
  for (let i = 1; i < line.length; i++) run.push(run[i - 1] + line[i].distanceTo(line[i - 1]))
  const sideAt = (i: number): Vector2 => {
    const a = line[Math.max(0, i - 1)]
    const b = line[Math.min(line.length - 1, i + 1)]
    const t = b.clone().sub(a)
    const l = t.length() || 1
    return new Vector2(t.y / l, -t.x / l)
  }
  const at = (i: number, across: number): { x: number; z: number } => {
    const side = sideAt(i)
    return { x: line[i].x + side.x * across, z: line[i].y + side.y * across }
  }
  const floorVertex = (i: number, across: number): GroundVertex => {
    const p = at(i, across)
    return {
      p: new Vector3(p.x, floorAt(p.x, p.z), p.z),
      n: new Vector3(0, 1, 0),
      uv: new Vector2(run[i], across),
    }
  }
  const wallVertex = (i: number, across: number, y: number): GroundVertex => {
    const p = at(i, across)
    return { p: new Vector3(p.x, y, p.z), uv: new Vector2(run[i], y) }
  }
  const acrossSteps = 3
  for (let i = 0; i < line.length - 1; i++) {
    for (let j = 0; j < acrossSteps; j++) {
      const a0 = -half + (2 * half * j) / acrossSteps
      const a1 = -half + (2 * half * (j + 1)) / acrossSteps
      const cell = clipGround(
        [
          floorVertex(i, a0),
          floorVertex(i + 1, a0),
          floorVertex(i + 1, a1),
          floorVertex(i, a1),
        ],
        clear,
      )
      if (cell.length >= 3) writer.face('channel', cell)
    }
    for (const s of [-1, 1] as const) {
      const pa = at(i, s * half)
      const pb = at(i + 1, s * half)
      const outer = s * (half + GUIDEWAY_CHANNEL.lip)
      const qa = at(i, outer)
      const qb = at(i + 1, outer)
      const floorA = floorAt(pa.x, pa.z)
      const floorB = floorAt(pb.x, pb.z)
      // Vertical cast wall stops 60 mm short of the paving; the 90 mm
      // chamfered lip carries the last drop, so the slab edge is a treated
      // arris exactly as it is along the ring channel.
      const brimA = Math.max(floorA, slabTop(pa.x, pa.z) - GUIDEWAY_CHANNEL.recess)
      const brimB = Math.max(floorB, slabTop(pb.x, pb.z) - GUIDEWAY_CHANNEL.recess)
      const topA = Math.max(brimA, slabTop(qa.x, qa.z))
      const topB = Math.max(brimB, slabTop(qb.x, qb.z))
      if (topA - floorA < 0.012 && topB - floorB < 0.012) continue
      if (brimA - floorA >= 0.004 || brimB - floorB >= 0.004) {
        const wall = clipGround(
          [
            wallVertex(i, s * half, floorA),
            wallVertex(i + 1, s * half, floorB),
            wallVertex(i + 1, s * half, brimB),
            wallVertex(i, s * half, brimA),
          ],
          clear,
        )
        if (wall.length >= 3) writer.face('channel', s > 0 ? wall : [...wall].reverse())
      }
      if (topA - brimA >= 0.004 || topB - brimB >= 0.004) {
        const lip = clipGround(
          [
            wallVertex(i, s * half, brimA),
            wallVertex(i + 1, s * half, brimB),
            wallVertex(i + 1, outer, topB),
            wallVertex(i, outer, topA),
          ],
          clear,
        )
        if (lip.length >= 3) writer.face('channel', s > 0 ? lip : [...lip].reverse())
      }
    }
  }
}

/**
 * THE TURNOUT THROAT — the owner's reference image: continuous tiled ground
 * with the two track ways set into it as smooth bands, ONE slim edging
 * strip per boundary, rails riding on top. Built as one piece of modelling,
 * not an assembly — every surface here is an offset of the union field
 * U = throatU(x, z) (pavingPlan):
 *
 *   street   ONE clipped pour over the whole zone, U ≤ half+0.05, at the
 *            projected crown + 0.014 (4 mm under the trackbed aprons, its
 *            cut edges tucked beneath the casts at |d| = 1.30), joints on
 *            the world grid
 *   strips   swept along MARCHED ISO-CONTOURS of U at half+0.09 — the two
 *            ways' edgings merge tangentially and round the gore vee
 *            because a union field's contour does; there is no leg-vs-leg
 *            trimming to leave crossing lines or dying slivers
 *   tiles    the fields trim on the same field at half+0.13 (the zone
 *            region), the cut buried under the strip body
 *
 * Strip ends NEVER die in the open: at the zone's bearing ends each
 * shoulder closes as a picture-frame header (corner fillet, radial leg,
 * end cap one movement JOINT off the cast apron); at the regolith trench
 * the strips dive bodily under the conform dirt. The resuming channel
 * butts the headers on the same bisected bearing lines
 * (emitGuidewayChannel.zoneClip).
 */
function emitThroatGround(writer: GroundWriter): void {
  const throat = THROAT
  if (!throat) return
  const R = GUIDEWAY_CHANNEL.radius
  const half = throat.half
  /** Street edge under the cast: apron edge 1.35 overlaps it 4 mm above. */
  const SLOT = 1.3
  const STREET_LIFT = 0.014
  /** The pour runs 30 mm PAST the tile cut (half+0.13): in the bridged vee
   *  plateaus the field flattens and the band between street edge and tile
   *  cut widens into whole square metres — left unpoured it exposed the dug
   *  sheet as a dark patch. Where tiles exist the overlap is buried 46 mm
   *  beneath them; where they don't, the street reaches the cut line. */
  const POUR_EDGE = half + 0.16
  const STRIP_AT = half + 0.09
  /** Header end cap stands one movement joint off the cast apron. */
  const CAP_AT = 1.35 + 0.02
  const line = throat.spurLine
  if (line.length < 2) return
  const mouth = line[0]
  const mouthDir = line[1].clone().sub(line[0]).normalize()
  // The medial-blended crown: the street/strips must never crease where the
  // nearest-generator switch happens mid-wedge (interiorHeight.throatCrown).
  const streetY = (x: number, z: number): number => throatCrown(x, z) + STREET_LIFT
  const dRingRaw = (x: number, z: number): number => Math.abs(Math.hypot(x, z) - R)
  const dSpurCast = (x: number, z: number): number => spurTrackDatum(x, z)?.d ?? 1e4
  const alongMouth = (x: number, z: number): number =>
    (x - mouth.x) * mouthDir.x + (z - mouth.y) * mouthDir.y

  const vert = (x: number, z: number, y: number, u: number, v: number): GroundVertex => ({
    p: new Vector3(x, y, z),
    n: new Vector3(0, 1, 0),
    uv: new Vector2(u, v),
  })
  /** |plan area| of a clipped ring — drops bisection soup, keeps the real
   *  slivers (the wedge between the merging casts is a real surface). */
  const planArea = (ring: GroundVertex[]): number => {
    let doubled = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i].p
      const q = ring[(i + 1) % ring.length].p
      doubled += p.x * q.z - q.x * p.z
    }
    return Math.abs(doubled) * 0.5
  }
  const oriented = (slot: string, ring: GroundVertex[], prefer: Vector3): void => {
    if (ring.length < 3) return
    const [a, b, c] = ring
    const n = new Vector3().subVectors(b.p, a.p).cross(new Vector3().subVectors(c.p, a.p))
    writer.face(slot, n.dot(prefer) >= 0 ? ring : [...ring].reverse())
  }

  // ---- THE STREET: one grid, four clips, no legs. Cells outside the zone
  //      vanish on the first clip (the bearing-clamped field is huge there).
  {
    const xs: number[] = []
    const zs: number[] = []
    for (const p of line) {
      xs.push(p.x)
      zs.push(p.y)
    }
    for (let k = 0; k <= 12; k++) {
      const phi = throat.phiLo + ((throat.phiHi - throat.phiLo) * k) / 12
      xs.push(Math.cos(phi) * R)
      zs.push(Math.sin(phi) * R)
    }
    const pad = POUR_EDGE + 0.3
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minZ = Math.min(...zs) - pad
    const maxZ = Math.max(...zs) + pad
    const CELL = 0.5
    for (let x0 = minX; x0 < maxX; x0 += CELL) {
      for (let z0 = minZ; z0 < maxZ; z0 += CELL) {
        const x1 = x0 + CELL
        const z1 = z0 + CELL
        // Cheap reject before the field: cell centre far outside the band.
        if (throatU((x0 + x1) / 2, (z0 + z1) / 2) > POUR_EDGE + CELL) continue
        const corner = (x: number, z: number): GroundVertex =>
          vert(x, z, streetY(x, z), x, z)
        // Keep-field: inside the band edge OR anywhere the wedge bridge is
        // live — a bridged plateau must be street to its last square metre
        // (the tile trim over it is unresolvable; see throatBridge).
        let cell = clipGround(
          [corner(x0, z0), corner(x0, z1), corner(x1, z1), corner(x1, z0)],
          (x, z) => Math.max(POUR_EDGE - throatU(x, z), throatBridge(x, z) - 0.08),
        )
        if (cell.length >= 3) cell = clipGround(cell, (x, z) => dRingRaw(x, z) - SLOT)
        if (cell.length >= 3) cell = clipGround(cell, (x, z) => dSpurCast(x, z) - SLOT)
        if (cell.length >= 3) cell = clipGround(cell, (x, z) => alongMouth(x, z))
        if (cell.length >= 3 && planArea(cell) > 2e-4) writer.face('paving', cell)
      }
    }
  }

  // ---- trench mouth: a buried skirt per shoulder, seated 20 mm INSIDE the
  //      pour so its top edge lies under the street sheet (no shared line).
  {
    const perp = new Vector2(mouthDir.y, -mouthDir.x)
    const base = mouth.clone().addScaledVector(mouthDir, 0.02)
    const prefer = new Vector3(-mouthDir.x, 0.3, -mouthDir.y)
    for (const [s0, s1] of [
      [-POUR_EDGE, -SLOT],
      [SLOT, POUR_EDGE],
    ] as const) {
      for (let j = 0; j < 3; j++) {
        const a = s0 + ((s1 - s0) * j) / 3
        const b = s0 + ((s1 - s0) * (j + 1)) / 3
        const pa = base.clone().addScaledVector(perp, a)
        const pb = base.clone().addScaledVector(perp, b)
        const ya = streetY(pa.x, pa.y)
        const yb = streetY(pb.x, pb.y)
        oriented(
          'paving',
          [
            vert(pa.x, pa.y, ya, a, 0),
            vert(pb.x, pb.y, yb, b, 0),
            vert(pb.x, pb.y, yb - 0.34, b, -0.34),
            vert(pa.x, pa.y, ya - 0.34, a, -0.34),
          ],
          prefer,
        )
      }
    }
  }

  // ---- THE STRIPS: iso-contour marching on U = STRIP_AT, on the OPEN
  //      field (throatUOpen) — the bearing clamp is a discontinuity, and a
  //      march cannot cross a discontinuity; the stops below end the paths.
  const gradU = (x: number, z: number): Vector2 => {
    const h = 0.02
    return new Vector2(
      (throatUOpen(x + h, z) - throatUOpen(x - h, z)) / (2 * h),
      (throatUOpen(x, z + h) - throatUOpen(x, z - h)) / (2 * h),
    )
  }
  const snap = (p: Vector2): Vector2 => {
    for (let i = 0; i < 4; i++) {
      const d = throatUOpen(p.x, p.y) - STRIP_AT
      if (Math.abs(d) < 5e-4) break
      const g = gradU(p.x, p.y)
      const lengthSq = g.lengthSq() || 1
      p.addScaledVector(g, -d / lengthSq)
    }
    return p
  }
  /** Predictor-corrector march; stops where `inside` first goes negative and
   *  refines the crossing by chord bisection (the last chord is 0.3 m on a
   *  smooth contour — the refined point is on the line to a millimetre). */
  const march = (
    seed: Vector2,
    dir0: Vector2,
    inside: (p: Vector2) => number,
  ): Vector2[] => {
    const pts: Vector2[] = []
    let p = snap(seed.clone())
    let dir = dir0.clone().normalize()
    pts.push(p.clone())
    for (let i = 0; i < 700; i++) {
      const g = gradU(p.x, p.y)
      const t = new Vector2(-g.y, g.x)
      if (t.lengthSq() < 1e-8) break
      t.normalize()
      if (t.dot(dir) < 0) t.multiplyScalar(-1)
      dir = t
      // 0.18 m step: the gore vee turns ~150° over ~0.5 m of arc (the
      // smooth-min rounds it at k/2 ≈ 0.18) — a coarser step chords the apex.
      const q = snap(p.clone().addScaledVector(t, 0.18))
      if (inside(q) < 0) {
        let lo = 0
        let hi = 1
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2
          if (inside(p.clone().lerp(q, mid)) >= 0) lo = mid
          else hi = mid
        }
        pts.push(p.clone().lerp(q, (lo + hi) / 2))
        return pts
      }
      pts.push(q.clone())
      p = q
    }
    return pts
  }
  const stopAtHi = (p: Vector2): number => (throat.phiHi - Math.atan2(p.y, p.x)) * R
  const stopAtLo = (p: Vector2): number => (Math.atan2(p.y, p.x) - throat.phiLo) * R
  const stopAtMouth = (p: Vector2): number => alongMouth(p.x, p.y) - 0.55

  interface StripStation {
    x: number
    z: number
    ox: number
    oz: number
    dive: number
  }
  /** Chaikin ×2 then resample: the union field inherits the spur polyline's
   *  segment kinks, and a specular strip shows every one of them (owner
   *  arrow at the trench bend). Endpoints stay exact — headers and dives
   *  attach there. */
  const fairPath = (pts: Vector2[]): Vector2[] => {
    let current = pts
    for (let pass = 0; pass < 2 && current.length >= 3; pass++) {
      const out: Vector2[] = [current[0].clone()]
      for (let i = 0; i < current.length - 1; i++) {
        out.push(
          current[i].clone().lerp(current[i + 1], 0.25),
          current[i].clone().lerp(current[i + 1], 0.75),
        )
      }
      out.push(current[current.length - 1].clone())
      current = out
    }
    const resampled: Vector2[] = [current[0]]
    for (let i = 1; i < current.length - 1; i++) {
      if (current[i].distanceTo(resampled[resampled.length - 1]) >= 0.22) {
        resampled.push(current[i])
      }
    }
    resampled.push(current[current.length - 1])
    return resampled
  }
  const contourStations = (pts: Vector2[]): StripStation[] =>
    fairPath(pts).map((p) => {
      const g = gradU(p.x, p.y)
      const l = g.length() || 1
      return { x: p.x, z: p.y, ox: g.x / l, oz: g.y / l, dive: 0 }
    })
  /** Trench nose: three stations on along the last direction, sinking the
   *  whole section under the conform dirt (crown − 0.13; the nose bottoms
   *  0.34 under its own crown line). */
  const withDive = (stations: StripStation[]): StripStation[] => {
    if (stations.length < 2) return stations
    const last = stations[stations.length - 1]
    const prev = stations[stations.length - 2]
    const dx = last.x - prev.x
    const dz = last.z - prev.z
    const l = Math.hypot(dx, dz) || 1
    const out: StripStation[] = [...stations]
    for (const [d, dive] of [
      [0.3, 0.3],
      [0.6, 0.7],
      [0.85, 1],
    ] as const) {
      out.push({
        x: last.x + (dx / l) * d,
        z: last.z + (dz / l) * d,
        ox: last.ox,
        oz: last.oz,
        dive,
      })
    }
    return out
  }
  /** Picture-frame header: corner fillet off the contour end, radial leg
   *  along the exact zone bearing, end cap a joint off the cast apron.
   *  `s` +1 outer / −1 inner; `aSign` +1 when the path arrives travelling
   *  toward +φ. Returned corner-first (append; reverse to prepend). */
  const headerFor = (pEnd: Vector2, s: number, aSign: number): StripStation[] => {
    const phiB = Math.atan2(pEnd.y, pEnd.x)
    const rHat = new Vector2(Math.cos(phiB), Math.sin(phiB))
    const A = new Vector2(-Math.sin(phiB), Math.cos(phiB)).multiplyScalar(aSign)
    const T = rHat.clone().multiplyScalar(-s)
    const contourOut = rHat.clone().multiplyScalar(s)
    const FILLET = 0.14
    const centre = pEnd.clone().addScaledVector(A, -FILLET).addScaledVector(T, FILLET)
    const stations: StripStation[] = []
    for (const deg of [0, 30, 60]) {
      const th = (deg * Math.PI) / 180
      const p = centre
        .clone()
        .addScaledVector(T, -Math.cos(th) * FILLET)
        .addScaledVector(A, Math.sin(th) * FILLET)
      const o = contourOut
        .clone()
        .multiplyScalar(Math.cos(th))
        .addScaledVector(A, Math.sin(th))
        .normalize()
      stations.push({ x: p.x, z: p.y, ox: o.x, oz: o.y, dive: 0 })
    }
    for (const offset of [STRIP_AT - FILLET, 1.85, 1.6, CAP_AT]) {
      const p = rHat.clone().multiplyScalar(R + s * offset)
      stations.push({ x: p.x, z: p.y, ox: A.x, oz: A.y, dive: 0 })
    }
    return stations
  }

  const emitStripRun = (stations: StripStation[], capStart: boolean, capEnd: boolean): void => {
    const clean: StripStation[] = []
    for (const st of stations) {
      const previous = clean[clean.length - 1]
      if (previous && Math.hypot(st.x - previous.x, st.z - previous.z) < 0.02) continue
      clean.push(st)
    }
    if (clean.length < 2) return
    const profile = (st: StripStation): Vector3[] => {
      const street = streetY(st.x - st.ox * 0.09, st.z - st.oz * 0.09)
      const tile = slabTop(st.x + st.ox * 0.09, st.z + st.oz * 0.09)
      const drop = st.dive * 0.34
      const top = tile + 0.006 - drop
      const pt = (lateral: number, y: number): Vector3 =>
        new Vector3(st.x + st.ox * lateral, y, st.z + st.oz * lateral)
      return [
        pt(-0.09, street - 0.055 - drop),
        pt(-0.075, top - 0.02),
        pt(-0.052, top),
        pt(0.052, top),
        pt(0.075, top - 0.02),
        pt(0.09, tile - 0.3 - drop),
      ]
    }
    let run = 0
    let previousRun = 0
    let previous = profile(clean[0])
    for (let i = 1; i < clean.length; i++) {
      const st = clean[i]
      const before = clean[i - 1]
      run += Math.hypot(st.x - before.x, st.z - before.z)
      const points = profile(st)
      const outward = new Vector3(
        (before.ox + st.ox) / 2,
        1.1,
        (before.oz + st.oz) / 2,
      )
      for (let k = 0; k < points.length - 1; k++) {
        oriented(
          'concrete',
          [
            vert(previous[k].x, previous[k].z, previous[k].y, previousRun, k * 0.1),
            vert(points[k].x, points[k].z, points[k].y, run, k * 0.1),
            vert(points[k + 1].x, points[k + 1].z, points[k + 1].y, run, (k + 1) * 0.1),
            vert(previous[k + 1].x, previous[k + 1].z, previous[k + 1].y, previousRun, (k + 1) * 0.1),
          ],
          outward,
        )
      }
      previous = points
      previousRun = run
    }
    const cap = (index: number, forward: boolean): void => {
      const st = clean[index]
      const other = clean[forward ? index - 1 : index + 1]
      const travel = new Vector3(st.x - other.x, 0, st.z - other.z)
      const ring = profile(st).map((p, k) => vert(p.x, p.z, p.y, 0, k * 0.1))
      oriented('concrete', ring, travel)
    }
    if (capStart) cap(0, false)
    if (capEnd) cap(clean.length - 1, true)
  }

  // P_inner — the park-side edging: one arc, headers both ends. The
  // contour's boundary points are dropped where a header takes over — the
  // fillet's θ=0 station stands exactly there, and keeping both would fold
  // the sweep back on itself at every corner.
  {
    const mid = (throat.phiLo + throat.phiHi) / 2
    const seed = new Vector2(Math.cos(mid), Math.sin(mid)).multiplyScalar(R - STRIP_AT)
    const west = march(seed, new Vector2(-Math.sin(mid), Math.cos(mid)), stopAtHi)
    const east = march(seed, new Vector2(Math.sin(mid), -Math.cos(mid)), stopAtLo)
    const path = [...east.slice(1).reverse(), ...west]
    if (path.length >= 4) {
      const stations = [
        ...headerFor(path[0], -1, -1).reverse(),
        ...contourStations(path.slice(1, -1)),
        ...headerFor(path[path.length - 1], -1, 1),
      ]
      emitStripRun(stations, true, true)
    }
  }
  // P_outer — the outer envelope: phiHi header, tangential hand-off onto the
  // spur's outer side, trench dive.
  let outerContour: Vector2[]
  {
    const at = throat.phiHi - 0.6 / R
    const seed = new Vector2(Math.cos(at), Math.sin(at)).multiplyScalar(R + STRIP_AT)
    const west = march(seed, new Vector2(-Math.sin(at), Math.cos(at)), stopAtHi)
    const east = march(seed, new Vector2(Math.sin(at), -Math.cos(at)), stopAtMouth)
    outerContour = [...east.slice(1).reverse(), ...west]
    if (outerContour.length >= 4) {
      const noseFirst = withDive(
        contourStations(outerContour.slice(1).reverse()),
      ).reverse()
      const stations = [
        ...noseFirst,
        ...headerFor(outerContour[outerContour.length - 1], 1, 1),
      ]
      emitStripRun(stations, true, true)
    }
  }
  // P_gore — the vee between the diverging ways: phiLo header, round the
  // cusp (the smooth-min rounds it at strip scale), trench dive. Skipped if
  // the ways never separate inside the zone (the seed would land on the
  // outer envelope).
  {
    const at = throat.phiLo + 0.4 / R
    const seed = snap(
      new Vector2(Math.cos(at), Math.sin(at)).multiplyScalar(R + STRIP_AT),
    )
    let onOuter = false
    for (const p of outerContour) {
      if (Math.hypot(p.x - seed.x, p.y - seed.y) < 0.4) {
        onOuter = true
        break
      }
    }
    if (!onOuter) {
      const west = march(seed, new Vector2(-Math.sin(at), Math.cos(at)), stopAtMouth)
      const east = march(seed, new Vector2(Math.sin(at), -Math.cos(at)), stopAtLo)
      const path = [...west.slice(1).reverse(), ...east]
      if (path.length >= 4) {
        const noseFirst = withDive(
          contourStations(path.slice(1).reverse()),
        ).reverse()
        const stations = [
          ...noseFirst,
          ...headerFor(path[path.length - 1], 1, -1),
        ]
        emitStripRun(stations, true, true)
      }
    }
  }
}

// ----------------------------------------------------------------- build ---

export function buildPaving(): PavingBuild {
  const writer = new GroundWriter()
  const colliders: PavingColliderSpec[] = []
  const lightRuns: BoundaryStation[][] = []

  for (const region of PAVED_REGIONS) {
    if (
      region.id === 'guideway-channel' ||
      region.id.startsWith('spur-corridor') ||
      region.id.startsWith('turnout-street')
    ) {
      continue
    }
    switch (region.kind) {
      case 'disc':
        emitPolarSurface(writer, region, region.cx, region.cz, 0, region.radius)
        break
      case 'annulus':
        emitPolarSurface(writer, region, region.cx, region.cz, region.rInner, region.rOuter)
        break
      case 'rect':
        emitRectSurface(writer, region)
        break
      case 'ribbon':
        emitRibbonSurface(writer, region)
        break
    }
  }

  for (const region of PAVED_REGIONS) {
    if (!region.curb) continue
    emitEdgework(writer, region, lightRuns)
  }

  emitGuidewayChannel(writer)
  emitSpurCorridor(writer)
  emitThroatGround(writer)
  emitFloorLights(writer, lightRuns)
  emitPlanters(writer, colliders)

  const materials: Record<string, Material> = {
    paving: createPavingMaterial(),
    concrete: createConcreteMaterial(),
    channel: createChannelMaterial(),
    pathLightBezel: createBezelMaterial(),
    pathLight: createLensMaterial(),
    plantSoil: soilBed(),
  }
  const triangles = writer.triangleCount()
  const group = writer.build(materials, { castShadow: false })
  // Most paving stays shadowless: the slabs are the receiving surface and do
  // not need to spend shadow budget casting onto each other. The raised
  // concrete package includes the planter walls, curbs and steps, and those do
  // need to shade the ground so the sun read matches the vegetation growing in
  // them.
  for (const child of group.children) {
    if (child.name === 'ground:concrete') child.castShadow = true
  }
  group.name = 'paving'
  return { group, colliders, triangles }
}
