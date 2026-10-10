import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const factions=['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'];
const roles=['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult'];
const revision='61a3b9507d974084e6badb88a0826bd89a6d5b8b';
const edition=process.env.PERIS_ROSTER_EDITION||'roster-v3';
if(!/^[a-z0-9-]+$/.test(edition))throw new Error('Invalid roster edition');
const requested=process.argv.slice(2);
if(requested.some(faction=>!factions.includes(faction)))throw new Error('Arguments must be faction names');
const selected=requested.length?[...new Set(requested)]:factions;
const stageOnly=process.env.PERIS_ROSTER_STAGE_ONLY==='1';
const sourceRoot=`assets/source/battle/${edition}`,logs='artifacts/battle-preview/assets/roster-v3';
mkdirSync(logs,{recursive:true});mkdirSync('public/models/battle',{recursive:true});
const cli=resolve('node_modules/@gltf-transform/cli/bin/cli.js');

function metadata(path){
 const data=readFileSync(path);
 if(data.toString('ascii',0,4)!=='glTF'||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length)throw new Error(`Invalid GLB header: ${path}`);
 return {data,gltf:JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)))};
}
function validatePack(path,maxBytes){
 const {data,gltf}=metadata(path);
 if(data.length>maxBytes)throw new Error(`Roster exceeds ${maxBytes} byte budget: ${path} (${data.length})`);
 if(gltf.extensionsRequired?.some(name=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(name)))throw new Error(`Decoder required by ${path}`);
 if(gltf.animations?.length!==27)throw new Error(`Expected 27 combined role clips: ${path}`);
 if(!gltf.images?.length||gltf.images.some(image=>image.bufferView===undefined||image.uri))throw new Error(`Roster textures must be embedded: ${path}`);
 for(const role of roles){
  const parts=gltf.nodes.filter(node=>node.name?.startsWith(role)&&node.mesh!==undefined);
  if(!parts.length||parts.some(node=>node.skin===undefined))throw new Error(`Missing skinned ${role}: ${path}`);
  for(const node of parts){
   if(node.extras?.asset_license!=='CC-BY-SA-3.0')throw new Error(`Missing ${role} source license: ${path}`);
   for(const primitive of gltf.meshes[node.mesh].primitives){
    if(primitive.attributes.JOINTS_0===undefined||primitive.attributes.WEIGHTS_0===undefined)throw new Error(`Unbound ${role} geometry: ${path}`);
    if(!gltf.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture)throw new Error(`Missing ${role} texture: ${path}`);
   }
  }
  const skins=new Set(parts.map(node=>node.skin));
  for(const state of ['idle','walk','attack']){
   const clip=gltf.animations.find(clip=>clip.name===`${role}_${state}`);
   if(!clip?.channels.length)throw new Error(`Missing ${role} ${state} clip: ${path}`);
   const targets=new Set(clip.channels.map(channel=>channel.target.node));
   for(const skin of skins)if(!gltf.skins[skin].joints.some(joint=>targets.has(joint)))throw new Error(`Clip omits ${role} rig: ${path}`);
  }
 }
 let vertices=0,triangles=0;
 for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){vertices+=gltf.accessors[primitive.attributes.POSITION].count;triangles+=(primitive.indices===undefined?gltf.accessors[primitive.attributes.POSITION].count:gltf.accessors[primitive.indices].count)/3;}
 return {bytes:data.length,vertices,triangles,skins:gltf.skins.length,meshes:gltf.meshes.length,materials:gltf.materials.length,embeddedImages:gltf.images.length,vertexEncoding:gltf.extensionsRequired?.includes('KHR_mesh_quantization')?'Float32 positions; native normalized 16-bit surface attributes and weights':'Float32 vertex attributes'};
}
function run(label,command,args){
 const result=spawnSync(process.execPath,[cli,command,...args],{encoding:'utf8',maxBuffer:12*1024*1024});
 writeFileSync(`${logs}/${label}.txt`,(result.stdout||'')+(result.stderr||''));
 if(result.status!==0)throw new Error(`${label} failed; see ${logs}`);
}
async function packAttributes(path,label){
 const [{NodeIO},{ALL_EXTENSIONS,KHRMeshQuantization},{quantize}]=await Promise.all([import('@gltf-transform/core'),import('@gltf-transform/extensions'),import('@gltf-transform/functions')]);
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),document=await io.read(path);
 copyFileSync(path,`${logs}/${label}-unquantized.glb`);
 // Preserve float32 positions, node transforms, bind matrices and animations.
 // Native normalized 16-bit vertex attributes keep the same textured detail
 // while reducing storage and GPU bandwidth; no runtime decoder is needed.
 await document.transform(quantize({pattern:/^(NORMAL|TANGENT|TEXCOORD_\d+|WEIGHTS_\d+)$/,quantizeNormal:16,quantizeTexcoord:16,quantizeWeight:16}));
 // 4.5.1's automatic extension detection reads POSITION for every semantic.
 // Attribute-only NORMAL quantization still requires this declaration.
 document.createExtension(KHRMeshQuantization).setRequired(true);
 const temporary=`${logs}/${label}-quantized.glb`;await io.write(temporary,document);renameSync(temporary,path);
}

// Check all inputs before publishing any new runtime files. No previous edition
// or procedural pack is overwritten by this pipeline.
const reportPath='public/models/battle/faction-rosters.json';
const report=existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')):{edition,sourceRevision:revision,roles,factions:{}};
if(report.edition!==edition)throw new Error('Public roster report belongs to another source edition');
const withheld=selected.filter(faction=>report.withheld?.[faction]);
if(!stageOnly&&withheld.length)throw new Error(`Withheld factions require completed quality review before publication: ${withheld.join(', ')}. Use PERIS_ROSTER_STAGE_ONLY=1 for isolated preparation.`);
const replaced=selected.filter(faction=>report.factions?.[faction]?.sourceEdition&&report.factions[faction].sourceEdition!==edition);
if(!stageOnly&&replaced.length)throw new Error(`Active prototype editions require their matching source publisher: ${replaced.join(', ')}. Preserve the current sources and use scripts/publish-prototype-roster.mjs for a reviewed derivative.`);
for(const faction of selected){
 const source=`${sourceRoot}/exports/${faction}-roster.glb`;
 if(!existsSync(`${sourceRoot}/peris-${faction}-army.blend`))throw new Error(`Missing editable ${faction} source`);
 validatePack(source,64*1024*1024);
}
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
for(const faction of selected){
 const source=`${sourceRoot}/exports/${faction}-roster.glb`;
 report.factions[faction]={};
 for(const detail of ['near','far']){
  const suffix=detail==='near'?'':'-lod',file=`public/models/battle/${faction}-roster${suffix}.glb`,temporary=`${logs}/${faction}${suffix}.glb`;
  // Models are already joined by role+rig and use an atlas. Retain skeletons,
  // UVs, socket attachments and provenance; no runtime decompressor is needed.
  // A 2048 atlas contains body, head, mount and equipment, so each part receives
  // only a fraction of these pixels. Distance models use 1024 and half geometry.
  run(`${faction}-optimize-${detail}`,'optimize',[source,temporary,'--compress','false','--palette','false','--flatten','false','--join','false','--instance','false','--simplify',detail==='near'?'false':'true','--simplify-ratio','.5','--simplify-error','.01','--texture-size',detail==='near'?'2048':'1024','--texture-compress','auto']);
  // The first complete lossless 2048-atlas pack measures 13.15 MiB. Keep room
  // for faction-specific gear while enforcing a smaller distance-pack budget.
  const maxBytes=(detail==='near'?16:8)*1024*1024;
  if(metadata(temporary).data.length>maxBytes)await packAttributes(temporary,`${faction}-${detail}`);
  run(`${faction}-validate-${detail}`,'validate',[temporary]);
  const metrics=validatePack(temporary,maxBytes);
  if(!stageOnly)renameSync(temporary,file);
  report.factions[faction][detail]=metrics;
  const id=`battle-${faction}-roster${suffix}`;
  manifest.assets=manifest.assets.filter(asset=>asset.id!==id);
  manifest.assets.push({id,file,license:'CC-BY-SA-3.0',source:`https://github.com/0ad/0ad/tree/${revision}/binaries/data/mods/public/art`,editableSource:`${sourceRoot}/peris-${faction}-army.blend`,sourceInventory:'assets/references/units/0ad/inventory-roster-v3.json',attribution:'Wildfire Games (https://wildfiregames.com/). Original meshes, textures and animations; Peris faction assembly, added equipment and fantasy shapes, texture atlases, matched mount/rider clips and GLB conversion. Original assets and adaptations: CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).',maxBytes,description:`Textured ${faction} roster: four foot troops, three mounted troops and two siege studies. Nine roles, 27 combined clips, independent mount/rider rigs. ${detail==='near'?'Full geometry and 2048 atlas.':'Distance geometry and 1024 atlas.'} Uncompressed glTF.`});
  console.log(`${faction} ${detail}${stageOnly?' staged':''}: ${metrics.bytes} bytes, ${metrics.triangles} triangles, ${metrics.meshes} meshes, ${metrics.materials} materials`);
 }
 // Per-faction publication allows reviewing finished models while the remaining
 // source exports are assembled; the report lists exactly which packs exist.
 if(!stageOnly){writeFileSync('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
}
if(stageOnly)process.exit(0);
mkdirSync('public/licenses',{recursive:true});
copyFileSync('assets/references/units/0ad/LICENSE.txt','public/licenses/0ad-art.txt');
writeFileSync('public/licenses/peris-faction-rosters.txt',`Peris textured faction rosters\n\nOriginal meshes, textures and animations: Wildfire Games\nhttps://wildfiregames.com/\nSource revision: ${revision}\nhttps://github.com/0ad/0ad/tree/${revision}/binaries/data/mods/public/art\n\nAdaptations for Peris: faction assembly, added equipment and fantasy shapes, shared texture atlases, seated mount/rider assembly, matched animation clips, GLB exports and distance models.\nOriginal assets and adaptations are licensed CC BY-SA 3.0.\nhttps://creativecommons.org/licenses/by-sa/3.0/\n\nEditable sources: ${sourceRoot}/peris-<faction>-army.blend\nSource inventory and hashes: assets/references/units/0ad/inventory-roster-v3.json\nSource family catalog: assets/references/units/roster-sources-v3.json\nRebuild prerequisites: installed project npm dependencies; Blender 4.5 with COLLADA import support; Python 3 with Pillow.\nRebuild order: scripts/fetch-roster-references.mjs; scripts/convert-reference-textures.py --inventory inventory-roster-v3.json; scripts/blender/cache_reference_imports.py (Blender) -- --inventory inventory-roster-v3.json; scripts/blender/build_faction_rosters.py (Blender); scripts/prepare-faction-rosters.mjs.\nUse PERIS_ROSTER_EDITION to identify the matching editable-source edition when preparing exports. Earlier sources and runtime packs are retained.\n\nThese are visual prototypes. Seven troop looks use existing infantry/archer/cavalry battle rules. The ram and catapult/stonehurler roles are inspection studies. Academy research and Workshop recruitment remain design plans.\n`);
