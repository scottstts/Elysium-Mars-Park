import { CanvasTexture, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { mrt, normalView, texture, vec4 } from 'three/tsl'
import { bench } from '../../archkit/kit'
import type { PartWriter } from '../../archkit/writer'
import {
  MeshData,
  SMOOTH,
  annularPrism,
  arcPts,
  bevel,
  buildGroup,
  chamferRect,
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
import { kitMaterials } from '../../materials/library'
import { broadLeafTexture } from '../../vegetation/leafTextures'
import { interiorHeight } from '../interiorHeight'
import { COMMONS } from '../parkPlan'
import { COMMONS_WELL, buildCommonsInterior } from './commonsInterior'
import type { DistrictServices } from './types'

/**
 * THE COMMONS — the reference image's centrepiece: a two-storey glazed drum on
 * the plaza's north edge, and the park's one genuinely civic room. The fit-out
 * lives in `commonsInterior.ts`; this file is the building that contains it.
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
 *
 * **The entrance.** Two bays of the ground-storey glazing are left out and a
 * flat aluminium portal is applied across them, carrying a bi-parting pair of
 * sliding leaves registered as `DoorSpec`s. The leaves are FLAT and slide on a
 * tangent, because a curved leaf cannot slide along a linear `openOffset`; the
 * portal plane stands 220 mm proud of the glazing so a leaf's travel clears
 * every mullion cap (which reach r 9.092) by at least 90 mm. Two radial glazed
 * returns close the wedge between the portal and the drum, so the only way in
 * is through the doors.
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
const Z_FLOOR = 0.18 // interior structural datum (the finish is laid ON this)
/**
 * Top of the structural slab. The finish above it is 76 mm, not 16: a 16 mm
 * screed has nowhere to put a recessed divider channel or a matting well, and
 * the first version of the fit-out drove its dust grate straight through the
 * slab — 3.65 m² of coplanar same-facing floor, the largest defect in the
 * building. Finish thickness is a structural decision, so it lives here.
 */
const Z_SCREED = Z_FLOOR - 0.06
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

/**
 * The drum's own opening: mullions `DOOR_BAY` and `DOOR_BAY + 2` are its jambs
 * and stay full height, the one between them starts at the head. 2.32 m of
 * chord at the glazing radius.
 */
const DOOR_A0 = (DOOR_BAY * Math.PI * 2) / SEG_BAY
const DOOR_A1 = ((DOOR_BAY + 2) * Math.PI * 2) / SEG_BAY
/** Head of the drum's opening: a beam between the two jamb mullions. */
const Z_OPEN_HEAD = 2.62
const Z_OPEN_HEAD_TOP = 2.86

/**
 * The applied entrance portal, all measured on the tangent plane at
 * `PHI_FRONT` (local +y). `Y_LEAF` is the leaf's INNER face; everything else
 * is derived from it, so moving the portal in or out moves one number.
 */
const Y_LEAF = 9.16
const LEAF_T = 0.075
const LEAF_W = 1.19
/** Meeting-stile overlap: each leaf runs 30 mm past the centre line. */
const LEAF_LAP = 0.03
/**
 * Clear structural opening, half-width: 2.26 m between the jamb reveals, which
 * is what the leaves uncover when both are parked. Well over the 1.8 m brief.
 */
const CLEAR_HALF = 1.13
const X_JAMB = 2.5
const JAMB_W = 0.12
const Y_PORTAL0 = 9.1
const Y_PORTAL1 = 9.4
const Z_LEAF0 = 0.03
const Z_LEAF1 = 2.45
const Z_TRACK = 2.47
const Z_PORTAL_HEAD = 2.62
const Z_PORTAL_TOP = 3.06
/** Radial glazed returns, springing off the two jamb mullions. */
const PHI_RETURN = (15 * Math.PI) / 180
const R_RETURN0 = 9.1
/**
 * Outer end of the returns. 9.40 is the last radius whose point on the 75 deg
 * radial (2.4295, 9.0806) still clears the jamb post's inner corner
 * (2.44, 9.10) — by 22 mm, which reads as the reveal it is. Pushing the return
 * INTO the jamb welded two members that then shared three faces.
 */
const R_RETURN1 = 9.4
/** Porch slab: inner arc clear of the base rail (9.12), front edge, side flare. */
const R_PORCH = 9.14
const Y_PORCH = 9.44
const PHI_PORCH = (15.7 * Math.PI) / 180

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
  // AO receiver mask 0, the same override every other glass in the park
  // carries (heroGlass, cabinGlass, milkyPanel, the dome shell). Without it a
  // pane inherits receiver 1 and GTAO darkens the GLASS wherever something
  // stands close behind or in front of it — the smudges hugging the leaning
  // rail, the mullions and the head channel on every Freedom Tower gallery
  // bay (owner report). Occlusion belongs to what the pane is seen THROUGH,
  // never to the pane. The pass-level blend makes this attachment's own alpha
  // the write authority, so alpha 0 leaves the G-buffer behind the glass
  // exactly as the opaque world wrote it.
  material.mrtNode = mrt({ normal: vec4(normalView, 0) })
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
  entrance(emit, services, world, ground, glassParts)
  roof(emit, glassParts, leaves, services)
  buildCommonsInterior(
    {
      x: COMMONS.x,
      z: COMMONS.z,
      baseY: y0,
      emit,
      world,
      leaves,
      rGlass: R_GLASS_G,
      rDrum: R_DRUM,
      rVoid: R_VOID,
      zSlab: Z_SCREED,
      zFloor: Z_FLOOR + 0.016,
      zSoffit: Z_SOFFIT,
      zL2: Z_L2,
      zL2Top: Z_L2 + 0.014,
      zHeadU: Z_HEAD_U,
      zLantern: Z_LANTERN,
      doorA0: DOOR_A0,
      doorA1: DOOR_A1,
    },
    services,
  )
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
  emit('cast', groundedBand(R_GLASS_G - 0.22 - BUTT, 0.5, Z_SCREED, ground))
  emit('cast', prism(circle(0.5 - BUTT, 24), ground(0, 0) - 0.002, Z_SCREED))
  // The finish laid ON this slab belongs to the fit-out (`commonsInterior.ts`):
  // terrazzo fields, recessed dividers, a raised medallion and the dust grate
  // are one set-out, and splitting it across two files would guarantee drift.

  // Level-2 plate: a 650 mm annular slab carrying the arcade soffit, the
  // level-2 floor and the drum's overhang. Void over the hall at R_VOID, and a
  // stairwell where the flight climbs through it. Two sectors with a 7 mm
  // movement joint at each radial butt rather than one exact butt: coincident
  // planes between two solids are a defect even when the slot is the same, and
  // the gallery's downstand fascia covers the joint from below either way.
  const w0 = COMMONS_WELL.a0
  const w1 = COMMONS_WELL.a1
  const wg = COMMONS_WELL.gap
  emit('steel', sectorBand(R_DRUM - BUTT, R_VOID, w1 + wg, w0 + Math.PI * 2 - wg, Z_SOFFIT, Z_L2, 0.025))
  emit('steel', sectorBand(R_DRUM - BUTT, COMMONS_WELL.rIn, w0 + wg, w1 - wg, Z_SOFFIT, Z_L2, 0.025))

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
    const door = storey.r === R_GLASS_G
    for (let j = 0; j < SEG_BAY; j++) {
      // The middle mullion of the entrance stands only ABOVE the opening's
      // head — it divides the two overpanels and would otherwise be a post
      // through the middle of a 2.3 m doorway.
      const from = door && j === DOOR_BAY + 1 ? Z_OPEN_HEAD_TOP + REVEAL : mz0
      emit('aluminum', mullion(bayAngle(j, SEG_BAY), rIn, from, mz1))
    }
    // Two transoms per bay: the pane divides in three, which is what a 4.2 m
    // storey height wants structurally and what the reference shows. The two
    // entrance bays are skipped — they are a doorway with a glazed overpanel.
    for (let k = 1; k <= 2; k++) {
      const zc = mz0 + ((mz1 - mz0) * k) / 3
      for (let j = 0; j < SEG_BAY; j++) {
        if (door && (j === DOOR_BAY || j === DOOR_BAY + 1)) continue
        emit('aluminum', transom(bayAngle(j, SEG_BAY), bayAngle(j + 1, SEG_BAY), rIn, zc, 0.036))
      }
    }
    if (door) {
      // Ground storey: the run stops either side of the two entrance bays and
      // resumes as an overpanel above the opening's head, so the wall is a
      // wall again above 2.88 m instead of a 1.5 m hole.
      glassParts.push(
        glassBand(storey.r, storey.z0 + 0.02, storey.z1 - 0.02, SEG_BAY, DOOR_BAY + 2, SEG_BAY - 2),
      )
      glassParts.push(glassBand(storey.r, Z_OPEN_HEAD_TOP + 0.02, storey.z1 - 0.02, SEG_BAY, DOOR_BAY, 2))
      const overMid = (Z_OPEN_HEAD_TOP + 0.02 + storey.z1 - 0.02) * 0.5
      for (const j of [DOOR_BAY, DOOR_BAY + 1]) {
        emit('aluminum', transom(bayAngle(j, SEG_BAY), bayAngle(j + 1, SEG_BAY), rIn, overMid, 0.036))
      }
      // Head beam over the opening, stopping clear of both jamb mullions (the
      // gridshell rule: mullions continuous, beams butt between them).
      const jambClear = (CAP_W / 2 + REVEAL) / storey.r
      emit(
        'steel',
        sectorBand(
          storey.r + 0.21,
          storey.r - 0.19,
          DOOR_A0 + jambClear,
          DOOR_A1 - jambClear,
          Z_OPEN_HEAD,
          Z_OPEN_HEAD_TOP,
          0.02,
        ),
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
  glassParts: MeshData[],
): void {
  const zFoot = Z_FLOOR + 0.016
  porch(emit, ground, zFoot)
  portal(emit, glassParts, zFoot)
  slidingLeaves(services, world)
  portalColliders(services, world, zFoot)

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
      // Derive the aspect from the face `signBox` actually returned (4.2714 x
      // 0.600 -> 0.1405). The hard-coded 0.13 squashed the type 8 %.
      material: signFaceMaterial(['THE COMMONS'], {
        aspect: (face.z1 - face.z0) / ((face.a1 - face.a0) * face.radius),
        tracking: 0.42,
      }),
      name: 'commons-sign',
    }),
  )
}

/**
 * The walked surface between the apron and the hall: a threshold band across
 * the drum's opening (from the interior slab's edge out to the porch) and a
 * crescent of paving under the portal. The crescent is deeper at its flanks
 * than at its centre because its back edge is the drum, which is the honest
 * shape and also the one that never fouls the glazing base rail.
 */
function porch(emit: Emit, ground: Ground, zTop: number): void {
  // 0.6 mrad short of the base rail's end caps at each jamb: two solids may
  // never share a plane, so the joint is a 5 mm reveal behind the mullion.
  const d = 0.0006
  emit('cast', groundedBand(R_PORCH - 0.004, R_GLASS_G - 0.22, zTop, ground, DOOR_A0 + d, DOOR_A1 - d))

  const aR = PHI_FRONT - PHI_PORCH
  const aL = PHI_FRONT + PHI_PORCH
  const corner = (a: number): Vec2 => [(Y_PORCH / Math.sin(a)) * Math.cos(a), Y_PORCH]
  const poly: Vec2[] = [corner(aR), corner(aL), ...arcPts(0, 0, R_PORCH, aL, aR, 26)]
  // A flat underside set below the lowest apron sample in the footprint: the
  // slab is buried everywhere rather than floating anywhere, which is the same
  // rule `groundedBand` exists to enforce for the rings.
  let low = Infinity
  for (const [x, y] of poly) low = Math.min(low, ground(x, y))
  // Poured, like the hall floor it continues — `deck` here made the porch read
  // as a steel grating in full sun.
  emit('cast', bevel(prism(poly, low - 0.006, zTop), 0.008, 1))
}

/**
 * The portal frame. Jambs continuous, head butting between them, an applied
 * nose band, a track fascia of two blades with the luminous slot in the reveal
 * between them, and two radial glazed returns springing off the drum's jamb
 * mullions to close the wedge at each side.
 */
function portal(emit: Emit, glassParts: MeshData[], zFoot: number): void {
  const yMid = (Y_PORTAL0 + Y_PORTAL1) / 2
  const yDepth = Y_PORTAL1 - Y_PORTAL0
  const hx = X_JAMB - JAMB_W / 2 - REVEAL

  for (const s of [-1, 1]) {
    emit(
      'aluminum',
      bevel(
        prism(
          roundedRect(JAMB_W, yDepth, 0.014, 2).map(([x, y]) => [s * X_JAMB + x, yMid + y] as Vec2),
          zFoot,
          Z_PORTAL_TOP,
        ),
        0.006,
        1,
      ),
    )
  }
  emit(
    'aluminum',
    bevel(
      prism(
        roundedRect(2 * hx, yDepth, 0.018, 2).map(([x, y]) => [x, yMid + y] as Vec2),
        Z_PORTAL_HEAD,
        Z_PORTAL_TOP,
      ),
      0.007,
      1,
    ),
  )
  // Applied nose band, standing 2 mm clear of the head's front face: a proud
  // trim that shares its host's plane is exactly what the clash gate catches.
  emit(
    'steelEdge',
    bevel(
      prism(
        roundedRect(2 * hx, 0.036, 0.009, 1).map(([x, y]) => [x, Y_PORTAL1 + 0.02 + y] as Vec2),
        Z_PORTAL_HEAD + 0.05,
        Z_PORTAL_TOP - 0.05,
      ),
      0.004,
      1,
    ),
  )
  for (const yc of [Y_PORTAL0 + 0.045, Y_PORTAL1 - 0.045]) {
    emit(
      'dark',
      bevel(
        prism(
          roundedRect(2 * hx - 0.02, 0.05, 0.008, 1).map(([x, y]) => [x, yc + y] as Vec2),
          Z_TRACK,
          Z_PORTAL_HEAD - 0.003,
        ),
        0.004,
        1,
      ),
    )
  }
  emit(
    'interiorGlow',
    bevel(
      prism(
        roundedRect(2 * hx - 0.09, 0.12, 0.01, 1).map(([x, y]) => [x, yMid + y] as Vec2),
        Z_TRACK + 0.004,
        Z_TRACK + 0.034,
      ),
      0.004,
      1,
    ),
  )

  for (const s of [-1, 1]) {
    const phi = PHI_FRONT + s * PHI_RETURN
    // phi − π/2 puts the extrusion axis on the TANGENT, so the section's own
    // y axis is radial. (phi lays the blade flat across the opening.)
    const spin = phi - Math.PI / 2
    const blade = (r0: number, r1: number, z0: number, z1: number, half = 0.05): MeshData => {
      const md = prismYZ(
        chamferRect(r1 - r0, z1 - z0, 0.01).map(([r, z]) => [(r0 + r1) / 2 + r, (z0 + z1) / 2 + z] as Vec2),
        -half,
        half,
      )
      rotateZ(md, spin)
      return md
    }
    // Inner post lands 8 mm off the jamb mullion's cap face (r 9.092), so the
    // return is CARRIED by the curtain wall without touching it.
    emit('aluminum', blade(R_RETURN0, R_RETURN0 + 0.09, zFoot, Z_PORTAL_TOP))
    emit('aluminum', blade(R_RETURN0 + 0.093, R_RETURN1, zFoot, zFoot + 0.14))
    emit('aluminum', blade(R_RETURN0 + 0.093, R_RETURN1, 2.6, Z_PORTAL_TOP))
    // Closing post between the sill's top and the spandrel's soffit, narrower
    // than both so no two members share a face. Running it full height instead
    // put its sides and its top on the same planes as the sill and spandrel —
    // same material, still four coplanar same-facing patches per return.
    emit('aluminum', blade(R_RETURN1 - 0.06, R_RETURN1, zFoot + 0.14, 2.6, 0.04))
    const p0 = polar(phi, R_RETURN0 + 0.1, 0)
    const p1 = polar(phi, R_RETURN1 - 0.064, 0)
    for (const [z0, z1] of [[zFoot + 0.142, 2.598]] as const) {
      glassParts.push(
        loft(
          [
            [
              [p0[0], p0[1], z0],
              [p1[0], p1[1], z0],
            ],
            [
              [p0[0], p0[1], z1],
              [p1[0], p1[1], z1],
            ],
          ],
          {},
        ),
      )
    }
  }
}

/**
 * One sliding leaf: stiles continuous, rails butting between them, glass in the
 * gap with a 6 mm gasket line all round, and a pull bar on two standoffs each
 * side. Authored around its own origin (x = width, y = thickness, z = height)
 * because `DoorsSystem` drives `panel.position` from `closedPosition`.
 */
function doorLeaf(mirror: number): Group {
  const halfW = LEAF_W / 2
  const halfT = LEAF_T / 2
  const height = Z_LEAF1 - Z_LEAF0
  const frame: MeshData[] = []
  const glass: MeshData[] = []
  const pull: MeshData[] = []

  for (const s of [-1, 1]) {
    frame.push(
      bevel(
        prism(
          roundedRect(0.09, LEAF_T, 0.01, 2).map(([x, y]) => [s * (halfW - 0.045) + x, y] as Vec2),
          0,
          height,
        ),
        0.005,
        1,
      ),
    )
  }
  for (const [zc, depth] of [
    [0.1, 0.2],
    [height - 0.09, 0.18],
  ] as const) {
    frame.push(prismYZ(chamferRect(LEAF_T, depth, 0.008).map(([y, z]) => [y, zc + z] as Vec2), -0.5, 0.5))
  }
  // `cabinGlass`, not `darkGlass`: darkGlass is opaque, and the whole point of
  // this door is that the lit hall reads through it from the plaza.
  glass.push(prismYZ(chamferRect(0.052, 2.028, 0.006).map(([y, z]) => [y, 1.22 + z] as Vec2), -0.498, 0.498))

  // Pull bars on the meeting stile, both faces.
  const hx = -mirror * 0.47
  for (const side of [-1, 1]) {
    const hy = side * (halfT + 0.082)
    pull.push(
      smoothShade(
        tubeAlong(
          [
            [hx, hy, 0.92],
            [hx, hy, 1.5],
          ],
          circle(0.018, 12),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
    for (const z of [0.96, 1.46]) {
      frame.push(
        smoothShade(
          tubeAlong(
            [
              [hx, side * (halfT - 0.002), z],
              [hx, hy - side * 0.02, z],
            ],
            circle(0.021, 10),
            { cap: true, up: [0, 0, 1] },
          ),
          SMOOTH.turned,
        ),
      )
    }
  }
  return buildGroup({ aluminum: frame, cabinGlass: glass, orangeTop: pull }, kitMaterials(), {
    castShadow: false,
    name: 'commons-leaf',
  })
}

/**
 * The two leaves, as `DoorSpec`s so `world/doors.ts` gives them the E prompt,
 * the eased slide and the collider gating. They bi-part on a tangent, which is
 * why the portal is flat: `openOffset` is a linear translation, so a leaf
 * authored on the drum's curve could not slide along its own wall.
 */
function slidingLeaves(
  services: DistrictServices,
  world: (x: number, y: number, z: number) => Vector3,
): void {
  for (const s of [1, -1]) {
    const panel = doorLeaf(s)
    panel.name = s > 0 ? 'commons-door-east' : 'commons-door-west'
    services.group.add(panel)
    services.doors.push({
      panel,
      closedPosition: world(s * (LEAF_W / 2 - LEAF_LAP), Y_LEAF + LEAF_T / 2, Z_LEAF0),
      openOffset: new Vector3(s * LEAF_W, 0, 0),
      // Anchor on the approach side at handle height, far enough apart that the
      // view-cone pick reads which leaf the guest is actually looking at.
      anchor: world(s * 0.75, Y_PORTAL1 + 0.06, 1.06),
      label: 'Open',
      collider: {
        center: world(s * 0.58, Y_LEAF + LEAF_T / 2, (Z_LEAF0 + Z_LEAF1) / 2),
        size: new Vector3(LEAF_W + 0.05, Z_LEAF1 - Z_LEAF0 + 0.02, 0.3),
      },
    })
  }
}

function portalColliders(
  services: DistrictServices,
  world: (x: number, y: number, z: number) => Vector3,
  zFoot: number,
): void {
  // Two slabs rather than one: the crescent under the portal, and the deeper
  // tongue through the drum's opening. A single box would put an invisible
  // 196 mm ledge in the arcade at the flanks.
  services.colliders.push({
    kind: 'box',
    center: world(0, 9.22, zFoot - 0.22),
    size: new Vector3(4.9, 0.44, 0.44),
  })
  services.colliders.push({
    kind: 'box',
    center: world(0, 8.85, zFoot - 0.22),
    size: new Vector3(2.4, 0.44, 0.62),
  })
  for (const s of [-1, 1]) {
    services.colliders.push({
      kind: 'box',
      center: world(s * X_JAMB, (Y_PORTAL0 + Y_PORTAL1) / 2, (zFoot + Z_PORTAL_HEAD) / 2),
      size: new Vector3(JAMB_W, Z_PORTAL_HEAD - zFoot, Y_PORTAL1 - Y_PORTAL0),
    })
    // Return screens: local +X must lie on the RADIAL, so the yaw is −phi.
    const phi = PHI_FRONT + s * PHI_RETURN
    const rMid = (R_RETURN0 + R_RETURN1) / 2
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(phi) * rMid, Math.sin(phi) * rMid, (zFoot + Z_PORTAL_HEAD) / 2),
      size: new Vector3(R_RETURN1 - R_RETURN0, Z_PORTAL_HEAD - zFoot, 0.12),
      yaw: -phi,
    })
  }
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

/**
 * A run of chord boxes along an arc: local +X on the tangent, local +Z on the
 * outward radial. Rapier has no annulus and no hollow cylinder, so a curtain
 * wall the guest can stand either side of is an n-gon of cuboids.
 */
function wallRingColliders(
  services: DistrictServices,
  world: (x: number, y: number, z: number) => Vector3,
  rMid: number,
  thickness: number,
  z0: number,
  z1: number,
  a0: number,
  a1: number,
  maxChord: number,
): void {
  const count = Math.max(1, Math.ceil((Math.abs(a1 - a0) * rMid) / maxChord))
  const step = (a1 - a0) / count
  for (let i = 0; i < count; i++) {
    const a = a0 + step * (i + 0.5)
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(a) * rMid, Math.sin(a) * rMid, (z0 + z1) / 2),
      // The chord is padded so consecutive boxes overlap and the wall has no
      // needle-thin seams for the capsule to squeeze through.
      size: new Vector3(2 * rMid * Math.sin(step / 2) + 0.1, z1 - z0, thickness),
      yaw: Math.atan2(-Math.cos(a), -Math.sin(a)),
    })
  }
}

function colliders(services: DistrictServices, world: (x: number, y: number, z: number) => Vector3): void {
  // The drum is a WALL, not a solid: the hall inside is walkable and the only
  // way through is the portal. The ground-storey ring therefore breaks over the
  // two entrance bays, and the doors' own DoorSpec colliders gate that gap.
  // (This replaced a single r 9.18 cylinder that made the building a rock.)
  wallRingColliders(services, world, R_GLASS_G + 0.22, 0.24, 0, Z_SOFFIT, DOOR_A1, DOOR_A0 + Math.PI * 2, 2.2)
  // Upper storey: the gallery's guard AND the roof parapet in one ring, since
  // the glazing (10.8), the parapet (11.3) and the roof rail all stand within
  // 0.3 m of each other in plan.
  wallRingColliders(services, world, R_GLASS_U + 0.22, 0.28, Z_L2, Z_RAIL, 0, Math.PI * 2, 2.6)

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
  /**
   * The entrance contract, in the drum's local frame. `clearWidth` is what the
   * two leaves uncover; `leafPlane` is their inner face's distance from the
   * drum centre along `PHI_FRONT`. Anything approaching the Commons (paving,
   * signage, a robot path) should read these rather than re-deriving them.
   */
  door: {
    frontAngle: PHI_FRONT,
    openingAngles: [DOOR_A0, DOOR_A1] as const,
    clearWidth: 2 * CLEAR_HALF,
    clearHeight: Z_LEAF1 - Z_LEAF0,
    leafPlane: Y_LEAF,
    porchFront: Y_PORCH,
    floor: Z_FLOOR + 0.016,
  },
} as const
