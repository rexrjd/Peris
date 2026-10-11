import { useEffect, useState } from 'react';
import { armyFaction } from '../../army/domain/faction';
import type { ArmyTroops } from '../../army/domain/types';
import { TroopSummary } from '../../army/ui/TroopSummary';
import { wrappedWorldDelta } from '../../map/domain/dimensions';
import { RECRUIT_UNITS as UNIT_TYPES, readRoster, rosterTotal } from '../../army/domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Camp } from '../../map/domain/types';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { Modal } from '../../../shared/ui/Shared';
import type { CampaignFarmList, CampaignFarmTarget } from '../domain/types';
import '../styles/farms.css';

type Props = { world: World; playerId: string; busy: boolean; run: (command: Command, message?: string) => void; onClose: () => void };
const emptyTroops: ArmyTroops = { infantry: 0, archers: 0, cavalry: 0 };

function CreateList({ run, busy }: Pick<Props, 'run' | 'busy'>) {
    const [name, setName] = useState('');
    return <form className="campaign-create-list" onSubmit={event => { event.preventDefault(); if (busy || name.trim().length < 2) return; run({ type: 'saveCampaignFarmList', name: name.trim(), troops: { ...emptyTroops }, casualtiesOnly: false }, 'Farm list created.'); setName(''); }}>
        <label>New list name<input aria-label="New farm list name" value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label><button className="button outline" disabled={busy || name.trim().length < 2}>Create list</button>
    </form>;
}

export function CampaignFarmTargetDialog({ world, playerId, busy, run, onClose, camp, initialArmyId, target }: Props & { camp: Camp; initialArmyId: number; target?: CampaignFarmTarget }) {
    const lists = (world.campaign_farm_lists ?? []).filter(list => list.owner_id === playerId);
    const armies = world.armies.filter(army => army.owner_id === playerId);
    const [listId, setListId] = useState(target?.list_id ?? lists[0]?.id ?? 0), [armyId, setArmyId] = useState(target?.army_id ?? initialArmyId);
    const army = armies.find(army => army.id === armyId);
    const [enabled, setEnabled] = useState(target?.enabled ?? false), [interval, setInterval] = useState(target?.interval_seconds ?? 300);
    const [quantities, setQuantities] = useState(() => Object.fromEntries(UNIT_TYPES.map(unit => [unit, String((target?.troops ?? lists[0]?.troops ?? emptyTroops)[unit] ?? 0)])) as Record<keyof ArmyTroops, string>);
    useEffect(() => { if (!listId && lists.length) setListId(lists[0].id); }, [lists, listId]);
    const troops = Object.fromEntries(UNIT_TYPES.map(unit => [unit, Number(quantities[unit])])) as ArmyTroops;
    const valid = !!army && lists.some(list => list.id === listId) && UNIT_TYPES.every(unit => quantities[unit].trim() && Number.isSafeInteger(troops[unit]) && (troops[unit] ?? 0) >= 0) && rosterTotal(troops) > 0 && rosterTotal(troops) <= 1000;
    const faction = armyFaction(world, army);
    const list = lists.find(list => list.id === listId);
    return <Modal title={target ? 'Edit farm target' : 'Add to farm list'} className="march-dialog campaign-farm-dialog" onClose={onClose}>
        <p><strong>{camp.name}</strong> ({Math.floor(camp.x / CELL_SIZE)} | {Math.floor(camp.y / CELL_SIZE)})</p>
        <form className="campaign-farm-form" onSubmit={event => { event.preventDefault(); if (!valid || busy) return; run({ type: 'saveCampaignFarm', id: target?.id, listId, armyId, campId: camp.id, troops, enabled, intervalSeconds: interval }, 'Farm target saved.'); onClose(); }}>
            <label>Farm list<select aria-label="Farm list" value={listId} onChange={event => { const id = Number(event.target.value); setListId(id); if (!target) { const preset = lists.find(item => item.id === id)?.troops ?? emptyTroops; setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(preset[unit] ?? 0)])) as Record<keyof ArmyTroops, string>); } }}>{!lists.length && <option value={0}>Create a list below</option>}{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            <label>Legion<select aria-label="Farm legion" value={armyId} onChange={event => setArmyId(Number(event.target.value))}>{armies.map(army => <option key={army.id} value={army.id}>{army.name}</option>)}</select></label>
            <fieldset className="march-troops"><legend>Saved troop preset</legend>{UNIT_TYPES.map(unit => <label key={unit}><TroopIcon faction={faction} unit={unit} /><span>{factionTroopName(faction, unit)}<small>{(army ? readRoster(army)[unit] : 0)} currently in this legion</small></span><input type="number" min={0} max={1000} step={1} aria-label={`${factionTroopName(faction, unit)} farm quantity`} value={quantities[unit]} onChange={event => setQuantities(previous => ({ ...previous, [unit]: event.target.value }))} /></label>)}</fieldset>
            {list && rosterTotal(list.troops) > 0 && <button className="button outline" type="button" onClick={() => setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(list.troops[unit] ?? 0)])) as Record<keyof ArmyTroops, string>)}>Use list troop preset</button>}
            <label><span><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Repeat automatically</span></label>{enabled && <label>Repeat interval (seconds)<input aria-label="Repeat interval" type="number" min={60} max={86400} step={1} value={interval} onChange={event => setInterval(Number(event.target.value))}/></label>}
            <p className="march-muted" title="Unavailable legions skip that interval. Training, owned stations and troop capacity are still checked.">Start this target manually once to establish its repeat route. Shared-world repeats continue while you are offline; solo repeats resume when you open the campaign.</p>
            <p className="march-muted">Saving a target sends no troops. Choose Prepare raid from your list to review the available legion and confirm departure.</p>
            <div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" disabled={busy || !valid || !Number.isSafeInteger(interval) || interval < 60 || interval > 86400}>Save target</button></div>
        </form>
        <details className="campaign-new-list" open={!lists.length}><summary>Create a new farm list</summary><CreateList run={run} busy={busy} /></details>
    </Modal>;
}

function EditList({list,world,playerId,busy,run,onClose}:Props & {list:CampaignFarmList}) {
 const [name,setName]=useState(list.name),[losses,setLosses]=useState(list.casualties_only),[troops,setTroops]=useState(list.troops);
 const faction=world.settlements.find(city=>city.owner_id===playerId)?.faction??'roman';
 const valid=UNIT_TYPES.every(unit=>Number.isSafeInteger(troops[unit]??0)&&(troops[unit]??0)>=0)&&rosterTotal(troops)<=1000;
 return <Modal title="Edit farm list" className="march-dialog campaign-farm-dialog" onClose={onClose}><form className="campaign-farm-form" onSubmit={event=>{event.preventDefault();if(!valid||busy)return;run({type:'saveCampaignFarmList',id:list.id,name,troops,casualtiesOnly:losses},'Farm list updated.');onClose();}}>
  <label>List name<input aria-label="Farm list name" maxLength={40} value={name} onChange={event=>setName(event.target.value)}/></label>
  <fieldset className="march-troops"><legend>Default troop preset for new targets</legend>{UNIT_TYPES.map(unit=><label key={unit}><TroopIcon faction={faction} unit={unit}/><span>{factionTroopName(faction,unit)}</span><input aria-label={`${factionTroopName(faction,unit)} default quantity`} type="number" min={0} max={1000} value={troops[unit]??0} onChange={event=>setTroops(previous=>({...previous,[unit]:Number(event.target.value)}))}/></label>)}</fieldset>
  <label><span><input type="checkbox" checked={losses} onChange={event=>setLosses(event.target.checked)}/> Show only reports with troop losses</span></label><p className="march-muted">Existing target parties keep their own presets. Edit a target to move it to a different list.</p>
  <div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" disabled={busy||!valid||name.trim().length<2}>Save list</button></div>
 </form></Modal>;
}

export function CampaignFarmLists({ world, playerId, busy, now, run, onClose, onRaid, onEdit, onLocate }: Props & {
    now: number;
    onRaid: (target: CampaignFarmTarget) => void; onEdit: (target: CampaignFarmTarget) => void; onLocate: (camp: Camp) => void;
}) {
    const [editId,setEditId]=useState<number|null>(null),[sort,setSort]=useState('name');
    const [reviewId, setReviewId] = useState<number | null>(null);
    const lists = (world.campaign_farm_lists ?? []).filter(list => list.owner_id === playerId);
    const farms = (world.campaign_farms ?? []).filter(farm => farm.owner_id === playerId);
    const editing=lists.find(list=>list.id===editId);
    if(editing)return <EditList list={editing} world={world} playerId={playerId} busy={busy} run={run} onClose={()=>setEditId(null)}/>;
    const latest=(farm:CampaignFarmTarget)=>world.reports.filter(report=>report.camp_id===farm.camp_id||world.battles.some(battle=>battle.id===report.battle_id&&battle.camp_id===farm.camp_id)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
    const compare=(a:CampaignFarmTarget,b:CampaignFarmTarget)=>{
     const campA=world.camps.find(c=>c.id===a.camp_id),campB=world.camps.find(c=>c.id===b.camp_id),armyA=world.armies.find(army=>army.id===a.army_id),armyB=world.armies.find(army=>army.id===b.army_id);
     const distance=(camp:Camp|undefined,army:typeof armyA)=>camp&&army?Math.hypot(wrappedWorldDelta(army.target_x,camp.x),wrappedWorldDelta(army.target_y,camp.y)):Infinity;
     const ra=latest(a),rb=latest(b),bounty=(reports:typeof ra)=>reports.reduce((sum,r)=>sum+Object.values(r.result.loot).reduce((n,value)=>n+value,0),0);
     return (sort==='distance'?distance(campA,armyA)-distance(campB,armyB):sort==='result'?Number(rb[0]?.won??false)-Number(ra[0]?.won??false):sort==='lastRaid'?(Date.parse(rb[0]?.created_at??'1970-01-01')-Date.parse(ra[0]?.created_at??'1970-01-01')):sort==='bounty'?bounty(rb.slice(0,1))-bounty(ra.slice(0,1)):sort==='totalBounty'?bounty(rb)-bounty(ra):sort==='nextAttack'?(Date.parse(a.next_at??'9999-01-01')-Date.parse(b.next_at??'9999-01-01')):(campA?.name??'').localeCompare(campB?.name??''))||a.id-b.id;
    };
    const review = lists.find(list => list.id === reviewId);
    if (review) {
        const targets = farms.filter(farm => farm.list_id === review.id).sort((a, b) => a.id - b.id);
        return <Modal title={`Start farm list: ${review.name}`} className="march-dialog campaign-farm-dialog" onClose={() => setReviewId(null)}>
            <p>Send one batch using these saved troop presets.</p>
            <div className="campaign-batch-review">{targets.map(target => {
                const camp = world.camps.find(camp => camp.id === target.camp_id), army = world.armies.find(army => army.id === target.army_id);
                return <article key={target.id}><strong>{camp?.name ?? 'Camp unavailable'}</strong><small>{army?.name ?? 'Legion unavailable'}</small><TroopSummary troops={target.troops} faction={armyFaction(world, army)}/></article>;
            })}</div>
            <p className="march-muted">Each legion can launch one raid at a time. Targets are checked in the order above; busy legions, insufficient troops and regrouping camps are skipped. Repeated clicks never create troops.</p>
            <p className="march-muted">Confirmed orders wait 30 seconds before departure. You can cancel each order during that window.</p>
            <div className="march-actions"><button className="button outline" disabled={busy} onClick={() => setReviewId(null)}>Back</button><button className="button gold" disabled={busy || !targets.length} onClick={() => { run({ type: 'startCampaignFarmList', id: review.id }, 'Farm list processed. Available legions are preparing; unavailable targets were skipped.'); setReviewId(null); }}>Confirm batch</button></div>
        </Modal>;
    }
    return <Modal title="Farm lists" className="march-dialog campaign-farm-dialog" onClose={onClose}>
        <p className="march-muted">Save camp targets and troop presets. Start a list to review a manual batch, or prepare one target separately.</p>
        <CreateList run={run} busy={busy} /><label className="campaign-sort">Sort targets<select aria-label="Sort farm targets" value={sort} onChange={event=>setSort(event.target.value)}><option value="name">Name</option><option value="distance">Distance</option><option value="result">Combat result</option><option value="lastRaid">Last raid</option><option value="bounty">Last bounty</option><option value="totalBounty">Total bounty in loaded reports</option><option value="nextAttack">Next attack</option></select></label>
        {!lists.length && <p>No lists yet. Create one, then choose a camp on the map and select Add to farm list.</p>}
        <div className="campaign-farm-lists">{lists.map(list => {
            const targets = farms.filter(farm => farm.list_id === list.id).sort(compare);
            return <details key={list.id} open className="campaign-farm-list"><summary><strong>{list.name}</strong><span>{targets.length} targets</span></summary>
                <div className="campaign-list-start"><button className="button outline" disabled={busy} onClick={()=>setEditId(list.id)}>Edit list</button>{!!targets.length && <><small title="A legion carries one party at a time. Give different targets different legions to send more raids together.">One raid per available legion</small><button className="button gold" disabled={busy} title="Review and send a batch using each target's saved troop preset" onClick={() => setReviewId(list.id)}>Start list</button></>}</div>
                {!targets.length && <div className="campaign-farm-empty"><p>Select a camp on the map to add a target.</p><button className="button outline" disabled={busy} onClick={() => run({ type: 'deleteCampaignFarmList', id: list.id }, 'Empty farm list removed.')}>Delete empty list</button></div>}
                {targets.map(target => {
                    const camp = world.camps.find(camp => camp.id === target.camp_id), army = world.armies.find(army => army.id === target.army_id);
                    if (!camp) return null;
                    const cancelling = army?.status === 'moving' && army.raid_target_id === camp.id && !!army.march_sent_at && !!army.march_cancel_until && Date.parse(army.march_cancel_until) > now;
                    return <article key={target.id} className="campaign-farm-target"><button className="campaign-farm-name" title="Show this target on the map" onClick={() => onLocate(camp)}>{camp.name} ({Math.floor(camp.x / CELL_SIZE)} | {Math.floor(camp.y / CELL_SIZE)})</button><small>{army?.name ?? 'Legion unavailable'}{army?.status === 'moving' ? cancelling ? ' · Preparing' : ' · Travelling' : ''}{target.enabled ? ` · Repeats every ${target.interval_seconds ?? 300}s` : ''}{target.last_status ? ` · ${target.last_status}` : ''}</small><TroopSummary troops={target.troops} faction={armyFaction(world, army)}/><div><button className="button gold" disabled={busy || !army || army.status === 'moving'} onClick={() => onRaid(target)}>Prepare raid</button>{cancelling && <button className="button outline" disabled={busy} onClick={() => run({ type: 'cancelMarch', armyId: army!.id, sentAt: army!.march_sent_at! }, 'Raid cancelled. Troops remain at their departure station.')}>Cancel raid ({Math.ceil((Date.parse(army!.march_cancel_until!) - now) / 1000)}s)</button>}<button className="button outline" disabled={busy} onClick={() => onEdit(target)}>Edit</button><button className="button outline" disabled={busy} onClick={() => run({ type: 'deleteCampaignFarm', id: target.id }, 'Saved target removed.')}>Remove</button></div></article>;
                })}
            </details>;
        })}</div>
    </Modal>;
}
