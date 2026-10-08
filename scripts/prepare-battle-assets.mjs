import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const factions=process.argv.slice(2);
const sourceDir=process.env.PERIS_BATTLE_SOURCE || 'assets/source/battle';
const logDir='artifacts/battle-preview/assets';mkdirSync(logDir,{recursive:true});mkdirSync('public/models/battle',{recursive:true});
const cli=resolve('node_modules/@gltf-transform/cli/bin/cli.js');
const run=(faction,command,args)=>{
  const result=spawnSync(process.execPath,[cli,command,...args],{encoding:'utf8',maxBuffer:20*1024*1024});
  writeFileSync(`${logDir}/${faction}-${command}.txt`,result.stdout+result.stderr);
  if(result.status!==0)throw new Error(`${faction} ${command} failed; see asset log`);
};
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
for(const faction of factions){
  const raw=`${sourceDir}/exports/${faction}-army.raw.glb`,file=`public/models/battle/${faction}-army.glb`;
  run(faction,'inspect',[raw]);
  run(faction,'optimize',[raw,file,'--compress','false','--palette','false','--flatten','false','--join','false','--instance','false','--simplify','false']);
  run(faction,'validate',[file]);
  const id=`battle-${faction}-army`;
  manifest.assets=manifest.assets.filter(a=>a.id!==id);
  manifest.assets.push({id,file,license:'original',source:`${sourceDir}/peris-${faction}-army.blend`,maxBytes:5*1024*1024,description:'Original Peris prototype: seven rigged troops and two siege studies. 27 idle/walk/attack clips. No mesh compression decoder required.'});
  writeFileSync('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(`${faction}: inspected, optimized separately and validated (${readFileSync(file).length} bytes)`);
}
