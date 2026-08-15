import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'

/**
 * Canvas-painted foliage art. Every species in the park is drawn here once at
 * load from a seeded LCG — deterministic, no downloads, no photographs.
 *
 * Three craft rules govern every painter below, learned the hard way:
 *
 * 1. **Alpha is the silhouette; colour must bleed past it.** A crisp shape on
 *    a fully transparent canvas mips into a dark halo, because the RGB of an
 *    a=0 texel is black and the filter averages it in. Every painter therefore
 *    lays a blurred, low-alpha `bleed` copy of its own shape first. The bleed's
 *    alpha stays far under `alphaTest`, so the cut-out is unchanged, but the
 *    colour that leaks into the mip chain is leaf-coloured.
 * 2. **Draw the venation, not a blob.** The fan rays of a ginkgo and the
 *    pinnae of a fern are the difference between "a plant" and "a green card".
 *    At 0.5 m in a planter the player reads veins.
 * 3. **Paint darker than you think.** These sit under a warm key and a grade
 *    that protects green dominance; a canvas that looks right on a white page
 *    renders as neon. Foliage lightness lives in the 22–46 % band.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

interface Sheet {
  canvas: HTMLCanvasElement
  g: CanvasRenderingContext2D
  size: number
}

function sheet(size: number, height = size): Sheet {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = height
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  g.clearRect(0, 0, size, height)
  g.lineJoin = 'round'
  g.lineCap = 'round'
  return { canvas, g, size }
}

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/**
 * Run `paint` twice: once heavily blurred at low alpha (the colour bleed that
 * keeps mip levels from going black around the cut-out), then crisp on top.
 */
function withBleed(g: CanvasRenderingContext2D, paint: () => void): void {
  g.save()
  g.filter = 'blur(7px)'
  g.globalAlpha = 0.22
  paint()
  g.restore()
  g.save()
  paint()
  g.restore()
}

function leafFill(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: Array<[number, string]>,
): CanvasGradient {
  const grad = g.createLinearGradient(x0, y0, x1, y1)
  for (const [at, color] of stops) grad.addColorStop(at, color)
  return grad
}

// ───────────────────────────────────────────────────────── the First Tree ──

/**
 * One ginkgo leaf, rooted at its petiole. Short-shoot clustering belongs to
 * growth topology, not to the texture: painting ten leaves on one card and
 * then crossing two such cards makes an opaque blob at close range.
 * Dichotomous venation radiates from the petiole and forks once, which is the
 * single feature that says "ginkgo" at a glance. Attachment is bottom-centre
 * (v = 0), so the wind term roots the card at the wood.
 */
export function ginkgoLeafTexture(seed = 91, size = 512): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 512

  const fanLeaf = (
    cx: number,
    cy: number,
    radius: number,
    angle: number,
    gold: number,
  ): void => {
    g.save()
    g.translate(cx, cy)
    g.rotate(angle)
    // Petiole: thin, pale, and slightly bowed — leaves hang off it.
    g.strokeStyle = `hsl(64, 22%, ${30 + gold * 8}%)`
    g.lineWidth = 3.2 * s
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(radius * 0.06, -radius * 0.3, 0, -radius * 0.58)
    g.stroke()

    g.translate(0, -radius * 0.58)
    // The blade: a sector with a wavy distal margin and the central cleft.
    const half = 0.62 // half-angle of the fan
    const wave = (t: number): number =>
      radius * (1 + Math.sin(t * 11 + angle * 3) * 0.035 + Math.cos(t * 5.5) * 0.02)
    g.beginPath()
    g.moveTo(0, 0)
    for (let i = 0; i <= 26; i++) {
      const t = i / 26
      // The cleft: the margin dives back toward the base at the centre.
      const cleft = 1 - 0.34 * Math.exp(-((t - 0.5) ** 2) / 0.0022)
      const a = -Math.PI / 2 + (t * 2 - 1) * half
      const r = wave(t) * cleft
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    // Ginkgo in leaf is GREEN with a warm margin; full autumn gold is a
    // two-week event and a canopy painted that way renders cream once the
    // material's warm tint and the backlight are stacked on top of it.
    g.fillStyle = leafFill(g, 0, 0, 0, -radius, [
      [0, `hsl(${102 - gold * 12}, 36%, ${18 + gold * 4}%)`],
      [0.55, `hsl(${94 - gold * 14}, 40%, ${23 + gold * 6}%)`],
      [1, `hsl(${80 - gold * 16}, ${42 + gold * 14}%, ${27 + gold * 9}%)`],
    ])
    g.fill()

    // Dichotomous venation: rays from the petiole, each forking once.
    g.strokeStyle = `hsla(72, ${32 + gold * 16}%, ${38 + gold * 12}%, 0.32)`
    g.lineWidth = 1.15 * s
    for (let i = 1; i < 22; i++) {
      const t = i / 22
      const a = -Math.PI / 2 + (t * 2 - 1) * half * 0.96
      const cleft = 1 - 0.34 * Math.exp(-((t - 0.5) ** 2) / 0.0022)
      const r = wave(t) * cleft
      const fork = 0.56
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(Math.cos(a) * r * fork, Math.sin(a) * r * fork)
      const spread = 0.045
      g.lineTo(Math.cos(a - spread) * r * 0.99, Math.sin(a - spread) * r * 0.99)
      g.moveTo(Math.cos(a) * r * fork, Math.sin(a) * r * fork)
      g.lineTo(Math.cos(a + spread) * r * 0.99, Math.sin(a + spread) * r * 0.99)
      g.stroke()
    }
    // A warmer rim: autumn gold starts at the margin on a ginkgo.
    g.strokeStyle = `hsla(56, 50%, ${34 + gold * 14}%, ${0.14 + gold * 0.24})`
    g.lineWidth = 2.6 * s
    g.beginPath()
    for (let i = 0; i <= 26; i++) {
      const t = i / 26
      const cleft = 1 - 0.34 * Math.exp(-((t - 0.5) ** 2) / 0.0022)
      const a = -Math.PI / 2 + (t * 2 - 1) * half
      const r = wave(t) * cleft * 0.985
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.stroke()
    g.restore()
  }

  withBleed(g, () => {
    fanLeaf(256 * s, 500 * s, 286 * s, 0, 0.24 + random() * 0.36)
  })
  return finish(canvas)
}

// ─────────────────────────────────────────────────────── planter species ──

/**
 * A fern-analog frond: a curved rachis carrying ~15 pairs of lobed pinnae
 * that shorten toward the tip. Rooted bottom-centre.
 */
export function fernFrondTexture(seed = 17, size = 512): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 512

  const rachis = (t: number): [number, number] => [
    (256 + Math.sin(t * 1.5) * 26 * t) * s,
    (500 - t * 452) * s,
  ]

  withBleed(g, () => {
    // Rachis first so the pinnae bury their bases in it.
    g.strokeStyle = 'hsl(88, 24%, 27%)'
    g.lineWidth = 7 * s
    g.beginPath()
    for (let i = 0; i <= 24; i++) {
      const [x, y] = rachis(i / 24)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()

    const pairs = 11
    for (let i = 0; i < pairs; i++) {
      const t = 0.06 + (i / pairs) * 0.92
      const [x, y] = rachis(t)
      // Pinna length peaks a third of the way up, then tapers to the tip.
      const shape = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.82)
      const len = (48 + shape * 152) * s
      const tone = 24 + t * 12 + random() * 5
      for (const side of [-1, 1] as const) {
        const droop = 0.42 + t * 0.34
        g.save()
        g.translate(x, y)
        g.rotate(side * (Math.PI / 2 - droop) + (random() - 0.5) * 0.12)
        // A lobed leaflet: sawtooth margin on the distal side.
        g.beginPath()
        g.moveTo(0, 0)
        const lobes = 7
        for (let l = 0; l <= lobes; l++) {
          const u = l / lobes
          const w = (14 + (1 - u) * 12) * s * (0.5 + shape * 0.6)
          g.quadraticCurveTo(len * (u + 0.5 / lobes), -w, len * (u + 1 / lobes), -w * 0.42)
        }
        g.lineTo(len, 0)
        for (let l = lobes; l >= 0; l--) {
          const u = l / lobes
          const w = (12 + (1 - u) * 11) * s * (0.5 + shape * 0.6)
          g.quadraticCurveTo(len * (u + 0.5 / lobes), w * 0.86, len * u, w * 0.34)
        }
        g.closePath()
        g.fillStyle = leafFill(g, 0, 0, len, 0, [
          [0, `hsl(${104 + random() * 8}, 30%, ${tone}%)`],
          [1, `hsl(${92 + random() * 10}, 36%, ${tone + 9}%)`],
        ])
        g.fill()
        // Midvein.
        g.strokeStyle = `hsla(94, 30%, ${tone + 20}%, 0.4)`
        g.lineWidth = 1.6 * s
        g.beginPath()
        g.moveTo(2 * s, 0)
        g.lineTo(len * 0.94, 0)
        g.stroke()
        g.restore()
      }
    }
  })
  return finish(canvas)
}

/**
 * The dark glossy broadleaf that dominates the reference image's foreground
 * planters: a spray of 5 elliptic blades with pinnate venation and a specular
 * sheen band along the upper half of each blade.
 */
export function broadLeafTexture(seed = 43, size = 512): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 512

  const blade = (x: number, y: number, angle: number, len: number, wide: number, tone: number): void => {
    g.save()
    g.translate(x, y)
    g.rotate(angle)
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(wide * 0.9, -len * 0.24, wide, -len * 0.66, 0, -len)
    g.bezierCurveTo(-wide, -len * 0.66, -wide * 0.9, -len * 0.24, 0, 0)
    g.closePath()
    g.fillStyle = leafFill(g, -wide, 0, wide, -len, [
      [0, `hsl(${138 + random() * 12}, 34%, ${tone - 5}%)`],
      [0.5, `hsl(${128 + random() * 10}, 38%, ${tone}%)`],
      [1, `hsl(${118 + random() * 10}, 30%, ${tone + 7}%)`],
    ])
    g.fill()
    // Sheen: a soft highlight band, the reason these read as waxy.
    g.globalAlpha = 0.2
    g.fillStyle = `hsl(96, 40%, ${tone + 26}%)`
    g.beginPath()
    g.ellipse(-wide * 0.22, -len * 0.52, wide * 0.3, len * 0.24, -0.22, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
    // Midrib + laterals.
    g.strokeStyle = `hsla(84, 34%, ${tone + 24}%, 0.46)`
    g.lineWidth = 2.4 * s
    g.beginPath()
    g.moveTo(0, -len * 0.03)
    g.lineTo(0, -len * 0.95)
    g.stroke()
    g.lineWidth = 1.3 * s
    for (let i = 1; i <= 7; i++) {
      const u = i / 8
      const yv = -len * u
      const reach = wide * (1 - Math.abs(u - 0.45) * 1.05)
      for (const side of [-1, 1] as const) {
        g.beginPath()
        g.moveTo(0, yv)
        g.quadraticCurveTo(side * reach * 0.55, yv - len * 0.03, side * reach * 0.86, yv - len * 0.1)
        g.stroke()
      }
    }
    g.restore()
  }

  withBleed(g, () => {
    // Short stems from the crown.
    g.strokeStyle = 'hsl(70, 20%, 24%)'
    g.lineWidth = 6 * s
    for (const a of [-0.62, -0.24, 0.1, 0.44, 0.72]) {
      g.beginPath()
      g.moveTo(256 * s, 506 * s)
      g.quadraticCurveTo((256 + Math.sin(a) * 70) * s, 390 * s, (256 + Math.sin(a) * 128) * s, 300 * s)
      g.stroke()
    }
    const spread = [-0.7, -0.3, 0.02, 0.36, 0.72]
    for (let i = 0; i < spread.length; i++) {
      const a = spread[i] + (random() - 0.5) * 0.16
      const reach = (150 + random() * 120) * s
      blade(
        (256 + Math.sin(a) * reach * 0.5) * s,
        (500 - Math.cos(a) * reach * 0.42) * s,
        a * 0.86,
        (190 + random() * 110) * s,
        (52 + random() * 26) * s,
        22 + i * 2 + random() * 6,
      )
    }
  })
  return finish(canvas)
}

/** Low mat of small spatulate leaves — the filler between the hero plants. */
export function groundcoverTexture(seed = 59, size = 256): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 256

  withBleed(g, () => {
    for (let layer = 0; layer < 3; layer++) {
      const count = 16 - layer * 3
      for (let i = 0; i < count; i++) {
        const a = (random() - 0.5) * 2.5
        const reach = (34 + random() * 74) * s * (1 - layer * 0.14)
        const x = 128 * s + Math.sin(a) * reach
        const y = (250 - layer * 26) * s - Math.cos(a) * reach * 0.62
        const len = (26 + random() * 30) * s
        const wide = len * (0.38 + random() * 0.2)
        g.save()
        g.translate(x, y)
        g.rotate(a * 0.7 + (random() - 0.5) * 0.5)
        g.beginPath()
        g.ellipse(0, -len * 0.5, wide, len * 0.5, 0, 0, Math.PI * 2)
        const tone = 20 + layer * 5 + random() * 8
        g.fillStyle = `hsl(${146 - layer * 8 + random() * 14}, ${30 + random() * 12}%, ${tone}%)`
        g.fill()
        g.strokeStyle = `hsla(90, 30%, ${tone + 20}%, 0.4)`
        g.lineWidth = 1.4 * s
        g.beginPath()
        g.moveTo(0, -len * 0.08)
        g.lineTo(0, -len * 0.9)
        g.stroke()
        g.restore()
      }
    }
  })
  return finish(canvas)
}

/**
 * A trailing sprig for the coping spill: a stem with paired ovate leaves,
 * drawn radiating from the bottom so the wind term still roots the card; the
 * geometry lays it over the wall.
 */
export function trailingSprigTexture(seed = 71, size = 256): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 256

  withBleed(g, () => {
    for (const branch of [-0.4, 0.0, 0.42]) {
      const sway = branch + (random() - 0.5) * 0.2
      const path = (t: number): [number, number] => [
        (128 + Math.sin(sway) * 96 * t + Math.sin(t * 4 + sway) * 9) * s,
        (250 - t * 224) * s,
      ]
      g.strokeStyle = 'hsl(74, 22%, 26%)'
      g.lineWidth = 3.6 * s
      g.beginPath()
      for (let i = 0; i <= 16; i++) {
        const [x, y] = path(i / 16)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      for (let i = 1; i <= 8; i++) {
        const t = i / 9
        const [x, y] = path(t)
        const len = (16 + (1 - t) * 20) * s
        for (const side of [-1, 1] as const) {
          g.save()
          g.translate(x, y)
          g.rotate(side * 1.15 + sway * 0.5 + (random() - 0.5) * 0.3)
          g.beginPath()
          g.moveTo(0, 0)
          g.bezierCurveTo(len * 0.44, -len * 0.34, len * 0.9, -len * 0.22, len, 0)
          g.bezierCurveTo(len * 0.9, len * 0.22, len * 0.44, len * 0.34, 0, 0)
          g.closePath()
          const tone = 24 + random() * 10
          g.fillStyle = `hsl(${132 + random() * 18}, ${28 + random() * 12}%, ${tone}%)`
          g.fill()
          g.restore()
        }
      }
    }
  })
  return finish(canvas)
}

/**
 * The rationed accent: a spray of small five-petal flowers in dusty blue and
 * chalk white with grey-green foliage. Deliberately desaturated — a saturated
 * flower on Mars reads as a plastic prop.
 */
export function flowerSprayTexture(seed = 83, size = 256): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 256

  withBleed(g, () => {
    // Grey-green foliage under the flowers.
    for (let i = 0; i < 10; i++) {
      const a = (random() - 0.5) * 2.2
      const len = (34 + random() * 40) * s
      g.save()
      g.translate((128 + Math.sin(a) * 44) * s, (250 - random() * 40) * s)
      g.rotate(a * 0.8)
      g.beginPath()
      g.ellipse(0, -len * 0.5, len * 0.16, len * 0.5, 0, 0, Math.PI * 2)
      g.fillStyle = `hsl(${118 + random() * 20}, 16%, ${26 + random() * 8}%)`
      g.fill()
      g.restore()
    }
    // Stems.
    g.strokeStyle = 'hsl(96, 14%, 30%)'
    g.lineWidth = 2.4 * s
    const heads: Array<[number, number, number]> = []
    for (let i = 0; i < 9; i++) {
      const a = (random() - 0.5) * 1.5
      const reach = (78 + random() * 96) * s
      const hx = 128 * s + Math.sin(a) * reach * 0.62
      const hy = 248 * s - Math.cos(a * 0.4) * reach
      g.beginPath()
      g.moveTo(128 * s, 250 * s)
      g.quadraticCurveTo((128 + Math.sin(a) * reach * 0.2) * s, (250 * s + hy) / 2, hx, hy)
      g.stroke()
      heads.push([hx, hy, random()])
    }
    for (const [hx, hy, tone] of heads) {
      const r = (9 + tone * 7) * s
      const blue = tone > 0.42
      const petal = blue
        ? `hsl(${218 + tone * 18}, ${24 + tone * 14}%, ${52 + tone * 10}%)`
        : `hsl(48, 12%, ${74 + tone * 10}%)`
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + tone * 3
        g.save()
        g.translate(hx, hy)
        g.rotate(a)
        g.beginPath()
        g.ellipse(0, -r * 0.62, r * 0.42, r * 0.66, 0, 0, Math.PI * 2)
        g.fillStyle = petal
        g.fill()
        g.restore()
      }
      g.beginPath()
      g.arc(hx, hy, r * 0.3, 0, Math.PI * 2)
      g.fillStyle = blue ? 'hsl(52, 40%, 66%)' : 'hsl(46, 34%, 56%)'
      g.fill()
    }
  })
  return finish(canvas)
}

/** Needle fascicles for the dwarf pine-analog: a short twig of paired needles. */
export function pineSprayTexture(seed = 29, size = 256): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 256

  withBleed(g, () => {
    g.strokeStyle = 'hsl(30, 22%, 24%)'
    g.lineWidth = 5 * s
    g.beginPath()
    g.moveTo(128 * s, 252 * s)
    g.quadraticCurveTo(132 * s, 150 * s, 128 * s, 62 * s)
    g.stroke()
    for (let i = 0; i < 26; i++) {
      const t = 0.05 + (i / 26) * 0.95
      const y = (252 - t * 196) * s
      const x = (128 + Math.sin(t * 2.4) * 5) * s
      const len = (30 + (1 - t) * 26 + random() * 12) * s
      for (const side of [-1, 1] as const) {
        for (let n = 0; n < 3; n++) {
          const spread = 0.72 + n * 0.2 + random() * 0.14
          g.strokeStyle = `hsl(${138 + random() * 16}, ${26 + random() * 12}%, ${20 + n * 3 + random() * 7}%)`
          g.lineWidth = (2.4 - n * 0.35) * s
          g.beginPath()
          g.moveTo(x, y)
          g.quadraticCurveTo(
            x + side * len * 0.5,
            y - len * 0.34,
            x + side * Math.sin(spread) * len,
            y - Math.cos(spread) * len,
          )
          g.stroke()
        }
      }
    }
  })
  return finish(canvas)
}

// ───────────────────────────────────────────────────────── greenhouse ──

/**
 * A hydroponic salad head seen from the side: crinkled outer leaves and a
 * paler heart. `chard` swaps in the red-ribbed variety so the trays are not
 * one repeated plant down thirty metres of bench.
 */
export function cropHeadTexture(seed = 37, chard = false, size = 256): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 256

  withBleed(g, () => {
    for (let layer = 0; layer < 3; layer++) {
      const count = 9 - layer * 2
      for (let i = 0; i < count; i++) {
        const f = count === 1 ? 0.5 : i / (count - 1)
        const a = (f - 0.5) * (2.3 - layer * 0.55) + (random() - 0.5) * 0.24
        const len = (78 + layer * 26 + random() * 40) * s
        const wide = len * (0.42 - layer * 0.05)
        g.save()
        g.translate(128 * s, (250 - layer * 20) * s)
        g.rotate(a)
        // Crinkled margin: a wavy blade edge rather than a clean ellipse.
        g.beginPath()
        g.moveTo(0, 0)
        for (let k = 0; k <= 12; k++) {
          const u = k / 12
          const w = wide * Math.sin(u * Math.PI) * (1 + Math.sin(u * 14 + i) * 0.13)
          g.lineTo(w, -len * u)
        }
        for (let k = 12; k >= 0; k--) {
          const u = k / 12
          const w = wide * Math.sin(u * Math.PI) * (1 + Math.cos(u * 13 + i) * 0.13)
          g.lineTo(-w, -len * u)
        }
        g.closePath()
        const tone = 26 + layer * 8 + random() * 7
        g.fillStyle = leafFill(g, 0, 0, 0, -len, [
          [0, `hsl(${96 + random() * 12}, ${34 + layer * 6}%, ${tone}%)`],
          [1, `hsl(${84 + random() * 14}, ${40 + layer * 8}%, ${tone + 12}%)`],
        ])
        g.fill()
        g.strokeStyle = chard
          ? `hsla(${8 + random() * 12}, 52%, ${44 + layer * 6}%, 0.6)`
          : `hsla(80, 30%, ${tone + 22}%, 0.42)`
        g.lineWidth = (chard ? 3.2 : 1.8) * s
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(0, -len * 0.92)
        g.stroke()
        g.restore()
      }
    }
  })
  return finish(canvas)
}

/**
 * Back-compatible alias. `world/districts/commons.ts` binds this as a `map`
 * for its planted interior shelves — keep the name and the signature.
 */
export function cropTexture(seed = 33): CanvasTexture {
  return cropHeadTexture(seed, false, 256)
}

/** A tray of seedlings: the first-week growth stage, tiny paired cotyledons. */
export function seedlingTexture(seed = 13, size = 128): CanvasTexture {
  const { canvas, g } = sheet(size)
  const random = seeded(seed)
  const s = size / 128

  withBleed(g, () => {
    for (let i = 0; i < 7; i++) {
      const x = (18 + random() * 92) * s
      const h = (28 + random() * 34) * s
      g.strokeStyle = `hsl(${96 + random() * 16}, 34%, ${30 + random() * 8}%)`
      g.lineWidth = 2.2 * s
      g.beginPath()
      g.moveTo(x, 124 * s)
      g.lineTo(x + (random() - 0.5) * 8 * s, 124 * s - h)
      g.stroke()
      for (const side of [-1, 1] as const) {
        g.save()
        g.translate(x, 124 * s - h)
        g.rotate(side * 0.9)
        g.beginPath()
        g.ellipse(side * 7 * s, 0, 9 * s, 4.6 * s, 0, 0, Math.PI * 2)
        g.fillStyle = `hsl(${88 + random() * 16}, 40%, ${34 + random() * 10}%)`
        g.fill()
        g.restore()
      }
    }
  })
  return finish(canvas)
}
