/**
 * Proves the ported Starship build is bit-identical to `ref_images/starship.html`.
 *
 *   node --experimental-strip-types tools/starship-parity.mjs
 *
 * Runs BOTH builds in one process — the demo's own <script> body, evaluated
 * with a stub THREE, and the generated TypeScript — and compares every object:
 * name, shading angle, slot list, placement, group layout, and then the raw
 * position / normal / uv Float32Arrays element for element. A single differing
 * float fails the run.
 *
 * This is the check that makes "100 % parity" a claim rather than a hope, and
 * it is the reason the port is generated: re-run tools/starship-gen.mjs and
 * then this, and any drift shows up as a diff instead of as a subtly wrong
 * rocket nobody notices.
 */
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---- side A: the demo, verbatim ----------------------------------------- */

function loadReference() {
  const html = readFileSync(join(ROOT, 'ref_images/starship.html'), 'utf8')
  const body = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  // Everything up to §9 is the build; §9 onwards is the demo's own renderer.
  const cut = body.indexOf('/* ==========================================================================\n   9.')
  if (cut < 0) throw new Error('could not find the reference renderer boundary')
  const source = body
    .slice(0, cut)
    .replace(/^import[\s\S]*?from 'three\/tsl';/m, '')
    .replace(/^import \* as THREE from 'three';/m, '')
    .replace(/^import \{ OrbitControls \}[\s\S]*?;/m, '')
    .replace(/^const elErr[\s\S]*?window\.addEventListener\('error', ev => fail\(ev\.error \|\| ev\.message\)\);/m, '')

  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.groups = []; this.userData = {} }
    setAttribute(name, attribute) { this.attributes[name] = attribute }
    addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }) }
    computeBoundingSphere() {}
  }
  const THREE = {
    BufferGeometry, BufferAttribute, DoubleSide: 2,
    MeshStandardNodeMaterial: class {}, MeshPhysicalNodeMaterial: class {},
  }
  // The material code is never CALLED here (buildMaterials is only invoked by
  // the demo's main()), so the TSL surface only has to exist.
  const stub = () => stub
  const tsl = new Proxy({}, { get: () => stub })
  const names = [
    'Fn', 'wgsl', 'wgslFn', 'float', 'vec2', 'vec3', 'vec4', 'color', 'uv',
    'positionLocal', 'positionView', 'normalView', 'mix', 'clamp', 'max', 'min',
    'floor', 'fract', 'abs', 'sign', 'dFdx', 'dFdy', 'cross', 'dot', 'normalize',
    'screenUV', 'length',
  ]
  const factory = new Function(
    'THREE', ...names,
    `${source}\n;return { assemble, buildGeometry };`,
  )
  return factory(THREE, ...names.map(() => stub))
}

/* ---- side B: the port ---------------------------------------------------- */

const { assembleStarship } = await import(join(ROOT, 'src/starship/starshipAssemble.ts'))
const { buildGeometry } = await import(join(ROOT, 'src/procgen/sslib/evalmesh.ts'))

/* ---- compare ------------------------------------------------------------- */

const failures = []
const fail = (message) => { failures.push(message); console.log(`  FAIL  ${message}`) }

const reference = loadReference()
const refAssembly = reference.assemble()
const portAssembly = assembleStarship()

console.log('assembly scalars')
for (const key of ['VEH_X', 'ARM_Z', 'SHIP_Z', 'DECK']) {
  const a = refAssembly[key]
  const b = portAssembly[key]
  const ok = Object.is(a, b)
  console.log(`  ${key.padEnd(8)} ${a}  ${ok ? '==' : '!='} ${b}`)
  if (!ok) fail(`${key}: reference ${a}, port ${b}`)
}

if (refAssembly.objs.length !== portAssembly.objs.length) {
  fail(`object count: reference ${refAssembly.objs.length}, port ${portAssembly.objs.length}`)
}

/** Exact element-for-element comparison of two typed arrays. */
function sameArray(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return `element ${i}: ${a[i]} vs ${b[i]}`
  }
  return null
}

console.log('\nobject                 tris    pos       nor       uv        groups')
let totalTris = 0
const count = Math.min(refAssembly.objs.length, portAssembly.objs.length)
for (let i = 0; i < count; i++) {
  const ro = refAssembly.objs[i]
  const po = portAssembly.objs[i]

  if (ro.name !== po.name) fail(`object ${i} name: ${ro.name} vs ${po.name}`)
  if (ro.smooth !== po.smooth) fail(`${ro.name} smooth: ${ro.smooth} vs ${po.smooth}`)
  if (JSON.stringify(ro.slots) !== JSON.stringify(po.slots)) fail(`${ro.name} slots differ`)
  if (JSON.stringify(ro.pos ?? null) !== JSON.stringify(po.pos ?? null)) {
    fail(`${ro.name} pos: ${JSON.stringify(ro.pos)} vs ${JSON.stringify(po.pos)}`)
  }
  if (!Object.is(ro.rotZ ?? 0, po.rotZ ?? 0)) fail(`${ro.name} rotZ: ${ro.rotZ} vs ${po.rotZ}`)

  const rg = reference.buildGeometry(ro.mb, ro.smooth)
  const pg = buildGeometry(po.mb, po.smooth)

  const checks = {
    pos: sameArray(rg.attributes.position.array, pg.position),
    nor: sameArray(rg.attributes.normal.array, pg.normal),
    uv: sameArray(rg.attributes.uv.array, pg.uv),
  }
  // The demo emits vertex ranges via addGroup(off*3, count*3, mat).
  const refGroups = JSON.stringify(rg.groups)
  const portGroups = JSON.stringify(pg.groups)
  const groupsOk = refGroups === portGroups
  const trisOk = rg.userData.tris === pg.tris

  for (const [label, message] of Object.entries(checks)) {
    if (message) fail(`${ro.name} ${label}: ${message}`)
  }
  if (!groupsOk) fail(`${ro.name} groups: ${refGroups} vs ${portGroups}`)
  if (!trisOk) fail(`${ro.name} tris: ${rg.userData.tris} vs ${pg.tris}`)

  totalTris += pg.tris
  console.log(
    `${ro.name.padEnd(20)} ${String(pg.tris).padStart(7)}   ` +
      `${checks.pos ? 'DIFF' : 'ok  '}      ${checks.nor ? 'DIFF' : 'ok  '}      ` +
      `${checks.uv ? 'DIFF' : 'ok  '}      ${groupsOk ? 'ok' : 'DIFF'}`,
  )
}

console.log(`\n${count} objects, ${totalTris.toLocaleString()} triangles compared`)
if (failures.length > 0) {
  console.log(`\nPARITY FAILED — ${failures.length} difference(s)`)
  process.exit(1)
}
console.log('PARITY OK — every vertex, normal, uv and group range is identical')
