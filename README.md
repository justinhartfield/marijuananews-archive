# MarijuanaNews.com Astro archive shell

This Astro site consumes the public migration artifacts in `src/data/public-content/` and builds a static reading surface for the recovered MarijuanaNews.com archive.

## Included routes

- `/` — archive home and migration stats.
- `/articles/[slug]/` — one static page per recovered public article.
- `/archive/` and `/archive/[page]/` — paginated article archive.
- `/topics/` and `/topics/[slug]/` — topic index and topic pages.
- `/categories/` and `/categories/[slug]/` — category index and category pages.
- `/faq/` — recovered FAQ entries.
- `/bio/` — conservative provenance/bio note using recovered source metadata.
- `/sitemap.xml` — static sitemap for articles, archive, topics, categories, and core pages.
- `/rss.xml` — latest 50 articles.
- `public/_redirects` — generated legacy redirect map from `redirects.json`.

## Commands

```bash
npm ci
npm run sync:content
npm run redirects
npm run build
npm run preview
```

## Cloudflare Worker deploy

This repo deploys the generated Astro `dist/` directory to R2 and serves it through a small Cloudflare Worker. This avoids Workers Assets metadata limits for the multi-thousand-file archive.

```bash
npm ci
npm run build
# create once if the bucket does not already exist:
# npx wrangler r2 bucket create marijuananews-archive-assets
# upload dist/ into the R2 bucket using the Cloudflare API token from the environment:
CLOUDFLARE_API_TOKEN=... npm run upload:r2
npm run deploy:dry-run
CLOUDFLARE_API_TOKEN=... npm run deploy
```

Worker config lives in `wrangler.jsonc`. Runtime asset serving lives in `worker/index.js`. The R2 uploader reads `CLOUDFLARE_API_TOKEN`, optional `CLOUDFLARE_ACCOUNT_ID`, optional `R2_UPLOAD_CONCURRENCY`, optional `R2_UPLOAD_OFFSET`, and optional `R2_UPLOAD_LIMIT`. Do not commit Cloudflare tokens or `.env` files.

## Asset mirroring

By default the site normalizes protocol-relative legacy URLs and can consume a generated asset rewrite map. To mirror assets into `public/assets/` using the migration asset manifest and optional Wayback lookups:

```bash
npm run mirror:assets -- \
  --manifest src/data/public-content/asset-manifest.json \
  --wayback ../out/public-content/wayback-manifest-sample.json \
  --limit 25 \
  --workers 2 \
  --sleep-ms 250 \
  --timeout-ms 15000
```

For the full archive, first run the Wayback collector from the parent migration workspace, then pass the resulting manifest here. Keep concurrency/rate low because Internet Archive CDX and replay endpoints throttle aggressively.

## Safety rule

Render only `content_html_sanitized`. Never render raw legacy article HTML from the SQL dump.
