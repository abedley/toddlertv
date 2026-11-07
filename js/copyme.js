// Copy Me — a friendly character strikes a simple pose and the child copies
// it. Uses MediaPipe Pose landmarks. No timers, no losing: the character
// waits patiently, re-asks now and then, and eventually just tries another
// pose. Only the upper body is used, so the child's legs don't need to be in
// view.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// How long (seconds, cumulative) the child must match the pose.
const HOLD_NEEDED = 0.6;
const REPROMPT_EVERY = 10;   // s
const SUCCESS_TIME = 2.8;    // s of celebration
const MAX_CONFETTI = 160;

// Pose landmark indices (MediaPipe Pose, 33 points).
const P = { NOSE: 0, LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24 };
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
const SKELETON_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24];

// ─── Poses ───────────────────────────────────────────────────────────────────
// `hand` is where the character's right hand goes, in body-radius units
// relative to the body centre (x outward, y down). The left arm mirrors it
// unless `left` is given. `check(b, game)` tests the child's pose.
const IDLE_HAND = [1.15, 1.45];

const both = (b, fn) => fn(b, b.L) && fn(b, b.R);
const either = (b, fn) => fn(b, b.L) || fn(b, b.R);

// Optional per pose:
//   animate(t, R, L)  → { R, L } to move the character's hands over time
//   body(t)           → { tilt, hop } to lean or bounce the whole character
const POSES = {
  armsUp: {
    label: 'Reach up high!',
    say: ['Reach up high!', 'Arms up to the sky!', 'Can you reach up high like me?'],
    hand: [1.05, -1.9],
    check: (b) => both(b, (b, a) => isUp(b, a, 0.9)),
  },
  armsOut: {
    label: 'Arms out wide!',
    say: ['Arms out wide, like an airplane!', 'Stretch your arms out wide!'],
    hand: [2.6, -0.05],
    check: (b) => both(b, isOut),
  },
  oneArmUp: {
    label: 'Wave one hand up high!',
    say: ['Wave one hand up high!', 'Wave hello up high!'],
    hand: [1.35, -1.8],
    left: IDLE_HAND,
    animate: (t, R, L) => ({ R: [R[0] + 0.32 * Math.sin(t * TAU * 1.3), R[1]], L }),
    check: (b) => either(b, (b, a) => isUp(b, a, 0.8)),
  },
  handsOnHead: {
    label: 'Hands on your head!',
    say: ['Hands on your head!', 'Put your hands on your head!'],
    hand: [0.42, -1.1],
    check: (b) => both(b, onHead),
  },
  clap: {
    label: 'Clap your hands!',
    say: ['Clap your hands!', 'Clap clap clap!'],
    hand: [0.1, 0.45],
    animate: (t) => {
      const R = [0.1 + 0.42 * Math.abs(Math.sin(t * Math.PI * 1.6)), 0.45];
      return { R, L: [...R] };
    },
    check: (b, game) => game.now - game.lastTogetherAt < 600,
  },
  hips: {
    label: 'Hands on your hips!',
    say: ['Hands on your hips!', 'Put your hands on your hips, like a teapot!'],
    hand: [0.98, 0.4],
    check: (b) => both(b, onHip),
  },
  tummy: {
    label: 'Pat your tummy!',
    say: ['Pat your tummy!', 'Pat pat pat your tummy!'],
    hand: [0.3, 0.55],
    animate: (t, R) => {
      const r = [R[0], R[1] - 0.12 * Math.abs(Math.sin(t * Math.PI * 2.2))];
      return { R: r, L: [...r] };
    },
    check: (b) => both(b, onTummy),
  },
  shoulders: {
    label: 'Hands on your shoulders!',
    say: ['Hands on your shoulders!', 'Touch your shoulders!'],
    hand: [0.86, -0.55],
    elbow: 'down',
    check: (b) => both(b, onShoulder),
  },
  peekaboo: {
    label: 'Peekaboo!',
    say: ['Cover your eyes! Peekaboo!', 'Can you play peekaboo?'],
    hand: [0.33, -0.3],
    animate: (t, R) => {
      // hands over the eyes, then a quick "boo!" every couple of seconds
      const open = Math.max(0, Math.sin(t * Math.PI * 0.8) - 0.75) * 4;
      const r = [R[0] + 0.7 * open, R[1] - 0.1 * open];
      return { R: r, L: [...r] };
    },
    check: (b) => both(b, onEyes),
  },
  bigCircle: {
    label: 'Make a big circle!',
    say: ['Make a big circle over your head!', 'Make a big round sun over your head!'],
    hand: [0.16, -1.5],
    check: (b) => both(b, (b, a) => isUp(b, a, 0.75)) && wristGap(b) < 0.8 * b.sw,
  },
  lean: {
    label: 'Lean like a tree!',
    say: ['Sway side to side like a tree in the wind!', 'Lean over like a tree!'],
    hand: [1.0, -1.85],
    body: (t) => ({ tilt: 0.28 * Math.sin(t * TAU * 0.35) }),
    check: isLeaning,
  },
  jump: {
    label: 'Jump!',
    say: ['Jump! Jump! Jump!', 'Can you jump like me?'],
    hand: [1.4, -1.3],
    body: (t) => ({ hop: Math.abs(Math.sin(t * Math.PI * 1.5)) }),
    check: (b, game) => game.now - game.lastJumpAt < 700,
  },
};
const POSE_IDS = Object.keys(POSES);

// ─── Pose checks (normalized image coords, y down) ──────────────────────────
// Everything is scaled by shoulder width so it works near or far from the
// camera, and thresholds are deliberately lenient for small kids.
function bodyFrom(lm) {
  const ls = lm[P.LS];
  const rs = lm[P.RS];
  const nose = lm[P.NOSE];
  if (!ls || !rs || !nose) return null;
  if ((ls.visibility ?? 1) < 0.4 || (rs.visibility ?? 1) < 0.4) return null;
  const sw = Math.max(Math.hypot(ls.x - rs.x, ls.y - rs.y), 0.04);
  const midX = (ls.x + rs.x) / 2;
  const side = Math.sign(ls.x - midX) || 1;
  const sy = (ls.y + rs.y) / 2;
  // Hips are often out of frame; estimate them from shoulder width if so.
  const lh = lm[P.LH];
  const rh = lm[P.RH];
  const hipsSeen = (lh.visibility ?? 1) > 0.5 && (rh.visibility ?? 1) > 0.5;
  const hipY = hipsSeen ? (lh.y + rh.y) / 2 : sy + 1.4 * sw;
  return {
    nose, sw, midX, sy, hipY,
    L: { s: ls, e: lm[P.LE], w: lm[P.LW], side },
    R: { s: rs, e: lm[P.RE], w: lm[P.RW], side: -side },
  };
}

function wristGap(b) {
  return Math.hypot(b.L.w.x - b.R.w.x, b.L.w.y - b.R.w.y);
}

function onHip(b, a) {
  // Wrist down near the hip, out to the side, elbow sticking out further.
  const out = (a.w.x - b.midX) * a.side;
  const elbowOut = (a.e.x - b.midX) * a.side;
  return (
    Math.abs(a.w.y - b.hipY) < 0.55 * b.sw &&
    out > 0.25 * b.sw && out < 1.2 * b.sw &&
    elbowOut > out + 0.1 * b.sw
  );
}

function onTummy(b, a) {
  // Wrist in front of the belly, between chest and hips, near the middle.
  return (
    a.w.y > b.sy + 0.35 * b.sw &&
    a.w.y < b.hipY + 0.25 * b.sw &&
    Math.abs(a.w.x - b.midX) < 0.55 * b.sw
  );
}

function onShoulder(b, a) {
  // Wrist close to either shoulder (crossing over counts too).
  const near = (s) => Math.hypot(a.w.x - s.x, a.w.y - s.y) < 0.5 * b.sw;
  return (near(b.L.s) || near(b.R.s)) && a.w.y < b.sy + 0.35 * b.sw;
}

function onEyes(b, a) {
  // Wrist in front of the face.
  return (
    Math.abs(a.w.x - b.nose.x) < 0.6 * b.sw &&
    a.w.y > b.nose.y - 0.55 * b.sw &&
    a.w.y < b.nose.y + 0.45 * b.sw
  );
}

function isLeaning(b) {
  // Shoulders tipped, or the head shifted well to one side.
  const tip = Math.abs(b.L.s.y - b.R.s.y) / b.sw;
  const shift = Math.abs(b.nose.x - b.midX) / b.sw;
  return tip > 0.35 || shift > 0.5;
}

function isUp(b, a, k) {
  // Wrist clearly above the head (or off the top of the frame).
  return a.w.y < b.nose.y - k * b.sw || (a.w.y < 0.03 && a.e.y < a.s.y);
}

function isOut(b, a) {
  const wOut = (a.w.x - a.s.x) * a.side;
  if (wOut > 0.6 * b.sw && Math.abs(a.w.y - a.s.y) < 0.75 * b.sw) return true;
  // Wrist off the side of the frame: fall back to the elbow.
  const offFrame = a.w.x < 0.02 || a.w.x > 0.98;
  const eOut = (a.e.x - a.s.x) * a.side;
  return offFrame && eOut > 0.35 * b.sw && Math.abs(a.e.y - a.s.y) < 0.5 * b.sw;
}

function onHead(b, a) {
  const nearHead =
    a.w.y > b.nose.y - 1.2 * b.sw &&
    a.w.y < b.nose.y + 0.15 * b.sw &&
    Math.abs(a.w.x - b.nose.x) < 0.95 * b.sw;
  const elbowUpAndOut =
    a.e.y < a.s.y + 0.15 * b.sw &&
    Math.abs(a.e.x - b.midX) > Math.abs(a.w.x - b.midX) + 0.05 * b.sw;
  return nearHead && elbowUpAndOut;
}

function handsTogether(lm, b) {
  const lw = lm[P.LW];
  const rw = lm[P.RW];
  if ((lw.visibility ?? 1) < 0.3 || (rw.visibility ?? 1) < 0.3) return false;
  return Math.hypot(lw.x - rw.x, lw.y - rw.y) < 0.55 * b.sw;
}

// ─── Two-bone IK for the character's arms ────────────────────────────────────
// Shoulder at (sx, sy), reach for (tx, ty); elbow bends outward (+x), or
// downward when elbowDown is set.
function solveArm(sx, sy, tx, ty, L1, L2, elbowDown = false) {
  let dx = tx - sx;
  let dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const maxD = (L1 + L2) * 0.999;
  const minD = Math.abs(L1 - L2) + 0.05;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < minD) { dx *= minD / d; dy *= minD / d; d = minD; }
  const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const base = Math.atan2(dy, dx);
  const e1 = [sx + Math.cos(base + a) * L1, sy + Math.sin(base + a) * L1];
  const e2 = [sx + Math.cos(base - a) * L1, sy + Math.sin(base - a) * L1];
  const e = elbowDown ? (e1[1] > e2[1] ? e1 : e2) : e1[0] > e2[0] ? e1 : e2;
  return { e, h: [sx + dx, sy + dy] };
}

// ─── Character look ─────────────────────────────────────────────────────────
const C = {
  body: '#8a6cff',
  bodyDark: '#6a4de0',
  belly: '#c3b5ff',
  hand: '#a993ff',
  cheek: 'rgba(255, 120, 170, 0.55)',
  star: '#ffd60a',
};
const CONFETTI_COLORS = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#3ddc84', '#00c2ff', '#7b61ff', '#ff5ec4'];

export class CopyMe {
  constructor({ sound, videoToScreen }) {
    this.sound = sound;
    this.videoToScreen = videoToScreen;
    this.reset();
  }

  reset() {
    this.phase = 'intro';
    this.phaseT = 0;
    this.poseId = null;
    this.prevPoseId = null;
    this.hold = 0;
    this.matchNow = false;
    this.lastDetectAt = -1e9;
    this.lastSeenAt = -1e9;
    this.lastTogetherAt = -1e9;
    this.lastJumpAt = -1e9;
    this.baseY = null;
    this.jumpT = 0;
    this.lastPromptAt = 0;
    this.now = performance.now();
    this.people = [];       // smoothed skeletons on screen
    this.confetti = [];
    this.t = 0;
    this.blinkAt = 2;
    this.jump = 0;
    // current animated hand positions (right, left) in body units
    this.hands = { R: [...IDLE_HAND], L: [...IDLE_HAND] };
    this.from = { R: [...IDLE_HAND], L: [...IDLE_HAND] };
    this.introWave = true;
  }

  start() {
    this.reset();
    this.sound.say('copyStart');
  }

  /** Parent "next pose" button. */
  next() {
    if (this.phase === 'intro') this.phaseT = 99;
    else this._showPose(this._randomPose());
  }

  /** Tap on screen: hear the current prompt again. */
  repeatPrompt() {
    if (this.poseId && (this.phase === 'show' || this.phase === 'wait')) this._prompt();
  }

  get label() {
    if (this.phase === 'intro') return 'Copy me!';
    if (this.phase === 'success') return 'Hooray!';
    return this.poseId ? POSES[this.poseId].label : '';
  }

  // ── detection input ──
  onPoses(list, now) {
    this.now = now;
    this.lastDetectAt = now;
    let match = false;
    const pose = this.poseId && POSES[this.poseId];
    const seen = [];
    let main = null;
    for (const lm of list) {
      const b = bodyFrom(lm);
      if (!b) continue;
      seen.push(lm);
      if (!main || b.sw > main.sw) main = b;
      if (handsTogether(lm, b)) this.lastTogetherAt = now;
    }
    if (main) this._trackJump(main, now);
    for (const lm of seen) {
      if (pose && pose.check(bodyFrom(lm), this)) match = true;
    }
    if (seen.length) this.lastSeenAt = now;
    this.matchNow = match;
    this._updatePeople(seen);
  }

  // A jump = shoulders suddenly rise well above where they usually are.
  _trackJump(b, now) {
    const dt = Math.min((now - (this.jumpT || now)) / 1000, 0.5);
    this.jumpT = now;
    if (this.baseY == null) { this.baseY = b.sy; return; }
    if ((this.baseY - b.sy) / b.sw > 0.25) this.lastJumpAt = now;
    // Follow slowly upward (so a jump doesn't become the new normal) and
    // faster downward (landing, crouching, kneeling).
    const rate = b.sy > this.baseY ? 2.5 : 0.6;
    this.baseY += (b.sy - this.baseY) * Math.min(1, dt * rate);
  }

  _updatePeople(list) {
    // Convert to screen and match to existing skeletons by nose position.
    const dets = list.map((lm) => {
      const pts = {};
      for (const i of SKELETON_POINTS) pts[i] = this.videoToScreen(lm[i].x, lm[i].y);
      return pts;
    });
    const next = [];
    const used = new Set();
    for (const d of dets) {
      let best = null;
      let bestD = Infinity;
      for (const p of this.people) {
        if (used.has(p)) continue;
        const dist = Math.hypot(p.tgt[0][0] - d[0][0], p.tgt[0][1] - d[0][1]);
        if (dist < bestD) { bestD = dist; best = p; }
      }
      if (best) {
        used.add(best);
        best.tgt = d;
        best.alpha = Math.max(best.alpha, 0.3);
        best.lastSeen = this.now;
        next.push(best);
      } else {
        const disp = {};
        for (const i of SKELETON_POINTS) disp[i] = [...d[i]];
        next.push({ tgt: d, disp, alpha: 0.3, lastSeen: this.now });
      }
    }
    // keep unmatched ones briefly so they fade instead of popping out
    for (const p of this.people) if (!used.has(p) && this.now - p.lastSeen < 400) next.push(p);
    this.people = next;
  }

  // ── game flow ──
  _randomPose() {
    let id;
    do id = pick(POSE_IDS);
    while (id === this.poseId || id === this.prevPoseId);
    return id;
  }

  _setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    this.from = { R: [...this.hands.R], L: [...this.hands.L] };
  }

  _showPose(id) {
    this.prevPoseId = this.poseId;
    this.poseId = id;
    this.hold = 0;
    this._setPhase('show');
    this._prompt();
  }

  _prompt() {
    this.lastPromptAt = this.t;
    this.sound.say(`pose_${this.poseId}`, POSES[this.poseId].say);
  }

  _targets() {
    const t = this.t;
    if (this.phase === 'intro') {
      return { R: [1.3 + 0.3 * Math.sin(t * TAU * 1.4), -1.75], L: IDLE_HAND };
    }
    if (this.phase === 'rest' || !this.poseId) return { R: IDLE_HAND, L: IDLE_HAND };
    if (this.phase === 'success') {
      // a happy "arms up" wiggle
      const w = 0.2 * Math.sin(t * TAU * 2);
      return { R: [1.3 + w, -1.8], L: [1.3 - w, -1.8] };
    }
    const pose = POSES[this.poseId];
    const R = [...pose.hand];
    const L = [...(pose.left || pose.hand)];
    return pose.animate ? pose.animate(t, R, L) : { R, L };
  }

  update(dt, now) {
    this.now = now;
    this.t += dt;
    this.phaseT += dt;
    const fresh = now - this.lastDetectAt < 400;

    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 3.2) this._showPose(this._randomPose());
        break;
      case 'show':
        if (this.phaseT > 0.9) this._setPhase('wait');
        break;
      case 'wait': {
        if (this.matchNow && fresh) this.hold += dt;
        else this.hold = Math.max(0, this.hold - dt * 0.6);
        if (this.hold >= HOLD_NEEDED) {
          this._setPhase('success');
          this.jump = 0;
          this.sound.chime();
          setTimeout(() => this.sound.say('copyPraise'), 350);
          this._burst();
        } else if (this.t - this.lastPromptAt > REPROMPT_EVERY) {
          if (now - this.lastSeenAt > 3000) {
            this.lastPromptAt = this.t;
            this.sound.say('copyNobody');
          } else {
            this._prompt();
          }
        }
        break;
      }
      case 'success':
        if (this.phaseT > SUCCESS_TIME) this._setPhase('rest');
        break;
      case 'rest':
        if (this.phaseT > 0.9) this._showPose(this._randomPose());
        break;
    }

    // animate the character's hands toward their targets
    const tg = this._targets();
    const moving = this.phase === 'show' || this.phase === 'rest';
    const k = moving ? ease(clamp(this.phaseT / 0.8, 0, 1)) : 1;
    for (const s of ['R', 'L']) {
      for (let i = 0; i < 2; i++) {
        const goal = moving ? this.from[s][i] + (tg[s][i] - this.from[s][i]) * k : tg[s][i];
        this.hands[s][i] += (goal - this.hands[s][i]) * (1 - Math.exp(-dt * 18));
      }
    }

    // skeleton smoothing
    const ks = 1 - Math.exp(-dt * 20);
    for (const p of this.people) {
      for (const i of SKELETON_POINTS) {
        p.disp[i][0] += (p.tgt[i][0] - p.disp[i][0]) * ks;
        p.disp[i][1] += (p.tgt[i][1] - p.disp[i][1]) * ks;
      }
      if (now - p.lastSeen > 250) p.alpha -= dt * 3;
      else p.alpha = Math.min(1, p.alpha + dt * 4);
    }
    this.people = this.people.filter((p) => p.alpha > 0);

    // confetti
    for (const c of this.confetti) {
      c.vx *= Math.exp(-1.5 * dt);
      c.vy = c.vy * Math.exp(-1.5 * dt) + c.g * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.life -= dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0);

    if (this.t > this.blinkAt + 0.14) this.blinkAt = this.t + rand(2.5, 5);
  }

  _burst() {
    const v = this.view;
    if (!v) return;
    const n = Math.min(90, MAX_CONFETTI - this.confetti.length);
    const origins = [this.starPos(v), [this.layout(v).cx, this.layout(v).cy]];
    for (let i = 0; i < n; i++) {
      const [ox, oy] = origins[i % 2];
      const a = rand(0, TAU);
      const sp = v.minDim * rand(0.3, 0.9);
      this.confetti.push({
        x: ox, y: oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - v.minDim * 0.3,
        g: v.minDim * 0.45,
        w: v.minDim * rand(0.012, 0.022),
        h: v.minDim * rand(0.007, 0.012),
        rot: rand(0, TAU),
        vr: rand(-6, 6),
        color: pick(CONFETTI_COLORS),
        life: rand(1.6, 2.6),
      });
    }
  }

  // ── layout ──
  layout(v) {
    const R = Math.min(v.H * 0.17, v.W * 0.088);
    const cx = Math.max(v.W * 0.22, 2.7 * R + 12);
    const ground = v.H * 0.88;
    const cy = ground - R * 1.35;
    return { R, cx, cy };
  }

  starPos(v) {
    return [v.W / 2, v.minDim * 0.11 + 8];
  }

  // ── rendering ──
  render(ctx, v, now) {
    this.view = v;
    this._drawPeople(ctx, v);
    this._drawCharacter(ctx, v);
    this._drawStar(ctx, v, now);
    this._drawLabel(ctx, v);
    for (const c of this.confetti) {
      ctx.save();
      ctx.globalAlpha = clamp(c.life / 0.6, 0, 1);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _drawPeople(ctx, v) {
    const matching = (this.matchNow && this.phase === 'wait') || this.phase === 'success';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of this.people) {
      const d = p.disp;
      const sw = Math.hypot(d[11][0] - d[12][0], d[11][1] - d[12][1]);
      // Thin and see-through, so kids can still see themselves in the
      // camera feed behind it.
      const lw = clamp(sw * 0.06, v.minDim * 0.005, v.minDim * 0.018);
      ctx.globalAlpha = clamp(p.alpha, 0, 1) * (matching ? 0.6 : 0.4);
      // soft outer glow then bright core
      for (const [width, color] of [
        [lw * 2.2, matching ? 'rgba(255,214,10,0.3)' : 'rgba(124,247,255,0.15)'],
        [lw, matching ? '#ffe55c' : 'rgba(255,255,255,0.9)'],
      ]) {
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const [a, b] of BONES) {
          ctx.moveTo(d[a][0], d[a][1]);
          ctx.lineTo(d[b][0], d[b][1]);
        }
        ctx.stroke();
      }
      // head and hands
      ctx.fillStyle = matching ? '#ffe55c' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = lw;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(d[0][0], d[0][1], Math.max(sw * 0.38, lw * 2), 0, TAU);
      ctx.stroke();
      for (const i of [15, 16]) {
        ctx.beginPath();
        ctx.arc(d[i][0], d[i][1], lw * 1.3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawCharacter(ctx, v) {
    const { R, cx } = this.layout(v);
    let { cy } = this.layout(v);
    const t = this.t;
    // gentle idle bob, and happy hops when celebrating
    let squash = 0;
    cy += Math.sin(t * 2.2) * R * 0.03;
    if (this.phase === 'success' && this.phaseT < 2.1) {
      const hop = Math.abs(Math.sin(this.phaseT * Math.PI * 1.9));
      cy -= hop * R * 0.45;
      squash = (1 - hop) * 0.08;
    }
    // pose-specific body motion (lean, jump), eased in while showing
    let tilt = 0;
    const pose = this.poseId && POSES[this.poseId];
    if (pose?.body && (this.phase === 'show' || this.phase === 'wait')) {
      const k = this.phase === 'show' ? ease(clamp(this.phaseT / 0.8, 0, 1)) : 1;
      const m = pose.body(t);
      tilt = (m.tilt || 0) * k;
      if (m.hop) {
        cy -= m.hop * R * 0.4 * k;
        squash = (1 - m.hop) * 0.08 * k;
      }
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(R, R);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // shadow (stays on the ground)
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, (this.layout(v).cy - cy) / R + 1.32, 0.9, 0.12, 0, 0, TAU);
    ctx.fill();

    // lean from the feet
    ctx.translate(0, 1.3);
    ctx.rotate(tilt);
    ctx.translate(0, -1.3);

    // feet
    ctx.fillStyle = C.bodyDark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 0.45, 1.12, 0.36, 0.2, 0, 0, TAU);
      ctx.fill();
    }

    // antenna with a star
    ctx.strokeStyle = C.bodyDark;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(0, -1.05);
    ctx.quadraticCurveTo(0.05, -1.45, 0.28, -1.55);
    ctx.stroke();
    starPath(ctx, 0.3, -1.58, 0.17, 0.08, t * 0.8);
    ctx.fillStyle = C.star;
    ctx.fill();

    // body
    ctx.save();
    ctx.scale(1 + squash, 1 - squash);
    ctx.fillStyle = C.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 1, 1.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = C.belly;
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 0.58, 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    this._drawFace(ctx);

    // arms (drawn over the body so poses like "clap" read clearly)
    const L1 = 0.8;
    const L2 = 0.75;
    for (const [s, sign] of [['R', 1], ['L', -1]]) {
      const [hx, hy] = this.hands[s];
      const elbowDown = pose?.elbow === 'down' && (this.phase === 'show' || this.phase === 'wait');
      const { e, h } = solveArm(0.78, -0.05, hx, hy, L1, L2, elbowDown);
      ctx.strokeStyle = C.bodyDark;
      ctx.lineWidth = 0.26;
      ctx.beginPath();
      ctx.moveTo(sign * 0.78, -0.05);
      ctx.lineTo(sign * e[0], e[1]);
      ctx.lineTo(sign * h[0], h[1]);
      ctx.stroke();
      ctx.fillStyle = C.hand;
      ctx.beginPath();
      ctx.arc(sign * h[0], h[1], 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawFace(ctx) {
    const happy = this.phase === 'success';
    // eyes shut while the hands cover them (peekaboo)
    const [hx, hy] = this.hands.R;
    const covered = Math.hypot(hx - 0.33, hy + 0.3) < 0.25;
    const blinking = covered || (this.t > this.blinkAt && this.t < this.blinkAt + 0.14);
    // cheeks
    ctx.fillStyle = C.cheek;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 0.6, 0.02, 0.15, 0.1, 0, 0, TAU);
      ctx.fill();
    }
    // eyes: look toward the nearest child, if any
    let lx = 0.04;
    let ly = 0.02;
    const p = this.people[0];
    if (p && this.view) {
      const { cx, cy } = this.layout(this.view);
      const dx = p.disp[0][0] - cx;
      const dy = p.disp[0][1] - cy;
      const d = Math.hypot(dx, dy) || 1;
      lx = (dx / d) * 0.07;
      ly = (dy / d) * 0.05;
    }
    for (const s of [-1, 1]) {
      const ex = s * 0.33;
      const ey = -0.3;
      if (happy || blinking) {
        ctx.strokeStyle = '#2b1d55';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        if (happy) ctx.arc(ex, ey + 0.06, 0.16, Math.PI * 1.15, Math.PI * 1.85);
        else { ctx.moveTo(ex - 0.17, ey); ctx.lineTo(ex + 0.17, ey); }
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 0.22, 0.27, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2b1d55';
      ctx.beginPath();
      ctx.arc(ex + lx, ey + ly + 0.03, 0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + lx + 0.04, ey + ly - 0.02, 0.04, 0, TAU);
      ctx.fill();
    }
    // mouth
    ctx.fillStyle = '#2b1d55';
    ctx.strokeStyle = '#2b1d55';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    if (happy) {
      ctx.moveTo(-0.28, 0.08);
      ctx.quadraticCurveTo(0, 0.6, 0.28, 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff7aa8';
      ctx.beginPath();
      ctx.ellipse(0, 0.27, 0.12, 0.07, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.arc(0, 0.02, 0.24, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
  }

  _drawStar(ctx, v, now) {
    // A big star at the top fills up while the child holds the pose.
    const [x, y] = this.starPos(v);
    const r = v.minDim * 0.085;
    const progress = this.phase === 'success' ? 1 : this.phase === 'wait' ? clamp(this.hold / HOLD_NEEDED, 0, 1) : 0;
    const spin = this.phase === 'success' ? this.phaseT * 2 : 0;
    const scale = this.phase === 'success' ? 1 + 0.15 * Math.sin(Math.min(this.phaseT, 1) * Math.PI) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.scale(scale, scale);
    starPath(ctx, 0, 0, r, r * 0.45, -Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke();
    if (progress > 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = C.star;
      ctx.fillRect(-r, r - 2 * r * progress, 2 * r, 2 * r * progress);
      ctx.restore();
    }
    ctx.restore();
  }

  _drawLabel(ctx, v) {
    // Small caption for grown-ups (toddlers go by the voice and character).
    const text = this.label;
    if (!text) return;
    const { cx } = this.layout(v);
    const size = Math.round(v.minDim * 0.045);
    ctx.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = 'rgba(13,10,43,0.75)';
    ctx.strokeText(text, cx, v.H - size * 0.45);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, cx, v.H - size * 0.45);
  }
}

function starPath(ctx, x, y, r1, r2, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * TAU;
    const r = i % 2 === 0 ? r1 : r2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}
