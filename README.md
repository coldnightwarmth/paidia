# Paidiasophia

Local static rebuild of the Paidiasophia research wiki.

Live site: https://coldnightwarmth.github.io/paidia/

## Workflow

1. Fetch public Notion content into `data/notion-raw/`.
2. Normalize that data into `data/site.json`.
3. Open `index.html` in a local server and review the current migration state.

## Commands

```bash
npm run fetch:notion
npm run build:data
python3 -m http.server 4173
```

The fetch step depends on public Notion access and is designed to be rerun as the migration expands.

## Homepage and catalogs

The custom homepage lives in `src/home.js`, with supplied artwork in `assets/home/`.
`npm run build:catalogs` rebuilds Games, Other Media, Objects, Images, group pages,
and homepage updates from the saved local source pages. It also runs at the end of
`npm run build:data`. Existing item content and original source lists are preserved.

Games categories are selected with `#/games-549e6748?category=Videogames`
(or `Tabletop`, `Sports`). Groups uses `#/folks-292fe1df?list=Groups`.
Filters stay in the URL for reloads and shared links. List edits are browser-local,
matching the existing database behavior.

The saved source currently contains 32 videogames, 5 tabletop games, 10 sports,
4 other games/toys, and 13 other-media items. The older videogame list's stated
86 items exceeds the available saved records; missing titles are not invented.
Objects and Images start empty. Run `node --test tests/catalog-databases.test.mjs`
to validate catalog links, category tags, group pages, and migration coverage.

## Adding and editing pages

Use `npm run dev` for the local site at http://localhost:4173. It detects page,
collection, and database-row changes and updates the homepage feed automatically.
The homepage displays the saved four-page feed, loaded once per browser session.
There is no polling or update scan when visiting the homepage; source file changes
trigger regeneration in development, and save/build commands regenerate it directly.

To add a page or save a revised page, prepare its JSON (`id`, unique `slug`, `title`,
and `blocks`) and run `npm run page:save -- /path/to/page.json`. This registers the
page in both site indexes, preserves its creation date, records its edit date,
and rebuilds recent updates. Existing JSON pages can also be edited directly.
Catalog membership still comes from the catalog builders and their source lists.

`data/page-revisions.json` stores content hashes and stable update dates; keep it
with the site data. Initial dates use imported edit dates (or file dates for
undated pages). Subsequent content changes and additions get the time detected;
reformatting JSON or rerunning an unchanged build does not advance dates.
`npm run build:updates` refreshes the feed before publishing direct file edits;
data build/import commands also refresh it automatically.

Database edits in the website remain browser-local. Their individual page updates
appear in that browser's homepage feed; they do not publish changes for others.

Each recent update includes a small change note: Page Created, Content Added,
Content Modified, Tags Added/Edited, Title Edited, or Details Edited. Multiple
changes can appear together. Added content means new blocks or previously empty
fields; edits inside existing blocks count as Content Modified. Older revisions
without detailed history use Page Updated rather than guessing a change type.

## Researched game entries

All 51 Games entries have an original two-paragraph introduction, locally stored
WebP cover/thumbnail, source links, and image attribution. Creator/developer,
publisher/manufacturer, first release, and historical origins are stored separately;
traditional sports and games use origin notes instead of invented release dates.
Franchise-like titles identify the original release discussed in their description.

`data/game-enrichment.json` contains the researched additions and image provenance.
`npm run build:catalogs` applies changed enrichment records, preserves existing page
material, and writes the additional Games database columns. An unchanged enrichment
record does not overwrite subsequent edits made directly to the page. Sources and
image credits are available in expandable sections on each game page, including
license links for Wikimedia images. Image files are in `assets/games/`.

Run `node --test tests/*.test.mjs` to check all game descriptions, fact fields,
image assets, links, catalog relationships, and preservation behavior.
