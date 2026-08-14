import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT_DIR = path.resolve(".");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const COLLECTIONS_DIR = path.join(DATA_DIR, "collections");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const SITE_DATA_PATH = path.join(DATA_DIR, "site.json");
const MANIFEST_PATH = path.join(DATA_DIR, "asset-manifest.json");
const ASSETS_DIR = path.join(ROOT_DIR, "assets", "images");
const LOCAL_ASSET_PREFIX = "./assets/images";
const CONCURRENCY = 8;

function isRemoteUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function slugify(text, fallback = "image") {
  const base = String(text ?? "")
    .toLowerCase()
    .replace(/%[0-9a-f]{2}/gi, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || fallback;
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function fileStemForUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1) ?? "";
    const stem = lastSegment.replace(/\.[a-z0-9]+$/i, "");

    if (stem && stem !== "image") return slugify(stem, "image");

    const nestedMatch = pathname.match(/https?%3A%2F%2F([^?]+)/i);
    if (nestedMatch) {
      const nestedStem = decodeURIComponent(nestedMatch[1]).split("/").at(-1) ?? "";
      return slugify(nestedStem.replace(/\.[a-z0-9]+$/i, ""), "image");
    }
  } catch {}

  return "image";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function collectImageUrls(node, refs = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectImageUrls(item, refs);
    return refs;
  }

  if (!node || typeof node !== "object") {
    return refs;
  }

  if (isRemoteUrl(node.icon)) refs.add(node.icon);
  if (isRemoteUrl(node.cover)) refs.add(node.cover);
  if (isRemoteUrl(node.previewImage)) refs.add(node.previewImage);
  if (node.type === "image" && isRemoteUrl(node.src)) refs.add(node.src);

  for (const value of Object.values(node)) {
    collectImageUrls(value, refs);
  }

  return refs;
}

function rewriteImageRefs(node, assetMap) {
  if (Array.isArray(node)) {
    node.forEach((item) => rewriteImageRefs(item, assetMap));
    return node;
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  if (isRemoteUrl(node.icon) && assetMap[node.icon]?.localPath) {
    node.icon = assetMap[node.icon].localPath;
  }
  if (isRemoteUrl(node.cover) && assetMap[node.cover]?.localPath) {
    node.cover = assetMap[node.cover].localPath;
  }
  if (isRemoteUrl(node.previewImage) && assetMap[node.previewImage]?.localPath) {
    node.previewImage = assetMap[node.previewImage].localPath;
  }
  if (node.type === "image" && isRemoteUrl(node.src) && assetMap[node.src]?.localPath) {
    node.src = assetMap[node.src].localPath;
  }

  for (const value of Object.values(node)) {
    rewriteImageRefs(value, assetMap);
  }

  return node;
}

function isGifAssetEntry(asset) {
  return /\.(gif)(?:$|[?&])/i.test(asset?.originalUrl ?? "");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function loadManifest() {
  try {
    const manifest = await readJson(MANIFEST_PATH);
    return manifest && typeof manifest === "object" ? manifest : { assets: {} };
  } catch {
    return { assets: {} };
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchAndConvertImage(url, manifestEntry) {
  const stem = fileStemForUrl(url);
  const hash = shortHash(url);
  const fileName = `${stem}-${hash}.webp`;
  const relativePath = `${LOCAL_ASSET_PREFIX}/${fileName}`;
  const absolutePath = path.join(ASSETS_DIR, fileName);

  if (manifestEntry?.localPath === relativePath && (await fileExists(absolutePath))) {
    return manifestEntry;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "PaidiasophiaAssetSync/1.0",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const pipeline = sharp(sourceBuffer, {
    animated: true,
    failOn: "none",
    limitInputPixels: false,
  }).rotate();

  const metadata = await pipeline.metadata();
  await pipeline.webp({ quality: 84, effort: 5 }).toFile(absolutePath);

  return {
    originalUrl: url,
    localPath: relativePath,
    fileName,
    contentType,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    pages: metadata.pages ?? 1,
    hasAlpha: metadata.hasAlpha ?? false,
    fetchedAt: new Date().toISOString(),
    originalBytes: sourceBuffer.byteLength,
  };
}

async function runPool(items, worker, concurrency = CONCURRENCY) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

async function collectJsonFiles(dirPath) {
  const names = (await fs.readdir(dirPath)).filter((name) => name.endsWith(".json")).sort();
  return names.map((name) => path.join(dirPath, name));
}

async function main() {
  await ensureDir(ASSETS_DIR);

  const siteIndex = await readJson(SITE_INDEX_PATH);
  const siteData = await readJson(SITE_DATA_PATH);
  const pageFiles = await collectJsonFiles(PAGES_DIR);
  const collectionFiles = await collectJsonFiles(COLLECTIONS_DIR);
  const manifest = await loadManifest();
  const assetMap = manifest.assets ?? {};

  const pages = await Promise.all(pageFiles.map((filePath) => readJson(filePath)));
  const collections = await Promise.all(collectionFiles.map((filePath) => readJson(filePath)));

  const refs = new Set();
  collectImageUrls(siteIndex, refs);
  collectImageUrls(siteData, refs);
  pages.forEach((page) => collectImageUrls(page, refs));
  collections.forEach((collection) => collectImageUrls(collection, refs));

  const urls = [...refs].sort();
  let downloaded = 0;
  let reused = 0;
  const failures = [];

  await runPool(urls, async (url) => {
    try {
      const before = assetMap[url];
      const entry = await fetchAndConvertImage(url, before);
      assetMap[url] = entry;
      if (before?.localPath === entry.localPath) {
        reused += 1;
      } else {
        downloaded += 1;
      }
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  rewriteImageRefs(siteIndex, assetMap);
  rewriteImageRefs(siteData, assetMap);
  pages.forEach((page) => rewriteImageRefs(page, assetMap));
  collections.forEach((collection) => rewriteImageRefs(collection, assetMap));

  const gifAssets = Object.values(assetMap)
    .filter((asset) => asset?.localPath && isGifAssetEntry(asset))
    .map((asset) => asset.localPath)
    .sort();

  siteIndex.gifAssets = gifAssets;
  siteData.gifAssets = gifAssets;

  await writeJson(SITE_INDEX_PATH, siteIndex);
  await writeJson(SITE_DATA_PATH, siteData);
  await Promise.all(pages.map((page, index) => writeJson(pageFiles[index], page)));
  await Promise.all(
    collections.map((collection, index) => writeJson(collectionFiles[index], collection)),
  );

  const nextManifest = {
    generatedAt: new Date().toISOString(),
    summary: {
      remoteImageRefs: urls.length,
      syncedAssets: Object.keys(assetMap).length,
      downloaded,
      reused,
      failed: failures.length,
    },
    failures,
    assets: assetMap,
  };

  await writeJson(MANIFEST_PATH, nextManifest);

  console.log(
    JSON.stringify(
      {
        remoteImageRefs: urls.length,
        downloaded,
        reused,
        failed: failures.length,
      },
      null,
      2,
    ),
  );
}

await main();
