import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.SITE_DATA_DIR ?? "data");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const OUTPUT_PATH = path.join(DATA_DIR, "folks-database.json");

const LIST_PAGES = [
  {
    id: "be2ab5cc-d3e6-4e79-b87f-a547e6c1f43a",
    label: "Writers & Scholars",
  },
  {
    id: "6da45dd8-3bf9-4ff8-b243-0afe5b8dd2e9",
    label: "Gamedevs & Artists",
  },
  {
    id: "a50c68f8-b751-4c5d-a0a8-e0685c593e63",
    label: "Other People",
  },
];
const GROUPS_PAGE_ID = "f82fec8f-e213-45ea-8eea-ad34adadb59a";
const GROUPS_LABEL = "Groups";

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

function collectListTargets(blocks, targets = []) {
  for (const block of blocks ?? []) {
    if ((block.type === "page_link" || block.type === "alias_link") && block.targetId) {
      targets.push(block.targetId);
    }
    collectListTargets(block.children, targets);
  }
  return targets;
}

function surnameSortValue(value) {
  const name = String(value ?? "").trim();
  const words = name.split(/\s+/).filter(Boolean);
  const suffixPattern = /^(?:jr\.?|sr\.?|ii|iii|iv)$/i;
  while (words.length > 1 && suffixPattern.test(words.at(-1)?.replace(/[,;]+$/, ""))) {
    words.pop();
  }
  return `${words.at(-1)?.replace(/[,;]+$/, "") ?? name} ${name}`;
}

const siteIndex = await readJson(SITE_INDEX_PATH);
const summariesById = new Map(siteIndex.pages.map((page) => [page.id, page]));
const recordsByKey = new Map();

for (const listPage of LIST_PAGES) {
  const page = await readJson(path.join(PAGES_DIR, `${listPage.id}.json`));
  const mainColumns = page.blocks.find((block) => block.type === "columns");
  const targetIds = collectListTargets(mainColumns?.children ?? []);

  for (const targetId of targetIds) {
    const summary = summariesById.get(targetId);
    if (!summary) continue;

    const key = `page:${targetId}`;
    const existing = recordsByKey.get(key) ?? {
      key,
      name: plainText(summary.title),
      lists: [],
      pageId: targetId,
      href: `#/${summary.slug}`,
      icon: summary.icon ?? "👤",
      image: "",
    };
    if (!existing.lists.includes(listPage.label)) existing.lists.push(listPage.label);
    recordsByKey.set(key, existing);
  }
}

const groupsPage = await readJson(path.join(PAGES_DIR, `${GROUPS_PAGE_ID}.json`));
const dividerIndexes = groupsPage.blocks
  .map((block, index) => (block.type === "divider" ? index : -1))
  .filter((index) => index >= 0);
const groupBlocks = groupsPage.blocks.slice(
  (dividerIndexes[0] ?? -1) + 1,
  dividerIndexes[1] ?? groupsPage.blocks.length,
);

for (const block of groupBlocks) {
  if (block.type !== "paragraph") continue;
  const name = plainText(block.html);
  if (!name) continue;
  const key = `group:${name.toLocaleLowerCase()}`;
  recordsByKey.set(key, {
    key,
    name,
    lists: [GROUPS_LABEL],
    pageId: null,
    href: "",
    icon: "👥",
    image: "",
  });
}

for (const record of recordsByKey.values()) {
  if (!record.pageId) continue;
  const page = await readJson(path.join(PAGES_DIR, `${record.pageId}.json`));
  record.image = page.previewImage || page.cover || "";
  record.icon = page.icon || record.icon;
}

const records = [...recordsByKey.values()].sort((left, right) =>
  surnameSortValue(left.name).localeCompare(surnameSortValue(right.name), undefined, {
    numeric: true,
    sensitivity: "base",
  }),
);

const payload = {
  columns: ["Name", "List"],
  rows: records.map((record) => [record.name, record.lists.join(", ")]),
  rowMeta: records.map((record) => ({
    key: record.key,
    pageId: record.pageId,
    href: record.href,
    icon: record.icon,
    image: record.image,
  })),
  lists: [...LIST_PAGES.map((page) => page.label), GROUPS_LABEL],
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  `built ${records.length} Folks records (${records.filter((record) => record.pageId).length} pages, ${records.filter((record) => !record.pageId).length} groups)`,
);
