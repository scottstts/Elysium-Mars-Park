import { Color, Vector3 } from 'three'
import { uniform } from 'three/tsl'

/**
 * The frozen late afternoon (plan §1): sun elevation 27°, azimuth 250° (WSW,
 * compass convention; +X east, +Z south). These two numbers define every
 * shadow in the game and never change.
 */
export const SUN_ELEVATION_DEG = 27
export const SUN_AZIMUTH_DEG = 250

const elevation = (SUN_ELEVATION_DEG * Math.PI) / 180
const azimuth = (SUN_AZIMUTH_DEG * Math.PI) / 180

/** Unit vector from the ground toward the sun. */
export const sunDirection = new Vector3(
  Math.sin(azimuth) * Math.cos(elevation),
  Math.sin(elevation),
  -Math.cos(azimuth) * Math.cos(elevation),
).normalize()

export const sunDirectionUniform = /*@__PURE__*/ uniform(sunDirection)

/**
 * Direct sunlight after the dusty column: warm white, noticeably less orange
 * than an Earth evening — Mars dust reddens the SKY, while the transmitted
 * disc stays comparatively neutral (the reversed-colors regime).
 */
export const sunColor = new Color(1.0, 0.87, 0.72)
export const sunColorUniform = /*@__PURE__*/ uniform(sunColor)

/** Mars irradiance is ~43% of Earth's; the authored exposure absorbs this. */
export const SUN_LIGHT_INTENSITY = 2.6
