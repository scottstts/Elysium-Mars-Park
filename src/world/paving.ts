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
import { groundGrade } from './interiorHeight'
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
  pavedSignedDistance,
  pavedTraffic,
  projectToBoundary,
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
 * Overlap policy (the one rule that keeps this z-fight free): paved regions
 * are PRIORITISED, and a lower-priority slab's vertices are PROJECTED onto the
 * boundary of any higher-priority region that contains them. Two slabs never
 * stack at the same datum, and because the projection is exact the junction
 * closes with no gap — a spoke butts the plaza on the plaza's own circle.
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
  /** Index of the higher-priority region this vertex was trimmed against. */
  trimmedBy: number
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

const scratchProjection = new Vector2()

/** Trim a slab vertex against every higher-priority region. */
function trim(vertex: PaveVertex, priority: number): PaveVertex {
  const index = coveringRegion(vertex.x, vertex.z, priority)
  if (index < 0) return vertex
  const projected = projectToBoundary(PAVED_REGIONS[index], vertex.x, vertex.z, scratchProjection)
  vertex.x = projected.x
  vertex.z = projected.y
  vertex.edge = 0
  vertex.trimmedBy = index
  return vertex
}

function quadArea(a: PaveVertex, b: PaveVertex, c: PaveVertex, d: PaveVertex): number {
  const cross = (
    p: PaveVertex,
    q: PaveVertex,
    r: PaveVertex,
  ): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)
  return (Math.abs(cross(a, b, c)) + Math.abs(cross(a, c, d))) * 0.5
}

function emitSlabQuad(
  writer: GroundWriter,
  a: PaveVertex,
  b: PaveVertex,
  c: PaveVertex,
  d: PaveVertex,
): void {
  // Wholly swallowed by one higher-priority pour, or collapsed by the
  // projection into a sliver: drop it rather than ship a shading artefact.
  if (
    a.trimmedBy >= 0 &&
    a.trimmedBy === b.trimmedBy &&
    b.trimmedBy === c.trimmedBy &&
    c.trimmedBy === d.trimmedBy
  ) {
    return
  }
  if (quadArea(a, b, c, d) < 0.05) return
  writer.face('paving', [
    toGroundVertex(a),
    toGroundVertex(b),
    toGroundVertex(c),
    toGroundVertex(d),
  ])
}

// ------------------------------------------------------ region surfaces ----

const TAU = Math.PI * 2

/** Panels per ring at this radius, so a ring band's panels stay near-square. */
function ringPanels(radius: number): number {
  return Math.max(6, Math.round((TAU * radius) / PAVE.panel))
}

/**
 * Concentric ring bands. Ring joints land on multiples of PAVE.panel measured
 * from the centre; radial joints subdivide each band into whole panels, and
 * `v` is authored so those land on multiples of PAVE.panel too — one shader,
 * no per-surface branching, joint widths still true metres.
 */
function emitPolarSurface(
  writer: GroundWriter,
  region: Region,
  cx: number,
  cz: number,
  rInner: number,
  rOuter: number,
): void {
  const firstBand = Math.floor(rInner / PAVE.panel)
  const lastBand = Math.ceil(rOuter / PAVE.panel)
  for (let band = firstBand; band < lastBand; band++) {
    const r0 = Math.max(rInner, band * PAVE.panel)
    const r1 = Math.min(rOuter, (band + 1) * PAVE.panel)
    if (r1 - r0 < 0.02) continue
    const rMid = (r0 + r1) * 0.5
    const panels = ringPanels(rMid)
    const angularSteps = panels * 2
    const radialSteps = Math.max(1, Math.round((r1 - r0) / 1.7))
    const vScale = (panels * PAVE.panel) / TAU

    const vertexAt = (r: number, angle: number): PaveVertex => {
      const edgeOuter = rOuter - r
      const edgeInner = rInner > 0 ? r - rInner : Number.POSITIVE_INFINITY
      const edge = Math.min(edgeOuter, edgeInner)
      const alongRadius = edgeOuter <= edgeInner ? rOuter : rInner
      return trim(
        {
          x: cx + Math.cos(angle) * r,
          z: cz + Math.sin(angle) * r,
          u: r,
          v: angle * vScale,
          edge,
          along: angle * alongRadius,
          trimmedBy: -1,
        },
        region.priority,
      )
    }

    for (let i = 0; i < radialSteps; i++) {
      const ra = r0 + ((r1 - r0) * i) / radialSteps
      const rb = r0 + ((r1 - r0) * (i + 1)) / radialSteps
      for (let j = 0; j < angularSteps; j++) {
        const a0 = (j / angularSteps) * TAU
        const a1 = ((j + 1) / angularSteps) * TAU
        // Angular-then-radial: tangential × radial = +Y, so the slab faces up
        // and survives back-face culling.
        emitSlabQuad(
          writer,
          vertexAt(ra, a0),
          vertexAt(ra, a1),
          vertexAt(rb, a1),
          vertexAt(rb, a0),
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
  const vertexAt = (ix: number, iz: number): PaveVertex => {
    const u = (region.halfX * 2 * ix) / stepsX
    const v = (region.halfZ * 2 * iz) / stepsZ
    const x = region.cx - region.halfX + u
    const z = region.cz - region.halfZ + v
    const edgeX = Math.min(u, region.halfX * 2 - u)
    const edgeZ = Math.min(v, region.halfZ * 2 - v)
    return trim(
      {
        x,
        z,
        u,
        v,
        edge: Math.min(edgeX, edgeZ),
        along: edgeX <= edgeZ ? v : u,
        trimmedBy: -1,
      },
      region.priority,
    )
  }
  for (let iz = 0; iz < stepsZ; iz++) {
    for (let ix = 0; ix < stepsX; ix++) {
      emitSlabQuad(
        writer,
        vertexAt(ix, iz),
        vertexAt(ix, iz + 1),
        vertexAt(ix + 1, iz + 1),
        vertexAt(ix + 1, iz),
      )
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

function emitRibbonSurface(writer: GroundWriter, region: Region & { kind: 'ribbon' }): void {
  const frames = ribbonFrames(region.line)
  const spans = Math.max(4, Math.round(region.halfWidth * 2 / 1.15))
  const vertexAt = (frame: RibbonFrame, span: number): PaveVertex => {
    const lateral = -region.halfWidth + (region.halfWidth * 2 * span) / spans
    return trim(
      {
        x: frame.x + frame.nx * lateral,
        z: frame.z + frame.nz * lateral,
        u: frame.run,
        v: lateral,
        edge: region.halfWidth - Math.abs(lateral),
        along: frame.run,
        trimmedBy: -1,
      },
      region.priority,
    )
  }
  for (let i = 0; i < frames.length - 1; i++) {
    for (let s = 0; s < spans; s++) {
      emitSlabQuad(
        writer,
        vertexAt(frames[i], s),
        vertexAt(frames[i], s + 1),
        vertexAt(frames[i + 1], s + 1),
        vertexAt(frames[i + 1], s),
      )
    }
  }
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
    for (let i = 0; i < steps; i++) {
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
  [0.05, 0.004],
  [-0.05, 0.004],
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
  const probeX = station.x + station.outX * 0.34
  const probeZ = station.z + station.outZ * 0.34
  return pavedSignedDistance(probeX, probeZ) > -0.02
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
      if (pavedSignedDistance(x, z) > -0.2) continue
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
      const lensY = baseY + 0.01
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
    for (let i = 0; i <= arcSteps; i++) {
      const angle = planter.a0 + ((planter.a1 - planter.a0) * i) / arcSteps
      push(
        planter.cx + Math.cos(angle) * outerR,
        planter.cz + Math.sin(angle) * outerR,
        Math.cos(angle),
        Math.sin(angle),
      )
    }
    const endSteps = Math.max(2, Math.round((outerR - innerR) / 0.8))
    for (let i = 1; i <= endSteps; i++) {
      const t = i / endSteps
      const r = outerR + (innerR - outerR) * t
      const angle = planter.a1
      push(
        planter.cx + Math.cos(angle) * r,
        planter.cz + Math.sin(angle) * r,
        -Math.sin(angle),
        Math.cos(angle),
      )
    }
    for (let i = arcSteps; i >= 0; i--) {
      const angle = planter.a0 + ((planter.a1 - planter.a0) * i) / arcSteps
      push(
        planter.cx + Math.cos(angle) * innerR,
        planter.cz + Math.sin(angle) * innerR,
        -Math.cos(angle),
        -Math.sin(angle),
      )
    }
    for (let i = 1; i < endSteps; i++) {
      const t = i / endSteps
      const r = innerR + (outerR - innerR) * t
      const angle = planter.a0
      push(
        planter.cx + Math.cos(angle) * r,
        planter.cz + Math.sin(angle) * r,
        Math.sin(angle),
        -Math.cos(angle),
      )
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
        yaw: Math.atan2(Math.cos(mid), -Math.sin(mid)),
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
  const floorY = (x: number, z: number): number => slabTop(x, z) - GUIDEWAY_CHANNEL.recess
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

// ----------------------------------------------------------------- build ---

export function buildPaving(): PavingBuild {
  const writer = new GroundWriter()
  const colliders: PavingColliderSpec[] = []
  const lightRuns: BoundaryStation[][] = []

  for (const region of PAVED_REGIONS) {
    if (region.id === 'guideway-channel') continue
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
