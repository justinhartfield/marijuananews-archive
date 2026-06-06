import { SITE_URL } from '../lib/content';

export async function GET() {
  const sitemap = new URL('/sitemap.xml', SITE_URL).toString();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /backend/',
    'Disallow: /_backend/',
    'Disallow: /_private/',
    'Disallow: /newsletter-signups/',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
