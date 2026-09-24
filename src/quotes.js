const DICE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/></g></svg>';
const BOOKMARK_KEY = 'paidiasophia:quote-bookmarks:v1';
const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>';
const VIEW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

export function renderQuoteLibrary(collection, escapeHtml) {
  const root = document.createElement('section');
  root.className = 'quote-library';
  const property = name => Object.values(collection.schema).find(p => p.name.toLowerCase() === name)?.id;
  const plain = value => (value ?? []).map(part => part[0] ?? '').join('').replace(/^\s*[~—]+\s*/, '').trim();
  const rows = collection.rows.filter(row => row.title?.trim()).map(row => ({
    id: row.id, text: row.title.trim(), author: plain(row.properties?.[property('by')]), source: plain(row.properties?.[property('from')]),
  }));
  let bookmarks;
  try { bookmarks = new Set(JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]')); } catch { bookmarks = new Set(); }
  let active = null, bookmarkedOnly = false, page = 0, timer = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  root.innerHTML = `<div class="quote-library__controls">
    <button class="quote-library__saved" aria-label="Show bookmarked quotes" aria-pressed="false">${BOOKMARK}</button>
    <label>Sort <select class="quote-library__sort"><option value="text">Quote A–Z</option><option value="author">Speaker A–Z</option></select></label>
    <label>Speaker <select class="quote-library__speaker"><option value="">All speakers</option>${[...new Set(rows.map(r => r.author).filter(Boolean))].sort().map(author => `<option>${escapeHtml(author)}</option>`).join('')}</select></label>
    <button class="quote-library__random" aria-label="Open a random quote">${DICE}</button>
    <input type="search" class="quote-library__search" placeholder="Search quotes" aria-label="Search quotes">
  </div><section class="quote-viewer" aria-label="Quote viewer" hidden>
    <button class="quote-viewer__close" aria-label="Close quote viewer">×</button>
    <button class="quote-viewer__random" aria-label="Show a random different quote">${DICE}</button>
    <div class="quote-viewer__content" aria-live="polite"></div>
  </section><div class="quote-library__results" aria-live="polite"></div><div class="quote-library__grid"></div>
  <nav class="quote-library__pagination" aria-label="Quote pages"><button class="quote-library__prev" aria-label="Previous page">←</button><span></span><button class="quote-library__next" aria-label="Next page">→</button></nav>`;
  const get = selector => root.querySelector(selector);
  const viewer = get('.quote-viewer'), display = get('.quote-viewer__content'), grid = get('.quote-library__grid');
  const updateActive = () => {
    grid.querySelectorAll('[data-view]').forEach(button => {
      const selected = button.dataset.view === active;
      button.setAttribute('aria-pressed', String(selected));
      button.closest('article').classList.toggle('is-active', selected);
    });
  };
  const setActive = row => {
    if (active === row.id) return;
    const wasActive = Boolean(active);
    active = row.id;
    get('.quote-library__random').disabled = true;
    clearTimeout(timer);
    viewer.hidden = false;
    requestAnimationFrame(() => { if (active) root.classList.add('has-active-quote'); });
    display.classList.add('is-fading');
    const show = () => {
      const quote = document.createElement('blockquote');
      quote.setAttribute('aria-label', row.text);
      let index = 0;
      let wordIndex = 0;
      const tailStart = Math.max(0, row.text.trim().split(/\s+/).length - 4);
      const tail = document.createElement('span');
      tail.className = 'quote-viewer__tail';
      for (const word of row.text.trim().split(/(\s+)/)) {
        if (/^\s+$/.test(word)) {
          (wordIndex > tailStart ? tail : quote).append(document.createTextNode(word));
          continue;
        }
        if (wordIndex === tailStart) quote.append(tail);
        const target = wordIndex++ >= tailStart ? tail : quote;
        const group = document.createElement('span');
        group.className = 'quote-viewer__word';
        group.setAttribute('aria-hidden', 'true');
        for (const char of word) {
          const glyph = document.createElement('span');
          glyph.textContent = char;
          glyph.style.animationDelay = `${-index++ * .075}s`;
          group.append(glyph);
        }
        target.append(group);
      }
      display.style.setProperty('--quote-size', row.text.length > 700 ? '1.45rem' : row.text.length > 350 ? '1.9rem' : '2.8rem');
      const author = document.createElement('cite');
      author.textContent = row.author ? `— ${row.author}` : row.source;
      display.replaceChildren(quote, author);
      display.classList.remove('is-fading');
    };
    timer = setTimeout(show, wasActive && !motion.matches ? 350 : 0);
    updateActive();
  };
  const randomQuote = () => {
    const choices = rows.filter(row => row.id !== active);
    if (choices.length) setActive(choices[Math.floor(Math.random() * choices.length)]);
  };
  get('.quote-viewer__random').onclick = randomQuote;
  get('.quote-library__random').onclick = randomQuote;
  get('.quote-viewer__close').onclick = () => {
    get('.quote-library__random').disabled = false;
    clearTimeout(timer); active = null; root.classList.remove('has-active-quote');
    display.classList.add('is-fading'); updateActive();
    timer = setTimeout(() => { viewer.hidden = true; display.replaceChildren(); }, motion.matches ? 0 : 450);
  };
  function render() {
    const query = get('.quote-library__search').value.toLowerCase().trim();
    const speaker = get('.quote-library__speaker').value;
    const sort = get('.quote-library__sort').value;
    const filtered = rows.filter(row => (!bookmarkedOnly || bookmarks.has(row.id)) && (!speaker || row.author === speaker) && `${row.text} ${row.author} ${row.source}`.toLowerCase().includes(query))
      .sort((a,b) => (sort === 'author' ? a.author.localeCompare(b.author) : 0) || a.text.localeCompare(b.text));
    const pages = Math.max(1, Math.ceil(filtered.length / 24));
    page = Math.min(page, pages - 1);
    get('.quote-library__results').textContent = `${filtered.length} ${filtered.length === 1 ? 'quote' : 'quotes'}`;
    grid.innerHTML = filtered.slice(page * 24, (page + 1) * 24).map(row => `<article class="quote-library__card">
      <blockquote>${escapeHtml(row.text)}</blockquote><footer>${row.author ? `<strong>— ${escapeHtml(row.author)}</strong>` : ''}${row.source ? `<cite>${escapeHtml(row.source)}</cite>` : ''}</footer>
      <div class="quote-library__actions"><button data-bookmark="${row.id}" aria-label="Bookmark quote" aria-pressed="${bookmarks.has(row.id)}">${BOOKMARK}</button><button data-view="${row.id}" aria-label="Show quote in viewer" aria-pressed="false">${VIEW}</button></div></article>`).join('') || '<p>No quotes match your filters.</p>';
    get('.quote-library__pagination span').textContent = `${page + 1} / ${pages}`;
    get('.quote-library__prev').disabled = page === 0;
    get('.quote-library__next').disabled = page >= pages - 1;
    updateActive();
  }
  grid.onclick = event => {
    const bookmark = event.target.closest('[data-bookmark]');
    if (bookmark) {
      const id = bookmark.dataset.bookmark;
      if (bookmarks.has(id)) bookmarks.delete(id); else bookmarks.add(id);
      try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...bookmarks])); } catch {}
      if (bookmarkedOnly) render(); else bookmark.setAttribute('aria-pressed', String(bookmarks.has(id)));
    }
    const view = event.target.closest('[data-view]');
    if (view) setActive(rows.find(row => row.id === view.dataset.view));
  };
  for (const selector of ['.quote-library__search', '.quote-library__speaker', '.quote-library__sort']) get(selector).addEventListener('input', () => { page = 0; render(); });
  get('.quote-library__saved').onclick = event => { bookmarkedOnly = !bookmarkedOnly; event.currentTarget.setAttribute('aria-pressed', String(bookmarkedOnly)); page = 0; render(); };
  get('.quote-library__prev').onclick = () => { page--; render(); };
  get('.quote-library__next').onclick = () => { page++; render(); };
  render();
  return { element: root, dispose: () => { active = null; clearTimeout(timer); } };
}
