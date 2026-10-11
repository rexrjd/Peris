import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ARTIFACTS, ARTIFACT_POOLS, campLootRarity } from '../src/features/heroes/domain/artifacts';
import { npcArtifactDrop } from '../src/features/heroes/domain/battleRewards';
import { BANDIT_CAMPS } from '../src/features/map/domain/bandits';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { normalizeRealm } from '../src/features/empire/domain/normalization';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { heroBonuses } from '../src/features/heroes/domain/heroes';
import { equipArtifact } from '../src/features/heroes/domain/commands';
import { validateSave } from '../src/platform/storage/saves';
import { emptyRoster, readRoster, writeRoster } from '../src/features/army/domain/roster';
import { accrueCamp, campRules } from '../src/features/campaign/domain/campStock';

test('all 605 camp IDs, locations and factions retain the shipped layout while difficulty spans ten levels', () => {
    const layout = JSON.stringify(BANDIT_CAMPS.map(({id,x,y,faction}) => ({id,x,y,faction})));
    assert.equal(createHash('sha256').update(layout).digest('hex'),'d1b4c29873c704c35968893fffe18dc9dbb63b49be4f251bd724bb92123a1bda');
    assert.equal(new Set(BANDIT_CAMPS.map(c => c.tier)).size,10);
    const count = (c: typeof BANDIT_CAMPS[number]) => c.infantry+c.archers+c.cavalry;
    for (let level=1;level<10;level++) assert.ok(Math.max(...BANDIT_CAMPS.filter(c=>c.tier===level).map(count)) < Math.min(...BANDIT_CAMPS.filter(c=>c.tier===level+1).map(count)));
    assert.ok(BANDIT_CAMPS.filter(c=>c.tier>=9).length<605*.1);
});
test('every equipment slot has higher-tier choices, all paintings have distinct paths, and drops match displayed loot', () => {
    assert.equal(Object.keys(ARTIFACTS).length,24);
    assert.equal(new Set(Object.values(ARTIFACTS).map(a=>a.image)).size,24);
    for (const pool of Object.values(ARTIFACT_POOLS)) for (const slot of ['weapon','armour','head','boots','charm']) assert.ok(pool.some(id=>ARTIFACTS[id].slot===slot));
    for (let level=1;level<=10;level++) for(let battle=1;battle<=100;battle++) assert.equal(ARTIFACTS[npcArtifactDrop(level,1001,battle)].rarity,campLootRarity(level));
});
test('legacy camp upgrade keeps progress, equipped items and farm targets, and waits for active raids', () => {
    const world=createSolo('Migration QA'), camp=world.camps.find(c=>c.bandit && c.tier>=9)!;
    delete camp.unit_roster; delete camp.resources; delete camp.stock_updated_at; delete camp.next_recruit_at; delete camp.recruit_sequence;
    camp.tier=1;camp.infantry=7;camp.archers=2;camp.cavalry=0;
    delete world.camp_balance_version;
    world.progress=[{owner_id:'solo-ruler',camp_id:camp.id,defeated:2,available_at:world.server_now}];
    world.hero_artifacts=[{id:99001,owner_id:'solo-ruler',artifact_id:'iron_sword',hero_id:world.heroes![0].id}];
    const {infantry,archers,cavalry}=world.armies[0],troops={infantry,archers,cavalry};
    world.campaign_farm_lists=[{id:70001,owner_id:'solo-ruler',name:'Saved farm',troops,casualties_only:false}];
    world.campaign_farms=[{id:70002,owner_id:'solo-ruler',list_id:70001,camp_id:camp.id,army_id:world.armies[0].id,troops,created_at:world.server_now}];
    const progress=structuredClone(world.progress),items=structuredClone(world.hero_artifacts),farms=structuredClone(world.campaign_farms),lists=structuredClone(world.campaign_farm_lists);
    let id=80000;beginRaid(world,'solo-ruler',camp.id,()=>++id);
    normalizeRealm(world);assert.equal(camp.infantry,7);assert.equal(camp.tier,1);assert.equal(world.camp_balance_version,undefined);
    world.battles[0].status='finished';world.armies[0].raid_target_id=null;
    normalizeRealm(world);assert.ok(camp.tier>=9);assert.equal(world.camp_balance_version,1);
    assert.deepEqual([camp.infantry,camp.archers,camp.cavalry],[7,2,0]);
    normalizeRealm(world);assert.deepEqual(world.progress,progress);assert.deepEqual(world.hero_artifacts,items);
    assert.deepEqual(world.campaign_farms,farms);assert.deepEqual(world.campaign_farm_lists,lists);
});

test('camp balance migration preserves live casualties, advanced roles, stock and research through save reload', () => {
    const world=createSolo('Stock migration QA'), camp=world.camps.find(c=>c.bandit && c.tier===10)!;
    const force={...emptyRoster(),infantry:7,scout:2,elite:3};writeRoster(camp,force);
    camp.resources={wood:12,stone:8,food:3,gold:1};
    camp.stock_updated_at=new Date(Date.parse(world.server_now)+60000).toISOString();
    camp.next_recruit_at=new Date(Date.parse(world.server_now)+3600000).toISOString();camp.recruit_sequence=19;
    camp.tier=1;delete world.camp_balance_version;
    const stock=structuredClone(camp.resources), clocks=[camp.stock_updated_at,camp.next_recruit_at,camp.recruit_sequence];
    world.unit_research=[{settlement_id:world.settlements[0].id,unit:'scout',completes_at:world.server_now}];
    normalizeRealm(world);assert.equal(camp.tier,10);assert.deepEqual(readRoster(camp),force);
    assert.deepEqual(camp.resources,stock);assert.deepEqual([camp.stock_updated_at,camp.next_recruit_at,camp.recruit_sequence],clocks);
    const saved=validateSave(structuredClone(world)), restored=saved.camps.find(c=>c.id===camp.id)!;
    assert.deepEqual(readRoster(restored),force);assert.deepEqual(restored.resources,stock);assert.deepEqual(saved.unit_research,world.unit_research);
});

test('ten-level camps replenish within level capacity and use matching low, medium and hard production', () => {
    const world=createSolo('Camp growth QA'),at=Date.parse(world.server_now);
    for(let level=1;level<=10;level++) {
        const camp=structuredClone(world.camps.find(c=>c.bandit && c.tier===level)!);
        const rule=campRules(camp);assert.ok(rule.defenderCap>=readRoster(camp).infantry+readRoster(camp).archers+readRoster(camp).cavalry);
        writeRoster(camp,emptyRoster());accrueCamp(camp,at);accrueCamp(camp,at+86400000);
        assert.equal(camp.infantry+camp.archers+camp.cavalry,rule.defenderCap);
        assert.equal(rule.rates.wood,level<=2?3:level<=5?9:24);
        assert.deepEqual(camp.resources,rule.capacity);
    }
});
test('new legendary equipment equips through real commands, improves troops and survives save reload', () => {
    const world=createSolo('Legendary QA'),hero=world.heroes![0],army=world.armies[0],before=heroBonuses(world,army);
    world.hero_artifacts=[{id:88001,owner_id:'solo-ruler',artifact_id:'lionheart_blade',hero_id:null}];
    equipArtifact({world,playerId:'solo-ruler',now:world.server_now,nextId:()=>999,paused:()=>{},finalize:()=>{}},hero.id,88001,true);
    const after=heroBonuses(world,army);assert.equal(after.attack-before.attack,8);assert.equal(after.defence-before.defence,2);assert.ok(after.damage>before.damage);
    const restored=validateSave(structuredClone(world));assert.equal(restored.hero_artifacts![0].artifact_id,'lionheart_blade');assert.equal(restored.hero_artifacts![0].hero_id,hero.id);
});
