import type { Army } from './types';
import type { Player } from '../../campaign/domain/types';
import type { Order } from '../../../shared/model/world';
import { readRoster, writeRoster, type RecruitUnit } from './roster';
import {unitRule,type UnitBalanceVersion} from './unitBalance';
export function recruitSeconds(type: RecruitUnit, count: number, level: number, boost = 1,version:UnitBalanceVersion=2) { return Math.max(5, Math.ceil(count * unitRule(type,version).trainSeconds / ((1 + (level - 1) * .18)*boost))); }
export function completeRecruit(a: Army, p: Player, o: Order) {
    const unit = o.item as RecruitUnit, roster = readRoster(a);
    roster[unit] += o.quantity; writeRoster(a, roster);
    p.recruits += o.quantity;
}
