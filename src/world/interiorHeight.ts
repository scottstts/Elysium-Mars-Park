import { AMPHITHEATER, ARRIVAL_SPINE, BOULEVARD, LOOP, PADS } from './parkPlan'
import {
  GUIDEWAY_CHANNEL,
  PAVE,
  THROAT,
  insideSpurCorridor,
  pavedSignedDistance,
  polylineDistance,
} from './pavingPlan'

/**
 * The park floor's two datums.
 *
 *   `groundGrade(x,z)`  — the REGOLITH surface: graded civic ground (long
 *                         swales, flatter toward the centre) with real
 *                         high-frequency relief on open ground only.
 *   `interiorHeight(x,z)` — the WALKABLE surface: grade plus the paved lift.
 *                         Physics, prop placement, the guideway datum and
 *                         every foundation read this one, so anything that
 *                         stands on paving stands on the paving, not under it.
 *
 * Pure and deterministic; no allocation. Paving is dead flat over the grade,
 * pads flatten entirely, and the amphitheater bowl is authored, not dug.
 */

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function valueNoise(x: number, z: number, wavelength: number): number {
  const fx = x / wavelength
  const fz = z / wavelength
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = smooth(fx - ix)
  const tz = smooth(fz - iz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return (a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * tz) * 2 - 1
}

/**
 * Fine regolith relief — the difference between "desert plane" and ground.
 * Amplitude is deliberately small (±9 cm) and the wavelengths are ≥3.5 m so
 * the floor mesh (≈0.8 m stations) resolves them instead of aliasing, and so
 * light rakes across the surface without props looking marooned.
 */
function reliefDetail(x: number, z: number): number {
  return (
    valueNoise(x + 71, z - 133, 4.4) * 0.055 +
    valueNoise(x - 517, z + 88, 11.5) * 0.036 +
    valueNoise(x + 331, z + 977, 21) * 0.03
  )
}

/** The regolith surface: what the floor mesh draws and paving sits on. */
export function groundGrade(x: number, z: number): number {
  const r = Math.hypot(x, z)

  // Long swales, ±0.75 m at most. The amplitude profile keeps the civic core
  // near-flat and lets the open ground out toward the rim breathe — and it
  // COLLAPSES around every authored pad, because a pad's 5–8 m skirt cannot
  // climb a metre of swale without turning into a 25% ramp under the paving.
  let padProximity = 0
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    const reach = pad.skirt * 4
    if (d < pad.radius + reach) {
      padProximity = Math.max(
        padProximity,
        smooth(clamp01(1 - Math.max(0, d - pad.radius) / reach)),
      )
    }
  }
  const openness = smooth(clamp01((r - 22) / 64))
  const swaleAmplitude = (0.28 + 0.47 * openness) * (1 - 0.72 * padProximity)
  let height =
    (valueNoise(x + 913, z - 407, 88) * 0.74 + valueNoise(x - 220, z + 551, 33) * 0.3) *
    swaleAmplitude

  // A gentle crown so the floor drains outward. Kept LOW: the original 0.9 m
  // crown sat the plaza pad in a bowl and swallowed every curb around it.
  height += 0.34 * (1 - smooth(Math.min(1, r / 118)))

  // Structural guard: an authored dish may never intrude into the tram
  // boulevard — a street cannot ride a 2.6 m bowl. parkPlan now seats the
  // amphitheater well inside r=91, so this clamp is inert; it stays because
  // it makes the invariant impossible to break by moving a constant.
  const bowlClearance = smooth(clamp01((BOULEVARD.innerRadius - 2 - r) / 8))
  const bowlDistance = Math.hypot(x - AMPHITHEATER.x, z - AMPHITHEATER.z)
  const bowlOuter = AMPHITHEATER.bowlRadius + 24
  let flatness = 0
  if (bowlDistance < bowlOuter && bowlClearance > 0) {
    const t = Math.max(0, 1 - bowlDistance / bowlOuter)
    const dish = 0.9 - AMPHITHEATER.depth * smooth(t)
    const authority = smooth(Math.min(1, t * 2)) * bowlClearance
    height = height * (1 - authority) + dish * authority
    flatness = Math.max(flatness, authority)
  }

  // Authored pads flatten everything inside their radius. The skirt is eased
  // over 1.8× its authored width: parkPlan's 5–8 m skirts against 0.5–1.4 m
  // steps are 20%+ ramps at their steepest, which is fine for dirt and wrong
  // for a paved promenade. The flat area itself is untouched.
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z)
    const skirt = pad.skirt * 1.8
    if (d < pad.radius + skirt) {
      const blend = d < pad.radius ? 1 : smooth(1 - (d - pad.radius) / skirt)
      height = height * (1 - blend) + pad.y * blend
      flatness = Math.max(flatness, blend)
    }
  }

  // Relief lives on OPEN ground only: never under paving (the slab would
  // poke through), never on a pad (pads are poured flat by definition).
  const sd = pavedSignedDistance(x, z)
  const clearOfPaving = smooth(clamp01((sd - 0.5) / 2.2))
  const open = (1 - flatness) * clearOfPaving
  if (open > 0) height += reliefDetail(x, z) * open

  return height
}

/**
 * THE CORRIDOR CONFORM LAW — one field, every dirt consumer.
 *
 * Wherever the Loop runs embedded (the ring channel and the arrival tail),
 * three independently-sampled meshes meet: the swept trackbed cast, the
 * per-vertex channel/corridor floors, and the regolith sheet. The first two
 * share the crown datum and are separated by the GUTTER; the sheet used to be
 * patched near them case-by-case (a spur dig here, a turnout lid there, a
 * ring-band guard around all of it), and every patch boundary was a place
 * where dirt could poke above the bed (owner finding: dirt roofing the
 * channel margins by exactly rise − 0.13 = 55 mm all around the ring, ragged
 * partial-weight wedges at the turnout). One law replaces the patches:
 *
 *   within CORRIDOR_FULL of the alignment the sheet lies EXACTLY at
 *   crown − CORRIDOR_DROP; the weight fades to zero by CORRIDOR_FADE;
 *   it only ever digs (an elevated crown never raises a berm).
 *
 * crown is evaluated at the PROJECTED alignment point, so lateral position
 * never tilts the target, and every pour/cast datum derives from that same
 * projected crown — the sheet's offset to each of them is therefore a
 * CONSTANT at every point of the corridor:
 *   channel floors  crown − 0.07   → sheet 60 mm under the exposed gutters
 *   channel lips    crown + 0.06   → 190 mm of constant curb reveal
 *   trackbed apron  crown + 0.018  → 148 mm of trackbed reveal on the trench
 * The verge skirt (paving.ts emitGuidewayChannel) dives to crown − 0.45 and
 * is therefore buried under the conformed sheet by construction. The ring
 * band needs no guard: the dig lives OUTSIDE groundGrade, so the pour datums
 * that derive from (0, LOOP.radius) never see it.
 */
const CORRIDOR_DROP = 0.13
const CORRIDOR_FULL = 2.2
const CORRIDOR_FADE = 3.3

/** Lateral distance to the nearest embedded Loop alignment and the trackbed
 *  crown AT THE PROJECTED POINT. Null beyond CORRIDOR_FADE of both. */
export function corridorField(x: number, z: number): { d: number; crown: number } | null {
  let d = Infinity
  let crown = 0
  const r = Math.hypot(x, z)
  const dRing = Math.abs(r - LOOP.radius)
  if (dRing < CORRIDOR_FADE && r > 1e-6) {
    const px = (x / r) * LOOP.radius
    const pz = (z / r) * LOOP.radius
    d = dRing
    // The ring crown: slabTop − recess at the projected ring point, the same
    // number beamTopY carries (street branch) and the channel floors pour from.
    crown = groundGrade(px, pz) + PAVE.rise - GUIDEWAY_CHANNEL.recess
  }
  const spur = spurTrackDatum(x, z)
  if (spur && spur.d < CORRIDOR_FADE && spur.d < d) {
    d = spur.d
    crown = spur.y
  }
  return d < CORRIDOR_FADE ? { d, crown } : null
}

/** The conform dig at a point: ≤ 0, exactly (crown − DROP) − grade in the
 *  full band. Pass a precomputed grade on hot paths. */
export function corridorDip(x: number, z: number, grade = groundGrade(x, z)): number {
  const field = corridorField(x, z)
  if (!field) return 0
  const target = field.crown - CORRIDOR_DROP
  if (target >= grade) return 0
  const w =
    field.d <= CORRIDOR_FULL
      ? 1
      : 1 - smooth((field.d - CORRIDOR_FULL) / (CORRIDOR_FADE - CORRIDOR_FULL))
  return (target - grade) * w
}

/** What the regolith floor mesh draws: the grade conformed to the corridor
 *  AND to the throat's grade conform — where the fields dish DOWN to the
 *  street (throatLift < 0) the sheet follows, or it roofs the lowered tiles
 *  (dirt poking through a paved forecourt — the owner's moat). Dig-only,
 *  like every sheet conform. */
export function regolithSurface(x: number, z: number): number {
  const grade = groundGrade(x, z)
  return grade + Math.min(corridorDip(x, z, grade), Math.min(0, throatLift(x, z)))
}

/**
 * THE THROAT GRADE CONFORM — the cross-fall absorber of the turnout zone.
 *
 * The street pours at the PROJECTED crown (the track's datum); the tile
 * fields pour at the LOCAL slab datum. Across the throat the two diverge by
 * up to ±0.18 m of natural cross-fall, and something must absorb it. On the
 * plain ring that job belongs to the channel's chamfered lip; in the throat
 * the owner's reference shows the real-world answer — the GROUND IS GRADED
 * TO THE STREET: tiles meet the edging strip flush (street + 46 mm, so the
 * strip's crown stands its designed 6 mm proud), easing back to the natural
 * grade over ~2.7 m laterally and ~3 m of arc beyond the zone's headers.
 *
 * Applied by `paving.slabTop` (every pour, curb, planter base and footing
 * follows automatically) and by `interiorHeight`'s paved branch (physics
 * and props agree). The regolith never lifts — dirt is not paving.
 */
/**
 * The throat's crown datum with the MEDIAL BLEND: the two ways' crowns
 * genuinely diverge away from tangency (the ring follows its grade, the
 * spur its own descent — ~0.1 m apart across the zone), and any surface
 * keyed to "the nearer one" creases on the switch line. Every throat
 * surface (street, strips, lifted tiles, the walkable datum) reads THIS,
 * which mixes the two over the 1.6 m around equidistance.
 */
export function throatCrown(x: number, z: number): number {
  const r = Math.hypot(x, z) || 1e-6
  const dRing = Math.abs(r - LOOP.radius)
  const ringCrown =
    groundGrade((x / r) * LOOP.radius, (z / r) * LOOP.radius) +
    PAVE.rise -
    GUIDEWAY_CHANNEL.recess
  const spur = spurTrackDatum(x, z)
  if (!spur) return ringCrown
  // Inverse-distance weighting ANCHORED AT THE CAST EDGES (|d| = 1.3): a
  // plain medial blend left the street up to 50 mm shy of whichever cast it
  // ran beside near the merge, and every exposed cast flank read as a loose
  // panel (owner: "messy parts"). Squared IDW pins the street to each
  // cast's own datum at its edge and varies smoothly between them.
  const aRing = Math.max(dRing - 1.3, 0.02)
  const aSpur = Math.max(spur.d - 1.3, 0.02)
  const wRing = 1 / (aRing * aRing)
  const wSpur = 1 / (aSpur * aSpur)
  return (ringCrown * wRing + spur.y * wSpur) / (wRing + wSpur)
}

export function throatLift(x: number, z: number): number {
  const throat = THROAT
  if (!throat) return 0
  const r = Math.hypot(x, z)
  const dRing = Math.abs(r - LOOP.radius)
  const dSpurLine = polylineDistance(throat.spurLine, x, z)
  const lateral = Math.min(dRing, dSpurLine)
  const full = throat.half + 0.13
  // A WIDE fade (8 m): at 2.7 m the graded apron was a visible tinted ring
  // around the band — a 6 % slope facing away from the low sun (the owner's
  // "moat"). At 8 m it is a ~2 % dish across the whole terrace frontage,
  // the real-world grading a station forecourt gets.
  const fade = throat.half + 8
  if (lateral >= fade) return 0
  const wLat =
    lateral <= full ? 1 : 1 - smooth((lateral - full) / (fade - full))
  // Longitudinal weight: full through the zone, easing out over 5 m of arc
  // beyond each header so the tile fields TILT back to their natural datum
  // instead of stepping on the header line. The spur leg needs no fade — it
  // ends in the regolith trench, which never lifts.
  let w = wLat
  if (dRing < dSpurLine) {
    const phi = Math.atan2(z, x)
    const RAMP = 5 / LOOP.radius
    const along = clamp01(
      Math.min(phi - (throat.phiLo - RAMP), throat.phiHi + RAMP - phi) / RAMP,
    )
    w = wLat * smooth(along)
  }
  if (w <= 0) return 0
  // Target: tiles at street + 46 mm, street at the blended crown + 14 mm.
  const natural = groundGrade(x, z) + PAVE.rise
  return (throatCrown(x, z) + 0.06 - natural) * w
}

// --- the arrival spur's ground truth ---------------------------------------

/** Vertical profile over the tail of ARRIVAL_SPINE (indices 8…15): the two
 *  authored descent heights, then street + lift — mirrors track.ts's
 *  spineHeights, which owns the real curve. Linear interpolation between
 *  nodes is within a few cm of the Catmull; the 70 mm trench margin and the
 *  10 mm corridor-floor reveal both absorb that. */
const SPUR_TAIL_FROM = 8
const SPUR_TAIL_ABS = [1.4, 1.06]
const SPUR_TAIL_LIFT = [0.18, 0, 0, 0, 0, 0]

let streetCache: number | null = null

/** The ring's street datum (channel floor level). `groundGrade` is pure —
 *  the trench lives in `trenchDip` — so this cannot recurse. */
function streetDatum(): number {
  if (streetCache === null) {
    streetCache = groundGrade(0, LOOP.radius) + PAVE.rise - GUIDEWAY_CHANNEL.recess
  }
  return streetCache
}

let spurBox: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null

/**
 * Lateral distance to the arrival spur's plan alignment and the trackbed
 * crown height there. Returns null outside the tail's bounding box (the hot
 * paths — every floor vertex, heightfield sample and prop — reject in four
 * compares).
 */
export function spurTrackDatum(x: number, z: number): { d: number; y: number } | null {
  const tail = ARRIVAL_SPINE.slice(SPUR_TAIL_FROM)
  if (!spurBox) {
    const pad = 3.5
    spurBox = {
      minX: Math.min(...tail.map(([px]) => px)) - pad,
      maxX: Math.max(...tail.map(([px]) => px)) + pad,
      minZ: Math.min(...tail.map(([, pz]) => pz)) - pad,
      maxZ: Math.max(...tail.map(([, pz]) => pz)) + pad,
    }
  }
  if (x < spurBox.minX || x > spurBox.maxX || z < spurBox.minZ || z > spurBox.maxZ) return null
  const nodeY = (k: number): number =>
    k < SPUR_TAIL_ABS.length
      ? SPUR_TAIL_ABS[k]
      : streetDatum() + SPUR_TAIL_LIFT[k - SPUR_TAIL_ABS.length]
  let best = Infinity
  let bestY = 0
  for (let i = 0; i < tail.length - 1; i++) {
    const [ax, az] = tail[i]
    const [bx, bz] = tail[i + 1]
    const abx = bx - ax
    const abz = bz - az
    const lengthSq = abx * abx + abz * abz
    const t = lengthSq === 0 ? 0 : clamp01(((x - ax) * abx + (z - az) * abz) / lengthSq)
    const px = ax + abx * t
    const pz = az + abz * t
    const dSq = (x - px) * (x - px) + (z - pz) * (z - pz)
    if (dSq < best) {
      best = dSq
      bestY = nodeY(i) + (nodeY(i + 1) - nodeY(i)) * t
    }
  }
  return { d: Math.sqrt(best), y: bestY }
}

/** The walkable surface: regolith grade + the paved slab lift. On open
 *  ground it follows the SHEET (grade + corridor conform); on paving it
 *  follows the slab datum (pure grade + rise); the edge fade blends the two. */
export function interiorHeight(x: number, z: number): number {
  // Inside the track ground bands (the turnout street and the promenade
  // crossing) the walkable surface follows the trackbed crown, not a slab
  // datum bridged over it. The street covers its stretch of the ring band
  // too, so no ring exclusion here — outside those regions the channel's own
  // shallow contract still applies via the coverage path below.
  if (insideSpurCorridor(x, z, -0.12)) {
    const field = corridorField(x, z)
    // Blended crown, not the min-switch: walking across the wedge between
    // the merging ways must not pop 0.1 m at the generator switch line.
    if (field && field.d < 3.0) return throatCrown(x, z) + 0.02
    const track = spurTrackDatum(x, z)
    if (track) return track.y + 0.018
  }
  const sd = pavedSignedDistance(x, z)
  const grade = groundGrade(x, z)
  const lift = throatLift(x, z)
  const sheetDip = Math.min(corridorDip(x, z, grade), Math.min(0, lift))
  if (sd >= PAVE.edgeFade) return grade + sheetDip
  const coverage = sd <= 0 ? 1 : 1 - smooth(sd / PAVE.edgeFade)
  // The paved datum carries the throat's grade conform (see throatLift) so
  // physics and props stand exactly on the poured tiles there; the dirt
  // datum matches regolithSurface for the same reason.
  return grade + sheetDip * (1 - coverage) + (PAVE.rise + lift) * coverage
}
