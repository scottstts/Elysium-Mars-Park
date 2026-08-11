import { AdditiveBlending, BackSide, FrontSide, Mesh, SphereGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  Fn,
  abs,
  acos,
  atan,
  cameraPosition,
  clamp,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  mod,
  mrt,
  mx_noise_float,
  normalView,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  reflect,
  select,
  sign,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { marsSkyRadiance } from '../sky/skyRadiance'
import { sunColorUniform, sunDirectionUniform } from '../sky/sun'
import {
  DOME_CENTER_Y,
  DOME_SPHERE_RADIUS,
  DOME_THETA_BASE,
  latticePaneSeams,
  panewalkerPhi,
} from './latticeField'

/**
 * The ISRU glass shell — a THIN DIELECTRIC SHEET, not a tinted surface.
 *
 * The whole point of this dome is that you see Mars through it, so the pane
 * contributes exactly what a 24 mm laminate contributes and nothing else:
 *
 *   reflection   exact unpolarised Fresnel at n = 1.52, doubled for the
 *                pane's two air/glass interfaces (8.2 % head-on, → 1 at
 *                grazing). That reflectance IS the alpha, so the composite
 *                `bg·(1−R) + reflected·R` is the physical answer rather than
 *                an authored veil.
 *   reflected    the analytic Mars sky along the mirror ray, blended into the
 *                park/valley floor tone below the horizon (from inside, a
 *                down-going mirror ray lands on the rust paving).
 *   glint        a tight gloss lobe on the sun, the one HDR thing the glass
 *                is allowed to add.
 *   edge tint    ISRU glass is faintly green; it only shows where the path
 *                through the pane grows, i.e. at grazing incidence.
 *   dust film    exterior soiling, heavy at the foot, minus the Panewalker's
 *                trailing clean swath. It is LIT (regolith albedo × sun),
 *                which is what makes a dirty pane glow rather than grey out.
 *   pane seams   the structural silicone joints: the gasket line under every
 *                member, plus the pane grid inside each structural bay (4
 *                columns × 2 rows, constant everywhere — latticeField owns
 *                the counts). This is the ONLY place that subdivision
 *                exists: it is a joint in the glass plane, never a bar. The
 *                members themselves are real geometry (domeGeometry), so
 *                drawing them here as members too would double every one of
 *                them with up to a metre of parallax.
 *
 * Unlit on purpose (MeshBasicNodeMaterial): a lit material would apply its
 * own Fresnel-weighted env specular UNDER our Fresnel alpha and the pane
 * would go milky — that double response was exactly the old tan balloon.
 * AO receiver is 0 (mrt normal alpha); no depth write, so the reversed-z
 * background guards elsewhere still see the true scene depth behind it.
 */

/** Soda-lime/ISRU laminate. */
const GLASS_IOR = 1.52
/** Reflected radiance below the mirror horizon: rust paving / valley floor. */
const FLOOR_RADIANCE = /*@__PURE__*/ vec3(0.115, 0.073, 0.048)
/** Regolith film albedo. */
const DUST_ALBEDO = /*@__PURE__*/ vec3(0.44, 0.315, 0.205)
/** Peak alpha the dust film may add on the dirtiest unswept pane. */
const FILM_OPACITY = 0.13
/** Silicone joint alpha (its own coverage already anti-aliases the width). */
const SEAM_OPACITY = 0.92
/** Ambient sky fill used to light the film and the seams. */
const SKY_FILL = /*@__PURE__*/ vec3(0.2, 0.14, 0.088)

/** Connector-tube penetration: axis (0, 4.6) along z, matching the iris. */
const PORTAL_CENTER_Y = 4.6
const PORTAL_BORE = 6.15

/**
 * Aperture test shared by the shell cut and the portal frame builder.
 * The tube crosses the shell on the +z axis, so the cut is simply the bore
 * around the tube axis, gated to the south hemisphere.
 */
export const portalCut = /*@__PURE__*/ Fn(([world]: [Node<'vec3'>]) => {
  const southish = smoothstep(60, 90, world.z)
  const radial = vec2(world.x, world.y.sub(PORTAL_CENTER_Y)).length()
  return float(1).sub(smoothstep(PORTAL_BORE - 0.25, PORTAL_BORE, radial)).mul(southish)
})

/**
 * Exact unpolarised Fresnel reflectance for a dielectric interface. Schlick
 * is not interchangeable at the grazing angles that dominate a 130 m dome
 * seen from its own floor.
 */
const fresnelDielectric = /*@__PURE__*/ Fn(
  ([cosI, n1, n2]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
    const eta = n1.div(n2)
    const sinT2 = eta.mul(eta).mul(float(1).sub(cosI.mul(cosI)))
    const cosT = sqrt(float(1).sub(sinT2).max(1e-6))
    const rs = n1.mul(cosI).sub(n2.mul(cosT)).div(n1.mul(cosI).add(n2.mul(cosT)))
    const rp = n2.mul(cosI).sub(n1.mul(cosT)).div(n2.mul(cosI).add(n1.mul(cosT)))
    return select(
      sinT2.greaterThanEqual(1),
      float(1),
      rs.mul(rs).add(rp.mul(rp)).mul(0.5).clamp(0, 1),
    )
  },
)

export function createGlassShell(): { mesh: Mesh; exteriorMesh: Mesh } {
  const geometry = new SphereGeometry(
    DOME_SPHERE_RADIUS,
    200,
    80,
    0,
    Math.PI * 2,
    0,
    DOME_THETA_BASE,
  )

  const makeMaterial = (side: typeof FrontSide | typeof BackSide): MeshBasicNodeMaterial => {
    const material = new MeshBasicNodeMaterial()
    material.transparent = true
    material.depthWrite = false
    material.side = side

    const center = vec3(0, DOME_CENTER_Y, 0)
    const local = normalize(positionWorld.sub(center))
    const theta = acos(clamp(local.y, -1, 1))
    const phi = atan(local.z, local.x)

    // ── Interface response ────────────────────────────────────────────────
    const viewDirection = normalize(cameraPosition.sub(positionWorld))
    const facing = sign(dot(normalWorld, viewDirection))
    const outward = normalWorld.mul(facing)
    const cosI = clamp(abs(dot(normalWorld, viewDirection)), 1e-4, 1)
    const single = fresnelDielectric(cosI, float(1), float(GLASS_IOR))
    // Two interfaces with incoherent interreflection: R = 2r/(1+r).
    const reflectance = single.mul(2).div(single.add(1))

    // ── What the pane reflects ────────────────────────────────────────────
    const mirror = reflect(viewDirection.negate(), outward)
    const skyLobe = marsSkyRadiance(mirror, float(0))
    const horizonBlend = smoothstep(-0.14, 0.1, mirror.y)
    const environment = mix(FLOOR_RADIANCE, skyLobe, horizonBlend)
    // Gloss lobe on the sun — a 1.2° highlight, the pane's one HDR event.
    const glint = pow(max(dot(mirror, sunDirectionUniform), 0), 2400)
      .mul(46)
      .mul(sunColorUniform as unknown as Node<'vec3'>)
    // Faint iron-green: only where the optical path through the pane grows.
    const edgeTint = mix(vec3(1), vec3(0.9, 1.0, 0.93), pow(float(1).sub(cosI), 2.0))
    const reflected = environment.add(glint).mul(edgeTint)

    // ── Exterior dust film ────────────────────────────────────────────────
    const rimFilm = smoothstep(0.5, 1.0, theta.div(DOME_THETA_BASE))
    const patches = mx_noise_float(vec2(phi.mul(6), theta.mul(14))).mul(0.5).add(0.5)
    // Signed longitude behind the walker (it advances +phi): positive =
    // already cleaned. A 0.5 rad wake fades back to dusty; ahead stays dirty.
    const swathDelta = mod(panewalkerPhi.sub(phi).add(Math.PI), Math.PI * 2).sub(Math.PI)
    const cleanliness = float(1)
      .sub(smoothstep(0.05, 0.5, abs(swathDelta)))
      .mul(smoothstep(-0.02, 0.02, swathDelta))
    const film = rimFilm
      .mul(patches.mul(0.55).add(0.45))
      .mul(float(1).sub(cleanliness.mul(0.9)))
    const sunOnFilm = max(dot(normalWorld, sunDirectionUniform), 0)
    const dustLit = DUST_ALBEDO.mul(
      (sunColorUniform as unknown as Node<'vec3'>).mul(sunOnFilm.mul(1.15)).add(SKY_FILL),
    )

    // ── Structural silicone joints ────────────────────────────────────────
    // Pixel-footprint softening keeps the seam grid anti-aliased at every
    // range — and correctly vanishing past ~120 m, where a 32 mm joint is
    // far below one pixel.
    const paramMeters = vec2(
      phi.mul(DOME_SPHERE_RADIUS).mul(max(theta.sin(), 1e-3)),
      theta.mul(DOME_SPHERE_RADIUS),
    )
    const pixelSoft = fwidth(paramMeters).length().mul(0.7).add(0.012)
    const seam = latticePaneSeams(local, pixelSoft)
    const seamColor = vec3(0.05, 0.047, 0.045).mul(SKY_FILL.add(0.35))

    // ── Composite: one alpha, one weighted colour ─────────────────────────
    const filmWeight = film.mul(FILM_OPACITY)
    const seamWeight = seam.mul(SEAM_OPACITY)
    const coverage = clamp(reflectance.add(filmWeight).add(seamWeight), 0, 0.985)
    material.colorNode = reflected
      .mul(reflectance)
      .add(dustLit.mul(filmWeight))
      .add(seamColor.mul(seamWeight))
      .div(max(coverage, 1e-4))
    material.opacityNode = coverage.mul(float(1).sub(portalCut(positionWorld)))

    // Glass never receives AO (alpha 0 in the normal MRT target).
    material.mrtNode = mrt({ normal: vec4(normalView, 0) })
    return material
  }

  // Interior faces (BackSide when seen from inside the cap).
  const mesh = new Mesh(geometry, makeMaterial(BackSide))
  mesh.position.y = DOME_CENTER_Y
  mesh.renderOrder = 10
  mesh.frustumCulled = false
  mesh.name = 'dome:glass-inner'

  // Exterior faces for rim views looking back and arrival exteriors.
  const exteriorMesh = new Mesh(geometry, makeMaterial(FrontSide))
  exteriorMesh.position.y = DOME_CENTER_Y
  exteriorMesh.renderOrder = 9
  exteriorMesh.frustumCulled = false
  exteriorMesh.name = 'dome:glass-outer'

  return { mesh, exteriorMesh }
}

/**
 * The silhouette catch: a hair of extra brightness on the very last degree of
 * the shell, where a real pane's edge scatters. Deliberately far tighter and
 * fainter than the Fresnel term below it — this only has to keep the dome
 * from dissolving into the sky at 2 km, never to tint the view.
 */
export function createShellRimGlow(): Mesh {
  const geometry = new SphereGeometry(
    DOME_SPHERE_RADIUS + 0.35,
    128,
    40,
    0,
    Math.PI * 2,
    0,
    DOME_THETA_BASE,
  )
  const material = new MeshBasicNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.blending = AdditiveBlending
  material.side = BackSide
  const viewDirection = normalize(cameraPosition.sub(positionWorld))
  const grazing = pow(float(1).sub(abs(dot(viewDirection, normalWorld))), 10.0)
  material.colorNode = vec3(0.62, 0.55, 0.45)
  material.opacityNode = min(grazing.mul(0.05), 0.05)
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = DOME_CENTER_Y
  mesh.renderOrder = 11
  mesh.frustumCulled = false
  mesh.name = 'dome:rim-glow'
  return mesh
}
