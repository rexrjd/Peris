import { type Command, type LocalCommandContext } from '../../../shared/model/commands';
export function renameCity(context: LocalCommandContext, cmd: Extract<Command, {
    type: 'rename';
}>) {
    const s = context.world.settlements[0];
    if (cmd.name.trim().length < 2 || cmd.name.trim().length > 32)
        throw new Error('Use a name of 2–32 characters.');
    s.name = cmd.name.trim();
}
