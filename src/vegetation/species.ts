import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import type { Material } from 'three'

/**
 * Plant geometry primitives and the instancing sink.
 *
 * Two construction families, chosen by viewing distance rather than by taste:
 *
 *   • `bladeCluster()` — real tapered strips for anything the player can
 *     stand over (sedge, the tree's ground collar). Five intersecting planes
 *     with a HAND-AUTHORED hemispherical normal `(-sin, 0.34, cos)`, so a
 *     cluster lights like a soft mound instead of five flat fins. Lifted from
 *     the stylized-meadow-grass system; it is the reason close-range grass
 *     reads as grass and not as cardboard.
 *   • `buildPlant()` — cupped alpha cards for anything with a leaf shape too
 *     complex to model (ferns, broadleaf, flowers, ginkgo leaves, needles).
 *     Every card carries the ash system's ROUNDED NORMAL,
 *     `normalize(cardNormal + (vertex − origin))`, which fakes the volume of
 *     the plant the card stands for. Flat card normals are what make a bush
 *     look like a decal.
 *
 * Both bake an `aDepth` attribute: 0 on the outside of the plant, 1 buried in
 * its middle. The foliage material uses it to kill backlight and darken the
 * interior — free self-occlusion, and the single cheapest thing that stops a
 * shrub reading as a sticker.
 */

export interface BladeClusterOptions {
  height?: number
  width?: number
  segments?: number
  planes?: number
  /** Outward lean of the tips, metres at full height. */
  lean?: number
}

/**
 * One instance is a cluster of intersecting quad-strips — ~15 apparent blades
 * for 60 triangles.
 */
export function bladeCluster(options: BladeClusterOptions = {}): BufferGeometry {
  // `width` is the HALF-width at the base: a blade spans ±width. Sedge blades
  // are 4–12 mm across, so this number is ~0.006–0.012. The meadow-grass
  // source ships 0.085 because its blades are stylised 17 cm straps; copying
  // that value here produced 11 cm sedge that read as palm fronds.
  const { height = 0.42, width = 0.011, segments = 6, planes = 7, lean = 0.16 } = options
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const depths: number[] = []
  const indices: number[] = []

  for (let plane = 0; plane < planes; plane++) {
    const angle = (plane / planes) * Math.PI
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // The mound normal: never the plane's true normal.
    // The strip's winding points horizontally along (-sin, 0, cos). Keeping
    // the authored mound normal in that same hemisphere is essential:
    // DoubleSide flips normals from the geometric front-face flag, so the old
    // +sin normal became anti-lit for four of seven blade planes.
    const normal = new Vector3(-sin, 0.34, cos).normalize()
    const base = positions.length / 3

    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments
      const taper = Math.pow(1 - t, 1.35)
      const bend = Math.pow(t, 1.8) * lean
      const y = t * height
      const halfWidth = width * (0.18 + 0.82 * taper)
      for (const side of [-1, 1] as const) {
        const localX = side * halfWidth
        const localZ = bend
        positions.push(localX * cos - localZ * sin, y, localX * sin + localZ * cos)
        normals.push(normal.x, normal.y, normal.z)
        uvs.push(side < 0 ? 0 : 1, t)
        depths.push(0.55 * (1 - t))
      }
    }
    for (let segment = 0; segment < segments; segment++) {
      const row = base + segment * 2
      indices.push(row, row + 1, row + 2, row + 1, row + 3, row + 2)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aDepth', new Float32BufferAttribute(depths, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * A real grassland flower assembled from growth parts: tapered swept stem,
 * two stem leaves, a sepal whorl, fourteen shaped petals and a raised disc. The
 * whole plant is one instanced geometry with a root-to-head UV for wind.
 */
export function grassBloomCluster(): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const blooms: number[] = []
  const indices: number[] = []
  const totalHeight = 0.43
  const stemHeight = 0.39
  const stemSections = 7
  const stemSegments = 7
  const up = new Vector3(0, 1, 0)
  const quaternion = new Quaternion()
  const tangent = new Vector3()
  const radial = new Vector3()
  const vertex = new Vector3()

  const pushVertex = (
    point: Vector3,
    normal: Vector3,
    u: number,
    color: readonly [number, number, number],
    bloom: number,
  ): number => {
    const index = positions.length / 3
    positions.push(point.x, point.y, point.z)
    normals.push(normal.x, normal.y, normal.z)
    uvs.push(u, Math.max(0, Math.min(1, point.y / totalHeight)))
    colors.push(color[0], color[1], color[2])
    blooms.push(bloom)
    return index
  }

  const stemPoint = (t: number, target = new Vector3()): Vector3 =>
    target.set(
      0.018 * t * t + Math.sin(t * Math.PI) * 0.006,
      stemHeight * t,
      -0.014 * t * t + Math.sin(t * Math.PI * 1.4) * 0.004,
    )
  const stemTangent = (t: number, target = new Vector3()): Vector3 => {
    const epsilon = 0.002
    const before = stemPoint(Math.max(0, t - epsilon))
    const after = stemPoint(Math.min(1, t + epsilon))
    return target.subVectors(after, before).normalize()
  }

  // Stem rings. The frame follows the curve rather than assuming vertical,
  // so the small lean does not shear the tube or detach the flower head.
  const stemBase = positions.length / 3
  for (let section = 0; section <= stemSections; section++) {
    const t = section / stemSections
    const centre = stemPoint(t)
    stemTangent(t, tangent)
    quaternion.setFromUnitVectors(up, tangent)
    const radius = 0.0052 + (0.0024 - 0.0052) * Math.pow(t, 0.85)
    const green: readonly [number, number, number] = [
      0.055 + t * 0.025,
      0.115 + t * 0.055,
      0.035 + t * 0.018,
    ]
    for (let segment = 0; segment <= stemSegments; segment++) {
      const theta = (Math.PI * 2 * (segment % stemSegments)) / stemSegments
      radial.set(Math.cos(theta), 0, Math.sin(theta)).applyQuaternion(quaternion).normalize()
      vertex.copy(centre).addScaledVector(radial, radius)
      pushVertex(vertex, radial, segment / stemSegments, green, 0)
    }
  }
  const stemStride = stemSegments + 1
  for (let section = 0; section < stemSections; section++) {
    for (let segment = 0; segment < stemSegments; segment++) {
      const a = stemBase + section * stemStride + segment
      indices.push(a, a + stemStride, a + 1, a + 1, a + stemStride, a + stemStride + 1)
    }
  }

  const emitStemLeaf = (at: number, yaw: number, length: number, width: number): void => {
    const rows = 4
    const base = positions.length / 3
    const origin = stemPoint(at)
    const direction = new Vector3(Math.sin(yaw), 0.2, Math.cos(yaw)).normalize()
    const side = new Vector3(direction.z, 0, -direction.x).normalize()
    const normal = new Vector3(-direction.x * 0.18, 0.96, -direction.z * 0.18).normalize()
    for (let row = 0; row <= rows; row++) {
      const t = row / rows
      const centre = origin
        .clone()
        .addScaledVector(direction, length * t)
        .addScaledVector(up, Math.sin(t * Math.PI) * 0.012 - t * t * 0.015)
      const halfWidth = width * (0.14 + Math.sin(t * Math.PI) * 0.86) * (1 - t * 0.42)
      for (const sign of [-1, 1] as const) {
        const point = centre.clone().addScaledVector(side, halfWidth * sign)
        pushVertex(point, normal, sign < 0 ? 0 : 1, [0.06, 0.15, 0.045], 0)
      }
    }
    for (let row = 0; row < rows; row++) {
      const a = base + row * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  emitStemLeaf(0.31, 2.2, 0.105, 0.014)
  emitStemLeaf(0.5, -0.82, 0.085, 0.012)

  const head = stemPoint(1).add(new Vector3(0, 0.006, 0))
  // Sepals form a green star beneath the petals rather than leaving the bloom
  // pasted directly onto the stem tip.
  for (let sepal = 0; sepal < 5; sepal++) {
    const angle = (sepal / 5) * Math.PI * 2 + 0.3
    const out = new Vector3(Math.cos(angle), -0.22, Math.sin(angle)).normalize()
    const side = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
    const a = pushVertex(
      head.clone().addScaledVector(side, -0.005),
      new Vector3(0, -0.7, 0.3).applyAxisAngle(up, -angle).normalize(),
      0,
      [0.055, 0.13, 0.038],
      0,
    )
    const b = pushVertex(
      head.clone().addScaledVector(side, 0.005),
      new Vector3(0, -0.7, 0.3).applyAxisAngle(up, -angle).normalize(),
      1,
      [0.055, 0.13, 0.038],
      0,
    )
    const c = pushVertex(
      head.clone().addScaledVector(out, 0.028),
      new Vector3(0, -0.7, 0.3).applyAxisAngle(up, -angle).normalize(),
      0.5,
      [0.075, 0.17, 0.045],
      0,
    )
    indices.push(a, b, c)
  }

  // Fourteen warm-white ray petals make the head read as a daisy rather than
  // the sparse dark star produced by the original seven dusty-blue petals.
  // Width remains finite at root and tip, avoiding coincident fan vertices.
  const petals = 14
  const petalRows = 4
  for (let petal = 0; petal < petals; petal++) {
    const angle = (petal / petals) * Math.PI * 2 + 0.18
    const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const side = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
    const normal = new Vector3(direction.x * 0.28, 0.94, direction.z * 0.28).normalize()
    const base = positions.length / 3
    for (let row = 0; row <= petalRows; row++) {
      const t = row / petalRows
      const centre = head
        .clone()
        .addScaledVector(direction, 0.004 + t * 0.052)
        .addScaledVector(up, 0.003 + Math.sin(t * Math.PI) * 0.012 - t * 0.004)
      const halfWidth = 0.0035 + Math.sin(t * Math.PI) * 0.009
      const baseColor: readonly [number, number, number] = [0.9, 0.9, 0.86]
      const tipColor: readonly [number, number, number] = [1, 0.99, 0.95]
      const color: readonly [number, number, number] = [
        baseColor[0] + (tipColor[0] - baseColor[0]) * t,
        baseColor[1] + (tipColor[1] - baseColor[1]) * t,
        baseColor[2] + (tipColor[2] - baseColor[2]) * t,
      ]
      for (const sign of [-1, 1] as const) {
        pushVertex(centre.clone().addScaledVector(side, halfWidth * sign), normal, sign < 0 ? 0 : 1, color, 1)
      }
    }
    for (let row = 0; row < petalRows; row++) {
      const a = base + row * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  // Raised ochre disc: side wall plus a shallow domed top.
  const discSegments = 12
  const discRadius = 0.014
  const lower: number[] = []
  const upper: number[] = []
  for (let segment = 0; segment < discSegments; segment++) {
    const angle = (segment / discSegments) * Math.PI * 2
    const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    lower.push(
      pushVertex(
        head.clone().addScaledVector(direction, discRadius).addScaledVector(up, 0.004),
        direction,
        segment / discSegments,
        [0.42, 0.29, 0.07],
        1,
      ),
    )
    upper.push(
      pushVertex(
        head.clone().addScaledVector(direction, discRadius * 0.82).addScaledVector(up, 0.012),
        new Vector3(direction.x * 0.35, 0.94, direction.z * 0.35).normalize(),
        segment / discSegments,
        [0.62, 0.46, 0.12],
        1,
      ),
    )
  }
  const crown = pushVertex(
    head.clone().addScaledVector(up, 0.016),
    up,
    0.5,
    [0.72, 0.56, 0.18],
    1,
  )
  for (let segment = 0; segment < discSegments; segment++) {
    const next = (segment + 1) % discSegments
    indices.push(lower[segment], upper[segment], lower[next])
    indices.push(lower[next], upper[segment], upper[next])
    indices.push(upper[segment], crown, upper[next])
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aBloom', new Float32BufferAttribute(blooms, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export interface CardSpec {
  /** Rotation about the plant's axis. */
  yaw: number
  /** Lean away from vertical, radians. 0 upright, π/2 flat. */
  pitch: number
  /** Twist about the card's own axis. */
  roll?: number
  width: number
  height: number
  /** Attachment height on the plant's axis. */
  originY?: number
  /** Attachment distance out from the axis, along `yaw`. */
  originR?: number
  /** Bulge of the card's centre toward its face — the taco curl. */
  cup?: number
  /** Metres the tip falls under its own weight, along the card. */
  droop?: number
  /** 0 outside the plant, 1 in its middle. */
  depth?: number
  columns?: number
  rows?: number
  /** How hard the rounded normal bends away from the card plane. */
  round?: number
}

export interface OrientedCardOptions {
  width: number
  height: number
  cup?: number
  droop?: number
  depth?: number
  columns?: number
  rows?: number
  round?: number
  seed?: number
}

const scratchQuaternion = new Quaternion()
const scratchEuler = new Euler()
const scratchVertex = new Vector3()
const scratchNormal = new Vector3()
const scratchOffset = new Vector3()

/**
 * Accumulates cupped, rounded-normal cards into one geometry. Shared by the
 * planter species and the First Tree's canopy so both get the same craft:
 * a card is never a flat quad, and its normals never announce that it is one.
 */
export class CardSink {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly depths: number[] = []
  private readonly seeds: number[] = []
  private readonly indices: number[] = []
  private cards = 0

  get triangleCount(): number {
    return this.indices.length / 3
  }

  get cardCount(): number {
    return this.cards
  }

  /** Emit one card rooted at `origin`, its local +Y along the card. */
  push(origin: Vector3, quaternion: Quaternion, options: OrientedCardOptions): void {
    const {
      width,
      height,
      cup = 0.12,
      droop = 0,
      depth = 0,
      columns = 2,
      rows = 3,
      round = 0.65,
      seed = 0,
    } = options

    const base = this.positions.length / 3
    for (let row = 0; row <= rows; row++) {
      const v = row / rows
      for (let column = 0; column <= columns; column++) {
        const u = column / columns
        const across = (u - 0.5) * width
        // Taper toward the tip so a card is a leaf shape, not a banner.
        const taper = 1 - Math.pow(v, 2.2) * 0.28
        // Cup: the centre of the card stands proud of its chord.
        const bulge = cup * width * (1 - Math.pow(u * 2 - 1, 2)) * (0.35 + v * 0.65)
        // Droop: the tip falls, quadratically, along the card's own +Z.
        const fall = droop * v * v
        scratchVertex.set(across * taper, v * height, bulge + fall)
        scratchVertex.applyQuaternion(quaternion)
        scratchOffset.copy(scratchVertex)
        scratchVertex.add(origin)

        // Rounded normal (ash system): the card's own normal pushed outward
        // by the vertex's offset from the attachment point.
        scratchNormal.set(0, 0, 1).applyQuaternion(quaternion)
        if (scratchOffset.lengthSq() > 1e-12) {
          scratchNormal.addScaledVector(scratchOffset.normalize(), round)
        }
        if (scratchNormal.lengthSq() < 1e-10) scratchNormal.set(0, 1, 0)
        scratchNormal.normalize()

        this.positions.push(scratchVertex.x, scratchVertex.y, scratchVertex.z)
        this.normals.push(scratchNormal.x, scratchNormal.y, scratchNormal.z)
        this.uvs.push(u, v)
        // Interior depth eases out toward the tip: leaf ends always see sky.
        this.depths.push(Math.max(0, depth * (1 - v * 0.75)))
        this.seeds.push(seed)
      }
    }
    const stride = columns + 1
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = base + row * stride + column
        const b = a + 1
        const c = a + stride
        const d = b + stride
        // +Z winding, matching the +Z basis used by the rounded normal above.
        // The old -Z winding made Three's DoubleSide correction preserve a
        // normal facing away from the viewer on both visible sides.
        this.indices.push(a, b, c, b, d, c)
      }
    }
    this.cards++
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('aDepth', new Float32BufferAttribute(this.depths, 1))
    geometry.setAttribute('aSeed', new Float32BufferAttribute(this.seeds, 1))
    geometry.setIndex(this.indices)
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** Assemble a plant from card specs. Rooted at the origin, +Y up. */
export function buildPlant(cards: CardSpec[], seedOf?: (index: number) => number): BufferGeometry {
  const sink = new CardSink()
  const origin = new Vector3()
  cards.forEach((card, index) => {
    const { yaw, pitch, roll = 0, originY = 0, originR = 0 } = card
    scratchEuler.set(pitch, yaw, roll, 'YXZ')
    scratchQuaternion.setFromEuler(scratchEuler)
    origin.set(Math.sin(yaw) * originR, originY, Math.cos(yaw) * originR)
    sink.push(origin, scratchQuaternion, {
      width: card.width,
      height: card.height,
      cup: card.cup,
      droop: card.droop,
      depth: card.depth,
      columns: card.columns,
      rows: card.rows,
      round: card.round,
      seed: seedOf ? seedOf(index) : ((index * 0.137) % 1),
    })
  })
  return sink.build()
}

// ───────────────────────────────────────────────────────── plant recipes ──

/** Rosette of arching fronds — the fern analog. */
export function fernRosette(fronds = 7, height = 0.62): CardSpec[] {
  return Array.from({ length: fronds }, (_, i) => {
    const t = i / fronds
    const grow = 0.72 + ((i * 7) % 5) / 5 * 0.5
    return {
      yaw: t * Math.PI * 2 + ((i * 13) % 7) * 0.09,
      pitch: 0.5 + ((i * 11) % 4) * 0.11,
      width: 0.3 * grow,
      height: height * grow,
      originY: 0.03,
      originR: 0.035,
      cup: 0.18,
      droop: -0.16 * grow,
      depth: 0.5,
      columns: 2,
      rows: 3,
      round: 0.5,
    }
  })
}

/** Upright spray of big glossy blades — the reference image's dark foreground. */
export function broadLeafBush(cards = 5, height = 0.72): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => {
    const t = i / cards
    const grow = 0.68 + ((i * 5) % 4) / 4 * 0.55
    return {
      yaw: t * Math.PI * 2 + ((i * 17) % 6) * 0.11,
      pitch: 0.22 + ((i * 7) % 5) * 0.075,
      width: 0.46 * grow,
      height: height * grow,
      originY: 0.02,
      originR: 0.02,
      cup: 0.22,
      droop: -0.1 * grow,
      depth: i < 2 ? 0.62 : 0.3,
      columns: 2,
      rows: 3,
      round: 0.7,
    }
  })
}

/**
 * Trailing sprig for the coping spill: cards pitched past horizontal so the
 * planting breaks the hard white line of the wall, exactly as it does in the
 * reference image. The caller aims `yaw` outward.
 */
export function trailingSprig(cards = 3, length = 0.36): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => ({
    yaw: (i - (cards - 1) / 2) * 0.42,
    // Past horizontal on purpose: at 86-108 degrees the tips fall DOWN the
    // wall face. Anything under 90 degrees just lies on top of the coping.
    pitch: 1.62 + i * 0.18,
    width: 0.22,
    height: length * (0.78 + ((i * 7) % 4) / 4 * 0.44),
    originY: 0.02,
    originR: 0.01,
    cup: 0.14,
    droop: 0.13,
    depth: 0.2,
    columns: 2,
    rows: 3,
    round: 0.5,
  }))
}

/** Sparse flowering accent — three stems, nothing more. Green is rationed. */
export function flowerSpray(cards = 3, height = 0.4): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => ({
    yaw: (i / cards) * Math.PI * 2 + 0.7,
    pitch: 0.16 + ((i * 5) % 3) * 0.1,
    width: 0.28,
    height: height * (0.85 + ((i * 13) % 4) / 4 * 0.35),
    originY: 0.01,
    originR: 0.015,
    cup: 0.08,
    depth: 0.15,
    columns: 2,
    rows: 2,
    round: 0.4,
  }))
}

/** A hydroponic salad head: a tight upright cluster on a tray. */
export function cropHead(cards = 3, height = 0.24): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => ({
    yaw: (i / cards) * Math.PI * 1.05 + 0.3,
    pitch: 0.1 + ((i * 5) % 3) * 0.09,
    width: 0.24,
    height: height * (0.85 + ((i * 11) % 4) / 4 * 0.3),
    originY: 0.005,
    originR: 0.012,
    cup: 0.2,
    droop: -0.03,
    depth: i === 0 ? 0.55 : 0.25,
    columns: 2,
    rows: 2,
    round: 0.6,
  }))
}

/** One bough of needle sprays for the dwarf pine's whorls. */
export function pineBough(cards = 3, length = 0.5): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => ({
    yaw: (i - (cards - 1) / 2) * 0.5,
    pitch: 1.05 + ((i * 7) % 3) * 0.12,
    width: 0.3,
    height: length,
    originY: 0,
    originR: 0.02,
    cup: 0.1,
    droop: 0.07,
    depth: 0.35,
    columns: 2,
    rows: 2,
    round: 0.45,
  }))
}

// ─────────────────────────────────────────────────────────── instancing ──

/**
 * One species, one draw. Transforms accumulate through the whole park build
 * and land as a single `InstancedMesh` — the density in the reference image is
 * only affordable because nothing here is a per-plant object.
 */
export class SpeciesInstances {
  private readonly transforms: Matrix4[] = []
  private readonly quaternion = new Quaternion()
  private readonly euler = new Euler()
  private readonly scaleVector = new Vector3()

  readonly name: string
  private readonly geometry: BufferGeometry
  private readonly material: Material
  private readonly castShadow: boolean

  constructor(name: string, geometry: BufferGeometry, material: Material, castShadow = true) {
    this.name = name
    this.geometry = geometry
    this.material = material
    this.castShadow = castShadow
  }

  get count(): number {
    return this.transforms.length
  }

  add(position: Vector3, yaw: number, scale: number, tiltX = 0, tiltZ = 0): void {
    this.euler.set(tiltX, yaw, tiltZ, 'YXZ')
    this.quaternion.setFromEuler(this.euler)
    this.scaleVector.setScalar(scale)
    const matrix = new Matrix4().compose(position, this.quaternion, this.scaleVector)
    this.transforms.push(matrix)
  }

  /** Non-uniform variant: real plants are not scaled copies of one plant. */
  addStretched(position: Vector3, yaw: number, scale: Vector3, tiltX = 0, tiltZ = 0): void {
    this.euler.set(tiltX, yaw, tiltZ, 'YXZ')
    this.quaternion.setFromEuler(this.euler)
    const matrix = new Matrix4().compose(position, this.quaternion, scale)
    this.transforms.push(matrix)
  }

  build(): InstancedMesh | null {
    if (this.transforms.length === 0) return null
    const mesh = new InstancedMesh(this.geometry, this.material, this.transforms.length)
    this.transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = this.castShadow
    mesh.receiveShadow = true
    mesh.name = `vegetation-${this.name}`
    // The park is static: a frustum test against a park-wide instance cloud
    // never culls anything, so skip it rather than pay for the bounds walk.
    mesh.frustumCulled = false
    return mesh
  }
}
