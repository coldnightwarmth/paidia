import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PAGE_ID = '98d887c7-256f-43e6-9a3b-ffba4c3b855d';
const VIEW_ID = 'e9fd8f08-9859-45f1-9ac5-cc18add84cd6';
const SPACE_ID = '44027fb1-7c2b-4f10-bf30-bc638c76d64c';
const SOURCE_URL = `https://paidiasophia.notion.site/${PAGE_ID.replaceAll('-', '')}?v=${VIEW_ID.replaceAll('-', '')}`;
const OUTPUT_DIR = path.resolve('assets/home/playthings');
const MANIFEST_PATH = path.resolve('data/home-playthings.json');
const INITIAL_TITLES = [
  'Royal Game of Ur',
  'Horned Beetle',
  'Digivice',
  'Arcade Cabinet',
  'Sling Shot',
  'Cherries',
];

function plainText(value) {
  return (value ?? []).map(part => part?.[0] ?? '').join('').replace(/^\*+/, '').trim();
}

function slugify(value) {
  return value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plaything';
}

async function fetchRecordMap() {
  const response = await fetch('https://paidiasophia.notion.site/api/v3/loadPageChunk', {
    method: 'POST',
    headers: {
      accept: 'application/json,*/*',
      'content-type': 'application/json',
      origin: 'https://paidiasophia.notion.site',
      referer: SOURCE_URL,
      'user-agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      pageId: PAGE_ID,
      limit: 100,
      cursor: { stack: [] },
      chunkNumber: 0,
      verticalColumns: false,
    }),
  });
  if (!response.ok) throw new Error(`Notion page request failed (${response.status})`);
  return (await response.json()).recordMap;
}

async function fetchRows(pageIds) {
  const rows = [];
  for (let index = 0; index < pageIds.length; index += 100) {
    const ids = pageIds.slice(index, index + 100);
    const response = await fetch('https://www.notion.so/api/v3/syncRecordValues', {
      method: 'POST',
      headers: {
        accept: 'application/json,*/*',
        'content-type': 'application/json',
        'notion-client-version': '23.13.0.0',
        origin: 'https://paidiasophia.notion.site',
        referer: SOURCE_URL,
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        requests: ids.map(id => ({
          pointer: { table: 'block', id, spaceId: SPACE_ID },
          version: -1,
        })),
      }),
    });
    if (!response.ok) throw new Error(`Notion row request failed (${response.status})`);
    const payload = await response.json();
    rows.push(...ids.map(id => payload.recordMap?.block?.[id]?.value?.value).filter(Boolean));
  }
  return rows;
}

async function downloadIcon(row) {
  const title = plainText(row.properties?.title);
  const source = row.format?.page_icon;
  if (!title || !source?.startsWith('http')) return null;
  const imageUrl = `https://www.notion.so/image/${encodeURIComponent(source)}?table=block&id=${row.id}&cache=v2`;
  const response = await fetch(imageUrl, {
    redirect: 'follow',
    headers: {
      referer: SOURCE_URL,
      'user-agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) throw new Error(`${title}: image request failed (${response.status})`);
  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const trimmed = await sharp(sourceBuffer).ensureAlpha().trim({
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  const metadata = await sharp(trimmed).metadata();
  const longestSide = Math.max(metadata.width ?? 1, metadata.height ?? 1);
  const scale = 160 / longestSide;
  const width = Math.max(1, Math.round((metadata.width ?? 1) * scale));
  const height = Math.max(1, Math.round((metadata.height ?? 1) * scale));
  const fileName = `${slugify(title)}-${row.id.slice(0, 8)}.png`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  const left = Math.floor((192 - width) / 2);
  const right = 192 - width - left;
  const top = Math.floor((192 - height) / 2);
  const bottom = 192 - height - top;
  await sharp(trimmed)
    .resize(width, height, { kernel: sharp.kernel.nearest })
    .extend({ top, bottom, left, right, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
  return {
    title,
    pageId: row.id,
    src: `./assets/home/playthings/${fileName}`,
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const recordMap = await fetchRecordMap();
  const view = recordMap.collection_view?.[VIEW_ID]?.value?.value;
  const pageIds = view?.page_sort ?? [];
  if (!pageIds.length) throw new Error('The Completed icons view contained no pages.');
  const rows = await fetchRows(pageIds);
  const icons = [];
  for (const row of rows) {
    try {
      const icon = await downloadIcon(row);
      if (icon) icons.push(icon);
    } catch (error) {
      console.warn(error.message);
    }
  }
  const initial = INITIAL_TITLES.map(title => icons.find(icon => icon.title === title)).filter(Boolean);
  if (initial.length !== INITIAL_TITLES.length) {
    throw new Error(`Only ${initial.length} of ${INITIAL_TITLES.length} starting icons were found.`);
  }
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify({ source: SOURCE_URL, initial, icons }, null, 2)}\n`);
  console.log(`Saved ${icons.length} normalized play-thing icons.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
