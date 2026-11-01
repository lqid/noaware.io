/* Tone Ladder — the app's modules link as one set: if one is missing or from another deploy, none
   of them runs and the page would stay empty. When the page has finished loading and the app has
   not started, say so and offer a reload. A plain script, so it runs whatever happened to the modules. */
(function (g) {
  g.addEventListener('load', () => {
    if (g.__toneLadder) return;
    const view = g.document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<section class="welcome" style="grid-template-columns:1fr"><div><h2>Tone Ladder could not start</h2><p>Part of the app did not load, perhaps from a weak connection or right after an update. Your progress is safe on this device. Reload with a connection to start again.</p><div class="row"><button class="btn primary" type="button" id="tl-reload">Reload</button></div></div></section>';
    const b = g.document.getElementById('tl-reload');
    if (b) b.addEventListener('click', () => g.location.reload());
  });
})(typeof window !== 'undefined' ? window : globalThis);
