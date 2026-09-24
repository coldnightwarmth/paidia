import { enableRecentUpdates } from './recent-updates.js';
import { enableRandomQuote, enableAsciiInteraction, enableExplorePixelation, enablePlaythingShuffle } from './home-effects.js?v=20260923-clickable-playthings';

const ASCII = `                                                           ....:-~--..
                                                      ..:.:....:::.:.. ...
                                                   .  . . . .... . .
                                                 ................:.. ... .
                                               . :.-:.::-:~:::::. .....::-:..
                                               ...... ..:.:......:.:.. ...
                                                      ....     .. .. . .
                                                      ....     ... ... .
                                                               .:. ... ..
                                          --:.>.             ..-:-~..: -::-
                 .:-~:.                 ~.     ::.                 :.. ......
                :.    ...              :.        -                 ... . ....
               ~.       .:             >:...+:=. +               ..... ......
               +..::::~:-:.             --.   :-:-.-.          -:~-~.: -:-::-.
               -:=::-   +~.              +     -:+: -:.        ....... :  ..
             .:+-...  ::.                 ::-:=-:  .  -:       ..... . .  ..
           :::  :--::.=.                     :*...:     -      ....... .
         ..       -~.                       ..=  =    ...-          .. :
        ..      .:..-                       ..~ ..    :. .:         .. .
       .:        : ...                      .:.-.    ..   ~         .. .
      .:   ..    .~::-                    :-..^..   -.    .:.       .. .
      -   ...~    -:::-.~:~.~.=:+-.-.*.>-::--:    ..-      -:       .. :
    .+    ...~.      .^.  ..~..:- :. = *-:..:..  -:~       ~:       .. .
    :.        .~.    .+.-.:.. . - .. : ......:......:..    -.        . .
     -.    ..~.~......~:..... ..:..... -.........-.  .: :.:..        . .
      -+~=.-:... ..:~.*.... . ...... .......~:-.       .=-=.      .. .   :
 ..   ~~::.:.       ..*:~.................::~.     :..:.=--.:. : :   .. .
......+~ -~.:.::::-..  ~.*                 --   -:~:      :~ :-:....... .  .:.
.:  -:            *.=                 ::.           ~.~  ::
.     ...    .    ......  :            .    .. ...........   ....   .  .  ..
.....    .   :         .. .           .        .        : ..  .    .   .
:        :  ..: . .             . ...  :.  .    :         .:
...`;

const categories = [
  ['Books', 'books', 'books'], ['Other Writing', 'writing', 'shortform-writing'],
  ['Video+Audio', 'video', 'audio-visual-content'], ['Videogames', 'videogames', 'games-549e6748?category=Videogames'],
  ['Tabletop', 'tabletop', 'games-549e6748?category=Tabletop'], ['Objects', 'object', 'artifacts'],
  ['Images', 'image', 'images'], ['Sports', 'sports', 'games-549e6748?category=Sports'],
  ['Other Media', 'media', 'other-media'], ['People', 'people', 'folks-292fe1df?list='],
  ['Quotes', 'quotes', 'quotes'], ['Groups', 'groups', 'folks-292fe1df?list=Groups'],
  ['Concepts', 'concepts', 'concept-wall'], ['Lists', 'list', 'lists-256bd3bc'],
];

const initialPlaythings = [
  'royal-game-of-ur-9ab160a0.png',
  'horned-beetle-f45a9af1.png',
  'digivice-b6cb0f01.png',
  'arcade-cabinet-3cfaff15.png',
  'sling-shot-f490f196.png',
  'cherries-112879ee.png',
];

let searchIndexPromise;
const normalizeSearchText = value => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

function loadHomeSearchIndex() {
  if (!searchIndexPromise) {
    searchIndexPromise = fetch('./data/home-search-index.json?v=20260923-full-site-search')
      .then(response => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      })
      .then(data => (data.records ?? []).map(record => ({
        ...record,
        searchTitle: normalizeSearchText(record.title),
        searchTags: (record.tags ?? []).map(normalizeSearchText),
        searchContent: normalizeSearchText(record.content),
      })))
      .catch(error => {
        searchIndexPromise = null;
        throw error;
      });
  }
  return searchIndexPromise;
}

function contentExcerpt(content, query) {
  const source = String(content ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const directIndex = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const matchIndex = directIndex >= 0 ? directIndex : 0;
  const start = Math.max(0, matchIndex - 72);
  const end = Math.min(source.length, matchIndex + query.length + 118);
  return `${start ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`;
}

function highlightSearchPhrase(value, query, escapeHtml) {
  const source = String(value ?? '');
  const needle = String(query ?? '').trim();
  if (!needle) return escapeHtml(source);
  const sourceLower = source.toLocaleLowerCase();
  const needleLower = needle.toLocaleLowerCase();
  let cursor = 0;
  let matchIndex = sourceLower.indexOf(needleLower);
  if (matchIndex < 0) return escapeHtml(source);
  let html = '';
  while (matchIndex >= 0) {
    html += escapeHtml(source.slice(cursor, matchIndex));
    html += `<strong class="home__search-match">${escapeHtml(source.slice(matchIndex, matchIndex + needle.length))}</strong>`;
    cursor = matchIndex + needle.length;
    matchIndex = sourceLower.indexOf(needleLower, cursor);
  }
  return html + escapeHtml(source.slice(cursor));
}

export function renderHome({ content, siteIndex, escapeHtml }) {
  const link = (label, slug, cls = '') => `<a class="${cls}" href="#/${slug}">${label}</a>`;
  content.innerHTML = `
    <div class="home">
      <img class="home__banner" src="./assets/home/monk-snowball-fight-banner.png?v=20260923-v2" alt="" aria-hidden="true">
      <section class="home__intro" aria-label="Welcome to Paidiasophia">
        <header class="home__brand">
          <button class="home__search-toggle" type="button" aria-label="Search the wiki"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg></button>
          <img src="./assets/favicon.png" alt="" width="48" height="48">
          <div><span class="home__name">paidiasophia.wiki</span><p>&gt;play research.</p></div>
        </header>
        <div class="home__art" role="img" aria-label="ASCII illustration of two people playing a board game"><pre aria-hidden="true"></pre></div>
        <h1 class="home__title">INQUIRY INTO PLAY+GAMES</h1>
        <blockquote class="home__quote"><div class="home__quote-text"><p>“God has intended men to enjoy themselves with many games. [Games]… bring them comfort and dispel their boredom.”</p></div><cite>~Alfonso X of Castile</cite></blockquote>
        <img class="home__blossoms" src="./assets/home/blossoms.webp" alt="" width="480" height="296">
        <aside class="home__panels">
          <section class="home__welcome"><h2>welcome!</h2><p>this here is an attempt toward a cartography of inquiry into the nature of Play &amp; Games and their social, technological, and metaphysical character. If you have found this place, i hope you’ve found its links well &amp; might find its contents helpful.</p><p>Look ‘round see this lil quietfound’d field of ours now bursting forth with flowers! now sheens majestic in His winds~</p><p class="home__harvest">&gt;It is thus our time of Harvest,<br>&amp; alchemy!</p></section>
          <section class="home__updates"><h2>recent updates</h2><div class="home__update-list" aria-live="polite">Loading updates…</div></section>
        </aside>
        <div class="home__trinkets">${initialPlaythings.map(name=>`<button class="home__trinket" type="button" aria-label="Spin and randomize this play thing"><img src="./assets/home/playthings/${name}" alt="" width="80" height="80"></button>`).join('')}</div>
      </section>
      <section class="home__explore" id="home-explore" aria-labelledby="explore-heading"><h2 id="explore-heading"><span>Explore</span></h2><div class="home__explore-body"><div class="home__grid">${categories.map(([label,icon,slug])=>link(`<img src="./assets/home/${icon}.png" alt="" width="80" height="80"><span>${label}</span>`,slug,'home__tile')).join('')}<button type="button" class="home__tile home__timeline"><img src="./assets/home/timeline.png" alt="" width="80" height="80"><span>Timeline</span></button></div><div class="home__clouds" aria-hidden="true"><img src="./assets/home/marioclouds.gif" alt="" width="500" height="229"></div></div></section>
      <footer class="home__footer"><span class="home__footer-motto">ite et ludite!</span><div class="home__footer-links"><a href="https://twitter.com/paidiasophia" target="_blank" rel="noreferrer"><img src="./assets/images/free-twitter-logo-icon-2429-thumb-075fe553cc64.webp" alt="" width="28" height="28">follow @paidiasophia</a><a href="https://tally.so/r/wb5Y9e" target="_blank" rel="noreferrer"><svg viewBox="0 0 30 22" aria-hidden="true"><path d="M1 1h28v20H1Z M1 1l14 12L29 1 M1 21l10-10 m8 0 10 10"/></svg>subscribe to e-mail list</a></div></footer>
      <dialog class="home__dialog" aria-label="Explore the wiki"><button class="home__dialog-close" aria-label="Close" type="button">×</button><div class="home__dialog-body"></div></dialog>
    </div>`;
  content.querySelector('pre').textContent = ASCII;
  const stopAscii = enableAsciiInteraction(content.querySelector('.home__art pre'));
  const stopQuote = enableRandomQuote(content.querySelector('.home__quote'));
  const stopExplorePixelation = enableExplorePixelation(content.querySelector('.home__grid'));
  const stopPlaythingShuffle = enablePlaythingShuffle(
    content.querySelector('.home__trinkets'),
    './data/home-playthings.json?v=20260923',
  );
  const dialog = content.querySelector('dialog');
  const dialogBody = dialog.querySelector('.home__dialog-body');
  let searchDialogCloseTimer = 0;
  const closeSearchDialog = () => {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    if (!dialog.classList.contains('home__dialog--search')) {
      dialog.close();
      return;
    }
    dialog.classList.add('is-closing');
    searchDialogCloseTimer = window.setTimeout(() => dialog.close(), 180);
  };
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) closeSearchDialog(); });
  dialog.addEventListener('cancel', event => {
    if (!dialog.classList.contains('home__dialog--search')) return;
    event.preventDefault();
    closeSearchDialog();
  });
  dialog.addEventListener('close', () => {
    window.clearTimeout(searchDialogCloseTimer);
    dialog.classList.remove('home__dialog--search', 'is-closing');
  });
  dialogBody.addEventListener('click', event => { if (event.target.closest('a')) closeSearchDialog(); });
  content.querySelector('.home__search-toggle').addEventListener('click', () => {
    dialog.classList.remove('is-closing');
    dialog.classList.add('home__dialog--search');
    dialogBody.innerHTML = '<div class="home__search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input id="home-search" type="search" aria-label="Search the wiki" placeholder="Find books, games, people, concepts…" autocomplete="off"></div><div class="home__search-results" aria-live="polite"></div>';
    const input = dialogBody.querySelector('input');
    const results = dialogBody.querySelector('.home__search-results');
    let searchTimer = 0;
    let searchRevision = 0;
    const renderGroup = (label, matches, detail, queryText) => {
      if (!matches.length) return '';
      const visible = matches.slice(0, 50);
      const overflow = matches.length - visible.length;
      return `<section class="home__search-group"><h3>${label}<span>${matches.length}</span></h3>${visible.map(record => `<a class="home__search-result" href="#/${record.slug}"><span class="home__search-result-title">${highlightSearchPhrase(record.title, queryText, escapeHtml)}</span>${detail(record)}</a>`).join('')}${overflow ? `<p class="home__search-more">+ ${overflow} more ${label.toLocaleLowerCase()} matches</p>` : ''}</section>`;
    };
    const runSearch = async () => {
      const revision = ++searchRevision;
      const rawQuery = input.value.trim();
      const query = normalizeSearchText(rawQuery);
      if (!query) {
        results.replaceChildren();
        return;
      }
      results.innerHTML = '<p>Searching titles, tags, and page contents…</p>';
      try {
        const records = await loadHomeSearchIndex();
        if (revision !== searchRevision || !results.isConnected) return;
        const groups = { title: [], tags: [], content: [] };
        for (const record of records) {
          if (record.searchTitle.includes(query)) groups.title.push(record);
          else if (record.searchTags.some(tag => tag.includes(query))) groups.tags.push(record);
          else if (record.searchContent.includes(query)) groups.content.push(record);
        }
        const sortMatches = (a, b, field) => {
          const aIndex = field(a).indexOf(query);
          const bIndex = field(b).indexOf(query);
          return aIndex - bIndex || a.title.localeCompare(b.title);
        };
        groups.title.sort((a, b) => sortMatches(a, b, record => record.searchTitle));
        groups.tags.sort((a, b) => sortMatches(a, b, record => record.searchTags.find(tag => tag.includes(query)) ?? ''));
        groups.content.sort((a, b) => sortMatches(a, b, record => record.searchContent));
        const html = [
          renderGroup('Title results', groups.title, () => '<small>Title match</small>', rawQuery),
          renderGroup('Tag results', groups.tags, record => `<small>${highlightSearchPhrase(record.tags.filter((_, index) => record.searchTags[index]?.includes(query)).map(tag => `#${tag}`).join(' · '), rawQuery, escapeHtml)}</small>`, rawQuery),
          renderGroup('Content results', groups.content, record => `<small>${highlightSearchPhrase(contentExcerpt(record.content, rawQuery), rawQuery, escapeHtml)}</small>`, rawQuery),
        ].join('');
        results.innerHTML = html || '<p>No matching pages.</p>';
      } catch {
        if (revision === searchRevision) results.innerHTML = '<p>The search index could not be loaded. Please try again.</p>';
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 120);
    });
    loadHomeSearchIndex().catch(() => {});
    dialog.showModal(); input.focus();
  });
  content.querySelector('.home__timeline').addEventListener('click', async () => {
    dialog.classList.remove('home__dialog--search');
    dialogBody.innerHTML = '<h2>Books through time</h2><p>Loading publication timeline…</p>'; dialog.showModal();
    try {
      const response = await fetch('./data/full-text-database-books.json');
      if (!response.ok) throw new Error('Timeline unavailable');
      const data = await response.json();
      const entries = data.rows.map((row,i)=>({title:row[0],year:row[3],meta:data.rowMeta[i]})).filter(r=>/^\d{1,4}$/.test(r.year)).sort((a,b)=>Number(a.year)-Number(b.year));
      if (!dialog.isConnected) return;
      dialogBody.innerHTML = `<h2>Books through time</h2><p>Explore the library by publication year.</p><ol class="home__chronology">${entries.map(r=>`<li><time>${escapeHtml(r.year)}</time>${link(escapeHtml(r.title),siteIndex.pages.find(p=>p.id===r.meta?.pageId)?.slug ?? 'books')}</li>`).join('')}</ol>`;
    } catch { dialogBody.innerHTML = '<h2>Books through time</h2><p>The timeline could not be loaded. Please try again.</p>'; }
  });
  const stopUpdates = enableRecentUpdates(content.querySelector('.home__update-list'), siteIndex);
  return () => {
    stopAscii();
    stopQuote();
    stopExplorePixelation();
    stopPlaythingShuffle();
    stopUpdates();
  };
}
