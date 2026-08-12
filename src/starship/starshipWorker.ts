/**
 * Worker entry for the Starship / OLIT build.
 *
 * ~420 ms of pure single-threaded CPU with no DOM and no GPU — off the main
 * thread it overlaps every other system's init instead of stalling a frame.
 * Nothing in this module's import graph touches three.js, so the worker chunk
 * carries the sslib kernels alone.
 */
import { buildStarshipPayload } from './starshipBuild'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

scope.onmessage = (): void => {
  const payload = buildStarshipPayload()
  const transfer: Transferable[] = []
  for (const part of payload.parts) {
    transfer.push(part.position.buffer, part.normal.buffer, part.uv.buffer)
  }
  scope.postMessage(payload, transfer)
}
