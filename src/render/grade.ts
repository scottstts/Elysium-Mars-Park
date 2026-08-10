import {
  ClampToEdgeWrapping,
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import {
  clamp,
  float,
  fract,
  screenCoordinate,
  screenUV,
  smoothstep,
  texture3D,
  uniform,
  vec4,
} from 'three/tsl'

type AnyNode = object
const asColor = (node: AnyNode) => node as ReturnType<typeof vec4>
const LUT_SIZE = 32

/**
 * Final calibrated controls. Exposure is a fixed authored EV — the frozen
 * afternoon never changes, so there is no meter and no adaptation.
 */
export const gradeParams = {
  /**
   * Authored, not metered. +0.15 EV is where the sky palette above lands on
   * the reference samples through Neutral + this LUT; it is NOT a free dial.
   * Moving it moves the whole palette match.
   */
  exposureEV: uniform(0.15),
  lutIntensity: uniform(1),
  vignette: uniform(0.12),
  /** Output dither amplitude in 8-bit code values (0 disables). */
  dither: uniform(1),
}

/* ── The recipe ──────────────────────────────────────────────────────────
 *
 * Target: ref_images/mars_park.png at dusk — rich rust/terracotta midtones,
 * warm highlights that stay warm instead of blowing to paper white, and
 * shade that is LIFTED but COOL, so the warm artificial layer has something
 * to read against.
 *
 * The trap this replaces: the S4 grade was a global lift + gain + a vibrance
 * term that boosted LOW-chroma colours. On a world where every surface is
 * already in the red-orange family, boosting near-neutrals pulls the steel,
 * the concrete and the sky toward the same ochre as the regolith — and the
 * result reads as one flat tan. Chroma SEPARATION, not chroma amount, is the
 * thing to protect: neutral steel must stay neutral while rust gets richer.
 * So there is no low-chroma vibrance here at all, only a straight saturation
 * gain plus the green protection that keeps the rare vegetation precious.
 *
 * Stage order (display domain, input already tone-mapped to [0,1]):
 *   1. black lift with a cool tint, white point
 *   2. pre-gamma (moves the S-curve pivot down to ~0.44 without clipping)
 *   3. bounded S-curve contrast
 *   4. tonal weights from post-curve luma
 *   5. shadow (cool) / midtone (rust) / highlight (warm) channel gains
 *   6. saturation with green protection
 *
 * These constants MUST stay above `marsLutTexture`: the bake runs at module
 * load and reads every one of them, so declaring them below is a temporal
 * dead-zone crash at boot ("Cannot access 'WHITE_POINT' before initialization").
 */

/** Cool-neutral floor for dusk shade; per-channel, not a scalar lift. */
const BLACK_LIFT = [0.0132, 0.015, 0.0192] as const
/** Slight white-point pull so warm highlights reach full white a touch later. */
const WHITE_POINT = 0.985
/** <1 brightens mids, which effectively lowers the S-curve pivot to ~0.44. */
const PRE_GAMMA = 0.95
/** Bounded S-curve blend. Higher than the S4 grade: the reference has snap. */
const S_AMOUNT = 0.3
const SHADOW_GAIN = [0.965, 0.995, 1.075] as const
const MIDTONE_GAIN = [1.03, 0.998, 0.955] as const
const HIGHLIGHT_GAIN = [1.032, 1.005, 0.955] as const
const SHADOW_STRENGTH = 0.9
const MIDTONE_STRENGTH = 0.85
const HIGHLIGHT_STRENGTH = 0.7
/**
 * 1.10, not the 1.16 the first pass tried. Above ~1.12 the rust band starts
 * to separate from the sky by hue rather than by value and the frame reads
 * poster-like; the reference's chroma at the horizon measures ≈ 0.32 and this
 * lands ≈ 0.39 with the shipped sky palette, which is the right side of it.
 */
const SATURATION = 1.1
/** Extra saturation for green-dominant colours (design pillar 2). */
const GREEN_PROTECT = 1.0

export const marsLutTexture = createMarsLutTexture()

/**
 * Post-tonemap 32³ Mars grade, a spatial vignette, and output dithering
 * (neither can live in a LUT).
 *
 * The dither is not optional polish. The Mars sky is an enormous smooth
 * gradient covering most of every outward frame; at 8-bit output that is a
 * textbook banding surface, and a LUT that adds contrast makes it worse. One
 * LSB of triangular-PDF noise removes the contours entirely and is invisible.
 */
export function marsGrade(inputColor: AnyNode) {
  const input = clamp(asColor(inputColor), 0, 1)
  const graded = lut3D(
    input,
    texture3D(marsLutTexture),
    LUT_SIZE,
    gradeParams.lutIntensity,
  ) as unknown as ReturnType<typeof vec4>
  const centered = screenUV.sub(0.5)
  const falloff = smoothstep(0.4, 0.95, centered.length().mul(1.32))
  const vignetted = graded.rgb.mul(float(1).sub(falloff.mul(gradeParams.vignette)))

  // Interleaved-gradient noise, two decorrelated taps summed to a triangular
  // PDF. Screen-stable (no temporal shimmer) and free of the low-frequency
  // structure a plain sin-hash leaves in big flat gradients.
  const ign = (x: AnyNode, y: AnyNode) => {
    const fx = x as ReturnType<typeof float>
    const fy = y as ReturnType<typeof float>
    return fract(fx.mul(0.06711056).add(fy.mul(0.00583715)).fract().mul(52.9829189))
  }
  const px = screenCoordinate.x
  const py = screenCoordinate.y
  const noise = ign(px, py).add(ign(px.add(5.588238), py.add(7.1234))).sub(1)
  const dithered = vignetted.add(noise.mul(gradeParams.dither).mul(1 / 255))

  return vec4(dithered.clamp(0, 1), float(1))
}

function createMarsLutTexture(): Data3DTexture {
  const data = new Uint8Array(LUT_SIZE ** 3 * 4)
  let offset = 0
  for (let b = 0; b < LUT_SIZE; b++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      for (let r = 0; r < LUT_SIZE; r++) {
        const graded = gradeSample([
          r / (LUT_SIZE - 1),
          g / (LUT_SIZE - 1),
          b / (LUT_SIZE - 1),
        ])
        data[offset++] = Math.round(graded[0] * 255)
        data[offset++] = Math.round(graded[1] * 255)
        data[offset++] = Math.round(graded[2] * 255)
        data[offset++] = 255
      }
    }
  }
  const texture = new Data3DTexture(data, LUT_SIZE, LUT_SIZE, LUT_SIZE)
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.wrapR = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.name = 'marsGrade32'
  return texture
}

function gradeSample(color: [number, number, number]): [number, number, number] {
  // 1 — black lift (cool) + white point.
  const normalized = color.map((channel, index) =>
    clampCpu((channel * WHITE_POINT + BLACK_LIFT[index] * (1 - channel)) / WHITE_POINT),
  ) as [number, number, number]

  // 2/3 — pre-gamma, then a bounded S-curve (smoothstep blended by amount,
  // so the result can never leave [0,1] and highlights cannot clip).
  const shaped = normalized.map((channel) => {
    const x = Math.pow(channel, PRE_GAMMA)
    const s = x * x * (3 - 2 * x)
    return x + (s - x) * S_AMOUNT
  }) as [number, number, number]

  // 4 — tonal weights from the SHAPED luma (so the tints follow the contrast
  // the viewer actually sees, not the pre-curve values).
  const luma = shaped[0] * 0.2126 + shaped[1] * 0.7152 + shaped[2] * 0.0722
  const shadowWeight = 1 - smoothstepCpu(0.1, 0.52, luma)
  const highlightWeight = smoothstepCpu(0.5, 0.94, luma)
  const midtoneWeight = Math.max(0, 1 - Math.abs(luma - 0.5) * 2)

  // 5 — three independent tints. A single global lift/gain (the S4 approach)
  // cannot express "warm highlights over cool shade"; this can.
  const tinted = shaped.map((channel, index) => {
    const shadow = 1 + shadowWeight * SHADOW_STRENGTH * (SHADOW_GAIN[index] - 1)
    const midtone = 1 + midtoneWeight * MIDTONE_STRENGTH * (MIDTONE_GAIN[index] - 1)
    const highlight = 1 + highlightWeight * HIGHLIGHT_STRENGTH * (HIGHLIGHT_GAIN[index] - 1)
    return channel * shadow * midtone * highlight
  }) as [number, number, number]

  // 6 — saturation about luminance, with green dominance protected.
  const tintedLuma = tinted[0] * 0.2126 + tinted[1] * 0.7152 + tinted[2] * 0.0722
  const greenDominance = Math.max(0, tinted[1] - Math.max(tinted[0], tinted[2]))
  const saturation = SATURATION + GREEN_PROTECT * greenDominance
  return tinted.map((channel) =>
    clampCpu(tintedLuma + (channel - tintedLuma) * saturation),
  ) as [number, number, number]
}

function smoothstepCpu(edge0: number, edge1: number, value: number): number {
  const t = clampCpu((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function clampCpu(value: number): number {
  return Math.max(0, Math.min(1, value))
}
