import {
  HalfFloatType,
  LinearFilter,
  RedFormat,
  Vector2,
} from 'three'
import type { PerspectiveCamera } from 'three'
import {
  NodeMaterial,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  TempNode,
} from 'three/webgpu'
import type {
  Node,
  NodeBuilder,
  NodeFrame,
  PassNode,
  TextureNode,
} from 'three/webgpu'
import {
  PI,
  Fn,
  If,
  acos,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  getScreenPosition,
  getViewPosition,
  interleavedGradientNoise,
  inverseSqrt,
  max,
  mix,
  NodeUpdateType,
  passTexture,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl'

const SLICE_COUNT = 6
const STEP_COUNT = 3
const DEPTH_SKY_EPSILON = 1e-7
const DEPTH_NEAR_LIMIT = 0.999999

type RendererState = Parameters<typeof RendererUtils.restoreRendererState>[1]

/**
 * Stable, denoised GTAO visibility for the park's reversed-Z WebGPU path.
 *
 * Three r185's stock GTAO uses three slice directions for the configured
 * sample count, repeats a 5x5 rotation texture, writes to R8, and exposes the
 * raw gather. Those choices make its directional error coherent enough to
 * become screen-space bars under the park's wide-radius, back-lit setup.
 *
 * This node keeps the same cosine-weighted GTAO integral and tap budget, but
 * distributes the taps over six slices, uses non-repeating screen-space
 * rotation, writes R16F, and owns a separable depth/normal-aware denoise.
 * Visibility is scalar and follows the contract 1=open, 0=occluded.
 */
export class GtaoVisibilityNode extends TempNode<'float'> {
  readonly radius = uniform(0.9)
  readonly thickness = uniform(0.35)
  readonly power = uniform(2)
  readonly distanceExponent = uniform(2)
  readonly resolution = uniform(new Vector2())
  readonly projectionScale = uniform(new Vector2())

  resolutionScale = 0.5

  readonly depthNode: TextureNode
  readonly normalNode: TextureNode
  readonly camera: PerspectiveCamera

  private readonly projection: Node<'mat4'>
  private readonly projectionInverse: Node<'mat4'>
  private readonly filterDirection = uniform(new Vector2())
  private readonly drawingBufferSize = new Vector2()
  private readonly quad = new QuadMesh()

  private readonly rawTarget = this.makeTarget('ParkGTAO.raw')
  private readonly horizontalTarget = this.makeTarget('ParkGTAO.horizontal')
  private readonly filteredTarget = this.makeTarget('ParkGTAO.filtered')
  private readonly rawPass = passTexture(
    this as unknown as PassNode,
    this.rawTarget.texture,
  )
  private readonly filteredPass = passTexture(
    this as unknown as PassNode,
    this.filteredTarget.texture,
  )
  private readonly filterInput = texture(this.rawTarget.texture)

  private readonly rawMaterial = new NodeMaterial()
  private readonly filterMaterial = new NodeMaterial()
  private rendererState = {} as RendererState

  constructor(
    depthNode: TextureNode,
    normalNode: TextureNode,
    camera: PerspectiveCamera,
  ) {
    super('float')
    this.depthNode = depthNode
    this.normalNode = normalNode
    this.camera = camera
    this.projection = uniform(camera.projectionMatrix) as unknown as Node<'mat4'>
    this.projectionInverse = uniform(camera.projectionMatrixInverse) as unknown as Node<'mat4'>
    this.updateBeforeType = NodeUpdateType.FRAME
    this.rawMaterial.name = 'Park GTAO gather'
    this.filterMaterial.name = 'Park GTAO bilateral denoise'
  }

  getTextureNode() {
    return this.filteredPass
  }

  getRawTextureNode() {
    return this.rawPass
  }

  /** Vertical world-radius projection in AO-buffer texels. */
  projectedRadiusPixels(viewZ: Node<'float'>): Node<'float'> {
    return this.radius
      .mul(this.projectionScale.y)
      .mul(0.5)
      .mul(this.resolution.y)
      .div(max(viewZ.negate(), 0.0001))
  }

  setSize(width: number, height: number): void {
    const scaledWidth = Math.max(Math.round(width * this.resolutionScale), 1)
    const scaledHeight = Math.max(Math.round(height * this.resolutionScale), 1)
    this.resolution.value.set(scaledWidth, scaledHeight)
    this.rawTarget.setSize(scaledWidth, scaledHeight)
    this.horizontalTarget.setSize(scaledWidth, scaledHeight)
    this.filteredTarget.setSize(scaledWidth, scaledHeight)
  }

  updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = frame.renderer
    if (!renderer) return undefined

    this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState)
    try {
      const size = renderer.getDrawingBufferSize(this.drawingBufferSize)
      this.setSize(size.width, size.height)
      const projectionElements = this.camera.projectionMatrix.elements
      this.projectionScale.value.set(
        projectionElements[0] ?? 1,
        projectionElements[5] ?? 1,
      )

      renderer.setClearColor(0xffffff, 1)
      renderer.setRenderTarget(this.rawTarget)
      this.quad.material = this.rawMaterial
      this.quad.name = 'Park GTAO [ Gather ]'
      this.quad.render(renderer)

      renderer.setRenderTarget(this.horizontalTarget)
      this.filterDirection.value.set(1, 0)
      this.quad.material = this.filterMaterial
      this.quad.name = 'Park GTAO [ Horizontal Denoise ]'
      this.quad.render(renderer)

      this.filterInput.value = this.horizontalTarget.texture
      renderer.setRenderTarget(this.filteredTarget)
      this.filterDirection.value.set(0, 1)
      this.quad.name = 'Park GTAO [ Vertical Denoise ]'
      this.quad.render(renderer)
    } finally {
      this.filterInput.value = this.rawTarget.texture
      RendererUtils.restoreRendererState(renderer, this.rendererState)
    }
    return undefined
  }

  setup(builder: NodeBuilder): Node {
    const sharedContext = (
      builder as NodeBuilder & { getSharedContext(): object }
    ).getSharedContext()
    const centerUv = uv()

    const safeNormal = (sampleUv: Node<'vec2'>) => {
      const raw = this.normalNode.sample(sampleUv).rgb
      return raw.mul(inverseSqrt(max(dot(raw, raw), 1e-8)))
    }

    const gather = Fn(() => {
      const result = float(1).toVar()
      const centerDepth = this.depthNode.sample(centerUv).r
      const centerNormalRaw = this.normalNode.sample(centerUv).rgb
      const centerValid = centerDepth
        .greaterThan(DEPTH_SKY_EPSILON)
        .and(centerDepth.lessThan(DEPTH_NEAR_LIMIT))
        .and(dot(centerNormalRaw, centerNormalRaw).greaterThan(1e-6))

      If(centerValid, () => {
        const viewPosition = getViewPosition(
          centerUv,
          centerDepth,
          this.projectionInverse,
        ).toVar()
        const viewNormal = centerNormalRaw
          .mul(inverseSqrt(max(dot(centerNormalRaw, centerNormalRaw), 1e-8)))
          .toVar()
        const viewDirection = viewPosition
          .mul(inverseSqrt(max(dot(viewPosition, viewPosition), 1e-8)))
          .negate()
          .toVar()
        const visibility = float(0).toVar()
        const noise = interleavedGradientNoise(screenCoordinate).toVar()
        const halfTexel = vec2(0.5).div(this.resolution)

        for (let sliceIndex = 0; sliceIndex < SLICE_COUNT; sliceIndex += 1) {
          const angle = float(sliceIndex)
            .add(noise)
            .div(SLICE_COUNT)
            .mul(PI)
          const sampleDirection = vec3(cos(angle), sin(angle), 0).toVar()
          const sliceBitangentRaw = cross(sampleDirection, viewDirection).toVar()
          const sliceBitangent = sliceBitangentRaw
            .mul(
              inverseSqrt(
                max(dot(sliceBitangentRaw, sliceBitangentRaw), 1e-8),
              ),
            )
            .toVar()
          const sliceTangent = cross(sliceBitangent, viewDirection).toVar()

          const projectedNormalRaw = viewNormal
            .sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent)))
            .toVar()
          const projectedNormalLength = projectedNormalRaw.length().toVar()
          const projectedNormal = projectedNormalRaw
            .div(max(projectedNormalLength, 0.0001))
            .toVar()
          const normalSin = dot(projectedNormal, sliceTangent).toVar()
          const normalCos = clamp(dot(projectedNormal, viewDirection), 0, 1).toVar()
          const normalSinSign = normalSin
            .greaterThanEqual(0)
            .select(float(1), float(-1))
          const normalAngle = normalSinSign.mul(acos(normalCos)).toVar()
          const tangentToNormal = cross(projectedNormal, sliceBitangent).toVar()
          const horizons = vec2(
            dot(viewDirection, tangentToNormal),
            dot(viewDirection, tangentToNormal.negate()),
          ).toVar()

          for (let stepIndex = 0; stepIndex < STEP_COUNT; stepIndex += 1) {
            const radialJitter = mix(
              0.8,
              1.0,
              fract(
                noise
                  .add(stepIndex * 0.61803398875)
                  .add(sliceIndex * 0.38196601125),
              ),
            )
            const stepFraction = pow(
              float(stepIndex + 1).div(STEP_COUNT),
              this.distanceExponent,
            )
            const viewOffset = sampleDirection
              .mul(this.radius)
              .mul(radialJitter)
              .mul(stepFraction)

            const evaluateHorizon = (
              direction: 1 | -1,
              horizon: Node<'float'>,
            ) => {
              const projectedUvRaw = getScreenPosition(
                viewPosition.add(viewOffset.mul(direction)),
                this.projection,
              )
              const insideViewport = projectedUvRaw.x
                .greaterThanEqual(0)
                .and(projectedUvRaw.x.lessThanEqual(1))
                .and(projectedUvRaw.y.greaterThanEqual(0))
                .and(projectedUvRaw.y.lessThanEqual(1))
              const projectedUv = projectedUvRaw.clamp(
                halfTexel,
                vec2(1).sub(halfTexel),
              )
              const sampleDepth = this.depthNode.sample(projectedUv).r
              const sampleValid = sampleDepth
                .greaterThan(DEPTH_SKY_EPSILON)
                .and(sampleDepth.lessThan(DEPTH_NEAR_LIMIT))
                .and(insideViewport)

              If(sampleValid, () => {
                const samplePosition = getViewPosition(
                  projectedUv,
                  sampleDepth,
                  this.projectionInverse,
                )
                const delta = samplePosition.sub(viewPosition).toVar()
                If(delta.z.abs().lessThan(this.thickness), () => {
                  const cosine = dot(
                    viewDirection,
                    delta.mul(inverseSqrt(max(dot(delta, delta), 1e-8))),
                  )
                  const distanceWeight = float(1).sub(
                    smoothstep(
                      this.radius.mul(0.75),
                      this.radius,
                      delta.length(),
                    ),
                  )
                  const weightedCosine = mix(float(-1), cosine, distanceWeight)
                  horizon.addAssign(max(0, weightedCosine.sub(horizon)))
                })
              })
            }

            evaluateHorizon(1, horizons.x)
            evaluateHorizon(-1, horizons.y)
          }

          // Cosine-weighted inner integral (Activision GTAO, equation 7).
          const positiveHorizon = acos(clamp(horizons.y, -1, 1)).toVar()
          const negativeHorizon = acos(clamp(horizons.x, -1, 1)).negate().toVar()
          const positiveTerm = cos(positiveHorizon.mul(2).sub(normalAngle))
            .negate()
            .add(normalCos)
            .add(positiveHorizon.mul(2).mul(normalSin))
          const negativeTerm = cos(negativeHorizon.mul(2).sub(normalAngle))
            .negate()
            .add(normalCos)
            .add(negativeHorizon.mul(2).mul(normalSin))
          visibility.addAssign(
            projectedNormalLength.mul(positiveTerm.add(negativeTerm)).mul(0.25),
          )
        }

        result.assign(
          pow(clamp(visibility.div(SLICE_COUNT), 0, 1), this.power),
        )
      })

      return result
    })

    const denoise = Fn(() => {
      const result = float(1).toVar()
      const centerDepth = this.depthNode.sample(centerUv).r
      const centerValid = centerDepth
        .greaterThan(DEPTH_SKY_EPSILON)
        .and(centerDepth.lessThan(DEPTH_NEAR_LIMIT))

      If(centerValid, () => {
        const centerPosition = getViewPosition(
          centerUv,
          centerDepth,
          this.projectionInverse,
        )
        const centerNormal = safeNormal(centerUv)
        const centerVisibility = this.filterInput.sample(centerUv).r
        const weightedVisibility = centerVisibility.mul(6).toVar()
        const weightSum = float(6).toVar()
        const texel = this.filterDirection.div(this.resolution)
        const spatialWeights = [4, 1] as const

        for (let radiusIndex = 1; radiusIndex <= 2; radiusIndex += 1) {
          for (const direction of [-1, 1] as const) {
            const sampleUv = centerUv
              .add(texel.mul(radiusIndex * direction))
              .clamp(
                vec2(0.5).div(this.resolution),
                vec2(1).sub(vec2(0.5).div(this.resolution)),
              )
            const sampleDepth = this.depthNode.sample(sampleUv).r
            const sampleValid = sampleDepth
              .greaterThan(DEPTH_SKY_EPSILON)
              .and(sampleDepth.lessThan(DEPTH_NEAR_LIMIT))
            const samplePosition = getViewPosition(
              sampleUv,
              sampleDepth.clamp(DEPTH_SKY_EPSILON, DEPTH_NEAR_LIMIT),
              this.projectionInverse,
            )
            const sampleNormal = safeNormal(sampleUv)
            const depthSigma = max(0.04, centerPosition.z.abs().mul(0.002))
            const depthWeight = exp(
              samplePosition.z.sub(centerPosition.z).abs().div(depthSigma).negate(),
            )
            const normalWeight = pow(max(dot(centerNormal, sampleNormal), 0), 16)
            const validWeight = sampleValid.select(float(1), float(0))
            const weight = depthWeight
              .mul(normalWeight)
              .mul(validWeight)
              .mul(spatialWeights[radiusIndex - 1] ?? 1)
            weightedVisibility.addAssign(
              this.filterInput.sample(sampleUv).r.mul(weight),
            )
            weightSum.addAssign(weight)
          }
        }

        result.assign(weightedVisibility.div(max(weightSum, 0.0001)))
      })

      return result
    })

    this.rawMaterial.fragmentNode = gather().context(sharedContext)
    this.rawMaterial.needsUpdate = true
    this.filterMaterial.fragmentNode = denoise().context(sharedContext)
    this.filterMaterial.needsUpdate = true

    return this.filteredPass
  }

  dispose(): void {
    this.rawTarget.dispose()
    this.horizontalTarget.dispose()
    this.filteredTarget.dispose()
    this.rawMaterial.dispose()
    this.filterMaterial.dispose()
  }

  private makeTarget(name: string): RenderTarget {
    const target = new RenderTarget(1, 1, {
      depthBuffer: false,
      format: RedFormat,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
    target.texture.name = name
    return target
  }
}

export const gtaoVisibility = (
  depthNode: TextureNode,
  normalNode: TextureNode,
  camera: PerspectiveCamera,
): GtaoVisibilityNode => new GtaoVisibilityNode(depthNode, normalNode, camera)
