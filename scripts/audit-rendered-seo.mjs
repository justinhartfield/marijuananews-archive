import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

async function readDist(relativePath) {
  return readFile(path.join(dist, relativePath), 'utf8');
}

function meta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function linkHref(html, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<link[^>]+rel=["']${escaped}["'][^>]+href=["']([^"']+)["'][^>]*>`, 'i'));
  return match?.[1] || '';
}

function jsonLdGraphs(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1].trim());
  const entries = [];
  for (const script of scripts) {
    const parsed = JSON.parse(script);
    if (Array.isArray(parsed)) entries.push(...parsed);
    else if (Array.isArray(parsed['@graph'])) entries.push(...parsed['@graph']);
    else entries.push(parsed);
  }
  return entries;
}

function hasType(entries, type) {
  return entries.some((entry) => entry && (entry['@type'] === type || (Array.isArray(entry['@type']) && entry['@type'].includes(type))));
}

async function firstArticlePath() {
  const articleDir = path.join(dist, 'articles');
  const entries = await readdir(articleDir, { withFileTypes: true });
  const article = entries.find((entry) => entry.isDirectory() && entry.name !== 'index');
  assert(article, 'no rendered article directory found');
  return `articles/${article.name}/index.html`;
}

const home = await readDist('index.html');
assert(meta(home, 'description').length >= 80, 'home meta description is thin');
assert(linkHref(home, 'canonical') === 'https://marijuananews.com/', 'home canonical should use non-www canonical origin', { canonical: linkHref(home, 'canonical') });
assert(meta(home, 'robots').includes('max-image-preview:large'), 'home robots meta missing max image preview');
assert(meta(home, 'twitter:title'), 'home missing twitter:title');
assert(meta(home, 'twitter:description'), 'home missing twitter:description');
assert(hasType(jsonLdGraphs(home), 'WebSite'), 'home missing WebSite JSON-LD');

const articlePath = await firstArticlePath();
const article = await readDist(articlePath);
const articleGraph = jsonLdGraphs(article);
assert(meta(article, 'og:type') === 'article', 'article og:type must be article', { articlePath, ogType: meta(article, 'og:type') });
assert(meta(article, 'twitter:title'), 'article missing twitter:title', { articlePath });
assert(meta(article, 'twitter:description'), 'article missing twitter:description', { articlePath });
assert(hasType(articleGraph, 'NewsArticle'), 'article missing NewsArticle JSON-LD', { articlePath });
assert(hasType(articleGraph, 'BreadcrumbList'), 'article missing BreadcrumbList JSON-LD', { articlePath });
const newsArticle = articleGraph.find((entry) => entry['@type'] === 'NewsArticle');
assert(newsArticle?.headline && newsArticle?.datePublished && newsArticle?.author && newsArticle?.publisher, 'NewsArticle schema missing required editorial fields', { articlePath, newsArticle });
assert(!article.includes('class="article-cover" src=') || !article.includes('class="article-cover" src="') || !/class="article-cover"[^>]+alt=""/.test(article), 'article cover image has empty alt', { articlePath });

const faq = await readDist('faq/index.html');
const faqGraph = jsonLdGraphs(faq);
assert(hasType(faqGraph, 'FAQPage'), 'FAQ page missing FAQPage JSON-LD');
assert(hasType(faqGraph, 'BreadcrumbList'), 'FAQ page missing BreadcrumbList JSON-LD');

const memoryHole = await readDist('memory-hole/index.html');
assert(meta(memoryHole, 'robots').includes('noindex'), 'memory-hole page must be noindex');

const robots = await readDist('robots.txt');
assert(robots.includes('Sitemap: https://marijuananews.com/sitemap.xml'), 'robots.txt missing canonical sitemap');
assert(robots.includes('Disallow: /_backend/') && robots.includes('Disallow: /backend/'), 'robots.txt missing private/backend disallows');

const sitemap = await readDist('sitemap.xml');
assert(sitemap.includes('xmlns:image='), 'sitemap missing image namespace');
assert(sitemap.includes('<image:image>'), 'sitemap missing article image entries');
assert(!sitemap.includes('/memory-hole/'), 'noindex memory-hole page must not appear in sitemap');

const rss = await readDist('rss.xml');
assert(rss.includes('xmlns:atom=') && rss.includes('rel="self"'), 'RSS missing atom self link');
assert(rss.includes('<language>en-us</language>'), 'RSS missing language');
assert(rss.includes('<lastBuildDate>'), 'RSS missing lastBuildDate');
assert(rss.includes('isPermaLink="true"'), 'RSS GUIDs should be marked permalink');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'home canonical/meta/twitter/schema',
    'article NewsArticle/Breadcrumb/og metadata',
    'FAQPage schema',
    'memory-hole noindex',
    'robots private disallows and sitemap',
    'sitemap image extension without noindex URLs',
    'RSS atom/language/permalink metadata'
  ],
  articlePath,
}, null, 2));
