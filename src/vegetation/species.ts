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
 *     with a HAND-AUTHORED hemispherical normal `(sin, 0.34, cos)`, so a
 *     cluster lights like a soft mound instead of five flat fins. Lifted from
 *     the stylized-meadow-grass system; it is the reason close-range grass
 *     reads as grass and not as cardboard.
 *   • `buildPlant()` — cupped alpha cards for anything with a leaf shape too
 *     complex to model (ferns, broadleaf, flowers, ginkgo sprays, needles).
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
    const normal = new Vector3(sin, 0.34, cos).normalize()
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
        this.indices.push(a, c, b, b, c, d)
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

/** Low mat: cards laid nearly flat, filling the soil between the heroes. */
export function groundcoverMat(cards = 4, height = 0.2): CardSpec[] {
  return Array.from({ length: cards }, (_, i) => {
    const t = i / cards
    return {
      yaw: t * Math.PI * 2 + 0.4,
      pitch: 0.85 + ((i * 3) % 3) * 0.12,
      width: 0.34,
      height: height * (0.8 + ((i * 11) % 5) / 5 * 0.5),
      originY: 0.015,
      originR: 0.03,
      cup: 0.1,
      droop: 0.04,
      depth: 0.45,
      columns: 2,
      rows: 2,
      round: 0.42,
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
