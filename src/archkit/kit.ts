import { Vector2, Vector3 } from 'three'
import type { PartWriter } from './writer'

/**
 * NASA-punk part builders. Everything is engineered: load paths read, joints
 * meet flush, rails are code-height, treads are code-rise. All builders write
 * into a shared PartWriter so a whole assembly lands as a handful of merged
 * meshes. Distances in meters.
 */

/** Guardrail run along a polyline: posts, top rail, mid rail, kick plate. */
export function guardrail(writer: PartWriter, path: Vector3[], options?: { postEvery?: number }): void {
  const postEvery = options?.postEvery ?? 1.5
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const segment = new Vector3().subVectors(b, a)
    const length = segment.length()
    const direction = segment.clone().normalize()
    const yaw = Math.atan2(direction.x, direction.z)
    const mid = a.clone().add(b).multiplyScalar(0.5)

    // Top rail (polished by palms) + mid rail + kick plate.
    writer.box({
      center: mid.clone().setY((a.y + b.y) / 2 + 1.08),
      size: new Vector3(0.075, 0.055, length + 0.075),
      rotationY: yaw,
      slot: 'orangeTop',
      chamfer: 0.012,
    })
    writer.box({
      center: mid.clone().setY((a.y + b.y) / 2 + 0.58),
      size: new Vector3(0.05, 0.04, length + 0.05),
      rotationY: yaw,
      slot: 'orange',
      chamfer: 0.009,
    })
    writer.box({
      center: mid.clone().setY((a.y + b.y) / 2 + 0.07),
      size: new Vector3(0.035, 0.14, length + 0.035),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.008,
    })

    const posts = Math.max(1, Math.round(length / postEvery))
    for (let p = 0; p <= posts; p++) {
      if (i > 0 && p === 0) continue // shared corner post already written
      const t = p / posts
      const position = a.clone().lerp(b, t)
      writer.box({
        center: position.clone().setY(position.y + 0.55),
        size: new Vector3(0.055, 1.1, 0.055),
        rotationY: yaw,
        slot: 'orange',
        chamfer: 0.01,
      })
      // Base plate with visible bolts read (small chamfered pad).
      writer.box({
        center: position.clone().setY(position.y + 0.015),
        size: new Vector3(0.16, 0.03, 0.16),
        rotationY: yaw,
        slot: 'steelEdge',
        chamfer: 0.008,
      })
    }
  }
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

  // Handrails following the slope.
  for (const s of [-1, 1]) {
    const bottom = spec.origin
      .clone()
      .addScaledVector(side, (spec.width / 2 - 0.06) * s)
    const top = bottom.clone().add(total).setY(bottom.y + spec.steps * rise)
    const railPath = [
      bottom.clone().setY(bottom.y + 1.02),
      top.clone().setY(top.y + 1.02),
    ]
    writer.tube({ path: railPath, radius: 0.028, slot: 'orangeTop', radialSegments: 10 })
    for (const t of [0.12, 0.5, 0.88]) {
      const foot = bottom.clone().lerp(top, t)
      writer.tube({
        path: [foot.clone(), foot.clone().setY(foot.y + 1.02)],
        radius: 0.02,
        slot: 'orange',
        radialSegments: 8,
      })
    }
  }

  return { top: spec.origin.clone().add(total).setY(spec.origin.y + spec.steps * rise) }
}

/** Park bench: printed frame, aluminum slats with true gaps. */
export function bench(writer: PartWriter, center: Vector3, yaw: number): { seat: Vector3; yaw: number } {
  const width = 1.8
  for (const s of [-1, 1]) {
    writer.box({
      center: offset(center, yaw, (width / 2 - 0.12) * s, 0.21, 0),
      size: new Vector3(0.09, 0.42, 0.52),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.014,
    })
  }
  for (let slat = 0; slat < 4; slat++) {
    writer.box({
      center: offset(center, yaw, 0, 0.445, -0.19 + slat * 0.128),
      size: new Vector3(width, 0.032, 0.096),
      rotationY: yaw,
      slot: 'aluminum',
      chamfer: 0.008,
    })
  }
  // Low back: two slats on a slight recline.
  for (let slat = 0; slat < 2; slat++) {
    writer.box({
      center: offset(center, yaw, 0, 0.62 + slat * 0.14, 0.252 + slat * 0.028),
      size: new Vector3(width, 0.1, 0.03),
      rotationY: yaw,
      slot: 'aluminum',
      chamfer: 0.008,
    })
  }
  for (const s of [-1, 1]) {
    writer.box({
      center: offset(center, yaw, (width / 2 - 0.12) * s, 0.6, 0.245),
      size: new Vector3(0.07, 0.42, 0.05),
      rotationY: yaw,
      slot: 'dark',
      chamfer: 0.01,
    })
  }
  // Seat contract: the SURFACE point (slat tops), facing `yaw`.
  return { seat: offset(center, yaw, 0, 0.46, -0.02), yaw }
}

/** Unlit path luminaire: the park is daylit forever, fixtures are dressing. */
export function lampPost(writer: PartWriter, base: Vector3): void {
  writer.tube({
    path: [base.clone(), base.clone().setY(base.y + 3.0)],
    radius: 0.05,
    slot: 'dark',
    radialSegments: 12,
  })
  writer.box({
    center: base.clone().setY(base.y + 3.12),
    size: new Vector3(0.5, 0.1, 0.22),
    slot: 'aluminum',
    chamfer: 0.014,
  })
  writer.box({
    center: base.clone().setY(base.y + 3.055),
    size: new Vector3(0.42, 0.028, 0.16),
    slot: 'steel',
    chamfer: 0.006,
  })
  writer.box({
    center: base.clone().setY(base.y + 0.06),
    size: new Vector3(0.22, 0.12, 0.22),
    slot: 'steelEdge',
    chamfer: 0.014,
  })
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

function offset(center: Vector3, yaw: number, x: number, y: number, z: number): Vector3 {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return new Vector3(center.x + x * cos + z * sin, center.y + y, center.z - x * sin + z * cos)
}
