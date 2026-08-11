import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  DoubleSide,
  Mesh,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { attribute, positionLocal, sin, texture, time, vec3 } from 'three/tsl'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  bevel,
  circle,
  hollowPrism,
  loft,
  prism,
  prismXZ,
  prismYZ,
  revolve,
  rotX,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  type Vec2,
  type Vec3,
} from '../archkit/meshdata'
import {
  bakeParts,
  bench,
  bollard,
  lampPost,
  partsTriangles,
  placeParts,
  ringBand,
  type PartSoup,
} from '../archkit/kit'
import type { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import { interiorHeight } from './interiorHeight'
import { lightFixtures } from './lightFixtures'
import type { EmissiveSlot } from './lightFixtures'
import {
  AMPHITHEATER,
  BOULEVARD,
  COMMONS,
  FIRST_TREE,
  GARDENS,
  HYDRO_TOWER,
  LOOP,
  OVERLOOK_LOUNGE,
  PARK,
  PATHS,
  PLAYGROUND,
  PORTAL_STATION,
  WATER_TOWER,
  WORKS,
  habSites,
} from './parkPlan'
import { PLANTERS, insidePlanter, pavedSignedDistance } from './pavingPlan'
import type { DistrictServices } from './districts/types'

/**
 * THE DRESSING LAYER — street furniture, wayfinding, safety kit, ambient motion.
 *
 * The reference image is not richer than this park because it has bigger
 * buildings; it is richer because the floor between them is full of small
 * correct objects: lamp columns with real luminaires, backlit name panels,
 * railings, bollards, bins, boards. This module is the SeaPark `parkFacilities`
 * pass for Mars Park: it owns placement, the wayfinding data, the sign atlas
 * and the two moving things in the park (banners and festoons). Part builders
 * that other districts share live in `archkit/kit.ts`; everything only the
 * dressing uses is authored here.
 *
 * Four rules the whole file is built around:
 *
 *  1. **Nothing floats and nothing blocks.** Every placement goes through
 *     `Site.claim()`, which tests the walking lanes derived from `PATHS`, the
 *     guideway swept volume (r 94.5–99.5, non-negotiable), the planter beds,
 *     every building footprint and every already-placed object. A rejected
 *     placement is skipped, counted and reported — never nudged silently.
 *  2. **Feet on the walkable surface.** `interiorHeight()` is the only datum;
 *     items on regolith get a base plate wide enough to read as bedded.
 *  3. **One authoring pass per family, many placements.** Every repeated object
 *     is baked once (`bakeParts`) and each placement transforms the cached
 *     triangle soup. Sixty lamp posts cost sixty matrix loops.
 *  4. **Text is one atlas.** Every legend in the park — name panels, finger
 *     boards, notice boards, plaques, ground stencils, banners — is packed into
 *     ONE canvas and drawn as two merged meshes (backlit and matte), so the
 *     whole wayfinding system is 2 draw calls rather than 60 materials.
 */

// ---------------------------------------------------------------- constants

/** Loop guideway swept volume: nothing may enter r 94.5–99.5 (masterplan). */
const GUIDEWAY_RADIUS = LOOP.radius
const GUIDEWAY_HALF = 2.5
/** Clear space a placement must leave outside a walking lane's edge. */
const LANE_CLEARANCE = 0.28
/** Emissive ladder rungs used here (see world/lightFixtures.ts). */
const SIGN_EMISSIVE = 3.4
const BULB_EMISSIVE = 5.0

// ----------------------------------------------------------- the site field

interface Lane {
  points: Vector2[]
  half: number
}

/**
 * Half-width of the corridor that must stay walkable. A path's paved width is
 * not all circulation: about a third of it is verge, which is exactly where
 * street furniture belongs (and where the reference image puts it). Keeping
 * ~2/3 clear is the rule; the clamp stops a 6 m boulevard spoke from claiming
 * an absurd corridor and a 2.4 m garden track from having none.
 */
function corridorHalf(width: number): number {
  return Math.max(0.9, Math.min(1.6, width * 0.31))
}

let LANES: Lane[] | null = null

/** Walking lanes resampled from PATHS — the clearance authority. */
function lanes(): Lane[] {
  if (LANES) return LANES
  LANES = PATHS.map((path) => {
    const control = path.points.map((p) => new Vector3(p.x, 0, p.y))
    const closed = path.points[0].distanceTo(path.points[path.points.length - 1]) < 0.01
    if (closed) control.pop()
    const curve = new CatmullRomCurve3(control, closed, 'centripetal', 0.5)
    const steps = Math.max(8, Math.round(curve.getLength() / 1.4))
    const points: Vector2[] = []
    for (let i = 0; i <= steps; i++) {
      const p = curve.getPointAt(i / steps)
      points.push(new Vector2(p.x, p.z))
    }
    return { points, half: corridorHalf(path.width) }
  })
  return LANES
}

function segmentDistance(a: Vector2, b: Vector2, x: number, z: number): number {
  const abx = b.x - a.x
  const abz = b.y - a.y
  const lengthSq = abx * abx + abz * abz
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / lengthSq))
  return Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t))
}

/** Metres from a footprint edge to the nearest walking lane edge (can be <0). */
function laneClearance(x: number, z: number): number {
  let best = Infinity
  for (const lane of lanes()) {
    for (let i = 0; i < lane.points.length - 1; i++) {
      const d = segmentDistance(lane.points[i], lane.points[i + 1], x, z) - lane.half
      if (d < best) best = d
    }
  }
  return best
}

interface Blocker {
  x: number
  z: number
  r: number
}

let BLOCKERS: Blocker[] | null = null

/** Building + structure footprints amenities must stay out of. */
function blockers(): Blocker[] {
  if (BLOCKERS) return BLOCKERS
  const list: Blocker[] = [
    { x: FIRST_TREE.x, z: FIRST_TREE.z, r: FIRST_TREE.soilRingRadius + 4.6 }, // tree + ring bench
    { x: PORTAL_STATION.x, z: PORTAL_STATION.z, r: 17 }, // 30 x 13 deck
    { x: PORTAL_STATION.x, z: PORTAL_STATION.z - 11, r: 7 }, // stair apron pad
    { x: COMMONS.x, z: COMMONS.z, r: COMMONS.radius + 3.2 },
    { x: HYDRO_TOWER.x, z: HYDRO_TOWER.z, r: HYDRO_TOWER.radius + 3.2 },
    { x: WATER_TOWER.x, z: WATER_TOWER.z, r: 7 },
    { x: AMPHITHEATER.x, z: AMPHITHEATER.z, r: AMPHITHEATER.bowlRadius + 1.5 },
    { x: PLAYGROUND.x, z: PLAYGROUND.z, r: PLAYGROUND.radius + 2 },
    { x: OVERLOOK_LOUNGE.x, z: OVERLOOK_LOUNGE.z, r: 14 },
    { x: WORKS.machineHall.x, z: WORKS.machineHall.z, r: 17 },
    { x: WORKS.tankFarm.x, z: WORKS.tankFarm.z, r: 13 },
    { x: WORKS.maintenanceYard.x, z: WORKS.maintenanceYard.z, r: 14 },
    { x: WORKS.radiators.x, z: WORKS.radiators.z, r: 13 },
  ]
  // Farmside glasshouse row: three long houses on x≈70 (approximated as discs
  // along their spines, which is what a footprint test needs).
  for (let z = -40; z <= 40; z += 5) list.push({ x: 70, z, r: 8.5 })
  for (const hab of habSites()) list.push({ x: hab.x, z: hab.z, r: 7.5 })
  // The three tram platforms sit inside the loop; their decks + ramps reach
  // r≈89 from the guideway centreline.
  for (const station of LOOP.stations) {
    const inward = LOOP.radius - 3.6 // platform centre (tramSystem)
    list.push({
      x: Math.cos(station.angle) * inward,
      z: Math.sin(station.angle) * inward,
      r: 9.5, // 4.6 x 16 deck + canopy + the ramp off its inboard end
    })
  }
  BLOCKERS = list
  return BLOCKERS
}

interface Claim {
  x: number
  z: number
  r: number
  family: string
}

/**
 * The placement ledger. Every family asks it for space; it answers with the
 * same rules for everyone and keeps the counts the density report prints.
 */
class Site {
  readonly claims: Claim[] = []
  readonly counts = new Map<string, number>()
  readonly rejects = new Map<string, number>()

  /** Would an object of this footprint be legal here? */
  free(x: number, z: number, r: number, options?: { offPath?: boolean }): boolean {
    const radius = Math.hypot(x, z)
    if (radius > PARK.floorRadius - r - 1) return false
    if (Math.abs(radius - GUIDEWAY_RADIUS) < GUIDEWAY_HALF + r + 0.15) return false
    if (!options?.offPath && laneClearance(x, z) < r + LANE_CLEARANCE) return false
    if (insidePlanter(x, z, r + 0.25)) return false
    for (const b of blockers()) {
      if (Math.hypot(x - b.x, z - b.z) < b.r + r) return false
    }
    for (const c of this.claims) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + r + 0.35) return false
    }
    return true
  }

  /** Take the ground if the rules allow it. Silent — no reject accounting. */
  place(family: string, x: number, z: number, r: number, options?: { offPath?: boolean }): boolean {
    if (!this.free(x, z, r, options)) return false
    this.claims.push({ x, z, r, family })
    this.counts.set(family, (this.counts.get(family) ?? 0) + 1)
    return true
  }

  claim(family: string, x: number, z: number, r: number, options?: { offPath?: boolean }): boolean {
    if (this.place(family, x, z, r, options)) return true
    this.rejects.set(family, (this.rejects.get(family) ?? 0) + 1)
    return false
  }

  /**
   * Find room near a wanted spot: the preferred bearing first, then a widening
   * fan around it. A single outward ray gives up the moment one blocker sits on
   * that line, which is how a station board ends up unplaced next to a station.
   */
  nudge(
    family: string,
    x: number,
    z: number,
    r: number,
    dirX: number,
    dirZ: number,
    tries = 7,
    step = 1.3,
  ): Vector3 | null {
    if (this.place(family, x, z, r)) return new Vector3(x, interiorHeight(x, z), z)
    const base = Math.atan2(dirX, dirZ)
    for (let i = 1; i <= tries; i++) {
      for (let k = 0; k < 7; k++) {
        const angle = base + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5)
        const px = x + Math.sin(angle) * step * i
        const pz = z + Math.cos(angle) * step * i
        if (this.place(family, px, pz, r)) return new Vector3(px, interiorHeight(px, pz), pz)
      }
    }
    this.rejects.set(family, (this.rejects.get(family) ?? 0) + 1)
    return null
  }

  total(): number {
    let n = 0
    for (const v of this.counts.values()) n += v
    return n
  }
}

// -------------------------------------------------------------- sign atlas

type SignStyle = 'name' | 'sub' | 'plate' | 'board' | 'finger' | 'stencil' | 'banner'

interface SignArt {
  id: string
  style: SignStyle
  lines: string[]
  aspect: number
  accent?: string
  /**
   * `finger` only: draw the chevron at the LEFT of the tile. A finger board is
   * read from both broad faces, and the two faces' right-vectors are opposite,
   * so one of them needs the arrow on the other side to keep pointing at the
   * board's tip. The TEXT must still read left-to-right on both, which is why
   * this is a separate tile and not the `mirror` flag.
   */
  arrowLeft?: boolean
}

interface SignFace {
  art: SignArt
  center: Vector3
  yaw: number
  pitch: number
  width: number
  height: number
  lit: boolean
  mirror?: boolean
}

interface AtlasRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

const STYLE_HEIGHT: Record<SignStyle, number> = {
  name: 128,
  sub: 96,
  plate: 128,
  board: 200,
  finger: 72,
  stencil: 88,
  banner: 288,
}

/**
 * Shelf-pack every legend in the park into ONE canvas, at each sign's own
 * aspect so nothing is stretched. Returns the texture plus a rect per id;
 * the flat sign meshes and the banner cloths both index it.
 */
function buildAtlas(arts: SignArt[]): { texture: CanvasTexture; rects: Map<string, AtlasRect> } {
  const WIDTH = 2048
  const PAD = 4
  const boxes = arts.map((art) => {
    const h = STYLE_HEIGHT[art.style]
    const w = Math.max(48, Math.min(1000, Math.round(h * art.aspect)))
    return { art, w, h, x: 0, y: 0 }
  })
  // Tall shelves first: a greedy shelf pack wastes almost nothing that way.
  const order = [...boxes].sort((a, b) => b.h - a.h)
  let shelfY = PAD
  let shelfH = 0
  let cursor = PAD
  for (const box of order) {
    if (cursor + box.w + PAD > WIDTH) {
      shelfY += shelfH + PAD
      shelfH = 0
      cursor = PAD
    }
    box.x = cursor
    box.y = shelfY
    cursor += box.w + PAD
    shelfH = Math.max(shelfH, box.h)
  }
  const used = shelfY + shelfH + PAD
  let height = 64
  while (height < used) height *= 2

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = height
  const g = canvas.getContext('2d')
  const rects = new Map<string, AtlasRect>()
  for (const box of boxes) {
    rects.set(box.art.id, {
      u0: box.x / WIDTH,
      u1: (box.x + box.w) / WIDTH,
      v0: 1 - (box.y + box.h) / height,
      v1: 1 - box.y / height,
    })
    if (g) drawSign(g, box.art, box.x, box.y, box.w, box.h)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return { texture: tex, rects }
}

/** Shrink a font until the line fits — SeaPark's `fitFont`, same reason. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight = 700): number {
  let size = start
  for (; size > 8; size -= 1) {
    g.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    if (g.measureText(text).width <= maxWidth) break
  }
  return size
}

function spaced(text: string, gap = '  '): string {
  return text.split('').join(gap)
}

function drawSign(g: CanvasRenderingContext2D, art: SignArt, x: number, y: number, w: number, h: number): void {
  const accent = art.accent ?? '#c9561d'
  g.save()
  g.translate(x, y)
  g.beginPath()
  g.rect(0, 0, w, h)
  g.clip()

  if (art.style === 'plate' || art.style === 'finger') {
    // Engraved alloy: a light plate with dark cut letters and a top bevel.
    g.fillStyle = art.style === 'finger' ? '#22201d' : '#4a4641'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,250,240,0.16)'
    g.fillRect(0, 0, w, 2)
    g.fillStyle = 'rgba(0,0,0,0.22)'
    g.fillRect(0, h - 2, w, 2)
  } else if (art.style === 'banner') {
    g.fillStyle = '#7d3116'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(244,236,222,0.75)'
    g.lineWidth = Math.max(2, w * 0.022)
    g.strokeRect(w * 0.07, h * 0.035, w * 0.86, h * 0.93)
  } else {
    g.fillStyle = '#17161a'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(226,214,196,0.22)'
    g.lineWidth = 2
    g.strokeRect(4, 4, w - 8, h - 8)
  }

  g.textAlign = 'center'
  g.textBaseline = 'middle'

  if (art.style === 'board') {
    // Notice board: accent header bar, then small left-aligned body copy.
    const headerH = Math.round(h * 0.2)
    g.fillStyle = accent
    g.fillRect(6, 6, w - 12, headerH)
    g.fillStyle = '#16130f'
    const hs = fitFont(g, spaced(art.lines[0]), w - 34, headerH * 0.62)
    g.font = `800 ${hs}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillText(spaced(art.lines[0]), w / 2, 6 + headerH / 2 + 1)
    g.textAlign = 'left'
    const body = art.lines.slice(1)
    const lineH = (h - headerH - 22) / Math.max(1, body.length)
    body.forEach((line, i) => {
      const size = fitFont(g, line, w - 34, Math.min(lineH * 0.66, h * 0.11), 500)
      g.font = `500 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillStyle = i === 0 ? '#f2e9d8' : '#cbc0ae'
      g.fillText(line, 17, headerH + 16 + lineH * (i + 0.5))
    })
    g.restore()
    return
  }

  if (art.style === 'finger') {
    // Directional board: text left, a chevron pointing at the destination.
    g.textAlign = 'left'
    const size = fitFont(g, art.lines[0], w * 0.68, h * 0.5)
    g.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillStyle = '#f0e7d6'
    g.fillText(art.lines[0], w * (art.arrowLeft ? 0.24 : 0.08), h * 0.52)
    const tip = art.arrowLeft ? 0.05 : 0.95
    const base = art.arrowLeft ? 0.2 : 0.8
    g.beginPath()
    g.moveTo(w * base, h * 0.24)
    g.lineTo(w * tip, h * 0.5)
    g.lineTo(w * base, h * 0.76)
    g.closePath()
    g.fillStyle = accent
    g.fill()
    g.restore()
    return
  }

  if (art.style === 'banner') {
    // Vertical banner: park mark over stacked district type.
    g.fillStyle = '#f6efe2'
    const mark = fitFont(g, spaced(art.lines[0], ' '), w * 0.72, h * 0.062)
    g.font = `800 ${mark}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillText(spaced(art.lines[0], ' '), w / 2, h * 0.16)
    g.fillStyle = 'rgba(246,239,226,0.8)'
    g.fillRect(w * 0.24, h * 0.22, w * 0.52, Math.max(2, h * 0.007))
    const words = art.lines.slice(1)
    words.forEach((word, i) => {
      const size = fitFont(g, word, w * 0.74, h * 0.115)
      g.font = `800 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
      g.fillStyle = '#f8f2e6'
      g.fillText(word, w / 2, h * (0.36 + i * 0.15))
    })
    g.restore()
    return
  }

  // name / sub / plate / stencil: centred, letterspaced, with an accent rule.
  const dark = art.style === 'plate'
  const lineH = h / (art.lines.length + 0.55)
  art.lines.forEach((line, i) => {
    const text = i === 0 ? spaced(line) : line
    const size = fitFont(g, text, w - 26, Math.min(lineH * 0.74, h * 0.5), i === 0 ? 700 : 500)
    g.font = `${i === 0 ? 700 : 500} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    g.fillStyle = dark ? (i === 0 ? '#15120e' : '#2b261f') : i === 0 ? '#f5eddd' : '#c8bda9'
    g.fillText(text, w / 2, h / 2 + (i - (art.lines.length - 1) / 2) * lineH)
  })
  if (art.style !== 'plate') {
    g.fillStyle = accent
    g.fillRect(w * 0.16, h - 12, w * 0.68, 4)
  }
  g.restore()
}

/** One merged quad mesh per lighting class. Faces are flat plates, 2 tris each. */
function buildSignMeshes(
  faces: SignFace[],
  rects: Map<string, AtlasRect>,
  tex: CanvasTexture,
): Mesh[] {
  const groups: Array<{ lit: boolean; faces: SignFace[] }> = [
    { lit: true, faces: faces.filter((f) => f.lit) },
    { lit: false, faces: faces.filter((f) => !f.lit) },
  ]
  const meshes: Mesh[] = []
  for (const group of groups) {
    if (group.faces.length === 0) continue
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    for (const face of group.faces) {
      const rect = rects.get(face.art.id)
      if (!rect) continue
      const cy = Math.cos(face.yaw)
      const sy = Math.sin(face.yaw)
      const right = new Vector3(cy, 0, -sy)
      const n0 = new Vector3(sy, 0, cy)
      const cp = Math.cos(face.pitch)
      const sp = Math.sin(face.pitch)
      const normal = new Vector3(n0.x * cp, sp, n0.z * cp)
      const up = new Vector3(-n0.x * sp, cp, -n0.z * sp)
      const hw = face.width / 2
      const hh = face.height / 2
      const corner = (sx: number, sv: number): Vector3 =>
        face.center.clone().addScaledVector(right, sx * hw).addScaledVector(up, sv * hh)
      const bl = corner(-1, -1)
      const br = corner(1, -1)
      const tr = corner(1, 1)
      const tl = corner(-1, 1)
      const u0 = face.mirror ? rect.u1 : rect.u0
      const u1 = face.mirror ? rect.u0 : rect.u1
      const quad: Array<[Vector3, number, number]> = [
        [bl, u0, rect.v0],
        [br, u1, rect.v0],
        [tr, u1, rect.v1],
        [bl, u0, rect.v0],
        [tr, u1, rect.v1],
        [tl, u0, rect.v1],
      ]
      for (const [p, u, v] of quad) {
        positions.push(p.x, p.y, p.z)
        normals.push(normal.x, normal.y, normal.z)
        uvs.push(u, v)
      }
    }
    if (positions.length === 0) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    const material = new MeshStandardNodeMaterial()
    const map = texture(tex)
    material.colorNode = map
    material.roughness = group.lit ? 0.4 : 0.62
    material.metalness = group.lit ? 0 : 0.15
    if (group.lit) {
      // Backlit acrylic: the ink IS the emitter, so a dark ground stays dark
      // and only the legend crosses the bloom threshold. Same rung as the
      // `signageGlow` slot, so the artificial layer keeps one ladder.
      material.emissiveNode = map.mul(SIGN_EMISSIVE) as unknown as Node<'vec3'>
    }
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = !group.lit
    mesh.name = group.lit ? 'amenities:signs-lit' : 'amenities:signs-plate'
    meshes.push(mesh)
  }
  return meshes
}

// ------------------------------------------------------------ ambient motion

/**
 * The two moving things in the park. Amplitude is deliberately tiny: this is
 * sealed interior air under a dome, not weather. The wave rides a baked
 * `sway` attribute — `(dirX·w, dirZ·w, phase)`, where `dir` is the horizontal
 * flutter direction and `w` the free-edge weight — so hundreds of banners and
 * festoon bulbs merge into one geometry and still move independently.
 */
function swayPosition(amplitude: number, rate: number): Node<'vec3'> {
  const sway = attribute('sway', 'vec3') as unknown as Node<'vec3'>
  const phase = time.mul(rate).add(sway.z)
  const wave = sin(phase)
    .mul(0.74)
    .add(sin(phase.mul(2.31).add(1.9)).mul(0.26))
    .mul(amplitude)
  const lift = wave.mul(sway.xy.length()).mul(0.22)
  return positionLocal.add(vec3(sway.x.mul(wave), lift, sway.y.mul(wave))) as unknown as Node<'vec3'>
}

interface SwaySoup {
  positions: number[]
  normals: number[]
  uvs: number[]
  sway: number[]
}

function newSwaySoup(): SwaySoup {
  return { positions: [], normals: [], uvs: [], sway: [] }
}

function swayGeometry(soup: SwaySoup): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(soup.positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(soup.normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(soup.uvs), 2))
  geometry.setAttribute('sway', new BufferAttribute(new Float32Array(soup.sway), 3))
  return geometry
}

/** Push a MeshData into a sway soup, tagging every vertex with one sway vec3. */
function swayWrite(
  soup: SwaySoup,
  md: MeshData,
  dir: Vector3,
  weight: number,
  phase: number,
): void {
  const tri = swayTriangles(md)
  for (let i = 0; i < tri.positions.length; i += 3) {
    soup.positions.push(tri.positions[i], tri.positions[i + 1], tri.positions[i + 2])
    soup.normals.push(tri.normals[i], tri.normals[i + 1], tri.normals[i + 2])
    soup.sway.push(dir.x * weight, dir.z * weight, phase)
  }
  for (let i = 0; i < tri.uvs.length; i++) soup.uvs.push(tri.uvs[i])
}

function swayTriangles(md: MeshData): { positions: number[]; normals: number[]; uvs: number[] } {
  const soup = swayCache.get(md)
  if (soup) return soup
  const built = toSoup(md)
  swayCache.set(md, built)
  return built
}

const swayCache = new WeakMap<MeshData, { positions: number[]; normals: number[]; uvs: number[] }>()

function toSoup(md: MeshData): { positions: number[]; normals: number[]; uvs: number[] } {
  const soups = bakeParts({ one: md })
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  for (const s of soups) {
    for (const v of s.positions) positions.push(v)
    for (const v of s.normals) normals.push(v)
    for (const v of s.uvs) uvs.push(v)
  }
  return { positions, normals, uvs }
}

interface BannerSpec {
  artId: string
  /** hanging frame: the two arm tips and the outward (arm) direction */
  top: Vector3
  bottom: Vector3
  outward: Vector3
  width: number
  phase: number
}

/**
 * Light-pole banner: a cloth sleeved over the top and bottom arms, so it is
 * held along both horizontal edges and billows in the middle. Built as two
 * single-sided layers 7 mm apart with mirrored UVs — a DoubleSide cloth would
 * show the legend backwards from behind.
 */
function writeBanner(soup: SwaySoup, spec: BannerSpec, rect: AtlasRect): void {
  const COLS = 5
  const ROWS = 9
  const normal = new Vector3(-spec.outward.z, 0, spec.outward.x)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const sway: number[] = []

  // The cloth stops 3.5 % short of each arm centreline: it is sleeved over
  // them in the fiction, but a grid that reaches the arm axis threads straight
  // through the 46 mm arm section.
  const HEM = 0.035

  const at = (ci: number, ri: number, layer: number): { p: Vector3; u: number; v: number; w: number } => {
    const u = ci / COLS
    const v = ri / ROWS
    // u = 0 at the pole, 1 at the free tip; a slight standing curl across the
    // cloth so it never reads as a flat card even at rest.
    const across = -spec.width * (1 - u)
    const base = spec.top.clone().lerp(spec.bottom, HEM + v * (1 - 2 * HEM))
    const curl = Math.sin(Math.PI * u) * 0.022
    const p = base
      .clone()
      .addScaledVector(spec.outward, across)
      .addScaledVector(normal, curl + (layer === 0 ? 0.0035 : -0.0035))
    const w = Math.sin(Math.PI * v) * (0.3 + 0.7 * u)
    return { p, u, v, w }
  }

  for (let layer = 0; layer < 2; layer++) {
    const sign = layer === 0 ? 1 : -1
    for (let ci = 0; ci < COLS; ci++) {
      for (let ri = 0; ri < ROWS; ri++) {
        const a = at(ci, ri, layer)
        const b = at(ci + 1, ri, layer)
        const c = at(ci + 1, ri + 1, layer)
        const d = at(ci, ri + 1, layer)
        // CCW seen from +normal is d -> c -> b -> a (right = outward, up = up).
        const quad = layer === 0 ? [d, c, b, d, b, a] : [a, b, c, a, c, d]
        for (const corner of quad) {
          positions.push(corner.p.x, corner.p.y, corner.p.z)
          normals.push(normal.x * sign, 0, normal.z * sign)
          const mu = layer === 0 ? corner.u : 1 - corner.u
          uvs.push(rect.u0 + (rect.u1 - rect.u0) * mu, rect.v1 - (rect.v1 - rect.v0) * corner.v)
          sway.push(normal.x * corner.w, normal.z * corner.w, spec.phase)
        }
      }
    }
  }
  for (const v of positions) soup.positions.push(v)
  for (const v of normals) soup.normals.push(v)
  for (const v of uvs) soup.uvs.push(v)
  for (const v of sway) soup.sway.push(v)
}

/** Catenary sample: cosh-shaped, so the sag reads as a hanging cable. */
function catenary(a: Vector3, b: Vector3, sag: number, t: number): Vector3 {
  const k = 1.75
  const drop = (Math.cosh(k * (2 * t - 1)) - Math.cosh(k)) / (1 - Math.cosh(k))
  return a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - sag * (1 - drop))
}

// --------------------------------------------------------- furniture builders

/**
 * Local authoring frame for everything below: **+X right, +Y forward (the way
 * the object faces), +Z up**, standing on z = 0 — the frame `placeParts()`
 * yaws and translates. Two joint idioms recur and both are deliberate:
 *
 *  - a post's foot lands exactly ON its shoe's cup floor (coplanar OPPOSED,
 *    i.e. the audit's `backToBack` class, which is what a butt joint is);
 *  - anything applied buries into a part of the SAME material slot, so nothing
 *    ever interpenetrates across a slot boundary and the clash pass stays clean.
 */

/** The cast shoe every post here lands in. `bore` clears the post it receives. */
function postShoe(skirt: number, bore: number): MeshData {
  return revolve(
    [
      [0, 0],
      [skirt, 0],
      [skirt + 0.005, 0.009],
      [skirt, 0.02],
      [bore + 0.014, 0.052],
      [bore + 0.008, 0.064],
      [bore, 0.058],
      [bore, 0.04],
      [0, 0.04],
    ],
    16,
    { smooth: SMOOTH.cast },
  )
}

/**
 * Tapered round column. `z0` should sit ~3 mm ABOVE its shoe's cup floor
 * (0.04): flush is forbidden by the craft rules, and a coplanar pair between
 * two material slots is numerically ambiguous for the clash gate's edge test.
 */
function column(z0: number, z1: number, r0: number, r1: number, sides = 14, cx = 0): MeshData {
  const rings: Vec3[][] = [
    [z0, r0],
    [(z0 + z1) / 2, (r0 + r1) / 2],
    [z1, r1],
  ].map(([z, r]) => circle(r, sides, cx, 0, Math.PI / sides).map(([x, y]) => [x, y, z] as Vec3))
  return smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.turned)
}

let WASTE: PartSoup[] | null = null

/**
 * Waste + reclaim point: two bins on one cast plinth. The chute is a real sunk
 * throat (one hollow shell with a rolled rim, cavity floor and all), and the
 * STREAM IS THE LID — a coloured hood butting the body top, which reads at
 * thirty metres and needs no applied band to interpenetrate the carcass.
 */
function wasteParts(): PartSoup[] {
  if (WASTE) return WASTE
  const dark: MeshData[] = []
  const cast: MeshData[] = []
  const landfill: MeshData[] = []
  const reclaim: MeshData[] = []
  const BODY_TOP = 0.855
  const PLINTH_TOP = 0.075

  cast.push(bevel(prism(roundedRect(1.42, 0.58, 0.06, 3), 0, 0.075), BEVEL.carcass, 2))
  for (let i = 0; i < 2; i++) {
    const cx = i === 0 ? -0.335 : 0.335
    const section = (scale: number): Vec2[] =>
      roundedRect(0.46 * scale, 0.42 * scale, 0.055 * scale, 3).map(([x, y]) => [x + cx, y] as Vec2)
    const rings: Vec3[][] = ([
      [PLINTH_TOP + 0.003, 0.97],
      [0.2, 1.0],
      [0.78, 1.02],
      [BODY_TOP, 1.0],
    ] as const).map(([z, s]) => section(s).map(([x, y]) => [x, y, z] as Vec3))
    dark.push(smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.moulded))
    // Coloured hood with a sunk chute throat; its underside butts the body top.
    // Chute throat is an AUTHORED outline, never `insetPoly` of the hood: a
    // rounded rect offset by more than its corner radius folds its arcs back
    // through themselves, and the fold ships as a coplanar cap pair.
    const hood = roundedRect(0.478, 0.438, 0.075, 3).map(([x, y]) => [x + cx, y] as Vec2)
    const throat = roundedRect(0.248, 0.208, 0.05, 3).map(([x, y]) => [x + cx, y] as Vec2)
    ;(i === 0 ? landfill : reclaim).push(
      smoothShade(hollowPrism(hood, BODY_TOP + 0.003, 0.995, throat, 0.9, 0.011), SMOOTH.shell),
    )
    // Service door: a plate 6 mm proud of the front face, buried 20 mm into
    // the carcass — same slot, so it is a joint and not a clash.
    dark.push(
      bevel(
        prism(
          [
            [cx - 0.17, 0.19],
            [cx + 0.17, 0.19],
            [cx + 0.17, 0.222],
            [cx - 0.17, 0.222],
          ],
          0.17,
          0.63,
        ),
        BEVEL.hardware,
        1,
      ),
    )
  }
  WASTE = bakeParts({ dark, steelEdge: cast, orange: landfill, playBlue: reclaim })
  return WASTE
}

let EMERGENCY: PartSoup[] | null = null

/**
 * Emergency station: O₂ + first-aid cabinet on a column, backlit header inside
 * the door reveal, a strapped bottle on the flank. The cabinet stands 3 mm
 * clear of the column (a reveal, per geometry-craft §3) and is carried on two
 * mounting pads that bury into the column.
 */
function emergencyParts(): PartSoup[] {
  if (EMERGENCY) return EMERGENCY
  const orange: MeshData[] = []
  const alloy: MeshData[] = []
  const glow: MeshData[] = []
  const cast: MeshData[] = []
  const BACK = 0.055
  const CAB_Z = 1.3

  cast.push(postShoe(0.115, 0.06))
  alloy.push(column(0.043, 2.34, 0.052, 0.042, 12))

  // Cabinet: one hollow shell, recess opening forward, rolled rim all round.
  const outline = roundedRect(0.66, 0.9, 0.08, 3)
  const shell = hollowPrism(outline, 0, 0.26, roundedRect(0.56, 0.8, 0.05, 3), 0.215, 0.01)
  rotX(shell, -Math.PI / 2)
  translate(shell, [0, BACK, CAB_Z])
  orange.push(smoothShade(shell, SMOOTH.shell))
  // Mounting pads: buried in the column, stopping 3 mm short of the cabinet's
  // back plate. Every plate in this module keeps that 3 mm reveal off its host
  // — flush is forbidden, and a coplanar cross-slot pair reads as a clash.
  for (const z of [CAB_Z - 0.3, CAB_Z + 0.3]) {
    alloy.push(
      prismXZ(roundedRect(0.1, 0.1, 0.01, 2).map(([x, y]) => [x, y + z] as Vec2), 0.01, BACK - 0.003),
    )
  }
  const FLOOR = BACK + 0.215
  // The recess runs z 0.9 … 1.7 and its rolled floor is 0.54 x 0.78; door and
  // header are laid out INSIDE that with 40–50 mm margins, so neither plate
  // can reach the fillet or each other.
  const door = bevel(prism(roundedRect(0.46, 0.55, 0.02, 2), 0, 0.02), BEVEL.panel, 2)
  rotX(door, -Math.PI / 2)
  translate(door, [0, FLOOR + 0.003, 1.225])
  alloy.push(door)
  alloy.push(
    smoothShade(
      tubeAlong(
        [
          [0.19, FLOOR + 0.029, 1.05],
          [0.19, FLOOR + 0.029, 1.3],
        ],
        circle(0.011, 8),
        { up: [0, 1, 0] },
      ),
      SMOOTH.turned,
    ),
  )
  // Backlit header strip above the door, 30 mm clear of it.
  const header = bevel(prism(roundedRect(0.44, 0.14, 0.012, 2), 0, 0.016), BEVEL.hardware, 1)
  rotX(header, -Math.PI / 2)
  translate(header, [0, FLOOR + 0.003, 1.6])
  glow.push(header)
  // Stretcher / spill-kit locker under the cabinet, hung off it in the SAME
  // slot so the bracket is a burial rather than a cross-material clash.
  const box = roundedRect(0.6, 0.34, 0.05, 3)
  const locker = hollowPrism(box, 0, 0.22, roundedRect(0.5, 0.24, 0.03, 3), 0.185, 0.009)
  rotX(locker, -Math.PI / 2)
  translate(locker, [0, BACK, 0.62])
  orange.push(smoothShade(locker, SMOOTH.shell))
  orange.push(
    prismXZ(roundedRect(0.16, 0.34, 0.02, 2).map(([x, y]) => [x, y + 0.82] as Vec2), BACK + 0.02, BACK + 0.1),
  )
  EMERGENCY = bakeParts({ orange, aluminum: alloy, signageGlow: glow, steelEdge: cast })
  return EMERGENCY
}

let FIREPOINT: PartSoup[] | null = null

/** Fire point: hose reel in an open cabinet on two legs, works/farmside kit. */
function firePointParts(): PartSoup[] {
  if (FIREPOINT) return FIREPOINT
  const orange: MeshData[] = []
  const alloy: MeshData[] = []
  const dark: MeshData[] = []
  const cast: MeshData[] = []
  const BACK = 0.09

  cast.push(bevel(prism(roundedRect(1.1, 0.46, 0.05, 3), 0, 0.07), BEVEL.carcass, 2))
  for (const sx of [-1, 1]) orange.push(column(0.073, 1.34, 0.05, 0.042, 10, sx * 0.46))
  // Cabinet: recess opens forward, hose drum sitting inside it.
  const outline = roundedRect(0.9, 0.62, 0.08, 3)
  const shell = hollowPrism(outline, 0, 0.3, roundedRect(0.8, 0.52, 0.05, 3), 0.25, 0.01)
  rotX(shell, -Math.PI / 2)
  translate(shell, [0, BACK, 0.95])
  orange.push(smoothShade(shell, SMOOTH.shell))
  const drum = revolve(
    [
      [0, 0],
      [0.19, 0],
      [0.19, 0.022],
      [0.12, 0.03],
      [0.12, 0.15],
      [0.19, 0.158],
      [0.19, 0.18],
      [0, 0.18],
    ],
    18,
    { smooth: SMOOTH.turned },
  )
  rotX(drum, -Math.PI / 2)
  translate(drum, [0, BACK + 0.253, 0.95])
  dark.push(drum)
  FIREPOINT = bakeParts({ orange, aluminum: alloy, dark, steelEdge: cast })
  return FIREPOINT
}

let FOUNTAIN: PartSoup[] | null = null

/** Drinking fountain: revolved bowl on a cast pedestal, with a foot pedal. */
function fountainParts(): PartSoup[] {
  if (FOUNTAIN) return FOUNTAIN
  const alloy: MeshData[] = []
  const white: MeshData[] = []
  const dark: MeshData[] = []

  white.push(
    revolve(
      [
        [0, 0],
        [0.185, 0],
        [0.191, 0.012],
        [0.185, 0.026],
        [0.128, 0.09],
        [0.112, 0.2],
        [0.108, 0.72],
        [0.126, 0.8],
        [0.126, 0.83],
        [0, 0.83],
      ],
      20,
      { smooth: SMOOTH.turned },
    ),
  )
  // Bowl: rolled rim, dished floor, a drain boss at the centre.
  alloy.push(
    revolve(
      [
        [0, 0.828],
        [0.215, 0.836],
        [0.226, 0.852],
        [0.226, 0.888],
        [0.214, 0.9],
        [0.192, 0.892],
        [0.192, 0.876],
        [0.05, 0.856],
        [0.028, 0.846],
        [0.028, 0.838],
        [0, 0.836],
      ],
      22,
      { smooth: SMOOTH.turned },
    ),
  )
  // Bubbler spout: a small arc over the bowl.
  alloy.push(
    smoothShade(
      tubeAlong(
        [
          [0, 0.17, 0.884],
          [0, 0.115, 0.95],
          [0, 0.04, 0.962],
          [0, 0.008, 0.93],
        ],
        circle(0.011, 8),
        { up: [0, 0, 1] },
      ),
      SMOOTH.turned,
    ),
  )
  // Bottle filler standpipe behind the bowl.
  alloy.push(
    smoothShade(
      tubeAlong(
        [
          [0.145, 0.03, 0.78],
          [0.145, 0.03, 1.16],
          [0.145, -0.075, 1.16],
        ],
        circle(0.016, 10),
        { up: [0, 0, 1] },
      ),
      SMOOTH.turned,
    ),
  )
  // Foot pedal + linkage — the part that says this is plumbed, not decorative.
  dark.push(bevel(prism(roundedRect(0.26, 0.09, 0.015, 2), 0.115, 0.145), BEVEL.hardware, 1))
  dark.push(
    smoothShade(
      tubeAlong(
        [
          [0, -0.02, 0.13],
          [0, -0.115, 0.13],
        ],
        circle(0.014, 8),
        { up: [0, 0, 1] },
      ),
      SMOOTH.turned,
    ),
  )
  // ONE slot: a bowl growing out of its own pedestal cannot be a clash.
  FOUNTAIN = bakeParts({ aluminum: [...white, ...alloy, ...dark] })
  return FOUNTAIN
}

let RACK: PartSoup[] | null = null

/** Bike / scooter rack: five hoops on a common ground rail. Empty — nobody's arrived. */
function rackParts(): PartSoup[] {
  if (RACK) return RACK
  const white: MeshData[] = []
  const cast: MeshData[] = []
  const HOOPS = 5
  const PITCH = 0.78
  const HALF = 0.34
  const H = 0.79
  const span = ((HOOPS - 1) * PITCH) / 2
  // Hoops stand ACROSS the run so a bike parks square to it, and ONE ground
  // rail ties every foot. (Two rails on a planar hoop is two bars in the same
  // volume — the exact coplanar-same-facing defect the gate exists to find.)
  for (let i = 0; i < HOOPS; i++) {
    const x = -span + i * PITCH
    const path: Vec3[] = [[x, -HALF, 0.043]]
    for (let s = 0; s <= 8; s++) {
      const a = Math.PI * (s / 8)
      path.push([x, -Math.cos(a) * HALF, H - HALF + Math.sin(a) * HALF])
    }
    path.push([x, HALF, 0.043])
    white.push(smoothShade(tubeAlong(path, circle(0.026, 10), { up: [1, 0, 0] }), SMOOTH.turned))
    for (const sy of [-1, 1]) {
      const shoe = postShoe(0.062, 0.034)
      translate(shoe, [x, sy * HALF, 0])
      cast.push(shoe)
    }
  }
  white.push(
    smoothShade(
      tubeAlong(
        [
          [-span - 0.16, 0, 0.102],
          [span + 0.16, 0, 0.102],
        ],
        roundedRect(0.05, 0.024, 0.007, 2),
        { up: [0, 0, 1] },
      ),
      SMOOTH.moulded,
    ),
  )
  RACK = bakeParts({ steel: white, steelEdge: cast })
  return RACK
}

let HOSE: PartSoup[] | null = null

/** Hose point along the planter runs: standpipe, valve wheel, coupler. */
function hoseParts(): PartSoup[] {
  if (HOSE) return HOSE
  const white: MeshData[] = []
  const orange: MeshData[] = []
  const cast: MeshData[] = []
  cast.push(postShoe(0.085, 0.039))
  white.push(column(0.043, 0.74, 0.031, 0.031, 12))
  // Bonnet, ending in a flat land the valve head butts.
  white.push(
    revolve(
      [
        [0, 0.72],
        [0.05, 0.725],
        [0.05, 0.79],
        [0.03, 0.8],
        [0.014, 0.805],
        [0, 0.805],
      ],
      12,
      { smooth: SMOOTH.turned },
    ),
  )
  // Valve head — stem, wheel and spokes are ONE slot, so the spokes bury into
  // the stem instead of crossing a material boundary.
  orange.push(
    revolve(
      [
        [0, 0.805],
        [0.013, 0.805],
        [0.013, 0.852],
        [0, 0.852],
      ],
      10,
      { smooth: SMOOTH.turned },
    ),
  )
  const wheel = ringBand(
    0.072,
    0,
    [
      [-0.012, -0.009],
      [0.012, -0.009],
      [0.012, 0.009],
      [-0.012, 0.009],
    ],
    16,
  )
  translate(wheel, [0, 0, 0.842])
  orange.push(smoothShade(wheel, SMOOTH.turned))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const spoke = smoothShade(
      tubeAlong(
        [
          [0, 0, 0.842],
          [Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0.842],
        ],
        circle(0.007, 6),
        { up: [0, 0, 1] },
      ),
      SMOOTH.turned,
    )
    orange.push(spoke)
  }
  // Quick coupler on the front.
  white.push(
    smoothShade(
      tubeAlong(
        [
          [0, 0.02, 0.56],
          [0, 0.115, 0.56],
        ],
        circle(0.022, 10),
        { up: [0, 0, 1] },
      ),
      SMOOTH.turned,
    ),
  )
  HOSE = bakeParts({ steel: white, orange, steelEdge: cast })
  return HOSE
}

let BINOCULAR: PartSoup[] | null = null

/** Rim-walk viewer: a yoked binocular head on a cast column, aimed outward. */
function binocularParts(): PartSoup[] {
  if (BINOCULAR) return BINOCULAR
  const dark: MeshData[] = []
  const alloy: MeshData[] = []
  const cast: MeshData[] = []
  cast.push(postShoe(0.135, 0.093))
  dark.push(column(0.043, 1.14, 0.09, 0.076, 14))
  // Yoke: two cheeks carrying the trunnion.
  for (const sx of [-1, 1]) {
    const cheek = bevel(
      prism(
        roundedRect(0.09, 0.15, 0.014, 3).map(([x, y]) => [x + sx * 0.11, y] as Vec2),
        1.06,
        1.34,
      ),
      BEVEL.panel,
      2,
    )
    dark.push(cheek)
  }
  // Body: a tapered barrel pair, tipped 6° down toward the mountains.
  const body = revolve(
    [
      [0, 0],
      [0.052, 0.004],
      [0.058, 0.03],
      [0.058, 0.3],
      [0.048, 0.34],
      [0.03, 0.36],
      [0.03, 0.4],
      [0, 0.4],
    ],
    14,
    { smooth: SMOOTH.turned },
  )
  rotX(body, Math.PI / 2 + 0.1)
  translate(body, [0, -0.16, 1.3])
  alloy.push(body)
  const shade = ringBand(
    0.05,
    0,
    [
      [-0.008, -0.02],
      [0.008, -0.02],
      [0.008, 0.02],
      [-0.008, 0.02],
    ],
    14,
  )
  rotX(shade, Math.PI / 2 + 0.1)
  translate(shade, [0, 0.2, 1.264])
  alloy.push(shade)
  BINOCULAR = bakeParts({ dark, aluminum: alloy, steelEdge: cast })
  return BINOCULAR
}

// -------------------------------------------------------- monolith + posts

interface MonolithResult {
  soups: PartSoup[]
  /** local (x, forward, up) anchors for the atlas faces */
  namePanel: Vec3
  mapPlate: Vec3
  /** `local` is the +X flank root; mirror x for the other side. */
  fingerRoots: Array<{ local: Vec3; z: number }>
}

let MONOLITH: MonolithResult | null = null

/**
 * District gate monolith. Body is ONE hollow shell: the whole front is a 60 mm
 * recessed field with a rolled rim, and the backlit name panel, the map plate
 * and the finger board collars all sit inside it — no applied trim anywhere
 * near a shared plane.
 */
function monolithParts(): MonolithResult {
  if (MONOLITH) return MONOLITH
  const white: MeshData[] = []
  const glow: MeshData[] = []
  const dark: MeshData[] = []
  const H = 2.85
  const W = 1.32
  const FOOT = 0.1
  const DEPTH = 0.34

  // Elevation drawn lying on its back with y running DOWN the monolith, so
  // rotX(−90°) (which maps y -> −z) stands it up the right way and leaves the
  // recess opening forward at +y. Getting this pair of signs right is the
  // whole trick to authoring a vertical panel in a Z-up profile system.
  const elevation: Vec2[] = roundedRect(W, H, 0.14, 3).map(([x, y]) => [x, y - H / 2] as Vec2)
  const shell = hollowPrism(elevation, 0, DEPTH, roundedRect(W - 0.17, H - 0.17, 0.055, 3).map(([x, y]) => [x, y - H / 2] as Vec2), 0.275, 0.014)
  rotX(shell, -Math.PI / 2)
  translate(shell, [0, -DEPTH / 2, FOOT])
  white.push(smoothShade(shell, SMOOTH.shell))
  // Recess floor, forward of the body centre; the rim is at DEPTH/2.
  const FIELD = DEPTH / 2 - 0.065

  // Cast base shoe: the monolith foot buries 100 mm into it.
  white.push(bevel(prism(roundedRect(1.54, 0.56, 0.05, 3), 0, 0.13), BEVEL.carcass, 2))

  // Backlit name panel in the top third of the field: 20 mm off the field
  // floor, so it sits 45 mm behind the rim — a real recess, real bezel.
  const panel = bevel(prism(roundedRect(1.05, 0.5, 0.03, 2), 0, 0.016), BEVEL.hardware, 1)
  rotX(panel, -Math.PI / 2)
  translate(panel, [0, FIELD + 0.003, 2.16])
  glow.push(panel)

  // Map plate below it, matte, in the same field.
  const map = bevel(prism(roundedRect(1.02, 0.74, 0.026, 2), 0, 0.014), BEVEL.hardware, 1)
  rotX(map, -Math.PI / 2)
  translate(map, [0, FIELD + 0.003, 1.44])
  dark.push(map)

  // Finger boards ride a MAST rising out of the body, not the flanks: a board
  // bolted to the side puts its legend plane within a millimetre of the
  // monolith's own face, which is a z-fight by construction. On the mast every
  // bearing is legal and the roots simply bury into the column.
  const mast = column(2.55, 3.78, 0.05, 0.04, 12)
  translate(mast, [0, -0.06, 0])
  white.push(mast)
  const finial = revolve(
    [
      [0, 0],
      [0.05, 0.005],
      [0.05, 0.028],
      [0.034, 0.058],
      [0.044, 0.074],
      [0.028, 0.104],
      [0, 0.116],
    ],
    12,
    { smooth: SMOOTH.turned },
  )
  translate(finial, [0, -0.06, 3.76])
  white.push(finial)
  const fingerRoots: Array<{ local: Vec3; z: number }> = [3.62, 3.36, 3.1].map((z) => ({
    local: [0, -0.06, z] as Vec3,
    z,
  }))

  MONOLITH = {
    soups: bakeParts({ steel: white, signageGlow: glow, dark }),
    namePanel: [0, FIELD + 0.019, 2.16],
    mapPlate: [0, FIELD + 0.017, 1.44],
    fingerRoots,
  }
  return MONOLITH
}

let FINGERBOARD: PartSoup[] | null = null

/**
 * One directional board: a tapered plate with a pointed tip, authored in the
 * (forward, up) plane and extruded across X, so a placement's yaw IS the
 * bearing to the destination and the legend reads off the broad ±X faces.
 */
function fingerboardParts(): PartSoup[] {
  if (FINGERBOARD) return FINGERBOARD
  const L = 0.72
  const outline: Vec2[] = [
    [0.0, -0.075],
    [L - 0.14, -0.075],
    [L, 0],
    [L - 0.14, 0.075],
    [0.0, 0.075],
  ]
  // Same slot as the posts and the monolith flanks it mounts on, so the root
  // can bury into its host instead of butting a different material.
  const plate = smoothShade(prismYZ(outline, -0.014, 0.014), SMOOTH.moulded)
  FINGERBOARD = bakeParts({ steel: plate })
  return FINGERBOARD
}

let FINGERPOST: PartSoup[] | null = null

/** Junction fingerpost: tapered column in a cast shoe, turned finial. */
function fingerpostParts(): PartSoup[] {
  if (FINGERPOST) return FINGERPOST
  const white: MeshData[] = []
  const cast: MeshData[] = []
  cast.push(postShoe(0.125, 0.066))
  white.push(column(0.043, 2.62, 0.058, 0.042, 14))
  white.push(
    translate(
      revolve(
        [
          [0, 0],
          [0.052, 0.004],
          [0.052, 0.03],
          [0.036, 0.062],
          [0.046, 0.078],
          [0.03, 0.11],
          [0, 0.122],
        ],
        14,
        { smooth: SMOOTH.turned },
      ),
      [0, 0, 2.6],
    ),
  )
  FINGERPOST = bakeParts({ steel: white, steelEdge: cast })
  return FINGERPOST
}

let PLAQUE: PartSoup[] | null = null

/**
 * Dedication plaque: cast plinth with a canted top face. The cant runs up and
 * BACK from the front edge, so its normal leans toward the reader — the plate
 * and its atlas legend both ride that exact angle (`PLAQUE_PITCH`).
 */
const PLAQUE_CANT = 0.552
export const PLAQUE_PITCH = Math.PI / 2 - PLAQUE_CANT

function plaqueParts(): PartSoup[] {
  if (PLAQUE) return PLAQUE
  const cast: MeshData[] = []
  const dark: MeshData[] = []
  // Side elevation in (forward, up); +y is the reading side.
  const side: Vec2[] = [
    [0.15, 0],
    [-0.15, 0],
    [-0.13, 0.78],
    [0.13, 0.62],
  ]
  cast.push(smoothShade(prismYZ(side, -0.31, 0.31), SMOOTH.cast))
  // Plate seated 2 mm proud of the cant, on the cant's own normal.
  const n: Vec2 = [Math.sin(PLAQUE_CANT), Math.cos(PLAQUE_CANT)]
  const plate = bevel(prism(roundedRect(0.5, 0.24, 0.014, 2), 0, 0.014), BEVEL.hardware, 1)
  rotX(plate, -PLAQUE_CANT)
  translate(plate, [0, n[0] * 0.002, 0.7 + n[1] * 0.002])
  dark.push(plate)
  PLAQUE = bakeParts({ cast, dark })
  return PLAQUE
}

let NOTICE: PartSoup[] | null = null

/** Schedule / notice board: twin posts, recessed board, lit header strip. */
function noticeParts(): PartSoup[] {
  if (NOTICE) return NOTICE
  const white: MeshData[] = []
  const dark: MeshData[] = []
  const glow: MeshData[] = []
  const cast: MeshData[] = []
  const BACK = 0.05
  for (const sx of [-1, 1]) {
    const shoe = postShoe(0.095, 0.056)
    translate(shoe, [sx * 0.86, 0, 0])
    cast.push(shoe)
    white.push(column(0.043, 2.08, 0.048, 0.042, 12, sx * 0.86))
    // Mounting pads bridging the 8 mm reveal between post and board.
    for (const z of [1.05, 1.85]) {
      white.push(
        prismXZ(roundedRect(0.1, 0.1, 0.012, 2).map(([x, y]) => [x + sx * 0.86, y + z] as Vec2), 0.0, BACK),
      )
    }
  }
  // Board: a hollow shell whose recess opens forward with a rolled rim.
  const outline = roundedRect(1.98, 1.14, 0.09, 3)
  const shell = hollowPrism(outline, 0, 0.11, roundedRect(1.86, 1.02, 0.035, 3), 0.075, 0.009)
  rotX(shell, -Math.PI / 2)
  translate(shell, [0, BACK, 1.45])
  white.push(smoothShade(shell, SMOOTH.shell))
  const FIELD = BACK + 0.075
  const backing = bevel(prism(roundedRect(1.78, 0.93, 0.02, 2), 0, 0.012), BEVEL.hardware, 1)
  rotX(backing, -Math.PI / 2)
  translate(backing, [0, FIELD + 0.003, 1.42])
  dark.push(backing)
  // Lit header strip along the board's top edge, inside the recess.
  const strip = bevel(prism(roundedRect(1.78, 0.05, 0.012, 2), 0, 0.014), BEVEL.hardware, 1)
  rotX(strip, -Math.PI / 2)
  translate(strip, [0, FIELD + 0.003, 1.912])
  glow.push(strip)
  NOTICE = bakeParts({ steel: white, dark, signageGlow: glow, steelEdge: cast })
  return NOTICE
}

/**
 * The park model table on the plaza — a 1:210 scale model of Elysium Commons
 * under its own little glass dome, generated from `parkPlan` so it can never
 * disagree with the park it stands in. A tiny love letter, and the one object
 * in the park a guest can hold in their eye all at once.
 */
function parkModelParts(): PartSoup[] {
  const SCALE = 1 / 210
  const cast: MeshData[] = []
  const alloy: MeshData[] = []
  const glass: MeshData[] = []
  const soil: MeshData[] = []
  const TOP = 0.86

  cast.push(
    revolve(
      [
        [0, 0],
        [0.58, 0],
        [0.6, 0.016],
        [0.56, 0.05],
        [0.42, 0.14],
        [0.4, 0.72],
        [0.46, 0.78],
        [0.48, 0.8],
        [0, 0.8],
      ],
      26,
      { smooth: SMOOTH.turned },
    ),
  )
  // Table top: a rolled-edge disc, the model's ground plane.
  cast.push(
    revolve(
      [
        [0, 0.8],
        [0.9, 0.806],
        [0.94, 0.822],
        [0.94, TOP - 0.012],
        [0.925, TOP],
        [0, TOP],
      ],
      30,
      { smooth: SMOOTH.turned },
    ),
  )

  // The model: paved plaza disc, the boulevard ring, the buildings, the tree.
  const disc = revolve(
    [
      [0, 0],
      [FIRST_TREE.plazaRadius * SCALE, 0],
      [FIRST_TREE.plazaRadius * SCALE, 0.004],
      [0, 0.004],
    ],
    24,
    { smooth: SMOOTH.turned },
  )
  translate(disc, [0, 0, TOP + 0.003])
  alloy.push(disc)
  const ring = ringBand(
    ((BOULEVARD.innerRadius + BOULEVARD.outerRadius) / 2) * SCALE,
    TOP + 0.005,
    [
      [-((BOULEVARD.outerRadius - BOULEVARD.innerRadius) / 2) * SCALE, -0.002],
      [((BOULEVARD.outerRadius - BOULEVARD.innerRadius) / 2) * SCALE, -0.002],
      [((BOULEVARD.outerRadius - BOULEVARD.innerRadius) / 2) * SCALE, 0.002],
      [-((BOULEVARD.outerRadius - BOULEVARD.innerRadius) / 2) * SCALE, 0.002],
    ],
    40,
  )
  alloy.push(smoothShade(ring, SMOOTH.moulded))
  const model: Array<[number, number, number, number]> = [
    [COMMONS.x, COMMONS.z, COMMONS.radius, 12],
    [HYDRO_TOWER.x, HYDRO_TOWER.z, HYDRO_TOWER.radius, 17],
    [WATER_TOWER.x, WATER_TOWER.z, 3, 17],
    [OVERLOOK_LOUNGE.x, OVERLOOK_LOUNGE.z, 8, 5],
    [WORKS.machineHall.x, WORKS.machineHall.z, 10, 9],
    [PORTAL_STATION.x, PORTAL_STATION.z, 9, 5],
  ]
  for (const [mx, mz, r, h] of model) {
    const tower = revolve(
      [
        [0, 0],
        [r * SCALE, 0],
        [r * SCALE, h * SCALE],
        [r * SCALE * 0.82, h * SCALE + 0.003],
        [0, h * SCALE + 0.003],
      ],
      12,
      { smooth: SMOOTH.turned },
    )
    translate(tower, [mx * SCALE, mz * SCALE, TOP + 0.008])
    alloy.push(tower)
  }
  for (const hab of habSites()) {
    const pod = revolve(
      [
        [0, 0],
        [5 * SCALE, 0],
        [5 * SCALE, 3 * SCALE],
        [2 * SCALE, 5 * SCALE],
        [0, 5.2 * SCALE],
      ],
      10,
      { smooth: SMOOTH.turned },
    )
    translate(pod, [hab.x * SCALE, hab.z * SCALE, TOP + 0.008])
    alloy.push(pod)
  }
  // The First Tree, 12 m tall at 1:210 — 57 mm of ginkgo.
  const tree = revolve(
    [
      [0, 0],
      [0.9 * SCALE, 0],
      [0.7 * SCALE, 6 * SCALE],
      [4.5 * SCALE, 8 * SCALE],
      [2.2 * SCALE, 12 * SCALE],
      [0, 12.4 * SCALE],
    ],
    12,
    { smooth: SMOOTH.turned },
  )
  translate(tree, [0, 0, TOP + 0.01])
  soil.push(tree)

  // The model dome: a 6 mm glass shell over the whole thing.
  const domeR = 130 * SCALE
  const crown = 64 * SCALE
  const profile: Vec2[] = []
  const steps = 16
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    profile.push([domeR * Math.cos((t * Math.PI) / 2), crown * Math.sin((t * Math.PI) / 2)])
  }
  const inner = profile.map(([r, z]) => [Math.max(0, r - 0.006), Math.max(0, z - 0.006)] as Vec2)
  const shellProfile = [...profile, ...inner.slice().reverse()]
  const dome = revolve(shellProfile, 34, { smooth: SMOOTH.shell, capStart: false, capEnd: false })
  translate(dome, [0, 0, TOP + 0.004])
  glass.push(dome)

  // The model dome reads as GLASS, not as a black cap: `darkGlass` is a dark
  // mirror and hides the little city that is the whole point of the object.
  return bakeParts({ cast, aluminum: alloy, cabinGlass: glass, soil })
}

/** Festoon mast: a slender pole with a cast shoe and a hanging eye. */
let FESTOON_MAST: PartSoup[] | null = null

function festoonMastParts(height: number): PartSoup[] {
  if (FESTOON_MAST) return FESTOON_MAST
  const white: MeshData[] = []
  const cast: MeshData[] = []
  cast.push(postShoe(0.135, 0.074))
  white.push(column(0.043, height, 0.066, 0.044, 14))
  // Hanging eye at the head: a ring in the vertical plane, root buried.
  const eye = ringBand(
    0.05,
    0,
    [
      [-0.011, -0.011],
      [0.011, -0.011],
      [0.011, 0.011],
      [-0.011, 0.011],
    ],
    12,
  )
  rotX(eye, Math.PI / 2)
  translate(eye, [0, 0, height - 0.05])
  white.push(smoothShade(eye, SMOOTH.turned))
  FESTOON_MAST = bakeParts({ steel: white, steelEdge: cast })
  return FESTOON_MAST
}

/** One festoon bulb: a turned envelope on a short flex, hung from the wire. */
function festoonBulb(): MeshData {
  return revolve(
    [
      [0, 0],
      [0.0075, 0.002],
      [0.0075, 0.03],
      [0.017, 0.042],
      [0.019, 0.062],
      [0.014, 0.082],
      [0, 0.088],
    ],
    10,
    { smooth: SMOOTH.turned },
  )
}

// ------------------------------------------------------------------ dressing

interface Dressing {
  services: DistrictServices
  writer: PartWriter
  site: Site
  arts: Map<string, SignArt>
  faces: SignFace[]
  banners: BannerSpec[]
  lensCount: Map<string, number>
  lensAnchor: Map<string, Vector3>
}

function art(d: Dressing, spec: SignArt): SignArt {
  if (!d.arts.has(spec.id)) d.arts.set(spec.id, spec)
  return d.arts.get(spec.id)!
}

function addFace(d: Dressing, face: SignFace): void {
  d.faces.push(face)
}

function noteGlow(d: Dressing, family: string, count: number, at: Vector3): void {
  d.lensCount.set(family, (d.lensCount.get(family) ?? 0) + count)
  if (!d.lensAnchor.has(family)) d.lensAnchor.set(family, at.clone())
}

/** Standard lamp placement: geometry, glow pool bookkeeping, collider. */
function placeLamp(
  d: Dressing,
  spot: Vector3,
  options: { height: number; heads: 1 | 2; yaw: number; banner?: string },
): void {
  const result = lampPost(d.writer, spot, {
    height: options.height,
    heads: options.heads,
    yaw: options.yaw,
    banner: !!options.banner,
  })
  noteGlow(d, 'lamp-heads', result.lenses.length, result.lenses[0] ?? spot)
  d.services.colliders.push({
    kind: 'cylinder',
    center: spot.clone().setY(spot.y + options.height / 2),
    halfHeight: options.height / 2,
    radius: 0.1,
  })
  if (options.banner && result.banner) {
    d.banners.push({
      artId: options.banner,
      top: result.banner.top,
      bottom: result.banner.bottom,
      outward: result.banner.outward,
      width: result.banner.width,
      phase: (spot.x * 0.37 + spot.z * 0.61) % 6.283,
    })
  }
}

const BANNER_ARTS: Array<{ id: string; lines: string[] }> = [
  { id: 'banner-commons', lines: ['ELYSIUM', 'THE', 'COMMONS'] },
  { id: 'banner-farm', lines: ['ELYSIUM', 'FARM', 'SIDE'] },
  { id: 'banner-works', lines: ['ELYSIUM', 'THE', 'WORKS'] },
  { id: 'banner-loop', lines: ['ELYSIUM', 'THE', 'LOOP'] },
  { id: 'banner-first', lines: ['ELYSIUM', 'FIRST', 'TREE'] },
]

/**
 * The boulevard ring: banner-carrying twin-head columns on the outer strip
 * (the only band clear of both the planters and the guideway), waste points,
 * an emergency station and stencil markers at the three stops.
 */
function dressBoulevard(d: Dressing): void {
  for (const spec of BANNER_ARTS) {
    art(d, { id: spec.id, style: 'banner', lines: spec.lines, aspect: 0.52 })
  }
  const radius = 101.5
  const count = 26
  let index = 0
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.12
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (!d.site.claim('boulevard-lamp', x, z, 1.1)) continue
    const spot = new Vector3(x, interiorHeight(x, z), z)
    // Arms face INWARD across the street, so banners read from the park side.
    const yaw = Math.atan2(-x, -z)
    placeLamp(d, spot, {
      height: 4.7,
      heads: 2,
      yaw,
      banner: BANNER_ARTS[index % BANNER_ARTS.length].id,
    })
    index++
  }

  // Waste + reclaim points and one emergency station per station approach.
  const waste = wasteParts()
  const emergency = emergencyParts()
  for (const station of LOOP.stations) {
    for (const side of [-1, 1]) {
      const angle = station.angle + side * 0.075
      const x = Math.cos(angle) * 101.2
      const z = Math.sin(angle) * 101.2
      if (!d.site.claim('boulevard-waste', x, z, 0.95)) continue
      const spot = new Vector3(x, interiorHeight(x, z), z)
      const yaw = Math.atan2(-x, -z)
      placeParts(d.writer, waste, spot, yaw)
      addWasteLabels(d, spot, yaw)
      d.services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 0.52),
        size: new Vector3(1.5, 1.04, 0.62),
        yaw,
      })
    }
    const angle = station.angle + 0.14
    const ex = Math.cos(angle) * 100.9
    const ez = Math.sin(angle) * 100.9
    if (d.site.claim('emergency', ex, ez, 0.85)) {
      const spot = new Vector3(ex, interiorHeight(ex, ez), ez)
      const yaw = Math.atan2(-ex, -ez)
      placeParts(d.writer, emergency, spot, yaw)
      addEmergencyLabels(d, spot, yaw)
      noteGlow(d, 'emergency-header', 1, spot)
      d.services.colliders.push({
        kind: 'cylinder',
        center: spot.clone().setY(spot.y + 1.2),
        halfHeight: 1.2,
        radius: 0.24,
      })
    }
  }

  // Stencil markers on the boulevard at each stop: the service lane call-out.
  for (const station of LOOP.stations) {
    const angle = station.angle - 0.2
    const x = Math.cos(angle) * 101.6
    const z = Math.sin(angle) * 101.6
    if (!d.site.claim('stencil', x, z, 1.0)) continue
    groundStencil(d, x, z, Math.atan2(x, z), 'SERVICE LANE · KEEP CLEAR', 2.1)
  }
}

function addWasteLabels(d: Dressing, spot: Vector3, yaw: number): void {
  art(d, { id: 'waste-organics', style: 'sub', lines: ['ORGANICS', 'TO HYDROPONICS'], aspect: 2.4 })
  art(d, { id: 'waste-reclaim', style: 'sub', lines: ['RECLAIM', 'METAL · POLYMER'], aspect: 2.4 })
  const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  const pairs: Array<[string, number]> = [
    ['waste-organics', -0.335],
    ['waste-reclaim', 0.335],
  ]
  for (const [id, offset] of pairs) {
    addFace(d, {
      art: d.arts.get(id)!,
      // 6 mm proud of the service door, which is itself 6 mm proud of the body.
      center: spot
        .clone()
        .addScaledVector(right, offset)
        .addScaledVector(forward, 0.228)
        .setY(spot.y + 0.5),
      yaw,
      pitch: 0,
      width: 0.34,
      height: 0.142,
      lit: false,
    })
  }
}

function addEmergencyLabels(d: Dressing, spot: Vector3, yaw: number): void {
  art(d, { id: 'emergency-header', style: 'name', lines: ['EMERGENCY'], aspect: 3.3 })
  art(d, {
    id: 'emergency-door',
    style: 'plate',
    lines: ['O₂ · FIRST AID', 'BREAK GLASS · ALERT OPS'],
    aspect: 2.1,
  })
  // Recess floor is 0.27 forward of the column axis; legends sit 6 mm proud
  // of the header strip (0.016) and the door panel (0.02).
  const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  addFace(d, {
    art: d.arts.get('emergency-header')!,
    center: spot.clone().addScaledVector(forward, 0.295).setY(spot.y + 1.6),
    yaw,
    pitch: 0,
    width: 0.4,
    height: 0.121,
    lit: true,
  })
  addFace(d, {
    art: d.arts.get('emergency-door')!,
    // 0.34 wide so the legend stops short of the door handle at x = 0.19.
    center: spot.clone().addScaledVector(forward, 0.299).setY(spot.y + 1.225),
    yaw,
    pitch: 0,
    width: 0.34,
    height: 0.162,
    lit: false,
  })
}

/** A stencil marker: a plate bedded in the paving, legend lying face up. */
function groundStencil(d: Dressing, x: number, z: number, readYaw: number, text: string, width: number): void {
  if (pavedSignedDistance(x, z) > -0.6) return
  const id = `stencil-${text.replace(/[^A-Z]/g, '').slice(0, 12)}`
  art(d, { id, style: 'stencil', lines: [text], aspect: width / 0.34 })
  const y = interiorHeight(x, z)
  d.writer.box({
    center: new Vector3(x, y - 0.037, z),
    size: new Vector3(width + 0.1, 0.09, 0.44),
    rotationY: readYaw,
    slot: 'dark',
    chamfer: 0.014,
  })
  addFace(d, {
    art: d.arts.get(id)!,
    // The plate faces up; `up` becomes −n0, so yaw points BACK at the reader.
    center: new Vector3(x, y + 0.014, z),
    yaw: readYaw + Math.PI,
    pitch: Math.PI / 2,
    width,
    height: 0.34,
    lit: false,
  })
}

/**
 * Where a paved spoke actually meets the plaza. Sampled from
 * `pavedSignedDistance` just outside the plaza disc: a run of paved bearings
 * out there IS a spoke mouth, and the planter ring leaves exactly those open.
 */
function plazaEntryAngles(): number[] {
  const probe = FIRST_TREE.plazaRadius + 1.6
  const hits: boolean[] = []
  const steps = 360
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    hits.push(pavedSignedDistance(Math.cos(a) * probe, Math.sin(a) * probe) < -0.2)
  }
  const out: number[] = []
  let start = -1
  for (let i = 0; i < steps; i++) {
    const here = hits[i]
    const previous = hits[(i - 1 + steps) % steps]
    if (here && !previous) start = i
    if (!here && previous && start >= 0) {
      const span = (i - start + steps) % steps
      if (span >= 3) out.push((((start + span / 2) % steps) / steps) * Math.PI * 2)
      start = -1
    }
  }
  return out
}

/** The plaza: entry bollards, bins, a fountain, and the park model table. */
function dressPlaza(d: Dressing): void {
  const y = (x: number, z: number): number => interiorHeight(x, z)
  // Bollard pairs where the spokes enter the plaza — the classic civic move,
  // and honest: this floor takes service vehicles. The entries are READ off
  // the paved field rather than guessed: parkPlan authors spokes that stop
  // short of the plaza and paving runs them in, so only the field knows where
  // the openings in the planter ring actually are.
  for (const angle of plazaEntryAngles()) {
    for (let i = -1; i <= 1; i += 2) {
      for (let k = 0; k < 2; k++) {
        const r = FIRST_TREE.plazaRadius - 3.5 - k * 3.2
        const a = angle + (i * 2.35) / r
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (!d.site.claim('bollard', x, z, 0.32)) continue
        bollard(d.writer, new Vector3(x, y(x, z), z), { removable: k === 1 })
        d.services.colliders.push({
          kind: 'cylinder',
          center: new Vector3(x, y(x, z) + 0.5, z),
          halfHeight: 0.5,
          radius: 0.12,
        })
      }
    }
  }

  // Waste pairs and a drinking fountain on the plaza ring.
  const waste = wasteParts()
  for (const angle of [0.78, 2.36, -1.9]) {
    const r = 15.5
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    if (!d.site.claim('plaza-waste', x, z, 0.95)) continue
    const spot = new Vector3(x, y(x, z), z)
    const yaw = Math.atan2(-x, -z)
    placeParts(d.writer, waste, spot, yaw)
    addWasteLabels(d, spot, yaw)
    d.services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.52),
      size: new Vector3(1.5, 1.04, 0.62),
      yaw,
    })
  }

  // The park model table takes its ground FIRST — it is the one object on this
  // plaza whose position is authored rather than opportunistic.
  const mx = 11.2
  const mz = -9.4
  const modelPlaced = d.site.claim('park-model', mx, mz, 1.15)
  if (modelPlaced) {
    const spot = new Vector3(mx, y(mx, mz), mz)
    placeParts(d.writer, parkModelParts(), spot, 0.4)
    art(d, {
      id: 'model-plaque',
      style: 'plate',
      lines: ['ELYSIUM COMMONS · 1:210', 'DESIGN CAPACITY 10 000'],
      aspect: 3.0,
    })
    const yaw = 0.4 + Math.PI
    addFace(d, {
      art: d.arts.get('model-plaque')!,
      center: spot
        .clone()
        // On the plinth's straight section: 0.66 up is inside its top flare.
        .add(new Vector3(Math.sin(yaw) * 0.425, 0.5, Math.cos(yaw) * 0.425)),
      yaw,
      pitch: 0,
      width: 0.54,
      height: 0.18,
      lit: false,
    })
    d.services.colliders.push({
      kind: 'cylinder',
      center: spot.clone().setY(spot.y + 0.55),
      halfHeight: 0.55,
      radius: 0.62,
    })
  }

  const fountain = fountainParts()
  for (const angle of [-1.1, 2.7]) {
    const spot = d.site.nudge(
      'fountain',
      Math.cos(angle) * 13.4,
      Math.sin(angle) * 13.4,
      0.55,
      Math.cos(angle),
      Math.sin(angle),
      5,
      1.1,
    )
    if (!spot) continue
    placeParts(d.writer, fountain, spot, Math.atan2(-spot.x, -spot.z))
    d.services.colliders.push({
      kind: 'cylinder',
      center: spot.clone().setY(spot.y + 0.5),
      halfHeight: 0.5,
      radius: 0.22,
    })
  }

  // Two low columns lighting the plaza rim gaps.
  for (const angle of [1.24, -2.5]) {
    const r = 18.4
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    if (!d.site.claim('plaza-lamp', x, z, 0.9)) continue
    placeLamp(d, new Vector3(x, y(x, z), z), {
      height: 4.0,
      heads: 2,
      yaw: Math.atan2(-x, -z),
    })
  }
}

/**
 * The rim walk: something every ~15 m for 700 m of promenade — the density
 * target that turns a corridor into a place. Benches and viewers look OUT at
 * the mountains; lamps and plaques hug the inner curb.
 */
function dressRimWalk(d: Dressing): void {
  const radius = PARK.rimWalkRadius
  const inner = radius - 2.45
  const outer = radius + 2.45
  const spacing = 15.4
  const count = Math.round((Math.PI * 2 * radius) / spacing)
  const binocular = binocularParts()
  const plaque = plaqueParts()
  const pattern: Array<'lamp' | 'bench' | 'viewer' | 'plaque'> = [
    'lamp',
    'bench',
    'lamp',
    'viewer',
    'lamp',
    'plaque',
  ]
  art(d, {
    id: 'rim-plaque',
    style: 'plate',
    lines: ['RIM WALK · ELEVATION −2 540 m', 'ELYSIUM PLANITIA, MARS'],
    aspect: 2.6,
  })
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const kind = pattern[i % pattern.length]
    const useOuter = kind === 'bench' || kind === 'viewer'
    const r = useOuter ? outer : inner
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const spot = new Vector3(x, interiorHeight(x, z), z)
    if (kind === 'lamp') {
      if (!d.site.claim('rim-lamp', x, z, 0.85)) continue
      placeLamp(d, spot, { height: 3.9, heads: 1, yaw: Math.atan2(outward.x, outward.z) })
    } else if (kind === 'bench') {
      if (!d.site.claim('rim-bench', x, z, 1.0)) continue
      // Backrest toward the park, seat facing the glass and the mountains.
      const yaw = Math.atan2(-outward.x, -outward.z)
      const seat = bench(d.writer, spot, yaw)
      d.services.seats.push({ ...seat, label: 'Sit and look out' })
      d.services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 0.32),
        size: new Vector3(1.9, 0.64, 0.62),
        yaw,
      })
    } else if (kind === 'viewer') {
      if (!d.site.claim('rim-viewer', x, z, 0.55)) continue
      placeParts(d.writer, binocular, spot, Math.atan2(outward.x, outward.z))
      d.services.colliders.push({
        kind: 'cylinder',
        center: spot.clone().setY(spot.y + 0.6),
        halfHeight: 0.6,
        radius: 0.16,
      })
    } else {
      if (!d.site.claim('rim-plaque', x, z, 0.5)) continue
      // Plaques read from the park side, facing back in toward the walk.
      const yaw = Math.atan2(-outward.x, -outward.z)
      placeParts(d.writer, plaque, spot, yaw)
      const n = new Vector3(
        Math.sin(yaw) * Math.sin(PLAQUE_CANT),
        Math.cos(PLAQUE_CANT),
        Math.cos(yaw) * Math.sin(PLAQUE_CANT),
      )
      addFace(d, {
        art: d.arts.get('rim-plaque')!,
        center: spot.clone().setY(spot.y + 0.7).addScaledVector(n, 0.019),
        yaw,
        pitch: PLAQUE_PITCH,
        width: 0.5,
        height: 0.19,
        lit: false,
      })
    }
  }
}

/**
 * The per-path amenity march. Replaces the old uniform 34/27/61 m sprinkle
 * with a verge sampler: everything sits just off the curb on alternating
 * sides, seeded per family so adding one never reshuffles the others.
 */
function dressPathNetwork(d: Dressing, rng: Rng): void {
  const waste = wasteParts()
  for (const path of PATHS) {
    if (path.id === 'rim-promenade') continue
    const control = path.points.map((p) => new Vector3(p.x, 0, p.y))
    const closed = path.points[0].distanceTo(path.points[path.points.length - 1]) < 0.01
    if (closed) control.pop()
    const curve = new CatmullRomCurve3(control, closed, 'centripetal', 0.5)
    const length = curve.getLength()

    const march = (
      family: string,
      every: number,
      offset: number,
      lateral: number,
      place: (spot: Vector3, side: Vector3, flip: number, index: number) => void,
    ): void => {
      const count = Math.max(1, Math.floor(length / every))
      for (let i = 0; i < count; i++) {
        const t = ((i + offset) / count) % 1
        const point = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t)
        const side = new Vector3(-tangent.z, 0, tangent.x)
        const flip = i % 2 === 0 ? 1 : -1
        // Squared lateral falloff: furniture leans hard against the curb.
        const push = path.width / 2 + lateral + rng.float() ** 2 * 0.5
        const x = point.x + side.x * push * flip
        const z = point.z + side.z * push * flip
        if (!d.site.claim(family, x, z, lateral < 1 ? 0.85 : 1.0)) continue
        place(new Vector3(x, interiorHeight(x, z), z), side, flip, i)
      }
    }

    march('path-bench', 30, 0.18, 1.25, (spot, side, flip) => {
      const yaw = Math.atan2(-side.x * flip, -side.z * flip)
      const seat = bench(d.writer, spot, yaw)
      d.services.seats.push({ ...seat, label: 'Sit' })
      d.services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 0.32),
        size: new Vector3(1.9, 0.64, 0.62),
        yaw,
      })
    })

    march('path-lamp', 22, 0.55, 0.86, (spot, side, flip) => {
      placeLamp(d, spot, {
        height: 3.6,
        heads: 1,
        yaw: Math.atan2(side.x * flip, side.z * flip) + Math.PI,
      })
    })

    march('path-waste', 62, 0.33, 0.95, (spot, side, flip) => {
      const yaw = Math.atan2(-side.x * flip, -side.z * flip)
      placeParts(d.writer, waste, spot, yaw)
      addWasteLabels(d, spot, yaw)
      d.services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 0.52),
        size: new Vector3(1.5, 1.04, 0.62),
        yaw,
      })
    })
  }
}

interface GateSpec {
  id: string
  title: string
  subtitle: string
  x: number
  z: number
  /** the point the arriving guest comes FROM — the facing authority */
  approachX: number
  approachZ: number
  fingers: Array<{ label: string; targetX: number; targetZ: number }>
}

const GATES: GateSpec[] = [
  {
    id: 'commons',
    title: 'THE COMMONS',
    subtitle: 'ASSEMBLY · GALLEY · CLINIC',
    x: -4.9,
    z: -36.4,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'FIRST TREE', targetX: 0, targetZ: 0 },
      { label: 'HYDROPONICS', targetX: HYDRO_TOWER.x, targetZ: HYDRO_TOWER.z },
      { label: 'GARDENS', targetX: GARDENS[0].x, targetZ: GARDENS[0].z },
    ],
  },
  {
    id: 'hydro',
    title: 'HYDROPONICS',
    subtitle: 'TOWER 62 · ESCORT REQUIRED',
    x: 44.5,
    z: 8.4,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'FARMSIDE', targetX: 74, targetZ: 6 },
      { label: 'FIRST TREE', targetX: 0, targetZ: 0 },
      { label: 'THE WORKS', targetX: WORKS.machineHall.x, targetZ: WORKS.machineHall.z },
    ],
  },
  {
    id: 'farmside',
    title: 'FARMSIDE',
    subtitle: 'GLASSHOUSE ROW A–C',
    x: 58.5,
    z: -18.6,
    approachX: 40,
    approachZ: 6,
    fingers: [
      { label: 'THE WORKS', targetX: WORKS.machineHall.x, targetZ: WORKS.machineHall.z },
      { label: 'THE LOOP', targetX: Math.cos(0.05) * 92, targetZ: Math.sin(0.05) * 92 },
    ],
  },
  {
    id: 'works',
    title: 'THE WORKS',
    subtitle: 'CREW ONLY · PPE BEYOND THIS POINT',
    x: 15.6,
    z: -21.5,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'MACHINE HALL', targetX: WORKS.machineHall.x, targetZ: WORKS.machineHall.z },
      { label: 'YARD', targetX: WORKS.maintenanceYard.x, targetZ: WORKS.maintenanceYard.z },
    ],
  },
  {
    id: 'residential',
    title: 'RESIDENTIAL ARC',
    subtitle: 'HABS 01–10 · QUIET AFTER 22:00',
    x: -27.4,
    z: -16.8,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'HABS', targetX: -84, targetZ: -44 },
      { label: 'GARDENS', targetX: GARDENS[0].x, targetZ: GARDENS[0].z },
      { label: 'PLAYGROUND', targetX: PLAYGROUND.x, targetZ: PLAYGROUND.z },
    ],
  },
  {
    id: 'amphitheater',
    title: 'ASSEMBLY BOWL',
    subtitle: 'CAPACITY 4 000 · OPEN',
    x: -19.4,
    z: 10.8,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'BOWL', targetX: AMPHITHEATER.x, targetZ: AMPHITHEATER.z },
      { label: 'OVERLOOK', targetX: OVERLOOK_LOUNGE.x, targetZ: OVERLOOK_LOUNGE.z },
    ],
  },
  {
    id: 'gardens',
    title: 'REGOLITH GARDENS',
    subtitle: 'PLEASE KEEP TO THE PATH',
    x: -18.4,
    z: -22.4,
    approachX: 0,
    approachZ: 0,
    fingers: [
      { label: 'RAKE WALK', targetX: GARDENS[0].x, targetZ: GARDENS[0].z },
      { label: 'PLAYGROUND', targetX: PLAYGROUND.x, targetZ: PLAYGROUND.z },
    ],
  },
  {
    id: 'overlook',
    title: 'OVERLOOK WEST',
    subtitle: 'LOUNGE · RIM WALK · SUNSET SIDE',
    x: -82,
    z: -7.2,
    approachX: -40,
    approachZ: -4,
    fingers: [
      { label: 'LOUNGE', targetX: OVERLOOK_LOUNGE.x, targetZ: OVERLOOK_LOUNGE.z },
      { label: 'RIM WALK', targetX: -108, targetZ: -30 },
    ],
  },
]

/** District gate monoliths: backlit name, map plate, directional fingers. */
function dressGates(d: Dressing): void {
  const monolith = monolithParts()
  const board = fingerboardParts()
  for (const gate of GATES) {
    const spot = new Vector3(gate.x, interiorHeight(gate.x, gate.z), gate.z)
    if (!d.site.claim('gate-monolith', gate.x, gate.z, 1.25)) continue
    // Facing authority: the monolith looks back at the approach, like SeaPark's
    // `approachX/approachZ` — a gate that faces the wrong way is unbuildable.
    const yaw = Math.atan2(gate.approachX - gate.x, gate.approachZ - gate.z)
    placeParts(d.writer, monolith.soups, spot, yaw)

    art(d, { id: `gate-${gate.id}`, style: 'name', lines: [gate.title, gate.subtitle], aspect: 2.1 })
    art(d, {
      id: `gate-map-${gate.id}`,
      style: 'plate',
      lines: ['YOU ARE HERE', gate.subtitle, 'ELYSIUM COMMONS · SECTOR MAP'],
      aspect: 1.38,
    })
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    addFace(d, {
      art: d.arts.get(`gate-${gate.id}`)!,
      center: spot.clone().addScaledVector(forward, monolith.namePanel[1] + 0.006).setY(spot.y + monolith.namePanel[2]),
      yaw,
      pitch: 0,
      width: 1.0,
      height: 0.46,
      lit: true,
    })
    addFace(d, {
      art: d.arts.get(`gate-map-${gate.id}`)!,
      center: spot.clone().addScaledVector(forward, monolith.mapPlate[1] + 0.006).setY(spot.y + monolith.mapPlate[2]),
      yaw,
      pitch: 0,
      width: 0.97,
      height: 0.7,
      lit: false,
    })
    noteGlow(d, 'gate-panel', 1, spot)

    gate.fingers.forEach((finger, i) => {
      const root = monolith.fingerRoots[i % monolith.fingerRoots.length]
      const anchor = spot
        .clone()
        .addScaledVector(right, root.local[0])
        .addScaledVector(forward, root.local[1])
        .setY(spot.y + root.local[2])
      const bearing = Math.atan2(finger.targetX - anchor.x, finger.targetZ - anchor.z)
      placeParts(d.writer, board, anchor, bearing)
      writeFingerLegend(d, `${gate.id}-${i}`, finger.label, anchor, bearing)
    })

    d.services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 1.55),
      size: new Vector3(1.4, 3.1, 0.42),
      yaw,
    })
  }
}

/** Legend on both broad faces of a finger board (back face mirrored). */
function writeFingerLegend(
  d: Dressing,
  id: string,
  label: string,
  root: Vector3,
  bearing: number,
): void {
  const key = label.replace(/[^A-Z]/g, '')
  // Two tiles per label. The `side = +1` face's right-vector is -along, so it
  // gets the left-pointing chevron; both faces then point at the board's tip.
  // Aspect is the plate's own 0.5 / 0.126 — the old 4.6 squashed it 16 %.
  const artFor = (arrowLeft: boolean): SignArt =>
    art(d, {
      id: `finger-${key}${arrowLeft ? '-l' : '-r'}`,
      style: 'finger',
      lines: [label],
      aspect: 0.5 / 0.126,
      arrowLeft,
    })
  void id
  const along = new Vector3(Math.sin(bearing), 0, Math.cos(bearing))
  const normal = new Vector3(Math.cos(bearing), 0, -Math.sin(bearing))
  for (const side of [1, -1]) {
    addFace(d, {
      art: artFor(side === 1),
      // 0.33 along the board: the legend's 0.5 m span then runs 0.08 -> 0.58,
      // clear of the 0.043 post behind it and stopping exactly where the
      // board starts tapering (past 0.58 the plate is shorter than the tile,
      // and the tile's dark ground showed past the silhouette).
      center: root
        .clone()
        .addScaledVector(along, 0.33)
        .addScaledVector(normal, side * 0.0205),
      // No `mirror` here: the quad's own right-vector already flips with the
      // yaw, so both faces read forwards. (The banner cloth DOES need the u
      // flip, because both of its layers share one authored right-vector.)
      yaw: Math.atan2(normal.x * side, normal.z * side),
      pitch: 0,
      width: 0.5,
      height: 0.126,
      lit: false,
    })
  }
}

interface Junction {
  x: number
  z: number
  /** direction along the path, used to set the post off the lane */
  nx: number
  nz: number
  labels: Array<{ label: string; targetX: number; targetZ: number }>
}

/**
 * Junctions derived from PATHS: every place a spoke meets the plaza, the
 * boulevard or the rim promenade, plus every true path crossing. These are
 * the decision points, so these are where the fingerposts go.
 */
function findJunctions(): Junction[] {
  const found: Junction[] = []
  const push = (x: number, z: number, nx: number, nz: number): void => {
    for (const j of found) if (Math.hypot(j.x - x, j.z - z) < 9) return
    found.push({ x, z, nx, nz, labels: [] })
  }
  const rings = [FIRST_TREE.plazaRadius, BOULEVARD.innerRadius, PARK.rimWalkRadius]
  for (const lane of lanes()) {
    for (const end of [0, lane.points.length - 1]) {
      const p = lane.points[end]
      const q = lane.points[end === 0 ? 1 : lane.points.length - 2]
      const dir = new Vector2(p.x - q.x, p.y - q.y).normalize()
      const r = Math.hypot(p.x, p.y)
      for (const ring of rings) {
        if (Math.abs(r - ring) < 14) push(p.x, p.y, dir.x, dir.y)
      }
    }
  }
  // True crossings between different lanes.
  const all = lanes()
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      for (let i = 0; i < all[a].points.length; i += 2) {
        const p = all[a].points[i]
        let best = Infinity
        for (let k = 0; k < all[b].points.length - 1; k++) {
          const dd = segmentDistance(all[b].points[k], all[b].points[k + 1], p.x, p.y)
          if (dd < best) best = dd
        }
        if (best < all[a].half + all[b].half) {
          const q = all[a].points[Math.max(0, i - 1)]
          const dir = new Vector2(p.x - q.x, p.y - q.y)
          if (dir.lengthSq() < 1e-6) continue
          dir.normalize()
          push(p.x, p.y, dir.x, dir.y)
        }
      }
    }
  }
  return found
}

const DESTINATIONS: Array<{ label: string; x: number; z: number }> = [
  { label: 'FIRST TREE', x: 0, z: 0 },
  { label: 'PORTAL STN', x: PORTAL_STATION.x, z: PORTAL_STATION.z },
  { label: 'THE COMMONS', x: COMMONS.x, z: COMMONS.z },
  { label: 'HYDROPONICS', x: HYDRO_TOWER.x, z: HYDRO_TOWER.z },
  { label: 'FARMSIDE', x: 70, z: 0 },
  { label: 'THE WORKS', x: WORKS.machineHall.x, z: WORKS.machineHall.z },
  { label: 'ASSEMBLY BOWL', x: AMPHITHEATER.x, z: AMPHITHEATER.z },
  { label: 'OVERLOOK', x: OVERLOOK_LOUNGE.x, z: OVERLOOK_LOUNGE.z },
  { label: 'HABS', x: -84, z: -44 },
  { label: 'GARDENS', x: GARDENS[0].x, z: GARDENS[0].z },
  { label: 'RIM WALK', x: 0, z: PARK.rimWalkRadius },
]

function dressJunctions(d: Dressing): void {
  const post = fingerpostParts()
  const board = fingerboardParts()
  for (const junction of findJunctions()) {
    // Set the post off the lane, to the right of travel.
    const sideX = -junction.nz
    const sideZ = junction.nx
    const spot = d.site.nudge('fingerpost', junction.x + sideX * 3.4, junction.z + sideZ * 3.4, 0.9, sideX, sideZ, 6)
    if (!spot) continue
    placeParts(d.writer, post, spot, 0)
    const ranked = DESTINATIONS.map((dest) => ({
      dest,
      d: Math.hypot(dest.x - spot.x, dest.z - spot.z),
    }))
      .filter((entry) => entry.d > 12)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    ranked.forEach((entry, i) => {
      const z = 2.24 - i * 0.29
      const bearing = Math.atan2(entry.dest.x - spot.x, entry.dest.z - spot.z)
      const anchor = spot.clone().setY(spot.y + z)
      placeParts(d.writer, board, anchor, bearing)
      writeFingerLegend(d, `j${i}`, entry.dest.label, anchor, bearing)
    })
    d.services.colliders.push({
      kind: 'cylinder',
      center: spot.clone().setY(spot.y + 1.35),
      halfHeight: 1.35,
      radius: 0.14,
    })
  }
}

/** Station furniture: the notice board, a rack row and a bin pair per stop. */
function dressStations(d: Dressing): void {
  const notice = noticeParts()
  const rack = rackParts()
  // Boards and racks sit BESIDE each platform, not on its axis: the deck, its
  // canopy and its ramp own the axis, and the arriving guest walks past the
  // flank. Angles are offset so the first fan step already clears the deck.
  const stopAt = (angle: number, offset: number, radius: number): [number, number] => [
    Math.cos(angle + offset) * radius,
    Math.sin(angle + offset) * radius,
  ]
  const [px, pz] = stopAt(Math.PI / 2, 0.17, 85)
  const [ox, oz] = stopAt(Math.PI + 0.07, 0.17, 86)
  const [fx, fz] = stopAt(0.05, -0.17, 86)
  const stops: Array<{ id: string; x: number; z: number; label: string }> = [
    { id: 'portal', x: px, z: pz, label: 'PORTAL STATION' },
    { id: 'overlook', x: ox, z: oz, label: 'OVERLOOK WEST' },
    { id: 'farmside', x: fx, z: fz, label: 'FARMSIDE' },
  ]
  for (const stop of stops) {
    art(d, {
      id: `board-${stop.id}`,
      style: 'board',
      lines: [
        `${stop.label} · THE LOOP`,
        'PORTAL ▸ FARMSIDE ▸ OVERLOOK ▸ PORTAL',
        'HEADWAY 4 MIN · CONTINUOUS SERVICE',
        'DESIGN CAPACITY 10 000 · IN PARK TODAY 214',
        'PARK RULES: NO EVA · NO OPEN FLAME',
        'KEEP BEHIND THE TACTILE STRIP',
        'LOST PROPERTY — OPS, THE WORKS',
      ],
      aspect: 1.95,
    })
    const spot = d.site.nudge(
      'notice-board',
      stop.x,
      stop.z,
      1.3,
      -stop.x / Math.hypot(stop.x, stop.z || 1),
      -stop.z / Math.hypot(stop.x, stop.z || 1),
      7,
      1.2,
    )
    if (spot) {
      const yaw = Math.atan2(-stop.x, -stop.z)
      placeParts(d.writer, notice, spot, yaw)
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      // 0.137 = recess floor (0.125) + backing plate (0.012); the legend rides
      // 6 mm proud of that, still 17 mm behind the board's rim.
      addFace(d, {
        art: d.arts.get(`board-${stop.id}`)!,
        center: spot.clone().addScaledVector(forward, 0.146).setY(spot.y + 1.4),
        yaw,
        pitch: 0,
        width: 1.72,
        height: 0.88,
        lit: false,
      })
      noteGlow(d, 'notice-header', 1, spot)
      d.services.colliders.push({
        kind: 'box',
        center: spot.clone().setY(spot.y + 1.1),
        size: new Vector3(1.95, 2.2, 0.3),
        yaw,
      })
    }
    // Rack row: empty stands, because nobody has arrived yet.
    const dirX = -stop.x / Math.hypot(stop.x, stop.z || 1)
    const dirZ = -stop.z / Math.hypot(stop.x, stop.z || 1)
    const rackSpot = d.site.nudge(
      'rack',
      stop.x + dirX * 6 - dirZ * 5,
      stop.z + dirZ * 6 + dirX * 5,
      1.9,
      dirX,
      dirZ,
      6,
      1.1,
    )
    if (rackSpot) {
      const yaw = Math.atan2(-dirZ, dirX)
      placeParts(d.writer, rack, rackSpot, yaw)
      d.services.colliders.push({
        kind: 'box',
        center: rackSpot.clone().setY(rackSpot.y + 0.4),
        size: new Vector3(3.6, 0.8, 0.9),
        yaw,
      })
    }
  }
}

/** Works + farmside service layer: fire points and planter hose points. */
function dressServiceLayer(d: Dressing, rng: Rng): void {
  const fire = firePointParts()
  const hose = hoseParts()
  const firePoints: Array<[number, number, number]> = [
    [WORKS.machineHall.x - 14, WORKS.machineHall.z + 9, 0.6],
    [WORKS.maintenanceYard.x - 2, WORKS.maintenanceYard.z + 15, 0.1],
    [WORKS.tankFarm.x - 13, WORKS.tankFarm.z + 3, 1.6],
    [60.5, -30, 1.6],
    [60.5, 30, 1.6],
    [HYDRO_TOWER.x - 9, HYDRO_TOWER.z - 6, 0.7],
  ]
  art(d, {
    id: 'fire-point',
    style: 'sub',
    lines: ['FIRE POINT', 'HOSE · CO₂ · ALERT OPS'],
    aspect: 2.6,
  })
  for (const [x, z, yaw] of firePoints) {
    if (!d.site.claim('fire-point', x, z, 0.85)) continue
    const spot = new Vector3(x, interiorHeight(x, z), z)
    placeParts(d.writer, fire, spot, yaw)
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    addFace(d, {
      art: d.arts.get('fire-point')!,
      // 0.376 / 1.09, not 0.406 / 1.19: the cabinet rim is at 0.39 and the
      // shell tops out at 1.26, so the legend used to stand 16 mm proud of the
      // mouth with its top 50 mm hanging in open air above the cabinet. This
      // is the notice board's proven 14 mm reveal inside the rim.
      center: spot.clone().addScaledVector(forward, 0.376).setY(spot.y + 1.09),
      yaw,
      pitch: 0,
      width: 0.62,
      height: 0.24,
      lit: false,
    })
    d.services.colliders.push({
      kind: 'box',
      center: spot.clone().setY(spot.y + 0.6),
      size: new Vector3(1.15, 1.2, 0.55),
      yaw,
    })
  }

  // Hose points on the planter runs: every long bed gets its own tap.
  let placed = 0
  for (const planter of PLANTERS) {
    if (placed >= 14) break
    const span = (planter.a1 - planter.a0) * ((planter.rInner + planter.rOuter) / 2)
    if (span < 7) continue
    const a = planter.a0 + (planter.a1 - planter.a0) * (0.2 + rng.float() * 0.6)
    const r = planter.rInner - 0.75
    const x = planter.cx + Math.cos(a) * r
    const z = planter.cz + Math.sin(a) * r
    if (!d.site.claim('hose-point', x, z, 0.45)) continue
    placeParts(d.writer, hose, new Vector3(x, interiorHeight(x, z), z), Math.atan2(-Math.cos(a), -Math.sin(a)))
    placed++
  }
}

/**
 * The commons approach: paired masts carrying catenary festoons across the
 * walk, and one strung ring over the plaza. The only motion in the park
 * besides the banners, and the thing that makes the plaza read as OPEN.
 */
function dressFestoons(d: Dressing, wire: SwaySoup, bulbs: SwaySoup): void {
  const MAST_H = 4.6
  const mast = festoonMastParts(MAST_H)
  const anchors: Array<[Vector3, Vector3, number]> = []

  // Cross-spans over the commons approach.
  for (let i = 0; i < 4; i++) {
    const z = -28.6 - i * 3.1
    const pair: Vector3[] = []
    for (const sx of [-1, 1]) {
      const x = -1.4 + sx * 4.8
      if (!d.site.claim('festoon-mast', x, z, 0.55)) {
        pair.length = 0
        break
      }
      const spot = new Vector3(x, interiorHeight(x, z), z)
      placeParts(d.writer, mast, spot, 0)
      d.services.colliders.push({
        kind: 'cylinder',
        center: spot.clone().setY(spot.y + MAST_H / 2),
        halfHeight: MAST_H / 2,
        radius: 0.1,
      })
      pair.push(spot.clone().setY(spot.y + MAST_H - 0.06))
    }
    if (pair.length === 2) anchors.push([pair[0], pair[1], 0.85])
  }

  // A strung hexagon over the plaza, inboard of the raised beds.
  const ring: Vector3[] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.52
    const x = Math.cos(a) * 18.6
    const z = Math.sin(a) * 18.6
    if (!d.site.claim('festoon-mast', x, z, 0.55)) continue
    const spot = new Vector3(x, interiorHeight(x, z), z)
    placeParts(d.writer, mast, spot, 0)
    d.services.colliders.push({
      kind: 'cylinder',
      center: spot.clone().setY(spot.y + MAST_H / 2),
      halfHeight: MAST_H / 2,
      radius: 0.1,
    })
    ring.push(spot.clone().setY(spot.y + MAST_H - 0.06))
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (a.distanceTo(b) > 26) continue
    anchors.push([a, b, 1.7])
  }

  const bulb = festoonBulb()
  for (const [rawA, rawB, sag] of anchors) {
    // Start each catenary clear of the mast it hangs from: a wire beginning on
    // the mast axis threads straight through the column.
    const along = new Vector3().subVectors(rawB, rawA).normalize()
    const a = rawA.clone().addScaledVector(along, 0.1)
    const b = rawB.clone().addScaledVector(along, -0.1)
    const span = a.distanceTo(b)
    const stations = Math.max(10, Math.round(span / 0.9))
    const path: Vector3[] = []
    for (let s = 0; s <= stations; s++) path.push(catenary(a, b, sag, s / stations))
    const flat = new Vector3(b.x - a.x, 0, b.z - a.z).normalize()
    const normal = new Vector3(-flat.z, 0, flat.x)
    const phase = (a.x * 0.21 + a.z * 0.44) % 6.283
    // Wire in short runs so each run carries its own sway weight.
    for (let s = 0; s < stations; s++) {
      const t = (s + 0.5) / stations
      const w = Math.sin(Math.PI * t)
      const seg = tubeAlong(
        [
          [path[s].x, path[s].y, path[s].z],
          [path[s + 1].x, path[s + 1].y, path[s + 1].z],
        ],
        circle(0.009, 5),
        { up: [0, 1, 0] },
      )
      seg.frame = 'y-up'
      smoothShade(seg, SMOOTH.turned)
      swayWrite(wire, seg, normal, w, phase)
      if (s % 2 === 0) {
        const point = path[s]
        const glass = bulb.clone()
        glass.frame = 'z-up'
        rotX(glass, Math.PI)
        translate(glass, [point.x, point.z, point.y - 0.012])
        smoothShade(glass, SMOOTH.turned)
        swayWrite(bulbs, glass, normal, w, phase)
      }
    }
  }
}

// ------------------------------------------------------------------ entry

/**
 * Build the whole dressing layer. Order matters only for the ledger: earlier
 * families win contested ground, so the fixed civic set (gates, boulevard,
 * plaza) is placed before the opportunistic marches.
 */
export function buildAmenities(services: DistrictServices): void {
  const d: Dressing = {
    services,
    writer: services.writer,
    site: new Site(),
    arts: new Map(),
    faces: [],
    banners: [],
    lensCount: new Map(),
    lensAnchor: new Map(),
  }

  dressGates(d)
  dressBoulevard(d)
  dressPlaza(d)
  dressStations(d)
  dressRimWalk(d)
  dressJunctions(d)
  dressPathNetwork(d, services.rng.fork('amenities-march'))
  dressServiceLayer(d, services.rng.fork('amenities-service'))

  const wire = newSwaySoup()
  const bulbs = newSwaySoup()
  dressFestoons(d, wire, bulbs)

  // ---- one atlas for every legend in the park.
  const atlas = buildAtlas([...d.arts.values()])
  for (const mesh of buildSignMeshes(d.faces, atlas.rects, atlas.texture)) {
    services.group.add(mesh)
  }

  // ---- banners: sleeved cloth on the boulevard columns.
  const cloth = newSwaySoup()
  for (const spec of d.banners) {
    const rect = atlas.rects.get(spec.artId)
    if (rect) writeBanner(cloth, spec, rect)
  }
  if (cloth.positions.length > 0) {
    const material = new MeshStandardNodeMaterial()
    material.colorNode = texture(atlas.texture)
    material.roughness = 0.94
    material.metalness = 0
    material.side = DoubleSide
    material.positionNode = swayPosition(0.05, 0.9) as unknown as typeof material.positionNode
    const mesh = new Mesh(swayGeometry(cloth), material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = 'amenities:banners'
    services.group.add(mesh)
  }

  // ---- festoon wire + bulbs.
  if (wire.positions.length > 0) {
    const material = new MeshStandardNodeMaterial()
    material.colorNode = vec3(0.14, 0.135, 0.13)
    material.roughness = 0.72
    material.metalness = 0.25
    material.positionNode = swayPosition(0.035, 0.72) as unknown as typeof material.positionNode
    const mesh = new Mesh(swayGeometry(wire), material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.name = 'amenities:festoon-wire'
    services.group.add(mesh)
  }
  if (bulbs.positions.length > 0) {
    const material = new MeshStandardNodeMaterial()
    material.colorNode = vec3(0.88, 0.84, 0.76)
    material.emissiveNode = vec3(1.0, 0.78, 0.5).mul(BULB_EMISSIVE) as unknown as Node<'vec3'>
    material.roughness = 0.3
    material.metalness = 0
    material.positionNode = swayPosition(0.035, 0.72) as unknown as typeof material.positionNode
    const mesh = new Mesh(swayGeometry(bulbs), material)
    // Emissive geometry must never write the sun's shadow map (notes, W2).
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.name = 'amenities:festoon-bulbs'
    services.group.add(mesh)
    noteGlow(d, 'festoon-bulbs', Math.round(bulbs.positions.length / 3 / 60), new Vector3(0, 4.5, -30))
  }

  // ---- declare the emissive pools so the artificial layer can be audited.
  const rig = lightFixtures()
  const slots: Record<string, EmissiveSlot> = {
    'lamp-heads': 'utilityLight',
    'festoon-bulbs': 'utilityLight',
    'gate-panel': 'signageGlow',
    'emergency-header': 'signageGlow',
    'notice-header': 'signageGlow',
  }
  for (const [family, count] of d.lensCount) {
    const anchor = d.lensAnchor.get(family) ?? new Vector3()
    rig.registerGlowPool({
      id: `amenities:${family}`,
      slot: slots[family] ?? 'utilityLight',
      count,
      position: [anchor.x, anchor.y, anchor.z],
    })
  }

  // `!== false` rather than truthy: the headless gate (tools/amenity-audit.mjs)
  // runs this module outside vite, where `import.meta.env` is undefined.
  if (import.meta.env?.DEV !== false) {
    const parts: string[] = []
    for (const [family, count] of [...d.site.counts].sort((a, b) => b[1] - a[1])) {
      parts.push(`${family} ${count}`)
    }
    let rejected = 0
    const refused: string[] = []
    for (const [family, n] of d.site.rejects) {
      rejected += n
      refused.push(`${family} ${n}`)
    }
    console.info(
      `[amenities] ${d.site.total()} placements (${parts.join(', ')}); ` +
        `${rejected} refused by the clearance rules (${refused.join(', ')}); ` +
        `${d.faces.length} sign faces, ${d.arts.size} atlas tiles, ` +
        `${d.banners.length} banners`,
    )
  }
}

/**
 * Every baked family, by name. Exported so the geometry gate can audit each
 * object in ISOLATION — a defect inside one bin is invisible once sixty of
 * them are merged into the park's `part:dark` mesh with everything else.
 */
export function amenityFamilies(): Record<string, PartSoup[]> {
  return {
    waste: wasteParts(),
    emergency: emergencyParts(),
    firePoint: firePointParts(),
    fountain: fountainParts(),
    rack: rackParts(),
    hose: hoseParts(),
    binocular: binocularParts(),
    monolith: monolithParts().soups,
    fingerpost: fingerpostParts(),
    fingerboard: fingerboardParts(),
    plaque: plaqueParts(),
    notice: noticeParts(),
    parkModel: parkModelParts(),
    festoonMast: festoonMastParts(4.6),
  }
}

/** Triangle cost of one of each family — the budget check in the report. */
export function amenityBudget(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, soups] of Object.entries(amenityFamilies())) out[name] = partsTriangles(soups)
  return out
}
