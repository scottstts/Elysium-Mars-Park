/**
 * Runs the seven part builders, merges their 176 meshes into ONE geometry per
 * LOD, and hands back transferable buffers. Deliberately three.js-free: this
 * is the module the worker runs, and nothing here may drag WebGPU into a
 * worker chunk.
 *
 * MERGE. The reference emits one mesh per part object, which would be 176
 * draw calls per figure. Everything is welded into a single vertex array with
 * one draw range per MATERIAL, so a figure costs fourteen draws no matter how
 * many objects the Blender build happened to use.
 *
 * AXES. Blender's Z-up frame is baked out here, once, into the merged
 * positions and normals: `(x, y, z) -> (x, z, -y)`. The figure's origin is
 * already the floor between its ankles, so a placed instance sits exactly on
 * the deck, and its rest facing (Blender −Y) becomes world +Z.
 */
import { applyMods } from '../../procgen/blenderkit/bevel'
import { clusterDecimate } from '../../procgen/blenderkit/decimate'
import { toGeometryData } from '../../procgen/blenderkit/toGeometry'
import type { GeometryGroup, GeometryPayload } from '../../procgen/blenderkit/toGeometry'
import { COLL, COLL_NAMES } from './optimusKit'
import { buildTorso } from './parts/torso'
import { buildHead } from './parts/head'
import { buildArms } from './parts/arm'
import { buildHands } from './parts/hand'
import { buildHips } from './parts/hip'
import { buildLegs } from './parts/leg'
import { buildFeet } from './parts/foot'

/**
 * Cluster sizes for the far LODs, in metres on a 1.73 m figure. 6 mm still
 * resolves a finger joint and holds up to ~25 m; 22 mm keeps the silhouette
 * and the material breaks and is for everything past ~60 m.
 */
const LOD_CELLS = [0.006, 0.022]

export interface OptimusPayload {
  /** `[0]` is the exact reference mesh; later entries are progressively coarser. */
  lods: GeometryPayload[]
  /** Triangle count per LOD, for the build log. */
  triangles: number[]
  buildMs: number
}

export function buildOptimusPayload(): OptimusPayload {
  const started = Date.now()

  buildTorso()
  buildHead()
  buildArms()
  buildHands()
  buildHips()
  buildLegs()
  buildFeet()

  const exact = mergeFigure()
  const lods = [exact, ...LOD_CELLS.map((cell) => clusterDecimate(exact, cell))]
  return {
    lods,
    triangles: lods.map((lod) => lod.index.length / 3),
    buildMs: Date.now() - started,
  }
}

/** Every collection's meshes, welded into one Y-up geometry keyed by material. */
function mergeFigure(): GeometryPayload {
  const slots = new Map<string, { position: number[]; normal: number[]; index: number[] }>()

  for (const cname of COLL_NAMES) {
    for (const mesh of COLL[cname]) {
      applyMods(mesh)
      const part = toGeometryData(mesh)
      for (const group of part.groups) {
        const name = part.mats[group.materialIndex]
        let slot = slots.get(name)
        if (!slot) {
          slot = { position: [], normal: [], index: [] }
          slots.set(name, slot)
        }
        // Only the vertices this group actually references are copied, so a
        // part whose faces split across two materials does not duplicate its
        // whole vertex array into both slots.
        const remap = new Map<number, number>()
        for (let i = group.start; i < group.start + group.count; i++) {
          const src = part.index[i]
          let dst = remap.get(src)
          if (dst === undefined) {
            dst = slot.position.length / 3
            remap.set(src, dst)
            // Blender Z-up -> three Y-up, baked into the data.
            slot.position.push(part.position[src * 3], part.position[src * 3 + 2], -part.position[src * 3 + 1])
            slot.normal.push(part.normal[src * 3], part.normal[src * 3 + 2], -part.normal[src * 3 + 1])
          }
          slot.index.push(dst)
        }
      }
      // The part meshes are large and never needed again once merged.
      mesh.v.length = 0
      mesh.f.length = 0
    }
  }

  const names = [...slots.keys()].sort()
  let vertexCount = 0
  let indexCount = 0
  for (const name of names) {
    const slot = slots.get(name)!
    vertexCount += slot.position.length / 3
    indexCount += slot.index.length
  }

  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const index = new Uint32Array(indexCount)
  const groups: GeometryGroup[] = []
  let vertexBase = 0
  let indexBase = 0
  for (let m = 0; m < names.length; m++) {
    const slot = slots.get(names[m])!
    position.set(slot.position, vertexBase * 3)
    normal.set(slot.normal, vertexBase * 3)
    for (let i = 0; i < slot.index.length; i++) index[indexBase + i] = slot.index[i] + vertexBase
    groups.push({ start: indexBase, count: slot.index.length, materialIndex: m })
    vertexBase += slot.position.length / 3
    indexBase += slot.index.length
  }

  return { position, normal, index, groups, mats: names }
}
