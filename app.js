// Life is Life — page: drawing, controls, statistics and inspector.
'use strict';

const LL = window.LifeIsLife;
const W = 200, H = 125, SCALE = 4;

const COLORS = [[255, 59, 59], [255, 143, 208], [63, 162, 255]];
const DIGESTING = [150, 30, 30];
const FOOD = [90, 120, 42];
const EMPTY = [13, 11, 18];

const STIMULI = ['Hunger', 'Food in touch', 'Prey in touch', 'Threat in touch', 'Obstacle', 'Food in sight', 'Prey in sight', 'Threat in sight'];
const ACTIONS = ['Approach', 'Flee', 'Eat', 'Stop', 'Wander', 'Ignore'];
const DIETS = ['herbivore', 'carnivore', 'omnivore'];
const DEATHS = { starved: 'starved', trapped: 'trapped', eaten: 'eaten', noDigestion: 'no digestive cells' };
const PAINS = { bite: 'bitten', bump: 'bumped', starving: 'starving', emptyBite: 'bit nothing' };
const MILESTONES = [
  ['division', 'First division'],
  ['k2', 'First multicellular organism'],
  ['diet1', 'First carnivore'],
  ['diet2', 'First omnivore'],
  ['bite', 'First bite'],
  ['tactile', 'First tactile cell'],
  ['visual', 'First visual cell'],
  ['allThree', 'All three cell types in one organism'],
  ['k10', 'Organism with 10+ cells'],
  ['biodiversity', `Biodiversity: ${LL.BIODIVERSITY_GOAL}+ species`],
  ['intelligence', `Intelligence: ${LL.INTELLIGENCE_GOAL * 100}%`],
  ['final', `Final state: both held for ${LL.FINAL_DURATION} ticks`],
];

const $ = (id) => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
canvas.width = W * SCALE;
canvas.height = H * SCALE;
const buffer = document.createElement('canvas');
buffer.width = W;
buffer.height = H;
const bctx = buffer.getContext('2d');
const image = bctx.createImageData(W, H);

let sim, running = true, selected = null;

function start() {
  sim = LL.createSim({
    W, H,
    seed: (Math.random() * 1e9) | 0,
    inoculum: +$('inoculum').value,
    regen: +$('regen').value,
    plasticity: +$('plasticity').value,
  });
  selected = null;
}

// Bounding box of an organism, unwrapped around its first cell so it stays whole across edges.
function bounds(o) {
  const c0 = o.cells[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of o.cells) {
    const x = c0.x + sim.deltaX(c.x - c0.x), y = c0.y + sim.deltaY(c.y - c0.y);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function draw() {
  const d = image.data;
  for (let i = 0; i < W * H; i++) {
    const c = sim.cellAt[i];
    const rgb = c ? (c.type === LL.DIGESTIVE && c.busy > 0 ? DIGESTING : COLORS[c.type]) : sim.food[i] ? FOOD : EMPTY;
    d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
  }
  bctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  if (selected && selected.alive) {
    const [x0, y0, x1, y1] = bounds(selected);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    // Draw the box on every side so it shows up when the organism straddles an edge.
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      ctx.strokeRect((x0 + ox) * SCALE - 4, (y0 + oy) * SCALE - 4, (x1 - x0 + 1) * SCALE + 8, (y1 - y0 + 1) * SCALE + 8);
    }
  }
}

function showStats() {
  const s = sim.stats;
  if (!s) return;
  const deaths = sim.events.deaths;
  const rows = [
    ['Tick', s.tick],
    ['Organisms', s.pop],
    ['Cells (D / T / V)', s.cellTypes.join(' / ')],
    ['Cells from growth', sim.events.growth],
    ['Organism size (mean / max)', s.meanSize.toFixed(1) + ' / ' + s.nMax],
    ['Diets (H / C / O)', s.diets.join(' / ')],
    ['Food pushes', sim.events.pushes],
    ['Highest generation', s.gMax],
    ['Species', s.species.toFixed(1)],
    ['Intelligence', Math.round(s.intelligence * 100) + '%'],
    ['Starved', deaths.starved],
    ['Trapped', deaths.trapped],
    ['Eaten', deaths.eaten],
    ['Lost all digestive cells', deaths.noDigestion],
  ];
  let html = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  if (s.pop === 0) html += '<span class="warn">Extinct</span><b></b>';
  $('stats').innerHTML = html;

  const chart = $('chart'), g = chart.getContext('2d'), h = sim.history.slice(-280);
  g.clearRect(0, 0, chart.width, chart.height);
  const plot = (value, max, color) => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    h.forEach((p, i) => {
      const x = i / 279 * chart.width;
      const y = chart.height - 4 - Math.min(1, value(p) / max) * (chart.height - 8);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  plot((p) => p.species, 30, getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  plot((p) => p.intelligence, 1, '#2fb67c');

  $('milestones').innerHTML = MILESTONES.map(([key, label]) => key in sim.milestones
    ? `<span class="done">✓ ${label} <small>(tick ${sim.milestones[key]})</small></span>`
    : `<span>○ ${label}</span>`).join('');
}

function showInspector() {
  const el = $('inspector');
  if (!selected) return;
  if (!selected.alive) {
    el.textContent = `Organism #${selected.id} died (${DEATHS[selected.cause]}).`;
    selected = null;
    return;
  }
  const o = selected;
  const types = [0, 0, 0];
  for (const c of o.cells) types[c.type]++;

  // Most common order for each stimulus, among the cells that can perceive it.
  const orders = STIMULI.map((name, s) => {
    const count = new Array(LL.N_ACTIONS).fill(0);
    let n = 0;
    for (const c of o.cells) if (LL.SENSES[c.type].includes(s)) { count[c.orders[s]]++; n++; }
    if (!n) return '';
    const a = count.indexOf(Math.max(...count));
    return `<tr><td>${name}</td><td>${ACTIONS[a]} (${count[a]}/${n})</td></tr>`;
  }).join('');

  const [x0, y0, x1, y1] = bounds(o);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const px = Math.max(4, Math.min(14, (120 / Math.max(w, h)) | 0));
  el.innerHTML = `<div class="kv">
      <span>#${o.id} · gen ${o.gen}</span><b>k=${o.k}</b>
      <span>Diet</span><b>${DIETS[o.diet]}</b>
      <span>Cells D/T/V</span><b>${types.join('/')}</b>
      <span>Energy</span><b>${o.E.toFixed(1)} / ${o.cells.length * LL.K.energyPerCell}</b>
      <span>Last choice</span><b>${o.lastAct >= 0 ? ACTIONS[o.lastAct] : '—'}</b>
      <span>Last pain</span><b>${PAINS[o.lastPain] || '—'}</b>
      <span>Children / bites</span><b>${o.kids} / ${o.bites}</b>
    </div>
    <canvas id="shape" width="${w * px}" height="${h * px}"></canvas>
    <table>${orders}</table>`;

  const g = $('shape').getContext('2d'), c0 = o.cells[0];
  for (const c of o.cells) {
    g.fillStyle = `rgb(${COLORS[c.type]})`;
    g.fillRect((c0.x + sim.deltaX(c.x - c0.x) - x0) * px, (c0.y + sim.deltaY(c.y - c0.y) - y0) * px, px - 1, px - 1);
  }
}

let frame = 0;
function loop() {
  if (running && sim.orgs.length) for (let i = 0; i < +$('speed').value; i++) sim.update();
  draw();
  if (frame++ % 10 === 0) { showStats(); showInspector(); }
  requestAnimationFrame(loop);
}

$('play').onclick = () => {
  running = !running;
  $('play').textContent = running ? 'Pause' : 'Play';
};
$('step').onclick = () => { sim.update(); showStats(); showInspector(); };
$('reset').onclick = () => { start(); showStats(); };
$('regen').oninput = (e) => { sim.P.regen = +e.target.value; };
$('plasticity').oninput = (e) => { sim.P.plasticity = +e.target.value; };
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width * W) | 0;
  const y = ((e.clientY - r.top) / r.height * H) | 0;
  if (e.shiftKey) { sim.dropFood(x, y, 5); return; }
  selected = sim.organismAt(x, y);
  showInspector();
});

start();
loop();
