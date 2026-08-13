import { BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, Quaternion, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  abs,
  float,
  mix,
  pow,
  positionLocal,
  positionViewDirection,
  saturate,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { sunColorUniform, sunDirectionUniform } from '../sky/sun'
import { detailKeep, floatAttribute, foliageWind } from './foliageMaterial'

/**
 * EDIBLE CROPS — real modelled vegetables for the glasshouse benches and the
 * hydroponics tower.
 *
 * These used to be `cropHead()`: three alpha cards carrying a painted bush,
 * which at bench distance (the walkable range puts a guest 0.6 m from a tray)
 * reads as three flat angular blobs, not as food. Everything here is GEOMETRY:
 * a leaf is a real tapered blade with a petiole, a cupped section, a ruffled
 * margin and an arching centreline, and a head is a rosette of them.
 *
 * Three things do the work, and none of them is polygon count:
 *
 *  - **A width profile with a petiole.** `sin(pi t^k)` peaking at the blade's
 *    belly, floored at the stalk width below it. That one curve is the whole
 *    difference between a leaf and a rectangle.
 *  - **A ruffled margin.** Out-of-plane displacement weighted by `(2u-1)^2`,
 *    so the centre stays flat and the EDGE waves. This is what makes a lettuce
 *    read as a lettuce rather than as a green flower.
 *  - **Rounded normals.** The card system's trick, kept: a leaf's normal is
 *    its face normal pushed outward by the vertex's offset from the plant's
 *    axis, so a head lights as a ball instead of as a fan of flats.
 *
 * Two baked attributes carry the shading contract: `aDepth` (0 outside the
 * head, 1 buried in its heart) and `aPale` (1 on the blanched stalk, 0 on the
 * green blade). `uv.y` is root-to-tip and `uv.x` is across, so the midrib is
 * derived, never baked.
 */

export interface LeafSpec {
  length: number
  /** Full width at the blade's widest point. */
  width: number
  /** Where along the blade it is widest, 0…1. */
  belly?: number
  /** Fraction of the length that is bare stalk. */
  petiole?: number
  /** Stalk width; the blade's profile is floored at it. */
  stalk?: number
  /** Curl of the section toward the leaf's face, as a fraction of width. */
  cup?: number
  /** Metres the tip travels out of the leaf's plane (negative = falls back). */
  arch?: number
  /** Margin ruffle, as a fraction of the half width. */
  crinkle?: number
  crinkleWaves?: number
  /** 0 outside the head, 1 in its heart. */
  depth?: number
  columns?: number
  rows?: number
  /** How hard the rounded normal bends away from the leaf plane. */
  round?: number
  /** Ruffle phase, so two leaves never wave identically. */
  phase?: number
}

export interface LeafPlacement extends LeafSpec {
  /** Rotation about the plant's axis. */
  yaw: number
  /** Lean from vertical: 0 upright, pi/2 flat. */
  pitch: number
  roll?: number
  /** Attachment height on the axis. */
  originY?: number
  /** Attachment distance out from the axis. */
  originR?: number
}

const scratchQuaternion = new Quaternion()
const scratchEuler = new Euler()
const scratchVertex = new Vector3()
const scratchNormal = new Vector3()
const scratchOffset = new Vector3()

class LeafSink {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly depths: number[] = []
  private readonly pales: number[] = []
  private readonly indices: number[] = []

  get triangleCount(): number {
    return this.indices.length / 3
  }

  push(origin: Vector3, quaternion: Quaternion, spec: LeafSpec): void {
    const {
      length,
      width,
      belly = 0.5,
      petiole = 0.12,
      stalk = width * 0.16,
      cup = 0.28,
      arch = -0.15,
      crinkle = 0.22,
      crinkleWaves = 3,
      depth = 0,
      columns = 2,
      rows = 3,
      round = 0.7,
      phase = 0,
    } = spec

    // Exponent that puts the peak of `sin(pi t^k)` at `belly`.
    const k = Math.log(0.5) / Math.log(Math.max(0.08, Math.min(0.92, belly)))
    const base = this.positions.length / 3

    for (let row = 0; row <= rows; row++) {
      const v = row / rows
      const bladeT = Math.max(0, (v - petiole) / (1 - petiole))
      const profile = v <= petiole ? 0 : Math.sin(Math.PI * Math.pow(bladeT, k))
      // The stalk keeps a little width of its own so a chard petiole reads.
      const halfWidth = Math.max(stalk * 0.5, width * 0.5 * profile)
      // Cup and ruffle scale with the LOCAL width, never the maximum. Against
      // the maximum, a leaf whose stalk is 15 mm across still got ±80 mm of
      // ruffle there — the petiole fanned open and the outer whorl's margins
      // dropped 56 mm below the tray the head stands on.
      const localWidth = halfWidth * 2
      for (let column = 0; column <= columns; column++) {
        const u = column / columns
        const across = (u - 0.5) * 2 // −1 … 1
        const edge = across * across
        // Cup: the section curls toward the face; the ruffle lives on the
        // margin only, which is why `edge` weights it.
        const bulge = cup * localWidth * (1 - edge) * (0.25 + bladeT * 0.75)
        const ruffle =
          crinkle * localWidth * edge * Math.sin(crinkleWaves * Math.PI * v + phase + across * 1.7)
        const fall = arch * v * v
        scratchVertex.set(across * halfWidth, v * length, bulge + ruffle + fall)
        scratchVertex.applyQuaternion(quaternion)
        scratchOffset.copy(scratchVertex)
        scratchVertex.add(origin)

        scratchNormal.set(0, 0, 1).applyQuaternion(quaternion)
        if (scratchOffset.lengthSq() > 1e-12) {
          scratchNormal.addScaledVector(scratchOffset.normalize(), round)
        }
        if (scratchNormal.lengthSq() < 1e-10) scratchNormal.set(0, 1, 0)
        scratchNormal.normalize()

        this.positions.push(scratchVertex.x, scratchVertex.y, scratchVertex.z)
        this.normals.push(scratchNormal.x, scratchNormal.y, scratchNormal.z)
        this.uvs.push(u, v)
        this.depths.push(Math.max(0, depth * (1 - v * 0.7)))
        // Blanched stalk, fading out just above the petiole.
        this.pales.push(Math.max(0, 1 - Math.max(0, v - petiole) / 0.16))
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
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('aDepth', new Float32BufferAttribute(this.depths, 1))
    geometry.setAttribute('aPale', new Float32BufferAttribute(this.pales, 1))
    geometry.setIndex(this.indices)
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** Assemble a head from leaf placements. Rooted at the origin, +Y up. */
export function buildVegetable(leaves: LeafPlacement[]): BufferGeometry {
  const sink = new LeafSink()
  const origin = new Vector3()
  for (const leaf of leaves) {
    const { yaw, pitch, roll = 0, originY = 0, originR = 0 } = leaf
    scratchEuler.set(pitch, yaw, roll, 'YXZ')
    scratchQuaternion.setFromEuler(scratchEuler)
    origin.set(Math.sin(yaw) * originR, originY, Math.cos(yaw) * originR)
    sink.push(origin, scratchQuaternion, leaf)
  }
  return sink.build()
}

// ────────────────────────────────────────────────────────────── recipes ──
//
// The golden angle spaces whorls without the mechanical look of `i / n`, and
// it is what a real rosette actually does.

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * Butterhead lettuce: an open outer whorl over a cupped heart. The classic
 * bench crop, and the one a guest gets closest to.
 */
export function butterheadLettuce(height = 0.2): LeafPlacement[] {
  const out: LeafPlacement[] = []
  // Spread is a CONTRACT with the bench: trays plant on a 0.3 m pitch, so a
  // mature head has to finish around 0.30–0.32 m across — just touching its
  // neighbours, which is what a full bench looks like — not the 0.46 m the
  // first pass reached, where every head grew through the two beside it.
  const whorls = [
    { count: 5, pitch: 0.88, scale: 1.0, depth: 0.0, originY: 0.006 },
    { count: 4, pitch: 0.62, scale: 0.78, depth: 0.35, originY: 0.016 },
    { count: 2, pitch: 0.3, scale: 0.52, depth: 0.72, originY: 0.028 },
  ]
  let index = 0
  for (const whorl of whorls) {
    for (let i = 0; i < whorl.count; i++) {
      const grow = 0.86 + ((index * 7) % 5) / 5 * 0.28
      out.push({
        yaw: index * GOLDEN,
        pitch: whorl.pitch + ((index * 5) % 3) * 0.07,
        roll: ((index * 11) % 5) / 5 * 0.24 - 0.12,
        length: height * whorl.scale * grow * 1.12,
        width: height * whorl.scale * grow * 1.24,
        belly: 0.56,
        petiole: 0.16,
        stalk: height * 0.09,
        cup: 0.34,
        arch: -height * 0.28 * whorl.scale,
        crinkle: 0.3,
        crinkleWaves: 3,
        depth: whorl.depth,
        originY: whorl.originY,
        originR: height * 0.05,
        columns: 2,
        rows: 3,
        round: 0.85,
        phase: index * 1.31,
      })
      index++
    }
  }
  return out
}

/** Romaine: tall, upright, narrow blades standing in a tight column. */
export function romaineLettuce(height = 0.24): LeafPlacement[] {
  const out: LeafPlacement[] = []
  for (let i = 0; i < 9; i++) {
    const ring = i < 5 ? 0 : 1
    const grow = 0.82 + ((i * 13) % 6) / 6 * 0.34
    out.push({
      yaw: i * GOLDEN,
      pitch: (ring === 0 ? 0.46 : 0.2) + ((i * 7) % 4) * 0.05,
      roll: ((i * 5) % 7) / 7 * 0.3 - 0.15,
      length: height * (ring === 0 ? 1 : 0.76) * grow,
      width: height * 0.5 * grow,
      belly: 0.66,
      petiole: 0.2,
      stalk: height * 0.1,
      cup: 0.42,
      arch: -height * 0.1,
      crinkle: 0.16,
      crinkleWaves: 4,
      depth: ring === 0 ? 0.1 : 0.62,
      originY: 0.008 + ring * 0.02,
      originR: height * 0.035,
      columns: 2,
      rows: 3,
      round: 0.7,
      phase: i * 0.87,
    })
  }
  return out
}

/**
 * Swiss chard: long blanched petioles carrying big crinkled blades. The
 * petiole is the identity, so the width profile floors hard and the pale
 * attribute reaches high up the stalk.
 */
export function swissChard(height = 0.25): LeafPlacement[] {
  const out: LeafPlacement[] = []
  for (let i = 0; i < 6; i++) {
    const grow = 0.8 + ((i * 11) % 5) / 5 * 0.4
    out.push({
      yaw: i * GOLDEN,
      pitch: 0.3 + ((i * 7) % 4) * 0.13,
      roll: ((i * 13) % 5) / 5 * 0.36 - 0.18,
      length: height * grow,
      width: height * 0.62 * grow,
      belly: 0.68,
      petiole: 0.38,
      stalk: height * 0.075,
      cup: 0.3,
      arch: -height * 0.22,
      crinkle: 0.4,
      crinkleWaves: 4,
      depth: i < 2 ? 0.5 : 0.08,
      originY: 0.01,
      originR: height * 0.03,
      columns: 2,
      rows: 4,
      round: 0.72,
      phase: i * 2.11,
    })
  }
  return out
}

/** Pak choi: a squat spoon-leaved cluster with thick blanched bases. */
export function pakChoi(height = 0.17): LeafPlacement[] {
  const out: LeafPlacement[] = []
  for (let i = 0; i < 8; i++) {
    const ring = i < 5 ? 0 : 1
    const grow = 0.84 + ((i * 17) % 4) / 4 * 0.3
    out.push({
      yaw: i * GOLDEN,
      pitch: (ring === 0 ? 0.66 : 0.28) + ((i * 5) % 3) * 0.08,
      roll: ((i * 7) % 5) / 5 * 0.26 - 0.13,
      length: height * (ring === 0 ? 1.15 : 0.85) * grow,
      width: height * 0.78 * grow,
      belly: 0.72,
      petiole: 0.3,
      stalk: height * 0.16,
      cup: 0.5,
      arch: -height * 0.16,
      crinkle: 0.14,
      crinkleWaves: 2,
      depth: ring === 0 ? 0.12 : 0.6,
      originY: 0.006,
      originR: height * 0.05,
      columns: 2,
      rows: 3,
      round: 0.8,
      phase: i * 1.61,
    })
  }
  return out
}

/** Seedling: two cotyledons and a first true leaf, for a propagation tray. */
export function cropSeedling(height = 0.055): LeafPlacement[] {
  const out: LeafPlacement[] = []
  for (let i = 0; i < 4; i++) {
    out.push({
      yaw: i * GOLDEN,
      pitch: 1.2 - (i % 2) * 0.5,
      length: height * (i < 2 ? 1 : 0.7),
      width: height * (i < 2 ? 0.72 : 0.5),
      belly: 0.6,
      petiole: 0.34,
      stalk: height * 0.12,
      cup: 0.2,
      arch: -height * 0.1,
      crinkle: 0.08,
      crinkleWaves: 2,
      depth: 0,
      originY: height * 0.25,
      originR: height * 0.04,
      columns: 1,
      rows: 2,
      round: 0.6,
      phase: i * 0.9,
    })
  }
  return out
}

/** Every modelled variety. */
export const CROP_VARIETIES = ['butterhead', 'romaine', 'chard', 'pakchoi'] as const
export type CropVariety = (typeof CROP_VARIETIES)[number]

/** The three the benches mix freely; chard is placed by growth stage. */
export const LEAFY_VARIETIES: CropVariety[] = ['butterhead', 'romaine', 'pakchoi']

const geometryCache = new Map<string, BufferGeometry>()

/** Memoised geometry per variety — every bench shares one buffer. */
export function vegetableGeometry(variety: CropVariety | 'seedling', height?: number): BufferGeometry {
  const key = `${variety}:${height ?? 'default'}`
  const hit = geometryCache.get(key)
  if (hit) return hit
  const built = buildVegetable(
    variety === 'butterhead'
      ? butterheadLettuce(height)
      : variety === 'romaine'
        ? romaineLettuce(height)
        : variety === 'chard'
          ? swissChard(height)
          : variety === 'pakchoi'
            ? pakChoi(height)
            : cropSeedling(height),
  )
  geometryCache.set(key, built)
  return built
}

// ───────────────────────────────────────────────────────────── material ──

const TAU = Math.PI * 2

export interface CropMaterialOptions {
  /** Per-instance random in [0,1): tint spread + sway phase. */
  seed: Node<'float'>
  /** Blade colour at the petiole. */
  rootColor?: Color
  /** Blade colour at the tip. */
  tipColor?: Color
  /** Second colour pair, selected per instance — a bench is never one green. */
  rootColorAlt?: Color
  tipColorAlt?: Color
  /** Blanched stalk / midrib. */
  paleColor?: Color
  transmit?: Color
  backlight?: number
  sway?: number
  far?: number
}

/**
 * Crop leaf response. No map, no alpha test — the silhouette is real geometry,
 * so the shadow pass gets it for free and there is no cut-out contract to
 * honour (`foliageMaterial`'s r185 rules only bind alpha-cut cards).
 *
 * Colour has three named causes, all derived rather than baked: root-to-tip
 * along `uv.y`, the blanched stalk from `aPale`, and the midrib from the
 * distance to `uv.x = 0.5`. Interior leaves darken by `aDepth`, which is the
 * cheapest self-occlusion there is and the reason a head reads as solid.
 */
export function createCropMaterial(options: CropMaterialOptions): MeshStandardNodeMaterial {
  const {
    seed,
    rootColor = new Color(0.076, 0.132, 0.05),
    tipColor = new Color(0.2, 0.34, 0.086),
    rootColorAlt = new Color(0.062, 0.116, 0.046),
    tipColorAlt = new Color(0.146, 0.29, 0.096),
    paleColor = new Color(0.55, 0.6, 0.36),
    transmit = new Color(0.36, 0.56, 0.16),
    backlight = 0.62,
    sway = 0.006,
    far = 26,
  } = options

  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(far)
  const depth = floatAttribute('aDepth')
  const pale = floatAttribute('aPale')
  const along = uv().y
  const across = abs(uv().x.sub(0.5)).mul(2)

  const root = mix(
    vec3(rootColor.r, rootColor.g, rootColor.b),
    vec3(rootColorAlt.r, rootColorAlt.g, rootColorAlt.b),
    seed,
  )
  const tip = mix(
    vec3(tipColor.r, tipColor.g, tipColor.b),
    vec3(tipColorAlt.r, tipColorAlt.g, tipColorAlt.b),
    seed,
  )
  const blade = mix(root, tip, pow(along, 0.85))
  // Midrib: a pale spine that fades out toward the tip, plus the blanched
  // stalk. Both reach for the same colour, which is what a petiole IS.
  const rib = smoothstep(0.19, 0.02, across).mul(float(1).sub(along).mul(0.7).add(0.1))
  const paleness = saturate(pale.mul(0.9).add(rib.mul(0.55)))
  const body = mix(blade, vec3(paleColor.r, paleColor.g, paleColor.b), paleness)
  // Interior leaves sit in the head's own shade.
  const occlusion = float(1).sub(depth.mul(0.55))
  material.colorNode = vec4(body.mul(occlusion).mul(seed.mul(0.16).add(0.92)), 1)

  const back = pow(saturate(positionViewDirection.negate().dot(sunDirectionUniform)), 2.4)
  material.emissiveNode = vec3(transmit.r, transmit.g, transmit.b)
    .mul(sunColorUniform)
    .mul(back)
    .mul(float(1).sub(depth.mul(0.85)))
    .mul(pow(along, 1.2))
    .mul(backlight)

  // Gentle rooted sway in the HVAC air; the attachment never moves.
  const phase = seed.mul(TAU)
  const t = time.mul(0.8)
  const swing = sin(t.mul(0.61).add(phase))
    .mul(0.6)
    .add(sin(t.mul(1.13).add(phase.mul(1.37))).mul(0.4))
  const amplitude = float(sway).mul(foliageWind).mul(pow(along, 1.6)).mul(keep.mul(0.6).add(0.4))
  material.positionNode = positionLocal.add(
    vec3(swing.mul(amplitude), swing.mul(amplitude).mul(-0.2), swing.mul(amplitude).mul(0.5)),
  )

  material.side = DoubleSide
  material.roughness = 0.72
  material.metalness = 0
  return material
}
