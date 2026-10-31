// Lichess studies as training lines. A study's PGN export (one game per chapter, with
// variations, comments and %cal arrows) is turned into the same shapes openings.js and
// study.js use: FAMILIES, OPENINGS lines and STUDY commentary. Pure functions, no fetching:
// studies.js does the loading, and Node can import this file for tests.
import { Chess } from './vendor/chess.js';

// ------------------------------------------------------------------- PGN ---

// Split a multi-game PGN into { headers, root }. root.children[0] is the first move;
// each node is { san, comment, cal: ["e2e4"], children } and children[0] is the main line,
// the rest are variations (alternatives to that main move).
export function parseStudyPgn(text) {
  const games = [];
  let headers = null, body = [], depth = 0;   // depth: inside a {comment}, which may hold "[Event" lines
  const flush = () => { if (headers) games.push({ headers, root: parseMoves(body.join('\n')) }); };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const h = depth === 0 && line.match(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/);
    if (h) {
      if (!headers || body.some((l) => l.trim())) { flush(); headers = {}; body = []; }
      headers[h[1]] = h[2].replace(/\\(.)/g, '$1');
      continue;
    }
    if (!headers) continue;
    body.push(line);
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
  }
  flush();
  return games;
}

const SAN = /^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?|O-O(?:-O)?|0-0(?:-0)?)[+#]?/;

function parseMoves(s) {
  const root = { san: null, comment: '', cal: [], children: [] };
  let cur = root, last = null;   // last = the move a comment or "(" refers to
  const stack = [];
  let pre = null;   // a comment at the start of a variation, before its first move: it belongs to that move
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') {
      const j = s.indexOf('}', i);
      const raw = s.slice(i + 1, j < 0 ? s.length : j);
      if (last || !stack.length) addComment(last || cur, raw);
      else addComment(pre ||= { comment: '', cal: [] }, raw);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === ';') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (c === '(') {   // an alternative to the last move: it hangs off that move's parent
      stack.push([cur, last]);
      cur = last ? last.parent : cur;
      last = null;
      i++;
      continue;
    }
    if (c === ')') { [cur, last] = stack.pop() || [root, null]; i++; continue; }
    if (c === '$') { i = skip(s, i + 1, /\d/); continue; }
    const rest = s.slice(i);
    const num = rest.match(/^\d+\.+/);
    if (num) { i += num[0].length; continue; }
    const res = rest.match(/^(1-0|0-1|1\/2-1\/2|\*)/);
    if (res) { i += res[0].length; continue; }
    const m = rest.match(SAN);
    if (m) {
      const node = { san: m[0].replace(/0/g, 'O'), comment: pre?.comment || '', cal: pre?.cal || [], children: [], parent: cur };
      pre = null;
      cur.children.push(node);
      cur = node; last = node;
      i += m[0].length;
      while (i < s.length && /[!?]/.test(s[i])) i++;   // "Nf3!?" style annotations
      continue;
    }
    i = Math.max(i + 1, skip(s, i, /[^\s{}();]/));   // anything unreadable (a stray "}", "--"): skip it
  }
  return root;
}

function skip(s, i, re) { while (i < s.length && re.test(s[i])) i++; return i; }

function addComment(node, raw) {
  const arrows = [];
  const text = raw.replace(/\[%(\w+)\s+([^\]]*)\]/g, (_, k, v) => {
    if (k === 'cal') for (const a of v.split(',')) { const m = a.trim().match(/^[RGBY]?([a-h][1-8])([a-h][1-8])$/); if (m) arrows.push(m[1] + m[2]); }
    return '';
  }).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  node.cal.push(...arrows);
  if (text) node.comment = node.comment ? `${node.comment}\n${text}` : text;
}

// ---------------------------------------------------------- comment text ---

// A comment becomes a short note (first sentence) plus the rest as the longer "why".
// A shouted heading such as "WHERE THIS CHAPTER IS HEADED." is dropped from the note.
export function splitComment(text) {
  if (!text) return ['', ''];
  const t = text.replace(/^[A-Z][A-Z0-9 ,'()&/-]{6,}[.:]\s*/, '').trim();
  const m = t.match(/^[\s\S]{12,}?[.!?](?=\s+[A-Z0-9"(]|\s*$)/);
  if (!m || m[0].length > 220) return t.length <= 220 ? [t, ''] : [t.slice(0, t.lastIndexOf(' ', 200)) + '…', t];
  return [m[0].trim(), t.slice(m[0].length).trim()];
}

function shortIdea(text, max = 300) {
  const t = (text || '').replace(/^[A-Z][A-Z0-9 ,'()&/-]{6,}[.:]\s*/, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// --------------------------------------------------------- study -> lines ---

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// djb2 over the move list: a variation's id comes from the moves up to where it branches,
// so it survives the author extending or re-ordering lines (review progress is keyed by id).
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// "Chapter #4: Panov-Botvinnik Attack, Fianchetto Defence" -> group "Panov-Botvinnik Attack",
// short "Fianchetto Defence". "Instructive Game #3 Fischer - Petrosian" -> "Instructive Game".
// Chapters without a number (intro, course map, closing) go together under "Guides".
export function chapterGroup(name) {
  const ch = name.match(/^Chapter\s*#?\d+\s*[:.-]\s*(.*)$/i);
  if (ch) {
    const [head, ...tail] = ch[1].split(',');
    return { group: head.replace(/\s*\((?:[IVX]+|\d+)\)\s*$/, '').trim(), short: (tail.join(',').trim() || ch[1]).trim() };
  }
  const num = name.match(/^(.*?)\s*(?:-\s*\w+\s*)?#\d+\s*[:.-]?\s*(.*)$/);
  if (num && num[1]) return { group: num[1].trim(), short: num[2].trim() || name };
  return { group: 'Guides', short: name.replace(/\s*-\s*.*$/, '').replace(/:.*$/, '').trim() || name };
}

// study: { id, side, label, level? }   games: parseStudyPgn() output.
// Returns { families, lines, study } ready to append to FAMILIES / OPENINGS / STUDY.
export function studyToRepertoire(cfg, games) {
  const families = [], lines = [], study = {}, fams = new Map();
  const studyName = games[0]?.headers.StudyName || cfg.label;
  for (const gm of games) {
    const h = gm.headers;
    if (h.FEN || (h.Variant && h.Variant !== 'Standard')) continue;   // lines must start from the initial position
    const chapterName = h.ChapterName || h.Event || 'Chapter';
    const urlId = (h.ChapterURL || '').split('/').pop();
    const chapterId = /^[A-Za-z0-9]{1,16}$/.test(urlId) ? urlId : slug(chapterName);   // ids land in HTML attributes
    const { group, short } = chapterGroup(chapterName);
    if (!fams.has(group)) {
      const f = {
        id: `ls-${cfg.id}-${slug(group)}`, name: `${cfg.label}: ${group}`, side: cfg.side, topic: cfg.topic,
        idea: '', masters: [], lines: [],
        source: { study: studyName, author: (h.Annotator || '').match(/@\/([\w-]+)/)?.[1] || cfg.author || '', url: `https://lichess.org/study/${cfg.id}` },
      };
      fams.set(group, f);
      families.push(f);
    }
    const fam = fams.get(group);
    const level = cfg.level?.(group) || 2;
    const isGame = !!(h.White && h.White !== '?' && h.Black && h.Black !== '?' && /\d{4}/.test(h.Date || ''));
    const chLines = extractLines(gm.root, cfg.minOwn, cfg.maxNest);
    chLines.forEach((ln, k) => {
      const main = k === 0;
      const id = main ? `ls-${cfg.id}-${chapterId}` : `ls-${cfg.id}-${chapterId}-${hash(ln.moves.slice(0, ln.branchAt + 1).join(' '))}`;
      if (study[id]) return;   // the same branch twice in one chapter
      const at = ln.branchAt, mv = ln.moves[at];
      const label = main ? short : `${short}: ${moveNo(at)}${mv}${ln.moves[at + 1] ? ` ${moveNo(at + 1, true)}${ln.moves[at + 1]}` : ''}`;
      const notes = [], why = [];
      ln.nodes.forEach((n) => { const [a, b] = splitComment(n.comment); notes.push(a); why.push(b); });
      if (gm.root.comment) why[0] = [gm.root.comment, why[0]].filter(Boolean).join('\n');   // the chapter's opening words, in full
      const show = {};
      ln.nodes.forEach((n, i) => {
        const arrows = [...new Set(n.cal)].filter((a) => a !== ln.squares[i]);
        if (arrows.length) show[i] = arrows;
      });
      // sidelines that branch instead of move i are told after move i-1, where the choice is made
      for (const [key, list] of Object.entries(ln.sides)) {
        const ply = Number(key), i = Math.max(0, ply - 1);
        if (!ln.moves[ply]) continue;
        const txt = list.map((x) => `Instead of ${moveNo(ply)}${ln.moves[ply]}: ${x.moves}${x.moves.endsWith('…') ? '' : '.'}${x.said ? ` ${x.said}` : ''}`).join('\n');
        why[i] = why[i] ? `${why[i]}\n${txt}` : txt;
      }
      const intro = gm.root.comment || ln.nodes[0]?.comment || '';
      const idea = shortIdea(main ? intro : (ln.nodes[at]?.comment || intro));
      if (main && !fam.idea) fam.idea = shortIdea(intro);
      const o = {
        id, family: fam.id, kind: fam.lines.length ? 'variation' : 'main',
        branch: label, name: `${cfg.label}: ${main ? short : label}`, eco: h.ECO || '', side: cfg.side, level,
        idea: idea || fam.idea || studyName, moves: ln.moves, notes,
        source: { chapter: chapterName, url: h.ChapterURL || fam.source.url, game: isGame ? `${h.White} - ${h.Black}, ${h.Date.slice(0, 4)}` : '' },
      };
      fam.lines.push(id);
      lines.push(o);
      study[id] = { why, show };
    });
  }
  for (const f of families) {
    if (!f.idea) f.idea = `Lines from the Lichess study "${studyName}".`;
    f.masters = [`From the Lichess study "${studyName}"${f.source.author ? ` by ${f.source.author}` : ''}, loaded live from lichess.org. The commentary is the author's.`];
  }
  return { families: families.filter((f) => f.lines.length), lines, study };
}

const moveNo = (ply, cont = false) => (ply % 2 === 0 ? `${ply / 2 + 1}.` : cont ? '' : `${(ply + 1) / 2}...`);

// The chapter's main line comes first. A variation that runs at least MIN_OWN plies becomes a
// line of its own (following its main continuation to the end); a shorter one is a sideline,
// told in words at the move where it branches (sides[ply]). branchAt = the ply it leaves its parent.
// An illegal move ends the path there; chess.js also normalises the SAN.
export const MIN_OWN = 8;
export const MAX_NEST = 1;   // variations of variations are told as sidelines, not lines

function extractLines(root, minOwn = MIN_OWN, maxNest = MAX_NEST) {
  const out = [];
  const depth = (n) => { let d = 0; while (n) { d++; n = n.children[0]; } return d; };
  const walk = (board, node, moves, nodes, squares, branchAt, nest) => {
    const pending = [], sides = {};
    let n = node;
    while (n.children.length) {
      const [next, ...alts] = n.children;
      for (const a of alts) {
        if (nest < maxNest && depth(a) >= minOwn) pending.push([a, moves.slice(), nodes.slice(), squares.slice(), board.fen()]);
        else (sides[moves.length] ||= []).push(sideline(a, moves.length));
      }
      let m;
      try { m = board.move(next.san); } catch { m = null; }
      if (!m) break;
      moves.push(m.san); nodes.push(next); squares.push(m.from + m.to);
      n = next;
    }
    if (moves.length > branchAt) out.push({ moves, nodes, squares, branchAt, sides });
    for (const [a, pm, pn, pq, fen] of pending) walk(new Chess(fen), { children: [a] }, pm, pn, pq, pm.length, nest + 1);
  };
  walk(new Chess(), root, [], [], [], 0, 0);
  return out;
}

// { moves: "7.Nfg5 Nxe4 8.Qxe4", said: the author's last comment on it, shortened }
const SIDE_PLIES = 12;
function sideline(node, ply) {
  const sans = [];
  const said = [];   // the first and last comments; the full text is on Lichess
  let n = node, p = ply, subs = 0;
  while (n) {
    if (sans.length === SIDE_PLIES) sans.push('…');
    if (sans.length <= SIDE_PLIES) sans.push(`${p % 2 === 0 ? `${p / 2 + 1}.` : p === ply ? `${(p + 1) / 2}...` : ''}${n.san}`);
    if (n.comment) said.length < 2 ? said.push(n.comment) : (said[1] = n.comment);
    subs += Math.max(0, n.children.length - 1);
    n = n.children[0]; p++;
  }
  const more = subs ? ` (${subs} more sub-variation${subs > 1 ? 's' : ''} in the chapter on Lichess.)` : '';
  return { moves: sans.join(' '), said: (said.map((c) => shortIdea(c)).join(' … ') + more).trim() };
}
