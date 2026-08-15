import { BOOKMARKS, type Bookmark } from './postcards'

export type PassName =
  | 'final'
  | 'nopost'
  | 'ao'
  | 'aoraw'
  | 'aodenoised'
  | 'aoradius'
  | 'aoshare'
  | 'aoapplied'
  | 'nograde'
  | 'shafts'
  | 'depth'
  | 'normal'
  | 'worldray'
  | 'shadows'
  | 'bloom'
  | 'haze'

export interface DebugFlags {
  /** Fixed validation camera name (?view=firsttree) or null for the player. */
  view: string | null
  /** Isolated render pass (?pass=ao); 'final' is the shipped image. */
  pass: PassName
  /** Forced quality tier 0-2, or null for auto. */
  tier: number | null
  /** World-generation seed override. */
  seed: number | null
  /** Tweakpane + stats + timings (?debug). */
  debug: boolean
  /** Halt the park clock for a frozen validation frame (?freeze). */
  freeze: boolean
  /** Capture one instrumented tram arrival (?profile=arrival). */
  profileArrival: boolean
}

const PASS_NAMES: readonly PassName[] = [
  'final',
  'nopost',
  'ao',
  'aoraw',
  'aodenoised',
  'aoradius',
  'aoshare',
  'aoapplied',
  'nograde',
  'shafts',
  'depth',
  'normal',
  'worldray',
  'shadows',
  'bloom',
  'haze',
]

/**
 * Diagnostic URLs are a local-development capability, never a hosted one.
 * `window.location.hostname` excludes the port; keep this list to literal
 * loopback names so lookalike hosted domains cannot opt into debug systems.
 */
export function isLocalDiagnosticHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function disabledFlags(): DebugFlags {
  return {
    view: null,
    pass: 'final',
    tier: null,
    seed: null,
    debug: false,
    freeze: false,
    profileArrival: false,
  }
}

export function parseFlags(
  search = window.location.search,
  hostname = window.location.hostname,
): DebugFlags {
  if (!isLocalDiagnosticHost(hostname)) return disabledFlags()

  const params = new URLSearchParams(search)
  const passRaw = params.get('pass')
  const tierRaw = params.get('tier')
  const seedRaw = params.get('seed')
  return {
    view: params.get('view'),
    pass: PASS_NAMES.includes(passRaw as PassName) ? (passRaw as PassName) : 'final',
    tier: tierRaw !== null ? Math.max(0, Math.min(2, Number(tierRaw) | 0)) : null,
    seed: seedRaw !== null && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) : null,
    debug: params.has('debug'),
    freeze: params.has('freeze'),
    profileArrival: params.get('profile') === 'arrival',
  }
}

export function getBookmark(name: string): Bookmark | null {
  return BOOKMARKS[name] ?? null
}
