import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newBattle} from '../src/features/battle/domain/creation';
import {stepBattle} from '../src/features/battle/domain/simulation';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
import {RECRUIT_UNITS,emptyRoster,writeRoster,type UnitRoster} from '../src/features/army/domain/roster';
import {unitRule} from '../src/features/army/domain/unitBalance';
import type {Army} from '../src/features/army/domain/types';
import type {Terrain} from '../src/features/battle/domain/types';
import {RESOURCES,type Resources} from '../src/shared/model/resources';
import catalog from '../src/features/army/domain/unitBalance.json' with {type:'json'};
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {TECHNOLOGIES} from '../src/features/research/domain/catalog';
import {applyResearchFormations} from '../src/features/research/domain/effects';

type Recipe=Partial<UnitRoster>;
type Profiles=Record<Faction,number[][]>;
export const recipes:Recipe[]=[{infantry:60,archers:30,cavalry:12},{infantry:90,archers:10,cavalry:12},{infantry:30,archers:45,cavalry:18}];
export function economy(roster:Recipe){
 const spend:Resources={wood:0,stone:0,food:0,gold:0},training={barracks:0,stables:0,workshop:0};
 for(const unit of RECRUIT_UNITS){const r=unitRule(unit,2),n=roster[unit]??0;for(const key of RESOURCES)spend[key]+=n*r.cost[key];training[r.building]+=n*r.trainSeconds;}
 return {spend,training};
}
const scaled=(recipe:Recipe,scale:number):UnitRoster=>Object.fromEntries(RECRUIT_UNITS.map(unit=>[unit,Math.floor((recipe[unit]??0)*scale)])) as UnitRoster;
export function budgetRoster(recipe:Recipe,budget:Resources){const {spend}=economy(recipe);return scaled(recipe,Math.min(...RESOURCES.filter(key=>spend[key]>0).map(key=>budget[key]/spend[key])));}
export function productionRoster(recipe:Recipe,seconds:number){const {training}=economy(recipe);return scaled(recipe,seconds/Math.max(...Object.values(training)));}
export function scoreRows(rows:{attackerFaction:Faction;defenderFaction:Faction;winner:string|null}[]){
 const scores=Object.fromEntries(Object.keys(FACTIONS).map(f=>[f,{games:0,wins:0,draws:0,score:0}]));
 for(const r of rows)for(const side of ['attacker','defender'] as const){const s=scores[r[side==='attacker'?'attackerFaction':'defenderFaction']];s.games++;if(r.winner==='draw')s.draws++;else if(r.winner===side)s.wins++;}
 for(const s of Object.values(scores))s.score=s.games?(s.wins+s.draws/2)/s.games:0;
 return scores;
}

export function runScenario(input:{attacker:Faction;defender:Faction;terrain:Terrain;roster:Recipe;defenderRoster?:Recipe;profiles?:Profiles;researchEra?:number}){
 const a={id:1,owner_id:'attacker',home_settlement_id:1} as Army,d={id:2,owner_id:'defender',home_settlement_id:2} as Army;
 writeRoster(a,{...emptyRoster(),...input.roster});writeRoster(d,{...emptyRoster(),...input.defenderRoster??input.roster});
 const {battle:b,formations:fs}=newBattle(1,'attacker',a,d,input.terrain,'normal','Calibration','practice',null,{version:2,attackerFaction:input.attacker,defenderFaction:input.defender});
 for(const f of fs){
  if(input.profiles){const faction=f.side==='attacker'?input.attacker:input.defender,index=['infantry','archers','cavalry'].indexOf(f.unit_type),profile=input.profiles[faction][index],r=unitRule(f.recruit_unit??f.unit_type,2);f.unit_attack=r.attack*profile[0];f.unit_defence=r.defence*profile[1];}
 }
 let researchInvestment:{science:number;seconds:number;technologies:string[]}|undefined;
 if(input.researchEra){
  const world=createSolo('Matched research'),selected=TECHNOLOGIES.filter(t=>!t.faction&&t.era<=input.researchEra!);
  world.armies=[a,d];world.settlements=[{...world.settlements[0],id:1,owner_id:'attacker',faction:input.attacker},{...world.settlements[0],id:2,owner_id:'defender',faction:input.defender}];
  world.research_progress=['attacker','defender'].flatMap(owner_id=>selected.map(t=>({owner_id,technology_id:t.id,seconds:t.seconds,completed_at:world.server_now})));
  world.battles=[b];for(const owner of ['attacker','defender'])applyResearchFormations(world,owner,fs);
  // newBattle creates the defender as an NPC; mark ownership before applying its account bonuses.
  for(const f of fs)if(f.side==='defender')f.owner_id='defender';
  applyResearchFormations(world,'defender',fs);
  researchInvestment={science:selected.reduce((n,t)=>n+t.cost,0),seconds:selected.reduce((n,t)=>n+t.seconds,0),technologies:selected.map(t=>t.id)};
 }
 for(let t=0;t<9005&&b.status==='active';t++)stepBattle(b,fs,.1);
 if(b.status!=='resolved'||!b.result)throw Error('Unresolved calibration battle');
 for(const f of fs)if(!Number.isInteger(f.soldiers)||f.soldiers<0||f.soldiers>f.initial_soldiers||[f.x,f.y,f.morale,f.stamina,f.damage_pool].some(n=>!Number.isFinite(n)))throw Error('Invalid simulation state');
 const r=b.result;
 if(r.attacker_initial!==r.attacker_survivors+r.attacker_losses||r.defender_initial!==r.defender_survivors+r.defender_losses)throw Error('Casualties not conserved');
 return {attackerFaction:input.attacker,defenderFaction:input.defender,terrain:input.terrain,researchInvestment,winner:b.winner_side,duration:Math.round(b.elapsed*100)/100,timedOut:b.elapsed>=900,
  attacker:{roster:input.roster,...economy(input.roster),survivors:r.attacker_survivors,losses:r.attacker_losses},
  defender:{roster:input.defenderRoster??input.roster,...economy(input.defenderRoster??input.roster),survivors:r.defender_survivors,losses:r.defender_losses}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const full=process.argv.includes('--full'),names=Object.keys(FACTIONS) as Faction[],started=performance.now(),results:any[]=[];
 const profileArg=process.argv.indexOf('--profiles'),profiles:Profiles|undefined=profileArg>=0?JSON.parse(readFileSync(process.argv[profileArg+1],'utf8')):undefined;
 const scores=Object.fromEntries(names.map(f=>[f,{games:0,wins:0,draws:0,score:0}])) as Record<Faction,{games:number;wins:number;draws:number;score:number}>;
 for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
  if(!full&&i!==0)continue;
  for(const terrain of full?['plains','woods','river'] as const:['plains'] as const)for(const [recipe,roster]of (full?recipes:recipes.slice(0,1)).entries())for(const reversed of [false,true]){
   const attacker=names[reversed?j:i],defender=names[reversed?i:j],r=runScenario({attacker,defender,terrain,roster,profiles});
   results.push({matrix:'baseline',recipe,...r});scores[attacker].games++;scores[defender].games++;
   if(r.winner==='draw'){scores[attacker].draws++;scores[defender].draws++;}else scores[r.winner==='attacker'?attacker:defender].wins++;
  }
 }
 for(const faction of names){const s=scores[faction];s.score=(s.wins+s.draws/2)/s.games;}
 const baselineGames=results.length;
 if(full&&!process.argv.includes('--baseline-only')){
  const budget={wood:560,stone:480,food:720,gold:120};
  const advanced={infantry:40,spearmen:12,archers:20,elite:8,cavalry:8,scout:2,heavyCavalry:4,ram:2,catapult:2};
  const matrices=[['resources',budgetRoster(recipes[0],budget)],['production',productionRoster(recipes[0],120)],['soldier-cap',scaled(recipes[0],300/102)],['advanced',advanced]] as const;
  for(const [matrix,roster]of matrices)for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++)for(const reverse of [false,true]){
   const r=runScenario({attacker:names[reverse?j:i],defender:names[reverse?i:j],terrain:'plains',roster,profiles});
   results.push({matrix,...r,...matrix==='resources'?{budget,unspent:Object.fromEntries(RESOURCES.map(key=>[key,budget[key]-r.attacker.spend[key]]))}:{}});
  }
  for(const era of [2,5])for(const faction of names)results.push({matrix:era===2?'matched-research-diagnostic':'endgame-diagnostic',...runScenario({attacker:faction,defender:'roman',terrain:'plains',roster:recipes[0],profiles,researchEra:era})});
 }
 const outside=names.filter(f=>scores[f].score<.4||scores[f].score>.6),timeouts=results.filter(r=>r.timedOut).length;
 const slices=Object.fromEntries(['plains','woods','river'].map(terrain=>[terrain,Object.fromEntries(names.map(f=>{const rows=results.filter(r=>r.matrix==='baseline'&&r.terrain===terrain&&(r.attackerFaction===f||r.defenderFaction===f));return [f,rows.length?rows.reduce((s,r)=>s+(r.winner==='draw'?.5:r.winner===(r.attackerFaction===f?'attacker':'defender')?1:0),0)/rows.length:null];}))]));
 const matrixScores=Object.fromEntries([...new Set(results.map(r=>r.matrix))].map(matrix=>[matrix,scoreRows(results.filter(r=>r.matrix===matrix))]));
 const compositionSlices=Object.fromEntries(recipes.map((_,recipe)=>[recipe,scoreRows(results.filter(r=>r.matrix==='baseline'&&r.recipe===recipe))]));
 const startingPooledScores=scoreRows(results.filter(r=>!r.matrix.includes('diagnostic')));
 const pooledOutside=names.filter(f=>startingPooledScores[f].score<.4||startingPooledScores[f].score>.6);
 const report={version:2,source:profiles?'candidate profile override':'canonical unitBalance.json',catalogHash:createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),unitRules:catalog.versions[2],profiles:profiles??catalog.profiles,baselineGames,games:results.length,timeouts,ms:Math.round(performance.now()-started),scores,startingPooledScores,matrixScores,compositionSlices,terrainSlices:slices,outsideTarget:outside,pooledOutside,results};
 mkdirSync('output/unit-balance',{recursive:true});
 const outputArg=process.argv.indexOf('--output'),file=outputArg>=0?process.argv[outputArg+1]:'output/unit-balance/calibration.json';writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,profiles:undefined,unitRules:undefined,results:undefined,terrainSlices:undefined,matrixScores:undefined,compositionSlices:undefined},null,2));
 if(timeouts||full&&(outside.length||pooledOutside.length))process.exitCode=1;
}
