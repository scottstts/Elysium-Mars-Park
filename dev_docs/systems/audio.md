# Audio (S13)

- 100% procedural WebAudio (`src/audio/engine.ts`), no assets, NO music
  (canon). AudioContext starts on the BOARD click (the one real gesture).
- Beds: dome room tone (brown noise → 190 Hz lowpass), HVAC breath
  (bandpass 520 Hz + 0.05 Hz swell LFO), interior hush bed (crossfaded).
- Zones: `park | interior | tram | tube`, classified per frame from player
  position + tram riding state. Interiors detected by plan footprints
  (lounge, enterable greenhouse). Crossfade at ~3/s; a master lowpass
  drops to 4.2 kHz in the cabin and 900 Hz in the tube — the "duct" sound.
- Footsteps: stride accumulator on real eye travel (1.95 m), gated off
  while seated. Surface classification: station pad footprint → deck,
  distance-to-PATHS segments (paver only) → paver, else regolith;
  interior zone → muted interior step. Each step is a filtered noise
  burst with per-surface band/decay.
- Point sources use PannerNode (inverse distance): 4 robot servos (thin
  saws behind tight bandpass, pitch up when moving), tram rail-sing
  (resonant noise + 80–160 Hz tone ∝ speed), greenhouse mist hiss (only
  during the 10 s/90 s misting window), reclaimer vent hiss (slow sine
  breathing).
- Sparse thermal glass ticks: 3.4 kHz pings with random stereo pan every
  8–25 s (sim-clock hashed, deterministic).
- Tram door chime: two-tone (988/740 Hz) on `tram/docked`.
- Private-field peeks into tram/robots use runtime casts — TS `private`
  is compile-time only; keep field names in sync if refactoring
  (`tram.cars/speed/riding`, `robots.robots[].rig/state/speed`).
