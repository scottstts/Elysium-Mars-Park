/**
 * Headless gate for the tram's draw gear, its car placement and its cabin
 * collider.
 *
 *   node --experimental-strip-types tools/tram-coupling-audit.mjs
 *
 * Checks, in order:
 *  1. the collision hull's point cloud actually wraps the car's skin;
 *  2. every car's BOGIES stay on the alignment they run on;
 *  3. the telescope always spans the two kingpins, with every stage still
 *     nested — swept over the Loop and over the arrival spur INCLUDING the
 *     docked pose, which straddles the spur/loop seam and is the worst
 *     geometry in the park;
 *  4. the jumper hoses land on their glands and never enter a car body;
 *  5. the bar never fouls either body, and the triangle budget.
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
const track = await import('../src/tram/track.ts')

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${label.padEnd(28)} ${ok ? 'OK' : 'FAIL'}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}
const clamp1 = (v) => Math.max(-1, Math.min(1, v))
/** Widest half-section of the car's skin at this station. */
const halfWidthAt = (z) =>
  Math.max(...Array.from({ length: 52 }, (_, j) => Math.abs(shape.hullPoint(z, j, 0, false)[0])))

// ---- 1. collision hull -----------------------------------------------------
{
  const points = shape.hullCollisionPoints()
  const n = points.length / 3
  let maxX = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    maxX = Math.max(maxX, points[i * 3])
    maxZ = Math.max(maxZ, points[i * 3 + 2])
  }
  check('hull cloud', n > 2000, `${n} points`)
  check('hull width', Math.abs(maxX - shape.CAR_WIDTH / 2) < 0.01, `half width ${maxX.toFixed(3)}`)
  check('hull within car length', maxZ <= shape.CAR_LENGTH / 2 + 1e-6, `max |z| ${maxZ.toFixed(3)}`)
}

// ---- the draw gear over every geometry the Loop presents --------------------
{
  const built = coupling.buildTramCoupling(new Proxy({}, { get: () => ({ isMaterial: true }) }))
  const front = new Object3D()
  const rear = new Object3D()
  const SPACING = 8.7
  const BOGIE_Z = 2.45
  const NECK = 0.05
  const STAGE_LEN = 0.44
  const STAGES = 4
  const NOMINAL = SPACING - 2 * coupling.PIN_Z

  // Place a car exactly as tramSystem does: the chord between its bogies.
  const place = (car, s, path) => {
    const b = path(s - BOGIE_Z)
    const a = path(s + BOGIE_Z)
    car.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.62, (a.z + b.z) / 2)
    car.rotation.set(0, Math.atan2(a.x - b.x, a.z - b.z), 0)
    car.rotateX(-Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z)))
    car.updateMatrixWorld()
  }

  const data = track.buildTrackData()
  const loopAt = (s) => {
    const t = (((s % data.loopLength) + data.loopLength) % data.loopLength) / data.loopLength
    return data.loop.getPointAt(t)
  }
  // tramSystem.carPoint: the spur, continuing seamlessly onto the loop past its
  // end. The DOCKED pose straddles that seam, and it is the pose guests stand
  // next to for 22 seconds — clamping instead reports a fiction.
  const spurAt = (s) => {
    if (s <= data.arrivalLength) {
      return data.arrival.getPointAt(Math.min(1, Math.max(0, s / data.arrivalLength)))
    }
    const t = (data.handoffS + (s - data.arrivalLength)) / data.loopLength
    return data.loop.getPointAt(((t % 1) + 1) % 1)
  }

  const paths = {
    'REAL loop': [loopAt, 0, data.loopLength, 1.3],
    'REAL arrival spur': [spurAt, 20, data.arrivalLength, 1.0],
  }

  const stageOf = (i) => built.group.getObjectByName(`tram-coupling-stage-${i}`)
  const hoseMeshes = built.group.children.filter((c) => c.isMesh)

  const from = new Vector3()
  const to = new Vector3()
  const axisF = new Vector3()
  const axisR = new Vector3()
  const barAxis = new Vector3()
  const gland = new Vector3()
  const probe = new Vector3()
  const local = new Vector3()
  const inverse = new Object3D()

  /**
   * How deep inside a car's SKIN is this world point?
   *
   * Against the true cross-section at that station, not a box of its widest
   * half-width: the coupling all lives at y ≈ 0, where the car is a 1.16 m
   * bumper, while its widest point (2.60 m) is up at the beltline. A box test
   * calls a hose that is comfortably outside the underframe a 140 mm intrusion.
   */
  const carDepth = (car, point) => {
    inverse.matrix.copy(car.matrixWorld).invert()
    local.copy(point).applyMatrix4(inverse.matrix)
    if (Math.abs(local.z) > shape.CAR_LENGTH / 2 - 0.005) return 0
    const section = Array.from({ length: shape.IDX.COUNT }, (_, j) =>
      shape.hullPoint(local.z, j, 0, false),
    )
    let inside = false
    let best = Infinity
    for (let i = 0, k = section.length - 1; i < section.length; k = i++) {
      const [ax, ay] = section[i]
      const [bx, by] = section[k]
      if (ay > local.y !== by > local.y) {
        if (local.x < ((bx - ax) * (local.y - ay)) / (by - ay) + ax) inside = !inside
      }
      const ex = bx - ax
      const ey = by - ay
      const t = Math.max(0, Math.min(1, ((local.x - ax) * ex + (local.y - ay) * ey) / (ex * ex + ey * ey || 1)))
      best = Math.min(best, Math.hypot(local.x - ax - ex * t, local.y - ay - ey * t))
    }
    return inside ? best : 0
  }

  /** How far each bogie centre sits off the alignment it runs on. */
  const wheelError = (car, s, path) => {
    let worst = 0
    for (const sz of [-BOGIE_Z, BOGIE_Z]) {
      probe.set(0, 0, sz).applyMatrix4(car.matrixWorld)
      let best = Infinity
      for (let d = -4; d <= 4; d += 0.05) {
        const p = path(s + sz + d)
        best = Math.min(best, Math.hypot(p.x - probe.x, p.z - probe.z))
      }
      worst = Math.max(worst, best)
    }
    return worst
  }

  for (const [name, [path, lo, hi, step]] of Object.entries(paths)) {
    let minSpan = Infinity
    let maxSpan = -Infinity
    let maxKink = 0
    let maxSwing = 0
    let minNest = Infinity
    let maxHose = 0
    let maxWheel = 0
    let reachError = 0
    let hoseDepth = 0
    let barDepth = 0
    for (let s = lo; s <= hi; s += step) {
      place(front, s + SPACING / 2, path)
      place(rear, s - SPACING / 2, path)
      built.update(front, rear)
      maxWheel = Math.max(
        maxWheel,
        wheelError(front, s + SPACING / 2, path),
        wheelError(rear, s - SPACING / 2, path),
      )
      from.set(0, coupling.PIN_Y, -coupling.PIN_Z).applyMatrix4(front.matrixWorld)
      to.set(0, coupling.PIN_Y, coupling.PIN_Z).applyMatrix4(rear.matrixWorld)
      const span = from.distanceTo(to)
      minSpan = Math.min(minSpan, span)
      maxSpan = Math.max(maxSpan, span)

      // The last stage must reach the far pin: nothing scales, so this is pure
      // arithmetic and any drift is a real defect.
      const tail = stageOf(STAGES - 1).position.z + STAGE_LEN
      reachError = Math.max(reachError, Math.abs(tail - (span - NECK)))
      for (let i = 1; i < STAGES; i++) {
        minNest = Math.min(minNest, stageOf(i - 1).position.z + STAGE_LEN - stageOf(i).position.z)
      }

      axisF.set(0, 0, -1).applyQuaternion(front.quaternion)
      axisR.set(0, 0, 1).applyQuaternion(rear.quaternion)
      barAxis.subVectors(to, from).normalize()
      maxSwing = Math.max(
        maxSwing,
        (Math.acos(clamp1(axisF.dot(barAxis))) * 180) / Math.PI,
        (Math.acos(clamp1(-axisR.dot(barAxis))) * 180) / Math.PI,
      )
      maxKink = Math.max(maxKink, (Math.acos(clamp1(-axisF.dot(axisR))) * 180) / Math.PI)

      // Hoses: both ends inside their gland, no station inside a car body.
      for (let h = 0; h < 2; h++) {
        const sx = h === 0 ? -1 : 1
        const pos = hoseMeshes[h].geometry.getAttribute('position')
        const ring = 9
        for (const [vertex, car, sign] of [
          [0, front, -1],
          [pos.count - ring, rear, 1],
        ]) {
          gland
            .copy(coupling.hoseGland(sx, sign, new Vector3()))
            .applyMatrix4(car.matrixWorld)
          probe.fromBufferAttribute(pos, vertex)
          maxHose = Math.max(maxHose, Math.abs(probe.distanceTo(gland) - 0.018))
        }
        // Every station's SURFACE, not its centreline — a hose that touches a
        // fillet is fine, one that disappears into the bodywork is not.
        for (let v = 0; v < pos.count; v += ring) {
          probe.fromBufferAttribute(pos, v)
          const depth = Math.max(carDepth(front, probe), carDepth(rear, probe))
          if (depth > 0 && depth + 0.018 > hoseDepth) {
            hoseDepth = depth + 0.018
            if (process.env.HOSE_DEBUG) {
              console.log(
                `   hose ${h} station ${v / ring} at s=${s.toFixed(1)} depth ${(depth * 1000).toFixed(0)} mm ` +
                  `local ${local.x.toFixed(2)},${local.y.toFixed(2)},${local.z.toFixed(2)}`,
              )
            }
          }
        }
      }

      // The bar's envelope must never reach either car's skin.
      for (let t = 0.04; t <= 0.96; t += 0.04) {
        probe.lerpVectors(from, to, t)
        const depth = Math.max(carDepth(front, probe), carDepth(rear, probe))
        if (depth > 0) barDepth = Math.max(barDepth, depth + 0.062)
      }
    }
    check(
      `draw gear · ${name}`,
      minNest > 0.04 &&
        reachError < 1e-4 &&
        maxHose < 0.002 &&
        hoseDepth < 0.005 &&
        barDepth === 0 &&
        maxWheel < 0.12,
      `span ${minSpan.toFixed(3)}…${maxSpan.toFixed(3)} (nominal ${NOMINAL.toFixed(3)})  ` +
        `nest ${(minNest * 1000).toFixed(0)} mm  reach err ${(reachError * 1000).toFixed(3)} mm  ` +
        `gland ${(maxHose * 1000).toFixed(1)} mm  swing ${maxSwing.toFixed(1)} deg  kink ${maxKink.toFixed(1)} deg  ` +
        `wheel ${(maxWheel * 1000).toFixed(0)} mm  into body: bar ${(barDepth * 1000).toFixed(0)} hose ${(hoseDepth * 1000).toFixed(0)} mm`,
    )
  }

  // The docked pose is the one guests stand next to for 22 seconds.
  place(front, data.arrivalLength + SPACING / 2, spurAt)
  place(rear, data.arrivalLength - SPACING / 2, spurAt)
  built.update(front, rear)
  from.set(0, coupling.PIN_Y, -coupling.PIN_Z).applyMatrix4(front.matrixWorld)
  to.set(0, coupling.PIN_Y, coupling.PIN_Z).applyMatrix4(rear.matrixWorld)
  axisF.set(0, 0, -1).applyQuaternion(front.quaternion)
  axisR.set(0, 0, 1).applyQuaternion(rear.quaternion)
  const dockSpan = from.distanceTo(to)
  const dockKink = (Math.acos(clamp1(-axisF.dot(axisR))) * 180) / Math.PI
  // Two rigid 8 m bodies on a 7.6 m hook: the ONE thing the placement model
  // cannot be allowed to do is drive them through each other.
  const corners = (o) =>
    [
      [-1.3, -4],
      [1.3, -4],
      [1.3, 4],
      [-1.3, 4],
    ].map(([x, z]) => new Vector3(x, 0, z).applyMatrix4(o.matrixWorld))
  let bodyGap = Infinity
  for (const a of corners(front)) {
    for (const b of corners(rear)) bodyGap = Math.min(bodyGap, Math.hypot(a.x - b.x, a.z - b.z))
  }
  check(
    'docked pose',
    dockSpan < 1.6 && bodyGap > 0.4,
    `span ${dockSpan.toFixed(3)} m  kink ${dockKink.toFixed(1)} deg  body gap ${bodyGap.toFixed(3)} m`,
  )

  const group = new Group()
  group.add(built.group, built.forkFront, built.forkRear)
  let tris = 0
  group.traverse((node) => {
    if (!node.isMesh) return
    tris += node.geometry.index
      ? node.geometry.index.count / 3
      : node.geometry.getAttribute('position').count / 3
  })
  check('coupling budget', tris < 9000, `${tris} triangles`)
}

console.log(failures === 0 ? '\ntram coupling audit PASS' : `\ntram coupling audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
