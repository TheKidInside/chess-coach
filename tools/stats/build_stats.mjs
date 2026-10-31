// Builds static/stats.json: how the repertoire scores in real games, and how those games end.
// Input is a Lichess open-database PGN (CC0, https://database.lichess.org), already decompressed.
// Usage: node tools/stats/build_stats.mjs <games.pgn> [--workers N] [--label "Lichess, Sep 2026"]
//
// For every position in the opening tree (each ply of each line, keyed like eco.json on the
// first four FEN fields, so transpositions count) it counts White wins / draws / Black wins.
// For every opening (family) it also records how the games that reached it ended: checkmate,
// resignation, time, the kind of draw, and whether it was over early, in the middlegame or in
// an endgame (and which endgame). Bullet games are skipped: they end on time too often to teach
// anything about the opening. Everything is split by the players' average rating.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Chess } from '../../static/vendor/chess.js';
import { FAMILIES, OPENINGS } from '../../static/openings.js';

export const BANDS = [[0, 1400, 'Under 1400'], [1400, 1800, '1400-1799'], [1800, 2200, '1800-2199'], [2200, 9999, '2200+']];
const HOW = ['mate', 'resign', 'time', 'stalemate', 'repetition', 'insufficient', 'fifty', 'agreed'];
const PHASE = ['early', 'middlegame', 'pawn', 'rook', 'minor', 'rookMinor', 'queen', 'queenOther', 'mixed'];
const EARLY_PLIES = 40;   // over by move 20

// Openings whose lines share too little to name them: count games from these positions instead.
const ANCHOR_OVERRIDE = {
  london: ['d4 d5 Bf4', 'd4 Nf6 Bf4'],
  najdorf: ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
};

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
function keyAfter(sans) {
  const g = new Chess();
  for (const s of sans) g.move(s);
  return posKey(g.fen());
}

function tree() {
  const keys = new Set([posKey(new Chess().fen())]);
  let maxPly = 0;
  for (const o of OPENINGS) {
    const g = new Chess();
    for (const s of o.moves) { g.move(s); keys.add(posKey(g.fen())); }
    maxPly = Math.max(maxPly, o.moves.length);
  }
  const anchors = {};   // family id -> [{ moves, key }]
  const line = new Map(OPENINGS.map((o) => [o.id, o]));
  for (const f of FAMILIES) {
    let seqs = ANCHOR_OVERRIDE[f.id]?.map((s) => s.split(' '));
    if (!seqs) {
      const ls = f.lines.map((id) => line.get(id)).filter((o) => o.kind !== 'transposition');
      let p = 0;
      while (ls.every((o) => o.moves[p] && o.moves[p] === ls[0].moves[p])) p++;
      seqs = [ls[0].moves.slice(0, p)];
    }
    anchors[f.id] = seqs.map((m) => ({ moves: m.join(' '), key: keyAfter(m) }));
  }
  return { keys, maxPly, anchors };
}

// ------------------------------------------------------------------ worker ---

const triple = () => [0, 0, 0];
function famBlock() {
  return BANDS.map(() => ({ res: triple(), how: Object.fromEntries(HOW.map((h) => [h, triple()])),
    end: Object.fromEntries(PHASE.map((p) => [p, triple()])), len: new Array(101).fill(0) }));
}

function phaseOf(board, plies) {
  const kinds = { q: 0, r: 0, m: 0 };
  let pieces = 0;
  for (const row of board) for (const sq of row) {
    if (!sq || sq.type === 'k' || sq.type === 'p') continue;
    pieces++;
    kinds[sq.type === 'q' ? 'q' : sq.type === 'r' ? 'r' : 'm']++;
  }
  // Lichess's divider (6 or fewer pieces besides kings and pawns = endgame), except that queens
  // plus several other pieces still play like a middlegame
  if (pieces > 6 || (kinds.q && pieces > 4)) return plies <= EARLY_PLIES ? 'early' : 'middlegame';
  if (!pieces) return 'pawn';
  if (kinds.q) return kinds.r || kinds.m ? 'queenOther' : 'queen';
  if (kinds.r) return kinds.m ? 'rookMinor' : 'rook';
  return kinds.m ? 'minor' : 'mixed';
}

function howOf(g, last, result, termination) {
  if (result !== 1) {   // decisive
    if (last.endsWith('#')) return 'mate';
    return termination === 'Time forfeit' ? 'time' : 'resign';
  }
  if (g.isStalemate()) return 'stalemate';
  if (g.isInsufficientMaterial() || termination === 'Insufficient material') return 'insufficient';
  if (g.isThreefoldRepetition()) return 'repetition';
  if (+g.fen().split(' ')[4] >= 100) return 'fifty';
  return termination === 'Time forfeit' ? 'insufficient' : 'agreed';   // timeout vs a lone king is scored a draw
}

function runWorker({ file, start, end, keys, maxPly, anchorKeys }) {
  const treeKeys = new Set(keys);
  const anchorOf = new Map();   // key -> [family ids]
  for (const [fid, ks] of Object.entries(anchorKeys)) for (const k of ks) {
    if (!anchorOf.has(k)) anchorOf.set(k, []);
    anchorOf.get(k).push(fid);
  }
  const pos = {}, fam = {};
  let games = 0, skipped = 0;

  function game(head, text) {
    const ev = head.Event || '';
    if (/Bullet|Correspondence/.test(ev) || !/^Rated/.test(ev)) { skipped++; return; }
    if (!['Normal', 'Time forfeit', 'Insufficient material'].includes(head.Termination)) { skipped++; return; }
    const result = { '1-0': 0, '1/2-1/2': 1, '0-1': 2 }[head.Result];
    const elo = (+head.WhiteElo + +head.BlackElo) / 2;
    if (result === undefined || !elo) { skipped++; return; }
    const band = BANDS.findIndex(([lo, hi]) => elo >= lo && elo < hi);
    const sans = text.replace(/\{[^}]*\}/g, ' ').split(/\s+/)
      .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
      .map((t) => t.replace(/[?!]+$/, ''));
    const g = new Chess();
    const seen = new Set();
    const hit = (k) => { if (treeKeys.has(k)) seen.add(k); };
    hit(posKey(g.fen()));
    try {
      for (let i = 0; i < sans.length; i++) {
        g.move(sans[i]);
        if (i < maxPly) hit(posKey(g.fen()));
      }
    } catch { skipped++; return; }
    games++;
    const fams = new Set();
    for (const k of seen) {
      (pos[k] ||= new Array(BANDS.length * 3).fill(0))[band * 3 + result]++;
      for (const fid of anchorOf.get(k) || []) fams.add(fid);
    }
    if (!fams.size) return;
    const how = howOf(g, sans[sans.length - 1] || '', result, head.Termination);
    const phase = phaseOf(g.board(), sans.length);
    const moves = Math.min(100, Math.ceil(sans.length / 2));
    for (const fid of fams) {
      const b = (fam[fid] ||= famBlock())[band];
      b.res[result]++;
      b.how[how][result]++;
      b.end[phase][result]++;
      b.len[moves]++;
    }
  }

  // The range starts on a game boundary; read it in chunks and cut before each [Event line.
  const SEP = '\n[Event ';
  function block(txt) {
    if (!txt.trim()) return;
    if (!txt.startsWith('[Event ')) txt = '[Event ' + txt;
    const head = {};
    let text = '';
    for (const line of txt.split('\n')) {
      if (line.startsWith('[')) { const m = /^\[(\w+) "(.*)"\]/.exec(line); if (m) head[m[1]] = m[2]; }
      else text += ' ' + line;
    }
    if (!/(1-0|0-1|1\/2-1\/2)\s*$/.test(text)) { skipped++; return; }   // a game cut off at the end of the file
    game(head, text);
  }
  const fd = openSync(file, 'r');
  const CHUNK = 1 << 24;
  const buf = Buffer.alloc(CHUNK);
  let at = start, rest = '';
  while (at < end) {
    const n = readSync(fd, buf, 0, Math.min(CHUNK, end - at), at);
    if (!n) break;
    at += n;
    const parts = (rest + buf.toString('latin1', 0, n)).split(SEP);
    rest = parts.pop();
    parts.forEach(block);
  }
  block(rest);
  closeSync(fd);
  return { pos, fam, games, skipped };
}

// -------------------------------------------------------------------- main ---

function mergeArr(a, b) { for (let i = 0; i < b.length; i++) a[i] += b[i]; }

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
  if (!file) { console.error('usage: node tools/stats/build_stats.mjs <games.pgn> [--workers N] [--label text]'); process.exit(1); }
  const workers = +opt('workers', Math.max(1, cpus().length - 2));
  const label = opt('label', 'Lichess open database');
  const size = statSync(file).size;
  const { keys, maxPly, anchors } = tree();
  const anchorKeys = Object.fromEntries(Object.entries(anchors).map(([f, a]) => [f, a.map((x) => x.key)]));

  // each worker owns the games whose [Event line begins inside its byte range
  const bounds = [];
  for (let i = 0; i <= workers; i++) bounds.push(Math.floor((size * i) / workers));
  const fd = openSync(file, 'r');
  const probe = Buffer.alloc(1 << 20);
  for (let i = 1; i < workers; i++) {   // move each boundary to the start of a game
    const n = readSync(fd, probe, 0, probe.length, bounds[i]);
    const at = probe.toString('latin1', 0, n).indexOf('\n[Event ');
    // no game starts here: the previous worker takes the rest (and bounds stay in order)
    bounds[i] = Math.max(bounds[i - 1], at < 0 ? size : bounds[i] + at + 1);
  }
  closeSync(fd);

  const t0 = Date.now();
  const parts = await Promise.all(bounds.slice(0, -1).map((start, i) => new Promise((ok, fail) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { file, start, end: bounds[i + 1], keys: [...keys], maxPly, anchorKeys } });
    w.on('message', ok);
    w.on('error', fail);
    w.on('exit', (code) => { if (code) fail(new Error(`worker ${i} exited with code ${code}`)); });
  })));

  const pos = {}, fam = {};
  let games = 0, skipped = 0;
  for (const p of parts) {
    games += p.games; skipped += p.skipped;
    for (const [k, v] of Object.entries(p.pos)) mergeArr(pos[k] ||= new Array(v.length).fill(0), v);
    for (const [f, bands] of Object.entries(p.fam)) {
      const into = (fam[f] ||= famBlock());
      bands.forEach((b, i) => {
        mergeArr(into[i].res, b.res);
        mergeArr(into[i].len, b.len);
        for (const h of HOW) mergeArr(into[i].how[h], b.how[h]);
        for (const e of PHASE) mergeArr(into[i].end[e], b.end[e]);
      });
    }
  }
  for (const f of Object.values(fam)) for (const b of f) {   // trim the length histogram to its used part
    let last = b.len.length - 1;
    while (last > 0 && !b.len[last]) last--;
    b.len = b.len.slice(0, last + 1);
  }

  const out = {
    meta: { source: label, games, bands: BANDS.map((b) => b[2]), how: HOW, phase: PHASE, earlyMoves: EARLY_PLIES / 2, anchors,
      note: 'Rated blitz, rapid and classical games (no bullet). Results are [White wins, draws, Black wins]; pos values are those three per rating band, flattened.' },
    pos, fam,
  };
  writeFileSync(new URL('../../static/stats.json', import.meta.url), JSON.stringify(out));
  console.log(`${games} games used, ${skipped} skipped, ${Object.keys(pos).length}/${keys.size} tree positions seen, ` +
    `${Object.keys(fam).length}/${FAMILIES.length} openings, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const f of FAMILIES) {
    const b = fam[f.id];
    const n = b ? b.reduce((s, x) => s + x.res[0] + x.res[1] + x.res[2], 0) : 0;
    console.log(`  ${f.id.padEnd(12)} ${String(n).padStart(7)} games  from ${anchors[f.id].map((a) => a.moves).join(' | ')}`);
  }
}

if (isMainThread) main();
else parentPort.postMessage(runWorker(workerData));
