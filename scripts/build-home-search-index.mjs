import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(projectRoot, 'data');
const pagesDir = path.join(dataDir, 'pages');
const siteIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'site-index.json'), 'utf8'));

const decodeHtml = value => String(value ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/\s+/g, ' ')
  .trim();

function richText(value) {
  if (!Array.isArray(value)) return '';
  return value.map(part => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join(' ');
}

function collectBlockText(blocks, output = []) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const field of ['html', 'text', 'title', 'caption', 'description', 'name']) {
      if (typeof block?.[field] === 'string') output.push(block[field]);
    }
    collectBlockText(block?.children, output);
  }
  return output;
}

function splitTags(value) {
  return decodeHtml(value)
    .split(/[,;|]/)
    .map(tag => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
}

const tagsByPageId = new Map();
const addTags = (pageId, tags) => {
  if (!pageId || !tags.length) return;
  const existing = tagsByPageId.get(pageId) ?? new Set();
  tags.forEach(tag => existing.add(tag));
  tagsByPageId.set(pageId, existing);
};

for (const filename of fs.readdirSync(dataDir).filter(name => /database.*\.json$/i.test(name))) {
  const database = JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
  const columns = (database.columns ?? []).map(column => typeof column === 'string' ? column : column?.name ?? '');
  const tagColumns = columns
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => /^(tags?|themes?)$/i.test(name));
  if (!tagColumns.length) continue;
  (database.rows ?? []).forEach((row, rowIndex) => {
    const pageId = database.rowMeta?.[rowIndex]?.pageId;
    const tags = tagColumns.flatMap(({ index }) => splitTags(row?.[index]));
    addTags(pageId, tags);
  });
}

const records = siteIndex.pages.map(summary => {
  const filename = path.join(pagesDir, `${summary.id}.json`);
  let page = null;
  try { page = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch {}

  const propertyTags = Object.entries(page?.properties ?? {})
    .filter(([name]) => /^(tags?|themes?)$/i.test(name))
    .flatMap(([, value]) => splitTags(richText(value)));
  addTags(summary.id, propertyTags);

  const content = decodeHtml(collectBlockText(page?.blocks).join(' '));
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    tags: [...(tagsByPageId.get(summary.id) ?? [])].sort((a, b) => a.localeCompare(b)),
    content,
  };
});

fs.writeFileSync(
  path.join(dataDir, 'home-search-index.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), records })}\n`,
);
console.log(`Wrote ${records.length} searchable pages to data/home-search-index.json`);
