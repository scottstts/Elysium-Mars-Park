import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, vec3 } from 'three/tsl'
import { applySpecularAA } from '../materials/library'

/**
 * Dome-local material set. The gridshell is white-painted steel per the art
 * direction, so its variation has to come from SHELL-SPACE fields, not the
 * park library's plan-space (x,z) noise: on a dome every point of one rib
 * shares an (x,z) column, and a plan-space field paints the crown as one
 * flat patch. Everything here reads the full world position.
 */

const shellNoise = (scale: number, offset: number) =>
  mx_noise_float(positionWorld.mul(scale).add(offset)).mul(0.5).add(0.5)

/**
 * The gridshell's paint: a warm off-white, dirtier low down where dust
 * blows against the foot and cleaner up in the light.
 */
export function shellPaint(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const patina = shellNoise(0.06, 3.1)
  const speck = shellNoise(1.9, 17.4)
  // Grime rises ~14 m up the shell from the foot, blotchy at its top edge.
  const grime = float(1)
    .sub(smoothstep(1.5, 15.0, positionWorld.y))
    .mul(patina.mul(0.6).add(0.4))
  const clean = mix(vec3(0.9, 0.888, 0.862), vec3(0.83, 0.815, 0.785), patina)
  material.colorNode = mix(clean, vec3(0.5, 0.42, 0.34), grime.mul(0.45)).mul(
    speck.mul(0.08).add(0.96),
  )
  material.roughnessNode = float(0.4).add(patina.mul(0.12)).add(grime.mul(0.2))
  material.metalness = 0.1
  applySpecularAA(material)
  return material
}

/** Chamfer band: paint worn through to galvanising on machined arrises. */
export function shellPaintEdge(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = shellNoise(0.9, 8.8)
  material.colorNode = mix(vec3(0.86, 0.85, 0.83), vec3(0.64, 0.635, 0.62), wear.mul(0.85))
  material.metalnessNode = wear.mul(0.45).add(0.2)
  material.roughnessNode = float(0.33).add(wear.mul(0.1))
  applySpecularAA(material)
  return material
}

/** Cast steel node collars, base shoes, compression-ring hardware. */
export function castNode(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const grain = shellNoise(2.4, 41.2)
  material.colorNode = mix(vec3(0.7, 0.69, 0.675), vec3(0.6, 0.588, 0.57), grain)
  material.roughnessNode = float(0.52).add(grain.mul(0.14))
  material.metalness = 0.35
  applySpecularAA(material)
  return material
}

/** ISRU cast-stone foundation plinth the shell springs from. */
export function foundationStone(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const pour = shellNoise(0.12, 27.9)
  const aggregate = shellNoise(3.1, 63.3)
  // Splash-line dust darkens the bottom 0.5 m of the plinth.
  const splash = float(1).sub(smoothstep(-1.2, 0.55, positionWorld.y))
  material.colorNode = mix(vec3(0.72, 0.7, 0.665), vec3(0.63, 0.61, 0.575), pour)
    .mul(aggregate.mul(0.1).add(0.95))
    .mul(mix(vec3(1), vec3(0.72, 0.6, 0.48), splash.mul(0.7)))
  material.roughnessNode = float(0.86).sub(aggregate.mul(0.06))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Crane rail head — polished by the Panewalker's wheels. */
export function craneRail(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  material.colorNode = vec3(0.44, 0.43, 0.42)
  material.roughnessNode = float(0.26)
  material.metalness = 0.8
  applySpecularAA(material)
  return material
}

/** Dark hardware: gaskets, bolt heads, handrail uprights. */
export function shellHardware(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const variation = shellNoise(1.4, 12.3)
  material.colorNode = vec3(0.185, 0.18, 0.175).mul(variation.mul(0.2).add(0.88))
  material.roughness = 0.56
  material.metalness = 0.3
  applySpecularAA(material)
  return material
}

/**
 * Connector-duct cladding. A horizontal duct out in the open weathers by
 * SETTLING, not by splash: dust builds on the upward-facing half and the
 * underside stays pale, so the tone has to key off the surface normal —
 * the shell's height-based grime would just paint the whole 300 m brown.
 */
export function ductCladding(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const drift = shellNoise(0.11, 71.4)
  const grain = shellNoise(1.3, 19.2)
  const settled = normalWorld.y.max(0).pow(0.7).mul(drift.mul(0.55).add(0.55))
  material.colorNode = mix(
    vec3(0.78, 0.765, 0.735),
    vec3(0.47, 0.335, 0.225),
    settled.clamp(0, 1).mul(0.52),
  ).mul(grain.mul(0.08).add(0.96))
  material.roughnessNode = float(0.52).add(settled.mul(0.28))
  material.metalness = 0.08
  applySpecularAA(material)
  return material
}

/** International-orange hazard paint round the portal bore. */
export function hazardPaint(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = shellNoise(1.6, 5.5)
  material.colorNode = mix(vec3(0.68, 0.21, 0.05), vec3(0.5, 0.17, 0.06), wear.mul(0.5))
  material.roughnessNode = float(0.5).add(wear.mul(0.12))
  material.metalness = 0.05
  applySpecularAA(material)
  return material
}

export type DomeSlot =
  | 'shell'
  | 'shellEdge'
  | 'node'
  | 'stone'
  | 'rail'
  | 'hardware'
  | 'hazard'
  | 'duct'

export function domeMaterials(): Record<DomeSlot, MeshStandardNodeMaterial> {
  return {
    shell: shellPaint(),
    shellEdge: shellPaintEdge(),
    node: castNode(),
    stone: foundationStone(),
    rail: craneRail(),
    hardware: shellHardware(),
    hazard: hazardPaint(),
    duct: ductCladding(),
  }
}
