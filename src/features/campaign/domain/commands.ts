import { commandCity } from '../../empire/domain/context';
import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { QUESTS } from './quests';
import { RESOURCES } from '../../../shared/model/resources';
export function claimObjective(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'claim';
}>) {
    const w = context.world, s = commandCity(context), p = w.players.find(p => p.id === context.playerId)!;
    const q = QUESTS.find(q => q.id === cmd.questId);
    if (!q)
        throw new Error('Objective not found.');
    if (w.claims.some(c => c.quest_id === q.id))
        throw new Error('Reward already claimed.');
    if (p[q.stat] < q.target)
        throw new Error('Complete the objective first.');
    w.claims.push({ quest_id: q.id, owner_id: context.playerId });
    for (const k of RESOURCES)
        s[k] = Math.min(k==='food' ? s.food_capacity ?? s.capacity : s.capacity, s[k] + q.reward[k]);
}
