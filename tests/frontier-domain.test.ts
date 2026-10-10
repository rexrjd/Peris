import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, FULL_CAMP_COUNTS, carryingCapacity, emptyTroops, travelTimeMs, troopCost } from '../src/features/frontier/domain/balance';
import { createRealmCamps, recruitCamp, recruitDelay } from '../src/features/frontier/domain/camps';
import { resolveRaidCombat } from '../src/features/frontier/domain/combat';
import { accrue, takeLoot } from '../src/features/frontier/domain/economy';
import type { FrontierConfig, Position } from '../src/features/frontier/domain/types';
import { UNIT_TYPES } from '../src/features/army/domain/units';
import { CAMPS } from '../src/features/map/domain/camps';
import { BANDIT_CAMPS } from '../src/features/map/domain/bandits';
import { CELL_SIZE, wrapWorldCell, wrappedCellDistance } from '../src/features/map/domain/dimensions';
import { cellCenter, isHistoricStartingField, isWalkable } from '../src/features/map/domain/worldGrid';
import { findMarchPath } from '../src/features/map/domain/pathfinding';
import { RESOURCES, emptyResources, type Resources } from '../src/shared/model/resources';
import { seeded } from '../src/shared/math/random';

const sum = (value: Record<string, number>) => Object.values(value).reduce((total, n) => total + n, 0);
const key = (position: Position) => `${position.col},${position.row}`;

test('frontier uses existing recruitment prices and slowest-unit march speed', () => {
    const troops = { infantry: 3, archers: 2, cavalry: 1 };
    assert.deepEqual(troopCost(troops), { wood: 28, stone: 17, food: 40, gold: 11 });
    assert.equal(carryingCapacity(troops, DEFAULT_CONFIG), 130);
    assert.equal(travelTimeMs(220, { infantry: 1, archers: 0, cavalry: 0 }, DEFAULT_CONFIG), 10000);
    assert.equal(travelTimeMs(220, troops, DEFAULT_CONFIG), Math.ceil(10000 * 40 / 34));
    assert.ok(travelTimeMs(220, { infantry: 0, archers: 0, cavalry: 1 }, DEFAULT_CONFIG) < 10000);
    assert.equal(travelTimeMs(0, troops, DEFAULT_CONFIG), 2000);
    assert.deepEqual(emptyTroops(), { infantry: 0, archers: 0, cavalry: 0 });
});

test('camp storage is thirty minutes of income; idle production and capped overflow conserve resources', () => {
    for (const profile of Object.values(DEFAULT_CONFIG.tiers)) {
        const stock = { resources: emptyResources(), producedAt: 0 };
        for (const resource of RESOURCES) assert.equal(profile.capacity[resource], profile.rates[resource] * 30);
        const result = accrue(stock, profile.rates, profile.capacity, 60 * 60000);
        assert.deepEqual(stock.resources, profile.capacity);
        for (const resource of RESOURCES) {
            assert.equal(result.produced[resource], profile.rates[resource] * 60);
            assert.equal(stock.resources[resource] + result.overflow[resource], result.produced[resource]);
        }
        const unchanged = structuredClone(stock);
        accrue(stock, profile.rates, profile.capacity, 0);
        assert.deepEqual(stock, unchanged);
    }
});

test('loot divides integer resources proportionally without creating stock or exceeding carrying capacity', () => {
    assert.deepEqual(takeLoot({ wood: 90, stone: 60, food: 60, gold: 30 }, 120), { wood: 45, stone: 30, food: 30, gold: 15 });
    const random = seeded(1997);
    for (let iteration = 0; iteration < 1000; iteration++) {
        const supply = Object.fromEntries(RESOURCES.map(resource => [resource, random() * 2000])) as Resources;
        const before = { ...supply }, capacity = random() * 3000, loot = takeLoot(supply, capacity);
        assert.deepEqual(supply, before);
        assert.equal(sum(loot), Math.min(Math.floor(capacity), RESOURCES.reduce((total, resource) => total + Math.floor(supply[resource]), 0)));
        for (const resource of RESOURCES) {
            assert.ok(Number.isSafeInteger(loot[resource]));
            assert.ok(loot[resource] >= 0 && loot[resource] <= Math.floor(supply[resource]));
        }
    }
});

test('development camps are repeatable, empty initially, and reachable near the first village', () => {
    const realm = createRealmCamps(DEFAULT_CONFIG, 1000);
    assert.deepEqual(realm, createRealmCamps(DEFAULT_CONFIG, 1000));
    assert.equal(realm.camps.length, 14);
    assert.equal(realm.villageSites.length, 32);
    assert.notDeepEqual(realm.camps.map(key), createRealmCamps({ ...DEFAULT_CONFIG, seed: DEFAULT_CONFIG.seed + 1 }, 1000).camps.map(key));
    for (const camp of realm.camps) {
        assert.deepEqual(camp.resources, emptyResources());
        assert.deepEqual(camp.defenders, emptyTroops());
        assert.equal(camp.producedAt, 1000);
        assert.equal(camp.recruitSequence, 0);
        assert.ok(camp.nextRecruitAt! >= 61000 && camp.nextRecruitAt! <= 301000);
        assert.ok(findMarchPath(cellCenter(realm.villageSites[0].col, realm.villageSites[0].row), cellCenter(camp.col, camp.row)));
        for (const village of realm.villageSites.slice(0, 4)) assert.ok(wrappedCellDistance(village, camp) <= 12, 'The first development players can reach nearby camps');
    }
});

test('full realm provides all 4,000 camps without water, legacy land, or village reservation overlaps', () => {
    const config: FrontierConfig = { ...DEFAULT_CONFIG, fixture: 'full', campCounts: FULL_CAMP_COUNTS };
    const realm = createRealmCamps(config, 0), occupied = new Set<string>();
    const legacy = new Set([...CAMPS, ...BANDIT_CAMPS].map(camp => key(wrapWorldCell(Math.floor(camp.x / CELL_SIZE), Math.floor(camp.y / CELL_SIZE)))));
    const inspect = (position: Position) => {
        assert.ok(!occupied.has(key(position)), `Repeated field ${key(position)}`);
        assert.ok(!legacy.has(key(position)));
        assert.ok(!isHistoricStartingField(position.col, position.row));
        assert.ok(isWalkable(position.col, position.row));
        occupied.add(key(position));
    };
    assert.equal(realm.villageSites.length, 256);
    for (const village of realm.villageSites) for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) inspect(wrapWorldCell(village.col + col, village.row + row));
    assert.equal(realm.camps.length, 4000);
    assert.equal(new Set(realm.camps.map(camp => camp.id)).size, 4000);
    for (const [tier, count] of Object.entries(FULL_CAMP_COUNTS)) assert.equal(realm.camps.filter(camp => camp.tier === tier).length, count);
    realm.camps.forEach(inspect);
});

test('camp recruitment persists its sequence, ignores premature retries, and pauses exactly at the garrison cap', () => {
    const camps = createRealmCamps(DEFAULT_CONFIG, 0).camps;
    for (const tier of ['low', 'medium', 'hard'] as const) {
        const camp = structuredClone(camps.find(camp => camp.tier === tier)!), replay = structuredClone(camp), profile = DEFAULT_CONFIG.tiers[tier];
        const before = structuredClone(camp);
        assert.deepEqual(recruitCamp(camp, DEFAULT_CONFIG, camp.nextRecruitAt! - 1), emptyTroops());
        assert.deepEqual(camp, before);
        let events = 0;
        while (camp.nextRecruitAt !== null) {
            const due = camp.nextRecruitAt, oldCount = sum(camp.defenders), sequence = camp.recruitSequence;
            const added = recruitCamp(camp, DEFAULT_CONFIG, due);
            recruitCamp(replay, DEFAULT_CONFIG, due);
            assert.deepEqual(replay, camp);
            assert.equal(camp.recruitSequence, sequence + 1);
            assert.equal(sum(camp.defenders), oldCount + sum(added));
            assert.ok(sum(added) >= 1 && sum(added) <= profile.batchMax);
            if (camp.nextRecruitAt !== null) {
                assert.equal(camp.nextRecruitAt, due + recruitDelay(DEFAULT_CONFIG, camp.id, camp.recruitSequence));
                assert.ok(camp.nextRecruitAt - due >= 60000 && camp.nextRecruitAt - due <= 300000);
            }
            assert.ok(++events <= profile.defenderCap);
        }
        assert.equal(sum(camp.defenders), profile.defenderCap);
        const full = structuredClone(camp);
        recruitCamp(camp, DEFAULT_CONFIG, 100000000000);
        assert.deepEqual(camp, full);
    }
});

test('automatic camp combat is reproducible, conserves troops, and retains routed garrisons', () => {
    const troops = { infantry: 120, archers: 40, cavalry: 24 }, defenders = { infantry: 100, archers: 30, cavalry: 12 };
    const before = structuredClone({ troops, defenders });
    const result = resolveRaidCombat(troops, defenders, { col: 13, row: 53 }, 'medium');
    assert.deepEqual(result, resolveRaidCombat(troops, defenders, { col: 13, row: 53 }, 'medium'));
    assert.deepEqual({ troops, defenders }, before);
    assert.ok(result.battleSeconds >= 0 && result.battleSeconds <= 900);
    assert.ok(['attacker', 'defender', 'draw'].includes(result.winner));
    for (const unit of UNIT_TYPES) {
        assert.ok(Number.isInteger(result.survivors[unit]) && result.survivors[unit] >= 0 && result.survivors[unit] <= troops[unit]);
        assert.ok(Number.isInteger(result.defenders[unit]) && result.defenders[unit] >= 0 && result.defenders[unit] <= defenders[unit]);
    }
    assert.equal(result.reason, 'Army routed');
    assert.ok(sum(result.winner === 'attacker' ? result.defenders : result.survivors) > 0, 'Routed troops survive to regroup');
    const empty = resolveRaidCombat(troops, emptyTroops(), { col: 13, row: 53 }, 'low');
    assert.equal(empty.winner, 'attacker');
    assert.deepEqual(empty.survivors, troops);
    assert.deepEqual(empty.defenders, emptyTroops());
    assert.throws(() => resolveRaidCombat({ ...troops, infantry: -1 }, defenders, { col: 0, row: 0 }, 'low'), /whole numbers/);
});
