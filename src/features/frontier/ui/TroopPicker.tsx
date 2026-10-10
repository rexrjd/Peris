import { FRONTIER_UNIT_TYPES as UNIT_TYPES, isResearched, type FrontierUnitType } from '../domain/units';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import type { Troops } from '../domain/types';
import { number, totalTroops, unitLabels } from './format';
import { factionTroopName } from './roster';
import { TroopIcon } from './TroopIcon';

export const validPreset = (troops: Troops, max: number) => UNIT_TYPES.every(unit => Number.isSafeInteger(troops[unit] ?? 0) && (troops[unit] ?? 0) >= 0) && totalTroops(troops) > 0 && totalTroops(troops) <= max;

export function TroopPicker({ faction, troops, available, researched, max, onChange, legend, disabled = false }: {
    faction: Faction; troops: Troops; available: Troops; max: number;
    researched?: FrontierUnitType[];
    onChange: (troops: Troops) => void; legend: string; disabled?: boolean;
}) {
    return <fieldset className="fw-preset fw-faction-preset" disabled={disabled}>
        <legend>{legend}<small>{FACTIONS[faction].name} · choose quantities, use 0 to leave a type at home</small></legend>
        {UNIT_TYPES.map(unit => <label key={unit}>
            <span><TroopIcon faction={faction} unit={unit} />{factionTroopName(faction, unit)}</span>
            <small>{unitLabels[unit]}</small>
            <input aria-label={`${factionTroopName(faction, unit)} quantity`} disabled={!isResearched({ researched }, unit) && !(available[unit] ?? 0)} type="number" min={0} max={max} step={1} value={troops[unit] ?? 0} onChange={event => onChange({ ...troops, [unit]: Number(event.target.value) })} />
            <small>{isResearched({ researched }, unit) ? `${number(available[unit] ?? 0)} available` : 'Research required'}</small>
        </label>)}
    </fieldset>;
}
