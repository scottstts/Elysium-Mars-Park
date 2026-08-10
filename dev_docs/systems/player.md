# Player & interaction (S6)

- Rapier kinematic character controller: capsule 0.35 r × 1.8 total, offset
  0.06, autostep 0.42/0.28, snap 0.35, slopes 52°/58°. Walk 1.6, sprint 4.2,
  accel split ground/air (14/2.2) so airborne steering is deliberately weak.
- **True 0.38 g verified numerically**: jump v₀ 3.0 → measured apex +1.24 m,
  hang ≈ 1.55 s (predictions 1.21 m / 1.62 s). Do not tune gravity for feel;
  tune v₀/accel only (canon).
- Fixed-step sim writes prev/current body positions; update() lerps by the
  loop's alpha — camera never sees stepped motion on ProMotion displays.
- Lope headbob: energy follows planar speed, phase rate 0.9+0.42·speed —
  slow long strides, amplitude 4.5 cm max, lateral 55% of vertical. Felt,
  not seen. Zeroed airborne.
- Yaw 0 faces north (−Z); camera rotation order 'YXZ'.
- Interaction: view-cone scored pick (distance × alignment), single DOM
  caption `[E] label`, KeyE edge consumed from the input queue.
  `InteractionSystem.register()` returns an unsubscribe. No other in-play UI.
- `?view=` bookmarks keep DevOrbit; the player exists only in the normal
  path. Rapier heightfield indexing is COLUMN-major — see physicsWorld
  comment; the transposed fill bug cost a probe cycle (S6).
- Probing lesson: BOARD click → unpause happens in a microtask; headless
  probes must yield (setTimeout) between click and stepping or every step
  runs paused.
