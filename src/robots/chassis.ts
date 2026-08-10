import { CanvasTexture, Group, Mesh, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { PartWriter } from '../archkit/writer'
import { kitMaterials } from '../materials/library'

/**
 * Ground-robot chassis builders. Each robot is a small Group with `wheels`
 * (spun by the routine) and an optional `tool` group (bobbed while working).
 * Everything from the shared kit materials; decals via tiny canvas planes.
 */
export interface RobotRig {
  group: Group
  wheels: Group[]
  tool: Group | null
}

function wheel(radius: number, width: number): Group {
  const writer = new PartWriter()
  const materials = kitMaterials()
  const wheelGroup = new Group()
  const segments = 14
  const path: Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    path.push(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0))
  }
  writer.tube({ path, radius: width / 2, slot: 'dark', radialSegments: 8 })
  writer.box({
    center: new Vector3(0, 0, 0),
    size: new Vector3(radius * 1.1, radius * 1.1, width * 0.5),
    slot: 'aluminum',
    chamfer: 0.01,
  })
  wheelGroup.add(writer.build(materials, { castShadow: true }))
  return wheelGroup
}

function nameDecal(text: string, eyes = false): Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, 256, 128)
    if (eyes) {
      // Someone painted eyes on GK-02. Nobody has confessed.
      g.fillStyle = '#fdfdf6'
      g.beginPath()
      g.ellipse(88, 52, 26, 32, 0, 0, Math.PI * 2)
      g.ellipse(168, 52, 26, 32, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#1e1c22'
      g.beginPath()
      g.arc(94, 58, 11, 0, Math.PI * 2)
      g.arc(174, 58, 11, 0, Math.PI * 2)
      g.fill()
    } else {
      g.fillStyle = '#efe9dc'
      g.font = '700 44px "Helvetica Neue"'
      g.textAlign = 'center'
      g.fillText(text, 128, 78)
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const material = new MeshStandardNodeMaterial()
  material.map = texture
  material.transparent = true
  material.roughness = 0.6
  const mesh = new Mesh(new PlaneGeometry(0.42, 0.21), material)
  mesh.castShadow = false
  return mesh
}

/** Low flat groundskeeper with a rake boom (GK-01 / GK-02 with the eyes). */
export function buildGroundskeeper(name: string, eyes: boolean): RobotRig {
  const writer = new PartWriter()
  const materials = kitMaterials()
  const group = new Group()

  writer.box({
    center: new Vector3(0, 0.42, 0),
    size: new Vector3(0.86, 0.34, 1.25),
    slot: 'steel',
    chamfer: 0.04,
  })
  writer.box({
    center: new Vector3(0, 0.62, 0.28),
    size: new Vector3(0.5, 0.16, 0.5),
    slot: 'orange',
    chamfer: 0.03,
  })
  writer.box({
    center: new Vector3(0, 0.78, 0.3),
    size: new Vector3(0.2, 0.18, 0.2),
    slot: 'darkGlass',
    chamfer: 0.02,
  })
  group.add(writer.build(materials, { castShadow: true }))

  const wheels: Group[] = []
  for (const [wx, wz] of [
    [-0.46, 0.42],
    [0.46, 0.42],
    [-0.46, -0.42],
    [0.46, -0.42],
  ] as const) {
    const w = wheel(0.19, 0.12)
    w.position.set(wx, 0.19, wz)
    w.rotation.y = Math.PI / 2
    group.add(w)
    wheels.push(w)
  }

  // Rake boom trailing behind: arm + tine bar.
  const tool = new Group()
  const toolWriter = new PartWriter()
  toolWriter.box({
    center: new Vector3(0, 0.05, -0.45),
    size: new Vector3(0.08, 0.06, 0.9),
    slot: 'aluminum',
    chamfer: 0.012,
  })
  toolWriter.box({
    center: new Vector3(0, -0.05, -0.9),
    size: new Vector3(0.9, 0.05, 0.08),
    slot: 'orange',
    chamfer: 0.012,
  })
  for (let tine = 0; tine < 9; tine++) {
    toolWriter.box({
      center: new Vector3(-0.4 + tine * 0.1, -0.14, -0.9),
      size: new Vector3(0.02, 0.16, 0.02),
      slot: 'dark',
    })
  }
  tool.add(toolWriter.build(materials, { castShadow: true }))
  tool.position.set(0, 0.45, 0)
  group.add(tool)

  const decal = nameDecal(name, eyes)
  decal.position.set(0, 0.52, 0.635)
  group.add(decal)

  return { group, wheels, tool }
}

/** Rounded sweeper with a spinning front brush. */
export function buildSweeper(): RobotRig {
  const writer = new PartWriter()
  const materials = kitMaterials()
  const group = new Group()
  writer.box({
    center: new Vector3(0, 0.4, -0.05),
    size: new Vector3(0.78, 0.42, 1.05),
    slot: 'orange',
    chamfer: 0.09,
  })
  writer.box({
    center: new Vector3(0, 0.66, -0.2),
    size: new Vector3(0.4, 0.14, 0.4),
    slot: 'darkGlass',
    chamfer: 0.03,
  })
  group.add(writer.build(materials, { castShadow: true }))

  const wheels: Group[] = []
  for (const [wx, wz] of [
    [-0.42, 0.3],
    [0.42, 0.3],
    [-0.42, -0.35],
    [0.42, -0.35],
  ] as const) {
    const w = wheel(0.16, 0.1)
    w.position.set(wx, 0.16, wz)
    w.rotation.y = Math.PI / 2
    group.add(w)
    wheels.push(w)
  }

  // Front brush drum (spins in update).
  const tool = new Group()
  const brushWriter = new PartWriter()
  const path: Vector3[] = []
  for (let i = 0; i <= 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    path.push(new Vector3(Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0))
  }
  brushWriter.tube({ path, radius: 0.1, slot: 'fabricRust', radialSegments: 7 })
  tool.add(brushWriter.build(materials, { castShadow: true }))
  tool.position.set(0, 0.14, 0.62)
  tool.rotation.y = Math.PI / 2
  group.add(tool)
  return { group, wheels, tool }
}

/** Flatbed cargo mule with strapped crates. */
export function buildMule(): RobotRig {
  const writer = new PartWriter()
  const materials = kitMaterials()
  const group = new Group()
  writer.box({
    center: new Vector3(0, 0.5, 0),
    size: new Vector3(0.95, 0.18, 1.7),
    slot: 'steel',
    chamfer: 0.03,
  })
  writer.box({
    center: new Vector3(0, 0.72, 0.72),
    size: new Vector3(0.8, 0.3, 0.24),
    slot: 'orange',
    chamfer: 0.03,
  })
  writer.box({
    center: new Vector3(-0.18, 0.85, -0.15),
    size: new Vector3(0.5, 0.5, 0.7),
    slot: 'aluminum',
    chamfer: 0.02,
  })
  writer.box({
    center: new Vector3(0.26, 0.74, -0.5),
    size: new Vector3(0.36, 0.3, 0.44),
    slot: 'fabricSand',
    chamfer: 0.03,
  })
  group.add(writer.build(materials, { castShadow: true }))
  const wheels: Group[] = []
  for (const [wx, wz] of [
    [-0.5, 0.55],
    [0.5, 0.55],
    [-0.5, -0.55],
    [0.5, -0.55],
  ] as const) {
    const w = wheel(0.22, 0.14)
    w.position.set(wx, 0.22, wz)
    w.rotation.y = Math.PI / 2
    group.add(w)
    wheels.push(w)
  }
  return { group, wheels, tool: null }
}
