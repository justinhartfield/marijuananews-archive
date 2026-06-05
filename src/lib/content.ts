import articlesData from '../data/public-content/articles.json';
import faqsData from '../data/public-content/faqs.json';
import topicsData from '../data/public-content/topics.json';
import redirectsData from '../data/public-content/redirects.json';
import auditReportData from '../data/public-content/audit-report.json';
import assetRewriteMapData from '../data/public-content/asset-rewrite-map.json';

export const SITE_URL = 'https://www.marijuananews.com';
export const SITE_TITLE = 'MarijuanaNews.com Archive';
export const SITE_DESCRIPTION = 'A rebuilt public archive of MarijuanaNews.com articles, FAQs, topics, and source-preserved cannabis policy history.';
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
  keywords?: string | null;
  seo_keywords?: string | null;
  read_time?: number | string | null;
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
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  return assetRewriteMap[raw] || assetRewriteMap[normalized] || normalized;
}

export function rewriteLegacyHtml(html: string): string {
  return html
    .replace(/\b(src|href)=(['"])(.*?)\2/gi, (_match, attr: string, quote: string, value: string) => {
      return `${attr}=${quote}${escapeAttribute(rewriteAssetUrl(value))}${quote}`;
    })
    .replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"');
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
