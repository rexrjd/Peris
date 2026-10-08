import type { PreviewBuilding, PreviewPlot, PreviewRace, PreviewResource, PreviewState, PreviewStock, PreviewTerrain, PreviewVillage } from './types'
import { getPreviewCell, PREVIEW_DEFAULT_SEED, PREVIEW_RACES, previewSeedRandom, validatePreviewSeed } from './world'
import { wrapPreviewCell, wrappedPreviewDistance } from './topology'
export { getPreviewCell, getPreviewHydrology, previewHeight, validatePreviewSeed, PREVIEW_DEFAULT_SEED, PREVIEW_MAX, PREVIEW_MIN, PREVIEW_RACES, PREVIEW_RIVERS, PREVIEW_OASES, PREVIEW_RIVER_HALF_WIDTH, PREVIEW_RIVER_SURFACE_HEIGHT, PREVIEW_OCEAN_SURFACE_HEIGHT } from './world'
export { PREVIEW_WORLD_SIZE, wrapPreviewCoordinate, wrapPreviewCell, wrappedPreviewDelta, wrappedPreviewDistance } from './topology'

/** This entire module belongs to the local map sample; it has no campaign or server dependencies. */
export const PREVIEW_BUILD_MS = 6_000
export const PREVIEW_CLAIM_RADIUS = 6
export const PREVIEW_START_CAPACITY = 4
export const PREVIEW_FIRST_POPULATION_UNLOCK = 120
export const PREVIEW_POPULATION_UNLOCK_STEP = 40
export const PREVIEW_POPULATION_PER_LEVEL = 10

export const BUILDING_INFO: Record<PreviewBuilding, { label: string; resource: PreviewResource }> = {
  farm: { label: 'Farm', resource: 'wheat' },
  'lumber-mill': { label: 'Lumber mill', resource: 'wood' },
  'iron-mine': { label: 'Iron mine', resource: 'iron' },
  'clay-pit': { label: 'Clay pit', resource: 'clay' },
}

/** Deliberately conservative sample balance: any building may occupy any land terrain.
 * Rates are units/hour per completed level. Grassland farms earn 110% of base; mountain farms earn 75%.
 * Costs grow 1.5x per level, queues last six seconds, and each completion adds ten people.
 */
export const PREVIEW_BASE_RATES: Record<PreviewBuilding, number> = { farm: 36, 'lumber-mill': 30, 'iron-mine': 24, 'clay-pit': 24 }
export const PREVIEW_COST_GROWTH = 1.5
export const PREVIEW_BASE_COSTS: Record<PreviewBuilding, PreviewStock> = {
  farm: { wood: 70, iron: 35, clay: 60, wheat: 30 },
  'lumber-mill': { wood: 60, iron: 45, clay: 55, wheat: 35 },
  'iron-mine': { wood: 80, iron: 40, clay: 70, wheat: 40 },
  'clay-pit': { wood: 65, iron: 40, clay: 55, wheat: 35 },
}
export const PREVIEW_TERRAIN_MODIFIERS: Record<PreviewTerrain, Record<PreviewBuilding, number>> = {
  grassland: { farm: 1.1, 'lumber-mill': 1, 'iron-mine': 1, 'clay-pit': 1 },
  forest: { farm: 0.9, 'lumber-mill': 1.25, 'iron-mine': 0.95, 'clay-pit': 1 },
  mountain: { farm: 0.75, 'lumber-mill': 0.85, 'iron-mine': 1.3, 'clay-pit': 0.9 },
  desert: { farm: 0.8, 'lumber-mill': 0.8, 'iron-mine': 1.05, 'clay-pit': 1.2 },
  marsh: { farm: 1.05, 'lumber-mill': 1, 'iron-mine': 0.9, 'clay-pit': 1.2 },
  snow: { farm: 0.8, 'lumber-mill': 0.9, 'iron-mine': 1.1, 'clay-pit': 0.95 },
  ruins: { farm: 0.9, 'lumber-mill': 0.9, 'iron-mine': 1.05, 'clay-pit': 1 },
  water: { farm: 0, 'lumber-mill': 0, 'iron-mine': 0, 'clay-pit': 0 },
}

const resources: PreviewResource[] = ['wood', 'iron', 'clay', 'wheat']
const buildings: PreviewBuilding[] = ['farm', 'lumber-mill', 'iron-mine', 'clay-pit']

export function previewCellKey(col: number, row: number): string { const wrapped = wrapPreviewCell(col, row); return `${wrapped.col},${wrapped.row}` }

function inBounds(col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row)
}

const chebyshev = wrappedPreviewDistance
const protectedLand = (col: number, row: number, seed: number) => {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!inBounds(col + dx, row + dy) || getPreviewCell(col + dx, row + dy, seed).terrain === 'water') return false
  }
  return true
}
const raceAt = (col: number, row: number, seed: number): PreviewRace => {
  const count: Record<PreviewTerrain, number> = { grassland: 0, forest: 0, mountain: 0, desert: 0, marsh: 0, snow: 0, water: 0, ruins: 0 }
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) if (inBounds(col + dx, row + dy)) count[getPreviewCell(col + dx, row + dy, seed).terrain]++
  const scores: Record<PreviewRace, number> = {
    human: count.grassland * 1.35 + count.marsh,
    elf: count.forest * 1.7,
    dwarf: count.snow * 3 + count.mountain * .75 + (row < -35 ? 8 : 0),
    orc: count.mountain * 1.45,
    peri: count.desert * 2.1,
  }
  return PREVIEW_RACES.reduce((best, race) => scores[race.id] + previewSeedRandom(col, row, 91 + PREVIEW_RACES.indexOf(race), seed) * 5 > scores[best] ? race.id : best, 'human' as PreviewRace)
}

/** Best level-one rates on land reachable by diagonal claims inside the catchment.
 * Other towns' protected starter rings can be supplied by the UI or generation checks.
 * This measures opportunity, never production from unbuilt fields.
 */
export function getPreviewResourceAccess(col: number, row: number, seed = PREVIEW_DEFAULT_SEED, radius = PREVIEW_CLAIM_RADIUS, protectedStarts: readonly Pick<PreviewVillage, 'col' | 'row'>[] = []): PreviewStock {
  validatePreviewSeed(seed)
  if (!inBounds(col, row) || !Number.isInteger(radius) || radius < 1 || radius > PREVIEW_CLAIM_RADIUS) throw new RangeError('Resource access requires a finite whole-tile center and a radius from one to six.')
  const wrapped = wrapPreviewCell(col, row)
  col = wrapped.col; row = wrapped.row
  const access: PreviewStock = { wood: 0, iron: 0, clay: 0, wheat: 0 }, visited = new Set<string>([previewCellKey(col, row)]), pending = [{ col, row }]
  const blockingStarts = protectedStarts.filter(v => chebyshev(v, { col, row }) > 0 && chebyshev(v, { col, row }) <= radius + 1)
  for (let index = 0; index < pending.length; index++) {
    const cell = pending[index]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue
      const target = wrapPreviewCell(cell.col + dx, cell.row + dy), key = previewCellKey(target.col, target.row)
      if (visited.has(key) || !inBounds(target.col, target.row) || chebyshev({ col, row }, target) > radius) continue
      visited.add(key)
      if (blockingStarts.some(v => chebyshev(v, target) <= 1)) continue
      const terrain = getPreviewCell(target.col, target.row, seed).terrain
      if (terrain === 'water') continue
      pending.push(target)
      for (const building of buildings) {
        const resource = BUILDING_INFO[building].resource
        access[resource] = Math.max(access[resource], PREVIEW_BASE_RATES[building] * terrainModifier(terrain, building))
      }
    }
  }
  return access
}

/** Every start can reach viable ordinary production; richer specialties remain geography-dependent. */
export const PREVIEW_FAIR_ACCESS: PreviewStock = { wood: 27, iron: 21.6, clay: 21.6, wheat: 32.4 }
const fairAccess = (access: PreviewStock) => resources.every(resource => access[resource] + 1e-8 >= PREVIEW_FAIR_ACCESS[resource])
const names: Record<PreviewRace, string[]> = {
  human: ['Willow', 'Brook', 'Alder', 'Ash', 'Briar', 'Oak'], elf: ['Elder', 'Moon', 'Moss', 'Silver', 'Fern', 'Thorn'],
  dwarf: ['Iron', 'Frost', 'Stone', 'Deep', 'Granite', 'Copper'], orc: ['Black', 'Red', 'Ash', 'Stone', 'Ember', 'Ridge'], peri: ['Saffron', 'Amber', 'Dawn', 'Sun', 'Sand', 'Palm'],
}
const suffixes: Record<PreviewRace, string[]> = {
  human: ['ford', 'field', 'haven', 'bridge'], elf: ['grove', 'bough', 'glade', 'wood'], dwarf: ['hold', 'anvil', 'peak', 'gate'], orc: ['crag', 'fang', 'watch', 'scar'], peri: ['har', 'abad', 'sara', 'an'],
}

const villageCache = new Map<number, PreviewVillage[]>()
function makeVillages(seed: number): PreviewVillage[] {
  const cached = villageCache.get(seed)
  if (cached) return cached.map(v => ({ ...v }))
  const villages: PreviewVillage[] = PREVIEW_RACES.map((race, i) => ({ id: i === 0 ? 'willowford' : `preview-capital-${race.id}`, name: ['Willowford', 'Eldergrove', 'Frosthold', 'Embercrag', 'Mehrabad'][i], race: race.id, col: race.col, row: race.row, population: i === 0 ? 80 : 190 + i * 35, player: i === 0 }))
  const usedNames = new Set(villages.map(v => v.name))
  for (const village of villages) if (!protectedLand(village.col, village.row, seed) || !fairAccess(getPreviewResourceAccess(village.col, village.row, seed))) throw new Error(`Realm seed ${seed} did not provide a fair capital catchment.`)
  for (let attempt = 0; attempt < 16_000 && villages.length < 190; attempt++) {
    const c = -100 + Math.floor(previewSeedRandom(attempt, 0, 5, seed) * 200), r = -100 + Math.floor(previewSeedRandom(attempt, 0, 6, seed) * 200)
    const spacing = 8 + Math.floor(previewSeedRandom(c, r, 55, seed) * 4)
    if (villages.some(v => chebyshev(v, { col: c, row: r }) < (v.player ? 14 : spacing)) || !protectedLand(c, r, seed)) continue
    if (!fairAccess(getPreviewResourceAccess(c, r, seed, PREVIEW_CLAIM_RADIUS, villages))) continue
    const race = raceAt(c, r, seed), n = villages.length - PREVIEW_RACES.length
    const baseName = `${names[race][n % names[race].length]}${suffixes[race][Math.floor(n / names[race].length) % 4]}`
    let name = baseName
    for (let ordinal = 2; usedNames.has(name); ordinal++) name = `${baseName} ${ordinal}`
    usedNames.add(name)
    villages.push({ id: `preview-village-${n}`, name, race, col: c, row: r, population: 70 + Math.floor(previewSeedRandom(c, r, 7, seed) * 350), player: false })
  }
  // Separation keeps every other protected ring beyond a six-tile catchment, and
  // this final audit checks the actual full set instead of an unoccupied preview.
  for (const village of villages) if (!fairAccess(getPreviewResourceAccess(village.col, village.row, seed, PREVIEW_CLAIM_RADIUS, villages))) throw new Error('A neighboring starting area blocked fair resource access.')
  if (villageCache.size >= 4) villageCache.delete(villageCache.keys().next().value!)
  villageCache.set(seed, villages)
  return villages.map(v => ({ ...v }))
}

export function createPreviewState(now = Date.now(), seed = PREVIEW_DEFAULT_SEED): PreviewState {
  if (!Number.isFinite(now)) throw new Error('The sample clock must be a finite timestamp.')
  validatePreviewSeed(seed)
  const villages = makeVillages(seed), plots: Record<string, PreviewPlot> = {}
  villages.forEach((v, i) => {
    if (v.player || i % 3 !== 0) return
    for (const [j, offset] of [[0, { col: -1, row: 0 }], [1, { col: 1, row: 1 }]] as const) {
      const { col, row } = wrapPreviewCell(v.col + offset.col, v.row + offset.row)
      plots[previewCellKey(col, row)] = { col, row, villageId: v.id, building: buildings[(i + j) % 4], level: 1 + Math.floor(previewSeedRandom(col, row, 98, seed) * 4), queue: null }
    }
  })
  return { version: 1, seed, playerVillageId: 'willowford', villages, plots, stock: { wood: 1400, iron: 900, clay: 1100, wheat: 1200 }, lastTick: now }
}

export function playerVillage(state: PreviewState): PreviewVillage {
  const village = state.villages.find(v => v.id === state.playerVillageId)
  if (!village) throw new Error('The local sample player village is missing.')
  return village
}

/** Total capacity, rather than the number of remaining slots. */
export function claimAllowance(state: PreviewState): number {
  const population = playerVillage(state).population
  return PREVIEW_START_CAPACITY + (population < PREVIEW_FIRST_POPULATION_UNLOCK ? 0 : 1 + Math.floor((population - PREVIEW_FIRST_POPULATION_UNLOCK) / PREVIEW_POPULATION_UNLOCK_STEP))
}

export function claimReason(state: PreviewState, col: number, row: number): string | null {
  if (!inBounds(col, row)) return 'Choose finite whole-tile map coordinates.'
  const wrapped = wrapPreviewCell(col, row)
  col = wrapped.col; row = wrapped.row
  const village = playerVillage(state), target = { col, row }
  if (col === village.col && row === village.row) return 'The village center cannot be claimed.'
  if (state.plots[previewCellKey(col, row)]) return 'This plot is already claimed.'
  if (state.villages.some(v => v.id !== village.id && chebyshev(v, target) <= 1)) return 'Other villages and their eight starting plots are protected.'
  if (getPreviewCell(col, row, state.seed).terrain === 'water') return 'Water cannot be claimed.'
  const own = Object.values(state.plots).filter(p => p.villageId === village.id)
  if (own.length < PREVIEW_START_CAPACITY && chebyshev(village, target) > 1) return 'Your first four plots must be among the eight tiles surrounding your village.'
  if (own.length >= claimAllowance(state)) return 'No claim slots remain. Grow your population to unlock another plot.'
  if (chebyshev(village, target) > PREVIEW_CLAIM_RADIUS) return 'Claims must stay within six tiles of your village.'
  if (chebyshev(village, target) > 1 && !own.some(p => chebyshev(p, target) === 1)) return 'Choose a tile touching your village or an existing claim, including diagonals.'
  return null
}

export function terrainModifier(terrain: PreviewTerrain, building: PreviewBuilding): number { return PREVIEW_TERRAIN_MODIFIERS[terrain][building] }

export function plotProductionRate(plot: PreviewPlot, seed = PREVIEW_DEFAULT_SEED): number {
  validatePreviewSeed(seed)
  if (!plot.building || plot.level <= 0) return 0
  return PREVIEW_BASE_RATES[plot.building] * plot.level * terrainModifier(getPreviewCell(plot.col, plot.row, seed).terrain, plot.building)
}

export function buildingCost(plot: PreviewPlot): PreviewStock {
  const base = PREVIEW_BASE_COSTS[plot.building ?? 'farm'], factor = PREVIEW_COST_GROWTH ** plot.level
  return { wood: Math.ceil(base.wood * factor), iron: Math.ceil(base.iron * factor), clay: Math.ceil(base.clay * factor), wheat: Math.ceil(base.wheat * factor) }
}

/** Settle production in segments split at actual completions. A queued level earns nothing early. */
export function advancePreview(state: PreviewState, now: number): PreviewState {
  if (!Number.isFinite(now)) throw new Error('The sample clock must be a finite timestamp.')
  if (now <= state.lastTick) return state
  let current = { ...state, stock: { ...state.stock }, plots: { ...state.plots }, villages: [...state.villages] }
  const completions = Object.values(current.plots).filter(p => p.queue && p.queue.endsAt <= now).map(p => p.queue!.endsAt)
  const boundaries = [...new Set(completions.map(t => Math.max(state.lastTick, t)))].sort((a, b) => a - b)
  boundaries.push(now)
  let from = state.lastTick
  for (const to of boundaries) {
    const hours = (to - from) / 3_600_000
    if (hours > 0) for (const plot of Object.values(current.plots)) {
      if (plot.villageId === current.playerVillageId && plot.building) current.stock[BUILDING_INFO[plot.building].resource] += plotProductionRate(plot, current.seed) * hours
    }
    const growth: Record<string, number> = {}
    for (const [key, plot] of Object.entries(current.plots)) {
      if (!plot.queue || plot.queue.endsAt > to) continue
      growth[plot.villageId] = (growth[plot.villageId] ?? 0) + PREVIEW_POPULATION_PER_LEVEL * Math.max(0, plot.queue.targetLevel - plot.level)
      current.plots[key] = { ...plot, level: plot.queue.targetLevel, queue: null }
    }
    if (Object.keys(growth).length) current.villages = current.villages.map(v => growth[v.id] ? { ...v, population: v.population + growth[v.id] } : v)
    from = to
  }
  return { ...current, lastTick: now }
}

export function claimPreviewPlot(state: PreviewState, col: number, row: number, now: number): PreviewState {
  const wrapped = wrapPreviewCell(col, row)
  col = wrapped.col; row = wrapped.row
  const settled = advancePreview(state, now), reason = claimReason(settled, col, row)
  if (reason) throw new Error(reason)
  return { ...settled, plots: { ...settled.plots, [previewCellKey(col, row)]: { col, row, villageId: settled.playerVillageId, building: null, level: 0, queue: null } } }
}

export function queuePreviewBuilding(state: PreviewState, col: number, row: number, building: PreviewBuilding, now: number): PreviewState {
  const wrapped = wrapPreviewCell(col, row)
  col = wrapped.col; row = wrapped.row
  const settled = advancePreview(state, now), key = previewCellKey(col, row), plot = settled.plots[key]
  if (!Object.hasOwn(BUILDING_INFO, building)) throw new Error('Choose a valid resource building.')
  if (!plot || plot.villageId !== settled.playerVillageId) throw new Error('Claim this land before building on it.')
  if (getPreviewCell(col, row, settled.seed).terrain === 'water') throw new Error('Buildings require land.')
  if (plot.queue) throw new Error('This plot already has a building in progress.')
  if (plot.building && plot.building !== building) throw new Error('Upgrade this plot’s existing building.')
  const planned = { ...plot, building }, cost = buildingCost(planned)
  for (const resource of resources) if (settled.stock[resource] < cost[resource]) throw new Error(`Not enough ${resource} for this building.`)
  const stock = { ...settled.stock }
  for (const resource of resources) stock[resource] -= cost[resource]
  return { ...settled, stock, plots: { ...settled.plots, [key]: { ...planned, queue: { targetLevel: plot.level + 1, endsAt: Math.max(now, settled.lastTick) + PREVIEW_BUILD_MS } } } }
}
