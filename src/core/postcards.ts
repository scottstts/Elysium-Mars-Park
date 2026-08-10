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
export const BOOKMARKS: Record<string, Bookmark> = {
  // 1. Portal iris opens — tram rolls into the light (from inside the cabin).
  // Slightly off the x=0 axis: dead-on, the tube's ceiling light strip and
  // the portal meridian rib stack into one huge frame-bisecting pole.
  arrival: { position: [-2.6, 4.3, 257], look: [-1, 2.4, 170], stage: 'S9' },
  // 2. The First Tree, lone green against butterscotch sky.
  // NOTE: bookmark heights are TERRAIN-AUDITED (interiorHeight + 1.7) — a
  // buried camera reads as a black void and costs hours (see notes.md).
  firsttree: { position: [-17, 3.9, 24], look: [0, 7, 0], stage: 'S12' },
  // 3. Rim Promenade: the plain to the horizon through glass. Clear of the
  // Overlook Lounge footprint (z -1..-27) — the S4-era spot got built over.
  rim: { position: [-193, 3.4, -44], look: [-315, 16, -30], stage: 'S4' },
  // 4. The Panewalker crossing the sun, shadow sweeping the gardens.
  // The gantry BOOTS on the sun line (phi0=2.793); from the plaza's east
  // edge it hangs dead-center in the glare for the first minutes.
  panewalker: { position: [25, 2.9, -16], look: [-133, 86, 49], stage: 'S11' },
  // 5. Greenhouse Hall interior: grow-light green against low amber sun.
  // In the walking aisle (z offset off the center tray line), not in a tray.
  greenhouse: { position: [150, 2.4, 5.2], look: [178, 2.1, 5.2], stage: 'S10' },
  // 6. The Amphitheater's empty seats in raking light — from the top row,
  // down the tiered rake to the stage, rim glass and the plain beyond.
  amphitheater: { position: [-58, 0.4, 61], look: [-112, -1.6, 56], stage: 'S8' },
  // 7. The Works from the gallery walk, vapor curling in a sunbeam.
  works: { position: [96, 6.8, -96], look: [128, 4, -122], stage: 'S8' },
  // 8. A hab porch: chair, personal touch, long shadows, home. Close-in on
  // hab 3's porch (site ~(-158,-82), porch faces the park center).
  porch: { position: [-146, 3.5, -74], look: [-153.5, 2.2, -80.5], stage: 'S8' },
  // 9. Raked spirals of the Regolith Gardens under the crown — slight
  // elevation, tilted down so the concentric ridge rings actually read.
  gardens: { position: [-28, 4.6, -42], look: [-56, -0.5, -68], stage: 'S5' },
  // 10. Mid-jump on the Meridian Walk, park spread beneath the arc —
  // eye at the true 0.38 g apex (+1.24 m over standing height).
  jump: { position: [-4, 4.1, 96], look: [0, 4, 0], stage: 'S6' },
  // Dev-only wide establishing view (not part of the ten).
  overview: { position: [190, 150, 260], look: [0, 20, 0], stage: 'dev' },
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
  'gardens',
  'jump',
] as const

export function auditPostcardBookmarks(): { complete: boolean; missing: string[] } {
  const missing = REQUIRED.filter((name) => !(name in BOOKMARKS))
  return { complete: missing.length === 0, missing }
}
