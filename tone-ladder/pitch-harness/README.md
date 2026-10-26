# Pitch harness

Scores `static/tone-ladder/js/pitch.js`, the module that hears the learner sing in the Sing track,
against synthetic singing:

- the singers: male and female voices, vowels, breath, vibrato, scoops, wobble, creaky onsets,
  hummed steps, untrained wandering pitch;
- the rooms: echo, fans, mains hum, laptop and phone mics that lose the low end;
- the app's own sound coming back through the speakers, with its reverb tail;
- the sample rates a browser can run at (16, 24, 44.1, 48 and 96 kHz).

Each scene carries the grade a fair teacher would give.

```sh
node tone-ladder/pitch-harness/run.js static/tone-ladder/js/pitch.js
node tone-ladder/pitch-harness/run.js static/tone-ladder/js/pitch.js --only=seq-drift --verbose
```

`--set=dev` (the default), `--set=holdout` and `--set=final` are the same generator with
different seeds. Tune on dev only, and keep the other two for checking. The first run of a set
renders its audio into `.cache/` (about 0.5 GB per set, git-ignored), which takes a minute or two.
A change to a scene in `cases.js` needs that scene's cache files deleted, because the cache is
keyed by name.

The summary line reports:

- `gradeAccuracy`;
- `severe`: Matched for a wrong note, Missed for a right one, or any grade for the app's own sound
  or for noise;
- `doneIssues`: finishing early or late, or while the app plays;
- the detector's raw accuracy and cost.

Before a change goes live, `pitch.js` should score 100 with 0 severe on all three sets.

## The interface

```js
TL.Pitch.detect(frame, sampleRate) -> { hz /* 0 when unvoiced */, clarity, rms }
const L = TL.Pitch.listener({ sampleRate, doMidi, kind: 'hold' | 'sequence', target /* semitones from Do */ });
L.push(frame, t, { appPlaying })  // t: audio-clock seconds; the frame buffer is not kept
L.reset()                         // forget the singing, keep what was learned about the room and the app's sound
L.status(t) -> { heard, held, done, silent }
L.result() -> { v /* 1 | 0.5 | 0 | null */, reason, notes, graded, steps, extra, offset, drift, trace }
```

The app feeds it about 43 ms of audio every 20 ms (`js/app.js`, `micTick`). It sets `appPlaying`
while its own notes sound, output latency included (`js/audio.js`, `playing`).

## The rules

They were set after reviews by a singing-pedagogy expert and a browser-platform engineer. Every
note is judged by pitch class against the key, so any octave counts.

**Held answers** (Find Do, a scale degree, the bass of a chord):

- **Which note is graded:** the most prominent sustained note, by length (up to 2.5 s) and
  loudness. Do hummed first, the steps hummed on the way, and the walk home afterwards are not
  graded. A note broken by a breath, or cut up by a wide vibrato, still counts as one note.
- **Grades:** under 50 cents off is Matched (the nearest semitone is the target). 50 to 80 cents
  is Close. Further is Missed.
- **Capped at Close:** a slow slide into the note (from more than 100 cents away, taking over
  0.35 s), or a wide slow wobble (about ±80 cents). Ordinary unsteadiness and vibrato are fine.

**Melodies** (read a pattern, echo a melody):

- **A common offset:** up to about 60 cents is forgiven and reported. From 60 to 80 cents it is
  Close ('offset').
- **Named mistakes:**
  - A steady drift of more than about 55 cents, with the intervals right, is Close ('drift').
  - The right tune starting on the wrong note is Missed ('transposed').
  - Starting, stopping and singing it again is graded on the last full attempt, capped at Close
    ('restart').
- **Ignored:** talk or a laugh set off by a pause. A melody sung twice is fine.
- **Otherwise:** wrong, missing and extra notes are counted (0 errors Matched, 1 Close, 2 or more
  Missed).
- **No grade** ('unclear'): notes are missing but loud sound was there whose pitch could not be
  followed. The app asks the learner to check that one themselves.

**When the singing is finished:**

- **Held answers:** 1.5 s of quiet after a note held about a second. If only Do has been held on a
  question about another note, the wait is 2.2 s, because the learner may be finding the key
  first. A voice but no held note: 2.5 s, then the app asks again.
- **Melodies:** 2 s after every note, 3 s if fewer were sung.
- **Never:** while the app plays, or when nothing was heard.
