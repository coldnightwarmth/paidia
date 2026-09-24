import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dataDir = path.resolve(process.env.SITE_DATA_DIR ?? 'data');
const pagesDir = path.join(dataDir, 'pages');
const rawDir = path.join(dataDir, 'notion-raw');
const databaseId = 'da0f6a33-7bc6-4708-9bf2-ad2d25c64734';
const podcastPageId = '6b382510-adf0-424c-8a6d-b33ee802b6aa';
const channelPageId = '4c0dd493-cab5-487c-860b-27febc60fb3f';

const videoSources = [
  ['a721b8fd-1459-4307-bc8c-22001460e593', 'Video Games', 'Video Essay'],
  ['17ff1def-a05d-4aed-b9ef-9bdead1cb076', 'Lectures', 'Lecture'],
  ['0f796b10-824c-4c6b-888a-884bf10f7e52', 'History', 'Video Essay'],
  ['99242db1-443d-403b-9c66-34784beb379d', 'Tabletop Games', 'Video Essay'],
  ['077269d0-99e5-4e12-a680-474eba14225f', 'Fighting Games', 'Video Essay'],
  ['1c251741-1d9c-4547-b208-08d71e7bbda9', 'Computer Media', 'Video Essay'],
  ['e3ce7e60-2c33-4fc6-b684-161d6b05d846', 'Sports', 'Video Essay'],
  ['6f883d7b-d116-4d56-9eca-c7759b1519ed', 'Toys', 'Video Essay'],
  ['12a4ea15-cc03-442d-a738-9b0732069d3d', 'Miscellaneous', 'Video Essay'],
  ['22a8e64a-efda-4ee0-b919-21619f2231e1', 'Extraordinary Play', 'Video'],
];

const read = async file => JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
const write = async (file, value) => fs.writeFile(path.join(dataDir, file), `${JSON.stringify(value, null, 2)}\n`);
const page = id => read(`pages/${id}.json`);
const decode = value => String(value ?? '')
  .replace(/<[^>]*>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'media';
const htmlEscape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const anchors = html => [...String(html ?? '').matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(match => ({ href: match[1], text: decode(match[2]) }));
const youtubeId = url => String(url ?? '').match(/(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/i)?.[1] ?? '';
const youtubeWatchUrl = url => youtubeId(url) ? `https://www.youtube.com/watch?v=${youtubeId(url)}` : url;
const youtubeThumbnail = url => youtubeId(url) ? `https://i.ytimg.com/vi/${youtubeId(url)}/hqdefault.jpg` : '';

async function rawBookmarkData(pageId) {
  try {
    const raw = await read(`notion-raw/${pageId}.json`);
    const result = new Map();
    for (const [id, record] of Object.entries(raw.recordMap?.block ?? {})) {
      const block = record.value?.value ?? record.value;
      if (block?.type !== 'bookmark') continue;
      result.set(id, {
        url: block.properties?.link?.[0]?.[0] ?? '',
        description: block.properties?.description?.[0]?.[0] ?? '',
        image: block.format?.bookmark_cover ?? '',
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

const records = new Map();
function addRecord(record) {
  record.title = decode(record.title);
  record.creator = decode(record.creator).replace(/^by\s+/i, '');
  record.categories = [...new Set((record.categories ?? []).map(decode).filter(Boolean))];
  record.tags = [...new Set((record.tags ?? []).map(decode).filter(Boolean))];
  record.sourceUrl = youtubeWatchUrl(record.sourceUrl || record.embedUrl || '');
  const key = youtubeId(record.embedUrl || record.sourceUrl)
    ? `youtube:${youtubeId(record.embedUrl || record.sourceUrl)}`
    : record.sourceUrl
      ? `url:${record.sourceUrl.replace(/\/$/, '').toLowerCase()}`
      : `title:${record.type}:${record.title.toLowerCase()}`;
  const existing = records.get(key);
  if (existing) {
    existing.categories = [...new Set([...existing.categories, ...record.categories])];
    existing.tags = [...new Set([...existing.tags, ...record.tags])];
    if (!existing.creator) existing.creator = record.creator;
    if (!existing.image) existing.image = record.image;
    return;
  }
  records.set(key, record);
}

function mediaFromCallout(block, rawBookmarks) {
  const children = block.children ?? [];
  const byline = children.find(child => child.type === 'paragraph' && /^\s*by\b/i.test(decode(child.html)));
  const media = children.find(child => ['video', 'embed', 'bookmark'].includes(child.type));
  const raw = media?.type === 'bookmark' ? rawBookmarks.get(media.id) : null;
  const embedUrl = ['video', 'embed'].includes(media?.type) ? media.src : '';
  const sourceUrl = raw?.url || media?.src || anchors(byline?.html)[0]?.href || '';
  return {
    title: decode(block.html) || decode(media?.title),
    creator: decode(byline?.html),
    creatorUrl: anchors(byline?.html)[0]?.href ?? '',
    embedUrl,
    sourceUrl,
    description: decode(raw?.description),
    image: youtubeThumbnail(embedUrl) || raw?.image || '',
  };
}

async function collectVideoPage(pageId, category, type) {
  const source = await page(pageId);
  const raw = await rawBookmarkData(pageId);
  function walk(blocks, activeTag = '') {
    let tag = activeTag;
    for (const block of blocks ?? []) {
      if (['header', 'subheader', 'sub_sub_header'].includes(block.type)) tag = decode(block.html);
      if (block.type === 'callout') {
        const media = mediaFromCallout(block, raw);
        if (media.title) addRecord({ ...media, type, categories: [category], tags: tag ? [tag] : [] });
        continue;
      }
      if (block.children?.length) walk(block.children, tag);
    }
  }
  walk(source.blocks);
}

async function collectPodcasts() {
  const source = await page(podcastPageId);
  const raw = await rawBookmarkData(podcastPageId);
  function walk(blocks, section = '') {
    let currentSection = section;
    for (const block of blocks ?? []) {
      if (['header', 'subheader', 'sub_sub_header'].includes(block.type)) currentSection = decode(block.html);
      if (block.type === 'callout') {
        const media = mediaFromCallout(block, raw);
        if (!media.title) continue;
        const title = media.title;
        const interview = /interview|discussion|roundtable|panel|w\//i.test(title);
        const type = currentSection === 'Series' ? 'Podcast' : interview ? 'Interview' : 'Podcast Episode';
        addRecord({ ...media, type, categories: ['Podcasts & Interviews'], tags: [currentSection] });
        continue;
      }
      if (block.children?.length) walk(block.children, currentSection);
    }
  }
  walk(source.blocks);
}

async function collectChannels() {
  const source = await page(channelPageId);
  function walk(blocks, category = '') {
    for (const block of blocks ?? []) {
      if (block.type === 'toggle') {
        walk(block.children, decode(block.html));
        continue;
      }
      if (block.type === 'bookmark' && (block.src || block.title)) {
        addRecord({
          title: block.title || block.src,
          creator: block.title || '', type: 'YouTube Channel',
          categories: ['YouTube Channels'], tags: category ? [category] : [],
          sourceUrl: block.src || '', image: '',
        });
        continue;
      }
      if (block.type === 'paragraph') {
        for (const anchor of anchors(block.html)) {
          if (!/youtu(?:be|\.be)/i.test(anchor.href)) continue;
          addRecord({
            title: anchor.text, creator: anchor.text, type: 'YouTube Channel',
            categories: ['YouTube Channels'], tags: category ? [category] : [],
            sourceUrl: anchor.href, image: '',
          });
        }
      }
      if (block.children?.length) walk(block.children, category);
    }
  }
  walk(source.blocks);
}

for (const [id, category, type] of videoSources) await collectVideoPage(id, category, type);
await collectPodcasts();
await collectChannels();

const index = await read('site-index.json');
index.pages = index.pages.filter(summary => !summary.videoAudioGenerated);
const site = index;
const usedSlugs = new Set(index.pages.map(summary => summary.slug));
const sorted = [...records.values()].sort((a, b) => a.title.localeCompare(b.title));

for (const record of sorted) {
  const identity = `${record.type}|${record.title}|${record.sourceUrl || record.embedUrl}`;
  const id = `media-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
  let slug = `media-${slugify(record.title)}`;
  if (usedSlugs.has(slug)) slug = `${slug}-${id.slice(-6)}`;
  usedSlugs.add(slug);
  const icon = record.type === 'YouTube Channel' ? '▶️' : record.type === 'Podcast' ? '🎙️' : '📹';
  const tags = [...new Set([...record.categories, ...record.tags, record.type].filter(Boolean))];
  const blocks = [];
  if (record.creator) {
    const creatorMarkup = record.creatorUrl
      ? `<a href="${htmlEscape(record.creatorUrl)}" target="_blank" rel="noreferrer">${htmlEscape(record.creator)}</a>`
      : htmlEscape(record.creator);
    blocks.push({
      id: `${id}-creator`, type: 'paragraph',
      html: `<em>by ${creatorMarkup}</em>`,
    });
  }
  if (record.embedUrl) {
    blocks.push({ id: `${id}-embed`, type: 'video', src: record.embedUrl, title: record.title, caption: '' });
  }
  if (record.description) {
    blocks.push({ id: `${id}-description`, type: 'paragraph', html: htmlEscape(record.description) });
  }
  const sourceUrl = record.sourceUrl || record.creatorUrl;
  if (sourceUrl) {
    blocks.push({
      id: `${id}-source`, type: 'paragraph',
      html: `<a href="${htmlEscape(sourceUrl)}" target="_blank" rel="noreferrer">Open original ${record.type === 'YouTube Channel' ? 'channel' : record.type === 'Podcast' ? 'podcast' : 'media'}</a>`,
    });
  }
  const itemPage = {
    id, slug, title: record.title, icon, cover: '', type: 'page',
    parentId: databaseId, parentPageId: databaseId,
    sourceUrl, previewImage: record.image || youtubeThumbnail(record.embedUrl),
    properties: {
      title: [[record.title]],
      'Creator(s)': [[record.creator]],
      Category: [[record.categories.join(', ')]],
      Type: [[record.type]],
      Tags: [[tags.join(', ')]],
      Source: [[sourceUrl]],
    },
    catalog: { databaseId, database: 'video-audio', categories: record.categories, tags },
    videoAudioGenerated: true,
    blocks,
  };
  await write(`pages/${id}.json`, itemPage);
  index.pages.push({
    id, slug, title: record.title, type: 'page', icon,
    parentPageId: databaseId, previewImage: itemPage.previewImage,
    catalog: itemPage.catalog, videoAudioGenerated: true,
  });
  record.page = itemPage;
}

const categoryOrder = videoSources.map(([, category]) => category).concat(['Podcasts & Interviews', 'YouTube Channels']);
const payload = {
  columns: ['Name', 'Category', 'Creator(s)', 'Type', 'Tags'],
  lists: [...new Set(categoryOrder)],
  rows: sorted.map(record => [
    record.title, record.categories.join(', '), record.creator, record.type, record.tags.join(', '),
  ]),
  rowMeta: sorted.map(record => ({
    key: record.page.id, pageId: record.page.id, href: `#/${record.page.slug}`,
    icon: record.page.icon, image: record.page.previewImage,
  })),
};
await write('video-audio-database.json', payload);

const root = await page(databaseId);
root.title = 'Video+Audio';
root.properties.title = [['Video+Audio']];
root.catalogDatabase = 'video-audio';
root.parentPageId = index.rootPageId;
root.icon = './assets/home/video.png';
await write(`pages/${databaseId}.json`, root);
const rootSummary = index.pages.find(summary => summary.id === databaseId);
Object.assign(rootSummary, { title: root.title, icon: root.icon, parentPageId: index.rootPageId, catalogDatabase: 'video-audio' });
const navigation = index.navigation.find(item => item.id === databaseId);
if (navigation) navigation.title = root.title;
await write('site-index.json', index);
await write('site.json', site);

if (process.env.DEFER_PAGE_UPDATES !== '1') {
  const { refreshPageUpdates } = await import('./lib/page-updates.mjs');
  await refreshPageUpdates(dataDir);
}
console.log(`Video+Audio: ${sorted.length} items (${sorted.filter(item => item.embedUrl).length} embedded)`);
