import type { PreviewCell, PreviewRace, PreviewTerrain } from './types'
import { PREVIEW_WORLD_SIZE, wrapPreviewCell, wrapPreviewCoordinate, wrappedPreviewDelta } from './topology'

export const PREVIEW_MIN = -100
export const PREVIEW_MAX = 99
export const PREVIEW_DEFAULT_SEED = 0x50455249
export const PREVIEW_RIVER_HALF_WIDTH = 0.48
export const PREVIEW_RIVER_SURFACE_HEIGHT = -0.04
export const PREVIEW_OCEAN_SURFACE_HEIGHT = -0.06

export const PREVIEW_RACES: { id: PreviewRace; label: string; col: number; row: number; color: string }[] = [
  { id: 'human', label: 'Human riverlands', col: -12, row: 36, color: '#d6ad64' },
  { id: 'elf', label: 'Elven woodlands', col: -57, row: -12, color: '#76bb8c' },
  { id: 'dwarf', label: 'Dwarven snow ridges', col: -22, row: -66, color: '#acc5d6' },
  { id: 'orc', label: 'Orc basalt foothills', col: 53, row: -48, color: '#cc7856' },
  { id: 'peri', label: 'Ancient Peri desert', col: 66, row: 32, color: '#d5a869' },
]

type Point = { x: number; z: number }
type Basin = Point & { waterRadius: number; greenRadius: number; surfaceHeight: number }
export interface PreviewHydrology { rivers: Point[][]; oases: Basin[] }
type Segment = { a: Point; b: Point }
interface World { seed: number; phase: number; hydrology: PreviewHydrology; riverBuckets: Map<string, Segment[]>; cells: Map<number, PreviewCell> }
const worlds = new Map<number, World>()
const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, n))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (low: number, high: number, n: number) => { const t = clamp((n - low) / (high - low)); return t * t * (3 - 2 * t) }
const angular = Math.PI * 2 / PREVIEW_WORLD_SIZE
// A chord-distance Gaussian is smooth and periodic, including at the antipode.
const gaussian = (x: number, z: number, cx: number, cz: number, sx: number, sz: number) => Math.exp(-((Math.sin((x - cx) * angular / 2) * 2 / angular / sx) ** 2 + (Math.sin((z - cz) * angular / 2) * 2 / angular / sz) ** 2))

/** Seeds are persisted as unsigned 32-bit integers, without silently rounding user input. */
export function validatePreviewSeed(seed: number): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('The realm seed must be a finite unsigned 32-bit integer.')
  return seed
}

export function previewSeedRandom(x: number, z: number, salt: number, seed: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt, 69069) ^ Math.imul(seed, 1597334677)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
const noise = (x: number, z: number, scale: number, salt: number, seed: number) => {
  const period = Math.max(2, Math.round(PREVIEW_WORLD_SIZE / scale)), cellSize = PREVIEW_WORLD_SIZE / period
  const px = (wrapPreviewCoordinate(x) + 100) / cellSize, pz = (wrapPreviewCoordinate(z) + 100) / cellSize, ix = Math.floor(px), iz = Math.floor(pz)
  const sample = (a: number, b: number) => previewSeedRandom(a % period, b % period, salt, seed)
  return mix(mix(sample(ix, iz), sample(ix + 1, iz), smooth(0, 1, px - ix)), mix(sample(ix, iz + 1), sample(ix + 1, iz + 1), smooth(0, 1, px - ix)), smooth(0, 1, pz - iz))
}

// Redirect dense path samples around the five fixed town centers. The same paths drive
// both the water mesh and the continuous river bed, so protected land cannot hide water.
function avoidCapitals(points: Point[]): Point[] {
  let routed = points
  for (const town of PREVIEW_RACES) {
    const center = { x: town.col + .5, z: town.row + .5 }
    const distance = (point: Point) => Math.hypot(wrappedPreviewDelta(center.x, point.x), wrappedPreviewDelta(center.z, point.z))
    const closest = routed.reduce((best, point) => distance(point) < distance(best) ? point : best)
    if (distance(closest) > 12) continue
    const side = wrappedPreviewDelta(center.x, closest.x) < 0 ? -1 : 1
    routed = routed.map(point => {
      const target = side < 0 ? Math.min(point.x, center.x - 11) : Math.max(point.x, center.x + 11)
      return { x: mix(point.x, target, 1 - smooth(6, 16, Math.abs(wrappedPreviewDelta(center.z, point.z)))), z: point.z }
    })
  }
  return routed
}

function makeHydrology(seed: number, phase: number): PreviewHydrology {
  const rivers: Point[][] = []
  for (let trunk = 0; trunk < 2; trunk++) {
    const path = avoidCapitals(Array.from({ length: 201 }, (_, i) => {
      const z = -100 + i
      const x = (trunk ? 33 : -39) + Math.sin(z * angular * 2 + phase + trunk * 2) * 9 + (noise(z, trunk * 71, 22, 54, seed) - .5) * 17
      return { x, z }
    }))
    rivers.push(path)
    for (let branch = 0; branch < 3; branch++) {
      const join = path[45 + branch * 50], side = (branch + trunk) % 2 ? -1 : 1
      const start = { x: join.x + side * (24 + previewSeedRandom(branch, trunk, 66, seed) * 25), z: join.z - 18 - previewSeedRandom(branch, trunk, 67, seed) * 16 }
      const length = Math.ceil(Math.hypot(start.x - join.x, start.z - join.z))
      rivers.push(avoidCapitals(Array.from({ length: length + 1 }, (_, i) => {
        const t = i / length
        return { x: mix(start.x, join.x, t) + Math.sin(t * Math.PI * 3 + phase) * Math.sin(t * Math.PI) * 3, z: mix(start.z, join.z, t) }
      })))
    }
  }
  const oases: Basin[] = []
  const anchors = [[63, 22], [-65, 52], [6, -36], [59, -8], [-7, 73], [-75, -58], [98, -21]]
  anchors.forEach(([ax, az], i) => {
    const x = ax + (previewSeedRandom(i, 0, 80, seed) - .5) * 10
    let z = az + (previewSeedRandom(i, 0, 81, seed) - .5) * 10
    for (const town of PREVIEW_RACES) if (Math.hypot(x - town.col - .5, z - town.row - .5) < 13) z = town.row - 15
    for (let lobe = 0; lobe < 3; lobe++) {
      const angle = phase + lobe * 2.2, r = 1.8 + previewSeedRandom(i, lobe, 82, seed) * 1.3
      oases.push({ x: x + Math.cos(angle) * lobe * 1.4, z: z + Math.sin(angle) * lobe * 1.4, waterRadius: r, greenRadius: r + 3.8, surfaceHeight: PREVIEW_RIVER_SURFACE_HEIGHT })
    }
  })
  // Short translated continuations keep ribbon faces and basin circles aligned with
  // the periodic bed on both sides. Never draw a 200-unit line across a wrapped seam.
  const visibleRivers: Point[][] = []
  for (const path of rivers) for (const dx of [-200, 0, 200]) for (const dz of [-200, 0, 200]) {
    let piece: Point[] = []
    for (const point of path) {
      const shifted = { x: point.x + dx, z: point.z + dz }
      if (shifted.x >= -104 && shifted.x <= 104 && shifted.z >= -104 && shifted.z <= 104) piece.push(shifted)
      else { if (piece.length >= 2) visibleRivers.push(piece); piece = [] }
    }
    if (piece.length >= 2) visibleRivers.push(piece)
  }
  const visibleOases: Basin[] = []
  for (const basin of oases) for (const dx of [-200, 0, 200]) for (const dz of [-200, 0, 200]) {
    const shifted = { ...basin, x: basin.x + dx, z: basin.z + dz }, margin = basin.greenRadius + 2
    if (shifted.x + margin >= -100 && shifted.x - margin <= 100 && shifted.z + margin >= -100 && shifted.z - margin <= 100) visibleOases.push(shifted)
  }
  return { rivers: visibleRivers, oases: visibleOases }
}

function getWorld(seed: number): World {
  validatePreviewSeed(seed)
  const cached = worlds.get(seed)
  if (cached) return cached
  const phase = previewSeedRandom(0, 0, 1, seed) * Math.PI * 2, hydrology = makeHydrology(seed, phase), riverBuckets = new Map<string, Segment[]>()
  for (const path of hydrology.rivers) for (let i = 1; i < path.length; i++) {
    const segment = { a: path[i - 1], b: path[i] }
    for (let bx = Math.floor((Math.min(segment.a.x, segment.b.x) - 3) / 8); bx <= Math.floor((Math.max(segment.a.x, segment.b.x) + 3) / 8); bx++) {
      for (let bz = Math.floor((Math.min(segment.a.z, segment.b.z) - 3) / 8); bz <= Math.floor((Math.max(segment.a.z, segment.b.z) + 3) / 8); bz++) {
        const key = `${bx},${bz}`, bucket = riverBuckets.get(key) ?? []
        bucket.push(segment); riverBuckets.set(key, bucket)
      }
    }
  }
  const world = { seed, phase, hydrology, riverBuckets, cells: new Map<number, PreviewCell>() }
  // Four full realms are enough for coexistence and keep long sessions bounded.
  if (worlds.size >= 4) worlds.delete(worlds.keys().next().value!)
  worlds.set(seed, world)
  return world
}

export function getPreviewHydrology(seed = PREVIEW_DEFAULT_SEED): PreviewHydrology { return getWorld(seed).hydrology }

function riverDistance(x: number, z: number, world: World): number {
  let distance = 4
  for (const { a, b } of world.riverBuckets.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []) {
    const dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t))
  }
  return distance
}

// Marine inlets straddle the seams instead of following a rectangular map boundary.
// Their periodic shore field also forms a few small islets in the western bays.
function coastalDistance(x: number, z: number, world: World): number {
  const n = noise(z, x, 18, 47, world.seed)
  const marine = Math.max(gaussian(x, z, -98, 58, 15, 34), gaussian(x, z, -88, -57, 17, 24), gaussian(x, z, 51, 98, 27, 15), gaussian(x, z, 100, -22, 13, 18)) * (.92 + n * .16)
  const islet = gaussian(x, z, -98, 54 + Math.sin(world.phase) * 8, 2.3, 3.2) * .8
  return (.64 - marine + islet) * 12
}

function dryHeight(x: number, z: number, world: World): number {
  const { seed, phase } = world
  const wx = x + (noise(x, z, 24, 8, seed) - .5) * 12, wz = z + (noise(x, z, 24, 9, seed) - .5) * 12
  const northLine = -63 + Math.sin(wx * angular + phase) * 9
  const north = gaussian(wx, wz, -12, northLine, 82, 11)
  const diagonalLine = -25 + Math.sin(wx * angular + phase) * 24 + Math.sin(wx * angular * 2 - phase) * 9
  const diagonal = gaussian(wx, wz, 17, diagonalLine, 56, 8)
  const knolls = smooth(.51, .79, noise(wx, wz, 5.5, 12, seed))
  const texture = .65 + Math.abs(Math.sin(wx * angular * 6 + Math.sin(wz * angular * 3)) * Math.cos(wz * angular * 5)) * .75
  let height = .22 + noise(wx, wz, 20, 10, seed) * .23 + north * (1.2 + texture * 1.4) + diagonal * (.5 + texture * .6) + knolls * .95 + gaussian(x, z, 53, -48, 19, 18) * .65
  for (const town of PREVIEW_RACES) {
    if (Math.abs(x - town.col - .5) > 8 || Math.abs(z - town.row - .5) > 8) continue
    height = mix(height, .37, gaussian(x, z, town.col + .5, town.row + .5, 1.7, 1.7) * .88)
  }
  // The inspector's first forest and mountain are intentional examples in every seed.
  height += gaussian(x, z, -10.5, 35.5, .68, .68) * 1.02
  // Small organic catchment knolls ensure the five navigation capitals have iron access.
  for (const town of PREVIEW_RACES) if (town.id !== 'human' && Math.abs(x - town.col - 3.5) < 8 && Math.abs(z - town.row - .5) < 8) height += gaussian(x, z, town.col + 3.5, town.row + .5, 1.5, 1.7) * 1.15
  return height
}

/** Continuous native terrain, in cell units; authoritative water is cut into this mesh. */
export function previewHeight(x: number, z: number, seed = PREVIEW_DEFAULT_SEED): number {
  const world = getWorld(seed)
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Terrain coordinates must be finite.')
  x = wrapPreviewCoordinate(x); z = wrapPreviewCoordinate(z)
  let height = dryHeight(x, z, world)
  const coast = coastalDistance(x, z, world)
  height = mix(-.22, height, smooth(-.1, 2.6, coast))
  const river = riverDistance(x, z, world)
  height = mix(-.14, height, smooth(PREVIEW_RIVER_HALF_WIDTH, 2.1, river))
  for (const basin of world.hydrology.oases) {
    const d = Math.hypot(x - basin.x, z - basin.z)
    if (d < basin.waterRadius + 2) height = mix(-.14, height, smooth(basin.waterRadius, basin.waterRadius + 2, d))
  }
  return height
}

export function getPreviewCell(col: number, row: number, seed = PREVIEW_DEFAULT_SEED): PreviewCell {
  const wrapped = wrapPreviewCell(col, row)
  col = wrapped.col; row = wrapped.row
  const world = getWorld(seed), key = (row - PREVIEW_MIN) * 200 + col - PREVIEW_MIN, cached = world.cells.get(key)
  if (cached) return cached
  const x = col + .5, z = row + .5, height = previewHeight(x, z, seed), river = riverDistance(x, z, world)
  const basin = world.hydrology.oases.find(o => Math.hypot(x - o.x, z - o.z) < o.greenRadius)
  const moisture = noise(x, z, 9, 24, seed) * .7 + noise(x, z, 26, 25, seed) * .3 + gaussian(x, z, -57, -12, 17, 16) * .35 - gaussian(x, z, 66, 32, 16, 18) * .18
  const warmth = noise(x, z, 15, 26, seed) + gaussian(x, z, 64, 32, 23, 26) * .32
  let terrain: PreviewTerrain = 'grassland'
  if (height < PREVIEW_OCEAN_SURFACE_HEIGHT || river < PREVIEW_RIVER_HALF_WIDTH || world.hydrology.oases.some(o => Math.hypot(x - o.x, z - o.z) < o.waterRadius)) terrain = 'water'
  else if (height > 1.85 && z < -35) terrain = 'snow'
  else if (height > 1.0) terrain = 'mountain'
  else if (river < 1.6 || (basin && Math.hypot(x - basin.x, z - basin.z) < basin.waterRadius + 1)) terrain = 'marsh'
  else if (moisture > .56 || (basin && moisture > .36)) terrain = 'forest'
  else if (warmth > .62 && moisture < .52) terrain = 'desert'
  else if (moisture < .25 && noise(x, z, 6, 28, seed) > .63) terrain = 'ruins'
  // Capitals have varied but equivalent small resource pockets, not square biome stamps.
  for (const town of PREVIEW_RACES) {
    if (terrain === 'water') break
    if (Math.abs(x - town.col - .5) > 6 || Math.abs(z - town.row - .5) > 6) continue
    if (Math.hypot(x - town.col + 2.5, z - town.row - .5) < 1.7) terrain = 'forest'
    if (Math.hypot(x - town.col - .5, z - town.row - 3.5) < 1.5) terrain = town.id === 'peri' ? 'desert' : 'marsh'
    if (Math.hypot(x - town.col - .5, z - town.row + 2.5) < 1.5) terrain = 'grassland'
    if (col === town.col && row === town.row) terrain = town.id === 'peri' ? 'desert' : 'grassland'
  }
  if (col === -13 && row === 35) terrain = 'forest'
  if (col === -11 && row === 35) terrain = 'mountain'
  if (col === -12 && row === 37) terrain = 'grassland'
  const cell = { col, row, height, terrain }
  world.cells.set(key, cell)
  return cell
}

export const PREVIEW_RIVERS = getPreviewHydrology().rivers
export const PREVIEW_OASES = getPreviewHydrology().oases
