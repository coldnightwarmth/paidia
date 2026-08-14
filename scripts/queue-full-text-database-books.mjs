import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const RAW_DIR = path.join(DATA_DIR, "notion-raw");
const FULL_TEXT_DATABASE_PATH = path.join(DATA_DIR, "full-text-database-books.json");
const MANIFEST_PATH = path.join(DATA_DIR, "notion-manifest.json");
const SITE_ORIGIN = "https://paidiasophia.notion.site";
const ROOT_PAGE_ID = "dcdce636-0430-48ea-98c8-b0c6e48368c3";

function normalizeId(value) {
  const match = String(value ?? "").match(
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (!match) return "";

  const compact = match[1].replace(/-/g, "").toLowerCase();
  if (compact.length !== 32) return "";

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNotionUrl(value) {
  try {
    return /(^|\.)notion\.so$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

const database = await readJson(FULL_TEXT_DATABASE_PATH, null);
if (!database) {
  throw new Error(`Missing ${FULL_TEXT_DATABASE_PATH}`);
}

const manifest = await readJson(MANIFEST_PATH, {
  siteOrigin: SITE_ORIGIN,
  rootPageId: ROOT_PAGE_ID,
  pages: {},
  queue: [],
  completed: [],
  failed: [],
});

manifest.siteOrigin ??= SITE_ORIGIN;
manifest.rootPageId ??= ROOT_PAGE_ID;
manifest.pages ??= {};
manifest.queue = Array.isArray(manifest.queue) ? manifest.queue : [];
manifest.completed = Array.isArray(manifest.completed) ? manifest.completed : [];
manifest.failed = Array.isArray(manifest.failed) ? manifest.failed : [];
manifest.fetchOptions = {
  ...(manifest.fetchOptions ?? {}),
  discoverPages: false,
  delayMs: 1200,
  limit: 200,
  stopOnRateLimit: true,
};

const completed = new Set(manifest.completed.map(normalizeId).filter(Boolean));
const queue = new Set(manifest.queue.map(normalizeId).filter(Boolean));
let notionRows = 0;
let queued = 0;
let alreadyFetched = 0;
let alreadyQueued = 0;
let skipped = 0;
const missingSourceRows = [];

for (let index = 0; index < (database.rows ?? []).length; index += 1) {
  const row = database.rows[index] ?? [];
  const metadata = database.rowMeta?.[index] ?? {};
  const href = String(metadata.href ?? "");

  if (href.startsWith("#/")) continue;

  const pageId = normalizeId(href);
  if (!href || !pageId || !isNotionUrl(href)) {
    missingSourceRows.push({ index, title: row[0] ?? "", href });
    skipped += 1;
    continue;
  }

  notionRows += 1;

  const rawPath = path.join(RAW_DIR, `${pageId}.json`);
  const hasRawFile = await fileExists(rawPath);
  const title = String(row[0] ?? "").trim();
  const existing = manifest.pages[pageId] ?? {};

  manifest.pages[pageId] = {
    ...existing,
    id: pageId,
    title: existing.title || title,
    type: existing.type || "page",
    sourceUrl: href,
    slug: existing.slug || slugify(title, pageId.slice(0, 8)),
    fullTextDatabaseRow: index,
  };

  if (hasRawFile) {
    completed.add(pageId);
    queue.delete(pageId);
    alreadyFetched += 1;
    continue;
  }

  if (completed.has(pageId)) {
    completed.delete(pageId);
  }

  if (queue.has(pageId)) {
    alreadyQueued += 1;
  } else {
    queue.add(pageId);
    queued += 1;
  }

  manifest.failed = manifest.failed.filter((entry) => normalizeId(entry.id) !== pageId);
}

manifest.queue = [...queue].filter((pageId) => !completed.has(pageId));
manifest.completed = [...completed];
manifest.fullTextDatabaseBooks = {
  updatedAt: new Date().toISOString(),
  sourceRows: database.rows?.length ?? 0,
  notionRows,
  queued,
  alreadyQueued,
  alreadyFetched,
  skipped,
  missingSourceRows,
};

await writeJson(MANIFEST_PATH, manifest);

console.log(
  JSON.stringify(
    {
      sourceRows: database.rows?.length ?? 0,
      notionRows,
      queued,
      alreadyQueued,
      alreadyFetched,
      skipped,
      queueLength: manifest.queue.length,
    },
    null,
    2,
  ),
);
