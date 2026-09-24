import { describeChanges, rowSnapshot } from './update-notes.js';
let publishedUpdates;
const STORAGE_KEY = 'paidiasophia-page-updates-v1';
function localUpdates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
export function recordRowUpdates(previous, rows, metadata, columns) {
  const updates = localUpdates();
  let changed = false;
  rows.forEach((row, index) => {
    const id = metadata?.[index]?.pageId;
    if (id && JSON.stringify(previous[index]) !== JSON.stringify(row)) {
      changed = true;
      updates[id] = { id, title: row[0], date: new Date().toISOString(), local: true, notes: describeChanges(previous[index] ? rowSnapshot(previous[index], columns) : null, rowSnapshot(row, columns)) };
    }
  });
  if (!changed) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
  window.dispatchEvent(new Event('page-updated'));
}
export function enableRecentUpdates(target, siteIndex) {
  let disposed = false;
  let pending = false;
  async function refresh() {
    if (pending || disposed) return;
    pending = true;
    try {
      publishedUpdates ??= fetch('./data/home-updates.json').then(response => {
        if (!response.ok) throw new Error('Updates unavailable');
        return response.json();
      }).catch(error => { publishedUpdates = undefined; throw error; });
      const published = await publishedUpdates;
      if (disposed) return;
      const merged = new Map();
      for (const update of [...published, ...Object.values(localUpdates())]) {
        const page = siteIndex.pages.find(page => page.id === update.id || page.slug === update.slug);
        if (!page || !Number.isFinite(Date.parse(update.date))) continue;
        const item = { ...update, slug: page.slug };
        if (!merged.has(page.id) || Date.parse(merged.get(page.id).date) < Date.parse(item.date)) merged.set(page.id, item);
      }
      target.replaceChildren(...[...merged.values()].sort((a,b) => Date.parse(b.date)-Date.parse(a.date)).slice(0,4).map(page => {
        const link = document.createElement('a');
        link.href = `#/${page.slug}`;
        link.title = page.title;
        const title = document.createElement('span');
        title.className = 'home__update-title';
        title.textContent = `↳${page.title}`;
        const time = document.createElement('time');
        time.dateTime = page.date;
        time.title = `${new Date(page.date).toLocaleString()}${page.local ? ' (edited in this browser)' : ''}`;
        time.textContent = new Date(page.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const description = document.createElement('div');
        description.className = 'home__update-description';
        const note = document.createElement('small');
        note.className = 'home__update-note';
        note.textContent = (page.notes ?? ['Page Updated']).join(' · ');
        description.append(title, note);
        link.append(description, time);
        return link;
      }));
    } catch {
      if (!disposed && !target.querySelector('a')) target.textContent = 'Updates are currently unavailable.';
    } finally { pending = false; }
  }
  const onStorage = event => { if (event.key === STORAGE_KEY || event.key === null) refresh(); };
  refresh();
  window.addEventListener('storage', onStorage);
  window.addEventListener('page-updated', refresh);
  return () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('page-updated', refresh);
  };
}
