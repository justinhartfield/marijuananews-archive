import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'src/data/public-content');
const backendIndexPath = path.join(root, 'public/_backend/index.json');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

function unsafeUrl(value) {
  const raw = String(value || '').trim();
  return /^(data:|javascript:|vbscript:)/i.test(raw) || raw.includes('\n') || raw.includes('\r');
}

function collectImageUrls(article) {
  const urls = [];
  for (const key of ['image_link', 'image_url']) {
    if (article[key]) urls.push({ key, url: article[key], slug: article.slug });
  }
  if (article.thumbnails && typeof article.thumbnails === 'object') {
    for (const [key, url] of Object.entries(article.thumbnails)) {
      if (url) urls.push({ key: `thumbnails.${key}`, url, slug: article.slug });
    }
  }
  return urls;
}

const [articles, faqs, assets, rewriteMap, auditReport, liveReport, siteMetadata, bioProfile, backendIndex] = await Promise.all([
  readJson(path.join(dataDir, 'articles.json')),
  readJson(path.join(dataDir, 'faqs.json')),
  readJson(path.join(dataDir, 'asset-manifest.json')),
  readJson(path.join(dataDir, 'asset-rewrite-map.json')),
  readJson(path.join(dataDir, 'audit-report.json')),
  readJson(path.join(dataDir, 'live-api-metadata-report.json')),
  readJson(path.join(dataDir, 'site-metadata.json')),
  readJson(path.join(dataDir, 'bio.json')),
  readJson(backendIndexPath),
]);

assert(Array.isArray(articles) && articles.length >= 2500, 'article export is unexpectedly small', { count: articles.length });
assert(Array.isArray(faqs) && faqs.length > 0, 'FAQ export missing', { count: faqs.length });
assert(Array.isArray(assets), 'asset manifest is not an array');
assert(siteMetadata.title || siteMetadata.site_name, 'live site metadata missing title/site_name');
assert(siteMetadata.description, 'live site metadata missing description');
assert(siteMetadata.canonical_origin, 'live site metadata missing canonical_origin');
assert(bioProfile.name, 'bio profile missing name');
assert(bioProfile.content_html_sanitized, 'bio profile missing sanitized content');

const imageUrls = articles.flatMap(collectImageUrls);
const unsafeImages = imageUrls.filter((entry) => unsafeUrl(entry.url));
assert(unsafeImages.length === 0, 'unsafe article image URLs remain', { examples: unsafeImages.slice(0, 8) });

const unsafeAssets = assets.filter((asset) => unsafeUrl(asset.url));
assert(unsafeAssets.length === 0, 'unsafe asset manifest URLs remain', { examples: unsafeAssets.slice(0, 8).map((asset) => asset.url) });

const unsafeRewriteEntries = Object.entries(rewriteMap).filter(([source, destination]) => unsafeUrl(source) || unsafeUrl(destination) || !String(destination).startsWith('/'));
assert(unsafeRewriteEntries.length === 0, 'unsafe asset rewrite-map entries remain', { examples: unsafeRewriteEntries.slice(0, 8) });

const liveMerged = articles.filter((article) => article.migration?.live_api).length;
assert(liveMerged >= 500, 'live public API article metadata merge coverage is low', { liveMerged });
assert(Number(liveReport.live_current_articles_seen || 0) >= 500, 'live report saw too few current articles', liveReport);
assert(Number(liveReport.live_articles_matched || 0) >= 500, 'live report matched too few current articles', liveReport);
assert(Number(auditReport.article_counts?.exported_total || 0) === articles.length, 'audit report article total does not match articles.json', { auditTotal: auditReport.article_counts?.exported_total, articles: articles.length });
assert(Number(auditReport.assets?.total_unique_asset_urls || 0) === assets.length, 'audit report asset total does not match asset-manifest.json', { auditTotal: auditReport.assets?.total_unique_asset_urls, assets: assets.length });

assert(backendIndex.schemaVersion === 1, 'backend index schema version changed unexpectedly', { schemaVersion: backendIndex.schemaVersion });
assert(backendIndex.stats?.articles === articles.length, 'backend index article total does not match articles.json', { backend: backendIndex.stats?.articles, articles: articles.length });
assert(backendIndex.site?.liveMetadata?.description, 'backend index missing live metadata');
assert(backendIndex.site?.bio?.name, 'backend index missing bio profile summary');
const backendArticleWithLive = backendIndex.articles.find((article) => article.liveStatus || article.thumbnails || article.imageOriginal);
assert(backendArticleWithLive, 'backend index missing migrated live article fields');

const report = {
  ok: true,
  articles: articles.length,
  faqs: faqs.length,
  assetReferences: assets.length,
  rewriteEntries: Object.keys(rewriteMap).length,
  liveMerged,
  liveCurrentArticlesSeen: liveReport.live_current_articles_seen,
  inlineDataImageLinksRemoved: liveReport.inline_data_image_links_removed || 0,
  backendBytes: Buffer.byteLength(JSON.stringify(backendIndex)),
};

console.log(JSON.stringify(report, null, 2));
