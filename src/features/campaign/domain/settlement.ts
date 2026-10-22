import { settleCityReinforcements } from '../../city/domain/cityReinforcements';
import { cityGarrisonAt, type CityGarrison } from '../../city/domain/cityGarrison';
import { addRosters, emptyRoster, readRoster, writeRoster } from '../../army/domain/roster';
import {ensureScience,advanceResearch} from '../../research/domain/science';
import { isDefeated, settleRuinEvacuations, redirectFromLostStation } from '../../city/domain/ruins';
import { accrueResources } from '../../city/domain/economy';
import { completeUpgrade } from '../../city/domain/construction';
import { completeRecruit } from '../../army/domain/recruitment';
import { completeTravel } from '../../map/domain/movement';
import { type World } from '../../../shared/model/world';
import { completeMapField } from '../../map/domain/territory';
import { refreshCityEconomy } from '../../city/domain/slots';
import { accrueCulture, completeExpedition } from '../../empire/domain/expansion';
import { deliverCampLoot } from './loot';
import { mergeStationGarrison } from '../../map/domain/garrisons';
import { ownedStation } from '../../map/domain/garrisons';

/** Complete all cities' queues in time order; every order belongs to one city/army. */
export function settleLocal(w: World, owner: string, now = Date.now(), travel = true) {
    const player = w.players.find(p => p.id === owner);
    if (!player || isDefeated(w,owner)) return;
    settleRuinEvacuations(w,owner,now);
    settleCityReinforcements(w, owner, now);
    ensureScience(w,owner);
    const events = [
        ...w.orders.filter(o => o.owner_id === owner && Date.parse(o.finish_at) <= now).map(order => ({ at: Date.parse(order.finish_at), order, expedition: undefined })),
        ...(w.settler_expeditions ?? []).filter(e => e.owner_id === owner && e.status === 'travelling' && Date.parse(e.arrival_at) <= now).map(expedition => ({ at: Date.parse(expedition.arrival_at), expedition, order: undefined })),
    ].sort((a, b) => a.at - b.at || (a.order?.id ?? a.expedition!.id) - (b.order?.id ?? b.expedition!.id));
    for (const event of events) {
        advanceResearch(w,owner,event.at);
        accrueCulture(w, owner, event.at);
        if (event.expedition) {
            const source = w.settlements.find(s => s.id === event.expedition!.origin_settlement_id && !s.ruined_at);
            if(!source){event.expedition.status='returned';continue;}
            if (source) accrueResources(source, event.at);
            completeExpedition(w, event.expedition); continue;
        }
        const order = event.order!;
        const city = w.settlements.find(s => s.owner_id === owner && s.id === (order.settlement_id ?? w.settlements.find(s => s.owner_id === owner)?.id));
        if (!city || city.ruined_at) { w.orders=w.orders.filter(o=>o.id!==order.id);continue; }
        accrueResources(city, event.at);
        if (order.kind === 'field') { completeMapField(w, owner, order); refreshCityEconomy(w, city.id, city.population !== undefined); }
        else if (order.kind === 'upgrade') completeUpgrade(w, city, player, order);
        else if (order.kind === 'settler') city.settlers = (city.settlers ?? 0) + order.quantity;
        else if (order.recruit_destination === 'garrison') {
            const permanent = cityGarrisonAt(w, city.id, owner);
            const troops = emptyRoster();
            const unit = order.item as keyof typeof troops;
            if (!(unit in troops)) throw new Error('Unknown garrison recruitment unit.');
            troops[unit] = order.quantity;
            if (permanent) writeRoster(permanent, addRosters(readRoster(permanent), troops));
            else {
                const fresh: CityGarrison = { owner_id: owner, settlement_id: city.id, ...emptyRoster() };
                writeRoster(fresh, troops);
                (w.city_garrisons ??= []).push(fresh);
            }
            player.recruits += order.quantity;
        }
        else {
            const army = w.armies.find(a => a.owner_id === owner && a.id === (order.army_id ?? w.armies.find(a => a.owner_id === owner)?.id));
            if (!army) throw new Error('The army for this training order is missing.');
            completeRecruit(army, player, order);
        }
        w.orders = w.orders.filter(o => o.id !== order.id);
    }
    advanceResearch(w,owner,now);
    accrueCulture(w, owner, now);
    for (const city of w.settlements.filter(s => s.owner_id === owner && !s.ruined_at)) accrueResources(city, now);
    if (travel) for (const army of w.armies.filter(a => a.owner_id === owner)) {
        if(army.raid_target_id===null&&army.raid_city_id===null&& !ownedStation(w,owner,{x:army.target_x,y:army.target_y})) redirectFromLostStation(w,army,now);
        const arriving = army.status === 'moving' && Date.parse(army.arrival_at) <= now;
        completeTravel(army, now);
        if (arriving && army.raid_target_id === null && army.raid_city_id==null) {
            deliverCampLoot(w, army);
            mergeStationGarrison(w, army);
            army.march_origin = null; army.march_returning = false;
            army.march_sent_at = null; army.march_cancel_until = null;
        }
    }
}
