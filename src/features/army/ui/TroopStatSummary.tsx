import type { TroopStat } from '../domain/troopCardStats';
import { TroopStatTooltip } from './TroopStatTooltip';

const rounded = (value: number) => Math.round(value * 10) / 10;
const number = (value: number) => rounded(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const signed = (value: number) => value > 0 ? `+${number(value)}` : value < 0 ? `−${number(-value)}` : '—';

export function TroopStatLine({ label, stat, baseOnly = false }: { label: string; stat: TroopStat; baseOnly?: boolean }) {
    const delta = rounded(rounded(stat.current) - rounded(stat.base));
    const highDelta = stat.maximum === undefined ? undefined : rounded(rounded(stat.maximum) - rounded(stat.base));
    const change = (value: number) => <span className="troop-stat-delta" data-change={value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'}>{signed(value)}</span>;
    return <span className="troop-card-stat" data-stat={label.toLowerCase()} data-base={rounded(stat.base)} data-current={rounded(stat.current)}>
        <span className="troop-stat-label">{label}</span><span className="troop-stat-base">{number(stat.base)}</span>
        {!baseOnly && <><span className="troop-stat-bonus"><TroopStatTooltip label={label} stat={stat}>{change(delta)}{highDelta !== undefined && <>…{change(highDelta)}</>}</TroopStatTooltip></span><strong className="troop-stat-current">{number(stat.current)}{stat.maximum !== undefined && <>–{number(stat.maximum)}</>}</strong></>}
    </span>;
}

export function TroopStatSummary({ attack, defence, baseOnly = false }: { attack: TroopStat; defence: TroopStat; baseOnly?: boolean }) {
    return <span className={`troop-card-stats${baseOnly ? ' base-only' : ''}`} aria-label={baseOnly ? 'Base unit stats' : 'Base, bonus and current unit stats'}>
        {!baseOnly && <span className="troop-card-stat troop-card-stat-head" aria-hidden="true"><span>Stat</span><span>Base</span><span>Bonus</span><span>Now</span></span>}
        <TroopStatLine label="Attack" stat={attack} baseOnly={baseOnly}/><TroopStatLine label="Defence" stat={defence} baseOnly={baseOnly}/>
    </span>;
}
