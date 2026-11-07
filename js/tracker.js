// Thin wrapper around MediaPipe Tasks Vision Hand Landmarker.
// Everything runs locally in the browser; no video leaves the device.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
// The hand landmarker ships as a single lightweight float16 model (~7.5 MB).
// To self-host it, download this file into /models and point MODEL_URL at
// 'models/hand_landmarker.task'.
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const MAX_HANDS = 4;

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = null;      // 'GPU' or 'CPU' once ready
    this.numHands = MAX_HANDS;
    this.ready = false;
    this.busy = false;         // true while (re)creating the landmarker
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.detectMs = 0;         // EMA of detection time
    this.detectCount = 0;
  }

  async init(numHands = MAX_HANDS) {
    this.numHands = numHands;
    const { FilesetResolver, HandLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
    this._HL = HandLandmarker;
    this._fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    try {
      await this._create('GPU');
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      await this._create('CPU');
    }
    this.ready = true;
  }

  async _create(delegate) {
    this.busy = true;
    try {
      if (this.landmarker) {
        try { this.landmarker.close(); } catch {}
        this.landmarker = null;
      }
      this.landmarker = await this._HL.createFromOptions(this._fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: this.numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.delegate = delegate;
    } finally {
      this.busy = false;
    }
  }

  async setNumHands(n) {
    this.numHands = n;
    if (this.landmarker) await this.landmarker.setOptions({ numHands: n });
  }

  resetVideo() {
    this.lastVideoTime = -1;
  }

  /**
   * Run detection if the video has a new frame.
   * Returns an array of hands (each an array of 21 {x,y,z} normalized
   * landmarks), or null when nothing new was detected.
   */
  detect(video) {
    if (!this.ready || this.busy || !this.landmarker) return null;
    if (video.readyState < 2 || !video.videoWidth) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1; // timestamps must increase
    this.lastTs = ts;

    let res;
    try {
      res = this.landmarker.detectForVideo(video, ts);
    } catch (e) {
      console.warn('Hand detection failed', e);
      if (this.delegate === 'GPU') {
        // Some GPUs init fine but fail on first inference: retry on CPU.
        this._create('CPU').catch((err) => console.error(err));
      }
      return null;
    }
    const ms = performance.now() - ts;
    this.detectMs = this.detectCount ? this.detectMs * 0.9 + ms * 0.1 : ms;
    this.detectCount++;
    return res.landmarks || [];
  }
}
