# Tests

Node checks for the logic of Tone Ladder in `static/tone-ladder/js/`: the theory, the curriculum
and the progress store, loaded as the browser would under a fake `window`, `localStorage` and a
clock the checks can move forward a day at a time. Plain Node: no browser, no dependencies, no
framework. Node 22.7 or later (the app's ES modules load without a package.json from there).

```sh
node tone-ladder/tests/run.js                        # every script, one line each
node tone-ladder/tests/run.js --verbose              # with each script's full output
node tone-ladder/tests/sing-check.js                 # one script, with its detail
node tone-ladder/tests/run.js path/to/tone-ladder    # another copy of the app
```

| Script | Checks |
| --- | --- |
| `progress-check.js` | level-ups: the twenty-answer window, the two-day rule, what is left to level up; old saves; the newer-format guard; device settings on a paste; the voicing Explore produces; Full Dictation's two gates, a level waiting for Melody, a format-8 save loaded as format 9 |
| `generators-check.js` | every generator at every level, many times: answers among the options, events well formed, melodies within their leaps, rhythms the right length; every introduction builds; a 400-answer run of the store |
| `backup-check.js` | export and import: a round trip, junk refused, markup neutralised, newer copies refused, apply and undo, an impossible stored level clamped; Full Dictation kept, and a level past its last refused |
| `coverage-check.js` | every item a level introduces turns up in its questions, and not rarely |
| `sing-check.js` | the notes a Sing question asks for stay in the chosen voice's range; Find Do practice rounds sound Do; intros build |
| `dictation-check.js` | Full Dictation: every level's melodies keep its rules (full bars of figures on the beat and inside the bar, the rests, the note counts, the first and last notes, leaps, Fi and Te, the chords on the downbeats, short notes by step) and the generator falls back on fewer than 4%; what is written is what plays and what is graded; the entry (placing, deleting, names that survive an edit, the given name locked); grading, case by case and over 2,000 random entries; the store's per-note scores, 30-note window and confusions |
| `sight-check.js` | Sight-Singing: what is written is what plays and what is graded, in the voice's range and clef; melodies keep their level's start, end, leaps and chromatic notes; names and key show as the level says; every staff and introduction draws; the gates point at the Sing levels that teach the notes |
| `modules-check.js` | the app's ES modules hold together: the page loads the entry module last with the import graph preloaded; every name used from another module is imported, exported and declared there, and none is declared twice; only `main.js` runs code on load; `R` changes only through `setR`; nothing uses a name of `main.js` or assigns to an import; every action table is merged once with no key twice, and every `data-act` (and every action name passed to the answer helpers) names an action; every module but `main.js` loads in Node |
| `app-check.js` | the app runs in Node (`app-harness/trace.mjs`): every view, every track page, a long daily session, Progress (with twelve weeks of history from `weeks-fixture.js`: every track's charts, a step back after a new level, a finished track), Preferences and Explore, and Full Dictation on a phone and a desktop (answered right by keys, wrong by actions, with an extra note, a MIDI key and a fifth hearing; nothing written while the melody first plays; a held Space one hearing), with no error, no chart drawing a missing number, no chart line across a new level and no step back after finishing a track put down to a new level; an answer while the question still sounds counts toward the day's times at no time, one after a replayed part does not; a long answer's time counts up to its track's limit; Full Dictation's staves as drawn against each question (systems, time signature, bar lines, each note's place and accidental, beams, red marks, ruled lengths); writing along a hearing makes no sound (but does once it is over, with a drone on), the pill reads Listening while Play mine plays, the focus stays in the stage, every note slot is labelled, replay buttons keep different names and a phone's two systems share a scale; `app.css` keeps rows of graded slots apart and the palette within a 320px phone; Method says when every track opens and states Full Dictation's own rule; Preferences (and `prefs.js`) and the microphone question name each dictation track; on that path the claude.ai bundle of the modules does exactly what the modules do |
| `sw-check.js` | the offline copy: every file the service worker precaches exists, every file the page and its styles load (and every module those import) is on its list, requests go to the network first and to the cache when the network fails |
| `notation-check.js` | spelling by scale degree in every key and mode: a run of letters, no double accidental, nothing against the signature; the signatures match the circle of fifths; staves and rhythms render well-formed SVG for every clef, signature, value, rest, tie, chord and ledger line, and for every rhythm the curriculum makes; time signatures, beams within the beat, slash heads, empty beats, ruled lengths and bare figures; drawings without those options unchanged from main's |
| `music-check.js` | Your music: the key estimate finds the key of a plain progression in all 24 keys; the per-file store of marks round-trips, drops junk field by field and stays at 50 files |
| `sync-check.js` | a link carries the progress: made by the store, read back independently and through the store, and refused when cut short or not a Tone Ladder link; 420 days of practice with answer times and intonation stay under 40,000 characters |
| `weeks-check.js` | week by week: which answers add a time (right, timed, scored, not Melody or Full Dictation, at most 15 s; one given during the sound at no time) and which add intonation (scored sung answers), and that the answer code says which; the weekly sums over unequal days and their minimums (Full Dictation's own 8); which way the voice leaned, at the 20-cent edge; the first day times were kept; weeks across the clock changes, near midnight; level-ups as days back and the level reached, a finished track finished once; old saves and junk in the new fields; the half-year trim |
| `sampler-check.js` | recorded instruments: note names to MIDI, a note's start, loudness and tuning measured, and (with ffmpeg) a folder of notes built into a set the app can load, mislabelled notes refused |

Each script ends with one summary line and exits non-zero on a failure; `run.js` prints that line
after `ok` or `FAIL` and fails if any script did. The generators are random, so the counts in the
output vary a little from run to run.
