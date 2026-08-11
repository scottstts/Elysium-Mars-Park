import { Vector2, Vector3 } from 'three'
import type { PartWriter } from './writer'
import { writeParkBench } from './kitBench'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  bevel,
  circle,
  cleanMesh,
  hollowPrism,
  loft,
  prism,
  revolve,
  rotX,
  rotY,
  roundedRect,
  smoothShade,
  toTriangles,
  translate,
  tubeAlong,
  type SlotParts,
  type Vec2,
  type Vec3,
} from './meshdata'
import './auditHook'

/**
 * NASA-punk part builders. Everything is engineered: load paths read, joints
 * meet flush, rails are code-height, treads are code-rise. All builders write
 * into a shared PartWriter so a whole assembly lands as a handful of merged
 * meshes. Distances in meters.
 *
 * Parts still authored as chamfered boxes here are the ones queued for the
 * rebuild; anything with a silhouette should be drawn as a profile in
 * `archkit/meshdata.ts` and written in with `writeInto()`. `bench()` is the
 * worked example — see `archkit/kitBench.ts`.
 *
 * Repeated street furniture goes through `bakeParts()` / `placeParts()`: the
 * object is authored ONCE (profiles, lofts, lathes) and every placement only
 * transforms a cached triangle soup, so sixty lamp posts cost sixty matrix
 * loops instead of sixty rebuilds. Same trick `kitBench.ts` uses.
 */

// ------------------------------------------------------------- part caching

export interface PartSoup {
  slot: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
}

/** Triangulate a builder's slot map once. Parts stay separate (own smooth angle). */
export function bakeParts(parts: SlotParts): PartSoup[] {
  const soups: PartSoup[] = []
  for (const [slot, value] of Object.entries(parts)) {
    if (!value) continue
    for (const md of Array.isArray(value) ? value : [value]) {
      if (!md) continue
      const t = toTriangles(cleanMesh(md))
      if (t.positions.length === 0) continue
      soups.push({
        slot,
        positions: Float32Array.from(t.positions),
        normals: Float32Array.from(t.normals),
        uvs: Float32Array.from(t.uvs),
      })
    }
  }
  return soups
}

/** Place a baked object: yaw about +Y with +Z forward, then translate. */
export function placeParts(writer: PartWriter, soups: PartSoup[], center: Vector3, yaw = 0): void {
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
}

/** Triangle count of a baked object — the density report reads this. */
export function partsTriangles(soups: PartSoup[]): number {
  let total = 0
  for (const s of soups) total += s.positions.length / 9
  return total
}

/**
 * Transform a baked local point (Z-up authoring frame, `[x, y, z]`) into the
 * world by the same yaw+translate `placeParts` applies. Lens positions,
 * banner anchors and sign faces all come back through this.
 */
export function placedPoint(local: Vec3, center: Vector3, yaw: number): Vector3 {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // authored Z-up -> world: (x, y, z) becomes (x, z_up, y_forward)
  const x = local[0]
  const forward = local[1]
  const up = local[2]
  return new Vector3(
    center.x + x * cos + forward * sin,
    center.y + up,
    center.z - x * sin + forward * cos,
  )
}

// -------------------------------------------------------- profile utilities

/**
 * Sweep a closed `(r, z)` section around the Z axis over an ARC as a closed
 * solid. `revolve()` deliberately leaves an arc open (its caps close the
 * profile ends onto the axis); this closes the two arc ends instead, which is
 * what an inspection hatch, a wrapped bezel or a curved cover plate needs.
 */
export function arcSweep(profile: Vec2[], a0: number, a1: number, segments = 10): MeshData {
  const rings: Vec3[][] = []
  for (let s = 0; s <= segments; s++) {
    const a = a0 + ((a1 - a0) * s) / segments
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    rings.push(profile.map(([r, z]) => [r * ca, r * sa, z] as Vec3))
  }
  return loft(rings, { closeV: true, capStart: true, capEnd: true })
}

/** Closed ring of section `(radial, z)` swept round a circle — bands, collars. */
export function ringBand(radius: number, centerZ: number, section: Vec2[], segments = 20): MeshData {
  const path: Vec3[] = []
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2
    path.push([Math.cos(a) * radius, Math.sin(a) * radius, centerZ])
  }
  return tubeAlong(path, section, { closePath: true, up: [0, 0, 1] })
}

/**
 * A rounded rect inset by `d`, built by shrinking the RECT — never by
 * `polyOffset`. Offsetting a rounded rect by more than its corner radius folds
 * the corner arcs back through themselves, and the fold shows up as coplanar
 * same-facing cap triangles: a silent z-fight generator in every hollow shell
 * and recessed lens in the kit. Same vertex count, same semantic corners, so
 * it still pairs with `hollowPrism` / `annularPrism`.
 */
export function insetRect(w: number, h: number, r: number, seg: number, d: number): Vec2[] {
  return roundedRect(Math.max(0.004, w - 2 * d), Math.max(0.004, h - 2 * d), Math.max(0.002, r - d), seg)
}

// ------------------------------------------------------------------ railing

/** Top rail: 75 x 55, flat palm face, chamfered arrises, a drip groove under. */
const RAIL_TOP: Vec2[] = [
  [-0.0375, 0.0275],
  [0.0375, 0.0275],
  [0.0375, 0.007],
  [0.0285, -0.0075],
  [0.0285, -0.0195],
  [0.0375, -0.0235],
  [0.0295, -0.0275],
  [-0.0295, -0.0275],
  [-0.0375, -0.0235],
  [-0.0285, -0.0195],
  [-0.0285, -0.0075],
  [-0.0375, 0.007],
]

/** Toe board: 140 tall with a rolled top lip, riding clear of the base shoes. */
const RAIL_KICK: Vec2[] = [
  [-0.0175, -0.07],
  [0.0175, -0.07],
  [0.0175, 0.052],
  [0.0295, 0.062],
  [0.0295, 0.07],
  [0.0155, 0.07],
  [0.0155, 0.062],
  [-0.0175, 0.056],
]

/**
 * Half the post's along-run dimension plus a 3 mm shadow gap: every rail bay
 * stops just short of the post face rather than on it. Flush is forbidden
 * (geometry-craft §3), and a coplanar pair between two material slots is
 * exactly what the clash gate exists to catch.
 */
const POST_HALF = 0.0355

/**
 * Guardrail run along a polyline. Rebuilt from sections: a tapered stanchion
 * lofted from a rounded-rect, a cast base shoe whose cup swallows the post
 * foot, and three swept rails.
 *
 * The rails are emitted **bay by bay between the post faces** rather than as
 * one continuous sweep. That is the dome gridshell rule applied to a railing
 * (`posts continuous -> rails stop at post faces`): a continuous rail threads
 * through every post, which is a cross-material interpenetration at every
 * stanchion; a bay terminates ON the post face, which is a butt joint.
 * Rail heights and the 1.5 m post pitch are unchanged from the box version.
 */
export function guardrail(writer: PartWriter, path: Vector3[], options?: { postEvery?: number }): void {
  const postEvery = options?.postEvery ?? 1.5
  const soups = guardrailPost()
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const segment = new Vector3().subVectors(b, a)
    const length = segment.length()
    if (length < 0.05) continue
    const direction = segment.clone().normalize()
    const yaw = Math.atan2(direction.x, direction.z)
    const posts = Math.max(1, Math.round(length / postEvery))

    const bay = (from: number, to: number, height: number, section: Vec2[], slot: string): void => {
      if (to - from < 0.02) return
      const p0 = a.clone().addScaledVector(direction, from).setY(a.y + (b.y - a.y) * (from / length) + height)
      const p1 = a.clone().addScaledVector(direction, to).setY(a.y + (b.y - a.y) * (to / length) + height)
      writer.tube({
        path: [p0, p1],
        radius: 0,
        slot,
        profile: section.map(([x, y]) => new Vector2(x, y)),
        smoothAngle: SMOOTH.moulded,
      })
    }

    for (let p = 0; p < posts; p++) {
      const from = (length * p) / posts + POST_HALF
      const to = (length * (p + 1)) / posts - POST_HALF
      bay(from, to, 1.08, RAIL_TOP, 'orangeTop')
      bay(from, to, 0.58, roundedRect(0.05, 0.04, 0.009, 2), 'orange')
      // Toe board bottom at 0.075 — clear of the shoe rim (0.062), so the
      // only thing it ever touches is the post faces it butts.
      bay(from, to, 0.145, RAIL_KICK, 'dark')
    }

    for (let p = 0; p <= posts; p++) {
      if (i > 0 && p === 0) continue // shared corner post already written
      const position = a.clone().lerp(b, p / posts)
      placeParts(writer, soups, position, yaw)
    }
  }
}

let GUARDRAIL_POST: PartSoup[] | null = null

/**
 * One stanchion: a lofted taper (65 mm at the shoe to 48 mm under the rail),
 * a cast shoe whose cup swallows the post foot, and four bolt domes. The post
 * is drawn +Z up in the run's local frame (+Z forward along the rail).
 */
function guardrailPost(): PartSoup[] {
  if (GUARDRAIL_POST) return GUARDRAIL_POST
  const steel: MeshData[] = []
  const edge: MeshData[] = []

  // Post foot sits 3 mm above the shoe's cup floor and 6.5 mm inside its bore:
  // a socketed joint with a reveal on every face. Landing the cap EXACTLY on
  // the floor is worse than it sounds — the clash test's edge/triangle
  // intersection is numerically ambiguous right on a shared plane, and two
  // material slots meeting flush is a defect by the craft rules anyway.
  const rings: Vec3[][] = []
  for (const [t, half, r] of [
    [0.033, 0.0325, 0.006],
    [0.24, 0.0305, 0.006],
    [0.86, 0.026, 0.005],
    [1.115, 0.024, 0.005],
  ] as const) {
    rings.push(roundedRect(half * 2, half * 2, r, 2).map(([x, y]) => [x, y, t] as Vec3))
  }
  steel.push(smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.moulded))

  // Cast shoe: outer skirt up and in, over the rim, then DOWN into a cup the
  // post foot seats in — a real socket, never a post resting on a pad.
  edge.push(
    revolve(
      [
        [0, 0],
        [0.082, 0],
        [0.086, 0.008],
        [0.082, 0.018],
        [0.06, 0.05],
        [0.056, 0.062],
        [0.05, 0.056],
        [0.05, 0.03],
        [0, 0.03],
      ],
      18,
      { smooth: SMOOTH.cast },
    ),
  )
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const bolt = revolve(
        [
          [0, 0],
          [0.0085, 0.0018],
          [0.0078, 0.005],
          [0, 0.0058],
        ],
        10,
        { smooth: SMOOTH.tight },
      )
      // Seated 1 mm into the skirt cone at r = 0.0495 — bury and cap.
      translate(bolt, [sx * 0.0495, sy * 0.0495, 0.0344])
      edge.push(bolt)
    }
  }
  GUARDRAIL_POST = bakeParts({ orange: steel, steelEdge: edge })
  return GUARDRAIL_POST
}

/**
 * Tubular handrail (42 mm) on cast stanchions, for the short paving steps
 * along the promenade and the plaza approaches. Ends turn down onto their
 * post so nothing terminates in a raw cut.
 */
export function handrail(
  writer: PartWriter,
  path: Vector3[],
  options?: { height?: number; postEvery?: number },
): void {
  const height = options?.height ?? 1.02
  const postEvery = options?.postEvery ?? 1.55
  const soups = handrailPost()
  // ONE continuous rail over the whole polyline (per-segment rails put a
  // pair of returns at every interior joint — a broken run of separate
  // sticks), with returns only at the genuinely free ends.
  railRun(
    writer,
    path.map((p) => p.clone().setY(p.y + height)),
    { radius: 0.021 },
  )
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const length = a.distanceTo(b)
    if (length < 0.05) continue
    const posts = Math.max(1, Math.round(length / postEvery))
    for (let p = 0; p <= posts; p++) {
      if (i > 0 && p === 0) continue // shared joint post already written
      const position = a.clone().lerp(b, p / posts)
      placeParts(writer, soups, position, 0)
      // Stanchion foot lands on the shoe's cup floor (0.04); its head stops
      // under the rail soffit — never tube-in-tube.
      railPost(writer, position, position.y + height, { slot: 'orangeTop' })
    }
  }
}

let HANDRAIL_POST: PartSoup[] | null = null

function handrailPost(): PartSoup[] {
  if (HANDRAIL_POST) return HANDRAIL_POST
  const shoe = revolve(
    [
      [0, 0],
      [0.058, 0],
      [0.062, 0.007],
      [0.058, 0.015],
      [0.032, 0.09],
      [0.026, 0.115],
      [0.0195, 0.115],
      [0.0195, 0.04],
      [0, 0.04],
    ],
    16,
    { smooth: SMOOTH.cast },
  )
  HANDRAIL_POST = bakeParts({ steelEdge: shoe })
  return HANDRAIL_POST
}

// ---------------------------------------------------------------- railRun --

export interface RailRunOpts {
  /** Tube radius (42 mm rail by default). */
  radius?: number
  slot?: string
  /** Fillet radius at interior corners of the axis polyline. */
  cornerRadius?: number
  /** 'return' curls each free end outward and down; 'cap' just caps it. */
  ends?: 'return' | 'cap'
  /** How far a return hangs below the rail axis. */
  returnDrop?: number
}

/**
 * Round a polyline's interior corners with quadratic-bezier fillets, so a
 * swept tube shows smooth elbows instead of pinched polyline kinks. The
 * tangent take-off distance is clamped to 44 % of each adjacent edge, so
 * fillets never eat past a short segment's midpoint.
 */
export function filletPath(points: Vector3[], radius = 0.085, seg = 5): Vector3[] {
  if (points.length < 3) return points.map((p) => p.clone())
  const out: Vector3[] = [points[0].clone()]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const ab = new Vector3().subVectors(b, a)
    const bc = new Vector3().subVectors(c, b)
    const l1 = ab.length()
    const l2 = bc.length()
    if (l1 < 1e-6 || l2 < 1e-6) continue
    ab.divideScalar(l1)
    bc.divideScalar(l2)
    if (ab.dot(bc) > 0.9995) {
      out.push(b.clone())
      continue
    }
    const take = Math.min(radius, 0.44 * l1, 0.44 * l2)
    const t1 = b.clone().addScaledVector(ab, -take)
    const t2 = b.clone().addScaledVector(bc, take)
    for (let k = 0; k <= seg; k++) {
      const t = k / seg
      out.push(
        new Vector3()
          .addScaledVector(t1, (1 - t) * (1 - t))
          .addScaledVector(b, 2 * (1 - t) * t)
          .addScaledVector(t2, t * t),
      )
    }
  }
  out.push(points[points.length - 1].clone())
  return out
}

/**
 * THE rail tube — every handrail run in the park is this one builder, so a
 * rail is well-made in exactly one place. `axis` is the rail's centreline at
 * rail height; corners may be sharp (filleted here), ends get real returns
 * (curl outward-and-down, capped tip) unless 'cap' is asked for. Sweeping is
 * `tubeAlong`, whose rotation-minimising frames keep the tube twist-free
 * through any curl.
 */
export function railRun(writer: PartWriter, axis: Vector3[], opts: RailRunOpts = {}): void {
  if (axis.length < 2) return
  const radius = opts.radius ?? 0.021
  const path = axis.map((p) => p.clone())
  if ((opts.ends ?? 'return') === 'return') {
    const drop = opts.returnDrop ?? 0.14
    const curl = (end: Vector3, inner: Vector3): Vector3[] | null => {
      const t = new Vector3().subVectors(end, inner)
      t.y = 0
      if (t.lengthSq() < 1e-8) return null
      t.normalize()
      const elbow = end.clone().addScaledVector(t, 0.06)
      return [elbow.clone().setY(elbow.y - drop), elbow]
    }
    const head = curl(path[0], path[1])
    if (head) path.unshift(head[0], head[1])
    const tail = curl(path[path.length - 1], path[path.length - 2])
    if (tail) path.push(tail[1], tail[0])
  }
  writer.tube({
    path: filletPath(path, opts.cornerRadius ?? 0.085, 5),
    radius,
    slot: opts.slot ?? 'orangeTop',
    radialSegments: 12,
    capStart: true,
    capEnd: true,
  })
}

/**
 * A rail stanchion under a `railRun`: capped tube from the foot to 4 mm under
 * the rail's soffit (the guardrail shoe's shadow gap — never tube-in-tube).
 */
export function railPost(
  writer: PartWriter,
  foot: Vector3,
  railY: number,
  opts: { radius?: number; slot?: string; railRadius?: number; buried?: boolean } = {},
): void {
  const railRadius = opts.railRadius ?? 0.021
  writer.tube({
    path: [
      foot.clone().setY(foot.y + (opts.buried ? -0.03 : 0.043)),
      foot.clone().setY(railY - railRadius - 0.004),
    ],
    radius: opts.radius ?? 0.0185,
    slot: opts.slot ?? 'orangeTop',
    radialSegments: 10,
    capStart: true,
    capEnd: true,
  })
}

export interface StairSpec {
  /** Bottom-center of the first riser. */
  origin: Vector3
  yaw: number
  steps: number
  width: number
  rise?: number
  run?: number
}

/** Straight flight: treads, risers, side stringers, twin handrails. */
export function stairFlight(writer: PartWriter, spec: StairSpec): { top: Vector3 } {
  const rise = spec.rise ?? 0.165
  const run = spec.run ?? 0.29
  const sin = Math.sin(spec.yaw)
  const cos = Math.cos(spec.yaw)
  const forward = new Vector3(sin, 0, cos)
  const side = new Vector3(cos, 0, -sin)

  for (let i = 0; i < spec.steps; i++) {
    const treadCenter = spec.origin
      .clone()
      .addScaledVector(forward, (i + 0.5) * run)
      .setY(spec.origin.y + (i + 1) * rise)
    // Tread (deck surface, worn edge chamfer) — nose overhangs 18 mm.
    writer.box({
      center: treadCenter.clone().setY(treadCenter.y - 0.018),
      size: new Vector3(spec.width, 0.036, run + 0.036),
      rotationY: spec.yaw,
      slot: 'deck',
      chamferSlot: 'steelEdge',
      chamfer: 0.012,
    })
    // Riser plate set back under the nose (no coplanar contact with tread).
    writer.box({
      center: spec.origin
        .clone()
        .addScaledVector(forward, i * run + 0.012)
        .setY(spec.origin.y + (i + 0.5) * rise),
      size: new Vector3(spec.width - 0.05, rise - 0.038, 0.022),
      rotationY: spec.yaw,
      slot: 'steel',
      chamfer: 0.006,
    })
  }

  // Stringers: sloped slabs flanking the flight.
  const total = new Vector3().addScaledVector(forward, spec.steps * run)
  for (const s of [-1, 1]) {
    const edge = spec.origin.clone().addScaledVector(side, (spec.width / 2 + 0.02) * s)
    const a = edge.clone().addScaledVector(forward, -0.05).setY(spec.origin.y + 0.02)
    const b = edge.clone().add(total).addScaledVector(forward, 0.05).setY(spec.origin.y + spec.steps * rise + 0.02)
    const thickness = 0.05
    const drop = 0.24
    writer.slab(
      s > 0
        ? [
            a.clone(),
            b.clone(),
            b.clone().setY(b.y - drop),
            a.clone().setY(a.y - drop),
          ]
        : [
            a.clone().setY(a.y - drop),
            b.clone().setY(b.y - drop),
            b.clone(),
            a.clone(),
          ],
      thickness,
      'steel',
    )
  }

  // Handrails following the slope — the canonical builder, so the sloped run
  // gets real returns at both free ends and balusters stop 4 mm under the
  // rail soffit instead of running to its axis.
  for (const s of [-1, 1]) {
    const bottom = spec.origin
      .clone()
      .addScaledVector(side, (spec.width / 2 - 0.06) * s)
    const top = bottom.clone().add(total).setY(bottom.y + spec.steps * rise)
    railRun(
      writer,
      [bottom.clone().setY(bottom.y + 1.02), top.clone().setY(top.y + 1.02)],
      { radius: 0.028 },
    )
    for (const t of [0.12, 0.5, 0.88]) {
      const foot = bottom.clone().lerp(top, t)
      railPost(writer, foot, foot.y + 1.02, {
        radius: 0.02,
        slot: 'orange',
        railRadius: 0.028,
        buried: true,
      })
    }
  }

  return { top: spec.origin.clone().add(total).setY(spec.origin.y + spec.steps * rise) }
}

/**
 * Park bench — cast ISRU end frames, extruded slats, real fasteners.
 * Built by `archkit/kitBench.ts` from profiles; the signature and the seat
 * contract are unchanged from the box version it replaces, so every existing
 * placement (plaza ring, path amenities, station platform, lounges, porches)
 * picks it up without an edit.
 */
export function bench(writer: PartWriter, center: Vector3, yaw: number): { seat: Vector3; yaw: number } {
  return writeParkBench(writer, center, yaw)
}

// --------------------------------------------------------------- lamp posts

export interface LampOptions {
  /** Pole height to the head mount (m). Boulevard 4.6, path 3.6, deck 3.2. */
  height?: number
  /** 1 = head on the pole crown, 2 = twin heads on bracket arms. */
  heads?: 1 | 2
  /** Twin-head arm reach from the pole axis. */
  reach?: number
  /** Yaw of the fixture: the arm axis (and the banner arm) points +X at 0. */
  yaw?: number
  /** Banner arms on the +X side (boulevard poles carry district banners). */
  banner?: boolean
}

export interface LampResult {
  /** Emissive lens centres — register these as a glow pool. */
  lenses: Vector3[]
  /** Pole crown, for anything hung off the top. */
  top: Vector3
  /**
   * Banner hanging frame: the two arm tips, the outward (arm) direction and
   * the cloth width back toward the pole. The cloth is sleeved over both arms,
   * so it is held along its top AND bottom edges — the real fixing.
   */
  banner: { top: Vector3; bottom: Vector3; outward: Vector3; width: number } | null
}

/**
 * The park luminaire (ref image: slender white poles, clean twin heads).
 *
 * Assembly, in the order a fitter would: cast shoe with a cup that swallows
 * the pole foot -> lofted tapering pole -> bolted inspection hatch -> bracket
 * arm(s) -> luminaire body as ONE hollow shell with a rolled rim, so its lens
 * sits in a real 30 mm recess behind a real bezel -> heat fins buried 20 mm
 * into the body top -> `utilityLight` lens plate. Optional banner arms with a
 * diagonal stay, top and bottom rods.
 *
 * Everything that penetrates (arm root into the pole, hatch into the pole,
 * fins into the body) is buried inside a part of the SAME material slot, which
 * is the "bury and cap" joint from geometry-craft §5.2 — no coplanar faces and
 * no cross-slot interpenetration anywhere in the fixture.
 */
export function lampPost(writer: PartWriter, base: Vector3, options?: LampOptions): LampResult {
  const height = options?.height ?? 3.6
  const heads = options?.heads ?? 1
  const reach = options?.reach ?? 0.66
  const yaw = options?.yaw ?? 0
  const banner = options?.banner ?? false
  const key = `${height.toFixed(2)}|${heads}|${reach.toFixed(2)}|${banner ? 1 : 0}`
  let baked = LAMP_CACHE.get(key)
  if (!baked) {
    baked = buildLamp(height, heads, reach, banner)
    LAMP_CACHE.set(key, baked)
  }
  placeParts(writer, baked.soups, base, yaw)
  return {
    lenses: baked.lenses.map((p) => placedPoint(p, base, yaw)),
    top: placedPoint([0, 0, height], base, yaw),
    banner: baked.banner
      ? {
          top: placedPoint(baked.banner.top, base, yaw),
          bottom: placedPoint(baked.banner.bottom, base, yaw),
          outward: new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
          width: baked.banner.width,
        }
      : null,
  }
}

interface BakedLamp {
  soups: PartSoup[]
  lenses: Vec3[]
  banner: { top: Vec3; bottom: Vec3; width: number } | null
}

const LAMP_CACHE = new Map<string, BakedLamp>()

/** Pole radius law: a slight entasis, fat at the shoe, slender at the crown. */
function poleRadius(t: number, height: number): number {
  void height
  return 0.086 - 0.034 * Math.pow(t, 0.82)
}

/**
 * The whole fixture above the shoe is ONE material slot on purpose: pole,
 * hatch, bracket arm, luminaire body, fins and screws all read as the same
 * white painted alloy (the reference image's columns), and that lets every
 * junction be a BURIED joint instead of a cross-material interpenetration the
 * clash gate would (correctly) flag. Only the lens and the cast shoe differ,
 * and both meet the body as clean butts or clear recesses.
 */
function buildLamp(height: number, heads: 1 | 2, reach: number, banner: boolean): BakedLamp {
  const white: MeshData[] = []
  const cast: MeshData[] = []
  const lens: MeshData[] = []
  const lenses: Vec3[] = []
  const SIDES = 16
  const body = white

  // ---- cast shoe: skirt, rim, and a cup the pole foot seats in.
  cast.push(
    revolve(
      [
        [0, 0],
        [0.185, 0],
        [0.191, 0.011],
        [0.185, 0.024],
        [0.124, 0.062],
        [0.112, 0.082],
        [0.108, 0.104],
        [0.099, 0.116],
        [0.0925, 0.108],
        [0.0925, 0.082],
        [0, 0.082],
      ],
      22,
      { smooth: SMOOTH.cast },
    ),
  )
  // Four hold-down bolt domes on the skirt shoulder.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2
    const bolt = revolve(
      [
        [0, 0],
        [0.0105, 0.0022],
        [0.0096, 0.0062],
        [0, 0.0072],
      ],
      10,
      { smooth: SMOOTH.tight },
    )
    // Seated 1 mm into the skirt cone — the dome caps its own buried foot.
    translate(bolt, [Math.cos(a) * 0.152, Math.sin(a) * 0.152, 0.0436])
    cast.push(bolt)
  }

  // ---- pole: lofted taper, seated 0 mm above the cup floor (0.082).
  // Foot 3 mm above the shoe's cup floor (0.082): a socket with a reveal.
  const stations = [0.085, 0.35, 1.2, height * 0.62, height - 0.18, height]
  const rings = stations.map((z) => {
    const t = Math.max(0, (z - 0.085) / Math.max(0.001, height - 0.085))
    return circle(poleRadius(t, height), SIDES, 0, 0, Math.PI / SIDES).map(
      ([x, y]) => [x, y, z] as Vec3,
    )
  })
  white.push(smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.turned))

  // ---- inspection hatch: a curved plate sunk 20 mm into the pole and
  // standing 4 mm proud, with two fixings. Faces −X (away from the road).
  const hatchR = poleRadius((0.62 - 0.082) / (height - 0.082), height)
  const hatch = arcSweep(
    [
      [hatchR - 0.02, 0.36],
      [hatchR + 0.004, 0.374],
      [hatchR + 0.004, 0.856],
      [hatchR - 0.02, 0.87],
    ],
    Math.PI - 0.62,
    Math.PI + 0.62,
    8,
  )
  white.push(smoothShade(hatch, SMOOTH.moulded))
  for (const z of [0.42, 0.81]) {
    const screw = revolve(
      [
        [0, 0],
        [0.0072, 0.0015],
        [0.0064, 0.0042],
        [0, 0.0048],
      ],
      10,
      { smooth: SMOOTH.tight },
    )
    rotY(screw, -Math.PI / 2) // lathe axis +Z -> −X, facing off the hatch
    translate(screw, [-(hatchR + 0.002), 0, z])
    white.push(screw)
  }

  // ---- luminaire: one hollow shell, cavity opening DOWN, lens in the recess.
  const outline = roundedRect(0.46, 0.205, 0.062, 3)
  const makeHead = (x: number, z: number): void => {
    const shell = hollowLuminaire(outline)
    translate(shell, [x, 0, z])
    body.push(shell)
    // Heat fins, buried 22 mm into the body top.
    for (let f = 0; f < 5; f++) {
      const fx = x - 0.16 + f * 0.08
      const fin = bevel(
        prism(
          roundedRect(0.022, 0.172, 0.006, 2).map(([px, py]) => [px + fx, py] as Vec2),
          z - 0.02,
          z + 0.05,
        ),
        BEVEL.hardware,
        1,
      )
      body.push(fin)
    }
    // Lens plate INSIDE the recess. The body occupies z−0.075 … z, its cavity
    // floor is at z−0.034 and its bezel rim at z−0.075, so the lens sits 6 mm
    // below the floor and 25 mm behind the rim: a real recess, never a decal.
    const plate = bevel(
      prism(
        insetRect(0.46, 0.205, 0.062, 3, 0.078).map(([px, py]) => [px + x, py] as Vec2),
        z - 0.05,
        z - 0.04,
      ),
      BEVEL.hardware,
      1,
    )
    lens.push(plate)
    lenses.push([x, 0, z - 0.05])
  }

  if (heads === 2) {
    for (const sx of [-1, 1]) {
      // Bracket arm: rises off the pole, sweeps out, lands level at the head.
      const arm = tubeAlong(
        [
          [sx * 0.02, 0, height - 0.46],
          [sx * (reach * 0.34), 0, height - 0.1],
          [sx * (reach * 0.78), 0, height + 0.055],
          [sx * reach, 0, height + 0.062],
        ],
        roundedRect(0.05, 0.062, 0.014, 2),
        { up: [0, 0, 1] },
      )
      white.push(smoothShade(arm, SMOOTH.moulded))
      makeHead(sx * reach, height + 0.028)
    }
    // Crown cap over the pole top.
    const cap = revolve(
      [
        [0, 0],
        [poleRadius(1, height) + 0.006, 0],
        [poleRadius(1, height) + 0.006, 0.022],
        [poleRadius(1, height) * 0.72, 0.052],
        [0, 0.062],
      ],
      SIDES,
      { smooth: SMOOTH.turned },
    )
    translate(cap, [0, 0, height - 0.01])
    white.push(cap)
  } else {
    // Single head: a spigot collar carries the body off the crown. The body
    // is set high enough that its 50 mm lens recess clears the collar
    // entirely — the collar then buries 20 mm INTO the casting above it.
    const collar = revolve(
      [
        [0, 0],
        [poleRadius(1, height) + 0.01, 0],
        [poleRadius(1, height) + 0.01, 0.03],
        [0.05, 0.062],
        [0.05, 0.09],
        [0, 0.09],
      ],
      SIDES,
      { smooth: SMOOTH.turned },
    )
    translate(collar, [0, 0, height - 0.02])
    white.push(collar)
    makeHead(0, height + 0.125)
  }

  // ---- banner arms: top arm with a diagonal stay, bottom arm, both rodded.
  let bannerFrame: { top: Vec3; bottom: Vec3; width: number } | null = null
  if (banner) {
    const armZ = [height - 1.05, height - 2.55]
    const armReach = 0.92
    for (let i = 0; i < 2; i++) {
      const z = armZ[i]
      const t = (z - 0.082) / (height - 0.082)
      const root = poleRadius(t, height) - 0.012
      const arm = tubeAlong(
        [
          [root, 0, z],
          [armReach, 0, z],
        ],
        roundedRect(0.036, 0.046, 0.01, 2),
        { up: [0, 0, 1] },
      )
      white.push(smoothShade(arm, SMOOTH.moulded))
      // Turned end knob so the sleeve cannot ride off the arm.
      const knob = revolve(
        [
          [0, 0],
          [0.026, 0.004],
          [0.026, 0.02],
          [0.014, 0.03],
          [0, 0.032],
        ],
        10,
        { smooth: SMOOTH.turned },
      )
      rotY(knob, Math.PI / 2)
      translate(knob, [armReach - 0.004, 0, z])
      white.push(knob)
    }
    // Diagonal stay ABOVE the top arm — the part that says "this carries
    // load". Under it, the stay threads straight through the banner cloth.
    const stayRootZ = armZ[0] + 0.36
    const stayRoot = poleRadius((stayRootZ - 0.085) / (height - 0.085), height) - 0.01
    white.push(
      smoothShade(
        tubeAlong(
          [
            [stayRoot, 0, stayRootZ],
            [armReach - 0.16, 0, armZ[0] + 0.022],
          ],
          roundedRect(0.024, 0.03, 0.007, 2),
          { up: [0, 0, 1] },
        ),
        SMOOTH.moulded,
      ),
    )
    bannerFrame = {
      top: [armReach - 0.03, 0, armZ[0]],
      bottom: [armReach - 0.03, 0, armZ[1]],
      width: armReach - 0.03 - 0.11,
    }
  }

  return {
    soups: bakeParts({ steel: white, steelEdge: cast, utilityLight: lens }),
    lenses,
    banner: bannerFrame,
  }
}

/**
 * The luminaire body: authored cavity-up as one hollow shell (rolled rim, no
 * false cavity floor), then rolled 180° so the recess opens downward at the
 * origin plane. Body top ends up 75 mm above the mount point.
 */
function hollowLuminaire(outline: Vec2[]): MeshData {
  // Body 0..75 mm with the cavity sunk to 34 mm and a 9 mm rolled rim — one
  // closed shell, exactly what a boolean would give. Rolled over so the
  // recess opens downward and the body sits above the mount plane.
  // Cavity outline is authored, not offset: its corner radius has to stay
  // comfortably larger than the rim bevel or hollowPrism's own inset folds.
  const shell = hollowPrism(outline, 0, 0.075, roundedRect(0.35, 0.095, 0.026, 3), 0.034, 0.009)
  rotX(shell, Math.PI)
  return smoothShade(shell, SMOOTH.shell)
}

// -------------------------------------------------------------- bollards

export interface BollardOptions {
  /** 1.0 m fixed cast bollard, or the shorter removable pattern. */
  removable?: boolean
  yaw?: number
}

/**
 * Plaza / boulevard bollard. Fixed: a lathed cast column with a machined
 * groove carrying a retroreflective band and a domed cap. Removable: the same
 * column standing in a flanged ground socket with a padlock lug — the version
 * a service vehicle route needs, and the detail that says this park is run.
 */
export function bollard(writer: PartWriter, base: Vector3, options?: BollardOptions): void {
  const removable = options?.removable ?? false
  const key = removable ? 'removable' : 'fixed'
  let soups = BOLLARD_CACHE.get(key)
  if (!soups) {
    soups = buildBollard(removable)
    BOLLARD_CACHE.set(key, soups)
  }
  placeParts(writer, soups, base, options?.yaw ?? 0)
}

const BOLLARD_CACHE = new Map<string, PartSoup[]>()

function buildBollard(removable: boolean): PartSoup[] {
  const white: MeshData[] = []
  const bright: MeshData[] = []
  const dark: MeshData[] = []
  const top = removable ? 0.92 : 1.0

  // Removable: a PLAIN shaft dropped 60 mm into the collar (the fixed
  // variant's base flare would foul the 110 mm socket bore) — the socket
  // visibly RECEIVES the column. It used to start 55 mm in the air above
  // its own socket (prop-audit finding).
  const base: Vec2[] = removable
    ? [
        [0, -0.06],
        [0.093, -0.06],
      ]
    : [
        [0, 0],
        [0.104, 0],
        [0.108, 0.01],
        [0.104, 0.022],
        [0.093, 0.075],
      ]
  const column: Vec2[] = [
    ...base,
    // machined groove for the reflective band
    [0.093, top - 0.31],
    [0.083, top - 0.298],
    [0.083, top - 0.242],
    [0.093, top - 0.23],
    [0.093, top - 0.086],
    [0.086, top - 0.042],
    [0.062, top - 0.012],
    [0.03, top - 0.001],
    [0, top],
  ]
  white.push(revolve(column, 20, { smooth: SMOOTH.turned }))

  // Reflective band seated in the groove: proud of the groove floor, still
  // 4 mm inside the shaft line, so it can never z-fight the column.
  bright.push(
    ringBand(
      0.089,
      top - 0.27,
      [
        [-0.0026, -0.026],
        [0.0026, -0.026],
        [0.0026, 0.026],
        [-0.0026, 0.026],
      ],
      20,
    ),
  )

  if (removable) {
    // Ground socket: a flanged collar recessed into the paving, its bore 6 mm
    // clear of the column all round. Swept as a closed ring section — a lathed
    // open profile would leave the section's own ends unjoined.
    dark.push(
      smoothShade(
        ringBand(
          0.141,
          0,
          [
            [-0.031, -0.09],
            [0.031, -0.09],
            [0.031, 0.008],
            [0.025, 0.02],
            [-0.025, 0.02],
            [-0.031, 0.008],
          ],
          22,
        ),
        SMOOTH.cast,
      ),
    )
    // Padlock lug standing off the socket flange.
    const lug = bevel(prism(roundedRect(0.016, 0.052, 0.005, 2), 0.02, 0.064), BEVEL.hardware, 1)
    translate(lug, [0.152, 0, 0])
    dark.push(lug)
  }
  return bakeParts({ steel: white, aluminum: bright, dark })
}

/** Canopy on columns: slightly pitched roof plates with a fascia. */
export function canopy(
  writer: PartWriter,
  center: Vector3,
  width: number,
  depth: number,
  height: number,
): void {
  const columnInsetX = width / 2 - 0.6
  const columnInsetZ = depth / 2 - 0.5
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      if (sz === 0 && width < 18) continue
      const base = center.clone().add(new Vector3(columnInsetX * sx, 0, columnInsetZ * sz))
      writer.tube({
        path: [base, base.clone().setY(center.y + height - 0.18)],
        radius: 0.085,
        slot: 'steel',
        radialSegments: 14,
      })
      writer.box({
        center: base.clone().setY(base.y + 0.05),
        size: new Vector3(0.3, 0.1, 0.3),
        slot: 'steelEdge',
        chamfer: 0.012,
      })
    }
  }
  // Roof: two gently opposed pitches meeting at a center ridge beam.
  const ridgeY = center.y + height + 0.16
  const eaveY = center.y + height - 0.08
  const half = depth / 2
  writer.box({
    center: center.clone().setY(ridgeY - 0.02),
    size: new Vector3(width + 0.4, 0.16, 0.24),
    slot: 'steel',
    chamfer: 0.015,
  })
  for (const s of [-1, 1]) {
    const near = center.z + 0.09 * s
    const far = center.z + half * s
    writer.slab(
      s > 0
        ? [
            new Vector3(center.x - width / 2, ridgeY, near),
            new Vector3(center.x + width / 2, ridgeY, near),
            new Vector3(center.x + width / 2, eaveY, far),
            new Vector3(center.x - width / 2, eaveY, far),
          ]
        : [
            new Vector3(center.x - width / 2, eaveY, far),
            new Vector3(center.x + width / 2, eaveY, far),
            new Vector3(center.x + width / 2, ridgeY, near),
            new Vector3(center.x - width / 2, ridgeY, near),
          ],
      0.05,
      'steel',
      0.35,
    )
  }
  // Fascia line under the eaves.
  for (const s of [-1, 1]) {
    writer.box({
      center: center.clone().add(new Vector3(0, height - 0.14, (half - 0.02) * s)),
      size: new Vector3(width + 0.36, 0.14, 0.05),
      slot: 'dark',
      chamfer: 0.01,
    })
  }
}

/** Free-standing sign totem; the face plate is applied by the caller. */
export function signTotem(
  writer: PartWriter,
  base: Vector3,
  yaw: number,
  panel: { width: number; height: number; centerY: number },
): { faceCenter: Vector3; yaw: number; width: number; height: number } {
  writer.box({
    center: base.clone().setY(base.y + panel.centerY),
    size: new Vector3(panel.width + 0.12, panel.height + 0.6, 0.1),
    rotationY: yaw,
    slot: 'dark',
    chamfer: 0.016,
  })
  writer.box({
    center: base.clone().setY(base.y + 0.09),
    size: new Vector3(panel.width * 0.5, 0.18, 0.3),
    rotationY: yaw,
    slot: 'steelEdge',
    chamfer: 0.014,
  })
  const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  return {
    faceCenter: base.clone().setY(base.y + panel.centerY).addScaledVector(forward, 0.056),
    yaw,
    width: panel.width,
    height: panel.height,
  }
}

/** Spherical pressure tank on a saddle skirt (The Works, S8). */
export function pressureTank(writer: PartWriter, center: Vector3, radius: number): void {
  const profile: Vector2[] = []
  const rings = 18
  for (let i = 0; i <= rings; i++) {
    const angle = (i / rings) * Math.PI
    profile.push(new Vector2(Math.sin(angle) * radius, radius - Math.cos(angle) * radius))
  }
  writer.lathe({ center: center.clone().setY(center.y + radius * 0.35), profile, slot: 'aluminum', segments: 40 })
  writer.lathe({
    center,
    profile: [
      new Vector2(radius * 0.72, 0),
      new Vector2(radius * 0.78, 0.12),
      new Vector2(radius * 0.62, radius * 0.4),
    ],
    slot: 'dark',
    segments: 32,
  })
}

/**
 * The kit's placement convention, in one place: local `+X` right, `+Y` up,
 * `+Z` forward, yawed about world `+Y` and translated. `meshdata.placeYaw()`
 * applies the identical transform to a whole `MeshData`.
 */
export function offset(center: Vector3, yaw: number, x: number, y: number, z: number): Vector3 {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return new Vector3(center.x + x * cos + z * sin, center.y + y, center.z - x * sin + z * cos)
}
