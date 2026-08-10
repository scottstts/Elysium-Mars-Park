import { Mesh, PlaneGeometry, Vector3 } from 'three'
import { bench, guardrail } from '../../archkit/kit'
import { signageMaterial } from '../../materials/library'
import { interiorHeight } from '../interiorHeight'
import { habSites } from '../parkPlan'
import type { DistrictServices } from './types'

/**
 * The Residential Arc: ten rotomolded hab pods on cradles, porches facing
 * the park — because humans build porches. One personal touch each; the
 * Common Hab (larger, open doorway) anchors the middle of the arc.
 */
export function buildResidential(services: DistrictServices): void {
  const { writer, rng } = services
  const sites = habSites()

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    const centerYaw = Math.atan2(-site.x, -site.z) // porch faces the origin
    const tangentYaw = centerYaw + Math.PI / 2
    const radius = site.common ? 2.5 : 2.25
    const length = site.common ? 14 : 12
    const ground = interiorHeight(site.x, site.z)
    const axisY = ground + radius + 0.5

    const forward = new Vector3(Math.sin(centerYaw), 0, Math.cos(centerYaw))
    const along = new Vector3(Math.sin(tangentYaw), 0, Math.cos(tangentYaw))
    const center = new Vector3(site.x, axisY, site.z)

    if (site.common) {
      // The Common Hab is the bespoke community building: a panel-built
      // rectangular hall with a REAL door aperture (interiors.ts dresses it
      // and hangs the sliding door). Architecturally distinct on purpose.
      buildCommonHabShell(services, site.x, site.z, ground, centerYaw, along, forward)
    } else {
      // Body tube + end caps (three ring stiffeners follow below).
      const halfAlong = along.clone().multiplyScalar(length / 2)
      writer.tube({
        path: [center.clone().sub(halfAlong), center.clone().add(halfAlong)],
        radius,
        slot: 'habShell',
        radialSegments: 26,
        capStart: true,
        capEnd: true,
        uvScale: 0.3,
      })
    }
    if (!site.common) {
    for (const t of [-0.31, 0, 0.31]) {
      const ringCenter = center.clone().addScaledVector(along, length * t)
      const ringPath: Vector3[] = []
      for (let s = 0; s <= 18; s++) {
        const angle = (s / 18) * Math.PI * 2
        ringPath.push(
          ringCenter
            .clone()
            .addScaledVector(forward, Math.cos(angle) * (radius + 0.06))
            .add(new Vector3(0, Math.sin(angle) * (radius + 0.06), 0)),
        )
      }
      writer.tube({ path: ringPath, radius: 0.055, slot: 'steel', radialSegments: 8 })
    }

    // Cradles.
    for (const t of [-0.3, 0.3]) {
      writer.box({
        center: center
          .clone()
          .addScaledVector(along, length * t)
          .setY(ground + 0.42),
        size: new Vector3(1.2, 0.85, radius * 1.7),
        rotationY: tangentYaw,
        slot: 'dark',
        chamfer: 0.03,
      })
    }

    }
    // Door reference point on the park side (shared by the porch layout).
    const doorCenter = center
      .clone()
      .addScaledVector(forward, radius - 0.05)
      .setY(ground + 1.25)
    if (!site.common) {
    writer.box({
      center: doorCenter.clone().addScaledVector(forward, 0.06),
      size: new Vector3(1.15, 2.15, 0.14),
      rotationY: centerYaw,
      slot: 'steel',
      chamfer: 0.02,
    })
    writer.box({
      center: doorCenter.clone().addScaledVector(forward, 0.11),
      size: new Vector3(0.92, 1.92, 0.04),
      rotationY: centerYaw,
      slot: 'dark',
    })

    // Two porthole windows on the porch side.
    for (const t of [-0.26, 0.26]) {
      const portholeCenter = center
        .clone()
        .addScaledVector(along, length * t)
        .addScaledVector(forward, radius - 0.02)
        .setY(axisY + 0.35)
      const ringPath: Vector3[] = []
      for (let s = 0; s <= 14; s++) {
        const angle = (s / 14) * Math.PI * 2
        ringPath.push(
          portholeCenter
            .clone()
            .addScaledVector(along, Math.cos(angle) * 0.4)
            .add(new Vector3(0, Math.sin(angle) * 0.4, 0)),
        )
      }
      writer.tube({ path: ringPath, radius: 0.045, slot: 'aluminum', radialSegments: 8 })
      writer.box({
        center: portholeCenter.clone().addScaledVector(forward, 0.02),
        size: new Vector3(0.74, 0.74, 0.03),
        rotationY: centerYaw,
        slot: 'darkGlass',
      })
    }
    }

    // Porch: deck, posts, rails, steps, chair + a personal touch.
    const porchCenter = doorCenter
      .clone()
      .addScaledVector(forward, 1.7)
      .setY(ground + 0.32)
    writer.box({
      center: porchCenter,
      size: new Vector3(3.6, 0.12, 2.6),
      rotationY: centerYaw,
      slot: 'deck',
      chamferSlot: 'steelEdge',
      chamfer: 0.02,
    })
    for (const sx of [-1.6, 1.6]) {
      for (const sz of [-1.1, 1.1]) {
        writer.box({
          center: porchCenter
            .clone()
            .addScaledVector(along, sx)
            .addScaledVector(forward, sz)
            .setY(ground + 0.16),
          size: new Vector3(0.12, 0.32, 0.12),
          slot: 'dark',
        })
      }
    }
    const railStart = porchCenter
      .clone()
      .addScaledVector(along, -1.7)
      .addScaledVector(forward, 1.25)
      .setY(porchCenter.y + 0.06)
    const railEnd = porchCenter
      .clone()
      .addScaledVector(along, 1.7)
      .addScaledVector(forward, 1.25)
      .setY(porchCenter.y + 0.06)
    guardrail(writer, [railStart, railStart.clone().lerp(railEnd, 0.32)])
    guardrail(writer, [railStart.clone().lerp(railEnd, 0.68), railEnd])
    // Step from grade.
    writer.box({
      center: porchCenter.clone().addScaledVector(forward, 1.5).setY(ground + 0.14),
      size: new Vector3(1.1, 0.28, 0.42),
      rotationY: centerYaw,
      slot: 'cast',
      chamfer: 0.02,
    })

    // Porch chair (single-seat bench) + personal touch.
    const chairSpot = porchCenter
      .clone()
      .addScaledVector(along, 1.0)
      .addScaledVector(forward, -0.4)
      .setY(porchCenter.y + 0.06)
    const seat = bench(writer, chairSpot, centerYaw + Math.PI * 0.92)
    services.seats.push({ ...seat, label: 'Sit on the porch' })

    const touch = rng.int(0, 4)
    const touchSpot = porchCenter
      .clone()
      .addScaledVector(along, -1.15)
      .addScaledVector(forward, -0.55)
      .setY(porchCenter.y + 0.06)
    if (touch === 0) {
      // Planter box (green arrives in S12).
      writer.box({ center: touchSpot.clone().setY(touchSpot.y + 0.22), size: new Vector3(0.9, 0.44, 0.38), rotationY: tangentYaw, slot: 'dark', chamfer: 0.015 })
    } else if (touch === 1) {
      // Crate stack.
      writer.box({ center: touchSpot.clone().setY(touchSpot.y + 0.19), size: new Vector3(0.55, 0.38, 0.55), rotationY: tangentYaw + 0.2, slot: 'aluminum', chamfer: 0.014 })
      writer.box({ center: touchSpot.clone().setY(touchSpot.y + 0.52), size: new Vector3(0.45, 0.28, 0.45), rotationY: tangentYaw - 0.35, slot: 'orange', chamfer: 0.012 })
    } else if (touch === 2) {
      // Small telescope on tripod, aimed over the rim.
      const head = touchSpot.clone().setY(touchSpot.y + 1.12)
      for (let leg = 0; leg < 3; leg++) {
        const legAngle = (leg / 3) * Math.PI * 2
        writer.tube({
          path: [
            head.clone().add(new Vector3(0, -0.06, 0)),
            touchSpot.clone().add(new Vector3(Math.cos(legAngle) * 0.34, 0, Math.sin(legAngle) * 0.34)),
          ],
          radius: 0.018,
          slot: 'dark',
          radialSegments: 6,
        })
      }
      writer.tube({
        path: [
          head.clone().addScaledVector(forward, -0.22).add(new Vector3(0, -0.05, 0)),
          head.clone().addScaledVector(forward, 0.28).add(new Vector3(0, 0.12, 0)),
        ],
        radius: 0.055,
        slot: 'aluminum',
        radialSegments: 10,
        capStart: true,
        capEnd: true,
      })
    } else if (touch === 3) {
      // Drying line with two towels.
      const postA = touchSpot.clone().addScaledVector(along, -0.5)
      const postB = touchSpot.clone().addScaledVector(along, 0.7)
      for (const post of [postA, postB]) {
        writer.tube({ path: [post.clone(), post.clone().setY(post.y + 1.5)], radius: 0.02, slot: 'dark', radialSegments: 6 })
      }
      writer.tube({
        path: [postA.clone().setY(postA.y + 1.44), postB.clone().setY(postB.y + 1.44)],
        radius: 0.008,
        slot: 'aluminum',
        radialSegments: 4,
      })
      for (const t of [0.32, 0.66]) {
        const towelTop = postA.clone().lerp(postB, t).setY(postA.y + 1.43)
        writer.box({
          center: towelTop.clone().setY(towelTop.y - 0.3),
          size: new Vector3(0.42, 0.6, 0.025),
          rotationY: tangentYaw,
          slot: t < 0.5 ? 'fabricRust' : 'fabricBlue',
          chamfer: 0.008,
        })
      }
    } else {
      // Tool rack.
      writer.box({ center: touchSpot.clone().setY(touchSpot.y + 0.65), size: new Vector3(0.9, 1.3, 0.08), rotationY: tangentYaw, slot: 'steel', chamfer: 0.012 })
      writer.tube({
        path: [
          touchSpot.clone().addScaledVector(along, -0.3).setY(touchSpot.y + 0.4),
          touchSpot.clone().addScaledVector(along, -0.3).setY(touchSpot.y + 1.15),
        ],
        radius: 0.025,
        slot: 'orange',
        radialSegments: 6,
      })
    }

    // The jacket beat: one specific porch keeps a jacket over the chair back.
    if (i === 3) {
      writer.box({
        center: chairSpot.clone().setY(chairSpot.y + 0.78).addScaledVector(forward, -0.14),
        size: new Vector3(0.62, 0.5, 0.12),
        rotationY: centerYaw + Math.PI * 0.92,
        slot: 'fabricRust',
        chamfer: 0.05,
      })
    }

    // Colliders: body (dwellings only — the Common Hab shell brings its own
    // wall segments with a door gap) + porch.
    if (!site.common) {
      services.colliders.push({
        kind: 'box',
        center: center.clone(),
        size: new Vector3(length, radius * 2, radius * 2),
        yaw: tangentYaw,
      })
    }
    services.colliders.push({
      kind: 'box',
      center: porchCenter.clone(),
      size: new Vector3(3.6, 0.5, 2.6),
      yaw: centerYaw,
    })

    // Nameplate for the common hab.
    if (site.common) {
      const sign = new Mesh(
        new PlaneGeometry(1.9, 0.4),
        signageMaterial(['COMMON HAB'], { background: '#25231f', accent: '#c94f1d', widthPx: 512 }),
      )
      sign.position.copy(
        doorCenter.clone().addScaledVector(forward, 0.34).setY(ground + 2.78),
      )
      sign.rotation.y = centerYaw
      services.group.add(sign)
    }
  }
}

/**
 * The Common Hab: a panel-built community hall (5 × 12, walls with a real
 * door aperture on the park side). The interiors pass furnishes it and
 * hangs the sliding door.
 */
function buildCommonHabShell(
  services: DistrictServices,
  x: number,
  z: number,
  ground: number,
  centerYaw: number,
  along: Vector3,
  forward: Vector3,
): void {
  const { writer } = services
  const width = 12 // along the arc tangent
  const depth = 5
  const height = 3
  const base = new Vector3(x, ground, z)

  // Plinth + floor.
  writer.box({
    center: base.clone().setY(ground + 0.16),
    size: new Vector3(width + 0.5, 0.32, depth + 0.5),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'cast',
    chamfer: 0.03,
  })
  writer.box({
    center: base.clone().setY(ground + 0.37),
    size: new Vector3(width - 0.2, 0.1, depth - 0.2),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'deck',
  })

  const wallY = ground + 0.32 + height / 2
  // Back wall (away from park) + two end walls: solid.
  writer.box({
    center: base.clone().addScaledVector(forward, -depth / 2 + 0.09).setY(wallY),
    size: new Vector3(width, height, 0.18),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'habShell',
    chamfer: 0.03,
    uvScale: 0.5,
  })
  for (const s of [-1, 1]) {
    writer.box({
      center: base.clone().addScaledVector(along, (width / 2 - 0.09) * s).setY(wallY),
      size: new Vector3(0.18, height, depth),
      rotationY: centerYaw + Math.PI / 2,
      slot: 'habShell',
      chamfer: 0.03,
    })
  }
  // Front wall: two runs + header over a 1.3 m door bay, plus window bands.
  for (const s of [-1, 1]) {
    const runLength = width / 2 - 0.65
    writer.box({
      center: base
        .clone()
        .addScaledVector(forward, depth / 2 - 0.09)
        .addScaledVector(along, (0.65 + runLength / 2) * s)
        .setY(wallY),
      size: new Vector3(runLength, height, 0.18),
      rotationY: centerYaw + Math.PI / 2,
      slot: 'habShell',
      chamfer: 0.03,
    })
    writer.box({
      center: base
        .clone()
        .addScaledVector(forward, depth / 2 - 0.08)
        .addScaledVector(along, (width / 4 + 0.5) * s)
        .setY(ground + 1.85),
      size: new Vector3(2.6, 0.9, 0.05),
      rotationY: centerYaw + Math.PI / 2,
      slot: 'darkGlass',
    })
  }
  writer.box({
    center: base.clone().addScaledVector(forward, depth / 2 - 0.09).setY(ground + 0.32 + height - 0.3),
    size: new Vector3(1.34, 0.6, 0.18),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'habShell',
    chamfer: 0.02,
  })
  // Roof with a gentle mono-pitch and fascia.
  writer.box({
    center: base.clone().setY(ground + 0.32 + height + 0.12),
    size: new Vector3(width + 0.8, 0.24, depth + 0.8),
    rotationY: centerYaw + Math.PI / 2,
    slot: 'steel',
    chamfer: 0.03,
  })

  // Wall colliders (door gap in the front wall).
  const wall = (offsetAlong: number, offsetForward: number, size: Vector3): void => {
    services.colliders.push({
      kind: 'box',
      center: base
        .clone()
        .addScaledVector(along, offsetAlong)
        .addScaledVector(forward, offsetForward)
        .setY(wallY),
      size,
      yaw: centerYaw + Math.PI / 2,
    })
  }
  wall(0, -depth / 2 + 0.09, new Vector3(width, height, 0.22))
  wall(-width / 2 + 0.09, 0, new Vector3(0.22, height, depth))
  wall(width / 2 - 0.09, 0, new Vector3(0.22, height, depth))
  wall(-(0.65 + (width / 2 - 0.65) / 2), depth / 2 - 0.09, new Vector3(width / 2 - 0.65, height, 0.22))
  wall(0.65 + (width / 2 - 0.65) / 2, depth / 2 - 0.09, new Vector3(width / 2 - 0.65, height, 0.22))
}
