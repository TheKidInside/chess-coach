// The coach's words for a reviewed move. Every sentence is worked out from the board and Stockfish's
// lines, never from an LLM, so it can be plain but it can't invent a tactic (same rule as why.js).
// Sentences are written from the mover's side as "you", then swapped when the opponent moved.
import { Chess } from './vendor/chess.js';
import { PIECE, VALUE, explainMove, pvGain, forkTargets } from './why.js';
import { pinOf, winWhite, themeWords } from './review.js';

const SWAP = { you: 'they', your: 'their', they: 'you', their: 'your', them: 'you', You: 'They', Your: 'Their', They: 'You', Their: 'Your', Them: 'You' };
export const swapSides = (s) => s.replace(/\b(you|your|they|their|them|You|Your|They|Their|Them)\b/g, (w) => SWAP[w]);
const mateWords = (n) => (n === 1 ? 'mate in one' : `mate in ${n}`);
const worth = (n) => (n >= 8 ? 'about a queen' : n >= 5 ? 'about a rook' : n >= 3 ? 'a piece' : n === 2 ? 'two pawns' : 'a pawn');
const play = (g, uci) => g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const sanOf = (fen, uci) => { try { return play(new Chess(fen), uci).san; } catch { return null; } };

export function evalWords(e, fen) {
  if (e.over === 'mate') return 'Checkmate.';
  if (e.over === 'draw') return 'The game is drawn.';
  if (e.mate !== undefined && e.mate !== 0) return `${e.mate > 0 ? 'White' : 'Black'} has a forced ${mateWords(Math.abs(e.mate))}.`;
  const w = winWhite(e, fen), lead = w >= 50 ? 'White' : 'Black', d = Math.abs(w - 50);
  if (d < 6) return 'The position is about equal.';
  return `${lead} ${d < 16 ? 'is slightly better' : d < 32 ? 'is clearly better' : 'is winning'}.`;
}

const HEAD = {
  brilliant: 'is brilliant', great: 'is a great move', best: 'is the best move', excellent: 'is excellent', good: 'is good',
  book: 'is a book move', forced: 'is the only move', inaccuracy: 'is an inaccuracy', mistake: 'is a mistake', miss: 'is a miss', blunder: 'is a blunder',
};

// Reasons for a move, using why.js on the line that starts with it. Those were written for the
// engine's own top move, so the wilder ones are checked here: a "win" needs the eval to agree, a
// "sacrifice" is only ever said about one, and a capture's threat is usually just being recaptured.
function reasons(mv, line, winNow, ev, last) {
  const cp = line.mate !== undefined ? (line.mate > 0 ? 9999 : -9999) : line.cp ?? 0;
  const moverCp = mv.color === 'w' ? cp : -cp;
  const out = explainMove({ fen: mv.before, line, alt: null, winNow, last, threatNow: ev.threat || null, threatNext: ev.nextThreat || null });
  const recaptured = out.some((r) => r.includes('recaptures'));
  const captures = line.pv[0] && new Chess(mv.before).moves({ verbose: true }).find((m) => m.from + m.to === line.pv[0].slice(0, 4))?.captured;
  const fianchetto = out.some((r) => r.includes('fianchettoed'));
  const develops = out.some((r) => r.startsWith('It develops'));
  return out.map((r) => {   // why.js names the biggest capture in the line, which can be a mere queen trade
    const won = r.startsWith('It wins material') && r.match(/end up (\d+) point/);
    return won ? `It wins ${worth(+won[1])} in Stockfish's line.` : r;
  }).filter((r) => !/^It wins nothing/.test(r)
    && !/on purpose/.test(r)
    && !(r.startsWith("It wins ") && r.endsWith("Stockfish's line.") && moverCp < 70)
    && !(captures && r.includes('You then threaten'))
    && !(recaptured && r.includes('deals with'))
    && !(fianchetto && r.startsWith('It develops'))
    && !((develops || fianchetto) && r.startsWith('It activates')));
}

function badStory(p, mv, evals, i, last, prevPly) {
  const before = evals[i], after = evals[i + 1];
  const out = [];
  const replyUci = after.pv?.[0], replySan = replyUci && sanOf(mv.after, replyUci);
  const allowsMate = after.mate !== undefined && after.mate !== 0 && (mv.color === 'w') !== (after.mate > 0);

  if (p.cls === 'miss') {
    if (before.mate !== undefined && (mv.color === 'w') === (before.mate > 0)) out.push(`It lets ${mateWords(Math.abs(before.mate))} slip away.`);
    else if (prevPly && prevPly.loss >= 10 && last) out.push(`Their ${last.san} was a slip, and this lets it go unpunished.`);
    else out.push('There was something to take here.');
  } else if (allowsMate) {
    out.push(`It allows ${replySan}, and they have ${mateWords(Math.abs(after.mate))}.`);
  } else if (replyUci) {
    const gain = pvGain(mv.after, after.pv, 6).gain - (mv.captured ? VALUE[mv.captured] : 0);
    const g = new Chess(mv.after), r = play(g, replyUci), fork = forkTargets(g, r);
    if (gain >= 1 && fork.length >= 2) out.push(`${replySan} forks your ${PIECE[fork[0].type]} and ${PIECE[fork[1].type]}, and you lose ${worth(gain)}.`);
    else if (r.captured && r.to === p.to && gain >= VALUE[r.captured]) out.push(`The ${PIECE[r.captured]} on ${r.to} is simply taken by ${replySan}.`);
    else if (gain >= 1 && before.threat?.san === replySan) out.push(`They were already threatening ${replySan}, and this does nothing about it. It costs ${worth(gain)}.`);
    else if (gain >= 1) out.push(`${replySan} wins ${worth(gain)}.`);
    else out.push(`Nothing is lost at once, but it gives up about ${Math.round(p.loss)}% of your winning chances. Expect ${replySan}.`);
  }

  if (p.bestSan && before.pv?.length) {
    const gi = new Chess(mv.before), best = play(gi, before.best);
    const line = { pv: before.pv, ...(before.mate !== undefined ? { mate: before.mate } : { cp: before.cp }) };
    let why = [];
    try { why = reasons(mv, line, mv.color === 'w' ? winWhite(before, mv.before) : 100 - winWhite(before, mv.before), { threat: before.threat }, last); } catch { /* the words are optional */ }
    const pin = pinOf(gi, best);
    const reason = why.find((r) => !r.startsWith('It activates'));
    const pinLine = pin && !reason ? `It pins the ${PIECE[pin.piece.type]} to the ${PIECE[pin.behind.type]}.` : '';
    out.push(`Better was ${p.bestSan}.${reason ? ` ${reason}` : pinLine ? ` ${pinLine}` : ''}`);
  }
  return out.join(' ');
}

function goodStory(p, mv, evals, i, last, plies) {
  const before = evals[i], after = evals[i + 1];
  if (p.cls === 'forced') return 'There was nothing else to play.';
  const line = { pv: [p.uci, ...(after.pv || [])], ...(after.mate !== undefined ? { mate: after.mate } : after.over === 'mate' ? { mate: mv.color === 'w' ? 1 : -1 } : { cp: after.cp ?? 0 }) };
  const winNow = mv.color === 'w' ? winWhite(after, mv.after) : 100 - winWhite(after, mv.after);
  const altWin = before.alt ? (mv.color === 'w' ? winWhite(before.alt, mv.before) : 100 - winWhite(before.alt, mv.before)) : null;
  let why = [];
  try { why = reasons(mv, line, winNow, { threat: before.threat, nextThreat: after.threat ? after.threat : null }, last); } catch { /* the words are optional */ }
  const head = [];
  if (p.cls === 'brilliant') head.push(`A sacrifice: it leaves material en prise on purpose, and Stockfish rates it best or nearly best.`);
  if (p.cls === 'great' && altWin !== null) {
    const altSan = sanOf(mv.before, before.alt.uci);
    head.push(`Nearly the only good move: the next best${altSan ? `, ${altSan},` : ''} gives up about ${Math.round(Math.max(0, winNow - altWin))}% of your winning chances.`);
  }
  if (p.cls === 'good' && p.bestSan) head.push(`${p.bestSan} was a little stronger.`);
  const prev = plies[i - 1];
  if (prev && prev.loss >= 10 && p.loss <= 2 && last) head.push(`It punishes their ${last.san}.`);
  return [...head, ...why.slice(0, 2)].join(' ');
}

/** Opening commentary for book moves, from the app's own (not Lichess-imported) lines: "<position>|<san>" -> note. */
export function bookNotes(openings) {
  const out = new Map();
  for (const o of openings) {
    if (o.source || String(o.id).startsWith('ls-') || !o.notes) continue;
    const trap = [].concat(o.topic || []).some((t) => t === 'trap' || t === 'mistake');
    const g = new Chess();
    o.moves.forEach((san, i) => {
      let m;
      try { m = g.move(san); } catch { return; }
      const k = `${m.before.split(' ').slice(0, 4).join(' ')}|${m.san}`;
      if (o.notes[i] && (!out.has(k) || (out.get(k).trap && !trap))) out.set(k, { note: o.notes[i], side: o.side, trap });
    });
  }
  return out;
}

/**
 * The bubble for move i: { head, text }. opts: { you, plies, evals, game, bookNote, trapsAt }.
 * Everything comes back from the mover's side, then swapped if that isn't you.
 */
export function commentFor(i, { you, plies, evals, game, bookNote, trapsAt = [] }) {
  const p = plies[i], mv = game.moves[i], after = evals[i + 1], last = game.moves[i - 1] || null, prevPly = plies[i - 1] || null;
  let text;
  if (p.cls === 'book') text = bookNote || 'Known opening theory.';
  else if (['inaccuracy', 'mistake', 'miss', 'blunder'].includes(p.cls)) text = badStory(p, mv, evals, i, last, prevPly);
  else text = goodStory(p, mv, evals, i, last, plies);
  for (const t of trapsAt) text += ` ${trapSentence(t)}`;
  if (p.color !== you && p.cls !== 'book') text = swapSides(text);   // a book note already speaks to the reader
  if (after.over && !/checkmate\.$/i.test(text)) text += ` ${evalWords(after, mv.after)}`;
  else if (p.cls !== 'book' && !text.trim()) text = evalWords(after, mv.after);
  return { head: `${p.san} ${HEAD[p.cls]}`, text: text.trim() };
}

function trapSentence(t) {
  return {
    fell: `That is the bait in the ${t.name}: you walked into it.`,
    sprung: `This is the point of the ${t.name}, and it works.`,
    missed: `They had stepped into the ${t.name}, and ${t.san || 'the follow-up'} would have punished it.`,
    avoided: `You stepped around the ${t.name} here: ${t.san} is the move it hopes for.`,
    'could-set': `You could have set the ${t.name} with ${t.san}, hoping for ${t.bait}.`,
  }[t.kind] || '';
}

/** Spoken English for a sentence: "Bxf5" should sound like "bishop takes f5". */
const NAMES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
export function toSpeech(text) {
  return String(text)
    .replace(/\bO-O-O\b[+#]?/g, 'castles queenside')
    .replace(/\bO-O\b[+#]?/g, 'castles')
    .replace(/\b([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=([QRBN]))?([+#])?(?![\w])/g, (m, piece, ff, fr, x, to, _p, promo, mark) => {
      if (!piece && !x && !ff && !fr && !promo && !mark) return to;
      const who = piece ? NAMES[piece] : (ff || '');
      const from = piece && (ff || fr) ? ` ${ff || ''}${fr || ''}` : '';
      return [who + from, x ? 'takes' : '', to, promo ? `promotes to ${NAMES[promo]}` : '', mark === '+' ? 'check' : mark === '#' ? 'checkmate' : ''].filter(Boolean).join(' ');
    })
    .replace(/(\d+)\.\.\./g, 'move $1 for Black,')
    .replace(/\+(\d)/g, 'plus $1')
    .replace(/%/g, ' percent');
}

export { themeWords };
