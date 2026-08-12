import { Vector2, Vector3 } from 'three'
import { SMOOTH, cleanMesh, loft, smoothShade, toYUp, writeInto } from '../archkit/meshdata'
import type { Vec3 } from '../archkit/meshdata'
import type { PartWriter } from '../archkit/writer'
import {
  BASIN_INNER_R,
  BAY_POCKET_DROP,
  COLUMN_RADIUS,
  COPING_TOP_Y,
  COVE_DEPTH,
  COVE_HEIGHT,
  COVE_Y,
  FINIAL_Y,
  JETS_INWARD,
  JETS_OUTWARD,
  LENS_SETBACK,
  LOWER_TAZZA,
  NOZZLE_MOUTH_REACH,
  NOZZLE_SHOULDER_DROP,
  PEDESTAL_BASE_R,
  PEDESTAL_TOP_Y,
  PLINTH_STEPS,
  PODIUM_Y,
  STYLOBATE_STEPS,
  TAZZA_RIM_BAND,
  UPLIGHTS,
  UPPER_TAZZA,
  WATER_Y,
  basinFloorY,
  bayWeight,
  planterBays,
  tazzaDripRadius,
  tazzaDripY,
  tazzaUndersideY,
  wallThickness,
} from './fountainPlan'
import type { TazzaSpec } from './fountainPlan'
import { jetSolve } from './waterStreams'

/**
 * THE STONEWORK.
 *
 * Everything here is a SWEEP — a lathe or a ring loft — because every piece of
 * this object is a turned or run profile in the real world too: the stylobate
 * is a run step, the coping is a run moulding on a scalloped plan, the tazze
 * are turned bowls. Nothing is assembled from boxes, so there are no mitres to
 * open and no coplanar stacks to flicker.
 *
 * ## The three joinery rules this file obeys
 *
 * 1. **Buried joints, never kissed ones.** Where two solids meet (floor into
 *    wall, wall into podium, island into floor, step onto step) the upper part
 *    starts 50–80 mm BELOW the surface it lands on. Two closed solids sharing
 *    an interior is invisible; two closed solids sharing a FACE is a z-fight.
 *    Every `previousTop − 0.05` in this file is that rule.
 * 2. **Water datums are read, never re-derived.** Anything that has to relate
 *    to the water line takes `WATER_Y` from `fountainPlan`.
 * 3. **Profiles carry the edge treatment.** There is no chamfer pass: every
 *    arris here is authored as points on its own section, which is the only
 *    way a bullnose survives a scalloped plan.
 *
 * ## Winding
 *
 * `loft` runs `recalcNormals`, which orients CLOSED components by signed
 * volume (so the coping wall and every lathe are safe by construction) and
 * OPEN ones by the authored winding. The one open shell here is a tazza, and
 * its section deliberately runs core → underside → over the rim → into the
 * dish, which is the direction that puts the normal outward everywhere.
 *
 * Local Y throughout — `FountainSystem` places the group at the court's top.
 */

const TAU = Math.PI * 2

/** The coping's plan is scalloped, so it needs the most stations by far. */
const WALL_SEGMENTS = 384
const LATHE_SEGMENTS = 128
const TAZZA_SEGMENTS = 192

type Ring = Vec3[]

/** A swept-ring point, authored Z-up (the archkit profile convention). */
function ringPoint(theta: number, radius: number, up: number): Vec3 {
  return [Math.cos(theta) * radius, Math.sin(theta) * radius, up]
}

/** Loft a closed ring stack, shade it, convert to world Y-up and place it. */
function emitRings(
  writer: PartWriter,
  slot: string,
  rings: Ring[],
  center: Vector3,
  options: { smooth: number; closeV?: boolean; uvScale?: number },
): void {
  const md = loft(rings, { closeU: true, closeV: options.closeV ?? true })
  smoothShade(md, options.smooth)
  cleanMesh(md)
  toYUp(md)
  for (const v of md.verts) {
    v[0] += center.x
    v[1] += center.y
    v[2] += center.z
  }
  writeInto(writer, slot, md, { uvScale: options.uvScale ?? 1 })
}

const p2 = (r: number, y: number): Vector2 => new Vector2(r, y)

/**
 * THE STYLOBATE — two monumental steps lifting the piece off the court.
 *
 * Each step is one lathe of a closed section: a tread with a real bullnose
 * nose, a riser with a slight batter, and a base disc buried 50 mm inside the
 * course below. The nose matters more than it sounds: at a 27° sun a chamfer
 * gives a soft blur and a bullnose gives the crisp lit crescent that reads as
 * cut stone from forty metres.
 */
function emitStylobate(writer: PartWriter, center: Vector3): void {
  let previousTop = -0.06
  for (const step of STYLOBATE_STEPS) {
    const base = previousTop - 0.05
    writer.lathe({
      center,
      slot: 'stone',
      segments: LATHE_SEGMENTS,
      uvScale: 0.5,
      smoothAngle: SMOOTH.cast,
      profile: [
        p2(0, base),
        p2(step.radius - 0.024, base),
        p2(step.radius - 0.006, base + 0.02),
        // Riser, battered 4 mm so the course above never overhangs air.
        p2(step.radius - 0.004, step.top - 0.03),
        p2(step.radius, step.top - 0.018),
        // The nose: three points, a true bullnose.
        p2(step.radius - 0.004, step.top - 0.004),
        p2(step.radius - 0.016, step.top),
        p2(0, step.top),
      ],
    })
    previousTop = step.top
  }
}

/**
 * THE COPING WALL — one continuous swept shell around a scalloped plan, with
 * four planter pockets moulded INTO it.
 *
 * This is the piece that decides whether the fountain reads as cast or as
 * assembled, so it is a single closed loft: 384 rings, each a 31-point closed
 * section whose outer offset breathes with the scallop and swells at the bays,
 * and whose pocket vertices sink from flush (no pocket) to 0.44 m (full
 * pocket) across a 6.6° ramp. Where the pocket is flush those quads collapse
 * to zero area and `cleanMesh` dissolves them, so a plain section costs
 * nothing — and the ramp comes out as exactly the rounded pocket end a cast
 * planter actually has.
 *
 * Section order, inner face first, up and over and back down:
 *   0…8    inner face — foot, batter, the waterline scumble, the nosing
 *   9…18   the pocket — inner lip, wall, floor, wall, outer lip
 *   19…22  coping top out to the drip nose
 *   23…26  the LED cove: a real 45 mm recess with a returned soffit
 *   27…30  outer face batter down to the buried foot
 */
function emitCopingWall(writer: PartWriter, center: Vector3): void {
  const rings: Ring[] = []
  const foot = PODIUM_Y - 0.07
  const top = COPING_TOP_Y

  for (let s = 0; s < WALL_SEGMENTS; s++) {
    const theta = (s / WALL_SEGMENTS) * TAU
    const thickness = wallThickness(theta)
    const bay = bayWeight(theta)
    const inner = BASIN_INNER_R
    const outer = BASIN_INNER_R + thickness
    // The pocket lives in the OUTER half of the wall, so the basin side keeps
    // its full 0.24 m of sitting stone whatever the bay is doing.
    const pocketInner = inner + 0.24
    const pocketOuter = outer - 0.17
    const pocketFloor = top - BAY_POCKET_DROP * bay
    // The pocket rim stands 18 mm proud of the coping so trailing planting
    // has a real edge to spill over instead of a painted line.
    const lip = top + 0.018 * bay

    const p = (radius: number, up: number): Vec3 => ringPoint(theta, radius, up)
    rings.push([
      // ── inner face (the water side)
      p(inner + 0.05, foot),
      p(inner, foot + 0.09),
      p(inner, WATER_Y - 0.05),
      // A 6 mm scumble line right at the water: the tide mark of a fountain
      // that has been running, and a hard edge for the wet mask to land on.
      p(inner - 0.006, WATER_Y),
      p(inner, WATER_Y + 0.012),
      p(inner + 0.004, top - 0.075),
      p(inner + 0.026, top - 0.03),
      p(inner + 0.03, top - 0.006),
      p(inner + 0.046, top),
      // ── the pocket
      p(pocketInner, top),
      p(pocketInner, lip),
      p(pocketInner + 0.055, lip),
      p(pocketInner + 0.075, pocketFloor + 0.03),
      p(pocketInner + 0.1, pocketFloor),
      p(pocketOuter - 0.1, pocketFloor),
      p(pocketOuter - 0.075, pocketFloor + 0.03),
      p(pocketOuter - 0.055, lip),
      p(pocketOuter, lip),
      p(pocketOuter, top),
      // ── coping top, outward to the drip nose
      p(outer - 0.046, top),
      p(outer - 0.03, top - 0.006),
      p(outer - 0.026, top - 0.03),
      p(outer - 0.004, top - 0.075),
      // ── the LED cove (a returned soffit, so the strip is never seen direct)
      p(outer, top - COVE_Y + COVE_HEIGHT * 0.5 + 0.012),
      p(outer - COVE_DEPTH, top - COVE_Y + COVE_HEIGHT * 0.5),
      p(outer - COVE_DEPTH, top - COVE_Y - COVE_HEIGHT * 0.5),
      p(outer - 0.012, top - COVE_Y - COVE_HEIGHT * 0.5 - 0.018),
      // ── outer face: a 40 mm batter to a plinth course, then buried
      p(outer, top - COVE_Y - COVE_HEIGHT * 0.5 - 0.05),
      p(outer - 0.04, PODIUM_Y + 0.12),
      p(outer - 0.028, PODIUM_Y + 0.09),
      p(outer + 0.012, PODIUM_Y + 0.07),
      p(outer + 0.012, foot),
    ])
  }
  emitRings(writer, 'stone', rings, center, { smooth: SMOOTH.cast, uvScale: 0.6 })
}

/**
 * The cove strip: a continuous lens ribbon set back inside the coping recess.
 * It follows the scalloped plan exactly, because a straight extrusion inside a
 * wavy recess would break the wall's surface wherever the two disagree.
 */
function emitCoveStrip(writer: PartWriter, center: Vector3): void {
  const rings: Ring[] = []
  const top = COPING_TOP_Y
  const high = top - COVE_Y + COVE_HEIGHT * 0.5 - 0.008
  const low = top - COVE_Y - COVE_HEIGHT * 0.5 + 0.008
  for (let s = 0; s < WALL_SEGMENTS; s++) {
    const theta = (s / WALL_SEGMENTS) * TAU
    const outer = BASIN_INNER_R + wallThickness(theta) - COVE_DEPTH + LENS_SETBACK
    const p = (radius: number, up: number): Vec3 => ringPoint(theta, radius, up)
    rings.push([p(outer - 0.014, low), p(outer, low + 0.006), p(outer, high - 0.006), p(outer - 0.014, high)])
  }
  emitRings(writer, 'lens', rings, center, { smooth: SMOOTH.moulded })
}

/**
 * Planter soil: a domed surface inside each pocket, 160 mm under the lip. The
 * pocket footprints come from `planterBays()`, the same description the
 * planting reads — soil can never be poured where the wall did not open one.
 */
function emitBaySoil(writer: PartWriter, center: Vector3): void {
  for (const bay of planterBays()) {
    const rInner = bay.rInner - 0.09
    const rOuter = bay.rOuter + 0.09
    const steps = 10
    const arcs = 26
    const point = (i: number, j: number): Vector3 => {
      const u = i / steps
      const v = j / arcs
      const radius = rInner + (rOuter - rInner) * u
      const angle = bay.theta + (v * 2 - 1) * bay.halfArc * 1.09
      // Domed: soil mounds in the middle of a planter, it never lies flat.
      const dome = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * 0.045
      return new Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + bay.soilY + dome,
        center.z + Math.sin(angle) * radius,
      )
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < arcs; j++) {
        writer.quad('soil', point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1), 0.6)
      }
    }
  }
}

/**
 * The basin floor: a shallow dish running from under the island out UNDER the
 * coping's inner face, as a closed annular course whose underside buries in
 * the top step. Both edges are hidden inside neighbouring solids, so this
 * surface has no visible boundary anywhere.
 */
function emitBasinFloor(writer: PartWriter, center: Vector3): void {
  const inner = PLINTH_STEPS[0].radius - 0.14
  const outer = BASIN_INNER_R + 0.07
  const base = PODIUM_Y - 0.08
  const radialSteps = 20
  // PROFILE DIRECTION IS LOAD-BEARING. This part is an ANNULUS, so its loft is
  // topologically open (two boundary loops) even though the profile closes on
  // itself, and `recalcNormals` therefore keeps the AUTHORED winding rather
  // than orienting by volume. A lathe whose top run goes outward faces DOWN
  // and vanishes into back-face culling. Run the underside outward and the top
  // back inward, and the top faces up.
  const profile: Vector2[] = [p2(inner, base), p2(outer, base)]
  for (let i = radialSteps; i >= 0; i--) {
    const radius = inner + (outer - inner) * (i / radialSteps)
    profile.push(p2(radius, basinFloorY(radius)))
  }
  profile.push(p2(inner, base))
  writer.lathe({
    center,
    slot: 'basinFloor',
    profile,
    segments: LATHE_SEGMENTS,
    uvScale: 1,
    smoothAngle: SMOOTH.top,
  })
}

/**
 * THE ISLAND — three stepped rings and the moulded pedestal.
 *
 * The first riser starts BELOW the water and comes 145 mm out of it, which is
 * the detail that makes the figure group read as standing IN water rather than
 * on a plinth that happens to be wet. Each nosing is a bullnose, and each
 * tread falls 8 mm outward so water sheets off instead of pooling.
 */
function emitIsland(writer: PartWriter, center: Vector3): void {
  let previousTop = basinFloorY(PLINTH_STEPS[0].radius) - 0.06
  for (const step of PLINTH_STEPS) {
    const base = previousTop - 0.05
    writer.lathe({
      center,
      // Risers live in the splash and treads run with it: below the splash
      // ceiling this is permanently wet stone, above it the dry material's
      // own automatic wetting takes over. One material change, at the height
      // where the physical difference actually is.
      slot: step.top < WATER_Y + 0.55 ? 'stoneWet' : 'stone',
      segments: LATHE_SEGMENTS,
      uvScale: 0.8,
      smoothAngle: SMOOTH.cast,
      profile: [
        p2(0, base),
        p2(step.radius - 0.03, base),
        p2(step.radius - 0.008, base + 0.02),
        p2(step.radius - 0.004, step.top - 0.05),
        p2(step.radius, step.top - 0.032),
        p2(step.radius - 0.005, step.top - 0.006),
        p2(step.radius - 0.022, step.top),
        // 8 mm fall back toward the axis so the tread drains.
        p2(step.radius - 0.3, step.top + 0.008),
        p2(0, step.top + 0.008),
      ],
    })
    previousTop = step.top + 0.008
  }

  // The pedestal: plinth block, cyma recta, dado, corbelled cap. A classical
  // socle read straight off a section — which is why its silhouette holds at
  // forty metres where a tapered cylinder would read as a bollard.
  const seat = PLINTH_STEPS[PLINTH_STEPS.length - 1].top
  writer.lathe({
    center,
    slot: 'stone',
    segments: LATHE_SEGMENTS,
    uvScale: 0.9,
    smoothAngle: SMOOTH.cast,
    profile: [
      p2(0, seat - 0.05),
      p2(PEDESTAL_BASE_R, seat - 0.05),
      p2(PEDESTAL_BASE_R, seat + 0.1),
      p2(PEDESTAL_BASE_R - 0.03, seat + 0.13),
      // Cyma recta: out-curve into in-curve, five points, no shortcut.
      p2(PEDESTAL_BASE_R - 0.055, seat + 0.18),
      p2(PEDESTAL_BASE_R - 0.13, seat + 0.25),
      p2(PEDESTAL_BASE_R - 0.2, seat + 0.33),
      p2(PEDESTAL_BASE_R - 0.24, seat + 0.4),
      // Dado.
      p2(PEDESTAL_BASE_R - 0.26, seat + 0.44),
      p2(PEDESTAL_BASE_R - 0.26, PEDESTAL_TOP_Y - 0.17),
      // Cap moulding, corbelled back out to carry the figures' feet.
      p2(PEDESTAL_BASE_R - 0.2, PEDESTAL_TOP_Y - 0.13),
      p2(PEDESTAL_BASE_R - 0.11, PEDESTAL_TOP_Y - 0.08),
      p2(PEDESTAL_BASE_R - 0.08, PEDESTAL_TOP_Y - 0.035),
      p2(PEDESTAL_BASE_R - 0.09, PEDESTAL_TOP_Y - 0.012),
      p2(PEDESTAL_BASE_R - 0.115, PEDESTAL_TOP_Y),
      p2(0, PEDESTAL_TOP_Y),
    ],
  })
}

/**
 * The central column the four figures stand around: a fluted shaft carrying
 * the lower tazza's real load path down to the pedestal. Twenty flutes with
 * fillets, run as a ring loft — a lathe cannot flute — and given a 3 % entasis
 * at a third height, without which a 2.2 m shaft reads pinched in the middle.
 */
function emitColumn(writer: PartWriter, center: Vector3): void {
  const flutes = 20
  const bottom = PEDESTAL_TOP_Y - 0.04
  const top = LOWER_TAZZA.coreY + 0.05
  const stations: Array<[number, number]> = [
    [bottom, 1.14],
    [bottom + 0.06, 1.07],
    [bottom + 0.16, 1.0],
    [bottom + 0.78, 1.03],
    [top - 0.46, 0.99],
    [top - 0.22, 0.95],
    [top - 0.11, 1.05],
    [top - 0.035, 1.13],
    [top, 1.15],
  ]
  const segments = flutes * 6
  const rings: Ring[] = stations.map(([y, scale]) => {
    const ring: Ring = []
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * TAU
      // A cosine hollow with a fillet; the `pow` is the fillet, flattening the
      // crest between hollows into a real arris band rather than a knife edge.
      const hollow = Math.pow(Math.abs(Math.cos((flutes * theta) / 2)), 1.6)
      ring.push(ringPoint(theta, COLUMN_RADIUS * scale - 0.016 * hollow, y))
    }
    return ring
  })
  emitRings(writer, 'stone', rings, center, { smooth: 26, uvScale: 1.2 })
}

/**
 * A TAZZA — the turned bowl, with a gadrooned (fluted) underside.
 *
 * A ring loft rather than a lathe, because the gadroons are an angular
 * modulation: each ring's radius is reduced by a lobed term whose amplitude
 * peaks across the underside belly and tapers to ZERO at both the core and the
 * rim. That taper is the whole trick — gadroons that run out onto the rim
 * moulding turn a bowl into a gear.
 *
 * The shell is emitted as TWO v-slices of the SAME ring set, split exactly at
 * the rim's drip arris: dry carved stone below it, permanently running wet
 * stone above and inside. Because both slices index the same vertices, the
 * split cannot gap or overlap — and it lands on a hard edge, so the shading
 * break the split implies is one the geometry wanted anyway.
 *
 * Both ends of the section are buried: the underside core inside the column,
 * the dish centre inside the stem's foot. So an open shell has no visible
 * boundary and needs no cap.
 */
function emitTazza(writer: PartWriter, center: Vector3, spec: TazzaSpec): void {
  const profile: Array<{ r: number; y: number; gadroon: number }> = []
  const push = (r: number, y: number, gadroon: number): void => {
    profile.push({ r, y, gadroon })
  }

  // Underside: core out to the rim, a real dome. `t` drives the gadroon taper
  // — 0 at the core, full across the belly, 0 into the rim moulding.
  const under = 22
  for (let i = 0; i <= under; i++) {
    const t = i / under
    const r = spec.dishCenterR + (spec.rimR - spec.dishCenterR) * t
    const taper = Math.sin(Math.min(1, Math.max(0, (t - 0.05) / 0.86)) * Math.PI)
    // `tazzaUndersideY` is shared with the figures' reach: one curve.
    push(r, tazzaUndersideY(spec, r), taper)
  }
  // The rim moulding. Three rules, all paid for:
  //
  //  - The gadroons stop BEFORE the moulding (taper is already 0 at the dome's
  //    last station, and every moulding point is authored at 0). A lobe that
  //    reaches into the ovolo scallops it ±15 mm, and at grazing light that
  //    reads as alternating bright/dark patches along the whole rim.
  //  - The roll is DENSE: ~150° of section turn over 10 edges keeps every
  //    dihedral under the 40° smooth-shade threshold. Five points left some
  //    edges welded and some broken — the same patchy banding, from shading.
  //  - The DRIP ARRIS (`tazzaDripY/R`) is the section's outermost point, and
  //    everything below it is undercut. The first pass put the widest bulge
  //    BELOW the shedding lip, which is backwards: the falling curtain has to
  //    clear the stone, so the stone must retreat under the edge that sheds.
  const band = TAZZA_RIM_BAND
  const dripR = tazzaDripRadius(spec)
  const dripY = tazzaDripY(spec)
  // Undercut: from the dome's edge out to the arris, hollowing as it goes.
  push(spec.rimR + 0.004, spec.rimTopY - band * 0.94, 0)
  push(spec.rimR + 0.014, spec.rimTopY - band * 0.72, 0)
  push(spec.rimR + 0.021, spec.rimTopY - band * 0.55, 0)
  push(spec.rimR + 0.033, spec.rimTopY - band * 0.44, 0)
  const dripIndex = profile.length
  push(dripR, dripY, 0)
  // The ovolo above the arris: out-facing roll up to the lip.
  push(dripR - 0.002, spec.rimTopY - band * 0.24, 0)
  push(dripR - 0.011, spec.rimTopY - band * 0.12, 0)
  push(dripR - 0.024, spec.rimTopY - band * 0.04, 0)
  push(spec.rimR + 0.002, spec.rimTopY - 0.004, 0)
  // Over the top and down into the dish.
  push(spec.rimR - 0.012, spec.rimTopY, 0)
  push(spec.dishRimR, spec.dishRimY, 0)
  push(spec.dishRimR * 0.88, spec.dishCenterY + (spec.dishRimY - spec.dishCenterY) * 0.44, 0)
  push(spec.dishRimR * 0.56, spec.dishCenterY + (spec.dishRimY - spec.dishCenterY) * 0.13, 0)
  push(spec.dishCenterR + 0.07, spec.dishCenterY, 0)
  push(spec.dishCenterR, spec.dishCenterY - 0.006, 0)

  const rings: Ring[] = []
  for (let s = 0; s < TAZZA_SEGMENTS; s++) {
    const theta = (s / TAZZA_SEGMENTS) * TAU
    const lobe = Math.pow(Math.abs(Math.cos((spec.gadroons * theta) / 2)), 1.35)
    rings.push(
      profile.map(({ r, y, gadroon }) => ringPoint(theta, r - spec.gadroonDepth * gadroon * lobe, y)),
    )
  }
  emitRings(
    writer,
    'stone',
    rings.map((ring) => ring.slice(0, dripIndex + 1)),
    center,
    { smooth: SMOOTH.turned, closeV: false, uvScale: 1 },
  )
  emitRings(
    writer,
    'stoneWet',
    rings.map((ring) => ring.slice(dripIndex)),
    center,
    { smooth: SMOOTH.turned, closeV: false, uvScale: 1 },
  )
}

/**
 * The upper stage: a turned baluster stem from the lower dish up to the upper
 * tazza's core, and the bronze crown nozzle the vertical jet leaves from.
 */
function emitStem(writer: PartWriter, center: Vector3): void {
  const bottom = LOWER_TAZZA.dishCenterY - 0.05
  // The baluster is authored as FRACTIONS of the span it has to bridge, so
  // re-proportioning either bowl moves the mouldings with it instead of
  // leaving the neck short (or punching it through the upper core).
  const span = UPPER_TAZZA.coreY + 0.06 - bottom
  const at = (f: number): number => bottom + span * f
  writer.lathe({
    center,
    slot: 'stone',
    segments: LATHE_SEGMENTS,
    uvScale: 1.1,
    smoothAngle: SMOOTH.turned,
    profile: [
      p2(0, bottom),
      p2(0.42, bottom),
      p2(0.4, at(0.045)),
      // Torus foot.
      p2(0.34, at(0.085)),
      p2(0.3, at(0.135)),
      // The baluster's pear: a swell, then a long neck.
      p2(0.33, at(0.215)),
      p2(0.35, at(0.325)),
      p2(0.33, at(0.445)),
      p2(0.26, at(0.565)),
      p2(0.2, at(0.675)),
      p2(0.175, at(0.765)),
      // Astragal, then the neck into the upper bowl's core.
      p2(0.21, at(0.805)),
      p2(0.2, at(0.83)),
      p2(0.17, at(0.86)),
      p2(0.19, at(0.955)),
      p2(0.24, at(1)),
      p2(0, at(1)),
    ],
  })

  // The crown nozzle. Bored: the profile returns down the inside, so it is a
  // real tube with a mouth rather than a solid cone with a decal on top.
  writer.lathe({
    center,
    slot: 'bronze',
    segments: 48,
    uvScale: 1.6,
    smoothAngle: SMOOTH.turned,
    profile: [
      p2(0, UPPER_TAZZA.dishCenterY - 0.02),
      p2(0.16, UPPER_TAZZA.dishCenterY - 0.02),
      p2(0.155, UPPER_TAZZA.dishCenterY + 0.04),
      p2(0.11, UPPER_TAZZA.dishCenterY + 0.075),
      p2(0.105, FINIAL_Y - 0.13),
      p2(0.075, FINIAL_Y - 0.095),
      p2(0.072, FINIAL_Y - 0.03),
      p2(0.055, FINIAL_Y - 0.008),
      p2(0.042, FINIAL_Y),
      p2(0.03, FINIAL_Y - 0.055),
      p2(0.03, FINIAL_Y - 0.11),
      p2(0, FINIAL_Y - 0.115),
    ],
  })
}

/**
 * A jet assembly: floor flange, vertical riser, canted head, mouth ring.
 *
 * The riser matters. The first pass drew only the canted head at the launch
 * height, so sixteen bronze stubs hung 30 cm above the basin floor with
 * nothing holding them — the owner's "these nozzles are floating mid air".
 * A fountain orifice is plumbed: it stands on a spigot rising from the floor
 * slab, and the spigot is the thing that makes the water look SUPPLIED rather
 * than emitted by nothing.
 */
function emitNozzle(
  writer: PartWriter,
  center: Vector3,
  x: number,
  z: number,
  y: number,
  tilt: number,
  bearing: number,
): void {
  const radius = Math.hypot(x, z)
  const floor = basinFloorY(radius)
  // Flange: a low bronze pad bedded into the floor slab, its underside buried.
  writer.lathe({
    center: new Vector3(center.x + x, center.y, center.z + z),
    slot: 'bronze',
    segments: 20,
    uvScale: 3,
    smoothAngle: SMOOTH.turned,
    profile: [
      p2(0, floor - 0.05),
      p2(0.11, floor - 0.05),
      p2(0.11, floor + 0.022),
      p2(0.085, floor + 0.04),
      p2(0.055, floor + 0.04),
      p2(0, floor + 0.04),
    ],
  })
  // Riser: a plain spigot from the flange up to the head's shoulder.
  const shoulder = y - NOZZLE_SHOULDER_DROP
  writer.tube({
    path: [
      new Vector3(center.x + x, center.y + floor + 0.01, center.z + z),
      new Vector3(center.x + x, center.y + (floor + shoulder) * 0.5, center.z + z),
      new Vector3(center.x + x, center.y + shoulder, center.z + z),
    ],
    radius: 0.038,
    slot: 'bronze',
    radialSegments: 12,
    uvScale: 3,
  })
  // Head: canted along the launch vector the ballistic solve produced, so the
  // hardware points exactly where the water goes.
  const axis = new Vector3(
    Math.cos(bearing) * Math.cos(tilt),
    Math.sin(tilt),
    Math.sin(bearing) * Math.cos(tilt),
  )
  const pivot = new Vector3(center.x + x, center.y + shoulder, center.z + z)
  writer.tube({
    path: [
      pivot.clone().addScaledVector(axis, -0.045),
      pivot.clone().addScaledVector(axis, 0.055),
      pivot.clone().addScaledVector(axis, 0.115),
    ],
    radius: 0.043,
    slot: 'bronze',
    radialSegments: 12,
    capStart: true,
    uvScale: 3,
  })
  // The mouth: a thin ring standing 6 mm proud of the head, so the orifice
  // reads as an opening and the stream has a lip to leave from. Its outer
  // face is at NOZZLE_MOUTH_REACH along the cant — the same point `jetSolve`
  // launches the water from, which is the whole reason that constant is in
  // the plan rather than typed here.
  writer.tube({
    path: [
      pivot.clone().addScaledVector(axis, NOZZLE_MOUTH_REACH - 0.02),
      pivot.clone().addScaledVector(axis, NOZZLE_MOUTH_REACH),
    ],
    radius: 0.028,
    slot: 'bronze',
    radialSegments: 12,
    capEnd: true,
    uvScale: 4,
  })
}

/** Submerged uplights: a bronze can bedded in the floor with a flush lens. */
function emitUplights(writer: PartWriter, center: Vector3): void {
  const floor = basinFloorY(UPLIGHTS.radius)
  for (let i = 0; i < UPLIGHTS.count; i++) {
    const theta = ((i + 0.5) / UPLIGHTS.count) * TAU
    const seat = new Vector3(
      center.x + Math.cos(theta) * UPLIGHTS.radius,
      center.y,
      center.z + Math.sin(theta) * UPLIGHTS.radius,
    )
    writer.lathe({
      center: seat,
      slot: 'bronze',
      segments: 24,
      uvScale: 3,
      smoothAngle: SMOOTH.turned,
      profile: [
        p2(0, floor - 0.09),
        p2(0.125, floor - 0.09),
        p2(0.125, floor + 0.045),
        p2(0.11, floor + 0.062),
        // The bezel returns inward over the lens, so the lamp is never seen
        // straight on from the coping — you see what it LIGHTS, not the lamp.
        p2(0.084, floor + 0.062),
        p2(0.084, floor + 0.03),
        p2(0, floor + 0.03),
      ],
    })
    writer.disc(new Vector3(seat.x, center.y + floor + 0.034, seat.z), 0.082, 'lens', {
      segments: 24,
      uvScale: 4,
    })
  }
}

/**
 * Build every stone and bronze part into the shared writer. `center` is the
 * fountain axis at the court's paved top, in WORLD coordinates.
 */
export function buildFountainStone(writer: PartWriter, center: Vector3): void {
  emitStylobate(writer, center)
  emitCopingWall(writer, center)
  emitCoveStrip(writer, center)
  emitBaySoil(writer, center)
  emitBasinFloor(writer, center)
  emitIsland(writer, center)
  emitColumn(writer, center)
  emitTazza(writer, center, LOWER_TAZZA)
  emitTazza(writer, center, UPPER_TAZZA)
  emitStem(writer, center)

  // Jet nozzles, both sets. The tilt is the launch angle of the DRAG-AWARE
  // flight solve in `waterStreams.ts` — the stream and the hardware it leaves
  // are one number, not two that have to be kept in sync by hand. (Through
  // the habitat's air that angle is ~5° flatter than the vacuum identity
  // atan(4·rise/span): drag steals horizontal run, so the solve launches
  // faster and lower to land on the same ring.)
  for (const set of [JETS_INWARD, JETS_OUTWARD]) {
    const inward = set === JETS_INWARD
    const { cant } = jetSolve(set)
    for (let i = 0; i < set.count; i++) {
      const theta = (i / set.count) * TAU + set.phase
      const bearing = inward ? theta + Math.PI : theta
      emitNozzle(
        writer,
        center,
        Math.cos(theta) * set.nozzleR,
        Math.sin(theta) * set.nozzleR,
        set.nozzleY,
        cant,
        bearing,
      )
    }
  }
  emitUplights(writer, center)
}
