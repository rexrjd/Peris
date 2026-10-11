import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { emptyRoster } from '../src/features/army/domain/roster';
import { emptyResources } from '../src/shared/model/resources';
import { groupReports, recordBattleEconomics, reportEconomics, reportSide, visibleReports } from '../src/features/campaign/domain/reportEconomics';
import type { BattleResult } from '../src/features/battle/domain/types';
import type { Report } from '../src/features/campaign/domain/types';

function result(): BattleResult {
    return { attacker_initial: 5, attacker_survivors: 3, attacker_losses: 2, defender_initial: 10, defender_survivors: 0, defender_losses: 10,
        loot: { wood: 100, stone: 30, food: 20, gold: 10 }, duration: 10, reason: 'Army routed',
        attacker_roster: { ...emptyRoster(), scout: 3, catapult: 2 }, attacker_survivor_roster: { ...emptyRoster(), scout: 2, catapult: 1 } };
}
const receipt = (owner: string, id: number, overrides: Partial<Report> = {}): Report => ({ id, owner_id: owner, battle_id: id + 1000, camp_id: 7, title: 'Camp raid', won: true, result: result(), created_at: '2026-10-12T00:00:00Z', ...overrides });

test('profit waits for delivery and subtracts exact nine-role replacement costs after overflow', () => {
    const r = result(); recordBattleEconomics(r);
    assert.deepEqual(r.replacement_cost, { wood: 33, stone: 25, food: 27, gold: 13 });
    assert.equal(r.carrying_capacity, 20);
    assert.equal(r.estimated_profit, undefined);
    assert.equal(reportEconomics(r).profit, null);
    r.delivered = { wood: 20, stone: 10, food: 5, gold: 0 }; r.overflow = { wood: 80, stone: 20, food: 15, gold: 10 };
    assert.deepEqual(reportEconomics(r).profit, { wood: -13, stone: -15, food: -22, gold: -13 });
});

test('persisted loss prices survive a catalog change and legacy aggregate receipts are not guessed', () => {
    const r = result(); r.replacement_cost = { wood: 1000, stone: 0, food: 0, gold: 0 }; r.delivered = emptyResources();
    assert.deepEqual(reportEconomics(r).profit, { wood: -1000, stone: 0, food: 0, gold: 0 });
    delete r.attacker_roster; delete r.attacker_survivor_roster; delete r.replacement_cost;
    assert.equal(reportEconomics(r).replacementCost, null);
    assert.equal(reportEconomics(r).capacity, null);
    r.attacker_losses = 0;
    assert.deepEqual(reportEconomics(r).replacementCost, emptyResources());
});

test('zero-loot defeats have known negative profit; positive old loot is not assumed delivered', () => {
    const r = result(); r.loot = emptyResources();
    assert.deepEqual(reportEconomics(r).profit, { wood: -33, stone: -25, food: -27, gold: -13 });
    r.loot.wood = 10;
    assert.equal(reportEconomics(r).profit, null);
    assert.equal(reportEconomics(r).deliveryUnrecorded, true);
});

test('legacy sparse settlement results wait for spoils to be allocated', () => {
    const r = result(); delete (r as Partial<BattleResult>).loot;
    assert.doesNotThrow(() => recordBattleEconomics(r));
    assert.deepEqual(r.replacement_cost, { wood: 33, stone: 25, food: 27, gold: 13 });
    assert.equal(r.estimated_profit, undefined);
});

test('report access, camp grouping and losses filters remain private when battles are pruned', () => {
    const w = createSolo('Report QA'), owner = w.players[0].id;
    const own = receipt(owner, 1), quiet = receipt(owner, 2, { farm_list_id: 8, result: { ...result(), attacker_losses: 0 } });
    w.campaign_farm_lists = [{ id: 8, owner_id: owner, name: 'Losses only', troops: emptyRoster(), casualties_only: true }];
    const other = receipt('other', 3), unknown = receipt(owner, 4, { camp_id: undefined });
    w.reports = [quiet, other, own, unknown];
    const visible = visibleReports(w, owner);
    assert.deepEqual(visible.map(report => report.id), [4, 1]);
    assert.equal(reportSide(w, own, owner), 'attacker');
    assert.equal(reportSide(w, other, owner), null);
    assert.equal(reportSide(w, unknown, owner), null);
    assert.deepEqual(visibleReports(w, owner, 7).map(report => report.id), [1]);
    assert.deepEqual(groupReports(w, visible).map(group => group.key), ['other', 'camp:7']);
});
