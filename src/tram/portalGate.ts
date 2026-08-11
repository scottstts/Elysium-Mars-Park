import { Group, Vector3 } from 'three'
import type { Material } from 'three'
import { SMOOTH, cleanMesh, loft, smoothShade, writeInto } from '../archkit/meshdata'
import type { Vec3 as MVec3 } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'

/**
 * The portal pressure gate: the powered closure that seals the connector
 * tube's bore at the dome wall and opens ahead of an approaching tram.
 *
 * HOST GEOMETRY (fixed contracts, owned elsewhere):
 *   - Bulkhead collar (dome/connectorTube.ts): revolved housing about the
 *     axis (x 0, y 4.6, z 128.4). Bore radius 5.9, drum outer 9.7,
 *     inboard face z 127.10, outboard face z 129.84.
 *   - Blade slot INSIDE the collar: z 128.10 → 128.70, reaching out to
 *     r 9.2 — every moving part lives in this pocket and retracts into it.
 *   - The tram passes through the bore on the axis, envelope r ≤ 3.2.
 *
 * MECHANISM — a TELESCOPING SEGMENT GATE. A plain iris cannot work here: any
 * rigid piece that covers the centre must retreat ≥ 5.9 m, and the pocket is
 * only 3.3 m deep. So each of six 64° sectors is TWO plates — an outer band
 * (r 3.00–6.15) and an inner wedge (r 0.05–3.24) nested 20 mm behind it —
 * and the inner telescopes over the outer as both retract:
 *
 *   travel(open) = 2.97 m outer → r 5.97–9.12;  5.93 m inner → r 5.95–9.17
 *
 * Everything clears the 5.9 bore at open and stays inside r 9.2. Sealing is
 * by Z-LAPS, never contact: sectors alternate between two plate levels per
 * stage (four bands through the slot, 20+ mm apart), adjacent sectors
 * overlap 4° of arc, the inner wedge laps the outer band's inner edge by
 * 0.24 m, and the six tips converge to a centimetre iris dot on the axis.
 * No two plates ever share a plane — the bands ARE the clearances.
 *
 * CONTRACT: `setOpen(t)` with t already eased, 0 sealed → 1 clear. Called
 * every fixed step; allocation-free (positions written into cached groups).
 */
export interface PortalGate {
  group: Group
  setOpen(open01: number): void
}

const AXIS_Y = 4.6
/** Plate stage geometry (radii in metres from the axis). The stack straddles
 *  the gate plane z = 128.4 inside the 128.10–128.70 slot. */
const OUTER_R0 = 3.0
const OUTER_R1 = 6.15
const INNER_R0 = 0.05
const INNER_R1 = 3.24
const HALF_ANGLE = (32 * Math.PI) / 180
const PLATE_HALF_T = 0.045
const OUTER_TRAVEL = 2.97
const INNER_TRAVEL = 5.93
/** Band centres through the slot (z): outer/inner per sector parity. */
const BAND_OUTER = [128.175, 128.415]
const BAND_INNER = [128.285, 128.525]

interface Mover {
  group: Group
  cos: number
  sin: number
  z: number
  travel: number
}

/** Closed 10-point sector outline at height z, chamfer-inset when `inset`. */
function sectorRing(r0: number, r1: number, inset: number, z: number): MVec3[] {
  const points: MVec3[] = []
  const aIn = HALF_ANGLE - inset / Math.max(0.2, r0)
  const aOut = HALF_ANGLE - inset / r1
  const rIn = r0 + inset
  const rOut = r1 - inset
  for (let i = 0; i <= 2; i++) {
    const a = -aIn + (2 * aIn * i) / 2
    points.push([Math.cos(a) * rIn, Math.sin(a) * rIn, z])
  }
  for (let i = 0; i <= 6; i++) {
    const a = aOut - (2 * aOut * i) / 6
    points.push([Math.cos(a) * rOut, Math.sin(a) * rOut, z])
  }
  return points
}

/** Chamfered sector plate, canonical frame: sector centred on +X, z across
 *  the thickness. Lofted like the guideway piers: levels of one closed ring. */
function emitSectorPlate(writer: PartWriter, slot: string, r0: number, r1: number): void {
  const ch = 0.014
  const md = loft(
    [
      sectorRing(r0, r1, ch, -PLATE_HALF_T),
      sectorRing(r0, r1, 0, -PLATE_HALF_T + ch),
      sectorRing(r0, r1, 0, PLATE_HALF_T - ch),
      sectorRing(r0, r1, ch, PLATE_HALF_T),
    ],
    { closeV: true, capStart: true, capEnd: true },
  )
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.moulded)
  cleanMesh(md)
  writeInto(writer, slot, md, { uvScale: 0.6 })
}

/** Thin raised strip on a plate face (canonical XY, z across): a lofted slab
 *  from (ax,ay) to (bx,by), `width` across, spanning z0→z1. */
function emitStrip(
  writer: PartWriter,
  slot: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  z0: number,
  z1: number,
): void {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy) || 1
  const nx = (-dy / length) * (width / 2)
  const ny = (dx / length) * (width / 2)
  const ring = (z: number): MVec3[] => [
    [ax + nx, ay + ny, z],
    [ax - nx, ay - ny, z],
    [bx - nx, by - ny, z],
    [bx + nx, by + ny, z],
  ]
  const md = loft([ring(z0), ring(z1)], { closeV: true, capStart: true, capEnd: true })
  md.frame = 'y-up'
  smoothShade(md, SMOOTH.moulded)
  cleanMesh(md)
  writeInto(writer, slot, md, { uvScale: 1 })
}

/**
 * One sector's OUTER band plate with its furniture: lap seals along both
 * side edges, two radial stiffening ribs on the exposed face, low-profile
 * guide shoes at the heel (≤8 mm proud — the inter-band gap is 20 mm), and
 * a pair of marker lenses on the exposed face.
 */
function buildOuterPlate(materials: Record<string, Material>, exposed: 1 | -1): Group {
  const writer = new PartWriter()
  emitSectorPlate(writer, 'steel', OUTER_R0, OUTER_R1)
  const face = exposed * PLATE_HALF_T
  const seamA = HALF_ANGLE - 0.035 / OUTER_R0
  for (const s of [-1, 1]) {
    emitStrip(
      writer,
      'dark',
      Math.cos(s * seamA) * (OUTER_R0 + 0.08),
      Math.sin(s * seamA) * (OUTER_R0 + 0.08),
      Math.cos(s * seamA) * (OUTER_R1 - 0.1),
      Math.sin(s * seamA) * (OUTER_R1 - 0.1),
      0.07,
      face - exposed * 0.004,
      face + exposed * 0.005,
    )
  }
  for (const s of [-1, 1]) {
    const a = s * 0.24
    emitStrip(
      writer,
      'steelEdge',
      Math.cos(a) * (OUTER_R0 + 0.25),
      Math.sin(a) * (OUTER_R0 + 0.25),
      Math.cos(a) * (OUTER_R1 - 0.3),
      Math.sin(a) * (OUTER_R1 - 0.3),
      0.09,
      face - exposed * 0.006,
      face + exposed * 0.05,
    )
  }
  for (const s of [-1, 1]) {
    const a = s * 0.34
    emitStrip(
      writer,
      'steelEdge',
      Math.cos(a) * (OUTER_R1 - 0.34),
      Math.sin(a) * (OUTER_R1 - 0.34),
      Math.cos(a) * (OUTER_R1 - 0.1),
      Math.sin(a) * (OUTER_R1 - 0.1),
      0.16,
      -PLATE_HALF_T - 0.008,
      PLATE_HALF_T + 0.008,
    )
  }
  emitStrip(
    writer,
    'runningLight',
    Math.cos(-0.06) * 5.35,
    Math.sin(-0.06) * 5.35,
    Math.cos(0.06) * 5.35,
    Math.sin(0.06) * 5.35,
    0.07,
    face - exposed * 0.002,
    face + exposed * 0.004,
  )
  const group = new Group()
  group.add(writer.build(materials))
  return group
}

/** One sector's INNER wedge plate: side lap seals and hazard chevrons that
 *  read as the closing edge from both approach directions. */
function buildInnerPlate(materials: Record<string, Material>, exposed: 1 | -1): Group {
  const writer = new PartWriter()
  emitSectorPlate(writer, 'steel', INNER_R0, INNER_R1)
  const face = exposed * PLATE_HALF_T
  const seamA = HALF_ANGLE - 0.05
  for (const s of [-1, 1]) {
    emitStrip(
      writer,
      'dark',
      Math.cos(s * seamA) * 0.5,
      Math.sin(s * seamA) * 0.5,
      Math.cos(s * seamA) * (INNER_R1 - 0.08),
      Math.sin(s * seamA) * (INNER_R1 - 0.08),
      0.06,
      face - exposed * 0.004,
      face + exposed * 0.005,
    )
  }
  // Chevrons point at the apex: two angled orange strips per side.
  for (const s of [-1, 1]) {
    for (const rc of [1.35, 2.05]) {
      emitStrip(
        writer,
        'orange',
        Math.cos(0) * (rc - 0.45),
        Math.sin(0) * (rc - 0.45),
        Math.cos(s * 0.4) * (rc + 0.35),
        Math.sin(s * 0.4) * (rc + 0.35),
        0.12,
        face - exposed * 0.003,
        face + exposed * 0.004,
      )
    }
  }
  const group = new Group()
  group.add(writer.build(materials))
  return group
}

/** Fixed trim rings framing the slot mouth in the bore wall — the machined
 *  reveal the blades vanish behind. Revolved about the gate axis; the outer
 *  edge is buried 20 mm into the collar's bore (bury-and-cap). */
function emitTrimRings(writer: PartWriter): void {
  const segments = 72
  const profiles: Array<Array<[number, number]>> = [
    [
      [5.92, 128.048],
      [5.7, 128.048],
      [5.66, 128.068],
      [5.66, 128.092],
      [5.7, 128.112],
      [5.92, 128.112],
    ],
    [
      [5.92, 128.688],
      [5.7, 128.688],
      [5.66, 128.708],
      [5.66, 128.732],
      [5.7, 128.752],
      [5.92, 128.752],
    ],
  ]
  for (const profile of profiles) {
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2
      const a1 = ((s + 1) / segments) * Math.PI * 2
      const point = (angle: number, [r, z]: [number, number]): Vector3 =>
        new Vector3(Math.cos(angle) * r, AXIS_Y + Math.sin(angle) * r, z)
      for (let i = 0; i < profile.length; i++) {
        const j = (i + 1) % profile.length
        writer.quad(
          'steelEdge',
          point(a0, profile[i]),
          point(a0, profile[j]),
          point(a1, profile[j]),
          point(a1, profile[i]),
          0.4,
        )
      }
    }
  }
}

export function buildPortalGate(materials: Record<string, Material>): PortalGate {
  const group = new Group()
  group.name = 'tram:portal-gate'

  const fixedWriter = new PartWriter()
  emitTrimRings(fixedWriter)
  group.add(fixedWriter.build(materials))

  const movers: Mover[] = []
  for (let k = 0; k < 6; k++) {
    const phi = (k / 6) * Math.PI * 2 + Math.PI / 6
    const parity = k % 2
    // Exposed faces: the park (z−) sees parity-0 plates first, the tube (z+)
    // sees parity-1 first — furniture goes on the faces that are seen.
    const outer = buildOuterPlate(materials, parity === 0 ? -1 : 1)
    const inner = buildInnerPlate(materials, parity === 0 ? -1 : 1)
    outer.rotation.z = phi
    inner.rotation.z = phi
    group.add(outer)
    group.add(inner)
    movers.push(
      { group: outer, cos: Math.cos(phi), sin: Math.sin(phi), z: BAND_OUTER[parity], travel: OUTER_TRAVEL },
      { group: inner, cos: Math.cos(phi), sin: Math.sin(phi), z: BAND_INNER[parity], travel: INNER_TRAVEL },
    )
  }
  const setOpen = (open01: number): void => {
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i]
      const d = m.travel * open01
      m.group.position.set(m.cos * d, AXIS_Y + m.sin * d, m.z)
    }
  }
  setOpen(0)
  return { group, setOpen }
}
