import { useEffect, useId, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { cityGarrisonAt, wallDefenseBonus } from '../domain/cityGarrison';
import { cityMilitaryOverview } from '../domain/militaryOverview';
import { readRoster, RECRUIT_UNITS, rosterTotal, emptyRoster, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

/** Uses CitySelector's themed card and dropdown. Only these existing commands
 * can change troop ownership; offline battles are resolved by the server. */
export function CityGarrisonPanel({ world, owner, sid, now, run, busy }: {
    world: World; owner: string; sid: number; now: number;
    run: (command: Command, message?: string) => void; busy: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<'station' | 'withdraw'>('station');
    const [armyId, setArmyId] = useState<number | null>(null);
    const [amounts, setAmounts] = useState<Partial<Record<RecruitUnit, number>>>({});
    const root = useRef<HTMLElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const legionId = `${id}-legion`;

    const { town, stationed } = cityMilitaryOverview(world, sid, owner, now);
    const validArmies = stationed.filter(army => !army.raid_reserve && !army.raid_city_id &&
        !world.orders.some(order => order.kind === 'recruit' && order.owner_id === owner &&
            (order.army_id ?? world.armies.find(a => a.owner_id === owner)?.id) === army.id));
    const army = validArmies.find(row => row.id === armyId) ?? validArmies[0];
    const garrison = cityGarrisonAt(world, sid, owner);
    const defenders = garrison ? readRoster(garrison) : emptyRoster();
    const total = rosterTotal(defenders);
    const wallLevel = world.buildings.find(b => b.settlement_id === sid && b.building_type === 'wall')?.level ?? 0;
    const wallBonus = Math.round(wallDefenseBonus(wallLevel) * 100);
    const ownerBattle = world.battles.some(b => b.status === 'active' &&
        (b.attacker_owner_id === owner || b.defender_owner_id === owner));
    const source = action === 'station' ? (army ? readRoster(army) : undefined) : defenders;
    const capacity = action === 'station' ? 1000 : Math.max(0, 1000 - (army ? rosterTotal(readRoster(army)) : 0));
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) ||
        selected[unit] < 0 || selected[unit] > (source?.[unit] ?? 0));
    const canSubmit = !!army && !busy && !ownerBattle && !invalid && count > 0 && count <= capacity;
    const availableUnits = RECRUIT_UNITS.filter(unit => (source?.[unit] ?? 0) > 0);
    const faction = factionOf(town.faction);

    useEffect(() => { setOpen(false); setAction('station'); setArmyId(null); setAmounts({}); }, [sid, owner]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open]);

    const toggle = () => setOpen(value => !value);
    const changeAction = (next: 'station' | 'withdraw') => { setAction(next); setAmounts({}); };
    const chooseMax = () => {
        const next: Partial<Record<RecruitUnit, number>> = {};
        let remaining = capacity;
        for (const unit of RECRUIT_UNITS) {
            next[unit] = Math.min(remaining, source?.[unit] ?? 0);
            remaining -= next[unit]!;
        }
        setAmounts(next);
    };
    const chooseUnitMax = (unit: RecruitUnit) => {
        const remaining = Math.max(0, capacity - count + (Number(amounts[unit]) || 0));
        setAmounts(previous => ({ ...previous, [unit]: Math.min(remaining, source?.[unit] ?? 0) }));
    };
    const send = () => {
        if (!canSubmit || !army) return;
        run({ type: 'manageCityGarrison', settlementId: sid, armyId: army.id, action, troops: selected },
            action === 'station' ? `${count} soldiers assigned to ${town.name}'s permanent garrison.` : `${count} soldiers returned to ${army.name}.`);
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
                aria-controls={id} aria-expanded={open} onClick={toggle}>
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
                <span title="Defends automatically even when both players are offline"><Icon name="check" size={12}/>Auto-defends offline</span>
                <button type="button" aria-controls={id} aria-expanded={open} onClick={toggle}>
                    {open ? 'Close' : 'Manage'}<Icon name={open ? 'minus' : 'plus'} size={12}/>
                </button>
            </div>
        </div>
        {open && <section id={id} className="city-selector-menu city-garrison-menu" role="region"
            aria-label={`Manage ${town.name} garrison`}>
            <div className="city-garrison-line city-garrison-overview">
                <span>Permanent defenders</span><strong>{total.toLocaleString()}</strong>
            </div>
            <div className="city-garrison-roster" aria-label="Garrison troop roster">
                {RECRUIT_UNITS.filter(unit => defenders[unit] > 0).map(unit =>
                    <span key={unit}>{factionTroopName(faction, unit)} <b>{defenders[unit].toLocaleString()}</b></span>)}
                {!total && <small>No troops stationed yet.</small>}
            </div>
            <div className="city-ruin-tabs city-garrison-tabs" role="group" aria-label="Garrison transfer direction">
                <button type="button" className={action === 'station' ? 'selected' : ''} aria-pressed={action === 'station'} onClick={() => changeAction('station')}>Station</button>
                <button type="button" className={action === 'withdraw' ? 'selected' : ''} aria-pressed={action === 'withdraw'} onClick={() => changeAction('withdraw')}>Withdraw</button>
            </div>
            <div className="city-garrison-legion">
                {validArmies.length === 1 ? <><span className="city-garrison-legion-label">Legion</span>
                    <span className="city-garrison-one-legion" title={army?.name}>
                        {army?.name} <small>· {rosterTotal(readRoster(army!)).toLocaleString()}</small>
                    </span></> : <><label htmlFor={legionId}>Legion</label>
                    <select id={legionId} value={army?.id ?? ''} disabled={!validArmies.length || busy}
                        onChange={event => { setArmyId(Number(event.target.value)); setAmounts({}); }}>
                        {!validArmies.length && <option value="">No idle legion</option>}
                        {validArmies.map(row => <option key={row.id} value={row.id}>{row.name} · {rosterTotal(readRoster(row)).toLocaleString()}</option>)}
                    </select></>}
            </div>
            {validArmies.length ? <div className="city-garrison-transfer">
                <div className="city-garrison-line city-garrison-transfer-title"><span>{action === 'station' ? 'From legion' : 'From garrison'}</span>
                    <button type="button" disabled={busy || ownerBattle || !availableUnits.length || capacity === 0}
                        onClick={chooseMax}>Select max</button>
                </div>
                {availableUnits.length ? <div className="city-garrison-units" aria-label="Soldiers to transfer">
                    {availableUnits.map(unit => <label key={unit} className="city-garrison-unit">
                        <span className="city-garrison-unit-name" title={`${factionTroopName(faction, unit)} · ${source![unit].toLocaleString()} available`}>{factionTroopName(faction, unit)}
                            <small> {source![unit].toLocaleString()} available</small></span>
                        <input aria-label={`${unit} soldiers to ${action}`} type="number" inputMode="numeric" min="0"
                            max={Math.min(source![unit], capacity)} step="1" value={amounts[unit] ?? ''}
                            placeholder="0" disabled={busy || ownerBattle || capacity === 0}
                            onChange={event => setAmounts(prev => ({ ...prev, [unit]: event.target.value === '' ? undefined : Number(event.target.value) }))}/>
                        <button type="button" aria-label={`Select max ${unit}`} disabled={busy || ownerBattle || capacity === 0}
                            onClick={() => chooseUnitMax(unit)}>Max</button>
                    </label>)}
                </div> : <p className="city-garrison-note">{action === 'station' ? 'This legion has no available soldiers.' : 'Nothing to withdraw yet.'}</p>}
                {ownerBattle && <p className="city-garrison-note">Transfers are locked during a battle.</p>}
                {(invalid || count > capacity) && <p className="city-garrison-error" role="alert">
                    {invalid ? 'Enter only available, whole soldiers.' : `Your legion can accept up to ${capacity.toLocaleString()} soldiers.`}
                </p>}
                <footer className="city-garrison-actions">
                    <span>{count.toLocaleString()} selected</span>
                    <button type="button" disabled={!canSubmit} onClick={send}>
                        {action === 'station' ? 'Station' : 'Withdraw'} {count > 0 ? count.toLocaleString() : ''}<Icon name="arrow" size={13}/>
                    </button>
                </footer>
            </div> : <p className="city-garrison-note">Move an idle legion here to transfer soldiers.</p>}
        </section>}
    </aside>;
}
