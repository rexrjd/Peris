import type { World } from '../../../shared/model/world';
import type { Army, UnitType } from './types';
import type { Settlement } from '../../city/domain/types';
import { liveResources, affordable } from '../../city/domain/economy';
import { armyAttack, slotLevels } from '../../city/domain/slots';
import { armyPosition } from '../../map/domain/movement';
import { wrappedWorldDelta } from '../../map/domain/dimensions';
import { UNITS, UNIT_TYPES, soldierTotal } from './units';
import { multiply, RESOURCES } from '../../../shared/model/resources';
import { heroBonuses } from '../../heroes/domain/heroes';
import { recruitSeconds } from './recruitment';

export const ARMY_CAPACITY = 1000;
export const STAT_NAMES = { attack: 'Attack', defence: 'Defence', power: 'Spell power', knowledge: 'Knowledge' } as const;
export const SLOT_NAMES = { weapon: 'Weapon', armour: 'Armour', head: 'Head', boots: 'Boots', charm: 'Charm' } as const;
export const UNIT_ROLES = { infantry: { name: 'Infantry', icon: 'shield', role: 'Hold the line', detail: 'Brace against cavalry and protect your archers.' }, archers: { name: 'Archers', icon: 'bow', role: 'Covering fire', detail: 'Long-range volleys. Keep them behind your infantry.' }, cavalry: { name: 'Cavalry', icon: 'horse', role: 'Strike the flanks', detail: 'Fast charges into enemy flanks and exposed archers.' } } as const;
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const count = (value: number) => Math.floor(value).toLocaleString();
export function trainingOrders(world: World, army: Army) {
    return world.orders.filter(o => o.owner_id === army.owner_id && o.kind === 'recruit' && (o.army_id ?? world.armies[0]?.id) === army.id).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}
export function cityDistance(army: Army, city: Settlement, now: number, wrapped = false) {
    const pos = armyPosition(army, now), x = city.x + 40, y = city.y + 30;
    return Math.hypot(wrapped ? wrappedWorldDelta(pos.x, x) : x - pos.x, wrapped ? wrappedWorldDelta(pos.y, y) : y - pos.y);
}
/** Recruitment uses the same distance check as the local and SQL commands. */
export const atRecruitmentCity = (army: Army, city: Settlement, now: number) => army.status === 'idle' && cityDistance(army, city, now) <= 90;
export function armyOverview(world: World, army: Army, now: number) {
    const orders = trainingOrders(world, army), total = soldierTotal(army), queued = orders.reduce((n, o) => n + o.quantity, 0);
    const home = world.settlements.find(s => s.id === army.home_settlement_id);
    const local = world.settlements.find(s => s.owner_id === army.owner_id && atRecruitmentCity(army, s, now));
    const state = army.status === 'moving' ? 'Marching' : orders.length ? 'Training' : !total ? 'Empty army' : 'Ready';
    const bonuses = heroBonuses(world, army);
    const smithy = home ? armyAttack(world, home.id) : 1;
    return { orders, total, queued, free: Math.max(0, ARMY_CAPACITY - total - queued), home, local, state, bonuses, smithy, damage: bonuses.damage * smithy, arrival: Math.max(0, (Date.parse(army.arrival_at) - now) / 1000) };
}
export function recruitmentPlan(world: World, army: Army, city: Settlement, type: UnitType, quantity: number, now: number) {
    const orders = trainingOrders(world, army), queued = orders.reduce((n, o) => n + o.quantity, 0);
    const free = Math.max(0, ARMY_CAPACITY - soldierTotal(army) - queued), resources = liveResources(city, now), cost = multiply(UNITS[type].cost, quantity);
    const building = type === 'cavalry' ? 'stables' : 'barracks', level = slotLevels(world, city.id, building);
    const near = atRecruitmentCity(army, city, now);
    const max = Math.max(0, Math.min(200, free, ...RESOURCES.filter(k => UNITS[type].cost[k] > 0).map(k => Math.floor(resources[k] / UNITS[type].cost[k]))));
    const reason = city.owner_id !== army.owner_id ? 'Choose one of your cities.' : army.status === 'moving' ? 'Stop at a city before recruiting.' : !near ? `Bring this army to ${city.name}.` : !level ? `Build ${building} in ${city.name}.` : orders.length >= 3 ? 'All three training slots are occupied.' : free === 0 ? 'This army has no room for more soldiers.' : !Number.isInteger(quantity) || quantity < 1 || quantity > 200 ? 'Choose 1–200 soldiers.' : quantity > free ? `Only ${free} spaces remain, including queued troops.` : !affordable(resources, cost) ? `${city.name} needs more supplies for this batch.` : null;
    const seconds = recruitSeconds(type, quantity, Math.max(1, level)), start = Math.max(now, ...orders.map(o => Date.parse(o.finish_at)));
    return { orders, queued, free, resources, cost, building, level, near, max, reason, seconds, finishSeconds: (start - now) / 1000 + seconds };
}
export function transferReason(world: World, source: Army, target: Army | undefined, troops: Pick<Army, UnitType>, now: number) {
    if (!target || target.id === source.id || target.owner_id !== source.owner_id) return 'Choose another army from your roster.';
    if (source.status !== 'idle' || target.status !== 'idle') return 'Both armies must be stopped before transferring.';
    const a = armyPosition(source, now), b = armyPosition(target, now);
    if (Math.hypot(wrappedWorldDelta(a.x, b.x), wrappedWorldDelta(a.y, b.y)) > 90) return 'Bring these two armies together on the map.';
    if (trainingOrders(world, source).length || trainingOrders(world, target).length) return 'Finish both training queues before transferring.';
    if (UNIT_TYPES.some(type => !Number.isInteger(troops[type]) || troops[type] < 0 || troops[type] > source[type])) return 'Choose troops available in the source army.';
    const total = soldierTotal(troops);
    if (!total) return 'Choose how many soldiers to transfer.';
    if (soldierTotal(target) + total > ARMY_CAPACITY) return `The receiving army has room for ${ARMY_CAPACITY - soldierTotal(target)} soldiers.`;
    return null;
}
export function rebaseReason(world: World, army: Army, city: Settlement, now: number) {
    if (city.owner_id !== army.owner_id) return 'Choose one of your cities.';
    if (army.home_settlement_id === city.id) return 'This is already the army’s home city.';
    if (army.status !== 'idle' || cityDistance(army, city, now, true) > 90) return `Bring this army to ${city.name} first.`;
    if (trainingOrders(world, army).length) return 'Finish training before changing the home city.';
    return null;
}
