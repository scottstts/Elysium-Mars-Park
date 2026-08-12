/**
 * Headless site gate for the launch complex.
 *
 *   node --experimental-strip-types tools/starship-site-audit.mjs
 *
 * Parity (tools/starship-parity.mjs) proves the MESH is the demo's. This
 * proves the SITE works: that the graded platform is actually flat under the
 * pour, that the raft is bedded rather than floating or buried, that the stack
 * clears the tunnel and the glass, that the extended shadow ladder reaches it
 * from every point a player can stand, and that no two pieces of the assembly
 * land on one coincident plane.
 */
import { registerHooks } from 'node:module'
import { Matrix4, Vector3 } from 'three'

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

const SRC = '/Users/scott/Documents/Projects/Node/mars_park/src/'
const { buildStarshipPayload } = await import(SRC + 'starship/starshipBuild.ts')
const { STARSHIP_PAD, STARSHIP_SITE, insideStarshipPad, starshipPadWeight } =
  await import(SRC + 'starship/starshipSite.ts')
const { exteriorHeight } = await import(SRC + 'exterior/terrainHeight.ts')
const { sunDirection, SUN_ELEVATION_DEG } = await import(SRC + 'sky/sun.ts')
const { PARK } = await import(SRC + 'world/parkPlan.ts')

let failures = 0
const check = (ok, label, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

/* ---- 1. build and transform to world ------------------------------------ */

const payload = buildStarshipPayload()
const cosYaw = Math.cos(STARSHIP_SITE.yaw)
const sinYaw = Math.sin(STARSHIP_SITE.yaw)

/** demo Blender local -> world, through mesh pos/rotZ, the −90° X group and the site. */
function toWorld(lx, ly, lz, pos, rotZ) {
  const c = Math.cos(rotZ)
  const s = Math.sin(rotZ)
  const bx = lx * c - ly * s + pos[0]
  const by = lx * s + ly * c + pos[1]
  const bz = lz + pos[2]
  // Blender Z-up -> three Y-up
  const tx = bx
  const ty = bz
  const tz = -by
  return [
    tx * cosYaw + tz * sinYaw + STARSHIP_SITE.x,
    ty + STARSHIP_SITE.y,
    -tx * sinYaw + tz * cosYaw + STARSHIP_SITE.z,
  ]
}

const world = new Map()
const bounds = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }
let triangles = 0
for (const part of payload.parts) {
  const p = part.position
  const out = new Float64Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const w = toWorld(p[i], p[i + 1], p[i + 2], part.pos, part.rotZ)
    out[i] = w[0]; out[i + 1] = w[1]; out[i + 2] = w[2]
    for (let k = 0; k < 3; k++) {
      if (w[k] < bounds.min[k]) bounds.min[k] = w[k]
      if (w[k] > bounds.max[k]) bounds.max[k] = w[k]
    }
  }
  world.set(part.name, out)
  triangles += part.triangles
}

console.log(`STARSHIP SITE AUDIT — ${payload.parts.length} parts / ${triangles.toLocaleString()} tris / built in ${payload.buildMs.toFixed(0)} ms\n`)
console.log('placement')
console.log(`  world bbox   X ${bounds.min[0].toFixed(1)} … ${bounds.max[0].toFixed(1)}   Y ${bounds.min[1].toFixed(2)} … ${bounds.max[1].toFixed(2)}   Z ${bounds.min[2].toFixed(1)} … ${bounds.max[2].toFixed(1)}`)
console.log(`  overall      ${(bounds.max[0] - bounds.min[0]).toFixed(1)} × ${(bounds.max[2] - bounds.min[2]).toFixed(1)} m footprint, ${(bounds.max[1] - bounds.min[1]).toFixed(1)} m tall`)
const vehX = STARSHIP_SITE.x + payload.vehicleX
console.log(`  vehicle axis (${vehX.toFixed(1)}, ${STARSHIP_SITE.z})   r ${Math.hypot(vehX, STARSHIP_SITE.z).toFixed(1)} m from the park centre`)
console.log()

/* ---- 2. clearances ------------------------------------------------------- */

console.log('clearances')
// Arrival tube: axis (0, y 4.6), outer radius 7.2 at the portal, 6.05 in the run.
const TUBE_SKIN = 7.2
const nearestX = Math.max(bounds.min[0], Math.min(0, bounds.max[0]))
const tubeGap = Math.abs(nearestX) - TUBE_SKIN
check(tubeGap > 25, 'clear of the arrival tube skin', `${tubeGap.toFixed(1)} m`)

// Dome glass foot at r = 130.
let minR = Infinity
for (const out of world.values()) {
  for (let i = 0; i < out.length; i += 3) {
    const r = Math.hypot(out[i], out[i + 2])
    if (r < minR) minR = r
  }
}
check(minR > 140, 'clear of the dome glass foot (r 130)', `nearest vertex at r ${minR.toFixed(1)} m`)
console.log()

/* ---- 3. the graded platform --------------------------------------------- */

console.log('graded platform')
const slab = world.get('Pad_Platform')
let sx0 = 1e9, sx1 = -1e9, sz0 = 1e9, sz1 = -1e9, slabTop = -1e9, slabBottom = 1e9
for (let i = 0; i < slab.length; i += 3) {
  sx0 = Math.min(sx0, slab[i]); sx1 = Math.max(sx1, slab[i])
  sz0 = Math.min(sz0, slab[i + 2]); sz1 = Math.max(sz1, slab[i + 2])
  slabTop = Math.max(slabTop, slab[i + 1]); slabBottom = Math.min(slabBottom, slab[i + 1])
}
console.log(`  slab       X ${sx0.toFixed(1)} … ${sx1.toFixed(1)}   Z ${sz0.toFixed(1)} … ${sz1.toFixed(1)}   Y ${slabBottom.toFixed(2)} … ${slabTop.toFixed(2)}`)

let flatLo = Infinity, flatHi = -Infinity
for (let i = 0; i <= 60; i++) {
  for (let j = 0; j <= 60; j++) {
    const h = exteriorHeight(sx0 + ((sx1 - sx0) * i) / 60, sz0 + ((sz1 - sz0) * j) / 60)
    flatLo = Math.min(flatLo, h); flatHi = Math.max(flatHi, h)
  }
}
check(flatHi - flatLo < 0.002, 'ground under the pour is dead flat', `${((flatHi - flatLo) * 1000).toFixed(2)} mm across ${(sx1 - sx0).toFixed(0)} × ${(sz1 - sz0).toFixed(0)} m`)
check(Math.abs(flatLo - STARSHIP_PAD.y) < 0.002, 'graded to the authored level', `${flatLo.toFixed(3)} vs ${STARSHIP_PAD.y}`)
// The demo's slab is a 2.4 m raft; it has to be bedded, not floating or drowned.
const buried = flatLo - slabBottom
const proud = slabTop - flatHi
check(buried > 0.3, 'raft underside is buried', `${buried.toFixed(2)} m below grade`)
check(proud > 0.3, 'raft top stands proud', `${proud.toFixed(2)} m above grade`)

// Cut and fill against the NATURAL grade, with the pad weight switched off.
// Recover the pre-grade surface across the skirt band, where 0 < w < 1 makes
// the blend invertible, and report the earthworks it implies.
let cut = 0, fill = 0
for (let i = 0; i <= 200; i++) {
  for (let j = 0; j <= 200; j++) {
    const x = STARSHIP_PAD.x - 80 + (160 * i) / 200
    const z = STARSHIP_PAD.z - 80 + (160 * j) / 200
    const w = starshipPadWeight(x, z)
    if (w <= 0.02 || w >= 0.98) continue
    const natural = (exteriorHeight(x, z) - STARSHIP_PAD.y * w) / (1 - w)
    cut = Math.max(cut, natural - STARSHIP_PAD.y)
    fill = Math.max(fill, STARSHIP_PAD.y - natural)
  }
}
console.log(`  earthworks max cut ${cut.toFixed(2)} m / max fill ${fill.toFixed(2)} m (skirt ${STARSHIP_PAD.skirt} m → ≤ ${((Math.max(cut, fill) / STARSHIP_PAD.skirt) * 100).toFixed(1)} % apron grade)`)

check(
  insideStarshipPad(sx0, sz0) && insideStarshipPad(sx1, sz1)
    && insideStarshipPad(sx0, sz1) && insideStarshipPad(sx1, sz0),
  'boulder sweep covers the whole slab', 'all four corners inside the exclusion',
)
// The skirt must not reach the arrival tube.
let skirtInnerX = -1e9
for (let x = -60; x <= 5; x += 0.25) {
  if (starshipPadWeight(x, STARSHIP_SITE.z) > 0) skirtInnerX = Math.max(skirtInnerX, x)
}
check(Math.abs(skirtInnerX) > 15, 'graded skirt dies short of the tunnel', `reaches x ${skirtInnerX.toFixed(1)}`)
console.log()

/* ---- 4. nothing floats over the graded plane ---------------------------- */

console.log('seating')
// Every part that reaches ground level must reach THROUGH it, not stop above.
let lowest = Infinity
let lowestName = ''
for (const [name, out] of world) {
  let lo = Infinity
  for (let i = 1; i < out.length; i += 3) lo = Math.min(lo, out[i])
  if (lo < lowest) { lowest = lo; lowestName = name }
}
check(lowest < STARSHIP_PAD.y, 'lowest geometry is under the graded plane', `${lowestName} at Y ${lowest.toFixed(2)}`)
console.log()

/* ---- 5. coincident horizontal planes ------------------------------------ */

console.log('coincident planes')
// Two parts sharing one exact horizontal plane is the z-fight class the
// project bans. Bucket every axis-horizontal triangle by its Y to the
// millimetre and report any plane carrying triangles from two different parts.
const planes = new Map()
for (const [name, out] of world) {
  for (let i = 0; i < out.length; i += 9) {
    const y0 = out[i + 1], y1 = out[i + 4], y2 = out[i + 7]
    if (Math.abs(y0 - y1) > 1e-4 || Math.abs(y0 - y2) > 1e-4) continue
    const key = Math.round(y0 * 1000)
    let bucket = planes.get(key)
    if (!bucket) { bucket = new Map(); planes.set(key, bucket) }
    const ax = out[i], az = out[i + 2]
    const bx = out[i + 3], bz = out[i + 5]
    const cx = out[i + 6], cz = out[i + 8]
    const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) * 0.5
    bucket.set(name, (bucket.get(name) ?? 0) + area)
  }
}
/** Point-in-triangle coverage of one part's faces on a shared plane. */
function rasterize(name, key, x0, x1, z0, z1, n) {
  const grid = new Uint8Array(n * n)
  const out = world.get(name)
  for (let i = 0; i < out.length; i += 9) {
    const y0 = out[i + 1], y1 = out[i + 4], y2 = out[i + 7]
    if (Math.abs(y0 - y1) > 1e-4 || Math.abs(y0 - y2) > 1e-4) continue
    if (Math.round(y0 * 1000) !== key) continue
    const ax = out[i], az = out[i + 2]
    const bx = out[i + 3], bz = out[i + 5]
    const cx = out[i + 6], cz = out[i + 8]
    const lo = [Math.min(ax, bx, cx), Math.min(az, bz, cz)]
    const hi = [Math.max(ax, bx, cx), Math.max(az, bz, cz)]
    const i0 = Math.max(0, Math.floor(((lo[0] - x0) / (x1 - x0)) * n))
    const i1 = Math.min(n - 1, Math.ceil(((hi[0] - x0) / (x1 - x0)) * n))
    const j0 = Math.max(0, Math.floor(((lo[1] - z0) / (z1 - z0)) * n))
    const j1 = Math.min(n - 1, Math.ceil(((hi[1] - z0) / (z1 - z0)) * n))
    for (let gi = i0; gi <= i1; gi++) {
      const px = x0 + ((gi + 0.5) / n) * (x1 - x0)
      for (let gj = j0; gj <= j1; gj++) {
        const pz = z0 + ((gj + 0.5) / n) * (z1 - z0)
        const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz)
        const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz)
        const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az)
        const neg = d1 < 0 || d2 < 0 || d3 < 0
        const pos = d1 > 0 || d2 > 0 || d3 > 0
        if (!(neg && pos)) grid[gi * n + gj] = 1
      }
    }
  }
  return grid
}

/**
 * The pad deck, in the same millimetre key the buckets use. The demo seats the
 * OLM's six leg footings and the booster QD block flush ON this face, so their
 * bottom caps are coincident with the slab top — the demo's own geometry, kept
 * because parity was the requirement. Recorded here so the gate still fails on
 * any coincidence the port introduces ITSELF.
 */
const PAD_DECK_PLANE_MM = Math.round((STARSHIP_SITE.y + 1.3) * 1000)

const shared = [...planes.entries()]
  .filter(([, bucket]) => bucket.size > 1)
  .sort((a, b) => a[0] - b[0])
let coincidentArea = 0
let knownArea = 0
for (const [key, bucket] of shared) {
  const names = [...bucket.keys()]
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      // Sharing a plane is harmless unless the faces also OVERLAP in plan —
      // the booster's hot stage and a tower deck happen to sit at one height
      // 23 m apart, which is not a z-fight. Rasterize both and intersect.
      const box = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }
      for (const name of [names[a], names[b]]) {
        const out = world.get(name)
        for (let i = 0; i < out.length; i += 9) {
          if (Math.round(out[i + 1] * 1000) !== key) continue
          if (Math.abs(out[i + 1] - out[i + 4]) > 1e-4 || Math.abs(out[i + 1] - out[i + 7]) > 1e-4) continue
          for (const o of [i, i + 3, i + 6]) {
            box.x0 = Math.min(box.x0, out[o]); box.x1 = Math.max(box.x1, out[o])
            box.z0 = Math.min(box.z0, out[o + 2]); box.z1 = Math.max(box.z1, out[o + 2])
          }
        }
      }
      const n = 400
      const ga = rasterize(names[a], key, box.x0, box.x1, box.z0, box.z1, n)
      const gb = rasterize(names[b], key, box.x0, box.x1, box.z0, box.z1, n)
      let cells = 0
      for (let i = 0; i < ga.length; i++) if (ga[i] && gb[i]) cells++
      if (cells === 0) continue
      const cellArea = ((box.x1 - box.x0) / n) * ((box.z1 - box.z0) / n)
      const area = cells * cellArea
      const known = key === PAD_DECK_PLANE_MM
      if (known) knownArea += area
      else coincidentArea += area
      console.log(
        `  ${known ? 'known' : 'NEW  '} Y ${(key / 1000).toFixed(3)}  ${names[a]} / ${names[b]}  overlap ${area.toFixed(1)} m²`,
      )
    }
  }
}
console.log(
  `  the pad-deck plane carries ${knownArea.toFixed(1)} m² of coincident face — inherited from the\n`
  + '  demo, which seats the six OLM leg footings and the booster QD block ON the slab\n'
  + '  top rather than 20 mm into it. Kept for parity; see dev_docs/systems/starship.md.',
)
check(coincidentArea < 0.01, 'no coincident face outside the known pad-deck plane',
  coincidentArea < 0.01 ? 'none' : `${coincidentArea.toFixed(1)} m² — see NEW above`)
console.log()

/* ---- 6. shadow reach ----------------------------------------------------- */

console.log('shadow reach (clipmap L4)')
// Mirror of the clipmap's OWN constants and its OWN light basis. Both matter:
// the metric is a CHEBYSHEV distance, so it depends on which two axes span the
// plane perpendicular to the sun, and the shader's cut-off is not `maxDistance`
// — `levelData.z` is `halfWidth · (1 − guardBand)` and the fade opens a further
// `blendRatio` before that. Approximating either turns this gate into a lie.
const CLIPMAP_MAX_DISTANCE = 440
const GUARD_BAND = 0.12
const BLEND_RATIO = 0.16
const fadeStart = CLIPMAP_MAX_DISTANCE * (1 - GUARD_BAND) * (1 - BLEND_RATIO)
const fadeEnd = CLIPMAP_MAX_DISTANCE * (1 - GUARD_BAND)

// skySystem places the sun at sunDirection · 700 aimed at the origin;
// cachedShadowClipmaps then does lookAt(ORIGIN, lightDirection, +Y).invert().
const lightDirection = new Vector3().copy(sunDirection).multiplyScalar(-1).normalize()
const worldToLight = new Matrix4()
  .lookAt(new Vector3(), lightDirection, new Vector3(0, 1, 0))
  .invert()
const lightPoint = new Vector3()
function chebyshev(a, b) {
  const p = lightPoint.copy(a).applyMatrix4(worldToLight)
  const px = p.x, py = p.y
  const q = lightPoint.copy(b).applyMatrix4(worldToLight)
  return Math.max(Math.abs(px - q.x), Math.abs(py - q.y))
}

const samples = []
for (const out of world.values()) {
  for (let i = 0; i < out.length; i += 3 * 53) samples.push(new Vector3(out[i], out[i + 1], out[i + 2]))
}
// Everywhere a camera can be: the park floor, and the arrival ride out to the
// far end of the tube.
const cameras = []
for (let a = 0; a < 128; a++) {
  const angle = (a / 128) * Math.PI * 2
  cameras.push(new Vector3(Math.cos(angle) * PARK.floorRadius, 1.7, Math.sin(angle) * PARK.floorRadius))
}
cameras.push(new Vector3(33, 50, 57)) // the Freedom Tower gallery deck
for (let z = 130; z <= 430; z += 10) cameras.push(new Vector3(0, 6, z))

let worst = 0
let worstAt = null
for (const cam of cameras) {
  for (const s of samples) {
    const d = chebyshev(s, cam)
    if (d > worst) { worst = d; worstAt = cam }
  }
}
console.log(`  sun elevation ${SUN_ELEVATION_DEG}°, L4 half-width ${CLIPMAP_MAX_DISTANCE} m`)
console.log(`  ${samples.length} sample points × ${cameras.length} camera positions; fade ${fadeStart.toFixed(0)} → ${fadeEnd.toFixed(0)} m`)
check(worst < fadeStart, 'stack is fully shadowed from every reachable camera',
  `worst ${worst.toFixed(0)} m at (${worstAt.x.toFixed(0)}, ${worstAt.y.toFixed(0)}, ${worstAt.z.toFixed(0)}), ${(fadeStart - worst).toFixed(0)} m of margin`)

// Up-sun near-plane reach: lightMargin must clear the tallest caster.
const LIGHT_MARGIN = 360
const crown = bounds.max[1] - 1.7
const needed = crown / Math.sin((SUN_ELEVATION_DEG * Math.PI) / 180)
check(LIGHT_MARGIN > needed, 'lightMargin clears the crown up-sun',
  `needs ${needed.toFixed(0)} m for a ${crown.toFixed(0)} m caster, have ${LIGHT_MARGIN}`)

console.log()
if (failures > 0) {
  console.log(`SITE AUDIT FAILED — ${failures} check(s)`)
  process.exit(1)
}
console.log('SITE AUDIT OK')
