# Migration Plan

## Goals

- Preserve the public Notion wiki's page hierarchy, navigation, and content.
- Keep the migration resumable if work stops mid-run.
- Avoid framework dependencies until the content model is stable.

## Working Method

- `scripts/fetch-notion.mjs` crawls public Notion pages and stores raw page payloads in `data/notion-raw/`.
- `scripts/build-site-data.mjs` converts raw Notion payloads into `data/site.json`.
- `index.html`, `src/app.js`, and `src/styles.css` render the current migration state as a local wiki shell.

## Resume Points

- `data/notion-manifest.json` tracks discovered pages and fetch status.
- `data/site.json` is the current normalized output consumed by the local site.
- Additional parser support can be added without refetching already-saved pages.
