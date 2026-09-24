import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {applyGameEnrichment} from '../scripts/lib/game-enrichment.mjs';
const read = async name => JSON.parse(await fs.readFile(new URL(`../data/${name}`,import.meta.url)));
test('all 51 game pages have sourced descriptions, facts, and matching readable cover assets', async () => {
  const database = await read('games-database.json');
  const {entries} = await read('game-enrichment.json');
  assert.equal(database.rows.length,51);
  for (const [i,meta] of database.rowMeta.entries()) {
    const page = await read(`pages/${meta.pageId}.json`);
    const entry = entries[meta.pageId];
    assert.ok(entry, page.title);
    assert.equal(entry.title,page.title);
    const paragraphs = page.blocks.filter(b=>b.id.startsWith('game-description-'));
    assert.equal(paragraphs.length,entry.description.length);
    assert.ok(paragraphs.length>=1 && paragraphs.length<=2);
    assert.ok(entry.sources.length>0);
    for (const source of entry.sources) assert.equal(new URL(source.url).protocol,'https:');
    assert.ok(page.gameDetails.creator);
    assert.ok(page.gameDetails.releaseDate || page.gameDetails.origin);
    assert.equal(database.rows[i][database.columns.indexOf('Creator(s)')],page.gameDetails.creator);
    assert.equal(database.rows[i][database.columns.indexOf('Publisher')],page.gameDetails.publisher);
    assert.equal(meta.image,page.cover);
    assert.equal(page.cover,page.previewImage);
    const image = await sharp(new URL(`../${page.cover}`,import.meta.url).pathname).metadata();
    assert.equal(image.format,'webp');
    assert.ok(image.width>50 && image.height>50,page.title);
    assert.ok(entry.imageCredit.url);
    assert.notEqual(entry.imageCredit.license,'See image source',page.title);
  }
});
test('enrichment preserves existing material and later edits on unchanged rebuilds', () => {
  const page = {id:'example',blocks:[{id:'original',type:'paragraph',html:'Existing research'}]};
  const entry = {creator:'Creator',description:['New description'],image:'./cover.webp',sources:[]};
  applyGameEnrichment(page,entry);
  assert.ok(page.blocks.some(b=>b.id==='original'));
  page.blocks[0].html='User revision';
  applyGameEnrichment(page,entry);
  assert.equal(page.blocks[0].html,'User revision');
  assert.equal(page.blocks.length,2);
});
