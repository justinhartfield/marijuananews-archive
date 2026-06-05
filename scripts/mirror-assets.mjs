import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args.set(key, true);
  else {
    args.set(key, next);
    i++;
  }
}

const siteRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(siteRoot, args.get('manifest') || 'src/data/public-content/asset-manifest.json');
const waybackPath = args.get('wayback') ? resolve(siteRoot, args.get('wayback')) : null;
const rewriteMapPath = resolve(siteRoot, 'src/data/public-content/asset-rewrite-map.json');
const publicRewriteMapPath = resolve(siteRoot, 'public/assets/asset-rewrite-map.json');
const limit = Number(args.get('limit') || 0);
const sleepMs = Number(args.get('sleep-ms') || 150);
const timeoutMs = Number(args.get('timeout-ms') || 15000);
const workers = Math.max(1, Number(args.get('workers') || 1));
const dryRun = Boolean(args.get('dry-run'));
const force = Boolean(args.get('force'));

function normalizeUrl(url) {
  if (!url) return '';
  return url.startsWith('//') ? `https:${url}` : url;
}

function isMirrorableUrl(url) {
  const normalized = normalizeUrl(url);
  return /^https?:\/\//i.test(normalized);
}

function fallbackExtension(asset, response) {
  const suggested = asset.suggested_local_path || '';
  const existing = extname(suggested);
  if (existing) return existing;
  const type = response?.headers?.get('content-type') || asset.content_types?.[0] || '';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('svg')) return '.svg';
  return '.jpg';
}

function destinationFor(asset, response) {
  if (asset.suggested_local_path) return asset.suggested_local_path.replace(/^\/+/, '');
  const hash = createHash('sha256').update(asset.url).digest('hex').slice(0, 16);
  return `assets/${hash}${fallbackExtension(asset, response)}`;
}

async function loadWaybackMap() {
  if (!waybackPath) return new Map();
  const data = JSON.parse(await readFile(waybackPath, 'utf8'));
  const map = new Map();
  for (const lookup of data.lookups || []) {
    if (lookup.found && lookup.wayback_url) {
      map.set(lookup.url, lookup.wayback_url);
      map.set(normalizeUrl(lookup.url), lookup.wayback_url);
    }
  }
  return map;
}

async function loadJsonObject(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function cleanRewriteMap(map) {
  return Object.fromEntries(Object.entries(map || {}).filter(([source, destination]) => (
    isMirrorableUrl(source)
    && typeof destination === 'string'
    && destination.startsWith('/')
    && !destination.includes('\n')
  )));
}

async function fetchBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const existingRewriteMap = cleanRewriteMap(await loadJsonObject(rewriteMapPath));
const assets = manifest
  .filter((asset) => asset?.url)
  .filter((asset) => isMirrorableUrl(asset.url))
  .filter((asset) => {
    if (force) return true;
    const original = asset.url;
    const normalized = normalizeUrl(original);
    return !existingRewriteMap[original] && !existingRewriteMap[normalized];
  })
  .slice(0, limit || undefined);
const waybackMap = await loadWaybackMap();
const rewriteMap = { ...existingRewriteMap };
const failures = [];
let nextIndex = 0;
let attempted = 0;
let written = 0;

async function processAsset(asset) {
  attempted++;
  const original = asset.url;
  const normalized = normalizeUrl(original);
  const candidates = [normalized];
  const fallback = waybackMap.get(original) || waybackMap.get(normalized);
  if (fallback && !candidates.includes(fallback)) candidates.push(fallback);

  let response = null;
  let usedUrl = null;
  let error = null;
  for (const candidate of candidates) {
    try {
      response = await fetchBinary(candidate);
      usedUrl = candidate;
      break;
    } catch (err) {
      error = err;
    }
  }

  if (!response) {
    failures.push({ url: original, error: String(error?.message || error) });
    await sleep(sleepMs);
    return;
  }

  const localPath = destinationFor(asset, response);
  const publicPath = `/${localPath}`;
  rewriteMap[original] = publicPath;
  rewriteMap[normalized] = publicPath;

  if (!dryRun) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const destination = resolve(siteRoot, 'public', localPath);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
    written++;
  }

  console.log(`${dryRun ? 'would mirror' : 'mirrored'} ${original} -> ${publicPath}${usedUrl !== normalized ? ` via ${usedUrl}` : ''}`);
  await sleep(sleepMs);
}

async function worker() {
  while (nextIndex < assets.length) {
    const asset = assets[nextIndex++];
    await processAsset(asset);
  }
}

await Promise.all(Array.from({ length: Math.min(workers, assets.length || 1) }, () => worker()));

if (!dryRun) {
  await mkdir(resolve(siteRoot, 'src/data/public-content'), { recursive: true });
  await mkdir(resolve(siteRoot, 'public/assets'), { recursive: true });
  await writeFile(rewriteMapPath, `${JSON.stringify(rewriteMap, null, 2)}\n`);
  await writeFile(publicRewriteMapPath, `${JSON.stringify(rewriteMap, null, 2)}\n`);
}

console.log(JSON.stringify({ attempted, written, mapped: Object.keys(rewriteMap).length, failures: failures.length, failure_sample: failures.slice(0, 5) }, null, 2));
