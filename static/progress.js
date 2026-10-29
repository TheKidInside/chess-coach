// Progress tab: level, headline stats, activity heatmap, puzzle-rating trend, recent games.
import { P, levelOf, levelStart, streakNow, today, addDays, MASTERED_BOX, save } from './profile.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function niceDate(day) { const [, m, d] = day.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; }

export function renderProgress(el, openings, onGoalChange, onOpenGame) {
  const d = P.data;
  const lvl = levelOf(d.xp);
  const lo = levelStart(lvl), hi = levelStart(lvl + 1);
  const mastered = openings.filter((o) => (d.openings[o.id]?.box || 0) >= MASTERED_BOX).length;
  const started = openings.filter((o) => d.openings[o.id]).length;
  const recent = d.games.slice(0, 10);
  const avgAcc = recent.length ? Math.round(recent.reduce((a, g) => a + (g.acc || 0), 0) / recent.length) : null;
  const pz = d.puzzles;

  el.innerHTML = `
    <div class="levelcard">
      <div class="lv">${lvl}</div>
      <div style="flex:1">
        <div class="eyebrow">Level</div>
        <div class="small">${d.xp - lo} / ${hi - lo} XP to level ${lvl + 1} · ${d.xp} XP total</div>
        <div class="lvbar"><span style="width:${((d.xp - lo) / (hi - lo)) * 100}%"></span></div>
      </div>
    </div>
    <div class="tiles">
      <div class="stat"><span class="eyebrow">Day streak</span><b>${streakNow()}</b><span class="muted small">best ${d.streak.best}</span></div>
      <div class="stat"><span class="eyebrow">Puzzle rating</span><b>${pz.rating}</b><span class="muted small">${pz.solved} solved · best run ${pz.bestRun}</span></div>
      <div class="stat"><span class="eyebrow">Openings mastered</span><b>${mastered}<span class="muted small"> / ${openings.length}</span></b><span class="muted small">${started} in your review cycle</span></div>
      <div class="stat"><span class="eyebrow">Games</span><b>${d.games.length}</b><span class="muted small">${avgAcc === null ? 'no games yet' : `avg accuracy ${avgAcc}% (last ${recent.length})`}</span></div>
    </div>
    <div class="card-head"><span class="eyebrow">Activity · last 16 weeks</span><span class="muted small">XP per day</span></div>
    ${heatmap(d.days, d.goal)}
    <div class="card-head"><span class="eyebrow">Puzzle rating</span><span class="muted small">${pz.history.length ? `last ${Math.min(60, pz.history.length)} puzzles` : ''}</span></div>
    <div class="chartbox" id="pz-chart">${pz.history.length >= 2 ? '' : '<div class="empty">Solve a few puzzles to see your rating trend.</div>'}</div>
    <div class="card-head"><span class="eyebrow">Recent games</span></div>
    ${gamesTable(d.games.slice(0, 8))}
    <div class="goalset">Daily goal
      <select id="goal-select" aria-label="Daily XP goal">
        ${[[30, 'Casual'], [60, 'Regular'], [100, 'Serious'], [150, 'Intense']].map(([v, n]) =>
          `<option value="${v}"${v === d.goal ? ' selected' : ''}>${n} · ${v} XP</option>`).join('')}
      </select>
    </div>`;

  if (pz.history.length >= 2) ratingChart(el.querySelector('#pz-chart'), pz.history.slice(-60));
  el.querySelector('#goal-select').onchange = (e) => { d.goal = +e.target.value; save(); onGoalChange(); };
  el.querySelectorAll('.games tbody tr').forEach((tr) => {
    const g = d.games[+tr.dataset.i];
    if (g && g.pgn) tr.onclick = () => onOpenGame(g.pgn);
  });
}

function heatmap(days, goal) {
  const t = today();
  const [y, m, dd] = t.split('-').map(Number);
  const dow = new Date(y, m - 1, dd).getDay();             // 0 = Sunday
  const start = addDays(t, -(15 * 7 + dow));                // Sunday, 15 weeks before this one
  let cells = '';
  for (let i = 0; i < 16 * 7; i++) {
    const day = addDays(start, i);
    if (day > t) { cells += '<i class="future"></i>'; continue; }
    const xp = days[day] || 0;
    const l = xp === 0 ? 0 : xp < goal * 0.5 ? 1 : xp < goal ? 2 : xp < goal * 2 ? 3 : 4;
    cells += `<i data-l="${l}" title="${niceDate(day)}: ${xp} XP${xp >= goal ? ' (goal hit)' : ''}"></i>`;
  }
  return `<div class="heat" role="img" aria-label="Daily XP heatmap">${cells}</div>`;
}

function gamesTable(games) {
  if (!games.length) return '<div class="empty">Finish a game in the Play tab and it shows up here with your accuracy.</div>';
  const res = { win: ['Won', 'res-w'], loss: ['Lost', 'res-l'], draw: ['Draw', ''] };
  return `<table class="games"><thead><tr><th>Date</th><th>You</th><th>Opponent</th><th>Result</th><th>Accuracy</th></tr></thead><tbody>${
    games.map((g, i) => `<tr data-i="${i}" title="Open in Analyze"><td>${niceDate(g.date)}</td><td>${g.color === 'w' ? 'White' : 'Black'}</td><td>${esc(g.oppLabel || g.elo)}</td>` +
      `<td class="${res[g.result][1]}">${res[g.result][0]}${g.resigned ? ' (resigned)' : ''}</td><td>${g.acc ?? '–'}%${g.takebacks ? ` <span class="muted">· ${g.takebacks} TB</span>` : ''}</td></tr>`).join('')
  }</tbody></table>`;
}

function ratingChart(box, pts) {
  const W = 480, H = 140, L = 40, R = 8, T = 8, B = 20;
  const vals = pts.map((p) => p[1]);
  const lo = Math.floor((Math.min(...vals) - 10) / 50) * 50;
  const hi = Math.ceil((Math.max(...vals) + 10) / 50) * 50;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Puzzle rating over the last ${pts.length} puzzles, from ${vals[0]} to ${vals[vals.length - 1]}">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <path class="lineplot" d="${path}" vector-effect="non-scaling-stroke"/>
    <line class="cross" id="cx" y1="${T}" y2="${H - B}" visibility="hidden" vector-effect="non-scaling-stroke"/>
    <circle class="dot" cx="${x(pts.length - 1)}" cy="${y(vals[vals.length - 1])}" r="4"/>
    <circle class="dot" id="cdot" r="4" visibility="hidden"/>
  </svg><div class="tip hidden" id="ctip"></div>`;
  const svg = box.querySelector('svg'), tip = box.querySelector('#ctip');
  const cx = box.querySelector('#cx'), dot = box.querySelector('#cdot');
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - L) / (W - L - R)) * (pts.length - 1))));
    cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(vals[i])); dot.setAttribute('visibility', 'visible');
    tip.classList.remove('hidden');
    tip.textContent = `${vals[i]} · ${niceDate(pts[i][0])}`;
    tip.style.left = `${(x(i) / W) * r.width}px`;
    tip.style.top = `${(y(vals[i]) / H) * r.height}px`;
  });
  svg.addEventListener('pointerleave', () => {
    tip.classList.add('hidden'); cx.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
  });
}
