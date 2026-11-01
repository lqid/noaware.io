# noaware.io

The website of Mono No Aware Studios, an independent games and music studio in Melbourne,
Australia. One static page built with [Hugo](https://gohugo.io) (no theme, no JavaScript,
no third-party requests), deployed to GitHub Pages at <https://noaware.io>. It also hosts
[Tone Ladder](#tone-ladder-tone-ladder), an ear-training app, as a separate static page.

## Run locally

Needs Hugo 0.165.0 extended (`brew install hugo`).

```sh
hugo server
```

Then open <http://localhost:1313>. A production build is `hugo --minify`; it writes to `public/`.

## Where things live

| What | Where |
| --- | --- |
| Page copy (hero, game, sound, live, about) | `content/_index.md` front matter |
| Releases | `data/releases.yaml` |
| Live dates | `data/live.yaml` |
| Email and profile links | `hugo.toml` under `[params]` |
| Layouts | `layouts/` (`_default/baseof.html`, `index.html`, `404.html`, `partials/`) |
| Styles | `assets/css/main.css` (tokens are CSS custom properties at the top) |
| Game image (key art) | `assets/images/` (Hugo crops and resizes it at build time) |
| Cover art for releases | `assets/images/releases/` (square sources; thumbnails are made at build time) |
| Fonts, favicon, redirects | `static/` |

### Add a live date

Edit `data/live.yaml`. An empty list shows "No dates yet."; otherwise each entry becomes a row
of date · venue, city · tickets link. Dates are `YYYY-MM-DD` and are shown as "Sat 14 Nov 2026".
Leave `tickets` empty if there is no link yet.

```yaml
dates:
  - date: 2026-11-14
    venue: "The Venue"
    city: "Melbourne"
    tickets: "https://example.com/tickets"
```

### Add a release

Add an entry to `data/releases.yaml`. The site sorts the list newest first by `released`
(the year shown comes from it), so position in the file does not matter. `spotify` and `apple`
are per-release URLs and each link is only shown when its URL is filled in. `image` is the
cover art: put a square image (600 px is plenty) in `assets/images/releases/` and give the path
relative to `assets/`; Hugo makes the thumbnails. Leave `image` out for a row with no art.

```yaml
- title: "New Single"
  image: "images/releases/new-single.jpg"
  kind: Single
  released: "2027-03-05"
  spotify: "https://open.spotify.com/album/..."
  apple: ""
```

### Swap in key art

Put the image in `assets/images/` and point `game.image` (path relative to `assets/`) and
`game.image_alt` in `content/_index.md` at it. The frame is 16:9; Hugo crops and resizes at
build time and the social card uses the same image at its full size, published under
`/images/`, so keep the source under about 400 KB. The current image is the Terra Incognita
concept painting for Hold Tight. More concept art goes in `game.gallery` (image and alt text per
entry); those are shown whole, in order, under the key art, and the credit line covers them all.
The list is empty on purpose: one image on the front page.

### The Hold Tight page (draft)

`content/hold-tight.md` is a concept-art page for `/hold-tight/`, kept as a draft (`draft: true`)
so it is not built or published. It holds the world painting and the cabin render; the character
and puzzle-complex sheets are held back on purpose. To publish it: set `draft: false`, delete
`static/hold-tight/index.html` (the redirect that stands in for the page), and push. The front
page's "More concept art" link appears by itself once the page exists.

### Profile links

The About section's contact rows read `params.links` in `hugo.toml` (GitHub, LinkedIn, and the
Spotify and Apple Music artist pages). The email address is `params.email`.

## Tone Ladder (`/tone-ladder/`)

An ear-training course for composers, published at <https://noaware.io/tone-ladder/>. It is
unlisted: nothing on the studio page links to it, and it carries `noindex`. All of it is in
`static/tone-ladder/`, which Hugo copies as is (no build step, no templates):

| What | Where |
| --- | --- |
| The page (markup, meta, Content Security Policy) | `static/tone-ladder/index.html` |
| App styles | `static/tone-ladder/app.css` |
| Studio look: fonts from `/fonts/`, paper palette | `static/tone-ladder/studio.css` |
| Theory, sound, curriculum, progress, pitch, takes, notation, the music player (classic scripts that set `TL.*`) | `static/tone-ladder/js/*.js` |
| The app: one ES module per screen or concern; `main.js` wires the events and boots | `static/tone-ladder/js/app/` |
| Offline copy and install: service worker, manifest, icons | `static/tone-ladder/sw.js`, `manifest.webmanifest`, `icon-*.png` |
| Recorded instruments, built from a folder of notes | `static/tone-ladder/samples/<piano|strings>/` (not in git until recorded), `tone-ladder/samples/build.js` |

Unlike the studio page it runs JavaScript, but only its own files, and it still makes no
third-party requests: the sound is synthesized in the browser or played from recorded notes
served with the page, and the fonts are the studio's.
Its policy allows its own scripts, styles, fonts and images, plus inline styles (the note
colors are set as style attributes), and nothing else. `hugo server` serves the page as a plain
file: it does not inject its live-reload script, so refresh by hand after an edit, and treat any
policy error in the console as real.

Progress is saved in the visitor's browser (`localStorage`). Preferences → Move your progress
copies it as text and pastes it into another browser, another device, or the claude.ai version.
A paste is checked before it replaces anything, and can be undone. Saved progress is rebuilt
field by field on every load, so stale or hand-edited data cannot break the page. Today's plan
is kept on the device (`tone-ladder-v1-plan`), so an interrupted session resumes where it stopped.

The Sing track can check singing through the microphone (`js/pitch.js` hears the notes;
`js/audio.js` opens the mic; `js/app/mic.js` runs the flow). The sound is analysed in the page and
never sent, and the policy needs no change for it. Only the current answer's sound is kept, in
memory until the next question: "Save this take" writes it to a WAV file on the learner's own
computer (`js/take-worklet.js` records it, `js/take.js` writes it with what is needed to replay
it), so a misgraded answer can become a test case. The choice is kept per device in
`tone-ladder-v1-device`, not in the progress, because microphone access belongs to one browser.
The mic opens before the first question of a Sing set, never while chords are playing, and
closes when the set ends. Browsers only offer the mic on https pages, so test phones against a
deployed copy, not `hugo server` over the local network. The claude.ai copy has no microphone
access and leaves the feature out. `tone-ladder/pitch-harness/` scores `pitch.js` against
synthetic singing (rooms, mics, the app's own sound through the speakers), and replays saved
takes; run `node tone-ladder/pitch-harness/run.js static/tone-ladder/js/pitch.js` and
`node tone-ladder/pitch-harness/takes.js` after changing it.

With the microphone on, the Rhythm track also hears claps (`clapTick` in `js/app/rhythm.js`): a clap is
a sudden burst well above the room and above the app's own clicks, whose loudness at the mic is
measured during the get-ready clicks. A clap counts like a tap at its moment, so claps and taps
mix freely. Preferences → Clap rhythms turns it off.

Note questions can be answered on a piano instead of the ladder (Preferences → Answer notes on):
the keys from the Sol below Do up to High Do (Do to High Do on a phone), named by scale degree. A MIDI
keyboard answers the same questions by playing the note (Web MIDI, so Chrome and Edge; the
browser asks once, and the choice is kept per device). The claude.ai copy leaves MIDI out, as it
does the microphone.

Sight-Singing (`sight` in `js/curriculum.js`) is the eighth track: a melody written on a staff in its
key, sung on its names after the four chords, and graded by the same melody listener as Sing (or
by the learner). It opens once Sing a pattern is mastered, and its levels take help away one
piece at a time: the names under the notes, then the first note named, then no names, then no
key name (Do from the signature), then the other clef, Fi and Te, and minor; each level that
needs notes Sing has not taught yet waits for that Sing level. Every note is a quarter note,
because the listener grades the notes and not how long each is held, and the copy says so. A
low singing range reads the bass clef, a middle one the treble clef with an 8 under it (written
an octave up, as tenor parts are), a high one the treble clef; what is written is what plays and
what is graded, and any octave counts. After singing, the notes the app heard wrong turn red on
the staff, once the learner has made their own call. Adding the track bumped the save format to 7.

Answers can be written on a staff (`js/notation.js`: a renderer with its own clef and accidental
paths, no font; notes spelled by scale degree from the key the app names, minor and the modes
from the same Do). After an answer the feedback shows what sounded on a staff in the key with the
names underneath (Preferences → The answer on a staff), rhythms as rhythmic notation on their
intro cards and after a try, and Answer notes on → A staff makes the staff the control: the mode's
degrees on their lines and spaces, with an Altered notes toggle where a question offers Fi or Te.

Your music (the Music tab) works on a recording of the learner's own: open a file, loop a
passage, slow it down without changing the pitch (the browser's own `preservesPitch`), hold a
drone in its key, find Do, and mark the chords by bass note and Roman numeral. `js/music.js`
owns the player (one audio element kept out of the rendered view, a loop held by a timer aimed
at its end) and the analysis: the file is decoded at 11 kHz in a throwaway offline context, read
once into a chroma vector per frame and the overview's peaks, and released; Find Do over the
loop is then a sum of frames and Temperley's key profiles, offered as a hint the ear checks
against the drone. The key, loop, speed, drone level and marks are kept per file in
`tone-ladder-v1-music` on the device; the file is never stored or sent. The policy allows
`media-src blob:` for it.

Recorded instruments: `tone-ladder/samples/build.js` turns a folder of notes (C2.wav, F#2.wav …)
into `static/tone-ladder/samples/<set>/`: trimmed, normalised, mono AAC under content-hashed
names, each note measured after encoding (onset, loudness, cents from equal temperament; a note
more than 30 cents off or an octave above its name is refused as mislabelled, one too short to
measure as well), and a manifest the app reads. `js/audio.js`
loads a set once, at boot for the chosen timbre, and plays the nearest recorded note at the rate
that reaches the asked one; until it is ready, or on a copy without the folder, the synthesized
sibling plays. Preferences and Explore read each set's manifest (a few hundred bytes) to learn
which sets this copy has and offer them; the notes load once one is chosen, and a set that could
not be fetched is tried again after fifteen seconds. The policy allows
`connect-src 'self'` for the fetch; the service worker keeps the notes for ever (their names
carry a hash) and the manifest network-first. The sets are not in git yet: record or bounce one
note every minor third from C2 to C6 per instrument, run the script, commit the folder, and put
the source and licence in the manifest (`--source`, `--licence`; they are credited under
Instrument in Preferences). Needs ffmpeg (`brew install ffmpeg`).

Progress can also travel as a link (Preferences → Move your progress → Copy a link, or Share a
link on a phone): the export deflated and base64url-encoded in the fragment of the app's URL,
which never reaches a server. Opening the link on another device puts the progress into the
paste panel with the same checks as a paste. The claude.ai copy can make a link (it opens the
site copy) but not receive one, and a copy added to an iPhone's Home Screen opens links in
Safari, so those two still take a paste. Links need the browser's compression streams (Safari
16.4, Chrome 103, Firefox 113 and later).

Progress → Week by week charts one track at a time over twelve rolling weeks, the last ending
today (`S.weekly` in `js/store.js`, drawn as SVG in `js/app/progress.js`): accuracy for every
track, the time to a right answer for Degrees, Intervals, Chords and Harmony (not Melody, whose
time can include singing the melody back), and intonation for Sing and Sight-Singing. A week sums
its answers rather than averaging its days, and becomes a point only with enough of them: 20
answers, 10 timed right answers, or 8 sung answers the microphone checked. Practice rounds never
count, and an answer given while the question is still sounding counts as answered in no time. A
dashed line marks each new level and the line breaks there, and the sentence under a chart never
calls a step back after a new level a decline. Hover or tap a week for its numbers; a table under
the charts holds them all. For this each day keeps, per track, the times of its right answers
(`rt`, in tenths of a second, at most 15 s each) and how far off its sung answers were (`cl`, in
cents), for half a year, while the rest of the log keeps its last 420 days of practice. Adding
them bumped the save format to 8; days from before then have neither, so those two charts start
from the update.

The site copy works offline: `sw.js` is a service worker that keeps the page, its scripts,
styles, fonts and icons in a cache (`tone-ladder-shell`), answering from the network first so a
deploy is picked up on the next load, and from the cache when there is no network. Recorded
notes are kept once played; nothing else is cached and nothing is sent. `manifest.webmanifest`
and the icons make it installable ("Add to Home Screen"); the policy allows the manifest with
`manifest-src 'self'`. A file the page loads must be on the worker's list, or the offline copy
breaks without it: `tone-ladder/tests/sw-check.js` fails when the list and the page disagree. The worker registers on `hugo server` too; it never
serves a stale file while the server is up, but to be rid of it, unregister it in the browser's
devtools. The claude.ai copy registers no worker.

The app's screens are ES modules in `js/app/`, loaded after the classic scripts by one
`<script type="module" src="js/app/main.js">`, with every module preloaded. A few rules keep them
apart, and `tone-ladder/tests/modules-check.js` enforces them: only `main.js` runs code when it
loads (the others only declare); every name a module uses from another is imported, no name is
declared in two modules, nothing uses a name of `main.js` (nothing can import the entry), and no
module assigns to an import (imports are read-only); the running session `R` (in `state.js`)
changes only through `setR`, called from `session.js`; a screen exports its view and a
`<name>Actions` table, which `main.js` merges into the action table once. A new module goes on
`sw.js`'s list and in `index.html`'s preloads; the worker check and the modules check fail until
it is on both. Because the modules link as one set, one that is missing, or from another deploy
whose imports or exports no longer match, stops all of them (one that still matches runs beside
the new ones): `js/start-guard.js`, a plain script, then shows "Tone Ladder could not start" with
a reload button instead of an empty page. The worker precaches past the browser's HTTP cache, so
its copy of the modules comes from one deploy, and the deploy workflow runs the checks before it
builds, so a module that does not link never reaches the site. The page needs `hugo server` (or
any server): modules do not load from `file://`. The modules were split from a single
`js/app.js` by `tone-ladder/app-harness/split-app.js`: the original lines, byte for byte with their indentation, plus computed imports and an export list; four lines changed (the two places that set the running session call `setR`, and `go()` disarms the reset through `disarmReset()`), the `setR` and `disarmReset` declarations were added, and each screen's entries of the action table moved into a `<name>Actions` table that `main.js` spreads into `ACT`.
`node tone-ladder/app-harness/split-app.js --verify` regenerates them from `js/app.js` as of
b1d424d and compares them with `js/app/` as the split committed it (52f93e9). `tone-ladder/app-harness/trace.mjs` runs the app in Node and prints everything it does;
for a change meant to keep behaviour the same, compare its output before and after.

`tone-ladder/tests/` checks the rest of the logic in Node, without a browser: every generator at
every level, progress and level-ups (the twenty-answer window, the two-day rule, old saves, the
newer-format guard, device settings), export and import, that every item a level introduces turns
up in its questions, that the notes a Sing question asks for stay in the chosen voice's range,
that the offline copy lists every file the page loads, that notation spells every degree in every
key, that the key estimate finds the key of a plain progression, that a link carries the progress,
that a long history still makes a short enough link, what the weekly charts are built from (each
answer's share of the day, the minimums, weeks across the clock changes, the half-year trim),
that the sample build measures a note, that the app's modules hold together, and that the app
runs every screen and a long session without an error (and its claude.ai bundle does the same on
that path). They need Node 22.7 or later. `run.js` runs every `*-check.js` in the folder, so a
new check cannot be forgotten. Run `node tone-ladder/tests/run.js` after changing anything in
`js/` or `sw.js`; it prints one line per script and fails if any check does.

Saved progress carries a format number (`FORMAT` in `js/store.js`). Bump it whenever the shape
of saved data changes. A copy of the app that finds a higher number than its own (an open tab
from before a deploy, or the claude.ai copy before it is republished) then leaves that progress
alone and asks for a reload, instead of cleaning it down to the old shape and saving over it.
The claude.ai copy is republished by hand, so after changing levels in `curriculum.js`,
republish it too: it refuses progress from a copy with more levels than it has. After a format
bump, republish it the same day, since until then it refuses progress pasted from the site.

The same app also runs as a private claude.ai artifact, where progress is saved to the claude.ai
account. To update that copy, build its page and scripts into a folder and publish them:

```sh
node tone-ladder/artifact.mjs <folder>
```

It writes `<folder>/tone-ladder.html` and `<folder>/js/`; publish the page with every file in
`<folder>/js` as `js/<name>`, so nothing the copy loads is left at an older version. The page
inlines `app.css`, uses the app's original fonts from Google Fonts (which claude.ai allows), and
leaves out the parts marked `site-only` in `index.html`. The copy does not load the ES modules:
`tone-ladder/app-bundle.mjs` joins them, in the order the browser would run them, into one
classic script, `js/app.js`, built like the single-file app they came from, since the claude.ai
host is not known to serve modules; `app-check.js` keeps it doing what the modules do on every path its trace
drives.

## Fonts

Cormorant Garamond and Instrument Sans are self-hosted in `static/fonts/` (latin subsets,
variable weight, woff2). No requests go to Google Fonts at runtime.

## Japanese glyphs

The four characters 物の哀れ (hero and footer) use a subset of Noto Serif JP embedded in
`assets/css/main.css` as a data URI, so they look the same on every device and need no request.
The subset contains only those four glyphs. If the characters ever change, re-cut it and
replace the base64 in the `@font-face` block, and update `unicode-range` to match:

```sh
curl -sL -A "Mozilla/5.0 Chrome/128.0" \
  "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400&text=%E7%89%A9%E3%81%AE%E5%93%80%E3%82%8C" \
  | grep -o "https://fonts.gstatic.com/[^)]*" | head -1 | xargs curl -sL | base64
```

`text=` is the URL-encoded characters.

## Deployment

Push to `main`. The GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
with Hugo 0.165.0 extended (`hugo --minify`, base URL `https://noaware.io/` from `hugo.toml`)
and publishes `public/` to GitHub Pages. The custom domain is set in the repository's
Settings → Pages; `static/CNAME` is ignored for Actions deployments and is only kept in case the
site is ever published from a branch.

The old WordPress URLs `/hold-tight/` and `/about/` are kept as static redirect pages
(`static/hold-tight/index.html`, `static/about/index.html`) pointing at `/#games` and `/#about`.

### First deploy

GitHub does not offer the Pages settings on an empty repository, and the workflow cannot turn
Pages on by itself (the default `GITHUB_TOKEN` is not allowed to), so the very first run is
expected to fail. Do these in order:

1. Push to `main`. The run this triggers fails at the "Setup Pages" step because Pages is not
   enabled yet; that is expected, not a broken workflow.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Pages → Custom domain: `noaware.io` → Save. (GitHub checks DNS as soon as the
   domain is saved; that check fails for now because DNS still points at DreamHost. Step 6 deals
   with it.)
4. Actions → "Deploy Hugo site to GitHub Pages" → Run workflow (or open the failed run and
   Re-run all jobs) and wait for it to go green. The build does not depend on DNS, so do this
   before moving the domain: that way the only downtime is DNS propagation. Check that GitHub is
   serving the site before going on:

   ```sh
   curl -sI --resolve noaware.io:80:185.199.108.153 http://noaware.io/
   ```

   should return `HTTP/1.1 200 OK` (or a 301 to https after Enforce HTTPS is turned on in
   step 6).
5. Set the DNS records below at DreamHost (DNS Only first, then the records).
6. Once the Pages settings show the certificate as issued, turn on **Enforce HTTPS**. If no
   certificate appears within about an hour of the DNS change propagating, go to Settings →
   Pages and click **Check again** next to the custom domain, or remove and re-add `noaware.io`,
   to re-run the DNS check; the certificate is only requested after a check passes. Enforce
   HTTPS can take up to a day to become available after that.

### DNS at DreamHost

The nameservers stay at DreamHost; only the web records change.

0. In the DreamHost panel: Websites → Manage Websites → Manage (`noaware.io`) → Settings tab →
   Non-Hosting Options → **Set to DNS Only** → Yes. Set the domain to DNS Only first, then add
   the records below. If the panel still lists A records for the apex or `www` that point at
   the VPS, remove them.
1. Add the records below. Leave the Name field blank for the apex rows: the panel shows `@`
   itself.

| Type | Name | Value |
| --- | --- | --- |
| A | `@` (blank) | `185.199.108.153` |
| A | `@` (blank) | `185.199.109.153` |
| A | `@` (blank) | `185.199.110.153` |
| A | `@` (blank) | `185.199.111.153` |
| AAAA | `@` (blank) | `2606:50c0:8000::153` |
| AAAA | `@` (blank) | `2606:50c0:8001::153` |
| AAAA | `@` (blank) | `2606:50c0:8002::153` |
| AAAA | `@` (blank) | `2606:50c0:8003::153` |
| CNAME | `www` | `lqid.github.io` |

Change only the A, AAAA and `www` records. Leave the existing MX and TXT records (mail, SPF,
verification) untouched, and keep the domain in the DreamHost panel as DNS Only: its
nameservers are DreamHost's, so deleting it there would take the mail down with the website.

Changing the custom domain in Settings → Pages needs no rebuild (GitHub applies it when
serving); only a change to `baseURL` in `hugo.toml` does, and that happens on the next push.

After DNS moves, remove the WordPress install from the DreamHost VPS. "Remove WordPress" means
the VPS web install only, not the domain or its DNS.
