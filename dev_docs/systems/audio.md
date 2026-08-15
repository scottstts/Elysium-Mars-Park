# Audio (S13)

- 100% procedural WebAudio (`src/audio/engine.ts`), no assets, NO music
  (canon). The AudioContext is created/resumed on the BOARD click (the one
  real gesture) with master gain at zero. `render/started` is emitted only
  after the first unpaused gameplay render submission; that event releases
  the master over 60 ms. Audio can therefore never run ahead of a slow first
  frame, while browser autoplay activation is still consumed correctly.
- Beds: dome room tone (brown noise → 190 Hz lowpass), HVAC breath
  (bandpass 520 Hz + 0.05 Hz swell LFO), interior hush bed (crossfaded).
- Zones: `park | interior | tram | tube`, classified per frame from player
  position + tram riding state. Interiors detected by plan footprints
  (lounge, enterable greenhouse). Crossfade at ~3/s; a master lowpass
  drops to 4.2 kHz in the cabin and 900 Hz in the tube — the "duct" sound.
- Footsteps: fired off `PlayerSystem.stepCount` (one per bob-phase plant;
  cadence 2.5 steps/s walk → 4.0 sprint, owner spec 2026-08-11), swallowed
  silently while seated so alighting never replays stale steps. The old
  metres-accumulator (1.95 m/step) is gone — it ran at 0.82 steps/s against
  a 1.57 Hz camera bob, two visibly disagreeing clocks. Surface
  classification: station pad footprint → deck, distance-to-PATHS segments
  (paver only) → paver, else regolith; interior zone → muted interior step.
  Each step is a filtered noise burst with per-surface band/decay.
- Point sources use PannerNode (inverse distance): the 4 wheeled robots
  (`src/audio/robotVoice.ts`, below), tram rail-sing (resonant noise +
  80–160 Hz tone ∝ speed), greenhouse mist hiss (only during the 10 s/90 s
  misting window), reclaimer vent hiss (slow sine breathing).
- Wheeled fleet voice (`src/audio/robotVoice.ts`, owner call 2026-08-13 —
  the previous version was a fixed 1150–1670 Hz saw behind a Q=6 bandpass
  at 1500–1860 Hz, always on: a pure tone in the ear's most sensitive band
  that read as a *ring*, not a machine). Rule taken from it: **keep steady
  point-source loops broadband and out of 2–4 kHz; a high-Q band on a saw
  is a whistle.** Four layers per rig, all under ~900 Hz — drive hum (saw →
  lowpass that opens with load), gear mesh (triangle at 4.5× the
  fundamental, capped 560 Hz), roll grit (brown noise bandpassed by wheel
  size), and a 900 Hz brush swish for rigs with `spinners` (the sweeper).
  Drive pitch is the motor pole-passing rate derived from real wheel
  revs/s; **ground speed is measured from the frame position delta, not
  read off `robot.speed`**, so a robot stopped to yield to the player (held
  in state `'moving'` by the routine) actually falls quiet. Idle is a
  whisper of hum only; while `'working'` the grit layer swells on
  `|sin(toolPhase · 2.2)|` — the same term robotsSystem bobs the rake and
  brush carriage with, so stroke and sound are one event.
- Sparse thermal glass ticks: 3.4 kHz pings with random stereo pan every
  8–25 s (sim-clock hashed, deterministic).
- Tram door chime: two-tone (988/740 Hz) on `tram/docked`.
- Private-field peeks into tram/robots use runtime casts — TS `private`
  is compile-time only; keep field names in sync if refactoring
  (`tram.cars/speed/riding`, and `RobotAudioSource` in robotVoice.ts:
  `robots.robots[].rig.group.position / rig.wheelRadius / rig.spinners /
  state / toolPhase`).
- THE FOUNTAIN retains inverse-distance/directional PannerNode placement but
  adds a finite post-panner masking gate. Acoustic calibration is 55 dBA at 7
  m against the 42 dBA dome bed: spherical spreading reaches equal level at
  31.3 m and −6 dB at 62.4 m, so gain smoothsteps across that interval and is
  exactly zero beyond it. Do not restore an arbitrary non-zero floor.
