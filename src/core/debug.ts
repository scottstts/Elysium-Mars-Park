import { BOOKMARKS, type Bookmark } from './postcards'

export type PassName =
  | 'final'
  | 'nopost'
  | 'ao'
  | 'aoshare'
  | 'aoapplied'
  | 'nograde'
  | 'shafts'
  | 'depth'
  | 'normal'
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
}

const PASS_NAMES: readonly PassName[] = [
  'final',
  'nopost',
  'ao',
  'aoshare',
  'aoapplied',
  'nograde',
  'shafts',
  'depth',
  'normal',
  'shadows',
  'bloom',
  'haze',
]

export function parseFlags(search = window.location.search): DebugFlags {
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
  }
}

export function getBookmark(name: string): Bookmark | null {
  return BOOKMARKS[name] ?? null
}
