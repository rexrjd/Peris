import { useState } from 'react';
import { type BuildingType } from '../domain/types';
import { BUILDINGS } from '../domain/buildings';
import { type World } from '../../../shared/model/world';
import { type Command } from '../../../shared/model/commands';
import { affordable, liveResources } from '../domain/economy';
import { buildingCost, MAX_BUILDING_LEVEL, upgradeSeconds } from '../domain/construction';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { Cost } from '../../../shared/ui/Shared';
import { clock } from '../../../shared/time/clock';
import { SettlementScene } from '../rendering/SettlementScene';

function trainingTime(level: number) {
    return `${Math.round(100 / (1 + Math.max(0, level - 1) * .18))}% time`;
}

function benefitFor(type: BuildingType, level: number, town: World['settlements'][number]) {
    const nextLevel = Math.min(MAX_BUILDING_LEVEL, level + 1);
    if (type === 'lumber') return { now: `${town.wood_rate} / min`, next: `${14 + nextLevel * 8} / min` };
    if (type === 'quarry') return { now: `${town.stone_rate} / min`, next: `${12 + nextLevel * 7} / min` };
    if (type === 'farm') return { now: `${town.food_rate} / min`, next: `${18 + nextLevel * 10} / min` };
    if (type === 'market') return { now: `${town.gold_rate} / min`, next: `${3 + nextLevel * 3} / min` };
    if (type === 'storehouse') return { now: town.capacity.toLocaleString(), next: (5000 + nextLevel * 2500).toLocaleString() };
    if (type === 'wall') return { now: `${Math.min(100, 90 + level * 2)}% morale`, next: `${Math.min(100, 90 + nextLevel * 2)}% morale` };
    return { now: trainingTime(level), next: trainingTime(nextLevel) };
}

export function SettlementView({ world, playerId, run, busy, now }: {
    world: World;
    playerId: string;
    run: (c: Command, message?: string) => void;
    busy: boolean;
    now: number;
}) {
    const [selected, setSelected] = useState<BuildingType>('lumber');
    const town = world.settlements.find(s => s.owner_id === playerId)!;
    const buildings = world.buildings.filter(b => b.settlement_id === town.id);
    const building = buildings.find(b => b.building_type === selected)!;
    const meta = BUILDINGS[selected];
    const res = liveResources(town, now);
    const order = world.orders.find(o => o.kind === 'upgrade' && o.owner_id === playerId);
    const maxed = building.level >= MAX_BUILDING_LEVEL;
    const cost = buildingCost(selected, building.level);
    const benefit = benefitFor(selected, building.level, town);
    const totalDevelopment = buildings.reduce((sum, item) => sum + Math.min(MAX_BUILDING_LEVEL, item.level), 0);
    const levelText = building.level === 0 ? 'UNBUILT' : `LEVEL ${building.level}`;
    const nextText = maxed ? 'MASTERED' : `LEVEL ${building.level + 1}`;

    return <div className="settlement-layout">
        <section className="city-column">
            <div className="view-heading city-heading">
                <div>
                    <span className="eyebrow">YOUR SETTLEMENT</span>
                    <h1>{town.name}</h1>
                    <p>Build it one landmark at a time. Every upgrade changes the city itself.</p>
                </div>
                <span className="tag">{totalDevelopment} / {buildings.length * MAX_BUILDING_LEVEL} development</span>
            </div>

            <div className="city-panel">
                <SettlementScene selected={selected} onSelect={setSelected} levels={Object.fromEntries(buildings.map(item => [item.building_type, item.level]))}/>
                <div className="city-scene-hint"><span>SELECT A BUILDING</span><b>Each landmark has five visual stages</b></div>
            </div>

            <div className="building-grid" aria-label="Settlement buildings">
                {buildings.map(item => <button key={item.id} className={selected === item.building_type ? 'selected' : ''} onClick={() => setSelected(item.building_type)}>
                    <Icon name={buildingIcon(item.building_type)}/>
                    <span>{BUILDINGS[item.building_type].name}<small>{item.level === 0 ? 'Unbuilt' : `Level ${item.level} / ${MAX_BUILDING_LEVEL}`}</small></span>
                    {order?.item === item.building_type && <Icon name="time" size={14}/>} 
                </button>)}
            </div>
        </section>

        <aside className="detail-panel">
            <span className="eyebrow">SETTLEMENT DEVELOPMENT</span>
            <div className={`building-emblem level-emblem level-${building.level}`}><Icon name={buildingIcon(selected)} size={54}/><span>{building.level}</span></div>
            <h2>{meta.name}</h2>
            <span className="tag">{levelText} → {nextText}</span>
            <p>{meta.description}</p>
            <div className="benefit"><Icon name="arrow" size={16}/>{meta.effect}</div>
            <div className="level-track" aria-label={`${meta.name} level ${building.level} of ${MAX_BUILDING_LEVEL}`}>
                {[1, 2, 3, 4, 5].map(level => <i key={level} className={building.level >= level ? 'filled' : ''}/>) }
            </div>
            <div className="upgrade-comparison">
                <div><small>CURRENT</small><strong>{benefit.now}</strong></div>
                <Icon name="arrow"/>
                <div><small>{maxed ? 'FINAL' : 'NEXT LEVEL'}</small><strong>{maxed ? 'MAX' : benefit.next}</strong></div>
            </div>
            <div className="rule"/>
            {!maxed && <>
                <label className="field-label">UPGRADE COST</label>
                <Cost cost={cost} resources={res}/>
                <p className="muted inline"><Icon name="time" size={15}/>{clock(upgradeSeconds(building.level))} construction time</p>
            </>}
            <button className="button gold" disabled={busy || !!order || !affordable(res, cost) || maxed} onClick={() => run({ type: 'upgrade', item: selected }, `${meta.name} upgrade started`)}>
                {maxed ? 'Fully developed' : order ? 'Builders are working' : !affordable(res, cost) ? 'More supplies needed' : building.level === 0 ? 'Construct building' : 'Begin upgrade'}
                {!maxed && <Icon name="arrow" size={16}/>} 
            </button>
            {order && <div className="queue-card">
                <label className="field-label">UNDER CONSTRUCTION</label>
                <strong>{BUILDINGS[order.item as BuildingType].name}</strong>
                <div className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, (now - Date.parse(order.started_at)) / (Date.parse(order.finish_at) - Date.parse(order.started_at)) * 100))}%` }}/></div>
                <small>Completes in {clock((Date.parse(order.finish_at) - now) / 1000)}</small>
            </div>}
            <div className="storage-note"><Icon name="town"/><div><strong>{town.capacity.toLocaleString()} storage capacity</strong><small>Upgrade the granary to store more of every resource.</small></div></div>
        </aside>
    </div>;
}
