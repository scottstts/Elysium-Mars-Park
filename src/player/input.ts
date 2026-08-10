/**
 * Keyboard + pointer-lock mouse state. The player system consumes this; the
 * interaction system reads `usePressed` edges. Input is collected on DOM
 * events and drained by fixed updates, so no press is lost between steps.
 */
export class PlayerInput {
  forward = 0
  strafe = 0
  sprint = false
  jumpQueued = false
  useQueued = false
  yawDelta = 0
  pitchDelta = 0
  pointerLocked = false

  private readonly keys = new Set<string>()
  private readonly element: HTMLElement

  constructor(element: HTMLElement) {
    this.element = element
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onLockChange)
  }

  requestLock(): void {
    if (this.pointerLocked) return
    try {
      // Headless/hidden panes reject pointer lock; treat it as best-effort.
      const result = this.element.requestPointerLock() as unknown as
        | Promise<void>
        | undefined
      result?.catch?.(() => {})
    } catch {
      /* pointer lock unavailable — mouse look simply stays inactive */
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    this.keys.add(event.code)
    if (event.code === 'Space') this.jumpQueued = true
    if (event.code === 'KeyE') this.useQueued = true
    this.refreshAxes()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
    this.refreshAxes()
  }

  private refreshAxes(): void {
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    this.forward = forward
    this.strafe = strafe
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return
    this.yawDelta += event.movementX
    this.pitchDelta += event.movementY
  }

  private readonly onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element
  }

  /** Read-and-clear the accumulated mouse deltas (per render frame). */
  drainLook(): { yaw: number; pitch: number } {
    const yaw = this.yawDelta
    const pitch = this.pitchDelta
    this.yawDelta = 0
    this.pitchDelta = 0
    return { yaw, pitch }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onLockChange)
  }
}
