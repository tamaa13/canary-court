# Vault + key — scroll-story frames

The 3D image sequence behind the landing page's scroll story. A sealed vault (the TEE)
holds a lock with a canary-yellow key in it. The camera starts on a macro of the key's teeth,
rises out through the glass lid, pulls back to the whole vault on its plinth, then tilts up
to a 3/4 view. The page scrubs the frames with scroll (it doesn't play a video).

Everything is procedural (`vault.py`): no downloaded models, textures or HDRIs, and the
world is a procedural studio gradient.

| file | what |
|---|---|
| `vault.py` | builds the scene, keyframes the camera, renders PNG frames (Blender 5.2, Cycles) |
| `encode.py` | PNG → webp: large set, small set, posters (plus the alpha clean-up, see below) |
| `.render/` | git-ignored working dir: `png/` frames, `render.log`, `vault.blend` |

## Frame spec (what the page consumes)

| | |
|---|---|
| frames | **221**, index 0…220, `f000.webp` … `f220.webp` |
| large | `site/public/story/vault/fNNN.webp`, **1600×1000** (16:10) |
| small | `site/public/story/vault-s/fNNN.webp`, **1280×800** |
| posters | `site/public/story/vault/poster-f000.webp`, `poster-f220.webp` (1600×1000, q85) |
| format | webp q80, lossless alpha, straight (unpremultiplied) RGBA, sRGB |
| background | **transparent**: the page supplies the ground colour (there is a soft ground shadow under the plinth) |
| colour | Cycles, view transform *Khronos PBR Neutral*, exposure 0 |
| composition | subject **centred**, inside x 0.20–0.80 / y 0.08–0.92 (the page shifts the film right itself) |

Rects are normalized 0…1 with the origin at the top-left (x right, y down):

| frame | rect `{x, y, w, h}` | what |
|---|---|---|
| f000 | `{0.390, 0.026, 0.219, 0.920}` | exposed toothed key blade (key vertical, head off the top, teeth on its right edge, lock flange from y≈0.95) |
| f090 | `{0.464, 0.271, 0.073, 0.447}` | whole key (head up) inside the vault, seen top-down |
| f160 | `{0.250, 0.099, 0.501, 0.801}` | vault + plinth, top-down |
| f220 | `{0.276, 0.089, 0.435, 0.822}` | vault + plinth, 3/4 hero |

Regenerate the rects with `--no-render --meta out.json`.

### Coverage (for the page's clip / text layout)

From an alpha pass over all 221 frames:

- **No frame is fully opaque.** Until the dark floor fades in, the vault floor is a camera holdout, so the key floats on the page ground.
- f000–f029: the round lock flange runs off the bottom edge and covers the bottom ~10% of the left-20% band.
- f030–f035: clean. Only key + lock, centred.
- f036–f049: the smoked glass lid fades in as a frame-wide veil (alpha ~0.1 → 0.5, edge to edge).
- f050–f080: vault walls and beams sweep across the frame edges. The dark floor fades in over ~f062–f080.
- **f081–f220: the left 20% is clean** (alpha ≤ 0.07, faint soft shadow only) and nothing touches the frame border.

## Camera (ease in/out throughout)

| frames | move |
|---|---|
| 0 | macro, straight down onto the key's teeth (camera inside the vault, f/16 shallow focus) |
| 0–90 | log-eased pull-back. Lid crossing at f35, glass fades in over f36–f46. At f90 the key in the cylinder is seen through the lid, whole vault in frame |
| 90–160 | keeps pulling back to vault + plinth. From f115 a slow yaw turn starts |
| 160–220 | tilt up to a 3/4 view (33° elevation, camera front-right) while the turn finishes, lens 50 → 70 mm |

The key + cylinder are rolled 32° about the cylinder axis, so the enamel head faces the f220
camera while the teeth still read top-down.

## Re-render

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender

# preview stills (writes to site/assets/blender/.render/png unless --out)
nice -n 10 $B -b --factory-startup -P site/assets/blender/vault.py -- --frames 0,110,220

# full sequence (resumable: existing PNGs are skipped, add --overwrite to redo)
nice -n 10 $B -b --factory-startup -P site/assets/blender/vault.py -- \
    --save site/assets/blender/.render/vault.blend > site/assets/blender/.render/render.log 2>&1

# encode -> site/public/story/vault/, vault-s/, posters
python3 site/assets/blender/encode.py            # needs Pillow + numpy, cwebp on PATH
```

Useful flags for `vault.py` (after `--`): `--range 40-80`, `--pct 25 --samples 32` (fast
drafts), `--floor holdout|gunmetal|stone` (holdout is the shipped look; gunmetal = dark floor
from frame 0; stone = light floor), `--report` (per-frame safe-area table), `--meta FILE`,
`--cpu`, `--set NAME=value` (dev override of a module constant, e.g. `--set D220=8.4`).

Render settings: Cycles on the Metal GPU, adaptive sampling (max 512, threshold 0.01),
OpenImageDenoise (albedo + normal), fixed seed (no animated noise), film transparent with
transparent glass.

### Alpha clean-up (`encode.py`)

Cycles denoises the premultiplied colour but **not alpha**, so smoked glass and soft
shadows come out with grainy alpha that only shows on a light ground. `encode.py` runs an
edge-aware (bilateral) smooth on alpha, only inside partially transparent regions, keeps
the denoised premultiplied colour, then un-premultiplies and calls `cwebp`. The small set is
resized in premultiplied space, so there are no dark fringes.

Output of the shipped set: `vault/` is 16.0 MB, `vault-s/` is 11.6 MB.
`site/scripts/check_frames.py` (rt-site) passes: 221/221 in both sets, RGBA, both posters
present, left 20% covered only on f0–f29 and f38–f80, border opaque only on f47–f57 and f63–f70.

## Timing (Apple M5 Pro, Metal, under `nice`)

- 1600×1000: about 15–17 s per frame for the holdout opening (f0–f35), 30–42 s during the lid / floor fade-in (f40–f80), and 27–30 s for the top-down and tilt frames. Full run of 221 frames: **6372 s (1 h 46 min)**.
- First launch on a machine compiles the Cycles Metal kernels (about 2 min, cached after that).
- `encode.py`: about 7 s of CPU per frame (cwebp -m 6, both sizes), run 6 in parallel by default (`--jobs`), so about 4–5 min for the whole set.
- Draft pass (`--pct 20 --samples 16`): 221 frames in about 40 s.

---

# "How it works": step turntables (`how.py`)

Five small 3D compositions for the landing page's "How it works" section. Each is a short
turntable that the page scrubs with scroll. `how.py` imports `vault.py` for the materials,
lights, world and the vault + key builders, so the look matches the story film exactly.

| step | composition |
|---|---|
| 1 · the owner posts a bounty | brushed-steel escrow box (lid seam, brass-rimmed slot) with a canary-wax-sealed card half inside the slot; 14-coin brass stack + one loose coin, on a stone slab |
| 2 · agents bid, negotiate, hire | polished-steel pawn tokens: the lead (1.25×, on a stone riser, canary enamel collar) wired by brass rods with ball joints to two sub-tokens (a two-level tree) |
| 3 · every attack is one sealed message | the story's vault + key; a wax-sealed card half inserted into a slot in the glass lid (steel bezel) |
| 4 · a TEE runs it and checks for the key | the vault + key standing on a thin brushed-steel chip (chamfered corners, dark substrate, brass gull-wing leads on all four sides) |
| 5 · paid in the same step, or not at all | the coin stack splitting: a 12-coin and a 6-coin stack with two coins frozen mid-flight between them, beside a wax-sealed report card |

## Frame spec

| | |
|---|---|
| frames | **48 per step**, `f000.webp` … `f047.webp`. f000 is the rest pose, then an eased ~35° orbit |
| large | `site/public/how/step{1..5}/fNNN.webp`, **1200×900** (4:3) |
| small | `site/public/how/step{1..5}-s/fNNN.webp`, **900×675** |
| poster | `site/public/how/step{1..5}/poster.webp` (= f000, q85) |
| format | webp q80, lossless straight alpha, transparent background (designed for night `#121214`, also checked on paper `#F6F5F1`) |
| composition | subject centred, filling ~70% of the frame height over the whole orbit (auto-fit in `how.py`), always inside x 0.1–0.9 |
| borders | `encode.py --edge-feather 0.08` fades alpha to 0 over the outer 8%, so soft ground shadows never touch the frame edge (border alpha is 0 on every frame; there's no plate behind this section) |

Scene differences from the vault film: the key light sits higher (shorter shadows), the rim
light is lifted and dimmed so flat steel tops (escrow lid, chip) don't mirror it white, the
overhead sky blob is softer (0.3 instead of 0.8), and the coins use a muted brushed brass.

## Re-render

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
# preview stills (rest pose) of all steps
nice -n 10 $B -b --factory-startup -P site/assets/blender/how.py -- --frames 0
# full sequences (resumable), PNGs in site/assets/blender/.render/how/stepN/
nice -n 10 $B -b --factory-startup -P site/assets/blender/how.py -- \
    --save site/assets/blender/.render/how > site/assets/blender/.render/how/render.log 2>&1
# encode
for n in 1 2 3 4 5; do
  python3 site/assets/blender/encode.py --png site/assets/blender/.render/how/step$n \
    --out site/public/how/step$n --out-small site/public/how/step$n-s --small 900x675 \
    --frames 0-47 --posters 0 --poster-name poster.webp --edge-feather 0.08
done
```

Flags: `--steps 2,4`, `--frames 0,47` or `0-47`, `--pct/--samples` for drafts, `--report`
(projected bounds at f0, mid and end).

## Timing (M5 Pro, Metal, under `nice`)

- 1200×900: 12–19 s per frame (vault steps 3 and 4 are the slowest). Per step: 679 / 627 / 870 / 869 / 635 s, so **3680 s (61 min)** for all 240 frames.
- Output: large sets 3.2 / 2.6 / 5.6 / 6.2 / 2.3 MB, small sets 1.6–2.6 MB each (about 31 MB in total).
- Checked: 48/48 frames per step in both sizes, RGBA, posters present, border alpha 0 on every frame, subject inside x 0.11–0.89.

---

# Brand mark (`logo.py`, `logo_sheet.py`, `brand.py`)

The Canary Court mark is the **slotted cube**: the enclave as an isometric cube with a slot cut
through it, so the block reads as a "C". A small canary facet sits on the slot's back wall (the
secret inside the enclave, and the slot the sealed messages go into). It's modelled as a few flat facets in Blender and projected through a camera in Python. It's
written straight to SVG as flat polygons in one ink with 2–3 tones per facet: no strokes, no
gradients, no raster trace. Creases are knock-out gaps. The faces are painted in an explicit
order and each nearer face cuts a thin gap out of the ones behind, so the ink C on the front
stays whole.

Colours: ink `#17171A` with two lighter ink tones on paper `#F6F5F1`. On night `#121214` the
reverse: `#EEEDE8` plus two darker tones. The canary `#D2AE3C` is the only accent, on one facet.

Two optical sizes of the same model:

| | slot (x from / z range) | crease gap | used for |
|---|---|---|---|
| large | 0.34 / 0.335–0.665 | 1.6% | all vector use ≥ 64px, OG, apple-touch, PWA icons |
| small | 0.26 / 0.25–0.75 | none | favicons and the header lockup (≤ 48px) |

At 16px the small mark keeps **4 fully saturated canary pixels** (21 at 32px), in light and dark.

## Files: `site/public/brand/`

| file | what |
|---|---|
| `mark-paper.svg`, `mark-night.svg` | the mark, tones for paper / for night (transparent, 100×100 viewBox) |
| `mark-mono.svg` | one ink, `fill="currentColor"`; drops the slot's inside so the notch stays negative space (print, tiny UI) |
| `mark-small-{paper,night,mono}.svg` | the small optical size |
| `icon.svg` | small mark; paper tones, night tones under `prefers-color-scheme: dark` (the modern favicon) |
| `favicon.ico`, `favicon-dark.ico` | 16 + 32 frames (dedicated 16px render, not a downscale), transparent; light-UI / dark-UI |
| `icon-32.png`, `icon-32-dark.png` | 32px, transparent |
| `apple-touch-icon.png`, `-dark.png` | 180px on solid paper / night (iOS fills transparency with black) |
| `icon-192.png`, `icon-512.png` (+ `-dark`) | PWA icons, maskable: mark well inside the 80% safe circle, solid ground |
| `mark-2048.png`, `mark-2048-dark.png` | 2048px raster of the mark (transparent) |
| `lockup-{paper,night,mono}.svg` | mark + the wordmark **CANARY COURT** (League Spartan SemiBold caps, tracking +0.18em, word space 0.56em), all paths (no font needed). Aspect 9.2 : 1 |
| `lockup-small-{paper,night,mono}.svg` | the same with the small optical-size mark: use it in the header at **22px tall** on desktop (≈ 20px type, caps 13px, ≈ 202px wide) and **20px** on mobile (≈ 18px type, ≈ 184px wide) |
| `og.png` | 1200×630 on paper: the wordmark top-left, "Give AI money. / Not the keys." in Erode Light (the site's hero setting: leading 0.94, tracking −0.025em), the mark on the right |

### The wordmark (`wordmark.py`)

A dedicated logotype, distinct from the body text (Apfel Grotezk): **League Spartan SemiBold**
(600, instanced from the variable font), all caps, tracking +0.18em, word space 0.56em. Picked
by Tama over Jost Medium (+0.22em) and Josefin Sans SemiBold (+0.26em). Optics: the mark's ink
is 1.7× the measured cap height (the 'H' outline), with the caps centred on it; the mark-to-text
gap is 0.62 cap heights; kerning on, no tracking after the last letter. Shaped with HarfBuzz and
written as the font's own outlines. The font and its licence live in
`fonts/league-spartan/` (`LeagueSpartan[wght].ttf` + `OFL.txt`, SIL Open Font License 1.1, from
github.com/google/fonts). `python3 site/assets/blender/wordmark.py --variants spartan,jost --sheet`
redraws comparison sheets (the unpicked fonts aren't committed; fetch them from google/fonts).

Suggested wiring (Next app router):

```html
<link rel="icon" href="/brand/favicon.ico" sizes="32x32">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<!-- manifest: /brand/icon-192.png, /brand/icon-512.png, purpose "any maskable" -->
<!-- openGraph.images: /brand/og.png (1200x630) -->
```

## Regenerate

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
# concept exploration (A origami canary, B folded C, C slotted cube) + contact sheet
$B -b --factory-startup -P site/assets/blender/logo.py -- --out site/assets/blender/.render/logo
python3 site/assets/blender/logo_sheet.py --dir site/assets/blender/.render/logo
# the picked mark: SVGs + mark.json (both optical sizes)
$B -b --factory-startup -P site/assets/blender/logo.py -- --final site/assets/blender/.render/brand
# everything in site/public/brand/ (needs Pillow, fontTools + brotli, uharfbuzz)
python3 site/assets/blender/brand.py --erode /path/to/Erode-Light.ttf
```

Fonts: the lockups and the OG wordmark use League Spartan (committed in `fonts/league-spartan/`,
OFL). Erode (ITF Free Font License, which the site serves from Fontshare and never
self-hosts) is only used to render the OG pixels and is **not** committed. Without `--erode`
the OG is built without the headline.

---

# Lower-section pieces (`more.py`)

Four more pieces in the same language (they import `how.py` / `vault.py`: materials, light rig,
cards, wax seals, coins, pawns, the vault + key):

| piece | composition | frames |
|---|---|---|
| P1 · receipts | a brass receipt spike on a stone base, 20 blank receipts pierced and fanned on it, three with a small canary wax seal | 48, eased ~35° orbit |
| P2 · five ways to steal, none work | the vault + key on a wide plinth with five calm failed attempts around it: a counterfeit key (crude square-notched blade), a note card sealed to the judge, a steel pawn lying on its side, a toppled coin stack, a duplicated card pair | 48, eased ~35° orbit |
| P3 · public vs sealed | a clear-glass box (the vault's frame, clear glass) holding an upright verdict card, beside a closed brushed-steel box with a canary wax seal across its lid seam | 48, eased ~35° orbit |
| P4 · close | the vault + key on its plinth, a slow **360°** turntable, linear so it loops (f072 would equal f000) | 72 |

## Frame spec

| | |
|---|---|
| large | `site/public/more/p{1..4}/fNNN.webp`, **1200×900**, f000–f047 (P4: f000–f071) |
| small | `site/public/more/p{1..4}-s/fNNN.webp`, **900×675** |
| poster | `site/public/more/p{1..4}/poster.webp` (= f000) |
| format | webp q80, straight alpha, transparent, edge-feathered like `how/` (border alpha 0) |
| composition | centred, ~70% of the height over the whole orbit (all 360° for P4), inside x 0.1–0.9 |

```bash
nice -n 10 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P site/assets/blender/more.py \
    -- --pieces 1,2,3,4 --save site/assets/blender/.render/more > site/assets/blender/.render/more/render.log 2>&1
for n in 1 2 3; do python3 site/assets/blender/encode.py --png site/assets/blender/.render/more/p$n \
  --out site/public/more/p$n --out-small site/public/more/p$n-s --small 900x675 --frames 0-47 \
  --posters 0 --poster-name poster.webp --edge-feather 0.08; done
python3 site/assets/blender/encode.py --png site/assets/blender/.render/more/p4 --out site/public/more/p4 \
  --out-small site/public/more/p4-s --small 900x675 --frames 0-71 --posters 0 --poster-name poster.webp --edge-feather 0.08
```

Timing (M5 Pro, Metal, under `nice`): P1 709 s, P2 890 s, P3 907 s, P4 ≈ 1350 s (72 frames), so about
**64 min** for 216 frames (15–23 s per frame). Output: large 2.3 / 4.3 / 5.8 / 8.7 MB, small 1.6–3.6 MB
(~31 MB in total). Checked: all frames in both sizes, RGBA, posters present, border alpha 0, subject
inside x 0.12–0.93. P4's f071 sits one step before f000, so it loops seamlessly.
