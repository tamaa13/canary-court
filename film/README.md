# Demo film v4 (playback page)

The film is a web page, not a video yet: one timeline drives text cards, news clips, the logo and the real site in a
floating card, synced to rt-3d's score. Review it in the browser; render to video only once the cut is final.

```bash
# the site, offline (no RPC calls): it must be running on :3100
cd site && NEXT_PUBLIC_CC_OFFLINE=1 pnpm dev
# the film, from the repo root
node film/serve.mjs          # → http://localhost:3200/film/
```

`serve.mjs` serves `film/` and proxies everything else to the site, so the site's pages load in the film's own origin.
That lets the film scroll them, aim the camera at a line of text, light up one row, and keep them in light theme. A plain
static server works too, but then the camera can't scroll and uses its fallback coordinates.

## Review

| key | |
|---|---|
| space | play / pause |
| ← / → | 1 s back / forward (shift: 5 s) |
| , / . | one frame (1/30 s) |
| C | cue list (click a cue to jump) |

## Edit

Every timing is at the top of `film.js`:
- `CUES`: one row per scene, in seconds. `_word_` underlines a word.
- `SHOTS`: the camera over the site (page, scroll, focus point, zoom, the lit row). `A('text')` and `S('text', top)` aim at
  a line of text on the page, so the shots survive small layout changes.
- `CLIPS`: the news clips. They are **placeholders** until the list is final: put a file in `film/clips/`, set `src`
  (mp4/webm/jpg/png, shown in black and white) and the caption `words`.
- `CONFIG.host`: the public address, shown in /join's sentence and on the end card. A placeholder until the real domain is known at deploy.

The music follows the same seconds (rt-3d's `score.py` CUES: 0 · 14 · 22 · 38 · 42 · 70 · 76 · 85). If a section moves,
send rt-3d the new times. `audio/score.mp3` is rt-3d's file; it is not committed here (copy it from their `film/audio/`).

## Capture (for the final render)

`?capture=1` hides the controls and shows the 1920×1080 stage at 1:1; `&t=41.5` opens on one frame. For frame-by-frame
capture, open it in a 1920×1080 browser, `await window.filmReady`, then for each frame `await window.filmSeek(t)` and
screenshot. Note that the site's relative times ("9.8h ago") are live, so render in one sitting.
