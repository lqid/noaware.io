'use strict';
// A link carries the progress: the store makes one, reads one back, refuses a cut or foreign one,
// and keeps a long history short enough to send.
//   node tone-ladder/tests/sync-check.js [path/to/static/tone-ladder]
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'static', 'tone-ladder');
globalThis.window = globalThis;
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
globalThis.document = { addEventListener() {}, querySelector() { return null; } };
for (const f of ['theory.js', 'curriculum.js', 'store.js']) vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), { filename: f });
const S = TL.Store, TRACK = TL.Curriculum.TRACK;
let bad = 0;
const fail = (m) => { bad++; console.log(m); };
(async () => {
  if (!S.canLink) { console.log('this Node has no compression streams; the link test needs Node 21 or later'); process.exitCode = 1; return; }
  // some progress to carry
  const lv = TRACK.degrees.levels[0];
  for (let i = 0; i < 60; i++) S.record({ track: 'degrees', level: 0, items: [TL.pick(lv.items)], results: [i % 7 ? 1 : 0], rt: 1200 });
  S.set('timbre', 'strings');
  const base = 'https://noaware.io/tone-ladder/';
  const link = await S.exportLink(base);
  if (!link.startsWith(base + '#p=')) fail('link shape: ' + link.slice(0, 60));
  if (/[^A-Za-z0-9_\-#=:/.]/.test(link)) fail('link has characters outside base64url');
  console.log(`link: ${link.length} characters for ${S.exportText().length} of JSON`);
  // read it back independently, not through the store
  const payload = link.slice(link.indexOf('#p=') + 3).replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(zlib.inflateRawSync(Buffer.from(payload, 'base64')).toString('utf8'));
  if (json.app !== 'tone-ladder' || json.state.settings.timbre !== 'strings' || json.state.updatedAt !== S.state.updatedAt) fail('the link does not carry the export');
  // and through the store, as the page does
  const text = await S.textFromLink(new URL(link).hash);
  const st = S.parseBackup(text);
  if (st.settings.timbre !== 'strings' || Object.keys(st.items).length !== Object.keys(S.state.items).length) fail('the link did not read back');
  // what is refused
  const expect = async (hash, re, what) => { try { await S.textFromLink(hash); fail(what + ': accepted'); } catch (e) { if (!re.test(e.message)) fail(what + ': ' + e.message); } };
  await expect(link.slice(0, -40).split('#')[1] ? '#' + link.slice(0, -40).split('#')[1] : '', /cut short/, 'a cut link');
  await expect('#p=' + payload.slice(0, 10) + '!!', /not a Tone Ladder link/, 'junk');
  await expect('#x=abc', /not a Tone Ladder link/, 'another fragment');
  await expect('', /not a Tone Ladder link/, 'no fragment');
  await expect('#p=AAAA', /cut short/, 'bytes that are not deflate');
  // a link stays short enough to send: a year and more of daily practice in three tracks, with
  // answer times and intonation on the last half year (as kept), well under 40,000 characters
  const full = JSON.parse(S.exportText()).state;
  full.days = {};
  const d = new Date();
  for (let i = 0; i < 420; i++) {
    const k = TL.dayKey(d), n = 10 + (i % 17);
    full.days[k] = { q: 3 * n, c: Math.round(2.4 * n * 100) / 100, s: 600 + i % 300, t: { degrees: [n, Math.round(0.8 * n * 100) / 100], intervals: [n, Math.round(0.75 * n * 100) / 100], sing: [n, Math.round(0.85 * n * 100) / 100] } };
    if (i < 182) Object.assign(full.days[k], { rt: { degrees: [n - 2, (n - 2) * (20 + i % 9)], intervals: [n - 3, (n - 3) * (25 + i % 11)] }, cl: { sing: [n - 1, (n - 1) * (15 + i % 13), -(n - 1) * (i % 7)] } });
    d.setDate(d.getDate() - 1);
  }
  S.state = S.parseBackup(JSON.stringify(full));
  const big = await S.exportLink(base);
  console.log(`a 420-day link: ${big.length} characters`);
  if (big.length > 40000) fail(`a 420-day link is ${big.length} characters, over 40,000`);
  if (JSON.stringify(S.parseBackup(await S.textFromLink(new URL(big).hash)).days) !== JSON.stringify(S.state.days)) fail('a 420-day link did not read back');
  console.log(bad ? `${bad} problems` : 'sync OK');
  process.exitCode = bad ? 1 : 0;
})();
