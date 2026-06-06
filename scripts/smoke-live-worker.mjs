const base = (process.env.SITE_URL || process.argv[2] || 'https://marijuananews.com').replace(/\/$/, '');
const expectedTitle = 'Marijuana News';

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(path, init) {
  const response = await fetch(`${base}${path}`, {
    redirect: 'follow',
    headers: { 'user-agent': userAgent, 'accept': 'text/html,application/json;q=0.9,*/*;q=0.8', ...(init?.headers || {}) },
    ...init
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} expected 2xx, got ${response.status}: ${text.slice(0, 160)}`);
  return { response, text };
}

async function fetchJson(path, init) {
  const { response, text } = await fetchText(path, init);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error(`${path} expected JSON, got ${type}`);
  return JSON.parse(text);
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const home = await fetchText('/');
assert(home.text.includes(expectedTitle), 'home page missing Marijuana News title');
assert(home.text.includes('Daily cannabis news'), 'home page missing live publication framing');
assert(home.text.includes('Subscribe to Newsletter'), 'home page missing newsletter signup');
assert(home.text.includes('class="tag-cloud"'), 'home page missing topic tag cloud');
assert(home.text.includes('Richard Cowan'), 'home page missing Richard Cowan sidebar');
assert(!home.text.includes('_backend/index.json'), 'home page leaked backend index path');

const problemArticlePath = '/articles/the-very-sad-case-of-the-wall-street-journal-editorial-page-the-betrayal-of-their-own-principles-lying-to-their-readers-about-the-netherlands-and-the-benefits-of-freedom/legacy';
const problemArticle = await fetchText(problemArticlePath);
assert(problemArticle.text.includes('/articles/legalize-marijuana-and-improve-high-school-academic-performance-holland-ranks-first-the-us-very-low/'), 'problem article missing repaired bottom internal link');
assert(!problemArticle.text.includes('file:///C:/Program'), 'problem article still contains broken FrontPage file link');

for (const path of ['/articles/', '/chronological-index/', '/search/', '/memory-hole/', '/rss.xml', '/sitemap.xml']) {
  await fetchText(path);
}

const overview = await fetchJson('/api/overview');
assert(overview.ok === true, 'overview API not ok', overview);
assert(overview.stats?.articles >= 2900, 'overview API article count too low', overview.stats || {});
assert(overview.stats?.redirects >= 10000, 'overview API redirect count too low', overview.stats || {});

const newsletter = await fetchJson('/api/newsletter');
assert(newsletter.ok === true && newsletter.endpoint === '/api/newsletter', 'newsletter API metadata not ok', newsletter);

const search = await fetchJson('/api/search?q=Peter&limit=5');
assert(search.ok === true, 'search API not ok', search);
assert(search.items?.length > 0, 'search API returned no items', search);
assert(search.items.every((item) => item.title && item.path), 'search items missing public title/path', search.items?.[0] || {});
assert(search.items.every((item) => item.migration === undefined && item.contentHtml === undefined), 'search leaked backend/private fields', search.items?.[0] || {});

const articles = await fetchJson('/api/articles?limit=3');
assert(articles.items?.length === 3, 'articles API wrong limit shape', articles);

const preflight = await fetch(`${base}/api/search`, {
  method: 'OPTIONS',
  headers: { origin: 'https://example.org', 'access-control-request-method': 'GET', 'user-agent': userAgent, 'accept': '*/*' }
});
assert(preflight.status === 204, 'public API preflight failed', { status: preflight.status });
assert(preflight.headers.get('access-control-allow-origin') === '*', 'public API preflight missing wildcard CORS');

const privateIndex = await fetch(`${base}/_backend/index.json`, { headers: { 'user-agent': userAgent, 'accept': 'text/plain,*/*;q=0.8' } });
assert(privateIndex.status === 404, 'private backend index should not be public', { status: privateIndex.status });

console.log(JSON.stringify({
  ok: true,
  base,
  checks: ['home', 'legacy route compatibility', 'rendered legacy link repair', 'rss', 'sitemap', 'public overview api', 'public search api', 'public articles api', 'public CORS preflight', 'private backend block'],
  stats: overview.stats,
  firstResult: search.items[0]?.title
}, null, 2));
