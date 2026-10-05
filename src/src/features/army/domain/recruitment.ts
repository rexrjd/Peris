import type { Army } from './types';
import type { Player } from '../../campaign/domain/types';
import type { Order } from '../../../shared/model/world';
import { type UnitType } from './types';
export function recruitSeconds(type: UnitType, count: number, level: number) { return Math.max(5, Math.ceil(count * (type === 'cavalry' ? 5 : 2) / (1 + (level - 1) * .18))); }
export function completeRecruit(a: Army, p: Player, o: Order) {
    a[o.item as UnitType] += o.quantity;
    p.recruits += o.quantity;
}
