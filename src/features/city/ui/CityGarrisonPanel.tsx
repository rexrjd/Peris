import { useEffect, useId, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { cityGarrisonAt, wallDefenseBonus } from '../domain/cityGarrison';
import { cityMilitaryOverview } from '../domain/militaryOverview';
import { readRoster, RECRUIT_UNITS, rosterTotal, emptyRoster, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

/** The right-hand city card is always visible; its editor is a dropdown, not a modal.
 * Transferring soldiers only sends the existing authoritative command. Combat remains automatic. */
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
    const menuId = useId();

    const { town, stationed } = cityMilitaryOverview(world, sid, owner, now);
    const validArmies = stationed.filter(army => !army.raid_reserve &&
        !world.orders.some(order => order.kind === 'recruit' && order.owner_id === owner &&
            (order.army_id ?? world.armies.find(a => a.owner_id === owner)?.id) === army.id));
    const army = validArmies.find(row => row.id === armyId) ?? validArmies[0];
    const stored = cityGarrisonAt(world, sid, owner);
    const defenders = stored ? readRoster(stored) : emptyRoster();
    const total = rosterTotal(defenders);
    const wallLevel = world.buildings.find(building => building.settlement_id === sid && building.building_type === 'wall')?.level ?? 0;
    const bonus = Math.round(wallDefenseBonus(wallLevel) * 100);
    const ownerBattle = world.battles.some(battle => battle.status === 'active' &&
        (battle.attacker_owner_id === owner || battle.defender_owner_id === owner));
    const source = action === 'station' && army ? readRoster(army) : action === 'withdraw' ? defenders : undefined;
    const capacity = action === 'station' ? 1000 : Math.max(0, 1000 - (army ? rosterTotal(readRoster(army)) : 0));
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) ||
        selected[unit] < 0 || selected[unit] > (source?.[unit] ?? 0));
    const canSubmit = !!army && !busy && !ownerBattle && !invalid && count > 0 && count <= capacity;

    useEffect(() => { setOpen(false); setAction('station'); setArmyId(null); setAmounts({}); }, [sid, owner]);
    useEffect(() => { setAmounts({}); }, [action, armyId]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open]);

    const toggle = () => setOpen(value => !value);
    const fillAvailable = () => {
        const result: Partial<Record<RecruitUnit, number>> = {};
        let remaining = capacity;
        for (const unit of RECRUIT_UNITS) {
            result[unit] = Math.min(remaining, source?.[unit] ?? 0);
            remaining -= result[unit]!;
        }
        setAmounts(result);
    };
    const send = () => {
        if (!canSubmit || !army) return;
        run({ type: 'manageCityGarrison', settlementId: sid, armyId: army.id, action, troops: selected },
            action === 'station' ? `${count} soldiers assigned to ${town.name}'s permanent garrison.` : `${count} soldiers returned to ${army.name}.`);
        setAmounts({});
    };

    return <aside ref={root} className="city-garrison-dock" aria-label={`${town.name} garrison`} onKeyDown={event => {
        if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
        }
    }}>
        <div className="city-garrison-card">
            <button ref={trigger} type="button" className="city-garrison-trigger" aria-label={`Garrison for ${town.name}: ${total.toLocaleString()} permanent defenders, wall level ${wallLevel}, plus ${bonus} percent defence. ${open ? 'Close' : 'Open'} garrison management.`}
                aria-expanded={open} aria-controls={menuId} onClick={toggle}>
                <span className="city-garrison-crest" aria-hidden="true"><span><Icon name="shield" size={32}/></span></span>
                <span className="city-garrison-card-info">
                    <span className="city-garrison-card-heading"><strong>Garrison</strong><Icon name="chevron" size={15}/></span>
                    <span className="city-garrison-card-counts"><span><Icon name="people" size={13}/><b>{total.toLocaleString()}</b> permanent</span>
                        <span><Icon name="shield" size={13}/>Wall Lv. {wallLevel} <b>+{bonus}%</b></span></span>
                </span>
            </button>
            <div className="city-garrison-card-footer"><span className="city-garrison-auto"><i aria-hidden="true"/> Automatic defence</span>
                <button type="button" className="city-garrison-manage" aria-expanded={open} aria-controls={menuId} onClick={toggle}>{open ? 'Close' : 'Manage'}<Icon name={open ? 'minus' : 'plus'} size={13}/></button>
            </div>
        </div>
        {open && <section id={menuId} className="city-garrison-menu" role="region" aria-label={`Manage ${town.name} garrison`}>
            <header className="city-garrison-menu-header"><span>PERMANENT DEFENDERS</span><strong>{town.name}</strong></header>
            <div className="city-garrison-metrics"><div><small>Stationed soldiers</small><strong>{total.toLocaleString()}</strong></div>
                <div><small>Wall · Lv. {wallLevel}/5</small><strong>+{bonus}% <span>defence</span></strong></div></div>
            <p className="city-garrison-hint">These soldiers defend automatically, even when both players are offline. Idle legions and temporary reinforcements also join.</p>
            <div className="city-garrison-section-head"><h3>Garrison roster</h3><span>{total.toLocaleString()} troops</span></div>
            <div className="city-garrison-roster" aria-label="Permanently stationed soldiers">
                {RECRUIT_UNITS.some(unit => defenders[unit] > 0) ? RECRUIT_UNITS.filter(unit => defenders[unit] > 0).map(unit => <span key={unit}><small title={factionTroopName(factionOf(town.faction), unit)}>{factionTroopName(factionOf(town.faction), unit)}</small><strong>{defenders[unit].toLocaleString()}</strong></span>) :
                    <p className="city-garrison-empty">No permanent defenders assigned yet.</p>}
            </div>
            <div className="city-garrison-section-head"><h3>Transfer soldiers</h3></div>
            <div className="city-garrison-tabs" role="group" aria-label="Garrison transfer direction">
                <button type="button" aria-pressed={action === 'station'} onClick={() => setAction('station')}>Station</button>
                <button type="button" aria-pressed={action === 'withdraw'} onClick={() => setAction('withdraw')}>Withdraw</button>
            </div>
            <label className="city-garrison-legion-label">Idle legion in this city
                <select value={army?.id ?? ''} disabled={!validArmies.length || busy} onChange={event => { setArmyId(Number(event.target.value)); setAmounts({}); }}>
                    <option value="" disabled>Select a legion</option>
                    {validArmies.map(row => <option key={row.id} value={row.id}>{row.name} · {rosterTotal(readRoster(row))} troops</option>)}
                </select>
            </label>
            {!validArmies.length ? <p className="city-garrison-empty">Bring an idle, non-recruiting legion into this city to transfer soldiers.</p> :
                <div className="city-garrison-transfer">
                    <div className="city-garrison-transfer-head"><span>{action === 'station' ? 'From selected legion' : 'From permanent garrison'}</span>
                        <button type="button" onClick={fillAvailable} disabled={!source || busy || ownerBattle || capacity === 0 || rosterTotal(source) === 0}>Select max</button></div>
                    <div className="city-garrison-units">{RECRUIT_UNITS.some(unit => (source?.[unit] ?? 0) > 0) ? RECRUIT_UNITS.filter(unit => (source?.[unit] ?? 0) > 0).map(unit =>
                        <label key={unit}><span title={factionTroopName(factionOf(town.faction), unit)}>{factionTroopName(factionOf(town.faction), unit)} <small>/ {source?.[unit]?.toLocaleString()}</small></span>
                            <input aria-label={`${unit} soldiers to ${action}`} type="number" min="0" max={source?.[unit] ?? 0} step="1" value={amounts[unit] ?? 0} disabled={busy || ownerBattle} onChange={event => setAmounts(previous => ({ ...previous, [unit]: event.target.value === '' ? 0 : Number(event.target.value) }))}/></label>) :
                        <p className="city-garrison-empty">{action === 'station' ? 'This legion has no soldiers to station.' : 'No garrison soldiers available to withdraw.'}</p>}
                    </div>
                    {(invalid || count > capacity) && <p className="city-garrison-error" role="alert">{invalid ? 'Choose only available whole-number troop counts.' : `Choose no more than ${capacity.toLocaleString()} soldiers.`}</p>}
                    {ownerBattle && <p className="city-garrison-empty">Transfers are locked while a battle is resolving.</p>}
                    <footer className="city-garrison-actions"><span>{count.toLocaleString()} selected{action === 'withdraw' ? ` · ${capacity.toLocaleString()} free spaces` : ''}</span>
                        <button type="button" disabled={!canSubmit} onClick={send}>{action === 'station' ? 'Station soldiers' : 'Withdraw soldiers'}<Icon name="arrow" size={14}/></button></footer>
                </div>}
        </section>}
    </aside>;
}
