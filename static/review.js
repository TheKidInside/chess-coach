// Game review: the engine side of a Chess.com-style report. Nothing here touches the page, so
// tools/review/test_review.mjs can run it under Node against real Stockfish.
//
// Move labels follow Chess.com's published "expected points" table: how much of a win (0-100%) the
// move gives up against the best move. Brilliant, Great and Miss are Chess.com's descriptions turned
// into rules of our own (they don't publish the rules). Their winning-chances curve also depends on
// the players' ratings and isn't public, so CURVE is an estimate: well under the slope of Lichess's curve
// (0.00368) reproduced the flagged moves of the one Chess.com review it was checked against
// (tools/review/test_review.mjs). Compare more reviews before trusting it further.
import { Chess } from './vendor/chess.js';
import { VALUE, passFen, threatIn, pvGain, forkTargets } from './why.js';

export const LABEL = {
  brilliant: 'Brilliant', great: 'Great', best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book',
  forced: 'Forced', inaccuracy: 'Inaccuracy', mistake: 'Mistake', miss: 'Miss', blunder: 'Blunder',
};
export const CLASSES = Object.keys(LABEL);
export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const CURVE = 0.0016;
const SPEEDS = { fast: 250, standard: 500, deep: 1200 };   // ms per position

const other = (c) => (c === 'w' ? 'b' : 'w');
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const round = (n) => Math.round(n * 10) / 10;

/** "12." or "12...": from the position, because a game can start from a FEN. */
export function moveNum(mv) {
  const f = mv.before.split(' ');
  return `${f[5]}${f[1] === 'w' ? '.' : '...'}`;
}

// ---------------------------------------------------------------- PGN files ---

/** A .pgn file can hold one game or a whole archive. Returns [{ pgn, headers, moves, startFen, id }]; bad games go in `errors`. */
export function parsePgnFile(text) {
  const clean = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\\"/g, "'").trim();
  // A new game starts at a tag after a blank line, or right after a result. Tag order varies by site.
  const chunks = clean.split(/\n\s*\n(?=\[\w+\s+")|(?<=(?:1-0|0-1|1\/2-1\/2|\*))\s*\n\s*(?=\[\w+\s+"|1\.)/).filter((c) => c.trim());
  const games = [], errors = [];
  for (const chunk of chunks) {
    try {
      const g = gameFromPgn(chunk);
      if (g.moves.length) games.push(g);
      else errors.push('a game with no moves');
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { games, errors };
}

export function gameFromPgn(pgn) {
  const g = new Chess();
  g.loadPgn(pgn);
  const headers = g.getHeaders ? g.getHeaders() : g.header();
  const moves = g.history({ verbose: true });
  return { pgn, headers, moves, startFen: moves[0]?.before, id: gameId(headers, moves) };
}

function gameId(h, moves) {   // the same game uploaded twice keeps one entry in the memory
  const text = [h.White, h.Black, h.Date, h.UTCDate, moves.map((m) => m.san).join(' ')].join('|');
  let a = 5381;
  for (let i = 0; i < text.length; i++) a = ((a * 33) ^ text.charCodeAt(i)) >>> 0;
  return `g${a.toString(36)}${moves.length.toString(36)}`;
}

// ----------------------------------------------------------------- analysis ---

// Compact engine result for one position. White's view, like the rest of the app.
function compact(r) {
  const l = r.lines[0];
  if (!l) return { cp: 0 };
  const e = l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 };
  e.best = r.bestmove;
  e.pv = (l.pv || []).slice(0, 8);
  const a = r.lines[1];
  if (a?.pv?.[0]) e.alt = { uci: a.pv[0], ...(a.mate !== undefined ? { mate: a.mate } : { cp: a.cp ?? 0 }) };
  return e;
}

/**
 * One engine result per position (moves.length + 1). search(fen, movetime, multipv) -> /api/analyse's
 * answer. Quiet checks: a second, short search with the other side to move tells us what each side
 * was threatening; book positions skip it and get less time.
 */
export async function analyseGame(game, search, { speed = 'standard', eco = null, onProgress, cancelled } = {}) {
  const ms = SPEEDS[speed] || SPEEDS.standard;
  const { moves } = game;
  const fens = [moves[0]?.before, ...moves.map((m) => m.after)];
  const book = bookPlies(moves, eco);
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    if (cancelled?.()) return null;
    onProgress?.(i, fens.length);
    const fen = fens[i], g = new Chess(fen);
    if (g.isGameOver()) { evals.push(g.isCheckmate() ? { over: 'mate' } : { over: 'draw' }); continue; }
    const inBook = i < book;
    const e = compact(await search(fen, inBook ? Math.min(ms, 200) : ms, 2));
    if (!inBook) {
      const pass = passFen(fen);
      if (pass) {
        const t = threatIn(pass, await search(pass, Math.max(120, ms / 2), 1).catch(() => null));
        if (t) e.threat = t;
      }
    }
    evals.push(e);
  }
  onProgress?.(fens.length, fens.length);
  return evals;
}

// Everything up to the last named position counts as theory, as on the app's move list.
function bookPlies(moves, eco) {
  if (!eco) return 0;
  let last = 0;
  moves.forEach((m, i) => { if (eco[posKey(m.after)]) last = i + 1; });
  return last;
}

/** White's winning chances, 0-100. fen is only needed for a finished game. */
export function winWhite(e, fen) {
  if (e.over === 'draw') return 50;
  if (e.over === 'mate') return fen.split(' ')[1] === 'w' ? 0 : 100;
  if (e.mate !== undefined) return e.mate > 0 ? 100 : e.mate < 0 ? 0 : 50;
  const cp = Math.max(-1500, Math.min(1500, e.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-CURVE * cp)) - 1);
}
const winFor = (color, e, fen) => (color === 'w' ? winWhite(e, fen) : 100 - winWhite(e, fen));

// ------------------------------------------------------------------- labels ---

const pointsLost = (loss) => (loss <= 2 ? 'excellent' : loss <= 5 ? 'good' : loss <= 10 ? 'inaccuracy' : loss <= 20 ? 'mistake' : 'blunder');

// Pieces the move leaves capturable at a profit, compared with before it. Legal captures only, so a
// pinned attacker doesn't count. Returns the most the opponent could win, net of what the move took.
function sacrificed(mv) {
  const before = new Chess(mv.before), after = new Chess(mv.after), me = mv.color;
  let most = 0;
  for (const c of after.moves({ verbose: true })) {
    if (!c.captured || c.captured === 'p') continue;
    const defended = after.attackers(c.to, me).length > 0;
    if (defended && VALUE[c.piece] >= VALUE[c.captured]) continue;
    if (c.to !== mv.to && before.attackers(c.to, other(me)).includes(c.from)) continue;   // it was already loose
    most = Math.max(most, VALUE[c.captured]);
  }
  return most - (mv.captured ? VALUE[mv.captured] : 0);
}

// Value left on the table by a line, counting back whatever the last move had just taken.
function chanceIn(fen, pv, last) {
  if (!pv?.length) return 0;
  return pvGain(fen, pv, 8).gain - (last?.captured ? VALUE[last.captured] : 0);
}

function phaseOf(fen, ply, book) {
  const g = new Chess(fen);
  let pieces = 0;
  for (const row of g.board()) for (const p of row) if (p && p.type !== 'p') pieces += VALUE[p.type];
  if (pieces <= 16) return 'endgame';
  return ply <= Math.max(book, 19) ? 'opening' : 'middlegame';
}

// What went wrong or what was on offer, as a word the memory can count across games.
function themeOf(p, mv, evals, i) {
  const after = evals[i + 1], before = evals[i];
  const myMate = (e) => e.mate !== undefined && e.mate !== 0 && (mv.color === 'w') === (e.mate > 0);
  if (p.cls === 'miss' && myMate(before)) return 'missed-mate';
  if (after.mate !== undefined && after.mate !== 0 && !myMate(after)) return 'allowed-mate';
  if (p.cls === 'miss') {
    const g = new Chess(mv.before), best = before.best && g.move({ from: before.best.slice(0, 2), to: before.best.slice(2, 4), promotion: before.best[4] });
    if (best && forkTargets(g, best).length >= 2) return 'missed-fork';
    if (best && pinOf(g, best)) return 'missed-pin';
    return chanceIn(mv.before, before.pv, null) >= 1 ? 'missed-material' : 'missed-chance';
  }
  if (after.pv?.length) {
    const gain = pvGain(mv.after, after.pv, 6).gain;
    if (gain >= 2 + (mv.captured ? VALUE[mv.captured] : 0)) {
      const g = new Chess(mv.after), r = g.move({ from: after.pv[0].slice(0, 2), to: after.pv[0].slice(2, 4), promotion: after.pv[0][4] });
      if (forkTargets(g, r).length >= 2) return 'allowed-fork';
      if (before.threat?.gain && before.threat.san === r.san) return 'ignored-threat';
      return 'hung-material';
    }
  }
  return p.phase === 'endgame' ? 'endgame-technique' : 'positional';
}

/** The moved rook, bishop or queen pins an enemy piece to a bigger one behind it. Returns { piece, behind } or null. */
export function pinOf(g, mv) {
  const dirs = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
  dirs.q = [...dirs.b, ...dirs.r];
  if (!dirs[mv.piece]) return null;
  for (const [df, dr] of dirs[mv.piece]) {
    let f = 'abcdefgh'.indexOf(mv.to[0]) + df, r = +mv.to[1] + dr, first = null;
    for (; f >= 0 && f < 8 && r >= 1 && r <= 8; f += df, r += dr) {
      const q = g.get('abcdefgh'[f] + r);
      if (!q) continue;
      if (q.color === mv.color) break;
      if (!first) { first = q; continue; }
      if (q.type === 'k' || VALUE[q.type] > VALUE[first.type]) return { piece: first, behind: q };
      break;
    }
  }
  return null;
}

/** One entry per move: { ply, san, color, uci, cls, loss, win, phase, theme?, best, bestSan?, ... }. */
export function classifyGame(game, evals, { eco = null } = {}) {
  const { moves } = game, book = bookPlies(moves, eco);
  const plies = [];
  moves.forEach((mv, i) => {
    const before = evals[i], after = evals[i + 1], me = mv.color, uci = uciOf(mv);
    const winBest = winFor(me, before, mv.before);
    const isBest = uci === before.best;
    const isAlt = before.alt?.uci === uci;
    const winPlayed = isBest ? winBest : isAlt ? winFor(me, before.alt, mv.before) : winFor(me, after, mv.after);
    const loss = isBest ? 0 : Math.max(0, winBest - winPlayed);
    const last = moves[i - 1] || null, prev = plies[i - 1] || null;
    const p = {
      ply: i, san: mv.san, color: me, uci, from: mv.from, to: mv.to, loss: round(loss), win: round(winFor(me, after, mv.after)),
      phase: phaseOf(mv.after, i + 1, book),
    };
    if (before.best && !isBest) {
      p.best = before.best;
      try { p.bestSan = new Chess(mv.before).move({ from: p.best.slice(0, 2), to: p.best.slice(2, 4), promotion: p.best[4] }).san; } catch { /* engine gave a stale move */ }
    }
    const legal = new Chess(mv.before).moves().length;
    p.cls = legal === 1 ? 'forced' : isBest ? 'best' : pointsLost(loss);

    if (legal > 1 && i < book && loss < 10) p.cls = 'book';

    if (legal > 1 && p.cls !== 'book') {
      const altWin = before.alt ? winFor(me, before.alt, mv.before) : null;
      const onlyMove = isBest && altWin !== null && winBest - altWin >= 15;
      const wasInCheck = new Chess(mv.before).inCheck();
      const recapture = last?.captured && mv.captured && mv.to === last.to;
      const punishing = prev && prev.loss >= 20;

      // Miss: not a move that throws something away, but a chance let go. Allowing mate is a blunder, whatever came before.
      const myMate = before.mate !== undefined && before.mate !== 0 && (me === 'w') === (before.mate > 0);
      const stillMate = after.mate !== undefined && after.mate !== 0 && (me === 'w') === (after.mate > 0);
      const chance = chanceIn(mv.before, before.pv, last);
      const opportunity = (myMate && Math.abs(before.mate) <= 5) || chance >= 2;
      const gift = prev && prev.loss >= 10;
      const taken = after.pv?.length ? pvGain(mv.after, after.pv, 4).gain - (mv.captured ? VALUE[mv.captured] : 0) : 0;
      const givesBack = taken >= 2;
      // Chess.com: a blunder "also loses material or the game", however the percentages fall
      const allowsMate = after.mate !== undefined && after.mate !== 0 && (me === 'w') !== (after.mate > 0);
      if ((p.cls === 'inaccuracy' || p.cls === 'mistake') && winBest >= 25 && (taken >= 3 || allowsMate)) p.cls = 'blunder';
      const missedMate = myMate && Math.abs(before.mate) <= 3 && !stillMate && !isBest;
      if (!isBest && !givesBack && !allowsMate && ((loss > 5 && (gift || opportunity)) || missedMate)) p.cls = 'miss';

      // One idea, one label: the moves that carry out a combination are just the best moves.
      else if ([2, 4, 6].some((back) => ['brilliant', 'great'].includes(plies[i - back]?.cls))) { /* keeps best or excellent */ }
      else if (loss <= 2 && !wasInCheck && winPlayed >= 45 && (altWin ?? 0) < 97 && sacrificed(mv) >= 2) p.cls = 'brilliant';
      else if (onlyMove && winPlayed >= 40 && altWin < 90 && !recapture && !punishing) p.cls = 'great';
    }

    if (BAD.has(p.cls)) p.theme = themeOf(p, mv, evals, i);
    plies.push(p);
  });
  return plies;
}

// ------------------------------------------------------------------ summary ---

const moveAcc = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

/** Accuracy (Lichess's per-move curve, averaged; Chess.com's CAPS score is private) + label counts per side + accuracy by phase. */
export function summarise(plies) {
  const out = {};
  for (const c of ['w', 'b']) {
    const mine = plies.filter((p) => p.color === c && p.cls !== 'forced');
    const avg = (ps) => (ps.length ? Math.round(ps.reduce((a, p) => a + moveAcc(p.loss), 0) / ps.length) : null);
    const counts = Object.fromEntries(CLASSES.map((k) => [k, 0]));
    for (const p of plies) if (p.color === c) counts[p.cls]++;
    out[c] = {
      acc: avg(mine), counts,
      phases: { opening: avg(mine.filter((p) => p.phase === 'opening')), middlegame: avg(mine.filter((p) => p.phase === 'middlegame')), endgame: avg(mine.filter((p) => p.phase === 'endgame')) },
    };
  }
  return out;
}

// -------------------------------------------------------------------- traps ---

/** Index the trap lines of the opening library by position: key -> [{ line, i }], line.moves[i] being the next move. */
export function trapIndex(openings) {
  const index = new Map();
  for (const line of openings) {
    if (![].concat(line.topic || []).includes('trap')) continue;
    const g = new Chess();
    for (let i = 0; i < line.moves.length; i++) {
      const key = posKey(g.fen());
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ line, i });
      try { g.move(line.moves[i]); } catch { break; }
    }
  }
  return index;
}

/**
 * What happened around the library's traps: { kind, line, name, ply, san? }.
 * The lines don't mark which move is the error, so the engine decides: a victim's move on the line
 * that costs 5%+ is the trap being taken.
 *   fell: you took the bait · sprung: they did and you punished it · missed: they did and you didn't
 *   avoided: you were on the line and stepped off it at the bad move (checkTrap needed)
 *   could-set: you stepped off the line where the next move was a good one that baits them
 * checkTrap(fen, san) -> % the move loses, used for moves that were not played. May be null.
 */
export async function findTraps(game, plies, index, you, checkMove = null) {
  const out = [], seen = new Set();
  const add = (kind, hit, ply, extra = {}) => {
    if (seen.has(hit.line.id) || seen.has(`${kind}${ply}`)) return;
    seen.add(hit.line.id).add(`${kind}${ply}`);
    out.push({ kind, line: hit.line.id, name: hit.line.name, ply, ...extra });
  };
  for (let j = 0; j < game.moves.length; j++) {
    const mv = game.moves[j], hits = index.get(posKey(mv.before)) || [];
    for (const hit of hits) {
      const want = hit.line.moves[hit.i], victim = other(hit.line.side), onLine = want.replace(/[+#!?]/g, '') === mv.san.replace(/[+#!?]/g, '');
      if (mv.color === victim && onLine && plies[j].loss >= 5) {
        const answer = hit.line.moves[hit.i + 1], next = game.moves[j + 1];
        const followed = answer && next && answer.replace(/[+#]/g, '') === next.san.replace(/[+#]/g, '');
        if (mv.color === you) add('fell', hit, j);
        else if (followed || plies[j + 1]?.loss <= 5) add('sprung', hit, j + 1);
        else if (next) add('missed', hit, j + 1, { san: answer || plies[j + 1].bestSan });
      } else if (checkMove && !onLine && mv.color === you && hit.i >= 4 && !seen.has(hit.line.id)) {
        if (mv.color === victim) {
          if (await checkMove(mv.before, want) >= 5) add('avoided', hit, j, { san: want });
        } else if (hit.i + 1 < hit.line.moves.length) {
          const g = new Chess(mv.before);
          let afterMine = null;
          try { g.move(want); afterMine = g.fen(); } catch { continue; }
          if (await checkMove(mv.before, want) <= 5 && await checkMove(afterMine, hit.line.moves[hit.i + 1]) >= 5) add('could-set', hit, j, { san: want, bait: hit.line.moves[hit.i + 1] });
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- moments ---

const THEME_WORDS = {
  'hung-material': 'leaving material hanging', 'allowed-fork': 'walking into forks', 'allowed-mate': 'allowing mating attacks',
  'ignored-threat': 'ignoring a threat', 'missed-mate': 'missing a forced mate', 'missed-fork': 'missing a fork',
  'missed-pin': 'missing a pin', 'missed-material': 'missing a chance to win material', 'missed-chance': "not punishing the opponent's slips",
  'endgame-technique': 'endgame technique', positional: 'positional drift',
};
export const themeWords = (t) => THEME_WORDS[t] || t;

/** The moves worth remembering from your side of a game: errors, chances let go, good plays, traps. */
export function momentsOf(game, plies, traps, you) {
  const keep = plies.filter((p) => p.color === you && (['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(p.cls)))
    .sort((a, b) => b.loss - a.loss);
  const out = keep.slice(0, 12).map((p) => ({
    ply: p.ply, san: p.san, label: `${moveNum(game.moves[p.ply])} ${p.san}`, cls: p.cls, theme: p.theme || null, phase: p.phase, fen: game.moves[p.ply].before, best: p.best || null, bestSan: p.bestSan || null, loss: p.loss,
  }));
  for (const t of traps) {
    const m = game.moves[t.ply];
    out.push({ ply: t.ply, san: m?.san || '', label: m ? `${moveNum(m)} ${m.san}` : '', cls: `trap-${t.kind}`, trap: t.name, hint: t.san || null, fen: m?.before || '' });
  }
  return out.sort((a, b) => a.ply - b.ply);
}
