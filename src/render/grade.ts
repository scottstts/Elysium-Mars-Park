import {
  ClampToEdgeWrapping,
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { clamp, float, screenUV, smoothstep, texture3D, uniform, vec4 } from 'three/tsl'

type AnyNode = object
const asColor = (node: AnyNode) => node as ReturnType<typeof vec4>
const LUT_SIZE = 32

/**
 * Final calibrated controls. Exposure is a fixed authored EV — the frozen
 * afternoon never changes, so there is no meter and no adaptation.
 */
export const gradeParams = {
  exposureEV: uniform(0),
  lutIntensity: uniform(1),
  vignette: uniform(0.1),
}

export const marsLutTexture = createMarsLutTexture()

/** Post-tonemap 32³ Mars grade plus a spatial vignette (can't live in a LUT). */
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
  return vec4(vignetted.clamp(0, 1), float(1))
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

/**
 * The Mars look, baked once:
 * - Warm shadow lift — skylight on Mars is butterscotch, so shadow fill goes
 *   warm brown, never Earth-blue. This is the single most "Mars" grading move.
 * - Gentle red gain / blue pull toward the dusty palette.
 * - Protected greens: green-dominant colors get extra vibrance so the rare
 *   vegetation reads precious against the ochre world (design pillar 2).
 */
function gradeSample(color: [number, number, number]): [number, number, number] {
  const lift = [0.024, 0.013, 0.007] as const
  const gain = [1.035, 0.998, 0.952] as const
  const balanced = color.map(
    (channel, index) => channel * gain[index] + lift[index] * (1 - channel),
  ) as [number, number, number]
  const luminance = balanced[0] * 0.2126 + balanced[1] * 0.7152 + balanced[2] * 0.0722
  const saturation = Math.max(...balanced) - Math.min(...balanced)
  const greenDominance = Math.max(0, balanced[1] - Math.max(balanced[0], balanced[2]))
  const vibrance = 1 + 0.13 * (1 - saturation) + 1.1 * greenDominance
  return balanced.map((channel) =>
    clampCpu(luminance + (channel - luminance) * vibrance),
  ) as [number, number, number]
}

function clampCpu(value: number): number {
  return Math.max(0, Math.min(1, value))
}
