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
import {captureCultureReason} from '../../city/domain/conquest';
import {cultureCost,expansionCount,liveCulture} from '../../empire/domain/expansion';
import {visibleRecruitUnits} from '../../army/ui/visibleRecruitUnits';
import {scoutMissionReason,scoutingSpeed} from '../../scouting/domain/scouting';

export type MarchDestination = { kind: 'raid'; campId: number } | {kind:'raidCity';cityId:number;capture?:boolean} | { kind: 'move'; x: number; y: number; label: string };

/** Review a real legion allocation before emitting a single authoritative order. */
export function MarchDialog({ world, playerId, now, busy, initialArmyId, destination, initialTroops, run, onClose, onArmy }: {
    world: World; playerId: string; now: number; busy: boolean; initialArmyId: number;
    destination: MarchDestination; initialTroops?: ArmyTroops;
    run: (command: Command, message?: string) => void; onClose: () => void; onArmy?: (id: number) => void;
}) {
    const armies = world.armies.filter(army => army.owner_id === playerId);
    const supportedUnits=visibleRecruitUnits(world),captureMode=destination.kind==='raidCity'&&destination.capture;
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
    const troops = Object.fromEntries(supportedUnits.map(unit => [unit, Number(quantities[unit])])) as ArmyTroops;
    const valid = supportedUnits.every(unit => quantities[unit].trim() !== '' && Number.isSafeInteger(troops[unit]) && (troops[unit] ?? 0) >= 0 && (troops[unit] ?? 0) <= ((chosen ? readRoster(chosen)[unit] : 0)));
    const scoutingParty=world.scouting_version===1&&destination.kind!=='move'&&valid&&(troops.scout??0)>0&&rosterTotal(troops)===(troops.scout??0);
    const training = world.orders.some(order => order.owner_id === playerId && order.kind === 'recruit' && (order.army_id ?? armies[0]?.id) === armyId);
    const battle = chosen?.raid_target_id != null || chosen?.raid_city_id!=null || world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === playerId || battle.defender_owner_id === playerId));
    const cooldown = camp && !camp.bandit && world.progress.find(progress => progress.owner_id === playerId && progress.camp_id === camp.id);
    const station = position ? garrisonAt(world, playerId, position) : undefined;
    const originOwned = !!position && ownedStation(world, playerId, position);
    const partialParty = chosen && UNIT_TYPES.some(unit => (troops[unit] ?? 0) < readRoster(chosen)[unit]);
    const persuading=destination.kind==='raidCity'&&(troops.diplomat??0)>0;
    const cultureReason=(captureMode||persuading)?captureCultureReason(world,playerId,now):null;
    const captureReason=captureMode&&world.conquest_version!==1?'This server does not support city capture.':captureMode&&!(troops.diplomat??0)?'Select at least one diplomat to capture a city.':cultureReason;
    const reason = scoutingParty?scoutMissionReason(world,playerId,armyId,destination.kind==='raid'?{campId:destination.campId}:destination.kind==='raidCity'?{cityId:destination.cityId}:{},troops.scout??0,'resources',now)??'':captureReason || (!chosen ? 'Choose one of your legions.' : chosen.status === 'moving' ? 'This legion already has a march in progress.' : battle ? 'This legion is in battle.' : training ? 'Training must finish before this legion leaves.' : destination.kind !== 'move' && !originOwned ? 'Bring this legion to your village or an owned field before attacking.' : destination.kind === 'move' && target && !ownedStation(world, playerId, target) ? 'Reinforcements can only stop at your village or an owned field.' : destination.kind === 'move' && partialParty && !originOwned ? 'Bring this legion to an owned station before leaving troops behind.' : !valid ? 'Enter whole troop quantities up to the available amount.' : rosterTotal(troops) === 0 ? 'Choose at least one troop.' : !target || !route ? 'No connected land route is available.' : cooldown && Date.parse(cooldown.available_at) > now ? 'This camp is still regrouping.' : '');
    const faction = chosen?.faction ?? world.settlements.find(city => city.id === chosen?.home_settlement_id)?.faction ?? 'roman';
    const travel = chosen && route && valid ? Math.max(2, route.distance / (scoutingParty?scoutingSpeed(world,playerId):marchSpeed(world, chosen, troops))) : null;
    const capacity = valid ? carryingCapacity(troops) : null, replacementValue = valid ? troopCost(troops, worldBalanceVersion(world)) : null;
    return <Modal title={scoutingParty?'Prepare scouting mission':captureMode?'Prepare city capture':destination.kind === 'raid' ? 'Prepare camp raid' : destination.kind==='raidCity'?'Prepare city raid':'Prepare march'} heading={false} className="march-dialog march-compact" backdropClassName="march-compact-backdrop" onClose={onClose}>
        <header className="march-compact-heading"><Icon name={scoutingParty?'focus':captureMode?'crown':destination.kind==='move'?'flag':'army'} size={20}/><div><h2>{scoutingParty?'Scouting mission':captureMode?'Capture city':destination.kind==='move'?'March':'Raid'}</h2><p>{label} {target&&<small>({Math.floor(target.x/CELL_SIZE)} | {Math.floor(target.y/CELL_SIZE)})</small>}</p></div></header>
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
            {camp&&!scoutingParty&&<p className="march-camp-level">Level {camp.tier} · {campDifficultyLabel(camp.tier)} · {campLootRarity(camp.tier)} artifact on victory</p>}
            {city&&!scoutingParty&&<p className="march-camp-level">City raid · Defence is automatic</p>}
            {station && soldierTotal(station) > 0 && <details className="march-station"><summary>{soldierTotal(station)} stationed troops</summary><TroopSummary troops={readRoster(station)} faction={faction}/><button type="button" className="button outline" disabled={busy || training || battle || !chosen || chosen.status !== 'idle' || soldierTotal(chosen) >= 1000} onClick={() => run({ type: 'collectGarrison', armyId }, 'Stationed troops joined this legion.')}>Merge stationed troops</button></details>}
            <MarchTroopPicker faction={faction} allowDiplomats={world.conquest_version===1} available={chosen?readRoster(chosen):Object.fromEntries(UNIT_TYPES.map(unit=>[unit,0])) as ReturnType<typeof readRoster>} quantities={quantities as Record<keyof ReturnType<typeof readRoster>,string>} onChange={setQuantities}/>
            {scoutingParty&&<section className="march-conquest" aria-label="Scouting mission"><strong>Resources and troops</strong><p>Only scouts are selected, so this order gathers intelligence. Commander and other troops remain with the legion. Scouts take no loot. Use the map's Scout action to choose defences instead.</p></section>}
            {city&&!scoutingParty&&world.conquest_version===1&&(captureMode||persuading)&&<section className="march-conquest" aria-label="Capture review"><strong>{persuading?'This attack attempts to capture the city.':'Diplomats required'}</strong><p>Loyalty is private. Each surviving participating diplomat lowers loyalty by 1, up to 25 per attack, after you defeat the defenders. Diplomats can die during that battle.</p><dl><div><dt>Maximum loyalty reduction</dt><dd>{Math.min(25,Math.max(0,troops.diplomat??0))}</dd></div><div><dt>Culture required</dt><dd>{cultureCost(expansionCount(world,playerId)).toLocaleString()} <small>({Math.floor(liveCulture(world,playerId,now)).toLocaleString()} available)</small></dd></div></dl><p>Culture is checked again after battle and spent only on capture. At zero loyalty, one diplomat establishes your government; survivors occupy the city. Loyalty recovers by 25 per game hour.</p></section>}
            {city&&!!troops.catapult&&<label className="march-siege-target"><Icon name="town" size={16}/><span>Catapults</span><select aria-label="Catapult target" value={siegeTarget} onChange={event=>setSiegeTarget(event.target.value as SiegeTarget)}>{Object.entries(SIEGE_TARGETS).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>}
            {city&&!!troops.ram&&<p className="march-camp-level"><Icon name="shield" size={13}/> Rams target walls</p>}
            {!scoutingParty&&<details className="march-trip-details"><summary>Trip details<Icon name="chevron" size={12}/></summary><div className="march-economics" aria-label="Party travel and resources"><dl><div><dt>Land route</dt><dd>{route ? `${(route.distance / CELL_SIZE).toFixed(2)} fields` : 'Unavailable'}</dd></div><div><dt>Carrying capacity</dt><dd>{capacity === null ? '—' : capacity.toLocaleString()}</dd></div>{destination.kind !== 'move' && <div><dt>Out &amp; back estimate</dt><dd>{travel === null ? '—' : clock(travel * 2 + 30, world.game_clock?.rate ?? 1)}</dd></div>}</dl>{replacementValue && <div className="march-party-value"><span>Party replacement value</span><Cost cost={replacementValue} compact showZero/></div>}</div><p className="march-muted">Unsent troops stay at this station. {destination.kind==='move'?'Selected troops stay at their destination.':'Survivors return here; loot is delivered to their home city.'}{city&&' Surviving engines can remove up to two levels after a victory. Higher levels need more engines.'}</p></details>}
            {reason && <p className="march-error" role="status">{reason}</p>}
          </div>
            <div className="march-review"><span title="Troops selected">Sending<strong>{valid ? rosterTotal(troops).toLocaleString() : '—'}</strong></span><span title="One-way journey after departure">Travel<strong>{travel === null ? 'No route' : clock(travel, world.game_clock?.rate ?? 1)}</strong></span><span title={scoutingParty?'Intelligence requested':'Maximum resources carried by this party'}>{scoutingParty?'Report':'Carry'}<strong>{scoutingParty?'Resources + troops':capacity?.toLocaleString()??'Unavailable'}</strong></span></div>
          <footer className="march-compact-footer"><small>Cancel within 30s of sending</small><div className="march-actions"><button type="button" className="button outline" onClick={onClose}>Back</button><button className="button gold" type="submit" disabled={busy || !!reason}>{busy ? 'Sending…' : scoutingParty?'Confirm scouting':captureMode?'Confirm capture':destination.kind !== 'move' ? 'Confirm raid' : 'Confirm march'}<Icon name="arrow" size={16} /></button></div></footer>
        </form>
    </Modal>;
}
