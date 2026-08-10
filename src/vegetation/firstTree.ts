import {
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { mix, positionLocal, sin, time, uv, vec3 } from 'three/tsl'
import { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import { ginkgoClusterTexture } from './leafTextures'

/**
 * The First Tree — a 12 m ginkgo, the only large tree on Mars. Trunk and
 * scaffold limbs are swept tubes with taper; foliage is ~170 leaf-cluster
 * cards hung from real branch tips. A whisper of HVAC shimmer moves the
 * canopy: barely-there, felt more than seen (design canon).
 */
export interface FirstTreeResult {
  group: Group
  /** Trunk collider spec (cylinder). */
  collider: { center: Vector3; halfHeight: number; radius: number }
}

export function buildFirstTree(base: Vector3, rng: Rng): FirstTreeResult {
  const group = new Group()
  const writer = new PartWriter()

  const bark = new MeshStandardNodeMaterial()
  bark.colorNode = mix(
    vec3(0.23, 0.195, 0.165),
    vec3(0.3, 0.26, 0.22),
    positionLocal.y.mul(0.06).add(uv().x.mul(3).sin().mul(0.5).add(0.5).mul(0.4)),
  )
  bark.roughness = 0.92

  const tips: Array<{ position: Vector3; direction: Vector3 }> = []

  // Trunk: gently leaning, tapering in three sweeps.
  const lean = new Vector3(rng.range(-0.06, 0.06), 1, rng.range(-0.02, 0.08)).normalize()
  const trunkPath: Vector3[] = []
  for (let i = 0; i <= 6; i++) {
    const t = i / 6
    trunkPath.push(
      base
        .clone()
        .addScaledVector(lean, t * 7.2)
        .add(new Vector3(Math.sin(t * 2.4) * 0.14, 0, Math.cos(t * 3.1) * 0.1)),
    )
  }
  sweptBranch(writer, trunkPath, 0.42, 0.2)

  // Scaffold limbs: ginkgo's irregular ascending tiers.
  const limbCount = 7
  for (let limb = 0; limb < limbCount; limb++) {
    const attachT = 0.42 + (limb / limbCount) * 0.5 + rng.range(-0.03, 0.03)
    const attach = trunkPath[Math.floor(attachT * 6)]
      .clone()
      .lerp(trunkPath[Math.min(6, Math.floor(attachT * 6) + 1)], (attachT * 6) % 1)
    const azimuth = rng.range(0, Math.PI * 2)
    const rise = rng.range(0.45, 0.85)
    const reach = rng.range(2.2, 3.8) * (1 - attachT * 0.35)
    const direction = new Vector3(
      Math.cos(azimuth) * (1 - rise),
      rise,
      Math.sin(azimuth) * (1 - rise),
    ).normalize()
    const limbPath: Vector3[] = [attach.clone()]
    for (let s = 1; s <= 4; s++) {
      const t = s / 4
      limbPath.push(
        attach
          .clone()
          .addScaledVector(direction, reach * t)
          .add(new Vector3(0, t * t * 0.9, 0))
          .add(new Vector3(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12))),
      )
    }
    sweptBranch(writer, limbPath, 0.15, 0.05)
    // Secondary twigs off each limb.
    for (let twig = 0; twig < 4; twig++) {
      const twigT = 0.35 + twig * 0.18
      const twigBase = limbPath[Math.floor(twigT * 4)]
        .clone()
        .lerp(limbPath[Math.min(4, Math.floor(twigT * 4) + 1)], (twigT * 4) % 1)
      const twigDirection = direction
        .clone()
        .applyAxisAngle(new Vector3(0, 1, 0), rng.range(-1.2, 1.2))
        .add(new Vector3(0, rng.range(0.15, 0.5), 0))
        .normalize()
      const twigEnd = twigBase.clone().addScaledVector(twigDirection, rng.range(0.9, 1.7))
      writer.tube({
        path: [twigBase, twigBase.clone().lerp(twigEnd, 0.55), twigEnd],
        radius: 0.035,
        slot: 'bark',
        radialSegments: 6,
      })
      tips.push({ position: twigEnd, direction: twigDirection })
      tips.push({
        position: twigBase.clone().lerp(twigEnd, 0.6),
        direction: twigDirection.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.7),
      })
    }
    tips.push({ position: limbPath[4], direction })
  }

  const trunkMesh = writer.build({ bark }, { castShadow: true })
  group.add(trunkMesh)

  // Foliage: leaf-cluster cards at every tip, 2–3 cards each.
  const leafMaterial = new MeshStandardNodeMaterial()
  leafMaterial.map = ginkgoClusterTexture()
  leafMaterial.alphaTest = 0.4
  leafMaterial.side = DoubleSide
  leafMaterial.roughness = 0.75
  leafMaterial.metalness = 0
  // HVAC shimmer: a few millimeters of sway, scaled by card height.
  leafMaterial.positionNode = positionLocal.add(
    vec3(
      sin(time.mul(0.9).add(positionLocal.y.mul(3.1))).mul(0.012),
      0,
      sin(time.mul(1.17).add(positionLocal.x.mul(2.7))).mul(0.012),
    ),
  )

  const cardGeometry = new PlaneGeometry(1.5, 1.5)
  const cardCount = tips.length * 2 + 8
  const cards = new InstancedMesh(cardGeometry, leafMaterial, cardCount)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  let card = 0
  for (const tip of tips) {
    for (let i = 0; i < 2 && card < cardCount; i++) {
      const size = rng.range(0.9, 1.6)
      const offset = new Vector3(
        rng.range(-0.35, 0.35),
        rng.range(-0.1, 0.4),
        rng.range(-0.35, 0.35),
      )
      quaternion.setFromAxisAngle(
        new Vector3(rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5)).normalize(),
        rng.range(0, Math.PI * 2),
      )
      scale.setScalar(size)
      matrix.compose(tip.position.clone().add(offset), quaternion, scale)
      cards.setMatrixAt(card++, matrix)
    }
  }
  while (card < cardCount) {
    // A few crown fillers.
    const crown = base.clone().add(new Vector3(rng.range(-2, 2), rng.range(7.5, 10.2), rng.range(-2, 2)))
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, Math.PI * 2))
    scale.setScalar(rng.range(1.1, 1.7))
    matrix.compose(crown, quaternion, scale)
    cards.setMatrixAt(card++, matrix)
  }
  cards.instanceMatrix.needsUpdate = true
  cards.castShadow = true
  group.add(cards)

  return {
    group,
    collider: {
      center: base.clone().add(new Vector3(0, 3.6, 0)),
      halfHeight: 3.6,
      radius: 0.5,
    },
  }
}

/** Tapered branch: tube segments with shrinking radius. */
function sweptBranch(writer: PartWriter, path: Vector3[], startRadius: number, endRadius: number): void {
  for (let i = 0; i < path.length - 1; i++) {
    const t = i / (path.length - 1)
    const radius = startRadius + (endRadius - startRadius) * t
    writer.tube({
      path: [path[i], path[i + 1]],
      radius,
      slot: 'bark',
      radialSegments: 10,
      capEnd: i === path.length - 2,
    })
  }
}
