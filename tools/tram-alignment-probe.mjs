/**
 * Diagnostic (not a gate): what does the Loop's alignment actually ask of the
 * train, and what does the placement model do with it?
 *
 *   node --experimental-strip-types tools/tram-alignment-probe.mjs
 *
 * Written while fixing the draw gear, and kept because it is the evidence for
 * two findings a gate cannot express:
 *
 *  1. Placing a car by a POINT on the alignment with a tangent heading throws
 *     its own bogies 0.82 m off the guideway on the platform hook. Placing it
 *     by the CHORD BETWEEN ITS BOGIES — which is what a bogied vehicle does —
 *     brings that to 68 mm. `tramSystem.placeCars` now does the latter.
 *  2. Even then, the arrival spur's last 11 m turn ~85 deg to meet the loop
 *     tangentially at the portal stop. Two rigid 8 m cars on that hook sit
 *     53 deg apart while DOCKED, with 1.45 m between their coupler faces
 *     against 0.58 m on plain track. The coupling is built for that range; the
 *     alignment is the thing that would have to change to remove it.
 */
import { registerHooks } from 'node:module'
import { Object3D, Vector3 } from 'three'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* fall through */
      }
    }
    return next(specifier, context)
  },
})
const stubCtx = new Proxy({}, { get: () => () => ({ width: 10 }) })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }) }
globalThis.window = globalThis

const track = await import('../src/tram/track.ts')
const coupling = await import('../src/tram/tramCoupling.ts')
const data = track.buildTrackData()

const SPACING = 8.7
const BOGIE_Z = 2.45
const PIN = coupling.PIN_Z

console.log(
  `arrival spur ${data.arrivalLength.toFixed(1)} m · loop ${data.loopLength.toFixed(1)} m · ` +
    `handoff at s ${data.handoffS.toFixed(2)}`,
)

const loopAt = (s) =>
  data.loop.getPointAt(((((s % data.loopLength) + data.loopLength) % data.loopLength)) / data.loopLength)
/** tramSystem.carPoint: the spur, continuing onto the loop past its end. */
const carPoint = (s) => {
  if (s <= data.arrivalLength) {
    return data.arrival.getPointAt(Math.min(1, Math.max(0, s / data.arrivalLength)))
  }
  const t = (data.handoffS + (s - data.arrivalLength)) / data.loopLength
  return data.loop.getPointAt(((t % 1) + 1) % 1)
}

let MODE = 'bogie'
const place = (car, s, path) => {
  const half = MODE === 'bogie' ? BOGIE_Z : 0.75
  const b = path(s - half)
  const a = path(s + half)
  const p = MODE === 'bogie' ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : path(s)
  car.position.set(p.x, p.y + 0.62, p.z)
  car.rotation.set(0, Math.atan2(a.x - b.x, a.z - b.z), 0)
  car.rotateX(-Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z)))
  car.updateMatrixWorld()
}

const wheelError = (car, s, path) => {
  let worst = 0
  for (const sz of [-BOGIE_Z, BOGIE_Z]) {
    const w = new Vector3(0, 0, sz).applyMatrix4(car.matrixWorld)
    let best = Infinity
    for (let d = -5; d <= 5; d += 0.05) {
      const p = path(s + sz + d)
      best = Math.min(best, Math.hypot(p.x - w.x, p.z - w.z))
    }
    worst = Math.max(worst, best)
  }
  return worst
}

const front = new Object3D()
const rear = new Object3D()
const clamp1 = (v) => Math.max(-1, Math.min(1, v))

const sweep = (path, lo, hi, step) => {
  let maxSpan = 0
  let maxKink = 0
  let maxWheel = 0
  for (let s = lo; s <= hi; s += step) {
    place(front, s + SPACING / 2, path)
    place(rear, s - SPACING / 2, path)
    const from = new Vector3(0, coupling.PIN_Y, -PIN).applyMatrix4(front.matrixWorld)
    const to = new Vector3(0, coupling.PIN_Y, PIN).applyMatrix4(rear.matrixWorld)
    maxSpan = Math.max(maxSpan, from.distanceTo(to))
    const af = new Vector3(0, 0, -1).applyQuaternion(front.quaternion)
    const ar = new Vector3(0, 0, 1).applyQuaternion(rear.quaternion)
    maxKink = Math.max(maxKink, (Math.acos(clamp1(-af.dot(ar))) * 180) / Math.PI)
    maxWheel = Math.max(maxWheel, wheelError(front, s + SPACING / 2, path), wheelError(rear, s - SPACING / 2, path))
  }
  return { maxSpan, maxKink, maxWheel }
}

for (const mode of ['tangent', 'bogie']) {
  MODE = mode
  const loop = sweep(loopAt, 0, data.loopLength, 1.5)
  const spur = sweep(carPoint, 40, data.arrivalLength, 1.5)
  console.log(
    `\n${mode.padEnd(8)} loop:  span ≤ ${loop.maxSpan.toFixed(3)}  kink ≤ ${loop.maxKink.toFixed(1)}°  ` +
      `wheels off ≤ ${(loop.maxWheel * 1000).toFixed(0)} mm`,
  )
  console.log(
    `${''.padEnd(8)} spur:  span ≤ ${spur.maxSpan.toFixed(3)}  kink ≤ ${spur.maxKink.toFixed(1)}°  ` +
      `wheels off ≤ ${(spur.maxWheel * 1000).toFixed(0)} mm`,
  )
}

MODE = 'bogie'
place(front, data.arrivalLength + SPACING / 2, carPoint)
place(rear, data.arrivalLength - SPACING / 2, carPoint)
const yawOf = (o) => {
  const v = new Vector3(0, 0, 1).applyQuaternion(o.quaternion)
  return ((Math.atan2(v.x, v.z) * 180) / Math.PI).toFixed(1)
}
console.log(
  `\nDOCKED   front (${front.position.x.toFixed(2)}, ${front.position.z.toFixed(2)}) yaw ${yawOf(front)}°  ` +
    `rear (${rear.position.x.toFixed(2)}, ${rear.position.z.toFixed(2)}) yaw ${yawOf(rear)}°`,
)

// The spur's own curvature, sampled as a turn rate over its last 40 m.
console.log('\nspur curvature into the stop (radius of the osculating circle):')
for (let s = data.arrivalLength - 40; s < data.arrivalLength; s += 5) {
  const a = carPoint(s - 2)
  const b = carPoint(s + 2)
  const c = carPoint(s + 6)
  const h1 = Math.atan2(b.x - a.x, b.z - a.z)
  const h2 = Math.atan2(c.x - b.x, c.z - b.z)
  let d = h2 - h1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  console.log(`  s ${s.toFixed(0).padStart(4)}   R ≈ ${Math.abs(d) < 1e-4 ? '∞' : (4 / Math.abs(d)).toFixed(1)} m`)
}
