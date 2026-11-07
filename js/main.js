// Bubble Pop — a toddler webcam game.
// Bubbles float up; wave your hands at the camera to pop them.

import { HandTracker, MAX_HANDS } from './tracker.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const video = $('cam');

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ─── Settings (persisted per device) ─────────────────────────────────────────
const DEFAULTS = {
  speed: 2,            // 1..5
  count: 6,            // target number of bubbles on screen
  sound: true,
  voice: true,
  fps: false,          // fps / perf counter
  debug: false,        // draw raw landmarks
  facing: 'environment',
  quality: 'high',     // canvas resolution: 'high' | 'low'
  hands: MAX_HANDS,    // max hands to track (1..4)
};
const SPEED_MULT = [0, 0.45, 0.7, 1, 1.35, 1.75];
const MIN_COUNT = 2;
const MAX_COUNT = 14;
const SETTINGS_KEY = 'bubblepop.settings.v1';

const settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// ─── Look ────────────────────────────────────────────────────────────────────
const COLORS = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#3ddc84', '#00c2ff', '#7b61ff', '#ff5ec4'];
const HAND_COLORS = ['#fff36b', '#7cf7ff', '#ff9de2', '#b5ff7a'];
const MAX_PARTICLES = 240;
const MAX_RINGS = 24;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// Pre-render bubbles and glows once; drawing sprites is much cheaper than
// building gradients every frame (important on the fanless MacBook).
function makeSprite(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}
const BUBBLE_SPRITES = COLORS.map((col) =>
  makeSprite(256, (g, s) => {
    const r = s / 2 - 4;
    const cx = s / 2;
    const grad = g.createRadialGradient(cx - r * 0.25, cx - r * 0.25, r * 0.1, cx, cx, r);
    grad.addColorStop(0, rgba(col, 0.18));
    grad.addColorStop(0.7, rgba(col, 0.45));
    grad.addColorStop(1, rgba(col, 0.9));
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cx, r, 0, TAU); g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.arc(cx, cx, r - 2, 0, TAU); g.stroke();
    // shiny highlights
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(cx - r * 0.38, cx - r * 0.42, r * 0.22, r * 0.12, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.arc(cx + r * 0.42, cx + r * 0.4, r * 0.07, 0, TAU); g.fill();
  })
);
const GLOW_SPRITES = HAND_COLORS.map((col) =>
  makeSprite(128, (g, s) => {
    const cx = s / 2;
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.25, rgba(col, 0.85));
    grad.addColorStop(0.6, rgba(col, 0.3));
    grad.addColorStop(1, rgba(col, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  })
);

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  started: false,
  paused: false,
  portrait: false,
  W: 0, H: 0, minDim: 1, scale: 1,
  mirror: true,
  mirrorOverride: null,
  bubbles: [],
  particles: [],
  rings: [],
  hands: [],
  rawHands: [],
  spawnTimer: 0,
  popsSinceTalk: 0,
  nextTalkAfter: 3,
  lastTalk: 0,
  lastPopAt: 0,
  lastIdleTalk: 0,
};

const perf = {
  fps: 60,
  frames: 0,
  lastFpsT: performance.now(),
  detectEvery: 2,      // run detection every Nth rendered frame (adaptive 1..3)
  lastAdapt: performance.now(),
  detections: 0,
  detectHz: 0,
  lastDetectAt: 0,
};

const sound = new Sound();
sound.enabled = settings.sound;
sound.voiceEnabled = settings.voice;
const tracker = new HandTracker();
const camera = { stream: null, deviceId: null, facing: settings.facing, active: false };

// ─── Layout ──────────────────────────────────────────────────────────────────
function resize() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  // Cap the canvas pixel count: a 1080p TV doesn't need a 1080p canvas for
  // soft bubbles, and fill rate is the MacBook's bottleneck.
  const budget = settings.quality === 'low' ? 0.5e6 : 1.4e6;
  const scale = Math.min(dpr, Math.sqrt(budget / (W * H)));
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  state.W = W;
  state.H = H;
  state.minDim = Math.min(W, H);
  state.scale = scale;
}
window.addEventListener('resize', resize);

const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
function updatePortrait() {
  state.portrait = portraitMQ.matches;
  document.body.classList.toggle('portrait', state.portrait);
}
portraitMQ.addEventListener?.('change', updatePortrait);

// ─── Bubbles ─────────────────────────────────────────────────────────────────
function pickSpawnX(r) {
  let best = rand(r, state.W - r);
  let bestScore = -1;
  for (let i = 0; i < 8; i++) {
    const x = rand(r, Math.max(r + 1, state.W - r));
    let score = Infinity;
    for (const b of state.bubbles) {
      if (b.y < state.H * 0.55) continue;
      score = Math.min(score, Math.abs(b.x - x) - b.r - r);
    }
    if (score > bestScore) { bestScore = score; best = x; }
  }
  return best;
}

function spawnBubble() {
  const r = state.minDim * rand(0.075, 0.115);
  const x = pickSpawnX(r);
  state.bubbles.push({
    x, baseX: x,
    y: state.H + r + rand(0, state.minDim * 0.08),
    r,
    color: randInt(0, COLORS.length - 1),
    phase: rand(0, TAU),
    wobbleAmp: rand(0.15, 0.35) * r,
    wobbleFreq: rand(0.15, 0.3),
    vy: rand(0.85, 1.15),
    age: 0,
    dead: false,
  });
}

function updateBubbles(dt) {
  const speed = state.minDim * 0.075 * SPEED_MULT[settings.speed];
  for (const b of state.bubbles) {
    b.age += dt;
    b.y -= speed * b.vy * dt;
    b.x = b.baseX + Math.sin(b.age * b.wobbleFreq * TAU + b.phase) * b.wobbleAmp;
    if (b.y < -b.r * 1.3) b.dead = true; // floated away: no penalty, a new one comes
  }
  state.bubbles = state.bubbles.filter((b) => !b.dead);

  // Spawn staggered so bubbles don't arrive in one wall.
  state.spawnTimer -= dt;
  if (state.bubbles.length < settings.count && state.spawnTimer <= 0) {
    spawnBubble();
    state.spawnTimer = rand(0.5, 1.1) / SPEED_MULT[settings.speed];
  }
  // Too many (count was lowered): let extras float away naturally by not
  // respawning; nothing else to do.
}

function popBubble(b) {
  if (b.dead) return;
  b.dead = true;
  const col = COLORS[b.color];
  // particles
  const n = Math.min(16, MAX_PARTICLES - state.particles.length);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.2, 0.2);
    const sp = state.minDim * rand(0.25, 0.6);
    state.particles.push({
      x: b.x + Math.cos(a) * b.r * 0.6,
      y: b.y + Math.sin(a) * b.r * 0.6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: state.minDim * rand(0.01, 0.022),
      color: Math.random() < 0.65 ? col : COLORS[randInt(0, COLORS.length - 1)],
      life: rand(0.7, 1.1),
      maxLife: 1.1,
    });
  }
  if (state.rings.length < MAX_RINGS) {
    state.rings.push({ x: b.x, y: b.y, r: b.r, t: 0, color: col });
  }
  sound.pop(clamp((b.r / state.minDim - 0.075) / 0.04, 0, 1));
  const now = performance.now();
  state.lastPopAt = now;
  maybeTalk(now);
}

function maybeTalk(now) {
  state.popsSinceTalk++;
  if (now - state.lastTalk > 6000 && state.popsSinceTalk >= state.nextTalkAfter) {
    if (sound.say('praise')) {
      state.lastTalk = now;
      state.popsSinceTalk = 0;
      state.nextTalkAfter = randInt(3, 7);
    }
  }
}

function maybeIdleTalk(now) {
  if (!camera.active) return;
  const quietFor = now - Math.max(state.lastPopAt, state.startedAt || 0);
  if (quietFor > 25000 && now - state.lastIdleTalk > 30000 && now - state.lastTalk > 8000) {
    state.lastIdleTalk = now;
    if (sound.say('idle')) state.lastTalk = now;
  }
}

function updateEffects(dt) {
  const drag = Math.exp(-2.2 * dt);
  const grav = state.minDim * 0.35 * dt;
  for (const p of state.particles) {
    p.vx *= drag;
    p.vy = p.vy * drag + grav;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const r of state.rings) r.t += dt;
  state.rings = state.rings.filter((r) => r.t < 0.4);
}

// ─── Hands ───────────────────────────────────────────────────────────────────
// Points we track per hand: palm centre + wrist + five fingertips.
const LM = { WRIST: 0, TIPS: [4, 8, 12, 16, 20], PALM: [0, 5, 9, 13, 17] };
const NP = 7; // 0 = palm, 1 = wrist, 2..6 = fingertips

function videoToScreen(nx, ny) {
  // Same math as CSS object-fit: cover on the <video> element.
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const s = Math.max(state.W / vw, state.H / vh);
  const dw = vw * s;
  const dh = vh * s;
  let x = (state.W - dw) / 2 + nx * dw;
  const y = (state.H - dh) / 2 + ny * dh;
  if (state.mirror) x = state.W - x;
  return [x, y];
}

function landmarksToPoints(lm) {
  const pts = new Float32Array(NP * 2);
  let px = 0, py = 0;
  for (const i of LM.PALM) { px += lm[i].x; py += lm[i].y; }
  const set = (k, nx, ny) => {
    const [x, y] = videoToScreen(nx, ny);
    pts[k * 2] = x;
    pts[k * 2 + 1] = y;
  };
  set(0, px / LM.PALM.length, py / LM.PALM.length);
  set(1, lm[LM.WRIST].x, lm[LM.WRIST].y);
  LM.TIPS.forEach((i, k) => set(k + 2, lm[i].x, lm[i].y));
  return pts;
}

function onDetections(list, t) {
  perf.detections++;
  const dets = list.map(landmarksToPoints);
  if (settings.debug) {
    state.rawHands = list.map((lm) => lm.map((p) => videoToScreen(p.x, p.y)));
  }

  // Match detections to existing hand tracks by palm distance (greedy), so
  // each hand keeps its colour and smoothing state between detections.
  const maxD = state.minDim * 0.4;
  const pairs = [];
  state.hands.forEach((h, hi) => {
    dets.forEach((d, di) => {
      const dist = Math.hypot(h.tgt[0] - d[0], h.tgt[1] - d[1]);
      if (dist < maxD) pairs.push([dist, hi, di]);
    });
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const usedH = new Set();
  const usedD = new Set();
  for (const [, hi, di] of pairs) {
    if (usedH.has(hi) || usedD.has(di)) continue;
    usedH.add(hi);
    usedD.add(di);
    updateTrack(state.hands[hi], dets[di], t);
  }
  dets.forEach((d, di) => {
    if (usedD.has(di) || state.hands.length >= MAX_HANDS) return;
    const usedColors = new Set(state.hands.map((h) => h.color));
    let color = 0;
    while (usedColors.has(color) && color < HAND_COLORS.length - 1) color++;
    state.hands.push({
      color,
      tgt: d,
      disp: Float32Array.from(d),
      prev: Float32Array.from(d),
      vel: new Float32Array(NP * 2),
      tDet: t,
      lastSeen: t,
      alpha: 0.2,
      fresh: true,
    });
  });
}

function updateTrack(h, pts, t) {
  const dt = (t - h.tDet) / 1000;
  const vmax = state.minDim * 5;
  for (let k = 0; k < NP * 2; k++) {
    const v = dt > 0.001 && dt < 0.25 ? (pts[k] - h.tgt[k]) / dt : 0;
    h.vel[k] = clamp(h.vel[k] * 0.4 + v * 0.6, -vmax, vmax);
  }
  h.tgt = pts;
  h.tDet = t;
  h.lastSeen = t;
}

function updateHands(dt, now) {
  // Between detections, ease toward the last detection plus a short
  // velocity extrapolation so the hand glow keeps moving smoothly.
  const k = 1 - Math.exp(-dt * 28);
  for (const h of state.hands) {
    const lead = Math.min((now - h.tDet) / 1000, 0.07);
    h.prev.set(h.disp);
    for (let i = 0; i < NP * 2; i++) {
      h.disp[i] += (h.tgt[i] + h.vel[i] * lead - h.disp[i]) * k;
    }
    if (h.fresh) { h.prev.set(h.disp); h.fresh = false; }
    if (now - h.lastSeen > 220) h.alpha -= dt * 4;
    else h.alpha = Math.min(1, h.alpha + dt * 6);
  }
  state.hands = state.hands.filter((h) => h.alpha > 0);
}

// Distance² from point (px,py) to segment (ax,ay)-(bx,by). Using the segment
// a hand point swept this frame means fast waves still pop bubbles.
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

function handPads(h) {
  // Palm hit zone scales with how big the hand looks (closer = bigger).
  const size = Math.hypot(h.disp[0] - h.disp[2], h.disp[1] - h.disp[3]);
  return {
    palm: Math.max(state.minDim * 0.05, size * 1.1),
    tip: state.minDim * 0.03,
  };
}

function collide() {
  for (const h of state.hands) {
    if (h.alpha < 0.5) continue;
    const pads = handPads(h);
    for (let k = 0; k < NP; k++) {
      const pad = k === 0 ? pads.palm : pads.tip;
      const ax = h.prev[k * 2], ay = h.prev[k * 2 + 1];
      const bx = h.disp[k * 2], by = h.disp[k * 2 + 1];
      for (const b of state.bubbles) {
        if (b.dead || b.y - b.r * 0.3 > state.H) continue;
        const R = b.r + pad;
        if (segDist2(b.x, b.y, ax, ay, bx, by) < R * R) popBubble(b);
      }
    }
  }
}

// Touch / mouse popping too (handy for testing, and fun for little fingers).
function pointerPop(e) {
  if (!state.started || state.paused) return;
  const pad = state.minDim * 0.02;
  for (const b of state.bubbles) {
    const R = b.r + pad;
    if ((b.x - e.clientX) ** 2 + (b.y - e.clientY) ** 2 < R * R) popBubble(b);
  }
}
canvas.addEventListener('pointerdown', pointerPop);
canvas.addEventListener('pointermove', (e) => { if (e.buttons) pointerPop(e); });

// ─── Rendering ───────────────────────────────────────────────────────────────
function render(now) {
  const s = state.scale;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, state.W, state.H);

  // bubbles (with a gentle wobble squish)
  for (const b of state.bubbles) {
    const sq = Math.sin(b.age * 2.2 + b.phase) * 0.035;
    const w = b.r * 2 * (1 + sq);
    const hgt = b.r * 2 * (1 - sq);
    ctx.drawImage(BUBBLE_SPRITES[b.color], b.x - w / 2, b.y - hgt / 2, w, hgt);
  }

  // pop rings (expand and fade, no flashing)
  ctx.lineWidth = Math.max(3, state.minDim * 0.008);
  for (const r of state.rings) {
    const p = r.t / 0.4;
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r * (0.8 + p * 0.6), 0, TAU);
    ctx.stroke();
  }

  // particles
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * (p.life / p.maxLife)), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // hands: glow at the palm, little lights on each fingertip, a sparkle
  for (const h of state.hands) {
    const pads = handPads(h);
    const glow = GLOW_SPRITES[h.color];
    ctx.globalAlpha = clamp(h.alpha, 0, 1) * 0.9;
    const pulse = 1 + Math.sin(now / 300 + h.color) * 0.06;
    const pr = pads.palm * 1.3 * pulse;
    ctx.drawImage(glow, h.disp[0] - pr, h.disp[1] - pr, pr * 2, pr * 2);
    const tr = pads.tip * 1.6;
    for (let k = 2; k < NP; k++) {
      ctx.drawImage(glow, h.disp[k * 2] - tr, h.disp[k * 2 + 1] - tr, tr * 2, tr * 2);
    }
    drawSparkle(h.disp[0], h.disp[1], pads.palm * 0.45, now / 900 + h.color);
  }
  ctx.globalAlpha = 1;

  if (settings.debug) {
    ctx.fillStyle = '#fff';
    for (const lm of state.rawHands) {
      for (const [x, y] of lm) ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
}

function drawSparkle(x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = i % 2 === 0 ? r : r * 0.28;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─── Main loop ───────────────────────────────────────────────────────────────
let lastT = performance.now();
let frame = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.1) dt = 0.1; // tab was hidden or a long hitch: don't jump
  frame++;
  measure(now);

  const running = !state.paused && !state.portrait;
  // Detection runs every Nth frame, and never takes more than about half of
  // the main thread even on a slow machine (gap >= last detection time).
  if (
    running && state.started && camera.active &&
    frame % perf.detectEvery === 0 &&
    now - perf.lastDetectAt >= tracker.detectMs
  ) {
    const res = tracker.detect(video);
    if (res) {
      perf.lastDetectAt = now;
      onDetections(res, performance.now());
    }
  }
  if (running) {
    updateBubbles(dt);
    updateEffects(dt);
    if (state.started) {
      updateHands(dt, now);
      collide();
      maybeIdleTalk(now);
    }
  }
  render(now);
}

function measure(now) {
  perf.frames++;
  const el = now - perf.lastFpsT;
  if (el >= 500) {
    perf.fps = (perf.frames * 1000) / el;
    perf.detectHz = (perf.detections * 1000) / el;
    perf.frames = 0;
    perf.detections = 0;
    perf.lastFpsT = now;
    if (settings.fps) updateFpsText();
  }
  // Adapt how often we run detection based on measured frame rate.
  if (now - perf.lastAdapt > 2000 && tracker.ready && state.started && !state.paused) {
    perf.lastAdapt = now;
    if (perf.fps < 40 && perf.detectEvery < 3) perf.detectEvery++;
    else if (perf.fps > 55 && tracker.detectMs < 7 && perf.detectEvery > 1) perf.detectEvery--;
  }
}

function updateFpsText() {
  const t = tracker;
  $('fps').textContent =
    `${perf.fps.toFixed(0)} fps · detect ${perf.detectHz.toFixed(0)} Hz, ` +
    `${t.detectMs.toFixed(1)} ms, every ${perf.detectEvery} frame${perf.detectEvery > 1 ? 's' : ''} · ` +
    `${t.delegate || 'loading'} · hands ${state.hands.length}/${settings.hands} · ` +
    `cam ${video.videoWidth || 0}×${video.videoHeight || 0}${state.mirror ? ' mirrored' : ''} · ` +
    `canvas ${canvas.width}×${canvas.height}`;
}

// ─── Camera ──────────────────────────────────────────────────────────────────
function stopCamera() {
  if (camera.stream) camera.stream.getTracks().forEach((t) => t.stop());
  camera.stream = null;
  camera.active = false;
}

async function startCamera(facing, deviceId) {
  stopCamera();
  const v = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
  if (deviceId) v.deviceId = { exact: deviceId };
  else v.facingMode = { ideal: facing };
  const stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
  camera.stream = stream;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const s = stream.getVideoTracks()[0].getSettings();
  camera.deviceId = s.deviceId;
  camera.facing = facing;
  camera.active = true;
  // Mirror the front / laptop camera so movement matches the screen.
  // Laptop webcams usually don't report facingMode at all → mirror.
  state.mirror = state.mirrorOverride ?? s.facingMode !== 'environment';
  applyMirror();
  tracker.resetVideo();
  state.hands = [];
  video.classList.add('on');
}

function applyMirror() {
  video.classList.toggle('mirror', state.mirror);
}

async function switchCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const prevId = camera.deviceId;
  const next = camera.facing === 'environment' ? 'user' : 'environment';
  state.mirrorOverride = null;
  try {
    await startCamera(next);
    if (camera.deviceId === prevId) {
      // facingMode didn't change anything (e.g. a laptop): cycle devices.
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (cams.length > 1) {
        const i = cams.findIndex((d) => d.deviceId === prevId);
        await startCamera(next, cams[(i + 1) % cams.length].deviceId);
      } else {
        toast('Only one camera found');
      }
    }
    settings.facing = next;
    saveSettings();
    toast(next === 'environment' ? 'Back camera' : 'Front camera');
  } catch (e) {
    console.error(e);
    toast('Could not switch camera');
    startCamera(camera.facing).catch(() => {});
  }
}

// ─── Wake lock & full screen ─────────────────────────────────────────────────
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('Wake lock unavailable', e);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.started) requestWakeLock();
});

function toggleFullscreen(forceOn = false) {
  const d = document;
  const el = d.documentElement;
  const isFs = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (isFs && !forceOn) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    } else if (!isFs) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req?.call(el, { navigationUI: 'hide' });
      p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  } catch {}
}

// ─── Parent controls ─────────────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

let statusTimer = 0;
function status(msg, ms = 0) {
  const el = $('status');
  el.textContent = msg;
  el.hidden = !msg;
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const actions = {
  pause() {
    state.paused = !state.paused;
    document.body.classList.toggle('paused', state.paused);
    if (state.paused) sound.stopVoice();
    return state.paused ? 'Paused' : 'Playing';
  },
  speedUp() { settings.speed = clamp(settings.speed + 1, 1, 5); return `Speed ${settings.speed}`; },
  speedDown() { settings.speed = clamp(settings.speed - 1, 1, 5); return `Speed ${settings.speed}`; },
  setSpeed(n) { settings.speed = clamp(n, 1, 5); return `Speed ${settings.speed}`; },
  more() { settings.count = clamp(settings.count + 1, MIN_COUNT, MAX_COUNT); return `${settings.count} bubbles`; },
  fewer() { settings.count = clamp(settings.count - 1, MIN_COUNT, MAX_COUNT); return `${settings.count} bubbles`; },
  sound() {
    settings.sound = sound.enabled = !settings.sound;
    if (!settings.sound) sound.stopVoice();
    return settings.sound ? 'Sound on' : 'Sound off';
  },
  voice() {
    settings.voice = sound.voiceEnabled = !settings.voice;
    if (!settings.voice) sound.stopVoice();
    return settings.voice ? 'Voice on' : 'Voice off';
  },
  fps() {
    settings.fps = !settings.fps;
    $('fps').hidden = !settings.fps;
    if (settings.fps) updateFpsText();
    return settings.fps ? 'FPS counter on' : 'FPS counter off';
  },
  debug() {
    settings.debug = !settings.debug;
    state.rawHands = [];
    return settings.debug ? 'Landmarks on' : 'Landmarks off';
  },
  camera() { switchCamera(); return ''; },
  mirror() {
    state.mirror = !state.mirror;
    state.mirrorOverride = state.mirror;
    applyMirror();
    state.hands = [];
    return state.mirror ? 'Mirrored' : 'Not mirrored';
  },
  quality() {
    settings.quality = settings.quality === 'high' ? 'low' : 'high';
    resize();
    return settings.quality === 'high' ? 'High quality' : 'Low power';
  },
  hands() {
    settings.hands = (settings.hands % MAX_HANDS) + 1;
    tracker.setNumHands(settings.hands).catch(console.error);
    return `Track up to ${settings.hands} hand${settings.hands > 1 ? 's' : ''}`;
  },
  fullscreen() { toggleFullscreen(); return ''; },
  help() { $('help').hidden = !$('help').hidden; return ''; },
};

function run(name, arg) {
  const msg = actions[name](arg);
  saveSettings();
  if (msg) toast(msg);
  refreshPanel();
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = {
    p: 'pause', arrowup: 'speedUp', arrowdown: 'speedDown',
    '=': 'more', '+': 'more', arrowright: 'more', '-': 'fewer', _: 'fewer', arrowleft: 'fewer',
    m: 'sound', v: 'voice', c: 'camera', x: 'mirror', q: 'quality', n: 'hands',
    f: 'fullscreen', h: 'help', '?': 'help', escape: null,
  };
  if (k === 'd') { e.preventDefault(); run(e.shiftKey ? 'debug' : 'fps'); return; }
  if (k >= '1' && k <= '5') { run('setSpeed', Number(k)); return; }
  if (k === 'escape') { $('help').hidden = true; closePanel(); return; }
  const name = map[k];
  if (name) {
    e.preventDefault();
    run(name);
  }
});

// Phone: a faint gear that only opens on a long press (~1 s).
const gear = $('gear');
let pressTimer = 0;
const LONG_PRESS_MS = 1000;
gear.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  gear.classList.add('pressing');
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    gear.classList.remove('pressing');
    openPanel();
  }, LONG_PRESS_MS);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  gear.addEventListener(ev, () => {
    clearTimeout(pressTimer);
    gear.classList.remove('pressing');
  });
}
gear.addEventListener('contextmenu', (e) => e.preventDefault());

const panel = $('panel');
let panelTimer = 0;
function openPanel() {
  panel.hidden = false;
  refreshPanel();
  bumpPanelTimer();
}
function closePanel() {
  panel.hidden = true;
  clearTimeout(panelTimer);
}
function bumpPanelTimer() {
  clearTimeout(panelTimer);
  panelTimer = setTimeout(closePanel, 30000); // auto-close if forgotten
}
panel.addEventListener('click', (e) => {
  bumpPanelTimer();
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'close') closePanel();
  else run(a);
});

function refreshPanel() {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('pv-pause', state.paused ? '▶ Resume' : '⏸ Pause');
  set('pv-speed', String(settings.speed));
  set('pv-count', String(settings.count));
  set('pv-sound', settings.sound ? '🔊 Sound on' : '🔇 Sound off');
  set('pv-voice', settings.voice ? '🗣 Voice on' : '🤐 Voice off');
  set('pv-fps', settings.fps ? 'FPS: on' : 'FPS: off');
  set('pv-mirror', state.mirror ? '↔ Mirrored' : '↔ Not mirrored');
  set('pv-quality', settings.quality === 'high' ? 'Quality: high' : 'Quality: low power');
  set('pv-hands', `✋ Hands: ${settings.hands}`);
}

// ─── Start ───────────────────────────────────────────────────────────────────
const trackerLoading = tracker.init(settings.hands).catch((e) => {
  console.error(e);
  throw e;
});
trackerLoading.catch(() => {}); // handled after Start

$('start').addEventListener('click', async () => {
  // Audio + speech must be unlocked synchronously inside the tap.
  sound.unlock();
  sound.say('start');
  toggleFullscreen(true);
  requestWakeLock();

  $('startScreen').hidden = true;
  state.started = true;
  state.startedAt = performance.now();
  state.lastPopAt = state.startedAt;

  if (!navigator.mediaDevices?.getUserMedia) {
    status('No camera access here (needs https or localhost). You can still pop bubbles by touching them.', 9000);
    return;
  }
  status('Starting camera…');
  try {
    await startCamera(settings.facing);
  } catch (e) {
    console.error(e);
    status('Camera not available. You can still pop bubbles by touching them.', 9000);
    return;
  }
  if (!tracker.ready) status('Loading hand tracker…');
  try {
    await trackerLoading;
    status(`Hand tracking ready (${tracker.delegate})`, 2500);
  } catch {
    status('Hand tracker failed to load. Check the internet connection and reload.', 10000);
  }
});

// Small hook for testing from the dev console.
window.bubblePop = { state, settings, perf, tracker, onDetections };

// Boot
resize();
updatePortrait();
$('fps').hidden = !settings.fps;
refreshPanel();
requestAnimationFrame(loop);
