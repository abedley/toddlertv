// Sound for Bubble Pop: a synthesized "pop" (Web Audio, no files needed)
// and spoken encouragement (speechSynthesis), with an easy way to swap in
// parent-recorded clips later.
//
// ── Using your own recordings ────────────────────────────────────────────────
// 1. Record short clips (phone voice memo is fine), export as .m4a or .mp3.
// 2. Put them in the /audio folder of this repo.
// 3. List them below, e.g.  praise: ['audio/great-job.m4a', 'audio/wow.m4a'],
// Any list with at least one clip that loads is used instead of the robot
// voice. Empty lists fall back to speechSynthesis with the phrases below.
export const VOICE_CLIPS = {
  // Bubble Pop
  start: [],   // played when Start is pressed
  praise: [],  // played every few pops
  idle: [],    // played if nobody has popped anything for a while
  // Copy Me
  copyStart: [],        // "Let's play Copy Me! Do what I do!"
  copyPraise: [],       // after a pose is copied
  copyNobody: [],       // nobody is in view
  pose_armsUp: [],      // one list per pose, e.g. ['audio/reach-up.m4a']
  pose_armsOut: [],
  pose_oneArmUp: [],
  pose_handsOnHead: [],
  pose_clap: [],
  pose_hips: [],
  pose_tummy: [],
  pose_shoulders: [],
  pose_peekaboo: [],
  pose_bigCircle: [],
  pose_lean: [],
  pose_jump: [],
};
// Optional: replace the synthesized pop with recorded pop sounds.
export const POP_CLIPS = [];

export const PHRASES = {
  start: ["Let's pop some bubbles!", 'Wave your hands to pop the bubbles!'],
  praise: ['Pop!', 'Great job!', 'Wow!', 'Yay!', 'You did it!', 'Pop pop pop!', 'Hooray!', 'Super popping!', 'Nice one!'],
  idle: ['Wave your hands!', 'Can you pop a bubble?', 'Look at all the bubbles!'],
  copyStart: ["Let's play Copy Me! Do what I do!"],
  copyPraise: ['You did it!', 'Great job!', 'Wow, just like me!', 'Hooray!', 'Super!', 'Yay! You copied me!'],
  copyNobody: ['Come stand where I can see you!', 'Where are you? Come play with me!'],
};

// Bright pentatonic notes for the little sparkle after each pop.
const SPARKLE_NOTES = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;   // all sound
    this.voiceEnabled = true;
    this.clips = { start: [], praise: [], idle: [], pop: [] };
    this.lastPop = 0;
    this.voice = null;
    this.clipsLoaded = false;
  }

  /** Must be called synchronously inside a user gesture (the Start button). */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) {
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp).connect(this.ctx.destination);
      // One short white-noise buffer, reused for every pop's "click".
      const len = Math.floor(this.ctx.sampleRate * 0.05);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});

    if ('speechSynthesis' in window) {
      this._pickVoice();
      speechSynthesis.addEventListener?.('voiceschanged', () => this._pickVoice());
    }
    if (!this.clipsLoaded) {
      this.clipsLoaded = true;
      this._loadClips();
    }
  }

  _pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    const en = voices.filter((v) => /^en/i.test(v.lang));
    const preferred = ['Samantha', 'Google US English', 'Karen', 'Moira', 'Tessa', 'Microsoft Aria', 'Microsoft Jenny'];
    this.voice =
      preferred.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ||
      en.find((v) => v.localService) || en[0] || null;
  }

  async _loadClips() {
    if (!this.ctx) return;
    const load = async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const data = await res.arrayBuffer();
        return await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
      } catch (e) {
        console.warn('Could not load audio clip', url, e);
        return null;
      }
    };
    const lists = { ...VOICE_CLIPS, pop: POP_CLIPS };
    for (const [key, urls] of Object.entries(lists)) {
      const bufs = await Promise.all(urls.map(load));
      this.clips[key] = bufs.filter(Boolean);
    }
  }

  _playBuffer(buf, gain = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** A soft bubble pop. size01: 0 = small bubble (higher), 1 = big (lower). */
  pop(size01 = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastPop < 0.035) return; // avoid stacking many pops in one instant
    this.lastPop = now;

    if (this.clips.pop.length) {
      this._playBuffer(pick(this.clips.pop));
      return;
    }

    // 1) the "bloop": a sine that sweeps quickly upward
    const f0 = 260 + (1 - size01) * 220 + Math.random() * 60;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f0 * 3.2, now + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.7, now + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(og).connect(this.master);
    o.start(now);
    o.stop(now + 0.14);

    // 2) a tiny filtered noise "click"
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 800;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(now);

    // 3) a quiet sparkle note
    const s = ctx.createOscillator();
    s.type = 'triangle';
    s.frequency.value = pick(SPARKLE_NOTES);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.12, now + 0.06);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    s.connect(sg).connect(this.master);
    s.start(now + 0.05);
    s.stop(now + 0.4);
  }

  /** A short rising "ta-da" arpeggio for a copied pose. */
  chime() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = now + i * 0.09;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  /**
   * Speak a phrase of the given kind (a key of PHRASES / VOICE_CLIPS).
   * `phrases` optionally overrides the text choices for that kind.
   */
  say(kind, phrases) {
    if (!this.enabled || !this.voiceEnabled) return false;
    if (this.ctx && this.clips[kind]?.length) {
      this._playBuffer(pick(this.clips[kind]));
      return true;
    }
    if (!('speechSynthesis' in window)) return false;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(pick(phrases || PHRASES[kind] || PHRASES.praise));
      u.rate = 0.95;
      u.pitch = 1.35;
      u.volume = 1;
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      }
      speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  stopVoice() {
    try { speechSynthesis.cancel(); } catch {}
  }
}
