import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.resolve(".");
const DATA_DIR = path.join(ROOT_DIR, "data");
const RAW_DIR = path.join(DATA_DIR, "notion-raw");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const DATABASE_PATH = path.join(DATA_DIR, "shortform-database.json");
const MANIFEST_PATH = path.join(DATA_DIR, "document-asset-manifest.json");
const DOCUMENTS_DIR = path.join(ROOT_DIR, "assets", "documents");
const LOCAL_DOCUMENT_PREFIX = "./assets/documents";
const NOTION_ORIGIN = "https://paidiasophia.notion.site";
const SIGN_BATCH_SIZE = 40;
const DOWNLOAD_CONCURRENCY = 4;

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function valueOf(entry) {
  return entry?.value?.value ?? null;
}

function slugify(text, fallback = "document") {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function rawFileBlocks(raw) {
  return Object.entries(raw?.recordMap?.block ?? {})
    .map(([id, entry]) => ({ id, block: valueOf(entry) }))
    .filter(({ block }) => block && (block.type === "pdf" || block.type === "file"));
}

async function signFileUrls(entries) {
  const signedUrls = [];
  for (let index = 0; index < entries.length; index += SIGN_BATCH_SIZE) {
    const batch = entries.slice(index, index + SIGN_BATCH_SIZE);
    const response = await fetch("https://www.notion.so/api/v3/getSignedFileUrls", {
      method: "POST",
      headers: {
        accept: "application/json,*/*",
        "content-type": "application/json",
        origin: NOTION_ORIGIN,
        referer: `${NOTION_ORIGIN}/`,
        "user-agent": "PaidiasophiaDocumentSync/1.0",
      },
      body: JSON.stringify({
        urls: batch.map((entry) => ({
          permissionRecord: { table: "block", id: entry.blockId },
          url: entry.sourceUrl,
        })),
      }),
    });
    if (!response.ok) throw new Error(`Notion file signing failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.signedUrls) || payload.signedUrls.length !== batch.length) {
      throw new Error("Notion returned an incomplete set of signed document URLs.");
    }
    signedUrls.push(...payload.signedUrls);
  }
  return signedUrls;
}

async function runPool(items, worker, concurrency = DOWNLOAD_CONCURRENCY) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const itemIndex = nextIndex;
        nextIndex += 1;
        await worker(items[itemIndex], itemIndex);
      }
    },
  );
  await Promise.all(workers);
}

function rewriteDocumentBlocks(blocks, localPath) {
  for (const block of blocks ?? []) {
    if (block.type === "file" && (block.kind === "pdf" || block.kind === "file")) {
      block.src = localPath;
      block.downloadName = block.title || "document.pdf";
    }
    if (Array.isArray(block.children)) rewriteDocumentBlocks(block.children, localPath);
  }
}

await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
const database = await readJson(DATABASE_PATH);
if (!database) throw new Error("Build the Shortform Texts database before syncing documents.");
const previousManifest = await readJson(MANIFEST_PATH, { documents: {} });
const manifestDocuments = previousManifest.documents ?? {};
const entries = [];

for (const metadata of database.rowMeta ?? []) {
  if (!metadata?.pageId) continue;
  const raw = await readJson(path.join(RAW_DIR, `${metadata.pageId}.json`));
  const fileBlocks = rawFileBlocks(raw);
  const source = fileBlocks.find(({ block }) => block.type === "pdf") ?? fileBlocks[0];
  const sourceUrl = source?.block?.properties?.source?.[0]?.[0] ?? "";
  if (!source || !sourceUrl) continue;

  const page = await readJson(path.join(PAGES_DIR, `${metadata.pageId}.json`));
  const fileName = `${slugify(page?.title, metadata.pageId)}-${shortHash(sourceUrl)}.pdf`;
  const localPath = `${LOCAL_DOCUMENT_PREFIX}/${fileName}`;
  entries.push({
    pageId: metadata.pageId,
    page,
    blockId: source.id,
    sourceUrl,
    fileName,
    localPath,
    absolutePath: path.join(DOCUMENTS_DIR, fileName),
  });
}

const toDownload = [];
let reused = 0;
for (const entry of entries) {
  const previous = manifestDocuments[entry.pageId];
  if (
    previous?.sourceUrl === entry.sourceUrl &&
    previous?.localPath === entry.localPath &&
    (await fileExists(entry.absolutePath))
  ) {
    reused += 1;
  } else {
    toDownload.push(entry);
  }
}

if (toDownload.length > 0) {
  const signedUrls = await signFileUrls(toDownload);
  await runPool(toDownload, async (entry, index) => {
    const response = await fetch(signedUrls[index], {
      headers: { accept: "application/pdf,*/*", "user-agent": "PaidiasophiaDocumentSync/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${entry.pageId}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error(`Notion did not return a PDF for ${entry.pageId}`);
    }
    await fs.writeFile(entry.absolutePath, buffer);
    manifestDocuments[entry.pageId] = {
      sourceUrl: entry.sourceUrl,
      sourceBlockId: entry.blockId,
      localPath: entry.localPath,
      fileName: entry.fileName,
      bytes: buffer.byteLength,
      sha256: sha256(buffer),
      fetchedAt: new Date().toISOString(),
    };
    const completed = index + 1;
    if (completed % 20 === 0 || completed === toDownload.length) {
      console.log(`downloaded ${completed}/${toDownload.length} PDFs`);
    }
  });
}

for (const entry of entries) {
  rewriteDocumentBlocks(entry.page?.blocks, entry.localPath);
  await writeJson(path.join(PAGES_DIR, `${entry.pageId}.json`), entry.page);
}

await writeJson(MANIFEST_PATH, {
  generatedAt: new Date().toISOString(),
  summary: {
    shortformPages: database.rowMeta?.length ?? 0,
    pagesWithSourcePdf: entries.length,
    downloaded: toDownload.length,
    reused,
  },
  documents: manifestDocuments,
});

console.log(
  `synced ${entries.length} Shortform PDFs (${toDownload.length} downloaded, ${reused} reused)`,
);
