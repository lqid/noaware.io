'use strict';
// Runs every check in this folder against the app and prints one line per script.
//   node tone-ladder/tests/run.js [path/to/static/tone-ladder] [--verbose]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', '..', 'static', 'tone-ladder'));
const SCRIPTS = fs.readdirSync(__dirname).filter((f) => /-check\.js$/.test(f)).sort(); // every check in this folder

let failed = 0;
for (const script of SCRIPTS) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), dir], { encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26 }); // a check that hangs fails instead of holding a deploy
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const lines = out.trim().split('\n').filter(Boolean);
  // the script's own summary is its last line; a crash is reported by its error line instead
  const crash = (r.stderr || '').split('\n').find((l) => /^\w*Error\b/.test(l));
  const summary = r.error ? r.error.message : crash || lines.at(-1) || '(no output)';
  const ok = r.status === 0 && !r.error;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${script.padEnd(21)} ${summary}`);
  if (verbose || !ok) for (const l of lines.slice(0, 60)) console.log('     ' + l); // a failure says why, in a deploy log too
}
console.log(failed ? `${failed} of ${SCRIPTS.length} scripts failed (${dir})` : `all ${SCRIPTS.length} scripts passed (${dir})`);
process.exitCode = failed ? 1 : 0;
