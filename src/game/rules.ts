import type { Army, Battle, BuildingType, Camp, Formation, Player, Resources, Settlement, Terrain, UnitType } from '../types/game'
export const WORLD_W = 1200, WORLD_H = 770, FIELD_W = 1200, FIELD_H = 700
export const RESOURCES = ['wood', 'stone', 'food', 'gold'] as const
export const UNIT_TYPES: UnitType[] = ['infantry', 'archers', 'cavalry']
export const BUILDINGS: Record<BuildingType, { name: string; description: string; cost: Resources; effect: string; color: string }> = {
  lumber: { name: 'Timber yard', description: 'Cut timber from the northern woodland.', cost: {wood:150,stone:90,food:70,gold:10}, effect: '+8 timber / min per level', color:'#879872' },
  quarry: { name: 'Stone quarry', description: 'Stone for roads, walls and a growing city.', cost:{wood:110,stone:150,food:70,gold:10}, effect:'+7 stone / min per level', color:'#aca793' },
  farm: { name: 'Wheat fields', description: 'A fed population is the foundation of an empire.', cost:{wood:100,stone:80,food:150,gold:8}, effect:'+10 food / min per level', color:'#c6b574' },
  market: { name: 'Forum', description: 'Merchants bring silver to your treasury.', cost:{wood:140,stone:130,food:80,gold:25}, effect:'+3 gold / min per level', color:'#b69c69' },
  barracks: { name: 'Barracks', description: 'Train disciplined infantry and skilled bowmen.', cost:{wood:180,stone:160,food:100,gold:30}, effect:'Faster infantry and archer training', color:'#be876f' },
  stables: { name: 'Stables', description: 'Raise mounted troops for decisive flank attacks.', cost:{wood:200,stone:120,food:180,gold:45}, effect:'Faster cavalry training', color:'#b98b64' },
  wall: { name: 'City walls', description: 'Hold the gate. Every level strengthens army morale.', cost:{wood:100,stone:240,food:80,gold:25}, effect:'+2 starting morale per level (max 100)', color:'#a7aaa3' },
  storehouse: { name: 'Granary', description: 'Keep surplus supplies safe for the next campaign.', cost:{wood:200,stone:150,food:90,gold:20}, effect:'+2,500 resource capacity per level', color:'#c2ae88' },
}
export const UNITS: Record<UnitType, {name:string; role:string; cost:Resources; speed:number; range:number; rate:number; color:string}> = {
  infantry:{name:'Legionaries',role:'Hold the line · brace against cavalry',cost:{wood:4,stone:2,food:6,gold:1},speed:40,range:44,rate:.020,color:'#a84337'},
  archers:{name:'Sagittarii',role:'Ranged volleys · protect them from melee',cost:{wood:6,stone:2,food:5,gold:2},speed:34,range:220,rate:.012,color:'#798e61'},
  cavalry:{name:'Equites',role:'Fast flank attacks · charge the enemy rear',cost:{wood:4,stone:7,food:12,gold:4},speed:76,range:50,rate:.031,color:'#ae9767'},
}
export const CAMPS: Camp[] = [
  {id:1,name:'The broken standard',x:305,y:405,tier:1,terrain:'plains',infantry:48,archers:18,cavalry:0,description:'Deserters have claimed the old crossroads. An ideal first campaign.'},
  {id:2,name:'Oakwood raiders',x:460,y:155,tier:2,terrain:'woods',infantry:90,archers:45,cavalry:12,description:'Bowmen hide beneath dense oak cover. Keep your cavalry out of the trees.'},
  {id:3,name:'The river watch',x:655,y:485,tier:2,terrain:'river',infantry:100,archers:40,cavalry:15,description:'A fortified crossing. The shallows slow troops; use the stone bridge.'},
  {id:4,name:'Highland warband',x:790,y:160,tier:3,terrain:'highlands',infantry:160,archers:70,cavalry:24,description:'Veteran spearmen defend the ridge. High ground favours their archers.'},
  {id:5,name:'Ashen legion',x:910,y:550,tier:4,terrain:'plains',infantry:240,archers:110,cavalry:55,description:'A rebel legion controls the eastern road. You will need a larger host.'},
  {id:6,name:'The fallen capital',x:605,y:280,tier:5,terrain:'highlands',infantry:340,archers:160,cavalry:80,description:'Break the last great host and restore the lost province of Peris.'},
]
export const QUESTS = [
  {id:'builder',title:'Lay the foundations',description:'Complete your first building upgrade.',target:1,stat:'upgrades' as const,reward:{wood:250,stone:200,food:200,gold:50}},
  {id:'recruiter',title:'Raise the standard',description:'Train 20 new soldiers.',target:20,stat:'recruits' as const,reward:{wood:200,stone:150,food:300,gold:75}},
  {id:'victor',title:'A first victory',description:'Win a campaign battle.',target:1,stat:'victories' as const,reward:{wood:300,stone:300,food:400,gold:150}},
  {id:'conqueror',title:'A name remembered',description:'Win 5 campaign battles.',target:5,stat:'victories' as const,reward:{wood:1000,stone:800,food:1000,gold:500}},
]
export const emptyResources = (): Resources => ({wood:0,stone:0,food:0,gold:0})
export function multiply(bag:Resources,n:number):Resources {return Object.fromEntries(RESOURCES.map(k=>[k,Math.ceil(bag[k]*n)])) as Resources}
export function buildingCost(type:BuildingType,level:number) {return multiply(BUILDINGS[type].cost,1.55**(level-1))}
export function upgradeSeconds(level:number) {return 15 + level*10}
export function recruitSeconds(type:UnitType,count:number,level:number) {return Math.max(5, Math.ceil(count*(type==='cavalry'?5:2)/(1+(level-1)*.18)))}
export function affordable(res:Resources,cost:Resources) {return RESOURCES.every(k=>res[k]>=cost[k])}
export function liveResources(s:Settlement,now=Date.now()):Resources {
  const minutes = Math.max(0,now-Date.parse(s.resources_updated_at))/60000
  return Object.fromEntries(RESOURCES.map(k=>[k,Math.min(s.capacity??7500,Math.floor(s[k]+s[`${k}_rate`]*minutes))])) as Resources
}
export function armyPosition(a:Army,now=Date.now()) {
  const t=a.status==='moving'?Math.max(0,Math.min(1,(now-Date.parse(a.departure_at))/Math.max(1,Date.parse(a.arrival_at)-Date.parse(a.departure_at)))):1
  return {x:a.start_x+(a.target_x-a.start_x)*t,y:a.start_y+(a.target_y-a.start_y)*t}
}
export function soldierTotal(a:Pick<Army,'infantry'|'archers'|'cavalry'>){return a.infantry+a.archers+a.cavalry}
export function clock(seconds:number){const s=Math.max(0,Math.ceil(seconds));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
export function dist(a:{x:number;y:number},b:{x:number;y:number}){return Math.hypot(a.x-b.x,a.y-b.y)}
export function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n))}
export function angleDiff(a:number,b:number){return ((a-b+540)%360)-180}
export function terrainAt(terrain:Terrain,x:number,y:number):{kind:string;speed:number;cover:number;height:number} {
  if(terrain==='woods' && ((x>420&&x<630&&y>65&&y<310)||(x>690&&x<960&&y>405&&y<665))) return {kind:'Forest',speed:.68,cover:.6,height:0}
  if(terrain==='highlands' && ((x-650)**2/190**2+(y-285)**2/135**2<1)) return {kind:'High ground',speed:.85,cover:1,height:1}
  if(terrain==='river' && Math.abs(x-(600+Math.sin(y/110)*32))<42 && (y<306 || y>395)) return {kind:'Shallows',speed:.42,cover:1,height:0}
  return {kind:'Open ground',speed:1,cover:1,height:0}
}
export function formationSize(f:Formation){const cols=Math.min(f.columns,Math.max(1,f.soldiers));return {width:cols*8+12,depth:Math.ceil(Math.min(f.soldiers,120)/cols)*8+12}}
export function playerName(players:Player[],id:string|null){return players.find(p=>p.id===id)?.display_name??'Rebel host'}
export function lootFor(tier:number):Resources{return {wood:180*tier,stone:140*tier,food:220*tier,gold:60*tier}}
export function isMine(f:Formation,playerId:string){return f.owner_id===playerId}
export function mySide(b:Battle,id:string){return b.attacker_owner_id===id?'attacker':'defender'}
export function seeded(seed:number){let s=seed;return()=>{s=(Math.imul(s,1664525)+1013904223)|0;return(s>>>0)/4294967296}}
