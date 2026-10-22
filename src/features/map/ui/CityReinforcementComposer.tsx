import { useEffect, useMemo, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { cityGarrisonAt } from '../../city/domain/cityGarrison';
import { cityReinforcementRoute, reinforcementSpeed } from '../../city/domain/cityReinforcements';
import { readRoster, emptyRoster, RECRUIT_UNITS, rosterTotal, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

/** A dispatch form for permanent garrison troops, hosted by Events on Map and City.
 * Simulation, travel, conservation and offline arrival stay in reinforceCity. */
export function CityReinforcementComposer({ world, owner, busy, run, preferredCityId, onSent }: {
    world: World; owner: string; busy: boolean; preferredCityId?: number;
    run: (command: Command, message?: string) => void; onSent?: () => void;
}) {
    const cities = world.settlements.filter(city => city.owner_id === owner && !city.ruined_at);
    const [sourceId, setSourceId] = useState<number | null>(preferredCityId ?? null);
    const [targetId, setTargetId] = useState<number | null>(null);
    const [amounts, setAmounts] = useState<Partial<Record<RecruitUnit, number>>>({});
    const source = cities.find(city => city.id === sourceId) ?? cities[0];
    const destinations = cities.filter(city => city.id !== source?.id);
    const target = destinations.find(city => city.id === targetId) ?? destinations[0];
    const garrison = source && cityGarrisonAt(world, source.id, owner);
    const available = garrison ? readRoster(garrison) : emptyRoster();
    const units = RECRUIT_UNITS.filter(unit => available[unit] > 0);
    const availableTotal = rosterTotal(available);
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const limit = 1000;
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) || selected[unit] < 0 || selected[unit] > available[unit]);
    const ownerBattle = world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === owner || battle.defender_owner_id === owner));
    const route = useMemo(() => source && target ? cityReinforcementRoute(world, source.id, target.id) : null,
        [world, source?.id, target?.id]);
    const canSend = !busy && !ownerBattle && !!source && !!target && !!route && !invalid && count > 0 && count <= limit;
    const faction = source ? factionOf(source.faction) : 'roman';
    useEffect(() => { setSourceId(preferredCityId ?? null); setTargetId(null); setAmounts({}); }, [preferredCityId, owner]);
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
                onChange={event => { setSourceId(Number(event.target.value)); setTargetId(null); setAmounts({}); }}>
                {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select></label>
            <Icon name="arrow" size={14}/>
            <label>To city<select aria-label="Destination city" disabled={busy || cities.length < 2} value={target?.id ?? ''}
                onChange={event => { setTargetId(Number(event.target.value)); setAmounts({}); }}>
                {destinations.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select></label>
        </div>
        {cities.length < 2 ? <p className="ops-transfer-message">Found a second city to send reinforcements.</p> : <>
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
                {route ? count > 0 && !invalid && count <= limit ? `Arrival in ${clock(Math.max(2, route.distance / reinforcementSpeed(selected)))}` : `Land route ready · select soldiers` : 'No connected land route'}</div>
            <div className="ops-transfer-footer"><span>{count.toLocaleString()} selected</span><button type="button" disabled={!canSend} onClick={dispatch}>Send troops <Icon name="arrow" size={13}/></button></div>
        </>}
    </div>;
}
