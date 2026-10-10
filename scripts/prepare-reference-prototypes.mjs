import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const edition=process.env.PERIS_REFERENCE_EDITION||'reference-v2';
if(!/^[a-z0-9-]+$/.test(edition))throw new Error('Invalid reference edition');
const source=`assets/source/battle/${edition}/exports/reference-prototypes.raw.glb`;
const logs='artifacts/battle-preview/assets';mkdirSync(logs,{recursive:true});
const cli=resolve('node_modules/@gltf-transform/cli/bin/cli.js');
function run(label,command,args){
 const result=spawnSync(process.execPath,[cli,command,...args],{encoding:'utf8',maxBuffer:10*1024*1024});
 writeFileSync(`${logs}/reference-${label}.txt`,result.stdout+result.stderr);
 if(result.status!==0)throw new Error(`${label} failed; see reference asset log`);
}
run('inspect','inspect',[source]);
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
for(const detail of ['near','far']){
 const suffix=detail==='near'?'':'-lod',file=`public/models/battle/reference-prototypes${suffix}.glb`;
 run(`optimize-${detail}`,'optimize',[source,file,'--compress','false','--palette','false','--flatten','false','--join','false','--instance','false','--simplify',detail==='near'?'false':'true','--simplify-ratio','.5','--simplify-error','.01','--texture-size',detail==='near'?'1024':'512']);
 run(`validate-${detail}`,'validate',[file]);
 const id='battle-reference-prototypes'+suffix;
 manifest.assets=manifest.assets.filter(a=>a.id!==id);
 manifest.assets.push({id,file,license:'CC-BY-SA-3.0',source:'https://github.com/0ad/0ad/tree/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/art',editableSource:`assets/source/battle/${edition}/peris-reference-prototypes.blend`,attribution:'Wildfire Games (https://wildfiregames.com/). Original meshes, textures and animation; adapted assembly, faction tint, materials and GLB conversion for Peris. Assets and adaptations: CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).',maxBytes:6*1024*1024,description:'Roman infantry and seated cavalry source study; opt-in battle prototypes. Separate horse and rider rigs, shared sockets, six combined clips. Uncompressed glTF.'});
 console.log(`${detail}: ${readFileSync(file).length} bytes`);
}
writeFileSync('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');
mkdirSync('public/licenses',{recursive:true});
copyFileSync('assets/references/units/0ad/LICENSE.txt','public/licenses/0ad-art.txt');
writeFileSync('public/licenses/peris-unit-prototypes.txt',`Peris unit prototypes\n\nOriginal models, textures and animations: Wildfire Games\nhttps://wildfiregames.com/\nSource revision: 61a3b9507d974084e6badb88a0826bd89a6d5b8b\nhttps://github.com/0ad/0ad/tree/61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/art\n\nAdaptations for Peris: equipment assembly, faction tint, materials, matched rider/horse clips, GLB export and LOD.\nOriginal assets and adaptations are licensed CC BY-SA 3.0.\nhttps://creativecommons.org/licenses/by-sa/3.0/\n\nEditable source: assets/source/battle/${edition}/peris-reference-prototypes.blend\nRebuild prerequisites: installed project npm dependencies, Blender 4.5 with COLLADA import support, and Python 3 with Pillow.\nRebuild order: scripts/fetch-unit-references.mjs; scripts/convert-reference-textures.py (Python/Pillow); scripts/blender/cache_reference_imports.py (Blender); scripts/blender/build_reference_prototypes.py (Blender); scripts/prepare-reference-prototypes.mjs.\nAssembly preserves existing source files. Choose an unused --edition name and use the same PERIS_REFERENCE_EDITION when preparing the output.\n`);
