import { Color, DoubleSide } from 'three'
import type { Texture } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  float,
  hash,
  instanceIndex,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { sunColorUniform, sunDirectionUniform } from '../sky/sun'

/**
 * The shared TSL foliage response. Everything green in the park is one of two
 * materials built here, so the whole planting lights coherently.
 *
 * ── THE SHADOW CONTRACT (r185, hard-won — do not break it) ──────────────────
 * Shadow maps render with ONE `scene.overrideMaterial`. Three copies only a
 * few things onto it (`Renderer._getShadowNodes`, `_renderObjectDirect`):
 *
 *   • `material.map`'s ALPHA is multiplied into the shadow alpha — this is the
 *     ONLY route by which an alpha-cut silhouette reaches the shadow pass.
 *     A foliage material that carries its cut-out purely in `colorNode` casts
 *     SOLID RECTANGLES.
 *   • `material.colorNode`'s alpha is ALSO multiplied in. So the cut-out must
 *     live in `opacityNode` and `colorNode.a` must be exactly 1 — otherwise
 *     the shadow silhouette erodes to `sqrt(alphaTest)` and thin leaf tips
 *     disappear from the dapple.
 *   • `material.alphaTest` (the NUMBER) is copied; `alphaTestNode` is NOT.
 *     Always set the scalar as well, or the shadow pass has no cut at all.
 *   • `material.positionNode` is reused as the shadow position node, so wind
 *     sway moves the shadow with the leaf for free.
 *
 * Hence every material below sets: `map` + `colorNode = vec4(tint, 1)` +
 * `opacityNode = map.a` + a real `alphaTest` number.
 */

/** Global wind authority: interior HVAC air, felt more than seen. */
export const foliageWind = /*@__PURE__*/ uniform(1)

const TAU = Math.PI * 2

/** Distance to the eye, for LOD terms. */
const viewDistance = /*@__PURE__*/ positionWorld.sub(cameraPosition).length()

/**
 * SeaPark's microstructure fade, local copy: 1 near, 0 past `far`. Written as
 * `1 - smoothstep(lo, hi, x)` because WGSL leaves reversed-edge smoothstep
 * implementation-defined (notes.md, W1-dome).
 */
export function detailKeep(far: number): Node<'float'> {
  return float(1).sub(smoothstep(far * 0.45, far, viewDistance)) as unknown as Node<'float'>
}

/** Per-instance random in [0,1) for instanced species. */
export function instanceSeed(): Node<'float'> {
  return hash(instanceIndex) as unknown as Node<'float'>
}

/**
 * A baked float vertex attribute as a chainable float node. `attribute()`
 * widens its node type to `string`, which loses every chaining method — this
 * is the one cast, in one place, rather than sprinkled through the builders.
 */
export function floatAttribute(name: string): Node<'float'> {
  return float(attribute(name, 'float') as unknown as number) as unknown as Node<'float'>
}

export interface FoliageOptions {
  map: Texture
  /** Per-instance (or per-vertex) random in [0,1): tint + wind phase. */
  seed: Node<'float'>
  /** 0 at the lit outside of a clump, 1 buried inside it. */
  depth?: Node<'float'>
  /** Card-local rooting weight, 0 at the attachment, 1 at the tip. */
  rootWeight?: Node<'float'>
  /** Multiplier applied to the painted art — shaded end of the ramp. */
  tintCool?: Color
  /** Multiplier applied to the painted art — sunlit end of the ramp. */
  tintWarm?: Color
  /** What the blade passes when the sun is behind it. */
  transmit?: Color
  /** Peak backlit radiance. Ladder rule: stay UNDER the 1.0 bloom threshold. */
  backlight?: number
  /** Metres of tip travel in the interior air. */
  sway?: number
  swaySpeed?: number
  alphaTest?: number
  /** Distance at which fine art detail and sway retire. */
  far?: number
  roughness?: number
}

/**
 * Alpha-cut foliage card material: painted art, a golden-green tint ramp, a
 * subsurface backlight term, and rooted interior-air sway.
 *
 * The backlight is the point of the whole material — the low frozen sun
 * shining THROUGH the ginkgo canopy and through the planter tops is the
 * park's second postcard. It is the Frostbite translucency approximation:
 * `pow(saturate(dot(-V, L)), k)`, with no normal term, because a double-sided
 * card has no meaningful side.
 */
export function createFoliageMaterial(options: FoliageOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const {
    map,
    seed,
    depth = float(0),
    rootWeight = uv().y,
    tintCool = new Color(0.78, 0.86, 0.8),
    tintWarm = new Color(1.16, 1.1, 0.86),
    transmit = new Color(0.46, 0.6, 0.2),
    backlight = 0.82,
    sway = 0.035,
    swaySpeed = 1,
    alphaTest = 0.34,
    far = 44,
    roughness = 0.78,
  } = options

  const art = texture(map)
  const keep = detailKeep(far)

  // ── Colour: one ramp, two causes. Height up the card warms the tone (the
  // tips catch more light), the per-instance seed spreads the clump apart so
  // twenty instances of one painting do not read as twenty copies.
  //
  // The weights are deliberately small. The first pass used 0.55/0.5/+0.1,
  // which SATURATES for almost every vertex — every leaf then got the full
  // warm end of the ramp and the whole canopy rendered cream. A tint ramp
  // that always returns 1 is not a ramp, it is a brightness multiplier.
  const warmth = saturate(
    rootWeight.mul(0.4).add(seed.mul(0.34)).add(float(0.04)).sub(depth.mul(0.5)),
  )
  const tint = mix(
    vec3(tintCool.r, tintCool.g, tintCool.b),
    vec3(tintWarm.r, tintWarm.g, tintWarm.b),
    warmth,
  )
  // Interior leaves sit in their own clump's shade — cheap self-occlusion
  // that costs nothing and is what stops a bush reading as a flat sticker.
  const occlusion = float(1).sub(depth.mul(0.42))
  // Retire the painted micro-contrast with distance: pull the art toward its
  // own mid-tone so venation cannot alias into shimmer across the boulevard.
  const artColor = mix(art.rgb.mul(0.55).add(0.12), art.rgb, keep)
  material.colorNode = vec4(artColor.mul(tint).mul(occlusion), 1)

  // ── The cut-out. `opacityNode`, never `colorNode.a` (see the contract).
  material.map = map
  material.opacityNode = art.a
  material.alphaTest = alphaTest
  // Far foliage dissolves if the test stays hard: mips erode thin alpha, so
  // relax the threshold with distance and let distant canopies stay dense.
  material.alphaTestNode = mix(float(alphaTest * 0.5), float(alphaTest), keep)

  // ── Backlight.
  const back = pow(saturate(positionViewDirection.negate().dot(sunDirectionUniform)), 2.6)
  const thickness = float(1).sub(depth.mul(0.8))
  material.emissiveNode = vec3(transmit.r, transmit.g, transmit.b)
    .mul(sunColorUniform)
    .mul(back)
    .mul(thickness)
    .mul(art.g.mul(3).min(1))
    .mul(backlight)

  // ── Rooted sway. Three detuned sines (the ash contract's wind), weighted by
  // the card's own rooting so the attachment point never moves.
  const phase = seed.mul(TAU)
  const t = time.mul(swaySpeed)
  const swing = sin(t.mul(0.55).add(phase))
    .mul(0.5)
    .add(sin(t.mul(0.93).add(phase.mul(1.31))).mul(0.3))
    .add(sin(t.mul(1.7).add(phase.mul(1.77))).mul(0.2))
  const cross = sin(t.mul(0.71).add(phase.mul(2.13)))
    .mul(0.5)
    .add(sin(t.mul(1.29).add(phase.mul(1.07))).mul(0.28))
  const amplitude = float(sway).mul(foliageWind).mul(rootWeight).mul(keep.mul(0.7).add(0.3))
  material.positionNode = positionLocal.add(
    vec3(swing.mul(amplitude), swing.mul(amplitude).mul(-0.18), cross.mul(amplitude)),
  )

  material.side = DoubleSide
  material.roughness = roughness
  material.metalness = 0
  return material
}

export interface BarkOptions {
  /** Colour of the corky crests. */
  crest?: Color
  /** Colour deep in the fissures. */
  fissure?: Color
  /** Dust that settles on upward-facing bark. */
  dust?: Color
  /** Cycles per metre of the coarse grain. Bark UVs here are METRIC. */
  grain?: number
  far?: number
  /**
   * Fissure field in [0,1]. Defaults to the baked `aRidge` attribute, which
   * ONLY exists on geometry grown by `firstTree.ts`. Anything that reaches
   * this material through `PartWriter` (which carries position/normal/uv and
   * nothing else) must pass a procedural substitute, or three logs
   * `AttributeNode: Vertex attribute "aRidge" not found` and the branch reads
   * as flat paint.
   */
  ridge?: Node<'float'>
}

/**
 * Bark. Two named causes drive colour AND roughness: the baked `aRidge`
 * fissure field — the very field that CUT the geometry, so form and colour
 * can never disagree — and a metric grain.
 *
 * Dust keys on `normalWorld.y`, not on height: horizontal surfaces weather by
 * settling, not by splash (notes.md, W1-dome — a height-keyed grime painted a
 * whole 300 m duct brown).
 */
export function createBarkMaterial(options: BarkOptions = {}): MeshStandardNodeMaterial {
  const {
    crest = new Color(0.236, 0.214, 0.188),
    fissure = new Color(0.062, 0.053, 0.045),
    dust = new Color(0.3, 0.268, 0.229),
    grain = 2.6,
    far = 26,
    ridge = floatAttribute('aRidge'),
  } = options
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(far)
  const coarse = mx_noise_float(vec2(uv().x.mul(24), uv().y.mul(grain))).mul(0.5).add(0.5)
  const fine = mx_noise_float(vec2(uv().x.mul(90), uv().y.mul(grain * 4.2))).mul(0.5).add(0.5)
  const band = smoothstep(0.3, 0.74, ridge.add(coarse.mul(0.22).sub(0.11)))
  const base = mix(
    vec3(fissure.r, fissure.g, fissure.b),
    vec3(crest.r, crest.g, crest.b),
    band,
  )
  const settle = saturate(normalWorld.y).mul(0.34)
  const dusted = mix(base, vec3(dust.r, dust.g, dust.b), settle)
  material.colorNode = dusted.mul(mix(float(1), fine.mul(0.24).add(0.88), keep))
  material.roughnessNode = mix(float(0.97), float(0.83), band)
  material.metalness = 0
  return material
}

/**
 * Rock. Bedding is read from world height with a dip, so the shading bands
 * agree with the geometry's own dipping beds; grit is the second cause and
 * moves roughness with colour.
 */
export function createRockMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const keep = detailKeep(38)
  const bed = positionWorld.y
    .mul(3.1)
    .add(positionWorld.x.mul(0.55))
    .add(positionWorld.z.mul(0.3))
  const bands = saturate(sin(bed).mul(0.5).add(0.5))
  const grit = mx_noise_float(vec2(positionWorld.x, positionWorld.z).mul(5.5).add(positionWorld.y.mul(4)))
    .mul(0.5)
    .add(0.5)
  const micro = mx_noise_float(vec2(positionWorld.x, positionWorld.z).mul(26)).mul(0.5).add(0.5)
  // Dark basalt, deliberately well below the regolith it sits on. A rock the
  // same value as the ground is invisible no matter how well it is modelled —
  // the first pass read as a tan soap bar for exactly this reason.
  const body = mix(vec3(0.086, 0.072, 0.062), vec3(0.184, 0.148, 0.12), bands.mul(0.62).add(grit.mul(0.38)))
  // Fines settle on ledges; the dome has no rain to wash them off. This is
  // what makes the bedding planes read: every tread catches dust, every riser
  // stays clean. The exponent matters — at pow(0.6) the mask snaps to full on
  // any near-horizontal facet and the rock reads as painted rectangles.
  const settle = saturate(normalWorld.y).pow(1.3).mul(0.46).mul(grit.mul(0.4).add(0.6))
  material.colorNode = mix(body, vec3(0.252, 0.202, 0.162), settle).mul(
    mix(float(1), micro.mul(0.22).add(0.89), keep),
  )
  material.roughnessNode = float(0.95).sub(bands.mul(0.12))
  material.metalness = 0
  return material
}

export interface BladeOptions {
  /** Blade cluster height in metres — the arc bend needs the true value. */
  height: number
  seed: Node<'float'>
  rootColor?: Color
  tipColor?: Color
  /** Second colour pair; a low-frequency field selects between the two. */
  rootColorAlt?: Color
  tipColorAlt?: Color
  transmit?: Color
  backlight?: number
  /** Peak bend, radians of arc at the tip. 0.35 is a calm interior. */
  bend?: number
  far?: number
}

/**
 * Geometric blade clusters (sedge tufts, the tree's ground collar). No alpha
 * card, no cut-out — real tapered strips, which is why they hold up at 0.4 m
 * inside a planter where a billboard falls apart.
 *
 * The bend is the meadow-grass system's EXACT inextensible circular arc, not a
 * sine offset: the blade keeps its length and the tip drops as it leans, so a
 * gust looks like grass rather than like stretching rubber.
 *
 *   phi = clamp(strength·intensity·3, 0, 1.48)
 *   a   = phi · t^1.5
 *   r   = height / phi
 *   arc = r·(1 − cos a)     drop = r·sin a − y
 */
export function createBladeMaterial(options: BladeOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const {
    height,
    seed,
    rootColor = new Color(0.052, 0.078, 0.036),
    tipColor = new Color(0.148, 0.196, 0.062),
    rootColorAlt = new Color(0.046, 0.086, 0.05),
    tipColorAlt = new Color(0.115, 0.175, 0.085),
    transmit = new Color(0.4, 0.56, 0.18),
    backlight = 0.7,
    bend = 0.34,
    far = 30,
  } = options

  const keep = detailKeep(far)
  const bladeT = saturate(positionLocal.y.div(height))
  // Two colour pairs selected by a slow field so a planter run has patches
  // rather than one flat green — the same two-named-causes discipline the
  // hard-surface materials use.
  const patch = saturate(
    sin(positionWorld.x.mul(0.21).add(positionWorld.z.mul(0.17))).mul(0.5).add(0.5).add(seed.mul(0.3).sub(0.15)),
  )
  const rootMix = mix(
    vec3(rootColor.r, rootColor.g, rootColor.b),
    vec3(rootColorAlt.r, rootColorAlt.g, rootColorAlt.b),
    patch,
  )
  const tipMix = mix(
    vec3(tipColor.r, tipColor.g, tipColor.b),
    vec3(tipColorAlt.r, tipColorAlt.g, tipColorAlt.b),
    patch,
  )
  // Root darkening is real occlusion: the base of a tuft never sees sky.
  const shade = mix(float(0.52), float(1), pow(bladeT, 0.7))
  material.colorNode = vec4(
    mix(rootMix, tipMix, pow(bladeT, 1.35)).mul(shade).mul(seed.mul(0.22).add(0.89)),
    1,
  )

  // Backlight: sedge is thin and glows hard when the sun is behind it.
  const back = pow(saturate(positionViewDirection.negate().dot(sunDirectionUniform)), 2.2)
  material.emissiveNode = vec3(transmit.r, transmit.g, transmit.b)
    .mul(sunColorUniform)
    .mul(back)
    .mul(pow(bladeT, 1.6))
    .mul(backlight)

  // The arc bend.
  const phase = seed.mul(TAU)
  const gust = sin(time.mul(0.37).add(positionWorld.x.mul(0.06)).add(positionWorld.z.mul(0.05)))
    .mul(0.5)
    .add(0.5)
  const chop = sin(time.mul(1.13).add(phase)).mul(0.5).add(0.5)
  const intensity = gust.mul(0.7).add(chop.mul(0.3)).mul(seed.mul(0.5).add(0.75))
  const phi = clamp(
    float(bend).mul(foliageWind).mul(intensity).mul(keep.mul(0.6).add(0.4)).add(0.02),
    0.02,
    1.48,
  )
  const angle = phi.mul(pow(bladeT, 1.5))
  const radius = float(height).div(phi)
  const arc = radius.mul(float(1).sub(cos(angle)))
  const drop = radius.mul(sin(angle)).sub(positionLocal.y)
  // Lean direction is per-instance, in the cluster's own frame.
  const dirAngle = seed.mul(TAU)
  material.positionNode = positionLocal.add(
    vec3(cos(dirAngle).mul(arc), drop, sin(dirAngle).mul(arc)),
  )

  material.side = DoubleSide
  material.roughness = 0.82
  material.metalness = 0
  return material
}
