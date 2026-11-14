"""
PNG frames -> webp (large + small + posters). Defaults = the vault scroll story.

  python3 site/assets/blender/encode.py [--png DIR] [--frames 0-220] [--q 80]
  # "How it works" step turntables (see how.py):
  python3 site/assets/blender/encode.py --png site/assets/blender/.render/how/step1 \
      --out site/public/how/step1 --out-small site/public/how/step1-s --small 900x675 \
      --frames 0-47 --posters 0 --poster-name poster.webp

Cycles' denoiser cleans the (premultiplied) colour but not alpha, so smoked glass and
soft ground shadows come out with grainy alpha that only shows on a LIGHT page ground.
Before encoding we smooth alpha inside partially transparent regions only (edge-aware,
opaque/empty pixels and anti-aliased silhouettes untouched) and keep the premultiplied
colour, then write straight-alpha webp via cwebp.

Needs: python3 with Pillow + numpy, cwebp on PATH.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_L = os.path.join(REPO, "site", "public", "story", "vault")
OUT_S = os.path.join(REPO, "site", "public", "story", "vault-s")
SMALL = (1280, 800)


def box(a, r):
    p = np.pad(a, r, mode="edge")
    return sliding_window_view(p, (2 * r + 1, 2 * r + 1)).mean(axis=(-1, -2))


def clean_alpha(al, radius=3, sigma_r=0.06):
    """Bilateral smoothing of alpha restricted to the interior of partial-alpha regions."""
    part = (al > 0.004) & (al < 0.985)
    interior = box(part.astype(np.float32), 2) > 0.96
    if not interior.any():
        return al
    k = 2 * radius + 1
    pa = np.pad(al, radius, mode="edge")
    pm = np.pad(part, radius, mode="constant")
    win = sliding_window_view(pa, (k, k))
    wm = sliding_window_view(pm, (k, k))
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    gs = np.exp(-(xx ** 2 + yy ** 2) / (2 * (radius / 1.5) ** 2)).astype(np.float32)
    ys, xs = np.nonzero(interior)
    w = wm[ys, xs] * gs * np.exp(-((win[ys, xs] - al[ys, xs, None, None]) ** 2) / (2 * sigma_r ** 2))
    out = al.copy()
    out[ys, xs] = (w * win[ys, xs]).sum(axis=(-1, -2)) / np.maximum(w.sum(axis=(-1, -2)), 1e-6)
    return out


def edge_feather(prem, al, frac, tag=""):
    """Fade alpha (and premultiplied colour) to 0 over the outer `frac` of the frame, so soft
    ground shadows never touch the border. Warns if anything opaque sits inside the band."""
    h, w = al.shape
    fx, fy = max(1.0, frac * w), max(1.0, frac * h)
    x = np.minimum(np.arange(w) + 0.5, w - np.arange(w) - 0.5) / fx
    y = np.minimum(np.arange(h) + 0.5, h - np.arange(h) - 0.5) / fy
    rx = np.clip(x, 0, 1)
    ry = np.clip(y, 0, 1)
    rx = rx * rx * (3 - 2 * rx)
    ry = ry * ry * (3 - 2 * ry)
    ramp = np.minimum(ry[:, None], rx[None, :]).astype(np.float32)
    band = ramp < 1.0
    if (al[band] > 0.6).any():
        print(f"WARNING {tag}: opaque pixels inside the {frac:.0%} edge feather band", file=sys.stderr)
    return prem * ramp[..., None], al * ramp


def load_premul(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255.0
    al = a[..., 3]
    return a[..., :3] * al[..., None], al


def to_straight_img(prem, al):
    al = np.clip(al, 0.0, 1.0)
    rgb = np.where(al[..., None] > 1e-4, prem / np.maximum(al[..., None], 1e-4), 0.0)
    out = np.dstack([np.clip(rgb, 0, 1), al])
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGBA")


def resize_premul(prem, al, size):
    chans = [Image.fromarray(np.ascontiguousarray(c, dtype=np.float32), "F").resize(size, Image.LANCZOS) for c in
             (prem[..., 0], prem[..., 1], prem[..., 2], al)]
    arr = [np.asarray(c) for c in chans]
    a = np.clip(arr[3], 0, 1)
    p = np.dstack([np.clip(arr[0], 0, None), np.clip(arr[1], 0, None), np.clip(arr[2], 0, None)])
    return np.minimum(p, a[..., None]), a


def cwebp(img, dst, q):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
        img.save(t.name)
    try:
        subprocess.run(["cwebp", "-quiet", "-q", str(q), "-alpha_q", "100", "-m", "6",
                        "-sharp_yuv", t.name, "-o", dst], check=True)
    finally:
        os.unlink(t.name)


def encode_frame(f, png_dir, q, clean, out_l=OUT_L, out_s=OUT_S, small=SMALL, posters=(0, 220),
                 poster_name="poster-f{f:03d}.webp", feather=0.0):
    src = os.path.join(png_dir, f"f{f:03d}.png")
    if not os.path.exists(src):
        return f"missing {src}"
    prem, al = load_premul(src)
    if clean:
        # premultiplied colour is already denoised: keep it, only replace alpha
        al = clean_alpha(al)
        prem = np.minimum(prem, al[..., None])
    if feather > 0:
        prem, al = edge_feather(prem, al, feather, f"f{f:03d}")
    cwebp(to_straight_img(prem, al), os.path.join(out_l, f"f{f:03d}.webp"), q)
    sp, sa = resize_premul(prem, al, small)
    cwebp(to_straight_img(sp, sa), os.path.join(out_s, f"f{f:03d}.webp"), q)
    if f in posters:
        cwebp(to_straight_img(prem, al), os.path.join(out_l, poster_name.format(f=f)), max(q, 85))
    return f"encoded f{f:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", default=os.path.join(HERE, ".render", "png"))
    ap.add_argument("--frames", default="0-220")
    ap.add_argument("--q", type=int, default=80)
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--no-clean", action="store_true")
    ap.add_argument("--out", default=OUT_L, help="large set dir")
    ap.add_argument("--out-small", default=OUT_S, help="small set dir")
    ap.add_argument("--small", default=f"{SMALL[0]}x{SMALL[1]}", help="small set size WxH")
    ap.add_argument("--posters", default="0,220", help="frames that also get a poster")
    ap.add_argument("--poster-name", default="poster-f{f:03d}.webp")
    ap.add_argument("--edge-feather", type=float, default=0.0,
                    help="fade alpha to 0 over this fraction of the frame at each border (how/ uses 0.08)")
    args = ap.parse_args()
    a, b = (int(x) for x in args.frames.split("-"))
    small = tuple(int(v) for v in args.small.lower().split("x"))
    posters = tuple(int(v) for v in args.posters.split(",") if v.strip())
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.out_small, exist_ok=True)
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as ex:
        futs = [ex.submit(encode_frame, f, args.png, args.q, not args.no_clean, args.out, args.out_small,
                          small, posters, args.poster_name, args.edge_feather) for f in range(a, b + 1)]
        for fu in futs:
            msg = fu.result()
            print(msg, file=sys.stderr if msg.startswith("missing") else sys.stdout, flush=True)


if __name__ == "__main__":
    main()
