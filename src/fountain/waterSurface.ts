import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  Fn,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  dot,
  exp,
  float,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  refract,
  screenSize,
  smoothstep,
  sqrt,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { latticeSunVisibility } from '../dome/latticeField'
import { marsAmbientIrradiance, marsSkyRadiance } from '../sky/skyRadiance'
import {
  ENVIRONMENT_INTENSITY,
  SUN_ELEVATION_DEG,
  SUN_LIGHT_INTENSITY,
  sunColorUniform,
  sunDirectionUniform,
} from '../sky/sun'
import { basinFloorAlbedo, marbleAlbedo } from './fountainMaterials'
import {
  BASIN_INNER_R,
  LOWER_TAZZA,
  PEDESTAL_TOP_Y,
  PLINTH_STEPS,
  UPPER_TAZZA,
  WATER_Y,
  basinFloorY,
} from './fountainPlan'
import { analyticDetail, fountainTime, seicheField } from './waterField'
import { SIM_SIZE } from './waterSim'
import type { FountainWaterSim } from './waterSim'

/**
 * THE BASIN SURFACE — a ray-traced pool volume, not a tinted plane.
 *
 * The basin is 0.3 m deep, bounded, and every surface under the water is a
 * primitive this module knows analytically: a dished floor disc, the coping's
 * inner cylinder, the island's riser cylinder. So the refracted view ray is
 * INTERSECTED against them and the hit is shaded on the spot, with the true
 * path length driving Beer–Lambert absorption and the analytic caustic gain
 * modulating the sun that reaches it.
 *
 * That is the whole reason this is not a screen-space refraction offset: a
 * heuristic UV push has no depth rejection, samples foreground objects, and
 * its "thickness" is a fudge — all three are named failure conditions. Here
 * the thickness IS the geometry, the parallax is correct at every angle, and
 * the shoreline against stone stays exact because the wall the ray hits is the
 * wall that is actually there.
 *
 * ## What the surface is NOT
 *
 * There is no planar reflector. Reflection is the analytic Mars sky plus an
 * ANALYTIC occlusion of the fountain's own masses (two tazza discs, the island
 * column, the coping ring) — the only local reflectors that matter, since
 * nothing else in the park is above this pool. The sun's mirror image is an
 * authored two-lobe glint rather than the sky function's 1800× disc, because
 * a 0.35° disc sampled through a rippled normal is an alias generator.
 *
 * ## Ownership
 *
 * The meso-scale field — height, gradient, caustic gain, foam — comes from
 * the SIMULATION (`waterSim.ts`); the capillary detail and the seiche from
 * `waterField.ts`; the floor's albedo from
 * `fountainMaterials.basinFloorAlbedo`, which is the same function the
 * physical floor mesh under the water is shaded with. Nothing in this file
 * re-authors any of them.
 */

/** Water's absorption per metre (pure water, RGB at 600/550/450 nm). */
const ABSORPTION = [0.45, 0.072, 0.017] as const
/** A trace of forward scattering — fountain water is aerated, never sterile. */
const SCATTER = [0.055, 0.078, 0.085] as const

const IOR_WATER = 1.333
const ETA = 1 / IOR_WATER

/**
 * The refracted sun, precomputed: the sun is frozen, so the direction light
 * travels once it is inside the water is a constant of this world.
 */
const sunZenith = ((90 - SUN_ELEVATION_DEG) * Math.PI) / 180
const refractedSunZenith = Math.asin(Math.sin(sunZenith) * ETA)
/** cos of the refracted ray's angle from vertical — the path-length divisor. */
const SUN_COS_T = Math.cos(refractedSunZenith)
/** Fresnel transmittance of the surface for the sun's own incidence. */
const SUN_TRANSMIT = (() => {
  const cosI = Math.cos(sunZenith)
  const cosT = SUN_COS_T
  const rs = ((cosI - IOR_WATER * cosT) / (cosI + IOR_WATER * cosT)) ** 2
  const rp = ((IOR_WATER * cosI - cosT) / (IOR_WATER * cosI + cosT)) ** 2
  return 1 - (rs + rp) / 2
})()

/** The island's radius at the waterline, and the coping's inner radius. */
const ISLAND_R = PLINTH_STEPS[0].radius
const RIM_R = BASIN_INNER_R

/**
 * Metres a pixel spans at a view-space position — projected here, projected
 * one metre up, differenced in NDC. Exact for any projection, needs no matrix
 * element access, and (unlike a screen-space derivative) it is CONTINUOUS.
 */
const metresPerPixel = /*@__PURE__*/ Fn(([viewPos]: [Node<'vec4'>]) => {
  const here = cameraProjectionMatrix.mul(viewPos)
  const above = cameraProjectionMatrix.mul(vec4(viewPos.x, viewPos.y.add(1.0), viewPos.z, viewPos.w))
  const ndcPerMetre = above.y.div(above.w).sub(here.y.div(here.w)).abs()
  return float(2).div(max(ndcPerMetre.mul(screenSize.y), 1e-4))
})

export interface WaterSurfaceOptions {
  /** World position of the fountain axis at the court's paved top. */
  center: Vector3
  /** The basin's heightfield simulation — the surface's meso-scale motion. */
  sim: FountainWaterSim
}

/**
 * Micro slope variance of moving water below every representable band —
 * sub-millimetre capillaries and surface turbulence. It is the floor the
 * specular roughness can never fall under, and the reason even glass-calm
 * fountain water shows a live sparkle rather than a laser-dot sun.
 */
const BASE_MICRO_VARIANCE = 0.0006

/**
 * Ray/cylinder-and-disc occlusion of the fountain's own masses.
 *
 * Returns 0 where `dir` from `origin` escapes to sky and 1 where it is blocked
 * by stone. Four primitives, chosen because they are the four masses that
 * actually shadow or reflect into this pool: the two tazze (as discs — from
 * below, a bowl IS its plan silhouette), the island-plus-figure column, and
 * the coping ring seen from inside.
 */
const fountainBlock = /*@__PURE__*/ Fn(
  ([origin, dir, center]: [Node<'vec3'>, Node<'vec3'>, Node<'vec3'>]) => {
    const blocked = float(0).toVar()
    const up = max(dir.y, 1e-3)

    // The two tazze, as horizontal discs at their belly height.
    const disc = (height: number, radius: number, softness: number) => {
      const t = float(height).add(center.y).sub(origin.y).div(up)
      const hit = origin.add(dir.mul(t))
      const planar = vec2(hit.x.sub(center.x), hit.z.sub(center.z)).length()
      // A soft edge: the bowl's rim is a moulding, not a razor, and a hard
      // silhouette in a reflection reads as a decal.
      return smoothstep(radius, radius - softness, planar).mul(t.greaterThan(0.0).select(1.0, 0.0))
    }
    blocked.assign(max(blocked, disc(LOWER_TAZZA.coreY + 0.24, LOWER_TAZZA.rimR + 0.04, 0.22)))
    blocked.assign(max(blocked, disc(UPPER_TAZZA.coreY + 0.16, UPPER_TAZZA.rimR + 0.04, 0.12)))

    // The island + figure group, as a vertical cylinder standing in the pool.
    // Solved as the near root of |p + t·d|² = R² with d the horizontal part.
    const p = vec2(origin.x.sub(center.x), origin.z.sub(center.z))
    const d = vec2(dir.x, dir.z)
    const dd = max(dot(d, d), 1e-6)
    const columnR = float(1.22)
    const b = dot(p, d)
    const disc2 = b.mul(b).sub(dd.mul(dot(p, p).sub(columnR.mul(columnR))))
    const tCol = b.negate().sub(sqrt(max(disc2, 0))).div(dd)
    const colY = origin.y.add(dir.y.mul(tCol)).sub(center.y)
    const hitsColumn = disc2
      .greaterThan(0.0)
      .and(tCol.greaterThan(0.02))
      .and(colY.lessThan(LOWER_TAZZA.coreY))
      .and(colY.greaterThan(PEDESTAL_TOP_Y - 0.9))
      .select(1.0, 0.0)
    blocked.assign(max(blocked, hitsColumn))

    return blocked.min(1)
  },
)

/**
 * The lit radiance of a submerged surface. One convention, matched to the rest
 * of the park: `albedo · (ambient·envIntensity + sunColor·intensity·N·L/π)`.
 */
const submergedRadiance = /*@__PURE__*/ Fn(
  ([albedo, normal, ndotl, caustic, sunVisible, pathToFloor]: [
    Node<'vec3'>,
    Node<'vec3'>,
    Node<'float'>,
    Node<'float'>,
    Node<'float'>,
    Node<'float'>,
  ]) => {
    const absorb = vec3(ABSORPTION[0], ABSORPTION[1], ABSORPTION[2])
    // The sun is attenuated on the way DOWN as well as on the way back up;
    // this is the down leg, and it is why a caustic filament reads warm-white
    // rather than pure white even in 30 cm of water.
    const down = exp(absorb.mul(pathToFloor).negate())
    const sun = sunColorUniform
      .mul(SUN_LIGHT_INTENSITY * SUN_TRANSMIT)
      .mul(ndotl)
      .mul(1 / Math.PI)
      .mul(caustic)
      .mul(sunVisible)
      .mul(down)
    // Ambient reaches the floor through the same interface, minus what the
    // fountain's own mass blocks overhead.
    const ambient = marsAmbientIrradiance(normal).mul(ENVIRONMENT_INTENSITY * 0.86)
    return albedo.mul(ambient.add(sun))
  },
)

/**
 * FOAM — the SIMULATED aeration field, shaped, plus the two static residues.
 *
 * The load-bearing input is the sim's foam channel: it was injected by the
 * same impact events that raised the waves, diffused and decayed in place, so
 * it sits exactly where water is landing THIS second — including everywhere
 * the jets' aim wander drags their rings. The analytic landing bands the
 * first pass painted here are gone; a band centred on a nominal radius is a
 * decal once the landing point actually moves.
 *
 * What stays authored: the thin scum lines both shorelines hold (a statics
 * problem, not a dynamics one — floating residue collects against walls), a
 * churn noise that keeps large foam sheets from reading as airbrush, and
 * crest whitening off the local slope.
 */
const foamMask = /*@__PURE__*/ Fn(
  ([planXZ, radius, slope, simFoam]: [
    Node<'vec2'>,
    Node<'float'>,
    Node<'float'>,
    Node<'float'>,
  ]) => {
    const churn = mx_noise_float(
      vec3(planXZ.x.mul(2.6), planXZ.y.mul(2.6), fountainTime.mul(0.85)),
    )
      .mul(0.5)
      .add(0.5)
    const aeration = simFoam.mul(churn.mul(0.7).add(0.72))
    // Shorelines: the wall and the island both hold a thin line of scum-foam.
    const shore = max(
      float(1).sub(radius.sub(RIM_R).abs().div(0.14).min(1)),
      float(1).sub(radius.sub(ISLAND_R).abs().div(0.12).min(1)),
    ).mul(churn.mul(0.4).add(0.24))
    const crest = slope.mul(9).clamp(0, 1)
    return smoothstep(0.07, 0.58, max(aeration, shore)).add(crest.mul(0.16)).min(1)
  },
)

/**
 * Build the surface material. `center` must be the same world anchor the
 * stonework used, or the ripple rings will not be concentric with the basin.
 */
export function fountainWaterMaterial(options: WaterSurfaceOptions): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const center = uniform(options.center)
  const centerXZ = vec2(center.x, center.z)
  const { sim } = options

  /** Plan offset from the axis → the sim texture's uv. */
  const simUvOf = (planXZ: Node<'vec2'>) => planXZ.add(SIM_SIZE / 2).div(SIM_SIZE)

  // ── vertex: macro displacement only — the SIMULATED field plus the seiche.
  // The surface mesh is a polar grid bunched toward the island, and the sim's
  // 28 mm texels resolve every ring it carries; the capillary bands live in
  // the normal, where they belong.
  //
  // `positionNode` is LOCAL space. The mesh's geometry is authored in world
  // coordinates on an identity transform (see `fountainWaterMesh`), so local
  // and world coincide here — stated rather than assumed, because the moment
  // someone parents this mesh to a moved group the ripple centre goes with it.
  material.positionNode = Fn(() => {
    const local = positionLocal
    const planXZ = vec2(local.x.sub(center.x), local.z.sub(center.z))
    const h = sim.stateNode.sample(simUvOf(planXZ)).x.add(seicheField(planXZ).x)
    return vec3(local.x, local.y.add(h), local.z)
  })()

  material.colorNode = Fn(() => {
    const world = positionWorld
    const planXZ = vec2(world.x.sub(center.x), world.z.sub(center.z)).toVar()
    const radius = max(planXZ.length(), 1e-3).toVar()

    const view = normalize(cameraPosition.sub(world)).toVar()

    // ── THE FOOTPRINT, ANALYTICALLY.
    //
    // Metres of surface crossed by one output pixel: the competence measure
    // every micro band and every floor detail is faded against. It is computed
    // from the projection and the incidence angle rather than from
    // `dFdx(position)`, and that is not a preference — screen-space
    // derivatives of a linearly interpolated varying are CONSTANT ACROSS A
    // TRIANGLE, so driving a steep fade from them stamps the mesh's own quad
    // grid onto the water as a wire lattice at grazing angles. (Shipped once;
    // the symptom is a woven screen lying on the basin.) This measure is
    // smooth everywhere, and it is the same quantity: pixel angle × range,
    // divided by the cosine of incidence.
    const flatNdotV = max(view.y.abs(), 0.06)
    const footprint = metresPerPixel(cameraViewMatrix.mul(vec4(world, 1.0)))
      .div(flatNdotV)
      .toVar()

    // ── THE FIELD: simulated meso-scale + analytic capillary + the seiche.
    //
    // The sim's single bilinear tap has its own competence limit: once a
    // pixel spans several 28 mm texels the tap point-samples a field it
    // should be averaging, which is the same aliasing class the chop bands
    // obey. So the sim gradient fades on the footprint too — and BOTH fades
    // pay their energy into σ², the slope variance the specular lobe widens
    // by. Detail leaves the geometry by becoming roughness, never by
    // vanishing: that is why the water's sparkle dims into a sheen with
    // distance instead of the pool going matte.
    const simDeriv = sim.derivNode.sample(simUvOf(planXZ)).toVar()
    const wSim = float(1).sub(smoothstep(0.035, 0.13, footprint)).toVar()
    const detail = analyticDetail(planXZ, footprint).toVar()
    const seiche = seicheField(planXZ)
    const gx = simDeriv.x.mul(wSim).add(detail.y).add(seiche.y)
    const gz = simDeriv.y.mul(wSim).add(detail.z).add(seiche.z)
    const normal = normalize(vec3(gx.negate(), 1.0, gz.negate())).toVar()
    const simSlope2 = simDeriv.x.mul(simDeriv.x).add(simDeriv.y.mul(simDeriv.y))
    const sigma2 = detail.w
      .add(simSlope2.mul(float(1).sub(wSim.mul(wSim))).mul(0.5))
      .add(BASE_MICRO_VARIANCE)
      .toVar()
    const ndotv = max(dot(normal, view), 1e-3).toVar()
    const f0 = float(((1 - ETA) / (1 + ETA)) ** 2 + 0.025)
    const fresnel = f0.add(float(1).sub(f0).mul(pow(float(1).sub(ndotv), 5.0))).toVar()

    // ── REFRACTION: intersect the pool volume, analytically.
    const refracted = refract(view.negate(), normal, float(ETA)).toVar()
    const down = max(refracted.y.negate(), 0.12).toVar()
    const floorLocal = float(0).toVar()
    // The floor dishes, so solve its height at the ray's own landing point
    // rather than under the eye — one fixed-point step is exact to a
    // millimetre over a 40 mm dish.
    floorLocal.assign(basinFloorLocal(radius))
    const depth0 = world.y.sub(center.y).sub(floorLocal).toVar()
    const guess = world.add(refracted.mul(depth0.div(down)))
    const guessR = vec2(guess.x.sub(center.x), guess.z.sub(center.z)).length()
    floorLocal.assign(basinFloorLocal(guessR))
    const depth = max(world.y.sub(center.y).sub(floorLocal), 0.02).toVar()
    const tFloor = depth.div(down).toVar()

    // The coping's inner cylinder, hit from inside; and the island's riser,
    // hit from outside. Both matter: the refracted image is displaced by up to
    // 0.34 m, which is exactly the width of the visible band at each shore.
    const d2 = vec2(refracted.x, refracted.z).toVar()
    const dd = max(dot(d2, d2), 1e-7).toVar()
    const b = dot(planXZ, d2).toVar()
    const rimDisc = b.mul(b).add(dd.mul(float(RIM_R * RIM_R).sub(dot(planXZ, planXZ))))
    const tRim = b.negate().add(sqrt(max(rimDisc, 0))).div(dd).toVar()
    const islandDisc = b.mul(b).sub(dd.mul(dot(planXZ, planXZ).sub(ISLAND_R * ISLAND_R)))
    const tIslandRaw = b.negate().sub(sqrt(max(islandDisc, 0))).div(dd)
    const tIsland = islandDisc
      .greaterThan(0.0)
      .and(tIslandRaw.greaterThan(0.0))
      .select(tIslandRaw, float(1e4))
      .toVar()

    const tHit = min(tFloor, min(tRim, tIsland)).toVar()
    const hit = world.add(refracted.mul(tHit)).toVar()
    const hitPlan = vec2(hit.x.sub(center.x), hit.z.sub(center.z)).toVar()
    const onFloor = tHit.greaterThanEqual(min(tRim, tIsland).sub(1e-4)).select(0.0, 1.0).toVar()

    // ── the hit's albedo and normal
    //
    // COST DISCIPLINE. This shader runs over a 150 m² surface that fills the
    // lower half of the frame from any bench in the court, so every term here
    // is one someone has to pay for at full resolution. The submerged wall is
    // a CONSTANT wet-marble tone rather than a `marbleAlbedo` evaluation: that
    // function costs five gradient-noise lookups, and it is being asked to
    // describe stone seen through 0.3 m of moving water inside a 30 cm band at
    // the shoreline. Nobody can resolve its veining there, and paying for it
    // twice per pixel (once for the wall, once for the reflected mass) is what
    // took this surface from 43 fps to 6.
    // The floor's detail budget is set by the PIXEL FOOTPRINT of the refracted
    // hit, not by camera distance: a grazing view a few metres away spans more
    // floor per pixel than a head-on view at twenty, and it is the grazing one
    // that aliases. `footprint` already measures exactly that.
    const keep = float(1).sub(smoothstep(0.008, 0.038, footprint))
    const albedo = mix(vec3(0.34, 0.325, 0.3), basinFloorAlbedo(hitPlan, keep), onFloor).toVar()
    const wallNormal = vec3(hitPlan.x, 0, hitPlan.y).normalize().negate()
    const hitNormal = mix(wallNormal, vec3(0, 1, 0), onFloor).normalize().toVar()

    // ── caustics: the sun's entry point for THIS floor point, then the
    // analytic differential-area gain of the field there.
    const sunT = vec3(
      sunDirectionUniform.x.negate(),
      float(-SUN_COS_T),
      sunDirectionUniform.z.negate(),
    ).normalize()
    const sunPath = world.y.sub(hit.y).div(SUN_COS_T).toVar()
    const entry = vec2(hit.x, hit.z).sub(vec2(sunT.x, sunT.z).mul(sunPath))
    // The differential-area gain 1/|det(I + βH)| is PRECOMPUTED by the sim's
    // derive kernel (simulated Hessian + analytic capillary Hessian), so the
    // web here is one texture tap at the sun's entry point for THIS floor
    // point. It still obeys the competence rule: past ~8 cm per pixel it
    // dissolves into its own mean (1.0, since differential-area reprojection
    // conserves flux) rather than sparkling.
    const caustic = mix(
      float(1),
      mix(float(1), sim.derivNode.sample(simUvOf(entry.sub(centerXZ))).z, keep),
      onFloor,
    ).toVar()
    // ONE lattice sample and ONE mass test, at the surface. The floor hit is
    // at most 0.35 m below and 0.34 m across from it — far inside the dome
    // lattice's 11.5 m ring pitch and well inside the tazza's own silhouette —
    // so a second evaluation buys nothing and costs a full lattice march.
    const latticeHere = latticeSunVisibility(world).toVar()
    const sunBlocked = fountainBlock(world, sunDirectionUniform, center).toVar()
    const sunVisible = float(1).sub(sunBlocked).mul(latticeHere).toVar()
    const ndotl = max(dot(hitNormal, sunT.negate()), 0)

    const body = submergedRadiance(albedo, hitNormal, ndotl, caustic, sunVisible, sunPath).toVar()

    // Beer–Lambert on the way back UP to the eye, over the true path length.
    const absorb = vec3(ABSORPTION[0], ABSORPTION[1], ABSORPTION[2])
    const transmittance = exp(absorb.mul(tHit).negate())
    // Aerated fountain water carries a little in-scatter of its own; it is
    // what stops 30 cm of water reading as a sheet of glass. Under a landing
    // zone the column is genuinely full of entrained bubbles — the sim's foam
    // channel is exactly a map of where — so the milkiness follows the plunge.
    const inscatter = vec3(SCATTER[0], SCATTER[1], SCATTER[2])
      .mul(marsAmbientIrradiance(vec3(0, 1, 0)))
      .mul(float(1).sub(transmittance))
      .mul(simDeriv.w.mul(3.2).add(2.4))
    const transmitted = body.mul(transmittance).add(inscatter).toVar()

    // ── REFLECTION: the analytic sky, occluded by the fountain's own mass.
    const bounce = reflect(view.negate(), normal).toVar()
    // The disc is deliberately OFF (`0`): a 0.35° sun sampled through a
    // rippled normal aliases into crawling white dots. The glint below is the
    // authored replacement, wide enough to survive a pixel footprint.
    // The aureole term survives `discStrength = 0` and is ~1.3° wide, which is
    // a sub-pixel spike on a rippled normal; the clamp retires it and lets the
    // authored glint below own the sun's mirror image instead.
    const sky = marsSkyRadiance(bounce, float(0)).min(vec3(5.0)).mul(0.94).toVar()
    const massed = fountainBlock(world, bounce, center).toVar()
    // What the fountain's stone returns in this light. A CONSTANT ivory, not a
    // marble evaluation: this is the reflection of a mass three metres away in
    // a surface that is never flat, so its veining is gone before it arrives.
    const stoneRadiance = vec3(0.775, 0.752, 0.706).mul(
      marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY).add(0.16),
    )
    // The coping ring above the waterline: a low band all the way round, hit
    // by any ray heading outward and slightly up. Cheap, and it is the bright
    // line the eye reads as "the pool has an edge".
    const towardRim = smoothstep(RIM_R - 1.6, RIM_R, radius).mul(
      smoothstep(0.34, 0.06, bounce.y),
    )
    const localMass = max(massed, towardRim.mul(0.85)).toVar()
    const reflection = mix(sky, stoneRadiance, localMass).toVar()

    // ── THE SUN'S MIRROR IMAGE: a filtered microfacet lobe, not an authored
    // power pair. The roughness IS the slope variance every unresolved band
    // paid in above (α² = 2σ², the Toksvig mapping), floored by the water's
    // own micro-turbulence — so up close the resolved wavelets flash the sun
    // as real geometry with a near-mirror lobe, and with distance the same
    // energy widens the lobe into the smooth sheen a photograph shows. The
    // anti-aliasing is IN the BRDF; nothing here needs a footprint fade of
    // its own. GGX with height-correlated Smith visibility; the clamp keeps
    // a grazing streak inside what bloom can carry gracefully.
    const skyVisible = float(1).sub(localMass).mul(sunVisible)
    const alpha2 = sigma2.mul(2).toVar()
    const halfway = normalize(view.add(sunDirectionUniform)).toVar()
    const noh = max(dot(normal, halfway), 0).toVar()
    const nol = max(dot(normal, sunDirectionUniform), 1e-3).toVar()
    const voh = max(dot(view, halfway), 1e-3)
    const dDenom = noh.mul(noh).mul(alpha2.sub(1)).add(1)
    const dGgx = alpha2.div(dDenom.mul(dDenom).mul(Math.PI))
    const visSmith = float(0.5).div(
      nol
        .mul(sqrt(ndotv.mul(ndotv).mul(float(1).sub(alpha2)).add(alpha2)))
        .add(ndotv.mul(sqrt(nol.mul(nol).mul(float(1).sub(alpha2)).add(alpha2)))),
    )
    const fSpec = f0.add(float(1).sub(f0).mul(pow(float(1).sub(voh), 5.0)))
    const glint = sunColorUniform
      .mul(SUN_LIGHT_INTENSITY)
      .mul(fSpec.mul(dGgx).mul(visSmith).mul(nol))
      .mul(skyVisible)
      .min(vec3(11.0))

    const slope = float(1).sub(normal.y).clamp(0, 1)
    const foam = foamMask(planXZ, radius, slope, simDeriv.w).toVar()
    const foamRadiance = vec3(0.82, 0.79, 0.75).mul(
      marsAmbientIrradiance(vec3(0, 1, 0))
        .mul(ENVIRONMENT_INTENSITY)
        .add(sunColorUniform.mul((SUN_LIGHT_INTENSITY * Math.sin((SUN_ELEVATION_DEG * Math.PI) / 180)) / Math.PI).mul(skyVisible)),
    )

    const water = mix(transmitted, reflection, fresnel).add(glint)
    return vec4(mix(water, foamRadiance, foam.mul(0.88)), 1.0)
  })()

  material.transparent = false
  material.depthWrite = true
  return material
}

/** The basin floor's local height at a radius, as a node (mirrors `basinFloorY`). */
function basinFloorLocal(radius: Node<'float'>): Node<'float'> {
  const inner = ISLAND_R
  const outer = BASIN_INNER_R
  const t = radius.sub(inner).div(outer - inner).clamp(0, 1)
  const eased = t.mul(t).mul(float(3).sub(t.mul(2)))
  return float(basinFloorY(inner)).add(
    eased.mul(basinFloorY(outer) - basinFloorY(inner)),
  ) as unknown as Node<'float'>
}

/**
 * The surface mesh: a polar annulus running 60 mm INTO the island's riser and
 * 50 mm INTO the coping's inner face, so the waterline has no boundary edge
 * anywhere — the shoreline you see is stone crossing water, which is what a
 * shoreline is.
 */
export function fountainWaterMesh(options: WaterSurfaceOptions): Mesh {
  const angular = 288
  const radial = 72
  const rInner = ISLAND_R - 0.06
  const rOuter = BASIN_INNER_R + 0.05
  const y = options.center.y + WATER_Y

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= radial; i++) {
    // Radial stations bunch toward the island, where the curtain lands and the
    // rings are tightest; the outer half only carries long spent waves.
    const t = i / radial
    const eased = t * (0.62 + 0.38 * t)
    const r = rInner + (rOuter - rInner) * eased
    for (let s = 0; s <= angular; s++) {
      const theta = (s / angular) * Math.PI * 2
      positions.push(options.center.x + Math.cos(theta) * r, y, options.center.z + Math.sin(theta) * r)
      normals.push(0, 1, 0)
      uvs.push(s / angular, eased)
    }
  }
  const stride = angular + 1
  for (let i = 0; i < radial; i++) {
    for (let s = 0; s < angular; s++) {
      const a = i * stride + s
      const b = a + 1
      const c = a + stride
      const d = c + 1
      // (a → b) is +θ and (a → c) is +radius, so θ̂ × r̂ is +Y and THIS is the
      // order that faces up. The reverse — which is what shipped first — makes
      // a downward-facing surface that back-face culling deletes outright, and
      // the symptom is not "the water looks wrong" but "the water is not
      // there", which is a much harder thing to see in a screenshot.
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  const mesh = new Mesh(geometry, fountainWaterMaterial(options))
  mesh.name = 'fountain-water'
  // Water casts no shadow (the sun goes through it) and receives none: this
  // material owns its whole lighting response, including the analytic sun
  // occlusion by the fountain's own mass.
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/** Tazza dish water: the same optics at a much smaller, calmer scale. */
export function tazzaWaterMesh(
  center: Vector3,
  spec: { dishRimR: number; dishRimY: number; dishCenterY: number; dishCenterR: number },
): Mesh {
  const segments = 96
  const rings = 8
  const level = spec.dishCenterY + (spec.dishRimY - spec.dishCenterY) * 0.78
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= rings; i++) {
    const r = (spec.dishCenterR * 0.4 + (spec.dishRimR * 0.965 - spec.dishCenterR * 0.4) * i) / rings
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2
      positions.push(center.x + Math.cos(theta) * r, center.y + level, center.z + Math.sin(theta) * r)
      normals.push(0, 1, 0)
      uvs.push(s / segments, i / rings)
    }
  }
  const stride = segments + 1
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * stride + s
      // Up-facing winding — see the note in `fountainWaterMesh`.
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  const mesh = new Mesh(geometry, tazzaWaterMaterial(center, level))
  mesh.name = 'fountain-tazza-water'
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * A tazza's standing water: 60 mm deep, permanently disturbed by the jet
 * landing in it and drawing outward to the rim. Too shallow for the basin's
 * ray-traced volume to be worth it, so this is the honest cheap sibling — a
 * Fresnel mix of the sky against the wet stone under it, with the same field
 * driving the normal so the two surfaces move like the same substance.
 */
function tazzaWaterMaterial(center: Vector3, level: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const anchor = uniform(new Vector3(center.x, center.y + level, center.z))
  material.colorNode = Fn(() => {
    const world = positionWorld
    const planXZ = vec2(world.x.sub(anchor.x), world.z.sub(anchor.z)).toVar()
    const radius = max(planXZ.length(), 1e-3).toVar()
    // Water drawn toward a rim it is about to leave: rings travel OUTWARD and
    // shorten as the film thins, which is why the wavenumber rises with r.
    const phase = radius.mul(radius.mul(6.0).add(26.0)).sub(fountainTime.mul(9.0))
    const amp = float(0.0019).div(radius.mul(1.4).add(0.5))
    const slopeR = amp.mul(cos(phase)).mul(radius.mul(12.0).add(26.0))
    const chop = mx_noise_float(vec3(world.x.mul(34), fountainTime.mul(1.6), world.z.mul(34))).mul(0.02)
    const normal = normalize(
      vec3(slopeR.mul(planXZ.x.div(radius)).negate().add(chop), 1.0, slopeR.mul(planXZ.y.div(radius)).negate().sub(chop)),
    ).toVar()
    const view = normalize(cameraPosition.sub(world)).toVar()
    const ndotv = max(dot(normal, view), 1e-3)
    const f0 = float(((1 - ETA) / (1 + ETA)) ** 2 + 0.025)
    const fresnel = f0.add(float(1).sub(f0).mul(pow(float(1).sub(ndotv), 5.0)))
    const bounce = reflect(view.negate(), normal)
    const sky = marsSkyRadiance(bounce, float(0)).mul(0.94)
    const keep = float(1).sub(smoothstep(9.0, 22.0, cameraPosition.distance(world)))
    const bed = marbleAlbedo(world, keep)
      .mul(0.34)
      .mul(marsAmbientIrradiance(vec3(0, 1, 0)).mul(ENVIRONMENT_INTENSITY).add(0.22))
    const sunAlign = max(dot(bounce, sunDirectionUniform), 0)
    const glint = sunColorUniform.mul(pow(sunAlign, 900.0).mul(5.0)).mul(latticeSunVisibility(world))
    return vec4(mix(bed, sky, fresnel).add(glint), 1.0)
  })()
  material.transparent = false
  material.depthWrite = true
  return material
}
