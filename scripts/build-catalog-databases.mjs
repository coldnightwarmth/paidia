import { applyGameEnrichment } from './lib/game-enrichment.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dataDir = path.resolve(process.env.SITE_DATA_DIR ?? 'data');
const read = async name => JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8'));
const write = async (name, value) => fs.writeFile(path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`);
const index = await read('site-index.json');
let gameEnrichment = {entries:{}};
try { gameEnrichment = await read('game-enrichment.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const summaries = new Map(index.pages.map(page => [page.id, page]));
const pages = new Map();
const load = async id => {
  if (!pages.has(id)) pages.set(id, await read(`pages/${id}.json`));
  return pages.get(id);
};
const text = html => String(html ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g,' ').trim();
const tokens = value => (value ?? []).map(part => part[0]).join('');
const slugify = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const definitions = [
  {key:'games',id:'549e6748-f2f1-4f8d-9243-68d0b9f00343',title:'Games',slug:'games-549e6748',icon:'videogames',categories:['Videogames','Tabletop','Sports','Other Games & Toys']},
  {key:'other-media',id:'7070e92d-6389-4c6c-88f2-0b38bc3d8e3a',title:'Other',slug:'other',icon:'media',categories:['Films & TV','Anime & Manga','Music','Software']},
  {key:'objects',id:'5c956dc7-7bd4-439f-973e-3d819d90149d',title:'Objects',slug:'artifacts',icon:'object',categories:[]},
  {key:'images',id:'2051fa00-5190-42a6-af57-6eca9f5b55d0',title:'Images',slug:'images',icon:'image',categories:[]},
];
const records = new Map(definitions.map(d=>[d.key,new Map()]));
function register(page, database, category, tags = []) {
  const existing = records.get(database.key).get(page.id);
  const record = existing ?? {page, categories:[], tags:[]};
  if (category && !record.categories.includes(category)) record.categories.push(category);
  record.tags = [...new Set([...record.tags,...tags].filter(Boolean))];
  records.get(database.key).set(page.id,record);
}
async function makePage(title, database, sourceId, block) {
  const id = `catalog-${createHash('sha256').update(`${database.key}:${title}`).digest('hex').slice(0,20)}`;
  if (summaries.has(id)) return load(id);
  const baseSlug = `${database.key}-${slugify(title)}`;
  const slug = index.pages.some(p=>p.slug===baseSlug) ? `${baseSlug}-${id.slice(-8)}` : baseSlug;
  let page = {id,slug,title,type:'page',icon:`./assets/home/${database.icon}.png`,parentId:database.id,parentPageId:database.id,properties:{title:[[title]]},blocks:[]};
  if (block?.html) page.blocks.push({...block,id:`${id}-source`});
  page.catalogSourcePageId = sourceId;
  // A full source rebuild drops generated summaries, but their edited page files survive.
  try { page = await read(`pages/${id}.json`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  pages.set(id,page); const summary={id,slug:page.slug,title:page.title,type:'page',icon:page.icon,parentPageId:database.id};summaries.set(id,summary);index.pages.push(summary);
  return page;
}
async function collectLinks(sourceId, database, category) {
  const page = await load(sourceId);
  async function walk(blocks, tags=[]) {
    for(const block of blocks??[]) {
      if ((block.type==='page_link'||block.type==='alias_link') && block.targetId && block.title !== 'Linked page') {
        // Legacy aliases can point to unrelated pages; only reuse a matching title.
        const candidates=[block.targetId,index.pageAliases?.[block.targetId]].filter(Boolean);
        const summary=candidates.map(id=>summaries.get(id)).find(p=>p && text(p.title).toLowerCase()===text(block.title).toLowerCase());
        const item=summary ? await load(summary.id) : await makePage(text(block.title),database,sourceId);
        register(item,database,category,tags);
      }
      const tag = block.type==='toggle' ? text(block.html).replace(/\s*\[\d+\]$/,'') : '';
      await walk(block.children, tag ? [...tags,tag] : tags);
    }
  }
  await walk(page.blocks);
}
const games=definitions[0],media=definitions[1];
const videoCollection=await read('collections/a26e119e-af46-4ce4-bc67-a108ebc9f1a5.json');
for(const row of videoCollection.rows) register(await load(row.id),games,'Videogames',tokens(row.properties?.Wkec).split(',').map(t=>t.trim()));
await collectLinks('70aaf802-4e58-4f10-b89b-e11ce8160ac2',games,'Tabletop');
await collectLinks('28565453-030e-4ef0-902b-711c38f035e0',games,'Sports');
await collectLinks('05f8dc7a-3411-4896-ba6a-b02e65928607',games,'Other Games & Toys');
await collectLinks('d3f43526-12ca-4bd6-992f-54a446745d82',media,'Films & TV');
await collectLinks('db7886e6-f427-4b0b-b629-b1a5bbc8ccb2',media,'Software');
// This source list contains a named item as plain text, rather than a linked page.
const anime=await load('2f59e012-4f25-4241-ae5b-9c5cec38b0ba');
const animeDividers=anime.blocks.map((b,i)=>b.type==='divider'?i:-1).filter(i=>i>=0);
for(const block of anime.blocks.slice(animeDividers[0]+1,animeDividers[1])) {
  if(block.type==='paragraph' && text(block.html)) register(await makePage(text(block.html),media,anime.id,block),media,'Anime & Manga');
}
await collectLinks('bb4976cc-8007-43b7-a2e2-013b3a4d8f57',media,'Music');

for(const definition of definitions) {
  const root=await load(definition.id);
  root.title=definition.title; root.slug=definition.slug; root.icon=`./assets/home/${definition.icon}.png`;
  root.properties.title=[[definition.title]];
  root.catalogDatabase=definition.key;
  root.parentPageId=index.rootPageId;
  Object.assign(summaries.get(root.id),{title:root.title,slug:root.slug,icon:root.icon,catalogDatabase:definition.key,parentPageId:index.rootPageId});
  const nav=index.navigation.find(p=>p.id===root.id);if(nav)Object.assign(nav,{title:root.title,slug:root.slug});
  else index.navigation.push({id:root.id,slug:root.slug,title:root.title});
  const rows=[...records.get(definition.key).values()].sort((a,b)=>a.page.title.localeCompare(b.page.title));
  for(const record of rows) {
    const {page,categories,tags}=record;
    if (definition.key === 'games') applyGameEnrichment(page, gameEnrichment.entries[page.id]);
    page.catalog = {databaseId:definition.id,database:definition.key,categories,tags:[...new Set([...categories,...tags])]};
    page.properties.Category=[[categories.join(', ')]];
    page.properties.Tags=[[page.catalog.tags.join(', ')]];
    const summary=summaries.get(page.id);
    Object.assign(summary,{parentPageId:definition.id,catalog:page.catalog});
    page.parentPageId=definition.id;
    await write(`pages/${page.id}.json`,page);
  }
  const payload={columns:definition.key === 'games' ? ['Name','Category','Creator(s)','Tags','Publisher','First Release','Origin'] : ['Name','Category','Creator(s)','Tags'],lists:definition.categories,
    rows:rows.map(({page,categories,tags})=>[page.title,categories.join(', '),page.gameDetails?.creator || tokens(page.properties?.ZLnP),tags.join(', '),...(definition.key === 'games' ? [page.gameDetails?.publisher || '',page.gameDetails?.releaseDate || '',page.gameDetails?.origin || ''] : [])]),
    rowMeta:rows.map(({page})=>({key:page.id,pageId:page.id,href:`#/${page.slug}`,icon:page.icon||root.icon,image:page.previewImage||page.cover||''}))};
  await write(`${definition.key}-database.json`,payload); await write(`pages/${root.id}.json`,root);
  console.log(`${definition.title}: ${rows.length} items`);
}

// Groups already belong to the People database; give its formerly plain-text rows pages too.
const folks=await read('folks-database.json');
for(let i=0;i<folks.rows.length;i++) {
  if(folks.rows[i][1]!=='Groups')continue;
  const title=folks.rows[i][0];
  const definition={key:'groups',id:'292fe1df-a5bd-4b49-97aa-f336bf0ac103',icon:'groups'};
  const page=await makePage(title,definition,'f82fec8f-e213-45ea-8eea-ad34adadb59a');
  page.properties.Category=[['Groups']]; page.peopleCategory='Groups';
  await write(`pages/${page.id}.json`,page);
  folks.rowMeta[i]={...folks.rowMeta[i],pageId:page.id,href:`#/${page.slug}`,icon:page.icon};
}
await write('folks-database.json',folks);
index.navigation = index.navigation.filter(item => item.id !== '907a3709-7f78-4bb3-87ce-ee1c5985483c');
const imagesNav = index.navigation.find(item => item.id === '2051fa00-5190-42a6-af57-6eca9f5b55d0');
if (imagesNav) {
  index.navigation = index.navigation.filter(item => item.id !== imagesNav.id);
  index.navigation.splice(index.navigation.findIndex(item => item.id === '5c956dc7-7bd4-439f-973e-3d819d90149d') + 1, 0, imagesNav);
}
for (const [id, afterId] of [
  ['292fe1df-a5bd-4b49-97aa-f336bf0ac103', '2051fa00-5190-42a6-af57-6eca9f5b55d0'],
  ['2b9dc0d1-2d66-4aeb-b050-fb9835b1338a', '292fe1df-a5bd-4b49-97aa-f336bf0ac103'],
]) {
  const item = index.navigation.find(item => item.id === id);
  if (!item) continue;
  index.navigation = index.navigation.filter(item => item.id !== id);
  index.navigation.splice(index.navigation.findIndex(item => item.id === afterId) + 1, 0, item);
}
await write('site-index.json',index); await write('site.json',index);
const { refreshPageUpdates } = await import('./lib/page-updates.mjs');
if (process.env.DEFER_PAGE_UPDATES !== '1') await refreshPageUpdates(dataDir);
