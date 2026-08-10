import {
  BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import type { BufferGeometry } from 'three'
import type { Rng } from '../core/prng'
import { createClastMaterial } from './groundMaterials'
import { groundGrade } from './interiorHeight'
import { GARDENS, PADS, PATHS } from './parkPlan'
import { pavedSignedDistance } from './pavingPlan'

/**
 * Loose surface clasts on the open regolith — the cheapest, highest-payoff
 * cure for "uniform flat desert". Real Martian plains are a lag deposit:
 * ejecta and float rock concentrated in patches, swept clean along the wind
 * and wherever feet compact the fines.
 *
 * Placement is a stratified lattice (threejs-procedural-fields: stratify the
 * domain, then jitter) filtered by a coarse rock-field mask, so stones arrive
 * in believable drifts instead of an even sprinkle.
 */

const FLOOR_RADIUS = 118

function hash2(ix: number, iz: number, salt: number): number {
  let h = (ix * 374761393 + iz * 668265263 + salt * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Coarse rock-field mask: where the lag deposit actually concentrates. */
function rockField(x: number, z: number): number {
  const wavelength = 46
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = smooth(fx - ix)
  const tz = smooth(fz - iz)
  const a = hash2(ix, iz, 7)
  const b = hash2(ix + 1, iz, 7)
  const c = hash2(ix, iz + 1, 7)
  const d = hash2(ix + 1, iz + 1, 7)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * tz
}

/** Distance to the nearest circulation route (paved or compacted service). */
function routeDistance(x: number, z: number): number {
  let best = Infinity
  for (const path of PATHS) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i]
      const b = path.points[i + 1]
      const abx = b.x - a.x
      const abz = b.y - a.y
      const lengthSq = abx * abx + abz * abz
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / lengthSq))
      const dx = x - (a.x + abx * t)
      const dz = z - (a.y + abz * t)
      best = Math.min(best, Math.hypot(dx, dz) - path.width / 2)
    }
  }
  return best
}

function onPad(x: number, z: number): boolean {
  for (const pad of PADS) {
    if (Math.hypot(x - pad.x, z - pad.z) < pad.radius + 1) return true
  }
  return false
}

function inGarden(x: number, z: number): boolean {
  for (const zone of GARDENS) {
    if (Math.hypot(x - zone.x, z - zone.z) < zone.radius * 0.86) return true
  }
  return false
}

/** An irregular clast: an icosahedron pushed around by a per-vertex hash. */
function clastGeometry(detail: number, seed: number, rng: Rng): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, detail)
  const position = geometry.getAttribute('position') as BufferAttribute
  const lumps = Array.from({ length: 5 }, () =>
    new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(),
  )
  const vertex = new Vector3()
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).normalize()
    let radius = 1
    for (let l = 0; l < lumps.length; l++) {
      radius += Math.max(0, vertex.dot(lumps[l])) ** 2 * (0.1 + 0.16 * hash2(l, seed, 3))
    }
    // Flatten slightly: float rock sits, it does not perch.
    radius *= 1 - 0.2 * Math.abs(vertex.y)
    vertex.multiplyScalar(radius)
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

export interface ScatterBuild {
  meshes: InstancedMesh[]
  count: number
}

export function buildGroundScatter(rng: Rng): ScatterBuild {
  const material = createClastMaterial()
  const placements: Array<{ matrix: Matrix4; tier: number }> = []
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const position = new Vector3()
  const up = new Vector3(0, 1, 0)

  const cell = 2.4
  const span = Math.ceil(FLOOR_RADIUS / cell)
  for (let iz = -span; iz <= span; iz++) {
    for (let ix = -span; ix <= span; ix++) {
      const jitterX = hash2(ix, iz, 11)
      const jitterZ = hash2(ix, iz, 13)
      const roll = hash2(ix, iz, 17)
      const x = (ix + jitterX) * cell
      const z = (iz + jitterZ) * cell
      const r = Math.hypot(x, z)
      if (r > FLOOR_RADIUS || r < 9) continue
      if (pavedSignedDistance(x, z) < 1.3) continue
      if (onPad(x, z)) continue
      if (inGarden(x, z)) continue
      const route = routeDistance(x, z)
      if (route < 1.4) continue

      const field = rockField(x, z)
      const density = Math.max(0, field - 0.2) * 1.9 * Math.min(1, route / 6)
      if (roll > density) continue

      const sizeRoll = hash2(ix, iz, 23)
      const tier = sizeRoll > 0.993 ? 2 : sizeRoll > 0.8 ? 1 : 0
      const base = tier === 2 ? rng.range(0.45, 0.95) : tier === 1 ? rng.range(0.16, 0.34) : rng.range(0.06, 0.16)
      scale.set(base * rng.range(0.85, 1.35), base * rng.range(0.5, 0.85), base * rng.range(0.85, 1.35))
      quaternion.setFromAxisAngle(up, rng.range(0, Math.PI * 2))
      quaternion.multiply(
        new Quaternion().setFromAxisAngle(
          new Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize(),
          rng.range(-0.22, 0.22),
        ),
      )
      // Bedded, not perched: a third of the stone is below the surface.
      position.set(x, groundGrade(x, z) - scale.y * 0.34, z)
      matrix.compose(position, quaternion, scale)
      placements.push({ matrix: matrix.clone(), tier })
    }
  }

  const meshes: InstancedMesh[] = []
  for (const [tier, detail] of [
    [0, 0],
    [1, 1],
    [2, 2],
  ] as const) {
    const tierPlacements = placements.filter((placement) => placement.tier === tier)
    if (tierPlacements.length === 0) continue
    const geometry = clastGeometry(detail, tier + 1, rng)
    const mesh = new InstancedMesh(geometry, material, tierPlacements.length)
    tierPlacements.forEach((placement, index) => mesh.setMatrixAt(index, placement.matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = tier > 0
    mesh.receiveShadow = true
    mesh.name = `ground:clasts-${tier}`
    meshes.push(mesh)
  }
  return { meshes, count: placements.length }
}
