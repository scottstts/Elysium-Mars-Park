import { CatmullRomCurve3, Vector3 } from 'three'
import type { PartWriter } from '../archkit/writer'
import { interiorHeight } from '../world/interiorHeight'
import { LOOP } from '../world/parkPlan'

/**
 * The Loop's geometry: a closed circle through the three stations plus the
 * open arrival spur that dives through the portal tube from the spaceport.
 * The tram is a rubber-tired guided vehicle on a cast ISRU guideway beam —
 * no sleepers, one clean beam with twin steel wear strips.
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

  // Arrival spur: deep in the connector tube → portal → sweep to the stop.
  const arrivalPoints = [
    new Vector3(0, 6.9, 640),
    new Vector3(0, 6.4, 540),
    new Vector3(0, 5.2, 420),
    new Vector3(0, 4.0, 320),
    new Vector3(0, 3.1, 262),
    new Vector3(-3.5, 2.4, 236),
    new Vector3(-9, 1.7, 221),
    new Vector3(-8, 1.42, 212),
  ]
  // Land exactly on the loop at the portal stop, tangent eastward.
  const portalStop = loop.getPointAt(0)
  arrivalPoints.push(portalStop.clone().add(new Vector3(-3, 0.02, 0.4)), portalStop.clone())
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
 * Beam top height. On open ground the beam rides 0.62 above grade; through
 * a station pad it DROPS so the car floor (beamTop + 0.62) meets the deck —
 * platforms overhang the guideway like real transit.
 */
const STATION_PADS: Array<{ x: number; z: number; y: number; radius: number; skirt: number }> = [
  { x: 0, z: 194, y: 1.35, radius: 25, skirt: 12 },
]

export function beamTopY(x: number, z: number): number {
  const open = Math.max(interiorHeight(x, z) + 0.12, 0.55) + 0.5
  let result = open
  for (const pad of STATION_PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    if (d < pad.radius + pad.skirt) {
      const inside = pad.y - 0.58
      const blend = d < pad.radius ? 1 : 1 - (d - pad.radius) / pad.skirt
      const eased = blend * blend * (3 - 2 * blend)
      result = open * (1 - eased) + inside * eased
    }
  }
  return result
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
  return best
}

/** Cast guideway beam with wear strips + pylons where the grade dips away. */
export function buildGuideway(writer: PartWriter, track: TrackData): void {
  for (const [curve, length, closed] of [
    [track.loop, track.loopLength, true],
    [track.arrival, track.arrivalLength, false],
  ] as const) {
    const step = 3.2
    const count = Math.ceil(length / step)
    for (let i = 0; i < count; i++) {
      const s0 = (i * step) / length
      const s1 = Math.min(1, ((i + 1) * step) / length)
      if (!closed && s1 >= 1) break
      const a = curve.getPointAt(s0)
      const b = curve.getPointAt(s1 % 1)
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const yaw = Math.atan2(b.x - a.x, b.z - a.z)
      const run = a.distanceTo(b)
      writer.box({
        center: mid.clone().add(new Vector3(0, -0.25, 0)),
        size: new Vector3(1.35, 0.5, run + 0.06),
        rotationY: yaw,
        slot: 'cast',
        chamfer: 0.03,
        uvScale: 0.6,
      })
      // Twin wear strips.
      for (const w of [-0.42, 0.42]) {
        writer.box({
          center: mid
            .clone()
            .add(new Vector3(Math.cos(yaw) * w, 0.025, -Math.sin(yaw) * w)),
          size: new Vector3(0.14, 0.05, run + 0.06),
          rotationY: yaw,
          slot: 'steelEdge',
        })
      }
      // Pylon down to grade when the beam rides high (tube + dips).
      const ground = interiorHeight(mid.x, mid.z)
      const beamBottom = mid.y - 0.5
      if (i % 2 === 0 && beamBottom - ground > 0.3 && mid.z < 248) {
        writer.box({
          center: new Vector3(mid.x, (ground + beamBottom) / 2, mid.z),
          size: new Vector3(0.5, Math.max(0.1, beamBottom - ground), 0.7),
          rotationY: yaw,
          slot: 'cast',
          chamfer: 0.02,
        })
      }
    }
  }
}

/**
 * The connector tube: interior wall, structural rings, running lights, and
 * the portal iris (six wedge blades that swing open for the tram).
 */
export interface TubeParts {
  irisBlades: Array<{ pivotYaw: number }>
}

export function buildTube(writer: PartWriter, track: TrackData): void {
  const radius = 5.6
  // Interior wall: big open-ended tube along the arrival spur (z 250 → 640).
  const wallPath: Vector3[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const z = 250 + t * 396
    const s = nearestArrivalT(track, z)
    const p = track.arrival.getPointAt(s)
    wallPath.push(new Vector3(p.x, p.y + 1.6, z))
  }
  writer.tube({
    path: wallPath,
    radius,
    slot: 'tubeWall',
    radialSegments: 22,
    uvScale: 0.12,
  })
  // Structural rings + twin running-light strips.
  for (let i = 0; i <= 24; i++) {
    const z = 252 + i * 16
    if (z > 640) break
    const s = nearestArrivalT(track, z)
    const p = track.arrival.getPointAt(s)
    const center = new Vector3(p.x, p.y + 1.6, z)
    const ringPath: Vector3[] = []
    for (let r = 0; r <= 20; r++) {
      const angle = (r / 20) * Math.PI * 2
      ringPath.push(
        center.clone().add(new Vector3(Math.cos(angle) * (radius - 0.12), Math.sin(angle) * (radius - 0.12), 0)),
      )
    }
    writer.tube({ path: ringPath, radius: 0.09, slot: 'dark', radialSegments: 8 })
    for (const side of [-1, 1]) {
      writer.box({
        center: center.clone().add(new Vector3(side * (radius - 0.3), -0.6, 0)),
        size: new Vector3(0.12, 0.1, 2.2),
        slot: 'runningLight',
      })
    }
  }
  // Walkway strips beside the beam through the tube.
  for (const side of [-1.35, 1.35]) {
    for (let i = 0; i < 33; i++) {
      const z = 252 + i * 12
      const s = nearestArrivalT(track, z)
      const p = track.arrival.getPointAt(s)
      writer.box({
        center: new Vector3(p.x + side, p.y - 0.42, z),
        size: new Vector3(1.0, 0.08, 12.2),
        slot: 'deck',
      })
    }
  }
}

function nearestArrivalT(track: TrackData, z: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i <= 200; i++) {
    const t = i / 200
    const p = track.arrival.getPointAt(t)
    const d = Math.abs(p.z - z)
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}
