import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const manifest = JSON.parse(await fs.readFile('assets/ui-low-poly-v1.json', 'utf8'));
for (const asset of manifest.assets) {
    const output = path.join('public', asset.image);
    if (process.argv.includes('--check')) {
        const info = await sharp(output).metadata();
        if (info.width !== 96 || info.height !== 96 || !info.hasAlpha) throw Error(`Invalid UI picture: ${asset.id}`);
    } else {
        await fs.mkdir(path.dirname(output), {recursive: true});
        await sharp(asset.source).trim().resize(96, 96, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).webp({quality: 92}).toFile(output);
    }
}
console.log(`${manifest.assets.length} low-poly UI pictures ${process.argv.includes('--check') ? 'verified' : 'exported'}`);
