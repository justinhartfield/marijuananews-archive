# Marijuana News visual system

Source: user supplied screenshot of the modern MarijuanaNews.com homepage, interpreted through the Gemini Design MCP Astro workflow. The Gemini MCP server is not configured in this session and the local `gemini` CLI is installed but unauthenticated, so this file is the project design source for implementation.

## Direction

Modern cannabis policy newspaper, not a generic blog. Keep the Richard Cowan editorial identity, but move from the old broadsheet rebuild into a clean green publication interface with cards, rounded panels, thumbnails, topic chips, and a useful right rail.

## Layout

- Page max width: 1180 to 1240 px.
- Header: full width dark emerald bar, compact logo left, search form center/right, utility buttons right.
- Quote strip: brighter green horizontal strip under the header with the line: “The best two word explanation for Marijuana Prohibition is Bad Journalism.”
- Home body: two column desktop grid.
  - Main column: featured hero card, then vertical article stream.
  - Sidebar: Richard Cowan card, archive CTA, topic/tag cloud, FAQ CTA, newsletter signup.
- Mobile: single column, header search stacks under logo, article cards become thumbnail plus text or full width if cramped.

## Tokens

- Background: `#f7faf8` with subtle emerald radial accents.
- Primary: deep emerald `#075c48`.
- Secondary: cannabis green `#0b9b68`.
- Accent mint: `#d9f8e7` and `#eafbf2`.
- Ink: `#10231d`.
- Muted: `#5d7068`.
- Border: `#d7ebe2`.
- Card: white with soft shadow, 14 to 18 px radius.
- Typography: system sans. Use bold, compact headlines and small pill metadata.

## Components

### Header

- Logo image stays white/green on dark emerald.
- Search input placeholder: “Search for news, topics, or sources…”
- Search button is white/green, compact.
- Add a moon theme toggle button and a sign in link to `/backend/`.

### Featured hero

- Large rounded emerald gradient card.
- Left side has author/date pills, headline, excerpt, and `Read Full Article →` CTA.
- Right side has a circular dark-green watermark with the Marijuana News logo.
- Use the latest featured article.

### Article stream

- Each item is a rounded white card with left thumbnail, metadata row, bold headline, one-line excerpt, topic pill, and small action icons.
- Use article image when available.
- Show author, read time, and relative date.

### Sidebar

- Richard Cowan card with portrait and `View Bio →`.
- Chronological Index card with archive explanation and `View full archive` button.
- Topic cloud with pill buttons and counts.
- FAQ card with `Browse FAQ Section`.
- Newsletter signup with email input and `Subscribe` button.

## Functional requirements

- Search form must submit to `/search/?q=...`.
- Newsletter form should call `/api/newsletter` and show visible success or failure state. If JavaScript is unavailable, the form can still POST to the endpoint.
- Do not leak newsletter signup objects as static R2 files.
- Keep RSS, sitemap, backend, search, article pages, and old redirects working.

## QA requirements

- Home HTML includes newsletter form, tag cloud/topic cloud, Richard Cowan sidebar, and featured story.
- Browser QA desktop and mobile: no console errors, no broken local images, no horizontal overflow.
- Live smoke: `/`, `/search/`, `/chronological-index/`, `/rss.xml`, `/sitemap.xml`, public APIs, private backend block.
