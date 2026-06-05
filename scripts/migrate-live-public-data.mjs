import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'src/data/public-content');
const articlesDir = path.join(dataDir, 'articles');
const publicDir = path.join(root, 'public');
const cacheDir = process.env.LIVE_MIGRATION_CACHE_DIR
  ? path.resolve(root, process.env.LIVE_MIGRATION_CACHE_DIR)
  : null;
const liveBase = 'https://www.marijuananews.com';
const canonicalBase = 'https://marijuananews.com';
const delayMs = Number(process.env.LIVE_MIGRATION_DELAY_MS || 650);
const generatedAt = process.env.LIVE_MIGRATION_FETCHED_AT || new Date().toISOString();

const requestHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${liveBase}/`,
  'Origin': liveBase,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pythonFetch(url, accept = requestHeaders.Accept) {
  const code = String.raw`
import sys, urllib.request
url=sys.argv[1]
accept=sys.argv[2]
headers={
  'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':accept,
  'Accept-Language':'en-US,en;q=0.9',
  'Referer':'https://www.marijuananews.com/',
  'Origin':'https://www.marijuananews.com',
  'Sec-Fetch-Dest':'empty',
  'Sec-Fetch-Mode':'cors',
  'Sec-Fetch-Site':'same-origin',
}
req=urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req, timeout=180) as response:
  sys.stdout.buffer.write(response.read())
`;
  const result = spawnSync('python3', ['-c', code, url, accept], { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8') || '';
    throw new Error(`python fetch failed for ${url}: ${stderr.slice(0, 500)}`);
  }
  return result.stdout;
}

async function fetchText(url, accept = requestHeaders.Accept) {
  try {
    const res = await fetch(url, { headers: { ...requestHeaders, Accept: accept } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET ${url} failed ${res.status}: ${body.slice(0, 220)}`);
    }
    return await res.text();
  } catch (error) {
    console.warn(`Node fetch failed for ${url}; retrying with Python urllib fallback (${error.message})`);
    return pythonFetch(url, accept).toString('utf8');
  }
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url, 'application/json, text/plain, */*'));
}

async function cacheText(name) {
  if (!cacheDir) return null;
  try {
    return await readFile(path.join(cacheDir, name), 'utf8');
  } catch {
    return null;
  }
}

async function cachedText(name, url, accept = requestHeaders.Accept) {
  const cached = await cacheText(name);
  if (cached != null) {
    console.log(`Using cached live response ${name}`);
    return cached;
  }
  return await fetchText(url, accept);
}

async function cachedJson(name, url) {
  return JSON.parse(await cachedText(name, url, 'application/json, text/plain, */*'));
}

async function optionalCachedText(name, url, accept = requestHeaders.Accept) {
  try {
    return await cachedText(name, url, accept);
  } catch (error) {
    console.warn(`Skipping optional live fetch ${url}: ${error.message}`);
    return '';
  }
}

async function fetchBinaryToFile(url, outFile) {
  let bytes;
  try {
    const res = await fetch(url, { headers: { ...requestHeaders, Accept: '*/*' } });
    if (!res.ok) throw new Error(`GET ${url} failed ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    console.warn(`Node fetch failed for binary ${url}; retrying with Python urllib fallback (${error.message})`);
    bytes = pythonFetch(url, '*/*');
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, bytes);
  return bytes.length;
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(text, maxLength = 500) {
  const normalized = cleanText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}`;
}

function isSafeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('#')) return true;
  if (/^(https?:|mailto:|tel:|\/)/i.test(value)) return true;
  return false;
}

function normalizeProtocolUrl(raw) {
  const value = cleanText(raw);
  if (!value || /^data:/i.test(value)) return '';
  return value.startsWith('//') ? `https:${value}` : value;
}

function isPublicImageUrl(raw) {
  const value = normalizeProtocolUrl(raw);
  return Boolean(value && (/^https?:\/\//i.test(value) || value.startsWith('/')));
}

function publicImageUrl(raw) {
  const value = normalizeProtocolUrl(raw);
  return isPublicImageUrl(value) ? value : '';
}

function httpAssetUrl(raw) {
  const value = normalizeProtocolUrl(raw);
  return /^https?:\/\//i.test(value) ? value : '';
}

function safeThumbnails(thumbnails) {
  if (!thumbnails || typeof thumbnails !== 'object') return null;
  const entries = Object.entries(thumbnails)
    .map(([key, value]) => [key, publicImageUrl(value)])
    .filter(([, value]) => value);
  return entries.length ? Object.fromEntries(entries) : null;
}

function parseAttributes(rawAttrs) {
  const attrs = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(rawAttrs || ''))) {
    attrs.push([match[1].toLowerCase(), match[3] ?? match[4] ?? match[5] ?? '']);
  }
  return attrs;
}

function sanitizeHtml(html) {
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h2', 'h3', 'h4', 'img', 'figure', 'figcaption', 'span', 'div']);
  const voidTags = new Set(['br', 'img']);
  const input = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  return input.replace(/<\/?[^>]+>/g, (token) => {
    const close = /^<\s*\//.test(token);
    const nameMatch = token.match(/^<\s*\/?\s*([a-zA-Z0-9:-]+)/);
    if (!nameMatch) return escapeHtml(token);
    const tag = nameMatch[1].toLowerCase();
    if (!allowed.has(tag)) return '';
    if (close) return voidTags.has(tag) ? '' : `</${tag}>`;
    const rawAttrs = token.replace(/^<\s*[a-zA-Z0-9:-]+\s*/, '').replace(/\/?\s*>$/, '');
    const attrs = [];
    for (const [name, rawValue] of parseAttributes(rawAttrs)) {
      if (name.startsWith('on')) continue;
      const value = cleanText(rawValue);
      if (tag === 'a' && name === 'href' && isSafeUrl(value)) attrs.push(`href="${escapeHtml(value)}"`);
      if (tag === 'a' && name === 'target' && value === '_blank') attrs.push('target="_blank"');
      if (tag === 'a' && name === 'rel') attrs.push('rel="noopener noreferrer nofollow"');
      if (tag === 'img' && name === 'src' && isSafeUrl(value)) attrs.push(`src="${escapeHtml(value)}"`);
      if (tag === 'img' && ['alt', 'title', 'width', 'height'].includes(name)) attrs.push(`${name}="${escapeHtml(value)}"`);
    }
    if (tag === 'a' && attrs.some((attr) => attr.startsWith('href=')) && !attrs.some((attr) => attr.startsWith('rel='))) {
      attrs.push('rel="noopener noreferrer nofollow"');
    }
    if (tag === 'img') {
      if (!attrs.some((attr) => attr.startsWith('src='))) return '';
      attrs.push('loading="lazy"', 'decoding="async"');
    }
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  });
}

function extractMetaTags(html) {
  const tags = {};
  const metaRe = /<meta\s+([^>]+)>/gi;
  let match;
  while ((match = metaRe.exec(html))) {
    const attrs = Object.fromEntries(parseAttributes(match[1]));
    const key = attrs.name || attrs.property;
    if (key && attrs.content) tags[key] = attrs.content;
  }
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  const gaId = html.match(/gtag\/js\?id=([A-Z0-9-]+)/i)?.[1] || '';
  return { title: decodeEntities(title).trim(), meta: tags, googleAnalyticsId: gaId };
}

function extractSitemapRoutes(xml) {
  return Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/gi)).map((m) => m[1].trim());
}

function firstImageFromHtml(html) {
  const match = String(html || '').match(/<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return match ? (match[1] || match[2] || match[3] || '').trim() : '';
}

function bestImage(article) {
  return publicImageUrl(article.image_url)
    || publicImageUrl(article.image_link)
    || publicImageUrl(article.thumbnails?.lg)
    || publicImageUrl(article.thumbnails?.md)
    || publicImageUrl(article.thumbnails?.sm)
    || publicImageUrl(firstImageFromHtml(article.content_html || article.content || ''));
}

function topicFromId(topicId, topics) {
  if (topicId == null) return null;
  const found = topics.find((topic) => String(topic.id) === String(topicId));
  if (!found) return null;
  return found;
}

function publicLiveMetadata(article) {
  const image = bestImage(article);
  const thumbnails = safeThumbnails(article.thumbnails);
  return {
    url: article.url ?? null,
    image_url: publicImageUrl(article.image_url) || image || null,
    thumbnails,
    permanent_slug: article.permanent_slug ?? null,
    status: article.status ?? null,
    archived_at: article.archived_at ?? null,
    archived_by: article.archived_by ?? null,
    topic_id: article.topic_id ?? null,
    last_seo_analysis: article.last_seo_analysis ?? null,
    content_html_length: String(article.content_html || article.content || '').length,
  };
}

async function fetchCurrentArticles() {
  const cachedAll = await cacheText('current_all.json');
  if (cachedAll != null) {
    console.log('Using cached live response current_all.json');
    const parsed = JSON.parse(cachedAll);
    return parsed.articles || parsed.data || [];
  }
  const first = await fetchJson(`${liveBase}/api/articles?type=current&page=1&per_page=25`);
  const totalPages = Number(first.meta?.totalPages || 1);
  const pages = [first];
  for (let page = 2; page <= totalPages; page++) {
    await sleep(delayMs);
    pages.push(await fetchJson(`${liveBase}/api/articles?type=current&page=${page}&per_page=25`));
    console.log(`Fetched live current articles page ${page}/${totalPages}`);
  }
  return pages.flatMap((page) => page.articles || []);
}

function mergeArticle(existing, live, topics) {
  const merged = { ...existing };
  const metadata = publicLiveMetadata(live);
  const image = bestImage(live);
  const liveImageUrl = publicImageUrl(live.image_url);
  const liveThumbnails = safeThumbnails(live.thumbnails);
  let changed = false;
  let invalidImageRemoved = false;

  if (merged.image_link && !isPublicImageUrl(merged.image_link)) {
    merged.image_link = '';
    changed = true;
    invalidImageRemoved = true;
  }
  if (merged.image_url && !isPublicImageUrl(merged.image_url)) {
    merged.image_url = null;
    changed = true;
    invalidImageRemoved = true;
  }
  if (merged.thumbnails && !safeThumbnails(merged.thumbnails)) {
    merged.thumbnails = null;
    changed = true;
    invalidImageRemoved = true;
  }

  for (const key of ['title', 'description', 'category', 'source', 'read_time', 'meta_title', 'meta_description', 'seo_keywords', 'seo_score', 'likes_count', 'is_featured']) {
    if ((merged[key] == null || merged[key] === '') && live[key] != null && live[key] !== '') {
      merged[key] = live[key];
      changed = true;
    }
  }
  if (!merged.image_link && image) {
    merged.image_link = image;
    changed = true;
  }
  if (liveImageUrl && merged.image_url !== liveImageUrl) {
    merged.image_url = liveImageUrl;
    changed = true;
  }
  if (liveThumbnails && JSON.stringify(merged.thumbnails || null) !== JSON.stringify(liveThumbnails)) {
    merged.thumbnails = liveThumbnails;
    changed = true;
  }
  if (live.permanent_slug !== undefined && merged.permanent_slug !== live.permanent_slug) {
    merged.permanent_slug = live.permanent_slug;
    changed = true;
  }
  if (live.status !== undefined && merged.live_status !== live.status) {
    merged.live_status = live.status;
    changed = true;
  }
  if (live.archived_at !== undefined && merged.archived_at !== live.archived_at) {
    merged.archived_at = live.archived_at;
    changed = true;
  }
  if (live.archived_by !== undefined && merged.archived_by !== live.archived_by) {
    merged.archived_by = live.archived_by;
    changed = true;
  }
  if (live.topic_id !== undefined && merged.topic_id !== live.topic_id) {
    merged.topic_id = live.topic_id;
    changed = true;
  }
  if (live.last_seo_analysis !== undefined && JSON.stringify(merged.last_seo_analysis ?? null) !== JSON.stringify(live.last_seo_analysis ?? null)) {
    merged.last_seo_analysis = live.last_seo_analysis;
    changed = true;
  }
  if (live.url && !merged.source_url) {
    merged.source_url = live.url;
    changed = true;
  }
  const topic = topicFromId(live.topic_id, topics);
  if (topic && (!merged.topic || String(merged.topic.id) !== String(topic.id))) {
    merged.topic = topic;
    changed = true;
  }
  const migration = {
    ...(merged.migration || {}),
    live_api: {
      source: `${liveBase}/api/articles`,
      fetched_at: generatedAt,
      matched_by: 'id_or_slug',
      fields_merged: Object.keys(metadata).filter((key) => metadata[key] !== null && metadata[key] !== ''),
    },
  };
  merged.migration = migration;
  return { merged, changed, imageAdded: Boolean(image && !existing.image_link), invalidImageRemoved };
}

function createArticleFromLive(live, topics) {
  const html = sanitizeHtml(live.content_html || live.content || '');
  const topic = topicFromId(live.topic_id, topics);
  const image = bestImage(live);
  const liveImageUrl = publicImageUrl(live.image_url);
  const liveThumbnails = safeThumbnails(live.thumbnails);
  return {
    id: live.id,
    slug: live.slug || slugify(live.title),
    canonical_path: `/articles/${live.slug || slugify(live.title)}/`,
    title: live.title || 'Untitled',
    description: live.description || clampText(stripHtml(html), 500),
    publication_date: live.publication_date || null,
    source: live.source || null,
    source_url: live.url || null,
    category: live.category || null,
    topic,
    read_time: live.read_time || null,
    image_link: image || '',
    image_url: liveImageUrl || image || null,
    thumbnails: liveThumbnails,
    keywords: live.keywords || null,
    language: live.language || null,
    article_type: 0,
    article_type_label: live.article_type || 'current',
    source_status_value: live.status || null,
    publication_status_inferred: live.status === 'active' ? 'published_likely' : 'review_needed',
    is_featured: Boolean(live.is_featured),
    likes_count: live.likes_count ?? null,
    permanent_slug: live.permanent_slug ?? null,
    live_status: live.status ?? null,
    archived_at: live.archived_at ?? null,
    archived_by: live.archived_by ?? null,
    topic_id: live.topic_id ?? null,
    meta_title: live.meta_title ?? null,
    meta_description: live.meta_description ?? null,
    seo_keywords: live.seo_keywords ?? null,
    seo_score: live.seo_score ?? null,
    last_seo_analysis: live.last_seo_analysis ?? null,
    created_at: live.created_at || null,
    updated_at: live.updated_at || null,
    content_html_sanitized: html,
    plain_text_excerpt: clampText(stripHtml(html), 500),
    migration: {
      source_table: 'live_api_articles',
      source_id: String(live.id),
      source_endpoint: `${liveBase}/api/articles`,
      sanitized: true,
      raw_html_excluded: true,
      live_api: {
        fetched_at: generatedAt,
        matched_by: 'created_from_live_public_api',
      },
    },
  };
}

function articleFileName(article) {
  return `${article.slug || slugify(article.title)}.json`;
}

function mergeAssetManifest(assetManifest, liveArticles) {
  const byUrl = new Map(assetManifest
    .map((asset) => ({ ...asset, url: httpAssetUrl(asset.url) }))
    .filter((asset) => asset.url)
    .map((asset) => [asset.url, asset]));
  let added = 0;
  for (const article of liveArticles) {
    const urls = new Set([bestImage(article), article.image_url, article.thumbnails?.sm, article.thumbnails?.md, article.thumbnails?.lg]
      .map(httpAssetUrl)
      .filter(Boolean));
    for (const url of urls) {
      if (!url || byUrl.has(url)) continue;
      const urlPath = new URL(url).pathname;
      const basename = path.basename(urlPath) || `${article.slug}.img`;
      const asset = {
        url,
        suggested_local_path: `/assets/live/${basename}`,
        sources: ['live_public_api_article_image'],
        article_ids: [article.id],
        article_slugs: [article.slug].filter(Boolean),
        content_types: [],
        byte_sizes: [],
        filenames: [basename].filter(Boolean),
        wayback_lookup_recommended: false,
      };
      byUrl.set(url, asset);
      added++;
    }
  }
  return { assets: Array.from(byUrl.values()), added };
}

async function main() {
  const articles = await readJson('articles.json');
  const faqs = await readJson('faqs.json');
  const topics = await readJson('topics.json');
  const auditReport = await readJson('audit-report.json');
  const assetManifest = await readJson('asset-manifest.json');
  const homeHtml = await cachedText('home.html', `${liveBase}/`, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const sitemapXml = await optionalCachedText('sitemap.xml', `${liveBase}/sitemap.xml`, 'application/xml,text/xml,*/*');
  const liveFaqs = await cachedJson('faqs.json', `${liveBase}/api/faqs`);
  const liveBio = await cachedJson('bio.json', `${liveBase}/api/bio`);
  const liveArticles = await fetchCurrentArticles();

  const liveById = new Map(liveArticles.map((article) => [String(article.id), article]));
  const liveBySlug = new Map(liveArticles.map((article) => [article.slug, article]));
  const existingById = new Map(articles.map((article) => [String(article.id), article]));
  const existingSlugs = new Set(articles.map((article) => article.slug));

  let articleMatched = 0;
  let articleCreated = 0;
  let articleChanged = 0;
  let articleImagesAdded = 0;
  let articleInvalidImagesRemoved = 0;
  const mergedArticles = articles.map((article) => {
    const live = liveById.get(String(article.id)) || liveBySlug.get(article.slug);
    if (!live) return article;
    articleMatched++;
    const result = mergeArticle(article, live, topics);
    if (result.changed) articleChanged++;
    if (result.imageAdded) articleImagesAdded++;
    if (result.invalidImageRemoved) articleInvalidImagesRemoved++;
    return result.merged;
  });

  for (const live of liveArticles) {
    if (existingById.has(String(live.id)) || existingSlugs.has(live.slug)) continue;
    const created = createArticleFromLive(live, topics);
    mergedArticles.push(created);
    existingById.set(String(created.id), created);
    existingSlugs.add(created.slug);
    articleCreated++;
    if (created.image_link) articleImagesAdded++;
  }

  mergedArticles.sort((a, b) => {
    const bd = Date.parse(b.publication_date || b.updated_at || b.created_at || '') || 0;
    const ad = Date.parse(a.publication_date || a.updated_at || a.created_at || '') || 0;
    return bd - ad || String(b.id).localeCompare(String(a.id));
  });

  const faqById = new Map(faqs.map((faq) => [String(faq.id), faq]));
  let faqAdded = 0;
  let faqChanged = 0;
  for (const liveFaq of liveFaqs) {
    const sanitized = sanitizeHtml(liveFaq.content || liveFaq.content_html || '');
    const existing = faqById.get(String(liveFaq.id));
    const next = {
      ...(existing || {}),
      id: liveFaq.id,
      question: liveFaq.question,
      category: liveFaq.category || existing?.category || 'General',
      content_html_sanitized: sanitized || existing?.content_html_sanitized || '',
      created_at: liveFaq.created_at || existing?.created_at || null,
      updated_at: liveFaq.updated_at || existing?.updated_at || null,
      migration: {
        ...(existing?.migration || {}),
        live_api: {
          source: `${liveBase}/api/faqs`,
          fetched_at: generatedAt,
          sanitized: true,
        },
      },
    };
    if (!existing) faqAdded++;
    else if (JSON.stringify(existing) !== JSON.stringify(next)) faqChanged++;
    faqById.set(String(liveFaq.id), next);
  }
  const mergedFaqs = Array.from(faqById.values()).sort((a, b) => Number(a.id) - Number(b.id));

  const meta = extractMetaTags(homeHtml);
  const sitemapRoutes = extractSitemapRoutes(sitemapXml);
  const siteMetadata = {
    source: liveBase,
    fetched_at: generatedAt,
    title: meta.title || 'MarijuanaNews.com',
    site_name: meta.meta['og:site_name'] || 'MarijuanaNews.com',
    description: meta.meta.description || 'Latest Cannabis News, Research and Industry Insights from MarijuanaNews.com',
    og: {
      title: meta.meta['og:title'] || 'MarijuanaNews.com - Latest Cannabis News',
      description: meta.meta['og:description'] || meta.meta.description || '',
      type: meta.meta['og:type'] || 'website',
      url: meta.meta['og:url'] || `${canonicalBase}/`,
      image: meta.meta['og:image'] || `${canonicalBase}/mj_logo.png`,
    },
    twitter: {
      card: meta.meta['twitter:card'] || 'summary_large_image',
      title: meta.meta['twitter:title'] || meta.title || 'MarijuanaNews.com',
      description: meta.meta['twitter:description'] || meta.meta.description || '',
      image: meta.meta['twitter:image'] || meta.meta['og:image'] || `${canonicalBase}/mj_logo.png`,
    },
    google_analytics_id: meta.googleAnalyticsId || 'G-KVQC0147KK',
    favicon: '/favicon.svg',
    logo: '/mj_logo.png',
    canonical_origin: canonicalBase,
    legacy_origin: liveBase,
    sitemap_routes: sitemapRoutes,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      url: `${canonicalBase}/`,
      name: 'MarijuanaNews.com',
      description: 'Latest Cannabis News, Research and Industry Insights',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${canonicalBase}/search?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  };

  const bioHtml = sanitizeHtml(liveBio?.bio?.html || '');
  const bioJson = {
    source: `${liveBase}/api/bio`,
    fetched_at: generatedAt,
    name: liveBio?.bio?.name || 'Richard Cowan',
    role: liveBio?.bio?.role || 'Author',
    birth_date: liveBio?.bio?.birth_date || null,
    social_links: liveBio?.bio?.social_links || {},
    image_urls: Array.isArray(liveBio?.bio?.image_urls) ? liveBio.bio.image_urls : [],
    content_html_sanitized: bioHtml,
    plain_text_excerpt: clampText(stripHtml(bioHtml), 700),
    migration: {
      source_endpoint: `${liveBase}/api/bio`,
      sanitized: true,
      raw_html_excluded: true,
    },
  };

  const assetMerge = mergeAssetManifest(assetManifest, liveArticles);

  const oldMissingImage = Number(auditReport.article_counts?.missing_image_link_total || 0);
  const missingImageNow = mergedArticles.filter((article) => !article.image_link).length;
  const report = {
    source: liveBase,
    generated_at: generatedAt,
    live_current_articles_seen: liveArticles.length,
    existing_articles_before: articles.length,
    articles_after: mergedArticles.length,
    live_articles_matched: articleMatched,
    live_articles_created: articleCreated,
    articles_changed: articleChanged,
    article_image_links_added: articleImagesAdded,
    inline_data_image_links_removed: articleInvalidImagesRemoved,
    missing_image_link_before: oldMissingImage,
    missing_image_link_after: missingImageNow,
    live_faqs_seen: liveFaqs.length,
    faqs_before: faqs.length,
    faqs_after: mergedFaqs.length,
    faqs_added: faqAdded,
    faqs_changed: faqChanged,
    bio_html_bytes: bioHtml.length,
    asset_references_added_from_live_images: assetMerge.added,
    sitemap_routes_imported: sitemapRoutes.length,
    site_metadata_fields: Object.keys(siteMetadata),
    skipped_private_live_endpoints: ['admin', 'auth', 'users', 'comments', 'likes'],
  };

  const updatedAudit = {
    ...auditReport,
    article_counts: {
      ...(auditReport.article_counts || {}),
      exported_total: mergedArticles.length,
      missing_image_link_total: missingImageNow,
    },
    assets: {
      ...(auditReport.assets || {}),
      total_unique_asset_urls: assetMerge.assets.length,
    },
    live_public_api_migration: report,
  };

  await writeJson(path.join(dataDir, 'articles.json'), mergedArticles);
  await writeJson(path.join(dataDir, 'faqs.json'), mergedFaqs);
  await writeJson(path.join(dataDir, 'site-metadata.json'), siteMetadata);
  await writeJson(path.join(dataDir, 'bio.json'), bioJson);
  await writeJson(path.join(dataDir, 'asset-manifest.json'), assetMerge.assets);
  await writeJson(path.join(dataDir, 'audit-report.json'), updatedAudit);
  await writeJson(path.join(dataDir, 'live-api-metadata-report.json'), report);

  const existingFiles = new Set(await readdir(articlesDir).catch(() => []));
  for (const article of mergedArticles) {
    const file = articleFileName(article);
    if (existingFiles.has(file) || liveById.has(String(article.id))) {
      await writeJson(path.join(articlesDir, file), article);
    }
  }

  await fetchBinaryToFile(`${liveBase}/favicon.svg`, path.join(publicDir, 'favicon.svg'));
  await fetchBinaryToFile(`${liveBase}/mj_logo.png`, path.join(publicDir, 'mj_logo.png'));

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
