/**
 * Proves splitting `Tower_Chopsticks` into carriage + two arms changes nothing.
 *
 *   node --experimental-strip-types tools/starship-split-audit.mjs
 *
 * The catch arms have to retract for a launch, so `starshipBuild.ts` rebuilds
 * the demo's one fused chopsticks mesh as three independent meshes. The claim
 * that licenses this is that `MB.add_v` never welds: every `prism()`/`lathe()`
 * appends a fresh vertex island, so the carriage and the arms share no vertex,
 * no edge and no smoothing group even when they are built into one MB. If that
 * holds, the union of the three sub-meshes is the fused mesh — same triangles,
 * same normals, same uvs, same material assignment — reordered inside each
 * material group and nothing else.
 *
 * This asserts it directly: build both, bucket every triangle by material, and
 * compare the two multisets of (position, normal, uv) 24-tuples exactly.
 *
 * `tools/starship-parity.mjs` proves the FUSED mesh is still the demo's. This
 * proves the split of it is free. The two together are what let the arms move
 * without weakening the parity guarantee.
 */
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* fall through */
      }
    }
    return next(specifier, context)
  },
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { assembleStarship } = await import(join(ROOT, 'src/starship/starshipAssemble.ts'))
const { TW, carriage, chopstick } = await import(join(ROOT, 'src/starship/parts/tower.ts'))
const { MB } = await import(join(ROOT, 'src/procgen/sslib/meshbuilder.ts'))
const { buildGeometry } = await import(join(ROOT, 'src/procgen/sslib/evalmesh.ts'))

// The assembly MUTATES TW (ARM_Z, VEHICLE_X) before towerBuild runs. Both
// sides must see the same TW, so run it first and reuse its objects.
const assembly = assembleStarship()
const fusedObject = assembly.objs.find((o) => o.name === 'Tower_Chopsticks')
if (!fusedObject) throw new Error('no Tower_Chopsticks in the assembly')

const T_MAIN = 0, T_DARK = 1, T_GRATE = 2, T_DKM = 3

const carriageMb = new MB()
carriage(carriageMb, TW.ARM_Z, T_MAIN, T_MAIN, T_DARK, T_GRATE)
const armMbs = [1, -1].map((sgn) => {
  const mb = new MB()
  chopstick(mb, [TW.HW + 1.1, sgn * TW.ARM_PIVOT_Y, TW.ARM_Z], sgn * TW.ARM_SPLAY,
    TW.ARM_LEN, T_MAIN, T_MAIN, T_DARK, T_GRATE, T_DKM)
  return mb
})

/** Every triangle as an exact 24-float key, bucketed by material slot. */
function triangleKeys(payload) {
  const byMaterial = new Map()
  for (const group of payload.groups) {
    const bucket = byMaterial.get(group.materialIndex) ?? []
    byMaterial.set(group.materialIndex, bucket)
    for (let v = group.start; v < group.start + group.count; v += 3) {
      const parts = []
      for (let k = 0; k < 3; k++) {
        const p = (v + k) * 3, q = (v + k) * 2
        parts.push(
          payload.position[p], payload.position[p + 1], payload.position[p + 2],
          payload.normal[p], payload.normal[p + 1], payload.normal[p + 2],
          payload.uv[q], payload.uv[q + 1],
        )
      }
      bucket.push(parts.join(','))
    }
  }
  return byMaterial
}

const fused = buildGeometry(fusedObject.mb, fusedObject.smooth)
const pieces = [
  ['Tower_Carriage', buildGeometry(carriageMb, 30)],
  ['Tower_ArmP', buildGeometry(armMbs[0], 30)],
  ['Tower_ArmN', buildGeometry(armMbs[1], 30)],
]

const fusedKeys = triangleKeys(fused)
const splitKeys = new Map()
for (const [, payload] of pieces) {
  for (const [material, bucket] of triangleKeys(payload)) {
    splitKeys.set(material, (splitKeys.get(material) ?? []).concat(bucket))
  }
}

let failures = 0
const fail = (message) => { console.error(`  FAIL  ${message}`); failures++ }

const splitTris = pieces.reduce((n, [, p]) => n + p.tris, 0)
console.log(`fused  Tower_Chopsticks   ${fused.tris} triangles, ${fused.groups.length} material groups`)
for (const [name, payload] of pieces) {
  console.log(`split  ${name.padEnd(18)} ${payload.tris} triangles, ${payload.groups.length} material groups`)
}
if (splitTris !== fused.tris) fail(`triangle count ${splitTris} != ${fused.tris}`)

const materials = new Set([...fusedKeys.keys(), ...splitKeys.keys()])
for (const material of [...materials].sort((a, b) => a - b)) {
  const a = (fusedKeys.get(material) ?? []).slice().sort()
  const b = (splitKeys.get(material) ?? []).slice().sort()
  if (a.length !== b.length) {
    fail(`material ${material}: ${b.length} split triangles vs ${a.length} fused`)
    continue
  }
  let mismatched = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatched++
  if (mismatched) fail(`material ${material}: ${mismatched} of ${a.length} triangles differ`)
  else console.log(`  material ${String(material).padStart(2)}  ${String(a.length).padStart(5)} triangles identical`)
}

if (failures) {
  console.error(`\nSPLIT AUDIT FAILED — ${failures} problem(s)`)
  process.exit(1)
}
console.log('\nSPLIT OK — the three meshes are the fused mesh, triangle for triangle')
