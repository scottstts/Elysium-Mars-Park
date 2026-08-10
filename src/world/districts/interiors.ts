import type { DistrictServices } from './types'
import { buildLoungeInterior } from './loungeInterior'
import { buildOpsInterior } from './opsInterior'
import { buildCommonHabInterior } from './habInterior'
import { buildGreenhouseInterior } from './greenhouseInterior'

/**
 * Aggregator ONLY (orchestrator-owned). Each hero interior lives in its own
 * file owned by its district's rebuild agent:
 *   loungeInterior.ts     — leisure agent
 *   opsInterior.ts        — works agent
 *   habInterior.ts        — residential agent
 *   greenhouseInterior.ts — farmside agent
 * Shared fittings (sliding doors) live in interiorShared.ts.
 */
export function buildInteriors(services: DistrictServices): void {
  buildLoungeInterior(services)
  buildOpsInterior(services)
  buildCommonHabInterior(services)
  buildGreenhouseInterior(services)
}

export { loungeInteriorSign } from './loungeInterior'
