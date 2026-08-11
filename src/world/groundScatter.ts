import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import type { Rng } from '../core/prng'
import { createClastMaterial } from './groundMaterials'
import { regolithSurface } from './interiorHeight'
import { GARDENS, PADS, PATHS } from './parkPlan'
import { pavedSignedDistance } from './pavingPlan'

/**
 * Loose surface clasts on the open regolith — the cheapest, highest-payoff
 * cure for "uniform flat desert". Real Martian plains are a lag deposit:
 * ejecta and float rock concentrated in patches, swept clean along the wind
 * and wherever feet compact the fines.
 *
 * Placement is a stratified lattice (threejs-procedural-fields: stratify the
 * domain, then jitter) filtered by a coarse rock-field mask, so stones arrive
 * in believable drifts instead of an even sprinkle.
 *
 * SHADING. The stones are INDEXED icospheres carrying area-weighted averaged
 * normals. three's `IcosahedronGeometry` is NON-indexed (`PolyhedronGeometry`
 * emits three fresh vertices per triangle), so `computeVertexNormals()` on it
 * gives one flat normal per face — which is exactly why the old clasts read as
 * cut-glass polyhedra rather than rocks. Low poly is fine and stays: a float
 * rock's silhouette is simple. It is the FACES that must not read as plates.
 */

const FLOOR_RADIUS = 118

/**
 * Size tiers, long-tailed on purpose. A plain is mostly cobbles; the handful
 * of anchors is what gives the eye something to measure the floor against.
 * `promote` is the cumulative share below which a stone stays in this tier.
 *
 * Subdivision buys silhouette, not shading — the shading comes from welding
 * plus averaged normals, which is why even the 80-triangle cobbles are round.
 */
const TIERS = [
  { subdivisions: 1, variants: 3, min: 0.075, max: 0.2, promote: 0.8, cast: false },
  { subdivisions: 2, variants: 3, min: 0.21, max: 0.46, promote: 0.991, cast: true },
  { subdivisions: 3, variants: 4, min: 0.54, max: 1.08, promote: 1, cast: true },
] as const

/** Fraction of a stone's own height that sits below grade. */
const BURIAL = { min: 0.22, max: 0.35 }

function hash2(ix: number, iz: number, salt: number): number {
  let h = (ix * 374761393 + iz * 668265263 + salt * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/** Coarse rock-field mask: where the lag deposit actually concentrates. */
function rockField(x: number, z: number): number {
  const wavelength = 46
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = smooth(fx - ix)
  const tz = smooth(fz - iz)
  const a = hash2(ix, iz, 7)
  const b = hash2(ix + 1, iz, 7)
  const c = hash2(ix, iz + 1, 7)
  const d = hash2(ix + 1, iz + 1, 7)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * tz
}

/** Distance to the nearest circulation route (paved or compacted service). */
function routeDistance(x: number, z: number): number {
  let best = Infinity
  for (const path of PATHS) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i]
      const b = path.points[i + 1]
      const abx = b.x - a.x
      const abz = b.y - a.y
      const lengthSq = abx * abx + abz * abz
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / lengthSq))
      const dx = x - (a.x + abx * t)
      const dz = z - (a.y + abz * t)
      best = Math.min(best, Math.hypot(dx, dz) - path.width / 2)
    }
  }
  return best
}

function onPad(x: number, z: number): boolean {
  for (const pad of PADS) {
    if (Math.hypot(x - pad.x, z - pad.z) < pad.radius + 1) return true
  }
  return false
}

function inGarden(x: number, z: number): boolean {
  for (const zone of GARDENS) {
    if (Math.hypot(x - zone.x, z - zone.z) < zone.radius * 0.86) return true
  }
  return false
}

const ICOSAHEDRON_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]

/**
 * Indexed icosphere. Every subdivision midpoint goes through a cache keyed on
 * the edge, so shared vertices are shared BY CONSTRUCTION — no welding pass,
 * no epsilon, and `computeVertexNormals()` therefore averages across faces
 * instead of flat-shading them.
 */
function icosphere(subdivisions: number): { points: Vector3[]; indices: number[] } {
  const t = (1 + Math.sqrt(5)) / 2
  const points = [
    new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0),
    new Vector3(0, -1, t), new Vector3(0, 1, t), new Vector3(0, -1, -t), new Vector3(0, 1, -t),
    new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1),
  ].map((point) => point.normalize())

  let faces = ICOSAHEDRON_FACES.map((face) => [...face] as [number, number, number])
  for (let pass = 0; pass < subdivisions; pass++) {
    const cache = new Map<number, number>()
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const index = points.length
      points.push(points[a].clone().add(points[b]).normalize())
      cache.set(key, index)
      return index
    }
    const next: Array<[number, number, number]> = []
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }

  const indices: number[] = []
  for (const [a, b, c] of faces) indices.push(a, b, c)
  return { points, indices }
}

const volumeScratch = new Vector3()

/** Signed volume of a closed mesh — negative means the shell is inside-out. */
function signedVolume(points: Vector3[], indices: number[]): number {
  let total = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = points[indices[i]]
    const b = points[indices[i + 1]]
    const c = points[indices[i + 2]]
    total += a.dot(volumeScratch.crossVectors(b, c))
  }
  return total / 6
}

export interface ClastVariant {
  geometry: BufferGeometry
  /** Local-frame extents, so burial can be solved against the real shape. */
  minY: number
  height: number
}

/**
 * One settled clast, authored in a unit frame whose waist is y ≈ 0 and whose
 * grade line lands near y ≈ −0.45 once buried (`createClastMaterial` keys its
 * dust collar to that band).
 *
 * Form lives in three registers, every one of them wide enough to survive
 * normal averaging at this vertex count (notes.md W2: "geometry finer than the
 * shading threshold is not geometry either"). MASSES set the silhouette; KNOBS
 * give the surface something to catch a grazing sun on, so it is not an egg;
 * FLATS are the broad weathered faces a fractured clast really has, subtracted
 * through a smoothstep so their edge is a soft arris and never the cut-glass
 * crease this rewrite exists to remove.
 */
function clastGeometry(subdivisions: number, rng: Rng): ClastVariant {
  const { points, indices } = icosphere(subdivisions)
  const axis = () =>
    new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize()
  // Falloff ≥1.3 keeps every lobe C1 at its own equator; anything sharper puts
  // a crease back into the surface.
  const masses = Array.from({ length: rng.int(5, 7) }, () => ({
    axis: axis(),
    gain: rng.range(0.12, 0.3),
    falloff: rng.range(1.3, 2.6),
  }))
  // Knob width tracks the vertex spacing: a cobble at one subdivision cannot
  // resolve what an anchor at three can, and forcing it to would just spike.
  const knobs = Array.from({ length: 6 + 4 * subdivisions }, () => ({
    axis: axis(),
    gain: rng.range(0.05, 0.12),
    falloff: 4 + 1.6 * subdivisions + rng.range(0, 3),
  }))
  const flats = Array.from({ length: rng.int(2, 3) }, () => ({
    axis: axis(),
    depth: rng.range(0.1, 0.22),
  }))
  // Settled, not perched: float rock is wider than it is tall, and the last
  // few centimetres flare into the fines banked against its foot.
  const dome = rng.range(0.6, 0.84)
  const flare = rng.range(0.22, 0.42)

  const array = new Float32Array(points.length * 3)
  const point = new Vector3()
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i++) {
    const direction = points[i]
    let radius = 1
    for (const lobe of masses) {
      const facing = direction.dot(lobe.axis)
      if (facing > 0) radius += Math.pow(facing, lobe.falloff) * lobe.gain
    }
    for (const knob of knobs) {
      const facing = direction.dot(knob.axis)
      if (facing > 0) radius += Math.pow(facing, knob.falloff) * knob.gain
    }
    for (const flat of flats) {
      radius -= flat.depth * smooth((direction.dot(flat.axis) - 0.45) / 0.53)
    }
    point.copy(direction).multiplyScalar(Math.max(0.45, radius))
    point.y *= dome
    // The flare has to start ABOVE the waist. A body whose widest point sits
    // above the grade line reads as an undercut mushroom perched on the sand,
    // not as a stone the fines have banked against — the widest section of a
    // settled clast is at or below its contact line.
    const spread = 1 + flare * smooth((0.15 - point.y) / 0.85)
    point.x *= spread
    point.z *= spread
    array[i * 3] = point.x
    array[i * 3 + 1] = point.y
    array[i * 3 + 2] = point.z
    points[i].copy(point)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  // Winding is not worth hand-checking (notes.md W2-tram): assert it.
  if (signedVolume(points, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1]
      indices[i + 1] = indices[i + 2]
      indices[i + 2] = swap
    }
  }

  const geometry = new BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new BufferAttribute(array, 3))
  geometry.computeVertexNormals()
  return { geometry, minY, height: maxY - minY }
}

export interface ScatterBuild {
  meshes: InstancedMesh[]
  count: number
}

export function buildGroundScatter(rng: Rng): ScatterBuild {
  const material = createClastMaterial()

  // Shapes are forked off the seed by NAME, so adding or removing placements
  // can never reshuffle the stones themselves.
  const shapeRng = rng.fork('clast-shapes')
  const variants = TIERS.map((tier) =>
    Array.from({ length: tier.variants }, () => clastGeometry(tier.subdivisions, shapeRng)),
  )

  const placements = variants.map((tier) => tier.map(() => [] as Matrix4[]))
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const tilt = new Quaternion()
  const scale = new Vector3()
  const position = new Vector3()
  const up = new Vector3(0, 1, 0)
  const tiltAxis = new Vector3()
  let count = 0

  const cell = 2.4
  const span = Math.ceil(FLOOR_RADIUS / cell)
  for (let iz = -span; iz <= span; iz++) {
    for (let ix = -span; ix <= span; ix++) {
      const jitterX = hash2(ix, iz, 11)
      const jitterZ = hash2(ix, iz, 13)
      const roll = hash2(ix, iz, 17)
      const x = (ix + jitterX) * cell
      const z = (iz + jitterZ) * cell
      const r = Math.hypot(x, z)
      if (r > FLOOR_RADIUS || r < 9) continue
      if (pavedSignedDistance(x, z) < 1.3) continue
      if (onPad(x, z)) continue
      if (inGarden(x, z)) continue
      const route = routeDistance(x, z)
      if (route < 1.4) continue

      const field = rockField(x, z)
      const density = Math.max(0, field - 0.2) * 1.9 * Math.min(1, route / 6)
      if (roll > density) continue

      const sizeRoll = hash2(ix, iz, 23)
      let tierIndex = 0
      while (tierIndex < TIERS.length - 1 && sizeRoll > TIERS[tierIndex].promote) tierIndex++
      // Anchors belong to the rockiest drifts, not to a lone cobble field.
      if (tierIndex === 2 && field < 0.55) tierIndex = 1
      const tier = TIERS[tierIndex]
      const variantIndex = Math.min(
        tier.variants - 1,
        Math.floor(hash2(ix, iz, 29) * tier.variants),
      )
      const variant = variants[tierIndex][variantIndex]

      // Form variety lives in the VARIANT geometry, so the instance transform
      // stays close to uniform — a heavily squashed instance also skews the
      // shading (the normal matrix is the inverse transpose, correct but not
      // shape-preserving) and turns a settled boulder into a pressed pebble.
      const base = tier.min + (tier.max - tier.min) * rng.float()
      scale.set(
        base * rng.range(0.88, 1.18),
        base * rng.range(0.8, 1.04),
        base * rng.range(0.88, 1.18),
      )
      quaternion.setFromAxisAngle(up, rng.range(0, Math.PI * 2))
      tiltAxis.set(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize()
      quaternion.multiply(tilt.setFromAxisAngle(tiltAxis, rng.range(-0.14, 0.14)))

      // Bedded, not perched, and not swallowed either: a fixed fraction of the
      // stone's OWN height goes below grade, solved against the variant's real
      // extents rather than against a nominal unit radius.
      const burial = BURIAL.min + (BURIAL.max - BURIAL.min) * hash2(ix, iz, 31)
      position.set(
        x,
        regolithSurface(x, z) - burial * variant.height * scale.y - variant.minY * scale.y,
        z,
      )
      matrix.compose(position, quaternion, scale)
      placements[tierIndex][variantIndex].push(matrix.clone())
      count++
    }
  }

  const meshes: InstancedMesh[] = []
  for (let tierIndex = 0; tierIndex < TIERS.length; tierIndex++) {
    const tier = TIERS[tierIndex]
    for (let variantIndex = 0; variantIndex < tier.variants; variantIndex++) {
      const matrices = placements[tierIndex][variantIndex]
      if (matrices.length === 0) continue
      const mesh = new InstancedMesh(
        variants[tierIndex][variantIndex].geometry,
        material,
        matrices.length,
      )
      matrices.forEach((entry, index) => mesh.setMatrixAt(index, entry))
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = tier.cast
      mesh.receiveShadow = true
      mesh.name = `ground:clasts-${tierIndex}-${variantIndex}`
      meshes.push(mesh)
    }
  }
  return { meshes, count }
}
