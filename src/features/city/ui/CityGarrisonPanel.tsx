import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { cityGarrisonAt, wallDefenseBonus } from '../domain/cityGarrison';
import { cityReinforcementRoute, reinforcementSpeed } from '../domain/cityReinforcements';
import { cityMilitaryOverview } from '../domain/militaryOverview';
import { readRoster, RECRUIT_UNITS, rosterTotal, emptyRoster, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

type GarrisonAction = 'station' | 'withdraw' | 'send';

/** Compact, faction-themed partner to CitySelector. No manual battle controls:
 * permanent defenders and incoming transports are resolved by offline ticks. */
export function CityGarrisonPanel({ world, owner, sid, now, run, busy }: {
    world: World; owner: string; sid: number; now: number;
    run: (command: Command, message?: string) => void; busy: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<GarrisonAction>('station');
    const [armyId, setArmyId] = useState<number | null>(null);
    const [targetCityId, setTargetCityId] = useState<number | null>(null);
    const [amounts, setAmounts] = useState<Partial<Record<RecruitUnit, number>>>({});
    const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
    const id = useId(), legionId = `${id}-legion`, destinationId = `${id}-destination`;

    const { town, stationed } = cityMilitaryOverview(world, sid, owner, now);
    const validArmies = stationed.filter(army => !army.raid_reserve && !army.raid_city_id &&
        !world.orders.some(order => order.kind === 'recruit' && order.recruit_destination !== 'garrison' && order.owner_id === owner &&
            (order.army_id ?? world.armies.find(a => a.owner_id === owner)?.id) === army.id));
    const army = validArmies.find(row => row.id === armyId) ?? validArmies[0];
    const garrison = cityGarrisonAt(world, sid, owner);
    const defenders = garrison ? readRoster(garrison) : emptyRoster();
    const total = rosterTotal(defenders);
    const wallLevel = world.buildings.find(b => b.settlement_id === sid && b.building_type === 'wall')?.level ?? 0;
    const wallBonus = Math.round(wallDefenseBonus(wallLevel) * 100);
    const ownerBattle = world.battles.some(b => b.status === 'active' &&
        (b.attacker_owner_id === owner || b.defender_owner_id === owner));
    const otherCities = world.settlements.filter(city => city.owner_id === owner && city.id !== sid && !city.ruined_at);
    const target = otherCities.find(city => city.id === targetCityId) ?? otherCities[0];
    const route = useMemo(() => action === 'send' && target ? cityReinforcementRoute(world, sid, target.id) : null,
        [action, sid, target?.id, world]);
    const source = action === 'station' ? (army ? readRoster(army) : undefined) : defenders;
    const capacity = action === 'station' || action === 'send' ? 1000 : Math.max(0, 1000 - (army ? rosterTotal(readRoster(army)) : 0));
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) || selected[unit] < 0 || selected[unit] > (source?.[unit] ?? 0));
    const canSubmit = !busy && !ownerBattle && !invalid && count > 0 && count <= capacity &&
        (action === 'send' ? !!target && !!route : !!army);
    const availableUnits = RECRUIT_UNITS.filter(unit => (source?.[unit] ?? 0) > 0);
    const faction = factionOf(town.faction);
    const shipments = (world.city_reinforcements ?? []).filter(p => p.owner_id === owner &&
        (p.source_settlement_id === sid || p.target_settlement_id === sid)).sort((a, b) => Date.parse(a.arrival_at) - Date.parse(b.arrival_at));

    useEffect(() => { setOpen(false); setAction('station'); setArmyId(null); setTargetCityId(null); setAmounts({}); }, [sid, owner]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open]);

    const changeAction = (next: GarrisonAction) => { setAction(next); setAmounts({}); };
    const chooseMax = () => {
        const next: Partial<Record<RecruitUnit, number>> = {};
        let remaining = capacity;
        for (const unit of RECRUIT_UNITS) { next[unit] = Math.min(remaining, source?.[unit] ?? 0); remaining -= next[unit]!; }
        setAmounts(next);
    };
    const chooseUnitMax = (unit: RecruitUnit) => {
        const remaining = Math.max(0, capacity - count + (Number(amounts[unit]) || 0));
        setAmounts(previous => ({ ...previous, [unit]: Math.min(remaining, source?.[unit] ?? 0) }));
    };
    const setUnit = (unit: RecruitUnit, value: number) => setAmounts(previous => ({ ...previous, [unit]: value }));
    const send = () => {
        if (!canSubmit) return;
        if (action === 'send') {
            if (!target || !route) return;
            run({ type: 'reinforceCity', settlementId: sid, targetCityId: target.id, troops: selected, route: route.path },
                `${count} garrison soldiers marching from ${town.name} to ${target.name}.`);
        } else {
            if (!army) return;
            run({ type: 'manageCityGarrison', settlementId: sid, armyId: army.id, action, troops: selected },
                action === 'station' ? `${count} soldiers stationed in ${town.name}.` : `${count} soldiers withdrawn to ${army.name}.`);
        }
        setAmounts({});
    };

    return <aside ref={root} className="city-selector city-garrison-dock" aria-label={`${town.name} garrison`}
        onKeyDown={event => {
            if (event.key === 'Escape' && open) {
                event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
            }
        }}>
        <div className="city-selector-card city-garrison-card">
            <button ref={trigger} className="city-selector-trigger" type="button"
                aria-label={`Manage garrison for ${town.name}: ${total.toLocaleString()} permanent soldiers and ${wallBonus} percent wall defence`}
                aria-controls={id} aria-expanded={open} onClick={() => setOpen(value => !value)}>
                <span className="city-selector-preview city-garrison-emblem" aria-hidden="true"><Icon name="shield" size={26}/></span>
                <span className="city-selector-info">
                    <span className="city-selector-heading"><strong>Garrison</strong><span className="city-selector-chevron" aria-hidden="true">⌄</span></span>
                    <span className="city-selector-counts">
                        <span><Icon name="people" size={13}/><b>{total.toLocaleString()}</b> defenders</span>
                        <span><Icon name="shield" size={13}/>Wall <b>+{wallBonus}%</b></span>
                    </span>
                </span>
            </button>
            <div className="city-selector-land city-garrison-foot">
                <span title="Defends automatically when both players are offline"><Icon name="check" size={12}/>Auto-defends offline</span>
                <button type="button" aria-controls={id} aria-expanded={open} onClick={() => setOpen(value => !value)}>
                    {open ? 'Close' : 'Manage'}<Icon name={open ? 'minus' : 'plus'} size={12}/>
                </button>
            </div>
        </div>
        {open && <section id={id} className="city-selector-menu city-garrison-menu" role="region" aria-label={`Manage ${town.name} garrison`}>
            <div className="city-garrison-line city-garrison-overview"><span>Permanent defenders</span><strong>{total.toLocaleString()}</strong></div>
            <div className="city-garrison-roster" aria-label="Garrison troop roster">
                {RECRUIT_UNITS.filter(unit => defenders[unit] > 0).map(unit =>
                    <span key={unit}><TroopIcon faction={faction} unit={unit}/>{factionTroopName(faction, unit)} <b>{defenders[unit].toLocaleString()}</b></span>)}
                {!total && <small>No soldiers stationed yet.</small>}
            </div>
            <div className="city-ruin-tabs city-garrison-tabs" role="group" aria-label="Garrison troop orders">
                <button type="button" className={action === 'station' ? 'selected' : ''} aria-pressed={action === 'station'} onClick={() => changeAction('station')}>Station</button>
                <button type="button" className={action === 'withdraw' ? 'selected' : ''} aria-pressed={action === 'withdraw'} onClick={() => changeAction('withdraw')}>Withdraw</button>
                <button type="button" className={action === 'send' ? 'selected' : ''} aria-pressed={action === 'send'} onClick={() => changeAction('send')}>Send</button>
            </div>
            {action === 'send' ? <div className="city-garrison-legion">
                <label htmlFor={destinationId}>To city</label>
                <select id={destinationId} value={target?.id ?? ''} disabled={!otherCities.length || busy}
                    onChange={event => { setTargetCityId(Number(event.target.value)); setAmounts({}); }}>
                    {!otherCities.length && <option value="">Found a second city first</option>}
                    {otherCities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
            </div> : <div className="city-garrison-legion">
                {validArmies.length === 1 ? <><span className="city-garrison-legion-label">Legion</span>
                    <span className="city-garrison-one-legion" title={army?.name}>{army?.name} <small>· {rosterTotal(readRoster(army!)).toLocaleString()}</small></span></> :
                    <><label htmlFor={legionId}>Legion</label>
                        <select id={legionId} value={army?.id ?? ''} disabled={!validArmies.length || busy}
                            onChange={event => { setArmyId(Number(event.target.value)); setAmounts({}); }}>
                            {!validArmies.length && <option value="">No idle legion</option>}
                            {validArmies.map(row => <option key={row.id} value={row.id}>{row.name} · {rosterTotal(readRoster(row)).toLocaleString()}</option>)}
                        </select></>}
            </div>}
            {(action === 'send' ? otherCities.length > 0 : validArmies.length > 0) ? <div className="city-garrison-transfer">
                <div className="city-garrison-line city-garrison-transfer-title"><span>{action === 'station' ? 'From legion' : 'From garrison'}</span>
                    <div className="city-garrison-quick">
                        {count > 0 && <button type="button" disabled={busy} onClick={() => setAmounts({})}>Clear</button>}
                        <button type="button" disabled={busy || ownerBattle || !availableUnits.length || capacity === 0} onClick={chooseMax}>All</button>
                    </div>
                </div>
                {availableUnits.length ? <div className="city-garrison-units" aria-label="Soldiers to transfer">
                    {availableUnits.map(unit => {
                        const maximum = Math.min(source![unit], Math.max(0, capacity - count + (Number(amounts[unit]) || 0)));
                        const value = Math.min(maximum, Math.max(0, Number(amounts[unit] ?? 0)));
                        return <div key={unit} className="city-garrison-unit">
                            <TroopIcon faction={faction} unit={unit}/>
                            <span className="city-garrison-unit-name">{factionTroopName(faction, unit)}<small>{source![unit].toLocaleString()} available</small></span>
                            <input className="city-garrison-slider" aria-label={`${unit} soldiers to ${action}`} type="range" min={0} max={maximum} step={1} value={value}
                                disabled={busy || ownerBattle || capacity === 0} onChange={event => setUnit(unit, Number(event.target.value))}/>
                            <input className="city-garrison-quantity" aria-label={`Exact ${unit} count`} type="number" inputMode="numeric" min={0} max={maximum} step={1}
                                value={amounts[unit] ?? 0} disabled={busy || ownerBattle || capacity === 0}
                                onChange={event => setUnit(unit, event.target.value === '' ? 0 : Number(event.target.value))}/>
                            <button type="button" aria-label={`Select max ${unit}`} disabled={busy || ownerBattle || maximum === 0}
                                onClick={() => chooseUnitMax(unit)}>Max</button>
                        </div>;
                    })}
                </div> : <p className="city-garrison-note">{action === 'station' ? 'This legion has no soldiers available.' : 'No defenders available to transfer.'}</p>}
                {action === 'send' && target && <p className="city-garrison-route">
                    <Icon name="time" size={12}/>{route ? `March to ${target.name} · ${clock(Math.max(2, route.distance / reinforcementSpeed(selected)), world.game_clock?.rate ?? 1)} with selected troops` : 'No connected land route'}
                </p>}
                {ownerBattle && <p className="city-garrison-note">Orders are locked during an active battle.</p>}
                {(invalid || count > capacity) && <p className="city-garrison-error" role="alert">{invalid ? 'Choose available whole soldiers.' : `Maximum ${capacity.toLocaleString()} soldiers per order.`}</p>}
                <footer className="city-garrison-actions"><span>{count.toLocaleString()} selected</span>
                    <button type="button" disabled={!canSubmit} onClick={send}>
                        {action === 'send' ? 'Send' : action === 'station' ? 'Station' : 'Withdraw'} {count > 0 ? count.toLocaleString() : ''}<Icon name="arrow" size={13}/>
                    </button>
                </footer>
            </div> : <p className="city-garrison-note">{action === 'send' ? 'Found another city to send reinforcements.' : 'Move an idle legion here to transfer soldiers.'}</p>}
            {shipments.length > 0 && <div className="city-garrison-shipments" aria-label="Active reinforcement marches">
                <strong>On the march</strong>
                {shipments.slice(0, 4).map(p => <div key={p.id} className="city-garrison-shipment">
                    <span>{p.source_settlement_id === sid ? 'To ' : 'From '}{world.settlements.find(c => c.id === (p.source_settlement_id === sid ? p.target_settlement_id : p.source_settlement_id))?.name ?? 'City'} · {rosterTotal(readRoster(p.troops)).toLocaleString()}</span>
                    <small>{clock(Math.max(0, (Date.parse(p.arrival_at) - now) / 1000), world.game_clock?.rate ?? 1)}</small>
                </div>)}
            </div>}
        </section>}
    </aside>;
}
