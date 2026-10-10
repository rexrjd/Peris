import fs from 'node:fs/promises';
import sharp from 'sharp';
const manifest = JSON.parse(await fs.readFile('assets/hero-portrait-roster.json', 'utf8'));
let total = 0;
for (const row of manifest.factions) {
    const {width, height} = await sharp(row.source).metadata();
    if (!width || !height) throw Error(`Invalid portrait source: ${row.source}`);
    await fs.mkdir(row.outputDirectory, {recursive:true});
    for (let index = 0; index < manifest.portraitsPerFaction; index++) {
        const col = index % manifest.grid.columns, line = Math.floor(index / manifest.grid.columns);
        const left = Math.round(col * width / manifest.grid.columns), top = Math.round(line * height / manifest.grid.rows);
        const right = Math.round((col + 1) * width / manifest.grid.columns), bottom = Math.round((line + 1) * height / manifest.grid.rows);
        const file = `${row.outputDirectory}/${String(index + 1).padStart(2,'0')}.webp`;
        await sharp(row.source).extract({left,top,width:right-left,height:bottom-top}).resize(...manifest.outputSize).webp({quality:88}).toFile(file);
        total++;
    }
}
console.log(`Exported ${total} portraits across ${manifest.factions.length} factions`);
