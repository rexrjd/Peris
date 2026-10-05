import { type World } from '../../../shared/model/world';
import { newBattle } from '../../battle/domain/creation';
export function beginRaid(world: World, owner: string, campId: number, nextId: () => number) {
    const camp = world.camps.find(c => c.id === campId)!, a = world.armies[0];
    const instance = newBattle(nextId(), owner, a, camp, camp.terrain, camp.tier >= 4 ? 'hard' : camp.tier === 1 ? 'easy' : 'normal', camp.name, 'pve', camp.id);
    const wall = world.buildings.find(b => b.building_type === 'wall')?.level ?? 1;
    instance.formations.filter(f => f.owner_id === owner).forEach(f => f.morale = Math.min(100, 90 + wall * 2));
    world.battles.push(instance.battle);
    world.formations.push(...instance.formations);
}
