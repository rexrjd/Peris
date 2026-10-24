import type { LocalCommandContext } from '../../../shared/model/commands';
import { accrueCamp } from './campStock';
import { marchArmy } from '../../map/domain/commands';
import { ensureCampaignFarmStats } from './farmStats';
import {rosterTotal} from '../../army/domain/roster';
/** Camp production belongs to the existing world. Active battles freeze defenders. */
export function advanceCampFarms(ctx: LocalCommandContext, until: number) {
    ensureCampaignFarmStats(ctx.world);
    for (const camp of ctx.world.camps) {
        const due=(ctx.world.scouting_missions??[]).filter(m=>m.target_camp_id===camp.id&&m.status==='outbound').map(m=>Date.parse(m.arrival_at));
        accrueCamp(camp,Math.min(until,...due),ctx.world.battles.some(b=>b.status==='active'&&b.camp_id===camp.id));
    }
    for (const farm of (ctx.world.campaign_farms ?? []).filter(f => f.owner_id === ctx.playerId && f.enabled && f.next_at && Date.parse(f.next_at) <= until).slice(0, 128)) {
        try {
            marchArmy({ ...ctx, armyId: farm.army_id, now: new Date(until).toISOString() }, { type: 'raid', campId: farm.camp_id, troops: farm.troops });
            const scouting=ctx.world.scouting_version===1&&(farm.troops.scout??0)>0&&rosterTotal(farm.troops)===farm.troops.scout;
            if(!scouting)ctx.world.armies.find(a => a.id === farm.army_id)!.farm_list_id = farm.list_id;
            farm.last_status = scouting?'Scouts preparing':'Raid preparing'; farm.sent = (farm.sent ?? 0) + 1;
        } catch (error) { farm.last_status = error instanceof Error ? error.message : 'Target unavailable'; farm.skipped = (farm.skipped ?? 0) + 1; }
        // Missed intervals are skipped; a resumed client never floods departures.
        farm.next_at = new Date(until + (farm.interval_seconds ?? 300) * 1000).toISOString();
    }
}
