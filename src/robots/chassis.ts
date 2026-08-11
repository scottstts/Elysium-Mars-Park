import { CanvasTexture, Group, Mesh, PlaneGeometry, SRGBColorSpace } from 'three'
import type { Object3D } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  Forge,
  arcPts,
  circleProfile,
  ensureCCW,
  filletBox,
  loft,
  mirrorX,
  pipe,
  polyOffset,
  prism,
  revolveY,
  roundedRect,
  rotateX,
  rotateY,
  rotateZ,
  translate,
  tube,
} from './forge'
import type { Solid, V2, V3 } from './forge'
import { robotMaterials } from './robotMaterials'
import type { Livery } from './robotMaterials'

/**
 * The park's citizens, built as machines.
 *
 * Local frame for every rig: +X right, +Y up, +Z FORWARD (the routine yaws the
 * group with `atan2(dx, dz)`, so local +Z is the travel direction), origin at
 * GROUND CONTACT — the wheels sink 3 mm into the paving rather than resting on
 * it, because a visible gap at the contact point is the defect that reads as
 * floating (experience-craft §5.2 rule 10).
 *
 * Method, per hero-model craft: an analytic base body first (a lofted shell
 * from named sections), then every attachment placed on it at ±ε — proud parts
 * stand ≥0.8 mm off so no two faces are ever coplanar, buried feet sink and are
 * capped by a lathed flange so no joint shows a gap. Nothing here is a stacked
 * primitive; the only boxes are true filleted solids swept from a profile.
 */

export interface RobotRig {
  group: Group
  /** Spun about local X by the routine at contact speed. */
  wheels: Object3D[]
  /** Bobbed/lifted while working (rake boom, brush carriage). */
  tool: Group | null
  /** Rolling radius in metres — the routine derives wheel spin from it. */
  wheelRadius: number
  /** Sub-assemblies that spin about their OWN local Z (brush discs). */
  spinners: Object3D[]
}

// --------------------------------------------------------------- decal plates

/**
 * Livery text / the painted eyes. Rasterized once per machine and applied to a
 * real stand-off plate, never straight onto a curved flank: the plate gives the
 * decal a flat host and a 1.5 mm proud offset gives it a z-fight-free seat.
 */
/** A decal's draw callback works in CANVAS PIXELS, sized from the plate. */
type DecalDraw = (g: CanvasRenderingContext2D, w: number, h: number) => void

/**
 * Rasterise a decal for a `plateW x plateH` metre plate. The canvas aspect is
 * DERIVED from the plate, never assumed: the old fixed 256 x 128 canvas was
 * mapped onto plates of aspect 2.64 - 3.06, which stretched every glyph on
 * every machine in the park by 32 - 53 %. Because the two aspects now agree, a
 * circle drawn on the canvas is a circle on the plate, so the painted eyes
 * keep the proportions they were authored with.
 */
function decalTexture(draw: DecalDraw, plateW: number, plateH: number, width = 256): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(48, Math.round((width * plateH) / plateW))
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, canvas.width, canvas.height)
    draw(g, canvas.width, canvas.height)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Build the texture AND its plate together, so the two aspects cannot drift. */
function decalPlate(draw: DecalDraw, width: number, height: number): Mesh {
  return decalMesh(decalTexture(draw, width, height), width, height)
}

function decalMesh(texture: CanvasTexture, width: number, height: number): Mesh {
  const material = new MeshStandardNodeMaterial()
  material.map = texture
  material.transparent = true
  material.roughness = 0.55
  material.metalness = 0.05
  const mesh = new Mesh(new PlaneGeometry(width, height), material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

// Every layout below is expressed as a FRACTION of the canvas, which is the
// same fraction of the plate whatever aspect the plate turns out to be. The
// numbers are the ones originally authored against a 256 x 128 canvas.
function fleetPlate(name: string): DecalDraw {
  return (g, w, h) => {
    g.fillStyle = '#e9e3d6'
    g.font = `700 ${0.406 * h}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillText(name.split('').join(' '), 0.0625 * w, 0.359 * h)
    g.fillStyle = 'rgba(233,227,214,0.55)'
    g.font = `600 ${0.156 * h}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillText('G R O U N D S   U N I T', 0.0703 * w, 0.656 * h)
    // Duty bars: the little printed rank stripes every fleet vehicle carries.
    g.fillStyle = '#c0631a'
    for (let i = 0; i < 3; i++) {
      g.fillRect(0.0703 * w + i * 0.1016 * w, 0.8125 * h, 0.0703 * w, 0.0547 * h)
    }
  }
}

/** Someone painted eyes on GK-02. Nobody has confessed. */
function eyesPlate(): DecalDraw {
  return (g, w, h) => {
    g.fillStyle = '#fbf7ea'
    g.beginPath()
    g.ellipse(0.336 * w, 0.469 * h, 0.1172 * w, 0.2812 * h, 0, 0, Math.PI * 2)
    g.ellipse(0.664 * w, 0.469 * h, 0.1172 * w, 0.2812 * h, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#17161a'
    g.beginPath()
    g.arc(0.367 * w, 0.531 * h, 0.0508 * w, 0, Math.PI * 2)
    g.arc(0.695 * w, 0.531 * h, 0.0508 * w, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fbf7ea'
    g.beginPath()
    g.arc(0.387 * w, 0.484 * h, 0.0176 * w, 0, Math.PI * 2)
    g.arc(0.715 * w, 0.484 * h, 0.0176 * w, 0, Math.PI * 2)
    g.fill()
  }
}

function stencilPlate(lines: string[]): DecalDraw {
  return (g, w, h) => {
    g.fillStyle = '#e6e0d2'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const rowHeight = (0.906 * h) / lines.length
    lines.forEach((line, index) => {
      // Measure and shrink until it fits: a stencil that overflows its plate
      // reads as a bug, and long district names are longer than they look.
      const spaced = line.split('').join(' ')
      let size = Math.min(0.406 * h, rowHeight * 0.78)
      g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      while (size > 0.08 * h && g.measureText(spaced).width > 0.891 * w) {
        size -= 0.016 * h
        g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      }
      g.fillText(spaced, w / 2, h / 2 + (index - (lines.length - 1) / 2) * rowHeight)
    })
  }
}

// ------------------------------------------------------------ shared hardware

/** Hex-ish fastener with a washer seat — the detail that says "made". */
function bolt(position: V3, radius: number, axis: 'x' | 'y' | 'z' = 'y'): Solid {
  const s = revolveY(
    [
      [radius * 1.55, 0],
      [radius * 1.5, radius * 0.22],
      [radius * 1.05, radius * 0.3],
      [radius, radius * 0.34],
      [radius * 0.94, radius * 0.92],
      [radius * 0.6, radius * 1.0],
      [0, radius * 1.0],
    ],
    { segments: 8, smooth: 26 },
  )
  if (axis === 'x') rotateZ(s, -Math.PI / 2)
  if (axis === 'z') rotateX(s, Math.PI / 2)
  return translate(s, position)
}

/** Lathed escutcheon: what makes a buried foot invisible (§5.2 rule 2). */
function flange(position: V3, inner: number, outer: number, height: number, axis: 'x' | 'y' | 'z' = 'y'): Solid {
  const s = revolveY(
    [
      [inner, 0],
      [outer * 0.96, 0],
      [outer, height * 0.35],
      [outer * 0.9, height],
      [inner, height],
    ],
    { segments: 16, smooth: 38 },
  )
  if (axis === 'x') rotateZ(s, -Math.PI / 2)
  if (axis === 'z') rotateX(s, Math.PI / 2)
  return translate(s, position)
}

/** Helical compression spring — a real coil, swept along its own path. */
function coilSpring(from: V3, to: V3, coilRadius: number, wire: number, turns: number): Solid {
  const axis: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const length = Math.hypot(axis[0], axis[1], axis[2])
  const dir: V3 = [axis[0] / length, axis[1] / length, axis[2] / length]
  const helper: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const side: V3 = [
    helper[1] * dir[2] - helper[2] * dir[1],
    helper[2] * dir[0] - helper[0] * dir[2],
    helper[0] * dir[1] - helper[1] * dir[0],
  ]
  const sl = Math.hypot(side[0], side[1], side[2])
  side[0] /= sl
  side[1] /= sl
  side[2] /= sl
  const up: V3 = [
    dir[1] * side[2] - dir[2] * side[1],
    dir[2] * side[0] - dir[0] * side[2],
    dir[0] * side[1] - dir[1] * side[0],
  ]
  const steps = Math.round(turns * 8)
  const path: V3[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const a = t * turns * Math.PI * 2
    // Ends are ground flat: the coil radius pinches in over the last 8 %.
    const ease = Math.min(1, Math.min(t, 1 - t) / 0.09)
    const r = coilRadius * (0.55 + 0.45 * ease)
    const c = Math.cos(a) * r
    const s = Math.sin(a) * r
    path.push([
      from[0] + dir[0] * length * t + side[0] * c + up[0] * s,
      from[1] + dir[1] * length * t + side[1] * c + up[1] * s,
      from[2] + dir[2] * length * t + side[2] * c + up[2] * s,
    ])
  }
  return pipe(path, wire, { seg: 6, smooth: 40 })
}

/** Linear actuator: barrel, gland, rod and two eye ends. */
function actuator(from: V3, to: V3, barrel: number): { body: Solid[]; rod: Solid[] } {
  const axis: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const length = Math.hypot(axis[0], axis[1], axis[2])
  const dir: V3 = [axis[0] / length, axis[1] / length, axis[2] / length]
  const at = (t: number): V3 => [
    from[0] + dir[0] * length * t,
    from[1] + dir[1] * length * t,
    from[2] + dir[2] * length * t,
  ]
  const body = pipe([at(0.08), at(0.62)], barrel, { seg: 12, smooth: 40 })
  const gland = pipe([at(0.6), at(0.66)], barrel * 1.14, { seg: 12, smooth: 40 })
  const rod = pipe([at(0.63), at(0.94)], barrel * 0.4, { seg: 10, smooth: 40 })
  const eyeA = revolveY(
    [
      [barrel * 0.42, -barrel * 0.5],
      [barrel * 1.0, -barrel * 0.5],
      [barrel * 1.0, barrel * 0.5],
      [barrel * 0.42, barrel * 0.5],
    ],
    { segments: 12, smooth: 40 },
  )
  const eyeB = revolveY(
    [
      [barrel * 0.32, -barrel * 0.4],
      [barrel * 0.8, -barrel * 0.4],
      [barrel * 0.8, barrel * 0.4],
      [barrel * 0.32, barrel * 0.4],
    ],
    { segments: 12, smooth: 40 },
  )
  // Eyes are pinned across the machine, so their bores run along X.
  rotateZ(eyeA, Math.PI / 2)
  rotateZ(eyeB, Math.PI / 2)
  translate(eyeA, at(0.05))
  translate(eyeB, at(0.97))
  return { body: [body, gland, eyeA, eyeB], rod: [rod] }
}

// ------------------------------------------------------------------- wheels

interface WheelSpec {
  radius: number
  width: number
  segments: number
  grousers: number
  spokes: number
  /** -1 builds the left-hand wheel as MIRRORED GEOMETRY. A negative object
   *  scale would need the backend to flip winding per draw; mirroring the
   *  polygons (and their winding with them) can never render inside-out. */
  hand?: number
}

const wheelCache = new Map<string, Group>()

/**
 * Rover wheel: a lathed tyre section with real bead/shoulder/tread geometry,
 * chevroned grousers buried 4 mm into the tread band, a rim buried 1 mm into
 * the tyre bore (bury, never butt), curved flexure spokes and a bolted hub cap.
 * Built once per spec and cloned — the clones share geometry and materials.
 */
function wheelAssembly(spec: WheelSpec, livery: Livery): Group {
  const hand = spec.hand ?? 1
  const key = `${spec.radius}|${spec.width}|${spec.segments}|${spec.grousers}|${spec.spokes}|${hand}|${livery}`
  const cached = wheelCache.get(key)
  if (cached) return cached.clone()

  const materials = robotMaterials(livery)
  const forge = new Forge()
  const put = (slot: string, part: Solid): void => {
    forge.add(slot, hand < 0 ? mirrorX(part) : part)
  }
  const R = spec.radius
  const HW = spec.width / 2
  const bore = R * 0.56
  const tread = HW * 0.66

  // Tyre: a CLOSED (r, y) loop, revolved. The loop is repeated at the end so
  // the shell wraps in v with nothing to cap.
  const section: V2[] = [
    [R, -tread],
    [R, tread],
    [R - 0.008, HW - 0.005],
    [R * 0.9, HW],
    [bore + 0.016, HW],
    [bore, HW - 0.012],
    [bore, -HW + 0.012],
    [bore + 0.016, -HW],
    [R * 0.9, -HW],
    [R - 0.008, -HW + 0.005],
  ]
  const tyre = revolveY([...section, section[0]], { segments: spec.segments, smooth: 34 })
  rotateZ(tyre, Math.PI / 2) // spin axis onto X — the routine turns rotation.x
  put('rubber', tyre)

  // Grousers: chevron pairs, buried into the tread so nothing is coplanar.
  for (let i = 0; i < spec.grousers; i++) {
    const a = (i / spec.grousers) * Math.PI * 2
    for (const half of [-1, 1] as const) {
      const lug = filletBox(
        [half * spec.width * 0.19, R + 0.004, 0],
        [spec.width * 0.34, 0.017, 0.028],
        0.004,
        { seg: 1, smooth: 30 },
      )
      rotateY(lug, half * 0.26, [0, R, 0])
      rotateX(lug, a)
      put('rubber', lug)
    }
  }

  // Rim: buried 1 mm inside the tyre bore.
  const rim = revolveY(
    [
      [bore + 0.001, -HW * 0.84],
      [bore + 0.001, HW * 0.84],
      [bore - 0.014, HW * 0.66],
      [bore - 0.02, -HW * 0.66],
      [bore + 0.001, -HW * 0.84],
    ],
    { segments: spec.segments, smooth: 36 },
  )
  rotateZ(rim, Math.PI / 2)
  put('alloy', rim)

  // Flexure spokes: a curled band, extruded across the wheel.
  const spokeParts: Solid[] = []
  for (let i = 0; i < spec.spokes; i++) {
    const base = (i / spec.spokes) * Math.PI * 2
    const inner: V2[] = []
    const outer: V2[] = []
    const steps = 5
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const r = R * 0.2 + (bore - 0.012 - R * 0.2) * t
      const a = base + 0.62 * t * t
      const tangent: V2 = [-Math.sin(a), Math.cos(a)]
      const w = 0.011 + 0.004 * (1 - t)
      inner.push([Math.cos(a) * r - tangent[0] * w, Math.sin(a) * r - tangent[1] * w])
      outer.push([Math.cos(a) * r + tangent[0] * w, Math.sin(a) * r + tangent[1] * w])
    }
    const silhouette = ensureCCW([...outer, ...inner.reverse()])
    // The wheel plane IS (y, z) — the right-handed pair for an X axle — so the
    // radial silhouette extrudes straight across with no remap.
    spokeParts.push(prism(silhouette, 'x', -0.004, 0.004, { roll: 0.0015, rollSeg: 1, smooth: 30 }))
  }
  for (const spoke of spokeParts) put('alloy', spoke)

  // Hub cap on the outboard face, with its own bolt circle.
  const cap = revolveY(
    [
      [0, 0],
      [R * 0.16, 0.001],
      [R * 0.2, 0.016],
      [R * 0.19, 0.03],
      [R * 0.1, 0.036],
      [0, 0.038],
    ],
    { segments: 16, smooth: 42 },
  )
  rotateZ(cap, -Math.PI / 2)
  translate(cap, [HW * 0.42, 0, 0])
  put('dark', cap)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4
    put('dark', bolt([HW * 0.72, Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3], 0.0075, 'x'))
  }

  const group = forge.build(materials, { castShadow: true })
  wheelCache.set(key, group)
  return group.clone()
}

// ------------------------------------------------------------- body sections

/**
 * A moulded shell wall: a U-band cross-section (outer skin, real wall
 * thickness, open underneath) so the body reads as a pressing over a chassis
 * and the bottom rim shows its own edge instead of a sealed box face.
 */
function shellSection(
  halfWidth: number,
  bottom: number,
  top: number,
  radius: number,
  thickness: number,
  seg = 3,
): V2[] {
  const r = Math.min(radius, halfWidth * 0.9, (top - bottom) * 0.8)
  const outer: V2[] = [
    [-halfWidth, bottom],
    ...arcPts(-halfWidth + r, top - r, r, Math.PI, Math.PI / 2, seg),
    ...arcPts(halfWidth - r, top - r, r, Math.PI / 2, 0, seg),
    [halfWidth, bottom],
  ]
  const ri = Math.max(0.001, r - thickness)
  const inner: V2[] = [
    [halfWidth - thickness, bottom],
    ...arcPts(halfWidth - r, top - r, ri, 0, Math.PI / 2, seg),
    ...arcPts(-halfWidth + r, top - r, ri, Math.PI / 2, Math.PI, seg),
    [-halfWidth + thickness, bottom],
  ]
  return ensureCCW([...outer, ...inner])
}

interface HullStation {
  z: number
  halfWidth: number
  bottom: number
  top: number
  radius: number
  inset?: number
}

/** Loft a body from named sections; ends roll in instead of ending raw. */
function hullShell(stations: HullStation[], thickness: number, seg = 3): Solid {
  const rings = stations.map((s) => {
    const poly = shellSection(s.halfWidth, s.bottom, s.top, s.radius, thickness, seg)
    const offset = s.inset ? polyOffset(poly, -s.inset) : poly
    return offset.map(([x, y]): V3 => [x, y, s.z])
  })
  return loft(rings, { closed: true, capStart: true, capEnd: true, smooth: 32 })
}

/** Solid lofted tub (closed section) — chassis pans, hoppers, cargo bodies. */
function hullSolid(
  stations: Array<{ z: number; width: number; height: number; y: number; radius: number; inset?: number }>,
  seg = 3,
): Solid {
  const rings = stations.map((s) => {
    const poly = roundedRect(s.width, s.height, s.radius, seg)
    const offset = s.inset ? polyOffset(poly, -s.inset) : poly
    return offset.map(([x, y]): V3 => [x, y + s.y, s.z])
  })
  return loft(rings, { closed: true, capStart: true, capEnd: true, smooth: 32 })
}

// ------------------------------------------------------------- groundskeeper

const GK = {
  wheelRadius: 0.152,
  wheelWidth: 0.086,
  track: 0.246,
  axle: 0.245,
  rockerX: 0.186,
  tubHalf: 0.128,
  tubTop: 0.318,
  shellHalf: 0.212,
  shellBottom: 0.272,
  shellTop: 0.404,
  sink: 0.003,
} as const

/** The face panel's seat: centre, lay-back, and the normal decals ride out on. */
const FACE_TILT = 0.245
const FACE_CENTER: V3 = [0, 0.318, 0.324]
const FACE_NORMAL: V3 = [0, Math.sin(FACE_TILT), Math.cos(FACE_TILT)]

interface GroundskeeperOptions {
  name: string
  eyes: boolean
  livery: Livery
  /** Parked on a charging frame: boom folded, port door open. */
  docked?: boolean
}

function groundskeeper(options: GroundskeeperOptions): RobotRig {
  const materials = robotMaterials(options.livery)
  const forge = new Forge()
  const group = new Group()
  const axleY = GK.wheelRadius - GK.sink

  // ---- Chassis tub: the narrow structural spine the rockers hang off.
  forge.add(
    'dark',
    hullSolid([
      { z: -0.3, width: 0.2, height: 0.1, y: 0.245, radius: 0.028, inset: 0.014 },
      { z: -0.286, width: 0.2, height: 0.1, y: 0.245, radius: 0.028 },
      { z: -0.16, width: GK.tubHalf * 2, height: 0.15, y: 0.243, radius: 0.032 },
      { z: 0.1, width: GK.tubHalf * 2, height: 0.15, y: 0.243, radius: 0.032 },
      { z: 0.24, width: 0.21, height: 0.12, y: 0.248, radius: 0.03 },
      { z: 0.266, width: 0.21, height: 0.12, y: 0.248, radius: 0.03, inset: 0.013 },
    ]),
  )
  // Belly plate, set back so a shadow line runs the length of the machine.
  forge.add(
    'alloy',
    filletBox([0, 0.176, -0.02], [0.19, 0.014, 0.44], 0.005, { seg: 1, smooth: 30 }),
  )

  // ---- Body shell over the tub: a moulded pressing, open underneath.
  forge.add(
    'paint',
    hullShell(
      [
        { z: -0.322, halfWidth: 0.15, bottom: GK.shellBottom, top: 0.386, radius: 0.05, inset: 0.005 },
        { z: -0.312, halfWidth: 0.156, bottom: GK.shellBottom, top: 0.388, radius: 0.05 },
        { z: -0.2, halfWidth: 0.198, bottom: GK.shellBottom, top: 0.4, radius: 0.055 },
        { z: -0.04, halfWidth: GK.shellHalf, bottom: GK.shellBottom, top: GK.shellTop, radius: 0.055 },
        { z: 0.14, halfWidth: GK.shellHalf, bottom: GK.shellBottom, top: GK.shellTop, radius: 0.055 },
        { z: 0.238, halfWidth: 0.19, bottom: GK.shellBottom, top: 0.388, radius: 0.052 },
        { z: 0.3, halfWidth: 0.168, bottom: GK.shellBottom + 0.006, top: 0.376, radius: 0.05 },
        { z: 0.312, halfWidth: 0.161, bottom: GK.shellBottom + 0.01, top: 0.37, radius: 0.048, inset: 0.005 },
      ],
      0.016,
    ),
  )
  // Bulkheads close the shell's open ends over the tub, so nothing reads as a
  // cavity from behind: the rear one is louvred (cooling out of the drive bay).
  forge.add('alloy', filletBox([0, 0.284, -0.3], [0.27, 0.05, 0.014], 0.006, { seg: 2, smooth: 30 }))
  for (let i = 0; i < 4; i++) {
    forge.add('dark', filletBox([0, 0.272 + i * 0.014, -0.308], [0.2, 0.007, 0.008], 0.002, { seg: 1, smooth: 28 }))
  }
  forge.add('alloy', filletBox([0, 0.288, 0.262], [0.25, 0.05, 0.014], 0.006, { seg: 2, smooth: 30 }))

  // ---- Deck panels: two pressings with a real 7 mm seam, plus a hatch that
  // stands proud on its own gasket line and four quarter-turn latches. The
  // rear panel carries the livery accent; the machine is bone-white with trim,
  // not a painted tray.
  forge.add('accent', filletBox([0, 0.4085, -0.16], [0.3, 0.011, 0.2], 0.006, { seg: 2, smooth: 30 }))
  forge.add('paint', filletBox([0, 0.4085, 0.075], [0.3, 0.011, 0.24], 0.006, { seg: 2, smooth: 30 }))
  forge.add('alloy', filletBox([0, 0.4155, -0.16], [0.23, 0.008, 0.15], 0.005, { seg: 2, smooth: 30 }))
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      forge.add('dark', bolt([sx * 0.095, 0.4185, -0.16 + sz * 0.06], 0.009))
    }
  }

  // ---- Rocker suspension: a real side elevation, pivoting on a boss, with a
  // coil-over pulling the trailing arm down onto the ground.
  for (const sx of [-1, 1] as const) {
    const silhouette = ensureCCW([
      [-GK.axle - 0.03, axleY - 0.026],
      [-GK.axle + 0.02, axleY + 0.03],
      [-0.07, 0.222],
      [-0.045, 0.256],
      [0.045, 0.256],
      [0.07, 0.222],
      [GK.axle - 0.02, axleY + 0.03],
      [GK.axle + 0.03, axleY - 0.026],
      [GK.axle + 0.03, axleY - 0.05],
      [GK.axle - 0.05, axleY - 0.038],
      [0.0, 0.198],
      [-GK.axle + 0.05, axleY - 0.038],
      [-GK.axle - 0.03, axleY - 0.05],
    ])
    // Silhouette lives in (z, y); extruded across X with rolled edges.
    const rocker = prism(silhouette, 'x', GK.rockerX - 0.009, GK.rockerX + 0.009, {
      roll: 0.003,
      rollSeg: 1,
      smooth: 32,
    })
    const arm = sx > 0 ? rocker : mirrorX(rocker)
    // prism(axis 'x') maps profile (u, v) -> (y, z): swap to (z, y) authoring.
    forge.add('alloy', remapZY(arm))

    // Pivot boss through the tub, capped both sides.
    forge.add('dark', flange([sx * (GK.tubHalf + 0.002), 0.239, 0], 0.0, 0.028, 0.012, 'x'))
    forge.add('dark', pipe([[sx * GK.tubHalf, 0.239, 0], [sx * (GK.rockerX + 0.012), 0.239, 0]], 0.013, { seg: 12 }))
    forge.add('alloy', flange([sx * (GK.rockerX + 0.01), 0.239, 0], 0.013, 0.026, 0.008, 'x'))
    forge.add('dark', bolt([sx * (GK.rockerX + 0.019), 0.239, 0], 0.009, 'x'))

    // Axle stubs out to the hubs.
    for (const sz of [-1, 1] as const) {
      forge.add('dark', pipe(
        [[sx * (GK.rockerX + 0.006), axleY, sz * GK.axle], [sx * (GK.track - 0.03), axleY, sz * GK.axle]],
        0.016,
        { seg: 12 },
      ))
      forge.add('alloy', flange([sx * (GK.rockerX + 0.007), axleY, sz * GK.axle], 0.016, 0.03, 0.01, 'x'))
    }

    // Coil-over between the shell edge and the trailing arm.
    const top: V3 = [sx * 0.155, 0.352, -0.115]
    const foot: V3 = [sx * GK.rockerX, axleY + 0.012, -GK.axle + 0.045]
    const damper = actuator(top, foot, 0.012)
    forge.addAll('dark', damper.body)
    forge.addAll('alloy', damper.rod)
    forge.add('hazard', coilSpring(
      [top[0], top[1] - 0.01, top[2] + 0.004],
      [foot[0], foot[1] + 0.012, foot[2] - 0.004],
      0.021,
      0.0035,
      5,
    ))
  }

  // ---- Differential bar across the deck, linked down to both rockers.
  forge.add('alloy', pipe([[-0.13, 0.418, -0.245], [0.13, 0.418, -0.245]], 0.009, { seg: 10 }))
  for (const sx of [-1, 1] as const) {
    forge.add('dark', pipe(
      [[sx * 0.13, 0.418, -0.245], [sx * GK.rockerX, 0.3, -0.245]],
      0.006,
      { seg: 8 },
    ))
    forge.add('dark', flange([sx * 0.128, 0.418, -0.245], 0.009, 0.016, 0.008, 'x'))
  }

  // ---- Sensor mast: raked tube, flanged where it lands, camera pod on a yoke.
  const mastFoot: V3 = [0, 0.398, 0.15]
  const mastHead: V3 = [0, 0.6, 0.198]
  forge.add('alloy', pipe([[0, 0.372, 0.142], mastHead], 0.016, { seg: 12 }))
  forge.add('dark', flange([mastFoot[0], mastFoot[1] - 0.006, mastFoot[2]], 0.016, 0.038, 0.016))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    forge.add('dark', bolt([Math.cos(a) * 0.03, mastFoot[1] + 0.011, mastFoot[2] + Math.sin(a) * 0.03], 0.006))
  }
  buildSensorPod(forge, [0, 0.632, 0.196], 1)

  // ---- Charge port on the left flank: a sunk socket with a capped door.
  const portX = -0.198
  forge.add('dark', flange([portX, 0.33, -0.055], 0.0, 0.034, 0.008, 'x'))
  forge.add('alloy', flange([portX - 0.004, 0.33, -0.055], 0.008, 0.024, 0.006, 'x'))
  for (const sz of [-1, 1] as const) {
    forge.add('dark', pipe(
      [[portX - 0.012, 0.33, -0.055 + sz * 0.009], [portX - 0.026, 0.33, -0.055 + sz * 0.009]],
      0.0045,
      { seg: 8 },
    ))
  }
  const door = filletBox([portX - 0.012, 0.33, -0.055], [0.008, 0.05, 0.05], 0.006, { seg: 2, axis: 'x', smooth: 30 })
  // Docked: the port door stands open OUTBOARD on its hinge (a negative turn
  // swings it back through the flank).
  if (options.docked) rotateY(door, 1.15, [portX, 0.33, -0.03])
  forge.add('accent', door)

  // ---- Applied name plate: a stand-off with a 6 mm reveal to the flank.
  for (const sx of [-1, 1] as const) {
    forge.add(
      'alloy',
      filletBox([sx * 0.222, 0.336, 0.04], [0.008, 0.078, 0.24], 0.006, { seg: 2, axis: 'x', smooth: 30 }),
    )
  }
  // ---- Face panel: a real front closure standing across the shell nose, laid
  // back 14 deg. This is the machine's face — where the fleet stencil goes,
  // and where someone painted GK-02's eyes.
  const facePanel = filletBox([0, 0, 0], [0.3, 0.108, 0.014], 0.014, { seg: 2, smooth: 30 })
  rotateX(facePanel, -FACE_TILT)
  translate(facePanel, FACE_CENTER)
  forge.add('accent', facePanel)
  // Chin bar under the face: the gap between them IS the intake line.
  forge.add('hazard', filletBox([0, 0.252, 0.336], [0.31, 0.038, 0.024], 0.008, { seg: 2, smooth: 30 }))

  // ---- Work lamps flanking the face, on their own stand-offs.
  for (const sx of [-1, 1] as const) {
    forge.add('dark', pipe([[sx * 0.118, 0.372, 0.286], [sx * 0.118, 0.374, 0.316]], 0.014, { seg: 10 }))
    const lamp = revolveY(
      [
        [0, 0],
        [0.014, 0.0],
        [0.0145, 0.006],
        [0.01, 0.012],
        [0, 0.014],
      ],
      { segments: 12, smooth: 44 },
    )
    rotateX(lamp, Math.PI / 2)
    translate(lamp, [sx * 0.118, 0.374, 0.316])
    forge.add('lens', lamp)
  }
  forge.add('dark', pipe([[0, 0.412, -0.24], [0, 0.44, -0.24]], 0.008, { seg: 8 }))
  forge.add('beacon', revolveY(
    [
      [0, 0],
      [0.026, 0.004],
      [0.028, 0.018],
      [0.02, 0.032],
      [0, 0.036],
    ],
    { segments: 14, smooth: 44, center: [0, 0.438, -0.24] },
  ))

  // ---- Lift eyes, whip antenna, hazard trim.
  for (const sx of [-1, 1] as const) {
    forge.add('alloy', tube(
      arcPts(0, 0, 0.024, Math.PI, 0, 6).map(([a, b]): V3 => [sx * 0.12, 0.404 + b, -0.055 + a]),
      circleProfile(0.005, 6),
      { smooth: 40 },
    ))
  }
  forge.add('dark', pipe([[0.16, 0.402, -0.19], [0.178, 0.64, -0.218]], 0.0035, { seg: 6 }))

  group.add(forge.build(materials, { castShadow: true }))

  // ---- Wheels.
  const wheels: Object3D[] = []
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const wheel = wheelAssembly(
        { radius: GK.wheelRadius, width: GK.wheelWidth, segments: 22, grousers: 9, spokes: 5, hand: sx },
        options.livery,
      )
      wheel.position.set(sx * GK.track, axleY, sz * GK.axle)
      group.add(wheel)
      wheels.push(wheel)
    }
  }

  // ---- Rake boom: pivots at the tail; the routine nods it while working.
  const tool = new Group()
  tool.position.set(0, 0.305, -0.29)
  buildRakeBoom(tool, options.livery)
  if (options.docked) tool.rotation.x = 0.82
  group.add(tool)

  // ---- Decals last: 1.5 mm proud of their plates, never on the shell itself.
  const plate = decalPlate(fleetPlate(options.name), 0.2, 0.066)
  plate.position.set(-0.2275, 0.336, 0.04)
  plate.rotation.y = -Math.PI / 2
  group.add(plate)
  const dutyPlate = decalPlate(stencilPlate(['TENDING', 'ROUTE 2']), 0.2, 0.07)
  dutyPlate.position.set(0.2275, 0.336, 0.04)
  dutyPlate.rotation.y = Math.PI / 2
  group.add(dutyPlate)
  // Face decal: seated on the panel's own normal, 1.6 mm proud of its face.
  const faceDecal = options.eyes
    ? decalPlate(eyesPlate(), 0.238, 0.09)
    : decalPlate(stencilPlate([options.name]), 0.21, 0.076)
  const standOff = 0.007 + 0.0016
  faceDecal.position.set(
    FACE_CENTER[0] + FACE_NORMAL[0] * standOff,
    FACE_CENTER[1] + FACE_NORMAL[1] * standOff,
    FACE_CENTER[2] + FACE_NORMAL[2] * standOff,
  )
  faceDecal.rotation.x = -FACE_TILT
  group.add(faceDecal)

  return { group, wheels, tool, wheelRadius: GK.wheelRadius, spinners: [] }
}

/** Profile authored as (z, y) needs its two extruded axes swapped back. */
function remapZY(s: Solid): Solid {
  for (const v of s.verts) {
    const y = v[1]
    v[1] = v[2]
    v[2] = y
  }
  for (const f of s.faces) f.reverse()
  return s
}

/** Stereo camera head on a pan/tilt yoke — shared by every machine. */
function buildSensorPod(forge: Forge, at: V3, scale: number): void {
  const s = scale
  forge.add('dark', filletBox([at[0], at[1], at[2]], [0.13 * s, 0.062 * s, 0.05 * s], 0.01 * s, { seg: 2, smooth: 30 }))
  // Sun hood, standing proud over the lenses.
  forge.add('accent', filletBox(
    [at[0], at[1] + 0.038 * s, at[2] + 0.012 * s],
    [0.142 * s, 0.011 * s, 0.062 * s],
    0.004 * s,
    { seg: 1, smooth: 30 },
  ))
  for (const sx of [-1, 1] as const) {
    const barrelAt: V3 = [at[0] + sx * 0.04 * s, at[1], at[2] + 0.026 * s]
    const barrel = revolveY(
      [
        [0.016 * s, 0],
        [0.019 * s, 0.004 * s],
        [0.019 * s, 0.014 * s],
        [0.0165 * s, 0.016 * s],
      ],
      { segments: 14, smooth: 40, center: barrelAt },
    )
    rotateX(barrel, Math.PI / 2, barrelAt)
    forge.add('dark', barrel)
    const glass = revolveY(
      [
        [0, 0],
        [0.0135 * s, 0.001 * s],
        [0.014 * s, 0.005 * s],
      ],
      { segments: 14, smooth: 44, center: [barrelAt[0], barrelAt[1], barrelAt[2] + 0.014 * s] },
    )
    rotateX(glass, Math.PI / 2, [barrelAt[0], barrelAt[1], barrelAt[2] + 0.014 * s])
    forge.add('lens', glass)
    // Yoke cheek + trunnion.
    forge.add('alloy', filletBox(
      [at[0] + sx * 0.076 * s, at[1] - 0.004 * s, at[2]],
      [0.008 * s, 0.05 * s, 0.044 * s],
      0.006 * s,
      { seg: 2, axis: 'x', smooth: 30 },
    ))
    forge.add('dark', bolt([at[0] + sx * 0.081 * s, at[1], at[2]], 0.006 * s, 'x'))
  }
}

/** Trailing rake: parallelogram arms, tilt actuator, sprung tines, skids. */
function buildRakeBoom(tool: Group, livery: Livery): void {
  const forge = new Forge()
  // Arms (two, in the (z, y) plane) from the pivot back and down.
  for (const sx of [-1, 1] as const) {
    const silhouette = ensureCCW([
      [0.03, 0.028],
      [-0.34, -0.052],
      [-0.375, -0.062],
      [-0.375, -0.088],
      [-0.33, -0.078],
      [0.03, -0.026],
    ])
    const arm = prism(silhouette, 'x', sx > 0 ? 0.07 : -0.086, sx > 0 ? 0.086 : -0.07, {
      roll: 0.003,
      rollSeg: 1,
      smooth: 32,
    })
    forge.add('alloy', remapZY(arm))
    forge.add('dark', flange([sx * 0.07, 0, 0], 0.0, 0.026, 0.01, 'x'))
  }
  forge.add('dark', pipe([[-0.09, 0, 0], [0.09, 0, 0]], 0.012, { seg: 12 }))
  // Upper link closes the parallelogram so the head keeps its angle.
  forge.add('alloy', pipe([[0, 0.05, -0.02], [0, 0.012, -0.33]], 0.008, { seg: 8 }))
  forge.add('dark', flange([0, 0.05, -0.02], 0.008, 0.015, 0.008, 'z'))

  // Tilt actuator between the arm and the head.
  const ram = actuator([0.0, 0.052, -0.062], [0.0, -0.03, -0.3], 0.011)
  forge.addAll('dark', ram.body)
  forge.addAll('alloy', ram.rod)

  // Toolbar + shroud.
  forge.add('hazard', filletBox([0, -0.075, -0.372], [0.44, 0.05, 0.038], 0.01, { seg: 2, smooth: 30 }))
  forge.add('accent', filletBox([0, -0.041, -0.352], [0.4, 0.03, 0.07], 0.008, { seg: 2, smooth: 30 }))

  // Sprung tines: real curled wire, not boxes.
  for (let i = 0; i < 11; i++) {
    const x = -0.19 + (i / 10) * 0.38
    const path: V3[] = []
    for (let k = 0; k <= 6; k++) {
      const t = k / 6
      path.push([x, -0.095 - t * 0.115, -0.372 - Math.sin(t * 1.35) * 0.055])
    }
    forge.add('dark', pipe(path, 0.0035, { seg: 6, smooth: 40 }))
  }
  // Depth skids at the ends: what actually rides the regolith.
  for (const sx of [-1, 1] as const) {
    const skid = ensureCCW([
      [0.05, -0.09],
      [0.02, -0.12],
      [-0.06, -0.126],
      [-0.09, -0.11],
      [-0.09, -0.094],
      [-0.02, -0.098],
      [0.04, -0.078],
    ])
    forge.add(
      'alloy',
      remapZY(
        prism(
          skid.map(([z, y]): V2 => [z - 0.372, y]),
          'x',
          sx * 0.2 - 0.008,
          sx * 0.2 + 0.008,
          { roll: 0.003, rollSeg: 1, smooth: 32 },
        ),
      ),
    )
  }
  tool.add(forge.build(robotMaterials(livery), { castShadow: true }))
}

/** Low four-wheeled tending rover — GK-01 / GK-02 (the one with the eyes). */
export function buildGroundskeeper(name: string, eyes: boolean): RobotRig {
  return groundskeeper({ name, eyes, livery: eyes ? 'gk02' : 'gk01' })
}

/**
 * Parked variant for the maintenance yard's charging row (built by the works
 * district): boom folded up, charge-port door swung open. Origin is at ground
 * contact, +Z forward — place it and yaw it like any other prop.
 */
export function buildDockedRobot(name = 'GK-03'): Group {
  const rig = groundskeeper({ name, eyes: false, livery: 'gk01', docked: true })
  return rig.group
}

// -------------------------------------------------------------------- sweeper

const SWEEP = {
  wheelRadius: 0.132,
  wheelWidth: 0.072,
  track: 0.222,
  axleFront: 0.12,
  axleRear: -0.38,
  sink: 0.003,
} as const

/** Brush sweeper: twin gutter brooms, hinged hopper, bumper, beacon. */
export function buildSweeper(): RobotRig {
  const materials = robotMaterials('sweep')
  const forge = new Forge()
  const group = new Group()
  const axleY = SWEEP.wheelRadius - SWEEP.sink

  // ---- Chassis pan.
  forge.add(
    'dark',
    hullSolid([
      { z: -0.54, width: 0.26, height: 0.11, y: 0.2, radius: 0.03, inset: 0.013 },
      { z: -0.526, width: 0.26, height: 0.11, y: 0.2, radius: 0.03 },
      { z: -0.3, width: 0.34, height: 0.13, y: 0.2, radius: 0.034 },
      { z: 0.16, width: 0.34, height: 0.13, y: 0.2, radius: 0.034 },
      { z: 0.31, width: 0.27, height: 0.11, y: 0.204, radius: 0.03 },
      { z: 0.324, width: 0.27, height: 0.11, y: 0.204, radius: 0.03, inset: 0.013 },
    ]),
  )

  // ---- Shell: a tall rounded body, the Starship-bot read.
  forge.add(
    'paint',
    hullShell(
      [
        { z: -0.56, halfWidth: 0.17, bottom: 0.24, top: 0.44, radius: 0.07, inset: 0.006 },
        { z: -0.548, halfWidth: 0.176, bottom: 0.24, top: 0.446, radius: 0.07 },
        { z: -0.4, halfWidth: 0.222, bottom: 0.235, top: 0.472, radius: 0.08 },
        { z: -0.05, halfWidth: 0.236, bottom: 0.232, top: 0.482, radius: 0.085 },
        { z: 0.18, halfWidth: 0.228, bottom: 0.232, top: 0.462, radius: 0.08 },
        { z: 0.33, halfWidth: 0.19, bottom: 0.238, top: 0.408, radius: 0.07 },
        { z: 0.4, halfWidth: 0.15, bottom: 0.248, top: 0.36, radius: 0.055 },
        { z: 0.412, halfWidth: 0.142, bottom: 0.252, top: 0.352, radius: 0.05, inset: 0.006 },
      ],
      0.016,
    ),
  )
  // Side intake louvres: real slots standing proud of the flank.
  for (const sx of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      forge.add(
        'dark',
        filletBox(
          [sx * 0.2375, 0.3 + i * 0.022, -0.2],
          [0.006, 0.012, 0.15],
          0.0025,
          { seg: 1, axis: 'x', smooth: 28 },
        ),
      )
    }
  }

  // ---- Debris hopper on the rear deck, with a hinged, cracked-open lid.
  const hopperY = 0.474
  forge.add(
    'accent',
    hullShell(
      [
        { z: -0.49, halfWidth: 0.155, bottom: hopperY - 0.09, top: hopperY, radius: 0.03, inset: 0.006 },
        { z: -0.478, halfWidth: 0.16, bottom: hopperY - 0.092, top: hopperY, radius: 0.03 },
        { z: -0.26, halfWidth: 0.17, bottom: hopperY - 0.096, top: hopperY, radius: 0.032 },
        { z: -0.048, halfWidth: 0.166, bottom: hopperY - 0.09, top: hopperY, radius: 0.03 },
        { z: -0.036, halfWidth: 0.16, bottom: hopperY - 0.086, top: hopperY, radius: 0.028, inset: 0.006 },
      ],
      0.014,
    ),
  )
  // Rim seal — a soft strip proud of the hopper mouth, so the lid has a seat.
  forge.add('dark', tube(
    [
      [-0.158, hopperY + 0.003, -0.482],
      [-0.168, hopperY + 0.003, -0.28],
      [-0.16, hopperY + 0.003, -0.05],
      [0.16, hopperY + 0.003, -0.05],
      [0.168, hopperY + 0.003, -0.28],
      [0.158, hopperY + 0.003, -0.482],
    ],
    roundedRect(0.012, 0.008, 0.003, 1),
    { smooth: 34 },
  ))
  for (const lidPart of [
    filletBox([0, hopperY + 0.024, -0.27], [0.336, 0.026, 0.45], 0.011, { seg: 2, smooth: 30 }),
    filletBox([0, hopperY + 0.041, -0.27], [0.2, 0.016, 0.3], 0.008, { seg: 2, smooth: 30 }),
  ]) {
    // Cracked open on its hinge line — the stiffening pad is buried in the
    // lid skin (bury, never butt), so the two parts share no face.
    rotateX(lidPart, -0.15, [0, hopperY + 0.02, -0.48])
    forge.add('paint', lidPart)
  }
  for (const sx of [-1, 1] as const) {
    forge.add('dark', pipe(
      [[sx * 0.09, hopperY + 0.018, -0.486], [sx * 0.13, hopperY + 0.018, -0.486]],
      0.009,
      { seg: 10 },
    ))
    forge.add('alloy', filletBox(
      [sx * 0.11, hopperY + 0.032, -0.472],
      [0.05, 0.03, 0.028],
      0.006,
      { seg: 2, smooth: 30 },
    ))
  }
  // Front catch + handle.
  forge.add('alloy', filletBox([0, hopperY + 0.03, -0.05], [0.06, 0.03, 0.014], 0.005, { seg: 2, smooth: 30 }))
  forge.add('alloy', tube(
    arcPts(0, 0, 0.03, Math.PI, 0, 6).map(([a, b]): V3 => [a, hopperY + 0.058 + b, -0.28]),
    circleProfile(0.006, 6),
    { smooth: 40 },
  ))

  // ---- Bumper: a real extruded strip mitred around the nose, in chevrons.
  const bumperPath: V3[] = [
    [-0.244, 0.286, -0.02],
    [-0.236, 0.286, 0.2],
    [-0.16, 0.286, 0.362],
    [0, 0.286, 0.418],
    [0.16, 0.286, 0.362],
    [0.236, 0.286, 0.2],
    [0.244, 0.286, -0.02],
  ]
  forge.add('chevron', tube(bumperPath, roundedRect(0.03, 0.07, 0.012, 2), { smooth: 34 }))
  for (const t of [0.16, 0.5, 0.84]) {
    const i = Math.min(bumperPath.length - 2, Math.floor(t * (bumperPath.length - 1)))
    const p = bumperPath[i]
    forge.add('dark', filletBox([p[0] * 0.86, 0.286, p[2] * 0.86], [0.03, 0.03, 0.03], 0.005, { seg: 1, smooth: 30 }))
  }

  // Bulkheads close the shell ends over the chassis pan.
  forge.add('alloy', filletBox([0, 0.288, 0.39], [0.24, 0.075, 0.014], 0.008, { seg: 2, smooth: 30 }))
  forge.add('alloy', filletBox([0, 0.29, -0.53], [0.26, 0.08, 0.014], 0.008, { seg: 2, smooth: 30 }))

  // ---- Sensor head + beacon mast.
  buildSensorPod(forge, [0, 0.5, 0.222], 1.1)
  forge.add('alloy', pipe([[0, 0.47, 0.235], [0, 0.478, 0.222]], 0.02, { seg: 12 }))
  forge.add('dark', pipe([[0.14, 0.474, -0.03], [0.14, 0.56, -0.03]], 0.009, { seg: 10 }))
  forge.add('beacon', revolveY(
    [
      [0, 0],
      [0.026, 0.004],
      [0.028, 0.022],
      [0.019, 0.038],
      [0, 0.043],
    ],
    { segments: 16, smooth: 44, center: [0.14, 0.552, -0.03] },
  ))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    forge.add('dark', pipe(
      [
        [0.14 + Math.cos(a) * 0.032, 0.55, -0.03 + Math.sin(a) * 0.032],
        [0.14 + Math.cos(a) * 0.027, 0.598, -0.03 + Math.sin(a) * 0.027],
      ],
      0.003,
      { seg: 6 },
    ))
  }
  forge.add('alloy', revolveY([[0, 0], [0.03, 0.002], [0.032, 0.007]], { segments: 14, smooth: 40, center: [0.14, 0.597, -0.03] }))

  // ---- Applied plates + charge port.
  for (const sx of [-1, 1] as const) {
    forge.add('alloy', filletBox([sx * 0.2465, 0.372, 0.03], [0.008, 0.086, 0.26], 0.006, { seg: 2, axis: 'x', smooth: 30 }))
  }
  forge.add('dark', flange([0, 0.26, -0.562], 0.0, 0.03, 0.008, 'z'))
  forge.add('alloy', flange([0, 0.26, -0.568], 0.008, 0.02, 0.006, 'z'))

  group.add(forge.build(materials, { castShadow: true }))

  // ---- Wheels: two driven at the rear, two steered at the front.
  const wheels: Object3D[] = []
  for (const sx of [-1, 1] as const) {
    for (const z of [SWEEP.axleFront, SWEEP.axleRear]) {
      const wheel = wheelAssembly(
        { radius: SWEEP.wheelRadius, width: SWEEP.wheelWidth, segments: 20, grousers: 8, spokes: 5, hand: sx },
        'sweep',
      )
      wheel.position.set(sx * SWEEP.track, axleY, z)
      group.add(wheel)
      wheels.push(wheel)
    }
  }

  // ---- Brush carriage: the tool group nods it down onto the paving.
  const tool = new Group()
  tool.position.set(0, 0.3, 0.1)
  const spinners = buildBrushCarriage(tool)
  group.add(tool)

  for (const sx of [-1, 1] as const) {
    const plate = decalPlate(
      sx < 0 ? stencilPlate(['SWEEP-1']) : stencilPlate(['RIM', 'PROMENADE']),
      0.22,
      0.072,
    )
    plate.position.set(sx * 0.2515, 0.372, 0.03)
    plate.rotation.y = (sx * Math.PI) / 2
    group.add(plate)
  }

  return { group, wheels, tool, wheelRadius: SWEEP.wheelRadius, spinners }
}

/** Twin gutter brooms on a nodding carriage; each disc spins on its own axis. */
function buildBrushCarriage(tool: Group): Object3D[] {
  const materials = robotMaterials('sweep')
  const forge = new Forge()
  // Carriage frame: a swan-neck out of the body to the brush mounts.
  forge.add('alloy', pipe([[-0.13, 0.02, -0.01], [0.13, 0.02, -0.01]], 0.012, { seg: 12 }))
  for (const sx of [-1, 1] as const) {
    forge.add('alloy', pipe(
      [[sx * 0.12, 0.02, -0.01], [sx * 0.18, -0.06, 0.14], [sx * 0.205, -0.16, 0.3]],
      0.011,
      { seg: 10 },
    ))
    forge.add('dark', flange([sx * 0.205, -0.162, 0.3], 0.0, 0.028, 0.014))
    // Drive can above each broom.
    forge.add('dark', revolveY(
      [
        [0, 0.052],
        [0.03, 0.05],
        [0.033, 0.02],
        [0.03, -0.006],
        [0.012, -0.012],
      ],
      { segments: 14, smooth: 38, center: [sx * 0.205, -0.162, 0.3] },
    ))
  }
  // Debris skirt: a rubber curtain between the brooms and the mouth.
  forge.add('dark', filletBox([0, -0.115, 0.19], [0.34, 0.12, 0.008], 0.004, { seg: 1, smooth: 28 }))
  tool.add(forge.build(materials, { castShadow: true }))

  const spinners: Object3D[] = []
  for (const sx of [-1, 1] as const) {
    const mount = new Group()
    mount.position.set(sx * 0.205, -0.174, 0.3)
    mount.rotation.z = -sx * 0.2
    const spinner = new Group()
    // The routine adds to rotation.z; rotation.x parks the spin axis downward.
    spinner.rotation.x = Math.PI / 2
    spinner.add(brushDisc(sx))
    mount.add(spinner)
    tool.add(mount)
    spinners.push(spinner)
  }
  return spinners
}

/** One broom: a dished plate, a hub, and 22 splayed bristle tufts. */
function brushDisc(handed: number): Group {
  const forge = new Forge()
  const materials = robotMaterials('sweep')
  // Authored in the spinner frame: disc lies in XY, spins about Z.
  forge.add('accent', prism(circleProfile(0.088, 20), 'z', -0.012, 0.0, { roll: 0.004, rollSeg: 1, smooth: 40 }))
  forge.add('dark', prism(circleProfile(0.03, 12), 'z', -0.026, -0.008, { roll: 0.004, rollSeg: 1, smooth: 40 }))
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2
    const lean = handed >= 0 ? 0.22 : -0.22
    const path: V3[] = []
    for (let k = 0; k <= 3; k++) {
      const t = k / 3
      const r = 0.072 + t * 0.062
      const swirl = a + lean * t
      path.push([Math.cos(swirl) * r, Math.sin(swirl) * r, 0.004 + t * 0.052])
    }
    forge.add('bristle', tube(path, circleProfile(0.007 - 0.002 * 0.5, 5), { smooth: 45 }))
  }
  return forge.build(materials, { castShadow: true })
}

// ----------------------------------------------------------------------- mule

const MULE = {
  wheelRadius: 0.186,
  wheelWidth: 0.1,
  track: 0.36,
  axles: [-0.5, 0.02, 0.54],
  frameY: 0.33,
  bedY: 0.44,
  sink: 0.003,
} as const

/** Six-wheeled cargo flatbed with a real ladder frame and a strapped load. */
export function buildMule(): RobotRig {
  const materials = robotMaterials('mule')
  const forge = new Forge()
  const group = new Group()
  const axleY = MULE.wheelRadius - MULE.sink

  // ---- Ladder frame: two C-section rails, cross members, gussets.
  const cRail = ensureCCW([
    [-0.05, -0.011],
    [0.05, -0.011],
    [0.05, 0.011],
    [-0.05, 0.011],
    [-0.05, 0.004],
    [0.034, 0.004],
    [0.034, -0.004],
    [-0.05, -0.004],
  ])
  for (const sx of [-1, 1] as const) {
    const rail = prism(cRail, 'z', -0.66, 0.7, { roll: 0.004, rollSeg: 1, smooth: 30 })
    if (sx < 0) mirrorX(rail)
    translate(rail, [sx * 0.26, MULE.frameY, 0])
    forge.add('alloy', rail)
  }
  for (const z of [-0.6, -0.24, 0.16, 0.62]) {
    forge.add('dark', prism(roundedRect(0.052, 0.05, 0.008, 2), 'x', -0.262, 0.262, {
      roll: 0.008,
      rollSeg: 2,
      center: [0, MULE.frameY, z],
      smooth: 30,
    }))
    for (const sx of [-1, 1] as const) {
      forge.add('alloy', remapZY(prism(
        ensureCCW([
          [z + Math.sign(z || 1) * -0.06, MULE.frameY + 0.03],
          [z, MULE.frameY + 0.03],
          [z, MULE.frameY - 0.03],
        ]),
        'x',
        sx * 0.235 - 0.005,
        sx * 0.235 + 0.005,
        { roll: 0.002, rollSeg: 1, smooth: 30 },
      )))
    }
  }

  // ---- Suspension: a trailing arm and hub motor per wheel station.
  for (const sx of [-1, 1] as const) {
    for (const z of MULE.axles) {
      forge.add('alloy', remapZY(prism(
        ensureCCW([
          [z + 0.012, MULE.frameY - 0.006],
          [z + 0.14, MULE.frameY + 0.004],
          [z + 0.15, MULE.frameY - 0.03],
          [z + 0.03, axleY + 0.03],
          [z - 0.03, axleY + 0.03],
          [z - 0.03, axleY - 0.02],
          [z + 0.02, axleY - 0.02],
        ]),
        'x',
        sx * 0.288 - 0.011,
        sx * 0.288 + 0.011,
        { roll: 0.004, rollSeg: 1, smooth: 32 },
      )))
      forge.add('dark', pipe(
        [[sx * 0.276, axleY, z], [sx * (MULE.track - 0.036), axleY, z]],
        0.026,
        { seg: 14 },
      ))
      forge.add('alloy', flange([sx * 0.3, axleY, z], 0.026, 0.045, 0.012, 'x'))
      // Coil-over per station.
      const strut = actuator(
        [sx * 0.288, MULE.frameY + 0.02, z + 0.14],
        [sx * 0.288, axleY + 0.02, z + 0.02],
        0.014,
      )
      forge.addAll('dark', strut.body)
      forge.addAll('alloy', strut.rod)
      forge.add('hazard', coilSpring(
        [sx * 0.288, MULE.frameY + 0.016, z + 0.138],
        [sx * 0.288, axleY + 0.024, z + 0.024],
        0.026,
        0.004,
        5,
      ))
    }
  }

  // ---- Cargo bed: tread deck on the frame, with a kerb rail all round.
  forge.add('accent', filletBox([0, MULE.bedY - 0.018, 0.02], [0.62, 0.03, 1.36], 0.008, { seg: 2, smooth: 30 }))
  for (let i = 0; i < 9; i++) {
    forge.add('dark', filletBox(
      [0, MULE.bedY + 0.001, -0.6 + i * 0.152],
      [0.6, 0.008, 0.05],
      0.003,
      { seg: 1, smooth: 28 },
    ))
  }
  // Tie-down rail: one mitred extrusion round the bed, with D-rings.
  const railTop = MULE.bedY + 0.072
  const railPath: V3[] = [
    [-0.312, railTop, -0.68],
    [-0.312, railTop, 0.7],
    [0.312, railTop, 0.7],
    [0.312, railTop, -0.68],
  ]
  forge.add('alloy', tube(railPath, roundedRect(0.026, 0.03, 0.008, 2), { smooth: 34, capStart: true, capEnd: true }))
  for (const sx of [-1, 1] as const) {
    for (const z of [-0.52, -0.16, 0.2, 0.56]) {
      forge.add('alloy', pipe([[sx * 0.312, MULE.bedY, z], [sx * 0.312, railTop, z]], 0.012, { seg: 10 }))
      forge.add('dark', tube(
        arcPts(0, 0, 0.028, -0.4, Math.PI + 0.4, 8).map(([a, b]): V3 => [sx * 0.336, MULE.bedY + 0.03 + b, z + a]),
        circleProfile(0.005, 6),
        { smooth: 40 },
      ))
    }
  }

  // ---- Fold-down left side, hinged at the bed edge and dropped open.
  for (const part of [
    filletBox([-0.318, MULE.bedY + 0.12, 0.02], [0.014, 0.2, 1.28], 0.006, { seg: 2, smooth: 30 }),
    filletBox([-0.318, MULE.bedY + 0.208, 0.02], [0.022, 0.026, 1.3], 0.008, { seg: 2, smooth: 30 }),
  ]) {
    // Dropped past vertical the way a tailgate hangs on its stays.
    rotateZ(part, 1.92, [-0.318, MULE.bedY + 0.02, 0])
    forge.add('paint', part)
  }
  for (const z of [-0.44, 0.48]) {
    forge.add('dark', pipe([[-0.34, MULE.bedY + 0.02, z - 0.05], [-0.34, MULE.bedY + 0.02, z + 0.05]], 0.011, { seg: 10 }))
  }

  // ---- Front module: light bar, sensor head, mast and pennant.
  forge.add('paint', hullShell(
    [
      { z: 0.62, halfWidth: 0.26, bottom: MULE.bedY - 0.02, top: 0.72, radius: 0.05, inset: 0.006 },
      { z: 0.634, halfWidth: 0.266, bottom: MULE.bedY - 0.02, top: 0.724, radius: 0.05 },
      { z: 0.72, halfWidth: 0.28, bottom: MULE.bedY - 0.03, top: 0.73, radius: 0.055 },
      { z: 0.77, halfWidth: 0.26, bottom: MULE.bedY - 0.02, top: 0.71, radius: 0.05 },
      { z: 0.782, halfWidth: 0.252, bottom: MULE.bedY - 0.014, top: 0.704, radius: 0.048, inset: 0.006 },
    ],
    0.016,
  ))
  // Back of the front module: closed, so the load bay never looks into a void.
  forge.add('alloy', filletBox([0, 0.58, 0.626], [0.46, 0.26, 0.014], 0.01, { seg: 2, smooth: 30 }))
  forge.add('chevron', tube(
    [
      [-0.3, MULE.frameY + 0.02, 0.78],
      [-0.24, MULE.frameY + 0.02, 0.84],
      [0.24, MULE.frameY + 0.02, 0.84],
      [0.3, MULE.frameY + 0.02, 0.78],
    ],
    roundedRect(0.036, 0.09, 0.014, 2),
    { smooth: 34 },
  ))
  for (const sx of [-1, 1] as const) {
    forge.add('dark', pipe([[sx * 0.16, MULE.frameY + 0.06, 0.82], [sx * 0.16, MULE.frameY + 0.06, 0.845]], 0.026, { seg: 12 }))
    forge.add('lens', revolveY(
      [
        [0, 0],
        [0.022, 0.001],
        [0.023, 0.008],
        [0.016, 0.014],
      ],
      { segments: 14, smooth: 44, center: [sx * 0.16, MULE.frameY + 0.06, 0.845] },
    ))
  }
  buildSensorPod(forge, [0, 0.752, 0.7], 1.15)
  forge.add('alloy', pipe([[0, 0.716, 0.7], [0, 0.73, 0.7]], 0.022, { seg: 12 }))
  forge.add('beacon', revolveY(
    [
      [0, 0],
      [0.03, 0.005],
      [0.032, 0.024],
      [0.02, 0.04],
      [0, 0.045],
    ],
    { segments: 16, smooth: 44, center: [-0.2, 0.726, 0.72] },
  ))
  forge.add('dark', pipe([[-0.2, MULE.bedY + 0.28, 0.72], [-0.2, 0.726, 0.72]], 0.01, { seg: 10 }))

  // Mast + pennant: the flag every yard vehicle carries.
  const mastBase: V3 = [0.286, MULE.bedY + 0.02, 0.66]
  forge.add('alloy', pipe([mastBase, [0.298, 1.26, 0.652]], 0.009, { seg: 10 }))
  forge.add('dark', flange([mastBase[0], mastBase[1], mastBase[2]], 0.009, 0.024, 0.012))
  const flagPath: V3[] = []
  for (let k = 0; k <= 8; k++) {
    const t = k / 8
    flagPath.push([0.298 - t * 0.006 + Math.sin(t * 4.1) * 0.05 * t, 1.16 - t * t * 0.03, 0.652 - t * 0.27])
  }
  forge.add('hazard', tube(flagPath, roundedRect(0.004, 0.13, 0.0015, 1), { smooth: 40 }))

  group.add(forge.build(materials, { castShadow: true }))

  // ---- Load: three varied crates, strapped down.
  buildCargo(group)

  // ---- Wheels.
  const wheels: Object3D[] = []
  for (const sx of [-1, 1] as const) {
    for (const z of MULE.axles) {
      const wheel = wheelAssembly(
        { radius: MULE.wheelRadius, width: MULE.wheelWidth, segments: 20, grousers: 8, spokes: 5, hand: sx },
        'mule',
      )
      wheel.position.set(sx * MULE.track, axleY, z)
      group.add(wheel)
      wheels.push(wheel)
    }
  }

  const plate = decalPlate(stencilPlate(['MULE-1', 'LOAD 240KG']), 0.26, 0.09)
  plate.position.set(0, 0.62, 0.7891)
  group.add(plate)

  return { group, wheels, tool: null, wheelRadius: MULE.wheelRadius, spinners: [] }
}

/** The load: a ribbed flight case, a composite crate, a wrapped bundle. */
function buildCargo(parent: Group): void {
  const forge = new Forge()
  const deck = MULE.bedY + 0.005

  // 1. Alloy flight case, ribbed, with latches and corner caps.
  const caseCenter: V3 = [-0.1, deck + 0.15, -0.34]
  forge.add('crate', filletBox(caseCenter, [0.38, 0.3, 0.46], 0.016, { seg: 2, smooth: 30 }))
  for (const z of [-0.14, 0, 0.14]) {
    forge.add('alloy', filletBox(
      [caseCenter[0], caseCenter[1] + 0.152, caseCenter[2] + z],
      [0.39, 0.008, 0.03],
      0.003,
      { seg: 1, smooth: 28 },
    ))
  }
  for (const sx of [-1, 1] as const) {
    forge.add('alloy', filletBox(
      [caseCenter[0] + sx * 0.192, caseCenter[1], caseCenter[2]],
      [0.008, 0.31, 0.47],
      0.006,
      { seg: 2, axis: 'x', smooth: 30 },
    ))
    for (const sz of [-1, 1] as const) {
      forge.add('dark', filletBox(
        [caseCenter[0] + sx * 0.16, caseCenter[1] - 0.05, caseCenter[2] + sz * 0.235],
        [0.05, 0.03, 0.014],
        0.004,
        { seg: 1, smooth: 28 },
      ))
    }
  }

  // 2. Composite crate, lid lip proud of the body.
  const crateCenter: V3 = [0.13, deck + 0.115, 0.16]
  forge.add('crateAlt', filletBox(crateCenter, [0.32, 0.23, 0.34], 0.014, { seg: 2, smooth: 30 }))
  forge.add('crateAlt', filletBox(
    [crateCenter[0], crateCenter[1] + 0.126, crateCenter[2]],
    [0.336, 0.026, 0.356],
    0.008,
    { seg: 2, smooth: 30 },
  ))
  forge.add('dark', filletBox(
    [crateCenter[0], crateCenter[1] + 0.02, crateCenter[2] + 0.176],
    [0.06, 0.05, 0.012],
    0.004,
    { seg: 1, smooth: 28 },
  ))

  // 3. Wrapped bundle: a slumped roll, cinched twice.
  const bundle = loft(
    [
      { z: -0.185, w: 0.05, h: 0.04 },
      { z: -0.155, w: 0.15, h: 0.11 },
      { z: -0.09, w: 0.235, h: 0.17 },
      { z: 0.04, w: 0.25, h: 0.18 },
      { z: 0.13, w: 0.2, h: 0.145 },
      { z: 0.175, w: 0.07, h: 0.05 },
    ].map((s) =>
      roundedRect(s.w, s.h, Math.min(s.w, s.h) * 0.42, 3).map(([x, y]): V3 => [
        x + 0.16,
        y + deck + 0.09,
        s.z - 0.66,
      ]),
    ),
    { closed: true, capStart: true, capEnd: true, smooth: 36 },
  )
  forge.add('webbing', bundle)
  for (const z of [-0.74, -0.6]) {
    forge.add('webbing', tube(
      [
        [0.03, deck + 0.09, z],
        [0.16, deck + 0.2, z],
        [0.29, deck + 0.09, z],
        [0.16, deck + 0.004, z],
        [0.03, deck + 0.09, z],
      ],
      roundedRect(0.004, 0.03, 0.0015, 1),
      { smooth: 34 },
    ))
  }

  // Ratchet straps over the load, with buckles.
  for (const z of [-0.42, -0.24, 0.1, 0.24]) {
    const overCase = z < -0.1
    const top = overCase ? deck + 0.302 : deck + 0.246
    const half = overCase ? 0.192 : 0.162
    const cx = overCase ? -0.1 : 0.13
    forge.add('webbing', tube(
      [
        [-0.316, deck - 0.02, z],
        [cx - half, top - 0.03, z],
        [cx - half * 0.6, top, z],
        [cx + half * 0.6, top, z],
        [cx + half, top - 0.03, z],
        [0.316, deck - 0.02, z],
      ],
      roundedRect(0.005, 0.036, 0.002, 1),
      { smooth: 34 },
    ))
    forge.add('dark', filletBox([0.316, deck + 0.05, z], [0.03, 0.07, 0.05], 0.008, { seg: 2, smooth: 30 }))
  }

  parent.add(forge.build(robotMaterials('mule'), { castShadow: true }))
}
