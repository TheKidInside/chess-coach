// Builds static/explorer.json: what real players play in every common opening position, like the
// Lichess opening explorer but offline (the live explorer needs a token). Same input as
// build_stats.mjs: a decompressed Lichess open-database PGN (CC0, https://database.lichess.org).
// Usage: node --max-old-space-size=8192 tools/stats/build_explorer.mjs <games.pgn> [--workers N] [--plies 18] [--min 80]
//
// For every position in the first --plies plies of each game it counts the next move and the result,
// split by rating band (the same bands as stats.json). Positions seen in fewer than --min games are
// dropped, and so are moves under 1% of a position's games (keeping at most 8 moves per position).
//   pos[key] = [[san, w0, d0, b0, w1, d1, b1, ...per band], ...] most played first
// key = the first four FEN fields, as in eco.json and stats.json, so transpositions merge.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Chess } from '../../static/vendor/chess.js';
// same bands as build_stats.mjs (importing it would run its main)
const BANDS = [[0, 1400, 'Under 1400'], [1400, 1800, '1400-1799'], [1800, 2200, '1800-2199'], [2200, 9999, '2200+']];

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const W = BANDS.length * 3;

function runWorker({ file, start, end, plies }) {
  const pos = new Map();   // key -> Map(san -> counts[W])
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
      .slice(0, plies).map((t) => t.replace(/[?!]+$/, ''));
    const g = new Chess();
    const seen = [];
    try {
      for (const s of sans) {
        const k = posKey(g.fen());
        const m = g.move(s);
        seen.push([k, m.san]);
      }
    } catch { skipped++; return; }
    games++;
    for (const [k, san] of seen) {
      let moves = pos.get(k);
      if (!moves) pos.set(k, (moves = new Map()));
      let c = moves.get(san);
      if (!c) moves.set(san, (c = new Array(W).fill(0)));
      c[band * 3 + result]++;
    }
  }

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
    if (!/(1-0|0-1|1\/2-1\/2)\s*$/.test(text)) { skipped++; return; }
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
  // structured clone handles Maps; flatten to arrays to keep the message small
  return { games, skipped, pos: [...pos].map(([k, m]) => [k, [...m]]) };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
  if (!file) { console.error('usage: node tools/stats/build_explorer.mjs <games.pgn> [--workers N] [--plies 18] [--min 80]'); process.exit(1); }
  const workers = +opt('workers', Math.max(1, Math.min(8, cpus().length - 2)));
  const plies = +opt('plies', 18), min = +opt('min', 80);
  const label = opt('label', 'Lichess open database');
  const size = statSync(file).size;

  const bounds = [];
  for (let i = 0; i <= workers; i++) bounds.push(Math.floor((size * i) / workers));
  const fd = openSync(file, 'r');
  const probe = Buffer.alloc(1 << 20);
  for (let i = 1; i < workers; i++) {
    const n = readSync(fd, probe, 0, probe.length, bounds[i]);
    const at = probe.toString('latin1', 0, n).indexOf('\n[Event ');
    bounds[i] = Math.max(bounds[i - 1], at < 0 ? size : bounds[i] + at + 1);
  }
  closeSync(fd);

  const t0 = Date.now();
  const parts = await Promise.all(bounds.slice(0, -1).map((start, i) => new Promise((ok, fail) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { file, start, end: bounds[i + 1], plies }, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
    w.on('message', ok);
    w.on('error', fail);
    w.on('exit', (code) => { if (code) fail(new Error(`worker ${i} exited with code ${code}`)); });
  })));

  const all = new Map();
  let games = 0, skipped = 0;
  for (const p of parts) {
    games += p.games; skipped += p.skipped;
    for (const [k, moves] of p.pos) {
      let into = all.get(k);
      if (!into) all.set(k, (into = new Map()));
      for (const [san, c] of moves) {
        const t = into.get(san);
        if (!t) into.set(san, c);
        else for (let i = 0; i < W; i++) t[i] += c[i];
      }
    }
    p.pos = null;
  }

  const sum = (c) => c.reduce((a, x) => a + x, 0);
  const pos = {};
  for (const [k, moves] of all) {
    const rows = [...moves].map(([san, c]) => [san, ...c]);
    const n = rows.reduce((a, r) => a + sum(r.slice(1)), 0);
    if (n < min) continue;
    pos[k] = rows.filter((r) => sum(r.slice(1)) >= n * 0.01).sort((a, b) => sum(b.slice(1)) - sum(a.slice(1))).slice(0, 8);
  }
  const out = {
    meta: { source: label, games, plies, min, bands: BANDS.map((b) => b[2]),
      note: 'Rated blitz, rapid and classical games (no bullet). pos[key] = [[san, then White wins, draws, Black wins per rating band], ...], most played first.' },
    pos,
  };
  writeFileSync(new URL('../../static/explorer.json', import.meta.url), JSON.stringify(out));
  console.log(`${games} games, ${skipped} skipped, ${Object.keys(pos).length} positions kept of ${all.size}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (isMainThread) main();
else parentPort.postMessage(runWorker(workerData));
