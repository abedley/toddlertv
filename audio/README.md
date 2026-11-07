# Parent-recorded clips

Drop short recordings here (`.m4a` or `.mp3`, a second or two each), then list
them in `js/audio.js`:

```js
export const VOICE_CLIPS = {
  start:  ['audio/lets-pop.m4a'],
  praise: ['audio/great-job.m4a', 'audio/wow.m4a', 'audio/pop.m4a'],
  idle:   ['audio/wave-your-hands.m4a'],
};
export const POP_CLIPS = []; // optional: your own pop sounds
```

Any list with clips in it replaces the robot voice for that moment. Empty
lists keep using the built-in speech.
