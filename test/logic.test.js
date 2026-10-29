'use strict';
// 1942 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const DT = 1 / 60;
const NONE = { dx: 0, dy: 0, fire: false, roll: false };
const run = (st, sec, inp = NONE) => { for (let t = 0; t < sec - 1e-9; t += DT) L.step(st, DT, inp); };
// 적이 저절로 나오지 않는 빈 판
function calm(seed = 1) {
  const st = L.newGame(L.rng(seed));
  st.schedule = []; st.next = 0; st.player.invuln = 0;
  st.t = 0;
  return st;
}
const enemy = (st, kind, x, y, extra = {}) => {
  const e = { id: ++st.seq, kind, pat: { type: 'hold', x0: x, y0: y, speed: 1 }, age: 0, group: 0, alive: true, x, y, hx: 0, hy: 1, hp: 1, r: 7, shootT: 1e9, ...extra };
  st.enemies.push(e); return e;
};

test('paths: a line fighter enters from the top, a bottom one from below, a loop returns to where it started', () => {
  const line = { type: 'line', x0: 100, amp: 20, freq: 2, speed: 1 };
  assert.ok(L.pathPos(line, 0).y < 0);
  assert.ok(L.pathPos(line, 4).y > 200);
  const bottom = { type: 'bottom', x0: 100, amp: 20, freq: 2, speed: 1 };
  assert.ok(L.pathPos(bottom, 0).y > L.H);
  const loop = { type: 'loop', x0: 100, ys: 80, radius: 22, dir: 1, speed: 1 };
  const t1 = (80 + 14) / 92, tl = 2 * Math.PI * 22 / 92;
  const a = L.pathPos(loop, t1), b = L.pathPos(loop, t1 + tl - 1e-6);
  assert.ok(Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1);
  assert.ok(L.pathPos(loop, t1 + tl + 1).y > 80);
  let maxX = 0;
  for (let t = t1; t < t1 + tl; t += 0.02) maxX = Math.max(maxX, Math.abs(L.pathPos(loop, t).x - 100));
  assert.ok(maxX > 15 && maxX < 50, 'circle of about the radius');
});

test('a stage schedule is sorted, has groups of five red planes and middle bombers', () => {
  for (let stage = 1; stage <= 6; stage++) {
    const s = L.makeSchedule(stage, L.rng(stage));
    for (let i = 1; i < s.length; i++) assert.ok(s[i].at >= s[i - 1].at);
    assert.ok(s[0].at <= 4, 'the first wave comes quickly');
    assert.ok(s.every((e) => e.at < L.STAGE_TIME));
    const reds = {};
    s.filter((e) => e.kind === 'red').forEach((e) => { reds[e.group] = (reds[e.group] || 0) + 1; });
    assert.ok(Object.keys(reds).length >= 2, 'POW carriers');
    for (const n of Object.values(reds)) assert.strictEqual(n, 5);
    assert.ok(s.filter((e) => e.kind === 'bomber').length >= 1);
  }
  const fast = L.makeSchedule(8, L.rng(1))[0].pat.speed, slow = L.makeSchedule(1, L.rng(1))[0].pat.speed;
  assert.ok(fast > slow);
});

test('the plane moves by input and stays inside the screen', () => {
  const st = calm();
  const x0 = st.player.x;
  run(st, 0.5, { dx: 1, dy: 0, fire: false });
  assert.ok(Math.abs(st.player.x - x0 - L.PLAYER_SPEED * 0.5) < 1);
  run(st, 5, { dx: 1, dy: -1, fire: false });
  assert.ok(st.player.x <= L.W - 8 + 1e-6 && st.player.y >= 14 - 1e-6);
  run(st, 5, { dx: -1, dy: 1, fire: false });
  assert.ok(st.player.x >= 8 - 1e-6 && st.player.y <= L.H - 14 + 1e-6);
  const s2 = calm();
  run(s2, 1, { dx: 1, dy: 1, fire: false });
  const d = Math.hypot(s2.player.x - L.W / 2, s2.player.y - (L.H - 40));
  assert.ok(d > 0 && d <= L.PLAYER_SPEED + 1, 'diagonal is not faster');
});

test('holding fire shoots twin bullets at a steady rate, capped on screen', () => {
  const st = calm();
  run(st, 1, { dx: 0, dy: 0, fire: true });
  assert.ok(st.stats.shots >= 2 * 5 && st.stats.shots <= 2 * 8, `shots ${st.stats.shots}`);
  assert.ok(st.bullets.length <= 14);
  const s2 = calm(); s2.player.y = L.H - 20;
  run(s2, 0.1, { dx: 0, dy: 0, fire: false });
  assert.strictEqual(s2.stats.shots, 0);
});

test('quad guns add diagonal bullets and wingmen add side bullets', () => {
  const a = calm(); a.player.gun = 1; a.player.wing = 0; L.firePlayer(a);
  assert.strictEqual(a.bullets.length, 4);
  assert.ok(a.bullets.some((b) => b.vx < 0) && a.bullets.some((b) => b.vx > 0));
  const b = calm(); b.player.wing = 1; L.firePlayer(b);
  assert.strictEqual(b.bullets.length, 4);
  const c = calm(); c.player.wing = 1; c.player.gun = 1; L.firePlayer(c);
  assert.strictEqual(c.bullets.length, 6);
});

test('shooting down a plane scores 100 and counts a hit and a kill', () => {
  const st = calm();
  const e = enemy(st, 'zero', st.player.x, 100);
  run(st, 1.2, { dx: 0, dy: 0, fire: true });
  assert.ok(!e.alive);
  assert.strictEqual(st.score, 100);
  assert.strictEqual(st.stats.kills, 1);
  assert.ok(st.stats.hits >= 1);
});

test('a medium bomber takes several hits and is worth 800', () => {
  const st = calm();
  const e = enemy(st, 'bomber', st.player.x, 90, { hp: 5, r: 12 });
  run(st, 0.5, { dx: 0, dy: 0, fire: true });
  assert.ok(e.alive && e.hp < 5);
  run(st, 2, { dx: 0, dy: 0, fire: true });
  assert.ok(!e.alive);
  assert.strictEqual(st.score, 800);
});

test('five red planes in a row leave a POW only if all five are shot down', () => {
  const mk = (escape) => {
    const st = calm();
    st.groups[9] = { size: 5, killed: 0, gone: 0, kind: 'red' };
    const reds = [0, 1, 2, 3, 4].map((i) => enemy(st, 'red', 40 + i * 30, 60, { group: 9 }));
    if (escape) { st.groups[9].gone = 1; }
    reds.forEach((e) => L.killEnemy(st, e, true));
    return st;
  };
  assert.strictEqual(mk(false).items.length, 1);
  assert.strictEqual(mk(true).items.length, 0);
  const st = calm();
  st.groups[9] = { size: 5, killed: 0, gone: 0, kind: 'red' };
  [0, 1, 2, 3].forEach((i) => L.killEnemy(st, enemy(st, 'red', 40 + i * 30, 60, { group: 9 }), true));
  assert.strictEqual(st.items.length, 0);
});

test('power-ups: quad, wingmen, extra roll, extra life, and the bomb', () => {
  const st = calm();
  const take = (type) => { st.items = [{ x: st.player.x, y: st.player.y, type, age: 0 }]; run(st, 0.02); };
  take('quad'); assert.strictEqual(st.player.gun, 1);
  take('wing'); assert.strictEqual(st.player.wing, 1);
  const r0 = st.player.rolls; take('roll'); assert.strictEqual(st.player.rolls, r0 + 1);
  const l0 = st.lives; take('life'); assert.strictEqual(st.lives, l0 + 1);
  assert.strictEqual(st.score, 4 * L.POINTS.pow);
  const z = enemy(st, 'zero', 50, 80), b = enemy(st, 'bomber', 150, 80, { hp: 5, r: 12 });
  st.ebullets.push({ x: 10, y: 10, vx: 0, vy: 0 });
  take('bomb');
  assert.ok(!z.alive && b.alive);
  assert.strictEqual(st.ebullets.length, 0);
});

test('a roll makes the plane safe for a second, uses one of three, and cannot shoot', () => {
  const st = calm();
  assert.strictEqual(st.player.rolls, 3);
  L.step(st, DT, { dx: 0, dy: 0, fire: false, roll: true });
  assert.strictEqual(st.player.rolls, 2);
  assert.ok(st.player.roll > 0.9);
  st.ebullets.push({ x: st.player.x, y: st.player.y, vx: 0, vy: 0 });
  run(st, 0.1, { dx: 0, dy: 0, fire: true });
  assert.strictEqual(st.lives, L.START_LIVES, 'bullets pass through');
  assert.strictEqual(st.stats.shots, 0);
  run(st, 1);
  assert.strictEqual(st.player.roll, 0);
  st.player.rolls = 0;
  L.step(st, DT, { dx: 0, dy: 0, fire: false, roll: true });
  assert.strictEqual(st.player.roll, 0, 'no rolls left');
});

test('an enemy bullet costs a life, the plane comes back later with a shield and loses its power-ups', () => {
  const st = calm();
  st.player.gun = 1; st.player.wing = 1;
  st.ebullets.push({ x: st.player.x, y: st.player.y, vx: 0, vy: 0 });
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.strictEqual(st.player.alive, false);
  assert.strictEqual(st.player.gun, 0);
  assert.strictEqual(st.player.wing, 0);
  run(st, 1.7);
  assert.strictEqual(st.player.alive, true);
  assert.ok(st.player.invuln > 1);
  st.ebullets.push({ x: st.player.x, y: st.player.y, vx: 0, vy: 0 });
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES - 1);
});

test('flying into a plane also costs a life', () => {
  const st = calm();
  const e = enemy(st, 'zero', st.player.x, st.player.y);
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.ok(!e.alive, 'the small plane blows up too');
});

test('no lives left ends the game', () => {
  const st = calm();
  st.lives = 1;
  st.ebullets.push({ x: st.player.x, y: st.player.y, vx: 0, vy: 0 });
  run(st, 0.05);
  assert.strictEqual(st.lives, 0);
  run(st, 2.2);
  assert.strictEqual(st.phase, 'over');
});

test('enemy bullets are aimed at the plane', () => {
  const st = calm();
  st.rand = () => 0;                                           // 항상 쏘게
  const e = enemy(st, 'zero', 40, 100, { shootT: 0 });
  st.player.x = 180; st.player.y = 230;
  run(st, 0.05);
  const b = st.ebullets[0];
  assert.ok(b && b.vx > 0 && b.vy > 0);
  const want = Math.atan2(230 - 100, 180 - 40), got = Math.atan2(b.vy, b.vx);
  assert.ok(Math.abs(want - got) < 0.05, 'aimed at the plane');
  assert.ok(e);
});

test('the boss comes when the stage time is up, and beating it clears the stage with a hit-rate bonus', () => {
  const st = L.newGame(L.rng(3));
  st.schedule = []; st.player.invuln = 99;
  run(st, L.STAGE_TIME + 0.5);
  assert.ok(st.boss, 'boss');
  const boss = st.boss;
  assert.ok(boss.hp >= 60);
  st.stageStats = { shots: 100, hits: 62 };
  boss.hp = 1;
  for (let i = 0; i < 60 * 8 && boss.alive; i++) {          // 보스 아래로 따라가며 쏜다
    const dx = Math.max(-1, Math.min(1, (boss.x - st.player.x) / 6));
    L.step(st, DT, { dx, dy: 0, fire: true, roll: false });
    st.player.invuln = 99;
  }
  assert.ok(!boss.alive);
  const clear = st.events.find((e) => e.t === 'clear') || { bonus: -1, pct: -1 };
  assert.ok(clear.pct > 30 && clear.pct <= 100, 'hit rate shown');
  assert.strictEqual(clear.bonus, clear.pct * 50);
  assert.ok(st.score >= L.POINTS.boss + clear.bonus);
  assert.strictEqual(st.phase, 'clear');
  run(st, 5);
  assert.strictEqual(st.stage, 2);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.player.rolls, L.ROLLS_PER_STAGE);
  assert.ok(st.schedule.length > 10);
});

test('extra life at 20000 points', () => {
  const st = calm();
  st.score = 19950;
  L.killEnemy(st, enemy(st, 'zero', 50, 50), true);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
});

test('random play for several minutes keeps everything sane', () => {
  const rand = L.rng(42);
  for (let g = 0; g < 5; g++) {
    const st = L.newGame(L.rng(300 + g));
    const inp = { dx: 0, dy: 0, fire: true, roll: false };
    for (let i = 0; i < 60 * 130 && st.phase !== 'over'; i++) {
      if (i % 20 === 0) { inp.dx = Math.floor(rand() * 3) - 1; inp.dy = Math.floor(rand() * 3) - 1; inp.roll = rand() < 0.08; }
      L.step(st, DT, inp);
      const p = st.player;
      assert.ok(p.x >= 8 - 1e-6 && p.x <= L.W - 8 + 1e-6 && p.y >= 14 - 1e-6 && p.y <= L.H - 14 + 1e-6);
      assert.ok(st.lives >= 0 && st.score >= 0);
      assert.ok(st.bullets.length <= 26);
      for (const e of st.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    }
  }
});
