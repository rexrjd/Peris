import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFormations} from '../src/features/battle/domain/formations';
import {newBattle} from '../src/features/battle/domain/creation';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
import {unitStats} from '../src/features/army/domain/unitBalance';
import {RECRUIT_UNITS,emptyRoster,writeRoster} from '../src/features/army/domain/roster';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {beginRaid} from '../src/features/campaign/domain/raids';
import {applyResearchFormations} from '../src/features/research/domain/effects';
import {TECHNOLOGIES} from '../src/features/research/domain/catalog';

test('all 99 faction-role combinations use catalog stats, including basic-only armies',()=>{
    for(const faction of Object.keys(FACTIONS) as Faction[])for(const unit of RECRUIT_UNITS){
        const army={infantry:0,archers:0,cavalry:0};writeRoster(army,{...emptyRoster(),[unit]:12});
        const stats=unitStats(unit,{version:2,faction});
        const fs=makeFormations(1,army,null,'defender',90,undefined,{version:2,faction});
        assert.equal(fs.reduce((sum,f)=>sum+f.soldiers,0),12);
        assert.ok(fs.every(f=>(f.recruit_unit??f.unit_type)===unit&&f.unit_attack===stats.attackMultiplier&&f.unit_defence===stats.defenceMultiplier),`${faction}/${unit}`);
    }
});
test('new battles capture both doctrines before a home faction change and research is idempotent',()=>{
    const w=createSolo('Balance snapshots'),a=w.armies[0];w.settlements[0].faction='persian';
    const tech=TECHNOLOGIES.find(t=>!t.faction&&t.effects.archers_attack)!;
    w.research_progress=[{owner_id:a.owner_id,technology_id:tech.id,seconds:tech.seconds,completed_at:w.server_now}];
    beginRaid(w,a.owner_id,w.camps[0].id,()=>900,a.id);
    const b=w.battles[0],fs=w.formations.filter(f=>f.battle_id===b.id),before=structuredClone(fs);
    assert.equal(b.balance_version,2);assert.equal(b.attacker_faction,'persian');
    const archer=fs.find(f=>f.side==='attacker'&&f.unit_type==='archers')!;
    assert.ok(archer.unit_attack!>1.3);
    w.settlements[0].faction='dwarf';
    applyResearchFormations(w,a.owner_id,fs);applyResearchFormations(w,a.owner_id,fs);
    assert.deepEqual(fs,before);
    const old=newBattle(901,a.owner_id,a,{infantry:10,archers:10,cavalry:0},'plains','normal','Old','pve',null,{version:1,attackerFaction:'elf',defenderFaction:'orc'});
    assert.equal(old.formations.find(f=>f.unit_type==='archers')!.unit_attack,1);
});
