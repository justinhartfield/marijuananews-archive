# MarijuanaNews.com B5 Restored Reform Paper Design

Date: 2026-06-05
Status: Approved direction, pending implementation plan

## Goal

Redesign MarijuanaNews.com around the selected B5 "Restored Reform Paper" direction: a classic independent reform newspaper that feels preserved, credible, and editorially alive without becoming a retro gimmick.

The design should make the site feel less templated by giving it a clear publication identity: strong masthead, black ink rules, deep reform green accents, warm paper surface, article-first hierarchy, compact archive stats, and visible source/date/category metadata.

## Product Context

The current Astro site is a static public archive built from recovered MarijuanaNews.com content. It exposes articles, archive pagination, topics, categories, FAQ, bio, RSS, sitemap, and migration/audit metadata through `src/lib/content.ts` and JSON exports under `src/data/public-content/`.

The redesign must preserve the site's current content model and static build behavior. It is a visual and layout redesign, not a data migration or search/product expansion.

## Chosen Direction

B5: Restored Reform Paper.

Core qualities:

- Independent newspaper: the page should read as a restored publication, not a generic blog or SaaS archive.
- Reform movement identity: black and deep green rules should carry the cannabis policy/reform association with restraint.
- Historical grounding: the archive should feel preserved and useful, with metadata and audit details visible but not dominant.
- Scannable article blocks: long, provocative titles must be readable in lists without breaking layout.
- Legacy voice: article titles and excerpts should retain their period character while the surrounding UI gives them editorial discipline.

## Visual System

Palette:

- Paper base: warm off-white, close to `#fdfdfa`.
- Paper grain: slightly darker warm neutral, close to `#f4f4f0`.
- Ink: near-black, close to `#1a1a1a`.
- Muted ink: neutral gray, close to `#4a4a4a`.
- Reform green: deep forest green, close to `#2d4a3e`.
- Rules: black for major editorial divisions, light neutral gray for minor separators.

Typography:

- Display/headlines: serif with newspaper character, using system serif fallbacks for the initial implementation.
- UI metadata/nav: system sans.
- Dates/source/audit labels: system monospace.
- No viewport-width font scaling beyond normal `clamp()` usage already used in the codebase.
- Letter spacing remains `0` for headings. Only small metadata/nav labels may use positive tracking.

Texture and depth:

- Use a subtle paper texture effect through CSS only.
- Avoid decorative orbs, blurred gradients, stock-like atmosphere, and heavy shadows.
- Cards should be limited to functional archive/stat/sidebar blocks. Page sections should not become nested cards.

## Page Design

### Global Layout

`BaseLayout.astro` should own the publication shell:

- A top metadata strip with "Recovered public archive", article count, and audit status when available.
- A centered or strongly weighted masthead reading "Marijuana News"; metadata, page titles, and footer copy can continue using "MarijuanaNews.com Archive" where appropriate.
- A short reform/archive motto below the masthead.
- A simple sticky nav with Archive, Topics, Categories, FAQ, Bio, and RSS.
- Footer with archive preservation statement, sitemap/RSS links, and concise audit/source language.

The header should be unmistakably the publication identity in the first viewport.

### Homepage

The homepage becomes the front page of the restored paper.

Required sections:

- Masthead and nav from the global shell.
- Primary featured article with date, category/topic, source when available, long title, excerpt, and optional legacy image.
- Latest articles feed using two-part rows: left metadata column, right title/excerpt.
- Archive audit sidebar or block with exported article count, topic count, FAQ count, and asset/reference count.
- Public notice block explaining that the site is a non-commercial historical archive preserving public policy records.
- Topic/category chips using black/green editorial rules, not pill-heavy generic tags.

The homepage should show enough of the next section in the first viewport on desktop and mobile. Avoid a landing-page hero that hides the real archive.

### Article Pages

Article pages should prioritize reading.

Required treatment:

- Article header with category/topic/source/date metadata before the title.
- Title in serif display type with generous line height for very long headlines.
- Optional cover image in a restrained monochrome or low-saturation treatment when available.
- Main content in a comfortable reading column.
- Sidebar for article data, keywords, source URL, archive path, and related articles.
- Sidebar should feel like an editorial clipping/reference column rather than an admin panel.

Legacy content must remain readable even when it contains tables, blockquotes, lists, long URLs, or older inline HTML.

### Archive, Topic, And Category Pages

List pages should be dense but not cramped.

Required treatment:

- Newspaper list rows with metadata rail and title/excerpt content.
- Consistent date/category/topic/source hierarchy across archive, topic, and category pages.
- Pagination uses plain editorial controls, not rounded app-style buttons.
- Empty or sparse category/topic pages should still preserve the page shell and explain the absence clearly.

### FAQ And Bio Pages

These pages inherit the same publication shell and typography.

FAQ entries should read like archived explanatory notes. Bio should read as a contributor/curator page, with any image framed plainly and not as a profile-card-heavy layout.

## Components

Implementation should stay lightweight and fit Astro's current file structure.

Core components can be CSS classes in `global.css` unless extracting Astro partials clearly reduces duplication:

- `publication-header`: metadata strip, masthead, motto, nav.
- `front-page-layout`: homepage content plus sidebar.
- `article-row`: list row with metadata rail and content.
- `archive-stat-box`: compact count/audit block.
- `public-notice`: green preservation note.
- `topic-chip-list`: restrained taxonomy links.
- `legacy-content`: existing article body container, restyled for the new system.

Do not add a UI library for this phase. Use native Astro and CSS.

## Data Flow

Use existing helpers from `src/lib/content.ts`:

- `articles`, `categories`, `topics`, `faqs`, and `auditReport` for homepage counts and feeds.
- `articleUrl`, `articleImageUrl`, `excerpt`, and `formatDate` for article cards and rows.
- `articleCategorySlug`, `articleTopicSlug`, `keywords`, and `rewriteLegacyHtml` on article pages.
- `siteMetadata`, `SITE_TITLE`, and `SITE_DESCRIPTION` for page metadata.

All data remains static at build time. The redesign should not introduce client-side state, hydration, or runtime API dependencies.

## Edge Cases

The design must handle:

- Missing image: article rows and featured areas still work without a visual placeholder that looks broken.
- Missing date: keep `formatDate()` behavior and show "Undated".
- Missing category/topic/source: omit absent metadata without leaving dangling separators.
- Very long titles: wrap cleanly and do not overlap neighboring content.
- Long URLs and legacy HTML: preserve `overflow-wrap` and responsive table handling.
- Small screens: metadata rails collapse above content, nav wraps cleanly, and text remains readable.

## Accessibility

Requirements:

- Keep semantic landmarks: header, nav, main, article, aside, footer.
- Preserve skip link behavior.
- Maintain visible focus states for nav, article links, buttons, and pagination.
- Use sufficient color contrast for green accents and muted metadata.
- Do not rely on color alone for metadata grouping.
- Avoid motion or animation beyond basic hover/focus transitions.

## Testing And Verification

Required verification after implementation:

- `npm run build`
- Inspect homepage, article page, archive page, topic/category page, FAQ, and bio in the browser.
- Check desktop and mobile widths.
- Confirm no text overlap, no broken image layout, and no horizontal page overflow.
- Confirm long article titles, missing image cases, and legacy content tables remain usable.
- Confirm RSS, sitemap, canonical metadata, and schema/analytics behavior continue to work.

## Out Of Scope

This design does not include:

- New search behavior.
- New filtering or sorting features.
- New data migration or Wayback recovery work.
- New CMS/editorial workflows.
- New JavaScript framework or client-side app architecture.
- Major content rewriting.

## Acceptance Criteria

The redesign is successful when:

- The first viewport clearly signals MarijuanaNews.com as a restored independent cannabis reform publication.
- The homepage no longer looks like a generic archive template.
- Article and archive pages remain faster and simpler than a modern news app, while feeling intentionally designed.
- Archive metadata increases trust without making the site feel like an admin dashboard.
- The implementation remains static, accessible, and maintainable within the existing Astro project.
