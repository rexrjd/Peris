import { useEffect, useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Icon } from '../../../shared/ui/Icons';
import { cityGarrisonAt, wallDefenseBonus } from '../domain/cityGarrison';
import { cityMilitaryOverview } from '../domain/militaryOverview';
import { readRoster, RECRUIT_UNITS, rosterTotal, emptyRoster, type RecruitUnit, type UnitRoster } from '../../army/domain/roster';
import { factionTroopName } from '../../frontier/ui/roster';
import { factionOf } from '../../factions/domain/factions';

/** City garrison orders are persisted on the server and fight automatically, offline.
 * UI does not issue battle actions or simulate combat. */
export function CityGarrisonPanel({ world, owner, sid, now, run, busy, onClose }: {
    world: World; owner: string; sid: number; now: number;
    run: (command: Command, message?: string) => void; busy: boolean; onClose: () => void;
}) {
    const [action, setAction] = useState<'station' | 'withdraw'>('station');
    const [armyId, setArmyId] = useState<number | null>(null);
    const [amounts, setAmounts] = useState<Partial<Record<RecruitUnit, number>>>({});
    const { town, stationed } = cityMilitaryOverview(world, sid, owner, now);
    const validArmies = stationed.filter(a => !a.raid_reserve &&
        !world.orders.some(o => o.kind === 'recruit' && o.owner_id === owner && (o.army_id ?? world.armies.find(a => a.owner_id === owner)?.id) === a.id));
    const army = validArmies.find(a => a.id === armyId) ?? validArmies[0];
    const garrison = cityGarrisonAt(world, sid, owner);
    const stored = garrison ? readRoster(garrison) : undefined;
    const wallLevel = world.buildings.find(b => b.settlement_id === sid && b.building_type === 'wall')?.level ?? 0;
    const bonus = Math.round(wallDefenseBonus(wallLevel) * 100);
    const ownerBattle = world.battles.some(b => b.status === 'active' && (b.attacker_owner_id === owner || b.defender_owner_id === owner));
    const source = action === 'station' && army ? readRoster(army) : stored;
    const capacity = action === 'station' ? 1000 : Math.max(0, 1000 - (army ? rosterTotal(readRoster(army)) : 0));
    const selected = Object.fromEntries(RECRUIT_UNITS.map(unit => [unit, Number(amounts[unit] ?? 0)])) as UnitRoster;
    const count = rosterTotal(selected);
    const invalid = RECRUIT_UNITS.some(unit => !Number.isSafeInteger(selected[unit]) || selected[unit] < 0 || selected[unit] > (source?.[unit] ?? 0));
    const canSubmit = !!army && !busy && !ownerBattle && !invalid && count > 0 && count <= capacity;
    const fillAvailable = () => {
        const result: Partial<Record<RecruitUnit, number>> = {};
        let remaining = capacity;
        for (const unit of RECRUIT_UNITS) {
            result[unit] = Math.min(remaining, source?.[unit] ?? 0);
            remaining -= result[unit]!;
        }
        setAmounts(result);
    };
    useEffect(() => setAmounts({}), [action, armyId, sid]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);
    const send = () => {
        if (!canSubmit || !army) return;
        run({ type: 'manageCityGarrison', settlementId: sid, armyId: army.id, action, troops: selected },
            action === 'station' ? `${count} soldiers assigned to ${town.name}'s permanent garrison.` : `${count} soldiers returned to ${army.name}.`);
        setAmounts({});
    };
    return <div className="city-garrison-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="city-garrison-panel city-scene-plate" role="dialog" aria-modal="true" aria-label={`Defence of ${town.name}`}>
            <header className="city-garrison-heading"><div><span className="city-garrison-eyebrow"><Icon name="shield" size={14}/> PERSISTENT DEFENCE</span><h2>{town.name} · Garrison</h2><p>Defends automatically, including when both rulers are offline.</p></div><button type="button" aria-label="Close city garrison" className="city-garrison-close" onClick={onClose}><Icon name="close" size={18}/></button></header>
            <div className="city-garrison-metrics">
                <div><small>Assigned defenders</small><strong>{rosterTotal(stored ?? emptyRoster()).toLocaleString()}</strong></div>
                <div><small>City wall · Lv. {wallLevel}/5</small><strong>+{bonus}% <span>defence</span></strong></div>
            </div>
            <p className="city-garrison-hint">Wall protection is a flat +10% per level, capped at +50%. There are no manual siege orders or gate mechanics. Temporary field reinforcements and stationed legions still join the battle automatically.</p>
            <div className="city-garrison-section-head"><h3>Permanent defenders</h3><span>{rosterTotal(stored ?? emptyRoster())} troops</span></div>
            <div className="city-garrison-roster" aria-label="Assigned defensive troops">{RECRUIT_UNITS.filter(unit => (stored?.[unit] ?? 0) > 0).length ? RECRUIT_UNITS.filter(unit => (stored?.[unit] ?? 0) > 0).map(unit => <span key={unit}><small>{factionTroopName(factionOf(town.faction), unit)}</small><strong>{stored![unit].toLocaleString()}</strong></span>) : <p className="city-garrison-empty">No dedicated troops yet. Station soldiers from an idle legion below.</p>}</div>
            <div className="city-garrison-section-head"><h3>Assign or withdraw soldiers</h3></div>
            <div className="city-garrison-tabs" role="group" aria-label="Garrison operation"><button type="button" aria-pressed={action === 'station'} onClick={() => setAction('station')}>Station troops</button><button type="button" aria-pressed={action === 'withdraw'} onClick={() => setAction('withdraw')}>Withdraw troops</button></div>
            <label className="city-garrison-legion-label">Legion currently in this city<select value={army?.id ?? ''} disabled={!validArmies.length || busy} onChange={e => { setArmyId(Number(e.target.value));setAmounts({}); }}><option value="" disabled>Select a legion</option>{validArmies.map(a => <option key={a.id} value={a.id}>{a.name} · {rosterTotal(readRoster(a))} troops</option>)}</select></label>
            {!validArmies.length ? <p className="city-garrison-empty">A legion must be idle, physically stationed here, and not recruiting before it can transfer soldiers.</p> : <div className="city-garrison-transfer"><div className="city-garrison-transfer-head"><span>{action === 'station' ? 'Available in legion' : 'Available in garrison'}</span><button type="button" onClick={fillAvailable} disabled={!source || busy || capacity === 0}>Select maximum</button></div>
                <div className="city-garrison-units">{RECRUIT_UNITS.filter(unit => (source?.[unit] ?? 0) > 0).map(unit => <label key={unit}><span>{factionTroopName(factionOf(town.faction), unit)} <small>/ {source?.[unit]}</small></span><input aria-label={`${unit} soldiers to ${action}`} type="number" min="0" max={source?.[unit] ?? 0} step="1" value={amounts[unit] ?? 0} onChange={e => setAmounts(a => ({ ...a, [unit]: e.target.value === '' ? 0 : Number(e.target.value) }))}/></label>)}</div>
                <footer className="city-garrison-actions"><span>{count.toLocaleString()} selected {action === 'withdraw' ? `· ${capacity} free spaces` : ''}</span><button type="button" disabled={!canSubmit} onClick={send}>{action === 'station' ? 'Assign to garrison' : 'Return to legion'}<Icon name="arrow" size={14}/></button></footer>
                {(invalid || count > capacity) && <p className="city-garrison-error" role="alert">{invalid ? 'Choose whole troop counts you actually have.' : `Select at most ${capacity} soldiers.`}</p>}
                {ownerBattle && <p className="city-garrison-empty">Transfers are locked while a battle is resolving.</p>}
            </div>}
        </section>
    </div>;
}
