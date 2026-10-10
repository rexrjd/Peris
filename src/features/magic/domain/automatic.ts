import type { World } from '../../../shared/model/world';
import type { Battle, Formation } from '../../battle/domain/types';
import { dist } from '../../../shared/math/geometry';
import { heroBonuses } from '../../heroes/domain/heroes';
import { SPELLS, knowsSpell, towerLevel, type Spell } from './spells';
import { castSpell } from './commands';

/** Evaluate useful effects, not a fixed sequence that wastes mana healing full
 * formations or repeatedly applying an already capped buff. */
export function chooseAutomaticSpell(b:Battle,fs:Formation[],side:Formation['side'],spells:readonly Spell[],mana:number,power=1){
    const live=fs.filter(f=>f.soldiers>0&&f.status!=='routed'),own=fs.filter(f=>f.side===side),enemies=live.filter(f=>f.side!==side);
    let best:{spell:Spell;target:number;score:number}|undefined;
    if(!enemies.length)return;
    for(const spell of [...spells].sort((a,c)=>a.level-c.level||a.id.localeCompare(c.id))){
        if(spell.mana>mana)continue;
        const friendly=spell.target==='ally'||spell.target==='allies';
        const candidates=(friendly?own:enemies).filter(f=>spell.revive||f.soldiers>0&&f.status!=='routed');
        for(const target of candidates){
            const all=spell.target==='allies'||spell.target==='enemies';
            let affected=all?candidates:[target];
            if(spell.radius)affected=candidates.filter(f=>dist(f,target)<=spell.radius);
            if(spell.chain)affected=[target,...candidates.filter(f=>f!==target).sort((a,c)=>dist(a,target)-dist(c,target)||a.id-c.id)].slice(0,spell.chain);
            let value=0;
            affected.forEach((f,i)=>{
                if(friendly){
                    const missing=f.initial_soldiers-f.soldiers,threat=enemies.some(e=>dist(e,f)<260);
                    if(missing>=Math.min(spell.heal*power*.5,Math.max(1,f.initial_soldiers*.15)))value+=Math.min(missing,Math.ceil(spell.heal*power))*(f.status==='routed'&&spell.revive?1.5:1.1);
                    if(f.soldiers>0){
                        value+=spell.morale>0?Math.min(spell.morale,Math.max(0,70-f.morale))*.3:0;
                        if(threat)value+=f.soldiers*(Math.min(spell.attack,1.5-(f.magic_attack??1))*.3+Math.min(spell.defence,.4-(f.magic_defence??0))*.4);
                        if(f.status==='moving')value+=f.soldiers*Math.min(spell.speed,1.75-(f.magic_speed??1))*.12;
                    }
                }else if(live.some(a=>a.side===side&&dist(a,f)<300)){
                    value+=Math.min(f.soldiers,Math.ceil(Math.max(0,spell.damage-i*6*(spell.chain?1:0))*power*(1-(f.magic_defence??0))));
                    value+=spell.morale<0?Math.min(-spell.morale,f.morale)*.15:0;
                }
            });
            const score=value/Math.sqrt(spell.mana);
            if(value>=3&&(!best||score>best.score))best={spell,target:target.id,score};
            if(all)break;
        }
    }
    return best;
}
export function autoCastSpells(world:World,b:Battle,nextId:()=>number,finalize:(id:number)=>void){
    if(b.status!=='active'||b.phase!=='combat'||b.elapsed<1)return;
    for(const side of ['attacker','defender'] as const){
        if(b.status!=='active')break;
        const owner=side==='attacker'?b.attacker_owner_id:b.defender_owner_id;
        if(!owner||b.elapsed<(side==='attacker'?b.spell_ready_attacker:b.spell_ready_defender)!)continue;
        const army=world.armies.find(a=>a.id===(side==='attacker'?b.attacker_army_id:b.defender_army_id));
        if(!army)continue;
        const available=SPELLS.filter(spell=>world.settlements.some(city=>city.owner_id===owner&&towerLevel(world,city.id)>=spell.level&&knowsSpell(world,city.id,spell.id)));
        const choice=chooseAutomaticSpell(b,world.formations.filter(f=>f.battle_id===b.id),side,available,(side==='attacker'?b.mana_attacker:b.mana_defender)??0,heroBonuses(world,army).spell);
        if(choice)castSpell({world,playerId:owner,active:b,now:new Date().toISOString(),nextId,finalize,paused:()=>{}},{type:'castSpell',battleId:b.id,spell:choice.spell.id,target:choice.target});
    }
}
