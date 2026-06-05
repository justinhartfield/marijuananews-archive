import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ACCOUNT_ID = '83bca4785389c4bd0b3d9c8da6c7a155';
const bucket = process.argv[2] || 'marijuananews-archive-assets';
const distDir = path.resolve(process.argv[3] || 'dist');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const concurrency = Number(process.env.R2_UPLOAD_CONCURRENCY || 8);

if (!token) {
  console.error('CLOUDFLARE_API_TOKEN is required.');
  process.exit(1);
}

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.php', 'text/plain; charset=utf-8'],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function keyFor(file) {
  return path.relative(distDir, file).split(path.sep).join('/');
}

async function uploadOne(file) {
  const key = keyFor(file);
  const body = await readFile(file);
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodedKey}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': contentType(file),
  };

  let lastError = '';
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('request timeout')), 30000);
    let response;
    try {
      response = await fetch(url, { method: 'PUT', headers, body, signal: controller.signal });
    } catch (error) {
      lastError = error?.message || String(error);
      if (attempt === 7) break;
      const waitMs = Math.min(30000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      await sleep(waitMs);
      continue;
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) return { key, bytes: body.byteLength };
    const text = await response.text().catch(() => '');
    lastError = `${response.status} ${response.statusText} ${text.slice(0, 240)}`;
    if (![408, 409, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === 7) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
    await sleep(waitMs);
  }
  throw new Error(`${key}: ${lastError}`);
}

async function main() {
  const distStat = await stat(distDir);
  if (!distStat.isDirectory()) throw new Error(`${distDir} is not a directory`);
  const allFiles = (await walk(distDir)).sort();
  const offset = Number(process.env.R2_UPLOAD_OFFSET || 0);
  const limit = process.env.R2_UPLOAD_LIMIT ? Number(process.env.R2_UPLOAD_LIMIT) : undefined;
  const files = allFiles.slice(offset, limit ? offset + limit : undefined);
  console.log(`Uploading ${files.length} files from ${distDir} to r2://${bucket}/ with concurrency=${concurrency} offset=${offset}`);

  let next = 0;
  let completed = 0;
  let uploadedBytes = 0;
  const failures = [];

  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        const result = await uploadOne(file);
        completed += 1;
        uploadedBytes += result.bytes;
        if (completed % 100 === 0 || completed === files.length) {
          console.log(`uploaded ${completed}/${files.length} (${(uploadedBytes / 1024 / 1024).toFixed(2)} MiB)`);
        }
      } catch (error) {
        failures.push(error.message);
        console.error(error.message);
        if (failures.length >= 25) throw new Error('too many upload failures');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures: failures.slice(0, 25), failure_count: failures.length }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, files: completed, bytes: uploadedBytes, bucket }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
