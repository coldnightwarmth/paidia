import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshPageUpdates } from '../scripts/lib/page-updates.mjs';

test('recent pages follow content and row changes, additions and deletions without changing on rebuild', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-updates-'));
  const write = (name, value) => fs.writeFile(path.join(dir,name), JSON.stringify(value));
  try {
    await fs.mkdir(path.join(dir,'pages'));
    const pages = Array.from({length:6}, (_,i) => ({id:`p${i}`,slug:`page-${i}`,title:`Page ${i}`,blocks:[],lastEditedTime:1000+i}));
    await write('site-index.json',{pages});
    for (const page of pages) await write(`pages/${page.id}.json`,page);
    assert.deepEqual((await refreshPageUpdates(dir,2000)).map(p=>p.id),['p5','p4','p3','p2']);
    pages[0].blocks.push({text:'Edited'});
    await write('pages/p0.json',pages[0]);
    assert.equal((await refreshPageUpdates(dir,3000))[0].id,'p0');
    assert.equal((await refreshPageUpdates(dir,4000))[0].date,new Date(3000).toISOString());
    pages[0].lastEditedTime=4500;
    await write('pages/p0.json',pages[0]);
    assert.equal((await refreshPageUpdates(dir,5000))[0].date,new Date(3000).toISOString());
    await write('games-database.json',{rows:[['Page 1','Sports']],rowMeta:[{pageId:'p1'}]});
    assert.equal((await refreshPageUpdates(dir,6000))[0].id,'p1');
    const added = {id:'new',slug:'new',title:'New',blocks:[],lastEditedTime:1};
    pages.push(added);
    await write('site-index.json',{pages});
    await write('pages/new.json',added);
    assert.equal((await refreshPageUpdates(dir,7000))[0].date,new Date(7000).toISOString());
    await fs.unlink(path.join(dir,'pages/new.json'));
    assert.equal((await refreshPageUpdates(dir,8000))[0].id,'p1');
    await fs.mkdir(path.join(dir,'collections'));
    pages[2].blocks=[{collectionId:'quotes'}];
    await write('pages/p2.json',pages[2]);
    await write('collections/quotes.json',{rows:['quote']});
    await refreshPageUpdates(dir,9000);
    await write('collections/quotes.json',{rows:['changed quote']});
    assert.equal((await refreshPageUpdates(dir,10000))[0].id,'p2');
    assert.equal((await refreshPageUpdates(dir,11000))[0].date,new Date(10000).toISOString());
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('save command registers new pages, preserves no-op dates, and rejects duplicate routes', async () => {
  const {spawnSync} = await import('node:child_process');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-save-'));
  try {
    await fs.mkdir(path.join(dir,'pages'));
    await fs.writeFile(path.join(dir,'site-index.json'),JSON.stringify({pages:[],rootPageId:'root'}));
    const input = path.join(dir,'draft.json');
    const page = {id:'new',slug:'new-page',title:'New page',blocks:[]};
    await fs.writeFile(input,JSON.stringify(page));
    const save = () => spawnSync(process.execPath,['scripts/save-page.mjs',input],{encoding:'utf8',env:{...process.env,SITE_DATA_DIR:dir}});
    assert.equal(save().status,0);
    const first = JSON.parse(await fs.readFile(path.join(dir,'home-updates.json')));
    assert.equal(first[0].slug,'new-page');
    assert.equal(save().status,0);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'home-updates.json'))),first);
    await fs.writeFile(input,JSON.stringify({...page,id:'duplicate'}));
    assert.notEqual(save().status,0);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'site-index.json'))).pages.length,1);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('browser-local edits track only changed item rows', async () => {
  const values = new Map();
  globalThis.localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  globalThis.window={dispatchEvent:()=>{}};
  try {
    const {recordRowUpdates}=await import('../src/recent-updates.js');
    recordRowUpdates([['A'],['B']],[['A'],['B edited']],[{pageId:'a'},{pageId:'b'}]);
    const updates=JSON.parse([...values.values()][0]);
    assert.deepEqual(Object.keys(updates),['b']);
    assert.equal(updates.b.title,'B edited');
    recordRowUpdates([['A'],['B edited']],[['A'],['B edited']],[{pageId:'a'},{pageId:'b'}]);
    assert.deepEqual(JSON.parse([...values.values()][0]),updates);
  } finally {delete globalThis.localStorage;delete globalThis.window;}
});

test('change notes distinguish additions, edits, tags, titles, and combined changes', async () => {
  const {describeChanges,rowSnapshot} = await import('../src/update-notes.js');
  const before = {title:'A',tags:['Play'],content:['first'],details:''};
  assert.deepEqual(describeChanges(null,before),['Page Created']);
  assert.deepEqual(describeChanges(before,{...before,content:['first','second']}),['Content Added']);
  assert.deepEqual(describeChanges(before,{...before,content:['replacement']}),['Content Modified']);
  assert.deepEqual(describeChanges(before,{...before,tags:['Games','Play']}),['Tags Added']);
  assert.deepEqual(describeChanges(before,{...before,tags:[]}),['Tags Edited']);
  assert.deepEqual(describeChanges(before,{...before,title:'B',tags:['Games']}),['Title Edited','Tags Edited']);
  const columns=['Name','Category','Tags','Description'];
  assert.deepEqual(describeChanges(rowSnapshot(['A','Sports','Play','Text'],columns),rowSnapshot(['A','Sports','Play, Games','Text'],columns)),['Tags Added']);
});
