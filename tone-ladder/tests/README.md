# Tests

Node checks for the logic of Tone Ladder in `static/tone-ladder/js/`: the theory, the curriculum
and the progress store, loaded as the browser would under a fake `window`, `localStorage` and a
clock the checks can move forward a day at a time. Plain Node: no browser, no dependencies, no
framework.

```sh
node tone-ladder/tests/run.js                        # every script, one line each
node tone-ladder/tests/run.js --verbose              # with each script's full output
node tone-ladder/tests/sing-check.js                 # one script, with its detail
node tone-ladder/tests/run.js path/to/tone-ladder    # another copy of the app
```

| Script | Checks |
| --- | --- |
| `progress-check.js` | level-ups: the twenty-answer window, the two-day rule, what is left to level up; old saves; the newer-format guard; device settings on a paste; the voicing Explore produces |
| `generators-check.js` | every generator at every level, many times: answers among the options, events well formed, melodies within their leaps, rhythms the right length; every introduction builds; a 400-answer run of the store |
| `backup-check.js` | export and import: a round trip, junk refused, markup neutralised, newer copies refused, apply and undo, an impossible stored level clamped |
| `coverage-check.js` | every item a level introduces turns up in its questions, and not rarely |
| `sing-check.js` | the notes a Sing question asks for stay in the chosen voice's range; Find Do practice rounds sound Do; intros build |
| `sw-check.js` | the offline copy: every file the service worker precaches exists, every file the page and its styles load is on its list, requests go to the network first and to the cache when the network fails |
| `notation-check.js` | spelling by scale degree in every key and mode: a run of letters, no double accidental, nothing against the signature; the signatures match the circle of fifths; staves and rhythms render well-formed SVG for every clef, signature, value, rest, tie, chord and ledger line, and for every rhythm the curriculum makes |
| `music-check.js` | Your music: the key estimate finds the key of a plain progression in all 24 keys; the per-file store of marks round-trips, drops junk field by field and stays at 50 files |
| `sync-check.js` | a link carries the progress: made by the store, read back independently and through the store, and refused when cut short or not a Tone Ladder link |
| `sampler-check.js` | recorded instruments: note names to MIDI, a note's start, loudness and tuning measured, and (with ffmpeg) a folder of notes built into a set the app can load, mislabelled notes refused |

Each script ends with one summary line and exits non-zero on a failure; `run.js` prints that line
after `ok` or `FAIL` and fails if any script did. The generators are random, so the counts in the
output vary a little from run to run.
