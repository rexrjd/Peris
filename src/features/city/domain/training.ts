import type { World } from '../../../shared/model/world';
import { RECRUIT_RULES, type RecruitUnit } from '../../army/domain/roster';

export type CityTraining = { unit: RecruitUnit; quantity: number } | null;
/** Only this city's current barracks work animates the drill yard. */
export function activeCityTraining(world: World, sid: number, owner: string, now: number): CityTraining {
    const active = world.orders.filter(order => {
        if (order.kind !== 'recruit' || order.owner_id !== owner || !Object.hasOwn(RECRUIT_RULES, order.item)) return false;
        const city = order.settlement_id ?? world.armies.find(army => army.id === order.army_id && army.owner_id === owner)?.home_settlement_id ?? world.settlements.find(town => town.owner_id === owner)?.id;
        return city === sid && RECRUIT_RULES[order.item as RecruitUnit].building === 'barracks'
            && Date.parse(order.started_at) <= now && Date.parse(order.finish_at) > now;
    }).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id);
    const order = active[0]; return order ? { unit: order.item as RecruitUnit, quantity: order.quantity } : null;
}
