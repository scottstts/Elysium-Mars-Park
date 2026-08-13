import { Vector3 } from 'three'

/**
 * THE WHEELED FLEET'S VOICE — the four ground robots (two groundskeepers, the
 * sweeper, the cargo mule).
 *
 * What this replaces, and why: each robot used to be one thin sawtooth at
 * 1150–1670 Hz behind a Q=6 bandpass at 1500–1860 Hz. A high-Q band on a saw
 * is a whistle, not a machine, and it sat in the 2–4 kHz region where the ear
 * is most sensitive — at a FIXED pitch, running at all times including while
 * parked. Constant, tonal, unmodulated and in the worst band: it read as a
 * ring, not as a robot.
 *
 * What a small geared wheeled machine actually sounds like, and what this
 * builds instead — four layers, every one of them below ~900 Hz:
 *
 *   1. DRIVE HUM — sawtooth through a lowpass. The fundamental is the motor's
 *      pole-passing rate, derived from MEASURED wheel revolutions per second,
 *      so pitch rises with the machine's real ground speed rather than
 *      flipping between two hardcoded values. The lowpass opens under load:
 *      a motor pulling gets brighter, a coasting one is muffled.
 *   2. GEAR MESH — a triangle at 4.5× the drive fundamental (capped at 560 Hz),
 *      low gain. Triangle, not saw: it gives the reduction gearbox its
 *      mechanical identity with a fraction of the upper harmonics, so there's
 *      character without a whistle.
 *   3. ROLL GRIT — brown noise through a bandpass tuned by wheel size, gain
 *      proportional to ground speed. This is the dominant moving cue and it's
 *      broadband by construction, so it can never ring: grousers on paving.
 *   4. WORK SCRUB — while a robot is parked and working, the roll layer swells
 *      on |sin(toolPhase · 2.2)|, the SAME term robotsSystem bobs the rake and
 *      brush carriage with. Sound and visible stroke are one event. Idle is
 *      otherwise just a whisper of drive hum (electronics), not a tone.
 *
 * The sweeper additionally gets a soft 900 Hz brush swish, keyed off its
 * spinner discs — low Q and low gain, so it stays a swish.
 *
 * SPEED IS MEASURED, NOT DECLARED. Ground speed comes from the frame-to-frame
 * position delta rather than the routine's configured `speed`, which means a
 * robot that has stopped to yield to a walking player (robotsSystem holds it
 * in the 'moving' state while it waits) correctly falls quiet.
 */

/**
 * The slice of RobotsSystem's roster the voice reads. Private-field peek —
 * TS `private` is compile-time only — so keep these names in sync with
 * `GroundRobot` (robots/robotsSystem.ts) and `RobotRig` (robots/chassis.ts).
 */
export interface RobotAudioSource {
  rig: { group: { position: Vector3 }; wheelRadius: number; spinners: unknown[] }
  state: string
  toolPhase: number
}

interface Voice {
  panner: PannerNode
  drive: OscillatorNode
  driveLowpass: BiquadFilterNode
  driveGain: GainNode
  mesh: OscillatorNode
  meshGain: GainNode
  gritGain: GainNode
  brushGain: GainNode | null
  /** Pole-passing rate at a standstill, from wheel size: big machine, low voice. */
  idleHz: number
  /** 0 = smallest wheel in the fleet, 1 = largest. Drives weight/level/band. */
  weight: number
  wheelRadius: number
  previous: Vector3
  speed: number
}

// Wheel radii across the fleet (sweeper 0.132 → mule 0.186) normalized into a
// "how heavy does this thing sound" factor.
const WHEEL_LIGHT = 0.13
const WHEEL_HEAVY = 0.19

/** Speed at which the roll and mesh layers reach full level. */
const FULL_LOAD = 0.9

export class RobotVoices {
  private readonly voices: Voice[] = []

  constructor(
    context: AudioContext,
    master: GainNode,
    noise: AudioBuffer,
    fleet: RobotAudioSource[],
  ) {
    for (let i = 0; i < fleet.length; i++) {
      const robot = fleet[i]
      const wheelRadius = robot.rig.wheelRadius
      const weight = clamp01((wheelRadius - WHEEL_LIGHT) / (WHEEL_HEAVY - WHEEL_LIGHT))
      const idleHz = 96 - weight * 38

      const panner = context.createPanner()
      panner.distanceModel = 'inverse'
      panner.refDistance = 2.5
      panner.rolloffFactor = 1.5

      // ---- 1. Drive hum.
      const drive = context.createOscillator()
      drive.type = 'sawtooth'
      // A few cents apart per unit so two identical groundskeepers working the
      // same court never phase-lock into one artificial beat.
      drive.detune.value = i * 7 - 10
      const driveLowpass = context.createBiquadFilter()
      driveLowpass.type = 'lowpass'
      driveLowpass.frequency.value = 210
      driveLowpass.Q.value = 0.9
      const driveGain = context.createGain()
      driveGain.gain.value = 0
      drive.connect(driveLowpass).connect(driveGain).connect(panner)
      drive.start()

      // ---- 2. Gear mesh.
      const mesh = context.createOscillator()
      mesh.type = 'triangle'
      mesh.frequency.value = idleHz * 4.5
      const meshFilter = context.createBiquadFilter()
      meshFilter.type = 'bandpass'
      meshFilter.frequency.value = 380
      meshFilter.Q.value = 1.4
      const meshGain = context.createGain()
      meshGain.gain.value = 0
      mesh.connect(meshFilter).connect(meshGain).connect(panner)
      mesh.start()

      // ---- 3. Roll grit.
      const grit = context.createBufferSource()
      grit.buffer = noise
      grit.loop = true
      // Decorrelate the four beds; identical playback rates on one buffer sum
      // into a single correlated hiss that follows no robot in particular.
      grit.playbackRate.value = 0.82 + i * 0.11
      const gritFilter = context.createBiquadFilter()
      gritFilter.type = 'bandpass'
      gritFilter.frequency.value = 520 - weight * 200
      gritFilter.Q.value = 0.85
      const gritGain = context.createGain()
      gritGain.gain.value = 0
      grit.connect(gritFilter).connect(gritGain).connect(panner)
      grit.start()

      // ---- 4. Brush swish, sweeper only (the rig with spinner discs).
      let brushGain: GainNode | null = null
      if (robot.rig.spinners.length > 0) {
        const brush = context.createBufferSource()
        brush.buffer = noise
        brush.loop = true
        brush.playbackRate.value = 2.4
        const brushFilter = context.createBiquadFilter()
        brushFilter.type = 'bandpass'
        brushFilter.frequency.value = 900
        brushFilter.Q.value = 0.6
        brushGain = context.createGain()
        brushGain.gain.value = 0
        brush.connect(brushFilter).connect(brushGain).connect(panner)
        brush.start()
      }

      panner.connect(master)

      this.voices.push({
        panner,
        drive,
        driveLowpass,
        driveGain,
        mesh,
        meshGain,
        gritGain,
        brushGain,
        idleHz,
        weight,
        wheelRadius,
        previous: robot.rig.group.position.clone(),
        speed: 0,
      })
    }
  }

  update(fleet: RobotAudioSource[], dt: number): void {
    const follow = Math.min(1, dt * 6)
    for (let i = 0; i < this.voices.length && i < fleet.length; i++) {
      const voice = this.voices[i]
      const robot = fleet[i]
      const position = robot.rig.group.position

      voice.panner.positionX.value = position.x
      // These are low machines — the mule's deck is about knee height.
      voice.panner.positionY.value = position.y + 0.35
      voice.panner.positionZ.value = position.z

      // Measured ground speed, then smoothed: the raw delta is noisy at the
      // waypoint corners where the routine damps the yaw.
      const raw = dt > 0 ? Math.min(3, voice.previous.distanceTo(position) / dt) : 0
      voice.previous.copy(position)
      voice.speed += (raw - voice.speed) * Math.min(1, dt * 8)

      const load = clamp01(voice.speed / FULL_LOAD)
      const working = robot.state === 'working'
      // The rake/brush stroke robotsSystem bobs the tool with, rectified so
      // both halves of the stroke scrub.
      const scrub = working ? Math.pow(Math.abs(Math.sin(robot.toolPhase * 2.2)), 1.5) : 0

      // Drive hum: pole-passing rate off real wheel revolutions per second.
      const revs = voice.speed / (Math.PI * 2 * voice.wheelRadius)
      const driveHz = voice.idleHz + revs * 30
      voice.drive.frequency.value += (driveHz - voice.drive.frequency.value) * Math.min(1, dt * 4)
      voice.driveLowpass.frequency.value +=
        (210 + load * 430 - voice.driveLowpass.frequency.value) * Math.min(1, dt * 4)
      const driveLevel = 0.013 + load * (0.05 + voice.weight * 0.022)
      voice.driveGain.gain.value += (driveLevel - voice.driveGain.gain.value) * follow

      // Gear mesh rides the drive fundamental, capped clear of the band the
      // old servo whistled in.
      const meshHz = Math.min(560, voice.drive.frequency.value * 4.5)
      voice.mesh.frequency.value += (meshHz - voice.mesh.frequency.value) * Math.min(1, dt * 4)
      voice.meshGain.gain.value += (load * 0.013 - voice.meshGain.gain.value) * follow

      // Roll grit while driving; the same band swells to the work stroke while
      // parked, so a working robot is audible without holding a tone.
      const gritLevel = load * 0.05 + scrub * 0.022
      voice.gritGain.gain.value += (gritLevel - voice.gritGain.gain.value) * follow

      if (voice.brushGain) {
        voice.brushGain.gain.value +=
          ((load * 0.016 + scrub * 0.012) - voice.brushGain.gain.value) * follow
      }
    }
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
