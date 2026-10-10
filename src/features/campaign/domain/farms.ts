import type { Command, LocalCommandContext } from '../../../shared/model/commands';
import type { World } from '../../../shared/model/world';
import type { CampaignFarmTroops } from './types';
import { marchArmy } from '../../map/domain/commands';

export const CAMPAIGN_FARM_LIMITS = { lists: 50, targetsPerList: 100, soldiers: 1000, nameLength: 40 } as const;
const roles = ['infantry', 'archers', 'cavalry'] as const;
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;
function validTroops(troops: unknown, allowEmpty: boolean): troops is CampaignFarmTroops {
    if (!troops || typeof troops !== 'object') return false;
    const party = troops as CampaignFarmTroops;
    if (roles.some(role => !Number.isSafeInteger(party[role]) || party[role] < 0 || party[role] > CAMPAIGN_FARM_LIMITS.soldiers)) return false;
    const total = roles.reduce((sum, role) => sum + party[role], 0);
    return total <= CAMPAIGN_FARM_LIMITS.soldiers && (allowEmpty || total > 0);
}
const validName = (name: unknown): name is string => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= CAMPAIGN_FARM_LIMITS.nameLength;
const copyTroops = (troops: CampaignFarmTroops): CampaignFarmTroops => ({ infantry: troops.infantry, archers: troops.archers, cavalry: troops.cavalry });
type FarmCommand = Extract<Command, { type: 'saveCampaignFarmList' | 'saveCampaignFarm' | 'deleteCampaignFarmList' | 'deleteCampaignFarm' | 'startCampaignFarmList' }>;
export type CampaignFarmBatchResult = { started: number; skipped: { targetId: number; reason: string }[] };

/** One manual batch, in saved target order. Existing raid rules spend each available legion once. */
export function startCampaignFarmList(ctx: LocalCommandContext, id: number): CampaignFarmBatchResult {
    if (!validId(id) || !ctx.world.campaign_farm_lists?.some(list => list.id === id && list.owner_id === ctx.playerId)) throw new Error('Choose your own farm list.');
    const result: CampaignFarmBatchResult = { started: 0, skipped: [] };
    const targets = (ctx.world.campaign_farms ?? []).filter(farm => farm.list_id === id && farm.owner_id === ctx.playerId).slice().sort((a, b) => a.id - b.id);
    const active = ctx.world.battles.some(battle => battle.status === 'active' && (battle.attacker_owner_id === ctx.playerId || battle.defender_owner_id === ctx.playerId));
    for (const farm of targets) {
        try {
            if (active) throw new Error('Finish the current battle first.');
            if (!ctx.world.camps.some(camp => camp.id === farm.camp_id && camp.bandit === true)) throw new Error('Only bandit camps can be started from a farm list.');
            if (!validTroops(farm.troops, false)) throw new Error('Choose a saved party of 1–1,000 soldiers.');
            marchArmy({ ...ctx, armyId: farm.army_id }, { type: 'raid', campId: farm.camp_id, troops: copyTroops(farm.troops) });
            result.started++;
        } catch (error) {
            result.skipped.push({ targetId: farm.id, reason: error instanceof Error ? error.message : 'This target is unavailable.' });
        }
    }
    if (!result.started) throw new Error(`No raids started. ${result.skipped[0]?.reason ?? 'Add camp targets to this list first.'}`);
    return result;
}

/** Plans remain metadata until the player explicitly starts their list. */
export function commandCampaignFarm(ctx: LocalCommandContext, cmd: FarmCommand): CampaignFarmBatchResult | void {
    const world = ctx.world, lists = world.campaign_farm_lists ?? [], farms = world.campaign_farms ?? [], owner = ctx.playerId;
    if (cmd.id !== undefined && !validId(cmd.id)) throw new Error('Choose a valid saved farm.');
    if (cmd.type === 'startCampaignFarmList') return startCampaignFarmList(ctx, cmd.id);
    if (cmd.type === 'saveCampaignFarmList') {
        if (!validName(cmd.name)) throw new Error('Use a farm list name of 2–40 characters.');
        if (!validTroops(cmd.troops, true) || typeof cmd.casualtiesOnly !== 'boolean') throw new Error('Choose a troop preset of up to 1,000 soldiers and a report preference.');
        const list = cmd.id === undefined ? undefined : lists.find(list => list.id === cmd.id && list.owner_id === owner);
        if (cmd.id !== undefined && !list) throw new Error('Choose your own farm list.');
        if (!list && lists.filter(list => list.owner_id === owner).length >= CAMPAIGN_FARM_LIMITS.lists) throw new Error('You can save up to 50 campaign farm lists.');
        if (list) Object.assign(list, { name: cmd.name.trim(), troops: copyTroops(cmd.troops), casualties_only: cmd.casualtiesOnly });
        else (world.campaign_farm_lists ??= []).push({ id: ctx.nextId(), owner_id: owner, name: cmd.name.trim(), troops: copyTroops(cmd.troops), casualties_only: cmd.casualtiesOnly });
    } else if (cmd.type === 'saveCampaignFarm') {
        if (![cmd.listId, cmd.campId, cmd.armyId].every(validId)) throw new Error('Choose a farm list, camp and legion.');
        if (!lists.some(list => list.id === cmd.listId && list.owner_id === owner)) throw new Error('Choose your own farm list.');
        if (!world.camps.some(camp => camp.id === cmd.campId && camp.bandit === true)) throw new Error('Only bandit camps can be saved. Story locations are manual encounters.');
        if (!world.armies.some(army => army.id === cmd.armyId && army.owner_id === owner)) throw new Error('Choose your own legion.');
        if (!validTroops(cmd.troops, false)) throw new Error('Save a party of 1–1,000 soldiers.');
        const existing = farms.find(farm => farm.owner_id === owner && farm.list_id === cmd.listId && farm.camp_id === cmd.campId);
        const farm = cmd.id === undefined ? existing : farms.find(farm => farm.id === cmd.id && farm.owner_id === owner);
        if (cmd.id !== undefined && !farm) throw new Error('Choose your own saved farm.');
        if (existing && farm !== existing) throw new Error('This camp is already in that farm list.');
        if ((!farm || farm.list_id !== cmd.listId) && farms.filter(farm => farm.list_id === cmd.listId).length >= CAMPAIGN_FARM_LIMITS.targetsPerList) throw new Error('A campaign farm list holds up to 100 targets.');
        if (farm) Object.assign(farm, { list_id: cmd.listId, camp_id: cmd.campId, army_id: cmd.armyId, troops: copyTroops(cmd.troops) });
        else (world.campaign_farms ??= []).push({ id: ctx.nextId(), owner_id: owner, list_id: cmd.listId, camp_id: cmd.campId, army_id: cmd.armyId, troops: copyTroops(cmd.troops), created_at: ctx.now });
    } else if (cmd.type === 'deleteCampaignFarm') {
        if (!farms.some(farm => farm.id === cmd.id && farm.owner_id === owner)) throw new Error('Choose your own saved farm.');
        world.campaign_farms = farms.filter(farm => farm.id !== cmd.id);
    } else {
        if (!lists.some(list => list.id === cmd.id && list.owner_id === owner)) throw new Error('Choose your own farm list.');
        if (farms.some(farm => farm.list_id === cmd.id)) throw new Error('Remove or move this list’s targets before deleting it.');
        world.campaign_farm_lists = lists.filter(list => list.id !== cmd.id);
    }
}

/** Optional metadata keeps older saves valid; malformed imports cannot add foreign targets. */
export function validateCampaignFarms(world: World): void {
    const invalid = () => { throw new Error('This file is not a valid Peris campaign save.'); };
    if (world.campaign_farm_lists !== undefined && !Array.isArray(world.campaign_farm_lists) || world.campaign_farms !== undefined && !Array.isArray(world.campaign_farms)) invalid();
    const lists = world.campaign_farm_lists ?? [], farms = world.campaign_farms ?? [], owners = new Set(world.players.map(player => player.id));
    if (lists.length > CAMPAIGN_FARM_LIMITS.lists * owners.size || farms.length > CAMPAIGN_FARM_LIMITS.lists * CAMPAIGN_FARM_LIMITS.targetsPerList * owners.size) invalid();
    const listIds = new Set<number>(), farmIds = new Set<number>(), targets = new Set<string>();
    for (const list of lists) {
        if (!list || !validId(list.id) || listIds.has(list.id) || !owners.has(list.owner_id) || !validName(list.name) || !validTroops(list.troops, true) || typeof list.casualties_only !== 'boolean') invalid();
        listIds.add(list.id);
    }
    for (const owner of owners) if (lists.filter(list => list.owner_id === owner).length > CAMPAIGN_FARM_LIMITS.lists) invalid();
    for (const farm of farms) {
        if (!farm || !validId(farm.id) || farmIds.has(farm.id) || !owners.has(farm.owner_id) || !lists.some(list => list.id === farm.list_id && list.owner_id === farm.owner_id) || !world.camps.some(camp => camp.id === farm.camp_id && camp.bandit === true) || !world.armies.some(army => army.id === farm.army_id && army.owner_id === farm.owner_id) || !validTroops(farm.troops, false) || typeof farm.created_at !== 'string' || !Number.isFinite(Date.parse(farm.created_at))) invalid();
        const key = `${farm.list_id}:${farm.camp_id}`;
        if (targets.has(key)) invalid();
        targets.add(key); farmIds.add(farm.id);
    }
    for (const list of lists) if (farms.filter(farm => farm.list_id === list.id).length > CAMPAIGN_FARM_LIMITS.targetsPerList) invalid();
}
