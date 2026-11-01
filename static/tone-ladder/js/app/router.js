/* Tone Ladder — routing and rendering the current view. */
import { $, $$, A, S, micCopy } from './base.js';
import { R, app } from './state.js';
import { viewExplore } from './explore.js';
import { viewMethod } from './method.js';
import { MOVE, disarmReset, viewPrefs } from './prefs.js';
import { viewProgress } from './progress.js';
import { renderSession } from './session-view.js';
import { endRunner } from './session.js';
import { viewToday } from './today.js';
import { viewTrack } from './track.js';
import { musicLeave, viewMusic } from './your-music.js';

  // ======================================================================
  // ROUTING & RENDER
  // ======================================================================
  function go(view, params = {}) {
    if (R && view !== 'session') endRunner();
    if (view !== app.view || (view !== 'explore' && view !== 'music')) A.droneStop(0.3); // Explore and Music keep their own drone
    if (app.view === 'music' && view !== 'music') musicLeave();
    app.view = view;
    app.params = params;
    disarmReset();
    Object.assign(MOVE, { copied: null, pasting: false, error: '', warn: '', pasted: '' });
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    document.body.classList.toggle('in-session', app.view === 'session');
    $$('#nav button').forEach((b) => {
      const v = b.dataset.view;
      if ((app.view === v) || (app.view === 'track' && v === 'today')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const v = $('#view');
    if (app.view === 'session') { if (R) renderSession(); else { app.view = 'today'; v.innerHTML = viewToday(); } return; }
    if ((app.view === 'prefs' || app.view === 'explore') && !micCopy()) Object.keys(A.SAMPLED).forEach((n) => A.probeSamples(n)); // which recorded sets this copy has
    const views = { today: viewToday, track: viewTrack, explore: viewExplore, music: viewMusic, progress: viewProgress, method: viewMethod, prefs: viewPrefs };
    const newer = S.blocked ? `<section class="welcome" style="grid-template-columns:1fr;margin-top:12px"><div>
        <p class="eyebrow">Update needed</p>
        <h2>Your progress was saved by a newer version of Tone Ladder</h2>
        <p>This page is out of date, so it will not save anything until it is reloaded. Reload to get the new version; your progress is safe.</p>
        <div class="row" style="margin-top:16px"><button class="btn primary" data-act="reload">Reload</button></div>
      </div></section>` : '';
    v.innerHTML = newer + (views[app.view] || viewToday)();
  }

export { go, render };
