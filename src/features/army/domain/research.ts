import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import { commandCity } from '../../empire/domain/context';
import { affordable } from '../../city/domain/economy';
import { RESOURCES } from '../../../shared/model/resources';
import { RECRUIT_RULES, RECRUIT_UNITS } from './roster';
import {unitTrainingLevel} from './trainingBuildings';
export function researchUnit(ctx: LocalCommandContext, cmd: Extract<Command, { type: 'researchUnit' }>) {
    if(cmd.item==='diplomat')throw new Error('Unlock diplomats through Diplomacy in Research.');
    if (!RECRUIT_UNITS.includes(cmd.item)) throw new Error('Choose a known unit.');
    const city = commandCity(ctx), rule = RECRUIT_RULES[cmd.item], research = ctx.world.unit_research ?? [];
    if (!rule.researchSeconds || research.some(entry => entry.settlement_id === city.id && entry.unit === cmd.item)) throw new Error('This unit is already researched or queued.');
    if (!unitTrainingLevel(ctx.world, city.id, cmd.item)) throw new Error(rule.building==='main'?'Upgrade the Main building to level 2 first.':`Build ${rule.building} first.`);
    if (!affordable(city, rule.researchCost)) throw new Error('Your stores cannot cover this research.');
    const start = Math.max(Date.parse(ctx.now), ...research.filter(entry => entry.settlement_id === city.id && RECRUIT_RULES[entry.unit].building === rule.building).map(entry => Date.parse(entry.completes_at)));
    for (const resource of RESOURCES) city[resource] -= rule.researchCost[resource];
    (ctx.world.unit_research ??= []).push({ settlement_id: city.id, unit: cmd.item, completes_at: new Date(start + rule.researchSeconds * 1000).toISOString() });
}
