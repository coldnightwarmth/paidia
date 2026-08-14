import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const SITE_DATA_PATH = path.join(DATA_DIR, "site.json");
const FULL_TEXT_DATABASE_PATH = path.join(DATA_DIR, "full-text-database-books.json");
const FULL_TEXT_DATABASE_PAGE_ID = "8b00db95-6902-4675-93fb-bd8023cf5614";
const BOOK_ICON = "./assets/images/book-closed-gray-ceb7ed0bbf9f.webp";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(text, fallback) {
  const base = String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function uniqueSlug(baseSlug, existingSlugs) {
  let candidate = baseSlug;
  let suffix = 2;

  while (existingSlugs.has(candidate)) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  existingSlugs.add(candidate);
  return candidate;
}

function metadataLine(row) {
  const [title, creators, tags, released, publisher] = row;
  const pieces = [];

  if (title) pieces.push(`<strong>${escapeHtml(title)}</strong>`);
  if (creators) pieces.push(`by ${escapeHtml(creators)}`);
  if (publisher || released) {
    pieces.push(
      [publisher && escapeHtml(publisher), released && escapeHtml(released)]
        .filter(Boolean)
        .join(", "),
    );
  }

  const sentence = pieces.filter(Boolean).join(", ");
  return sentence ? `${sentence}.` : "";
}

function createFallbackPage({ row, rowIndex, id, slug, sourceUrl }) {
  const [title, creators, tags, released, publisher] = row;
  const blocks = [
    {
      id: `${id}-divider`,
      type: "divider",
    },
    {
      id: `${id}-metadata`,
      type: "paragraph",
      html: metadataLine(row),
    },
  ];

  if (tags) {
    blocks.push({
      id: `${id}-tags`,
      type: "paragraph",
      html: `<em>Tags:</em> ${escapeHtml(tags)}`,
    });
  }

  blocks.push({
    id: `${id}-note`,
    type: "callout",
    html: sourceUrl
      ? "The Notion URL attached to this spreadsheet row did not return a usable page payload, so this local page was generated from the Full Text Database CSV metadata."
      : "This spreadsheet row did not include a Notion source URL, so this local page was generated from the Full Text Database CSV metadata.",
    icon: "🗃️",
    children: [],
  });

  return {
    id,
    slug,
    title,
    icon: BOOK_ICON,
    cover: "",
    type: "page",
    parentId: FULL_TEXT_DATABASE_PAGE_ID,
    parentTable: "block",
    collectionId: null,
    viewIds: [],
    sourceUrl,
    createdTime: null,
    lastEditedTime: null,
    createdById: null,
    lastEditedById: null,
    properties: {
      "Bjg@": [["Book"]],
      title: [[title]],
      "Full Text Database Row": [[String(rowIndex + 1)]],
      "Creator(s)": creators ? [[creators]] : [],
      Tags: tags ? [[tags]] : [],
      Released: released ? [[released]] : [],
      Publisher: publisher ? [[publisher]] : [],
    },
    previewImage: "",
    blocks,
  };
}

const database = await readJson(FULL_TEXT_DATABASE_PATH);
const siteIndex = await readJson(SITE_INDEX_PATH);
const siteData = await readJson(SITE_DATA_PATH);
const existingIds = new Set(siteIndex.pages.map((page) => page.id));
const existingSlugs = new Set(siteIndex.pages.map((page) => page.slug));
const pageById = new Map(siteIndex.pages.map((page) => [page.id, page]));
const fallbackRows = [];

for (let rowIndex = 0; rowIndex < (database.rows ?? []).length; rowIndex += 1) {
  const metadata = database.rowMeta?.[rowIndex] ?? {};
  const href = String(metadata.href ?? "");
  if (href.startsWith("#/")) continue;

  fallbackRows.push({ rowIndex, row: database.rows[rowIndex], sourceUrl: href });
}

for (const fallback of fallbackRows) {
  const title = String(fallback.row?.[0] ?? "").trim() || `Untitled Row ${fallback.rowIndex + 1}`;
  const id = `full-text-${fallback.rowIndex + 1}-${slugify(title, "book")}`;
  const existingSummary = pageById.get(id);
  const slug = existingSummary?.slug ?? uniqueSlug(slugify(title, id), existingSlugs);
  const page = createFallbackPage({
    ...fallback,
    id,
    slug,
    row: [title, ...(fallback.row ?? []).slice(1)],
  });
  const summary = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentId: page.parentId,
    parentTable: page.parentTable,
    type: page.type,
  };
  const existingIndex = siteIndex.pages.findIndex((entry) => entry.id === page.id);

  if (existingIndex >= 0) {
    siteIndex.pages[existingIndex] = summary;
  } else {
    siteIndex.pages.push(summary);
  }

  const existingSiteDataIndex = siteData.pages.findIndex((entry) => entry.id === page.id);
  if (existingSiteDataIndex >= 0) {
    siteData.pages[existingSiteDataIndex] = summary;
  } else {
    siteData.pages.push(summary);
  }

  existingIds.add(page.id);
  pageById.set(page.id, summary);

  await writeJson(path.join(PAGES_DIR, `${page.id}.json`), page);

  database.rowMeta[fallback.rowIndex] = {
    href: `#/${page.slug}`,
    pageId: page.id,
    cover: "",
  };
}

siteIndex.site.updatedAt = new Date().toISOString();
siteData.site.updatedAt = siteIndex.site.updatedAt;

await writeJson(SITE_INDEX_PATH, siteIndex);
await writeJson(SITE_DATA_PATH, siteData);
await writeJson(FULL_TEXT_DATABASE_PATH, database);

console.log(
  JSON.stringify(
    {
      fallbackPages: fallbackRows.length,
      rows: fallbackRows.map((row) => ({
        rowIndex: row.rowIndex,
        title: row.row?.[0] ?? "",
      })),
    },
    null,
    2,
  ),
);
