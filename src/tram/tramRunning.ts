import {
  join,
  prism,
  revolveY,
  rotateZ,
  roundedRect,
  setSlot,
  translate,
  tubeAlong,
  unifyOrient,
} from './tramMesh'
import type { MeshData, SlotMesh, Vec2, Vec3 } from './tramMesh'
import { BEAM_HALF_W, RUNNING_Y } from './tramShape'

/**
 * Running gear — the part that explains how the vehicle works. THE LOOP is a
 * rubber-tyred, centre-beam guided people mover: two load tyres per bogie sit
 * on the guideway's wear strips, and four horizontal guide wheels per bogie
 * grip the beam FLANKS. That is the steering, so it is deliberately left
 * visible below the skirt line rather than faired over.
 *
 * Datums (car-local): beam top −0.62, wear-strip top −0.57, beam flanks at
 * x = ±0.675. The tyre radius is chosen so the tread sinks 3 mm into the wear
 * strip — a visible gap at a contact point is the defect
 * (experience-craft §5.2.10).
 */

const BOGIE_Z = 2.45
const TYRE_R = 0.238
const AXLE_Y = RUNNING_Y + TYRE_R - 0.003
const TYRE_X = 0.42
const FRAME_X = 0.62
const GUIDE_R = 0.13
const GUIDE_X = BEAM_HALF_W + GUIDE_R - 0.004
const GUIDE_Y = -0.85
/** Outside-frame plates. They must clear the beam (±0.675) AND the guide
 *  wheels (out to ±0.935), so the bogie hangs its wheels INBOARD off a pair
 *  of drop plates — the straddle-monorail arrangement, and the reason the
 *  running gear reads as machinery instead of table legs. */
const PLATE_IN = 0.95
const PLATE_OUT = 1.022

/** Load tyre: a real section — bead, rim well, sidewall bulge, crowned
 *  tread with shoulder radii. Lathed about Y, then laid onto the X axle. */
function loadTyre(): MeshData {
  const hw = 0.098
  const profile: Vec2[] = [
    [0.0, -hw],
    [0.062, -hw],
    [0.078, -hw + 0.012],
    [0.098, -hw + 0.014],
    [0.104, -hw + 0.03],
    [0.148, -hw + 0.036],
    [0.196, -hw + 0.012],
    [0.222, -hw + 0.03],
    [TYRE_R - 0.006, -hw + 0.052],
    [TYRE_R, -hw + 0.072],
    [TYRE_R, hw - 0.072],
    [TYRE_R - 0.006, hw - 0.052],
    [0.222, hw - 0.03],
    [0.196, hw - 0.012],
    [0.148, hw - 0.036],
    [0.104, hw - 0.03],
    [0.098, hw - 0.014],
    [0.078, hw - 0.012],
    [0.062, hw],
    [0.0, hw],
  ]
  const tyre = revolveY(profile, 30, { smooth: 40 })
  unifyOrient(tyre)
  return rotateZ(tyre, Math.PI / 2)
}

/** Alloy wheel centre inside the tyre: dished web, hub boss, 6 studs. */
function wheelCentre(): MeshData {
  const hw = 0.098
  const web: Vec2[] = [
    [0.0, -0.03],
    [0.058, -0.032],
    [0.062, 0.004],
    [0.11, 0.022],
    [0.155, 0.03],
    [0.175, hw - 0.03],
    [0.175, hw - 0.012],
    [0.13, hw - 0.014],
    [0.09, hw - 0.02],
    [0.052, hw - 0.052],
    [0.0, hw - 0.054],
  ]
  const parts: MeshData[] = [rotateZ(unifyOrient(revolveY(web, 26, { smooth: 40 })), Math.PI / 2)]
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2
    const stud = revolveY(
      [
        [0.0, 0.0],
        [0.017, 0.0],
        [0.018, 0.016],
        [0.013, 0.024],
        [0.0, 0.025],
      ],
      10,
      { smooth: 50 },
    )
    unifyOrient(stud)
    rotateZ(stud, Math.PI / 2)
    translate(stud, [0.03, Math.sin(a) * 0.09, Math.cos(a) * 0.09])
    parts.push(stud)
  }
  return join(parts, 40)
}

/** Guide wheel: solid-tyred, vertical king-pin axis, running on the beam
 *  flank. Its axis is already Y, so no rotation is needed. */
function guideWheel(): MeshData {
  const profile: Vec2[] = [
    [0.0, -0.052],
    [0.042, -0.052],
    [0.046, -0.046],
    [0.046, -0.03],
    [0.088, -0.03],
    [0.092, -0.038],
    [GUIDE_R - 0.008, -0.044],
    [GUIDE_R, -0.032],
    [GUIDE_R, 0.032],
    [GUIDE_R - 0.008, 0.044],
    [0.092, 0.038],
    [0.088, 0.03],
    [0.046, 0.03],
    [0.046, 0.046],
    [0.042, 0.052],
    [0.0, 0.052],
  ]
  return unifyOrient(revolveY(profile, 22, { smooth: 40 }))
}

/** One bogie: frame, axle, wheels, guide arms, air springs, dampers, brakes. */
function bogie(slots: SlotMesh, zc: number): void {
  // Side frames — a fabricated silhouette with cope reliefs, not a slab.
  for (const sx of [-1, 1]) {
    const sil: Vec2[] = [
      [-0.145, -0.74],
      [-0.235, -0.66],
      [-0.3, -0.6],
      [-0.53, -0.6],
      [-0.55, -0.5],
      [-0.55, 0.5],
      [-0.53, 0.6],
      [-0.3, 0.6],
      [-0.235, 0.66],
      [-0.145, 0.74],
      [-0.115, 0.74],
      [-0.115, -0.74],
    ]
    const frame = prism(
      sil.map(([y, z]) => [y, z + zc] as Vec2),
      'x',
      sx * (FRAME_X - 0.038),
      sx * (FRAME_X + 0.038),
      0,
    )
    slots.add(setSlot(frame, 'dark'), 'dark')
    // Gusset plates where the frame necks down over the axle.
    for (const sz of [-1, 1]) {
      const gusset = prism(
        [
          [-0.29, zc + sz * 0.42],
          [-0.16, zc + sz * 0.42],
          [-0.16, zc + sz * 0.56],
          [-0.26, zc + sz * 0.56],
        ] as Vec2[],
        'x',
        sx * (FRAME_X - 0.075),
        sx * (FRAME_X - 0.04),
        0,
      )
      slots.add(setSlot(gusset, 'dark'), 'dark')
    }
  }
  // Transverse box beams tying the two side frames together.
  for (const sz of [-1, 1]) {
    const beam = prism(
      roundedRect(0.16, 0.2, 0.025, 2).map(([y, z]) => [y - 0.4, z + zc + sz * 0.5] as Vec2),
      'x',
      -FRAME_X + 0.02,
      FRAME_X - 0.02,
      0,
    )
    slots.add(setSlot(beam, 'dark'), 'dark')
  }
  // Axle + wheels.
  const axle = tubeAlong(
    [
      [-FRAME_X + 0.01, AXLE_Y, zc],
      [FRAME_X - 0.01, AXLE_Y, zc],
    ],
    roundedRect(0.09, 0.09, 0.044, 3),
    { smooth: 40, capStart: true, capEnd: true },
  )
  slots.add(setSlot(axle, 'alloy'), 'alloy')
  for (const sx of [-1, 1]) {
    const tyre = loadTyre()
    translate(tyre, [sx * TYRE_X, AXLE_Y, zc])
    slots.add(setSlot(tyre, 'rubber'), 'rubber')
    const centre = wheelCentre()
    if (sx < 0) {
      for (const v of centre.verts) v[0] = -v[0]
      for (const f of centre.faces) f.reverse()
    }
    translate(centre, [sx * TYRE_X, AXLE_Y, zc])
    slots.add(setSlot(centre, 'alloy'), 'alloy')
    // Inboard brake disc with a calliper straddling it, clear of the tyre.
    const disc = rotateZ(
      unifyOrient(
        revolveY(
          [
            [0.052, -0.014],
            [0.16, -0.014],
            [0.162, 0.0],
            [0.16, 0.014],
            [0.052, 0.014],
            [0.052, -0.014],
          ],
          24,
          { smooth: 40 },
        ),
      ),
      Math.PI / 2,
    )
    translate(disc, [sx * (TYRE_X - 0.16), AXLE_Y, zc])
    slots.add(setSlot(disc, 'alloy'), 'alloy')
    const calliper = prism(
      roundedRect(0.19, 0.1, 0.028, 2).map(([y, z]) => [y + AXLE_Y + 0.12, z + zc] as Vec2),
      'x',
      sx * (TYRE_X - 0.215),
      sx * (TYRE_X - 0.105),
      0,
    )
    slots.add(setSlot(calliper, 'dark'), 'dark')
  }
  // Outside drop plates: the visible mass of the bogie, buried in the skirt
  // at the top and carrying every guide wheel below it.
  for (const sx of [-1, 1]) {
    const plate = prism(
      [
        [-0.34, -0.4],
        [-0.34, 0.4],
        [-0.52, 0.4],
        [-0.66, 0.34],
        [-1.05, 0.3],
        [-1.05, -0.3],
        [-0.66, -0.34],
        [-0.52, -0.4],
      ].map(([y, z]) => [y, z + zc] as Vec2),
      'x',
      sx * PLATE_IN,
      sx * PLATE_OUT,
      0,
    )
    slots.add(setSlot(plate, 'dark'), 'dark')
    // Stiffening rib + bolt circle: the plate is a fabrication, not a slab.
    const rib = prism(
      [
        [-0.78, -0.28],
        [-0.78, 0.28],
        [-0.7, 0.28],
        [-0.7, -0.28],
      ].map(([y, z]) => [y, z + zc] as Vec2),
      'x',
      sx * (PLATE_OUT - 0.002),
      sx * (PLATE_OUT + 0.02),
      0,
    )
    slots.add(setSlot(rib, 'alloy'), 'alloy')
    for (const [by, bz] of [
      [-0.44, -0.28],
      [-0.44, 0.28],
      [-0.96, -0.2],
      [-0.96, 0.2],
    ] as const) {
      const bolt = revolveY(
        [
          [0.0, 0.0],
          [0.026, 0.0],
          [0.027, 0.014],
          [0.019, 0.022],
          [0.0, 0.023],
        ],
        10,
        { smooth: 50 },
      )
      unifyOrient(bolt)
      rotateZ(bolt, sx > 0 ? -Math.PI / 2 : Math.PI / 2)
      translate(bolt, [sx * (PLATE_OUT - 0.004), by, zc + bz])
      slots.add(setSlot(bolt, 'alloy'), 'alloy')
    }
    // Tie the plate up into the underframe (the joint is inside the skirt).
    const hanger = prism(
      [
        [-0.4, -0.42],
        [-0.4, 0.42],
        [-0.045, 0.34],
        [-0.045, -0.34],
      ].map(([y, z]) => [y, z + zc] as Vec2),
      'x',
      sx * 0.62,
      sx * PLATE_OUT,
      0,
    )
    slots.add(setSlot(hanger, 'dark'), 'dark')
  }

  // Guide wheels: a fork off the drop plate, king pin, solid-tyred wheel.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = zc + sz * 0.46
      // Outriggers fore and aft of the plate, so the guide wheel stands
      // clear of it and stays visible from the platform — this assembly IS
      // how the vehicle steers, so it is not faired over.
      for (const y of [GUIDE_Y + 0.135, GUIDE_Y - 0.135]) {
        const arm = tubeAlong(
          [
            [sx * (PLATE_IN + 0.03), y, zc + sz * 0.24],
            [sx * (GUIDE_X + 0.01), y, z],
          ],
          roundedRect(0.055, 0.062, 0.022, 3),
          { smooth: 38, capStart: true, capEnd: true },
        )
        slots.add(setSlot(arm, 'dark'), 'dark')
      }
      const pin = revolveY(
        [
          [0.0, GUIDE_Y - 0.16],
          [0.03, GUIDE_Y - 0.16],
          [0.03, GUIDE_Y + 0.14],
          [0.038, GUIDE_Y + 0.16],
          [0.0, GUIDE_Y + 0.16],
        ],
        14,
        { smooth: 40 },
      )
      unifyOrient(pin)
      translate(pin, [sx * GUIDE_X, 0, z])
      slots.add(setSlot(pin, 'alloy'), 'alloy')
      const wheel = guideWheel()
      if (sx < 0) {
        for (const v of wheel.verts) v[0] = -v[0]
        for (const f of wheel.faces) f.reverse()
      }
      translate(wheel, [sx * GUIDE_X, GUIDE_Y, z])
      slots.add(setSlot(wheel, 'rubber'), 'rubber')
    }
  }
  // Secondary suspension: two air springs and two vertical dampers.
  for (const sx of [-1, 1]) {
    const bellows = revolveY(
      [
        [0.0, -0.2],
        [0.1, -0.2],
        [0.128, -0.176],
        [0.104, -0.152],
        [0.132, -0.126],
        [0.106, -0.1],
        [0.128, -0.078],
        [0.1, -0.058],
        [0.0, -0.05],
      ],
      20,
      { smooth: 44 },
    )
    unifyOrient(bellows)
    translate(bellows, [sx * 0.5, 0, zc])
    slots.add(setSlot(bellows, 'rubber'), 'rubber')
    const plate = prism(
      roundedRect(0.3, 0.3, 0.06, 3).map(([x, z]) => [z + zc, x + sx * 0.5] as Vec2),
      'y',
      -0.215,
      -0.19,
      0,
    )
    slots.add(setSlot(plate, 'dark'), 'dark')
    const damper = tubeAlong(
      [
        [sx * 0.72, -0.5, zc + 0.28],
        [sx * 0.76, -0.09, zc + 0.36],
      ],
      roundedRect(0.055, 0.055, 0.026, 3),
      { smooth: 40, capStart: true, capEnd: true },
    )
    slots.add(setSlot(damper, 'dark'), 'dark')
    const rod = tubeAlong(
      [
        [sx * 0.755, -0.24, zc + 0.34],
        [sx * 0.775, -0.06, zc + 0.375],
      ],
      roundedRect(0.026, 0.026, 0.012, 2),
      { smooth: 40, capStart: true, capEnd: true },
    )
    slots.add(setSlot(rod, 'alloy'), 'alloy')
  }
  // Traction rod to the body bolster.
  const traction = tubeAlong(
    [
      [0, -0.34, zc - 0.72],
      [0, -0.2, zc - 1.05],
    ],
    roundedRect(0.05, 0.05, 0.024, 2),
    { smooth: 40, capStart: true, capEnd: true },
  )
  slots.add(setSlot(traction, 'alloy'), 'alloy')
}

/** Body-mounted underframe: solebars, equipment boxes, conduits, the
 *  collector shoe. Everything here is seen from the platform, under the
 *  skirt line, so none of it is a placeholder block. */
function underframe(slots: SlotMesh): void {
  for (const sx of [-1, 1]) {
    const solebar = prism(
      [
        [-0.245, -1.86],
        [-0.055, -1.86],
        [-0.055, 1.86],
        [-0.245, 1.86],
      ] as Vec2[],
      'x',
      sx * 0.57,
      sx * 0.63,
      0,
    )
    slots.add(setSlot(solebar, 'dark'), 'dark')
    // Lightening holes read as a fabricated beam, not a bar.
    for (let i = -3; i <= 3; i++) {
      const ring = revolveY(
        [
          [0.062, 0],
          [0.075, 0],
          [0.075, 0.02],
          [0.062, 0.02],
          [0.062, 0],
        ],
        14,
        { smooth: 40 },
      )
      unifyOrient(ring)
      rotateZ(ring, Math.PI / 2)
      translate(ring, [sx * 0.6, -0.15, i * 0.5])
      slots.add(setSlot(ring, 'alloy'), 'alloy')
    }
  }
  // Equipment boxes hung between the bogies.
  const boxes: Array<[number, number, number, number, string]> = [
    [-1.62, -0.42, 0.52, 0.235, 'dark'],
    [0.22, 1.5, 0.5, 0.215, 'dark'],
  ]
  for (const [z0, z1, halfX, depth, slot] of boxes) {
    const box = prism(
      roundedRect(z1 - z0, halfX * 2, 0.03, 2).map(
        ([z, x]) => [z + (z0 + z1) / 2, x] as Vec2,
      ),
      'y',
      -0.055 - depth,
      -0.05,
      0,
    )
    slots.add(setSlot(box, slot), slot)
    // Cooling louvres on the outboard face.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const zc = z0 + 0.13 + ((z1 - z0 - 0.26) * i) / 4
        const fin = prism(
          [
            [-0.05 - depth * 0.75, zc - 0.018],
            [-0.05 - depth * 0.3, zc - 0.018],
            [-0.05 - depth * 0.3, zc + 0.012],
            [-0.05 - depth * 0.75, zc + 0.012],
          ] as Vec2[],
          'x',
          sx * (halfX - 0.004),
          sx * (halfX + 0.014),
          0,
        )
        slots.add(setSlot(fin, 'alloy'), 'alloy')
      }
    }
  }
  // Cable conduits run the length of the tunnel roof.
  for (const sx of [-1, 1]) {
    const conduit = tubeAlong(
      [
        [sx * 0.36, -0.1, -3.1],
        [sx * 0.36, -0.1, 3.1],
      ],
      roundedRect(0.055, 0.045, 0.02, 3),
      { smooth: 40, capStart: true, capEnd: true },
    )
    slots.add(setSlot(conduit, 'alloy'), 'alloy')
  }
  // Power collector shoe riding the beam's side rail.
  const shoeArm = tubeAlong(
    [
      [0.62, -0.28, 0.9],
      [0.83, -0.4, 0.9],
      [0.83, -0.62, 0.9],
    ],
    roundedRect(0.05, 0.06, 0.02, 2),
    { smooth: 38, capStart: true, capEnd: true },
  )
  slots.add(setSlot(shoeArm, 'dark'), 'dark')
  const shoe = prism(
    roundedRect(0.34, 0.09, 0.02, 2).map(([z, y]) => [y - 0.72, z + 0.9] as Vec2),
    'x',
    0.79,
    0.845,
    0,
  )
  slots.add(setSlot(shoe, 'alloy'), 'alloy')
}

export function buildRunningGear(slots: SlotMesh): void {
  underframe(slots)
  for (const sz of [-1, 1]) bogie(slots, sz * BOGIE_Z)
}

export const BOGIE_CENTRES: Vec3[] = [
  [0, AXLE_Y, BOGIE_Z],
  [0, AXLE_Y, -BOGIE_Z],
]
