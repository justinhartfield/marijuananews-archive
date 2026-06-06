const REDIRECTS_KEY = '_redirects';
const BACKEND_PREFIX = '/backend';
const BACKEND_API_PREFIX = '/backend/api';
const PUBLIC_API_PREFIX = '/api';
const BACKEND_INDEX_KEY = '_backend/index.json';
const BACKEND_DEFAULT_USER = 'admin';
const PRIVATE_OBJECT_PREFIXES = ['_backend/', '_private/', 'newsletter-signups/'];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.php': 'text/html; charset=utf-8'
};

let redirectCachePromise;
let backendIndexCachePromise;

function extensionFor(key) {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? '' : key.slice(dot).toLowerCase();
}

function contentTypeFor(key) {
  return CONTENT_TYPES[extensionFor(key)] || 'application/octet-stream';
}

function isPrivateObjectKey(key) {
  const clean = String(key || '').replace(/^\/+/, '');
  return PRIVATE_OBJECT_PREFIXES.some((prefix) => clean === prefix.slice(0, -1) || clean.startsWith(prefix));
}

function cacheControlFor(key) {
  const ext = extensionFor(key);
  if (ext === '.html' || ext === '.xml' || ext === '.txt' || ext === '.json' || key === REDIRECTS_KEY) {
    return 'public, max-age=300';
  }
  return 'public, max-age=31536000, immutable';
}

function safePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function candidateKeys(pathname) {
  const clean = safePathname(pathname).replace(/^\/+/, '');
  if (!clean) return ['index.html'];

  const keys = [];
  keys.push(clean);

  if (clean.endsWith('/')) {
    keys.push(`${clean}index.html`);
  } else if (!extensionFor(clean)) {
    keys.push(`${clean}/index.html`);
  }

  return [...new Set(keys)];
}

async function firstExistingObject(env, pathname) {
  for (const key of candidateKeys(pathname)) {
    if (isPrivateObjectKey(key)) continue;
    const object = await env.ARCHIVE_ASSETS.get(key);
    if (object) return { key, object };
  }
  return null;
}

function normalizeRedirectPath(path) {
  if (!path) return '/';
  const noQuery = path.split('?')[0].split('#')[0] || '/';
  const withSlash = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

async function getRedirectMap(env) {
  if (!redirectCachePromise) {
    redirectCachePromise = (async () => {
      const object = await env.ARCHIVE_ASSETS.get(REDIRECTS_KEY);
      if (!object) return new Map();
      const text = await object.text();
      const map = new Map();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [from, to, statusToken] = trimmed.split(/\s+/);
        if (!from || !to) continue;
        const status = Number(statusToken) || 301;
        map.set(normalizeRedirectPath(from), { to, status });
      }
      return map;
    })();
  }
  return redirectCachePromise;
}

function redirectResponse(url, redirect) {
  const target = redirect.to.startsWith('http://') || redirect.to.startsWith('https://')
    ? new URL(redirect.to)
    : new URL(redirect.to, url.origin);
  if (url.search && !target.search) target.search = url.search;
  return Response.redirect(target.toString(), redirect.status);
}

function legacyArticleRedirect(url) {
  const match = url.pathname.match(/^\/articles\/([^/]+)\/legacy\/?$/i);
  if (!match) return null;
  const target = new URL(`/articles/${match[1]}/`, url.origin);
  if (url.search) target.search = url.search;
  return Response.redirect(target.toString(), 301);
}

async function serveObject(key, object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', contentTypeFor(key));
  headers.set('cache-control', cacheControlFor(key));
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

function noStoreHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, no-cache, must-revalidate, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow, noarchive'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: noStoreHeaders('application/json; charset=utf-8')
  });
}

function publicApiHeaders(contentType = 'application/json; charset=utf-8', status = 200) {
  return {
    'content-type': contentType,
    'cache-control': status === 200 ? 'public, max-age=300' : 'public, max-age=60',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-content-type-options': 'nosniff'
  };
}

function publicJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: publicApiHeaders('application/json; charset=utf-8', status)
  });
}

function publicOptionsResponse() {
  return new Response(null, { status: 204, headers: publicApiHeaders('text/plain; charset=utf-8', 200) });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      ...noStoreHeaders('text/html; charset=utf-8'),
      'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

function unauthorizedBackendResponse() {
  return new Response('Authentication required for MarijuanaNews backend.', {
    status: 401,
    headers: {
      ...noStoreHeaders('text/plain; charset=utf-8'),
      'www-authenticate': 'Basic realm="MarijuanaNews Backend", charset="UTF-8"'
    }
  });
}

function forbiddenBackendResponse(message = 'Backend password is not configured.') {
  return jsonResponse({ ok: false, error: message }, 403);
}

function parseBasicAuth(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(String(a || ''));
  const right = encoder.encode(String(b || ''));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

function isBackendAuthorized(request, env) {
  const expectedPassword = env.BACKEND_PASSWORD;
  if (!expectedPassword) return { ok: false, configured: false };
  const credentials = parseBasicAuth(request);
  if (!credentials) return { ok: false, configured: true };
  const expectedUser = env.BACKEND_USER || BACKEND_DEFAULT_USER;
  const userOk = timingSafeEqual(credentials.username, expectedUser);
  const passwordOk = timingSafeEqual(credentials.password, expectedPassword);
  return { ok: userOk && passwordOk, configured: true };
}

async function requireBackendAuth(request, env) {
  const auth = isBackendAuthorized(request, env);
  if (auth.ok) return null;
  if (!auth.configured) return forbiddenBackendResponse();
  return unauthorizedBackendResponse();
}

async function getBackendIndex(env) {
  if (!backendIndexCachePromise) {
    backendIndexCachePromise = (async () => {
      const object = await env.ARCHIVE_ASSETS.get(BACKEND_INDEX_KEY);
      if (!object) throw new Error(`${BACKEND_INDEX_KEY} is missing from R2`);
      return JSON.parse(await object.text());
    })();
  }
  return backendIndexCachePromise;
}

function boundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function paginate(items, url, maxLimit = 100) {
  const limit = boundedInt(url.searchParams.get('limit'), 25, maxLimit);
  const offset = boundedInt(url.searchParams.get('offset'), 0, 250000);
  return {
    total: items.length,
    limit,
    offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    items: items.slice(offset, offset + limit)
  };
}

function includesQuery(record, q, fields) {
  if (!q) return true;
  const haystack = fields.map((field) => {
    const value = record[field];
    return Array.isArray(value) ? value.join(' ') : String(value || '');
  }).join(' ').toLowerCase();
  return haystack.includes(q);
}

function filterArticles(index, url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const category = (url.searchParams.get('category') || '').trim().toLowerCase();
  const topic = (url.searchParams.get('topic') || '').trim().toLowerCase();
  const year = (url.searchParams.get('year') || '').trim();
  return index.articles.filter((article) => {
    if (q && !includesQuery(article, q, ['title', 'description', 'excerpt', 'category', 'topic', 'source', 'keywords', 'year'])) return false;
    if (category && article.categorySlug !== category && String(article.category || '').toLowerCase() !== category) return false;
    if (topic && article.topicSlug !== topic && String(article.topic || '').toLowerCase() !== topic) return false;
    if (year && String(article.year) !== year) return false;
    return true;
  });
}

function filterList(items, url, fields) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => includesQuery(item, q, fields));
}

function overviewPayload(index) {
  return {
    ok: true,
    generatedAt: index.generatedAt,
    site: index.site,
    stats: index.stats,
    topCategories: index.facets.categories.slice(0, 12),
    topTopics: index.facets.topics.slice(0, 12),
    topYears: index.facets.years.slice(0, 20),
    topExternalHosts: index.facets.externalHosts.slice(0, 12),
    topAssetHosts: index.facets.assetHosts.slice(0, 12),
    latestArticles: index.articles.slice(0, 12),
    auditHighlights: {
      sourceSql: index.audit?.source_sql,
      privateTablesIntentionallyExcluded: index.audit?.private_tables_intentionally_excluded,
      sanitization: index.audit?.sanitization,
      assets: index.audit?.assets,
      externalLinks: index.audit?.external_links,
      notes: index.audit?.notes
    }
  };
}

function safeR2Key(raw) {
  const key = String(raw || '').replace(/^\/+/, '');
  if (!key || key.includes('..') || isPrivateObjectKey(key)) return '';
  return key;
}

async function handleFilesApi(env, url) {
  if (typeof env.ARCHIVE_ASSETS.list !== 'function') {
    return jsonResponse({ ok: false, error: 'R2 list() is unavailable in this runtime.' }, 501);
  }
  const prefix = safeR2Key(url.searchParams.get('prefix') || '');
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = boundedInt(url.searchParams.get('limit'), 100, 1000);
  const listed = await env.ARCHIVE_ASSETS.list({ prefix, cursor, limit });
  return jsonResponse({
    ok: true,
    prefix,
    cursor: listed.cursor || null,
    truncated: Boolean(listed.truncated),
    delimitedPrefixes: listed.delimitedPrefixes || [],
    objects: (listed.objects || []).filter((object) => !isPrivateObjectKey(object.key)).map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded,
      etag: object.etag,
      httpEtag: object.httpEtag,
      contentType: object.httpMetadata?.contentType || contentTypeFor(object.key)
    }))
  });
}

async function handleObjectApi(env, url) {
  const key = safeR2Key(url.searchParams.get('key'));
  if (!key) return jsonResponse({ ok: false, error: 'A non-private key query parameter is required.' }, 400);
  const object = await env.ARCHIVE_ASSETS.get(key);
  if (!object) return jsonResponse({ ok: false, error: 'Object not found.', key }, 404);
  const type = object.httpMetadata?.contentType || contentTypeFor(key);
  const payload = {
    ok: true,
    key,
    size: object.size || null,
    uploaded: object.uploaded || null,
    etag: object.etag || null,
    httpEtag: object.httpEtag || null,
    contentType: type,
    preview: null
  };
  if (/^(text\/|application\/(json|xml))/.test(type) && (!object.size || object.size < 150000)) {
    payload.preview = (await object.text()).slice(0, 12000);
  }
  return jsonResponse(payload);
}

function publicArticle(article) {
  return {
    id: article.id,
    slug: article.slug,
    path: article.path,
    title: article.title,
    description: article.description,
    excerpt: article.excerpt,
    category: article.category,
    categorySlug: article.categorySlug,
    topic: article.topic,
    topicSlug: article.topicSlug,
    publicationDate: article.publicationDate,
    year: article.year,
    source: article.source,
    sourceUrl: article.sourceUrl,
    readTime: article.readTime,
    image: article.image,
    keywords: article.keywords,
    language: article.language,
    wordCount: article.wordCount
  };
}

function publicFaq(faq) {
  return {
    id: faq.id,
    question: faq.question,
    category: faq.category,
    excerpt: faq.excerpt
  };
}

function publicOverview(index) {
  return {
    ok: true,
    generatedAt: index.generatedAt,
    site: {
      name: index.site?.name,
      publicUrl: index.site?.publicUrl,
      source: index.site?.source
    },
    stats: index.stats,
    topCategories: index.facets.categories.slice(0, 12),
    topTopics: index.facets.topics.slice(0, 12),
    topYears: index.facets.years.slice(0, 20),
    latestArticles: index.articles.slice(0, 12).map(publicArticle)
  };
}

async function parseNewsletterBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    return Object.fromEntries(params.entries());
  }
  if (type.includes('multipart/form-data') && typeof request.formData === 'function') {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  const text = await request.text();
  return { email: text };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function sha256Hex(value) {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function handleNewsletterApi(request, env) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return publicJsonResponse({ ok: true, endpoint: '/api/newsletter', accepts: ['POST'], fields: ['email'] });
  }
  if (request.method !== 'POST') {
    return publicJsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }
  if (!env.ARCHIVE_ASSETS || typeof env.ARCHIVE_ASSETS.put !== 'function') {
    return publicJsonResponse({ ok: false, error: 'Newsletter storage is not configured.' }, 503);
  }

  const body = await parseNewsletterBody(request);
  const email = normalizeEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return publicJsonResponse({ ok: false, error: 'A valid email address is required.' }, 400);
  }

  const createdAt = new Date().toISOString();
  const hash = await sha256Hex(email);
  const key = `_private/newsletter-signups/${createdAt.slice(0, 10)}/${hash}.json`;
  const payload = {
    email,
    emailHash: hash,
    createdAt,
    source: String(body.source || 'homepage').slice(0, 80),
    userAgent: String(request.headers.get('user-agent') || '').slice(0, 300),
    referrer: String(request.headers.get('referer') || '').slice(0, 500)
  };

  await env.ARCHIVE_ASSETS.put(key, JSON.stringify(payload, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  return publicJsonResponse({ ok: true, subscribed: true });
}

async function handlePublicApi(request, env, url) {
  if (request.method === 'OPTIONS') return publicOptionsResponse();
  const path = url.pathname.slice(PUBLIC_API_PREFIX.length) || '/overview';
  if (path === '/newsletter') return handleNewsletterApi(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return publicJsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  const index = await getBackendIndex(env);

  if (path === '/overview' || path === '/') return publicJsonResponse(publicOverview(index));
  if (path === '/search' || path === '/articles') {
    const page = paginate(filterArticles(index, url).map(publicArticle), url, 100);
    return publicJsonResponse({ ok: true, ...page });
  }
  if (path === '/article') {
    const slug = (url.searchParams.get('slug') || '').trim();
    const article = index.articles.find((item) => item.slug === slug);
    return article ? publicJsonResponse({ ok: true, article: publicArticle(article) }) : publicJsonResponse({ ok: false, error: 'Article not found.', slug }, 404);
  }
  if (path === '/faqs' || path === '/faq') {
    const page = paginate(filterList(index.faqs, url, ['question', 'category', 'excerpt']).map(publicFaq), url, 100);
    return publicJsonResponse({ ok: true, ...page });
  }
  if (path === '/bio') return publicJsonResponse({ ok: true, bio: index.site?.bio || null });
  if (path === '/facets') return publicJsonResponse({ ok: true, facets: index.facets });

  return publicJsonResponse({ ok: false, error: 'Unknown public endpoint.', path }, 404);
}

async function handleBackendApi(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  const index = await getBackendIndex(env);
  const path = url.pathname.slice(BACKEND_API_PREFIX.length) || '/overview';

  if (path === '/overview') return jsonResponse(overviewPayload(index));
  if (path === '/search' || path === '/articles') return jsonResponse({ ok: true, ...paginate(filterArticles(index, url), url, 200) });
  if (path === '/article') {
    const slug = (url.searchParams.get('slug') || '').trim();
    const article = index.articles.find((item) => item.slug === slug);
    return article ? jsonResponse({ ok: true, article }) : jsonResponse({ ok: false, error: 'Article not found.', slug }, 404);
  }
  if (path === '/facets') return jsonResponse({ ok: true, facets: index.facets });
  if (path === '/faqs') return jsonResponse({ ok: true, ...paginate(filterList(index.faqs, url, ['question', 'category', 'excerpt']), url, 200) });
  if (path === '/redirects') return jsonResponse({ ok: true, ...paginate(filterList(index.redirects, url, ['from', 'to', 'status']), url, 300) });
  if (path === '/assets') return jsonResponse({ ok: true, ...paginate(filterList(index.assets, url, ['url', 'host', 'suggestedLocalPath', 'mirroredPath', 'contentTypes', 'filenames']), url, 300) });
  if (path === '/external-links') return jsonResponse({ ok: true, ...paginate(filterList(index.externalLinks, url, ['url', 'host', 'articleSlugs']), url, 300) });
  if (path === '/audit') return jsonResponse({ ok: true, audit: index.audit });
  if (path === '/files') return handleFilesApi(env, url);
  if (path === '/object') return handleObjectApi(env, url);

  return jsonResponse({ ok: false, error: 'Unknown backend endpoint.', path }, 404);
}

async function handleBackend(request, env, url) {
  const authResponse = await requireBackendAuth(request, env);
  if (authResponse) return authResponse;

  if (url.pathname === '/backend') return Response.redirect(`${url.origin}/backend/`, 302);
  if (url.pathname === '/backend/' || url.pathname === '/backend/index.html') return htmlResponse(backendHtml());
  if (url.pathname.startsWith(BACKEND_API_PREFIX)) return handleBackendApi(request, env, url);
  return jsonResponse({ ok: false, error: 'Not Found' }, 404);
}

function backendHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>MarijuanaNews Backend</title>
  <style>
    :root { color-scheme: dark; --bg:#090b0a; --panel:#121713; --panel2:#192018; --line:#2d382d; --text:#eff5e8; --muted:#a8b6a4; --accent:#9ee66f; --gold:#e3c15d; --red:#f37b65; }
    * { box-sizing: border-box; }
    body { margin:0; background: radial-gradient(circle at top left, #19301d, var(--bg) 42rem); color:var(--text); font:14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding:28px clamp(18px, 4vw, 44px); border-bottom:1px solid var(--line); background:rgba(9,11,10,.86); position:sticky; top:0; z-index:10; backdrop-filter: blur(12px); }
    h1 { margin:0; font-size:clamp(26px, 4vw, 46px); letter-spacing:-.04em; }
    h2 { margin:0 0 14px; font-size:20px; }
    h3 { margin:0 0 10px; font-size:15px; color:var(--accent); }
    .sub { color:var(--muted); max-width:980px; margin-top:8px; }
    main { padding:28px clamp(18px, 4vw, 44px) 60px; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:22px; }
    button, input, select { font:inherit; }
    .tab, .btn { border:1px solid var(--line); color:var(--text); background:var(--panel); border-radius:999px; padding:9px 13px; cursor:pointer; }
    .tab.active, .btn.primary { border-color:var(--accent); background:#1d351d; color:#eaffdf; }
    .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; }
    .card, .panel { background:linear-gradient(180deg, var(--panel), #0f130f); border:1px solid var(--line); border-radius:18px; padding:16px; box-shadow:0 14px 32px rgba(0,0,0,.2); }
    .metric { font-size:30px; font-weight:800; letter-spacing:-.04em; }
    .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .layout { display:grid; grid-template-columns: 1.2fr .8fr; gap:18px; align-items:start; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin:0 0 14px; }
    input, select { background:#090d09; border:1px solid var(--line); color:var(--text); border-radius:12px; padding:10px 12px; min-width:180px; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; border-bottom:1px solid var(--line); padding:9px 8px; vertical-align:top; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    a { color:var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
    code, pre { background:#080b08; border:1px solid var(--line); border-radius:12px; }
    code { padding:2px 5px; }
    pre { padding:14px; overflow:auto; max-height:520px; white-space:pre-wrap; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 7px; margin:2px 3px 2px 0; color:var(--muted); }
    .muted { color:var(--muted); }
    .warn { color:var(--gold); }
    .danger { color:var(--red); }
    .hidden { display:none; }
    @media (max-width: 980px) { .grid, .layout { grid-template-columns:1fr; } header { position:static; } }
  </style>
</head>
<body>
  <header>
    <h1>MarijuanaNews Backend</h1>
    <div class="sub">Password-protected control center for the live Marijuana News publication: inventory, search, routing, assets, external links, R2 objects, and publication audit.</div>
  </header>
  <main>
    <nav class="tabs" id="tabs"></nav>
    <section id="view"></section>
  </main>
  <script>
    const tabs = ['overview','search','articles','redirects','assets','external-links','files','audit'];
    const state = { active: 'overview', overview: null, facets: null };
    const view = document.getElementById('view');
    const tabsEl = document.getElementById('tabs');

    function el(tag, attrs = {}, children = []) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else node.setAttribute(key, value);
      }
      for (const child of children) node.append(child && child.nodeType ? child : document.createTextNode(String(child ?? '')));
      return node;
    }

    async function api(path) {
      const response = await fetch(window.location.origin + '/backend/api' + path, { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }

    function renderTabs() {
      tabsEl.textContent = '';
      for (const name of tabs) {
        const button = el('button', { class: 'tab' + (state.active === name ? ' active' : ''), text: name.replace('-', ' ') });
        button.addEventListener('click', () => { state.active = name; renderTabs(); render(); });
        tabsEl.append(button);
      }
    }

    function card(label, value, note = '') {
      return el('div', { class: 'card' }, [el('div', { class: 'label', text: label }), el('div', { class: 'metric', text: value }), el('div', { class: 'muted', text: note })]);
    }

    function table(headers, rows) {
      const thead = el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]);
      const tbody = el('tbody');
      for (const row of rows) tbody.append(el('tr', {}, row.map((cell) => el('td', {}, [cell && cell.nodeType ? cell : String(cell ?? '')]))));
      return el('table', {}, [thead, tbody]);
    }

    function link(href, text) {
      return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
    }

    async function ensureOverview() {
      if (!state.overview) state.overview = await api('/overview');
      if (!state.facets) state.facets = await api('/facets');
    }

    async function renderOverview() {
      await ensureOverview();
      const o = state.overview;
      view.textContent = '';
      view.append(el('div', { class: 'grid' }, [
        card('Articles', o.stats.articles, o.stats.earliestPublicationDate + ' to ' + o.stats.latestPublicationDate),
        card('Words', o.stats.totalWords.toLocaleString(), 'avg read ' + o.stats.averageReadTime + ' min'),
        card('Redirects', o.stats.redirects.toLocaleString(), 'legacy URL preservation'),
        card('Assets', o.stats.assetReferences.toLocaleString(), o.stats.mirroredAssetReferences.toLocaleString() + ' mirrored references'),
        card('External links', o.stats.externalLinks.toLocaleString(), o.stats.externalHosts + ' top hosts tracked'),
        card('FAQs', o.stats.faqs, 'reader and support content'),
        card('Topics', o.stats.topics, o.stats.categories + ' categories'),
        card('Images', o.stats.articlesWithImages.toLocaleString(), 'articles with image refs')
      ]));
      view.append(el('div', { class: 'layout', style: 'margin-top:18px' }, [
        el('section', { class: 'panel' }, [el('h2', { text: 'Latest articles' }), table(['Title','Category','Date'], o.latestArticles.map((a) => [link(a.path, a.title), a.category, a.publicationDate || 'Undated']))]),
        el('section', { class: 'panel' }, [el('h2', { text: 'Audit highlights' }), el('pre', { text: JSON.stringify(o.auditHighlights, null, 2) })])
      ]));
      view.append(el('div', { class: 'layout', style: 'margin-top:18px' }, [
        facetPanel('Top categories', o.topCategories),
        facetPanel('Top years', o.topYears)
      ]));
    }

    function facetPanel(title, items) {
      return el('section', { class: 'panel' }, [el('h2', { text: title }), ...items.map((item) => el('div', {}, [el('span', { class: 'pill', text: item.count }), ' ', item.name]))]);
    }

    async function renderSearch() {
      await ensureOverview();
      view.textContent = '';
      const q = el('input', { placeholder: 'Search title, excerpt, keyword, topic…' });
      const category = el('select');
      category.append(el('option', { value: '', text: 'All categories' }));
      for (const item of state.facets.facets.categories) category.append(el('option', { value: item.slug, text: item.name + ' (' + item.count + ')' }));
      const year = el('select');
      year.append(el('option', { value: '', text: 'All years' }));
      for (const item of state.facets.facets.years) year.append(el('option', { value: item.name, text: item.name + ' (' + item.count + ')' }));
      const results = el('div');
      async function run() {
        results.textContent = 'Searching…';
        const params = new URLSearchParams({ q: q.value, category: category.value, year: year.value, limit: '80' });
        const data = await api('/search?' + params.toString());
        results.textContent = '';
        results.append(el('p', { class: 'muted', text: data.total + ' matches' }));
        results.append(table(['Title','Meta','Excerpt'], data.items.map((a) => [link(a.path, a.title), a.category + ' · ' + (a.year || 'Undated') + ' · ' + (a.topic || 'No topic'), a.excerpt])));
      }
      const button = el('button', { class: 'btn primary', text: 'Search' });
      button.addEventListener('click', run);
      q.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
      view.append(el('section', { class: 'panel' }, [el('h2', { text: 'Article search' }), el('div', { class: 'toolbar' }, [q, category, year, button]), results]));
      await run();
    }

    async function renderArticles() {
      const data = await api('/articles?limit=100');
      view.textContent = '';
      view.append(el('section', { class: 'panel' }, [el('h2', { text: 'Newest articles' }), el('p', { class: 'muted', text: data.total + ' indexed article records' }), table(['Title','Category','Topic','Words','Date'], data.items.map((a) => [link(a.path, a.title), a.category, a.topic || '', a.wordCount, a.publicationDate || 'Undated']))]));
    }

    async function renderGeneric(kind, endpoint, headers, row) {
      view.textContent = '';
      const q = el('input', { placeholder: 'Filter ' + kind + '…' });
      const results = el('div');
      async function run() {
        results.textContent = 'Loading…';
        const data = await api(endpoint + '?limit=150&q=' + encodeURIComponent(q.value));
        results.textContent = '';
        results.append(el('p', { class: 'muted', text: data.total + ' records' }));
        results.append(table(headers, data.items.map(row)));
      }
      const button = el('button', { class: 'btn primary', text: 'Filter' });
      button.addEventListener('click', run);
      q.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(); });
      view.append(el('section', { class: 'panel' }, [el('h2', { text: kind }), el('div', { class: 'toolbar' }, [q, button]), results]));
      await run();
    }

    async function renderFiles() {
      view.textContent = '';
      const prefix = el('input', { placeholder: 'R2 prefix, e.g. articles/' });
      const results = el('div');
      async function run() {
        results.textContent = 'Listing…';
        const data = await api('/files?limit=200&prefix=' + encodeURIComponent(prefix.value));
        results.textContent = '';
        results.append(el('p', { class: 'muted', text: data.objects.length + ' returned' + (data.truncated ? ' · more available' : '') }));
        results.append(table(['Key','Size','Type'], data.objects.map((o) => [o.key, (o.size || 0).toLocaleString(), o.contentType || ''])));
      }
      const button = el('button', { class: 'btn primary', text: 'List files' });
      button.addEventListener('click', run);
      view.append(el('section', { class: 'panel' }, [el('h2', { text: 'R2 object inventory' }), el('div', { class: 'toolbar' }, [prefix, button]), results]));
      await run();
    }

    async function renderAudit() {
      const data = await api('/audit');
      view.textContent = '';
      view.append(el('section', { class: 'panel' }, [el('h2', { text: 'Migration audit' }), el('pre', { text: JSON.stringify(data.audit, null, 2) })]));
    }

    async function render() {
      try {
        if (state.active === 'overview') return renderOverview();
        if (state.active === 'search') return renderSearch();
        if (state.active === 'articles') return renderArticles();
        if (state.active === 'redirects') return renderGeneric('Redirects', '/redirects', ['From','To','Status'], (r) => [r.from, r.to, r.status]);
        if (state.active === 'assets') return renderGeneric('Asset references', '/assets', ['URL','Host','Mirrored path'], (a) => [a.url, a.host, a.mirroredPath || a.suggestedLocalPath || '']);
        if (state.active === 'external-links') return renderGeneric('External links', '/external-links', ['URL','Host','Articles'], (x) => [x.url, x.host, x.articleCount]);
        if (state.active === 'files') return renderFiles();
        if (state.active === 'audit') return renderAudit();
      } catch (error) {
        view.textContent = '';
        view.append(el('section', { class: 'panel' }, [el('h2', { class: 'danger', text: 'Backend error' }), el('pre', { text: String(error && error.message ? error.message : error) })]));
      }
    }

    renderTabs();
    render();
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === PUBLIC_API_PREFIX || url.pathname.startsWith(`${PUBLIC_API_PREFIX}/`)) {
      return handlePublicApi(request, env, url);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    if (url.pathname === BACKEND_PREFIX || url.pathname.startsWith(`${BACKEND_PREFIX}/`)) {
      return handleBackend(request, env, url);
    }

    if (isPrivateObjectKey(url.pathname)) {
      return new Response('Not Found', { status: 404, headers: noStoreHeaders('text/plain; charset=utf-8') });
    }

    const legacyRedirect = legacyArticleRedirect(url);
    if (legacyRedirect) return legacyRedirect;

    const hit = await firstExistingObject(env, url.pathname);
    if (hit) return serveObject(hit.key, hit.object);

    const redirects = await getRedirectMap(env);
    const redirect = redirects.get(normalizeRedirectPath(url.pathname));
    if (redirect) return redirectResponse(url, redirect);

    const notFound = await env.ARCHIVE_ASSETS.get('404.html');
    if (notFound) return new Response(notFound.body, {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff'
      }
    });

    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff'
      }
    });
  }
};
