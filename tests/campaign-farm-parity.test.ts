import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { commandCampaignFarm, validateCampaignFarms } from '../src/features/campaign/domain/farms';
import { ensureCampaignFarmStats, sortCampaignFarms } from '../src/features/campaign/domain/farmStats';
import { advanceCampFarms } from '../src/features/campaign/domain/campEconomy';
import { deliverCampLoot } from '../src/features/campaign/domain/loot';
import type { LocalCommandContext } from '../src/shared/model/commands';
import type { BattleResult } from '../src/features/battle/domain/types';

function fixture() {
    const world = createSolo('Farm parity'); let id = 10000;
    const ctx: LocalCommandContext = { world, playerId: world.players[0].id, now: world.server_now, nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    const party = { infantry: 3, archers: 0, cavalry: 0, scout: 1 }, army = world.armies[0], camps = world.camps.filter(c => c.bandit).slice(0, 3);
    const list = (name: string) => { commandCampaignFarm(ctx, { type: 'saveCampaignFarmList', name, troops: party, casualtiesOnly: true }); return world.campaign_farm_lists!.at(-1)!; };
    const first = list('Nearby camps'), second = list('Other camps');
    const target = (campId: number, listId = first.id) => { commandCampaignFarm(ctx, { type: 'saveCampaignFarm', campId, listId, armyId: army.id, troops: party, enabled: true, intervalSeconds: 300 }); return world.campaign_farms!.at(-1)!; };
    return { world, ctx, army, camps, party, first, second, target };
}
const result = (): BattleResult => ({ attacker_initial: 10, defender_initial: 0, attacker_survivors: 10, defender_survivors: 0, attacker_losses: 0, defender_losses: 0, loot: { wood: 100, stone: 0, food: 0, gold: 0 }, duration: 2, reason: 'Victory' });

test('bulk farm moves are atomic, preserve parties/schedules/counters and leave travelling troops alone', () => {
    const f = fixture(), one = f.target(f.camps[0].id), two = f.target(f.camps[1].id), existing = f.target(f.camps[0].id, f.second.id);
    one.sent = 2; one.skipped = 3;
    const before = structuredClone(f.world);
    assert.throws(() => commandCampaignFarm(f.ctx, { type: 'manageCampaignFarmTargets', ids: [one.id,two.id], action: 'move', listId: f.second.id }), /already/);
    assert.deepEqual(f.world, before);
    commandCampaignFarm(f.ctx, { type: 'manageCampaignFarmTargets', ids: [existing.id], action: 'delete' });
    const snapshots = [one,two].map(target => ({ ...structuredClone(target), list_id: f.second.id })), armies = structuredClone(f.world.armies);
    commandCampaignFarm(f.ctx, { type: 'manageCampaignFarmTargets', ids: [one.id,two.id], action: 'move', listId: f.second.id });
    assert.deepEqual(f.world.campaign_farms, snapshots); assert.deepEqual(f.world.armies, armies);
    commandCampaignFarm(f.ctx, { type: 'manageCampaignFarmTargets', ids: [one.id,two.id], action: 'delete' });
    assert.deepEqual(f.world.campaign_farms, []); assert.deepEqual(f.world.armies, armies);
});

test('bulk actions reject foreign, duplicate, malformed and missing IDs before changing anything', () => {
    const f = fixture(), target = f.target(f.camps[0].id);
    for (const ids of [[target.id,999],[target.id,target.id],[],[target.id+.5]]) {
        const before = structuredClone(f.world);
        assert.throws(() => commandCampaignFarm(f.ctx, { type: 'manageCampaignFarmTargets', ids, action: 'delete' })); assert.deepEqual(f.world, before);
    }
    const before = structuredClone(f.world);
    assert.throws(() => commandCampaignFarm({ ...f.ctx, playerId: 'rival' }, { type: 'manageCampaignFarmTargets', ids: [target.id], action: 'delete' }), /own/); assert.deepEqual(f.world, before);
});

test('whole-list pause/enable and preset application preserve active orders and unaffected schedules', () => {
    const f = fixture(), target = f.target(f.camps[0].id), next = target.next_at, armies = structuredClone(f.world.armies);
    commandCampaignFarm(f.ctx, { type: 'setCampaignFarmListEnabled', id: f.first.id, enabled: true }); assert.equal(target.next_at, next);
    commandCampaignFarm(f.ctx, { type: 'setCampaignFarmListEnabled', id: f.first.id, enabled: false }); assert.equal(target.next_at, null);
    f.ctx.now = new Date(Date.parse(f.ctx.now) + 10000).toISOString();
    commandCampaignFarm(f.ctx, { type: 'setCampaignFarmListEnabled', id: f.first.id, enabled: true }); assert.equal(Date.parse(target.next_at!) - Date.parse(f.ctx.now), 300000);
    const restarted = target.next_at;
    f.first.troops = { infantry: 0, archers: 0, cavalry: 0, scout: 2, heavyCavalry: 3 };
    commandCampaignFarm(f.ctx, { type: 'applyCampaignFarmListTroops', id: f.first.id }); assert.deepEqual(target.troops, f.first.troops); assert.equal(target.next_at, restarted); assert.deepEqual(f.world.armies, armies);
    f.first.troops = { infantry: 0, archers: 0, cavalry: 0 };
    assert.throws(() => commandCampaignFarm(f.ctx, { type: 'applyCampaignFarmListTroops', id: f.first.id }), /preset/);
});

test('all-time camp history counts delivered resources once, survives quiet filters/pruning and excludes pending loot', () => {
    const f = fixture(); f.target(f.camps[0].id);
    f.world.reports = [
        { id: 1, owner_id: f.ctx.playerId, battle_id: 501, camp_id: f.camps[0].id, farm_list_id: f.first.id, title: 'Quiet delivery', won: true, result: { ...result(), delivered: { wood: 7, stone: 0, food: 0, gold: 0 } }, created_at: f.ctx.now },
        { id: 2, owner_id: f.ctx.playerId, battle_id: 502, camp_id: f.camps[0].id, title: 'Pending', won: true, result: result(), created_at: f.ctx.now },
    ];
    ensureCampaignFarmStats(f.world); assert.equal(f.world.campaign_farm_stats![0].total_loot, 7); assert.equal(f.world.campaign_farm_stats![0].raids, 1);
    f.world.reports = f.world.reports.slice(1); f.army.carried_loot = { wood: 100, stone: 0, food: 0, gold: 0 }; f.army.loot_report_id = 502;
    const city = f.world.settlements[0]; city.wood = city.capacity - 3;
    deliverCampLoot(f.world, f.army); const stats = structuredClone(f.world.campaign_farm_stats);
    assert.equal(stats![0].total_loot, 10); assert.equal(stats![0].last_loot, 3); assert.equal(stats![0].raids, 2);
    assert.equal(f.world.reports[0].result.overflow!.wood, 97);
    deliverCampLoot(f.world, f.army); assert.deepEqual(f.world.campaign_farm_stats, stats);
    f.world.reports = []; assert.deepEqual(ensureCampaignFarmStats(f.world), stats);
});

test('reverse sorts keep missing history/paused schedules last and use persistent delivered totals', () => {
    const f = fixture(), one = f.target(f.camps[0].id), two = f.target(f.camps[1].id), missing = f.target(f.camps[2].id);
    f.world.campaign_farm_stats = [one,two].map((target,index) => ({ owner_id: f.ctx.playerId, camp_id: target.camp_id, raids: 2, last_raid_at: f.ctx.now, last_loot: index+1, total_loot: (index+1)*10, last_result: 'attacker', last_losses: 0 }));
    assert.deepEqual(sortCampaignFarms(f.world,f.ctx.playerId,[missing,two,one],'totalBounty',false,Date.parse(f.ctx.now)).map(f=>f.id), [one.id,two.id,missing.id]);
    assert.deepEqual(sortCampaignFarms(f.world,f.ctx.playerId,[missing,one,two],'totalBounty',true,Date.parse(f.ctx.now)).map(f=>f.id), [two.id,one.id,missing.id]);
    missing.enabled=false; two.next_at=new Date(Date.parse(one.next_at!)+60000).toISOString();
    assert.deepEqual(sortCampaignFarms(f.world,f.ctx.playerId,[missing,one,two],'nextAttack',true,Date.parse(f.ctx.now)).map(f=>f.id), [two.id,one.id,missing.id]);
});

test('scheduled attempts record skips without backfilling a flood and farm stat imports validate ownership and totals', () => {
    const f = fixture(), target = f.target(f.camps[0].id);
    target.next_at = new Date(Date.parse(f.ctx.now)-3600000).toISOString(); f.army.status = 'moving';
    advanceCampFarms(f.ctx, Date.parse(f.ctx.now)); assert.equal(target.skipped, 1); assert.equal(target.sent??0, 0); assert.equal(Date.parse(target.next_at!), Date.parse(f.ctx.now)+300000);
    const valid = { owner_id: f.ctx.playerId, camp_id: f.camps[0].id, raids: 1, last_raid_at: f.ctx.now, last_loot: 3, total_loot: 4, last_result: 'attacker' as const, last_losses: 0 };
    f.world.campaign_farm_stats = [valid]; assert.doesNotThrow(()=>validateCampaignFarms(f.world));
    for (const patch of [{ owner_id: 'rival' }, { raids: -1 }, { last_loot: 5 }, { total_loot: Infinity }, { last_raid_at: 'bad date' }]) { f.world.campaign_farm_stats = [{ ...valid, ...patch }]; assert.throws(()=>validateCampaignFarms(f.world), /valid Peris/); }
});
