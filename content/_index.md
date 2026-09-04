---
title: "Mono No Aware Studios"

# All page copy lives here. Releases are in data/releases.yaml, live dates in data/live.yaml,
# contact links, the email address and the meta description in hugo.toml.

hero:
  # Small line above the heading. Leave empty ("") to drop it. line_lang sets the language
  # attribute; "ja" renders upright in a Japanese serif instead of italic.
  line: "物の哀れ"
  line_lang: "ja"
  heading: "Mono No Aware Studios makes games and music in Melbourne."
  sub: "Hold Tight, a narrative puzzle game, is in development on Unreal Engine 5. The music is out on Spotify and Apple Music."

game:
  label: "01 · Games"
  title: "Hold Tight"
  # The spaces inside the multi-word terms and the space before each "·" are non-breaking
  # (U+00A0), so a term never splits across lines on a phone and a separator never starts a
  # line; the line may break only after a "·".
  meta: "Narrative puzzle game · Linear · Unreal Engine 5 · In development"
  pitch: "You wake up in a world much like this one, and something is wrong with it. You replay your own warped memories to work out what has happened. It is linear, and there is no release date."
  # Key art: an image under assets/, path relative to assets/ (16:9 shows uncropped; Hugo makes
  # the sizes, and the social card follows).
  image: "images/hold-tight.jpg"
  image_alt: "Concept art for Hold Tight: three concrete cabins on a frozen shore under a green aurora, one with a lit window, and a larger complex against snow-covered mountains."
  # Credit under the image: "<credit> <credit_name>." with the name linked when credit_url is set.
  # Leave credit_name empty ("") for no caption.
  credit: "Concept art by"
  credit_name: "Outstandly"
  credit_url: "https://outstandly.com/"
  # More concept art, shown whole under the key art in this order (image + alt per entry, paths
  # relative to assets/). Empty on purpose: one image on the front page.
  gallery: []

sound:
  label: "02 · Sound"
  title: "An album and six singles"
  blurb: "At Once, Grace. (2020) and six singles are orchestral and ambient, self-produced, and released as Daniel Kleviansky on Spotify and Apple Music."

live:
  label: "Live"
  text: "An ambient and electronic live set is being put together."
  empty: "Nothing is booked yet."
  booking: "Booking"

about:
  label: "About"
  text: "Daniel Kleviansky is director and lead engineer. He spent over a decade on large-scale systems for the Australian federal government (contact centres, voice biometrics). The studio hires people when a project needs them."
  # Optional second paragraph, body size. Leave empty ("") to drop it.
  more: "The cover art for the music was commissioned from artists, who were paid. A council of AI agents argues about Hold Tight's design and builds none of it."
  rows:
    email: "Email"
    code: "Code"
    work: "Work"
    listen: "Listen"

notfound:
  label: "404 · Not found"
  heading: "This page does not exist."
  # The link text is appended as a link to the front page, followed by a full stop.
  text: "Either the address is wrong or the page was removed. Both happen."
  link: "Back to the front page"
---
