import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three'
import type { Material } from 'three'
import { buildStarshipPayload } from './starshipBuild'
import { buildStarshipMaterials } from './starshipMaterials'
import { STARSHIP_SITE, STARSHIP_VEHICLE_OFFSET_X } from './starshipSite'
import type { StarshipPayload } from './starshipBuild'

/**
 * Main-thread side of the launch site: worker payload -> a scene graph that
 * reproduces the demo's own.
 *
 * TWO NESTED GROUPS, AND THE INNER ONE IS NOT OPTIONAL. The demo puts every
 * mesh in a root rotated −90° about X (Blender Z-up -> three Y-up) and leaves
 * the geometry in Blender coordinates. Four of the twenty materials read
 * `positionLocal` (Blender's Texture Coordinate > Object) — the tower steel,
 * the engine metal, the concrete and the painted parts all derive their noise
 * from it. Baking the world transform into the vertices, or collapsing the two
 * groups into one Euler, would move that texture space and change how every
 * one of those surfaces looks. So: site group (position + yaw) -> Blender
 * group (−90° X) -> meshes with the demo's own local pos/rotZ.
 */
export interface StarshipAsset {
  group: Group
  materials: Material[]
  meshes: Mesh[]
  triangles: number
  buildMs: number
}

export async function loadStarshipAsset(): Promise<StarshipAsset> {
  const payload = await runBuild()

  // The vehicle's X falls out of the catch-pad seat on the arm, and the site
  // constants are written against it. If a source edit moves it, the stack
  // slides sideways off its own concrete — say so rather than ship it.
  const drift = Math.abs(payload.vehicleX - STARSHIP_VEHICLE_OFFSET_X)
  if (drift > 1e-6) {
    console.warn(
      `[starship] vehicle offset moved by ${drift.toFixed(4)} m ` +
        `(${payload.vehicleX} vs ${STARSHIP_VEHICLE_OFFSET_X}); update starshipSite.ts`,
    )
  }

  const library = buildStarshipMaterials()
  const materials: Material[] = []
  const materialIndex = new Map<string, number>()
  const resolve = (name: string): number => {
    const existing = materialIndex.get(name)
    if (existing !== undefined) return existing
    const material = library[name]
    if (!material) throw new Error(`Starship: no material named "${name}"`)
    const index = materials.length
    materials.push(material)
    materialIndex.set(name, index)
    return index
  }

  const group = new Group()
  group.name = 'starship:site'
  group.position.set(STARSHIP_SITE.x, STARSHIP_SITE.y, STARSHIP_SITE.z)
  group.rotation.y = STARSHIP_SITE.yaw

  const blender = new Group()
  blender.name = 'starship:blender-frame'
  blender.rotation.x = -Math.PI / 2
  group.add(blender)

  const meshes: Mesh[] = []
  let triangles = 0
  for (const part of payload.parts) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(part.position, 3))
    geometry.setAttribute('normal', new BufferAttribute(part.normal, 3))
    geometry.setAttribute('uv', new BufferAttribute(part.uv, 2))
    // Each part indexes the SHARED material array, so its own draw ranges are
    // remapped from its slot list into that array's order. The demo could use
    // per-mesh arrays because it rebuilt them per object; one array here means
    // twenty materials compile once instead of ninety times.
    for (const g of part.groups) {
      geometry.addGroup(g.start, g.count, resolve(part.slots[g.materialIndex]))
    }
    geometry.computeBoundingSphere()

    const mesh = new Mesh(geometry, materials)
    mesh.name = `starship:${part.name}`
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2])
    mesh.rotation.z = part.rotZ
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    blender.add(mesh)
    meshes.push(mesh)
    triangles += part.triangles
  }

  return { group, materials, meshes, triangles, buildMs: payload.buildMs }
}

/**
 * Off-thread when the browser gives us a module worker, inline when it does
 * not. The fallback is a ~0.4 s block behind the entry screen rather than a
 * failure to load — a landmark that silently goes missing is worse.
 */
function runBuild(): Promise<StarshipPayload> {
  return new Promise<StarshipPayload>((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./starshipWorker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(buildStarshipPayload())
      return
    }
    worker.onmessage = (event: MessageEvent<StarshipPayload>): void => {
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (): void => {
      worker.terminate()
      resolve(buildStarshipPayload())
    }
    worker.postMessage('build')
  })
}
