'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 1942: 화면·입력·소리. 규칙(내 비행기·적 편대·총알·POW·보스)은 logic.js (LOGIC_1942) 에 있고,
// 여기서는 규칙이 남긴 st.events 를 보고 소리·폭발·안내를 만든다.
const L = LOGIC_1942;
const { W, H } = L;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(160, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('game1942Muted') === '1';
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step));
let shotTick = 0;
const sfx = {
  shot: () => { if ((shotTick++ & 1) === 0) tone(880, 0.04, 'square', 0.02, -300); },
  efire: () => tone(300, 0.05, 'sawtooth', 0.015, -100),
  hit: () => tone(420, 0.04, 'square', 0.025, -200),
  boom: () => { noise(0.22, 0.08, 1100); tone(140, 0.2, 'sawtooth', 0.04, -70); },
  big: () => { noise(0.7, 0.14, 700); tone(110, 0.7, 'sawtooth', 0.07, -60); },
  crash: () => { noise(0.7, 0.14, 800); tone(150, 0.6, 'sawtooth', 0.07, -90); },
  roll: () => tone(300, 0.5, 'sine', 0.05, 700),
  pickup: () => melody([660, 880, 1100, 1320], 70, 'sine', 0.08),
  pow: () => melody([880, 1320], 90, 'sine', 0.06),
  life: () => melody([1047, 1319, 1568, 2093], 90, 'square', 0.05),
  start: () => melody([392, 523, 659, 784], 110),
  warn: () => melody([220, 0, 220, 0, 220], 130, 'sawtooth', 0.06),
  clear: () => melody([523, 659, 784, 1047, 1319], 110),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let pausedFrom = null;
let best = Number(store.get('game1942Best')) || 0;
let fxs = [];                                  // 폭발·글씨 { kind, x, y, t, life, text, big }
let banner = { text: '', sub: '', t: 0, color: '#ffe14a' };
let clock = 0, scroll = 0;
let lastMoved = 0;

/* @test-hooks:start */
window.__ww = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
const held = new Set();
const keyDir = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
const FIRE_KEYS = [' ', 'z', 'Z', 'j', 'J'];
const ROLL_KEYS = ['x', 'X', 'k', 'K', 'Shift'];
let fireKey = false, fireTouch = false, rollQueued = false;
let padVec = null;
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key in keyDir) { e.preventDefault(); held.add(e.key); return; }
  if (FIRE_KEYS.includes(e.key)) {
    e.preventDefault();
    if (state === 'title' || state === 'over') { if (!e.repeat && e.key === ' ') onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
    fireKey = true;
    return;
  }
  if (ROLL_KEYS.includes(e.key)) { e.preventDefault(); if (!e.repeat && state === 'play') rollQueued = true; return; }
  if (e.key === 'Enter') { if (state === 'title' || state === 'over') onOverlayButton(); else if (state === 'paused') resume(); return; }
  if (e.key === 'p' || e.key === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});
addEventListener('keyup', (e) => { held.delete(e.key); if (FIRE_KEYS.includes(e.key)) fireKey = false; });

const pad = $('pad');
const PAD_DIRS = ['u', 'd', 'l', 'r'];
function padFrom(e) {
  const r = pad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const rad = r.width / 2, m = Math.hypot(dx, dy);
  if (m < rad * 0.12) padVec = null;
  else { const k = Math.min(1, m / (rad * 0.75)); padVec = { dx: dx / m * k, dy: dy / m * k }; }
  const knob = pad.querySelector('b'), lim = r.width * 0.2;
  knob.style.transform = `translate(${Math.max(-lim, Math.min(lim, dx))}px, ${Math.max(-lim, Math.min(lim, dy))}px)`;
  const on = { u: padVec && padVec.dy < -0.35, d: padVec && padVec.dy > 0.35, l: padVec && padVec.dx < -0.35, r: padVec && padVec.dx > 0.35 };
  pad.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', !!on[PAD_DIRS[i]]));
}
const padEnd = () => { padVec = null; pad.querySelector('b').style.transform = ''; pad.querySelectorAll('i').forEach((el) => el.classList.remove('on')); };
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (_) {} padFrom(e); });
pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') padFrom(e); });
pad.addEventListener('pointerup', padEnd);
pad.addEventListener('pointercancel', padEnd);
const fireBtn = $('fireBtn'), rollBtn = $('rollBtn');
fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {} fireTouch = true; fireBtn.classList.add('on'); });
const fireOff = () => { fireTouch = false; fireBtn.classList.remove('on'); };
fireBtn.addEventListener('pointerup', fireOff);
fireBtn.addEventListener('pointercancel', fireOff);
rollBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'play') rollQueued = true; rollBtn.classList.add('on'); });
const rollOff = () => rollBtn.classList.remove('on');
rollBtn.addEventListener('pointerup', rollOff);
rollBtn.addEventListener('pointercancel', rollOff);

function readInput() {
  let dx = 0, dy = 0;
  for (const k of held) { const d = keyDir[k]; if (d) { dx += d[0]; dy += d[1]; } }
  if (padVec) { dx += padVec.dx; dy += padVec.dy; }
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  const input = { dx, dy, fire: fireKey || fireTouch, roll: rollQueued };
  rollQueued = false;
  return input;
}

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', color = '#ffe14a', t = 2.4) { banner = { text, sub, t, color }; }
function startGame() {
  G = L.newGame();
  if (/[?&]tutorial=1/.test(location.search)) G.player.rolls = 9;          // 튜토리얼에서는 회전 단계를 못 하는 일이 없게
  fxs = []; lastMoved = 0; scroll = 0; held.clear();
  state = 'play';
  setBanner('STAGE 1', 'GET READY');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused';
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('game1942Best', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>${G.stage}단계 · 격추 ${G.stats.kills}대${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'shot') { sfx.shot(); tutorialSignal('fire'); }
    else if (e.t === 'efire') sfx.efire();
    else if (e.t === 'hit') sfx.hit();
    else if (e.t === 'kill') {
      if (e.kind === 'boss') { sfx.big(); for (let i = 0; i < 6; i++) fxs.push({ kind: 'boom', x: e.x + (Math.random() - 0.5) * 40, y: e.y + (Math.random() - 0.5) * 24, t: -i * 0.12, life: 0.7, big: true }); }
      else { sfx.boom(); fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.45, big: e.kind === 'bomber' }); }
      if (e.pts) fxs.push({ kind: 'text', x: e.x, y: e.y - 6, t: 0, life: 0.9, text: String(e.pts) });
      tutorialSignal('kill');
    }
    else if (e.t === 'crash') { sfx.crash(); fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.8, big: true }); }
    else if (e.t === 'roll') { sfx.roll(); tutorialSignal('roll'); }
    else if (e.t === 'pow') sfx.pow();
    else if (e.t === 'pickup') { sfx.pickup(); tutorialSignal('pickup'); }
    else if (e.t === 'extraLife') sfx.life();
    else if (e.t === 'bomb') fxs.push({ kind: 'flash', x: 0, y: 0, t: 0, life: 0.4 });
    else if (e.t === 'boss') { sfx.warn(); setBanner('WARNING!', 'BOSS APPROACHING', '#ff5a5a', 2.6); }
    else if (e.t === 'clear') { sfx.clear(); setBanner('STAGE CLEAR', `HIT RATE ${e.pct}%  BONUS ${e.bonus}`, '#7fe08a', 4); }
    else if (e.t === 'stage') { if (e.stage > 1) { setBanner(`STAGE ${e.stage}`, 'GET READY'); sfx.start(); } }
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  scroll += dt * 34;
  L.step(G, dt, readInput());
  handleEvents();
  const mv = G.player.moved;
  if (mv - lastMoved >= 12) { lastMoved = mv; tutorialSignal('move'); }
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
}

// ---------- 그리기 ----------
const hash = (n) => { let x = Math.imul(n ^ 0x9E3779B1, 0x85EBCA6B); x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
function drawSea() {
  ctx.fillStyle = '#1b5fbd'; ctx.fillRect(0, 0, W, H);
  // 파도 줄무늬
  ctx.fillStyle = '#2b78d8';
  const row = 14;
  const r0 = Math.floor(scroll / row);
  for (let i = -1; i <= H / row + 1; i++) {
    const idx = r0 - i, y = Math.round(((i * row) + (scroll % row)));
    for (let k = 0; k < 3; k++) { const x = Math.floor(hash(idx * 7 + k) * (W + 20)) - 10; ctx.fillRect(x, y, 14 + Math.floor(hash(idx * 3 + k) * 10), 1); }
  }
  // 섬: 구간(높이 150)마다 0~2개
  const chunk = 150;
  const c0 = Math.floor(scroll / chunk);
  for (let i = -1; i <= Math.ceil(H / chunk) + 1; i++) {
    const idx = c0 - i + 1;
    for (let k = 0; k < 2; k++) {
      if (hash(idx * 11 + k * 5) < 0.45) continue;
      const w = 30 + hash(idx * 13 + k) * 56, h = 22 + hash(idx * 17 + k) * 34;
      const x = hash(idx * 19 + k * 3) * (W - w * 0.4) - w * 0.3;
      const y = ((i * chunk) + (scroll % chunk)) + hash(idx * 23 + k) * (chunk - h) - chunk * 0.3 + (k * 40);
      ctx.fillStyle = '#e8d49a'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 + 3, h / 2 + 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d8c34'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 1, h / 2 - 1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a6a26'; ctx.beginPath(); ctx.ellipse(x + w / 2 + 2, y + h / 2 + 2, w / 4, h / 4, 0, 0, 7); ctx.fill();
    }
  }
}
function drawPlayer(p) {
  if (!p.alive) return;
  const blink = p.invuln > 0 && Math.floor(clock * 14) % 2 === 0;
  if (blink) return;
  const prog = p.roll > 0 ? 1 - p.roll / L.ROLL_TIME : 0;
  const sc = p.roll > 0 ? 1 + 0.55 * Math.sin(Math.PI * prog) : 1;
  const flip = p.roll > 0 ? Math.cos(prog * Math.PI * 2) : 1;
  ctx.save();
  ctx.translate(p.x, p.y); ctx.scale(sc * Math.abs(flip < 0 ? -flip * 0.6 + 0.4 : flip * 0.6 + 0.4), sc);
  ctx.fillStyle = '#8fa4bd'; ctx.fillRect(-13, -2, 26, 5);                                 // 주날개
  ctx.fillStyle = '#c9d6e6'; ctx.fillRect(-13, -2, 26, 2);
  ctx.fillStyle = '#6d86a3'; ctx.fillRect(-9, -8, 3, 14); ctx.fillRect(6, -8, 3, 14);        // 쌍동체
  ctx.fillStyle = '#c9d6e6'; ctx.fillRect(-2, -8, 4, 14);                                   // 가운데 동체
  ctx.fillStyle = '#2a4a7a'; ctx.fillRect(-1, -4, 2, 4);                                    // 조종석
  ctx.fillStyle = '#8fa4bd'; ctx.fillRect(-8, 5, 16, 2);                                    // 꼬리날개
  ctx.fillStyle = '#e8453a'; ctx.fillRect(-12, -2, 2, 2); ctx.fillRect(10, -2, 2, 2);       // 날개 끝 표시
  ctx.fillStyle = '#ffd84a'; ctx.fillRect(-8, -9, 1, 1); ctx.fillRect(7, -9, 1, 1);          // 프로펠러
  ctx.restore();
  if (p.wing) for (const sx of [-18, 18]) {                                                    // 호위기
    ctx.fillStyle = '#7f95b0'; ctx.fillRect(p.x + sx - 5, p.y - 1, 10, 3); ctx.fillRect(p.x + sx - 1, p.y - 5, 2, 9);
    ctx.fillStyle = '#e8453a'; ctx.fillRect(p.x + sx - 5, p.y - 1, 1, 2);
  }
}
function drawSmallPlane(e, body, wing, accent) {
  ctx.save();
  ctx.translate(e.x, e.y); ctx.rotate(Math.atan2(e.hx, -e.hy));
  ctx.fillStyle = wing; ctx.fillRect(-9, -1, 18, 4);
  ctx.fillStyle = body; ctx.fillRect(-2, -8, 4, 14);
  ctx.fillRect(-4, 4, 8, 2);
  ctx.fillStyle = accent; ctx.fillRect(-1, -9, 2, 2); ctx.fillRect(-9, -1, 2, 2); ctx.fillRect(7, -1, 2, 2);
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(-1, -3, 2, 2);
  ctx.restore();
}
function drawBomber(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = '#5a6e4a'; ctx.fillRect(-20, -3, 40, 8);
  ctx.fillStyle = '#7a8e66'; ctx.fillRect(-4, -14, 8, 30);
  ctx.fillStyle = '#4a5a3c'; ctx.fillRect(-9, 12, 18, 3);
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-14, -8, 4, 7); ctx.fillRect(10, -8, 4, 7);           // 엔진
  ctx.fillStyle = '#e8453a'; ctx.fillRect(-19, -2, 3, 3); ctx.fillRect(16, -2, 3, 3);
  ctx.fillStyle = '#c8d4c0'; ctx.fillRect(-2, -8, 4, 4);
  ctx.restore();
  hpBar(e, 14, 1);
}
function drawBoss(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = '#4c5a66'; ctx.fillRect(-40, -6, 80, 14);
  ctx.fillStyle = '#6a7c8a'; ctx.fillRect(-9, -24, 18, 52);
  ctx.fillStyle = '#3a4650'; ctx.fillRect(-18, 20, 36, 5);
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-30, -14, 8, 16); ctx.fillRect(22, -14, 8, 16);
  ctx.fillStyle = '#a8b4bf'; ctx.fillRect(-4, -18, 8, 8);
  ctx.fillStyle = '#e8453a'; ctx.fillRect(-38, -4, 6, 6); ctx.fillRect(32, -4, 6, 6);
  ctx.fillStyle = Math.floor(clock * 6) % 2 ? '#ff7a3a' : '#c83a1a'; ctx.fillRect(-14, -2, 5, 5); ctx.fillRect(9, -2, 5, 5);
  ctx.restore();
  hpBar(e, 30, e.hp / e.maxHp);
}
function hpBar(e, half, frac) {
  if (frac >= 1 && e.kind !== 'boss') return;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(e.x - half, e.y - half - 8, half * 2, 3);
  ctx.fillStyle = '#ff5a5a'; ctx.fillRect(e.x - half, e.y - half - 8, Math.max(0, half * 2 * frac), 3);
}
const ITEM_LABEL = { quad: 'G', wing: 'W', bomb: 'B', roll: 'R', life: '1UP' };
function drawItems() {
  for (const it of G.items) {
    ctx.fillStyle = Math.floor(clock * 5) % 2 ? '#e83a3a' : '#f6f6f6'; ctx.fillRect(it.x - 8, it.y - 6, 16, 12);
    ctx.fillStyle = Math.floor(clock * 5) % 2 ? '#f6f6f6' : '#e83a3a'; ctx.fillRect(it.x - 7, it.y - 5, 14, 10);
    ctx.fillStyle = Math.floor(clock * 5) % 2 ? '#e83a3a' : '#222'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.type === 'life' ? '1UP' : 'POW', it.x, it.y);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.fillText(ITEM_LABEL[it.type], it.x, it.y + 11);
  }
}
function drawBullets() {
  ctx.fillStyle = '#ffe566';
  for (const b of G.bullets) ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 4), 2, 7);
  for (const b of G.ebullets) {
    ctx.fillStyle = '#ff5a8a'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.8, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 1), 2, 2);
  }
}
function drawFx() {
  for (const f of fxs) {
    if (f.t < 0) continue;
    const k = f.t / f.life;
    if (f.kind === 'boom') {
      const r = (f.big ? 22 : 11) * (0.35 + k);
      ctx.fillStyle = k < 0.5 ? '#ffd23a' : '#e8561e'; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.fill();
      ctx.fillStyle = k < 0.5 ? '#fff' : '#ffd23a'; ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.5, 0, 7); ctx.fill();
    } else if (f.kind === 'text') {
      ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText(f.text, f.x, f.y - k * 10);
    } else if (f.kind === 'flash') { ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; ctx.fillRect(0, 0, W, H); }
  }
}
function drawHud() {
  ctx.textBaseline = 'top';
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = '#ff6a6a'; ctx.fillText('1UP', 4, 3);
  ctx.fillStyle = '#fff'; ctx.fillText(String(G.score), 24, 3);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ff6a6a'; ctx.fillText('HI', W / 2 - 12, 3); ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(best, G.score)), W / 2 + 12, 3);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffe14a'; ctx.fillText(`STAGE ${G.stage}`, W - 48, 3);
  // 목숨(작은 비행기)과 남은 회전 (R)
  for (let i = 0; i < Math.max(0, G.lives - (G.player.alive ? 1 : 0)); i++) {
    const x = 10 + i * 14;
    ctx.fillStyle = '#c9d6e6'; ctx.fillRect(x - 5, H - 10, 10, 3); ctx.fillRect(x - 1, H - 14, 2, 9);
  }
  ctx.textAlign = 'right'; ctx.fillStyle = '#7fd0ff'; ctx.font = 'bold 9px sans-serif';
  ctx.fillText('R'.repeat(Math.min(9, G.player.rolls)), W - 4, H - 13);
}
function draw() {
  drawSea();
  drawItems();
  for (const e of G.enemies) {
    if (e.kind === 'boss') drawBoss(e);
    else if (e.kind === 'bomber') drawBomber(e);
    else if (e.kind === 'red') drawSmallPlane(e, '#e8453a', '#b82a2a', '#ffe14a');
    else drawSmallPlane(e, '#4f9a3a', '#3a7a2a', '#f2f2f2');
  }
  drawPlayer(G.player);
  drawBullets();
  drawFx();
  drawHud();
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, H / 2 - 30, W, banner.sub ? 40 : 26);
    ctx.fillStyle = banner.color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, H / 2 - 18);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, H / 2 - 2); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('game1942Muted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
