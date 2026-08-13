/**
 * Headless gate for the arrival portal's hood and bulkhead.
 *
 *   node --experimental-strip-types tools/portal-audit.mjs
 *
 * The owner report was "two spots where the material seems different, like two
 * meshes combined together in an unclean way", at the two meridians where the
 * hood dies into the bulkhead. The cause is measurable and so is the fix:
 *
 *  - **Grazing angle.** Where the hood crosses the bulkhead's flange plane it
 *    must do so TRANSVERSALLY. A sheet that approaches a plane tangentially
 *    lies within its own wall thickness of that plane over a long band, which
 *    is a z-fight however the normals are computed.
 *  - **Nothing visible may sit within a wall thickness of the flange.** Sampled
 *    directly: for every point on the hood's mid-surface that is OUTSIDE the
 *    collar's solid, how close does it come to z = 127.10?
 *  - **The rim is buried**, and the hood never breaks out through the drum or
 *    the tube shell.
 */
import { registerHooks } from 'node:module'
import { Vector3 } from 'three'

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

const dome = await import('../src/dome/connectorTube.ts')

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${label.padEnd(26)} ${ok ? 'OK' : 'FAIL'}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const {
  COLLAR_BORE,
  COLLAR_OUTER,
  COLLAR_INBOARD_Z,
  COLLAR_OUTBOARD_Z,
  SKIRT_RIM_R,
  SKIRT_RIM_Z,
  SKIRT_WALL,
  apertureZ,
  skirtPoint,
  skirtBandEnd,
} = dome.__portalProbe

const a0 = skirtBandEnd()
const a1 = Math.PI - a0
console.log(
  `  hood spans ${((a0 * 180) / Math.PI).toFixed(1)}° … ${((a1 * 180) / Math.PI).toFixed(1)}°  ` +
    `(${(((a1 - a0) * 180) / Math.PI).toFixed(1)}° of arc)`,
)

/** Inside the collar casting? (bore … outer, inboard face … outboard face) */
const insideCollar = (r, z) =>
  r >= COLLAR_BORE && r <= COLLAR_OUTER && z > COLLAR_INBOARD_Z && z < COLLAR_OUTBOARD_Z

// ---- 1. rim buried in solid metal -----------------------------------------
check(
  'rim buried',
  insideCollar(SKIRT_RIM_R, SKIRT_RIM_Z) &&
    SKIRT_RIM_R + SKIRT_WALL < COLLAR_OUTER &&
    SKIRT_RIM_Z + SKIRT_WALL < 128.1,
  `r ${SKIRT_RIM_R} z ${SKIRT_RIM_Z}, clear of the drum by ` +
    `${(COLLAR_OUTER - SKIRT_RIM_R).toFixed(2)} m and of the petal slot by ` +
    `${(128.1 - SKIRT_RIM_Z).toFixed(2)} m`,
)

// ---- 2. every meridian pierces the flange plane transversally --------------
{
  let worstAngle = 90
  let worstAt = 0
  let missing = 0
  for (let k = 0; k <= 240; k++) {
    const angle = a0 + ((a1 - a0) * k) / 240
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let crossed = false
    let prev = skirtPoint(cos, sin, 0)
    let prevR = Math.hypot(prev.x, prev.y - 4.6)
    for (let i = 1; i <= 400; i++) {
      const p = skirtPoint(cos, sin, i / 400)
      const r = Math.hypot(p.x, p.y - 4.6)
      if (prev.z <= COLLAR_INBOARD_Z && p.z > COLLAR_INBOARD_Z) {
        const slope = Math.atan2(p.z - prev.z, r - prevR)
        const deg = (Math.abs(slope) * 180) / Math.PI
        if (deg < worstAngle) {
          worstAngle = deg
          worstAt = (angle * 180) / Math.PI
        }
        crossed = true
      }
      prev = p
      prevR = r
    }
    if (!crossed) missing++
  }
  check(
    'flange crossing',
    worstAngle > 22 && missing === 0,
    `shallowest ${worstAngle.toFixed(1)}° at ${worstAt.toFixed(1)}° of arc, ` +
      `${missing} meridians never reach the casting`,
  )
}

// ---- 3. nothing VISIBLE grazes the flange face -----------------------------
//
// The crossing point itself is on the plane by definition; what tells a
// transversal cut from a tangential one is how much RADIUS the sheet spends
// within a half wall of it. A 34 deg crossing spends 80 mm; the old tangential
// landing spent the whole outer half metre, and at the two crossover meridians
// the entire 3.5 m of it.
{
  let worstBand = 0
  let worstAt = 0
  for (let k = 0; k <= 240; k++) {
    const angle = a0 + ((a1 - a0) * k) / 240
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let band = 0
    let prevR = null
    for (let i = 0; i <= 400; i++) {
      const p = skirtPoint(cos, sin, i / 400)
      const r = Math.hypot(p.x, p.y - 4.6)
      if (r >= COLLAR_BORE && r <= COLLAR_OUTER && Math.abs(p.z - COLLAR_INBOARD_Z) < SKIRT_WALL / 2) {
        if (prevR !== null) band += r - prevR
      }
      prevR = r
    }
    if (band > worstBand) {
      worstBand = band
      worstAt = (angle * 180) / Math.PI
    }
  }
  check(
    'no coplanar band',
    worstBand < 0.18,
    `widest ${(worstBand * 1000).toFixed(0)} mm of radius within a half wall of the flange ` +
      `(at ${worstAt.toFixed(0)}° of arc)`,
  )
}

// ---- 4. the hood never re-enters the dome ----------------------------------
//
// It is WELDED to the glass at t = 0, so clearance there is zero by design;
// what matters is that it leaves outboard and stays there.
{
  let minClear = Infinity
  let minAt = 0
  let atQuarter = Infinity
  for (let k = 0; k <= 240; k++) {
    const angle = a0 + ((a1 - a0) * k) / 240
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (let i = 1; i <= 60; i++) {
      const t = i / 60
      const p = skirtPoint(cos, sin, t)
      const r = Math.hypot(p.x, p.y - 4.6)
      if (r > COLLAR_OUTER) continue
      // Sphere z at this radius on this meridian — the glass the hood stands off.
      const x = cos * r
      const dy = 4.6 + sin * r + 100.031
      const glass = Math.sqrt(Math.max(1, 164.031 * 164.031 - x * x - dy * dy))
      const clear = p.z - glass
      if (clear < minClear) {
        minClear = clear
        minAt = (angle * 180) / Math.PI
      }
      if (Math.abs(t - 0.25) < 0.01) atQuarter = Math.min(atQuarter, clear)
    }
  }
  check(
    'stands off the glass',
    minClear > -0.005 && atQuarter > 0.3,
    `never closer than ${(minClear * 1000).toFixed(0)} mm (at ${minAt.toFixed(0)}° of arc); ` +
      `${(atQuarter * 1000).toFixed(0)} mm at quarter span`,
  )
}

// ---- 5. build it, and count what it costs ----------------------------------
{
  const MATERIALS = new Proxy({}, { get: () => ({ isMaterial: true }) })
  const group = dome.buildConnectorTube(MATERIALS)
  let tris = 0
  const box = new Vector3()
  group.traverse((node) => {
    if (!node.isMesh) return
    const position = node.geometry.getAttribute('position')
    tris += position.count / 3
    node.geometry.computeBoundingBox()
    node.geometry.boundingBox.getSize(box)
  })
  check('assembly builds', tris > 0, `${Math.round(tris)} triangles`)
}

console.log(failures === 0 ? '\nportal audit PASS' : `\nportal audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
