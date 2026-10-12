import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'assets/research-v1.json'),'utf8'));
const nodes=JSON.parse(await fs.readFile(path.join(root,'src/features/research/domain/catalog.json'),'utf8'));
async function output(source,index,dir,id,size){
 const input=path.join(root,source.file),meta=await sharp(input).metadata();
 const col=index%source.columns,row=Math.floor(index/source.columns);
 const left=Math.round(col*meta.width/source.columns),top=Math.round(row*meta.height/source.rows);
 const width=Math.round((col+1)*meta.width/source.columns)-left,height=Math.round((row+1)*meta.height/source.rows)-top;
 const crop=await sharp(input).extract({left,top,width,height}).png().toBuffer();
 const buffer=await sharp(crop).trim().resize(size-16,size-16,{fit:'contain',background:'#00000000'}).extend({top:8,bottom:8,left:8,right:8,background:'#00000000'}).webp({quality:91,effort:4}).toBuffer();
 if(!buffer.length)throw Error('Empty image '+id);
 await fs.mkdir(path.join(root,dir),{recursive:true});const target=path.join(root,dir,id+'.webp');await fs.writeFile(target+'.tmp',buffer);await fs.rename(target+'.tmp',target);
}
for(const node of nodes)await output(manifest.sources.find(s=>s.id===node.atlas),node.art_index,'public/art/research/v1',node.id,192);
for(const [index,faction] of manifest.academy_order.entries())await output(manifest.sources.find(s=>s.id==='academy'),index,'public/art/city/academy-v1',faction,384);
await output(manifest.sources.find(s=>s.id==='navigation'),0,'public/art/ui/low-poly-v1','research',96);
console.log('Exported 210 technology pictures, 12 Academy pictures and Research navigation');
