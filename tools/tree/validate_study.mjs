// Usage: node tools/tree/validate_study.mjs <agent-output.json> [...]
// Validates opening-tree content against openings.js. File shape:
// { families: [{ id, name, side, idea, masters: [str], lines: [lineId, ...] }],
//   lines: { <lineId>: { branch, kind: main|variation|transposition, why: [str per ply], gm: {ply: str},
//            show: {ply: ["e2e4"]}, gambitPlies?: [ply], topic?: trap|mistake or a list such as ["line","trap"] (its sections; default Lines),
//            // existing ids (already in openings.js) may also carry notes: [...] to replace weak notes
//            // new ids also need: name, eco, level, idea, moves, notes; transpositions need joins } } }
// Training lines are read from the original 28-line repertoire (base_openings.js), not static/openings.js,
// which already holds the merged drafts; that keeps a rebuild from drafts repeatable.
const BASE = fileURLToPath(new URL('./base_openings.js', import.meta.url));
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../static/', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'vendor/chess.js').href);
const { OPENINGS } = await import(pathToFileURL(BASE).href);

let errors = 0;
const err = (m) => { errors++; console.log('ERROR ' + m); };
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const textOk = (where, s) => {
  if (typeof s !== 'string' || !s.trim()) return err(`${where}: empty or not a string`);
  if (/[\u2014\u2013]/.test(s)) err(`${where}: contains an em/en dash`);
  if (/["\u201c\u201d]/.test(s)) err(`${where}: contains double quotation marks (no quotes attributed to people)`);
};

const all = {};   // every line we know: existing + new from all files given
for (const o of OPENINGS) all[o.id] = { ...o, existing: true };
const files = process.argv.slice(2).map((f) => [f, JSON.parse(readFileSync(f, 'utf8'))]);
for (const [, data] of files) for (const [id, l] of Object.entries(data.lines || {})) if (!all[id]) all[id] = { ...l, id };

function positions(moves) {   // FEN keys after each ply, or null if a move is illegal
  const g = new Chess();
  const out = [key(g.fen())];
  for (const san of moves) { try { g.move(san); } catch { return null; } out.push(key(g.fen())); }
  return out;
}

for (const [file, data] of files) {
  const famLines = new Set();
  for (const f of data.families || []) {
    for (const k of ['id', 'name', 'idea']) textOk(`family ${f.id}.${k}`, f[k]);
    if (!['w', 'b'].includes(f.side)) err(`family ${f.id}: side must be w or b`);
    if (!Array.isArray(f.masters) || !f.masters.length) err(`family ${f.id}: masters must be a non-empty array`);
    (f.masters || []).forEach((s, i) => textOk(`family ${f.id}.masters[${i}]`, s));
    if (!Array.isArray(f.lines) || f.lines.length < 2) err(`family ${f.id}: needs at least 2 lines`);
    (f.lines || []).forEach((id, i) => {
      famLines.add(id);
      const l = all[id];
      if (!l) return err(`family ${f.id}: unknown line ${id}`);
      if (l.side && l.side !== f.side) err(`family ${f.id}: line ${id} is side ${l.side}`);
      const kind = data.lines?.[id]?.kind;
      if (i === 0 && kind !== 'main') err(`family ${f.id}: first line ${id} must be kind main`);
      if (i > 0 && kind === 'main') err(`family ${f.id}: only the first line may be main (${id})`);
    });
  }
  for (const [id, l] of Object.entries(data.lines || {})) {
    const ex = OPENINGS.find((o) => o.id === id);
    if (!famLines.has(id)) err(`${id}: not listed in any family in ${file}`);
    if (!['main', 'variation', 'transposition'].includes(l.kind)) err(`${id}: bad kind ${l.kind}`);
    textOk(`${id}.branch`, l.branch);
    if (l.topic !== undefined && ![].concat(l.topic).every((t) => ['line', 'trap', 'mistake'].includes(t))) err(`${id}: topic must be line, trap or mistake, or a list of them`);
    if (ex && l.moves) err(`${id}: existing line, do not send moves (they are fixed)`);
    const moves = ex ? ex.moves : l.moves;
    if (!ex) {
      for (const k of ['name', 'eco', 'idea']) textOk(`${id}.${k}`, l[k]);
      if (![1, 2, 3].includes(l.level)) err(`${id}: level must be 1, 2 or 3`);
      if (!Array.isArray(moves) || moves.length < 6) { err(`${id}: moves must have at least 6 plies`); continue; }
    }
    const pos = positions(moves);
    if (!pos) { err(`${id}: illegal move in moves`); continue; }
    const notes = l.notes || ex?.notes;
    if (!Array.isArray(notes) || notes.length !== moves.length) err(`${id}: notes has ${notes?.length} entries, line has ${moves.length}`);
    if (l.notes) l.notes.forEach((s, i) => textOk(`${id}.notes[${i}]`, s));
    if (!Array.isArray(l.why) || l.why.length !== moves.length) err(`${id}: why has ${l.why?.length} entries, line has ${moves.length}`);
    (l.why || []).forEach((s, i) => textOk(`${id}.why[${i}] ${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${moves[i]}`, s));
    for (const [k, s] of Object.entries(l.gm || {})) {
      if (!(Number.isInteger(+k) && +k >= 0 && +k < moves.length)) err(`${id}.gm: bad ply ${k}`);
      textOk(`${id}.gm[${k}]`, s);
    }
    const g = new Chess();
    const boards = moves.map((san) => { g.move(san); return new Chess(g.fen()); });
    for (const [k, arrows] of Object.entries(l.show || {})) {
      const b = boards[+k];
      if (!b) { err(`${id}.show: bad ply ${k}`); continue; }
      for (const a of arrows) {
        if (!/^[a-h][1-8][a-h][1-8]$/.test(a) || a.slice(0, 2) === a.slice(2)) { err(`${id}.show[${k}]: bad arrow ${a}`); continue; }
        if (!b.get(a.slice(0, 2))) err(`${id}.show[${k}]: arrow ${a} starts on an empty square`);
      }
    }
    if (l.kind === 'transposition') {
      const target = all[l.joins];
      if (!target) { err(`${id}: transposition needs joins: <existing or new line id>`); continue; }
      const tpos = positions(target.moves || []);
      const hit = tpos && pos.findIndex((p, i) => i > 0 && tpos.includes(p)
        && moves.slice(0, i).join() !== target.moves.slice(0, tpos.indexOf(p)).join());
      if (!(hit > 0)) err(`${id}: never reaches a position of ${l.joins} by a different move order`);
      else console.log(`  ${id}: joins ${l.joins} after its ply ${hit - 1} (= ply ${tpos.indexOf(pos[hit]) - 1} of ${l.joins})`);
    }
    console.log(`ok-checked ${id} (${l.kind}, ${moves.length} plies)`);
  }
}
const ids = new Set();
for (const [, data] of files) for (const id of Object.keys(data.lines || {})) { if (ids.has(id)) err(`duplicate line id ${id} across files`); ids.add(id); }
console.log(errors ? `${errors} error(s)` : 'all good');
process.exit(errors ? 1 : 0);
