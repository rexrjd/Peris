import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'assets/references/units');
const args=process.argv.slice(2);
const option=name=>args[args.indexOf('--'+name)+1];
const uid=option('uid'),race=option('race'),folder=option('folder');
if(!/^[a-f0-9]{32}$/.test(uid)||!['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon','mount','weapons','armor','siege'].includes(race)||!folder||!/^[a-z0-9-]+$/.test(folder))throw new Error('Supply --uid, --race and a plain --folder name');
const catalogPath=path.join(directory,'sketchfab-catalog.json');
const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
const model=catalog.models.find(candidate=>candidate.uid===uid);
if(!model)throw new Error('Model is not in the verified catalog');
const target=path.join(directory,'sketchfab',race,folder);
const files=await fs.readdir(target);
const views=[];
const hashes=new Set();
for(const name of files.filter(name=>name.endsWith('.jpg')).sort()){
  const bytes=await fs.readFile(path.join(target,name));
  if(bytes[0]!==255||bytes[1]!==216||bytes.length<5000)throw new Error('Invalid screenshot '+name);
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hashes.has(hash))throw new Error('Repeated screenshot for different views: '+name);
  hashes.add(hash);
  views.push({label:name.replace('.jpg','').replaceAll('-',' '),path:`sketchfab/${race}/${folder}/${name}`,sha256:hash,bytes:bytes.length});
}
if(views.length<2)throw new Error('At least two visually inspected views are required');
model.viewed=true;
model.views=views;
if(args.includes('--assessment'))model.assessment=option('assessment');
const source={name:model.name,creator:model.creator,url:model.url,apiUrl:model.apiUrl,license:model.license,downloadable:model.downloadable,capturedAt:new Date().toISOString(),purpose:'Local multi-angle visual reference; external creator artwork, not an in-game Peris screenshot.',assessment:model.assessment,views};
await fs.writeFile(path.join(target,'SOURCE.json'),JSON.stringify(source,null,2)+'\n');
await fs.writeFile(path.join(target,'README.txt'),`${model.name}\nBy ${model.creator.name}\n${model.url}\nPublished license: ${model.license?.name??'No reuse license established'}\n\nLocal visual reference. Views were captured from the public interactive viewer and checked visually. ${model.assessment??''}\n`);
await fs.writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({race,model:model.name,views:views.length,folder:path.relative(root,target)}));
