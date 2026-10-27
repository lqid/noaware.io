'use strict';
// Runs every check in this folder against the app and prints one line per script.
//   node tone-ladder/tests/run.js [path/to/static/tone-ladder] [--verbose]
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', '..', 'static', 'tone-ladder'));
const SCRIPTS = ['progress-check.js', 'generators-check.js', 'backup-check.js', 'coverage-check.js', 'sing-check.js'];

let failed = 0;
for (const script of SCRIPTS) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), dir], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const lines = out.trim().split('\n').filter(Boolean);
  // the script's own summary is its last line; a crash is reported by its error line instead
  const crash = (r.stderr || '').split('\n').find((l) => /^\w*Error\b/.test(l));
  const summary = r.error ? r.error.message : crash || lines.at(-1) || '(no output)';
  const ok = r.status === 0 && !r.error;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${script.padEnd(21)} ${summary}`);
  if (verbose || (!ok && crash)) for (const l of lines) console.log('     ' + l);
}
console.log(failed ? `${failed} of ${SCRIPTS.length} scripts failed (${dir})` : `all ${SCRIPTS.length} scripts passed (${dir})`);
process.exitCode = failed ? 1 : 0;
