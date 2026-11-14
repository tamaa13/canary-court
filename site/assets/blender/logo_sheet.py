"""
Previews for the mark concepts written by logo.py: 2048px PNGs and one contact sheet.

  python3 site/assets/blender/logo_sheet.py [--dir site/assets/blender/.render/logo] [--font PATH]

Rasterises the SVG polygons from X.json with Pillow (supersampled, so 16/32 px show the real
anti-aliased favicon look). The sheet has, per concept: 512px on paper and on night, 32px and
16px at actual size (with an 8x pixel zoom next to them), and a lockup with the wordmark
"Canary Court" (Apfel Grotezk Mittel, as the site sets it) on paper and on night.
"""
import argparse
import glob
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER, NIGHT = (246, 245, 241), (18, 18, 20)
INK, LIGHT_INK = (23, 23, 26), (238, 237, 232)
DEFAULT_FONT = os.path.expanduser("~/projects/near-redteam-site/site/src/fonts/ApfelGrotezk-Mittel.woff2")


def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def raster(mark, variant, px, ground=None, ss=None):
    """The mark at px x px (RGBA, transparent unless ground)."""
    ss = ss or (8 if px <= 128 else 2)
    big = px * ss
    im = Image.new("RGBA", (big, big), (*ground, 255) if ground else (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    tones = mark["tones"][variant]
    for sh in mark["shapes"]:
        fill = hex2rgb(mark["canary"] if sh["tone"] == "accent" else tones[sh["tone"]])
        for poly in sh["polys"]:
            dr.polygon([(x / 100 * big, y / 100 * big) for x, y in poly], fill=(*fill, 255))
    return im.resize((px, px), Image.LANCZOS if px >= 128 else Image.BOX)


def label(dr, xy, text, font, fill):
    dr.text(xy, text, font=font, fill=fill)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, ".render", "logo"))
    ap.add_argument("--font", default=DEFAULT_FONT)
    args = ap.parse_args()
    marks = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(args.dir, "*.json")))]
    word = ImageFont.truetype(args.font, 68)
    small = ImageFont.truetype(args.font, 22)

    for m in marks:
        for variant, ground in (("paper", None), ("night", None)):
            raster(m, variant, 2048).save(os.path.join(args.dir, f"{m['key']}.{variant}.2048.png"))

    cell = 512
    row_h = cell + 70
    lock_w = 760
    W = 40 + cell * 2 + 30 + 260 + 30 + lock_w + 40
    H = 90 + row_h * len(marks) + 20
    sheet = Image.new("RGB", (W, H), (226, 225, 220))
    dr = ImageDraw.Draw(sheet)
    head = ImageFont.truetype(args.font, 26)
    dr.text((40, 30), "Canary Court mark: concepts (paper | night | 32px, 16px + 8x zoom | lockup)", font=head, fill=INK)
    for r, m in enumerate(marks):
        y = 90 + r * row_h
        dr.text((40, y), f"{m['key']}  {m['title']}", font=small, fill=INK)
        y += 34
        for c, (variant, ground) in enumerate((("paper", PAPER), ("night", NIGHT))):
            x = 40 + c * cell
            sheet.paste(raster(m, variant, cell, ground), (x, y))
        # favicon sizes, actual size and zoomed, on paper (top) and night (bottom)
        x0 = 40 + cell * 2 + 30
        for k, (variant, ground) in enumerate((("paper", PAPER), ("night", NIGHT))):
            yy = y + k * 256
            bg = Image.new("RGB", (260, 250), ground)
            for j, px in enumerate((32, 16)):
                ic = raster(m, variant, px, ground).convert("RGB")
                bg.paste(ic, (12, 20 + j * 120))
                bg.paste(ic.resize((px * 8 // (2 if px == 32 else 1), px * 8 // (2 if px == 32 else 1)),
                                   Image.NEAREST), (60, 8 + j * 120))
            sheet.paste(bg, (x0, yy))
        # lockups: mark + wordmark, paper and night
        xl = x0 + 260 + 30
        for k, (variant, ground, ink) in enumerate((("paper", PAPER, INK), ("night", NIGHT, LIGHT_INK))):
            yy = y + k * 256
            bg = Image.new("RGB", (lock_w, 250), ground)
            bd = ImageDraw.Draw(bg)
            mk = raster(m, variant, 96, None)
            bg.paste(mk, (40, 77), mk)
            bd.text((150, 125), "Canary Court", font=word, fill=ink, anchor="lm")
            # the site size: 17px text, mark at the text's cap height
            mk_s = raster(m, variant, 22, None)
            bg.paste(mk_s, (40, 205), mk_s)
            bd.text((68, 216), "Canary Court", font=ImageFont.truetype(args.font, 17), fill=ink, anchor="lm")
            sheet.paste(bg, (xl, yy))
    out = os.path.join(args.dir, "contact_sheet.png")
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
