import articlesData from '../data/public-content/articles.json';
import faqsData from '../data/public-content/faqs.json';
import topicsData from '../data/public-content/topics.json';
import redirectsData from '../data/public-content/redirects.json';
import auditReportData from '../data/public-content/audit-report.json';
import assetRewriteMapData from '../data/public-content/asset-rewrite-map.json';
import siteMetadataData from '../data/public-content/site-metadata.json';
import bioData from '../data/public-content/bio.json';
import memoryHoleReviewData from '../data/public-content/memory-hole-review.json';

export const PAGE_SIZE = 48;

type JsonMap = Record<string, unknown>;

export interface Topic {
  id?: string | number | null;
  name: string;
  slug?: string | null;
  description?: string | null;
}

export interface Article {
  id: number | string;
  slug: string;
  canonical_path?: string | null;
  title: string;
  description?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  plain_text_excerpt?: string | null;
  content_html_sanitized: string;
  publication_date?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  source?: string | null;
  source_url?: string | null;
  category?: string | null;
  topic?: Topic | null;
  image_link?: string | null;
  image_url?: string | null;
  thumbnails?: Record<string, string> | null;
  keywords?: string | null;
  seo_keywords?: string | null;
  read_time?: number | string | null;
  permanent_slug?: string | null;
  live_status?: string | null;
  topic_id?: number | string | null;
  is_featured?: boolean | null;
  likes_count?: number | null;
}

export interface Faq {
  id: number | string;
  question: string;
  category?: string | null;
  content_html_sanitized: string;
}

export interface CategorySummary {
  name: string;
  slug: string;
  count: number;
}

export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

export interface SiteMetadata {
  title?: string | null;
  site_name?: string | null;
  description?: string | null;
  canonical_origin?: string | null;
  legacy_origin?: string | null;
  google_analytics_id?: string | null;
  favicon?: string | null;
  logo?: string | null;
  og?: Record<string, string> | null;
  twitter?: Record<string, string> | null;
  schema?: JsonMap | null;
}

export interface BioProfile {
  name?: string | null;
  role?: string | null;
  birth_date?: string | null;
  social_links?: Record<string, string> | null;
  image_urls?: Array<Record<string, unknown>> | null;
  content_html_sanitized?: string | null;
  plain_text_excerpt?: string | null;
}

export const siteMetadata = siteMetadataData as SiteMetadata;
export const bioProfile = bioData as BioProfile;
export const memoryHoleReview = memoryHoleReviewData as JsonMap & {
  summary?: JsonMap;
  records?: Array<JsonMap>;
  policy?: JsonMap;
};

export const SITE_URL = cleanLabel(siteMetadata.canonical_origin) || 'https://marijuananews.com';
export const SOURCE_SITE_TITLE = cleanLabel(siteMetadata.site_name || siteMetadata.title) || 'MarijuanaNews.com';
export const SITE_TITLE = SOURCE_SITE_TITLE;
export const SITE_DESCRIPTION = cleanLabel(siteMetadata.description)
  ? cleanLabel(siteMetadata.description)
  : 'Daily cannabis news, policy analysis, research, and industry coverage from Richard Cowan.';

export const articles = (articlesData as Article[])
  .filter((article) => article.slug && article.title)
  .sort((a, b) => dateSortValue(b) - dateSortValue(a));

export const faqs = faqsData as Faq[];
export const topics = (topicsData as Topic[]).map((topic) => ({
  ...topic,
  slug: topic.slug || slugify(topic.name),
}));
export const redirects = redirectsData as RedirectRule[];
export const auditReport = auditReportData as JsonMap;
export const assetRewriteMap = assetRewriteMapData as Record<string, string>;

const articleSlugMap = new Map(articles.map((article) => [article.slug, article]));
const legacyLinkTargets = buildLegacyLinkTargets();
const topicByName = new Map(topics.map((topic) => [topic.name.toLowerCase(), topic]));

const categoryCounts = new Map<string, number>();
for (const article of articles) {
  const category = cleanLabel(article.category) || 'General';
  categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
}

export const categories: CategorySummary[] = Array.from(categoryCounts.entries())
  .map(([name, count]) => ({ name, slug: slugify(name), count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

export const archivePageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));

export function getArticleBySlug(slug: string): Article | undefined {
  return articleSlugMap.get(slug);
}

export function articleUrl(article: Article): string {
  const path = article.canonical_path || `/articles/${article.slug}/`;
  return path.endsWith('/') ? path : `${path}/`;
}

export function articleImageUrl(article: Article): string {
  return displayAssetUrl(
    article.image_link
    || article.image_url
    || article.thumbnails?.xl
    || article.thumbnails?.lg
    || article.thumbnails?.md
    || article.thumbnails?.sm
    || ''
  );
}

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export function dateSortValue(article: Article): number {
  const raw = article.publication_date || article.updated_at || article.created_at || '';
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

export function formatDate(raw?: string | null): string {
  if (!raw) return 'Undated';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function excerpt(article: Article, maxLength = 210): string {
  const source = article.plain_text_excerpt || article.description || stripHtml(article.content_html_sanitized);
  return clampText(source, maxLength);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clampText(text: string, maxLength = 210): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

export function cleanLabel(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function articleTopicSlug(article: Article): string | null {
  const fromTopic = article.topic?.slug || (article.topic?.name ? topicByName.get(article.topic.name.toLowerCase())?.slug : null);
  if (fromTopic) return fromTopic;
  return article.topic?.name ? slugify(article.topic.name) : null;
}

export function articleCategorySlug(article: Article): string {
  return slugify(cleanLabel(article.category) || 'General');
}

export function getArticlesPage(page: number, pageSize = PAGE_SIZE): Article[] {
  const start = Math.max(0, page - 1) * pageSize;
  return articles.slice(start, start + pageSize);
}

export function getRelatedArticles(article: Article, limit = 4): Article[] {
  const topicSlug = articleTopicSlug(article);
  const categorySlug = articleCategorySlug(article);
  const related = articles.filter((candidate) => {
    if (candidate.slug === article.slug) return false;
    return articleTopicSlug(candidate) === topicSlug || articleCategorySlug(candidate) === categorySlug;
  });
  return related.slice(0, limit);
}

export function rewriteAssetUrl(url?: string | null): string {
  if (!url) return '';
  const raw = url.trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return raw;
  if (/^(data:|javascript:|vbscript:)/i.test(raw)) return '';
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  return assetRewriteMap[raw] || assetRewriteMap[normalized] || normalized;
}

export function displayAssetUrl(url?: string | null): string {
  const raw = (url || '').trim();
  if (!raw || /^(data:|javascript:|vbscript:|mailto:|tel:)/i.test(raw)) return '';
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  const rewritten = assetRewriteMap[raw] || assetRewriteMap[normalized];
  if (rewritten) return rewritten;
  if (normalized.startsWith('/')) return normalized;
  if (isBlockedLegacyAssetHost(normalized)) return '';
  return normalized;
}

function isBlockedLegacyAssetHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'marijuananews.sfo3.digitaloceanspaces.com';
  } catch {
    return false;
  }
}

export function rewriteLegacyHtml(html: string): string {
  return html
    .replace(/<img\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/gi, (match: string, quote: string, value: string) => {
      const displayUrl = displayAssetUrl(value);
      if (!displayUrl) return '';
      const rewritten = match.replace(/\bsrc=(['"])(.*?)\1/i, `src=${quote}${escapeAttribute(displayUrl)}${quote}`);
      return /\bloading=/i.test(rewritten) ? rewritten : rewritten.replace(/<img\b/i, '<img loading="lazy" decoding="async"');
    })
    .replace(/\b(href)=(['"])(.*?)\2/gi, (_match, attr: string, quote: string, value: string) => {
      return `${attr}=${quote}${escapeAttribute(rewriteLegacyLinkUrl(value))}${quote}`;
    });
}

function rewriteLegacyLinkUrl(url?: string | null): string {
  const raw = (url || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return raw;
  if (/^(data:|javascript:|vbscript:)/i.test(raw)) return '';

  const articlePath = normalizeLegacyArticlePath(raw);
  if (articlePath) return articlePath;

  for (const key of legacyLookupKeys(raw)) {
    const target = legacyLinkTargets.get(key);
    if (target) return target;
  }

  if (isFileLikeLegacyUrl(raw)) return '#legacy-link-unavailable';

  return rewriteAssetUrl(raw);
}

function normalizeLegacyArticlePath(raw: string): string | null {
  const path = internalPathname(raw);
  if (!path) return null;
  const match = path.match(/^\/articles\/([^?#]+?)(?:\/legacy)?\/?$/i);
  if (!match) return null;
  const slug = match[1].replace(/\/+$/, '');
  return articleSlugMap.has(slug) ? `/articles/${slug}/` : null;
}

function internalPathname(raw: string): string | null {
  if (raw.startsWith('/')) return raw.split('?')[0].split('#')[0];
  try {
    const parsed = new URL(raw);
    if (/^(www\.)?marijuananews\.com$/i.test(parsed.hostname)) return parsed.pathname;
  } catch {
    return null;
  }
  return null;
}

function buildLegacyLinkTargets(): Map<string, string> {
  const buckets = new Map<string, Set<string>>();
  for (const article of articles) {
    const target = articleUrl(article);
    for (const key of legacyLookupKeys(article.source_url || '')) {
      if (isIgnoredLegacyKey(key)) continue;
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key)?.add(target);
    }
  }

  const map = new Map<string, string>();
  for (const [key, targets] of buckets.entries()) {
    if (targets.size === 1) map.set(key, [...targets][0]);
  }
  return map;
}

function legacyLookupKeys(raw: string): string[] {
  const keys = new Set<string>();
  addLegacyFilenameKeys(raw, keys);
  const unwrapped = unwrapWaybackUrl(raw);
  if (unwrapped && unwrapped !== raw) addLegacyFilenameKeys(unwrapped, keys);
  return [...keys];
}

function unwrapWaybackUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.hostname !== 'web.archive.org') return null;
    const match = parsed.pathname.match(/^\/web\/\d+[a-z_]*\/(.+)$/i);
    return match ? safeDecode(match[1]) : null;
  } catch {
    return null;
  }
}

function addLegacyFilenameKeys(raw: string, keys: Set<string>): void {
  const value = safeDecode(raw.trim()).replace(/\\/g, '/');
  const withoutHash = value.split('#')[0];
  const sidMatch = withoutHash.match(/[?&]sid=([0-9]+)/i);
  if (sidMatch) keys.add(`sid:${sidMatch[1]}`);
  const withoutQuery = withoutHash.split('?')[0];
  const filename = withoutQuery.split('/').filter(Boolean).pop()?.toLowerCase();
  if (!filename || isIgnoredLegacyKey(`file:${filename}`)) return;
  keys.add(`file:${filename}`);
  const withoutExt = filename.replace(/\.(s?html?|php3?|asp)$/i, '');
  if (withoutExt && withoutExt !== filename) keys.add(`file:${withoutExt}`);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isIgnoredLegacyKey(key: string): boolean {
  return /(?:^|:)index(?:\.(?:s?html?|php3?|asp))?$/i.test(key)
    || /(?:^|:)default(?:\.(?:s?html?|php3?|asp))?$/i.test(key);
}

function isFileLikeLegacyUrl(raw: string): boolean {
  const value = safeDecode(raw.trim());
  if (/^file:/i.test(value)) return true;
  const unwrapped = unwrapWaybackUrl(value);
  return Boolean(unwrapped && /^file:/i.test(unwrapped));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

export function cdata(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

export function keywords(article: Article): string[] {
  const raw = [article.keywords, article.seo_keywords, article.category, article.topic?.name]
    .filter(Boolean)
    .join(',');
  return Array.from(new Set(raw.split(',').map((part) => cleanLabel(part)).filter(Boolean))).slice(0, 12);
}
