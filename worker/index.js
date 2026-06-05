const REDIRECTS_KEY = '_redirects';

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

function extensionFor(key) {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? '' : key.slice(dot).toLowerCase();
}

function contentTypeFor(key) {
  return CONTENT_TYPES[extensionFor(key)] || 'application/octet-stream';
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

async function serveObject(key, object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', contentTypeFor(key));
  headers.set('cache-control', cacheControlFor(key));
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
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
