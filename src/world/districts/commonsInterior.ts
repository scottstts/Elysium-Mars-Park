import { Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { bakeParts, placeParts, placedPoint, type PartSoup } from '../../archkit/kit'
import {
  BEVEL,
  MeshData,
  SMOOTH,
  annularPrism,
  arcPts,
  bevel,
  ccw,
  circle,
  loft,
  prism,
  prismYZ,
  revolve,
  rotateZ,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  type SlotParts,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import { signageMaterial } from '../../materials/library'
import { lightFixtures } from '../lightFixtures'
import type { DistrictServices } from './types'

/**
 * THE COMMONS — ground-floor fit-out, gallery and helical stair.
 *
 * `commons.ts` owns the drum: curtain wall, arcade, roof, entrance portal.
 * This file owns everything a guest can walk on, sit at or read once they are
 * through the doors, and it publishes the two sectors the shell must agree
 * with (`COMMONS_STAIR`, `COMMONS_WELL`) so the level-2 plate's opening and the
 * stair climbing through it can never drift apart.
 *
 * **Authoring frame** is the drum's, exactly as in `commons.ts`: plan `(x, y)`
 * are metres east/south of `COMMONS`, `z` is height over the paved apron, and
 * `shell.emit()` does the translate + `writeInto`. Plan angle 0 is +x; the
 * entrance is at +90 deg.
 *
 * **The plan.** The fascia outside promises ASSEMBLY / GALLEY / CLINIC, so the
 * room delivers all three off one circulation loop:
 *
 * ```
 *   82.5..97.5 deg   ENTRANCE   portal, two sliding leaves, dust grate
 *    118..180 deg    STAIR      helical flight up to the gallery
 *    196..252 deg    GALLEY     served counter + back bar
 *    282..332 deg    CLINIC     nook behind a glazed screen
 *    centre r<4.28   ASSEMBLY   two refectory tables under the lantern
 * ```
 *
 * **Why the stair is helical.** A straight flight cannot climb 4.87 m inside a
 * 17.7 m drum without eating the hall: 8.4 m of going against 4.3 m of usable
 * depth between the void and the glass. Wound onto the 7.45 m walking circle
 * the same flight becomes a 62 deg arc with 0.29 m of going per tread, and it
 * arrives ON the gallery instead of into it. The chord dip that bit the hydro
 * tower's stair is 1.4 mm at this radius, i.e. gone.
 *
 * **Why each step is one block.** A level tread bearing on a raking stringer
 * either floats above it or drives into it — the rake moves half a riser across
 * one tread. So a step here is a cast block (carcass) with a metal tread plate
 * floating over it on a 4 mm shadow gap, which is both the real detail and the
 * only version with no cross-slot contact anywhere.
 */

// ------------------------------------------------------------------ contract

/** Reveal at every butt in this file (geometry-craft §3: flush is forbidden). */
const BUTT = 0.004
/** Ring segment count for coves, floor bands and the void edge. */
const SEG = 72

/**
 * The stair, published because `commons.ts` must cut the plate it climbs
 * through. 29 risers at 168 mm — inside the character controller's 0.42 m
 * autostep, and on the 165/290 code pair the rest of the park is built to.
 * 28 of them are real: the 29th "tread" is the gallery deck, which is how a
 * flight actually meets a slab (`loungeInterior.ts` learned the same thing).
 */
export const COMMONS_STAIR = {
  /** Plan angle of the bottom riser. */
  a0: (118 * Math.PI) / 180,
  /**
   * Angle per riser. On a helix the going is `dTheta · r`, so it is SHORTEST at
   * the inner stringer — and rapier's autostep refuses a step whose clear top is
   * narrower than the controller's `minWidth` (0.28 m). At the original 0.0389
   * the inner going was 0.261 m, i.e. under the gate, and the flight was only
   * climbable in a narrow band around the walking line. 0.0428 gives 0.287 m at
   * `rIn` and 0.319 m at `rWalk`: over the gate across the FULL width.
   */
  dTheta: 0.0428,
  risers: 29,
  rIn: 6.7,
  rOut: 8.2,
  /** Walking line: every going/pitch number is quoted at this radius. */
  rWalk: 7.45,
  /**
   * Balustrade blade centres, held 45 mm off each edge. Their COLLIDERS are
   * 60 mm thick to match the 48 mm blades; at the original 140 mm they ate
   * 46 mm of going width per side and squeezed the walkable corridor to 1.18 m
   * against a 0.70 m capsule — enough that any drift off the walking line
   * pinned the player against a railing and stopped the climb dead.
   */
  blade: 0.045,
  bladeCollider: 0.06,
} as const

/**
 * The opening in the level-2 plate, and the headroom contract for the flight.
 *
 * **The clearance a climber needs is 2.22 m, not 1.8.** Rapier's autostep
 * raises the capsule by `maxHeight` (0.42) BEFORE casting forward, so a 1.8 m
 * capsule climbing 168 mm risers needs `1.8 + 0.42` of clear air over every
 * tread or it stops dead — silently, with nothing visible in the way.
 *
 * `a0` was 143 deg, sized against a 2.05 m guess. That left 2.22 m under the
 * ceiling COVE (soffit 4.30) — exactly on the limit — and the gallery's
 * collider overhang then took it well under. 138 deg gives 2.60 m under the
 * cove and 2.70 m under the plate at the well edge, and every tread above it
 * is open to the atrium. Any change to `COMMONS_STAIR.rise` or to the soffit
 * heights has to be re-checked here: clearance at the edge is
 * `coveSoffit − (zFloor + rise · (a0 − stair.a0) / dTheta)`.
 *
 * The sector ends where the flight arrives, so the last tread butts the gallery
 * deck. Inside it the plate's inner edge moves out to `rIn`, which makes the
 * cut a widening of the atrium void rather than an isolated hole in a floor.
 */
export const COMMONS_WELL = {
  a0: (138 * Math.PI) / 180,
  a1: COMMONS_STAIR.a0 + 28 * COMMONS_STAIR.dTheta,
  rIn: 8.34,
  /** Angular movement joint at the two radial butts against the main sector. */
  gap: 0.0008,
} as const

/** What `commons.ts` hands the fit-out. Nothing here is re-derived. */
export interface CommonsShell {
  /** Drum centre, world plan. */
  x: number
  z: number
  /** World Y of the apron datum, i.e. local z = 0. */
  baseY: number
  /** Local-frame emit: translates by the drum origin, then `writeInto`. */
  emit: (slot: string, part: MeshData) => void
  /** Local (plan x, plan y, height) to world. */
  world: (px: number, py: number, pz: number) => Vector3
  /** Foliage-card instance matrices, in WORLD space — `commons.ts` instances. */
  leaves: Matrix4[]
  rGlass: number
  rDrum: number
  rVoid: number
  /** Structural slab top — the finish is laid on this. */
  zSlab: number
  /** Finished floor: the walkable datum for everything below. */
  zFloor: number
  zSoffit: number
  zL2: number
  zL2Top: number
  zHeadU: number
  zLantern: number
  /** The drum's own opening, in plan angles. */
  doorA0: number
  doorA1: number
}

// ------------------------------------------------------------------- layout

/** Hall column ring — eight turned columns carrying the level-2 plate. */
const R_HALL_COL = 6.05
const HALL_COLS = 8

/** Programme sectors. Nothing overlaps; check this table before adding one. */
const GALLEY = { a0: (196 * Math.PI) / 180, a1: (252 * Math.PI) / 180 }
const CLINIC = { a0: (282 * Math.PI) / 180, a1: (332 * Math.PI) / 180 }

/** Floor set-out, outer to inner: field edges and the three divider channels. */
const FLOOR = {
  outer: 8.62,
  fields: [
    [8.62, 8.1],
    [8.056, 6.9],
    [6.856, 5.6],
    [5.556, 4.284],
  ] as Array<[number, number]>,
  strips: [
    [8.096, 8.06],
    [6.896, 6.86],
    [5.596, 5.56],
  ] as Array<[number, number]>,
  /** Raised disc under the lantern: where the assembly sits. */
  medallion: 4.28,
  /** Dust grate: the first 1.7 m inside the doors is a barrier-matting well. */
  matInner: 6.9,
}

// ------------------------------------------------------------------ helpers

/** Plan point at polar `(r, t)` in a frame rotated to `phi`. */
function polar(phi: number, r: number, t: number): Vec2 {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return [c * r - s * t, s * r + c * t]
}

/** A full annular band. */
function ring(rO: number, rI: number, z0: number, z1: number, rim = 0.012, seg = SEG): MeshData {
  return annularPrism(circle(rO, seg), circle(rI, seg), z0, z1, rim, 1)
}

/**
 * An arc of band as ONE closed prism. `density` is arc length per station: a
 * 320 deg plate at 0.35 m/station is 180 stations and a `bevel()` that costs
 * five figures of triangles, so anything structural asks for a coarser one.
 */
function sector(
  rO: number,
  rI: number,
  a0: number,
  a1: number,
  z0: number,
  z1: number,
  rim = 0.012,
  density = 0.9,
): MeshData {
  const steps = Math.max(4, Math.min(120, Math.round((Math.abs(a1 - a0) * rO) / density)))
  const poly = [...arcPts(0, 0, rO, a0, a1, steps), ...arcPts(0, 0, rI, a1, a0, steps)]
  const md = prism(poly, z0, z1)
  return rim > 0 ? bevel(md, rim, 1) : md
}

/**
 * Yaw for a BOX COLLIDER whose local +X must lie along the tangent at plan
 * angle `phi` (local +Z then points outward). The park's benches use the same
 * expression; getting it wrong turns every wall panel through 90 deg.
 */
function tangentYaw(phi: number): number {
  return Math.atan2(-Math.cos(phi), -Math.sin(phi))
}

/**
 * Yaw for `placeParts` so a part authored with local +y = FRONT ends up facing
 * plan angle `phi`. `placeParts` sends local +y to world `(sin y, cos y)`, and
 * plan angle `phi` is world `(cos phi, sin phi)`.
 */
function faceYaw(phi: number): number {
  return Math.PI / 2 - phi
}

/** Player yaw that LOOKS along plan angle `phi` — player yaw 0 looks −Z. */
function lookYaw(phi: number): number {
  return Math.atan2(-Math.cos(phi), -Math.sin(phi))
}

/** Plan point on the drum. */
function at(deg: number, r: number): Vec2 {
  const a = (deg * Math.PI) / 180
  return [Math.cos(a) * r, Math.sin(a) * r]
}

// -------------------------------------------------------------------- floor

/**
 * The floor is not the paving. Outside is a rolled regolith-aggregate pour;
 * inside is a cast terrazzo laid in four concentric fields divided by RECESSED
 * metal channels, with a raised medallion under the lantern marking where the
 * assembly sits, and a barrier-matting grate across the whole threshold.
 *
 * The dividers are recessed rather than applied because an inlay laid on top of
 * a field is either coplanar with it or buried in it, and both are defects. A
 * channel sitting on the slab 3.5 mm under the field, with 4 mm of reveal each
 * side, is a real terrazzo divider and touches nothing.
 */
function floorFinish(shell: CommonsShell): void {
  const { emit, zSlab, zFloor } = shell
  // The two outer fields (and the channel between them) stop either side of the
  // threshold: the grate takes that ground.
  const g = 0.0009
  const b0 = shell.doorA1 + g
  const b1 = shell.doorA0 + Math.PI * 2 - g

  // `cast`, not `deck`: `deckPlate` is a ribbed treadplate, and in raking sun
  // through the curtain wall a civic hall floored in it reads as a gantry.
  // Poured mineral with metal divider channels is the right material story and
  // is emphatically not the regolith-aggregate paving outside.
  FLOOR.fields.forEach(([rO, rI], index) => {
    if (index < 2) emit('cast', sector(rO, rI, b0, b1, zSlab, zFloor, 0.005, 1.0))
    else emit('cast', ring(rO, rI, zSlab, zFloor, 0.005))
  })
  FLOOR.strips.forEach(([rO, rI], index) => {
    // The divider's end caps are held 6 mrad inside the fields' so no two
    // radial faces share a plane (see the cove note).
    if (index === 0) emit('steelEdge', sector(rO, rI, b0 + 0.006, b1 - 0.006, zSlab, zFloor - 0.0035, 0.003, 1.0))
    else emit('steelEdge', ring(rO, rI, zSlab, zFloor - 0.0035, 0.003))
  })

  // Assembly medallion: 2.5 mm proud of the fields with a 4 mm reveal round it,
  // so the lantern's pool of daylight lands on its own plane.
  emit('cast', bevel(prism(circle(FLOOR.medallion, SEG), zSlab, zFloor + 0.0025), 0.006, 2))

  // Dust grate. On a planet that is mostly dust, the first thing a civic
  // building does is take it off your boots — a 1.72 m deep matting well with
  // real bars, not a texture. The bar tops sit 4 mm under the terrazzo so the
  // well reads as a well.
  emit('dark', sector(FLOOR.outer, FLOOR.matInner, shell.doorA0, shell.doorA1, zSlab, zFloor - 0.03, 0.005, 0.5))
  const bars = 15
  for (let i = 0; i < bars; i++) {
    const a = shell.doorA0 + ((shell.doorA1 - shell.doorA0) * (i + 0.5)) / bars
    const half = 0.0032
    emit(
      'steelEdge',
      sector(FLOOR.outer - 0.05, FLOOR.matInner + 0.05, a - half, a + half, zFloor - 0.028, zFloor - 0.004, 0.002, 0.5),
    )
  }
}

// ------------------------------------------------------------------ ceiling

/**
 * Ceiling coves: two luminous rings under the level-2 plate and one under the
 * roof plate, each a strip in a 55 mm pocket between two trim rings. This is
 * the detail the drum already shows through its glazing from the plaza, which
 * is why the radii sit between the column ring and the glass rather than
 * wherever the interior would like them — inside and outside have to agree.
 *
 * The two lower rings break over the stairwell, because the plate they hang
 * from does.
 */
function ceiling(shell: CommonsShell): number {
  const { emit, zSoffit, zHeadU } = shell
  let faces = 0

  const cove = (rO: number, rI: number, zTop: number, a0?: number, a1?: number): void => {
    const arc = a0 !== undefined && a1 !== undefined
    // `trim` is the angular inset applied to the luminous strip. Two solids
    // whose radial END CAPS lie in one plane make the clash test's edge/
    // triangle intersection ambiguous, and it reports hundreds of crossings
    // for a joint that is 4 mm apart everywhere else.
    const band = (r1: number, r0: number, z0: number, z1: number, slot: string, rim: number, trim = 0): void => {
      emit(
        slot,
        arc
          ? sector(r1, r0, (a0 as number) + trim, (a1 as number) - trim, z0, z1, rim, 0.8)
          : ring(r1, r0, z0, z1, rim),
      )
    }
    band(rO + 0.16, rO, zTop - 0.1, zTop, 'dark', 0.01)
    band(rI, rI - 0.16, zTop - 0.1, zTop, 'dark', 0.01)
    band(rO - BUTT, rI + BUTT, zTop - 0.045, zTop, 'interiorGlow', 0.006, 0.006)
    faces += 1
  }

  const c0 = COMMONS_WELL.a1 + 0.02
  const c1 = COMMONS_WELL.a0 + Math.PI * 2 - 0.02
  cove(8.1, 7.3, zSoffit, c0, c1)
  cove(5.66, 4.86, zSoffit, c0, c1)
  cove(9.9, 8.6, zHeadU)
  return faces
}

// -------------------------------------------------------------- hall columns

function hallColumns(shell: CommonsShell, services: DistrictServices): void {
  const { emit, zFloor, zSoffit } = shell
  const height = zSoffit - zFloor
  const shaft: Vec2[] = [
    [0, 0],
    [0.24, 0],
    [0.24, 0.045],
    [0.16, 0.1],
    [0.15, height - 0.55],
    [0.185, height - 0.2],
    [0.2, height - 0.016],
    [0, height - 0.016],
  ]
  const prototype = revolve(shaft, 24, { capStart: true, capEnd: false, smooth: SMOOTH.turned })
  for (let i = 0; i < HALL_COLS; i++) {
    const phi = (i * Math.PI * 2) / HALL_COLS + Math.PI / HALL_COLS
    const column = prototype.clone()
    translate(column, [Math.cos(phi) * R_HALL_COL, Math.sin(phi) * R_HALL_COL, zFloor])
    emit('steel', column)
    services.colliders.push({
      kind: 'box',
      center: shell.world(Math.cos(phi) * R_HALL_COL, Math.sin(phi) * R_HALL_COL, zFloor + height / 2),
      size: new Vector3(0.4, height, 0.4),
      yaw: phi,
    })
  }
}

// ----------------------------------------------------------------- railings

/**
 * The gallery edge family: a 220 mm upstand, slim posts and a moulded capping
 * rail, swept along a plan polyline so the same detail wraps the atrium void,
 * the stairwell's arc and the stairwell's radial edge without three idioms.
 */
function edgeRail(shell: CommonsShell, path: Vec3[], deckTop: number): void {
  const { emit } = shell
  const span = path.length - 1
  const railZ = deckTop + 1.066
  emit(
    'cast',
    smoothShade(
      tubeAlong(
        path.map(([x, y]) => [x, y, deckTop] as Vec3),
        [
          [-0.11, 0],
          [0.11, 0],
          [0.11, 0.286],
          [-0.11, 0.286],
        ],
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.cast,
    ),
  )
  const posts = Math.max(2, Math.round(pathLength(path) / 1.35))
  for (let p = 0; p <= posts; p++) {
    const spot = samplePath(path, (span * p) / posts)
    const post = prism(roundedRect(0.042, 0.042, 0.009, 2), deckTop + 0.286, railZ - 0.019)
    translate(post, [spot[0], spot[1], 0])
    emit('aluminum', smoothShade(post, SMOOTH.moulded))
  }
  emit(
    'orangeTop',
    smoothShade(
      tubeAlong(
        path.map(([x, y]) => [x, y, railZ] as Vec3),
        roundedRect(0.052, 0.038, 0.014, 3),
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.moulded,
    ),
  )
}

function pathLength(path: Vec3[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  }
  return total
}

function samplePath(path: Vec3[], u: number): Vec3 {
  const i = Math.max(0, Math.min(path.length - 2, Math.floor(u)))
  const f = u - i
  const a = path[i]
  const b = path[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function arcPath(r: number, a0: number, a1: number, z: number, steps: number): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([Math.cos(a) * r, Math.sin(a) * r, z])
  }
  return out
}

/** Chord box colliders along an arc, tangential, at a fixed height band. */
function arcColliders(
  shell: CommonsShell,
  services: DistrictServices,
  r: number,
  a0: number,
  a1: number,
  zCenter: number,
  height: number,
  depth: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / count
    services.colliders.push({
      kind: 'box',
      center: shell.world(Math.cos(a) * r, Math.sin(a) * r, zCenter),
      size: new Vector3((Math.abs(a1 - a0) / count) * r + 0.08, height, depth),
      yaw: tangentYaw(a),
    })
  }
}

// ---------------------------------------------------------------- mezzanine

function mezzanine(shell: CommonsShell, services: DistrictServices): void {
  const { emit, rVoid, zL2, zL2Top, zSoffit } = shell
  const { a0: wellA0, a1: wellA1, rIn: wellR, gap } = COMMONS_WELL
  const deckOuter = shell.rDrum - 0.02

  // Gallery deck: the same two sectors as the plate under it, so a movement
  // joint can never appear in one and not the other.
  emit('cast', sector(deckOuter, rVoid + 0.02, wellA1 + gap, wellA0 + Math.PI * 2 - gap, zL2, zL2Top, 0.005, 1.1))
  emit('cast', sector(deckOuter, wellR + 0.02, wellA0 + gap, wellA1 - gap, zL2, zL2Top, 0.005, 0.8))

  // Downstand fascia round the well: it stiffens the cut edge and covers the
  // 7 mm joint where the two plate sectors butt.
  emit('cast', sector(wellR + 0.02, wellR - 0.12, wellA0, wellA1, zSoffit - 0.32, zSoffit, 0.014, 0.6))
  for (const a of [wellA0, wellA1]) {
    const bar = prismYZ(
      [
        [-0.07, zSoffit - 0.32],
        [0.07, zSoffit - 0.32],
        [0.07, zSoffit],
        [-0.07, zSoffit],
      ] as Vec2[],
      rVoid + 0.02,
      // Stops 4 mm short of the arc fascia's inner face. Running it through
      // put two same-facing soffits on one plane at both ends of the well.
      wellR - 0.124,
    )
    // rotateZ(phi) puts local +X — here the extrusion axis — on the RADIAL.
    rotateZ(bar, a)
    emit('cast', bar)
  }

  // Balustrades. The void's own ring is broken by the well; the well then gets
  // its arc and its two radial edges. The radial edge at `wellA1` stops short
  // of the stair, because that is where the flight arrives.
  edgeRail(shell, arcPath(rVoid + 0.11, wellA1, wellA0 + Math.PI * 2, zL2Top, 88), zL2Top)
  edgeRail(shell, arcPath(wellR + 0.13, wellA0, wellA1, zL2Top, 16), zL2Top)
  // The radial runs start and stop 4 mm clear of the two arc runs' upstands
  // (which are 0.22 wide about their own paths). Overlapping them instead put
  // two 0.22 x 0.22 same-facing patches on one plane at every corner.
  const radial = (a: number, r0: number, r1: number): void => {
    edgeRail(
      shell,
      [
        [Math.cos(a) * r0, Math.sin(a) * r0, zL2Top],
        [Math.cos(a) * r1, Math.sin(a) * r1, zL2Top],
      ],
      zL2Top,
    )
  }
  radial(wellA0, rVoid + 0.234, wellR + 0.016)
  radial(wellA1, rVoid + 0.234, COMMONS_STAIR.rIn - 0.08)

  // ---- Deck colliders, in TWO RADIAL BANDS split at the well's inner edge.
  //
  // This used to be one ring of 24 chord boxes culled by whether the box's
  // CENTRE angle fell inside the well, and it made the gallery unreachable.
  // A box is a rectangle: 2.1 m along the tangent and 6.6 m deep, so its inner
  // corners swing `atan(halfWidth / r)` FORWARD in plan — 9 deg at the stair's
  // radius. The box centred at 142.5 deg therefore roofed the flight out to
  // 151.6 deg, where the tread is 2.73 m up and the box soffit is 4.70: 1.98 m
  // of headroom.
  //
  // That is under the real requirement, which is NOT 1.8 m. Rapier's autostep
  // lifts the capsule by `maxHeight` BEFORE casting forward, so a climb needs
  // capsule + autostep = 1.8 + 0.42 = **2.22 m** clear over every tread. The
  // player hard-stopped at y 3.06 every time, ten treads short of the top, and
  // nothing was visible there because the MESH deck ends correctly at the well.
  //
  // Fixes, both of them: generate the runs EXPLICITLY from the well angles so
  // culling can never leave an overhang, and split radially so each box is
  // narrow enough that its corner swing is under a degree at the stair band.
  const rSplit = wellR + 0.02
  // Outer band: real deck at every angle, including over the well.
  arcColliders(shell, services, (rSplit + deckOuter) / 2, 0, Math.PI * 2, zL2Top - 0.18, 0.36, deckOuter - rSplit, 30)
  // Inner band: absent over the well. 34 boxes put the last one's coverage
  // 0.2 deg past the well edge at the stair's radius, against 9 deg before.
  arcColliders(
    shell,
    services,
    (rVoid + 0.02 + rSplit) / 2,
    wellA1,
    wellA0 + Math.PI * 2,
    zL2Top - 0.18,
    0.36,
    rSplit - rVoid - 0.02,
    34,
  )

  // ---- Balustrade colliders: the void ring, the well's arc, and the two
  // radial edges (which had mesh but no collider — a straight walk off the
  // gallery into the hall).
  arcColliders(shell, services, rVoid + 0.11, wellA1, wellA0 + Math.PI * 2, zL2Top + 0.54, 1.08, 0.24, 16)
  arcColliders(shell, services, wellR + 0.13, wellA0, wellA1, zL2Top + 0.54, 1.08, 0.24, 5)
  for (const [a, r0, r1] of [
    [wellA0, rVoid + 0.234, wellR + 0.016],
    [wellA1, rVoid + 0.234, COMMONS_STAIR.rIn - 0.08],
  ] as const) {
    const rm = (r0 + r1) / 2
    services.colliders.push({
      kind: 'box',
      center: shell.world(Math.cos(a) * rm, Math.sin(a) * rm, zL2Top + 0.54),
      // Local +X on the RADIAL is yaw = −phi (on the tangent it is
      // `atan2(−cos, −sin)`); these two are not interchangeable.
      size: new Vector3(r1 - r0, 1.08, 0.24),
      yaw: -a,
    })
  }
}

// -------------------------------------------------------------------- stair

function stair(shell: CommonsShell, services: DistrictServices): void {
  const { emit, world, zFloor, zL2Top } = shell
  const { a0, dTheta, risers, rIn, rOut, rWalk } = COMMONS_STAIR
  const rise = (zL2Top - zFloor) / risers
  const nose = 0.026 / rWalk
  const lap = 0.0008

  for (let n = 1; n <= risers - 1; n++) {
    const zTop = zFloor + n * rise
    const s0 = a0 + (n - 1) * dTheta - nose
    const s1 = a0 + n * dTheta + lap
    // Carcass. Consecutive blocks overlap by 0.8 mrad, so no two ever share a
    // radial plane; they are one slot, so the overlap welds instead of clashing.
    // The bottom two blocks would otherwise reach below the finished floor and
    // bed themselves into the terrazzo. A stair stands ON its floor.
    emit('cast', sector(rOut, rIn, s0, s1, Math.max(zTop - 0.26, zFloor + 0.004), zTop - 0.016, 0.007, 0.3))
    // Tread plate on packers: a 4 mm shadow gap in z and 20 mm radially means
    // the two slots never touch. It stops where the NEXT block's nosing begins
    // — running it the full block width buried its leading 26 mm inside the
    // step above, which is a cross-slot clash on every one of 28 treads.
    const p0 = s0 + 0.002 / rWalk
    const p1 = a0 + n * dTheta - nose - 0.002 / rWalk
    // Radially the plate runs BETWEEN the two balustrade blades (which are cast
    // with the carcass) and leaves a 70 mm cast margin under each — the real
    // detail, and the only one where the walking surface never meets the
    // balustrade's slot.
    emit('deck', sector(rOut - 0.095, rIn + 0.095, p0, p1, zTop - 0.012, zTop, 0.004, 0.3))

    const mid = (s0 + s1) * 0.5
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(mid) * rWalk, Math.sin(mid) * rWalk, zTop - 0.13),
      size: new Vector3(dTheta * rWalk + 0.07, 0.26, rOut - rIn),
      yaw: tangentYaw(mid),
    })
  }

  // Solid raking balustrades. A swept blade with a capping rail costs a tenth
  // of a stanchion railing and is the right object anyway: a spiral stair read
  // from the hall wants a continuous ribbon, not sixteen posts.
  //
  // The blade is `cast`, the SAME slot as the steps. A raking blade crosses
  // every tread's leading edge (the rake drops half a riser across one tread),
  // so any other slot is a guaranteed clash on all 28 of them; lifting it clear
  // instead would leave a stepped gap under a continuous ribbon. One slot makes
  // the joint a weld, and a cast stair with a cast balustrade is the honest
  // object anyway — the polished capping rail carries the contrast.
  const stations = 30
  const aEnd = a0 + (risers - 1) * dTheta
  for (const r of [rIn + COMMONS_STAIR.blade, rOut - COMMONS_STAIR.blade]) {
    const path: Vec3[] = []
    const rings: Vec3[][] = []
    for (let i = 0; i <= stations; i++) {
      const a = a0 + ((aEnd - a0) * i) / stations
      const c = Math.cos(a)
      const s = Math.sin(a)
      const z = zFloor + ((a - a0) / dTheta) * rise
      path.push([c * r, s * r, z])
      // The blade is lofted from VERTICAL sections, not swept. `tubeAlong`
      // builds its frame perpendicular to the path, and on a 30 deg rake that
      // leans the whole ribbon back half a metre — the top edge ends up over a
      // different tread from its foot, and it crosses its own capping rail.
      rings.push([
        [c * (r - 0.024), s * (r - 0.024), z - 0.06],
        [c * (r + 0.024), s * (r + 0.024), z - 0.06],
        [c * (r + 0.024), s * (r + 0.024), z + 1.0],
        [c * (r - 0.024), s * (r - 0.024), z + 1.0],
      ])
    }
    emit('cast', smoothShade(loft(rings, { closeV: true, capStart: true, capEnd: true }), SMOOTH.cast))
    // Capping rail 1.03 m over the nosing line: a swept section IS right for a
    // handrail, and its own 40 mm depth leans by only 10 mm on this rake, so it
    // clears the blade's 1.0 m top by 13 mm.
    emit(
      'orangeTop',
      smoothShade(
        tubeAlong(
          path.map(([x, y, z]) => [x, y, z + 1.03] as Vec3),
          roundedRect(0.055, 0.04, 0.014, 3),
          { up: [0, 0, 1], cap: true },
        ),
        SMOOTH.moulded,
      ),
    )
    // Balustrade collider: seven stepped boxes per side — a box cannot rake,
    // so it climbs with the flight.
    for (let b = 0; b < 7; b++) {
      const t0 = b / 7
      const t1 = (b + 1) / 7
      const am = a0 + (aEnd - a0) * (t0 + t1) * 0.5
      const zLo = zFloor + (((aEnd - a0) * t0) / dTheta) * rise
      const zHi = zFloor + (((aEnd - a0) * t1) / dTheta) * rise
      services.colliders.push({
        kind: 'box',
        center: world(Math.cos(am) * r, Math.sin(am) * r, (zLo + zHi) / 2 + 0.55),
        size: new Vector3(((aEnd - a0) / 7) * r + 0.08, zHi - zLo + 1.1, COMMONS_STAIR.bladeCollider),
        yaw: tangentYaw(am),
      })
    }
  }
}

// ---------------------------------------------------------------- furniture

/** Local frame for every loose piece: +x right, +y FRONT, standing on z = 0. */
let CHAIR: { soups: PartSoup[]; seat: Vec3 } | null = null

/**
 * The commons chair: a bent-tube cantilever side frame, moulded seat and back
 * shells, and one upholstered pad. Authored once and placed from a baked soup —
 * forty of them would otherwise rebuild every profile forty times.
 */
function chairParts(): { soups: PartSoup[]; seat: Vec3 } {
  if (CHAIR) return CHAIR
  const tube: MeshData[] = []
  const shells: MeshData[] = []
  const pad: MeshData[] = []

  for (const sx of [-0.215, 0.215]) {
    // ONE OPEN sled-base run — foot, runner, front bend, seat rail, back post —
    // swept with `up` = the chair's own X so the uprights cannot flip the frame.
    // It was a CLOSED loop first, and the U-turn at the top of the back post
    // put its two legs 17 mm apart under a 30 mm section: the tube swept
    // straight through itself, 14.6 cm² of self-overlap on every chair.
    tube.push(
      smoothShade(
        tubeAlong(
          [
            [sx, -0.19, 0.022],
            [sx, 0.06, 0.02],
            [sx, 0.2, 0.036],
            [sx, 0.205, 0.24],
            [sx, 0.2, 0.425],
            [sx, 0.04, 0.44],
            [sx, -0.17, 0.45],
            [sx, -0.208, 0.6],
            [sx, -0.213, 0.845],
          ],
          roundedRect(0.03, 0.026, 0.008, 2),
          { up: [1, 0, 0], cap: true },
        ),
        SMOOTH.moulded,
      ),
    )
  }
  // Cross rails buried 3 mm into the runners: same slot, so the joint welds.
  for (const [y, z] of [
    [0.14, 0.028],
    [-0.15, 0.024],
  ]) {
    tube.push(
      smoothShade(
        tubeAlong(
          [
            [-0.212, y, z],
            [0.212, y, z],
          ],
          roundedRect(0.024, 0.02, 0.006, 2),
          { up: [0, 0, 1], cap: true },
        ),
        SMOOTH.moulded,
      ),
    )
  }

  // Moulded shells: a crowned section lofted across with inset end stations so
  // the ends tuck instead of finishing flat.
  const shellOf = (section: Vec2[], halfWidth: number, along: 'z' | 'y'): MeshData =>
    smoothShade(
      loft(
        (
          [
            [-1, -0.012],
            [-0.93, -0.002],
            [0.93, -0.002],
            [1, -0.012],
          ] as Array<[number, number]>
        ).map(([t, inset]) => {
          const poly = section.map(([y, z]) => (along === 'z' ? [y, z + inset] : [y + inset, z]) as Vec2)
          return poly.map(([y, z]) => [halfWidth * t, y, z] as Vec3)
        }),
        { closeV: true, capStart: true, capEnd: true },
      ),
      SMOOTH.shell,
    )
  shells.push(
    shellOf(
      ccw([
        [0.23, 0.432],
        [0.2, 0.446],
        [-0.05, 0.452],
        [-0.19, 0.446],
        [-0.216, 0.434],
        [-0.2, 0.422],
        [-0.05, 0.428],
        [0.19, 0.424],
        [0.222, 0.416],
      ]),
      // 4 mm inside the frame tube's inner face (x = 0.20). At 0.212 the shell
      // ran through both side frames — a cross-slot clash on every chair.
      0.196,
      'z',
    ),
  )
  shells.push(
    shellOf(
      ccw([
        [-0.176, 0.5],
        [-0.166, 0.71],
        [-0.155, 0.795],
        [-0.132, 0.806],
        [-0.116, 0.71],
        [-0.108, 0.5],
        [-0.13, 0.487],
        [-0.16, 0.487],
      ]),
      0.185,
      'y',
    ),
  )
  // The cushion stands proud of the seat shell — foam, not paint.
  pad.push(
    smoothShade(
      bevel(
        prism(roundedRect(0.384, 0.4, 0.055, 3).map(([x, y]) => [x, y + 0.005] as Vec2), 0.452, 0.503),
        BEVEL.soft,
        3,
      ),
      SMOOTH.shell,
    ),
  )

  CHAIR = { soups: bakeParts({ aluminum: tube, dark: shells, fabricSand: pad } as SlotParts), seat: [0, 0.01, 0.503] }
  return CHAIR
}

let ROUND_TABLE: PartSoup[] | null = null

/** Café table: spun foot, turned column, bullnosed top at 735. */
function roundTableParts(): PartSoup[] {
  if (ROUND_TABLE) return ROUND_TABLE
  const foot = revolve(
    [
      [0, 0],
      [0.29, 0],
      [0.29, 0.022],
      [0.085, 0.058],
      [0.072, 0.088],
      [0, 0.088],
    ],
    22,
    { capStart: true, capEnd: true, smooth: SMOOTH.turned },
  )
  const stem = revolve(
    [
      [0, 0.088],
      [0.056, 0.088],
      [0.047, 0.42],
      [0.05, 0.688],
      [0.14, 0.7],
      [0, 0.7],
    ],
    20,
    { capStart: true, capEnd: true, smooth: SMOOTH.turned },
  )
  const top = smoothShade(
    loft(
      (
        [
          [-0.02, 0],
          [0.006, 0.008],
          [0.012, 0.024],
          [0.006, 0.04],
          [-0.02, 0.048],
        ] as Array<[number, number]>
      ).map(([offset, dz]) => circle(0.43 + offset, 30).map(([x, y]) => [x, y, 0.702 + dz] as Vec3)),
      { closeV: true, capStart: true, capEnd: true },
    ),
    SMOOTH.top,
  )
  ROUND_TABLE = bakeParts({ dark: foot, aluminum: stem, deck: top })
  return ROUND_TABLE
}

let LONG_TABLE: PartSoup[] | null = null

/** Refectory table for the assembly: 3.6 x 0.92, trestle frame, 735 top. */
function longTableParts(): PartSoup[] {
  if (LONG_TABLE) return LONG_TABLE
  const frame: MeshData[] = []
  for (const sx of [-1.5, 1.5]) {
    frame.push(
      smoothShade(
        tubeAlong(
          [
            [sx, -0.36, 0.034],
            [sx, -0.34, 0.09],
            [sx, -0.13, 0.66],
            [sx, -0.11, 0.7],
            [sx, 0.11, 0.7],
            [sx, 0.13, 0.66],
            [sx, 0.34, 0.09],
            [sx, 0.36, 0.034],
          ],
          roundedRect(0.052, 0.05, 0.012, 2),
          { up: [1, 0, 0], closePath: true, cap: false },
        ),
        SMOOTH.moulded,
      ),
    )
    // The foot pads start at 0.004, not 0: the assembly stands on the
    // MEDALLION, which is 2.5 mm proud of the fields, so a pad on the floor
    // plane is a pad 2.5 mm inside the disc it sits on.
    frame.push(
      bevel(
        prism(roundedRect(0.09, 0.86, 0.02, 2).map(([x, y]) => [x + sx, y] as Vec2), 0.004, 0.03),
        BEVEL.carcass,
        2,
      ),
    )
  }
  frame.push(
    smoothShade(
      tubeAlong(
        [
          [-1.474, 0, 0.24],
          [1.474, 0, 0.24],
        ],
        roundedRect(0.07, 0.05, 0.012, 2),
        { up: [0, 0, 1], cap: true },
      ),
      SMOOTH.moulded,
    ),
  )
  const top = smoothShade(
    loft(
      (
        [
          [-0.018, 0],
          [0.005, 0.007],
          [0.011, 0.022],
          [0.005, 0.037],
          [-0.018, 0.044],
        ] as Array<[number, number]>
      ).map(([offset, dz]) =>
        roundedRect(3.6 + 2 * offset, 0.92 + 2 * offset, 0.06 + offset, 3).map(
          ([x, y]) => [x, y, 0.702 + dz] as Vec3,
        ),
      ),
      { closeV: true, capStart: true, capEnd: true },
    ),
    SMOOTH.top,
  )
  LONG_TABLE = bakeParts({ aluminum: frame, deck: top })
  return LONG_TABLE
}

/** Place a chair and register the seat contract the builder owns. */
function placeChair(
  shell: CommonsShell,
  services: DistrictServices,
  px: number,
  py: number,
  facing: number,
  label: string,
): void {
  const parts = chairParts()
  const center = shell.world(px, py, shell.zFloor)
  const yaw = faceYaw(facing)
  placeParts(services.writer, parts.soups, center, yaw)
  services.seats.push({ seat: placedPoint(parts.seat, center, yaw), yaw: lookYaw(facing), label })
}

// ----------------------------------------------------------------- assembly

function assembly(shell: CommonsShell, services: DistrictServices): void {
  const { emit, world, zFloor } = shell
  const table = longTableParts()

  for (const py of [1.35, -1.35]) {
    placeParts(services.writer, table, world(0, py, zFloor), 0)
    services.colliders.push({
      kind: 'box',
      center: world(0, py, zFloor + 0.37),
      size: new Vector3(3.62, 0.74, 0.94),
    })
    for (const side of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        placeChair(shell, services, (k - 1.5) * 0.82, py + side * 0.79, side > 0 ? -Math.PI / 2 : Math.PI / 2, 'Take a seat')
      }
    }
  }

  // Lectern at the far end, curving around the speaker with its convex side to
  // the audience: the assembly has a front, and it faces the doors.
  const lx = 0
  const ly = -3.45
  const face = Math.PI / 2
  emit(
    'cast',
    bevel(
      prism(
        [...arcPts(lx, ly, 0.42, face - 0.55, face + 0.55, 8), ...arcPts(lx, ly, 0.24, face + 0.55, face - 0.55, 8)],
        zFloor,
        zFloor + 1.06,
      ),
      BEVEL.carcass,
      2,
    ),
  )
  emit(
    'deck',
    smoothShade(
      loft(
        (
          [
            [-0.014, 0],
            [0.006, 0.008],
            [0.006, 0.03],
            [-0.014, 0.038],
          ] as Array<[number, number]>
        ).map(([offset, dz]) =>
          [
            ...arcPts(lx, ly, 0.47 + offset, face - 0.62, face + 0.62, 9),
            ...arcPts(lx, ly, 0.2 - offset, face + 0.62, face - 0.62, 9),
          ].map(([x, y]) => [x, y, zFloor + 1.062 + dz] as Vec3),
        ),
        { closeV: true, capStart: true, capEnd: true },
      ),
      SMOOTH.top,
    ),
  )
  // Reading lamp in the lectern's back reveal, i.e. an ARC on the concave face
  // the speaker stands at (r 0.24), 4 mm off it and under the desk top's 1.062
  // underside. The lectern is a curved wall — every point of it is at
  // y ≥ ly + 0.204 — so a straight bar at ly − 0.26 was not in a reveal at all:
  // it floated 0.46 m behind the piece it belongs to.
  emit(
    'utilityLight',
    bevel(
      prism(
        [
          ...arcPts(lx, ly, 0.236, face - 0.5, face + 0.5, 6),
          ...arcPts(lx, ly, 0.196, face + 0.5, face - 0.5, 6),
        ],
        zFloor + 1.005,
        zFloor + 1.045,
      ),
      0.006,
      1,
    ),
  )
  services.colliders.push({ kind: 'box', center: world(lx, ly, zFloor + 0.53), size: new Vector3(0.96, 1.06, 0.62) })
}

// ------------------------------------------------------------------- galley

/**
 * GALLEY: a served counter on the south-west arc with a back-bar gantry behind
 * it. The counter front stands 0.6 m clear of the hall column ring, so the
 * queue reads BETWEEN the columns rather than behind them.
 */
function galley(shell: CommonsShell, services: DistrictServices): number {
  const { emit, zFloor } = shell
  const { a0, a1 } = GALLEY
  const rFront = 6.9
  const rBack = 7.7
  let lenses = 0

  // Plinth set back 24 mm (a shadow line at the floor), carcass, worktop with a
  // real bullnose overhanging 45 mm on the service side.
  emit('dark', sector(rBack - 0.024, rFront + 0.024, a0, a1, zFloor, zFloor + 0.13, 0.005, 0.5))
  emit('cast', sector(rBack, rFront, a0, a1, zFloor + 0.13, zFloor + 0.9, 0.008, 0.5))
  emit(
    'deck',
    smoothShade(
      loft(
        (
          [
            [-0.014, 0],
            [0.008, 0.008],
            [0.014, 0.024],
            [0.008, 0.04],
            [-0.014, 0.048],
          ] as Array<[number, number]>
        ).map(([offset, dz]) =>
          [
            ...arcPts(0, 0, rBack + offset, a0 - offset / rBack, a1 + offset / rBack, 44),
            ...arcPts(0, 0, rFront - 0.045 - offset, a1 + offset / rFront, a0 - offset / rFront, 44),
          ].map(([x, y]) => [x, y, zFloor + 0.902 + dz] as Vec3),
        ),
        { closeV: true, capStart: true, capEnd: true },
      ),
      SMOOTH.top,
    ),
  )
  // Fielded fronts: one bay per ~0.62 m, the module count DERIVED from the arc.
  const bays = Math.round(((a1 - a0) * rFront) / 0.62)
  for (let b = 0; b < bays; b++) {
    emit(
      'aluminum',
      sector(
        rFront - 0.006,
        rFront - 0.03,
        a0 + ((a1 - a0) * b) / bays + 0.006,
        a0 + ((a1 - a0) * (b + 1)) / bays - 0.006,
        zFloor + 0.16,
        zFloor + 0.86,
        0.005,
        0.4,
      ),
    )
  }
  // Toe wash: the counter reads as lit from under, never as painted. It lives
  // INSIDE the plinth's 24 mm set-back — face at rFront + 0.008, i.e. 8 mm
  // behind the carcass line and BUTT clear of the plinth it is fixed to. At
  // rFront − 0.036…− 0.09 it was 36 to 90 mm out in front of the carcass with
  // the plinth 114 mm behind it: a lit bar hovering over the floor.
  emit(
    'interiorGlow',
    sector(rFront + 0.024 - BUTT, rFront + 0.008, a0 + 0.02, a1 - 0.02, zFloor + 0.036, zFloor + 0.064, 0.004, 0.6),
  )
  lenses += 1

  // Back-bar gantry on two radial cheeks, so nothing is coplanar with the drum.
  const g0 = 7.95
  const g1 = 8.42
  for (const a of [a0 + 0.04, a1 - 0.04]) {
    const cheek = prismYZ(
      [
        [g0, zFloor],
        [g1, zFloor],
        [g1, zFloor + 2.16],
        [g0, zFloor + 2.16],
      ] as Vec2[],
      -0.03,
      0.03,
    )
    // phi − π/2 puts the extrusion axis on the TANGENT, so the cheek stands in
    // the radial plane. (phi would lay it flat across the counter.)
    rotateZ(cheek, a - Math.PI / 2)
    emit('dark', cheek)
  }
  // Shelves land ON their cheeks. A cheek centre is a0 + 0.04 / a1 − 0.04 and
  // the plate is 60 mm thick tangentially, i.e. ±0.0037 rad at r 8.2, so a
  // shelf ends 4 mm off its inner face. At a0 + 0.075 every shelf stopped
  // 287 mm short of the thing that is supposed to carry it, at BOTH ends.
  const shelfIn = 0.04 + 0.03 / 8.185 + BUTT / 8.185
  for (const z of [0.92, 1.36, 1.74, 2.1]) {
    emit('aluminum', sector(g1 - 0.02, g0 + 0.02, a0 + shelfIn, a1 - shelfIn, zFloor + z, zFloor + z + 0.026, 0.004, 0.5))
    emit(
      'interiorGlow',
      sector(g0 + 0.09, g0 + 0.045, a0 + shelfIn + 0.015, a1 - shelfIn - 0.015, zFloor + z - 0.03, zFloor + z - 0.004, 0.003, 0.6),
    )
    lenses += 1
  }

  // Equipment on the worktop: a hot cabinet, two urns, a beverage tower.
  const [cx, cy] = at(206, 7.3)
  emit(
    'aluminum',
    bevel(
      prism(roundedRect(0.62, 0.5, 0.03, 2).map(([x, y]) => [cx + x, cy + y] as Vec2), zFloor + 0.952, zFloor + 1.46),
      BEVEL.carcass,
      2,
    ),
  )
  emit(
    'darkGlass',
    bevel(
      prism(roundedRect(0.5, 0.026, 0.006, 1).map(([x, y]) => [cx + x, cy + y - 0.262] as Vec2), zFloor + 1.02, zFloor + 1.4),
      BEVEL.hardware,
      1,
    ),
  )
  for (const deg of [216, 222]) {
    const [ux, uy] = at(deg, 7.28)
    const urn = revolve(
      [
        [0, 0],
        [0.15, 0],
        [0.152, 0.03],
        [0.14, 0.36],
        [0.116, 0.42],
        [0.116, 0.46],
        [0, 0.46],
      ],
      20,
      { capStart: false, capEnd: true, smooth: SMOOTH.turned },
    )
    translate(urn, [ux, uy, zFloor + 0.952])
    emit('aluminum', urn)
  }
  // Beverage tower: plinth, cabinet, a NECKED dispensing gap, head and cap.
  // As one 0.44 box with a lamp on it, it was the only part of the building
  // that was a bare rectangle in silhouette.
  const [tx, ty] = at(240, 7.3)
  const towerAt = (w: number, d: number, r: number, z0: number, z1: number, slot: string, rim: number): void => {
    emit(
      slot,
      bevel(prism(roundedRect(w, d, r, 2).map(([x, y]) => [tx + x, ty + y] as Vec2), zFloor + z0, zFloor + z1), rim, 2),
    )
  }
  towerAt(0.4, 0.4, 0.03, 0.952, 1.0, 'dark', BEVEL.panel)
  towerAt(0.44, 0.44, 0.04, 1.0, 1.28, 'dark', BEVEL.carcass)
  towerAt(0.3, 0.3, 0.03, 1.28, 1.44, 'aluminum', BEVEL.panel)
  towerAt(0.44, 0.44, 0.04, 1.44, 1.66, 'dark', BEVEL.carcass)
  towerAt(0.47, 0.47, 0.05, 1.66, 1.71, 'aluminum', BEVEL.panel)
  emit(
    'utilityLight',
    bevel(
      prism(roundedRect(0.24, 0.05, 0.012, 2).map(([x, y]) => [tx + x, ty + y - 0.155] as Vec2), zFloor + 1.4, zFloor + 1.43),
      0.005,
      1,
    ),
  )
  lenses += 1

  arcColliders(shell, services, (rFront + rBack) / 2, a0, a1, zFloor + 0.48, 0.96, rBack - rFront, 5)
  arcColliders(shell, services, (g0 + g1) / 2, a0, a1, zFloor + 1.08, 2.16, g1 - g0, 3)
  return lenses
}

// ------------------------------------------------------------------- clinic

/**
 * CLINIC: a 6.5 x 1.9 m nook behind a glazed screen with a 1.1 m doorway. The
 * screen head stops at 2.62 m so the ceiling coves wash over the top of it and
 * the nook reads as a room inside a room, not a box bolted to the wall.
 */
function clinic(shell: CommonsShell, services: DistrictServices): number {
  const { emit, world, zFloor } = shell
  const { a0, a1 } = CLINIC
  const rScreen = 6.6
  const rBack = 8.5
  const zHead = 2.62
  const doorHalf = 0.55 / rScreen
  const doorMid = (a0 + a1) / 2
  let lenses = 0

  for (const a of [a0, a1]) {
    const wall = prismYZ(
      [
        [rScreen, zFloor],
        [rBack, zFloor],
        [rBack, zFloor + zHead],
        [rScreen, zFloor + zHead],
      ] as Vec2[],
      -0.045,
      0.045,
    )
    rotateZ(wall, a - Math.PI / 2)
    emit('cast', wall)
  }
  // Every run stops clear of the members that terminate it: the end walls are
  // 45 mm half-width, the doorway jambs 30 mm, and each gets a 5 mm reveal on
  // top. Running the dado into its own jamb is a cross-slot clash at four
  // places, and it is invisible until the audit names it.
  const endClear = 0.05 / rScreen
  const jambClear = 0.035 / rScreen
  for (const [s0, s1] of [
    [a0 + endClear, doorMid - doorHalf - jambClear],
    [doorMid + doorHalf + jambClear, a1 - endClear],
  ]) {
    emit('cast', sector(rScreen + 0.045, rScreen - 0.045, s0, s1, zFloor, zFloor + 1.02, 0.008, 0.5))
    emit('aluminum', sector(rScreen + 0.05, rScreen - 0.05, s0, s1, zFloor + 1.02, zFloor + 1.09, 0.006, 0.5))
    // `cabinGlass`, not `darkGlass`: darkGlass is opaque and nothing lit behind
    // it reads through (notes.md, W2 commons).
    emit('cabinGlass', sector(rScreen + 0.008, rScreen - 0.008, s0 + 0.02, s1 - 0.02, zFloor + 1.102, zFloor + zHead - 0.102, 0.003, 0.5))
  }
  emit('aluminum', sector(rScreen + 0.05, rScreen - 0.05, a0 + endClear, a1 - endClear, zFloor + zHead - 0.09, zFloor + zHead, 0.006, 0.5))
  for (const s of [doorMid - doorHalf, doorMid + doorHalf]) {
    const jamb = prismYZ(
      [
        [rScreen - 0.055, zFloor],
        [rScreen + 0.055, zFloor],
        [rScreen + 0.055, zFloor + zHead - 0.09],
        [rScreen - 0.055, zFloor + zHead - 0.09],
      ] as Vec2[],
      -0.03,
      0.03,
    )
    rotateZ(jamb, s - Math.PI / 2)
    emit('aluminum', jamb)
  }

  // Examination cot: a welded tube frame, a padded deck and a raised bolster.
  const cotPhi = (292 * Math.PI) / 180
  const cot: MeshData[] = []
  const pads: MeshData[] = []
  for (const sy of [-0.32, 0.32]) {
    cot.push(
      smoothShade(
        tubeAlong(
          [
            [-0.92, sy, 0.02],
            [-0.92, sy, 0.6],
            [0.92, sy, 0.6],
            [0.92, sy, 0.02],
          ],
          roundedRect(0.036, 0.036, 0.01, 2),
          { up: [0, 1, 0], cap: true },
        ),
        SMOOTH.moulded,
      ),
    )
  }
  // The deck swallows the side rails' top (both `aluminum`, so it welds) rather
  // than landing level with them: two tops on one plane is a flicker, not a
  // joint, and it does not matter that they are the same material.
  cot.push(bevel(prism(roundedRect(1.9, 0.68, 0.05, 3), 0.6, 0.646), BEVEL.carcass, 2))
  pads.push(smoothShade(bevel(prism(roundedRect(1.86, 0.66, 0.06, 3), 0.65, 0.742), BEVEL.soft, 3), SMOOTH.shell))
  pads.push(
    smoothShade(
      bevel(prism(roundedRect(0.46, 0.6, 0.07, 3).map(([x, y]) => [x - 0.66, y] as Vec2), 0.746, 0.838), BEVEL.soft, 3),
      SMOOTH.shell,
    ),
  )
  const [cotX, cotY] = at(292, 7.75)
  const cotCenter = world(cotX, cotY, zFloor)
  const cotYaw = faceYaw(cotPhi)
  placeParts(services.writer, bakeParts({ aluminum: cot, fabricBlue: pads } as SlotParts), cotCenter, cotYaw)
  services.seats.push({ seat: placedPoint([0, 0, 0.742], cotCenter, cotYaw), yaw: lookYaw(cotPhi + Math.PI), label: 'Rest' })
  services.colliders.push({ kind: 'box', center: world(cotX, cotY, zFloor + 0.4), size: new Vector3(1.94, 0.8, 0.72), yaw: cotPhi })

  // Supply cabinet against the drum, with a lit reveal under its head.
  const cab0 = (318 * Math.PI) / 180
  const cab1 = (329 * Math.PI) / 180
  emit('dark', sector(8.42, 8.004, cab0, cab1, zFloor, zFloor + 0.11, 0.005, 0.4))
  emit('cast', sector(8.42, 7.98, cab0, cab1, zFloor + 0.11, zFloor + 2.0, 0.008, 0.4))
  for (let d = 0; d < 3; d++) {
    emit(
      'aluminum',
      sector(
        7.974,
        7.95,
        cab0 + ((cab1 - cab0) * d) / 3 + 0.005,
        cab0 + ((cab1 - cab0) * (d + 1)) / 3 - 0.005,
        zFloor + 0.16,
        zFloor + 1.94,
        0.005,
        0.35,
      ),
    )
  }
  // The head reveal's strip is fixed to the CARCASS face (7.98) on the usual
  // 4 mm butt, and is 10 mm proud of the door leaves under it. At 7.90…7.944 it
  // hung 36 mm off the only surface above the doors that could carry it.
  emit('interiorGlow', sector(7.98 - BUTT, 7.94, cab0 + 0.01, cab1 - 0.01, zFloor + 1.955, zFloor + 1.985, 0.003, 0.4))
  lenses += 1
  arcColliders(shell, services, 8.2, cab0, cab1, zFloor + 1.0, 2.0, 0.46, 1)

  // Wall screen: back box, a bezel that is a real FRAME, and the panel sitting
  // in its opening on a 12 mm reveal.
  //
  // The bezel has to be four members. As one solid sector 8.37…8.398 it
  // enclosed the panel's whole 8.382…8.386 band on every axis — the screen was
  // not recessed behind the bezel, it was inside it, invisible and clashing.
  // The panel now runs back to a BUTT reveal off the tray face (8.40) instead
  // of hanging 14 mm off it in the dark.
  const sc0 = (302 * Math.PI) / 180
  const sc1 = (312 * Math.PI) / 180
  // Panel extent; the frame's opening is this plus a 2 mm reveal all round, so
  // no member ever lies over the screen's face.
  const scA0 = sc0 + 0.006
  const scA1 = sc1 - 0.006
  const scZ0 = zFloor + 1.18
  const scZ1 = zFloor + 1.82
  const scRev = 0.002 / 8.39
  emit('dark', sector(8.46, 8.4, sc0, sc1, zFloor + 1.16, zFloor + 1.84, 0.006, 0.4))
  for (const [z0, z1] of [
    [zFloor + 1.14, scZ0 - 0.002],
    [scZ1 + 0.002, zFloor + 1.86],
  ]) {
    emit('aluminum', sector(8.398, 8.37, sc0 - 0.004, sc1 + 0.004, z0, z1, 0.005, 0.4))
  }
  for (const [s0, s1] of [
    [sc0 - 0.004, scA0 - scRev],
    [scA1 + scRev, sc1 + 0.004],
  ]) {
    emit('aluminum', sector(8.398, 8.37, s0, s1, scZ0 - 0.002, scZ1 + 0.002, 0.005, 0.4))
  }
  emit('signageGlow', sector(8.4 - BUTT, 8.382, scA0, scA1, scZ0, scZ1, 0, 0.4))
  lenses += 1

  for (const a of [a0, a1]) {
    services.colliders.push({
      kind: 'box',
      center: world(Math.cos(a) * ((rScreen + rBack) / 2), Math.sin(a) * ((rScreen + rBack) / 2), zFloor + zHead / 2),
      size: new Vector3(0.12, zHead, rBack - rScreen),
      yaw: tangentYaw(a),
    })
  }
  for (const [s0, s1] of [
    [a0, doorMid - doorHalf],
    [doorMid + doorHalf, a1],
  ]) {
    arcColliders(shell, services, rScreen, s0, s1, zFloor + zHead / 2, zHead, 0.14, 1)
  }
  return lenses
}

// --------------------------------------------------------------- wayfinding

/**
 * Wayfinding: one directory totem inside the doors and two fascia plates over
 * the galley and the clinic. Every plate sits in a bezel with a `signageGlow`
 * wash behind its edge — an emissive face with no depth reads as paint.
 */
function wayfinding(shell: CommonsShell, services: DistrictServices): number {
  const { emit, world, zFloor } = shell
  let lenses = 0

  /** A backlit plate hung on the drum, reading INWARD to the hall. */
  const fascia = (a0: number, a1: number, rFace: number, zc: number, lines: string[]): void => {
    const half = 0.2
    const railH = 0.05
    emit('dark', sector(rFace + 0.06, rFace, a0, a1, zc - half, zc + half, 0.008, 0.5))
    for (const s of [-1, 1]) {
      // The rails stop 3 mm inside the tray's top and bottom faces. Sharing
      // those planes puts two same-facing surfaces on one plane over the whole
      // length of both signs — invisible head-on, a flicker from below.
      emit(
        'aluminum',
        sector(rFace - 0.004, rFace - 0.05, a0 + 0.004, a1 - 0.004, zc + s * (half - railH), zc + s * (half - 0.003), 0.006, 0.5),
      )
      // The wash is 14 mm of exposed face held 40 mm inside the ends. It is on
      // the 3.4 rung and the plate under it is not emissive at all, so the
      // strip wins any size contest — the AREA is the only control the ladder
      // gives you, and two neon tubes flanking the type is not the look.
      emit(
        'signageGlow',
        sector(
          rFace - 0.006,
          rFace - 0.03,
          a0 + 0.04 / rFace,
          a1 - 0.04 / rFace,
          zc + s * (half - railH) - s * 0.019,
          zc + s * (half - railH) - s * 0.005,
          0,
          0.5,
        ),
      )
      lenses += 1
    }
    const width = (a1 - a0) * rFace * 0.88
    // The plate's HEIGHT is the tray's clear field — between the two wash
    // strips (their inner edges are `half − railH − 0.019` off centre), less a
    // 4 mm reveal each side. Deriving it from the plate's own width instead put
    // a 0.544 m plate on a 0.40 m tray: it stood 72 mm past the tray top and
    // bottom into open air, and because it hangs at rFace − 0.02, inside the
    // rails' own 7.83…7.876 band, it ran straight THROUGH both of them.
    const height = 2 * (half - railH - 0.019) - 0.008
    // A FLAT plate on this drum is a CHORD: at r 7.88 a 1.94 m plate's ends
    // recede 60 mm, which is past the tray's own inner face, so 42 % of the
    // fascia (48 % on the tighter clinic radius) was buried inside the tray
    // behind it. Bend the POSITIONS onto the drum and leave the UVs alone —
    // that is exactly an unrolled cylinder, so the type still reads true — and
    // the plate stands 20 mm proud the whole way across.
    const geometry = new PlaneGeometry(width, height, 16, 1)
    {
      const pos = geometry.attributes.position
      const r = rFace - 0.02
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getX(i) / r
        pos.setX(i, r * Math.sin(t))
        pos.setZ(i, pos.getZ(i) + r * (1 - Math.cos(t)))
      }
      pos.needsUpdate = true
      geometry.computeVertexNormals()
    }
    const plate = new Mesh(
      geometry,
      signageMaterial(lines, { background: '#131110', widthPx: 640, aspect: width / height }),
    )
    const am = (a0 + a1) / 2
    plate.position.copy(world(Math.cos(am) * (rFace - 0.02), Math.sin(am) * (rFace - 0.02), zc))
    plate.rotation.y = Math.atan2(-Math.cos(am), -Math.sin(am))
    plate.castShadow = false
    plate.receiveShadow = false
    plate.name = 'commons-wayfinding'
    services.group.add(plate)
  }

  fascia(GALLEY.a0 + 0.1, GALLEY.a0 + 0.38, 7.88, zFloor + 2.44, ['GALLEY'])
  fascia(CLINIC.a0 + 0.08, CLINIC.a0 + 0.42, 6.53, zFloor + 2.2, ['CLINIC'])

  // Directory totem just inside the doors, off the walking line — and off the
  // entrance pots, which stand at 76.5 and 103.5 deg on r 7.5 with a 0.46 m
  // bowl. The first placement put it 91 mm from one of them.
  //
  // The blade's two faces look RADIALLY (the plate is offset ±79 mm along the
  // radius), so the INWARD one is read across the hall — straight through the
  // column ring at r 6.05. At 112 deg it sat 0.5 deg off the column at 112.5
  // and that face was almost entirely hidden by it. The free arc here is
  // 97.5…118 (entrance below, helical stair above), so the totem goes to the
  // bottom of it: at 100 deg the 0.62 m blade spans 97.4…102.6, its nearest
  // edge is 1.04 m off the column axis, and the 103.5 deg pot is 0.38 m clear
  // of the foot. It also reads better there — first thing past the doors.
  const tDeg = 100
  const tPhi = (tDeg * Math.PI) / 180
  const [tx, ty] = at(tDeg, 6.9)
  const foot = revolve(
    [
      [0, 0],
      [0.19, 0],
      [0.19, 0.026],
      [0.1, 0.06],
      [0.09, 0.1],
      [0, 0.1],
    ],
    18,
    { capStart: true, capEnd: true, smooth: SMOOTH.turned },
  )
  translate(foot, [tx, ty, zFloor])
  emit('dark', foot)
  emit(
    'aluminum',
    bevel(
      prism(
        roundedRect(0.09, 0.62, 0.02, 2)
          .map(([r, t]) => polar(tPhi, r, t))
          .map(([x, y]) => [tx + x, ty + y] as Vec2),
        zFloor + 0.09,
        zFloor + 2.24,
      ),
      BEVEL.frame,
      2,
    ),
  )
  for (const s of [-1, 1]) {
    // The blade's face is at radial ±0.045; the plate tray stands 3 mm proud.
    emit(
      'dark',
      bevel(
        prism(
          roundedRect(0.026, 0.58, 0.008, 2)
            .map(([r, t]) => polar(tPhi, r + s * 0.061, t))
            .map(([x, y]) => [tx + x, ty + y] as Vec2),
          zFloor + 0.9,
          zFloor + 2.12,
        ),
        BEVEL.panel,
        1,
      ),
    )
    const plate = new Mesh(
      new PlaneGeometry(0.5, 1.1),
      signageMaterial(['ASSEMBLY', 'GALLEY', 'CLINIC'], {
        background: '#15120f',
        widthPx: 512,
        accent: '#c8562a',
        // PORTRAIT blade: without this the default 1:0.28 landscape canvas is
        // crushed onto a 0.45 plate and the type reads as a vertical smear.
        aspect: 0.5 / 1.1,
      }),
    )
    plate.position.copy(world(tx + Math.cos(tPhi) * s * 0.079, ty + Math.sin(tPhi) * s * 0.079, zFloor + 1.51))
    plate.rotation.y = Math.atan2(Math.cos(tPhi) * s, Math.sin(tPhi) * s)
    plate.castShadow = false
    plate.receiveShadow = false
    plate.name = 'commons-directory'
    services.group.add(plate)
  }
  services.colliders.push({
    kind: 'box',
    center: world(tx, ty, zFloor + 1.1),
    size: new Vector3(0.66, 2.2, 0.28),
    yaw: tPhi,
  })
  return lenses
}

// ----------------------------------------------------------------- planting

/** Trough planters against the glazing, plus a pair framing the doors. */
function planting(shell: CommonsShell, services: DistrictServices): void {
  const { emit, world, zFloor, leaves } = shell
  /** Scatter foliage cards on a soil surface. Cards stand from their base. */
  const plant = (px: number, py: number, pz: number, count: number, spread: number, seed: number): void => {
    for (let i = 0; i < count; i++) {
      const a = ((i * 2.39996 + seed) % (Math.PI * 2)) as number
      const rr = spread * Math.sqrt(((i * 0.618 + seed) % 1) as number)
      const matrix = new Matrix4()
      matrix.compose(
        world(px + Math.cos(a) * rr, py + Math.sin(a) * rr, pz),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a),
        new Vector3().setScalar(0.72 + ((i * 0.37 + seed) % 1) * 0.5),
      )
      leaves.push(matrix)
    }
  }

  for (const [deg, halfDeg] of [
    [12, 4.2],
    [60, 4.2],
    [110, 3.4],
    [190, 2.6],
    [262, 3.6],
    [345, 3.4],
  ] as const) {
    const a = (deg * Math.PI) / 180
    const h = (halfDeg * Math.PI) / 180
    // A trough is a VOID with walls round it. Built as ONE solid 0.70 m block
    // from the floor to 0.56, the liner (r 7.78…8.36) and the soil (7.80…8.34,
    // z 0.50…0.545) were both entirely INSIDE it: no soil was visible anywhere
    // in the hall and the foliage cards grew out of cast mineral with their
    // bases 20 mm under its top face. Base to 0.40, then four kerb walls, and
    // the soil fills what they enclose to 15 mm under the kerb.
    const kerb = zFloor + 0.4
    const endK = 0.014
    emit('cast', sector(8.42, 7.72, a - h, a + h, zFloor, kerb, 0.018, 0.4))
    emit('cast', sector(8.42, 8.3, a - h, a + h, kerb, zFloor + 0.56, 0.014, 0.4))
    emit('cast', sector(7.84, 7.72, a - h, a + h, kerb, zFloor + 0.56, 0.014, 0.4))
    for (const s of [-1, 1]) {
      const e0 = s > 0 ? a + h - endK : a - h
      emit('cast', sector(8.3, 7.84, e0, e0 + endK, kerb, zFloor + 0.56, 0.014, 0.4))
    }
    emit('dark', sector(8.296, 7.844, a - h + endK + 0.003, a + h - endK - 0.003, kerb + 0.004, zFloor + 0.5, 0.006, 0.4))
    emit('soil', sector(8.29, 7.85, a - h + endK + 0.006, a + h - endK - 0.006, kerb + 0.05, zFloor + 0.545, 0.008, 0.4))
    arcColliders(shell, services, 8.07, a - h, a + h, zFloor + 0.28, 0.56, 0.7, 1)
    const clumps = Math.max(3, Math.round((2 * h * 8.07) / 0.42))
    for (let i = 0; i < clumps; i++) {
      const ca = a - h + ((2 * h) * (i + 0.5)) / clumps
      plant(Math.cos(ca) * 8.07, Math.sin(ca) * 8.07, zFloor + 0.54, 4, 0.19, deg + i)
    }
  }
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 + s * 0.235
    const px = Math.cos(a) * 7.5
    const py = Math.sin(a) * 7.5
    const pot = revolve(
      [
        [0, 0],
        [0.38, 0],
        [0.42, 0.09],
        [0.44, 0.52],
        [0.46, 0.58],
        [0.42, 0.62],
        [0.38, 0.575],
        [0, 0.56],
      ],
      26,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(pot, [px, py, zFloor])
    emit('cast', pot)
    const bed = revolve(
      [
        [0, 0],
        [0.372, 0],
        [0.372, 0.02],
        [0, 0.03],
      ],
      20,
      { capStart: false, capEnd: true },
    )
    // The pot is nearly solid: its inside is a shallow dish running from z 0.56
    // at the axis up to 0.575 at r 0.38, and the rim is 0.62. So the bed stands
    // ON that dish (0.575) and the planting datum is its own domed top, not the
    // 0.53/0.55 pair — those put the whole bed, and the base of every card,
    // inside the pot's own material.
    translate(bed, [px, py, zFloor + 0.575])
    emit('soil', bed)
    plant(px, py, zFloor + 0.6, 16, 0.3, s > 0 ? 1.3 : 4.1)
    services.colliders.push({
      kind: 'cylinder',
      center: world(px, py, zFloor + 0.31),
      halfHeight: 0.31,
      radius: 0.47,
    })
  }
}

// ----------------------------------------------------------------- pendants

/** Pendant luminaires: the lantern drop over the assembly, plus a hall ring. */
function pendants(shell: CommonsShell): number {
  const { emit, zSoffit, zLantern } = shell
  let count = 0
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
  const hang = (px: number, py: number, top: number, drop: number): void => {
    emit(
      'dark',
      smoothShade(
        tubeAlong(
          [
            [px, py, top - drop],
            [px, py, top],
          ],
          circle(0.008, 6),
          { cap: false },
        ),
        SMOOTH.turned,
      ),
    )
    const s = shade.clone()
    translate(s, [px, py, top - drop - 0.34])
    emit('aluminum', s)
    const b = bulb.clone()
    translate(b, [px, py, top - drop - 0.36])
    emit('interiorGlow', b)
    count += 1
  }
  for (let i = 0; i < 6; i++) {
    const phi = (i / 6) * Math.PI * 2 + 0.2
    hang(Math.cos(phi) * 3.05, Math.sin(phi) * 3.05, zLantern, 6.3)
  }
  // Hall ring. It breaks over the stair (the flight is at head height there)
  // and over the CLINIC for the same kind of reason: the shade is 0.27 m across
  // on r 6.55 and hangs z 2.56…2.88, and the clinic's screen line is r
  // 6.55…6.65 up to 2.816 with its fascia at 6.53. A shade centre therefore
  // needs (0.27 + 0.045 + 0.05) / 6.55 = 3.2 deg of clear angle off the 282 and
  // 332 deg end walls — 280 was 2 deg off one of them and 308 was inside the
  // nook's glazing, its head rail AND the CLINIC plate.
  for (const deg of [12, 40, 68, 100, 196, 224, 252, 276, 336]) {
    const phi = (deg * Math.PI) / 180
    hang(Math.cos(phi) * 6.55, Math.sin(phi) * 6.55, zSoffit - 0.02, 1.5)
  }
  return count
}

// ------------------------------------------------------------------ gallery

/** Reading tables on the gallery, against the upper glazing. */
function galleryFitOut(shell: CommonsShell, services: DistrictServices): void {
  const { world, zL2Top } = shell
  const table = roundTableParts()
  for (const deg of [26, 62, 98, 206, 242, 278, 314, 350]) {
    const phi = (deg * Math.PI) / 180
    const spot = world(Math.cos(phi) * 9.4, Math.sin(phi) * 9.4, zL2Top)
    placeParts(services.writer, table, spot, 0)
    services.colliders.push({
      kind: 'cylinder',
      center: spot.clone().setY(spot.y + 0.37),
      halfHeight: 0.37,
      radius: 0.42,
    })
    for (const s of [-1, 1]) {
      const a = phi + s * 0.075
      const seatR = s > 0 ? 8.7 : 10.1
      placeChairAt(shell, services, Math.cos(a) * seatR, Math.sin(a) * seatR, s > 0 ? phi : phi + Math.PI, zL2Top)
    }
  }
}

/** `placeChair` on a datum other than the ground floor. */
function placeChairAt(
  shell: CommonsShell,
  services: DistrictServices,
  px: number,
  py: number,
  facing: number,
  z: number,
): void {
  const parts = chairParts()
  const center = shell.world(px, py, z)
  const yaw = faceYaw(facing)
  placeParts(services.writer, parts.soups, center, yaw)
  services.seats.push({ seat: placedPoint(parts.seat, center, yaw), yaw: lookYaw(facing), label: 'Sit and look out' })
}

// -------------------------------------------------------------------- build

export function buildCommonsInterior(shell: CommonsShell, services: DistrictServices): void {
  floorFinish(shell)
  const coves = ceiling(shell)
  hallColumns(shell, services)
  mezzanine(shell, services)
  stair(shell, services)
  assembly(shell, services)
  const galleyLenses = galley(shell, services)
  const clinicLenses = clinic(shell, services)
  const signLenses = wayfinding(shell, services)
  planting(shell, services)
  const pendantCount = pendants(shell)
  galleryFitOut(shell, services)

  // Ground-floor slab collider. The finished floor is dead flat, so one
  // cylinder is exact; the apron under it falls 84 mm across the pad and is a
  // separate surface. This is the 196 mm step the guest takes at the threshold,
  // well inside the controller's 0.42 m autostep.
  services.colliders.push({
    kind: 'cylinder',
    center: shell.world(0, 0, shell.zFloor - 0.2),
    halfHeight: 0.2,
    radius: shell.rGlass - 0.22,
  })

  // Bookkeeping for the artificial-light audit. Nothing here asks for a real
  // light: the drum already carries `commons-entry`, and at this scale the
  // ladder's currency is emissive AREA, which ~90 m of cove has in abundance.
  const rig = lightFixtures()
  rig.registerGlowPool({
    id: 'commons-coves',
    slot: 'interiorGlow',
    count: coves,
    position: [shell.x, shell.baseY + shell.zSoffit, shell.z],
  })
  rig.registerGlowPool({
    id: 'commons-pendants',
    slot: 'interiorGlow',
    count: pendantCount,
    position: [shell.x, shell.baseY + shell.zSoffit - 1.8, shell.z],
  })
  rig.registerGlowPool({
    id: 'commons-fitout',
    slot: 'interiorGlow',
    count: galleyLenses + clinicLenses,
    position: [shell.x, shell.baseY + shell.zFloor + 1.2, shell.z],
  })
  rig.registerGlowPool({
    id: 'commons-wayfinding',
    slot: 'signageGlow',
    count: signLenses,
    position: [shell.x, shell.baseY + shell.zFloor + 2.3, shell.z],
  })
}
