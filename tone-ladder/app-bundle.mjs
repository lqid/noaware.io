// The app's ES modules (static/tone-ladder/js/app/) as one classic script, for the claude.ai copy,
// whose host is not known to serve modules. The modules are joined in ES-module evaluation order
// (a depth-first walk from main.js over the imports, in source order) inside one strict function,
// with the import and export lines dropped: built like the single-file app.js they were split from.
//   node tone-ladder/app-bundle.mjs <out.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const IMPORT = /^import \{[^}]*\} from '\.\/([\w-]+\.js)';$/;
const EXPORT = /^export \{[^}]*\};$/;
export function bundleApp(appDir) {
  const order = [], seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(join(appDir, f), 'utf8');
    for (const line of src.split('\n')) {
      if (/^\s*(import|export)\b/.test(line) && !IMPORT.test(line) && !EXPORT.test(line)) throw new Error(`${f}: an import or export the bundle cannot join: ${line}`);
      const m = line.match(IMPORT);
      if (m) visit(m[1]);
    }
    order.push(f);
  };
  visit('main.js');
  const body = order.map((f) => `  // ---- ${f}\n` + readFileSync(join(appDir, f), 'utf8').split('\n').filter((l) => !IMPORT.test(l) && !EXPORT.test(l)).join('\n')).join('\n');
  const code = `/* Tone Ladder — the app as one classic script, built from js/app/ by tone-ladder/app-bundle.mjs; do not edit. */\n(function () {\n  'use strict';\n${body}\n})();\n`;
  new vm.Script(code, { filename: 'app-bundle.js' }); // it must at least parse
  return { code, order };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tone-ladder/app-bundle.mjs <out.js>'); process.exit(1); }
  const { code, order } = bundleApp(join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'tone-ladder', 'js', 'app'));
  writeFileSync(out, code);
  console.log(`wrote ${out}: ${order.length} modules, ${code.split('\n').length} lines`);
}
