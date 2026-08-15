import { Color, Vector3 } from 'three'
import type { InstancedMesh, Material } from 'three'
import type { Node } from 'three/webgpu'
import { mx_noise_float, uv, vec2 } from 'three/tsl'
import { cleanMesh, loft, revolve, smoothShade, toYUp, writeInto } from '../archkit/meshdata'
import type { Vec2, Vec3 } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import { kitMaterials } from '../materials/library'
import { createConcreteMaterial } from '../world/groundMaterials'
import { slabTop } from '../world/paving'
import { PLANTER, PLANTERS } from '../world/pavingPlan'
import type { PlanterSpec } from '../world/pavingPlan'
import {
  createBarkMaterial,
  createBladeMaterial,
  createFoliageMaterial,
  createGrassBloomMaterial,
  createRockMaterial,
  floatAttribute,
  instanceSeed,
} from './foliageMaterial'
import {
  broadLeafTexture,
  fernFrondTexture,
  flowerSprayTexture,
  pineSprayTexture,
  trailingSprigTexture,
} from './leafTextures'
import { placeRock, rockMesh } from './rocks'
import {
  bladeCluster,
  broadLeafBush,
  buildPlant,
  fernRosette,
  flowerSpray,
  grassBloomCluster,
  pineBough,
  SpeciesInstances,
  trailingSprig,
} from './species'

/**
 * THE PLANTERS — the reference image's signature move, and the reconciliation
 * the masterplan asks for: green is LUSH, and it is lush **only inside walls**.
 * Open regolith stays mineral. Generated arc planters ring the plaza and the
 * boulevard's inner edge; every one of them overflows.
 *
 * `world/paving.ts` owns the walls, the coping and the soil SURFACE (at
 * `slabTop + 0.38`, crowned 3 cm at mid-width). This module owns everything
 * that grows out of it, and deliberately re-derives the same crown formula so
 * nothing floats or sinks — a plant placed on a flat 0.38 would hover 3 cm
 * over the middle of every bed.
 *
 * Placement doctrine (SeaPark's, via experience-craft §2.3): NEVER a uniform
 * sprinkle. Grass uses a fertility-weighted Poisson disk, with juvenile roots
 * attracted toward established clumps; the other species retain authored
 * parent/child colonies. The beds read as living communities, not scatter.
 */

/** Soil surface above the paving slab, from paving's own constants. */
const SOIL_LIFT = PLANTER.rimY - PLANTER.soilDrop

/**
 * HARD CONSTRAINT. The masterplan's guideway swept volume starts at r = 94.5
 * and the boulevard planters run out to r = 94.9, so their OUTER face is
 * already at the line. Nothing this module plants may lean outward there:
 * spill goes inward only, and tall species are confined to the park side.
 */
const TRAM_SWEPT_INNER = 94.5

/**
 * The low layer is juvenile sedge, not a flattened broadleaf card. Its roots
 * sit just under the soil and even the smallest allowed instance clears more
 * than 23 cm, so it cannot collapse into the black rings seen in the owner
 * screenshots. The mature `sedge` recipe remains deliberately unchanged.
 */
export const YOUNG_SEDGE = {
  height: 0.31,
  bury: 0.008,
  minVisibleHeight: 0.23,
  bloomChanceMin: 0.32,
  bloomChanceMax: 0.64,
} as const

export type VegetationCollider =
  | { kind: 'box'; center: Vector3; size: Vector3; yaw: number }
  | { kind: 'cylinder'; center: Vector3; radius: number; halfHeight: number }

interface Recipe {
  label: string
  /** Instances per square metre of soil. */
  sedge: number
  fern: number
  broad: number
  young: number
  flower: number
}

/**
 * Four planting recipes, cycled with a seeded offset. The point is not
 * randomness — it is that walking the boulevard shows you four different beds
 * rather than one repeated bed all the way around the park.
 */
const RECIPES: Recipe[] = [
  { label: 'understory', sedge: 3.1, fern: 2.9, broad: 1.6, young: 2.9, flower: 0.12 },
  { label: 'sedge-bank', sedge: 5.8, fern: 1.0, broad: 0.55, young: 2.3, flower: 0.06 },
  { label: 'foreground', sedge: 2.3, fern: 2.1, broad: 2.6, young: 3.1, flower: 0.19 },
  { label: 'fernery', sedge: 2.0, fern: 3.7, broad: 1.2, young: 2.7, flower: 0.05 },
]

export interface PlantingStats {
  planters: number
  soilArea: number
  stones: number
  pines: number
  byspecies: Record<string, number>
}

/**
 * One palette for the whole park: eight species, eight draw calls. Everything
 * green — planters, the tree's collar, the garden beds — comes out of here, so
 * the planting reads as one designed system instead of three unrelated sets.
 */
export class PlantingPalette {
  readonly sedge: SpeciesInstances
  readonly fern: SpeciesInstances
  readonly broadleaf: SpeciesInstances
  readonly trailing: SpeciesInstances
  readonly flower: SpeciesInstances
  readonly pine: SpeciesInstances
  private readonly youngSedge: SpeciesInstances
  private readonly grassBloom: SpeciesInstances
  readonly materials: Record<string, Material>

  constructor() {
    const sedgeHeight = 0.5
    this.sedge = new SpeciesInstances(
      'sedge',
      bladeCluster({ height: sedgeHeight, width: 0.0105, segments: 6, planes: 7 }),
      createBladeMaterial({
        height: sedgeHeight,
        seed: instanceSeed(),
        rootColor: new Color(0.032, 0.05, 0.022),
        tipColor: new Color(0.098, 0.142, 0.046),
        rootColorAlt: new Color(0.03, 0.056, 0.033),
        tipColorAlt: new Color(0.076, 0.122, 0.058),
        transmit: new Color(0.24, 0.38, 0.11),
        backlight: 0.42,
        bend: 0.3,
        far: 34,
      }),
      true,
    )

    this.fern = new SpeciesInstances(
      'fern',
      buildPlant(fernRosette(6, 0.74)),
      createFoliageMaterial({
        map: fernFrondTexture(),
        seed: instanceSeed(),
        depth: floatAttribute('aDepth'),
        tintCool: new Color(0.68, 0.8, 0.7),
        tintWarm: new Color(1.1, 1.08, 0.82),
        transmit: new Color(0.32, 0.52, 0.16),
        backlight: 0.74,
        sway: 0.028,
        alphaTest: 0.32,
        far: 34,
      }),
      true,
    )

    this.broadleaf = new SpeciesInstances(
      'broadleaf',
      buildPlant(broadLeafBush(5, 0.88)),
      createFoliageMaterial({
        map: broadLeafTexture(),
        seed: instanceSeed(),
        depth: floatAttribute('aDepth'),
        // The dark waxy foreground plant of the reference image: it barely
        // warms in the sun, which is what makes the ginkgo's gold register.
        tintCool: new Color(0.66, 0.78, 0.68),
        tintWarm: new Color(0.98, 1.02, 0.8),
        transmit: new Color(0.22, 0.44, 0.14),
        backlight: 0.62,
        sway: 0.022,
        alphaTest: 0.36,
        far: 36,
        roughness: 0.52,
      }),
      true,
    )

    this.youngSedge = new SpeciesInstances(
      'young-sedge',
      bladeCluster({
        height: YOUNG_SEDGE.height,
        width: 0.008,
        segments: 5,
        planes: 6,
        lean: 0.095,
      }),
      createBladeMaterial({
        height: YOUNG_SEDGE.height,
        seed: instanceSeed(),
        rootColor: new Color(0.045, 0.074, 0.03),
        tipColor: new Color(0.13, 0.19, 0.064),
        rootColorAlt: new Color(0.04, 0.078, 0.046),
        tipColorAlt: new Color(0.1, 0.168, 0.078),
        transmit: new Color(0.28, 0.43, 0.13),
        backlight: 0.46,
        bend: 0.24,
        far: 28,
      }),
      // The low layer is buried under the mature canopy; omitting it from the
      // shadow pass avoids thousands of tiny redundant casters.
      false,
    )

    this.grassBloom = new SpeciesInstances(
      'grass-bloom',
      grassBloomCluster(),
      createGrassBloomMaterial(),
      // These are small accents below the mature canopy; the modeled form is
      // visible in the main pass without paying for hundreds of tiny casters.
      false,
    )

    this.trailing = new SpeciesInstances(
      'trailing',
      buildPlant(trailingSprig(3, 0.58)),
      createFoliageMaterial({
        map: trailingSprigTexture(),
        seed: instanceSeed(),
        depth: floatAttribute('aDepth'),
        tintCool: new Color(0.7, 0.82, 0.7),
        tintWarm: new Color(1.06, 1.06, 0.84),
        transmit: new Color(0.3, 0.5, 0.16),
        backlight: 0.78,
        sway: 0.03,
        alphaTest: 0.3,
        far: 30,
      }),
      true,
    )

    this.flower = new SpeciesInstances(
      'flower',
      buildPlant(flowerSpray(3, 0.42)),
      createFoliageMaterial({
        map: flowerSprayTexture(),
        seed: instanceSeed(),
        depth: floatAttribute('aDepth'),
        // Flowers are NOT tinted green-warm: the dusty blue is the accent.
        tintCool: new Color(0.86, 0.88, 0.92),
        tintWarm: new Color(1.06, 1.04, 1.0),
        transmit: new Color(0.3, 0.34, 0.42),
        backlight: 0.55,
        sway: 0.05,
        alphaTest: 0.3,
        far: 26,
      }),
      false,
    )

    this.pine = new SpeciesInstances(
      'pine-bough',
      buildPlant(pineBough(3, 0.52)),
      createFoliageMaterial({
        map: pineSprayTexture(),
        seed: instanceSeed(),
        depth: floatAttribute('aDepth'),
        tintCool: new Color(0.6, 0.72, 0.64),
        tintWarm: new Color(0.92, 0.98, 0.78),
        transmit: new Color(0.2, 0.38, 0.14),
        backlight: 0.5,
        sway: 0.014,
        alphaTest: 0.34,
        far: 34,
      }),
      true,
    )

    this.materials = {
      ...kitMaterials(),
      planterWall: createConcreteMaterial(),
      stone: createRockMaterial(),
      // A redder, scalier bark than the ginkgo's for the dwarf conifers. The
      // stems are lathed through `PartWriter`, which carries no custom
      // attributes, so the fissure field is synthesised from the lathe's own
      // UVs instead of read from `aRidge`.
      conifer: createBarkMaterial({
        crest: new Color(0.2, 0.135, 0.1),
        fissure: new Color(0.062, 0.042, 0.033),
        dust: new Color(0.28, 0.235, 0.2),
        grain: 4.2,
        far: 18,
        ridge: mx_noise_float(vec2(uv().x.mul(18), uv().y.mul(5.5)))
          .mul(0.5)
          .add(0.5) as unknown as Node<'float'>,
      }),
    }
  }

  all(): SpeciesInstances[] {
    return [
      this.sedge,
      this.fern,
      this.broadleaf,
      this.youngSedge,
      this.grassBloom,
      this.trailing,
      this.flower,
      this.pine,
    ]
  }

  /**
   * Place one short rooted grass clump. Two random draws match the old cover
   * call (yaw + scale), so fixing this layer does not reshuffle every plant
   * and stone generated after it. Horizontal form and tilt derive from those
   * same values, keeping variation clump-level and deterministic.
   */
  addYoungSedge(
    soilPosition: Vector3,
    rng: Rng,
    minHeightScale = 0.84,
    maxHeightScale = 1.34,
  ): void {
    const yaw = rng.range(0, Math.PI * 2)
    const heightScale = rng.range(minHeightScale, maxHeightScale)
    const form = Math.sin(yaw * 3.17 + heightScale * 5.31) * 0.5 + 0.5
    const widthScale = 0.9 + form * 0.24
    const depthScale = 0.92 + (1 - form) * 0.2
    const tiltX = (form - 0.5) * 0.1
    const tiltZ = Math.sin(yaw * 1.73) * 0.05
    this.youngSedge.addStretched(
      new Vector3(soilPosition.x, soilPosition.y - YOUNG_SEDGE.bury, soilPosition.z),
      yaw,
      new Vector3(widthScale, heightScale, depthScale),
      tiltX,
      tiltZ,
    )

    // Flowering is a deterministic trait of the clump, derived from the same
    // two values as its form. No extra random draw means the improvement does
    // not reshuffle later planting. The flower shares the grass root exactly.
    const bloomSeed = Math.sin(yaw * 12.9898 + heightScale * 78.233) * 43758.5453
    const bloomTrait = bloomSeed - Math.floor(bloomSeed)
    // A smooth world-space field forms flowering colonies instead of an
    // independent salt-and-pepper scatter. Local probability ranges from
    // 32–64%, averaging roughly four times the former 11% share.
    const patch = grassFertilityAt(soilPosition)
    const localChance =
      YOUNG_SEDGE.bloomChanceMin +
      (YOUNG_SEDGE.bloomChanceMax - YOUNG_SEDGE.bloomChanceMin) * patch
    if (bloomTrait < localChance) {
      const bloomScale = 0.94 + (bloomTrait / localChance) * 0.18
      this.grassBloom.addStretched(
        new Vector3(soilPosition.x, soilPosition.y - YOUNG_SEDGE.bury, soilPosition.z),
        yaw + (form - 0.5) * 0.35,
        new Vector3(widthScale, bloomScale, depthScale),
        tiltX * 0.45,
        tiltZ * 0.45,
      )
    }
  }

  meshes(): InstancedMesh[] {
    const out: InstancedMesh[] = []
    for (const species of this.all()) {
      const mesh = species.build()
      if (mesh) out.push(mesh)
    }
    return out
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const species of this.all()) out[species.name] = species.count
    return out
  }
}

// ───────────────────────────────────────────────────────────── sampling ──

interface SectorSample {
  x: number
  z: number
  /** 0 at the inner soil edge, 1 at the outer. */
  across: number
  y: number
}

function fillBounds(planter: PlanterSpec): { inner: number; outer: number } {
  // Re-derived from paving's own soil-surface construction. Keep in step.
  return {
    inner: planter.rInner + planter.wall - 0.02,
    outer: planter.rOuter - planter.wall + 0.02,
  }
}

/** The soil surface, including paving's 3 cm mid-width crown. */
function soilAt(x: number, z: number, across: number): number {
  return slabTop(x, z) + SOIL_LIFT + Math.sin(Math.PI * across) * 0.03
}

/** Smooth world-space fertility shared by grass acceptance and daisies. */
export function grassFertilityAt(point: Vector3): number {
  const macro =
    Math.sin(point.x * 0.19 + point.z * 0.13 + Math.sin(point.z * 0.09) * 1.8) * 0.5 +
    0.5
  const meso = Math.sin(point.x * 0.53 - point.z * 0.41 + 1.7) * 0.5 + 0.5
  return Math.max(0, Math.min(1, Math.pow(macro * 0.72 + meso * 0.28, 1.28)))
}

export interface WeightedGrassSampleOptions {
  rng: Rng
  count: number
  /** Available soil area in square metres. */
  area: number
  /** Area-correct candidate already seated on the soil surface. */
  candidate: () => Vector3
  /** Mature roots attract juvenile candidates without collapsing spacing. */
  attractors?: readonly Vector3[]
  spacingFactor?: number
}

/**
 * Weighted Poisson-disk sampling for grass. Fertility rejects candidates in
 * lean patches; the disk test prevents overlaps; juvenile attraction raises
 * probability near mature roots while retaining its own exclusion radius.
 */
export function sampleWeightedGrassPoints(options: WeightedGrassSampleOptions): Vector3[] {
  const {
    rng,
    count,
    area,
    candidate,
    attractors = [],
    spacingFactor = 0.62,
  } = options
  if (count <= 0) return []

  const baseSpacing = Math.sqrt(Math.max(0.001, area) / count) * spacingFactor
  const minimumSpacing = baseSpacing * 0.66
  const cellSize = Math.max(0.001, minimumSpacing / Math.SQRT2)
  const cells = new Map<string, Vector3[]>()
  const accepted: Vector3[] = []
  let spacing = baseSpacing
  let dryAttempts = 0
  let attempts = 0
  const maxAttempts = Math.max(1_200, count * 320)

  const cellOf = (value: number): number => Math.floor(value / cellSize)
  const keyOf = (x: number, z: number): string => `${x}:${z}`
  const separated = (point: Vector3): boolean => {
    const cx = cellOf(point.x)
    const cz = cellOf(point.z)
    const radius = Math.ceil(spacing / cellSize)
    const spacingSq = spacing * spacing
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const bucket = cells.get(keyOf(cx + dx, cz + dz))
        if (!bucket) continue
        for (const other of bucket) {
          const ox = point.x - other.x
          const oz = point.z - other.z
          if (ox * ox + oz * oz < spacingSq) return false
        }
      }
    }
    return true
  }

  while (accepted.length < count && attempts < maxAttempts) {
    attempts++
    const point = candidate()
    // Keep a small colonisation chance in lean soil, but make fertile bands
    // decisively more likely so a fixed instance budget still reads patchy.
    let weight = 0.08 + grassFertilityAt(point) * 0.92
    if (attractors.length > 0) {
      let nearestSq = Infinity
      for (const root of attractors) {
        const dx = point.x - root.x
        const dz = point.z - root.z
        nearestSq = Math.min(nearestSq, dx * dx + dz * dz)
      }
      const rootClearance = Math.max(baseSpacing * 0.32, 0.075)
      if (nearestSq < rootClearance * rootClearance) weight = 0
      // Root-family affinity should be local. A broad radius makes almost the
      // whole bed equally attractive once mature grass is dense, reducing the
      // blend back to an unrelated weighted scatter.
      const attractionRadius = Math.max(baseSpacing * 1.05, 0.2)
      const affinity = Math.exp(-nearestSq / (2 * attractionRadius * attractionRadius))
      weight *= 0.34 + affinity * 0.66
    }
    if (weight <= 0 || rng.float() > weight || !separated(point)) {
      dryAttempts++
      if (dryAttempts > Math.max(80, count * 10)) {
        spacing = Math.max(minimumSpacing, spacing * 0.9)
        dryAttempts = 0
      }
      continue
    }
    accepted.push(point)
    const cx = cellOf(point.x)
    const cz = cellOf(point.z)
    const key = keyOf(cx, cz)
    const bucket = cells.get(key)
    if (bucket) bucket.push(point)
    else cells.set(key, [point])
    dryAttempts = 0
  }
  return accepted
}

function place(planter: PlanterSpec, across: number, along: number): SectorSample {
  const { inner, outer } = fillBounds(planter)
  const r = inner + across * (outer - inner)
  const angle = planter.a0 + along * (planter.a1 - planter.a0)
  const x = planter.cx + Math.cos(angle) * r
  const z = planter.cz + Math.sin(angle) * r
  return { x, z, across, y: soilAt(x, z, across) }
}

function sectorArea(planter: PlanterSpec, acrossMin: number, acrossMax: number): number {
  const { inner, outer } = fillBounds(planter)
  const width = outer - inner
  const minRadius = inner + width * acrossMin
  const maxRadius = inner + width * acrossMax
  return 0.5 * (planter.a1 - planter.a0) * (maxRadius * maxRadius - minRadius * minRadius)
}

function randomSectorGrassPoint(
  planter: PlanterSpec,
  rng: Rng,
  acrossMin: number,
  acrossMax: number,
): Vector3 {
  const { inner, outer } = fillBounds(planter)
  const width = outer - inner
  const minRadius = inner + width * acrossMin
  const maxRadius = inner + width * acrossMax
  const radius = Math.sqrt(rng.range(minRadius * minRadius, maxRadius * maxRadius))
  const across = (radius - inner) / width
  const sample = place(planter, across, rng.range(0.015, 0.985))
  return new Vector3(sample.x, sample.y, sample.z)
}

/**
 * Instance yaw that aims a plant's cards along a world compass bearing.
 *
 * A card built by `buildPlant` with `yaw ≈ 0` and a large `pitch` extends
 * along its LOCAL +Z, and `SpeciesInstances.add` composes `Ry(yaw)` on top,
 * so the card ends up pointing at `(sin yaw, cos yaw)` in world XZ. To send it
 * along the polar bearing `θ = (cos θ, sin θ)` the instance yaw must be
 * `π/2 − θ`. Getting this wrong rotates every trailing sprig 90° and the
 * spill runs ALONG the coping instead of over it — which is exactly what the
 * first pass did.
 */
function spillYaw(bearing: number): number {
  return Math.PI / 2 - bearing
}

/**
 * Clustered sampling inside an annular sector. Parents are strewn, children
 * gather around them — the Neyman–Scott shape SeaPark uses for its reef
 * colonies, and the difference between "planted" and "sprinkled".
 */
function sampleSector(
  planter: PlanterSpec,
  rng: Rng,
  count: number,
  acrossMin: number,
  acrossMax: number,
  clump = 0.45,
  margin = 0.15,
): SectorSample[] {
  const out: SectorSample[] = []
  if (count <= 0) return out
  const { inner, outer } = fillBounds(planter)
  const width = Math.max(0.001, outer - inner)
  // ABSOLUTE wall margin, not a fraction: on a 1 m bed a 6 % inset is 6 cm,
  // and a tuft rooted 6 cm off the wall pushes its lower cards straight
  // through the 0.2 m concrete — the "roots outside the container" comb
  // (owner defect). The fractional ranges still layer the species; this
  // clamp guarantees no root sits closer to a wall than its foliage needs.
  const marginFrac = Math.min(0.45, margin / width)
  const lo = Math.max(acrossMin, marginFrac)
  const hi = Math.max(lo, Math.min(acrossMax, 1 - marginFrac))
  const mid = (planter.rInner + planter.rOuter) * 0.5
  const arcLength = Math.max(0.001, (planter.a1 - planter.a0) * mid)
  const parents = Math.max(1, Math.round(count / 3))
  for (let p = 0; p < parents; p++) {
    const acrossParent = rng.range(lo, hi)
    const alongParent = rng.float()
    const children = Math.max(1, Math.round(count / parents))
    for (let c = 0; c < children && out.length < count; c++) {
      const jitterAcross = c === 0 ? 0 : rng.range(-clump, clump) / width
      const jitterAlong = c === 0 ? 0 : rng.range(-clump, clump) / arcLength
      const across = Math.min(hi, Math.max(lo, acrossParent + jitterAcross))
      const along = Math.min(0.985, Math.max(0.015, alongParent + jitterAlong))
      out.push(place(planter, across, along))
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────── the beds ──

/**
 * Fill every planter. Species are layered by height with the tall material
 * pulled off the edges, juvenile grass pushed INTO them, and trailing sprigs
 * rooted just inside the coping so the planting breaks the hard white line —
 * which is exactly what the reference image's beds do.
 */
export function plantPlanters(
  palette: PlantingPalette,
  writer: PartWriter,
  rng: Rng,
): PlantingStats {
  let soilArea = 0
  let stones = 0
  let pines = 0

  PLANTERS.forEach((planter, index) => {
    const { inner, outer } = fillBounds(planter)
    const area = 0.5 * (planter.a1 - planter.a0) * (outer * outer - inner * inner)
    soilArea += area
    const recipe = RECIPES[(index + Math.floor(rng.float() * 4)) % RECIPES.length]
    const lush = 0.85 + rng.float() * 0.35

    // Tall planting keeps clear of the tram side entirely.
    const outerLimit = planter.rOuter + 0.4 < TRAM_SWEPT_INNER ? 0.9 : 0.6

    const matureGrassRoots = sampleWeightedGrassPoints({
      rng,
      count: Math.round(area * recipe.sedge * lush),
      area: sectorArea(planter, 0.06, 0.94),
      candidate: () => randomSectorGrassPoint(planter, rng, 0.06, 0.94),
      spacingFactor: 0.58,
    })
    for (const root of matureGrassRoots) {
      palette.sedge.add(
        root.clone().add(new Vector3(0, -0.03, 0)),
        rng.range(0, Math.PI * 2),
        rng.range(0.78, 1.22),
        rng.range(-0.1, 0.1),
        rng.range(-0.1, 0.1),
      )
    }
    for (const sample of sampleSector(planter, rng, Math.round(area * recipe.fern * lush), 0.14, outerLimit, 0.42)) {
      palette.fern.add(
        new Vector3(sample.x, sample.y - 0.03, sample.z),
        rng.range(0, Math.PI * 2),
        rng.range(0.86, 1.34),
        rng.range(-0.09, 0.09),
        rng.range(-0.09, 0.09),
      )
    }
    for (const sample of sampleSector(planter, rng, Math.round(area * recipe.broad * lush), 0.2, outerLimit - 0.08, 0.38)) {
      palette.broadleaf.add(
        new Vector3(sample.x, sample.y - 0.04, sample.z),
        rng.range(0, Math.PI * 2),
        rng.range(0.86, 1.34),
        rng.range(-0.08, 0.08),
        rng.range(-0.08, 0.08),
      )
    }
    // Juvenile sedge closes the soil without the flattened alpha-card mats
    // that used to read as deformed plants. Its own Poisson radius prevents
    // overlaps, while mature-root attraction blends both ages and their
    // daisies into the same fertile colonies.
    const youngGrassRoots = sampleWeightedGrassPoints({
      rng,
      count: Math.round(area * recipe.young * lush),
      area: sectorArea(planter, 0.02, 0.98),
      candidate: () => randomSectorGrassPoint(planter, rng, 0.02, 0.98),
      attractors: matureGrassRoots,
      spacingFactor: 0.54,
    })
    for (const root of youngGrassRoots) {
      palette.addYoungSedge(root, rng, 0.9, 1.38)
    }
    const flowerCount = Math.round(area * recipe.flower)
    for (const sample of sampleSector(planter, rng, flowerCount, 0.25, outerLimit - 0.1, 0.3)) {
      palette.flower.add(
        new Vector3(sample.x, sample.y - 0.02, sample.z),
        rng.range(0, Math.PI * 2),
        rng.range(0.8, 1.2),
        rng.range(-0.12, 0.12),
        rng.range(-0.12, 0.12),
      )
    }

    // NO trailing spill down the outer face. The sprig cards can only reach
    // the wall's far side by crossing the concrete (soil-rooted: stems poke
    // through mid-wall — the owner's "roots outside the container" comb) or
    // by draping from the rim (rim-rooted: flat dark ribbons pasted on the
    // sunlit face — tried, read as dirt streaks). Nothing of a planting
    // shows outside its container; the beds break the coping line with the
    // tall species' silhouettes instead. Trailing sprigs now live INSIDE
    // the bed at its edges, arching over soil rather than concrete.
    for (const sample of sampleSector(planter, rng, Math.round(area * 0.5), 0.06, 0.94, 0.5, 0.12)) {
      palette.trailing.add(
        new Vector3(sample.x, sample.y - 0.02, sample.z),
        rng.range(0, Math.PI * 2),
        rng.range(0.6, 0.9),
        0,
        rng.range(-0.12, 0.12),
      )
    }

    // Accent stones: two or three per bed, half-buried. They read as design
    // rather than debris because they are grouped, not strewn.
    const stoneCount = rng.int(2, 3)
    for (let i = 0; i < stoneCount; i++) {
      const sample = place(planter, rng.range(0.2, 0.8), rng.range(0.1, 0.9))
      const radius = rng.range(0.09, 0.2)
      const mesh = rockMesh({
        radius,
        height: radius * rng.range(1.1, 1.7),
        seed: rng.float() * 10,
        elongation: rng.range(1.05, 1.5),
        bury: 0.4,
        levels: 8,
        segments: 16,
        bands: 4,
        bedAmount: 0.06,
      })
      placeRock(mesh, sample.x, sample.y, sample.z, rng.range(0, Math.PI * 2))
      writeInto(writer, 'stone', mesh)
      stones++
    }

    // Drip line: 16 mm poly tubing on the soil with emitter fittings. The
    // detail that says this bed is IRRIGATED, on a planet with no rain.
    emitDripLine(writer, planter, rng)

    // A dwarf conifer in every fifth bed — the vertical accent, and the only
    // thing in a planter tall enough to break the coping line from across the
    // boulevard.
    if (index % 5 === 2) {
      const sample = place(planter, 0.45, rng.range(0.25, 0.75))
      emitDwarfPine(palette, writer, rng, sample.x, sample.y, sample.z)
      pines++
    }
  })

  return {
    planters: PLANTERS.length,
    soilArea,
    stones,
    pines,
    byspecies: palette.counts(),
  }
}

/** 16 mm irrigation tubing pinned along the bed, with emitter fittings. */
function emitDripLine(writer: PartWriter, planter: PlanterSpec, rng: Rng): void {
  const across = rng.range(0.42, 0.58)
  const mid = (planter.rInner + planter.rOuter) * 0.5
  const arcLength = (planter.a1 - planter.a0) * mid
  const steps = Math.max(6, Math.round(arcLength / 0.5))
  const path: Vector3[] = []
  for (let i = 0; i <= steps; i++) {
    const along = 0.04 + (i / steps) * 0.92
    // A hose is never a perfect arc: let it wander a few centimetres.
    const wander = Math.sin(i * 0.9 + planter.a0 * 3) * 0.045
    const sample = place(planter, across + wander, along)
    // Sunk 4 mm into the soil — contact is a sink, never a rest.
    path.push(new Vector3(sample.x, sample.y + 0.008, sample.z))
  }
  writer.tube({ path, radius: 0.012, slot: 'dark', radialSegments: 5, uvScale: 0.5 })
  const emitters = Math.max(1, Math.floor(arcLength / 1.4))
  for (let i = 0; i < emitters; i++) {
    const node = path[Math.floor(((i + 0.5) / emitters) * (path.length - 1))]
    writer.box({
      center: node.clone().add(new Vector3(0, 0.012, 0)),
      size: new Vector3(0.03, 0.036, 0.03),
      slot: 'dark',
      chamfer: 0.004,
      rotationY: rng.range(0, Math.PI),
    })
  }
}

/**
 * A dwarf conifer: a lathed tapered stem with a real root swell, and five
 * whorls of needle boughs that shorten upward. ~1.6 m — a shrub, not a tree;
 * the First Tree stays the only tree on Mars.
 */
function emitDwarfPine(
  palette: PlantingPalette,
  writer: PartWriter,
  rng: Rng,
  x: number,
  y: number,
  z: number,
): void {
  const height = rng.range(1.35, 1.75)
  // (r, z) profile, Z-up: root swell, taper, a leader that never reaches 0.
  const profile: Vec2[] = [
    [0.085, -0.08],
    [0.068, 0.02],
    [0.052, 0.18],
    [0.042, height * 0.35],
    [0.03, height * 0.62],
    [0.017, height * 0.86],
    [0.006, height],
  ]
  const stem = revolve(profile, 10, { capStart: true, capEnd: true, smooth: 40 })
  cleanMesh(stem)
  toYUp(stem)
  for (const v of stem.verts) {
    v[0] += x
    v[1] += y
    v[2] += z
  }
  writeInto(writer, 'conifer', stem)

  const whorls = 5
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1)
    const level = height * (0.28 + t * 0.6)
    const boughs = 7 - w
    const reach = 1.15 - t * 0.55
    const base = rng.float() * Math.PI * 2
    for (let b = 0; b < boughs; b++) {
      const yaw = base + (b / boughs) * Math.PI * 2 + rng.range(-0.14, 0.14)
      palette.pine.add(
        new Vector3(
          x + Math.sin(yaw) * 0.03,
          y + level + rng.range(-0.03, 0.03),
          z + Math.cos(yaw) * 0.03,
        ),
        yaw,
        reach * rng.range(0.85, 1.12),
        rng.range(-0.06, 0.06),
        rng.range(-0.06, 0.06),
      )
    }
  }
  // A crown tuft, so the leader is not a bare spike.
  for (let i = 0; i < 3; i++) {
    palette.pine.add(
      new Vector3(x, y + height * 0.93, z),
      (i / 3) * Math.PI * 2 + rng.float(),
      0.4,
      -0.55,
      0,
    )
  }
}

// ────────────────────────────────────────────────── the First Tree's ring ──

/**
 * The tree pit. The plaza is a continuous paved disc, so without this the
 * First Tree grows out of a slab. It is built from paving's own PLANTER
 * constants and its own concrete material, so it reads as one family with the
 * generated arc beds rather than as a separate object.
 *
 * The wall is ONE closed swept shell (a loft that wraps in both u and v), so
 * there are no caps, no seams and nothing to z-fight. It is bedded 5 cm INTO
 * the slab: a wall that merely rests on the paving shows a hairline at every
 * grazing angle.
 */
export function buildTreeRing(
  writer: PartWriter,
  colliders: VegetationCollider[],
  cx: number,
  cz: number,
  radius: number,
): number {
  const wallHalf = PLANTER.wall / 2
  const over = PLANTER.copingOverhang
  const cap = PLANTER.copingThickness
  const rim = PLANTER.rimY
  const bottom = -0.05
  // Closed section loop: inner face, coping with a drip reveal and an arris,
  // outer face, back to the bed.
  const section: Vec2[] = [
    [-wallHalf, bottom],
    [-wallHalf, rim - cap],
    [-wallHalf - over, rim - cap],
    [-wallHalf - over, rim - 0.012],
    [-wallHalf - over + 0.012, rim],
    [wallHalf + over - 0.012, rim],
    [wallHalf + over, rim - 0.012],
    [wallHalf + over, rim - cap],
    [wallHalf, rim - cap],
    [wallHalf, bottom],
  ]
  const segments = 96
  const rings: Vec3[][] = []
  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    rings.push(
      section.map(([dr, dz]) => {
        const x = cx + cos * (radius + dr)
        const z = cz + sin * (radius + dr)
        // Author Z-up: (x, worldZ, worldY).
        return [x, z, slabTop(x, z) + dz] as Vec3
      }),
    )
  }
  const wall = loft(rings, { closeU: true, closeV: true })
  smoothShade(wall, 32)
  cleanMesh(wall)
  toYUp(wall)
  writeInto(writer, 'planterWall', wall)

  // Soil: a domed pit surface. Starts at r = 0.30 so the polar grid emits no
  // zero-area triangle at the pole (notes.md W1) — the root flare, which is
  // ~0.5 m across at the ground, covers the pinhole.
  const innerHole = 0.3
  const soilOuter = radius - wallHalf + 0.01
  const radialSteps = 12
  const angularSteps = 72
  const soilY = (x: number, z: number, across: number): number =>
    slabTop(x, z) + SOIL_LIFT + Math.sin(Math.PI * across) * 0.05
  const point = (r: number, angle: number): Vector3 => {
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    const across = (r - innerHole) / (soilOuter - innerHole)
    return new Vector3(x, soilY(x, z, across), z)
  }
  for (let i = 0; i < radialSteps; i++) {
    const ra = innerHole + ((soilOuter - innerHole) * i) / radialSteps
    const rb = innerHole + ((soilOuter - innerHole) * (i + 1)) / radialSteps
    for (let j = 0; j < angularSteps; j++) {
      const a0 = (j / angularSteps) * Math.PI * 2
      const a1 = ((j + 1) / angularSteps) * Math.PI * 2
      writer.quad('soil', point(ra, a0), point(ra, a1), point(rb, a1), point(rb, a0), 0.35)
    }
  }

  // Wall colliders: 24 boxes on the mid-arc, matching how paving handles the
  // arc planters. A 0.52 m kerb the player can walk through is a bug.
  const colliderSteps = 24
  for (let i = 0; i < colliderSteps; i++) {
    const a0 = (i / colliderSteps) * Math.PI * 2
    const a1 = ((i + 1) / colliderSteps) * Math.PI * 2
    const midAngle = (a0 + a1) * 0.5
    const x = cx + Math.cos(midAngle) * radius
    const z = cz + Math.sin(midAngle) * radius
    colliders.push({
      kind: 'box',
      center: new Vector3(x, slabTop(x, z) + rim / 2, z),
      size: new Vector3(PLANTER.wall + over * 2, rim, (a1 - a0) * radius + 0.08),
      // size.x is the RADIAL wall thickness, so local +X must be the radial.
      // The collider convention maps local +X to (cos yaw, −sin yaw), which is
      // the radial (cos m, sin m) only at yaw = −m. The old
      // `atan2(cos m, −sin m)` is m + π/2 — neither radial nor tangential, so
      // the box swung between the two around the ring: thin tangentially near
      // m = 0, ±π/2, ±π (1.2 m gaps a capsule walks straight through) and
      // 1.5 m proud of the kerb into the plaza at the diagonals.
      yaw: -midAngle,
    })
  }

  return slabTop(cx, cz) + SOIL_LIFT
}

/**
 * The collar of dense planting inside the tree pit. This is the ground half
 * of postcard #2: the player stands at the ring, the low sun comes through the
 * canopy, and what it lands on has to be worth looking at.
 */
export function plantTreeCollar(
  palette: PlantingPalette,
  rng: Rng,
  cx: number,
  cz: number,
  radius: number,
): void {
  const innerClear = 0.62 // clear of the root flare
  const outerClear = radius - PLANTER.wall / 2 - 0.12
  const area = Math.PI * (outerClear * outerClear - innerClear * innerClear)
  // Exactly the dome `buildTreeRing` laid down — re-derived, never guessed.
  const holeRadius = 0.3
  const soilOuter = radius - PLANTER.wall / 2 + 0.01
  const soilY = (x: number, z: number, r: number): number =>
    slabTop(x, z) +
    SOIL_LIFT +
    Math.sin(Math.PI * ((r - holeRadius) / (soilOuter - holeRadius))) * 0.05

  const scatter = (count: number, min: number, max: number, place: (p: Vector3) => void) => {
    const parents = Math.max(1, Math.round(count / 3.2))
    for (let p = 0; p < parents; p++) {
      const baseAngle = rng.range(0, Math.PI * 2)
      // Area-uniform radius, then clustered children around the parent.
      const baseRadius = Math.sqrt(rng.range(min * min, max * max))
      const children = Math.max(1, Math.round(count / parents))
      for (let c = 0; c < children; c++) {
        const angle = baseAngle + (c === 0 ? 0 : rng.range(-0.5, 0.5) / Math.max(0.5, baseRadius))
        const r = Math.min(max, Math.max(min, baseRadius + (c === 0 ? 0 : rng.range(-0.45, 0.45))))
        const x = cx + Math.cos(angle) * r
        const z = cz + Math.sin(angle) * r
        place(new Vector3(x, soilY(x, z, r), z))
      }
    }
  }

  const randomGrassPoint = (min: number, max: number): Vector3 => {
    const angle = rng.range(0, Math.PI * 2)
    const r = Math.sqrt(rng.range(min * min, max * max))
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    return new Vector3(x, soilY(x, z, r), z)
  }
  const matureGrassRoots = sampleWeightedGrassPoints({
    rng,
    count: Math.round(area * 8.4),
    area,
    candidate: () => randomGrassPoint(innerClear, outerClear),
    spacingFactor: 0.58,
  })
  for (const p of matureGrassRoots) {
    palette.sedge.add(
      p.clone().add(new Vector3(0, -0.03, 0)),
      rng.range(0, Math.PI * 2),
      rng.range(0.76, 1.2),
      rng.range(-0.1, 0.1),
      rng.range(-0.1, 0.1),
    )
  }
  const youngGrassRoots = sampleWeightedGrassPoints({
    rng,
    count: Math.round(area * 4.2),
    area,
    candidate: () => randomGrassPoint(innerClear, outerClear),
    attractors: matureGrassRoots,
    spacingFactor: 0.52,
  })
  for (const p of youngGrassRoots) palette.addYoungSedge(p, rng, 0.88, 1.35)
  scatter(Math.round(area * 1.7), innerClear + 0.5, outerClear - 0.3, (p) => {
    palette.fern.add(
      p.clone().add(new Vector3(0, -0.03, 0)),
      rng.range(0, Math.PI * 2),
      rng.range(0.75, 1.25),
      rng.range(-0.08, 0.08),
      rng.range(-0.08, 0.08),
    )
  })
  // Trailing sprigs at the kerb so the pit overflows its wall like the beds.
  const spillCount = Math.round((Math.PI * 2 * outerClear) / 0.7)
  for (let i = 0; i < spillCount; i++) {
    if (rng.float() > 0.9) continue
    const angle = ((i + rng.range(0.2, 0.8)) / spillCount) * Math.PI * 2
    const r = outerClear + 0.04
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    palette.trailing.add(
      new Vector3(x, soilY(x, z, r) - 0.02, z),
      spillYaw(angle),
      rng.range(0.8, 1.2),
      0,
      rng.range(-0.1, 0.1),
    )
  }
}

export interface BedSpec {
  x: number
  z: number
  halfX: number
  halfZ: number
  yaw: number
  /** Soil surface height. */
  y: number
  /** Instances per square metre — the gardens are Mars-sparse on purpose. */
  density: number
}

/**
 * A bounded rectangular bed, used by the Regolith Gardens. The contrast is
 * the whole point: the planters overflow, these are RATIONED — a few clumps
 * of sedge in a steel frame, most of the soil showing.
 */
export function plantBed(palette: PlantingPalette, rng: Rng, bed: BedSpec): void {
  const cos = Math.cos(bed.yaw)
  const sin = Math.sin(bed.yaw)
  const area = bed.halfX * bed.halfZ * 4
  const local = (lx: number, lz: number): Vector3 =>
    new Vector3(bed.x + lx * cos + lz * sin, bed.y, bed.z - lx * sin + lz * cos)

  const margin = Math.min(0.25, bed.halfX * 0.2, bed.halfZ * 0.2)
  const usableHalfX = Math.max(0.02, bed.halfX - margin)
  const usableHalfZ = Math.max(0.02, bed.halfZ - margin)
  const usableArea = usableHalfX * usableHalfZ * 4
  const candidate = (): Vector3 =>
    local(rng.range(-usableHalfX, usableHalfX), rng.range(-usableHalfZ, usableHalfZ))
  const matureGrassRoots = sampleWeightedGrassPoints({
    rng,
    count: Math.max(4, Math.round(area * bed.density)),
    area: usableArea,
    candidate,
    spacingFactor: 0.6,
  })
  for (const p of matureGrassRoots) {
    palette.sedge.add(
      p.clone().add(new Vector3(0, -0.03, 0)),
      rng.range(0, Math.PI * 2),
      rng.range(0.6, 1.15),
      rng.range(-0.12, 0.12),
      rng.range(-0.12, 0.12),
    )
  }
  const youngGrassRoots = sampleWeightedGrassPoints({
    rng,
    count: Math.round(matureGrassRoots.length * 0.3),
    area: usableArea,
    candidate,
    attractors: matureGrassRoots,
    spacingFactor: 0.52,
  })
  for (const p of youngGrassRoots) palette.addYoungSedge(p, rng, 0.82, 1.18)
}
