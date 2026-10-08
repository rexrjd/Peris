import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advancePreview, BUILDING_INFO, buildingCost, claimAllowance, claimPreviewPlot, claimReason,
  createPreviewState, getPreviewCell, getPreviewHydrology, getPreviewResourceAccess, playerVillage, plotProductionRate, PREVIEW_BASE_RATES,
  PREVIEW_BUILD_MS, PREVIEW_DEFAULT_SEED, PREVIEW_FAIR_ACCESS, PREVIEW_RACES, previewCellKey, previewHeight, queuePreviewBuilding, terrainModifier,
  PREVIEW_WORLD_SIZE, wrapPreviewCell, wrapPreviewCoordinate, wrappedPreviewDelta, wrappedPreviewDistance,
} from '../src/features/map/preview/model'
import type { PreviewBuilding, PreviewPlot, PreviewState, PreviewTerrain } from '../src/features/map/preview/types'

const ownPlots = (state: PreviewState) => Object.values(state.plots).filter(p => p.villageId === state.playerVillageId)
const withPopulation = (state: PreviewState, population: number): PreviewState => ({ ...state, villages: state.villages.map(v => v.player ? { ...v, population } : v) })
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`)
const emptyPlot = (state: PreviewState, col: number, row: number): PreviewPlot => ({ col, row, villageId: state.playerVillageId, building: null, level: 0, queue: null })

test('topology canonicalizes whole-tile aliases and uses shortest wrapped displacements', () => {
  assert.equal(PREVIEW_WORLD_SIZE, 200)
  assert.equal(wrapPreviewCoordinate(100), -100)
  assert.equal(wrapPreviewCoordinate(-100.25), 99.75)
  assert.deepEqual(wrapPreviewCell(300, -301), { col: -100, row: 99 })
  assert.equal(previewCellKey(300, -301), previewCellKey(-100, 99))
  assert.equal(wrappedPreviewDelta(99, -100), 1)
  assert.equal(wrappedPreviewDelta(-100, 99), -1)
  assert.equal(wrappedPreviewDistance({ col: 99, row: 99 }, { col: -100, row: -100 }), 1)
  for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => wrapPreviewCoordinate(invalid), /finite/)
  for (const invalid of [NaN, Infinity, -Infinity, .25]) {
    assert.throws(() => wrapPreviewCell(invalid, 0), /finite whole tiles/)
    assert.throws(() => getPreviewCell(0, invalid), /finite whole tiles/)
  }
})

test('native elevation, gradients, cells, and hydrology join across both seams and corners', () => {
  const epsilon = .0001
  for (const seed of [PREVIEW_DEFAULT_SEED, 1]) {
    for (const axis of [-100, -64.25, -.5, 37.8, 99.99]) {
      near(previewHeight(-100, axis, seed), previewHeight(100, axis, seed))
      near(previewHeight(axis, -100, seed), previewHeight(axis, 100, seed))
      const westSlope = (previewHeight(100 - epsilon, axis, seed) - previewHeight(100 - epsilon * 2, axis, seed)) / epsilon
      const eastSlope = (previewHeight(-100 + epsilon * 2, axis, seed) - previewHeight(-100 + epsilon, axis, seed)) / epsilon
      const northSlope = (previewHeight(axis, 100 - epsilon, seed) - previewHeight(axis, 100 - epsilon * 2, seed)) / epsilon
      const southSlope = (previewHeight(axis, -100 + epsilon * 2, seed) - previewHeight(axis, -100 + epsilon, seed)) / epsilon
      assert.ok(Math.abs(westSlope - eastSlope) < .01)
      assert.ok(Math.abs(northSlope - southSlope) < .01)
    }
    for (const [col, row] of [[99, 99], [-100, -100], [-100, 99], [99, -100], [73, 22]]) {
      assert.deepEqual(getPreviewCell(col, row, seed), getPreviewCell(col + 200, row - 400, seed))
      near(previewHeight(col + .37, row + .22, seed), previewHeight(col + 400.37, row - 199.78, seed))
    }
    const hydrology = getPreviewHydrology(seed)
    const crossings = hydrology.rivers.filter(path => path.some(point => Math.abs(point.z) >= 100))
    assert.ok(crossings.length >= 4)
    for (const path of crossings) for (const point of path) if (Math.abs(point.z) >= 99) assert.ok(previewHeight(point.x, point.z, seed) < -.04, 'Visible seam ribbons must sit over the authoritative periodic river bed')
    const seamBasins = hydrology.oases.filter(basin => basin.x + basin.waterRadius > 100 || basin.x - basin.waterRadius < -100)
    assert.ok(seamBasins.length >= 2)
    for (const basin of seamBasins) assert.ok(previewHeight(basin.x, basin.z, seed) < basin.surfaceHeight)
  }
})

test('corner claims connect across both seams, aliases collide, and wrapped starts stay protected', () => {
  const original = createPreviewState(0), town = { ...playerVillage(original), col: 99, row: 99, population: 600 }
  let state: PreviewState = { ...original, villages: [town], plots: {} }
  for (const [col, row] of [[100, 100], [99, 100], [100, 99], [98, 98]]) {
    assert.equal(claimReason(state, col, row), null)
    state = claimPreviewPlot(state, col, row, 0)
  }
  assert.ok(state.plots['-100,-100'])
  assert.equal(state.plots['-100,-100'].col, -100)
  assert.equal(state.plots['-100,-100'].row, -100)
  assert.throws(() => claimPreviewPlot(state, 300, -100, 0), /already claimed/)
  assert.match(claimReason(state, 299, -101)!, /center/)
  assert.equal(claimReason(state, 101, 101), null)
  state = claimPreviewPlot(state, 101, 101, 0)
  assert.ok(state.plots['-99,-99'])
  assert.match(claimReason(state, 106, 99)!, /six tiles/)
  const queued = queuePreviewBuilding(state, 300, 300, 'farm', 0)
  assert.ok(queued.plots['-100,-100'].queue)
  assert.equal(Object.keys(queued.plots).length, Object.keys(state.plots).length)
  const protectedState = { ...original, villages: [town, { ...town, id: 'seam-neighbor', col: -97, row: 99, player: false }], plots: {} }
  assert.match(claimReason(protectedState, 102, 99)!, /protected/)
  assert.equal(plotProductionRate({ ...state.plots['-100,-100'], building: 'farm', level: 1 }, state.seed), plotProductionRate({ ...state.plots['-100,-100'], col: 300, row: 300, building: 'farm', level: 1 }, state.seed))
})

test('resource reachability traverses seam land and honors protected rings on the opposite edge', () => {
  let found = false
  for (let row = -99; row < 99 && !found; row++) {
    const full = getPreviewResourceAccess(99, row, PREVIEW_DEFAULT_SEED, 6)
    const starts = [-6, -3, 0, 3, 6].map(offset => wrapPreviewCell(-99, row + offset))
    const blocked = getPreviewResourceAccess(99, row, PREVIEW_DEFAULT_SEED, 6, starts)
    if (Object.keys(full).some(resource => full[resource as keyof typeof full] > blocked[resource as keyof typeof blocked])) {
      found = true
      assert.deepEqual(full, getPreviewResourceAccess(-101, row + 200, PREVIEW_DEFAULT_SEED, 6))
      assert.deepEqual(blocked, getPreviewResourceAccess(299, row, PREVIEW_DEFAULT_SEED, 6, starts.map(start => ({ col: start.col + 200, row: start.row - 200 }))))
    }
  }
  assert.ok(found, 'An actual seam catchment must gain a richer resource through the opposite edge, until protected starts block its route')
})

test('sample is deterministic, independent, and has a broad mainland with every terrain and race', () => {
  const state = createPreviewState(42), second = createPreviewState(42)
  assert.deepEqual(state, second)
  assert.notEqual(state.villages, second.villages)
  assert.notEqual(state.stock, second.stock)
  assert.equal(state.version, 1)
  assert.equal(state.seed, PREVIEW_DEFAULT_SEED)
  assert.equal(state.lastTick, 42)
  assert.ok(state.villages.length >= 150 && state.villages.length <= 250)
  assert.deepEqual(new Set(state.villages.map(v => v.race)), new Set(PREVIEW_RACES.map(r => r.id)))
  assert.equal(new Set(state.villages.map(v => v.name)).size, state.villages.length)
  assert.equal(state.villages.filter(v => v.name === 'Willowford').length, 1)
  const terrains = new Set<PreviewTerrain>()
  let land = 0
  for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
    const cell = getPreviewCell(col, row)
    terrains.add(cell.terrain)
    if (cell.terrain !== 'water') land++
    else assert.ok(cell.height < -0.04, 'Authoritative water must have a bed below its surface.')
  }
  assert.ok(land / 40_000 >= 0.85 && land / 40_000 <= .94)
  assert.equal(terrains.size, 8)
  assert.equal(getPreviewCell(66, 32).terrain, 'desert')
  assert.ok(getPreviewHydrology().rivers.length >= 6)
  assert.ok(getPreviewHydrology().oases.length >= 6)
})

test('several seeds generate fair reachable catchments, dry starter rings, and uneven settlements', () => {
  for (const seed of [0, 1, 982_451_653, 0xffffffff]) {
    const state = createPreviewState(42, seed), terrainCounts = new Map<PreviewTerrain, number>()
    assert.equal(state.seed, seed)
    assert.equal(new Set(state.villages.map(v => v.name)).size, state.villages.length, 'Inspector owner names must be unambiguous')
    assert.ok(state.villages.length >= 150 && state.villages.length <= 250, `Seed ${seed}: ${state.villages.length} villages`)
    for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
      const cell = getPreviewCell(col, row, seed)
      terrainCounts.set(cell.terrain, (terrainCounts.get(cell.terrain) ?? 0) + 1)
      assert.equal(cell.height, previewHeight(col + .5, row + .5, seed))
      if (cell.terrain === 'water') assert.ok(cell.height < -.04)
    }
    const landRatio = 1 - (terrainCounts.get('water') ?? 0) / 40_000
    assert.ok(landRatio >= .85 && landRatio <= .94, `Seed ${seed}: ${landRatio} land`)
    assert.equal(terrainCounts.size, 8)
    const nearestDistances = new Set<number>(), resourceProfiles = new Set<string>()
    const opportunities = { wood: new Set<number>(), iron: new Set<number>(), clay: new Set<number>(), wheat: new Set<number>() }
    for (const village of state.villages) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) assert.notEqual(getPreviewCell(village.col + dx, village.row + dy, seed).terrain, 'water')
      const access = getPreviewResourceAccess(village.col, village.row, seed, 6, state.villages)
      for (const resource of ['wood', 'iron', 'clay', 'wheat'] as const) {
        assert.ok(access[resource] + 1e-8 >= PREVIEW_FAIR_ACCESS[resource], `${village.name} must have viable ${resource} access`)
        if (!PREVIEW_RACES.some(town => town.col === village.col && town.row === village.row)) opportunities[resource].add(access[resource])
      }
      if (!PREVIEW_RACES.some(town => town.col === village.col && town.row === village.row)) resourceProfiles.add(JSON.stringify(access))
      const distances = state.villages.filter(v => v.id !== village.id).map(v => wrappedPreviewDistance(v, village))
      const nearest = Math.min(...distances)
      assert.ok(nearest >= 8, 'Distinct starts and six-tile catchments cannot overlap another starter ring')
      nearestDistances.add(nearest)
    }
    assert.ok(nearestDistances.size >= 5, 'Settlements have varied separations rather than a repeated grid step')
    assert.ok(resourceProfiles.size >= 4, 'Ordinary towns must have distinct resource opportunity profiles')
    assert.ok(Object.values(opportunities).filter(rates => Math.max(...rates) / Math.min(...rates) >= 1.1).length >= 2, 'At least two resources offer materially richer and more ordinary sites')
    for (const town of PREVIEW_RACES) {
      const raceStart = { ...state, playerVillageId: state.villages.find(v => v.col === town.col && v.row === town.row)!.id, plots: {} }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) assert.equal(claimReason(raceStart, town.col + dx, town.row + dy), null)
    }
  }
})

test('seed input is explicit, independent, deterministic, and produces different worlds', () => {
  const a = createPreviewState(10, 0), b = createPreviewState(10, 1), again = createPreviewState(10, 0)
  assert.deepEqual(a, again)
  assert.notDeepEqual(a.villages.map(v => [v.col, v.row]), b.villages.map(v => [v.col, v.row]))
  assert.notDeepEqual(getPreviewHydrology(0), getPreviewHydrology(1))
  assert.notDeepEqual(Array.from({ length: 40 }, (_, i) => getPreviewCell(i - 20, i - 35, 0).terrain), Array.from({ length: 40 }, (_, i) => getPreviewCell(i - 20, i - 35, 1).terrain))
  a.villages[0].population = 999
  assert.equal(createPreviewState(10, 0).villages[0].population, 80)
  for (const invalid of [NaN, Infinity, -Infinity, -1, .5, 0x100000000]) {
    assert.throws(() => createPreviewState(0, invalid), /finite unsigned 32-bit/)
    assert.throws(() => getPreviewCell(0, 0, invalid), /finite unsigned 32-bit/)
    assert.throws(() => previewHeight(0, 0, invalid), /finite unsigned 32-bit/)
    assert.throws(() => getPreviewHydrology(invalid), /finite unsigned 32-bit/)
  }
})

test('resource opportunity excludes protected towns and cannot cross water or exceed radius six', () => {
  const state = createPreviewState(0), village = playerVillage(state)
  const protectedRing = []
  for (let dx = -2; dx <= 2; dx += 2) for (let dy = -2; dy <= 2; dy += 2) if (dx || dy) protectedRing.push({ col: village.col + dx, row: village.row + dy })
  assert.deepEqual(getPreviewResourceAccess(village.col, village.row, state.seed, 6, protectedRing), { wood: 0, iron: 0, clay: 0, wheat: 0 })
  assert.throws(() => getPreviewResourceAccess(village.col, village.row, state.seed, 7), /one to six/)
})

test('state-based production and building validation use the persisted realm seed', () => {
  const state = createPreviewState(0, 1), village = playerVillage(state)
  let resourceCell: { col: number; row: number } | null = null, waterCell: { col: number; row: number } | null = null
  for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
    const seeded = getPreviewCell(col, row, state.seed), original = getPreviewCell(col, row)
    if (!waterCell && seeded.terrain === 'water' && original.terrain !== 'water' && !state.villages.some(v => Math.max(Math.abs(v.col - col), Math.abs(v.row - row)) <= 1)) waterCell = { col, row }
    if (!resourceCell && seeded.terrain !== 'water' && original.terrain !== 'water' && terrainModifier(seeded.terrain, 'farm') !== terrainModifier(original.terrain, 'farm') && Math.max(Math.abs(village.col - col), Math.abs(village.row - row)) <= 6) resourceCell = { col, row }
    if (resourceCell && waterCell) break
  }
  assert.ok(resourceCell && waterCell)
  const completed: PreviewPlot = { ...emptyPlot(state, resourceCell.col, resourceCell.row), building: 'farm', level: 1 }
  const owned = { ...state, plots: { [previewCellKey(completed.col, completed.row)]: completed } }
  const expected = PREVIEW_BASE_RATES.farm * terrainModifier(getPreviewCell(completed.col, completed.row, state.seed).terrain, 'farm')
  near(plotProductionRate(completed, state.seed), expected)
  assert.notEqual(plotProductionRate(completed), expected)
  near(advancePreview(owned, 3_600_000).stock.wheat, owned.stock.wheat + expected)
  assert.match(claimReason(state, waterCell.col, waterCell.row)!, /Water/)
  const waterOwned = { ...state, plots: { [previewCellKey(waterCell.col, waterCell.row)]: emptyPlot(state, waterCell.col, waterCell.row) } }
  assert.throws(() => queuePreviewBuilding(waterOwned, waterCell.col, waterCell.row, 'farm', 0), /land/)
})

test('settlements have distinct protected 3-by-3 land, safe spacing, and sparse NPC development', () => {
  const state = createPreviewState(0), reserved = new Set<string>()
  for (const village of state.villages) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const col = village.col + dx, row = village.row + dy, key = previewCellKey(col, row)
      assert.notEqual(getPreviewCell(col, row).terrain, 'water')
      assert.ok(!reserved.has(key), `${key} must belong to just one starting area`)
      reserved.add(key)
    }
  }
  assert.ok(Object.values(state.plots).some(p => p.level > 0))
  for (const plot of Object.values(state.plots)) {
    const village = state.villages.find(v => v.id === plot.villageId)!
    assert.ok(village && !village.player)
    assert.equal(wrappedPreviewDistance(plot, village), 1)
    assert.ok(plot.col >= -100 && plot.col <= 99 && plot.row >= -100 && plot.row <= 99)
    assert.ok(!state.villages.some(v => v.col === plot.col && v.row === plot.row))
  }
})

test('native elevation samples tile centers and stays continuous across tile boundaries', () => {
  for (const [col, row] of [[-11, 35], [-20, -60], [60, 25], [-100, 0]]) {
    assert.equal(getPreviewCell(col, row).height, previewHeight(col + 0.5, row + 0.5))
    assert.ok(Math.abs(previewHeight(col - 0.00001, row) - previewHeight(col + 0.00001, row)) < 0.001)
  }
  assert.ok(previewHeight(-20, -60) > previewHeight(-12, 36))
})

test('Willowford has zero external plots, finite bootstrap stock, and all eight first choices', () => {
  const state = createPreviewState(0), village = playerVillage(state)
  assert.deepEqual([village.name, village.col, village.row, village.population], ['Willowford', -12, 36, 80])
  assert.equal(ownPlots(state).length, 0)
  assert.equal(claimAllowance(state), 4)
  assert.ok(Object.values(state.stock).every(n => Number.isFinite(n) && n > 0))
  assert.equal(getPreviewCell(-13, 35).terrain, 'forest')
  assert.equal(getPreviewCell(-11, 35).terrain, 'mountain')
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue
    assert.equal(claimReason(state, village.col + dx, village.row + dy), null)
    const claimed = claimPreviewPlot(state, village.col + dx, village.row + dy, 0)
    assert.deepEqual(ownPlots(claimed)[0], emptyPlot(state, village.col + dx, village.row + dy))
    assert.equal(ownPlots(state).length, 0)
  }
})

test('diagonal claims connect, duplicate claims fail, and isolated land stays unavailable', () => {
  const state = withPopulation(createPreviewState(0), 120), first = claimPreviewPlot(state, -11, 37, 0)
  let starter = first
  for (const [col, row] of [[-13, 35], [-12, 35], [-11, 35]]) starter = claimPreviewPlot(starter, col, row, 0)
  assert.equal(claimReason(starter, -10, 38), null)
  assert.match(claimReason(starter, -14, 38)!, /touching/)
  assert.equal(ownPlots(claimPreviewPlot(starter, -10, 38, 0)).length, 5)
  assert.throws(() => claimPreviewPlot(first, -11, 37, 0), /already claimed/)
  assert.throws(() => claimPreviewPlot(state, -12, 36, 0), /center/)
})

test('the first four claims stay in the starter ring even when touching claims and extra slots exist', () => {
  let state = claimPreviewPlot(withPopulation(createPreviewState(0), 600), -11, 37, 0)
  for (const [col, row] of [[-13, 35], [-12, 35], [-11, 35]]) {
    assert.match(claimReason(state, -10, 38)!, /first four.*eight tiles/)
    assert.throws(() => claimPreviewPlot(state, -10, 38, 0), /first four.*eight tiles/)
    state = claimPreviewPlot(state, col, row, 0)
  }
  assert.equal(ownPlots(state).length, 4)
  assert.equal(claimReason(state, -10, 38), null)
  assert.equal(ownPlots(claimPreviewPlot(state, -10, 38, 0)).length, 5)
})

test('four slots fill exactly and population milestones unlock successive additional claims', () => {
  let state = createPreviewState(0)
  for (const [col, row] of [[-13, 35], [-12, 35], [-11, 35], [-13, 36]]) state = claimPreviewPlot(state, col, row, 0)
  assert.equal(ownPlots(state).length, 4)
  assert.throws(() => claimPreviewPlot(state, -11, 36, 0), /No claim slots/)
  assert.equal(claimAllowance(withPopulation(state, 119)), 4)
  assert.equal(claimAllowance(withPopulation(state, 120)), 5)
  assert.equal(claimAllowance(withPopulation(state, 159)), 5)
  assert.equal(claimAllowance(withPopulation(state, 160)), 6)
  assert.equal(claimAllowance(withPopulation(state, 200)), 7)
  assert.equal(ownPlots(claimPreviewPlot(withPopulation(state, 120), -11, 36, 0)).length, 5)
})

test('claim coordinates, six-tile radius, water, and all other village starting land are protected', () => {
  let state = withPopulation(createPreviewState(0), 600)
  for (const [col, row] of [[NaN, 36], [Infinity, 36], [-12, -Infinity], [-12.5, 36]]) assert.match(claimReason(state, col, row)!, /finite whole-tile/)
  let water: { col: number; row: number } | null = null
  for (let row = -100; row < 100 && !water; row++) for (let col = -100; col < 100 && !water; col++) if (getPreviewCell(col, row).terrain === 'water' && !state.villages.some(v => wrappedPreviewDistance(v, { col, row }) <= 1)) water = { col, row }
  assert.ok(water)
  assert.match(claimReason(state, water.col, water.row)!, /Water/)
  for (const village of state.villages.filter(v => !v.player)) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      assert.match(claimReason(state, village.col + dx, village.row + dy)!, /protected|already claimed/)
    }
  }
  for (const [col, row] of [[-13, 35], [-12, 35], [-11, 35], [-11, 36]]) state = claimPreviewPlot(state, col, row, 0)
  for (let col = -10; col <= -6; col++) state = claimPreviewPlot(state, col, 36, 0)
  assert.equal(ownPlots(state).length, 9)
  assert.match(claimReason(state, -5, 36)!, /six tiles/)
})

test('empty and level-zero plots never produce, while mountain farms yield exactly 75 percent', () => {
  let state = claimPreviewPlot(createPreviewState(0), -11, 35, 0)
  const plot = ownPlots(state)[0]
  assert.equal(plotProductionRate(plot), 0)
  assert.equal(plotProductionRate({ ...plot, building: 'farm' }), 0)
  assert.equal(terrainModifier('mountain', 'farm'), 0.75)
  assert.equal(plotProductionRate({ ...plot, building: 'farm', level: 1 }), PREVIEW_BASE_RATES.farm * 0.75)
  const stock = { ...state.stock }
  state = advancePreview(state, 3_600_000)
  assert.deepEqual(state.stock, stock)
})

test('fertile grassland farms receive a modest ten-percent bonus against the normal base rate', () => {
  const state = claimPreviewPlot(createPreviewState(0), -12, 37, 0), plot = ownPlots(state)[0]
  assert.equal(getPreviewCell(plot.col, plot.row).terrain, 'grassland')
  assert.equal(terrainModifier('grassland', 'farm'), 1.1)
  near(plotProductionRate({ ...plot, building: 'farm', level: 1 }), PREVIEW_BASE_RATES.farm * 1.1)
  near(plotProductionRate({ ...plot, building: 'farm', level: 2 }), PREVIEW_BASE_RATES.farm * 2 * 1.1)
})

test('all four resource buildings can be built on every land terrain', () => {
  const state = createPreviewState(0), cells = new Map<PreviewTerrain, { col: number; row: number }>()
  for (let row = -95; row <= 95 && cells.size < 7; row++) for (let col = -95; col <= 95; col++) {
    const cell = getPreviewCell(col, row)
    if (cell.terrain !== 'water' && !cells.has(cell.terrain)) cells.set(cell.terrain, cell)
  }
  assert.equal(cells.size, 7)
  for (const [terrain, { col, row }] of cells) for (const building of Object.keys(BUILDING_INFO) as PreviewBuilding[]) {
    const key = previewCellKey(col, row), plot = emptyPlot(state, col, row)
    const owned = { ...state, plots: { ...state.plots, [key]: plot } }
    const queued = queuePreviewBuilding(owned, col, row, building, 0)
    assert.equal(queued.plots[key].building, building)
    assert.ok(terrainModifier(terrain, building) > 0)
    assert.ok(plotProductionRate({ ...queued.plots[key], level: 1 }) > 0)
  }
})

test('queue deducts exact finite costs, reserves a building at level zero, and preserves its input', () => {
  const claimed = claimPreviewPlot(createPreviewState(0), -11, 35, 0), before = structuredClone(claimed)
  const plot = ownPlots(claimed)[0], cost = buildingCost({ ...plot, building: 'farm' })
  const queued = queuePreviewBuilding(claimed, -11, 35, 'farm', 0), building = ownPlots(queued)[0]
  for (const resource of ['wood', 'iron', 'clay', 'wheat'] as const) assert.equal(queued.stock[resource], claimed.stock[resource] - cost[resource])
  assert.equal(building.level, 0)
  assert.deepEqual(building.queue, { targetLevel: 1, endsAt: PREVIEW_BUILD_MS })
  assert.equal(plotProductionRate(building), 0)
  assert.deepEqual(claimed, before)
  assert.throws(() => queuePreviewBuilding(queued, -11, 35, 'farm', 0), /in progress/)
  assert.throws(() => queuePreviewBuilding({ ...claimed, stock: { ...claimed.stock, wood: 0 } }, -11, 35, 'farm', 0), /Not enough wood/)
  assert.throws(() => queuePreviewBuilding(claimed, -12, 37, 'farm', 0), /Claim/)
  assert.throws(() => queuePreviewBuilding(claimed, -11, 35, 'unknown' as PreviewBuilding, 0), /valid resource/)
  assert.throws(() => queuePreviewBuilding(claimed, Infinity, 0, 'farm', 0), /finite whole tiles/)
})

test('completion timing adds population once and pays only for time after completed level one', () => {
  const claimed = claimPreviewPlot(createPreviewState(0), -11, 35, 0)
  const queued = queuePreviewBuilding(claimed, -11, 35, 'farm', 0), before = structuredClone(queued)
  const early = advancePreview(queued, PREVIEW_BUILD_MS - 1)
  assert.equal(ownPlots(early)[0].level, 0)
  assert.deepEqual(early.stock, queued.stock)
  const complete = advancePreview(early, PREVIEW_BUILD_MS)
  assert.equal(ownPlots(complete)[0].level, 1)
  assert.equal(ownPlots(complete)[0].queue, null)
  assert.equal(playerVillage(complete).population, 90)
  assert.deepEqual(complete.stock, queued.stock)
  const later = advancePreview(queued, PREVIEW_BUILD_MS + 3_600_000)
  near(later.stock.wheat, queued.stock.wheat + 27)
  assert.equal(playerVillage(later).population, 90)
  assert.equal(advancePreview(later, later.lastTick), later)
  assert.equal(advancePreview(later, later.lastTick - 1), later)
  assert.deepEqual(queued, before)
})

test('upgrade produces the old rate before completion, then the new rate without double accrual', () => {
  let state = claimPreviewPlot(createPreviewState(0), -11, 35, 0)
  state = advancePreview(queuePreviewBuilding(state, -11, 35, 'farm', 0), PREVIEW_BUILD_MS)
  const plot = ownPlots(state)[0], cost = buildingCost(plot), next = queuePreviewBuilding(state, -11, 35, 'farm', PREVIEW_BUILD_MS)
  assert.ok(cost.wood > buildingCost({ ...plot, level: 0 }).wood)
  assert.equal(ownPlots(next)[0].level, 1)
  const end = PREVIEW_BUILD_MS * 2 + 3_600_000, settled = advancePreview(next, end)
  near(settled.stock.wheat, next.stock.wheat + 27 * PREVIEW_BUILD_MS / 3_600_000 + 54)
  assert.equal(ownPlots(settled)[0].level, 2)
  assert.equal(playerVillage(settled).population, 100)
  assert.throws(() => queuePreviewBuilding(settled, -11, 35, 'iron-mine', end), /existing building/)
  let incremental = next
  for (let now = next.lastTick + 1_000; now < end; now += 1_000) incremental = advancePreview(incremental, now)
  incremental = advancePreview(incremental, end)
  near(incremental.stock.wheat, settled.stock.wheat)
  assert.equal(playerVillage(incremental).population, 100)
})

test('staggered parallel completions settle their own production segments and fourth completion unlocks land', () => {
  let state = createPreviewState(0)
  for (const [col, row] of [[-13, 35], [-12, 35], [-11, 35], [-13, 36]]) state = claimPreviewPlot(state, col, row, 0)
  state = queuePreviewBuilding(state, -13, 35, 'lumber-mill', 0)
  state = queuePreviewBuilding(state, -12, 35, 'farm', 3_000)
  state = queuePreviewBuilding(state, -11, 35, 'iron-mine', 3_000)
  state = queuePreviewBuilding(state, -13, 36, 'clay-pit', 3_000)
  const baseline = { ...state.stock }, settled = advancePreview(state, 9_000)
  near(settled.stock.wood, baseline.wood + 30 * 1.25 * 3_000 / 3_600_000)
  assert.equal(settled.stock.wheat, baseline.wheat)
  assert.equal(settled.stock.iron, baseline.iron)
  assert.equal(settled.stock.clay, baseline.clay)
  assert.equal(playerVillage(settled).population, 120)
  assert.equal(claimAllowance(settled), 5)
  assert.equal(ownPlots(claimPreviewPlot(settled, -11, 36, 9_000)).length, 5)
})
