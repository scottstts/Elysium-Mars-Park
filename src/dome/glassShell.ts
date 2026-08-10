import { AdditiveBlending, BackSide, FrontSide, Mesh, SphereGeometry } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  Fn,
  abs,
  atan,
  acos,
  cameraPosition,
  clamp,
  dot,
  float,
  fwidth,
  max,
  mix,
  mod,
  mrt,
  mx_noise_float,
  normalView,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  DOME_CENTER_Y,
  DOME_SPHERE_RADIUS,
  DOME_THETA_BASE,
  latticeCoverage,
  panewalkerPhi,
} from './latticeField'

/**
 * The ISRU glass shell: one merged sphere-cap mesh, alpha-blended (no
 * physical transmission — 250 m of thin flat panes refract nothing worth a
 * backdrop capture; hero glass elsewhere uses the physical path). The shell
 * carries: Fresnel reflection sheen, the green ISRU edge tint, the exterior
 * dust film with the Panewalker's cleaned swath, per-panel manufactured
 * ripple, the fine lattice net as crisp shader lines, and the south portal
 * cut-out. AO receiver is 0 (mrt normal alpha).
 */

const PORTAL_HALF_WIDTH = 6
const PORTAL_SPRING_HEIGHT = 5
const PORTAL_ARCH_RADIUS = 6

/** Arch test shared by the shell cut and the portal frame builder (S9 iris). */
export const portalCut = /*@__PURE__*/ Fn(([world]: [Node<'vec3'>]) => {
  const southish = smoothstep(180, 220, world.z)
  const insideWall = float(1).sub(step(PORTAL_HALF_WIDTH, abs(world.x)))
  const belowSpring = float(1).sub(step(PORTAL_SPRING_HEIGHT, world.y))
  const archDistance = world.xy.sub(vec2(0, PORTAL_SPRING_HEIGHT)).length()
  const inArch = float(1).sub(step(PORTAL_ARCH_RADIUS, archDistance))
  const shape = max(insideWall.mul(belowSpring), inArch)
  return shape.mul(southish)
})

export function createGlassShell(): { mesh: Mesh; exteriorMesh: Mesh } {
  const geometry = new SphereGeometry(
    DOME_SPHERE_RADIUS,
    160,
    56,
    0,
    Math.PI * 2,
    0,
    DOME_THETA_BASE,
  )

  const makeMaterial = (side: typeof FrontSide | typeof BackSide): MeshStandardNodeMaterial => {
    const material = new MeshStandardNodeMaterial()
    material.transparent = true
    material.depthWrite = false
    material.side = side
    material.roughness = 0.055
    material.metalness = 0

    const center = vec3(0, DOME_CENTER_Y, 0)
    const local = normalize(positionWorld.sub(center))
    const theta = acos(clamp(local.y, -1, 1))
    const phi = atan(local.z, local.x)

    // Pixel-footprint softening keeps the net anti-aliased at every range.
    const paramMeters = vec2(
      phi.mul(DOME_SPHERE_RADIUS).mul(max(theta.sin(), 1e-3)),
      theta.mul(DOME_SPHERE_RADIUS),
    )
    const pixelSoft = fwidth(paramMeters).length().mul(0.7).add(0.015)
    const frame = latticeCoverage(local, pixelSoft)

    // Dust film: heavy near the rim, patchy, minus the Panewalker's swath.
    const rimFilm = smoothstep(0.45, 0.95, theta.div(DOME_THETA_BASE))
    const patches = mx_noise_float(vec2(phi.mul(6), theta.mul(14))).mul(0.5).add(0.5)
    // Signed longitude behind the walker (it advances +phi): positive =
    // already cleaned. A 0.5 rad wake fades back to dusty; ahead stays dirty.
    const swathDelta = mod(panewalkerPhi.sub(phi).add(Math.PI), Math.PI * 2).sub(Math.PI)
    const cleanliness = smoothstep(0.5, 0.05, abs(swathDelta)).mul(
      smoothstep(-0.02, 0.02, swathDelta),
    )
    const film = rimFilm
      .mul(patches.mul(0.55).add(0.45))
      .mul(float(1).sub(cleanliness.mul(0.85)))

    // Manufactured per-panel ripple: tiny normal wobble, big at grazing.
    const ripple = mx_noise_float(vec2(phi.mul(180), theta.mul(120)))
    const viewDirection = normalize(cameraPosition.sub(positionWorld))
    const facing = abs(dot(viewDirection, normalWorld))
    const grazing = pow(float(1).sub(facing), 3.0)

    // ISRU green edge tint lives in the reflection color at grazing angles.
    const glassTint = vec3(0.78, 0.86, 0.8)
    material.colorNode = mix(vec3(0.012), vec3(0.05, 0.055, 0.05), frame)

    const fresnelOpacity = grazing.mul(0.34).add(0.045)
    const filmOpacity = film.mul(0.22)
    const frameOpacity = frame.mul(0.88)
    material.opacityNode = clamp(
      fresnelOpacity.add(filmOpacity).add(frameOpacity).add(ripple.abs().mul(grazing).mul(0.05)),
      0,
      0.97,
    ).mul(float(1).sub(portalCut(positionWorld)))

    // Dusty panes scatter a little sun warmth; frames stay dead.
    material.emissiveNode = vec3(0.4, 0.26, 0.14)
      .mul(film)
      .mul(0.06)
      .add(glassTint.mul(grazing).mul(0.012))

    // Glass never receives AO (alpha 0 in the normal MRT target).
    material.mrtNode = mrt({ normal: vec4(normalView, 0) })
    return material
  }

  // Interior faces (BackSide when seen from inside the cap).
  const mesh = new Mesh(geometry, makeMaterial(BackSide))
  mesh.position.y = DOME_CENTER_Y
  mesh.renderOrder = 10
  mesh.frustumCulled = false

  // Exterior faces for rim views looking back and arrival exteriors.
  const exteriorMesh = new Mesh(geometry, makeMaterial(FrontSide))
  exteriorMesh.position.y = DOME_CENTER_Y
  exteriorMesh.renderOrder = 9
  exteriorMesh.frustumCulled = false

  return { mesh, exteriorMesh }
}

/** Faint bright rim where the glass meets sky — a cheap silhouette catch. */
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
  const material = new MeshStandardNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.blending = AdditiveBlending
  material.side = BackSide
  const viewDirection = normalize(cameraPosition.sub(positionWorld))
  const grazing = pow(float(1).sub(abs(dot(viewDirection, normalWorld))), 6.0)
  material.colorNode = vec3(0.9, 0.75, 0.55)
  material.opacityNode = grazing.mul(0.05)
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = DOME_CENTER_Y
  mesh.renderOrder = 11
  mesh.frustumCulled = false
  return mesh
}
