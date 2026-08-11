/**
 * The Residential Arc — ten homes waiting for their city.
 *
 * Placement, dressing and contracts only; the dwelling itself is one
 * parametric product in `habUnit.ts` (read its header first — it explains the
 * analytic shell and the slot discipline this file has to respect).
 *
 * ## Where the row actually stands, and why it is not on r = 88
 *
 * `parkPlan.habSites()` surveys ten sites on an arc at r = 88, ~10.12 m apart.
 * Two neighbours constrain the building line and they pull the same way:
 *
 *  - **Outward:** the boulevard's inner curb (paving) presents its outer face
 *    at r = BOULEVARD.innerRadius - 0.165 = 90.835, and beyond it lies the
 *    guideway swept volume (94.5-99.5) that nothing may enter.
 *  - **Inward:** the `residential-lane` ribbon TERMINATES at (-86, -26), one
 *    metre behind hab 1. Its paved capsule plus curb reaches in to r = 87.98,
 *    so a hab whose back face sits at r = 90.75 (centred on its survey site)
 *    has a white curb and 3 m of paving running underneath it.
 *
 * So the row takes ONE uniform back building line at r = 87.55 — 0.43 m clear
 * of the lane's turning head and 3.28 m clear of the boulevard curb — and the
 * survey arc becomes what it should be: the centre line the row is set out
 * FROM, not the line it stands on. Uniform, so the arc still reads as an arc;
 * a per-hab setback would put one unit visibly out of the row.
 *
 * Open layout conflict, NOT fixable from this file: `PLAYGROUND` (-62, -54,
 * r = 9) sits on the same bearing as hab 5 and only 5.8 m radially inboard of
 * the survey arc, so its poured surface swallows habs 4 and 5 at ANY radius
 * the arc can legally take. See the report / park-assembly.md.
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, Mesh, SRGBColorSpace, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { texture } from 'three/tsl'
import type { PartWriter } from '../../archkit/writer'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  annularPrism,
  bevel,
  cleanMesh,
  circle,
  loft,
  polyOffset,
  prism,
  prismXZ,
  revolve,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  type SlotParts,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { Rng } from '../../core/prng'
import { interiorHeight } from '../interiorHeight'
import { habSites, RESIDENTIAL } from '../parkPlan'
import type { ColliderSpec, DistrictServices } from './types'
import {
  HAB_FLOOR_Z,
  buildHabUnit,
  buildJackFoot,
  buildPier,
  buildStepBlock,
  habLocalToWorld,
  toSoups,
  writeSoups,
  type HabUnitContract,
  type HabUnitSpec,
  type Soup,
} from './habUnit'

// ------------------------------------------------------------------- layout

/** Uniform back building line for the whole row (see the file header). */
const BACK_LINE = 87.55
/** The set-pad front walk runs at this radius, in front of every porch. */
const WALK_RADIUS = 76.2

const DWELLING: HabUnitSpec = {
  length: 6.8,
  widthScale: 1,
  // four 1.7 m panels; each joint is interrupted by the opening it crosses,
  // which is exactly what a panelised shell does
  seams: [-1.7, 0, 1.7],
  windows: [
    { x0: -2.6, x1: -1.05 },
    { x0: 1.3, x1: 2.55 },
  ],
  backWindow: { x0: -0.7, x1: 0.5 },
  door: { x0: -0.55, x1: 0.55 },
  plateX: 2.98,
  porch: { halfWidth: 2.3, front: 5.05, stepHalfWidth: 0.72 },
}

/** The Common Hab: the same product, one size up, with a glazed frontage. */
const COMMON: HabUnitSpec = {
  length: 9.8,
  widthScale: 1.2,
  seams: [-2.45, 0, 2.45],
  windows: [
    { x0: -4.05, x1: -1.35 },
    { x0: 1.35, x1: 4.05 },
  ],
  backWindow: { x0: -1.0, x1: 0.8 },
  door: { x0: -0.75, x1: 0.75 },
  plateX: 4.5,
  porch: { halfWidth: 3.25, front: 6.5, stepHalfWidth: 1.1 },
  interiorFloor: true,
  openDoor: true,
}

export interface HabFrame {
  index: number
  common: boolean
  /** +Z forward = toward the park centre */
  yaw: number
  /** world plan centre of the hab, y = the local grade datum */
  center: Vector3
  ground: number
  spec: HabUnitSpec
  unit: HabUnitContract
}

interface UnitCache {
  unit: HabUnitContract
  soups: Soup[]
}

const UNITS = new Map<string, UnitCache>()
function unitFor(spec: HabUnitSpec, key: string): UnitCache {
  let hit = UNITS.get(key)
  if (!hit) {
    const unit = buildHabUnit(spec)
    hit = { unit, soups: toSoups(unit.parts) }
    UNITS.set(key, hit)
  }
  return hit
}

let FRAMES: HabFrame[] | null = null

/** The row's authored placement. Shared with `habInterior.ts`. */
export function habFrames(): HabFrame[] {
  if (FRAMES) return FRAMES
  FRAMES = habSites().map((site, index) => {
    const spec = site.common ? COMMON : DWELLING
    const cache = unitFor(spec, site.common ? 'common' : 'dwelling')
    const radius = BACK_LINE - cache.unit.shellHalf[2]
    const x = Math.cos(site.angle) * radius
    const z = Math.sin(site.angle) * radius
    const ground = interiorHeight(x, z)
    return {
      index,
      common: site.common,
      yaw: Math.atan2(-x, -z),
      center: new Vector3(x, ground, z),
      ground,
      spec,
      unit: cache.unit,
    }
  })
  return FRAMES
}

/** The Common Hab's frame — `habInterior.ts` furnishes against this. */
export function commonHabFrame(): HabFrame {
  return habFrames()[RESIDENTIAL.commonHabIndex]
}

// --------------------------------------------------------------- utilities

function writeParts(writer: PartWriter, parts: SlotParts, center: Vector3, yaw: number): void {
  writeSoups(writer, toSoups(parts), center, yaw)
}

function put(parts: Record<string, MeshData[]>, slot: string, ...md: MeshData[]): void {
  const list = parts[slot] ?? (parts[slot] = [])
  for (const m of md) list.push(cleanMesh(m))
}

/** A closed slab swept along a 2-D path in the (y, z) plane — cloth, straps. */
function sheet(path: Vec2[], halfWidth: number, thickness: number, slot: string): MeshData {
  const md = tubeAlong(
    path.map(([y, z]) => [0, y, z] as Vec3),
    roundedRect(halfWidth * 2, thickness, thickness * 0.45, 2),
    { cap: true },
  )
  void slot
  return smoothShade(md, SMOOTH.shell)
}

/** Sag a straight run into a catenary-ish curve, `n` stations. */
function sag(a: Vec3, b: Vec3, drop: number, n = 12): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const s = 4 * t * (1 - t)
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - drop * s])
  }
  return out
}

// ---------------------------------------------------------- number plates

const PLATE_W = 0.4
const PLATE_H = 0.115
let plateMaterial: MeshStandardNodeMaterial | null = null

/**
 * All ten hab numbers on ONE canvas atlas and ONE merged mesh: the reference
 * image labels everything, and ten separate `signageMaterial()` calls would be
 * ten canvases, ten materials and ten draws for 0.5 m² of geometry.
 */
function habPlateMaterial(count: number): MeshStandardNodeMaterial {
  if (plateMaterial) return plateMaterial
  const tileW = 256
  const tileH = 74
  const canvas = document.createElement('canvas')
  canvas.width = tileW
  canvas.height = tileH * count
  const g = canvas.getContext('2d')
  if (g) {
    for (let i = 0; i < count; i++) {
      const y = i * tileH
      g.fillStyle = '#141210'
      g.fillRect(0, y, tileW, tileH)
      g.strokeStyle = 'rgba(230,222,208,0.30)'
      g.lineWidth = 3
      g.strokeRect(5, y + 5, tileW - 10, tileH - 10)
      g.fillStyle = '#f2ece0'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = '700 34px "Helvetica Neue", Helvetica, Arial, sans-serif'
      g.fillText(`H A B  ${String(i + 1).padStart(2, '0')}`, tileW / 2, y + tileH / 2 + 1)
    }
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const material = new MeshStandardNodeMaterial()
  material.colorNode = texture(tex).rgb.mul(0.5)
  // just under signageGlow (3.4) on the emissive ladder: the numerals read as
  // backlit stencil, the dark field stays below the bloom threshold
  material.emissiveNode = texture(tex).rgb.mul(3.0)
  material.roughness = 0.5
  material.metalness = 0
  plateMaterial = material
  return material
}

function habPlateMesh(frames: HabFrame[]): Mesh {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const count = frames.length
  for (const frame of frames) {
    const [px, py, pz] = frame.unit.plateAt
    const [ny, nz] = frame.unit.plateNormal
    // in the hab's local frame the plate's face normal is (0, ny, nz) and the
    // "up the face" direction is its perpendicular, (0, -nz, ny)
    const corner = (sx: number, sz: number): Vector3 =>
      habLocalToWorld(
        frame.center,
        frame.yaw,
        px + sx * PLATE_W * 0.5,
        py + sz * (PLATE_H * 0.5) * -nz,
        pz + sz * (PLATE_H * 0.5) * ny,
      )
    const nWorld = new Vector3(ny * Math.sin(frame.yaw), nz, ny * Math.cos(frame.yaw)).normalize()
    const v0 = 1 - (frame.index + 1) / count
    const v1 = 1 - frame.index / count
    const quad: Array<[Vector3, number, number]> = [
      [corner(-1, -1), 0, v0],
      [corner(1, -1), 1, v0],
      [corner(1, 1), 1, v1],
      [corner(-1, 1), 0, v1],
    ]
    for (const [a, b, c] of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      for (const k of [a, b, c]) {
        const [p, u, v] = quad[k]
        positions.push(p.x, p.y, p.z)
        normals.push(nWorld.x, nWorld.y, nWorld.z)
        uvs.push(u, v)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  const mesh = new Mesh(geometry, habPlateMaterial(count))
  mesh.name = 'hab-numbers'
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

// --------------------------------------------------------------- the chair

const CHAIR_SEAT_Z = 0.44

/**
 * A sling chair: a bent-tube frame with a fabric sling slung front rail to
 * top rail. Six parts, a real silhouette, and the sling gives the row three
 * colours without three materials.
 */
function buildChair(fabricSlot: string): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const tube = roundedRect(0.034, 0.028, 0.01, 2)
  for (const sx of [-1, 1]) {
    const x = sx * 0.245
    // one continuous bend: front foot, up, along the seat, up the back
    const spine: Vec3[] = [
      [x, -0.235, 0.032],
      [x, -0.225, 0.16],
      [x, -0.2, 0.395],
      [x, -0.155, 0.43],
      [x, 0.1, CHAIR_SEAT_Z],
      [x, 0.185, 0.462],
      [x, 0.222, 0.63],
      [x, 0.248, 0.86],
    ]
    put(parts, 'aluminum', smoothShade(tubeAlong(spine, tube, { cap: true }), SMOOTH.turned))
    // rear leg drops from the seat rail to a splayed foot
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          // Ends at 0.028: the 0.024-deep section puts the tube's underside on
          // 0.016, a 2 mm reveal over the 0.014 pad. At 0.036 the rear leg
          // finished 10 mm above the pad it is supposed to stand on.
          [
            [x, 0.17, 0.44],
            [x, 0.2, 0.24],
            [x, 0.225, 0.028],
          ],
          roundedRect(0.028, 0.024, 0.009, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
    // foot pad, 4 mm proud of the deck so the chair casts a line
    const pad = prism(roundedRect(0.07, 0.07, 0.02, 2), 0.002, 0.014)
    bevel(pad, BEVEL.hardware, 2)
    translate(pad, [x, sx > 0 ? -0.235 : -0.235, 0])
    put(parts, 'dark', pad)
    const padBack = prism(roundedRect(0.07, 0.07, 0.02, 2), 0.002, 0.014)
    bevel(padBack, BEVEL.hardware, 2)
    translate(padBack, [x, 0.225, 0])
    put(parts, 'dark', padBack)
  }
  for (const [y, z, r] of [
    [-0.155, 0.43, 0.016],
    [0.248, 0.858, 0.018],
    [0.212, 0.15, 0.013],
  ] as const) {
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [-0.245, y, z],
            [0.245, y, z],
          ],
          roundedRect(r * 2, r * 1.7, r * 0.6, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  // the sling: front rail, dished seat, up to the top rail
  const slingPath: Vec2[] = [
    [-0.126, 0.454],
    [-0.05, 0.418],
    [0.06, 0.418],
    [0.16, 0.452],
    [0.2, 0.55],
    [0.222, 0.7],
    [0.236, 0.818],
  ]
  put(parts, fabricSlot, sheet(slingPath, 0.215, 0.014, fabricSlot))
  // arm rails
  for (const sx of [-1, 1]) {
    const x = sx * 0.262
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [x, -0.15, 0.6],
            [x, 0.03, 0.635],
            [x, 0.205, 0.655],
          ],
          roundedRect(0.05, 0.022, 0.009, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [x, -0.152, 0.437],
            [x, -0.15, 0.6],
          ],
          roundedRect(0.022, 0.022, 0.008, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  return parts
}

const CHAIRS = new Map<string, Soup[]>()
function chairSoups(fabricSlot: string): Soup[] {
  let hit = CHAIRS.get(fabricSlot)
  if (!hit) {
    hit = toSoups(buildChair(fabricSlot))
    CHAIRS.set(fabricSlot, hit)
  }
  return hit
}

// ------------------------------------------------------- personal touches

type TouchKind =
  | 'jacket'
  | 'plant'
  | 'dumbbells'
  | 'guitar'
  | 'trike'
  | 'telescope'
  | 'toolbag'
  | 'dryrack'

const TOUCHES: TouchKind[] = ['jacket', 'plant', 'dumbbells', 'guitar', 'trike', 'telescope', 'toolbag', 'dryrack']

/** A jacket left over a chair back — the beat `design.md` names by hand. */
function touchJacket(rng: Rng, fabricSlot: string): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  // drapes over the chair's top rail (local origin AT that rail)
  const rings: Vec3[][] = []
  const stations = 11
  for (let i = 0; i <= stations; i++) {
    const t = i / stations
    const x = -0.24 + t * 0.48
    const fold = Math.sin(t * 7.3 + rng.range(0, 1)) * 0.012
    const drop = 0.34 + Math.sin(t * 3.1) * 0.035
    const profile: Vec2[] = [
      [0.055 + fold, 0.02],
      [0.062 + fold, -0.06],
      [0.05 + fold, -drop],
      [0.02 + fold, -drop - 0.03],
      [-0.02 + fold, -drop - 0.02],
      [-0.05 + fold, -drop * 0.86],
      [-0.062 + fold, -0.06],
      [-0.055 + fold, 0.02],
    ]
    rings.push(profile.map(([y, z]) => [x, y, z] as Vec3))
  }
  put(parts, fabricSlot, smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
  return parts
}

function touchPlant(rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const pot = revolve(
    [
      [0, 0],
      [0.15, 0],
      [0.16, 0.02],
      [0.19, 0.26],
      [0.2, 0.3],
      [0.205, 0.325],
      [0.185, 0.335],
      [0.18, 0.31],
      [0.15, 0.06],
      [0, 0.05],
    ],
    22,
    { smooth: SMOOTH.turned },
  )
  put(parts, 'cast', pot)
  const soil = revolve(
    [
      [0, 0.3],
      [0.172, 0.298],
      [0.172, 0.29],
      [0, 0.288],
    ],
    18,
    { smooth: SMOOTH.turned },
  )
  put(parts, 'soil', soil)
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rng.range(-0.2, 0.2)
    const lean = rng.range(0.14, 0.3)
    const tall = rng.range(0.3, 0.52)
    const blade: Vec3[] = []
    for (let s = 0; s <= 5; s++) {
      const t = s / 5
      blade.push([
        Math.cos(a) * lean * t * t,
        Math.sin(a) * lean * t * t,
        0.304 + tall * t - 0.06 * t * t,
      ])
    }
    put(
      parts,
      'growBar',
      smoothShade(
        tubeAlong(blade, roundedRect(0.038, 0.011, 0.004, 2), { cap: true, scale: [[1, 1], [0.92, 1], [0.78, 1], [0.62, 1], [0.46, 1], [0.32, 1]] }),
        SMOOTH.moulded,
      ),
    )
  }
  return parts
}

function touchDumbbells(rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  for (let k = 0; k < 2; k++) {
    const y = -0.1 + k * 0.22
    const yaw = rng.range(-0.25, 0.25)
    const bar = revolve(
      [
        [0, 0],
        [0.016, 0],
        [0.016, 0.34],
        [0, 0.34],
      ],
      12,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    translate(bar, [-0.17, y + yaw * 0.1, 0.062])
    put(parts, 'aluminum', bar)
    for (const sx of [-1, 1]) {
      const disc = revolve(
        [
          [0, 0],
          [0.055, 0],
          [0.062, 0.012],
          [0.062, 0.05],
          [0.055, 0.062],
          [0, 0.062],
        ],
        18,
        { axis: 'x', smooth: SMOOTH.turned },
      )
      translate(disc, [sx * 0.108 - 0.0 + (sx < 0 ? -0.062 : 0), y + yaw * 0.1, 0.062])
      put(parts, 'dark', disc)
    }
  }
  return parts
}

function touchGuitar(): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  // a case leaning against the shell: a lofted body with a domed lid
  const plan: Vec2[] = []
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2
    const waist = 1 - 0.34 * Math.exp(-Math.pow((t - Math.PI / 2) / 0.42, 2)) - 0.34 * Math.exp(-Math.pow((t - Math.PI * 1.5) / 0.42, 2))
    const rx = 0.175 * waist
    const ry = 0.52
    plan.push([rx * Math.cos(t) * 1.0 + (Math.sin(t) > 0 ? 0.02 : -0.03), ry * Math.sin(t)])
  }
  const levels: Array<[number, number]> = [
    [-0.02, 0],
    [0, 0.018],
    [0, 0.086],
    [-0.02, 0.104],
  ]
  const body = loft(
    levels.map(([off, dz]) => polyOffset(plan, off).map(([x, y]) => [x, y, dz] as Vec3)),
    { closeV: true, capStart: true, capEnd: true },
  )
  smoothShade(body, SMOOTH.shell)
  // stand it on its edge, leaning back against the wall
  rotateInto(body, -Math.PI / 2 + 0.16)
  put(parts, 'dark', body)
  for (const t of [-0.3, 0.32]) {
    const latch = prism(roundedRect(0.05, 0.03, 0.008, 2), 0.09, 0.108)
    translate(latch, [0.0, t, 0])
    rotateInto(latch, -Math.PI / 2 + 0.16)
    put(parts, 'steelEdge', latch)
  }
  const handle = tubeAlong(
    [
      [0.19, -0.06, 0.052],
      [0.225, 0, 0.052],
      [0.19, 0.06, 0.052],
    ],
    roundedRect(0.022, 0.014, 0.006, 2),
    { cap: true },
  )
  rotateInto(handle, -Math.PI / 2 + 0.16)
  put(parts, 'dark', smoothShade(handle, SMOOTH.turned))
  return parts
}

/**
 * Tip a part that was drawn lying flat up onto its edge (about +X).
 *
 * The lift is 0.5124, not 0.53. The case's deepest vertex is (y 0.52, z 0.018)
 * and at this angle that maps to `0.52·sin + 0.018·cos` = −0.5104, so at 0.53
 * the whole case — the one object on the porch that is meant to be LEANING on
 * something — floated 19.6 mm over the deck. This lands its lowest point on the
 * 2 mm reveal the porch chair's own pads use.
 */
function rotateInto(md: MeshData, angle: number): MeshData {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  for (const v of md.verts) {
    const y = v[1]
    const z = v[2]
    v[1] = y * c - z * s
    v[2] = y * s + z * c + 0.5124
  }
  md.provenance = null
  return md
}

function touchTrike(): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const wheel = (r: number, w: number): MeshData => {
    const tyre = revolve(
      [
        [r - 0.035, -w / 2],
        [r, -w / 2 + 0.008],
        [r + 0.004, 0],
        [r, w / 2 - 0.008],
        [r - 0.035, w / 2],
        [r - 0.042, w / 2 - 0.01],
        [r - 0.042, -w / 2 + 0.01],
      ],
      18,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    return tyre
  }
  const front = wheel(0.14, 0.05)
  translate(front, [0, -0.26, 0.14])
  put(parts, 'dark', front)
  for (const sx of [-1, 1]) {
    const rear = wheel(0.1, 0.042)
    translate(rear, [sx * 0.17, 0.2, 0.1])
    put(parts, 'dark', rear)
  }
  put(
    parts,
    'playRed',
    smoothShade(
      tubeAlong(
        [
          [0, -0.09, 0.185],
          [0, -0.02, 0.205],
          [0, 0.16, 0.22],
        ],
        roundedRect(0.05, 0.042, 0.014, 2),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  put(
    parts,
    'playRed',
    smoothShade(
      tubeAlong(
        [
          [-0.18, 0.2, 0.1],
          [0, 0.2, 0.22],
          [0.18, 0.2, 0.1],
        ],
        roundedRect(0.03, 0.03, 0.01, 2),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  const seat = prism(roundedRect(0.2, 0.24, 0.06, 3), 0.22, 0.26)
  bevel(seat, BEVEL.frame, 2)
  translate(seat, [0, 0.14, 0])
  put(parts, 'playBlue', smoothShade(seat, SMOOTH.shell))
  put(
    parts,
    'aluminum',
    smoothShade(
      tubeAlong(
        [
          [0, -0.26, 0.16],
          [0, -0.3, 0.5],
        ],
        roundedRect(0.03, 0.03, 0.01, 2),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  put(
    parts,
    'playBlue',
    smoothShade(
      tubeAlong(
        [
          [-0.15, -0.3, 0.5],
          [0.15, -0.3, 0.5],
        ],
        roundedRect(0.028, 0.028, 0.01, 2),
        { cap: true },
      ),
      SMOOTH.turned,
    ),
  )
  return parts
}

function touchTelescope(): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const head: Vec3 = [0, 0, 1.02]
  for (let leg = 0; leg < 3; leg++) {
    const a = (leg / 3) * Math.PI * 2 + 0.4
    const foot: Vec3 = [Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0]
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          // Foot end at +0.021, not +0.028: the leg rakes 21.5 deg off vertical
          // so its perpendicular end cap dips 4.8 mm below the path, which puts
          // the tube's lowest point on the 2 mm reveal over its 14 mm pad. At
          // 0.028 all three legs finished 9 mm above the pads they stand on.
          [
            [head[0], head[1], head[2] - 0.08],
            [foot[0], foot[1], foot[2] + 0.021],
          ],
          roundedRect(0.026, 0.022, 0.008, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
    const pad = prism(roundedRect(0.06, 0.06, 0.018, 2), 0, 0.014)
    bevel(pad, BEVEL.hardware, 2)
    translate(pad, foot)
    put(parts, 'dark', pad)
  }
  const yoke = prism(roundedRect(0.13, 0.11, 0.024, 2), 0.94, 1.06)
  bevel(yoke, BEVEL.frame, 2)
  put(parts, 'dark', yoke)
  // the tube, aimed up over the rim
  const axis: Vec3[] = [
    [0, -0.28, 0.86],
    [0, 0.3, 1.28],
  ]
  const ota = tubeAlong(axis, circle(0.075, 16), { cap: true })
  put(parts, 'steelEdge', smoothShade(ota, SMOOTH.turned))
  const dew = tubeAlong(
    [
      [0, 0.26, 1.255],
      [0, 0.4, 1.355],
    ],
    circle(0.082, 16),
    { cap: true },
  )
  put(parts, 'dark', smoothShade(dew, SMOOTH.turned))
  const finder = tubeAlong(
    [
      [0.085, -0.08, 0.99],
      [0.085, 0.1, 1.12],
    ],
    circle(0.022, 10),
    { cap: true },
  )
  put(parts, 'dark', smoothShade(finder, SMOOTH.turned))
  const focuser = revolve(
    [
      [0, 0],
      [0.038, 0],
      [0.038, 0.05],
      [0.026, 0.058],
      [0, 0.058],
    ],
    12,
    { smooth: SMOOTH.turned },
  )
  translate(focuser, [-0.075, -0.2, 0.9])
  put(parts, 'aluminum', focuser)
  return parts
}

function touchToolbag(rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const rings: Vec3[][] = []
  for (let i = 0; i <= 9; i++) {
    const t = i / 9
    const x = -0.26 + t * 0.52
    const bulge = 0.16 * Math.sin(Math.PI * t) + 0.04
    const slump = Math.sin(t * 5.1 + rng.range(0, 1)) * 0.008
    const profile: Vec2[] = [
      [-bulge, 0.006],
      [-bulge * 0.94, 0.14 + slump],
      [-bulge * 0.5, 0.24 + slump],
      [0, 0.255 + slump],
      [bulge * 0.5, 0.24 + slump],
      [bulge * 0.94, 0.14 + slump],
      [bulge, 0.006],
      [bulge * 0.7, 0.003],
      [-bulge * 0.7, 0.003],
    ]
    rings.push(profile.map(([y, z]) => [x, y, z] as Vec3))
  }
  put(parts, 'fabricSand', smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
  for (const sy of [-1, 1]) {
    put(
      parts,
      'dark',
      smoothShade(
        tubeAlong(
          [
            [-0.12, sy * 0.06, 0.25],
            [-0.05, sy * 0.05, 0.4],
            [0.05, sy * 0.05, 0.4],
            [0.12, sy * 0.06, 0.25],
          ],
          roundedRect(0.03, 0.011, 0.005, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (const [x, y, z, r] of [
    [0.3, -0.02, 0.05, 0.02],
    [0.34, 0.05, 0.05, 0.016],
  ] as const) {
    const handleTool = tubeAlong(
      [
        [x, y, z],
        [x + 0.14, y + 0.03, z + 0.01],
      ],
      circle(r, 8),
      { cap: true },
    )
    put(parts, 'orange', smoothShade(handleTool, SMOOTH.turned))
  }
  return parts
}

/** y of the dry rack's raking leg line at height z — rails and drapes share it. */
function rackRailY(z: number): number {
  return 0.24 + (0.03 - 0.24) * ((z - 0.01) / 0.87)
}

function touchDryRack(): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const tube = roundedRect(0.024, 0.024, 0.008, 2)
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) {
      put(
        parts,
        'aluminum',
        smoothShade(
          tubeAlong(
            [
              [sx * 0.34, sy * 0.24, 0.01],
              [sx * 0.3, sy * 0.03, 0.88],
            ],
            tube,
            { cap: true },
          ),
          SMOOTH.turned,
        ),
      )
    }
  }
  // The legs rake in as they rise (y ±0.24 at z 0.01 → ±0.03 at z 0.88), so a
  // rail's y has to be SOLVED from that line at its own height. Both ends used
  // a literal 0.03 — the multiplier on one of them was `(z === 0.86 ? 0 : 0)`,
  // identically zero — which left the two lower rails ending 53 mm and 101 mm
  // short of the legs in y, in mid-air.
  for (const z of [0.86, 0.66, 0.46]) {
    const t = (0.88 - z) / 0.88
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [-0.3 - t * 0.04, rackRailY(z), z],
            [0.3 + t * 0.04, rackRailY(z), z],
          ],
          roundedRect(0.018, 0.018, 0.006, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  // Each drape straddles the rail it hangs on, so its y is that same solved
  // line: at −0.17 the lower towel hung 250 mm clear of every rail in the rack.
  for (const [z, slot, depthY] of [
    [0.86, "fabricBlue", rackRailY(0.86)],
    [0.66, "fabricRust", rackRailY(0.66)],
  ] as const) {
    const rings: Vec3[][] = []
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      const x = -0.24 + t * 0.48
      const fold = Math.sin(t * 6.2) * 0.01
      const drop = 0.28 + Math.sin(t * 2.6) * 0.03
      rings.push(
        (
          [
            [0.03 + fold, 0.015],
            [0.036 + fold, -0.02],
            [0.028 + fold, -drop],
            [-0.028 + fold, -drop],
            [-0.036 + fold, -0.02],
            [-0.03 + fold, 0.015],
          ] as Vec2[]
        ).map(([y, zz]) => [x, y + depthY, zz + z - 0.014] as Vec3),
      )
    }
    put(parts, slot, smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
  }
  return parts
}

// ------------------------------------------------------ between-hab things

function clothesline(rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const span = 3.0
  for (const sy of [-1, 1]) {
    const y = (sy * span) / 2
    const base = roundedRect(0.1, 0.1, 0.04, 2)
    put(
      parts,
      'steel',
      smoothShade(
        loft(
          // The first station is t = 0 at z = 0.046, i.e. 4 mm INSIDE the cast
          // foot's 0.05 top. At t = 0.03 of a 2.086 run the post's own base
          // ring started at 0.117 and the post stood on 67 mm of air.
          (
            [
              [0, 0],
              [0.2, -0.012],
              [1, -0.03],
            ] as Array<[number, number]>
          ).map(([t, off]) => polyOffset(base, off).map(([x, yy]) => [x, yy + y, 0.046 + t * 2.094] as Vec3)),
          { closeV: true, capStart: true, capEnd: true },
        ),
        SMOOTH.moulded,
      ),
    )
    const foot = prism(roundedRect(0.3, 0.3, 0.05, 3), -0.02, 0.05)
    bevel(foot, BEVEL.carcass, 2)
    translate(foot, [0, y, 0])
    put(parts, 'cast', foot)
    // a cross-arm so the line has somewhere honest to land
    put(
      parts,
      "steel",
      smoothShade(
        tubeAlong(
          [
            [-0.22, y, 2.02],
            [0.22, y, 2.02],
          ],
          roundedRect(0.03, 0.026, 0.009, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (const x of [-0.16, 0.16]) {
    put(
      parts,
      "aluminum",
      smoothShade(
        tubeAlong(sag([x, -span / 2, 2.045], [x, span / 2, 2.045], 0.13, 10), circle(0.006, 5), { cap: false }),
        SMOOTH.turned,
      ),
    )
  }
  const slots = ['fabricRust', 'fabricBlue', 'fabricSand']
  const hung = rng.int(2, 3)
  for (let k = 0; k < hung; k++) {
    const t = (k + 0.7) / (hung + 0.4)
    const y = -span / 2 + t * span
    // A garment hangs ON one of the two lines (x = ±0.16) and its fold closes
    // over the line's own sagged height — `sag()` drops 0.13·4t(1−t) from
    // 2.045. Centred on x = 0 at 2.02 − droop it hung in the gap BETWEEN the
    // lines, 21 mm under both of them, attached to nothing.
    const lineX = k % 2 === 0 ? -0.16 : 0.16
    const droop = 0.13 * 4 * t * (1 - t) + 0.014
    const rings: Vec3[][] = []
    const w = rng.range(0.24, 0.36)
    for (let i = 0; i <= 7; i++) {
      const s = i / 7
      const yy = y - w / 2 + s * w
      const fold = Math.sin(s * 5.4 + k) * 0.012
      const drop = rng.range(0.34, 0.52)
      rings.push(
        (
          [
            [0.028 + fold, 0.012],
            [0.034 + fold, -0.03],
            [0.026 + fold, -drop],
            [-0.026 + fold, -drop],
            [-0.034 + fold, -0.03],
            [-0.028 + fold, 0.012],
          ] as Vec2[]
        ).map(([x, z]) => [x + lineX, yy, z + 2.055 - droop] as Vec3),
      )
    }
    put(
      parts,
      slots[rng.int(0, slots.length - 1)],
      smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell),
    )
  }
  return parts
}

function planterBarrel(rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const drum = revolve(
    [
      [0, 0],
      [0.34, 0],
      [0.35, 0.03],
      [0.37, 0.34],
      [0.37, 0.58],
      [0.355, 0.66],
      [0.36, 0.685],
      [0.335, 0.695],
      [0.33, 0.66],
      [0.34, 0.06],
      [0, 0.05],
    ],
    26,
    { smooth: SMOOTH.turned },
  )
  put(parts, 'cast', drum)
  for (const z of [0.2, 0.5]) {
    put(parts, "steelEdge", annularPrism(circle(0.388, 26), circle(0.372, 26), z - 0.028, z + 0.028, 0.006, 1))
  }
  const soil = revolve(
    [
      [0, 0.63],
      [0.325, 0.625],
      [0.325, 0.61],
      [0, 0.6],
    ],
    22,
    { smooth: SMOOTH.turned },
  )
  put(parts, 'soil', soil)
  const stems = rng.int(5, 9)
  for (let k = 0; k < stems; k++) {
    const a = rng.range(0, Math.PI * 2)
    const radius = rng.range(0.04, 0.26)
    const lean = rng.range(0.1, 0.26)
    const tall = rng.range(0.26, 0.6)
    const blade: Vec3[] = []
    for (let s = 0; s <= 5; s++) {
      const t = s / 5
      blade.push([
        Math.cos(a) * (radius + lean * t * t),
        Math.sin(a) * (radius + lean * t * t),
        0.634 + tall * t - 0.08 * t * t,
      ])
    }
    put(
      parts,
      'growBar',
      smoothShade(tubeAlong(blade, roundedRect(0.032, 0.01, 0.004, 2), { cap: true }), SMOOTH.moulded),
    )
  }
  return parts
}

function handCart(): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const deck = prism(roundedRect(0.72, 1.12, 0.06, 3), 0.338, 0.4)
  bevel(deck, BEVEL.frame, 2)
  put(parts, 'deck', smoothShade(deck, SMOOTH.moulded))
  const frame = roundedRect(0.76, 1.16, 0.06, 3)
  put(parts, "steel", annularPrism(frame, polyOffset(frame, -0.055), 0.29, 0.336, 0.008, 1))
  for (const sx of [-1, 1]) {
    const tyre = revolve(
      [
        [0.09, -0.035],
        [0.155, -0.03],
        [0.163, 0],
        [0.155, 0.03],
        [0.09, 0.035],
        [0.082, 0.024],
        [0.082, -0.024],
      ],
      18,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    translate(tyre, [sx * 0.4, -0.18, 0.163])
    put(parts, 'dark', tyre)
    const hub = revolve(
      [
        [0, 0],
        [0.05, 0],
        [0.05, 0.05],
        [0, 0.05],
      ],
      12,
      { axis: 'x', smooth: SMOOTH.turned },
    )
    translate(hub, [sx * 0.38 - (sx > 0 ? 0 : 0.05), -0.18, 0.163])
    put(parts, 'steelEdge', hub)
  }
  // a leg at the front, so the cart stands nose-down like a parked barrow
  for (const sx of [-1, 1]) {
    put(
      parts,
      'steel',
      smoothShade(
        tubeAlong(
          [
            [sx * 0.3, 0.5, 0.33],
            [sx * 0.31, 0.54, 0.02],
          ],
          roundedRect(0.04, 0.04, 0.012, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  const handle = tubeAlong(
    [
      [-0.3, -0.5, 0.42],
      [-0.3, -0.78, 0.72],
      [-0.16, -0.9, 0.86],
      [0.16, -0.9, 0.86],
      [0.3, -0.78, 0.72],
      [0.3, -0.5, 0.42],
    ],
    roundedRect(0.038, 0.034, 0.012, 2),
    { cap: true },
  )
  put(parts, 'orange', smoothShade(handle, SMOOTH.turned))
  return parts
}

// ------------------------------------------------------ common hab extras

/** Festoon: two catenary runs of tiny lamps over the Common Hab's porch. */
function festoon(unit: HabUnitContract, shellY: number): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const hw = unit.deckHalfWidth
  const front = unit.deckFront
  // The porch's own railing posts top out at HAB_FLOOR_Z + 1.048 (`habUnit`'s
  // `postTop`), so the string's front ends used to tie to nothing 0.57 m above
  // the post heads — and the 6.2 m cross run then sagged to 0.82 m over the
  // deck, straight across the step opening. Two masts spliced onto the front
  // corner posts carry it, and the sag is capped so no run crosses head height.
  const postX = hw - 0.145
  const tieY = front - 0.17
  const MAST_TOP = HAB_FLOOR_Z + 2.62
  const TIE_Z = HAB_FLOOR_Z + 2.54
  for (const sx of [-1, 1]) {
    put(
      parts,
      // The porch posts' own slot, so the 0.43 m splice welds instead of
      // clashing.
      'orange',
      smoothShade(
        tubeAlong(
          [
            [sx * postX, tieY, HAB_FLOOR_Z + 0.62],
            [sx * postX, tieY, MAST_TOP],
          ],
          roundedRect(0.042, 0.042, 0.012, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  // The two back runs die INTO the shell, 5 mm inside its skin. `shellY` is
  // the door sill's face and the barrel has already leaned back in by the time
  // it reaches z = HAB_FLOOR_Z + 2.1: the section there is
  // `WAIST_Y − (WAIST_Y − SIDE_TOP_Y)·t^1.7` at t = 0.892, i.e. 2.642 × 1.2 =
  // 3.171, which is `shellY + 0.325`. At + 0.42 both wires started 95 mm off
  // the wall, tied to nothing at all.
  const backTie = shellY + 0.32
  const anchors: Array<[Vec3, Vec3]> = [
    [
      [-postX, backTie, HAB_FLOOR_Z + 2.1],
      [-postX, tieY, TIE_Z],
    ],
    [
      [postX, backTie, HAB_FLOOR_Z + 2.1],
      [postX, tieY, TIE_Z],
    ],
    [
      [-postX, tieY, TIE_Z],
      [postX, tieY, TIE_Z],
    ],
  ]
  for (const [a, b] of anchors) {
    // Capped: an unbounded 0.12-per-metre sag is fine for a 2 m run and puts a
    // 6 m run through the walkway.
    const drop = Math.min(0.34, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12 + 0.06)
    const path = sag(a, b, drop, 14)
    put(parts, 'dark', smoothShade(tubeAlong(path, circle(0.007, 5), { cap: false }), SMOOTH.turned))
    const lamps = Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.58))
    for (let k = 1; k < lamps; k++) {
      const t = k / lamps
      const p = sag(a, b, drop, 200)[Math.round(t * 200)]
      const socket = revolve(
        [
          [0, 0],
          [0.016, -0.006],
          [0.016, -0.038],
          [0.011, -0.044],
          [0, -0.046],
        ],
        8,
        { smooth: SMOOTH.turned },
      )
      translate(socket, p)
      put(parts, 'dark', socket)
      const bulb = revolve(
        [
          [0, -0.042],
          [0.02, -0.056],
          [0.024, -0.078],
          [0.016, -0.098],
          [0, -0.104],
        ],
        10,
        { smooth: SMOOTH.turned },
      )
      translate(bulb, p)
      put(parts, 'utilityLight', bulb)
    }
  }
  return parts
}

/** Notice board + boot rack: the two things a shared porch always grows. */
function commonPorchFittings(unit: HabUnitContract, shellY: number, rng: Rng): SlotParts {
  const parts: Record<string, MeshData[]> = {}
  const bx = -unit.deckHalfWidth + 1.15
  /**
   * The board's back plane. `shellY` is the DOOR SILL's face (`deckBack`), and
   * the barrel bulges 0.52 m further out than that by the time it reaches this
   * board's own height: at sill + 0.29…0.33 every part of the board, its frame
   * and all six notices were 40…110 mm INSIDE the skin. A free-standing board
   * on the deck has to clear the widest section — the belt rail, which is what
   * `shellHalf[2]` is — by a real gap.
   */
  const back = unit.shellHalf[2] + 0.06
  const cz = HAB_FLOOR_Z + 1.18
  // notice board on two legs. The legs stand BEHIND the board's back plane;
  // centred in its 40 mm thickness they ran through it and out of its face.
  for (const sx of [-1, 1]) {
    put(
      parts,
      'aluminum',
      smoothShade(
        tubeAlong(
          [
            [bx + sx * 0.5, back - 0.025, HAB_FLOOR_Z],
            [bx + sx * 0.5, back - 0.025, HAB_FLOOR_Z + 1.72],
          ],
          roundedRect(0.05, 0.05, 0.014, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  const board = prismXZ(
    [
      [bx - 0.58, HAB_FLOOR_Z + 0.72],
      [bx + 0.58, HAB_FLOOR_Z + 0.72],
      [bx + 0.58, HAB_FLOOR_Z + 1.64],
      [bx - 0.58, HAB_FLOOR_Z + 1.64],
    ],
    back,
    back + 0.04,
  )
  put(parts, 'dark', board)
  // Picture-frame surround: four members lying ON the board's face, lapping its
  // edge by 24 mm. It was an `annularPrism`, which builds its ring in XY and
  // extrudes along Z — in this frame (+Y out of the porch, +Z up) that laid the
  // whole surround FLAT, 3.1 m up in the air over the deck.
  for (const [x0, z0, x1, z1] of [
    [bx - 0.606, cz - 0.486, bx + 0.606, cz - 0.436],
    [bx - 0.606, cz + 0.436, bx + 0.606, cz + 0.486],
    [bx - 0.606, cz - 0.436, bx - 0.556, cz + 0.436],
    [bx + 0.556, cz - 0.436, bx + 0.606, cz + 0.436],
  ] as const) {
    put(
      parts,
      'steelEdge',
      prismXZ(
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
        back + 0.04,
        back + 0.058,
      ),
    )
  }
  // pinned notices, in FRONT of the board on a coarse grid so two can never
  // land on the same square. The row jitter is ±0.025, not ±0.04: rows are
  // 0.28 apart and a note is up to 0.22 tall, so ±0.04 let two notes in one
  // column overlap by 20 mm — with their faces on one plane.
  for (let k = 0; k < 6; k++) {
    const w = rng.range(0.13, 0.19)
    const h = rng.range(0.15, 0.22)
    const px = bx - 0.36 + (k % 3) * 0.36 + rng.range(-0.05, 0.05)
    const pz = HAB_FLOOR_Z + (k < 3 ? 1.31 : 1.03) + rng.range(-0.025, 0.025)
    const note = prismXZ(
      [
        [px - w / 2, pz - h / 2],
        [px + w / 2, pz - h / 2],
        [px + w / 2, pz + h / 2],
        [px - w / 2, pz + h / 2],
      ],
      back + 0.042,
      back + 0.058,
    )
    put(parts, k === 2 ? 'orange' : 'steelEdge', note)
  }
  // boot rack: a low grid with three pairs stood on it
  const rx = unit.deckHalfWidth - 1.0
  for (const sy of [0, 1]) {
    const y = shellY + 0.34 + sy * 0.3
    put(
      parts,
      'dark',
      smoothShade(
        tubeAlong(
          [
            [rx - 0.62, y, HAB_FLOOR_Z + 0.13],
            [rx + 0.62, y, HAB_FLOOR_Z + 0.13],
          ],
          roundedRect(0.03, 0.026, 0.009, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (const sx of [-1, 1]) {
    put(
      parts,
      'dark',
      smoothShade(
        tubeAlong(
          [
            [rx + sx * 0.6, shellY + 0.3, HAB_FLOOR_Z + 0.005],
            [rx + sx * 0.6, shellY + 0.3, HAB_FLOOR_Z + 0.14],
            [rx + sx * 0.6, shellY + 0.68, HAB_FLOOR_Z + 0.14],
            [rx + sx * 0.6, shellY + 0.68, HAB_FLOOR_Z + 0.005],
          ],
          roundedRect(0.026, 0.026, 0.008, 2),
          { cap: true },
        ),
        SMOOTH.turned,
      ),
    )
  }
  for (let pair = 0; pair < 3; pair++) {
    for (const sx of [-1, 1]) {
      const px = rx - 0.4 + pair * 0.4 + sx * 0.095
      const boot: Vec3[] = [
        [px, shellY + 0.36, HAB_FLOOR_Z + 0.15],
        [px, shellY + 0.42, HAB_FLOOR_Z + 0.3],
        [px + sx * 0.01, shellY + 0.5, HAB_FLOOR_Z + 0.36],
      ]
      put(
        parts,
        pair === 1 ? 'orange' : 'dark',
        smoothShade(
          tubeAlong(boot, roundedRect(0.1, 0.09, 0.028, 3), {
            cap: true,
            scale: [
              [1, 1],
              [0.92, 0.92],
              [0.8, 0.8],
            ],
          }),
          SMOOTH.shell,
        ),
      )
    }
  }
  return parts
}

// -------------------------------------------------------------- the build

/**
 * The Residential Arc. Ten units on one building line, each with its porch,
 * its jack feet levelled to the ground it actually stands on, its personal
 * touch, its lit or dark windows, and a set-pad walk linking it to the row.
 */
export function buildResidential(services: DistrictServices): void {
  const rng = services.rng.fork('residential-arc')
  const frames = habFrames()

  for (const frame of frames) {
    placeHab(services, frame, rng)
  }
  placeBetweenHabs(services, frames, rng)
  placeWalks(services, frames, rng)
  services.group.add(habPlateMesh(frames))
}

function placeHab(services: DistrictServices, frame: HabFrame, rng: Rng): void {
  const { writer } = services
  const { unit, center, yaw } = frame
  const key = frame.common ? 'common' : 'dwelling'
  writeSoups(writer, UNITS.get(key)!.soups, center, yaw)

  const world = (x: number, y: number, z: number): Vector3 => habLocalToWorld(center, yaw, x, y, z)
  const dropAt = (x: number, y: number): number => {
    const p = world(x, y, 0)
    return frame.ground - interiorHeight(p.x, p.z)
  }

  // ---- ground contact: jacks, deck piers, the precast step block. Each is
  // built against ITS OWN sampled grade, which is what jacks are for.
  for (const [jx, jy] of unit.jacks) {
    writeParts(writer, buildJackFoot(dropAt(jx, jy)), world(jx, jy, 0), yaw)
  }
  for (const [px, py] of unit.piers) {
    writeParts(writer, buildPier(dropAt(px, py), HAB_FLOOR_Z - 0.2), world(px, py, 0), yaw)
  }
  const stepDrop = dropAt(0, unit.deckFront + 0.35)
  writeParts(writer, buildStepBlock(stepDrop, unit.deckFront, unit.stepHalfWidth), center, yaw)

  // ---- windows. Which are lit is the whole dusk read of the arc; the mix of
  // curtain colour and drawn/parted is what stops ten copies reading as ten
  // copies (`design.md`: one personal touch per porch, and the light is one).
  const litRng = rng.fork(`hab-light-${frame.index}`)
  unit.panes.forEach((pane, index) => {
    const lit = frame.common || litRng.float() < (pane.side > 0 ? 0.78 : 0.45)
    const parts: Record<string, MeshData[]> = {}
    const quad = (off: number, u0: number, u1: number, v0: number, v1: number): Vec3[] => [
      pane.at(u0, v0, off),
      pane.at(u1, v0, off),
      pane.at(u1, v1, off),
      pane.at(u0, v1, off),
    ]
    const slab = (u0: number, u1: number, v0: number, v1: number, offA: number, offB: number): MeshData =>
      loft([quad(offA, u0, u1, v0, v1), quad(offB, u0, u1, v0, v1)], {
        closeV: true,
        capStart: true,
        capEnd: true,
      })
    // Everything sits INSIDE the reveal, in layers with real gaps: glass at
    // 30-50 mm, mullions proud of it at 12-26, curtains behind at 58-70. The
    // jamb is at u/v = 0 and 1 exactly, so nothing may reach it.
    const uIn = Math.min(0.02, 0.008 / pane.width)
    const vIn = Math.min(0.03, 0.008 / pane.height)
    put(
      parts,
      lit ? 'interiorGlow' : 'darkGlass',
      smoothShade(slab(uIn, 1 - uIn, vIn, 1 - vIn, -0.03, -0.05), SMOOTH.top),
    )
    const lights = pane.width > 2 ? 3 : 2
    for (let k = 1; k < lights; k++) {
      const u = k / lights
      put(parts, 'dark', slab(u - 0.012, u + 0.012, vIn, 1 - vIn, -0.012, -0.026))
    }
    put(parts, 'dark', slab(uIn, 1 - uIn, vIn, vIn + 0.05, -0.012, -0.026))
    if (lit && litRng.float() < 0.55) {
      const fabricSlot = litRng.pick(['fabricRust', 'fabricBlue', 'fabricSand'])
      const wide = litRng.float() < 0.4
      for (const [u0, u1] of wide
        ? ([[0.04, 0.96]] as Array<[number, number]>)
        : ([
            [0.04, 0.3],
            [0.7, 0.96],
          ] as Array<[number, number]>)) {
        const rings: Vec3[][] = []
        const steps = wide ? 9 : 5
        for (let i = 0; i <= steps; i++) {
          const u = u0 + ((u1 - u0) * i) / steps
          const fold = Math.sin(i * 2.1 + index) * 0.008
          rings.push([
            pane.at(u, 0.04, -0.058 + fold),
            pane.at(u, 0.96, -0.058 + fold),
            pane.at(u, 0.96, -0.07 + fold),
            pane.at(u, 0.04, -0.07 + fold),
          ])
        }
        put(parts, fabricSlot, smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.shell))
      }
    }
    writeParts(writer, parts, center, yaw)
  })

  // ---- porch chair (every porch has one; three of them are sittable)
  const chairSlot = ['fabricRust', 'fabricBlue', 'fabricSand'][frame.index % 3]
  const chairYaw = yaw + (frame.index % 2 === 0 ? Math.PI * 0.82 : Math.PI * 1.18)
  const chairAt = world(unit.chairAt[0], unit.chairAt[1], HAB_FLOOR_Z)
  writeSoups(writer, chairSoups(chairSlot), chairAt, chairYaw)
  if (frame.index === 1 || frame.index === 3 || frame.index === 8) {
    services.seats.push({
      seat: chairAt.clone().setY(chairAt.y + CHAIR_SEAT_Z),
      yaw: chairYaw,
      label: 'Sit on the porch',
    })
  }

  // ---- one personal touch per porch
  const touch = TOUCHES[frame.index % TOUCHES.length]
  const touchRng = rng.fork(`touch-${frame.index}`)
  const touchYaw = yaw + touchRng.range(-0.5, 0.5)
  if (touch === 'jacket') {
    // over the chair back, in the CHAIR's frame — a jacket on a chair only
    // reads if it is hung on the actual rail
    writeParts(
      writer,
      touchJacket(touchRng, chairSlot === 'fabricRust' ? 'fabricBlue' : 'fabricRust'),
      habLocalToWorld(chairAt, chairYaw, 0, 0.248, 0.86),
      chairYaw,
    )
  } else {
    const at = world(unit.touchAt[0], unit.touchAt[1], HAB_FLOOR_Z)
    const parts =
      touch === 'plant'
        ? touchPlant(touchRng)
        : touch === 'dumbbells'
          ? touchDumbbells(touchRng)
          : touch === 'guitar'
            ? touchGuitar()
            : touch === 'trike'
              ? touchTrike()
              : touch === 'telescope'
                ? touchTelescope()
                : touch === 'toolbag'
                  ? touchToolbag(touchRng)
                  : touchDryRack()
    writeParts(writer, parts, at, touchYaw)
  }

  // ---- Common Hab: the social one, visibly
  if (frame.common) {
    writeParts(writer, festoon(unit, unit.deckBack), center, yaw)
    writeParts(writer, commonPorchFittings(unit, unit.deckBack, rng.fork('common-porch')), center, yaw)
  }

  addHabColliders(services, frame)
}

function addHabColliders(services: DistrictServices, frame: HabFrame): void {
  const { unit, center, yaw, ground } = frame
  const [halfLength, , halfDepth] = unit.shellHalf
  const world = (x: number, y: number, z: number): Vector3 => habLocalToWorld(center, yaw, x, y, z)
  const push = (spec: ColliderSpec): void => {
    services.colliders.push(spec)
  }

  if (!frame.common) {
    push({
      kind: 'box',
      center: center.clone().setY(ground + 2.0),
      size: new Vector3(halfLength * 2, 3.2, halfDepth * 2),
      yaw,
    })
  } else {
    // the Common Hab is entered: walls, with the door bay left open
    const wallH = 3.0
    const inner = halfDepth - 0.16
    push({
      kind: 'box',
      center: world(0, -inner, 0).setY(ground + wallH / 2 + 0.5),
      size: new Vector3(halfLength * 2, wallH, 0.32),
      yaw,
    })
    for (const sx of [-1, 1]) {
      push({
        kind: 'box',
        center: world(sx * (halfLength - 0.16), 0, 0).setY(ground + wallH / 2 + 0.5),
        size: new Vector3(0.32, wallH, halfDepth * 2),
        yaw,
      })
    }
    const doorHalf = (frame.spec.door.x1 - frame.spec.door.x0) / 2 + 0.1
    const runLength = halfLength - doorHalf
    for (const sx of [-1, 1]) {
      push({
        kind: 'box',
        center: world(sx * (doorHalf + runLength / 2), inner, 0).setY(ground + wallH / 2 + 0.5),
        size: new Vector3(runLength, wallH, 0.32),
        yaw,
      })
    }
  }

  // porch deck: walkable, so the collider top IS the deck top
  const deckDepth = unit.deckFront - unit.deckBack
  push({
    kind: 'box',
    center: world(0, (unit.deckBack + unit.deckFront) / 2, 0).setY(ground + HAB_FLOOR_Z - 0.25),
    size: new Vector3(unit.deckHalfWidth * 2, 0.5, deckDepth),
    yaw,
  })
  // step block: two treads, both inside the controller's 0.42 m autostep
  for (const [k, front] of [
    [1, unit.deckFront + 0.5],
    [2, unit.deckFront + 0.17],
  ] as const) {
    push({
      kind: 'box',
      center: world(0, front, 0).setY(ground + (k * HAB_FLOOR_Z) / 3 - 0.25),
      size: new Vector3(unit.stepHalfWidth * 2, 0.5, 0.36),
      yaw,
    })
  }
  // railings
  const rail = unit.deckHalfWidth - 0.145
  for (const sx of [-1, 1]) {
    push({
      kind: 'box',
      center: world(sx * rail, (unit.deckBack + unit.deckFront) / 2, 0).setY(ground + HAB_FLOOR_Z + 0.55),
      size: new Vector3(0.12, 1.1, deckDepth - 0.4),
      yaw,
    })
  }
  const gap = unit.stepHalfWidth + 0.1
  const frontRun = unit.deckHalfWidth - 0.145 - gap
  for (const sx of [-1, 1]) {
    push({
      kind: 'box',
      center: world(sx * (gap + frontRun / 2), unit.deckFront - 0.16, 0).setY(ground + HAB_FLOOR_Z + 0.55),
      size: new Vector3(frontRun, 1.1, 0.12),
      yaw,
    })
  }
}

// ------------------------------------------------------ the street itself

/**
 * The lived-in rhythm between the units. Every gap gets something, but never
 * the same thing twice running — a uniform march of planters reads as
 * "sprinkled", which is the exact failure `experience-craft.md` §2.3 names.
 */
function placeBetweenHabs(services: DistrictServices, frames: HabFrame[], rng: Rng): void {
  const { writer } = services
  const gapRng = rng.fork('between-habs')
  const sites = habSites()
  const kinds: Array<'line' | 'planter' | 'cart' | 'pair'> = [
    'planter',
    'line',
    'planter',
    'cart',
    'line',
    'planter',
    'pair',
    'line',
    'planter',
  ]
  for (let i = 0; i < frames.length - 1; i++) {
    const bearing = (sites[i].angle + sites[i + 1].angle) / 2
    const kind = kinds[i % kinds.length]
    const yaw = Math.atan2(-Math.cos(bearing), -Math.sin(bearing))
    const place = (radius: number, parts: SlotParts, spin: number): void => {
      const x = Math.cos(bearing) * radius
      const z = Math.sin(bearing) * radius
      writeParts(writer, parts, new Vector3(x, interiorHeight(x, z), z), yaw + spin)
    }
    if (kind === 'line') {
      place(84.4 + gapRng.range(-0.6, 0.6), clothesline(gapRng), gapRng.range(-0.12, 0.12))
    } else if (kind === 'planter') {
      place(81.2 + gapRng.range(-0.8, 0.8), planterBarrel(gapRng), gapRng.range(0, Math.PI))
    } else if (kind === 'cart') {
      place(82.6 + gapRng.range(-0.5, 0.5), handCart(), gapRng.range(-0.6, 0.6))
    } else {
      place(80.9 + gapRng.range(-0.4, 0.4), planterBarrel(gapRng), gapRng.range(0, Math.PI))
      place(83.9 + gapRng.range(-0.5, 0.5), clothesline(gapRng), gapRng.range(-0.1, 0.1))
    }
  }
}

/**
 * Set-pad walks: one along the row in front of the porches, a spur from each
 * porch's step block, and a connector that threads between habs 0 and 1 to
 * meet the `residential-lane`'s turning head behind the row. Pads are 45 mm
 * proud of their own local grade and jittered, so the run reads worn rather
 * than laid.
 */
function placeWalks(services: DistrictServices, frames: HabFrame[], rng: Rng): void {
  const { writer } = services
  const walkRng = rng.fork('desire-lines')
  const pad = (x: number, z: number, yaw: number, w: number, d: number): void => {
    const ground = interiorHeight(x, z)
    const md = prism(roundedRect(w, d, 0.09, 3), -0.03, 0.045)
    bevel(md, BEVEL.carcass, 2)
    writeSoups(writer, toSoups({ cast: [cleanMesh(md)] }), new Vector3(x, ground, z), yaw)
  }
  const sites = habSites()
  const a0 = sites[0].angle
  const a9 = sites[sites.length - 1].angle

  // the row walk
  const arcLength = WALK_RADIUS * (a9 - a0 + 0.16)
  const rowSteps = Math.round(arcLength / 0.98)
  for (let k = 0; k <= rowSteps; k++) {
    const angle = a0 - 0.08 + ((a9 - a0 + 0.16) * k) / rowSteps
    const radius = WALK_RADIUS + walkRng.range(-0.28, 0.28)
    pad(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      Math.atan2(-Math.cos(angle), -Math.sin(angle)) + walkRng.range(-0.16, 0.16),
      0.66,
      0.5,
    )
  }
  // A spur from every porch, stopping ONE PAD short of the row walk: run it
  // all the way in and the last spur pad lands on top of a row pad, which is
  // 1.5 m2 of same-facing cast on cast.
  for (const frame of frames) {
    // 1.06 off the deck front, not 0.85. The precast step block runs from
    // `deckFront + 0.01` to `+ 0.69` (`buildStepBlock`), a pad is 0.48 deep and
    // the ±0.2 rad set jitter swings its near corner 0.297 back from its own
    // centre — so the first pad of every spur was landing 90…150 mm inside the
    // block, with the row's own 45 mm nosing buried in precast.
    const start = habLocalToWorld(frame.center, frame.yaw, 0, frame.unit.deckFront + 1.06, 0)
    const startR = Math.hypot(start.x, start.z)
    const bearing = Math.atan2(start.z, start.x)
    const endR = WALK_RADIUS + 0.95
    if (startR < endR + 0.9) continue
    const steps = Math.max(2, Math.round((startR - endR) / 0.9))
    for (let k = 0; k <= steps; k++) {
      const radius = startR + ((endR - startR) * k) / steps
      const drift = walkRng.range(-0.22, 0.22)
      pad(
        Math.cos(bearing) * radius + Math.sin(bearing) * drift,
        Math.sin(bearing) * radius - Math.cos(bearing) * drift,
        frame.yaw + walkRng.range(-0.2, 0.2),
        0.62,
        0.48,
      )
    }
  }
  // the connector out to the lane's turning head, threading the 2.9 m gap
  // between habs 0 and 1 (see the file header for why the lane ends there)
  const gapBearing = (sites[0].angle + sites[1].angle) / 2
  const link: Array<[number, number]> = []
  const linkStart = WALK_RADIUS + 0.95
  for (let k = 0; k <= 12; k++) {
    const t = k / 12
    const radius = linkStart + t * (88.6 - linkStart)
    link.push([Math.cos(gapBearing) * radius, Math.sin(gapBearing) * radius])
  }
  const head: [number, number] = [-86, -26]
  // `tail` is read ONCE, before the run. Re-reading `link[length − 1]` inside
  // the loop made each step interpolate from the pad just pushed, so the four
  // steps came out 0.250, 0.375, 0.281 and 0.094 of the distance to the head:
  // the last two pads landed 0.48 m apart and overlapped by most of their
  // 0.60 x 0.46 footprint.
  const tail = link[link.length - 1]
  for (let k = 1; k <= 4; k++) {
    const t = k / 4
    link.push([tail[0] + (head[0] - tail[0]) * t, tail[1] + (head[1] - tail[1]) * t])
  }
  for (let k = 0; k < link.length; k++) {
    const [x, z] = link[k]
    const next = link[Math.min(link.length - 1, k + 1)]
    const prev = link[Math.max(0, k - 1)]
    pad(x, z, Math.atan2(next[0] - prev[0], next[1] - prev[1]) + walkRng.range(-0.12, 0.12), 0.6, 0.46)
  }
}
