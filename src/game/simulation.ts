import type { Army, Battle, BattleOrder, BattleResult, Difficulty, Effect, Formation, Terrain } from '../types/game'
import { angleDiff, clamp, dist, emptyResources, terrainAt, UNIT_TYPES, UNITS } from './rules'

export function moveTargets(selected:Formation[],order:BattleOrder){
  const cx=selected.reduce((n,f)=>n+f.x,0)/selected.length,cy=selected.reduce((n,f)=>n+f.y,0)/selected.length
  const spacing=Math.min(620/Math.max(1,selected.length-1),(order.columns??10)*8+24),angle=(order.facing??0)*Math.PI/180
  return selected.map((f,i)=>({id:f.id,x:clamp((order.x??cx)+(order.facing===undefined?f.x-cx:-Math.sin(angle)*(i-(selected.length-1)/2)*spacing),35,1165),y:clamp((order.y??cy)+(order.facing===undefined?f.y-cy:Math.cos(angle)*(i-(selected.length-1)/2)*spacing),40,660)}))
}

export function makeFormations(battleId:number,army:Pick<Army,'infantry'|'archers'|'cavalry'>,owner:string|null,side:'attacker'|'defender',morale=90):Formation[] {
  let index=0
  const result:Formation[]=[]
  for(const type of UNIT_TYPES){
    const max=type==='infantry'?60:type==='archers'?40:24
    const n=Math.min(6,Math.ceil(army[type]/max))
    for(let i=0;i<n;i++){
      const soldiers=Math.floor(army[type]/n)+(i<army[type]%n?1:0)
      const left=side==='attacker'
      const x=left?(type==='infantry'?285:175):(type==='infantry'?915:1025)
      const y=type==='cavalry'?(i%2===0?110+i*15:590-i*15):350+(i-(n-1)/2)*105+(type==='archers'?15:0)
      result.push({id:battleId*100+(left?0:40)+(++index),battle_id:battleId,owner_id:owner,side,unit_type:type,label:`${UNITS[type].name} ${i+1}`,initial_soldiers:soldiers,soldiers,kills:0,morale,stamina:100,facing:left?0:180,charge_ready:false,x,y,target_x:x,target_y:y,target_facing:null,target_formation_id:null,status:'idle',damage_pool:0,columns:type==='cavalry'?6:10,stance:'balanced',running:false,fire_at_will:true,updated_at:new Date().toISOString()})
    }
  }
  return result
}

export function newBattle(id:number,owner:string,army:Army,enemy:Pick<Army,'infantry'|'archers'|'cavalry'>,terrain:Terrain,difficulty:Difficulty,enemyName:string,mode:Battle['mode']='pve',campId:number|null=null):{battle:Battle;formations:Formation[]} {
  const now=new Date().toISOString()
  return {battle:{id,attacker_owner_id:owner,defender_owner_id:null,attacker_army_id:army.id,defender_army_id:null,status:'active',phase:'deployment',attacker_ready:false,defender_ready:true,mode,camp_id:campId,terrain,difficulty,enemy_name:enemyName,winner_owner_id:null,winner_side:null,started_at:now,ended_at:null,last_tick_at:now,elapsed:0,result:null,rally_attacker:false,rally_defender:false}, formations:[...makeFormations(id,army,owner,'attacker'),...makeFormations(id,enemy,null,'defender',difficulty==='hard'?100:difficulty==='easy'?78:90)]}
}

export function applyOrder(b:Battle,formations:Formation[],owner:string,order:BattleOrder){
  if(b.status!=='active')throw new Error('This battle has ended.')
  const selected=formations.filter(f=>order.ids.includes(f.id)&&f.owner_id===owner&&f.soldiers>0&&f.status!=='routed')
  if(!selected.length)throw new Error('Select a formation that can receive orders.')
  const target=formations.find(f=>f.id===order.target)
  const destinations=moveTargets(selected,order)
  if(order.kind==='move'&&b.phase==='deployment')selected.forEach((f,i)=>{
    const tx=destinations[i].x
    if((f.side==='attacker'&&tx>365)||(f.side==='defender'&&tx<835))throw new Error('Deploy inside your shaded zone.')
  })
  selected.forEach((f,i)=>{
    if(order.kind==='attack'){
      if(b.phase!=='combat')throw new Error('Begin the battle before attacking.')
      if(!target||target.side===f.side||target.soldiers<=0||target.status==='routed')throw new Error('Choose an enemy formation.')
      f.target_formation_id=target.id;f.target_x=target.x;f.target_y=target.y;f.status='moving';f.target_facing=null
      f.charge_ready=dist(f,target)>140 && f.unit_type==='cavalry' && f.stamina>35
    }else if(order.kind==='move'){
      const tx=destinations[i].x,ty=destinations[i].y
      if(b.phase==='deployment'&&((f.side==='attacker'&&tx>365)||(f.side==='defender'&&tx<835)))throw new Error('Deploy inside your shaded zone.')
      f.target_formation_id=null;f.target_x=tx;f.target_y=ty;f.target_facing=order.facing??null;f.status='moving';f.charge_ready=false
      if(order.columns)f.columns=clamp(Math.round(order.columns),4,20)
      if(b.phase==='deployment'){f.x=tx;f.y=ty;f.status='idle';f.facing=order.facing??f.facing}
    }else if(order.kind==='halt'){f.target_formation_id=null;f.target_x=f.x;f.target_y=f.y;f.status='idle';f.charge_ready=false}
    else if(order.kind==='stance')f.stance=order.stance??'balanced'
    else if(order.kind==='run')f.running=order.enabled??!f.running
    else if(order.kind==='fire')f.fire_at_will=order.enabled??!f.fire_at_will
    else if(order.kind==='width')f.columns=clamp(order.columns??10,4,20)
  })
}

function chooseAI(b:Battle,fs:Formation[]){
  for(const f of fs.filter(f=>f.owner_id===null&&f.soldiers>0&&f.status!=='routed')){
    const enemies=fs.filter(e=>e.side!==f.side&&e.soldiers>0&&e.status!=='routed')
    if(!enemies.length)continue
    const closest=[...enemies].sort((a,c)=>dist(f,a)-dist(f,c))[0]
    const target=f.unit_type==='cavalry'&&b.difficulty!=='easy'?(enemies.filter(e=>e.unit_type==='archers').sort((a,c)=>dist(f,a)-dist(f,c))[0]??closest):closest
    if(f.unit_type==='archers'&&dist(f,closest)<80&&b.difficulty!=='easy'){
      f.target_formation_id=null;f.target_x=clamp(f.x+(f.x-closest.x)*1.2,50,1150);f.target_y=clamp(f.y+(f.y-closest.y)*1.2,50,650)
      f.status='moving';continue
    }
    if(f.target_formation_id===target.id)continue
    if(f.unit_type==='cavalry' && b.difficulty==='hard' && dist(f,target)>250 && Math.abs(f.y-target.y)<65){
      f.target_formation_id=null;f.target_x=target.x-85;f.target_y=target.y<350?85:615;f.running=true;continue
    }
    f.charge_ready=f.unit_type==='cavalry'&&dist(f,target)>140&&f.stamina>35
    f.target_formation_id=target.id;f.status='moving';f.running=f.unit_type==='cavalry'
  }
}

/** Fixed-step tactical rules. All damage in a tick is applied simultaneously. */
export function stepBattle(b:Battle,fs:Formation[],dt:number):Effect[]{
  if(b.status!=='active'||b.phase!=='combat')return[]
  dt=clamp(dt,0,.1);b.elapsed+=dt
  const effects:Effect[]=[]
  if(Math.floor((b.elapsed-dt)*2)!==Math.floor(b.elapsed*2))chooseAI(b,fs)
  const byId=new Map(fs.map(f=>[f.id,f]))
  for(const f of fs){
    if(f.soldiers<=0)continue
    if(f.status==='routed'){
      f.x=clamp(f.x+(f.side==='attacker'?-1:1)*64*dt,12,1188);continue
    }
    const t=f.target_formation_id?byId.get(f.target_formation_id):null
    if(t&&(t.soldiers<=0||t.status==='routed')){f.target_formation_id=null;f.target_x=f.x;f.target_y=f.y;f.charge_ready=false}
    // Automatic self-defence and ranged fire; guard formations never pursue.
    if(!f.target_formation_id){
      const auto=fs.filter(e=>e.side!==f.side&&e.status!=='routed'&&e.soldiers>0&&dist(f,e)<(f.unit_type==='archers'&&f.fire_at_will?UNITS.archers.range:UNITS[f.unit_type].range)).sort((a,c)=>dist(f,a)-dist(f,c))[0]
      if(auto && (f.unit_type!=='archers'||f.fire_at_will)){f.target_formation_id=auto.id;f.charge_ready=false}
    }
    const enemy=f.target_formation_id?byId.get(f.target_formation_id):null
    if(enemy){f.target_x=enemy.x;f.target_y=enemy.y}
    const distance=dist(f,{x:f.target_x,y:f.target_y})
    const range=enemy?UNITS[f.unit_type].range:0
    const ground=terrainAt(b.terrain,f.x,f.y)
    const canMove=distance>range+2 && !(enemy && f.stance==='guard')
    if(canMove){
      const dx=f.target_x-f.x,dy=f.target_y-f.y
      const desired=Math.atan2(dy,dx)*180/Math.PI
      f.facing+=clamp(angleDiff(desired,f.facing),-150*dt,150*dt)
      const speed=UNITS[f.unit_type].speed*ground.speed*(f.unit_type==='cavalry'&&ground.kind==='Forest'?.65:1)*(f.running&&f.stamina>8?1.45:1)*(f.stamina<15?.75:1)
      const step=Math.min(speed*dt,distance-range)
      f.x=clamp(f.x+dx/distance*step,25,1175);f.y=clamp(f.y+dy/distance*step,30,670);f.status='moving'
      f.stamina=clamp(f.stamina-(f.running?1.9:.12)*dt,0,100)
    }else{
      f.status=enemy?'engaged':'idle'
      f.stamina=clamp(f.stamina+(enemy?-.4:2)*dt,0,100)
      if(!enemy&&f.target_facing!==null)f.facing+=clamp(angleDiff(f.target_facing,f.facing),-150*dt,150*dt)
      if(!enemy&&f.morale<90)f.morale=clamp(f.morale+.7*dt,0,100)
    }
  }
  const pending=new Map<number,{loss:number;morale:number}>()
  for(const f of fs){
    if(f.status==='routed'||f.soldiers<=0||!f.target_formation_id)continue
    const t=byId.get(f.target_formation_id)
    if(!t||t.status==='routed'||t.soldiers<=0||dist(f,t)>UNITS[f.unit_type].range+4)continue
    const ranged=f.unit_type==='archers'&&dist(f,t)>65
    const gt=terrainAt(b.terrain,t.x,t.y),gf=terrainAt(b.terrain,f.x,f.y)
    const bearing=Math.atan2(f.y-t.y,f.x-t.x)*180/Math.PI
    const relative=Math.abs(angleDiff(bearing,t.facing))
    const flank=ranged?1:relative>135?1.65:relative>65?1.28:1
    const charge=f.charge_ready&&f.unit_type==='cavalry'&&gf.kind!=='Forest'?2.4:1
    const matchup=f.unit_type==='cavalry'?(t.unit_type==='archers'?1.65:.9):f.unit_type==='infantry'?(t.unit_type==='cavalry'?1.25:1):t.unit_type==='cavalry'?.75:1
    const stance=f.stance==='aggressive'?1.22:f.stance==='guard'?.9:1
    const brace=t.stance==='guard'&&t.unit_type==='infantry'&&relative<65&&f.unit_type==='cavalry'?.5:1
    const cover=ranged?gt.cover:1
    const elevation=ranged&&gf.height>gt.height?1.25:ranged&&gf.height<gt.height?.8:1
    const meleeArcher=f.unit_type==='archers'&&!ranged?.28:1
    const defence=t.stance==='guard'?.8:t.stance==='aggressive'?1.15:1
    const difficulty=f.owner_id===null?(b.difficulty==='hard'?1.13:b.difficulty==='easy'?.8:1):1
    f.damage_pool+=f.soldiers*UNITS[f.unit_type].rate*matchup*stance*defence*brace*flank*charge*cover*elevation*meleeArcher*difficulty*(.55+f.stamina/220)*dt+(charge>1?f.soldiers*.06*brace*flank:0)
    const casualties=Math.min(Math.max(0,t.soldiers-(pending.get(t.id)?.loss??0)),Math.floor(f.damage_pool))
    if(casualties>0||charge>1){
      f.damage_pool-=casualties;f.kills+=casualties
      const p=pending.get(t.id)??{loss:0,morale:0}
      p.loss+=casualties;p.morale+=casualties/Math.max(1,t.initial_soldiers)*85+(flank>1?casualties*1.2:0)+(charge>1?12:0)
      pending.set(t.id,p)
      effects.push({kind:'death',x:t.x,y:t.y,side:t.side,at:b.elapsed})
    }
    if(charge>1){effects.push({kind:'charge',x:f.x,y:f.y,side:f.side,at:b.elapsed});f.charge_ready=false;f.stamina=clamp(f.stamina-12,0,100)}
    if(ranged&&Math.floor(b.elapsed*2)!==Math.floor((b.elapsed-dt)*2))effects.push({kind:'arrow',x:f.x,y:f.y,tx:t.x,ty:t.y,side:f.side,at:b.elapsed})
  }
  for(const [id,p] of pending){
    const t=byId.get(id)!;t.soldiers=Math.max(0,t.soldiers-p.loss);t.morale=clamp(t.morale-p.morale,0,100)
    if(t.soldiers===0||t.morale<18){t.status='routed';t.target_formation_id=null;effects.push({kind:'route',x:t.x,y:t.y,side:t.side,at:b.elapsed})}
  }
  const attacker=fs.some(f=>f.side==='attacker'&&f.soldiers>0&&f.status!=='routed')
  const defender=fs.some(f=>f.side==='defender'&&f.soldiers>0&&f.status!=='routed')
  if(!attacker||!defender)finishBattle(b,fs,attacker?'attacker':defender?'defender':'draw','Army routed')
  else if(b.elapsed>=900){
    const strength=(side:string)=>fs.filter(f=>f.side===side&&f.status!=='routed').reduce((sum,f)=>sum+f.soldiers,0)
    const a=strength('attacker'),d=strength('defender');finishBattle(b,fs,a>d?'attacker':d>a?'defender':'draw','Time limit')
  }
  return effects
}

export function finishBattle(b:Battle,fs:Formation[],winner:Battle['winner_side'],reason:string){
  if(b.status==='resolved')return
  const sum=(side:string,key:'initial_soldiers'|'soldiers')=>fs.filter(f=>f.side===side).reduce((n,f)=>n+f[key],0)
  const ai=sum('attacker','initial_soldiers'),di=sum('defender','initial_soldiers'),as=sum('attacker','soldiers'),ds=sum('defender','soldiers')
  b.status='resolved';b.phase='finished';b.winner_side=winner;b.winner_owner_id=winner==='attacker'?b.attacker_owner_id:winner==='defender'?b.defender_owner_id:null;b.ended_at=new Date().toISOString()
  b.result={attacker_initial:ai,defender_initial:di,attacker_survivors:as,defender_survivors:ds,attacker_losses:ai-as,defender_losses:di-ds,loot:emptyResources(),duration:Math.round(b.elapsed),reason} satisfies BattleResult
}
