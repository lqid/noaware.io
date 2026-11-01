/* Tone Ladder — the shared mutable state: the view, and the running session (assigned only through setR). */

  const app = { view: 'today', params: {} };
  let R = null; // the running session
  function setR(v) { R = v; } // only the session runner starts and ends a session

export { R, app, setR };
