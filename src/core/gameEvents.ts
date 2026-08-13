/** Central registry of every event the bus carries. Grows as stages land. */
export type GameEvents = {
  'render/resized': { width: number; height: number; renderScale: number }
  /** Fired once when the entry screen releases the park to the player. */
  'park/entered': { arrival: boolean }
  /** Fired after the first unpaused gameplay frame has been submitted. */
  'render/started': { arrival: boolean }
  /** The Loop reached a station and opened its doors. */
  'tram/docked': { station: string }
}
