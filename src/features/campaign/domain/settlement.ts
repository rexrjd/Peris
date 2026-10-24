import { worldGameNow } from '../../../shared/time/gameClock';
import {resolveScoutingEvent} from '../../scouting/domain/scouting';
import {tradeEvents,advanceTradeEvent,unloadWaitingCaravans} from '../../city/domain/trade';
import {advanceTradeRoutes} from '../../city/domain/tradeRoutes';
import { settleCityReinforcements } from '../../city/domain/cityReinforcements';
import { cityGarrisonAt, type CityGarrison } from '../../city/domain/cityGarrison';
import { addRosters, emptyRoster, readRoster, writeRoster } from '../../army/domain/roster';
import {ensureScience,advanceResearch,researchDeadline} from '../../research/domain/science';
import {refreshTroopUpkeep} from '../../city/domain/troopSupply';
import { isDefeated, settleRuinEvacuations, redirectFromLostStation } from '../../city/domain/ruins';
import { accrueResources } from '../../city/domain/economy';
import { completeUpgrade } from '../../city/domain/construction';
import { completeRecruit } from '../../army/domain/recruitment';
import { completeTravel } from '../../map/domain/movement';
import { type World } from '../../../shared/model/world';
import { completeMapField } from '../../map/domain/territory';
import { refreshCityEconomy } from '../../city/domain/slots';
import { accrueCulture, completeExpedition,nextEntityId } from '../../empire/domain/expansion';
import { deliverCampLoot } from './loot';
import { mergeStationGarrison } from '../../map/domain/garrisons';
import { ownedStation } from '../../map/domain/garrisons';

/** Complete all cities' queues in time order; every order belongs to one city/army. */
export function settleLocal(w: World, owner: string, now = worldGameNow(w), travel = true) {
    if(w.troop_upkeep_version===1){settleWithTroopSupply(w,owner,now,travel);return;}
    settleLegacy(w,owner,now,travel);
}

/** Legacy armies were free: finish that period before activating the new rules. */
export function activateTroopUpkeep(w:World,at:number){
    if(w.troop_upkeep_version===1){refreshTroopUpkeep(w,at);return;}
    for(const s of w.settlements)delete s.food_troop_upkeep;
    for(const p of w.players)settleLegacy(w,p.id,at);
    w.troop_upkeep_version=1;refreshTroopUpkeep(w,at);
}

/** Retained for old-save catch-up and as the queue completion kernel. */
function settleLegacy(w: World, owner: string, now:number, travel=true, routes=true) {
    const player = w.players.find(p => p.id === owner);
    if (!player || isDefeated(w,owner)) return;
    settleRuinEvacuations(w,owner,now);
    settleCityReinforcements(w, owner, now);
    ensureScience(w,owner);
    const events = [
        ...w.orders.filter(o => o.owner_id === owner && Date.parse(o.finish_at) <= now).map(order => ({ at: Date.parse(order.finish_at), order, expedition: undefined,trade:undefined })),
        ...(w.settler_expeditions ?? []).filter(e => e.owner_id === owner && e.status === 'travelling' && Date.parse(e.arrival_at) <= now).map(expedition => ({ at: Date.parse(expedition.arrival_at), expedition, order: undefined,trade:undefined })),
        ...tradeEvents(w,owner,now).map(trade=>({at:trade.at,trade,order:undefined,expedition:undefined})),
    ];
    const phaseOrder={delivery:0,redirect:1,return:2};
    const compareEvents=(a:typeof events[number],b:typeof events[number])=>a.at-b.at||Number(!!a.trade)-Number(!!b.trade)||(a.order?.id??a.expedition?.id??a.trade!.id)-(b.order?.id??b.expedition?.id??b.trade!.id)||(a.trade&&b.trade?phaseOrder[a.trade.phase]-phaseOrder[b.trade.phase]:0);
    events.sort(compareEvents);
    while(events.length) {
        const event=events.shift()!;
        advanceResearch(w,owner,event.at);
        accrueCulture(w, owner, event.at);
        if(event.trade){
            advanceTradeEvent(w,event.trade.id,event.trade.phase,event.at);
            for(const next of tradeEvents(w,owner,now))if(next.at>=event.at&&!events.some(e=>e.trade?.id===next.id&&e.trade.phase===next.phase&&e.at===next.at))events.push({at:next.at,trade:next,order:undefined,expedition:undefined});
            events.sort(compareEvents);continue;
        }
        if (event.expedition) {
            const source = w.settlements.find(s => s.id === event.expedition!.origin_settlement_id && s.owner_id===owner && !s.ruined_at)??w.settlements.filter(s=>s.owner_id===owner&&!s.ruined_at).sort((a,b)=>a.id-b.id)[0];
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
    unloadWaitingCaravans(w,owner,now);
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
    // Partial raid/import settlement leaves scheduled departures for the full arrival pass.
    if(travel&&routes)advanceTradeRoutes(w,owner,now,()=>nextEntityId(w));
}

/** Advance all connected suppliers before applying any transition at that instant. */
function settleWithTroopSupply(w:World,owner:string,until:number,routes:boolean){
    if(!w.players.some(p=>p.id===owner)||isDefeated(w,owner))return;
    const owners=new Set([owner]);
    for(let changed=true;changed;){changed=false;
        for(const p of [...(w.guild_reinforcements??[]),...(w.trade_caravans??[]).filter(c=>c.status!=='completed')]){
            if(owners.has(p.owner_id)||owners.has(p.recipient_id))for(const id of [p.owner_id,p.recipient_id])if(!owners.has(id)){owners.add(id);changed=true;}
        }
        for(const m of (w.scouting_missions??[]).filter(m=>m.status==='outbound'||m.status==='returning')){
            const participants=[m.owner_id,...(m.target_owner_id&&m.status==='outbound'?[m.target_owner_id]:[])];
            if(participants.some(id=>owners.has(id)))for(const id of participants)if(!owners.has(id)){owners.add(id);changed=true;}
        }
    }
    const cities=()=>w.settlements.filter(s=>owners.has(s.owner_id)&&!s.ruined_at);
    let cursor=Math.min(until,...cities().map(s=>Date.parse(s.resources_updated_at)));
    const complete=(at:number)=>{
        for(const id of [...owners].sort())settleLegacy(w,id,at,true,false);
        for(const p of w.guild_reinforcements??[]){
            if(!owners.has(p.owner_id)||p.status==='stationed'||!p.arrival_at||Date.parse(p.arrival_at)>at)continue;
            const target=w.settlements.find(s=>s.id===p.target_settlement_id&&!s.ruined_at);
            if(p.status==='outbound'&&target&&target.owner_id===p.recipient_id){p.status='stationed';continue;}
            if(p.status==='returning'&&target?.owner_id===p.owner_id){
                const g=cityGarrisonAt(w,target.id,p.owner_id);
                if(g)writeRoster(g,addRosters(readRoster(g),p.troops));
                else{const fresh:CityGarrison={owner_id:p.owner_id,settlement_id:target.id,...emptyRoster()};writeRoster(fresh,p.troops);(w.city_garrisons??=[]).push(fresh);}
                w.guild_reinforcements=w.guild_reinforcements?.filter(row=>row!==p);
            }
        }
        for(const m of (w.scouting_missions??[]).filter(m=>owners.has(m.owner_id)&&(m.status==='outbound'||m.status==='returning')&&Date.parse(m.arrival_at)<=at).sort((a,b)=>Date.parse(a.arrival_at)-Date.parse(b.arrival_at)||Number(a.status!=='returning')-Number(b.status!=='returning')||a.id-b.id))resolveScoutingEvent(w,m,()=>nextEntityId(w));
        refreshTroopUpkeep(w,at);
    };
    refreshTroopUpkeep(w,cursor);complete(cursor);
    while(cursor<until){
        const boundaries:number[]=[until];
        const add=(value:string|null|undefined)=>{if(value){const at=Date.parse(value);if(at>cursor&&at<=until)boundaries.push(at);}};
        for(const o of w.orders)if(owners.has(o.owner_id))add(o.finish_at);
        for(const e of w.settler_expeditions??[])if(owners.has(e.owner_id)&&e.status==='travelling')add(e.arrival_at);
        for(const a of w.armies)if(owners.has(a.owner_id)&&a.status==='moving'){add(a.departure_at);add(a.arrival_at);}
        for(const m of w.scouting_missions??[])if(owners.has(m.owner_id)&&(m.status==='outbound'||m.status==='returning')){if(m.status==='outbound')add(m.departure_at);add(m.arrival_at);}
        for(const p of [...(w.city_reinforcements??[]),...(w.ruin_evacuations??[])])if(owners.has(p.owner_id))add(p.arrival_at);
        for(const p of w.guild_reinforcements??[])if(owners.has(p.owner_id)&&p.status!=='stationed')add(p.arrival_at);
        for(const id of owners){for(const t of tradeEvents(w,id,until))if(t.at>cursor)boundaries.push(t.at);const due=researchDeadline(w,id);if(due>cursor&&due<=until)boundaries.push(due);}
        const at=Math.min(...boundaries);
        for(const s of cities().sort((a,b)=>a.id-b.id))accrueResources(s,at,w);
        cursor=at;complete(at);
    }
    if(routes)for(const id of [...owners].sort())advanceTradeRoutes(w,id,until,()=>nextEntityId(w));
    refreshTroopUpkeep(w,until);
}
