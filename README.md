# Bubble Pop 🫧

A browser game for a 3-year-old. Bubbles float up the screen and the child pops
them by waving their hands at the camera. No reading, no timers, no score, no
losing. Up to **4 hands** are tracked at once, so two kids, or a kid and a grown-up, can play together.

Everything runs in the browser with [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker).
**No video leaves the device**, and there is no server and no build step.

## Before you build anything: check the MacBook can track hands

Open Google's official demo in Chrome on the MacBook, allow the camera, and wave:
<https://mediapipe-studio.webapps.google.com/demo/hand_landmarker>.
If hands show up from 4–6 ft away, this game will work too.

## Deploy to GitHub Pages (one-time steps for you)

The repo already has a workflow at `.github/workflows/pages.yml` that publishes the repo root on every push to `main`.

1. Merge this branch into `main`. If the repo has no `main` yet, create it from this branch.
2. In the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`, or run the workflow by hand: **Actions → Deploy to GitHub Pages → Run workflow**.
4. The site will be at `https://<your-user>.github.io/toddlertv/`. GitHub Pages uses https, which the camera requires.

Free GitHub plans need the repo to be **public** to use Pages.
If you'd rather not use Actions, choose **Deploy from a branch → `main` / root** in step 2.
The `.nojekyll` file makes that work too.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The camera won't work from a `file://` URL. To test from a phone on the same Wi-Fi you need https, so the easiest option is to use the GitHub Pages URL.

## Setting up

**Phone (preferred).** Put the phone on a tripod in landscape, facing the child, and connect it to the TV with an HDMI adapter (or AirPlay/Chromecast).
The game uses the back camera by default. Long-press ⚙ to switch to the front camera.
- iPhone: Safari can't go fully full-screen. Use **Share → Add to Home Screen** and launch it from the icon to get a full-screen, landscape app with no browser bars.
- The screen stays awake during play (Screen Wake Lock).
- If the phone is held upright, the game asks you to turn it sideways.

**12-inch MacBook (fallback).** Use Chrome. Drag the window to the TV (extended display, 1080p) and press **F** for full screen.
The child stands 4–6 ft back.

## Grown-up controls

**Keyboard** (press **H** in the game for this list):

| Key | Action |
| --- | --- |
| P | Pause / resume |
| 1–5, ↑ ↓ | Bubble speed |
| + − , → ← | More / fewer bubbles |
| M | Sound on/off |
| V | Spoken encouragement on/off |
| D | FPS / performance counter (Shift+D also draws raw landmarks) |
| C | Switch camera |
| X | Flip mirroring |
| N | Max hands tracked (cycles 1–4) |
| Q | Quality: high / low power (canvas resolution) |
| F | Full screen |

**Phone.** Press and hold the faint ⚙ in the top-right corner for one second. A ring fills as you hold.
A quick tap does nothing, so toddler taps won't open it. The panel closes on its own after 30 s.

Settings are remembered on each device. You can also pop bubbles by touching or clicking them.

## Tuning performance (MacBook)

Press **D** to see: render fps · detection rate and time · how often detection runs · GPU/CPU · hands · camera and canvas size.

These are already built in:
- The lightest hand model (float16), with the **GPU delegate** and an automatic **CPU fallback**.
- 640×480 camera input.
- Detection runs every 1–3 frames, adjusted to the measured fps. It never runs more often than its own cost allows, so it can't take over the main thread.
- Between detections, hand positions are smoothed and extrapolated a little. Hit tests use the path the hand swept, so fast waves still pop bubbles.
- The camera feed is a CSS-faded `<video>` element (composited, not drawn on the canvas). The canvas is capped at about 1.4 MP, bubbles and glows are pre-rendered sprites, and particles are capped at 240.

If it's sluggish, try these in order:
1. **Q** for low-power mode.
2. **N** to track fewer hands. When fewer hands are visible than the maximum, MediaPipe keeps running its palm detector to look for more, so `numHands = 4` costs a bit more than 2.
3. Lower speed or bubble count.

## Your own voice clips

Record short clips, put them in `audio/`, and list them in `VOICE_CLIPS` at the top of `js/audio.js` (see `audio/README.md`).
Any category with clips uses them instead of the built-in voice. You can also replace the synthesized pop with `POP_CLIPS`.

## Files

```
index.html            page + overlays + settings panel
style.css
js/main.js            game loop, bubbles, particles, hand tracks, controls, camera
js/tracker.js         MediaPipe Hand Landmarker wrapper (CDN; GPU→CPU fallback)
js/audio.js           Web Audio pop + speechSynthesis + clip hooks
manifest.webmanifest  "Add to Home Screen" full-screen landscape app
icons/  audio/
.github/workflows/pages.yml
```

MediaPipe (`@mediapipe/tasks-vision@0.10.14`) is loaded from jsDelivr, and the model is loaded from Google's storage (`MODEL_URL` in `js/tracker.js`).
To self-host the model, download it into `models/` and change `MODEL_URL`.

## Later game ideas

- **Show me the toy:** the game asks out loud for a toy and celebrates when the camera sees it (COCO-SSD, or a Teachable Machine model of the kids' own toys exported to TensorFlow.js).
- **Copy the animal:** a cartoon animal jumps or raises its arms and the child copies it (MediaPipe Pose).
- **Magic paint:** sparkly trails follow the child's hands for open-ended play.
