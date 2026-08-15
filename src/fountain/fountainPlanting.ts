import { Vector3 } from 'three'
import type { Rng } from '../core/prng'
import { sampleWeightedGrassPoints, type PlantingPalette } from '../vegetation/planting'
import { interiorHeight } from '../world/interiorHeight'
import { FOUNTAIN } from '../world/parkPlan'
import { planterBays } from './fountainPlan'

/**
 * THE FOUNTAIN'S FOUR PLANTERS.
 *
 * These are the ONLY beds in the park that are neither a plaza planter nor a
 * rationed regolith bed, and they are deliberately the lushest thing outside
 * the glasshouses: a public fountain is where a colony spends its water in
 * public, so the planting around it should look like it is being spent. Dense
 * ferns and broadleaf at the back, flower at the shoulders, trailing growth
 * spilling over the pocket's proud lip.
 *
 * It lives in its own module rather than inside the fountain system because
 * the park's planting is ONE instancing sink (`PlantingPalette`) owned by the
 * vegetation system — a second palette would double every foliage draw call
 * and every foliage material in the park for four beds.
 */
export function plantFountainBays(palette: PlantingPalette, rng: Rng): number {
  const baseY = interiorHeight(FOUNTAIN.x, FOUNTAIN.z)
  let planted = 0

  for (const bay of planterBays()) {
    const soilY = baseY + bay.soilY
    const point = (u: number, v: number): Vector3 => {
      const radius = bay.rInner + (bay.rOuter - bay.rInner) * u
      const angle = bay.theta + (v * 2 - 1) * bay.halfArc
      // Follow the soil's dome so nothing is planted in a hole or floating
      // over the mound's shoulder.
      const dome = Math.sin(Math.PI * u) * Math.sin(Math.PI * (v * 0.5 + 0.5)) * 0.04
      return new Vector3(
        FOUNTAIN.x + Math.cos(angle) * radius,
        soilY + dome,
        FOUNTAIN.z + Math.sin(angle) * radius,
      )
    }

    // Structure first: three or four ferns along the pocket's spine, which is
    // what gives the bed a silhouette from twenty metres.
    const spine = rng.int(3, 4)
    for (let i = 0; i < spine; i++) {
      const v = (i + 0.5) / spine + rng.range(-0.06, 0.06)
      palette.fern.add(
        point(rng.range(0.42, 0.66), v).add(new Vector3(0, -0.03, 0)),
        rng.range(0, Math.PI * 2),
        rng.range(0.85, 1.25),
        rng.range(-0.1, 0.1),
        rng.range(-0.1, 0.1),
      )
      planted++
    }

    // Broadleaf mass at the outer edge, where the coping is thickest.
    const broad = rng.int(4, 6)
    for (let i = 0; i < broad; i++) {
      palette.broadleaf.add(
        point(rng.range(0.62, 0.9), rng.range(0.08, 0.92)).add(new Vector3(0, -0.04, 0)),
        rng.range(0, Math.PI * 2),
        rng.range(0.7, 1.05),
        rng.range(-0.12, 0.12),
        rng.range(-0.12, 0.12),
      )
      planted++
    }

    // Flower at the shoulders — the only strong non-green in the park's
    // exterior, and it belongs beside the only running water.
    const flowers = rng.int(6, 9)
    for (let i = 0; i < flowers; i++) {
      palette.flower.add(
        point(rng.range(0.25, 0.72), rng.range(0.05, 0.95)),
        rng.range(0, Math.PI * 2),
        rng.range(0.75, 1.15),
        rng.range(-0.14, 0.14),
        rng.range(-0.14, 0.14),
      )
      planted++
    }

    // Mature sedge fills between; real juvenile clumps close the soil without
    // the flattened alpha-card mats used by the old cover recipe.
    const grassArea = (uMin: number, uMax: number): number => {
      const width = bay.rOuter - bay.rInner
      const rMin = bay.rInner + width * uMin
      const rMax = bay.rInner + width * uMax
      return bay.halfArc * (rMax * rMax - rMin * rMin)
    }
    const grassPoint = (uMin: number, uMax: number): Vector3 => {
      const width = bay.rOuter - bay.rInner
      const rMin = bay.rInner + width * uMin
      const rMax = bay.rInner + width * uMax
      const radius = Math.sqrt(rng.range(rMin * rMin, rMax * rMax))
      return point((radius - bay.rInner) / width, rng.range(0.04, 0.96))
    }
    const sedge = rng.int(10, 14)
    const youngSedge = rng.int(12, 18)
    const matureGrassRoots = sampleWeightedGrassPoints({
      rng,
      count: sedge,
      area: grassArea(0.15, 0.9),
      candidate: () => grassPoint(0.15, 0.9),
      spacingFactor: 0.58,
    })
    for (const root of matureGrassRoots) {
      palette.sedge.add(
        root.clone().add(new Vector3(0, -0.03, 0)),
        rng.range(0, Math.PI * 2),
        rng.range(0.7, 1.2),
        rng.range(-0.12, 0.12),
        rng.range(-0.12, 0.12),
      )
      planted++
    }
    const youngGrassRoots = sampleWeightedGrassPoints({
      rng,
      count: youngSedge,
      area: grassArea(0.08, 0.95),
      candidate: () => grassPoint(0.08, 0.95),
      attractors: matureGrassRoots,
      spacingFactor: 0.5,
    })
    for (const root of youngGrassRoots) {
      palette.addYoungSedge(root, rng, 0.86, 1.25)
      planted++
    }

    // Trailing growth over the INNER lip only: it hangs toward the water,
    // which is where a gardener would want it and where the eye reads it
    // against the basin rather than against the sky.
    const trailing = rng.int(5, 8)
    for (let i = 0; i < trailing; i++) {
      const v = rng.range(0.06, 0.94)
      const p = point(0.0, v)
      palette.trailing.add(
        new Vector3(p.x, soilY - 0.02, p.z),
        bay.theta + (v * 2 - 1) * bay.halfArc + Math.PI,
        rng.range(0.8, 1.25),
        0,
        rng.range(-0.1, 0.1),
      )
      planted++
    }
  }
  return planted
}
