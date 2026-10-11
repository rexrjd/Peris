import type { Faction } from '../../factions/domain/factions';
import { FRONTIER_UNIT_TYPES } from '../domain/units';
import type { Troops } from '../domain/types';
import { TroopIcon } from './TroopIcon';
import { factionTroopName } from './roster';
import { number } from './format';

export function CampGarrison({ troops, faction }: { troops: Troops; faction: Faction }) {
    const present = FRONTIER_UNIT_TYPES.filter(unit => (troops[unit] ?? 0) > 0);
    return present.length ? <ul className="fw-camp-garrison" aria-label="Camp defenders">{present.map(unit => <li key={unit}><TroopIcon faction={faction} unit={unit} /><strong>{number(troops[unit] ?? 0)}</strong><span>{factionTroopName(faction, unit)}</span></li>)}</ul> : <p className="fw-muted">No defenders</p>;
}
