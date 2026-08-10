import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'

/**
 * ?view=gallery — calibration scene for the image pipeline: PBR sweeps,
 * an emissive bar for bloom, and a thin-member truss for AO stability.
 * Dev-only; lit by the real sky system (sun + baked environment), so it
 * always shows materials under true game lighting.
 */
export class TestGallerySystem implements GameSystem {
  readonly id = 'testGallery'
  private readonly group = new Group()

  init(ctx: GameContext): void {
    const { scene } = ctx

    const floor = new Mesh(
      new PlaneGeometry(60, 60),
      new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.62
    floor.receiveShadow = true
    this.group.add(floor)

    // Roughness × metalness sweep.
    const sphereGeometry = new SphereGeometry(0.5, 48, 32)
    for (let m = 0; m <= 1; m++) {
      for (let r = 0; r < 6; r++) {
        const sphere = new Mesh(
          sphereGeometry,
          new MeshStandardMaterial({
            color: 0xc0c0c0,
            roughness: r / 5,
            metalness: m,
          }),
        )
        sphere.position.set(-5 + r * 2, 0.5, -2 + m * 2)
        sphere.castShadow = true
        sphere.receiveShadow = true
        this.group.add(sphere)
      }
    }

    // Emissive bar — the bloom threshold reference (3× white).
    const bar = new Mesh(
      new BoxGeometry(4, 0.3, 0.3),
      new MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 3 }),
    )
    bar.position.set(0, 2.6, -4)
    this.group.add(bar)

    // Thin-member truss sample: the AO strobing sentinel.
    const strut = new CylinderGeometry(0.03, 0.03, 3.4, 10)
    const strutMaterial = new MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55 })
    for (let i = 0; i < 9; i++) {
      const member = new Mesh(strut, strutMaterial)
      member.position.set(4.5, 1.2, 1.5 - i * 0.42)
      member.rotation.z = i % 2 === 0 ? 0.5 : -0.5
      member.castShadow = true
      this.group.add(member)
    }

    // Contact boxes for GTAO grounding reads.
    const boxMaterial = new MeshStandardMaterial({ color: 0xb46a3c, roughness: 0.8 })
    for (let i = 0; i < 4; i++) {
      const box = new Mesh(new BoxGeometry(1.2, 0.5 + i * 0.32, 1.2), boxMaterial)
      box.position.set(-6 + i * 1.7, (0.5 + i * 0.32) / 2, 3.6)
      box.castShadow = true
      box.receiveShadow = true
      this.group.add(box)
    }

    scene.add(this.group)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}
