import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { unreadReportCount, markReportsRead } from '../src/features/campaign/domain/reports';
import type { Report } from '../src/features/campaign/domain/types';

function fixture() {
    const world = createSolo('Reader');
    world.reports = [1, 2, 3].map(id => ({id, battle_id: id + 100, owner_id: id === 3 ? 'other-ruler' : 'solo-ruler', title: 'Battle', won: true, result: {attacker_losses: 0}, created_at: world.server_now} as Report));
    return world;
}
test('fresh reports are unread, and first read timestamps survive repeated opens', () => {
    const world = fixture(), now = world.server_now;
    assert.equal(unreadReportCount(world, 'solo-ruler'), 2);
    markReportsRead(world, 'solo-ruler', [1], now);
    markReportsRead(world, 'solo-ruler', [1], new Date(Date.parse(now) + 1000).toISOString());
    assert.equal(world.reports[0].read_at, now);
    assert.equal(unreadReportCount(world, 'solo-ruler'), 1);
    markReportsRead(world, 'solo-ruler', [2], now);
    assert.equal(unreadReportCount(world, 'solo-ruler'), 0);
});
test('foreign, missing and invalid reports cannot partially mark a batch read', () => {
    const world = fixture();
    for (const ids of [[1, 3], [1, 999], [], [0], [1.5], Array(51).fill(1)])
        assert.throws(() => markReportsRead(world, 'solo-ruler', ids, world.server_now));
    assert.equal(world.reports[0].read_at, undefined);
    assert.equal(unreadReportCount(world, 'solo-ruler'), 2);
});
test('successful casualty-only farm receipts do not inflate the report badge', () => {
    const world = fixture();
    world.campaign_farm_lists = [{id: 9, owner_id: 'solo-ruler', name: 'Farms', casualties_only: true, troops: {infantry: 1, archers: 0, cavalry: 0}}];
    world.reports[0].farm_list_id = 9;
    assert.equal(unreadReportCount(world, 'solo-ruler'), 1);
    world.reports[0].result.attacker_losses = 1;
    assert.equal(unreadReportCount(world, 'solo-ruler'), 2);
});
