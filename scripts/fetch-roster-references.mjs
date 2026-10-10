// Extend the pinned 0 A.D. source pack without replacing its first inventory.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
const revision='61a3b9507d974084e6badb88a0826bd89a6d5b8b';
const prefix='binaries/data/mods/public/art/',out='assets/references/units/0ad';
let tree;
try {tree=JSON.parse(await readFile(join(process.env.TEMP,'peris-0ad-tree.json'),'utf8'));} catch {
 const response=await fetch(`https://api.github.com/repos/0ad/0ad/git/trees/${revision}?recursive=1`,{headers:{'User-Agent':'Peris-reference-research'}});
 if(!response.ok)throw new Error(`Reference tree: HTTP ${response.status}`);tree=await response.json();
}
if(tree.sha!==revision||tree.truncated)throw new Error('Unexpected or incomplete pinned reference tree');
const entries=new Map(tree.tree.filter(e=>e.type==='blob'&&e.path.startsWith(prefix)).map(e=>[e.path.slice(prefix.length),e]));
const previous=JSON.parse(await readFile(join(out,'inventory.json'),'utf8'));
if(previous.revision!==revision)throw new Error('Original inventory revision changed');
const actorSeeds={
 roman:['units/romans/infantry_spearman_e.xml','units/romans/infantry_swordsman_e.xml','units/romans/infantry_javelinist_e.xml','units/romans/cavalry_javelinist_a_m.xml','units/romans/cavalry_javelinist_a_r.xml'],
 greek:['units/athenians/infantry_archer_e.xml','units/spartans/infantry_spearman_e.xml','units/spartans/hero_infantry_spearman_leonidas.xml','units/spartans/infantry_swordsman_c.xml','units/spartans/cavalry_spearman_e_m.xml','units/spartans/cavalry_spearman_e_r.xml'],
 persian:['units/persians/infantry_archer_e.xml','units/persians/infantry_spearman_e.xml','units/persians/cavalry_archer_e_m.xml','units/persians/cavalry_archer_e_r.xml','units/persians/cavalry_spearman_e_m.xml','units/persians/cavalry_spearman_e_r.xml'],
 egyptian:['units/ptolemies/infantry_archer_e.xml','units/ptolemies/infantry_spearman_e.xml','units/ptolemies/infantry_swordsman_e.xml','units/ptolemies/camel_archer_e_m.xml','units/ptolemies/camel_archer_e_r.xml','units/ptolemies/cavalry_spearman_e_m.xml','units/ptolemies/cavalry_spearman_e_r.xml','units/ptolemies/cavalry_javelinist_e_m.xml','units/ptolemies/cavalry_javelinist_e_r.xml'],
 siege:['units/romans/siege_ram.xml','units/romans/siege_onager.xml','structures/spartans/siege_ram.xml','structures/persians/siege_ram.xml'],
 fauna:['fauna/bear_brown.xml','fauna/bear_white.xml','fauna/boar.xml','fauna/wolf.xml','fauna/deer.xml','fauna/elephant_asian.xml','fauna/rhino.xml'],
 equipment:['props/units/weapons/axe_single.xml','props/units/weapons/axe_double.xml','props/units/weapons/axe_twohanded_mauryan.xml','props/units/weapons/kush_nubian_mace.xml','props/units/weapons/mace_mauryan.xml','props/units/weapons/bow_recurve.xml','props/units/quiver_greek_back.xml','props/units/shields/pelte_round_wood.xml','props/units/shields/celt_round_swirl.xml','props/units/helmets/celt_helmet_coolus_01.xml','props/units/helmets/celt_helmet_waterloo.xml','props/units/helmets/pers_conical_a1.xml','props/units/helmets/iber_cloth_helmet_01.xml'],
};
const extraSources=['meshes/skeletal/new/m_naked.dae','textures/skins/skeletal/gaul/naked_01.png'];
const queue=[...Object.values(actorSeeds).flat().map(path=>'actors/'+path),...extraSources],seen=new Set();
const files=new Map(previous.files.map(file=>[file.path,file]));
const blobHash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
function dependencies(data){
 const result=[];
 // Combat variants are selected by simulation state in the original game,
 // after the default appearance/Idle choice. Keep their clips available.
 for(const match of data.toString('utf8').matchAll(/<variant\b[^>]*\bfile="([^"]+)"/g))
  if(/attack_(melee|ranged)/.test(match[1]))result.push('variants/'+match[1]);
 let xml=data.toString('utf8').replace(/<group\b[^>]*>([\s\S]*?)<\/group>/g,(_,body)=>{
  const variants=[...body.matchAll(/<variant\b[^>]*(?:\/>|>[\s\S]*?<\/variant>)/g)];
  const roman=variants.find(v=>v[0].includes('name="rome-muscled-cuirass"'));
  return roman?.[0]||variants[0]?.[0]||'';
 });
 const states=new Set();xml=xml.replace(/<animation\b[^>]*\/>/g,tag=>{
  const name=/\bname="([^"]+)"/.exec(tag)?.[1];
  if(!/^(idle|walk|run|attack_melee|attack_ranged|attack)$/i.test(name||'')||states.has(name))return '';
  states.add(name);return tag;
 });
 for(const m of xml.matchAll(/<mesh>\s*([^<]+)\s*<\/mesh>/g))result.push('meshes/'+m[1].trim());
 for(const m of xml.matchAll(/<prop\b[^>]*\bactor="([^"]+)"/g))if(m[1])result.push('actors/'+m[1]);
 for(const m of xml.matchAll(/<variant\b[^>]*\bfile="([^"]+)"/g))result.push('variants/'+m[1]);
 for(const m of xml.matchAll(/<animation\b[^>]*\bfile="([^"]+)"/g))result.push('animation/'+m[1]);
 for(const m of xml.matchAll(/<texture\b[^>]*\bfile="([^"]+)"/g))result.push('textures/skins/'+m[1]);
 return result;
}
let verified=0;
for(let i=0;i<queue.length;){
 const batch=[];
 while(i<queue.length&&batch.length<4){const path=queue[i++];if(!seen.has(path)){seen.add(path);batch.push(path);}}
 const results=await Promise.allSettled(batch.map(async path=>{
  const entry=entries.get(path);if(!entry)throw new Error('Pinned source is missing: '+path);
  const url=`https://raw.githubusercontent.com/0ad/0ad/${revision}/${prefix}${path}`;
  let data;try{data=await readFile(join(out,path));}catch{}
  const downloaded=!data;
  if(data&&blobHash(data)!==entry.sha)throw new Error('Existing reference differs from its pinned original; preserve it and resolve separately: '+path);
  if(!data){
   const response=await fetch(url);if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
   data=Buffer.from(await response.arrayBuffer());
  }
  if(data.length!==entry.size||blobHash(data)!==entry.sha)throw new Error(`Integrity mismatch: ${path}`);
  return {path,data,url,downloaded};
 }));
 for(const result of results){
  if(result.status==='rejected')throw result.reason;
  const {path,data,url,downloaded}=result.value;
  files.set(path,{path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),url});
  const bytes=[...files.values()].reduce((sum,f)=>sum+f.bytes,0);
  if(files.size>1200||bytes>256*1024*1024)throw new Error(`Roster reference subset exceeds download budget: ${files.size} files / ${bytes} bytes at ${path}`);
  if(downloaded){await mkdir(dirname(join(out,path)),{recursive:true});await writeFile(join(out,path),data);}
  if(path.endsWith('.xml'))queue.push(...dependencies(data));
  if(++verified%30===0)console.log(`Verified ${verified} roster dependencies`);
 }
}
const inventory={...previous,edition:'roster-v3',previousInventory:'inventory.json',purpose:'Licensed source families for all Peris troop and siege visual prototypes. Original and adapted artwork retain CC BY-SA 3.0.',actorSeeds,extraSources,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),missing:[]};
await writeFile(join(out,'inventory-roster-v3.json'),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({edition:inventory.edition,verified,files:files.size,bytes:inventory.files.reduce((sum,f)=>sum+f.bytes,0),revision}));
