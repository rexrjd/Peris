import type { World } from '../../../shared/model/world';
import { citySlots } from '../../city/domain/slots';

/** Add new data without replacing existing cities, armies, orders, or saves. */
export function normalizeRealm(world: World, now = world.server_now, associateOrders = true) {
    world.heroes ??= []; world.hero_artifacts ??= []; world.settler_expeditions ??= [];
    const migratedSlots = world.city_slots === undefined ? world.settlements.flatMap(s => citySlots(world, s.id)) : world.city_slots;
    world.city_slots = migratedSlots;
    for (const player of world.players) {
        player.culture_points ??= 0; player.culture_updated_at ??= now;
        const cities = world.settlements.filter(s => s.owner_id === player.id);
        const armies = world.armies.filter(a => a.owner_id === player.id);
        for (const city of cities) { city.settlers ??= 0; city.development_points ??= cities.length===1 ? player.upgrades : world.buildings.filter(b=>b.settlement_id===city.id).reduce((n,b)=>n+b.level,0); }
        for (const army of armies) if (!world.heroes.some(h => h.army_id === army.id)) {
            const id = Math.max(0, ...world.heroes.map(h => h.id)) + 1;
            world.heroes.push({ id, owner_id: player.id, army_id: army.id, name: `${player.display_name} · Captain ${world.heroes.filter(h => h.owner_id === player.id).length + 1}`, class: 'knight', experience: 0, attack: 0, defence: 0, power: 0, knowledge: 0 });
        }
        for (const order of associateOrders ? world.orders.filter(o => o.owner_id === player.id) : []) {
            const [, col, row] = order.item.split(':');
            order.settlement_id ??= order.kind === 'field' ? world.map_plots?.find(p => p.col === Number(col) && p.row === Number(row))?.settlement_id ?? cities[0]?.id : cities[0]?.id;
            if (order.kind === 'recruit') order.army_id ??= armies[0]?.id;
        }
    }
    world.gameplay_version = 1;
    return world;
}
