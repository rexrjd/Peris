import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import { RESOURCES } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { cityOverview, number, signed, duration } from '../domain/overview';
import { CityReport, type CityReportTab } from './CityReport';
import { CityConstructionQueue, constructionTarget } from './CityConstructionQueue';
import { cityLayout } from '../rendering/three/layout';
import { citySlots } from '../domain/slots';
import { soldierTotal } from '../../army/domain/units';
import { RECRUIT_UNITS as UNIT_TYPES, RECRUIT_RULES, rosterTotal, readRoster, type RecruitUnit } from '../../army/domain/roster';
import { armyFaction } from '../../army/domain/faction';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { factionTroopName } from '../../frontier/ui/roster';
import { territoryAllowance, territoryPopulation } from '../../map/domain/territory';
import { cityMilitaryOverview, sameCityStation as sameStation } from '../domain/militaryOverview';

const resourceLabel = { wood: 'Timber', stone: 'Stone', food: 'Food', gold: 'Gold' } as const;
function VillageTroopIcon({ unit, faction }: { unit: RecruitUnit; faction: Faction }) {
    const cell = ['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult'].indexOf(RECRUIT_RULES[unit].role);
    return <span className="village-troop-icon" aria-hidden="true" style={{ backgroundImage: `url(/art/battle/roster/${faction}.png)`, backgroundPosition: `${cell % 3 * 50}% ${Math.floor(cell / 3) * 50}%` }}/>;
}

export function CityEconomySummary({ world, sid, owner, now, onSelect, onEmpire }: {
    world: World; sid: number; owner: string; now: number; onSelect: (key: string) => void; onEmpire?: () => void;
}) {
    const [reportTab, setReportTab] = useState<CityReportTab | null>(null);
    const model = cityOverview(world, sid, now), { town, population, capacity, staffing, jobs, growth } = model;
    const order = world.orders.find(o => o.owner_id === owner && o.kind === 'upgrade' && (o.settlement_id ?? world.settlements[0].id) === sid);
    const levels = Object.fromEntries(world.buildings.filter(b => b.settlement_id === sid).map(b => [b.building_type, b.level]));
    const level = order ? cityLayout(levels, citySlots(world, sid)).find(plot => plot.key === constructionTarget(order))?.level ?? 0 : 0;
    const claimed = world.map_plots?.filter(plot => plot.owner_id === owner && plot.settlement_id === sid).length ?? 0;
    const allowance = territoryAllowance(territoryPopulation(world, owner, sid));
    return <aside className="village-rail village-economy" aria-label="Village resources and population">
        <section className="village-residents"><h3>People of the village</h3><button onClick={() => setReportTab('residents')} title={`${Math.floor(population)} residents of ${capacity} housing places. ${growth > 0 ? 'One new resident arrives per minute while food and housing are available.' : growth < 0 ? 'Residents are leaving because of a food shortage.' : 'Population growth is paused.'}`}><Icon name="people" size={24}/><span><strong>{Math.floor(population).toLocaleString()}</strong><small> / {capacity.toLocaleString()} residents</small></span><Icon name="arrow" size={13}/></button>
            <button className={`village-staffing ${staffing < 1 ? 'needs-attention' : ''}`} onClick={() => setReportTab('production')} title={`${number(Math.min(population, jobs))} of ${jobs} production workers. Staffing scales building bonuses. Basic gathering continues without workers.`}><span>Production staffed</span><b>{Math.round(staffing * 100)}%</b></button>
        </section>
        <section className="village-stock"><h3>Stores <small>Income / hour</small></h3>{RESOURCES.map(resource => {
            const stock = Math.floor(town[resource]), limit = resource === 'food' ? town.food_capacity ?? town.capacity : town.capacity, rate = town[`${resource}_rate`];
            const help = `${resourceLabel[resource]}: ${stock.toLocaleString()} of ${limit.toLocaleString()} stored. Net production ${signed(rate * 60)} per hour (${signed(rate)} per minute). ${stock >= limit - .01 ? 'Storage is full; further production cannot be stored.' : rate > 0 ? `Storage fills in about ${duration((limit - stock) / rate)}.` : rate < 0 ? `Reserves last about ${duration(stock / -rate)}.` : 'Income and consumption are balanced.'}`;
            return <button key={resource} className={`village-resource resource-${resource} ${rate < 0 ? 'needs-attention' : ''}`} title={help} onClick={() => setReportTab('production')} aria-label={`${resourceLabel[resource]} ${stock.toLocaleString()} of ${limit.toLocaleString()}, ${signed(rate * 60)} per hour. Open production details.`}><span className="village-resource-line"><Icon name={resource} size={19}/><strong>{stock.toLocaleString()}</strong><em>{signed(rate * 60)}/h</em></span><span className="village-store-meter"><i style={{ width: `${Math.max(0, Math.min(100, stock / Math.max(1, limit) * 100))}%` }}/></span><small>{resourceLabel[resource]} <span>{limit.toLocaleString()} capacity</span></small></button>;
        })}</section>
        <section className="village-food"><h3>Food balance / hour</h3><dl><div title="Food gathering, farms, fisheries and owned fields, after staffing"><dt>Produced</dt><dd>{signed((town.food_gross_rate ?? town.food_rate + (town.food_upkeep ?? 0)) * 60)}</dd></div><div title="Each resident consumes 0.12 food per minute. Troop food upkeep is not part of this village economy."><dt>Resident upkeep</dt><dd>−{number((town.food_upkeep ?? 0) * 60)}</dd></div><div className={town.food_rate < 0 ? 'needs-attention' : 'village-food-net'} title="Food production minus resident consumption"><dt>Net food</dt><dd>{signed(town.food_rate * 60)}/h</dd></div></dl></section>
        <CityConstructionQueue order={order} level={level} now={now} onSelect={onSelect}/>
        {onEmpire && <button className="village-territory" onClick={onEmpire} title="Open the empire atlas to claim connected fields and build resource sites. Claimed fields also provide stations for your own troops."><Icon name="world" size={18}/><span>Village territory<small>{claimed} / {allowance} fields claimed</small></span><Icon name="arrow" size={14}/></button>}
        <button className="village-ledger-link" onClick={() => setReportTab('overview')} title="Full population, worker and resource report"><Icon name="report" size={15}/>Open village ledger<Icon name="arrow" size={13}/></button>
        {reportTab && <CityReport world={world} sid={sid} now={now} initialTab={reportTab} onSelect={onSelect} onClose={() => setReportTab(null)}/>}
    </aside>;
}

export function CityArmySummary({ world, sid, owner, now, onSelect }: {
    world: World; sid: number; owner: string; now: number; onSelect: (key: string) => void;
}) {
    const { town, own, stationed, pool, cityDefenders, troopsByFaction, totals, reserved, training, movements } = cityMilitaryOverview(world, sid, owner, now);
    const recruitmentPlot = citySlots(world, sid).find(slot => slot.building_type === 'barracks' && slot.level > 0);
    const openRecruitment = (unit: RecruitUnit) => {
        const building = RECRUIT_RULES[unit].building, slot = citySlots(world,sid).filter(slot=>slot.building_type===building).sort((a,b)=>b.level-a.level)[0];
        onSelect(slot ? `slot:${slot.slot_index}` : world.buildings.some(entry=>entry.settlement_id===sid&&entry.building_type===building) ? building : 'market');
    };
    return <aside className="village-rail village-army" aria-label="Village troops and movements"><section><h3><Icon name="shield" size={16}/>Army at home <b>{rosterTotal(totals).toLocaleString()}</b></h3><p className="village-muted">Ready troops in this village</p><div className="village-troops" aria-label="Troops stationed in this village">{[...troopsByFaction].flatMap(([culture, troops]) => UNIT_TYPES.filter(type => ['infantry','archers','cavalry'].includes(type) || troops[type] > 0).map(type => <button key={`${culture}:${type}`} data-faction={culture} onClick={()=>openRecruitment(type)} title={`${FACTIONS[culture].name} · ${factionTroopName(culture, type)} · Open ${RECRUIT_RULES[type].building} recruitment · Carry ${RECRUIT_RULES[type].carry} each. Includes legions and unassigned troops physically stationed here. Travelling and unfinished training are excluded.`}><VillageTroopIcon faction={culture} unit={type}/><span>{factionTroopName(culture, type)}</span><strong data-troop={type}>{troops[type].toLocaleString()}</strong></button>))}</div>
        {cityDefenders && rosterTotal(readRoster(cityDefenders)) > 0 && <small className="village-pool-note" title="These soldiers belong to the permanent city garrison and fight automatically even when the owner is offline.">{rosterTotal(readRoster(cityDefenders)).toLocaleString()} permanent garrison defenders</small>}
        {pool && soldierTotal(pool) > 0 && <small className="village-pool-note" title="These troops can join an idle legion here. A returning legion automatically collects available stationed troops within its 1,000 soldier capacity.">{soldierTotal(pool).toLocaleString()} troops awaiting a legion</small>}
        {reserved > 0 && <small className="village-pool-note" title="These unsent troops belong to a busy legion in an older save. They become available when that legion returns and are excluded from ready troop counts.">{reserved.toLocaleString()} troops reserved until their legion returns</small>}
        <details className="village-legions"><summary>{stationed.length} {stationed.length === 1 ? 'legion' : 'legions'} stationed here</summary>{stationed.map(army => <div key={army.id}><span>{army.name}</span><b>{soldierTotal(army).toLocaleString()}</b></div>)}{!stationed.length && <p>No legion is currently stationed here.</p>}</details>
        <button className="village-ledger-link" onClick={() => onSelect(recruitmentPlot ? `slot:${recruitmentPlot.slot_index}` : 'market')} title={recruitmentPlot ? 'Open barracks recruitment, research and upgrades.' : 'Manage the main building or use an empty plot to build barracks.'}><Icon name="barracks" size={15}/>{recruitmentPlot ? 'Open barracks' : 'Develop the village'}<Icon name="arrow" size={13}/></button>
    </section><section className="village-training"><h3><Icon name="time" size={15}/>In training <b>{training.reduce((sum, order) => sum + order.quantity, 0)}</b></h3>{training.length ? training.map(order => { const army = own.find(army => army.id === (order.army_id ?? world.armies[0]?.id)); return <div className="village-timed-order" key={order.id} title={`Training for ${army?.name ?? 'your legion'}. Completes ${new Date(order.finish_at).toLocaleString()}; these troops are not ready until then.`}><span>{order.quantity} {factionTroopName(armyFaction(world, army), order.item as RecruitUnit)}<small>{Date.parse(order.started_at) > now ? 'Queued' : 'Training'} · {army?.name ?? 'Your legion'}</small></span><b>{clock(Math.max(0, (Date.parse(order.finish_at) - now) / 1000))}</b></div>; }) : <p className="village-muted">No troops in training.</p>}</section>
        <section className="village-movements"><h3><Icon name="flag" size={15}/>Troop movements <b>{movements.length}</b></h3>{movements.length ? movements.map(army => {
            const preparing = now < Date.parse(army.departure_at), arriving = sameStation({ x: army.target_x, y: army.target_y }, town);
            const state = preparing ? 'Preparing departure' : arriving ? army.march_returning ? 'Returning home' : 'Arriving reinforcement' : army.raid_target_id ? 'Outgoing raid' : 'Outgoing march';
            const deadline = preparing ? Date.parse(army.departure_at) : Date.parse(army.arrival_at);
            return <div className={`village-timed-order ${arriving ? 'is-returning' : ''}`} key={army.id} title={`${army.name}: ${soldierTotal(army)} troops. ${state}. ${preparing ? 'Departure' : 'Arrival'} ${new Date(deadline).toLocaleString()}. These troops are reserved for this order and are excluded from the at-home total.`}><span>{state}<small>{army.name} · {soldierTotal(army)} troops</small></span><b>{clock(Math.max(0, (deadline - now) / 1000))}</b></div>;
        }) : <p className="village-muted">No arrivals or departures.</p>}</section>
    </aside>;
}
