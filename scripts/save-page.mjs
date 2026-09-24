import fs from 'node:fs/promises';
import path from 'node:path';
import { refreshPageUpdates, contentHash } from './lib/page-updates.mjs';
const input=process.argv[2];
if(!input)throw new Error('Usage: npm run page:save -- path/to/page.json');
const dir=path.resolve(process.env.SITE_DATA_DIR??'data');
// Baseline before mutation makes new pages and changed pages receive a local timestamp.
await refreshPageUpdates(dir);
const page=JSON.parse(await fs.readFile(input,'utf8'));
if(!/^[a-zA-Z0-9-]+$/.test(page.id??'')||!page.title?.trim()||!page.slug?.trim()||!Array.isArray(page.blocks))throw new Error('Page requires a safe id, title, slug, and blocks array.');
const index=JSON.parse(await fs.readFile(path.join(dir,'site-index.json'),'utf8'));
if(index.pages.some(p=>p.slug===page.slug&&p.id!==page.id))throw new Error('Slug already belongs to another page.');
const file=path.join(dir,'pages',`${page.id}.json`);
let old;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!old||contentHash(page)!==contentHash(old))page.lastEditedTime=Date.now();else page.lastEditedTime=old.lastEditedTime;
page.createdTime=old?.createdTime??page.createdTime??Date.now();
await fs.writeFile(file,JSON.stringify(page,null,2)+'\n');
const summary={...(index.pages.find(p=>p.id===page.id)??{}),id:page.id,title:page.title,slug:page.slug,icon:page.icon??'',type:page.type??'page',parentPageId:page.parentPageId??index.rootPageId};
index.pages=index.pages.filter(p=>p.id!==page.id);index.pages.push(summary);
for(const name of ['site-index.json','site.json'])await fs.writeFile(path.join(dir,name),JSON.stringify(index,null,2)+'\n');
await refreshPageUpdates(dir);
console.log(`Saved ${page.title}`);
