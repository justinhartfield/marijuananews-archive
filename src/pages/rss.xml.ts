import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL, articles, articleUrl, cdata, escapeHtml, excerpt } from '../lib/content';

export async function GET() {
  const items = articles.slice(0, 50).map((article) => {
    const link = new URL(articleUrl(article), SITE_URL).toString();
    const pubDate = article.publication_date ? new Date(article.publication_date).toUTCString() : '';
    const category = article.category ? `<category>${escapeHtml(article.category)}</category>` : '';
    return `<item>\n<title>${escapeHtml(article.title)}</title>\n<link>${escapeHtml(link)}</link>\n<guid isPermaLink="true">${escapeHtml(link)}</guid>\n${pubDate ? `<pubDate>${escapeHtml(pubDate)}</pubDate>` : ''}\n${category}\n<description><![CDATA[${cdata(excerpt(article, 320))}]]></description>\n</item>`;
  }).join('\n');
  const lastBuildDate = articles[0]?.publication_date ? new Date(articles[0].publication_date).toUTCString() : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n<title>${escapeHtml(SITE_TITLE)}</title>\n<link>${escapeHtml(SITE_URL)}</link>\n<atom:link href="${escapeHtml(new URL('/rss.xml', SITE_URL).toString())}" rel="self" type="application/rss+xml" />\n<description>${escapeHtml(SITE_DESCRIPTION)}</description>\n<language>en-us</language>\n<lastBuildDate>${escapeHtml(lastBuildDate)}</lastBuildDate>\n${items}\n</channel></rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
