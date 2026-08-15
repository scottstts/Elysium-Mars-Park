/**
 * Mechanical gate for foliage face/normal agreement and front-lit response.
 *
 *   node --experimental-strip-types tools/foliage-lighting-audit.mjs
 *
 * A double-sided leaf whose authored normal opposes its triangle winding is
 * dark from both sides: Three negates the normal only with the geometric
 * back-face flag. The check below catches that defect on the First Tree and
 * representative planter cards, and protects blade-cluster normals separately.
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

const [{ Rng }, { buildFirstTree }, { bladeCluster, broadLeafBush, buildPlant }, { sunDirection }] =
  await Promise.all([
    import('../src/core/prng.ts'),
    import('../src/vegetation/firstTree.ts'),
    import('../src/vegetation/species.ts'),
    import('../src/sky/sun.ts'),
  ])

let failures = 0
const UP = new Vector3(0, 1, 0)
const check = (label, ok, detail = '') => {
  console.log(`${label.padEnd(31)} ${ok ? 'OK  ' : 'FAIL'} ${detail}`)
  if (!ok) failures++
}

function auditNormals(geometry, rotations = 1) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const face = new Vector3()
  const authored = new Vector3()
  const rotatedFace = new Vector3()
  const rotatedNormal = new Vector3()
  let aligned = 0
  let samples = 0
  let frontLit = 0
  let frontLightTotal = 0

  for (let offset = 0; offset < index.count; offset += 3) {
    const ia = index.getX(offset)
    const ib = index.getX(offset + 1)
    const ic = index.getX(offset + 2)
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    face.subVectors(b, a).cross(c.clone().sub(a)).normalize()

    for (const vertexIndex of [ia, ib, ic]) {
      authored.fromBufferAttribute(normal, vertexIndex).normalize()
      if (face.dot(authored) > 0) aligned++
      samples++

      for (let rotation = 0; rotation < rotations; rotation++) {
        const yaw = (rotation / rotations) * Math.PI * 2
        rotatedFace.copy(face).applyAxisAngle(UP, yaw)
        rotatedNormal.copy(authored).applyAxisAngle(UP, yaw)
        const faceDirection = rotatedFace.dot(sunDirection) >= 0 ? 1 : -1
        const direct = rotatedNormal.dot(sunDirection) * faceDirection
        frontLightTotal += Math.max(0, direct)
        if (direct > 0.08) frontLit++
      }
    }
  }

  const litSamples = samples * rotations
  return {
    alignment: aligned / samples,
    frontLit: frontLit / litSamples,
    meanDirect: frontLightTotal / litSamples,
  }
}

const tree = buildFirstTree(new Vector3(), new Rng(0x4c_49_47_48))
const leaves = tree.group.getObjectByName('first-tree-canopy')
const broadleaf = buildPlant(broadLeafBush(5, 0.88))
const matureGrass = bladeCluster({ height: 0.5, width: 0.0105, segments: 6, planes: 7 })

const treeAudit = auditNormals(leaves.geometry)
const broadleafAudit = auditNormals(broadleaf, 48)
const grassAudit = auditNormals(matureGrass, 48)

check(
  'First Tree normal/winding',
  treeAudit.alignment > 0.9,
  `${(treeAudit.alignment * 100).toFixed(1)}% aligned`,
)
check(
  'First Tree front-sun response',
  treeAudit.frontLit > 0.78 && treeAudit.meanDirect > 0.28,
  `${(treeAudit.frontLit * 100).toFixed(1)}% lit · mean N·L ${treeAudit.meanDirect.toFixed(3)}`,
)
check(
  'planter card normal/winding',
  broadleafAudit.alignment > 0.9,
  `${(broadleafAudit.alignment * 100).toFixed(1)}% aligned`,
)
check(
  'planter card front-sun response',
  broadleafAudit.frontLit > 0.72 && broadleafAudit.meanDirect > 0.24,
  `${(broadleafAudit.frontLit * 100).toFixed(1)}% lit · mean N·L ${broadleafAudit.meanDirect.toFixed(3)}`,
)
check(
  'grass blade normal/winding',
  grassAudit.alignment > 0.99,
  `${(grassAudit.alignment * 100).toFixed(1)}% aligned`,
)
check(
  'grass blade front-sun response',
  grassAudit.frontLit > 0.72 && grassAudit.meanDirect > 0.24,
  `${(grassAudit.frontLit * 100).toFixed(1)}% lit · mean N·L ${grassAudit.meanDirect.toFixed(3)}`,
)

console.log(failures === 0 ? '\nfoliage lighting audit PASS' : `\nfoliage lighting audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
