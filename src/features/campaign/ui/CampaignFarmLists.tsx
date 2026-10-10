import { useEffect, useState } from 'react';
import type { ArmyTroops } from '../../army/domain/types';
import { UNIT_TYPES, soldierTotal } from '../../army/domain/units';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Camp } from '../../map/domain/types';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { Modal } from '../../../shared/ui/Shared';
import type { CampaignFarmTarget } from '../domain/types';
import '../styles/farms.css';

type Props = { world: World; playerId: string; busy: boolean; run: (command: Command, message?: string) => void; onClose: () => void };
const emptyTroops = { infantry: 0, archers: 0, cavalry: 0 };

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
    const [quantities, setQuantities] = useState(() => Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(target?.troops[unit] ?? army?.[unit] ?? 0)])) as Record<keyof ArmyTroops, string>);
    useEffect(() => { if (!listId && lists.length) setListId(lists[0].id); }, [lists, listId]);
    const troops = Object.fromEntries(UNIT_TYPES.map(unit => [unit, Number(quantities[unit])])) as ArmyTroops;
    const valid = !!army && lists.some(list => list.id === listId) && UNIT_TYPES.every(unit => quantities[unit].trim() && Number.isSafeInteger(troops[unit]) && troops[unit] >= 0) && soldierTotal(troops) > 0 && soldierTotal(troops) <= 1000;
    const faction = army?.faction ?? world.settlements.find(city => city.id === army?.home_settlement_id)?.faction ?? 'roman';
    const list = lists.find(list => list.id === listId);
    return <Modal title={target ? 'Edit farm target' : 'Add to farm list'} className="march-dialog campaign-farm-dialog" onClose={onClose}>
        <p><strong>{camp.name}</strong> ({Math.floor(camp.x / CELL_SIZE)} | {Math.floor(camp.y / CELL_SIZE)})</p>
        <form className="campaign-farm-form" onSubmit={event => { event.preventDefault(); if (!valid || busy) return; run({ type: 'saveCampaignFarm', id: target?.id, listId, armyId, campId: camp.id, troops }, 'Farm target saved.'); onClose(); }}>
            <label>Farm list<select aria-label="Farm list" value={listId} onChange={event => setListId(Number(event.target.value))}>{!lists.length && <option value={0}>Create a list below</option>}{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            <label>Legion<select aria-label="Farm legion" value={armyId} onChange={event => setArmyId(Number(event.target.value))}>{armies.map(army => <option key={army.id} value={army.id}>{army.name}</option>)}</select></label>
            <fieldset className="march-troops"><legend>Saved troop preset</legend>{UNIT_TYPES.map(unit => <label key={unit}><TroopIcon faction={faction} unit={unit} /><span>{factionTroopName(faction, unit)}<small>{army?.[unit] ?? 0} currently in this legion</small></span><input type="number" min={0} max={1000} step={1} aria-label={`${factionTroopName(faction, unit)} farm quantity`} value={quantities[unit]} onChange={event => setQuantities(previous => ({ ...previous, [unit]: event.target.value }))} /></label>)}</fieldset>
            {list && soldierTotal(list.troops) > 0 && <button className="button outline" type="button" onClick={() => setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(list.troops[unit])])) as Record<keyof ArmyTroops, string>)}>Use list troop preset</button>}
            <p className="march-muted">Saving a target sends no troops. Choose Prepare raid from your list to review the available legion and confirm departure.</p>
            <div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" disabled={busy || !valid}>Save target</button></div>
        </form>
        <details className="campaign-new-list" open={!lists.length}><summary>Create a new farm list</summary><CreateList run={run} busy={busy} /></details>
    </Modal>;
}

export function CampaignFarmLists({ world, playerId, busy, now, run, onClose, onRaid, onEdit, onLocate }: Props & {
    now: number;
    onRaid: (target: CampaignFarmTarget) => void; onEdit: (target: CampaignFarmTarget) => void; onLocate: (camp: Camp) => void;
}) {
    const [reviewId, setReviewId] = useState<number | null>(null);
    const lists = (world.campaign_farm_lists ?? []).filter(list => list.owner_id === playerId);
    const farms = (world.campaign_farms ?? []).filter(farm => farm.owner_id === playerId);
    const review = lists.find(list => list.id === reviewId);
    if (review) {
        const targets = farms.filter(farm => farm.list_id === review.id).sort((a, b) => a.id - b.id);
        return <Modal title={`Start farm list: ${review.name}`} className="march-dialog campaign-farm-dialog" onClose={() => setReviewId(null)}>
            <p>Send one batch using these saved troop presets.</p>
            <div className="campaign-batch-review">{targets.map(target => {
                const camp = world.camps.find(camp => camp.id === target.camp_id), army = world.armies.find(army => army.id === target.army_id);
                return <article key={target.id}><strong>{camp?.name ?? 'Camp unavailable'}</strong><small>{army?.name ?? 'Legion unavailable'} · {target.troops.infantry} infantry / {target.troops.archers} archers / {target.troops.cavalry} cavalry</small></article>;
            })}</div>
            <p className="march-muted">Each legion can launch one raid at a time. Targets are checked in the order above; busy legions, insufficient troops and regrouping camps are skipped. Repeated clicks never create troops.</p>
            <p className="march-muted">Confirmed orders wait 30 seconds before departure. You can cancel each order during that window.</p>
            <div className="march-actions"><button className="button outline" disabled={busy} onClick={() => setReviewId(null)}>Back</button><button className="button gold" disabled={busy || !targets.length} onClick={() => { run({ type: 'startCampaignFarmList', id: review.id }, 'Farm list processed. Available legions are preparing; unavailable targets were skipped.'); setReviewId(null); }}>Confirm batch</button></div>
        </Modal>;
    }
    return <Modal title="Farm lists" className="march-dialog campaign-farm-dialog" onClose={onClose}>
        <p className="march-muted">Save camp targets and troop presets. Start a list to review a manual batch, or prepare one target separately.</p>
        <CreateList run={run} busy={busy} />
        {!lists.length && <p>No lists yet. Create one, then choose a camp on the map and select Add to farm list.</p>}
        <div className="campaign-farm-lists">{lists.map(list => {
            const targets = farms.filter(farm => farm.list_id === list.id).sort((a, b) => a.id - b.id);
            return <details key={list.id} open className="campaign-farm-list"><summary><strong>{list.name}</strong><span>{targets.length} targets</span></summary>
                {!!targets.length && <div className="campaign-list-start"><small title="A legion carries one party at a time. Give different targets different legions to send more raids together.">One raid per available legion</small><button className="button gold" disabled={busy} title="Review and send a batch using each target's saved troop preset" onClick={() => setReviewId(list.id)}>Start list</button></div>}
                {!targets.length && <div className="campaign-farm-empty"><p>Select a camp on the map to add a target.</p><button className="button outline" disabled={busy} onClick={() => run({ type: 'deleteCampaignFarmList', id: list.id }, 'Empty farm list removed.')}>Delete empty list</button></div>}
                {targets.map(target => {
                    const camp = world.camps.find(camp => camp.id === target.camp_id), army = world.armies.find(army => army.id === target.army_id);
                    if (!camp) return null;
                    const cancelling = army?.status === 'moving' && army.raid_target_id === camp.id && !!army.march_sent_at && !!army.march_cancel_until && Date.parse(army.march_cancel_until) > now;
                    return <article key={target.id} className="campaign-farm-target"><button className="campaign-farm-name" title="Show this target on the map" onClick={() => onLocate(camp)}>{camp.name} ({Math.floor(camp.x / CELL_SIZE)} | {Math.floor(camp.y / CELL_SIZE)})</button><small>{army?.name ?? 'Legion unavailable'} · {target.troops.infantry} infantry / {target.troops.archers} archers / {target.troops.cavalry} cavalry{army?.status === 'moving' ? cancelling ? ' · Preparing' : ' · Travelling' : ''}</small><div><button className="button gold" disabled={busy || !army || army.status === 'moving'} onClick={() => onRaid(target)}>Prepare raid</button>{cancelling && <button className="button outline" disabled={busy} onClick={() => run({ type: 'cancelMarch', armyId: army!.id, sentAt: army!.march_sent_at! }, 'Raid cancelled. Troops remain at their departure station.')}>Cancel raid ({Math.ceil((Date.parse(army!.march_cancel_until!) - now) / 1000)}s)</button>}<button className="button outline" disabled={busy} onClick={() => onEdit(target)}>Edit</button><button className="button outline" disabled={busy} onClick={() => run({ type: 'deleteCampaignFarm', id: target.id }, 'Saved target removed.')}>Remove</button></div></article>;
                })}
            </details>;
        })}</div>
    </Modal>;
}
