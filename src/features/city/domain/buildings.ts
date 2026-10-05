import { type BuildingType } from './types';
import { type Resources } from '../../../shared/model/resources';
export const BUILDINGS: Record<BuildingType, {
    name: string;
    description: string;
    cost: Resources;
    effect: string;
    color: string;
}> = {
    lumber: { name: 'Timber yard', description: 'Cut timber from the northern woodland.', cost: { wood: 150, stone: 90, food: 70, gold: 10 }, effect: '+8 timber / min per level', color: '#879872' },
    quarry: { name: 'Stone quarry', description: 'Stone for roads, walls and a growing city.', cost: { wood: 110, stone: 150, food: 70, gold: 10 }, effect: '+7 stone / min per level', color: '#aca793' },
    farm: { name: 'Wheat fields', description: 'A fed population is the foundation of an empire.', cost: { wood: 100, stone: 80, food: 150, gold: 8 }, effect: '+10 food / min per level', color: '#c6b574' },
    market: { name: 'Forum', description: 'Merchants bring silver to your treasury.', cost: { wood: 140, stone: 130, food: 80, gold: 25 }, effect: '+3 gold / min per level', color: '#b69c69' },
    barracks: { name: 'Barracks', description: 'Train disciplined infantry and skilled bowmen.', cost: { wood: 180, stone: 160, food: 100, gold: 30 }, effect: 'Faster infantry and archer training', color: '#be876f' },
    stables: { name: 'Stables', description: 'Raise mounted troops for decisive flank attacks.', cost: { wood: 200, stone: 120, food: 180, gold: 45 }, effect: 'Faster cavalry training', color: '#b98b64' },
    wall: { name: 'City walls', description: 'Hold the gate. Every level strengthens army morale.', cost: { wood: 100, stone: 240, food: 80, gold: 25 }, effect: '+2 starting morale per level (max 100)', color: '#a7aaa3' },
    storehouse: { name: 'Granary', description: 'Keep surplus supplies safe for the next campaign.', cost: { wood: 200, stone: 150, food: 90, gold: 20 }, effect: '+2,500 resource capacity per level', color: '#c2ae88' },
};
