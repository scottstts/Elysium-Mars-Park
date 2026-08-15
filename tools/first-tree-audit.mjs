/**
 * Mechanical gate for the First Tree's authored growth geometry.
 *
 *   node --experimental-strip-types tools/first-tree-audit.mjs
 *
 * The close-range visual contract is encoded here: every lateral gets a
 * multi-ring graft with a restrained shoulder, every growth site maps to one
 * leaf (not crossed spray cards), and both wood and canopy remain healthy.
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

const gradient = { addColorStop: () => {} }
const stubCtx = new Proxy(
  {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  },
  { get: (target, key) => target[key] ?? (() => {}) },
)
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
}
globalThis.window = globalThis

const [{ Rng }, { buildFirstTree }] = await Promise.all([
  import('../src/core/prng.ts'),
  import('../src/vegetation/firstTree.ts'),
])

const result = buildFirstTree(new Vector3(), new Rng(0x47_49_4e_4b))
const wood = result.group.getObjectByName('first-tree-wood')
const leaves = result.group.getObjectByName('first-tree-canopy')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${label.padEnd(27)} ${ok ? 'OK  ' : 'FAIL'} ${detail}`)
  if (!ok) failures++
}

function inspectGeometry(geometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const a = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  let invalid = 0
  let badNormals = 0
  let degenerate = 0
  const triangleKeys = new Set()
  let duplicateTriangles = 0

  for (const attribute of Object.values(geometry.attributes)) {
    for (let i = 0; i < attribute.array.length; i++) {
      if (!Number.isFinite(attribute.array[i])) invalid++
    }
  }
  for (let i = 0; i < normal.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3) badNormals++
  }
  for (let offset = 0; offset < index.count; offset += 3) {
    const ia = index.getX(offset)
    const ib = index.getX(offset + 1)
    const ic = index.getX(offset + 2)
    a.fromBufferAttribute(position, ia)
    ab.fromBufferAttribute(position, ib).sub(a)
    ac.fromBufferAttribute(position, ic).sub(a)
    if (ab.cross(ac).lengthSq() < 1e-14) degenerate++
    const key = [ia, ib, ic].sort((left, right) => left - right).join(':')
    if (triangleKeys.has(key)) duplicateTriangles++
    triangleKeys.add(key)
  }

  geometry.computeBoundingBox()
  return {
    box: geometry.boundingBox,
    triangles: index.count / 3,
    invalid,
    badNormals,
    degenerate,
    duplicateTriangles,
  }
}

check('tree meshes', Boolean(wood && leaves), 'wood + canopy are named and present')
const woodAudit = inspectGeometry(wood.geometry)
const leafAudit = inspectGeometry(leaves.geometry)
const woodSize = woodAudit.box.getSize(new Vector3())
const leafSize = leafAudit.box.getSize(new Vector3())

check(
  'wood geometry health',
  woodAudit.invalid === 0 && woodAudit.badNormals === 0 && woodAudit.degenerate === 0,
  `${woodAudit.triangles} tris · invalid ${woodAudit.invalid} · normals ${woodAudit.badNormals} · degenerate ${woodAudit.degenerate}`,
)
check(
  'canopy geometry health',
  leafAudit.invalid === 0 && leafAudit.badNormals === 0 && leafAudit.degenerate === 0,
  `${leafAudit.triangles} tris · invalid ${leafAudit.invalid} · normals ${leafAudit.badNormals} · degenerate ${leafAudit.degenerate}`,
)
check(
  'no duplicate leaf faces',
  leafAudit.duplicateTriangles === 0,
  `${leafAudit.duplicateTriangles} exact indexed duplicates`,
)
check(
  'resolved branch grafts',
  result.stats.junctions > 100 &&
    result.stats.junctionRings >= result.stats.junctions * 4 &&
    result.stats.maxJunctionScale <= 1.2,
  `${result.stats.junctions} junctions · ${result.stats.junctionRings} graft rings · ${result.stats.maxJunctionScale.toFixed(2)}× max shoulder`,
)
check(
  'one leaf per growth site',
  result.stats.leafCards === result.stats.leafSites,
  `${result.stats.leafSites} sites · ${result.stats.leafCards} individual cards`,
)
check(
  'leaf mesh contract',
  result.stats.leafCards >= 5_000 &&
    result.stats.leafCards <= 6_200 &&
    result.stats.leafTriangles === result.stats.leafCards * 24,
  `${result.stats.leafCards} leaves · ${result.stats.leafTriangles} tris`,
)
check(
  'tree proportions',
  woodAudit.box.max.y > 11.4 &&
    woodAudit.box.max.y < 12.6 &&
    leafAudit.box.min.y > 3.3 &&
    leafSize.x > 6.5 &&
    leafSize.z > 6.5,
  `wood ${woodSize.x.toFixed(2)}×${woodSize.y.toFixed(2)}×${woodSize.z.toFixed(2)} m · canopy ${leafSize.x.toFixed(2)}×${leafSize.y.toFixed(2)}×${leafSize.z.toFixed(2)} m · lowest leaf ${leafAudit.box.min.y.toFixed(2)} m`,
)

console.log(failures === 0 ? '\nfirst-tree audit PASS' : `\nfirst-tree audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
