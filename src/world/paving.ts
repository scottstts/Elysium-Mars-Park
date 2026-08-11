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
import { groundGrade, spurTrackDatum } from './interiorHeight'
import {
  CURB,
  GUIDEWAY_CHANNEL,
  PAVE,
  PAVED_REGIONS,
  PLANTER,
  PLANTERS,
  coveringRegion,
  insideGuidewayChannel,
  insidePlanter,
  insideSpurCorridor,
  pavedSignedDistance,
  pavedTraffic,
  regionDistance,
  spurCorridorDistance,
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

/** The slab top at a point: the ONE definition of the paved datum. */
export function slabTop(x: number, z: number): number {
  return groundGrade(x, z) + PAVE.rise
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

/** How far a crossed cell may subdivide before its centre simply decides. */
const MAX_TRIM_DEPTH = 4
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
  vertex.edge = 0
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
  // The channel floor is radially dished (slabTop falls toward the ring). At
  // the turnout mouth it eases down onto the corridor's constant level so the
  // two floors meet without a step; elsewhere the dish is untouched.
  const corridorLevel =
    groundGrade(0, GUIDEWAY_CHANNEL.radius) + PAVE.rise - GUIDEWAY_CHANNEL.recess - 0.01
  const floorY = (x: number, z: number): number => {
    const dished = slabTop(x, z) - GUIDEWAY_CHANNEL.recess
    // Smooth by true corridor distance: a stepped blend tears the floor into
    // shards where adjacent vertices land on different levels.
    const d = spurCorridorDistance(x, z)
    if (d >= 0.9) return dished
    const t = Math.min(1, (0.9 - d) / 1.2)
    const eased = t * t * (3 - 2 * t)
    return dished + (Math.min(dished, corridorLevel) - dished) * eased
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
  const radialSteps = 3
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU
    const a1 = ((i + 1) / steps) * TAU
    for (let j = 0; j < radialSteps; j++) {
      const ra = rInner + ((rOuter - rInner) * j) / radialSteps
      const rb = rInner + ((rOuter - rInner) * (j + 1)) / radialSteps
      writer.face('channel', [
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
      writer.face('channel', outward < 0 ? corners : [...corners].reverse())
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
  for (const id of ['spur-corridor', 'spur-corridor-promenade']) emitSpurCut(writer, id)
}

function emitSpurCut(writer: GroundWriter, id: string): void {
  const region = PAVED_REGIONS.find((entry) => entry.id === id)
  if (!region || region.kind !== 'ribbon') return
  const line = region.line
  const half = region.halfWidth
  // The crown datum comes from the spur's own ground truth; the fallback is
  // the ring street level (only reachable if a ribbon strays past the tail's
  // bounding box, which the plan construction prevents). 10 mm below the
  // crown, so floor and crown are never coplanar.
  const fallback = groundGrade(0, GUIDEWAY_CHANNEL.radius) + PAVE.rise - GUIDEWAY_CHANNEL.recess
  const floorAt = (x: number, z: number): number => (spurTrackDatum(x, z)?.y ?? fallback) - 0.01
  const steps = Math.round((TAU * GUIDEWAY_CHANNEL.radius) / 1.4)
  const rOuter = GUIDEWAY_CHANNEL.radius + GUIDEWAY_CHANNEL.width / 2
  // The corridor approaches the ring from outside: > 0 = clear of the channel.
  const clear = (x: number, z: number): number => ngonSigned(0, 0, rOuter, steps, x, z)
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
      const floorA = floorAt(pa.x, pa.z)
      const floorB = floorAt(pb.x, pb.z)
      const topA = Math.max(floorA, slabTop(pa.x, pa.z))
      const topB = Math.max(floorB, slabTop(pb.x, pb.z))
      if (topA - floorA < 0.012 && topB - floorB < 0.012) continue
      const wall = clipGround(
        [
          wallVertex(i, s * half, floorA),
          wallVertex(i + 1, s * half, floorB),
          wallVertex(i + 1, s * half, topB),
          wallVertex(i, s * half, topA),
        ],
        clear,
      )
      if (wall.length >= 3) writer.face('channel', s > 0 ? wall : [...wall].reverse())
    }
  }
}

// ----------------------------------------------------------------- build ---

export function buildPaving(): PavingBuild {
  const writer = new GroundWriter()
  const colliders: PavingColliderSpec[] = []
  const lightRuns: BoundaryStation[][] = []

  for (const region of PAVED_REGIONS) {
    if (region.id === 'guideway-channel' || region.id.startsWith('spur-corridor')) continue
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
  group.name = 'paving'
  return { group, colliders, triangles }
}
