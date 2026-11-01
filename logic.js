'use strict';
// 1942(세로 슈팅) 규칙. 화면 없이 Node 에서 시험한다 (DOM 을 쓰지 않는다).
// 길이는 논리 픽셀(화면 224x272), 시간은 초. 위가 앞쪽이고 y 는 아래로 커진다.
const LOGIC_1942 = (() => {
const W = 224, H = 272;
const PLAYER_SPEED = 130, PLAYER_R = 4.5;
const SHOT_SPEED = 330, SHOT_COOL = 0.15, MAX_SHOTS = 14;
const START_LIVES = 4, ROLLS_PER_STAGE = 3, ROLL_TIME = 1, INVULN_AFTER_DEATH = 2.5, RESPAWN_TIME = 1.5;
const STAGE_TIME = 52;                                // 이 시간이 지나면 보스가 나온다
const POINTS = { zero: 100, red: 100, bomber: 800, boss: 5000, pow: 500 };
const EXTRA_LIFE_AT = 15000, EXTRA_LIFE_EVERY = 60000;
const ITEM_TYPES = ['quad', 'wing', 'bomb', 'roll', 'life'];

const rng = (seed) => {                                // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const emit = (st, e) => { st.events.push(e); };
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

// ---------- 비행 경로: 나온 지 age 초일 때의 위치 ----------
function pathPos(p, age) {
  const m = p.speed;
  if (p.type === 'hold') return { x: p.x0, y: p.y0 };                          // 가만히 있는 것 (시험용)
  if (p.type === 'line') return { x: p.x0 + p.amp * Math.sin(p.freq * age), y: -14 + 78 * m * age };
  if (p.type === 'diag') return { x: p.x0 + p.dir * 62 * m * age, y: -14 + 58 * m * age };
  if (p.type === 'bottom') return { x: p.x0 + p.amp * Math.sin(p.freq * age), y: H + 14 - 86 * m * age };
  if (p.type === 'loop') {
    const v = 92 * m, t1 = (p.ys + 14) / v, R = p.radius, w = p.dir * v / R, tl = 2 * Math.PI / Math.abs(w);
    if (age < t1) return { x: p.x0, y: -14 + v * age };
    if (age < t1 + tl) {
      const phi0 = Math.PI / 2, phi = phi0 + w * (age - t1);
      return { x: p.x0 + (v / w) * (Math.sin(phi) - Math.sin(phi0)), y: p.ys - (v / w) * (Math.cos(phi) - Math.cos(phi0)) };
    }
    return { x: p.x0, y: p.ys + v * (age - t1 - tl) };
  }
  if (p.type === 'bomber') {                            // 천천히 내려와 잠깐 머물다 내려간다
    const hold = 62, y = -24 + 26 * age;
    if (y < hold) return { x: p.x0 + p.amp * Math.sin(p.freq * age), y };
    const t0 = (hold + 24) / 26;
    const stay = 4.5;
    const a2 = age - t0;
    return { x: p.x0 + p.amp * Math.sin(p.freq * age), y: a2 < stay ? hold : hold + 40 * (a2 - stay) };
  }
  return { x: p.x0, y: -14 + 60 * age };
}

// ---------- 판 짜기 ----------
// 한 단계에서 나올 비행기 목록(시각 순). 단계가 오를수록 빠르고 많이 쏜다
function makeSchedule(stage, r) {
  const list = [];
  const sp = Math.min(1.4, 1 + 0.05 * (stage - 1));
  const add = (at, kind, pat, group, gsize) => list.push({ at, kind, pat: { ...pat, speed: sp }, group, gsize });
  let group = 0;
  const groupOf = (n) => { const g = ++group; return { g, n }; };
  const lineGroup = (at, kind, x0, n, gap, extra = {}) => {
    const { g } = groupOf(n);
    for (let i = 0; i < n; i++) add(at + i * gap, kind, { type: 'line', x0, amp: extra.amp ?? 24, freq: extra.freq ?? 2.2 }, g, n);
  };
  const diagGroup = (at, kind, dir, n, gap) => {
    const { g } = groupOf(n);
    for (let i = 0; i < n; i++) add(at + i * gap, kind, { type: 'diag', x0: dir > 0 ? -14 : W + 14, dir }, g, n);
  };
  const loopGroup = (at, kind, x0, dir, n, gap) => {
    const { g } = groupOf(n);
    for (let i = 0; i < n; i++) add(at + i * gap, kind, { type: 'loop', x0, ys: 70 + r() * 40, radius: 22, dir }, g, n);
  };
  const bottomGroup = (at, kind, x0, n, gap) => {
    const { g } = groupOf(n);
    for (let i = 0; i < n; i++) add(at + i * gap, kind, { type: 'bottom', x0, amp: 30, freq: 1.8 }, g, n);
  };
  let t = 1.5, k = 0;
  while (t < STAGE_TIME - 6) {
    const pick = Math.floor(r() * 6);
    const n = 4 + Math.floor(r() * 3) + (stage > 3 ? 1 : 0);
    const red = k % 4 === 3;                                           // 네 번째 무리마다 빨간 비행기(POW)
    const kind = red ? 'red' : 'zero';
    const cnt = red ? 5 : n;
    if (pick === 0) lineGroup(t, kind, 40 + r() * 144, cnt, 0.28);
    else if (pick === 1) diagGroup(t, kind, r() < 0.5 ? 1 : -1, cnt, 0.3);
    else if (pick === 2) loopGroup(t, kind, 60 + r() * 104, r() < 0.5 ? 1 : -1, red ? 5 : Math.min(cnt, 4), 0.55);
    else if (pick === 3) bottomGroup(t, kind, 40 + r() * 144, cnt, 0.28);
    else if (pick === 4) lineGroup(t, kind, 30 + r() * 164, cnt, 0.3, { amp: 42, freq: 1.6 });
    else diagGroup(t, kind, r() < 0.5 ? 1 : -1, cnt, 0.26);
    k++;
    t += 3.4 + r() * 1.2;
  }
  // 중형 폭격기: 단계가 오를수록 더 자주
  const bombers = Math.min(4, 1 + Math.floor(stage / 2));
  for (let i = 0; i < bombers; i++) add(12 + i * (34 / bombers) + r() * 4, 'bomber', { type: 'bomber', x0: 50 + r() * 124, amp: 18, freq: 0.9 }, ++group, 1);
  list.sort((a, b) => a.at - b.at);
  return list;
}

// ---------- 시작 ----------
function newGame(rand = Math.random) {
  const st = {
    rand, score: 0, lives: START_LIVES, extra: 0, stage: 1, time: 0, events: [],
    stats: { kills: 0, shots: 0, hits: 0 }, seq: 0,
    player: null,
  };
  st.player = { x: W / 2, y: H - 40, alive: true, invuln: 2, rolls: ROLLS_PER_STAGE, roll: 0, gun: 0, wing: 0, cool: 0, respawn: 0, moved: 0 };
  startStage(st, 1);
  st.events = [];
  return st;
}
function startStage(st, stage) {
  st.stage = stage;
  st.t = 0; st.phase = 'play'; st.phaseT = 0;
  st.schedule = makeSchedule(stage, st.rand); st.next = 0;
  st.enemies = []; st.bullets = []; st.ebullets = []; st.items = [];
  st.groups = {};
  st.bossSpawned = false; st.boss = null;
  st.player.rolls = ROLLS_PER_STAGE;
  st.stageStats = { shots: 0, hits: 0 };
  emit(st, { t: 'stage', stage });
}

function spawnEnemy(st, s) {
  const base = { id: ++st.seq, kind: s.kind, pat: s.pat, age: 0, group: s.group, alive: true, x: -50, y: -50, hx: 0, hy: 1 };
  const k = s.kind;
  const cfg = { zero: { hp: 1, r: 7 }, red: { hp: 1, r: 7 }, bomber: { hp: 7 + st.stage, r: 12 } }[k];
  Object.assign(base, cfg);
  base.shootT = 0.8 + st.rand() * 2.2;
  const p = pathPos(base.pat, 0);
  base.x = p.x; base.y = p.y;
  st.enemies.push(base);
  if (!st.groups[s.group]) st.groups[s.group] = { size: s.gsize, killed: 0, gone: 0, kind: k };
  return base;
}
function spawnBoss(st) {
  const hp = 80 + 15 * st.stage;
  const b = { id: ++st.seq, kind: 'boss', pat: null, age: 0, group: 0, alive: true, x: W / 2, y: -40, hx: 0, hy: 1, hp, maxHp: hp, r: 24, shootT: 1.5, ringT: 3, phase: 0 };
  st.enemies.push(b); st.boss = b; st.bossSpawned = true;
  emit(st, { t: 'boss' });
}

// ---------- 한 걸음 ----------
// input: { dx, dy: -1~1 방향, fire: 쏘는 중, roll: 이번에 회전을 눌렀는가 }
function step(st, dt, input) {
  st.events = [];
  let left = dt;
  while (left > 1e-9 && st.phase !== 'over') { const h = Math.min(left, 1 / 60); sub(st, h, input || {}); left -= h; if (input) input.roll = false; }
}

function addScore(st, n) {
  st.score += n;
  const need = () => (st.extra === 0 ? EXTRA_LIFE_AT : EXTRA_LIFE_AT + st.extra * EXTRA_LIFE_EVERY);
  while (st.score >= need()) { st.extra++; st.lives++; emit(st, { t: 'extraLife' }); }
}

function firePlayer(st) {
  const p = st.player;
  if (p.cool > 0 || p.roll > 0 || st.bullets.length >= MAX_SHOTS + (p.gun ? 8 : 0)) return;
  const mk = (x, y, vx) => { st.bullets.push({ x, y, vx, vy: -SHOT_SPEED }); st.stats.shots++; st.stageStats.shots++; };
  mk(p.x - 4, p.y - 6, 0); mk(p.x + 4, p.y - 6, 0);
  if (p.gun) { mk(p.x - 7, p.y - 4, -26); mk(p.x + 7, p.y - 4, 26); }
  if (p.wing) { mk(p.x - 18, p.y - 2, 0); mk(p.x + 18, p.y - 2, 0); }
  p.cool = p.gun ? SHOT_COOL + 0.03 : SHOT_COOL;
  emit(st, { t: 'shot' });
}

function enemyFire(st, e, n, spread, speed) {
  const p = st.player;
  const a0 = Math.atan2(p.y - e.y, p.x - e.x);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i - (n - 1) / 2) * spread;
    st.ebullets.push({ x: e.x, y: e.y + 4, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
  }
  emit(st, { t: 'efire' });
}

function dropItem(st, x, y, type) {
  const t = type || (() => { const r = st.rand(); return r < 0.34 ? 'quad' : r < 0.58 ? 'wing' : r < 0.74 ? 'bomb' : r < 0.92 ? 'roll' : 'life'; })();
  st.items.push({ x, y, type: t, age: 0 });
  emit(st, { t: 'pow', type: t });
}

function killEnemy(st, e, byPlayer) {
  e.alive = false;
  st.stats.kills++;
  const pts = POINTS[e.kind] || 100;
  addScore(st, pts);
  emit(st, { t: 'kill', kind: e.kind, x: e.x, y: e.y, pts });
  const g = st.groups[e.group];
  if (g) {
    g.killed++;
    if (e.kind === 'red' && g.killed === g.size && g.gone === 0) dropItem(st, e.x, e.y);     // 빨간 비행기 다섯 대를 다 맞히면 POW
  }
}

function playerHit(st, why) {
  const p = st.player;
  if (!p.alive || p.invuln > 0 || p.roll > 0) return;
  p.alive = false; p.gun = 0; p.wing = 0;
  st.lives--;
  emit(st, { t: 'crash', x: p.x, y: p.y, why });
  p.respawn = RESPAWN_TIME;
  if (st.lives <= 0) { st.phase = 'dying'; st.phaseT = 2; }
}

function takeItem(st, it) {
  const p = st.player;
  emit(st, { t: 'pickup', type: it.type });
  addScore(st, POINTS.pow);
  if (it.type === 'quad') p.gun = 1;
  else if (it.type === 'wing') p.wing = 1;
  else if (it.type === 'roll') p.rolls = Math.min(9, p.rolls + 1);
  else if (it.type === 'life') { st.lives++; emit(st, { t: 'extraLife' }); }
  else if (it.type === 'bomb') {                                  // 화면의 작은 비행기를 모두 격추
    for (const e of st.enemies) if (e.alive && e.kind !== 'boss' && e.kind !== 'bomber' && e.y > 0) killEnemy(st, e, true);
    st.ebullets = [];
    emit(st, { t: 'bomb' });
  }
}

function sub(st, h, input) {
  st.time += h;
  const p = st.player;
  if (st.phase === 'dying') { st.phaseT -= h; if (st.phaseT <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); } }
  if (st.phase === 'clear') {
    st.phaseT -= h;
    if (st.phaseT <= 0) startStage(st, st.stage + 1);
  }
  const live = st.phase === 'play';

  // 내 비행기
  if (p.alive) {
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - h);
    if (p.roll > 0) p.roll = Math.max(0, p.roll - h);
    p.cool = Math.max(0, p.cool - h);
    let dx = input.dx || 0, dy = input.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const nx = Math.max(8, Math.min(W - 8, p.x + dx * PLAYER_SPEED * h)), ny = Math.max(14, Math.min(H - 14, p.y + dy * PLAYER_SPEED * h));
    p.moved += Math.abs(nx - p.x) + Math.abs(ny - p.y);
    p.x = nx; p.y = ny;
    if (input.roll && p.rolls > 0 && p.roll <= 0 && live) { p.rolls--; p.roll = ROLL_TIME; emit(st, { t: 'roll' }); }
    if (input.fire && live) firePlayer(st);
  } else if (st.lives > 0 && live) {
    p.respawn -= h;
    if (p.respawn <= 0) { p.alive = true; p.x = W / 2; p.y = H - 40; p.invuln = INVULN_AFTER_DEATH; p.roll = 0; p.cool = 0; emit(st, { t: 'respawn' }); }
  }

  // 나올 비행기
  if (live) {
    st.t += h;
    while (st.next < st.schedule.length && st.schedule[st.next].at <= st.t) spawnEnemy(st, st.schedule[st.next++]);
    if (!st.bossSpawned && st.t >= STAGE_TIME) spawnBoss(st);
  }

  // 적
  for (const e of st.enemies) {
    if (!e.alive) continue;
    e.age += h;
    if (e.kind === 'boss') {
      if (e.y < 58) e.y += 38 * h;
      else {
        e.x = W / 2 + 70 * Math.sin((e.age - 1) * 0.7);
        e.shootT -= h; e.ringT -= h;
        if (e.shootT <= 0 && p.alive) { enemyFire(st, e, 5, 0.22, Math.min(125, 92 + 4 * st.stage)); e.shootT = Math.max(0.7, 1.5 - 0.08 * st.stage); }
        if (e.ringT <= 0) {
          const n = 12;
          for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + e.age; st.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70 }); }
          emit(st, { t: 'efire' });
          e.ringT = 3.2;
        }
      }
      e.hx = 0; e.hy = 1;
    } else {
      const pos = pathPos(e.pat, e.age), nxt = pathPos(e.pat, e.age + 0.03);
      e.x = pos.x; e.y = pos.y;
      const hx = nxt.x - pos.x, hy = nxt.y - pos.y, hl = Math.hypot(hx, hy) || 1;
      e.hx = hx / hl; e.hy = hy / hl;
      e.shootT -= h;
      if (e.shootT <= 0) {
        const onScreen = e.x > 8 && e.x < W - 8 && e.y > 8 && e.y < H - 70;
        if (onScreen && p.alive) {
          if (e.kind === 'bomber') enemyFire(st, e, 3, 0.25, Math.min(105, 85 + 3 * st.stage));
          else if (st.rand() < Math.min(0.75, 0.3 + 0.06 * st.stage)) enemyFire(st, e, 1, 0, Math.min(115, 76 + 4 * st.stage));
        }
        e.shootT = (e.kind === 'bomber' ? 1.7 : 1.6) + st.rand() * 2.4;
      }
      if (e.age > 1 && (e.y > H + 30 || e.y < -40 || e.x < -40 || e.x > W + 40)) {
        e.alive = false;
        const g = st.groups[e.group]; if (g) g.gone++;
      }
    }
  }

  // 내 총알
  for (const b of st.bullets) { b.x += b.vx * h; b.y += b.vy * h; }
  for (const b of st.bullets) {
    if (b.dead) continue;
    for (const e of st.enemies) {
      if (!e.alive || (e.kind !== 'boss' && e.y < 0)) continue;
      const rr = e.r + 2;
      if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
        b.dead = true; st.stats.hits++; st.stageStats.hits++;
        e.hp--;
        if (e.hp <= 0) {
          if (e.kind === 'boss') { bossDown(st, e); } else killEnemy(st, e, true);
        } else emit(st, { t: 'hit', x: b.x, y: b.y, kind: e.kind });
        break;
      }
    }
  }
  st.bullets = st.bullets.filter((b) => !b.dead && b.y > -10 && b.x > -10 && b.x < W + 10);

  // 적 총알
  for (const b of st.ebullets) { b.x += b.vx * h; b.y += b.vy * h; }
  st.ebullets = st.ebullets.filter((b) => b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10);
  if (p.alive) {
    for (const b of st.ebullets) if (dist2(b.x, b.y, p.x, p.y) < (PLAYER_R + 2) * (PLAYER_R + 2)) { b.dead = true; playerHit(st, 'bullet'); break; }
    if (p.alive) for (const e of st.enemies) if (e.alive && dist2(e.x, e.y, p.x, p.y) < (e.r + PLAYER_R - 1) ** 2) { playerHit(st, 'crash'); if (!p.alive && e.kind !== 'boss' && e.kind !== 'bomber') killEnemy(st, e, false); break; }
    st.ebullets = st.ebullets.filter((b) => !b.dead);
  }
  st.enemies = st.enemies.filter((e) => e.alive);

  // 아이템
  for (const it of st.items) { it.age += h; it.y += 26 * h; it.x += Math.sin(it.age * 2) * 12 * h; }
  st.items = st.items.filter((it) => it.y < H + 12);
  if (p.alive) for (const it of st.items) if (dist2(it.x, it.y, p.x, p.y) < 11 * 11) { takeItem(st, it); it.taken = true; }
  st.items = st.items.filter((it) => !it.taken);
}

function bossDown(st, e) {
  e.alive = false; st.boss = null;
  st.stats.kills++;
  addScore(st, POINTS.boss);
  emit(st, { t: 'kill', kind: 'boss', x: e.x, y: e.y, pts: POINTS.boss });
  st.ebullets = [];
  for (const o of st.enemies) if (o.alive && o !== e) { o.alive = false; emit(st, { t: 'kill', kind: o.kind, x: o.x, y: o.y, pts: 0 }); }
  const rate = st.stageStats.shots ? st.stageStats.hits / st.stageStats.shots : 0;
  const pct = Math.floor(rate * 100), bonus = pct * 50;
  addScore(st, bonus);
  st.phase = 'clear'; st.phaseT = 4.5;
  emit(st, { t: 'clear', stage: st.stage, pct, bonus });
}

return {
  W, H, PLAYER_SPEED, PLAYER_R, START_LIVES, EXTRA_LIFE_AT, EXTRA_LIFE_EVERY, ROLLS_PER_STAGE, ROLL_TIME, STAGE_TIME, POINTS, ITEM_TYPES,
  rng, newGame, startStage, step, pathPos, makeSchedule, spawnEnemy, dropItem, takeItem, killEnemy, firePlayer,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_1942;
