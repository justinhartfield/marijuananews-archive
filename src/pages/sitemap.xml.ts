import { articles, categories, topics, archivePageCount, articleUrl, absoluteUrl, escapeHtml } from '../lib/content';

function urlEntry(path: string, lastmod?: string | null): string {
  const loc = escapeHtml(absoluteUrl(path));
  const mod = lastmod ? `<lastmod>${escapeHtml(lastmod.slice(0, 10))}</lastmod>` : '';
  return `<url><loc>${loc}</loc>${mod}</url>`;
}

export async function GET() {
  const paths: string[] = ['/', '/archive/', '/faq/', '/bio/', '/topics/', '/categories/', '/rss.xml'];
  for (let page = 2; page <= archivePageCount; page++) paths.push(`/archive/${page}/`);
  for (const topic of topics) paths.push(`/topics/${topic.slug}/`);
  for (const category of categories) paths.push(`/categories/${category.slug}/`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    ...paths.map((path) => urlEntry(path)),
    ...articles.map((article) => urlEntry(articleUrl(article), article.updated_at || article.publication_date)),
  ].join('\n')}\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
