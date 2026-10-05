import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
import { applyOrder } from './orders';
import { rallyFormations } from './morale';
import { finishBattle } from './resolution';
export function commandBattle(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'ready' | 'order' | 'rally' | 'retreat';
}>) {
    const w = context.world, now = context.now, active = context.active;
    if (cmd.type === 'ready') {
        if (!active || active.id !== cmd.battleId)
            throw new Error('Battle not found.');
        active.attacker_ready = true;
        active.phase = 'combat';
        active.started_at = now;
        context.paused(false);
    }
    else if (cmd.type === 'order') {
        if (!active || active.id !== cmd.battleId)
            throw new Error('Battle not found.');
        applyOrder(active, w.formations.filter(f => f.battle_id === active.id), context.playerId, cmd.order);
    }
    else if (cmd.type === 'rally') {
        if (!active || active.id !== cmd.battleId || active.phase !== 'combat')
            throw new Error('Rally is available during combat.');
        if (active.rally_attacker)
            throw new Error('Your general has already rallied the army.');
        active.rally_attacker = true;
        rallyFormations(w.formations.filter(f => f.battle_id === active.id && f.side === 'attacker'));
    }
    else if (cmd.type === 'retreat') {
        if (!active || active.id !== cmd.battleId)
            throw new Error('Battle not found.');
        finishBattle(active, w.formations.filter(f => f.battle_id === active.id), 'defender', 'Withdrawal');
        context.finalize(active.id);
    }
}
