import type { LocalCommandContext } from '../../../shared/model/commands';
import { accrueCamp } from './campStock';
import { marchArmy } from '../../map/domain/commands';
/** Camp production belongs to the existing world. Active battles freeze defenders. */
export function advanceCampFarms(ctx: LocalCommandContext, until: number) {
    for (const camp of ctx.world.camps) accrueCamp(camp, until, ctx.world.battles.some(b => b.status === 'active' && b.camp_id === camp.id));
    for (const farm of (ctx.world.campaign_farms ?? []).filter(f => f.owner_id === ctx.playerId && f.enabled && f.next_at && Date.parse(f.next_at) <= until).slice(0, 128)) {
        try {
            marchArmy({ ...ctx, armyId: farm.army_id, now: new Date(until).toISOString() }, { type: 'raid', campId: farm.camp_id, troops: farm.troops });
            ctx.world.armies.find(a => a.id === farm.army_id)!.farm_list_id = farm.list_id;
            farm.last_status = 'Raid preparing';
        } catch (error) { farm.last_status = error instanceof Error ? error.message : 'Target unavailable'; }
        // Missed intervals are skipped; a resumed client never floods departures.
        farm.next_at = new Date(until + (farm.interval_seconds ?? 300) * 1000).toISOString();
    }
}
