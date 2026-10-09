import { commandCity } from '../../empire/domain/context';
import { heroBonuses } from '../../heroes/domain/heroes';
import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { affordable } from '../../city/domain/economy';
import { RESOURCES } from '../../../shared/model/resources';
import { spellById, researchCost, towerLevel, knowsSpell, maximumMana, SPELL_COOLDOWN } from './spells';
import type { Formation } from '../../battle/domain/types';
import { checkBattleOutcome } from '../../battle/domain/resolution';
import { clamp, dist } from '../../../shared/math/geometry';
export function researchSpell(context:LocalCommandContext,cmd:Extract<Command,{type:'researchSpell'}>) {
 const {world:w,playerId:owner}=context,town=commandCity(context);
 const spell=spellById(cmd.spell);if(!spell)throw new Error('Unknown spell.');
 if(context.active)throw new Error('Finish the current battle first.');
 if(towerLevel(w,town.id)<spell.level)throw new Error(`Upgrade the mage tower to level ${spell.level}.`);
 if(knowsSpell(w,town.id,spell.id))throw new Error('This spell is already researched.');
 const cost=researchCost(spell);if(!affordable(town,cost))throw new Error('Your stores cannot cover this research.');
 for(const key of RESOURCES)town[key]-=cost[key];
 w.spell_research??=[];w.spell_research.push({settlement_id:town.id,spell_id:spell.id,researched_at:context.now});
}
export function castSpell(context:LocalCommandContext,cmd:Extract<Command,{type:'castSpell'}>) {
 const {world:w,playerId:owner}=context,b=context.active;
 if(!b||b.id!==cmd.battleId||b.phase!=='combat'||b.status!=='active')throw new Error('Spells can only be cast during combat.');
 if(owner!==b.attacker_owner_id&&owner!==b.defender_owner_id)throw new Error('Not your battle.');
 const spell=spellById(cmd.spell),town=w.settlements.find(s=>s.owner_id===owner&&spell&&knowsSpell(w,s.id,spell.id)&&towerLevel(w,s.id)>=spell.level);
 const army=w.armies.find(a=>a.id===(b.attacker_owner_id===owner?b.attacker_army_id:b.defender_army_id))!,bonuses=army?heroBonuses(w,army):{mana:0,spell:1};
 if(!town||!spell||!knowsSpell(w,town.id,spell.id)||towerLevel(w,town.id)<spell.level)throw new Error('Research this spell in your mage tower first.');
 const side=owner===b.attacker_owner_id?'attacker':'defender',manaKey=side==='attacker'?'mana_attacker':'mana_defender',readyKey=side==='attacker'?'spell_ready_attacker':'spell_ready_defender';
 const mana=b[manaKey]??maximumMana(towerLevel(w,town.id))+bonuses.mana;
 if(b.elapsed<(b[readyKey]??0))throw new Error('Your mage is recovering.');
 if(mana<spell.mana)throw new Error('Not enough mana.');
 const friendly=spell.target==='ally'||spell.target==='allies';
 const candidates=w.formations.filter(f=>f.battle_id===b.id&&(friendly?f.side===side:f.side!==side)&&(spell.revive||f.soldiers>0&&f.status!=='routed'));
 const target=candidates.find(f=>f.id===cmd.target),single=spell.target==='ally'||spell.target==='enemy';
 if(single&&!target)throw new Error(friendly?'Choose a friendly formation.':'Choose an enemy formation.');
 let affected:Formation[]=single?[target!]:candidates;
 if(spell.radius)affected=candidates.filter(f=>dist(f,target!)<=spell.radius);
 if(spell.chain)affected=[target!,...candidates.filter(f=>f!==target).sort((a,c)=>dist(a,target!)-dist(c,target!)||a.id-c.id)].slice(0,spell.chain);
 if(!affected.length)throw new Error('No eligible formations.');
 b[manaKey]=mana-spell.mana;b[readyKey]=b.elapsed+SPELL_COOLDOWN;
 affected.forEach((f,index)=>{
  const damage=Math.ceil((spell.chain?Math.max(0,spell.damage-index*6):spell.damage)*bonuses.spell*(1-(f.magic_defence??0)));
  f.soldiers=Math.max(0,Math.min(f.initial_soldiers,f.soldiers-damage+Math.ceil(spell.heal*bonuses.spell)));
  f.morale=spell.revive?Math.max(f.morale,spell.morale):clamp(f.morale+spell.morale,0,100);
  f.stamina=clamp(f.stamina+spell.stamina,0,100);
  if(spell.attack)f.magic_attack=Math.min(1.5,(f.magic_attack??1)+spell.attack);
  if(spell.defence)f.magic_defence=Math.min(.4,(f.magic_defence??0)+spell.defence);
  if(spell.speed)f.magic_speed=Math.min(1.75,(f.magic_speed??1)+spell.speed);
  if(spell.revive&&f.soldiers>0){f.status='idle';f.target_formation_id=null;f.target_x=f.x;f.target_y=f.y;}
  if(f.soldiers<=0||f.morale<=18)f.status='routed';
 });
 b.last_spell={id:spell.id,name:spell.name,owner_id:owner,at:b.elapsed,target:target?.id??null};
 checkBattleOutcome(b,w.formations.filter(f=>f.battle_id===b.id));if((b.status as string)==='resolved')context.finalize(b.id);
}
