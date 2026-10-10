import { emptyResources, RESOURCES, type Resources } from '../../../shared/model/resources';
import type { Stock } from './types';

function nonnegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Mutates stock. Produced is gross income; overflow is discarded stock, including existing excess. */
export function accrue(stock: Stock, rates: Resources, capacity: Resources, until: number): { produced: Resources; overflow: Resources } {
    const produced = emptyResources(), overflow = emptyResources();
    // An invalid starting timestamp cannot justify historical production.
    const previous = Number.isFinite(stock.producedAt) ? stock.producedAt : (Number.isFinite(until) ? until : 0);
    const next = Number.isFinite(until) ? Math.max(previous, until) : previous;
    const minutes = Math.min(Number.MAX_VALUE, Math.max(0, (next - previous) / 60000));
    for (const resource of RESOURCES) {
        produced[resource] = Math.min(Number.MAX_VALUE, nonnegative(rates[resource]) * minutes);
        const available = Math.min(Number.MAX_VALUE, nonnegative(stock.resources[resource]) + produced[resource]);
        stock.resources[resource] = Math.min(nonnegative(capacity[resource]), available);
        overflow[resource] = available - stock.resources[resource];
    }
    stock.producedAt = next;
    return { produced, overflow };
}

/** Returns loot without mutating the source. Whole resources are apportioned by largest remainder. */
export function takeLoot(resources: Resources, capacity: number): Resources {
    const loot = emptyResources();
    const integer = (value: number) => BigInt(Math.floor(Math.min(Number.MAX_SAFE_INTEGER, nonnegative(value))));
    const available = RESOURCES.map(resource => ({ resource, amount: integer(resources[resource]) }));
    const total = available.reduce((sum, entry) => sum + entry.amount, 0n);
    const limit = integer(capacity), target = limit < total ? limit : total;
    if (target === 0n || total === 0n) return loot;

    let assigned = 0n;
    const shares = available.map(({ resource, amount }, index) => {
        const numerator = amount * target, share = numerator / total;
        loot[resource] = Number(share);
        assigned += share;
        return { resource, amount, remainder: numerator % total, index };
    });
    shares.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
    // The sum of four floors leaves at most three units to allocate.
    for (const share of shares) {
        if (assigned === target) break;
        if (BigInt(loot[share.resource]) < share.amount) {
            loot[share.resource]++;
            assigned++;
        }
    }
    return loot;
}
