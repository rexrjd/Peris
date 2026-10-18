import { campLootRarity } from '../../heroes/domain/artifacts';
import { campDifficultyLabel } from '../domain/campDifficulty';
import { useMemo, useState } from 'react';
import type { ArmyTroops } from '../../army/domain/types';
import { soldierTotal } from '../../army/domain/units';
import { RECRUIT_UNITS as UNIT_TYPES, readRoster, rosterTotal } from '../../army/domain/roster';
import { worldBalanceVersion } from '../../army/domain/unitBalance';
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
import { MarchTroopPicker } from './MarchTroopPicker';
import { SIEGE_TARGETS, type SiegeTarget } from '../../city/domain/siege';

export type MarchDestination = { kind: 'raid'; campId: number } | {kind:'raidCity';cityId:number} | { kind: 'move'; x: number; y: number; label: string };

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
    const city=destination.kind==='raidCity'?world.settlements.find(row=>row.id===destination.cityId&&row.owner_id!==playerId):undefined;
    const [siegeTarget,setSiegeTarget]=useState<SiegeTarget>('auto');
    const target = destination.kind === 'raid' ? camp : destination.kind==='raidCity'?city:destination;
    const label = destination.kind === 'raid' ? camp?.name ?? 'Unavailable camp' : destination.kind==='raidCity'?city?.name??'Unavailable city':destination.label;
    const position = chosen ? armyPosition(chosen, now) : undefined;
    const route = useMemo(() => position && target ? findMarchPath(position, target) : null,
        [chosen?.id, chosen?.start_x, chosen?.start_y, chosen?.target_x, chosen?.target_y, chosen?.departure_at, chosen?.arrival_at, chosen?.status, target?.x, target?.y]);
    const troops = Object.fromEntries(UNIT_TYPES.map(unit => [unit, Number(quantities[unit])])) as ArmyTroops;
    const valid = UNIT_TYPES.every(unit => quantities[unit].trim() !== '' && Number.isSafeInteger(troops[unit]) && (troops[unit] ?? 0) >= 0 && (troops[unit] ?? 0) <= ((chosen ? readRoster(chosen)[unit] : 0)));
    const training = world.orders.some(order => order.owner_id === playerId && order.kind === 'recruit' && (order.army_id ?? armies[0]?.id) === armyId);
    const battle = chosen?.raid_target_id != null || chosen?.raid_city_id!=null || world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === playerId || battle.defender_owner_id === playerId));
    const cooldown = camp && !camp.bandit && world.progress.find(progress => progress.owner_id === playerId && progress.camp_id === camp.id);
    const station = position ? garrisonAt(world, playerId, position) : undefined;
    const originOwned = !!position && ownedStation(world, playerId, position);
    const partialParty = chosen && UNIT_TYPES.some(unit => (troops[unit] ?? 0) < readRoster(chosen)[unit]);
    const reason = !chosen ? 'Choose one of your legions.' : chosen.status === 'moving' ? 'This legion already has a march in progress.' : battle ? 'This legion is in battle.' : training ? 'Training must finish before this legion leaves.' : destination.kind !== 'move' && !originOwned ? 'Bring this legion to your village or an owned field before attacking.' : destination.kind === 'move' && target && !ownedStation(world, playerId, target) ? 'Reinforcements can only stop at your village or an owned field.' : destination.kind === 'move' && partialParty && !originOwned ? 'Bring this legion to an owned station before leaving troops behind.' : !valid ? 'Enter whole troop quantities up to the available amount.' : rosterTotal(troops) === 0 ? 'Choose at least one troop.' : !target || !route ? 'No connected land route is available.' : cooldown && Date.parse(cooldown.available_at) > now ? 'This camp is still regrouping.' : '';
    const faction = chosen?.faction ?? world.settlements.find(city => city.id === chosen?.home_settlement_id)?.faction ?? 'roman';
    const travel = chosen && route && valid ? Math.max(2, route.distance / marchSpeed(world, chosen, troops)) : null;
    const capacity = valid ? carryingCapacity(troops) : null, replacementValue = valid ? troopCost(troops, worldBalanceVersion(world)) : null;
    return <Modal title={destination.kind === 'raid' ? 'Prepare camp raid' : destination.kind==='raidCity'?'Prepare city raid':'Prepare march'} heading={false} className="march-dialog march-compact" backdropClassName="march-compact-backdrop" onClose={onClose}>
        <header className="march-compact-heading"><Icon name={destination.kind==='move'?'flag':'army'} size={20}/><div><h2>{destination.kind==='move'?'March':'Raid'}</h2><p>{label} {target&&<small>({Math.floor(target.x/CELL_SIZE)} | {Math.floor(target.y/CELL_SIZE)})</small>}</p></div></header>
        <form onSubmit={event => {
            event.preventDefault(); if (reason || busy || !chosen) return;
            run(destination.kind === 'raid' ? { type: 'raid', campId: destination.campId, armyId, troops } : destination.kind==='raidCity'?{type:'raidCity',targetCityId:destination.cityId,armyId,troops,siegeTarget}:{ type: 'move', armyId, x: destination.x, y: destination.y, troops }, `${chosen.name}: order confirmed. You can cancel for 30 seconds.`);
            onArmy?.(armyId); onClose();
        }}>
          <div className="march-compact-body">
            <label className="march-select"><Icon name="army" size={17}/><select aria-label="Choose legion" value={armyId} onChange={event => {
                const id = Number(event.target.value), army = armies.find(army => army.id === id);
                setArmyId(id); setQuantities(Object.fromEntries(UNIT_TYPES.map(unit => [unit, String((army ? readRoster(army)[unit] : 0))])) as Record<keyof ArmyTroops, string>);
            }}>{armies.map(army => <option key={army.id} value={army.id}>{army.name} · {soldierTotal(army)} troops{army.status === 'moving' ? ' · Marching' : ''}</option>)}</select></label>
            {camp&&<p className="march-camp-level">Level {camp.tier} · {campDifficultyLabel(camp.tier)} · {campLootRarity(camp.tier)} artifact on victory</p>}
            {city&&<p className="march-camp-level">City raid · Defence is automatic</p>}
            {station && soldierTotal(station) > 0 && <details className="march-station"><summary>{soldierTotal(station)} stationed troops</summary><TroopSummary troops={readRoster(station)} faction={faction}/><button type="button" className="button outline" disabled={busy || training || battle || !chosen || chosen.status !== 'idle' || soldierTotal(chosen) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId }, 'Stationed troops joined this legion.')}>Merge stationed troops</button></details>}
            <MarchTroopPicker faction={faction} available={chosen?readRoster(chosen):Object.fromEntries(UNIT_TYPES.map(unit=>[unit,0])) as ReturnType<typeof readRoster>} quantities={quantities as Record<keyof ReturnType<typeof readRoster>,string>} onChange={setQuantities}/>
            {city&&!!troops.catapult&&<label className="march-siege-target"><Icon name="town" size={16}/><span>Catapults</span><select aria-label="Catapult target" value={siegeTarget} onChange={event=>setSiegeTarget(event.target.value as SiegeTarget)}>{Object.entries(SIEGE_TARGETS).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>}
            {city&&!!troops.ram&&<p className="march-camp-level"><Icon name="shield" size={13}/> Rams target walls</p>}
            <details className="march-trip-details"><summary>Trip details<Icon name="chevron" size={12}/></summary><div className="march-economics" aria-label="Party travel and resources"><dl><div><dt>Land route</dt><dd>{route ? `${(route.distance / CELL_SIZE).toFixed(2)} fields` : 'Unavailable'}</dd></div><div><dt>Carrying capacity</dt><dd>{capacity === null ? '—' : capacity.toLocaleString()}</dd></div>{destination.kind !== 'move' && <div><dt>Out &amp; back estimate</dt><dd>{travel === null ? '—' : clock(travel * 2 + 30)}</dd></div>}</dl>{replacementValue && <div className="march-party-value"><span>Party replacement value</span><Cost cost={replacementValue} compact showZero/></div>}</div><p className="march-muted">Unsent troops stay at this station. {destination.kind==='move'?'Selected troops stay at their destination.':'Survivors return here; loot is delivered to their home city.'}{city&&' Surviving engines can remove up to two levels after a victory. Higher levels need more engines.'}</p></details>
            {reason && <p className="march-error" role="status">{reason}</p>}
          </div>
            <div className="march-review"><span title="Troops selected">Sending<strong>{valid ? rosterTotal(troops).toLocaleString() : '—'}</strong></span><span title="One-way journey after departure">Travel<strong>{travel === null ? 'No route' : clock(travel)}</strong></span><span title="Maximum resources carried by this party">Carry<strong>{capacity?.toLocaleString()??'—'}</strong></span></div>
          <footer className="march-compact-footer"><small>Cancel within 30s of sending</small><div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" type="submit" disabled={busy || !!reason}>{busy ? 'Sending…' : destination.kind !== 'move' ? 'Confirm raid' : 'Confirm march'}<Icon name="arrow" size={16} /></button></div></footer>
        </form>
    </Modal>;
}
