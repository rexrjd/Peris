import type { Camp } from '../../map/domain/types';
import { emptyResources } from '../../../shared/model/resources';
import { DEFAULT_CONFIG } from '../../frontier/domain/balance';
import { recruitDelay } from '../../frontier/domain/camps';
import { accrue } from '../../frontier/domain/economy';
import { readRoster, writeRoster, rosterTotal } from '../../army/domain/roster';
export const campTier = (camp: Camp) => camp.tier >= 4 ? 'hard' : camp.tier <= 2 ? 'low' : 'medium';
export const campRules = (camp: Camp) => DEFAULT_CONFIG.tiers[campTier(camp)];
/** Old camps retain IDs, sites and soldiers. Stock begins when this mechanic is installed. */
export function accrueCamp(camp: Camp, until: number, engaged = false) {
    if (!camp.bandit) return;
    const rule = campRules(camp);
    camp.resources ??= emptyResources(); camp.stock_updated_at ??= new Date(until).toISOString();
    camp.next_recruit_at ??= new Date(until + recruitDelay(DEFAULT_CONFIG, String(camp.id), camp.recruit_sequence ?? 0)).toISOString();
    const force = readRoster(camp);
    // Bounded catch-up: once full, elapsed recruitment cannot mint excess soldiers.
    let steps = 0;
    while (!engaged && Date.parse(camp.next_recruit_at) <= until && steps++ < 1024) {
        const at = Date.parse(camp.next_recruit_at), sequence = camp.recruit_sequence ?? 0;
        const unit = (['infantry', 'archers', 'cavalry'] as const)[sequence % (rule.weights.cavalry ? 3 : 2)];
        force[unit] += Math.max(0, Math.min(rule.batchMin + sequence % (rule.batchMax - rule.batchMin + 1), rule.defenderCap - rosterTotal(force)));
        camp.recruit_sequence = sequence + 1;
        camp.next_recruit_at = new Date(at + recruitDelay(DEFAULT_CONFIG, String(camp.id), sequence + 1)).toISOString();
        if (rosterTotal(force) >= rule.defenderCap) {
            camp.next_recruit_at = new Date(until + recruitDelay(DEFAULT_CONFIG, String(camp.id), sequence + 1)).toISOString(); break;
        }
    }
    writeRoster(camp, force);
    const stock = { resources: camp.resources, producedAt: Date.parse(camp.stock_updated_at) };
    accrue(stock, rule.rates, rule.capacity, until); camp.stock_updated_at = new Date(stock.producedAt).toISOString();
}

