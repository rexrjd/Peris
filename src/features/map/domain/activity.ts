import type { World, Order } from '../../../shared/model/world';
import type { MapSelection } from './types';
import { armyPosition } from './movement';
import { CELL_SIZE, wrapWorldCell } from './dimensions';
import { cellCenter } from './worldGrid';
import { soldierTotal } from '../../army/domain/units';
import { BUILDINGS } from '../../city/domain/buildings';
import { SLOT_BUILDINGS } from '../../city/domain/slots';
import { FIELD_BUILDINGS } from './territory';
import {RESOURCES} from '../../../shared/model/resources';
import { RECRUIT_RULES, RECRUIT_UNITS, rosterTotal, type RecruitUnit } from '../../army/domain/roster';

export type ActivityKind = 'scouting' | 'raid' | 'return' | 'march' | 'battle' | 'construction' | 'recruitment' | 'research' | 'settlers' | 'reinforcement' | 'trade';
const unitNames: Record<RecruitUnit, string> = { infantry: 'infantry', spearmen: 'spearmen', archers: 'archers', elite: 'elite soldiers', cavalry: 'cavalry', scout: 'scouts', heavyCavalry: 'heavy cavalry', ram: 'rams', catapult: 'catapults',diplomat:'diplomats' };
const unitName = (unit: string) => RECRUIT_UNITS.includes(unit as RecruitUnit) ? unitNames[unit as RecruitUnit] : 'soldiers';
export type MapActivity = {
    id: string; kind: ActivityKind; category: 'armies' | 'cities'; title: string; detail: string;
    destination?: string; troops?: number; armyId?: number; cityId?: number; sourceCityId?: number; shipmentId?: number;
    startedAt: number | null; endsAt: number | null; live?: boolean;
    selection: Exclude<MapSelection, null>; point: { x: number; y: number };
    cancel?: { armyId: number; sentAt: string; until: number };
    scoutingMissionId?: number; scoutCancel?: {missionId:number;sentAt:string;until:number};
    guildReinforcementId?: number; supportStatus?: 'outbound'|'stationed'|'returning';
};
const timestamp = (value?: string | null) => {
    const n = value ? Date.parse(value) : NaN;
    return Number.isFinite(n) ? n : null;
};
export const activityField = (point: { x: number; y: number }) => wrapWorldCell(Math.floor(point.x / CELL_SIZE), Math.floor(point.y / CELL_SIZE));
const fieldLabel = (point: { x: number; y: number }) => {
    const cell = activityField(point); return 'Field (' + cell.col + ' | ' + cell.row + ')';
};
function placeName(world: World, point: { x: number; y: number }) {
    const cell = activityField(point);
    return world.settlements.find(s => {
        const other = activityField(s); return cell.col === other.col && cell.row === other.row;
    })?.name ?? fieldLabel(point);
}
function constructionTitle(world: World, order: Order, cityId: number) {
    if (order.item.startsWith('slot:')) {
        const [, index, type] = order.item.split(':');
        const slot = world.city_slots?.find(s => s.settlement_id === cityId && s.slot_index === Number(index));
        const name = SLOT_BUILDINGS[(slot?.building_type ?? type) as keyof typeof SLOT_BUILDINGS]?.name ?? 'Building';
        return name + ' · Lv. ' + ((slot?.level ?? 0) + 1);
    }
    const building = world.buildings.find(b => b.settlement_id === cityId && b.building_type === order.item);
    return (BUILDINGS[order.item as keyof typeof BUILDINGS]?.name ?? 'Building') + ' · Lv. ' + ((building?.level ?? 0) + 1);
}

/** Read-only presentation of authoritative queues, including all owned cities/armies.
 * A passed deadline remains visible until the engine/server settles that event. */
export function mapActivity(world: World, owner: string, now: number): MapActivity[] {
    const events: MapActivity[] = [], fighting = new Set<number>();
    const cities = world.settlements.filter(s => s.owner_id === owner);
    for(const mission of world.scouting_missions??[]){
        if(mission.owner_id!==owner||!['outbound','returning'].includes(mission.status))continue;
        const returning=mission.status==='returning',last=mission.march_path.at(-1),point=last?{x:last[0],y:last[1]}:{x:mission.target_x,y:mission.target_y};
        const targetCity=returning?cities.find(city=>activityField(city).col===activityField(point).col&&activityField(city).row===activityField(point).row):world.settlements.find(city=>city.id===mission.target_city_id);
        const until=timestamp(mission.cancel_until),sent=timestamp(mission.sent_at),departure=timestamp(mission.departure_at);
        const cancellable=!returning&&until!==null&&sent!==null&&departure!==null&&now>=sent&&now<Math.min(until,sent+30000*(world.game_clock?.rate??1),departure);
        events.push({id:'scouting:'+mission.id,kind:'scouting',category:'armies',title:mission.scouts.toLocaleString()+' scouts',detail:returning?'Scouts returning':cancellable?'Preparing scouting departure':'Scouting mission',
            destination:returning?placeName(world,point):mission.target_name,troops:mission.scouts,cityId:mission.source_settlement_id,sourceCityId:mission.source_settlement_id,scoutingMissionId:mission.id,
            startedAt:departure,endsAt:timestamp(mission.arrival_at),point,selection:targetCity?{kind:'settlement',id:targetCity.id}:!returning&&mission.target_camp_id!==null?{kind:'camp',id:mission.target_camp_id}:{kind:'cell',...activityField(point)},
            ...(cancellable?{scoutCancel:{missionId:mission.id,sentAt:mission.sent_at,until:Math.min(until!,sent!+30000*(world.game_clock?.rate??1),departure!)}}:{})});
    }
    for(const c of world.trade_caravans??[]){
        const sent=c.owner_id===owner,received=c.recipient_id===owner;
        if(c.status==='completed'||!sent&&!received||!sent&&c.status!=='outbound')continue;
        const returning=c.status!=='outbound',cityId=returning?(c.return_settlement_id??c.source_settlement_id):c.target_settlement_id;
        const p=world.settlements.find(s=>s.id===cityId),fallback=c.march_path[returning?0:c.march_path.length-1];
        const point=p?{x:p.x,y:p.y}:{x:fallback[0],y:fallback[1]};
        const cargo=RESOURCES.filter(k=>c.resources[k]>0).map(k=>`${c.resources[k].toLocaleString()} ${k}`).join(', ');
        const title=c.status==='waiting'?'Waiting to unload':c.status==='stranded'?'Caravan stranded':returning?'Merchants returning':sent?'Resources outbound':'Resources incoming';
        events.push({id:`trade:${c.id}`,kind:'trade',category:'cities',title,detail:`${cargo} · ${returning?c.target_city:c.source_city}`,destination:returning?c.source_city:c.target_city,cityId,sourceCityId:sent?c.source_settlement_id:undefined,startedAt:timestamp(returning?c.arrival_at:c.departure_at),endsAt:['waiting','stranded'].includes(c.status)?null:timestamp(returning?c.return_at:c.arrival_at),point,selection:p?{kind:'settlement',id:p.id}:{kind:'cell',...activityField(point)}});
    }
    const armies = world.armies.filter(a => a.owner_id === owner);
    for (const battle of world.battles) {
        if (battle.status !== 'active' || (battle.attacker_owner_id !== owner && battle.defender_owner_id !== owner)) continue;
        const armyId = battle.attacker_owner_id === owner ? battle.attacker_army_id : battle.defender_army_id;
        const army = armies.find(a => a.id === armyId);
        if (!army) continue;
        fighting.add(army.id);
        const camp = world.camps.find(c => c.id === battle.camp_id);
        const formations = world.formations.filter(f => f.battle_id === battle.id && f.owner_id === owner);
        events.push({ id: 'battle:' + battle.id, kind: 'battle', category: 'armies', title: army.name,
            detail: battle.raid_city_id?'City raid':battle.mode === 'pvp' ? 'Live duel' : 'Automatic battle', destination: camp?.name ?? battle.enemy_name,
            troops: formations.length ? formations.reduce((n, f) => n + f.soldiers, 0) : soldierTotal(army),
            armyId: army.id, cityId: army.home_settlement_id, startedAt: timestamp(battle.started_at), endsAt: null, live: true,
            selection: { kind: 'army', id: army.id }, point: camp ?? armyPosition(army, now) });
    }
    for (const army of armies) {
        if (army.status !== 'moving' || fighting.has(army.id)) continue;
        const destination = { x: army.target_x, y: army.target_y };
        const returning = !!army.march_returning;
        const camp = world.camps.find(c => c.id === army.raid_target_id);
        const until = timestamp(army.march_cancel_until);
        const staged = !returning && !!army.march_sent_at && until !== null && now < until;
        events.push({ id: 'army:' + army.id, kind: returning ? 'return' : army.raid_target_id != null||army.raid_city_id!=null ? 'raid' : 'march',
            category: 'armies', title: army.name, detail: staged ? 'Preparing departure' : soldierTotal(army).toLocaleString('en-US') + ' soldiers',
            destination: returning ? placeName(world, destination) : camp?.name ?? placeName(world, destination),
            troops: soldierTotal(army), armyId: army.id, cityId: army.home_settlement_id,
            startedAt: timestamp(army.departure_at), endsAt: timestamp(army.arrival_at),
            selection: { kind: 'army', id: army.id }, point: armyPosition(army, now),
            ...(staged ? { cancel: { armyId: army.id, sentAt: army.march_sent_at!, until: until! } } : {}) });
    }
    for (const shipment of world.city_reinforcements ?? []) {
        if (shipment.owner_id !== owner) continue;
        const origin = cities.find(s => s.id === shipment.source_settlement_id);
        const target = cities.find(s => s.id === shipment.target_settlement_id);
        if (!origin || !target) continue;
        const total = rosterTotal(shipment.troops);
        events.push({ id: 'reinforcement:' + shipment.id, kind: 'reinforcement', category: 'armies',
            title: total.toLocaleString() + ' reinforcements', detail: origin.name,
            destination: target.name, troops: total, cityId: target.id, sourceCityId: origin.id, shipmentId: shipment.id,
            startedAt: timestamp(shipment.departure_at), endsAt: timestamp(shipment.arrival_at),
            selection: { kind: 'settlement', id: target.id }, point: { x: target.x, y: target.y } });
    }
    for (const support of world.guild_reinforcements ?? []) {
        if(support.owner_id!==owner&&support.recipient_id!==owner)continue;
        const returning=support.status==='returning';
        const cityId=support.owner_id===owner?(returning?support.target_settlement_id:support.source_settlement_id):(support.recipient_city_id??(!returning?support.target_settlement_id:undefined));
        const destination=world.settlements.find(s=>s.id===support.target_settlement_id);
        const total=rosterTotal(support.troops);
        events.push({id:'guild-reinforcement:'+support.id,kind:'reinforcement',category:'armies',
            title:total.toLocaleString()+' guild reinforcements',detail:returning?support.recipient_city??'Guild support':support.source_city,
            destination:support.target_city,troops:total,cityId,sourceCityId:support.owner_id===owner?support.source_settlement_id:undefined,
            guildReinforcementId:support.id,supportStatus:support.status,
            startedAt:timestamp(support.departure_at),endsAt:timestamp(support.arrival_at),
            selection:destination?{kind:'settlement',id:destination.id}:{kind:'cell',...activityField({x:support.target_x,y:support.target_y})},point:{x:support.target_x,y:support.target_y}});
    }
    for (const order of world.orders) {
        if (order.owner_id !== owner) continue;
        const city = cities.find(s => s.id === (order.settlement_id ?? cities[0]?.id));
        if (!city) continue;
        const base = { id: 'order:' + order.id, cityId: city.id, startedAt: timestamp(order.started_at), endsAt: timestamp(order.finish_at), point: { x: city.x, y: city.y } };
        if (order.kind === 'recruit') {
            const army = order.recruit_destination === 'garrison' ? undefined : armies.find(a => a.id === (order.army_id ?? armies[0]?.id));
            const unit = unitName(order.item);
            events.push({ ...base, kind: 'recruitment', category: 'cities', title: order.quantity + ' ' + unit, detail: city.name,
                destination: order.recruit_destination === 'garrison' ? 'Garrison' : army?.name, armyId: army?.id, selection: { kind: 'settlement', id: city.id } });
        } else if (order.kind === 'settler') {
            events.push({ ...base, kind: 'settlers', category: 'cities', title: order.quantity + (order.quantity === 1 ? ' settler' : ' settlers'),
                detail: city.name, selection: { kind: 'settlement', id: city.id } });
        } else if (order.kind === 'field') {
            const [, colText, rowText, type] = order.item.split(':');
            const col = Number(colText), row = Number(rowText);
            if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) continue;
            const cell = wrapWorldCell(col, row), plot = world.map_plots?.find(p => p.owner_id === owner && p.col === cell.col && p.row === cell.row);
            const name = FIELD_BUILDINGS[type as keyof typeof FIELD_BUILDINGS]?.name ?? 'Field building';
            events.push({ ...base, kind: 'construction', category: 'cities', title: name + ' · Lv. ' + ((plot?.level ?? 0) + 1), detail: city.name,
                destination: fieldLabel(cellCenter(cell.col, cell.row)), selection: { kind: 'cell', ...cell }, point: cellCenter(cell.col, cell.row) });
        } else {
            events.push({ ...base, kind: 'construction', category: 'cities', title: constructionTitle(world, order, city.id), detail: city.name,
                selection: { kind: 'settlement', id: city.id } });
        }
    }
    for (const research of world.unit_research ?? []) {
        const city = cities.find(s => s.id === research.settlement_id), endsAt = timestamp(research.completes_at);
        if (!city || endsAt === null || endsAt <= now || !RECRUIT_UNITS.includes(research.unit)) continue;
        events.push({ id: 'research:' + city.id + ':' + research.unit, kind: 'research', category: 'cities',
            title: 'Research ' + unitName(research.unit), detail: city.name, cityId: city.id,
            startedAt: endsAt - RECRUIT_RULES[research.unit].researchSeconds * 1000, endsAt,
            selection: { kind: 'settlement', id: city.id }, point: { x: city.x, y: city.y } });
    }
    for (const expedition of world.settler_expeditions ?? []) {
        if (expedition.owner_id !== owner || expedition.status !== 'travelling') continue;
        const point = cellCenter(expedition.col, expedition.row);
        events.push({ id: 'expedition:' + expedition.id, kind: 'settlers', category: 'cities', title: expedition.name,
            detail: 'Founding a new city', destination: fieldLabel(point), cityId: expedition.origin_settlement_id,
            startedAt: timestamp(expedition.departure_at), endsAt: timestamp(expedition.arrival_at),
            selection: { kind: 'cell', ...activityField(point) }, point });
    }
    return events.sort((a, b) => Number(!!b.live) - Number(!!a.live) || (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity) || a.id.localeCompare(b.id));
}
/** Map keeps its short movement roster. In City, prioritize building/training
 * in the selected city, then other city projects, then the remaining events.
 * Keep stable IDs and server deadlines; never mutate the authoritative list. */
export function activityPreview(events: readonly MapActivity[], view: 'movements' | 'city', cityId?: number): MapActivity[] {
    if (view === 'movements') return events.filter(event => event.category === 'armies').slice(0, 3);
    const priority = (event: MapActivity) => {
        const work = event.kind === 'construction' || event.kind === 'recruitment';
        if (work && event.cityId === cityId) return 0;
        if (work) return 1;
        if (event.category === 'cities' && event.cityId === cityId) return 2;
        return 3;
    };
    return [...events].sort((a,b) => priority(a)-priority(b)).slice(0, 5);
}

export function activityProgress(event: MapActivity, now: number) {
    if (event.startedAt === null || event.endsAt === null) return 0;
    return Math.max(0, Math.min(1, (now - event.startedAt) / Math.max(1, event.endsAt - event.startedAt)));
}

/** The empire-wide Events panel never hides activity outside the selected city.
 * Filtering is a pure projection so both map/city views retain privacy and
 * unchanged authoritative deadlines. A shipment belongs to BOTH endpoints. */
export type EmpireActivityFilter = 'all' | 'construction' | 'recruitment' | 'armies' | 'cities' | 'other';
export function filterEmpireActivity(events: readonly MapActivity[], filter: EmpireActivityFilter = 'all', cityId?: number): MapActivity[] {
    return events.filter(event => {
        if (cityId !== undefined && event.cityId !== cityId && event.sourceCityId !== cityId) return false;
        if (filter === 'all') return true;
        if (filter === 'armies' || filter === 'cities') return event.category === filter;
        if (filter === 'other') return event.category === 'cities' && event.kind !== 'construction' && event.kind !== 'recruitment';
        return event.kind === filter;
    });
}

/** Both city names are already projected from the owner's own snapshot.
 * Keep route text visible even in the map's three-movement preview. */
export function reinforcementRouteLabel(event: MapActivity): string {
    return `${event.detail} → ${event.destination ?? 'Unknown city'}`;
}
