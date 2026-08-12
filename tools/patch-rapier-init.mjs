import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Rapier 0.19.3's compatibility wrapper passes its embedded WASM bytes to
 * wasm-bindgen positionally. The generated initializer still accepts that
 * form, but warns that the object form is now required. Patch only the call
 * shape; the package's embedded WASM bytes and public API remain untouched.
 *
 * Upstream issue: https://github.com/dimforge/rapier/issues/811
 */
const packageRoot = resolve('node_modules/@dimforge/rapier3d-compat')
const packageJsonPath = resolve(packageRoot, 'package.json')
const modulePath = resolve(packageRoot, 'rapier.mjs')

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
if (packageJson.version !== '0.19.3') {
  throw new Error(`Unsupported @dimforge/rapier3d-compat version: ${packageJson.version}`)
}

let source = await readFile(modulePath, 'utf8')
const legacyCall = 'yield xA('
const modernCall = 'yield xA({module_or_path:'

if (!source.includes(modernCall)) {
  const callStart = source.indexOf(legacyCall, source.indexOf('function dg()'))
  const argumentEnd = source.indexOf('.buffer)', callStart)
  if (callStart < 0 || argumentEnd < 0) {
    throw new Error('Rapier initializer layout changed; update tools/patch-rapier-init.mjs')
  }

  const closingParen = argumentEnd + '.buffer'.length
  const argument = source.slice(callStart + legacyCall.length, closingParen)
  source =
    source.slice(0, callStart) +
    modernCall +
    argument +
    '})' +
    source.slice(closingParen + 1)
  await writeFile(modulePath, source)
}
