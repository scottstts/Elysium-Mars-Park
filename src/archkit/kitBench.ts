/**
 * The park bench, built the way `dev_docs/craft/geometry-craft.md` §9 says to
 * build everything. It is the reference implementation for `meshdata.ts`:
 * read this before rebuilding an object.
 *
 * **Local frame: +X along the length, +Y toward the BACK, standing on z = 0**
 * — the Z-up authoring convention. `toYUp()` runs at emit, which maps the
 * authored +Y (back) onto world local +Z and authored +Z (up) onto world +Y,
 * exactly the frame `kit.bench()` has always placed into.
 *
 * 35 parts, ~3.2 k triangles, two material slots (`cast`, `aluminum`).
 * Versus the 8 chamfered boxes it replaces: a drawn cast side elevation
 * instead of a slab, inset end stations so the casting reads moulded, crowned
 * and relieved slats with a real underside, authored 8 mm slat gaps, a 10 mm
 * shadow gap between the slats and the cast land carried on real packers,
 * recessed foot pads giving a reveal at the ground, two cross stretchers
 * butting the frames' inner faces, and fourteen fastener domes.
 *
 * Joinery notes (the parts that matter for the audit):
 *  - The end-station inset is weighted **0 on the seat land and the foot
 *    bottoms**, so those two faces stay planar across the full 75 mm of the
 *    casting and the packers/pads butt them exactly. Everything else rolls in
 *    6 mm at the ends, which is where the moulded read comes from.
 *  - Every mating face here is a BUTT (coplanar, opposed) — an underside on a
 *    top. That is the `backtoback` class, which is safe: both parts are closed
 *    solids so the nearer face always wins. Nothing is coplanar same-facing,
 *    and nothing interpenetrates.
 */
import { Vector3 } from 'three'
import type { PartWriter } from './writer'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  bevel,
  ccw,
  cleanMesh,
  loft,
  polyOffset,
  prism,
  prismYZ,
  revolve,
  rotX,
  roundedRect,
  smoothShade,
  toTriangles,
  translate,
  tubeAlong,
  type SlotParts,
  type Vec2,
  type Vec3,
} from './meshdata'

/** overall length */
const L = 1.8
/** underside of the casting; the foot pads fill 0 .. FOOT_Z */
const FOOT_Z = 0.014
/** top of the cast seat land — flat across the full frame thickness */
const SEAT_LAND = 0.422
/** slats bed 10 mm above the land on packers, for a shadow line */
const PACKER_H = 0.01
/** ergonomic seat surface: 451 mm (contract range 430-460) */
export const BENCH_SEAT_Z = SEAT_LAND + PACKER_H + 0.0194
/** frame centre lines and thickness */
const FRAME_X = 0.76
const FRAME_T = 0.075
/** the two ends of the seat land, in the depth axis */
const LAND_FRONT = -0.232
const LAND_BACK = 0.118
/** the back stay's front face: through (LAND_BACK+0.032, 0.5), slope dy/dz */
const STAY_Y0 = 0.15
const STAY_Z0 = 0.5
const STAY_SLOPE = 0.055 / 0.345
const STAY_TILT = -Math.atan(STAY_SLOPE)

/**
 * The cast ISRU side elevation, drawn as a real (y, z) section: an "n" whose
 * void between the legs is open downward, so it stays a single simple loop and
 * never needs a boolean.
 */
const SILHOUETTE: Vec2[] = ccw([
  // front foot, then up the front edge of the leg
  [-0.243, FOOT_Z],
  [-0.243, FOOT_Z + 0.03],
  [-0.228, FOOT_Z + 0.062],
  [-0.219, 0.25],
  [-0.229, 0.372],
  // the seat land
  [LAND_FRONT, SEAT_LAND],
  [LAND_BACK, SEAT_LAND],
  // up the front face of the back stay, over the rolled top, back down
  [STAY_Y0, STAY_Z0],
  [0.205, 0.845],
  [0.222, 0.868],
  [0.262, 0.868],
  [0.276, 0.845],
  [0.238, STAY_Z0],
  // down the back edge of the rear leg to the rear foot
  [0.252, 0.24],
  [0.262, FOOT_Z + 0.062],
  [0.266, FOOT_Z + 0.03],
  [0.266, FOOT_Z],
  // and back along the inside: rear leg, seat-pan underside, front leg
  [0.188, FOOT_Z],
  [0.18, FOOT_Z + 0.062],
  [0.172, 0.25],
  [0.152, 0.36],
  [-0.132, 0.352],
  [-0.152, 0.25],
  [-0.162, FOOT_Z + 0.062],
  [-0.168, FOOT_Z],
])

/** Four seat slats, 76 mm wide on an 84 mm pitch — 8 mm authored gaps. */
const SLAT_W = 0.076
const SLAT_PITCH = 0.084
const SEAT_SLAT_Y = [0, 1, 2, 3].map(
  (i) => LAND_FRONT + (LAND_BACK - LAND_FRONT - (3 * SLAT_PITCH + SLAT_W)) / 2 + SLAT_W / 2 + i * SLAT_PITCH,
)
const BACK_SLAT_Z = [0.585, 0.685, 0.785]

/** Extruded seat slat: crowned top, relieved underside, arrised edges. */
function seatSlatSection(): Vec2[] {
  const h = SLAT_W / 2
  return [
    [-h, 0],
    [-h + 0.004, 0.0036],
    [-0.022, 0.0064],
    [0, 0.0074],
    [0.022, 0.0064],
    [h - 0.004, 0.0036],
    [h, 0],
    [h - 0.005, -0.0092],
    [0.022, -0.012],
    [-0.022, -0.012],
    [-h + 0.005, -0.0092],
  ]
}

/** Back slat: flat mounting face on the stay, crowned face toward the sitter. */
function backSlatSection(): Vec2[] {
  const h = SLAT_W / 2
  return [
    [0, -h + 0.002],
    [0, h - 0.002],
    [-0.004, h],
    [-0.014, h - 0.002],
    [-0.02, 0.024],
    [-0.022, 0],
    [-0.02, -0.024],
    [-0.014, -h + 0.002],
    [-0.004, -h],
  ]
}

/** A turned fastener dome — the detail that says "made". */
function fastenerDome(): MeshData {
  return revolve(
    [
      [0, 0],
      [0.0075, 0.0016],
      [0.0068, 0.0046],
      [0, 0.0052],
    ],
    12,
    { smooth: SMOOTH.tight },
  )
}

/**
 * One end frame. The inset end stations roll the outer 6 mm of the casting in
 * so the frame reads as a moulded part rather than a slab — except on the seat
 * land and the foot bottoms, which stay planar so their mating parts butt.
 */
function endFrame(sx: number): MeshData {
  const stations: [number, number][] = [
    [0, -0.006],
    [0.1, -0.0015],
    [0.9, -0.0015],
    [1, -0.006],
  ]
  const flat = (p: Vec2): boolean =>
    Math.abs(p[1] - FOOT_Z) < 1e-6 || Math.abs(p[1] - SEAT_LAND) < 1e-6
  const x0 = sx * FRAME_X - FRAME_T / 2
  const rings = stations.map(([t, inset]) => {
    const off = polyOffset(SILHOUETTE, inset)
    const x = x0 + FRAME_T * t
    return SILHOUETTE.map((p, i) => {
      const q = flat(p) ? p : off[i]
      return [x, q[0], q[1]] as Vec3
    })
  })
  const md = loft(rings, { closeV: true, capStart: true, capEnd: true })
  // 34 deg: the knee and the rolled stay top read round, the flats stay flat
  return smoothShade(md, SMOOTH.moulded)
}

/** Recessed foot pad: inset 8 mm all round, so a reveal runs at the ground. */
function footPad(cx: number, cy: number, depth: number): MeshData {
  const poly = roundedRect(FRAME_T - 0.016, depth - 0.016, 0.01, 3).map(
    ([x, y]) => [x + cx, y + cy] as Vec2,
  )
  return bevel(prism(poly, 0, FOOT_Z), BEVEL.panel, 1)
}

/** Packer under a slat: holds the 10 mm shadow gap open over the cast land. */
function packer(cx: number, cy: number): MeshData {
  const poly = roundedRect(0.058, 0.056, 0.008, 2).map(([x, y]) => [x + cx, y + cy] as Vec2)
  return bevel(prism(poly, SEAT_LAND, SEAT_LAND + PACKER_H), BEVEL.hardware, 1)
}

/** The stay's front face, as a function of height. */
function stayFaceY(z: number): number {
  return STAY_Y0 + STAY_SLOPE * (z - STAY_Z0)
}

/**
 * Build the bench in its local frame. Returns parts keyed by material slot
 * plus the seat contract, so the caller never guesses either.
 */
export function buildParkBench(): { parts: SlotParts; seat: Vec3 } {
  const cast: MeshData[] = []
  const metal: MeshData[] = []

  for (const sx of [-1, 1]) {
    cast.push(endFrame(sx))
    cast.push(footPad(sx * FRAME_X, -0.2055, 0.075))
    cast.push(footPad(sx * FRAME_X, 0.227, 0.078))
  }

  // Cross stretchers tie the two castings together at knee height; each end
  // stops 3 mm short of the frame's inner cap plane (a flush butt is the
  // audit's clash class — the reveal is the joint).
  for (const [y, z] of [
    [-0.1915, 0.14],
    [0.2176, 0.14],
  ]) {
    const rail = tubeAlong(
      [
        [-(FRAME_X - FRAME_T / 2 - 0.003), y, z],
        [FRAME_X - FRAME_T / 2 - 0.003, y, z],
      ],
      // profile is (across, up): 40 mm in the depth axis, 30 mm tall
      roundedRect(0.04, 0.03, 0.007, 2),
    )
    metal.push(smoothShade(rail, SMOOTH.moulded))
  }

  // Seat slats + their packers + the fastener domes over every crossing.
  const slatSec = seatSlatSection()
  const slatZ = SEAT_LAND + PACKER_H + 0.012
  for (const y of SEAT_SLAT_Y) {
    const sec = slatSec.map(([a, b]) => [y + a, slatZ + b] as Vec2)
    metal.push(smoothShade(prismYZ(sec, -L / 2 + 0.02, L / 2 - 0.02), 30))
    for (const sx of [-1, 1]) {
      cast.push(packer(sx * FRAME_X, y))
      const dome = fastenerDome()
      translate(dome, [sx * FRAME_X, y, slatZ + 0.0074])
      metal.push(dome)
    }
  }

  // Back slats bolted flat to the leaning stays, crowned face toward the sitter.
  const backSec = backSlatSection()
  for (const z of BACK_SLAT_Z) {
    const y = stayFaceY(z)
    const sec = backSec.map(([a, b]) => [y + a, z + b] as Vec2)
    const slat = prismYZ(sec, -L / 2 + 0.02, L / 2 - 0.02)
    rotX(slat, STAY_TILT, [0, y, z])
    metal.push(smoothShade(slat, 30))
    for (const sx of [-1, 1]) {
      const dome = fastenerDome()
      rotX(dome, Math.PI / 2)
      translate(dome, [sx * FRAME_X, y - 0.022, z])
      rotX(dome, STAY_TILT, [0, y, z])
      metal.push(dome)
    }
  }

  // Parts stay SEPARATE MeshData so each keeps its own smooth angle (a joined
  // soup would take one angle for the whole bench, and cleanMesh would be free
  // to weld vertices across a butt joint). PartWriter merges them anyway.
  const parts: SlotParts = {
    cast: cast.map((m) => cleanMesh(m)),
    aluminum: metal.map((m) => cleanMesh(m)),
  }
  // Seat contract: the slat-top surface, centred on the seat land.
  return { parts, seat: [0, (LAND_FRONT + LAND_BACK) / 2, BENCH_SEAT_Z] }
}

// ------------------------------------------------------------------ placement

interface BenchSoup {
  slot: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
}

/**
 * The bench is identical everywhere, so it is authored ONCE and each placement
 * only transforms a cached triangle soup — 40-odd benches would otherwise pay
 * for 40 rebuilds of the same 35 parts at boot.
 */
let CACHE: { soups: BenchSoup[]; seat: Vec3 } | null = null

function benchSoup(): { soups: BenchSoup[]; seat: Vec3 } {
  if (!CACHE) {
    const built = buildParkBench()
    const soups: BenchSoup[] = []
    for (const [slot, value] of Object.entries(built.parts)) {
      if (!value) continue
      for (const md of Array.isArray(value) ? value : [value]) {
        const t = toTriangles(md)
        if (t.positions.length === 0) continue
        soups.push({
          slot,
          positions: Float32Array.from(t.positions),
          normals: Float32Array.from(t.normals),
          uvs: Float32Array.from(t.uvs),
        })
      }
    }
    CACHE = { soups, seat: built.seat }
  }
  return CACHE
}

/**
 * Place a bench into a `PartWriter`, yaw about +Y with +Z forward (the frame
 * every other kit part uses). Returns the seat contract — the real slat-top
 * surface point and the facing — so callers never guess it.
 */
export function writeParkBench(
  writer: PartWriter,
  center: Vector3,
  yaw: number,
): { seat: Vector3; yaw: number } {
  const { soups, seat } = benchSoup()
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  for (const s of soups) {
    const p = new Float32Array(s.positions.length)
    const n = new Float32Array(s.normals.length)
    for (let i = 0; i < s.positions.length; i += 3) {
      const x = s.positions[i]
      const y = s.positions[i + 1]
      const z = s.positions[i + 2]
      p[i] = center.x + x * cos + z * sin
      p[i + 1] = center.y + y
      p[i + 2] = center.z - x * sin + z * cos
      const nx = s.normals[i]
      const nz = s.normals[i + 2]
      n[i] = nx * cos + nz * sin
      n[i + 1] = s.normals[i + 1]
      n[i + 2] = -nx * sin + nz * cos
    }
    writer.raw(s.slot, p, n, s.uvs)
  }
  // seat is authored Z-up: [x, back, up] -> world local [x, up, back]
  return {
    seat: new Vector3(
      center.x + seat[1] * sin,
      center.y + seat[2],
      center.z + seat[1] * cos,
    ),
    yaw,
  }
}
