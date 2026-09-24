import { describeChanges, isTagField, tagValues } from '../../src/update-notes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const ignored = new Set(['lastEditedTime','createdTime','lastEditedById','createdById','updatedAt','generatedAt']);
export function contentHash(value) {
  const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key=>!ignored.has(key)).map(key=>[key,normalize(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
async function read(file, fallback) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch(error) { if(error.code==='ENOENT' && fallback!==undefined)return fallback;throw error; }
}
async function writeChanged(file,value) {
  const text=JSON.stringify(value,null,2)+'\n';
  try { if(await fs.readFile(file,'utf8')===text)return; } catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary,text);await fs.rename(temporary,file);
}
export async function refreshPageUpdates(dataDir = path.resolve('data'), now = Date.now()) {
  const index=await read(path.join(dataDir,'site-index.json'));
  const previous=await read(path.join(dataDir,'page-revisions.json'),{pages:{}});
  const rowData=new Map();
  const collections=new Map();
  const columnsByFile=new Map();
  for(const filename of await fs.readdir(dataDir)) {
    if(!/database.*\.json$/.test(filename))continue;
    const database=await read(path.join(dataDir,filename));
    columnsByFile.set(filename,database.columns??[]);
    for(const [i,meta] of (database.rowMeta??[]).entries())if(meta.pageId){
      const entries=rowData.get(meta.pageId)??[];entries.push({file:filename,row:database.rows[i],meta});rowData.set(meta.pageId,entries);
    }
  }
  const collectionDir=path.join(dataDir,'collections');
  try { for(const filename of await fs.readdir(collectionDir))collections.set(filename.slice(0,-5),await read(path.join(collectionDir,filename))); }
  catch(error){if(error.code!=='ENOENT')throw error;}
  const state={version:2,pages:{}};
  const updates=[];
  for(const summary of index.pages) {
    const file=path.join(dataDir,'pages',`${summary.id}.json`);
    let page;try{page=await read(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    const linkedCollections=[];
    function collect(blocks){for(const b of blocks??[]){if(b.collectionId&&collections.has(b.collectionId))linkedCollections.push(collections.get(b.collectionId));collect(b.children);}}
    collect(page.blocks);
    const hash=contentHash({page,rows:rowData.get(page.id)??[],collections:linkedCollections});
    const tags = [];
    const properties = {};
    for (const [key,value] of Object.entries(page.properties ?? {})) {
      if (isTagField(key)) tags.push(...tagValues(value));
      else properties[key] = value;
    }
    const content = (page.blocks ?? []).map(contentHash);
    for (const collection of linkedCollections) content.push(contentHash(collection));
    for (const entry of rowData.get(page.id) ?? []) {
      entry.row.forEach((value,i) => {
        const column = columnsByFile.get(entry.file)[i] ?? String(i);
        if (isTagField(column)) tags.push(...tagValues(value));
        else if (i > 0 && value !== '' && value != null) content.push(contentHash([entry.file,column,value]));
      });
    }
    const snapshot = { title: page.title, tags: [...new Set(tags)].sort(), content,
      details: contentHash({ properties, icon: page.icon, slug: page.slug, cover: page.cover }) };
    const old=previous.pages[page.id];
    // Older revisions lack the detail needed to label historical edits precisely.
    const notes = old?.hash === hash ? old.notes ?? ['Page Updated']
      : old?.snapshot ? describeChanges(old.snapshot, snapshot)
      : !old && previous.version ? ['Page Created'] : ['Page Updated'];
    const sourceDate=Number(page.lastEditedTime)||Number(page.createdTime)||0;
    // On the first run, use known source dates; undated local pages use file dates.
    const initial=previous.version ? Math.max(now,sourceDate) : sourceDate || (await fs.stat(file)).mtimeMs;
    const updatedAt=old ? (old.hash===hash ? old.updatedAt : Math.max(now,sourceDate)) : initial;
    state.pages[page.id]={hash,updatedAt,snapshot,notes};
    updates.push({id:page.id,title:page.title??summary.title,slug:summary.slug,date:new Date(updatedAt).toISOString(),notes});
  }
  updates.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  await writeChanged(path.join(dataDir,'page-revisions.json'),state);
  await writeChanged(path.join(dataDir,'home-updates.json'),updates.slice(0,4));
  return updates.slice(0,4);
}
