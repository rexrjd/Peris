import { useMemo, useState } from 'react';
import type { ArmyTroops } from '../../army/domain/types';
import { UNIT_TYPES, soldierTotal } from '../../army/domain/units';
import { heroBonuses } from '../../heroes/domain/heroes';
import { FACTIONS } from '../../factions/domain/factions';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Modal } from '../../../shared/ui/Shared';
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
    const [quantities, setQuantities] = useState(() => Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(initialTroops?.[unit] ?? chosen?.[unit] ?? 0)])) as Record<keyof ArmyTroops, string>);
    const camp = destination.kind === 'raid' ? world.camps.find(camp => camp.id === destination.campId) : undefined;
    const target = destination.kind === 'raid' ? camp : destination;
    const label = destination.kind === 'raid' ? camp?.name ?? 'Unavailable camp' : destination.label;
    const position = chosen ? armyPosition(chosen, now) : undefined;
    const route = useMemo(() => position && target ? findMarchPath(position, target) : null,
        [chosen?.id, chosen?.start_x, chosen?.start_y, chosen?.target_x, chosen?.target_y, chosen?.departure_at, chosen?.arrival_at, chosen?.status, target?.x, target?.y]);
    const troops = Object.fromEntries(UNIT_TYPES.map(unit => [unit, destination.kind === 'move' ? chosen?.[unit] ?? 0 : Number(quantities[unit])])) as ArmyTroops;
    const valid = UNIT_TYPES.every(unit => quantities[unit].trim() !== '' && Number.isSafeInteger(troops[unit]) && troops[unit] >= 0 && troops[unit] <= (chosen?.[unit] ?? 0));
    const training = world.orders.some(order => order.owner_id === playerId && order.kind === 'recruit' && (order.army_id ?? armies[0]?.id) === armyId);
    const battle = chosen?.raid_target_id !== null && chosen?.raid_target_id !== undefined || world.battles.some(battle => battle.status === 'active' && (battle.attacker_army_id === armyId || battle.defender_army_id === armyId));
    const cooldown = camp && world.progress.find(progress => progress.owner_id === playerId && progress.camp_id === camp.id);
    const station = position ? garrisonAt(world, playerId, position) : undefined;
    const originOwned = !!position && ownedStation(world, playerId, position);
    const reason = !chosen ? 'Choose one of your legions.' : chosen.status === 'moving' ? 'This legion already has a march in progress.' : battle ? 'This legion is in battle.' : training ? 'Training must finish before this legion leaves.' : destination.kind === 'raid' && !originOwned ? 'Bring this legion to your village or an owned field before attacking.' : destination.kind === 'move' && target && !ownedStation(world, playerId, target) ? 'Reinforcements can only stop at your village or an owned field.' : !valid ? 'Enter whole troop quantities up to the available amount.' : soldierTotal(troops) === 0 ? 'Choose at least one troop.' : !target || !route ? 'No connected land route is available.' : cooldown && Date.parse(cooldown.available_at) > now ? 'This camp is still regrouping.' : '';
    const faction = chosen?.faction ?? world.settlements.find(city => city.id === chosen?.home_settlement_id)?.faction ?? 'roman';
    const travel = chosen && route ? route.distance / (22 * heroBonuses(world, chosen).speed) : null;
    return <Modal title={destination.kind === 'raid' ? 'Prepare camp raid' : 'Prepare march'} className="march-dialog" onClose={onClose}>
        <p className="march-destination"><Icon name="flag" size={18} /><strong>{label}</strong>{target && <small>({Math.floor(target.x / CELL_SIZE)} | {Math.floor(target.y / CELL_SIZE)})</small>}</p>
        <form onSubmit={event => {
            event.preventDefault(); if (reason || busy || !chosen) return;
            run(destination.kind === 'raid' ? { type: 'raid', campId: destination.campId, armyId, troops } : { type: 'move', armyId, x: destination.x, y: destination.y }, `${chosen.name}: order confirmed. You can cancel for 30 seconds.`);
            onArmy?.(armyId); onClose();
        }}>
            <label className="march-select">Choose legion<select aria-label="Choose legion" value={armyId} onChange={event => {
                const id = Number(event.target.value), army = armies.find(army => army.id === id);
                setArmyId(id); setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(army?.[unit] ?? 0)])) as Record<keyof ArmyTroops, string>);
            }}>{armies.map(army => <option key={army.id} value={army.id}>{army.name} · {soldierTotal(army)} troops{army.status === 'moving' ? ' · Marching' : ''}</option>)}</select></label>
            <p className="march-muted">{FACTIONS[faction].name} · {world.settlements.find(city => city.id === chosen?.home_settlement_id)?.name}</p>
            {station && soldierTotal(station) > 0 && <div className="march-station"><p>{soldierTotal(station)} troops are stationed here: {station.infantry} infantry, {station.archers} archers, {station.cavalry} cavalry.</p><button type="button" className="button outline" disabled={busy || training || battle || !chosen || chosen.status !== 'idle' || soldierTotal(chosen) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId }, 'Stationed troops joined this legion.')}>Merge stationed troops</button></div>}
            <fieldset className="march-troops"><legend>{destination.kind === 'raid' ? 'Troops to send' : 'Legion travelling together'}</legend>{UNIT_TYPES.map(unit => <label key={unit} title={`${factionTroopName(faction, unit)}: ${chosen?.[unit] ?? 0} available. Only the chosen raid troops take part in combat.`}>
                <TroopIcon faction={faction} unit={unit} /><span>{factionTroopName(faction, unit)}<small>{chosen?.[unit] ?? 0} available{destination.kind === 'raid' && valid ? ` · ${(chosen?.[unit] ?? 0) - troops[unit]} stay behind` : ''}</small></span>
                <input aria-label={`${factionTroopName(faction, unit)} to send`} type="number" min={0} max={chosen?.[unit] ?? 0} step={1} value={destination.kind === 'move' ? chosen?.[unit] ?? 0 : quantities[unit]} readOnly={destination.kind === 'move'} onChange={event => setQuantities(previous => ({ ...previous, [unit]: event.target.value }))} />
            </label>)}</fieldset>
            {destination.kind === 'raid' && chosen && <button className="button outline" type="button" onClick={() => setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String(chosen[unit])])) as Record<keyof ArmyTroops, string>)}>Use all legion troops</button>}
            <div className="march-review"><span>Sending<strong>{valid ? soldierTotal(troops) : '—'} troops</strong></span><span>Departure<strong>After 30 seconds</strong></span><span>Travel<strong>{travel === null ? 'No route' : clock(travel)}</strong></span></div>
            <p className="march-muted">You can cancel during the first 30 seconds. The army waits for that window, then leaves. {destination.kind === 'raid' && 'Unsent troops remain stationed here and can join another legion. Raiders return here and automatically merge with troops still present, up to the legion capacity.'}</p>
            {reason && <p className="march-error" role="status">{reason}</p>}
            <div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" type="submit" disabled={busy || !!reason}>{busy ? 'Sending…' : destination.kind === 'raid' ? 'Confirm raid' : 'Confirm march'}<Icon name="arrow" size={16} /></button></div>
        </form>
    </Modal>;
}
