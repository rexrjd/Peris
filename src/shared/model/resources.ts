export type Resources = {
    wood: number;
    stone: number;
    food: number;
    gold: number;
};
export const RESOURCES = ['wood', 'stone', 'food', 'gold'] as const;
export const emptyResources = (): Resources => ({ wood: 0, stone: 0, food: 0, gold: 0 });
export function multiply(bag: Resources, n: number): Resources { return Object.fromEntries(RESOURCES.map(k => [k, Math.ceil(bag[k] * n)])) as Resources; }
