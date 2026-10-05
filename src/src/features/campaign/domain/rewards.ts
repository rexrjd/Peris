import { type Resources } from '../../../shared/model/resources';
export function lootFor(tier: number): Resources { return { wood: 180 * tier, stone: 140 * tier, food: 220 * tier, gold: 60 * tier }; }
