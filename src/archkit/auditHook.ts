/**
 * Dev-only console hook for the geometry gate:
 *
 *     await window.__elysium.audit()                  // whole scene
 *     await window.__elysium.audit({ clash: false })  // options
 *     await window.__elysium.audit(someGroup)         // one assembly
 *
 * archkit owns no bootstrap file, so the hook installs itself rather than
 * asking `main.ts` for a line. It defines an accessor for `window.__elysium`
 * that merges `audit` into whatever the boot sequence later assigns, so the
 * order of module evaluation does not matter. The audit module itself is
 * dynamically imported, so a production bundle never carries it.
 *
 * Resolving the scene needs `?debug` (that is when `main.ts` publishes `ctx`);
 * pass a root explicitly to audit without it.
 */
import type { Object3D } from 'three'
import type { AuditOptions, AuditReport } from './audit'

type Handle = Record<string, unknown> & { ctx?: { scene?: Object3D } }

function install(): void {
  const audit = async (a?: Object3D | AuditOptions, b?: AuditOptions): Promise<AuditReport> => {
    const { auditGeometry, logAuditReport } = await import('./audit')
    const store = (window as unknown as { __elysium?: Handle }).__elysium
    const explicit = a && typeof (a as Object3D).traverse === 'function' ? (a as Object3D) : undefined
    const opts = (explicit ? b : (a as AuditOptions | undefined)) ?? {}
    const root = explicit ?? store?.ctx?.scene
    if (!root) throw new Error('audit: no scene — boot with ?debug, or pass a root Object3D')
    return logAuditReport(auditGeometry(root, opts))
  }

  const merge = (value: unknown): unknown => {
    if (value && typeof value === 'object') (value as Handle).audit = audit
    return value
  }

  let store: unknown = merge((window as unknown as { __elysium?: Handle }).__elysium ?? { audit })
  Object.defineProperty(window, '__elysium', {
    configurable: true,
    get: () => store,
    set: (value: unknown) => {
      store = merge(value)
    },
  })
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) install()
