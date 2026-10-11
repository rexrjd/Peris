import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const manifest = JSON.parse(await fs.readFile('assets/artifacts-v1.json','utf8'));
for (const item of manifest.artifacts) {
    await fs.mkdir(path.dirname(item.file),{recursive:true});
    const input = sharp(item.source);
    const metadata = await input.metadata();
    if (!metadata.hasAlpha) throw Error(`${item.id}: generated source must preserve transparency`);
    await input.trim({threshold:8}).resize(320,320,{fit:'contain',background:'#00000000'}).extend({top:32,bottom:32,left:32,right:32,background:'#00000000'}).webp({quality:88}).toFile(item.file);
}
console.log(`${manifest.artifacts.length} distinct transparent artifact paintings exported at 384px`);
