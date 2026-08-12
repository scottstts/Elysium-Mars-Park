/**
 * Worker entry for the Optimus build.
 *
 * The port spends ~1 s in the part generators and ~2 s in the bevel/boolean/
 * split-normal pass — pure single-threaded CPU with no DOM and no GPU. On the
 * main thread that is a three-second freeze behind the entry screen; here it
 * overlaps every other system's init and the progress bar keeps moving.
 *
 * Nothing in this module's import graph touches three.js, so the worker chunk
 * carries the geometry kernels alone.
 */
import { buildOptimusPayload } from './optimusBuild'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

scope.onmessage = (): void => {
  const payload = buildOptimusPayload()
  const transfer: Transferable[] = []
  for (const lod of payload.lods) {
    transfer.push(lod.position.buffer, lod.normal.buffer, lod.index.buffer)
  }
  scope.postMessage(payload, transfer)
}
