/**
 * Headless gate for the tram's draw gear and its cabin collider.
 *
 *   node --experimental-strip-types tools/tram-coupling-audit.mjs
 *
 * Checks, in order:
 *  1. the collision hull's point cloud actually wraps the car's skin;
 *  2. the coupling's bar always reaches its seat — swept over the Loop's
 *     curvature, the arrival spur's transitions, and a worst-case grade;
 *  3. the aimed bar never fouls either car's body;
 *  4. the coupling group's triangle budget.
 */
import { registerHooks } from 'node:module'
import { Group, Object3D, Vector3 } from 'three'

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
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
}
globalThis.window = globalThis

const shape = await import('../src/tram/tramShape.ts')
const coupling = await import('../src/tram/tramCoupling.ts')

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${label.padEnd(30)} ${ok ? 'OK' : 'FAIL'}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

// ---- 1. collision hull -----------------------------------------------------
{
  const points = shape.hullCollisionPoints()
  const n = points.length / 3
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[i * 3])
    maxX = Math.max(maxX, points[i * 3])
    minY = Math.min(minY, points[i * 3 + 1])
    maxY = Math.max(maxY, points[i * 3 + 1])
    minZ = Math.min(minZ, points[i * 3 + 2])
    maxZ = Math.max(maxZ, points[i * 3 + 2])
  }
  check(
    'hull cloud',
    n > 2000 && Number.isFinite(minX),
    `${n} pts  x ${minX.toFixed(3)}…${maxX.toFixed(3)}  y ${minY.toFixed(3)}…${maxY.toFixed(3)}  ` +
      `z ${minZ.toFixed(3)}…${maxZ.toFixed(3)}`,
  )
  check('hull width', Math.abs(maxX - shape.CAR_WIDTH / 2) < 0.01, `half width ${maxX.toFixed(3)}`)
  check('hull within car length', maxZ <= shape.CAR_LENGTH / 2 + 1e-6, `max |z| ${maxZ.toFixed(3)}`)

  // The old box: how far proud of the skin was it at each station?
  let worst = 0
  let worstZ = 0
  for (const z of shape.STATIONS) {
    const half = Math.max(
      ...Array.from({ length: 52 }, (_, j) => Math.abs(shape.hullPoint(z, j, 0, false)[0])),
    )
    const proud = shape.CAR_WIDTH / 2 + 0.05 - half
    if (proud > worst) {
      worst = proud
      worstZ = z
    }
  }
  console.log(
    `  old box stood ${worst.toFixed(3)} m proud of the skin at z ${worstZ.toFixed(2)} ` +
      `(+0.41 capsule/offset = ${(worst + 0.41).toFixed(2)} m of phantom blocking)`,
  )
}

// ---- 2 & 3. the bar reaches its seat, over every geometry the Loop presents -
{
  const built = coupling.buildTramCoupling(
    new Proxy({}, { get: () => ({ isMaterial: true }) }),
  )
  const front = new Object3D()
  const rear = new Object3D()
  const SPACING = 8.7
  const NOMINAL = SPACING - coupling.COUPLER_HEAD_Z - coupling.SOCKET_SEAT_Z

  // Place a car exactly as tramSystem does: sample the path, centred chord.
  const place = (car, s, path) => {
    const p = path(s)
    const b = path(s - 0.75)
    const a = path(s + 0.75)
    car.position.set(p.x, p.y + 0.62, p.z)
    car.rotation.set(0, Math.atan2(a.x - b.x, a.z - b.z), 0)
    car.rotateX(-Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z)))
    car.updateMatrixWorld()
  }

  const track = await import('../src/tram/track.ts')
  const data = track.buildTrackData()
  const loopAt = (s) => {
    const t = (((s % data.loopLength) + data.loopLength) % data.loopLength) / data.loopLength
    return data.loop.getPointAt(t)
  }
  const spurAt = (s) => {
    const clamped = Math.min(data.arrivalLength, Math.max(0, s))
    return data.arrival.getPointAt(clamped / data.arrivalLength)
  }

  // [sampler, sweep limit] — the spur is finite, and running a car past its
  // end clamps both cars onto one point and reports nonsense.
  const paths = {
    'REAL loop': [loopAt, 600],
    'REAL arrival spur': [spurAt, data.arrivalLength - 8],
    'ideal r97': [(s) => new Vector3(Math.cos(s / 97) * 97, 0, Math.sin(s / 97) * 97), 160],
    'crest 4%': [(s) => new Vector3(s, Math.sin(s / 30) * 1.2, 0), 160],
  }

  const from = new Vector3()
  const to = new Vector3()
  const ballWorld = new Vector3()
  const BALL_LOCAL = new Vector3()
  for (const [name, [path, limit]] of Object.entries(paths)) {
    let minLen = Infinity
    let maxLen = -Infinity
    let maxAngle = 0
    let maxSeatError = 0
    let minStroke = Infinity
    let maxHoseError = 0
    for (let s = 6; s < limit; s += 1.3) {
      place(front, s + SPACING / 2, path)
      place(rear, s - SPACING / 2, path)
      built.update(front, rear)
      from.set(0, 0, -coupling.COUPLER_HEAD_Z).applyMatrix4(front.matrixWorld)
      to.set(0, 0, coupling.SOCKET_SEAT_Z).applyMatrix4(rear.matrixWorld)
      const length = from.distanceTo(to)
      minLen = Math.min(minLen, length)
      maxLen = Math.max(maxLen, length)
      // The ball must land ON the seat, whatever the span: that is the whole
      // point of the telescoping run.
      const bar = built.group.getObjectByName('tram-coupling-bar')
      const head = bar.children.find((c) => c.position.z > 0 && c.scale.z === 1)
      BALL_LOCAL.set(0, 0, 0)
      ballWorld.copy(BALL_LOCAL).applyMatrix4(head.matrixWorld)
      maxSeatError = Math.max(maxSeatError, ballWorld.distanceTo(to))
      const run = bar.children.find((c) => c.scale.z !== 1)
      minStroke = Math.min(minStroke, run ? run.scale.z : 0)
      // The jumper hoses must land ON the rear car's head TIP, which is 0.16 m
      // along that car's own axis past the seat the bar aims at — a different
      // target, hence a second aimed group.
      const hose = built.group.getObjectByName('tram-coupling-jumpers').children[0]
      const hoseEnd = new Vector3(0, 0, 1).applyMatrix4(hose.matrixWorld)
      const rearTip = new Vector3(0, 0, coupling.COUPLER_HEAD_Z).applyMatrix4(rear.matrixWorld)
      maxHoseError = Math.max(maxHoseError, hoseEnd.distanceTo(rearTip))
      const fa = new Vector3(0, 0, 1).applyQuaternion(front.quaternion)
      const ra = new Vector3(0, 0, 1).applyQuaternion(rear.quaternion)
      maxAngle = Math.max(maxAngle, (Math.acos(Math.min(1, fa.dot(ra))) * 180) / Math.PI)
    }
    check(
      `draw gear · ${name}`,
      maxSeatError < 1e-4 && minStroke > 0.02 && maxHoseError < 0.01,
      `span ${minLen.toFixed(3)}…${maxLen.toFixed(3)} (nominal ${NOMINAL.toFixed(3)})  ` +
        `seat error ${(maxSeatError * 1000).toFixed(3)} mm  hose end ${(maxHoseError * 1000).toFixed(1)} mm  min stroke ${(minStroke * 1000).toFixed(0)} mm  ` +
        `car-to-car ${maxAngle.toFixed(2)} deg`,
    )
  }

  // The bar's envelope (r 0.104 boot) must never reach either car's skin.
  place(front, 40 + SPACING / 2, paths['REAL loop'][0])
  place(rear, 40 - SPACING / 2, paths['REAL loop'][0])
  built.update(front, rear)
  const local = new Vector3()
  let fouls = 0
  for (let t = 0; t <= 1; t += 0.02) {
    for (const car of [front, rear]) {
      const p = new Vector3(0, 0, t * NOMINAL).applyMatrix4(built.group.matrixWorld)
      local.copy(p).applyMatrix4(car.matrixWorld.clone().invert())
      if (Math.abs(local.z) > shape.CAR_LENGTH / 2) continue
      const half = Math.max(
        ...Array.from({ length: 52 }, (_, j) => Math.abs(shape.hullPoint(local.z, j, 0, false)[0])),
      )
      if (Math.hypot(local.x, local.y) < 0.104 && Math.abs(local.x) < half) fouls++
    }
  }
  check('bar clears both bodies', fouls === 0, `${fouls} sampled intrusions`)

  const group = new Group()
  group.add(built.group, built.socket)
  let tris = 0
  group.traverse((node) => {
    if (node.isMesh) tris += node.geometry.getAttribute('position').count / 3
  })
  check('coupling budget', tris < 6000, `${tris} triangles`)
}

console.log(failures === 0 ? '\ntram coupling audit PASS' : `\ntram coupling audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
