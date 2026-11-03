// Checks static/middlegames.js against the repertoire: every opening has a plan with all its
// parts, and every per-line sentence names a real practice line (Lines section, not a
// transposition) of that opening. Run: node tools/tree/validate_middlegames.mjs
import { OPENINGS, FAMILIES } from '../../static/openings.js';
import { MIDDLEGAMES } from '../../static/middlegames.js';

const LINE = new Map(OPENINGS.map((o) => [o.id, o]));
const FAM = new Map(FAMILIES.map((f) => [f.id, f]));
const isPractice = (o) => [].concat(o.topic || 'line').includes('line') && o.kind !== 'transposition';
const errs = [];

for (const f of FAMILIES) if (!MIDDLEGAMES[f.id] && !MIDDLEGAMES[f.topic]) errs.push(`${f.id}: no middlegame plan`);
for (const [id, p] of Object.entries(MIDDLEGAMES)) {
  const f = FAM.get(id);
  if (!f) { errs.push(`${id}: not an opening id`); continue; }
  // A plan's line sentences also reach the families split off from this opening (topic).
  const own = FAMILIES.filter((x) => x.id === id || x.topic === id).flatMap((x) => x.lines);
  if (!p.structure?.trim()) errs.push(`${id}: empty structure`);
  for (const k of ['you', 'them', 'pieces', 'avoid']) {
    if (!Array.isArray(p[k]) || !p[k].length || p[k].some((x) => !x?.trim())) errs.push(`${id}: ${k} must be a non-empty list of sentences`);
  }
  for (const lid of Object.keys(p.lines || {})) {
    const o = LINE.get(lid);
    if (!o || !own.includes(lid)) errs.push(`${id}: lines.${lid} is not a line of this opening`);
    else if (!isPractice(o)) errs.push(`${id}: lines.${lid} is a trap/mistake or transposition, not a practice line`);
  }
  const missing = own.filter((l) => l !== f.lines[0]).map((l) => LINE.get(l)).filter((o) => isPractice(o) && !p.lines?.[o.id]);
  if (missing.length) console.log(`note ${id}: no line sentence for ${missing.map((o) => o.id).join(', ')}`);
}

if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`all good: ${Object.keys(MIDDLEGAMES).length} plans for ${FAMILIES.length} openings`);
