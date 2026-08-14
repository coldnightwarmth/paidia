import fs from "node:fs/promises";
import path from "node:path";

const SITE_ORIGIN = "https://paidiasophia.notion.site";
const ROOT_PAGE_ID = "dcdce636-0430-48ea-98c8-b0c6e48368c3";
const DATA_DIR = path.resolve("data");
const RAW_DIR = path.join(DATA_DIR, "notion-raw");
const MANIFEST_PATH = path.join(DATA_DIR, "notion-manifest.json");

function normalizeId(id) {
  if (!id) return "";
  const compact = id.replace(/-/g, "").toLowerCase();
  return compact.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
}

function pageUrl(pageId, origin = SITE_ORIGIN) {
  return `${origin}/${normalizeId(pageId).replace(/-/g, "")}`;
}

function originForSourceUrl(sourceUrl) {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return SITE_ORIGIN;
  }
}

function valueOf(entry) {
  return entry?.value?.value ?? null;
}

function plainText(title) {
  if (!Array.isArray(title)) return "";
  return title.map((part) => part?.[0] ?? "").join("");
}

function slugify(text, fallback) {
  const base = text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || fallback;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeRecordMaps(target, source) {
  for (const [table, records] of Object.entries(source ?? {})) {
    if (!target[table]) {
      target[table] = {};
    }
    if (table === "__version__") {
      target[table] = records;
      continue;
    }
    for (const [id, entry] of Object.entries(records ?? {})) {
      target[table][id] = entry;
    }
  }
}

async function fetchChunk(pageId, cursor, chunkNumber, sourceUrl) {
  const origin = originForSourceUrl(sourceUrl);
  const response = await fetch(`${origin}/api/v3/loadPageChunk`, {
    method: "POST",
    headers: {
      accept: "application/json,*/*",
      "content-type": "application/json",
      origin,
      referer: sourceUrl,
      "user-agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      pageId: normalizeId(pageId),
      limit: 100,
      cursor,
      chunkNumber,
      verticalColumns: false,
    }),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} while fetching ${pageId}`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after") ?? "";
    throw error;
  }

  return response.json();
}

async function hydrateMissingBlockRecords(recordMap, sourceUrl) {
  const blocks = recordMap?.block ?? {};
  const requestsById = new Map();

  for (const entry of Object.values(blocks)) {
    const block = valueOf(entry);
    if (!block) continue;

    for (const childId of block.content ?? []) {
      if (!childId || blocks[childId] || requestsById.has(childId)) continue;
      requestsById.set(childId, {
        pointer: {
          table: "block",
          id: childId,
          spaceId: block.space_id,
        },
        version: -1,
      });
    }
  }

  const requests = [...requestsById.values()];
  if (requests.length === 0) return;

  const origin = originForSourceUrl(sourceUrl);
  const batchSize = 100;

  for (let index = 0; index < requests.length; index += batchSize) {
    const response = await fetch("https://www.notion.so/api/v3/syncRecordValues", {
      method: "POST",
      headers: {
        accept: "application/json,*/*",
        "content-type": "application/json",
        "notion-client-version": "23.13.0.0",
        origin,
        referer: sourceUrl,
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ requests: requests.slice(index, index + batchSize) }),
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} while hydrating nested blocks`);
      error.status = response.status;
      error.retryAfter = response.headers.get("retry-after") ?? "";
      throw error;
    }

    const payload = await response.json();
    mergeRecordMaps(recordMap, payload.recordMap);
  }
}

async function fetchPage(pageId, sourceUrl = pageUrl(pageId)) {
  const merged = { recordMap: {} };
  let cursor = { stack: [] };
  let chunkNumber = 0;
  let guard = 0;

  while (guard < 100) {
    const chunk = await fetchChunk(pageId, cursor, chunkNumber, sourceUrl);
    mergeRecordMaps(merged.recordMap, chunk.recordMap);

    const nextCursor = chunk.cursor?.stack?.length ? chunk.cursor : null;
    if (!nextCursor) break;

    cursor = nextCursor;
    chunkNumber += 1;
    guard += 1;
  }

  if (process.env.NOTION_FETCH_HYDRATE !== "0") {
    await hydrateMissingBlockRecords(merged.recordMap, sourceUrl);
  }

  return {
    fetchedAt: new Date().toISOString(),
    pageId: normalizeId(pageId),
    sourceUrl,
    recordMap: merged.recordMap,
  };
}

function discoverPages(recordMap) {
  const pages = [];
  const blocks = recordMap?.block ?? {};

  for (const [id, entry] of Object.entries(blocks)) {
    const block = valueOf(entry);
    if (!block) continue;

    if (block.type === "page" || block.type === "collection_view_page") {
      pages.push({
        id: normalizeId(id),
        type: block.type,
        title: plainText(block.properties?.title),
        parentId: normalizeId(block.parent_id),
        sourceUrl: pageUrl(id),
      });
    }

    if (block.type === "alias") {
      const targetId = normalizeId(block.format?.alias_pointer?.id);
      if (targetId) {
        pages.push({
          id: targetId,
          type: "alias_target",
          title: "",
          parentId: normalizeId(block.parent_id),
          sourceUrl: pageUrl(targetId),
        });
      }
    }
  }

  return pages;
}

async function main() {
  await ensureDir(RAW_DIR);

  const manifest = await readJson(MANIFEST_PATH, {
    siteOrigin: SITE_ORIGIN,
    rootPageId: ROOT_PAGE_ID,
    pages: {},
    queue: [ROOT_PAGE_ID],
    completed: [],
    failed: [],
  });

  const seen = new Set(manifest.completed.map(normalizeId));
  const forceRefetch = process.env.NOTION_FETCH_FORCE === "1";
  const queued = [...new Set(manifest.queue.map(normalizeId).filter(Boolean))].filter(
    (pageId) => forceRefetch || !seen.has(pageId),
  );
  const fetchOptions = manifest.fetchOptions ?? {};
  const discoverEnabled =
    process.env.NOTION_FETCH_DISCOVER === "1" || fetchOptions.discoverPages !== false;
  const delayMs = Number(process.env.NOTION_FETCH_DELAY_MS ?? fetchOptions.delayMs ?? 0);
  const limit = Number(process.env.NOTION_FETCH_LIMIT ?? fetchOptions.limit ?? 0);
  const stopOnRateLimit = fetchOptions.stopOnRateLimit !== false;
  let processed = 0;

  manifest.queue = queued;
  await writeJson(MANIFEST_PATH, manifest);

  while (queued.length > 0) {
    if (limit > 0 && processed >= limit) {
      manifest.queue = queued;
      await writeJson(MANIFEST_PATH, manifest);
      console.log(`paused after ${processed} page fetch attempts`);
      break;
    }

    const pageId = normalizeId(queued.shift());
    if (!pageId || (!forceRefetch && seen.has(pageId))) continue;

    const rawPath = path.join(RAW_DIR, `${pageId}.json`);

    try {
      const sourceUrl = manifest.pages?.[pageId]?.sourceUrl || pageUrl(pageId);
      const payload = await fetchPage(pageId, sourceUrl);
      await writeJson(rawPath, payload);

      const rootBlock = valueOf(payload.recordMap?.block?.[pageId]);
      const discovered = discoverEnabled ? discoverPages(payload.recordMap) : [];

      manifest.pages[pageId] = {
        id: pageId,
        title: plainText(rootBlock?.properties?.title),
        type: rootBlock?.type ?? "page",
        rawPath: path.relative(DATA_DIR, rawPath),
        sourceUrl: payload.sourceUrl,
        fetchedAt: payload.fetchedAt,
        discoveredPageIds: discovered.map((page) => page.id),
      };
      manifest.failed = manifest.failed.filter((entry) => entry.id !== pageId);

      for (const page of discovered) {
        const existing = manifest.pages[page.id] ?? {};
        manifest.pages[page.id] = {
          ...existing,
          id: page.id,
          title: existing.title || page.title,
          type: existing.type || page.type,
          sourceUrl: existing.sourceUrl || page.sourceUrl,
          parentId: existing.parentId || page.parentId,
          slug: existing.slug || slugify(page.title, page.id.slice(0, 8)),
        };

        if (!seen.has(page.id) && !queued.includes(page.id)) {
          queued.push(page.id);
        }
      }

      manifest.queue = queued;
      manifest.completed = [...new Set([...manifest.completed, pageId])];
      await writeJson(MANIFEST_PATH, manifest);
      console.log(`fetched ${pageId}`);
      seen.add(pageId);
      processed += 1;
    } catch (error) {
      manifest.failed = [
        ...manifest.failed.filter((entry) => entry.id !== pageId),
        {
          id: pageId,
          message: error.message,
          status: error.status ?? null,
          failedAt: new Date().toISOString(),
        },
      ];

      if (error.status === 429 && stopOnRateLimit) {
        queued.unshift(pageId);
        manifest.queue = queued;
        await writeJson(MANIFEST_PATH, manifest);
        console.error(`rate limited ${pageId}: ${error.message}`);
        break;
      }

      manifest.queue = queued;
      await writeJson(MANIFEST_PATH, manifest);
      console.error(`failed ${pageId}: ${error.message}`);
      processed += 1;
    }

    if (delayMs > 0 && queued.length > 0) {
      await sleep(delayMs);
    }
  }

  manifest.queue = queued;
  manifest.completed = [...new Set(manifest.completed.map(normalizeId))];
  await writeJson(MANIFEST_PATH, manifest);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
