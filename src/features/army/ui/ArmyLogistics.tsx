import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Army } from '../domain/types';
import type { Command } from '../../../shared/model/commands';
import { soldierTotal } from '../domain/units';
import { armyOverview, cityDistance, rebaseReason, transferReason, count } from '../domain/commandRoom';
import { emptyRoster, readRoster, rosterTotal, RECRUIT_UNITS, type UnitRoster } from '../domain/roster';
import { armyFaction } from '../domain/faction';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import { heroForArmy } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { Icon } from '../../../shared/ui/Icons';
import { armyAttack } from '../../city/domain/slots';
import { armyPosition } from '../../map/domain/movement';
import { homeArmyPosition } from '../../map/domain/garrisons';
import {visibleRecruitUnits} from './visibleRecruitUnits';

export function ArmyLogistics({ world, army, cityId, now, run, busy, onMap }: { world: World; army: Army; cityId: number; now: number; run: (c: Command, message?: string) => void; busy: boolean; onMap?: (id: number, orders?: boolean) => void }) {
    const others = world.armies.filter(a => a.owner_id === army.owner_id && a.id !== army.id);
    const initial = others.find(a => transferReason(world, army, a, emptyRoster(), now, true) === 'Choose how many soldiers to transfer.' && soldierTotal(a) < 1000) ?? others[0];
    const [targetId, setTarget] = useState(initial?.id), [baseId, setBase] = useState(cityId);
    const [troops, setTroops] = useState<UnitRoster>(emptyRoster);
    const target = others.find(a => a.id === targetId) ?? others[0];
    const available = readRoster(army), received = target ? readRoster(target) : emptyRoster(), faction = armyFaction(world, army);
    const supportedUnits=visibleRecruitUnits(world);
    const selected = Object.fromEntries(supportedUnits.map(unit => [unit, Math.min(troops[unit], available[unit])])) as UnitRoster;
    const reason = transferReason(world, army, target, selected, now, true), total = rosterTotal(selected), info = armyOverview(world, army, now);
    const cities = world.settlements.filter(s => s.owner_id === army.owner_id), city = cities.find(s => s.id === baseId) ?? cities[0], baseReason = city ? rebaseReason(world, army, city, now) : 'Choose a home city.';
    const sourceHero = heroForArmy(world, army.id), targetHero = target ? heroForArmy(world, target.id) : undefined;
    return <div className="army-logistics-layout"><section className="command-panel command-transfer"><div className="command-section-heading"><div><span className="command-kicker">Redistribute your forces</span><h2>Transfer troops</h2></div><Icon name="transfer" size={24}/></div>
        {others.length ? <><label className="command-label">Receiving army<select aria-label="Army to receive troops" value={target?.id ?? ''} onChange={event => { setTarget(Number(event.target.value)); setTroops(emptyRoster()); }}>{others.map(a => <option key={a.id} value={a.id}>{a.name} · {soldierTotal(a)} soldiers · {armyOverview(world, a, now).state}</option>)}</select></label>
        <div className="transfer-army-pair"><div><HeroPortrait compact heroId={sourceHero?.id} heroClass={sourceHero?.class} faction={info.home?.faction}/><span><small>From</small><strong>{sourceHero?.name ?? army.name}</strong><b>{count(info.total)} → {count(info.total - total)}</b></span></div><Icon name="arrow"/><div><HeroPortrait compact heroId={targetHero?.id} heroClass={targetHero?.class} faction={world.settlements.find(s => s.id === target?.home_settlement_id)?.faction}/><span><small>To</small><strong>{targetHero?.name ?? target?.name}</strong><b>{count(target ? soldierTotal(target) : 0)} → {count((target ? soldierTotal(target) : 0) + total)}</b></span></div></div>
        <div className="transfer-table"><div className="transfer-table-head"><span>Unit</span><span>Keep</span><span>Send</span><span>Receiver after</span></div>{supportedUnits.map(unit => <div key={unit}><span title={`${factionTroopName(faction, unit)} · ${available[unit]} available in this legion`}><TroopIcon faction={faction} unit={unit}/>{factionTroopName(faction, unit)}</span><b>{available[unit] - selected[unit]}</b><input aria-label={`${factionTroopName(faction, unit)} to transfer`} type="number" min={0} max={available[unit]} value={selected[unit]} onChange={event => setTroops(previous => ({ ...previous, [unit]: Math.max(0, Math.min(available[unit], Math.floor(Number(event.target.value) || 0))) }))}/><b>{received[unit] + selected[unit]}</b></div>)}</div>
        <p className="command-muted">Choose each recruited troop type. Transfers keep its research identity and battle statistics.</p>
        <div className="command-transfer-footer"><div><strong>{count(total)} soldiers selected</strong><small>{target ? `${1000 - soldierTotal(target)} spaces in receiving army` : ''}</small></div><button className="command-button primary" disabled={busy || !!reason} onClick={() => { if (!target || reason) return; run({ type: 'transferTroops', armyId: army.id, targetArmyId: target.id, infantry: 0, archers: 0, cavalry: 0, troops: selected }, `${total} soldiers transferred to ${target.name}`); setTroops(emptyRoster()); }}>Transfer troops<Icon name="transfer" size={16}/></button></div>
        <div className="command-note"><Icon name={reason ? 'help' : 'check'} size={18}/><p>{reason ?? 'Both armies are together and ready to transfer.'}</p>{reason && onMap && <button className="command-text-button" onClick={() => onMap(army.id)}>View on map<Icon name="arrow" size={15}/></button>}</div>
        {reason === 'Bring these two armies together on the map.' && target && <button className="command-button secondary" disabled={busy || !!info.orders.length || !!armyOverview(world, target, now).orders.length} onClick={() => { const destination = armyPosition(target, now); run({ type: 'move', armyId: army.id, ...destination }, `${army.name} is marching to meet ${target.name}`); }}>March to meet {targetHero?.name ?? target.name}<Icon name="horse" size={17}/></button>}
        </> : <div className="command-empty"><Icon name="army" size={34}/><h3>Your first army stands alone.</h3><p>Raise another army to move soldiers between commanders. Both armies need to be together, stopped, and finished training.</p></div>}
    </section><section className="command-panel command-base"><div className="command-section-heading"><div><span className="command-kicker">Supplies &amp; smithy bonuses</span><h2>Home city</h2></div><Icon name="town" size={24}/></div><p className="command-muted">{info.home?.name ?? 'Your city'} supports this army. Its smithies provide +{Math.round((info.smithy - 1) * 100)}% troop damage.</p>
        <label className="command-label">Choose home city<select aria-label="New home city" value={city?.id ?? ''} onChange={event => setBase(Number(event.target.value))}>{cities.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{city && city.id !== army.home_settlement_id && <div className="home-bonus-preview"><small>Smithy bonus after rebasing</small><strong>+{Math.round((armyAttack(world, city.id) - 1) * 100)}% troop damage</strong></div>}
        {city && <><div className="base-location"><Icon name="flag"/><span>{army.status === 'idle' && cityDistance(army, city, now, true) <= 90 ? `Army is at ${city.name}` : `Army must arrive at ${city.name}`}</span></div><button className="command-button secondary" disabled={busy || !!baseReason} onClick={() => run({ type: 'rebaseArmy', armyId: army.id, settlementId: city.id }, `${city.name} is now ${army.name}’s home`)}>Set as home city<Icon name="check" size={16}/></button>{baseReason && <p className="command-muted">{baseReason}</p>}{cityDistance(army, city, now, true) > 90 && <button className="command-text-button" disabled={busy || !!info.orders.length} onClick={() => run({ type: 'move', armyId: army.id, settlementId: city.id, ...homeArmyPosition(city) }, `${army.name} is marching to ${city.name}`)}>March to this city<Icon name="arrow" size={16}/></button>}</>}
        <div className="command-note"><p>Changing home is free. It changes the smithy bonus; your hero, troops, and equipment stay with the army.</p></div>
    </section></div>;
}
