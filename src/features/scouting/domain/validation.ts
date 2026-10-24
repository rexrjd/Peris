import type {World} from '../../../shared/model/world';
import type {ScoutingResult} from './types';
import {validateRoster} from '../../army/domain/roster';
import {isFaction} from '../../factions/domain/factions';
import {RESOURCES} from '../../../shared/model/resources';
import {wrappedWorldDelta} from '../../map/domain/dimensions';
import {isWalkable} from '../../map/domain/worldGrid';
const invalid=()=>{throw new Error('This file contains invalid scouting data.');};
const id=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
const stamp=(n:unknown)=>typeof n==='string'&&Number.isFinite(Date.parse(n));
const text=(n:unknown,max=120)=>typeof n==='string'&&n.length>0&&n.length<=max;
const point=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=-12800&&n<12800;
const mode=(n:unknown)=>n==='resources'||n==='defences';
export function validateScoutingResult(r:ScoutingResult){
 if(!r||!id(r.mission_id)||!mode(r.mode)||!stamp(r.observed_at)||!r.target||!id(r.target.id)||!['city','camp'].includes(r.target.kind)||!text(r.target.name)||!isFaction(r.target.faction)||!point(r.target.x)||!point(r.target.y)||r.target.owner_id!=null&&!text(r.target.owner_id)||typeof r.success!=='boolean'||typeof r.detected!=='boolean')invalid();
 for(const n of [r.scouts_sent,r.scouts_lost,r.scouts_survived])if(!Number.isSafeInteger(n)||n<0||n>1000)invalid();
 if(r.scouts_sent!==r.scouts_lost+r.scouts_survived||r.reason!==undefined&&!text(r.reason,500)||r.sender_name!==undefined&&!text(r.sender_name))invalid();
 if(!r.success&&(r.troops!==undefined||r.resources!==undefined||r.defences!==undefined)||r.mode==='resources'&&r.defences!==undefined||r.mode==='defences'&&r.resources!==undefined)invalid();
 if(r.troops!==undefined&&!validateRoster(r.troops,100000))invalid();
 if(r.resources!==undefined&&(!r.resources||RESOURCES.some(k=>!Number.isFinite(r.resources![k])||r.resources![k]<0||r.resources![k]>1e9)))invalid();
 if(r.defences!==undefined&&(!r.defences||[r.defences.wall,r.defences.main].some(n=>!Number.isInteger(n)||n<0||n>5)))invalid();
}
export function validateScouting(w:World){
 if(w.scouting_version!==undefined&&w.scouting_version!==1)invalid();
 if(w.scouting_missions===undefined)return;
 if(!Array.isArray(w.scouting_missions)||w.scouting_missions.length>2500)invalid();
 if(w.scouting_missions.length&&w.troop_upkeep_version!==1)invalid();
 const seen=new Set<number>();
 for(const m of w.scouting_missions){
  if(!m||!id(m.id)||seen.has(m.id)||!text(m.owner_id)||!w.players.some(p=>p.id===m.owner_id)||!id(m.source_settlement_id)||!w.settlements.some(s=>s.id===m.source_settlement_id)||!id(m.source_army_id)||!w.armies.some(a=>a.id===m.source_army_id&&a.owner_id===m.owner_id)||!text(m.target_name)||!isFaction(m.faction)||!mode(m.mode)||!['outbound','returning','completed','cancelled'].includes(m.status))invalid();seen.add(m.id);
  if((m.target_city_id===null)===(m.target_camp_id===null)||m.target_city_id!==null&&!w.settlements.some(s=>s.id===m.target_city_id)||m.target_camp_id!==null&&!w.camps.some(c=>c.id===m.target_camp_id)||m.target_owner_id!==null&&!text(m.target_owner_id))invalid();
  if(!Number.isInteger(m.initial_scouts)||m.initial_scouts<1||m.initial_scouts>1000||!Number.isInteger(m.scouts)||m.scouts<0||m.scouts>m.initial_scouts||['completed','cancelled'].includes(m.status)&&m.scouts!==0)invalid();
  if(![m.origin_x,m.origin_y,m.target_x,m.target_y].every(point)||![m.sent_at,m.departure_at,m.arrival_at,m.cancel_until].every(stamp)||Date.parse(m.arrival_at)<Date.parse(m.departure_at)||Date.parse(m.departure_at)<Date.parse(m.sent_at))invalid();
  if(!Array.isArray(m.march_path)||m.march_path.length<2||m.march_path.length>2000||m.march_path.some(p=>!Array.isArray(p)||p.length!==2||!p.every(point)||!isWalkable(Math.floor(p[0]/128),Math.floor(p[1]/128))))invalid();
  let distance=0;for(let i=1;i<m.march_path.length;i++){const a=m.march_path[i-1],b=m.march_path[i],step=Math.hypot(wrappedWorldDelta(a[0],b[0]),wrappedWorldDelta(a[1],b[1]));if(step>128*Math.SQRT2+1e-6)invalid();distance+=step;}
  const end=m.march_path.at(-1)!;if(!Number.isFinite(m.march_distance)||Math.abs(distance-m.march_distance)>1e-5||end[0]!==m.target_x||end[1]!==m.target_y||m.report_battle_id!=null&&!id(m.report_battle_id))invalid();
  if(m.report_battle_id!=null){const b=w.battles.find(b=>b.id===m.report_battle_id);if(m.status==='outbound'||!b||b.mode!=='scouting'||b.status!=='resolved'||b.attacker_owner_id!==m.owner_id||b.result?.scouting?.mission_id!==m.id)invalid();}
 }
}
