/* Tone Ladder — a MIDI keyboard. */
import { $, A, TL, flash, micCopy, setDeviceInfo } from './base.js';
import { R, app } from './state.js';
import { answerChoice, seqPick } from './answer.js';
import { dictName } from './dictation.js';
import { render } from './router.js';

  // ---------- a MIDI keyboard ----------
  // Chrome and Edge only. A key played answers the way its note would: by its name in the
  // question's key. The choice is kept per device, like the microphone.
  const MIDI = { access: null, inputs: [], status: 'off' };
  const midiSupported = () => !!(navigator.requestMIDIAccess && !micCopy());
  async function midiConnect() {
    if (!midiSupported()) { MIDI.status = 'none'; return; }
    try {
      if (!MIDI.access) MIDI.access = await navigator.requestMIDIAccess();
      MIDI.access.onstatechange = () => { midiAttach(); if (app.view === 'prefs') render(); };
      midiAttach();
      setDeviceInfo({ midi: 'on' });
    } catch (e) { MIDI.status = 'blocked'; setDeviceInfo({ midi: 'off' }); }
    if (app.view === 'prefs') render();
  }
  // at boot: only while the browser still grants it, so a withdrawn grant does not mean a prompt on every load
  async function midiReconnect() {
    let state = 'granted';
    try { state = (await navigator.permissions.query({ name: 'midi' })).state; } catch (e) { /* no query here: connect as before */ }
    if (state === 'granted') midiConnect(); else setDeviceInfo({ midi: 'off' });
  }
  function midiAttach() {
    MIDI.inputs = [...MIDI.access.inputs.values()];
    MIDI.inputs.forEach((i) => { i.onmidimessage = midiMessage; });
    MIDI.status = MIDI.inputs.length ? 'on' : 'empty';
  }
  function midiDisconnect() {
    if (MIDI.access) MIDI.access.onstatechange = null; // or the next plug or unplug would attach it all again
    MIDI.inputs.forEach((i) => { i.onmidimessage = null; });
    MIDI.inputs = []; MIDI.status = 'off';
    setDeviceInfo({ midi: 'off' });
    render();
  }
  function midiMessage(e) {
    const [st, note, vel] = e.data;
    if ((st & 0xf0) !== 0x90 || !vel) return; // a key going down
    midiNote(note);
  }
  function midiNote(note) {
    const q = R && R.q;
    if (!q || R.phase !== 'answering' || q.tonic == null || q.layout !== 'ladder') return;
    if (q.kind === 'dictation' && R.mainEnd == null) return; // listen first
    const semi = note - q.tonic;
    const id = TL.degBySemi(semi).id;
    if (!q.options.some((o) => o.id === id)) return;
    A.wake();
    flash($(`.piano .pkey[data-semi="${semi}"]`) || $(`.piano .pkey[data-semi="${TL.mod12(semi)}"]`), 160);
    flash($(`.staff-in .spos[data-semi="${semi}"]`) || $(`.staff-in .spos[data-semi="${TL.mod12(semi)}"]`) || $(`.staff-in .spos[data-twin-semi="${TL.mod12(semi)}"]`), 160);
    if (q.kind === 'sequence') seqPick(id); else if (q.kind === 'choice') answerChoice(id); else if (q.kind === 'dictation') dictName(id);
  }

  // this screen's part of the action table (data-act), merged in main.js
  const midiActions = {
    midiOn: () => midiConnect(),
    midiOff: () => midiDisconnect(),
  };

export { MIDI, midiActions, midiNote, midiReconnect, midiSupported };
