import {
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import type { Rng } from '../core/prng'
import { createBarkMaterial, createFoliageMaterial, floatAttribute } from './foliageMaterial'
import { ginkgoLeafTexture } from './leafTextures'
import { CardSink } from './species'

/**
 * THE FIRST TREE — a 12 m ginkgo, the only large tree on Mars.
 *
 * Grown with the structured-ash method (`threejs-procedural-vegetation`
 * skill), retuned to a ginkgo species table. What that method buys, and what
 * a hand-placed set of swept tubes cannot:
 *
 *   • **The continuation model.** Every branch spawns ONE terminal
 *     continuation inheriting the parent's section/segment counts, *plus* its
 *     stratified lateral children. Lateral-only generators make a candelabra;
 *     the continuation is what produces a real leader and an irregular crown.
 *   • **Euler-accumulated orientation**, never a rebuilt tangent frame. The
 *     per-section wobble (`gnarliness × max(1, 1/√radius)`) and the
 *     pre-multiplied tropism (`step = forceStrength / radius`) are the species
 *     identity: twigs snap toward vertical, the trunk barely notices.
 *   • **Stratified placement** — the domain is divided into slots and the
 *     jitter applied inside a slot, so children never clump or align.
 *
 * DECLARED DIVERGENCES from the ash contract (§11 of the reference):
 *   1. Species table is ginkgo, not ash, and metric: a 12 m tree, not 80.
 *   2. Longitudinal UV is REAL ARC LENGTH in metres, not the alternating 0/1
 *      ring pattern, and U is metric circumference. Bark scale is therefore
 *      identical on the trunk and on a twig, which the alternating pattern
 *      cannot do.
 *   3. Trunk sections are eased (`t^1.35`) so eight of sixteen land in the
 *      bottom 1.4 m — a root flare needs resolution, and a 12 m tree has no
 *      spare sections to spend uniformly.
 *   4. Bark ridges are REAL GEOMETRY: each ring's radius is cut by a periodic
 *      fissure field with an analytic θ-derivative feeding the normal. The
 *      project already learned this on the ground (notes.md S14: "ground art
 *      needs GEOMETRY"); a fissure painted only in albedo dies under the
 *      grade at 2 m.
 *   5. Root flare and branch grafts are radius laws on the branch's OWN
 *      rings. A lateral starts as a narrow ring buried inside its parent,
 *      resolves a restrained 1.16× shoulder over three short spans, then
 *      settles to its branch radius. The former exposed 2.45× base ring made
 *      the pointed wedges visible at every major fork.
 *   6. Short shoots (spurs) are added. They are not in the ash preset and
 *      they are the single most ginkgo-specific feature of the tree.
 *   7. Each growth site authors one cupped, individually painted ginkgo leaf.
 *      The short-shoot topology forms the clusters; crossed cards containing
 *      entire painted sprays made the crown opaque and hid the branching.
 */

export interface FirstTreeResult {
  group: Group
  /** Trunk collider spec (cylinder). */
  collider: { center: Vector3; halfHeight: number; radius: number }
  /** Soil surface the collar planting sits on (world Y). */
  soilTop: number
  /** Crown centre and radius — the audit camera and the collar both want it. */
  crown: { center: Vector3; radius: number }
  stats: {
    branchTriangles: number
    leafTriangles: number
    leafCards: number
    leafSites: number
    junctions: number
    junctionRings: number
    maxJunctionScale: number
    spurs: number
  }
}

const GINKGO = {
  branchLevels: 3,
  branch: {
    /**
     * Metres. Level 0 is the trunk to the first fork region.
     * These are ARC lengths, not heights: gnarliness and emergence angles
     * cost about 18 % of the chain's rise, so the table is tuned against a
     * measured crown top (see the headless height check) rather than against
     * the sum. 6.3 + 4.1 + 2.36 + 1.27 = 14.0 m of wood → a 12.0 m tree.
     */
    length: [6.3, 4.1, 2.36, 1.27],
    /** Level 0 is an ABSOLUTE base radius; the rest multiply the parent. */
    radius: [0.235, 0.56, 0.62, 0.66],
    sections: [20, 13, 9, 9],
    segments: [30, 18, 12, 8],
    /** Emergence angle from the parent, degrees. */
    angle: [0, 44, 56, 47],
    children: [6, 4, 3, 0],
    start: [0, 0.62, 0.3, 0],
    gnarliness: [0.008, 0.075, 0.115, 0.1],
    twist: [0.04, -0.05, 0.03, 0],
    taper: [0.45, 0.62, 0.66, 0.72],
    forceStrength: 0.0022,
  },
  leaves: {
    /** Alternate sites along a long shoot. */
    count: 14,
    start: 0.16,
    angle: 54,
    size: 0.275,
    sizeVariance: 0.22,
  },
  spurs: {
    /** Short shoots per branch, by level. Older wood carries more. */
    perLevel: [0, 0, 8, 3],
    start: 0.22,
    length: [0, 0, 0.062, 0.045],
    radius: 0.0125,
    sitesEach: 5,
  },
  /** Root flare: extra radius decaying with height, plus buttress lobes. */
  flare: { amount: 0.66, decay: 1.05, lobes: 3, lobeAmount: 0.5, lobeDecay: 0.72 },
  /**
   * Concealed branch graft. The first ring is small and buried, grows into a
   * restrained shoulder, then settles to the branch radius. A uniformly
   * oversized base ring makes a polygonal wedge where it cuts the parent.
   */
  collar: { hiddenScale: 0.42, shoulderScale: 1.16, reach: 1.8, sink: 0.38 },
} as const

const UP = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const FORCE = new Vector3(0, 1, 0)

interface BranchJob {
  origin: Vector3
  orientation: Euler
  length: number
  radius: number
  level: number
  sectionCount: number
  segmentCount: number
  continuation: boolean
  /** Parent radius at the attachment — drives the collar swell. */
  collarRadius: number
}

interface Section {
  origin: Vector3
  orientation: Euler
  radius: number
  /** Arc length from the branch base, metres. */
  run: number
}

interface LeafSite {
  position: Vector3
  quaternion: Quaternion
  size: number
  seed: number
}

/**
 * The bark fissure field. Integer θ harmonics so it is exactly periodic
 * around the branch (a non-integer harmonic leaves a visible seam), drifting
 * slowly along the run so the fissures read as continuous vertical furrows.
 * Returns the value in [-1, 1] and its exact θ-derivative for the normal.
 */
function barkRidge(theta: number, run: number, seed: number): { value: number; dTheta: number } {
  const terms: Array<[number, number, number, number]> = [
    [5, 0.5, 1.7, 0.5],
    [9, 0.3, -2.3, 0.32],
    [15, 0.18, 0.9, 0.7],
    [23, 0.1, -3.1, 0.24],
  ]
  let value = 0
  let dTheta = 0
  for (const [k, amplitude, phase, drift] of terms) {
    const argument = k * theta + phase * seed + run * drift
    value += Math.sin(argument) * amplitude
    dTheta += Math.cos(argument) * amplitude * k
  }
  return { value: value / 1.08, dTheta: dTheta / 1.08 }
}

function growGinkgo(rng: Rng): {
  geometry: BufferGeometry
  sites: LeafSite[]
  triangles: number
  spurs: number
  junctions: number
  junctionRings: number
  height: number
} {
  const preset = GINKGO
  const seedBase = rng.float() * 100

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const ridges: number[] = []
  const indices: number[] = []
  const sites: LeafSite[] = []
  let spurCount = 0
  let junctionCount = 0
  let junctionRingCount = 0
  let maxHeight = 0

  const jobs: BranchJob[] = [
    {
      origin: new Vector3(),
      orientation: new Euler(),
      length: preset.branch.length[0],
      radius: preset.branch.radius[0],
      level: 0,
      sectionCount: preset.branch.sections[0],
      segmentCount: preset.branch.segments[0],
      continuation: true,
      collarRadius: 0,
    },
  ]

  /** Interpolate the stored sections — orientation slerps from B toward A. */
  const interpolate = (sections: Section[], along: number) => {
    const scaled = along * (sections.length - 1)
    const indexA = Math.min(Math.floor(scaled), sections.length - 1)
    const indexB = Math.min(indexA + 1, sections.length - 1)
    const alpha = scaled - indexA
    const a = sections[indexA]
    const b = sections[indexB]
    const qA = new Quaternion().setFromEuler(a.orientation)
    const qB = new Quaternion().setFromEuler(b.orientation)
    return {
      origin: new Vector3().lerpVectors(a.origin, b.origin, alpha),
      radius: a.radius + (b.radius - a.radius) * alpha,
      run: a.run + (b.run - a.run) * alpha,
      orientation: new Euler().setFromQuaternion(qB.slerp(qA, alpha)),
    }
  }

  /** Compose parent × azimuth(local Y) × emergence(local X). */
  const emergent = (parentOrientation: Euler, azimuth: number, emergence: number): Euler => {
    const parent = new Quaternion().setFromEuler(parentOrientation)
    const azimuthQ = new Quaternion().setFromAxisAngle(UP, azimuth)
    const tiltQ = new Quaternion().setFromAxisAngle(X_AXIS, emergence)
    return new Euler().setFromQuaternion(parent.multiply(azimuthQ.multiply(tiltQ)))
  }

  const addLeafSite = (
    origin: Vector3,
    orientation: Euler,
    azimuth: number,
    scale = 1,
  ): void => {
    const tilt = (preset.leaves.angle * Math.PI) / 180
    const quaternion = new Quaternion().setFromEuler(
      emergent(orientation, azimuth, tilt),
    )
    const size =
      preset.leaves.size *
      scale *
      (1 + rng.range(-preset.leaves.sizeVariance, preset.leaves.sizeVariance))
    sites.push({ position: origin.clone(), quaternion, size, seed: rng.float() })
  }

  /**
   * A short shoot: 2–3 cm of knobbly spur wood covered in old leaf scars,
   * modelled as alternating ring radii. Ginkgo's leaves cluster on these, and
   * without them a ginkgo canopy reads as a generic broadleaf.
   */
  const emitSpur = (origin: Vector3, orientation: Euler, length: number): void => {
    const base = positions.length / 3
    const segments = 5
    const rings = 3
    const scars = [1, 1.28, 1.02]
    const step = length / rings
    const cursor = origin.clone()
    const axis = new Vector3(0, 1, 0).applyEuler(orientation)
    for (let ring = 0; ring <= rings; ring++) {
      const radius = preset.spurs.radius * (ring === rings ? 0.72 : scars[ring % scars.length])
      for (let radial = 0; radial <= segments; radial++) {
        const theta = (Math.PI * 2 * (radial % segments)) / segments
        const local = new Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius)
        local.applyEuler(orientation)
        const normal = new Vector3(Math.cos(theta), 0, Math.sin(theta)).applyEuler(orientation)
        positions.push(cursor.x + local.x, cursor.y + local.y, cursor.z + local.z)
        normals.push(normal.x, normal.y, normal.z)
        uvs.push((radial / segments) * 0.08, ring * step)
        ridges.push(ring % 2 === 0 ? 0.72 : 0.3)
      }
      if (ring < rings) cursor.addScaledVector(axis, step)
    }
    const stride = segments + 1
    for (let ring = 0; ring < rings; ring++) {
      for (let radial = 0; radial < segments; radial++) {
        const a = base + ring * stride + radial
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1)
      }
    }
    spurCount++
    // Leaves cluster at the spur tip, fanning around it.
    for (let i = 0; i < preset.spurs.sitesEach; i++) {
      addLeafSite(cursor, orientation, (i / preset.spurs.sitesEach) * Math.PI * 2 + rng.float(), 0.92)
    }
  }

  while (jobs.length > 0) {
    const branch = jobs.shift() as BranchJob
    const indexOffset = positions.length / 3
    const orientation = branch.orientation.clone()
    const origin = branch.origin.clone()
    const sections: Section[] = []
    const branchSeed = seedBase + branch.level * 13.7 + sections.length
    const segmentCount = branch.segmentCount
    const stride = segmentCount + 1
    // Level 0 bunches its sections at the base so the root flare resolves.
    // A lateral reserves three short spans for its concealed graft; without
    // those rings the entire collar transition lands in one long triangle.
    const sectionT = (index: number): number => {
      const t = index / branch.sectionCount
      if (branch.level === 0) return Math.pow(t, 1.35)
      if (branch.continuation || branch.collarRadius <= 0) return t
      const graftSections = Math.min(3, Math.max(1, Math.floor(branch.sectionCount / 3)))
      const graftFraction = Math.min(
        0.24,
        (branch.collarRadius * preset.collar.reach) / branch.length,
      )
      if (index <= graftSections) return (index / graftSections) * graftFraction
      return (
        graftFraction +
        ((index - graftSections) / (branch.sectionCount - graftSections)) * (1 - graftFraction)
      )
    }
    // Fissures scale with the branch: a twig has no corky ridges.
    const ridgeAmplitude = Math.min(0.012, branch.radius * 0.075)
    let run = 0

    for (let sectionIndex = 0; sectionIndex <= branch.sectionCount; sectionIndex++) {
      const t = sectionIndex / branch.sectionCount
      let sectionRadius = branch.radius * (1 - preset.branch.taper[branch.level] * t)
      if (sectionIndex === branch.sectionCount && branch.level === preset.branchLevels) {
        // Never author a zero radius — a tip is a tiny disc, not a fan of
        // coincident vertices (geometry-craft §5.2.6).
        sectionRadius = 0.0015
      }

      // Root flare (trunk only) and branch graft (laterals) are radius laws on
      // THIS branch's rings. The graft begins narrow and hidden inside the
      // parent, reaches one modest shoulder, then settles to the limb radius.
      const heightAboveBase = origin.y
      let flare = 1
      let flareDTheta = 0
      if (branch.level === 0) {
        const decay = Math.exp(-heightAboveBase / preset.flare.decay)
        flare += preset.flare.amount * decay
      }
      let collar = 1
      if (!branch.continuation && branch.collarRadius > 0) {
        const graftRun = Math.max(1e-4, branch.collarRadius * preset.collar.reach)
        const graftT = Math.min(1, run / graftRun)
        if (run <= graftRun + 1e-4) junctionRingCount++
        const shoulderAt = 0.42
        if (graftT < shoulderAt) {
          const rise = smoothstep01(graftT / shoulderAt)
          collar =
            preset.collar.hiddenScale +
            (preset.collar.shoulderScale - preset.collar.hiddenScale) * rise
        } else {
          const settle = smoothstep01((graftT - shoulderAt) / (1 - shoulderAt))
          collar = preset.collar.shoulderScale + (1 - preset.collar.shoulderScale) * settle
        }
      }

      for (let radial = 0; radial <= segmentCount; radial++) {
        // The last vertex duplicates the first with the seam UV, so the bark
        // wraps without a stretched face at the join.
        const theta = (Math.PI * 2 * (radial % segmentCount)) / segmentCount
        const ridge = barkRidge(theta, run, branchSeed)
        let radius = sectionRadius * flare * collar
        let dRadius = 0
        if (branch.level === 0) {
          // Buttress lobes: three swellings that die out by ~1 m.
          const lobeDecay = Math.exp(-heightAboveBase / preset.flare.lobeDecay)
          const lobe = 0.5 + 0.5 * Math.cos(preset.flare.lobes * theta + 0.7)
          const lobeD =
            -0.5 * preset.flare.lobes * Math.sin(preset.flare.lobes * theta + 0.7)
          radius += sectionRadius * preset.flare.lobeAmount * lobe * lobeDecay
          dRadius += sectionRadius * preset.flare.lobeAmount * lobeD * lobeDecay
          flareDTheta = dRadius
        }
        // Fissures CUT IN: the crests stay on the nominal surface.
        const cut = ridgeAmplitude * (1 - (ridge.value * 0.5 + 0.5))
        radius -= cut
        dRadius += ridgeAmplitude * 0.5 * ridge.dTheta

        const cos = Math.cos(theta)
        const sin = Math.sin(theta)
        const vertex = new Vector3(cos * radius, 0, sin * radius)
          .applyEuler(orientation)
          .add(origin)
        // Analytic normal: radial tilted by the surface's θ-slope. A pure
        // radial normal would leave the fissures unlit and invisible.
        const slope = radius > 1e-5 ? -dRadius / radius : 0
        const normal = new Vector3(cos - sin * slope, 0, sin + cos * slope)
          .applyEuler(orientation)
          .normalize()

        positions.push(vertex.x, vertex.y, vertex.z)
        normals.push(normal.x, normal.y, normal.z)
        // Metric UVs: u is circumference in metres, v is run in metres, so
        // bark grain has one physical scale across the whole tree.
        uvs.push((radial / segmentCount) * Math.PI * 2 * Math.max(radius, 0.01), run)
        ridges.push(ridge.value * 0.5 + 0.5)
        maxHeight = Math.max(maxHeight, vertex.y)
      }
      void flareDTheta

      sections.push({
        origin: origin.clone(),
        orientation: orientation.clone(),
        radius: sectionRadius,
        run,
      })

      if (sectionIndex === branch.sectionCount) break

      const step = branch.length * (sectionT(sectionIndex + 1) - sectionT(sectionIndex))
      origin.add(new Vector3(0, step, 0).applyEuler(orientation))
      run += step

      // Section evolution, in the contract's order: gnarliness, twist, force.
      const safeRadius = Math.max(sectionRadius, 0.001)
      const gnarliness =
        Math.max(1, 1 / Math.sqrt(safeRadius)) * preset.branch.gnarliness[branch.level]
      orientation.x += rng.range(-gnarliness, gnarliness)
      orientation.z += rng.range(-gnarliness, gnarliness)

      const sectionQuaternion = new Quaternion().setFromEuler(orientation)
      sectionQuaternion.multiply(
        new Quaternion().setFromAxisAngle(UP, preset.branch.twist[branch.level]),
      )
      const sectionUp = UP.clone().applyQuaternion(sectionQuaternion)
      const forceAxis = new Vector3().crossVectors(sectionUp, FORCE)
      const sine = forceAxis.length()
      if (sine > 1e-6) {
        forceAxis.divideScalar(sine)
        const fullAngle = Math.atan2(sine, sectionUp.dot(FORCE))
        const forceStep = preset.branch.forceStrength / safeRadius
        sectionQuaternion.premultiply(
          new Quaternion().setFromAxisAngle(
            forceAxis,
            Math.max(-fullAngle, Math.min(fullAngle, forceStep)),
          ),
        )
      }
      orientation.setFromQuaternion(sectionQuaternion)
    }

    for (let sectionIndex = 0; sectionIndex < branch.sectionCount; sectionIndex++) {
      for (let radial = 0; radial < segmentCount; radial++) {
        const a = indexOffset + sectionIndex * stride + radial
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1)
      }
    }

    // Short shoots on older wood.
    const spurCountForLevel = preset.spurs.perLevel[branch.level]
    if (spurCountForLevel > 0) {
      const shuffled = shuffledSlots(spurCountForLevel, rng)
      const spread = (1 - preset.spurs.start) / spurCountForLevel
      for (let slot = 0; slot < spurCountForLevel; slot++) {
        const along = preset.spurs.start + (slot + rng.float()) * spread
        const parent = interpolate(sections, along)
        const azimuth =
          Math.PI * 2 * ((shuffled[slot] + rng.range(-0.5, 0.5)) / spurCountForLevel)
        // Sink the spur base inside the parent — bury and swell, never rest.
        const orientationSpur = emergent(parent.orientation, azimuth, 1.15)
        const seat = parent.origin
          .clone()
          .addScaledVector(
            new Vector3(0, 1, 0).applyEuler(orientationSpur),
            -parent.radius * 0.5,
          )
        emitSpur(seat, orientationSpur, preset.spurs.length[branch.level])
      }
    }

    const finalSection = sections[sections.length - 1]
    if (branch.level < preset.branchLevels) {
      const nextLevel = branch.level + 1
      jobs.push({
        origin: finalSection.origin,
        orientation: finalSection.orientation,
        length: preset.branch.length[nextLevel],
        radius: finalSection.radius,
        level: nextLevel,
        // The continuation INHERITS the parent's counts. This is load-bearing.
        sectionCount: branch.sectionCount,
        segmentCount: branch.segmentCount,
        continuation: true,
        collarRadius: 0,
      })

      // Stratified lateral children.
      const count = preset.branch.children[branch.level]
      const start = preset.branch.start[nextLevel]
      const radialOffset = rng.float()
      const slots = shuffledSlots(count, rng)
      const spread = (1 - start) / count
      for (let slot = 0; slot < count; slot++) {
        const along = start + (slot + rng.float()) * spread
        const parent = interpolate(sections, along)
        const azimuth =
          Math.PI * 2 * (radialOffset + (slots[slot] + rng.range(-0.5, 0.5)) / count)
        const emergence = (preset.branch.angle[nextLevel] * Math.PI) / 180
        const childOrientation = emergent(parent.orientation, azimuth, emergence)
        // Seat the child's small first ring inside solid wood. Its resolved
        // graft rings emerge gradually; an exposed oversized ring is the
        // source of the triangular fins that used to mark every major fork.
        const childOrigin = parent.origin
          .clone()
          .addScaledVector(
            new Vector3(0, 1, 0).applyEuler(childOrientation),
            -parent.radius * preset.collar.sink,
          )
        jobs.push({
          origin: childOrigin,
          orientation: childOrientation,
          length: preset.branch.length[nextLevel],
          radius: preset.branch.radius[nextLevel] * parent.radius,
          level: nextLevel,
          sectionCount: preset.branch.sections[nextLevel],
          segmentCount: preset.branch.segments[nextLevel],
          continuation: false,
          collarRadius: parent.radius,
        })
        junctionCount++
      }
    } else {
      // Terminal long shoot: one leaf at the tip, then alternate sites along
      // it — leaves live along the branch, never in a synthetic tip cluster.
      addLeafSite(finalSection.origin, finalSection.orientation, rng.float() * Math.PI * 2)
      const count = preset.leaves.count
      const radialOffset = rng.float()
      const slots = shuffledSlots(count, rng)
      const spread = (1 - preset.leaves.start) / count
      for (let slot = 0; slot < count; slot++) {
        const along = preset.leaves.start + (slot + rng.float()) * spread
        const parent = interpolate(sections, along)
        const azimuth =
          Math.PI * 2 * (radialOffset + (slots[slot] + rng.range(-0.5, 0.5)) / count)
        addLeafSite(parent.origin, parent.orientation, azimuth)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aRidge', new Float32BufferAttribute(ridges, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  return {
    geometry,
    sites,
    triangles: indices.length / 3,
    spurs: spurCount,
    junctions: junctionCount,
    junctionRings: junctionRingCount,
    height: maxHeight,
  }
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function shuffledSlots(count: number, rng: Rng): number[] {
  const values = Array.from({ length: count }, (_, index) => index)
  for (let index = count - 1; index > 0; index--) {
    const swap = Math.floor(rng.float() * (index + 1))
    const held = values[index]
    values[index] = values[swap]
    values[swap] = held
  }
  return values
}

export function buildFirstTree(base: Vector3, rng: Rng): FirstTreeResult {
  const group = new Group()
  group.name = 'first-tree'
  // Author at the origin and place the group: the tree is a single object and
  // its materials read local UVs, so nothing swims and nothing is baked into
  // world space that a later layout change would break.
  group.position.copy(base)

  const grown = growGinkgo(rng)
  // Ginkgo bark: pale grey-brown corky ridges over near-black fissures.
  const trunk = new Mesh(
    grown.geometry,
    createBarkMaterial({
      crest: new Color(0.302, 0.276, 0.24),
      fissure: new Color(0.074, 0.064, 0.054),
      grain: 2.6,
      far: 30,
    }),
  )
  trunk.castShadow = true
  trunk.receiveShadow = true
  trunk.name = 'first-tree-wood'
  group.add(trunk)

  // ── Canopy depth: how buried each leaf is in the crown. Drives the
  // material's self-occlusion and kills the backlight on interior leaves —
  // without it the whole canopy glows uniformly and reads as a lantern.
  const centre = new Vector3()
  for (const site of grown.sites) centre.add(site.position)
  if (grown.sites.length > 0) centre.divideScalar(grown.sites.length)
  const distances = grown.sites.map((site) => site.position.distanceTo(centre))
  const sorted = [...distances].sort((a, b) => a - b)
  const hull = sorted.length > 0 ? Math.max(0.5, sorted[Math.floor(sorted.length * 0.94)]) : 1

  const canopy = new CardSink()
  const cardQuaternion = new Quaternion()
  const spin = new Quaternion()
  grown.sites.forEach((site, index) => {
    const depth = Math.pow(Math.max(0, 1 - distances[index] / hull), 0.85)
    // One growth site is one leaf. Short shoots already cluster five sites,
    // so crossing two cards that each paint a whole spray multiplies the
    // canopy into a dark knot. A small local roll breaks repeated alignment.
    spin.setFromAxisAngle(UP, (site.seed - 0.5) * 0.72)
    cardQuaternion.copy(site.quaternion).multiply(spin)
    canopy.push(site.position, cardQuaternion, {
      width: site.size * 0.94,
      height: site.size * 1.16,
      cup: 0.1,
      droop: -0.018,
      depth,
      columns: 3,
      rows: 4,
      round: 0.46,
      seed: site.seed,
    })
  })

  const leafGeometry = canopy.build()
  const leafMaterial = createFoliageMaterial({
    map: ginkgoLeafTexture(),
    seed: floatAttribute('aSeed'),
    depth: floatAttribute('aDepth'),
    // Ginkgo's ramp: cool jade in the shaded interior, golden-green where the
    // frozen afternoon reaches. The gold is the reason this tree is the only
    // warm green in the park — but it is an ACCENT at the exposed tips, not
    // the canopy's identity. Pushed too far the crown renders cream and the
    // tree stops reading as living.
    tintCool: new Color(0.66, 0.8, 0.64),
    tintWarm: new Color(1.2, 1.11, 0.72),
    transmit: new Color(0.36, 0.46, 0.13),
    backlight: 0.7,
    sway: 0.045,
    swaySpeed: 0.85,
    alphaTest: 0.36,
    far: 60,
    roughness: 0.72,
  })
  const leaves = new Mesh(leafGeometry, leafMaterial)
  leaves.castShadow = true
  leaves.receiveShadow = true
  leaves.name = 'first-tree-canopy'
  leaves.frustumCulled = false
  group.add(leaves)

  const crownCenter = centre.clone().add(base)

  return {
    group,
    collider: {
      // Generous enough that the player cannot clip into the root flare.
      center: base.clone().add(new Vector3(0, 2.6, 0)),
      halfHeight: 2.6,
      radius: 0.44,
    },
    soilTop: base.y,
    crown: { center: crownCenter, radius: hull },
    stats: {
      branchTriangles: grown.triangles,
      leafTriangles: leafGeometry.getIndex()?.count ? leafGeometry.getIndex()!.count / 3 : 0,
      leafCards: canopy.cardCount,
      leafSites: grown.sites.length,
      junctions: grown.junctions,
      junctionRings: grown.junctionRings,
      maxJunctionScale: GINKGO.collar.shoulderScale,
      spurs: grown.spurs,
    },
  }
}
