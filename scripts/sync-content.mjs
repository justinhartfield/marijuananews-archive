import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const siteRoot = resolve(import.meta.dirname, '..');
const source = resolve(repoRoot, 'out/public-content');
const dest = resolve(siteRoot, 'src/data/public-content');

try {
  await access(source, constants.R_OK);
} catch {
  throw new Error(`Missing exported content directory: ${source}. Run scripts/export_mjnews_public.py first.`);
}

await mkdir(dirname(dest), { recursive: true });
await cp(source, dest, { recursive: true, force: true });

const rewriteMap = resolve(dest, 'asset-rewrite-map.json');
try {
  await access(rewriteMap, constants.R_OK);
} catch {
  await writeFile(rewriteMap, '{}\n');
}

console.log(`Synced public-content artifacts to ${dest}`);
