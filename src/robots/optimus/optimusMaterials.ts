/**
 * setup.py materials — Blender Principled BSDF -> MeshPhysicalNodeMaterial.
 *
 * Every constant is the reference build's. The park's own `applySpecularAA`
 * is deliberately NOT applied here: these materials are the demo's, and the
 * figure is a display exhibit whose look is meant to match it exactly.
 */
import { Color, FrontSide, LinearSRGBColorSpace } from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { smoothstep, uniform, vec3 } from 'three/tsl'
import { noiseBump, roughVar } from '../../procgen/blenderkit/blenderNoise'

type AnyNodeMaterial = MeshPhysicalNodeMaterial | MeshStandardNodeMaterial

/**
 * Park simulation seconds, driving the visor pulse. Driven by
 * `robots/optimusExhibit.ts`; a uniform rather than TSL's own `time` so the
 * eight visors stop when the park does — a pause menu over a scene that is
 * still breathing reads as a bug.
 */
export const optimusLedClock = /*@__PURE__*/ uniform(0)

/** Seconds for one full off → on → off breath. */
export const LED_PERIOD = 2.0

interface PrincipledSpec {
  base: [number, number, number]
  metallic?: number
  rough?: number
  ior?: number
  spec?: number
  coat?: number
  coatRough?: number
  sheen?: number
  sheenRough?: number
  sheenTint?: [number, number, number]
  roughNode?: MeshPhysicalNodeMaterial['roughnessNode']
  normalNode?: MeshPhysicalNodeMaterial['normalNode']
}

/* ---- material construction --------------------------------------------- */

export const lin = (r: number, g: number, b: number): Color => new Color().setRGB(r, g, b, LinearSRGBColorSpace);

/* Blender "Specular IOR Level" 0.5 is neutral; three's specularIntensity 1.0 */
export const specLevel = (v: number): number => v / 0.5;

export const MATS: Record<string, AnyNodeMaterial> = {};

export function principled(name: string, o: PrincipledSpec): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial();
  m.name = name;
  m.color = lin(o.base[0], o.base[1], o.base[2]);
  m.metalness = o.metallic ?? 0.0;
  m.roughness = o.rough ?? 0.5;
  if (o.ior !== undefined) m.ior = o.ior;
  m.specularIntensity = specLevel(o.spec ?? 0.5);
  if (o.coat) { m.clearcoat = o.coat; m.clearcoatRoughness = o.coatRough ?? 0.03; }
  if (o.sheen) {
    m.sheen = o.sheen;
    m.sheenRoughness = o.sheenRough ?? 0.3;
    m.sheenColor = o.sheenTint ? lin(o.sheenTint[0], o.sheenTint[1], o.sheenTint[2]) : lin(1, 1, 1);
  }
  if (o.roughNode) m.roughnessNode = o.roughNode;
  if (o.normalNode) m.normalNode = o.normalNode;
  m.side = FrontSide;
  MATS[name] = m;
  return m;
}

export function buildMaterials(): Record<string, AnyNodeMaterial> {
  /* M_SHELL -- satin off-white painted composite */
  principled('M_SHELL', {
    base: [0.828, 0.816, 0.796], metallic: 0.0, rough: 0.34, ior: 1.47, spec: 0.5,
    coat: 0.26, coatRough: 0.22, sheen: 0.05, sheenRough: 0.45,
    roughNode: roughVar(0.335, 0.045, 9.0),
    normalNode: noiseBump(520.0, 6.0, 0.045, 0.6),
  });

  /* M_SHELL_LEG -- slightly cooler / brighter white used on the legs */
  principled('M_SHELL_LEG', {
    base: [0.858, 0.854, 0.846], rough: 0.36, coat: 0.22, coatRough: 0.24,
    sheen: 0.06, sheenRough: 0.5,
    roughNode: roughVar(0.355, 0.04, 8.0),
    normalNode: noiseBump(520.0, 6.0, 0.045, 0.55),
  });

  /* M_BLACK -- matte soft-touch black polymer */
  principled('M_BLACK', {
    base: [0.0165, 0.0165, 0.0185], metallic: 0.0, rough: 0.46, spec: 0.42,
    sheen: 0.25, sheenRough: 0.35, sheenTint: [0.30, 0.31, 0.34],
    roughNode: roughVar(0.455, 0.05, 12.0),
    normalNode: noiseBump(700.0, 6.0, 0.06, 0.6),
  });

  /* M_GLOSSBLACK -- piano black (unused by the current parts, kept for parity) */
  principled('M_GLOSSBLACK', {
    base: [0.0075, 0.0075, 0.0090], metallic: 0.0, rough: 0.055, ior: 1.52,
    coat: 1.0, coatRough: 0.025,
  });

  /* M_VISOR -- glossy smoked glass over the sensor suite */
  principled('M_VISOR', {
    base: [0.0042, 0.0045, 0.0058], metallic: 0.0, rough: 0.018, ior: 1.58,
    spec: 0.62, coat: 1.0, coatRough: 0.008,
  });

  /* M_HELMET -- matte black composite rear hood */
  principled('M_HELMET', {
    base: [0.0175, 0.0178, 0.0196], metallic: 0.0, rough: 0.52, ior: 1.46,
    spec: 0.36, sheen: 0.28, sheenRough: 0.32, sheenTint: [0.30, 0.31, 0.35],
    roughNode: roughVar(0.52, 0.045, 16.0),
    normalNode: noiseBump(820.0, 7.0, 0.07, 0.6),
  });

  /* M_LED */
  {
    const m = new MeshStandardNodeMaterial();
    m.name = 'M_LED';
    m.color = lin(0, 0, 0);
    m.roughness = 0.4;
    m.emissive = lin(0.03, 0.72, 1.0);
    m.emissiveIntensity = 11.0;
    /* DELIBERATE DEVIATION from the reference (owner request): the visor
       breathes instead of burning. A triangle over LED_PERIOD — one second
       dark-to-lit, one second back — eased at both ends so the turn is soft
       rather than a corner. The colour and the 11.0 peak are the demo's, so
       the fully-lit frame is exactly the reference's look; `emissiveNode`
       replaces `emissive * emissiveIntensity` outright, which is why the
       peak is folded into the node. */
    const phase = optimusLedClock.div(LED_PERIOD).fract();
    const triangle = phase.mul(2).sub(1).abs().oneMinus();
    m.emissiveNode = vec3(0.03, 0.72, 1.0)
      .mul(11.0)
      .mul(smoothstep(0, 1, triangle)) as unknown as Node<'vec3'>;
    MATS.M_LED = m;
  }

  /* M_DARKMECH -- cast / anodised dark-grey structural mechanism */
  principled('M_DARKMECH', {
    base: [0.0295, 0.0300, 0.0325], metallic: 0.72, rough: 0.42,
    roughNode: roughVar(0.42, 0.07, 55.0),
    normalNode: noiseBump(900.0, 8.0, 0.12, 0.7),
  });

  /* M_ALU -- machined light aluminium */
  principled('M_ALU', {
    base: [0.560, 0.562, 0.570], metallic: 1.0, rough: 0.26,
    roughNode: roughVar(0.26, 0.05, 90.0),
    normalNode: noiseBump(1400.0, 6.0, 0.08, 0.55),
  });

  /* M_STEEL -- polished actuator rod */
  principled('M_STEEL', { base: [0.540, 0.548, 0.565], metallic: 1.0, rough: 0.10 });

  /* M_RUBBER -- elbow / knee pad */
  principled('M_RUBBER', {
    base: [0.0130, 0.0132, 0.0150], rough: 0.60, spec: 0.35,
    sheen: 0.35, sheenRough: 0.30, sheenTint: [0.26, 0.27, 0.30],
    normalNode: noiseBump(340.0, 8.0, 0.18, 0.7),
  });

  /* M_FOOT -- moulded charcoal sole / boot */
  principled('M_FOOT', {
    base: [0.0400, 0.0410, 0.0450], rough: 0.52, spec: 0.4, sheen: 0.18, sheenRough: 0.5,
    roughNode: roughVar(0.52, 0.06, 30.0),
    normalNode: noiseBump(450.0, 8.0, 0.13, 0.55),
  });

  /* M_LOGO */
  principled('M_LOGO', { base: [0.055, 0.054, 0.053], rough: 0.42, metallic: 0.0 });

  /* M_DARKGREY -- mid dark grey plastic for small covers */
  principled('M_DARKGREY', {
    base: [0.075, 0.076, 0.082], rough: 0.40, metallic: 0.25,
    normalNode: noiseBump(800.0, 6.0, 0.07, 0.55),
  });

  return MATS;
}
