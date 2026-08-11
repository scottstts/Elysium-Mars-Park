import { DoubleSide, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  MeshData,
  SMOOTH,
  annularPrism,
  arcPts,
  bevel,
  circle,
  loft,
  prism,
  prismYZ,
  revolve,
  rotX,
  rotateZ,
  roundedBoxMesh,
  roundedRect,
  smoothShade,
  toGeometry,
  translate,
  tubeAlong,
  writeInto,
} from '../../archkit/meshdata'
import type { Vec2, Vec3 } from '../../archkit/meshdata'
import { signageMaterial } from '../../materials/library'
import { cropHeadTexture } from '../../vegetation/leafTextures'
import { interiorHeight } from '../interiorHeight'
import { HYDRO_TOWER } from '../parkPlan'
import { curtainGlassMaterial, curvedSignMesh, groundedBand, signBox, signFaceMaterial } from './commons'
import type { DistrictServices } from './types'

/**
 * HYDROPONICS TOWER — the reference image's "62" building: a sealed glass
 * cylinder stacked three floors deep with planted shelving, glowing green on
 * the farm lane at dusk.
 *
 * Same authoring contract as `commons.ts`: drawn Z-UP in the tower's own local
 * frame (plan `(x, y)` east/south of `HYDRO_TOWER`, `z` above the apron), and
 * the same curtain-wall assembly rule — floor bands are continuous rings,
 * mullions stop `REVEAL` short of them, transoms stop short of the mullions,
 * and the pane plane sits `MULL_GAP` inboard of every mullion's inner face.
 *
 * The building's identity is INTERIOR: four annular grow tiers per floor, each
 * with its own reflector channel and `growBar` strip 50 mm under the tray
 * above, packed with instanced leaf cards. Read through clear glass from the
 * lane, that stack of green light IS the building. `HYDRO_SHELVES` publishes
 * the tier geometry so the vegetation agent can densify the planting without
 * re-deriving a single dimension.
 */

// ------------------------------------------------------------------ layout

const SEG_SMOOTH = 72
const SEG_BAY = 32

const R_GLASS = 6.86
const R_BAND = 7.12 // expressed floor bands / roof ring — the drum's true edge
const R_PLINTH = 7.24
const R_CORE = 1.4

const MULL_GAP = 0.012
const MULL_DEPTH = 0.13
const MULL_W = 0.07
const CAP_PROUD = 0.04
const CAP_W = 0.1
const REVEAL = 0.006
/** See `commons.ts` — the 4 mm reveal at every cylinder-to-cylinder butt. */
const BUTT = 0.004

/** Finished floor levels, and the glazing band that sits over each. */
const FLOORS = [1.0, 4.8, 8.6] as const
const STOREY = 3.8
const GLASS_TOP_INSET = 0.5 // band depth over each floor
const Z_ROOF = FLOORS[2] + STOREY // 12.4 structural roof top
/**
 * The parapet is 1.55 m, not the usual 1.1: it is the "62" supergraphic's
 * host, and the numeral has to be a metre tall to read from the plaza the way
 * the reference's does. A short parapet forces a wide, squat numeral whose
 * canvas aspect no longer matches its panel, and the letterform smears.
 */
const Z_PARAPET = Z_ROOF + 1.55
const R_PARAPET_IN = 6.77
/**
 * Inner edge of every floor plate. The core drum (r 1.4), its riser stack and
 * its ladder live in the annular shaft inside this line — a floor plate that
 * ran to the core would have four mains driven straight through it on every
 * storey, which is the single biggest clash class in a serviced tower.
 */
const R_SHAFT = 1.78

/** Grow tiers, measured from each floor's finished level. */
const TIER_Z = [0.44, 1.08, 1.72, 2.36] as const
const RACK_INNER = 4.31
const RACK_OUTER = 6.34
/**
 * Post axes: the 60 mm sections stand 4 mm clear of the tray edges. The INNER
 * clearance is bigger because the tray is a 48-gon inscribed in its circle —
 * its mid-chord dips ~9 mm inside the nominal radius, and a post set from the
 * nominal radius lands inside that dip.
 */
const POST_INNER = RACK_INNER - 0.045
const POST_OUTER = RACK_OUTER + 0.034

/** Bearing from the tower to the park centre — what the "62" faces. */
const PHI_PARK = Math.atan2(-HYDRO_TOWER.z, -HYDRO_TOWER.x)
/** Service stair: its own drum, clear of the glazing and inside the apron. */
const STAIR_PHI = Math.PI / 4
const STAIR_R = 9.4
/** Outer stringer radius: 9.4 − 1.94 = 7.46 clears the drum's 7.24 plinth. */
const STAIR_TREADS = 70
const STAIR_DTHETA = 0.215

const ORIGIN_Y = (): number => interiorHeight(HYDRO_TOWER.x, HYDRO_TOWER.z)

// ----------------------------------------------------------------- exports

export interface HydroShelfRun {
  /** World centre of the run at its floor's finished level. */
  position: [number, number, number]
  /** Heading of the run's long axis: `(sin yaw, cos yaw)` in world (x, z). */
  yaw: number
  /** Arc length of the run along the rack's mid-radius, metres. */
  width: number
  tiers: number
}

const RACK_MID = (RACK_INNER + RACK_OUTER) * 0.5
const RUNS_PER_FLOOR = 8

/**
 * The tier geometry, published for the vegetation pass. Each entry is one arc
 * of the annular rack: stand at `position`, face `yaw`, and the tray runs
 * `width` metres wide × (RACK_OUTER − RACK_INNER) deep, repeated at
 * `TIER_Z` above the floor. Baseline planting is already built here — this
 * exists so a denser pass can be laid on top without re-deriving anything.
 */
export const HYDRO_SHELVES: HydroShelfRun[] = (() => {
  const baseY = ORIGIN_Y()
  const out: HydroShelfRun[] = []
  for (const floor of FLOORS) {
    for (let i = 0; i < RUNS_PER_FLOOR; i++) {
      const phi = ((i + 0.5) / RUNS_PER_FLOOR) * Math.PI * 2
      out.push({
        position: [
          HYDRO_TOWER.x + Math.cos(phi) * RACK_MID,
          baseY + floor,
          HYDRO_TOWER.z + Math.sin(phi) * RACK_MID,
        ],
        yaw: Math.atan2(-Math.sin(phi), Math.cos(phi)),
        width: (Math.PI * 2 * RACK_MID) / RUNS_PER_FLOOR,
        tiers: TIER_Z.length,
      })
    }
  }
  return out
})()

export const HYDRO_TIER_HEIGHTS = TIER_Z

// ----------------------------------------------------------------- helpers

function polar(phi: number, r: number, t: number): Vec2 {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return [c * r - s * t, s * r + c * t]
}

function ringBand(rOuter: number, rInner: number, z0: number, z1: number, rim = 0.02, seg = SEG_SMOOTH): MeshData {
  return annularPrism(circle(rOuter, seg), circle(rInner, seg), z0, z1, rim, 2)
}

function sectorBand(
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
  z0: number,
  z1: number,
  rim = 0.02,
): MeshData {
  const steps = Math.max(6, Math.round((Math.abs(a1 - a0) * rOuter) / 0.35))
  const poly = [...arcPts(0, 0, rOuter, a0, a1, steps), ...arcPts(0, 0, rInner, a1, a0, steps)]
  const md = prism(poly, z0, z1)
  bevel(md, rim, 2)
  return md
}

/** See `commons.ts`: the splayed shoulder keeps the end caps ear-clip clean. */
function memberSection(halfWeb: number): Vec2[] {
  const hc = CAP_W / 2
  const d = MULL_DEPTH
  return [
    [0, -halfWeb],
    [d, -halfWeb],
    [d + 0.012, -hc],
    [d + CAP_PROUD, -hc],
    [d + CAP_PROUD, hc],
    [d + 0.012, hc],
    [d, halfWeb],
    [0, halfWeb],
  ]
}

function mullion(phi: number, rIn: number, z0: number, z1: number): MeshData {
  return smoothShade(
    prism(
      memberSection(MULL_W / 2).map(([u, v]) => polar(phi, rIn + u, v)),
      z0,
      z1,
    ),
    SMOOTH.moulded,
  )
}

function transom(phiA: number, phiB: number, rIn: number, zc: number, half: number): MeshData {
  const phi = (phiA + phiB) * 0.5
  const chord = 2 * (rIn + MULL_DEPTH) * Math.sin(Math.abs(phiB - phiA) * 0.5)
  const span = chord / 2 - CAP_W / 2 - REVEAL
  const md = prismYZ(memberSection(half), -span, span)
  translate(md, [0, rIn, zc])
  rotateZ(md, phi - Math.PI / 2)
  return smoothShade(md, SMOOTH.moulded)
}

function glassBand(r: number, z0: number, z1: number, seg: number): MeshData {
  const ring = (z: number): Vec3[] => circle(r, seg).map(([x, y]) => [x, y, z] as Vec3)
  return loft([ring(z0), ring(z1)], { closeV: true })
}

// ------------------------------------------------------------------- build

type Emit = (slot: string, part: MeshData) => void
type Ground = (x: number, y: number) => number

export function buildHydroTower(services: DistrictServices): void {
  const { writer } = services
  const y0 = ORIGIN_Y()
  const origin: Vec3 = [HYDRO_TOWER.x, HYDRO_TOWER.z, y0]
  const emit: Emit = (slot, part) => {
    translate(part, origin)
    writeInto(writer, slot, part)
  }
  const world = (px: number, py: number, pz: number): Vector3 =>
    new Vector3(HYDRO_TOWER.x + px, y0 + pz, HYDRO_TOWER.z + py)

  const glassParts: MeshData[] = []
  const crops: Matrix4[] = []
  const chard: Matrix4[] = []
  const rng = services.rng.fork('hydro-tower')

  /** Local height of the paved apron, relative to the tower datum. */
  const ground = (px: number, py: number): number =>
    interiorHeight(HYDRO_TOWER.x + px, HYDRO_TOWER.z + py) - y0

  plinth(emit, ground)
  curtainWall(emit, glassParts)
  core(emit)
  racks(emit, crops, chard, rng, y0)
  roof(emit, services, y0)
  signage(emit, services, y0, ground)
  serviceStair(emit, ground)
  colliders(services, world)

  const glass = curtainGlassMaterial()
  for (const part of glassParts) {
    translate(part, origin)
    const mesh = new Mesh(toGeometry(part), glass)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 6
    mesh.name = 'hydro-glazing'
    services.group.add(mesh)
  }

  plant(services, crops, cropHeadTexture(37, false, 256), 'hydro-crops', 0.36)
  plant(services, chard, cropHeadTexture(53, true, 256), 'hydro-chard', 0.42)
}

function plant(
  services: DistrictServices,
  transforms: Matrix4[],
  map: MeshStandardNodeMaterial['map'],
  name: string,
  height: number,
): void {
  if (transforms.length === 0) return
  const material = new MeshStandardNodeMaterial()
  material.map = map
  material.alphaTest = 0.34
  material.side = DoubleSide
  material.roughness = 0.7
  const card = new PlaneGeometry(height * 1.15, height)
  card.translate(0, height / 2, 0)
  const mesh = new InstancedMesh(card, material, transforms.length)
  transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = false
  mesh.name = name
  services.group.add(mesh)
}

// -------------------------------------------------------- 1. base + plinth

function plinth(emit: Emit, ground: Ground): void {
  // Cast base with a chamfered coping. Its underside follows the apron, which
  // falls 15 mm across the tower's own footprint.
  emit('cast', groundedBand(R_PLINTH, 6.2, FLOORS[0] - 0.08, ground, 0, Math.PI * 2, SEG_SMOOTH))
  emit('aluminum', ringBand(R_PLINTH - 0.03, 6.23, FLOORS[0] - 0.08, FLOORS[0], 0.012))
  emit('cast', prism(circle(6.2 - BUTT, SEG_SMOOTH), 0.4, FLOORS[0]))

  // Three intake louvre banks: a picture-frame surround APPLIED to the plinth
  // face with real blades in the opening, so the plant reads as a machine that
  // breathes. Frame and blades both stand proud — nothing is sunk into the
  // plinth solid.
  const fr0 = R_PLINTH + BUTT
  const fr1 = fr0 + 0.09
  for (const deg of [20, 140, 265]) {
    const phi = (deg * Math.PI) / 180
    const a0 = phi - 0.14
    const a1 = phi + 0.14
    emit('dark', sectorBand(fr1, fr0, a0, a1, 0.22, 0.3, 0.01))
    emit('dark', sectorBand(fr1, fr0, a0, a1, 0.86, 0.94, 0.01))
    for (const s of [-1, 1]) {
      emit('dark', sectorBand(fr1, fr0, phi + s * 0.14, phi + s * 0.12, 0.3, 0.86, 0.008))
    }
    // Blades: 42 mm gaps, 32° tilt, chord-mounted between the jambs.
    for (let i = 0; i < 6; i++) {
      const blade = roundedBoxMesh([-0.78, -0.032, -0.011, 0.78, 0.032, 0.011], 0.006, 2)
      rotX(blade, -0.56)
      rotateZ(blade, phi - Math.PI / 2)
      translate(blade, [Math.cos(phi) * (fr0 + 0.046), Math.sin(phi) * (fr0 + 0.046), 0.38 + i * 0.088])
      emit('aluminum', blade)
    }
  }
}

// -------------------------------------------------------- 2. curtain walls

function curtainWall(emit: Emit, glassParts: MeshData[]): void {
  const rIn = R_GLASS + MULL_GAP
  for (let f = 0; f < FLOORS.length; f++) {
    const z0 = FLOORS[f] + 0.05
    const z1 = FLOORS[f] + STOREY - GLASS_TOP_INSET + 0.05
    for (let j = 0; j < SEG_BAY; j++) {
      emit('aluminum', mullion((j / SEG_BAY) * Math.PI * 2, rIn, z0 + REVEAL, z1 - REVEAL))
    }
    for (let k = 1; k <= 2; k++) {
      const zc = z0 + ((z1 - z0) * k) / 3
      for (let j = 0; j < SEG_BAY; j++) {
        emit(
          'aluminum',
          transom(
            (j / SEG_BAY) * Math.PI * 2,
            ((j + 1) / SEG_BAY) * Math.PI * 2,
            rIn,
            zc,
            0.032,
          ),
        )
      }
    }
    glassParts.push(glassBand(R_GLASS, z0 + 0.02, z1 - 0.02, SEG_BAY))

    // Expressed floor band over the head of each storey — the horizontal that
    // makes a 12 m cylinder read as three stacked floors. The top band stops
    // AT the roof datum so the parapet has something to butt.
    const bandTop = Math.min(FLOORS[f] + STOREY + 0.05, Z_ROOF)
    emit('steel', ringBand(R_BAND, 6.5, z1, bandTop, 0.026))
    emit('dark', ringBand(R_BAND + 0.05, R_BAND + BUTT, z1 + 0.06, z1 + 0.13, 0.008))

    // Floor plate for the storey above (or the roof plate, added in roof()).
    if (f + 1 < FLOORS.length) {
      emit('steel', ringBand(6.5 - BUTT, R_SHAFT, FLOORS[f + 1] - 0.34, FLOORS[f + 1], 0.018))
      emit('deck', ringBand(6.46, R_SHAFT + 0.044, FLOORS[f + 1], FLOORS[f + 1] + 0.014, 0.006))
      // Shaft kerb: the service void needs a guarded edge, not a raw hole.
      emit('dark', ringBand(R_SHAFT + 0.04, R_SHAFT, FLOORS[f + 1], FLOORS[f + 1] + 0.11, 0.008))
    }
  }
}

// ------------------------------------------------------------- 3. the core

function core(emit: Emit): void {
  emit('steel', prism(circle(R_CORE, 48), FLOORS[0], Z_ROOF))
  // Riser stack: four insulated mains clear of the core face, on real
  // stand-off brackets rather than floating beside it.
  for (let i = 0; i < 4; i++) {
    const phi = (i / 4) * Math.PI * 2 + 0.4
    const px = Math.cos(phi) * 1.6
    const py = Math.sin(phi) * 1.6
    const pipe = tubeAlong(
      [
        [px, py, FLOORS[0]],
        [px, py, Z_ROOF + 0.5],
      ],
      circle(0.105, 14),
      { cap: true },
    )
    emit(i % 2 === 0 ? 'aluminum' : 'orange', smoothShade(pipe, SMOOTH.turned))
    for (let b = 0; b < 7; b++) {
      // Stops at the pipe's own face — a bracket that reaches the pipe AXIS
      // is a bracket driven through the pipe.
      const bracket = roundedBoxMesh([-0.055, 0, -0.03, 0.055, 0.095, 0.03], 0.008, 2)
      rotateZ(bracket, phi - Math.PI / 2)
      translate(bracket, [Math.cos(phi) * R_CORE, Math.sin(phi) * R_CORE, FLOORS[0] + 0.7 + b * 1.65])
      emit('dark', bracket)
    }
  }
  // Cat ladder up the core with a real hoop guard every fifth rung.
  const ladderPhi = Math.PI * 0.78
  for (const s of [-1, 1]) {
    const p = polar(ladderPhi, R_CORE + 0.14, s * 0.22)
    const stringer = tubeAlong(
      [
        [p[0], p[1], FLOORS[0]],
        [p[0], p[1], Z_ROOF + 1.0],
      ],
      roundedRect(0.036, 0.05, 0.01, 2),
      { cap: true },
    )
    emit('dark', smoothShade(stringer, SMOOTH.moulded))
  }
  const rungs = Math.floor((Z_ROOF + 0.6 - FLOORS[0]) / 0.32)
  for (let i = 0; i < rungs; i++) {
    // Rungs stop clear of the stringers' inner faces — a rung run to the
    // stringer AXIS is a rung driven through the stringer.
    const a = polar(ladderPhi, R_CORE + 0.14, -0.19)
    const b = polar(ladderPhi, R_CORE + 0.14, 0.19)
    const z = FLOORS[0] + 0.34 + i * 0.32
    const rung = tubeAlong([[a[0], a[1], z], [b[0], b[1], z]], circle(0.014, 8), { cap: true })
    emit('aluminum', smoothShade(rung, SMOOTH.turned))
  }
}

// ------------------------------------------------------- 4. the grow racks

function racks(
  emit: Emit,
  crops: Matrix4[],
  chard: Matrix4[],
  rng: DistrictServices['rng'],
  y0: number,
): void {
  for (const floor of FLOORS) {
    // Uprights: 16 inner + 16 outer, butting the tray edges exactly so no
    // post ever runs THROUGH a shelf (the classic merged-assembly clash).
    for (let i = 0; i < 16; i++) {
      const phi = (i / 16) * Math.PI * 2 + Math.PI / 16
      for (const [r, tag] of [
        [POST_INNER, 'in'],
        [POST_OUTER, 'out'],
      ] as const) {
        void tag
        const post = roundedBoxMesh([-0.03, -0.03, 0.062, 0.03, 0.03, TIER_Z[3] + 0.36], 0.007, 1)
        rotateZ(post, phi - Math.PI / 2)
        translate(post, [Math.cos(phi) * r, Math.sin(phi) * r, floor + 0.014])
        emit('aluminum', post)
        const foot = roundedBoxMesh([-0.06, -0.06, 0, 0.06, 0.06, 0.06], 0.008, 1)
        rotateZ(foot, phi - Math.PI / 2)
        translate(foot, [Math.cos(phi) * r, Math.sin(phi) * r, floor + 0.014])
        emit('dark', foot)
      }
    }

    for (let t = 0; t < TIER_Z.length; t++) {
      const zTray = floor + TIER_Z[t]
      // Tray deck + a raised lip at each edge: a hydroponic tray holds water,
      // so it has a rim, and the rim is what catches the grow light.
      emit('aluminum', ringBand(RACK_OUTER, RACK_INNER, zTray, zTray + 0.05, 0.006, 48))
      emit('aluminum', ringBand(RACK_OUTER, RACK_OUTER - 0.05, zTray + 0.05, zTray + 0.11, 0.006, 48))
      emit('aluminum', ringBand(RACK_INNER + 0.05, RACK_INNER, zTray + 0.05, zTray + 0.11, 0.006, 48))

      // Grow bar for THIS tier, hung 50 mm under the tray above (or under the
      // ceiling for the top tier) in its own dark reflector channel.
      const zAbove = t + 1 < TIER_Z.length ? floor + TIER_Z[t + 1] : floor + STOREY - 0.62
      emit('dark', ringBand(5.66, 4.96, zAbove - 0.13, zAbove - 0.07, 0.008, 48))
      emit('growBar', ringBand(5.58, 5.04, zAbove - 0.07, zAbove - 0.02, 0.006, 48))

      // Baseline planting. Two species, alternating bands so a shelf does not
      // read as one repeated card.
      const perTier = 46
      for (let i = 0; i < perTier; i++) {
        const phi = ((i + rng.range(0.15, 0.85)) / perTier) * Math.PI * 2
        const r = rng.range(RACK_INNER + 0.28, RACK_OUTER - 0.28)
        const matrix = new Matrix4()
        matrix.compose(
          new Vector3(
            HYDRO_TOWER.x + Math.cos(phi) * r,
            y0 + zTray + 0.05,
            HYDRO_TOWER.z + Math.sin(phi) * r,
          ),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, Math.PI)),
          new Vector3().setScalar(rng.range(0.72, 1.18)),
        )
        ;(i % 3 === 0 ? chard : crops).push(matrix)
      }
    }
  }
}

// ----------------------------------------------------------------- 5. roof

function roof(emit: Emit, services: DistrictServices, y0: number): void {
  const gate = STAIR_PHI
  // The top storey's band already occupies r 6.5–7.12 here: the roof plate
  // butts its inner face instead of running through it.
  emit('steel', ringBand(6.5 - BUTT, R_SHAFT, Z_ROOF - 0.42, Z_ROOF, 0.022))
  emit('deck', ringBand(R_PARAPET_IN - BUTT, R_SHAFT + 0.044, Z_ROOF, Z_ROOF + 0.016, 0.006))
  emit('dark', ringBand(R_SHAFT + 0.04, R_SHAFT, Z_ROOF, Z_ROOF + 0.11, 0.008))
  // Parapet with a gate at the stair landing — an arc, not a ring, because a
  // ring plus a hole is a boolean and this is not that kind of build.
  emit('cast', sectorBand(R_BAND, R_PARAPET_IN, gate + 0.18, gate + Math.PI * 2 - 0.18, Z_ROOF, Z_PARAPET, 0.024))
  // Gate posts stand INSIDE the gap: at the parapet's cut faces they would
  // straddle them and interpenetrate the casting.
  for (const s of [-1, 1]) {
    const phi = gate + s * 0.135
    const jamb = roundedBoxMesh([-0.16, -0.05, 0, 0.16, 0.05, 1.12], 0.014, 2)
    rotateZ(jamb, phi)
    translate(jamb, [Math.cos(phi) * 6.945, Math.sin(phi) * 6.945, Z_ROOF + 0.016])
    emit('dark', jamb)
  }

  // Vent stack cluster — three trunks off a shared plenum, cowled.
  emit('dark', sectorBand(5.1, 3.1, (86 * Math.PI) / 180, (176 * Math.PI) / 180, Z_ROOF + 0.016, Z_ROOF + 0.5, 0.02))
  for (const [deg, height, radius] of [
    [100, 3.4, 0.42],
    [131, 4.3, 0.5],
    [162, 2.8, 0.36],
  ] as const) {
    const phi = (deg * Math.PI) / 180
    const sx = Math.cos(phi) * 4.1
    const sy = Math.sin(phi) * 4.1
    const trunk: Vec2[] = [
      [0, 0],
      [radius + 0.07, 0],
      [radius + 0.07, 0.12],
      [radius, 0.19],
      [radius, height - 0.32],
      [radius + 0.05, height - 0.24],
      [radius + 0.05, height - 0.14],
      [radius * 0.72, height],
      [0, height],
    ]
    const body = revolve(trunk, 24, { capStart: true, capEnd: true, smooth: SMOOTH.turned })
    translate(body, [sx, sy, Z_ROOF + 0.5])
    emit('aluminum', body)
    const cowl = revolve(
      [
        [radius * 0.72, 0],
        [radius + 0.26, 0.14],
        [radius + 0.26, 0.2],
        [radius * 0.3, 0.36],
        [0, 0.38],
      ],
      24,
      { capStart: true, capEnd: false, smooth: SMOOTH.turned },
    )
    translate(cowl, [sx, sy, Z_ROOF + 0.5 + height])
    emit('dark', cowl)
  }

  // Nutrient tank on a saddle frame, with a gauge board and a small lamp.
  const tankPhi = (300 * Math.PI) / 180
  const tx = Math.cos(tankPhi) * 4.3
  const ty = Math.sin(tankPhi) * 4.3
  const tank = revolve(
    [
      [0, 0],
      [1.0, 0],
      [1.28, 0.36],
      [1.3, 1.9],
      [0.98, 2.3],
      [0, 2.44],
    ],
    32,
    { capStart: true, capEnd: false, smooth: SMOOTH.shell },
  )
  translate(tank, [tx, ty, Z_ROOF + 0.62])
  emit('habShell', tank)
  // Cradle plate the tank's flat bottom butts, on four legs off the deck.
  emit('dark', prism(circle(1.06, 32, tx, ty), Z_ROOF + 0.55, Z_ROOF + 0.62))
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4
    const leg = tubeAlong(
      [
        [tx + Math.cos(a) * 0.86, ty + Math.sin(a) * 0.86, Z_ROOF + 0.016],
        [tx + Math.cos(a) * 0.86, ty + Math.sin(a) * 0.86, Z_ROOF + 0.55],
      ],
      circle(0.05, 10),
      { cap: true },
    )
    emit('dark', smoothShade(leg, SMOOTH.turned))
  }
  // Hoop band at the tank's waist, standing clear of the shell.
  emit(
    'dark',
    annularPrism(
      circle(1.362, 32, tx, ty),
      circle(1.304, 32, tx, ty),
      Z_ROOF + 1.72,
      Z_ROOF + 1.84,
      0.008,
      1,
    ),
  )

  // Beacon: the tower's night mark, a tiny lens on a real mast.
  const beaconPhi = (250 * Math.PI) / 180
  const bx = Math.cos(beaconPhi) * 6.1
  const by = Math.sin(beaconPhi) * 6.1
  const mast = tubeAlong(
    [
      [bx, by, Z_ROOF + 0.016],
      [bx, by, Z_ROOF + 3.1],
    ],
    circle(0.045, 10),
    { cap: true },
  )
  emit('dark', smoothShade(mast, SMOOTH.turned))
  const hood = revolve(
    [
      [0, 0],
      [0.13, 0.02],
      [0.13, 0.08],
      [0, 0.1],
    ],
    14,
    { capStart: true, capEnd: true },
  )
  translate(hood, [bx, by, Z_ROOF + 3.08])
  emit('aluminum', hood)
  const lens = revolve(
    [
      [0, 0],
      [0.1, 0.015],
      [0.1, 0.11],
      [0, 0.13],
    ],
    14,
    { capStart: true, capEnd: false },
  )
  translate(lens, [bx, by, Z_ROOF + 3.18])
  emit('utilityLight', lens)

  // Roof hatch beside the landing, lid propped open — someone was up here.
  const hatchPhi = gate + 0.6
  const hx = Math.cos(hatchPhi) * 5.6
  const hy = Math.sin(hatchPhi) * 5.6
  const curb = roundedBoxMesh([-0.5, -0.42, 0, 0.5, 0.42, 0.16], 0.02, 2)
  rotateZ(curb, hatchPhi)
  translate(curb, [hx, hy, Z_ROOF + 0.016])
  emit('dark', curb)
  const lid = roundedBoxMesh([-0.52, -0.44, 0.16, 0.52, 0.44, 0.2], 0.014, 2)
  // +1.15 swings the lid UP off its hinge line; the negative sign folded it
  // straight down through the roof deck on the first pass.
  rotX(lid, 1.15, [0, -0.44, 0.16])
  rotateZ(lid, hatchPhi)
  translate(lid, [hx, hy, Z_ROOF + 0.016])
  emit('aluminum', lid)

  void services
  void y0
}

// -------------------------------------------------------------- 6. signage

function signage(emit: Emit, services: DistrictServices, y0: number, ground: Ground): void {
  // "62": the supergraphic, in a recessed tray on the parapet band facing the
  // park centre — the reference's numeral, at the reference's height.
  // Panel proportion is a CONTRACT with the canvas: face width = arc × radius,
  // face height = 2·(halfZ − rail − 0.03). The arc is NOT the 17° passed in —
  // `signBox` eats 0.015 rad of jamb at each end and hands back the face it
  // actually made: 0.266706 rad × r 7.2 = 1.9203 m wide, 1.12 m tall, so the
  // aspect is 0.5832. The old 0.52 came from multiplying the full 17° by 7.2
  // and squashed the numeral 12 %.
  const half = (8.5 * Math.PI) / 180
  const zc = Z_ROOF + 0.77
  const numeral = signBox(emit, {
    rHost: R_BAND,
    a0: PHI_PARK - half,
    a1: PHI_PARK + half,
    zc,
    halfZ: 0.66,
  })
  services.group.add(
    curvedSignMesh({
      ...numeral,
      centerX: HYDRO_TOWER.x,
      centerZ: HYDRO_TOWER.z,
      baseY: y0,
      material: signFaceMaterial(['62'], {
        aspect: (numeral.z1 - numeral.z0) / ((numeral.a1 - numeral.a0) * numeral.radius),
        tracking: 0.1,
        weight: 700,
        widthPx: 1024,
      }),
      name: 'hydro-supergraphic',
    }),
  )
  // Caption strip on the top storey's floor band, under the numeral — the way
  // the reference labels its block. 0.19 m tall on a 2.14 m panel.
  const capZ = Z_ROOF - 0.14
  const caption = signBox(emit, {
    rHost: R_BAND,
    a0: PHI_PARK - half * 1.45,
    a1: PHI_PARK + half * 1.45,
    zc: capZ,
    halfZ: 0.16,
    bezel: 0.03,
  })
  services.group.add(
    curvedSignMesh({
      ...caption,
      centerX: HYDRO_TOWER.x,
      centerZ: HYDRO_TOWER.z,
      baseY: y0,
      material: signFaceMaterial(['SEED FARMING · BLOCK 4'], {
        // Face is 2.8816 x 0.1896 -> 0.0658, not the 0.061 assumed here.
        aspect: (caption.z1 - caption.z0) / ((caption.a1 - caption.a0) * caption.radius),
        tracking: 0.28,
        weight: 600,
        widthPx: 1024,
        glow: 2.4,
      }),
      name: 'hydro-caption',
    }),
  )

  // The HYDROPONICS blade: a free-standing totem on the apron, off the walk
  // ring, lit down both edges — the reference's left-edge sign.
  const bladePhi = (232 * Math.PI) / 180
  const bx = Math.cos(bladePhi) * 9.9
  const by = Math.sin(bladePhi) * 9.9
  const faceYaw = (210 * Math.PI) / 180
  const bladeFoot = ground(bx, by)
  const plinthBox = roundedBoxMesh([-0.72, -0.3, bladeFoot, 0.72, 0.3, 0.34], 0.03, 2)
  rotateZ(plinthBox, faceYaw - Math.PI / 2)
  translate(plinthBox, [bx, by, 0])
  emit('cast', plinthBox)
  const bladePlan = roundedRect(1.22, 0.28, 0.09, 4).map(
    ([x, y]) =>
      [
        bx + x * Math.cos(faceYaw - Math.PI / 2) - y * Math.sin(faceYaw - Math.PI / 2),
        by + x * Math.sin(faceYaw - Math.PI / 2) + y * Math.cos(faceYaw - Math.PI / 2),
      ] as Vec2,
  )
  emit('dark', prism(bladePlan, 0.34, 2.78))
  const bladeCap = prism(bladePlan, 2.78, 2.86)
  bevel(bladeCap, 0.03, 2)
  emit('aluminum', bladeCap)
  // Edge-lit reveals down both long sides, standing 4 mm proud of the face.
  for (const s of [-1, 1]) {
    const strip = roundedBoxMesh([-0.028, -0.02, 0.4, 0.028, 0.02, 2.72], 0.008, 2)
    rotateZ(strip, faceYaw - Math.PI / 2)
    translate(strip, [
      bx + Math.cos(faceYaw - Math.PI / 2) * s * 0.5 + Math.cos(faceYaw) * 0.164,
      by + Math.sin(faceYaw - Math.PI / 2) * s * 0.5 + Math.sin(faceYaw) * 0.164,
      0,
    ])
    emit('signageGlow', strip)
  }
  const bladeFace = new Mesh(
    new PlaneGeometry(0.92, 2.0),
    signageMaterial(['HYDROPONICS', 'TOWER 62', 'SEALED · PRESSURISED', 'ROOT ZONE 4 TIERS'], {
      background: '#121412',
      ink: '#dfe7d8',
      accent: '#7fc26a',
      widthPx: 768,
      // Portrait blade: 0.92 × 2.0 m — the canvas must match or the type
      // rasterizes landscape and squashes flat on the plate.
      aspect: 0.92 / 2.0,
    }),
  )
  bladeFace.position.set(
    HYDRO_TOWER.x + bx + Math.cos(faceYaw) * 0.15,
    y0 + 1.62,
    HYDRO_TOWER.z + by + Math.sin(faceYaw) * 0.15,
  )
  bladeFace.rotation.y = Math.atan2(Math.cos(faceYaw), Math.sin(faceYaw))
  bladeFace.castShadow = false
  bladeFace.name = 'hydro-blade-sign'
  services.group.add(bladeFace)
}

// -------------------------------------------------- 7. external spiral stair

/**
 * The service stair: a true helical flight on its own newel, with a swept
 * outer stringer, a swept handrail and a landing bridge through the parapet
 * gate. Treads carry a 25 mm nosing, which overlaps the tread below IN PLAN
 * but is a full riser clear of it in section — a real nosing, not a clash.
 */
function serviceStair(emit: Emit, ground: Ground): void {
  const cx = Math.cos(STAIR_PHI) * STAIR_R
  const cy = Math.sin(STAIR_PHI) * STAIR_R
  // The TOP TREAD is the landing: its walking surface lands flush with the
  // roof deck, so the rise is solved backwards from the deck, not forwards.
  // Tread 0 stands on the newel's 20 mm base plate, clear of its foot flange.
  const BASE = 0.02
  const rise = (Z_ROOF + 0.016 - BASE - 0.042) / (STAIR_TREADS - 1)
  const nose = 0.0185
  const treadIn = 0.264
  // Land the top flight facing the tower: the last tread points inward.
  const theta0 = STAIR_PHI + Math.PI - (STAIR_TREADS - 1) * STAIR_DTHETA

  const newelFoot = ground(cx, cy)
  const newel = revolve(
    [
      [0, newelFoot],
      [0.44, newelFoot],
      [0.44, BASE - BUTT],
      // Straight to the shaft radius AT the base-plate top: a tapered flare
      // here would swallow the first two treads. The plate finishes one reveal
      // below tread 0 rather than exactly under it.
      [treadIn - BUTT, BASE - BUTT],
      [treadIn - BUTT, Z_ROOF + 0.8],
      [0.2, Z_ROOF + 0.94],
      [0, Z_ROOF + 0.96],
    ],
    24,
    { capStart: true, capEnd: false, smooth: SMOOTH.turned },
  )
  translate(newel, [cx, cy, 0])
  emit('steel', newel)

  const path: Vec3[] = []
  const railPath: Vec3[] = []
  for (let i = 0; i < STAIR_TREADS; i++) {
    const a = theta0 + i * STAIR_DTHETA
    const z = BASE + i * rise
    // Stringer centreline at 1.915: a swept section on a 12° chord bows
    // INWARD between stations (1.880 → 1.869 at mid-span), so the treads need
    // clearance from that dip, not from the nominal inner face.
    path.push([cx + Math.cos(a) * 1.915, cy + Math.sin(a) * 1.915, z + 0.02])
    railPath.push([cx + Math.cos(a) * 1.83, cy + Math.sin(a) * 1.83, z + 1.042])
  }
  const stringer = tubeAlong(path, [
    [-0.035, -0.24],
    [0.035, -0.24],
    [0.035, 0.06],
    [-0.035, 0.06],
  ], { cap: true })
  emit('steel', smoothShade(stringer, SMOOTH.moulded))
  const handrail = tubeAlong(railPath, roundedRect(0.05, 0.038, 0.014, 3), { cap: true })
  emit('orangeTop', smoothShade(handrail, SMOOTH.moulded))

  for (let i = 0; i < STAIR_TREADS; i++) {
    const a = theta0 + i * STAIR_DTHETA
    const z = BASE + i * rise
    const steps = 6
    const outer = arcPts(cx, cy, 1.865 - BUTT, a - nose, a + STAIR_DTHETA, steps)
    const inner = arcPts(cx, cy, treadIn, a + STAIR_DTHETA, a - nose, steps)
    const tread = prism([...outer, ...inner], z, z + 0.042)
    bevel(tread, 0.008, 2)
    emit('deck', tread)
    if (i % 2 === 0 && i > 0) {
      const ax = cx + Math.cos(a + STAIR_DTHETA * 0.5) * 1.83
      const ay = cy + Math.sin(a + STAIR_DTHETA * 0.5) * 1.83
      // Baluster stands ON the tread and stops at the handrail's flat soffit.
      const baluster = tubeAlong(
        [
          [ax, ay, z + 0.042],
          [ax, ay, z + 1.023],
        ],
        circle(0.019, 8),
        { cap: true },
      )
      emit('orange', smoothShade(baluster, SMOOTH.turned))
    }
  }

  // Landing bridge through the parapet gate. It spans from the roof deck edge
  // to the stringer's outboard face — the stringer runs past the landing as a
  // toe kerb, which is what a steel helical stair actually does.
  const near = R_PARAPET_IN + BUTT
  const far = STAIR_R - 1.954
  const bridgeLen = far - near
  const bx = Math.cos(STAIR_PHI) * (near + bridgeLen / 2)
  const by = Math.sin(STAIR_PHI) * (near + bridgeLen / 2)
  // 16 mm plate at exactly the roof-deck datum: a thicker deck would run into
  // the top storey's floor band, whose top IS Z_ROOF.
  const deck = roundedBoxMesh([-bridgeLen / 2, -0.62, 0, bridgeLen / 2, 0.62, 0.016], 0.008, 1)
  // rotateZ(phi) puts local +x on the RADIAL axis — which is what the bridge's
  // length must run along. −π/2 turned it broadside and drove it 270 mm into
  // the roof deck.
  rotateZ(deck, STAIR_PHI)
  translate(deck, [bx, by, Z_ROOF])
  emit('deck', deck)
  for (const s of [-1, 1]) {
    const ox = Math.cos(STAIR_PHI - Math.PI / 2) * s * 0.6
    const oy = Math.sin(STAIR_PHI - Math.PI / 2) * s * 0.6
    const rail = tubeAlong(
      [
        [bx + ox - Math.cos(STAIR_PHI) * (bridgeLen / 2), by + oy - Math.sin(STAIR_PHI) * (bridgeLen / 2), Z_ROOF + 1.04],
        [bx + ox + Math.cos(STAIR_PHI) * (bridgeLen / 2), by + oy + Math.sin(STAIR_PHI) * (bridgeLen / 2), Z_ROOF + 1.04],
      ],
      roundedRect(0.048, 0.036, 0.012, 3),
      { cap: true },
    )
    emit('orangeTop', smoothShade(rail, SMOOTH.moulded))
    for (const t of [-0.36, 0.36]) {
      const px = bx + ox + Math.cos(STAIR_PHI) * bridgeLen * t
      const py = by + oy + Math.sin(STAIR_PHI) * bridgeLen * t
      const post = tubeAlong(
        [
          [px, py, Z_ROOF + 0.016],
          [px, py, Z_ROOF + 1.022],
        ],
        circle(0.022, 8),
        { cap: true },
      )
      emit('orange', smoothShade(post, SMOOTH.turned))
    }
  }
}

// ------------------------------------------------------------ 8. colliders

function colliders(services: DistrictServices, world: (x: number, y: number, z: number) => Vector3): void {
  services.colliders.push({
    kind: 'cylinder',
    center: world(0, 0, Z_ROOF / 2),
    halfHeight: Z_ROOF / 2,
    radius: R_PLINTH + 0.12,
  })
  const cx = Math.cos(STAIR_PHI) * STAIR_R
  const cy = Math.sin(STAIR_PHI) * STAIR_R
  services.colliders.push({
    kind: 'cylinder',
    center: world(cx, cy, (Z_ROOF + 0.96) / 2),
    halfHeight: (Z_ROOF + 0.96) / 2,
    radius: 0.46,
  })
  const bladePhi = (232 * Math.PI) / 180
  services.colliders.push({
    kind: 'box',
    center: world(Math.cos(bladePhi) * 9.9, Math.sin(bladePhi) * 9.9, 1.43),
    size: new Vector3(1.44, 2.86, 0.6),
    yaw: (210 * Math.PI) / 180 - Math.PI / 2,
  })
}
