// The Analyze tab's Game review panel: upload a PGN, wait for Stockfish, then walk the game with a
// coach bubble, an eval graph and a spoken voice. review.js decides the labels, review-words.js finds
// the words, profile.js remembers. Speech is the browser's own (Web Speech API), so it costs nothing,
// needs no server and also works on the hosted version.
import { Chess } from './vendor/chess.js';
import { P, save, today, addMistake, saveReview, getReview, reviewPatterns, findMoment } from './profile.js';
import { moveSound } from './sound.js';
import { parsePgnFile, gameFromPgn, analyseGame, classifyGame, summarise, trapIndex, findTraps, momentsOf, winWhite, moveNum, BAD, LABEL, themeWords } from './review.js';
import { commentFor, bookNotes, toSpeech, swapSides } from './review-words.js';
import { pvGain, worth } from './why.js';

export const MARK = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '≡', forced: '→', inaccuracy: '?!', mistake: '?', miss: '✕', blunder: '??' };
const KEY = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);
const GRAPH_DOTS = new Set(['brilliant', 'great', 'mistake', 'miss', 'blunder']);
const DECK = new Set(['miss', 'mistake', 'blunder']);
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const who = (h, side) => (h[side] && h[side] !== '?' ? h[side] : side);   // a game with no player names says White and Black

export function createReview({ S, $, esc, render, syncTools, runAnalysis, setView, drawArrows, updateEval, evalText, toast, api, switchTab, ecoReady, openings }) {
  let view = 'home', running = null, pending = null, notes = null, traps = null, lastKey = -1;
  const panel = () => $('#review');
  const settings = () => P.data.settings;
  const search = (fen, movetime, multipv) => api('/api/analyse', { fen, movetime, multipv });

  function show(v = view) {
    view = S.review ? 'review' : v;
    syncTools();
    $('#analyze-free').classList.toggle('hidden', !!S.review || view === 'running');
    if (view === 'review') renderReview();
    else if (view === 'running') renderRunning();
    else if (view === 'pick') renderPick();
    else renderHome();
  }

  // ------------------------------------------------------------- home + memory ---

  function renderHome(error = '') {
    const m = reviewPatterns();
    const reviews = P.data.reviews || [];
    const onBoard = S.game.history().length >= 2 && S.tab === 'analyze';
    panel().innerHTML = `
      <div class="olist-head"><span class="eyebrow">Game review</span><span class="muted small">Upload a game, hear the coach walk through it</span></div>
      <label class="rv-drop" id="rv-drop"><input type="file" id="rv-file" accept=".pgn,.txt,text/plain" multiple>
        <b>Choose a PGN file</b><span class="muted small">or drop one here. A whole archive works too.</span></label>
      <details class="rv-paste"><summary>Paste a game instead</summary>
        <textarea id="rv-text" rows="4" spellcheck="false" placeholder="Paste the game's PGN (Chess.com: Share, then PGN)"></textarea>
        <button id="rv-paste-go">Review it</button>
      </details>
      <div class="btnrow">
        <label class="group-by">Stockfish time <select id="rv-speed">
          <option value="fast">Fast</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
        ${onBoard ? '<button id="rv-board">Review the game on the board</button>' : ''}
      </div>
      ${error ? `<div class="banner bad">${esc(error)}</div>` : ''}
      ${memoryHtml(m, reviews)}`;
    $('#rv-speed').value = settings().reviewSpeed || 'standard';
    $('#rv-speed').onchange = (e) => { settings().reviewSpeed = e.target.value; save(); };
    $('#rv-file').onchange = (e) => readFiles(e.target.files);
    $('#rv-paste-go').onclick = () => { const t = $('#rv-text').value.trim(); if (t) takeText(t); };
    const drop = $('#rv-drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); };
    if (onBoard) $('#rv-board').onclick = () => (S.boardColor ? reviewGame(S.game.pgn(), S.boardColor) : takeText(S.game.pgn()));
    panel().querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openSaved(b.dataset.open, b.dataset.ply === undefined ? null : +b.dataset.ply); });
  }

  function memoryHtml(m, reviews) {
    if (!reviews.length) return '<p class="muted small rv-empty">Nothing remembered yet. Every game you review adds its mistakes, missed chances, traps and good plays here, and the mistakes go to your deck in Puzzles.</p>';
    const row = (x) => `<button class="rv-moment" data-open="${esc(x.id)}" data-ply="${x.ply}"><span class="rv-badge ${esc(x.cls)}">${esc(MARK[x.cls] || '')}</span><span class="grow">${esc(x.text)}</span><span class="muted small">${esc(x.date)}</span></button>`;
    const group = (title, list) => (list.length ? `<details class="rv-group"><summary>${esc(title)} <span class="muted small">${list.length}</span></summary>${list.slice(0, 25).map(row).join('')}</details>` : '');
    const weak = Object.entries(m.phases).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
    return `<div class="rv-memory">
      <div class="olist-head"><span class="eyebrow">What I remember</span><span class="muted small">${m.games} game${m.games === 1 ? '' : 's'}, ${m.acc ?? '–'}% average accuracy</span></div>
      ${m.themes.length ? `<ul class="rv-patterns">${m.themes.slice(0, 4).map(([t, n]) => `<li><b>${esc(themeWords(t))}</b> <span class="muted">${n} time${n === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : ''}
      ${weak ? `<p class="small rv-weak">Weakest phase so far: <b>${esc(weak[0])}</b> (${weak[1]}%).</p>` : ''}
      ${group('Mistakes and blunders', m.errors)}${group('Chances you missed', m.misses)}${group('Traps', m.traps)}${group('Misplays', m.slips)}${group('Good plays', m.good)}
      <details class="rv-group" ${reviews.length < 4 ? 'open' : ''}><summary>Reviewed games <span class="muted small">${reviews.length}</span></summary>
        ${reviews.slice(0, 30).map((r) => `<button class="rv-moment" data-open="${esc(r.id)}"><span class="grow">${esc(r.white)} vs ${esc(r.black)}${r.opening ? ` · ${esc(r.opening)}` : ''}</span><span class="muted small">${esc(r.acc ?? '–')}% · ${esc(r.date)}</span></button>`).join('')}
      </details>
    </div>`;
  }

  async function readFiles(files) {
    const texts = await Promise.all([...files].map((f) => f.text()));
    takeText(texts.join('\n\n'));
  }

  function takeText(text) {
    const { games, errors } = parsePgnFile(text);
    if (!games.length) { view = 'home'; return renderHome(errors[0] ? `Could not read that: ${errors[0]}` : 'No games found in that text.'); }
    const known = settings().reviewName;
    const named = (g, n) => [g.headers.White, g.headers.Black].some((x) => x && x.toLowerCase() === n.toLowerCase());
    let you = known && games.some((g) => named(g, known)) ? known : null;
    if (!you && games.length > 1) {   // an archive: the one player in every game is you. In a rematch series both are, so ask.
      const both = [games[0].headers.White, games[0].headers.Black].filter((n) => n && n !== '?' && games.every((g) => named(g, n)));
      if (both.length === 1) [you] = both;
    }
    if (you) { settings().reviewName = you; save(); }
    pending = { games, you, side: null, errors };
    if (games.length === 1 && you) return startGame(games[0], sideOf(games[0]), true);
    show('pick');
  }

  // Your colour in a game of this upload, or null when you aren't in it. No names in the file: the colour you picked.
  const sideOf = (g) => {
    if (pending.side) return pending.side;
    const n = pending.you?.toLowerCase();
    return !n ? null : g.headers.White?.toLowerCase() === n ? 'w' : g.headers.Black?.toLowerCase() === n ? 'b' : null;
  };
  const title = (g) => `${who(g.headers, 'White')} vs ${who(g.headers, 'Black')}${g.headers.Date && !g.headers.Date.startsWith('?') ? ` · ${g.headers.Date}` : ''}`;

  function renderPick() {
    const { games, you, side, errors } = pending;
    const g0 = games[0], chosen = you || side;
    const done = (g) => !!getReview(g.id);
    const fresh = games.filter((g) => !done(g) && sideOf(g));
    panel().innerHTML = `
      <div class="olist-head"><span class="eyebrow">Game review</span><button id="rv-back">Back</button></div>
      ${errors.length ? `<div class="muted small">${errors.length} game${errors.length === 1 ? '' : 's'} could not be read and ${errors.length === 1 ? 'was' : 'were'} skipped.</div>` : ''}
      ${chosen ? `<p class="small">You are <b>${esc(you || (side === 'w' ? 'White' : 'Black'))}</b>. <button id="rv-notme">Not you?</button></p>` : `
        <p class="small"><b>Which side were you?</b> The coach talks to you, and only your own moves go in the memory.</p>
        <div class="btnrow"><button id="rv-w" class="primary">White${g0.headers.White && g0.headers.White !== '?' ? `: ${esc(g0.headers.White)}` : ''}</button>
        <button id="rv-b" class="primary">Black${g0.headers.Black && g0.headers.Black !== '?' ? `: ${esc(g0.headers.Black)}` : ''}</button>
        <button id="rv-n">Neither</button></div>`}
      ${games.length > 1 ? `
        <div class="btnrow"><button id="rv-all" class="primary" ${chosen && fresh.length ? '' : 'disabled'}>Review all ${fresh.length} new game${fresh.length === 1 ? '' : 's'}</button></div>
        <div class="rv-list">${games.slice(0, 200).map((g, i) => `<button class="rv-moment" data-i="${i}" ${chosen ? '' : 'disabled'}><span class="grow">${esc(title(g))}</span><span class="muted small">${chosen && !sideOf(g) ? 'not your game' : done(g) ? 'reviewed' : `${g.moves.length} plies`}</span></button>`).join('')}</div>` : ''}`;
    $('#rv-back').onclick = () => { pending = null; show('home'); };
    const choose = (c) => {
      const name = c === 'w' ? g0.headers.White : g0.headers.Black;
      if (name && name !== '?') { settings().reviewName = name; save(); pending.you = name; } else pending.side = c;
      if (games.length === 1) return startGame(g0, c, true);
      renderPick();
    };
    if (chosen) {
      $('#rv-notme').onclick = () => { delete settings().reviewName; save(); pending.you = null; pending.side = null; renderPick(); };
    } else {
      $('#rv-w').onclick = () => choose('w');
      $('#rv-b').onclick = () => choose('b');
      $('#rv-n').onclick = () => startGame(g0, 'w', false);
    }
    if (games.length > 1) {
      if (chosen) $('#rv-all').onclick = () => reviewAll(fresh);
      panel().querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { const g = games[+b.dataset.i], c = sideOf(g); startGame(g, c || 'w', !!c); }; });
    }
  }

  // --------------------------------------------------------------- running it ---

  async function analyseOne(game, you, mine, onProgress, cancelled) {
    const eco = await ecoReady();
    const speed = settings().reviewSpeed || 'standard';
    const evals = await analyseGame(game, search, { speed, eco, onProgress, cancelled });
    if (!evals) return null;
    const plies = classifyGame(game, evals, { eco });
    traps ||= trapIndex(openings);
    const memo = new Map();
    const checkMove = async (fen, san) => {   // % a move that wasn't played would have cost
      const k = `${fen}|${san}`;
      if (memo.has(k)) return memo.get(k);
      const g = new Chess(fen), side = g.turn();
      const mv = g.move(san);
      const [a, b] = await Promise.all([search(fen, 300, 1), g.isGameOver() ? null : search(mv.after, 300, 1)]);
      const wa = winWhite({ cp: a.lines[0]?.cp, mate: a.lines[0]?.mate }, fen);
      const wb = b ? winWhite({ cp: b.lines[0]?.cp, mate: b.lines[0]?.mate }, mv.after) : (g.isCheckmate() ? (side === 'w' ? 100 : 0) : 50);
      const loss = Math.max(0, side === 'w' ? wa - wb : wb - wa);
      memo.set(k, loss);
      return loss;
    };
    const trapHits = await findTraps(game, plies, traps, you, checkMove);
    return { evals, plies, trapHits, eco };
  }

  function remember(game, you, { evals, plies, trapHits, eco }) {
    const sum = summarise(plies), h = game.headers, moments = momentsOf(game, plies, trapHits, you);
    let name = null, code = null;
    for (const m of game.moves) { const e = eco[posKey(m.after)]; if (e) { [code, name] = e; } }
    saveReview({
      id: game.id, date: today(), played: h.UTCDate || h.Date || '', white: who(h, 'White'), black: who(h, 'Black'),
      whiteElo: h.WhiteElo || '', blackElo: h.BlackElo || '', result: h.Result || '*', you, pgn: game.pgn, opening: name, eco: code,
      acc: sum[you].acc, oppAcc: sum[you === 'w' ? 'b' : 'w'].acc, counts: sum[you].counts, phases: sum[you].phases, traps: trapHits, moments, evals,
    });
    for (const m of moments) {
      if (DECK.has(m.cls) && m.best) addMistake({ fen: m.fen, best: m.best, played: m.label, cls: m.cls });
    }
  }

  async function startGame(game, you, mine) {
    stopVoice();
    if (running) running.cancelled = true;
    const token = running = { game, label: title(game), done: 0, total: game.moves.length + 1, cancelled: false };
    show('running');
    try {
      const res = await analyseOne(game, you, mine, (d, t) => { token.done = d; token.total = t; if (running === token) renderRunning(); }, () => token.cancelled);
      if (!res || running !== token) return;
      running = null;
      if (mine) remember(game, you, res);
      enter(game, you, mine, res);
    } catch (e) {
      if (running !== token) return;
      running = null;
      view = 'home';
      renderHome(`Stockfish stopped: ${e.message}`);
    }
  }

  async function reviewAll(games) {
    stopVoice();
    if (running) running.cancelled = true;
    const token = running = { batch: games.length, index: 0, label: '', done: 0, total: 1, cancelled: false };
    show('running');
    let reviewed = 0, failed = 0;
    for (const game of games) {
      if (token.cancelled) break;
      token.index++; token.label = title(game); token.done = 0;
      renderRunning();
      try {
        const you = sideOf(game);
        const res = await analyseOne(game, you, true, (d, t) => { token.done = d; token.total = t; if (running === token) renderRunning(); }, () => token.cancelled);
        if (res) { remember(game, you, res); reviewed++; }
      } catch { failed++; }
    }
    if (running !== token) return;
    running = null; pending = null; view = 'home';
    show('home');
    toast(`<b>${reviewed} game${reviewed === 1 ? '' : 's'} reviewed</b>${failed ? `${failed} failed` : 'Added to what I remember'}`);
  }

  function renderRunning() {
    const r = running;
    if (!r || S.tab !== 'analyze') return;
    const pct = Math.round((r.done / Math.max(1, r.total)) * 100);
    if (!$('#rv-bar')) {
      panel().innerHTML = `
        <div class="olist-head"><span class="eyebrow">Game review</span><button id="rv-cancel">Cancel</button></div>
        <p class="small" id="rv-label"></p>
        <div class="rv-progress"><span id="rv-bar"></span></div>
        <p class="muted small" id="rv-count"></p>`;
      $('#rv-cancel').onclick = () => { const t = running; if (t) t.cancelled = true; running = null; show('home'); };
    }
    $('#rv-label').textContent = (r.batch ? `Game ${r.index} of ${r.batch}: ` : '') + r.label;
    $('#rv-bar').style.width = `${pct}%`;
    $('#rv-count').textContent = `Stockfish is checking position ${Math.min(r.done + 1, r.total)} of ${r.total}.`;
  }

  // ----------------------------------------------------------- the review view ---

  function enter(game, you, mine, { evals, plies, trapHits, eco }, atPly = 0) {
    const chess = new Chess();
    chess.loadPgn(game.pgn);
    const tags = {};
    plies.forEach((p, i) => { if (['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'miss', 'blunder'].includes(p.cls)) tags[i] = p.cls; });
    const trapsAt = new Map();
    for (const t of trapHits) { if (!trapsAt.has(t.ply)) trapsAt.set(t.ply, []); trapsAt.get(t.ply).push(t); }
    S.review = { game, chess, tags, you, mine, evals, plies, trapHits, trapsAt, eco, summary: summarise(plies), preview: null };
    lastKey = -1;
    view = 'review';
    if (S.tab !== 'analyze') { toast('<b>Review ready</b>Open the Analyze tab to go through it'); return; }
    restore();
    S.viewPly = atPly >= game.moves.length ? null : atPly;   // before the first sync: the last game's place may not exist in this one
    S.review.preview = null;
    show('review');
    setView(atPly);
  }

  /** Back on the Analyze tab: other tabs replace the shared board, so put the reviewed game back. */
  function restore() {
    const r = S.review;
    if (!r) return;
    S.game = r.chess; S.tags = r.tags; S.lastVerdict = null; S.selected = null; r.preview = null;
    S.orient = r.you;
    S.viewPly = r.at ?? null;
    lastKey = curKey();   // coming back to the same move: don't announce it again
  }

  function exit(keep = false) {
    stopVoice();
    S.review = null;
    S.tags = {};
    S.arrows = [];
    if (!keep) S.viewPly = null;
    show('home');
  }

  function renderReview() {
    const r = S.review, s = r.summary[r.you], o = r.summary[r.you === 'w' ? 'b' : 'w'];
    const h = r.game.headers;
    const count = (c, k) => r.summary[c].counts[k];
    panel().innerHTML = `
      <div class="rv-head">
        <div class="rv-players"><b>${esc(who(h, 'White'))}</b> <span class="muted">vs</span> <b>${esc(who(h, 'Black'))}</b> <span class="muted small">${esc(h.Result || '')}</span></div>
        <button id="rv-exit">Close review</button>
      </div>
      <div class="rv-bubble" id="rv-bubble" aria-live="polite"></div>
      <div class="btnrow rv-actions">
        <button id="rv-best">Show best line</button>
        <button id="rv-lineprev" class="hidden">Previous</button>
        <button id="rv-keyprev" title="Previous key moment">Key ←</button>
        <button id="rv-keynext" title="Next key moment">Key →</button>
        <span class="spacer"></span>
        <button id="rv-next" class="primary">Next</button>
      </div>
      <div class="rv-graph" id="rv-graph"></div>
      <div class="rv-voice">
        <button id="rv-play" title="Play through the game (Space)">Play</button>
        <div class="seg" id="rv-mode" role="radiogroup" aria-label="Voice">
          <button class="seg-btn" data-v="off" role="radio">Silent</button>
          <button class="seg-btn" data-v="key" role="radio" title="Speak only the moves that matter">Key</button>
          <button class="seg-btn" data-v="all" role="radio" title="Speak every move">All</button>
        </div>
        <select id="rv-voice" aria-label="Coach voice"></select>
      </div>
      <details class="rv-report" open>
        <summary>Report: ${s.acc ?? '–'}% you, ${o.acc ?? '–'}% opponent</summary>
        <table class="rv-table"><thead><tr><th></th><th>${r.you === 'w' ? 'You' : 'Them'}</th><th>${r.you === 'b' ? 'You' : 'Them'}</th></tr></thead><tbody>
          <tr><th scope="row">Accuracy</th><td>${r.summary.w.acc ?? '–'}%</td><td>${r.summary.b.acc ?? '–'}%</td></tr>
          ${Object.keys(LABEL).filter((k) => count('w', k) + count('b', k)).map((k) => `<tr><th scope="row"><span class="rv-badge ${k}">${MARK[k]}</span>${LABEL[k]}</th><td>${count('w', k)}</td><td>${count('b', k)}</td></tr>`).join('')}
        </tbody></table>
        <p class="muted small rv-phase">${Object.entries(s.phases).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}%`).join(' · ')}</p>
        ${r.mine ? `<p class="muted small">${savedLine(r)}</p>` : '<p class="muted small">Not your game, so nothing went in the memory.</p>'}
      </details>`;
    $('#rv-exit').onclick = () => { exit(); render(); runAnalysis(); };
    $('#rv-best').onclick = toggleBest;
    $('#rv-lineprev').onclick = () => lineTo(r.preview.at - 1);
    $('#rv-next').onclick = () => { stopPlay(); if (r.preview) lineTo(r.preview.at + 1); else step(); };
    $('#rv-bubble').onclick = (e) => { const b = e.target.closest('[data-at]'); if (b) lineTo(+b.dataset.at); };
    $('#rv-keynext').onclick = () => jumpKey(1);
    $('#rv-keyprev').onclick = () => jumpKey(-1);
    $('#rv-play').onclick = togglePlay;
    drawGraph();
    syncVoiceUI();
    sync();
  }

  function savedLine(r) {
    const moments = momentsOf(r.game, r.plies, r.trapHits, r.you);
    const deck = moments.filter((m) => DECK.has(m.cls) && m.best).length;
    const good = moments.filter((m) => m.cls === 'brilliant' || m.cls === 'great').length;
    const parts = [deck && `${deck} to your mistake deck`, good && `${good} good play${good === 1 ? '' : 's'}`, r.trapHits.length && `${r.trapHits.length} trap moment${r.trapHits.length === 1 ? '' : 's'}`].filter(Boolean);
    return parts.length ? `Remembered: ${parts.join(', ')}.` : 'Remembered, with nothing flagged for your side.';
  }

  const curKey = () => (S.viewPly ?? S.game.history().length);

  function memoryNote(p, r) {
    if (!r.mine || p.color !== r.you) return '';
    const fen = r.game.moves[p.ply].before, out = [];
    const seen = findMoment(fen, r.game.id);
    if (seen) out.push(seen.san === p.san ? `You reached this same position on ${seen.date} and played ${seen.san} then too.` : `You reached this same position on ${seen.date}, and played ${seen.san} that time.`);
    if (p.theme && BAD.has(p.cls)) {
      const n = reviewPatterns(r.game.id).themes.find(([t]) => t === p.theme)?.[1] || 0;
      if (n >= 2 && p.theme !== 'positional') out.push(`Worth remembering: ${themeWords(p.theme)} has come up ${n} times in your earlier games.`);
    }
    return out.join(' ');
  }

  function bookNote(i, r) {
    notes ||= bookNotes(openings);
    const m = r.game.moves[i], k = `${posKey(m.before)}|${m.san}`;
    const e = r.eco[posKey(m.after)], prev = i ? r.eco[posKey(r.game.moves[i - 1].after)] : null;
    const parts = [];
    if (e && (!prev || prev[1] !== e[1])) parts.push(`${e[1]}.`);
    if (notes.has(k)) {
      const n = notes.get(k);   // written to whoever plays the line, so turn it round if that isn't you
      parts.push(n.side === r.you ? n.note : swapSides(n.note));
    }
    return parts.join(' ');
  }

  function bubbleFor(k) {
    const r = S.review;
    if (k === 0) return introBubble(r);
    const p = r.plies[k - 1];
    const { head, text } = commentFor(k - 1, { you: r.you, plies: r.plies, evals: r.evals, game: r.game, bookNote: p.cls === 'book' ? bookNote(k - 1, r) : '', trapsAt: r.trapsAt.get(k - 1) || [] });
    const extra = memoryNote(p, r);
    return { cls: p.cls, trap: r.trapsAt.has(k - 1), head: `${moveNum(r.game.moves[k - 1])} ${head}`, spokenHead: head, text: `${text}${extra ? ` ${extra}` : ''}`, ev: r.evals[k], fen: r.game.moves[k - 1].after, p };
  }

  function introBubble(r) {
    const s = r.summary[r.you], o = r.summary[r.you === 'w' ? 'b' : 'w'];
    const c = s.counts, bits = [];
    if (c.brilliant) bits.push(`${c.brilliant} brilliant`);
    if (c.great) bits.push(`${c.great} great`);
    if (c.blunder) bits.push(`${c.blunder} blunder${c.blunder === 1 ? '' : 's'}`);
    if (c.mistake) bits.push(`${c.mistake} mistake${c.mistake === 1 ? '' : 's'}`);
    if (c.miss) bits.push(`${c.miss} miss${c.miss === 1 ? '' : 'es'}`);
    const worst = r.plies.filter((p) => p.color === r.you && BAD.has(p.cls)).sort((a, b) => b.loss - a.loss)[0];
    const pat = r.mine ? reviewPatterns(r.game.id).themes.find(([t]) => t !== 'positional') : null;
    const text = [`You played ${r.you === 'w' ? 'White' : 'Black'}, with ${s.acc ?? '–'}% accuracy against ${o.acc ?? '–'}%.`,
      bits.length ? `You had ${bits.join(', ')}.` : 'Nothing was flagged against you.',
      worst ? `The moment to study is ${moveNum(r.game.moves[worst.ply])} ${worst.san}.` : '',
      pat ? `Across your earlier games, the pattern to watch is ${themeWords(pat[0])}.` : ''].filter(Boolean).join(' ');
    return { cls: null, head: 'Game report', spokenHead: 'Game report', text, ev: r.evals[0], fen: r.game.moves[0].before };
  }

  /** Called whenever the position on the board changes (via runAnalysis). */
  function sync() {
    const r = S.review;
    if (!r || S.tab !== 'analyze') return;
    if (!$('#rv-bubble')) return show('review');   // finished while another tab was open
    const k = curKey();
    const b = bubbleFor(k);
    $('#rv-bubble').innerHTML = `
      <img class="rv-coach" src="pieces/wN.svg" alt="">
      <div class="rv-say">
        <div class="rv-sayhead">${b.cls ? `<span class="rv-badge ${b.cls}" title="${LABEL[b.cls]}">${MARK[b.cls]}</span>` : ''}<b>${esc(b.head)}</b><span class="eng rv-ev" title="White's view">${esc(evalChip(b.ev))}</span></div>
        <p>${esc(b.text)}</p>
        ${r.preview ? lineHtml(r, k) : ''}
      </div>`;
    const n = r.game.moves.length;
    const pr = r.preview, lineEnd = pr && pr.at >= pr.ucis.length;
    $('#rv-next').disabled = pr ? lineEnd : k >= n;
    $('#rv-next').textContent = pr ? (!lineEnd ? 'Next in line' : pr.busy ? 'Stockfish is thinking…' : 'End of line') : k === 0 ? 'Start' : k >= n ? 'End' : 'Next';
    $('#rv-lineprev').classList.toggle('hidden', !pr);
    $('#rv-lineprev').disabled = !pr || pr.at <= 0;
    $('#rv-keyprev').classList.toggle('hidden', !!pr);
    $('#rv-keynext').classList.toggle('hidden', !!pr);
    const best = k > 0 && r.plies[k - 1].best;
    $('#rv-best').disabled = !(best || r.preview);
    $('#rv-best').textContent = r.preview ? 'Back to the game' : 'Show best line';
    S.arrows = [];
    if (!r.preview && k > 0) {
      const p = r.plies[k - 1], after = r.evals[k];
      if (p.best && p.cls !== 'book' && p.loss > 2) S.arrows.push({ from: p.best.slice(0, 2), to: p.best.slice(2, 4), kind: 'good' });
      if (['mistake', 'blunder'].includes(p.cls) && after.pv?.[0]) S.arrows.push({ from: after.pv[0].slice(0, 2), to: after.pv[0].slice(2, 4), kind: 'bad' });
    } else if (pr && !lineEnd) {
      const u = pr.ucis[pr.at];
      S.arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'good' });
    }
    drawArrows(true);
    decorateBoard();
    const ev = pr ? r.evals[k - 1] : r.evals[k];   // on the best line the bar shows what that line is worth
    if (ev.over) { updateEval(ev.over === 'mate' ? { mate: r.game.moves[k - 1].color === 'w' ? 1 : -1 } : { cp: 0 }); $('#evaltext').textContent = r.game.headers.Result && r.game.headers.Result !== '*' ? r.game.headers.Result : ev.over === 'mate' ? '#' : '½'; } else updateEval(ev);
    moveCursor(k);
    if (k !== lastKey) {
      if (k === lastKey + 1 && k > 0) {
        const m = r.game.moves[k - 1];
        moveSound(m, /[+#]/.test(m.san));
      }
      lastKey = k;
      if (!autoStep) stopPlay();
      if (!r.preview) lastSpeech = speakFor(b);
    }
  }

  const evalChip = (ev) => (ev.over ? (ev.over === 'mate' ? '#' : '½') : evalText(ev));

  /** The badge on the piece that just moved. Called after every board redraw. */
  function decorateBoard() {
    const r = S.review;
    if (!r || r.preview) return;
    const k = curKey();
    if (!k) return;
    const p = r.plies[k - 1];
    const sq = document.querySelector(`#board .sq[data-sq="${p.to}"]`);
    if (!sq || sq.querySelector('.rv-sqbadge')) return;
    sq.insertAdjacentHTML('beforeend', `<span class="rv-badge rv-sqbadge ${p.cls}">${MARK[p.cls]}</span>`);
  }

  function step() {
    const k = curKey();
    if (k < S.review.game.moves.length) setView(k + 1);
  }

  function jumpKey(dir) {
    const r = S.review, k = curKey();
    const isKey = (p) => KEY.has(p.cls) && p.cls !== 'inaccuracy';
    const list = r.plies.filter((p) => isKey(p) && (dir > 0 ? p.ply + 1 > k : p.ply + 1 < k));
    const p = dir > 0 ? list[0] : list[list.length - 1];
    stopPlay();
    if (p) setView(p.ply + 1);
    else toast(`<b>No more key moments</b>${dir > 0 ? 'That was the last one.' : 'That was the first one.'}`);
  }

  // Best line: walk Stockfish's alternative on a copy of the board, leaving the game alone.
  // The review keeps only the first moves of each line, so Stockfish continues it on request.
  const LINE_MAX = 16, EXTEND_MS = 1000;
  const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

  function toggleBest() {
    const r = S.review;
    if (r.preview) { r.preview = null; render(); sync(); return; }
    const k = curKey(), p = r.plies[k - 1];
    if (!p?.best) return;
    stopPlay();
    const m = r.game.moves[k - 1], pv = r.evals[k - 1].pv;
    const g = new Chess(m.before), ucis = [], sans = [];
    for (const u of pv?.[0] === p.best ? pv : [p.best]) {
      try { sans.push(g.move(uciMove(u)).san); ucis.push(u); } catch { break; }
    }
    r.preview = { before: m.before, ucis, sans, at: 0, game: new Chess(m.before), busy: false, done: false };
    lineTo(1);
  }

  function lineTo(at) {
    const r = S.review, pr = r?.preview;
    if (!pr) return;
    at = Math.max(0, Math.min(pr.ucis.length, at));
    const g = new Chess(pr.before);
    let mv = null;
    for (const u of pr.ucis.slice(0, at)) mv = g.move(uciMove(u));
    if (at === pr.at + 1 && mv) { S.anim = { from: mv.from, to: mv.to }; moveSound(mv, g.inCheck()); }
    pr.at = at;
    pr.game = g;
    render();
    sync();
    if (at >= pr.ucis.length - 2) extendLine(pr);
  }

  async function extendLine(pr) {
    if (pr.busy || pr.done || pr.ucis.length >= LINE_MAX) return;
    const g = new Chess(pr.before);
    for (const u of pr.ucis) g.move(uciMove(u));
    if (g.isGameOver()) { pr.done = true; sync(); return; }
    pr.busy = true;
    let added = 0;
    try {
      const res = await search(g.fen(), EXTEND_MS, 1);
      for (const u of res.lines?.[0]?.pv || []) {
        if (pr.ucis.length >= LINE_MAX) break;
        pr.sans.push(g.move(uciMove(u)).san);
        pr.ucis.push(u);
        added++;
      }
    } catch { /* engine busy or an illegal move: keep what we have */ }
    pr.busy = false;
    if (!added) pr.done = true;
    if (S.review?.preview === pr) sync();
  }

  function lineHtml(r, k) {
    const pr = r.preview, f = pr.before.split(' '), turn = f[1], num = +f[5];
    const moves = pr.sans.map((san, i) => {
      const white = (turn === 'w') === (i % 2 === 0), n = num + Math.floor((i + (turn === 'w' ? 0 : 1)) / 2);
      const label = white ? `${n}.` : i === 0 ? `${n}...` : '';
      return `${label ? `<span class="muted">${label}</span>` : ''}<button class="rv-line-move${i + 1 === pr.at ? ' on' : ''}" data-at="${i + 1}">${esc(san)}</button>`;
    }).join(' ');
    return `<div class="rv-line"><span class="eyebrow">Stockfish's line</span><div class="rv-line-moves">${moves}</div>${lineResult(r, k)}</div>`;
  }

  // What the line achieves, measured on the whole line. The eval is the one Stockfish gave the
  // position before the move, which is what the best line is worth.
  function lineResult(r, k) {
    const pr = r.preview, me = pr.before.split(' ')[1], side = me === 'w' ? 'White' : 'Black';
    const end = new Chess(pr.before);
    for (const u of pr.ucis) end.move(uciMove(u));
    const { gain } = pvGain(pr.before, pr.ucis, pr.ucis.length);
    const out = end.isCheckmate() ? `${end.turn() === 'w' ? 'Black' : 'White'} gives checkmate at the end of this line.`
      : gain >= 1 ? `${side} comes out ${worth(gain)} up by the end of this line.` : '';
    return `<p class="muted small">${out ? `${esc(out)} ` : ''}Worth ${esc(evalChip(r.evals[k - 1]))}, against ${esc(evalChip(r.evals[k]))} after the game move.</p>`;
  }

  // ------------------------------------------------------------------ the graph ---

  const W = 400, H = 72;
  function drawGraph() {
    const r = S.review, n = r.evals.length - 1;
    const x = (k) => (k / Math.max(1, n)) * W;
    const fenAt = (k) => (k === 0 ? r.game.moves[0].before : r.game.moves[k - 1].after);
    const y = (k) => H - (winWhite(r.evals[k], fenAt(k)) / 100) * H;
    let d = `M0,${H}`;
    for (let k = 0; k <= n; k++) d += ` L${x(k).toFixed(1)},${y(k).toFixed(1)}`;
    d += ` L${W},${H} Z`;
    const dots = r.plies.filter((p) => GRAPH_DOTS.has(p.cls)).map((p) =>
      `<circle class="rv-dot ${p.cls}" cx="${x(p.ply + 1).toFixed(1)}" cy="${y(p.ply + 1).toFixed(1)}" r="4"></circle>`).join('');
    $('#rv-graph').innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="White's winning chances through the game">
        <rect class="rv-g-bg" width="${W}" height="${H}"></rect>
        <path class="rv-g-area" d="${d}"></path>
        <line class="rv-g-mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"></line>
        <line class="rv-g-cur" id="rv-cur" y1="0" y2="${H}"></line>
        ${dots}
      </svg>
      <div class="rv-tip hidden" id="rv-tip"></div>`;
    const box = $('#rv-graph');
    const plyAt = (e) => {
      const b = box.getBoundingClientRect();
      return Math.max(0, Math.min(n, Math.round(((e.clientX - b.left) / b.width) * n)));
    };
    box.onpointermove = (e) => {
      const k = plyAt(e), tip = $('#rv-tip'), b = box.getBoundingClientRect();
      const p = k ? r.plies[k - 1] : null;
      tip.textContent = p ? `${moveNum(r.game.moves[k - 1])} ${p.san} · ${LABEL[p.cls]} · ${evalChip(r.evals[k])}` : `Start · ${evalChip(r.evals[0])}`;
      tip.classList.remove('hidden');
      tip.style.left = `${Math.max(0, Math.min(b.width - tip.offsetWidth, e.clientX - b.left - tip.offsetWidth / 2))}px`;
    };
    box.onpointerleave = () => $('#rv-tip').classList.add('hidden');
    box.onclick = (e) => { stopPlay(); setView(plyAt(e)); };
  }

  function moveCursor(k) {
    const c = $('#rv-cur');
    if (!c) return;
    const n = S.review.evals.length - 1, xp = (k / Math.max(1, n)) * W;
    c.setAttribute('x1', xp); c.setAttribute('x2', xp);
  }

  // --------------------------------------------------------------------- voice ---

  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  let voices = [], lastSpeech = Promise.resolve(), speechToken = 0, autoStep = false, playToken = 0;

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^en\b|^en-/i.test(v.lang));
    voices.sort((a, b) => rankVoice(b) - rankVoice(a));
    if (S.review && $('#rv-voice')) syncVoiceUI();
  }
  // Edge's "Natural" voices sound far better than the old desktop ones.
  const rankVoice = (v) => (/natural/i.test(v.name) ? 4 : /online|google/i.test(v.name) ? 2 : 0) + (/en-US|en-GB|en-AU/i.test(v.lang) ? 1 : 0);
  if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }
  const chosenVoice = () => voices.find((v) => v.name === settings().reviewVoice) || voices[0] || null;
  const voiceMode = () => settings().reviewMode || 'all';

  function syncVoiceUI() {
    document.querySelectorAll('#rv-mode [data-v]').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === voiceMode());
      b.onclick = () => { settings().reviewMode = b.dataset.v; save(); syncVoiceUI(); if (b.dataset.v === 'off') stopVoice(); };
    });
    const sel = $('#rv-voice');
    if (!sel) return;
    sel.classList.toggle('hidden', !voices.length);
    sel.innerHTML = voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name.replace(/^Microsoft /, '').replace(/ Online \(Natural\).*/, ' (natural)'))}</option>`).join('');
    if (chosenVoice()) sel.value = chosenVoice().name;
    sel.onchange = () => { settings().reviewVoice = sel.value; save(); speakFor(bubbleFor(curKey()), true); };
    const mode = $('#rv-mode');
    if (!synth || !voices.length) mode.title = 'No speech voices on this device: reading only.';
  }

  function say(text) {
    const mine = ++speechToken;
    if (!synth || !voices.length) return Promise.resolve(false);
    synth.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(toSpeech(text));
      const v = chosenVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      const done = (ok) => { clearTimeout(guard); resolve(ok); };
      // A voice that never reports its end must not stall Play.
      const guard = setTimeout(() => done(false), Math.max(5000, text.length * 130));
      u.onend = () => done(mine === speechToken);
      u.onerror = () => done(false);
      synth.speak(u);
    });
  }

  function speakFor(b, force = false) {
    const mode = voiceMode();
    if (mode === 'off' && !force) { if (synth) synth.cancel(); return Promise.resolve(false); }
    const key = !b.cls || KEY.has(b.cls) || b.trap;
    if (mode === 'key' && !key && !force) { if (synth) synth.cancel(); return Promise.resolve(false); }
    return say(`${b.spokenHead}. ${b.text}`);
  }

  function stopVoice() {
    stopPlay();
    speechToken++;
    if (synth) synth.cancel();
  }

  function stopPlay() {
    if (!playing()) return;
    playToken++;
    syncPlayBtn();
  }
  let isPlaying = 0;
  const playing = () => isPlaying === playToken && isPlaying !== 0;
  function syncPlayBtn() { const b = $('#rv-play'); if (b) b.textContent = playing() ? 'Pause' : 'Play'; }

  async function togglePlay() {
    if (!S.review) return;
    if (playing()) { stopVoice(); return; }
    const tok = isPlaying = ++playToken;
    syncPlayBtn();
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    if (curKey() === 0) { lastSpeech = speakFor(bubbleFor(0), false); }
    while (S.review && tok === playToken && S.tab === 'analyze') {
      const spoke = await lastSpeech;
      if (tok !== playToken) break;
      const k = curKey(), p = k ? S.review.plies[k - 1] : null;
      await wait(spoke ? 350 : p && KEY.has(p.cls) ? 2600 : 900);
      if (tok !== playToken || !S.review) break;
      if (curKey() >= S.review.game.moves.length) break;
      autoStep = true;
      step();
      autoStep = false;
    }
    if (tok === playToken) { isPlaying = 0; playToken++; syncPlayBtn(); }
  }

  // ------------------------------------------------------- entry points from app ---

  function reviewGame(pgn, you, mine = true) {
    let game;
    try { game = gameFromPgn(pgn); } catch (e) { toast(`<b>Could not read that game</b>${esc(e.message)}`); return; }
    if (S.review) exit();
    if (S.tab !== 'analyze') switchTab('analyze');
    const saved = getReview(game.id);
    if (saved?.evals) return openSaved(game.id);
    startGame(game, you, mine);
  }

  async function openSaved(id, ply = null) {
    const rec = getReview(id);
    if (!rec) return;
    let game;
    try { game = gameFromPgn(rec.pgn); } catch (e) { toast(`<b>Could not open that game</b>${esc(e.message)}`); return; }
    const eco = await ecoReady();
    if (!rec.evals) {   // older reviews keep the moments but not the engine's numbers
      startGame(game, rec.you, true);
      return;
    }
    const plies = classifyGame(game, rec.evals, { eco });
    enter(game, rec.you, true, { evals: rec.evals, plies, trapHits: rec.traps || [], eco }, ply === null ? 0 : ply + 1);
  }

  function context() {
    const r = S.review;
    if (!r) return [];
    const k = curKey(), b = bubbleFor(k), m = reviewPatterns(r.game.id);
    return [
      `Mode: reviewing a finished game move by move. The student played ${r.you === 'w' ? 'White' : 'Black'} (${who(r.game.headers, 'White')} vs ${who(r.game.headers, 'Black')}).`,
      r.preview ? `Verdict on the game move: ${b.head}. ${b.text} The board is NOT showing the game: it shows Stockfish's alternative, ${r.preview.at} moves into the line ${r.preview.sans.join(' ')}. The student is exploring that line.`
        : `Review verdict on the position shown: ${b.head}. ${b.text}`,
      m.games ? `What earlier reviews remember (${m.games} games): recurring ${m.themes.slice(0, 3).map(([t, n]) => `${themeWords(t)} x${n}`).join(', ') || 'nothing yet'}.` : '',
    ].filter(Boolean);
  }

  // Arrow keys and the board's nav buttons step the best line while it is open.
  function lineNav(ply) {
    const k = curKey(), at = S.review.preview.at;
    lineTo(ply === k + 1 ? at + 1 : ply === k - 1 ? at - 1 : ply === 0 ? 0 : S.review.preview.ucis.length);
  }

  function leave() {   // going to another tab
    stopVoice();
    if (S.review) { S.review.preview = null; S.review.at = S.viewPly; }
  }

  return { show, sync, exit, restore, reviewGame, decorateBoard, togglePlay, context, leave, lineNav };
}
