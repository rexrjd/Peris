import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
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
    else if(cmd.type==='order'||cmd.type==='rally'){
        throw new Error('Both armies are controlled automatically.');
    }
    else if (cmd.type === 'retreat') {
        if (!active || active.id !== cmd.battleId)
            throw new Error('Battle not found.');
        finishBattle(active, w.formations.filter(f => f.battle_id === active.id), 'defender', 'Withdrawal');
        context.finalize(active.id);
    }
}
