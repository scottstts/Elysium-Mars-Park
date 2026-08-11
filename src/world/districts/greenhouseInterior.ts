import { Mesh, PlaneGeometry, Vector3 } from 'three'
import {
  BEVEL,
  SMOOTH,
  annularPrism,
  bevel,
  box,
  circle,
  panelWithHoles,
  prism,
  prismXZ,
  prismYZ,
  revolve,
  rotateZ,
  rotX,
  roundedRect,
  smoothShade,
  translate,
  tubeAlong,
  type Hole,
  type MeshData,
  type Vec2,
  type Vec3,
} from '../../archkit/meshdata'
import type { PartWriter } from '../../archkit/writer'
import { signageMaterial } from '../../materials/library'
import {
  AISLE_ACROSS,
  HOUSE_HALF_LENGTH,
  RACK_ACROSS,
  blockZ,
  RACK_DEPTH,
  RACK_LENGTH,
  RACK_TIERS,
  RACK_TIER_0,
  RACK_TIER_PITCH,
  houseFrames,
  place,
  type HouseFrame,
} from './farmside'
import type { DistrictServices } from './types'

/**
 * GREENHOUSE HALL — the fit-out of the farmside ranges.
 *
 * Authored in the same house-local Z-up frame `farmside.ts` defines
 * (+X across, +Y along the range, +Z up from the FLOOR datum) and emitted
 * through its `place()`.
 *
 * The middle range is walkable, so it gets the full hydroponic architecture:
 * perforated shelving uprights, formed trays, NFT channels with net-pot
 * collars, drip lines with real drippers, LED bars in their extrusions on
 * hangers, a nutrient dosing skid, a tool wall, the harvest-log board, and
 * the misting manifolds. The two sealed ranges carry the same rack skeleton
 * at a lower part count — nobody walks there, and everything is read at 6 m
 * or more through glazing — but the SAME tray surfaces, because
 * `farmside.CROP_TRAYS` plants all three.
 *
 * Crops, mist sprites and any planting are the vegetation system's; this file
 * only builds the hardware they sit in.
 */

// ────────────────────────────────────────────────────────── rack geometry

/** Upright pairs sit 610 mm either side of the run centre line. */
const POST_ACROSS = RACK_DEPTH / 2 - 0.09
const RACK_BAYS = 12
const RACK_HEIGHT = RACK_TIER_0 + (RACK_TIERS - 1) * RACK_TIER_PITCH + 0.28
/** Tray planting surfaces, relative to the FLOOR datum. */
const TIER_Z = Array.from({ length: RACK_TIERS }, (_, i) => RACK_TIER_0 + i * RACK_TIER_PITCH)
const TRAY_HALF = 0.65

const tierPost = (bay: number): number => -RACK_LENGTH / 2 + (bay / RACK_BAYS) * RACK_LENGTH

/**
 * Perforated shelving upright: a 62 x 30 mm flat post punched with 14 mm
 * adjustment holes at 75 mm centres, built as a **welded vertex grid**
 * (`panelWithHoles`) so the holes are real geometry with real jambs and no
 * boolean anywhere. Rotated so the punched face looks down the aisle.
 */
let perforatedProto: MeshData | null = null
let plainProto: MeshData | null = null
let dripperProto: MeshData | null = null
let collarProto: MeshData | null = null

/** Prototypes are built once and cloned: 78 uprights is 78 welded grids. */
function perforatedUpright(): MeshData {
  if (perforatedProto) return perforatedProto.clone()
  const w = 0.062
  const h = RACK_HEIGHT
  const holes: Hole[] = []
  for (let z = 0.4; z <= 1.95; z += 0.1) holes.push([0.024, z, 0.038, z + 0.014])
  const md = panelWithHoles(w, h, 0.03, holes)
  rotateZ(md, Math.PI / 2)
  translate(md, [0.015, -w / 2, 0])
  smoothShade(md, SMOOTH.moulded)
  perforatedProto = md
  return md.clone()
}

/** Plain lipped-channel upright for the sealed ranges (read at 6 m+). */
function plainUpright(): MeshData {
  if (plainProto) return plainProto.clone()
  const md = prism(
    [
      [-0.015, -0.031],
      [0.015, -0.031],
      [0.015, 0.031],
      [0.006, 0.031],
      [0.006, -0.019],
      [-0.006, -0.019],
      [-0.006, 0.031],
      [-0.015, 0.031],
    ],
    0,
    RACK_HEIGHT,
  )
  smoothShade(md, SMOOTH.moulded)
  plainProto = md
  return md.clone()
}

/**
 * Formed tray: a 1.30 m pan with 34 mm upstands and a rolled lip, drawn as a
 * real 3 mm sheet section. The planting surface is z = 0 in this section, so
 * it lands exactly on `CROP_TRAYS`' tier height.
 */
const TRAY_SECTION: Vec2[] = [
  [-0.618, 0],
  [0.618, 0],
  [0.618, 0.03],
  [0.628, 0.038],
  [0.64, 0.034],
  [0.64, 0.028],
  [0.632, 0.026],
  [0.632, -0.003],
  [-0.632, -0.003],
  [-0.632, 0.026],
  [-0.64, 0.028],
  [-0.64, 0.034],
  [-0.628, 0.038],
  [-0.618, 0.03],
]

/** NFT channel: an open-top extrusion with return lips. Lip top = z 0. */
const NFT_SECTION: Vec2[] = [
  [-0.112, -0.075],
  [0.112, -0.075],
  [0.112, 0],
  [0.072, 0],
  [0.072, -0.014],
  [0.1, -0.014],
  [0.1, -0.062],
  [-0.1, -0.062],
  [-0.1, -0.014],
  [-0.072, -0.014],
  [-0.072, 0],
  [-0.112, 0],
]

/** LED bar extrusion — the housing; the lens is a separate emissive part. */
const LED_SECTION: Vec2[] = [
  [-0.044, 0],
  [0.044, 0],
  [0.044, 0.048],
  [0.03, 0.06],
  [-0.03, 0.06],
  [-0.044, 0.048],
]

interface RackOptions {
  /** middle range: perforated posts, drippers, NFT collars, bay bracing */
  full: boolean
  /** the centre run of the walkable range grows in NFT channels */
  nft: boolean
}

function buildRackRun(writer: PartWriter, frame: HouseFrame, across: number, opts: RackOptions): void {
  const halfRun = RACK_LENGTH / 2

  // ── uprights, foot plates and caps ───────────────────────────────────
  for (let bay = 0; bay <= RACK_BAYS; bay++) {
    const along = tierPost(bay)
    for (const s of [-1, 1]) {
      const post = opts.full ? perforatedUpright() : plainUpright()
      if (s < 0) rotateZ(post, Math.PI)
      translate(post, [across + s * POST_ACROSS, along, 0.008])
      place(writer, 'aluminum', post, frame)
      // Foot plate, set 6 mm proud of the floor so the post has a reveal —
      // and 1.5 mm OFF the slab, never resting exactly in its top plane.
      const foot = prism(roundedRect(0.14, 0.14, 0.012, 2), 0.0015, 0.0095)
      translate(foot, [across + s * POST_ACROSS, along, 0])
      place(writer, 'dark', foot, frame)
      const cap = blockZ(
        across + s * POST_ACROSS - 0.02,
        along - 0.036,
        RACK_HEIGHT + 0.008,
        across + s * POST_ACROSS + 0.02,
        along + 0.036,
        RACK_HEIGHT + 0.022,
        0.003,
      )
      place(writer, 'dark', cap, frame)
    }
    // Cross brace between the pair at the top, and a diagonal every 3rd bay.
    const brace = prismYZ(
      [
        [along - 0.024, RACK_HEIGHT - 0.09],
        [along + 0.024, RACK_HEIGHT - 0.09],
        [along + 0.024, RACK_HEIGHT - 0.02],
        [along - 0.024, RACK_HEIGHT - 0.02],
      ],
      across - POST_ACROSS + 0.014,
      across + POST_ACROSS - 0.014,
    )
    place(writer, 'aluminum', brace, frame)
    if (opts.full && bay % 3 === 1 && bay < RACK_BAYS) {
      const nextAlong = tierPost(bay + 1)
      for (const s of [-1, 1]) {
        const diag = tubeAlong(
          [
            [across + s * POST_ACROSS, along + 0.03, 0.12],
            [across + s * POST_ACROSS, nextAlong - 0.03, RACK_HEIGHT - 0.12],
          ],
          roundedRect(0.026, 0.016, 0.004, 2),
          { up: [1, 0, 0], cap: true },
        )
        smoothShade(diag, SMOOTH.moulded)
        place(writer, 'dark', diag, frame)
      }
    }
  }

  // ── tiers: bearers, trays or channels, drip lines, LED bars ──────────
  for (let tier = 0; tier < RACK_TIERS; tier++) {
    const z = TIER_Z[tier]

    // Bearers across the run at every upright, carrying the tray.
    for (let bay = 0; bay <= RACK_BAYS; bay++) {
      const along = tierPost(bay)
      const bearer = prismYZ(
        [
          [along - 0.026, z - 0.062],
          [along + 0.026, z - 0.062],
          [along + 0.026, z - 0.05],
          [along + 0.008, z - 0.05],
          [along + 0.008, z - 0.006],
          [along - 0.008, z - 0.006],
          [along - 0.008, z - 0.05],
          [along - 0.026, z - 0.05],
        ],
        across - POST_ACROSS + 0.008,
        across + POST_ACROSS - 0.008,
      )
      smoothShade(bearer, SMOOTH.moulded)
      place(writer, 'aluminum', bearer, frame)
    }

    if (opts.nft) {
      for (const lane of [-0.4, 0, 0.4]) {
        const channel = prismXZ(
          NFT_SECTION.map(([a, b]) => [across + lane + a, z + b] as Vec2),
          -halfRun + 0.16,
          halfRun - 0.16,
        )
        smoothShade(channel, SMOOTH.moulded)
        place(writer, 'aluminum', channel, frame)
        // Net-pot collars on the top tier only — the one at eye height.
        if (opts.full && tier === RACK_TIERS - 1) {
          const count = Math.floor((RACK_LENGTH - 0.6) / 0.3)
          for (let i = 0; i <= count; i++) {
            const along = -halfRun + 0.3 + i * ((RACK_LENGTH - 0.6) / count)
            if (!collarProto) {
              collarProto = revolve(
                [
                  [0.052, 0],
                  [0.062, 0.004],
                  [0.062, 0.02],
                  [0.05, 0.026],
                  [0.05, 0.004],
                  [0.042, -0.03],
                  [0.042, -0.052],
                  [0.052, -0.052],
                ],
                10,
              )
            }
            const collar = collarProto.clone()
            translate(collar, [across + lane, along, z])
            place(writer, 'dark', collar, frame)
          }
        }
      }
      // Return manifold under the channels.
      const ret = tubeAlong(
        [
          [across, -halfRun + 0.16, z - 0.1],
          [across, halfRun - 0.16, z - 0.1],
        ],
        circle(0.026, 8),
        { up: [0, 0, 1], cap: true },
      )
      smoothShade(ret, SMOOTH.turned)
      place(writer, 'dark', ret, frame)
    } else {
      const tray = prismXZ(
        TRAY_SECTION.map(([a, b]) => [across + a, z + b] as Vec2),
        -halfRun + 0.16,
        halfRun - 0.16,
      )
      smoothShade(tray, SMOOTH.moulded)
      place(writer, 'aluminum', tray, frame)
      // End dams, so a tray reads as a tray and not an extrusion. `box()`
      // does not sort its bounds, so the -Y dam used to come back inside-out
      // and shared a face plane with the tray it caps; author it ordered and
      // let it bite 3 mm INTO the pan instead.
      for (const s of [-1, 1]) {
        const y0 = s * (halfRun - 0.16) - 0.003
        const y1 = s * (halfRun - 0.16) + 0.003
        // The dam stands 0.8 mm PROUD of the planting surface — geometry-craft
        // section 3's floor for an applied part. Bedding it inside the 3 mm
        // pan sheet instead put its underside within the audit's 1.5 mm of
        // the pan's own underside, same-facing: 37 cm² per dam, 24 dams.
        const dam = box(
          across - 0.62,
          Math.min(y0, y1),
          z + 0.0008,
          across + 0.62,
          Math.max(y0, y1),
          z + 0.03,
        )
        place(writer, 'aluminum', dam, frame)
      }
    }

    // Drip line along the back of the tray, with real drippers.
    const dripA = across + TRAY_HALF - 0.09
    const drip = tubeAlong(
      [
        [dripA, -halfRun + 0.2, z + 0.042],
        [dripA, halfRun - 0.2, z + 0.042],
      ],
      circle(0.009, 8),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(drip, SMOOTH.turned)
    place(writer, 'dark', drip, frame)
    if (opts.full) {
      const drippers = Math.floor((RACK_LENGTH - 0.6) / 0.74)
      for (let i = 0; i <= drippers; i++) {
        const along = -halfRun + 0.3 + i * ((RACK_LENGTH - 0.6) / drippers)
        if (!dripperProto) {
          dripperProto = revolve(
            [
              [0, 0],
              [0.011, 0],
              [0.011, 0.016],
              [0.006, 0.02],
              [0.006, 0.034],
              [0, 0.034],
            ],
            8,
          )
        }
        const stub = dripperProto.clone()
        translate(stub, [dripA, along, z + 0.042])
        place(writer, 'dark', stub, frame)
      }
    }

    // LED bars: two per tier, hung under the tier ABOVE (the top pair hangs
    // from the rack's own head brace), each in a real extruded housing.
    const barZ = tier + 1 < RACK_TIERS ? TIER_Z[tier + 1] - 0.1 : RACK_HEIGHT - 0.12
    for (const lane of [-0.29, 0.29]) {
      const housing = prismXZ(
        LED_SECTION.map(([a, b]) => [across + lane + a, barZ + b] as Vec2),
        -halfRun + 0.24,
        halfRun - 0.24,
      )
      smoothShade(housing, SMOOTH.moulded)
      place(writer, 'aluminum', housing, frame)
      const lens = box(
        across + lane - 0.036,
        -halfRun + 0.26,
        barZ - 0.008,
        across + lane + 0.036,
        halfRun - 0.26,
        barZ - 0.001,
      )
      place(writer, 'growBar', lens, frame)
      // End caps, and hangers up to the tier bearer above.
      for (const s of [-1, 1]) {
        const endCap = blockZ(
          across + lane - 0.046,
          s * (halfRun - 0.24) - s * 0.012,
          barZ - 0.002,
          across + lane + 0.046,
          s * (halfRun - 0.24) + s * 0.012,
          barZ + 0.062,
          0.003,
        )
        place(writer, 'dark', endCap, frame)
      }
      if (opts.full) {
        for (let bay = 1; bay < RACK_BAYS; bay += 2) {
          const along = tierPost(bay)
          const hangTop = tier + 1 < RACK_TIERS ? TIER_Z[tier + 1] - 0.062 : RACK_HEIGHT - 0.09
          const hanger = box(
            across + lane - 0.008,
            along - 0.012,
            barZ + 0.052,
            across + lane + 0.008,
            along + 0.012,
            hangTop,
          )
          place(writer, 'dark', hanger, frame)
        }
      }
    }
  }
}

/**
 * Racks for all three ranges. The two sealed houses are what makes the row
 * blaze green through its panes from the boulevard, so they are built, not
 * skipped — only their part count is lower.
 */
export function buildGlasshouseRacks(services: DistrictServices): void {
  const { writer } = services
  for (const frame of houseFrames()) {
    const full = frame.index === 1
    for (const across of RACK_ACROSS) {
      buildRackRun(writer, frame, across, { full, nft: full && across === 0 })
    }
  }
}

// ──────────────────────────────────────────────────────── aisle walkways

/**
 * The aisles are laid in 2.4 m deck modules with authored 8 mm joints and
 * countersunk fasteners at the corners — a floor that was installed, not
 * painted on. 45 mm proud of the slab, chamfered at the edge.
 *
 * Every range is walk-through, so every range is decked; only the hall's run
 * stops short, where the dosing skid stands.
 */
let fastenerProto: MeshData | null = null

function buildAisleDecks(writer: PartWriter, frame: HouseFrame): void {
  // The hall's run stops short at BOTH ends, where its floor-standing plant is:
  // the dosing skid's bund at +Y, and the potting bench and its bins at −Y. The
  // bench's front legs are at −15.04 and the near bin's front face at −15.06,
  // so a deck starting at the other ranges' −15.4 had a 45 mm panel running
  // straight through a leg and through the corner of a bin.
  const runStart = frame.index === 1 ? -14.9 : -RACK_LENGTH / 2 - 0.6
  const runEnd = frame.index === 1 ? 14.55 : RACK_LENGTH / 2 + 0.6
  const runLength = runEnd - runStart
  const modules = Math.round(runLength / 2.4)
  for (const across of AISLE_ACROSS) {
    for (let m = 0; m < modules; m++) {
      const l0 = runStart + m * (runLength / modules) + 0.004
      const l1 = l0 + runLength / modules - 0.008
      const panel = prism(
        [
          [across - 0.75, l0],
          [across + 0.75, l0],
          [across + 0.75, l1],
          [across - 0.75, l1],
        ],
        0.002,
        0.045,
      )
      bevel(panel, BEVEL.panel, 2)
      place(writer, 'deck', panel, frame)
      for (const a of [across - 0.66, across + 0.66]) {
        for (const l of [l0 + 0.12, l1 - 0.12]) {
          if (!fastenerProto) {
            fastenerProto = revolve(
              [
                [0, 0.038],
                [0.014, 0.038],
                [0.016, 0.044],
                [0, 0.045],
              ],
              8,
            )
          }
          const head = fastenerProto.clone()
          translate(head, [a, l, 0])
          place(writer, 'dark', head, frame)
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────── nutrient dosing skid

/**
 * The skid stands over the west rack line, NOT on the centre line: the range
 * now has an entrance at the +Y gable too, and a 3.3 m bund centred on the
 * axis narrowed that doorway's aisle to 0.65 m.
 */
const SKID_ACROSS = -1.45
/**
 * Skid centre line along the range. The bund is 1.5 m deep, so its near face is
 * `SKID_ALONG − 0.75`: at the old 15.55 that landed on 14.80, which is exactly
 * where the last rack frame stands — the two end uprights inside the bund's
 * across span (−2.49 and −0.61) rose through the kerb and their 140 mm foot
 * plates were cast into the tray. 15.8 leaves 180 mm between the foot plates
 * (14.87) and the bund, and still keeps 310 mm to the gable frame's inner face
 * (16.863).
 */
const SKID_ALONG = 15.8

/** A bunded dosing skid: tanks, pumps, manifold, valves, control cabinet. */
function buildDosingSkid(services: DistrictServices, frame: HouseFrame): void {
  const { writer } = services
  const baseL = SKID_ALONG
  const emit = (slot: string, md: MeshData): void => {
    translate(md, [SKID_ACROSS, 0, 0])
    place(writer, slot, md, frame)
  }

  // Bund: a shallow poured tray with a kerb — a real containment, not a slab.
  const bund = prism(roundedRect(3.3, 1.5, 0.06, 2).map(([a, l]) => [a, l + baseL] as Vec2), 0, 0.055)
  bevel(bund, BEVEL.carcass, 2)
  emit('cast', bund)
  for (const [x0, l0, x1, l1] of [
    [-1.65, -0.75, -1.53, 0.75],
    [1.53, -0.75, 1.65, 0.75],
    [-1.53, -0.75, 1.53, -0.63],
    [-1.53, 0.63, 1.53, 0.75],
  ] as const) {
    emit('cast', blockZ(x0, baseL + l0, 0.055, x1, baseL + l1, 0.16, 0.008))
  }
  const sump = prism(
    roundedRect(3.06, 1.26, 0.05, 2).map(([a, l]) => [a, l + baseL] as Vec2),
    0.058,
    0.085,
  )
  emit('dark', sump)

  // Two dosing tanks on legs, conical bottoms, with sight tubes and lids.
  for (const [a, tint] of [
    [-1.05, 'orange'],
    [-0.28, 'aluminum'],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2
      const leg = box(
        a + Math.cos(ang) * 0.24 - 0.018,
        baseL + Math.sin(ang) * 0.24 - 0.018,
        0.085,
        a + Math.cos(ang) * 0.24 + 0.018,
        baseL + Math.sin(ang) * 0.24 + 0.018,
        0.48,
      )
      bevel(leg, BEVEL.hardware, 2)
      emit('dark', leg)
    }
    const shell = revolve(
      [
        [0, 0.34],
        [0.3, 0.5],
        [0.3, 1.28],
        [0.27, 1.34],
        [0.13, 1.38],
        [0.13, 1.42],
        [0, 1.42],
      ],
      20,
    )
    translate(shell, [a, baseL, 0])
    emit(tint, shell)
    const lid = revolve(
      [
        [0, 1.42],
        [0.15, 1.42],
        [0.15, 1.47],
        [0.11, 1.5],
        [0, 1.5],
      ],
      14,
    )
    translate(lid, [a, baseL, 0])
    emit('dark', lid)
    const sight = tubeAlong(
      [
        [a + 0.31, baseL, 0.56],
        [a + 0.31, baseL, 1.24],
      ],
      circle(0.014, 8),
      { up: [0, 1, 0], cap: true },
    )
    smoothShade(sight, SMOOTH.turned)
    emit('darkGlass', sight)
    for (const z of [0.56, 1.24]) {
      const clamp = annularPrism(circle(0.032, 10), circle(0.015, 10), z - 0.014, z + 0.014, 0.003, 1)
      translate(clamp, [a + 0.31, baseL, 0])
      emit('dark', clamp)
    }
  }

  // Two pumps on a common plinth: motor, coupling guard, volute, flanges.
  for (const a of [0.62, 1.28]) {
    const plinth = box(a - 0.19, baseL - 0.24, 0.085, a + 0.19, baseL + 0.24, 0.135)
    bevel(plinth, BEVEL.panel, 2)
    emit('dark', plinth)
    const motor = revolve(
      [
        [0, -0.16],
        [0.085, -0.16],
        [0.085, -0.13],
        [0.105, -0.12],
        [0.105, 0.09],
        [0.085, 0.1],
        [0.085, 0.13],
        [0, 0.13],
      ],
      16,
      { axis: 'y' },
    )
    translate(motor, [a, baseL + 0.02, 0.245])
    emit('steel', motor)
    for (let i = 0; i < 7; i++) {
      const fin = box(a - 0.108, baseL - 0.12 + i * 0.036, 0.245 - 0.005, a + 0.108, baseL - 0.106 + i * 0.036, 0.245 + 0.108)
      emit('steel', fin)
    }
    const guard = revolve(
      [
        [0.05, -0.05],
        [0.075, -0.05],
        [0.075, 0.05],
        [0.05, 0.05],
      ],
      12,
      { axis: 'y' },
    )
    translate(guard, [a, baseL - 0.21, 0.245])
    emit('dark', guard)
    const volute = revolve(
      [
        [0, -0.05],
        [0.115, -0.05],
        [0.13, -0.02],
        [0.13, 0.02],
        [0.115, 0.05],
        [0, 0.05],
      ],
      16,
      { axis: 'y' },
    )
    translate(volute, [a, baseL - 0.3, 0.245])
    emit('aluminum', volute)
    const inlet = tubeAlong(
      [
        [a, baseL - 0.36, 0.245],
        [a, baseL - 0.52, 0.245],
      ],
      circle(0.036, 10),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(inlet, SMOOTH.turned)
    emit('aluminum', inlet)
    const riser = tubeAlong(
      [
        [a, baseL - 0.3, 0.375],
        [a, baseL - 0.3, 0.78],
        [a, baseL + 0.42, 0.78],
      ],
      circle(0.03, 10),
      { up: [0, 1, 0], cap: true },
    )
    smoothShade(riser, SMOOTH.turned)
    emit('aluminum', riser)
  }

  // The distribution manifold, with four lever valves and a gauge.
  // Starts 40 mm clear of the control cabinet's door leaf: its end cap used
  // to land exactly in that leaf's face plane.
  const manifold = tubeAlong(
    [
      [-1.36, baseL + 0.42, 0.78],
      [1.5, baseL + 0.42, 0.78],
    ],
    circle(0.044, 12),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(manifold, SMOOTH.turned)
  emit('aluminum', manifold)
  for (let i = 0; i < 4; i++) {
    const a = -1.0 + i * 0.72
    const bodyMd = revolve(
      [
        [0, -0.06],
        [0.06, -0.06],
        [0.07, -0.02],
        [0.07, 0.02],
        [0.06, 0.06],
        [0, 0.06],
      ],
      12,
      { axis: 'x' },
    )
    translate(bodyMd, [a, baseL + 0.42, 0.78])
    emit('dark', bodyMd)
    const stem = tubeAlong(
      [
        [a, baseL + 0.42, 0.82],
        [a, baseL + 0.42, 0.9],
      ],
      circle(0.012, 8),
      { up: [0, 1, 0], cap: true },
    )
    emit('dark', stem)
    const lever = box(a - 0.014, baseL + 0.36, 0.9, a + 0.014, baseL + 0.6, 0.926)
    bevel(lever, BEVEL.hardware, 2)
    rotX(lever, i % 2 === 0 ? 0 : -1.1, [a, baseL + 0.42, 0.913])
    emit('orange', lever)
    const drop = tubeAlong(
      [
        [a, baseL + 0.42, 0.74],
        [a, baseL + 0.42, 0.2],
      ],
      circle(0.022, 8),
      { up: [0, 1, 0], cap: true },
    )
    smoothShade(drop, SMOOTH.turned)
    emit('aluminum', drop)
  }
  const gaugeBody = revolve(
    [
      [0, 0],
      [0.055, 0],
      [0.062, 0.014],
      [0.062, 0.05],
      [0.055, 0.056],
      [0, 0.056],
    ],
    14,
    { axis: 'y' },
  )
  translate(gaugeBody, [1.5, baseL + 0.36, 0.78])
  emit('steel', gaugeBody)
  const gaugeFace = revolve(
    [
      [0, 0.058],
      [0.05, 0.058],
      [0.05, 0.062],
      [0, 0.062],
    ],
    14,
    { axis: 'y' },
  )
  translate(gaugeFace, [1.5, baseL + 0.36, 0.78])
  emit('utilityLight', gaugeFace)

  // Control cabinet: door with a real reveal, hinges, handle, lamp, label.
  const cab = box(-1.62, baseL - 0.24, 0.16, -1.62 + 0.22, baseL + 0.44, 1.42)
  bevel(cab, BEVEL.frame, 2)
  emit('steel', cab)
  // The cabinet bears on the bund's west kerb (top 0.16) over only 90 mm of its
  // 220 mm depth; the other 130 mm is over the sump, so it gets two feet down
  // to it. Without them the inboard half of a 1.26 m cabinet simply stopped at
  // z 0.16 with 75 mm of air under it.
  for (const l of [baseL - 0.16, baseL + 0.36]) {
    emit('dark', blockZ(-1.45, l - 0.03, 0.087, -1.41, l + 0.03, 0.16, 0.003))
  }
  const doorLeaf = box(-1.4, baseL - 0.21, 0.34, -1.386, baseL + 0.41, 1.36)
  bevel(doorLeaf, BEVEL.panel, 2)
  emit('aluminum', doorLeaf)
  for (const l of [baseL - 0.15, baseL + 0.35]) {
    const hinge = revolve(
      [
        [0, -0.035],
        [0.016, -0.035],
        [0.016, 0.035],
        [0, 0.035],
      ],
      10,
      { axis: 'y' },
    )
    translate(hinge, [-1.392, l, 1.0])
    emit('dark', hinge)
  }
  const handle = tubeAlong(
    [
      [-1.386, baseL - 0.12, 0.86],
      [-1.32, baseL - 0.12, 0.86],
      [-1.32, baseL + 0.02, 0.86],
      [-1.386, baseL + 0.02, 0.86],
    ],
    circle(0.011, 8),
    { up: [0, 0, 1], cap: true },
  )
  smoothShade(handle, SMOOTH.turned)
  emit('dark', handle)
  const lamp = box(-1.386, baseL + 0.2, 1.24, -1.379, baseL + 0.26, 1.3)
  emit('utilityLight', lamp)
  const label = box(-1.386, baseL - 0.14, 1.14, -1.379, baseL + 0.16, 1.2)
  emit('signageGlow', label)
}

// ────────────────────────────────────────────── service bay at the door

/**
 * What a working hall looks like as you walk in: a free-standing service
 * board (you cannot screw a tool rack to glass), the harvest log, and a
 * potting bench with its bins.
 */
function buildServiceBay(services: DistrictServices, frame: HouseFrame): void {
  const { writer } = services
  const wallL = -15.9
  const emit = (slot: string, md: MeshData): void => place(writer, slot, md, frame)

  // Two posts and a slatted back — the slat gaps ARE the pegboard.
  for (const a of [-3.95, -1.55]) {
    const post = prism(roundedRect(0.075, 0.075, 0.01, 2).map(([x, y]) => [x + a, y + wallL] as Vec2), 0.022, 2.15)
    bevel(post, BEVEL.panel, 2)
    emit('steel', post)
    const foot = prism(
      roundedRect(0.26, 0.34, 0.02, 2).map(([x, y]) => [x + a, y + wallL] as Vec2),
      0,
      0.022,
    )
    bevel(foot, BEVEL.hardware, 2)
    emit('dark', foot)
  }
  for (let i = 0; i < 9; i++) {
    const z = 0.86 + i * 0.145
    const slat = box(-3.91, wallL - 0.022, z, -1.59, wallL + 0.022, z + 0.09)
    bevel(slat, BEVEL.panel, 2)
    emit('aluminum', slat)
  }
  // Hung tools: two forks, a trowel, secateurs, a broom, a coiled hose.
  const hook = (a: number, z: number): void => {
    const h = tubeAlong(
      [
        [a, wallL - 0.024, z],
        [a, wallL - 0.09, z],
        [a, wallL - 0.09, z - 0.05],
      ],
      circle(0.006, 6),
      { up: [0, 0, 1], cap: true },
    )
    emit('dark', h)
  }
  const tool = (a: number, headLen: number, headWide: number, prongs: number): void => {
    hook(a, 1.94)
    const shaft = tubeAlong(
      [
        [a, wallL - 0.075, 1.92],
        [a, wallL - 0.075, 1.92 - 0.78],
      ],
      circle(0.014, 8),
      { up: [0, 1, 0], cap: true },
    )
    smoothShade(shaft, SMOOTH.turned)
    emit('fabricSand', shaft)
    const ferrule = annularPrism(circle(0.019, 10), circle(0.0145, 10), 1.06, 1.14, 0.003, 1)
    translate(ferrule, [a, wallL - 0.075, 0])
    emit('dark', ferrule)
    for (let p = 0; p < prongs; p++) {
      const off = prongs === 1 ? 0 : -headWide / 2 + (p / (prongs - 1)) * headWide
      const prong = box(
        a + off - (prongs === 1 ? headWide / 2 : 0.008),
        wallL - 0.082,
        1.14 - headLen,
        a + off + (prongs === 1 ? headWide / 2 : 0.008),
        wallL - 0.068,
        1.14,
      )
      bevel(prong, BEVEL.hardware, 2)
      emit('steel', prong)
    }
  }
  tool(-3.7, 0.24, 0.14, 4)
  tool(-3.35, 0.24, 0.12, 3)
  tool(-3.0, 0.2, 0.08, 1)
  hook(-2.68, 1.6)
  const shears = box(-2.71, wallL - 0.084, 1.34, -2.65, wallL - 0.066, 1.56)
  bevel(shears, BEVEL.hardware, 2)
  emit('dark', shears)
  // Coiled hose on a wall reel.
  const reelHub = revolve(
    [
      [0, 0],
      [0.09, 0],
      [0.09, 0.16],
      [0, 0.16],
    ],
    14,
    { axis: 'y' },
  )
  translate(reelHub, [-1.95, wallL - 0.16, 1.32])
  emit('dark', reelHub)
  for (let i = 0; i < 5; i++) {
    const coil: Vec3[] = []
    const r = 0.13 + i * 0.028
    for (let k = 0; k <= 22; k++) {
      const ang = (k / 22) * Math.PI * 2
      coil.push([-1.95 + Math.cos(ang) * r, wallL - 0.16 + (k / 22) * 0.02 - 0.01, 1.32 + Math.sin(ang) * r])
    }
    const hose = tubeAlong(coil, circle(0.014, 6), { up: [0, 1, 0], closePath: true, cap: false })
    smoothShade(hose, SMOOTH.turned)
    emit('dark', hose)
  }

  // Potting bench in front of the board, with two bins beneath.
  const benchZ = 0.9
  const top = prism(
    roundedRect(2.3, 0.66, 0.02, 2).map(([x, y]) => [x - 2.75, y + wallL + 0.62] as Vec2),
    benchZ - 0.045,
    benchZ,
  )
  bevel(top, BEVEL.panel, 2)
  emit('aluminum', top)
  const lip = box(-3.9, wallL + 0.3, benchZ, -1.6, wallL + 0.34, benchZ + 0.07)
  bevel(lip, BEVEL.hardware, 2)
  emit('aluminum', lip)
  for (const a of [-3.78, -1.72]) {
    for (const l of [wallL + 0.38, wallL + 0.86]) {
      const leg = box(a - 0.026, l - 0.026, 0, a + 0.026, l + 0.026, benchZ - 0.045)
      bevel(leg, BEVEL.hardware, 2)
      emit('steel', leg)
    }
    const rail = box(a - 0.018, wallL + 0.38, 0.24, a + 0.018, wallL + 0.86, 0.276)
    emit('steel', rail)
  }
  for (let i = 0; i < 2; i++) {
    const a = -3.4 + i * 1.16
    const bin = prism(
      roundedRect(0.62, 0.44, 0.03, 2).map(([x, y]) => [x + a, y + wallL + 0.62] as Vec2),
      0.02,
      0.46,
    )
    bevel(bin, BEVEL.frame, 2)
    emit(i === 0 ? 'playBlue' : 'orange', bin)
  }

  // The harvest log: slate in a four-piece frame, with a chalk tray.
  const boardA = -0.95
  const boardZ = 1.5
  for (const [x0, z0, x1, z1] of [
    [boardA - 0.72, boardZ - 0.52, boardA - 0.66, boardZ + 0.52],
    [boardA + 0.66, boardZ - 0.52, boardA + 0.72, boardZ + 0.52],
    [boardA - 0.66, boardZ + 0.46, boardA + 0.66, boardZ + 0.52],
    [boardA - 0.66, boardZ - 0.52, boardA + 0.66, boardZ - 0.46],
  ] as const) {
    const memberMd = box(x0, wallL - 0.028, z0, x1, wallL + 0.028, z1)
    bevel(memberMd, BEVEL.panel, 2)
    emit('steel', memberMd)
  }
  const slate = box(boardA - 0.67, wallL - 0.016, boardZ - 0.47, boardA + 0.67, wallL - 0.004, boardZ + 0.47)
  emit('dark', slate)
  const chalkTray = prismYZ(
    [
      [wallL - 0.09, boardZ - 0.58],
      [wallL - 0.02, boardZ - 0.58],
      [wallL - 0.02, boardZ - 0.53],
      [wallL - 0.032, boardZ - 0.53],
      [wallL - 0.032, boardZ - 0.566],
      [wallL - 0.078, boardZ - 0.566],
      [wallL - 0.078, boardZ - 0.53],
      [wallL - 0.09, boardZ - 0.53],
    ],
    boardA - 0.66,
    boardA + 0.66,
  )
  emit('aluminum', chalkTray)
  const chalk = tubeAlong(
    [
      [boardA + 0.28, wallL - 0.055, boardZ - 0.552],
      [boardA + 0.36, wallL - 0.055, boardZ - 0.552],
    ],
    circle(0.008, 6),
    { up: [0, 0, 1], cap: true },
  )
  emit('aluminum', chalk)
  // Rear kickers. The board is free-standing (nothing may be fixed to glass),
  // so each post is stayed BACK to its own pad on the slab — behind the board,
  // clear of the hung tools (a −3.7…−1.95) and 0.26 m inboard of the gable
  // frame. The pair used to rake FORWARD and stop at z 2.12 half a metre out in
  // front of the board with nothing there to bear on: two tubes ending in air
  // at eye height, in the first thing you see walking in.
  for (const a of [-3.95, -1.55]) {
    const stay = tubeAlong(
      [
        [a, wallL - 0.03, 1.86],
        [a, wallL - 0.62, 0.018],
      ],
      circle(0.012, 6),
      { up: [1, 0, 0], cap: true },
    )
    smoothShade(stay, SMOOTH.turned)
    // `steel`, the post's own slot: both ends of this member are socketed (into
    // the post at the head, into the pad at the foot) and one slot welds them.
    emit('steel', stay)
    const pad = prism(
      roundedRect(0.16, 0.16, 0.02, 2).map(([x, y]) => [x + a, y + wallL - 0.62] as Vec2),
      0,
      0.022,
    )
    bevel(pad, BEVEL.hardware, 2)
    emit('steel', pad)
  }

  const face = new Mesh(
    new PlaneGeometry(1.3, 0.9),
    signageMaterial(
      ['HARVEST LOG', 'SOL 214 · BASIL 4.2 KG', 'SOL 213 · WHEAT 11 KG', 'BAY C3 FLUSH DUE SOL 216'],
      { background: '#232722', ink: '#cfd8c8', widthPx: 640, aspect: 1.3 / 0.9 },
    ),
  )
  const p = frame.point(boardA, boardZ, wallL - 0.02)
  face.position.copy(p)
  face.rotation.y = frame.yaw + Math.PI
  face.castShadow = false
  face.receiveShadow = false
  services.group.add(face)
}

// ────────────────────────────────────────────────────── misting manifolds

/** Two ridge-side manifolds on stanchions off the outer racks' post caps. */
function buildMistManifolds(writer: PartWriter, frame: HouseFrame): void {
  const z = 2.98
  for (const side of [-1, 1]) {
    const a = side * 2.55
    const pipe = tubeAlong(
      [
        [a, -HOUSE_HALF_LENGTH + 2.0, z],
        [a, HOUSE_HALF_LENGTH - 2.0, z],
      ],
      circle(0.024, 10),
      { up: [0, 0, 1], cap: true },
    )
    smoothShade(pipe, SMOOTH.turned)
    place(writer, 'aluminum', pipe, frame)
    for (let i = 0; i < 10; i++) {
      const along = -13.5 + i * 3
      const tee = annularPrism(circle(0.036, 10), circle(0.025, 10), -0.03, 0.03, 0.004, 1)
      rotX(tee, Math.PI / 2)
      translate(tee, [a, along, z])
      place(writer, 'dark', tee, frame)
      const nozzle = revolve(
        [
          [0, 0],
          [0.014, 0],
          [0.014, -0.024],
          [0.008, -0.034],
          [0.004, -0.046],
          [0, -0.046],
        ],
        10,
      )
      translate(nozzle, [a, along, z])
      place(writer, 'dark', nozzle, frame)
    }
    // Stanchions off the outer rack's post caps every third bay.
    for (let bay = 1; bay < RACK_BAYS; bay += 3) {
      const along = tierPost(bay)
      const postA = side * (Math.abs(RACK_ACROSS[side < 0 ? 0 : 2]) - POST_ACROSS)
      const stanchion = box(postA - 0.018, along - 0.018, RACK_HEIGHT, postA + 0.018, along + 0.018, z + 0.03)
      bevel(stanchion, BEVEL.hardware, 2)
      place(writer, 'aluminum', stanchion, frame)
      // The arm dies 4 mm UNDER the stanchion's cap. Ending both at z + 0.03
      // put two same-facing aluminium faces in one plane at every stanchion.
      const arm = box(
        Math.min(postA, a) - 0.014,
        along - 0.014,
        z + 0.002,
        Math.max(postA, a) + 0.014,
        along + 0.014,
        z + 0.026,
      )
      bevel(arm, BEVEL.hardware, 2)
      place(writer, 'aluminum', arm, frame)
    }
  }
}

// ────────────────────────────────────────────────────────────── assembly

/**
 * Greenhouse fit-out. The ENTRANCES belong to `farmside.ts` — the doorway is
 * an aperture cut from the gable's own welded grid, so its jambs, header,
 * threshold and leaf are authored where that grid is, not bolted on here.
 *
 * All three ranges are walk-through now, so all three get aisle decks; the
 * hall keeps the working hardware (skid, service bay, misting manifolds).
 */
export function buildGreenhouseInterior(services: DistrictServices): void {
  const frames = houseFrames()
  buildGlasshouseRacks(services)
  for (const frame of frames) buildAisleDecks(services.writer, frame)
  const hall = frames[1]
  buildDosingSkid(services, hall)
  buildServiceBay(services, hall)
  buildMistManifolds(services.writer, hall)
  // Collider yaw θ puts box local X on the ACROSS axis (see farmside.ts), so
  // size is (across, up, along). Both of these carried the old +π/2 and were
  // therefore turned 90° — the skid read as a 3.4 m bar down the aisle.
  services.colliders.push({
    kind: 'box',
    center: hall.point(SKID_ACROSS, 0.75, SKID_ALONG),
    size: new Vector3(3.4, 1.5, 1.6),
    yaw: hall.yaw,
  })
  services.colliders.push({
    kind: 'box',
    center: hall.point(-2.75, 1.05, -15.7),
    size: new Vector3(2.5, 2.1, 0.9),
    yaw: hall.yaw,
  })
}

