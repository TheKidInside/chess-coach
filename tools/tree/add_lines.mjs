// Usage: node tools/tree/add_lines.mjs <new-lines.json> [--write]
// Adds new lines to the existing drafts in tools/tree/drafts/, so you only write the moves
// where a line leaves the tree. Input shape:
//   { "<lineId>": { family, after?, prefix?: { from: <lineId>, plies: n }, branch, kind, name, eco,
//                   level, idea, moves: "e4 c6 ...", notes: [...], why: [...], gm?, show?, joins?,
//                   gambitPlies? } }
// prefix copies notes/why for the first n plies from an existing line (which must share those moves);
// notes/why in the input then cover only the remaining plies. gm/show keys are full-line ply numbers.
// The line goes into the draft that owns `family`, listed after `after` (default: at the end).
// Without --write it only reports what it would do. Run validate_study.mjs on the drafts afterwards.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = fileURLToPath(new URL('./drafts/', import.meta.url));
const { OPENINGS } = await import(pathToFileURL(fileURLToPath(new URL('../../static/openings.js', import.meta.url))).href);
const { STUDY } = await import(pathToFileURL(fileURLToPath(new URL('../../static/study.js', import.meta.url))).href);
const [input, flag] = process.argv.slice(2);
const add = JSON.parse(readFileSync(input, 'utf8'));

const drafts = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const text = readFileSync(dir + f, 'utf8');
  drafts[f] = { data: JSON.parse(text), indent: (text.match(/\n( +)"/) || [, '  '])[1].length, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}
const findLine = (id) => {
  for (const d of Object.values(drafts)) if (d.data.lines[id]) return { ...OPENINGS.find((o) => o.id === id), ...d.data.lines[id] };
  const o = OPENINGS.find((x) => x.id === id);
  return o && { ...o, why: STUDY[id]?.why };
};

let bad = 0;
const touched = new Set();
for (const [id, l] of Object.entries(add)) {
  const moves = l.moves.trim().split(/\s+/);
  let notes = l.notes, why = l.why;
  if (l.prefix) {
    const src = findLine(l.prefix.from), n = l.prefix.plies;
    if (!src) { console.log(`ERROR ${id}: prefix source ${l.prefix.from} not found`); bad++; continue; }
    if (moves.slice(0, n).join() !== src.moves.slice(0, n).join()) { console.log(`ERROR ${id}: first ${n} plies differ from ${l.prefix.from}`); bad++; continue; }
    notes = [...src.notes.slice(0, n), ...l.notes];
    why = [...src.why.slice(0, n), ...l.why];
  }
  if (notes.length !== moves.length || why.length !== moves.length) {
    console.log(`ERROR ${id}: ${moves.length} plies but ${notes.length} notes and ${why.length} why`); bad++; continue;
  }
  const entry = Object.entries(drafts).find(([, d]) => d.data.families.some((f) => f.id === l.family));
  if (!entry) { console.log(`ERROR ${id}: no draft owns family ${l.family}`); bad++; continue; }
  const [file, d] = entry;
  const fam = d.data.families.find((f) => f.id === l.family);
  const line = { branch: l.branch, kind: l.kind, name: l.name, eco: l.eco, level: l.level, idea: l.idea, moves, notes, why };
  for (const k of ['joins', 'gm', 'show', 'gambitPlies']) if (l[k] !== undefined) line[k] = l[k];
  d.data.lines[id] = line;
  if (!fam.lines.includes(id)) {
    const at = l.after ? fam.lines.indexOf(l.after) + 1 : fam.lines.length;
    fam.lines.splice(at > 0 ? at : fam.lines.length, 0, id);
  }
  touched.add(file);
  console.log(`${id}: ${moves.length} plies -> ${file} (${fam.id}: ${fam.lines.length} lines)`);
}
if (bad) process.exit(1);
if (flag === '--write') for (const f of touched) {
  const d = drafts[f];
  writeFileSync(dir + f, JSON.stringify(d.data, null, d.indent).replace(/\n/g, d.eol) + d.eol);
  console.log('wrote ' + f);
}
