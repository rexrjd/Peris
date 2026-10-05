import { supabase } from './supabase'
import type { Command, GameEngine } from './local'
import type { World } from '../types/game'

export class OnlineEngine implements GameEngine {
  readonly mode='online' as const
  snapshot:World
  readonly playerId:string
  private listeners=new Set<()=>void>()
  private timer:number
  private channel:ReturnType<typeof supabase.channel>
  private busy=false
  private dirty=false
  private alive=true
  private realtimeTimer:number|undefined
  error:string|null=null
  connected=false
  constructor(playerId:string,snapshot:World){
    this.playerId=playerId;this.snapshot=snapshot
    this.channel=supabase.channel(`peris-v6-${playerId}`)
    for(const table of ['players','settlements','armies','buildings','battles','battle_formations','peris_orders','peris_challenges','peris_reports'])this.channel.on('postgres_changes',{event:'*',schema:'public',table},()=>{
      if(this.realtimeTimer!==undefined)return
      this.realtimeTimer=window.setTimeout(()=>{this.realtimeTimer=undefined;void this.refresh()},180)
    })
    this.channel.subscribe(status=>{this.connected=status==='SUBSCRIBED'})
    this.timer=window.setInterval(()=>void this.tick(),850)
  }
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  private notify(){this.listeners.forEach(fn=>fn())}
  async refresh(){
    if(!this.alive)return
    if(this.busy){this.dirty=true;return}
    this.busy=true
    try{
      const {data,error}=await supabase.rpc('peris_snapshot')
      if(error)throw error
      if(this.alive){this.snapshot=data as World;this.error=null;this.notify()}
    }catch(e){this.error=e instanceof Error?e.message:(e as {message?:string})?.message??'Connection interrupted.'}
    finally{this.busy=false;if(this.dirty&&this.alive){this.dirty=false;void this.refresh()}}
  }
  private ticking=false
  private async tick(){
    if(this.ticking||!this.alive)return;this.ticking=true
    try{
      const battle=this.snapshot.battles.find(b=>b.status==='active')
      if(battle&&battle.phase==='combat'){
        const {error}=await supabase.rpc('peris_tick',{p_battle_id:battle.id});if(error)throw error
      }else if(Math.floor(Date.now()/850)%3===0){const{error}=await supabase.rpc('sync_my_state');if(error)throw error}
      await this.refresh()
    }catch(e){this.error=(e as {message?:string})?.message??'Connection interrupted.'}
    finally{this.ticking=false}
  }
  command=async(cmd:Command)=>{
    let fn='',args:Record<string,unknown>={}
    if(cmd.type==='upgrade'){fn='peris_queue_upgrade';args={p_type:cmd.item}}
    if(cmd.type==='recruit'){fn='peris_queue_recruit';args={p_type:cmd.item,p_quantity:cmd.quantity}}
    if(cmd.type==='move'){fn='move_army';args={p_target_x:Math.round(cmd.x),p_target_y:Math.round(cmd.y)}}
    if(cmd.type==='raid'){fn='peris_raid';args={p_camp_id:cmd.campId}}
    if(cmd.type==='ready'){fn='peris_ready';args={p_battle_id:cmd.battleId}}
    if(cmd.type==='order'){fn='peris_order';args={p_battle_id:cmd.battleId,p_order:cmd.order}}
    if(cmd.type==='rally'){fn='peris_rally';args={p_battle_id:cmd.battleId}}
    if(cmd.type==='retreat'){fn='retreat_from_battle';args={p_battle_id:cmd.battleId}}
    if(cmd.type==='claim'){fn='peris_claim';args={p_quest_id:cmd.questId}}
    if(cmd.type==='rename'){fn='peris_rename';args={p_name:cmd.name}}
    if(cmd.type==='challenge'){fn='peris_challenge';args={p_defender:cmd.ownerId}}
    if(cmd.type==='respond'){fn='peris_respond';args={p_id:cmd.id,p_accept:cmd.accept}}
    const {error}=await supabase.rpc(fn,args)
    if(error)throw new Error(error.message)
    await this.refresh()
  }
  destroy=()=>{this.alive=false;window.clearInterval(this.timer);window.clearTimeout(this.realtimeTimer);void supabase.removeChannel(this.channel);this.listeners.clear()}
}
export async function enterOnline(name:string):Promise<OnlineEngine>{
  let {data:{session}}=await supabase.auth.getSession()
  if(!session){
    const result=await supabase.auth.signInAnonymously();if(result.error)throw new Error(result.error.message)
    session=result.data.session
  }
  if(!session)throw new Error('The account could not be created. Try again.')
  const {data:existing,error:checkError}=await supabase.from('players').select('id').eq('id',session.user.id).maybeSingle()
  if(checkError)throw new Error('Run supabase/UPGRADE_TO_V7.sql in the Supabase SQL Editor, then try again.')
  if(!existing){
    if(!/^[A-Za-z0-9 _-]{2,20}$/.test(name.trim()))throw new Error('Choose 2–20 letters, numbers, spaces, _ or -.')
    const {error}=await supabase.rpc('create_player',{p_display_name:name.trim()});if(error)throw new Error(error.message)
  }
  const {data,error}=await supabase.rpc('peris_snapshot')
  if(error)throw new Error(error.code==='PGRST202'?'Install the v7 SQL upgrade in Supabase first. Your existing realm will be preserved.':error.message)
  const sync=await supabase.rpc('sync_my_state');if(sync.error)throw new Error(sync.error.message)
  return new OnlineEngine(session.user.id,data as World)
}
