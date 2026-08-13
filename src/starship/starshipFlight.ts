import { Vector3 } from 'three'

/**
 * THE FLIGHT PROFILE — one vehicle, one pad, forever.
 *
 * parked (30 s) → prep (arms) → ignition → ascent → away (30 s) → entry →
 * burn → touchdown → parked …
 *
 * WHY THIS IS INTEGRATED AND NOT KEYFRAMED. A launch read from a curve looks
 * like an elevator: the give-away is that the vehicle's speed at any height is
 * whatever the curve says rather than whatever the last few seconds of thrust
 * earned it. Everything below is a forward Euler integration of
 * `a = T/m · axis − g` at the fixed step, with the two things a real vehicle
 * actually controls — throttle and where it points — authored, and position
 * left to fall out. The pitch program is a gravity turn; the landing is ZEM/ZEV
 * terminal guidance, which is what an actual booster flies.
 *
 * FRAME. Everything here is the demo's own Blender frame, which the site mounts
 * at yaw 0 — so it is plain ENU: +X east, +Y north, +Z up, origin at the
 * assembly datum. `starshipModel` maps it to the world with one −90° X rotation
 * and a translation, and no flight code has to know that.
 *
 * ORIGIN. `position` is the displacement of the ENGINE EXIT PLANE from where it
 * sits parked, so zero is "on the mount". That point is also the rotation pivot
 * and where the plume attaches — a rocket turns about its thrust, and the one
 * place the trajectory must be exact is the one the guidance is nulling.
 *
 * NO DRAG, and that is physics rather than a shortcut. At the 260 m/s peak of
 * the descent the Mars column gives q ≈ 470 Pa over ~64 m² of base — about
 * 30 kN against a vehicle in the 10^6 kg class, ~0.02 m/s². Against 3.71 it is
 * four orders of magnitude down and could not be seen.
 */

/** Mars surface gravity. The whole profile is scaled by this, not by Earth's. */
const MARS_G = 3.71

/** The owner's cadence: this long on the pad, and this long off it. */
export const PAD_DWELL_SECONDS = 30
export const AWAY_SECONDS = 30

/* ---- ascent ------------------------------------------------------------- */

/** The QD arm swings clear before anything lights. The catch arms do not —
 *  see `ARM_OPEN_ALTITUDE`. */
const PREP_SECONDS = 11

/**
 * THE CATCH ARMS ARE DRIVEN BY ALTITUDE, NOT BY PHASE, and that one decision
 * gets three things at once.
 *
 * It is what actually happens: the arms are still around the vehicle at
 * ignition and spread as it rises past them, and on the way in they close back
 * around it in the last moments before contact. Opening them during a hold
 * would be a minute of tower ballet with nothing else moving.
 *
 * It is self-timing. `armOpen = smoothstep(0, ARM_OPEN_ALTITUDE, altitude)` is
 * the same function on the way up and the way down, so the arm angle is a pure
 * function of where the vehicle is. The descent cannot get out of step with the
 * ascent, because it is not a separate schedule — it is the same one, read
 * backwards. Nothing has to be re-tuned twice.
 *
 * And it is what makes the clearance provable. Because the angle depends only
 * on altitude, "do the arms ever touch the vehicle?" is a question about a
 * one-parameter family of poses rather than about timing, and
 * tools/starship-clearance-audit.mjs can simply walk it.
 *
 * 36 m IS A MEASURED CEILING, not a feel. Against fully parked arms the
 * vehicle is in contact over an ascent of 20.5 → 44.5 m — the grid fins and
 * chines going by. So the arms have to be substantially open by 20 m, which
 * caps how leisurely this can be: the audit walks the whole schedule and finds
 * it clean up to 44 m and fouling from 46 (at 24–25 m of ascent, where the
 * fins arrive and the arms are still only half spread). 36 keeps 28 % margin
 * on that ceiling and puts the full spread about 4 s after liftoff.
 */
const ARM_OPEN_ALTITUDE = 36
/** Raptors spool against the hold-downs before release, as they really do. */
const IGNITION_SECONDS = 2.6
/**
 * Thrust-to-weight at release, and at the end of the visible climb as
 * propellant burns off. 2.2 rather than the ~1.5 a Starship leaves Earth with:
 * in a third of the gravity, 1.5 would give 1.9 m/s² and the stack would crawl.
 * 2.2 puts the initial 4.5 m/s² and the tower-clear time (~7 s) where a real
 * launch's are, which is the cadence the eye actually recognises.
 */
const LIFTOFF_TWR = 2.2
const BURNOUT_TWR = 3.4
/** e-folding time of the TWR climb — i.e. how fast the vehicle gets lighter. */
const TWR_TAU_SECONDS = 55

/** Hold vertical until the tower is well clear, then turn. */
const PITCH_START_ALT = 220
/** Altitude by which the turn has reached `PITCH_MAX_DEG`. */
const PITCH_FULL_ALT = 7000
/**
 * How far over the turn goes. A real first stage keeps pitching past this, but
 * the camera is 215 m from the pad and the far plane is 14 km: at 52° the stack
 * ran 6.3 km downrange and its slant range reached 13.2 km, which is inside the
 * plane by less than the length of the vehicle. 42° holds the whole fade inside
 * ~11.5 km from anywhere on the park floor.
 */
const PITCH_MAX_DEG = 42
/**
 * Front-loads the turn: a real gravity turn does most of its pitching early,
 * while the vehicle is slow and the aerodynamic penalty for it is small.
 */
const PITCH_SHAPE = 0.7

/**
 * The stack dissolves into the dust column rather than being switched off.
 * `marsAerialPerspective` runs ~1/5.2 km on green, so by 11.5 km the vehicle
 * is already ~89 % veiled and the plume is all that is left of it; the fade
 * only guarantees the last few per cent land on nothing. It also keeps the
 * whole silhouette inside the 14 km far plane, so the clip can never show.
 */
const FADE_START_ALT = 6800
const FADE_END_ALT = 10400

/* ---- descent ------------------------------------------------------------ */

/**
 * It comes back at exactly the height it went, which is not tidiness: the
 * re-entry is a teleport into the sky, and the one place that teleport can be
 * seen is if the vehicle arrives somewhere it is bigger than a pixel. Arriving
 * at `FADE_END_ALT` means it arrives at visibility 0 and fades UP out of the
 * dust column, so there is no frame in which it appears.
 */
const ENTRY_ALT = FADE_END_ALT
const ENTRY_SPEED = 170
/** Off vertical — the owner asked for an angled fall, and a real one is. */
const ENTRY_PATH_DEG = 32
/** Ignition altitude for the landing burn. */
const BURN_START_ALT = 2800
/**
 * Thrust limit for the landing burn — 13 bells against a nearly dry stack.
 * WITHOUT THIS THE GUIDANCE IS UNBOUNDED: ZEM/ZEV will happily ask for any
 * acceleration the geometry implies, and if the entry leaves it a crossrange
 * it cannot fly out, it points the vehicle sideways and then inverts. The
 * clamp is what makes an unreachable command look like a vehicle doing its
 * best rather than a bug. 5.4 g_mars is in Falcon suicide-burn territory.
 */
const MAX_LANDING_ACCEL = 20
/**
 * Below this the guidance hands over to a slow vertical settle, because
 * ZEM/ZEV's 6/t_go² gain diverges exactly where precision matters most. A real
 * vehicle switches to a low-rate let-down at the same place for the same reason.
 */
const SETTLE_ALT = 60
const TOUCHDOWN_SPEED = 1.4
/** Engines out, dust hanging, arms coming back in. */
const TOUCHDOWN_SECONDS = 14

/**
 * How much of the engine cluster is lit. 33 bells to leave, 13 to kill the
 * entry velocity, 3 to set it down — Super Heavy's own sequence, and the
 * reason the plume visibly narrows twice on the way in.
 */
const ASCENT_ENGINES = 33
const BURN_ENGINES = 13
const SETTLE_ENGINES = 3

export type StarshipPhase =
  | 'parked' | 'prep' | 'ignition' | 'ascent' | 'away' | 'entry' | 'burn' | 'touchdown'

export interface StarshipFlightState {
  phase: StarshipPhase
  /** Engine-plane displacement from the parked pose, ENU metres. */
  readonly position: Vector3
  readonly velocity: Vector3
  /** Unit nose direction. Thrust acts along it; the plume leaves along −it. */
  readonly axis: Vector3
  /** Height of the engine plane above the mount. */
  altitude: number
  /** 0…1 chamber output. */
  throttle: number
  /** Bells lit, of 33 — drives how wide the plume's root is. */
  engines: number
  /** 0 parked and mated, 1 fully retracted. */
  armOpen: number
  qdOpen: number
  /** 0 gone, 1 solid. */
  visibility: number
  /** True while the stack is on or near the mount, so the pad sees exhaust. */
  padBlast: number
}

const UP = /*@__PURE__*/ new Vector3(0, 0, 1)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export class StarshipFlight {
  readonly state: StarshipFlightState = {
    phase: 'parked',
    position: new Vector3(),
    velocity: new Vector3(),
    axis: new Vector3(0, 0, 1),
    altitude: 0,
    throttle: 0,
    engines: 0,
    armOpen: 0,
    qdOpen: 0,
    visibility: 1,
    padBlast: 0,
  }

  /** Downrange heading, ENU, unit and horizontal. */
  private readonly downrange: Vector3
  /**
   * Ground range the vehicle re-enters at, BACK-SOLVED from the fall rather
   * than picked. Put it anywhere else and the terminal guidance inherits a
   * crossrange the vehicle has no thrust to fly out, which is not a tuning
   * problem — it is asking a booster to do something a booster cannot do.
   *
   *   fall  9500 → 2800 m under gravity from the entry velocity   → v_h · t
   *   burn  retrograde, so both components decay together         → v_h · t/2
   *
   * Both closed form, both below. The free fall then carries it most of the way
   * home on its own and ZEM/ZEV is only ever trimming, which is the regime the
   * law is well behaved in.
   */
  private readonly entryGroundRange: number
  private phaseTime = 0
  /** Speed at settle handover, so the let-down starts from what it inherits. */
  private settleSpeed = 0
  /**
   * Attitude at settle handover. The burn arrives still leaning ~10° into its
   * own retrograde; snapping that upright in one step throws the nose of a
   * 147 m vehicle 25 m sideways, which is the most visible thing that could
   * possibly happen on final approach. It is interpolated to vertical over the
   * remaining height instead — which is also just what a booster does.
   */
  private readonly settleAxis = new Vector3(0, 0, 1)
  private readonly scratch = new Vector3()

  /**
   * @param downrangeAzimuthDeg compass bearing the gravity turn takes, i.e.
   *   0 north, 90 east. The owner picked south-east: it carries the arc across
   *   the viewer instead of straight away from them, and it is the one quadrant
   *   that crosses neither the dome nor the frozen WSW sun.
   */
  constructor(downrangeAzimuthDeg: number) {
    const a = (downrangeAzimuthDeg * Math.PI) / 180
    // Compass → ENU: bearing 0 is +Y (north), 90 is +X (east).
    this.downrange = new Vector3(Math.sin(a), Math.cos(a), 0).normalize()

    const path = (ENTRY_PATH_DEG * Math.PI) / 180
    const vDown = ENTRY_SPEED * Math.cos(path)
    const vHoriz = ENTRY_SPEED * Math.sin(path)
    const drop = ENTRY_ALT - BURN_START_ALT
    const fallSeconds = (-vDown + Math.sqrt(vDown * vDown + 2 * MARS_G * drop)) / MARS_G
    const burnSpeed = Math.hypot(vDown + MARS_G * fallSeconds, vHoriz)
    const burnSeconds = (2 * BURN_START_ALT) / burnSpeed
    this.entryGroundRange = vHoriz * fallSeconds + (vHoriz * burnSeconds) / 2
  }

  /** Seconds until the next liftoff, for a caller that wants to schedule. */
  get phaseElapsed(): number {
    return this.phaseTime
  }

  private enter(phase: StarshipPhase): void {
    this.state.phase = phase
    this.phaseTime = 0
  }

  /** Thrust-axis acceleration available right now, m/s². */
  private thrustAccel(burnTime: number): number {
    const twr = BURNOUT_TWR + (LIFTOFF_TWR - BURNOUT_TWR) * Math.exp(-burnTime / TWR_TAU_SECONDS)
    return twr * MARS_G * this.state.throttle
  }

  step(dt: number): void {
    const s = this.state
    this.phaseTime += dt

    switch (s.phase) {
      case 'parked': {
        s.throttle = 0
        s.engines = 0
        s.visibility = 1
        s.qdOpen = 0
        s.padBlast = Math.max(0, s.padBlast - dt * 0.22)
        if (this.phaseTime >= PAD_DWELL_SECONDS) this.enter('prep')
        break
      }

      case 'prep': {
        // The umbilical, and only the umbilical. The catch arms are still
        // closed around the vehicle at ignition and stay that way until it
        // starts moving — see `ARM_OPEN_ALTITUDE`.
        s.qdOpen = smoothstep(0, PREP_SECONDS * 0.75, this.phaseTime)
        if (this.phaseTime >= PREP_SECONDS) this.enter('ignition')
        break
      }

      case 'ignition': {
        s.qdOpen = 1
        s.engines = ASCENT_ENGINES
        // Spool against the hold-downs: full chamber pressure before release.
        s.throttle = clamp01(this.phaseTime / IGNITION_SECONDS)
        s.padBlast = Math.max(s.padBlast, s.throttle)
        if (this.phaseTime >= IGNITION_SECONDS) {
          s.throttle = 1
          this.enter('ascent')
        }
        break
      }

      case 'ascent': {
        const burnTime = this.phaseTime
        const alt = s.position.z

        // Gravity turn: vertical off the mount, then over toward downrange.
        const turn = clamp01((alt - PITCH_START_ALT) / (PITCH_FULL_ALT - PITCH_START_ALT))
        const pitch = ((PITCH_MAX_DEG * Math.PI) / 180) * Math.pow(turn, PITCH_SHAPE)
        s.axis.copy(UP).multiplyScalar(Math.cos(pitch))
          .addScaledVector(this.downrange, Math.sin(pitch)).normalize()

        this.scratch.copy(s.axis).multiplyScalar(this.thrustAccel(burnTime))
        this.scratch.z -= MARS_G
        s.velocity.addScaledVector(this.scratch, dt)
        // Hold-downs: nothing moves until thrust beats weight. Without this the
        // first frames of the burn would sink the stack into its own mount.
        if (s.velocity.z < 0 && alt <= 0) s.velocity.set(0, 0, 0)
        s.position.addScaledVector(s.velocity, dt)
        if (s.position.z < 0) s.position.z = 0

        s.padBlast = Math.max(0, 1 - smoothstep(0, 90, s.position.z))
        s.visibility = 1 - smoothstep(FADE_START_ALT, FADE_END_ALT, s.position.z)
        if (s.position.z >= FADE_END_ALT) {
          s.visibility = 0
          s.throttle = 0
          s.engines = 0
          this.enter('away')
        }
        break
      }

      case 'away': {
        s.visibility = 0
        s.throttle = 0
        s.engines = 0
        s.padBlast = Math.max(0, s.padBlast - dt * 0.5)
        if (this.phaseTime >= AWAY_SECONDS) {
          // Re-enters downrange and above, already falling, aimed at the pad —
          // it has been somewhere and come back, not been parked in the sky.
          const path = (ENTRY_PATH_DEG * Math.PI) / 180
          s.position.copy(this.downrange).multiplyScalar(this.entryGroundRange)
          s.position.z = ENTRY_ALT
          s.velocity.copy(this.downrange).multiplyScalar(-Math.sin(path) * ENTRY_SPEED)
          s.velocity.z = -Math.cos(path) * ENTRY_SPEED
          // Set the attitude here too, not on the first 'entry' step: for one
          // frame the phase would otherwise say "falling retrograde" while the
          // axis still held the ascent's pitch. Invisible at this altitude, but
          // a state that disagrees with itself is a trap for the next reader.
          s.axis.copy(s.velocity).multiplyScalar(-1).normalize()
          this.enter('entry')
        }
        break
      }

      case 'entry': {
        // Free fall. Engines cold, riding retrograde so the bells lead.
        s.velocity.z -= MARS_G * dt
        s.position.addScaledVector(s.velocity, dt)
        s.axis.copy(s.velocity).multiplyScalar(-1).normalize()
        s.visibility = smoothstep(FADE_END_ALT, FADE_START_ALT, s.position.z)
        if (s.position.z <= BURN_START_ALT) {
          s.engines = BURN_ENGINES
          this.enter('burn')
        }
        break
      }

      case 'burn': {
        if (s.position.z <= SETTLE_ALT) {
          if (s.engines !== SETTLE_ENGINES) {
            s.engines = SETTLE_ENGINES
            // Start the let-down from whatever the burn actually delivered, so
            // the handover cannot show as a step in the rate or the attitude.
            this.settleSpeed = Math.max(-s.velocity.z, TOUCHDOWN_SPEED)
            this.settleAxis.copy(s.axis)
          }
          this.settle(dt)
          break
        }
        // ZEM/ZEV terminal guidance. Substituting r_f = 0, v_f = 0 and
        // g = (0,0,−g) into a = 6·ZEM/t² − 2·ZEV/t collapses the whole law to
        //
        //     a_thrust = −6·r/t²  −  4·v/t  +  g_up
        //
        // and that closed form is what runs here. Sanity check it straight
        // down: with t = 2h/v it gives exactly v²/2h of net deceleration, the
        // constant-decel stop. This is what makes "lands the exact spot" a
        // property of the control law rather than a snap at the end, and the
        // thrust vector it produces IS the attitude — the vehicle points where
        // it is pushing, which is why it stands itself up as the burn proceeds.
        //
        // t_go IS RECOMPUTED EVERY STEP from the vertical channel. Counting a
        // t_go fixed at ignition down to zero is the classic way to detonate
        // this law: the 6/t² gain diverges while the vehicle is still hundreds
        // of metres up, and it flies away instead of landing.
        const descentRate = Math.max(-s.velocity.z, 1)
        const tgo = Math.max((2 * s.position.z) / descentRate, 0.5)

        const accel = this.scratch.copy(s.position)
          .multiplyScalar(-6 / (tgo * tgo))
          .addScaledVector(s.velocity, -4 / tgo)
        accel.z += MARS_G
        const demand = accel.length()
        if (demand > 1e-4) {
          s.axis.copy(accel).divideScalar(demand)
          // A booster never points its bells above the horizon. Clamping the
          // axis rather than letting the law invert the vehicle is what keeps
          // an over-demanded frame looking like a hard burn.
          if (s.axis.z < 0.15) {
            s.axis.z = 0.15
            s.axis.normalize()
          }
        }
        // Throttle reads out of the demand, so the plume brightens and shrinks
        // with the actual work the guidance is asking for.
        s.throttle = clamp01(demand / MAX_LANDING_ACCEL)
        accel.copy(s.axis).multiplyScalar(Math.min(demand, MAX_LANDING_ACCEL))

        accel.z -= MARS_G
        s.velocity.addScaledVector(accel, dt)
        // A landing burn arrests a fall; it never turns into a hop. If the
        // clamped thrust ever over-corrects, this bounds it at a hover instead
        // of letting the vehicle climb back out of its own approach.
        if (s.velocity.z > 0) s.velocity.z = 0
        s.position.addScaledVector(s.velocity, dt)
        s.visibility = 1
        s.padBlast = Math.max(s.padBlast, 1 - smoothstep(0, 260, s.position.z))
        break
      }

      case 'touchdown': {
        s.throttle = 0
        s.engines = 0
        s.visibility = 1
        // The catch arms already closed on the way down, with the vehicle
        // inside them — that is the whole point of driving them off altitude.
        // Only the umbilical is left to re-mate, and it goes last, as it does.
        s.qdOpen = 1 - smoothstep(PREP_SECONDS * 0.3, TOUCHDOWN_SECONDS, this.phaseTime)
        s.padBlast = Math.max(0, s.padBlast - dt * 0.12)
        if (this.phaseTime >= TOUCHDOWN_SECONDS) this.enter('parked')
        break
      }
    }

    s.altitude = s.position.z
    // ONE function of altitude, for every phase and both directions. The arms
    // spread as the vehicle climbs out through them and close back around it as
    // it comes down, and neither schedule can drift from the other because
    // there is only one. Parked and during the hold this is exactly 0, so they
    // are still mated at ignition.
    s.armOpen = smoothstep(0, ARM_OPEN_ALTITUDE, s.altitude)
  }

  /**
   * The last 90 m: a straight vertical let-down easing from whatever the burn
   * handed over to a 1.4 m/s contact, with the residual lateral driven out over
   * the first part of it rather than snapped — a snap at 90 m is visible, and
   * ZEM/ZEV has already brought it to centimetres by here anyway.
   */
  private settle(dt: number): void {
    const s = this.state
    // v² = v_td² + 2·a·z — CONSTANT DECELERATION, which is not a shape chosen
    // to look nice but the closed form of the profile ZEM/ZEV was already
    // flying (feed t_go = √(2z/a) into −6r/t² − 4v/t and it returns a + g
    // exactly). So the handover costs nothing: same deceleration, same
    // throttle, same attitude — the only thing that changes is that the last
    // metres are solved rather than integrated, so contact is exact.
    const decel = (this.settleSpeed * this.settleSpeed - TOUCHDOWN_SPEED * TOUCHDOWN_SPEED)
      / (2 * SETTLE_ALT)
    const speed = Math.sqrt(Math.max(
      TOUCHDOWN_SPEED * TOUCHDOWN_SPEED + 2 * decel * Math.max(s.position.z, 0),
      TOUCHDOWN_SPEED * TOUCHDOWN_SPEED,
    ))
    const before = Math.max(s.position.z, 1e-4)
    const wasX = s.position.x, wasY = s.position.y
    s.position.z -= speed * dt
    // Walk the residual crossrange out IN PROPORTION TO THE REMAINING HEIGHT,
    // not on a time constant. ZEM/ZEV hands over with ~20 m still to null; a
    // fixed decay eats that in a second and reads as the vehicle sidestepping,
    // while this is a straight line to the mount that reaches zero exactly when
    // the altitude does — and its lateral rate stays a fraction of the descent.
    const shrink = clamp01(Math.max(s.position.z, 0) / before)
    s.position.x *= shrink
    s.position.y *= shrink
    // Velocity is the true derivative of the path above, not an assumed
    // straight drop — the crossrange walk is part of what the vehicle is doing.
    s.velocity.set((s.position.x - wasX) / dt, (s.position.y - wasY) / dt, -speed)
    // Stand up as it comes down: the handover attitude at the top of the
    // settle, exactly vertical at contact, and continuous at both ends.
    const remaining = clamp01(Math.max(s.position.z, 0) / SETTLE_ALT)
    s.axis.copy(UP).lerp(this.settleAxis, Math.pow(remaining, 0.8)).normalize()
    s.throttle = clamp01((decel + MARS_G) / MAX_LANDING_ACCEL)
    s.padBlast = 1

    if (s.position.z <= 0) {
      s.position.set(0, 0, 0)
      s.velocity.set(0, 0, 0)
      s.axis.copy(UP)
      this.enter('touchdown')
    }
  }
}
