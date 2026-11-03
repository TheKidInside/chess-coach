// Why Stockfish's move works, in plain words. Every sentence comes from the board and the
// engine's own lines (never from an LLM), so it can be terse but it can't invent a tactic.
import { Chess } from './vendor/chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function materialFor(g, color) {
  let s = 0;
  for (const row of g.board()) for (const p of row) if (p) s += (p.color === color ? 1 : -1) * VALUE[p.type];
  return s;
}

const other = (c) => (c === 'w' ? 'b' : 'w');
const play = (g, uci) => g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
export const worth = (n) => (n >= 8 ? 'about a queen' : n >= 5 ? 'about a rook' : n >= 3 ? 'a piece' : n === 2 ? 'two points of material' : 'a pawn');
const SQUARES = [...'abcdefgh'].flatMap((f) => [...'12345678'].map((r) => f + r));
const reach = (g, sq, color) => SQUARES.filter((s) => g.attackers(s, color).includes(sq)).length;
const matesFor = (color, line) => line?.mate !== undefined && line.mate !== 0 && (color === 'w') === (line.mate > 0);

// The same position with the other side to move: asking the engine about it shows what the side
// that just moved would do next if left alone. Null when a king is in check, because that position
// is illegal (Stockfish can crash on one).
export function passFen(fen) {
  if (new Chess(fen).inCheck()) return null;
  const f = fen.split(' ');
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[3] = '-';
  return f.join(' ');
}

// Play the line out and count what changed hands. Stop after a reply, so a capture isn't
// counted as a win just because the recapture falls past the end of the sample.
export function pvGain(fen, pv, plies) {
  const g = new Chess(fen), me = g.turn(), start = materialFor(g, me), taken = [];
  let n = Math.min(pv.length, plies);
  if (n > 1 && n % 2) n--;
  for (const uci of pv.slice(0, n)) {
    let m;
    try { m = play(g, uci); } catch { break; }
    if (m.captured && m.color === me) taken.push(m);
  }
  return { gain: materialFor(g, me) - start, taken };
}

// What the side to move in a passFen() position is threatening: a short mate or a material win.
export function threatIn(fen, result) {
  const line = result?.lines?.[0];
  if (!line?.pv?.length) return null;
  const me = fen.split(' ')[1];
  let san;
  try { san = play(new Chess(fen), line.pv[0]).san; } catch { return null; }
  if (matesFor(me, line)) return Math.abs(line.mate) <= 5 ? { san, mate: Math.abs(line.mate), gain: 0 } : null;
  const { gain } = pvGain(fen, line.pv, 4);
  return gain >= 1 ? { san, mate: 0, gain } : null;
}

const threatText = (t) => (t.mate ? (t.mate === 1 ? 'checkmate' : `a forced mate in ${t.mate}`) : `winning ${worth(t.gain)}`);

// Enemy pieces the moved piece hits at once: the king, anything worth more, or anything undefended.
export function forkTargets(g, mv) {
  const out = [];
  for (const row of g.board()) {
    for (const p of row) {
      if (!p || p.color === mv.color || p.type === 'p') continue;
      if (!g.attackers(p.square, mv.color).includes(mv.to)) continue;
      const moved = VALUE[mv.promotion || mv.piece];
      if (p.type === 'k' || VALUE[p.type] > moved || g.attackers(p.square, p.color).length === 0) out.push(p);
    }
  }
  return out;
}

function positional(g, mv, fullmove, reachBefore) {
  const out = [], me = mv.color;
  const pawnsOn = (file, color) => g.board().flat().filter((p) => p && p.type === 'p' && p.color === color && p.square[0] === file);
  if (mv.san.startsWith('O-O')) out.push('It tucks your king away and brings the rook toward the centre.');
  if (mv.piece === 'b' && ['g2', 'b2', 'g7', 'b7'].includes(mv.to)) out.push(`Your bishop is fianchettoed: from ${mv.to} it influences the board along the long diagonal.`);
  if ('nb'.includes(mv.piece) && fullmove <= 15 && mv.from[1] === (me === 'w' ? '1' : '8')) out.push(`It develops your ${PIECE[mv.piece]} toward the action.`);
  if (mv.piece === 'p' && 'de'.includes(mv.to[0]) && '45'.includes(mv.to[1])) out.push('It takes space in the centre and opens lines for your pieces.');
  if (mv.piece === 'r' && mv.from[0] !== mv.to[0] && pawnsOn(mv.to[0], me).length === 0) {
    out.push(`It puts the rook on ${pawnsOn(mv.to[0], other(me)).length ? 'a half-open' : 'an open'} file, where it has room to work.`);
  }
  if (mv.piece === 'r' && mv.to[1] === (me === 'w' ? '7' : '2')) out.push('It puts the rook on your seventh rank, behind their pawns and next to their king.');
  if (mv.piece === 'k' && !mv.san.startsWith('O-O') && !g.board().flat().some((p) => p && p.type === 'q')) {
    const centre = (sq) => Math.abs('abcdefgh'.indexOf(sq[0]) - 3.5) + Math.abs(+sq[1] - 4.5);
    if (centre(mv.to) < centre(mv.from)) out.push('With the queens off the king is safe enough to fight: it heads for the centre.');
  }
  if ('nbrq'.includes(mv.piece)) {
    const now = reach(g, mv.to, me);
    if (now >= reachBefore + 3) out.push(`It activates your ${PIECE[mv.piece]}: it now covers ${now} squares instead of ${reachBefore}.`);
  }
  if (mv.piece === 'p') {
    const rank = +mv.to[1], f = 'abcdefgh'.indexOf(mv.to[0]);
    const ahead = (sq) => (me === 'w' ? +sq[1] > rank : +sq[1] < rank);
    const blockers = [f - 1, f, f + 1].filter((x) => x >= 0 && x < 8)
      .flatMap((x) => pawnsOn('abcdefgh'[x], other(me))).filter((p) => ahead(p.square));
    if (!blockers.length) out.push('It pushes a passed pawn: no enemy pawn can stop it from advancing.');
  }
  return out;
}

/**
 * Reasons Stockfish's move works, most important first.
 * line: the engine's line for the move. alt: next-best { san, evalText, gap } (gap = winning chances
 * given up, 0-100) or null. winNow: your winning chances with the move, 0-100. last: the opponent's
 * previous move (chess.js verbose) or null. threatNow / threatNext: threatIn() results.
 */
export function explainMove({ fen, line, alt, winNow, last, threatNow, threatNext }) {
  const g = new Chess(fen), me = g.turn(), them = other(me);
  if (g.moves().length === 1) return ['It is the only legal move.'];
  const ahead = materialFor(g, me);
  const fullmove = +fen.split(' ')[5];
  const reachBefore = reach(g, line.pv[0].slice(0, 2), me);
  const mv = play(g, line.pv[0]);
  if (matesFor(me, line)) return [Math.abs(line.mate) === 1 ? 'It is checkmate.' : `It forces checkmate in ${Math.abs(line.mate)}, whatever they reply.`];
  if (matesFor(them, line)) return [`Every move loses to a forced mate; this one holds out longest (mate in ${Math.abs(line.mate)}).`];

  const out = [];
  if (winNow < 20) out.push('You are in trouble either way; this is the toughest defence.');

  const owed = last?.captured ? VALUE[last.captured] : 0;   // they just took something: winning it back is not a gain
  const recapture = owed && mv.captured && mv.to === last.to;
  const { gain, taken } = pvGain(fen, line.pv, 8);
  const net = gain - owed;
  if (net >= 1 && taken.length) {
    const big = taken.reduce((a, m) => (VALUE[m.captured] > VALUE[a.captured] ? m : a));
    out.push(`It wins material: Stockfish's line takes the ${PIECE[big.captured]} on ${big.to}, and you end up ${net} point${net > 1 ? 's' : ''} ahead on the trades.`);
  } else if (recapture) {
    out.push(`It recaptures on ${mv.to}${net >= 0 ? ', keeping the material level' : ''}.`);
  } else if (owed && gain >= owed) {
    out.push('It wins the material back, just not by recapturing straight away.');
  } else if (gain <= -2 && winNow >= 35) {
    out.push(`It gives up ${worth(-gain)} on purpose: Stockfish sees enough activity in return, and the line below shows how.`);
  } else if (mv.captured && ahead >= 2 && net < 1) {
    out.push('You are ahead, so trading is good: with fewer pieces left, the extra material counts for more.');
  }
  if (mv.promotion) out.push(`It promotes the pawn to a ${PIECE[mv.promotion]}.`);

  const fork = forkTargets(g, mv).sort((a, b) => (b.type === 'k') - (a.type === 'k'));
  if (fork.length >= 2 && net >= 1) {
    out.push(`Your ${PIECE[mv.promotion || mv.piece]} on ${mv.to} hits the ${PIECE[fork[0].type]} and the ${PIECE[fork[1].type]} at once: that is a fork, and they can only save one.`);
  } else if (g.inCheck()) out.push('It comes with check, so they have to answer it before anything else.');

  // a mate threat that still worked would have returned above; a material one must really cost them less now
  if (threatNow && (threatNow.mate || pvGain(g.fen(), line.pv.slice(1), 4).gain < threatNow.gain)) out.push(`It deals with their threat: they were ready to play ${threatNow.san}, ${threatText(threatNow)}.`);
  if (threatNext) out.push(`You then threaten ${threatNext.san}, ${threatText(threatNext)}, so they have to respond.`);

  if (!out.length) {   // no tactic to report, so now the quiet reasons are the point
    out.push(...positional(g, mv, fullmove, reachBefore));
    if (!out.length) out.push('It wins nothing by force. Stockfish simply rates the position after it highest, and the line below shows the idea.');
  }

  if (alt) {
    if (alt.gap >= 15) out.push(`Nearly the only good move: the next best, ${alt.san} (${alt.evalText}), gives up about ${Math.round(alt.gap)}% of your winning chances.`);
    else if (alt.gap >= 5) out.push(`It is clearly better than the next best, ${alt.san} (${alt.evalText}).`);
    else out.push(`Not the only good move: ${alt.san} (${alt.evalText}) is about as strong.`);
  }
  return out;
}
