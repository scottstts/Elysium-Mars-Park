import { assembleStarship } from './starshipAssemble'
import { buildGeometry } from '../procgen/sslib/evalmesh'
import type { GeometryGroup } from '../procgen/sslib/evalmesh'
import type { Vec3 } from '../procgen/sslib/mathkit'

/**
 * Runs the whole ported build and flattens it to transferable buffers.
 *
 * Deliberately free of three.js so it can run on a worker: the port spends
 * ~420 ms here (the two 192-segment hull lathes and the 136-column TPS shell
 * are most of it), which on the main thread is a visible hitch at boot.
 *
 * NO LOD, unlike the Optimus asset. That figure is 890 k triangles standing
 * 2 m from the player's face; this is 353 k standing 215 m outside the glass,
 * where it never subtends more than ~35°, and it can never be approached. A
 * coarser tier would save draw work the frame does not miss and would cost a
 * second copy of a 34 MB vertex buffer.
 */
export interface StarshipPart {
  name: string
  position: Float32Array
  normal: Float32Array
  uv: Float32Array
  groups: GeometryGroup[]
  /** Material slot NAMES, indexed by `GeometryGroup.materialIndex`. */
  slots: readonly string[]
  /** Placement in the demo's own Blender frame — the port keeps it there. */
  pos: Vec3
  rotZ: number
  triangles: number
}

export interface StarshipPayload {
  parts: StarshipPart[]
  /** Assembly scalars, carried across so the main thread can assert them. */
  vehicleX: number
  armZ: number
  buildMs: number
}

export function buildStarshipPayload(): StarshipPayload {
  const started = performance.now()
  const assembly = assembleStarship()
  const parts: StarshipPart[] = []

  for (const object of assembly.objs) {
    const geometry = buildGeometry(object.mb, object.smooth)
    parts.push({
      name: object.name,
      position: geometry.position,
      normal: geometry.normal,
      uv: geometry.uv,
      groups: geometry.groups,
      slots: object.slots,
      pos: object.pos ?? [0, 0, 0],
      rotZ: object.rotZ ?? 0,
      triangles: geometry.tris,
    })
  }

  return {
    parts,
    vehicleX: assembly.VEH_X,
    armZ: assembly.ARM_Z,
    buildMs: performance.now() - started,
  }
}
