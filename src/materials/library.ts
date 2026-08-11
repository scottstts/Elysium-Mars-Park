import { CanvasTexture, Color, DoubleSide, SRGBColorSpace } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  float,
  fwidth,
  max,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  normalWorld,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/**
 * The procedural TSL material library (plan §8). All lit park materials come
 * from here so the NASA-punk identity stays coherent: honest engineered
 * surfaces, use-wear only, specular AA everywhere.
 */

/** Geometric specular AA: widen roughness where normals change per-pixel. */
export function applySpecularAA(material: MeshStandardNodeMaterial): void {
  const base = (material.roughnessNode ?? float(material.roughness)) as Node<'float'>
  const geometric = fwidth(normalWorld).length().mul(0.55)
  material.roughnessNode = max(
    base,
    base.mul(base).add(geometric.mul(geometric)).sqrt().min(1),
  ) as unknown as typeof material.roughnessNode
}

const worldNoise = (scale: number, offset = 0) =>
  mx_noise_float(vec2(positionWorld.x, positionWorld.z).mul(scale).add(offset))
    .mul(0.5)
    .add(0.5)

/** White structural paint, faint utility patina. */
export function paintedSteel(tint = new Color(0.815, 0.8, 0.77)): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const patina = worldNoise(0.9, 3.1)
  material.colorNode = mix(vec3(tint.r, tint.g, tint.b), vec3(0.7, 0.685, 0.66), patina.mul(0.22))
  material.roughnessNode = float(0.42).add(patina.mul(0.1))
  material.metalness = 0.12
  applySpecularAA(material)
  return material
}

/** Chamfer-slot variant: paint rubbed through to metal on machined edges. */
export function wornEdgeSteel(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = worldNoise(4.2, 8.8)
  material.colorNode = mix(vec3(0.78, 0.765, 0.74), vec3(0.62, 0.6, 0.585), wear.mul(0.8))
  material.metalnessNode = wear.mul(0.5).add(0.25) as unknown as Node<'float'>
  material.roughnessNode = float(0.34).add(wear.mul(0.08))
  applySpecularAA(material)
  return material
}

export function bareAluminum(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const brushed = worldNoise(11, 1.7)
  material.colorNode = vec3(0.62, 0.63, 0.645).mul(brushed.mul(0.12).add(0.92))
  material.metalness = 0.85
  material.roughnessNode = float(0.36).add(brushed.mul(0.1))
  applySpecularAA(material)
  return material
}

/** International-orange safety paint — handrails, hazard trim. */
export function safetyOrange(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = worldNoise(2.6, 5.5)
  material.colorNode = mix(vec3(0.71, 0.2, 0.045), vec3(0.55, 0.17, 0.05), wear.mul(0.4))
  material.roughnessNode = float(0.48).add(wear.mul(0.12))
  material.metalness = 0.05
  applySpecularAA(material)
  return material
}

/** Handrail top face: the ONE place paint is polished by ten thousand palms. */
export function polishedRailTop(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.66, 0.24, 0.08)
  material.roughnessNode = float(0.24)
  material.metalness = 0.15
  applySpecularAA(material)
  return material
}

export function darkSteel(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const variation = worldNoise(1.8, 12.3)
  material.colorNode = vec3(0.2, 0.195, 0.19).mul(variation.mul(0.18).add(0.88))
  material.roughness = 0.58
  material.metalness = 0.3
  applySpecularAA(material)
  return material
}

/** Rubberized deck plating with worn tread stripes (uv-space, u along run). */
export function deckPlate(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const stripe = smoothstep(0.42, 0.5, positionWorld.x.mul(6.5).add(positionWorld.z.mul(6.5)).fract())
    .mul(smoothstep(1.0, 0.92, positionWorld.x.mul(6.5).add(positionWorld.z.mul(6.5)).fract()))
  const grime = worldNoise(1.4, 21.2)
  material.colorNode = mix(vec3(0.115, 0.112, 0.11), vec3(0.15, 0.146, 0.142), stripe)
    .mul(grime.mul(0.25).add(0.82))
  material.roughnessNode = float(0.86).sub(stripe.mul(0.08))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Physically transmissive pane for the glasshouses & lounge windows. */
export function heroGlass(tint = new Color(0.86, 0.93, 0.88)): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial()
  material.color.set(0xffffff)
  material.metalness = 0
  material.roughness = 0.04
  material.transmission = 1
  material.ior = 1.52
  material.thickness = 0.05
  material.attenuationColor.copy(tint)
  material.attenuationDistance = 2.4
  material.envMapIntensity = 1
  material.transparent = false
  material.side = DoubleSide
  material.depthWrite = false
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  return material
}

/**
 * Letter tracking for stencil type: a PAIR OF U+200A HAIR SPACES between
 * glyphs. The shipping face draws U+200A at 0.015 em, so this is ~0.03 em of
 * air per gap — nowhere near the ~0.56 em a pair of ASCII spaces would add.
 * Any width budget written against this string has to be MEASURED, not
 * counted off the character count (see `signageMaterial`).
 */
export function tracked(line: string): string {
  return line.split('').join('  ')
}

/** Horizontal scale the stencil face is drawn at — part of the drawn width. */
const XSCALE = 1.06

/**
 * Stencil signage: crisp uppercase text on a plate, canvas-rasterized.
 * `aspect` is the TARGET PLANE's width/height — the canvas matches it so
 * texels stay square on the mesh. The old fixed 1:0.28 canvas squashed the
 * type flat on every portrait plate (hydro totem finding). Callers with a
 * 1:0.28 plate (stencilSign) need pass nothing.
 */
export function signageMaterial(
  lines: string[],
  options?: {
    background?: string
    ink?: string
    widthPx?: number
    accent?: string
    aspect?: number
  },
): MeshStandardNodeMaterial {
  const width = options?.widthPx ?? 1024
  const aspect = options?.aspect ?? 1 / 0.28
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(64, Math.min(4096, Math.round(width / aspect)))
  const g = canvas.getContext('2d')
  if (g) {
    const ink = options?.ink ?? '#efe9dc'
    g.fillStyle = options?.background ?? '#1c1a19'
    g.fillRect(0, 0, canvas.width, canvas.height)
    // The frame is a FRACTION OF THE PLATE'S SHORT SIDE, not the fixed 14 px
    // inset / 6 px stroke it carried before. Those absolutes are 2 % of the
    // 1670 px hydro totem and 24 % of the 108 px bay plate, so the same
    // "border" was a 7 mm hairline on one sign and, on another, a slab thick
    // enough for the accent bar and the top line of type to land on it. Keyed
    // to the short side it is a constant fraction of the PLATE, and on a
    // 1 : 0.28 plate (short side 287 px of a 1024 canvas) it resolves to
    // exactly the 14 / 6 it always was.
    const short = Math.min(canvas.width, canvas.height)
    const frameInset = Math.max(4, Math.round(short * 0.049))
    const frameLine = Math.max(2, Math.round(short * 0.021))
    // Keep-out for everything that is NOT the frame — type and accent bar
    // both respect it: the frame's own reach plus a breath.
    const pad = frameInset + frameLine + Math.max(4, Math.round(short * 0.035))
    // The border is the ink at a quarter strength, NOT a hard-coded pale
    // grey: on a light plate (the water tower) a pale border is invisible.
    // For the default cream ink this is the same pixel it always was.
    g.globalAlpha = 0.25
    g.strokeStyle = ink
    g.lineWidth = frameLine
    g.strokeRect(
      frameInset,
      frameInset,
      canvas.width - 2 * frameInset,
      canvas.height - 2 * frameInset,
    )
    g.globalAlpha = 1
    g.fillStyle = ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // The accent bar reserves its own strip UNDER the text block. Drawn at a
    // fixed 34 px off the plate bottom (as it was), any 3-line sign's last
    // line ran straight through it (heat-rejection finding). With no accent
    // the band is zero and the layout is pixel-identical to the old one.
    const accentH = options?.accent ? Math.max(10, Math.round(canvas.height * 0.05)) : 0
    const accentBand =
      accentH > 0
        ? accentH +
          Math.max(16, Math.round(canvas.height * 0.1)) +
          Math.max(14, Math.round(canvas.height * 0.06))
        : 0
    const boxH = canvas.height - accentBand
    const lineHeight = boxH / (lines.length + 0.6)
    // ONE size for the whole block, and it is MEASURED.
    //
    // The old budget was `width * 0.78 / (1.18 * line.length)`, where 1.18 em
    // stood for a character plus the tracking added below. But that tracking
    // is a PAIR OF U+200A HAIR SPACES, which the shipping face draws at
    // 0.015 em — next to nothing — so a cap plus tracking is ~0.72 em, not
    // 1.18. Two owner-visible consequences: every width-bound line rasterized
    // at ~57 % of the size that fits (the founding stone's 30 characters came
    // out 4.4 cm tall on a 2 m plate), and because the budget was per LINE the
    // lines of one sign came out at different sizes — the hydro totem drew
    // 46 / 63 / 25 / 30 px, so its subtitle was half again its own name.
    //
    // Measuring the longest line at a probe size and sharing that size across
    // the block fixes both. A sign that wants a hierarchy states it in the
    // CONTENT — a name plate and a caption plate — not by accident of length.
    const probe = 100
    g.font = `700 ${probe}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    let fit = Infinity
    for (const line of lines) {
      const drawn = g.measureText(tracked(line)).width * XSCALE
      if (drawn > 0) fit = Math.min(fit, ((canvas.width - 2 * pad) * probe) / drawn)
    }
    const size = Math.min(lineHeight * 0.72, fit)
    g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    lines.forEach((line, index) => {
      const y = boxH / 2 + (index - (lines.length - 1) / 2) * lineHeight
      g.save()
      g.translate(canvas.width / 2, y)
      g.scale(XSCALE, 1)
      g.fillText(tracked(line), 0, 0)
      g.restore()
    })
    if (options?.accent && accentH > 0) {
      g.fillStyle = options.accent
      const barBottom = canvas.height - Math.max(16, Math.round(canvas.height * 0.1))
      // Same keep-out as the type. At a fixed 24 px the bar ran straight
      // through the side frame of any plate whose short side is over ~500 px.
      g.fillRect(pad, barBottom - accentH, canvas.width - 2 * pad, accentH)
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  const material = new MeshStandardNodeMaterial()
  material.map = texture
  material.roughness = 0.6
  material.metalness = 0.05
  return material
}

/** ISRU cast mineral surfaces (amphitheater rows, plinths). */
export function castMineral(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const pour = worldNoise(0.55, 31.7)
  const speck = worldNoise(7.5, 44.2)
  material.colorNode = mix(vec3(0.44, 0.375, 0.315), vec3(0.5, 0.43, 0.365), pour)
    .mul(speck.mul(0.12).add(0.9))
  material.roughnessNode = float(0.88)
  applySpecularAA(material)
  return material
}

/** Matte technical fabric (chairs, the porch jacket, awnings). */
export function fabric(color: Color): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const weave = worldNoise(24, 3.3)
  material.colorNode = vec3(color.r, color.g, color.b).mul(weave.mul(0.1).add(0.92))
  material.roughness = 0.92
  material.metalness = 0
  return material
}

/** Bright play-equipment paint. */
export function playPaint(color: Color): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = worldNoise(3.4, 17.9)
  material.colorNode = vec3(color.r, color.g, color.b).mul(wear.mul(0.12).add(0.9))
  material.roughness = 0.4
  material.metalness = 0.05
  applySpecularAA(material)
  return material
}

/** Poured rubber-crumb safety surface. */
export function playSoft(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const crumb = worldNoise(14, 8.1)
  material.colorNode = mix(vec3(0.34, 0.14, 0.1), vec3(0.4, 0.18, 0.12), crumb)
  material.roughness = 0.95
  return material
}

/** Warm-white composite hab shell (rotomolded panels, faint seams). */
export function habShell(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const panel = worldNoise(1.1, 27.4)
  material.colorNode = mix(vec3(0.79, 0.77, 0.73), vec3(0.73, 0.705, 0.66), panel.mul(0.5))
  material.roughnessNode = float(0.55).add(panel.mul(0.08))
  material.metalness = 0.04
  applySpecularAA(material)
  return material
}

/** Milky diffusing greenhouse panel — glow passes, shapes blur. */
export function milkyPanel(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.colorNode = vec3(0.82, 0.88, 0.84)
  material.opacityNode = float(0.42)
  material.roughness = 0.55
  material.metalness = 0
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  return material
}

/** Grow-light bar: the greenhouse's warm horticultural glow. */
export function growBar(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.9, 0.88, 0.86)
  material.emissiveNode = vec3(1.0, 0.82, 0.78).mul(2.6)
  material.roughness = 0.4
  return material
}

/** Non-transmissive dark architectural glass (hab portholes, ops strip). */
export function darkGlass(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.05, 0.06, 0.062)
  material.roughness = 0.08
  material.metalness = 0.2
  applySpecularAA(material)
  return material
}

/** One shared bundle for the archkit's standard slots. */
export interface KitMaterials {
  steel: MeshStandardNodeMaterial
  steelEdge: MeshStandardNodeMaterial
  dark: MeshStandardNodeMaterial
  aluminum: MeshStandardNodeMaterial
  orange: MeshStandardNodeMaterial
  orangeTop: MeshStandardNodeMaterial
  deck: MeshStandardNodeMaterial
  [name: string]: MeshStandardNodeMaterial
}

let shared: KitMaterials | null = null

export function kitMaterials(): KitMaterials {
  if (!shared) {
    shared = {
      steel: paintedSteel(),
      steelEdge: wornEdgeSteel(),
      dark: darkSteel(),
      aluminum: bareAluminum(),
      orange: safetyOrange(),
      orangeTop: polishedRailTop(),
      deck: deckPlate(),
      cast: castMineral(),
      habShell: habShell(),
      darkGlass: darkGlass(),
      growBar: growBar(),
      playRed: playPaint(new Color(0.72, 0.24, 0.1)),
      playBlue: playPaint(new Color(0.16, 0.38, 0.55)),
      playSoft: playSoft(),
      fabricRust: fabric(new Color(0.5, 0.26, 0.16)),
      fabricBlue: fabric(new Color(0.24, 0.32, 0.42)),
      fabricSand: fabric(new Color(0.6, 0.52, 0.42)),
      soil: soilBed(),
      tubeWall: tubeWall(),
      runningLight: runningLight(),
      cabinGlass: cabinGlass(),
      // Artificial light layer (W1-light). Slot names are a contract —
      // see world/lightFixtures.ts EMISSIVE_SLOTS. Add, never rename.
      signageGlow: signageGlow(),
      floorLens: floorLens(),
      interiorGlow: interiorGlow(),
      utilityLight: utilityLight(),
    }
  }
  return shared
}

/** Genuinely see-through vehicle glazing (cheap alpha, slight tint). */
export function cabinGlass(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.colorNode = vec3(0.4, 0.45, 0.46)
  material.opacityNode = float(0.16)
  material.roughness = 0.05
  material.metalness = 0
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  return material
}

/** Connector-tube interior lining (seen from inside — double-sided). */
export function tubeWall(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const panel = worldNoise(0.35, 71.3)
  material.colorNode = mix(vec3(0.23, 0.215, 0.2), vec3(0.185, 0.175, 0.168), panel)
  material.roughness = 0.7
  material.metalness = 0.15
  material.side = DoubleSide
  applySpecularAA(material)
  return material
}

/** Tube running lights: warm guidance strips, bright enough to bloom. */
export function runningLight(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.9, 0.87, 0.8)
  material.emissiveNode = vec3(1.0, 0.9, 0.72).mul(3.2)
  return material
}

/*
 * ── THE ARTIFICIAL LIGHT LAYER ──────────────────────────────────────────
 * Four emissive slots, authored as ONE calibrated HDR ladder against the
 * bloom threshold (1.0, render/pipeline.ts). See world/lightFixtures.ts for
 * the full ladder and the rules W2 agents build against. In short: pick the
 * slot by ROLE, scale the emissive AREA rather than the multiplier, and give
 * every lens a real recess and bezel — an emissive face with no depth reads
 * as paint, not as light.
 *
 * None of these are flat emissive paint. Each carries a faint structure at
 * UNCHANGED MEAN intensity (diffuser mottle, LED bar ripple, phosphor
 * grain), so the ladder stays calibrated while the surfaces stop looking
 * like coloured cardboard at 1 m.
 */

/** Backlit white sign face — the reference's HYDROPONICS / THE COMMONS plates. */
export function signageGlow(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  // Edge-lit acrylic is never perfectly even: a slow diffuser gradient plus
  // a whisper of grain. Mean stays 1.0 so the ×3.4 rung is exact.
  const diffuser = worldNoise(0.6, 91.4).mul(0.14).add(0.93)
  const grain = worldNoise(26, 12.7).mul(0.05).add(0.975)
  material.colorNode = vec3(0.92, 0.9, 0.86)
  material.emissiveNode = vec3(1.0, 0.965, 0.9).mul(diffuser).mul(grain).mul(3.4)
  material.roughness = 0.42
  material.metalness = 0
  return material
}

/** Recessed floor / kerb light lens — warm, low, reflected in the paving. */
export function floorLens(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  // Dust settles on an up-facing lens; the mottle is the reason a run of
  // twenty lenses does not look like twenty copies of one decal.
  const dust = worldNoise(3.1, 55.8).mul(0.18).add(0.9)
  material.colorNode = vec3(0.86, 0.78, 0.66)
  material.emissiveNode = vec3(1.0, 0.735, 0.44).mul(dust).mul(2.6)
  material.roughnessNode = float(0.3).add(dust.mul(0.12))
  material.metalness = 0
  return material
}

/** Warm room light seen through glazing — building interiors, lit lobbies. */
export function interiorGlow(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  // Broad, soft, and the dimmest rung: this slot is a WALL of light behind
  // glass, so its area does the work. Pushing the multiplier instead makes
  // whole facades bloom into featureless slabs.
  const room = worldNoise(0.28, 7.9).mul(0.22).add(0.89)
  material.colorNode = vec3(0.9, 0.84, 0.75)
  material.emissiveNode = vec3(1.0, 0.8, 0.585).mul(room).mul(2.0)
  material.roughness = 0.65
  material.metalness = 0
  return material
}

/** Small cool-white utility lamp — the bright points on structures at dusk. */
export function utilityLight(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  // The brightest authored rung, on purpose, because these are TINY: a
  // 6 cm lens needs a high multiplier to register as a point of light at
  // 40 m. Never use this slot on a surface larger than ~0.1 m².
  material.colorNode = vec3(0.88, 0.9, 0.92)
  material.emissiveNode = vec3(0.855, 0.925, 1.0).mul(5.0)
  material.roughness = 0.25
  material.metalness = 0
  return material
}

/** Dark cultivated soil — the only earth on Mars (tree ring, planters). */
export function soilBed(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const clod = worldNoise(9, 51.3)
  const moist = worldNoise(1.7, 60.1)
  // Cultivated soil is the DARKEST ground in frame (vegetation-agent flag:
  // it rendered lighter than the paving it sits inside).
  material.colorNode = mix(vec3(0.072, 0.052, 0.038), vec3(0.105, 0.078, 0.055), clod)
    .mul(moist.mul(0.2).add(0.85))
  material.roughnessNode = float(0.96).sub(moist.mul(0.06))
  return material
}
