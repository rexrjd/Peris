import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findMarchPath } from '../src/features/map/domain/pathfinding.ts';
import { cellCenter } from '../src/features/map/domain/worldGrid.ts';
import { foundingReason } from '../src/features/empire/domain/expansion.ts';
const db = new PGlite(), u = '11111111-1111-4111-8111-111111111111', v = '22222222-2222-4222-8222-222222222222';
const admin = async sql => { await db.exec('reset role'); return db.exec(sql); };
const login = async (owner = u) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
const snapshot = () => rpc('peris_snapshot');
const command = value => rpc('peris_empire_command', [JSON.stringify(value)]);
const finishOrders = async () => {
    await admin(`update public.peris_orders set started_at=now()-interval '30 seconds',finish_at=now()-interval '1 second' where owner_id='${u}'`);
    await login(); await rpc('sync_my_state');
};
try {
    await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
    await db.exec(await readFile('supabase/FRESH_INSTALL_V10.sql', 'utf8'));
    await admin(`insert into auth.users values('${u}'),('${v}')`);
    await login(); await rpc('create_player', ['Ruler']); let w = await snapshot();
    const capital = w.settlements[0], firstArmy = w.armies[0], firstHero = w.heroes[0];
    assert.equal(w.heroes.length, 1); assert.equal(firstHero.army_id, firstArmy.id);
    await login(v); await rpc('create_player', ['Other']); const foreign = (await snapshot()).settlements[0];
    await login(); await assert.rejects(() => command({ type: 'rename', settlementId: foreign.id, name: 'Stolen' }), /cit/i);
    await assert.rejects(() => db.exec(`insert into public.peris_heroes(owner_id,army_id,name,class)values('${u}',${firstArmy.id},'Cheat','mage')`), /permission denied/);
    assert.equal((await db.query(`select count(*)::integer as n from public.peris_heroes where owner_id='${v}'`)).rows[0].n, 0);
    await admin(`update public.buildings set level=2 where settlement_id=${capital.id} and building_type='market';select public.peris_city_economy(${capital.id});update public.settlements set wood=5000,stone=5000,food=5000,gold=5000 where id=${capital.id};update public.players set culture_points=10000,culture_updated_at=now()-interval '1 minute' where id='${u}'`);
    await login(); await rpc('sync_my_state'); w = await snapshot(); assert.ok(w.players[0].culture_points > 10000);
    await command({ type: 'trainSettlers', settlementId: capital.id, quantity: 3 });
    assert.equal((await snapshot()).orders[0].settlement_id, capital.id);
    await assert.rejects(() => command({ type: 'trainSettlers', settlementId: capital.id, quantity: 1 }), /already training/);
    await finishOrders(); w = await snapshot(); assert.equal(w.settlements[0].settlers, 3);
    // Use the same terrain/pathfinder as the game, then let PostgreSQL verify every step.
    await admin('select 1');
    let target, route;
    for (let radius = 4; !target && radius < 25; radius++) for (let dx = -radius; !target && dx <= radius; dx++) for (let dy = -radius; !target && dy <= radius; dy++) {
        const col = Math.floor(capital.x / 128) + dx, row = Math.floor(capital.y / 128) + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius || foundingReason(w, u, col, row)) continue;
        const found = findMarchPath(capital, cellCenter(col, row));
        if (found && (await db.query('select public.peris_found_reason($1,$2) as reason', [col, row])).rows[0].reason === null) { target = { col, row }; route = found.path; }
    }
    assert.ok(target && route);
    await login();
    const culture = w.players[0].culture_points;
    await command({ type: 'foundCity', settlementId: capital.id, ...target, name: 'New dawn', route });
    w = await snapshot(); assert.equal(w.settlements.length, 1); assert.equal(w.settler_expeditions[0].status, 'travelling');
    assert.equal(w.settlements[0].settlers, 0); assert.ok(Math.abs(w.players[0].culture_points - culture + 300) < 1);
    await assert.rejects(() => command({ type: 'foundCity', settlementId: capital.id, ...target, name: 'Duplicate', route }), /reserved/);
    await admin(`update public.peris_settler_expeditions set departure_at=now()-interval '1 minute',arrival_at=now()-interval '1 second' where owner_id='${u}'`);
    await login(); await rpc('sync_my_state'); w = await snapshot();
    const colony = w.settlements.find(s => s.id !== capital.id);
    assert.ok(colony); assert.equal(colony.name, 'New dawn'); assert.equal(w.armies.length, 1);
    assert.equal(w.buildings.filter(b => b.settlement_id === colony.id && b.level === 0).length, 8);
    assert.equal(w.city_slots.filter(s => s.settlement_id === colony.id).length, 0);
    await command({ type: 'upgrade', settlementId: capital.id, item: 'lumber' });
    await command({ type: 'upgrade', settlementId: colony.id, item: 'lumber' });
    assert.equal((await snapshot()).orders.length, 2); await finishOrders();
    assert.equal((await snapshot()).buildings.filter(b => b.building_type === 'lumber' && b.level === 1).length, 2);
    console.log('PASS · culture, settlers, travel, reservations and independent city queues');

    await command({ type: 'recruitHero', settlementId: capital.id, name: 'Astra', heroClass: 'ranger' });
    w = await snapshot(); const second = w.armies.find(a => a.id !== firstArmy.id), hero = w.heroes.find(h => h.army_id === second.id);
    assert.equal(second.infantry + second.archers + second.cavalry, 0); assert.equal(hero.class, 'ranger');
    await admin(`insert into public.peris_city_slots values(${capital.id},0,'barracks',1);select public.peris_city_economy(${capital.id})`);
    await login(); await command({ type: 'recruit', settlementId: capital.id, armyId: firstArmy.id, item: 'infantry', quantity: 5 });
    const destination = cellCenter(Math.floor(capital.x / 128) + 1, Math.floor(capital.y / 128));
    const march = findMarchPath({ x: second.start_x, y: second.start_y }, destination);
    await command({ type: 'move', armyId: second.id, ...destination, route: march.path });
    await assert.rejects(() => command({ type: 'move', armyId: firstArmy.id, ...destination, route: march.path }), /training/);
    await finishOrders(); w = await snapshot(); assert.equal(w.armies.find(a => a.id === firstArmy.id).infantry, firstArmy.infantry + 5);
    await admin(`update public.armies set status='idle',start_x=${firstArmy.start_x},start_y=${firstArmy.start_y},target_x=${firstArmy.start_x},target_y=${firstArmy.start_y},march_path=null where id=${second.id}`);
    await login(); await command({ type: 'transferTroops', armyId: firstArmy.id, targetArmyId: second.id, infantry: 12, archers: 2, cavalry: 1 });
    w = await snapshot(); assert.equal(w.armies.find(a => a.id === second.id).infantry, 12);
    assert.equal(w.armies.reduce((sum, a) => sum + a.infantry, 0), firstArmy.infantry + 5);
    await assert.rejects(() => command({ type: 'transferTroops', armyId: firstArmy.id, targetArmyId: second.id, infantry: 999, archers: 0, cavalry: 0 }), /available/);
    await assert.rejects(() => command({ type: 'rebaseArmy', settlementId: colony.id, armyId: second.id }), /Bring/);
    await admin(`update public.armies set start_x=${colony.x+40},start_y=${colony.y+30},target_x=${colony.x+40},target_y=${colony.y+30} where id=${second.id}`);
    await login(); await command({ type: 'rebaseArmy', settlementId: colony.id, armyId: second.id });
    assert.equal((await snapshot()).armies.find(a => a.id === second.id).home_settlement_id, colony.id);
    console.log('PASS · hero hiring, independent recruitment/marches, troop conservation and home cities');

    await assert.rejects(() => command({ type: 'heroSkill', heroId: hero.id, stat: 'attack' }), /Win battles/);
    await admin(`update public.peris_heroes set experience=100 where id=${hero.id};insert into public.peris_hero_artifacts(owner_id,artifact_id,slot)values('${u}','iron_sword','weapon'),('${u}','warblade','weapon'),('${u}','boots','boots')`);
    await login(); await command({ type: 'heroSkill', heroId: hero.id, stat: 'attack' });
    await assert.rejects(() => command({ type: 'heroSkill', heroId: hero.id, stat: 'attack' }), /Win battles/);
    w = await snapshot(); const sword = w.hero_artifacts.find(a => a.artifact_id === 'iron_sword'), blade = w.hero_artifacts.find(a => a.artifact_id === 'warblade'), boots = w.hero_artifacts.find(a => a.artifact_id === 'boots');
    await command({ type: 'equipArtifact', heroId: hero.id, artifactId: sword.id, equip: true });
    await command({ type: 'equipArtifact', heroId: hero.id, artifactId: blade.id, equip: true });
    await command({ type: 'equipArtifact', heroId: hero.id, artifactId: boots.id, equip: true });
    assert.equal((await snapshot()).hero_artifacts.find(a => a.id === sword.id).hero_id, null);
    await assert.rejects(() => command({ type: 'equipArtifact', heroId: firstHero.id, artifactId: blade.id, equip: true }), /Unequip/);
    await admin('select 1'); const bonuses = (await db.query('select public.peris_hero_bonuses($1) as b', [second.id])).rows[0].b;
    assert.equal(Number(bonuses.attack), 7); assert.equal(Number(bonuses.speed), 1.25);
    await login(); await assert.rejects(() => rpc('peris_hero_reward', [second.id, 9999, 1]), /permission denied/);

    // Use selected army 2 to raid. Army 1 must keep its soldiers and captain XP.
    w = await snapshot(); const camp = w.camps[0], selected = w.armies.find(a => a.id === second.id), campRoute = findMarchPath({ x: selected.start_x, y: selected.start_y }, camp);
    await command({ type: 'raid', armyId: second.id, campId: camp.id, route: campRoute.path });
    await admin(`update public.armies set arrival_at=now()-interval '1 second' where id=${second.id}`); await login(); await rpc('sync_my_state');
    w = await snapshot(); const battle = w.battles.find(b => b.status === 'active'); assert.equal(battle.attacker_army_id, second.id);
    assert.ok(w.formations.filter(f => f.side === 'attacker').every(f => Number(f.attack_multiplier) > 1 && Number(f.defence_multiplier) > 1));
    const savedFirst = w.armies.find(a => a.id === firstArmy.id), goldBefore = w.settlements.find(s => s.id === colony.id).gold;
    await admin(`update public.battle_formations set soldiers=greatest(0,soldiers-2) where battle_id=${battle.id} and side='attacker' and unit_type='infantry';update public.battle_formations set soldiers=0 where battle_id=${battle.id} and side='defender';select public.peris_finish(${battle.id},'attacker','test')`);
    await login(); w = await snapshot();
    assert.equal(w.armies.find(a => a.id === firstArmy.id).infantry, savedFirst.infantry);
    assert.equal(w.heroes.find(h => h.id === firstHero.id).experience, 0); assert.ok(w.heroes.find(h => h.id === hero.id).experience > 100);
    assert.equal(w.armies.find(a => a.id === second.id).infantry, 10); assert.ok(w.settlements.find(s => s.id === colony.id).gold > goldBefore);
    const xp = w.heroes.find(h => h.id === hero.id).experience, items = w.hero_artifacts.length;
    await admin(`select public.peris_finish(${battle.id},'attacker','repeat')`); await login();
    assert.equal((await snapshot()).heroes.find(h => h.id === hero.id).experience, xp); assert.equal((await snapshot()).hero_artifacts.length, items);
    console.log('PASS · hero skill points, equipment ownership/slots, actual combat bonuses, selected-army casualties and idempotent loot/XP');

    // Mage knowledge/power apply to the selected battle, using research in any owned city.
    await admin(`update public.peris_heroes set class='mage' where id=${hero.id};insert into public.peris_city_slots values(${colony.id},0,'mage_tower',1);select public.peris_city_economy(${colony.id})`);
    await login(); await command({type:'researchSpell',settlementId:colony.id,spell:'spark'});
    w=await snapshot();const nextCamp=w.camps[1],mageArmy=w.armies.find(a=>a.id===second.id),mageRoute=findMarchPath({x:mageArmy.start_x,y:mageArmy.start_y},nextCamp);
    await command({type:'raid',armyId:second.id,campId:nextCamp.id,route:mageRoute.path});
    await admin(`update public.armies set arrival_at=now()-interval '1 second' where id=${second.id}`);await login();await rpc('sync_my_state');
    w=await snapshot();const magicBattle=w.battles.find(b=>b.status==='active');assert.equal(magicBattle.mana_attacker,50);
    await rpc('peris_ready',[magicBattle.id]);await admin(`update public.battles set last_tick_at=now()+interval '1 hour' where id=${magicBattle.id}`);await login();
    const enemy=(await snapshot()).formations.find(f=>f.side==='defender'),soldiers=enemy.soldiers;
    await assert.rejects(()=>rpc('peris_cast_spell',[magicBattle.id,'spark',enemy.id]),/automatically/);
    await admin(`select public.peris_cast_spell_for('${u}',${magicBattle.id},'spark',${enemy.id})`);await login();w=await snapshot();
    assert.equal(w.formations.find(f=>f.id===enemy.id).soldiers,soldiers-10);assert.equal(w.battles.find(b=>b.id===magicBattle.id).mana_attacker,45);
    await admin(`select public.peris_finish(${magicBattle.id},'draw','spell test complete')`);await login();
    // The invitation stores the initiating army; the defender chooses their own army.
    await command({type:'challenge',armyId:second.id,ownerId:v});const invitation=(await snapshot()).challenges[0];assert.equal(invitation.attacker_army_id,second.id);
    await login(v);const rivalArmy=(await snapshot()).armies[0];
    const accepted=await command({type:'respond',armyId:rivalArmy.id,id:invitation.id,accept:true});w=await snapshot();
    const duel=w.battles.find(b=>b.id===accepted.battle_id);assert.equal(duel.attacker_army_id,second.id);assert.equal(duel.defender_army_id,rivalArmy.id);
    await admin(`select public.peris_finish(${duel.id},'draw','duel test complete')`);await login();
    assert.equal((await snapshot()).armies.find(a=>a.id===firstArmy.id).infantry,savedFirst.infantry);
    console.log('PASS · mage mana/spell scaling and selected-army multiplayer invitations');

    // Rerun the migration with an expanded live empire and a pending queue.
    await command({ type: 'upgrade', settlementId: colony.id, item: 'market' });
    const before = await snapshot(), migration = await readFile('supabase/UPGRADE_TO_V10.sql', 'utf8');
    await admin(migration); await admin(migration); await login(); const after = await snapshot();
    assert.deepEqual(after.armies, before.armies); assert.deepEqual(after.heroes, before.heroes); assert.deepEqual(after.hero_artifacts, before.hero_artifacts); assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.settler_expeditions, before.settler_expeditions);
    assert.deepEqual(after.settlements.map(s => [s.id,s.name,s.wood,s.stone,s.food,s.gold]), before.settlements.map(s => [s.id,s.name,s.wood,s.stone,s.food,s.gold]));
    console.log('PASS · V10 migration reruns preserve multiple cities, armies, commanders, equipment and pending queues');
} catch (e) { console.error(e.message, e.where ?? '', e.stack); process.exitCode = 1; } finally { await db.close(); }
