'use strict';
// The app's ES modules (js/app/) hold together: the page loads exactly the entry module, after the
// classic scripts, with the whole import graph preloaded; every module keeps the simple shape the
// claude.ai bundle and the worker check rely on; every name a module uses from another module is
// imported, exported there and declared there, and no name is declared twice; only main.js does
// anything when it loads; the running session changes only through setR; the action tables are
// all merged, with no key twice, and every data-act on a page names one; and every module but the
// entry loads in Node in the browser's order without an error (main.js is run by app-check).
//   node tone-ladder/tests/modules-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const { tokenize } = require('./js-tokens.js');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder'));
const appDir = path.join(dir, 'js', 'app');
let bad = 0;
const fail = (m) => { bad++; if (bad <= 40) console.log(m); };
const CLASSIC = ['theory.js', 'audio.js', 'curriculum.js', 'store.js', 'pitch.js', 'take.js', 'notation.js', 'music.js', 'start-guard.js'];
const IMPORT = /^import \{([^}]*)\} from '\.\/([\w-]+\.js)';$/;
const isOpen = (t) => t.t === 'p' && ['(', '[', '{'].includes(t.v), isClose = (t) => t.t === 'p' && [')', ']', '}'].includes(t.v);
// the names a const/let/var at token k declares: every declarator, plain or a { } / [ ] pattern
function declNames(toks, k) {
  const out = [];
  let j = k + 1;
  for (;;) {
    const u = toks[j];
    if (!u) break;
    if (u.t === 'p' && (u.v === '{' || u.v === '[')) {
      let d = 1; j++;
      for (; d > 0 && j < toks.length; j++) { const w = toks[j]; if (isOpen(w)) d++; else if (isClose(w)) d--; else if (w.t === 'id' && !KEYWORDS.has(w.v) && toks[j + 1] && toks[j + 1].v !== ':') out.push(w.v); }
    } else if (u.t === 'id') { out.push(u.v); j++; } else break;
    let d = 0;
    for (; j < toks.length; j++) { const w = toks[j]; if (isOpen(w)) d++; else if (isClose(w)) { if (d === 0) return out; d--; } else if (d === 0 && w.t === 'p' && (w.v === ',' || w.v === ';')) break; else if (d === 0 && w.t === 'id' && (w.v === 'of' || w.v === 'in')) return out; }
    if (!toks[j] || toks[j].v !== ',') break;
    j++;
  }
  return out;
}
const EXPORT = /^export \{([^}]*)\};$/;
// names a module may use that no module declares: the browser's own
const GLOBALS = new Set('window document navigator location history localStorage sessionStorage console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame performance Date Math JSON Number String Array Object Promise Set Map Error TypeError URL Blob File FileReader Event KeyboardEvent CustomEvent AudioContext isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent getComputedStyle matchMedia innerWidth innerHeight devicePixelRatio scrollTo isSecureContext Uint8Array Float32Array Float64Array Int16Array ArrayBuffer DataView TextEncoder TextDecoder Infinity NaN undefined globalThis queueMicrotask structuredClone Symbol Reflect Proxy WeakMap WeakSet BigInt RegExp crypto alert confirm'.split(' '));
const KEYWORDS = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of null true false arguments get set static'.split(' '));

// 1. the page: the classic scripts as before, then the entry module, last
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map((m) => m[1]);
const classic = scripts.filter((a) => !/type="module"/.test(a)).map((a) => (a.match(/src="js\/([^"]+)"/) || [])[1]);
if (classic.join() !== CLASSIC.join()) fail('index.html: the classic scripts are not theory … music, then start-guard, in order: ' + classic.join(' '));
const mods = scripts.filter((a) => /type="module"/.test(a));
if (mods.length !== 1 || !/src="js\/app\/main\.js"/.test(mods[0]) || !/type="module"/.test(scripts[scripts.length - 1])) fail('index.html: the page must load js/app/main.js as its one module, after the classic scripts');
if (/src="js\/app\.js"/.test(html)) fail('index.html still loads js/app.js');

// read every module
const files = fs.readdirSync(appDir).filter((f) => f.endsWith('.js')).sort();
const M = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(appDir, f), 'utf8');
  const lines = src.split('\n');
  const m = { f, src, lines, imports: {}, exports: [], top: new Map(), uses: new Set() };
  M[f] = m;
  // 3. shape: a header, one-line imports, one export line at the end, nothing else that imports or exports
  if (!/^\/\* Tone Ladder — /.test(lines[0])) fail(`${f}: no header comment`);
  lines.forEach((l, i) => {
    if (/\bimport\s*\(/.test(l)) fail(`${f}:${i + 1}: a dynamic import`);
    if (/^\s*import\b/.test(l)) {
      const x = l.match(IMPORT);
      if (!x || /\bas\b/.test(x[1])) { fail(`${f}:${i + 1}: an import not of the form import { a, b } from './x.js';`); return; }
      if (!fs.existsSync(path.join(appDir, x[2]))) fail(`${f}:${i + 1}: imports ${x[2]}, which does not exist`);
      if (m.imports[x[2]]) fail(`${f}: imports from ${x[2]} twice`);
      m.imports[x[2]] = x[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (/^\s*export\b/.test(l)) {
      const x = l.match(EXPORT);
      if (!x) { fail(`${f}:${i + 1}: an export not of the form export { a, b };`); return; }
      m.exports.push(...x[1].split(',').map((s) => s.trim()).filter(Boolean));
      if (lines.slice(i + 1).some((r) => r.trim())) fail(`${f}: the export line is not the last line`);
    }
  });
  if (f === 'main.js' && m.exports.length) fail('main.js exports something: nothing imports the entry');
  if (f !== 'main.js' && !m.exports.length) fail(`${f}: exports nothing`);
  // top-level declarations, and (outside main.js) only declarations at the top level; each top-level
  // statement's token range, so a local of the same name as another module's can be told apart
  const toks = tokenize(src).filter((t) => t.t !== 'cmt');
  m.toks = toks; m.scopes = [];
  let depth = 0, start = true, kind = null, from = 0;
  const end = (k) => { m.scopes.push([from, k]); start = true; kind = null; };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (depth === 0 && start) {
      if (t.t === 'p' && t.v === ';') continue;
      start = false; from = k;
      if (t.t === 'id' && (t.v === 'import' || t.v === 'export')) kind = 'module';
      else if (t.t === 'id' && (t.v === 'function' || (t.v === 'async' && toks[k + 1].v === 'function'))) {
        kind = 'function';
        const nm = toks[t.v === 'async' ? k + 2 : k + 1];
        if (m.top.has(nm.v)) fail(`${f}: ${nm.v} is declared twice`);
        m.top.set(nm.v, nm.line);
      } else if (t.t === 'id' && (t.v === 'const' || t.v === 'let')) {
        kind = 'binding';
        // the names bound: a plain name, or the names inside a { } or [ ] pattern
        let j = k + 1;
        for (;;) {
          const u = toks[j];
          if (u.t === 'p' && (u.v === '{' || u.v === '[')) {
            let d = 1; j++;
            for (; d > 0; j++) { const w = toks[j]; if (isOpen(w)) d++; else if (isClose(w)) d--; else if (w.t === 'id' && d === 1 && toks[j + 1].v !== ':') m.top.set(w.v, w.line); }
          } else if (u.t === 'id') { if (m.top.has(u.v)) fail(`${f}: ${u.v} is declared twice`); m.top.set(u.v, u.line); j++; }
          // skip the initializer to the next comma or semicolon at this level
          let d = 0;
          for (; j < toks.length; j++) { const w = toks[j]; if (isOpen(w)) d++; else if (isClose(w)) d--; else if (d === 0 && w.t === 'p' && (w.v === ',' || w.v === ';')) break; }
          if (!toks[j] || toks[j].v === ';') break;
          j++;
        }
      } else {
        if (f !== 'main.js') fail(`${f}:${t.line}: a statement at the top level that is not a declaration (${t.v}): only main.js runs code when it loads`);
        kind = 'statement';
      }
    }
    if (isOpen(t)) { depth++; continue; }
    if (isClose(t)) {
      depth--;
      if (depth === 0 && t.v === '}' && kind === 'function') end(k);
      else if (depth === 0 && t.v === '}' && kind === 'binding') {
        // a declaration that ends in } with no ; would run on into the next statement's line
        const n = toks[k + 1];
        if (n && n.line > t.line && !(n.t === 'p' && [';', ',', '.', '?.', ')', ']', '(', '['].includes(n.v))) { fail(`${f}:${t.line}: a top-level declaration that does not end with ;`); end(k); }
      }
      continue;
    }
    if (depth === 0 && t.t === 'p' && t.v === ';') end(k);
  }
  if (!start) end(toks.length - 1);
  // inside each top-level statement, the names declared locally: const/let/var names (and the names
  // in their patterns), inner function names, parameters, arrow parameters, catch bindings
  m.locals = m.scopes.map(([a, b]) => {
    const names = new Set();
    for (let k = a + 1; k <= b; k++) {
      const t = toks[k], p = toks[k - 1], n = toks[k + 1];
      if (t.t === 'id' && ['const', 'let', 'var'].includes(t.v)) { declNames(toks, k).forEach((x) => names.add(x)); continue; }
      if (t.t !== 'id' || KEYWORDS.has(t.v)) continue;
      if (p && p.t === 'id' && p.v === 'function') { names.add(t.v); continue; }
      if (n && n.t === 'p' && n.v === '=>' ) { names.add(t.v); continue; }
      // in a pattern or a parameter list: preceded by ( , { [ ... and followed by , ) = } ]
      if (p && p.t === 'p' && ['(', ',', '{', '[', '...'].includes(p.v) && n && n.t === 'p' && [',', ')', '=', '}', ']'].includes(n.v)) {
        // only where the bracket opens a parameter list, a pattern after const/let/var, or a catch
        // the bracket that encloses it, climbing out of nested patterns ([a, b] or {a, b} inside the list)
        let q = k - 1, d = 0;
        for (; q > a; q--) { const w = toks[q]; if (isClose(w)) d++; else if (isOpen(w)) { if (d === 0) { if (w.v !== '(' && toks[q - 1] && toks[q - 1].t === 'p' && ['(', ',', '[', '{'].includes(toks[q - 1].v)) continue; break; } d--; } }
        const opener = toks[q], before = toks[q - 1];
        let r = q, dd = 0;
        for (; r <= b; r++) { const w = toks[r]; if (isOpen(w)) dd++; else if (isClose(w)) { dd--; if (dd === 0) break; } }
        const after = toks[r + 1];
        const params = opener && opener.v === '(' && ((before && (before.t === 'id' && (before.v === 'function' || before.v === 'catch' || toks[q - 2] && toks[q - 2].v === 'function'))) || (after && after.v === '=>') || (after && after.v === '{' && before && before.t === 'id'));
        const pattern = before && before.t === 'id' && ['const', 'let', 'var'].includes(before.v);
        if (params || pattern) names.add(t.v);
      }
    }
    return names;
  });
  m.localAt = (k, nm) => m.scopes.some(([a, b], i) => k >= a && k <= b && m.locals[i].has(nm));
  // identifiers used: not a property after a dot, not a key in an object literal, not on an import or export line
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id' || KEYWORDS.has(t.v)) continue;
    if (/^(import|export)\b/.test(lines[t.line - 1])) continue;
    const p = toks[k - 1], n = toks[k + 1];
    if (p && p.t === 'p' && (p.v === '.' || p.v === '?.')) continue;
    if (n && n.t === 'p' && n.v === ':' && p && p.t === 'p' && (p.v === '{' || p.v === ',')) continue;
    m.uses.add(t.v);
    (m.useAt = m.useAt || []).push([k, t.v, t.line]);
  }
}

// 2. the preloads are the import graph
const closure = new Set();
const visit = (f) => { if (closure.has(f) || !M[f]) return; closure.add(f); Object.keys(M[f].imports).forEach(visit); };
visit('main.js');
const preload = new Set([...html.matchAll(/<link rel="modulepreload" href="js\/app\/([\w-]+\.js)">/g)].map((m) => m[1]));
for (const f of closure) if (!preload.has(f)) fail(`index.html: ${f} is imported but not preloaded`);
for (const f of preload) if (!closure.has(f)) fail(`index.html: ${f} is preloaded but not imported`);
for (const f of files) if (!closure.has(f)) fail(`${f} is in js/app/ but nothing imports it`);

// 4-6. names across modules
const declaredIn = new Map();
for (const m of Object.values(M)) for (const nm of m.top.keys()) {
  if (declaredIn.has(nm)) fail(`${nm} is declared in both ${declaredIn.get(nm)} and ${m.f}: the bundle would keep only one`);
  declaredIn.set(nm, m.f);
}
for (const m of Object.values(M)) {
  for (const e of m.exports) if (!m.top.has(e)) fail(`${m.f} exports ${e}, which it does not declare`);
  const imported = new Map();
  for (const [from, names] of Object.entries(m.imports)) for (const nm of names) {
    if (!M[from] || !M[from].exports.includes(nm)) fail(`${m.f} imports ${nm} from ${from}, which does not export it`);
    if (imported.has(nm) || m.top.has(nm)) fail(`${m.f}: ${nm} is both imported and declared, or imported twice`);
    imported.set(nm, from);
    if (!m.uses.has(nm)) fail(`${m.f} imports ${nm} and never uses it`);
  }
  // every name another module declares, used here, must be imported, unless a local of the same
  // name is in scope there; main.js's names cannot be imported at all (nothing imports the entry)
  for (const [k, nm, line] of m.useAt || []) {
    if (m.top.has(nm) || imported.has(nm) || GLOBALS.has(nm) || m.localAt(k, nm)) continue;
    const owner = declaredIn.get(nm);
    if (owner === 'main.js') fail(`${m.f}:${line} uses ${nm} from main.js, which nothing can import: move it out of the entry`);
    else if (owner) fail(`${m.f}:${line} uses ${nm} from ${owner} without importing it`);
  }
  // an imported binding is read-only in a module (the bundle would let it be assigned, so only the
  // modules would fail): no assignment to one, other than a local of the same name
  const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=']);
  m.toks.forEach((t, k) => {
    if (t.t !== 'id' || !imported.has(t.v) || m.localAt(k, t.v)) return;
    const p = m.toks[k - 1], n = m.toks[k + 1];
    if (p && (p.v === '.' || p.v === '?.' || ['const', 'let', 'var'].includes(p.v))) return;
    const assigned = (n && n.t === 'p' && (ASSIGN.has(n.v) || n.v === '++' || n.v === '--')) || (p && p.t === 'p' && (p.v === '++' || p.v === '--') && !(n && n.t === 'p' && (n.v === '.' || n.v === '[')));
    if (assigned) fail(`${m.f}:${t.line}: assigns to ${t.v}, imported from ${imported.get(t.v)}: imports are read-only; change it through a function in its own module`);
  });
}

// 8. the running session changes only through setR, in session.js
for (const m of Object.values(M)) {
  const toks = tokenize(m.src).filter((t) => t.t !== 'cmt');
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    if (t.t === 'id' && t.v === 'R' && toks[k + 1] && toks[k + 1].t === 'p' && toks[k + 1].v === '=' && !(prev && (prev.v === '.' || prev.v === 'let')) && !(m.f === 'state.js' && /function setR/.test(m.lines[t.line - 1]))) fail(`${m.f}:${t.line}: R is assigned outside setR`);
    if (t.t === 'id' && t.v === 'setR' && toks[k + 1] && toks[k + 1].v === '(' && m.f !== 'session.js' && m.f !== 'state.js') fail(`${m.f}:${t.line}: setR is called outside session.js`);
  });
}

// 9. the action tables: each merged once, no key twice, every static data-act names one
const tableKeys = (src, open) => {
  const lines = src.split('\n'), i = lines.indexOf(open), keys = [];
  if (i < 0) return null;
  for (let j = i + 1; j < lines.length && lines[j] !== '  };'; j++) { const x = lines[j].match(/^ {4}([A-Za-z_$][\w$]*)\s*[:,(]/); if (x) keys.push(x[1]); }
  return keys;
};
const actKeys = new Map();
const main = M['main.js'];
const mainKeys = tableKeys(main.src, '  const ACT = {') || [];
mainKeys.forEach((k) => actKeys.set(k, 'main.js'));
const spreads = [...main.src.matchAll(/^ {4}\.\.\.(\w+Actions),$/gm)].map((x) => x[1]);
for (const m of Object.values(M)) for (const nm of m.exports.filter((e) => /Actions$/.test(e))) {
  const n = spreads.filter((s) => s === nm).length;
  if (n !== 1) fail(`${nm} is merged into ACT ${n} times`);
  for (const k of tableKeys(m.src, `  const ${nm} = {`) || []) { if (actKeys.has(k)) fail(`the action ${k} is in both ${actKeys.get(k)} and ${m.f}`); actKeys.set(k, m.f); }
}
for (const s of spreads) if (!Object.values(M).some((m) => m.exports.includes(s))) fail(`main.js merges ${s}, which no module exports`);
// the action-name argument of the helpers that render answer buttons (data-act="${act}")
for (const m of Object.values(M)) for (const x of m.src.matchAll(/\bnotesHTML\(\s*[^,()]+,\s*'([A-Za-z_$][\w$]*)'|\b(?:ladderHTML|pianoHTML|staffHTML)\(\s*[^,()]+,\s*[^,()]+,\s*'([A-Za-z_$][\w$]*)'/g)) { const nm = x[1] || x[2]; if (!actKeys.has(nm)) fail(`${m.f}: '${nm}' is passed as an action and names none`); }
for (const src of [html, ...Object.values(M).map((m) => m.src)]) {
  for (const x of src.matchAll(/data-act="([A-Za-z_$][\w$]*)"/g)) if (!actKeys.has(x[1])) fail(`data-act="${x[1]}" names no action`);
  for (const x of src.matchAll(/data-live="([A-Za-z_$][\w$]*)"/g)) if (!actKeys.has(x[1])) fail(`data-live="${x[1]}" names no action`);
}

// 10. every module but the entry evaluates in Node, in the browser's order, after the classic scripts
(async () => {
  globalThis.window = globalThis;
  const mem = {};
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  globalThis.document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return null; }, getElementById() { return null; } };
  globalThis.addEventListener = () => {};
  try {
    for (const f of CLASSIC) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
    for (const f of [...closure].filter((x) => x !== 'main.js')) await import(pathToFileURL(path.join(appDir, f)).href);
  } catch (e) { fail('a module failed to load: ' + String(e && e.message || e)); }
  console.log(bad ? `${bad} problems` : `modules OK (${files.length} modules, ${declaredIn.size} names, ${actKeys.size} actions)`);
  process.exitCode = bad ? 1 : 0;
})();
