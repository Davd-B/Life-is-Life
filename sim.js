// Life is Life
// Idea: Davide Brunori, University of Genoa, 2026.
//
// A variant of Conway's Game of Life. Organisms are made of cells; each cell has
// a specialization and a table of orders (stimulus -> action). Every tick the
// organism does what most of its cells ask for (rule 7), and pain rewrites the
// orders of the cells that made a bad choice (rule 10).
(function (root) {
'use strict';

// Cell types
const DIGESTIVE = 0, TACTILE = 1, VISUAL = 2;
const TYPES = [DIGESTIVE, TACTILE, VISUAL];

// Diets
const HERBIVORE = 0, CARNIVORE = 1, OMNIVORE = 2;
const eatsMeat = (o) => o.diet !== HERBIVORE;
const eatsPlants = (o) => o.diet !== CARNIVORE;

// Actions
const APPROACH = 0, FLEE = 1, EAT = 2, STOP = 3, WANDER = 4, IGNORE = 5;
const N_ACTIONS = 6;

// Stimuli
const HUNGER = 0, FOOD_TOUCH = 1, PREY_TOUCH = 2, THREAT_TOUCH = 3, OBSTACLE = 4,
  FOOD_SEEN = 5, PREY_SEEN = 6, THREAT_SEEN = 7;
const N_STIMULI = 8;

// Which stimuli each cell type can perceive
const SENSES = [
  [HUNGER, FOOD_TOUCH, PREY_TOUCH],
  [FOOD_TOUCH, PREY_TOUCH, THREAT_TOUCH, OBSTACLE],
  [FOOD_SEEN, PREY_SEEN, THREAT_SEEN],
];

// Sensible responses for sensory cells. Used only to measure intelligence,
// never to drive behavior.
const SENSIBLE = {
  [TACTILE]: {
    [FOOD_TOUCH]: [APPROACH, EAT, STOP, IGNORE],
    [PREY_TOUCH]: [EAT, STOP, IGNORE],
    [THREAT_TOUCH]: [FLEE],
    [OBSTACLE]: [FLEE, STOP, WANDER, IGNORE],
  },
  [VISUAL]: {
    [FOOD_SEEN]: [APPROACH],
    [PREY_SEEN]: [APPROACH],
    [THREAT_SEEN]: [FLEE],
  },
};

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const K = {
  energyPerCell: 10,
  metabolism: [0.045, 0.02, 0.03],
  moveCost: 0.004,
  foodEnergy: 3,
  preyEnergy: 6,
  omnivoreYield: 0.75,   // omnivores eat everything but extract less
  cellCost: 4,           // energy needed to make a new cell
  digestTime: 8,
  reproduceAt: 0.75,     // fraction of full energy
  minAge: 8,
  hungryBelow: 0.4,
  starvingBelow: 0.25,
  idleLimit: 120,        // rule 8
  visionRange: 8,
  biteResistance: [0.2, 0.75, 0.4],
  foodRegen: 0.0009,
  foodCycle: 3000,       // ticks for a food source to wax and wane
  bumpPain: 0.2,
  kMutation: 0.06,
  orderMutation: 0.01,
  typeMutation: 0.02,
  dietMutation: 0.03,
  kMax: 64,
};

const BIODIVERSITY_GOAL = 8, INTELLIGENCE_GOAL = 0.4, FINAL_DURATION = 3000;
const DEFAULTS = { W: 200, H: 125, seed: 7, regen: 1, plasticity: 0.5, mutation: 1, trapLimit: 8, inoculum: 1 };

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function createSim(opts) {
  const P = Object.assign({}, DEFAULTS, opts);
  const W = P.W, H = P.H, N = W * H;
  const rng = mulberry32(P.seed >>> 0);
  const randInt = (n) => (rng() * n) | 0;
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // The world wraps around: leaving one edge brings you back on the opposite one.
  const wrapX = (x) => ((x % W) + W) % W;
  const wrapY = (y) => ((y % H) + H) % H;
  const deltaX = (d) => (d > W / 2 ? d - W : d < -W / 2 ? d + W : d);
  const deltaY = (d) => (d > H / 2 ? d - H : d < -H / 2 ? d + H : d);

  const cellAt = new Array(N).fill(null);
  const food = new Uint8Array(N);
  const sources = [];
  let orgs = [];
  let nextId = 1;
  let tick = 0;
  const events = {
    births: 0, pushes: 0, growth: 0, bites: 0, joy: 0, pain: 0,
    deaths: { starved: 0, trapped: 0, eaten: 0, noDigestion: 0 },
  };
  const milestones = {};
  const history = [];
  let lastStats = null;
  let finalRun = 0;

  function mark(key) { if (!(key in milestones)) milestones[key] = tick; }
  function otherType(t) { let u; do u = TYPES[randInt(TYPES.length)]; while (u === t); return u; }

  // ---------- food ----------
  function makeSources() {
    const count = Math.max(4, Math.round(N / 6000));
    for (let i = 0; i < count; i++) {
      sources.push({ x: 15 + rng() * (W - 30), y: 12 + rng() * (H - 24), phase: rng() * Math.PI * 2, strength: 1 });
    }
    sources[0].x = W / 2 + (rng() - 0.5) * 20;
    sources[0].y = H / 2 + (rng() - 0.5) * 12;
  }
  function spawnFood(count) {
    let total = 0;
    for (const s of sources) {
      s.strength = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(tick * 2 * Math.PI / K.foodCycle + s.phase));
      total += s.strength;
    }
    for (let i = 0; i < count; i++) {
      let x, y;
      if (rng() < 0.65) {
        let r = rng() * total, s = sources[0];
        for (const t of sources) { r -= t.strength; if (r <= 0) { s = t; break; } }
        x = wrapX(Math.round(s.x + gauss() * 16));
        y = wrapY(Math.round(s.y + gauss() * 12));
      } else {
        x = randInt(W); y = randInt(H);
      }
      const p = y * W + x;
      if (!cellAt[p]) food[p] = 1;
    }
  }
  function driftSources() {
    for (const s of sources) {
      s.x = Math.min(W - 10, Math.max(10, s.x + gauss() * 0.08));
      s.y = Math.min(H - 8, Math.max(8, s.y + gauss() * 0.08));
    }
  }

  // ---------- organisms ----------
  function makeOrganism(k, energy, gen, parent) {
    const d = DIRS[randInt(8)];
    return {
      id: nextId++, cells: [], k, E: energy, age: 0, gen, hx: d[0], hy: d[1],
      trapped: 0, alive: true, cause: null, growth: 0,
      blame: [], recent: [[], [], [], [], []], lastAct: -1, lastPain: null,
      kids: 0, bites: 0, diet: parent ? parent.diet : HERBIVORE,
    };
  }
  function addCell(o, x, y, type, orders, confidence) {
    const c = { x, y, type, orders, confidence, idle: 0, busy: 0, o, stim: -1, dx: 0, dy: 0, dead: false };
    o.cells.push(c);
    cellAt[y * W + x] = c;
    return c;
  }
  // Rule 3: the first cell wanders, and eats when it touches food.
  function innateOrders() {
    const orders = new Uint8Array(N_STIMULI).fill(WANDER);
    orders[FOOD_TOUCH] = EAT;
    return orders;
  }
  const capacity = (o) => o.cells.length * K.energyPerCell;

  function kill(o, cause) {
    if (!o.alive) return;
    o.alive = false;
    o.cause = cause;
    events.deaths[cause]++;
    for (const c of o.cells) {
      const p = c.y * W + c.x;
      if (cellAt[p] === c) cellAt[p] = null;
      c.dead = true;
      if (cause !== 'eaten' && rng() < 0.8) food[p] = 1;
    }
  }
  function removeCell(c) {
    const o = c.o;
    const i = o.cells.indexOf(c);
    if (i < 0) return;
    const last = o.cells.pop();
    if (last !== c) o.cells[i] = last;
    cellAt[c.y * W + c.x] = null;
    c.dead = true;
    if (o.cells.length === 0) { kill(o, 'eaten'); return; }
    o.E = Math.min(o.E, capacity(o));
  }

  // ---------- perception ----------
  function setStimulus(c, s, dx, dy) { c.stim = s; c.dx = sign(dx); c.dy = sign(dy); return s; }

  function sense(c, o, n, hungry) {
    const cx = c.x, cy = c.y;

    if (c.type === DIGESTIVE) {
      if (c.busy > 0) return (c.stim = -1);   // rule 9
      let prey = null, meal = null;
      const start = randInt(9);
      for (let j = 0; j < 9; j++) {
        const q = (start + j) % 9, dx = (q % 3) - 1, dy = ((q / 3) | 0) - 1;
        const p = wrapY(cy + dy) * W + wrapX(cx + dx), other = cellAt[p];
        if (eatsMeat(o) && other && other.o !== o && other.o.cells.length < n && !prey) prey = [dx, dy];
        if (eatsPlants(o) && food[p] && !meal) meal = [dx, dy];
      }
      if (prey) return setStimulus(c, PREY_TOUCH, prey[0], prey[1]);
      if (meal) return setStimulus(c, FOOD_TOUCH, meal[0], meal[1]);
      if (hungry) return setStimulus(c, HUNGER, o.hx, o.hy);
      return (c.stim = -1);
    }

    if (c.type === TACTILE) {
      let threat = null, prey = null, meal = null, obstacle = null;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const p = wrapY(cy + dy) * W + wrapX(cx + dx);
        const adjacent = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        const other = cellAt[p];
        if (other && other.o !== o) {
          const m = other.o.cells.length;
          if (m > n) { if (!threat) threat = [dx, dy]; }
          else if (m < n) { if (!prey) prey = [dx, dy]; }
          else if (adjacent && !obstacle) obstacle = [dx, dy];
        }
        if (food[p] && !meal) meal = [dx, dy];
      }
      if (threat) return setStimulus(c, THREAT_TOUCH, threat[0], threat[1]);
      if (prey) return setStimulus(c, PREY_TOUCH, prey[0], prey[1]);
      if (meal) return setStimulus(c, FOOD_TOUCH, meal[0], meal[1]);
      if (obstacle) return setStimulus(c, OBSTACLE, obstacle[0], obstacle[1]);
      return (c.stim = -1);
    }

    // Visual: look along 8 rays, keep the nearest threat, prey and food.
    let threat = null, threatDist = 99, prey = null, preyDist = 99, meal = null, mealDist = 99;
    const start = randInt(8);
    for (let j = 0; j < 8; j++) {
      const d = DIRS[(start + j) & 7];
      for (let r = 1; r <= K.visionRange; r++) {
        const p = wrapY(cy + d[1] * r) * W + wrapX(cx + d[0] * r);
        const other = cellAt[p];
        if (other && other.o !== o) {
          const m = other.o.cells.length;
          if (m > n && r < threatDist) { threat = d; threatDist = r; }
          else if (m < n && r < preyDist) { prey = d; preyDist = r; }
          break;
        }
        if (food[p] && r < mealDist && !other) { meal = d; mealDist = r; }
      }
    }
    if (threat) return setStimulus(c, THREAT_SEEN, threat[0], threat[1]);
    if (prey) return setStimulus(c, PREY_SEEN, prey[0], prey[1]);
    if (meal) return setStimulus(c, FOOD_SEEN, meal[0], meal[1]);
    return (c.stim = -1);
  }

  // ---------- movement ----------
  // Food can be pushed. A whole row moves one step as long as nothing living
  // blocks its far end. Returns the row length, or -1 if blocked.
  function rowLength(x, y, dx, dy) {
    let len = 1;
    for (let guard = 0; guard < N; guard++) {
      x = wrapX(x + dx); y = wrapY(y + dy);
      const q = y * W + x;
      if (cellAt[q]) return -1;
      if (!food[q]) return len;
      len++;
    }
    return -1;
  }
  function pushRow(x, y, dx, dy, len) {
    for (let i = len; i >= 1; i--) {
      food[wrapY(y + dy * i) * W + wrapX(x + dx * i)] = food[wrapY(y + dy * (i - 1)) * W + wrapX(x + dx * (i - 1))];
    }
    food[y * W + x] = 0;
    events.pushes++;
  }
  // An organism can push at most as many pieces of food as it has cells.
  function canMove(o, dx, dy) {
    let load = 0;
    for (const c of o.cells) {
      const x = wrapX(c.x + dx), y = wrapY(c.y + dy), p = y * W + x;
      const other = cellAt[p];
      if (other && other.o !== o) return false;
      if (food[p]) {
        const len = rowLength(x, y, dx, dy);
        if (len < 0) return false;
        load += len;
        if (load > o.cells.length) return false;
      }
    }
    return true;
  }
  function move(o, dx, dy) {
    if (!dx && !dy) return true;
    if (!canMove(o, dx, dy)) return false;
    for (const c of o.cells) {
      const x = wrapX(c.x + dx), y = wrapY(c.y + dy);
      if (food[y * W + x]) pushRow(x, y, dx, dy, rowLength(x, y, dx, dy));
    }
    for (const c of o.cells) cellAt[c.y * W + c.x] = null;
    for (const c of o.cells) { c.x = wrapX(c.x + dx); c.y = wrapY(c.y + dy); cellAt[c.y * W + c.x] = c; }
    return true;
  }
  function canMoveAnywhere(o) {
    for (const d of DIRS) if (canMove(o, d[0], d[1])) return true;
    return false;
  }

  // ---------- learning (rule 10) ----------
  // `list` holds pairs (cell, stimulus). Confidence absorbs pain before an order mutates.
  function pain(o, list, prob) {
    events.pain++;
    for (let i = 0; i < list.length; i += 2) {
      const c = list[i], s = list[i + 1];
      if (c.dead || rng() > prob) continue;
      if (c.confidence[s] > 0) { c.confidence[s]--; continue; }
      if (rng() < P.plasticity) {
        let a = randInt(N_ACTIONS - 1);
        if (a >= c.orders[s]) a++;
        c.orders[s] = a;
      }
    }
  }
  // Pleasure strengthens the orders that led to a meal over the last few ticks.
  function pleasure(o) {
    events.joy++;
    for (const list of o.recent) for (let i = 0; i < list.length; i += 2) {
      const c = list[i], s = list[i + 1];
      if (!c.dead && c.confidence[s] < 3) c.confidence[s]++;
    }
  }

  // ---------- feeding (rules 3, 5, 9) ----------
  function eat(o) {
    const n = o.cells.length;
    const yieldFactor = o.diet === OMNIVORE ? K.omnivoreYield : 1;
    let eaten = 0, tried = 0;
    for (const c of o.cells) {
      if (c.type !== DIGESTIVE || c.busy > 0 || c.dead) continue;
      let prey = null, mealAt = -1;
      const start = randInt(9);
      for (let j = 0; j < 9; j++) {
        const q = (start + j) % 9;
        const p = wrapY(c.y + ((q / 3) | 0) - 1) * W + wrapX(c.x + (q % 3) - 1), other = cellAt[p];
        if (eatsMeat(o) && other && other.o !== o && other.o.alive && other.o.cells.length < n) { prey = other; break; }
        if (eatsPlants(o) && food[p] && mealAt < 0) mealAt = p;
      }
      if (prey) {
        tried++;
        if (rng() < 1 - K.biteResistance[prey.type]) {
          const victim = prey.o;
          removeCell(prey);
          pain(victim, victim.blame, 1);
          victim.lastPain = 'bite';
          o.E += K.preyEnergy * yieldFactor;
          c.busy = 12;
          eaten++; o.bites++; events.bites++;
          mark('bite');
        } else {
          c.busy = 4;
        }
      } else if (mealAt >= 0) {
        food[mealAt] = 0;
        o.E += K.foodEnergy * yieldFactor;
        c.busy = K.digestTime;
        eaten++;
      }
    }
    // Energy beyond capacity becomes new cells.
    if (o.E > capacity(o)) { o.growth += o.E - capacity(o); o.E = capacity(o); }
    while (o.growth >= K.cellCost && grow(o)) o.growth -= K.cellCost;
    return { eaten, tried };
  }

  // A new cell copies a neighbor: same type, same orders.
  function grow(o) {
    const n = o.cells.length, start = randInt(n);
    for (let j = 0; j < n; j++) {
      const c = o.cells[(start + j) % n], d0 = randInt(4);
      for (let k = 0; k < 4; k++) {
        const d = DIRS[((d0 + k) % 4) * 2], x = wrapX(c.x + d[0]), y = wrapY(c.y + d[1]), p = y * W + x;
        if (!cellAt[p] && !food[p]) {
          addCell(o, x, y, n === 1 ? DIGESTIVE : c.type, Uint8Array.from(c.orders), Uint8Array.from(c.confidence));
          events.growth++;
          if (o.cells.length >= 10) mark('k10');
          return true;
        }
      }
    }
    return false;
  }

  // ---------- reproduction (rules 1, 4) ----------
  function reproduce(o) {
    let k = o.k;
    if (rng() < K.kMutation * P.mutation) {
      const step = rng() < 0.8 ? 1 : 1 + randInt(3);
      k = Math.max(1, Math.min(K.kMax, k + (rng() < 0.5 ? -step : step)));
    }
    const cost = k * K.cellCost;
    if (o.E < cost + 1) return;

    // The child copies the parent's shape, then grows or shrinks to k cells.
    const c0 = o.cells[0];
    const ux = (c) => c0.x + deltaX(c.x - c0.x), uy = (c) => c0.y + deltaY(c.y - c0.y);
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const c of o.cells) {
      minX = Math.min(minX, ux(c)); minY = Math.min(minY, uy(c));
      maxX = Math.max(maxX, ux(c)); maxY = Math.max(maxY, uy(c));
    }
    const shape = o.cells.map((c) => ({ rx: ux(c) - minX, ry: uy(c) - minY, type: c.type, orders: c.orders, confidence: c.confidence }));
    const key = (x, y) => x * 1000 + y;
    const used = new Set(shape.map((s) => key(s.rx, s.ry)));
    for (let guard = 0; shape.length < k && guard < 500; guard++) {
      const s = shape[randInt(shape.length)], d = DIRS[randInt(4) * 2];
      const nx = s.rx + d[0], ny = s.ry + d[1];
      if (used.has(key(nx, ny))) continue;
      used.add(key(nx, ny));
      shape.push({ rx: nx, ry: ny, type: s.type, orders: s.orders, confidence: s.confidence });
    }
    while (shape.length > k) shape.splice(randInt(shape.length), 1);
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9;
    for (const s of shape) {
      sx0 = Math.min(sx0, s.rx); sy0 = Math.min(sy0, s.ry);
      sx1 = Math.max(sx1, s.rx); sy1 = Math.max(sy1, s.ry);
    }
    const sw = sx1 - sx0 + 1, sh = sy1 - sy0 + 1;

    // Try the eight spots around the parent, in random order.
    const midX = ((minX + maxX) / 2 - sw / 2 + 0.5) | 0, midY = ((minY + maxY) / 2 - sh / 2 + 0.5) | 0;
    const spots = [[maxX + 1, midY], [minX - sw, midY], [midX, maxY + 1], [midX, minY - sh],
      [maxX + 1, maxY + 1], [minX - sw, minY - sh], [maxX + 1, minY - sh], [minX - sw, maxY + 1]];
    for (let i = spots.length - 1; i > 0; i--) { const j = randInt(i + 1); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const spot = spots.find(([bx, by]) => shape.every((s) => {
      const p = wrapY(by + s.ry - sy0) * W + wrapX(bx + s.rx - sx0);
      return !food[p] && !cellAt[p];
    }));
    if (!spot) return;

    o.E = (o.E - cost) / 2;
    const child = makeOrganism(k, 0, o.gen + 1, o);
    if (rng() < K.dietMutation * P.mutation) {
      child.diet = (o.diet + 1 + randInt(2)) % 3;
      mark('diet' + child.diet);
    }
    for (const s of shape) {
      const type = k === 1 ? DIGESTIVE : rng() < K.typeMutation * P.mutation ? otherType(s.type) : s.type;
      const orders = Uint8Array.from(s.orders), confidence = Uint8Array.from(s.confidence);
      for (let i = 0; i < N_STIMULI; i++) {
        if (rng() < K.orderMutation * P.mutation) { orders[i] = randInt(N_ACTIONS); confidence[i] = 0; }
      }
      addCell(child, wrapX(spot[0] + s.rx - sx0), wrapY(spot[1] + s.ry - sy0), type, orders, confidence);
    }
    child.E = Math.min(o.E, capacity(child));
    orgs.push(child);
    o.kids++; events.births++;
    mark('division');
    if (k >= 2) mark('k2');
    if (k >= 10) mark('k10');
    const d = DIRS[randInt(8)]; o.hx = d[0]; o.hy = d[1];
  }

  // ---------- one organism, one tick ----------
  const votes = new Int32Array(N_ACTIONS), voteX = new Float64Array(N_ACTIONS), voteY = new Float64Array(N_ACTIONS);
  function step(o) {
    o.age++;
    const cells = o.cells, n = cells.length;
    const hungry = o.E < K.hungryBelow * capacity(o);
    votes.fill(0); voteX.fill(0); voteY.fill(0);
    let cost = 0;

    for (const c of cells) {
      cost += K.metabolism[c.type];
      if (c.busy > 0) c.busy--;
      const s = sense(c, o, n, hungry);
      if (s >= 0) {
        c.idle = 0;
        const a = c.orders[s];
        if (a !== IGNORE) {
          votes[a]++;
          if (a === APPROACH) { voteX[a] += c.dx; voteY[a] += c.dy; }
          else if (a === FLEE) { voteX[a] -= c.dx; voteY[a] -= c.dy; }
        }
      } else if (c.type === DIGESTIVE && c.busy > 0) c.idle = 0;
      else c.idle++;
    }

    // Rule 7: the action with the most votes wins (ties broken at random).
    let best = -1, top = 0, ties = 0;
    for (let a = 0; a < N_ACTIONS; a++) {
      if (votes[a] > top) { top = votes[a]; best = a; ties = 1; }
      else if (votes[a] === top && top > 0 && rng() < 1 / (++ties)) best = a;
    }
    // Cells that voted for the winner, or abstained, share the blame for it.
    // Cells outvoted by the majority are spared.
    const winners = [], blame = [];
    for (const c of cells) {
      if (c.stim < 0) continue;
      const a = c.orders[c.stim];
      if (a === best) { winners.push(c, c.stim); blame.push(c, c.stim); }
      else if (a === IGNORE) blame.push(c, c.stim);
    }
    o.lastAct = best;
    o.blame = blame;
    o.recent.shift(); o.recent.push(winners);

    const act = best < 0 ? WANDER : best;
    let moved = false, mx = 0, my = 0, wantsToMove = false;
    if (act === APPROACH || act === FLEE) {
      mx = sign(voteX[act]); my = sign(voteY[act]);
      if (!mx && !my) { mx = o.hx; my = o.hy; }
      wantsToMove = true;
    } else if (act === WANDER) {
      if (rng() < 0.15) { const d = DIRS[randInt(8)]; o.hx = d[0]; o.hy = d[1]; }
      mx = o.hx; my = o.hy; wantsToMove = true;
    } else if (act === EAT) {
      const r = eat(o);
      if (r.eaten > 0) pleasure(o);
      else if (r.tried === 0 && blame.length) { pain(o, blame, 1); o.lastPain = 'emptyBite'; }
    }

    // Bigger organisms are slower.
    if (wantsToMove && rng() < Math.min(1, 12 / (n + 8))) {
      if (move(o, mx, my)) {
        moved = true; o.hx = mx; o.hy = my; cost += K.moveCost * n;
      } else {
        const d = DIRS[randInt(8)]; o.hx = d[0]; o.hy = d[1];
        if (blame.length) { pain(o, blame, K.bumpPain); o.lastPain = 'bump'; }
      }
    }
    if (!o.alive) return;

    if (o.E < K.starvingBelow * capacity(o) && blame.length && rng() < 0.25) { pain(o, blame, 1); o.lastPain = 'starving'; }

    // Rule 8: a cell that gets no stimuli switches type and copies a sister's orders.
    if (n > 1) for (const c of cells) {
      if (c.idle <= K.idleLimit) continue;
      c.type = otherType(c.type);
      c.idle = 0;
      c.confidence.fill(0);
      const start = randInt(n);
      for (let j = 0; j < n; j++) {
        const sister = cells[(start + j) % n];
        if (sister !== c && sister.type === c.type) { c.orders.set(sister.orders); break; }
      }
    }

    // Rule 12: at least one digestive cell in every three; none at all means death.
    let digestive = 0;
    for (const c of cells) if (c.type === DIGESTIVE) digestive++;
    if (digestive === 0) { kill(o, 'noDigestion'); return; }
    const needed = Math.ceil(n / 3);
    const start = randInt(n);
    for (let j = 0; j < n && digestive < needed; j++) {
      const c = cells[(start + j) % n];
      if (c.type === DIGESTIVE) continue;
      c.type = DIGESTIVE; c.idle = 0; c.confidence.fill(0); digestive++;
      for (const sister of cells) if (sister !== c && sister.type === DIGESTIVE) { c.orders.set(sister.orders); break; }
    }

    o.E -= cost;
    if (o.E <= 0) { kill(o, 'starved'); return; }

    // Rule 11: an organism that cannot move for too long dies.
    if (moved || canMoveAnywhere(o)) o.trapped = 0;
    else if (++o.trapped >= P.trapLimit) { kill(o, 'trapped'); return; }

    if (o.E >= K.reproduceAt * capacity(o) && o.age >= K.minAge) reproduce(o);
  }

  // ---------- statistics ----------
  // A "species" is a group of organisms with the same diet, size class and tissue mix.
  // Species count is the exponential of the Shannon entropy of these groups.
  function sizeClass(n) { return n <= 4 ? n : n <= 6 ? 5 : n <= 9 ? 6 : n <= 14 ? 7 : n <= 22 ? 8 : 9; }
  function computeStats() {
    const cellTypes = [0, 0, 0], diets = [0, 0, 0];
    const groups = new Map();
    let hits = 0, chance = 0, room = 0, sizeSum = 0, nMax = 0, gMax = 0, allThree = false;
    for (const o of orgs) {
      const n = o.cells.length;
      const t = [0, 0, 0];
      for (const c of o.cells) {
        t[c.type]++;
        const table = SENSIBLE[c.type];
        if (table) for (const s of SENSES[c.type]) {
          const good = table[s], p = good.length / N_ACTIONS;
          if (good.includes(c.orders[s])) hits++;
          chance += p; room += 1 - p;
        }
      }
      for (let i = 0; i < 3; i++) cellTypes[i] += t[i];
      diets[o.diet]++;
      if (t[0] && t[1] && t[2]) allThree = true;
      sizeSum += n; nMax = Math.max(nMax, n); gMax = Math.max(gMax, o.gen);
      const key = o.diet * 1000 + sizeClass(n) * 100 + Math.round(t[0] / n * 3) * 10 + Math.round(t[1] / n * 3);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const pop = orgs.length;
    let entropy = 0;
    for (const v of groups.values()) { const p = v / pop; entropy -= p * Math.log(p); }
    const sensory = cellTypes[TACTILE] + cellTypes[VISUAL];
    const stats = {
      tick, pop, diets, cellTypes,
      cells: cellTypes[0] + cellTypes[1] + cellTypes[2],
      species: pop ? Math.exp(entropy) : 0,
      // How far above chance the sensory cells' orders are (0 = random, 1 = all sensible).
      intelligence: room > 0 ? Math.max(0, (hits - chance) / room) : 0,
      meanSize: pop ? sizeSum / pop : 0, nMax, gMax,
    };
    if (cellTypes[TACTILE]) mark('tactile');
    if (cellTypes[VISUAL]) mark('visual');
    if (allThree) mark('allThree');
    if (stats.species >= BIODIVERSITY_GOAL) mark('biodiversity');
    const smart = stats.intelligence >= INTELLIGENCE_GOAL && sensory >= 100;
    if (smart) mark('intelligence');
    finalRun = smart && stats.species >= BIODIVERSITY_GOAL ? finalRun + 10 : 0;
    if (finalRun >= FINAL_DURATION) mark('final');
    lastStats = stats;
    history.push(stats);
    if (history.length > 2000) history.splice(0, history.length - 2000);
    return stats;
  }

  // ---------- main loop ----------
  function update() {
    tick++;
    const regen = N * K.foodRegen * P.regen;
    spawnFood((regen | 0) + (rng() < regen % 1 ? 1 : 0));
    driftSources();
    const order = orgs.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = randInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    for (const o of order) if (o.alive) step(o);
    orgs = orgs.filter((o) => o.alive);
    if (tick % 10 === 0) computeStats();
  }

  function init() {
    makeSources();
    for (let i = 0; i < N; i++) if (rng() < 0.06) food[i] = 1;
    spawnFood(N * 0.05 | 0);
    const count = Math.max(1, P.inoculum | 0);
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 200; tries++) {
        const x = count === 1 ? (W / 2) | 0 : randInt(W), y = count === 1 ? (H / 2) | 0 : randInt(H);
        if (cellAt[y * W + x]) continue;
        const o = makeOrganism(1, 7, 0, null);
        addCell(o, x, y, DIGESTIVE, innateOrders(), new Uint8Array(N_STIMULI));
        orgs.push(o);
        break;
      }
    }
    computeStats();
  }
  init();

  function organismAt(x, y) {
    let best = null, bestDist = 1e9;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const c = cellAt[wrapY(y + dy) * W + wrapX(x + dx)];
      if (c && dx * dx + dy * dy < bestDist) { bestDist = dx * dx + dy * dy; best = c.o; }
    }
    return best;
  }
  function dropFood(x, y, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const p = wrapY(y + dy) * W + wrapX(x + dx);
      if (!cellAt[p] && rng() < 0.6) food[p] = 1;
    }
  }

  return {
    W, H, P, cellAt, food, events, milestones, history, deltaX, deltaY,
    update, organismAt, dropFood,
    get tick() { return tick; },
    get orgs() { return orgs; },
    get stats() { return lastStats; },
  };
}

const API = {
  createSim, K, SENSES, N_ACTIONS, N_STIMULI, DIGESTIVE, TACTILE, VISUAL,
  BIODIVERSITY_GOAL, INTELLIGENCE_GOAL, FINAL_DURATION,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.LifeIsLife = API;
})(typeof window !== 'undefined' ? window : this);
