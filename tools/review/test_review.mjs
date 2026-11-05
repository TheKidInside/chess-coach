// Runs the review core against real Stockfish (server.py must be up: CHESS_PORT=8766).
// Calibration: the game in Kevin's Chess.com screenshot, 2026-11-03. Its first two moves were off screen,
// so they are worked out from the moves that follow.
//   node tools/review/test_review.mjs [--words]
import { readFileSync } from 'node:fs';
import { parsePgnFile, analyseGame, classifyGame, summarise, trapIndex, findTraps, momentsOf, moveNum, mateWords, lineQuality, labelMove } from '../../static/review.js';
import { commentFor, toSpeech } from '../../static/review-words.js';
import { OPENINGS } from '../../static/openings.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8766';
const eco = JSON.parse(readFileSync(new URL('../../static/eco.json', import.meta.url)));
const search = async (fen, movetime, multipv) => {
  const r = await fetch(`${BASE}/api/analyse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen, movetime, multipv }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

// Chess.com download format: clock comments, Link header, CRLF.
const CHESSCOM = `[Event "Live Chess"]\r\n[Site "Chess.com"]\r\n[Date "2026.11.02"]\r\n[White "KevinC"]\r\n[Black "Opp1"]\r\n[Result "0-1"]\r\n[WhiteElo "812"]\r\n[BlackElo "840"]\r\n[TimeControl "600"]\r\n[Link "https://www.chess.com/game/live/1"]\r\n\r\n` +
  `1. d4 {[%clk 0:09:58.9]} 1... Nc6 {[%clk 0:09:59.1]} 2. Bf4 {[%clk 0:09:55]} 2... g6 {[%clk 0:09:57]} 3. e3 {[%clk 0:09:50]} 3... Bg7 {[%clk 0:09:55]} 4. Nf3 Nf6 5. Bc4 O-O 6. c3 Na5 7. Nbd2 c6 8. a4 d5 9. Bd3 Bf5 10. Bxf5 gxf5 11. Ne5 Ng4 12. h3 Nxe5 13. Bxe5 Qb6 14. Bxg7 Kxg7 15. Qc2 Nc4 16. Nxc4 dxc4 0-1\r\n`;
const TWO = CHESSCOM + '\r\n\r\n' + `[Event "Live Chess"]\r\n[White "Opp2"]\r\n[Black "KevinC"]\r\n[Result "1-0"]\r\n\r\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0\r\n`;

const parsed = parsePgnFile(TWO);
check(parsed.games.length === 2 && !parsed.errors.length, `multi-game file with clocks and CRLF parses (${parsed.games.length} games, ${parsed.errors.length} errors)`);
check(parsed.games[0].headers.White === 'KevinC', 'headers survive');
check(parsed.games[0].id !== parsed.games[1].id, 'games get different ids');
check(parsePgnFile(TWO).games[0].id === parsed.games[0].id, 'same game keeps its id');
check(parsePgnFile('not a game').games.length === 0, 'junk text gives no games');
check(parsePgnFile('[Site "x"]\n[Event "y"]\n[White "A"]\n\n1. e4 e5 1-0\n\n[Site "x"]\n[Event "z"]\n\n1. d4 d5 0-1\n').games.length === 2, 'games split when Site comes before Event');
check(parsePgnFile('1. e4 e5 1-0\n\n1. d4 d5 0-1\n').games.length === 2, 'tagless games split');
check(parsePgnFile('[White "O\\"Brien"]\n\n1. e4 *').games.length === 1, 'escaped quote in a name parses');
const fenGame = parsePgnFile('[FEN "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 30"]\n[SetUp "1"]\n\n30... h6 31. Rd8+ Kh7 *').games[0];
check(moveNum(fenGame.moves[0]) === '30...' && moveNum(fenGame.moves[1]) === '31.', `FEN start keeps real move numbers: ${moveNum(fenGame.moves[0])} ${moveNum(fenGame.moves[1])}`);

check(toSpeech('Bxf5 and gxf5, e8=Q+, O-O, Nbd2, Rxe8# but e4 too') === 'bishop takes f5 and g takes f5, e8 promotes to queen check, castles, knight b d2, rook takes e8 checkmate but e4 too', `speech: ${toSpeech('Bxf5 and gxf5, e8=Q+, O-O, Nbd2, Rxe8# but e4 too')}`);

// Line symbols and mate words: scores are from White's view, whichever side is to move.
const W = '4k3/8/8/8/8/8/8/4K3 w - - 0 1', B = '4k3/8/8/8/8/8/8/4K3 b - - 0 1';
check(mateWords({ mate: 3 }) === 'White mates in 3' && mateWords({ mate: -2 }) === 'Black mates in 2' && mateWords({ cp: 50 }) === '', 'mate words name the side');
check(lineQuality([{ cp: 100 }, { cp: 95 }, { cp: 40 }], W).join() === 'best,excellent,good', `white lines: ${lineQuality([{ cp: 100 }, { cp: 95 }, { cp: 40 }], W)}`);
check(lineQuality([{ cp: -100 }, { cp: -95 }, { cp: 300 }], B).join() === 'best,excellent,mistake', `black lines read from Black's side: ${lineQuality([{ cp: -100 }, { cp: -95 }, { cp: 300 }], B)}`);
check(lineQuality([{ mate: 2 }, { mate: 4 }, { cp: 500 }], W).join() === 'best,excellent,miss', `dropping a mate while still winning is a miss: ${lineQuality([{ mate: 2 }, { mate: 4 }, { cp: 500 }], W)}`);
check(lineQuality([{ mate: 8 }, { cp: 1500 }], W)[1] !== 'miss', 'a mate that far off is not a miss, as in classifyGame');
check(lineQuality([{ cp: 0 }, { mate: -2 }], W)[1] === 'blunder', 'a line that gets you mated is a blunder');
const scholars = parsePgnFile('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0').games[0].moves.slice(5);
const nf6Before = { bestmove: 'g7g6', lines: [{ cp: 40, pv: ['g7g6'] }] };
const toMate = { bestmove: 'h5f7', lines: [{ mate: 1, pv: ['h5f7'] }, { cp: -200, pv: ['h5d1'] }] };
check(labelMove(scholars, [nf6Before, toMate, null]).cls === 'best', `punishing a blunder with mate is best, not great: ${labelMove(scholars, [nf6Before, toMate, null]).cls}`);

const game = parsed.games[0];
const evals = await analyseGame(game, search, { speed: 'deep', eco });
const plies = classifyGame(game, evals, { eco });
const row = plies.map((p) => `${String(Math.floor(p.ply / 2) + 1).padStart(2)}${p.ply % 2 ? '...' : '.  '} ${p.san.padEnd(6)} ${p.cls.padEnd(11)} loss ${String(p.loss).padEnd(5)} ${p.theme || ''}`);
console.log(row.join('\n'));

// What the screenshot showed. 'best' there is a star on some moves; Excellent has no icon in its move list.
const shot = { 'Bg7': ['excellent', 'best', 'book', 'good'], 'Bxf5': ['best', 'excellent'], 'Ng4': ['mistake', 'inaccuracy', 'blunder'], 'h3': ['miss'], 'Qb6': ['mistake', 'inaccuracy'], 'Bxg7': ['best', 'excellent'], 'Nxc4': ['best', 'excellent'] };
for (const [san, want] of Object.entries(shot)) {
  const p = plies.find((x) => x.san === san);
  check(want.includes(p.cls), `Chess.com ${want[0]} on ${san}: ours ${p.cls} (loss ${p.loss})`);
}
const s = summarise(plies);
check(s.w.acc !== null && s.b.acc !== null, `accuracy W ${s.w.acc} B ${s.b.acc}`);

// A library trap: the Scholar-style lines depend on data; use the line itself so this stays true when lines change.
const index = trapIndex(OPENINGS);
check(index.size > 50, `trap index has ${index.size} positions`);
const line = OPENINGS.find((o) => o.id === 'qgd-qga-trap');
const trapGame = parsePgnFile(line.moves.reduce((a, m, i) => a + (i % 2 ? '' : `${i / 2 + 1}. `) + m + ' ', '') + '*').games[0];
const te = await analyseGame(trapGame, search, { speed: 'fast', eco });
const tp = classifyGame(trapGame, te, { eco });
const tw = await findTraps(trapGame, tp, index, 'w');
const tb = await findTraps(trapGame, tp, index, 'b');
console.log('trap line labels', tp.map((p) => `${p.san}:${p.cls}`).join(' '));
check(tw.some((t) => t.kind === 'sprung'), `playing the trap as White: ${JSON.stringify(tw.map((t) => t.kind))}`);
check(tb.some((t) => t.kind === 'fell'), `falling for it as Black: ${JSON.stringify(tb.map((t) => t.kind))}`);

for (const you of ['w', 'b']) {
  const m = momentsOf(game, plies, [], you);
  check(m.every((x) => x.fen && x.label), `moments for ${you}: ${m.map((x) => `${x.label} ${x.cls}`).join(', ') || 'none'}`);
}
if (process.argv.includes('--words')) {
  plies.forEach((p, i) => {
    const c = commentFor(i, { you: 'w', plies, evals, game });
    console.log(`\n${p.ply}. ${c.head}\n   ${c.text}\n   SPOKEN: ${toSpeech(`${c.head}. ${c.text}`)}`);
  });
}
// A real brilliancy, and a long game for timing: Kasparov-Topalov, Wijk aan Zee 1999.
const KT = '1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Be3 Bg7 5.Qd2 c6 6.f3 b5 7.Nge2 Nbd7 8.Bh6 Bxh6 9.Qxh6 Bb7 10.a3 e5 11.O-O-O Qe7 12.Kb1 a6 13.Nc1 O-O-O 14.Nb3 exd4 15.Rxd4 c5 16.Rd1 Nb6 17.g3 Kb8 18.Na5 Ba8 19.Bh3 d5 20.Qf4+ Ka7 21.Rhe1 d4 22.Nd5 Nbxd5 23.exd5 Qd6 24.Rxd4 cxd4 25.Re7+ Kb6 26.Qxd4+ Kxa5 27.b4+ Ka4 28.Qc3 Qxd5 29.Ra7 Bb7 30.Rxb7 Qc4 31.Qxf6 Kxa3 32.Qxa6+ Kxb4 33.c3+ Kxc3 34.Qa1+ Kd2 35.Qb2+ Kd1 36.Bf1 Rd2 37.Rd7 Rxd7 38.Bxc4 bxc4 39.Qxh8 Rd3 40.Qa8 c3 41.Qa4+ Ke1 42.f4 f5 43.Kc1 Rd2 44.Qa7 1-0';
const kt = parsePgnFile(KT).games[0];
const t0 = Date.now();
const ke = await analyseGame(kt, search, { speed: 'standard', eco });
const kp = classifyGame(kt, ke, { eco });
console.log(`${kt.moves.length} plies in ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(kp.filter((p) => !['book', 'best', 'excellent', 'good'].includes(p.cls)).map((p) => `${Math.floor(p.ply / 2) + 1}${p.ply % 2 ? '...' : '.'}${p.san}:${p.cls}(${p.loss})`).join(' '));
const rxd4 = kp.find((p) => p.san === 'Rxd4' && p.ply === 46);
check(['brilliant', 'great'].includes(rxd4.cls), `24.Rxd4: ${rxd4.cls}`);
for (let i = 0; i < kp.length; i++) commentFor(i, { you: 'w', plies: kp, evals: ke, game: kt });
const cxd4 = commentFor(46, { you: 'w', plies: kp, evals: ke, game: kt });
console.log(cxd4.head, '|', cxd4.text);
console.log(JSON.stringify(evals).length, 'bytes of evals');
console.log(bad ? `${bad} FAILED` : 'ALL OK');
process.exit(bad ? 1 : 0);
