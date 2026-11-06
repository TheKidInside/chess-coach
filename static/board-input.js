// Board input shared by the small boards (Lessons, Walkthroughs) and the main board:
// followDrag() lets a piece follow the pointer so a move can be dragged as well as tapped, and
// userArrows() lets you right-drag to draw your own arrows (right-click one square for a ring),
// as on Lichess. A left click clears them, and so does a new position.

const SVGNS = 'http://www.w3.org/2000/svg';

// The board square under a point, if it belongs to this board.
export function squareUnder(board, x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    const sq = el.closest?.('[data-sq]');
    if (sq && board.contains(sq)) return sq.dataset.sq;
  }
  return null;
}

// Call from a pointerdown on a piece you may move. The piece follows the pointer; dropping it on
// another square calls onDrop(to). A press without a real drag is a tap and calls onTap, if given.
export function followDrag(e, board, from, onDrop, onTap) {
  const img = board.querySelector(`[data-sq="${from}"] .el-piece, [data-sq="${from}"] .piece`);
  if (!img || e.button !== 0) return;
  const r = img.getBoundingClientRect();
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  let moved = false;
  const onMove = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
    moved = true;
    img.classList.add('dragging');
    img.style.transform = `translate(${ev.clientX - ox}px, ${ev.clientY - oy}px) scale(1.08)`;
  };
  const onUp = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    img.style.transform = '';
    img.classList.remove('dragging');
    if (ev.type === 'pointercancel') return;
    if (!moved) { onTap?.(); return; }
    const to = squareUnder(board, ev.clientX, ev.clientY);
    if (to && to !== from) onDrop(to);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// Your own arrows on `wrap` (the positioned box holding the board). Returns { sync(key), clear() }:
// call sync with something that names what the board shows (a FEN plus the step or line) whenever
// the board is drawn, and the arrows go away once it changes.
export function userArrows(wrap) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'user-arrows');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  wrap.appendChild(svg);
  let marks = [], start = null, startId = null, key = null;

  // Where a square sits on screen right now, so a flipped board needs no special case.
  const at = (sq) => {
    const el = wrap.querySelector(`[data-sq="${sq}"]`);
    if (!el) return null;
    const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!w.width) return null;   // hidden pane
    return { x: ((r.left - w.left + r.width / 2) / w.width) * 8, y: ((r.top - w.top + r.height / 2) / w.height) * 8 };
  };
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  function draw() {
    svg.textContent = '';
    for (const [from, to] of marks) {
      const a = at(from), b = at(to);
      if (!a || !b) continue;
      if (from === to) { svg.appendChild(el('circle', { cx: a.x, cy: a.y, r: 0.45, class: 'ua-ring' })); continue; }
      const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const ex = b.x - ux * 0.38, ey = b.y - uy * 0.38;
      svg.appendChild(el('line', { x1: a.x + ux * 0.25, y1: a.y + uy * 0.25, x2: ex, y2: ey, class: 'ua-line' }));
      svg.appendChild(el('polygon', { points: `${b.x - ux * 0.08},${b.y - uy * 0.08} ${ex - uy * 0.2},${ey + ux * 0.2} ${ex + uy * 0.2},${ey - ux * 0.2}`, class: 'ua-head' }));
    }
  }
  const clear = () => { if (marks.length) { marks = []; draw(); } };

  wrap.addEventListener('contextmenu', (e) => { if (squareUnder(wrap, e.clientX, e.clientY)) e.preventDefault(); });
  // Capture phase, so the board's own move handling never sees a right press.
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      start = squareUnder(wrap, e.clientX, e.clientY);
      startId = e.pointerId;
      if (start) { e.preventDefault(); e.stopPropagation(); }
    } else if (e.button === 0) clear();
  }, true);
  window.addEventListener('pointercancel', (e) => { if (e.pointerId === startId) start = null; });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !start || e.pointerId !== startId) return;
    const from = start;
    start = null;
    const to = squareUnder(wrap, e.clientX, e.clientY);
    if (!to) return;
    const i = marks.findIndex(([a, b]) => a === from && b === to);
    if (i >= 0) marks.splice(i, 1); else marks.push([from, to]);   // drawing it again takes it away
    draw();
  });
  return {
    clear,
    sync(next) { if (next !== key) { key = next; clear(); } else draw(); },
  };
}
