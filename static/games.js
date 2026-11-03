// Games tab: every game played in the Play tab, kept for good. A game is saved from your first
// move (see logLiveGame in app.js), so one you abandon or close stays here as "Unfinished".
// Picking a row shows the game on the main board; the arrow keys step through it.
import { P, today, addDays, storageFailed } from './profile.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RESULT = { win: ['Won', 'w'], loss: ['Lost', 'l'], draw: ['Draw', 'd'], unfinished: ['Unfinished', 'u'] };
const PAGE = 60;

const F = { result: 'all', color: 'all', q: '', limit: PAGE };   // filters last for this visit only

function dayLabel(day) {
  if (day === today()) return 'Today';
  if (day === addDays(today(), -1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${String(y) === today().slice(0, 4) ? '' : `, ${y}`}`;
}
const timeOf = (g) => (g.at ? new Date(g.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const fullMoves = (g) => Math.ceil((g.moves || 0) / 2);

function matches(g, q) {
  if (!q) return true;
  const hay = `${g.opening?.name || ''} ${g.opening?.eco || ''} ${g.oppLabel || ''} ${g.date} ${dayLabel(g.date)} ${RESULT[g.result]?.[0] || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

// One PGN file for all of them, with the headers other chess tools expect.
export function gamesToPgn(games) {
  const TOKEN = { win: { w: '1-0', b: '0-1' }, loss: { w: '0-1', b: '1-0' }, draw: { w: '1/2-1/2', b: '1/2-1/2' } };
  return games.map((g) => {
    const res = TOKEN[g.result]?.[g.color] || '*';
    const opp = `Stockfish (${g.oppLabel || g.elo})`;
    const moves = g.pgn.replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '').trim();
    return [`[Event "Chess Coach game"]`, `[Date "${g.date.replace(/-/g, '.')}"]`,
      `[White "${g.color === 'w' ? 'You' : opp}"]`, `[Black "${g.color === 'b' ? 'You' : opp}"]`, `[Result "${res}"]`, '', `${moves} ${res}`].join('\n');
  }).join('\n\n') + '\n';
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** api: { selected(): id, onSelect(game), onContinue(game), onAnalyze(game), onReview(game), onCopy(game), openingOf(pgn) } */
export function renderGames(el, api) {
  const all = P.data.games;
  for (const g of all) g.opening ??= api.openingOf(g.pgn);   // games saved before names were stored
  const pick = () => all.filter((g) => (F.color === 'all' || g.color === F.color) && matches(g, F.q));
  const COUNTS = [['all', 'All'], ['win', 'Won'], ['loss', 'Lost'], ['draw', 'Drawn'], ['unfinished', 'Unfinished']];

  el.innerHTML = `
    <div class="gm-head"><b class="otitle">Your games</b><span class="muted small" id="gm-sum"></span></div>
    ${storageFailed() ? '<div class="banner bad small">This browser is not saving: its storage is full or blocked. Download your games now so they are not lost.</div>' : ''}
    <div class="gm-filters">
      <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none"/><path d="M16 16l4.5 4.5" fill="none"/></svg>
        <input id="gm-search" type="search" placeholder="Search opening, opponent or date" aria-label="Search your games" autocomplete="off" value="${esc(F.q)}"></label>
      <div class="seg" id="gm-color" role="radiogroup" aria-label="Your colour">
        ${[['all', 'Both'], ['w', 'White'], ['b', 'Black']].map(([v, t]) => `<button class="seg-btn${F.color === v ? ' active' : ''}" data-v="${v}" role="radio" aria-checked="${F.color === v}">${t}</button>`).join('')}
      </div>
      <div class="pills" id="gm-result" role="radiogroup" aria-label="Result"></div>
    </div>
    <div class="gm-list" id="gm-list"></div>
    <div class="gm-foot"><button id="gm-download"${all.length ? '' : ' disabled'}>Download all as PGN</button></div>`;

  const paint = () => {
    const base = pick();
    const shown = F.result === 'all' ? base : base.filter((g) => g.result === F.result);
    el.querySelector('#gm-sum').textContent = !all.length ? '' : shown.length === all.length
      ? `${all.length} game${all.length === 1 ? '' : 's'} saved` : `Showing ${shown.length} of ${all.length}`;
    el.querySelector('#gm-result').innerHTML = COUNTS.map(([id, label]) => {
      const n = id === 'all' ? base.length : base.filter((g) => g.result === id).length;
      return `<button class="pill${id === F.result ? ' active' : ''}" data-v="${id}" role="radio" aria-checked="${id === F.result}"${!n && id !== F.result && id !== 'all' ? ' disabled' : ''}>${label} <span class="count">${n}</span></button>`;
    }).join('');
    const list = el.querySelector('#gm-list'), scroll = list.scrollTop;
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${all.length ? 'No game matches these filters.' : 'No games yet. Play a game in the Play tab: it is saved here from your first move.'}</div>`;
      return;
    }
    let html = '', day = null;
    for (const g of shown.slice(0, F.limit)) {
      if (g.date !== day) { day = g.date; html += `<div class="gm-day eyebrow">${esc(dayLabel(day))}</div>`; }
      const [word, cls] = RESULT[g.result] || ['?', 'u'], on = g.id === api.selected();
      const bits = [`vs ${g.oppLabel || g.elo}`, `${fullMoves(g)} move${fullMoves(g) === 1 ? '' : 's'}`, g.acc == null ? '' : `${g.acc}% accuracy`, timeOf(g)].filter(Boolean);
      html += `<div class="gm-item${on ? ' active' : ''}"><button class="gm-row" data-id="${esc(g.id)}"${on ? ' aria-current="true"' : ''}>` +
        `<img src="pieces/${g.color}K.svg" alt="${g.color === 'w' ? 'White' : 'Black'}">` +
        `<span class="gm-main"><b>${esc(g.opening?.name || 'Unnamed opening')}</b><span class="muted small">${esc(bits.join(' · '))}</span></span>` +
        `<span class="gm-res ${cls}">${word}${g.resigned ? ' (resigned)' : ''}</span></button>` +
        (on ? `<div class="gm-actions">${g.result === 'unfinished' ? '<button data-act="continue" class="primary">Continue</button>' : ''}<button data-act="analyze"${g.result === 'unfinished' ? '' : ' class="primary"'}>Analyze</button><button data-act="review">Review with the coach</button><button data-act="copy">Copy PGN</button></div>` : '') + '</div>';
    }
    if (shown.length > F.limit) html += `<button class="gm-more" id="gm-more">Show ${Math.min(PAGE, shown.length - F.limit)} more of ${shown.length - F.limit}</button>`;
    list.innerHTML = html;
    list.scrollTop = scroll;
  };
  paint();

  const search = el.querySelector('#gm-search');
  search.addEventListener('input', () => { F.q = search.value; F.limit = PAGE; paint(); });
  el.querySelector('#gm-color').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    F.color = b.dataset.v; F.limit = PAGE;
    el.querySelectorAll('#gm-color [data-v]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on)); });
    paint();
  });
  el.querySelector('#gm-result').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) { F.result = b.dataset.v; F.limit = PAGE; paint(); }
  });
  el.querySelector('#gm-list').addEventListener('click', (e) => {
    if (e.target.closest('#gm-more')) { F.limit += PAGE; return paint(); }
    const row = e.target.closest('.gm-row');
    if (row) { api.onSelect(all.find((g) => g.id === row.dataset.id)); return paint(); }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const g = all.find((x) => x.id === api.selected());
    if (g) ({ continue: api.onContinue, analyze: api.onAnalyze, review: api.onReview, copy: api.onCopy })[act.dataset.act](g);
  });
  el.querySelector('#gm-download').addEventListener('click', () => download(gamesToPgn(all), `chess-coach-games-${today()}.pgn`));
}
