import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL, articles, articleUrl, cdata, escapeHtml, excerpt } from '../lib/content';

export async function GET() {
  const items = articles.slice(0, 50).map((article) => {
    const link = new URL(articleUrl(article), SITE_URL).toString();
    const pubDate = article.publication_date ? new Date(article.publication_date).toUTCString() : '';
    return `<item>\n<title>${escapeHtml(article.title)}</title>\n<link>${escapeHtml(link)}</link>\n<guid>${escapeHtml(link)}</guid>\n${pubDate ? `<pubDate>${escapeHtml(pubDate)}</pubDate>` : ''}\n<description><![CDATA[${cdata(excerpt(article, 320))}]]></description>\n</item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n<title>${escapeHtml(SITE_TITLE)}</title>\n<link>${escapeHtml(SITE_URL)}</link>\n<description>${escapeHtml(SITE_DESCRIPTION)}</description>\n${items}\n</channel></rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
