import { Color } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  Fn,
  abs,
  float,
  fract,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  saturate,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { applySpecularAA, soilBed } from '../materials/library'
import { detailKeep } from '../vegetation/foliageMaterial'
import { fountainTime } from './waterField'

/**
 * THE FOUNTAIN'S SURFACES.
 *
 * One stone identity, authored three ways (dry / wetted / submerged floor),
 * plus bronze and a lens. The stone is the piece's whole argument, so it gets
 * the treatment the park gives nothing else: real veining, a sugary crystal
 * grain, and a honed-versus-wet roughness split.
 *
 * WHY PALE STONE IS PLAUSIBLE HERE. Everything else in Elysium Commons is
 * painted steel, ISRU cast mineral and glass — engineered, tan, honest. A
 * monument is the one thing a colony carves rather than bolts, and Mars has
 * the feedstock: bassanite/gypsum flats plus anorthositic highland fines
 * sinter to a pale calcic stone. It reads as marble because chemically it
 * nearly is. It is also the ONLY near-white surface in the park that is not
 * paint, which is precisely why the fountain reads as the landmark it is.
 *
 * ## The shared albedo functions
 *
 * `basinFloorAlbedo` is exported because the water surface RAY-TRACES to the
 * floor and shades the hit itself; the floor mesh under the water and the
 * refracted image of it must be the same surface or the illusion dies at the
 * shoreline. One function, two consumers — the same discipline the ripple
 * field uses.
 */

const veinWarp = /*@__PURE__*/ Fn(([p]: [Node<'vec3'>]) => {
  // Two-octave domain warp. Marble veining is a folded sheet, so the warp is
  // what turns "noise contours" into something that looks bedded and folded.
  const w1 = mx_noise_float(p.mul(0.42))
  const w2 = mx_noise_float(p.mul(1.15).add(vec3(11.3, 4.7, 19.1)))
  return p.add(vec3(w1.mul(1.35), w2.mul(0.6), w1.mul(0.9).add(w2.mul(0.5))))
})

/**
 * The carved-stone albedo at a world point. Ivory ground, two vein families
 * (a broad grey-green bedding and a fine warm hairline), plus crystal grain.
 */
export const marbleAlbedo = /*@__PURE__*/ Fn(([p, keep]: [Node<'vec3'>, Node<'float'>]) => {
  const warped = veinWarp(p)
  // Broad veins: the zero-crossings of a folded field, so they are thin,
  // continuous and branch — a thresholded noise blob never does any of that.
  const broad = abs(sin(mx_noise_float(warped.mul(0.62)).mul(7.4)))
  const vein = smoothstep(0.32, 0.02, broad)
  // Hairlines ride the same warp one octave up, so they run WITH the bedding
  // instead of crossing it at random — and they are BUNDLED to it: a hairline
  // wandering alone across clear field reads as a contour line on a survey
  // map, which is exactly how the tazza bowls read before this gate. Real
  // marble keeps its fractures where the bedding already broke the crystal.
  const fine = abs(sin(mx_noise_float(warped.mul(2.35).add(vec3(31.7))).mul(11.0)))
  const nearBed = smoothstep(0.58, 0.16, broad)
  const hair = smoothstep(0.16, 0.01, fine).mul(nearBed).mul(keep)
  // Sugary crystal grain: calcite reads granular at arm's length, flat at 10 m.
  const grain = mx_noise_float(p.mul(46.0)).mul(0.5).add(0.5)

  const ivory = vec3(0.775, 0.752, 0.706)
  const cream = vec3(0.72, 0.688, 0.628)
  const bed = mix(ivory, cream, mx_noise_float(warped.mul(0.28)).mul(0.5).add(0.5))
  const veined = mix(bed, vec3(0.5, 0.494, 0.478), vein.mul(0.52))
  return mix(veined, vec3(0.42, 0.386, 0.352), hair.mul(0.4)).mul(
    mix(float(1), grain.mul(0.16).add(0.92), keep),
  )
})

/**
 * Wetness on a surface inside the basin: soaked below the waterline, drying
 * upward through the splash zone. `localY` is the fountain-local height,
 * `waterY` the still-water level, `radius` the plan distance from the axis.
 *
 * The splash reach is not uniform — the ring where the curtain lands is
 * drenched, the far wall only misted — so the band's height is driven by
 * proximity to the landing ring. That gradient is most of what makes a
 * fountain look like it has been running rather than like it was just filled.
 */
export const wetness = /*@__PURE__*/ Fn(
  ([localY, waterY, radius, landR]: [
    Node<'float'>,
    Node<'float'>,
    Node<'float'>,
    Node<'float'>,
  ]) => {
    const nearLand = float(1).sub(abs(radius.sub(landR)).div(2.2).min(1))
    const reach = float(0.24).add(nearLand.mul(0.85))
    return float(1).sub(localY.sub(waterY).div(reach).clamp(0, 1).pow(0.7))
  },
)

export interface FountainStoneOptions {
  /** Fountain-local Y of the still-water level, in WORLD units. */
  waterWorldY: number
  /** World radius (plan) where the main curtain lands — drives splash reach. */
  landRadius: number
  center: { x: number; z: number }
}

/**
 * Dry carved stone with an automatic splash-zone wetting inside the basin.
 * Used for everything the water does not permanently run over.
 */
export function fountainStone(options: FountainStoneOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(30)
  const albedo = marbleAlbedo(positionWorld, keep)

  const plan = vec2(positionWorld.x.sub(options.center.x), positionWorld.z.sub(options.center.z))
  const radius = plan.length()
  const inBasin = smoothstep(7.5, 7.1, radius)
  const wet = wetness(
    positionWorld.y,
    float(options.waterWorldY),
    radius,
    float(options.landRadius),
  ).mul(inBasin)

  // Dust settles on every up-facing ledge in a dome with no rain — except
  // where the water washes it off, which is exactly the wet mask. The two
  // masks are complementary by construction, so a wet coping never also
  // reads as dusty.
  const settle = saturate(normalWorld.y).pow(1.4).mul(0.3).mul(float(1).sub(wet))
  const dusted = mix(albedo, vec3(0.44, 0.335, 0.255), settle)
  // Wet stone: darker (the film kills subsurface return) and much smoother.
  material.colorNode = mix(dusted, dusted.mul(0.46), wet)
  material.roughnessNode = mix(float(0.44).sub(keep.mul(0.05)), float(0.11), wet)
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/**
 * The SCULPTURE stone: the same marble, plus the baked crevice channel.
 *
 * The vortex lofts know exactly how deep each vertex sits inside a lobe
 * groove (the relief is analytic) and bake that into `uv.x`. Here it becomes
 * occlusion: a groove sees less sky, holds its dust, and scatters a little
 * less light back — which is what makes carved relief read under the flat
 * Martian ambient. The park's GTAO gathers at 0.9 m and is blind to a 3 cm
 * groove; a screen-space curvature term would be piecewise-constant per
 * triangle (the `dFdx` trap). The bake is exact, free at runtime, and lives
 * where the knowledge lives — in the loft.
 */
export function fountainSculptureStone(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(30)
  const albedo = marbleAlbedo(positionWorld, keep)
  const cavity = uv().x
  // Crevice shading: darker, faintly warmer-dusty at the very bottom of the
  // cut (settled fines), and slightly rougher — a crease never polishes.
  // GENTLE on purpose: at −40 % a crease reads as a painted black stripe from
  // two metres, which is worse than no cavity at all. Occlusion whispers.
  const creased = mix(albedo, albedo.mul(vec3(0.82, 0.81, 0.795)), cavity)
  const dustLine = smoothstep(0.72, 1.0, cavity).mul(0.1)
  material.colorNode = mix(creased, vec3(0.5, 0.42, 0.34), dustLine)
  material.roughnessNode = float(0.44).sub(keep.mul(0.05)).add(cavity.mul(0.08))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/**
 * Permanently running wet stone: the tazza dishes, the rims water pours over,
 * the plinth risers the splash never leaves. Carries a thin FLOWING FILM —
 * a scrolling gradient perturbation of the normal, moving downhill in world
 * space — which is the difference between "glossy stone" and "stone with
 * water on it".
 */
export function fountainStoneWet(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(26)
  const albedo = marbleAlbedo(positionWorld, keep)
  // The film's ripples travel DOWN the surface; a horizontal dish reads them
  // as slow radial drift, a vertical rim as fast streaming. One expression,
  // both behaviours, because the flow coordinate is world height.
  const flow = positionWorld.y.mul(6.5).sub(fountainTime.mul(1.35))
  const across = positionWorld.x.mul(3.1).add(positionWorld.z.mul(2.6))
  const film = mx_noise_float(vec2(across, flow).mul(1.7)).mul(keep)
  // Sheeting water is a MIRROR: roughness collapses, and the film's own
  // structure comes from the derivative bump below, not from roughness.
  material.colorNode = albedo.mul(0.42).mul(film.mul(0.1).add(0.96))
  material.roughnessNode = float(0.055).add(film.abs().mul(0.05))
  material.metalness = 0
  // A shallow relief so the film catches the low sun as moving highlights.
  material.normalNode = normalWorld
    .add(vec3(film.mul(0.055), 0, mx_noise_float(vec2(across.add(7.1), flow)).mul(0.055)))
    .normalize()
  applySpecularAA(material)
  return material
}

/**
 * The basin floor's albedo, in plan coordinates relative to the fountain axis.
 *
 * A dark aggregate terrazzo with cast-bronze inlay rings. Dark on purpose:
 * the refracted floor is what the eye reads as WATER DEPTH, and a pale floor
 * under 0.35 m of clear water reads as a wet tile patio. The bronze rings are
 * the one bright thing down there, so the caustic web has something to play
 * across and the depth gradient has a scale.
 */
export const basinFloorAlbedo = /*@__PURE__*/ Fn(([plan, keep]: [Node<'vec2'>, Node<'float'>]) => {
  const radius = plan.length()
  // Terrazzo: mid-tone matrix, pale chips. Two noise scales, the coarse one
  // selecting chip clusters so the aggregate does not read as uniform static.
  //
  // `keep` is a FOOTPRINT measure, not a distance one, and it is load-bearing.
  // The chips are 5 cm features on a floor seen through 0.3 m of refracting
  // water from a grazing angle, where one pixel can span a decimetre — and an
  // unfiltered 5 cm pattern under that sampling turns the whole basin into a
  // woven cross-hatch (the first pass's "wire mesh" basin). Both the chips and
  // the inlay dissolve into their own means before they can beat.
  // 13/m ≈ 8 cm aggregate. The first pass used 21/m (5 cm), which is finer
  // than a pixel of refracted floor at any grazing angle and therefore could
  // only ever be noise; a coarser aggregate survives the filtering long enough
  // to actually read as terrazzo.
  const chip = mx_noise_float(vec3(plan.x, plan.y, 0).mul(13.0)).mul(0.5).add(0.5)
  const cluster = mx_noise_float(vec3(plan.x, plan.y, 4.3).mul(2.6)).mul(0.5).add(0.5)
  const chips = smoothstep(0.58, 0.78, chip.mul(cluster.mul(0.5).add(0.72))).mul(keep)
  const matrix = mix(vec3(0.108, 0.098, 0.09), vec3(0.152, 0.136, 0.122), cluster)
  const terrazzo = mix(matrix, vec3(0.44, 0.415, 0.375), chips.mul(0.85))

  // Bronze inlay: concentric bands at a 0.94 m pitch, 60 mm wide. Wide enough
  // to survive the filtering that the aggregate cannot, so the floor keeps a
  // readable scale at range even once its speckle has gone.
  const band = abs(fract(radius.mul(1.0 / 0.94)).sub(0.5)).mul(0.94)
  const inlay = smoothstep(0.036, 0.024, band).mul(keep.mul(0.55).add(0.45))
  const bronze = vec3(0.226, 0.152, 0.07)
  return mix(terrazzo, bronze, inlay.mul(0.9))
})

/** The floor mesh's own material — the same albedo the water refracts to. */
export function fountainBasinFloor(center: { x: number; z: number }): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(24)
  const plan = vec2(positionWorld.x.sub(center.x), positionWorld.z.sub(center.z))
  material.colorNode = basinFloorAlbedo(plan, keep)
  // Submerged stone is never rough: it is a wetted, algae-free honed surface.
  material.roughnessNode = float(0.14)
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Patinated cast bronze: nozzles, bezels, the balustrade of the drip rings. */
export function fountainBronze(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(22)
  const patina = mx_noise_float(positionWorld.mul(3.4)).mul(0.5).add(0.5)
  const streak = mx_noise_float(vec3(positionWorld.x.mul(9), positionWorld.y.mul(1.3), positionWorld.z.mul(9)))
    .mul(0.5)
    .add(0.5)
    .mul(keep)
  // Bronze in permanent contact with water goes verdigris where it drains and
  // stays brown where it is polished by flow — the streak drives both.
  const body = mix(vec3(0.148, 0.096, 0.044), vec3(0.088, 0.118, 0.086), patina.mul(0.62))
  material.colorNode = mix(body, vec3(0.235, 0.163, 0.076), streak.mul(0.45))
  material.roughnessNode = float(0.36).sub(streak.mul(0.16)).add(patina.mul(0.14))
  material.metalnessNode = float(0.78).sub(patina.mul(0.3)) as unknown as Node<'float'>
  applySpecularAA(material)
  return material
}

/**
 * The coping cove strip and the submerged uplights. Warmer and dimmer than
 * the park's `floorLens` rung because these are seen THROUGH water and along
 * a grazing stone wash — the light that reaches the eye is the stone's, and
 * an over-driven emitter here just blooms the coping into a white worm.
 */
export function fountainLens(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  // Even edge-lit acrylic is not even; the mottle is why a 22 m run of strip
  // does not look like one extruded rectangle of light.
  const diffuser = mx_noise_float(positionWorld.mul(2.2)).mul(0.12).add(0.94)
  material.colorNode = vec3(0.88, 0.82, 0.72)
  material.emissiveNode = vec3(1.0, 0.79, 0.53).mul(diffuser).mul(2.35)
  material.roughness = 0.32
  material.metalness = 0
  return material
}

/** Planter soil — the park's one cultivated-earth identity, reused verbatim. */
export function fountainSoil(): MeshStandardNodeMaterial {
  return soilBed()
}

/** Slot map for the fountain's single merged PartWriter build. */
export function fountainMaterials(options: FountainStoneOptions): Record<string, MeshStandardNodeMaterial> {
  return {
    stone: fountainStone(options),
    sculpture: fountainSculptureStone(),
    stoneWet: fountainStoneWet(),
    bronze: fountainBronze(),
    basinFloor: fountainBasinFloor(options.center),
    lens: fountainLens(),
    soil: fountainSoil(),
  }
}

/** The palette's ivory as a plain colour, for any non-node consumer. */
export const STONE_IVORY = /*@__PURE__*/ new Color(0.775, 0.752, 0.706)
