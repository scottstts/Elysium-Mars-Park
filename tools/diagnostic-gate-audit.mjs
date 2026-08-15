/**
 * Headless contract for the URL diagnostic gate.
 *
 *   node --experimental-strip-types tools/diagnostic-gate-audit.mjs
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

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

const { isLocalDiagnosticHost, parseFlags } = await import('../src/core/debug.ts')

const query =
  '?debug=1&view=overview&pass=ao&tier=0&seed=7&freeze&profile=arrival'
const enabled = {
  view: 'overview',
  pass: 'ao',
  tier: 0,
  seed: 7,
  debug: true,
  freeze: true,
  profileArrival: true,
}
const disabled = {
  view: null,
  pass: 'final',
  tier: null,
  seed: null,
  debug: false,
  freeze: false,
  profileArrival: false,
}

for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
  assert.equal(isLocalDiagnosticHost(hostname), true)
  assert.deepEqual(parseFlags(query, hostname), enabled)
}
assert.equal(parseFlags('?pass=worldray', 'localhost').pass, 'worldray')

for (const hostname of [
  'mars-park.example',
  'localhost.example.com',
  '127.0.0.1.example.com',
  '0.0.0.0',
]) {
  assert.equal(isLocalDiagnosticHost(hostname), false)
  assert.deepEqual(parseFlags(query, hostname), disabled)
}

console.log('diagnostic-gate audit: loopback enabled, hosted disabled')
