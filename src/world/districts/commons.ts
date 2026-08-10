import { CanvasTexture, DoubleSide, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { texture } from 'three/tsl'
import { bench } from '../../archkit/kit'
import type { PartWriter } from '../../archkit/writer'
import {
  MeshData,
  SMOOTH,
  annularPrism,
  arcPts,
  bevel,
  circle,
  loft,
  prism,
  prismYZ,
  revolve,
  rotX,
  rotateZ,
  roundedBoxMesh,
  roundedRect,
  smoothShade,
  toGeometry,
  translate,
  tubeAlong,
  writeInto,
} from '../../archkit/meshdata'
import type { Vec2, Vec3 } from '../../archkit/meshdata'
import { signageMaterial } from '../../materials/library'
import { broadLeafTexture } from '../../vegetation/leafTextures'
import { interiorHeight } from '../interiorHeight'
import { COMMONS } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * THE COMMONS — the reference image's centrepiece: a sealed two-storey glazed
 * drum on the plaza's north edge, built for a city that has not arrived yet.
 *
 * **Authoring frame.** Everything below is drawn Z-UP in the drum's own local
 * frame: plan `(x, y)` are offsets east/south from `COMMONS`, `z` is height
 * above the paved apron. `emit()` translates by `ORIGIN` and `meshdata`
 * converts to the world's Y-up at triangulation. Every profile in
 * `dev_docs/craft/geometry-craft.md` can therefore be typed in literally.
 *
 * **The one assembly rule that keeps this audit-clean** (the gridshell rule
 * from `dome/`, restated for a curtain wall): *ring beams are continuous →
 * mullions stop short of the ring beams → transoms stop short of the
 * mullions*. Every member family shares ONE radial datum for its inner face
 * and differs only in depth, every butt carries a 4–8 mm reveal, and the glass
 * plane sits 12 mm inboard of every mullion's inner face so no framing member
 * ever intersects a pane. Ring-to-ring joints are exact butts (coplanar but
 * OPPOSED — the `backToBack` class, which is the legitimate one).
 *
 * **Light.** The building's job at dusk is to glow from the inside out:
 * `interiorGlow` cove rings and pendant lenses behind real transmissive
 * glazing, `signageGlow` reveal strips at the sign box, `utilityLight` only
 * on lenses under ~0.1 m². The 'commons-entry' real light already exists in
 * `world/lightFixtures.ts` — nothing here registers another.
 */

// ------------------------------------------------------------------ layout
// Named metres. Nothing below re-derives a dimension (geometry-craft §7).

const SEG_SMOOTH = 80 // ring beams, plinths, slabs — a drum, not a polygon
const SEG_BAY = 48 // curtain-wall bays: mullions land on these vertices

/**
 * The reveal at every cylinder-to-cylinder butt. Two rings authored to the
 * SAME radius produce exactly coincident faces, which the audit reads as a
 * clash and a renderer reads as a flicker; `geometry-craft.md` §3 says flush
 * is forbidden and 1.5–6 mm is the reveal range. 4 mm all through.
 */
const BUTT = 0.004

/** Radii, from the middle out. */
const R_GLASS_G = 8.88 // ground-storey glazing plane (48-gon vertices)
const R_GLASS_U = 10.8 // upper-storey glazing plane
const R_COL = 10.85 // colonnade column axis
const R_DRUM = 11.3 // level-2 floor plate / roof plate edge
const R_BAND = 11.42 // applied fascia band — the sign band, 120 mm proud
const R_VOID = 4.6 // mezzanine void over the hall
const R_LANTERN = 4.2 // roof opening under the rotunda
const R_ROTUNDA = 4.45 // the stacked lantern drum on the roof

/** Heights above the apron. */
const Z_SILL = 0.3 // top of the glazing base rail
const Z_FLOOR = 0.18 // interior finished floor
const Z_SOFFIT = 4.4 // arcade + hall ceiling (underside of the level-2 plate)
const Z_L2 = 5.05 // level-2 finished floor (top of the same plate)
const Z_HEAD_U = 9.5 // upper glazing head / underside of the roof plate
const Z_ROOF = 9.95 // roof structural top
const Z_PARAPET = 10.55 // parapet coping
const Z_RAIL = 11.6 // roof railing top
const Z_ROT0 = Z_ROOF + 0.3 // rotunda springing
const Z_ROT1 = Z_ROT0 + 2.95 // rotunda head
const Z_LANTERN = Z_ROT1 + 0.26 // the dome soffit the hall pendants hang from

/** Curtain-wall member family: ONE radial datum, depth the only variable. */
const MULL_GAP = 0.012 // pane-to-mullion clearance (the glazing gasket)
const MULL_DEPTH = 0.155
const MULL_W = 0.075
const CAP_PROUD = 0.045
const CAP_W = 0.112
const REVEAL = 0.006 // shadow gap at every member butt

/** Entrance: the plaza is +Z of the drum, so the front is plan angle +90°. */
const PHI_FRONT = Math.PI / 2
/** Index of the first of the two door bays (bay j spans mullions j..j+1). */
const DOOR_BAY = SEG_BAY / 4 - 1
const CANOPY_HALF = (16 * Math.PI) / 180
const R_CANOPY = 14.3

const ORIGIN_Y = (): number => interiorHeight(COMMONS.x, COMMONS.z)

// ----------------------------------------------------------------- helpers

/** Plan point at polar `(r, t)` in the member frame rotated to `phi`. */
function polar(phi: number, r: number, t: number): Vec2 {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return [c * r - s * t, s * r + c * t]
}

/** A continuous ring beam / slab band: one closed annular solid, rims rounded. */
function ringBand(rOuter: number, rInner: number, z0: number, z1: number, rim = 0.02): MeshData {
  return annularPrism(
    circle(rOuter, SEG_SMOOTH),
    circle(rInner, SEG_SMOOTH),
    z0,
    z1,
    rim,
    2,
  )
}

/**
 * A band whose TOP is flat at `zTop` and whose BOTTOM follows the paving.
 *
 * The aprons are not level: `PADS` skirts from neighbouring pads bleed across
 * them (the works pad tilts the Commons apron 84 mm from centre to edge). A
 * plinth authored at a single datum therefore either floats a visible 5 cm
 * over the paving on the low side or buries itself on the high side. Sampling
 * `interiorHeight` per vertex is the only construction that does neither.
 *
 * Exported so `hydroTower.ts` foots its plinth the same way.
 */
export function groundedBand(
  rOuter: number,
  rInner: number,
  zTop: number,
  ground: (x: number, y: number) => number,
  a0 = 0,
  a1 = Math.PI * 2,
  seg = SEG_SMOOTH,
): MeshData {
  const closed = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9
  const steps = closed ? seg : Math.max(6, Math.round(((a1 - a0) * rOuter) / 0.35))
  const rings: Vec3[][] = []
  const count = closed ? steps : steps + 1
  for (let i = 0; i < count; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    const c = Math.cos(a)
    const s = Math.sin(a)
    rings.push([
      [c * rOuter, s * rOuter, ground(c * rOuter, s * rOuter)],
      [c * rOuter, s * rOuter, zTop],
      [c * rInner, s * rInner, zTop],
      [c * rInner, s * rInner, ground(c * rInner, s * rInner)],
    ])
  }
  return loft(rings, { closeU: closed, closeV: true, capStart: !closed, capEnd: !closed })
}

/** An arc of band (parapets with a gate, canopies, screens): one closed prism. */
function sectorBand(
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
  z0: number,
  z1: number,
  rim = 0.02,
): MeshData {
  const steps = Math.max(6, Math.round((Math.abs(a1 - a0) * rOuter) / 0.35))
  const poly = [...arcPts(0, 0, rOuter, a0, a1, steps), ...arcPts(0, 0, rInner, a1, a0, steps)]
  const md = prism(poly, z0, z1)
  bevel(md, rim, 2)
  return md
}

/**
 * One curtain-wall mullion: a capped T-section extruded vertically. The web
 * carries the glazing rebate, the cap is the visible aluminium pressure plate
 * standing 45 mm proud of the frame — which is also why no mullion face can
 * ever be coplanar with the glass plane behind it.
 */
/**
 * The member section, shared by mullions and transoms: a web carrying the
 * glazing rebate and a pressure-plate cap on a splayed shoulder.
 *
 * The splay is load-bearing for mesh hygiene, not just for looks. A square
 * shoulder puts FOUR collinear points on the line `u = depth`, and the
 * ear-clipper then emits a zero-area triangle in the extrusion's end cap —
 * 41 of them across the two buildings on the first pass. Two points per line
 * and the caps come out clean.
 */
function memberSection(halfWeb: number): Vec2[] {
  const hc = CAP_W / 2
  const d = MULL_DEPTH
  return [
    [0, -halfWeb],
    [d, -halfWeb],
    [d + 0.014, -hc],
    [d + CAP_PROUD, -hc],
    [d + CAP_PROUD, hc],
    [d + 0.014, hc],
    [d, halfWeb],
    [0, halfWeb],
  ]
}

function mullion(phi: number, rIn: number, z0: number, z1: number): MeshData {
  const md = prism(
    memberSection(MULL_W / 2).map(([u, v]) => polar(phi, rIn + u, v)),
    z0,
    z1,
  )
  return smoothShade(md, SMOOTH.moulded)
}

/**
 * One transom, spanning the chord between two adjacent mullions with a
 * `REVEAL` shadow gap at each end. Same section family as the mullion, turned
 * on its side — a curtain wall whose horizontals are a different profile from
 * its verticals reads as two systems bolted together.
 */
function transom(phiA: number, phiB: number, rIn: number, zc: number, half: number): MeshData {
  const phi = (phiA + phiB) * 0.5
  const chord = 2 * (rIn + MULL_DEPTH) * Math.sin(Math.abs(phiB - phiA) * 0.5)
  const span = chord / 2 - CAP_W / 2 - REVEAL
  const md = prismYZ(memberSection(half), -span, span)
  translate(md, [0, rIn, zc])
  rotateZ(md, phi - Math.PI / 2)
  return smoothShade(md, SMOOTH.moulded)
}

/**
 * The faceted pane band: flat glass between straight mullions, which is how a
 * curtain wall on a drum is actually glazed. `bays` lets a run stop short of
 * the entrance so the door leaves ARE the wall there rather than sitting in
 * front of a second sheet of glass.
 */
function glassBand(r: number, z0: number, z1: number, seg: number, from = 0, bays = seg): MeshData {
  const full = bays >= seg
  const at = (j: number, z: number): Vec3 => {
    const a = ((from + j) / seg) * Math.PI * 2
    return [Math.cos(a) * r, Math.sin(a) * r, z]
  }
  const count = full ? seg : bays + 1
  const lo: Vec3[] = []
  const hi: Vec3[] = []
  for (let j = 0; j < count; j++) {
    lo.push(at(j, z0))
    hi.push(at(j, z1))
  }
  return loft([lo, hi], { closeV: full })
}

/** Bay angle of index `j` (mullion axes; bays span between consecutive ones). */
function bayAngle(j: number, seg: number): number {
  return (j / seg) * Math.PI * 2
}

// -------------------------------------------------------------- sign faces

/**
 * A backlit sign face. The canvas is near-black with white ink, so
 * `emissiveNode = ink × 3.4` puts ONLY the lettering on the `signageGlow` rung
 * of the ladder in `world/lightFixtures.ts` and leaves the field dark — which
 * is exactly what the reference's "THE COMMONS" band does. Module-local
 * because the slot materials are one shared instance each and this one needs
 * its own texture; the multiplier is the contract, not the material object.
 */
function signCanvas(
  lines: string[],
  options: { widthPx?: number; aspect?: number; tracking?: number; weight?: number },
): CanvasTexture {
  const width = options.widthPx ?? 2048
  const height = Math.max(64, Math.round(width * (options.aspect ?? 0.16)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (g) {
    // A dark FIELD, not pure black: the mip chain averages this texture down
    // as the sign recedes, and a field that is merely dark keeps the averaged
    // colour on the dark side instead of drifting to mid-grey.
    g.fillStyle = '#0c0a09'
    g.fillRect(0, 0, width, height)
    g.fillStyle = '#f7f2e6'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const tracking = options.tracking ?? 0.26
    const rows = lines.length
    for (let i = 0; i < rows; i++) {
      const line = lines[i]
      const rowH = height / rows
      const size = Math.min(rowH * 0.66, (width * 0.86) / Math.max(1, line.length * (0.62 + tracking)))
      g.font = `${options.weight ?? 600} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      const advances = [...line].map((ch) => g.measureText(ch).width + size * tracking)
      const total = advances.reduce((a, b) => a + b, 0) - size * tracking
      let x = width / 2 - total / 2
      const y = rowH * (i + 0.5)
      for (let k = 0; k < line.length; k++) {
        g.fillText(line[k], x + advances[k] / 2 - (size * tracking) / 2, y)
        x += advances[k]
      }
    }
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

export interface SignFaceOptions {
  widthPx?: number
  aspect?: number
  tracking?: number
  weight?: number
  /** HDR multiplier — keep on the `signageGlow` rung (3.4) unless justified. */
  glow?: number
}

/** Emissive sign-face material. Exported so `hydroTower.ts` shares one recipe. */
export function signFaceMaterial(lines: string[], options: SignFaceOptions = {}): MeshStandardNodeMaterial {
  const tex = signCanvas(lines, options)
  const sampled = texture(tex)
  const material = new MeshStandardNodeMaterial()
  material.colorNode = sampled.rgb.mul(0.55)
  material.emissiveNode = sampled.rgb.mul(options.glow ?? 3.4)
  material.roughness = 0.44
  material.metalness = 0
  // DoubleSide is load-bearing, not laziness: the face is ONE lofted strip,
  // and `recalcNormals` orients an open component by a majority keep-score,
  // which for a single quad row is effectively arbitrary. The first build
  // shipped both sign faces back-facing — an empty tray with lit reveals and
  // no lettering in it.
  material.side = DoubleSide
  return material
}

export interface SignBoxSpec {
  /** Radius of the host wall face the box is applied to. */
  rHost: number
  a0: number
  a1: number
  /** Centre height and half-height of the OUTER frame. */
  zc: number
  halfZ: number
  /** Depth of the back plate and of the bezel in front of it. */
  back?: number
  bezel?: number
}

/**
 * A backlit sign box: back plate applied `BUTT` proud of its host, then a
 * picture-frame bezel of four members standing proud of THAT, with the
 * luminous face (a separate zero-thickness mesh from `curvedSignMesh`) sitting
 * in the reveal between them. Two `signageGlow` slots wash the reveal from
 * behind the bezel — an emissive face with no depth reads as paint
 * (`world/lightFixtures.ts`). Nothing is buried in anything.
 *
 * Exported so `hydroTower.ts` builds its "62" the same way.
 */
export function signBox(
  emit: (slot: string, part: MeshData) => void,
  spec: SignBoxSpec,
): { radius: number; a0: number; a1: number; z0: number; z1: number } {
  const back = spec.back ?? 0.06
  const bezel = spec.bezel ?? 0.05
  const r0 = spec.rHost + BUTT
  const r1 = r0 + back
  const r2 = r1 + bezel
  const { a0, a1, zc, halfZ } = spec
  const rail = Math.min(0.07, halfZ * 0.22)
  const jamb = 0.011
  emit('dark', sectorBand(r1, r0, a0, a1, zc - halfZ, zc + halfZ, 0.014))
  emit('aluminum', sectorBand(r2, r1 + BUTT, a0, a1, zc + halfZ - rail, zc + halfZ, 0.008))
  emit('aluminum', sectorBand(r2, r1 + BUTT, a0, a1, zc - halfZ, zc - halfZ + rail, 0.008))
  for (const e of [0, 1]) {
    const b0 = e === 0 ? a0 : a1 - jamb
    emit('aluminum', sectorBand(r2, r1 + BUTT, b0, b0 + jamb, zc - halfZ + rail, zc + halfZ - rail, 0.006))
  }
  // The wash strips sit in the 30 mm band between the face's edge and the
  // bezel rail: inside the rail they are invisible AND a clash, and level with
  // the face they are coplanar with it.
  const open = halfZ - rail
  for (const s of [-1, 1]) {
    const za = zc + s * (open - 0.028)
    const zb = zc + s * (open - 0.006)
    emit(
      'signageGlow',
      sectorBand(
        r1 + 0.03,
        r1 + BUTT,
        a0 + jamb + BUTT,
        a1 - jamb - BUTT,
        Math.min(za, zb),
        Math.max(za, zb),
        0.005,
      ),
    )
  }
  // The face contract: callers must not re-derive it.
  return {
    radius: r1 + 0.016,
    a0: a0 + jamb + 0.004,
    a1: a1 - jamb - 0.004,
    z0: zc - open + 0.03,
    z1: zc + open - 0.03,
  }
}

export interface CurvedSignSpec {
  /** Radius of the sign FACE (already standing proud of its tray). */
  radius: number
  a0: number
  a1: number
  z0: number
  z1: number
  /** Drum centre and the building's apron datum, in world metres. */
  centerX: number
  centerZ: number
  baseY: number
  material: MeshStandardNodeMaterial
  name: string
}

/**
 * A sign face wrapped on a drum. The loft's own planar UVs would smear the
 * lettering around the curve, so the u axis is re-derived from each vertex's
 * true bearing and v from its height — the text then fills the arc exactly,
 * whatever the radius. Shared by the Commons fascia and the tower's "62".
 */
export function curvedSignMesh(spec: CurvedSignSpec): Mesh {
  const steps = Math.max(8, Math.round((Math.abs(spec.a1 - spec.a0) * spec.radius) / 0.18))
  const arc = arcPts(0, 0, spec.radius, spec.a0, spec.a1, steps)
  const rings: Vec3[][] = [
    arc.map(([x, y]) => [x, y, spec.z0] as Vec3),
    arc.map(([x, y]) => [x, y, spec.z1] as Vec3),
  ]
  const geometry = toGeometry(loft(rings, {}))
  const uv = geometry.getAttribute('uv')
  const position = geometry.getAttribute('position')
  const mid = (spec.a0 + spec.a1) * 0.5
  const half = Math.abs(spec.a1 - spec.a0) * 0.5
  for (let i = 0; i < uv.count; i++) {
    const bearing = Math.atan2(position.getZ(i), position.getX(i))
    const delta = ((bearing - mid + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    // u runs AGAINST the bearing: seen from outside a drum, screen-right is
    // DECREASING plan angle, so `0.5 + delta/…` mirrors the lettering. v runs
    // WITH height, because the CanvasTexture's own `flipY` has already turned
    // the image over — inverting v here too flips every glyph upside down.
    uv.setXY(i, 0.5 - delta / (2 * half), (position.getY(i) - spec.z0) / (spec.z1 - spec.z0))
  }
  uv.needsUpdate = true
  geometry.translate(spec.centerX, spec.baseY, spec.centerZ)
  const mesh = new Mesh(geometry, spec.material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.name = spec.name
  return mesh
}

/** Big transmissive architectural glazing. One instance per building. */
export function curtainGlassMaterial(): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial()
  material.color.set(0xffffff)
  material.metalness = 0
  material.roughness = 0.05
  material.transmission = 1
  material.ior = 1.52
  material.thickness = 0.024
  material.attenuationColor.setRGB(0.82, 0.9, 0.86)
  material.attenuationDistance = 3.2
  material.envMapIntensity = 1
  material.transparent = false
  // Both faces, and it DOES write depth: the drum is seen through itself, so
  // the near pane must occlude the far one. (A single Fresnel only — never
  // stack an authored alpha on a lit material's own, see notes.md W1-dome.)
  material.side = DoubleSide
  return material
}

// ------------------------------------------------------------------- build

export function buildCommons(services: DistrictServices): void {
  const { writer } = services
  const y0 = ORIGIN_Y()
  const origin: Vec3 = [COMMONS.x, COMMONS.z, y0]
  const emit = (slot: string, part: MeshData): void => {
    translate(part, origin)
    writeInto(writer, slot, part)
  }
  const world = (px: number, py: number, pz: number): Vector3 =>
    new Vector3(COMMONS.x + px, y0 + pz, COMMONS.z + py)

  const glass = curtainGlassMaterial()
  const glassParts: MeshData[] = []
  const leaves: Matrix4[] = []

  /** Local height of the paved apron, relative to the building datum. */
  const ground = (px: number, py: number): number =>
    interiorHeight(COMMONS.x + px, COMMONS.z + py) - y0

  shell(emit, ground)
  curtainWall(emit, glassParts)
  arcadeAndCanopy(emit, ground)
  entrance(emit, services, world, ground)
  roof(emit, glassParts, leaves, services)
  interior(emit, leaves)
  surroundings(writer, services, world, y0)
  colliders(services, world)

  // ---- glazing: one merged mesh, no shadow (a pane in the sun's map darkens
  // the room it exists to light — notes.md W2-tram).
  const glassGeometry = glassParts.map((part) => {
    translate(part, origin)
    return toGeometry(part)
  })
  for (const geometry of glassGeometry) {
    const mesh = new Mesh(geometry, glass)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 6
    mesh.name = 'commons-glazing'
    services.group.add(mesh)
  }

  if (leaves.length > 0) {
    const foliage = new MeshStandardNodeMaterial()
    foliage.map = broadLeafTexture(19, 512)
    foliage.alphaTest = 0.34
    foliage.side = DoubleSide
    foliage.roughness = 0.72
    const card = new PlaneGeometry(0.46, 0.4)
    card.translate(0, 0.2, 0)
    const planting = new InstancedMesh(card, foliage, leaves.length)
    leaves.forEach((matrix, index) => planting.setMatrixAt(index, matrix))
    planting.instanceMatrix.needsUpdate = true
    planting.castShadow = false
    planting.name = 'commons-planting'
    services.group.add(planting)
  }
}

type Emit = (slot: string, part: MeshData) => void
type Ground = (x: number, y: number) => number

// ---------------------------------------------------------------- 1. shell

function shell(emit: Emit, ground: Ground): void {
  // Glazing base rail: the drum's foot, resting exactly on the apron (the
  // paving datum IS interiorHeight, so contact is a butt, never a float). It
  // BREAKS at the two entrance bays — a sill running under a door is the
  // classic merged-assembly clash.
  const gap0 = ((DOOR_BAY + 2) * Math.PI * 2) / SEG_BAY
  const gap1 = gap0 + Math.PI * 2 - (2 * Math.PI * 2) / SEG_BAY
  emit('cast', groundedBand(R_GLASS_G + 0.24, R_GLASS_G - 0.22, Z_SILL - 0.04, ground, gap0, gap1))
  emit('aluminum', sectorBand(R_GLASS_G + 0.19, R_GLASS_G - 0.17, gap0, gap1, Z_SILL - 0.04, Z_SILL, 0.008))

  // Interior floor: a disc inside the base rail with a 4 mm skirting reveal,
  // standing 180 mm over the apron — the sealed hall is up a step. Its
  // underside follows the apron too; the middle is flat because the apron
  // varies by under a millimetre inside r 0.5.
  emit('cast', groundedBand(R_GLASS_G - 0.22 - BUTT, 0.5, Z_FLOOR, ground))
  emit('cast', prism(circle(0.5 - BUTT, 24), ground(0, 0) - 0.002, Z_FLOOR))
  const finish = prism(circle(R_GLASS_G - 0.26, SEG_SMOOTH), Z_FLOOR, Z_FLOOR + 0.016)
  bevel(finish, 0.008, 2)
  emit('deck', finish)

  // Level-2 plate: ONE 650 mm annular slab carrying the arcade soffit, the
  // level-2 floor and the drum's overhang. Void over the hall at R_VOID.
  emit('steel', ringBand(R_DRUM - BUTT, R_VOID, Z_SOFFIT, Z_L2, 0.025))
  const l2Deck = annularPrism(
    circle(R_DRUM - 0.02, SEG_SMOOTH),
    circle(R_VOID + 0.02, SEG_SMOOTH),
    Z_L2,
    Z_L2 + 0.014,
    0.006,
    1,
  )
  emit('deck', l2Deck)

  // The applied fascia band: 120 mm proud of the plate edge, running 100 mm
  // below the soffit (a drip) and 370 mm above the floor (an upstand). This
  // is the sign band.
  emit('steel', ringBand(R_BAND, R_DRUM, Z_SOFFIT - 0.1, Z_L2 + 0.37, 0.028))

  // Roof plate + parapet + deck. The lantern opening pours the rotunda's
  // light straight down the mezzanine void.
  emit('steel', ringBand(R_DRUM, R_LANTERN, Z_HEAD_U, Z_ROOF, 0.025))
  emit('cast', ringBand(R_DRUM, R_DRUM - 0.35, Z_ROOF, Z_PARAPET, 0.026))
  emit('deck', ringBand(R_DRUM - 0.35 - BUTT, R_ROTUNDA + 0.28 + BUTT, Z_ROOF, Z_ROOF + 0.016, 0.006))
}

// -------------------------------------------------------- 2. curtain walls

function curtainWall(emit: Emit, glassParts: MeshData[]): void {
  const HEAD = 0.24 // head-beam depth: mullions stop clear of its soffit
  const storeys: Array<{ r: number; z0: number; z1: number }> = [
    { r: R_GLASS_G, z0: Z_SILL, z1: Z_SOFFIT },
    { r: R_GLASS_U, z0: Z_L2 + 0.37, z1: Z_HEAD_U },
  ]

  for (const storey of storeys) {
    const rIn = storey.r + MULL_GAP
    const mz0 = storey.z0 + REVEAL
    const mz1 = storey.z1 - HEAD - REVEAL
    for (let j = 0; j < SEG_BAY; j++) {
      emit('aluminum', mullion(bayAngle(j, SEG_BAY), rIn, mz0, mz1))
    }
    // Two transoms per bay: the pane divides in three, which is what a 4.2 m
    // storey height wants structurally and what the reference shows. The two
    // entrance bays are skipped — the door leaves are the wall there.
    const door = storey.r === R_GLASS_G
    for (let k = 1; k <= 2; k++) {
      const zc = mz0 + ((mz1 - mz0) * k) / 3
      for (let j = 0; j < SEG_BAY; j++) {
        if (door && (j === DOOR_BAY || j === DOOR_BAY + 1)) continue
        emit('aluminum', transom(bayAngle(j, SEG_BAY), bayAngle(j + 1, SEG_BAY), rIn, zc, 0.036))
      }
    }
    if (storey.r === R_GLASS_G) {
      // Ground storey: the run stops either side of the two entrance bays.
      glassParts.push(
        glassBand(storey.r, storey.z0 + 0.02, storey.z1 - 0.02, SEG_BAY, DOOR_BAY + 2, SEG_BAY - 2),
      )
    } else {
      glassParts.push(glassBand(storey.r, storey.z0 + 0.02, storey.z1 - 0.02, SEG_BAY))
    }
  }

  // Head beams: continuous rings the mullions stop 6 mm short of.
  emit('steel', ringBand(R_GLASS_G + 0.21, R_GLASS_G - 0.19, Z_SOFFIT - HEAD, Z_SOFFIT, 0.02))
  emit('steel', ringBand(R_GLASS_U + 0.21, R_GLASS_U - 0.19, Z_HEAD_U - HEAD, Z_HEAD_U, 0.02))
  // Level-2 upstand under the upper glazing, standing on the mezzanine deck.
  emit('steel', ringBand(R_GLASS_U + 0.19, R_GLASS_U - 0.17, Z_L2 + 0.014, Z_L2 + 0.37, 0.014))
}

// ------------------------------------------------- 3. arcade + entry canopy

function arcadeAndCanopy(emit: Emit, ground: Ground): void {
  // Colonnade: 12 columns carrying the drum's overhang. A drawn profile —
  // spread foot, a shaft with entasis, a flared head under the soffit. Each
  // foot is dropped to ITS OWN paving height (the arcade falls 76 mm across
  // the ring), so no column stands on air.
  const shaft = (foot: number): Vec2[] => [
    [0, foot],
    [0.3, foot],
    [0.3, foot + 0.05],
    [0.215, foot + 0.11],
    [0.2, 0.34],
    [0.185, Z_SOFFIT * 0.55],
    [0.19, Z_SOFFIT - 0.42],
    [0.25, Z_SOFFIT - 0.14],
    [0.27, Z_SOFFIT - 0.09],
    [0.27, Z_SOFFIT],
    [0, Z_SOFFIT],
  ]
  for (let i = 0; i < 12; i++) {
    const phi = (15 * Math.PI) / 180 + (i * Math.PI) / 6
    const px = Math.cos(phi) * R_COL
    const py = Math.sin(phi) * R_COL
    const column = revolve(shaft(ground(px, py)), 28, {
      capStart: true,
      capEnd: false,
      smooth: SMOOTH.turned,
    })
    translate(column, [px, py, 0])
    emit('steel', column)
  }

  // Suspended entrance canopy: cantilevered off the band, hung on four tie
  // rods, so it never touches — and never clashes with — the colonnade.
  const canopy = sectorBand(
    R_CANOPY,
    R_BAND,
    PHI_FRONT - CANOPY_HALF,
    PHI_FRONT + CANOPY_HALF,
    3.5,
    3.7,
    0.03,
  )
  emit('steel', canopy)
  const nose = sectorBand(
    R_CANOPY + 0.12,
    R_CANOPY + BUTT,
    PHI_FRONT - CANOPY_HALF,
    PHI_FRONT + CANOPY_HALF,
    3.42,
    3.78,
    0.035,
  )
  emit('aluminum', nose)
  // A luminous slot in the canopy soffit — the entrance's own light.
  emit(
    'dark',
    sectorBand(R_CANOPY - 0.6, R_CANOPY - 1.9, PHI_FRONT - CANOPY_HALF + 0.03, PHI_FRONT + CANOPY_HALF - 0.03, 3.4, 3.5, 0.012),
  )
  emit(
    'interiorGlow',
    sectorBand(
      R_CANOPY - 0.68,
      R_CANOPY - 1.82,
      PHI_FRONT - CANOPY_HALF + 0.05,
      PHI_FRONT + CANOPY_HALF - 0.05,
      3.44,
      3.47,
      0.008,
    ),
  )

  for (const s of [-1, 1]) {
    for (const t of [0.42, 0.86]) {
      const phi = PHI_FRONT + s * CANOPY_HALF * t
      const foot: Vec3 = [Math.cos(phi) * (R_CANOPY - 0.35), Math.sin(phi) * (R_CANOPY - 0.35), 3.69]
      // The head lands 20 mm off the band face: an inclined bar's end cap
      // spreads sin(33°) of its own radius radially, so a rod nominally ON the
      // face still drives 5 mm into it.
      const head: Vec3 = [Math.cos(phi) * (R_BAND + 0.02), Math.sin(phi) * (R_BAND + 0.02), Z_L2 + 0.3]
      const rod = tubeAlong([foot, head], circle(0.019, 8), { cap: true })
      emit('aluminum', smoothShade(rod, SMOOTH.turned))
      // Escutcheon at the canopy end: a THIN plate, because a deep vertical
      // bore closes on a 33° bar however wide it is.
      emit(
        'aluminum',
        annularPrism(
          circle(0.115, 14, foot[0], foot[1]),
          circle(0.075, 14, foot[0], foot[1]),
          3.7,
          3.714,
          0.004,
          1,
        ),
      )
    }
  }
}

// -------------------------------------------------------- 4. sealed entrance

function entrance(
  emit: Emit,
  services: DistrictServices,
  world: (x: number, y: number, z: number) => Vector3,
  ground: Ground,
): void {
  const bay = (Math.PI * 2) / SEG_BAY
  // Two closed leaves either side of the centre mullion at PHI_FRONT, filling
  // the gap left in the glazing run. No DoorSpec: the Commons is sealed, and
  // the story is on the plate below, not in an interaction.
  const rOut = R_GLASS_G + 0.025
  const rInn = R_GLASS_G - 0.025
  for (const k of [DOOR_BAY, DOOR_BAY + 1]) {
    const a0 = (k * Math.PI * 2) / SEG_BAY + 0.011
    const a1 = ((k + 1) * Math.PI * 2) / SEG_BAY - 0.011
    // Leaf as a real picture frame: two stiles, two rails, glass in the gap.
    emit('dark', sectorBand(rOut, rInn, a0, a1, 0.02, 0.17, 0.008))
    emit('dark', sectorBand(rOut, rInn, a0, a1, 2.43, 2.6, 0.008))
    for (const e of [0, 1]) {
      const b0 = e === 0 ? a0 : a1 - 0.0125
      emit('dark', sectorBand(rOut, rInn, b0, b0 + 0.0125, 0.17, 2.43, 0.006))
    }
    emit('darkGlass', sectorBand(rOut - 0.006, rInn + 0.006, a0 + 0.014, a1 - 0.014, 0.176, 2.424, 0.004))
    // Pull handle: a vertical tube on two standoffs, outboard of the leaf.
    const phiH = k === DOOR_BAY ? a1 - 0.028 : a0 + 0.028
    const handle = tubeAlong(
      [
        [Math.cos(phiH) * (rOut + 0.09), Math.sin(phiH) * (rOut + 0.09), 0.86],
        [Math.cos(phiH) * (rOut + 0.09), Math.sin(phiH) * (rOut + 0.09), 1.42],
      ],
      circle(0.019, 10),
      { cap: true },
    )
    emit('aluminum', smoothShade(handle, SMOOTH.turned))
    for (const zh of [0.9, 1.38]) {
      const stand = revolve(
        [
          [0, 0],
          [0.02, 0],
          [0.02, 0.07],
          [0, 0.07],
        ],
        10,
        { capStart: true, capEnd: true, axis: 'y' },
      )
      rotateZ(stand, phiH - Math.PI / 2)
      translate(stand, [Math.cos(phiH) * rOut, Math.sin(phiH) * rOut, zh])
      emit('aluminum', stand)
    }
  }
  // Threshold plate on the apron, clear of the glazing base rail's footprint
  // and following the apron's fall like everything else that touches it.
  emit(
    'steelEdge',
    groundedBand(
      R_GLASS_G + 0.94,
      R_GLASS_G + 0.26,
      ground(0, R_GLASS_G + 0.6) + 0.02,
      ground,
      PHI_FRONT - bay,
      PHI_FRONT + bay,
    ),
  )

  // "OPENING WHEN YOU ARRIVE": the whole building's story on a 0.5 m plate,
  // on a stand beside the doors. Environmental storytelling, not a HUD.
  const phiPlate = PHI_FRONT - 0.185
  const px = Math.cos(phiPlate) * 12.25
  const py = Math.sin(phiPlate) * 12.25
  const plateFoot = ground(px, py)
  const post = tubeAlong(
    [
      [px, py, plateFoot],
      [px, py, plateFoot + 0.92],
    ],
    circle(0.032, 10),
    { cap: true },
  )
  emit('dark', smoothShade(post, SMOOTH.turned))
  const backing = roundedBoxMesh([-0.3, -0.03, -0.2, 0.3, 0.03, 0.2], 0.02, 2)
  rotateZ(backing, phiPlate - Math.PI / 2)
  translate(backing, [px, py, plateFoot + 1.12])
  emit('dark', backing)
  const plate = new Mesh(
    new PlaneGeometry(0.54, 0.34),
    signageMaterial(['OPENING', 'WHEN YOU ARRIVE'], {
      background: '#171514',
      ink: '#d9d2c4',
      widthPx: 512,
    }),
  )
  plate.position.copy(world(Math.cos(phiPlate) * 12.285, Math.sin(phiPlate) * 12.285, plateFoot + 1.12))
  plate.rotation.y = Math.atan2(Math.cos(phiPlate), Math.sin(phiPlate))
  plate.castShadow = false
  services.group.add(plate)

  // THE COMMONS: a sign box applied to the fascia band.
  const face = signBox(emit, {
    rHost: R_BAND,
    a0: PHI_FRONT - (11.5 * Math.PI) / 180,
    a1: PHI_FRONT + (11.5 * Math.PI) / 180,
    zc: Z_SOFFIT + 0.24,
    halfZ: 0.4,
  })
  services.group.add(
    curvedSignMesh({
      ...face,
      centerX: COMMONS.x,
      centerZ: COMMONS.z,
      baseY: ORIGIN_Y(),
      material: signFaceMaterial(['THE COMMONS'], { aspect: 0.13, tracking: 0.42 }),
      name: 'commons-sign',
    }),
  )
}

// ----------------------------------------------------------------- 5. roof

function roof(emit: Emit, glassParts: MeshData[], leaves: Matrix4[], services: DistrictServices): void {
  const R_ROT = R_ROTUNDA

  // The stacked rotunda — the reference's crown, and the lantern that lights
  // the hall through the mezzanine void.
  emit('cast', ringBand(R_ROT + 0.28, R_LANTERN, Z_ROOF, Z_ROT0, 0.024))
  const rotIn = R_ROT + MULL_GAP
  for (let j = 0; j < 24; j++) {
    emit('aluminum', mullion(bayAngle(j, 24), rotIn, Z_ROT0 + REVEAL, Z_ROT1 - REVEAL))
  }
  for (let j = 0; j < 24; j++) {
    emit(
      'aluminum',
      transom(bayAngle(j, 24), bayAngle(j + 1, 24), rotIn, (Z_ROT0 + Z_ROT1) * 0.5, 0.034),
    )
  }
  glassParts.push(glassBand(R_ROT, Z_ROT0 + 0.02, Z_ROT1 - 0.02, 24))
  emit('steel', ringBand(R_ROT + 0.3, R_ROT - 0.24, Z_ROT1, Z_ROT1 + 0.26, 0.02))

  // Shallow dome cap, drawn as a profile and capped at the springing so no
  // n-gon fan crosses the curved surface (the crest-roll trap).
  const dome: Vec2[] = [
    [R_ROT + 0.3, Z_ROT1 + 0.26],
    [R_ROT + 0.24, Z_ROT1 + 0.4],
    [R_ROT - 0.5, Z_ROT1 + 0.86],
    [R_ROT - 1.9, Z_ROT1 + 1.24],
    [R_ROT - 3.4, Z_ROT1 + 1.44],
    [0, Z_ROT1 + 1.5],
  ]
  emit('habShell', revolve(dome, 56, { capStart: true, capEnd: false, smooth: SMOOTH.shell }))
  // Beacon on the crown.
  const mast = tubeAlong(
    [
      [0, 0, Z_ROT1 + 1.48],
      [0, 0, Z_ROT1 + 2.35],
    ],
    circle(0.038, 10),
    { cap: true },
  )
  emit('dark', smoothShade(mast, SMOOTH.turned))
  const lens = revolve(
    [
      [0, 0],
      [0.075, 0.01],
      [0.075, 0.13],
      [0, 0.15],
    ],
    14,
    { capStart: true, capEnd: false },
  )
  translate(lens, [0, 0, Z_ROT1 + 2.33])
  emit('utilityLight', lens)

  // Roof railing on the parapet — a real code-height guard, 1.05 m clear.
  // Rails are CONTINUOUS: the posts butt the top rail's flat underside, and
  // the mid rail runs on the posts' inboard face. Running either rail through
  // the posts is the classic railing interpenetration.
  const railR = R_DRUM - 0.175
  for (let i = 0; i < 40; i++) {
    const phi = (i / 40) * Math.PI * 2
    const base = roundedBoxMesh([-0.05, -0.05, Z_PARAPET, 0.05, 0.05, Z_PARAPET + 0.014], 0.006, 1)
    rotateZ(base, phi)
    translate(base, [Math.cos(phi) * railR, Math.sin(phi) * railR, 0])
    emit('steelEdge', base)
    const post = tubeAlong(
      [
        [Math.cos(phi) * railR, Math.sin(phi) * railR, Z_PARAPET + 0.014],
        [Math.cos(phi) * railR, Math.sin(phi) * railR, Z_RAIL - 0.018],
      ],
      circle(0.024, 8),
      { cap: true },
    )
    emit('orange', smoothShade(post, SMOOTH.turned))
  }
  for (const [zr, rr, slot] of [
    [Z_RAIL, railR, 'orangeTop'],
    [Z_PARAPET + 0.5, railR - 0.062, 'orange'],
  ] as const) {
    const ring = circle(rr, 80).map(([x, y]) => [x, y, zr] as Vec3)
    const rail = tubeAlong(ring, roundedRect(0.05, 0.036, 0.012, 3), { closePath: true, cap: false })
    emit(slot, smoothShade(rail, SMOOTH.moulded))
  }

  // Services penthouse — plant room with a louvred face, off the rotunda.
  const phiPent = (201 * Math.PI) / 180
  const pentX = Math.cos(phiPent) * 7.6
  const pentY = Math.sin(phiPent) * 7.6
  // Local +x is RADIAL after the rotation, so the 3.0 m dimension is the
  // depth and the 4.3 m face turns outward — the louvres go on that face.
  const pentPlan = roundedRect(3.0, 4.3, 0.14, 3).map(
    ([x, y]) =>
      [
        pentX + x * Math.cos(phiPent) - y * Math.sin(phiPent),
        pentY + x * Math.sin(phiPent) + y * Math.cos(phiPent),
      ] as Vec2,
  )
  emit('habShell', prism(pentPlan, Z_ROOF + 0.016, Z_ROOF + 2.5))
  const cap = prism(
    roundedRect(3.32, 4.62, 0.16, 3).map(
      ([x, y]) =>
        [
          pentX + x * Math.cos(phiPent) - y * Math.sin(phiPent),
          pentY + x * Math.sin(phiPent) + y * Math.cos(phiPent),
        ] as Vec2,
    ),
    Z_ROOF + 2.5,
    Z_ROOF + 2.66,
  )
  bevel(cap, 0.03, 2)
  emit('aluminum', cap)
  // Louvre blades on the outward face — real blades, real 44 mm gaps.
  for (let i = 0; i < 9; i++) {
    const blade = roundedBoxMesh([-1.75, -0.05, -0.045, 1.75, 0.05, 0.045], 0.012, 2)
    rotX(blade, -0.34)
    // −π/2: the blade's LENGTH must run tangentially across the face. Without
    // it the blade lies radially and drives 1.7 m straight into the plant room.
    rotateZ(blade, phiPent - Math.PI / 2)
    translate(blade, [
      pentX + Math.cos(phiPent) * 1.58,
      pentY + Math.sin(phiPent) * 1.58,
      Z_ROOF + 0.42 + i * 0.21,
    ])
    emit('dark', blade)
  }

  // Vent stack pair — the reference's twin towers, banded and cowled.
  for (const [phiDeg, height] of [
    [244, 3.9],
    [277, 3.2],
  ] as const) {
    const phi = (phiDeg * Math.PI) / 180
    const sx = Math.cos(phi) * 8.15
    const sy = Math.sin(phi) * 8.15
    const stack: Vec2[] = [
      [0, 0],
      [0.72, 0],
      [0.72, 0.14],
      [0.6, 0.2],
      [0.6, height - 0.55],
      [0.71, height - 0.44],
      [0.71, height - 0.3],
      [0.52, height - 0.06],
      [0.5, height],
      [0, height],
    ]
    const body = revolve(stack, 32, { capStart: true, capEnd: true, smooth: SMOOTH.turned })
    translate(body, [sx, sy, Z_ROOF + 0.016])
    emit('aluminum', body)
    for (let b = 0; b < 3; b++) {
      const band = annularPrism(
        circle(0.65, 32, sx, sy),
        circle(0.6 + BUTT, 32, sx, sy),
        Z_ROOF + 0.9 + b * (height - 1.6) * 0.5,
        Z_ROOF + 1.0 + b * (height - 1.6) * 0.5,
        0.01,
        1,
      )
      emit('dark', band)
    }
    const cowl = revolve(
      [
        [0.5, 0],
        [0.86, 0.16],
        [0.86, 0.24],
        [0.34, 0.42],
        [0, 0.44],
      ],
      32,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(cowl, [sx, sy, Z_ROOF + 0.016 + height])
    emit('aluminum', cowl)
  }

  // Plant screen: vertical fins on a rail pair, hiding the plant deck.
  const a0 = (222 * Math.PI) / 180
  const a1 = (300 * Math.PI) / 180
  const screenR = 10.2
  emit('dark', sectorBand(screenR + 0.05, screenR - 0.05, a0, a1, Z_ROOF + 0.016, Z_ROOF + 0.12, 0.01))
  emit('dark', sectorBand(screenR + 0.05, screenR - 0.05, a0, a1, Z_ROOF + 1.5, Z_ROOF + 1.62, 0.01))
  const fins = 28
  for (let i = 0; i <= fins; i++) {
    const phi = a0 + ((a1 - a0) * i) / fins
    const fin = roundedBoxMesh([-0.085, -0.014, 0, 0.085, 0.014, 1.38], 0.007, 2)
    rotateZ(fin, phi - Math.PI / 2)
    translate(fin, [Math.cos(phi) * screenR, Math.sin(phi) * screenR, Z_ROOF + 0.12])
    emit('aluminum', fin)
  }

  // Roof planters — the reference's roof greenery, in real troughs.
  const rng = services.rng.fork('commons-roof')
  for (const phiDeg of [24, 62, 118, 156]) {
    const phi = (phiDeg * Math.PI) / 180
    const trough = sectorBand(9.98, 8.62, phi - 0.13, phi + 0.13, Z_ROOF + 0.016, Z_ROOF + 0.72, 0.03)
    emit('cast', trough)
    const soil = sectorBand(9.86, 8.74, phi - 0.117, phi + 0.117, Z_ROOF + 0.44, Z_ROOF + 0.5, 0.01)
    emit('soil', soil)
    for (let i = 0; i < 16; i++) {
      const a = phi + rng.range(-0.112, 0.112)
      const r = rng.range(8.8, 9.8)
      const matrix = new Matrix4()
      matrix.compose(
        new Vector3(COMMONS.x + Math.cos(a) * r, ORIGIN_Y() + Z_ROOF + 0.5, COMMONS.z + Math.sin(a) * r),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, Math.PI)),
        new Vector3().setScalar(rng.range(0.7, 1.35)),
      )
      leaves.push(matrix)
    }
  }
}

// ------------------------------------------------------------- 6. interior

function interior(emit: Emit, leaves: Matrix4[]): void {
  // Hall columns: eight, from the finished floor to the soffit.
  const hallShaft: Vec2[] = [
    [0, 0],
    [0.24, 0],
    [0.24, 0.045],
    [0.16, 0.1],
    [0.15, Z_SOFFIT - Z_FLOOR - 0.55],
    [0.185, Z_SOFFIT - Z_FLOOR - 0.2],
    [0.2, Z_SOFFIT - Z_FLOOR - 0.016],
    [0, Z_SOFFIT - Z_FLOOR - 0.016],
  ]
  for (let i = 0; i < 8; i++) {
    const phi = (i * Math.PI) / 4 + Math.PI / 8
    const column = revolve(hallShaft, 24, { capStart: true, capEnd: false, smooth: SMOOTH.turned })
    translate(column, [Math.cos(phi) * 6.05, Math.sin(phi) * 6.05, Z_FLOOR + 0.016])
    emit('steel', column)
  }

  // Mezzanine edge: an upstand, a glass balustrade band and a capping rail.
  emit('cast', ringBand(R_VOID + 0.22, R_VOID, Z_L2 + 0.014, Z_L2 + 0.3, 0.018))
  for (let i = 0; i < 32; i++) {
    const phi = (i / 32) * Math.PI * 2
    const post = tubeAlong(
      [
        [Math.cos(phi) * (R_VOID + 0.11), Math.sin(phi) * (R_VOID + 0.11), Z_L2 + 0.3],
        [Math.cos(phi) * (R_VOID + 0.11), Math.sin(phi) * (R_VOID + 0.11), Z_L2 + 1.061],
      ],
      circle(0.021, 8),
      { cap: true },
    )
    emit('aluminum', smoothShade(post, SMOOTH.turned))
  }
  const mezzRail = tubeAlong(
    circle(R_VOID + 0.11, 64).map(([x, y]) => [x, y, Z_L2 + 1.08] as Vec3),
    roundedRect(0.052, 0.038, 0.014, 3),
    { closePath: true, cap: false },
  )
  emit('aluminum', smoothShade(mezzRail, SMOOTH.moulded))

  // Cove lighting: a recessed luminous ring at each ceiling, framed by its own
  // trim so the emissive face sits in a 55 mm reveal, never flush.
  const cove = (rOuter: number, rInner: number, zTop: number): void => {
    emit('dark', ringBand(rOuter + 0.16, rOuter, zTop - 0.1, zTop, 0.012))
    emit('dark', ringBand(rInner, rInner - 0.16, zTop - 0.1, zTop, 0.012))
    emit('interiorGlow', ringBand(rOuter - BUTT, rInner + BUTT, zTop - 0.045, zTop, 0.008))
  }
  // Cove radii keep clear of the r 6.05 column ring (columns flare to 0.27).
  cove(8.0, 6.9, Z_SOFFIT)
  cove(5.3, 4.0, Z_SOFFIT)
  cove(9.0, 7.4, Z_HEAD_U)

  // Pendant luminaires. The inner ring hangs the full height of the lantern,
  // from the rotunda's dome soffit down into the hall — that shaft of hanging
  // light through the mezzanine void is the whole point of the void.
  for (const [ring, count, drop] of [
    [3.05, 6, 6.3],
    [6.55, 10, 1.5],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const phi = (i / count) * Math.PI * 2 + 0.2
      const px = Math.cos(phi) * ring
      const py = Math.sin(phi) * ring
      const top = ring < 5 ? Z_LANTERN : Z_SOFFIT - 0.02
      const cord = tubeAlong(
        [
          [px, py, top - drop],
          [px, py, top],
        ],
        circle(0.008, 6),
        { cap: false },
      )
      emit('dark', smoothShade(cord, SMOOTH.turned))
      const shade = revolve(
        [
          [0, 0.34],
          [0.07, 0.33],
          [0.26, 0.06],
          [0.27, 0.02],
          [0.24, 0.02],
          [0.06, 0.29],
          [0, 0.3],
        ],
        18,
        { capStart: false, capEnd: false, smooth: SMOOTH.turned },
      )
      translate(shade, [px, py, top - drop - 0.34])
      emit('aluminum', shade)
      const bulb = revolve(
        [
          [0, 0],
          [0.09, 0.012],
          [0.09, 0.05],
          [0, 0.062],
        ],
        14,
        { capStart: true, capEnd: false },
      )
      translate(bulb, [px, py, top - drop - 0.36])
      emit('interiorGlow', bulb)
    }
  }

  // Furniture groupings: five tables with three chairs each, plus a counter
  // run. Simplified but real forms — a lathe-turned pedestal, a moulded top, a
  // turned-leg chair — because they are read at 1 m through clear glass.
  // Groups keep clear of the counter arc (205°–250°) and stand 0.85 m off the
  // column ring, so no chair is ever inside a column.
  const groups: Array<[number, number]> = [
    [7.6, 25],
    [7.7, 88],
    [7.6, 152],
    [7.7, 288],
    [7.6, 332],
  ]
  for (const [r, deg] of groups) {
    const phi = (deg * Math.PI) / 180
    const cx = Math.cos(phi) * r
    const cy = Math.sin(phi) * r
    table(emit, cx, cy, Z_FLOOR + 0.016)
    for (let k = 0; k < 3; k++) {
      const a = phi + Math.PI + (k - 1) * 1.15
      chair(emit, cx + Math.cos(a) * 0.85, cy + Math.sin(a) * 0.85, Z_FLOOR + 0.016, a + Math.PI)
    }
  }
  // Service counter: an arc of casework with a proud worktop.
  const cA = (Math.PI * 205) / 180
  const cB = (Math.PI * 250) / 180
  emit('dark', sectorBand(7.3, 6.5, cA, cB, Z_FLOOR + 0.016, Z_FLOOR + 0.9, 0.016))
  emit('deck', sectorBand(7.42, 6.42, cA - 0.012, cB + 0.012, Z_FLOOR + 0.9, Z_FLOOR + 0.945, 0.018))
  emit(
    'signageGlow',
    sectorBand(7.318, 7.304, cA + 0.02, cB - 0.02, Z_FLOOR + 0.06, Z_FLOOR + 0.1, 0.004),
  )

  // Two potted trees flanking the entrance, seen straight through the doors.
  for (const s of [-1, 1]) {
    const phi = PHI_FRONT + s * 0.24
    const px = Math.cos(phi) * 7.4
    const py = Math.sin(phi) * 7.4
    const pot = revolve(
      [
        [0, 0],
        [0.36, 0],
        [0.4, 0.08],
        [0.42, 0.5],
        [0.44, 0.56],
        [0.4, 0.6],
        [0.36, 0.56],
        [0, 0.54],
      ],
      24,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(pot, [px, py, Z_FLOOR + 0.016])
    emit('cast', pot)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      const rr = 0.12 + (i % 3) * 0.1
      const matrix = new Matrix4()
      matrix.compose(
        new Vector3(
          COMMONS.x + px + Math.cos(a) * rr,
          ORIGIN_Y() + Z_FLOOR + 0.57 + (i % 4) * 0.22,
          COMMONS.z + py + Math.sin(a) * rr,
        ),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a),
        new Vector3().setScalar(0.85 + (i % 5) * 0.12),
      )
      leaves.push(matrix)
    }
  }

  // Mezzanine seating: a lighter ring of tables against the upper glazing.
  for (let i = 0; i < 6; i++) {
    const phi = (i / 6) * Math.PI * 2 + 0.5
    table(emit, Math.cos(phi) * 8.3, Math.sin(phi) * 8.3, Z_L2 + 0.014)
    chair(emit, Math.cos(phi) * 7.5, Math.sin(phi) * 7.5, Z_L2 + 0.014, phi)
  }
}

function table(emit: Emit, x: number, y: number, z: number): void {
  const foot = revolve(
    [
      [0, 0],
      [0.27, 0],
      [0.27, 0.024],
      [0.08, 0.062],
      [0.07, 0.09],
      [0, 0.09],
    ],
    20,
    { capStart: true, capEnd: true, smooth: SMOOTH.turned },
  )
  translate(foot, [x, y, z])
  emit('dark', foot)
  const stem = revolve(
    [
      [0, 0.09],
      [0.055, 0.09],
      [0.048, 0.42],
      [0.05, 0.68],
      [0, 0.68],
    ],
    16,
    { capStart: true, capEnd: true, smooth: SMOOTH.turned },
  )
  translate(stem, [x, y, z])
  emit('aluminum', stem)
  const top = prism(circle(0.43, 32, x, y), z + 0.68, z + 0.715)
  bevel(top, 0.014, 2)
  emit('deck', top)
}

function chair(emit: Emit, x: number, y: number, z: number, yaw: number): void {
  const leg: Vec2[] = [
    [0, 0],
    [0.026, 0],
    [0.021, 0.2],
    [0.016, 0.42],
    [0, 0.42],
  ]
  for (const [lx, ly] of [
    [0.17, 0.17],
    [-0.17, 0.17],
    [0.17, -0.17],
    [-0.17, -0.17],
  ] as const) {
    const l = revolve(leg, 10, { capStart: true, capEnd: true, smooth: SMOOTH.turned })
    translate(l, [lx, ly, 0])
    rotateZ(l, yaw)
    translate(l, [x, y, z])
    emit('dark', l)
  }
  const pan = prism(roundedRect(0.44, 0.42, 0.055, 3), 0.42, 0.465)
  bevel(pan, 0.01, 2)
  rotateZ(pan, yaw)
  translate(pan, [x, y, z])
  emit('fabricRust', pan)
  const back = roundedBoxMesh([-0.2, -0.216, 0.465, 0.2, -0.164, 0.83], 0.018, 2)
  rotX(back, 0.13, [0, -0.19, 0.465])
  rotateZ(back, yaw)
  translate(back, [x, y, z])
  emit('fabricRust', back)
}

// -------------------------------------------------------- 7. the surrounds

function surroundings(
  writer: PartWriter,
  services: DistrictServices,
  world: (x: number, y: number, z: number) => Vector3,
  y0: number,
): void {
  const emit = (slot: string, part: MeshData): void => {
    translate(part, [COMMONS.x, COMMONS.z, y0])
    writeInto(writer, slot, part)
  }

  // Perimeter benches on the apron, sitters looking out across the park.
  for (const deg of [22, 60, 145, 200, 250, 305, 340]) {
    const phi = (deg * Math.PI) / 180
    const spot = world(Math.cos(phi) * 13.35, Math.sin(phi) * 13.35, 0)
    spot.y = interiorHeight(spot.x, spot.z)
    const yaw = Math.atan2(-Math.cos(phi), -Math.sin(phi))
    const seat = bench(writer, spot, yaw)
    services.seats.push({ ...seat, label: 'Sit' })
    services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.32),
      size: new Vector3(1.9, 0.64, 0.62),
      yaw,
    })
  }

  // Flag pair flanking the approach — the park's only ambient motion here is
  // the flag's authored wave; the fabric is a real swept solid, not a plane.
  const rng = services.rng.fork('commons-flags')
  for (const s of [-1, 1]) {
    const phi = PHI_FRONT + s * ((24 * Math.PI) / 180)
    const px = Math.cos(phi) * 13.9
    const py = Math.sin(phi) * 13.9
    const foot = interiorHeight(COMMONS.x + px, COMMONS.z + py) - y0
    const pole = revolve(
      [
        [0, foot],
        [0.16, foot],
        [0.16, foot + 0.09],
        [0.075, foot + 0.16],
        [0.062, 5.6],
        [0.05, 8.9],
        [0.036, 9.0],
        [0, 9.02],
      ],
      18,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(pole, [px, py, 0])
    emit('aluminum', pole)
    const finial = revolve(
      [
        [0, 0],
        [0.055, 0.04],
        [0.05, 0.1],
        [0, 0.14],
      ],
      12,
      { capStart: true, capEnd: false },
    )
    translate(finial, [px, py, 9.0])
    emit('steelEdge', finial)

    const phase = rng.range(0, Math.PI * 2)
    const path: Vec3[] = []
    const rolls: number[] = []
    const dir: Vec2 = [Math.cos(phi - Math.PI / 2), Math.sin(phi - Math.PI / 2)]
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const swing = Math.sin(phase + t * 4.4) * 0.16 * t
      // The hoist starts 75 mm off the mast: a flag whose first station sits
      // ON the pole axis is a pole driven through a flag.
      const along = 0.14 + t * 2.56
      path.push([px + dir[0] * along - dir[1] * swing, py + dir[1] * along + dir[0] * swing, 7.05 - t * 0.22])
      rolls.push(Math.sin(phase + t * 3.6) * 0.22 * t)
    }
    const flag = tubeAlong(path, [
      [-0.008, -0.62],
      [0.008, -0.62],
      [0.008, 0.62],
      [-0.008, 0.62],
    ], { cap: true, roll: rolls })
    emit(s < 0 ? 'fabricRust' : 'fabricBlue', smoothShade(flag, SMOOTH.moulded))
  }

  // Bollard-lit approach from the plaza: a real fixture with a recessed lens,
  // never a glowing decal.
  for (let i = 0; i < 5; i++) {
    const py = 13.6 + i * 2.3
    for (const s of [-1, 1]) {
      const px = s * 2.8
      const wx = COMMONS.x + px
      const wz = COMMONS.z + py
      const zLocal = interiorHeight(wx, wz) - y0
      // Post — neck — cap: the light lives in the 100 mm gap between the post
      // top and the cap, as a ring around the neck. A lens buried inside a
      // solid post reads as nothing and audits as a clash.
      const post = revolve(
        [
          [0, 0],
          [0.13, 0],
          [0.13, 0.05],
          [0.105, 0.09],
          [0.105, 0.7],
          [0, 0.7],
        ],
        18,
        { capStart: true, capEnd: true, smooth: SMOOTH.turned },
      )
      translate(post, [px, py, zLocal])
      emit('dark', post)
      const neck = prism(circle(0.072, 14, px, py), zLocal + 0.7, zLocal + 0.8)
      emit('dark', neck)
      const capTop = revolve(
        [
          [0, 0],
          [0.105, 0],
          [0.105, 0.075],
          [0.088, 0.105],
          [0.05, 0.12],
          [0, 0.122],
        ],
        18,
        { capStart: true, capEnd: false, smooth: SMOOTH.turned },
      )
      translate(capTop, [px, py, zLocal + 0.8])
      emit('aluminum', capTop)
      emit(
        'utilityLight',
        annularPrism(
          circle(0.1, 18, px, py),
          circle(0.076, 18, px, py),
          zLocal + 0.716,
          zLocal + 0.784,
          0.006,
          1,
        ),
      )
    }
  }
}

// ------------------------------------------------------------ 8. colliders

function colliders(services: DistrictServices, world: (x: number, y: number, z: number) => Vector3): void {
  // The sealed drum. The arcade OUTSIDE the glazing stays walkable — that is
  // the point of the setback ground floor.
  services.colliders.push({
    kind: 'cylinder',
    center: world(0, 0, (Z_ROOF + 0.2) / 2),
    halfHeight: (Z_ROOF + 0.2) / 2,
    radius: R_GLASS_G + 0.3,
  })
  for (let i = 0; i < 12; i++) {
    const phi = (15 * Math.PI) / 180 + (i * Math.PI) / 6
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(phi) * R_COL, Math.sin(phi) * R_COL, Z_SOFFIT / 2),
      size: new Vector3(0.42, Z_SOFFIT, 0.42),
      yaw: phi,
    })
  }
  for (const s of [-1, 1]) {
    const phi = PHI_FRONT + s * ((24 * Math.PI) / 180)
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(phi) * 13.9, Math.sin(phi) * 13.9, 1.2),
      size: new Vector3(0.34, 2.4, 0.34),
    })
  }
}

export const COMMONS_METRICS = {
  glazingRadius: { ground: R_GLASS_G, upper: R_GLASS_U },
  bandRadius: R_BAND,
  levels: { sill: Z_SILL, soffit: Z_SOFFIT, level2: Z_L2, head: Z_HEAD_U, roof: Z_ROOF },
  bays: SEG_BAY,
} as const
