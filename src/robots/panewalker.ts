import { Group } from 'three'
import {
  Forge,
  ensureCCW,
  filletBox,
  pipe,
  prism,
  revolveY,
  rotateX,
  rotateY,
  rotateZ,
  roundedRect,
  translate,
  tube,
} from './forge'
import type { Solid, V3 } from './forge'
import { robotMaterials } from './robotMaterials'
import {
  DOME_CENTER_Y,
  DOME_SPHERE_RADIUS,
  domeCraneRailLift,
  PANEWALKER_THETA_MAX,
  PANEWALKER_THETA_MIN,
} from '../dome/latticeField'

/**
 * The Panewalker — the dome's glass-washing gantry.
 *
 * It is a REAL machine, not a swept tube: two curved rail shoes ride ring ribs
 * at θ_min and θ_max, each on a pair of four-wheel bogies that grip the rib
 * head; a square box truss (four chords, posts, K-diagonals, gusseted nodes)
 * spans the ~100 m of meridian between them; three brush carriages hang off the
 * lower chords on rack columns, each with a rotating brush drum, a trailing
 * squeegee blade, a wash-fluid tank and a hose run back to the trunk main.
 *
 * All geometry derives from the dome constants (READ ONLY here) — retune the
 * shell and the gantry re-fits itself. It is built at longitude 0 and the
 * routine spins the whole group about Y to walk it round, which is why the
 * truss must be modelled on the φ = 0 meridian.
 */

// Truss lower chord stand-off from the glass: the sparse-gridshell crane rail
// now FLIES over the deep rib/collar line (`domeCraneRailLift`), so the chord
// clears the higher of the two rail heads plus a 0.22 m running margin.
const LIFT_LOWER =
  Math.max(domeCraneRailLift(PANEWALKER_THETA_MIN), domeCraneRailLift(PANEWALKER_THETA_MAX)) + 0.22
const TRUSS_DEPTH = 1.35 // lower chord -> upper chord
const TRUSS_HALF_WIDTH = 0.8 // half the truss width in the φ direction
const BAYS = 16

/** Point on the dome shell at longitude 0, lifted radially outward. */
export function shellPoint(theta: number, lift: number): V3 {
  const r = DOME_SPHERE_RADIUS + lift
  return [Math.sin(theta) * r, DOME_CENTER_Y + Math.cos(theta) * r, 0]
}

/** Same, offset sideways along the local φ direction (metres, not radians). */
function shellPointAcross(theta: number, lift: number, across: number): V3 {
  const p = shellPoint(theta, lift)
  return [p[0], p[1], p[2] + across]
}

/** Outward radial unit vector at θ on the φ = 0 meridian. */
function radial(theta: number): V3 {
  return [Math.sin(theta), Math.cos(theta), 0]
}

const lerpTheta = (t: number): number =>
  PANEWALKER_THETA_MIN + (PANEWALKER_THETA_MAX - PANEWALKER_THETA_MIN) * t

export function buildPanewalker(): Group {
  const materials = robotMaterials('gantry')
  const forge = new Forge()
  const group = new Group()

  // ---------------------------------------------------------------- chords
  // Four chords follow the shell arc; the truss keeps constant section, so the
  // arch is a real curved space frame instead of four straight pipes.
  const chordPath = (lift: number, across: number): V3[] =>
    Array.from({ length: BAYS * 2 + 1 }, (_, k) =>
      shellPointAcross(lerpTheta(k / (BAYS * 2)), lift, across),
    )
  const chordLifts = [LIFT_LOWER, LIFT_LOWER + TRUSS_DEPTH]
  for (const lift of chordLifts) {
    for (const across of [-TRUSS_HALF_WIDTH, TRUSS_HALF_WIDTH]) {
      forge.add('paint', pipe(chordPath(lift, across), 0.11, { seg: 10, smooth: 40 }))
    }
  }

  // ------------------------------------------------------- posts + diagonals
  for (let bay = 0; bay <= BAYS; bay++) {
    const t = bay / BAYS
    const theta = lerpTheta(t)
    for (const across of [-TRUSS_HALF_WIDTH, TRUSS_HALF_WIDTH]) {
      forge.add('paint', pipe(
        [shellPointAcross(theta, LIFT_LOWER, across), shellPointAcross(theta, LIFT_LOWER + TRUSS_DEPTH, across)],
        0.06,
        { seg: 8, smooth: 40 },
      ))
    }
    // Transverse ties top and bottom.
    for (const lift of chordLifts) {
      forge.add('paint', pipe(
        [shellPointAcross(theta, lift, -TRUSS_HALF_WIDTH), shellPointAcross(theta, lift, TRUSS_HALF_WIDTH)],
        0.055,
        { seg: 8, smooth: 40 },
      ))
    }
    // Gusset plates at the nodes — the detail that makes a truss read welded.
    for (const across of [-TRUSS_HALF_WIDTH, TRUSS_HALF_WIDTH]) {
      for (const lift of chordLifts) {
        const p = shellPointAcross(theta, lift, across)
        const n = radial(theta)
        const plate = prism(
          ensureCCW([
            [-0.34, -0.12],
            [0.34, -0.12],
            [0.28, 0.2],
            [-0.28, 0.2],
          ]),
          'z',
          -0.014,
          0.014,
          { roll: 0.006, rollSeg: 1, smooth: 30 },
        )
        // Plate lies IN the meridian plane, face normal along φ: only the
        // shell tilt is applied, never an extra quarter turn (that stands the
        // gusset on edge and it reads as a black blade).
        rotateZ(plate, Math.atan2(n[0], n[1]) * -1)
        translate(plate, [p[0], p[1], p[2] + Math.sign(across) * 0.02])
        forge.add('alloy', plate)
      }
    }
    if (bay === BAYS) continue
    const theta1 = lerpTheta((bay + 1) / BAYS)
    // K-bracing on both flanks, plus a plan diagonal top and bottom.
    for (const across of [-TRUSS_HALF_WIDTH, TRUSS_HALF_WIDTH]) {
      const mid = (theta + theta1) / 2
      forge.add('alloy', pipe(
        [shellPointAcross(theta, LIFT_LOWER, across), shellPointAcross(mid, LIFT_LOWER + TRUSS_DEPTH, across)],
        0.038,
        { seg: 6, smooth: 40 },
      ))
      forge.add('alloy', pipe(
        [shellPointAcross(mid, LIFT_LOWER + TRUSS_DEPTH, across), shellPointAcross(theta1, LIFT_LOWER, across)],
        0.038,
        { seg: 6, smooth: 40 },
      ))
    }
    for (const lift of chordLifts) {
      forge.add('alloy', pipe(
        [
          shellPointAcross(theta, lift, -TRUSS_HALF_WIDTH),
          shellPointAcross(theta1, lift, TRUSS_HALF_WIDTH),
        ],
        0.032,
        { seg: 6, smooth: 40 },
      ))
    }
  }

  // --------------------------------------------------------- walkway + rail
  // Maintenance grating along the top chord, with a stanchion handrail: the
  // machine is serviced by people in suits, so it carries a walkway.
  for (let bay = 0; bay < BAYS; bay++) {
    const t0 = lerpTheta(bay / BAYS)
    const t1 = lerpTheta((bay + 1) / BAYS)
    const lift = LIFT_LOWER + TRUSS_DEPTH + 0.14
    const a = shellPointAcross(t0, lift, 0)
    const b = shellPointAcross(t1, lift, 0)
    const deck = filletBox(
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0],
      [Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.06, 0.05, TRUSS_HALF_WIDTH * 2 - 0.1],
      0.02,
      { seg: 1, smooth: 28 },
    )
    rotateZ(deck, Math.atan2(b[1] - a[1], b[0] - a[0]), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0])
    forge.add('alloy', deck)
  }
  for (const across of [-TRUSS_HALF_WIDTH + 0.06, TRUSS_HALF_WIDTH - 0.06]) {
    const railPath = Array.from({ length: BAYS + 1 }, (_, k) =>
      shellPointAcross(lerpTheta(k / BAYS), LIFT_LOWER + TRUSS_DEPTH + 1.16, across),
    )
    forge.add('hazard', pipe(railPath, 0.028, { seg: 8, smooth: 40 }))
    for (let post = 0; post <= BAYS; post += 2) {
      const theta = lerpTheta(post / BAYS)
      forge.add('hazard', pipe(
        [
          shellPointAcross(theta, LIFT_LOWER + TRUSS_DEPTH + 0.14, across),
          shellPointAcross(theta, LIFT_LOWER + TRUSS_DEPTH + 1.16, across),
        ],
        0.02,
        { seg: 6, smooth: 40 },
      ))
    }
  }

  // ------------------------------------------------------- rail shoes/bogies
  for (const [theta, sign] of [
    [PANEWALKER_THETA_MIN, -1],
    [PANEWALKER_THETA_MAX, 1],
  ] as const) {
    buildRailShoe(forge, theta, sign)
  }

  // ------------------------------------------------------ service trunk main
  // Wash fluid runs the length of the truss and drops to each carriage.
  const trunk = Array.from({ length: BAYS * 2 + 1 }, (_, k) =>
    shellPointAcross(lerpTheta(k / (BAYS * 2)), LIFT_LOWER + 0.28, TRUSS_HALF_WIDTH - 0.22),
  )
  forge.add('alloy', pipe(trunk, 0.045, { seg: 8, smooth: 40 }))
  for (let clip = 2; clip < BAYS * 2; clip += 4) {
    const p = trunk[clip]
    forge.add('dark', filletBox([p[0], p[1], p[2]], [0.09, 0.09, 0.05], 0.012, { seg: 1, smooth: 28 }))
  }

  // ------------------------------------------------------- brush carriages
  for (const t of [0.2, 0.5, 0.8]) {
    buildBrushCarriage(forge, lerpTheta(t))
  }

  group.add(forge.build(materials, { castShadow: false }))
  return group
}

/**
 * A rail shoe rides ONE ring rib — a circle of constant θ — so its beams run
 * in φ (along the rib) and its bogie wheels straddle the rib in θ (across it).
 * Getting that pair of directions the right way round is the whole difference
 * between a machine that grips the dome and a girder lying on it.
 */
function buildRailShoe(forge: Forge, theta: number, outward: number): void {
  const R = DOME_SPHERE_RADIUS
  const ringRadius = R * Math.sin(theta)
  const halfSpan = 2.1 / ringRadius // radians of φ for a 4.2 m shoe
  /** General shell point: θ offset (metres), radial lift, longitude. */
  const point = (acrossRib: number, lift: number, phi: number): V3 => {
    const t = theta + acrossRib / R
    const r = (R + lift) * Math.sin(t)
    return [r * Math.cos(phi), DOME_CENTER_Y + (R + lift) * Math.cos(t), r * Math.sin(phi)]
  }

  // Shoe beams: two curved box rails, one either side of the rib head. The
  // section is seeded with the SHELL NORMAL as its up vector — a default +Y
  // seed leaves the box standing vertical on a 35 deg slope and the whole
  // shoe reads as a girder dropped on the dome rather than fitted to it.
  const normal: V3 = [Math.sin(theta), Math.cos(theta), 0]
  // Everything in the shoe re-bases on the flying crane rail at this ring:
  // wheel treads run AT the rail head, shoe beams hang 0.22 m under it.
  const railLift = domeCraneRailLift(theta)
  for (const acrossRib of [-0.46, 0.46]) {
    const path = Array.from({ length: 9 }, (_, k) =>
      point(acrossRib, railLift - 0.22, (k / 8 - 0.5) * halfSpan * 2),
    )
    forge.add('paint', tube(path, roundedRect(0.4, 0.3, 0.06, 2), { smooth: 32, up: normal }))
  }
  // Cross ties bind the two rails into one shoe, on the same section frame.
  for (const end of [-1, 1] as const) {
    const tie = Array.from({ length: 5 }, (_, k) =>
      point(-0.46 + (k / 4) * 0.92, railLift - 0.22, end * halfSpan * 0.86),
    )
    forge.add('alloy', tube(tie, roundedRect(0.26, 0.24, 0.05, 2), { smooth: 32, up: normal }))
  }

  // Legs up to the truss lower chord (the truss is 1.6 m wide in φ).
  for (const across of [-TRUSS_HALF_WIDTH, TRUSS_HALF_WIDTH]) {
    const phi = across / ringRadius
    forge.add('paint', pipe(
      [point(0, railLift - 0.12, phi), point(0, LIFT_LOWER + 0.04, phi)],
      0.085,
      { seg: 8, smooth: 40 },
    ))
    forge.add('alloy', pipe(
      [point(outward * 0.42, railLift - 0.12, phi), point(outward * 0.06, LIFT_LOWER + 0.9, phi * 0.6)],
      0.05,
      { seg: 6, smooth: 40 },
    ))
  }

  // Bogies: two per shoe, four flanged wheels each, clamping the rib head.
  for (const bogie of [-1, 1] as const) {
    const phi = bogie * halfSpan * 0.55
    for (const acrossRib of [-0.46, 0.46]) {
      const at = point(acrossRib, railLift - 0.22, phi)
      const frame = filletBox([0, 0, 0], [0.3, 0.26, 1.0], 0.05, { seg: 2, smooth: 30 })
      rotateZ(frame, -theta)
      rotateY(frame, -phi)
      translate(frame, at)
      forge.add('alloy', frame)
      for (const along of [-0.28, 0.28]) {
        // Flanged rail wheel: the flange is what keeps it on the rib.
        const wheel = revolveY(
          [
            [0.06, -0.055],
            [0.2, -0.055],
            [0.2, -0.028],
            [0.16, -0.02],
            [0.16, 0.05],
            [0.06, 0.055],
          ],
          { segments: 14, smooth: 34 },
        )
        // Wheel axis runs across the rib (θ), so lay +Y onto that direction.
        rotateZ(wheel, Math.PI / 2)
        rotateZ(wheel, -theta)
        rotateY(wheel, -phi)
        // Captive rollers hugging the single flying crane rail (r 0.08 on
        // the ring centreline): faces graze the rail sides with a 10 mm
        // lap. The old ±0.34 stance flanked a rail that no longer exists
        // there — a 0.2 m air gap each side (experience-audit finding).
        translate(wheel, point(Math.sign(acrossRib) * 0.125, railLift, phi + along / ringRadius))
        forge.add('dark', wheel)
      }
      if (bogie > 0) {
        const can = revolveY(
          [
            [0, -0.16],
            [0.13, -0.16],
            [0.14, -0.12],
            [0.14, 0.12],
            [0.13, 0.16],
            [0, 0.16],
          ],
          { segments: 14, smooth: 38 },
        )
        rotateZ(can, Math.PI / 2)
        rotateZ(can, -theta)
        rotateY(can, -phi)
        translate(can, point(acrossRib + Math.sign(acrossRib) * 0.22, railLift + 0.07, phi))
        forge.add('dark', can)
      }
    }
  }

  // Warning beacon at each shoe end, clear of the truss, riding the shoe.
  for (const end of [-1, 1] as const) {
    const phi = end * halfSpan * 0.8
    const foot = point(0, railLift + 0.2, phi)
    const head = point(0, railLift + 0.65, phi)
    forge.add('dark', pipe([foot, head], 0.05, { seg: 8 }))
    forge.add('beacon', revolveY(
      [
        [0, 0],
        [0.17, 0.02],
        [0.18, 0.14],
        [0.12, 0.24],
        [0, 0.27],
      ],
      { segments: 16, smooth: 44, center: head },
    ))
  }
}

function shellPointAcrossLocal(theta: number, lift: number, across: number): V3 {
  const p = shellPoint(theta, lift)
  return [p[0], p[1], p[2] + across]
}

/**
 * A brush carriage: a rack column dropped from the lower chords to the glass,
 * a counter-rotating brush drum, a trailing squeegee blade on spring arms, a
 * wash tank and the hose that feeds it.
 */
function buildBrushCarriage(forge: Forge, theta: number): void {
  const n = radial(theta)
  const tilt = Math.atan2(n[0], n[1]) // rotation that lays a part on the shell
  const at = (lift: number, across: number): V3 => shellPointAcrossLocal(theta, lift, across)
  const onShell = (part: Solid, lift: number, across: number): Solid => {
    rotateZ(part, -tilt)
    return translate(part, at(lift, across))
  }

  // Rack columns from the lower chords down to the carriage body.
  for (const across of [-0.78, 0.78]) {
    forge.add('alloy', pipe([at(LIFT_LOWER + 0.05, across), at(0.24, across)], 0.07, { seg: 8, smooth: 40 }))
    // Rack teeth: the column is a real height adjuster.
    for (let tooth = 0; tooth < 7; tooth++) {
      const lift = 0.32 + tooth * 0.055
      forge.add('dark', onShell(
        filletBox([0, 0, 0], [0.05, 0.026, 0.11], 0.008, { seg: 1, smooth: 28 }),
        lift,
        across,
      ))
    }
  }

  // Carriage body: a tapered housing lying on the shell.
  forge.add('paint', onShell(
    filletBox([0, 0, 0], [0.58, 0.42, 2.7], 0.09, { seg: 2, smooth: 30 }),
    0.34,
    0,
  ))
  forge.add('accent', onShell(
    filletBox([0, 0, 0], [0.42, 0.12, 2.5], 0.04, { seg: 2, smooth: 30 }),
    0.58,
    0,
  ))

  // Wash tank on top, with a sight strip and a filler cap.
  const tank = revolveY(
    [
      [0, -0.42],
      [0.25, -0.42],
      [0.28, -0.36],
      [0.28, 0.36],
      [0.25, 0.42],
      [0, 0.42],
    ],
    { segments: 16, smooth: 38 },
  )
  rotateX(tank, Math.PI / 2)
  forge.add('alloy', onShell(tank, 0.84, 0.86))
  forge.add('dark', onShell(
    revolveY([[0, 0], [0.07, 0.005], [0.075, 0.05], [0.05, 0.06]], { segments: 12, smooth: 40 }),
    1.13,
    0.86,
  ))

  // Brush drum: a lathed core with bristle rows, sitting against the glass.
  const drum = revolveY(
    [
      [0, -1.2],
      [0.13, -1.2],
      [0.16, -1.14],
      [0.16, 1.14],
      [0.13, 1.2],
      [0, 1.2],
    ],
    { segments: 14, smooth: 38 },
  )
  rotateX(drum, Math.PI / 2)
  forge.add('dark', onShell(drum, 0.12, -0.34))
  for (let row = 0; row < 10; row++) {
    const a = (row / 10) * Math.PI * 2
    const bristle = prism(
      roundedRect(0.06, 0.26, 0.024, 1),
      'z',
      -1.12,
      1.12,
      { roll: 0.01, rollSeg: 1, smooth: 34 },
    )
    rotateZ(bristle, a)
    // rotateZ maps +Y onto (-sin, cos): the row offsets along its OWN up.
    translate(bristle, [-Math.sin(a) * 0.19, Math.cos(a) * 0.19, 0])
    forge.add('bristle', onShell(bristle, 0.12, -0.34))
  }

  // Squeegee: a blade on two sprung arms, trailing the drum.
  for (const across of [-1.05, 0, 1.05]) {
    forge.add('alloy', pipe([at(0.4, across * 0.86), at(0.14, across)], 0.036, { seg: 6, smooth: 40 }))
  }
  forge.add('hazard', onShell(
    filletBox([0, 0, 0], [0.12, 0.2, 2.5], 0.04, { seg: 2, smooth: 30 }),
    0.09,
    1.0,
  ))
  forge.add('dark', onShell(
    filletBox([0, 0, 0], [0.06, 0.12, 2.46], 0.014, { seg: 1, smooth: 28 }),
    0.02,
    1.0,
  ))

  // Hose from the trunk main into the tank: a real catenary droop.
  const hose: V3[] = Array.from({ length: 7 }, (_, k) => {
    const t = k / 6
    const lift = LIFT_LOWER + 0.28 + (0.86 - LIFT_LOWER - 0.28) * t - Math.sin(t * Math.PI) * 0.28
    return at(lift, TRUSS_HALF_WIDTH - 0.22 + (0.72 - TRUSS_HALF_WIDTH + 0.22) * t)
  })
  forge.add('dark', pipe(hose, 0.03, { seg: 6, smooth: 40 }))

  // Work lamps: the carriage lights its own patch of glass.
  for (const across of [-0.55, 0.55]) {
    forge.add('beacon', onShell(
      revolveY([[0, 0], [0.07, 0.004], [0.072, 0.03], [0.05, 0.045]], { segments: 12, smooth: 42 }),
      0.5,
      across,
    ))
  }
}

/** Arc facts other systems may want (swath sizing, audio placement). */
export const PANEWALKER_ARC = {
  thetaMin: PANEWALKER_THETA_MIN,
  thetaMax: PANEWALKER_THETA_MAX,
  arcLength: DOME_SPHERE_RADIUS * (PANEWALKER_THETA_MAX - PANEWALKER_THETA_MIN),
}
