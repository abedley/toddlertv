// Thin wrappers around MediaPipe Tasks Vision (Hand Landmarker and Pose
// Landmarker). Everything runs locally in the browser; no video leaves the
// device. Each model is only downloaded when its game mode is first used.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

// Lightest available models. To self-host, download these into /models and
// point the URLs at 'models/<file>.task'.
export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const MAX_HANDS = 4;
export const MAX_POSES = 2;

let visionPromise = null;
function loadVision() {
  visionPromise ??= import(`${MP_BASE}/vision_bundle.mjs`).then(async (mod) => ({
    mod,
    fileset: await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`),
  }));
  return visionPromise;
}

class VisionTracker {
  constructor() {
    this.task = null;
    this.delegate = null;      // 'GPU' or 'CPU' once ready
    this.max = 1;
    this.ready = false;
    this.busy = false;         // true while (re)creating the task
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.detectMs = 0;         // EMA of detection time
    this.detectCount = 0;
    this._initPromise = null;
  }

  // Subclasses provide: _taskClass(mod), _options(delegate), _maxKey
  init(max) {
    this._initPromise ??= (async () => {
      if (max) this.max = max;
      const { mod, fileset } = await loadVision();
      this._Task = this._taskClass(mod);
      this._fileset = fileset;
      try {
        await this._create('GPU');
      } catch (e) {
        console.warn('GPU delegate failed, falling back to CPU', e);
        await this._create('CPU');
      }
      this.ready = true;
    })();
    return this._initPromise;
  }

  async _create(delegate) {
    this.busy = true;
    try {
      if (this.task) {
        try { this.task.close(); } catch {}
        this.task = null;
      }
      this.task = await this._Task.createFromOptions(this._fileset, {
        baseOptions: { modelAssetPath: this._modelUrl, delegate },
        runningMode: 'VIDEO',
        ...this._options(),
      });
      this.delegate = delegate;
    } finally {
      this.busy = false;
    }
  }

  async setMax(n) {
    this.max = n;
    if (this.task) await this.task.setOptions({ [this._maxKey]: n });
  }

  resetVideo() {
    this.lastVideoTime = -1;
  }

  /**
   * Run detection if the video has a new frame. Returns an array of
   * landmark lists (normalized {x, y, z, visibility}), or null when there
   * was nothing new to detect.
   */
  detect(video) {
    if (!this.ready || this.busy || !this.task) return null;
    if (video.readyState < 2 || !video.videoWidth) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1; // timestamps must increase
    this.lastTs = ts;

    let res;
    try {
      res = this.task.detectForVideo(video, ts);
    } catch (e) {
      console.warn('Detection failed', e);
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

export class HandTracker extends VisionTracker {
  constructor() {
    super();
    this.max = MAX_HANDS;
    this._modelUrl = HAND_MODEL_URL;
    this._maxKey = 'numHands';
  }
  _taskClass(mod) { return mod.HandLandmarker; }
  _options() {
    return {
      numHands: this.max,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };
  }
}

export class PoseTracker extends VisionTracker {
  constructor() {
    super();
    this.max = MAX_POSES;
    this._modelUrl = POSE_MODEL_URL;
    this._maxKey = 'numPoses';
  }
  _taskClass(mod) { return mod.PoseLandmarker; }
  _options() {
    return {
      numPoses: this.max,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };
  }
}
