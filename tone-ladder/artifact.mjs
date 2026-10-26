// Builds the claude.ai version of Tone Ladder from the noaware.io page in static/tone-ladder/.
// The claude.ai viewer wraps a page in its own <html>/<head>/<body>, so the artifact is a
// fragment: title, Google Fonts (allowed there), the app's CSS inlined, then the same markup
// and scripts. Usage: node tone-ladder/artifact.mjs <output.html>
// Publish the output with static/tone-ladder/js/*.js alongside it as js/*.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) { console.error('usage: node tone-ladder/artifact.mjs <output.html>'); process.exit(1); }
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'tone-ladder');
const page = readFileSync(join(dir, 'index.html'), 'utf8');
const css = readFileSync(join(dir, 'app.css'), 'utf8');
const body = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'))
  .replace(/\s*<!-- site-only -->[\s\S]*?<!-- \/site-only -->/g, '')
  .trim();
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
console.log(`wrote ${out}`);
