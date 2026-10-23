import type {World} from '../../shared/model/world';

/** Polling observes authoritative timestamps; it never advances the simulation. */
export function statePollInterval(world:World,owner:string,hidden:boolean):number {
 if(world.battles.some(b=>b.status==='active'))return 850;
 const working=world.orders.some(o=>o.owner_id===owner)
  ||world.armies.some(a=>a.owner_id===owner&&(a.status==='moving'||a.raid_target_id!=null||a.raid_city_id!=null))
  ||world.settler_expeditions?.some(e=>e.owner_id===owner&&e.status==='travelling')
  ||world.ruin_evacuations?.some(e=>e.owner_id===owner)
  ||world.city_reinforcements?.some(e=>e.owner_id===owner)
  ||world.guild_reinforcements?.some(e=>(e.owner_id===owner||e.recipient_id===owner)&&e.status!=='stationed')
  ||world.trade_caravans?.some(e=>(e.owner_id===owner||e.recipient_id===owner)&&e.status!=='completed')
  ||world.account_science?.some(s=>s.owner_id===owner&&s.active_id)
  ||world.unit_research?.some(r=>Date.parse(r.completes_at)>Date.parse(world.server_now));
 return working?2550:hidden?30000:10000;
}

/** Background reads wait longer after failures. Explicit player commands remain explicit. */
export class PollBackoff {
 private failures=0;
 private until=0;
 ready(now:number){return now>=this.until;}
 reset(){this.failures=0;this.until=0;}
 fail(now:number){this.failures=Math.min(this.failures+1,5);this.until=now+Math.min(60000,5000*2**(this.failures-1));}
}
