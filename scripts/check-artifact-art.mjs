import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ARTIFACTS } from '../src/features/heroes/domain/artifacts.ts';
const hashes = new Set();
for (const [id, item] of Object.entries(ARTIFACTS)) {
    const file = 'public' + item.image;
    let bytes;
    try { bytes = await readFile(file); } catch { throw Error(`Missing artifact picture ${id}: ${file}`); }
    const meta = await sharp(bytes).metadata();
    if (meta.width !== 384 || meta.height !== 384 || !meta.hasAlpha) throw Error(`Invalid artifact picture: ${id}`);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
}
if (hashes.size !== Object.keys(ARTIFACTS).length) throw Error('Artifact pictures must be unique');
console.log(`${hashes.size} unique artifact pictures verified for deployment`);
