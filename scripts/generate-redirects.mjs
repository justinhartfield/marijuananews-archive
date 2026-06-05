import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const siteRoot = resolve(import.meta.dirname, '..');
const redirectsPath = resolve(siteRoot, 'src/data/public-content/redirects.json');
const outPath = resolve(siteRoot, 'public/_redirects');

const redirects = JSON.parse(await readFile(redirectsPath, 'utf8'));
const seen = new Set();
const lines = [
  '# Generated from src/data/public-content/redirects.json',
  '# Format: from to status',
  '# If your host caps _redirects rules, import this source JSON into Bulk Redirects or a thin edge Worker.',
];

for (const rule of redirects) {
  if (!rule?.from || !rule?.to) continue;
  if (rule.from === rule.to) continue;
  const key = `${rule.from} ${rule.to}`;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(`${rule.from} ${rule.to} ${rule.status || 301}`);
}

await mkdir(resolve(siteRoot, 'public'), { recursive: true });
await writeFile(outPath, `${lines.join('\n')}\n`);
console.log(`Wrote ${seen.size} redirect rules to ${outPath}`);
