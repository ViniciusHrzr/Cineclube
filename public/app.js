'use strict';

/* ── api helper ──────────────────────────────────────────────────────── */

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const body = await res.json(); if (body.error) msg = body.error; } catch (e) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

function fmt(n) { return Number(n).toFixed(1).replace('.', ','); }
function initialsOf(name) {
  const p = name.trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── state ───────────────────────────────────────────────────────────── */

const state = {
  tab: 'rate',
  reviewers: [],
  reviews: [],
  watchlist: [],
  criteriaByGenre: {},
  genres: [],
  reviewerId: null,
  movie: null,
  scores: {},
  comment: '',
  saving: false,
  justSaved: false,
  reviewsView: 'reviewer',
  openId: null,
  booted: false,
  bootError: null,
  catalog: { sort: 'popular', genreFilter: 'Todos', cache: {}, loading: false, error: null },
  search: { query: '', results: [], loading: false, note: '' }
};

function critsFor(genre) { return state.criteriaByGenre[genre] || state.criteriaByGenre['Drama'] || []; }
function finalOf(genre, scores) {
  const cs = critsFor(genre);
  let sum = 0;
  cs.forEach(c => { sum += (scores[c.key] ?? 0) * c.w; });
  return sum / 12;
}
function verdictFor(final) {
  const verdicts = [[9, 'Obra excepcional do gênero.'], [8, 'Muito acima da média.'], [6.5, 'Bom filme, com ressalvas.'], [5, 'Irregular — funciona pela metade.'], [0, 'Não se sustenta.']];
  return (verdicts.find(v => final >= v[0]) || verdicts[4])[1];
}
function averagesByMovie() {
  const avg = {};
  state.reviews.forEach(r => { (avg[r.movieId] = avg[r.movieId] || []).push(r.final); });
  const out = {};
  for (const id in avg) out[id] = { avg: avg[id].reduce((s, v) => s + v, 0) / avg[id].length, count: avg[id].length };
  return out;
}
function isInWatchlist(id) { return state.watchlist.some(w => String(w.id) === String(id)); }

function render() {
  const y = window.scrollY;
  renderTabs();
  renderMain();
  window.scrollTo(0, y);
}

/* ── boot ────────────────────────────────────────────────────────────── */

async function boot() {
  document.getElementById('main').innerHTML = `<div class="empty-state">Carregando…</div>`;
  try {
    const [reviewersRes, reviewsRes, criteriaRes, watchlistRes] = await Promise.all([
      api('/api/reviewers'),
      api('/api/reviews'),
      api('/api/catalog/criteria-all'),
      api('/api/watchlist')
    ]);
    state.reviewers = reviewersRes.reviewers;
    state.reviews = reviewsRes.reviews;
    state.criteriaByGenre = criteriaRes.criteria;
    state.genres = criteriaRes.genres;
    state.watchlist = watchlistRes.watchlist;
    state.reviewerId = state.reviewers[0] ? state.reviewers[0].id : null;
    state.booted = true;
    render();
  } catch (e) {
    state.bootError = e.message;
    renderBootError();
  }
}

function renderBootError() {
  document.getElementById('tabs').innerHTML = '';
  document.getElementById('main').innerHTML = `
    <section>
      <h1 class="view-title">Não foi possível carregar o Cineclube</h1>
      <p class="view-sub">${esc(state.bootError)}. Confira se o servidor (\`node server.js\`) está rodando e recarregue a página.</p>
      <button type="button" class="btn btn-primary" id="retry-boot">Tentar de novo</button>
    </section>`;
  document.getElementById('retry-boot').addEventListener('click', () => { state.bootError = null; boot(); });
}

/* ── tabs ────────────────────────────────────────────────────────────── */

const TAB_DEFS = [
  ['rate', 'Avaliar', 'ph ph-sliders-horizontal'],
  ['catalog', 'Catálogo', 'ph ph-film-strip'],
  ['watchlist', 'Quero ver', 'ph ph-bookmark-simple'],
  ['reviews', 'Avaliados', 'ph ph-star'],
  ['people', 'Avaliadores', 'ph ph-users-three']
];

function renderTabs() {
  const el = document.getElementById('tabs');
  el.innerHTML = TAB_DEFS.map(([id, label, icon]) =>
    `<button type="button" class="tab-btn${state.tab === id ? ' active' : ''}" data-tab="${id}"><i class="${icon}"></i>${label}</button>`
  ).join('');
  el.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); });
  });
}

function renderMain() {
  const main = document.getElementById('main');
  if (state.tab === 'rate') { main.innerHTML = rateHTML(); attachRateListeners(); }
  else if (state.tab === 'catalog') { main.innerHTML = catalogHTML(); attachCatalogListeners(); ensureCatalogLoaded(); }
  else if (state.tab === 'watchlist') { main.innerHTML = watchlistHTML(); attachWatchlistListeners(); }
  else if (state.tab === 'reviews') { main.innerHTML = reviewsHTML(); attachReviewsListeners(); }
  else if (state.tab === 'people') { main.innerHTML = peopleHTML(); attachPeopleListeners(); }
}

/* ── rate tab ────────────────────────────────────────────────────────── */

function rateHTML() {
  const m = state.movie;
  return `
    <section>
      <h1 class="view-title">Avaliar filme</h1>
      <p class="view-sub">Oito critérios técnicos com peso ×1 e dois critérios do gênero com peso ×2. A nota final é sempre calculada sobre 12 pesos.</p>
      <div class="rate-grid">
        <div class="rate-col">
          <div class="panel">
            <div class="panel-kicker">1 · Avaliador</div>
            <div class="chip-row" id="reviewer-chips">${reviewerChipsHTML()}</div>
          </div>
          <div class="panel" id="movie-panel">${moviePanelHTML(m)}</div>
          ${m ? criteriaPanelHTML(m) : ''}
          ${m ? commentPanelHTML() : ''}
        </div>
        <aside class="sidebar">
          <div class="score-panel" id="score-panel">${scorePanelHTML(m)}</div>
          <div class="sidebar-note">Os dois critérios de gênero mudam conforme o filme escolhido — em terror são Atmosfera e Terror; os pesos ×2 permanecem.</div>
        </aside>
      </div>
    </section>`;
}

function reviewerChipsHTML() {
  if (!state.reviewers.length) {
    return `<span class="empty-state" style="padding:0">Nenhum avaliador ainda —</span> <button type="button" class="chip-add" data-goto-people>cadastrar</button>`;
  }
  return state.reviewers.map(p => {
    const on = state.reviewerId === p.id;
    return `<button type="button" class="chip${on ? ' active' : ''}" data-reviewer="${p.id}">
      <span class="chip-avatar" style="background:${p.dot}">${esc(initialsOf(p.name))}</span>${esc(p.name)}
    </button>`;
  }).join('') + `<button type="button" class="chip-add" data-goto-people>+ novo</button>`;
}

function moviePanelHTML(m) {
  if (m) {
    const hasExtra = m.overview || (m.cast && m.cast.length) || m.trailerUrl;
    return `
      <div class="panel-kicker">2 · Filme</div>
      <div class="movie-current">
        ${m.poster ? `<img class="poster" src="${esc(m.poster)}" style="width:62px;height:92px;object-fit:cover" alt="">` : `<div class="poster" style="width:62px;height:92px"></div>`}
        <div style="min-width:0">
          <div class="movie-title">${esc(m.title)}</div>
          <div class="movie-meta">${m.year || '—'}${m.director ? ' · dir. ' + esc(m.director) : ''}</div>
          <div class="movie-tagrow">
            <span class="genre-tag">${esc(m.genre)}</span>
            <button type="button" class="link-btn" data-clear-movie>trocar</button>
          </div>
        </div>
      </div>
      ${hasExtra ? `<div class="movie-extra">
        ${m.overview ? `<p class="movie-overview">${esc(m.overview)}</p>` : ''}
        ${m.cast && m.cast.length ? `<div class="movie-cast">Elenco: ${m.cast.map(c => esc(c.name)).join(', ')}</div>` : ''}
        ${m.trailerUrl ? `<a class="trailer-link" href="${esc(m.trailerUrl)}" target="_blank" rel="noopener noreferrer"><i class="ph ph-play-circle"></i>Assistir trailer</a>` : ''}
      </div>` : ''}`;
  }
  return `
    <div class="panel-kicker">2 · Filme</div>
    <div class="search-box">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" id="search-input" placeholder="Buscar no TMDB…" autocomplete="off" value="${esc(state.search.query)}">
    </div>
    <div class="search-results" id="search-results">${searchResultsHTML()}</div>
    <div class="search-note" id="search-note">${esc(state.search.note)}</div>`;
}

function attachMoviePanelListeners() {
  const clearBtn = document.querySelector('[data-clear-movie]');
  if (clearBtn) clearBtn.addEventListener('click', () => { state.movie = null; state.scores = {}; state.comment = ''; render(); });
}

function searchResultsHTML() {
  if (state.search.loading) return `<div class="empty-state">Buscando…</div>`;
  if (!state.search.results.length) return `<div class="empty-state">Nenhum filme encontrado.</div>`;
  return state.search.results.map(x => `
    <button type="button" class="search-result" data-pick="${x.id}">
      ${x.poster ? `<img class="poster" src="${esc(x.poster)}" style="width:30px;height:44px;object-fit:cover" alt="">` : `<span class="poster" style="width:30px;height:44px;display:block"></span>`}
      <span class="search-result-info">
        <span class="search-result-title">${esc(x.title)}</span>
        <span class="search-result-meta">${x.year || '—'}</span>
      </span>
      <span class="search-result-genre">${esc(x.genre)}</span>
    </button>`).join('');
}

async function runSearch(query) {
  state.search.query = query;
  state.search.loading = true;
  document.getElementById('search-results').innerHTML = searchResultsHTML();
  try {
    const data = query.trim()
      ? await api('/api/catalog/search?q=' + encodeURIComponent(query.trim()))
      : await api('/api/catalog/popular');
    state.search.results = data.results.slice(0, 8);
    state.search.note = query.trim() ? data.results.length + ' resultado(s)' : 'mostrando populares';
  } catch (e) {
    state.search.results = [];
    state.search.note = 'Erro ao buscar: ' + e.message;
  }
  state.search.loading = false;
  const resultsEl = document.getElementById('search-results');
  const noteEl = document.getElementById('search-note');
  if (resultsEl) { resultsEl.innerHTML = searchResultsHTML(); attachSearchResultListeners(); }
  if (noteEl) noteEl.textContent = state.search.note;
}
const debouncedSearch = debounce(runSearch, 350);

function criteriaPanelHTML(m) {
  const cs = critsFor(m.genre);
  return `
    <div class="panel criteria-panel">
      <div class="criteria-head">
        <div class="panel-kicker" style="margin-bottom:0">3 · Notas</div>
        <div class="criteria-note">0–10 · passo 0,5</div>
      </div>
      <div id="criteria-list">${cs.map(c => criteriaRowHTML(c)).join('')}</div>
    </div>`;
}
function criteriaRowHTML(c) {
  const v = state.scores[c.key] ?? 5;
  return `
    <div class="crit-row" data-crit-row="${c.key}">
      <div class="crit-name-row">
        <span class="crit-name">${esc(c.name)}</span>
        <span class="crit-weight ${c.w === 2 ? 'w2' : 'w1'}">×${c.w}</span>
      </div>
      <div class="crit-value${v >= 8 ? ' hi' : ''}" id="val-${c.key}">${fmt(v)}</div>
      <input type="range" class="crit-range" min="0" max="10" step="0.5" value="${v}" data-crit="${c.key}">
      <div class="crit-hint">${esc(c.hint)}</div>
    </div>`;
}

function commentPanelHTML() {
  return `
    <div class="panel">
      <div class="panel-kicker">4 · Comentário (opcional)</div>
      <textarea class="input" id="comment-input" rows="3" placeholder="O que achou desse filme?">${esc(state.comment || '')}</textarea>
    </div>`;
}

function saveLabelFor(m) {
  if (state.saving) return 'Salvando…';
  if (state.justSaved) return 'Salvo';
  const existing = m && state.reviews.find(r => r.reviewerId === state.reviewerId && r.movieId === m.id);
  return existing ? 'Atualizar avaliação' : 'Salvar avaliação';
}

function scorePanelHTML(m) {
  const cs = m ? critsFor(m.genre) : [];
  const final = m ? finalOf(m.genre, state.scores) : 0;
  const sumW = m ? cs.reduce((a, c) => a + (state.scores[c.key] ?? 0) * c.w, 0) : 0;
  const verdict = m ? verdictFor(final) : 'Escolha um filme para começar.';
  const canSave = !!m && !!state.reviewerId && !state.saving;
  return `
    <div class="panel-kicker" style="margin-bottom:0">Nota final</div>
    <div class="score-value-row">
      <span class="score-value${final >= 8 ? ' hi' : ''}" id="final-score">${m ? fmt(final) : '—'}</span>
      <span class="score-max">/10</span>
    </div>
    <div class="score-bar"><div class="score-bar-fill" id="final-bar" style="width:${m ? (final / 10) * 100 : 0}%"></div></div>
    <div class="math-line" id="math-line">${m ? fmt(sumW) + ' pontos ÷ 12 pesos' : '8 critérios ×1 + 2 critérios ×2'}</div>
    <div class="verdict-line" id="verdict-line">${esc(verdict)}</div>
    <button type="button" class="btn btn-primary btn-full" id="save-btn" ${canSave ? '' : 'disabled'} style="${canSave ? '' : 'opacity:0.45'}">
      <i class="ph ph-check"></i><span id="save-label">${esc(saveLabelFor(m))}</span>
    </button>
    <button type="button" class="btn-reset" id="reset-btn">Zerar notas</button>`;
}

function attachRateListeners() {
  document.querySelectorAll('[data-reviewer]').forEach(el => {
    el.addEventListener('click', () => { state.reviewerId = el.dataset.reviewer; render(); });
  });
  document.querySelectorAll('[data-goto-people]').forEach(el => {
    el.addEventListener('click', () => { state.tab = 'people'; render(); });
  });

  attachMoviePanelListeners();

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    if (!state.search.results.length && !state.search.loading) runSearch('');
    searchInput.addEventListener('input', e => debouncedSearch(e.target.value));
    attachSearchResultListeners();
  }

  const criteriaList = document.getElementById('criteria-list');
  if (criteriaList) {
    criteriaList.addEventListener('input', e => {
      if (!e.target.matches('[data-crit]')) return;
      const key = e.target.dataset.crit;
      const v = parseFloat(e.target.value);
      state.scores[key] = v;
      state.justSaved = false;
      patchScoreUI(key, v);
    });
  }

  const commentInput = document.getElementById('comment-input');
  if (commentInput) commentInput.addEventListener('input', e => { state.comment = e.target.value; });

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveReview);
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (!state.movie) return;
    const o = {};
    critsFor(state.movie.genre).forEach(c => { o[c.key] = 5; });
    state.scores = o;
    render();
  });
}

function attachSearchResultListeners() {
  document.querySelectorAll('[data-pick]').forEach(el => {
    el.addEventListener('click', () => selectMovie(el.dataset.pick));
  });
}

async function selectMovie(tmdbId) {
  const panel = document.getElementById('movie-panel');
  if (panel) panel.innerHTML = `<div class="panel-kicker">2 · Filme</div><div class="empty-state">Carregando filme…</div>`;
  try {
    const movie = await api('/api/catalog/movie/' + tmdbId);
    const o = {};
    critsFor(movie.genre).forEach(c => { o[c.key] = 5; });
    state.movie = movie;
    state.scores = o;
    state.comment = '';
    state.justSaved = false;
    state.tab = 'rate';
    render();
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="panel-kicker">2 · Filme</div><div class="empty-state">Erro ao carregar filme: ${esc(e.message)}</div>`;
  }
}

function editReview(reviewId) {
  const r = state.reviews.find(x => x.id === reviewId);
  if (!r) return;
  state.reviewerId = r.reviewerId;
  state.movie = { id: r.movieId, title: r.movieTitle, year: r.movieYear, genre: r.movieGenre, poster: r.moviePoster, director: r.movieDirector, overview: null, cast: [], trailerUrl: null };
  state.scores = Object.assign({}, r.scores);
  state.comment = r.comment || '';
  state.justSaved = false;
  state.tab = 'rate';
  render();
  enrichMovieDetails(r.movieId);
}

async function enrichMovieDetails(id) {
  try {
    const full = await api('/api/catalog/movie/' + id);
    if (state.movie && String(state.movie.id) === String(id) && state.tab === 'rate') {
      state.movie = Object.assign({}, state.movie, { overview: full.overview, cast: full.cast, trailerUrl: full.trailerUrl, poster: full.poster, director: full.director });
      const panel = document.getElementById('movie-panel');
      if (panel) { panel.innerHTML = moviePanelHTML(state.movie); attachMoviePanelListeners(); }
    }
  } catch (e) { /* keep the snapshot silently if TMDB is unreachable */ }
}

function patchScoreUI(key, v) {
  const valEl = document.getElementById('val-' + key);
  if (valEl) { valEl.textContent = fmt(v); valEl.classList.toggle('hi', v >= 8); }

  const m = state.movie;
  if (!m) return;
  const cs = critsFor(m.genre);
  const final = finalOf(m.genre, state.scores);
  const sumW = cs.reduce((a, c) => a + (state.scores[c.key] ?? 0) * c.w, 0);

  const finalEl = document.getElementById('final-score');
  if (finalEl) { finalEl.textContent = fmt(final); finalEl.classList.toggle('hi', final >= 8); }
  const barEl = document.getElementById('final-bar');
  if (barEl) barEl.style.width = (final / 10) * 100 + '%';
  const mathEl = document.getElementById('math-line');
  if (mathEl) mathEl.textContent = fmt(sumW) + ' pontos ÷ 12 pesos';
  const verdictEl = document.getElementById('verdict-line');
  if (verdictEl) verdictEl.textContent = verdictFor(final);
  const saveLabel = document.getElementById('save-label');
  if (saveLabel && !state.saving) saveLabel.textContent = saveLabelFor(m);
}

async function saveReview() {
  const m = state.movie;
  if (!m || !state.reviewerId || state.saving) return;
  state.saving = true;
  render();
  try {
    const saved = await api('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: state.reviewerId, movie: m, scores: state.scores, comment: state.comment })
    });
    state.reviews = state.reviews.filter(r => !(r.reviewerId === saved.reviewerId && r.movieId === saved.movieId)).concat([saved]);
    state.watchlist = state.watchlist.filter(w => String(w.id) !== String(saved.movieId));
    state.saving = false;
    state.justSaved = true;
    state.tab = 'reviews';
    state.movie = null;
    state.scores = {};
    state.comment = '';
    render();
  } catch (e) {
    state.saving = false;
    alert('Não foi possível salvar a avaliação: ' + e.message);
    render();
  }
}

/* ── catalog tab ─────────────────────────────────────────────────────── */

function catalogKey() { return state.catalog.sort + '|' + state.catalog.genreFilter; }
function currentCatalogEntry() { return state.catalog.cache[catalogKey()] || { items: [], page: 0, totalPages: 1 }; }

function clubRanked() {
  const byMovie = {};
  state.reviews.forEach(r => {
    if (!byMovie[r.movieId]) byMovie[r.movieId] = { id: r.movieId, title: r.movieTitle, year: r.movieYear, genre: r.movieGenre, poster: r.moviePoster, scores: [] };
    byMovie[r.movieId].scores.push(r.final);
  });
  return Object.values(byMovie)
    .map(m => ({ id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster, avg: m.scores.reduce((s, v) => s + v, 0) / m.scores.length, count: m.scores.length }))
    .sort((a, b) => b.avg - a.avg);
}

function visibleCatalogItems() {
  if (state.catalog.sort === 'club') {
    return clubRanked().filter(x => state.catalog.genreFilter === 'Todos' || x.genre === state.catalog.genreFilter);
  }
  return currentCatalogEntry().items;
}

function catalogHTML() {
  const items = visibleCatalogItems();
  const genres = ['Todos'].concat(state.genres);
  const avgs = averagesByMovie();
  const loadingFirstPage = state.catalog.sort === 'popular' && state.catalog.loading && !items.length;
  const entry = state.catalog.sort === 'popular' ? currentCatalogEntry() : null;
  const countLabel = state.catalog.sort === 'club' ? items.length + ' filme(s) avaliados pelo clube' : items.length + ' filme(s) · fonte TMDB';
  return `
    <section>
      <h1 class="view-title">Catálogo</h1>
      <p class="view-sub">${loadingFirstPage ? 'Carregando…' : countLabel}</p>
      <div class="filter-row">
        <button type="button" class="filter-chip${state.catalog.sort === 'popular' ? ' active' : ''}" data-sort="popular">Populares</button>
        <button type="button" class="filter-chip${state.catalog.sort === 'club' ? ' active' : ''}" data-sort="club">Mais bem avaliados do clube</button>
      </div>
      <div class="filter-row" style="margin-bottom:var(--space-8)">
        ${genres.map(g => `<button type="button" class="filter-chip${state.catalog.genreFilter === g ? ' active' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>
      <div class="catalog-grid">${items.map(x => movieCardHTML(x, avgs)).join('')}</div>
      ${!items.length && !loadingFirstPage ? `<div class="empty-state">${state.catalog.sort === 'club' ? 'Nenhum filme avaliado pelo clube ainda.' : 'Nenhum filme encontrado.'}</div>` : ''}
      ${state.catalog.error ? `<div class="empty-state">${esc(state.catalog.error)}</div>` : ''}
      ${state.catalog.sort === 'popular' && entry && entry.page < entry.totalPages && !state.catalog.error ? `<button type="button" class="btn btn-secondary" id="load-more" style="margin-top:var(--space-6)" ${state.catalog.loading ? 'disabled' : ''}>${state.catalog.loading ? 'Carregando…' : 'Carregar mais'}</button>` : ''}
    </section>`;
}

function movieCardHTML(x, avgs) {
  const a = avgs[x.id];
  const avgLabel = a ? '★ ' + fmt(a.avg) + ' (' + a.count + ')' : 'sem avaliações';
  const inWatch = isInWatchlist(x.id);
  return `
    <article class="movie-card">
      <div class="movie-card-poster">${x.poster ? `<img src="${esc(x.poster)}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span>pôster · ${esc(x.title)}</span>`}</div>
      <div class="movie-card-body">
        <div class="movie-card-title">${esc(x.title)}</div>
        <div class="movie-card-meta">${x.year || '—'}</div>
        <div class="movie-card-tags">
          <span class="genre-tag">${esc(x.genre)}</span>
          <span class="movie-card-avg">${avgLabel}</span>
        </div>
        <div class="movie-card-actions">
          <button type="button" class="movie-card-btn" data-rate="${x.id}">Avaliar</button>
          <button type="button" class="icon-btn${inWatch ? ' is-active' : ''}" data-watch="${x.id}" aria-label="${inWatch ? 'Remover da lista Quero ver' : 'Adicionar à lista Quero ver'}"><i class="ph ph-bookmark-simple"></i></button>
        </div>
      </div>
    </article>`;
}

async function ensureCatalogLoaded() {
  if (state.catalog.sort === 'club') return;
  const key = catalogKey();
  if (state.catalog.cache[key] || state.catalog.loading) return;
  await loadCatalogPage();
}

async function loadCatalogPage() {
  const key = catalogKey();
  const entry = state.catalog.cache[key] || { items: [], page: 0, totalPages: 1 };
  state.catalog.loading = true;
  state.catalog.error = null;
  renderCatalogSoft();
  try {
    const nextPage = entry.page + 1;
    const data = state.catalog.genreFilter === 'Todos'
      ? await api('/api/catalog/popular?page=' + nextPage)
      : await api('/api/catalog/discover?genre=' + encodeURIComponent(state.catalog.genreFilter) + '&page=' + nextPage);
    state.catalog.cache[key] = { items: entry.items.concat(data.results), page: data.page, totalPages: data.totalPages };
  } catch (e) {
    state.catalog.error = 'Não foi possível carregar o catálogo: ' + e.message;
  }
  state.catalog.loading = false;
  renderCatalogSoft();
}

function renderCatalogSoft() {
  if (state.tab === 'catalog') { document.getElementById('main').innerHTML = catalogHTML(); attachCatalogListeners(); }
}

function attachCatalogListeners() {
  document.querySelectorAll('[data-genre]').forEach(el => {
    el.addEventListener('click', () => { state.catalog.genreFilter = el.dataset.genre; render(); });
  });
  document.querySelectorAll('[data-sort]').forEach(el => {
    el.addEventListener('click', () => { state.catalog.sort = el.dataset.sort; render(); });
  });
  document.querySelectorAll('[data-rate]').forEach(el => {
    el.addEventListener('click', () => { state.tab = 'rate'; selectMovie(el.dataset.rate); });
  });
  const items = visibleCatalogItems();
  const byId = new Map(items.map(x => [String(x.id), x]));
  document.querySelectorAll('[data-watch]').forEach(el => {
    el.addEventListener('click', () => {
      const movie = byId.get(el.dataset.watch);
      if (movie) toggleWatchlist({ id: movie.id, title: movie.title, year: movie.year, genre: movie.genre, poster: movie.poster });
    });
  });
  const loadMore = document.getElementById('load-more');
  if (loadMore) loadMore.addEventListener('click', loadCatalogPage);
}

async function toggleWatchlist(movieLite) {
  const inList = isInWatchlist(movieLite.id);
  try {
    if (inList) {
      await api('/api/watchlist/' + movieLite.id, { method: 'DELETE' });
      state.watchlist = state.watchlist.filter(w => String(w.id) !== String(movieLite.id));
    } else {
      await api('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ movie: movieLite }) });
      state.watchlist = state.watchlist.concat([{ id: movieLite.id, title: movieLite.title, year: movieLite.year, genre: movieLite.genre, poster: movieLite.poster, addedAt: new Date().toISOString() }]);
    }
    render();
  } catch (e) {
    alert('Não foi possível atualizar a lista: ' + e.message);
  }
}

/* ── watchlist tab ───────────────────────────────────────────────────── */

function watchlistHTML() {
  return `
    <section>
      <h1 class="view-title">Quero ver</h1>
      <p class="view-sub">${state.watchlist.length} filme(s) na lista</p>
      ${state.watchlist.length ? `<div class="catalog-grid">${state.watchlist.map(watchlistCardHTML).join('')}</div>` : `<div class="empty-state">Nada por aqui ainda — adicione filmes pelo Catálogo.</div>`}
    </section>`;
}

function watchlistCardHTML(x) {
  return `
    <article class="movie-card">
      <div class="movie-card-poster">${x.poster ? `<img src="${esc(x.poster)}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span>pôster · ${esc(x.title)}</span>`}</div>
      <div class="movie-card-body">
        <div class="movie-card-title">${esc(x.title)}</div>
        <div class="movie-card-meta">${x.year || '—'}</div>
        <div class="movie-card-tags"><span class="genre-tag">${esc(x.genre)}</span></div>
        <div class="movie-card-actions">
          <button type="button" class="movie-card-btn" data-rate="${x.id}">Avaliar</button>
          <button type="button" class="icon-btn" data-unwatch="${x.id}" aria-label="Remover da lista"><i class="ph ph-trash"></i></button>
        </div>
      </div>
    </article>`;
}

function attachWatchlistListeners() {
  document.querySelectorAll('[data-rate]').forEach(el => {
    el.addEventListener('click', () => { state.tab = 'rate'; selectMovie(el.dataset.rate); });
  });
  document.querySelectorAll('[data-unwatch]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.unwatch;
      try {
        await api('/api/watchlist/' + id, { method: 'DELETE' });
        state.watchlist = state.watchlist.filter(w => String(w.id) !== id);
        render();
      } catch (e) { alert('Não foi possível remover: ' + e.message); }
    });
  });
}

/* ── reviews tab ─────────────────────────────────────────────────────── */

function reviewsHTML() {
  return `
    <section>
      <h1 class="view-title">Avaliados</h1>
      <p class="view-sub">${state.reviews.length} avaliações de ${state.reviewers.length} avaliadores</p>
      <div class="filter-row">
        <button type="button" class="filter-chip${state.reviewsView === 'reviewer' ? ' active' : ''}" data-view="reviewer">Por avaliador</button>
        <button type="button" class="filter-chip${state.reviewsView === 'session' ? ' active' : ''}" data-view="session">Por sessão</button>
      </div>
      ${state.reviewsView === 'session' ? bySessionHTML() : byReviewerHTML()}
    </section>`;
}

function byReviewerHTML() {
  if (!state.reviewers.length) return `<div class="empty-state">Cadastre avaliadores na aba Avaliadores.</div>`;
  return state.reviewers.map(reviewerGroupHTML).join('');
}

function reviewerGroupHTML(p) {
  const items = state.reviews.filter(r => r.reviewerId === p.id).sort((a, b) => b.final - a.final);
  const mean = items.length ? items.reduce((s, r) => s + r.final, 0) / items.length : 0;
  const summary = items.length ? items.length + ' filmes · média ' + fmt(mean) : 'nenhuma avaliação ainda';
  return `
    <div class="reviewer-group">
      <div class="reviewer-group-head">
        <span class="avatar" style="background:${p.dot}">${esc(initialsOf(p.name))}</span>
        <span class="reviewer-group-name">${esc(p.name)}</span>
        <span class="reviewer-group-rule"></span>
        <span class="reviewer-group-summary">${summary}</span>
      </div>
      ${items.length ? items.map(r => reviewCardHTML(r)).join('') : `<div class="empty-state">Nenhuma avaliação ainda.</div>`}
    </div>`;
}

function reviewCardHTML(r) {
  const open = state.openId === r.id;
  return `
    <div class="review-card">
      <button type="button" class="review-card-head" data-toggle="${r.id}">
        ${r.moviePoster ? `<img class="poster" src="${esc(r.moviePoster)}" style="width:34px;height:50px;object-fit:cover" alt="">` : `<span class="poster" style="width:34px;height:50px;display:block"></span>`}
        <span class="review-card-info">
          <span class="review-card-title">${esc(r.movieTitle)}</span>
          <span class="review-card-meta">${r.movieYear || '—'} · ${esc(r.movieGenre)} · avaliado em ${r.date}</span>
        </span>
        <span class="review-card-score${r.final >= 8 ? ' hi' : ''}">${fmt(r.final)}</span>
        <i class="ph ph-caret-${open ? 'up' : 'down'}"></i>
      </button>
      <div class="review-breakdown" ${open ? '' : 'hidden'}>${breakdownHTML(r)}</div>
    </div>`;
}

function breakdownHTML(r) {
  return `
    <div class="breakdown-grid">
      ${r.breakdown.map(b => `
        <div class="breakdown-row">
          <span class="breakdown-name">${esc(b.name)}</span>
          <span class="breakdown-weight ${b.w === 2 ? 'w2' : 'w1'}">×${b.w}</span>
          <span class="breakdown-value">${fmt(b.value)}</span>
        </div>`).join('')}
    </div>
    ${r.comment ? `<p class="review-comment">"${esc(r.comment)}"</p>` : ''}
    <div class="review-actions">
      <button type="button" class="btn btn-ghost" data-edit="${r.id}"><i class="ph ph-pencil-simple"></i>Editar</button>
      <button type="button" class="icon-btn" data-delete="${r.id}" aria-label="Excluir avaliação"><i class="ph ph-trash"></i></button>
    </div>`;
}

function sessionGroups() {
  const map = {};
  state.reviews.forEach(r => {
    const key = r.movieId + '|' + r.date;
    if (!map[key]) map[key] = { movieId: r.movieId, date: r.date, movieTitle: r.movieTitle, movieYear: r.movieYear, movieGenre: r.movieGenre, moviePoster: r.moviePoster, items: [] };
    map[key].items.push(r);
  });
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date) || a.movieTitle.localeCompare(b.movieTitle));
}

function bySessionHTML() {
  const sessions = sessionGroups();
  if (!sessions.length) return `<div class="empty-state">Nenhuma sessão registrada ainda.</div>`;
  return sessions.map(sessionCardHTML).join('');
}

function sessionCardHTML(s) {
  const avg = s.items.reduce((sum, r) => sum + r.final, 0) / s.items.length;
  const items = s.items.slice().sort((a, b) => b.final - a.final);
  return `
    <div class="review-card session-card">
      <div class="session-head">
        ${s.moviePoster ? `<img class="poster" src="${esc(s.moviePoster)}" style="width:50px;height:74px;object-fit:cover" alt="">` : `<span class="poster" style="width:50px;height:74px;display:block"></span>`}
        <div class="session-info">
          <div class="review-card-title">${esc(s.movieTitle)}</div>
          <div class="review-card-meta">${s.movieYear || '—'} · ${esc(s.movieGenre)} · sessão em ${s.date} · ${s.items.length} avaliação(ões)</div>
        </div>
        <div class="review-card-score${avg >= 8 ? ' hi' : ''}">${fmt(avg)}</div>
      </div>
      <div class="session-attendees">
        ${items.map(r => sessionAttendeeHTML(r)).join('')}
      </div>
    </div>`;
}

function sessionAttendeeHTML(r) {
  const open = state.openId === r.id;
  return `
    <button type="button" class="session-attendee" data-toggle="${r.id}">
      <span class="avatar" style="background:${r.reviewerDot}">${esc(initialsOf(r.reviewerName))}</span>
      <span class="session-attendee-name">${esc(r.reviewerName)}</span>
      <span class="session-attendee-score${r.final >= 8 ? ' hi' : ''}">${fmt(r.final)}</span>
      <i class="ph ph-caret-${open ? 'up' : 'down'}"></i>
    </button>
    <div class="review-breakdown" ${open ? '' : 'hidden'}>${breakdownHTML(r)}</div>`;
}

function attachReviewsListeners() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => { state.reviewsView = el.dataset.view; render(); });
  });
  document.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => { const id = el.dataset.toggle; state.openId = state.openId === id ? null : id; render(); });
  });
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); editReview(el.dataset.edit); });
  });
  document.querySelectorAll('[data-delete]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); deleteReview(el.dataset.delete); });
  });
}

async function deleteReview(id) {
  if (!confirm('Excluir esta avaliação? Essa ação não pode ser desfeita.')) return;
  try {
    await api('/api/reviews/' + id, { method: 'DELETE' });
    state.reviews = state.reviews.filter(r => r.id !== id);
    render();
  } catch (e) {
    alert('Não foi possível excluir: ' + e.message);
  }
}

/* ── people tab ──────────────────────────────────────────────────────── */

function peopleHTML() {
  return `
    <section class="people-view">
      <h1 class="view-title">Avaliadores</h1>
      <p class="view-sub">Quem participa das sessões do clube.</p>
      <div class="panel" style="margin-bottom:var(--space-8)">
        <label style="display:block;font-size:13px;font-weight:500;color:rgba(233,233,237,0.6);margin-bottom:var(--space-2)">Nome</label>
        <div class="add-person-row">
          <input type="text" class="input" id="new-name-input" placeholder="ex: Marina" autocomplete="off">
          <button type="button" class="btn btn-primary" id="add-person-btn">Cadastrar</button>
        </div>
        <div class="empty-state" id="people-error" style="display:none;padding-top:var(--space-3)"></div>
      </div>
      ${state.reviewers.length ? state.reviewers.map(personRowHTML).join('') : `<div class="empty-state">Nenhum avaliador cadastrado.</div>`}
    </section>`;
}

function personRowHTML(p) {
  const n = state.reviews.filter(r => r.reviewerId === p.id).length;
  const stats = n ? n + (n === 1 ? ' filme avaliado' : ' filmes avaliados') : 'ainda não avaliou';
  return `
    <div class="person-row">
      <span class="avatar" style="background:${p.dot}">${esc(initialsOf(p.name))}</span>
      <span class="person-info">
        <span class="person-name">${esc(p.name)}</span>
        <span class="person-stats">${stats}</span>
      </span>
      <button type="button" class="icon-btn" data-remove="${p.id}" aria-label="Remover"><i class="ph ph-trash"></i></button>
    </div>`;
}

async function addPerson() {
  const input = document.getElementById('new-name-input');
  const errEl = document.getElementById('people-error');
  const n = (input.value || '').trim();
  if (!n) return;
  try {
    const reviewer = await api('/api/reviewers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n })
    });
    state.reviewers = state.reviewers.concat([reviewer]);
    if (!state.reviewerId) state.reviewerId = reviewer.id;
    render();
    const el = document.getElementById('new-name-input');
    if (el) el.focus();
  } catch (e) {
    if (errEl) { errEl.textContent = 'Erro ao cadastrar: ' + e.message; errEl.style.display = 'block'; }
  }
}

async function removePerson(id) {
  try {
    await api('/api/reviewers/' + id, { method: 'DELETE' });
    state.reviewers = state.reviewers.filter(p => p.id !== id);
    state.reviews = state.reviews.filter(r => r.reviewerId !== id);
    if (state.reviewerId === id) state.reviewerId = state.reviewers[0] ? state.reviewers[0].id : null;
    render();
  } catch (e) {
    alert('Não foi possível remover: ' + e.message);
  }
}

function attachPeopleListeners() {
  const addBtn = document.getElementById('add-person-btn');
  if (addBtn) addBtn.addEventListener('click', addPerson);
  const input = document.getElementById('new-name-input');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addPerson(); });

  document.querySelectorAll('[data-remove]').forEach(el => {
    el.addEventListener('click', () => removePerson(el.dataset.remove));
  });
}

/* ── boot ────────────────────────────────────────────────────────────── */

boot();
