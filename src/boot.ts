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
  void import('./main')
} else {
  createPlatformGate(document.body, verdict)
}
