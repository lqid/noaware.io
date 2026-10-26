# Takes

Real Sing answers saved from the app with "Save this take". Each `.wav` holds the sound of one
answer (with a moment of the room before it) and, in a `tlmd` chunk, everything needed to hear it
again as the app did:

- the question;
- every moment the listener was fed a frame, whether the app was playing, each reset, and where
  the app took its grade;
- the grade the app gave, and the grade the learner says it should have been;
- the browser's user agent, and the microphone's name (with any owner's name taken out), kind and
  capture settings.

```sh
node tone-ladder/pitch-harness/takes.js --verbose
```

replays every take here through `static/tone-ladder/js/pitch.js` and marks the ones whose grade
still disagrees with the learner. A take saved because the app heard nothing passes once the
detector grades the singing at that moment. Fix the cause in `pitch.js`, check the synthetic sets
still pass (`run.js` on dev, holdout and final), then bump `VERSION` in `pitch.js`.

Takes are voice recordings, so `*.wav` here is git-ignored. To keep one as a permanent test, add
it with `git add -f`, knowing the repository is public.
