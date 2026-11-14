"""Checks a rendered film against the page's spec before it's wired in (content/story.ts):
221 frames f000..f220 in <dir>/vault (1600x1000) and <dir>/vault-s (1280x800), webp with alpha, posters f000/f220, and
how much of each frame's left 20% is covered (the words' column on wide screens) plus whether its edges are opaque.

    python3 scripts/check_frames.py [public/story]
"""

from __future__ import annotations

import os
import sys

from PIL import Image

N = 221
SETS = {"vault": (1600, 1000), "vault-s": (1280, 800)}


def coverage(im: Image.Image) -> tuple[float, float]:
    """share of the left 20% with alpha > 8, and share of the border ring (2% wide) that is opaque (alpha > 240)"""
    a = im.getchannel("A")
    w, h = a.size
    small = a.resize((160, 100))
    px = small.load()
    left = sum(1 for x in range(32) for y in range(100) if px[x, y] > 8) / (32 * 100)
    ring = [(x, y) for x in range(160) for y in (0, 1, 98, 99)] + [(x, y) for y in range(100) for x in (0, 1, 158, 159)]
    edge = sum(1 for x, y in ring if px[x, y] > 240) / len(ring)
    return left, edge


def main() -> None:
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "public", "story")
    ok = True
    for name, (w, h) in SETS.items():
        d = os.path.join(root, name)
        missing, wrong, no_alpha = [], [], []
        total = 0
        for i in range(N):
            p = os.path.join(d, f"f{i:03d}.webp")
            if not os.path.exists(p):
                missing.append(i)
                continue
            total += os.path.getsize(p)
            im = Image.open(p)
            if im.size != (w, h):
                wrong.append((i, im.size))
            if im.mode != "RGBA":
                no_alpha.append(i)
        print(f"{name}: {N - len(missing)}/{N} frames, {total / 1e6:.1f} MB" + (f", missing {missing[:10]}{'…' if len(missing) > 10 else ''}" if missing else ""))
        if wrong:
            print(f"  wrong size: {wrong[:5]}")
        if no_alpha:
            print(f"  no alpha: {no_alpha[:10]}")
        ok &= not (missing or wrong or no_alpha)
    for poster in ("poster-f000.webp", "poster-f220.webp"):
        p = os.path.join(root, "vault", poster)
        print(f"{poster}: {'ok ' + str(Image.open(p).size) if os.path.exists(p) else 'MISSING'}")
        ok &= os.path.exists(p)
    # coverage per frame (full-size set): where the words' column is crossed, where the frame is opaque to its edges
    d = os.path.join(root, "vault")
    crossed, opaque = [], []
    for i in range(N):
        p = os.path.join(d, f"f{i:03d}.webp")
        if not os.path.exists(p):
            continue
        left, edge = coverage(Image.open(p).convert("RGBA"))
        if left > 0.01:
            crossed.append(i)
        if edge > 0.5:
            opaque.append(i)

    def ranges(xs: list[int]) -> str:
        out, start = [], None
        for k, x in enumerate(xs):
            if start is None:
                start = x
            if k == len(xs) - 1 or xs[k + 1] != x + 1:
                out.append(f"f{start}" + (f"–f{x}" if x != start else ""))
                start = None
        return ", ".join(out) or "none"

    print(f"left 20% covered (>1%): {ranges(crossed)}")
    print(f"edges opaque (>50% of the border ring): {ranges(opaque)}")
    print("OK" if ok else "NOT OK")


if __name__ == "__main__":
    main()
