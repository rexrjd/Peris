import test from 'node:test';
import assert from 'node:assert/strict';
import { sortFarms } from '../src/features/frontier/domain/farmSorting';
import type { CampView, FarmStats, FarmTarget } from '../src/features/frontier/domain/types';

test('farm sorting keeps absent results last, distinguishes losses and never mutates saved order', () => {
    const farms = ['a', 'b', 'c'].map((id, i) => ({ id, campId: id, enabled: i !== 2, nextRunAt: i === 2 ? null : 100 - i * 20 } as FarmTarget));
    const camps = [{ id: 'a', name: 'Camp 2', distance: 50 }, { id: 'b', name: 'Camp 10', distance: 20 }, { id: 'c', name: 'Camp 1', distance: null }] as CampView[];
    const stats: FarmStats[] = [{ campId: 'a', lastRaidAt: 10, lastLoot: 40, totalLoot: 50, result: 'attacker', losses: 0 }, { campId: 'b', lastRaidAt: 20, lastLoot: 10, totalLoot: 90, result: 'attacker', losses: 2 }];
    const order = (by: Parameters<typeof sortFarms>[3], descending = false) => sortFarms(farms, camps, stats, by, descending).map(farm => farm.id).join('');
    assert.equal(order('name'), 'cab');
    assert.equal(order('distance'), 'bac');
    assert.equal(order('distance', true), 'abc');
    assert.equal(order('result'), 'bac');
    assert.equal(order('lastRaid', true), 'bac');
    assert.equal(order('loot', true), 'abc');
    assert.equal(order('totalLoot', true), 'bac');
    assert.equal(order('nextRaid'), 'bac');
    assert.equal(order('nextRaid', true), 'abc');
    assert.equal(farms.map(farm => farm.id).join(''), 'abc');
});
