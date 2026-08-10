import { Color } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  abs,
  float,
  fract,
  fwidth,
  mix,
  mx_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  smoothstep,
  vec3,
} from 'three/tsl'
import { applySpecularAA } from '../materials/library'

/**
 * Robot material library — OBJECT SPACE, deliberately.
 *
 * The park's shared `kitMaterials()` sample `positionWorld`, which is right for
 * a building and wrong for a machine: a world-space field crawls across a hull
 * that moves (experience-craft §4/§5.4). Everything here reads `positionLocal`
 * and `normalLocal`, so dust sits on the machine's own top faces and stays put
 * as it drives.
 *
 * Every material has TWO named causes feeding colour, roughness AND metalness
 * together — `dust` (regolith fines that settle up-facing and never wash off)
 * and `wear` (paint rubbed through to primer and alloy where the machine is
 * handled, kicked and scraped). Fine microstructure retires with distance so
 * it cannot alias into shimmer on a small object that is usually far away.
 */

const noise = (sx: number, sy: number, sz: number, offset: number): Node<'float'> =>
  mx_noise_float(positionLocal.mul(vec3(sx, sy, sz)).add(offset)).mul(0.5).add(0.5)

const iso = (scale: number, offset = 0): Node<'float'> => noise(scale, scale, scale, offset)

/** Shared microstructure fade: full detail near, gone before it aliases. */
const detailKeep = (far: number): Node<'float'> =>
  float(1).sub(smoothstep(far * 0.45, far, positionView.length()))

/** 1 at a grazing view, 0 face-on — sheen, rim dust, fabric bloom. */
const grazing = (): Node<'float'> => float(1).sub(abs(normalView.z))

/** Regolith fines: the one colour every exposed surface drifts toward. */
const DUST = vec3(0.42, 0.31, 0.23)

const setMetalness = (material: MeshStandardNodeMaterial, node: Node<'float'>): void => {
  material.metalnessNode = node as unknown as typeof material.metalnessNode
}

/**
 * Livery paint over primer. `wearAmount` is the machine's age: GK-02 has been
 * around longer than GK-01 and shows it.
 */
export function roverPaint(color: Color, wearAmount = 1): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(22)
  const chip = iso(26, 4.3).mul(keep)
  const scuffField = iso(3.1, 11.7)
  // Rub-through concentrates low on the body, where thrown grit hits.
  const low = smoothstep(0.46, 0.1, positionLocal.y)
  const wear = smoothstep(0.52, 0.86, scuffField.mul(0.62).add(chip.mul(0.38)).add(low.mul(0.16)))
    .mul(wearAmount)
  const settle = iso(1.7, 27.5).mul(0.55).add(0.45)
  const dust = smoothstep(0.05, 0.75, normalLocal.y).mul(settle).mul(0.5)

  const primer = vec3(0.31, 0.29, 0.28)
  const painted = mix(vec3(color.r, color.g, color.b), primer, wear.mul(0.75))
  material.colorNode = mix(painted, DUST, dust)
  material.roughnessNode = float(0.38).add(dust.mul(0.42)).sub(wear.mul(0.08))
  setMetalness(material, wear.mul(0.45))
  applySpecularAA(material)
  return material
}

/** Bare structural alloy: rolling-mill grain, scuffed at handling height. */
export function roverAlloy(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(16)
  const grain = noise(3, 46, 46, 1.7).mul(keep)
  const scuff = iso(7.5, 33.1)
  const dust = smoothstep(0.1, 0.8, normalLocal.y).mul(iso(2.3, 52.9).mul(0.5).add(0.5)).mul(0.34)
  material.colorNode = mix(vec3(0.6, 0.605, 0.61), vec3(0.5, 0.49, 0.48), scuff.mul(0.5))
    .mul(grain.mul(0.14).add(0.92))
    .mul(float(1).sub(dust.mul(0.28)))
  material.roughnessNode = float(0.3).add(grain.mul(0.16)).add(dust.mul(0.4))
  setMetalness(material, float(0.88).sub(dust.mul(0.5)))
  applySpecularAA(material)
  return material
}

/** Machined / cast hardware: knuckles, bosses, brackets, fasteners. */
export function machinedSteel(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const cast = iso(14, 61.4).mul(detailKeep(12))
  const oil = iso(2.6, 71.2)
  material.colorNode = mix(vec3(0.26, 0.255, 0.25), vec3(0.17, 0.165, 0.163), oil)
    .mul(cast.mul(0.2).add(0.9))
  material.roughnessNode = float(0.44).add(cast.mul(0.2)).sub(oil.mul(0.12))
  setMetalness(material, float(0.55).add(oil.mul(0.2)))
  applySpecularAA(material)
  return material
}

/** Tyre rubber: dusty shoulders, a tread band polished by the paving. */
export function tyreRubber(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(10)
  const grain = iso(60, 88.3).mul(keep)
  // Wheel-local +X is the axle, so |x| separates sidewall from tread band.
  const sidewall = smoothstep(0.02, 0.05, abs(positionLocal.x))
  const dust = iso(3.4, 92.7).mul(0.5).add(0.5).mul(sidewall)
  material.colorNode = mix(vec3(0.055, 0.053, 0.052), vec3(0.09, 0.086, 0.084), grain.mul(0.6))
    .add(DUST.mul(dust.mul(0.22)))
  material.roughnessNode = float(0.94).sub(grain.mul(0.12)).sub(sidewall.oneMinus().mul(0.18))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Safety paint: hazard trim, bumper strips, tool heads. */
export function hazardPaint(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const chip = iso(22, 15.5).mul(detailKeep(18))
  const wear = smoothstep(0.55, 0.9, iso(3.6, 5.5).mul(0.65).add(chip.mul(0.35)))
  const dust = smoothstep(0.1, 0.8, normalLocal.y).mul(0.4)
  material.colorNode = mix(mix(vec3(0.74, 0.27, 0.05), vec3(0.34, 0.16, 0.09), wear), DUST, dust)
  material.roughnessNode = float(0.46).add(dust.mul(0.38)).add(wear.mul(0.1))
  material.metalness = 0.04
  applySpecularAA(material)
  return material
}

/**
 * Hazard chevrons on a bumper: a real diagonal band pattern in object space,
 * retired by its own pixel footprint (never a distance fade — at a grazing
 * view the footprint grows faster than the distance does).
 */
export function hazardChevron(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const coordinate = positionLocal.x.add(positionLocal.y).mul(8.5)
  const band = fract(coordinate)
  const footprint = fwidth(coordinate).mul(1.4).add(0.001)
  // Converges on the running average once a stripe pair lands inside a pixel.
  const stripe = smoothstep(float(0.5).sub(footprint), float(0.5).add(footprint), band).mul(
    smoothstep(float(1).add(footprint), float(1).sub(footprint), band),
  )
  const blended = smoothstep(0.35, 0.9, footprint)
  const mask = mix(stripe, float(0.5), blended)
  const dust = smoothstep(0.1, 0.8, normalLocal.y).mul(0.36)
  material.colorNode = mix(mix(vec3(0.72, 0.26, 0.05), vec3(0.17, 0.16, 0.155), mask), DUST, dust)
  material.roughnessNode = float(0.5).add(dust.mul(0.34))
  material.metalness = 0.04
  applySpecularAA(material)
  return material
}

/** Sensor optics: near-black cover glass with a hard specular. */
export function sensorGlass(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const film = iso(40, 3.9).mul(detailKeep(8))
  material.colorNode = vec3(0.028, 0.032, 0.036).add(grazing().pow(3).mul(0.12))
  material.roughnessNode = float(0.07).add(film.mul(0.05))
  material.metalness = 0.25
  applySpecularAA(material)
  return material
}

/** Beacon lens — the fleet's one emissive rung, sized to bloom gently. */
export function beaconLens(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const mottle = iso(28, 13.3).mul(0.18).add(0.91)
  material.colorNode = vec3(0.95, 0.62, 0.22)
  material.emissiveNode = vec3(1.0, 0.55, 0.16).mul(mottle).mul(3.4)
  material.roughness = 0.28
  return material
}

/** Brush bristles: extruded nylon, matte, catching light only at a graze. */
export function bristleNylon(color: Color): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const fibre = noise(70, 12, 70, 6.1).mul(detailKeep(9))
  const worn = iso(4.4, 21.8)
  material.colorNode = mix(vec3(color.r, color.g, color.b), DUST, worn.mul(0.45))
    .mul(fibre.mul(0.28).add(0.86))
    .add(grazing().pow(4).mul(0.09))
  material.roughnessNode = float(0.88).sub(grazing().mul(0.16))
  material.metalness = 0
  return material
}

/** Cargo webbing: ratchet straps and tie-downs. */
export function strapWebbing(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const weave = noise(120, 120, 120, 9.4).mul(detailKeep(7))
  const sun = iso(1.9, 39.6)
  material.colorNode = mix(vec3(0.2, 0.185, 0.15), vec3(0.32, 0.28, 0.21), sun.mul(0.7))
    .mul(weave.mul(0.22).add(0.9))
  material.roughnessNode = float(0.93).sub(grazing().mul(0.1))
  material.metalness = 0
  return material
}

/** Shipping crate shell: rotomoulded composite, corner-scuffed. */
export function crateShell(color: Color): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const mould = iso(6.5, 55.2)
  const scuff = iso(19, 66.8).mul(detailKeep(14))
  const dust = smoothstep(0.15, 0.85, normalLocal.y).mul(0.42)
  material.colorNode = mix(
    mix(vec3(color.r, color.g, color.b), vec3(0.46, 0.44, 0.42), scuff.mul(0.4)),
    DUST,
    dust,
  ).mul(mould.mul(0.12).add(0.93))
  material.roughnessNode = float(0.62).add(dust.mul(0.3)).add(mould.mul(0.1))
  material.metalness = 0.03
  applySpecularAA(material)
  return material
}

export type Livery = 'gk01' | 'gk02' | 'sweep' | 'mule' | 'gantry'

const LIVERY: Record<Livery, { paint: Color; accent: Color; wear: number }> = {
  gk01: { paint: new Color(0.78, 0.765, 0.725), accent: new Color(0.76, 0.4, 0.07), wear: 0.75 },
  gk02: { paint: new Color(0.74, 0.735, 0.71), accent: new Color(0.14, 0.4, 0.42), wear: 1.35 },
  sweep: { paint: new Color(0.72, 0.32, 0.07), accent: new Color(0.8, 0.79, 0.75), wear: 1.05 },
  mule: { paint: new Color(0.7, 0.69, 0.66), accent: new Color(0.76, 0.4, 0.07), wear: 1.2 },
  gantry: { paint: new Color(0.78, 0.77, 0.74), accent: new Color(0.76, 0.4, 0.07), wear: 0.9 },
}

let shared: Record<string, MeshStandardNodeMaterial> | null = null
const liveries = new Map<Livery, Record<string, MeshStandardNodeMaterial>>()

/**
 * Slot bundle for one machine. Everything except `paint`/`accent` is shared
 * across the fleet, so the whole roster compiles a handful of programs.
 */
export function robotMaterials(livery: Livery): Record<string, MeshStandardNodeMaterial> {
  if (!shared) {
    shared = {
      alloy: roverAlloy(),
      dark: machinedSteel(),
      rubber: tyreRubber(),
      hazard: hazardPaint(),
      chevron: hazardChevron(),
      lens: sensorGlass(),
      beacon: beaconLens(),
      bristle: bristleNylon(new Color(0.52, 0.4, 0.2)),
      webbing: strapWebbing(),
      crate: crateShell(new Color(0.58, 0.56, 0.53)),
      crateAlt: crateShell(new Color(0.44, 0.48, 0.5)),
    }
  }
  let bundle = liveries.get(livery)
  if (!bundle) {
    const spec = LIVERY[livery]
    bundle = {
      ...shared,
      paint: roverPaint(spec.paint, spec.wear),
      accent: roverPaint(spec.accent, spec.wear * 0.8),
    }
    liveries.set(livery, bundle)
  }
  return bundle
}
