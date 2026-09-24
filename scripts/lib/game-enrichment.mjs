import { createHash } from 'node:crypto';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function applyGameEnrichment(page, entry) {
  if (!entry) return;
  const revision = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  if (page.gameEnrichmentRevision === revision) return;
  page.gameDetails = {
    creator: entry.creator, publisher: entry.publisher ?? '', releaseDate: entry.date ?? '',
    origin: entry.origin ?? '', sources: entry.sources, imageCredit: entry.imageCredit,
    imageAlt: entry.imageAlt, researchedAt: entry.researchedAt,
  };
  page.cover = entry.image;
  page.previewImage = entry.image;
  page.properties ??= {};
  for (const [key,value] of Object.entries({'Creator(s)':entry.creator,Publisher:entry.publisher,'First Release':entry.date,Origin:entry.origin})) {
    if (value) page.properties[key] = [[value]];
  }
  const existing = (page.blocks ?? []).filter(block => !String(block.id).startsWith('game-description-'));
  page.blocks = [
    ...entry.description.map((paragraph,index) => ({id:`game-description-${page.id}-${index}`,type:'paragraph',html:escape(paragraph)})),
    ...existing,
  ];
  page.gameEnrichmentRevision = revision;
}
