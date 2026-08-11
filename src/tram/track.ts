import { CatmullRomCurve3, Group, Mesh, PlaneGeometry, Quaternion, Vector2, Vector3 } from 'three'
import { SMOOTH, cleanMesh, loft, roundedRect, smoothShade, writeInto } from '../archkit/meshdata'
import type { Vec2, Vec3 as MVec3 } from '../archkit/meshdata'
import type { PartWriter } from '../archkit/writer'
import { signageMaterial } from '../materials/library'
import type { PhysicsSystem } from '../physics/physicsWorld'
import { interiorHeight } from '../world/interiorHeight'
import { LOOP } from '../world/parkPlan'
import { slabTop } from '../world/paving'
import { GUIDEWAY_CHANNEL } from '../world/pavingPlan'

/**
 * THE LOOP'S PERMANENT WAY — guideway, stations, connector-tube interior.
 *
 * The Loop is a rubber-tyred, centre-beam guided people mover. Two load tyres
 * per bogie roll on steel wear rails at x = ±0.42; four horizontal guide
 * wheels per bogie grip the beam FLANKS at x = ±0.675, 0.18–0.28 m below the
 * running surface. Every datum below is that vehicle contract
 * (`tram/tramShape.ts`, `tram/tramRunning.ts`) turned into permanent way, so
 * the tyres always meet steel and the guide wheels always find a flank:
 *
 *   beamTopY(x,z)          crown of the guide beam (`tramSystem` seats the car
 *                          at beamTopY + CAR_FLOOR)
 *   + RAIL_TOP  (0.050)    the wear-rail head — what the tyres roll on
 *   ± BEAM_HALF (0.675)    the guide flanks
 *   + CAR_FLOOR (0.620)    the cabin floor, and therefore every platform datum
 *
 * ONE cross-section, built three ways:
 *
 *  - STREET-RUNNING through the boulevard (the reference image's inset guide
 *    tracks). The beam is SUNK: its crown sits flush in the paving and a guide
 *    groove either side exposes the flanks, so the same guide wheels work with
 *    nothing standing above the floor. The paving agent pours the recessed
 *    channel (`GUIDEWAY_CHANNEL`, floor = slabTop − 0.06); this module lays the
 *    trackbed, the rails, the armoured movement joints and the drains into it.
 *    The channel is walkable by design — crossing the tracks IS street running.
 *  - ELEVATED on the arrival spur: the same beam as a haunched box girder on
 *    lofted piers with real elastomeric bearings.
 *  - TUBE: the girder cast monolithically into a full-width deck whose edges
 *    tuck against the lining, so nothing inside the tube floats.
 *
 * The three runs meet at 20 mm movement joints — opposed capped faces, which
 * is a real structural joint and mechanically a `backToBack` pair, never a
 * `zfight`.
 */

export interface TrackData {
  loop: CatmullRomCurve3
  loopLength: number
  arrival: CatmullRomCurve3
  arrivalLength: number
  /** Arc positions (meters along the loop) of each station stop. */
  stationS: Map<string, number>
  /** World point where the arrival spur hands off to the loop (portal stop). */
  handoffS: number
}

// ------------------------------------------------------------------ datums --

/** Cabin floor above the beam crown — the `tramSystem` placement contract. */
export const CAR_FLOOR = 0.62
/** Guide-flank half width (`tramShape.BEAM_HALF_W`). */
const BEAM_HALF = 0.675
/** Wear-rail centres (`tramRunning.TYRE_X`). */
const RAIL_X = 0.42
/** Rail head over the crown (`tramShape.RUNNING_Y` = beam top + 0.05). */
const RAIL_TOP = 0.05
/** Rail seat rebate: 12 mm reveal each side of the foot, 30 mm deep. */
const REBATE_HALF = 0.124
const REBATE_DEPTH = 0.03
/** Elevated girder soffit below the crown. */
const BEAM_SOFFIT = 0.62
/** Guide groove: outer wall and depth. Guide wheels reach x 0.671–0.931. */
const GROOVE_OUT = 0.955
const GROOVE_DEPTH = 0.335
/**
 * Street trackbed apron: half width, top over the channel floor, buried root.
 * 1.35 is set by the STATIONS, not by the channel — a side platform's fascia
 * stands at r = 95.60, so the trackbed's inner face has to sit outside it or
 * the two solids interpenetrate for the whole length of every platform. The
 * remaining 0.25 m each side of the 3.2 m channel stays the paving agent's.
 */
const APRON_HALF = 1.35
const APRON_TOP = 0.018
const APRON_ROOT = 0.45
/** Connector-tube lining: interior radius, clear inside the dome agent's duct
 *  (flare 7.2 → run 6.05) and inside the portal bulkhead bore (5.9). */
const TUBE_R = 5.6
const TUBE_START_Z = 129.92
const TUBE_END_Z = 421
/** Tube deck top / soffit, measured from the beam crown. */
const DECK_TOP = -0.55
const DECK_SOFFIT = -0.95
/** Below this crown-over-ground clearance the beam must be sunk, or the guide
 *  wheels would plough the floor. */
const EMBED_CLEARANCE = 0.36
/** Movement joint between two structures of the permanent way. */
const JOINT = 0.02
/** Station sampling along a curve. */
const LOOP_STEP = 2.4
const SPUR_STEP = 2.6

const UP = new Vector3(0, 1, 0)

function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * (3 - 2 * c)
}

/** Ground/paving datum, clamped to the modelled floor (r ≤ 132). */
function surfaceY(x: number, z: number): number {
  const r = Math.hypot(x, z)
  if (r <= 131) return interiorHeight(x, z)
  return interiorHeight((x * 131) / r, (z * 131) / r)
}

/** The dome agent's connector-duct axis, replicated so the lining can never
 *  disagree with the duct it lives inside (`dome/connectorTube.ts:tubeAxis`). */
function tubeAxisY(z: number, spurY: number): number {
  const blend = 1 - smooth01((z - 132) / 36)
  return (spurY + 1.6) * (1 - blend) + 4.6 * blend
}

/** `PartWriter.box` yaw convention: local +Z lands along `dir`. */
function yawAlong(dir: Vector3): number {
  return Math.atan2(dir.x, dir.z)
}

// -------------------------------------------------------------- alignment --

/** Clockwise-from-above so the portal station departs eastward. */
export function buildTrackData(): TrackData {
  const loopPoints: Vector3[] = []
  const segments = 48
  for (let i = 0; i < segments; i++) {
    const phi = Math.PI / 2 - (i / segments) * Math.PI * 2
    const x = Math.cos(phi) * LOOP.radius
    const z = Math.sin(phi) * LOOP.radius
    loopPoints.push(new Vector3(x, beamTopY(x, z), z))
  }
  const loop = new CatmullRomCurve3(loopPoints, true, 'centripetal', 0.5)
  const loopLength = loop.getLength()

  // Arrival spur. DEAD STRAIGHT on the tube axis (x = 0) for all z ≥ 121, so
  // the car threads the portal bulkhead dead-centre; the westward hook onto
  // the loop starts only inboard of the wall.
  //
  // The vertical is the load-bearing decision. The beam has to be flush with
  // the floor BEFORE it crosses the rim promenade (r ≈ 112) — a viaduct there
  // would either wall the promenade off or hang a 0.4 m soffit over it — so
  // the descent starts deep inside the tube, holds ≈ 4.5 %, and the last 15 m
  // into the station is dead level at the channel datum. The upper stations
  // (z ≥ 168) are FIXED: `dome/connectorTube.ts` blends its duct axis onto
  // this curve over z 132→168, and the portal bore is centred on y = 4.6.
  const portalStop = new Vector3(0, beamTopY(0, LOOP.radius), LOOP.radius)
  const street = portalStop.y
  const arrivalPoints = [
    new Vector3(0, 6.2, 420),
    new Vector3(0, 5.6, 340),
    new Vector3(0, 4.8, 268),
    new Vector3(0, 4.0, 210),
    new Vector3(0, 3.4, 168),
    new Vector3(0, 2.78, 152),
    new Vector3(0, 2.16, 138),
    new Vector3(0, 1.72, 128),
    new Vector3(-0.6, 1.4, 122.5),
    new Vector3(-2.1, 1.06, 117),
    new Vector3(-3.4, street + 0.18, 113.6),
    new Vector3(-4.6, street, 109.5),
    new Vector3(-5.05, street, 104),
    new Vector3(-3.6, street, 99.4),
    portalStop.clone().add(new Vector3(-1.5, 0, 0.3)),
    portalStop.clone(),
  ]
  const arrival = new CatmullRomCurve3(arrivalPoints, false, 'centripetal', 0.5)

  const stationS = new Map<string, number>()
  for (const station of LOOP.stations) {
    const target = new Vector3(
      Math.cos(station.angle) * LOOP.radius,
      0,
      Math.sin(station.angle) * LOOP.radius,
    )
    stationS.set(station.id, nearestS(loop, loopLength, target))
  }

  return {
    loop,
    loopLength,
    arrival,
    arrivalLength: arrival.getLength(),
    stationS,
    handoffS: stationS.get('portal') ?? 0,
  }
}

/**
 * Beam crown height. Inside the boulevard's recessed guideway channel the Loop
 * is street-running, so the crown IS the channel floor (`slabTop −
 * GUIDEWAY_CHANNEL.recess`) and the cabin floor lands 0.56 over the paving.
 * Outside it — only the arrival spur ever asks — the crown rides clear of the
 * grade on a real structure. The two blend over 2.4 m, so a curve sampled
 * across the boundary never kinks.
 */
export function beamTopY(x: number, z: number): number {
  const street = slabTop(x, z) - GUIDEWAY_CHANNEL.recess
  const outside =
    Math.abs(Math.hypot(x, z) - GUIDEWAY_CHANNEL.radius) - GUIDEWAY_CHANNEL.width / 2
  if (outside <= 0) return street
  const authority = 1 - smooth01(outside / 2.4)
  const open = Math.max(surfaceY(x, z) + 0.12, 0.55) + 0.5
  if (authority <= 0) return open
  return open * (1 - authority) + street * authority
}

/** Cabin floor — and therefore the platform datum — at a point on the loop. */
export function carFloorY(x: number, z: number): number {
  return beamTopY(x, z) + CAR_FLOOR
}

function nearestS(curve: CatmullRomCurve3, length: number, target: Vector3): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < 600; i++) {
    const s = (i / 600) * length
    const p = curve.getPointAt(s / length)
    const d = Math.hypot(p.x - target.x, p.z - target.z)
    if (d < bestDistance) {
      bestDistance = d
      best = s
    }
  }
  // Refine to 1 cm: the coarse pass quantizes to ~1 m here, and the portal
  // handoff S is a POSE-CONTINUITY datum — a metre of error teleports the
  // docking train (and the seated camera) by that much.
  const span = length / 600
  for (let s = best - span; s <= best + span; s += 0.01) {
    const sm = ((s % length) + length) % length
    const p = curve.getPointAt(sm / length)
    const d = Math.hypot(p.x - target.x, p.z - target.z)
    if (d < bestDistance) {
      bestDistance = d
      best = sm
    }
  }
  return best
}

// ---------------------------------------------------------------- sections --

/**
 * A run of per-station closed sections. Every profile in one run carries the
 * same point count; a station's frame is (right-of-travel, up), so a profile
 * point reads `(across, height)` exactly as it would on a drawing.
 */
interface Station {
  p: Vector3
  profile: Vec2[]
}

function stationFrame(
  stations: Vector3[],
  index: number,
  closed: boolean,
): { side: Vector3; up: Vector3; tangent: Vector3 } {
  const n = stations.length
  const a = closed ? stations[(index - 1 + n) % n] : stations[Math.max(0, index - 1)]
  const b = closed ? stations[(index + 1) % n] : stations[Math.min(n - 1, index + 1)]
  const tangent = new Vector3().subVectors(b, a)
  if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 1)
  tangent.normalize()
  const side = new Vector3().crossVectors(tangent, UP)
  if (side.lengthSq() < 1e-9) side.set(1, 0, 0)
  side.normalize()
  const up = new Vector3().crossVectors(side, tangent).normalize()
  return { side, up, tangent }
}

function sweepRun(
  writer: PartWriter,
  slot: string,
  stations: Station[],
  options: { closed?: boolean; smooth?: number; uvScale?: number } = {},
): void {
  const n = stations.length
  if (n < 2) return
  const closed = options.closed ?? false
  const centres = stations.map((station) => station.p)
  const rings: MVec3[][] = []
  for (let i = 0; i < n; i++) {
    const { side, up } = stationFrame(centres, i, closed)
    const p = centres[i]
    rings.push(
      stations[i].profile.map(
        ([across, height]) =>
          [
            p.x + side.x * across + up.x * height,
            p.y + side.y * across + up.y * height,
            p.z + side.z * across + up.z * height,
          ] as MVec3,
      ),
    )
  }
  const md = loft(rings, { closeU: closed, closeV: true, capStart: !closed, capEnd: !closed })
  md.frame = 'y-up'
  smoothShade(md, options.smooth ?? SMOOTH.moulded)
  cleanMesh(md)
  writeInto(writer, slot, md, { uvScale: options.uvScale ?? 1 })
}

/** The crown, written right→left with the rail rebates cut into it. Heads
 *  every profile in the family, so the three structures share one datum. */
function crownRun(): Vec2[] {
  const outer = RAIL_X + REBATE_HALF
  const inner = RAIL_X - REBATE_HALF
  return [
    [0.655, 0],
    [outer, 0],
    [outer, -REBATE_DEPTH],
    [inner, -REBATE_DEPTH],
    [inner, 0],
    [-inner, 0],
    [-inner, -REBATE_DEPTH],
    [-outer, -REBATE_DEPTH],
    [-outer, 0],
    [-0.655, 0],
  ]
}

const CROWN = crownRun()

/** SUNK section: crown flush in the paving, a guide groove either side of the
 *  nib, a walkable apron out to the channel edge, and a buried root so the
 *  slab never reads as a lid laid on the floor. */
const EMBEDDED_SECTION: Vec2[] = [
  [APRON_HALF, APRON_TOP],
  [GROOVE_OUT + 0.034, APRON_TOP],
  [GROOVE_OUT, APRON_TOP - 0.042],
  [GROOVE_OUT, -GROOVE_DEPTH],
  [BEAM_HALF, -GROOVE_DEPTH],
  [BEAM_HALF, -0.02],
  ...CROWN,
  [-BEAM_HALF, -0.02],
  [-BEAM_HALF, -GROOVE_DEPTH],
  [-GROOVE_OUT, -GROOVE_DEPTH],
  [-GROOVE_OUT, APRON_TOP - 0.042],
  [-(GROOVE_OUT + 0.034), APRON_TOP],
  [-APRON_HALF, APRON_TOP],
  [-APRON_HALF, -APRON_ROOT],
  [APRON_HALF, -APRON_ROOT],
]

/** ELEVATED section: haunched box girder. `root` pushes the soffit down into
 *  the ground where the structure is too low to stand on piers, so the beam
 *  becomes a plinth wall instead of hovering. */
function girderSection(root: number): Vec2[] {
  return [
    ...CROWN,
    [-BEAM_HALF, -0.02],
    [-BEAM_HALF, -0.3],
    [-0.652, -0.392 - root * 0.3],
    [-0.578, -0.53 - root * 0.72],
    [-0.52, -BEAM_SOFFIT - root],
    [0.52, -BEAM_SOFFIT - root],
    [0.578, -0.53 - root * 0.72],
    [0.652, -0.392 - root * 0.3],
    [BEAM_HALF, -0.3],
    [BEAM_HALF, -0.02],
  ]
}

/** Half width of the lining at a height measured from the beam crown. */
function liningHalfWidth(axisDrop: number, height: number, inset: number): number {
  const dy = axisDrop - height
  return Math.sqrt(Math.max(0.6, TUBE_R * TUBE_R - dy * dy)) - inset
}

/** TUBE section: the girder cast monolithically into a full-width deck whose
 *  edges tuck against the lining behind a 20 mm drainage reveal. */
function tubeSection(axisDrop: number): Vec2[] {
  const mid = (DECK_TOP + DECK_SOFFIT) / 2
  const w1 = liningHalfWidth(axisDrop, DECK_TOP, 0.02)
  const w2 = liningHalfWidth(axisDrop, mid, 0.02)
  const w3 = liningHalfWidth(axisDrop, DECK_SOFFIT, 0.02)
  return [
    ...CROWN,
    [-BEAM_HALF, -0.02],
    [-BEAM_HALF, -0.3],
    [-0.76, -0.42],
    [-0.9, -0.52],
    [-1.02, DECK_TOP],
    [-w1, DECK_TOP],
    [-w2, mid],
    [-w3, DECK_SOFFIT],
    [w3, DECK_SOFFIT],
    [w2, mid],
    [w1, DECK_TOP],
    [1.02, DECK_TOP],
    [0.9, -0.52],
    [0.76, -0.42],
    [BEAM_HALF, -0.3],
    [BEAM_HALF, -0.02],
  ]
}

/** Steel wear rail: flat-bottom section, waisted web, 210 mm running band.
 *  Seated in the crown's rebate with a 12 mm reveal each side — the dark line
 *  that makes the rail read as a part let into the concrete, not painted on. */
const RAIL_SECTION: Vec2[] = [
  [-0.112, -REBATE_DEPTH],
  [0.112, -REBATE_DEPTH],
  [0.112, -0.014],
  [0.096, -0.004],
  [0.096, 0.026],
  [0.108, 0.036],
  [0.105, RAIL_TOP],
  [-0.105, RAIL_TOP],
  [-0.108, 0.036],
  [-0.096, 0.026],
  [-0.096, -0.004],
  [-0.112, -0.014],
]

function railStations(centres: Station[], offset: number): Station[] {
  const profile = RAIL_SECTION.map(([a, b]) => [a + offset, b] as Vec2)
  return centres.map((station) => ({ p: station.p, profile }))
}

function emitRails(
  writer: PartWriter,
  centres: Station[],
  options: { closed?: boolean } = {},
): void {
  for (const offset of [-RAIL_X, RAIL_X]) {
    sweepRun(writer, 'steelEdge', railStations(centres, offset), {
      closed: options.closed,
      smooth: SMOOTH.moulded,
      uvScale: 1.4,
    })
  }
}

// --------------------------------------------------------------- guideway --

interface Alignment {
  stations: Vector3[]
  closed: boolean
}

function sampleCurve(
  curve: CatmullRomCurve3,
  length: number,
  step: number,
  closed: boolean,
): Alignment {
  const count = Math.max(4, Math.round(length / step))
  const stations: Vector3[] = []
  for (let i = 0; i < (closed ? count : count + 1); i++) {
    stations.push(curve.getPointAt(Math.min(1, i / count)))
  }
  return { stations, closed }
}

/**
 * Street-running Loop: the trackbed laid into the paving agent's channel. Its
 * own top sits 18 mm over the channel floor (42 mm under the boulevard
 * paving), so nothing anywhere is coplanar with the pour.
 */
function buildStreetTrack(writer: PartWriter, track: TrackData): void {
  const align = sampleCurve(track.loop, track.loopLength, LOOP_STEP, true)
  const centres: Station[] = align.stations.map((p) => ({ p, profile: EMBEDDED_SECTION }))
  sweepRun(writer, 'cast', centres, { closed: true, smooth: SMOOTH.cast, uvScale: 0.55 })
  emitRails(writer, centres, { closed: true })
  emitTrackFurniture(writer, align, LOOP_STEP)
}

/**
 * Armoured movement joints every ~12 m and a groove drain every ~36 m. The
 * joints stop clear of the rails (continuously welded, as on any modern tram)
 * and clear of the grooves, so the slab moves and the steel does not.
 */
function emitTrackFurniture(writer: PartWriter, align: Alignment, step: number): void {
  const n = align.stations.length
  if (n < 4) return
  const jointEvery = Math.max(2, Math.round(12 / step))
  const drainEvery = Math.max(4, Math.round(36 / step))
  const apronBands: Array<[number, number]> = [
    [-1.3, -1.0],
    [1.0, 1.3],
  ]
  for (let i = 0; i < n; i++) {
    if (!align.closed && (i < 1 || i > n - 2)) continue
    const p = align.stations[i]
    const { side, tangent } = stationFrame(align.stations, i, align.closed)
    const yaw = yawAlong(side)
    if (i % jointEvery === 0) {
      for (const [a0, a1] of apronBands) {
        const mid = (a0 + a1) / 2
        writer.box({
          center: new Vector3(p.x + side.x * mid, p.y + APRON_TOP - 0.03, p.z + side.z * mid),
          size: new Vector3(0.085, 0.09, a1 - a0),
          rotationY: yaw,
          slot: 'dark',
          chamfer: 0.006,
        })
      }
      // Crown joint sits 18 mm lower than the aprons — the nib is the datum.
      writer.box({
        center: new Vector3(p.x, p.y - 0.032, p.z),
        size: new Vector3(0.085, 0.072, 0.56),
        rotationY: yaw,
        slot: 'dark',
        chamfer: 0.006,
      })
    }
    if (i % drainEvery !== 0) continue
    const grooveSide = (i / drainEvery) % 2 === 0 ? 1 : -1
    const across = grooveSide * (BEAM_HALF + GROOVE_OUT) * 0.5
    const base = new Vector3(
      p.x + side.x * across,
      p.y - GROOVE_DEPTH + 0.02,
      p.z + side.z * across,
    )
    writer.box({
      center: base,
      size: new Vector3(0.62, 0.09, GROOVE_OUT - BEAM_HALF - 0.03),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.008,
    })
    for (let bar = 0; bar < 4; bar++) {
      const t = -0.21 + bar * 0.14
      writer.box({
        center: new Vector3(
          base.x + tangent.x * t,
          base.y + 0.055,
          base.z + tangent.z * t,
        ),
        size: new Vector3(0.05, 0.03, GROOVE_OUT - BEAM_HALF - 0.08),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.004,
      })
    }
  }
}

interface SpurSplit {
  tube: Station[]
  girder: Station[]
  embedded: Station[]
  girderAlign: Alignment
  embeddedAlign: Alignment
}

/**
 * Split the arrival spur into its three structures. Sampling runs from the far
 * end of the tube inward, so the movement joints land on station boundaries
 * and no cross-section ever has to morph mid-sweep. The run stops well clear
 * of the loop's own trackbed: the spur merges tangentially, so anything closer
 * would interpenetrate it.
 */
function splitSpur(track: TrackData): SpurSplit {
  const align = sampleCurve(track.arrival, track.arrivalLength, SPUR_STEP, false)
  const tube: Station[] = []
  const girder: Station[] = []
  const embedded: Station[] = []
  const girderStations: Vector3[] = []
  const embeddedStations: Vector3[] = []
  for (const p of align.stations) {
    if (Math.abs(Math.hypot(p.x, p.z) - LOOP.radius) < APRON_HALF + 1.7) continue
    if (p.z >= TUBE_START_Z) {
      tube.push({ p, profile: tubeSection(tubeAxisY(p.z, p.y) - p.y) })
      continue
    }
    const ground = surfaceY(p.x, p.z)
    if (p.y - ground > EMBED_CLEARANCE) {
      girder.push({ p, profile: girderSection(Math.max(0, ground - 0.25 - p.y + BEAM_SOFFIT)) })
      girderStations.push(p)
    } else {
      embedded.push({ p, profile: EMBEDDED_SECTION })
      embeddedStations.push(p)
    }
  }
  // Run the deck a little past the car's spawn so the alignment never ends
  // inside frame, and take the girder right up to the portal movement joint.
  if (tube.length >= 2) {
    const dir = new Vector3().subVectors(tube[0].p, tube[1].p).normalize()
    const beyond = tube[0].p.clone().addScaledVector(dir, 5)
    tube.unshift({ p: beyond, profile: tubeSection(tubeAxisY(beyond.z, beyond.y) - beyond.y) })
  }
  // Close the girder→embedded transition to one movement joint. The split is
  // made on a 2.6 m sampling grid, so without this the ramp would start a full
  // station short of where the viaduct stops.
  if (girder.length && embedded.length) {
    const from = girder[girder.length - 1].p
    const to = embedded[0].p
    const gap = from.distanceTo(to)
    if (gap > JOINT * 2) {
      const seam = from.clone().lerp(to, JOINT / gap)
      embedded.unshift({ p: seam, profile: EMBEDDED_SECTION })
      embeddedStations.unshift(seam)
    }
  }
  if (girder.length >= 2) {
    const dir = new Vector3().subVectors(girder[0].p, girder[1].p).normalize()
    if (Math.abs(dir.z) > 0.2) {
      const reach = (TUBE_START_Z - JOINT - girder[0].p.z) / dir.z
      if (reach > 0) {
        const stop = girder[0].p.clone().addScaledVector(dir, reach)
        const ground = surfaceY(stop.x, stop.z)
        girder.unshift({
          p: stop,
          profile: girderSection(Math.max(0, ground - 0.25 - stop.y + BEAM_SOFFIT)),
        })
        girderStations.unshift(stop)
      }
    }
  }
  return {
    tube,
    girder,
    embedded,
    girderAlign: { stations: girderStations, closed: false },
    embeddedAlign: { stations: embeddedStations, closed: false },
  }
}

/**
 * A pier: lofted footing → tapered shaft → capital, with an elastomeric
 * bearing buried 4 mm into the girder soffit. Bury-and-cap, never a coplanar
 * rest (`experience-craft` §5.2.2).
 */
function emitPier(writer: PartWriter, p: Vector3, side: Vector3, ground: number): void {
  const yaw = yawAlong(side)
  const soffit = p.y - BEAM_SOFFIT
  const across = new Vector3(-side.z, 0, side.x)
  const levels: Array<[number, number, number]> = [
    [2.1, 1.45, ground - 0.62],
    [2.1, 1.45, ground - 0.34],
    [1.52, 1.06, ground - 0.24],
    [1.16, 0.84, ground + 0.09],
    [0.92, 0.66, soffit - 0.4],
    [1.34, 0.98, soffit - 0.26],
    [1.34, 0.98, soffit - 0.1],
  ]
  const rings: MVec3[][] = levels.map(([w, d, y]) =>
    roundedRect(w, d, Math.min(w, d) * 0.16, 3).map(
      ([a, b]) =>
        [p.x + side.x * a + across.x * b, y, p.z + side.z * a + across.z * b] as MVec3,
    ),
  )
  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.cast)
  cleanMesh(md)
  writeInto(writer, 'cast', md, { uvScale: 0.5 })
  // Bedding plate on the capital, elastomeric pad on the plate, pad 4 mm into
  // the soffit. Three parts that BUTT — never a bolt buried in a casting.
  writer.box({
    center: new Vector3(p.x, soffit - 0.08, p.z),
    size: new Vector3(0.62, 0.05, 1.02),
    rotationY: yaw,
    slot: 'steelEdge',
    chamfer: 0.008,
  })
  writer.box({
    center: new Vector3(p.x, soffit - 0.027, p.z),
    size: new Vector3(0.5, 0.062, 0.9),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.008,
  })
}

/** Lateral tie between the tube deck and the lining: the deck is monolithic
 *  with the beam, so what the tube needs is a restraint, not a leg. */
function emitTubeStrut(writer: PartWriter, p: Vector3, side: Vector3, axisDrop: number): void {
  const deckY = p.y + DECK_TOP
  const reach = liningHalfWidth(axisDrop, DECK_TOP, 0.52)
  const yaw = yawAlong(side)
  for (const sign of [-1, 1]) {
    writer.box({
      center: new Vector3(
        p.x + side.x * sign * reach,
        deckY + 0.22,
        p.z + side.z * sign * reach,
      ),
      size: new Vector3(0.14, 0.46, 0.42),
      rotationY: yaw,
      slot: 'steel',
      chamfer: 0.012,
    })
  }
}

/** Cast guideway: street-running through the boulevard, elevated on the spur. */
export function buildGuideway(writer: PartWriter, track: TrackData): void {
  buildStreetTrack(writer, track)

  const spur = splitSpur(track)
  if (spur.tube.length > 1) {
    sweepRun(writer, 'cast', spur.tube, { smooth: SMOOTH.cast, uvScale: 0.4 })
    emitRails(writer, spur.tube)
    const centres = spur.tube.map((station) => station.p)
    for (let i = 2; i < spur.tube.length - 1; i += 3) {
      const p = centres[i]
      emitTubeStrut(writer, p, stationFrame(centres, i, false).side, tubeAxisY(p.z, p.y) - p.y)
    }
  }
  if (spur.girder.length > 1) {
    sweepRun(writer, 'cast', spur.girder, { smooth: SMOOTH.cast, uvScale: 0.5 })
    emitRails(writer, spur.girder)
    const centres = spur.girderAlign.stations
    // Every other station, starting at the bulkhead abutment. A station whose
    // soffit is already into the grade needs no pier — the section's own root
    // carries it there.
    for (let i = 0; i < centres.length; i += 2) {
      const p = centres[i]
      const ground = surfaceY(p.x, p.z)
      if (p.y - BEAM_SOFFIT - ground < 0.32) continue
      emitPier(writer, p, stationFrame(centres, i, false).side, ground)
    }
  }
  if (spur.embedded.length > 1) {
    sweepRun(writer, 'cast', spur.embedded, { smooth: SMOOTH.cast, uvScale: 0.55 })
    emitRails(writer, spur.embedded)
    emitTrackFurniture(writer, spur.embeddedAlign, SPUR_STEP)
  }
}

export interface GuidewayCollider {
  center: Vector3
  half: Vector3
  yaw: number
}

/**
 * Analytic colliders for the part of the guideway a walker can hit: the
 * elevated girder. The street-running channel is deliberately NOT walled —
 * crossing the tracks is the point of a street tramway, and the physics
 * heightfield already carries the paving.
 *
 * `buildGuideway` has no physics handle (its signature is a contract with
 * `tramSystem`), so whoever owns a physics world asks for these instead.
 */
export function guidewayColliders(track: TrackData): GuidewayCollider[] {
  const out: GuidewayCollider[] = []
  const stations = splitSpur(track).girderAlign.stations
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]
    const b = stations[i + 1]
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const ground = surfaceY(mid.x, mid.z)
    const bottom = Math.max(ground, mid.y - BEAM_SOFFIT)
    out.push({
      center: new Vector3(mid.x, (mid.y + bottom) / 2, mid.z),
      half: new Vector3(BEAM_HALF, Math.max(0.12, (mid.y - bottom) / 2), a.distanceTo(b) / 2 + 0.05),
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
    })
  }
  return out
}

// ------------------------------------------------------------------- tube --

/**
 * The connector tube's interior. The tram system owns the iris petals in the
 * bulkhead; the dome agent owns the exterior duct (flare 7.2 → 6.05) and the
 * bulkhead bore (5.9). This lining runs at 5.6 and flares to 5.86 at its mouth
 * so it tucks INTO the bore without ever sharing a surface with either.
 */
export interface TubeParts {
  irisBlades: Array<{ pivotYaw: number }>
}

interface TubeStation {
  z: number
  axis: number
  radius: number
}

function arrivalYAt(track: TrackData, z: number): number {
  let best = track.arrival.getPointAt(0).y
  let bestD = Infinity
  for (let i = 0; i <= 220; i++) {
    const p = track.arrival.getPointAt(i / 220)
    const d = Math.abs(p.z - z)
    if (d < bestD) {
      bestD = d
      best = p.y
    }
  }
  return best
}

function tubeStations(track: TrackData): TubeStation[] {
  const out: TubeStation[] = []
  const push = (z: number): void => {
    out.push({
      z,
      axis: tubeAxisY(z, arrivalYAt(track, z)),
      radius: TUBE_R + 0.26 * (1 - smooth01((z - TUBE_START_Z) / 1.5)),
    })
  }
  push(TUBE_START_Z)
  push(TUBE_START_Z + 0.55)
  push(TUBE_START_Z + 1.5)
  for (let z = TUBE_START_Z + 5; z < TUBE_END_Z - 1; z += 4) push(z)
  push(TUBE_END_Z)
  return out
}

/** Rolled I-section lining ring: `(outward, along z)`. */
const RING_SECTION: Vec2[] = [
  [-0.024, -0.23],
  [-0.024, 0.23],
  [-0.07, 0.23],
  [-0.07, 0.058],
  [-0.31, 0.058],
  [-0.31, 0.18],
  [-0.37, 0.18],
  [-0.37, -0.18],
  [-0.31, -0.18],
  [-0.31, -0.058],
  [-0.07, -0.058],
  [-0.07, -0.23],
]

export function buildTube(writer: PartWriter, track: TrackData): void {
  const stations = tubeStations(track)
  const segments = 40
  const linePoint = (station: TubeStation, angle: number): Vector3 =>
    new Vector3(
      Math.cos(angle) * station.radius,
      station.axis + Math.sin(angle) * station.radius,
      station.z,
    )

  // --- lining. Emitted with INWARD normals: it is only ever seen from inside.
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]
    const b = stations[i + 1]
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2
      const a1 = ((s + 1) / segments) * Math.PI * 2
      writer.quad(
        'tubeWall',
        linePoint(a, a0),
        linePoint(b, a0),
        linePoint(b, a1),
        linePoint(a, a1),
        0.12,
      )
    }
  }
  // Far bulkhead, so the lining never reads as an open pipe.
  const last = stations[stations.length - 1]
  const centre = new Vector3(0, last.axis, last.z)
  for (let s = 0; s < segments; s++) {
    writer.tri(
      'dark',
      centre,
      linePoint(last, ((s + 1) / segments) * Math.PI * 2),
      linePoint(last, (s / segments) * Math.PI * 2),
    )
  }

  // --- rolled rings every 12 m, hard against the lining. Their sweep frame is
  // radial/axial, which the generic station frame degenerates on at the crown,
  // so they are lofted directly.
  for (let z = TUBE_START_Z + 8; z < TUBE_END_Z - 3; z += 12) {
    const axis = tubeAxisY(z, arrivalYAt(track, z))
    const ringSegments = 36
    const rings: MVec3[][] = []
    for (let s = 0; s < ringSegments; s++) {
      const angle = (s / ringSegments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      rings.push(
        RING_SECTION.map(
          ([outward, along]) =>
            [cos * (TUBE_R + outward), axis + sin * (TUBE_R + outward), z + along] as MVec3,
        ),
      )
    }
    const md = loft(rings, { closeU: true, closeV: true })
    md.frame = 'y-up'
    smoothShade(md, SMOOTH.moulded)
    cleanMesh(md)
    writeInto(writer, 'steel', md, { uvScale: 0.8 })
  }

  // --- walkway edge: kickplate, stanchions, handrail. The deck itself is cast
  // with the guideway (one section, one pour, no joint to get wrong).
  const spur = splitSpur(track)
  const deckAt = (p: Vector3): { y: number; reach: number } => {
    const axisDrop = tubeAxisY(p.z, p.y) - p.y
    return { y: p.y + DECK_TOP, reach: liningHalfWidth(axisDrop, DECK_TOP, 0.22) }
  }
  for (let i = 1; i < spur.tube.length - 1; i++) {
    const p = spur.tube[i].p
    const previous = spur.tube[i - 1].p
    if (p.z > TUBE_END_Z - 4) continue
    const { y, reach } = deckAt(p)
    const run = Math.abs(previous.z - p.z)
    for (const sign of [-1, 1]) {
      writer.box({
        center: new Vector3(sign * reach, y + 0.05, (p.z + previous.z) / 2),
        size: new Vector3(0.028, 0.14, run),
        slot: 'orange',
        chamfer: 0.006,
      })
      if (i % 3 !== 0) continue
      writer.tube({
        path: [
          new Vector3(sign * (reach - 0.06), y - 0.03, p.z),
          new Vector3(sign * (reach - 0.06), y + 1.02, p.z),
        ],
        radius: 0.024,
        slot: 'dark',
        radialSegments: 8,
        capEnd: true,
      })
    }
  }
  for (const sign of [-1, 1]) {
    const rail: Vector3[] = []
    for (let i = spur.tube.length - 2; i >= 1; i--) {
      const p = spur.tube[i].p
      if (p.z > TUBE_END_Z - 4) continue
      const { y, reach } = deckAt(p)
      rail.push(new Vector3(sign * (reach - 0.06), y + 1.04, p.z))
    }
    if (rail.length > 2) {
      writer.tube({
        path: rail,
        radius: 0.026,
        slot: 'orangeTop',
        radialSegments: 10,
        capStart: true,
        capEnd: true,
      })
    }
  }

  // --- running lights: a recessed lens in a real housing, 2.9 m of emitter
  // every 12 m. Emissive AREA carries the level; the multiplier is the
  // library's ladder (runningLight ×3.2) and is not touched here.
  for (let z = TUBE_START_Z + 6; z < TUBE_END_Z - 5; z += 12) {
    const spurY = arrivalYAt(track, z)
    const axis = tubeAxisY(z, spurY)
    const y = spurY + DECK_TOP + 2.2
    const ex = Math.sqrt(Math.max(0.6, TUBE_R * TUBE_R - (axis - y) ** 2))
    for (const sign of [-1, 1]) {
      writer.box({
        center: new Vector3(sign * (ex - 0.04), y, z + 1.5),
        size: new Vector3(0.12, 0.2, 3.1),
        slot: 'dark',
        chamfer: 0.012,
      })
      writer.box({
        center: new Vector3(sign * (ex - 0.121), y, z + 1.5),
        size: new Vector3(0.038, 0.09, 2.9),
        slot: 'runningLight',
      })
      for (const dy of [-0.075, 0.075]) {
        writer.box({
          center: new Vector3(sign * (ex - 0.15), y + dy, z + 1.5),
          size: new Vector3(0.1, 0.045, 3.02),
          slot: 'steelEdge',
          chamfer: 0.006,
        })
      }
    }
  }

  // --- chainage markers: a plate every 25 m whose raised bars read the
  // hundred-metre count. Diegetic, and it needs no text atlas.
  for (let z = TUBE_START_Z + 14; z < TUBE_END_Z - 6; z += 25) {
    const axis = tubeAxisY(z, arrivalYAt(track, z))
    const y = axis - 3.1
    const ex = Math.sqrt(Math.max(0.6, TUBE_R * TUBE_R - 3.1 * 3.1))
    writer.box({
      center: new Vector3(-(ex - 0.02), y, z),
      size: new Vector3(0.06, 0.62, 0.44),
      slot: 'dark',
      chamfer: 0.01,
    })
    const bars = Math.min(4, 1 + Math.round((z - TUBE_START_Z) / 100))
    for (let bar = 0; bar < bars; bar++) {
      writer.box({
        center: new Vector3(-(ex - 0.06), y + 0.22 - bar * 0.13, z),
        size: new Vector3(0.035, 0.06, 0.3),
        slot: 'orange',
        chamfer: 0.006,
      })
    }
  }
}

// --------------------------------------------------------------- stations --

/**
 * Platform geometry is POLAR, not rectangular. A straight 20 m platform edge
 * held 1.4 m off a 97 m radius reaches r = 96.2 at its ends — inside the
 * 2.6 m car. Every platform therefore lives on an arc concentric with the
 * Loop, which is also what the reference image shows: nothing in this park is
 * a rectangle laid against a curve.
 *
 *   u  arc offset along the platform, 0 at its centre
 *   v  inward from the platform edge (0 = the edge over the trackbed)
 */
export interface ArcPlatform {
  /** Bearing of the platform centre (LOOP.stations[].angle). */
  centreAngle: number
  /** Arc length of the deck. */
  arcLength: number
  /** Radius of the platform edge. 1.40 m off the alignment = 0.10 clear. */
  rEdge: number
  depth: number
  deckY: number
  /** Paving datum the slab stands on. */
  baseY: number
}

/** The default edge radius: 1.40 m inside the alignment. */
export const PLATFORM_EDGE_OFFSET = 1.4

/**
 * The deck datum AT AN ARC OFFSET, not one number for the whole platform.
 * `groundGrade` moves under the boulevard — 0.48 m over Overlook's 18 m of
 * arc — and the guideway follows it, so a level deck would leave the car
 * floor half a metre out at one end. Real platforms carry a longitudinal
 * fall; this one carries exactly the guideway's, which is ≤ 3 %.
 */
export function platformDeckY(spec: ArcPlatform, u: number): number {
  const angle = spec.centreAngle + u / spec.rEdge
  const r = spec.rEdge + PLATFORM_EDGE_OFFSET
  return carFloorY(Math.cos(angle) * r, Math.sin(angle) * r) - 0.02
}

/** Lowest ground under the slab on the radial at `u` — the footing follows it. */
export function platformGroundY(spec: ArcPlatform, u: number): number {
  let lowest = Infinity
  for (let i = 0; i <= 3; i++) {
    const p = platformPoint(spec, u, (spec.depth * i) / 3, 0)
    lowest = Math.min(lowest, surfaceY(p.x, p.z))
  }
  return lowest
}

export function platformPoint(
  spec: ArcPlatform,
  u: number,
  v: number,
  y: number,
): Vector3 {
  const angle = spec.centreAngle + u / spec.rEdge
  const r = spec.rEdge - v
  return new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r)
}

/** Tangent of the platform arc at `u` (direction of increasing u). */
export function platformTangent(spec: ArcPlatform, u: number): Vector3 {
  const angle = spec.centreAngle + u / spec.rEdge
  return new Vector3(-Math.sin(angle), 0, Math.cos(angle))
}

/** Outward radial at `u` — the direction the platform faces the track. */
export function platformOutward(spec: ArcPlatform, u: number): Vector3 {
  const angle = spec.centreAngle + u / spec.rEdge
  return new Vector3(Math.cos(angle), 0, Math.sin(angle))
}

function sectorRing(
  spec: ArcPlatform,
  shrink: number,
  y: (u: number) => number,
  segments: number,
): MVec3[] {
  const rOuter = spec.rEdge - shrink
  const rInner = spec.rEdge - spec.depth + shrink
  const halfU = spec.arcLength / 2 - shrink
  const pts: MVec3[] = []
  const point = (u: number, r: number): MVec3 => {
    const angle = spec.centreAngle + u / spec.rEdge
    return [Math.cos(angle) * r, y(u), Math.sin(angle) * r]
  }
  for (let i = 0; i <= segments; i++) pts.push(point(-halfU + (2 * halfU * i) / segments, rOuter))
  for (let i = segments; i >= 0; i--) pts.push(point(-halfU + (2 * halfU * i) / segments, rInner))
  return pts
}

/**
 * The platform slab: footing that follows the grade → set-back plinth →
 * fascia → chamfered nosing → deck, as seven offset levels of one loft. The
 * edge is moulded rather than sawn, the 120 mm plinth set-back lays a shadow
 * line at the paving, and BOTH the top and the bottom track their own datum —
 * the deck the guideway, the footing the ground — so the slab can neither
 * float at one end nor lose the car floor at the other.
 */
export function emitPlatformSlab(writer: PartWriter, spec: ArcPlatform, slot = 'cast'): void {
  const segments = Math.max(6, Math.round(spec.arcLength / 2.2))
  const deck = (u: number): number => platformDeckY(spec, u)
  const footing = (u: number): number => platformGroundY(spec, u) - 0.42
  const levels: Array<[number, (u: number) => number]> = [
    [0.32, footing],
    [0.12, (u) => Math.min(deck(u) - 0.44, footing(u) + 0.38)],
    [0.12, (u) => deck(u) - 0.3],
    [0, (u) => deck(u) - 0.24],
    [0, (u) => deck(u) - 0.035],
    [0.028, (u) => deck(u) - 0.008],
    [0.05, deck],
  ]
  const md = loft(
    levels.map(([shrink, y]) => sectorRing(spec, shrink, y, segments)),
    { closeV: true, capStart: true, capEnd: true },
  )
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.cast)
  cleanMesh(md)
  writeInto(writer, slot, md, { uvScale: 0.5 })
}

/**
 * The platform edge: a swept tactile corduroy strip, a gap-filler rubbing
 * strip on the nosing, and recessed edge lenses in their bezels
 * (`floorLens` ×2.6 — area, not multiplier).
 */
export function emitPlatformEdge(writer: PartWriter, spec: ArcPlatform): void {
  const segments = Math.max(8, Math.round(spec.arcLength / 1.6))
  const halfU = spec.arcLength / 2 - 0.7
  const runAt = (v: number, drop: number): Station[] => {
    const out: Station[] = []
    for (let i = 0; i <= segments; i++) {
      const u = -halfU + (2 * halfU * i) / segments
      out.push({ p: platformPoint(spec, u, v, platformDeckY(spec, u) + drop), profile: [] })
    }
    return out
  }
  // Tactile corduroy: buried 20 mm, standing 10 mm proud.
  const tactile: Vec2[] = [
    [-0.25, -0.02],
    [0.25, -0.02],
    [0.25, 0.004],
    [0.22, 0.012],
    [-0.22, 0.012],
    [-0.25, 0.004],
  ]
  const tactileRun = runAt(0.44, 0).map((station) => ({
    p: station.p,
    profile: tactile,
  }))
  sweepRun(writer, 'orange', tactileRun, { smooth: SMOOTH.moulded, uvScale: 2.4 })
  // Gap filler: a hard rubber nosing standing 70 mm off the fascia, so the
  // step across to the cabin floor is rubber, not air. Buried 20 mm — proud
  // of its host, never coplanar with it (`geometry-craft` §3).
  const filler: Vec2[] = [
    [0.02, -0.05],
    [0.02, 0.028],
    [-0.045, 0.028],
    [-0.07, 0.004],
    [-0.07, -0.03],
    [-0.04, -0.05],
  ]
  const fillerRun = runAt(0, -0.06).map((station) => ({
    p: station.p,
    profile: filler,
  }))
  sweepRun(writer, 'dark', fillerRun, { smooth: SMOOTH.moulded, uvScale: 2 })
  // Edge lights: proud linear luminaires on the fascia, lens on the underside
  // washing the trackbed. Recessed behind its housing, never a painted band.
  const lenses = Math.max(5, Math.round(spec.arcLength / 2.4))
  for (let i = 0; i <= lenses; i++) {
    const u = -halfU + (2 * halfU * i) / lenses
    const yaw = yawAlong(platformTangent(spec, u))
    const deck = platformDeckY(spec, u)
    writer.box({
      center: platformPoint(spec, u, -0.071, deck - 0.135),
      size: new Vector3(0.15, 0.11, 0.46),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.012,
    })
    writer.box({
      center: platformPoint(spec, u, -0.071, deck - 0.196),
      size: new Vector3(0.1, 0.02, 0.36),
      rotationY: yaw,
      slot: 'floorLens',
    })
  }
}

/**
 * Cantilevered platform canopy on the same arc: tapered columns, lofted
 * rafters, a pitched deck draining to the back, box fascias, and recessed
 * soffit downlights (`utilityLight` ×5.0 — tiny fixtures only).
 */
export function emitPlatformCanopy(
  writer: PartWriter,
  spec: ArcPlatform,
  options: { arcLength: number; reach: number; columnV: number; height?: number },
): void {
  const height = options.height ?? 3.15
  const bays = Math.max(2, Math.round(options.arcLength / 5.4))
  // The canopy rides the deck's own longitudinal fall — a level roof over a
  // falling platform would open a wedge of daylight at one end.
  const base = (u: number): number => platformDeckY(spec, u)
  const eaveY = (u: number): number => base(u) + height
  const ridgeY = (u: number): number => base(u) + height + 0.2
  // The column dies 15 mm inside the rafter soffit (which sits 0.202 under
  // the eave line), and its foot is buried deeper than the base casting.
  const columnH = height - 0.127
  const columnProfile: Vector2[] = [
    new Vector2(0.16, 0),
    new Vector2(0.16, 0.1),
    new Vector2(0.115, 0.17),
    new Vector2(0.098, columnH - 0.5),
    new Vector2(0.132, columnH - 0.14),
    new Vector2(0.132, columnH),
    new Vector2(0, columnH),
  ]
  const uAt = (i: number): number => -options.arcLength / 2 + (i * options.arcLength) / bays
  for (let i = 0; i <= bays; i++) {
    const u = uAt(i)
    const yaw = yawAlong(platformTangent(spec, u))
    writer.lathe({
      center: platformPoint(spec, u, options.columnV, base(u) - 0.06),
      profile: columnProfile,
      slot: 'steel',
      segments: 18,
      capStart: true,
      smoothAngle: SMOOTH.turned,
    })
    writer.box({
      center: platformPoint(spec, u, options.columnV, base(u) + 0.03),
      size: new Vector3(0.44, 0.12, 0.44),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.012,
    })
    // Rafter: a tapered cantilever, deeper over the column than at the tips.
    const rafter: Array<[number, number]> = [
      [options.columnV - options.reach / 2, eaveY(u) + 0.16],
      [options.columnV + options.reach / 2, ridgeY(u) + 0.16],
      [options.columnV + options.reach / 2, ridgeY(u) + 0.04],
      [options.columnV - options.reach / 2, eaveY(u) - 0.18],
    ]
    const ring = (offset: number): MVec3[] =>
      rafter.map(([v, y]) => {
        const p = platformPoint(spec, u + offset, v, y - 0.232)
        return [p.x, p.y, p.z] as MVec3
      })
    const md = loft([ring(-0.055), ring(0.055)], { closeV: true, capStart: true, capEnd: true })
    md.frame = 'y-up'
    smoothShade(md, SMOOTH.moulded)
    cleanMesh(md)
    writeInto(writer, 'steel', md, { uvScale: 0.7 })
  }
  // Roof: one pitched slab per bay, so the deck follows the arc.
  const vFront = options.columnV - options.reach / 2 - 0.02
  const vBack = options.columnV + options.reach / 2 + 0.02
  for (let i = 0; i < bays; i++) {
    const u0 = uAt(i) - (i === 0 ? 0.3 : 0)
    const u1 = uAt(i + 1) + (i === bays - 1 ? 0.3 : 0)
    writer.slab(
      [
        platformPoint(spec, u0, vFront, eaveY(u0)),
        platformPoint(spec, u1, vFront, eaveY(u1)),
        platformPoint(spec, u1, vBack, ridgeY(u1)),
        platformPoint(spec, u0, vBack, ridgeY(u0)),
      ],
      0.07,
      'aluminum',
      0.4,
    )
  }
  // Fascias, in bay-length boxes so they curve with the roof.
  for (const [v, high] of [
    [vFront + 0.055, false],
    [vBack - 0.055, true],
  ] as const) {
    for (let i = 0; i < bays; i++) {
      const u0 = uAt(i) - (i === 0 ? 0.3 : 0)
      const u1 = uAt(i + 1) + (i === bays - 1 ? 0.3 : 0)
      const uMid = (u0 + u1) / 2
      const span = u1 - u0
      writer.box({
        center: platformPoint(spec, uMid, v, (high ? ridgeY(uMid) : eaveY(uMid)) - 0.14),
        size: new Vector3(0.11, 0.19, span),
        rotationY: yawAlong(platformTangent(spec, uMid)),
        slot: 'dark',
        chamfer: 0.01,
      })
    }
  }
  // Soffit downlights.
  for (let i = 0; i < bays * 2; i++) {
    const u = -options.arcLength / 2 + ((i + 0.5) * options.arcLength) / (bays * 2)
    const yaw = yawAlong(platformTangent(spec, u))
    const v = options.columnV - options.reach * 0.22
    writer.box({
      center: platformPoint(spec, u, v, eaveY(u) - 0.15),
      size: new Vector3(0.22, 0.1, 0.22),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.014,
    })
    writer.box({
      center: platformPoint(spec, u, v, eaveY(u) - 0.21),
      size: new Vector3(0.1, 0.022, 0.1),
      rotationY: yaw,
      slot: 'utilityLight',
    })
  }
}

/**
 * Overlook West and Farmside: side platforms inside the Loop, decked at the
 * cabin-floor datum. Portal is its own hero terminus
 * (`world/portalStation.ts`), which reuses every helper above.
 *
 * Signature kept exactly as `tramSystem` calls it: geometry into the writer,
 * canvas text plates into the group, colliders into the physics world.
 */
export function buildStations(writer: PartWriter, group: Group, physics: PhysicsSystem): void {
  for (const station of LOOP.stations) {
    if (station.id === 'portal') continue
    const point = new Vector3(
      Math.cos(station.angle) * LOOP.radius,
      0,
      Math.sin(station.angle) * LOOP.radius,
    )
    // Platform side = LEFT of travel = inside the loop (`tramSystem` doors).
    // 18 m of deck for a 16.7 m train: the boulevard planters resume at
    // ±0.115 rad from every station bearing (`pavingPlan` arcRun), and the end
    // flights have to land inside that gap.
    const spec: ArcPlatform = {
      centreAngle: station.angle,
      arcLength: 18,
      rEdge: LOOP.radius - PLATFORM_EDGE_OFFSET,
      depth: 5.2,
      deckY: carFloorY(point.x, point.z) - 0.02,
      baseY: slabTop(point.x, point.z),
    }
    buildSidePlatform(writer, group, physics, spec, {
      title: station.id === 'overlook' ? 'OVERLOOK WEST' : 'FARMSIDE',
    })
  }
}

function buildSidePlatform(
  writer: PartWriter,
  group: Group,
  physics: PhysicsSystem,
  spec: ArcPlatform,
  options: { title: string },
): void {
  const half = spec.arcLength / 2
  const back = spec.depth - 0.22
  const deckAt = (u: number): number => platformDeckY(spec, u)

  emitPlatformSlab(writer, spec)
  emitPlatformEdge(writer, spec)
  emitPlatformCanopy(writer, spec, {
    arcLength: spec.arcLength - 5.2,
    reach: 4.6,
    columnV: spec.depth * 0.55,
  })
  for (const u of [-half + 3.6, half - 3.6]) {
    leaningRail(writer, spec, u, back - 0.55)
  }
  litterBin(writer, platformPoint(spec, half - 1.8, back - 0.6, deckAt(half - 1.8)))
  stationSign(writer, group, spec, 0, back, options.title)

  // --- access: an end flight each side, and a 1:14 ramp along the back. Riser
  // counts are DERIVED (target 155 mm) — the deck datum comes from the
  // guideway and the apron from the pour, so neither drop is a round number.
  const run = 0.32
  const ends: Array<{ u: number; steps: number; rise: number; drop: number }> = []
  for (const sign of [-1, 1]) {
    const uEdge = sign * (half + 0.08)
    const tangent = platformTangent(spec, uEdge)
    const deck = deckAt(uEdge)
    const probe = platformPoint(spec, uEdge, spec.depth / 2, 0).addScaledVector(tangent, sign * 1)
    const steps = Math.max(2, Math.min(5, Math.round((deck - slabTop(probe.x, probe.z)) / 0.155)))
    const foot = platformPoint(spec, uEdge, spec.depth / 2, 0).addScaledVector(
      tangent,
      sign * steps * run,
    )
    const footY = slabTop(foot.x, foot.z)
    stationSteps(writer, {
      foot: foot.setY(footY),
      climb: tangent.clone().multiplyScalar(-sign),
      across: platformOutward(spec, uEdge),
      steps,
      rise: (deck - footY) / steps,
      run,
      width: 3.0,
    })
    ends.push({
      u: uEdge + (sign * steps * run) / 2,
      steps,
      rise: (deck - footY) / steps,
      drop: deck - footY,
    })
  }
  const rampHead = -half + 1.2
  const rampProbe = platformPoint(spec, rampHead, spec.depth + 0.9, 0)
  const rampFootY = surfaceY(rampProbe.x, rampProbe.z)
  // Clamp the run: behind Overlook the grade falls into a swale, and a true
  // 1:14 there would be a 17 m tongue across the whole back of the platform.
  const rampRun = Math.min(13, Math.max(4, (deckAt(rampHead) - rampFootY) * 14))
  emitPlatformRamp(writer, spec, rampHead, rampRun, rampFootY)

  // --- colliders. The deck is three boxes along the arc; one cuboid over an
  // 18 m arc would stand 0.4 m proud of the slab at its ends.
  const world = physics.world
  const api = physics.api
  if (!world || !api) return
  const body = world.createRigidBody(api.RigidBodyDesc.fixed())
  for (let i = 0; i < 3; i++) {
    const u = -half + (spec.arcLength * (i + 0.5)) / 3
    const deck = deckAt(u)
    const bottom = platformGroundY(spec, u) - 0.4
    const centre = platformPoint(spec, u, spec.depth / 2, (deck + bottom) / 2)
    world.createCollider(
      // `yawAlong(d)` puts local +Z on `d`. The three boxes' CENTRES march
      // along the arc, so the arc half-chunk (`arcLength / 6`) is the local +Z
      // extent and the depth is local +X — i.e. the frame is the TANGENT, not
      // the outward radial. Under `platformOutward` the deck came out 90 deg
      // round: `arcLength / 3` deep, `depth` long, which left a hole in the
      // deck at each of the two seams (measured 0.6 m at Overlook, 1.0 m at
      // Farmside) that a player drops straight through.
      api.ColliderDesc.cuboid(spec.depth / 2, (deck - bottom) / 2, spec.arcLength / 6)
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(pitchYaw(0, yawAlong(platformTangent(spec, u)))),
      body,
    )
  }
  const rampPitch = Math.atan2(deckAt(rampHead) - rampFootY, rampRun)
  const rampMid = platformPoint(
    spec,
    rampHead + rampRun / 2,
    spec.depth + 0.87,
    (deckAt(rampHead) + rampFootY) / 2,
  )
  world.createCollider(
    api.ColliderDesc.cuboid(0.85, 0.1, rampRun / 2)
      .setTranslation(rampMid.x, rampMid.y + 0.08, rampMid.z)
      .setRotation(pitchYaw(rampPitch, yawAlong(platformTangent(spec, rampHead)))),
    body,
  )
  for (const end of ends) {
    const sign = Math.sign(end.u) || 1
    const stairMid = platformPoint(spec, end.u, spec.depth / 2, deckAt(end.u) - end.drop / 2)
    world.createCollider(
      // The flight CLIMBS along the tangent (see `emitPlatformStair`'s
      // `climb`) and is 3.0 m wide across it, so local +Z is the tangent —
      // same frame as the access ramp below. It also puts the pitch on the
      // outward axis, which is the only axis a flight can tilt about.
      api.ColliderDesc.cuboid(1.5, 0.1, (end.steps * run) / 2 + 0.1)
        .setTranslation(stairMid.x, stairMid.y + 0.08, stairMid.z)
        .setRotation(
          pitchYaw(
            -sign * Math.atan2(end.drop, end.steps * run),
            yawAlong(platformTangent(spec, end.u)),
          ),
        ),
      body,
    )
  }
}

/**
 * 1:14 access ramp behind the platform, with kerbs both sides. Built as a
 * RETAINED solid, not a floating deck: each segment's thickness runs down to
 * 0.3 m below the local grade, so the ramp is an embankment wall wherever the
 * ground falls away instead of a plate hovering over it.
 */
export function emitPlatformRamp(
  writer: PartWriter,
  spec: ArcPlatform,
  u0: number,
  rampRun: number,
  footY = spec.baseY,
): void {
  const vNear = spec.depth + 0.02
  const vFar = spec.depth + 1.72
  const segments = 5
  const headY = platformDeckY(spec, u0)
  const yAt = (t: number): number => headY + 0.006 - (headY - footY - 0.014) * t
  for (let i = 0; i < segments; i++) {
    const ua = u0 + (rampRun * i) / segments
    const ub = u0 + (rampRun * (i + 1)) / segments
    const ya = yAt(i / segments)
    const yb = yAt((i + 1) / segments)
    const corners: [Vector3, Vector3, Vector3, Vector3] = [
      platformPoint(spec, ua, vNear, ya),
      platformPoint(spec, ub, vNear, yb),
      platformPoint(spec, ub, vFar, yb),
      platformPoint(spec, ua, vFar, ya),
    ]
    let ground = Infinity
    for (const corner of corners) ground = Math.min(ground, surfaceY(corner.x, corner.z))
    writer.slab(corners, Math.max(0.2, Math.min(ya, yb) - ground + 0.3), 'cast', 0.5)
  }
  for (const v of [vNear + 0.05, vFar - 0.05]) {
    const kerb: Vector3[] = []
    for (let i = 0; i <= segments * 2; i++) {
      const t = i / (segments * 2)
      kerb.push(platformPoint(spec, u0 + rampRun * t, v, yAt(t) + 0.024))
    }
    writer.tube({
      path: kerb,
      radius: 0.05,
      slot: 'dark',
      radialSegments: 8,
      capStart: true,
      capEnd: true,
    })
  }
}

function pitchYaw(pitch: number, yaw: number): { x: number; y: number; z: number; w: number } {
  const q = new Quaternion().setFromAxisAngle(UP, yaw)
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

/** Leaning rail: a polished tube on two legs with real base plates. */
export function leaningRail(
  writer: PartWriter,
  spec: ArcPlatform,
  u: number,
  v: number,
): void {
  const half = 0.78
  for (const sign of [-1, 1]) {
    const foot = platformPoint(spec, u + sign * half, v, platformDeckY(spec, u + sign * half))
    writer.tube({
      path: [foot.clone().setY(foot.y - 0.03), foot.clone().setY(foot.y + 0.78)],
      radius: 0.028,
      slot: 'dark',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
    writer.box({
      center: foot.clone().setY(foot.y + 0.015),
      size: new Vector3(0.17, 0.05, 0.17),
      rotationY: yawAlong(platformTangent(spec, u)),
      slot: 'steelEdge',
      chamfer: 0.008,
    })
  }
  writer.tube({
    path: [
      platformPoint(spec, u - half - 0.09, v, platformDeckY(spec, u - half - 0.09) + 0.78),
      platformPoint(spec, u, v, platformDeckY(spec, u) + 0.78),
      platformPoint(spec, u + half + 0.09, v, platformDeckY(spec, u + half + 0.09) + 0.78),
    ],
    radius: 0.032,
    slot: 'orangeTop',
    radialSegments: 12,
    capStart: true,
    capEnd: true,
  })
}

/** Litter bin: one lathed body carrying its own rolled rim and inner lip. */
export function litterBin(writer: PartWriter, base: Vector3): void {
  writer.lathe({
    center: base.clone().setY(base.y - 0.015),
    profile: [
      new Vector2(0.2, 0),
      new Vector2(0.225, 0.05),
      new Vector2(0.225, 0.1),
      new Vector2(0.255, 0.16),
      new Vector2(0.262, 0.78),
      new Vector2(0.285, 0.84),
      new Vector2(0.285, 0.9),
      new Vector2(0.245, 0.94),
      new Vector2(0.13, 0.965),
      new Vector2(0.13, 0.9),
    ],
    slot: 'dark',
    segments: 24,
    capStart: true,
    capEnd: true,
    smoothAngle: SMOOTH.turned,
  })
}

/**
 * Station name blade: a real frame on posts, a back-lit halo recessed inside
 * it (`signageGlow` ×3.4 — area, not multiplier), and the text plate standing
 * 6 mm proud of the frame face. Reads outward, toward the arriving car.
 */
export function stationSign(
  writer: PartWriter,
  group: Group,
  spec: ArcPlatform,
  u: number,
  v: number,
  title: string,
  options: {
    width?: number
    height?: number
    lines?: string[]
    y?: number
    /** Hang it from the structure above by this much instead of standing it
     *  on posts — the classic station name board under a canopy fascia. */
    hang?: number
  } = {},
): void {
  const width = options.width ?? 3.2
  const height = options.height ?? 0.62
  const y = options.y ?? platformDeckY(spec, u) + 2.62
  const anchor = platformPoint(spec, u, v, y)
  const outward = platformOutward(spec, u)
  const tangent = platformTangent(spec, u)
  const yaw = yawAlong(outward)
  writer.box({
    center: anchor,
    size: new Vector3(0.1, height + 0.14, width),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.014,
  })
  writer.box({
    center: anchor.clone().addScaledVector(outward, -0.056),
    size: new Vector3(0.02, height, width - 0.18),
    rotationY: yaw,
    slot: 'signageGlow',
  })
  for (const sign of [-1, 1]) {
    const post = anchor.clone().addScaledVector(tangent, sign * (width / 2 - 0.12))
    const path = options.hang
      ? [post.clone().setY(post.y + 0.02), post.clone().setY(post.y + options.hang)]
      : [post.clone().setY(post.y - 0.62), post.clone().setY(post.y + 0.42)]
    writer.tube({
      path,
      radius: 0.03,
      slot: 'steel',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
  }
  const plate = new Mesh(
    new PlaneGeometry(width - 0.24, height - 0.06),
    signageMaterial(options.lines ?? [title, 'THE LOOP'], {
      background: '#211f1c',
      accent: '#c94f1d',
      widthPx: 768,
      aspect: (width - 0.24) / (height - 0.06),
    }),
  )
  plate.position.copy(anchor.clone().addScaledVector(outward, 0.056))
  plate.rotation.y = yaw
  plate.castShadow = false
  group.add(plate)
}

export interface StairSpec {
  /** Bottom of the first riser, on the lower landing. */
  foot: Vector3
  /** Direction of ascent (horizontal, unit). */
  climb: Vector3
  /** Across the flight (horizontal, unit). */
  across: Vector3
  steps: number
  rise: number
  run: number
  width: number
}

/**
 * A solid cast flight: a real stepped silhouette lofted across the width, so
 * risers are closed and there is mass under every tread. Alloy nosings stand
 * proud on each tread edge, and a threshold plate bridges the head reveal.
 */
export function stationSteps(writer: PartWriter, spec: StairSpec): void {
  const { foot, climb, across, steps, rise, run } = spec
  const silhouette: Vec2[] = [[-0.12, -0.34], [0, 0]]
  for (let i = 0; i < steps; i++) {
    silhouette.push([i * run, (i + 1) * rise], [(i + 1) * run, (i + 1) * rise])
  }
  silhouette.push([steps * run + 0.1, steps * rise], [steps * run + 0.1, -0.34])
  const ring = (offset: number): MVec3[] =>
    silhouette.map(([v, y]) => [
      foot.x + climb.x * v + across.x * offset,
      foot.y + y,
      foot.z + climb.z * v + across.z * offset,
    ] as MVec3)
  const md = loft([ring(-spec.width / 2), ring(spec.width / 2)], {
    closeV: true,
    capStart: true,
    capEnd: true,
  })
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.cast)
  cleanMesh(md)
  writeInto(writer, 'cast', md, { uvScale: 0.8 })

  const yaw = yawAlong(climb)
  for (let i = 0; i < steps; i++) {
    writer.box({
      center: new Vector3(
        foot.x + climb.x * (i * run + 0.02),
        foot.y + (i + 1) * rise + 0.006,
        foot.z + climb.z * (i * run + 0.02),
      ),
      size: new Vector3(spec.width - 0.07, 0.024, 0.08),
      rotationY: yaw,
      slot: 'steelEdge',
      chamfer: 0.004,
    })
  }
  // Head threshold: 5 mm proud, bridging the reveal onto the deck.
  writer.box({
    center: new Vector3(
      foot.x + climb.x * (steps * run + 0.02),
      foot.y + steps * rise + 0.005,
      foot.z + climb.z * (steps * run + 0.02),
    ),
    size: new Vector3(spec.width - 0.07, 0.02, 0.24),
    rotationY: yaw,
    slot: 'steelEdge',
    chamfer: 0.004,
  })
  for (const sign of [-1, 1]) {
    const post = foot.clone().addScaledVector(across, (sign * spec.width) / 2 - sign * 0.09)
    writer.tube({
      path: [
        post.clone().setY(post.y - 0.03),
        post.clone().setY(post.y + 0.98),
        post
          .clone()
          .addScaledVector(climb, steps * run)
          .setY(post.y + steps * rise + 0.98),
        post
          .clone()
          .addScaledVector(climb, steps * run + 0.28)
          .setY(post.y + steps * rise + 0.98),
      ],
      radius: 0.026,
      slot: 'orangeTop',
      radialSegments: 10,
      capStart: true,
      capEnd: true,
    })
  }
}
