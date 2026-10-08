import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const licenses = new Set(['original', 'CC0', 'CC-BY-4.0', 'licensed']);
const within = (base, file) => {
  const rel = relative(base, file);
  return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
};
const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(resolve(dir, entry.name)) : /\.glb$/i.test(entry.name) ? [resolve(dir, entry.name)] : []) : [];

export function validateManifest(manifest, projectRoot) {
  const errors = [], files = [], ids = new Set(), registered = new Set();
  if (manifest?.version !== 1 || !Array.isArray(manifest?.assets)) {
    return { errors: ['Manifest needs version 1 and an assets array.'], files };
  }
  const modelRoot = resolve(projectRoot, 'public/models');
  for (const asset of manifest.assets) {
    const label = asset?.id || '(unnamed)';
    if (!asset || typeof asset.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asset.id)) {
      errors.push(`${label}: use a lowercase hyphenated id.`);
    } else if (ids.has(asset.id)) errors.push(`${label}: duplicate id.`);
    ids.add(asset?.id);
    if (!licenses.has(asset?.license)) errors.push(`${label}: record an accepted license.`);
    if (asset?.license !== 'original' && (typeof asset?.source !== 'string' || !/^https:\/\//.test(asset.source))) {
      errors.push(`${label}: third-party assets need an HTTPS source URL.`);
    }
    if (['CC-BY-4.0', 'licensed'].includes(asset?.license) && !asset?.attribution?.trim()) {
      errors.push(`${label}: record attribution/license terms.`);
    }
    if (typeof asset?.file !== 'string' || !/^public\/models\/.+\.glb$/.test(asset.file) || asset.file.includes('\\')) {
      errors.push(`${label}: file must be public/models/*.glb.`);
      continue;
    }
    const file = resolve(projectRoot, asset.file);
    if (!within(modelRoot, file)) { errors.push(`${label}: path escapes public/models.`); continue; }
    if (registered.has(file)) errors.push(`${label}: duplicate model path.`);
    registered.add(file);
    if (!existsSync(file)) { errors.push(`${label}: model is missing.`); continue; }
    if (!within(realpathSync(projectRoot), realpathSync(file))) { errors.push(`${label}: symlink escapes the project.`); continue; }
    if (!statSync(file).isFile()) { errors.push(`${label}: model path is not a file.`); continue; }
    const limit = asset.maxBytes ?? 5 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit <= 0) errors.push(`${label}: maxBytes must be a positive integer.`);
    const data = readFileSync(file);
    if (data.length > limit) errors.push(`${label}: ${data.length} bytes exceeds the ${limit} byte budget.`);
    if (data.length < 12 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) {
      errors.push(`${label}: invalid GLB 2 header or length.`);
    }
    files.push(file);
  }
  for (const file of walk(modelRoot)) {
    if (!registered.has(file)) errors.push(`${relative(projectRoot, file)}: model is not registered.`);
  }
  return { errors, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'assets/manifest.json'), 'utf8'));
    const { errors, files } = validateManifest(manifest, root);
    if (errors.length) throw new Error(errors.join('\n'));
    for (const file of files) {
      const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@gltf-transform/cli/bin/cli.js'), 'validate', file], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error(`glTF validation failed: ${relative(root, file)}`);
    }
    console.log(`Asset checks passed: ${files.length} registered GLB model(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
