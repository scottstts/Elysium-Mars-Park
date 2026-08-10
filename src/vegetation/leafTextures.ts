import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Canvas-painted foliage alpha maps. Painted once at load, deterministic
 * (seeded LCG), crisp at alphaTest — no downloads, no photos.
 */

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A cluster of ginkgo fan leaves on short petioles. */
export function ginkgoClusterTexture(seed = 7): CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, size, size)
    const random = seededRandom(seed)
    for (let i = 0; i < 26; i++) {
      const x = 30 + random() * (size - 60)
      const y = 30 + random() * (size - 60)
      const r = 14 + random() * 20
      const rotation = random() * Math.PI * 2
      const hue = 68 + random() * 26 // yellow-green ginkgo
      const light = 32 + random() * 18
      g.save()
      g.translate(x, y)
      g.rotate(rotation)
      // Fan leaf: a wedge with a notch, on a petiole.
      g.strokeStyle = `hsl(${hue}, 30%, ${light - 8}%)`
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(0, r * 0.9)
      g.lineTo(0, r * 0.2)
      g.stroke()
      g.fillStyle = `hsl(${hue}, ${34 + random() * 14}%, ${light}%)`
      g.beginPath()
      g.moveTo(0, r * 0.25)
      g.arc(0, r * 0.25, r, Math.PI * 1.22, Math.PI * 1.78)
      g.closePath()
      g.fill()
      // The characteristic center notch.
      g.clearRect(-r * 0.035, -r * 0.8, r * 0.07, r * 0.55)
      g.restore()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Loose sedge blades for the bounded beds. */
export function sedgeTexture(seed = 21): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, 128, 256)
    const random = seededRandom(seed)
    for (let i = 0; i < 17; i++) {
      const baseX = 18 + random() * 92
      const lean = (random() - 0.5) * 60
      const height = 150 + random() * 95
      const hue = 74 + random() * 30
      const sat = 18 + random() * 16
      const light = 30 + random() * 16
      g.strokeStyle = `hsl(${hue}, ${sat}%, ${light}%)`
      g.lineWidth = 2.4 + random() * 2
      g.beginPath()
      g.moveTo(baseX, 256)
      g.quadraticCurveTo(baseX + lean * 0.4, 256 - height * 0.6, baseX + lean, 256 - height)
      g.stroke()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Lush crop clump (basil/lettuce rosette) for the greenhouse trays. */
export function cropTexture(seed = 33): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, size, size)
    const random = seededRandom(seed)
    for (let i = 0; i < 15; i++) {
      const angle = random() * Math.PI * 2
      const distance = random() * 34
      const x = size / 2 + Math.cos(angle) * distance
      const y = size / 2 + Math.sin(angle) * distance
      const r = 12 + random() * 15
      const hue = 96 + random() * 30
      g.fillStyle = `hsl(${hue}, ${40 + random() * 20}%, ${28 + random() * 16}%)`
      g.beginPath()
      g.ellipse(x, y, r, r * (0.55 + random() * 0.3), angle, 0, Math.PI * 2)
      g.fill()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
