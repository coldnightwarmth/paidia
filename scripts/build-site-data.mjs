import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.SITE_DATA_DIR ?? "data");
const RAW_DIR = path.join(DATA_DIR, "notion-raw");
const MANIFEST_PATH = path.join(DATA_DIR, "notion-manifest.json");
const SITE_INDEX_PATH = path.join(DATA_DIR, "site-index.json");
const SITE_DATA_PATH = path.join(DATA_DIR, "site.json");
const PAGES_DIR = path.join(DATA_DIR, "pages");
const COLLECTIONS_DIR = path.join(DATA_DIR, "collections");
const COUNTED_DIRECTORY_PAGE_IDS = new Set([
  "f7a6ae5b-b1de-47e8-a0d3-7551c3a5399f",
  "71160b13-261c-43b4-9e7a-80771fb8debc",
]);

function valueOf(entry) {
  return entry?.value?.value ?? null;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainText(title) {
  if (!Array.isArray(title)) return "";
  return title.map((part) => part?.[0] ?? "").join("");
}

function richTextToHtml(title) {
  if (!Array.isArray(title)) return "";

  return title
    .map((part) => {
      const text = escapeHtml(part?.[0] ?? "").replace(/\n/g, "<br>");
      const annotations = Array.isArray(part?.[1]) ? part[1] : [];

      return annotations.reduce((html, annotation) => {
        const [kind, value] = annotation;

        if (kind === "a" && value) {
          return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${html}</a>`;
        }
        if (kind === "b") return `<strong>${html}</strong>`;
        if (kind === "i") return `<em>${html}</em>`;
        if (kind === "s") return `<s>${html}</s>`;
        if (kind === "c") return `<code>${html}</code>`;
        if (kind === "u" || kind === "_") return `<u>${html}</u>`;
        return html;
      }, text);
    })
    .join("");
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

function normalizePageId(value) {
  const match = String(value ?? "").match(
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (!match) return null;

  const compact = match[1].replace(/-/g, "").toLowerCase();
  if (compact.length !== 32) return null;

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

function routeForPage(pageId, pageIndex) {
  const page = pageIndex[pageId];
  return page ? `#/${page.slug}` : null;
}

function rewriteHtmlLinks(html, pageIndex) {
  if (!html) return "";

  return String(html).replace(
    /<a\b([^>]*?)href="([^"]+)"([^>]*)>/gi,
    (match, beforeHref, href, afterHref) => {
      const pageId = normalizePageId(href);
      const localRoute = pageId ? routeForPage(pageId, pageIndex) : null;
      if (!localRoute) return match;

      const attrs = `${beforeHref} ${afterHref}`
        .replace(/\bhref="[^"]*"/gi, "")
        .replace(/\btarget="[^"]*"/gi, "")
        .replace(/\brel="[^"]*"/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      return attrs
        ? `<a ${attrs} href="${escapeHtml(localRoute)}">`
        : `<a href="${escapeHtml(localRoute)}">`;
    },
  );
}

function normalizeIcon(icon, options = {}) {
  if (!icon) return "";
  return normalizeAssetUrl(icon, options);
}

function isNotionHostedFile(url) {
  try {
    const parsed = new URL(url);
    if (parsed.host === "prod-files-secure.s3.us-west-2.amazonaws.com") return true;
    if (parsed.host === "s3-us-west-2.amazonaws.com") {
      return parsed.pathname.startsWith("/secure.notion-static.com/");
    }
    return false;
  } catch {
    return false;
  }
}

function notionImageUrl(source, { blockId, spaceId, width = 2000 } = {}) {
  if (!source) return "";
  const url = new URL(`https://www.notion.so/image/${encodeURIComponent(source)}`);
  url.searchParams.set("table", "block");
  if (blockId) url.searchParams.set("id", blockId);
  if (spaceId) url.searchParams.set("spaceId", spaceId);
  url.searchParams.set("width", String(width));
  url.searchParams.set("cache", "v2");
  return url.toString();
}

function normalizeAssetUrl(source, options = {}) {
  if (!source) return "";
  if (source.startsWith("/")) return `https://www.notion.so${source}`;
  if (isNotionHostedFile(source)) {
    return notionImageUrl(source, options);
  }
  return source;
}

function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item.value ?? null;
        return null;
      })
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return value.value ?? null;
  }

  return value ?? null;
}

function extractSource(block, options = {}) {
  return normalizeAssetUrl(
    block.format?.display_source ??
    block.properties?.link?.[0]?.[0] ??
    block.properties?.source?.[0]?.[0] ??
    block.properties?.caption?.[0]?.[0] ??
    "",
    {
      blockId: block.id ?? options.blockId ?? null,
      spaceId: block.space_id ?? options.spaceId ?? null,
      width: options.width ?? 2000,
    },
  );
}

function createAnchorId(text, usedAnchors) {
  const base = slugify(text, "section");
  let candidate = base;
  let suffix = 2;

  while (usedAnchors.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  usedAnchors.add(candidate);
  return candidate;
}

function normalizeSchema(schema = {}) {
  return Object.fromEntries(
    Object.entries(schema).map(([propertyId, property]) => [
      propertyId,
      {
        id: propertyId,
        name: property.name ?? propertyId,
        type: property.type ?? "text",
        icon: property.icon ?? "",
        default: property.default ?? null,
        dateFormat: property.date_format ?? null,
        timeFormat: property.time_format ?? null,
        verifierProperty: property.verifier_property ?? null,
        options: (property.options ?? []).map((option) => ({
          id: option.id ?? option.value ?? "",
          value: option.value ?? "",
          color: option.color ?? "default",
        })),
      },
    ]),
  );
}

function normalizePropertyList(list = []) {
  return list
    .map((item) => ({
      property: item.property ?? null,
      visible: item.visible !== false,
      width: item.width ?? null,
    }))
    .filter((item) => item.property);
}

function normalizePropertyFilters(filters = []) {
  return filters
    .map((entry) => {
      const property = entry.filter?.property ?? null;
      const filter = entry.filter?.filter ?? {};

      return {
        id: entry.id ?? null,
        property,
        operator: filter.operator ?? null,
        value: normalizeFilterValue(filter.value),
      };
    })
    .filter((filter) => filter.property && filter.operator);
}

function normalizeBoardColumns(columns = []) {
  return columns.map((column) => ({
    property: column.property ?? null,
    hidden: Boolean(column.hidden),
    valueType: column.value?.type ?? null,
    option: column.value?.value?.option ?? null,
  }));
}

function normalizeCollectionView(view) {
  const format = view.format ?? {};

  return {
    id: view.id,
    collectionId: format.collection_pointer?.id ?? null,
    type: view.type ?? "table",
    name: view.name ?? "",
    pagePointerId: format.page_pointer?.id ?? null,
    pageSort: Array.isArray(view.page_sort) ? view.page_sort : [],
    propertyFilters: normalizePropertyFilters(format.property_filters),
    tableProperties: normalizePropertyList(format.table_properties),
    galleryProperties: normalizePropertyList(format.gallery_properties),
    listProperties: normalizePropertyList(format.list_properties),
    boardColumns: normalizeBoardColumns(format.board_columns),
    boardColumnsBy: format.board_columns_by
      ? {
          property: format.board_columns_by.property ?? null,
          type: format.board_columns_by.type ?? null,
          sortType: format.board_columns_by.sort?.type ?? null,
        }
      : null,
    galleryCover: format.gallery_cover?.type ?? null,
    galleryCoverSize: format.gallery_cover_size ?? null,
    galleryCoverAspect: format.gallery_cover_aspect ?? null,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function resetDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}

function normalizeChildren(childIds, context, trail) {
  return childIds
    .map((childId) => normalizeBlockTree(childId, context, trail))
    .filter(Boolean);
}

function normalizeTableBlock(block, context, trail) {
  const columnOrder = block.format?.table_block_column_order ?? [];
  const columnFormat = block.format?.table_block_column_format ?? {};

  const rows = (block.content ?? [])
    .map((rowId) => valueOf(context.blocks?.[rowId]))
    .filter((row) => row?.type === "table_row")
    .map((row) => {
      const columns = columnOrder.length > 0 ? columnOrder : Object.keys(row.properties ?? {});
      return {
        id: row.id,
        cells: columns.map((columnId) => ({
          columnId,
          html: richTextToHtml(row.properties?.[columnId]),
          text: plainText(row.properties?.[columnId]),
        })),
      };
    });

  return {
    id: block.id,
    type: "table",
    columns: columnOrder.map((columnId) => ({
      id: columnId,
      width: columnFormat[columnId]?.width ?? null,
    })),
    rows,
    hasRowHeader: Boolean(block.format?.table_block_row_header),
    hasColumnHeader: Boolean(block.format?.table_block_column_header),
  };
}

function normalizeSyncedChildren(targetBlockId, context, trail) {
  const target = valueOf(context.blocks?.[targetBlockId]);
  if (!target) return [];
  return normalizeChildren(target.content ?? [], context, trail);
}

function normalizeBlockTree(blockId, context, trail = new Set()) {
  const block = valueOf(context.blocks?.[blockId]);
  if (!block) return null;
  if (trail.has(blockId)) return null;

  const nextTrail = new Set(trail);
  nextTrail.add(blockId);

  const titleHtml = richTextToHtml(block.properties?.title);
  const titleText = plainText(block.properties?.title);

  switch (block.type) {
    case "text":
      return { id: block.id, type: "paragraph", html: titleHtml };
    case "quote":
      return { id: block.id, type: "quote", html: titleHtml };
    case "header":
      return {
        id: block.id,
        type: "header",
        html: titleHtml,
        anchorId: createAnchorId(titleText, context.headingAnchors),
      };
    case "sub_header":
      return {
        id: block.id,
        type: "subheader",
        html: titleHtml,
        anchorId: createAnchorId(titleText, context.headingAnchors),
      };
    case "sub_sub_header":
      return {
        id: block.id,
        type: "subsubheader",
        html: titleHtml,
        anchorId: createAnchorId(titleText, context.headingAnchors),
      };
    case "divider":
      return { id: block.id, type: "divider" };
    case "callout":
      return {
        id: block.id,
        type: "callout",
        html: titleHtml,
        icon: normalizeIcon(block.format?.page_icon ?? "", {
          blockId: block.id,
          spaceId: block.space_id ?? null,
          width: 256,
        }),
        children: normalizeChildren(block.content ?? [], context, nextTrail),
      };
    case "column_list":
      return {
        id: block.id,
        type: "columns",
        children: normalizeChildren(block.content ?? [], context, nextTrail),
      };
    case "column":
      return {
        id: block.id,
        type: "column",
        children: normalizeChildren(block.content ?? [], context, nextTrail),
      };
    case "page":
    case "collection_view_page":
      context.linkedPageIds.add(block.id);
      return {
        id: block.id,
        type: "page_link",
        targetId: block.id,
        title: titleText,
        notionType: block.type,
      };
    case "alias": {
      const targetId = block.format?.alias_pointer?.id ?? null;
      if (targetId) context.linkedPageIds.add(targetId);
      return {
        id: block.id,
        type: "alias_link",
        targetId,
        title: titleText || "Linked page",
      };
    }
    case "image":
      return {
        id: block.id,
        type: "image",
        src: extractSource(block, { width: 2000 }),
        caption: richTextToHtml(block.properties?.caption),
        alt: titleText || plainText(block.properties?.caption) || "Image",
      };
    case "video":
      return {
        id: block.id,
        type: "video",
        src: extractSource(block),
        caption: richTextToHtml(block.properties?.caption),
      };
    case "embed":
      return {
        id: block.id,
        type: "embed",
        src: extractSource(block),
        caption: richTextToHtml(block.properties?.caption),
      };
    case "bookmark":
      return {
        id: block.id,
        type: "bookmark",
        src: extractSource(block),
        title: titleText,
      };
    case "tweet":
      return {
        id: block.id,
        type: "tweet",
        src: extractSource(block),
        caption: richTextToHtml(block.properties?.caption),
      };
    case "file":
    case "pdf":
      return {
        id: block.id,
        type: "file",
        kind: block.type,
        src: extractSource(block),
        title: titleText || plainText(block.properties?.source),
        size: plainText(block.properties?.size),
      };
    case "bulleted_list":
      return { id: block.id, type: "bulleted_list", html: titleHtml };
    case "numbered_list":
      return { id: block.id, type: "numbered_list", html: titleHtml };
    case "to_do":
      return {
        id: block.id,
        type: "todo",
        html: titleHtml,
        checked: Boolean(block.properties?.checked?.[0]?.[0] === "Yes"),
      };
    case "toggle":
      return {
        id: block.id,
        type: "toggle",
        html: titleHtml,
        children: normalizeChildren(block.content ?? [], context, nextTrail),
      };
    case "code":
      return {
        id: block.id,
        type: "code",
        html: titleHtml,
        language: block.properties?.language?.[0]?.[0] ?? "",
      };
    case "collection_view": {
      const viewIds = block.view_ids ?? [];
      const collectionId =
        block.collection_id ??
        block.format?.collection_pointer?.id ??
        context.collectionViews[viewIds[0]]?.collectionId ??
        null;

      return {
        id: block.id,
        type: "collection_view",
        collectionId,
        viewIds,
        title: titleText,
      };
    }
    case "transclusion_container":
      return {
        id: block.id,
        type: "synced_block",
        sourceBlockId: block.id,
        children: normalizeChildren(block.content ?? [], context, nextTrail),
      };
    case "transclusion_reference": {
      const targetBlockId =
        block.format?.transclusion_reference_pointer?.id ??
        block.format?.copied_from_pointer?.id ??
        null;

      return {
        id: block.id,
        type: "synced_block",
        sourceBlockId: targetBlockId,
        children: targetBlockId
          ? normalizeSyncedChildren(targetBlockId, context, nextTrail)
          : [],
      };
    }
    case "table_of_contents":
      return { id: block.id, type: "table_of_contents" };
    case "table":
      return normalizeTableBlock(block, context, nextTrail);
    case "table_row":
    case "copy_indicator":
      return null;
    default: {
      const children = normalizeChildren(block.content ?? [], context, nextTrail);
      context.unsupported.add(block.type ?? "unknown");
      return children.length > 0
        ? { id: block.id, type: "container", children }
        : null;
    }
  }
}

function reconcileDirectoryCounts(pageId, blocks) {
  if (!COUNTED_DIRECTORY_PAGE_IDS.has(pageId)) return;

  let total = 0;
  for (const block of blocks) {
    if (block.type !== "toggle" || !Array.isArray(block.children)) continue;
    const count = block.children.length;
    total += count;
    block.html = String(block.html ?? "").replace(/\[\d+\]\s*$/, `[${count}]`);
  }

  for (const block of blocks) {
    if (block.type === "paragraph" && /^<em>total:\d+<\/em>$/.test(block.html ?? "")) {
      block.html = `<em>total:${total}</em>`;
    }
  }
}

function collectLinkedPages(blocks) {
  const linked = new Set();

  function visit(nodes) {
    for (const node of nodes) {
      if (node.type === "page_link" || node.type === "alias_link") {
        if (node.targetId) linked.add(node.targetId);
      }

      if (node.type === "collection_view") {
        continue;
      }

      if (node.children?.length) visit(node.children);
    }
  }

  visit(blocks);
  return [...linked];
}

function collectNavigation(rootPage) {
  const items = [];

  function visit(nodes) {
    for (const node of nodes) {
      if (node.type === "page_link" && node.title) {
        items.push(node.targetId);
      }
      if (node.children?.length) visit(node.children);
    }
  }

  visit(rootPage.blocks);
  return [...new Set(items)];
}

function findPreviewImage(blocks) {
  for (const block of blocks) {
    if (block.type === "image" && block.src) return block.src;
    if (block.children?.length) {
      const childImage = findPreviewImage(block.children);
      if (childImage) return childImage;
    }
  }

  return "";
}

function customizeHomePageBlocks(pageId, rootPageId, blocks) {
  if (pageId !== rootPageId) return;

  for (const block of blocks) {
    if (block.id === "2ebd20b0-8d45-4016-9c2c-b69224d020b3") {
      block.html =
        '<a href="#/shortform-writing">Shortform Text</a> | <a href="#/tweets-and-threads">🐦</a> <a href="#/quotes">💬</a>';
    }
    if (block.children?.length) {
      customizeHomePageBlocks(pageId, rootPageId, block.children);
    }
  }
}

function summarizePage(page) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentId: page.parentId,
    parentPageId: page.parentPageId,
    parentTable: page.parentTable,
    type: page.type,
  };
}

function serializePagePayload(page) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    type: page.type,
    parentId: page.parentId,
    parentPageId: page.parentPageId,
    parentTable: page.parentTable,
    collectionId: page.collectionId,
    viewIds: page.viewIds,
    sourceUrl: page.sourceUrl,
    createdTime: page.createdTime,
    lastEditedTime: page.lastEditedTime,
    createdById: page.createdById,
    lastEditedById: page.lastEditedById,
    properties: page.properties,
    previewImage: page.previewImage,
    blocks: page.blocks,
  };
}

function resolveParentPageId(page, pageById, blocks, collections) {
  let parentId = page.parentId;
  let parentTable = page.parentTable;
  const visited = new Set();

  while (parentId) {
    const pointer = `${parentTable}:${parentId}`;
    if (visited.has(pointer)) return null;
    visited.add(pointer);

    if (parentTable === "block") {
      if (pageById.has(parentId) && parentId !== page.id) return parentId;
      const parentBlock = valueOf(blocks[parentId]);
      if (!parentBlock) return null;
      parentId = parentBlock.parent_id ?? null;
      parentTable = parentBlock.parent_table ?? null;
      continue;
    }

    if (parentTable === "collection") {
      const parentCollection = valueOf(collections[parentId]);
      if (!parentCollection) return null;
      parentId = parentCollection.parent_id ?? null;
      parentTable = parentCollection.parent_table ?? null;
      continue;
    }

    return null;
  }

  return null;
}

function summarizeCollectionRow(page) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    previewImage: page.previewImage,
    sourceUrl: page.sourceUrl,
    createdTime: page.createdTime,
    lastEditedTime: page.lastEditedTime,
    properties: page.properties,
  };
}

function pageDepth(page, pageById) {
  let depth = 0;
  let current = page;
  const visited = new Set([page.id]);

  while (current?.parentId && pageById.has(current.parentId) && !visited.has(current.parentId)) {
    current = pageById.get(current.parentId);
    visited.add(current.id);
    depth += 1;
  }

  return depth;
}

function assignUniqueSlugs(pages, rootPageId) {
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const groups = new Map();

  for (const page of pages) {
    const baseSlug = page.slug || slugify(page.title, page.id.slice(0, 8));
    page.slug = baseSlug;

    if (!groups.has(baseSlug)) groups.set(baseSlug, []);
    groups.get(baseSlug).push(page);
  }

  for (const [baseSlug, group] of groups) {
    if (group.length < 2) continue;

    group.sort((left, right) => {
      if (left.id === rootPageId) return -1;
      if (right.id === rootPageId) return 1;

      const depthDelta = pageDepth(left, pageById) - pageDepth(right, pageById);
      if (depthDelta !== 0) return depthDelta;

      const titleDelta = left.title.localeCompare(right.title);
      if (titleDelta !== 0) return titleDelta;

      return left.id.localeCompare(right.id);
    });

    group.forEach((page, index) => {
      page.slug = index === 0 ? baseSlug : `${baseSlug}-${page.id.slice(0, 8)}`;
    });
  }
}

function rewriteBlockLinks(block, pageIndex) {
  const normalized = { ...block };

  if (typeof normalized.html === "string") {
    normalized.html = rewriteHtmlLinks(normalized.html, pageIndex);
  }

  if (typeof normalized.caption === "string") {
    normalized.caption = rewriteHtmlLinks(normalized.caption, pageIndex);
  }

  if (Array.isArray(normalized.rows)) {
    normalized.rows = normalized.rows.map((row) => ({
      ...row,
      cells: (row.cells ?? []).map((cell) => ({
        ...cell,
        html: rewriteHtmlLinks(cell.html, pageIndex),
      })),
    }));
  }

  if (Array.isArray(normalized.children)) {
    normalized.children = normalized.children.map((child) => rewriteBlockLinks(child, pageIndex));
  }

  return normalized;
}

function pageAliasIds(root) {
  return [...new Set([root?.format?.copied_from_pointer?.id, root?.copied_from].filter(Boolean))];
}

function createPageIndex(pages) {
  const pageIndex = Object.fromEntries(
    pages.map((page) => [page.id, { id: page.id, slug: page.slug, title: page.title }]),
  );

  for (const page of pages) {
    for (const aliasId of page.aliasIds ?? []) {
      if (!pageIndex[aliasId]) {
        pageIndex[aliasId] = { id: page.id, slug: page.slug, title: page.title };
      }
    }
  }

  return pageIndex;
}

function createPageAliasMap(pages) {
  return Object.fromEntries(
    pages.flatMap((page) =>
      (page.aliasIds ?? [])
        .filter((aliasId) => aliasId !== page.id)
        .map((aliasId) => [aliasId, page.id]),
    ),
  );
}

function ensureCollection(collections, collectionId) {
  if (!collectionId) return null;

  if (!collections[collectionId]) {
    collections[collectionId] = {
      id: collectionId,
      name: "",
      schema: {
        title: {
          id: "title",
          name: "Name",
          type: "title",
          icon: "",
          default: null,
          dateFormat: null,
          timeFormat: null,
          verifierProperty: null,
          options: [],
        },
      },
      viewIds: new Set(),
      rowPageIds: new Set(),
    };
  }

  return collections[collectionId];
}

async function main() {
  const manifest = await readJson(MANIFEST_PATH);
  const rawFiles = (await fs.readdir(RAW_DIR))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  const rawPages = [];
  const globalBlocks = {};
  const globalCollections = {};
  const globalCollectionViews = {};

  for (const fileName of rawFiles) {
    const raw = await readJson(path.join(RAW_DIR, fileName));
    rawPages.push(raw);
    Object.assign(globalBlocks, raw.recordMap?.block ?? {});
    Object.assign(globalCollections, raw.recordMap?.collection ?? {});
    Object.assign(globalCollectionViews, raw.recordMap?.collection_view ?? {});
  }

  const normalizedCollectionViews = Object.fromEntries(
    Object.entries(globalCollectionViews)
      .map(([viewId, entry]) => [viewId, valueOf(entry)])
      .filter(([, view]) => Boolean(view?.id))
      .map(([viewId, view]) => [viewId, normalizeCollectionView(view)])
      .filter(([, view]) => view?.id),
  );

  const collections = {};

  for (const [collectionId, entry] of Object.entries(globalCollections)) {
    const collection = valueOf(entry);
    if (!collection) continue;

    collections[collectionId] = {
      id: collectionId,
      name: plainText(collection.name),
      schema: normalizeSchema(collection.schema),
      viewIds: new Set(),
      rowPageIds: new Set(),
    };
  }

  for (const view of Object.values(normalizedCollectionViews)) {
    const collection = ensureCollection(collections, view.collectionId);
    if (!collection) continue;

    collection.viewIds.add(view.id);
    for (const pageId of view.pageSort ?? []) {
      collection.rowPageIds.add(pageId);
    }
  }

  const pages = [];

  for (const raw of rawPages) {
    const pageId = raw.pageId;
    const root = valueOf(raw.recordMap?.block?.[pageId]);
    if (!root) continue;

    const headingAnchors = new Set();
    const unsupported = new Set();
    const linkedPageIds = new Set();
    const normalizedBlocks = normalizeChildren(root.content ?? [], {
      blocks: globalBlocks,
      collectionViews: normalizedCollectionViews,
      headingAnchors,
      unsupported,
      linkedPageIds,
    });
    customizeHomePageBlocks(pageId, manifest.rootPageId, normalizedBlocks);
    reconcileDirectoryCounts(pageId, normalizedBlocks);

    const title = plainText(root.properties?.title);
    const page = {
      id: pageId,
      slug: manifest.pages?.[pageId]?.slug ?? slugify(title, pageId.slice(0, 8)),
      aliasIds: pageAliasIds(root),
      title,
      icon: normalizeIcon(root.format?.page_icon ?? "", {
        blockId: pageId,
        spaceId: root.space_id ?? null,
        width: 256,
      }),
      cover: normalizeAssetUrl(root.format?.page_cover ?? "", {
        blockId: pageId,
        spaceId: root.space_id ?? null,
        width: 2000,
      }),
      type: root.type,
      parentId: root.parent_id ?? null,
      parentTable: root.parent_table ?? null,
      collectionId: root.collection_id ?? null,
      viewIds: root.view_ids ?? [],
      sourceUrl: raw.sourceUrl,
      createdTime: root.created_time ?? null,
      lastEditedTime: root.last_edited_time ?? null,
      createdById: root.created_by_id ?? null,
      lastEditedById: root.last_edited_by_id ?? null,
      properties: root.properties ?? {},
      previewImage: findPreviewImage(normalizedBlocks),
      blocks: normalizedBlocks,
      linkedPageIds: [...linkedPageIds],
      unsupportedBlockTypes: [...unsupported].sort(),
    };

    pages.push(page);

    if (page.parentTable === "collection" && page.parentId) {
      ensureCollection(collections, page.parentId)?.rowPageIds.add(page.id);
    }

    if (page.collectionId) {
      const collection = ensureCollection(collections, page.collectionId);
      for (const viewId of page.viewIds) {
        collection?.viewIds.add(viewId);
      }
    }
  }

  assignUniqueSlugs(pages, manifest.rootPageId);

  const pageIndex = createPageIndex(pages);
  const pageById = new Map(pages.map((page) => [page.id, page]));

  for (const page of pages) {
    page.parentPageId = resolveParentPageId(
      page,
      pageById,
      globalBlocks,
      globalCollections,
    );
  }

  for (const page of pages) {
    page.blocks = page.blocks.map((block) => rewriteBlockLinks(block, pageIndex));
  }

  const serializedCollections = Object.fromEntries(
    Object.entries(collections).map(([collectionId, collection]) => [
      collectionId,
      {
        id: collection.id,
        name: collection.name,
        schema: collection.schema,
        viewIds: [...collection.viewIds],
        rowPageIds: [...collection.rowPageIds].filter((pageId) => Boolean(pageIndex[pageId])),
      },
    ]),
  );

  const rootPage = pages.find((page) => page.id === manifest.rootPageId) ?? pages[0];
  const navigation = collectNavigation(rootPage)
    .map((pageId) => pageIndex[pageId])
    .filter(Boolean);

  const siteIndex = {
    site: {
      title: "Paidiasophia",
      tagline: "A research wiki dedicated to the study of play.",
      source: "Public Notion workspace",
      updatedAt: new Date().toISOString(),
    },
    rootPageId: rootPage?.id ?? null,
    pageAliases: createPageAliasMap(pages),
    navigation,
    pages: pages.map(summarizePage),
  };

  await resetDir(PAGES_DIR);
  await resetDir(COLLECTIONS_DIR);

  await Promise.all(
    pages.map((page) =>
      writeJson(
        path.join(PAGES_DIR, `${page.id}.json`),
        serializePagePayload(page),
      ),
    ),
  );

  await Promise.all(
    Object.values(serializedCollections).map((collection) =>
      writeJson(path.join(COLLECTIONS_DIR, `${collection.id}.json`), {
        id: collection.id,
        name: collection.name,
        schema: collection.schema,
        views: collection.viewIds
          .map((viewId) => normalizedCollectionViews[viewId])
          .filter(Boolean),
        rows: collection.rowPageIds
          .map((pageId) => pageById.get(pageId))
          .filter(Boolean)
          .map(summarizeCollectionRow),
      }),
    ),
  );

  await writeJson(SITE_INDEX_PATH, siteIndex);
  await writeJson(SITE_DATA_PATH, siteIndex);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
