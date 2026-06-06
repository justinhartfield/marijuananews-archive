import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker/index.js';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const TEST_PASSWORD = 'test-password-not-secret';
const PROBLEM_ARTICLE = '/articles/the-very-sad-case-of-the-wall-street-journal-editorial-page-the-betrayal-of-their-own-principles-lying-to-their-readers-about-the-netherlands-and-the-benefits-of-freedom/';
const FIXED_BOTTOM_LINK = '/articles/legalize-marijuana-and-improve-high-school-academic-performance-holland-ranks-first-the-us-very-low/';
const SITE_TAGLINE = 'Freedom has nothing to fear from the truth.';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function contentTypeFor(key) {
  return CONTENT_TYPES.get(path.extname(key).toLowerCase()) || 'application/octet-stream';
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

class LocalR2Object {
  constructor(key, filePath, body, stats) {
    this.key = key;
    this.filePath = filePath;
    this.body = body;
    this.size = stats.size;
    this.uploaded = stats.mtime;
    this.etag = `local-${stats.size}`;
    this.httpEtag = `"local-${stats.size}"`;
    this.httpMetadata = { contentType: contentTypeFor(key) };
  }

  async text() {
    return this.body.toString('utf8');
  }

  writeHttpMetadata(headers) {
    headers.set('content-type', this.httpMetadata.contentType);
    headers.set('content-length', String(this.size));
  }
}

class LocalR2Bucket {
  constructor(files) {
    this.files = files;
    this.objects = new Map();
  }

  static async fromDist() {
    const files = new Map();
    for (const file of await walk(distDir)) {
      const key = path.relative(distDir, file).split(path.sep).join('/');
      files.set(key, file);
    }
    return new LocalR2Bucket(files);
  }

  async get(key) {
    if (this.objects.has(key)) {
      const record = this.objects.get(key);
      return new LocalR2Object(key, key, Buffer.from(record.body), { size: Buffer.byteLength(record.body), mtime: new Date(record.uploaded) });
    }
    const file = this.files.get(key);
    if (!file) return null;
    const [body, stats] = await Promise.all([readFile(file), stat(file)]);
    return new LocalR2Object(key, file, body, stats);
  }

  async put(key, body) {
    const value = typeof body === 'string' ? body : String(body || '');
    this.objects.set(key, { body: value, uploaded: new Date().toISOString() });
  }

  async list(options = {}) {
    const prefix = options.prefix || '';
    const limit = options.limit || 1000;
    const all = Array.from(this.files.keys()).filter((key) => key.startsWith(prefix)).sort();
    return {
      objects: all.slice(0, limit).map((key) => ({
        key,
        size: 1,
        uploaded: new Date(0),
        etag: 'local',
        httpEtag: '"local"',
        httpMetadata: { contentType: contentTypeFor(key) },
      })),
      truncated: all.length > limit,
      cursor: all.length > limit ? String(limit) : undefined,
    };
  }
}

function authHeader(username = 'admin', password = TEST_PASSWORD) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function request(pathname, options = {}) {
  const env = { ARCHIVE_ASSETS: await LocalR2Bucket.fromDist(), BACKEND_USER: 'admin', BACKEND_PASSWORD: TEST_PASSWORD };
  return worker.fetch(new Request(`https://example.test${pathname}`, options), env, {});
}

async function expectStatus(pathname, status, options) {
  const response = await request(pathname, options);
  if (response.status !== status) {
    throw new Error(`${pathname} expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function assertNoBrokenLocalFileLinks() {
  const badPatterns = [
    ['file protocol link', /file:\/\//i],
    ['FrontPage temp path', /C:\/Program\s+Files\/Microsoft\s+FrontPage\/temp\//i],
    ['Wayback wrapped file URL', /web\.archive\.org\/[^"'<>\s]+\/file:/i],
    ['whitespace-prefixed href', /href=(['"])\s+[^'"]*\1/i],
  ];
  const failures = [];
  for (const file of await walk(distDir)) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    for (const [label, pattern] of badPatterns) {
      const match = html.match(pattern);
      if (match) {
        failures.push(`${path.relative(distDir, file)}: ${label}: ${match[0].slice(0, 180)}`);
        break;
      }
    }
  }
  if (failures.length) throw new Error(`broken local/FrontPage links remain:\n${failures.slice(0, 40).join('\n')}`);
}

async function assertGlobalTagline() {
  const failures = [];
  for (const file of await walk(distDir)) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    if (!html.includes(SITE_TAGLINE)) failures.push(path.relative(distDir, file));
  }
  if (failures.length) throw new Error(`global tagline missing from rendered HTML:\n${failures.slice(0, 40).join('\n')}`);
}

await expectStatus('/', 200);
await expectStatus('/articles', 200);
await expectStatus('/articles/', 200);
await expectStatus('/chronological-index', 200);
await expectStatus('/chronological-index/', 200);
await expectStatus('/memory-hole', 200);
await expectStatus('/memory-hole/', 200);
await expectStatus('/search/', 200);
await expectStatus('/_backend/index.json', 404);
const publicSearch = await (await expectStatus('/api/search?q=Peter&limit=5', 200)).json();
const preflight = await expectStatus('/api/search', 204, { method: 'OPTIONS', headers: { origin: 'https://example.org', 'access-control-request-method': 'GET' } });
if (preflight.headers.get('access-control-allow-origin') !== '*') throw new Error('public API CORS preflight failed');
if (!publicSearch.items.length || !publicSearch.items[0].title || publicSearch.items[0].migration) throw new Error('public search failed or leaked backend-only metadata');
const publicArticles = await (await expectStatus('/api/articles?limit=3', 200)).json();
if (publicArticles.items.length !== 3 || publicArticles.items.some((item) => item.contentLength || item.migration)) throw new Error('public articles API has wrong shape');
const publicFaqs = await (await expectStatus('/api/faqs?limit=3', 200)).json();
if (!publicFaqs.items.length || !publicFaqs.items[0].question) throw new Error('public FAQs API failed');
const publicBio = await (await expectStatus('/api/bio', 200)).json();
if (!publicBio.ok || !publicBio.bio) throw new Error('public bio API failed');
const problemArticleHtml = await (await expectStatus(PROBLEM_ARTICLE, 200)).text();
if (problemArticleHtml.includes('href=" /') || problemArticleHtml.includes("href=' /")) throw new Error('rendered article still has whitespace-prefixed hrefs');
if (problemArticleHtml.includes('file:///C:/Program')) throw new Error('rendered article still has broken FrontPage file link');
if (!problemArticleHtml.includes(`href="${FIXED_BOTTOM_LINK}"`)) throw new Error('rendered article missing repaired bottom MarijuanaNews article link');
const legacyArticle = await expectStatus(`${PROBLEM_ARTICLE}legacy`, 301);
if (!legacyArticle.headers.get('location')?.endsWith(PROBLEM_ARTICLE)) throw new Error('legacy article URL did not redirect to canonical article path');
await assertNoBrokenLocalFileLinks();
await assertGlobalTagline();
const newsletterInfo = await (await expectStatus('/api/newsletter', 200)).json();
if (!newsletterInfo.ok || newsletterInfo.endpoint !== '/api/newsletter') throw new Error('newsletter metadata API failed');
const badNewsletter = await (await expectStatus('/api/newsletter', 400, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'not-an-email' })
})).json();
if (badNewsletter.ok !== false) throw new Error('invalid newsletter email was accepted');
const goodNewsletter = await (await expectStatus('/api/newsletter', 200, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'reader@example.com', source: 'smoke' })
})).json();
if (!goodNewsletter.ok || !goodNewsletter.subscribed) throw new Error('valid newsletter signup failed');
await expectStatus('/_private/newsletter-signups/test.json', 404);
const unauth = await expectStatus('/backend/', 401);
if (!unauth.headers.get('www-authenticate')?.includes('MarijuanaNews Backend')) throw new Error('missing Basic auth challenge');
await expectStatus('/backend/', 401, { headers: { authorization: authHeader('admin', 'wrong') } });
const html = await (await expectStatus('/backend/', 200, { headers: { authorization: authHeader() } })).text();
if (!html.includes('MarijuanaNews Backend') || !html.includes('/backend/api')) throw new Error('backend HTML shell missing expected tokens');
const overview = await (await expectStatus('/backend/api/overview', 200, { headers: { authorization: authHeader() } })).json();
if (overview.stats.articles < 2900 || overview.stats.redirects < 10000) throw new Error(`bad overview stats ${JSON.stringify(overview.stats)}`);
const search = await (await expectStatus('/backend/api/search?q=Peter&limit=5', 200, { headers: { authorization: authHeader() } })).json();
if (!search.items.length || !search.items[0].title) throw new Error('search did not return article records');
const files = await (await expectStatus('/backend/api/files?prefix=articles/&limit=5', 200, { headers: { authorization: authHeader() } })).json();
if (!files.objects.length || files.objects.some((object) => object.key.startsWith('_backend/'))) throw new Error('files endpoint failed or leaked private backend key');
const directPrivate = await expectStatus('/backend/api/object?key=_backend/index.json', 400, { headers: { authorization: authHeader() } });
if (!(await directPrivate.text()).includes('non-private key')) throw new Error('private object read was not blocked');

console.log(JSON.stringify({ ok: true, checks: ['public route', 'legacy route compatibility', 'rendered legacy link repair', 'full rendered local-file link scan', 'global footer tagline', 'public search api', 'public api cors preflight', 'public articles api', 'public faqs api', 'public bio api', 'newsletter api', 'private index block', 'private newsletter block', 'basic auth', 'backend shell', 'overview api', 'search api', 'files api', 'private object block'] }, null, 2));
