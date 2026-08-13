/**
 * Headless geometry/placement gate for the Bowl concert stage.
 *
 *   node --experimental-strip-types tools/amphitheater-stage-audit.mjs
 *
 * No renderer or browser is started. The audit compiles the deterministic
 * stage kit into the same PartWriter used by the game, measures its envelope,
 * verifies the authored module contract, and runs the archkit degeneracy gate.
 */
import { registerHooks } from 'node:module'
import { Box3, Group } from 'three'

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

const { PartWriter } = await import('../src/archkit/writer.ts')
const { auditGeometry } = await import('../src/archkit/audit.ts')
const {
  AMPHITHEATER_STAGE_DIAGNOSTICS,
  AMPHITHEATER_STAGE_SCALE,
  buildAmphitheaterConcertStage,
} = await import('../src/world/districts/amphitheaterStage.ts')

const writer = new PartWriter()
const colliders = []
const services = {
  writer,
  group: new Group(),
  rng: null,
  colliders,
  seats: [],
  interactables: [],
  doors: [],
}
const plan = {
  center: { x: 0, z: 0 },
  facing: 0,
  deckTop: 0,
  halfWidth: 6.5 * AMPHITHEATER_STAGE_SCALE,
  front: 3.2 * AMPHITHEATER_STAGE_SCALE,
  back: -4.6 * AMPHITHEATER_STAGE_SCALE,
}
const result = buildAmphitheaterConcertStage(services, plan)
const materials = new Proxy({}, { get: () => ({ isMaterial: true }) })
const group = writer.build(materials)

let failures = 0
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures++
}

const bounds = new Box3().setFromObject(group)
const triangles = group.children.reduce(
  (sum, child) => sum + (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3,
  0,
)
const slots = new Set(group.children.map((child) => child.name.replace('part:', '')))

check('linear scale', AMPHITHEATER_STAGE_DIAGNOSTICS.scale === 1.8)
check('deck width contract', Math.abs(plan.halfWidth * 2 - 23.4) < 1e-9, `${(plan.halfWidth * 2).toFixed(2)} m`)
check('deck depth contract', Math.abs(plan.front - plan.back - 14.04) < 1e-9, `${(plan.front - plan.back).toFixed(2)} m`)
check('deterministic part budget', result.parts >= 550 && result.parts <= 620, `${result.parts} authored parts`)
check('material ownership', slots.size === 8, [...slots].sort().join(', '))
check('collider ownership', colliders.length === 12, `${colliders.length} colliders`)
const lecternForward = plan.front - 2.05
const lecternColliders = colliders.filter(
  (collider) =>
    collider.kind === 'box' &&
    Math.abs(collider.center.x - lecternForward) < 0.02 &&
    Math.abs(collider.center.z) < 0.02,
)
check(
  'precise lectern collision',
  lecternColliders.length === AMPHITHEATER_STAGE_DIAGNOSTICS.lecternColliders &&
    lecternColliders.every((collider) => collider.size.x <= 0.86 && collider.size.z <= 0.98),
  `${lecternColliders.length} local volumes`,
)
check(
  'microphone bends toward speaker',
  AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneCapsuleForwardOffset <
    AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneSocketForwardOffset,
  `${AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneSocketForwardOffset.toFixed(3)} → ` +
    `${AMPHITHEATER_STAGE_DIAGNOSTICS.microphoneCapsuleForwardOffset.toFixed(3)} m`,
)
check('kit stays over deck depth', bounds.min.x >= plan.back - 0.05 && bounds.max.x <= plan.front + 0.05, `local forward ${bounds.min.x.toFixed(2)}…${bounds.max.x.toFixed(2)} m`)
check('kit stays over deck width', bounds.min.z >= -plan.halfWidth - 0.05 && bounds.max.z <= plan.halfWidth + 0.05, `local lateral ${bounds.min.z.toFixed(2)}…${bounds.max.z.toFixed(2)} m`)
check('roof crown height', bounds.max.y >= 6.8 && bounds.max.y <= 7.2, `${bounds.max.y.toFixed(2)} m above deck`)
check('geometry budget', triangles > 30_000 && triangles < 180_000, `${Math.round(triangles).toLocaleString()} tris`)

const audit = auditGeometry(group, { bounds: null, clash: false, maxTriangles: 250_000 })
check('finite non-degenerate geometry', audit.defects.length === 0, `${audit.defects.length} defect records`)
check('all slots have materials', audit.noMaterial.length === 0, `${audit.noMaterial.length} missing`)
const crossSlotZfight = audit.zfight.filter((hit) => hit.a !== hit.b)
check('no coplanar cross-slot faces', crossSlotZfight.length === 0, `${crossSlotZfight.length} suspect pairs`)
if (crossSlotZfight.length > 0) console.table(crossSlotZfight)

console.log(
  failures === 0
    ? '\namphitheater stage audit PASS'
    : `\namphitheater stage audit FAIL (${failures})`,
)
process.exitCode = failures === 0 ? 0 : 1
