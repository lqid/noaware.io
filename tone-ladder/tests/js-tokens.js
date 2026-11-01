'use strict';
// A small JS tokenizer: comments, strings, template literals with nested ${}, regex literals
// (by the previous significant token), identifiers, numbers, punctuators. Each token has a line.
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  // template nesting: stack of brace depths at which a ${ was opened
  const tstack = [];
  let braceDepth = 0;
  const prevSig = () => { for (let k = toks.length - 1; k >= 0; k--) if (toks[k].t !== 'ws' && toks[k].t !== 'cmt') return toks[k]; return null; };
  const regexOk = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.t === 'id') return KW_BEFORE_REGEX.has(p.v);
    if (p.t === 'tpl') return !p.tail; // right after ${ an expression starts
    if (p.t === 'num' || p.t === 'str' || p.t === 're') return false;
    if (p.t === 'p') return !(p.v === ')' || p.v === ']' || p.v === '}' || p.v === '++' || p.v === '--');
    return true;
  };
  function readTemplate(startLine) {
    // at i: just after ` or after the } closing a ${...}; read text until ` or ${
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += c + src[i + 1]; if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '`') { i++; return { end: true, s }; }
      if (c === '$' && src[i + 1] === '{') { i += 2; return { end: false, s }; }
      if (c === '\n') line++;
      s += c; i++;
    }
    throw new Error('unterminated template from line ' + startLine);
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const s = i; while (i < n && src[i] !== '\n') i++; toks.push({ t: 'cmt', v: src.slice(s, i), line }); continue; }
    if (c === '/' && src[i + 1] === '*') { const s = i, l0 = line; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; toks.push({ t: 'cmt', v: src.slice(s, i), line: l0 }); continue; }
    if (c === '\'' || c === '"') {
      const s = i, l0 = line; i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; toks.push({ t: 'str', v: src.slice(s, i), line: l0 }); continue;
    }
    if (c === '`') {
      const l0 = line; i++;
      const r = readTemplate(l0);
      toks.push({ t: 'tpl', v: r.s, line: l0, head: true, tail: r.end });
      if (!r.end) tstack.push(braceDepth);
      continue;
    }
    if (c === '}' && tstack.length && tstack[tstack.length - 1] === braceDepth) {
      tstack.pop(); i++;
      const l0 = line;
      const r = readTemplate(l0);
      toks.push({ t: 'tpl', v: r.s, line: l0, head: false, tail: r.end });
      if (!r.end) tstack.push(braceDepth);
      continue;
    }
    if (c === '/' && regexOk()) {
      const s = i, l0 = line; i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') inClass = true; else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') throw new Error('newline in regex at line ' + l0);
        i++;
      }
      i++; while (i < n && /[a-z]/i.test(src[i])) i++;
      toks.push({ t: 're', v: src.slice(s, i), line: l0 }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const s = i; while (i < n && /[\w$]/.test(src[i])) i++; toks.push({ t: 'id', v: src.slice(s, i), line }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) { const s = i; i++; while (i < n && /[\w.]/.test(src[i])) { if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '-' || src[i + 1] === '+')) i++; i++; } toks.push({ t: 'num', v: src.slice(s, i), line }); continue; }
    // punctuators, longest first
    const P = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];
    let p = P.find((x) => src.startsWith(x, i));
    if (p === '?.' && /[0-9]/.test(src[i + 2])) p = null;
    if (!p) p = c;
    if (p === '{') braceDepth++;
    if (p === '}') braceDepth--;
    toks.push({ t: 'p', v: p, line }); i += p.length;
  }
  return toks;
}
module.exports = { tokenize };
