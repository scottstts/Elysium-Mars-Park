import { CanvasTexture, DoubleSide, SRGBColorSpace } from 'three'
import type { Material } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  float,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  positionLocal,
  positionViewDirection,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { applySpecularAA } from '../materials/library'

/**
 * THE LOOP's material set. Every procedural field samples `positionLocal`,
 * never world position: the car moves, and a world-space pattern crawls
 * across a moving hull (experience-craft §5.4). The park's shared
 * `kitMaterials()` are all world-space, so the tram deliberately owns its own
 * bundle.
 *
 * Emissive rungs follow the ladder in `world/lightFixtures.ts` — pick by
 * ROLE, scale AREA not multiplier:
 *   headlamp lenses   5.0  (utilityLight rung — tiny, must read at 60 m)
 *   tail lenses       2.6  (floorLens rung)
 *   cabin light cove  2.0  (interiorGlow rung — a long strip does the work)
 *   status screen     1.6
 */

const objNoise = (scale: number, offset = 0) =>
  mx_noise_float(positionLocal.mul(scale).add(offset)).mul(0.5).add(0.5)

/** 0 at the roof, 1 at the skirt — road film and hand grime live low. */
const lowGrime = smoothstep(0.9, -0.35, positionLocal.y)

/** White composite bodyside: micro-flake, orange peel, and honest use-wear. */
function bodyPaint(): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial()
  const panel = objNoise(0.42, 3.1) // slow panel-to-panel tone
  const peel = objNoise(34, 11.7) // orange peel in the clearcoat
  const flake = objNoise(190, 5.2) // metallic micro-flake
  const film = objNoise(2.6, 41.3)
  const base = mix(vec3(0.845, 0.842, 0.826), vec3(0.79, 0.783, 0.762), panel.mul(0.55))
  material.colorNode = mix(base, vec3(0.5, 0.47, 0.435), lowGrime.mul(film.mul(0.35).add(0.2)))
  material.roughnessNode = float(0.3)
    .add(peel.mul(0.05))
    .add(flake.mul(0.03))
    .add(lowGrime.mul(0.16))
  material.metalnessNode = flake.mul(0.1)
  material.clearcoat = 0.7
  material.clearcoatRoughnessNode = float(0.06).add(peel.mul(0.09)).add(lowGrime.mul(0.2))
  applySpecularAA(material)
  return material
}

/** Dark structural grey — underframe, bogie, roof pod, door tracks. */
function structuralGrey(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const cast = objNoise(3.4, 19.4)
  const dust = objNoise(0.9, 61.2)
  material.colorNode = mix(vec3(0.115, 0.114, 0.112), vec3(0.165, 0.158, 0.148), cast)
    .mul(dust.mul(0.22).add(0.86))
  material.roughnessNode = float(0.62).add(cast.mul(0.16))
  material.metalness = 0.35
  applySpecularAA(material)
  return material
}

/**
 * Bare alloy: extruded trim, rails, thresholds, seat frames. The brush
 * direction runs along the extrusion, but at a LOW frequency on purpose —
 * an anisotropic stripe fine enough to be "realistic" aliases into a moiré
 * on a 12 cm door strip long before it reads as brushed metal.
 */
function alloyTrim(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const brushed = mx_noise_float(vec2(positionLocal.z.mul(42), positionLocal.y.mul(6)))
    .mul(0.5)
    .add(0.5)
  const tarnish = objNoise(1.6, 88.4)
  material.colorNode = vec3(0.63, 0.635, 0.645)
    .mul(brushed.mul(0.055).add(0.955))
    .mul(tarnish.mul(0.1).add(0.92))
  material.metalness = 0.88
  material.roughnessNode = float(0.26).add(brushed.mul(0.07)).add(tarnish.mul(0.07))
  applySpecularAA(material)
  return material
}

/** Warm interior lining — the surface the player sits inside for minutes. */
function cabinLining(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const grain = objNoise(46, 7.7)
  const tone = objNoise(0.9, 23.1)
  material.colorNode = mix(vec3(0.7, 0.675, 0.63), vec3(0.62, 0.594, 0.55), tone.mul(0.6))
    .mul(grain.mul(0.07).add(0.955))
  material.roughnessNode = float(0.68).add(grain.mul(0.1))
  material.metalness = 0.02
  applySpecularAA(material)
  return material
}

/** Anti-slip cabin floor: studded rubber, worn along the walking line. */
function floorGrip(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const cell = positionLocal.xz.mul(16.6).fract().sub(0.5)
  const stud = float(1).sub(smoothstep(0.2, 0.31, cell.length()))
  const traffic = float(1).sub(smoothstep(0.0, 1.05, positionLocal.x.abs()))
  const speck = objNoise(30, 3.9)
  material.colorNode = mix(vec3(0.105, 0.103, 0.1), vec3(0.145, 0.14, 0.134), stud)
    .mul(speck.mul(0.16).add(0.9))
    .mul(traffic.mul(0.1).add(0.93))
  material.roughnessNode = float(0.93).sub(stud.mul(0.06)).sub(traffic.mul(0.07))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Cabin glazing: light tint, real Fresnel edge, genuinely see-through. */
function cabinGlazing(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const fresnel = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(3.4)
  const smear = objNoise(9, 66.2)
  material.colorNode = mix(vec3(0.36, 0.42, 0.44), vec3(0.6, 0.64, 0.66), fresnel)
  material.opacityNode = float(0.13).add(fresnel.mul(0.52)).add(smear.mul(0.03))
  material.roughnessNode = float(0.035).add(smear.mul(0.02))
  material.metalness = 0
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  return material
}

/** EPDM: door seals, glazing gaskets, tyres, bump strips. */
function rubberSeal(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const grain = objNoise(60, 13.3)
  material.colorNode = vec3(0.052, 0.052, 0.054).mul(grain.mul(0.3).add(0.85))
  material.roughnessNode = float(0.88).sub(grain.mul(0.1))
  material.metalness = 0
  return material
}

/** International-orange accent: the livery band and the grab rails. Rails
 *  are the polished variant — the one surface ten thousand palms burnish. */
function accentOrange(polished = false): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial()
  const wear = objNoise(7.5, 29.8)
  material.colorNode = mix(vec3(0.72, 0.215, 0.05), vec3(0.6, 0.19, 0.055), wear.mul(0.45))
  material.roughnessNode = float(polished ? 0.2 : 0.36)
    .add(wear.mul(0.1))
    .add(polished ? float(0) : lowGrime.mul(0.14))
  material.metalness = 0.06
  material.clearcoat = polished ? 0.85 : 0.45
  material.clearcoatRoughness = polished ? 0.08 : 0.2
  applySpecularAA(material)
  return material
}

/** Moulded seat shell — dark glass-filled polymer, slightly satin. Kept much
 *  darker than the moquette so shell and cushion never read as one blob. */
function seatShell(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const mould = objNoise(26, 44.6)
  material.colorNode = mix(vec3(0.055, 0.058, 0.064), vec3(0.088, 0.092, 0.1), mould)
  material.roughnessNode = float(0.4).add(mould.mul(0.16))
  material.metalness = 0.05
  applySpecularAA(material)
  return material
}

/** Moquette: the one soft thing on the vehicle. */
function seatCushion(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const weave = mx_noise_float(positionLocal.mul(vec3(150, 150, 52))).mul(0.5).add(0.5)
  const fade = objNoise(2.2, 71.5)
  material.colorNode = mix(vec3(0.145, 0.2, 0.3), vec3(0.36, 0.19, 0.12), fade.mul(0.42))
    .mul(weave.mul(0.2).add(0.91))
  material.roughnessNode = float(0.94).sub(weave.mul(0.05))
  material.metalness = 0
  return material
}

function emissiveLens(color: [number, number, number], gain: number, ripple: number) {
  const material = new MeshStandardNodeMaterial()
  const mottle = objNoise(ripple, 17.2).mul(0.16).add(0.92)
  material.colorNode = vec3(color[0] * 0.9, color[1] * 0.9, color[2] * 0.9)
  material.emissiveNode = vec3(color[0], color[1], color[2]).mul(mottle).mul(gain)
  material.roughness = 0.28
  material.metalness = 0
  return material
}

// ----------------------------------------------------------------- decals

function decalCanvas(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  width: number,
  height: number,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, width, height)
    draw(g, width, height)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Alpha-cut painted stencil — glyphs only, so the patch has no visible
 *  boundary against the bodyside it stands 3 mm proud of. */
function stencilMaterial(tex: CanvasTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const sampled = texture(tex, uv())
  material.colorNode = sampled.rgb
  material.opacityNode = sampled.a
  material.alphaTest = 0.42
  material.transparent = false
  material.roughness = 0.42
  material.metalness = 0.03
  return material
}

function liveryTexture(): CanvasTexture {
  return decalCanvas(
    (g, w, h) => {
      // Both lines are MEASURED into the margin box, never trusted to a
      // height-keyed size: raising this canvas 192 -> 310 for the aspect fix
      // scaled the h-keyed fonts 1.6x past the unchanged width, and canvas
      // text does not wrap — it clips at the bitmap edge, which shipped as
      // "ELYSIUM L" on every bodyside. One probe suffices per line because
      // measureText scales linearly with font size.
      const margin = w * 0.03
      const fitText = (weight: number, size: number, text: string): void => {
        const font = (px: number): string =>
          `${weight} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`
        // Probe and scale the SAME integer size, and floor the result —
        // rounding up after scaling put the fitted line a few px back over
        // the margin it was fitted to.
        const probe = Math.max(1, Math.round(size))
        g.font = font(probe)
        const measured = g.measureText(text).width
        const maxWidth = w - margin * 2
        if (measured > maxWidth) {
          g.font = font(Math.max(1, Math.floor((probe * maxWidth) / measured)))
        }
      }
      g.fillStyle = '#20211f'
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      const wordmark = 'E L Y S I U M   L O O P'
      fitText(700, h * 0.44, wordmark)
      g.fillText(wordmark, margin, h * 0.34)
      g.fillStyle = '#b8531e'
      g.fillRect(margin, h * 0.56, w * 0.62, h * 0.045)
      g.fillStyle = '#4a4844'
      const subline = 'AUTOMATED PEOPLE MOVER  ·  ELYSIUM PLANITIA PARK'
      fitText(500, h * 0.19, subline)
      g.fillText(subline, margin, h * 0.76)
    },
    // The patch this lands on (tramBody `decalPatch`, z 2.06->3.14 by section
    // 11.7->12.85) is 1.073 m by 0.325 m = aspect 3.30, matched at 1024x310.
    1024,
    310,
  )
}

function carNumberTexture(index: number): CanvasTexture {
  const label = `0${(index % 2) + 1}`
  return decalCanvas(
    (g, w, h) => {
      g.fillStyle = '#20211f'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = `700 ${Math.round(h * 0.62)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillText(label, w * 0.5, h * 0.42)
      g.fillStyle = '#b8531e'
      g.fillRect(w * 0.16, h * 0.78, w * 0.68, h * 0.07)
      g.fillStyle = '#54514c'
      g.font = `600 ${Math.round(h * 0.14)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillText('UNIT', w * 0.5, h * 0.93)
    },
    // Patch is 0.414 m by 0.2385 m = aspect 1.736; a square canvas stretched
    // the numerals 74 % wide, the worst aspect error in the project.
    256,
    147,
  )
}

/** Driverless status console: the only screen the player reads on board. */
function consoleScreen(): MeshStandardNodeMaterial {
  const tex = decalCanvas(
    (g, w, h) => {
      g.fillStyle = '#0a1416'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = 'rgba(120,220,230,0.22)'
      g.lineWidth = 2
      for (let i = 1; i < 6; i++) {
        g.beginPath()
        g.moveTo(0, (h * i) / 6)
        g.lineTo(w, (h * i) / 6)
        g.stroke()
      }
      g.fillStyle = '#8fe6ef'
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      g.font = `700 ${Math.round(h * 0.15)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillText('LOOP · NEXT  PORTAL', w * 0.06, h * 0.17)
      g.font = `500 ${Math.round(h * 0.1)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillStyle = '#cfeef2'
      g.fillText('AUTOMATIC  ·  ATO  ·  ATP OK', w * 0.06, h * 0.36)
      g.fillText('DOORS   LEFT', w * 0.06, h * 0.52)
      g.fillText('CABIN   20.5 C   ·   1.0 atm', w * 0.06, h * 0.68)
      g.fillStyle = '#e08a3c'
      g.fillRect(w * 0.06, h * 0.82, w * 0.5, h * 0.06)
      g.fillStyle = '#8fe6ef'
      g.fillRect(w * 0.06, h * 0.82, w * 0.31, h * 0.06)
    },
    // `screenFace` gives this 0.552 m by 0.228 m = aspect 2.421; 512x256 (2.0)
    // stretched the readout 21 % wide.
    512,
    211,
  )
  const material = new MeshStandardNodeMaterial()
  const sampled = texture(tex, uv())
  material.colorNode = sampled.rgb.mul(0.4)
  material.emissiveNode = sampled.rgb.mul(1.6)
  material.roughness = 0.22
  material.metalness = 0
  return material
}

export type TramMaterials = Record<string, Material>

let shared: TramMaterials | null = null

function sharedBundle(): TramMaterials {
  if (!shared) {
    shared = {
      body: bodyPaint(),
      dark: structuralGrey(),
      alloy: alloyTrim(),
      lining: cabinLining(),
      floorGrip: floorGrip(),
      glass: cabinGlazing(),
      rubber: rubberSeal(),
      orange: accentOrange(false),
      orangeRail: accentOrange(true),
      seatShell: seatShell(),
      seatCushion: seatCushion(),
      lampWarm: emissiveLens([1.0, 0.8, 0.585], 2.0, 5.5),
      lampHead: emissiveLens([0.855, 0.925, 1.0], 5.0, 22),
      lampTail: emissiveLens([1.0, 0.13, 0.06], 2.6, 22),
      screen: consoleScreen(),
      livery: stencilMaterial(liveryTexture()),
    }
  }
  return shared
}

const numberCache = new Map<number, Material>()

export function tramMaterials(carIndex: number): TramMaterials {
  const key = carIndex % 2
  let unit = numberCache.get(key)
  if (!unit) {
    unit = stencilMaterial(carNumberTexture(key))
    numberCache.set(key, unit)
  }
  return { ...sharedBundle(), unit }
}
