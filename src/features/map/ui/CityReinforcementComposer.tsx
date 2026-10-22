import { useEffect, useMemo, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { cityGarrisonAt } from '../../city/domain/cityGarrison';
import { cityReinforcementRoute, reinforcementSpeed } from '../../city/domain/cityReinforcements';
<<<<<<< Updated upstream
=======
import { findMarchPath } from '../domain/pathfinding';
import { homeArmyPosition } from '../domain/garrisons';
import { supabase } from '../../../platform/backend/supabase';
>>>>>>> Stashed changes
import { readRoster, emptyRoster, RECRUIT_UNITS, rosterTotal, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

<<<<<<< Updated upstream
=======
type GuildTarget = {id:number;name:string;owner_id:string;owner_name:string;x:number;y:number};
type GuildParty = {id:number;status:'outbound'|'stationed'|'returning';owner_id:string;recipient_id:string;source_city:string;target_city:string;troops:Record<string,number>;arrival_at:string|null};
>>>>>>> Stashed changes
/** A dispatch form for permanent garrison troops, hosted by Events on Map and City.
 * Simulation, travel, conservation and offline arrival stay in reinforceCity. */
export function CityReinforcementComposer({ world, owner, busy, run, preferredCityId, onSent }: {
    world: World; owner: string; busy: boolean; preferredCityId?: number;
    run: (command: Command, message?: string) => void; onSent?: () => void;
}) {
    const cities = world.settlements.filter(city => city.owner_id === owner && !city.ruined_at);
<<<<<<< Updated upstream
=======
    const [scope, setScope] = useState<'own'|'guild'>('own');
    const [guildTargets, setGuildTargets] = useState<GuildTarget[]>([]);
    const [guildParties, setGuildParties] = useState<GuildParty[]>([]);
    const [guildTargetId, setGuildTargetId] = useState<number | null>(null);
    const [guildBusy, setGuildBusy] = useState(false);
    const [guildError, setGuildError] = useState('');
    const refreshGuild = async () => {
        const [targets, parties] = await Promise.all([
            supabase.rpc('peris_guild_reinforcement_targets'),
            supabase.rpc('peris_guild_reinforcement_status'),
        ]);
        if (targets.error) throw new Error(targets.error.message);
        if (parties.error) throw new Error(parties.error.message);
        setGuildTargets((targets.data ?? []) as GuildTarget[]);
        setGuildParties((parties.data ?? []) as GuildParty[]);
    };
    useEffect(() => { if (scope !== 'guild') return; let active = true;
        const load = async () => { try { await refreshGuild(); if (active) setGuildError(''); }
            catch (error) { if (active) setGuildError(error instanceof Error ? error.message : 'Guild reinforcements are unavailable.'); } };
        void load(); return () => { active = false; };
    }, [scope, owner]);
>>>>>>> Stashed changes
    const [sourceId, setSourceId] = useState<number | null>(preferredCityId ?? null);
    const [targetId, setTargetId] = useState<number | null>(null);
    const [amounts, setAmounts] = useState<Partial<Record<RecruitUnit, number>>>({});
    const source = cities.find(city => city.id === sourceId) ?? cities[0];
    const destinations = cities.filter(city => city.id !== source?.id);
<<<<<<< Updated upstream
    const target = destinations.find(city => city.id === targetId) ?? destinations[0];
=======
    const guildDestination = guildTargets.find(city => city.id === guildTargetId) ?? guildTargets[0];
    const target = scope === 'guild' ? guildDestination : (destinations.find(city => city.id === targetId) ?? destinations[0]);
>>>>>>> Stashed changes
    const garrison = source && cityGarrisonAt(world, source.id, owner);
    const available = garrison ? readRoster(garrison) : emptyRoster();
    const units = RECRUIT_UNITS.filter(unit => available[unit] > 0);
    const availableTotal = rosterTotal(available);
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const limit = 1000;
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) || selected[unit] < 0 || selected[unit] > available[unit]);
    const ownerBattle = world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === owner || battle.defender_owner_id === owner));
<<<<<<< Updated upstream
    const route = useMemo(() => source && target ? cityReinforcementRoute(world, source.id, target.id) : null,
        [world, source?.id, target?.id]);
    const canSend = !busy && !ownerBattle && !!source && !!target && !!route && !invalid && count > 0 && count <= limit;
    const faction = source ? factionOf(source.faction) : 'roman';
    useEffect(() => { setSourceId(preferredCityId ?? null); setTargetId(null); setAmounts({}); }, [preferredCityId, owner]);
=======
    const route = useMemo(() => source && target ? scope === 'guild'
        ? findMarchPath(homeArmyPosition(source), homeArmyPosition(target))
        : cityReinforcementRoute(world, source.id, target.id) : null,
        [world, source?.id, target?.id, scope]);
    const canSend = !busy && !guildBusy && !ownerBattle && !!source && !!target && !!route && !invalid && count > 0 && count <= limit;
    const faction = source ? factionOf(source.faction) : 'roman';
    useEffect(() => { setSourceId(preferredCityId ?? null); setTargetId(null); setGuildTargetId(null); setAmounts({}); }, [preferredCityId, owner]);
>>>>>>> Stashed changes
    const setUnit = (unit: RecruitUnit, value: number) => setAmounts(previous => ({ ...previous, [unit]: value }));
    const maxUnit = (unit: RecruitUnit) => {
        const space = Math.max(0, limit - count + (amounts[unit] ?? 0));
        setUnit(unit, Math.min(available[unit], space));
    };
    const maxAll = () => {
        let space = limit;
        const next: Partial<Record<RecruitUnit, number>> = {};
        for (const unit of RECRUIT_UNITS) { next[unit] = Math.min(space, available[unit]); space -= next[unit]!; }
        setAmounts(next);
    };
<<<<<<< Updated upstream
    const dispatch = () => {
        if (!canSend || !source || !target || !route) return;
        run({ type: 'reinforceCity', settlementId: source.id, targetCityId: target.id, troops: selected, route: route.path },
            `${count.toLocaleString()} soldiers sent from ${source.name} to ${target.name}.`);
        setAmounts({});
        onSent?.();
    };
    return <div className="ops-transfer" role="region" aria-label="Move troops between cities">
        <div className="ops-transfer-route">
            <label>From city<select aria-label="Source city" disabled={busy || cities.length < 2} value={source?.id ?? ''}
=======
    const dispatch = async () => {
        if (!canSend || !source || !target || !route) return;
        if (scope === 'guild') {
            setGuildBusy(true); setGuildError('');
            try {
                const {error} = await supabase.rpc('peris_send_guild_reinforcements',
                    {p_source:source.id,p_target:target.id,p_troops:selected,p_path:route.path});
                if (error) throw new Error(error.message);
                setAmounts({}); await refreshGuild(); onSent?.();
            } catch (error) { setGuildError(error instanceof Error ? error.message : 'Could not send guild reinforcements.'); }
            finally { setGuildBusy(false); }
        } else {
            run({ type: 'reinforceCity', settlementId: source.id, targetCityId: target.id, troops: selected, route: route.path },
                `${count.toLocaleString()} soldiers sent from ${source.name} to ${target.name}.`);
            setAmounts({}); onSent?.();
        }
    };
    return <div className="ops-transfer" role="region" aria-label="Move troops between cities">
        <div className="ops-transfer-scope" role="group" aria-label="Reinforcement destination type">
            <button type="button" aria-pressed={scope==='own'} onClick={()=>{setScope('own');setAmounts({});}}>My cities</button>
            <button type="button" aria-pressed={scope==='guild'} onClick={()=>{setScope('guild');setAmounts({});}}>Guild members</button>
        </div>
        <div className="ops-transfer-route">
            <label>From city<select aria-label="Source city" disabled={busy || !cities.length} value={source?.id ?? ''}
>>>>>>> Stashed changes
                onChange={event => { setSourceId(Number(event.target.value)); setTargetId(null); setAmounts({}); }}>
                {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select></label>
            <Icon name="arrow" size={14}/>
<<<<<<< Updated upstream
            <label>To city<select aria-label="Destination city" disabled={busy || cities.length < 2} value={target?.id ?? ''}
                onChange={event => { setTargetId(Number(event.target.value)); setAmounts({}); }}>
                {destinations.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select></label>
        </div>
        {cities.length < 2 ? <p className="ops-transfer-message">Found a second city to send reinforcements.</p> : <>
=======
            <label>{scope === 'guild' ? 'Guild member city' : 'To city'}<select aria-label="Destination city" disabled={busy || guildBusy || !(scope === 'guild' ? guildTargets.length : destinations.length)} value={target?.id ?? ''}
                onChange={event => { if (scope === 'guild') setGuildTargetId(Number(event.target.value)); else setTargetId(Number(event.target.value)); setAmounts({}); }}>
                {scope === 'guild' ? guildTargets.map(city => <option key={city.id} value={city.id}>{city.owner_name} · {city.name}</option>)
                    : destinations.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select></label>
        </div>
        {guildError && <p className="ops-transfer-error" role="alert">{guildError}</p>}
        {scope === 'guild' && !guildTargets.length && <p className="ops-transfer-message">No guild member cities available. Join a guild with another ruler who owns a living city.</p>}
        {!source || !target ? <p className="ops-transfer-message">Choose an available city to dispatch reinforcements.</p> : <>
>>>>>>> Stashed changes
            <div className="ops-transfer-summary"><span>From permanent garrison</span><strong>{availableTotal.toLocaleString()} available</strong></div>
            <div className="ops-transfer-pick-actions">
                <span>Select soldiers <small>Max {limit.toLocaleString()} per march</small></span>
                <button type="button" disabled={busy || !availableTotal} onClick={maxAll}>All</button>
                <button type="button" disabled={busy || count === 0} onClick={() => setAmounts({})}>Clear</button>
            </div>
            {units.length ? <div className="ops-transfer-units" aria-label="Reinforcement troop selection">
                {units.map(unit => {
                    const max = Math.min(available[unit], Math.max(0, limit - count + (amounts[unit] || 0)));
                    const value = Math.min(max, Math.max(0, Number(amounts[unit] ?? 0)));
                    return <div key={unit} className="ops-transfer-unit">
                        <TroopIcon faction={faction} unit={unit}/>
                        <span className="ops-transfer-unit-label"><strong>{factionTroopName(faction, unit)}</strong><small>{available[unit].toLocaleString()}</small></span>
                        <input type="range" aria-label={`Select ${unit} reinforcements`} min={0} max={max} value={value} disabled={busy || ownerBattle || !max}
                            onChange={event => setUnit(unit, Number(event.target.value))}/>
                        <input type="number" aria-label={`Exact ${unit} reinforcements`} inputMode="numeric" min={0} max={max} step={1}
                            value={amounts[unit] ?? 0} disabled={busy || ownerBattle}
                            onChange={event => setUnit(unit, event.target.value === '' ? 0 : Number(event.target.value))}/>
                        <button type="button" disabled={busy || ownerBattle || max === 0} onClick={() => maxUnit(unit)}>Max</button>
                    </div>;
                })}
            </div> : <p className="ops-transfer-message">There are no soldiers in this city's permanent garrison. Station troops in Garrison first.</p>}
            {ownerBattle && <p className="ops-transfer-message">Reinforcement orders are unavailable during an active battle.</p>}
            {(invalid || count > limit) && <p className="ops-transfer-error" role="alert">Select available whole soldiers, up to {limit.toLocaleString()} per march.</p>}
            <div className="ops-transfer-eta"><Icon name="time" size={13}/>
<<<<<<< Updated upstream
                {route ? count > 0 && !invalid && count <= limit ? `Arrival in ${clock(Math.max(2, route.distance / reinforcementSpeed(selected)), world.game_clock?.rate ?? 1)}` : `Land route ready · select soldiers` : 'No connected land route'}</div>
            <div className="ops-transfer-footer"><span>{count.toLocaleString()} selected</span><button type="button" disabled={!canSend} onClick={dispatch}>Send troops <Icon name="arrow" size={13}/></button></div>
        </>}
=======
                {route ? count > 0 && !invalid && count <= limit ? `Arrival in ${clock(Math.max(2, route.distance / reinforcementSpeed(selected)))}` : `Land route ready · select soldiers` : 'No connected land route'}</div>
            <div className="ops-transfer-footer"><span>{count.toLocaleString()} selected</span><button type="button" disabled={!canSend} onClick={() => void dispatch()}>{guildBusy ? 'Sending…' : 'Send troops'} <Icon name="arrow" size={13}/></button></div>
        </>}
        {scope==='guild' && guildParties.length > 0 && <div className="ops-guild-parties" aria-label="Guild reinforcement orders">
            <strong>Guild reinforcements</strong>
            {guildParties.map(party => <div key={party.id} className="ops-guild-party">
                <span><b>{party.source_city} → {party.target_city}</b><small>{party.status} · {Object.values(party.troops).reduce((sum,n)=>sum+Number(n),0).toLocaleString()} troops
                    {party.arrival_at && party.status !== 'stationed' ? ` · ${new Date(party.arrival_at).toLocaleString()}` : ''}</small></span>
                {party.owner_id===owner && party.status==='stationed' && <button type="button" disabled={busy || guildBusy} onClick={async()=>{
                    setGuildBusy(true);try{const {error}=await supabase.rpc('peris_recall_guild_reinforcements',{p_id:party.id});if(error)throw new Error(error.message);await refreshGuild();}
                    catch(error){setGuildError(error instanceof Error?error.message:'Could not recall troops.');}finally{setGuildBusy(false);}
                }}>Recall</button>}
            </div>)}
        </div>}
>>>>>>> Stashed changes
    </div>;
}
