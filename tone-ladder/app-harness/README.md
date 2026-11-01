# App harness

Tools for changes to the app's modules (`static/tone-ladder/js/app/`) that are meant to keep its
behaviour exactly the same.

- `trace.mjs` runs the app in Node against a fake DOM, a recording stand-in for the audio module,
  seeded randomness and a virtual clock, drives every view, every track page, a long daily
  session, Progress, Preferences and Explore through the document listeners, and prints every
  observable effect as JSON lines: DOM writes, sounds asked for, saved data, timers, the session.
  `node trace.mjs modules` runs the modules, `node trace.mjs bundle` the claude.ai bundle of them,
  and `node trace.mjs classic <dir>` a single-file `js/app.js` as the app was before the split.
  Run it before and after a change (with `TZ=Australia/Melbourne`) and compare the output: the
  same lines mean the same behaviour on every path it drives. `tests/app-check.js` runs it on
  every test run.
- `split-app.js` split the single-file `js/app.js` (commit b1d424d) into the modules: each module
  is the original lines, byte for byte with their indentation, plus computed imports and an
  export list. Four lines changed (the two places that set the running session call `setR`, and
  `go()` disarms the reset through `disarmReset()`), those two functions were added, and each
  screen's entries of the action table moved into a `<name>Actions` table that `main.js` spreads
  into `ACT`. `node split-app.js --verify` regenerates the
  split from that commit and compares it with `js/app/`; it prints nothing when they match, so
  the split can be reviewed without reading 3,500 moved lines.

When the split was made, the traces of the original, the modules and the bundle were identical
line for line, and a browser run of 171 steps (every screen, three levels of every track, the
settings that change answering, a daily plan, Explore, moving progress) gave the same screens,
sounds and saved data before and after, both for the modules and for the bundle.
