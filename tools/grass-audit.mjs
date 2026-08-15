/**
 * Mechanical gate for the park's two grass growth stages and grass flowers.
 *
 *   node --experimental-strip-types tools/grass-audit.mjs
 *
 * Protects the mature sedge the owner likes, while ensuring the juvenile
 * layer cannot collapse into barely visible alpha-card rings at the soil.
 */
import { registerHooks } from 'node:module'
import { Matrix4, Quaternion, Vector3 } from 'three'

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

const [
  { Rng },
  {
    PlantingPalette,
    YOUNG_SEDGE,
    grassFertilityAt,
    plantPlanters,
    plantTreeCollar,
    sampleWeightedGrassPoints,
  },
  { plantFountainBays },
  { PartWriter },
] = await Promise.all([
  import('../src/core/prng.ts'),
  import('../src/vegetation/planting.ts'),
  import('../src/fountain/fountainPlanting.ts'),
  import('../src/archkit/writer.ts'),
])

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${label.padEnd(29)} ${ok ? 'OK  ' : 'FAIL'} ${detail}`)
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
  let duplicates = 0
  const keys = new Set()

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
    if (keys.has(key)) duplicates++
    keys.add(key)
  }
  geometry.computeBoundingBox()
  return {
    box: geometry.boundingBox,
    triangles: index.count / 3,
    invalid,
    badNormals,
    degenerate,
    duplicates,
  }
}

const palette = new PlantingPalette()
palette.sedge.add(new Vector3(), 0, 1)
const rng = new Rng(0x47_52_41_53)
const sampleCount = 1_000
for (let i = 0; i < sampleCount; i++) {
  palette.addYoungSedge(new Vector3(i, 0, 0), rng, 0.82, 1.38)
}
const meshes = new Map(palette.meshes().map((mesh) => [mesh.name, mesh]))
const mature = meshes.get('vegetation-sedge')
const young = meshes.get('vegetation-young-sedge')
const flowers = meshes.get('vegetation-grass-bloom')

check('required grass meshes', Boolean(mature && young && flowers), 'mature + juvenile + bloom')

const matureAudit = inspectGeometry(mature.geometry)
const youngAudit = inspectGeometry(young.geometry)
const flowerAudit = inspectGeometry(flowers.geometry)
const matureSize = matureAudit.box.getSize(new Vector3())
const youngSize = youngAudit.box.getSize(new Vector3())
const flowerSize = flowerAudit.box.getSize(new Vector3())

check(
  'mature sedge preserved',
  matureAudit.triangles === 84 && Math.abs(matureSize.y - 0.5) < 1e-6,
  `${matureAudit.triangles} tris · ${matureSize.y.toFixed(2)} m tall`,
)
check(
  'juvenile geometry health',
  youngAudit.invalid === 0 &&
    youngAudit.badNormals === 0 &&
    youngAudit.degenerate === 0 &&
    youngAudit.duplicates === 0 &&
    youngAudit.triangles === 60 &&
    Math.abs(youngSize.y - YOUNG_SEDGE.height) < 1e-6,
  `${youngAudit.triangles} tris · ${youngSize.x.toFixed(2)}×${youngSize.y.toFixed(2)}×${youngSize.z.toFixed(2)} m · invalid ${youngAudit.invalid} · normals ${youngAudit.badNormals} · degenerate ${youngAudit.degenerate}`,
)
check(
  'flower geometry health',
  flowerAudit.invalid === 0 &&
    flowerAudit.badNormals === 0 &&
    flowerAudit.degenerate === 0 &&
    flowerAudit.duplicates === 0 &&
    flowerAudit.triangles < 340 &&
    flowerSize.y > 0.39 &&
    flowerSize.y < 0.45,
  `${flowerAudit.triangles} tris · ${flowerSize.x.toFixed(2)}×${flowerSize.y.toFixed(2)}×${flowerSize.z.toFixed(2)} m · invalid ${flowerAudit.invalid} · normals ${flowerAudit.badNormals} · degenerate ${flowerAudit.degenerate}`,
)

const color = flowers.geometry.getAttribute('color')
const bloom = flowers.geometry.getAttribute('aBloom')
let bloomMin = 1
let bloomMax = 0
let brightRayVertices = 0
let bloomVertices = 0
for (let i = 0; i < bloom.count; i++) {
  const mask = bloom.getX(i)
  bloomMin = Math.min(bloomMin, mask)
  bloomMax = Math.max(bloomMax, mask)
  if (mask > 0.5) {
    bloomVertices++
    if (color.getX(i) >= 0.8 && color.getY(i) >= 0.8 && color.getZ(i) >= 0.8) {
      brightRayVertices++
    }
  }
}
check(
  'flower authored attributes',
  color?.itemSize === 3 && bloomMin === 0 && bloomMax === 1,
  `vertex color ${color?.itemSize ?? 0} channels · bloom mask ${bloomMin.toFixed(0)}–${bloomMax.toFixed(0)}`,
)
check(
  'white daisy ray majority',
  brightRayVertices / bloomVertices > 0.8,
  `${brightRayVertices}/${bloomVertices} bloom vertices are warm white`,
)

const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
let minimumVisible = Infinity
let maximumVisible = -Infinity
let badRoots = 0
for (let i = 0; i < young.count; i++) {
  young.getMatrixAt(i, matrix)
  matrix.decompose(position, rotation, scale)
  const visible = position.y + youngAudit.box.max.y * scale.y
  minimumVisible = Math.min(minimumVisible, visible)
  maximumVisible = Math.max(maximumVisible, visible)
  if (Math.abs(position.y + YOUNG_SEDGE.bury) > 1e-6) badRoots++
}
check(
  'soil emergence contract',
  badRoots === 0 && minimumVisible >= YOUNG_SEDGE.minVisibleHeight && maximumVisible < 0.43,
  `${minimumVisible.toFixed(3)}–${maximumVisible.toFixed(3)} m visible · ${badRoots} bad roots`,
)

const bloomRatio = flowers.count / young.count
let detachedFlowers = 0
let bloomFertility = 0
for (let i = 0; i < flowers.count; i++) {
  flowers.getMatrixAt(i, matrix)
  matrix.decompose(position, rotation, scale)
  bloomFertility += grassFertilityAt(position)
  if (Math.abs(position.y + YOUNG_SEDGE.bury) > 1e-6 || Math.abs(position.x - Math.round(position.x)) > 1e-6) {
    detachedFlowers++
  }
}
let allFertility = 0
for (let i = 0; i < sampleCount; i++) allFertility += grassFertilityAt(new Vector3(i, 0, 0))
const meanBloomFertility = bloomFertility / flowers.count
const meanAllFertility = allFertility / sampleCount
check(
  'flowering subset rooted',
  bloomRatio > 0.42 && bloomRatio < 0.56 && detachedFlowers === 0,
  `${flowers.count}/${young.count} clumps (${(bloomRatio * 100).toFixed(1)}%) · ${detachedFlowers} detached`,
)
check(
  'flowering follows fertility',
  meanBloomFertility > meanAllFertility + 0.035,
  `flower ${meanBloomFertility.toFixed(3)} vs all grass ${meanAllFertility.toFixed(3)}`,
)

const distributionRng = new Rng(0x50_4f_49_53)
const halfExtent = 18
const distributionArea = (halfExtent * 2) ** 2
const distributionCount = 320
const weightedRoots = sampleWeightedGrassPoints({
  rng: distributionRng,
  count: distributionCount,
  area: distributionArea,
  candidate: () =>
    new Vector3(
      distributionRng.range(-halfExtent, halfExtent),
      0,
      distributionRng.range(-halfExtent, halfExtent),
    ),
})
let minimumSpacing = Infinity
for (let i = 0; i < weightedRoots.length; i++) {
  for (let j = i + 1; j < weightedRoots.length; j++) {
    const dx = weightedRoots[i].x - weightedRoots[j].x
    const dz = weightedRoots[i].z - weightedRoots[j].z
    minimumSpacing = Math.min(minimumSpacing, Math.hypot(dx, dz))
  }
}
const referenceRng = new Rng(0x55_4e_49_46)
let referenceFertility = 0
for (let i = 0; i < 8_000; i++) {
  referenceFertility += grassFertilityAt(
    new Vector3(
      referenceRng.range(-halfExtent, halfExtent),
      0,
      referenceRng.range(-halfExtent, halfExtent),
    ),
  )
}
const meanWeightedFertility =
  weightedRoots.reduce((sum, root) => sum + grassFertilityAt(root), 0) / weightedRoots.length
const meanReferenceFertility = referenceFertility / 8_000
const relaxedSpacingFloor =
  Math.sqrt(distributionArea / distributionCount) * 0.62 * 0.66
check(
  'weighted Poisson count',
  weightedRoots.length === distributionCount,
  `${weightedRoots.length}/${distributionCount} accepted`,
)
check(
  'weighted Poisson spacing',
  minimumSpacing >= relaxedSpacingFloor - 1e-6,
  `${minimumSpacing.toFixed(3)} m minimum · ${relaxedSpacingFloor.toFixed(3)} m floor`,
)
check(
  'weighted fertile patches',
  meanWeightedFertility > meanReferenceFertility + 0.06,
  `accepted ${meanWeightedFertility.toFixed(3)} vs uniform ${meanReferenceFertility.toFixed(3)}`,
)

const treePalette = new PlantingPalette()
plantTreeCollar(treePalette, new Rng(0x54_52_45_45), 0, 0, 5.5)
const treeCounts = treePalette.counts()
check(
  'tree collar deployment',
  treeCounts.sedge > 650 && treeCounts['young-sedge'] > 320,
  `${treeCounts.sedge} mature · ${treeCounts['young-sedge']} juvenile · ${treeCounts['grass-bloom']} daisies`,
)

const fountainPalette = new PlantingPalette()
const fountainPlants = plantFountainBays(fountainPalette, new Rng(0x46_4f_55_4e))
const fountainCounts = fountainPalette.counts()
check(
  'fountain bay deployment',
  fountainCounts.sedge >= 40 && fountainCounts['young-sedge'] >= 48,
  `${fountainCounts.sedge} mature · ${fountainCounts['young-sedge']} juvenile · ${fountainCounts['grass-bloom']} daisies · ${fountainPlants} total plants`,
)

const planterPalette = new PlantingPalette()
const planterStats = plantPlanters(
  planterPalette,
  new PartWriter(),
  new Rng(0x50_4c_41_4e),
)
check(
  'park planter deployment',
  planterStats.planters >= 40 &&
    planterStats.byspecies.sedge > 1_000 &&
    planterStats.byspecies['young-sedge'] > 900,
  `${planterStats.planters} beds · ${planterStats.byspecies.sedge} mature · ${planterStats.byspecies['young-sedge']} juvenile · ${planterStats.byspecies['grass-bloom']} daisies`,
)

console.log(failures === 0 ? '\ngrass audit PASS' : `\ngrass audit FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
