import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  attribute,
  dFdx,
  dFdy,
  float,
  fwidth,
  hash,
  max,
  min,
  mix,
  mx_noise_float,
  normalLocal,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { applySpecularAA } from '../materials/library'
import { PAVE } from './pavingPlan'

/**
 * Every lit surface of the park FLOOR: regolith, sintered paving, the white
 * concrete of curbs/planters/steps, the tram channel, floor-light bezels and
 * lenses, and scattered clasts.
 *
 * Field discipline (threejs-procedural-fields): one stable coordinate domain
 * per cause. Regolith reads WORLD XZ (it is geology, and it must be continuous
 * across the floor mesh, the scatter and the dust bands). Paving reads a baked
 * PANEL coordinate (`uv`) plus a baked edge/along/traffic vector (`pav`), so
 * the panel grid follows the pour — concentric on the plaza, along-run on the
 * spokes — with joint widths still measured in true metres.
 *
 * Relief is derivative bump, not normal maps (geometry-craft: this codebase
 * carries no tangents). `groundNormal()` recovers the TRUE world-space
 * gradient from screen derivatives, so bump strength is scale-correct instead
 * of drifting with the pixel footprint, and fades out once a feature is
 * smaller than a pixel.
 */

const worldXZ = vec2(positionWorld.x, positionWorld.z)

type F = Node<'float'>
type V2 = Node<'vec2'>
type V3 = Node<'vec3'>

const noise = (p: V2, scale: number, offset: number | F = 0): F =>
  mx_noise_float(p.mul(scale).add(offset as number)).mul(0.5).add(0.5) as unknown as F

/** World-space pixel footprint in metres — the LOD ruler for every detail. */
function pixelFootprint(): F {
  const dPdx = dFdx(positionWorld)
  const dPdy = dFdy(positionWorld)
  return max(dPdx.length(), dPdy.length()) as unknown as F
}

/**
 * True world-XZ gradient of a procedural height field, solved from the screen
 * derivatives of both the height and the world position (a 2×2 inverse). The
 * naive `dFdx(h)` bump used by three's BumpMapNode normalizes the position
 * derivatives away and therefore changes strength with distance; this does not.
 */
function worldGradient(height: F): V2 {
  const dPdx = dFdx(positionWorld)
  const dPdy = dFdy(positionWorld)
  const a = dPdx.x
  const b = dPdx.z
  const c = dPdy.x
  const d = dPdy.z
  const det = a.mul(d).sub(b.mul(c))
  const detAbs = det.abs().max(1e-7)
  const detSafe = select(det.lessThan(0), detAbs.negate(), detAbs)
  const hx = dFdx(height)
  const hy = dFdy(height)
  const gx = d.mul(hx).sub(b.mul(hy)).div(detSafe)
  const gz = a.mul(hy).sub(c.mul(hx)).div(detSafe)
  return vec2(gx.clamp(-6, 6), gz.clamp(-6, 6)) as unknown as V2
}

/**
 * Perturb the interpolated normal by a world-XZ height gradient. Valid for
 * near-horizontal surfaces (the whole floor); vertical parts get their relief
 * from albedo/roughness instead.
 */
function groundNormal(height: F, strength: F | number = 1): Node<'vec3'> {
  const gradient = worldGradient(height).mul(strength)
  const perturbed = normalLocal.add(vec3(gradient.x.negate(), 0, gradient.y.negate()))
  return transformNormalToView(perturbed.normalize())
}

// ------------------------------------------------------------- regolith ----

/** Wind bearing for aeolian ripples + streaks (matches the frozen sun side). */
const WIND = { x: Math.cos(2.35), z: Math.sin(2.35) }

/**
 * Aeolian + clastic relief, in metres. One field feeds BOTH the normal and
 * the albedo so ripples, pebbles and grit agree with their own shading.
 */
function regolithRelief(p: V2, openness: F, rippleFade: F, microFade: F): F {
  // Ripples: 0.55 m crest spacing, domain-warped so they meander like real
  // transverse ripples instead of reading as a sine grating. They are the
  // hero of every grazing view, so their LOD fade is keyed to their OWN
  // wavelength (alias at footprint ≈ λ/2), not to a global detail cutoff.
  const along = p.x.mul(WIND.x).add(p.y.mul(WIND.z))
  const across = p.x.mul(-WIND.z).add(p.y.mul(WIND.x))
  const warp = noise(p, 0.09, 4.1).sub(0.5).mul(3.4).add(noise(p, 0.42, 19.7).sub(0.5).mul(0.55))
  const crest = along.mul(11.42).add(warp).add(across.mul(0.12)).sin()
  const crest2 = along.mul(20.1).add(warp.mul(1.7)).sin()
  const rippleZone = smoothstep(0.42, 0.72, noise(p, 0.055, 31.3))
  const ripple = crest.mul(0.017).add(crest2.mul(0.005)).mul(rippleZone).mul(rippleFade)

  // Clasts: one pebble per 0.34 m cell, radius and tone hashed per cell.
  const cellScale = float(2.95)
  const cell = p.mul(cellScale)
  const id = cell.floor()
  const f = cell.fract()
  const seed = id.x.mul(127.31).add(id.y.mul(311.7))
  const centre = vec2(hash(seed).mul(0.5).add(0.25), hash(seed.add(37.1)).mul(0.5).add(0.25))
  const radius = hash(seed.add(11.7)).mul(0.16).add(0.1)
  const distance = f.sub(centre).length()
  const present = smoothstep(0.63, 0.78, hash(seed.add(91.3)))
  const dome = float(1).sub(smoothstep(radius.mul(0.35), radius, distance))
  const pebble = dome.mul(present)
  const pebbleHeight = pebble.mul(radius).mul(0.34).div(cellScale)

  const grit = noise(p, 5.5, 63.1).sub(0.5).mul(0.006)
  return ripple
    .add(pebbleHeight.add(grit).mul(microFade))
    .mul(openness) as unknown as F
}

/** Pebble coverage mask alone (albedo needs it without the ripple term). */
function regolithClasts(p: V2): F {
  const cell = p.mul(2.95)
  const id = cell.floor()
  const f = cell.fract()
  const seed = id.x.mul(127.31).add(id.y.mul(311.7))
  const centre = vec2(hash(seed).mul(0.5).add(0.25), hash(seed.add(37.1)).mul(0.5).add(0.25))
  const radius = hash(seed.add(11.7)).mul(0.16).add(0.1)
  const distance = f.sub(centre).length()
  const present = smoothstep(0.63, 0.78, hash(seed.add(91.3)))
  return float(1)
    .sub(smoothstep(radius.mul(0.55), radius.mul(1.02), distance))
    .mul(present) as unknown as F
}

/**
 * The hero regolith. Multi-scale albedo (fines vs gravel zones, streaks,
 * patches), embedded clasts, aeolian ripple relief, compacted desire lines,
 * and a dust berm banking against every curb.
 *
 * Attributes baked by groundworks: `wear` (desire lines), `garden` (raked
 * zones), `paved` (metres to the nearest paved boundary, clamped).
 */
export function createRegolithMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const wear = attribute('wear', 'float') as unknown as F
  const garden = attribute('garden', 'float') as unknown as F
  const pavedDistance = attribute('paved', 'float') as unknown as F

  const macro = noise(worldXZ, 1 / 74)
  const patch = noise(worldXZ, 1 / 19, 11.3)
  const grain = noise(worldXZ, 1 / 6.5, 47.1)
  const fine = noise(worldXZ, 1 / 1.6, 91.7)

  // Wind-aligned fields, stretched 6–8:1 along the bearing: pale dust drifts
  // and the darker deflation tails behind every obstacle. The single
  // strongest "this is Mars, not a beach" cue.
  const windU = worldXZ.x.mul(WIND.x).add(worldXZ.y.mul(WIND.z))
  const windV = worldXZ.x.mul(-WIND.z).add(worldXZ.y.mul(WIND.x))
  const drift = smoothstep(
    0.52,
    0.76,
    noise(vec2(windU.mul(0.021), windV.mul(0.14)) as unknown as V2, 1, 77.7),
  )
  const tail = smoothstep(
    0.58,
    0.82,
    noise(vec2(windU.mul(0.05), windV.mul(0.34)) as unknown as V2, 1, 23.9),
  )

  // Fines vs lag gravel: a thresholded coverage mask, not a soft noise blend —
  // real deposits have BOUNDARIES, and a 2:1 albedo step is what survives the
  // Mars LUT (notes.md S14: subtle modulation is invisible after grading).
  const gravelZone = smoothstep(0.46, 0.60, patch.mul(0.62).add(macro.mul(0.38)))

  // Integration re-solve (post AgX→Neutral): the original stops were authored
  // under AgX's shoulder and rendered washed pale-salmon through the shipped
  // Neutral chain at sun 3.15 — the whole open floor read as beach sand from
  // any distance once detail LOD-faded. Deepened ~×0.78 and re-saturated so
  // the base albedo itself carries the rust identity.
  // Mars's real regolith albedo is 0.15–0.25 — the exterior terrain learned
  // this the hard way ("first pass at 0.45 rendered the mountains brighter
  // than the sky") and the interior floor obeys the same physics. Fines sit
  // BELOW the paving stops so the civic floor reads as the finished surface.
  const fines = vec3(0.242, 0.136, 0.078)
  const gravel = vec3(0.158, 0.092, 0.06)
  const driftColor = vec3(0.305, 0.198, 0.118)
  const clastColor = vec3(0.138, 0.108, 0.09)
  const compacted = vec3(0.148, 0.088, 0.058)
  const dust = vec3(0.285, 0.182, 0.108)

  let color = mix(fines, gravel, gravelZone) as unknown as V3
  color = mix(color, driftColor, drift.mul(0.62)) as unknown as V3
  color = mix(color, color.mul(0.68), tail.mul(0.7)) as unknown as V3
  // Mid mottling, then the near-field tooth: without a real 1–2 m break-up
  // the ground under your feet reads as poured mud however good the macro
  // fields are, because at eye level the near field IS the whole frame.
  const grit = noise(worldXZ, 1 / 0.34, 133.1)
  color = color
    .mul(grain.mul(0.32).add(0.84))
    .mul(fine.mul(0.3).add(0.85))
    .mul(grit.mul(0.16).add(0.92)) as unknown as V3

  const clasts = regolithClasts(worldXZ)
  const clastTone = noise(worldXZ, 3.1, 5.5)
  color = mix(color, clastColor.mul(clastTone.mul(0.5).add(0.8)), clasts.mul(0.85)) as unknown as V3

  // Compacted desire lines (also the 'track' service routes, which are
  // regolith wear states rather than a separate slab).
  const compaction = smoothstep(0.22, 0.92, wear)
  color = mix(color, compacted, compaction.mul(0.9)) as unknown as V3

  // Dust berm against the curbs: wind-blown fines pile up where the ground
  // meets a vertical face. Lighter, softer, and it kills the hard junction.
  const berm = float(1).sub(smoothstep(0.15, 2.6, pavedDistance))
  color = mix(color, dust, berm.mul(0.55)) as unknown as V3

  // Raked garden rings survive as a faint albedo trace; the real rake is the
  // furrow geometry (vegetation system) — notes.md S14.
  const rake = worldXZ.length().mul((Math.PI * 2) / 1.9).sin().mul(0.5).add(0.5)
  const rakeInfluence = garden.mul(float(1).sub(compaction))
  color = mix(color, color.mul(mix(0.86, 1.1, rake)), rakeInfluence.mul(0.7)) as unknown as V3

  const openness = float(1)
    .sub(compaction.mul(0.75))
    .mul(smoothstep(0.1, 1.8, pavedDistance).mul(0.85).add(0.15)) as unknown as F
  const footprint = pixelFootprint()
  const rippleFade = float(1).sub(smoothstep(0.16, 0.52, footprint)) as unknown as F
  const microFade = float(1).sub(smoothstep(0.03, 0.13, footprint)) as unknown as F
  const relief = regolithRelief(worldXZ, openness, rippleFade, microFade)

  material.colorNode = color
  material.normalNode = groundNormal(relief, 1)
  // Roughness carries the deposit story too: lag gravel and clasts glance
  // light, loose fines and the curb-side dust berm swallow it.
  material.roughnessNode = float(0.965)
    .sub(compaction.mul(0.1))
    .sub(clasts.mul(0.14))
    .sub(gravelZone.mul(0.07))
    .add(drift.mul(0.02))
    .add(berm.mul(0.02))
    .clamp(0.55, 1)
  material.metalness = 0
  applySpecularAA(material)
  return material
}

// --------------------------------------------------------------- paving ----

/**
 * Polished sintered-regolith paving: big panels on a real expansion-joint
 * grid, per-panel tonal variation, a border course at every edge, circulation
 * polish, and a dust film that creeps in from the curbs.
 *
 * Geometry attributes: `uv` = panel coordinates in metres (panel boundaries
 * land on multiples of PAVE.panel); `pav` = (edge distance m, along-edge
 * coordinate m, traffic 0..1).
 */
export function createPavingMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const pav = attribute('pav', 'vec3') as unknown as V3
  const edge = pav.x as unknown as F
  const along = pav.y as unknown as F
  const traffic = pav.z as unknown as F
  const panelUv = uv() as unknown as V2

  const panel = float(PAVE.panel)
  const border = float(PAVE.border)
  // NOTE reversed-edge smoothstep is undefined in WGSL (notes.md): always
  // invert a forward one instead.
  const inBorder = float(1).sub(smoothstep(0.0, 0.02, edge.sub(border))) as unknown as F

  const gridDistance = (coordinate: F, pitch: F): F => {
    const f = coordinate.div(pitch).fract()
    return min(f, f.oneMinus()).mul(pitch) as unknown as F
  }

  const fieldJoint = min(
    gridDistance(panelUv.x as unknown as F, panel),
    gridDistance(panelUv.y as unknown as F, panel),
  ) as unknown as F
  const borderJoint = min(
    edge.sub(border).abs(),
    gridDistance(along, float(PAVE.borderPitch)),
  ) as unknown as F
  const jointDistance = mix(fieldJoint, borderJoint, inBorder) as unknown as F

  // Panel identity: the field grid inside, the border course along the edge.
  const fieldId = vec2(
    (panelUv.x as unknown as F).div(panel).floor(),
    (panelUv.y as unknown as F).div(panel).floor(),
  ) as unknown as V2
  const borderId = vec2(along.div(float(PAVE.borderPitch)).floor(), float(613)) as unknown as V2
  const panelId = mix(fieldId, borderId, inBorder) as unknown as V2
  const tone = hash(panelId.x.mul(73.13).add(panelId.y.mul(311.7)))
  const tone2 = hash(panelId.x.mul(19.7).add(panelId.y.mul(57.31)).add(5.9))

  const halfJoint = float(PAVE.joint * 0.5)
  const aa = max(fwidth(jointDistance), 0.0016) as unknown as F
  const panelMask = smoothstep(
    halfJoint.sub(aa),
    halfJoint.add(aa),
    jointDistance,
  ) as unknown as F
  // The panel edge is arrised, not a cliff: the height rolls off over 25 mm.
  const arris = smoothstep(halfJoint.sub(aa), halfJoint.add(0.026), jointDistance) as unknown as F

  // Integration re-solve (post AgX→Neutral): deepened ×~0.72 toward the
  // reference floor's terracotta — the originals lifted to pale peach in
  // full sun through the Neutral chain.
  const paleRust = vec3(0.295, 0.158, 0.098)
  const deepRust = vec3(0.152, 0.07, 0.045)
  const borderTone = vec3(0.216, 0.132, 0.1)
  const jointColor = vec3(0.062, 0.038, 0.028)

  // Per-panel identity is the whole point of a panel: sintering batches vary,
  // and a floor whose panels all match reads as a texture, not a pour. The
  // spread here is deliberately wide (≈2:1) so it survives AgX + the Mars LUT.
  const cast = noise(worldXZ, 1 / 9.5, 3.7)
  let color = mix(deepRust, paleRust, tone.mul(0.78).add(cast.mul(0.22))) as unknown as V3
  color = mix(color, borderTone, inBorder.mul(0.75)) as unknown as V3
  // Kiln mottling within each panel, keyed to the panel so no two match, plus
  // a long sinter sweep across the panel from the print head.
  const mottle = noise(worldXZ, 0.85, tone2.mul(31)) as unknown as F
  const sweep = noise(worldXZ, 0.28, tone.mul(53)) as unknown as F
  color = color.mul(mottle.mul(0.19).add(0.9)).mul(sweep.mul(0.13).add(0.94)) as unknown as V3
  // Circulation: feet burnish the middle of every run darker and richer.
  color = mix(color, color.mul(0.82), traffic.mul(0.55)) as unknown as V3
  // Dust film creeping off the regolith, heaviest in the last half metre.
  const film = float(1).sub(smoothstep(0.05, 1.6, edge))
  color = mix(color, vec3(0.375, 0.252, 0.16), film.mul(0.38)) as unknown as V3
  // Joint: darker, and its shoulder carries a contact-shadow band so the
  // recess reads even where the normal has been filtered away by distance.
  const shoulder = float(1).sub(
    smoothstep(halfJoint, halfJoint.add(0.055), jointDistance),
  ) as unknown as F
  color = color.mul(float(1).sub(shoulder.mul(0.22))) as unknown as V3
  color = mix(jointColor, color, panelMask) as unknown as V3

  // Relief: recessed joints (22 mm), a shallow per-panel dish, micro grain.
  const dish = noise(worldXZ, 0.55, 12.9).mul(0.004)
  const grain = noise(worldXZ, 26, 71.7).mul(0.0011)
  const height = arris.mul(0.022).add(dish).add(grain) as unknown as F
  const footprint = pixelFootprint()
  const reliefFade = float(1).sub(smoothstep(0.012, 0.09, footprint))

  material.colorNode = color
  material.normalNode = groundNormal(height, reliefFade)
  // Sheen: the reference image's floor mirrors the warm lights. Polish rides
  // the traffic lines; joints and dust film stay matte.
  const polish = noise(worldXZ, 1 / 6.5, 88.1)
  material.roughnessNode = float(0.44)
    .sub(traffic.mul(0.14))
    .sub(polish.mul(0.08))
    .add(tone2.mul(0.12))
    .add(film.mul(0.26))
    .add(panelMask.oneMinus().mul(0.4))
    .clamp(0.22, 0.95)
  material.metalness = 0
  applySpecularAA(material)
  return material
}

// ------------------------------------------------------------- concrete ----

/**
 * White precast concrete: curbs, planter walls, copings, steps. Swept parts
 * carry `uv = (run distance, height above the paving)`, so the dust wash and
 * the wear on walking-height edges are real functions of the section.
 */
export function createConcreteMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const section = uv() as unknown as V2
  const run = section.x as unknown as F
  const rise = section.y as unknown as F

  const pour = noise(worldXZ, 0.55, 21.7)
  const fineGrain = noise(worldXZ, 7.5, 44.2)
  const aggregate = noise(worldXZ, 22, 9.4)
  // Precast units: a per-unit tone step every ~2.4 m of run, so a curb run
  // reads as a line of castings rather than one extruded ribbon.
  const unit = hash(run.div(2.4).floor().mul(47.3).add(2.1))

  const base = mix(vec3(0.655, 0.635, 0.598), vec3(0.512, 0.492, 0.462), pour) as unknown as V3
  let color = base.mul(unit.mul(0.12).add(0.94)) as unknown as V3
  color = color.mul(fineGrain.mul(0.14).add(0.92)) as unknown as V3
  color = mix(color, vec3(0.395, 0.372, 0.344), aggregate.mul(0.26)) as unknown as V3
  // The casting joint: a 6 mm shadow line every 2.4 m of run, so a curb reads
  // as a line of precast units instead of one extruded ribbon.
  const seam = float(1).sub(
    smoothstep(0.0, 0.012, run.div(2.4).fract().sub(0.5).abs().mul(2.4).sub(0.002)),
  ) as unknown as F
  color = color.mul(float(1).sub(seam.mul(0.35))) as unknown as V3
  // Dust wash: regolith fines climb the first 140 mm of every face, and every
  // horizontal ledge collects a film of it.
  const wash = float(1).sub(smoothstep(-0.02, 0.14, rise))
  const ledge = normalWorld.y.clamp(0, 1)
  color = mix(color, vec3(0.42, 0.292, 0.198), wash.mul(0.7)) as unknown as V3
  color = mix(color, vec3(0.472, 0.348, 0.246), ledge.mul(aggregate).mul(0.22)) as unknown as V3
  // Weathering runs: dust washes DOWN a vertical face, so the streaks are
  // stretched 6:1 in Y. Without them a 40 m curb run is a plastic extrusion.
  const runoff = noise(
    vec2(worldXZ.x.add(worldXZ.y).mul(2.2), rise.mul(0.35)) as unknown as V2,
    1,
    58.3,
  )
  color = color.mul(runoff.mul(0.14).add(0.93)) as unknown as V3
  // Scuffs where shoes and wheels actually touch: the curb nose.
  const nose = smoothstep(0.1, 0.135, rise).mul(float(1).sub(smoothstep(0.5, 0.6, rise)))
  color = mix(color, color.mul(1.06), nose.mul(0.5)) as unknown as V3

  material.colorNode = color
  material.roughnessNode = float(0.72)
    .sub(nose.mul(0.16))
    .add(pour.mul(0.1))
    .add(wash.mul(0.14))
    .clamp(0.3, 1)
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** The tram channel: darker, coarser, oil-shadowed cast concrete. */
export function createChannelMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const pour = noise(worldXZ, 0.9, 51.3)
  const grime = noise(worldXZ, 4.2, 17.1)
  material.colorNode = mix(vec3(0.278, 0.264, 0.246), vec3(0.207, 0.196, 0.186), pour)
    .mul(grime.mul(0.2).add(0.86))
  material.roughnessNode = float(0.82).sub(grime.mul(0.12))
  material.metalness = 0
  applySpecularAA(material)
  return material
}

/** Floor-light bezels: anodized alloy rings set into the paving. */
export function createBezelMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const brushed = noise(worldXZ, 14, 6.3)
  material.colorNode = vec3(0.29, 0.285, 0.278).mul(brushed.mul(0.16).add(0.9))
  material.roughnessNode = float(0.42).add(brushed.mul(0.12))
  material.metalness = 0.65
  applySpecularAA(material)
  return material
}

/**
 * EMISSIVE SLOT `pathLight` — the embedded floor lenses along every main
 * edge. The lighting agent owns the final level: change `emissiveNode` here
 * (or the returned material's `emissiveNode`) rather than adding lights.
 */
export function createLensMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const grime = noise(worldXZ, 9, 3.3)
  material.colorNode = vec3(0.42, 0.36, 0.3)
  material.emissiveNode = vec3(1.0, 0.66, 0.34).mul(grime.mul(0.35).add(0.85)).mul(2.7)
  material.roughnessNode = float(0.28)
  material.metalness = 0
  return material
}

/** Loose clasts scattered over open regolith (instanced rocks). */
export function createClastMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const grain = noise(worldXZ, 5.5, 13.7)
  const face = noise(worldXZ, 1.6, 88.2)
  const dusted = normalWorld.y.clamp(0, 1)
  let color = mix(vec3(0.196, 0.158, 0.134), vec3(0.268, 0.198, 0.152), face) as unknown as V3
  color = color.mul(grain.mul(0.24).add(0.86)) as unknown as V3
  // Upward faces collect dust; undercuts stay dark basalt.
  color = mix(color, vec3(0.372, 0.253, 0.167), dusted.mul(0.42)) as unknown as V3
  material.colorNode = color
  material.roughnessNode = float(0.9).sub(grain.mul(0.1))
  material.metalness = 0
  applySpecularAA(material)
  return material
}
