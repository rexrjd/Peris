import type { Command } from '../../shared/model/commands';
export function rpcCommand(cmd: Command) {
    let fn = '', args: Record<string, unknown> = {};
    if (cmd.type==='buildSlot' || cmd.type==='upgradeSlot') {
        fn='peris_queue_slot';args={p_slot:cmd.slot,p_type:cmd.type==='buildSlot'?cmd.item:null};
    }
    if (cmd.type === 'upgrade') {
        fn = 'peris_queue_upgrade';
        args = { p_type: cmd.item };
    }
    if (cmd.type === 'recruit') {
        fn = 'peris_queue_recruit';
        args = { p_type: cmd.item, p_quantity: cmd.quantity };
    }
    if (cmd.type === 'move') {
        fn = cmd.route ? 'peris_march' : 'move_army';
        args = { p_target_x: Math.round(cmd.x), p_target_y: Math.round(cmd.y) };
        if (cmd.route) args.p_path = cmd.route;
    }
    if (cmd.type === 'raid') {
        fn = 'peris_raid';
        args = { p_camp_id: cmd.campId };
    }
    if (cmd.type === 'ready') {
        fn = 'peris_ready';
        args = { p_battle_id: cmd.battleId };
    }
    if (cmd.type === 'order') {
        fn = 'peris_order';
        args = { p_battle_id: cmd.battleId, p_order: cmd.order };
    }
    if (cmd.type === 'rally') {
        fn = 'peris_rally';
        args = { p_battle_id: cmd.battleId };
    }
    if (cmd.type === 'retreat') {
        fn = 'retreat_from_battle';
        args = { p_battle_id: cmd.battleId };
    }
    if (cmd.type === 'claim') {
        fn = 'peris_claim';
        args = { p_quest_id: cmd.questId };
    }
    if (cmd.type === 'rename') {
        fn = 'peris_rename';
        args = { p_name: cmd.name };
    }
    if (cmd.type === 'challenge') {
        fn = 'peris_challenge';
        args = { p_defender: cmd.ownerId };
    }
    if (cmd.type === 'respond') {
        fn = 'peris_respond';
        args = { p_id: cmd.id, p_accept: cmd.accept };
    }
    return { fn, args };
}
