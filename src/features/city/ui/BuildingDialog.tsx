import {ACADEMY_SCIENCE,scienceRate} from '../../research/domain/science';
import {researchFactor,trainingBoost} from '../../research/domain/effects';
import {useResearchNavigation} from '../../research/ui/ResearchNavigation';
import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { RESOURCES } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { Cost, Modal } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
import { BUILDINGS } from '../domain/buildings';
import { buildingCost, MAX_BUILDING_LEVEL, upgradeSeconds } from '../domain/construction';
import { affordable, liveResources } from '../domain/economy';
import { WORKERS_PER_LEVEL } from '../domain/population';
import { armyAttack, citySlots, SLOT_BUILDINGS, slotCost, slotCount, slotLevels, slotMaxLevel, type SlotType } from '../domain/slots';
import type { BuildingType } from '../domain/types';
import type { CityPlot } from '../rendering/three/layout';
import { BuildingArtwork } from '../rendering/BuildingArtwork';
import { BuildingPreview } from '../rendering/BuildingPreview';
import { factionOf } from '../../factions/domain/factions';
import { CityDebugPanel } from '../../factions/ui/CityDebugPanel';
import { MageTowerPanel } from '../../magic/ui/MageTowerPanel';
import { recruitSeconds } from '../../army/domain/recruitment';
import { BuildingPicker } from './BuildingPicker';
import { CityConstructionQueue } from './CityConstructionQueue';
import { RecruitmentPanel } from '../../army/ui/RecruitmentPanel';
import { atRecruitmentCity } from '../../army/domain/commandRoom';
import { soldierTotal } from '../../army/domain/units';
import { MarchDialog, type MarchDestination } from '../../map/ui/MarchDialog';

type BenefitRow = { name: string; current: string; next: string; help?: string };
function benefits(world: World, sid: number, plot: CityPlot): BenefitRow[] {
    const type = plot.type, level = plot.level, next = level + 1, town = world.settlements.find(s => s.id === sid)!;
    const rows: BenefitRow[] = [];
    if(type==='academy')rows.push({name:'Account science / minute',current:String(ACADEMY_SCIENCE[level]??0),next:String(ACADEMY_SCIENCE[Math.min(5,next)]),help:'All completed Academies in every city stack. Empire bonuses apply to total science.'});
    const production = { lumber: ['Timber', 8], quarry: ['Stone', 7], farm: ['Food', 10], fishery: ['Food', 8], market: ['Gold', 3] } as const;
    if (type && type in production) {
        const [name, amount] = production[type as keyof typeof production];
        rows.push({ name: `${name} building bonus`, current: `+${level * amount * 60}/h`, next: `+${next * amount * 60}/h`, help: 'Potential production before staffing. Worker shortages reduce this bonus; base gathering and owned fields are separate.' });
    }
    if (type && type in WORKERS_PER_LEVEL) {
        const workers = WORKERS_PER_LEVEL[type as keyof typeof WORKERS_PER_LEVEL];
        rows.push({ name: 'Workers needed', current: String(level * workers), next: String(next * workers), help: 'Production workers are assigned automatically from the village population.' });
    }
    if (type === 'market') {
        rows.push({ name: 'Building plots', current: String(slotCount(level)), next: String(slotCount(next)) });
        rows.push({ name: 'Village housing capacity', current: String(town.population_capacity ?? 40), next: String((town.population_capacity ?? 40) + 10), help: 'The main building adds ten population places per level; housing buildings add their own capacity.' });
    }
    if (type === 'housing') rows.push({ name: 'Housing places', current: String(level * 30), next: String(next * 30), help: 'Each housing level adds thirty population places. Residents arrive while food and room are available.' });
    if (type === 'warehouse' || type === 'storehouse') rows.push({ name: 'Material storage', current: town.capacity.toLocaleString(), next: (town.capacity + Math.floor(2500*researchFactor(world,town.owner_id,'storage'))).toLocaleString(), help: 'Capacity for each of timber, stone and gold. Multiple warehouses stack.' });
    if (type === 'granary') rows.push({ name: 'Food storage', current: (town.food_capacity ?? town.capacity).toLocaleString(), next: ((town.food_capacity ?? town.capacity) + Math.floor(2500*researchFactor(world,town.owner_id,'storage'))).toLocaleString(), help: 'Granary levels add 2,500 food storage each. Multiple granaries stack.' });
    if (type === 'wall') rows.push({ name: 'Starting morale bonus', current: `+${level * 2}`, next: `+${next * 2}`, help: 'Each wall level grants two starting morale. Total starting morale is capped at 100.' });
    if (type === 'smithy') {
        const bonus = Math.round((armyAttack(world, sid) - 1) * 100);
        rows.push({ name: 'Village army damage bonus', current: `+${bonus}%`, next: `+${Math.min(60, bonus + 4)}%`, help: 'Smithies add four percent per level, capped at sixty percent across this village.' });
    }
    if (type === 'barracks' || type === 'stables') {
        const total = slotLevels(world, sid, type), unit = type === 'stables' ? 'cavalry' : 'infantry';
        rows.push({ name: `Training 10 ${type === 'stables' ? 'cavalry' : 'infantry'}`, current: total ? clock(recruitSeconds(unit, 10, total,trainingBoost(world,town.owner_id))) : 'Unavailable', next: clock(recruitSeconds(unit, 10, total + 1,trainingBoost(world,town.owner_id))), help: 'Example batch duration, using all completed levels of this building type in the village. Recruitment costs and available troops are shown in Armies.' });
    }
    if (type === 'mage_tower') rows.push({ name: 'Spells available to research', current: `${Math.min(20, level * 2)} / 20`, next: `${Math.min(20, next * 2)} / 20`, help: 'Each tower level unlocks two spells. Each spell still needs to be researched separately.' });
    return rows;
}

export function BuildingDialog({ world, owner, sid, plot, initialChoice, note, busy, now, run, onSelect, onClose, appearance }: {
    world: World; owner: string; sid: number; plot: CityPlot; initialChoice: SlotType; note?: string; busy: boolean; now: number; appearance?: 'scene';
    run: (command: Command, message?: string) => void; onSelect: (key: string) => void; onClose: () => void;
}) {
    const openResearch=useResearchNavigation();
    const town = world.settlements.find(s => s.id === sid)!, slots = citySlots(world, sid), resources = liveResources(town, now);
    const legions = world.armies.filter(army => army.owner_id === owner);
    const [legionId,setLegionId] = useState(() => (legions.find(army => atRecruitmentCity(army,town,now)) ?? legions[0])?.id);
    const [marchRequest,setMarchRequest] = useState<{armyId:number;destination:MarchDestination}|null>(null);
    const legion = legions.find(army => army.id === legionId) ?? legions[0];
    const type = plot.type, empty = plot.slot !== undefined && !type;
    const meta = type ? plot.slot === undefined ? BUILDINGS[type as BuildingType] : SLOT_BUILDINGS[type as SlotType] : null;
    const max = type && plot.slot !== undefined ? slotMaxLevel(type as SlotType) : MAX_BUILDING_LEVEL, maxed = plot.level >= max;
    const order = world.orders.find(o => o.owner_id === owner && o.kind === 'upgrade' && (o.settlement_id ?? world.settlements[0].id) === sid);
    const cost = type ? plot.slot === undefined ? buildingCost(type as BuildingType, plot.level) : slotCost(type as SlotType, plot.level) : null;
    const shortages = cost ? RESOURCES.filter(resource => resources[resource] < cost[resource]).map(resource => `${(cost[resource] - resources[resource]).toLocaleString()} ${resource === 'wood' ? 'timber' : resource}`) : [];
    const reason = maxed ? 'Fully developed' : order ? 'Builders are working' : busy ? 'Issuing order…' : cost && !affordable(resources, cost) ? 'More supplies needed' : null;
    const fishingUnbuilt = plot.slot === 16 && !slots.some(slot => slot.slot_index === 16);
    const orderLevel = order ? order.item.startsWith('slot:') ? slots.find(slot => slot.slot_index === Number(order.item.split(':')[1]))?.level ?? 0 : world.buildings.find(building => building.settlement_id === sid && building.building_type === order.item)?.level ?? 0 : 0;
    const name = meta?.name ?? `Empty plot ${plot.slot! + 1}`;
    const close = () => { if (typeof document === 'undefined' || !document.querySelector('.mage-spellbook')) onClose(); };
    const rows = benefits(world, sid, plot);
    const Preview = appearance === 'scene' ? BuildingPreview : BuildingArtwork;
    const dialog = <Modal title={type==='academy'?'Academy':'Selected building'} className={`village-building-dialog ${appearance === 'scene' ? 'city-scene-building-dialog' : ''} ${type==='academy'?'academy-dialog':''}`} heading={false} onClose={close}>
        <header className="village-building-heading"><span className="eyebrow">{town.name} · {empty ? `PLOT ${plot.slot! + 1}` : plot.slot === 16 ? 'RIVERSIDE SITE' : 'VILLAGE DEVELOPMENT'}</span><h2>{name}</h2>{!empty && <p>{plot.level ? `Level ${plot.level}` : 'Not built'} <span>→ {maxed ? 'Fully developed' : `Level ${plot.level + 1}`}</span></p>}</header>
        {note && <p className="village-building-note">{note}</p>}
        {empty ? <><p className="village-building-intro">Develop this plot with a building of your choice. Your main building unlocks additional plots as the village grows.</p><BuildingPicker key={`${plot.key}:${initialChoice}`} initialChoice={initialChoice} slot={plot.slot!} resources={resources} hasTower={slots.some(slot => slot.building_type === 'mage_tower')} busy={busy} building={!!order} run={run}/><p className="village-building-footnote"><Icon name="time" size={14}/> {clock(upgradeSeconds(0,researchFactor(world,owner,'construction')))} construction time · one construction project at a time.</p></> : <>
            <section className="village-building-hero"><Preview type={type!} level={Math.max(1, plot.level)} faction={factionOf(town.faction)} label={`${name}, ${plot.level ? `level ${plot.level}` : 'appearance after construction'}`}/><div className="village-building-hero-info"><span>{maxed ? 'MASTERED' : plot.level ? 'NEXT UPGRADE' : 'NEW CONSTRUCTION'}</span><strong>{maxed ? `Level ${plot.level}` : `Level ${plot.level + 1}`}</strong><p>{maxed ? 'This building is fully developed.' : `${clock(upgradeSeconds(plot.level,researchFactor(world,owner,'construction')))} construction time`}</p>{!plot.level && <small>Preview of the completed building</small>}</div></section>
            <section className="village-building-description"><h3>Description</h3><p>{meta!.description}</p></section>
            {rows.length > 0 && <section className="village-building-effects"><h3>{maxed ? 'Current benefits' : 'What improves'}</h3><table><thead><tr><th>Benefit</th><th>Current</th>{!maxed && <th>Level {plot.level + 1}</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.name} title={row.help}><th scope="row">{row.name}</th><td>{row.current}</td>{!maxed && <td>{row.next}</td>}</tr>)}</tbody></table>{type && type in WORKERS_PER_LEVEL && <p className="village-building-footnote">Production bonuses are shown before staffing. Keep enough residents and food to run them.</p>}</section>}
            {!maxed && <section className="village-upgrade-box"><h3>{plot.level ? 'Upgrade cost' : 'Construction cost'}</h3><Cost cost={cost!} resources={resources}/>{shortages.length > 0 && <p className="village-shortages">Missing {shortages.join(', ')}.</p>}<div className="village-upgrade-action"><button className="button gold" disabled={!!reason} title={reason ?? `${plot.level ? 'Upgrade' : 'Construct'} ${name}. Supplies are paid once when the command is accepted.`} onClick={() => run(plot.slot === undefined ? { type: 'upgrade', item: type as BuildingType } : fishingUnbuilt ? { type: 'buildSlot', slot: 16, item: 'fishery' } : { type: 'upgradeSlot', slot: plot.slot }, `${name} ${plot.level ? 'upgrade' : 'construction'} started`)}>{reason ?? (plot.level ? `Upgrade to level ${plot.level + 1}` : `Construct ${name}`)}</button><span><Icon name="time" size={17}/>{clock(upgradeSeconds(plot.level,researchFactor(world,owner,'construction')))}</span></div><small>One construction project at a time in this village.</small></section>}
        </>}
        {type==='academy'&&<section className="academy-science"><strong>+{(ACADEMY_SCIENCE[plot.level]??0)*researchFactor(world,owner,'science')} science / min</strong><p>Account total: {scienceRate(world,owner).toLocaleString(undefined,{maximumFractionDigits:1})} / min across all cities.</p><button className="tech-primary" onClick={()=>{onClose();openResearch();}}>Open technology tree <Icon name="arrow" size={16}/></button></section>}
        {order && <CityConstructionQueue order={order} level={orderLevel} now={now} onSelect={onSelect}/>}
        {type === 'mage_tower' && <MageTowerPanel world={world} sid={sid} level={plot.level} run={run} busy={busy} now={now}/>}
        {(type === 'barracks' || type === 'stables' || type === 'workshop') && <section className="village-building-recruitment" aria-label={`${meta?.name} recruitment`}><h3>Recruit &amp; research</h3>{legion ? <><label className="command-label">Recruiting legion<select aria-label="Recruiting legion" value={legion.id} onChange={event=>setLegionId(Number(event.target.value))}>{legions.map(army=><option key={army.id} value={army.id}>{army.name} · {soldierTotal(army)} troops{atRecruitmentCity(army,town,now)?' · At this city':' · Away'}</option>)}</select></label><div className="army-command village-recruitment"><RecruitmentPanel key={`${sid}:${type}:${legion.id}`} embedded buildingOnly={type} world={world} army={legion} city={town} busy={busy} now={now} run={(command,message)=>{if(command.type==='move')setMarchRequest({armyId:command.armyId??legion.id,destination:{kind:'move',x:command.x,y:command.y,label:town.name}});else run(command,message);}}/></div></> : <p>Raise a legion from Armies to recruit troops here.</p>}</section>}
        <details className="village-building-settings"><summary>City settings &amp; debug</summary><CityDebugPanel world={world} owner={owner} cityId={sid} target={type ? plot.slot !== undefined && !fishingUnbuilt ? `slot:${plot.slot}` : fishingUnbuilt ? '' : type : ''} name={name} level={plot.level} max={max} busy={busy} run={run}/></details>
    </Modal>;
    const shown = marchRequest ? <MarchDialog world={world} playerId={owner} now={now} busy={busy} initialArmyId={marchRequest.armyId} destination={marchRequest.destination} run={run} onClose={()=>setMarchRequest(null)}/> : dialog;
    return typeof document === 'undefined' ? shown : createPortal(shown, document.body);
}
