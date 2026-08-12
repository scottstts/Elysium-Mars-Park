/**
 * Mesh container -> transferable geometry buffers.
 *
 * Deliberately free of three.js: a ported build runs on a worker thread (the
 * bevel/boolean pass is ~2 s of pure CPU), and what crosses the thread
 * boundary has to be plain typed arrays. The main thread turns these into a
 * BufferGeometry. Splitting here also means the same payload can be cached,
 * merged or instanced without ever materialising 176 separate geometries.
 */
import { computeCornerNormals } from './meshdata'
import type { Mesh } from './meshdata'
import { applyMods } from './bevel'
import type { Vec3 } from './mathkit'

/** One material-slot draw range inside `index`. */
export interface GeometryGroup {
  start: number
  count: number
  materialIndex: number
}

export interface GeometryPayload {
  position: Float32Array
  normal: Float32Array
  index: Uint32Array
  groups: GeometryGroup[]
  /** Material NAMES, indexed by `GeometryGroup.materialIndex`. */
  mats: string[]
}

export function toGeometryData(mesh: Mesh, fallbackMaterial = 'M_SHELL'): GeometryPayload {
  applyMods(mesh);
  const { corners } = computeCornerNormals(mesh);
  const F = mesh.f, V = mesh.v;

  const pos: number[] = [], nor: number[] = [];
  const perVert = new Map<number, Array<[Vec3, number]>>();  /* vertex -> [normal, outIndex][] */
  const groups = new Map<number, number[]>();                /* material slot -> index array   */

  const emit = (vi: number, n: Vec3): number => {
    let list = perVert.get(vi);
    if (!list) { list = []; perVert.set(vi, list); }
    for (let i = 0; i < list.length; i++) {
      const m = list[i][0];
      if (Math.abs(m[0] - n[0]) < 1e-6 && Math.abs(m[1] - n[1]) < 1e-6 && Math.abs(m[2] - n[2]) < 1e-6)
        return list[i][1];
    }
    const idx = pos.length / 3;
    pos.push(V[vi][0], V[vi][1], V[vi][2]);
    nor.push(n[0], n[1], n[2]);
    list.push([n, idx]);
    return idx;
  };

  for (let fi = 0; fi < F.length; fi++) {
    const t = F[fi], c = corners[fi];
    const slot = mesh.fm[fi] | 0;
    let g = groups.get(slot);
    if (!g) { g = []; groups.set(slot, g); }
    const i0 = emit(t[0], c[0]);
    for (let i = 1; i < t.length - 1; i++) {
      g.push(i0, emit(t[i], c[i]), emit(t[i + 1], c[i + 1]));
    }
  }

  const index: number[] = [];
  const order = [...groups.keys()].sort((a, b) => a - b);
  const mats: string[] = [];
  const outGroups: GeometryGroup[] = [];
  for (const slot of order) {
    const g = groups.get(slot)!;
    outGroups.push({ start: index.length, count: g.length, materialIndex: mats.length });
    for (const i of g) index.push(i);
    mats.push(mesh.mats[slot] || mesh.mats[0] || fallbackMaterial);
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    index: new Uint32Array(index),
    groups: outGroups,
    mats,
  };
}
