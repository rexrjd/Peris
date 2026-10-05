import type { BattleOrder, BuildingType, Difficulty, Terrain, UnitType, World } from '../types/game'
import { applyOrder, finishBattle, newBattle, stepBattle } from '../game/simulation'
import { affordable, armyPosition, buildingCost, CAMPS, dist, lootFor, multiply, QUESTS, recruitSeconds, RESOURCES, soldierTotal, UNITS, upgradeSeconds } from '../game/rules'

export const SAVE_KEY='peris-campaign-v6'
export type Command =
  | {type:'upgrade';item:BuildingType}
  | {type:'recruit';item:UnitType;quantity:number}
  | {type:'move';x:number;y:number}
  | {type:'raid';campId:number}
  | {type:'ready';battleId:number}
  | {type:'order';battleId:number;order:BattleOrder}
  | {type:'retreat';battleId:number}
  | {type:'rally';battleId:number}
  | {type:'claim';questId:string}
  | {type:'rename';name:string}
  | {type:'challenge';ownerId:string}
  | {type:'respond';id:number;accept:boolean}

export interface GameEngine {
  readonly playerId:string;readonly mode:'solo'|'online'|'practice'
  snapshot:World;subscribe:(fn:()=>void)=>()=>void;command:(cmd:Command)=>Promise<void>
  destroy:()=>void
}

export function createSolo(name:string):World {
  const now=new Date().toISOString(),owner='solo-ruler'
  return {version:6,server_now:now,players:[{id:owner,display_name:name,created_at:now,prestige:0,victories:0,recruits:0,upgrades:0}],settlements:[{id:1,owner_id:owner,name:`${name}'s Keep`,x:155,y:285,wood:1250,stone:1000,food:1500,gold:500,wood_rate:22,stone_rate:19,food_rate:28,gold_rate:6,resources_updated_at:now,created_at:now,capacity:7500}],buildings:(['lumber','quarry','farm','market','barracks','stables','wall','storehouse'] as BuildingType[]).map((t,i)=>({id:i+1,settlement_id:1,building_type:t,level:1,updated_at:now})),armies:[{id:1,owner_id:owner,home_settlement_id:1,name:'Legio I · The Dawn',infantry:120,archers:50,cavalry:16,start_x:195,start_y:315,target_x:195,target_y:315,departure_at:now,arrival_at:now,status:'idle',updated_at:now,raid_target_id:null}],camps:CAMPS.map(c=>({...c})),orders:[],battles:[],formations:[],reports:[],progress:[],claims:[],challenges:[]}
}

/** Resolve income in chronological segments, including offline queue completions. */
export function settleLocal(w:World,owner:string,now=Date.now()){
  const s=w.settlements.find(s=>s.owner_id===owner),p=w.players.find(p=>p.id===owner),a=w.armies.find(a=>a.owner_id===owner)
  if(!s||!p||!a)return
  const accrue=(until:number)=>{
    const minutes=Math.max(0,until-Date.parse(s.resources_updated_at))/60000
    for(const key of RESOURCES)s[key]=Math.min(s.capacity,s[key]+s[`${key}_rate`]*minutes)
    s.resources_updated_at=new Date(Math.max(until,Date.parse(s.resources_updated_at))).toISOString()
  }
  const done=w.orders.filter(o=>o.owner_id===owner&&Date.parse(o.finish_at)<=now).sort((a,b)=>Date.parse(a.finish_at)-Date.parse(b.finish_at))
  for(const o of done){
    accrue(Date.parse(o.finish_at))
    if(o.kind==='upgrade'){
      const building=w.buildings.find(b=>b.settlement_id===s.id&&b.building_type===o.item)!
      building.level++;building.updated_at=o.finish_at;p.upgrades++
      const l=building.level
      if(o.item==='lumber')s.wood_rate=14+l*8
      if(o.item==='quarry')s.stone_rate=12+l*7
      if(o.item==='farm')s.food_rate=18+l*10
      if(o.item==='market')s.gold_rate=3+l*3
      if(o.item==='storehouse')s.capacity=5000+l*2500
    }else{a[o.item as UnitType]+=o.quantity;p.recruits+=o.quantity}
    w.orders=w.orders.filter(q=>q.id!==o.id)
  }
  accrue(now)
  if(a.status==='moving'&&Date.parse(a.arrival_at)<=now){a.status='idle';a.start_x=a.target_x;a.start_y=a.target_y}
}

export class LocalEngine implements GameEngine {
  readonly playerId='solo-ruler'
  readonly mode:'solo'|'practice'
  snapshot:World
  private listeners=new Set<()=>void>()
  private timer:number
  private last=performance.now()
  private nextSave=0
  private persistent:boolean
  private alive=true
  private nextId:number
  private finalized=new Set<number>()
  speed=1
  paused=false
  saveError=false
  constructor(world:World,persistent=true){
    this.snapshot=world;this.mode=persistent?'solo':'practice';this.persistent=persistent
    this.nextId=Math.max(100,Date.now()%100000000)
    this.snapshot.battles.filter(b=>b.status==='resolved').forEach(b=>this.finalized.add(b.id))
    settleLocal(world,this.playerId)
    this.timer=window.setInterval(()=>this.tick(),50)
    this.save()
  }
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  private publish(){this.snapshot={...this.snapshot,server_now:new Date().toISOString()};this.listeners.forEach(fn=>fn())}
  private save(){if(this.persistent)try{localStorage.setItem(SAVE_KEY,JSON.stringify(this.snapshot));this.saveError=false}catch{this.saveError=true}}
  private active(){return this.snapshot.battles.find(b=>b.status==='active')}
  private tick(){
    const now=performance.now(),dt=Math.min(.5,(now-this.last)/1000);this.last=now
    const b=this.active()
    if(b&&b.phase==='combat'&&!this.paused){
      let remaining=dt*this.speed
      while(remaining>0&&b.status==='active'){const step=Math.min(.05,remaining);stepBattle(b,this.snapshot.formations.filter(f=>f.battle_id===b.id),step);remaining-=step}
      if(b.status==='resolved')this.finalize(b.id)
    }
    if(Math.floor(now/250)!==Math.floor((now-dt*1000)/250)){
      settleLocal(this.snapshot,this.playerId)
      const army=this.snapshot.armies[0]
      if(!this.active()&&army.raid_target_id&&army.status==='idle'){
        const camp=this.snapshot.camps.find(c=>c.id===army.raid_target_id)!
        army.raid_target_id=null;this.beginRaid(camp.id)
      }
      this.publish()
    }
    if(now>this.nextSave){this.nextSave=now+2000;this.save()}
  }
  private beginRaid(campId:number){
    const camp=this.snapshot.camps.find(c=>c.id===campId)!,a=this.snapshot.armies[0]
    const instance=newBattle(++this.nextId,this.playerId,a,camp,camp.terrain,camp.tier>=4?'hard':camp.tier===1?'easy':'normal',camp.name,'pve',camp.id)
    const wall=this.snapshot.buildings.find(b=>b.building_type==='wall')?.level??1
    instance.formations.filter(f=>f.owner_id===this.playerId).forEach(f=>f.morale=Math.min(100,90+wall*2))
    this.snapshot.battles.push(instance.battle);this.snapshot.formations.push(...instance.formations)
  }
  startPractice(terrain:Terrain,difficulty:Difficulty,doctrine:'balanced'|'infantry'|'cavalry'='balanced'){
    const composition=doctrine==='infantry'?{infantry:320,archers:60,cavalry:12}:doctrine==='cavalry'?{infantry:160,archers:60,cavalry:90}:{infantry:200,archers:90,cavalry:36}
    const a={...this.snapshot.armies[0],...composition}
    const factor=difficulty==='easy'?.72:difficulty==='hard'?1.24:1
    const total=soldierTotal(composition)
    const enemy={infantry:Math.round(total*.57*factor),archers:Math.round(total*.27*factor),cavalry:Math.round(total*.12*factor)}
    const instance=newBattle(++this.nextId,this.playerId,a,enemy,terrain,difficulty,'The Crimson Host','practice')
    this.snapshot.battles=[instance.battle];this.snapshot.formations=instance.formations;this.publish()
  }
  private finalize(id:number){
    if(this.finalized.has(id))return;this.finalized.add(id)
    const w=this.snapshot,b=w.battles.find(b=>b.id===id)!,result=b.result!,won=b.winner_side==='attacker'
    if(b.mode==='practice'){this.publish();return}
    settleLocal(w,this.playerId)
    const a=w.armies[0],s=w.settlements[0],p=w.players[0]
    for(const type of ['infantry','archers','cavalry'] as UnitType[])a[type]=w.formations.filter(f=>f.battle_id===id&&f.side==='attacker'&&f.unit_type===type).reduce((sum,f)=>sum+f.soldiers,0)
    if(won){
      p.victories++;const camp=w.camps.find(c=>c.id===b.camp_id)!,loot=lootFor(camp.tier);result.loot=loot;p.prestige+=camp.tier*25
      for(const key of RESOURCES)s[key]=Math.min(s.capacity,s[key]+loot[key])
      const old=w.progress.find(c=>c.camp_id===camp.id)
      if(old){old.defeated++;old.available_at=new Date(Date.now()+120000).toISOString()}
      else w.progress.push({camp_id:camp.id,owner_id:this.playerId,defeated:1,available_at:new Date(Date.now()+120000).toISOString()})
    }
    w.reports.unshift({id:++this.nextId,owner_id:this.playerId,battle_id:id,title:b.enemy_name,won,result:{...result},created_at:new Date().toISOString()})
    // The field army regroups at home. No troop restoration is hidden in this return.
    a.status='idle';a.raid_target_id=null;a.start_x=a.target_x=s.x+40;a.start_y=a.target_y=s.y+30
    this.publish();this.save()
  }
  command=async(cmd:Command)=>{
    const w=this.snapshot;settleLocal(w,this.playerId)
    const s=w.settlements[0],a=w.armies[0],p=w.players[0],now=new Date().toISOString(),active=this.active()
    if(['upgrade','recruit','move','raid'].includes(cmd.type)&&active)throw new Error('Finish the current battle first.')
    const spend=(cost:ReturnType<typeof buildingCost>)=>{if(!affordable(s,cost))throw new Error('Your stores cannot cover this cost.');for(const key of RESOURCES)s[key]-=cost[key]}
    if(cmd.type==='upgrade'){
      if(w.orders.some(o=>o.kind==='upgrade'))throw new Error('Your builders are already working.')
      const building=w.buildings.find(b=>b.building_type===cmd.item)!
      if(building.level>=20)throw new Error('Maximum building level reached.')
      spend(buildingCost(cmd.item,building.level));w.orders.push({id:++this.nextId,owner_id:this.playerId,kind:'upgrade',item:cmd.item,quantity:1,started_at:now,finish_at:new Date(Date.now()+upgradeSeconds(building.level)*1000).toISOString()})
    }else if(cmd.type==='recruit'){
      if(a.status==='moving'||dist(armyPosition(a),{x:s.x+40,y:s.y+30})>90)throw new Error('Bring your army home to recruit.')
      if(!Number.isInteger(cmd.quantity)||cmd.quantity<1||cmd.quantity>200)throw new Error('Choose between 1 and 200 soldiers.')
      if(soldierTotal(a)+w.orders.filter(o=>o.kind==='recruit').reduce((n,o)=>n+o.quantity,0)+cmd.quantity>1000)throw new Error('Army capacity is 1,000 soldiers.')
      if(w.orders.filter(o=>o.kind==='recruit').length>=3)throw new Error('Training queue is full.')
      spend(multiply(UNITS[cmd.item].cost,cmd.quantity))
      const level=w.buildings.find(b=>b.building_type===(cmd.item==='cavalry'?'stables':'barracks'))!.level
      const start=Math.max(Date.now(),...w.orders.filter(o=>o.kind==='recruit').map(o=>Date.parse(o.finish_at)))
      w.orders.push({id:++this.nextId,owner_id:this.playerId,kind:'recruit',item:cmd.item,quantity:cmd.quantity,started_at:new Date(start).toISOString(),finish_at:new Date(start+recruitSeconds(cmd.item,cmd.quantity,level)*1000).toISOString()})
    }else if(cmd.type==='move'||cmd.type==='raid'){
      if(w.orders.some(o=>o.kind==='recruit'))throw new Error('Let the training queue finish before marching.')
      let x:number,y:number
      if(cmd.type==='raid'){
        const c=w.camps.find(c=>c.id===cmd.campId);if(!c)throw new Error('Camp not found.')
        if(w.progress.some(t=>t.camp_id===c.id&&Date.parse(t.available_at)>Date.now()))throw new Error('The camp is still regrouping.')
        if(!soldierTotal(a))throw new Error('Recruit soldiers before starting a raid.')
        x=c.x;y=c.y;a.raid_target_id=c.id
      }else{x=Math.max(45,Math.min(1155,cmd.x));y=Math.max(55,Math.min(715,cmd.y));a.raid_target_id=null}
      const pos=armyPosition(a),seconds=Math.max(2,dist(pos,{x,y})/22)
      a.start_x=pos.x;a.start_y=pos.y;a.target_x=x;a.target_y=y;a.departure_at=now;a.arrival_at=new Date(Date.now()+seconds*1000).toISOString();a.status='moving'
    }else if(cmd.type==='ready'){
      if(!active||active.id!==cmd.battleId)throw new Error('Battle not found.')
      active.attacker_ready=true;active.phase='combat';active.started_at=now;this.paused=false
    }else if(cmd.type==='order'){
      if(!active||active.id!==cmd.battleId)throw new Error('Battle not found.')
      applyOrder(active,w.formations.filter(f=>f.battle_id===active.id),this.playerId,cmd.order)
    }else if(cmd.type==='rally'){
      if(!active||active.id!==cmd.battleId||active.phase!=='combat')throw new Error('Rally is available during combat.')
      if(active.rally_attacker)throw new Error('Your general has already rallied the army.')
      active.rally_attacker=true;w.formations.filter(f=>f.battle_id===active.id&&f.side==='attacker'&&f.soldiers>0).forEach(f=>{f.morale=Math.min(100,f.morale+25);if(f.status==='routed'){f.status='idle';f.target_x=f.x;f.target_y=f.y}})
    }else if(cmd.type==='retreat'){
      if(!active||active.id!==cmd.battleId)throw new Error('Battle not found.')
      finishBattle(active,w.formations.filter(f=>f.battle_id===active.id),'defender','Withdrawal');this.finalize(active.id)
    }else if(cmd.type==='claim'){
      const q=QUESTS.find(q=>q.id===cmd.questId);if(!q)throw new Error('Objective not found.')
      if(w.claims.some(c=>c.quest_id===q.id))throw new Error('Reward already claimed.')
      if(p[q.stat]<q.target)throw new Error('Complete the objective first.')
      w.claims.push({quest_id:q.id,owner_id:this.playerId});for(const k of RESOURCES)s[k]=Math.min(s.capacity,s[k]+q.reward[k])
    }else if(cmd.type==='rename'){
      if(cmd.name.trim().length<2||cmd.name.trim().length>32)throw new Error('Use a name of 2–32 characters.')
      s.name=cmd.name.trim()
    }else throw new Error('Live challenges are available in multiplayer.')
    this.publish();this.save()
  }
  destroy=()=>{if(!this.alive)return;this.alive=false;window.clearInterval(this.timer);this.save();this.listeners.clear()}
}

export function readSolo():World|null{
  try{const raw=localStorage.getItem(SAVE_KEY);if(!raw)return null;const w=JSON.parse(raw);if(w.version!==6||!w.players?.length||!w.settlements?.length||!w.armies?.length)return null;return w as World}catch{return null}
}
