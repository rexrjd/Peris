import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { affordable, liveResources } from '../../city/domain/economy';
import { playerName } from '../../campaign/domain/players';
import { FIELD_BUILDINGS, TERRITORY_RULES, fieldCost, fieldModifier, fieldRate, fieldSeconds, mapClaimReason, type FieldBuilding } from '../domain/territory';
import { getCell } from '../domain/worldGrid';

export function FieldInspector({ world, playerId, cityId, onEmpire, col, row, now, busy, run }: {
    world: World; playerId: string; cityId?:number; onEmpire?:()=>void; col: number; row: number; now: number; busy: boolean; run: (command: Command, message?: string) => void;
}) {
    const cell = getCell(col, row), plot = world.map_plots?.find(p => p.col === cell.col && p.row === cell.row);
    const home = world.settlements.find(s => s.owner_id === playerId && (plot?.owner_id===playerId?s.id===plot.settlement_id:cityId===undefined||s.id===cityId))!;
    const resources = liveResources(home, now), reason = mapClaimReason(world, playerId, col, row, home.id);
    const activeBattle = world.battles.some(b => b.status === 'active' && (b.attacker_owner_id === playerId || b.defender_owner_id === playerId));
    const pending = world.orders.find(o => o.owner_id === playerId && o.kind === 'field' && o.item.startsWith(`field:${cell.col}:${cell.row}:`));
    const own = plot?.owner_id === playerId;
    const types = (Object.keys(FIELD_BUILDINGS) as FieldBuilding[]).filter(type => !plot?.building_type || plot.building_type === type);
    return <section className="territory-inspector" aria-label="Field ownership and development">
        <span className="eyebrow">{plot ? own ? 'YOUR TERRITORY' : 'OWNED TERRITORY' : 'UNCLAIMED FIELD'}</span>
        <h2>{cell.name}</h2>{onEmpire&&!plot&&<button className="button outline" onClick={onEmpire}>Found a city here</button>}<p className="field-coordinates">X {cell.col} · Y {cell.row}</p>
        {plot && <p>Ruled by {playerName(world.players, plot.owner_id)} · {plot.level > 0 ? `Level ${plot.level} ${FIELD_BUILDINGS[plot.building_type!].name}` : pending ? 'Construction underway' : 'Empty land'}.</p>}
        {plot?.building_type && <p className="territory-output"><Icon name={FIELD_BUILDINGS[plot.building_type].resource} size={17}/><strong>{fieldRate(plot).toFixed(1)} / min</strong><span>{pending ? `Completes in ${clock(Math.max(0, (Date.parse(pending.finish_at) - now) / 1000))}` : 'Completed production'}</span></p>}
        {!plot && <><button className="button gold" disabled={busy || activeBattle || !!reason} onClick={() => run({ type: 'claimField', col: cell.col, row: cell.row }, 'Field claimed · choose a building next')}>Claim this empty field</button><p>{activeBattle ? 'Finish the current battle first.' : reason ?? 'Available. Claiming gives ownership; construction creates production.'}</p></>}
        {world.map?.plots_truncated && <p>Some distant fields are hidden. Zoom in for current ownership; the server checks every claim.</p>}
        {cell.terrain !== 'water' && <div className="territory-buildings"><span className="field-label">{own ? 'DEVELOP THIS FIELD' : 'DEVELOPMENT POTENTIAL'}</span>{types.map(type => {
            const info = FIELD_BUILDINGS[type], level = plot?.level ?? 0, modifier = fieldModifier(cell.terrain, type), cost = fieldCost(type, level);
            const bonus = Math.round((modifier - 1) * 100), maxed = level >= TERRITORY_RULES.maxLevel;
            return <article key={type}><div><Icon name={info.resource} size={18}/><strong>{info.name}</strong><span className={bonus < 0 ? 'penalty' : bonus > 0 ? 'bonus' : ''}>{bonus > 0 ? '+' : ''}{bonus}%</span></div><small>{maxed ? 'Maximum level reached' : `${(info.baseRate * (level + 1) * modifier).toFixed(1)} ${info.resource} / min at level ${level + 1} · ${fieldSeconds(level)} sec`}</small>{own && !maxed && <><Cost cost={cost} resources={resources} compact/><button disabled={busy || activeBattle || !!pending || !affordable(resources, cost)} onClick={() => run({ type: 'buildField', settlementId:home.id, col: cell.col, row: cell.row, item: type }, `${info.name} construction queued`)}>{pending ? 'Construction underway' : plot?.level ? `Upgrade to level ${level + 1}` : `Build ${info.name}`}</button></>}</article>;
        })}</div>}
        {own && !plot?.level && <p>Empty and unfinished fields produce nothing. Your internal city buildings remain in the city view.</p>}
    </section>;
}
