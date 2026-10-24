import { wrappedCellDistance,wrapWorldCell } from '../../map/domain/dimensions';
import { CAMPS } from '../../map/domain/camps';
import { BANDIT_CAMPS } from '../../map/domain/bandits';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import type { World } from '../../../shared/model/world';
import { citySlots } from '../../city/domain/slots';

/** Add new data without replacing existing cities, armies, orders, or saves. */
export function normalizeRealm(world: World, now = world.server_now, associateOrders = true) {
    // Only local campaigns pass through this normalizer. Existing formations and
    // receipts retain their old version; future local commands use the new rules.
    for(const battle of world.battles)battle.balance_version??=1;
    world.unit_balance_version=2;
    world.conquest_version=1;
    for(const city of world.settlements){city.loyalty??=100;city.loyalty_updated_at??=city.resources_updated_at;}
    if(world.version===6){
        if (world.camp_balance_version !== 1) {
            const definitions = new Map([...CAMPS, ...BANDIT_CAMPS].map(camp => [camp.id, camp]));
            let pending = false;
            for (const camp of world.camps) {
                const current = definitions.get(camp.id);
                if (!current || current.x !== camp.x || current.y !== camp.y || !!current.bandit !== !!camp.bandit) continue;
                if (world.battles.some(b => b.camp_id === camp.id && b.status === 'active') || world.armies.some(a => a.raid_target_id === camp.id && a.status === 'moving')) { pending = true; continue; }
                // Difficulty metadata can migrate; casualties, role inventories and
                // shared stock are live state and must never be refilled by loading.
                Object.assign(camp, { tier: current.tier, name: current.name, description: current.description });
            }
            if (!pending) world.camp_balance_version = 1;
        }
        const ids=new Set(world.camps.map(c=>c.id));
        for(const camp of BANDIT_CAMPS)if(!ids.has(camp.id)&&!world.settlements.some(s=>wrappedCellDistance(wrapWorldCell(Math.floor(s.x/128),Math.floor(s.y/128)),wrapWorldCell(Math.floor(camp.x/128),Math.floor(camp.y/128)))<=1)&&!world.map_plots?.some(p=>p.col===Math.floor(camp.x/128)&&p.row===Math.floor(camp.y/128)))world.camps.push({...camp});
        for(const camp of world.camps)camp.terrain=battleTerrainAtWorld(camp.x,camp.y);
    }
    world.heroes ??= []; world.hero_artifacts ??= []; world.settler_expeditions ??= []; world.ruin_evacuations ??= []; world.city_reinforcements ??= [];
    const migratedSlots = world.city_slots === undefined ? world.settlements.flatMap(s => citySlots(world, s.id)) : world.city_slots;
    world.city_slots = migratedSlots;
    for (const player of world.players) {
        player.culture_points ??= 0; player.culture_updated_at ??= now;
        const cities = world.settlements.filter(s => s.owner_id === player.id && !s.ruined_at);
        const armies = world.armies.filter(a => a.owner_id === player.id);
        for (const city of cities) { city.settlers ??= 0; city.development_points ??= cities.length===1 ? player.upgrades : world.buildings.filter(b=>b.settlement_id===city.id).reduce((n,b)=>n+b.level,0); }
        for (const army of armies) if (!world.heroes.some(h => h.army_id === army.id)) {
            const id = Math.max(0, ...world.heroes.map(h => h.id)) + 1;
            world.heroes.push({ id, owner_id: player.id, army_id: army.id, name: `${player.display_name} · Captain ${world.heroes.filter(h => h.owner_id === player.id).length + 1}`, class: 'knight', experience: 0, attack: 0, defence: 0, power: 0, knowledge: 0 });
        }
        for (const order of associateOrders ? world.orders.filter(o => o.owner_id === player.id) : []) {
            const [, col, row] = order.item.split(':');
            order.settlement_id ??= order.kind === 'field' ? world.map_plots?.find(p => p.col === Number(col) && p.row === Number(row))?.settlement_id ?? cities[0]?.id : cities[0]?.id;
            if (order.kind === 'recruit' && order.recruit_destination !== 'garrison') order.army_id ??= armies[0]?.id;
        }
    }
    world.gameplay_version = 1;
    return world;
}
