import { CatmullRomCurve3, Vector2, Vector3 } from 'three'
import {
  ARRIVAL_SPINE,
  BOULEVARD,
  COMMONS,
  FIRST_TREE,
  HYDRO_TOWER,
  LOOP,
  OVERLOOK_LOUNGE,
  PARK,
  PATHS,
  PORTAL_STATION,
} from './parkPlan'

/**
 * THE PAVED CIVIC FLOOR — plan layer (ref_images/mars_park.png).
 *
 * `parkPlan.ts` says WHERE the park's circulation goes; this module says what
 * is actually PAVED, at what datum, and how the paving meets the regolith.
 * It is a pure plan/field module: no three geometry beyond Vector2/3 maths, no
 * materials. `interiorHeight.ts` reads it for the walkable datum, `paving.ts`
 * builds the surfaces from it, `groundworks.ts` reads it for the regolith's
 * dust band and relief suppression.
 *
 * DATUM DISCIPLINE (geometry-craft §3). Three named levels, never re-derived:
 *   groundGrade(x,z)        the regolith surface (what the floor mesh draws)
 *   + PAVE.rise             the paved slab TOP  = interiorHeight() on paving
 *   + CURB.reveal           the curb top
 * Everything that stands on paving takes its Y from `interiorHeight`, which
 * already carries the lift — nothing adds PAVE.rise a second time.
 */

/** Paving datums (metres). */
export const PAVE = {
  /** Slab top above the local regolith grade. */
  rise: 0.075,
  /** Grade ramp width outside a paved boundary (dust banking up to the curb). */
  edgeFade: 0.62,
  /** Slab mesh stops this far inside the region boundary so the curb's outer
   *  face and the slab's skirt are never coplanar (geometry-craft §3). */
  slabInset: 0.06,
  /** Slab skirt depth below its own top. */
  skirt: 0.36,
  /** Panel module: expansion joints land on this grid. */
  panel: 3.25,
  /** Expansion-joint width (recessed). */
  joint: 0.028,
  /** Border-course width along every paved edge. */
  border: 0.52,
  /** Border-course cross-joint pitch. */
  borderPitch: 1.06,
} as const

/** Precast white-concrete curb section. Heights are relative to the slab top. */
export const CURB = {
  halfWidth: 0.115,
  /** Standing height above the paving. */
  reveal: 0.135,
  /** How far the section is bedded into the slab (a real joint, not a rest). */
  bed: 0.045,
  /** Total depth below the slab top — buried well under the regolith. */
  root: 0.36,
  chamfer: 0.024,
} as const

/** Planter walls: 0.52 m white concrete with a proud coping (ref image). */
export const PLANTER = {
  wall: 0.2,
  /** Coping top above the paving. */
  rimY: 0.52,
  /** Soil surface below the coping top — a real reveal, never flush. */
  soilDrop: 0.14,
  copingOverhang: 0.035,
  copingThickness: 0.075,
} as const

/**
 * The street-running Loop crosses the boulevard paving in a recessed concrete
 * channel; the track agent insets rails into it (they own the rails, this
 * module owns the channel).
 */
export const GUIDEWAY_CHANNEL = {
  radius: LOOP.radius,
  width: 3.2,
  /** Trackbed crown below the boulevard paving surface. */
  recess: 0.06,
  /**
   * Gutter: the channel/corridor floors sit this far below the CROWN datum
   * (crown = slabTop − recess on the ring, spurTrackDatum on the spur). This
   * must stay LARGER than the mutual sampling error of the two meshes that
   * meet here: the trackbed cast snaps its crown to the datum per sweep
   * station, the floor pours per-vertex on its own grid, and at near-zero
   * separation their interpolation differences z-fight as random patches
   * (owner finding — the beige/grey mush). 70 mm also reads as a real drain
   * gutter beside an embedded trackbed.
   */
  gutter: 0.07,
  /** Chamfered lip where the paving drops into the channel. */
  lip: 0.09,
} as const

export type Region =
  | { kind: 'disc'; id: string; priority: number; cx: number; cz: number; radius: number; curb: boolean }
  | {
      kind: 'annulus'
      id: string
      priority: number
      cx: number
      cz: number
      rInner: number
      rOuter: number
      curb: boolean
    }
  | {
      kind: 'rect'
      id: string
      priority: number
      cx: number
      cz: number
      halfX: number
      halfZ: number
      curb: boolean
    }
  | {
      kind: 'ribbon'
      id: string
      priority: number
      /** Resampled centreline (world XZ), ~1.1 m stations. */
      line: Vector2[]
      halfWidth: number
      curb: boolean
    }

const TAU = Math.PI * 2

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Resample a parkPlan path onto even stations, optionally running past its ends. */
function ribbonLine(points: Vector2[], extendStart: number, extendEnd: number): Vector2[] {
  const control = points.map((p) => new Vector3(p.x, 0, p.y))
  const closed = points[0].distanceTo(points[points.length - 1]) < 0.01
  if (closed) control.pop()
  const curve = new CatmullRomCurve3(control, closed, 'centripetal', 0.5)
  const length = curve.getLength()
  const steps = Math.max(6, Math.round(length / 1.1))
  const line: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const p = curve.getPointAt(i / steps)
    line.push(new Vector2(p.x, p.z))
  }
  if (closed) line.push(line[0].clone())
  if (!closed && extendStart > 0) {
    const dir = line[0].clone().sub(line[1]).normalize()
    const stations = Math.max(1, Math.round(extendStart / 1.1))
    for (let i = 1; i <= stations; i++) {
      line.unshift(line[0].clone().addScaledVector(dir, extendStart / stations))
    }
  }
  if (!closed && extendEnd > 0) {
    const last = line.length - 1
    const dir = line[last].clone().sub(line[last - 1]).normalize()
    const stations = Math.max(1, Math.round(extendEnd / 1.1))
    for (let i = 1; i <= stations; i++) {
      line.push(line[line.length - 1].clone().addScaledVector(dir, extendEnd / stations))
    }
  }
  return line
}

/**
 * Ribbon extensions. parkPlan authors path spines that stop just short of the
 * plaza / boulevard / rim so nothing overlaps; paving needs the opposite —
 * runs that push INTO the neighbouring surface and get trimmed exactly on its
 * boundary, so the network reads as one continuous pour with no seam gaps.
 */
const RIBBON_RUNOUT: Record<string, [number, number]> = {
  'meridian-south': [4, 4],
  'meridian-west': [4, 6],
  'residential-lane': [8, 0],
  'farm-lane': [4, 0],
  'amphitheater-spur': [4, 0],
}

function buildRegions(): Region[] {
  const list: Region[] = []

  // The civic centre: one disc around the First Tree, concentric panels.
  list.push({
    kind: 'disc',
    id: 'plaza',
    priority: 100,
    cx: FIRST_TREE.x,
    cz: FIRST_TREE.z,
    radius: FIRST_TREE.plazaRadius,
    curb: true,
  })

  // The tram channel cuts THROUGH every other pour (priority just under the
  // plaza), so the street-running Loop is never interrupted by a forecourt.
  list.push({
    kind: 'annulus',
    id: 'guideway-channel',
    priority: 99,
    cx: 0,
    cz: 0,
    rInner: GUIDEWAY_CHANNEL.radius - GUIDEWAY_CHANNEL.width / 2,
    rOuter: GUIDEWAY_CHANNEL.radius + GUIDEWAY_CHANNEL.width / 2,
    curb: false,
  })

  // The station terrace: a rectangular forecourt over the boulevard at the
  // portal stop. Kept clear of the 'station-foot' pad (z 80–92), whose 0.45 m
  // datum would otherwise dish the middle of a poured terrace.
  list.push({
    kind: 'rect',
    id: 'station-terrace',
    priority: 95,
    cx: PORTAL_STATION.x,
    cz: PORTAL_STATION.z + 2.5,
    halfX: 19,
    halfZ: 8.5,
    curb: true,
  })

  // District aprons — buildings front onto paving, never onto raw regolith.
  const aprons: Array<[string, number, number, number]> = [
    ['commons-apron', COMMONS.x, COMMONS.z, COMMONS.radius + 4.5],
    ['hydro-apron', HYDRO_TOWER.x, HYDRO_TOWER.z, HYDRO_TOWER.radius + 4.5],
    ['overlook-apron', OVERLOOK_LOUNGE.x, OVERLOOK_LOUNGE.z, 12.5],
  ]
  for (const [id, cx, cz, radius] of aprons) {
    list.push({ kind: 'disc', id, priority: 70, cx, cz, radius, curb: true })
  }
  // Farmside works its glasshouse frontage as a long apron, not a disc.
  list.push({
    kind: 'rect',
    id: 'farmside-apron',
    priority: 70,
    cx: 70,
    cz: 0,
    halfX: 6.5,
    halfZ: 27,
    curb: true,
  })

  // The transit boulevard: the widest paved band in the park.
  list.push({
    kind: 'annulus',
    id: 'boulevard',
    priority: 60,
    cx: 0,
    cz: 0,
    rInner: BOULEVARD.innerRadius,
    rOuter: BOULEVARD.outerRadius,
    curb: true,
  })

  // The rim promenade is authored in parkPlan as a 25-point circle; as a
  // paved surface it IS a circle, so it is built analytically (an exact
  // annulus beats a resampled polygon for both the field and the mesh).
  const promenade = PATHS.find((path) => path.id === 'rim-promenade')
  if (promenade) {
    list.push({
      kind: 'annulus',
      id: 'rim-promenade',
      priority: 55,
      cx: 0,
      cz: 0,
      rInner: PARK.rimWalkRadius - promenade.width / 2,
      rOuter: PARK.rimWalkRadius + promenade.width / 2,
      curb: true,
    })
  }

  // Spokes. 'track' surfaces stay unpaved — compacted fines are a REGOLITH
  // wear state (groundworks paints them), not a separate slab.
  for (const path of PATHS) {
    if (path.surface !== 'paver' || path.id === 'rim-promenade') continue
    const [extendStart, extendEnd] = RIBBON_RUNOUT[path.id] ?? [0, 0]
    list.push({
      kind: 'ribbon',
      id: path.id,
      priority: 40,
      line: ribbonLine(path.points, extendStart, extendEnd),
      halfWidth: path.width / 2,
      curb: true,
    })
  }

  // The arrival spur's recessed corridor across the boulevard band — the
  // turnout's counterpart of the guideway channel (same recess, same width,
  // paving.ts emits its floor+lips; the track agent lays the trackbed and
  // rails into it). Clipped to the EXISTING paved cover: the corridor region
  // feeds the walkable-datum field like any region, so a run past the band
  // edge would grade the regolith trench up to slab datum.
  {
    // The FULL spine, not a tail subset: a Catmull-Rom through a subset loses
    // the upstream control points' pull on the end tangents and bows metres
    // off the true alignment — the corridors must sit exactly under the
    // trackbed the track agent sweeps from these same stations.
    const spine = ARRIVAL_SPINE.map(([x, z]) => new Vector2(x, z))
    const sampled = ribbonLine(spine, 0, 0)
    const covered = (p: Vector2): boolean =>
      list.some(
        (region) =>
          region.id !== 'guideway-channel' &&
          region.priority < 98 &&
          regionDistance(region, p.x, p.y) < -0.05,
      ) || Math.abs(p.length() - GUIDEWAY_CHANNEL.radius) < GUIDEWAY_CHANNEL.width / 2
    // The boulevard corridor is the CONTIGUOUS covered run that ends at the
    // channel — marched backward from the loop end. A forward findIndex would
    // latch onto the rim-promenade crossing 10 m upstream and pave the
    // regolith gap between the two bands.
    let first = -1
    for (let i = sampled.length - 1; i >= 0; i--) {
      if (covered(sampled[i])) first = i
      else if (first >= 0) break
    }
    if (first >= 0) {
      const line = sampled.slice(first)
      if (first > 0 && line.length >= 2) {
        // One overhang station past the band edge, so the corridor mouth
        // meets the regolith trench instead of leaving a buried strip.
        const dir = sampled[first].clone().sub(sampled[first + 1]).normalize()
        line.unshift(sampled[first].clone().addScaledVector(dir, 0.35))
      }
      if (line.length >= 2) {
        list.push({
          kind: 'ribbon',
          id: 'spur-corridor',
          priority: 98,
          line,
          // Width to the OUTSIDE of the chamfered lip: paving trims to the
          // lip's arris, the cut's walls stand at width/2 and the 90 mm
          // chamfer bridges between them (same move as the channel's
          // footprint reaching past its plan by `lip`).
          halfWidth: GUIDEWAY_CHANNEL.width / 2 + GUIDEWAY_CHANNEL.lip,
          curb: false,
        })
      }
    }
    // The rim-promenade crossing gets the same treatment: without a cut the
    // trackbed submarines ~50 mm under the walk and the promenade kerbs died
    // 0.2–0.4 m short of it into bare regolith (continuity-audit finding).
    // The ribbon is the contiguous stretch of the spine covered by the
    // promenade annulus, run 0.5 m past both edges so the cut mouths open
    // into the trench.
    const promenade = list.find((region) => region.id === 'rim-promenade')
    if (promenade) {
      let i0 = -1
      let i1 = -1
      for (let i = 0; i < sampled.length; i++) {
        if (regionDistance(promenade, sampled[i].x, sampled[i].y) < -0.01) {
          if (i0 < 0) i0 = i
          i1 = i
        } else if (i0 >= 0) break
      }
      if (i0 > 0 && i1 > i0 && i1 < sampled.length - 1) {
        const line = sampled.slice(i0, i1 + 1)
        const head = sampled[i0].clone().sub(sampled[i0 + 1]).normalize()
        line.unshift(sampled[i0].clone().addScaledVector(head, 0.5))
        const tail = sampled[i1].clone().sub(sampled[i1 - 1]).normalize()
        line.push(sampled[i1].clone().addScaledVector(tail, 0.5))
        list.push({
          kind: 'ribbon',
          id: 'spur-corridor-promenade',
          priority: 98,
          line,
          halfWidth: GUIDEWAY_CHANNEL.width / 2 + GUIDEWAY_CHANNEL.lip,
          curb: false,
        })
      }
    }
  }

  return list
}

export const PAVED_REGIONS: Region[] = buildRegions()

// ---------------------------------------------------------------- field ----

/** Signed distance to a region boundary: negative inside, metres. */
export function regionDistance(region: Region, x: number, z: number): number {
  switch (region.kind) {
    case 'disc':
      return Math.hypot(x - region.cx, z - region.cz) - region.radius
    case 'annulus': {
      const d = Math.hypot(x - region.cx, z - region.cz)
      return Math.max(region.rInner - d, d - region.rOuter)
    }
    case 'rect': {
      const dx = Math.abs(x - region.cx) - region.halfX
      const dz = Math.abs(z - region.cz) - region.halfZ
      return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
    }
    case 'ribbon':
      return polylineDistance(region.line, x, z) - region.halfWidth
  }
}

/** Nearest point ON the region boundary — used to trim lower-priority slabs. */
export function projectToBoundary(region: Region, x: number, z: number, out: Vector2): Vector2 {
  switch (region.kind) {
    case 'disc': {
      const dx = x - region.cx
      const dz = z - region.cz
      const d = Math.hypot(dx, dz) || 1e-6
      return out.set(region.cx + (dx / d) * region.radius, region.cz + (dz / d) * region.radius)
    }
    case 'annulus': {
      const dx = x - region.cx
      const dz = z - region.cz
      const d = Math.hypot(dx, dz) || 1e-6
      const radius =
        d - region.rInner < region.rOuter - d ? region.rInner : region.rOuter
      return out.set(region.cx + (dx / d) * radius, region.cz + (dz / d) * radius)
    }
    case 'rect': {
      const dx = x - region.cx
      const dz = z - region.cz
      const overX = region.halfX - Math.abs(dx)
      const overZ = region.halfZ - Math.abs(dz)
      if (overX < overZ) return out.set(region.cx + Math.sign(dx || 1) * region.halfX, z)
      return out.set(x, region.cz + Math.sign(dz || 1) * region.halfZ)
    }
    case 'ribbon': {
      const near = nearestOnPolyline(region.line, x, z)
      const dx = x - near.x
      const dz = z - near.y
      const d = Math.hypot(dx, dz)
      if (d < 1e-5) return out.set(near.x + region.halfWidth, near.y)
      return out.set(
        near.x + (dx / d) * region.halfWidth,
        near.y + (dz / d) * region.halfWidth,
      )
    }
  }
}

const scratchNear = new Vector2()

function polylineDistance(line: Vector2[], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = segmentDistanceSq(line[i], line[i + 1], x, z)
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

function nearestOnPolyline(line: Vector2[], x: number, z: number): Vector2 {
  let best = Infinity
  let bx = line[0].x
  let bz = line[0].y
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const abx = b.x - a.x
    const abz = b.y - a.y
    const lengthSq = abx * abx + abz * abz
    const t =
      lengthSq === 0 ? 0 : clamp01(((x - a.x) * abx + (z - a.y) * abz) / lengthSq)
    const px = a.x + abx * t
    const pz = a.y + abz * t
    const d = (x - px) * (x - px) + (z - pz) * (z - pz)
    if (d < best) {
      best = d
      bx = px
      bz = pz
    }
  }
  return scratchNear.set(bx, bz)
}

function segmentDistanceSq(a: Vector2, b: Vector2, x: number, z: number): number {
  const abx = b.x - a.x
  const abz = b.y - a.y
  const lengthSq = abx * abx + abz * abz
  const t = lengthSq === 0 ? 0 : clamp01(((x - a.x) * abx + (z - a.y) * abz) / lengthSq)
  const px = a.x + abx * t
  const pz = a.y + abz * t
  return (x - px) * (x - px) + (z - pz) * (z - pz)
}

// --- broadphase -------------------------------------------------------------
// interiorHeight() calls the field for every floor vertex, every heightfield
// sample and every placed prop; a naive all-segment scan costs tens of
// millions of ops at load. One uniform bucket grid over the dome footprint
// makes every query touch a handful of candidates.

const GRID_CELL = 7
const GRID_HALF = 150
const GRID_SIZE = Math.ceil((GRID_HALF * 2) / GRID_CELL)
/** Per cell: analytic region indices, then (regionIndex, segmentIndex) pairs. */
const cellRegions: number[][] = []
const cellSegments: number[][] = []

function cellIndex(ix: number, iz: number): number {
  return iz * GRID_SIZE + ix
}

function buildGrid(): void {
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    cellRegions.push([])
    cellSegments.push([])
  }
  const stamp = (
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    write: (cell: number) => void,
  ): void => {
    const ix0 = Math.max(0, Math.floor((minX + GRID_HALF) / GRID_CELL))
    const iz0 = Math.max(0, Math.floor((minZ + GRID_HALF) / GRID_CELL))
    const ix1 = Math.min(GRID_SIZE - 1, Math.floor((maxX + GRID_HALF) / GRID_CELL))
    const iz1 = Math.min(GRID_SIZE - 1, Math.floor((maxZ + GRID_HALF) / GRID_CELL))
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) write(cellIndex(ix, iz))
    }
  }

  PAVED_REGIONS.forEach((region, index) => {
    if (region.kind === 'ribbon') {
      const reach = region.halfWidth + PAVE.edgeFade + 3
      for (let s = 0; s < region.line.length - 1; s++) {
        const a = region.line[s]
        const b = region.line[s + 1]
        stamp(
          Math.min(a.x, b.x) - reach,
          Math.min(a.y, b.y) - reach,
          Math.max(a.x, b.x) + reach,
          Math.max(a.y, b.y) + reach,
          (cell) => {
            cellSegments[cell].push(index, s)
          },
        )
      }
      return
    }
    // Analytic shapes answer in O(1); every cell they can influence gets them.
    const reach = PAVE.edgeFade + 3
    let minX: number
    let minZ: number
    let maxX: number
    let maxZ: number
    if (region.kind === 'disc') {
      minX = region.cx - region.radius - reach
      maxX = region.cx + region.radius + reach
      minZ = region.cz - region.radius - reach
      maxZ = region.cz + region.radius + reach
    } else if (region.kind === 'rect') {
      minX = region.cx - region.halfX - reach
      maxX = region.cx + region.halfX + reach
      minZ = region.cz - region.halfZ - reach
      maxZ = region.cz + region.halfZ + reach
    } else {
      minX = region.cx - region.rOuter - reach
      maxX = region.cx + region.rOuter + reach
      minZ = region.cz - region.rOuter - reach
      maxZ = region.cz + region.rOuter + reach
    }
    stamp(minX, minZ, maxX, maxZ, (cell) => {
      cellRegions[cell].push(index)
    })
  })
}

buildGrid()

function gridCellAt(x: number, z: number): number {
  const ix = Math.floor((x + GRID_HALF) / GRID_CELL)
  const iz = Math.floor((z + GRID_HALF) / GRID_CELL)
  if (ix < 0 || iz < 0 || ix >= GRID_SIZE || iz >= GRID_SIZE) return -1
  return cellIndex(ix, iz)
}

/**
 * Signed distance to the nearest paved boundary: negative on paving. THE
 * field — the walkable datum, the regolith's dust band, the relief mask and
 * the scatter rejection all derive from this one number.
 */
export function pavedSignedDistance(x: number, z: number): number {
  const cell = gridCellAt(x, z)
  if (cell < 0) return 1e4
  let best = 1e4
  const regions = cellRegions[cell]
  for (let i = 0; i < regions.length; i++) {
    const d = regionDistance(PAVED_REGIONS[regions[i]], x, z)
    if (d < best) best = d
  }
  const segments = cellSegments[cell]
  for (let i = 0; i < segments.length; i += 2) {
    const region = PAVED_REGIONS[segments[i]]
    if (region.kind !== 'ribbon') continue
    const s = segments[i + 1]
    const d =
      Math.sqrt(segmentDistanceSq(region.line[s], region.line[s + 1], x, z)) -
      region.halfWidth
    if (d < best) best = d
  }
  return best
}

/** 1 on paving, easing to 0 across `PAVE.edgeFade` outside the boundary. */
export function pavedCoverage(x: number, z: number): number {
  const sd = pavedSignedDistance(x, z)
  if (sd <= 0) return 1
  if (sd >= PAVE.edgeFade) return 0
  return 1 - smooth(sd / PAVE.edgeFade)
}

/** The lift the walkable surface takes over the regolith grade. */
export function pavedLift(x: number, z: number): number {
  return PAVE.rise * pavedCoverage(x, z)
}

/**
 * Highest-priority region containing this point, or -1. Used by the mesh
 * builder to trim overlapping slabs — paving must never stack two surfaces
 * at the same datum (instant z-fighting).
 */
export function coveringRegion(x: number, z: number, abovePriority: number): number {
  let bestIndex = -1
  let bestPriority = abovePriority
  const cell = gridCellAt(x, z)
  if (cell < 0) return -1
  const regions = cellRegions[cell]
  for (let i = 0; i < regions.length; i++) {
    const index = regions[i]
    const region = PAVED_REGIONS[index]
    if (region.priority <= bestPriority) continue
    if (regionDistance(region, x, z) < 0) {
      bestIndex = index
      bestPriority = region.priority
    }
  }
  const segments = cellSegments[cell]
  for (let i = 0; i < segments.length; i += 2) {
    const index = segments[i]
    const region = PAVED_REGIONS[index]
    if (region.kind !== 'ribbon' || region.priority <= bestPriority) continue
    const s = segments[i + 1]
    if (
      segmentDistanceSq(region.line[s], region.line[s + 1], x, z) <
      region.halfWidth * region.halfWidth
    ) {
      bestIndex = index
      bestPriority = region.priority
    }
  }
  return bestIndex
}

/**
 * Circulation intensity 0..1 on paving — where feet actually go. Drives the
 * polish (lower roughness) and the faint darkening of the desire lines.
 */
export function pavedTraffic(x: number, z: number): number {
  let strongest = 0
  const cell = gridCellAt(x, z)
  if (cell < 0) return 0
  const segments = cellSegments[cell]
  for (let i = 0; i < segments.length; i += 2) {
    const region = PAVED_REGIONS[segments[i]]
    if (region.kind !== 'ribbon') continue
    // The spur corridors are guideway, not walk — no desire-line wear.
    if (region.id.startsWith('spur-corridor')) continue
    const s = segments[i + 1]
    const d = Math.sqrt(segmentDistanceSq(region.line[s], region.line[s + 1], x, z))
    const reach = region.halfWidth + 1.2
    if (d < reach) strongest = Math.max(strongest, 1 - d / reach)
  }
  // The plaza's own wear: a broad ring where people orbit the First Tree.
  const r = Math.hypot(x - FIRST_TREE.x, z - FIRST_TREE.z)
  if (r < FIRST_TREE.plazaRadius) {
    const ring = 1 - Math.min(1, Math.abs(r - (FIRST_TREE.soilRingRadius + 3.6)) / 7)
    strongest = Math.max(strongest, ring * 0.85)
  }
  return clamp01(strongest)
}

// -------------------------------------------------------------- planters ----

export interface PlanterSpec {
  id: string
  /** Annular sector: centre, radii, and the angular span in radians. */
  cx: number
  cz: number
  rInner: number
  rOuter: number
  a0: number
  a1: number
  /** Wall thickness (the soil face sits `wall` inside rInner/rOuter). */
  wall: number
}

/** Angles (rad) where a ribbon enters a disc/annulus — planters leave them open. */
function entryAngles(cx: number, cz: number, radius: number, tolerance: number): number[] {
  const angles: number[] = []
  for (const region of PAVED_REGIONS) {
    if (region.kind !== 'ribbon') continue
    for (const point of region.line) {
      const d = Math.hypot(point.x - cx, point.y - cz)
      if (Math.abs(d - radius) < tolerance) {
        angles.push(Math.atan2(point.y - cz, point.x - cx))
      }
    }
  }
  return angles
}

/**
 * Raised beds line the plaza rim and the boulevard's inner edge — the
 * reference image's signature move: dense green confined to white concrete
 * walls, never spilling onto the floor. Arcs fill every span between path
 * entries; the vegetation system plants them from this list.
 */
function buildPlanters(): PlanterSpec[] {
  const specs: PlanterSpec[] = []

  const arcRun = (
    prefix: string,
    cx: number,
    cz: number,
    rInner: number,
    rOuter: number,
    gaps: number[],
    gapHalf: number,
    minSpan: number,
    maxSpan: number,
  ): void => {
    const sorted = [...gaps].sort((a, b) => a - b)
    if (sorted.length === 0) sorted.push(0)
    let index = 0
    for (let i = 0; i < sorted.length; i++) {
      const from = sorted[i] + gapHalf
      const to = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU) - gapHalf
      const span = to - from
      if (span < minSpan) continue
      const pieces = Math.max(1, Math.ceil(span / maxSpan))
      const seam = 0.055
      const piece = (span - seam * (pieces - 1)) / pieces
      for (let p = 0; p < pieces; p++) {
        const a0 = from + p * (piece + seam)
        specs.push({
          id: `${prefix}-${index++}`,
          cx,
          cz,
          rInner,
          rOuter,
          a0,
          a1: a0 + piece,
          wall: PLANTER.wall,
        })
      }
    }
  }

  // Plaza rim beds, inboard of the curb.
  const plazaGaps = entryAngles(FIRST_TREE.x, FIRST_TREE.z, FIRST_TREE.plazaRadius, 2.2)
  arcRun(
    'plaza',
    FIRST_TREE.x,
    FIRST_TREE.z,
    FIRST_TREE.plazaRadius - 5.6,
    FIRST_TREE.plazaRadius - 1.5,
    plazaGaps,
    0.19,
    0.28,
    0.62,
  )

  // Boulevard inner edge — a green kerb between the tram street and the park.
  const boulevardGaps = entryAngles(0, 0, BOULEVARD.innerRadius, 3.4)
  boulevardGaps.push(Math.PI / 2) // station terrace
  for (const station of LOOP.stations) boulevardGaps.push(station.angle)
  arcRun(
    'boulevard',
    0,
    0,
    BOULEVARD.innerRadius + 1.1,
    BOULEVARD.innerRadius + 3.9,
    boulevardGaps,
    0.115,
    0.075,
    0.16,
  )

  return specs
}

export const PLANTERS: PlanterSpec[] = buildPlanters()

/** True where a planter wall/bed occupies the paving (no floor lights there). */
export function insidePlanter(x: number, z: number, margin = 0): boolean {
  for (const planter of PLANTERS) {
    const dx = x - planter.cx
    const dz = z - planter.cz
    const r = Math.hypot(dx, dz)
    if (r < planter.rInner - margin || r > planter.rOuter + margin) continue
    let angle = Math.atan2(dz, dx)
    while (angle < planter.a0 - Math.PI) angle += TAU
    while (angle > planter.a0 + Math.PI) angle -= TAU
    const slack = margin / Math.max(1, r)
    if (angle >= planter.a0 - slack && angle <= planter.a1 + slack) return true
  }
  return false
}

/** True inside the recessed tram channel (paving yields to the track agent). */
export function insideGuidewayChannel(x: number, z: number, margin = 0): boolean {
  const r = Math.hypot(x, z)
  return Math.abs(r - GUIDEWAY_CHANNEL.radius) < GUIDEWAY_CHANNEL.width / 2 + margin
}

/** True inside the recessed arrival-spur corridor (same contract).
 *  Hot path — interiorHeight asks for every floor vertex and heightfield
 *  sample — so a cached AABB rejects the whole park in four compares. */
/** Both spur cuttings share one contract; interiorHeight, the floor-light
 *  exclusion and the channel-lip suppression all ask through here. */
const CORRIDOR_IDS = ['spur-corridor', 'spur-corridor-promenade']

interface CorridorBox {
  region: Region & { kind: 'ribbon' }
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
let corridorBoxes: CorridorBox[] | null = null

/** Signed distance to the nearest corridor edge: negative inside, large when
 *  absent. Hot path — the cached AABBs reject the whole park in compares. */
export function spurCorridorDistance(x: number, z: number): number {
  if (corridorBoxes === null) {
    corridorBoxes = []
    for (const id of CORRIDOR_IDS) {
      const region = PAVED_REGIONS.find((r) => r.id === id)
      if (!region || region.kind !== 'ribbon') continue
      const xs = region.line.map((p) => p.x)
      const zs = region.line.map((p) => p.y)
      const pad = region.halfWidth + 2.4
      corridorBoxes.push({
        region,
        minX: Math.min(...xs) - pad,
        maxX: Math.max(...xs) + pad,
        minZ: Math.min(...zs) - pad,
        maxZ: Math.max(...zs) + pad,
      })
    }
  }
  let best = 1e4
  for (const box of corridorBoxes) {
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue
    const d = polylineDistance(box.region.line, x, z) - box.region.halfWidth
    if (d < best) best = d
  }
  return best
}

export function insideSpurCorridor(x: number, z: number, margin = 0): boolean {
  return spurCorridorDistance(x, z) < margin
}
