/**
 * Headless gate for the modelled crops.
 *
 *   node --experimental-strip-types tools/crop-audit.mjs
 *
 * Checks each variety's extents, triangle budget, normal health and that no
 * leaf hangs below the tray it stands on, then reports the whole farm's
 * instanced triangle load against the alpha-card build it replaces.
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

const crops = await import('../src/vegetation/cropSpecies.ts')

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${label.padEnd(26)} ${ok ? 'OK  ' : 'FAIL'} ${detail ?? ''}`)
  if (!ok) failures++
}

const perVariety = new Map()
for (const variety of [...crops.CROP_VARIETIES, 'seedling']) {
  const geometry = crops.vegetableGeometry(variety)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const pale = geometry.getAttribute('aPale')
  const depth = geometry.getAttribute('aDepth')
  const index = geometry.getIndex()
  const tris = index.count / 3

  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const size = box.getSize(new Vector3())

  let badNormals = 0
  for (let i = 0; i < normal.count; i++) {
    const l = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (!Number.isFinite(l) || Math.abs(l - 1) > 1e-3) badNormals++
  }

  let degenerate = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(position, index.getX(t * 3))
    b.fromBufferAttribute(position, index.getX(t * 3 + 1))
    c.fromBufferAttribute(position, index.getX(t * 3 + 2))
    if (b.sub(a).cross(c.sub(a)).length() < 1e-9) degenerate++
  }

  let paleRange = [1, 0]
  for (let i = 0; i < pale.count; i++) {
    paleRange = [Math.min(paleRange[0], pale.getX(i)), Math.max(paleRange[1], pale.getX(i))]
  }
  let depthMax = 0
  for (let i = 0; i < depth.count; i++) depthMax = Math.max(depthMax, depth.getX(i))

  // Headroom contract. Glasshouse racks are on a 0.52 m tier pitch with a grow
  // bar hanging 0.10 m under each shelf (its reflector adds ~0.03), so the
  // clear height over a tray is ~0.39 m; the planter scales heads up to 1.18.
  // Hydro tower tiers are 0.64 apart with the same bar arrangement.
  const HEADROOM = 0.39
  const MAX_SCALE = 1.18
  const fits = variety === 'seedling' || size.y * MAX_SCALE < HEADROOM
  // Bench pitch is 0.3 m; a mature head may just touch its neighbours but
  // must not grow through them.
  const spread = Math.max(size.x, size.z)
  const spacing = variety === 'seedling' || spread * MAX_SCALE < 0.42

  perVariety.set(variety, tris)
  check(
    variety,
    badNormals === 0 && degenerate === 0 && box.min.y > -0.02 && size.y > 0.03 && fits && spacing,
    `${String(tris).padStart(4)} tris · ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m · ` +
      `base y ${box.min.y.toFixed(3)} · grown ${(size.y * MAX_SCALE).toFixed(2)} tall / ` +
      `${(spread * MAX_SCALE).toFixed(2)} across · pale ${paleRange[1].toFixed(2)} · ` +
      `depth ${depthMax.toFixed(2)} · normals ${badNormals} · degenerate ${degenerate}`,
  )
}

// ---- whole-farm load --------------------------------------------------------
const farmside = await import('../src/world/districts/farmside.ts')
const hydro = await import('../src/world/districts/hydroTower.ts')

let benchHeads = 0
for (const tray of farmside.CROP_TRAY_SURFACES) {
  benchHeads += Math.max(1, Math.floor(tray.length / 0.3)) * 2
}
const hydroHeads = hydro.HYDRO_SHELVES.length * 4 * 46
const densify = hydro.HYDRO_SHELVES.length * 2 * Math.max(2, Math.floor(4.5 / 0.55))
const heads = benchHeads + hydroHeads + densify
const average =
  [...perVariety.entries()]
    .filter(([k]) => k !== 'seedling')
    .reduce((sum, [, t]) => sum + t, 0) / (perVariety.size - 1)

console.log(
  `\nfarm load  ~${heads} plants  ·  ${average.toFixed(0)} tris/head avg  ·  ` +
    `${((heads * average) / 1e6).toFixed(2)} M triangles in ${crops.CROP_VARIETIES.length + 1} instanced draws`,
)
console.log(`           (the alpha-card build was 24 tris/head = ${((heads * 24) / 1e6).toFixed(2)} M)`)
check('farm budget', heads * average < 1.6e6, 'ceiling 1.6 M instanced triangles')

console.log(failures === 0 ? '\ncrop audit PASS' : `\ncrop audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
