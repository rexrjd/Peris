import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { settleBattle } from '../src/features/campaign/domain/battleSettlement';
import { finishBattle } from '../src/features/battle/domain/resolution';
import { npcArtifactDrop } from '../src/features/heroes/domain/battleRewards';
import { ARTIFACT_RARITY } from '../src/features/heroes/domain/battleRewards';
import { heroPortraitUrl, PORTRAITS_PER_FACTION } from '../src/features/heroes/domain/portraits';
import { FACTIONS } from '../src/features/factions/domain/factions';
import { validateSave } from '../src/platform/storage/saves';

function fixture() {
    const world = createSolo('Loot QA'), camp = world.camps.find(c => c.bandit)!;
    let id = 20000;
    const nextId = () => ++id;
    const battle = (won = true) => {
        beginRaid(world, 'solo-ruler', camp.id, nextId);
        const b = world.battles.at(-1)!;
        world.formations.filter(f => f.battle_id === b.id && f.side === (won ? 'defender' : 'attacker')).forEach(f => { f.soldiers = 0; f.status = 'routed'; });
        finishBattle(b, world.formations.filter(f => f.battle_id === b.id), won ? 'attacker' : 'defender', 'Army routed');
        settleBattle(world, b.id, 'solo-ruler', nextId);
        return b;
    };
    return { world, camp, nextId, battle };
}

test('each faction ships twenty unique WebP portraits and hero identity survives class changes', () => {
    assert.equal(PORTRAITS_PER_FACTION, 20);
    for (const faction of Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]) {
        const urls = new Set<string>(), hashes = new Set<string>();
        for (let id = 0; id < 20; id++) {
            const url = heroPortraitUrl(faction, 'knight', id), file = `public/${url}`;
            assert.ok(existsSync(file)); urls.add(url);
            const bytes = readFileSync(file); assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
            hashes.add(createHash('sha256').update(bytes).digest('hex'));
            assert.equal(heroPortraitUrl(faction, 'mage', id), url);
        }
        assert.equal(urls.size, 20); assert.equal(hashes.size, 20);
    }
});
test('NPC loot is a real backpack item on first and repeated victories, settled only once', () => {
    const f = fixture(), first = f.battle(), reward = first.result!.hero_reward!;
    assert.equal(reward.artifacts.length, 1);
    assert.equal(reward.experience, first.result!.defender_losses * 2 + 50);
    const item = f.world.hero_artifacts!.find(i => i.id === reward.artifacts[0].id)!;
    assert.equal(item.artifact_id, npcArtifactDrop(f.camp.tier, f.camp.id, first.id));
    assert.equal(item.hero_id, null);
    const before = JSON.stringify(f.world.hero_artifacts), xp = f.world.heroes![0].experience;
    settleBattle(f.world, first.id, 'solo-ruler', f.nextId);
    assert.equal(JSON.stringify(f.world.hero_artifacts), before); assert.equal(f.world.heroes![0].experience, xp);
    const second = f.battle(); assert.equal(second.result!.hero_reward!.artifacts.length, 1);
    assert.equal(f.world.hero_artifacts!.length, 2); assert.notEqual(second.result!.hero_reward!.artifacts[0].id, item.id);
    const saved = validateSave(f.world); assert.deepEqual(saved.reports[0].result.hero_reward, second.result!.hero_reward);
});
test('defeats grant only earned XP while max-level and full-backpack receipts stay accurate', () => {
    const f = fixture(), loss = f.battle(false);
    assert.equal(loss.result!.hero_reward!.experience, 20); assert.deepEqual(loss.result!.hero_reward!.artifacts, []);
    f.world.armies[0].infantry = 20; f.world.heroes![0].experience = 19000;
    f.world.hero_artifacts = Array.from({length:200}, (_,i) => ({id:i+1,owner_id:'solo-ruler',hero_id:null,artifact_id:'iron_sword'}));
    const max = f.battle().result!.hero_reward!;
    assert.equal(max.experience, 0); assert.equal(max.level_after, 20); assert.equal(max.inventory_full, true);
    assert.deepEqual(max.artifacts, []); assert.equal(f.world.hero_artifacts.length, 200);
});
test('easy camps cannot roll rare or legendary gear and high tiers can roll the full rare pool', () => {
    for (let bid = 1; bid <= 200; bid++) for (const tier of [1,2]) assert.equal(ARTIFACT_RARITY[npcArtifactDrop(tier, 1047, bid) as keyof typeof ARTIFACT_RARITY], 'Common');
    assert.ok(Array.from({length:50}, (_,i) => npcArtifactDrop(5, 1010, i)).includes('crown_seal'));
});
test('save imports reject malformed reward receipts while keeping legacy reports readable', () => {
    const f=fixture();f.battle();
    const corrupt=JSON.parse(JSON.stringify(f.world));corrupt.reports[0].result.hero_reward.artifacts={};
    assert.throws(()=>validateSave(corrupt),/valid Peris campaign/);
    const badXp=JSON.parse(JSON.stringify(f.world));badXp.battles[0].result.hero_reward.experience=999999;
    assert.throws(()=>validateSave(badXp),/valid Peris campaign/);
    delete f.world.reports[0].result.hero_reward;delete f.world.battles[0].result!.hero_reward;
    assert.doesNotThrow(()=>validateSave(f.world));
});
