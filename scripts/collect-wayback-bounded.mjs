import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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
const rewriteMapPath = resolve(siteRoot, args.get('rewrite-map') || 'src/data/public-content/asset-rewrite-map.json');
const outPath = resolve(siteRoot, args.get('out') || 'src/data/public-content/wayback-manifest-bounded.json');
const limit = Number(args.get('limit') || 0);
const workers = Math.max(1, Number(args.get('workers') || 2));
const timeoutMs = Math.max(1000, Number(args.get('timeout-ms') || 10000));
const sleepMs = Math.max(0, Number(args.get('sleep-ms') || 100));
const includeMirrored = Boolean(args.get('include-mirrored'));
const CDX_ENDPOINT = 'https://web.archive.org/cdx';
const USER_AGENT = 'Mozilla/5.0 (compatible; mjnews-migration/1.0; +https://www.marijuananews.com)';

function normalizeUrl(url) {
  if (!url) return '';
  return url.startsWith('//') ? `https:${url}` : url;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(normalizeUrl(url));
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function cdxUrl(url) {
  const params = new URLSearchParams({
    url,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest,length',
    filter: 'statuscode:200',
    collapse: 'digest',
    sort: 'reverse',
    limit: '1'
  });
  return `${CDX_ENDPOINT}?${params.toString()}`;
}

function availabilityUrl(url) {
  const params = new URLSearchParams({ url });
  return `https://archive.org/wayback/available?${params.toString()}`;
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function lookup(candidate) {
  const originalUrl = normalizeUrl(candidate.url);
  let cdxError = null;
  try {
    const payload = await fetchJsonWithTimeout(cdxUrl(originalUrl));
    if (Array.isArray(payload) && payload.length >= 2) {
      const header = payload[0];
      const row = payload[1];
      const record = Object.fromEntries(header.map((key, index) => [key, row[index]]));
      const mimetype = record.mimetype || '';
      const rawMode = mimetype.startsWith('image/') || ['application/pdf', 'text/css', 'application/javascript', 'text/javascript'].includes(mimetype);
      const mode = rawMode ? 'id_' : '';
      const timestamp = record.timestamp;
      const archivedOriginal = record.original || originalUrl;
      return {
        url: candidate.url,
        normalized_url: originalUrl,
        found: true,
        source: 'cdx',
        timestamp,
        original: archivedOriginal,
        statuscode: record.statuscode,
        mimetype,
        digest: record.digest,
        length: record.length,
        wayback_url: timestamp ? `https://web.archive.org/web/${timestamp}${mode}/${archivedOriginal}` : null,
        sources: candidate.sources || [],
        metadata: { asset: candidate }
      };
    }
  } catch (error) {
    cdxError = error?.name === 'AbortError' ? `CDX timeout after ${timeoutMs}ms` : `CDX ${String(error?.message || error)}`;
  }

  try {
    const payload = await fetchJsonWithTimeout(availabilityUrl(originalUrl));
    const closest = payload?.archived_snapshots?.closest;
    if (closest?.available && closest.url) {
      return {
        url: candidate.url,
        normalized_url: originalUrl,
        found: true,
        source: 'availability',
        timestamp: closest.timestamp || null,
        original: originalUrl,
        statuscode: closest.status || null,
        mimetype: null,
        digest: null,
        length: null,
        wayback_url: closest.url,
        sources: candidate.sources || [],
        metadata: { asset: candidate }
      };
    }
    return { url: candidate.url, normalized_url: originalUrl, found: false, error: cdxError || null, availability_error: null, metadata: { asset: candidate } };
  } catch (error) {
    const availabilityError = error?.name === 'AbortError' ? `availability timeout after ${timeoutMs}ms` : `availability ${String(error?.message || error)}`;
    return { url: candidate.url, normalized_url: originalUrl, found: false, error: cdxError, availability_error: availabilityError, metadata: { asset: candidate } };
  }
}

const manifest = await loadJson(manifestPath, []);
const rewriteMap = await loadJson(rewriteMapPath, {});
const allCandidates = manifest.filter((asset) => asset?.url && isHttpUrl(asset.url));
const candidates = allCandidates.filter((asset) => {
  if (includeMirrored) return true;
  const original = asset.url;
  const normalized = normalizeUrl(original);
  return !rewriteMap[original] && !rewriteMap[normalized];
});
const selected = candidates.slice(0, limit || undefined);
const results = [];
let nextIndex = 0;
let completed = 0;

async function worker() {
  while (nextIndex < selected.length) {
    const candidate = selected[nextIndex++];
    const result = await lookup(candidate);
    results.push(result);
    completed++;
    if (completed % 25 === 0 || completed === selected.length) {
      console.log(`wayback ${completed}/${selected.length} found=${results.filter((item) => item.found).length} errors=${results.filter((item) => item.error).length}`);
    }
    await sleep(sleepMs);
  }
}

await Promise.all(Array.from({ length: Math.min(workers, selected.length || 1) }, () => worker()));
results.sort((a, b) => String(a.url).localeCompare(String(b.url)));

const now = new Date().toISOString();
const output = {
  schema_version: 1,
  generated_at: now,
  mode: includeMirrored ? 'all-assets' : 'unmirrored-assets',
  manifest_path: manifestPath,
  rewrite_map_path: rewriteMapPath,
  candidate_total: allCandidates.length,
  skipped_already_mirrored: includeMirrored ? 0 : allCandidates.length - candidates.length,
  selected_total: selected.length,
  lookup_total: results.length,
  found_total: results.filter((item) => item.found).length,
  errored_total: results.filter((item) => item.error || item.availability_error).length,
  found_by_source: results.filter((item) => item.found).reduce((acc, item) => {
    acc[item.source || 'unknown'] = (acc[item.source || 'unknown'] || 0) + 1;
    return acc;
  }, {}),
  timeout_ms: timeoutMs,
  workers,
  sleep_ms: sleepMs,
  lookups: results
};

await mkdir(resolve(outPath, '..'), { recursive: true });
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  out: outPath,
  candidate_total: output.candidate_total,
  skipped_already_mirrored: output.skipped_already_mirrored,
  selected_total: output.selected_total,
  lookup_total: output.lookup_total,
  found_total: output.found_total,
  errored_total: output.errored_total,
  found_by_source: output.found_by_source
}, null, 2));
