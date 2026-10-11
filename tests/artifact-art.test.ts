import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ARTIFACTS } from '../src/features/heroes/domain/artifacts';
test('every catalog item ships a unique nonempty transparent painting at the UI resolution', async () => {
    const manifest=JSON.parse(await readFile('assets/artifacts-v1.json','utf8'));
    assert.deepEqual(new Set(manifest.artifacts.map((a:{id:string})=>a.id)),new Set(Object.keys(ARTIFACTS)));
    const hashes=new Set<string>();
    for (const item of manifest.artifacts) {
        assert.equal('/'+item.file.slice(7),ARTIFACTS[item.id].image);
        const bytes=await readFile(item.file),meta=await sharp(bytes).metadata(),stats=await sharp(bytes).stats();
        assert.equal(meta.width,384);assert.equal(meta.height,384);assert.equal(meta.hasAlpha,true);
        assert.equal(stats.channels[3].min,0);assert.equal(stats.channels[3].max,255);
        hashes.add(createHash('sha256').update(bytes).digest('hex'));
        assert.equal((await sharp(item.source).metadata()).hasAlpha,true);
        assert.ok(item.prompt.length>500);
    }
    assert.equal(hashes.size,Object.keys(ARTIFACTS).length);
});
