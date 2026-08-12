/**
 * The ten postcard moments from design.md are the visual contract: fixed
 * validation cameras reachable via ?view=<name>. Positions are refined as
 * the stages that own them land; the audit keeps the set complete.
 */
export interface Bookmark {
  position: [number, number, number]
  look: [number, number, number]
  /** Which build stage owns final framing. */
  stage: string
}

/** Park floor is y=0 at dome center; +X east, +Z south (design plan §1). */
// OVERHAUL NOTE: re-aimed for the 260 m dome + plaza-centric layout. These
// are rough first passes — final framing happens after the rebuild waves.
export const BOOKMARKS: Record<string, Bookmark> = {
  // 1. Portal iris opens — tram rolls into the light (from inside the cabin).
  // Slightly off the x=0 axis: dead-on, the tube's ceiling light strip and
  // the portal meridian rib stack into one huge frame-bisecting pole.
  arrival: { position: [-2.6, 4.1, 136], look: [-1, 2.2, 60], stage: 'S9' },
  // 2. The First Tree, lone green against butterscotch sky.
  // NOTE: bookmark heights are TERRAIN-AUDITED (interiorHeight + 1.7) — a
  // buried camera reads as a black void and costs hours (see notes.md).
  firsttree: { position: [-14, 3.6, 20], look: [0, 7, 0], stage: 'S12' },
  // 3. Rim Promenade: mountains to the horizon through glass, clear of the
  // Overlook Lounge footprint.
  rim: { position: [-104, 3.2, -26], look: [-220, 26, -16], stage: 'S4' },
  // 4. The Panewalker crossing the sun, shadow sweeping the open regolith.
  panewalker: { position: [22, 2.7, -12], look: [-70, 46, 26], stage: 'S11' },
  // 5. Greenhouse Hall interior: grow-light green against low amber sun.
  // In the walking aisle (z offset off the center tray line), not in a tray.
  // On the walking-aisle deck (across-offset ±1.85), not inside a rack row.
  greenhouse: { position: [56, 2.2, 1.85], look: [84, 1.9, 1.85], stage: 'S10' },
  // 6. The Amphitheater's empty seats in raking light — from the top row,
  // down the tiered rake to the stage, rim glass and the mountains beyond.
  amphitheater: { position: [-32, 1.8, 26], look: [-70, -1.2, 42], stage: 'S8' },
  // 7. The Works from the gallery walk, vapor curling in a sunbeam.
  works: { position: [26, 4.8, -42], look: [48, 2.4, -58], stage: 'S8' },
  // 8. A hab porch: chair, personal touch, long shadows, home. Close-in on
  // hab 3's porch (arc r=88, porch faces the park center).
  porch: { position: [-66.3, 1.8, -38.4], look: [-70.5, 1.5, -41.9], stage: 'S8' },
  // 9. THE FOUNTAIN across its court — eye height on the approach from the
  // plaza side, so the composition stacks the way the reference does: coping,
  // water, island, figures, both tazze and the crown against the dome. Framed
  // from 17 m out — just past the court's curb. Closer clips the crown off the
  // top of a 58 deg frame; further and a 10 m piece over a 15 m basin stops
  // filling it.
  fountain: { position: [-26.2, 2.15, -28.2], look: [-38, 4.6, -40], stage: 'S5' },
  // 10. Mid-jump on the Meridian Walk, park spread beneath the arc —
  // eye at the true 0.38 g apex (+1.24 m over standing height).
  jump: { position: [-3, 3.9, 58], look: [0, 3.8, 0], stage: 'S6' },
  // Bonus framing: the Overlook Lounge drum from the rim walk (not one of
  // the ten, but the drum deserves a saved camera).
  overlook: { position: [-100, 5.0, 8.0], look: [-114, 3.4, -6], stage: 'S8' },
  // Bonus: Freedom Tower from the approach walk — full height against the
  // dome, the lattice waist and the gallery lantern in one look.
  freedom: { position: [1.5, 2.9, 41.5], look: [33, 30, 57], stage: 'landmark' },
  // Bonus: under the tower looking straight up through the hyperboloid at
  // the cab, deck soffit and spire (the hero low-angle).
  freedomup: { position: [27.2, 1.7, 52.6], look: [32.2, 46, 56.4], stage: 'landmark' },
  // Regression view from the gallery walking surface. This bright, nearly
  // textureless deck is the park's strictest sun-shadow filtering test: it
  // reveals clipmap ownership changes that regolith and paving albedo hide.
  freedomdeck: { position: [36.6, 40.45, 58.4], look: [25, 38.7, 62], stage: 'landmark' },
  // Close stress view for shadow-direction aliasing and contact attachment.
  freedomshadow: { position: [31.2, 40.2, 53.6], look: [28.6, 38.75, 55.7], stage: 'landmark' },
  // Dev-only wide establishing view (not part of the ten).
  overview: { position: [100, 80, 135], look: [0, 15, 0], stage: 'dev' },
  // Dev-only pipeline calibration gallery.
  gallery: { position: [7, 4, 11], look: [0, 0.8, 0], stage: 'dev' },
}

const REQUIRED = [
  'arrival',
  'firsttree',
  'rim',
  'panewalker',
  'greenhouse',
  'amphitheater',
  'works',
  'porch',
  'fountain',
  'jump',
] as const

export function auditPostcardBookmarks(): { complete: boolean; missing: string[] } {
  const missing = REQUIRED.filter((name) => !(name in BOOKMARKS))
  return { complete: missing.length === 0, missing }
}
