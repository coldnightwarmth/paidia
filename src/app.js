const DATA_CACHE_TOKEN = Date.now().toString(36);

function dataUrl(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${DATA_CACHE_TOKEN}`;
}

const siteIndex = await fetch(dataUrl("./data/site-index.json"), { cache: "no-store" }).then((response) =>
  response.json(),
);

const pageIndexMap = new Map(siteIndex.pages.map((page) => [page.id, page]));
const aliasPageIdMap = new Map(Object.entries(siteIndex.pageAliases ?? {}));
const slugMap = new Map(siteIndex.pages.map((page) => [page.slug, page]));
const gifAssetSet = new Set(siteIndex.gifAssets ?? []);
const FULL_TEXT_DATABASE_PAGE_ID = "8b00db95-6902-4675-93fb-bd8023cf5614";
const LEGACY_FULL_TEXT_DATABASE_SLUGS = new Set([
  "full-text-database",
  "books-9e20ddab",
]);
const FULL_TEXT_DATABASE_DATA_URL = "./data/full-text-database-books.json";
const FULL_TEXT_DATABASE_STORAGE_KEY = "paidiasophia:full-text-database-sheet:v4";
const FULL_TEXT_DATABASE_VIEW_STORAGE_KEY = "paidiasophia:full-text-database-view:v1";
const FULL_TEXT_DATABASE_BOOKMARKS_STORAGE_KEY =
  "paidiasophia:full-text-database-bookmarks:v1";
const FULL_TEXT_DATABASE_PAGE_SIZE = 100;
const FULL_TEXT_DATABASE_FALLBACK_COLUMNS = [
  "Title",
  "Creator(s)",
  "Tags",
  "Released",
  "Publisher",
];
const FOLKS_DATABASE_PAGE_ID = "292fe1df-a5bd-4b49-97aa-f336bf0ac103";
const FOLKS_DATABASE_DATA_URL = "./data/folks-database.json";
const FOLKS_DATABASE_VIEW_STORAGE_KEY = "paidiasophia:folks-database-view:v1";
const FOLKS_DATABASE_PAGE_SIZE = 100;
const FOLKS_DATABASE_FALLBACK_COLUMNS = ["Name", "List"];
const SHORTFORM_DATABASE_PAGE_ID = "50eae52d-e10e-4677-a195-6f45f609aa5d";
const SHORTFORM_ESSAYS_PAGE_ID = "71160b13-261c-43b4-9e7a-80771fb8debc";
const SHORTFORM_POEMS_AND_STORIES_PAGE_ID = "f7a6ae5b-b1de-47e8-a0d3-7551c3a5399f";
const SHORTFORM_DATABASE_DATA_URL = "./data/shortform-database.json";
const SHORTFORM_DATABASE_VIEW_STORAGE_KEY = "paidiasophia:shortform-database-view:v1";
const SHORTFORM_DATABASE_BOOKMARKS_STORAGE_KEY =
  "paidiasophia:shortform-database-bookmarks:v1";
const SHORTFORM_DATABASE_PAGE_SIZE = 100;
const SHORTFORM_DATABASE_FALLBACK_COLUMNS = ["Title", "Creator(s)", "Type", "Theme"];
const shortformPageSummary = pageIndexMap.get(SHORTFORM_DATABASE_PAGE_ID);
if (shortformPageSummary) shortformPageSummary.title = "Shortform Texts";
const shortformNavigationItem = siteIndex.navigation.find(
  (item) => item.id === SHORTFORM_DATABASE_PAGE_ID,
);
if (shortformNavigationItem) shortformNavigationItem.title = "Shortform Texts";
const pageCache = new Map();
const collectionCache = new Map();
const collectionViewState = new Map();
let fullTextDatabasePayload = null;
let folksDatabasePayload = null;
let shortformDatabasePayload = null;

let renderVersion = 0;

const sidebar = document.querySelector("#sidebar");
const nav = document.querySelector("#site-nav");
const status = document.querySelector("#site-status");
const breadcrumbs = document.querySelector("#breadcrumbs");
const hero = document.querySelector("#page-hero");
const content = document.querySelector("#page-content");
const menuToggle = document.querySelector("#menu-toggle");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const pageCardTemplate = document.querySelector("#page-card-template");
const siteHomeLink = document.querySelector("#site-home-link");
const bookPreviewPanel = document.querySelector("#book-preview-panel");
const bookPreviewHero = document.querySelector("#book-preview-hero");
const bookPreviewContent = document.querySelector("#book-preview-content");
const bookPreviewClose = document.querySelector("#book-preview-close");

let activeBookPreviewPageId = null;
let activeShortformPreviewPageId = null;
let bookPreviewRenderVersion = 0;
let spreadsheetViewportAbortController = null;
let updateSpreadsheetFilterViewport = null;

const collectionObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            collectionObserver.unobserve(entry.target);
            entry.target.__loadCollection?.();
          }
        },
        { rootMargin: "240px 0px" },
      )
    : null;

function isHomePage(pageSummary) {
  return pageSummary?.id === siteIndex.rootPageId;
}

function isFullTextDatabasePage(pageSummary) {
  return pageSummary?.id === FULL_TEXT_DATABASE_PAGE_ID;
}

function isFolksDatabasePage(pageSummary) {
  return pageSummary?.id === FOLKS_DATABASE_PAGE_ID;
}

function isShortformDatabasePage(pageSummary) {
  return pageSummary?.id === SHORTFORM_DATABASE_PAGE_ID;
}

function isShortformTextPage(pageSummary) {
  return (
    pageSummary?.parentPageId === SHORTFORM_ESSAYS_PAGE_ID ||
    pageSummary?.parentPageId === SHORTFORM_POEMS_AND_STORIES_PAGE_ID
  );
}

function isSpreadsheetDatabasePage(pageSummary) {
  return (
    isFullTextDatabasePage(pageSummary) ||
    isFolksDatabasePage(pageSummary) ||
    isShortformDatabasePage(pageSummary)
  );
}

function pagePropertyTokens(page) {
  return Object.values(page?.properties ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((part) => part?.[0])
    .filter(Boolean);
}

function isBookPage(page) {
  const icon = page?.icon ?? "";
  return /book/i.test(icon) || pagePropertyTokens(page).some((token) => token === "Book");
}

function setSidebarOpen(isOpen) {
  const canOpen = !document.body.classList.contains("page--home");
  const nextOpen = Boolean(isOpen) && canOpen;

  sidebar.classList.toggle("is-open", nextOpen);
  sidebarBackdrop.classList.toggle("is-visible", nextOpen);
  menuToggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  menuToggle.textContent = nextOpen ? "close" : "menu";
}

function applyPageChrome(pageSummary) {
  const homePage = isHomePage(pageSummary);
  const spreadsheetPage = isSpreadsheetDatabasePage(pageSummary);
  document.body.classList.toggle("page--home", homePage);
  document.body.classList.add("page--spreadsheet");
  content.classList.toggle("page__content--spreadsheet", spreadsheetPage);
  content.classList.remove("page__content--book");
  content.classList.remove("page__content--shortform-text");
  menuToggle.hidden = homePage;
  setSidebarOpen(false);
  if (!isFullTextDatabasePage(pageSummary)) {
    closeBookPreview();
  }
  if (!spreadsheetPage) {
    spreadsheetViewportAbortController?.abort();
    spreadsheetViewportAbortController = null;
    updateSpreadsheetFilterViewport = null;
  }
}

function normalizeSpreadsheetRows(rows, columns) {
  return Array.isArray(rows)
    ? rows.map((row) =>
        columns.map((_, index) => (typeof row?.[index] === "string" ? row[index] : "")),
      )
    : [];
}

async function loadFullTextDatabasePayload() {
  if (fullTextDatabasePayload) return fullTextDatabasePayload;

  fullTextDatabasePayload = fetch(dataUrl(FULL_TEXT_DATABASE_DATA_URL), {
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error("Failed to load Full Text Database rows.");
    }

    const payload = await response.json();
    const payloadColumns = Array.isArray(payload.columns)
      ? payload.columns.filter((column) => typeof column === "string")
      : FULL_TEXT_DATABASE_FALLBACK_COLUMNS;
    const columns =
      payloadColumns.length > 0 ? payloadColumns : FULL_TEXT_DATABASE_FALLBACK_COLUMNS;

    return {
      columns,
      rows: normalizeSpreadsheetRows(payload.rows, columns),
      rowMeta: Array.isArray(payload.rowMeta) ? payload.rowMeta : [],
    };
  });

  return fullTextDatabasePayload;
}

async function loadFolksDatabasePayload() {
  if (folksDatabasePayload) return folksDatabasePayload;

  folksDatabasePayload = fetch(dataUrl(FOLKS_DATABASE_DATA_URL), {
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error("Failed to load the Folks database.");

    const payload = await response.json();
    const payloadColumns = Array.isArray(payload.columns)
      ? payload.columns.filter((column) => typeof column === "string")
      : FOLKS_DATABASE_FALLBACK_COLUMNS;
    const columns =
      payloadColumns.length > 0 ? payloadColumns : FOLKS_DATABASE_FALLBACK_COLUMNS;

    return {
      columns,
      rows: normalizeSpreadsheetRows(payload.rows, columns),
      rowMeta: Array.isArray(payload.rowMeta) ? payload.rowMeta : [],
      lists: Array.isArray(payload.lists)
        ? payload.lists.filter((label) => typeof label === "string" && label.trim())
        : [],
    };
  });

  return folksDatabasePayload;
}

async function loadShortformDatabasePayload() {
  if (shortformDatabasePayload) return shortformDatabasePayload;

  shortformDatabasePayload = fetch(dataUrl(SHORTFORM_DATABASE_DATA_URL), {
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) throw new Error("Failed to load the Shortform Texts database.");

    const payload = await response.json();
    const payloadColumns = Array.isArray(payload.columns)
      ? payload.columns.filter((column) => typeof column === "string")
      : SHORTFORM_DATABASE_FALLBACK_COLUMNS;
    const columns =
      payloadColumns.length > 0 ? payloadColumns : SHORTFORM_DATABASE_FALLBACK_COLUMNS;

    return {
      columns,
      rows: normalizeSpreadsheetRows(payload.rows, columns),
      rowMeta: Array.isArray(payload.rowMeta) ? payload.rowMeta : [],
      types: Array.isArray(payload.types)
        ? payload.types.filter((label) => typeof label === "string" && label.trim())
        : [],
      themes: Array.isArray(payload.themes)
        ? payload.themes.filter((label) => typeof label === "string" && label.trim())
        : [],
    };
  });

  return shortformDatabasePayload;
}

function loadSpreadsheetRows(sourceRows, columns) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FULL_TEXT_DATABASE_STORAGE_KEY) ?? "null");
    if (
      saved?.sourceRows === sourceRows.length &&
      Array.isArray(saved?.columns) &&
      saved.columns.join("\u0000") === columns.join("\u0000")
    ) {
      return normalizeSpreadsheetRows(saved.rows, columns);
    }
  } catch {}

  return sourceRows.map((row) => [...row]);
}

function saveSpreadsheetRows(rows, columns, sourceRows) {
  try {
    window.localStorage.setItem(
      FULL_TEXT_DATABASE_STORAGE_KEY,
      JSON.stringify({ columns, sourceRows: sourceRows.length, rows }),
    );
  } catch {}
}

function normalizeSpreadsheetSortState(value, columns) {
  const columnIndex = Number(value?.columnIndex);
  const direction = value?.direction;

  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) {
    return null;
  }

  if (direction !== "asc" && direction !== "desc") {
    return null;
  }

  return { columnIndex, direction };
}

function normalizeSpreadsheetLayoutMode(value) {
  return value === "gallery" ? "gallery" : "spreadsheet";
}

function normalizeSpreadsheetTagKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizeSpreadsheetSelectedTags(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(normalizeSpreadsheetTagKey).filter(Boolean))];
}

function loadSpreadsheetViewState(sourceRows, columns) {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(FULL_TEXT_DATABASE_VIEW_STORAGE_KEY) ?? "null",
    );
    const columnsMatch =
      Array.isArray(saved?.columns) && saved.columns.join("\u0000") === columns.join("\u0000");
    const rowsMatch = saved?.sourceRows === sourceRows.length;

    if (columnsMatch && rowsMatch) {
      return {
        currentPage:
          Number.isInteger(saved.currentPage) && saved.currentPage >= 0 ? saved.currentPage : 0,
        editMode: Boolean(saved.editMode),
        layoutMode: normalizeSpreadsheetLayoutMode(saved.layoutMode),
        sortState: normalizeSpreadsheetSortState(saved.sortState, columns),
        filtersOpen: Boolean(saved.filtersOpen),
        selectedTags: normalizeSpreadsheetSelectedTags(saved.selectedTags),
        bookmarksOnly: Boolean(saved.bookmarksOnly),
      };
    }
  } catch {}

  return {
    currentPage: 0,
    editMode: false,
    layoutMode: "spreadsheet",
    sortState: null,
    filtersOpen: false,
    selectedTags: [],
    bookmarksOnly: false,
  };
}

function saveSpreadsheetViewState(
  {
    currentPage,
    editMode,
    layoutMode,
    sortState,
    filtersOpen,
    selectedTags,
    bookmarksOnly,
  },
  columns,
  sourceRows,
) {
  try {
    window.localStorage.setItem(
      FULL_TEXT_DATABASE_VIEW_STORAGE_KEY,
      JSON.stringify({
        columns,
        sourceRows: sourceRows.length,
        currentPage,
        editMode,
        layoutMode: normalizeSpreadsheetLayoutMode(layoutMode),
        sortState: normalizeSpreadsheetSortState(sortState, columns),
        filtersOpen: Boolean(filtersOpen),
        selectedTags: normalizeSpreadsheetSelectedTags(selectedTags),
        bookmarksOnly: Boolean(bookmarksOnly),
      }),
    );
  } catch {}
}

function loadBookmarkedBookIds() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(FULL_TEXT_DATABASE_BOOKMARKS_STORAGE_KEY) ?? "[]",
    );

    return new Set(
      Array.isArray(saved)
        ? saved.filter((pageId) => typeof pageId === "string" && pageId.trim())
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveBookmarkedBookIds(bookmarkedBookIds) {
  try {
    window.localStorage.setItem(
      FULL_TEXT_DATABASE_BOOKMARKS_STORAGE_KEY,
      JSON.stringify([...bookmarkedBookIds]),
    );
  } catch {}
}

function loadBookmarkedShortformIds() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(SHORTFORM_DATABASE_BOOKMARKS_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(saved)
        ? saved.filter((pageId) => typeof pageId === "string" && pageId.trim())
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveBookmarkedShortformIds(bookmarkedPageIds) {
  try {
    window.localStorage.setItem(
      SHORTFORM_DATABASE_BOOKMARKS_STORAGE_KEY,
      JSON.stringify([...bookmarkedPageIds]),
    );
  } catch {}
}

function focusSpreadsheetCell(container, rowIndex, columnIndex) {
  const target = container.querySelector(
    `[data-row="${rowIndex}"][data-column="${columnIndex}"]`,
  );
  target?.focus();
}

function compareSpreadsheetValues(a, b) {
  const aText = String(a ?? "").trim();
  const bText = String(b ?? "").trim();
  const aNumber = Number(aText);
  const bNumber = Number(bText);

  if (aText && bText && Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }

  if (!aText && bText) return 1;
  if (aText && !bText) return -1;

  return aText.localeCompare(bText, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function titleSortValue(value) {
  const title = String(value ?? "").trim();
  const withoutArticle = title.replace(/^the\b(?:\s+|[,:-]\s*)?/i, "").trim();
  return withoutArticle || title;
}

function creatorSurnameSortValue(value) {
  const creators = String(value ?? "").trim();
  if (!creators) return "";

  const creatorParts = creators.split(/\s*(?:,|&|;|\band\b)\s*/i).filter(Boolean);
  const firstCreator = creatorParts[0] ?? creators;
  const firstCreatorWords = firstCreator.split(/\s+/).filter(Boolean);
  const surnameWords =
    firstCreatorWords.length === 1 && creatorParts.length > 1
      ? creators.split(/\s+/).filter(Boolean)
      : firstCreatorWords;
  const suffixPattern = /^(?:jr\.?|sr\.?|ii|iii|iv)$/i;

  while (
    surnameWords.length > 1 &&
    suffixPattern.test(surnameWords[surnameWords.length - 1].replace(/[,;]+$/, ""))
  ) {
    surnameWords.pop();
  }

  const surname = surnameWords[surnameWords.length - 1]?.replace(/[,;]+$/, "") ?? creators;
  return `${surname} ${creators}`;
}

function spreadsheetSortValue(value, columnLabel) {
  if (columnLabel === "Title") return titleSortValue(value);
  if (columnLabel === "Creator(s)" || columnLabel === "Name") {
    return creatorSurnameSortValue(value);
  }
  return value;
}

function spreadsheetPaginationItems(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, pageIndex) => pageIndex);
  }

  const lastPage = totalPages - 1;

  if (currentPage <= 3) {
    return [0, 1, 2, 3, 4, "ellipsis", lastPage];
  }

  if (currentPage >= totalPages - 4) {
    return [
      0,
      "ellipsis",
      lastPage - 4,
      lastPage - 3,
      lastPage - 2,
      lastPage - 1,
      lastPage,
    ];
  }

  return [
    0,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    lastPage,
  ];
}

function compactSpreadsheetPaginationItems(totalPages, currentPage) {
  const visiblePages = Math.min(3, totalPages);
  const startPage = Math.min(
    Math.max(currentPage - 1, 0),
    Math.max(totalPages - visiblePages, 0),
  );

  return Array.from({ length: visiblePages }, (_, index) => startPage + index);
}

function spreadsheetColumnClass(label) {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageBlocksSearchText(blocks = []) {
  const chunks = [];

  for (const block of blocks) {
    if (!block) continue;
    if (block.title) chunks.push(block.title);
    if (block.html) chunks.push(block.html);
    if (block.caption) chunks.push(block.caption);
    if (block.alt) chunks.push(block.alt);
    if (Array.isArray(block.children)) chunks.push(pageBlocksSearchText(block.children));
  }

  return chunks.join(" ");
}

function pageSearchText(page) {
  return normalizeSearchText(
    [page?.title ?? "", pageBlocksSearchText(page?.blocks ?? [])].join(" "),
  );
}

function searchTermsForQuery(query) {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

async function renderFullTextDatabaseSpreadsheet() {
  const { columns, rows: sourceRows, rowMeta } = await loadFullTextDatabasePayload();
  const rows = loadSpreadsheetRows(sourceRows, columns);
  const viewState = loadSpreadsheetViewState(sourceRows, columns);
  const defaultSortState = {
    columnIndex: Math.max(0, columns.indexOf("Title")),
    direction: "asc",
  };
  let sortState = viewState.sortState ?? defaultSortState;
  let randomRowRanks = null;
  let currentPage = viewState.currentPage;
  let pendingFocus = null;
  let editMode = viewState.editMode;
  let layoutMode = viewState.layoutMode;
  let filtersOpen = viewState.filtersOpen;
  let selectedTags = new Set(viewState.selectedTags);
  let bookmarksOnly = viewState.bookmarksOnly;
  const bookmarkedBookIds = loadBookmarkedBookIds();
  let searchQuery = "";
  let searchPopupOpen = false;
  let pageSearchIndexPromise = null;
  let pageSearchIndexComplete = false;

  const tagsColumnIndex = columns.indexOf("Tags");
  const tagsForRow = (row) =>
    tagsColumnIndex < 0
      ? []
      : String(row[tagsColumnIndex] ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
  const tagLabelsByKey = new Map();

  rows.forEach((row) => {
    tagsForRow(row).forEach((tag) => {
      const key = normalizeSpreadsheetTagKey(tag);
      if (key && !tagLabelsByKey.has(key)) tagLabelsByKey.set(key, tag);
    });
  });

  const allTags = [...tagLabelsByKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  const availableTagKeys = new Set(allTags.map(({ key }) => key));
  const route = currentHashRoute();
  const requestedTagKeys = route.searchParams
    .getAll("tag")
    .map(normalizeSpreadsheetTagKey)
    .filter((tag) => availableTagKeys.has(tag));

  if (route.searchParams.has("tag")) {
    selectedTags = new Set(requestedTagKeys);
    filtersOpen = true;
    currentPage = 0;
    route.searchParams.delete("tag");

    const remainingQuery = route.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${routeForPage(FULL_TEXT_DATABASE_PAGE_ID)}${remainingQuery ? `?${remainingQuery}` : ""}`,
    );
  } else {
    selectedTags = new Set([...selectedTags].filter((tag) => availableTagKeys.has(tag)));
  }

  const rowTagKeys = rows.map(
    (row) => new Set(tagsForRow(row).map(normalizeSpreadsheetTagKey).filter(Boolean)),
  );

  const searchFieldColumnIndices = ["Title", "Creator(s)", "Tags", "Publisher"].map(
    (label) => columns.indexOf(label),
  );
  const rowSearchFields = rows.map((row) =>
    searchFieldColumnIndices.map((columnIndex) =>
      normalizeSearchText(columnIndex >= 0 ? row[columnIndex] : ""),
    ),
  );
  const pageContentSearchText = new Array(rows.length).fill("");

  const section = document.createElement("section");
  section.className = "spreadsheet";

  const toolbar = document.createElement("div");
  toolbar.className = "spreadsheet__toolbar";

  const filterToggle = document.createElement("button");
  filterToggle.type = "button";
  filterToggle.className = "spreadsheet__filter-toggle";
  filterToggle.setAttribute("aria-controls", "spreadsheet-filters");
  filterToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 5.5h15l-6 7v5l-3 1.5v-6.5l-6-7Z"></path>
    </svg>
  `;

  const bookmarkFilterToggle = document.createElement("button");
  bookmarkFilterToggle.type = "button";
  bookmarkFilterToggle.className = "spreadsheet__bookmark-filter-toggle";
  bookmarkFilterToggle.setAttribute("aria-pressed", "false");
  bookmarkFilterToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 4.5h10v15l-5-3-5 3v-15Z"></path>
    </svg>
  `;

  const toolbarModes = document.createElement("div");
  toolbarModes.className = "spreadsheet__toolbar-modes";

  const topPagination = document.createElement("nav");
  topPagination.className = "spreadsheet__pagination";
  topPagination.setAttribute("aria-label", "Spreadsheet pages");

  const bottomPagination = document.createElement("nav");
  bottomPagination.className = "spreadsheet__pagination spreadsheet__pagination--bottom";
  bottomPagination.setAttribute("aria-label", "Spreadsheet pages");

  const viewToggle = document.createElement("button");
  viewToggle.type = "button";
  viewToggle.className = "spreadsheet__toolbar-view-toggle spreadsheet__view-toggle";
  toolbarModes.append(filterToggle, viewToggle, bookmarkFilterToggle);

  const editToggle = document.createElement("button");
  editToggle.type = "button";
  editToggle.className = "spreadsheet__action-toggle spreadsheet__edit-toggle";
  editToggle.setAttribute("aria-pressed", "false");
  editToggle.setAttribute("aria-label", "Enable spreadsheet editing");
  editToggle.title = "Edit spreadsheet";
  editToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 20h4.4L19.2 9.2a2.1 2.1 0 0 0 0-3L17.8 4.8a2.1 2.1 0 0 0-3 0L4 15.6V20Z"></path>
      <path d="m13.5 6.1 4.4 4.4"></path>
    </svg>
  `;

  const scroll = document.createElement("div");
  scroll.className = "spreadsheet__scroll";

  const table = document.createElement("table");
  table.className = "spreadsheet__table";

  const colgroup = document.createElement("colgroup");
  const coverCol = document.createElement("col");
  coverCol.className = "spreadsheet__col spreadsheet__col--cover";
  colgroup.append(coverCol);

  columns.forEach((label) => {
    const col = document.createElement("col");
    col.className = `spreadsheet__col spreadsheet__col--${spreadsheetColumnClass(label)}`;
    colgroup.append(col);
  });

  table.append(colgroup);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const corner = document.createElement("th");
  corner.className = "spreadsheet__cover-header";
  corner.scope = "col";
  corner.setAttribute("aria-label", "Cover");
  headerRow.append(corner);

  columns.forEach((label) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.columnLabel = label;
    th.className = `spreadsheet__column-header spreadsheet__column-header--${spreadsheetColumnClass(
      label,
    )}`;
    th.innerHTML = `
      <button class="spreadsheet__sort-button" type="button">
        <span>${escapeHtml(label)}</span>
        <span class="spreadsheet__sort-indicator" aria-hidden="true"></span>
      </button>
    `;
    const sortButton = th.querySelector("button");
    sortButton.setAttribute("aria-label", `Sort by ${label}`);
    th.addEventListener("click", () => {
      randomRowRanks = null;
      const columnIndex = columns.indexOf(label);
      if (!sortState || sortState.columnIndex !== columnIndex) {
        sortState = { columnIndex, direction: "asc" };
      } else if (sortState.direction === "asc") {
        sortState = { columnIndex, direction: "desc" };
      } else {
        sortState = { columnIndex, direction: "asc" };
      }

      currentPage = 0;
      renderRows();
    });
    headerRow.append(th);
  });

  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");

  const gallery = document.createElement("div");
  gallery.className = "spreadsheet__gallery";
  gallery.setAttribute("role", "list");
  gallery.setAttribute("aria-label", "Book gallery");

  const workspace = document.createElement("div");
  workspace.className = "spreadsheet__workspace";

  const filterPanel = document.createElement("aside");
  filterPanel.id = "spreadsheet-filters";
  filterPanel.className = "spreadsheet__filter-panel";
  filterPanel.setAttribute("aria-label", "Sort and filter books");

  const filterPanelInner = document.createElement("div");
  filterPanelInner.className = "spreadsheet__filter-panel-inner";

  const galleryControls = document.createElement("div");
  galleryControls.className = "spreadsheet__filter-sort";

  const gallerySortLabel = document.createElement("label");
  gallerySortLabel.className = "spreadsheet__filter-label";
  gallerySortLabel.htmlFor = "spreadsheet-gallery-sort";
  gallerySortLabel.textContent = "Sort by";

  const gallerySortSelectWrap = document.createElement("span");
  gallerySortSelectWrap.className = "spreadsheet__filter-select-wrap";

  const gallerySortSelect = document.createElement("select");
  gallerySortSelect.id = "spreadsheet-gallery-sort";
  gallerySortSelect.className = "spreadsheet__filter-select";
  gallerySortSelect.setAttribute("aria-label", "Sort books by");

  gallerySortSelectWrap.append(gallerySortSelect);
  galleryControls.append(gallerySortLabel, gallerySortSelectWrap);

  const filterTagsHeading = document.createElement("h3");
  filterTagsHeading.className = "spreadsheet__filter-heading";
  filterTagsHeading.textContent = "Tags";

  const filterTagsHeader = document.createElement("div");
  filterTagsHeader.className = "spreadsheet__filter-tags-header";

  const clearTagFilters = document.createElement("button");
  clearTagFilters.type = "button";
  clearTagFilters.className = "spreadsheet__clear-tag-filters is-hidden";
  clearTagFilters.textContent = "×";
  clearTagFilters.disabled = true;
  clearTagFilters.setAttribute("aria-hidden", "true");
  clearTagFilters.title = "Clear all tag filters";
  clearTagFilters.setAttribute("aria-label", "Clear all tag filters");
  clearTagFilters.addEventListener("click", () => {
    selectedTags.clear();
    currentPage = 0;
    pendingFocus = null;
    renderRows();
  });

  filterTagsHeader.append(filterTagsHeading, clearTagFilters);

  const filterTags = document.createElement("div");
  filterTags.className = "spreadsheet__filter-tags";

  allTags.forEach(({ key, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spreadsheet__tag-filter";
    button.dataset.tagKey = key;
    button.textContent = `#${label.toLocaleLowerCase()}`;
    button.setAttribute("aria-label", `Filter by ${label}`);
    button.addEventListener("click", () => {
      if (selectedTags.has(key)) {
        selectedTags.delete(key);
      } else {
        selectedTags.add(key);
      }

      currentPage = 0;
      pendingFocus = null;
      renderRows();
    });
    filterTags.append(button);
  });

  filterPanelInner.append(galleryControls, filterTagsHeader, filterTags);
  filterPanel.append(filterPanelInner);

  const stage = document.createElement("div");
  stage.className = "spreadsheet__stage";

  const searchControls = document.createElement("div");
  searchControls.className = "spreadsheet__search";

  const searchToggle = document.createElement("button");
  searchToggle.type = "button";
  searchToggle.className = "spreadsheet__search-label spreadsheet__search-toggle";
  searchToggle.setAttribute("aria-controls", "spreadsheet-search-input");
  searchToggle.setAttribute("aria-expanded", "false");
  searchToggle.setAttribute("aria-label", "Search books");
  searchToggle.title = "Search books";
  searchToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m16 16 4 4"></path>
    </svg>
  `;

  const searchInputWrap = document.createElement("span");
  searchInputWrap.className = "spreadsheet__search-input-wrap";

  const searchInput = document.createElement("input");
  searchInput.id = "spreadsheet-search-input";
  searchInput.className = "spreadsheet__search-input";
  searchInput.type = "search";
  searchInput.placeholder = "Search books";
  searchInput.setAttribute("aria-label", "Search books");
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;

  searchInputWrap.append(searchInput);
  searchControls.append(searchToggle, searchInputWrap);

  function saveCurrentViewState() {
    saveSpreadsheetViewState(
      {
        currentPage,
        editMode,
        layoutMode,
        sortState,
        filtersOpen,
        selectedTags: [...selectedTags],
        bookmarksOnly,
      },
      columns,
      sourceRows,
    );
  }

  function columnValue(row, label) {
    const columnIndex = columns.indexOf(label);
    return columnIndex >= 0 ? row[columnIndex] ?? "" : "";
  }

  function externalLinkAttributes(link, href) {
    if (/^https?:\/\//i.test(href)) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
  }

  function renderCoverFrame(metadata, title, variant = "table") {
    if (!metadata.cover) {
      const placeholder = document.createElement("span");
      placeholder.className =
        variant === "gallery"
          ? "spreadsheet__cover-placeholder spreadsheet__cover-placeholder--gallery"
          : "spreadsheet__cover-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      return placeholder;
    }

    const galleryCoverLink = variant === "gallery" && metadata.href;
    const coverFrame = document.createElement(galleryCoverLink ? "a" : "span");
    coverFrame.className =
      variant === "gallery"
        ? "spreadsheet__cover-frame spreadsheet__cover-frame--gallery"
        : "spreadsheet__cover-frame";

    if (galleryCoverLink) {
      coverFrame.href = metadata.href;
      coverFrame.setAttribute("aria-label", `Open ${title || "book"}`);
      externalLinkAttributes(coverFrame, metadata.href);
    }

    const cover = document.createElement("img");
    cover.className =
      variant === "gallery"
        ? "spreadsheet__cover-thumb spreadsheet__cover-thumb--gallery"
        : "spreadsheet__cover-thumb";
    cover.src = metadata.cover;
    cover.alt = `${title || "Book"} cover`;
    cover.loading = "lazy";
    if (variant !== "gallery") {
      cover.tabIndex = 0;
      cover.title = "Preview cover";
    }

    coverFrame.append(cover);

    if (variant !== "gallery") {
      const coverPopover = document.createElement("span");
      coverPopover.className = "spreadsheet__cover-popover";
      coverPopover.setAttribute("aria-hidden", "true");

      const coverPreview = document.createElement("img");
      coverPreview.className = "spreadsheet__cover-popover-image";
      coverPreview.src = metadata.cover;
      coverPreview.alt = "";
      coverPreview.loading = "lazy";
      coverPopover.append(coverPreview);
      coverFrame.append(coverPopover);
    }

    return coverFrame;
  }

  function rowMatchesSearch(rowIndex, terms) {
    if (terms.length === 0) return true;

    const searchableText = `${(rowSearchFields[rowIndex] ?? []).join(" ")} ${pageContentSearchText[rowIndex] ?? ""}`;
    return terms.every((term) => searchableText.includes(term));
  }

  function searchRelevanceForRow(rowIndex, terms) {
    const fields = [
      ...(rowSearchFields[rowIndex] ?? []),
      pageContentSearchText[rowIndex] ?? "",
    ];
    const ranks = terms.map((term) => {
      const fieldIndex = fields.findIndex((field) => field.includes(term));
      return fieldIndex >= 0 ? fieldIndex : fields.length;
    });
    const bestField = Math.min(...ranks);

    return {
      bestField,
      bestFieldMatches: terms.filter((term) => fields[bestField]?.includes(term)).length,
      totalRank: ranks.reduce((total, rank) => total + rank, 0),
      worstField: Math.max(...ranks),
    };
  }

  function ensurePageContentSearchIndex() {
    if (pageSearchIndexPromise || pageSearchIndexComplete) return;

    const pagesToIndex = rowMeta
      .map((metadata, rowIndex) => ({ pageId: metadata?.pageId, rowIndex }))
      .filter((entry) => entry.pageId);

    pageSearchIndexPromise = (async () => {
      const batchSize = 24;

      for (let index = 0; index < pagesToIndex.length; index += batchSize) {
        const batch = pagesToIndex.slice(index, index + batchSize);

        await Promise.all(
          batch.map(async ({ pageId, rowIndex }) => {
            try {
              const page = await loadPage(pageId);
              pageContentSearchText[rowIndex] = pageSearchText(page);
            } catch {
              pageContentSearchText[rowIndex] = "";
            }
          }),
        );

        if (searchQuery.trim() && section.isConnected) renderRows();
      }

      pageSearchIndexComplete = true;
    })().finally(() => {
      pageSearchIndexPromise = null;
      if (searchQuery.trim() && section.isConnected) renderRows();
    });
  }

  function filteredRows() {
    const terms = searchTermsForQuery(searchQuery);
    if (terms.length > 0) ensurePageContentSearchIndex();

    return rows.filter((row, rowIndex) => {
      const pageId = rowMeta[rowIndex]?.pageId;
      const matchesBookmarks =
        !bookmarksOnly || (pageId && bookmarkedBookIds.has(pageId));
      const matchesTags =
        selectedTags.size === 0 ||
        [...rowTagKeys[rowIndex]].some((tag) => selectedTags.has(tag));

      return matchesBookmarks && matchesTags && rowMatchesSearch(rowIndex, terms);
    });
  }

  function currentRows() {
    const searchableRows = filteredRows();
    const searchTerms = searchTermsForQuery(searchQuery);
    if (searchTerms.length > 0) {
      return searchableRows
        .map((row) => {
          const rowIndex = rows.indexOf(row);
          return {
            row,
            rowIndex,
            relevance: searchRelevanceForRow(rowIndex, searchTerms),
          };
        })
        .sort((a, b) => {
          const relevanceOrder =
            a.relevance.bestField - b.relevance.bestField ||
            b.relevance.bestFieldMatches - a.relevance.bestFieldMatches ||
            a.relevance.totalRank - b.relevance.totalRank ||
            a.relevance.worstField - b.relevance.worstField;
          if (relevanceOrder) return relevanceOrder;

          return (
            compareSpreadsheetValues(
              a.row[defaultSortState.columnIndex],
              b.row[defaultSortState.columnIndex],
            ) || a.rowIndex - b.rowIndex
          );
        })
        .map((entry) => entry.row);
    }

    if (randomRowRanks) {
      return [...searchableRows].sort(
        (a, b) =>
          (randomRowRanks.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (randomRowRanks.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    if (!sortState) return searchableRows;

    return searchableRows
      .map((row, originalIndex) => ({ row, originalIndex }))
      .sort((a, b) => {
        const aValue = String(a.row[sortState.columnIndex] ?? "").trim();
        const bValue = String(b.row[sortState.columnIndex] ?? "").trim();
        const columnLabel = columns[sortState.columnIndex];
        if (!aValue && bValue) return 1;
        if (aValue && !bValue) return -1;

        const result = compareSpreadsheetValues(
          spreadsheetSortValue(aValue, columnLabel),
          spreadsheetSortValue(bValue, columnLabel),
        );
        const valueResult =
          result ||
          compareSpreadsheetValues(
            a.row[sortState.columnIndex],
            b.row[sortState.columnIndex],
          );
        const ordered = valueResult || a.originalIndex - b.originalIndex;
        return sortState.direction === "asc" ? ordered : -ordered;
      })
      .map((entry) => entry.row);
  }

  function gallerySortOptionLabel(label, direction) {
    if (label === "Released") {
      return `${label} ${direction === "asc" ? "oldest first" : "newest first"}`;
    }

    return `${label} ${direction === "asc" ? "A-Z" : "Z-A"}`;
  }

  function populateGallerySortOptions() {
    gallerySortSelect.innerHTML = "";

    const relevanceOption = new Option("Relevance", "relevance");
    relevanceOption.hidden = true;
    relevanceOption.disabled = true;
    gallerySortSelect.append(relevanceOption);

    columns.forEach((label, columnIndex) => {
      gallerySortSelect.append(
        new Option(gallerySortOptionLabel(label, "asc"), `${columnIndex}:asc`),
        new Option(gallerySortOptionLabel(label, "desc"), `${columnIndex}:desc`),
      );
    });

    const randomActiveOption = new Option("Random", "random-active");
    randomActiveOption.hidden = true;
    randomActiveOption.disabled = true;
    gallerySortSelect.append(randomActiveOption, new Option("Random", "random"));
  }

  function sortStateToGalleryValue() {
    return sortState ? `${sortState.columnIndex}:${sortState.direction}` : "";
  }

  function renderGallerySortControl() {
    if (searchTermsForQuery(searchQuery).length > 0) {
      gallerySortSelect.value = "relevance";
      return;
    }

    if (randomRowRanks) {
      gallerySortSelect.value = "random-active";
      return;
    }

    const value = sortStateToGalleryValue();
    const hasValue = [...gallerySortSelect.options].some((option) => option.value === value);
    gallerySortSelect.value = hasValue ? value : "";
  }

  function renderSearchControls() {
    const hasSearch = searchTermsForQuery(searchQuery).length > 0;
    searchControls.classList.toggle("is-popup-open", searchPopupOpen);
    searchControls.classList.toggle("has-active-search", hasSearch);
    searchToggle.setAttribute("aria-expanded", searchPopupOpen ? "true" : "false");
    searchToggle.setAttribute(
      "aria-label",
      hasSearch ? `Edit book search: ${searchQuery.trim()}` : "Search books",
    );
    searchToggle.title = hasSearch ? "Edit search" : "Search books";
  }

  function setSearchPopupOpen(isOpen, focusInput = true) {
    searchPopupOpen = Boolean(isOpen);
    renderSearchControls();

    if (searchPopupOpen && focusInput) {
      requestAnimationFrame(() => {
        searchInput.focus();
      });
    }
  }

  let filterTagsResizeFrame = null;

  function sizeFilterTagsToViewport() {
    if (filterTagsResizeFrame !== null) cancelAnimationFrame(filterTagsResizeFrame);

    if (!filtersOpen) {
      filterTags.style.removeProperty("max-height");
      filterTagsResizeFrame = null;
      return;
    }

    filterTagsResizeFrame = requestAnimationFrame(() => {
      filterTagsResizeFrame = null;
      if (!section.isConnected || !filtersOpen) return;

      const viewportBottomGap = 16;
      const listTop = filterTags.getBoundingClientRect().top;
      const availableHeight = Math.max(
        96,
        Math.floor(window.innerHeight - listTop - viewportBottomGap),
      );
      filterTags.style.maxHeight = `${availableHeight}px`;
    });
  }

  function renderFilterControls() {
    section.classList.toggle("is-filters-open", filtersOpen);
    filterToggle.classList.toggle("is-active", filtersOpen);
    filterToggle.classList.toggle("has-active-filters", selectedTags.size > 0);
    filterToggle.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    filterToggle.setAttribute("aria-pressed", filtersOpen ? "true" : "false");
    filterToggle.setAttribute(
      "aria-label",
      filtersOpen
        ? "Close sort and tag filters"
        : selectedTags.size > 0
          ? `Open sort and tag filters, ${selectedTags.size} selected`
          : "Open sort and tag filters",
    );
    filterToggle.title = filtersOpen ? "Close filters" : "Sort and filter";
    filterPanel.setAttribute("aria-hidden", filtersOpen ? "false" : "true");
    const clearTagFiltersHidden = selectedTags.size === 0;
    clearTagFilters.classList.toggle("is-hidden", clearTagFiltersHidden);
    clearTagFilters.disabled = clearTagFiltersHidden;
    clearTagFilters.setAttribute("aria-hidden", clearTagFiltersHidden ? "true" : "false");
    clearTagFilters.setAttribute(
      "aria-label",
      `Clear all ${selectedTags.size} selected tag filter${selectedTags.size === 1 ? "" : "s"}`,
    );

    filterTags.querySelectorAll("[data-tag-key]").forEach((button) => {
      const isSelected = selectedTags.has(button.dataset.tagKey);
      button.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    sizeFilterTagsToViewport();
  }

  function renderBookmarkControls() {
    section.classList.toggle("is-bookmarks-only", bookmarksOnly);
    bookmarkFilterToggle.classList.toggle("is-active", bookmarksOnly);
    bookmarkFilterToggle.setAttribute("aria-pressed", bookmarksOnly ? "true" : "false");
    bookmarkFilterToggle.setAttribute(
      "aria-label",
      bookmarksOnly
        ? `Show all books; currently showing ${bookmarkedBookIds.size} bookmarked book${
            bookmarkedBookIds.size === 1 ? "" : "s"
          }`
        : `Show ${bookmarkedBookIds.size} bookmarked book${
            bookmarkedBookIds.size === 1 ? "" : "s"
          } only`,
    );
    bookmarkFilterToggle.title = bookmarksOnly ? "Show all books" : "Show bookmarked books";

    gallery.querySelectorAll("[data-bookmark-id]").forEach((button) => {
      const pageId = button.dataset.bookmarkId;
      const isBookmarked = bookmarkedBookIds.has(pageId);
      const title = button.dataset.bookTitle || "book";
      button.classList.toggle("is-bookmarked", isBookmarked);
      button.setAttribute("aria-pressed", isBookmarked ? "true" : "false");
      button.setAttribute(
        "aria-label",
        isBookmarked ? `Remove ${title} from bookmarks` : `Add ${title} to bookmarks`,
      );
      button.title = isBookmarked ? "Remove bookmark" : "Bookmark book";
    });
  }

  function renderPagination(pagination, totalPages) {
    pagination.innerHTML = "";

    const chevronIcon = (direction) => `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="${direction === "previous" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}"></path>
      </svg>
    `;

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className =
      "spreadsheet__page-button spreadsheet__page-button--arrow spreadsheet__page-button--previous";
    previousButton.innerHTML = chevronIcon("previous");
    previousButton.setAttribute("aria-label", "Previous page");
    previousButton.title = "Previous page";
    previousButton.disabled = currentPage === 0;
    previousButton.addEventListener("click", () => {
      if (currentPage === 0) return;
      currentPage -= 1;
      renderRows();
    });
    pagination.append(previousButton);

    function appendPageItems(container, items) {
      for (const item of items) {
        if (item === "ellipsis") {
          const ellipsis = document.createElement("span");
          ellipsis.className = "spreadsheet__pagination-ellipsis";
          ellipsis.textContent = "…";
          ellipsis.setAttribute("aria-label", "More pages");
          container.append(ellipsis);
          continue;
        }

        const pageIndex = item;
        const pageButton = document.createElement("button");
        pageButton.type = "button";
        pageButton.className = "spreadsheet__page-button";
        pageButton.textContent = String(pageIndex + 1);
        if (pageIndex === currentPage) {
          pageButton.classList.add("is-active");
          pageButton.setAttribute("aria-current", "page");
        }
        pageButton.addEventListener("click", () => {
          currentPage = pageIndex;
          renderRows();
        });
        container.append(pageButton);
      }
    }

    const widePages = document.createElement("span");
    widePages.className =
      "spreadsheet__pagination-pages spreadsheet__pagination-pages--wide";
    appendPageItems(widePages, spreadsheetPaginationItems(totalPages, currentPage));

    const compactPages = document.createElement("span");
    compactPages.className =
      "spreadsheet__pagination-pages spreadsheet__pagination-pages--compact";
    appendPageItems(
      compactPages,
      compactSpreadsheetPaginationItems(totalPages, currentPage),
    );

    pagination.append(widePages, compactPages);

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className =
      "spreadsheet__page-button spreadsheet__page-button--arrow spreadsheet__page-button--next";
    nextButton.innerHTML = chevronIcon("next");
    nextButton.setAttribute("aria-label", "Next page");
    nextButton.title = "Next page";
    nextButton.disabled = currentPage >= totalPages - 1;
    nextButton.addEventListener("click", () => {
      if (currentPage >= totalPages - 1) return;
      currentPage += 1;
      renderRows();
    });
    pagination.append(nextButton);
  }

  function renderSortHeaders() {
    for (const th of headerRow.querySelectorAll("[data-column-label]")) {
      const columnIndex = columns.indexOf(th.dataset.columnLabel);
      const isActive = sortState?.columnIndex === columnIndex;
      const button = th.querySelector("button");

      th.classList.toggle("is-sorted", isActive);
      th.classList.toggle("is-sorted-asc", isActive && sortState.direction === "asc");
      th.classList.toggle("is-sorted-desc", isActive && sortState.direction === "desc");
      th.setAttribute(
        "aria-sort",
        isActive ? (sortState.direction === "asc" ? "ascending" : "descending") : "none",
      );
      button.setAttribute(
        "aria-label",
        isActive
          ? `Sort by ${th.dataset.columnLabel}, ${sortState.direction === "asc" ? "ascending" : "descending"}`
          : `Sort by ${th.dataset.columnLabel}`,
      );
    }
  }

  function renderEditToggle() {
    section.classList.toggle("is-editing", editMode);
    editToggle.classList.toggle("is-active", editMode);
    editToggle.setAttribute("aria-pressed", editMode ? "true" : "false");
    editToggle.setAttribute(
      "aria-label",
      editMode ? "Disable spreadsheet editing" : "Enable spreadsheet editing",
    );
    editToggle.title = editMode ? "Exit edit mode" : "Edit spreadsheet";
  }

  function renderViewToggle() {
    const isGallery = layoutMode === "gallery";

    section.classList.toggle("is-gallery-view", isGallery);
    section.classList.toggle("is-spreadsheet-view", !isGallery);
    viewToggle.setAttribute(
      "aria-label",
      isGallery ? "Switch to spreadsheet view" : "Switch to gallery view",
    );
    viewToggle.title = isGallery ? "Spreadsheet view" : "Gallery view";
    viewToggle.innerHTML = isGallery
      ? `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 7h12"></path>
          <path d="M6 12h12"></path>
          <path d="M6 17h12"></path>
        </svg>
      `
      : `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 5h5v5H5z"></path>
          <path d="M14 5h5v5h-5z"></path>
          <path d="M5 14h5v5H5z"></path>
          <path d="M14 14h5v5h-5z"></path>
        </svg>
      `;
  }

  function renderSpreadsheetRows(visibleRows) {
    visibleRows.forEach((row, visibleIndex) => {
      const rowIndex = rows.indexOf(row);
      const tr = document.createElement("tr");
      const metadata = rowMeta[rowIndex] ?? {};
      const title = columnValue(row, "Title");

      const coverCell = document.createElement("td");
      coverCell.className = "spreadsheet__cover-cell";
      coverCell.append(renderCoverFrame(metadata, title));
      tr.append(coverCell);

      row.forEach((value, columnIndex) => {
        const td = document.createElement("td");
        td.contentEditable = editMode ? "true" : "false";
        td.spellcheck = false;
        td.dataset.row = String(rowIndex);
        td.dataset.column = String(columnIndex);
        td.dataset.placeholder = " ";

        if (!editMode && columns[columnIndex] === "Title" && metadata.href) {
          const link = document.createElement("a");
          link.className = "spreadsheet__title-link";
          link.href = metadata.href;
          link.textContent = value;
          externalLinkAttributes(link, metadata.href);
          td.append(link);
        } else {
          td.textContent = value;
        }
        tr.append(td);
      });

      tbody.append(tr);
    });
  }

  function renderGalleryRows(visibleRows) {
    visibleRows.forEach((row) => {
      const rowIndex = rows.indexOf(row);
      const metadata = rowMeta[rowIndex] ?? {};
      const title = columnValue(row, "Title") || "Untitled";
      const creators = columnValue(row, "Creator(s)");
      const released = columnValue(row, "Released");
      const tags = tagsForRow(row);
      const showTags = sortState?.columnIndex === tagsColumnIndex;

      const card = document.createElement("article");
      card.className = "spreadsheet__gallery-card";
      card.setAttribute("role", "listitem");

      const coverSlot = document.createElement("div");
      coverSlot.className = "spreadsheet__gallery-cover-slot";
      coverSlot.append(renderCoverFrame(metadata, title, "gallery"));
      card.append(coverSlot);

      const titleElement = document.createElement("h3");
      titleElement.className = "spreadsheet__gallery-title";
      if (metadata.href) {
        const link = document.createElement("a");
        link.className = "spreadsheet__gallery-title-link";
        link.href = metadata.href;
        link.textContent = title;
        externalLinkAttributes(link, metadata.href);
        titleElement.append(link);
      } else {
        titleElement.textContent = title;
      }
      card.append(titleElement);

      if (creators) {
        const creatorElement = document.createElement("p");
        creatorElement.className = "spreadsheet__gallery-creator";
        creatorElement.textContent = creators;
        card.append(creatorElement);
      }

      if (released) {
        const releaseElement = document.createElement("p");
        releaseElement.className = "spreadsheet__gallery-released";
        releaseElement.textContent = released;
        card.append(releaseElement);
      }

      if (showTags) {
        const tagsElement = document.createElement("p");
        tagsElement.className = "spreadsheet__gallery-tags";
        tagsElement.setAttribute("aria-label", tags.length > 0 ? "Book tags" : "No book tags");

        if (tags.length > 0) {
          tags.forEach((tag) => {
            const tagElement = document.createElement("span");
            tagElement.className = "spreadsheet__gallery-tag";
            tagElement.textContent = `#${tag.toLocaleLowerCase()}`;
            tagsElement.append(tagElement);
          });
        } else {
          tagsElement.classList.add("is-empty");
          tagsElement.textContent = "\u00a0";
        }

        card.append(tagsElement);
      }

      if (metadata.pageId) {
        const bookmarkButton = document.createElement("button");
        bookmarkButton.type = "button";
        bookmarkButton.className = "spreadsheet__gallery-bookmark-button";
        bookmarkButton.dataset.bookmarkId = metadata.pageId;
        bookmarkButton.dataset.bookTitle = title;
        bookmarkButton.innerHTML = `
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 4.5h10v15l-5-3-5 3v-15Z"></path>
          </svg>
        `;
        bookmarkButton.addEventListener("click", () => {
          if (bookmarkedBookIds.has(metadata.pageId)) {
            bookmarkedBookIds.delete(metadata.pageId);
          } else {
            bookmarkedBookIds.add(metadata.pageId);
          }

          saveBookmarkedBookIds(bookmarkedBookIds);
          if (bookmarksOnly) {
            renderRows();
          } else {
            renderBookmarkControls();
          }
        });
        card.append(bookmarkButton);

        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "spreadsheet__gallery-preview-button";
        previewButton.dataset.bookPreviewId = metadata.pageId;
        previewButton.setAttribute("aria-label", `Open ${title} in the book preview panel`);
        previewButton.setAttribute("aria-pressed", "false");
        previewButton.title = "Open book preview";
        previewButton.innerHTML = `
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4.5 5h15v14h-15z"></path>
            <path d="M14 5v14"></path>
            <path d="m8.5 9 3 3-3 3"></path>
          </svg>
        `;
        previewButton.addEventListener("click", () => {
          openBookPreview(metadata.pageId, title);
        });
        card.append(previewButton);
      }

      gallery.append(card);
    });
  }

  function renderEmptyRows() {
    const message =
      bookmarksOnly
        ? bookmarkedBookIds.size === 0
          ? "No bookmarked books yet."
          : "No bookmarked books match the current filters."
        : selectedTags.size > 0
        ? "No books match the selected filters."
        : searchQuery.trim()
          ? `No books match "${searchQuery.trim()}".`
          : "No books to show.";

    if (layoutMode === "gallery") {
      const empty = document.createElement("p");
      empty.className = "spreadsheet__empty";
      empty.textContent = message;
      gallery.append(empty);
      return;
    }

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "spreadsheet__empty-cell";
    td.colSpan = columns.length + 1;
    td.textContent = message;
    tr.append(td);
    tbody.append(tr);
  }

  function renderRows() {
    const sortedRows = currentRows();
    const totalPages = Math.max(1, Math.ceil(sortedRows.length / FULL_TEXT_DATABASE_PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    saveCurrentViewState();

    const start = currentPage * FULL_TEXT_DATABASE_PAGE_SIZE;
    const end = Math.min(start + FULL_TEXT_DATABASE_PAGE_SIZE, sortedRows.length);
    const visibleRows = sortedRows.slice(start, end);

    renderViewToggle();
    renderFilterControls();
    renderSortHeaders();
    renderGallerySortControl();
    renderSearchControls();
    renderPagination(topPagination, totalPages);
    renderPagination(bottomPagination, totalPages);

    tbody.innerHTML = "";
    gallery.innerHTML = "";

    if (layoutMode === "gallery") {
      renderGalleryRows(visibleRows);
    } else {
      renderSpreadsheetRows(visibleRows);
    }

    if (visibleRows.length === 0) renderEmptyRows();
    renderBookmarkControls();
    syncBookPreviewButtons();

    if (pendingFocus) {
      const nextFocus = pendingFocus;
      pendingFocus = null;
      requestAnimationFrame(() => {
        focusSpreadsheetCell(tbody, nextFocus.rowIndex, nextFocus.columnIndex);
      });
    }
  }

  tbody.addEventListener("input", (event) => {
    if (!editMode) return;
    const cell = event.target.closest("[contenteditable='true']");
    if (!cell) return;

    const rowIndex = Number(cell.dataset.row);
    const columnIndex = Number(cell.dataset.column);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;

    rows[rowIndex][columnIndex] = cell.textContent ?? "";
    if (columnIndex === tagsColumnIndex) {
      rowTagKeys[rowIndex] = new Set(
        tagsForRow(rows[rowIndex]).map(normalizeSpreadsheetTagKey).filter(Boolean),
      );
    }
    const searchFieldIndex = searchFieldColumnIndices.indexOf(columnIndex);
    if (searchFieldIndex >= 0) {
      rowSearchFields[rowIndex][searchFieldIndex] = normalizeSearchText(
        rows[rowIndex][columnIndex],
      );
    }
    saveSpreadsheetRows(rows, columns, sourceRows);
  });

  tbody.addEventListener("keydown", (event) => {
    if (!editMode) return;
    const cell = event.target.closest("[contenteditable='true']");
    if (!cell || event.key !== "Enter") return;

    event.preventDefault();
    const rowIndex = Number(cell.dataset.row);
    const columnIndex = Number(cell.dataset.column);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;

    const sortedRows = currentRows();
    const sortedIndex = sortedRows.indexOf(rows[rowIndex]);
    const nextSortedIndex = Math.min(sortedIndex + 1, sortedRows.length - 1);
    const nextRowIndex = rows.indexOf(sortedRows[nextSortedIndex]);

    currentPage = Math.floor(nextSortedIndex / FULL_TEXT_DATABASE_PAGE_SIZE);
    pendingFocus = { rowIndex: nextRowIndex, columnIndex };
    renderRows();
  });

  editToggle.addEventListener("click", () => {
    editMode = !editMode;
    renderEditToggle();
    renderRows();
  });

  viewToggle.addEventListener("click", () => {
    layoutMode = layoutMode === "gallery" ? "spreadsheet" : "gallery";
    pendingFocus = null;
    renderRows();
  });

  filterToggle.addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    renderFilterControls();
    saveCurrentViewState();
  });

  bookmarkFilterToggle.addEventListener("click", () => {
    bookmarksOnly = !bookmarksOnly;
    currentPage = 0;
    pendingFocus = null;
    renderRows();
  });

  gallerySortSelect.addEventListener("change", () => {
    if (gallerySortSelect.value === "random") {
      const shuffledRows = [...rows];
      for (let index = shuffledRows.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffledRows[index], shuffledRows[swapIndex]] = [
          shuffledRows[swapIndex],
          shuffledRows[index],
        ];
      }

      randomRowRanks = new Map(shuffledRows.map((row, index) => [row, index]));
      sortState = null;
      currentPage = 0;
      pendingFocus = null;
      renderRows();
      return;
    }

    randomRowRanks = null;
    const [columnIndexValue, direction] = gallerySortSelect.value.split(":");
    const columnIndex = Number(columnIndexValue);

    sortState =
      Number.isInteger(columnIndex) &&
      columnIndex >= 0 &&
      columnIndex < columns.length &&
      (direction === "asc" || direction === "desc")
        ? { columnIndex, direction }
        : defaultSortState;
    currentPage = 0;
    pendingFocus = null;
    renderRows();
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    currentPage = 0;
    pendingFocus = null;
    renderRows();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setSearchPopupOpen(false, false);
    searchToggle.focus();
  });

  searchToggle.addEventListener("click", () => {
    setSearchPopupOpen(!searchPopupOpen);
  });

  table.append(tbody);
  scroll.append(table);
  populateGallerySortOptions();
  toolbar.append(toolbarModes, topPagination, searchControls);
  stage.append(scroll, gallery, bottomPagination);
  workspace.append(filterPanel, stage);
  section.append(
    toolbar,
    workspace,
    editToggle,
  );
  spreadsheetViewportAbortController?.abort();
  spreadsheetViewportAbortController = new AbortController();
  updateSpreadsheetFilterViewport = sizeFilterTagsToViewport;
  window.addEventListener("resize", sizeFilterTagsToViewport, {
    signal: spreadsheetViewportAbortController.signal,
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (searchPopupOpen && !searchControls.contains(event.target)) {
        setSearchPopupOpen(false, false);
      }
    },
    { signal: spreadsheetViewportAbortController.signal },
  );
  renderEditToggle();
  renderViewToggle();
  renderRows();
  return section;
}

async function renderFolksDatabaseSpreadsheet() {
  const { columns, rows, rowMeta, lists } = await loadFolksDatabasePayload();
  const nameColumnIndex = Math.max(0, columns.indexOf("Name"));
  const listColumnIndex = Math.max(0, columns.indexOf("List"));
  const defaultSortState = { columnIndex: nameColumnIndex, direction: "asc" };
  const rowIndexByRow = new Map(rows.map((row, rowIndex) => [row, rowIndex]));
  const availableListLabels = new Map(
    lists.map((label) => [normalizeSpreadsheetTagKey(label), label]),
  );

  rows.forEach((row) => {
    String(row[listColumnIndex] ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .forEach((label) => {
        const key = normalizeSpreadsheetTagKey(label);
        if (key && !availableListLabels.has(key)) availableListLabels.set(key, label);
      });
  });

  let savedState = {};
  try {
    savedState = JSON.parse(
      window.localStorage.getItem(FOLKS_DATABASE_VIEW_STORAGE_KEY) ?? "{}",
    );
  } catch {}

  let currentPage = Number.isInteger(savedState.currentPage) ? savedState.currentPage : 0;
  let layoutMode = savedState.layoutMode
    ? normalizeSpreadsheetLayoutMode(savedState.layoutMode)
    : "gallery";
  let filtersOpen = Boolean(savedState.filtersOpen);
  let sortState =
    normalizeSpreadsheetSortState(savedState.sortState, columns) ?? defaultSortState;
  let selectedLists = new Set(
    normalizeSpreadsheetSelectedTags(savedState.selectedLists).filter((key) =>
      availableListLabels.has(key),
    ),
  );
  let randomRowRanks = null;
  let searchQuery = "";
  let searchPopupOpen = false;
  let pageSearchIndexPromise = null;
  let pageSearchIndexComplete = false;

  const route = currentHashRoute();
  if (route.searchParams.has("list")) {
    selectedLists = new Set(
      route.searchParams
        .getAll("list")
        .map(normalizeSpreadsheetTagKey)
        .filter((key) => availableListLabels.has(key)),
    );
    filtersOpen = true;
    currentPage = 0;
    route.searchParams.delete("list");
    const remainingQuery = route.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${routeForPage(FOLKS_DATABASE_PAGE_ID)}${remainingQuery ? `?${remainingQuery}` : ""}`,
    );
  }

  const rowListKeys = rows.map(
    (row) =>
      new Set(
        String(row[listColumnIndex] ?? "")
          .split(",")
          .map(normalizeSpreadsheetTagKey)
          .filter(Boolean),
      ),
  );
  const rowSearchFields = rows.map((row) => [
    normalizeSearchText(row[nameColumnIndex]),
    normalizeSearchText(row[listColumnIndex]),
  ]);
  const pageContentSearchText = new Array(rows.length).fill("");

  const section = document.createElement("section");
  section.className = "spreadsheet spreadsheet--folks";

  const toolbar = document.createElement("div");
  toolbar.className = "spreadsheet__toolbar";

  const toolbarModes = document.createElement("div");
  toolbarModes.className = "spreadsheet__toolbar-modes";

  const filterToggle = document.createElement("button");
  filterToggle.type = "button";
  filterToggle.className = "spreadsheet__filter-toggle";
  filterToggle.setAttribute("aria-controls", "folks-database-filters");
  filterToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 5.5h15l-6 7v5l-3 1.5v-6.5l-6-7Z"></path>
    </svg>
  `;

  const viewToggle = document.createElement("button");
  viewToggle.type = "button";
  viewToggle.className = "spreadsheet__toolbar-view-toggle spreadsheet__view-toggle";
  toolbarModes.append(filterToggle, viewToggle);

  const topPagination = document.createElement("nav");
  topPagination.className = "spreadsheet__pagination";
  topPagination.setAttribute("aria-label", "Folks database pages");

  const bottomPagination = document.createElement("nav");
  bottomPagination.className = "spreadsheet__pagination spreadsheet__pagination--bottom";
  bottomPagination.setAttribute("aria-label", "Folks database pages");

  const searchControls = document.createElement("div");
  searchControls.className = "spreadsheet__search";

  const searchToggle = document.createElement("button");
  searchToggle.type = "button";
  searchToggle.className = "spreadsheet__search-label spreadsheet__search-toggle";
  searchToggle.setAttribute("aria-controls", "folks-database-search-input");
  searchToggle.setAttribute("aria-expanded", "false");
  searchToggle.setAttribute("aria-label", "Search folks");
  searchToggle.title = "Search folks";
  searchToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m16 16 4 4"></path>
    </svg>
  `;

  const searchInputWrap = document.createElement("span");
  searchInputWrap.className = "spreadsheet__search-input-wrap";

  const searchInput = document.createElement("input");
  searchInput.id = "folks-database-search-input";
  searchInput.className = "spreadsheet__search-input";
  searchInput.type = "search";
  searchInput.placeholder = "Search folks";
  searchInput.setAttribute("aria-label", "Search folks");
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInputWrap.append(searchInput);
  searchControls.append(searchToggle, searchInputWrap);

  const workspace = document.createElement("div");
  workspace.className = "spreadsheet__workspace";

  const filterPanel = document.createElement("aside");
  filterPanel.id = "folks-database-filters";
  filterPanel.className = "spreadsheet__filter-panel";
  filterPanel.setAttribute("aria-label", "Sort and filter folks");

  const filterPanelInner = document.createElement("div");
  filterPanelInner.className = "spreadsheet__filter-panel-inner";

  const sortControls = document.createElement("div");
  sortControls.className = "spreadsheet__filter-sort";

  const sortLabel = document.createElement("label");
  sortLabel.className = "spreadsheet__filter-label";
  sortLabel.htmlFor = "folks-database-sort";
  sortLabel.textContent = "Sort by";

  const sortSelectWrap = document.createElement("span");
  sortSelectWrap.className = "spreadsheet__filter-select-wrap";

  const sortSelect = document.createElement("select");
  sortSelect.id = "folks-database-sort";
  sortSelect.className = "spreadsheet__filter-select";
  sortSelect.setAttribute("aria-label", "Sort folks by");
  sortSelectWrap.append(sortSelect);
  sortControls.append(sortLabel, sortSelectWrap);

  const filterListsHeader = document.createElement("div");
  filterListsHeader.className = "spreadsheet__filter-tags-header";

  const filterListsHeading = document.createElement("h3");
  filterListsHeading.className = "spreadsheet__filter-heading";
  filterListsHeading.textContent = "Lists";

  const clearListFilters = document.createElement("button");
  clearListFilters.type = "button";
  clearListFilters.className = "spreadsheet__clear-tag-filters is-hidden";
  clearListFilters.textContent = "×";
  clearListFilters.title = "Clear all list filters";
  clearListFilters.setAttribute("aria-label", "Clear all list filters");
  filterListsHeader.append(filterListsHeading, clearListFilters);

  const filterLists = document.createElement("div");
  filterLists.className = "spreadsheet__filter-tags spreadsheet__filter-lists";

  [...availableListLabels.entries()].forEach(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spreadsheet__tag-filter spreadsheet__list-filter";
    button.dataset.listKey = key;
    button.textContent = label;
    button.setAttribute("aria-label", `Filter by ${label}`);
    button.addEventListener("click", () => {
      if (selectedLists.has(key)) selectedLists.delete(key);
      else selectedLists.add(key);
      currentPage = 0;
      renderRows();
    });
    filterLists.append(button);
  });

  clearListFilters.addEventListener("click", () => {
    selectedLists.clear();
    currentPage = 0;
    renderRows();
  });

  filterPanelInner.append(sortControls, filterListsHeader, filterLists);
  filterPanel.append(filterPanelInner);

  const stage = document.createElement("div");
  stage.className = "spreadsheet__stage";

  const scroll = document.createElement("div");
  scroll.className = "spreadsheet__scroll";

  const table = document.createElement("table");
  table.className = "spreadsheet__table";

  const colgroup = document.createElement("colgroup");
  const portraitCol = document.createElement("col");
  portraitCol.className = "spreadsheet__col spreadsheet__col--cover";
  colgroup.append(portraitCol);
  columns.forEach((label) => {
    const col = document.createElement("col");
    col.className = `spreadsheet__col spreadsheet__col--${spreadsheetColumnClass(label)}`;
    colgroup.append(col);
  });
  table.append(colgroup);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const portraitHeader = document.createElement("th");
  portraitHeader.className = "spreadsheet__cover-header";
  portraitHeader.scope = "col";
  portraitHeader.setAttribute("aria-label", "Portrait or icon");
  headerRow.append(portraitHeader);

  columns.forEach((label, columnIndex) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.columnLabel = label;
    th.className = `spreadsheet__column-header spreadsheet__column-header--${spreadsheetColumnClass(label)}`;
    th.innerHTML = `
      <button class="spreadsheet__sort-button" type="button">
        <span>${escapeHtml(label)}</span>
        <span class="spreadsheet__sort-indicator" aria-hidden="true"></span>
      </button>
    `;
    th.addEventListener("click", () => {
      randomRowRanks = null;
      sortState =
        sortState.columnIndex === columnIndex
          ? {
              columnIndex,
              direction: sortState.direction === "asc" ? "desc" : "asc",
            }
          : { columnIndex, direction: "asc" };
      currentPage = 0;
      renderRows();
    });
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  table.append(tbody);
  scroll.append(table);

  const gallery = document.createElement("div");
  gallery.className = "spreadsheet__gallery";
  gallery.setAttribute("role", "list");
  gallery.setAttribute("aria-label", "Folks gallery");

  function saveViewState() {
    try {
      window.localStorage.setItem(
        FOLKS_DATABASE_VIEW_STORAGE_KEY,
        JSON.stringify({
          currentPage,
          layoutMode,
          filtersOpen,
          sortState,
          selectedLists: [...selectedLists],
        }),
      );
    } catch {}
  }

  function columnValue(row, label) {
    const columnIndex = columns.indexOf(label);
    return columnIndex >= 0 ? row[columnIndex] ?? "" : "";
  }

  function renderPersonVisual(metadata, name, variant = "table") {
    const isGallery = variant === "gallery";
    const hasLink = Boolean(metadata.href);
    const frame = document.createElement(hasLink ? "a" : "span");
    frame.className = isGallery
      ? "spreadsheet__cover-frame spreadsheet__cover-frame--gallery folks-database__visual"
      : "spreadsheet__cover-frame folks-database__visual";
    if (hasLink) {
      frame.href = metadata.href;
      frame.setAttribute("aria-label", `Open ${name}`);
    }

    if (metadata.image) {
      const image = document.createElement("img");
      image.className = isGallery
        ? "spreadsheet__cover-thumb spreadsheet__cover-thumb--gallery folks-database__portrait folks-database__portrait--gallery"
        : "spreadsheet__cover-thumb folks-database__portrait";
      image.src = metadata.image;
      image.alt = `${name} portrait`;
      image.loading = "lazy";
      frame.append(image);
      return frame;
    }

    const icon = document.createElement("span");
    icon.className = isGallery
      ? "folks-database__icon folks-database__icon--gallery"
      : "folks-database__icon";
    icon.innerHTML = renderIconMarkup(metadata.icon || "👤", "folks-database__icon-mark");
    frame.append(icon);
    return frame;
  }

  function ensurePageContentSearchIndex() {
    if (pageSearchIndexPromise || pageSearchIndexComplete) return;
    const pagesToIndex = rowMeta
      .map((metadata, rowIndex) => ({ pageId: metadata?.pageId, rowIndex }))
      .filter(({ pageId }) => pageId);

    pageSearchIndexPromise = (async () => {
      const batchSize = 24;
      for (let index = 0; index < pagesToIndex.length; index += batchSize) {
        await Promise.all(
          pagesToIndex.slice(index, index + batchSize).map(async ({ pageId, rowIndex }) => {
            try {
              pageContentSearchText[rowIndex] = pageSearchText(await loadPage(pageId));
            } catch {
              pageContentSearchText[rowIndex] = "";
            }
          }),
        );
        if (searchQuery.trim() && section.isConnected) renderRows();
      }
      pageSearchIndexComplete = true;
    })().finally(() => {
      pageSearchIndexPromise = null;
      if (searchQuery.trim() && section.isConnected) renderRows();
    });
  }

  function rowMatchesSearch(rowIndex, terms) {
    if (terms.length === 0) return true;
    const searchableText = `${rowSearchFields[rowIndex].join(" ")} ${pageContentSearchText[rowIndex]}`;
    return terms.every((term) => searchableText.includes(term));
  }

  function searchRelevance(rowIndex, terms) {
    const fields = [...rowSearchFields[rowIndex], pageContentSearchText[rowIndex]];
    const ranks = terms.map((term) => {
      const fieldIndex = fields.findIndex((field) => field.includes(term));
      return fieldIndex >= 0 ? fieldIndex : fields.length;
    });
    const bestField = Math.min(...ranks);
    return {
      bestField,
      bestFieldMatches: terms.filter((term) => fields[bestField]?.includes(term)).length,
      totalRank: ranks.reduce((total, rank) => total + rank, 0),
      worstField: Math.max(...ranks),
    };
  }

  function filteredRows() {
    const terms = searchTermsForQuery(searchQuery);
    if (terms.length > 0) ensurePageContentSearchIndex();

    return rows.filter((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const matchesLists =
        selectedLists.size === 0 ||
        [...rowListKeys[rowIndex]].some((key) => selectedLists.has(key));
      return matchesLists && rowMatchesSearch(rowIndex, terms);
    });
  }

  function currentRows() {
    const matchingRows = filteredRows();
    const terms = searchTermsForQuery(searchQuery);
    if (terms.length > 0) {
      return matchingRows
        .map((row) => {
          const rowIndex = rowIndexByRow.get(row);
          return { row, rowIndex, relevance: searchRelevance(rowIndex, terms) };
        })
        .sort((left, right) => {
          const relevanceOrder =
            left.relevance.bestField - right.relevance.bestField ||
            right.relevance.bestFieldMatches - left.relevance.bestFieldMatches ||
            left.relevance.totalRank - right.relevance.totalRank ||
            left.relevance.worstField - right.relevance.worstField;
          if (relevanceOrder) return relevanceOrder;
          return (
            compareSpreadsheetValues(
              creatorSurnameSortValue(left.row[nameColumnIndex]),
              creatorSurnameSortValue(right.row[nameColumnIndex]),
            ) || left.rowIndex - right.rowIndex
          );
        })
        .map(({ row }) => row);
    }

    if (randomRowRanks) {
      return [...matchingRows].sort(
        (left, right) => randomRowRanks.get(left) - randomRowRanks.get(right),
      );
    }

    return matchingRows
      .map((row) => ({ row, rowIndex: rowIndexByRow.get(row) }))
      .sort((left, right) => {
        const columnLabel = columns[sortState.columnIndex];
        const result = compareSpreadsheetValues(
          spreadsheetSortValue(left.row[sortState.columnIndex], columnLabel),
          spreadsheetSortValue(right.row[sortState.columnIndex], columnLabel),
        );
        const ordered = result || left.rowIndex - right.rowIndex;
        return sortState.direction === "asc" ? ordered : -ordered;
      })
      .map(({ row }) => row);
  }

  function populateSortOptions() {
    sortSelect.innerHTML = "";
    const relevanceOption = new Option("Relevance", "relevance");
    relevanceOption.hidden = true;
    relevanceOption.disabled = true;
    sortSelect.append(relevanceOption);
    columns.forEach((label, columnIndex) => {
      sortSelect.append(
        new Option(`${label} A-Z`, `${columnIndex}:asc`),
        new Option(`${label} Z-A`, `${columnIndex}:desc`),
      );
    });
    const randomActive = new Option("Random", "random-active");
    randomActive.hidden = true;
    randomActive.disabled = true;
    sortSelect.append(randomActive, new Option("Random", "random"));
  }

  function renderSortControls() {
    if (searchTermsForQuery(searchQuery).length > 0) sortSelect.value = "relevance";
    else if (randomRowRanks) sortSelect.value = "random-active";
    else sortSelect.value = `${sortState.columnIndex}:${sortState.direction}`;

    headerRow.querySelectorAll("[data-column-label]").forEach((th) => {
      const columnIndex = columns.indexOf(th.dataset.columnLabel);
      const active = !randomRowRanks && sortState.columnIndex === columnIndex;
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("is-sorted-asc", active && sortState.direction === "asc");
      th.classList.toggle("is-sorted-desc", active && sortState.direction === "desc");
      th.setAttribute(
        "aria-sort",
        active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none",
      );
    });
  }

  function renderViewToggle() {
    const galleryView = layoutMode === "gallery";
    section.classList.toggle("is-gallery-view", galleryView);
    section.classList.toggle("is-spreadsheet-view", !galleryView);
    viewToggle.setAttribute(
      "aria-label",
      galleryView ? "Switch to list view" : "Switch to gallery view",
    );
    viewToggle.title = galleryView ? "List view" : "Gallery view";
    viewToggle.innerHTML = galleryView
      ? `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 7h12"></path><path d="M6 12h12"></path><path d="M6 17h12"></path></svg>`
      : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h5v5H5z"></path><path d="M14 5h5v5h-5z"></path><path d="M5 14h5v5H5z"></path><path d="M14 14h5v5h-5z"></path></svg>`;
  }

  let filterListsResizeFrame = null;
  function sizeFilterListsToViewport() {
    if (filterListsResizeFrame !== null) cancelAnimationFrame(filterListsResizeFrame);
    if (!filtersOpen) {
      filterLists.style.removeProperty("max-height");
      filterListsResizeFrame = null;
      return;
    }

    filterListsResizeFrame = requestAnimationFrame(() => {
      filterListsResizeFrame = null;
      if (!section.isConnected || !filtersOpen) return;
      const listTop = filterLists.getBoundingClientRect().top;
      filterLists.style.maxHeight = `${Math.max(96, Math.floor(window.innerHeight - listTop - 16))}px`;
    });
  }

  function renderFilterControls() {
    const filtersActive = selectedLists.size > 0;
    section.classList.toggle("is-filters-open", filtersOpen);
    filterToggle.classList.toggle("is-active", filtersOpen);
    filterToggle.classList.toggle("has-active-filters", filtersActive);
    filterToggle.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    filterToggle.setAttribute("aria-pressed", filtersOpen ? "true" : "false");
    filterToggle.setAttribute(
      "aria-label",
      filtersOpen
        ? "Close sort and list filters"
        : filtersActive
          ? `Open sort and list filters, ${selectedLists.size} selected`
          : "Open sort and list filters",
    );
    filterToggle.title = filtersOpen ? "Close filters" : "Sort and filter";
    filterPanel.setAttribute("aria-hidden", filtersOpen ? "false" : "true");
    clearListFilters.classList.toggle("is-hidden", !filtersActive);
    clearListFilters.disabled = !filtersActive;
    clearListFilters.setAttribute("aria-hidden", filtersActive ? "false" : "true");
    clearListFilters.setAttribute(
      "aria-label",
      `Clear all ${selectedLists.size} selected list filter${selectedLists.size === 1 ? "" : "s"}`,
    );
    filterLists.querySelectorAll("[data-list-key]").forEach((button) => {
      const selected = selectedLists.has(button.dataset.listKey);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    sizeFilterListsToViewport();
  }

  function renderSearchControls() {
    const hasSearch = searchTermsForQuery(searchQuery).length > 0;
    searchControls.classList.toggle("is-popup-open", searchPopupOpen);
    searchControls.classList.toggle("has-active-search", hasSearch);
    searchToggle.setAttribute("aria-expanded", searchPopupOpen ? "true" : "false");
    searchToggle.setAttribute(
      "aria-label",
      hasSearch ? `Edit folks search: ${searchQuery.trim()}` : "Search folks",
    );
    searchToggle.title = hasSearch ? "Edit search" : "Search folks";
  }

  function setSearchPopupOpen(open, focusInput = true) {
    searchPopupOpen = Boolean(open);
    renderSearchControls();
    if (searchPopupOpen && focusInput) requestAnimationFrame(() => searchInput.focus());
  }

  function renderPagination(pagination, totalPages) {
    pagination.innerHTML = "";
    const chevronIcon = (direction) => `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="${direction === "previous" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}"></path>
      </svg>
    `;

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "spreadsheet__page-button spreadsheet__page-button--arrow";
    previousButton.innerHTML = chevronIcon("previous");
    previousButton.setAttribute("aria-label", "Previous page");
    previousButton.disabled = currentPage === 0;
    previousButton.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage -= 1;
        renderRows();
      }
    });
    pagination.append(previousButton);

    function appendPageItems(container, items) {
      items.forEach((item) => {
        if (item === "ellipsis") {
          const ellipsis = document.createElement("span");
          ellipsis.className = "spreadsheet__pagination-ellipsis";
          ellipsis.textContent = "…";
          container.append(ellipsis);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "spreadsheet__page-button";
        button.textContent = String(item + 1);
        if (item === currentPage) {
          button.classList.add("is-active");
          button.setAttribute("aria-current", "page");
        }
        button.addEventListener("click", () => {
          currentPage = item;
          renderRows();
        });
        container.append(button);
      });
    }

    const widePages = document.createElement("span");
    widePages.className = "spreadsheet__pagination-pages spreadsheet__pagination-pages--wide";
    appendPageItems(widePages, spreadsheetPaginationItems(totalPages, currentPage));
    const compactPages = document.createElement("span");
    compactPages.className = "spreadsheet__pagination-pages spreadsheet__pagination-pages--compact";
    appendPageItems(
      compactPages,
      compactSpreadsheetPaginationItems(totalPages, currentPage),
    );
    pagination.append(widePages, compactPages);

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "spreadsheet__page-button spreadsheet__page-button--arrow";
    nextButton.innerHTML = chevronIcon("next");
    nextButton.setAttribute("aria-label", "Next page");
    nextButton.disabled = currentPage >= totalPages - 1;
    nextButton.addEventListener("click", () => {
      if (currentPage < totalPages - 1) {
        currentPage += 1;
        renderRows();
      }
    });
    pagination.append(nextButton);
  }

  function renderListRows(visibleRows) {
    visibleRows.forEach((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const metadata = rowMeta[rowIndex] ?? {};
      const name = columnValue(row, "Name") || "Untitled";
      const tr = document.createElement("tr");

      const visualCell = document.createElement("td");
      visualCell.className = "spreadsheet__cover-cell";
      visualCell.append(renderPersonVisual(metadata, name));
      tr.append(visualCell);

      row.forEach((value, columnIndex) => {
        const td = document.createElement("td");
        if (columnIndex === nameColumnIndex && metadata.href) {
          const link = document.createElement("a");
          link.className = "spreadsheet__title-link";
          link.href = metadata.href;
          link.textContent = value;
          td.append(link);
        } else {
          td.textContent = value;
        }
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  function renderGalleryRows(visibleRows) {
    visibleRows.forEach((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const metadata = rowMeta[rowIndex] ?? {};
      const name = columnValue(row, "Name") || "Untitled";
      const listLabel = columnValue(row, "List");
      const card = document.createElement("article");
      card.className = "spreadsheet__gallery-card";
      card.setAttribute("role", "listitem");

      const visualSlot = document.createElement("div");
      visualSlot.className = "spreadsheet__gallery-cover-slot";
      visualSlot.append(renderPersonVisual(metadata, name, "gallery"));
      card.append(visualSlot);

      const heading = document.createElement("h3");
      heading.className = "spreadsheet__gallery-title";
      if (metadata.href) {
        const link = document.createElement("a");
        link.className = "spreadsheet__gallery-title-link";
        link.href = metadata.href;
        link.textContent = name;
        heading.append(link);
      } else {
        heading.textContent = name;
      }
      card.append(heading);

      const metadataLine = document.createElement("p");
      metadataLine.className = "spreadsheet__gallery-creator folks-database__list-meta";
      metadataLine.textContent = listLabel;
      card.append(metadataLine);
      gallery.append(card);
    });
  }

  function renderEmpty() {
    const message = selectedLists.size
      ? "No folks match the selected list filters."
      : searchQuery.trim()
        ? `No folks match "${searchQuery.trim()}".`
        : "No folks to show.";
    if (layoutMode === "gallery") {
      const empty = document.createElement("p");
      empty.className = "spreadsheet__empty";
      empty.textContent = message;
      gallery.append(empty);
    } else {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "spreadsheet__empty-cell";
      td.colSpan = columns.length + 1;
      td.textContent = message;
      tr.append(td);
      tbody.append(tr);
    }
  }

  function renderRows() {
    const orderedRows = currentRows();
    const totalPages = Math.max(1, Math.ceil(orderedRows.length / FOLKS_DATABASE_PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    saveViewState();

    const start = currentPage * FOLKS_DATABASE_PAGE_SIZE;
    const visibleRows = orderedRows.slice(start, start + FOLKS_DATABASE_PAGE_SIZE);
    renderViewToggle();
    renderFilterControls();
    renderSortControls();
    renderSearchControls();
    renderPagination(topPagination, totalPages);
    renderPagination(bottomPagination, totalPages);
    tbody.innerHTML = "";
    gallery.innerHTML = "";
    if (layoutMode === "gallery") renderGalleryRows(visibleRows);
    else renderListRows(visibleRows);
    if (visibleRows.length === 0) renderEmpty();
  }

  viewToggle.addEventListener("click", () => {
    layoutMode = layoutMode === "gallery" ? "spreadsheet" : "gallery";
    renderRows();
  });

  filterToggle.addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    renderFilterControls();
    saveViewState();
  });

  sortSelect.addEventListener("change", () => {
    if (sortSelect.value === "random") {
      const shuffledRows = [...rows];
      for (let index = shuffledRows.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffledRows[index], shuffledRows[swapIndex]] = [
          shuffledRows[swapIndex],
          shuffledRows[index],
        ];
      }
      randomRowRanks = new Map(shuffledRows.map((row, index) => [row, index]));
    } else {
      randomRowRanks = null;
      const [columnIndexValue, direction] = sortSelect.value.split(":");
      const columnIndex = Number(columnIndexValue);
      sortState =
        Number.isInteger(columnIndex) &&
        columnIndex >= 0 &&
        columnIndex < columns.length &&
        (direction === "asc" || direction === "desc")
          ? { columnIndex, direction }
          : defaultSortState;
    }
    currentPage = 0;
    renderRows();
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    currentPage = 0;
    renderRows();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setSearchPopupOpen(false, false);
    searchToggle.focus();
  });
  searchToggle.addEventListener("click", () => setSearchPopupOpen(!searchPopupOpen));

  populateSortOptions();
  toolbar.append(toolbarModes, topPagination, searchControls);
  stage.append(scroll, gallery, bottomPagination);
  workspace.append(filterPanel, stage);
  section.append(toolbar, workspace);

  spreadsheetViewportAbortController?.abort();
  spreadsheetViewportAbortController = new AbortController();
  updateSpreadsheetFilterViewport = sizeFilterListsToViewport;
  window.addEventListener("resize", sizeFilterListsToViewport, {
    signal: spreadsheetViewportAbortController.signal,
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (searchPopupOpen && !searchControls.contains(event.target)) {
        setSearchPopupOpen(false, false);
      }
    },
    { signal: spreadsheetViewportAbortController.signal },
  );

  renderRows();
  return section;
}

async function renderShortformDatabaseSpreadsheet() {
  const { columns, rows, rowMeta, types, themes } = await loadShortformDatabasePayload();
  const titleColumnIndex = Math.max(0, columns.indexOf("Title"));
  const creatorColumnIndex = Math.max(0, columns.indexOf("Creator(s)"));
  const typeColumnIndex = Math.max(0, columns.indexOf("Type"));
  const themeColumnIndex = Math.max(0, columns.indexOf("Theme"));
  const defaultSortState = { columnIndex: titleColumnIndex, direction: "asc" };
  const rowIndexByRow = new Map(rows.map((row, rowIndex) => [row, rowIndex]));
  const typeLabels = new Map(types.map((label) => [normalizeSpreadsheetTagKey(label), label]));
  const themeLabels = new Map(
    themes.map((label) => [normalizeSpreadsheetTagKey(label), label]),
  );

  let savedState = {};
  try {
    savedState = JSON.parse(
      window.localStorage.getItem(SHORTFORM_DATABASE_VIEW_STORAGE_KEY) ?? "{}",
    );
  } catch {}

  let currentPage = Number.isInteger(savedState.currentPage) ? savedState.currentPage : 0;
  let layoutMode = savedState.layoutMode
    ? normalizeSpreadsheetLayoutMode(savedState.layoutMode)
    : "gallery";
  let filtersOpen = Boolean(savedState.filtersOpen);
  let bookmarksOnly = Boolean(savedState.bookmarksOnly);
  const bookmarkedShortformIds = loadBookmarkedShortformIds();
  let sortState =
    normalizeSpreadsheetSortState(savedState.sortState, columns) ?? defaultSortState;
  let selectedTypes = new Set(
    normalizeSpreadsheetSelectedTags(savedState.selectedTypes).filter((key) =>
      typeLabels.has(key),
    ),
  );
  let selectedThemes = new Set(
    normalizeSpreadsheetSelectedTags(savedState.selectedThemes).filter((key) =>
      themeLabels.has(key),
    ),
  );
  let randomRowRanks = null;
  let searchQuery = "";
  let searchPopupOpen = false;
  let pageSearchIndexPromise = null;
  let pageSearchIndexComplete = false;

  const route = currentHashRoute();
  const routeHasFilters = route.searchParams.has("type") || route.searchParams.has("theme");
  if (routeHasFilters) {
    selectedTypes = new Set(
      route.searchParams
        .getAll("type")
        .map(normalizeSpreadsheetTagKey)
        .filter((key) => typeLabels.has(key)),
    );
    selectedThemes = new Set(
      route.searchParams
        .getAll("theme")
        .map(normalizeSpreadsheetTagKey)
        .filter((key) => themeLabels.has(key)),
    );
    filtersOpen = true;
    currentPage = 0;
    route.searchParams.delete("type");
    route.searchParams.delete("theme");
    const remainingQuery = route.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${routeForPage(SHORTFORM_DATABASE_PAGE_ID)}${remainingQuery ? `?${remainingQuery}` : ""}`,
    );
  }

  function fieldKeys(row, columnIndex) {
    return new Set(
      String(row[columnIndex] ?? "")
        .split(",")
        .map(normalizeSpreadsheetTagKey)
        .filter(Boolean),
    );
  }

  const rowTypeKeys = rows.map((row) => fieldKeys(row, typeColumnIndex));
  const rowThemeKeys = rows.map((row) => fieldKeys(row, themeColumnIndex));
  const rowSearchFields = rows.map((row) => [
    normalizeSearchText(row[titleColumnIndex]),
    normalizeSearchText(row[creatorColumnIndex]),
    normalizeSearchText(row[typeColumnIndex]),
    normalizeSearchText(row[themeColumnIndex]),
  ]);
  const pageContentSearchText = new Array(rows.length).fill("");

  const section = document.createElement("section");
  section.className = "spreadsheet spreadsheet--shortform";

  const toolbar = document.createElement("div");
  toolbar.className = "spreadsheet__toolbar";
  const toolbarModes = document.createElement("div");
  toolbarModes.className = "spreadsheet__toolbar-modes";

  const filterToggle = document.createElement("button");
  filterToggle.type = "button";
  filterToggle.className = "spreadsheet__filter-toggle";
  filterToggle.setAttribute("aria-controls", "shortform-database-filters");
  filterToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 5.5h15l-6 7v5l-3 1.5v-6.5l-6-7Z"></path>
    </svg>
  `;

  const viewToggle = document.createElement("button");
  viewToggle.type = "button";
  viewToggle.className = "spreadsheet__toolbar-view-toggle spreadsheet__view-toggle";

  const bookmarkFilterToggle = document.createElement("button");
  bookmarkFilterToggle.type = "button";
  bookmarkFilterToggle.className = "spreadsheet__bookmark-filter-toggle";
  bookmarkFilterToggle.setAttribute("aria-pressed", "false");
  bookmarkFilterToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 4.5h10v15l-5-3-5 3v-15Z"></path>
    </svg>
  `;
  toolbarModes.append(filterToggle, viewToggle, bookmarkFilterToggle);

  const topPagination = document.createElement("nav");
  topPagination.className = "spreadsheet__pagination";
  topPagination.setAttribute("aria-label", "Shortform Texts database pages");
  const bottomPagination = document.createElement("nav");
  bottomPagination.className = "spreadsheet__pagination spreadsheet__pagination--bottom";
  bottomPagination.setAttribute("aria-label", "Shortform Texts database pages");

  const searchControls = document.createElement("div");
  searchControls.className = "spreadsheet__search";
  const searchToggle = document.createElement("button");
  searchToggle.type = "button";
  searchToggle.className = "spreadsheet__search-label spreadsheet__search-toggle";
  searchToggle.setAttribute("aria-controls", "shortform-database-search-input");
  searchToggle.setAttribute("aria-expanded", "false");
  searchToggle.setAttribute("aria-label", "Search Shortform Texts");
  searchToggle.title = "Search Shortform Texts";
  searchToggle.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m16 16 4 4"></path>
    </svg>
  `;
  const searchInputWrap = document.createElement("span");
  searchInputWrap.className = "spreadsheet__search-input-wrap";
  const searchInput = document.createElement("input");
  searchInput.id = "shortform-database-search-input";
  searchInput.className = "spreadsheet__search-input";
  searchInput.type = "search";
  searchInput.placeholder = "Search texts";
  searchInput.setAttribute("aria-label", "Search Shortform Texts");
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInputWrap.append(searchInput);
  searchControls.append(searchToggle, searchInputWrap);

  const workspace = document.createElement("div");
  workspace.className = "spreadsheet__workspace";
  const filterPanel = document.createElement("aside");
  filterPanel.id = "shortform-database-filters";
  filterPanel.className = "spreadsheet__filter-panel";
  filterPanel.setAttribute("aria-label", "Sort and filter Shortform Texts");
  const filterPanelInner = document.createElement("div");
  filterPanelInner.className = "spreadsheet__filter-panel-inner";

  const sortControls = document.createElement("div");
  sortControls.className = "spreadsheet__filter-sort";
  const sortLabel = document.createElement("label");
  sortLabel.className = "spreadsheet__filter-label";
  sortLabel.htmlFor = "shortform-database-sort";
  sortLabel.textContent = "Sort by";
  const sortSelectWrap = document.createElement("span");
  sortSelectWrap.className = "spreadsheet__filter-select-wrap";
  const sortSelect = document.createElement("select");
  sortSelect.id = "shortform-database-sort";
  sortSelect.className = "spreadsheet__filter-select";
  sortSelect.setAttribute("aria-label", "Sort Shortform Texts by");
  sortSelectWrap.append(sortSelect);
  sortControls.append(sortLabel, sortSelectWrap);

  const filterHeader = document.createElement("div");
  filterHeader.className = "spreadsheet__filter-tags-header";
  const filterHeading = document.createElement("h3");
  filterHeading.className = "spreadsheet__filter-heading";
  filterHeading.textContent = "Filters";
  const clearFilters = document.createElement("button");
  clearFilters.type = "button";
  clearFilters.className = "spreadsheet__clear-tag-filters is-hidden";
  clearFilters.textContent = "×";
  clearFilters.title = "Clear all filters";
  clearFilters.setAttribute("aria-label", "Clear all filters");
  filterHeader.append(filterHeading, clearFilters);

  const filterOptions = document.createElement("div");
  filterOptions.className = "spreadsheet__filter-tags shortform-database__filter-options";

  function appendFilterGroup(heading, kind, labels) {
    const group = document.createElement("section");
    group.className = "shortform-database__filter-group";
    const groupHeading = document.createElement("h4");
    groupHeading.className = "shortform-database__filter-group-heading";
    groupHeading.textContent = heading;
    group.append(groupHeading);

    labels.forEach((label, key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "spreadsheet__tag-filter shortform-database__filter-option";
      button.dataset.filterKind = kind;
      button.dataset.filterKey = key;
      button.textContent = label;
      button.setAttribute("aria-label", `Filter by ${label}`);
      button.addEventListener("click", () => {
        const selected = kind === "type" ? selectedTypes : selectedThemes;
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        currentPage = 0;
        renderRows();
      });
      group.append(button);
    });
    filterOptions.append(group);
  }

  appendFilterGroup("Type", "type", typeLabels);
  appendFilterGroup("Theme", "theme", themeLabels);
  clearFilters.addEventListener("click", () => {
    selectedTypes.clear();
    selectedThemes.clear();
    currentPage = 0;
    renderRows();
  });
  filterPanelInner.append(sortControls, filterHeader, filterOptions);
  filterPanel.append(filterPanelInner);

  const stage = document.createElement("div");
  stage.className = "spreadsheet__stage";
  const scroll = document.createElement("div");
  scroll.className = "spreadsheet__scroll";
  const table = document.createElement("table");
  table.className = "spreadsheet__table";
  const colgroup = document.createElement("colgroup");
  const visualCol = document.createElement("col");
  visualCol.className = "spreadsheet__col spreadsheet__col--cover";
  colgroup.append(visualCol);
  columns.forEach((label) => {
    const col = document.createElement("col");
    col.className = `spreadsheet__col spreadsheet__col--${spreadsheetColumnClass(label)}`;
    colgroup.append(col);
  });
  table.append(colgroup);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const visualHeader = document.createElement("th");
  visualHeader.className = "spreadsheet__cover-header";
  visualHeader.scope = "col";
  visualHeader.setAttribute("aria-label", "Page icon");
  headerRow.append(visualHeader);
  columns.forEach((label, columnIndex) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.columnLabel = label;
    th.className = `spreadsheet__column-header spreadsheet__column-header--${spreadsheetColumnClass(label)}`;
    th.innerHTML = `
      <button class="spreadsheet__sort-button" type="button">
        <span>${escapeHtml(label)}</span>
        <span class="spreadsheet__sort-indicator" aria-hidden="true"></span>
      </button>
    `;
    th.addEventListener("click", () => {
      randomRowRanks = null;
      sortState =
        sortState.columnIndex === columnIndex
          ? { columnIndex, direction: sortState.direction === "asc" ? "desc" : "asc" }
          : { columnIndex, direction: "asc" };
      currentPage = 0;
      renderRows();
    });
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  table.append(tbody);
  scroll.append(table);

  const gallery = document.createElement("div");
  gallery.className = "spreadsheet__gallery";
  gallery.setAttribute("role", "list");
  gallery.setAttribute("aria-label", "Shortform Texts gallery");

  function saveViewState() {
    try {
      window.localStorage.setItem(
        SHORTFORM_DATABASE_VIEW_STORAGE_KEY,
        JSON.stringify({
          currentPage,
          layoutMode,
          filtersOpen,
          sortState,
          selectedTypes: [...selectedTypes],
          selectedThemes: [...selectedThemes],
          bookmarksOnly,
        }),
      );
    } catch {}
  }

  function columnValue(row, label) {
    const columnIndex = columns.indexOf(label);
    return columnIndex >= 0 ? row[columnIndex] ?? "" : "";
  }

  function renderTextVisual(metadata, title, variant = "table") {
    const galleryVariant = variant === "gallery";
    const frame = document.createElement(metadata.href ? "a" : "span");
    frame.className = galleryVariant
      ? "spreadsheet__cover-frame spreadsheet__cover-frame--gallery shortform-database__visual"
      : "spreadsheet__cover-frame shortform-database__visual";
    if (metadata.href) {
      frame.href = metadata.href;
      frame.setAttribute("aria-label", `Open ${title}`);
    }

    if (metadata.image) {
      const image = document.createElement("img");
      image.className = galleryVariant
        ? "spreadsheet__cover-thumb spreadsheet__cover-thumb--gallery shortform-database__image shortform-database__image--gallery"
        : "spreadsheet__cover-thumb shortform-database__image";
      image.src = metadata.image;
      image.alt = `${title} preview`;
      image.loading = "lazy";
      frame.append(image);
      return frame;
    }

    const icon = document.createElement("span");
    icon.className = galleryVariant
      ? "shortform-database__icon shortform-database__icon--gallery"
      : "shortform-database__icon";
    icon.innerHTML = renderIconMarkup(metadata.icon || "📄", "shortform-database__icon-mark");
    frame.append(icon);
    return frame;
  }

  function ensurePageContentSearchIndex() {
    if (pageSearchIndexPromise || pageSearchIndexComplete) return;
    const pagesToIndex = rowMeta
      .map((metadata, rowIndex) => ({ pageId: metadata?.pageId, rowIndex }))
      .filter(({ pageId }) => pageId);
    pageSearchIndexPromise = (async () => {
      const batchSize = 24;
      for (let index = 0; index < pagesToIndex.length; index += batchSize) {
        await Promise.all(
          pagesToIndex.slice(index, index + batchSize).map(async ({ pageId, rowIndex }) => {
            try {
              pageContentSearchText[rowIndex] = pageSearchText(await loadPage(pageId));
            } catch {
              pageContentSearchText[rowIndex] = "";
            }
          }),
        );
        if (searchQuery.trim() && section.isConnected) renderRows();
      }
      pageSearchIndexComplete = true;
    })().finally(() => {
      pageSearchIndexPromise = null;
      if (searchQuery.trim() && section.isConnected) renderRows();
    });
  }

  function rowMatchesSearch(rowIndex, terms) {
    if (terms.length === 0) return true;
    const text = `${rowSearchFields[rowIndex].join(" ")} ${pageContentSearchText[rowIndex]}`;
    return terms.every((term) => text.includes(term));
  }

  function searchRelevance(rowIndex, terms) {
    const fields = [...rowSearchFields[rowIndex], pageContentSearchText[rowIndex]];
    const ranks = terms.map((term) => {
      const fieldIndex = fields.findIndex((field) => field.includes(term));
      return fieldIndex >= 0 ? fieldIndex : fields.length;
    });
    const bestField = Math.min(...ranks);
    return {
      bestField,
      bestFieldMatches: terms.filter((term) => fields[bestField]?.includes(term)).length,
      totalRank: ranks.reduce((total, rank) => total + rank, 0),
      worstField: Math.max(...ranks),
    };
  }

  function filteredRows() {
    const terms = searchTermsForQuery(searchQuery);
    if (terms.length > 0) ensurePageContentSearchIndex();
    return rows.filter((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const matchesTypes =
        selectedTypes.size === 0 ||
        [...rowTypeKeys[rowIndex]].some((key) => selectedTypes.has(key));
      const matchesThemes =
        selectedThemes.size === 0 ||
        [...rowThemeKeys[rowIndex]].some((key) => selectedThemes.has(key));
      const pageId = rowMeta[rowIndex]?.pageId;
      const matchesBookmarks =
        !bookmarksOnly || (pageId && bookmarkedShortformIds.has(pageId));
      return (
        matchesTypes &&
        matchesThemes &&
        matchesBookmarks &&
        rowMatchesSearch(rowIndex, terms)
      );
    });
  }

  function currentRows() {
    const matchingRows = filteredRows();
    const terms = searchTermsForQuery(searchQuery);
    if (terms.length > 0) {
      return matchingRows
        .map((row) => {
          const rowIndex = rowIndexByRow.get(row);
          return { row, rowIndex, relevance: searchRelevance(rowIndex, terms) };
        })
        .sort((left, right) => {
          const relevanceOrder =
            left.relevance.bestField - right.relevance.bestField ||
            right.relevance.bestFieldMatches - left.relevance.bestFieldMatches ||
            left.relevance.totalRank - right.relevance.totalRank ||
            left.relevance.worstField - right.relevance.worstField;
          if (relevanceOrder) return relevanceOrder;
          return (
            compareSpreadsheetValues(
              titleSortValue(left.row[titleColumnIndex]),
              titleSortValue(right.row[titleColumnIndex]),
            ) || left.rowIndex - right.rowIndex
          );
        })
        .map(({ row }) => row);
    }
    if (randomRowRanks) {
      return [...matchingRows].sort(
        (left, right) => randomRowRanks.get(left) - randomRowRanks.get(right),
      );
    }
    return matchingRows
      .map((row) => ({ row, rowIndex: rowIndexByRow.get(row) }))
      .sort((left, right) => {
        const columnLabel = columns[sortState.columnIndex];
        const result = compareSpreadsheetValues(
          spreadsheetSortValue(left.row[sortState.columnIndex], columnLabel),
          spreadsheetSortValue(right.row[sortState.columnIndex], columnLabel),
        );
        const ordered = result || left.rowIndex - right.rowIndex;
        return sortState.direction === "asc" ? ordered : -ordered;
      })
      .map(({ row }) => row);
  }

  function populateSortOptions() {
    const relevanceOption = new Option("Relevance", "relevance");
    relevanceOption.hidden = true;
    relevanceOption.disabled = true;
    sortSelect.append(relevanceOption);
    columns.forEach((label, columnIndex) => {
      sortSelect.append(
        new Option(`${label} A-Z`, `${columnIndex}:asc`),
        new Option(`${label} Z-A`, `${columnIndex}:desc`),
      );
    });
    const randomActive = new Option("Random", "random-active");
    randomActive.hidden = true;
    randomActive.disabled = true;
    sortSelect.append(randomActive, new Option("Random", "random"));
  }

  function renderSortControls() {
    if (searchTermsForQuery(searchQuery).length > 0) sortSelect.value = "relevance";
    else if (randomRowRanks) sortSelect.value = "random-active";
    else sortSelect.value = `${sortState.columnIndex}:${sortState.direction}`;
    headerRow.querySelectorAll("[data-column-label]").forEach((th) => {
      const columnIndex = columns.indexOf(th.dataset.columnLabel);
      const active = !randomRowRanks && sortState.columnIndex === columnIndex;
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("is-sorted-asc", active && sortState.direction === "asc");
      th.classList.toggle("is-sorted-desc", active && sortState.direction === "desc");
      th.setAttribute(
        "aria-sort",
        active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none",
      );
    });
  }

  function renderViewToggle() {
    const galleryView = layoutMode === "gallery";
    section.classList.toggle("is-gallery-view", galleryView);
    section.classList.toggle("is-spreadsheet-view", !galleryView);
    viewToggle.setAttribute(
      "aria-label",
      galleryView ? "Switch to list view" : "Switch to gallery view",
    );
    viewToggle.title = galleryView ? "List view" : "Gallery view";
    viewToggle.innerHTML = galleryView
      ? `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 7h12"></path><path d="M6 12h12"></path><path d="M6 17h12"></path></svg>`
      : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h5v5H5z"></path><path d="M14 5h5v5h-5z"></path><path d="M5 14h5v5H5z"></path><path d="M14 14h5v5h-5z"></path></svg>`;
  }

  let filterResizeFrame = null;
  function sizeFiltersToViewport() {
    if (filterResizeFrame !== null) cancelAnimationFrame(filterResizeFrame);
    if (!filtersOpen) {
      filterOptions.style.removeProperty("max-height");
      filterResizeFrame = null;
      return;
    }
    filterResizeFrame = requestAnimationFrame(() => {
      filterResizeFrame = null;
      if (!section.isConnected || !filtersOpen) return;
      const listTop = filterOptions.getBoundingClientRect().top;
      filterOptions.style.maxHeight = `${Math.max(96, Math.floor(window.innerHeight - listTop - 16))}px`;
    });
  }

  function renderFilterControls() {
    const filterCount = selectedTypes.size + selectedThemes.size;
    section.classList.toggle("is-filters-open", filtersOpen);
    filterToggle.classList.toggle("is-active", filtersOpen);
    filterToggle.classList.toggle("has-active-filters", filterCount > 0);
    filterToggle.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    filterToggle.setAttribute("aria-pressed", filtersOpen ? "true" : "false");
    filterToggle.setAttribute(
      "aria-label",
      filtersOpen
        ? "Close sort and filters"
        : filterCount
          ? `Open sort and filters, ${filterCount} selected`
          : "Open sort and filters",
    );
    filterToggle.title = filtersOpen ? "Close filters" : "Sort and filter";
    filterPanel.setAttribute("aria-hidden", filtersOpen ? "false" : "true");
    clearFilters.classList.toggle("is-hidden", filterCount === 0);
    clearFilters.disabled = filterCount === 0;
    clearFilters.setAttribute("aria-hidden", filterCount ? "false" : "true");
    clearFilters.setAttribute(
      "aria-label",
      `Clear all ${filterCount} selected filter${filterCount === 1 ? "" : "s"}`,
    );
    filterOptions.querySelectorAll("[data-filter-key]").forEach((button) => {
      const selected =
        button.dataset.filterKind === "type"
          ? selectedTypes.has(button.dataset.filterKey)
          : selectedThemes.has(button.dataset.filterKey);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    sizeFiltersToViewport();
  }

  function renderBookmarkControls() {
    section.classList.toggle("is-bookmarks-only", bookmarksOnly);
    bookmarkFilterToggle.classList.toggle("is-active", bookmarksOnly);
    bookmarkFilterToggle.setAttribute("aria-pressed", bookmarksOnly ? "true" : "false");
    bookmarkFilterToggle.setAttribute(
      "aria-label",
      bookmarksOnly
        ? `Show all texts; currently showing ${bookmarkedShortformIds.size} bookmarked text${bookmarkedShortformIds.size === 1 ? "" : "s"}`
        : `Show ${bookmarkedShortformIds.size} bookmarked text${bookmarkedShortformIds.size === 1 ? "" : "s"} only`,
    );
    bookmarkFilterToggle.title = bookmarksOnly ? "Show all texts" : "Show bookmarked texts";

    gallery.querySelectorAll("[data-shortform-bookmark-id]").forEach((button) => {
      const pageId = button.dataset.shortformBookmarkId;
      const isBookmarked = bookmarkedShortformIds.has(pageId);
      const title = button.dataset.shortformTitle || "text";
      button.classList.toggle("is-bookmarked", isBookmarked);
      button.setAttribute("aria-pressed", isBookmarked ? "true" : "false");
      button.setAttribute(
        "aria-label",
        isBookmarked ? `Remove ${title} from bookmarks` : `Add ${title} to bookmarks`,
      );
      button.title = isBookmarked ? "Remove bookmark" : "Bookmark text";
    });
  }

  function renderSearchControls() {
    const hasSearch = searchTermsForQuery(searchQuery).length > 0;
    searchControls.classList.toggle("is-popup-open", searchPopupOpen);
    searchControls.classList.toggle("has-active-search", hasSearch);
    searchToggle.setAttribute("aria-expanded", searchPopupOpen ? "true" : "false");
    searchToggle.setAttribute(
      "aria-label",
      hasSearch ? `Edit text search: ${searchQuery.trim()}` : "Search Shortform Texts",
    );
    searchToggle.title = hasSearch ? "Edit search" : "Search Shortform Texts";
  }

  function setSearchPopupOpen(open, focusInput = true) {
    searchPopupOpen = Boolean(open);
    renderSearchControls();
    if (searchPopupOpen && focusInput) requestAnimationFrame(() => searchInput.focus());
  }

  function renderPagination(pagination, totalPages) {
    pagination.innerHTML = "";
    const icon = (direction) => `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="${direction === "previous" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}"></path>
      </svg>
    `;
    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "spreadsheet__page-button spreadsheet__page-button--arrow";
    previousButton.innerHTML = icon("previous");
    previousButton.setAttribute("aria-label", "Previous page");
    previousButton.disabled = currentPage === 0;
    previousButton.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage -= 1;
        renderRows();
      }
    });
    pagination.append(previousButton);

    function appendPageItems(container, items) {
      items.forEach((item) => {
        if (item === "ellipsis") {
          const ellipsis = document.createElement("span");
          ellipsis.className = "spreadsheet__pagination-ellipsis";
          ellipsis.textContent = "…";
          container.append(ellipsis);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "spreadsheet__page-button";
        button.textContent = String(item + 1);
        if (item === currentPage) {
          button.classList.add("is-active");
          button.setAttribute("aria-current", "page");
        }
        button.addEventListener("click", () => {
          currentPage = item;
          renderRows();
        });
        container.append(button);
      });
    }
    const widePages = document.createElement("span");
    widePages.className = "spreadsheet__pagination-pages spreadsheet__pagination-pages--wide";
    appendPageItems(widePages, spreadsheetPaginationItems(totalPages, currentPage));
    const compactPages = document.createElement("span");
    compactPages.className = "spreadsheet__pagination-pages spreadsheet__pagination-pages--compact";
    appendPageItems(
      compactPages,
      compactSpreadsheetPaginationItems(totalPages, currentPage),
    );
    pagination.append(widePages, compactPages);
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "spreadsheet__page-button spreadsheet__page-button--arrow";
    nextButton.innerHTML = icon("next");
    nextButton.setAttribute("aria-label", "Next page");
    nextButton.disabled = currentPage >= totalPages - 1;
    nextButton.addEventListener("click", () => {
      if (currentPage < totalPages - 1) {
        currentPage += 1;
        renderRows();
      }
    });
    pagination.append(nextButton);
  }

  function renderListRows(visibleRows) {
    visibleRows.forEach((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const metadata = rowMeta[rowIndex] ?? {};
      const title = columnValue(row, "Title") || "Untitled";
      const tr = document.createElement("tr");
      const visualCell = document.createElement("td");
      visualCell.className = "spreadsheet__cover-cell";
      visualCell.append(renderTextVisual(metadata, title));
      tr.append(visualCell);
      row.forEach((value, columnIndex) => {
        const td = document.createElement("td");
        if (columnIndex === titleColumnIndex && metadata.href) {
          const link = document.createElement("a");
          link.className = "spreadsheet__title-link";
          link.href = metadata.href;
          link.textContent = value;
          td.append(link);
        } else td.textContent = value;
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  function renderGalleryRows(visibleRows) {
    visibleRows.forEach((row) => {
      const rowIndex = rowIndexByRow.get(row);
      const metadata = rowMeta[rowIndex] ?? {};
      const title = columnValue(row, "Title") || "Untitled";
      const creator = columnValue(row, "Creator(s)");
      const type = columnValue(row, "Type");
      const theme = columnValue(row, "Theme");
      const card = document.createElement("article");
      card.className = "spreadsheet__gallery-card";
      card.setAttribute("role", "listitem");
      const visualSlot = document.createElement("div");
      visualSlot.className = "spreadsheet__gallery-cover-slot";
      visualSlot.append(renderTextVisual(metadata, title, "gallery"));
      card.append(visualSlot);
      const heading = document.createElement("h3");
      heading.className = "spreadsheet__gallery-title";
      if (metadata.href) {
        const link = document.createElement("a");
        link.className = "spreadsheet__gallery-title-link";
        link.href = metadata.href;
        link.textContent = title;
        heading.append(link);
      } else heading.textContent = title;
      card.append(heading);
      if (creator) {
        const creatorLine = document.createElement("p");
        creatorLine.className = "spreadsheet__gallery-creator";
        creatorLine.textContent = creator;
        card.append(creatorLine);
      }
      const typeLine = document.createElement("p");
      typeLine.className = "shortform-database__type-meta";
      typeLine.textContent = type;
      card.append(typeLine);
      const themeLine = document.createElement("p");
      themeLine.className = "shortform-database__theme-meta";
      themeLine.textContent = theme || "\u00a0";
      if (!theme) themeLine.classList.add("is-empty");
      card.append(themeLine);

      if (metadata.pageId) {
        const bookmarkButton = document.createElement("button");
        bookmarkButton.type = "button";
        bookmarkButton.className = "spreadsheet__gallery-bookmark-button";
        bookmarkButton.dataset.shortformBookmarkId = metadata.pageId;
        bookmarkButton.dataset.shortformTitle = title;
        bookmarkButton.innerHTML = `
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 4.5h10v15l-5-3-5 3v-15Z"></path>
          </svg>
        `;
        bookmarkButton.addEventListener("click", () => {
          if (bookmarkedShortformIds.has(metadata.pageId)) {
            bookmarkedShortformIds.delete(metadata.pageId);
          } else {
            bookmarkedShortformIds.add(metadata.pageId);
          }
          saveBookmarkedShortformIds(bookmarkedShortformIds);
          if (bookmarksOnly) renderRows();
          else renderBookmarkControls();
        });
        card.append(bookmarkButton);

        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "spreadsheet__gallery-preview-button";
        previewButton.dataset.shortformPreviewId = metadata.pageId;
        previewButton.setAttribute("aria-label", `Open ${title} in the text preview panel`);
        previewButton.setAttribute("aria-pressed", "false");
        previewButton.title = "Open text preview";
        previewButton.innerHTML = `
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4.5 5h15v14h-15z"></path>
            <path d="M14 5v14"></path>
            <path d="m8.5 9 3 3-3 3"></path>
          </svg>
        `;
        previewButton.addEventListener("click", () => {
          openShortformPreview(metadata.pageId, title);
        });
        card.append(previewButton);
      }
      gallery.append(card);
    });
  }

  function renderEmpty() {
    const message = bookmarksOnly
      ? bookmarkedShortformIds.size === 0
        ? "No bookmarked texts yet."
        : "No bookmarked texts match the current filters."
      : selectedTypes.size || selectedThemes.size
        ? "No texts match the selected filters."
        : searchQuery.trim()
          ? `No texts match "${searchQuery.trim()}".`
          : "No texts to show.";
    if (layoutMode === "gallery") {
      const empty = document.createElement("p");
      empty.className = "spreadsheet__empty";
      empty.textContent = message;
      gallery.append(empty);
    } else {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "spreadsheet__empty-cell";
      td.colSpan = columns.length + 1;
      td.textContent = message;
      tr.append(td);
      tbody.append(tr);
    }
  }

  function renderRows() {
    const orderedRows = currentRows();
    const totalPages = Math.max(
      1,
      Math.ceil(orderedRows.length / SHORTFORM_DATABASE_PAGE_SIZE),
    );
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    saveViewState();
    const start = currentPage * SHORTFORM_DATABASE_PAGE_SIZE;
    const visibleRows = orderedRows.slice(start, start + SHORTFORM_DATABASE_PAGE_SIZE);
    renderViewToggle();
    renderFilterControls();
    renderSortControls();
    renderSearchControls();
    renderPagination(topPagination, totalPages);
    renderPagination(bottomPagination, totalPages);
    tbody.innerHTML = "";
    gallery.innerHTML = "";
    if (layoutMode === "gallery") renderGalleryRows(visibleRows);
    else renderListRows(visibleRows);
    if (visibleRows.length === 0) renderEmpty();
    renderBookmarkControls();
    syncShortformPreviewButtons();
  }

  viewToggle.addEventListener("click", () => {
    layoutMode = layoutMode === "gallery" ? "spreadsheet" : "gallery";
    renderRows();
  });
  filterToggle.addEventListener("click", () => {
    filtersOpen = !filtersOpen;
    renderFilterControls();
    saveViewState();
  });
  bookmarkFilterToggle.addEventListener("click", () => {
    bookmarksOnly = !bookmarksOnly;
    currentPage = 0;
    renderRows();
  });
  sortSelect.addEventListener("change", () => {
    if (sortSelect.value === "random") {
      const shuffledRows = [...rows];
      for (let index = shuffledRows.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffledRows[index], shuffledRows[swapIndex]] = [
          shuffledRows[swapIndex],
          shuffledRows[index],
        ];
      }
      randomRowRanks = new Map(shuffledRows.map((row, index) => [row, index]));
    } else {
      randomRowRanks = null;
      const [columnIndexValue, direction] = sortSelect.value.split(":");
      const columnIndex = Number(columnIndexValue);
      sortState =
        Number.isInteger(columnIndex) &&
        columnIndex >= 0 &&
        columnIndex < columns.length &&
        (direction === "asc" || direction === "desc")
          ? { columnIndex, direction }
          : defaultSortState;
    }
    currentPage = 0;
    renderRows();
  });
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    currentPage = 0;
    renderRows();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setSearchPopupOpen(false, false);
    searchToggle.focus();
  });
  searchToggle.addEventListener("click", () => setSearchPopupOpen(!searchPopupOpen));

  populateSortOptions();
  toolbar.append(toolbarModes, topPagination, searchControls);
  stage.append(scroll, gallery, bottomPagination);
  workspace.append(filterPanel, stage);
  section.append(toolbar, workspace);
  spreadsheetViewportAbortController?.abort();
  spreadsheetViewportAbortController = new AbortController();
  updateSpreadsheetFilterViewport = sizeFiltersToViewport;
  window.addEventListener("resize", sizeFiltersToViewport, {
    signal: spreadsheetViewportAbortController.signal,
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (searchPopupOpen && !searchControls.contains(event.target)) {
        setSearchPopupOpen(false, false);
      }
    },
    { signal: spreadsheetViewportAbortController.signal },
  );
  renderRows();
  return section;
}

function currentHashRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const queryStart = hash.indexOf("?");

  return {
    path: queryStart >= 0 ? hash.slice(0, queryStart) : hash,
    searchParams: new URLSearchParams(queryStart >= 0 ? hash.slice(queryStart + 1) : ""),
  };
}

function resolvePageSummary() {
  const { path } = currentHashRoute();
  if (!path) return pageIndexMap.get(siteIndex.rootPageId) ?? siteIndex.pages[0];

  const normalizedPageId = normalizePageId(path);
  if (normalizedPageId) {
    const resolvedPageId = pageIndexMap.has(normalizedPageId)
      ? normalizedPageId
      : aliasPageIdMap.get(normalizedPageId);
    if (resolvedPageId && pageIndexMap.has(resolvedPageId)) {
      return pageIndexMap.get(resolvedPageId);
    }
  }

  return (
    slugMap.get(path) ??
    (LEGACY_FULL_TEXT_DATABASE_SLUGS.has(path)
      ? pageIndexMap.get(FULL_TEXT_DATABASE_PAGE_ID)
      : null) ??
    pageIndexMap.get(path) ??
    pageIndexMap.get(siteIndex.rootPageId) ??
    siteIndex.pages[0]
  );
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainText(value) {
  if (!Array.isArray(value)) return "";
  return value.map((part) => part?.[0] ?? "").join("");
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

function localRouteForHref(href) {
  const pageId = normalizePageId(href);
  return pageId ? routeForPage(pageId) : null;
}

function isGifAsset(src) {
  return typeof src === "string" && gifAssetSet.has(src);
}

function imageClasses(className, src) {
  return `${className} ${className}--image${isGifAsset(src) ? ` ${className}--gif` : ""}`;
}

function localizeHtmlLinks(html) {
  if (!html) return "";

  return String(html).replace(
    /<a\b([^>]*?)href="([^"]+)"([^>]*)>/gi,
    (match, beforeHref, href, afterHref) => {
      const localRoute = localRouteForHref(href);
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

function richTextToHtml(value) {
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      const text = escapeHtml(part?.[0] ?? "").replace(/\n/g, "<br>");
      const annotations = Array.isArray(part?.[1]) ? part[1] : [];

      return annotations.reduce((html, annotation) => {
        const [kind, detail] = annotation;

        if (kind === "a" && detail) {
          const localRoute = localRouteForHref(detail);
          if (localRoute) {
            return `<a href="${escapeHtml(localRoute)}">${html}</a>`;
          }

          return `<a href="${escapeHtml(detail)}" target="_blank" rel="noreferrer">${html}</a>`;
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

function routeForPage(pageId) {
  const resolvedPageId = pageIndexMap.has(pageId) ? pageId : aliasPageIdMap.get(pageId);
  const page = resolvedPageId ? pageIndexMap.get(resolvedPageId) : null;
  return page ? `#/${page.slug}` : "#/";
}

function routeForFullTextDatabaseTag(tag) {
  const tagKey = normalizeSpreadsheetTagKey(tag);
  const databaseRoute = routeForPage(FULL_TEXT_DATABASE_PAGE_ID);
  return tagKey ? `${databaseRoute}?tag=${encodeURIComponent(tagKey)}` : databaseRoute;
}

function capitalize(word) {
  return word ? `${word[0].toUpperCase()}${word.slice(1)}` : "";
}

function crispNotionIconSource(icon) {
  const source = String(icon ?? "");
  const rasterIconMappings = [
    [/\/document-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/document_gray.svg"],
    [/\/document-yellow-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/document_yellow.svg"],
    [/\/book-closed-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/book-closed_gray.svg"],
    [/\/bookmark-outline-gray-[^/]+\.webp(?:\?.*)?$/i, "https://www.notion.so/icons/bookmark_gray.svg"],
  ];

  return (
    rasterIconMappings.find(([pattern]) => pattern.test(source))?.[1] ?? source
  );
}

function renderIconMarkup(icon, className = "icon") {
  if (!icon) return "";

  const iconSource = crispNotionIconSource(icon);

  if (/^(https?:\/\/|\.?\/|assets\/)/.test(iconSource)) {
    return `<img class="${imageClasses(className, iconSource)}" src="${escapeHtml(iconSource)}" alt="" />`;
  }

  return `<span class="${className} ${className}--emoji">${escapeHtml(iconSource)}</span>`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(timestamp));
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]*>/g, "").trim();
}

function propertyValueTokens(value) {
  if (!Array.isArray(value)) return [];
  return value.map((part) => part?.[0] ?? "").filter(Boolean);
}

async function loadPage(pageId) {
  if (!pageId) return null;
  if (pageCache.has(pageId)) return pageCache.get(pageId);

  const payload = fetch(dataUrl(`./data/pages/${pageId}.json`), { cache: "no-store" }).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load page ${pageId}`);
    }

    return response.json();
  });

  pageCache.set(pageId, payload);
  return payload;
}

async function loadCollection(collectionId) {
  if (!collectionId) return null;
  if (collectionCache.has(collectionId)) return collectionCache.get(collectionId);

  const payload = fetch(dataUrl(`./data/collections/${collectionId}.json`), { cache: "no-store" }).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load collection ${collectionId}`);
    }

    return response.json();
  });

  collectionCache.set(collectionId, payload);
  return payload;
}

function findCollectionProperty(collection, propertyId) {
  return (
    collection?.schema?.[propertyId] ??
    (propertyId === "title"
      ? {
          id: "title",
          name: "Name",
          type: "title",
          options: [],
        }
      : null)
  );
}

function findOptionColor(collection, propertyId, value) {
  const property = findCollectionProperty(collection, propertyId);
  return property?.options?.find((option) => option.value === value)?.color ?? "default";
}

function renderToken(value, color = "default") {
  return `<span class="token token--${escapeHtml(color)}">${escapeHtml(value)}</span>`;
}

function renderCollectionPropertyHtml(page, collection, propertyId) {
  const property = findCollectionProperty(collection, propertyId);
  const rawValue =
    propertyId === "title"
      ? page.properties?.title ?? [[page.title]]
      : page.properties?.[propertyId];

  switch (property?.type) {
    case "title":
      return `<a class="database__page-link" href="${routeForPage(page.id)}">${escapeHtml(page.title)}</a>`;
    case "text":
    case "date":
      return richTextToHtml(rawValue);
    case "url": {
      const url = plainText(rawValue);
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`
        : "";
    }
    case "email": {
      const email = plainText(rawValue);
      return email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : "";
    }
    case "multi_select":
    case "select":
    case "status": {
      const values = propertyValueTokens(rawValue);
      return values
        .map((value) => renderToken(value, findOptionColor(collection, propertyId, value)))
        .join("");
    }
    case "number":
      return escapeHtml(plainText(rawValue));
    case "created_time":
      return page.createdTime ? escapeHtml(formatTimestamp(page.createdTime)) : "";
    case "last_edited_time":
      return page.lastEditedTime ? escapeHtml(formatTimestamp(page.lastEditedTime)) : "";
    case "verification":
      return page.lastEditedTime ? renderToken("Verified", "green") : "";
    case "file": {
      const fileUrl = plainText(rawValue);
      return fileUrl
        ? `<a href="${escapeHtml(fileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(fileUrl)}</a>`
        : "";
    }
    case "person":
      return "";
    default:
      return richTextToHtml(rawValue) || escapeHtml(plainText(rawValue));
  }
}

function propertyHasRenderableValue(html) {
  return Boolean(html) && (Boolean(stripHtml(html)) || /<(a|img|span|code|strong|em)\b/i.test(html));
}

function filterComparableValues(page, collection, propertyId) {
  const property = findCollectionProperty(collection, propertyId);
  const rawValue =
    propertyId === "title"
      ? page.properties?.title ?? [[page.title]]
      : page.properties?.[propertyId];

  switch (property?.type) {
    case "title":
    case "text":
    case "url":
    case "email":
    case "date":
      return [plainText(rawValue)].filter(Boolean);
    case "multi_select":
    case "select":
    case "status":
      return propertyValueTokens(rawValue);
    case "number": {
      const number = Number(plainText(rawValue));
      return Number.isFinite(number) ? [number] : [];
    }
    case "created_time":
      return page.createdTime ? [page.createdTime] : [];
    case "last_edited_time":
      return page.lastEditedTime ? [page.lastEditedTime] : [];
    default:
      return [plainText(rawValue)].filter(Boolean);
  }
}

function rowMatchesFilter(page, collection, filter) {
  const filterValues = Array.isArray(filter.value) ? filter.value : [filter.value];
  const normalizedFilterValues = filterValues.filter(Boolean);
  if (normalizedFilterValues.length === 0) return true;

  const rowValues = filterComparableValues(page, collection, filter.property);

  switch (filter.operator) {
    case "enum_contains":
      return rowValues.some((value) => normalizedFilterValues.includes(value));
    case "enum_is":
      return rowValues.some((value) => value === normalizedFilterValues[0]);
    case "string_contains":
      return rowValues.some((value) =>
        String(value).toLowerCase().includes(String(normalizedFilterValues[0]).toLowerCase()),
      );
    case "number_greater_than_or_equal_to":
      return rowValues.some((value) => Number(value) >= Number(normalizedFilterValues[0]));
    default:
      return true;
  }
}

function orderedRows(rows, view) {
  const pageSort = view?.pageSort ?? [];
  if (pageSort.length === 0) {
    return [...rows].sort((a, b) => a.title.localeCompare(b.title));
  }

  const order = new Map(pageSort.map((pageId, index) => [pageId, index]));
  return [...rows].sort((a, b) => {
    const aOrder = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bOrder = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.title.localeCompare(b.title);
  });
}

function rowsForView(collection, view) {
  const rows = orderedRows(collection.rows ?? [], view);
  return rows.filter((page) =>
    (view?.propertyFilters ?? []).every((filter) => rowMatchesFilter(page, collection, filter)),
  );
}

function viewPropertyConfig(view) {
  switch (view?.type) {
    case "gallery":
      return view.galleryProperties?.length ? view.galleryProperties : view.tableProperties;
    case "list":
      return view.listProperties?.length ? view.listProperties : view.tableProperties;
    case "board":
      return view.tableProperties ?? [];
    case "table":
    default:
      return view?.tableProperties ?? [];
  }
}

function visibleViewProperties(view, collection, rows) {
  return (viewPropertyConfig(view) ?? [])
    .filter((property) => property.visible !== false)
    .filter(
      (property) =>
        property.property === "title" ||
        rows.some((page) =>
          propertyHasRenderableValue(
            renderCollectionPropertyHtml(page, collection, property.property),
          ),
        ),
    );
}

function pickDefaultView(views = []) {
  return views.find((view) => view.type !== "page")?.id ?? views[0]?.id ?? null;
}

function viewName(view) {
  return view?.name?.trim() || capitalize(view?.type ?? "view");
}

function previewImageForPage(page, view) {
  if (view?.galleryCover === "page_cover") {
    return page.cover || page.previewImage || "";
  }

  return page.previewImage || page.cover || "";
}

function renderPreviewMarkup(page, view, className = "database-card__preview") {
  const preview = previewImageForPage(page, view);
  if (preview) {
    return `<img class="${imageClasses(className, preview)}" src="${escapeHtml(preview)}" alt="" />`;
  }

  return renderIconMarkup(page.icon, `${className} ${className}--icon`);
}

function renderDatabaseTable(collection, view, rows) {
  const properties = visibleViewProperties(view, collection, rows);
  const wrapper = document.createElement("div");
  wrapper.className = "database database--table";

  if (rows.length === 0) {
    wrapper.innerHTML = '<p class="database__empty">No rows matched this view.</p>';
    return wrapper;
  }

  wrapper.innerHTML = `
    <table class="database-table">
      <thead>
        <tr>
          ${properties
            .map((property) => {
              const schema = findCollectionProperty(collection, property.property);
              return `<th>${escapeHtml(schema?.name ?? property.property)}</th>`;
            })
            .join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (page) => `
              <tr>
                ${properties
                  .map(
                    (property) => `
                      <td>${renderCollectionPropertyHtml(page, collection, property.property)}</td>
                    `,
                  )
                  .join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  return wrapper;
}

function renderDatabaseGallery(collection, view, rows) {
  const properties = visibleViewProperties(view, collection, rows);
  const wrapper = document.createElement("div");
  wrapper.className = "database database--gallery";

  if (rows.length === 0) {
    wrapper.innerHTML = '<p class="database__empty">No rows matched this view.</p>';
    return wrapper;
  }

  wrapper.innerHTML = rows
    .map(
      (page) => `
        <article class="database-card">
          <a class="database-card__link" href="${routeForPage(page.id)}">
            <div class="database-card__media${isGifAsset(previewImageForPage(page, view)) ? " database-card__media--gif" : ""}">${renderPreviewMarkup(page, view)}</div>
            <div class="database-card__body">
              <h4>${escapeHtml(page.title)}</h4>
              ${properties
                .filter((property) => property.property !== "title")
                .map((property) => {
                  const value = renderCollectionPropertyHtml(page, collection, property.property);
                  if (!propertyHasRenderableValue(value)) return "";
                  const schema = findCollectionProperty(collection, property.property);
                  return `
                    <p class="database-card__meta">
                      <span class="database-card__label">${escapeHtml(schema?.name ?? property.property)}</span>
                      <span>${value}</span>
                    </p>
                  `;
                })
                .join("")}
            </div>
          </a>
        </article>
      `,
    )
    .join("");

  return wrapper;
}

function renderDatabaseList(collection, view, rows) {
  const properties = visibleViewProperties(view, collection, rows);
  const wrapper = document.createElement("div");
  wrapper.className = "database database--list";

  if (rows.length === 0) {
    wrapper.innerHTML = '<p class="database__empty">No rows matched this view.</p>';
    return wrapper;
  }

  wrapper.innerHTML = rows
    .map(
      (page) => `
        <article class="database-list-item">
          <a class="database-list-item__link" href="${routeForPage(page.id)}">
            <div class="database-list-item__title-row">
              ${renderPreviewMarkup(page, view, "database-list-item__icon")}
              <h4>${escapeHtml(page.title)}</h4>
            </div>
            <div class="database-list-item__meta">
              ${properties
                .filter((property) => property.property !== "title")
                .map((property) => {
                  const value = renderCollectionPropertyHtml(page, collection, property.property);
                  if (!propertyHasRenderableValue(value)) return "";
                  const schema = findCollectionProperty(collection, property.property);
                  return `
                    <p>
                      <span class="database-list-item__label">${escapeHtml(schema?.name ?? property.property)}</span>
                      <span>${value}</span>
                    </p>
                  `;
                })
                .join("")}
            </div>
          </a>
        </article>
      `,
    )
    .join("");

  return wrapper;
}

function renderDatabaseBoard(collection, view, rows) {
  const groupProperty = view.boardColumnsBy?.property ?? null;
  const columns = (view.boardColumns ?? []).filter((column) => !column.hidden);
  const properties = visibleViewProperties(view, collection, rows).filter(
    (property) => property.property !== groupProperty,
  );
  const wrapper = document.createElement("div");
  wrapper.className = "database database--board";

  if (!groupProperty || columns.length === 0) {
    return renderDatabaseList(collection, view, rows);
  }

  wrapper.innerHTML = columns
    .map((column) => {
      const groupedRows = rows.filter((page) =>
        filterComparableValues(page, collection, groupProperty).includes(column.option),
      );

      return `
        <section class="board-column">
          <header class="board-column__header">
            <h4>${escapeHtml(column.option ?? "Untitled")}</h4>
            <span>${groupedRows.length}</span>
          </header>
          <div class="board-column__cards">
            ${
              groupedRows.length === 0
                ? '<p class="board-column__empty">No rows</p>'
                : groupedRows
                    .map(
                      (page) => `
                        <article class="board-card">
                          <a class="board-card__link" href="${routeForPage(page.id)}">
                            <h5>${escapeHtml(page.title)}</h5>
                            ${properties
                              .map((property) => {
                                const value = renderCollectionPropertyHtml(
                                  page,
                                  collection,
                                  property.property,
                                );
                                if (!propertyHasRenderableValue(value)) return "";
                                const schema = findCollectionProperty(collection, property.property);
                                return `
                                  <p class="board-card__meta">
                                    <span class="board-card__label">${escapeHtml(schema?.name ?? property.property)}</span>
                                    <span>${value}</span>
                                  </p>
                                `;
                              })
                              .join("")}
                          </a>
                        </article>
                      `,
                    )
                    .join("")
            }
          </div>
        </section>
      `;
    })
    .join("");

  return wrapper;
}

function renderDatabasePageView(view) {
  const wrapper = document.createElement("div");
  wrapper.className = "database database--page";

  if (view.pagePointerId && pageIndexMap.has(view.pagePointerId)) {
    const target = pageIndexMap.get(view.pagePointerId);
    wrapper.innerHTML = `
      <a class="database-page-link" href="${routeForPage(target.id)}">
        <span class="database-page-link__eyebrow">page view</span>
        <strong>${escapeHtml(target.title)}</strong>
      </a>
    `;
    return wrapper;
  }

  wrapper.innerHTML = '<p class="database__empty">This view points to a Notion page view.</p>';
  return wrapper;
}

function renderCollectionViewBody(collection, view, rows) {
  switch (view?.type) {
    case "gallery":
      return renderDatabaseGallery(collection, view, rows);
    case "list":
      return renderDatabaseList(collection, view, rows);
    case "board":
      return renderDatabaseBoard(collection, view, rows);
    case "page":
      return renderDatabasePageView(view);
    case "table":
    default:
      return renderDatabaseTable(collection, view, rows);
  }
}

async function hydrateCollectionView(section, block) {
  if (!section.isConnected) return;

  section.dataset.loading = "true";
  section.innerHTML = '<p class="database__empty">Loading database…</p>';

  try {
    const collection = await loadCollection(block.collectionId);
    if (!section.isConnected || !collection) return;

    const availableViews =
      (block.viewIds ?? []).length > 0
        ? (collection.views ?? []).filter((view) => block.viewIds.includes(view.id))
        : collection.views ?? [];

    const views = availableViews.length > 0 ? availableViews : collection.views ?? [];
    const activeViewId =
      collectionViewState.get(block.id) ?? pickDefaultView(views) ?? views[0]?.id ?? null;
    collectionViewState.set(block.id, activeViewId);

    const header = document.createElement("div");
    header.className = "collection__header";
    header.innerHTML = `
      <div>
        <p class="collection__eyebrow">database</p>
        <h3>${escapeHtml(block.title || collection.name || "Collection")}</h3>
      </div>
      <p class="collection__count">${collection.rows?.length ?? 0} imported rows</p>
    `;

    const viewSwitcher = document.createElement("div");
    viewSwitcher.className = "collection__views";
    const body = document.createElement("div");
    body.className = "collection__body";

    const renderActiveView = () => {
      body.innerHTML = "";
      const activeView =
        views.find((view) => view.id === collectionViewState.get(block.id)) ?? views[0];

      if (!activeView) {
        body.innerHTML = '<p class="database__empty">No Notion views were available for this collection.</p>';
        return;
      }

      const rows = rowsForView(collection, activeView);
      body.append(renderCollectionViewBody(collection, activeView, rows));
    };

    if (views.length > 1) {
      for (const view of views) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "collection__view-button";
        button.textContent = viewName(view);
        if (view.id === activeViewId) button.dataset.active = "true";
        button.addEventListener("click", () => {
          collectionViewState.set(block.id, view.id);
          for (const other of viewSwitcher.querySelectorAll("button")) {
            delete other.dataset.active;
          }
          button.dataset.active = "true";
          renderActiveView();
        });
        viewSwitcher.append(button);
      }
    }

    section.innerHTML = "";
    section.append(header);
    if (views.length > 1) section.append(viewSwitcher);
    section.append(body);
    renderActiveView();
  } catch (error) {
    if (!section.isConnected) return;
    section.innerHTML = `<p class="database__empty">${escapeHtml(error.message)}</p>`;
  }
}

function scheduleCollectionLoad(section, block) {
  section.__loadCollection = () => hydrateCollectionView(section, block);
  if (collectionObserver) {
    collectionObserver.observe(section);
  } else {
    section.__loadCollection();
  }
}

function renderNav(currentPageSummary) {
  nav.innerHTML = "";
  siteHomeLink.href = routeForPage(siteIndex.rootPageId);

  for (const item of siteIndex.navigation) {
    const link = document.createElement("a");
    link.className = "sidebar__link";
    link.href = routeForPage(item.id);
    link.textContent = item.title;
    if (item.id === currentPageSummary?.id) link.dataset.active = "true";
    nav.append(link);
  }

  status.innerHTML = `<p>${siteIndex.pages.length} pages indexed locally</p>`;
}

function findParentSummary(pageSummary) {
  const parentPageId = pageSummary?.parentPageId ?? pageSummary?.parentId;
  return parentPageId ? pageIndexMap.get(parentPageId) ?? null : null;
}

function renderBreadcrumbs(pageSummary) {
  const trail = [];

  if (isBookPage(pageSummary)) {
    trail.push(
      { id: siteIndex.rootPageId, title: "Home" },
      { id: FULL_TEXT_DATABASE_PAGE_ID, title: "Full Text Database" },
      pageSummary,
    );
  } else {
    let current = pageSummary;
    const visited = new Set();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      trail.unshift(current);
      current = findParentSummary(current);
    }

    if (trail[0]?.id !== siteIndex.rootPageId) {
      trail.unshift({ id: siteIndex.rootPageId, title: "Home" });
    }
  }

  breadcrumbs.innerHTML = trail
    .map((item, index) => {
      const label = item.id === siteIndex.rootPageId ? "Home" : item.title;
      return index === trail.length - 1
        ? `<span>${escapeHtml(label)}</span>`
        : `<a href="${routeForPage(item.id)}">${escapeHtml(label)}</a>`;
    })
    .join('<span class="crumb-sep">/</span>');
}

function renderHeroMarkup(page, fallbackTitle = "Untitled page") {
  const icon = renderIconMarkup(page.icon, "hero__icon");
  const title = escapeHtml(page.title ?? fallbackTitle);

  if (isBookPage(page)) {
    return `
      <div class="hero__inner hero__inner--book">
        <div class="hero__title-row">
          ${icon}
          <h2>${title}</h2>
        </div>
      </div>
    `;
  }

  return `
    <div class="hero__inner">
      ${icon}
      <div>
        <h2>${title}</h2>
      </div>
    </div>
  `;
}

function renderHero(page) {
  hero.innerHTML = renderHeroMarkup(page);
}

function renderPageLoading(summary) {
  hero.innerHTML = renderHeroMarkup(summary ?? {}, "Loading…");
  content.innerHTML = '<p class="database__empty">Loading page…</p>';
}

function syncBookPreviewButtons() {
  const previewOpen = document.body.classList.contains("book-preview-open");

  document.querySelectorAll("[data-book-preview-id]").forEach((button) => {
    const isActive = previewOpen && button.dataset.bookPreviewId === activeBookPreviewPageId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.title = isActive ? "Close book preview" : "Open book preview";
  });
}

function syncShortformPreviewButtons() {
  const previewOpen = document.body.classList.contains("book-preview-open");

  document.querySelectorAll("[data-shortform-preview-id]").forEach((button) => {
    const isActive =
      previewOpen && button.dataset.shortformPreviewId === activeShortformPreviewPageId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.title = isActive ? "Close text preview" : "Open text preview";
  });
}

function closeBookPreview() {
  activeBookPreviewPageId = null;
  activeShortformPreviewPageId = null;
  bookPreviewRenderVersion += 1;
  document.body.classList.remove("book-preview-open");
  bookPreviewPanel.setAttribute("aria-hidden", "true");
  bookPreviewHero.innerHTML = "";
  bookPreviewContent.innerHTML = "";
  bookPreviewContent.classList.remove("page__content--shortform-text");
  bookPreviewContent.classList.add("page__content--book");
  syncBookPreviewButtons();
  syncShortformPreviewButtons();
  updateSpreadsheetFilterViewport?.();
}

async function openBookPreview(pageId, fallbackTitle = "Untitled book") {
  if (!pageId) return;

  if (
    activeBookPreviewPageId === pageId &&
    document.body.classList.contains("book-preview-open")
  ) {
    closeBookPreview();
    return;
  }

  activeBookPreviewPageId = pageId;
  activeShortformPreviewPageId = null;
  const version = ++bookPreviewRenderVersion;
  const fallbackSummary = pageIndexMap.get(pageId) ?? {
    id: pageId,
    title: fallbackTitle,
  };

  document.body.classList.add("book-preview-open");
  bookPreviewPanel.setAttribute("aria-label", "Book preview");
  bookPreviewPanel.setAttribute("aria-hidden", "false");
  bookPreviewContent.classList.remove("page__content--shortform-text");
  bookPreviewContent.classList.add("page__content--book");
  bookPreviewHero.innerHTML = renderHeroMarkup(fallbackSummary, fallbackTitle);
  bookPreviewContent.innerHTML = '<p class="database__empty">Loading book…</p>';
  bookPreviewPanel.scrollTop = 0;
  syncBookPreviewButtons();
  syncShortformPreviewButtons();
  updateSpreadsheetFilterViewport?.();

  try {
    const page = await loadPage(pageId);
    if (version !== bookPreviewRenderVersion) return;

    const tags = await loadBookTags(page);
    if (version !== bookPreviewRenderVersion) return;

    const pageSummary = pageIndexMap.get(page.id) ?? fallbackSummary;
    bookPreviewHero.innerHTML = renderHeroMarkup(page, fallbackTitle);
    bookPreviewContent.innerHTML = "";
    renderBookPage(page, pageSummary, tags, bookPreviewContent);
  } catch (error) {
    if (version !== bookPreviewRenderVersion) return;
    bookPreviewContent.innerHTML = `<p class="database__empty">${escapeHtml(error.message)}</p>`;
  }
}

function shortformBlocksForDisplay(blocks = []) {
  const originalPdfIndex = blocks.findIndex(
    (block) => block.type === "file" && block.kind === "pdf",
  );
  if (originalPdfIndex < 0) return blocks;

  const visibleBlocks = blocks.filter((block, blockIndex) => {
    if (blockIndex >= originalPdfIndex || block.type !== "paragraph") return true;
    const text = String(block.html ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    return !/^~+$/.test(text);
  });

  const bookmarkBlocks = visibleBlocks.filter((block) => block.type === "bookmark");
  if (bookmarkBlocks.length === 0) return visibleBlocks;

  const remainingBlocks = visibleBlocks.filter((block) => block.type !== "bookmark");
  const pdfIndex = remainingBlocks.findIndex(
    (block) => block.type === "file" && block.kind === "pdf",
  );

  return [
    ...remainingBlocks.slice(0, pdfIndex + 1),
    ...bookmarkBlocks,
    ...remainingBlocks.slice(pdfIndex + 1),
  ];
}

function markShortformAuthorRow(target) {
  const authorRow = [...target.querySelectorAll(":scope > .block--paragraph")].find((block) =>
    /^\s*(?:written\s+)?by\b/i.test(block.textContent ?? ""),
  );
  authorRow?.classList.add("shortform-page__author");
}

function renderShortformTextPage(page, pageSummary, target = content) {
  target.append(renderChildren(shortformBlocksForDisplay(page.blocks)));
  markShortformAuthorRow(target);
  populateTableOfContents(pageSummary, target);
}

async function openShortformPreview(pageId, fallbackTitle = "Untitled text") {
  if (!pageId) return;

  if (
    activeShortformPreviewPageId === pageId &&
    document.body.classList.contains("book-preview-open")
  ) {
    closeBookPreview();
    return;
  }

  activeBookPreviewPageId = null;
  activeShortformPreviewPageId = pageId;
  const version = ++bookPreviewRenderVersion;
  const fallbackSummary = pageIndexMap.get(pageId) ?? { id: pageId, title: fallbackTitle };

  document.body.classList.add("book-preview-open");
  bookPreviewPanel.setAttribute("aria-label", "Shortform text preview");
  bookPreviewPanel.setAttribute("aria-hidden", "false");
  bookPreviewContent.classList.remove("page__content--book");
  bookPreviewContent.classList.add("page__content--shortform-text");
  bookPreviewHero.innerHTML = renderHeroMarkup(fallbackSummary, fallbackTitle);
  bookPreviewContent.innerHTML = '<p class="database__empty">Loading text…</p>';
  bookPreviewPanel.scrollTop = 0;
  syncBookPreviewButtons();
  syncShortformPreviewButtons();
  updateSpreadsheetFilterViewport?.();

  try {
    const page = await loadPage(pageId);
    if (version !== bookPreviewRenderVersion) return;
    const pageSummary = pageIndexMap.get(page.id) ?? fallbackSummary;
    bookPreviewHero.innerHTML = renderHeroMarkup(page, fallbackTitle);
    bookPreviewContent.innerHTML = "";
    renderShortformTextPage(page, pageSummary, bookPreviewContent);
  } catch (error) {
    if (version !== bookPreviewRenderVersion) return;
    bookPreviewContent.innerHTML = `<p class="database__empty">${escapeHtml(error.message)}</p>`;
  }
}

function normalizeAssetReference(value) {
  return String(value ?? "").replace(/^\.?\//, "");
}

function imageMatchesCover(block, coverSrc) {
  return (
    block?.type === "image" &&
    coverSrc &&
    normalizeAssetReference(block.src) === normalizeAssetReference(coverSrc)
  );
}

function findFirstImageSrc(blocks = []) {
  for (const block of blocks) {
    if (block?.type === "image" && block.src) return block.src;
    const childImage = findFirstImageSrc(block?.children ?? []);
    if (childImage) return childImage;
  }

  return "";
}

function getBookCoverSrc(page) {
  return page.previewImage || findFirstImageSrc(page.blocks) || "";
}

function removeBookCoverBlock(block, coverSrc) {
  if (imageMatchesCover(block, coverSrc)) return null;

  if (!block?.children?.length) return block;

  const children = block.children
    .map((child) => removeBookCoverBlock(child, coverSrc))
    .filter(Boolean);

  if (block.type === "column" && children.length === 0) return null;

  return {
    ...block,
    children,
  };
}

function blockContainsBookCover(block, coverSrc) {
  return (
    imageMatchesCover(block, coverSrc) ||
    (block?.children ?? []).some((child) => blockContainsBookCover(child, coverSrc))
  );
}

function normalizeBookBlocks(blocks, coverSrc) {
  return blocks.flatMap((block) => {
    const cleanBlock = removeBookCoverBlock(block, coverSrc);
    if (!cleanBlock) return [];

    if (cleanBlock.type === "columns" && cleanBlock.children?.length === 1) {
      return cleanBlock.children[0].children ?? [];
    }

    return [cleanBlock];
  });
}

function bookPageSections(page, coverSrc) {
  const blocks = page.blocks ?? [];
  const coverBlockIndex = coverSrc
    ? blocks.findIndex((block) => blockContainsBookCover(block, coverSrc))
    : -1;

  if (coverBlockIndex < 0) {
    return {
      leading: [],
      description: [],
      body: normalizeBookBlocks(blocks, coverSrc),
    };
  }

  return {
    leading: normalizeBookBlocks(blocks.slice(0, coverBlockIndex), coverSrc),
    description: normalizeBookBlocks([blocks[coverBlockIndex]], coverSrc),
    body: normalizeBookBlocks(blocks.slice(coverBlockIndex + 1), coverSrc),
  };
}

async function loadBookTags(page) {
  try {
    const payload = await loadFullTextDatabasePayload();
    const tagsColumnIndex = payload.columns.indexOf("Tags");
    if (tagsColumnIndex < 0) return [];

    let rowIndex = payload.rowMeta.findIndex((metadata) => metadata?.pageId === page.id);
    if (rowIndex < 0) {
      const titleColumnIndex = payload.columns.indexOf("Title");
      rowIndex = payload.rows.findIndex(
        (row) => row?.[titleColumnIndex]?.trim() === page.title?.trim(),
      );
    }

    if (rowIndex < 0) return [];

    return [
      ...new Set(
        String(payload.rows[rowIndex]?.[tagsColumnIndex] ?? "")
          .split(/\s*,\s*/)
          .map((tag) => tag.replace(/^#+\s*/, "").trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

function renderColumns(node) {
  const wrapper = document.createElement("div");
  wrapper.className = "columns";
  for (const child of node.children ?? []) {
    const column = renderBlock(child);
    if (column) wrapper.append(column);
  }
  return wrapper;
}

function renderChildren(children = []) {
  const fragment = document.createDocumentFragment();
  for (const child of children) {
    const node = renderBlock(child);
    if (node) fragment.append(node);
  }
  return fragment;
}

function renderBookPage(page, pageSummary, tags = [], target = content) {
  const coverSrc = getBookCoverSrc(page);
  const sections = bookPageSections(page, coverSrc);
  const layout = document.createElement("div");
  layout.className = "book-page";

  if (tags.length > 0) {
    const tagList = document.createElement("p");
    tagList.className = "block book-page__tags";
    tagList.setAttribute("aria-label", "Book tags");

    for (const tag of tags) {
      const tagItem = document.createElement("a");
      tagItem.className = "book-page__tag";
      tagItem.href = routeForFullTextDatabaseTag(tag);
      tagItem.setAttribute("aria-label", `View books tagged ${tag}`);
      tagItem.textContent = `#${tag}`;
      tagList.append(tagItem);
    }

    layout.append(tagList);
  }

  if (sections.leading.length > 0) {
    const leading = document.createElement("div");
    leading.className = "book-page__leading";
    leading.append(renderChildren(sections.leading));
    layout.append(leading);
  }

  if (coverSrc) {
    const isPreviewPanel = target === bookPreviewContent;
    const coverImageClass = imageClasses("book-page__cover-image", coverSrc);
    const intro = document.createElement("div");
    intro.className = "book-page__intro";

    const description = document.createElement("div");
    description.className = "book-page__description";
    description.append(renderChildren(sections.description));
    intro.append(description);

    const sidebar = document.createElement("aside");
    sidebar.className = "book-page__sidebar";
    sidebar.innerHTML = `
      <figure class="book-page__cover">
        <img class="${coverImageClass}" src="${escapeHtml(coverSrc)}" alt="${escapeHtml(`${page.title} cover`)}"${isPreviewPanel ? ' tabindex="0" title="Preview cover"' : ""} />
        ${
          isPreviewPanel
            ? `<span class="book-preview-panel__cover-popover" aria-hidden="true">
                <img class="book-preview-panel__cover-popover-image" src="${escapeHtml(coverSrc)}" alt="" />
              </span>`
            : ""
        }
      </figure>
    `;
    intro.append(sidebar);
    layout.append(intro);
  }

  if (sections.body.length > 0) {
    const body = document.createElement("div");
    body.className = "book-page__body";
    body.append(renderChildren(sections.body));
    layout.append(body);
  }

  target.append(layout);
  populateTableOfContents(pageSummary, target);
}

function renderPageCard(targetId, fallbackTitle) {
  const target = pageIndexMap.get(targetId);
  const card = pageCardTemplate.content.firstElementChild.cloneNode(true);
  card.href = routeForPage(targetId);
  card.querySelector(".page-card__title").textContent =
    target?.title || fallbackTitle || "Untitled page";

  const iconSlot = card.querySelector(".page-card__icon");
  if (iconSlot) {
    iconSlot.innerHTML = target ? renderIconMarkup(target.icon, "page-card__icon-mark") : "";
  }

  return card;
}

function renderFileBlock(block) {
  if (!block.src) return null;

  const localDocument = /^\.\/assets\/documents\//.test(block.src);
  if (block.kind === "pdf" && localDocument) {
    const section = document.createElement("section");
    section.className = "block block--pdf";

    const frame = document.createElement("iframe");
    frame.className = "pdf-embed__frame";
    frame.src = `${block.src}#view=FitH`;
    frame.title = block.title || "Embedded PDF document";
    frame.loading = "lazy";
    section.append(frame);
    return section;
  }

  const link = document.createElement("a");
  link.className = "block block--file";
  link.href = block.src;
  if (localDocument) {
    link.download = block.downloadName || block.title || "document.pdf";
  } else {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  link.innerHTML = `
    <span class="file-card__label">${localDocument ? "download" : escapeHtml(block.kind)}</span>
    <strong>${escapeHtml(block.title || (localDocument ? "Download original file" : "Open file"))}</strong>
    ${block.size ? `<span class="file-card__meta">${escapeHtml(block.size)}</span>` : ""}
  `;
  return link;
}

function renderTweetBlock(block) {
  if (!block.src) return null;

  const link = document.createElement("a");
  link.className = "block block--embed block--tweet";
  link.href = block.src;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.innerHTML = `
    <span class="embed__label">tweet</span>
    <span class="embed__url">${escapeHtml(block.src)}</span>
    ${block.caption ? `<span class="embed__caption">${localizeHtmlLinks(block.caption)}</span>` : ""}
  `;
  return link;
}

function renderTableBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "block block--table-wrap";

  const table = document.createElement("table");
  table.className = "block-table";

  const rows = block.rows ?? [];
  const headerRow = block.hasRowHeader && rows.length > 0 ? rows[0] : null;
  const bodyRows = headerRow ? rows.slice(1) : rows;

  if (headerRow) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");

    for (const cell of headerRow.cells) {
      const th = document.createElement("th");
      th.innerHTML = localizeHtmlLinks(cell.html);
      tr.append(th);
    }

    thead.append(tr);
    table.append(thead);
  }

  const tbody = document.createElement("tbody");

  for (const row of bodyRows) {
    const tr = document.createElement("tr");
    row.cells.forEach((cell, index) => {
      const element =
        block.hasColumnHeader && index === 0
          ? document.createElement("th")
          : document.createElement("td");
      if (element.tagName === "TH") element.scope = "row";
      element.innerHTML = localizeHtmlLinks(cell.html);
      tr.append(element);
    });
    tbody.append(tr);
  }

  table.append(tbody);
  wrapper.append(table);
  return wrapper;
}

function renderBlock(block) {
  switch (block.type) {
    case "paragraph": {
      const p = document.createElement("p");
      p.className = "block block--paragraph";
      p.innerHTML = localizeHtmlLinks(block.html);
      return p;
    }
    case "quote": {
      const quote = document.createElement("blockquote");
      quote.className = "block block--quote";
      quote.innerHTML = localizeHtmlLinks(block.html);
      return quote;
    }
    case "header":
    case "subheader":
    case "subsubheader": {
      const tagName =
        block.type === "header" ? "h3" : block.type === "subheader" ? "h4" : "h5";
      const heading = document.createElement(tagName);
      heading.className = `block block--${block.type}`;
      heading.innerHTML = localizeHtmlLinks(block.html);
      if (block.anchorId) {
        heading.id = block.anchorId;
        heading.dataset.anchorId = block.anchorId;
      }
      return heading;
    }
    case "divider": {
      const hr = document.createElement("hr");
      hr.className = "block block--divider";
      return hr;
    }
    case "callout": {
      const aside = document.createElement("aside");
      aside.className = "block block--callout";
      aside.innerHTML = `
        <div class="callout__icon">${renderIconMarkup(block.icon || "※", "callout__icon-mark")}</div>
        <div class="callout__body">
          <div>${localizeHtmlLinks(block.html)}</div>
        </div>
      `;
      if (block.children?.length) {
        aside.querySelector(".callout__body").append(renderChildren(block.children));
      }
      return aside;
    }
    case "columns":
      return renderColumns(block);
    case "column": {
      const column = document.createElement("div");
      column.className = "column";
      column.append(renderChildren(block.children));
      return column;
    }
    case "page_link":
    case "alias_link":
      return renderPageCard(block.targetId, block.title);
    case "image": {
      if (!block.src) return null;
      const figure = document.createElement("figure");
      figure.className = `block block--image${isGifAsset(block.src) ? " block--image--gif" : ""}`;
      figure.innerHTML = `
        <img class="${imageClasses("block__image-media", block.src)}" src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || "")}" />
        ${block.caption ? `<figcaption>${localizeHtmlLinks(block.caption)}</figcaption>` : ""}
      `;
      return figure;
    }
    case "video":
    case "embed":
    case "bookmark": {
      if (!block.src) return null;
      const link = document.createElement("a");
      link.className = "block block--embed";
      link.href = block.src;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.innerHTML = `
        <span class="embed__label">${escapeHtml(block.title || block.type)}</span>
        <span class="embed__url">${escapeHtml(block.src)}</span>
        ${block.caption ? `<span class="embed__caption">${localizeHtmlLinks(block.caption)}</span>` : ""}
      `;
      return link;
    }
    case "tweet":
      return renderTweetBlock(block);
    case "file":
      return renderFileBlock(block);
    case "bulleted_list": {
      const item = document.createElement("p");
      item.className = "block block--list";
      item.innerHTML = `• ${localizeHtmlLinks(block.html)}`;
      return item;
    }
    case "numbered_list": {
      const item = document.createElement("p");
      item.className = "block block--list";
      item.innerHTML = `◦ ${localizeHtmlLinks(block.html)}`;
      return item;
    }
    case "todo": {
      const item = document.createElement("p");
      item.className = "block block--todo";
      item.innerHTML = `${block.checked ? "☑" : "☐"} ${localizeHtmlLinks(block.html)}`;
      return item;
    }
    case "toggle": {
      const details = document.createElement("details");
      details.className = "block block--toggle";
      details.innerHTML = `<summary>${localizeHtmlLinks(block.html)}</summary>`;
      details.append(renderChildren(block.children));
      return details;
    }
    case "code": {
      const pre = document.createElement("pre");
      pre.className = "block block--code";
      pre.innerHTML = localizeHtmlLinks(block.html);
      return pre;
    }
    case "collection_view": {
      const section = document.createElement("section");
      section.className = "block block--collection";
      scheduleCollectionLoad(section, block);
      return section;
    }
    case "synced_block": {
      const section = document.createElement("section");
      section.className = "block block--synced";
      section.innerHTML = '<p class="synced__label">synced block</p>';
      section.append(renderChildren(block.children));
      return section;
    }
    case "table_of_contents": {
      const navElement = document.createElement("nav");
      navElement.className = "block block--toc table-of-contents";
      navElement.innerHTML = '<p class="toc__label">table of contents</p>';
      return navElement;
    }
    case "table":
      return renderTableBlock(block);
    case "container": {
      const section = document.createElement("section");
      section.className = "block block--container";
      section.append(renderChildren(block.children));
      return section;
    }
    default:
      return null;
  }
}

function populateTableOfContents(pageSummary, target = content) {
  const headings = [...target.querySelectorAll("[data-anchor-id]")]
    .map((heading) => ({
      id: heading.dataset.anchorId,
      text: heading.textContent?.trim() ?? "",
      depth: Number(heading.tagName.slice(1)),
    }))
    .filter((heading) => heading.text);

  for (const toc of target.querySelectorAll(".table-of-contents")) {
    if (headings.length === 0) {
      toc.innerHTML =
        '<p class="toc__label">table of contents</p><p class="toc__empty">No headings on this page.</p>';
      continue;
    }

    toc.innerHTML = `
      <p class="toc__label">table of contents</p>
      <div class="toc__items">
        ${headings
          .map(
            (heading) => `
              <a class="toc__item toc__item--depth-${heading.depth}" href="#/${pageSummary.slug}">
                <span data-anchor-link="${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</span>
              </a>
            `,
          )
          .join("")}
      </div>
    `;

    for (const link of toc.querySelectorAll("[data-anchor-link]")) {
      link.parentElement.addEventListener("click", (event) => {
        event.preventDefault();
        const target = document.getElementById(link.dataset.anchorLink);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
}

async function renderCurrentRoute() {
  let summary = resolvePageSummary();
  const route = currentHashRoute();
  if (
    summary?.id === SHORTFORM_ESSAYS_PAGE_ID ||
    summary?.id === SHORTFORM_POEMS_AND_STORIES_PAGE_ID
  ) {
    const filterQuery = new URLSearchParams();
    if (summary.id === SHORTFORM_ESSAYS_PAGE_ID) {
      filterQuery.append("type", "Essay / Article / Blogpost");
    } else {
      filterQuery.append("type", "Poetry");
      filterQuery.append("type", "Short Story");
    }
    window.history.replaceState(
      null,
      "",
      `${routeForPage(SHORTFORM_DATABASE_PAGE_ID)}?${filterQuery}`,
    );
    summary = pageIndexMap.get(SHORTFORM_DATABASE_PAGE_ID) ?? summary;
  }
  if (
    summary?.id === FULL_TEXT_DATABASE_PAGE_ID &&
    route.path !== summary.slug
  ) {
    const query = route.searchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${routeForPage(FULL_TEXT_DATABASE_PAGE_ID)}${query ? `?${query}` : ""}`,
    );
  }
  const version = ++renderVersion;

  applyPageChrome(summary);
  renderNav(summary);
  renderBreadcrumbs(summary);
  renderPageLoading(summary);

  try {
    const page = await loadPage(summary.id);
    if (version !== renderVersion) return;

    const bookPage = isBookPage(page);
    const shortformTextPage = isShortformTextPage(summary);
    const bookTags = bookPage ? await loadBookTags(page) : [];
    if (version !== renderVersion) return;

    renderHero(
      isShortformDatabasePage(page) ? { ...page, title: "Shortform Texts" } : page,
    );
    content.innerHTML = "";
    content.classList.toggle("page__content--book", bookPage);
    content.classList.toggle("page__content--shortform-text", shortformTextPage);
    if (isFullTextDatabasePage(page)) {
      content.append(await renderFullTextDatabaseSpreadsheet());
    } else if (isFolksDatabasePage(page)) {
      content.append(await renderFolksDatabaseSpreadsheet());
    } else if (isShortformDatabasePage(page)) {
      content.append(await renderShortformDatabaseSpreadsheet());
    } else if (bookPage) {
      renderBookPage(page, summary, bookTags);
    } else if (shortformTextPage) {
      renderShortformTextPage(page, summary);
    } else {
      content.append(renderChildren(page.blocks));
      populateTableOfContents(summary);
    }
  } catch (error) {
    if (version !== renderVersion) return;
    hero.innerHTML = renderHeroMarkup(summary ?? {}, "Unavailable page");
    content.classList.remove("page__content--book");
    content.innerHTML = `<p class="database__empty">${escapeHtml(error.message)}</p>`;
  }
}

menuToggle.addEventListener("click", () => {
  setSidebarOpen(!sidebar.classList.contains("is-open"));
});

sidebarBackdrop.addEventListener("click", () => {
  setSidebarOpen(false);
});

bookPreviewClose.addEventListener("click", () => {
  closeBookPreview();
});

nav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    setSidebarOpen(false);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSidebarOpen(false);
    closeBookPreview();
  }
});

window.addEventListener("hashchange", () => {
  renderCurrentRoute();
  sidebar.classList.remove("is-open");
});

renderCurrentRoute();
