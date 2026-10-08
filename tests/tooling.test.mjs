import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '../scripts/check-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'peris-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'public/models'), { recursive: true });
  // Header-level fixture; real glTF structure is validated by the CLI separately.
  const header = Buffer.alloc(12);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12, 8);
  writeFileSync(join(root, 'public/models/unit.glb'), header);
  return root;
}
const asset = { id: 'test-unit', file: 'public/models/unit.glb', license: 'original' };
test('accepts registered original models and rejects missing third-party provenance', t => {
  const root = fixture(t);
  assert.deepEqual(validateManifest({ version: 1, assets: [asset] }, root).errors, []);
  assert.ok(validateManifest({ version: 1, assets: [{ ...asset, license: 'CC0' }] }, root).errors.some(e => e.includes('source URL')));
});
test('rejects escaped paths, duplicate IDs and unregistered shipped models', t => {
  const root = fixture(t);
  assert.ok(validateManifest({ version: 1, assets: [{ ...asset, file: 'public/models/../../outside.glb' }] }, root).errors.some(e => e.includes('escapes')));
  assert.ok(validateManifest({ version: 1, assets: [asset, asset] }, root).errors.some(e => e.includes('duplicate id')));
  assert.ok(validateManifest({ version: 1, assets: [] }, root).errors.some(e => e.includes('not registered')));
});
test('rejects oversized and corrupt exports', t => {
  const root = fixture(t);
  assert.ok(validateManifest({ version: 1, assets: [{ ...asset, maxBytes: 1 }] }, root).errors.some(e => e.includes('budget')));
  writeFileSync(join(root, 'public/models/unit.glb'), 'broken');
  assert.ok(validateManifest({ version: 1, assets: [asset] }, root).errors.some(e => e.includes('invalid GLB')));
});
