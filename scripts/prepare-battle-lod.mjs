import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
const sourceDir=process.env.PERIS_BATTLE_SOURCE || 'assets/source/battle';
for(const faction of process.argv.slice(2)) {
  const file=`public/models/battle/${faction}-army-lod.glb`;
  const result=spawnSync(process.execPath,[resolve('node_modules/@gltf-transform/cli/bin/cli.js'),'optimize',`${sourceDir}/exports/${faction}-army.raw.glb`,file,
    '--compress','false','--palette','false','--flatten','false','--join','false','--instance','false','--simplify-ratio','.22','--simplify-error','.02'],{encoding:'utf8',maxBuffer:10*1024*1024});
  writeFileSync(`artifacts/battle-preview/assets/${faction}-lod-optimize.txt`,result.stdout+result.stderr);
  if(result.status!==0)throw new Error('LOD optimization failed: '+faction);
  const id=`battle-${faction}-army-lod`;
  manifest.assets=manifest.assets.filter(a=>a.id!==id);
  manifest.assets.push({id,file,license:'original',source:`${sourceDir}/peris-${faction}-army.blend`,maxBytes:3*1024*1024,description:'Distance detail mesh. Same rigs and 27 clips, uncompressed glTF. Inspect at tactical distance.'});
  writeFileSync('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(`${faction}: LOD generated (${readFileSync(file).length} bytes)`);
}
