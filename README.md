# noaware.io

The website of Mono No Aware Studios, an independent games and music studio in Melbourne,
Australia. One static page built with [Hugo](https://gohugo.io) (no theme, no JavaScript,
no third-party requests), deployed to GitHub Pages at <https://noaware.io>.

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
are per-release URLs and each link is only shown when its URL is filled in.

```yaml
- title: "New Single"
  kind: Single
  released: "2027-03-05"
  spotify: "https://open.spotify.com/album/..."
  apple: ""
```

### Swap in key art

Put the image in `assets/images/` and point `game.image` (path relative to `assets/`, e.g.
`images/hold-tight.jpg`) and `game.image_alt` in `content/_index.md` at it. The frame is 4:3:
Hugo centre-crops the source to 4:3 and writes 800- and 1067-wide JPEG and WebP variants. The
Open Graph / Twitter card image and alt text come from the same settings: the full, uncropped
source is published at the same path under `/images/` (today `/images/nebula.jpg`), so keep it
under about 300 KB and nothing else needs editing. The current nebula is a placeholder.

### Profile links

The About section's contact rows read `params.links` in `hugo.toml` (GitHub, LinkedIn, and the
Spotify and Apple Music artist pages). The email address is `params.email`.

## Fonts

Cormorant Garamond and Instrument Sans are self-hosted in `static/fonts/` (latin subsets,
variable weight, woff2). No requests go to Google Fonts at runtime.

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
