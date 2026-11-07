// Usage: node tools/tree/write_lines.mjs [--todo] [--write]
// Bulk opening trees: moves live in drafts-src/moves.json, the words in drafts-src/*.txt, and each
// (position, move) is explained once. A line reuses any note already written for the same move from
// the same position, in this source or in the current repertoire, so shared moves and transpositions
// need no repeating. Source blocks, in the order the lines should be listed:
//   @<lineId> | <level 1-3> | <branch label> | <idea sentence>
//   Bd6: short note || optional longer why
// --src <folder> uses another source folder with the same files (default drafts-src/).
// --todo prints, per line, the plies that still need words. --write produces add_lines input in
// drafts-src/lines.gen.json (no notes missing, or it refuses); run add_lines.mjs on it next.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../static/', import.meta.url));
const { Chess } = await import(pathToFileURL(root + 'vendor/chess.js').href);
const { OPENINGS, FAMILIES } = await import(pathToFileURL(root + 'openings.js').href);
const { STUDY } = await import(pathToFileURL(root + 'study.js').href);
const ECO = JSON.parse(readFileSync(root + 'eco.json', 'utf8'));
const args = process.argv.slice(2);
const srcName = args.includes('--src') ? args[args.indexOf('--src') + 1].replace(/\/?$/, '/') : 'drafts-src/';
const src = here + srcName;
const planned = JSON.parse(readFileSync(src + 'moves.json', 'utf8')).lines;
const familyOf = JSON.parse(readFileSync(src + 'families.json', 'utf8'));

const key = (f) => f.split(' ').slice(0, 4).join(' ');
const pairs = (moves) => {        // [{ ply, san, id }] where id names the move from that position
  const g = new Chess();
  return moves.map((m) => { const k = key(g.fen()); const mv = g.move(m); return { san: mv.san, id: `${k}|${mv.san}` }; });
};

const clean = (s) => s.replace(/ [—–] /g, ': ');   // older notes still use dashes; the validator rejects them
const said = new Map();           // (position, move) -> { note, why }
// The same words, kept per repertoire colour: a line borrows words from a line of its own colour
// first, so "you" means the student's side (a Petrov line through a Scotch position shouldn't
// tell Black to "trade first").
const sideOf = (fam) => FAMILIES.find((f) => f.id === fam)?.side;
const sided = new Map();          // `${side}|${position|move}` -> { note, why }
const remember = (side, id, words) => {
  if (!said.has(id)) said.set(id, words);
  if (side && !sided.has(`${side}|${id}`)) sided.set(`${side}|${id}`, words);
};
for (const o of OPENINGS) {
  if (planned[o.id]) continue;
  pairs(o.moves).forEach((p, i) => remember(sideOf(o.family), p.id, { note: clean(o.notes[i]), why: clean(STUDY[o.id]?.why?.[i] || o.notes[i]) }));
}
// Fallback words per group + colour + SAN, for routine moves (drafts-src/glossary-<group>.gloss).
const gloss = new Map();
for (const f of readdirSync(src).filter((x) => x.endsWith('.gloss'))) {
  const group = f.replace(/^glossary-|\.gloss$/g, '');
  for (const raw of readFileSync(src + f, 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^([wb]) (\S+?): (.*)$/);
    if (m) gloss.set(`${group}|${m[1]}|${m[2]}`, m[3]);
  }
}
const groupOf = (fam) => (fam.startsWith('london') ? 'london' : fam === 'jobava' ? 'jobava' : 'caro');

// Read the words.
const blocks = [];
const dir = src;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
  let cur = null;
  readFileSync(dir + f, 'utf8').split(/\r?\n/).forEach((raw, n) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    if (t.startsWith('@')) {
      const [id, level, branch, idea] = t.slice(1).split('|').map((s) => s.trim());
      cur = { id, level: +level, branch, idea, says: [], at: `${f}:${n + 1}` };
      blocks.push(cur);
      return;
    }
    const m = t.match(/^(\S+?):\s+(.*)$/);
    if (!cur || !m) throw new Error(`${f}:${n + 1}: cannot read: ${t}`);
    const [note, why] = m[2].split('||').map((s) => s.trim());
    cur.says.push({ san: m[1], note, why: why || note });
  });
}

let problems = 0;
const out = {};
const authored = new Map(blocks.map((b) => [b.id, b]));
const order = [...authored.keys(), ...Object.keys(planned).filter((id) => !authored.has(id))];
// A line's own notes go in first, so every line through that position shows them.
for (const b of blocks) {
  const line = planned[b.id];
  if (!line) { console.log(`ERROR ${b.at}: ${b.id} is not in moves.json`); problems++; continue; }
  const ps = pairs(line.moves.trim().split(/\s+/));
  for (const s of b.says) {
    const side = sideOf(familyOf[b.id] || line.family);
    const hit = ps.find((p) => p.san === s.san && !said.has(p.id));
    if (!hit) { console.log(`ERROR ${b.at}: ${b.id}: ${s.san} matches no unexplained move of the line`); problems++; continue; }
    sided.set(`${side}|${hit.id}`, { note: s.note, why: s.why });
    if (!said.has(hit.id)) said.set(hit.id, { note: s.note, why: s.why });
  }
}
for (const id of order) {
  const line = planned[id];
  const b = authored.get(id);
  if (!line) continue;
  const ps = pairs(line.moves.trim().split(/\s+/));
  const group = groupOf(familyOf[id] || line.family);
  ps.forEach((p, i) => {
    const words = !said.has(p.id) && gloss.get(`${group}|${i % 2 ? 'b' : 'w'}|${p.san}`);
    if (words) said.set(p.id, { note: words, why: words });
  });
  const todo = ps.filter((p) => !said.has(p.id));
  if (!b || todo.length) {
    problems++;
    if (args.includes('--todo')) console.log(`${id} [${familyOf[id] || line.family}] ${ps.map((p, i) => `${i % 2 ? '' : `${i / 2 + 1}.`}${said.has(p.id) ? p.san : `[${p.san}]`}`).join(' ')}`);
    continue;
  }
  const g = new Chess();
  let eco = 'A40';
  for (const p of ps) { g.move(p.san); const e = ECO[key(g.fen())]; if (e) eco = e[0]; }
  const famId = familyOf[id] || line.family;
  const fam = FAMILIES.find((f) => f.id === famId);
  out[id] = {
    family: famId, branch: b.branch, kind: line.kind || 'variation', name: `${(fam?.name || familyOf.$names[famId])}: ${b.branch}`, eco, level: b.level, idea: b.idea,
    moves: ps.map((p) => p.san).join(' '),
    notes: ps.map((p) => (sided.get(`${fam?.side}|${p.id}`) || said.get(p.id)).note),
    why: ps.map((p) => (sided.get(`${fam?.side}|${p.id}`) || said.get(p.id)).why),
    ...(line.topic ? { topic: line.topic } : {}),
    ...(line.gambitPlies ? { gambitPlies: line.gambitPlies } : {}),
  };
}
console.log(`${Object.keys(out).length} lines complete of ${Object.keys(planned).length}; ${problems} problem(s)`);
if (args.includes('--write')) {
  if (problems) { console.log('not writing: finish the lines above first'); process.exit(1); }
  writeFileSync(dir + 'lines.gen.json', JSON.stringify(out, null, 1));
  console.log(`wrote ${srcName}lines.gen.json`);
}
