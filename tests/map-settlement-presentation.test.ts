import test from 'node:test'
import assert from 'node:assert/strict'
import { settlementMapDevelopment } from '../src/features/map/rendering/settlementPresentation'
import type { Building } from '../src/features/city/domain/types'
import type { CitySlot } from '../src/features/city/domain/slots'

const building = (type: Building['building_type'], level: number, settlement = 1): Building => ({ id: 1, settlement_id: settlement, building_type: type, level, updated_at: '2026-10-08T00:00:00.000Z' })
const slot = (type: CitySlot['building_type'], level: number, index = 0): CitySlot => ({ settlement_id: 1, slot_index: index, building_type: type, level })

test('completed hall and supporting construction visibly develop the strategic city', () => {
  assert.equal(settlementMapDevelopment([building('market', 0)], 1), 1)
  assert.equal(settlementMapDevelopment([building('market', 3)], 1), 3)
  assert.equal(settlementMapDevelopment([building('market', 5)], 1), 5)
  assert.equal(settlementMapDevelopment([building('lumber', 3), building('quarry', 3), building('farm', 2)], 1), 2)
  assert.equal(settlementMapDevelopment([], 1, [slot('warehouse', 4), slot('granary', 4, 1)]), 2)
})

test('queued targets and new level-zero slots cannot advance or reduce the completed stage', () => {
  const buildings = [building('market', 3)], slots = [slot('smithy', 2)]
  const queued = { ...buildings[0], queue: { targetLevel: 5 }, target_level: 5 }
  assert.equal(settlementMapDevelopment([queued], 1, slots), 3)
  assert.equal(settlementMapDevelopment(buildings, 1, [...slots, { ...slot('mage_tower', 0, 1), target_level: 10 }]), 3)
  assert.equal(settlementMapDevelopment(buildings, 2, slots), 1)
  assert.equal(settlementMapDevelopment([], 999), 1)
})

test('canonical slots replace legacy copies and repeated records cannot inflate development', () => {
  const legacy = [building('barracks', 5), building('stables', 5), building('storehouse', 5)]
  assert.equal(settlementMapDevelopment(legacy, 1), 3)
  assert.equal(settlementMapDevelopment(legacy, 1, []), 1)
  const canonical = [slot('barracks', 5), slot('stables', 5, 1), slot('warehouse', 5, 2), slot('granary', 5, 3)]
  assert.equal(settlementMapDevelopment(legacy, 1, canonical), settlementMapDevelopment([], 1, canonical))
  assert.equal(settlementMapDevelopment([building('farm', 5), building('farm', 5)], 1, [slot('warehouse', 5), slot('warehouse', 5)]), 2)
})

test('malformed levels are bounded safely and renderer derivation leaves frozen inputs untouched', () => {
  for (const value of [NaN, Infinity, -Infinity, -7, '5', null]) assert.equal(settlementMapDevelopment([building('market', value as number)], 1), 1)
  assert.equal(settlementMapDevelopment([building('market', 1000)], 1), 5)
  assert.equal(settlementMapDevelopment([building('market', 2.9)], 1), 2)
  assert.equal(settlementMapDevelopment([building('market', 5)], NaN), 1)
  const buildings = Object.freeze([Object.freeze(building('market', 3)), Object.freeze(building('farm', 4))])
  const slots = Object.freeze([Object.freeze(slot('granary', 3))])
  const before = structuredClone({ buildings, slots })
  assert.equal(settlementMapDevelopment(buildings, 1, slots), 3)
  assert.deepEqual({ buildings, slots }, before)
})
