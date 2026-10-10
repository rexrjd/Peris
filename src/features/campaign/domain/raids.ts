import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { ownedArmy } from '../../empire/domain/context';
import { heroBonuses } from '../../heroes/domain/heroes';
import { maximumMana, towerLevel } from '../../magic/domain/spells';
import { type World } from '../../../shared/model/world';
import { newBattle } from '../../battle/domain/creation';
import { armyAttack } from '../../city/domain/slots';
export function beginRaid(world: World, owner: string, campId: number, nextId: () => number, armyId?: number) {
    const camp = world.camps.find(c => c.id === campId)!, a = ownedArmy(world, owner, armyId);
    const instance = newBattle(nextId(), owner, a, camp, battleTerrainAtWorld(camp.x,camp.y), camp.tier >= 4 ? 'hard' : camp.tier === 1 ? 'easy' : 'normal', camp.name, 'pve', camp.id);
    instance.battle.defender_faction=camp.faction;
    const wall = world.buildings.find(b => b.settlement_id === a.home_settlement_id && b.building_type === 'wall')?.level ?? 1;
    instance.formations.filter(f => f.owner_id === owner).forEach(f => f.morale = Math.min(100, 90 + wall * 2));
    instance.formations.filter(f => f.owner_id === owner).forEach(f => f.attack_multiplier=armyAttack(world,a.home_settlement_id));
    const bonuses=heroBonuses(world,a);
    instance.formations.filter(f=>f.owner_id===owner).forEach(f=>{f.attack_multiplier=(f.attack_multiplier??1)*bonuses.damage;f.defence_multiplier=bonuses.protection;f.morale=Math.min(100,f.morale+bonuses.morale);});
    const tower=Math.max(0,...world.settlements.filter(s=>s.owner_id===owner).map(s=>towerLevel(world,s.id)));
    instance.battle.mana_attacker=maximumMana(tower)+bonuses.mana;
    world.battles.push(instance.battle);
    world.formations.push(...instance.formations);
}
