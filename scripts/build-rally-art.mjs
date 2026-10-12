import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(root, 'assets/rally-point-v1.json');
const factions = ['roman', 'spartan', 'persian', 'egyptian', 'orc', 'elf', 'dwarf', 'gnome', 'pandaren', 'undead', 'demon'];
const kinds = ['background', 'frame', 'texture'];
const slices = { orc: 290, elf: 265, dwarf: 340, gnome: 340 };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checkedPath = (file, prefix) => {
    assert.ok(typeof file === 'string' && file.startsWith(prefix) && !file.includes('\\'), `Invalid asset path: ${file}`);
    const resolved = path.resolve(root, file), rel = path.relative(root, resolved);
    assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `Asset path escapes the project: ${file}`);
    return resolved;
};

function fontWeight(bytes) {
    assert.equal(bytes.readUInt32BE(0), 0x00010000, 'Fonts must be preserved TrueType files');
    const count = bytes.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
        const offset = 12 + i * 16;
        if (bytes.toString('ascii', offset, offset + 4) === 'OS/2') return bytes.readUInt16BE(bytes.readUInt32BE(offset + 8) + 4);
    }
    throw Error('Font is missing its OS/2 weight table');
}

export async function buildRallyArt({ check = false } = {}) {
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.assets.length, factions.length * kinds.length);
    const ids = new Set(), sourceHashes = new Set(), runtimeHashes = new Set();
    let runtimeBytes = 0;
    for (const asset of manifest.assets) {
        assert.ok(factions.includes(asset.faction) && kinds.includes(asset.kind), asset.id);
        assert.equal(asset.id, `${asset.faction}-${asset.kind}`);
        assert.ok(!ids.has(asset.id), `Duplicate painting: ${asset.id}`);
        ids.add(asset.id);
        assert.equal(asset.license, 'original', `${asset.id}: generated ownership must be recorded`);
        assert.ok(asset.prompt?.trim(), `${asset.id}: full generation prompt is required`);
        assert.equal(asset.source, `assets/source/rally-point-v1/${asset.id}.png`);
        assert.equal(asset.file, `public/art/ui/rally-point-v1/${asset.id}.webp`);
        const source = await fs.readFile(checkedPath(asset.source, 'assets/source/rally-point-v1/'));
        assert.equal(digest(source), asset.sourceSha256, `${asset.id}: untouched PNG checksum changed`);
        assert.equal(source.length, asset.sourceBytes, `${asset.id}: source byte count changed`);
        assert.ok(!sourceHashes.has(asset.sourceSha256), `${asset.id}: paintings must be distinct`);
        sourceHashes.add(asset.sourceSha256);
        const expected = asset.kind === 'background' ? { width: 1672, height: 941 } : { width: 1254, height: 1254 };
        assert.deepEqual(asset.dimensions, expected, `${asset.id}: preserve native dimensions`);
        const sourceInfo = await sharp(source).metadata();
        assert.equal(sourceInfo.width, expected.width, asset.id);
        assert.equal(sourceInfo.height, expected.height, asset.id);
        if (asset.kind === 'frame') {
            assert.ok(sourceInfo.hasAlpha, `${asset.id}: frame must have alpha`);
            assert.equal(asset.nineSlicePixels, slices[asset.faction] ?? 225, `${asset.id}: preserve the original nine-slice geometry`);
        }
        const output = checkedPath(asset.file, 'public/art/ui/rally-point-v1/');
        const { format, maxBytes, alpha, ...encoding } = manifest.export[asset.kind];
        assert.equal(format, 'webp');
        assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0);
        if (!check) {
            await fs.mkdir(path.dirname(output), { recursive: true });
            // Preserve the complete native canvas. Frames use lossless encoding;
            // backgrounds and textures use only the recorded format compression.
            await sharp(source).webp(encoding).toFile(output);
        }
        const bytes = await fs.readFile(output), info = await sharp(bytes).metadata();
        assert.equal(info.format, 'webp', asset.id);
        assert.equal(info.width, expected.width, asset.id);
        assert.equal(info.height, expected.height, asset.id);
        assert.ok(bytes.length <= maxBytes, `${asset.id}: ${bytes.length} bytes exceeds the ${maxBytes} byte budget`);
        const hash = digest(bytes);
        assert.ok(!runtimeHashes.has(hash), `${asset.id}: runtime paintings must be distinct`);
        runtimeHashes.add(hash);
        if (asset.kind === 'frame') {
            assert.ok(info.hasAlpha, `${asset.id}: WebP frame lost transparency`);
            const sourceAlpha = await sharp(source).ensureAlpha().extractChannel('alpha').raw().toBuffer();
            const runtimeAlpha = await sharp(bytes).ensureAlpha().extractChannel('alpha').raw().toBuffer();
            assert.ok(sourceAlpha.equals(runtimeAlpha), `${asset.id}: every frame alpha pixel must match the original`);
        }
        if (check) {
            assert.equal(hash, asset.runtimeSha256, `${asset.id}: runtime checksum changed; rebuild the edition`);
            assert.equal(bytes.length, asset.runtimeBytes, `${asset.id}: runtime byte count changed`);
        } else {
            asset.runtimeSha256 = hash;
            asset.runtimeBytes = bytes.length;
        }
        runtimeBytes += bytes.length;
    }
    for (const faction of factions) for (const kind of kinds) assert.ok(ids.has(`${faction}-${kind}`));
    assert.equal(manifest.fonts.length, 6);
    const fontKeys = new Set();
    for (const font of manifest.fonts) {
        assert.ok(['Cinzel', 'Crimson Text'].includes(font.family) && [400, 600, 700].includes(font.weight));
        assert.equal(font.style, 'normal');
        assert.equal(font.license, 'SIL OFL 1.1');
        assert.ok(/^https:\/\/github\.com\/google\/fonts\//.test(font.source));
        const key = `${font.family}:${font.weight}`;
        assert.ok(!fontKeys.has(key), `Duplicate font: ${key}`);
        fontKeys.add(key);
        const bytes = await fs.readFile(checkedPath(font.file, 'public/fonts/rally-point/'));
        assert.equal(digest(bytes), font.sha256, `${font.file}: untouched font checksum changed`);
        assert.equal(bytes.length, font.bytes, font.file);
        assert.equal(fontWeight(bytes), font.weight, `${font.file}: CSS weight must match the font`);
        const license = await fs.readFile(checkedPath(font.license_file, 'public/licenses/'), 'utf8');
        assert.ok(license.includes(font.copyright), `${font.file}: preserve the font copyright notice`);
        assert.ok(license.includes('SIL OPEN FONT LICENSE Version 1.1'), `${font.file}: preserve the font license`);
    }
    assert.equal(manifest.licenses.length, 2);
    for (const license of manifest.licenses) {
        const bytes = await fs.readFile(checkedPath(license.file, 'public/licenses/'));
        assert.equal(digest(bytes), license.sha256, `${license.file}: original license checksum changed`);
    }
    // Provenance must be portable, including the reference paths. Keep original
    // generation prompts intact while rejecting machine-specific source paths.
    assert.ok(!/(?:^|["\s])[A-Za-z]:[\\/]/.test(JSON.stringify(manifest)), 'Provenance contains an absolute machine path');
    if (!check) await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`33 original Rally Point paintings ${check ? 'verified' : 'exported'} (${runtimeBytes} runtime bytes); all 11 frame alpha planes, 6 font weights and OFL licenses verified.`);
    return { count: manifest.assets.length, runtimeBytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await buildRallyArt({ check: process.argv.includes('--check') });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
