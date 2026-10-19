import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildCityPreviewArt({ check = false } = {}) {
    const manifest = JSON.parse(await readFile(resolve(root, 'assets/city-preview-v1.json'), 'utf8'));
    for (const asset of manifest.assets) {
        const output = await sharp(resolve(root, asset.source)).resize(256, 256).webp({ quality: 80 }).toBuffer();
        const target = resolve(root, asset.file);
        if (check) {
            if (!output.equals(await readFile(target))) throw new Error(`City preview artwork is stale: ${asset.file}`);
        } else {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, output);
        }
    }
    console.log(`City preview artwork ${check ? 'checked' : 'built'}: ${manifest.assets.length} backdrops.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildCityPreviewArt({ check: process.argv.includes('--check') });
