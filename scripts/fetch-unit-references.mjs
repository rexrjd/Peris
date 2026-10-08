// Download a pinned, licensed reference subset, preserving 0 A.D.'s asset paths.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
const revision='61a3b9507d974084e6badb88a0826bd89a6d5b8b';
let tree;try{tree=JSON.parse(await readFile(join(process.env.TEMP,'peris-0ad-tree.json'),'utf8'));}catch{
 const response=await fetch(`https://api.github.com/repos/0ad/0ad/git/trees/${revision}?recursive=1`);
 if(!response.ok)throw new Error(`Reference tree: HTTP ${response.status}`);tree=await response.json();
}
if(tree.sha!==revision)throw new Error('Unexpected reference revision');
const prefix='binaries/data/mods/public/art/';
const entries=new Map(tree.tree.filter(e=>e.type==='blob'&&e.path.startsWith(prefix)).map(e=>[e.path.slice(prefix.length),e]));
const out='assets/references/units/0ad',queue=[
 'LICENSE.txt','actors/units/romans/infantry_swordsman_c4.xml',
 'actors/units/romans/cavalry_spearman_e_m.xml',
 'actors/units/romans/cavalry_spearman_e_r.xml',
 'meshes/skeletal/elephant_asian_male.dae','meshes/props/elephant/howdah_01.dae',
 'meshes/structural/rome_ram.dae','meshes/structural/siege_onager.dae',
];
const seen=new Set(),files=[],missing=[];
for(let i=0;i<queue.length;i++) {
 const path=queue[i];if(seen.has(path))continue;seen.add(path);
 const entry=entries.get(path);if(!entry){missing.push(path);continue;}
 if(files.length>450 || files.reduce((s,f)=>s+f.bytes,0)+entry.size>120*1024*1024)throw new Error('Reference subset exceeds download budget');
 const url=`https://raw.githubusercontent.com/0ad/0ad/${tree.sha}/${prefix}${path}`;
 let data;try{data=await readFile(join(out,path));}catch{}
 const blobHash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
 if(!data||blobHash(data)!==entry.sha){
  const response=await fetch(url);if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
  data=Buffer.from(await response.arrayBuffer());
  if(data.length!==entry.size||blobHash(data)!==entry.sha)throw new Error(`Integrity mismatch: ${path}`);
  await mkdir(dirname(join(out,path)),{recursive:true});await writeFile(join(out,path),data);
 }
 files.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),url});
 if(path.endsWith('.xml')) {
  // Pick one coherent appearance from each equipment group, not every alternate.
  let xml=data.toString('utf8').replace(/<group>([\s\S]*?)<\/group>/g,(_,body)=>{
    const variants=[...body.matchAll(/<variant\b[^>]*(?:\/>|>[\s\S]*?<\/variant>)/g)];
    const roman=variants.find(v=>v[0].includes('name="rome-muscled-cuirass"'));
    return roman?.[0]||variants[0]?.[0]||'';
  });
  const animationStates=new Set();xml=xml.replace(/<animation\b[^>]*\/>/g,tag=>{
    const name=/\bname="([^"]+)"/.exec(tag)?.[1];
    if(!['Idle','Walk','attack_melee'].includes(name)||animationStates.has(name))return '';
    animationStates.add(name);return tag;
  });
  for(const m of xml.matchAll(/<mesh>\s*([^<]+)\s*<\/mesh>/g))queue.push('meshes/'+m[1].trim());
  for(const m of xml.matchAll(/<prop\b[^>]*\bactor="([^"]+)"/g))if(m[1])queue.push('actors/'+m[1]);
  for(const m of xml.matchAll(/<variant\b[^>]*\bfile="([^"]+)"/g))queue.push('variants/'+m[1]);
  for(const m of xml.matchAll(/<animation\b[^>]*\bfile="([^"]+)"/g))queue.push('animation/'+m[1]);
  for(const m of xml.matchAll(/<texture\b[^>]*\bfile="([^"]+)"/g))queue.push('textures/skins/'+m[1]);
 }
 if(files.length%20===0)console.log(`Verified ${files.length} reference files`);
}
await writeFile(join(out,'inventory.json'),JSON.stringify({revision:tree.sha,license:'CC-BY-SA-3.0',author:'Wildfire Games',authorUrl:'https://wildfiregames.com/',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/',purpose:'Source study and adapted Peris prototypes. Original assets and adaptations retain CC BY-SA 3.0.',files,missing},null,2)+'\n');
console.log(JSON.stringify({files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),missing,revision:tree.sha}));
