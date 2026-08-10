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
 *
 * Deliberately NOT made more orange for the dusk look. The reference image's
 * gridshell and white panels read close to neutral in the light; the warmth
 * of that frame comes from the SKY, the aerial dust and the artificial layer,
 * not from an orange key. Pushing the key warm is the fastest way back to a
 * one-hue image.
 */
export const sunColor = new Color(1.0, 0.872, 0.735)
export const sunColorUniform = /*@__PURE__*/ uniform(sunColor)

/**
 * Mars irradiance is ~43% of Earth's; the authored exposure absorbs this.
 *
 * KEY/FILL RATIO IS THE WHOLE LOOK. Raising the key and dropping the ambient
 * (below) together is what makes shaded parts of the dome read dusk-dim so
 * the artificial layer can register, WITHOUT making the scene look like
 * night: the sunlit paving stays every bit as bright as before.
 */
export const SUN_LIGHT_INTENSITY = 3.15

/**
 * `scene.environmentIntensity` for the PMREM sky bake. Owned here (not buried
 * in SkySystem) because the AO composite reconstructs indirect light with the
 * same factor — if the two drift apart, AO either misses shade or eats sun.
 */
export const ENVIRONMENT_INTENSITY = 0.33
