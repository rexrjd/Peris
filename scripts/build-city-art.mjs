import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'assets/city-village-v1.json'),'utf8'));
const size=400, gutter=24;
for(const asset of manifest.assets){
  const source=path.join(root,asset.sourceFile), meta=await sharp(source).metadata();
  if(!meta.hasAlpha)throw new Error(`${asset.faction}: source must contain transparency`);
  const layers=[];
  for(let index=0;index<12;index++){
    const col=index%3,row=Math.floor(index/3);
    const left=Math.round(col*meta.width/3),top=Math.round(row*meta.height/4);
    const width=Math.round((col+1)*meta.width/3)-left,height=Math.round((row+1)*meta.height/4)-top;
    const cell=await sharp(source).extract({left,top,width,height}).png().toBuffer();
    // Export only: normalize each source cell and give its sprite a safe clear gutter.
    const tile=await sharp(cell).trim({threshold:10}).resize(size-gutter*2,size-gutter*2,{fit:'contain',background:'#00000000'}).png().toBuffer();
    layers.push({input:tile,left:col*size+gutter,top:row*size+gutter});
  }
  const png=await sharp({create:{width:1200,height:1600,channels:4,background:'#00000000'}}).composite(layers).png().toBuffer();
  const webp=await sharp(png).webp({quality:88,alphaQuality:100,effort:5}).toBuffer();
  const output=path.join(root,asset.file);
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,webp);
  if(process.argv.includes('--preview')){
    const preview=path.join(root,'artifacts/city-motion-preview');
    await mkdir(preview,{recursive:true});await writeFile(path.join(preview,`${asset.faction}-soft-dark-v1.png`),png);
  }
  console.log(`${asset.faction}: 12 cells, 1200×1600, ${webp.length.toLocaleString()} bytes`);
}
