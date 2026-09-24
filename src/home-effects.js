const QUOTES_URL = './data/collections/9427dd13-de2f-4626-8176-6ac9df6b65c4.json';
let refreshQuote;

// Keep a single selection while navigating the wiki; a document refresh draws again.
function quoteForThisRefresh() {
  if (!refreshQuote) {
    refreshQuote = fetch(QUOTES_URL, { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error('Quotes unavailable');
      const collection = await response.json();
      const quotes = collection.rows.filter(row => row.title?.trim());
      if (!quotes.length) throw new Error('No quotes available');
      let previousId;
      try { previousId = sessionStorage.getItem('paidiasophia:home-quote'); } catch {}
      const choices = quotes.length > 1 ? quotes.filter(row => row.id !== previousId) : quotes;
      const quote = choices[Math.floor(Math.random() * choices.length)];
      try { sessionStorage.setItem('paidiasophia:home-quote', quote.id); } catch {}
      const property = name => Object.values(collection.schema ?? {}).find(p => p.name?.toLowerCase() === name)?.id;
      const plain = value => (value ?? []).map(part => part[0] ?? '').join('').replace(/^\s*[~—]+\s*/, '').trim();
      return {
        id: quote.id,
        text: quote.title.trim(),
        author: plain(quote.properties?.[property('by')]),
        source: plain(quote.properties?.[property('from')]),
      };
    }).catch(() => null);
  }
  return refreshQuote;
}

export function enableRandomQuote(element) {
  const paragraph = element.querySelector('p');
  const textViewport = element.querySelector('.home__quote-text') ?? paragraph.parentElement;
  const citation = element.querySelector('cite');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const TOP_PAUSE = 5000;
  const END_PAUSE = 5000;
  const DOWN_SPEED = 12;
  const UP_SPEED = 20;
  let disposed = false;
  let frame = 0;
  let phase = 'idle';
  let phaseStarted = 0;
  let overflowSignature = '';
  textViewport.classList.add('is-initializing');

  const finishInitialFade = () => {
    requestAnimationFrame(() => {
      if (!disposed) textViewport.classList.remove('is-initializing');
    });
  };

  const stopScroll = (reset = true) => {
    cancelAnimationFrame(frame);
    frame = 0;
    phase = 'idle';
    textViewport.classList.remove('is-scrolling');
    if (reset) paragraph.scrollTop = 0;
  };

  const beginPhase = (nextPhase, time) => {
    phase = nextPhase;
    phaseStarted = time;
    textViewport.classList.toggle('is-scrolling', nextPhase !== 'top-pause');
  };

  const animateScroll = time => {
    frame = 0;
    if (disposed || !element.isConnected || motion.matches || document.hidden) return;
    const distance = Math.max(0, paragraph.scrollHeight - paragraph.clientHeight);
    if (distance <= 1) {
      stopScroll();
      return;
    }

    const elapsed = time - phaseStarted;
    if (phase === 'top-pause') {
      paragraph.scrollTop = 0;
      if (elapsed >= TOP_PAUSE) beginPhase('down', time);
    } else if (phase === 'down') {
      const duration = Math.max(2500, distance / DOWN_SPEED * 1000);
      paragraph.scrollTop = distance * Math.min(1, elapsed / duration);
      if (elapsed >= duration) {
        paragraph.scrollTop = distance;
        beginPhase('end-pause', time);
      }
    } else if (phase === 'end-pause') {
      paragraph.scrollTop = distance;
      if (elapsed >= END_PAUSE) beginPhase('up', time);
    } else if (phase === 'up') {
      const duration = Math.max(1400, distance / UP_SPEED * 1000);
      paragraph.scrollTop = distance * (1 - Math.min(1, elapsed / duration));
      if (elapsed >= duration) {
        paragraph.scrollTop = 0;
        beginPhase('top-pause', time);
      }
    }
    frame = requestAnimationFrame(animateScroll);
  };

  const restartScroll = () => {
    stopScroll();
    if (disposed || motion.matches || document.hidden) return;
    if (paragraph.scrollHeight <= paragraph.clientHeight + 1) return;
    beginPhase('top-pause', performance.now());
    frame = requestAnimationFrame(animateScroll);
  };

  const updateFade = () => {
    const paragraphOverflows = paragraph.scrollHeight > paragraph.clientHeight + 1;
    textViewport.classList.toggle('is-overflowing', paragraphOverflows);
    citation.classList.toggle('is-overflowing', citation.scrollWidth > citation.clientWidth + 1);
    const nextSignature = `${paragraph.clientHeight}:${paragraph.scrollHeight}:${paragraphOverflows}:${motion.matches}`;
    if (nextSignature !== overflowSignature) {
      overflowSignature = nextSignature;
      restartScroll();
    }
  };
  const observer = new ResizeObserver(updateFade);
  observer.observe(paragraph);
  observer.observe(citation);
  motion.addEventListener('change', updateFade, { signal: events.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopScroll();
    else {
      overflowSignature = '';
      updateFade();
    }
  }, { signal: events.signal });
  quoteForThisRefresh().then(quote => {
    if (disposed || !element.isConnected) return;
    if (!quote) {
      finishInitialFade();
      return;
    }
    element.dataset.quoteId = quote.id;
    paragraph.textContent = quote.text;
    citation.textContent = quote.author ? `~${quote.author}` : quote.source;
    citation.hidden = !citation.textContent;
    // The full text remains accessible even when its visible tail fades away.
    element.title = [quote.text, quote.author, quote.source].filter(Boolean).join('\n\n');
    updateFade();
    finishInitialFade();
  });
  updateFade();
  return () => {
    disposed = true;
    stopScroll();
    events.abort();
    observer.disconnect();
  };
}

export function enableAsciiInteraction(pre) {
  const original = pre.textContent;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const glyphs = '.:~-+=*><^';
  const cells = [];
  const fragment = document.createDocumentFragment();
  let row = 0;
  let column = 0;
  // Spaces stay untouched so the illustration doesn't turn into a solid block.
  for (const character of original) {
    if (/\s/.test(character)) {
      fragment.append(character);
    } else {
      const cell = document.createElement('span');
      cell.className = 'home__ascii-cell';
      cell.textContent = character;
      fragment.append(cell);
      cells.push({
        cell,
        original: character,
        row,
        column,
        inside: false,
        nextChange: 0,
        settleUntil: 0,
        settleDuration: 0,
      });
    }
    if (character === '\n') { row++; column = 0; } else column++;
  }
  pre.replaceChildren(fragment);
  const events = new AbortController();
  let pointer = null;
  let frame = 0;
  let charWidth = 0;
  let lineHeight = 0;
  let disposed = false;
  const radius = 62;

  const randomGlyph = () => glyphs[Math.floor(Math.random() * glyphs.length)];

  function animate(time) {
    frame = 0;
    if (disposed || !pre.isConnected) return;
    let unsettled = false;
    for (const cell of cells) {
      const distance = pointer ? Math.hypot(
        (cell.column + .5) * charWidth - pointer.x,
        (cell.row + .5) * lineHeight - pointer.y,
      ) : Infinity;
      const inside = distance <= radius;

      if (inside) {
        if (!cell.inside) {
          cell.settleDuration = 1200 + Math.random() * 600;
          cell.nextChange = 0;
        }
        cell.inside = true;
        cell.settleUntil = time + cell.settleDuration;
        if (time >= cell.nextChange) {
          cell.cell.textContent = randomGlyph();
          cell.nextChange = time + 65 + Math.random() * 75;
        }
        unsettled = true;
        continue;
      }

      cell.inside = false;
      if (time >= cell.settleUntil) continue;
      const remaining = Math.max(0, (cell.settleUntil - time) / cell.settleDuration);
      if (time >= cell.nextChange) {
        cell.cell.textContent = randomGlyph();
        // Changes become increasingly infrequent until the cell rests on its last glyph.
        cell.nextChange = time + 110 + (1 - remaining) * 520 + Math.random() * 90;
      }
      unsettled = true;
    }
    if (unsettled) frame = requestAnimationFrame(animate);
  }
  function start() { if (!frame) frame = requestAnimationFrame(animate); }
  function leave() { pointer = null; start(); }
  pre.addEventListener('pointermove', event => {
    if (motion.matches || event.pointerType === 'touch') return;
    const bounds = pre.getBoundingClientRect();
    charWidth = cells[0]?.cell.getBoundingClientRect().width ?? 0;
    lineHeight = parseFloat(getComputedStyle(pre).lineHeight);
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    start();
  }, { signal: events.signal });
  pre.addEventListener('pointerleave', leave, { signal: events.signal });
  pre.addEventListener('pointercancel', leave, { signal: events.signal });
  window.addEventListener('blur', leave, { signal: events.signal });
  window.addEventListener('scroll', leave, { signal: events.signal, passive: true });
  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    pointer = null;
    cancelAnimationFrame(frame); frame = 0;
    for (const cell of cells) {
      cell.inside = false;
      cell.settleUntil = 0;
      cell.cell.textContent = cell.original;
    }
  }, { signal: events.signal });
  return () => {
    disposed = true;
    events.abort();
    cancelAnimationFrame(frame);
    pre.textContent = original;
  };
}

export function enableExplorePixelation(grid) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const tiles = [...grid.querySelectorAll('.home__tile')].map(tile => {
    const image = tile.querySelector('img');
    const canvas = document.createElement('canvas');
    const sample = document.createElement('canvas');
    canvas.className = 'home__tile-pixels';
    canvas.setAttribute('aria-hidden', 'true');
    tile.append(canvas);
    return { tile, image, canvas, sample, amount: 0, target: 0 };
  }).filter(item => item.image);
  let activeTile = null;
  let frame = 0;
  let previousTime = 0;
  let disposed = false;

  const syncCanvas = item => {
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, item.image.offsetWidth);
    const height = Math.max(1, item.image.offsetHeight);
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    item.canvas.style.left = `${item.image.offsetLeft}px`;
    item.canvas.style.top = `${item.image.offsetTop}px`;
    item.canvas.style.width = `${width}px`;
    item.canvas.style.height = `${height}px`;
    if (item.canvas.width !== pixelWidth) item.canvas.width = pixelWidth;
    if (item.canvas.height !== pixelHeight) item.canvas.height = pixelHeight;
    return { width: pixelWidth, height: pixelHeight, scale };
  };

  const draw = item => {
    if (item.amount <= .002 || !item.image.complete || !item.image.naturalWidth) {
      item.canvas.style.opacity = '0';
      item.image.style.opacity = '1';
      return;
    }
    const { width, height, scale } = syncCanvas(item);
    const eased = item.amount * item.amount * (3 - 2 * item.amount);
    const blockSize = 1 + eased * 7 * scale;
    const sampleWidth = Math.max(1, Math.round(width / blockSize));
    const sampleHeight = Math.max(1, Math.round(height / blockSize));
    if (item.sample.width !== sampleWidth) item.sample.width = sampleWidth;
    if (item.sample.height !== sampleHeight) item.sample.height = sampleHeight;

    const sampleContext = item.sample.getContext('2d');
    const context = item.canvas.getContext('2d');
    sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.drawImage(item.image, 0, 0, sampleWidth, sampleHeight);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(item.sample, 0, 0, sampleWidth, sampleHeight, 0, 0, width, height);
    const pixelMix = Math.min(1, eased * 1.7);
    item.canvas.style.opacity = String(pixelMix);
    item.image.style.opacity = String(1 - pixelMix);
  };

  const animate = time => {
    frame = 0;
    if (disposed || motion.matches || !grid.isConnected) return;
    const elapsed = previousTime ? Math.min(50, time - previousTime) : 16;
    previousTime = time;
    const blend = 1 - Math.exp(-elapsed / 115);
    let moving = false;
    for (const item of tiles) {
      item.amount += (item.target - item.amount) * blend;
      if (Math.abs(item.target - item.amount) < .004) item.amount = item.target;
      else moving = true;
      draw(item);
    }
    if (moving) frame = requestAnimationFrame(animate);
    else previousTime = 0;
  };

  const start = () => {
    if (!frame && !motion.matches) frame = requestAnimationFrame(animate);
  };

  const setActiveTile = tile => {
    if (tile === activeTile) return;
    activeTile = tile;
    for (const item of tiles) item.target = tile && item.tile !== tile ? 1 : 0;
    start();
  };

  grid.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    setActiveTile(event.target.closest('.home__tile'));
  }, { signal: events.signal });
  grid.addEventListener('pointerleave', () => setActiveTile(null), { signal: events.signal });
  grid.addEventListener('focusin', event => setActiveTile(event.target.closest('.home__tile')), {
    signal: events.signal,
  });
  grid.addEventListener('focusout', event => {
    if (!grid.contains(event.relatedTarget)) setActiveTile(null);
  }, { signal: events.signal });
  for (const item of tiles) {
    item.image.addEventListener('load', () => {
      syncCanvas(item);
      draw(item);
    }, { signal: events.signal });
  }
  const observer = new ResizeObserver(() => {
    for (const item of tiles) syncCanvas(item);
    start();
  });
  observer.observe(grid);
  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    cancelAnimationFrame(frame);
    frame = 0;
    activeTile = null;
    for (const item of tiles) {
      item.amount = 0;
      item.target = 0;
      item.canvas.style.opacity = '0';
      item.image.style.opacity = '1';
    }
  }, { signal: events.signal });

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    events.abort();
    for (const item of tiles) {
      item.image.style.opacity = '';
      item.canvas.remove();
    }
  };
}

export function enablePlaythingShuffle(container, manifestUrl) {
  const images = [...container.querySelectorAll('img')];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const activeAnimations = new Map();
  let icons = [];
  let interval = 0;
  let disposed = false;

  const resolvedSource = source => new URL(source, document.baseURI).href;

  const swapIcon = async (image, icon) => {
    image.dataset.nextPlaything = resolvedSource(icon.src);
    const preload = new Image();
    preload.src = icon.src;
    try {
      await preload.decode();
    } catch {
      delete image.dataset.nextPlaything;
      return;
    }
    if (disposed || !image.isConnected) return;
    if (motion.matches) {
      image.src = icon.src;
      image.dataset.playthingTitle = icon.title;
      delete image.dataset.nextPlaything;
      return;
    }

    const animation = image.animate([
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(-270deg)', offset: .75 },
      { transform: 'rotateY(-360deg)' },
    ], {
      duration: 1200,
      easing: 'linear',
    });
    const changeTimer = window.setTimeout(() => {
      image.src = icon.src;
      image.dataset.playthingTitle = icon.title;
    }, 900);
    activeAnimations.set(image, { animation, changeTimer });
    try {
      await animation.finished;
    } catch {}
    window.clearTimeout(changeTimer);
    activeAnimations.delete(image);
    delete image.dataset.nextPlaything;
  };

  const randomizeImage = image => {
    if (disposed || icons.length === 0 || activeAnimations.has(image) || image.dataset.nextPlaything) return;
    const visibleSources = new Set(images.flatMap(item => [
      resolvedSource(item.src),
      item.dataset.nextPlaything,
    ]).filter(Boolean));
    const choices = icons.filter(icon => !visibleSources.has(resolvedSource(icon.src)));
    if (!choices.length) return;
    void swapIcon(image, choices[Math.floor(Math.random() * choices.length)]);
  };

  const tick = () => {
    if (disposed || icons.length === 0 || Math.random() >= .4) return;
    const availableImages = images.filter(image => !activeAnimations.has(image) && !image.dataset.nextPlaything);
    if (!availableImages.length) return;
    randomizeImage(availableImages[Math.floor(Math.random() * availableImages.length)]);
  };

  container.addEventListener('click', event => {
    const button = event.target.closest('.home__trinket');
    if (!button || !container.contains(button)) return;
    randomizeImage(button.querySelector('img'));
  }, { signal: events.signal });

  fetch(manifestUrl, { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error('Play-thing icons unavailable');
      return response.json();
    })
    .then(manifest => {
      if (disposed) return;
      icons = manifest.icons ?? [];
      interval = window.setInterval(tick, 2000);
    })
    .catch(() => {});

  return () => {
    disposed = true;
    events.abort();
    window.clearInterval(interval);
    for (const [image, { animation, changeTimer }] of activeAnimations) {
      window.clearTimeout(changeTimer);
      animation.cancel();
      delete image.dataset.nextPlaything;
    }
    activeAnimations.clear();
  };
}
