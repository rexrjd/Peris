import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'assets/diplomats-v2.json');
const factions=['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Technical runtime export only; the original generated PNGs remain untouched. */
export async function buildDiplomatPortraits({check=false}={}){
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  assert.equal(manifest.version,2);assert.equal(manifest.license,'original');
  assert.deepEqual(manifest.portraits.map(row=>row.faction),factions,'Every existing faction needs a distinct civic portrait');
  assert.equal(manifest.output.width,512);assert.equal(manifest.output.height,512);
  const sourceHashes=new Set(),runtimeHashes=new Set();let bytesTotal=0;
  for(const portrait of manifest.portraits){
    assert.equal(portrait.source,`assets/source/diplomats-v2/${portrait.faction}.png`);
    assert.equal(portrait.runtime,`public/art/battle/diplomats-v2/${portrait.faction}.webp`);
    assert.ok(portrait.prompt?.length>100&&portrait.references?.length,'Record the actual generation brief and reference paths');
    for(const reference of portrait.references){
      assert.ok(!path.isAbsolute(reference)&&!reference.split(/[\\/]/).includes('..'),'References stay in the project');
      await fs.access(path.join(root,reference));
    }
    const original=await fs.readFile(path.join(root,portrait.source));
    const source=await sharp(original).metadata();
    assert.ok(source.hasAlpha&&source.width===source.height&&source.width>=512,`${portrait.faction}: source must be a square transparent PNG`);
    const sourceHash=hash(original);assert.ok(!sourceHashes.has(sourceHash),'Do not duplicate faction portraits');sourceHashes.add(sourceHash);
    const exported=await sharp(original).resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:manifest.output.quality,alphaQuality:manifest.output.alphaQuality,effort:6}).toBuffer();
    if(!check){
      await fs.mkdir(path.dirname(path.join(root,portrait.runtime)),{recursive:true});
      await fs.writeFile(path.join(root,portrait.runtime),exported);
      portrait.sourceSha256=sourceHash;portrait.sourceSize=[source.width,source.height];
      portrait.runtimeSha256=hash(exported);portrait.runtimeBytes=exported.length;
    }
    const runtime=await fs.readFile(path.join(root,portrait.runtime)),metadata=await sharp(runtime).metadata();
    assert.equal(metadata.format,'webp');assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.ok(metadata.hasAlpha);
    assert.equal(portrait.sourceSha256,sourceHash,`${portrait.faction}: source hash changed`);
    assert.equal(portrait.runtimeSha256,hash(runtime),`${portrait.faction}: runtime hash changed`);
    assert.equal(portrait.runtimeBytes,runtime.length);assert.ok(runtime.length<=manifest.output.maxBytes,`${portrait.faction}: runtime byte budget exceeded`);
    assert.ok(runtime.equals(exported),`${portrait.faction}: regenerate the runtime export from its source`);
    assert.ok(!runtimeHashes.has(hash(runtime)),'Every faction must have unique runtime artwork');runtimeHashes.add(hash(runtime));
    const alpha=await sharp(runtime).extractChannel('alpha').stats();
    assert.equal(alpha.channels[0].min,0,`${portrait.faction}: preserve genuinely transparent outer margins`);
    assert.equal(alpha.channels[0].max,255,`${portrait.faction}: keep the painted portrait opaque`);
    bytesTotal+=runtime.length;
  }
  const outputs=(await fs.readdir(path.join(root,'public/art/battle/diplomats-v2'))).filter(file=>file.endsWith('.webp')).sort();
  assert.deepEqual(outputs,factions.map(faction=>`${faction}.webp`).sort(),'No missing or orphaned faction exports');
  if(!check)await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(`${factions.length} original diplomat portraits ${check?'verified':'exported'} (${bytesTotal} runtime bytes)`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await buildDiplomatPortraits({check:process.argv.includes('--check')});}
  catch(error){console.error(error.message);process.exitCode=1;}
}
