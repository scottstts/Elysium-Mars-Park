import { Vector3 } from 'three'
import type { Group } from 'three'
import { writeInto } from '../archkit/meshdata'
import { PartWriter } from '../archkit/writer'
import type { Rng } from '../core/prng'
import { interiorHeight } from '../world/interiorHeight'
import { GARDENS, PATHS } from '../world/parkPlan'
import { pavedSignedDistance } from '../world/pavingPlan'
import type { PlantingPalette } from './planting'
import type { VegetationCollider } from './planting'
import { placeRock, rockMesh } from './rocks'

/**
 * THE ROCK GROUPS — what the old Regolith Gardens are, now that the fountain
 * has taken the middle of the main zone.
 *
 * ## What was removed, and why (2026-08-12)
 *
 * This module used to emit two more systems: concentric RAKE FURROWS as swept
 * tube ridges, and steel-edged planting BEDS with info stakes. Both are gone.
 * The rake read as a set of thin dark circles scribed on flat dirt — at any
 * real viewing angle the ridges are under a pixel, so the karesansui idea
 * never arrived and what shipped was a contour map; the beds were four sedge
 * clumps in a steel picture frame, which read as a construction leftover
 * rather than as rationed planting. Neither survived the owner's look at the
 * finished park, and neither is worth re-attempting at this scale: raked
 * ground needs a normal-mapped GROUND MATERIAL, not geometry, and rationed
 * planting needs a reason to be where it is.
 *
 * ## What is left, and why it stays
 *
 * The rock groups. They are the one part of the original idea that worked:
 * odd-numbered clusters of lofted boulders with dipping sedimentary beds,
 * composed as a hero plus companions. On open regolith they are the only
 * thing giving the ground a scale, and around a monumental fountain they do
 * the job a park's trees would do on Earth — they hold the middle distance.
 *
 * They are kept OFF the paving by `pavedSignedDistance`, which now includes
 * the fountain court, so no boulder can land inside the civic space or on its
 * doorstep. That is not a special case: it is the same rule that keeps them
 * off every other pour in the park.
 */

interface RockGroup {
  x: number
  z: number
  /** Keep-out radius, metres. */
  radius: number
}

export interface GardenStats {
  zones: number
  boulders: number
}

function clearOfPaths(x: number, z: number, margin: number): boolean {
  for (const path of PATHS) {
    for (let i = 0; i < path.points.length - 1; i++) {
      const a = path.points[i]
      const b = path.points[i + 1]
      const abx = b.x - a.x
      const abz = b.y - a.y
      const l2 = abx * abx + abz * abz
      if (l2 === 0) continue
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / l2))
      const dx = x - (a.x + abx * t)
      const dz = z - (a.y + abz * t)
      if (dx * dx + dz * dz < (path.width / 2 + margin) ** 2) return false
    }
  }
  return true
}

export function buildRegolithGardens(
  _palette: PlantingPalette,
  writer: PartWriter,
  _group: Group,
  colliders: VegetationCollider[],
  rng: Rng,
): GardenStats {
  let boulders = 0

  for (const zone of GARDENS) {
    const rocks: RockGroup[] = []
    const groupCount = zone.radius > 20 ? 3 : 2

    for (let g = 0; g < groupCount; g++) {
      let cx = 0
      let cz = 0
      let placed = false
      for (let attempt = 0; attempt < 60 && !placed; attempt++) {
        const angle = rng.range(0, Math.PI * 2)
        // Biased to the OUTER half of the zone. In the main zone the middle is
        // now the fountain court; in the south zone it keeps the groups off
        // the sight line from the Meridian Walk.
        const distance = Math.sqrt(rng.range(0.34, 0.94)) * zone.radius
        cx = zone.x + Math.cos(angle) * distance
        cz = zone.z + Math.sin(angle) * distance
        if (!clearOfPaths(cx, cz, 4.2)) continue
        if (pavedSignedDistance(cx, cz) < 3.5) continue
        if (rocks.some((r) => Math.hypot(r.x - cx, r.z - cz) < 11)) continue
        placed = true
      }
      if (!placed) continue

      const members = rng.pick([2, 3, 3])
      for (let m = 0; m < members; m++) {
        // The hero first, companions leaning around it.
        const hero = m === 0
        const spread = hero ? 0 : rng.range(1.1, 2.6)
        const bearing = rng.range(0, Math.PI * 2)
        const x = cx + Math.cos(bearing) * spread
        const z = cz + Math.sin(bearing) * spread
        const radius = hero ? rng.range(0.85, 1.35) : rng.range(0.38, 0.72)
        const height = radius * rng.range(1.35, 2.1)
        const y = interiorHeight(x, z)
        const mesh = rockMesh({
          radius,
          height,
          seed: rng.float() * 10,
          elongation: rng.range(1.05, 1.7),
          bury: 0.26,
          levels: hero ? 22 : 14,
          segments: hero ? 40 : 26,
          bands: rng.int(4, 6),
          bedAmount: rng.range(0.11, 0.16),
          dip: rng.range(0.25, 0.6),
          lumpiness: rng.range(0.24, 0.34),
        })
        placeRock(mesh, x, y, z, rng.range(0, Math.PI * 2))
        writeInto(writer, 'stone', mesh)
        boulders++
        rocks.push({ x, z, radius: radius * 1.5 + 0.6 })
        if (hero || radius > 0.55) {
          colliders.push({
            kind: 'cylinder',
            center: new Vector3(x, y + height * 0.3, z),
            radius: radius * 0.88,
            halfHeight: height * 0.42,
          })
        }
      }
    }
  }

  return { zones: GARDENS.length, boulders }
}
