import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read = async file => JSON.parse(await fs.readFile(new URL(`../data/${file}`, import.meta.url),'utf8'));
const index = await read('site-index.json');
const summaries = new Map(index.pages.map(p=>[p.id,p]));
for(const key of ['games','other-media','objects','images']) {
  test(`${key}: every row has a unique, correctly categorized item page`, async()=>{
    const database=await read(`${key}-database.json`);
    assert.equal(database.rows.length,database.rowMeta.length);
    assert.equal(new Set(database.rowMeta.map(r=>r.pageId)).size,database.rows.length);
    for(let i=0;i<database.rows.length;i++) {
      const row=database.rows[i],meta=database.rowMeta[i];
      const page=await read(`pages/${meta.pageId}.json`);
      assert.equal(page.title,row[0]);
      assert.equal(meta.href,`#/${summaries.get(page.id).slug}`);
      assert.equal(page.catalog.database,key);
      assert.equal(page.catalog.categories.join(', '),row[1]);
      assert.ok(page.catalog.categories.every(c=>page.catalog.tags.includes(c)));
      assert.equal(summaries.get(page.id).parentPageId,page.catalog.databaseId);
    }
  });
}
test('games retain every locally saved videogame, tabletop game, and sport',async()=>{
  const database=await read('games-database.json');
  const collection=await read('collections/a26e119e-af46-4ce4-bc67-a108ebc9f1a5.json');
  for(const page of collection.rows) assert.ok(database.rowMeta.some(r=>r.pageId===page.id));
  for(const [category,count] of [['Videogames',32],['Tabletop',5],['Sports',10],['Other Games & Toys',4]]) assert.equal(database.rows.filter(r=>r[1]===category).length,count);
});
test('other media excludes images and paintings and repairs missing media links',async()=>{
  const database=await read('other-media-database.json');
  assert.ok(database.rows.every(r=>!/^Images$|^Paintings$/.test(r[1])));
  for(const title of ['Alien','Lord of the Rings','Survivor','Sword Art Online']) {
    const row=database.rows.findIndex(r=>r[0]===title);assert.ok(row>=0);
    assert.equal((await read(`pages/${database.rowMeta[row].pageId}.json`)).title,title);
  }
});
test('objects and images begin empty',async()=>{
  for(const key of ['objects','images'])assert.equal((await read(`${key}-database.json`)).rows.length,0);
});
test('groups belong to People and each has an individual page',async()=>{
  const people=await read('folks-database.json');let count=0;
  for(let i=0;i<people.rows.length;i++)if(people.rows[i][1]==='Groups'){
    count++;const page=await read(`pages/${people.rowMeta[i].pageId}.json`);
    assert.equal(page.title,people.rows[i][0]);assert.equal(page.peopleCategory,'Groups');
    assert.equal(summaries.get(page.id).parentPageId,'292fe1df-a5bd-4b49-97aa-f336bf0ac103');
  }
  assert.ok(count>0);
});
