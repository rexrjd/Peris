import { type Army, type UnitType } from './types';
import { type Resources } from '../../../shared/model/resources';
import { unitRule } from './unitBalance';
export const UNIT_TYPES: UnitType[] = ['infantry', 'archers', 'cavalry'];
export const UNITS: Record<UnitType, {
    name: string;
    role: string;
    cost: Resources;
    speed: number;
    range: number;
    rate: number;
    color: string;
}> = {
    infantry: { name: 'Legionaries', role: 'Hold the line · brace against cavalry', cost: unitRule('infantry',1).cost, speed: 40, range: 44, rate: .020, color: '#a84337' },
    archers: { name: 'Sagittarii', role: 'Ranged volleys · protect them from melee', cost: unitRule('archers',1).cost, speed: 34, range: 220, rate: .012, color: '#798e61' },
    cavalry: { name: 'Equites', role: 'Fast flank attacks · charge the enemy rear', cost: unitRule('cavalry',1).cost, speed: 76, range: 50, rate: .031, color: '#ae9767' },
};
export function soldierTotal(a: Pick<Army, 'infantry' | 'archers' | 'cavalry'>) { return a.infantry + a.archers + a.cavalry; }
