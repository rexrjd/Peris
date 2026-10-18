import type {World} from '../../../shared/model/world';
import type {Army} from './types';
import {readRoster,RECRUIT_UNITS} from './roster';
import {troopDetails} from './troopDetails';
/** Only aggregate a private, owned legion already present in this snapshot. */
export function armyStrength(world:World,army:Army,owner=world.settlements[0]?.owner_id){
    const owned=world.armies.find(a=>a.id===army.id&&a.owner_id===owner);
    if(!owned||army.owner_id!==owner)return null;
    const composition=readRoster(owned),city=world.settlements.find(s=>s.id===owned.home_settlement_id&&s.owner_id===owner);
    if(!city)return null;
    let attackPoints=0,protectionPoints=0,carryingCapacity=0;
    for(const unit of RECRUIT_UNITS){if(!composition[unit])continue;const stats=troopDetails(world,owned,city,unit,Date.parse(world.server_now));
        attackPoints+=composition[unit]*stats.attackPoints;protectionPoints+=composition[unit]*stats.protectionPoints;carryingCapacity+=composition[unit]*stats.carry;}
    return {attackPoints,protectionPoints,carryingCapacity,composition};
}
