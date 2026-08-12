/**
 * The Optimus build's binding of the generic Blender kit: seven named
 * collections (one per part file) and the geometry generators bound to them.
 *
 * Part modules import `loft`, `pillow`, … from HERE, never from
 * `procgen/blenderkit/loftkit` directly — that indirection is what lets the
 * generic kit stay model-agnostic while every ported call site reads exactly
 * as it does in the Blender/bpy source.
 */
import { createCollectionApi } from '../../procgen/blenderkit/collections'
import { createLoftKit } from '../../procgen/blenderkit/loftkit'

export const COLL_NAMES = ['TORSO', 'HEAD', 'ARM', 'HAND', 'HIP', 'LEG', 'FOOT'] as const
export type CollName = (typeof COLL_NAMES)[number]

const api = createCollectionApi<CollName>(COLL_NAMES)

export const { COLL, collClear, collRemove, meshObj } = api
export const { loft, loftSpine, pillow, extrudeOutline, tube, joinMeshes } = createLoftKit(api)
