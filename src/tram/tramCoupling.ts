import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Sphere,
  Vector3,
} from 'three'
import {
  circle,
  prism,
  revolveY,
  rotateX,
  setSlot,
  SlotMesh,
  translate,
  unifyOrient,
  type MeshData,
  tubeAlong,
  type Vec2,
  type Vec3,
} from './tramMesh'
import type { TramMaterials } from './tramMaterials'

/**
 * THE COUPLING — the draw gear between the Loop's two cars.
 *
 * MECHANISM. A four-stage telescopic drawbar hung between two VERTICAL
 * KINGPINS, one in an open fork on each car's coupler head, with two jumper
 * hoses looped over it.
 *
 * WHY THIS SHAPE — the arrival spur's hook.
 * The spur turns ~85 deg in its last 11 m to meet the loop tangentially at the
 * portal stop, so while the train is docked the two cars sit 53 deg apart and
 * their coupler faces are 1.45 m apart, against 0.58 m on plain track. Every
 * decision here follows from that measured range (see
 * `tools/tram-coupling-audit.mjs`, which sweeps the real curves):
 *
 *  - **Vertical pins, not ball seats.** At the stop the bar leaves the rear
 *    car's head at 95 deg to that car's own axis. No spherical seat opens that
 *    far; a kingpin in an open fork has no yaw limit at all. The forks sit at
 *    y = −0.12, below the bumper, so nothing on the car's face is in the
 *    shank's sweep at any angle.
 *  - **The stroke is TRANSLATED, never stretched.** 0.58 → 1.45 m is a 2.5:1
 *    range; four 0.44 m stages nested one inside the next cover it with 136 mm
 *    of overlap still in hand at full draw. No part of this assembly is ever
 *    scaled — the previous gear stretched a ribbed rubber bellows over 0.06 →
 *    0.61 m, which past about double reads as a lumpy sausage.
 *  - **Nothing rigid with a car lives outside that car.** The forks and the
 *    hose glands are CHILDREN of their car; only the bar and the hoses live in
 *    world space. The old root flange bolted onto the front car's face from
 *    inside the aimed group, so at 22 deg it stood a 27 mm wedge out of the
 *    casting it was supposedly bolted to — the "broken at this angle" report.
 *
 * The jumper hoses are the one part that genuinely must change SHAPE. They are
 * rebuilt every fixed step as a Hermite between the two glands, tangent to each
 * gland's own canted axis at its own end (see `FlexHose` and `hoseAxis`), so
 * they land exactly on their bosses at any kink and slacken as the pair closes
 * up.
 *
 * PLACEMENT CONTRACT. `forkFront` is a child of the FRONT car (its TAIL, −Z),
 * `forkRear` a child of the REAR car (its NOSE, +Z); add each once. `group`
 * holds the bar, the two eyes and the hoses in world space and is rebuilt every
 * fixed step by `update(front, rear)` from the two cars' world matrices, which
 * must already be current.
 */

/** Where each end's coupler head finishes — `tramBody.buildEnd`'s pocket. */
export const COUPLER_HEAD_Z = 4.06
/** Kingpin axis, in the car's local frame: on the centreline, below the bumper. */
export const PIN_Z = 4.06
export const PIN_Y = -0.12
const PIN_R = 0.022

/** Fork jaws: 0.11 m of throat, which is the eye's height plus a 5 mm reveal. */
const JAW_GAP = 0.11
const JAW_THICK = 0.06
const JAW_HALF_X = 0.13
const JAW_BACK_Z = 3.98
const JAW_FRONT_Z = 4.2

/** Eye boss riding the pin. */
const EYE_R = 0.08
const EYE_H = 0.1

/** Telescope: four stages of this length, each nested in the one before. */
const STAGE = 0.44
const STAGE_R = [0.062, 0.05, 0.04, 0.031]
/** Neck between a pin and the first/last stage's face; buried in the eye. */
const NECK = 0.05

/**
 * Jumper hose gland, in the car's local frame (mirrored in x). Its mouth
 * stands 0.19 m clear of the car's end plane on purpose: at the platform hook
 * the two glands are 1.5 m apart at 53 deg, so a hose anchored ON the end face
 * runs ACROSS that face for its first half metre and grazes into the nose.
 */
const BOSS = { x: 0.175, y: -0.01, z: 3.98 }
const BOSS_REACH = 0.24

/**
 * Gland axis, in the car's local frame. It is canted OUTBOARD and UP, not
 * straight ahead: at the stop the pair kinks 53 deg, so a gland aimed along
 * its own car's axis aims across the OTHER car's nose, and the hose's first
 * third runs through that nose. Canted, both hoses leave into open air.
 */
export function hoseAxis(sx: number, sign: number, target: Vector3): Vector3 {
  return target.set(sx * 0.62, 0.42, sign).normalize()
}

/** Gland mouth in the car's local frame — the hose's anchor. Shared with the audit. */
export function hoseGland(sx: number, sign: number, target: Vector3): Vector3 {
  return hoseAxis(sx, sign, target)
    .multiplyScalar(BOSS_REACH - 0.015)
    .add(new Vector3(sx * BOSS.x, BOSS.y, sign * BOSS.z))
}
const HOSE_R = 0.018
const HOSE_STATIONS = 22
const HOSE_SIDES = 8

export interface TramCoupling {
  /** Draw bar, eyes and jumper hoses, in world space. Add to the moving group. */
  group: Group
  /** Kingpin fork for the FRONT car's tail; add as its child, once. */
  forkFront: Group
  /** Kingpin fork for the REAR car's nose; add as its child, once. */
  forkRear: Group
  update(front: Object3D, rear: Object3D): void
}

/** Lathe a (radius, along) profile about the coupler axis (+Z). */
function latheZ(profile: Vec2[], segments: number, smooth: number): MeshData {
  return unifyOrient(rotateX(revolveY(profile, segments, { smooth }), Math.PI / 2))
}

// ------------------------------------------------------------------- fork --

/**
 * The kingpin fork, authored on the +Z end and mirrored for the tail. Two jaw
 * plates rooted 80 mm inside the head casting, a pin through both, and the
 * hose glands outboard of them.
 */
function buildFork(materials: TramMaterials, sign: 1 | -1): Group {
  const slots = new SlotMesh()
  const plate = (yc: number): MeshData => {
    // Plan outline in `prism`'s y-axis convention, which is (z, x). A slab that
    // rounds off AROUND the pin rather than ending square in front of it.
    const outline: Vec2[] = [
      [JAW_BACK_Z, -JAW_HALF_X],
      [JAW_BACK_Z, JAW_HALF_X],
      [PIN_Z, JAW_HALF_X],
    ]
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI
      outline.push([PIN_Z + Math.sin(a) * (JAW_FRONT_Z - PIN_Z), Math.cos(a) * JAW_HALF_X])
    }
    outline.push([PIN_Z, -JAW_HALF_X])
    return prism(outline, 'y', yc - JAW_THICK / 2, yc + JAW_THICK / 2, 26)
  }
  for (const s of [-1, 1]) {
    const jaw = plate(PIN_Y + s * (JAW_GAP / 2 + JAW_THICK / 2))
    if (sign < 0) rotateX(jaw, Math.PI)
    slots.add(setSlot(jaw, 'alloy'), 'alloy')
  }
  // Pin: one turned bar through both jaws, with a head and a split-pin boss.
  const pin = unifyOrient(
    revolveY(
      [
        [0, -JAW_GAP / 2 - JAW_THICK - 0.052],
        [0.036, -JAW_GAP / 2 - JAW_THICK - 0.052],
        [0.036, -JAW_GAP / 2 - JAW_THICK - 0.024],
        [PIN_R, -JAW_GAP / 2 - JAW_THICK - 0.018],
        [PIN_R, JAW_GAP / 2 + JAW_THICK + 0.03],
        [0.034, JAW_GAP / 2 + JAW_THICK + 0.036],
        [0.034, JAW_GAP / 2 + JAW_THICK + 0.062],
        [0, JAW_GAP / 2 + JAW_THICK + 0.062],
      ],
      16,
      { smooth: 32 },
    ),
  )
  translate(pin, [0, PIN_Y, sign * PIN_Z])
  slots.add(setSlot(pin, 'dark'), 'dark')

  // Hose glands: a boss on each side of the head, canted outboard and up so
  // the hose leaves into open air rather than across the other car's nose.
  for (const sx of [-1, 1]) {
    const base = new Vector3(sx * BOSS.x, BOSS.y, sign * BOSS.z)
    const dir = hoseAxis(sx, sign, new Vector3())
    const at = (d: number): Vec3 => {
      const p = base.clone().addScaledVector(dir, d)
      return [p.x, p.y, p.z]
    }
    // Body then stem, lapped 20 mm so no two caps land coplanar.
    slots.add(
      setSlot(tubeAlong([at(-0.05), at(0.07)], circle(0.044, 14), { capStart: true, capEnd: true, smooth: 30 }), 'dark'),
      'dark',
    )
    slots.add(
      setSlot(tubeAlong([at(0.05), at(BOSS_REACH)], circle(0.031, 12), { capStart: true, capEnd: true, smooth: 30 }), 'dark'),
      'dark',
    )
  }

  const group = new Group()
  group.name = sign > 0 ? 'tram-coupling-fork-rear' : 'tram-coupling-fork-front'
  group.add(slots.build(materials))
  return group
}

// -------------------------------------------------------------------- bar --

/** The eye that rides a kingpin: a bushed boss, axis vertical. */
function eyeBoss(): MeshData {
  const body = unifyOrient(
    revolveY(
      [
        [PIN_R + 0.004, -EYE_H / 2],
        [EYE_R, -EYE_H / 2],
        [EYE_R, EYE_H / 2],
        [PIN_R + 0.004, EYE_H / 2],
      ],
      20,
      { smooth: 32 },
    ),
  )
  return body
}

/**
 * One telescope stage: a tube with a gland ring at its outboard end. Every
 * stage is a FIXED mesh — the stroke is taken up by moving them, never by
 * scaling them, which is what keeps the assembly readable at any extension.
 */
function stageTube(index: number): MeshData {
  const r = STAGE_R[index]
  // Gland stands 8 mm proud — less than the step down to the next stage, so a
  // gland can never land on the bore of the tube it slides inside.
  const gland = r + 0.008
  return latheZ(
    [
      [0, 0],
      [r, 0],
      [r, STAGE - 0.05],
      [gland, STAGE - 0.042],
      [gland, STAGE - 0.008],
      [r - 0.004, STAGE],
      [0, STAGE],
    ],
    20,
    32,
  )
}

// ------------------------------------------------------------------ hoses --

/**
 * A jumper hose rebuilt every step: a cubic Hermite between two anchors, each
 * with its own tangent, swept with a circular section on a fixed up-reference.
 * Topology is allocated once; only positions and normals move.
 *
 * A hose is the one part of the draw gear that has to change SHAPE — anchored
 * to two cars that sit 53 deg apart at the stop, no rigid arch meets both
 * glands.
 */
class FlexHose {
  readonly mesh: Mesh
  private readonly positions: Float32Array
  private readonly normals: Float32Array
  private readonly geometry: BufferGeometry
  private readonly p = new Vector3()
  private readonly d = new Vector3()
  private readonly nx = new Vector3()
  private readonly ny = new Vector3()

  constructor(material: TramMaterials[string]) {
    const count = (HOSE_STATIONS + 1) * (HOSE_SIDES + 1)
    this.positions = new Float32Array(count * 3)
    this.normals = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    const indices: number[] = []
    for (let i = 0; i <= HOSE_STATIONS; i++) {
      for (let j = 0; j <= HOSE_SIDES; j++) {
        const k = i * (HOSE_SIDES + 1) + j
        uvs[k * 2] = j / HOSE_SIDES
        uvs[k * 2 + 1] = i / HOSE_STATIONS
        if (i < HOSE_STATIONS && j < HOSE_SIDES) {
          const a = k
          const b = k + 1
          const c = k + HOSE_SIDES + 1
          indices.push(a, c, b, b, c, c + 1)
        }
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    // World-space geometry that moves every step: give it bounds that always
    // contain the alignment rather than recomputing them 60 times a second.
    geometry.boundingSphere = new Sphere(new Vector3(), 400)
    this.geometry = geometry
    this.mesh = new Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true
  }

  /** Hermite from `a` (leaving along `ta`) to `b` (arriving along `tb`). */
  update(a: Vector3, ta: Vector3, b: Vector3, tb: Vector3, up: Vector3): void {
    const pos = this.positions
    const nrm = this.normals
    for (let i = 0; i <= HOSE_STATIONS; i++) {
      const t = i / HOSE_STATIONS
      const t2 = t * t
      const t3 = t2 * t
      this.p
        .copy(a)
        .multiplyScalar(2 * t3 - 3 * t2 + 1)
        .addScaledVector(ta, t3 - 2 * t2 + t)
        .addScaledVector(b, -2 * t3 + 3 * t2)
        .addScaledVector(tb, t3 - t2)
      // Analytic tangent — a finite difference collapses at the ends.
      this.d
        .copy(a)
        .multiplyScalar(6 * t2 - 6 * t)
        .addScaledVector(ta, 3 * t2 - 4 * t + 1)
        .addScaledVector(b, -6 * t2 + 6 * t)
        .addScaledVector(tb, 3 * t2 - 2 * t)
      if (this.d.lengthSq() < 1e-10) this.d.subVectors(b, a)
      this.d.normalize()
      this.nx.crossVectors(up, this.d)
      if (this.nx.lengthSq() < 1e-8) this.nx.set(1, 0, 0)
      this.nx.normalize()
      this.ny.crossVectors(this.d, this.nx)
      for (let j = 0; j <= HOSE_SIDES; j++) {
        const angle = (j / HOSE_SIDES) * Math.PI * 2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const k = (i * (HOSE_SIDES + 1) + j) * 3
        nrm[k] = this.nx.x * cos + this.ny.x * sin
        nrm[k + 1] = this.nx.y * cos + this.ny.y * sin
        nrm[k + 2] = this.nx.z * cos + this.ny.z * sin
        pos[k] = this.p.x + nrm[k] * HOSE_R
        pos[k + 1] = this.p.y + nrm[k + 1] * HOSE_R
        pos[k + 2] = this.p.z + nrm[k + 2] * HOSE_R
      }
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.normal.needsUpdate = true
  }
}

// ------------------------------------------------------------------ build --

const PIN_FRONT = /*@__PURE__*/ new Vector3(0, PIN_Y, -PIN_Z)
const PIN_REAR = /*@__PURE__*/ new Vector3(0, PIN_Y, PIN_Z)

export function buildTramCoupling(materials: TramMaterials): TramCoupling {
  const group = new Group()
  group.name = 'tram-coupling'

  // The bar: aimed pin to pin. Its children only ever TRANSLATE along +Z.
  const bar = new Group()
  bar.name = 'tram-coupling-bar'
  group.add(bar)

  const stages: Group[] = []
  for (let i = 0; i < STAGE_R.length; i++) {
    const slots = new SlotMesh()
    const slot = i === 0 ? 'alloy' : 'dark'
    slots.add(setSlot(stageTube(i), slot), slot)
    const stage = new Group()
    stage.name = `tram-coupling-stage-${i}`
    stage.add(slots.build(materials))
    bar.add(stage)
    stages.push(stage)
  }

  // The eyes take their car's roll, not the bar's: they are bushes on a pin
  // that belongs to the car.
  const eyes: Group[] = []
  for (let i = 0; i < 2; i++) {
    const slots = new SlotMesh()
    slots.add(setSlot(eyeBoss(), 'alloy'), 'alloy')
    const eye = new Group()
    eye.name = `tram-coupling-eye-${i}`
    eye.add(slots.build(materials))
    group.add(eye)
    eyes.push(eye)
  }

  const hoses = [new FlexHose(materials.rubber), new FlexHose(materials.rubber)]
  for (const hose of hoses) group.add(hose.mesh)

  const forkFront = buildFork(materials, -1)
  const forkRear = buildFork(materials, 1)

  const from = new Vector3()
  const to = new Vector3()
  const forward = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  const upRef = new Vector3()
  const upB = new Vector3()
  const basis = new Matrix4()
  const anchorA = new Vector3()
  const anchorB = new Vector3()
  const tangentA = new Vector3()
  const tangentB = new Vector3()
  const axisA = new Vector3()
  const axisB = new Vector3()
  const lateral = new Vector3()
  const crest = new Vector3()

  return {
    group,
    forkFront,
    forkRear,
    update(front, rear) {
      from.copy(PIN_FRONT).applyMatrix4(front.matrixWorld)
      to.copy(PIN_REAR).applyMatrix4(rear.matrixWorld)
      // Roll reference: the mean of the two cars' local up, so the bar banks
      // with the pair instead of taking an arbitrary roll from a look-at.
      upRef.set(0, 1, 0).applyQuaternion(front.quaternion)
      upB.set(0, 1, 0).applyQuaternion(rear.quaternion)
      upRef.add(upB).normalize()

      forward.subVectors(to, from)
      const span = forward.length()
      if (span < 1e-4) return
      forward.divideScalar(span)
      right.crossVectors(upRef, forward)
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
      right.normalize()
      up.crossVectors(forward, right)
      basis.makeBasis(right, up, forward)
      bar.position.copy(from)
      bar.quaternion.setFromRotationMatrix(basis)

      // Telescope. Each stage carries an equal share of whatever the span asks
      // for beyond one nested tube, so the draw stays symmetric.
      const extend = Math.max(0, span - 2 * NECK - STAGE) / (STAGE_R.length - 1)
      for (let i = 0; i < stages.length; i++) stages[i].position.z = NECK + i * extend

      eyes[0].position.copy(from)
      eyes[0].quaternion.copy(front.quaternion)
      eyes[1].position.copy(to)
      eyes[1].quaternion.copy(rear.quaternion)

      // Jumper hoses: anchored on each car's own gland, and routed over the
      // DRAWBAR rather than straight across. Aiming them along each car's own
      // axis is what a gland does, but on the platform hook the two glands are
      // 1.5 m apart at 53 deg and a curve that leaves along the axis swings
      // wide enough to graze the front car's own tail corner. The bar is the
      // one line through this gap that is proved clear of both bodies, so the
      // hoses are hung on it — which is also what they physically do.
      lateral.crossVectors(upRef, forward).normalize()
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? -1 : 1
        hoseGland(sx, -1, anchorA).applyMatrix4(front.matrixWorld)
        hoseGland(sx, 1, anchorB).applyMatrix4(rear.matrixWorld)
        hoseAxis(sx, -1, axisA).applyQuaternion(front.quaternion)
        hoseAxis(sx, 1, axisB).applyQuaternion(rear.quaternion)
        // Crest on the GLAND chord, bowed UP and out — never on the pin chord.
        // The pins sit 0.13 m behind the glands, so a crest taken from them
        // pulls the loop BACKWARD, and at the stop that walked the hose 76 mm
        // into the rear car's nose a quarter of the way along its run.
        crest
          .copy(anchorA)
          .add(anchorB)
          .multiplyScalar(0.5)
          .addScaledVector(upRef, 0.3)
          .addScaledVector(lateral, sx * 0.15)
        // Both tangents aim at the crest, with a good share of each gland's
        // own axis blended in so the hose leaves its boss straight before it
        // turns. 1.7 carries the curve's mid-point about half way to the
        // crest: a slack loop on plain track, a taut one at full draw.
        tangentA.subVectors(crest, anchorA).multiplyScalar(1.7).addScaledVector(axisA, 0.8)
        tangentB.subVectors(anchorB, crest).multiplyScalar(1.7).addScaledVector(axisB, -0.8)
        hoses[i].update(anchorA, tangentA, anchorB, tangentB, upRef)
      }

      group.updateMatrixWorld(true)
    },
  }
}
