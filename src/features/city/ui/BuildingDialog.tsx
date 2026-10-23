import { rallyFactionStyle } from '../../army/ui/rallyFactionTheme';
import {ACADEMY_SCIENCE,scienceRate} from '../../research/domain/science';
import {researchFactor,trainingBoost} from '../../research/domain/effects';
import {useResearchNavigation} from '../../research/ui/ResearchNavigation';
import { createPortal } from 'react-dom';
import { useEffect, useId, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { RESOURCES } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { Cost } from '../../../shared/ui/Shared';
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
import { BuildingChoices, buildingChoiceReason } from './BuildingPicker';
import { BuildingInspector } from './BuildingInspector';
import { RECRUIT_RULES, type RecruitUnit } from '../../army/domain/roster';
import { factionTroopName } from '../../frontier/ui/roster';
import { CityConstructionQueue, constructionTarget, constructionName } from './CityConstructionQueue';
import { RecruitmentPanel } from '../../army/ui/RecruitmentPanel';
import { atRecruitmentCity } from '../../army/domain/commandRoom';
import { soldierTotal } from '../../army/domain/units';
import { MarchDialog, type MarchDestination } from '../../map/ui/MarchDialog';
import {MarketPanel} from './MarketPanel';

type BenefitRow = { name: string; current: string; next: string; help?: string };
function benefits(world: World, sid: number, plot: CityPlot): BenefitRow[] {
    const type = plot.type, level = plot.level, next = level + 1, town = world.settlements.find(s => s.id === sid)!;
    const rows: BenefitRow[] = [];
    if(type==='bazaar')rows.push({name:'Caravan capacity',current:(level*1000).toLocaleString(),next:(Math.min(5,next)*1000).toLocaleString(),help:'Capacity is shared by outbound and returning merchants. One resource unit uses one space.'});
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
        rows.push({ name: `Training 10 ${type === 'stables' ? 'cavalry' : 'infantry'}`, current: total ? clock(recruitSeconds(unit, 10, total,trainingBoost(world,town.owner_id)), world.game_clock?.rate ?? 1) : 'Unavailable', next: clock(recruitSeconds(unit, 10, total + 1,trainingBoost(world,town.owner_id)), world.game_clock?.rate ?? 1), help: 'Example batch duration, using all completed levels of this building type in the village. Recruitment costs and available troops are shown in Armies.' });
    }
    if (type === 'mage_tower') rows.push({ name: 'Spells available to research', current: `${Math.min(20, level * 2)} / 20`, next: `${Math.min(20, next * 2)} / 20`, help: 'Each tower level unlocks two spells. Each spell still needs to be researched separately.' });
    return rows;
}

export function BuildingDialog({ world, owner, sid, plot, initialChoice, note, busy, now, run, onSelect, onClose, appearance,onTrade }: {
    world: World; owner: string; sid: number; plot: CityPlot; initialChoice: SlotType; note?: string; busy: boolean; now: number; appearance?: 'scene';
    run: (command: Command, message?: string) => void; onSelect: (key: string) => void; onClose: () => void;
    onTrade?:(command:Command)=>Promise<void>;
}) {
    const openResearch = useResearchNavigation(), id = useId();
    const town = world.settlements.find(s => s.id === sid)!, slots = citySlots(world, sid), resources = liveResources(town, now);
    const faction = factionOf(town.faction), type = plot.type, empty = plot.slot !== undefined && !type;
    const military = type === 'barracks' || type === 'stables' || type === 'workshop';
    const [tab, setTab] = useState<'upgrade' | 'train' | 'spells'|'trade'>(() => type==='bazaar'&&plot.level?'trade':military && plot.level ? 'train' : type === 'mage_tower' && plot.level ? 'spells' : 'upgrade');
    const activeTab = tab === 'trade'&&type==='bazaar'||tab === 'train' && military || tab === 'spells' && type === 'mage_tower' ? tab : 'upgrade';
    const [choice, setChoice] = useState(initialChoice), [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null), [settingsOpen,setSettingsOpen] = useState(false);
    useEffect(() => { setChoice(initialChoice); }, [sid, plot.key, initialChoice]);
    const legions = world.armies.filter(army => army.owner_id === owner);
    const [recruitTarget, setRecruitTarget] = useState(() => String((legions.find(army => atRecruitmentCity(army,town,now)) ?? legions[0])?.id ?? 'garrison'));
    const [marchRequest, setMarchRequest] = useState<{armyId:number;destination:MarchDestination}|null>(null);
    const legion = legions.find(army => String(army.id) === recruitTarget) ?? legions[0];
    const recruitDestination = recruitTarget === 'garrison' ? 'garrison' : 'legion';
    const meta = type ? plot.slot === undefined ? BUILDINGS[type as BuildingType] : SLOT_BUILDINGS[type as SlotType] : null;
    const max = type && plot.slot !== undefined ? slotMaxLevel(type as SlotType) : MAX_BUILDING_LEVEL, maxed = plot.level >= max;
    const order = world.orders.find(o => o.owner_id === owner && o.kind === 'upgrade' && (o.settlement_id ?? world.settlements[0].id) === sid);
    const upgradingThis = !!order && constructionTarget(order) === plot.key;
    const hasTower = slots.some(slot => slot.building_type === 'mage_tower'), hasBarracks = slots.some(slot => slot.building_type === 'barracks'),hasMarket=slots.some(slot=>slot.building_type==='bazaar');
    const picked = SLOT_BUILDINGS[choice];
    const cost = empty ? slotCost(choice,0) : type ? plot.slot === undefined ? buildingCost(type as BuildingType, plot.level) : slotCost(type as SlotType, plot.level) : null;
    const shortages = cost ? RESOURCES.filter(resource => resources[resource] < cost[resource]).map(resource => `${Math.ceil(cost[resource] - resources[resource]).toLocaleString()} ${resource === 'wood' ? 'timber' : resource}`) : [];
    const reason = empty ? buildingChoiceReason(choice,resources,hasTower,hasBarracks,busy,!!order,hasMarket) : maxed ? 'Fully developed' : order ? 'Builders are working' : busy ? 'Issuing order…' : cost && !affordable(resources,cost) ? 'More supplies needed' : null;
    const fishingUnbuilt = plot.slot === 16 && !slots.some(slot => slot.slot_index === 16);
    const orderLevel = order ? order.item.startsWith('slot:') ? slots.find(slot => slot.slot_index === Number(order.item.split(':')[1]))?.level ?? 0 : world.buildings.find(building => building.settlement_id === sid && building.building_type === order.item)?.level ?? 0 : 0;
    const name = meta?.name ?? `Empty plot ${plot.slot! + 1}`;
    const close = () => { if (typeof document === 'undefined' || !document.querySelector('.mage-spellbook')) onClose(); };
    const rows = benefits(world,sid,plot), Preview = appearance === 'scene' ? BuildingPreview : BuildingArtwork;
    const training = military ? world.orders.filter(o => o.owner_id === owner && o.kind === 'recruit' && (o.settlement_id ?? world.settlements[0].id) === sid && RECRUIT_RULES[o.item as RecruitUnit]?.building === type).sort((a,b) => Date.parse(a.finish_at)-Date.parse(b.finish_at)) : [];
    const tabs = [...(type==='bazaar'?[{key:'trade' as const,label:'Trade'}]:[]),{key:'upgrade' as const,label:empty?'Build':'Upgrade'}, ...(military?[{key:'train' as const,label:'Train'}]:[]), ...(type==='mage_tower'?[{key:'spells' as const,label:'Spells'}]:[])];
    const upgrade = () => run(empty ? {type:'buildSlot',slot:plot.slot!,item:choice} : plot.slot === undefined ? {type:'upgrade',item:type as BuildingType} : fishingUnbuilt ? {type:'buildSlot',slot:16,item:'fishery'} : {type:'upgradeSlot',slot:plot.slot!}, `${empty?picked.name:name} ${empty||!plot.level?'construction':'upgrade'} started`);
    const dialog = <BuildingInspector title={type==='academy'?'Academy':'Selected building'} onClose={close} returnFocusSelector={`[data-building="${plot.key}"]`}>
        <button className="building-inspector-settings-toggle" aria-label="Building settings" aria-expanded={settingsOpen} title="City settings & debug" onClick={()=>setSettingsOpen(!settingsOpen)}><Icon name="settings" size={14}/></button>
        <header className="building-inspector-heading">
            <div className="building-inspector-art">{empty ? <Icon name="town" size={36}/> : <Preview type={type!} level={Math.max(1,plot.level)} faction={faction} label={`${name}, ${plot.level?`level ${plot.level}`:'appearance after construction'}`}/>}</div>
            <div><small>{town.name}{empty?` · Plot ${plot.slot!+1}`:plot.slot===16?' · Riverside':''}</small><h2>{name}</h2><p>{empty?'Choose what to build':<>Level {plot.level} / {max}<span>{upgradingThis?'Upgrading':maxed?'Complete':!plot.level?'Unbuilt':''}</span></>}</p></div>
        </header>
        {tabs.length>1 && <nav className="building-inspector-tabs" role="tablist" aria-label="Building actions">{tabs.map(item=><button key={item.key} role="tab" id={`${id}-${item.key}`} aria-selected={activeTab===item.key} aria-controls={`${id}-panel-${item.key}`} tabIndex={activeTab===item.key?0:-1} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabs.findIndex(t=>t.key===activeTab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next].key);document.getElementById(`${id}-${tabs[next].key}`)?.focus();}} onClick={()=>setTab(item.key)}>{item.label}{item.key==='train'&&training.length>0&&<span>{training.length}</span>}</button>)}</nav>}
        <div className="building-inspector-body">
            {type==='bazaar'&&<div id={`${id}-panel-trade`} role="tabpanel" aria-labelledby={`${id}-trade`} hidden={activeTab!=='trade'}><MarketPanel world={world} owner={owner} sid={sid} now={now} busy={busy} onSend={onTrade}/></div>}
            {note && <p className="building-inspector-note">{note}</p>}
            <div id={`${id}-panel-upgrade`} role={tabs.length>1?'tabpanel':undefined} aria-labelledby={tabs.length>1?`${id}-upgrade`:undefined} hidden={activeTab!=='upgrade'}>
                {empty ? <div className="building-inspector-picker"><BuildingChoices slot={plot.slot!} choice={choice} onChange={setChoice} hasTower={hasTower} hasBarracks={hasBarracks} hasMarket={hasMarket}/><p className="building-inspector-picked"><strong>{picked.name}</strong>{picked.description}</p></div> : <>
                    <p className="building-inspector-description">{meta!.description}</p>
                    {rows.length>0 && <table className="building-inspector-effects"><thead><tr><th>{maxed?'Benefit':'Next level'}</th><th>Now</th>{!maxed&&<th>Lv. {plot.level+1}</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.name} title={row.help}><th scope="row">{row.name}</th><td>{row.current}</td>{!maxed&&<td><span aria-hidden="true">→</span> {row.next}</td>}</tr>)}</tbody></table>}
                    {type && type in WORKERS_PER_LEVEL && <small className="building-inspector-hint">Production before staffing.</small>}
                    {type==='academy' && <div className="building-inspector-science"><span><strong>+{(ACADEMY_SCIENCE[plot.level]??0)*researchFactor(world,owner,'science')} / min</strong><small>{scienceRate(world,owner).toLocaleString(undefined,{maximumFractionDigits:1})} account total</small></span><button onClick={()=>{onClose();openResearch();}}>Research <Icon name="arrow" size={14}/></button></div>}
                    {maxed && <p className="building-inspector-complete"><Icon name="check" size={15}/> Fully developed</p>}
                </>}
            </div>
            {military && <div id={`${id}-panel-train`} role="tabpanel" aria-labelledby={`${id}-train`} hidden={activeTab!=='train'}>
                {legion ? <><label className="building-inspector-legion">Train for<select aria-label="Recruitment destination" value={recruitTarget} onChange={event=>setRecruitTarget(event.target.value)}>{legions.map(army=><option key={army.id} value={String(army.id)}>{army.name} · {soldierTotal(army)}{atRecruitmentCity(army,town,now)?'':' · Away'}</option>)}<option value="garrison">Garrison · Permanent defenders</option></select></label><div className="army-command building-inspector-recruitment"><RecruitmentPanel key={`${sid}:${type}:${legion.id}`} embedded formOnly destination={recruitDestination} actionContainer={actionContainer} buildingOnly={type} world={world} army={legion} city={town} busy={busy} now={now} run={(command,message)=>{if(command.type==='move')setMarchRequest({armyId:command.armyId??legion.id,destination:{kind:'move',x:command.x,y:command.y,label:town.name}});else run(command,message);}}/></div></> : <p>Raise a legion from Armies to recruit here.</p>}
                {training.length>0 && <details className="building-inspector-training-queue"><summary>Training queue <b>{training.length}</b></summary><ol>{training.map(job=><li key={job.id}><span>{job.quantity} {factionTroopName(faction,job.item as RecruitUnit)}<small>{job.recruit_destination === 'garrison' ? 'Garrison' : world.armies.find(army=>army.id===job.army_id)?.name}{Date.parse(job.started_at)>now?' · Queued':''}</small></span><time>{clock(Math.max(0,(Date.parse(job.finish_at)-now)/1000), world.game_clock?.rate ?? 1)}</time></li>)}</ol></details>}
            </div>}
            {type==='mage_tower' && <div id={`${id}-panel-spells`} role="tabpanel" aria-labelledby={`${id}-spells`} hidden={activeTab!=='spells'}><MageTowerPanel world={world} sid={sid} level={plot.level} run={run} busy={busy} now={now}/></div>}
            {settingsOpen&&<section className="building-inspector-settings" aria-label="City settings and debug"><CityDebugPanel world={world} owner={owner} cityId={sid} target={type ? plot.slot!==undefined&&!fishingUnbuilt?`slot:${plot.slot}`:fishingUnbuilt?'':type:''} name={name} level={plot.level} max={max} busy={busy} run={run}/></section>}
        </div>
        <footer className="building-inspector-footer" hidden={activeTab==='trade'||activeTab==='spells'||activeTab==='upgrade'&&maxed&&!order}>
            <div hidden={activeTab!=='upgrade'}>
                {upgradingThis ? <><p className="building-inspector-work-label">Builders are working</p><CityConstructionQueue world={world} rate={world.game_clock?.rate ?? 1} order={order} level={orderLevel} now={now} onSelect={onSelect}/></> : <>
                    {!maxed && <><div className="building-inspector-price"><Cost cost={cost!} resources={resources} compact/><span title="Construction time"><Icon name="time" size={13}/>{clock(upgradeSeconds(empty?0:plot.level,researchFactor(world,owner,'construction')), world.game_clock?.rate ?? 1)}</span></div>{shortages.length>0&&<p className="building-inspector-shortages" role="status">Need {shortages.join(', ')}.</p>}<button className="building-inspector-primary" disabled={!!reason} onClick={upgrade}>{reason ?? (empty?`Build ${picked.name}`:plot.level?`Upgrade to level ${plot.level+1}`:`Construct ${name}`)}{!reason&&<Icon name="arrow" size={15}/>}</button></>}
                    {order && <button className="building-inspector-builder-link" onClick={()=>onSelect(constructionTarget(order))}><Icon name="time" size={12}/>{constructionName(order)} is building <span>{clock(Math.max(0,(Date.parse(order.finish_at)-now)/1000), world.game_clock?.rate ?? 1)} →</span></button>}
                </>}
            </div>
            <div ref={setActionContainer} hidden={activeTab!=='train'} className="building-inspector-training-action"/>
        </footer>
    </BuildingInspector>;
    const shown = marchRequest ? <MarchDialog world={world} playerId={owner} now={now} busy={busy} initialArmyId={marchRequest.armyId} destination={marchRequest.destination} run={run} onClose={()=>setMarchRequest(null)}/> : dialog;
    const themed = appearance === 'scene' ? <div className="scene-theme" data-scene-faction={faction} style={rallyFactionStyle(faction)}>{shown}</div> : shown;
    return typeof document==='undefined' ? themed : createPortal(themed,document.body);
}
