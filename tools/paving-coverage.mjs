/**
 * PAVED-FLOOR COVERAGE PROOF + per-slot self-overlap clustering.
 *
 *     node --experimental-strip-types tools/paving-coverage.mjs [--cell=0.15]
 *
 * Two independent measurements of the same mesh, neither of which needs a
 * browser (vite full-reloads every few seconds while several agents edit
 * `src/`, and any in-page eval longer than ~10 s dies).
 *
 *  1. COVERAGE RASTER — the honest answer to "does the paved floor tile its
 *     own plan exactly once?". A grid over the union of PAVED_REGIONS,
 *     counting how many `ground:paving` triangles cover each sample:
 *     0 = HOLE in a walkable floor, >1 = stacked slabs (z-fight).
 *     Same proof the glasshouse panes got (dev_docs/notes.md).
 *     Samples within SKIN of any region boundary are reported separately:
 *     there a chord-vs-analytic mismatch of a few mm is expected and is not
 *     evidence of a logic defect.
 *
 *  2. SELF-OVERLAP — the shipped gate's own coplanar test (audit.ts constants
 *     and clip, replicated so the numbers are comparable), but BUCKETED BY
 *     POSITION: `auditGeometry`'s single `at` is useless on an aggregate.
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* fall through */
      }
    }
    return next(specifier, context)
  },
})

// --- DOM stub: the ground materials build canvas-backed lookup textures. -----
const ctx2d = new Proxy(function () {}, {
  get: (_t, key) => (key === 'canvas' ? canvasStub : ctx2d),
  set: () => true,
  apply: () => ctx2d,
})
const canvasStub = {
  width: 4,
  height: 4,
  style: {},
  getContext: () => ctx2d,
  toDataURL: () => '',
  addEventListener: () => {},
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? { ...canvasStub } : { style: {}, appendChild: () => {} }),
  createElementNS: () => ({ style: {} }),
  body: { appendChild: () => {} },
  addEventListener: () => {},
}
globalThis.window = globalThis.window ?? { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener: () => {} }
globalThis.self = globalThis.self ?? globalThis

const ROOT = 'file:///Users/scott/Documents/Projects/Node/mars_park'
const { buildPaving } = await import(`${ROOT}/src/world/paving.ts`)
const { PAVED_REGIONS, regionDistance } = await import(`${ROOT}/src/world/pavingPlan.ts`)

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const CELL = Number(args.get('cell') ?? 0.15)
const TOP = Number(args.get('top') ?? 10)
/** Distance from ANY region boundary inside which chord/analytic mismatch lives. */
const SKIN = Number(args.get('skin') ?? 0.08)

// ---------------------------------------------------------------- build -----

const t0 = Date.now()
const build = buildPaving()
const buildMs = Date.now() - t0

const slots = new Map()
build.group.traverse((o) => {
  if (!o.isMesh) return
  const g = o.geometry
  const p = g.getAttribute('position')
  const idx = g.getIndex()
  const nAttr = g.getAttribute('normal')
  const count = (idx ? idx.count : p.count) / 3
  const tri = { pos: new Float64Array(count * 9), nrm: new Float64Array(count * 3), dist: new Float64Array(count), area: new Float64Array(count), box: new Float64Array(count * 6), count }
  for (let t = 0; t < count; t++) {
    const wx = [0, 0, 0]
    const wy = [0, 0, 0]
    const wz = [0, 0, 0]
    let nx = 0
    let ny = 0
    let nz = 0
    for (let c = 0; c < 3; c++) {
      const vi = idx ? idx.getX(t * 3 + c) : t * 3 + c
      wx[c] = p.getX(vi)
      wy[c] = p.getY(vi)
      wz[c] = p.getZ(vi)
      tri.pos[t * 9 + c * 3] = wx[c]
      tri.pos[t * 9 + c * 3 + 1] = wy[c]
      tri.pos[t * 9 + c * 3 + 2] = wz[c]
      if (nAttr) {
        nx += nAttr.getX(vi)
        ny += nAttr.getY(vi)
        nz += nAttr.getZ(vi)
      }
    }
    const ex = wx[1] - wx[0]
    const ey = wy[1] - wy[0]
    const ez = wz[1] - wz[0]
    const fx = wx[2] - wx[0]
    const fy = wy[2] - wy[0]
    const fz = wz[2] - wz[0]
    let gx = ey * fz - ez * fy
    let gy = ez * fx - ex * fz
    let gz = ex * fy - ey * fx
    const l = Math.hypot(gx, gy, gz)
    tri.area[t] = l * 0.5
    if (l > 1e-12) {
      gx /= l
      gy /= l
      gz /= l
    }
    if (nAttr && gx * nx + gy * ny + gz * nz < 0) {
      gx = -gx
      gy = -gy
      gz = -gz
    }
    tri.nrm[t * 3] = gx
    tri.nrm[t * 3 + 1] = gy
    tri.nrm[t * 3 + 2] = gz
    tri.dist[t] = gx * wx[0] + gy * wy[0] + gz * wz[0]
    tri.box[t * 6] = Math.min(...wx)
    tri.box[t * 6 + 1] = Math.min(...wy)
    tri.box[t * 6 + 2] = Math.min(...wz)
    tri.box[t * 6 + 3] = Math.max(...wx)
    tri.box[t * 6 + 4] = Math.max(...wy)
    tri.box[t * 6 + 5] = Math.max(...wz)
  }
  slots.set(o.name, tri)
})

console.log(`build ${buildMs} ms · ${build.triangles} triangles · slots:`)
for (const [name, tri] of slots) console.log(`   ${name.padEnd(22)} ${String(tri.count).padStart(7)} tris`)

// --------------------------------------------------- region plan broadphase --

// The tram channel's MESH runs out to its chamfered lips, `GUIDEWAY_CHANNEL.lip`
// past the plan on both sides, and paving must stop there — so the raster's
// "should be paved" set has to use the same footprint the builder does.
const { GUIDEWAY_CHANNEL } = await import(`${ROOT}/src/world/pavingPlan.ts`)
const REG = PAVED_REGIONS.map((r, i) => ({
  r:
    r.id === 'guideway-channel'
      ? { ...r, rInner: r.rInner - GUIDEWAY_CHANNEL.lip, rOuter: r.rOuter + GUIDEWAY_CHANNEL.lip }
      : r,
  i,
}))
const ORDER = [...REG].sort((a, b) => b.r.priority - a.r.priority || a.i - b.i)
const CHANNEL = REG.findIndex(({ r }) => r.id === 'guideway-channel')

function regionBox(r) {
  if (r.kind === 'disc') return [r.cx - r.radius, r.cz - r.radius, r.cx + r.radius, r.cz + r.radius]
  if (r.kind === 'annulus') return [r.cx - r.rOuter, r.cz - r.rOuter, r.cx + r.rOuter, r.cz + r.rOuter]
  if (r.kind === 'rect') return [r.cx - r.halfX, r.cz - r.halfZ, r.cx + r.halfX, r.cz + r.halfZ]
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const p of r.line) {
    x0 = Math.min(x0, p.x - r.halfWidth)
    z0 = Math.min(z0, p.y - r.halfWidth)
    x1 = Math.max(x1, p.x + r.halfWidth)
    z1 = Math.max(z1, p.y + r.halfWidth)
  }
  return [x0, z0, x1, z1]
}

let WX0 = Infinity
let WZ0 = Infinity
let WX1 = -Infinity
let WZ1 = -Infinity
for (const { r } of REG) {
  const b = regionBox(r)
  WX0 = Math.min(WX0, b[0])
  WZ0 = Math.min(WZ0, b[1])
  WX1 = Math.max(WX1, b[2])
  WZ1 = Math.max(WZ1, b[3])
}
WX0 -= 2
WZ0 -= 2
WX1 += 2
WZ1 += 2
const NX = Math.ceil((WX1 - WX0) / CELL)
const NZ = Math.ceil((WZ1 - WZ0) / CELL)

// Sample points are nudged off the exact cell centre so a sample can never
// land precisely on a shared triangle edge (which would read as a false hole).
const OFFX = 0.0013717
const OFFZ = 0.0007913
const sx = (ix) => WX0 + (ix + 0.5) * CELL + OFFX
const sz = (iz) => WZ0 + (iz + 0.5) * CELL + OFFZ

for (const { r, i } of ORDER) {
  const geom = r.kind === 'disc' ? `radius ${r.radius}` : r.kind === 'annulus' ? `r ${r.rInner}..${r.rOuter}` : r.kind === 'rect' ? `half ${r.halfX}x${r.halfZ} @ ${r.cx},${r.cz}` : `halfWidth ${r.halfWidth}, ${r.line.length} pts`
  console.log(`   [${i}] p${r.priority} ${r.id.padEnd(20)} ${r.kind.padEnd(9)} ${geom}`)
}
console.log(`\nplan: ${REG.length} regions · window ${WX0.toFixed(0)}..${WX1.toFixed(0)} x ${WZ0.toFixed(0)}..${WZ1.toFixed(0)} · ${NX}x${NZ} cells @ ${CELL} m`)

// owner[cell] = index of the highest-priority region containing the sample
const owner = new Int16Array(NX * NZ).fill(-1)
for (const { r, i } of ORDER) {
  const b = regionBox(r)
  const ix0 = Math.max(0, Math.floor((b[0] - WX0) / CELL) - 1)
  const iz0 = Math.max(0, Math.floor((b[1] - WZ0) / CELL) - 1)
  const ix1 = Math.min(NX - 1, Math.ceil((b[2] - WX0) / CELL) + 1)
  const iz1 = Math.min(NZ - 1, Math.ceil((b[3] - WZ0) / CELL) + 1)
  for (let iz = iz0; iz <= iz1; iz++) {
    const z = sz(iz)
    for (let ix = ix0; ix <= ix1; ix++) {
      const cell = iz * NX + ix
      if (owner[cell] >= 0) continue
      if (regionDistance(r, sx(ix), z) < 0) owner[cell] = i
    }
  }
}

// nearest |distance| to ANY region boundary — the skin classifier
const skinMask = new Uint8Array(NX * NZ)
for (const { r } of REG) {
  const b = regionBox(r)
  const ix0 = Math.max(0, Math.floor((b[0] - SKIN - WX0) / CELL) - 1)
  const iz0 = Math.max(0, Math.floor((b[1] - SKIN - WZ0) / CELL) - 1)
  const ix1 = Math.min(NX - 1, Math.ceil((b[2] + SKIN - WX0) / CELL) + 1)
  const iz1 = Math.min(NZ - 1, Math.ceil((b[3] + SKIN - WZ0) / CELL) + 1)
  for (let iz = iz0; iz <= iz1; iz++) {
    const z = sz(iz)
    for (let ix = ix0; ix <= ix1; ix++) {
      const cell = iz * NX + ix
      if (skinMask[cell]) continue
      if (Math.abs(regionDistance(r, sx(ix), z)) < SKIN) skinMask[cell] = 1
    }
  }
}

// ------------------------------------------------------- coverage raster ----

const cover = new Uint8Array(NX * NZ)
function rasterise(tri) {
  const { pos, count } = tri
  for (let t = 0; t < count; t++) {
    const ax = pos[t * 9]
    const az = pos[t * 9 + 2]
    const bx = pos[t * 9 + 3]
    const bz = pos[t * 9 + 5]
    const cx = pos[t * 9 + 6]
    const cz = pos[t * 9 + 8]
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - WX0) / CELL) - 1)
    const ix1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx, cx) - WX0) / CELL) + 1)
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - WZ0) / CELL) - 1)
    const iz1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz, cz) - WZ0) / CELL) + 1)
    const d = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    if (Math.abs(d) < 1e-14) continue
    const s = d > 0 ? 1 : -1
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = sz(iz)
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = sx(ix)
        if (((bx - ax) * (z - az) - (bz - az) * (x - ax)) * s < 0) continue
        if (((cx - bx) * (z - bz) - (cz - bz) * (x - bx)) * s < 0) continue
        if (((ax - cx) * (z - cz) - (az - cz) * (x - cx)) * s < 0) continue
        const cell = iz * NX + ix
        if (cover[cell] < 255) cover[cell]++
      }
    }
  }
}
const paving = slots.get('ground:paving')
if (paving) rasterise(paving)

// Winding: the slab faces up, or back-face culling eats it. The coplanar pass
// flips normals to agree with the attribute, so it can NEVER catch this.
if (paving) {
  let flipped = 0
  let degenerate = 0
  let nonFinite = 0
  for (let t = 0; t < paving.count; t++) {
    const p = paving.pos
    const ax = p[t * 9]
    const ay = p[t * 9 + 1]
    const az = p[t * 9 + 2]
    const ex = p[t * 9 + 3] - ax
    const ey = p[t * 9 + 4] - ay
    const ez = p[t * 9 + 5] - az
    const fx = p[t * 9 + 6] - ax
    const fy = p[t * 9 + 7] - ay
    const fz = p[t * 9 + 8] - az
    const ny = ez * fx - ex * fz
    const area = Math.hypot(ey * fz - ez * fy, ny, ex * fy - ey * fx) * 0.5
    if (!Number.isFinite(area)) nonFinite++
    else if (area < 1e-9) degenerate++
    else if (ny <= 0) {
      flipped++
      console.log(
        `   DOWN-FACING tri ${t}: (${ax.toFixed(3)}, ${az.toFixed(3)}) (${p[t * 9 + 3].toFixed(3)}, ${p[t * 9 + 5].toFixed(3)}) (${p[t * 9 + 6].toFixed(3)}, ${p[t * 9 + 8].toFixed(3)})  area ${(area * 1e4).toFixed(1)} cm²`,
      )
    }
  }
  console.log(`\nwinding: ${flipped} down-facing · ${degenerate} degenerate · ${nonFinite} non-finite (of ${paving.count})`)
}

const CELL_AREA = CELL * CELL
const stat = { core: 0, coreHole: 0, coreMulti: 0, skin: 0, skinHole: 0, skinMulti: 0, maxCover: 0 }
const holeClusters = new Map()
const multiClusters = new Map()
/** Which regions contain a defective sample — names the junction class. */
const holeSets = new Map()
const multiSets = new Map()
const skinHoleSets = new Map()
function signature(x, z) {
  const ids = []
  for (const { r } of ORDER) if (regionDistance(r, x, z) < 0) ids.push(`${r.id}/p${r.priority}`)
  return ids.join(' + ')
}
const bumpSet = (map, x, z) => {
  const key = signature(x, z)
  map.set(key, (map.get(key) ?? 0) + 1)
}
/** Radius from the OWNER region's own centre — band seams show up as rings. */
const holeRadii = new Map()
const bumpRadius = (map, own, x, z) => {
  const r = REG[own].r
  if (r.kind === 'ribbon') return
  const d = Math.hypot(x - r.cx, z - r.cz)
  const key = `${r.id} r=${(Math.round(d * 4) / 4).toFixed(2)}`
  map.set(key, (map.get(key) ?? 0) + 1)
}
const bump = (map, x, z, extra) => {
  const key = `${Math.floor(x / 5)},${Math.floor(z / 5)}`
  const cur = map.get(key) ?? { n: 0, x: 0, z: 0, extra: 0 }
  cur.n++
  cur.x += x
  cur.z += z
  cur.extra += extra
  map.set(key, cur)
}
for (let iz = 0; iz < NZ; iz++) {
  for (let ix = 0; ix < NX; ix++) {
    const cell = iz * NX + ix
    const own = owner[cell]
    if (own < 0 || own === CHANNEL) continue
    const c = cover[cell]
    stat.maxCover = Math.max(stat.maxCover, c)
    if (skinMask[cell]) {
      stat.skin++
      if (c === 0) {
        stat.skinHole++
        // A skin hole inside ONE region is the polygon-vs-circle sagitta at a
        // free edge (buried under that edge's kerb); inside TWO is a real gap
        // between two pours.
        bumpSet(skinHoleSets, sx(ix), sz(iz))
      } else if (c > 1) stat.skinMulti++
      continue
    }
    stat.core++
    if (c === 0) {
      stat.coreHole++
      bump(holeClusters, sx(ix), sz(iz), 0)
      bumpSet(holeSets, sx(ix), sz(iz))
      bumpRadius(holeRadii, own, sx(ix), sz(iz))
    } else if (c > 1) {
      stat.coreMulti++
      bump(multiClusters, sx(ix), sz(iz), c - 1)
      bumpSet(multiSets, sx(ix), sz(iz))
    }
  }
}

const m2 = (n) => (n * CELL_AREA).toFixed(2)
console.log('\n=== COVERAGE RASTER (ground:paving over its plan) ===')
console.log(`core samples ${stat.core}  (${m2(stat.core)} m²)   skin samples ${stat.skin}  (${m2(stat.skin)} m², within ${SKIN} m of a region boundary)`)
console.log(`CORE  holes ${stat.coreHole} (${m2(stat.coreHole)} m²)   multi-covered ${stat.coreMulti} (${m2(stat.coreMulti)} m²)   max cover ${stat.maxCover}`)
console.log(`SKIN  holes ${stat.skinHole} (${m2(stat.skinHole)} m²)   multi-covered ${stat.skinMulti} (${m2(stat.skinMulti)} m²)`)

function report(title, map, unit) {
  const rows = [...map.values()].sort((a, b) => b.n - a.n).slice(0, TOP)
  if (rows.length === 0) return
  console.log(`  ${title}`)
  for (const row of rows) {
    const x = row.x / row.n
    const z = row.z / row.n
    console.log(
      `    ${(row.n * CELL_AREA).toFixed(2).padStart(8)} m²  at x ${x.toFixed(1).padStart(7)} z ${z.toFixed(1).padStart(7)}  r ${Math.hypot(x, z).toFixed(1).padStart(6)}  bearing ${((Math.atan2(z, x) * 180) / Math.PI + 360).toFixed(0).padStart(3)}${unit ? `  ${unit}: ${(row.extra / row.n).toFixed(2)}` : ''}`,
    )
  }
}
function reportSets(title, map) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)
  if (rows.length === 0) return
  console.log(`  ${title}`)
  for (const [key, n] of rows) console.log(`    ${(n * CELL_AREA).toFixed(2).padStart(8)} m²  ${key || '(none)'}`)
}
report('top HOLE clusters (5 m):', holeClusters, '')
reportSets('HOLE area by containing-region set:', holeSets)
reportSets('HOLE area by owner radius:', holeRadii)
reportSets('SKIN-hole area by containing-region set:', skinHoleSets)
report('top MULTI clusters (5 m):', multiClusters, 'mean excess')
reportSets('MULTI area by containing-region set:', multiSets)

// ------------------------------------------------- self-overlap (gate maths) -

const ANG = 0.0025
const DIST = 0.0015
const OVERLAP_A = 2e-4

function clipArea(P, Q) {
  let out = P
  let s = 0
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    s += Q[i * 2] * Q[j * 2 + 1] - Q[j * 2] * Q[i * 2 + 1]
  }
  const q = s < 0 ? [Q[4], Q[5], Q[2], Q[3], Q[0], Q[1]] : Q
  for (let i = 0; i < 3; i++) {
    const ax = q[i * 2]
    const ay = q[i * 2 + 1]
    const bx = q[((i + 1) % 3) * 2]
    const by = q[((i + 1) % 3) * 2 + 1]
    const ex = bx - ax
    const ey = by - ay
    const inp = out
    if (inp.length < 6) return 0
    out = []
    let px = inp[inp.length - 2]
    let py = inp[inp.length - 1]
    let dprev = ex * (py - ay) - ey * (px - ax)
    for (let k = 0; k < inp.length; k += 2) {
      const cxp = inp[k]
      const cyp = inp[k + 1]
      const dcur = ex * (cyp - ay) - ey * (cxp - ax)
      if (dcur >= 0) {
        if (dprev < 0) {
          const t = dprev / (dprev - dcur)
          out.push(px + (cxp - px) * t, py + (cyp - py) * t)
        }
        out.push(cxp, cyp)
      } else if (dprev >= 0) {
        const t = dprev / (dprev - dcur)
        out.push(px + (cxp - px) * t, py + (cyp - py) * t)
      }
      px = cxp
      py = cyp
      dprev = dcur
    }
  }
  if (out.length < 6) return 0
  let a = 0
  for (let i = 0; i < out.length; i += 2) {
    const j = (i + 2) % out.length
    a += out[i] * out[j + 1] - out[j] * out[i + 1]
  }
  return Math.abs(a) * 0.5
}

/** Merge every slot into one triangle soup, tagged, so cross-slot pairs count too. */
function mergeSlots(names) {
  const parts = names.map((n) => slots.get(n)).filter(Boolean)
  const kept = names.filter((n) => slots.get(n))
  const count = parts.reduce((s, p) => s + p.count, 0)
  const out = { pos: new Float64Array(count * 9), nrm: new Float64Array(count * 3), dist: new Float64Array(count), area: new Float64Array(count), box: new Float64Array(count * 6), slot: new Int32Array(count), count, names: kept }
  let at = 0
  parts.forEach((p, si) => {
    out.pos.set(p.pos, at * 9)
    out.nrm.set(p.nrm, at * 3)
    out.dist.set(p.dist, at)
    out.area.set(p.area, at)
    out.box.set(p.box, at * 6)
    out.slot.fill(si, at, at + p.count)
    at += p.count
  })
  return out
}

function selfOverlap(name, tri, { dump = 0 } = {}) {
  const { pos, nrm, dist, area, box, count } = tri
  const slotOf = tri.slot ?? null
  const slotNames = tri.names ?? []
  const byPair = new Map()
  const GRID = 1.5
  const grid = new Map()
  for (let i = 0; i < count; i++) {
    if (area[i] < OVERLAP_A) continue
    const ix0 = Math.floor(box[i * 6] / GRID)
    const iy0 = Math.floor(box[i * 6 + 1] / GRID)
    const iz0 = Math.floor(box[i * 6 + 2] / GRID)
    const ix1 = Math.floor(box[i * 6 + 3] / GRID)
    const iy1 = Math.floor(box[i * 6 + 4] / GRID)
    const iz1 = Math.floor(box[i * 6 + 5] / GRID)
    for (let x = ix0; x <= ix1; x++) {
      for (let y = iy0; y <= iy1; y++) {
        for (let z = iz0; z <= iz1; z++) {
          const key = `${x},${y},${z}`
          const list = grid.get(key)
          if (list) list.push(i)
          else grid.set(key, [i])
        }
      }
    }
  }
  const seen = new Set()
  const clusters = new Map()
  let total = 0
  let pairs = 0
  let backToBack = 0
  const dumped = []
  const A = [0, 0, 0, 0, 0, 0]
  const B = [0, 0, 0, 0, 0, 0]
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]
        const j = list[b]
        if (
          box[i * 6 + 3] + DIST < box[j * 6] || box[j * 6 + 3] + DIST < box[i * 6] ||
          box[i * 6 + 4] + DIST < box[j * 6 + 1] || box[j * 6 + 4] + DIST < box[i * 6 + 1] ||
          box[i * 6 + 5] + DIST < box[j * 6 + 2] || box[j * 6 + 5] + DIST < box[i * 6 + 2]
        ) continue
        const nix = nrm[i * 3]
        const niy = nrm[i * 3 + 1]
        const niz = nrm[i * 3 + 2]
        const d = nix * nrm[j * 3] + niy * nrm[j * 3 + 1] + niz * nrm[j * 3 + 2]
        if (Math.abs(d) < 1 - ANG) continue
        if (Math.abs(nix * pos[j * 9] + niy * pos[j * 9 + 1] + niz * pos[j * 9 + 2] - dist[i]) > DIST) continue
        const key = i < j ? i * 67108864 + j : j * 67108864 + i
        if (seen.has(key)) continue
        seen.add(key)
        let ux
        let uy
        let uz
        if (Math.abs(niz) < 0.9) {
          ux = niy
          uy = -nix
          uz = 0
        } else {
          ux = 0
          uy = niz
          uz = -niy
        }
        const ul = Math.hypot(ux, uy, uz) || 1
        ux /= ul
        uy /= ul
        uz /= ul
        const vx = niy * uz - niz * uy
        const vy = niz * ux - nix * uz
        const vz = nix * uy - niy * ux
        for (let c = 0; c < 3; c++) {
          const ix = pos[i * 9 + c * 3]
          const iy = pos[i * 9 + c * 3 + 1]
          const iz = pos[i * 9 + c * 3 + 2]
          A[c * 2] = ix * ux + iy * uy + iz * uz
          A[c * 2 + 1] = ix * vx + iy * vy + iz * vz
          const jx = pos[j * 9 + c * 3]
          const jy = pos[j * 9 + c * 3 + 1]
          const jz = pos[j * 9 + c * 3 + 2]
          B[c * 2] = jx * ux + jy * uy + jz * uz
          B[c * 2 + 1] = jx * vx + jy * vy + jz * vz
        }
        const ov = clipArea(A, B)
        if (ov < OVERLAP_A) continue
        if (d < 0) {
          backToBack++
          continue
        }
        total += ov
        pairs++
        if (slotOf) {
          const sa = slotNames[slotOf[i]]
          const sb = slotNames[slotOf[j]]
          const pk = sa < sb ? `${sa} :: ${sb}` : `${sb} :: ${sa}`
          const rec = byPair.get(pk) ?? { area: 0, n: 0 }
          rec.area += ov
          rec.n++
          byPair.set(pk, rec)
        }
        const cxm = (pos[i * 9] + pos[i * 9 + 3] + pos[i * 9 + 6]) / 3
        const cym = (pos[i * 9 + 1] + pos[i * 9 + 4] + pos[i * 9 + 7]) / 3
        const czm = (pos[i * 9 + 2] + pos[i * 9 + 5] + pos[i * 9 + 8]) / 3
        const ck = `${Math.floor(cxm / 5)},${Math.floor(czm / 5)}`
        const cur = clusters.get(ck) ?? { n: 0, area: 0, x: 0, z: 0, y: 0, nx: 0, ny: 0, nz: 0 }
        cur.n++
        cur.area += ov
        cur.x += cxm
        cur.y += cym
        cur.z += czm
        cur.nx += nix
        cur.ny += niy
        cur.nz += niz
        clusters.set(ck, cur)
        if (dumped.length < dump) dumped.push({ i, j, ov })
      }
    }
  }
  console.log(`\n=== COPLANAR OVERLAP ${name} ===`)
  console.log(`${(total * 1e4).toFixed(0)} cm²  ·  ${pairs} pairs  ·  back-to-back ${backToBack}`)
  for (const [key, rec] of [...byPair.entries()].sort((a, b) => b[1].area - a[1].area)) {
    console.log(`   ${(rec.area * 1e4).toFixed(0).padStart(8)} cm²  ${String(rec.n).padStart(5)} pairs  ${key}`)
  }
  const rows = [...clusters.values()].sort((a, b) => b.area - a.area).slice(0, TOP)
  for (const row of rows) {
    const x = row.x / row.n
    const z = row.z / row.n
    console.log(
      `   ${(row.area * 1e4).toFixed(0).padStart(7)} cm²  ${String(row.n).padStart(4)} pairs  x ${x.toFixed(1).padStart(7)} z ${z.toFixed(1).padStart(7)}  r ${Math.hypot(x, z).toFixed(1).padStart(6)}  bearing ${((Math.atan2(z, x) * 180) / Math.PI + 360).toFixed(0).padStart(3)}  y ${(row.y / row.n).toFixed(3).padStart(7)}  n [${(row.nx / row.n).toFixed(2)}, ${(row.ny / row.n).toFixed(2)}, ${(row.nz / row.n).toFixed(2)}]`,
    )
  }
  for (const { i, j, ov } of dumped) {
    const v = (t) => [0, 1, 2].map((c) => `(${pos[t * 9 + c * 3].toFixed(3)}, ${pos[t * 9 + c * 3 + 1].toFixed(3)}, ${pos[t * 9 + c * 3 + 2].toFixed(3)})`).join(' ')
    console.log(`   pair ${(ov * 1e4).toFixed(1)} cm²\n     A ${v(i)}\n     B ${v(j)}`)
  }
  return { total, pairs }
}

const dump = Number(args.get('dump') ?? 0)
const which = args.get('slots')?.split(',') ?? ['ALL']
if (which.length === 1 && which[0] === 'ALL') {
  selfOverlap('all slots', mergeSlots([...slots.keys()]), { dump })
} else {
  for (const name of which) {
    const tri = slots.get(name)
    if (tri) selfOverlap(name, tri, { dump })
  }
}
