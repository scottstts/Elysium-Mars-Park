/**
 * Boot gate — the ONLY module index.html loads. Elysium Commons is a desktop
 * Chromium application (owner directive, 2026-08-11): on an eligible platform
 * this dynamically imports the real entry (`main.ts`, which self-boots), so
 * vite splits the whole game behind that import and an ineligible device
 * never downloads a single game chunk. On everything else it mounts SHEET 00,
 * the responsive notice plate, and stops — the game does not load at all.
 * WebGPU presence is NOT gated here: a desktop Chromium without WebGPU still
 * loads main.ts and gets its detailed WebGPU error path on the entry screen.
 */
import { createPlatformGate, detectPlatform } from './ui/platformGate'

const verdict = detectPlatform()
if (verdict.eligible) {
  void import('./main').catch(async (error: unknown) => {
    console.error('[boot] Failed to load the game module.', error)
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    try {
      // Keep the eligibility gate lightweight on the success path; the full
      // entry plate is loaded only if the actual game module fails to load.
      const { createEntryScreen } = await import('./ui/entryScreen')
      createEntryScreen(document.body).showError('Loading failed', `Stage module-import · ${detail}`)
    } catch {
      // Last-resort surface for a broken chunk/module graph. No renderer or
      // game UI can be trusted in this branch, so use only DOM primitives.
      const message = document.createElement('pre')
      message.textContent = `Elysium Commons failed to load.\n${detail}`
      message.style.cssText = 'position:fixed;inset:0;margin:0;padding:32px;background:#090909;color:#eee;white-space:pre-wrap;font:14px/1.5 monospace;z-index:2147483647'
      document.body.appendChild(message)
    }
  })
} else {
  createPlatformGate(document.body, verdict)
}
