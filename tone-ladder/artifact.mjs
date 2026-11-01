// Builds the claude.ai version of Tone Ladder from the noaware.io page in static/tone-ladder/.
// The claude.ai viewer wraps a page in its own <html>/<head>/<body>, so the artifact is a
// fragment: title, Google Fonts (allowed there), the app's CSS inlined, then the same markup
// and scripts. The site loads the app as ES modules (js/app/); the copy gets them joined into one
// classic script, js/app.js, since its host is not known to serve modules.
// Usage: node tone-ladder/artifact.mjs <folder>
// It writes <folder>/tone-ladder.html and <folder>/js/: the classic scripts and the joined app,
// everything the copy loads. Publish the page with every file in <folder>/js as js/<name>, so
// nothing the copy needs is left at an older version.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleApp } from './app-bundle.mjs';

const outDir = process.argv[2];
if (!outDir || /\.html?$/.test(outDir)) { console.error('usage: node tone-ladder/artifact.mjs <folder>   (it writes <folder>/tone-ladder.html and <folder>/js/)'); process.exit(1); }
const out = join(outDir, 'tone-ladder.html'), outJs = join(outDir, 'js');
rmSync(outJs, { recursive: true, force: true });
mkdirSync(outJs, { recursive: true });
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'tone-ladder');
const page = readFileSync(join(dir, 'index.html'), 'utf8');
const css = readFileSync(join(dir, 'app.css'), 'utf8');
let body = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'))
  .replace(/\s*<!-- site-only -->[\s\S]*?<!-- \/site-only -->/g, '')
  .trim();
const MODULE = '<script type="module" src="js/app/main.js"></script>';
if (body.split(MODULE).length !== 2) throw new Error('the page does not load js/app/main.js exactly once');
body = body.replace(MODULE, '<script src="js/app.js"></script>');
if (/type="module"/.test(body)) throw new Error('a module script is left in the artifact');
writeFileSync(join(outJs, 'app.js'), bundleApp(join(dir, 'js', 'app')).code);
// the classic scripts, and the worklet audio.js loads by name
for (const f of readdirSync(join(dir, 'js'))) if (f.endsWith('.js')) copyFileSync(join(dir, 'js', f), join(outJs, f));
for (const m of body.matchAll(/<script src="([^"]+)"/g)) if (!existsSync(join(outDir, m[1]))) throw new Error(`the artifact loads ${m[1]}, which the folder does not have`);
const fragment = `<title>Tone Ladder</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="A personal ear-training course for composers.">
<meta name="tl-copy" content="artifact">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..800;1,6..96,400..800&family=JetBrains+Mono:wght@400;600&family=Schibsted+Grotesk:wght@400..700&display=swap">
<style>
${css}</style>

${body}
`;
writeFileSync(out, fragment);
const js = readdirSync(outJs).sort();
console.log(`wrote ${out} and ${js.length} scripts in ${outJs}: publish the page with each as js/<name> (${js.join(', ')})`);
