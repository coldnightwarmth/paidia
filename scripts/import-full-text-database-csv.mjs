import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_CSV_PATH =
  "/Users/kyl/Downloads/Private & Shared/Collection 93ca287b325c4e37948a3ef2baf39ae7_all.csv";
const csvPath = process.env.FULL_TEXT_DATABASE_CSV ?? DEFAULT_CSV_PATH;
const outputPath = new URL("../data/full-text-database-books.json", import.meta.url);
const siteIndexPath = new URL("../data/site-index.json", import.meta.url);
const pagesPath = new URL("../data/pages/", import.meta.url);
const outputColumns = [
  { source: "Title", label: "Title" },
  { source: "Creator(s)", label: "Creator(s)" },
  { source: "Tags", label: "Tags" },
  { source: "Publication Year", label: "Released" },
  { source: "OG Publisher", label: "Publisher" },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function cleanTitle(value) {
  return String(value ?? "")
    .replace(/\s*\(https?:\/\/[^)]+\)\s*$/i, "")
    .trim();
}

function extractTitleUrl(value) {
  return String(value ?? "").match(/\((https?:\/\/[^)]+)\)\s*$/i)?.[1] ?? "";
}

function normalizePageId(value) {
  const match = String(value ?? "").match(
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (!match) return "";

  const compact = match[1].replace(/-/g, "").toLowerCase();
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

function normalizeCell(header, value) {
  const text = String(value ?? "").trim();
  return header === "Title" ? cleanTitle(text) : text;
}

async function readPageDetails(pageId) {
  if (!pageId) return null;
  try {
    return JSON.parse(await readFile(new URL(`${pageId}.json`, pagesPath), "utf8"));
  } catch {
    return null;
  }
}

const csv = await readFile(csvPath, "utf8");
const siteIndex = JSON.parse(await readFile(siteIndexPath, "utf8"));
const [headers, ...rawRows] = parseCsv(csv.replace(/^\uFEFF/, ""));
const headerIndexes = new Map(headers.map((header, index) => [header, index]));
const pageById = new Map(siteIndex.pages.map((page) => [page.id, page]));
const pageAliases = new Map(Object.entries(siteIndex.pageAliases ?? {}));
const pageByTitle = new Map();

for (const page of siteIndex.pages) {
  const key = page.title?.trim().toLowerCase();
  if (key && !pageByTitle.has(key)) {
    pageByTitle.set(key, page);
  }
}

function resolveLocalPage(rawTitle) {
  const title = cleanTitle(rawTitle);
  const sourceUrl = extractTitleUrl(rawTitle);
  const pageId = normalizePageId(sourceUrl);
  const aliasId = pageAliases.get(pageId);
  const titleKey = title.toLowerCase();
  const exactPage = pageById.get(pageId);
  const aliasPage = pageById.get(aliasId);
  const titlePage = pageByTitle.get(titleKey);

  if (exactPage && exactPage.title?.trim().toLowerCase() === titleKey) return exactPage;
  if (aliasPage && aliasPage.title?.trim().toLowerCase() === titleKey) return aliasPage;
  if (!sourceUrl && titlePage) return titlePage;

  return null;
}

const rows = [];
const rowMeta = [];

for (const row of rawRows.filter((row) => row.some((cell) => String(cell ?? "").trim()))) {
  const rawTitle = row[headerIndexes.get("Title")];
  const sourceUrl = extractTitleUrl(rawTitle);
  const localPage = resolveLocalPage(rawTitle);
  const pageDetails = await readPageDetails(localPage?.id);
  const href = localPage?.slug ? `#/${localPage.slug}` : sourceUrl;

  rows.push(
    outputColumns.map(({ source, label }) =>
      normalizeCell(label, row[headerIndexes.get(source)]),
    ),
  );

  rowMeta.push({
    href,
    pageId: localPage?.id ?? "",
    cover: pageDetails?.previewImage || pageDetails?.cover || "",
  });
}

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: {
        csvPath,
        sourceRows: rows.length,
      },
      columns: outputColumns.map((column) => column.label),
      rows,
      rowMeta,
    },
    null,
    2,
  )}\n`,
);

console.log(`Imported ${rows.length} rows into ${outputPath.pathname}`);
