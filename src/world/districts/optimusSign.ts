import { BufferAttribute, BufferGeometry, Mesh, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { smoothstep, texture as textureNode } from 'three/tsl'
import logoUrl from '../../assets/tesla_logo.png'
import type { PartWriter } from '../../archkit/writer'
import { plinthAnchor } from './optimusPlaza'
import type { ColliderSpec } from './types'

/**
 * THE MARQUE — a backlit sign standing at the plinth's west edge, directly
 * behind the formation and facing back down its bearing, so it reads over the
 * eight heads from the arrival approach.
 *
 * WHY IT IS A PORTAL AND NOT A BLADE. The figures face +X, so "behind them"
 * is the −X edge — which is exactly where the west flight lands. A solid
 * blade there would brick a stair that was asked for, and this park has a
 * standing rule against structures that lead nowhere. Lifting the panel onto
 * two legs keeps the flight, and the sign is better for it: from the east
 * approach it floats above and behind the heads instead of standing among
 * them. Clear opening is 2.93 m against the flight's 2.40 m, and 2.25 m high
 * over the deck (2.40 m over the top tread).
 *
 * The artwork is a neon mark on a black ground, so the panel is a LIGHTBOX,
 * not a printed plate: one image drives both colour and emission and the
 * black ground stays black. Its peak lands at 2.2 — between the ladder's
 * `interiorGlow` and `floorLens` rungs (notes.md) — because the emitting AREA
 * here is a whole panel rather than a legend, and the ladder's own rule is to
 * scale the area, not the multiplier. See the emission curve below.
 */

/** All heights are metres above the plinth's DECK, not the court. */
export const SIGN = {
  /** Distance from the plinth axis to the sign's centre plane. */
  offset: 5.35,
  /** Leg centres, either side of the flight below. */
  legHalfSpan: 1.55,
  /**
   * The posts are SLIMMER than the beams in both plan axes, and they die
   * 40 mm inside the head beam rather than finishing flush with it. That is
   * the whole rule of this frame: wherever two members meet, one contains the
   * other's boundary completely, so there is never a shared face to z-fight
   * and never a butt joint to gap. Flush-topped posts under a flush beam is
   * exactly the pair the geometry gate caught on the first pass.
   */
  legDepth: 0.19,
  legWidth: 0.17,
  beamDepth: 0.22,
  beamHeight: 0.15,
  /** How far the posts stop short of the head beam's top face. */
  legDie: 0.04,
  /** Soffit of the sill beam — the headroom under the sign. */
  clear: 2.25,
  panelHeight: 1.06,
  panelDepth: 0.09,
  /** Dark carcass left visible as a reveal around the lit face. */
  faceInset: 0.02,
  /** How far the lit face stands proud of the carcass. */
  faceProud: 0.004,
  basePlate: 0.03,
} as const

/** Source artwork is 1536 × 1024. */
const LOGO_ASPECT = 1536 / 1024
/** Vertical centre of the artwork within the image (v, y-up). */
const LOGO_V_CENTRE = 0.512
/**
 * Emission curve for the artwork. TWO terms, and the split is the whole point
 * (measured against the decoded PNG; bloom threshold is 1.0):
 *
 *   CORE — a smoothstep that only opens on the true neon strokes. These are
 *   1.53 % of the panel; this is the only term allowed over the threshold, so
 *   it is the only thing the renderer blooms.
 *
 *   BASE — a gentle linear term, capped by construction below the threshold
 *   (0.5 × luminance can never reach 1.0). It carries the artwork's painted
 *   halo as plain lit panel, and it is what keeps the sign reading once mip
 *   averaging has thinned the strokes: a pure power curve looks crisp up
 *   close and then goes DARK at distance — measured peak 0.68 at mip4, under
 *   the threshold, sign off.
 *
 * Against the first version (flat luminance × 3.4): blooming area 6.02 % →
 * 2.63 %, bloom energy cut 2.5×, peak 3.40 → 2.20, and the panel still glows
 * at mip4 (peak 1.44). The letter counters stay open instead of filling in.
 */
const CORE_LOW = 0.62
const CORE_HIGH = 0.95
const CORE_GAIN = 1.7
const BASE_GAIN = 0.5

const SILL_TOP = SIGN.clear + SIGN.beamHeight
const PANEL_TOP = SILL_TOP + SIGN.panelHeight
const FRAME_TOP = PANEL_TOP + SIGN.beamHeight
const LEG_TOP = FRAME_TOP - SIGN.legDie
/** Between the posts' inner faces — what the lit face has to fit inside. */
const CLEAR_SPAN = SIGN.legHalfSpan * 2 - SIGN.legWidth
/** The carcass runs 30 mm INTO each post, so the joint has no gap and no
 *  coplanar pair; the posts are deeper than the carcass, so it is buried. */
const PANEL_WIDTH = CLEAR_SPAN + 0.06
const FACE_WIDTH = CLEAR_SPAN - SIGN.faceInset * 2
const FACE_HEIGHT = SIGN.panelHeight - SIGN.faceInset * 2
const FACE_CENTRE_Y = SILL_TOP + SIGN.panelHeight / 2

/**
 * World placement: local `(across, up, out)` → world, sign due west of the
 * plinth axis. `out` runs −X (further from the plinth), `across` runs +Z, so
 * the lit face looks +X — straight back down the formation's own bearing.
 */
function placer(): (across: number, up: number, out: number) => Vector3 {
  const { centre, deckY } = plinthAnchor()
  return (across, up, out) =>
    new Vector3(centre.x - SIGN.offset - out, deckY + up, centre.y + across)
}

/**
 * The structure: two legs on bolted base plates, a sill and a head beam, and
 * the lightbox carcass between them. Written into the park's merged slots.
 */
export function buildOptimusSign(writer: PartWriter, colliders: ColliderSpec[]): void {
  const at = placer()

  for (const side of [-1, 1]) {
    const z = side * SIGN.legHalfSpan

    // Base plate, bedded 4 mm into the marble so its underside is never in
    // the deck's own plane. The slab is 75 mm thick — there is room.
    writer.box({
      center: at(z, SIGN.basePlate / 2 - 0.004, 0),
      size: new Vector3(SIGN.legDepth + 0.12, SIGN.basePlate, SIGN.legWidth + 0.13),
      slot: 'dark',
      chamfer: 0.006,
    })
    for (const dOut of [-1, 1]) {
      for (const dAcross of [-1, 1]) {
        const head = at(
          z + dAcross * (SIGN.legWidth / 2 + 0.045),
          SIGN.basePlate,
          dOut * (SIGN.legDepth / 2 + 0.04),
        )
        writer.tube({
          path: [head.clone().setY(head.y - 0.018), head.clone().setY(head.y + 0.008)],
          radius: 0.011,
          slot: 'steel',
          radialSegments: 8,
          capEnd: true,
        })
      }
    }

    // The leg runs INTO its plate rather than sitting on it: a butt joint at
    // the plate's top face would be a coplanar pair.
    const legBase = SIGN.basePlate - 0.018
    writer.box({
      center: at(z, (legBase + LEG_TOP) / 2, 0),
      size: new Vector3(SIGN.legDepth, LEG_TOP - legBase, SIGN.legWidth),
      slot: 'aluminum',
      chamferSlot: 'steelEdge',
      chamfer: 0.014,
    })

    colliders.push({
      kind: 'box',
      center: at(z, LEG_TOP / 2, 0),
      size: new Vector3(SIGN.legDepth, LEG_TOP, SIGN.legWidth),
    })
  }

  // Sill and head beams, oversailing the legs by 0.25 m each end so the frame
  // reads as a fabricated portal rather than three pieces butted flush.
  const beamSpan = SIGN.legHalfSpan * 2 + 0.5
  for (const beamBottom of [SIGN.clear, PANEL_TOP]) {
    writer.box({
      center: at(0, beamBottom + SIGN.beamHeight / 2, 0),
      size: new Vector3(SIGN.beamDepth, SIGN.beamHeight, beamSpan),
      slot: 'aluminum',
      chamferSlot: 'steelEdge',
      chamfer: 0.012,
    })
  }

  // The lightbox carcass. Its faces sit `faceProud` BEHIND the lit quads, so
  // the two are never coplanar, and the inset leaves a dark reveal round the
  // artwork the way a real box does.
  writer.box({
    center: at(0, FACE_CENTRE_Y, 0),
    size: new Vector3(SIGN.panelDepth, SIGN.panelHeight, PANEL_WIDTH),
    slot: 'dark',
    chamfer: 0.008,
  })
}

/**
 * The two lit faces, as one merged mesh. Separate from the structure because
 * it is the only thing in the park that needs an image file: the texture is
 * awaited, so no frame can rasterise an undecoded map.
 */
export async function loadOptimusSignFaces(): Promise<Mesh> {
  const map = await new TextureLoader().loadAsync(logoUrl)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 8

  const at = placer()
  // Show a horizontal band of the source at its TRUE pixel aspect: the
  // artwork is a wide neon strip on a tall black field, and stretching the
  // whole image onto a 2.8:1 panel would squash the mark.
  const halfV = (0.5 * LOGO_ASPECT) / (FACE_WIDTH / FACE_HEIGHT)
  const v0 = LOGO_V_CENTRE - halfV
  const v1 = LOGO_V_CENTRE + halfV

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  // +1 looks east, down the formation's bearing; −1 looks west, for anyone
  // arriving up the flight beneath it.
  for (const side of [1, -1]) {
    const out = -side * (SIGN.panelDepth / 2 + SIGN.faceProud)
    // Screen-right for a viewer facing this side is −side·Z, so `across` runs
    // the opposite way from u. Get this backwards and the mark reads mirrored.
    const corner = (u: number, v: number): Vector3 =>
      at(-side * (u - 0.5) * FACE_WIDTH, FACE_CENTRE_Y + (v - 0.5) * FACE_HEIGHT, out)
    const quad: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1],
    ]
    for (const [u, v] of quad) {
      const p = corner(u, v)
      positions.push(p.x, p.y, p.z)
      normals.push(side, 0, 0)
      uvs.push(u, v0 + v * (v1 - v0))
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))

  const material = new MeshStandardNodeMaterial()
  const art = textureNode(map)
  // The artwork already has a glow HALO painted into it, so emitting it flat
  // double-counts: the halo clears the bloom threshold across its full width,
  // the renderer spreads that again, and the letter counters fill in until
  // the panel is a white slab. Only the strokes are allowed over the line.
  const lum = art.r.mul(0.2126).add(art.g.mul(0.7152)).add(art.b.mul(0.0722))
  const core = smoothstep(CORE_LOW, CORE_HIGH, lum)
  material.emissiveNode = art.rgb.mul(
    core.mul(CORE_GAIN).add(lum.mul(BASE_GAIN)),
  ) as unknown as Node<'vec3'>
  // Diffuse is the panel, not the sign: a dark acrylic face that happens to
  // be lighter where the tubes are printed.
  material.colorNode = art.rgb.mul(0.22) as unknown as Node<'vec3'>
  material.roughness = 0.34
  material.metalness = 0

  const mesh = new Mesh(geometry, material)
  // Emissive geometry must not cast (notes.md): a lightbox face throwing a
  // shadow of its own glow is a contradiction the cached maps cannot express.
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.name = 'optimus:marque'
  return mesh
}
