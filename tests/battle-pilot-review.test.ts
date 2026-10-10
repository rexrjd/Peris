import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePilotReview} from '../src/features/battle/preview/pilotReview';
const edition='orc-quality-pilot-v8';
const pack=(detail:string)=>({url:`/artifacts/battle-preview/orc-quality-pilot-20261009/staged/${edition}/orc-axe-warrior-${detail}.glb`,sha256:'a'.repeat(64),bytes:1024,meshParts:2,componentLicenses:['CC-BY-SA-3.0','CC-BY-4.0'],clips:['line_infantry_idle','line_infantry_walk','line_infantry_attack']});
const record=()=>({edition,role:'line_infantry',localDevelopmentOnly:true,finishedUnitApproved:false,battleRendererApproved:false,near:pack('near'),far:pack('far')});

const batchRecord = () => {
 const roles = ['spear_guard', 'elite', 'archer'];
 const batchPack = (detail: string) => ({...pack(detail),url:`/artifacts/battle-preview/orc-quality-pilot-20261009/staged/orc-infantry-batch-v1/orc-infantry-${detail}.glb`,meshParts:6,clips:roles.flatMap(role=>['idle','walk','attack'].map(state=>`${role}_${state}`))});
 return {edition:'orc-infantry-batch-v1',roles,baseline:record(),localDevelopmentOnly:true,finishedUnitApproved:false,battleRendererApproved:false,near:batchPack('near'),far:batchPack('far')};
};

test('an infantry batch preserves the separate Axe baseline and rejects incomplete role or paired provenance', () => {
 const result = parsePilotReview(batchRecord());
 assert.deepEqual(result.packs.map(pack=>pack.roles),[['line_infantry'],['spear_guard','elite','archer']]);
 assert.equal(result.near,pack('near').url);
 for (const change of [
  (r:ReturnType<typeof batchRecord>)=>{r.far.clips=r.far.clips.filter(clip=>clip!=='archer_attack');},
  (r:ReturnType<typeof batchRecord>)=>{r.roles=['spear_guard','elite','scout'];},
  (r:ReturnType<typeof batchRecord>)=>{r.baseline.edition='orc-infantry-batch-v1';},
  (r:ReturnType<typeof batchRecord>)=>{r.near.url='https://example.com/units.glb';},
  (r:ReturnType<typeof batchRecord>)=>{r.far.meshParts=4;},
 ]) {const r=batchRecord();change(r);assert.throws(()=>parsePilotReview(r));}
});
test('staged pilot review accepts only its paired local WIP role and preserves mixed credit',()=>{
 const result=parsePilotReview(record()); assert.equal(result.edition,edition); assert.match(result.near,/near\.glb$/); assert.match(result.far,/far\.glb$/); assert.match(result.credits,/Crazyon520/);assert.match(result.credits,/Wildfire Games/);
});
test('staged pilot review refuses external, crossed-edition and unpaired model paths',()=>{
 for(const url of ['https://example.com/unit.glb','/models/battle/orc-roster.glb','/artifacts/battle-preview/orc-quality-pilot-20261009/staged/orc-quality-pilot-v7/orc-axe-warrior-near.glb']){const r=record();r.near.url=url;assert.throws(()=>parsePilotReview(r));}
 const r=record();r.far=r.near;assert.throws(()=>parsePilotReview(r));
});
test('staged pilot review refuses approval claims, missing provenance/actions and oversized files',()=>{
 assert.throws(()=>parsePilotReview({...record(),finishedUnitApproved:true}));
 assert.throws(()=>parsePilotReview({...record(),localDevelopmentOnly:false}));
 for(const mutate of [(r:ReturnType<typeof record>)=>{r.near.componentLicenses=['CC-BY-SA-3.0'];},(r:ReturnType<typeof record>)=>{r.far.clips=['line_infantry_idle'];},(r:ReturnType<typeof record>)=>{r.near.sha256='';},(r:ReturnType<typeof record>)=>{r.far.bytes=6*1024*1024;}]){const r=record();mutate(r);assert.throws(()=>parsePilotReview(r));}
});

test('a complete local Orc review accepts all nine roles and rejects incomplete or crossed packs', () => {
 const roles=['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult'];
 const full=()=>({edition:'orc-prototype-deadline-v1',roles:[...roles],localDevelopmentOnly:true,finishedUnitApproved:false,battleRendererApproved:false,
  near:{...pack('near'),url:'/artifacts/battle-preview/orc-quality-pilot-20261009/staged/orc-prototype-deadline-v1/orc-roster-near.glb',meshParts:19,clips:roles.flatMap(role=>['idle','walk','attack'].map(state=>`${role}_${state}`))},
  far:{...pack('far'),url:'/artifacts/battle-preview/orc-quality-pilot-20261009/staged/orc-prototype-deadline-v1/orc-roster-far.glb',meshParts:19,clips:roles.flatMap(role=>['idle','walk','attack'].map(state=>`${role}_${state}`))}});
 assert.deepEqual(parsePilotReview(full()).packs.map(item=>item.roles),[roles]);
 const refinedGiant=full();refinedGiant.near.meshParts=20;refinedGiant.far.meshParts=20;
 assert.deepEqual(parsePilotReview(refinedGiant).packs.map(item=>item.roles),[roles]);
 for(const mutate of [
  (r:ReturnType<typeof full>)=>{r.roles.pop();},
  (r:ReturnType<typeof full>)=>{r.near.meshParts=18;},
  (r:ReturnType<typeof full>)=>{r.near.meshParts=21;},
  (r:ReturnType<typeof full>)=>{r.far.clips=r.far.clips.filter(clip=>clip!=='heavy_cavalry_walk');},
  (r:ReturnType<typeof full>)=>{r.near.bytes=33*1024*1024;},
  (r:ReturnType<typeof full>)=>{r.far.url='/models/battle/orc-roster-lod.glb';},
 ]) {const candidate=full();mutate(candidate);assert.throws(()=>parsePilotReview(candidate));}
});
