import {
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import {
  dFdx,
  dFdy,
  faceDirection,
  float,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalView,
  normalWorld,
  oneMinus,
  positionView,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { RenderPipelineSystem } from '../render/pipeline'
import { applyMarsAerialPerspective } from './marsAerialPerspective'
import { TERRAIN_INNER_RADIUS, exteriorHeight, mountainMask } from './terrainHeight'

/**
 * Everything beyond the glass: the valley floor and its mountain ring out to
 * ~13.5 km, boulder fields and mountain-foot talus, and the screen-space Mars
 * aerial medium wired into the pipeline. No colliders — the dome wall is the
 * physical boundary.
 *
 * The terrain is ONE radially-graded polar mesh, not a stack of concentric
 * ring meshes. Vertex density follows a spacing schedule (9 m at the dome
 * apron, 17 m through the mountain band, 270 m at the horizon), which is the
 * same LOD idea without any ring-to-ring seams to crack: every row shares a
 * radius with its neighbours by construction, the angular column count is
 * constant, and the angular seam is closed by index wrap rather than by a
 * duplicated column.
 *
 * Normals come from that same grid (one height evaluation per vertex instead
 * of five) — the field is expensive enough that finite-differencing each
 * vertex independently would cost seconds of boot time.
 */
export class ExteriorSystem implements GameSystem {
  readonly id = 'exterior'
  private readonly group = new Group()
  private readonly pipeline: RenderPipelineSystem

  constructor(pipeline: RenderPipelineSystem) {
    this.pipeline = pipeline
  }

  init(ctx: GameContext): void {
    const { scene, camera } = ctx

    // ---- Aerial medium: one continuous dust atmosphere, screen-space.
    const projectionInverse = uniform(camera.projectionMatrixInverse)
    this.pipeline.hdrTransform = (hdrColor, extras) => {
      const input = hdrColor as Node<'vec4'>
      const { color, amount } = applyMarsAerialPerspective(
        input.rgb,
        extras.viewZNode as Node<'float'>,
        extras.sceneDepthNode as Node<'float'>,
        projectionInverse as unknown as Node<'mat4'>,
      )
      // ?pass=haze: raw fog amount (red = negative, green = 0..1 scale).
      this.pipeline.debugNodes.haze = vec4(
        (amount as unknown as ReturnType<typeof float>).negate().max(0).mul(4),
        (amount as unknown as ReturnType<typeof float>).max(0),
        0,
        1,
      )
      return vec4(color, input.a)
    }

    // ---- The valley: one graded polar mesh from the park floor edge out.
    const terrain = new Mesh(buildValleyGeometry(), createValleyMaterial())
    terrain.receiveShadow = false
    terrain.castShadow = false
    // Everything is inside the mesh's own radius, so the bounding sphere test
    // is worthless and the sort key is meaningless — draw it first, always.
    terrain.frustumCulled = false
    terrain.renderOrder = -50
    this.group.add(terrain)

    // ---- Boulder fields: valley floor scatter + talus at the mountain feet.
    this.buildBoulders(ctx)

    // No dust devils: the drifting translucent columns read as moving beams
    // of light through the glass whenever one crossed the valley near the
    // dome (owner report), and an unlit billboard tornado has no honest fix
    // at that distance. The valley's weather is the aerial dust medium.

    scene.add(this.group)
  }

  /**
   * Boulders are placed by CAUSE, not by uniform scatter: loose fields on the
   * valley floor (clustered, so there are bare stretches to walk toward), and
   * talus aprons wherever the mountain envelope is at its feet. The graded
   * spaceport corridor stays swept clear.
   */
  private buildBoulders(ctx: GameContext): void {
    const rng = ctx.rng.fork('exterior/boulders')
    const density = ctx.quality.params.scatterDensity
    const lodRadius = ctx.quality.params.exteriorDetailRadius
    const near: number[] = []
    const far: number[] = []
    const push = (x: number, z: number, size: number): void => {
      const r = Math.hypot(x, z)
      // The apron outside the glass was cleared: only cobbles survive close
      // in, and the block size ceiling rises with distance. Without this the
      // dome is ringed by 6 m boulders standing 20 m from the promenade.
      const ceiling = 0.4 + Math.max(0, r - TERRAIN_INNER_RADIUS) * 0.022
      const capped = Math.min(size, ceiling)
      const target = capped > 0.9 || r < lodRadius ? near : far
      target.push(x, z, capped, rng.float(), rng.float(), rng.float(), rng.float())
    }

    const floorCount = Math.round(2600 * density)
    for (let i = 0; i < floorCount; i++) {
      let x = 0
      let z = 0
      for (let attempt = 0; attempt < 8; attempt++) {
        const t = rng.float()
        const r = TERRAIN_INNER_RADIUS + 6 + 1180 * t * t
        const angle = rng.float() * Math.PI * 2
        x = Math.cos(angle) * r
        z = Math.sin(angle) * r
        // Clustered fields: bare regolith between rubble aprons.
        const cluster = 0.5 + 0.5 * Math.sin(x * 0.0121 + z * 0.0074) * Math.cos(z * 0.0093 - x * 0.0051)
        if (rng.float() > 0.24 + cluster * 0.86) continue
        if (Math.abs(x) < 58 && z > 118 && z < 760) continue
        break
      }
      if (Math.abs(x) < 58 && z > 118 && z < 760) continue
      // Mostly cobbles, a rare hero block.
      const roll = rng.float()
      const size = roll > 0.985 ? 3.6 + rng.float() * 4.4 : 0.32 + roll * roll * 3.1
      push(x, z, size)
    }

    // Talus: dense rubble where the mountain envelope is just lifting off the
    // valley floor, thinning as the slope steepens into bare rock.
    const talusCount = Math.round(3400 * density)
    for (let i = 0; i < talusCount; i++) {
      let x = 0
      let z = 0
      let placed = false
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = 460 + rng.float() * 2450
        const angle = rng.float() * Math.PI * 2
        x = Math.cos(angle) * r
        z = Math.sin(angle) * r
        const mask = mountainMask(x, z)
        // Peak probability right at the foot of the slope.
        const weight = mask < 0.02 ? 0 : Math.max(0, 1 - Math.abs(mask - 0.22) / 0.34)
        if (rng.float() < weight) {
          placed = true
          break
        }
      }
      if (!placed) continue
      if (Math.abs(x) < 70 && z > 118 && z < 900) continue
      const roll = rng.float()
      push(x, z, 0.5 + roll * roll * 4.2)
    }

    const rockMaterial = createRockMaterial()
    const matrix = new Matrix4()
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const axis = new Vector3()
    const emit = (data: number[], detail: number, variants: number): void => {
      const count = data.length / 7
      if (count === 0) return
      const perVariant = Math.ceil(count / variants)
      const meshes: InstancedMesh[] = []
      for (let v = 0; v < variants; v++) {
        meshes.push(new InstancedMesh(deformedRock(v + 1, detail), rockMaterial, perVariant))
      }
      const written = new Array<number>(variants).fill(0)
      for (let i = 0; i < count; i++) {
        const x = data[i * 7]
        const z = data[i * 7 + 1]
        const size = data[i * 7 + 2]
        const v = i % variants
        axis
          .set(data[i * 7 + 3] - 0.5, data[i * 7 + 4] - 0.5, data[i * 7 + 5] - 0.5)
          .normalize()
        rotation.setFromAxisAngle(axis, data[i * 7 + 6] * Math.PI * 2)
        // Seated, not perched: sink a third of the block into the regolith.
        position.set(x, exteriorHeight(x, z) - size * 0.3, z)
        scale.set(
          size * (0.82 + data[i * 7 + 3] * 0.42),
          size * (0.62 + data[i * 7 + 4] * 0.48),
          size * (0.86 + data[i * 7 + 5] * 0.34),
        )
        matrix.compose(position, rotation, scale)
        meshes[v].setMatrixAt(written[v]++, matrix)
      }
      for (let v = 0; v < variants; v++) {
        // Unused tail instances would render as a rock at the origin.
        meshes[v].count = written[v]
        meshes[v].instanceMatrix.needsUpdate = true
        meshes[v].castShadow = false
        meshes[v].receiveShadow = false
        this.group.add(meshes[v])
      }
    }
    emit(near, 2, 4)
    emit(far, 1, 3)
  }

  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group)
  }
}

/** Angular resolution of the whole valley mesh (one count = no seams). */
const VALLEY_COLUMNS = 896
const VALLEY_OUTER_RADIUS = 13500

/**
 * Radial vertex spacing schedule. Fine where the player stands next to it,
 * ~17 m through the mountain band (matching the angular spacing at 2.4 km, so
 * ridge triangles stay near-equilateral where the silhouette is judged), then
 * opening out fast into ground that never leaves the haze.
 */
function ringSpacing(r: number): number {
  if (r < 620) return 9 + (r - TERRAIN_INNER_RADIUS) * 0.012
  if (r < 1250) return 14.9 + (r - 620) * 0.003
  if (r < 4500) return 16.8
  if (r < 7500) return 16.8 + (r - 4500) * 0.014
  return 58.8 + (r - 7500) * 0.035
}

function buildRadiusTable(): Float64Array {
  const radii: number[] = [TERRAIN_INNER_RADIUS]
  let r = TERRAIN_INNER_RADIUS
  while (r < VALLEY_OUTER_RADIUS) {
    r += ringSpacing(r)
    radii.push(r)
  }
  return Float64Array.from(radii)
}

/**
 * The valley mesh. Heights are sampled on a padded grid (one extra row inside
 * and outside) so every emitted vertex gets a true central-difference normal
 * from its own neighbours — exact, continuous, and one field evaluation per
 * vertex.
 */
function buildValleyGeometry(): BufferGeometry {
  const radii = buildRadiusTable()
  const rows = radii.length
  const columns = VALLEY_COLUMNS
  const angleStep = (Math.PI * 2) / columns

  const cosA = new Float64Array(columns)
  const sinA = new Float64Array(columns)
  for (let j = 0; j < columns; j++) {
    const angle = j * angleStep
    cosA[j] = Math.cos(angle)
    sinA[j] = Math.sin(angle)
  }

  // Padded radius list: index 0 and rows+1 exist only to give the first and
  // last emitted rows a neighbour to difference against.
  const paddedRadius = (i: number): number => {
    if (i === 0) return radii[0] - (radii[1] - radii[0])
    if (i === rows + 1) return radii[rows - 1] + (radii[rows - 1] - radii[rows - 2])
    return radii[i - 1]
  }

  const heights = new Float32Array((rows + 2) * columns)
  for (let i = 0; i < rows + 2; i++) {
    const r = paddedRadius(i)
    const base = i * columns
    for (let j = 0; j < columns; j++) {
      heights[base + j] = exteriorHeight(cosA[j] * r, sinA[j] * r)
    }
  }

  const vertexCount = rows * columns
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  for (let i = 0; i < rows; i++) {
    const r = radii[i]
    const rInner = paddedRadius(i)
    const rOuter = paddedRadius(i + 2)
    const radialSpan = rOuter - rInner
    const inner = i * columns
    const center = (i + 1) * columns
    const outer = (i + 2) * columns
    const tangentialSpan = 2 * r * angleStep
    for (let j = 0; j < columns; j++) {
      const left = j === 0 ? columns - 1 : j - 1
      const right = j === columns - 1 ? 0 : j + 1
      const height = heights[center + j]
      const slopeRadial = (heights[outer + j] - heights[inner + j]) / radialSpan
      const slopeTangential = (heights[center + right] - heights[center + left]) / tangentialSpan
      const gradientX = slopeRadial * cosA[j] - slopeTangential * sinA[j]
      const gradientZ = slopeRadial * sinA[j] + slopeTangential * cosA[j]
      const inverseLength = 1 / Math.sqrt(gradientX * gradientX + 1 + gradientZ * gradientZ)
      const v = (i * columns + j) * 3
      positions[v] = cosA[j] * r
      positions[v + 1] = height
      positions[v + 2] = sinA[j] * r
      normals[v] = -gradientX * inverseLength
      normals[v + 1] = inverseLength
      normals[v + 2] = -gradientZ * inverseLength
    }
  }

  const indices = new Uint32Array((rows - 1) * columns * 6)
  let cursor = 0
  for (let i = 0; i < rows - 1; i++) {
    const thisRow = i * columns
    const nextRow = (i + 1) * columns
    for (let j = 0; j < columns; j++) {
      const jn = j === columns - 1 ? 0 : j + 1
      const a = thisRow + j
      const b = thisRow + jn
      const c = nextRow + j
      const d = nextRow + jn
      // Winding: (v1−v0)×(v2−v0) must point +Y for an upward face. With
      // a=(row,col), b=(row,col+1) tangential and c=(row+1,col) radial, that
      // is (a,b,c)/(b,d,c) — the (a,c,b) order used elsewhere in the project
      // faces DOWN and gets back-face culled.
      indices[cursor++] = a
      indices[cursor++] = b
      indices[cursor++] = c
      indices[cursor++] = b
      indices[cursor++] = d
      indices[cursor++] = c
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/**
 * Icosahedron pushed around by layered sine hashes — reads as fractured
 * basalt. Two scales of deformation plus a flattened base so blocks sit
 * rather than float.
 */
function deformedRock(seed: number, detail: number): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, detail)
  const positionAttribute = geometry.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < positionAttribute.count; i++) {
    v.fromBufferAttribute(positionAttribute, i)
    const coarse =
      Math.sin(v.x * 3.1 + seed * 11.7) * 0.17 +
      Math.sin(v.y * 4.7 + seed * 5.3) * 0.13 +
      Math.sin(v.z * 3.9 + seed * 7.9) * 0.15
    const fine =
      Math.sin(v.x * 11.3 - seed * 3.1) * 0.055 +
      Math.sin(v.z * 9.7 + seed * 13.3) * 0.048
    v.multiplyScalar(1 + coarse + fine * (detail > 1 ? 1 : 0.4))
    // Bedded base: the underside is flattened where it beds into regolith.
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.42
    positionAttribute.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Screen-space surface-gradient bump from an arbitrary procedural height
 * node (Mikkelsen's method, the same math three's `bumpMap` uses).
 *
 * `bumpMap()` itself CANNOT be used here: it re-samples its input through a
 * texture UV context (`textureNode.context({ getUV })`), so a procedural node
 * with no `uvNode` returns the identical value for all three taps, the
 * derivative comes out zero, and the node silently returns the untouched
 * geometric normal. Every band we fed it was being discarded.
 */
function proceduralBump(height: Node<'float'>, scale: Node<'float'>): Node<'vec3'> {
  const dHdx = dFdx(height).mul(scale)
  const dHdy = dFdy(height).mul(scale)
  const sigmaX = dFdx(positionView).normalize()
  const sigmaY = dFdy(positionView).normalize()
  const r1 = sigmaY.cross(normalView)
  const r2 = normalView.cross(sigmaX)
  const determinant = sigmaX.dot(r1).mul(faceDirection)
  const gradient = determinant.sign().mul(dHdx.mul(r1).add(dHdy.mul(r2)))
  return determinant.abs().mul(normalView).sub(gradient).normalize()
}

/**
 * The valley surface material. Everything here is caused by two fields —
 * SLOPE (from the height field's own normals) and world position — so albedo,
 * strata, streaks, and bump can never disagree about where rock is.
 *
 * Layers, flat to vertical:
 *   dusty regolith → oxide patch streaks → scree/talus mottle → bedrock with
 *   horizontal strata → dark slope streaks (the dust avalanches that make a
 *   Martian escarpment unmistakable).
 *
 * Every high-frequency band — including the thresholded ones — is weighted by
 * its projected pixel footprint, or it aliases into stipple and shimmer.
 */
function createValleyMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const worldXZ = vec2(positionWorld.x, positionWorld.z)

  // Band filtering is by PIXEL FOOTPRINT, not by distance. A plain distance
  // fade is wrong twice over: it strips detail off a 2 km ridge face that
  // still covers hundreds of pixels (the mountains came out as smooth
  // origami), and it keeps detail on a valley floor 200 m away that the
  // grazing view compresses to nothing. `dFdx/dFdy(positionWorld)` gives the
  // world size of one pixel directly, which handles distance and grazing
  // angle in one number.
  // Reversed-edge smoothstep is undefined in WGSL — every fade is written as
  // oneMinus(smoothstep(near, far, x)).
  const footprintX = dFdx(positionWorld).length()
  const footprintY = dFdy(positionWorld).length()
  // WORST axis, not the geometric mean. The mean is the pixel's ground AREA,
  // and it knowingly under-filters the stretched axis — on the flat apron
  // seen from eye height the along-view footprint is metres while the
  // across-view is centimetres, so the metre-scale bands rendered far past
  // Nyquist in one direction and crawled as moiré whenever the camera moved
  // (owner finding). A single procedural tap cannot anisotropically filter,
  // so the only honest answer at grazing is to fade the band out — which is
  // what real anisotropic ground does to the eye anyway. Face-on slopes have
  // max ≈ mean, so the mountains keep their detail exactly as before.
  const footprint = footprintX.max(footprintY)
  // The fade still spans a wide band (×4.7): `positionWorld`'s derivative is
  // a per-TRIANGLE constant, and a hard cut makes the weight jump between
  // neighbouring triangles as stippled rows. But it must be mostly closed by
  // Nyquist (0.5λ) or the surviving contribution shimmers: 0.15λ → 0.7λ
  // leaves 28% at Nyquist, gone entirely by 0.7λ.
  const bandWeight = (wavelength: number): Node<'float'> =>
    oneMinus(smoothstep(wavelength * 0.15, wavelength * 0.7, footprint))
  const weightMicro = bandWeight(1.55)
  const weightGravel = bandWeight(3.1)
  const weightFine = bandWeight(8.3)
  const weightBlocks = bandWeight(34)
  const weightPatch = bandWeight(41)

  const macro = mx_noise_float(worldXZ.mul(1 / 760)).mul(0.5).add(0.5)
  const meso = mx_noise_float(worldXZ.mul(1 / 173).add(31.7)).mul(0.5).add(0.5)
  const patch = mx_noise_float(worldXZ.mul(1 / 41).add(77.3)).mul(0.5).add(0.5)
  const fine = mx_noise_float(worldXZ.mul(1 / 8.3).add(11.9)).mul(0.5).add(0.5)
  const micro = mx_noise_float(worldXZ.mul(1 / 1.55).add(53.1)).mul(0.5).add(0.5)
  // Cellular bands do the work Perlin cannot: a gravel lag of loose stones
  // over the fines, and blocky fracture on bedrock. Without them the whole
  // valley reads as sculpted clay however many Perlin octaves are stacked.
  const gravel = mx_worley_noise_float(worldXZ.mul(1 / 3.1), 1)
  const blocks = mx_worley_noise_float(positionWorld.mul(1 / 23), 1)

  const slope = oneMinus(normalWorld.y.clamp(0, 1))
  const flatMask = oneMinus(smoothstep(0.06, 0.22, slope))
  const screeMask = smoothstep(0.1, 0.3, slope).mul(oneMinus(smoothstep(0.38, 0.72, slope)))
  const cliffMask = smoothstep(0.34, 0.66, slope)

  // Horizontal strata: phase is world Y so the bands stay level across a
  // whole massif; the phase drifts slowly with position so neighbouring
  // fault blocks are offset instead of banding as one continuous layer cake.
  const strataPhase = positionWorld.y
    .mul(0.098)
    .add(mx_noise_float(worldXZ.mul(1 / 1900)).mul(4.1))
    .add(mx_noise_float(worldXZ.mul(1 / 430)).mul(1.35))
  const strata = sin(strataPhase)
    .mul(0.5)
    .add(0.5)
    .mul(0.62)
    .add(
      sin(strataPhase.mul(2.37).add(1.1)).mul(0.5).add(0.5).mul(0.38).mul(bandWeight(27)),
    )

  // Slope streaks: dust avalanche tracks, stretched along the fall line by
  // sampling the noise with a compressed vertical axis.
  const streak = mx_noise_float(
    vec3(positionWorld.x.mul(0.052), positionWorld.y.mul(0.0055), positionWorld.z.mul(0.052)),
  )
    .mul(0.5)
    .add(0.5)
  // Streaks are ~19 m across; unfiltered they stippled every distant shadowed
  // face. Any band with a hard threshold needs its footprint weight too.
  const streakMask = smoothstep(0.52, 0.86, streak)
    .mul(cliffMask.add(screeMask).clamp(0, 1))
    .mul(bandWeight(19))

  // Mars regolith is DARK: bond albedo ~0.15–0.25. The first pass sat near
  // 0.45 and the mountains rendered brighter than the sky they stand against
  // — the opposite of the reference. Reds stay well separated from green/blue
  // so the rock reads rusty rather than beige.
  const regolith = vec3(0.262, 0.157, 0.096)
  const dustBright = vec3(0.375, 0.234, 0.138)
  const oxide = vec3(0.336, 0.14, 0.072)
  const rockPale = vec3(0.228, 0.17, 0.126)
  const rockDark = vec3(0.096, 0.07, 0.054)

  let color = mix(regolith, dustBright, macro.mul(0.6).add(meso.mul(0.3)).clamp(0, 1))
  // Oxide staining pools on the flats and in the lee of the dunes.
  color = mix(color, oxide, patch.pow(1.6).mul(0.42).mul(flatMask))
  // Bedrock with strata on the steep faces.
  color = mix(color, mix(rockDark, rockPale, strata), cliffMask.mul(0.94))
  // Scree: broken rock and fines mixed, mottled at patch scale.
  color = mix(color, mix(rockDark, regolith, patch.mul(0.7).add(0.15)), screeMask.mul(0.68))
  // Dark avalanche streaks.
  color = color.mul(mix(float(1), float(0.55), streakMask))
  // Gravel lag on anything not vertical; blocky fracture on bedrock. The lag
  // is PATCHY — a uniform cellular band at full contrast tiles the valley in
  // cobblestones, which is worse than no detail at all.
  const lagField = weightGravel.mul(oneMinus(cliffMask)).mul(smoothstep(0.3, 0.72, patch).mul(0.75).add(0.25))
  color = color.mul(mix(float(1), gravel.pow(1.5).mul(0.34).add(0.86), lagField))
  color = color.mul(
    mix(float(1), blocks.mul(0.34).add(0.85), weightBlocks.mul(cliffMask.add(screeMask).clamp(0, 1))),
  )
  // Grain, only while its footprint is bigger than a pixel.
  color = color.mul(
    oneMinus(fine.mul(0.19).mul(weightFine)).sub(micro.mul(0.12).mul(weightMicro)),
  )
  material.colorNode = color

  // Bump from the SAME bands that drive albedo, distance-weighted the same
  // way — a normal detail that outlives its albedo would read as plastic.
  const bumpField = meso
    .mul(0.7)
    .add(patch.mul(0.6).mul(weightPatch))
    .add(blocks.mul(0.22).mul(weightBlocks))
    .add(fine.mul(0.52).mul(weightFine))
    .add(gravel.mul(0.18).mul(lagField))
    .add(micro.mul(0.22).mul(weightMicro))
  material.normalNode = proceduralBump(bumpField, float(1.5).add(cliffMask.mul(1.2)))

  material.roughnessNode = mix(float(0.955), float(0.845), cliffMask)
    .sub(fine.mul(0.05).mul(weightFine))
    .sub(streakMask.mul(0.04))
  material.metalness = 0
  return material
}

function createRockMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial()
  const dustTop = smoothstep(0.35, 0.85, normalWorld.y)
  const grain = mx_noise_float(positionWorld.xz.mul(0.8)).mul(0.5).add(0.5)
  const facet = mx_noise_float(positionWorld.mul(0.28)).mul(0.5).add(0.5)
  material.colorNode = mix(
    vec3(0.108, 0.079, 0.062),
    vec3(0.3, 0.192, 0.118),
    dustTop.mul(0.72).add(grain.mul(0.12)).add(facet.mul(0.1)),
  )
  material.roughnessNode = float(0.93).sub(facet.mul(0.06))
  material.metalness = 0
  return material
}
