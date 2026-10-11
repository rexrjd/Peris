import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFrontierWorld, frontierMapCampId } from '../src/features/frontier/rendering/frontierWorld';
import type { CampView, Raid, Village } from '../src/features/frontier/domain/types';
import { armyPosition } from '../src/features/map/domain/movement';
import { cellCenter } from '../src/features/map/domain/worldGrid';

const date = 1_000_000;
const village: Village = {
    id: 'village', name: 'Home', faction: 'persian', col: 99, row: -100,
    troops: { infantry: 20, archers: 5, cavalry: 2, spearmen: 4 },
    resources: { wood: 100, stone: 80, food: 70, gold: 20 }, producedAt: date,
};
const camp: CampView = {
    id: 'camp-1', name: 'Mercenary camp', tier: 'medium', faction: 'orc', col: -100, row: -100,
    defenders: { infantry: 2, archers: 3, cavalry: 1, elite: 5, heavyCavalry: 2, catapult: 4 },
    resources: { wood: 10, stone: 8, food: 7, gold: 2 }, producedAt: date, distance: 128,
};
const from = cellCenter(village.col, village.row), to = cellCenter(camp.col, camp.row);
const raid: Raid = {
    id: 'raid-1', ownerId: village.id, campId: camp.id, campName: camp.name,
    troops: { infantry: 4, archers: 1, cavalry: 2, spearmen: 3 },
    survivors: { infantry: 3, archers: 1, cavalry: 1, spearmen: 2 }, status: 'outbound',
    departedAt: date, arrivesAt: date + 10_000, returnsAt: date + 20_000, travelMs: 10_000,
    distance: 128, path: [[from.x, from.y], [to.x, to.y]], report: null,
};

test('Frontier map IDs are unique for all canonical camp fields and stable across aliases and viewport ordering', () => {
    const ids = new Set<number>();
    for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) ids.add(frontierMapCampId({ col, row }));
    assert.equal(ids.size, 40_000);
    assert.equal(frontierMapCampId(camp), frontierMapCampId({ col: camp.col + 200, row: camp.row - 200 }));
    const other = { ...camp, id: 'camp-2', col: 0, row: 0 };
    const first = projectFrontierWorld({ village, camps: [camp, other] });
    const reordered = projectFrontierWorld({ village, camps: [other, camp] });
    assert.equal(first.world.camps[0].id, reordered.world.camps[1].id);
    assert.equal(reordered.campIds.get(first.world.camps[0].id), camp.id);
});

test('Frontier map projects faction villages and camp tiers without story sites or authoritative mutations', () => {
    const input = { village, camps: [camp], raids: [raid], now: date }, before = structuredClone(input);
    const { world, playerId } = projectFrontierWorld(input);
    assert.equal(world.settlements.length, 1);
    assert.equal(world.settlements[0].faction, village.faction);
    assert.equal(world.settlements[0].owner_id, playerId);
    assert.deepEqual({ x: world.settlements[0].x, y: world.settlements[0].y }, from);
    assert.equal(world.camps.length, 1);
    assert.equal(world.camps[0].bandit, true);
    assert.equal(world.camps[0].tier, 2);
    assert.equal(world.camps[0].faction, 'orc');
    assert.deepEqual([world.camps[0].infantry, world.camps[0].archers, world.camps[0].cavalry], [7, 7, 3]);
    assert.equal(world.battles.length, 0);
    assert.deepEqual(input, before);
});

test('real raid routes interpolate across seams and return only actual survivors without reversing server data', () => {
    const ids = new Map<string, number>();
    const outbound = projectFrontierWorld({ village, camps: [camp], raids: [raid], now: date, raidIds: ids }).world.armies[0];
    assert.deepEqual([outbound.infantry, outbound.archers, outbound.cavalry], [7, 1, 2]);
    const midpoint = armyPosition(outbound, date + 5_000);
    assert.deepEqual(midpoint, { x: -12800, y: from.y });
    const returningRaid = { ...raid, status: 'returning' as const }, before = structuredClone(returningRaid);
    const returning = projectFrontierWorld({ village, camps: [camp], raids: [returningRaid], now: date + 10_000, raidIds: ids }).world.armies[0];
    assert.equal(returning.id, outbound.id);
    assert.deepEqual([returning.infantry, returning.archers, returning.cavalry], [5, 1, 1]);
    assert.deepEqual(armyPosition(returning, date + 10_000), to);
    assert.deepEqual(armyPosition(returning, date + 20_000), from);
    assert.deepEqual(returningRaid, before);
    assert.equal(projectFrontierWorld({ village, camps: [camp], raids: [{ ...raid, status: 'complete' }] }).world.armies.length, 0);
    assert.equal(projectFrontierWorld({ village, camps: [camp], raids: [{ ...returningRaid, survivors: { infantry: 0, archers: 0, cavalry: 0 } }] }).world.armies.length, 0);
});
