import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.SITE_DATA_DIR ?? "data");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const OUTPUT_PATH = path.join(DATA_DIR, "shortform-database.json");
const SHORTFORM_DATABASE_PAGE_ID = "50eae52d-e10e-4677-a195-6f45f609aa5d";

const ESSAYS_PAGE_ID = "71160b13-261c-43b4-9e7a-80771fb8debc";
const POEMS_AND_STORIES_PAGE_ID = "f7a6ae5b-b1de-47e8-a0d3-7551c3a5399f";
const ESSAY_TYPE = "Essay / Article / Blogpost";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function plainText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSortValue(value) {
  const title = String(value ?? "").trim();
  return title.replace(/^the\b(?:\s+|[,:-]\s*)?/i, "").trim() || title;
}

function crispNotionIconSource(icon) {
  const source = String(icon ?? "");
  const rasterIconMappings = [
    [/\/document-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/document_gray.svg"],
    [/\/document-yellow-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/document_yellow.svg"],
    [/\/book-closed-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/book-closed_gray.svg"],
    [/\/bookmark-outline-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/bookmark_gray.svg"],
  ];

  return rasterIconMappings.find(([pattern]) => pattern.test(source))?.[1] ?? source;
}

function addRecord(recordsByPageId, summary, type, theme = "") {
  if (!summary) return;
  const existing = recordsByPageId.get(summary.id) ?? {
    pageId: summary.id,
    title: plainText(summary.title),
    creators: "",
    types: [],
    themes: [],
    href: `#/${summary.slug}`,
    icon: crispNotionIconSource(summary.icon) || "📄",
    image: "",
  };
  if (type && !existing.types.includes(type)) existing.types.push(type);
  if (theme && !existing.themes.includes(theme)) existing.themes.push(theme);
  recordsByPageId.set(summary.id, existing);
}

function introCreator(page) {
  const dividerIndex = page.blocks.findIndex((block) => block.type === "divider");
  const introBlocks = page.blocks.slice(0, dividerIndex >= 0 ? dividerIndex : 4);
  for (const block of introBlocks) {
    if (block.type !== "paragraph") continue;
    const text = plainText(block.html);
    const match = text.match(/^(?:written\s+)?by\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return "";
}

const siteIndex = await readJson(SITE_INDEX_PATH);
const summariesById = new Map(siteIndex.pages.map((page) => [page.id, page]));
const recordsByPageId = new Map();

const essaysPage = await readJson(path.join(PAGES_DIR, `${ESSAYS_PAGE_ID}.json`));
for (const block of essaysPage.blocks) {
  if (block.type !== "toggle") continue;
  const theme = plainText(block.html).replace(/\s*\[\d+\]\s*$/, "");
  for (const child of block.children ?? []) {
    if (child.type !== "page_link" && child.type !== "alias_link") continue;
    addRecord(recordsByPageId, summariesById.get(child.targetId), ESSAY_TYPE, theme);
  }
}

const poemsAndStoriesPage = await readJson(
  path.join(PAGES_DIR, `${POEMS_AND_STORIES_PAGE_ID}.json`),
);
for (const block of poemsAndStoriesPage.blocks) {
  if (block.type !== "toggle") continue;
  const sectionLabel = plainText(block.html).replace(/\s*\[\d+\]\s*$/, "");
  const type = /^short stories$/i.test(sectionLabel) ? "Short Story" : "Poetry";
  for (const child of block.children ?? []) {
    if (child.type !== "page_link" && child.type !== "alias_link") continue;
    addRecord(recordsByPageId, summariesById.get(child.targetId), type);
  }
}

for (const record of recordsByPageId.values()) {
  const page = await readJson(path.join(PAGES_DIR, `${record.pageId}.json`));
  page.parentPageId = SHORTFORM_DATABASE_PAGE_ID;
  await fs.writeFile(
    path.join(PAGES_DIR, `${record.pageId}.json`),
    `${JSON.stringify(page, null, 2)}\n`,
    "utf8",
  );
  const summary = summariesById.get(record.pageId);
  if (summary) summary.parentPageId = SHORTFORM_DATABASE_PAGE_ID;
  record.creators = introCreator(page);
  record.image = page.previewImage || page.cover || "";
  record.icon = crispNotionIconSource(page.icon || record.icon);
}

const records = [...recordsByPageId.values()].sort((left, right) =>
  titleSortValue(left.title).localeCompare(titleSortValue(right.title), undefined, {
    numeric: true,
    sensitivity: "base",
  }),
);

const payload = {
  columns: ["Title", "Creator(s)", "Type", "Theme"],
  rows: records.map((record) => [
    record.title,
    record.creators,
    record.types.join(", "),
    record.themes.join(", "),
  ]),
  rowMeta: records.map((record) => ({
    pageId: record.pageId,
    href: record.href,
    icon: record.icon,
    image: record.image,
  })),
  types: [ESSAY_TYPE, "Poetry", "Short Story"],
  themes: [
    ...new Set(records.flatMap((record) => record.themes)),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await fs.writeFile(SITE_INDEX_PATH, `${JSON.stringify(siteIndex, null, 2)}\n`, "utf8");
console.log(
  `built ${records.length} Shortform Texts records (${records.filter((record) => record.types.includes(ESSAY_TYPE)).length} essays/articles/blogposts, ${records.filter((record) => record.types.includes("Poetry")).length} poems, ${records.filter((record) => record.types.includes("Short Story")).length} short stories)`,
);
