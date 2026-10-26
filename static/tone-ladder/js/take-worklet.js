/* Tone Ladder — keeps the sound of the current Sing answer, for "Save this take". It runs in the
   audio thread and copies what the microphone hears to the page, sample for sample, only while the
   page asks it to. The page holds one answer at a time; nothing leaves it unless the learner saves.
   It also keeps the last moments before a take starts (`pre`, the analyser's window and a little
   more), since the first frames the app grades reach back that far. Every chunk carries the take's
   number, so the page can drop a chunk that belongs to an answer it has already let go. */
class TakeRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const pre = (options && options.processorOptions && options.processorOptions.pre) || 8192;
    this.ring = new Float32Array(pre + 128 * Math.ceil((0.05 * sampleRate) / 128));
    this.wi = 0; this.rn = 0; this.rEnd = 0; // write index, samples held, frame just after the newest
    this.on = false; this.gen = 0;
    this.buf = new Float32Array(4096);
    this.n = 0; this.from = 0; // samples waiting, and the audio frame of buf[0]
    this.port.onmessage = (e) => {
      const d = e.data || {};
      this.flush(); // what was kept so far belongs to the take it was kept for
      this.on = !!d.on;
      if (d.gen != null) this.gen = d.gen;
      if (this.on && this.rn) this.port.postMessage({ gen: this.gen, from: this.rEnd - this.rn, data: this.unroll() });
    };
  }
  unroll() {
    const R = this.ring, L = R.length, out = new Float32Array(this.rn);
    for (let i = 0, j = (this.wi - this.rn + L) % L; i < this.rn; i++, j = (j + 1) % L) out[i] = R[j];
    return out;
  }
  flush() {
    if (this.n) this.port.postMessage({ gen: this.gen, from: this.from, data: this.buf.slice(0, this.n) });
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) { this.flush(); this.rn = 0; return true; } // a gap: the mic is closed
    const R = this.ring, L = R.length;
    for (let i = 0; i < ch.length; i++) { R[this.wi] = ch[i]; this.wi = (this.wi + 1) % L; }
    this.rn = Math.min(L, this.rn + ch.length);
    this.rEnd = currentFrame + ch.length;
    if (this.on) {
      if (!this.n) this.from = currentFrame;
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n + 128 > this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor('tl-take', TakeRecorder);
