import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.SITE_DATA_DIR ?? "data");
const RAW_DIR = path.join(DATA_DIR, "notion-raw");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const MANIFEST_PATH = path.join(DATA_DIR, "notion-manifest.json");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const SITE_DATA_PATH = path.join(DATA_DIR, "site.json");

const NOTION_ORIGIN = "https://paidiasophia.notion.site";
const NOTION_API_URL = "https://www.notion.so/api/v3/syncRecordValues";
const QUOTES_PAGE_ID = "2b9dc0d1-2d66-4aeb-b050-fb9835b1338a";
const QUOTES_COLLECTION_ID = "9427dd13-de2f-4626-8176-6ac9df6b65c4";
const QUOTES_VIEW_IDS = [
  "297c4e76-1ba8-436f-a4ff-d07ed1adc452",
  "955e81e5-d82c-4282-b426-8f8ffadc88fb",
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function valueOf(entry) {
  return entry?.value?.value ?? null;
}

function plainText(value) {
  if (!Array.isArray(value)) return "";
  return value.map((part) => part?.[0] ?? "").join("").trim();
}

function slugify(value, fallback) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function notionPageUrl(pageId) {
  return `${NOTION_ORIGIN}/${pageId.replace(/-/g, "")}`;
}

function uniqueSlug(baseSlug, pageId, usedSlugs) {
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }

  const suffixed = `${baseSlug.slice(0, 71).replace(/-+$/g, "")}-${pageId.slice(0, 8)}`;
  usedSlugs.add(suffixed);
  return suffixed;
}

async function fetchQuoteRows(rawPage, pageIds) {
  const records = {};
  const spaceId = valueOf(
    rawPage.recordMap?.collection?.[QUOTES_COLLECTION_ID],
  )?.space_id;

  if (!spaceId) throw new Error("The Quotes collection is missing its Notion space ID.");

  for (let index = 0; index < pageIds.length; index += 100) {
    const batch = pageIds.slice(index, index + 100);
    const requests = batch.map((pageId) => ({
      pointer: { table: "block", id: pageId, spaceId },
      version: -1,
    }));
    const response = await fetch(NOTION_API_URL, {
      method: "POST",
      headers: {
        accept: "application/json,*/*",
        "content-type": "application/json",
        "notion-client-version": "23.13.0.0",
        origin: NOTION_ORIGIN,
        referer: rawPage.sourceUrl,
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      throw new Error(`Notion returned HTTP ${response.status} while loading Quotes.`);
    }

    const payload = await response.json();
    Object.assign(records, payload.recordMap?.block ?? {});
  }

  return records;
}

const rawPagePath = path.join(RAW_DIR, `${QUOTES_PAGE_ID}.json`);
const collectionPath = path.join(DATA_DIR, "collections", `${QUOTES_COLLECTION_ID}.json`);
const rawPage = await readJson(rawPagePath);
const collection = await readJson(collectionPath);
const manifest = await readJson(MANIFEST_PATH);
const siteIndex = await readJson(SITE_INDEX_PATH);
const siteData = await readJson(SITE_DATA_PATH);

const requestedPageIds = [
  ...new Set(
    QUOTES_VIEW_IDS.flatMap(
      (viewId) => valueOf(rawPage.recordMap?.collection_view?.[viewId])?.page_sort ?? [],
    ),
  ),
];
const fetchedRecords = await fetchQuoteRows(rawPage, requestedPageIds);
const availablePageIds = requestedPageIds.filter((pageId) => {
  const block = valueOf(fetchedRecords[pageId]);
  return block?.alive !== false && block?.parent_id === QUOTES_COLLECTION_ID;
});
const missingPageIds = requestedPageIds.filter((pageId) => !availablePageIds.includes(pageId));

const existingQuoteIds = new Set(collection.rows?.map((row) => row.id) ?? []);
const existingPageSummaries = new Map(siteIndex.pages.map((page) => [page.id, page]));
const usedSlugs = new Set(
  siteIndex.pages
    .filter((page) => !existingQuoteIds.has(page.id))
    .map((page) => page.slug),
);
const fetchedAt = new Date().toISOString();
const rows = [];
const summaries = [];

for (const pageId of availablePageIds) {
  const entry = fetchedRecords[pageId];
  const block = valueOf(entry);
  const title = plainText(block.properties?.title) || "Untitled quote";
  const existingSummary = existingPageSummaries.get(pageId);
  const slug = uniqueSlug(
    existingSummary?.slug ?? slugify(title, pageId.slice(0, 8)),
    pageId,
    usedSlugs,
  );
  const sourceUrl = notionPageUrl(pageId);
  const summary = {
    id: pageId,
    slug,
    title,
    icon: "💬",
    parentId: QUOTES_COLLECTION_ID,
    parentPageId: QUOTES_PAGE_ID,
    parentTable: "collection",
    type: "page",
  };
  const page = {
    ...summary,
    cover: "",
    collectionId: null,
    viewIds: [],
    sourceUrl,
    createdTime: block.created_time ?? null,
    lastEditedTime: block.last_edited_time ?? null,
    createdById: block.created_by_id ?? null,
    lastEditedById: block.last_edited_by_id ?? null,
    properties: block.properties ?? {},
    previewImage: "",
    blocks: [],
  };
  const row = {
    id: pageId,
    slug,
    title,
    icon: "💬",
    cover: "",
    previewImage: "",
    sourceUrl,
    createdTime: page.createdTime,
    lastEditedTime: page.lastEditedTime,
    properties: page.properties,
  };
  const rawRowPath = path.join(RAW_DIR, `${pageId}.json`);

  await writeJson(path.join(PAGES_DIR, `${pageId}.json`), page);
  await writeJson(rawRowPath, {
    fetchedAt,
    pageId,
    sourceUrl,
    recordMap: { __version__: 1, block: { [pageId]: entry } },
  });

  manifest.pages[pageId] = {
    id: pageId,
    title,
    type: "page",
    rawPath: path.relative(DATA_DIR, rawRowPath),
    sourceUrl,
    fetchedAt,
    discoveredPageIds: [],
    parentId: QUOTES_COLLECTION_ID,
    slug,
  };
  rows.push(row);
  summaries.push(summary);
}

collection.rows = rows;
manifest.completed = [...new Set([...(manifest.completed ?? []), ...availablePageIds])];
manifest.queue = (manifest.queue ?? []).filter((pageId) => !availablePageIds.includes(pageId));
manifest.failed = (manifest.failed ?? []).filter(
  (failure) => !availablePageIds.includes(failure.id),
);

for (const sitePayload of [siteIndex, siteData]) {
  const quoteIdSet = new Set([...existingQuoteIds, ...availablePageIds]);
  sitePayload.pages = [
    ...sitePayload.pages.filter((page) => !quoteIdSet.has(page.id)),
    ...summaries,
  ];
  sitePayload.site.updatedAt = fetchedAt;
}

await Promise.all([
  writeJson(collectionPath, collection),
  writeJson(MANIFEST_PATH, manifest),
  writeJson(SITE_INDEX_PATH, siteIndex),
  writeJson(SITE_DATA_PATH, siteData),
]);

console.log(
  `restored ${rows.length} Quotes rows from Notion${
    missingPageIds.length ? ` (${missingPageIds.length} unavailable historical row IDs skipped)` : ""
  }`,
);
