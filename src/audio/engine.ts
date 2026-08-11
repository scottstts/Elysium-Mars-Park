import { Vector3 } from 'three'
import type { GameContext } from '../runtime/context'
import type { GameSystem } from '../runtime/system'
import type { PlayerSystem } from '../player/playerSystem'
import type { RobotsSystem } from '../robots/robotsSystem'
import type { TramSystem } from '../tram/tramSystem'
import { COMMONS, FARMSIDE, OVERLOOK_LOUNGE, PORTAL_STATION, RESIDENTIAL, WORKS } from '../world/parkPlan'
import { pavedSignedDistance } from '../world/pavingPlan'

/**
 * The park's voice (plan §13) — fully procedural WebAudio, no assets, no
 * music (canon). The dome is a vast soft room; interiors are small warm
 * ones; the tube is a duct. Every source is synthesized: noise beds,
 * filtered bursts for footsteps, servo whines, the tram's rail-sing.
 */

type Zone = 'park' | 'interior' | 'tram' | 'tube'

export class AudioEngineSystem implements GameSystem {
  readonly id = 'audio'

  private context: AudioContext | null = null
  private master: GainNode | null = null
  private lowpass: BiquadFilterNode | null = null

  private roomGain: GainNode | null = null
  private hvacGain: GainNode | null = null
  private hvacLfoGain: GainNode | null = null
  private interiorGain: GainNode | null = null

  private tickTimer = 6
  private lastStepCount = 0
  private zone: Zone = 'tram'
  private zoneBlend = 0

  private servoNodes: Array<{ osc: OscillatorNode; gain: GainNode; panner: PannerNode }> = []
  private tramNoiseGain: GainNode | null = null
  private tramPanner: PannerNode | null = null
  private tramOsc: OscillatorNode | null = null
  private mistGain: GainNode | null = null
  private ventGain: GainNode | null = null

  private readonly player: PlayerSystem | null
  private readonly robots: RobotsSystem | null
  private readonly tram: TramSystem | null

  constructor(player: PlayerSystem | null, robots: RobotsSystem | null, tram: TramSystem | null) {
    this.player = player
    this.robots = robots
    this.tram = tram
  }

  init(ctx: GameContext): void {
    // The context must begin on a user gesture: the BOARD click.
    ctx.events.on('park/entered', () => this.start(ctx))
  }

  /**
   * Hard pause for the ESC menu: a 60 ms master fade, then the context
   * suspends (a bare suspend() clicks). Resume restores the clock first so
   * the fade-up actually renders.
   */
  private pauseWanted = false

  setPaused(paused: boolean): void {
    this.pauseWanted = paused
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const now = context.currentTime
    if (paused) {
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(0, now + 0.06)
      window.setTimeout(() => {
        if (this.pauseWanted && this.context && this.context.state === 'running') {
          void this.context.suspend()
        }
      }, 90)
    } else {
      void context.resume().then(() => {
        const t = context.currentTime
        master.gain.cancelScheduledValues(t)
        master.gain.setValueAtTime(0, t)
        master.gain.linearRampToValueAtTime(0.72, t + 0.18)
      })
    }
  }

  private start(ctx: GameContext): void {
    if (this.context) return
    const context = new AudioContext()
    this.context = context

    const master = context.createGain()
    master.gain.value = 0.72
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 20000
    master.connect(lowpass)
    lowpass.connect(context.destination)
    this.master = master
    this.lowpass = lowpass

    const noiseBuffer = buildNoiseBuffer(context, 4)

    // Dome room tone: deep filtered noise, barely there.
    const room = context.createBufferSource()
    room.buffer = noiseBuffer
    room.loop = true
    const roomFilter = context.createBiquadFilter()
    roomFilter.type = 'lowpass'
    roomFilter.frequency.value = 190
    const roomGain = context.createGain()
    roomGain.gain.value = 0.055
    room.connect(roomFilter).connect(roomGain).connect(master)
    room.start()
    this.roomGain = roomGain

    // HVAC breath: banded noise with a slow swell LFO.
    const hvac = context.createBufferSource()
    hvac.buffer = noiseBuffer
    hvac.loop = true
    hvac.playbackRate.value = 0.85
    const hvacFilter = context.createBiquadFilter()
    hvacFilter.type = 'bandpass'
    hvacFilter.frequency.value = 520
    hvacFilter.Q.value = 0.8
    const hvacGain = context.createGain()
    hvacGain.gain.value = 0.02
    const lfo = context.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = context.createGain()
    lfoGain.gain.value = 0.011
    lfo.connect(lfoGain).connect(hvacGain.gain)
    hvac.connect(hvacFilter).connect(hvacGain).connect(master)
    hvac.start()
    lfo.start()
    this.hvacGain = hvacGain
    this.hvacLfoGain = lfoGain

    // Interior small-room hush (crossfaded in by zone).
    const interior = context.createBufferSource()
    interior.buffer = noiseBuffer
    interior.loop = true
    interior.playbackRate.value = 1.3
    const interiorFilter = context.createBiquadFilter()
    interiorFilter.type = 'bandpass'
    interiorFilter.frequency.value = 900
    interiorFilter.Q.value = 0.5
    const interiorGain = context.createGain()
    interiorGain.gain.value = 0
    interior.connect(interiorFilter).connect(interiorGain).connect(master)
    interior.start()
    this.interiorGain = interiorGain

    // Robot servos: one thin saw each behind a bandpass + panner.
    if (this.robots) {
      const fleet = (this.robots as unknown as { robots: Array<{ rig: { group: { position: Vector3 } } }> })
        .robots
      for (let i = 0; i < fleet.length; i++) {
        const osc = context.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = 1150 + i * 173
        const filter = context.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = 1500 + i * 120
        filter.Q.value = 6
        const gain = context.createGain()
        gain.gain.value = 0
        const panner = context.createPanner()
        panner.distanceModel = 'inverse'
        panner.refDistance = 2.5
        panner.rolloffFactor = 1.4
        osc.connect(filter).connect(gain).connect(panner).connect(master)
        osc.start()
        this.servoNodes.push({ osc, gain, panner })
      }
    }

    // Tram: rail-sing (noise through resonant band + a faint tone).
    const tramNoise = context.createBufferSource()
    tramNoise.buffer = noiseBuffer
    tramNoise.loop = true
    const tramFilter = context.createBiquadFilter()
    tramFilter.type = 'bandpass'
    tramFilter.frequency.value = 640
    tramFilter.Q.value = 2.4
    const tramGain = context.createGain()
    tramGain.gain.value = 0
    const tramPanner = context.createPanner()
    tramPanner.distanceModel = 'inverse'
    tramPanner.refDistance = 6
    tramPanner.rolloffFactor = 1.1
    tramNoise.connect(tramFilter).connect(tramGain).connect(tramPanner).connect(master)
    tramNoise.start()
    const tramOsc = context.createOscillator()
    tramOsc.type = 'sine'
    tramOsc.frequency.value = 92
    const tramOscGain = context.createGain()
    tramOscGain.gain.value = 0.4
    tramOsc.connect(tramOscGain).connect(tramGain)
    tramOsc.start()
    this.tramNoiseGain = tramGain
    this.tramPanner = tramPanner
    this.tramOsc = tramOsc

    ctx.events.on('tram/docked', () => this.doorChime())

    // Greenhouse mist + reclaimer vents: hiss beds behind panners.
    this.mistGain = this.hissSource(context, master, noiseBuffer, 2600, {
      x: FARMSIDE.glasshouses[1].x,
      z: FARMSIDE.glasshouses[1].z,
    })
    this.ventGain = this.hissSource(context, master, noiseBuffer, 1400, {
      x: WORKS.machineHall.x + 6,
      z: WORKS.machineHall.z + WORKS.machineHall.depth / 2 + 7,
    })
  }

  private hissSource(
    context: AudioContext,
    master: GainNode,
    buffer: AudioBuffer,
    frequency: number,
    at: { x: number; z: number },
  ): GainNode {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.playbackRate.value = 1.7
    const filter = context.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = frequency
    const gain = context.createGain()
    gain.gain.value = 0
    const panner = context.createPanner()
    panner.distanceModel = 'inverse'
    panner.refDistance = 4
    panner.rolloffFactor = 1.2
    panner.positionX.value = at.x
    panner.positionY.value = 2
    panner.positionZ.value = at.z
    source.connect(filter).connect(gain).connect(panner).connect(master)
    source.start()
    return gain
  }

  private doorChime(): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const now = context.currentTime
    for (const [frequency, offset] of [
      [988, 0],
      [740, 0.16],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = frequency
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, now + offset)
      gain.gain.linearRampToValueAtTime(0.09, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.6)
      osc.connect(gain).connect(master)
      osc.start(now + offset)
      osc.stop(now + offset + 0.7)
    }
  }

  private glassTick(pan: number): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(3400 + Math.abs(pan) * 1400, now)
    osc.frequency.exponentialRampToValueAtTime(1900, now + 0.05)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.022, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
    const panner = context.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, pan))
    osc.connect(gain).connect(panner).connect(master)
    osc.start(now)
    osc.stop(now + 0.12)
  }

  private footstep(surface: 'regolith' | 'paver' | 'deck' | 'interior'): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = buildNoiseBuffer(context, 0.12, true)
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const settings = {
      regolith: { type: 'bandpass' as BiquadFilterType, frequency: 480, q: 0.7, level: 0.16, decay: 0.1 },
      paver: { type: 'highpass' as BiquadFilterType, frequency: 900, q: 0.8, level: 0.1, decay: 0.065 },
      deck: { type: 'bandpass' as BiquadFilterType, frequency: 300, q: 1.6, level: 0.15, decay: 0.12 },
      interior: { type: 'bandpass' as BiquadFilterType, frequency: 600, q: 1, level: 0.07, decay: 0.08 },
    }[surface]
    filter.type = settings.type
    filter.frequency.value = settings.frequency
    filter.Q.value = settings.q
    gain.gain.setValueAtTime(settings.level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.decay)
    source.connect(filter).connect(gain).connect(master)
    source.start(now)
    source.stop(now + settings.decay + 0.05)
  }

  private classifySurface(position: Vector3): 'regolith' | 'paver' | 'deck' | 'interior' {
    if (this.zone === 'interior') return 'interior'
    // Station deck?
    if (
      Math.abs(position.x - PORTAL_STATION.x) < PORTAL_STATION.width / 2 &&
      Math.abs(position.z - PORTAL_STATION.z) < PORTAL_STATION.depth / 2
    ) {
      return 'deck'
    }
    // On ANY paved surface? The civic floor is far wider than the PATHS
    // ribbons now (plaza, boulevard, aprons) — the paving field is the truth.
    if (pavedSignedDistance(position.x, position.z) <= 0) return 'paver'
    return 'regolith'
  }

  private classifyZone(position: Vector3): Zone {
    const tram = this.tram as unknown as { riding?: boolean } | null
    if (tram?.riding) {
      return position.z > 120 ? 'tube' : 'tram'
    }
    const lounge = OVERLOOK_LOUNGE
    if (
      Math.abs(position.x - lounge.x) < lounge.depth / 2 + 0.3 &&
      Math.abs(position.z - lounge.z) < lounge.width / 2 + 0.3
    ) {
      return 'interior'
    }
    // Every enterable interior counts, not an allow-list of two — the audit
    // walked into glasshouse 0, the Commons, and a hab and heard the open
    // park (gravel footsteps indoors). Glasshouse test is ORIENTED: the old
    // axis-aligned compare only worked because the rotation happens to be
    // exactly π/2.
    for (const house of FARMSIDE.glasshouses) {
      const cos = Math.cos(house.rotation)
      const sin = Math.sin(house.rotation)
      const dx = position.x - house.x
      const dz = position.z - house.z
      const across = dx * cos - dz * sin
      const along = dx * sin + dz * cos
      if (Math.abs(across) < house.width / 2 && Math.abs(along) < house.length / 2) {
        return 'interior'
      }
    }
    if (Math.hypot(position.x - COMMONS.x, position.z - COMMONS.z) < COMMONS.radius - 0.6) {
      return 'interior'
    }
    for (const angle of RESIDENTIAL.angles) {
      const hx = Math.cos(angle) * RESIDENTIAL.arcRadius
      const hz = Math.sin(angle) * RESIDENTIAL.arcRadius
      if (Math.hypot(position.x - hx, position.z - hz) < 4.2) return 'interior'
    }
    // Ops room lives inside the machine hall's envelope.
    const hall = WORKS.machineHall
    const cos = Math.cos(hall.rotation)
    const sin = Math.sin(hall.rotation)
    const dx = position.x - hall.x
    const dz = position.z - hall.z
    const along = dx * cos + dz * sin
    const across = -dx * sin + dz * cos
    if (Math.abs(along) < hall.width / 2 && Math.abs(across) < hall.depth / 2) {
      return 'interior'
    }
    return 'park'
  }

  update(ctx: GameContext, dt: number): void {
    const context = this.context
    if (!context || !this.master) return
    const listener = context.listener
    const camera = ctx.camera
    const position = camera.position
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    if (listener.positionX) {
      listener.positionX.value = position.x
      listener.positionY.value = position.y
      listener.positionZ.value = position.z
      listener.forwardX.value = forward.x
      listener.forwardY.value = forward.y
      listener.forwardZ.value = forward.z
      listener.upX.value = up.x
      listener.upY.value = up.y
      listener.upZ.value = up.z
    }

    // Zones + crossfades.
    this.zone = this.classifyZone(position)
    const wantInterior = this.zone === 'park' ? 0 : 1
    this.zoneBlend += (wantInterior - this.zoneBlend) * Math.min(1, dt * 3)
    if (this.roomGain) this.roomGain.gain.value = 0.055 * (1 - this.zoneBlend * 0.75)
    if (this.hvacGain) this.hvacGain.gain.value = 0.02 * (1 - this.zoneBlend * 0.4)
    if (this.hvacLfoGain) this.hvacLfoGain.gain.value = 0.011 * (1 - this.zoneBlend)
    if (this.interiorGain) this.interiorGain.gain.value = 0.028 * this.zoneBlend
    if (this.lowpass) {
      const target = this.zone === 'tube' ? 900 : this.zone === 'tram' ? 4200 : 20000
      this.lowpass.frequency.value +=
        (target - this.lowpass.frequency.value) * Math.min(1, dt * 4)
    }

    // Sparse thermal glass ticks from random directions overhead.
    this.tickTimer -= dt
    if (this.tickTimer <= 0) {
      this.tickTimer = 8 + ((ctx.time.sim * 977) % 17)
      this.glassTick(((ctx.time.sim * 431) % 2) - 1)
    }

    // Footsteps land on the player's own gait: playerSystem counts a plant
    // at every bob low point (cadence law, 2.5 steps/s walk → 4.0 sprint),
    // so the heard step and the camera dip are ONE event — not the two
    // free-running clocks the old metres-accumulator gave (0.82 steps/s at
    // walk against a 1.57 Hz bob). While seated the counter is swallowed
    // silently so alighting never fires a stale step.
    const player = this.player
    if (player) {
      if (!player.seated && player.stepCount > this.lastStepCount) {
        this.footstep(this.classifySurface(player.eye))
      }
      this.lastStepCount = player.stepCount
    }

    // Servos follow their robots.
    if (this.robots) {
      const fleet = (
        this.robots as unknown as {
          robots: Array<{ rig: { group: { position: Vector3 } }; state: string; speed: number }>
        }
      ).robots
      for (let i = 0; i < this.servoNodes.length && i < fleet.length; i++) {
        const node = this.servoNodes[i]
        const robot = fleet[i]
        const p = robot.rig.group.position
        node.panner.positionX.value = p.x
        node.panner.positionY.value = p.y + 0.5
        node.panner.positionZ.value = p.z
        const moving = robot.state === 'moving'
        node.gain.gain.value = moving ? 0.05 : 0.008
        node.osc.frequency.value = (moving ? 1.18 : 1) * (1150 + i * 173)
      }
    }

    // Tram rail-sing.
    const tram = this.tram as unknown as {
      cars?: Array<{ group: { position: Vector3 } }>
      speed?: number
    } | null
    if (tram?.cars?.length && this.tramNoiseGain && this.tramPanner && this.tramOsc) {
      const p = tram.cars[0].group.position
      this.tramPanner.positionX.value = p.x
      this.tramPanner.positionY.value = p.y
      this.tramPanner.positionZ.value = p.z
      const speed = tram.speed ?? 0
      this.tramNoiseGain.gain.value = Math.min(0.14, speed * 0.014)
      this.tramOsc.frequency.value = 80 + speed * 7
    }

    // Mist follows the cycle; vents breathe forever.
    if (this.mistGain) {
      const active = ctx.time.sim % 90 < 10
      this.mistGain.gain.value += ((active ? 0.16 : 0) - this.mistGain.gain.value) * Math.min(1, dt * 5)
    }
    if (this.ventGain) {
      this.ventGain.gain.value = 0.04 + Math.sin(ctx.time.sim * 0.4) * 0.012
    }
  }

  dispose(): void {
    this.context?.close()
    this.context = null
  }
}

function buildNoiseBuffer(context: AudioContext, seconds: number, decay = false): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let brown = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    data[i] = brown * 3.2
    if (decay) data[i] *= 1 - i / length
  }
  return buffer
}
