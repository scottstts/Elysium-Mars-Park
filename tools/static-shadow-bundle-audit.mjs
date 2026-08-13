/**
 * Headless invariant gate for quality-neutral static-shadow bundle culling.
 *
 *   node --experimental-strip-types tools/static-shadow-bundle-audit.mjs
 */
import { registerHooks } from 'node:module'
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Scene } from 'three'

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

const { createStaticShadowScene } = await import('../src/render/staticShadowScene.ts')

const source = new Scene()
const material = new MeshBasicMaterial()
const near = caster('near', 0, 0, 2)
const edge = caster('edge', 12, 0, 4)
const far = caster('far', 100, 0, 2)
const dynamic = caster('dynamic', 0, 0, 2)
dynamic.layers.set(2)
source.add(near, edge, far, dynamic)

const shadows = createStaticShadowScene(source)
check(shadows.casterCount === 3, 'dynamic caster excluded')
check(shadows.bundleCount === 2, 'near casters share a cell; far caster is separate')

shadows.selectBundles(0, 0, 10, new Matrix4())
check(shadows.visibleBundleCount === 1, 'far bundle rejected')
check(shadows.visibleCasterCount === 2, 'intersecting bundle retains both casters')

shadows.selectBundles(50, 0, 10, new Matrix4())
check(shadows.visibleBundleCount === 0, 'empty clipmap submits no bundles')

shadows.showAllBundles()
check(shadows.visibleBundleCount === 2, 'loading warmup restores every bundle')
check(shadows.visibleCasterCount === 3, 'loading warmup records every static caster')

console.log('static shadow bundle audit PASS')

function caster(name, x, y, size) {
  const mesh = new Mesh(new BoxGeometry(size, size, size), material)
  mesh.name = name
  mesh.position.set(x, y, 0)
  mesh.castShadow = true
  return mesh
}

function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`)
}
