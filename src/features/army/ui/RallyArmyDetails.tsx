import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { armyFaction } from '../domain/faction';
import { readRoster, RECRUIT_RULES, RECRUIT_UNITS, type RecruitUnit } from '../domain/roster';
import { TROOP_PRESENTATION, troopMultiplier, troopNumber } from './troopPresentation';
import { factionTroopName } from '../../frontier/ui/roster';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { HERO_CLASSES, heroForArmy, heroLevel } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { clock } from '../../../shared/time/clock';

type RallyArmyDetailsProps = {
    world: World;
    playerId: string;
    armyId: number | undefined;
    now: number;
    busy: boolean;
    onManage: (armyId: number) => void;
    onOrders: (armyId: number) => void;
};

export function RallyArmyDetails({ world, playerId, armyId, now, busy, onManage, onOrders }: RallyArmyDetailsProps) {
    const army = world.armies.find(candidate => candidate.id === armyId && candidate.owner_id === playerId);
    const faction = armyFaction(world, army);
    const assignedHero = army ? heroForArmy(world, army.id) : undefined;
    const hero = assignedHero?.owner_id === playerId ? assignedHero : undefined;
    const roster = army ? readRoster(army) : undefined;
    const [selection, setSelection] = useState<{ armyId: number | undefined; unit: RecruitUnit }>({ armyId, unit: RECRUIT_UNITS.find(unit => (roster?.[unit] ?? 0) > 0) ?? 'infantry' });
    const selectedUnit = selection.armyId === armyId ? selection.unit : RECRUIT_UNITS.find(unit => (roster?.[unit] ?? 0) > 0) ?? 'infantry';
    const rule = RECRUIT_RULES[selectedUnit];
    const presentation = TROOP_PRESENTATION[selectedUnit];
    const troopCount = RECRUIT_UNITS.reduce((sum, unit) => sum + (roster?.[unit] ?? 0), 0);
    const carry = RECRUIT_UNITS.reduce((sum, unit) => sum + (roster?.[unit] ?? 0) * RECRUIT_RULES[unit].carry, 0);
    const activeUnits = RECRUIT_UNITS.filter(unit => (roster?.[unit] ?? 0) > 0);
    const slowestSpeed = activeUnits.length ? Math.min(...activeUnits.map(unit => RECRUIT_RULES[unit].speed)) : undefined;
    const arrival = army ? Date.parse(army.arrival_at) : NaN;
    const remaining = Number.isFinite(arrival) ? Math.max(0, (arrival - now) / 1000) : undefined;
    const movingCaption = remaining === undefined ? 'Arrival time unavailable' : remaining > 0 ? `Arrives in ${clock(remaining)}` : 'Awaiting arrival update';
    const training = !!army && world.orders.some(order => order.owner_id === playerId && order.kind === 'recruit' && (order.army_id ?? world.armies.find(candidate => candidate.owner_id === playerId)?.id) === army.id);
    const fighting = !!army && (army.raid_target_id != null || army.raid_city_id != null || world.battles.some(battle => battle.status === 'active' && (battle.attacker_army_id === army.id || battle.defender_army_id === army.id)));
    const activeBattle = world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === playerId || battle.defender_owner_id === playerId));
    const orderReason = busy ? 'An order is being processed' : !army ? 'Select a legion first' : army.status !== 'idle' ? 'New orders are available when this legion is idle' : fighting || activeBattle ? 'Finish the current battle before issuing orders' : training ? 'Training must finish before this legion leaves' : troopCount === 0 ? 'Recruit troops before issuing orders' : '';

    if (!army) {
        return <section className="rp-army-details" aria-label="Selected legion">
            <div className="rp-command-caption"><h2>No legion selected</h2><p>Select a legion to inspect its commander and troops.</p></div>
        </section>;
    }

    return <section className="rp-army-details" aria-label={`Legion details: ${army.name}`}>
        <header className="rp-command-caption">
            <h2>{army.name}</h2>
            <span className={army.status === 'moving' ? 'moving' : 'idle'}>
                <Icon name={army.status === 'moving' ? 'time' : 'shield'} size={15}/>
                {army.status === 'moving' ? `Moving · ${movingCaption}` : training ? 'Training · At station' : fighting ? 'In battle' : 'Idle · Ready at station'}
            </span>
        </header>

        <div className="rp-commander">
            <div className="rp-commander-portrait">
                {hero ? <HeroPortrait faction={faction} heroClass={hero.class} heroId={hero.id} /> : <Icon name="crown" size={32}/>}
                {hero && <span title="Commander level">{heroLevel(hero)}</span>}
            </div>
            <div className="rp-command-caption">
                <h3>{hero?.name ?? 'Unassigned commander'}</h3>
                <span>{hero ? `Level ${heroLevel(hero)} ${HERO_CLASSES[hero.class].name}` : 'No commander assigned'}</span>
            </div>
        </div>

        <div className="rp-unit-cards" aria-label="Legion troop roster">
            {RECRUIT_UNITS.map(unit => {
                const name = factionTroopName(faction, unit);
                const quantity = roster?.[unit] ?? 0;
                return <button key={unit} type="button" className={`rp-unit-card${selectedUnit === unit ? ' active' : ''}`} aria-pressed={selectedUnit === unit} aria-label={`Inspect ${name}, ${quantity.toLocaleString()} in this legion`} title={`${name} · ${TROOP_PRESENTATION[unit].category} · ${quantity.toLocaleString()} troops`} onClick={() => setSelection({ armyId, unit })}>
                    <span className="rp-unit-count">{quantity.toLocaleString()}</span>
                    <TroopIcon faction={faction} unit={unit} portrait />
                    <span className="rp-unit-name">{name}</span>
                    <small>{TROOP_PRESENTATION[unit].category}</small>
                </button>;
            })}
        </div>

        <div className="rp-army-summary" aria-label="Whole legion totals">
            <div className="rp-stat-row"><span><Icon name="army" size={16}/>Troops</span><strong>{troopCount.toLocaleString()}</strong></div>
            <div className="rp-stat-row"><span><Icon name="transfer" size={16}/>Base carrying capacity</span><strong>{carry.toLocaleString()}</strong></div>
            <div className="rp-stat-row"><span><Icon name="horse" size={16}/>Slowest troop speed</span><strong>{slowestSpeed === undefined ? '—' : troopNumber(slowestSpeed)}</strong></div>
        </div>

        <div className="rp-unit-inspector" aria-live="polite" aria-label="Selected troop statistics">
            <header><h3>{factionTroopName(faction, selectedUnit)}</h3><span>{presentation.category} · {rule.building}</span></header>
            <div className="rp-stat-row"><span>In this legion</span><strong>{(roster?.[selectedUnit] ?? 0).toLocaleString()}</strong></div>
            <div className="rp-stat-row"><span><Icon name="army" size={16}/>Base attack multiplier</span><strong>{troopMultiplier(rule.attack)}</strong></div>
            <div className="rp-stat-row"><span><Icon name="shield" size={16}/>Base defence multiplier</span><strong>{troopMultiplier(rule.defence)}</strong></div>
            <div className="rp-stat-row"><span><Icon name="horse" size={16}/>Combat speed</span><strong>{troopNumber(rule.speed)}</strong></div>
            <div className="rp-stat-row"><span><Icon name="transfer" size={16}/>Base carry per troop</span><strong>{troopNumber(rule.carry)}</strong></div>
            <div className="rp-stat-row"><span><Icon name="time" size={16}/>Base training per troop</span><strong>{rule.trainSeconds}s</strong></div>
            <div className="rp-stat-row"><span>Base recruit cost per troop</span><strong className="rp-unit-cost">
                <span title={`${rule.cost.wood} wood`} aria-label={`${rule.cost.wood} wood`}><Icon name="wood" size={13}/>{rule.cost.wood}</span>
                <span title={`${rule.cost.stone} stone`} aria-label={`${rule.cost.stone} stone`}><Icon name="stone" size={13}/>{rule.cost.stone}</span>
                <span title={`${rule.cost.food} food`} aria-label={`${rule.cost.food} food`}><Icon name="food" size={13}/>{rule.cost.food}</span>
                <span title={`${rule.cost.gold} gold`} aria-label={`${rule.cost.gold} gold`}><Icon name="gold" size={13}/>{rule.cost.gold}</span>
            </strong></div>
            <p className="rp-rule-note">{presentation.description}</p>
        </div>

        <div className="rp-army-actions">
            <button type="button" className="button gold" disabled={!!orderReason} title={orderReason || 'Choose and confirm this legion’s next march'} onClick={() => onOrders(army.id)}><Icon name="army" size={17}/>Issue orders</button>
            <button type="button" className="button outline" disabled={busy} onClick={() => onManage(army.id)}><Icon name="crown" size={17}/>Manage commander</button>
        </div>
        <p className="rp-rule-note">Capacity is the base carry of this legion’s troops. Troop speed governs combat movement; the commander governs world travel.</p>
    </section>;
}
