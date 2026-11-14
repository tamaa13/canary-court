"""
Canary Court brand assets from the picked mark (logo.py --final): favicons, app icons, lockups, OG.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P site/assets/blender/logo.py \
      -- --final site/assets/blender/.render/brand
  python3 site/assets/blender/brand.py            # needs Pillow, fontTools + brotli, uharfbuzz

Writes site/public/brand/ (see README.md). Text is shaped with HarfBuzz (kerning + the site's
tracking) and drawn from the font's own outlines: in the lockup SVGs as real paths, in the OG
image rasterised from the same outlines, so the PNG and the SVG set the type identically.
Erode (OG headline) is only used to render pixels; its files are never copied into the repo.
"""
import argparse
import io
import json
import os
import shutil

import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "site", "public", "brand")
PAPER, NIGHT = (246, 245, 241), (18, 18, 20)
INK, LIGHT_INK = "#17171A", "#EEEDE8"
APFEL = os.path.expanduser("~/projects/near-redteam-site/site/src/fonts/ApfelGrotezk-Mittel.woff2")


def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


# ----------------------------------------------------------------------------- mark raster
def raster(shapes, tones, canary, px, ground=None, ss=None, fit=1.0):
    """The mark (0..100 box) drawn at px, scaled by `fit` around the centre (RGBA)."""
    ss = ss or (8 if px <= 128 else 3)
    big = px * ss
    im = Image.new("RGBA", (big, big), (*ground, 255) if ground else (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    off = big * (1 - fit) / 2
    for sh in shapes:
        fill = hex2rgb(canary if sh["tone"] == "accent" else tones[sh["tone"]])
        for poly in sh["polys"]:
            dr.polygon([(off + x / 100 * big * fit, off + y / 100 * big * fit) for x, y in poly], fill=(*fill, 255))
    return im.resize((px, px), Image.LANCZOS if px > 64 else Image.BOX)


# ----------------------------------------------------------------------------- type
class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.tt.flavor = None
        buf = io.BytesIO()
        self.tt.save(buf)
        self.hbfont = hb.Font(hb.Face(hb.Blob(buf.getvalue())))
        self.upem = self.tt["head"].unitsPerEm
        self.gs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        os2 = self.tt["OS/2"]
        self.cap = getattr(os2, "sCapHeight", 0) or 0.7 * self.upem

    def layout(self, text, tracking=0.0):
        """[(glyph name, x, y)] in font units, plus the advance width."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {"kern": True, "liga": True})
        x, out = 0, []
        n = len(buf.glyph_infos)
        for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
            out.append((self.order[info.codepoint], x + pos.x_offset, pos.y_offset))
            x += pos.x_advance + (tracking * self.upem if i < n - 1 else 0)
        return out, x

    def svg_path(self, text, size, x0, baseline, tracking=0.0):
        s = size / self.upem
        glyphs, adv = self.layout(text, tracking)
        d = []
        for name, gx, gy in glyphs:
            pen = SVGPathPen(self.gs)
            self.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x0 + gx * s, baseline - gy * s)))
            d.append(pen.getCommands())
        return " ".join(c for c in d if c), adv * s


class _Flatten(BasePen):
    """Glyph outline -> list of flattened contours (for the raster renderer)."""

    def __init__(self, gs, steps=8):
        super().__init__(gs)
        self.contours, self.cur, self.steps = [], [], steps

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                             u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self.cur.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if len(self.cur) > 2:
            self.contours.append(self.cur)
        self.cur = []

    _endPath = _closePath


def draw_text(img, font, text, size, x0, baseline, fill, tracking=0.0, ss=4):
    """Even-odd fill of the shaped outlines, supersampled, composited onto img (RGB)."""
    s = size / font.upem
    glyphs, adv = font.layout(text, tracking)
    w, h = img.size
    mask = Image.new("1", (w * ss, h * ss), 0)
    for name, gx, gy in glyphs:
        pen = _Flatten(font.gs)
        font.gs[name].draw(pen)
        for c in pen.contours:
            m = Image.new("1", mask.size, 0)
            ImageDraw.Draw(m).polygon([((x0 + (gx + px) * s) * ss, (baseline - (gy + py) * s) * ss) for px, py in c], fill=1)
            mask = ImageChops.logical_xor(mask, m)
    a = mask.convert("L").resize((w, h), Image.BOX)
    img.paste(Image.new("RGB", (w, h), fill), (0, 0), a)
    return adv * s


# ----------------------------------------------------------------------------- outputs
def ink_box(shapes):
    pts = [p for sh in shapes for poly in sh["polys"] for p in poly]
    return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)


def mark_svg_group(shapes, tones, canary, x, y, h, mono_color=None, box=None):
    """The mark with its INK (not its padded 0..100 box) placed at x, y and h tall."""
    bx0, by0, bx1, by1 = box or ink_box(shapes)
    s = h / (by1 - by0)
    parts = []
    for sh in shapes:
        if not sh["polys"]:
            continue
        fill = mono_color or (canary if sh["tone"] == "accent" else tones[sh["tone"]])
        d = " ".join("M" + " ".join(f"{x + (px - bx0) * s:.2f},{y + (py - by0) * s:.2f}" for px, py in poly) + "Z"
                     for poly in sh["polys"])
        parts.append(f'<path d="{d}" fill="{fill}"/>')
    return "".join(parts), (bx1 - bx0) * s


def text_ink_right(font, text, size, x0, tracking):
    from fontTools.pens.boundsPen import BoundsPen
    s = size / font.upem
    glyphs, _ = font.layout(text, tracking)
    right = x0
    for name, gx, _gy in glyphs:
        bp = BoundsPen(font.gs)
        font.gs[name].draw(bp)
        if bp.bounds:
            right = max(right, x0 + (gx + bp.bounds[2]) * s)
    return right


def lockup_svg(mark, size_key, font, variant):
    """Mark + 'Canary Court' (Apfel Grotezk Mittel, tracking -0.02em as on the site), wordmark as paths.
    The mark's ink is 1.2x the font size tall, centred on the capitals; 0.42 em between them."""
    F = 100.0                                         # font size in SVG units
    cap = font.cap / font.upem * F
    mh = 1.2 * F
    gap = 0.42 * F
    base = mh / 2 + cap / 2
    shapes = mark["sizes"][size_key]["mono" if variant == "mono" else "shapes"]
    box = ink_box(mark["sizes"][size_key]["shapes"])   # mono drops inner faces; keep the same footprint
    tones = mark["tones"]["night" if variant == "night" else "paper"]
    text_fill = {"paper": INK, "night": LIGHT_INK, "mono": "currentColor"}[variant]
    g, mw = mark_svg_group(shapes, tones, mark["canary"], 0, 0, mh,
                           "currentColor" if variant == "mono" else None, box)
    tx = mw + gap
    d, _adv = font.svg_path("Canary Court", F, tx, base, tracking=-0.02)
    W = text_ink_right(font, "Canary Court", F, tx, -0.02) + 0.02 * F
    H = mh
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}" width="{W * 0.4:.0f}" '
            f'height="{H * 0.4:.0f}" role="img" aria-label="Canary Court">{g}<path d="{d}" fill="{text_fill}"/></svg>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(HERE, ".render", "brand"))
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--erode", default="", help="Erode Light .ttf/.woff2 (render-only) for the OG headline")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    mark = json.load(open(os.path.join(args.src, "mark.json")))
    T, CAN = mark["tones"], mark["canary"]
    large, small = mark["sizes"]["large"]["shapes"], mark["sizes"]["small"]["shapes"]

    for f in ("mark-paper.svg", "mark-night.svg", "mark-mono.svg", "mark-small-paper.svg",
              "mark-small-night.svg", "mark-small-mono.svg", "icon.svg"):
        shutil.copy(os.path.join(args.src, f), os.path.join(args.out, f))

    for variant in ("paper", "night"):
        sfx = "" if variant == "paper" else "-dark"
        tones = T[variant]
        ground = PAPER if variant == "paper" else NIGHT
        raster(large, tones, CAN, 2048).save(os.path.join(args.out, f"mark-2048{sfx}.png"))
        # favicons: the small optical size, transparent
        i16 = raster(small, tones, CAN, 16)
        i32 = raster(small, tones, CAN, 32)
        i32.save(os.path.join(args.out, f"icon-32{sfx}.png"))
        i32.save(os.path.join(args.out, f"favicon{sfx}.ico"), format="ICO", sizes=[(16, 16), (32, 32)],
                 append_images=[i16])
        # apple touch: solid ground (iOS fills transparency with black), mark at 66%
        raster(large, tones, CAN, 180, ground, fit=0.66).convert("RGB").save(
            os.path.join(args.out, f"apple-touch-icon{sfx}.png"))
        # PWA / maskable: mark inside the 80% safe circle (fit 0.58 keeps its corners within it)
        for px in (192, 512):
            raster(large, tones, CAN, px, ground, fit=0.58).convert("RGB").save(
                os.path.join(args.out, f"icon-{px}{sfx}.png"))

    # lockups: the mark + the wordmark (League Spartan SemiBold caps, tracked; see wordmark.py), as paths
    import tempfile
    import wordmark as WM
    spec = WM.VARIANTS["spartan"]
    with tempfile.TemporaryDirectory() as cache:
        ls = WM.static_font(spec, cache)
        for size_key, stem in (("large", "lockup"), ("small", "lockup-small")):
            for variant in ("paper", "night", "mono"):
                svg, _ = WM.lockup(ls, spec, mark, size_key, variant)
                with open(os.path.join(args.out, f"{stem}-{variant}.svg"), "w") as fh:
                    fh.write(svg)

        # OG 1200x630: paper, the wordmark top-left, the headline (Erode Light) bottom-left, the mark right
        og = Image.new("RGB", (1200, 630), PAPER)
        size = 30
        base = 80 + WM.cap_height(ls) / ls.upem * size
        x = 80
        for wi, word in enumerate(("CANARY", "COURT")):
            if wi:
                x += spec["word"] * size
            x += draw_text(og, ls, word, size, x, base, hex2rgb(INK), tracking=spec["tracking"])
        if args.erode and os.path.exists(args.erode):
            erode = Font(args.erode)
            size, lead = 104, 0.94
            y2 = 630 - 92
            draw_text(og, erode, "Give AI money.", size, 76, y2 - size * lead, hex2rgb(INK), tracking=-0.025)
            draw_text(og, erode, "Not the keys.", size, 76, y2, hex2rgb(INK), tracking=-0.025)
        m = raster(large, T["paper"], CAN, 400)
        og.paste(m, (1200 - 400 - 50, (630 - 400) // 2), m)
        og.save(os.path.join(args.out, "og.png"))
    print("wrote", sorted(os.listdir(args.out)))


if __name__ == "__main__":
    main()
