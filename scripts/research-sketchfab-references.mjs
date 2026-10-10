import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'assets/references/units');
const refreshRequested = process.argv.includes('--refresh');
const freshForMs = 6 * 60 * 60 * 1000;
async function readJson(filename, fallback) {
  return fs.readFile(path.join(directory, filename), 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, ''))).catch(error => {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  });
}
async function readCandidates(filename) {
  const input = await readJson(filename, []);
  return Array.isArray(input) ? input : input.records ?? [];
}
const candidates = await readCandidates('sketchfab-candidates.json');
const additional = [...await readCandidates('sketchfab-additional-candidates.json'), ...await readCandidates('sketchfab-fantasy-candidates.json'), ...await readCandidates('sketchfab-equipment-candidates.json')];
const combined = new Map();
for (const candidate of [...candidates, ...additional]) {
  const previous = combined.get(candidate.uid);
  combined.set(candidate.uid, { ...previous, ...candidate,
    categories: [...new Set([...(previous?.categories ?? []), ...(candidate.categories ?? [])])],
    study: [...new Set([...(previous?.study ?? []), ...(candidate.study ?? [])])],
    concerns: [...new Set([...(previous?.concerns ?? []), ...(candidate.concerns ?? [])])],
  });
}
const previous = await readJson('sketchfab-catalog.json', { models: [], failures: [] });
const prior = new Map(previous.models.map(model => [model.uid, model]));
const queue = [...combined.values()];
const models = [];
const failures = (previous.failures ?? []).filter(failure => /NoAI restriction/i.test(failure.reason));
const excluded = new Set(failures.map(failure => failure.uid));
let rateLimited = false;

function date(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function fresh(model) {
  const checked = date(model?.checkedAt);
  const age = checked ? Date.now() - Date.parse(checked) : Infinity;
  return model?.metadataStatus !== 'stale' && age >= 0 && age < freshForMs;
}
function tagsOf(tags) {
  return Array.isArray(tags) ? tags.map(tag => typeof tag === 'string' ? tag.toLowerCase() : tag.name?.toLowerCase()).filter(Boolean) : [];
}
function restricted(candidate, metadata) {
  return excluded.has(candidate.uid) || metadata?.isNoAI === true || metadata?.apiNoAiTag === true || tagsOf(metadata?.tags).includes('noai');
}
function exclude(candidate) {
  excluded.add(candidate.uid);
  if (!failures.some(failure => failure.uid === candidate.uid && /NoAI restriction/i.test(failure.reason))) {
    failures.push({ uid: candidate.uid, reason: 'NoAI restriction: omitted from AI-assisted reference catalog' });
  }
}
function licenseOf(license) {
  if (!license || typeof license !== 'object' || !license.slug) return null;
  return { name: license.label ?? license.name, slug: license.slug, url: license.url ?? null };
}
function displayNumber(value) {
  if (Number.isFinite(value)) return value;
  const match = typeof value === 'string' && value.trim().match(/^([\d,.]+)\s*([km])?$/i);
  return match ? Math.round(Number(match[1].replaceAll(',', '')) * ({ k: 1000, m: 1000000 }[match[2]?.toLowerCase()] ?? 1)) : null;
}
function nameFromUrl(url, uid) {
  const slug = typeof url === 'string' && url.match(/\/3d-models\/([^/?#]+)/)?.[1];
  return slug?.replace(new RegExp(`-?${uid}$`), '').replaceAll('-', ' ').trim() || uid;
}
function evidence(candidate, saved) {
  return {
    viewed: Boolean(saved?.viewed || candidate.viewed),
    views: saved?.views ?? [],
    downloaded: saved?.downloaded ?? false,
    assessment: saved?.assessment ?? null,
  };
}
function reuseStatus(model) {
  if (model.metadataStatus === 'page-cache' || model.metadataStatus === 'undated') {
    return 'Cached reference metadata; check time or API confirmation missing. Reuse and current download availability require verification.';
  }
  return model.downloadable === true && ['by', 'by-sa', 'cc0'].includes(model.license?.slug)
    ? 'Published license allows credited reuse; archive and provenance still need inspection'
    : 'Visual reference; model reuse not established';
}

// Seed metadata has three forms: dated API records, undated API records,
// and cached page displays. Never manufacture a verification time or a
// download flag from a page title, advertised animations, or an absent field.
function seedMetadata(candidate, saved) {
  const verified = candidate.verified;
  if (!verified || typeof verified !== 'object') return null;
  const apiUrl = `https://api.sketchfab.com/v3/models/${candidate.uid}`;
  const apiVerified = verified.source === apiUrl && typeof verified.isDownloadable === 'boolean';
  const checkedAt = date(verified.verifiedAt ?? verified.checkedAt);
  const pageOnly = !apiVerified;
  const result = {
    ...saved,
    ...candidate,
    name: candidate.name ?? verified.name ?? saved?.name ?? candidate.family ?? nameFromUrl(candidate.url ?? verified.source, candidate.uid),
    url: candidate.url ?? (pageOnly ? verified.source : null) ?? saved?.url ?? `https://sketchfab.com/models/${candidate.uid}`,
    apiUrl,
    creator: { name: verified.artist ?? saved?.creator?.name ?? 'Creator not recorded', url: verified.artistUrl ?? saved?.creator?.url ?? null },
    triangles: displayNumber(verified.faceCount ?? verified.faceCountPage ?? verified.trianglesPageDisplay) ?? saved?.triangles ?? 0,
    vertices: displayNumber(verified.vertexCount ?? verified.vertexCountPage ?? verified.verticesPageDisplay ?? verified.vertexPageDisplay) ?? saved?.vertices ?? null,
    animationCount: Number.isFinite(verified.animationCount) ? verified.animationCount : saved?.animationCount ?? null,
    advertisedAnimationCount: verified.advertisedAnimations ?? null,
    downloadable: typeof verified.isDownloadable === 'boolean' ? verified.isDownloadable : saved?.downloadable ?? null,
    license: apiVerified ? licenseOf(verified.license) : saved?.license ?? (verified.licensePageLabel ? { name: verified.licensePageLabel, slug: null, url: null } : null),
    description: verified.description ?? saved?.description ?? '',
    tags: verified.tags ? tagsOf(verified.tags) : saved?.tags ?? [],
    thumbnail: verified.thumbnailUrl ?? saved?.thumbnail ?? null,
    checkedAt,
    metadataSource: verified.source ?? null,
    metadataStatus: pageOnly ? 'page-cache' : checkedAt ? 'current' : 'undated',
    ...evidence(candidate, saved),
  };
  result.useStatus = reuseStatus(result);
  return result;
}
function savedMetadata(candidate, saved) {
  const result = { ...saved, ...candidate, ...evidence(candidate, saved) };
  result.useStatus = reuseStatus(result);
  return result;
}
async function inspect(candidate) {
  const cached = prior.get(candidate.uid);
  if (restricted(candidate, cached) || restricted(candidate, candidate.verified)) {
    exclude(candidate);
    return;
  }
  const seed = seedMetadata(candidate, cached);
  if (!refreshRequested) {
    if (fresh(cached) && (!seed?.checkedAt || Date.parse(cached.checkedAt) >= Date.parse(seed.checkedAt))) {
      models.push(savedMetadata(candidate, cached));
      return;
    }
    if (seed && (fresh(seed) || !seed.checkedAt)) {
      models.push(seed);
      return;
    }
  }
  if (rateLimited) throw new Error('Sketchfab requests deferred after HTTP 429');
  const apiUrl = `https://api.sketchfab.com/v3/models/${candidate.uid}`;
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) });
  if (response.status === 429) rateLimited = true;
  if (!response.ok) throw new Error(`Sketchfab HTTP ${response.status}`);
  const model = await response.json();
  const tags = tagsOf(model.tags);
  if (restricted(candidate, model)) {
    exclude(candidate);
    return;
  }
  const result = {
    ...candidate,
    name: model.name,
    url: model.viewerUrl ?? candidate.url ?? `https://sketchfab.com/models/${candidate.uid}`,
    apiUrl,
    creator: { name: model.user.displayName, username: model.user.username, url: model.user.profileUrl },
    triangles: model.faceCount,
    vertices: model.vertexCount,
    animationCount: model.animationCount,
    downloadable: model.isDownloadable,
    license: licenseOf(model.license),
    description: model.description,
    tags,
    thumbnail: model.thumbnails?.images?.find(image => image.width === 1024)?.url ?? model.thumbnails?.images?.[0]?.url ?? null,
    checkedAt: new Date().toISOString(),
    metadataSource: apiUrl,
    metadataStatus: 'current',
    ...evidence(candidate, cached),
  };
  result.useStatus = reuseStatus(result);
  models.push(result);
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const candidate = queue.shift();
    try { await inspect(candidate); } catch (error) {
      failures.push({ uid: candidate.uid, reason: error.message });
      const cached = prior.get(candidate.uid);
      const seed = seedMetadata(candidate, cached);
      const saved = seed?.checkedAt && (!cached?.checkedAt || Date.parse(seed.checkedAt) > Date.parse(cached.checkedAt)) ? seed : cached ?? seed;
      if (saved && !restricted(candidate, saved)) {
        const retained = { ...savedMetadata(candidate, saved), metadataStatus: 'stale', lastCheckError: error.message, lastAttemptAt: new Date().toISOString() };
        retained.useStatus = 'Metadata refresh failed; previous reference evidence retained. Current download availability and reuse status require verification.';
        models.push(retained);
      }
    }
  }
}));
const latest = await readJson('sketchfab-catalog.json', { models: [], failures: [] });
const latestByUid = new Map(latest.models.map(model => [model.uid, model]));
for (const failure of latest.failures ?? []) {
  if (/NoAI restriction/i.test(failure.reason)) exclude({ uid: failure.uid });
}
for (const model of models) {
  const saved = latestByUid.get(model.uid);
  if (saved) Object.assign(model, evidence(model, saved));
}
const retainedModels = models.filter(model => !excluded.has(model.uid));
retainedModels.sort((a,b) => (b.userSelected ? 1 : 0) - (a.userSelected ? 1 : 0) || (a.categories[0] ?? '').localeCompare(b.categories[0] ?? '') || a.name.localeCompare(b.name));
const catalog = {
  updatedAt: new Date().toISOString(),
  source: 'Sketchfab public model metadata API and public interactive viewers',
  scope: ['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon','mount','siege'],
  notes: 'Reference research. The models shown here are by their credited creators. Viewed, downloaded and completed game unit status are separate. No models are claimed to be in Peris from this catalog alone.',
  models: retainedModels,
  failures,
};
await fs.writeFile(path.join(directory, 'sketchfab-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ candidates: combined.size, verified: retainedModels.filter(model => model.metadataStatus === 'current' || !model.metadataStatus).length, cachedWithoutCheckTime: retainedModels.filter(model => ['undated', 'page-cache'].includes(model.metadataStatus)).length, retained: retainedModels.length, viewed: retainedModels.filter(model => model.viewed).length, failures }));
