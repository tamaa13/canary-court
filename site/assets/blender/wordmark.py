"""
Canary Court wordmark: the mark + "CANARY COURT" set in tracked geometric capitals, outlined to SVG.

  python3 site/assets/blender/wordmark.py [--variants jost,josefin,spartan] [--out DIR] [--sheet]

Each variant names an OFL font (kept in site/assets/blender/fonts/<family>/ with its OFL.txt),
a weight (variable fonts are instanced with fontTools), a tracking and a word space. Optical
rules shared by all variants:
  - the mark's ink is MARK_TO_CAP x the capital height, and the capitals are centred on it;
  - the mark-to-text gap is GAP_TO_CAP x the capital height;
  - letters are kerned (HarfBuzz) and tracked; no tracking after the last letter, and the word
    space is set on its own (wide tracking makes the font's own space look too tight).
The output SVGs are pure paths (mark polygons + glyph outlines): no font needed to display them.
Needs: fontTools (+ brotli), uharfbuzz, Pillow; rsvg-convert for --sheet.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import brand as BR  # noqa: E402  (Font, mark_svg_group, ink_box, raster)

FONTS = os.path.join(HERE, "fonts")
MARK_TO_CAP = 1.7
GAP_TO_CAP = 0.62

VARIANTS = {
    # shipped (Tama's pick, 2026-11-14): League Spartan SemiBold, the font + OFL live in fonts/league-spartan/
    "spartan": dict(title="League Spartan SemiBold", file="league-spartan/LeagueSpartan[wght].ttf", wght=600,
                    tracking=0.18, word=0.56),
    # explored, not shipped (OFL, fetch from github.com/google/fonts/tree/main/ofl to re-run them)
    "jost": dict(title="Jost Medium", file="jost/Jost[wght].ttf", wght=500, tracking=0.22, word=0.62),
    "josefin": dict(title="Josefin Sans SemiBold", file="josefinsans/JosefinSans[wght].ttf", wght=600,
                    tracking=0.26, word=0.66),
    "outfit": dict(title="Outfit Medium", file="outfit/Outfit[wght].ttf", wght=500, tracking=0.2, word=0.6),
}


def static_font(spec, cache):
    path = os.path.join(FONTS, spec["file"])
    tt = TTFont(path)
    if "fvar" in tt:
        tt = instancer.instantiateVariableFont(tt, {"wght": spec["wght"]})
    out = os.path.join(cache, f"{os.path.basename(path).split('[')[0]}-{spec['wght']}.ttf")
    tt.save(out)
    return BR.Font(out)


def set_caps(font, text, size, x0, baseline, tracking, word_em):
    """SVG path data + ink right edge for tracked capitals, words placed with an explicit space."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    s = size / font.upem
    x, d, right = x0, [], x0
    for wi, word in enumerate(text.split(" ")):
        if wi:
            x += word_em * size
        glyphs, adv = font.layout(word, tracking)
        for name, gx, gy in glyphs:
            pen = SVGPathPen(font.gs)
            font.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x + gx * s, baseline - gy * s)))
            d.append(pen.getCommands())
            bp = BoundsPen(font.gs)
            font.gs[name].draw(bp)
            if bp.bounds:
                right = max(right, x + (gx + bp.bounds[2]) * s)
        x += adv * s
    return " ".join(c for c in d if c), right


def cap_height(font):
    """Measured from the 'H' outline (more reliable than OS/2 across these families)."""
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(font.gs)
    font.gs[font.tt.getBestCmap()[ord("H")]].draw(bp)
    return bp.bounds[3]


def lockup(font, spec, mark, size_key, variant):
    capu = cap_height(font)
    F = 100.0
    cap = capu / font.upem * F
    mh = MARK_TO_CAP * cap
    box = BR.ink_box(mark["sizes"][size_key]["shapes"])
    shapes = mark["sizes"][size_key]["mono" if variant == "mono" else "shapes"]
    tones = mark["tones"]["night" if variant == "night" else "paper"]
    g, mw = BR.mark_svg_group(shapes, tones, mark["canary"], 0, 0, mh,
                              "currentColor" if variant == "mono" else None, box)
    base = mh / 2 + cap / 2
    tx = mw + GAP_TO_CAP * cap
    d, right = set_caps(font, "CANARY COURT", F, tx, base, spec["tracking"], spec["word"])
    W, H = right + 0.01 * F, mh
    fill = {"paper": BR.INK, "night": BR.LIGHT_INK, "mono": "currentColor"}[variant]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}" width="{W * 0.5:.0f}" '
            f'height="{H * 0.5:.0f}" role="img" aria-label="Canary Court">{g}<path d="{d}" fill="{fill}"/></svg>'), W / H


def rsvg(svg_path, png_path, height):
    subprocess.run(["rsvg-convert", "-h", str(height), svg_path, "-o", png_path], check=True)
    return Image.open(png_path).convert("RGBA")


def on(im, bg):
    b = Image.new("RGBA", im.size, bg + (255,))
    b.alpha_composite(im)
    return b.convert("RGB")


def contact_sheet(out, keys, mark):
    P, N = BR.PAPER, BR.NIGHT
    label = ImageFont.truetype(BR.APFEL, 22)
    rows = []
    for k in keys:
        spec = VARIANTS[k]
        big_p = on(rsvg(os.path.join(out, f"{k}-paper.svg"), os.path.join(out, f"{k}-paper.png"), 120), P)
        big_n = on(rsvg(os.path.join(out, f"{k}-night.svg"), os.path.join(out, f"{k}-night.png"), 120), N)
        # header size: caps ~ 0.7 of 17-20px text -> lockup height = MARK_TO_CAP * cap
        smalls = []
        for px_text, bg, var in ((17, P, "paper"), (20, P, "paper"), (17, N, "night"), (20, N, "night")):
            h = round(MARK_TO_CAP * 0.70 * px_text)
            smalls.append(on(rsvg(os.path.join(out, f"{k}-small-{var}.svg"),
                                  os.path.join(out, f"{k}-small-{var}-{px_text}.png"), h), bg))
        rows.append((spec["title"] + f"  ·  tracking {spec['tracking']:+.2f}em  ·  word {spec['word']:.2f}em",
                     big_p, big_n, smalls))
    W = 1700
    H = 60 + sum(40 + 2 * 150 + 120 + 20 for _ in rows)
    sheet = Image.new("RGB", (W, H), (226, 225, 220))
    dr = ImageDraw.Draw(sheet)
    y = 30
    fav = {v: BR.raster(mark["sizes"]["small"]["shapes"], mark["tones"][v], mark["canary"], 16, None)
           for v in ("paper", "night")}
    for title, bp, bn, smalls in rows:
        dr.text((30, y), title, font=label, fill=(23, 23, 26))
        y += 40
        for im, bg in ((bp, P), (bn, N)):
            cell = Image.new("RGB", (W - 60, 140), bg)
            cell.paste(im, (30, (140 - im.height) // 2))
            sheet.paste(cell, (30, y))
            y += 150
        # header row: 17px / 20px lockups on paper and night, plus a browser-tab-like favicon + 13px title
        strip = Image.new("RGB", (W - 60, 110), (210, 209, 204))
        x = 0
        for im, bg in zip(smalls, (P, P, N, N)):
            cell = Image.new("RGB", (im.width + 40, 50), bg)
            cell.paste(im, (20, (50 - im.height) // 2))
            strip.paste(cell, (x, 0))
            x += cell.width + 10
        for i, (v, bg) in enumerate((("paper", P), ("night", N))):
            tab = Image.new("RGB", (260, 40), bg)
            fv = fav[v]
            tab.paste(fv, (14, 12), fv)
            ImageDraw.Draw(tab).text((40, 20), "Canary Court", font=ImageFont.truetype(BR.APFEL, 13),
                                     fill=(23, 23, 26) if v == "paper" else (238, 237, 232), anchor="lm")
            strip.paste(tab, (i * 280, 60))
        sheet.paste(strip, (30, y))
        y += 130
    path = os.path.join(out, "wordmark_sheet.png")
    sheet.save(path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", default="spartan")
    ap.add_argument("--mark", default=os.path.join(HERE, ".render", "brand", "mark.json"))
    ap.add_argument("--out", default=os.path.join(HERE, ".render", "wordmark"))
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    mark = json.load(open(args.mark))
    keys = [k.strip() for k in args.variants.split(",") if k.strip()]
    with tempfile.TemporaryDirectory() as cache:
        for k in keys:
            font = static_font(VARIANTS[k], cache)
            for size_key, stem in (("large", k), ("small", f"{k}-small")):
                for variant in ("paper", "night", "mono"):
                    svg, ratio = lockup(font, VARIANTS[k], mark, size_key, variant)
                    with open(os.path.join(args.out, f"{stem}-{variant}.svg"), "w") as fh:
                        fh.write(svg)
            print(f"[wordmark] {k}: cap {cap_height(font)}/{font.upem}, lockup aspect {ratio:.2f}", flush=True)
    if args.sheet:
        print(contact_sheet(args.out, keys, mark))


if __name__ == "__main__":
    main()
