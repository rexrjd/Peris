import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { commandCity } from '../../empire/domain/context';
import { slotLevels } from '../../city/domain/slots';
import { affordable } from '../../city/domain/economy';
import { RESOURCES } from '../../../shared/model/resources';
import { RECRUIT_RULES, RECRUIT_UNITS } from './roster';
export function researchUnit(ctx: LocalCommandContext, cmd: Extract<Command, { type: 'researchUnit' }>) {
    if (!RECRUIT_UNITS.includes(cmd.item)) throw new Error('Choose a known unit.');
    const city = commandCity(ctx), rule = RECRUIT_RULES[cmd.item], research = ctx.world.unit_research ?? [];
    if (!rule.researchSeconds || research.some(entry => entry.settlement_id === city.id && entry.unit === cmd.item)) throw new Error('This unit is already researched or queued.');
    if (!slotLevels(ctx.world, city.id, rule.building)) throw new Error(`Build ${rule.building} first.`);
    if (!affordable(city, rule.researchCost)) throw new Error('Your stores cannot cover this research.');
    const start = Math.max(Date.parse(ctx.now), ...research.filter(entry => entry.settlement_id === city.id && RECRUIT_RULES[entry.unit].building === rule.building).map(entry => Date.parse(entry.completes_at)));
    for (const resource of RESOURCES) city[resource] -= rule.researchCost[resource];
    (ctx.world.unit_research ??= []).push({ settlement_id: city.id, unit: cmd.item, completes_at: new Date(start + rule.researchSeconds * 1000).toISOString() });
}
