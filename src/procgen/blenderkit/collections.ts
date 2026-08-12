/**
 * Named mesh collections — the port of `optlib`'s Blender collections, made
 * generic so any Blender-derived build declares its OWN set of names instead
 * of inheriting one model's.
 *
 * A Blender build's part files each own a collection ('TORSO', 'HEAD', …) and
 * every generator drops its result into one. Keeping that association is what
 * lets a build clear and re-run a single part, and what the final assembly
 * walks to emit geometry. `createCollectionApi` binds the four collection
 * operations to one set of names; `createLoftKit` (loftkit.ts) binds the
 * geometry generators to the same api so call sites read exactly as they do
 * in the Blender/bpy source.
 */
import { Mesh } from './meshdata'
import type { Vec3 } from './mathkit'

export interface CollectionApi<K extends string> {
  /** The live lists, keyed by collection name. */
  COLL: Record<K, Mesh[]>
  collClear(name: K): void
  collRemove(name: K, mesh: Mesh): void
  meshObj(name: string, verts: Vec3[], faces: number[][], cname: K): Mesh
}

export function createCollectionApi<K extends string>(names: readonly K[]): CollectionApi<K> {
  const COLL = {} as Record<K, Mesh[]>
  for (const name of names) COLL[name] = []

  const collClear = (name: K): void => {
    COLL[name].length = 0
  }
  const collRemove = (name: K, mesh: Mesh): void => {
    const i = COLL[name].indexOf(mesh)
    if (i >= 0) COLL[name].splice(i, 1)
  }
  const meshObj = (name: string, verts: Vec3[], faces: number[][], cname: K): Mesh => {
    const m = new Mesh(name, verts, faces)
    m.coll = cname
    COLL[cname].push(m)
    return m
  }

  return { COLL, collClear, collRemove, meshObj }
}
