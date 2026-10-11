import { campLootRarity } from '../../heroes/domain/artifacts';
import { campDifficultyLabel } from '../domain/campDifficulty';
import { useMemo, useState } from 'react';
import type { ArmyTroops } from '../../army/domain/types';
import { soldierTotal } from '../../army/domain/units';
import { RECRUIT_UNITS as UNIT_TYPES, readRoster, rosterTotal } from '../../army/domain/roster';
import { carryingCapacity, troopCost } from '../../frontier/domain/balance';
import { TroopSummary } from '../../army/ui/TroopSummary';
import { marchSpeed } from '../domain/commands';
import { FACTIONS } from '../../factions/domain/factions';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Cost, Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { armyPosition } from '../domain/movement';
import { findMarchPath } from '../domain/pathfinding';
import { CELL_SIZE } from '../domain/dimensions';
import { garrisonAt, ownedStation } from '../domain/garrisons';

export type MarchDestination = { kind: 'raid'; campId: number } | { kind: 'move'; x: number; y: number; label: string };

/** Review a real legion allocation before emitting a single authoritative order. */
export function MarchDialog({ world, playerId, now, busy, initialArmyId, destination, initialTroops, run, onClose, onArmy }: {
    world: World; playerId: string; now: number; busy: boolean; initialArmyId: number;
    destination: MarchDestination; initialTroops?: ArmyTroops;
    run: (command: Command, message?: string) => void; onClose: () => void; onArmy?: (id: number) => void;
}) {
    const armies = world.armies.filter(army => army.owner_id === playerId);
    const [armyId, setArmyId] = useState(initialArmyId);
    const chosen = armies.find(army => army.id === armyId);
    const [quantities, setQuantities] = useState(() => Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(initialTroops?.[unit] ?? (chosen ? readRoster(chosen)[unit] : 0))])) as Record<keyof ArmyTroops, string>);
    const camp = destination.kind === 'raid' ? world.camps.find(camp => camp.id === destination.campId) : undefined;
    const target = destination.kind === 'raid' ? camp : destination;
    const label = destination.kind === 'raid' ? camp?.name ?? 'Unavailable camp' : destination.label;
    const position = chosen ? armyPosition(chosen, now) : undefined;
    const route = useMemo(() => position && target ? findMarchPath(position, target) : null,
        [chosen?.id, chosen?.start_x, chosen?.start_y, chosen?.target_x, chosen?.target_y, chosen?.departure_at, chosen?.arrival_at, chosen?.status, target?.x, target?.y]);
    const troops = Object.fromEntries(UNIT_TYPES.map(unit => [unit, Number(quantities[unit])])) as ArmyTroops;
    const valid = UNIT_TYPES.every(unit => quantities[unit].trim() !== '' && Number.isSafeInteger(troops[unit]) && (troops[unit] ?? 0) >= 0 && (troops[unit] ?? 0) <= ((chosen ? readRoster(chosen)[unit] : 0)));
    const training = world.orders.some(order => order.owner_id === playerId && order.kind === 'recruit' && (order.army_id ?? armies[0]?.id) === armyId);
    const battle = chosen?.raid_target_id !== null && chosen?.raid_target_id !== undefined || world.battles.some(battle => battle.status === 'active' && (battle.attacker_army_id === armyId || battle.defender_army_id === armyId));
    const cooldown = camp && !camp.bandit && world.progress.find(progress => progress.owner_id === playerId && progress.camp_id === camp.id);
    const station = position ? garrisonAt(world, playerId, position) : undefined;
    const originOwned = !!position && ownedStation(world, playerId, position);
    const partialParty = chosen && UNIT_TYPES.some(unit => (troops[unit] ?? 0) < readRoster(chosen)[unit]);
    const reason = !chosen ? 'Choose one of your legions.' : chosen.status === 'moving' ? 'This legion already has a march in progress.' : battle ? 'This legion is in battle.' : training ? 'Training must finish before this legion leaves.' : destination.kind === 'raid' && !originOwned ? 'Bring this legion to your village or an owned field before attacking.' : destination.kind === 'move' && target && !ownedStation(world, playerId, target) ? 'Reinforcements can only stop at your village or an owned field.' : destination.kind === 'move' && partialParty && !originOwned ? 'Bring this legion to an owned station before leaving troops behind.' : !valid ? 'Enter whole troop quantities up to the available amount.' : rosterTotal(troops) === 0 ? 'Choose at least one troop.' : !target || !route ? 'No connected land route is available.' : cooldown && Date.parse(cooldown.available_at) > now ? 'This camp is still regrouping.' : '';
    const faction = chosen?.faction ?? world.settlements.find(city => city.id === chosen?.home_settlement_id)?.faction ?? 'roman';
    const travel = chosen && route && valid ? Math.max(2, route.distance / marchSpeed(world, chosen, troops)) : null;
    const capacity = valid ? carryingCapacity(troops) : null, replacementValue = valid ? troopCost(troops) : null;
    return <Modal title={destination.kind === 'raid' ? 'Prepare camp raid' : 'Prepare march'} className="march-dialog" onClose={onClose}>
        <p className="march-destination"><Icon name="flag" size={18} /><strong>{label}</strong>{target && <small>({Math.floor(target.x / CELL_SIZE)} | {Math.floor(target.y / CELL_SIZE)})</small>}</p>
        {camp && <p className="march-muted">Level {camp.tier} · {campDifficultyLabel(camp.tier)} · {campLootRarity(camp.tier)} artifact on victory</p>}
        <form onSubmit={event => {
            event.preventDefault(); if (reason || busy || !chosen) return;
            run(destination.kind === 'raid' ? { type: 'raid', campId: destination.campId, armyId, troops } : { type: 'move', armyId, x: destination.x, y: destination.y, troops }, `${chosen.name}: order confirmed. You can cancel for 30 seconds.`);
            onArmy?.(armyId); onClose();
        }}>
            <label className="march-select">Choose legion<select aria-label="Choose legion" value={armyId} onChange={event => {
                const id = Number(event.target.value), army = armies.find(army => army.id === id);
                setArmyId(id); setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String((army ? readRoster(army)[unit] : 0))])) as Record<keyof ArmyTroops, string>);
            }}>{armies.map(army => <option key={army.id} value={army.id}>{army.name} · {soldierTotal(army)} troops{army.status === 'moving' ? ' · Marching' : ''}</option>)}</select></label>
            <p className="march-muted">{FACTIONS[faction].name} · {world.settlements.find(city => city.id === chosen?.home_settlement_id)?.name}</p>
            {station && soldierTotal(station) > 0 && <div className="march-station"><p>{soldierTotal(station)} troops are stationed here.</p><TroopSummary troops={readRoster(station)} faction={faction}/><button type="button" className="button outline" disabled={busy || training || battle || !chosen || chosen.status !== 'idle' || soldierTotal(chosen) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId }, 'Stationed troops joined this legion.')}>Merge stationed troops</button></div>}
            <fieldset className="march-troops"><legend>Troops to send</legend>{UNIT_TYPES.map(unit => <label key={unit} title={`${factionTroopName(faction, unit)}: ${(chosen ? readRoster(chosen)[unit] : 0)} available. Unsent soldiers remain at this owned station.`}>
                <TroopIcon faction={faction} unit={unit} /><span>{factionTroopName(faction, unit)}<small>{(chosen ? readRoster(chosen)[unit] : 0)} available{valid ? ` · ${((chosen ? readRoster(chosen)[unit] : 0)) - (troops[unit] ?? 0)} stay behind` : ''}</small></span>
                <input aria-label={`${factionTroopName(faction, unit)} to send`} type="number" min={0} max={(chosen ? readRoster(chosen)[unit] : 0)} step={1} value={quantities[unit]} onChange={event => setQuantities(previous => ({ ...previous, [unit]: event.target.value }))} />
            </label>)}</fieldset>
            {chosen && <button className="button outline" type="button" onClick={() => setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(readRoster(chosen)[unit])])) as Record<keyof ArmyTroops, string>)}>Use all legion troops</button>}
            <div className="march-review"><span>Sending<strong>{valid ? rosterTotal(troops) : '—'} troops</strong></span><span>Departure<strong>After 30 seconds</strong></span><span>Travel<strong>{travel === null ? 'No route' : clock(travel)}</strong></span></div>
            <div className="march-economics" aria-label="Party travel and resources"><dl><div title="Connected land route, including detours around unwalkable terrain."><dt>Land route</dt><dd>{route ? `${(route.distance / CELL_SIZE).toFixed(2)} fields` : 'Unavailable'}</dd></div><div title="Maximum resources this selected party can carry. Casualties can reduce the amount brought home."><dt>Carrying capacity</dt><dd>{capacity === null ? '—' : capacity.toLocaleString()}</dd></div>{destination.kind === 'raid' && <div title="Outbound and return travel plus the 30-second departure window. Battle duration and changes to survivor speed are excluded."><dt>Out &amp; back estimate</dt><dd>{travel === null ? '—' : clock(travel * 2 + 30)}</dd></div>}</dl>{replacementValue && <div className="march-party-value" title="Full recruitment value of the selected soldiers, not an additional raid fee or a prediction of casualties."><span>Party replacement value</span><Cost cost={replacementValue} compact showZero/></div>}</div>
            <p className="march-muted">You can cancel during the first 30 seconds. The army waits for that window, then leaves. {destination.kind === 'raid' && 'Unsent troops remain stationed here and can join another legion. Raiders return here and automatically merge with troops still present, up to the legion capacity.'}</p>
            {reason && <p className="march-error" role="status">{reason}</p>}
            <div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" type="submit" disabled={busy || !!reason}>{busy ? 'Sending…' : destination.kind === 'raid' ? 'Confirm raid' : 'Confirm march'}<Icon name="arrow" size={16} /></button></div>
        </form>
    </Modal>;
}
