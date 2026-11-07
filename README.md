# Bubble Pop 🫧

Webcam games for a 3-year-old. No reading, no timers, no score, no losing.
Pick a game on the start screen:

- **Bubble Pop:** bubbles float up the screen and the child pops them by waving their hands at the camera.
  Up to **4 hands** are tracked at once, so two kids, or a kid and a grown-up, can play together.
- **Copy Me:** a friendly purple character strikes a simple pose and says it out loud ("Reach up high!").
  When the child copies it, a big star fills up and the character celebrates with confetti.
  There are 12 poses: reach up high, arms out wide, wave one hand up high, hands on your head, clap your hands,
  hands on your hips, pat your tummy, hands on your shoulders, peekaboo (cover your eyes), make a big circle over your head,
  lean like a tree, and jump.

Everything runs in the browser with [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
and [Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
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
| G | Switch game: Bubble Pop ↔ Copy Me |
| S | Copy Me: skip to the next pose |
| 1–5, ↑ ↓ | Bubble speed |
| + − , → ← | More / fewer bubbles |
| M | Sound on/off |
| V | Spoken encouragement on/off |
| D | FPS / performance counter (Shift+D also draws raw landmarks) |
| C | Switch camera |
| X | Flip mirroring |
| T | Bubble Pop tracking: **body** (works from across the room) / **hands** (close up only) |
| N | Max people for body tracking (1–4), or max hands for hand tracking (1–4) |
| Q | Quality: high / low power (canvas resolution) |
| F | Full screen |

**Phone.** Press and hold the faint ⚙ in the top-right corner for one second. A ring fills as you hold.
A quick tap does nothing, so toddler taps won't open it. The panel closes on its own after 30 s.

The settings panel also has **Game** and **Next pose** buttons.
Settings, including the last game played, are remembered on each device.
You can also pop bubbles by touching or clicking them. In Copy Me, tapping the screen repeats the instruction.

## Body vs hand tracking (Bubble Pop)

Bubble Pop can follow hands two ways. Press **T** or use ⚙ → Track to switch.

- **Body tracking (default)** uses MediaPipe Pose to find each person, then uses its wrist, index, pinky and thumb points as the hand.
  It works from across the room. In testing on a 640×480 frame it still found both hands when the person filled only a quarter of the frame height.
- **Hand tracking** uses the hand model, which tracks fingers precisely but needs hands to be big in the picture.
  Its palm detector shrinks the whole camera frame to about 192 px, so in testing it stopped finding hands once the person filled less than about 70% of the frame height.
  With a 480p webcam that means only a few feet away. It's best for a phone close to the child.

If hand tracking sees nothing for 15 s, the game shows a hint to switch to body tracking.

## How Copy Me works

- Only the upper body is checked (head, shoulders, elbows, wrists), so legs don't need to be in view.
  The child should be far enough back that their head and both arms fit in the picture, including arms raised up high.
- Checks are scaled to the child's shoulder width, so they work near or far from the camera, and they are deliberately forgiving.
  Either arm counts for "wave one hand", and mirroring doesn't matter.
- The child's body shows on screen as a glowing stick figure, which turns gold while they match the pose.
  Matching for about half a second in total fills the star.
- There's no time limit. The character repeats the instruction every 10 s, asks the child to come into view if nobody is seen,
  and after about 30 s says "Let's try a different one!" and moves on.
- If a parent is also in view, both people are watched and either one can match. Press **N** to change how many people are watched (1–4).
- Jumping is spotted when the shoulders suddenly rise well above where they normally sit, so slowly standing up doesn't count.
  Hips are estimated from shoulder width when they're out of frame.
- Pose checks live in `POSES` at the top of `js/copyme.js`. Each pose is a hand position for the character plus a `check()` function,
  so adding a new pose takes a few lines.

## Tuning performance (MacBook)

Press **D** to see: game · render fps · detection rate and time · how often detection runs · GPU/CPU · hands or people · camera and canvas size.

These are already built in:
- The lightest models (hand landmarker float16 and **pose landmarker lite**), with the **GPU delegate** and an automatic **CPU fallback**.
  Each model is downloaded only when its game is first played. The last-played game's model starts loading as soon as the page opens.
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
Any category with clips uses them instead of the built-in voice. Copy Me has its own categories, including one per pose (`pose_armsUp`, `pose_clap`, …).
You can also replace the synthesized pop with `POP_CLIPS`.

## Files

```
index.html            page + overlays + settings panel
style.css
js/main.js            game loop, Bubble Pop, hand tracks, controls, camera, modes
js/copyme.js          Copy Me: character, poses, pose checks, celebration
js/tracker.js         MediaPipe Hand + Pose Landmarker wrappers (CDN; GPU→CPU fallback)
js/audio.js           Web Audio pop + chime, speechSynthesis, clip hooks
manifest.webmanifest  "Add to Home Screen" full-screen landscape app
icons/  audio/
.github/workflows/pages.yml
```

MediaPipe (`@mediapipe/tasks-vision@0.10.14`) is loaded from jsDelivr, and the models are loaded from Google's storage
(`HAND_MODEL_URL` and `POSE_MODEL_URL` in `js/tracker.js`). To self-host them, download them into `models/` and change those URLs.

## Later game ideas

- **Show me the toy:** the game asks out loud for a toy and celebrates when the camera sees it (COCO-SSD, or a Teachable Machine model of the kids' own toys exported to TensorFlow.js).
- **Magic paint:** sparkly trails follow the child's hands for open-ended play.
