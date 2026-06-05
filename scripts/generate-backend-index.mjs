import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'src/data/public-content');
const outDir = path.join(root, 'public/_backend');
const outFile = path.join(outDir, 'index.json');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(text, maxLength = 280) {
  const normalized = cleanLabel(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

function yearOf(raw) {
  if (!raw) return 'Undated';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'Undated' : String(date.getUTCFullYear());
}

function dateValue(raw) {
  const time = Date.parse(raw || '');
  return Number.isFinite(time) ? time : 0;
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = cleanLabel(getKey(item)) || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, slug: slugify(name), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function hostOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return 'invalid-url';
  }
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
}

const [rawArticles, rawFaqs, rawTopics, rawRedirects, rawExternalLinks, rawAssets, rawRewriteMap, auditReport] = await Promise.all([
  readJson('articles.json'),
  readJson('faqs.json'),
  readJson('topics.json'),
  readJson('redirects.json'),
  readJson('external-links.json'),
  readJson('asset-manifest.json'),
  readJson('asset-rewrite-map.json'),
  readJson('audit-report.json'),
]);

const articles = rawArticles
  .filter((article) => article.slug && article.title)
  .sort((a, b) => dateValue(b.publication_date || b.updated_at || b.created_at) - dateValue(a.publication_date || a.updated_at || a.created_at))
  .map((article) => {
    const fullText = stripHtml(article.content_html_sanitized || '');
    const category = cleanLabel(article.category) || 'General';
    const topicName = cleanLabel(article.topic?.name) || '';
    const topicSlug = article.topic?.slug || (topicName ? slugify(topicName) : '');
    const publicationDate = article.publication_date || article.updated_at || article.created_at || null;
    const keywords = [article.keywords, article.seo_keywords, category, topicName]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map(cleanLabel)
      .filter(Boolean)
      .slice(0, 18);
    const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
    const path = article.canonical_path || `/articles/${article.slug}/`;
    return {
      id: article.id,
      slug: article.slug,
      path: path.endsWith('/') ? path : `${path}/`,
      title: cleanLabel(article.title),
      description: clampText(article.description || article.meta_description || article.plain_text_excerpt || fullText, 340),
      excerpt: clampText(article.plain_text_excerpt || fullText, 420),
      category,
      categorySlug: slugify(category),
      topic: topicName,
      topicSlug,
      publicationDate,
      year: yearOf(publicationDate),
      source: cleanLabel(article.source),
      sourceUrl: article.source_url || '',
      readTime: Number(article.read_time || 0) || Math.max(1, Math.round(wordCount / 225)),
      image: article.image_link || '',
      keywords: Array.from(new Set(keywords)),
      language: article.language || '',
      articleType: article.article_type || '',
      status: article.publication_status_inferred || article.source_status_value || '',
      seoScore: article.seo_score ?? null,
      wordCount,
      contentLength: String(article.content_html_sanitized || '').length,
      hasImage: Boolean(article.image_link),
      migration: article.migration || null,
    };
  });

const categories = countBy(articles, (article) => article.category);
const topics = countBy(articles, (article) => article.topic || 'No topic');
const years = countBy(articles, (article) => article.year);
const sourceTypes = countBy(articles, (article) => article.source || 'Unknown source');

const faqs = rawFaqs.map((faq) => ({
  id: faq.id,
  question: cleanLabel(faq.question),
  category: cleanLabel(faq.category) || 'General',
  excerpt: clampText(stripHtml(faq.content_html_sanitized || ''), 360),
}));

const redirects = rawRedirects.map((rule) => ({
  from: rule.from,
  to: rule.to,
  status: Number(rule.status) || 301,
}));

const externalLinks = rawExternalLinks.map((link) => ({
  url: link.url,
  host: hostOf(link.url),
  articleCount: Array.isArray(link.article_ids) ? link.article_ids.length : 0,
  articleSlugs: Array.isArray(link.article_slugs) ? link.article_slugs.slice(0, 8) : [],
  waybackLookupRecommended: Boolean(link.wayback_lookup_recommended),
}));

const assets = rawAssets.map((asset) => ({
  url: asset.url,
  host: hostOf(asset.url),
  suggestedLocalPath: asset.suggested_local_path || rawRewriteMap[asset.url] || '',
  mirroredPath: rawRewriteMap[asset.url] || '',
  sourceCount: Array.isArray(asset.sources) ? asset.sources.length : 0,
  articleCount: Array.isArray(asset.article_ids) ? asset.article_ids.length : 0,
  contentTypes: Array.isArray(asset.content_types) ? asset.content_types.filter(Boolean).slice(0, 5) : [],
  byteSizes: Array.isArray(asset.byte_sizes) ? asset.byte_sizes.filter(Boolean).slice(0, 5) : [],
  filenames: Array.isArray(asset.filenames) ? asset.filenames.filter(Boolean).slice(0, 5) : [],
  waybackLookupRecommended: Boolean(asset.wayback_lookup_recommended),
}));

const allLinkHosts = countBy(externalLinks, (link) => link.host);
const allAssetHosts = countBy(assets, (asset) => asset.host);
const linkHosts = allLinkHosts.slice(0, 40);
const assetHosts = allAssetHosts.slice(0, 40);
const mirroredAssetCount = Object.keys(rawRewriteMap).length;
const dateValues = articles.map((article) => dateValue(article.publicationDate)).filter(Boolean).sort((a, b) => a - b);

const index = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  site: {
    name: 'MarijuanaNews.com Archive',
    publicUrl: 'https://marijuananews-archive.hartjr.workers.dev',
    source: 'Recovered public archive artifacts',
  },
  stats: {
    articles: articles.length,
    faqs: faqs.length,
    topics: rawTopics.length,
    categories: categories.length,
    redirects: redirects.length,
    externalLinks: externalLinks.length,
    externalHosts: allLinkHosts.length,
    assetReferences: assets.length,
    mirroredAssetReferences: mirroredAssetCount,
    articlesWithImages: articles.filter((article) => article.hasImage).length,
    totalWords: articles.reduce((sum, article) => sum + article.wordCount, 0),
    averageReadTime: Math.round(articles.reduce((sum, article) => sum + article.readTime, 0) / Math.max(1, articles.length)),
    earliestPublicationDate: dateValues[0] ? new Date(dateValues[0]).toISOString().slice(0, 10) : null,
    latestPublicationDate: dateValues.at(-1) ? new Date(dateValues.at(-1)).toISOString().slice(0, 10) : null,
  },
  facets: {
    categories,
    topics,
    years,
    sourceTypes,
    externalHosts: linkHosts,
    assetHosts,
  },
  articles,
  faqs,
  redirects,
  externalLinks,
  assets,
  audit: auditReport,
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(index)}\n`);
console.log(JSON.stringify({ ok: true, outFile, bytes: Buffer.byteLength(JSON.stringify(index)), stats: index.stats }, null, 2));
