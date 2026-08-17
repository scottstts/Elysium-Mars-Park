/**
 * Shared shadow-handoff identifiers for the flight stack.
 *
 * The parked vehicle belongs to the frozen static shadow world. At ignition it
 * hands off to the outer live dynamic level, and after touchdown it hands back
 * only once every cached static clipmap has recaptured the parked silhouette.
 */
export const STARSHIP_STATIC_SHADOW_GROUP = 'starship-flight'
export const STARSHIP_DYNAMIC_SHADOW_LEVEL = 2
